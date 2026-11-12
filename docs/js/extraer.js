// Extracción de texto de PDF, Word (.docx) y texto plano, todo dentro del navegador.
// Devuelve { titulo, bloques }, con bloques de la forma { tipo: "titulo" | "parrafo", texto }.

const MAX_BLOQUE = 700;

/** Error con un mensaje pensado para mostrarse tal cual a la alumna. */
export class ErrorDocumento extends Error {}

/* ---------------------------------------------------------------- utilidades */

const VINETA = /^\s*(?:[•●▪■◦○·\-–—*]|\d{1,2}[.)]|[a-zA-Z][.)])\s+/;
const NUMERADO =
  /^(?:\d{1,2}(?:\.\d{1,2})*\.?|[IVXLC]{1,5}\.|tema|unidad|cap[ií]tulo|lecci[oó]n|bloque|anexo|actividad)\s+\S/i;
const FIN_FRASE = /[.!?:…]["'”»)\]]*$/;

const limpio = (t) => t.replace(/­/g, "").replace(/\s+/g, " ").trim();

/** Separa en frases sin usar «lookbehind» (Safari antiguo no lo admite). */
export function frases(texto) {
  return texto
    .replace(/([.!?…]["'”»)\]]*)\s+(?=[A-ZÁÉÍÓÚÑ¿¡"“«(\d])/g, "$1\n")
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
}

function pareceTitulo(linea) {
  linea = linea.trim();
  if (linea.length < 3 || linea.length > 80 || ".,;:".includes(linea.at(-1))) return false;
  const letras = linea.match(/\p{L}/gu) || [];
  if (letras.length < 3) return false;
  if (letras.every((c) => c === c.toUpperCase() && c !== c.toLowerCase())) return true;
  return NUMERADO.test(linea) && linea.split(/\s+/).length <= 9;
}

function trocear(texto) {
  if (texto.length <= MAX_BLOQUE) return [texto];
  const trozos = [];
  let actual = "";
  for (const frase of frases(texto)) {
    if (actual && actual.length + frase.length + 1 > MAX_BLOQUE) {
      trozos.push(actual);
      actual = frase;
    } else {
      actual = `${actual} ${frase}`.trim();
    }
  }
  if (actual) trozos.push(actual);
  return trozos;
}

function finalizar(bloques, nombre) {
  const salida = [];
  for (const b of bloques) {
    const texto = limpio(b.texto);
    if (!texto) continue;
    if (b.tipo === "titulo") salida.push({ tipo: "titulo", texto });
    else for (const t of trocear(texto)) salida.push({ tipo: "parrafo", texto: t });
  }
  if (!salida.length) throw new ErrorDocumento("El documento no contiene texto que se pueda leer.");
  const titulo =
    salida.slice(0, 5).find((b) => b.tipo === "titulo")?.texto ||
    nombre.replace(/\.[A-Za-z0-9]+$/, "").replace(/_/g, " ").trim() ||
    "Documento";
  return { titulo, bloques: salida };
}

/* ----------------------------------------------------------------------- PDF */

/** lineas: [{ texto, alto?, salto? }]. «alto» es el tamaño de letra; «salto», un hueco vertical antes. */
function lineasABloques(lineas) {
  const largos = lineas.map((l) => l.texto.trim().length).filter((n) => n > 25).sort((a, b) => a - b);
  const ancho = largos.length >= 10 ? largos[Math.floor(largos.length * 0.8)] : 0;
  const altos = lineas.map((l) => l.alto).filter(Boolean).sort((a, b) => a - b);
  const altoNormal = altos.length ? altos[Math.floor(altos.length / 2)] : 0;

  const bloques = [];
  let actual = "";
  const cerrar = () => {
    if (actual) bloques.push({ tipo: "parrafo", texto: actual });
    actual = "";
  };

  for (const l of lineas) {
    const linea = l.texto.trim();
    if (!linea) { cerrar(); continue; }
    if (l.salto) cerrar();
    // Letra claramente más grande que la del cuerpo y renglón corto: es un título.
    const letraGrande = altoNormal && l.alto > altoNormal * 1.15 && linea.length <= 90;
    if (!actual && (letraGrande || pareceTitulo(linea))) {
      bloques.push({ tipo: "titulo", texto: linea });
      continue;
    }
    if (VINETA.test(linea)) cerrar();
    if (actual.endsWith("-") && /^\p{Ll}/u.test(linea)) actual = actual.slice(0, -1) + linea;
    else actual = `${actual} ${linea}`.trim();
    if (FIN_FRASE.test(linea) && (!ancho || linea.length < 0.85 * ancho)) cerrar();
  }
  cerrar();

  return bloques;
}

async function dePdf(datos) {
  let pdfjs, pdf;
  try {
    pdfjs = await import("../vendor/pdfjs/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
    pdf = await pdfjs.getDocument({ data: datos }).promise;
  } catch (e) {
    if (e?.name === "PasswordException") {
      throw new ErrorDocumento("Este PDF está protegido con contraseña y no se puede abrir.");
    }
    throw new ErrorDocumento("No se ha podido abrir el PDF. Puede estar dañado.");
  }

  const paginas = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const pagina = await pdf.getPage(n);
    const contenido = await pagina.getTextContent();
    const lineas = [];
    let texto = "", alto = 0, y = null;
    const cerrarLinea = () => {
      if (texto.trim()) lineas.push({ texto, alto, y });
      texto = ""; alto = 0; y = null;
    };
    for (const item of contenido.items) {
      if (item.str === undefined) continue; // marcas de contenido, no texto
      if (y === null && item.str.trim()) y = item.transform[5];
      texto += item.str;
      if (item.str.trim()) alto = Math.max(alto, item.height || 0);
      if (item.hasEOL) cerrarLinea();
    }
    cerrarLinea();
    // Un hueco vertical mayor que renglón y medio indica párrafo nuevo.
    for (let i = 1; i < lineas.length; i++) {
      const hueco = lineas[i - 1].y - lineas[i].y;
      const ref = Math.max(lineas[i].alto, lineas[i - 1].alto) || 12;
      lineas[i].salto = hueco > ref * 1.9 || hueco < -ref; // hacia arriba: columna nueva
    }
    paginas.push(lineas);
  }

  const total = paginas.flat().reduce((n, l) => n + l.texto.length, 0);
  if (total < 20 * Math.max(paginas.length, 1)) {
    throw new ErrorDocumento(
      "Este PDF es una imagen escaneada y no contiene texto. " +
      "Pide que te lo pasen con reconocimiento de texto (OCR).",
    );
  }

  // Quitar encabezados y pies que se repiten en casi todas las páginas, y números de página.
  const clave = (t) => t.trim().toLowerCase().replace(/\d+/g, "#");
  const repetidas = new Set();
  if (paginas.length >= 3) {
    const cuenta = new Map();
    for (const pag of paginas) {
      const bordes = new Set([...pag.slice(0, 2), ...pag.slice(-2)].map((l) => clave(l.texto)));
      for (const k of bordes) cuenta.set(k, (cuenta.get(k) || 0) + 1);
    }
    for (const [k, n] of cuenta) if (n >= 0.6 * paginas.length && k.length < 90) repetidas.add(k);
  }
  const NUM_PAGINA = /^(?:p[aá]g(?:ina)?\.?\s*)?\d{1,4}(?:\s*(?:\/|de)\s*\d{1,4})?$/i;
  const lineas = [];
  for (const pag of paginas) {
    for (const l of pag) {
      const s = l.texto.trim();
      if (NUM_PAGINA.test(s) || repetidas.has(clave(s))) continue;
      lineas.push(l);
    }
  }
  return lineasABloques(lineas);
}

/* ---------------------------------------------------------------------- DOCX */

/** Lee un archivo de dentro de un ZIP usando el descompresor del propio navegador. */
async function leerDeZip(datos, nombre) {
  const v = new DataView(datos.buffer, datos.byteOffset, datos.byteLength);
  let fin = -1;
  for (let i = datos.length - 22; i >= Math.max(0, datos.length - 66000); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error("no es un zip");
  let pos = v.getUint32(fin + 16, true);
  const entradas = v.getUint16(fin + 10, true);
  const dec = new TextDecoder();
  for (let n = 0; n < entradas && v.getUint32(pos, true) === 0x02014b50; n++) {
    const metodo = v.getUint16(pos + 10, true);
    const comprimido = v.getUint32(pos + 20, true);
    const lNombre = v.getUint16(pos + 28, true);
    const lExtra = v.getUint16(pos + 30, true);
    const lComentario = v.getUint16(pos + 32, true);
    const local = v.getUint32(pos + 42, true);
    if (dec.decode(datos.subarray(pos + 46, pos + 46 + lNombre)) === nombre) {
      const inicio = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      const cuerpo = datos.subarray(inicio, inicio + comprimido);
      if (metodo === 0) return cuerpo;
      if (metodo !== 8 || typeof DecompressionStream === "undefined") throw new Error("compresión no admitida");
      const flujo = new Blob([cuerpo]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(flujo).arrayBuffer());
    }
    pos += 46 + lNombre + lExtra + lComentario;
  }
  throw new Error("no está en el zip");
}

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const ESTILO_TITULO = /^(heading|t[ií]?tulo|title|subt[ií]?tulo|subtitle|encabezado)/i;

async function deDocx(datos) {
  let xml;
  try {
    const bytes = await leerDeZip(datos, "word/document.xml");
    xml = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "application/xml");
    if (xml.querySelector("parsererror")) throw new Error("xml");
  } catch {
    throw new ErrorDocumento("No se ha podido abrir el documento de Word. Debe ser un archivo .docx.");
  }
  const bloques = [];
  for (const p of xml.getElementsByTagNameNS(W, "p")) {
    let texto = "";
    for (const nodo of p.getElementsByTagNameNS(W, "*")) {
      if (nodo.localName === "t") texto += nodo.textContent;
      else if (["tab", "br", "cr"].includes(nodo.localName)) texto += " ";
    }
    texto = texto.trim();
    if (!texto) continue;
    const estilo = p.getElementsByTagNameNS(W, "pStyle")[0]?.getAttributeNS(W, "val") || "";
    const esTitulo = ESTILO_TITULO.test(estilo) || pareceTitulo(texto);
    bloques.push({ tipo: esTitulo ? "titulo" : "parrafo", texto });
  }
  return bloques;
}

/* --------------------------------------------------------------- texto plano */

function deTexto(datos) {
  let texto;
  try {
    texto = new TextDecoder("utf-8", { fatal: true }).decode(datos);
  } catch {
    texto = new TextDecoder("windows-1252").decode(datos);
  }
  const bloques = [];
  for (let trozo of texto.split(/\r?\n\s*\r?\n/)) {
    trozo = trozo.trim();
    if (!trozo) continue;
    if (trozo.startsWith("#")) bloques.push({ tipo: "titulo", texto: trozo.replace(/^[#\s]+/, "") });
    else if (!trozo.includes("\n") && pareceTitulo(trozo)) bloques.push({ tipo: "titulo", texto: trozo });
    else bloques.push({ tipo: "parrafo", texto: trozo });
  }
  return bloques;
}

/* -------------------------------------------------------------------- entrada */

export async function extraer(archivo) {
  const nombre = archivo.name || "Documento";
  const ext = nombre.includes(".") ? nombre.split(".").pop().toLowerCase() : "";
  const datos = new Uint8Array(await archivo.arrayBuffer());
  const empieza = (s) => [...s].every((c, i) => datos[i] === c.charCodeAt(0));

  let bloques;
  if (empieza("%PDF") || ext === "pdf") bloques = await dePdf(datos);
  else if (ext === "docx" || (empieza("PK") && ext !== "odt")) bloques = await deDocx(datos);
  else if (["txt", "md", "text", ""].includes(ext)) bloques = deTexto(datos);
  else if (ext === "doc") {
    throw new ErrorDocumento("Los archivos .doc antiguos no se pueden leer. Hay que guardarlo como .docx o PDF.");
  } else {
    throw new ErrorDocumento(`No sé leer archivos «.${ext}». Sirven PDF, Word (.docx) y texto (.txt).`);
  }
  return finalizar(bloques, nombre);
}
