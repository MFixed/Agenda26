import { defineConfig } from "cypress";

/**
 * Pruebas de extremo a extremo con Cypress: el recorrido COMPLETO de una
 * empresa sanitaria, hecho clic a clic sobre la interfaz real.
 *
 *   npm run cypress:open      ventana con navegador, para verlo paso a paso
 *   npm run cypress:run       en terminal, sin ventana
 *   npm run e2e               levanta el servidor y ejecuta las pruebas
 *
 * A diferencia de test/api.test.js (que llama a la API por debajo), aquí no hay
 * atajos: se escribe en los formularios y se navega por las páginas, que es la
 * única forma de detectar que un botón está roto o que un campo no se pinta.
 *
 * El recorrido, en orden:
 *   1. El superadministrador da de alta la empresa sanitaria y su administrador.
 *   2. Ese administrador entra por la puerta de SU empresa y monta la agenda.
 *   3. Da de alta a los pacientes, con documento y teléfono.
 *   4. Publica horarios de consulta.
 *   5. Un paciente se registra solo y pide cita.
 *   6. El administrador la confirma y el paciente ve el cambio.
 *   7. El administrador gestiona las tareas y las cierra al completar la cita.
 *   8. El superadministrador desactiva la empresa y se comprueba que cierra.
 */
export default defineConfig({
  e2e: {
    baseUrl: process.env.BASE_URL || "http://localhost:3000",

    // El proyecto se escribe en español: `describe`/`it` van en español y los
    // errores que se ven en el vídeo se leen sin traducción de por medio.
    supportFile: "cypress/support/e2e.js",
    specPattern: "cypress/e2e/**/*.cy.js",

    // Sin vídeo ni capturas: ocupan bastante y aquí se lee el resultado en
    // consola. La captura de un fallo se puede pedir a mano.
    video: false,
    screenshotOnRunFailure: false,
    viewportWidth: 1280,
    viewportHeight: 900,

    defaultCommandTimeout: 10000,
    requestTimeout: 20000,

    // Todas las pruebas comparten la misma empresa de la base de desarrollo, así
    // que van de una en una: en paralelo se pisarían los horarios.
    retries: { runMode: 0, openMode: 0 },

    /* testIsolation: false — el recorrido es UNA SESIÓN, no 46 pruebas sueltas.

       Por defecto Cypress borra localStorage y las cookies entre pruebas, así que
       al terminar el primer paso se pierde la sesión y todos los siguientes fallan
       con "elemento no encontrado": la aplicación redirige al acceso porque ya no
       hay token. Desactivarlo es justo lo que hace falta aquí, porque el paso 7
       (la doctora confirma la cita) depende del paso 6 (el paciente la pidió) y del
       paso 2 (la clínica existe).

       El precio es que un fallo intermedio puede dejar un modal abierto y que el
       siguiente vea la pantalla que toca sin embargo. Por eso cada `it` vuelve
       a la página que necesita con un `cy.visit`, en vez de confiar en dónde
       quedó la anterior. */
    testIsolation: false,

    /* OJO con `expose` y no `env`: en Cypress 16 `Cypress.env()` se eliminó. Los
       valores de aquí llegan al navegador con `Cypress.expose()`.

       Se usa `expose` y no `cy.env()` a propósito. `expose` es para valores NO
       sensibles: son visibles en el paquete del navegador. Aquí no hay problema
       porque son cuentas de una base de desarrollo local y el recorrido existe
       para verlo. En un entorno real, la contraseña del superadministrador
       tendría que pasar por `cy.env()` (que llega sólo a los plugins de Node) y
       teclearse en el formulario, no leerse de la configuración del navegador. */
    expose: {
      empresa: {
        nombre: "Clínica Vital",
        adminNombre: "Dra. Elena Markovic",
        adminPassword: "Vital12345",
        telefono: "600111333"
      },
      superadmin: {
        email: "super@plataforma.com",
        password: "Super1234"
      }
    },

    // Antes de arrancar se dejan dos cosas en su sitio:
    //
    //   1. Un superadministrador, porque el recorrido empieza en /super. Se crea si
    //      no hay; si ya hay, no se toca.
    //   2. Sin empresas de las ejecuciones anteriores. Los datos del recorrido se
    //      crean desde la interfaz, y el aislamiento de Cypress no deshace un alta
    //      hecha con el ratón: sin esta limpieza, repetir la batería arrastra
    //      pacientes y citas de la pasada anterior y acaba fallando por datos
    //      viejos en lugar de por un fallo real.
    //
    // Sólo se borran empresas cuyo identificador empieza por "clinica-vital-": el
    // seed y cualquier empresa creada a mano se quedan como están.
    async setupNodeEvents(on) {
      on("before:run", async () => {
        const { asegurarSuperadmin, limpiarEmpresasDePrueba } = await import("./cypress/support/base.js");
        const borradas = await limpiarEmpresasDePrueba();
        await asegurarSuperadmin();
        if (borradas > 0) {
          // eslint-disable-next-line no-console
          console.log(`  [cypress] ${borradas} empresa(s) de ejecuciones anteriores eliminadas`);
        }
      });

      // En modo `open` no se ejecuta `before:run`, así que la limpieza se hace
      // igualmente desde el primer before del spec. Es idempotente.
      on("before:spec", async () => {
        const { asegurarSuperadmin, limpiarEmpresasDePrueba } = await import("./cypress/support/base.js");
        await limpiarEmpresasDePrueba();
        await asegurarSuperadmin();
      });
    }
  }
});
