/**
 * Levanta el servidor, ejecuta el recorrido de Cypress y lo apaga.
 *
 *   npm run e2e                headless, sin ventana
 *   npm run e2e -- --headed     con ventana, para verlo pasar
 *   npm run e2e -- run --headed --spec cypress/e2e/clinica.cy.js
 *
 * Existe para que no haya que acordarse de levantar el servidor en otra
 * terminal. Si ya hay uno escuchando, lo reutiliza en lugar de fallar: durante el
 * desarrollo es lo normal, y negarse a arrancar convertiría "olvidé de pararlo"
 * en un rodeo.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { esperarServidor, limpiarEmpresasDePrueba } from "../cypress/support/base.js";

const require = createRequire(import.meta.url);
const BASE = process.env.BASE_URL || "http://localhost:3000";
const argumentsCypress = process.argv.slice(2);

/** ¿Hay ya algo escuchando? Se intenta una llamada rápida y se mira el código. */
async function servidorArriba() {
  try {
    const respuesta = await fetch(`${BASE}/api/health`);
    return respuesta.status < 500;
  } catch {
    return false;
  }
}

const reusing = await servidorArriba();
let servidor = null;

if (reusing) {
  console.log(`\n  Ya hay un servidor en ${BASE}: se reutiliza.\n`);
} else {
  console.log(`\n  Levantando el servidor en ${BASE}…`);
  servidor = spawn(process.execPath, ["src/server.js"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: process.env.PORT || "3000" }
  });

  // Si el servidor dice algo interesante (un aviso de configuración, por ejemplo),
  // se enseña. Si no, se calla para no mezclarlo con la salida de Cypress.
  servidor.stdout.on("data", (trozo) => {
    const linea = String(trozo).trim();
    if (linea && !/ExperimentalWarning/.test(linea)) {
      console.log(`  [servidor] ${linea}`);
    }
  });
  servidor.stderr.on("data", (trozo) => console.error(`  [servidor] ${String(trozo).trim()}`));

  try {
    await esperarServidor(BASE);
  } catch (error) {
    console.error(`\n  ${error.message}\n`);
    servidor?.kill();
    process.exit(1);
  }
  console.log("  Servidor listo.\n");
}

// Empresas de ejecuciones anteriores del recorrido. Se limpian antes de empezar,
// no en cada `it`: el recorrido es una historia encadenada, y borrar en medio
// rompería lo que el paso anterior acaba de dejar.
const borradas = await limpiarEmpresasDePrueba();
if (borradas > 0) {
  console.log(`  ${borradas} empresa(s) de ejecuciones anteriores eliminadas.\n`);
}

/* OJO con esto, que es más enrevesado de lo que parece y el error es invisible:
   require.resolve("cypress") devuelve dist/index.js, que es la LIBRERÍA que usa
   el plugin, no la CLI. Lanzarla así no hace nada y sale con código 0, que parece
   un verde. Y la ruta no se puede pedir con require.resolve("cypress/bin/cypress")
   porque el campo "exports" del paquete no lo expone. Así que se compone a mano
   desde la carpeta del paquete. */
const carpetaCypress = path.dirname(require.resolve("cypress/package.json"));
const rutaCli = path.join(carpetaCypress, "bin", "cypress");
if (!existsSync(rutaCli)) {
  console.error(`\n  No se encuentra la CLI de Cypress en ${rutaCli}. Ejecuta: npm install\n`);
  process.exit(1);
}

/* Sin argumentos, `run` es lo propio de una prueba automática: sin ventana y con
   código de salida útil. Con argumentos, se pasan tal cual, para poder abrir la
   interfaz o limitarse a un spec:
     npm run e2e -- --headed
     npm run e2e -- run --headed --spec cypress/e2e/clinica.cy.js           */
const argumentos = argumentsCypress.length > 0 ? argumentsCypress : ["run"];

const proceso = spawn(process.execPath, [rutaCli, ...argumentos], {
  stdio: "inherit",
  env: { ...process.env, BASE_URL: BASE }
});

proceso.on("close", (codigo) => {
  servidor?.kill();
  process.exit(codigo ?? 0);
});

// Ctrl+C apaga también el servidor, que si no se queda huérfano ocupando el
// puerto y el siguiente arranque falla sin decir por qué.
process.on("SIGINT", () => {
  servidor?.kill();
  process.exit(130);
});
