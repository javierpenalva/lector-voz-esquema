// Lector con voz y esquema: versión que funciona entera en el navegador (sin servidor).

import { extraer, frases, ErrorDocumento } from "./extraer.js";
import { crearEsquema, idiomaDe } from "./esquema.js";

const $ = (id) => document.getElementById(id);
const sintesis = window.speechSynthesis;

const estado = {
  doc: null,                              // { titulo, bloques, idioma }
  listas: { texto: [], esquema: [] },     // elementos con [data-leer], en orden de lectura
  lista: "texto",
  pos: 0,        // fragmento (párrafo o punto del esquema)
  frase: 0,      // frase dentro del fragmento: permite pausar y seguir por donde iba
  sonando: false,
  turno: 0,      // invalida los avisos de locuciones ya canceladas
  locucion: null, // referencia viva: algunos navegadores la descartan y no avisan del final
};

/* ------------------------------------------------------------ preferencias */

const prefs = Object.assign(
  { voz: "", velocidad: "1", tamano: "20", tema: "claro", espaciado: false },
  JSON.parse(localStorage.getItem("lector-prefs") || "{}"),
);

function aplicarPrefs() {
  document.documentElement.style.setProperty("--tam", prefs.tamano + "px");
  document.documentElement.dataset.tema = prefs.tema;
  document.documentElement.classList.toggle("espaciado", prefs.espaciado);
  localStorage.setItem("lector-prefs", JSON.stringify(prefs));
}

/* -------------------------------------------------------------------- voces */

let voces = [];

/** Cuanto más alta la nota, más natural suele sonar la voz. */
function notaVoz(v, idioma) {
  const nombre = v.name.toLowerCase();
  const lang = v.lang.replace("_", "-").toLowerCase();
  if (!lang.startsWith(idioma)) return -1;
  let nota = 0;
  if (/natural|neural/.test(nombre)) nota += 50;
  if (/premium/.test(nombre)) nota += 40;
  if (/enhanced|mejorad/.test(nombre)) nota += 30;
  if (/google|siri/.test(nombre)) nota += 20;
  if (/compact|eloquence|espeak|grandma|grandpa|rocko|shelley|sandy|reed|flo|eddy/.test(nombre)) nota -= 30;
  if ({ es: "es-es", en: "en-gb", fr: "fr-fr" }[idioma] === lang) nota += 10; // variante del centro
  if (v.default) nota += 2;
  return nota;
}

function vozPara(idioma) {
  const elegida = voces.find((v) => v.name === prefs.voz);
  if (elegida && notaVoz(elegida, idioma) >= 0) return elegida;
  return voces
    .map((v) => ({ v, nota: notaVoz(v, idioma) }))
    .filter((x) => x.nota >= 0)
    .sort((a, b) => b.nota - a.nota)[0]?.v || null;
}

function cargarVoces() {
  voces = sintesis ? sintesis.getVoices() : [];
  const idioma = estado.doc?.idioma || "es";
  const lista = $("voz");
  lista.replaceChildren(new Option("Automática (la mejor de este dispositivo)", ""));
  const ordenadas = voces
    .map((v) => ({ v, nota: notaVoz(v, idioma) }))
    .filter((x) => x.nota >= 0)
    .sort((a, b) => b.nota - a.nota);
  for (const { v } of ordenadas) lista.add(new Option(`${v.name} (${v.lang})`, v.name));
  lista.value = ordenadas.some((x) => x.v.name === prefs.voz) ? prefs.voz : "";
}

/* ------------------------------------------------------------------ avisos */

const decir = (mensaje) => { $("estado").textContent = mensaje; };
function mostrarError(mensaje) {
  $("error").textContent = mensaje || "";
  $("error").hidden = !mensaje;
}

/* --------------------------------------------------------- abrir documento */

async function abrir(archivo) {
  if (!archivo) return;
  parar();
  mostrarError("");
  decir("Leyendo el documento…");
  let doc;
  try {
    doc = await extraer(archivo);
  } catch (e) {
    decir("");
    console.error(e);
    return mostrarError(e instanceof ErrorDocumento ? e.message : "No se ha podido abrir el documento.");
  }
  decir("");
  doc.idioma = idiomaDe(doc.bloques);
  estado.doc = doc;
  cargarVoces();

  pintarTexto();
  pintarEsquema(crearEsquema(doc.titulo, doc.bloques));
  $("zona-carga").hidden = true;
  $("lector").hidden = false;
  $("lector").lang = doc.idioma;
  $("titulo-doc").textContent = doc.titulo;
  document.title = doc.titulo + " · Lector";
  estado.lista = "texto";
  estado.pos = estado.frase = 0;
  pintarEstado();
  $("titulo-doc").focus();
  if (!sintesis) mostrarError("Este navegador no puede leer en voz alta. Prueba con Chrome, Safari o Edge.");
}

function nodo(etiqueta, clase, texto) {
  const el = document.createElement(etiqueta);
  if (clase) el.className = clase;
  if (texto != null) el.textContent = texto;
  return el;
}

/** Marca un elemento como fragmento que se puede escuchar. */
function legible(el, textoHablado) {
  el.dataset.leer = textoHablado ?? el.textContent;
  return el;
}

function alPulsar(caja, nombreLista) {
  caja.onclick = (e) => {
    const el = e.target.closest("[data-leer]");
    if (!el || String(getSelection())) return; // no interrumpir si está seleccionando texto
    estado.lista = nombreLista;
    reproducir(estado.listas[nombreLista].indexOf(el));
  };
}

function pintarTexto() {
  const caja = $("texto");
  caja.replaceChildren(
    ...estado.doc.bloques.map((b) => legible(nodo(b.tipo === "titulo" ? "h3" : "p", "", b.texto))),
  );
  estado.listas.texto = [...caja.children];
  alPulsar(caja, "texto");
}

function pintarEsquema(esquema) {
  const caja = $("esquema");
  const idea = nodo("p", "idea");
  idea.append(nodo("strong", "", "Idea principal"), esquema.idea);
  legible(idea, `Idea principal. ${esquema.idea}`);

  const tronco = nodo("div", "tronco");
  tronco.setAttribute("aria-hidden", "true");

  const ramas = nodo("ul", "ramas");
  for (const s of esquema.secciones) {
    const rama = nodo("li", "rama");
    const h = nodo("h3");
    const icono = nodo("span", "icono", s.icono);
    icono.setAttribute("aria-hidden", "true");
    h.append(icono, nodo("span", "", s.titulo));
    legible(h, s.titulo + ".");
    const puntos = nodo("ul");
    puntos.append(...s.puntos.map((p) => legible(nodo("li", "", p))));
    rama.append(h, puntos);
    ramas.append(rama);
  }
  caja.replaceChildren(idea, tronco, ramas);

  if (esquema.conceptos.length) {
    const bloque = nodo("div", "conceptos");
    const lista = nodo("ul", "etiquetas");
    lista.append(...esquema.conceptos.map((c) => nodo("li", "", c)));
    bloque.append(nodo("h3", "", "Palabras clave"), lista);
    caja.append(bloque);
  }
  estado.listas.esquema = [...caja.querySelectorAll("[data-leer]")];
  alPulsar(caja, "esquema");
}

/* -------------------------------------------------------------- reproductor */

const lista = () => estado.listas[estado.lista];

/** Trozos cortos: algunos navegadores cortan las locuciones de más de unos 15 segundos. */
function trozosDe(texto) {
  const limpio = texto
    .replace(/https?:\/\/\S+|www\.\S+/g, " enlace web ")
    .replace(/[_*#|<>{}\[\]\\^~`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const salida = [];
  for (const frase of frases(limpio)) {
    if (frase.length <= 220) { salida.push(frase); continue; }
    let actual = "";
    // Frase muy larga: partirla por las comas (sin «lookbehind», que Safari antiguo no admite).
    const partes = frase.replace(/([,;:])\s+/g, "$1\n").replace(/\s+(?=[(–—])/g, "\n").split("\n");
    for (const parte of partes) {
      if (actual && actual.length + parte.length > 200) { salida.push(actual); actual = parte; }
      else actual = `${actual} ${parte}`.trim();
    }
    if (actual) salida.push(actual);
  }
  return salida.filter((t) => /[\p{L}\p{N}]/u.test(t));
}

function pintarEstado() {
  document.querySelectorAll(".sonando").forEach((el) => el.classList.remove("sonando"));
  const total = lista().length;
  const que = estado.lista === "esquema" ? "Esquema" : "Texto";
  $("progreso").max = Math.max(total, 1);
  $("progreso").value = estado.sonando ? estado.pos + 1 : estado.pos;
  $("play-icono").textContent = estado.sonando ? "⏸" : "▶";
  $("play").setAttribute("aria-label", estado.sonando ? "Pausar" : "Escuchar");
  const el = lista()[estado.pos];
  if (estado.sonando && el) {
    el.classList.add("sonando");
    const suave = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: suave ? "smooth" : "auto" });
    $("que-suena").textContent = `${que}: fragmento ${estado.pos + 1} de ${total}`;
  } else if ((estado.pos > 0 || estado.frase > 0) && estado.pos < total) {
    $("que-suena").textContent = `En pausa. ${que}: fragmento ${estado.pos + 1} de ${total}`;
  } else {
    $("que-suena").textContent = "Pulsa el botón para escuchar";
  }
}

function reproducir(pos, frase = 0) {
  if (!estado.doc || !sintesis) return;
  estado.turno++;
  sintesis.cancel();
  if (pos >= lista().length) { // fin de la lectura
    estado.sonando = false;
    estado.pos = estado.frase = 0;
    pintarEstado();
    $("que-suena").textContent = "Fin de la lectura";
    return;
  }
  estado.pos = Math.max(0, pos);
  estado.frase = frase;
  estado.sonando = true;
  mostrarError("");
  pintarEstado();
  hablar();
}

function hablar() {
  const el = lista()[estado.pos];
  const trozos = trozosDe(el.dataset.leer);
  if (estado.frase >= trozos.length) return reproducir(estado.pos + 1);

  const voz = vozPara(estado.doc.idioma);
  if (!voz && !voces.length && !sintesis.getVoices().length) {
    parar();
    return mostrarError("Este dispositivo no tiene voces instaladas para leer en voz alta.");
  }
  const turno = estado.turno;
  const u = new SpeechSynthesisUtterance(trozos[estado.frase]);
  if (voz) u.voice = voz;
  u.lang = voz?.lang || { es: "es-ES", en: "en-GB", fr: "fr-FR" }[estado.doc.idioma];
  u.rate = Number(prefs.velocidad);
  u.onend = () => {
    if (turno !== estado.turno || !estado.sonando) return;
    estado.frase++;
    hablar();
  };
  u.onerror = (e) => {
    if (turno !== estado.turno || e.error === "interrupted" || e.error === "canceled") return;
    parar();
    mostrarError(
      e.error === "not-allowed"
        ? "El navegador ha bloqueado la voz. Pulsa otra vez el botón de escuchar."
        : "La voz ha fallado. Prueba con otra voz en Ajustes.",
    );
  };
  estado.locucion = u;
  sintesis.speak(u);
}

function parar() {
  estado.sonando = false;
  estado.turno++;
  sintesis?.cancel();
  pintarEstado();
}

function alternar() {
  if (!estado.doc) return;
  if (estado.sonando) parar();
  else reproducir(estado.pos, estado.frase); // sigue en la frase donde se quedó
}

/* ------------------------------------------------------------------ eventos */

$("play").onclick = alternar;
$("anterior").onclick = () => reproducir(estado.pos - 1);
$("siguiente").onclick = () => reproducir(estado.pos + 1);
$("oir-texto").onclick = () => { estado.lista = "texto"; reproducir(0); };
$("oir-esquema").onclick = () => { estado.lista = "esquema"; reproducir(0); };
$("imprimir").onclick = () => print();
$("otro").onclick = () => {
  parar();
  estado.doc = null;
  $("lector").hidden = true;
  $("zona-carga").hidden = false;
  $("archivo").value = "";
  document.title = "Lector con voz y esquema";
  $("archivo").focus();
};

$("archivo").onchange = (e) => abrir(e.target.files[0]);
const zona = $("soltar");
for (const tipo of ["dragenter", "dragover"]) {
  addEventListener(tipo, (e) => { e.preventDefault(); zona.classList.add("encima"); });
}
for (const tipo of ["dragleave", "drop"]) {
  addEventListener(tipo, (e) => { e.preventDefault(); zona.classList.remove("encima"); });
}
addEventListener("drop", (e) => abrir(e.dataTransfer?.files[0]));

addEventListener("keydown", (e) => {
  if (!estado.doc || $("ajustes").open || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest("input, select, textarea, button, a, [contenteditable]")) return;
  if (e.code === "Space") { e.preventDefault(); alternar(); }
  else if (e.key === "ArrowRight") reproducir(estado.pos + 1);
  else if (e.key === "ArrowLeft") reproducir(estado.pos - 1);
});

// Al salir de la página, que la voz no siga sonando sola.
addEventListener("pagehide", () => sintesis?.cancel());

/* ------------------------------------------------------------------ ajustes */

$("abrir-ajustes").onclick = () => $("ajustes").showModal();
$("voz").onchange = (e) => {
  prefs.voz = e.target.value;
  aplicarPrefs();
  if (estado.sonando) reproducir(estado.pos, estado.frase); // se oye enseguida la voz nueva
};
$("probar-voz").onclick = () => {
  if (!sintesis) return;
  parar();
  const idioma = estado.doc?.idioma || "es";
  const u = new SpeechSynthesisUtterance(
    { es: "Hola. Así suena esta voz cuando leo un documento.",
      en: "Hello. This is how this voice sounds when I read a document.",
      fr: "Bonjour. Voici comment sonne cette voix quand je lis un document." }[idioma],
  );
  const voz = vozPara(idioma);
  if (voz) { u.voice = voz; u.lang = voz.lang; } else u.lang = idioma;
  u.rate = Number(prefs.velocidad);
  estado.locucion = u;
  sintesis.speak(u);
};
$("velocidad").onchange = (e) => {
  prefs.velocidad = e.target.value;
  aplicarPrefs();
  if (estado.sonando) reproducir(estado.pos, estado.frase);
};
$("tamano").oninput = (e) => { prefs.tamano = e.target.value; aplicarPrefs(); };
$("espaciado").onchange = (e) => { prefs.espaciado = e.target.checked; aplicarPrefs(); };
for (const radio of document.querySelectorAll('input[name="tema"]')) {
  radio.onchange = (e) => { prefs.tema = e.target.value; aplicarPrefs(); };
}

if (!localStorage.getItem("lector-prefs") && matchMedia("(prefers-color-scheme: dark)").matches) {
  prefs.tema = "oscuro";
}
$("velocidad").value = prefs.velocidad;
$("tamano").value = prefs.tamano;
$("espaciado").checked = prefs.espaciado;
document.querySelector(`input[name="tema"][value="${prefs.tema}"]`).checked = true;
aplicarPrefs();
cargarVoces();
sintesis?.addEventListener?.("voiceschanged", cargarVoces); // las voces llegan con retraso

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// Solo para pruebas desde la consola del navegador.
window.lector = { abrir, estado, parar, reproducir };
