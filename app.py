"""Lector con voz y esquema: servidor web local.

Arrancar con:  .venv/bin/python app.py   (o doble clic en «Abrir Lector.command»)
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import threading
import time
import urllib.parse
import uuid
import webbrowser
from datetime import timedelta
from pathlib import Path

from flask import Flask, Response, jsonify, redirect, request, send_from_directory, session

from lector import resumen, voz
from lector.extraer import ErrorDocumento, descargar_google_doc, extraer

RAIZ = Path(__file__).resolve().parent
app = Flask(__name__, static_folder=str(RAIZ / "static"), static_url_path="/static")
app.config["MAX_CONTENT_LENGTH"] = 60 * 1024 * 1024

# Código de acceso (opcional en este ordenador, obligatorio si se publica en internet).
CODIGO = os.environ.get("LECTOR_CODIGO", "").strip()
app.secret_key = os.environ.get("LECTOR_SECRETO") or hashlib.sha256(f"lector|{CODIGO}".encode()).digest()
app.config.update(
    PERMANENT_SESSION_LIFETIME=timedelta(days=180),  # la alumna no tiene que teclearlo cada vez
    SESSION_COOKIE_SAMESITE="Lax",
)
_LIBRES = ("/entrar", "/static/estilos.css", "/static/icono", "/static/manifest.webmanifest")


@app.before_request
def _pedir_codigo():
    if not CODIGO or session.get("dentro") or request.path.startswith(_LIBRES):
        return None
    if request.path.startswith("/api/"):
        return jsonify({"error": "Hay que escribir el código de acceso."}), 401
    return redirect("/entrar")


@app.get("/entrar")
def entrar():
    return send_from_directory(app.static_folder, "entrar.html")


@app.post("/entrar")
def comprobar_codigo():
    escrito = (request.form.get("codigo") or "").strip()
    if CODIGO and hmac.compare_digest(escrito.casefold().encode(), CODIGO.casefold().encode()):
        session.permanent = True
        session["dentro"] = True
        return redirect("/")
    time.sleep(1.5)  # frena a quien pruebe códigos al azar
    return redirect("/entrar?error=1")

# Documentos abiertos en esta sesión (en memoria: nada se guarda salvo el audio en caché).
DOCUMENTOS: dict[str, dict] = {}
_cerrojo = threading.Lock()


def _error(mensaje: str, codigo: int = 400):
    return jsonify({"error": mensaje}), codigo


@app.errorhandler(413)
def _demasiado_grande(_):
    return _error("El archivo es demasiado grande (máximo 60 MB).", 413)


@app.get("/")
def inicio():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/api/estado")
def estado():
    return jsonify({
        "ia": resumen.clave_api() is not None,
        "voces": voz.VOCES,
        "voz_por_defecto": voz.VOZ_POR_DEFECTO,
    })


@app.post("/api/documento")
def abrir_documento():
    try:
        archivo = request.files.get("archivo")
        if archivo and archivo.filename:
            nombre, datos = archivo.filename, archivo.read()
        elif (url := (request.form.get("url") or "").strip()):
            nombre, datos = "Documento de Google.docx", descargar_google_doc(url)
        else:
            return _error("No se ha recibido ningún documento.")
        titulo, bloques = extraer(nombre, datos)
    except ErrorDocumento as e:
        return _error(str(e), 422)

    ident = uuid.uuid4().hex[:12]
    with _cerrojo:
        if len(DOCUMENTOS) >= 30:  # no acumular memoria indefinidamente
            DOCUMENTOS.pop(next(iter(DOCUMENTOS)))
        DOCUMENTOS[ident] = {"titulo": titulo, "bloques": bloques, "locucion_resumen": []}
    return jsonify({"id": ident, "titulo": titulo, "bloques": bloques})


@app.post("/api/resumen/<ident>")
def crear_resumen(ident: str):
    doc = DOCUMENTOS.get(ident)
    if not doc:
        return _error("El documento ya no está abierto. Vuelve a cargarlo.", 404)
    esquema = resumen.resumir(doc["titulo"], doc["bloques"])

    # Numerar cada elemento del esquema para poder pedir su audio como «r0», «r1»…
    locucion: list[str] = []

    def audio(texto: str) -> int:
        locucion.append(texto)
        return len(locucion) - 1

    esquema["audio_idea"] = audio(f"Idea principal. {esquema['idea_principal']}")
    for s in esquema["secciones"]:
        s["audio"] = audio(f"{s['titulo']}.")
        s["puntos"] = [{"texto": p, "audio": audio(p)} for p in s["puntos"]]
    for c in esquema["conceptos"]:
        if c["definicion"]:
            c["audio"] = audio(f"{c['termino']}: {c['definicion']}")
    doc["locucion_resumen"] = locucion
    return jsonify(esquema)


def _texto_de(doc: dict, clave: str) -> str | None:
    m = re.fullmatch(r"(r?)(\d{1,5})", clave)
    if not m:
        return None
    lista = doc["locucion_resumen"] if m.group(1) else [b["texto"] for b in doc["bloques"]]
    n = int(m.group(2))
    return lista[n] if n < len(lista) else None


@app.get("/api/audio/<ident>/<clave>")
def audio_bloque(ident: str, clave: str):
    doc = DOCUMENTOS.get(ident)
    texto = _texto_de(doc, clave) if doc else None
    if texto is None:
        return _error("Ese fragmento no existe.", 404)
    try:
        mp3 = voz.sintetizar(texto, request.args.get("voz", voz.VOZ_POR_DEFECTO))
    except voz.ErrorVoz as e:
        return _error(str(e), 503)
    if not mp3:
        return Response(status=204)
    return Response(mp3, mimetype="audio/mpeg", headers={"Cache-Control": "private, max-age=86400"})


@app.get("/api/audio/<ident>/completo.mp3")
def audio_completo(ident: str):
    """Todo el documento en un único MP3, para llevárselo al móvil o a la tableta."""
    doc = DOCUMENTOS.get(ident)
    if not doc:
        return _error("El documento ya no está abierto. Vuelve a cargarlo.", 404)
    voz_elegida = request.args.get("voz", voz.VOZ_POR_DEFECTO)

    def generar():
        for b in doc["bloques"]:
            try:
                yield voz.sintetizar(b["texto"], voz_elegida)
            except voz.ErrorVoz:
                return  # el archivo queda cortado; mejor que un MP3 con huecos silenciosos

    nombre = re.sub(r"[^\w\- ]+", "", doc["titulo"])[:60].strip() or "documento"
    return Response(generar(), mimetype="audio/mpeg", headers={
        "Content-Disposition": f"attachment; filename*=UTF-8''{urllib.parse.quote(nombre)}.mp3",
    })


if __name__ == "__main__":
    # Los servicios de alojamiento indican el puerto en PORT y necesitan escuchar en 0.0.0.0.
    en_servidor = "PORT" in os.environ
    host = os.environ.get("LECTOR_HOST", "0.0.0.0" if en_servidor else "127.0.0.1")
    puerto = int(os.environ.get("PORT") or os.environ.get("LECTOR_PUERTO", "8765"))
    local = host in ("127.0.0.1", "localhost", "::1")
    if not local and not CODIGO:
        raise SystemExit(
            "Para abrir el lector a otros dispositivos hay que definir un código de acceso:\n"
            "  LECTOR_CODIGO=mi-codigo LECTOR_HOST=0.0.0.0 .venv/bin/python app.py"
        )
    if local and os.environ.get("LECTOR_NO_ABRIR") != "1":
        threading.Timer(1.0, lambda: webbrowser.open(f"http://localhost:{puerto}")).start()
    print(f"\n  Lector abierto en http://localhost:{puerto}   (Ctrl+C para cerrar)\n", flush=True)
    from waitress import serve
    serve(app, host=host, port=puerto, threads=8)
