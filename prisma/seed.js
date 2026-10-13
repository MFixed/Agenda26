import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/utils/password.js';
import { parseDateOnly, sumarDias, sumarMinutos, hoyEn } from '../src/utils/dates.js';

const prisma = new PrismaClient();

/**
 * Datos de ejemplo para probar la agenda.
 *
 * v2 anade lo que hace falta para poder probar de verdad las cosas nuevas:
 * profesionales, plantillas de agenda, una zona horaria real y mas de un
 * administrador. Con un solo admin y un solo usuario, la mitad de v2 no se puede ni
 * mirar.
 *
 * Es idempotente: se puede rodar las veces que haga falta sin duplicar nada.
 */

/**
 * Cuentas de ejemplo. Los correos y las contrasenas son los que los botones de
 * "Cuentas de ejemplo" de las paginas de acceso ofrecen, asi que tienen que
 * coincidir con los que ahi estan escritos.
 */
const CUENTAS = {
  super: {
    nombre: 'Equipo Plataforma',
    email: 'super@plataforma.com',
    password: 'Super1234',
    role: 'SUPERADMIN',
  },
  admin: { nombre: 'Laura Gomez', email: 'admin@ejemplo.com', password: 'Admin1234', role: 'ADMIN' },
  admin2: { nombre: 'Diego Fernandez', email: 'admin2@ejemplo.com', password: 'Admin1234', role: 'ADMIN' },
  staff: { nombre: 'Dra. Sofia Ruiz', email: 'sofia@ejemplo.com', password: 'Staff1234', role: 'STAFF' },
  staff2: { nombre: 'Dr. Martin Vega', email: 'martin@ejemplo.com', password: 'Staff1234', role: 'STAFF' },
  cliente: { nombre: 'Ana Martinez', email: 'ana@ejemplo.com', password: 'Cliente1234', role: 'CLIENT' },
  cliente2: { nombre: 'Bruno Diaz', email: 'bruno@ejemplo.com', password: 'Cliente1234', role: 'CLIENT' },
};

const TIMEZONE = 'America/Montevideo';

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

async function main() {
  const hash = (password) => hashPassword(password);

  const negocio = await prisma.business.upsert({
    where: { slug: 'ejemplo' },
    update: {},
    create: {
      nombre: 'Clinica Ejemplo',
      slug: 'ejemplo',
      descripcion: 'Empresa de ejemplo para probar la agenda',
      timezone: TIMEZONE,
      bufferMin: 5,
      slotMinutes: 60,
    },
  });

  /// Los ajustes se crean con la empresa; si el negocio ya existia de una corrida
  /// anterior, se rellenan para que el service pueda leer `settings.holdMinutes`
  /// sin defenderse de un null.
  await prisma.businessSettings.upsert({
    where: { businessId: negocio.id },
    create: { businessId: negocio.id, holdMinutes: 10, reminderBeforeMin: 1440 },
    update: {},
  });

  /*
   * El superadministrador no pertenece a ninguna empresa: gestiona la plataforma, no
   * trabaja en ninguna.
   */
  const usuarios = {};

  for (const [clave, cuenta] of Object.entries(CUENTAS)) {
    const esPlataforma = cuenta.role === 'SUPERADMIN';

    const user = await prisma.user.upsert({
      where: { email: cuenta.email },
      update: {},
      create: {
        nombre: cuenta.nombre,
        email: cuenta.email,
        passwordHash: await hash(cuenta.password),
        role: cuenta.role,
        /// El superadmin va suelto. Los demas, colgados del negocio de ejemplo.
        businessId: esPlataforma ? null : negocio.id,
        /// Cuentas de prueba: el correo ya esta "verificado" porque no hay a quien
        /// mandarle el enlace. En una empresa de verdad esto lo hace el click.
        emailVerifiedAt: new Date(),
      },
    });

    await prisma.userSettings.upsert({
      where: { userId: user.id },
      create: { userId: user.id, timezone: TIMEZONE },
      update: {},
    });

    usuarios[clave] = user;
  }

  /* --- Profesionales (nuevo en v2) --- */

  const profesionales = {};

  for (const clave of ['staff', 'staff2']) {
    const user = usuarios[clave];

    profesionales[clave] = await prisma.staff.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        businessId: negocio.id,
        userId: user.id,
        nombre: user.nombre,
        email: user.email,
        especialidad: clave === 'staff' ? 'Odontologia general' : 'Ortodoncia',
        color: clave === 'staff' ? '#0891b2' : '#7c3aed',
      },
    });
  }

  /* --- Clientes --- */

  const clientes = {};

  for (const [clave, documento, telefono] of [
    ['cliente', '12345678', '0991234567'],
    ['cliente2', '87654321', '0987654321'],
  ]) {
    const user = usuarios[clave];

    const cliente = await prisma.client.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        businessId: negocio.id,
        nombre: user.nombre,
        documento,
        fechaNacimiento: parseDateOnly('1990-04-12'),
        telefono,
        direccion: 'Av. Italia 1234, Montevideo',
      },
    });

    /*
     * Las notas van en `ClientProfile`, no en `Client`.
     *
     * El esquema separa la ficha operativa (lo que el negocio opera) de las notas
     * y consentimientos que ve el propio cliente (`ClientProfile`), asi que no se
     * pueden escribir junto al `create` del cliente: Prisma rechaza `notas` con
     * "Unknown argument" y la semilla entera revienta al primer cliente.
     */
    await prisma.clientProfile.upsert({
      where: { clientId: cliente.id },
      update: {},
      create: {
        clientId: cliente.id,
        notas: clave === 'cliente' ? 'Prefiere por la manana' : null,
      },
    });

    await prisma.clientProfile.upsert({
      where: { clientId: cliente.id },
      create: { clientId: cliente.id, consentimientoAt: new Date() },
      update: {},
    });

    clientes[clave] = cliente;
  }

  /* --- Catalogo de servicios (con duracion, color y precio) --- */

  const servicios = {};

  /*
   * `precio` va como numero, no como texto.
   *
   * El esquema declara `precio Float` (SQLite no tiene decimal exacto; el precio es
   * de referencia y no se cobra, asi que Float basta). Pasando `'45.00'` Prisma
   * responde "Expected Float or Null, provided String" y la semilla entera revienta
   * al primer servicio.
   */
  for (const [nombre, description, durationMin, color, precio] of [
    ['CONSULTA', 'Consulta general', 30, '#2563eb', 45],
    ['LIMPIEZA', 'Limpieza dental', 45, '#0d9488', 60],
    ['Mantenimiento', 'Revision preventiva', 60, '#ea580c', 35],
  ]) {
    servicios[nombre] = await prisma.category.upsert({
      where: { businessId_name: { businessId: negocio.id, name: nombre } },
      update: {},
      create: { businessId: negocio.id, name: nombre, description, durationMin, color, precio },
    });
  }

  /* --- Tareas sueltas: una con fecha y una sin --- */

  await prisma.task.upsert({
    where: { id: 1 },
    update: {},
    create: {
      businessId: negocio.id,
      title: 'Revisar el equipo de la sala 2',
      description: 'Tarea de trabajo suelta, sin cita detras',
      categoryId: servicios.Mantenimiento.id,
      clientId: clientes.cliente.id,
      dueDate: parseDateOnly(sumarDias(hoyEn(TIMEZONE), 1)),
      dueTime: '09:00',
    },
  });

  await prisma.task.upsert({
    where: { id: 2 },
    update: {},
    create: {
      businessId: negocio.id,
      title: 'Pedir material de limpieza',
      description: 'Sin fecha: aparece en la vista "Sin fecha"',
      categoryId: servicios.LIMPIEZA.id,
      clientId: clientes.cliente.id,
    },
  });

  /* --- Plantillas de agenda recurrente (nuevo en v2) --- */

  for (const weekday of [1, 2, 3, 4, 5]) {
    const existente = await prisma.businessSchedule.findFirst({
      where: { businessId: negocio.id, weekday, startTime: '09:00' },
      select: { id: true },
    });

    if (existente) continue;

    await prisma.businessSchedule.create({
      data: {
        businessId: negocio.id,
        weekday,
        startTime: '09:00',
        endTime: '13:00',
        slotMinutes: 60,
        note: 'Manana de consulta',
      },
    });
  }

  /* --- Bloques de agenda generados a mano para que haya de immediately --- */

  const franjas = [
    { dias: 1, inicio: '09:00', estado: 'AVAILABLE', profesional: 'staff' },
    { dias: 1, inicio: '10:00', estado: 'AVAILABLE', profesional: 'staff' },
    { dias: 1, inicio: '11:00', estado: 'BLOCKED', nota: 'Mantenimiento', profesional: 'staff' },
    { dias: 1, inicio: '09:00', estado: 'AVAILABLE', profesional: 'staff2' },
    { dias: 2, inicio: '09:00', estado: 'AVAILABLE', profesional: 'staff' },
    { dias: 2, inicio: '15:00', estado: 'AVAILABLE', profesional: 'staff2' },
    { dias: 3, inicio: '09:00', estado: 'AVAILABLE', profesional: 'staff' },
  ];

  for (const franja of franjas) {
    const date = parseDateOnly(sumarDias(hoyEn(TIMEZONE), franja.dias));
    const { hora: fin } = sumarMinutos(franja.inicio, 60);

    const existente = await prisma.availability.findFirst({
      where: {
        businessId: negocio.id,
        date,
        startTime: franja.inicio,
        staffId: profesionales[franja.profesional].id,
      },
      select: { id: true },
    });

    if (existente) continue;

    await prisma.availability.create({
      data: {
        businessId: negocio.id,
        date,
        startTime: franja.inicio,
        endTime: fin,
        status: franja.estado,
        note: franja.nota ?? null,
        staffId: profesionales[franja.profesional].id,
      },
    });
  }

  /* --- Un cliente en lista de espera (nuevo en v2) --- */

  const hoy = hoyEn(TIMEZONE);

  const esperaExistente = await prisma.waitlistEntry.findFirst({
    where: { businessId: negocio.id, clientId: clientes.cliente2.id },
    select: { id: true },
  });

  if (!esperaExistente) {
    await prisma.waitlistEntry.create({
      data: {
        businessId: negocio.id,
        clientId: clientes.cliente2.id,
        categoryId: servicios.CONSULTA.id,
        dateFrom: parseDateOnly(hoy),
        dateTo: parseDateOnly(sumarDias(hoy, 14)),
        note: 'Cualquier tarde de la proxima semana',
        expiresAt: new Date(Date.now() + 14 * 86_400_000),
      },
    });
  }

  const diaActual = parseDateOnly(hoy).getUTCDay();
  const dias = DIAS_SEMANA[diaActual] ?? '';

  console.log('Seed listo.\n');
  console.log(`  negocio:     ${negocio.nombre}  ->  http://localhost:3000/b/${negocio.slug}/login`);
  console.log(`  zona:        ${negocio.timezone}  (buffer ${negocio.bufferMin} min)\n`);
  console.log('  Cuentas de ejemplo:');
  console.log(
    `    plataforma:  ${CUENTAS.super.email} / ${CUENTAS.super.password}   ->  http://localhost:3000/login`
  );
  console.log(`    admin:       ${CUENTAS.admin.email} / ${CUENTAS.admin.password}`);
  console.log(`    admin 2:     ${CUENTAS.admin2.email} / ${CUENTAS.admin2.password}`);
  console.log(
    `    staff:       ${CUENTAS.staff.email} / ${CUENTAS.staff.password}   (${profesionales.staff.especialidad})`
  );
  console.log(
    `    staff 2:     ${CUENTAS.staff2.email} / ${CUENTAS.staff2.password}   (${profesionales.staff2.especialidad})`
  );
  console.log(`    cliente:     ${CUENTAS.cliente.email} / ${CUENTAS.cliente.password}`);
  console.log(`    cliente 2:   ${CUENTAS.cliente2.email} / ${CUENTAS.cliente2.password}\n`);
  console.log(`  servicios:   ${Object.keys(servicios).join(', ')}`);
  console.log(`  agenda:      bloques de los proximos 3 dias, plantilla de lunes a viernes`);
  console.log(`  espera:      ${clientes.cliente2.nombre} esperando hueco`);
  console.log(`  hoy:         ${hoy} (${dias}) en la zona del negocio`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
