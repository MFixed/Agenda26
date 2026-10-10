import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/utils/password.js';
import { formatDateOnly, parseDateOnly } from '../src/utils/dates.js';

const prisma = new PrismaClient();

/**
 * Cuentas de ejemplo. Los correos y las contrasenas son los que los botones de
 * "Cuentas de ejemplo" de las paginas de acceso ofrecen, asi que tienen que
 * coincidir con los que ahi estan escritos.
 */
const CUENTAS = {
  super: { nombre: 'Equipo Plataforma', email: 'super@plataforma.com', password: 'Super1234', role: 'SUPERADMIN' },
  admin: { nombre: 'Laura Gómez', email: 'admin@ejemplo.com', password: 'Admin1234', role: 'ADMIN' },
  cliente: { nombre: 'Ana Martínez', email: 'ana@ejemplo.com', password: 'Cliente1234', role: 'CLIENT' },
};

/** 'YYYY-MM-DD' de dentro de dias dias, para que el seed tenga agenda futura. */
function desdeHoy(dias) {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + dias);
  return formatDateOnly(fecha);
}

async function main() {
  const hash = async (password) => hashPassword(password);

  const negocio = await prisma.business.upsert({
    where: { slug: 'ejemplo' },
    update: {},
    create: { nombre: 'Clinica Ejemplo', slug: 'ejemplo', descripcion: 'Empresa de ejemplo para probar la agenda' },
  });

  // El superadministrador no pertenece a ninguna empresa: gestiona la
  // plataforma, no trabaja en ninguna.
  await prisma.user.upsert({
    where: { email: CUENTAS.super.email },
    update: {},
    create: {
      nombre: CUENTAS.super.nombre,
      email: CUENTAS.super.email,
      passwordHash: await hash(CUENTAS.super.password),
      role: 'SUPERADMIN',
      businessId: null,
    },
  });

  await prisma.user.upsert({
    where: { email: CUENTAS.admin.email },
    update: {},
    create: {
      nombre: CUENTAS.admin.nombre,
      email: CUENTAS.admin.email,
      passwordHash: await hash(CUENTAS.admin.password),
      role: 'ADMIN',
      businessId: negocio.id,
    },
  });

  const clienteUser = await prisma.user.upsert({
    where: { email: CUENTAS.cliente.email },
    update: {},
    create: {
      nombre: CUENTAS.cliente.nombre,
      email: CUENTAS.cliente.email,
      passwordHash: await hash(CUENTAS.cliente.password),
      role: 'CLIENT',
      businessId: negocio.id,
    },
  });

  await prisma.client.upsert({
    where: { userId: clienteUser.id },
    update: {},
    create: {
      userId: clienteUser.id,
      businessId: negocio.id,
      nombre: CUENTAS.cliente.nombre,
      documento: '12345678',
      fechaNacimiento: parseDateOnly('1990-04-12'),
      telefono: '0991234567',
      direccion: 'Av. Italia 1234, Montevideo',
    },
  });

  const servicios = await prisma.category.upsert({
    where: { businessId_name: { businessId: negocio.id, name: 'SERVICIOS' } },
    update: {},
    create: { businessId: negocio.id, name: 'SERVICIOS', description: 'Catalogo por defecto' },
  });

  const mantenimiento = await prisma.category.upsert({
    where: { businessId_name: { businessId: negocio.id, name: 'Mantenimiento' } },
    update: {},
    create: { businessId: negocio.id, name: 'Mantenimiento', description: 'Revision preventiva' },
  });

  const cliente = await prisma.client.findUnique({ where: { userId: clienteUser.id } });

  // Una tarea suelta con y sin fecha: las dos vistas del panel las cuentan.
  await prisma.task.upsert({
    where: { id: 1 },
    update: {},
    create: {
      businessId: negocio.id,
      title: 'Revisar el equipo de la sala 2',
      description: 'Tarea de trabajo suelta, sin cita detras',
      categoryId: mantenimiento.id,
      clientId: cliente.id,
      dueDate: parseDateOnly(desdeHoy(1)),
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
      categoryId: servicios.id,
      clientId: cliente.id,
    },
  });

  // Horarios de los proximos dias, con uno bloqueado para que se vea el cuarto
  // estado en el calendario.
  const franjas = [
    { dias: 1, inicio: '09:00', estado: 'AVAILABLE' },
    { dias: 1, inicio: '10:00', estado: 'AVAILABLE' },
    { dias: 1, inicio: '11:00', estado: 'BLOCKED', nota: 'Mantenimiento' },
    { dias: 2, inicio: '09:00', estado: 'AVAILABLE' },
    { dias: 2, inicio: '15:00', estado: 'AVAILABLE' },
    { dias: 3, inicio: '09:00', estado: 'AVAILABLE' },
  ];

  for (const franja of franjas) {
    const [h, m] = franja.inicio.split(':').map(Number);
    const fin = franja.inicio === '23:00' ? '23:59' : `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

    await prisma.availability.upsert({
      where: {
        businessId_date_startTime: {
          businessId: negocio.id,
          date: parseDateOnly(desdeHoy(franja.dias)),
          startTime: franja.inicio,
        },
      },
      update: {},
      create: {
        businessId: negocio.id,
        date: parseDateOnly(desdeHoy(franja.dias)),
        startTime: franja.inicio,
        endTime: fin,
        status: franja.estado,
        note: franja.nota ?? null,
      },
    });
  }

  console.log('Seed listo.');
  console.log(`  negocio:     ${negocio.nombre}  ->  http://localhost:3000/b/${negocio.slug}/login`);
  console.log(`  admin:       ${CUENTAS.admin.email} / ${CUENTAS.admin.password}`);
  console.log(`  cliente:     ${CUENTAS.cliente.email} / ${CUENTAS.cliente.password}`);
  console.log(`  plataforma:  ${CUENTAS.super.email} / ${CUENTAS.super.password}  ->  http://localhost:3000/login`);
  console.log(`  categorias:  ${servicios.name}, ${mantenimiento.name}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());