/**
 * Configuracion de las pruebas automaticas.
 *
 * Se carga con `node --import ./tests/setup.js`, ANTES que ningun modulo del
 * proyecto. Por eso puede fijar las variables de entorno: cuando `config/env.js`
 * se importe despues, ya leera estos valores.
 */

/*
 * `test`, no `development`.
 *
 * No es cosmetico: con `NODE_ENV=development` se montan Swagger y los jobs, y los
 * tests empiezan a mandar correos de verdad.
 */
process.env.NODE_ENV = 'test';

/*
 * Base de datos de pruebas: SIEMPRE la misma, sin mirar el entorno.
 *
 * Antes era `??=`, que solo asigna si la variable NO existe. Con `DATABASE_URL`
 * exportada en la shell (o puesta como secreto en un CI), se quedaba apuntando a la
 * que hubiera: en este proyecto, `prisma/dev.db`, con los datos de desarrollo. Un
 * `deleteMany` en un test de integracion se los habria llevado.
 *
 * Con `=` no hay forma de que los tests toquen otra base. Si alguien quiere
 * apuntar a otra, que la sustituya explicitamente en el test.
 *
 * La ruta es RELATIVA a proposito: Prisma la resuelve respecto a
 * `prisma/schema.prisma`, asi que el fichero acaba en `prisma/test.db`, separado
 * de `prisma/dev.db`.
 */
process.env.DATABASE_URL = 'file:./test.db?connection_limit=1';

/*
 * Clave de firma propia de las pruebas.
 *
 * Con `=` y no `??=` por lo mismo que arriba: si el entorno trae la clave real, los
 * tests firmarian tokens con ella. No es un riesgo practico (es una clave de
 * desarrollo), pero el principio es el mismo que con la base: las pruebas no
 * dependen de lo que haya fuera.
 */
process.env.JWT_SECRET = 'clave-solo-para-pruebas-de-al-menos-32-caracteres';

/*
 * Los limites de peticiones estarian molestando: los tests hacen cientos de
 * peticiones seguidas contra la API real y no son un trafico hostil.
 *
 * Y los jobs se apagan porque un worker que expire retenciones mientras un test
 * comprueba que una retencion sigue viva lo hace fallar de forma intermitente, y
 * esas intermitencias son justo las que nadie sabe explicar.
 */
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.JOBS_ENABLED = 'false';

/*
 * El correo se apaga DEL TODO.
 *
 * `config/mailer.js` construye el cliente de Resend si hay `RESEND_API_KEY`, y el
 * `.env` del desarrollador suele tenerla puesta para probar. El primer test que
 * tocara un correo de verdad se lo mandaria a un cliente de ejemplo (o al buzon de
 * pruebas que este en `EMAIL_TEST_DESTINO`), desde una ejecucion de CI.
 *
 * Sin clave, `enviar()` devuelve `{ enviado: false }` sin tocar la red, que es
 * justo lo que se quiere en las pruebas.
 */
process.env.RESEND_API_KEY = '';
process.env.EMAIL_FROM = '';
process.env.EMAIL_TEST_DESTINO = '';

process.env.APP_URL = 'http://localhost:3000';

/*
 * Prepara el esquema de la base de pruebas.
 *
 * Es sincrono y va aqui a proposito: los tests se lanzan con `node --import`, que
 * carga este archivo ANTES que el modulo de test, y un import dinamico (top-level
 * await) haria que `node --import` no esperase.
 *
 * Por que hace falta: `prisma/*.db` esta en `.gitignore`, asi que en una maquina
 * nueva o en un CI recien estrenado `prisma/test.db` no existe. El primer test que
 * abre Prisma falla con "no such table: Appointment", que dice menos que nada sobre
 * lo que hay que hacer. Con esto, se crea sola.
 *
 * `deploy` y no `db push` a proposito: ver la nota de abajo.
 *
 * Es idempotente: si el esquema ya esta, no hace nada.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliPrisma = resolve(raiz, 'node_modules', 'prisma', 'build', 'index.js');

/*
 * `migrate deploy`, NO `db push`.
 *
 * Es la diferencia entre una base de pruebas que se parece a la real y una que no.
 * `db push` genera el esquema DESDE `schema.prisma`, y ahi no estan los dos indices
 * UNIQUE PARCIALES: Prisma no los expresa (SQLite no los tiene en el esquema) y solo
 * viven en el SQL de la migracion. Con `push`, la base de pruebas se queda sin
 * `Appointment_hueco_vivo_key`, sin proteccion contra el doble booking y sin el
 * indice de huecos: cualquier test de integracion que dependa de ellos pasaria en
 * una base que en produccion se comporta de otra manera.
 *
 * Con `deploy` se aplican las migraciones de verdad, que es lo que se quiere probar.
 */
try {
  execFileSync(process.execPath, [cliPrisma, 'migrate', 'deploy'], {
    cwd: raiz,
    stdio: 'ignore',
    env: { ...process.env },
  });
} catch (error) {
  /*
   * Si falla NO se interrumpe la ejecucion.
   *
   * Los tests actuales son unitarios y no abren Prisma, asi que pueden correr sin
   * la base de pruebas creada. Romperlos aqui por una base que no hace falta seria
   * peor: el que escribe un test de integracion ve el fallo de verdad, en su test, y
   * no un fallo de arranque que no explica de donde viene.
   */
  process.stderr.write(
    `\n  (aviso: no se pudo preparar prisma/test.db — ${error.message.split('\n')[0]})\n` +
      '   Los tests unitarios funcionan igual; los que abran Prisma fallaran.\n\n'
  );
}
