"""Extracción de texto de PDF, Word (.docx), texto plano y Google Docs.

Devuelve siempre (título, bloques), donde cada bloque es
{"tipo": "titulo" | "parrafo", "texto": str}.
"""

from __future__ import annotations

import io
import re
import statistics
import urllib.error
import urllib.request
import zipfile
from collections import Counter
from xml.etree import ElementTree as ET

from pypdf import PdfReader

MAX_BLOQUE = 700  # caracteres; trozos cortos = audio que arranca rápido


class ErrorDocumento(Exception):
    """Error que se puede mostrar tal cual a la persona usuaria."""


class PdfSinTexto(ErrorDocumento):
    """El PDF es una imagen escaneada: no contiene texto seleccionable."""


# ---------------------------------------------------------------- utilidades

_VINETA = re.compile(r"^\s*(?:[•●▪■◦○·\-–—*]|\d{1,2}[.)]|[a-zA-Z][.)])\s+")
_NUMERADO = re.compile(
    r"^(?:\d{1,2}(?:\.\d{1,2})*\.?|[IVXLC]{1,5}\.|tema|unidad|cap[ií]tulo|lecci[oó]n|"
    r"bloque|anexo|actividad)\s+\S",
    re.IGNORECASE,
)
_FIN_FRASE = re.compile(r"[.!?:…][\"'”»)\]]*$")


def _limpio(texto: str) -> str:
    return re.sub(r"\s+", " ", texto.replace("­", "")).strip()


def _parece_titulo(linea: str) -> bool:
    linea = linea.strip()
    if not 3 <= len(linea) <= 80 or linea[-1] in ".,;:":
        return False
    letras = [c for c in linea if c.isalpha()]
    if len(letras) < 3:
        return False
    if all(c.isupper() for c in letras):
        return True
    # "1.2 La célula", "Tema 3 ...": corto, sin punto final y pocas palabras
    return bool(_NUMERADO.match(linea)) and len(linea.split()) <= 9


def _trocear(texto: str) -> list[str]:
    """Divide un párrafo largo por frases para que cada audio sea breve."""
    if len(texto) <= MAX_BLOQUE:
        return [texto]
    frases = re.split(r"(?<=[.!?…])\s+(?=[A-ZÁÉÍÓÚÑ¿¡\"“«(\d])", texto)
    trozos, actual = [], ""
    for frase in frases:
        if actual and len(actual) + len(frase) + 1 > MAX_BLOQUE:
            trozos.append(actual)
            actual = frase
        else:
            actual = f"{actual} {frase}".strip()
    if actual:
        trozos.append(actual)
    return trozos


def _finalizar(bloques: list[dict], nombre: str) -> tuple[str, list[dict]]:
    salida = []
    for b in bloques:
        texto = _limpio(b["texto"])
        if not texto:
            continue
        if b["tipo"] == "titulo":
            salida.append({"tipo": "titulo", "texto": texto})
        else:
            salida.extend({"tipo": "parrafo", "texto": t} for t in _trocear(texto))
    if not salida:
        raise ErrorDocumento("El documento no contiene texto que se pueda leer.")
    titulo = next((b["texto"] for b in salida[:5] if b["tipo"] == "titulo"), None)
    if not titulo:
        titulo = re.sub(r"\.[A-Za-z0-9]+$", "", nombre).replace("_", " ").strip() or "Documento"
    return titulo, salida


# ----------------------------------------------------------------------- PDF

def _lineas_a_bloques(lineas: list[str]) -> list[dict]:
    largas = [len(l) for l in lineas if len(l.strip()) > 25]
    ancho = statistics.quantiles(largas, n=10)[7] if len(largas) >= 10 else 0
    bloques: list[dict] = []
    actual = ""

    def cerrar():
        nonlocal actual
        if actual:
            bloques.append({"tipo": "parrafo", "texto": actual})
            actual = ""

    for cruda in lineas:
        linea = cruda.strip()
        if not linea:
            cerrar()
            continue
        if _parece_titulo(linea) and not actual:
            bloques.append({"tipo": "titulo", "texto": linea})
            continue
        if _VINETA.match(linea):
            cerrar()
        if actual.endswith("-") and linea[:1].islower():
            actual = actual[:-1] + linea  # palabra partida a final de renglón
        else:
            actual = f"{actual} {linea}".strip()
        # Un renglón corto que acaba en punto marca el final del párrafo.
        if _FIN_FRASE.search(linea) and (not ancho or len(linea) < 0.85 * ancho):
            cerrar()
    cerrar()
    return bloques


def _de_pdf(datos: bytes) -> list[dict]:
    try:
        lector = PdfReader(io.BytesIO(datos))
        if lector.is_encrypted:
            lector.decrypt("")
        paginas = [(p.extract_text() or "").splitlines() for p in lector.pages]
    except Exception as e:  # pypdf lanza muchos tipos distintos
        raise ErrorDocumento("No se ha podido abrir el PDF. Puede estar dañado o protegido.") from e

    if sum(len(l) for pag in paginas for l in pag) < 20 * max(len(paginas), 1):
        raise PdfSinTexto(
            "Este PDF es una imagen escaneada y no contiene texto. "
            "Hace falta pasarle antes un reconocimiento de texto (OCR)."
        )

    # Quitar encabezados y pies que se repiten en casi todas las páginas.
    def clave(l: str) -> str:
        return re.sub(r"\d+", "#", l.strip().lower())

    repetidas: set[str] = set()
    if len(paginas) >= 3:
        cuenta = Counter()
        for pag in paginas:
            no_vacias = [l for l in pag if l.strip()]
            cuenta.update({clave(l) for l in no_vacias[:2] + no_vacias[-2:]})
        repetidas = {k for k, n in cuenta.items() if n >= 0.6 * len(paginas) and len(k) < 90}

    lineas: list[str] = []
    for pag in paginas:
        for l in pag:
            s = l.strip()
            if re.fullmatch(r"(?:p[aá]g(?:ina)?\.?\s*)?\d{1,4}(?:\s*(?:/|de)\s*\d{1,4})?", s, re.I):
                continue
            if s and clave(l) in repetidas:
                continue
            lineas.append(l)
    return _lineas_a_bloques(lineas)


# ---------------------------------------------------------------------- DOCX

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_ESTILO_TITULO = re.compile(r"^(heading|t[ií]?tulo|title|subt[ií]?tulo|subtitle|encabezado)", re.I)


def _de_docx(datos: bytes) -> list[dict]:
    try:
        with zipfile.ZipFile(io.BytesIO(datos)) as z:
            raiz = ET.fromstring(z.read("word/document.xml"))
    except (zipfile.BadZipFile, KeyError, ET.ParseError) as e:
        raise ErrorDocumento(
            "No se ha podido abrir el documento de Word. Debe ser un archivo .docx."
        ) from e

    bloques = []
    for p in raiz.iter(f"{_W}p"):
        partes = []
        for nodo in p.iter():
            if nodo.tag == f"{_W}t":
                partes.append(nodo.text or "")
            elif nodo.tag in (f"{_W}tab", f"{_W}br", f"{_W}cr"):
                partes.append(" ")
        texto = "".join(partes).strip()
        if not texto:
            continue
        estilo = p.find(f"{_W}pPr/{_W}pStyle")
        nombre = estilo.get(f"{_W}val", "") if estilo is not None else ""
        es_titulo = bool(_ESTILO_TITULO.match(nombre)) or _parece_titulo(texto)
        bloques.append({"tipo": "titulo" if es_titulo else "parrafo", "texto": texto})
    return bloques


# --------------------------------------------------------------- texto plano

def _de_texto(datos: bytes) -> list[dict]:
    for cod in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            texto = datos.decode(cod)
            break
        except UnicodeDecodeError:
            continue
    bloques = []
    for trozo in re.split(r"\n\s*\n", texto):
        trozo = trozo.strip()
        if not trozo:
            continue
        if trozo.startswith("#"):
            bloques.append({"tipo": "titulo", "texto": trozo.lstrip("# ")})
        elif "\n" not in trozo and _parece_titulo(trozo):
            bloques.append({"tipo": "titulo", "texto": trozo})
        else:
            bloques.append({"tipo": "parrafo", "texto": trozo})
    return bloques


# --------------------------------------------------------------- Google Docs

_ID_GDOC = re.compile(r"docs\.google\.com/document/(?:u/\d+/)?d/([\w-]{20,})")


def descargar_google_doc(url: str) -> bytes:
    m = _ID_GDOC.search(url)
    if not m:
        raise ErrorDocumento(
            "Ese enlace no parece de un documento de Google Docs. "
            "Debe empezar por docs.google.com/document/…"
        )
    exportar = f"https://docs.google.com/document/d/{m.group(1)}/export?format=docx"
    peticion = urllib.request.Request(exportar, headers={"User-Agent": "LectorVozResumen/1.0"})
    try:
        with urllib.request.urlopen(peticion, timeout=30) as r:
            datos = r.read(60 * 1024 * 1024)
    except (urllib.error.URLError, TimeoutError) as e:
        datos = b""
        causa = e
    else:
        causa = None
    if not datos.startswith(b"PK"):
        raise ErrorDocumento(
            "No se ha podido descargar el documento de Google. Tiene que estar compartido como "
            "«Cualquier persona con el enlace». Otra opción: en Google Docs, Archivo → Descargar → "
            "Microsoft Word (.docx) y subir ese archivo aquí."
        ) from causa
    return datos


# -------------------------------------------------------------------- entrada

def extraer(nombre: str, datos: bytes) -> tuple[str, list[dict]]:
    ext = nombre.lower().rsplit(".", 1)[-1] if "." in nombre else ""
    if datos.startswith(b"%PDF") or ext == "pdf":
        bloques = _de_pdf(datos)
    elif ext == "docx" or (datos.startswith(b"PK") and ext not in ("odt",)):
        bloques = _de_docx(datos)
    elif ext in ("txt", "md", "text", ""):
        bloques = _de_texto(datos)
    elif ext == "doc":
        raise ErrorDocumento(
            "Los archivos .doc antiguos no se pueden leer. Ábrelo en Word y guárdalo como .docx."
        )
    else:
        raise ErrorDocumento(
            f"No sé leer archivos «.{ext}». Sirven PDF, Word (.docx), texto (.txt) y Google Docs."
        )
    return _finalizar(bloques, nombre)
