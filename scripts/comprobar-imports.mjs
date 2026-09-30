// Comprobación estática: que todo símbolo usado exista en su módulo de origen.
// Los errores de nombres no los pilla node --check (son errores de ejecución),
// así que se buscan a mano sobre el código de cada carpeta.
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/");
const carpetas = ["src", "test", "scripts", "public/js", "public/js/admin", "public/js/client"];

/** En Windows path.join devuelve barras invertidas; aquí se normaliza todo. */
const norm = (ruta) => ruta.replace(/\\/g, "/");

/** Nombres exportados por cada fichero del proyecto. */
const exportados = new Map();
const ficheros = [];

async function recorrer(carpeta) {
  let entradas;
  try {
    entradas = await readdir(carpeta, { withFileTypes: true });
  } catch {
    return; // la carpeta no existe: no pasa nada
  }
  for (const entrada of entradas) {
    const completa = path.join(carpeta, entrada.name);
    if (entrada.isDirectory()) {
      await recorrer(completa);
    } else if (entrada.name.endsWith(".js") || entrada.name.endsWith(".mjs")) {
      ficheros.push(completa);
    }
  }
}

for (const carpeta of carpetas) {
  await recorrer(path.join(raiz, carpeta));
}

for (const fichero of ficheros) {
  const codigo = await readFile(fichero, "utf8");
  const nombres = new Set();
  for (const m of codigo.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g)) nombres.add(m[1]);
  for (const m of codigo.matchAll(/export\s+(?:const|let|var|class)\s+([A-Za-z0-9_$]+)/g)) nombres.add(m[1]);
  for (const m of codigo.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const parte of m[1].split(",")) {
      const alias = parte.split(/\s+as\s+/);
      nombres.add((alias[1] || alias[0]).trim());
    }
  }
  exportados.set(norm(fichero), nombres);
}

const problemas = [];

/** Convierte la ruta a una clave comparable sin barras. */
const clave = (f) => f.replace(/\\/g, "/").replace(`${raiz}/`, "");

/**
 * Un módulo externo (node:fs, express, @prisma/client) no se comprueba: no
 * lleva "/" ni resuelve dentro del proyecto.
 */
const esExterno = (destino) => !destino.includes("/") || destino.startsWith("node:");

for (const fichero of ficheros) {
  const codigo = await readFile(fichero, "utf8");
  const dir = path.dirname(fichero);

  for (const m of codigo.matchAll(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g)) {
    // Un import que no es relativo se resuelve tal cual; sólo se comprueban
    // los que empiezan por "./" o "../".
    if (!m[2].startsWith(".")) {
      continue;
    }
    const destino = norm(path.resolve(dir, m[2]));
    if (esExterno(destino)) {
      continue;
    }
    if (!exportados.has(destino)) {
      problemas.push(`${clave(fichero)} importa de un fichero que no existe: ${m[2]}`);
      continue;
    }
    const disponibles = exportados.get(destino);
    for (const parte of m[1].split(",")) {
      const limpio = parte.split(/\s+as\s+/)[0].trim();
      if (limpio && !disponibles.has(limpio)) {
        problemas.push(
          `${clave(fichero)} importa "${limpio}" de ${m[2]}, que no lo exporta (exporta: ${[...disponibles].join(", ")})`
        );
      }
    }
  }
}

if (problemas.length === 0) {
  console.log(`\n${ficheros.length} ficheros comprobados: todos los imports existen.\n`);
} else {
  console.log(`\n${problemas.length} PROBLEMAS:\n`);
  for (const problema of problemas) {
    console.log("  - " + problema);
  }
  console.log();
}
process.exit(problemas.length === 0 ? 0 : 1);
