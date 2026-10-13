import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Imports resolubles.
 *
 * El fallo que cubre: `src/jobs/scheduler.js` importaba `../config/env.js` cuando
 * desde `src/jobs/` hay que subir DOS niveles. El proceso no arrancaba.
 *
 * Por que no lo detectaron ni los tests ni la prueba de humo: ninguno de los dos
 * carga `index.js` ni `src/jobs/*`. Importan `server.js` y los services, que estan
 * en otra carpeta con otra profundidad. Un archivo que nadie carga durante las
 * pruebas puede tener lo que quiera dentro y que todo siga en verde.
 *
 * Por eso aqui se recorre el proyecto ENTERO, en vez de confiar en que los tests
 * toquen todos los archivos.
 */
describe('todos los imports relativos resuelven', () => {
  it('no hay ningun import roto en el proyecto', () => {
    const raiz = join(import.meta.dirname, '..');

    let salida = '';
    let codigo = 0;

    try {
      salida = execFileSync(process.execPath, [join(raiz, 'scripts', 'revisar-imports.mjs')], {
        cwd: raiz,
        encoding: 'utf8',
      });
    } catch (error) {
      /// El script sale con 1 cuando encuentra rotos y vuelca la lista en stdout.
      salida = error.stdout ?? '';
      codigo = error.status ?? 1;
    }

    assert.equal(
      codigo,
      0,
      `Hay imports que no resuelven:\n\n${salida}\n` +
        'Un import mal escrito en un archivo que los tests no cargan no falla hasta que alguien ejecuta npm start.'
    );
  });
});
