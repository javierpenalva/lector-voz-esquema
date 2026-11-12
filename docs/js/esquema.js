// Esquema automático: elige las frases más representativas de cada apartado del documento.
// No usa internet ni inteligencia artificial; el documento no sale del dispositivo.

import { frases as separarFrases } from "./extraer.js";

const VACIAS = new Set(`a al algo algunas algunos ante antes como con contra cual cuando de del desde donde
durante e el ella ellas ellos en entre era eran es esa esas ese eso esos esta estaba estado estan
estar estas este esto estos fue fueron ha han hasta hay la las le les lo los mas más me mi mientras
muy nada ni no nos nosotros o os otra otras otro otros para pero poco por porque que qué quien se
sea ser si sí sido sin sobre son su sus también tambien tanto te tiene tienen todo todos tu tus un
una uno unas unos y ya the of and to in is are for that this with as on by an be it or from at
cada puede pueden así asi cuyo cuya hace hacer dos tres vez veces ejemplo decir dice según segun
parte partes llama llaman forma formas tipo tipos etc sólo solo aunque además ademas entonces pues
mismo misma tras was were which their have has had not but they them there what when will would
les des une dans pour que qui sur avec est sont pas plus par aux ces cette`.split(/\s+/));

const ICONOS = ["📘", "🧩", "🔍", "💡", "📌", "🌍", "⚙️", "✅"];

const palabras = (texto) =>
  (texto.toLowerCase().match(/[a-záéíóúüñàèìòùâêîôûç]{4,}/g) || []).filter((p) => !VACIAS.has(p));

const frasesUtiles = (texto) => separarFrases(texto).filter((f) => f.split(/\s+/).length >= 5);

function mejores(frases, peso, n) {
  const nota = (f) => {
    const ps = palabras(f);
    // Dividir por la longitud evita que ganen siempre las frases larguísimas.
    return ps.length ? ps.reduce((s, p) => s + (peso.get(p) || 0), 0) / (ps.length + 4) : 0;
  };
  return frases
    .map((f, i) => ({ f, i, nota: nota(f) }))
    .sort((a, b) => b.nota - a.nota)
    .slice(0, n)
    .sort((a, b) => a.i - b.i)
    .map(({ f }) => (f.length <= 230 ? f : f.slice(0, 227).replace(/\s+\S*$/, "") + "…"));
}

export function crearEsquema(titulo, bloques) {
  const peso = new Map();
  for (const p of palabras(bloques.map((b) => b.texto).join(" "))) peso.set(p, (peso.get(p) || 0) + 1);

  // Agrupar los párrafos bajo su título.
  let grupos = [];
  for (const b of bloques) {
    if (b.tipo === "titulo") grupos.push({ nombre: b.texto, parrafos: [] });
    else if (grupos.length) grupos.at(-1).parrafos.push(b.texto);
    else grupos.push({ nombre: "Introducción", parrafos: [b.texto] });
  }
  grupos = grupos.filter((g) => frasesUtiles(g.parrafos.join(" ")).length);

  if (grupos.length < 2) {
    // Documento sin apartados: repartirlo en partes iguales.
    const parrafos = bloques.filter((b) => b.tipo === "parrafo").map((b) => b.texto);
    const partes = Math.min(4, Math.max(1, Math.floor(frasesUtiles(parrafos.join(" ")).length / 3)));
    const tam = Math.ceil(parrafos.length / partes);
    const nombres = ["Para empezar", "A continuación", "Después", "Para terminar"];
    grupos = Array.from({ length: partes }, (_, i) => ({
      nombre: partes > 1 ? nombres[i] : "Lo más importante",
      parrafos: parrafos.slice(i * tam, (i + 1) * tam),
    }));
  } else if (grupos.length > 8) {
    // Demasiados apartados: quedarse con los de más contenido, en su orden.
    const largo = (g) => g.parrafos.reduce((n, p) => n + p.length, 0);
    const elegidos = new Set([...grupos].sort((a, b) => largo(b) - largo(a)).slice(0, 8));
    grupos = grupos.filter((g) => elegidos.has(g));
  }

  const secciones = [];
  grupos.forEach((g, i) => {
    const fs = frasesUtiles(g.parrafos.join(" "));
    if (!fs.length) return;
    const nombre = g.nombre === g.nombre.toUpperCase()
      ? g.nombre.charAt(0) + g.nombre.slice(1).toLowerCase()
      : g.nombre;
    secciones.push({ titulo: nombre, icono: ICONOS[i % ICONOS.length], puntos: mejores(fs, peso, 3) });
  });

  const todas = frasesUtiles(bloques.filter((b) => b.tipo === "parrafo").map((b) => b.texto).join(" "));
  // La idea central suele estar al principio del documento.
  const idea = mejores(todas.slice(0, Math.max(4, Math.floor(todas.length / 6))), peso, 1)[0] || titulo;
  const conceptos = [...peso].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p]) => p);

  return { titulo, idea, secciones, conceptos };
}

/** Idioma probable del documento («es», «en» o «fr»), para elegir la voz adecuada. */
export function idiomaDe(bloques) {
  const texto = " " + bloques.slice(0, 40).map((b) => b.texto).join(" ").toLowerCase() + " ";
  const contar = (lista) => lista.reduce((n, p) => n + texto.split(` ${p} `).length - 1, 0);
  const puntos = {
    es: contar(["el", "la", "los", "las", "de", "que", "y", "en", "una", "es", "por", "con"]),
    en: contar(["the", "of", "and", "to", "in", "is", "that", "it", "for", "with", "are", "was"]),
    fr: contar(["le", "les", "des", "et", "est", "une", "dans", "pour", "qui", "du", "au", "ce"]),
  };
  return Object.entries(puntos).sort((a, b) => b[1] - a[1])[0][0];
}
