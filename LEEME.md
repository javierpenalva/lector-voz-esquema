# Lector con voz y esquema

Abre un PDF, un Word (.docx) o un archivo de texto y:

1. **lo lee en voz alta** (botón grande ▶), resaltando el párrafo que suena;
2. **genera un esquema visual** con la idea principal, tarjetas por apartado y palabras clave, que también se puede escuchar e imprimir.

Hay dos versiones en esta carpeta:

| | Versión web (`docs/`) | Versión de este Mac (`app.py`) |
|---|---|---|
| Para quién | La alumna, en su tableta o móvil | El profesorado, en este ordenador |
| Dónde funciona | Cualquier navegador, publicada en GitHub Pages | Solo en este Mac |
| Voz | La del dispositivo | Neuronal (Elvira, Álvaro, Ximena) |
| Guardar MP3 | No | Sí |
| Google Docs por enlace | No | Sí |
| Privacidad | El documento no sale del dispositivo | El texto va al servicio de voz de Microsoft |
| Sin conexión | Sí, tras la primera visita | No |

# Versión web para la alumna (`docs/`)

Es una página estática: no necesita servidor, ni cuenta, ni código de acceso.

## Publicarla en GitHub Pages

1. Subir esta carpeta a un repositorio de GitHub (tiene que ser público en las cuentas gratuitas).
2. En el repositorio: Settings → Pages → «Deploy from a branch», rama `main`, carpeta `/docs`.
3. A los pocos minutos estará en `https://USUARIO.github.io/REPOSITORIO/`.

## En la tableta o el móvil

- Abrir la dirección y usar «Añadir a pantalla de inicio» para tener el icono del Lector.
- «Elegir archivo» abre el selector del dispositivo, que también muestra Google Drive si la
  app de Drive está instalada. Los documentos de Google Docs hay que descargarlos antes como
  PDF o Word (en Docs: Compartir y exportar → Guardar como).
- **Voz más natural**: la página elige la mejor voz instalada. Se pueden instalar otras mejores:
  - iPad y iPhone: Ajustes → Accesibilidad → Contenido leído → Voces → Español → descargar
    una voz «mejorada» o «premium».
  - Android: Ajustes → Accesibilidad → Síntesis de voz → instalar los datos de voz de español.
- Para probarla en este Mac sin publicarla: `python3 -m http.server 8770` en esta carpeta y
  abrir `http://localhost:8770/docs/`.

Usa PDF.js (Mozilla, licencia Apache 2.0) para leer los PDF, incluido en `docs/vendor/pdfjs`.

# Versión de este Mac (`app.py`)

## Cómo abrirlo

Doble clic en **`Abrir Lector.command`**. Se abre solo en el navegador (`http://localhost:8765`).
Para cerrarlo, cierra la ventana de Terminal. La primera vez, macOS puede pedir confirmación:
clic derecho sobre el archivo → Abrir.

Necesita conexión a internet para la voz natural. Sin conexión lee con la voz del navegador.

## Uso

- **Espacio**: escuchar / pausar. **← →**: fragmento anterior / siguiente.
- Pulsar sobre un párrafo o un punto del esquema empieza a leer desde ahí.
- **Guardar audio (MP3)** descarga todo el documento leído, para escucharlo en el móvil o la tableta.
- **Ajustes**: voz, tamaño de letra, colores (claro, crema, oscuro) y espaciado amplio. Se recuerdan.

## Esquema redactado con IA (opcional)

Sin configurar nada, el esquema se hace con un método automático que escoge las frases más
representativas de cada apartado. Para que lo redacte Claude con frases propias en lectura fácil,
más definiciones de los términos clave, crea en esta carpeta un archivo `clave_anthropic.txt`
con una clave de la API de Anthropic (console.anthropic.com; es de pago por uso, céntimos por
documento) y vuelve a abrir el programa.

## Usarlo en la tableta o el móvil de la alumna

La tableta no puede ejecutar el programa: lo abre como página web. Hay dos formas.

**En el centro, con este Mac encendido** (misma wifi):

```bash
LECTOR_CODIGO=un-codigo LECTOR_HOST=0.0.0.0 .venv/bin/python app.py
```

y en la tableta abrir `http://IP-de-este-Mac:8765`. La wifi del centro puede impedir que
los dispositivos se vean entre sí.

**En cualquier sitio, también en casa**: publicarlo en un servicio de alojamiento.
La carpeta ya incluye el `Dockerfile` necesario. En el panel del servicio hay que definir:

- `LECTOR_CODIGO`: el código que escribirá la alumna la primera vez (se recuerda 6 meses).
  Sin código el programa se niega a arrancar en abierto.
- `ANTHROPIC_API_KEY` (opcional): para el esquema redactado con IA.

Una vez publicado, en la tableta: abrir la dirección, escribir el código y usar
«Añadir a pantalla de inicio» del navegador para tener el icono del Lector como una app más.

## Limitaciones y privacidad

- Los PDF escaneados (fotos de páginas) no contienen texto: hay que pasarles antes un OCR.
- Los `.doc` antiguos hay que guardarlos como `.docx`.
- El texto se envía al servicio de voz de Microsoft (el de «Leer en voz alta» de Edge, usado a
  través de la biblioteca no oficial edge-tts) y, si se configura la clave, a Anthropic.
  No conviene abrir documentos con datos personales del alumnado.
- Los documentos no se guardan; solo el audio generado, en la carpeta `cache_audio` (se puede borrar).
