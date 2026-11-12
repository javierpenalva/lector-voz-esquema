#!/bin/zsh
# Doble clic para abrir el Lector con voz y esquema.
cd "$(dirname "$0")" || exit 1
if [ ! -x .venv/bin/python ]; then
  echo "Preparando el programa por primera vez (tarda un minuto)…"
  python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt || {
    echo "No se ha podido instalar. Hace falta Python 3 (python.org) y conexión a internet."
    read -k 1 "?Pulsa una tecla para cerrar."; exit 1
  }
fi
exec .venv/bin/python app.py
