/**
 * ¿Se puede usar con varios empleados a la vez?
 *
 * Levanta la API contra la base de verdad y comprueba, punto por punto, lo que hace
 * falta para que una empresa tenga mas de una persona trabajando:
 *
 *   1. Que existan varias cuentas por empresa (no solo el primer administrador)
 *   2. Que cada una pueda entrar por su cuenta
 *   3. Que un profesional tenga su propia ficha
 *   4. Que se le pueda asignar una cita
 *   5. Que su agenda se pueda filtrar por profesional
 *   6. Que el aislamiento siga valiendo entre empleados y entre empresas
 *   7. Que un empleado NO vea lo que no le toca
 *
 * Uso:  node scripts/empleados.mjs
 */

import 'dotenv/config';

const PUERTO = process.env.SMOKE_PORT || 3121;
const base = `http://127.0.0.1:${PUERTO}`;

const pedir = async (metodo, ruta, cuerpo, token) => {
  const res = await fetch(base + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });

  const texto = await res.text();
  let j = texto;
  try {
    j = JSON.parse(texto);
  } catch {
    /* no es JSON */
  }

  return { s: res.status, j };
};

const ok = (etiqueta, condicion, detalle = '') => {
  console.log(`  ${condicion ? 'OK  ' : 'FALLA'} ${etiqueta}${detalle ? ' · ' + detalle : ''}`);
  if (!condicion) process.exitCode = 1;
};

const { createApp } = await import('../src/server.js');
const { configurarSqlite, prisma } = await import('../config/driver.js');

await configurarSqlite();
const servidor = createApp().listen(PUERTO);
const SLUG = 'equipo';

try {
  /* ------------------------------------------------------------------ */
  console.log('\n1. Una empresa con varias cuentas');

  const superLogin = await pedir('POST', '/api/auth/login', {
    email: 'super@plataforma.com',
    password: 'Super1234',
  });
  const tSuper = superLogin.j.accessToken;

  // Se empieza de cero en esta empresa para que la prueba no dependa de datos viejos.
  const anterior = await prisma.business.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (anterior) await prisma.business.delete({ where: { id: anterior.id } });

  const alta = await pedir(
    'POST',
    '/api/super/negocios',
    {
      nombre: 'Consultorio Equipo',
      slug: SLUG,
      timezone: 'America/Montevideo',
      adminNombre: 'Laura',
      adminEmail: 'laura@equipo.com',
      adminPassword: 'Admin1234',
    },
    tSuper
  );
  ok('se crea la empresa con su primer administrador', alta.s === 201);

  // Se comprueba que la empresa existe y responde antes de seguir.
  ok('la empresa creada se puede leer', Boolean((await pedir('GET', `/api/negocios/${SLUG}`)).j.negocio));

  // ADMIN
  const laura = await pedir('POST', '/api/auth/login', {
    email: 'laura@equipo.com',
    password: 'Admin1234',
    negocio: SLUG,
  });
  const tLaura = laura.j.accessToken;

  // Los tres empleados que se dan de alta desde el panel.
  const empleados = [
    { nombre: 'Dra. Sofia Ruiz', email: 'sofia@equipo.com', role: 'STAFF', especialidad: 'Odontología' },
    { nombre: 'Dr. Martín Vega', email: 'martin@equipo.com', role: 'STAFF', especialidad: 'Ortodoncia' },
    { nombre: 'Carla Núñez', email: 'carla@equipo.com', role: 'ADMIN' },
  ];

  const cuentas = {};
  for (const e of empleados) {
    const r = await pedir('POST', '/api/users', { ...e, password: 'Empleado1234' }, tLaura);
    ok(`alta de ${e.nombre} (${e.role})`, r.s === 201 && r.j.user.role === e.role, r.j.error ?? '');
    cuentas[e.email] = { token: r.j.accessToken, id: r.j.user?.id, rol: e.role };
  }

  const listado = await pedir('GET', '/api/users', null, tLaura);
  ok('el equipo son 4 cuentas (admin + 3)', listado.j.total === 4, `${listado.j.total} cuentas`);

  /* ------------------------------------------------------------------ */
  console.log('\n2. Cada uno entra con su cuenta');

  for (const e of empleados) {
    const login = await pedir('POST', '/api/auth/login', {
      email: e.email,
      password: 'Empleado1234',
      negocio: SLUG,
    });
    ok(
      `${e.nombre} entra por su cuenta`,
      login.s === 200 && login.j.user.id !== cuentas['laura@equipo.com']?.id
    );
    cuentas[e.email].token = login.j.accessToken;
  }

  const comoStaff = await pedir('GET', '/api/auth/me', null, cuentas['sofia@equipo.com'].token);
  ok('el panel reconoce el rol STAFF', comoStaff.j.user.role === 'STAFF');
  ok(
    'su sesión trae su ficha de profesional',
    Boolean(comoStaff.j.staff?.id),
    `staffId=${comoStaff.j.staff?.id}`
  );

  /* ------------------------------------------------------------------ */
  console.log('\n3. Fichas de profesional y agenda propia');

  const profesionales = (await pedir('GET', '/api/staff', null, tLaura)).j.items;
  ok(
    'hay una ficha de profesional por cada STAFF',
    profesionales.length === 2,
    `${profesionales.length} fichas`
  );
  ok('el admin NO es profesional', !profesionales.some((p) => p.nombre.includes('Laura')));

  const sofia = await pedir('GET', '/api/staff?q=Sofia', null, tLaura);
  const sofiaId = sofia.j.items[0]?.id;
  const martinId = profesionales.find((p) => p.nombre.includes('Martín'))?.id;

  const hoy = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  /*
   * El dia de la semana se saca con la MISMA funcion que usa la API, no con
   * `getUTCDay()`.
   *
   * La empresa esta en America/Montevideo y el servidor en UTC: una fecha puede ser
   * "martes" en una zona y "lunes" en la otra, y una plantilla guardada con el dia
   * equivocado no genera nada. El frontend no sufre esto porque el usuario elige el
   * dia de un desplegable segun SU calendario, que ya es la zona correcta.
   */
  const { diaDeSemana } = await import('../src/utils/dates.js');
  const diaSemana = diaDeSemana(hoy, 'America/Montevideo');

  for (const staffId of [sofiaId, martinId]) {
    await pedir(
      'POST',
      '/api/schedules',
      {
        weekday: diaSemana,
        startTime: '09:00',
        endTime: '12:00',
        slotMinutes: 60,
        staffId,
      },
      tLaura
    );
  }

  const gen = await pedir('POST', '/api/schedules/generate', { desde: hoy, hasta: hoy }, tLaura);
  ok('la agenda se genera para los dos profesionales', gen.j.creados === 6, `${gen.j.creados} bloques`);

  const deSofia = await pedir(
    'GET',
    `/api/availability?desde=${hoy}&hasta=${hoy}&staffId=${sofiaId}&estado=AVAILABLE`,
    null,
    tLaura
  );
  ok(
    'la agenda se puede filtrar por profesional',
    deSofia.j.items.length === 3,
    `${deSofia.j.items.length} huecos de Sofia`
  );

  const deMartin = await pedir(
    'GET',
    `/api/availability?desde=${hoy}&hasta=${hoy}&staffId=${martinId}&estado=AVAILABLE`,
    null,
    tLaura
  );
  ok(
    'y son bloques DISTINTOS de los de Martin',
    deMartin.j.items.length === 3 && deMartin.j.items[0].id !== deSofia.j.items[0].id
  );

  /* ------------------------------------------------------------------ */
  console.log('\n4. Citas separadas por profesional');

  /*
   * El alta de clientes devuelve `{ cliente, passwordTemporal }`, NO un token.
   *
   * Quien da de alta a un cliente es la administracion, no el propio cliente: no hay
   * sesion que abrir. La contrasena se devuelve una sola vez, aqui, y hay que
   * entregarsela a mano. Por eso este test entra despues con esa contrasena.
   */
  const documento = String(Date.now()).slice(-8);
  const cliente = await pedir(
    'POST',
    '/api/clients',
    {
      nombre: 'Ana Martínez',
      documento,
      fechaNacimiento: '1990-01-01',
      email: `ana-${documento}@equipo.com`,
      password: 'Cliente1234',
      notas: 'Alergia a la penicilina',
    },
    tLaura
  );

  ok('alta de cliente desde la administración', cliente.s === 201);
  ok(
    'las notas se guardan y vuelven en la respuesta',
    cliente.j.cliente.notas === 'Alergia a la penicilina',
    cliente.j.cliente.notas ?? '(vacias)'
  );

  const loginCliente = await pedir('POST', '/api/auth/login', {
    email: `ana-${documento}@equipo.com`,
    password: 'Cliente1234',
    negocio: SLUG,
  });
  const tCliente = loginCliente.j.accessToken;
  const clienteId = (await pedir('GET', '/api/clients/me', null, tCliente)).j.cliente?.id;

  ok('el cliente dado de alta puede entrar', loginCliente.s === 200 && Boolean(clienteId));

  const citaSofia = await pedir(
    'POST',
    '/api/appointments',
    {
      availabilityId: deSofia.j.items[0].id,
      clientId: clienteId,
      staffId: sofiaId,
      title: 'Revisión',
    },
    tLaura
  );
  ok('cita asignada a Sofia', citaSofia.s === 201 && citaSofia.j.cita.staffId === sofiaId);

  const citaMartin = await pedir(
    'POST',
    '/api/appointments',
    {
      availabilityId: deMartin.j.items[0].id,
      clientId: clienteId,
      staffId: martinId,
      title: 'Ortodoncia',
    },
    tLaura
  );
  ok('cita asignada a Martín', citaMartin.s === 201 && citaMartin.j.cita.staffId === martinId);

  const detalle = await pedir('GET', `/api/appointments/${citaSofia.j.cita.id}`, null, tLaura);
  ok(
    'el detalle dice con quién es la cita',
    detalle.j.cita.profesional?.nombre === 'Dra. Sofia Ruiz',
    detalle.j.cita.profesional?.nombre
  );

  /* ------------------------------------------------------------------ */
  console.log('\n5. Cada uno puede gestionar su cita');

  // Sofia THROUGH su propia cuenta de STAFF, no con el token del admin.
  const porSofia = await pedir(
    'GET',
    `/api/appointments?staffId=${sofiaId}&desde=${hoy}&hasta=${hoy}`,
    null,
    cuentas['sofia@equipo.com'].token
  );
  ok(
    'un STAFF puede filtrar el listado de citas por profesional',
    porSofia.s === 200 && porSofia.j.items.length === 1
  );

  const coordina = await pedir(
    'POST',
    `/api/appointments/${citaSofia.j.cita.id}/coordinar`,
    {},
    cuentas['sofia@equipo.com'].token
  );
  ok('y puede coordinar su cita', coordina.s === 200 && coordina.j.cita.status === 'COORDINATED');

  const checkin = await pedir(
    'POST',
    `/api/appointments/${citaSofia.j.cita.id}/checkin`,
    {},
    cuentas['sofia@equipo.com'].token
  );
  ok('y registrar la llegada del paciente', checkin.s === 200 && Boolean(checkin.j.cita.checkedInAt));

  /* ------------------------------------------------------------------ */
  console.log('\n6. Aislamiento entre empleados y empresas');

  const carla = cuentas['carla@equipo.com'].token;
  ok('una segunda ADMIN entra igual', (await pedir('GET', '/api/auth/me', null, carla)).s === 200);

  // Igual que en smoke: sin limpiar, la segunda corrida falla con "ese slug ya
  // existe" y parece un fallo del sistema.
  await prisma.business.deleteMany({ where: { slug: 'ajena' } });

  const otraEmpresa = await pedir(
    'POST',
    '/api/super/negocios',
    {
      nombre: 'Empresa Ajena',
      slug: 'ajena',
      adminNombre: 'Diego',
      adminEmail: 'diego@ajena.com',
      adminPassword: 'Admin1234',
    },
    tSuper
  );
  ok('se crea una segunda empresa', otraEmpresa.s === 201);
  const tAjeno = (
    await pedir('POST', '/api/auth/login', {
      email: 'diego@ajena.com',
      password: 'Admin1234',
      negocio: 'ajena',
    })
  ).j.accessToken;

  ok(
    'no ve los profesionales de otra empresa',
    (await pedir('GET', `/api/staff/${sofiaId}`, null, tAjeno)).s === 404
  );
  ok(
    'no ve las citas de otra empresa',
    (await pedir('GET', `/api/appointments/${citaSofia.j.cita.id}`, null, tAjeno)).s === 404
  );
  ok(
    'no ve la agenda de otra empresa',
    (await pedir('GET', `/api/availability/${deSofia.j.items[0].id}`, null, tAjeno)).s === 404
  );
  ok(
    'no puede dar de alta empleados en otra empresa',
    (
      await pedir(
        'POST',
        '/api/users',
        { nombre: 'X', email: 'x@ajena.com', password: 'Empleado1234' },
        cuentas['sofia@equipo.com'].token
      )
    ).s === 403
  );

  /* ------------------------------------------------------------------ */
  console.log('\n7. Un empleado NO puede salirse de su carril');

  ok(
    'un STAFF no puede crear cuentas',
    (
      await pedir(
        'POST',
        '/api/users',
        { nombre: 'X', email: 'x@equipo.com', password: 'Empleado1234' },
        cuentas['sofia@equipo.com'].token
      )
    ).s === 403
  );
  /*
   * Un STAFF SI ve la cartera: quien atiende necesita localizar a un cliente para
   * darle una cita. Lo que no puede es MODIFICARLA ni darla de baja, que es lo que
   * se comprueba mas abajo.
   */
  ok(
    'un STAFF puede consultar clientes (para reservarles cita)',
    (await pedir('GET', '/api/clients', null, cuentas['sofia@equipo.com'].token)).s === 200
  );
  ok(
    'un STAFF no puede borrar citas',
    (
      await pedir(
        'DELETE',
        `/api/appointments/${citaMartin.j.cita.id}`,
        null,
        cuentas['sofia@equipo.com'].token
      )
    ).s === 403
  );
  ok(
    'un STAFF no puede cambiar el catálogo',
    (await pedir('POST', '/api/categories', { name: 'X' }, cuentas['sofia@equipo.com'].token)).s === 403
  );
  ok(
    'un STAFF no puede dar de baja clientes',
    (await pedir('DELETE', `/api/clients/${clienteId}`, null, cuentas['sofia@equipo.com'].token)).s === 403
  );
  ok(
    'un STAFF no puede editar clientes',
    (await pedir('PUT', `/api/clients/${clienteId}`, { nombre: 'Otro' }, cuentas['sofia@equipo.com'].token))
      .s === 403
  );
  ok(
    'un STAFF no ve los informes del negocio',
    (await pedir('GET', '/api/reports/overview', null, cuentas['sofia@equipo.com'].token)).s === 403
  );
  ok(
    'un STAFF no ve el audit log',
    (await pedir('GET', '/api/audit', null, cuentas['sofia@equipo.com'].token)).s === 403
  );
  ok(
    'un STAFF no ve los ajustes del negocio',
    (await pedir('GET', '/api/negocios/settings', null, cuentas['sofia@equipo.com'].token)).s === 403
  );

  /* ------------------------------------------------------------------ */
  console.log('\n8. Salvaguarda contra quedarse sin administrador');

  const users = (await pedir('GET', '/api/users', null, tLaura)).j.items;
  const admins = users.filter((u) => u.role === 'ADMIN');
  ok('quedan 2 administradores', admins.length === 2, admins.map((a) => a.nombre).join(' · '));

  /*
   * Laura es la unica que puede degradar: es la creadora de la empresa y hay DOS
   * admins, asi que quitarle el rol a Carla deja uno y se permite.
   */
  const carlaId = listado.j.items.find((u) => u.email === 'carla@equipo.com').id;
  const degradarCarla = await pedir('PUT', `/api/users/${carlaId}`, { role: 'CLIENT' }, tLaura);
  ok(
    'se puede degradar a un admin mientras quede otro',
    degradarCarla.s === 200 && degradarCarla.j.usuario.role === 'CLIENT',
    `status=${degradarCarla.s}`
  );

  /* Y ahora queda UNA sola admin (Laura): el mismo intento debe rebotar. */
  const degradarLaura = await pedir(
    'PUT',
    `/api/users/${listado.j.items.find((u) => u.email === 'laura@equipo.com').id}`,
    { role: 'CLIENT' },
    tLaura
  );
  ok(
    'NO se puede quedar la empresa sin ningún admin',
    degradarLaura.s === 409,
    `status=${degradarLaura.s} · "${degradarLaura.j.error ?? ''}"`
  );

  const bajaLaura = await pedir(
    'DELETE',
    `/api/users/${listado.j.items.find((u) => u.email === 'laura@equipo.com').id}`,
    null,
    tLaura
  );
  ok('ni desactivarse a si misma siendo la única admin', bajaLaura.s === 400, `status=${bajaLaura.s}`);
} finally {
  servidor.close();
  await prisma.$disconnect();
}

console.log(process.exitCode ? '\nHAY FALLOS\n' : '\nTODO CORRECTO\n');
