/**
 * Escenario de aceptación completo (§29) sobre HTTP real, con el servidor ya
 * arrancado. Usa las cuentas del seed y datos propios que limpia al terminar.
 *
 *   node scripts/escenario.js
 */

const BASE = process.env.BASE || "http://localhost:3000";
const hoyISO = () => new Date().toISOString().slice(0, 10);
const masDias = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

let fallos = 0;
let paso = 0;
// Un fallo de ejecucion no es lo mismo que una comprobacion fallida: si el
// escenario se cae a mitad, el recuento de las 30 no significa nada.
let falloDeEjecucion = false;

function ok(etiqueta, condicion, detalle) {
  paso += 1;
  if (condicion) {
    console.log(`  ${String(paso).padStart(2)}. ok   ${etiqueta}`);
  } else {
    fallos += 1;
    console.log(`  ${String(paso).padStart(2)}. FALLO ${etiqueta}${detalle ? ` -> ${detalle}` : ""}`);
  }
}

async function pedir(ruta, { metodo = "GET", cuerpo, token } = {}) {
  const cabeceras = {};
  if (cuerpo !== undefined) cabeceras["Content-Type"] = "application/json";
  if (token) cabeceras.Authorization = `Bearer ${token}`;

  const respuesta = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: cabeceras,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
  });

  const texto = await respuesta.text();
  let datos = null;
  try {
    datos = JSON.parse(texto);
  } catch {
    datos = texto;
  }
  return { estado: respuesta.status, datos };
}

const sello = Date.now();
const nuevoCliente = {
  nombre: "Cliente Escenario",
  email: `escenario.${sello}@ejemplo.com`,
  password: "Escenario1234",
  confirmPassword: "Escenario1234",
  documento: `ESC${sello}`.slice(0, 30),
  fechaNacimiento: "1992-08-14",
  telefono: "600111222",
  direccion: "Calle Escenario 1"
};

let adminToken;
let clienteToken;
let disponibilidad;
let cita;
let citasCreadas = [];
let tareasCreadas = [];
let tareaSinFechaId = null;
let idsClientes = [];
let idsDisponibilidades = [];

console.log(`\n== Escenario de aceptación sobre ${BASE} ==\n`);

try {
  /* ---------------- ADMIN: 1-4 ---------------- */
  console.log("ADMIN");
  const loginAdmin = await pedir("/api/auth/login", {
    metodo: "POST",
    cuerpo: { email: "admin@ejemplo.com", password: "Admin1234" }
  });
  ok("1. el administrador inicia sesión", loginAdmin.estado === 200, `estado ${loginAdmin.estado}`);
  adminToken = loginAdmin.datos.token;

  const categorias = await pedir("/api/categories", { token: adminToken });
  const servicios = categorias.datos.items.find((categoria) => categoria.name === "SERVICIOS");
  ok("2. existe la categoría SERVICIOS", Boolean(servicios));

  /* Se busca una hora libre en vez de fijarla: así el escenario se puede
     repetir aunque el seed o una ejecución anterior ya ocupen las 12:00. */
  const fechaCita = masDias(2);
  const existentes = await pedir(
    `/api/availability?desde=${fechaCita}&hasta=${fechaCita}`,
    { token: adminToken }
  );
  const ocupadas = new Set(existentes.datos.items.map((hueco) => hueco.startTime));

  const nuevaDisp = await (async () => {
    let ultimoError = "";
    for (let hora = 8; hora <= 20; hora += 1) {
      const inicio = `${String(hora).padStart(2, "0")}:00`;
      if (ocupadas.has(inicio)) {
        continue;
      }
      // Una hora de duración: el servidor no admite bloques de más de 4 horas.
      const fin = `${String(hora + 1).padStart(2, "0")}:00`;
      const respuesta = await pedir("/api/availability", {
        metodo: "POST",
        token: adminToken,
        cuerpo: { date: fechaCita, startTime: inicio, endTime: fin, status: "AVAILABLE" }
      });
      if (respuesta.estado === 201) {
        return respuesta;
      }
      ultimoError = respuesta.datos?.error || "";
    }
    return { estado: 0, datos: { error: ultimoError || "No queda ninguna hora libre ese día." } };
  })();

  const horaCita = nuevaDisp.datos?.disponibilidad?.startTime || "—";
  ok(
    `3. el administrador crea disponibilidad el ${fechaCita} a las ${horaCita}`,
    nuevaDisp.estado === 201,
    nuevaDisp.datos?.error
  );
  if (nuevaDisp.estado !== 201) {
    throw new Error("No se pudo crear la disponibilidad de prueba.");
  }
  disponibilidad = nuevaDisp.datos.disponibilidad;
  idsDisponibilidades.push(disponibilidad.id);

  const listado = await pedir(`/api/availability?desde=${fechaCita}&hasta=${fechaCita}`, {
    token: adminToken
  });
  ok(
    "4. la disponibilidad aparece en el listado del calendario",
    listado.datos.items.some((hueco) => hueco.id === disponibilidad.id)
  );

  /* ---------------- CLIENTE: 5-9 ---------------- */
  console.log("\nCLIENTE");
  const registro = await pedir("/api/auth/register", { metodo: "POST", cuerpo: nuevoCliente });
  ok("5. el cliente se registra", registro.estado === 201, registro.datos?.error);
  clienteToken = registro.datos.token;
  idsClientes.push(registro.datos.client.id);

  const loginCliente = await pedir("/api/auth/login", {
    metodo: "POST",
    cuerpo: { email: nuevoCliente.email, password: nuevoCliente.password }
  });
  ok("5b. el cliente inicia sesión", loginCliente.estado === 200);
  clienteToken = loginCliente.datos.token;

  const huecos = await pedir("/api/availability", { token: clienteToken });
  const huecoElegido = huecos.datos.items.find((hueco) => hueco.id === disponibilidad.id);
  ok("6-7. el cliente ve el horario libre y puede elegirlo", Boolean(huecoElegido));

  const solicitud = await pedir("/api/appointments", {
    metodo: "POST",
    token: clienteToken,
    cuerpo: {
      availabilityId: disponibilidad.id,
      categoryId: servicios.id,
      title: "Instalación",
      note: "Necesito realizar la instalación en el fondo."
    }
  });
  ok("8-9. el cliente confirma la solicitud con su anotación", solicitud.estado === 201, solicitud.datos?.error);
  if (solicitud.estado !== 201) {
    throw new Error("La solicitud de cita falló; el resto del escenario no tiene sentido.");
  }
  cita = solicitud.datos.cita;
  citasCreadas.push(cita?.id);
  tareasCreadas.push(cita?.taskId);

  /* ---------------- SISTEMA: 10-14 ---------------- */
  console.log("\nSISTEMA");
  ok("10. se crea la Task", Boolean(cita.taskId) && cita.task?.title === "Instalación");
  ok("11. se crea la Appointment", Boolean(cita.id));
  ok("12. la Appointment queda PENDING", cita.status === "PENDING");

  const huecoTrasSolicitud = await pedir(`/api/availability/${disponibilidad.id}`, { token: adminToken });
  ok("13. la disponibilidad queda bloqueada (HELD)", huecoTrasSolicitud.datos.disponibilidad.status === "HELD");

  // Otro cliente intenta el mismo horario.
  const intruso = {
    nombre: "Intruso Escenario",
    email: `intruso.${sello}@ejemplo.com`,
    password: "Intruso12345",
    confirmPassword: "Intruso12345",
    documento: `INT${sello}`.slice(0, 30),
    fechaNacimiento: "1990-01-01"
  };
  const registroIntruso = await pedir("/api/auth/register", { metodo: "POST", cuerpo: intruso });
  idsClientes.push(registroIntruso.datos?.client?.id);
  const loginIntruso = await pedir("/api/auth/login", {
    metodo: "POST",
    cuerpo: { email: intruso.email, password: intruso.password }
  });
  const intento = await pedir("/api/appointments", {
    metodo: "POST",
    token: loginIntruso.datos.token,
    cuerpo: { availabilityId: disponibilidad.id, note: "intento" }
  });
  ok("14. otro cliente no puede ocupar el mismo horario", intento.estado === 409, `estado ${intento.estado}`);

  const citasDelHueco = await pedir("/api/availability/" + disponibilidad.id, { token: adminToken });
  ok(
    "14b. sigue habiendo una sola cita sobre ese horario",
    (citasDelHueco.datos.disponibilidad.cita || []).length <= 1
  );

  /* ---------------- ADMIN: 15-20 ---------------- */
  console.log("\nADMIN resuelve");
  const cola = await pedir("/api/appointments?estado=PENDING", { token: adminToken });
  ok(
    "15. el administrador ve la solicitud pendiente",
    cola.datos.items.some((item) => item.id === cita.id)
  );

  const detalle = await pedir(`/api/appointments/${cita.id}`, { token: adminToken });
  ok("16. abre el detalle", detalle.estado === 200);
  ok(
    "16b. el detalle trae cliente, categoría, fecha, hora, nota y estado",
    Boolean(
      detalle.datos.cita.client?.nombre &&
        detalle.datos.cita.task?.category?.name &&
        detalle.datos.cita.availability?.date &&
        detalle.datos.cita.availability?.startTime &&
        detalle.datos.cita.note &&
        detalle.datos.cita.status
    )
  );

  const coordina = await pedir(`/api/appointments/${cita.id}/coordinar`, {
    metodo: "POST",
    token: adminToken,
    cuerpo: {}
  });
  ok("17. confirma la cita", coordina.estado === 200, coordina.datos?.error);
  ok("18. la Appointment pasa a COORDINATED", coordina.datos.cita.status === "COORDINATED");

  const huecoConfirmado = await pedir(`/api/availability/${disponibilidad.id}`, { token: adminToken });
  ok("19. la Availability pasa a RESERVED", huecoConfirmado.datos.disponibilidad.status === "RESERVED");

  const avisos = await pedir("/api/notifications", { token: clienteToken });
  ok(
    "20. se crea la Notification para el cliente",
    avisos.datos.items.some((aviso) => aviso.type === "APPOINTMENT_COORDINATED")
  );

  /* ---------------- CLIENTE: 21-22 ---------------- */
  console.log("\nCLIENTE consulta");
  const suyas = await pedir("/api/appointments", { token: clienteToken });
  const suCita = suyas.datos.items.find((item) => item.id === cita.id);
  ok("21. el cliente ve la cita como COORDINATED", suCita?.status === "COORDINATED");
  ok(
    "22. el cliente ve fecha, hora, servicio y anotación",
    Boolean(suCita?.availability?.date && suCita?.availability?.startTime && suCita?.task?.title && suCita?.note)
  );

  /* ---------------- ADMIN: 23-29 ---------------- */
  console.log("\nADMIN gestiona");
  const tareaSinFecha = await pedir("/api/tasks", {
    metodo: "POST",
    token: adminToken,
    cuerpo: { title: "Comprar materiales", categoryId: servicios.id, dueDate: null }
  });
  ok("23. crea una Task sin fecha", tareaSinFecha.estado === 201 && tareaSinFecha.datos.tarea.sinFecha === true);
  tareaSinFechaId = tareaSinFecha.datos?.tarea?.id ?? null;

  const vistaSinFecha = await pedir("/api/tasks?filtro=sin-fecha", { token: adminToken });
  ok(
    "24. la tarea aparece en «Tareas sin fecha»",
    vistaSinFecha.datos.items.some((tarea) => tarea.id === tareaSinFecha.datos.tarea.id)
  );
  ok(
    "24b. su dueDate es NULL de verdad, no una fecha inventada",
    vistaSinFecha.datos.items.find((t) => t.id === tareaSinFecha.datos.tarea.id)?.dueDate === null
  );

  const nuevaFecha = masDias(5);
  const edita = await pedir(`/api/availability/${disponibilidad.id}`, {
    metodo: "PUT",
    token: adminToken,
    cuerpo: { note: "Confirmado por teléfono" }
  });
  ok("25. modifica la disponibilidad", edita.estado === 200, edita.datos?.error);

  const otroHueco = await pedir("/api/availability", {
    metodo: "POST",
    token: adminToken,
    cuerpo: { date: nuevaFecha, startTime: "10:00", endTime: "11:00", status: "AVAILABLE" }
  });
  ok("25b. publica otro horario para el calendario", otroHueco.estado === 201);
  idsDisponibilidades.push(otroHueco.datos?.disponibilidad?.id);

  const desdeHoy = hoyISO();
  const rango = await pedir(`/api/appointments?desde=${desdeHoy}&hasta=${masDias(30)}`, {
    token: adminToken
  });
  ok("26. el calendario mensual tiene datos", rango.estado === 200 && rango.datos.total >= 1);

  const todasLasTareas = await pedir("/api/tasks", { token: adminToken });
  ok("28. consulta todas las tareas", todasLasTareas.estado === 200 && todasLasTareas.datos.total >= 1);

  const todasLasCitas = await pedir("/api/appointments", { token: adminToken });
  ok("29. consulta todas las citas", todasLasCitas.estado === 200 && todasLasCitas.datos.total >= 1);

  /* ---------------- AISLAMIENTO: 30 ---------------- */
  console.log("\nAISLAMIENTO");
  const fichaAjena = await pedir(`/api/clients/${registro.datos.client.id}`, { token: loginIntruso.datos.token });
  ok("30. un cliente no accede a los datos de otro", fichaAjena.estado === 403, `estado ${fichaAjena.estado}`);

  const citaAjena = await pedir(`/api/appointments/${cita.id}`, { token: loginIntruso.datos.token });
  ok("30b. un cliente no abre la cita de otro", citaAjena.estado === 403, `estado ${citaAjena.estado}`);

  const adminRuta = await pedir("/api/clients", { token: clienteToken });
  ok("30c. un cliente no entra en rutas de administración", adminRuta.estado === 403, `estado ${adminRuta.estado}`);
} catch (error) {
  // El finally limpia pero no tapa: el error real se imprime despues, no en su
  // lugar. Antes un fallo de limpieza desplazaba al escenario entero y no se
  // veia ni una de las 30 comprobaciones.
  falloDeEjecucion = true;
  console.error(`\nEl escenario no pudo terminar: ${error?.message || error}`);
} finally {
  /* Limpieza: el escenario no deja basura en la base de datos. */
  console.log("\nLimpiando datos del escenario…");
  for (const cita of citasCreadas) {
    await pedir(`/api/appointments/${cita}`, { metodo: "DELETE", token: adminToken });
  }
  // Cada cita arrastra una tarea, y la tarea sin fecha del punto 23 también se
  // queda. Sin borrarlas, cada ejecución dejaría basura en la lista de trabajo
  // del administrador, que es justo lo que estas pruebas deben dejar intacto.
  //
  // Todo esto va en su propio try: si la limpieza falla, el error que importa
  // es el del escenario, y uno de limpieza por encima lo esconde.
  const idsTareas = [...tareasCreadas, ...(tareaSinFechaId ? [tareaSinFechaId] : [])].filter(Boolean);
  if (idsTareas.length > 0) {
    try {
      const { prisma } = await import("../src/config/database.js");
      await prisma.task.deleteMany({ where: { id: { in: idsTareas }, appointments: { none: {} } } });
      await prisma.$disconnect();
    } catch (error) {
      console.warn(`  (la limpieza de tareas ha fallado: ${error.message.split("\n")[0]})`);
    }
  }

  for (const hueco of idsDisponibilidades.filter(Boolean)) {
    await pedir(`/api/availability/${hueco}`, { metodo: "DELETE", token: adminToken });
  }
  for (const cliente of idsClientes.filter(Boolean)) {
    await pedir(`/api/clients/${cliente}`, { metodo: "DELETE", token: adminToken });
  }
  console.log("Listo.");
}

console.log(`\n== ${escenarioPasado() ? "ESCENARIO COMPLETO CORRECTO" : `${fallos} COMPROBACIONES FALLIDAS`} ==\n`);
process.exit(fallos === 0 && !falloDeEjecucion ? 0 : 1);

/**
 * El escenario solo pasa si las 30 comprobaciones estan bien y ademas ha
 * llegado al final. Un recuento parcial con una caida a mitad no es un verde.
 */
function escenarioPasado() {
  return fallos === 0 && !falloDeEjecucion;
}
