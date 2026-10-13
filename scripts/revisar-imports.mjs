/**
 * Comprueba que TODOS los imports relativos del proyecto resuelven.
 *
 * Por que existe: los tests unitarios y las pruebas de humo importan `server.js` y
 * los services, pero casi nunca `index.js` ni `src/jobs/*`. Un import mal escrito en
 * un archivo que nadie carga durante las pruebas no se ve hasta que alguien ejecuta
 * `npm start` y el proceso no arranca.
 *
 * Uso:  node scripts/revisar-imports.mjs
 */
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const RAIZ = resolve(import.meta.dirname, '..');
const IGNORAR = new Set(['node_modules', '.git', 'coverage', 'prisma/dev.db']);

function Walk(dir, salida = []) {
  for (const entrada of readdirSync(dir)) {
    if (IGNORAR.has(entrada)) continue;

    const ruta = join(dir, entrada);

    if (statSync(ruta).isDirectory()) {
      Walk(ruta, salida);
    } else if (entrada.endsWith('.js') || entrada.endsWith('.mjs')) {
      salida.push(ruta);
    }
  }

  return salida;
}

const archivos = Walk(RAIZ);
const rotos = [];

/** Node acepta `import ... from 'x'` estaticos, `export ... from 'x'` y `import('x')`. */
const PATRONES = [
  /(?:^|\n)\s*(?:import|export)\b[^'"\n]*?from\s*['"](\.[^'"]+)['"]/g,
  /(?:^|\n)\s*import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
  /(?:^|\n)\s*import\s+['"](\.[^'"]+)['"]/g,
];

for (const archivo of archivos) {
  const fuente = readFileSync(archivo, 'utf8');
  const dir = dirname(archivo);
  const vistos = new Set();

  for (const patron of PATRONES) {
    patron.lastIndex = 0;

    for (const coincidencia of fuente.matchAll(patron)) {
      const especificacion = coincidencia[1];

      if (vistos.has(especificacion)) continue;
      vistos.add(especificacion);

      const destino = resolve(dir, especificacion);

      if (!existsSync(destino)) {
        rotos.push({ archivo: relative(RAIZ, archivo), especificacion, destino: relative(RAIZ, destino) });
      }
    }
  }
}

console.log(`Revisados ${archivos.length} archivos.`);

if (rotos.length === 0) {
  console.log('Todos los imports relativos resuelven.\n');
  process.exit(0);
}

console.log(`\n${rotos.length} imports rotos:\n`);

for (const { archivo, especificacion, destino } of rotos) {
  /// Se calcula el nivel correcto: cuantos `../` hay que añadir para llegar a la raiz.
  const arriba = '..'.repeat(relative(RAIZ, dirname(join(RAIZ, archivo))).split('sep').length);
  const arreglo = `${arriba}/${especificacion.replace(/^\.\//, '')}`;

  console.log(`  ${archivo}`);
  console.log(`    ${especificacion}`);
  console.log(`    no existe: ${destino}`);
  console.log(`    deberia ser: ${arreglo}\n`);
}

process.exit(1);
