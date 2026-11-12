"use strict";

const $ = (id) => document.getElementById(id);
const audio = $("audio");

const estado = {
  doc: null,          // { id, titulo, bloques }
  listas: { texto: [], esquema: [] },   // elementos del DOM con data-audio, en orden de lectura
  lista: "texto",
  pos: 0,
  sonando: false,
  vozNavegador: false, // true mientras lee la voz del navegador (sin internet)
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
  audio.defaultPlaybackRate = audio.playbackRate = Number(prefs.velocidad);
  localStorage.setItem("lector-prefs", JSON.stringify(prefs));
}

async function iniciarAjustes() {
  if (!localStorage.getItem("lector-prefs") && matchMedia("(prefers-color-scheme: dark)").matches) {
    prefs.tema = "oscuro";
  }
  const info = await fetch("/api/estado").then((r) => r.json());
  for (const [id, nombre] of Object.entries(info.voces)) {
    $("voz").add(new Option(nombre, id));
  }
  if (!info.voces[prefs.voz]) prefs.voz = info.voz_por_defecto;
  $("voz").value = prefs.voz;
  $("velocidad").value = prefs.velocidad;
  $("tamano").value = prefs.tamano;
  $("espaciado").checked = prefs.espaciado;
  document.querySelector(`input[name="tema"][value="${prefs.tema}"]`).checked = true;
  aplicarPrefs();

  $("abrir-ajustes").onclick = () => $("ajustes").showModal();
  $("voz").onchange = (e) => {
    prefs.voz = e.target.value;
    aplicarPrefs();
    actualizarDescarga();
    if (estado.sonando) reproducir(estado.pos); // se oye enseguida la voz nueva
  };
  $("velocidad").onchange = (e) => { prefs.velocidad = e.target.value; aplicarPrefs(); };
  $("tamano").oninput = (e) => { prefs.tamano = e.target.value; aplicarPrefs(); };
  $("espaciado").onchange = (e) => { prefs.espaciado = e.target.checked; aplicarPrefs(); };
  for (const radio of document.querySelectorAll('input[name="tema"]')) {
    radio.onchange = (e) => { prefs.tema = e.target.value; aplicarPrefs(); };
  }
}

/* ------------------------------------------------------------------ avisos */

function decir(mensaje) { $("estado").textContent = mensaje; }
function mostrarError(mensaje) {
  $("error").textContent = mensaje || "";
  $("error").hidden = !mensaje;
}

/* --------------------------------------------------------- abrir documento */

async function abrir(datos) {
  parar();
  mostrarError("");
  decir("Leyendo el documento…");
  let respuesta, cuerpo;
  try {
    respuesta = await fetch("/api/documento", { method: "POST", body: datos });
    cuerpo = await respuesta.json();
  } catch {
    decir("");
    return mostrarError("No se ha podido conectar con el lector. ¿Sigue abierto el programa?");
  }
  decir("");
  if (respuesta.status === 401) return location.assign("/entrar"); // caducó el código de acceso
  if (!respuesta.ok) return mostrarError(cuerpo.error || "No se ha podido abrir el documento.");

  estado.doc = cuerpo;
  pintarTexto();
  $("zona-carga").hidden = true;
  $("lector").hidden = false;
  $("titulo-doc").textContent = cuerpo.titulo;
  document.title = cuerpo.titulo + " · Lector";
  elegirLista("texto", 0);
  actualizarDescarga();
  $("titulo-doc").focus();
  precargar(0);
  pedirEsquema();
}

function pintarTexto() {
  const caja = $("texto");
  caja.replaceChildren();
  estado.doc.bloques.forEach((bloque, i) => {
    const el = document.createElement(bloque.tipo === "titulo" ? "h3" : "p");
    el.textContent = bloque.texto;
    el.dataset.audio = String(i);
    caja.append(el);
  });
  estado.listas.texto = [...caja.querySelectorAll("[data-audio]")];
  caja.onclick = (e) => {
    const el = e.target.closest("[data-audio]");
    if (el && !String(getSelection())) {
      elegirLista("texto");
      reproducir(estado.listas.texto.indexOf(el));
    }
  };
}

function actualizarDescarga() {
  if (!estado.doc) return;
  $("descargar").href = `/api/audio/${estado.doc.id}/completo.mp3?voz=${encodeURIComponent(prefs.voz)}`;
}

/* ------------------------------------------------------------------ esquema */

function nodo(etiqueta, clase, texto) {
  const el = document.createElement(etiqueta);
  if (clase) el.className = clase;
  if (texto != null) el.textContent = texto;
  return el;
}

async function pedirEsquema() {
  const caja = $("esquema");
  const id = estado.doc.id;
  caja.setAttribute("aria-busy", "true");
  caja.replaceChildren(nodo("p", "cargando", "Preparando el esquema…"));
  $("oir-esquema").hidden = $("imprimir").hidden = $("aviso-esquema").hidden = true;
  estado.listas.esquema = [];

  let esquema;
  try {
    const r = await fetch(`/api/resumen/${id}`, { method: "POST" });
    esquema = await r.json();
    if (!r.ok) throw new Error(esquema.error);
  } catch (e) {
    if (estado.doc?.id !== id) return;
    caja.setAttribute("aria-busy", "false");
    return caja.replaceChildren(nodo("p", "error", e.message || "No se ha podido preparar el esquema."));
  }
  if (estado.doc?.id !== id) return; // mientras tanto se abrió otro documento

  const idea = nodo("p", "idea");
  idea.append(nodo("strong", "", "Idea principal"), esquema.idea_principal);
  idea.dataset.audio = "r" + esquema.audio_idea;

  const ramas = nodo("ul", "ramas");
  for (const s of esquema.secciones) {
    const rama = nodo("li", "rama");
    const h = nodo("h3");
    h.append(nodo("span", "icono", s.icono), nodo("span", "", s.titulo));
    h.firstChild.setAttribute("aria-hidden", "true");
    h.dataset.audio = "r" + s.audio;
    const puntos = nodo("ul");
    for (const p of s.puntos) {
      const li = nodo("li", "", p.texto);
      li.dataset.audio = "r" + p.audio;
      puntos.append(li);
    }
    rama.append(h, puntos);
    ramas.append(rama);
  }
  caja.replaceChildren(idea, nodo("div", "tronco"), ramas);
  caja.querySelector(".tronco").setAttribute("aria-hidden", "true");

  if (esquema.conceptos.length) {
    const bloque = nodo("div", "conceptos");
    bloque.append(nodo("h3", "", "Palabras clave"));
    if (esquema.conceptos.some((c) => c.definicion)) {
      const dl = nodo("dl");
      for (const c of esquema.conceptos) {
        const fila = nodo("div");
        fila.append(nodo("dt", "", c.termino), nodo("dd", "", c.definicion));
        if (c.audio != null) fila.dataset.audio = "r" + c.audio;
        dl.append(fila);
      }
      bloque.append(dl);
    } else {
      const ul = nodo("ul", "etiquetas");
      for (const c of esquema.conceptos) ul.append(nodo("li", "", c.termino));
      bloque.append(ul);
    }
    caja.append(bloque);
  }

  const aviso = esquema.aviso || (esquema.origen === "local"
    ? "Esquema automático: reúne las frases más importantes del propio documento."
    : "");
  $("aviso-esquema").textContent = aviso;
  $("aviso-esquema").hidden = !aviso;

  estado.listas.esquema = [...caja.querySelectorAll("[data-audio]")];
  caja.onclick = (e) => {
    const el = e.target.closest("[data-audio]");
    if (el && !String(getSelection())) {
      elegirLista("esquema");
      reproducir(estado.listas.esquema.indexOf(el));
    }
  };
  caja.setAttribute("aria-busy", "false");
  $("oir-esquema").hidden = $("imprimir").hidden = false;
  decir("");
}

/* -------------------------------------------------------------- reproductor */

const lista = () => estado.listas[estado.lista];
const urlAudio = (el) =>
  `/api/audio/${estado.doc.id}/${el.dataset.audio}?voz=${encodeURIComponent(prefs.voz)}`;

function precargar(pos) {
  const el = lista()[pos];
  if (el) fetch(urlAudio(el)).catch(() => {});
}

function elegirLista(nombre, pos) {
  if (estado.lista !== nombre) { parar(); estado.lista = nombre; estado.pos = 0; }
  if (pos != null) estado.pos = pos;
  pintarEstado();
}

function pintarEstado() {
  document.querySelectorAll(".sonando").forEach((el) => el.classList.remove("sonando"));
  const total = lista().length;
  const que = estado.lista === "esquema" ? "Esquema" : "Texto";
  $("progreso").max = Math.max(total, 1);
  $("progreso").value = estado.sonando ? estado.pos + 1 : estado.pos;
  $("play-icono").textContent = estado.sonando ? "⏸" : "▶";
  $("play").setAttribute("aria-label", estado.sonando ? "Pausar" : "Escuchar");
  if (estado.sonando && lista()[estado.pos]) {
    const el = lista()[estado.pos];
    el.classList.add("sonando");
    const mov = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    el.scrollIntoView({ block: "center", behavior: mov });
    $("que-suena").textContent = `${que}: fragmento ${estado.pos + 1} de ${total}`;
  } else if (estado.pos > 0 && estado.pos < total) {
    $("que-suena").textContent = `En pausa. ${que}: fragmento ${estado.pos + 1} de ${total}`;
  } else {
    $("que-suena").textContent = "Pulsa el botón para escuchar";
  }
}

function reproducir(pos) {
  if (!estado.doc) return;
  const total = lista().length;
  if (pos >= total) { // fin de la lectura
    estado.sonando = false;
    estado.pos = 0;
    pintarEstado();
    $("que-suena").textContent = "Fin de la lectura";
    return;
  }
  estado.pos = Math.max(0, pos);
  estado.sonando = true;
  estado.vozNavegador = false;
  speechSynthesis?.cancel();
  mostrarError("");
  pintarEstado();
  audio.src = urlAudio(lista()[estado.pos]);
  audio.playbackRate = Number(prefs.velocidad);
  audio.play().catch(() => {}); // si falla la carga, salta el evento «error»
  precargar(estado.pos + 1);
}

function parar() {
  estado.sonando = false;
  audio.pause();
  speechSynthesis?.cancel();
  pintarEstado();
}

function alternar() {
  if (!estado.doc) return;
  if (estado.sonando) return parar();
  // Reanudar por donde iba si el audio estaba en pausa a mitad de fragmento.
  if (audio.src && audio.paused && !audio.ended && audio.currentTime > 0 && !estado.vozNavegador) {
    estado.sonando = true;
    pintarEstado();
    audio.play().catch(() => reproducir(estado.pos));
  } else {
    reproducir(estado.pos);
  }
}

audio.addEventListener("ended", () => { if (estado.sonando) reproducir(estado.pos + 1); });
audio.addEventListener("loadedmetadata", () => {
  // Fragmento sin nada que pronunciar: pasar al siguiente.
  if (estado.sonando && !(audio.duration > 0)) reproducir(estado.pos + 1);
});
audio.addEventListener("error", () => {
  if (!estado.sonando) return;
  // Sin internet no hay voz natural: leer con la voz del propio navegador.
  const el = lista()[estado.pos];
  if (!("speechSynthesis" in window) || !el) {
    parar();
    return mostrarError("No se ha podido generar la voz. Comprueba la conexión a internet.");
  }
  mostrarError("Sin conexión con la voz natural. Se usa la voz del navegador.");
  estado.vozNavegador = true;
  const frase = new SpeechSynthesisUtterance(el.textContent);
  frase.lang = prefs.voz.slice(0, 5);
  frase.rate = Number(prefs.velocidad);
  frase.onend = () => { if (estado.sonando && estado.vozNavegador) reproducir(estado.pos + 1); };
  speechSynthesis.speak(frase);
});

/* ------------------------------------------------------------------ eventos */

$("play").onclick = alternar;
$("anterior").onclick = () => reproducir(estado.pos - 1);
$("siguiente").onclick = () => reproducir(estado.pos + 1);
$("oir-texto").onclick = () => { elegirLista("texto"); reproducir(0); };
$("oir-esquema").onclick = () => { elegirLista("esquema"); reproducir(0); };
$("imprimir").onclick = () => print();
$("otro").onclick = () => {
  parar();
  estado.doc = null;
  $("lector").hidden = true;
  $("zona-carga").hidden = false;
  $("archivo").value = "";
  document.title = "Lector con voz y esquema";
  $("t-carga").scrollIntoView();
  $("archivo").focus();
};

function enviarArchivo(archivo) {
  if (!archivo) return;
  const datos = new FormData();
  datos.append("archivo", archivo);
  abrir(datos);
}
$("archivo").onchange = (e) => enviarArchivo(e.target.files[0]);
$("form-google").onsubmit = (e) => {
  e.preventDefault();
  const url = $("url-google").value.trim();
  if (!url) return mostrarError("Pega primero el enlace del documento de Google Docs.");
  const datos = new FormData();
  datos.append("url", url);
  abrir(datos);
};

const zona = $("soltar");
for (const tipo of ["dragenter", "dragover"]) {
  addEventListener(tipo, (e) => { e.preventDefault(); zona.classList.add("encima"); });
}
for (const tipo of ["dragleave", "drop"]) {
  addEventListener(tipo, (e) => { e.preventDefault(); zona.classList.remove("encima"); });
}
addEventListener("drop", (e) => enviarArchivo(e.dataTransfer?.files[0]));

addEventListener("keydown", (e) => {
  if (!estado.doc || $("ajustes").open || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest("input, select, textarea, button, a, [contenteditable]")) return;
  if (e.code === "Space") { e.preventDefault(); alternar(); }
  else if (e.key === "ArrowRight") reproducir(estado.pos + 1);
  else if (e.key === "ArrowLeft") reproducir(estado.pos - 1);
});

iniciarAjustes();
