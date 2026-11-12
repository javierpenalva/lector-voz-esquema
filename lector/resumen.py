"""Esquema visual del documento.

Con una clave de la API de Anthropic lo redacta Claude (frases propias, lectura fácil).
Sin clave se usa un método local que selecciona las frases más representativas.
"""

from __future__ import annotations

import os
import re
from collections import Counter
from pathlib import Path

import anthropic
from pydantic import BaseModel, Field

RAIZ = Path(__file__).resolve().parent.parent
MODELO = os.environ.get("LECTOR_MODELO", "claude-opus-5-5")

INSTRUCCIONES = """Eres especialista en accesibilidad cognitiva y lectura fácil. Preparas esquemas \
de estudio para una alumna que comprende mejor la información cuando la escucha y la ve \
organizada de forma visual. El esquema se mostrará como tarjetas y también se leerá en voz alta.

Elabora el esquema del documento que recibes:
- Sé fiel al documento: no añadas datos que no aparezcan en él y conserva cifras, fechas y \
nombres tal como están.
- Escribe en el idioma del documento, con frases cortas, en voz activa y con palabras sencillas. \
Si un término técnico es imprescindible, mantenlo y explícalo en «conceptos».
- «idea_principal»: una o dos frases que digan de qué trata el documento y qué es lo más importante.
- «secciones»: entre 3 y 6, en el orden del documento. Cada una con un título de pocas palabras, \
un emoji que ayude a reconocerla de un vistazo y de 2 a 5 puntos. Cada punto es una frase \
completa que se entiende sola, de 20 palabras como máximo.
- «conceptos»: hasta 8 términos clave con una definición de una frase. Lista vacía si no hay.
- Si el documento es una tarea o da instrucciones (fechas de entrega, pasos, materiales), \
recógelas en una sección propia, porque es lo que la alumna necesita para actuar.
- Texto plano, sin Markdown ni abreviaturas, porque se leerá en voz alta."""


class Seccion(BaseModel):
    titulo: str
    icono: str = Field(description="Un único emoji")
    puntos: list[str]


class Concepto(BaseModel):
    termino: str
    definicion: str


class Esquema(BaseModel):
    titulo: str
    idea_principal: str
    secciones: list[Seccion]
    conceptos: list[Concepto]


class ErrorResumen(Exception):
    pass


def clave_api() -> str | None:
    """La clave puede estar en la variable de entorno o en el archivo clave_anthropic.txt."""
    clave = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not clave:
        archivo = RAIZ / "clave_anthropic.txt"
        if archivo.exists():
            clave = archivo.read_text(encoding="utf-8").strip()
    return clave or None


def _texto_documento(titulo: str, bloques: list[dict]) -> str:
    lineas = [f"# {titulo}", ""]
    for b in bloques:
        lineas.append(f"\n## {b['texto']}\n" if b["tipo"] == "titulo" else b["texto"])
    return "\n".join(lineas)


# ------------------------------------------------------------------ con Claude

def _con_claude(titulo: str, bloques: list[dict], clave: str) -> dict:
    cliente = anthropic.Anthropic(api_key=clave)
    try:
        respuesta = cliente.beta.messages.parse(
            model=MODELO,
            max_tokens=16000,
            system=INSTRUCCIONES,
            output_config={"effort": "medium"},
            # Si el modelo principal rechaza la petición, la API la repite en otro modelo.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            messages=[{
                "role": "user",
                "content": f"<documento>\n{_texto_documento(titulo, bloques)}\n</documento>",
            }],
            output_format=Esquema,
        )
    except anthropic.AuthenticationError as e:
        raise ErrorResumen("La clave de la API de Anthropic no es válida.") from e
    except anthropic.PermissionDeniedError as e:
        raise ErrorResumen("La clave de la API no tiene permiso para usar este modelo.") from e
    except anthropic.RateLimitError as e:
        raise ErrorResumen("Se ha alcanzado el límite de uso de la API. Prueba en un minuto.") from e
    except anthropic.BadRequestError as e:
        raise ErrorResumen(f"La API ha rechazado la petición: {e.message}") from e
    except anthropic.APIStatusError as e:
        raise ErrorResumen(f"Error del servicio de Anthropic ({e.status_code}).") from e
    except anthropic.APIConnectionError as e:
        raise ErrorResumen("No hay conexión con el servicio de Anthropic.") from e

    if respuesta.stop_reason == "refusal":
        raise ErrorResumen("El modelo no ha podido resumir este documento.")
    if respuesta.stop_reason == "max_tokens" or respuesta.parsed_output is None:
        raise ErrorResumen("El resumen ha quedado incompleto.")
    return respuesta.parsed_output.model_dump() | {"origen": "ia"}


# ---------------------------------------------------------------- método local

_VACIAS = set("""a al algo algunas algunos ante antes como con contra cual cuando de del desde donde
durante e el ella ellas ellos en entre era eran es esa esas ese eso esos esta estaba estado estan
estar estas este esto estos fue fueron ha han hasta hay la las le les lo los mas más me mi mientras
muy nada ni no nos nosotros o os otra otras otro otros para pero poco por porque que qué quien se
sea ser si sí sido sin sobre son su sus también tambien tanto te tiene tienen todo todos tu tus un
una uno unas unos y ya the of and to in is are for that this with as on by an be it or from at
cada puede pueden así asi cuyo cuya hace hacer dos tres vez veces ejemplo decir dice según segun
parte partes llama llaman forma formas tipo tipos etc sólo solo aunque además ademas entonces pues mismo misma tras ser""".split())

_ICONOS = ["📘", "🧩", "🔍", "💡", "📌", "🌍", "⚙️", "✅"]


def _palabras(texto: str) -> list[str]:
    return [p for p in re.findall(r"[a-záéíóúüñ]{4,}", texto.lower()) if p not in _VACIAS]


def _frases(texto: str) -> list[str]:
    partes = re.split(r"(?<=[.!?…])\s+(?=[A-ZÁÉÍÓÚÑ¿¡\"“«(\d])", texto)
    return [p.strip() for p in partes if len(p.split()) >= 5]


def _mejores(frases: list[str], peso: Counter, n: int) -> list[str]:
    def nota(f: str) -> float:
        ps = _palabras(f)
        # Normalizar por longitud evita que ganen siempre las frases larguísimas.
        return sum(peso[p] for p in ps) / (len(ps) + 4) if ps else 0.0

    elegidas = sorted(sorted(range(len(frases)), key=lambda i: -nota(frases[i]))[:n])
    return [frases[i] if len(frases[i]) <= 230 else frases[i][:227].rsplit(" ", 1)[0] + "…"
            for i in elegidas]


def _local(titulo: str, bloques: list[dict]) -> dict:
    peso = Counter(_palabras(" ".join(b["texto"] for b in bloques)))

    # Agrupar los párrafos bajo su título; sin títulos, repartir en partes iguales.
    grupos: list[tuple[str, list[str]]] = []
    for b in bloques:
        if b["tipo"] == "titulo":
            grupos.append((b["texto"], []))
        elif grupos:
            grupos[-1][1].append(b["texto"])
        else:
            grupos.append(("Introducción", [b["texto"]]))
    grupos = [(t, ps) for t, ps in grupos if _frases(" ".join(ps))]

    if len(grupos) < 2:
        parrafos = [b["texto"] for b in bloques if b["tipo"] == "parrafo"]
        partes = min(4, max(1, len(_frases(" ".join(parrafos))) // 3))
        tam = -(-len(parrafos) // partes)
        nombres = ["Para empezar", "A continuación", "Después", "Para terminar"]
        grupos = [(nombres[i] if partes > 1 else "Lo más importante", parrafos[i * tam:(i + 1) * tam])
                  for i in range(partes)]
    elif len(grupos) > 8:
        # Demasiados apartados: quedarse con los de más contenido, en su orden.
        orden = sorted(range(len(grupos)), key=lambda i: -sum(len(p) for p in grupos[i][1]))[:8]
        grupos = [grupos[i] for i in sorted(orden)]

    secciones = []
    for i, (nombre, parrafos) in enumerate(grupos):
        frases = _frases(" ".join(parrafos))
        if frases:
            secciones.append({
                "titulo": nombre.capitalize() if nombre.isupper() else nombre,
                "icono": _ICONOS[i % len(_ICONOS)],
                "puntos": _mejores(frases, peso, 3),
            })

    todas = _frases(" ".join(b["texto"] for b in bloques if b["tipo"] == "parrafo"))
    idea = _mejores(todas[: max(4, len(todas) // 6)], peso, 1)  # la idea central suele ir al principio
    return {
        "titulo": titulo,
        "idea_principal": idea[0] if idea else titulo,
        "secciones": secciones,
        "conceptos": [{"termino": p, "definicion": ""} for p, n in peso.most_common(8) if n >= 2],
        "origen": "local",
    }


# --------------------------------------------------------------------- entrada

def resumir(titulo: str, bloques: list[dict]) -> dict:
    clave = clave_api()
    if clave:
        try:
            return _con_claude(titulo, bloques, clave)
        except ErrorResumen as e:
            return _local(titulo, bloques) | {"aviso": f"{e} Se muestra un esquema automático más sencillo."}
    return _local(titulo, bloques)
