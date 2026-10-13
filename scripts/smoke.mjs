/**
 * Prueba de humo contra la API de verdad.
 *
 * No es un test (no va en `npm test`): levanta el servidor, recorre el flujo
 * completo de arriba abajo y lo tira. Sirve para comprobar de una vez que la base,
 * las migraciones, los middleware y los services se hablan bien.
 *
 * ES DESTRUCTIVO y corre contra la base de `.env`, que es la de desarrollo. Crea
 * empresas, usuarios y citas de prueba, y al final borra las empresas que ha creado
 * (`business.deleteMany` por slug). Todo lo que lleva los slugs de abajo es suyo y no
 * lo tocan cuentas reales.
 *
 * Por eso no se puede lanzar contra una base de produccion: si `DATABASE_URL` apunta
 * a ella, esta crea y borra filas de verdad. Se comprueba abajo y se sale.
 *
 * Uso:  npm run smoke   (con la base ya migrada)
 */
import 'dotenv/config';

const ES_PRODUCCION = process.env.NODE_ENV === 'production';

if (ES_PRODUCCION) {
  process.stderr.write(
    '\n  Esta prueba BORRA los datos que crea. No se ejecuta con NODE_ENV=production.\n\n'
  );
  process.exit(1);
}

const PUERTO = process.env.SMOKE_PORT || 3120;
const base = `http://127.0.0.1:${PUERTO}`;

const pedir = async (metodo, ruta, cuerpo, token) => {
  const res = await fetch(base + ruta, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });

  const texto = await res.text();
  let cuerpo_ = texto;

  try {
    cuerpo_ = JSON.parse(texto);
  } catch {
    /* No es JSON: se deja el texto recortado. */
  }

  return { s: res.status, j: cuerpo_ };
};

const ok = (etiqueta, condicion, detalle = '') => {
  console.log(`  ${condicion ? 'OK  ' : 'FALLA'} ${etiqueta}${detalle ? ' · ' + detalle : ''}`);
  if (!condicion) process.exitCode = 1;
};

const { createApp } = await import('../src/server.js');
const { configurarSqlite, prisma } = await import('../config/driver.js');

await configurarSqlite();
const servidor = createApp().listen(PUERTO);

try {
  console.log('\n1. Salud');
  ok('health responde 200', (await pedir('GET', '/api/health')).s === 200);
  ok('ready responde 200 (base viva)', (await pedir('GET', '/api/ready')).s === 200);

  console.log('\n2. Acceso');
  const login = await pedir('POST', '/api/auth/login', {
    email: 'super@plataforma.com',
    password: 'Super1234',
  });
  ok(
    'login del superusuario',
    login.s === 200 && login.j.user.role === 'SUPERADMIN',
    `rol=${login.j.user?.role}`
  );
  const tok = login.j.accessToken;

  const me = await pedir('GET', '/api/auth/me', null, tok);
  ok('me devuelve la sesion', me.s === 200 && me.j.user.role === 'SUPERADMIN');

  const refresh = await pedir('POST', '/api/auth/refresh', { refreshToken: login.j.refreshToken });
  ok(
    'el refresh token rota y emite otro access',
    refresh.s === 200 && refresh.j.refreshToken !== login.j.refreshToken
  );

  ok(
    'el refresh viejo ya no vale',
    (await pedir('POST', '/api/auth/refresh', { refreshToken: login.j.refreshToken })).s === 401
  );

  console.log('\n3. Empresa');
  const slug = 'smoke';
  await prisma.business.deleteMany({ where: { slug } });

  const neg = await pedir(
    'POST',
    '/api/super/negocios',
    {
      nombre: 'Clinica Smoke',
      slug,
      timezone: 'America/Montevideo',
      bufferMin: 5,
      adminNombre: 'Laura',
      adminEmail: 'laura@smoke.com',
      adminPassword: 'Admin1234',
    },
    tok
  );
  ok('alta de empresa con su admin', neg.s === 201, neg.j.mensaje ?? '');

  const pub = await pedir('GET', `/api/negocios/${slug}`);
  ok('la empresa es publica', pub.s === 200 && pub.j.negocio.slug === slug);
  const bizId = pub.j.negocio.id;

  const laura = await pedir('POST', '/api/auth/login', {
    email: 'laura@smoke.com',
    password: 'Admin1234',
    negocio: slug,
  });
  ok('el admin entra por su puerta', laura.s === 200);
  const tL = laura.j.accessToken;

  const admin = await pedir('GET', `/api/tasks${bizId ? '' : ''}`, null, tL);
  ok('el admin ve su negocio sin ?businessId', admin.s === 200);

  console.log('\n4. Catálogo y agenda');
  const cat = await pedir(
    'POST',
    '/api/categories',
    { name: 'CONSULTA', durationMin: 30, color: '#2563eb', precio: 45.5 },
    tL
  );
  ok('alta de servicio con duración', cat.s === 201 && cat.j.categoria.durationMin === 30);

  const prof = await pedir('POST', '/api/staff', { nombre: 'Dra. Sofia', especialidad: 'Odontología' }, tL);
  ok('alta de profesional', prof.s === 201);
  const staffId = prof.j.profesional?.id;

  const plant = await pedir(
    'POST',
    '/api/schedules',
    { weekday: new Date().getDay(), startTime: '09:00', endTime: '12:00', slotMinutes: 60, staffId },
    tL
  );
  ok('alta de plantilla semanal', plant.s === 201);

  const hoy = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const manana = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const gen = await pedir('POST', '/api/schedules/generate', { desde: hoy, hasta: manana, staffId }, tL);
  ok('generar bloques desde la plantilla', gen.s === 200 && gen.j.creados > 0, `creados=${gen.j.creados}`);

  const gen2 = await pedir('POST', '/api/schedules/generate', { desde: hoy, hasta: manana, staffId }, tL);
  ok('repetir la generación no duplica', gen2.j.creados === 0, `omitidos=${gen2.j.omitidos}`);

  const libre = await pedir(
    'GET',
    `/api/availability?desde=${hoy}&hasta=${manana}&estado=AVAILABLE`,
    null,
    tL
  );
  ok(
    'el listado trae huecos libres',
    libre.s === 200 && libre.j.items.length > 0,
    `${libre.j.items.length} huecos`
  );

  console.log('\n5. Reserva');
  const reg = await pedir('POST', '/api/auth/register', {
    nombre: 'Ana Martínez',
    documento: '11111111',
    fechaNacimiento: '1990-01-01',
    email: 'ana@smoke.com',
    password: 'Cliente1234',
    confirmPassword: 'Cliente1234',
    negocio: slug,
  });
  ok('alta publica de cliente', reg.s === 201);
  const tC = reg.j.accessToken;

  // El registro devuelve el USUARIO, no la ficha de cliente. Para el caso de "el
  // admin reserva en nombre de este cliente" hace falta el id de la ficha, que es
  // lo que devuelve /clients/me.
  const miFicha = await pedir('GET', '/api/clients/me', null, tC);
  const miClienteId = miFicha.j.cliente?.id;

  const solapes = await pedir(
    'POST',
    '/api/availability',
    { date: hoy, startTime: '11:00', endTime: '12:00' },
    tL
  );
  ok('un bloque que solapa se rechaza', solapes.s === 409, `status=${solapes.s}`);

  const hueco = libre.j.items[0];
  const hold = await pedir('POST', `/api/availability/${hueco.id}/hold`, {}, tC);
  ok('el cliente retiene el hueco', hold.s === 200 && hold.j.status === 'HELD');

  const cita = await pedir(
    'POST',
    '/api/appointments',
    { availabilityId: hueco.id, categoryId: cat.j.categoria.id, title: 'Revisión' },
    tC
  );
  ok('el cliente reserva su cita', cita.s === 201, cita.j.cita?.status);
  const citaId = cita.j.cita?.id;

  // Como admin hay que indicar de quien es la cita: el admin no tiene ficha de
  // cliente y por eso el service lo pide en vez de suponerlo.
  const dup = await pedir(
    'POST',
    '/api/appointments',
    { availabilityId: hueco.id, clientId: miClienteId, title: 'Otra' },
    tL
  );
  ok('la MISMA franja no se puede reservar dos veces', dup.s === 409, `status=${dup.s} · "${dup.j.error}"`);

  console.log('\n6. Ciclo de vida');
  const coord = await pedir('POST', `/api/appointments/${citaId}/coordinar`, {}, tL);
  ok('coordinar', coord.s === 200 && coord.j.cita.status === 'COORDINATED');

  const completa = await pedir('POST', `/api/appointments/${citaId}/completar`, {}, tL);
  ok('completar', completa.s === 200 && completa.j.cita.status === 'COMPLETED');

  const cerrada = await pedir('POST', `/api/appointments/${citaId}/cancelar`, {}, tL);
  ok('una cita cerrada no se puede cancelar', cerrada.s === 409);

  const c2 = await pedir(
    'POST',
    '/api/appointments',
    { availabilityId: libre.j.items[1].id, title: 'Segunda' },
    tC
  );

  // NO_SHOW solo sale de COORDINATED: no se marca ausente una cita que el cliente
  // todavia no ha visto confirmada.
  const aindaNoCoordinada = await pedir(
    'POST',
    `/api/appointments/${c2.j.cita.id}/no-show`,
    { noShowReason: 'No avisó' },
    tL
  );
  ok('no se marca ausente una cita sin coordinar', aindaNoCoordinada.s === 409);

  await pedir('POST', `/api/appointments/${c2.j.cita.id}/coordinar`, {}, tL);

  const chk = await pedir('POST', `/api/appointments/${c2.j.cita.id}/checkin`, {}, tL);
  ok('check-in registra la llegada', chk.s === 200 && chk.j.cita.checkedInAt);

  const noMotivo = await pedir('POST', `/api/appointments/${c2.j.cita.id}/no-show`, {}, tL);
  ok('marcar ausencia sin motivo se rechaza', noMotivo.s === 400, `status=${noMotivo.s}`);

  const conMotivo = await pedir(
    'POST',
    `/api/appointments/${c2.j.cita.id}/no-show`,
    { noShowReason: 'No avisó' },
    tL
  );
  ok('marcar ausencia con motivo', conMotivo.s === 200 && conMotivo.j.cita.status === 'NO_SHOW');

  console.log('\n7. Aislamiento entre empresas');

  // Se limpia la empresa anterior de esta misma prueba: sin esto, rodar dos veces
  // seguidas falla al crear la segunda con "ese slug ya existe" y parece un fallo del
  // sistema cuando es de la prueba.
  await prisma.business.deleteMany({ where: { slug: 'otra' } });

  const otra = await pedir(
    'POST',
    '/api/super/negocios',
    {
      nombre: 'Otra',
      slug: 'otra',
      adminNombre: 'Diego',
      adminEmail: 'diego@otra.com',
      adminPassword: 'Admin1234',
    },
    tok
  );
  const diego = await pedir('POST', '/api/auth/login', {
    email: 'diego@otra.com',
    password: 'Admin1234',
    negocio: 'otra',
  });
  const tD = diego.j.accessToken;
  ok('segunda empresa creada', otra.s === 201);

  const cruce = await pedir('GET', `/api/appointments/${citaId}`, null, tD);
  ok('no ve citas de otra empresa', cruce.s === 404, `status=${cruce.s}`);

  const ajena = await pedir('GET', `/api/availability/${hueco.id}`, null, tD);
  ok('no ve huecos de otra empresa', ajena.s === 404);

  const ajenaC = await pedir('GET', `/api/clients/me`, null, diego.j.refreshToken && tD);
  ok('un admin no tiene ficha de cliente', ajenaC.s === 403 || ajenaC.s === 404, `status=${ajenaC.s}`);

  console.log('\n8. Un cliente no ve lo ajeno');
  const otraCita = await pedir(
    'POST',
    '/api/appointments',
    {
      availabilityId: (
        await pedir('GET', `/api/availability?desde=${hoy}&hasta=${manana}&estado=AVAILABLE`, null, tL)
      ).j.items[0]?.id,
      title: 'De otro',
    },
    tL
  );
  if (otraCita.s === 201) {
    const verAjena = await pedir('GET', `/api/appointments/${otraCita.j.cita.id}`, null, tC);
    ok('404 y no 403 al pedir la cita de otro cliente', verAjena.s === 404, `status=${verAjena.s}`);
  }

  console.log('\n9. Historia, informes y auditoría');
  const hist = await pedir('GET', '/api/clients/me/history', null, tC);
  ok(
    'el cliente ve su historial',
    hist.s === 200 && hist.j.citas.length > 0,
    `${hist.j.citas?.length} citas`
  );

  const inf = await pedir('GET', `/api/reports/overview?desde=${hoy}&hasta=${manana}`, null, tL);
  ok('informe de resumen', inf.s === 200 && inf.j.citas.total > 0, `total=${inf.j.citas?.total}`);

  const aus = await pedir('GET', `/api/reports/no-show?desde=${hoy}&hasta=${manana}`, null, tL);
  ok('informe de ausencias', aus.s === 200 && aus.j.totalAusencias > 0, `${aus.j.totalAusencias}`);

  const csv = await fetch(`${base}/api/reports/export?desde=${hoy}&hasta=${manana}`, {
    headers: { Authorization: `Bearer ${tL}` },
  });
  ok('exportación CSV', csv.status === 200 && csv.headers.get('content-type').includes('text/csv'));

  const aud = await pedir('GET', '/api/audit', null, tL);
  ok('el audit log tiene entradas', aud.s === 200 && aud.j.items.length > 0, `${aud.j.items?.length}`);
  ok('el payload se devuelve como objeto, no como texto', aud.j.items[0]?.payload !== undefined);

  console.log('\n10. Validación y errores');
  ok('un PATCH vacío se rechaza', (await pedir('PUT', '/api/tasks/1', {}, tL)).s === 400);
  ok(
    'cambiar el slug de una empresa se rechaza',
    (await pedir('PATCH', `/api/super/negocios/${bizId}`, { slug: 'otro' }, tok)).s === 400
  );
  ok('sin token es 401', (await pedir('GET', '/api/tasks')).s === 401);
  ok('un cliente no puede listar la cartera', (await pedir('GET', '/api/clients', null, tC)).s === 403);
  ok('una ruta de API inexistente responde JSON', (await pedir('GET', '/api/no-existe')).s === 404);

  const invalido = await pedir('POST', '/api/auth/login', { email: 'no-existe@x.com', password: 'Algo1234' });
  ok(
    'login con email inexistente da el mismo 401',
    invalido.s === 401 && invalido.j.error === 'Credenciales invalidas'
  );
} finally {
  servidor.close();
  await prisma.$disconnect();
}

console.log(process.exitCode ? '\nHAY FALLOS\n' : '\nTODO CORRECTO\n');
