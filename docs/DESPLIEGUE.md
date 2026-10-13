# Despliegue en Render (PostgreSQL)

Este proyecto usa **PostgreSQL**. `prisma/schema.prisma` declara
`provider = "postgresql"`, asi que una `DATABASE_URL` con `file:` no funciona:
Prisma la rechaza al conectar.

Antes de este cambio el arranque fallaba en Render con:

```
Raw query failed. Code: `42601`. Message: `ERROR: syntax error at or near "PRAGMA"`
el esquema de la base no esta listo
```

La causa era `verificarEsquema()` en `config/driver.js`, que hacia
`PRAGMA table_info(...)` sin mirar que motor habia debajo. `PRAGMA` es sintaxis de
SQLite. Ver `config/driver.js`: ahora la comprobacion se ramifica por motor.

---

## 1. Base de datos

La base se crea desde las migraciones, no a mano:

```bash
npm ci
npm run db:migrate          # prisma migrate deploy
npm run db:reset -- --force # deja solo el superadministrador
```

`prisma/migrations/0001_init/migration.sql` contiene el esquema entero, incluidos
los dos indices que Prisma NO puede expresar y que estan escritos a mano al final:

- `Appointment_hueco_vivo_key` — UNIQUE PARCIAL. **La garantia de integridad del
  modulo de citas**: sin el, dos clientes pueden reservar el mismo bloque a la vez.
- `Availability_businessId_staffId_date_startTime_key` — UNIQUE de expresion, para
  que no se dupliquen bloques.

Esos dos indices no salen de `schema.prisma`, y por eso las MISMAS lineas comentadas
estan dentro de cada modelo. **Sin esas lineas comentadas, el siguiente
`prisma migrate dev` no ve el indice, lo da por borrado y genera un `DROP INDEX`**
que se lleva por delante la proteccion contra el doble booking.

Por eso el arranque comprueba explicitamente que `Appointment_hueco_vivo_key`
existe, ademas de que la tabla este. Es una comprobacion cara a proposito: es mejor
no arrancar que arrancar sin la garantia de integridad y descubrirlo con la primera
cita duplicada.

---

## 2. Valores en el panel de Render

### Build Command

```
npm ci && npm run build && npm run db:migrate
```

- `npm ci` instala lo exacto que dice `package-lock.json`.
- `npm run build` es `prisma generate`: sin el, `@prisma/client` no esta generado y
  el proceso muere con "did not initialize yet".
- `npm run db:migrate` es `prisma migrate deploy`. Aplica lo pendiente y no hace
  nada si ya esta todo aplicado, asi que se puede dejar en cada despliegue.

> **Por que el orden importa.** Si `prisma generate` se ejecuta sin `DATABASE_URL`
> puesta, Prisma 6 falla con "error: Environment variable not found: DATABASE_URL".
> Por eso `migrate deploy` va **despues** de `generate`: si la variable faltara, el
> fallo sale en el paso 3 con un mensaje claro, y no en el 2.

### Start Command

```
npm start
```

(equivale a `node index.js`; `prestart` ejecuta `scripts/verificar-entorno.js`).

### Variables de entorno

| Variable | Obligatoria | Valor |
|---|---|---|
| `DATABASE_URL` | si | La cadena de conexion interna de tu Postgres. En el panel: *Database* -> *Internal Database URL*. **Usa la interna, no la externa**: la externa sale a internet y obliga a la app a salir de la red de Render para hablar con una base que tiene al lado. |
| `JWT_SECRET` | si | 32 caracteres o mas. `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `APP_URL` | si | `https://tu-servicio.onrender.com`. Sin esto la app **no arranca**. |
| `NODE_ENV` | si | `production` |
| `CORS_ORIGIN` | si | El origen de tu frontend. En produccion `*` esta prohibido. |
| `DOCS_ENABLED` | no | `false`. `/api/docs` no pide autenticacion: publicly colgado publica el contrato de la API. |
| `TRUST_PROXY` | si | `1` detras del balanceador de Render. Sin el, los rate limits usan la IP del proxy y todos los clientes comparten cubo. |
| `MAIL_DRIVER` | no | `resend` / `smtp` / `ninguno` |
| `RESEND_API_KEY`, `EMAIL_FROM`, `SMTP_*` | no | Ver `docs/CORREO.md` |
| `JOBS_ENABLED` | no | `true` en **una sola** instancia. Con dos, los recordatorios salen duplicados. |
| `SUPERADMIN_PASSWORD` | no | Solo si se ejecuta `db:reset`/`db:setup` desde el build. **No** hace falta si ya existe el superadministrador. |

`DATABASE_URL` **nunca** va en un `.env` versionado: lleva la contrasena.

---

## 3. Instancia

- **Health Check Path**: `/api/ready`
- Con varias instancias: `JOBS_ENABLED=false` en todas menos una.

---

## 4. Si vuelve a fallar

| Error | Que significa |
|---|---|
| `42601: syntax error at or near "PRAGMA"` | Se ha perdido el cambio de `config/driver.js`: la comprobacion de esquema ha vuelto a hablar SQL de SQLite. |
| `falta la tabla "Appointment"` | `prisma migrate deploy` no se ejecuto en el build, o `DATABASE_URL` apunta a otra base. |
| `Falta el indice "Appointment_hueco_vivo_key"` | La migracion se aplico con `db push` en vez de `migrate deploy` (o con una version antigua del SQL). |
| `error: Environment variable not found: DATABASE_URL` | Falta la variable en el panel, o `prisma generate` se ejecuta antes de que exista. |
| `P1001: Can't reach database server` | `DATABASE_URL` apunta a la URL **externa** desde una red que no la alcanza, o la base esta dormida (plan gratuito de Render: se suspende tras unos dias sin uso y tarda unos segundos en despertar en la primera peticion). |

---

## 5. Pruebas

`tests/setup.js` fija `DATABASE_URL=file:./test.db`, que ya no es valido con este
esquema. Los tests **unitarios** funcionan igual (no abren Prisma); los de
integracion habran que apuntarlos a un PostgreSQL de pruebas.