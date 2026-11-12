"""Síntesis de voz neuronal (voces de Microsoft Edge, vía edge-tts) con caché en disco."""

from __future__ import annotations

import asyncio
import hashlib
import re
from pathlib import Path

import edge_tts

CACHE = Path(__file__).resolve().parent.parent / "cache_audio"

VOCES = {
    "es-ES-ElviraNeural": "Elvira (mujer, España)",
    "es-ES-XimenaNeural": "Ximena (mujer, España)",
    "es-ES-AlvaroNeural": "Álvaro (hombre, España)",
    "es-MX-DaliaNeural": "Dalia (mujer, México)",
    "en-GB-SoniaNeural": "Sonia (inglés británico)",
    "fr-FR-DeniseNeural": "Denise (francés)",
}
VOZ_POR_DEFECTO = "es-ES-ElviraNeural"
MAX_CACHE = 400 * 1024 * 1024  # bytes; al superarlo se borran los audios más antiguos


class ErrorVoz(Exception):
    pass


def _para_locucion(texto: str) -> str:
    """Quita lo que suena mal leído en voz alta."""
    texto = re.sub(r"https?://\S+|www\.\S+", " enlace web ", texto)
    texto = re.sub(r"^\s*[•●▪■◦○·*–—-]\s+", "", texto)
    texto = re.sub(r"[_*#|<>{}\[\]\\^~`]+", " ", texto)
    return re.sub(r"\s+", " ", texto).strip()


async def _generar(texto: str, voz: str) -> bytes:
    audio = bytearray()
    async for trozo in edge_tts.Communicate(texto, voz).stream():
        if trozo["type"] == "audio":
            audio.extend(trozo["data"])
    return bytes(audio)


def sintetizar(texto: str, voz: str = VOZ_POR_DEFECTO) -> bytes:
    """Devuelve el MP3 del texto. Se guarda en caché para no generarlo dos veces."""
    if voz not in VOCES:
        voz = VOZ_POR_DEFECTO
    texto = _para_locucion(texto)
    if not re.search(r"\w", texto):
        return b""
    CACHE.mkdir(exist_ok=True)
    ruta = CACHE / (hashlib.sha256(f"{voz}|{texto}".encode()).hexdigest()[:32] + ".mp3")
    if ruta.exists() and ruta.stat().st_size:
        return ruta.read_bytes()
    try:
        audio = asyncio.run(_generar(texto, voz))
    except Exception as e:  # red caída, servicio no disponible…
        raise ErrorVoz("No se ha podido generar la voz. Comprueba la conexión a internet.") from e
    if not audio:
        raise ErrorVoz("El servicio de voz no ha devuelto audio.")
    ruta.write_bytes(audio)
    _limpiar_cache()
    return audio


def _limpiar_cache() -> None:
    archivos = sorted(CACHE.glob("*.mp3"), key=lambda f: f.stat().st_mtime)
    total = sum(f.stat().st_size for f in archivos)
    while archivos and total > MAX_CACHE:
        viejo = archivos.pop(0)
        total -= viejo.stat().st_size
        viejo.unlink(missing_ok=True)
