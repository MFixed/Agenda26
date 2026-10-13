# Agenda26 v2

Sistema de **gestión de citas y tareas multi-empresa**. Node.js + Express 5 + Prisma 6 + **SQLite**, con frontend HTML/CSS/JS sin build servido por el mismo Express.

Esta es la version 2. Se **[mantienen los modulos de la v1]** (`auth`, `negocios`, `super`, `clients`, `categories`, `tasks`, `availability`, `appointments`, `notifications`) y se anaden otros encima.

---

## Arrancar

```bash
npm install
cp .env.example .env          # y pon un JWT_SECRET de 48 caracteres
npm run db:migrate            # crea prisma/dev.db desde las migraciones
npm run db:seed               # datos de ejemplo (opcional)
npm run dev
```

Abre <http://localhost:3000>.

**No hace falta instalar PostgreSQL ni Docker.** La base es un fichero SQLite
(`prisma/dev.db`) y las migraciones lo crean desde cero.

### Comprobación antes de arrancar

`npm start` ejecuta `scripts/verificar-entorno.js` antes de levantar nada. En producción
avisa (y a veces detiene) de lo que suele estar mal: `APP_URL` apuntando a localhost,
`CORS_ORIGIN=*`, Swagger abierto, rate limits desactivados, la base sin migrar.

### Dejar la base lista de cero

```bash
npm run db:setup        # pregunta antes de BORRAR lo que haya
npm run db:setup -- --seed   # y además carga datos de ejemplo
```

`db:setup` **reconstruye** la base: borra el fichero y lo vuelve a crear desde las
migraciones. En producción hace falta `--force` además de confirmar.

### Copias de seguridad

```bash
npm run db:backup                  # -> backup/prisma-<fecha>.db
npm run db:backup -- /mi/ruta.db   # a donde quieras
```

Usa `VACUUM INTO`, que hace una copia **consistente** aunque haya escrituras en curso.
Conviene no usar un `cp` normal porque en modo WAL hay tres ficheros (`.db`, `-wal`, `-shm`) y
copiar solo el `.db` deja transacciones fuera sin avisar. Conserva las 10 últimas.

### Cuentas de ejemplo

| Rol           | Email                  | Contraseña    | Puerta                |
| ------------- | ---------------------- | ------------- | --------------------- |
| Plataforma    | `super@plataforma.com` | `Super1234`   | `/login`              |
| Admin         | `admin@ejemplo.com`    | `Admin1234`   | `/b/ejemplo/login`    |
| Admin 2       | `admin2@ejemplo.com`   | `Admin1234`   | `/b/ejemplo/login`    |
| Profesional   | `sofia@ejemplo.com`    | `Staff1234`   | `/b/ejemplo/login`    |
| Profesional 2 | `martin@ejemplo.com`   | `Staff1234`   | `/b/ejemplo/login`    |
| Cliente       | `ana@ejemplo.com`      | `Cliente1234` | `/b/ejemplo/registro` |
| Cliente 2     | `bruno@ejemplo.com`    | `Cliente1234` | `/b/ejemplo/registro` |

Empresa semilla: **Clínica Ejemplo** (`ejemplo`), zona `America/Montevideo`, 2 profesionales, 3 servicios con duración, bloques de los próximos 3 días, plantillas de lunes a viernes y un cliente en lista de espera.

---

## Qué cambia respecto a v1

### Bugs corregidos

| Antes                                                                                                                                | Ahora                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Doble booking**: dos peticiones simultáneas creaban dos citas sobre el mismo hueco (se comprobaba antes de escribir, sin garantía) | Índice **único parcial** `Appointment_hueco_vivo_key` sobre `(availabilityId) WHERE status IN ('PENDING','COORDINATED')`. La segunda recibe `409` |
| Se podía reservar un hueco **del pasado** llamando a la API directamente                                                             | `assertFechaFutura` en la reserva, en la zona del negocio                                                                                         |
| `/api/health` respondía `ok` **con la base caída**                                                                                   | `/api/health` = liveness (no toca la base). `/api/ready` = readiness (`SELECT 1`, `503` si falla)                                                 |
| Un `DELETE` se llevaba cliente + citas + historial **sin vuelta atrás**                                                              | Baja **lógica** por defecto en cliente, cita, tarea, categoría, horario y negocio. Con `?hard=true` se borra de verdad, y va en una ruta aparte   |
| La zona horaria del "hoy" era la del **servidor**                                                                                    | `Business.timezone`. En Montevideo, a las 21:00 ya se veía el día correcto                                                                        |
| Los **motivos de cancelación** no se guardaban                                                                                       | Campo `cancelReason` obligatorio en cancelar/rechazar/no-show, y de ahí sale el informe                                                           |
| "No se presentó" se guardaba como `CANCELLED`                                                                                        | Estado `NO_SHOW`, con su transición, su informe y su razón                                                                                        |
| Dos admins editando la misma cita **se pisaban en silencio**                                                                         | Versionado optimista (`version`): el que escribe sobre una versión vieja recibe `409`                                                             |
| Una contraseña inválida se colaba como `undefined` y generaba una temporal en silencio                                               | `validateOrThrow` en lugar de leer `.value` sin comprobar `valid` (lo encontraron los tests)                                                      |
| `sumarMinutos` reventaba al cruzar medianoche                                                                                        | Corregido y cubierto (lo encontraron los tests)                                                                                                   |

### Funcionalidad nueva

| Módulo                                   | Qué es                                                                                                                                                                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Usuarios**                             | Gestión de cuentas del negocio. En v1 solo se creaba el primer admin al dar de alta la empresa; no había forma de añadir un segundo. Ahora sí, con la garantía de que no se puede quedar **sin ningún administrador** |
| **Profesionales** (`/api/staff`)         | La cita cuelga de una persona, no solo de la empresa. En v1 no se podía pedir cita "con el doctor X"                                                                                                                  |
| **Agenda recurrente** (`/api/schedules`) | Plantillas "los lunes de 09:00 a 18:00" + `POST /api/schedules/generate` que materializa bloques. En v1 había que publicar cada bloque a mano (~40 peticiones por semana)                                             |
| **Retenciones** (`HELD`)                 | El hueco queda apartado mientras el cliente completa el formulario, con caducidad. Resuelve el "reservé hace 2 minutos y me salió ocupado"                                                                            |
| **Recuperación de contraseña**           | `forgot-password` / `reset-password`. Token hasheado, de un solo uso, que revoca todas las sesiones al usarse                                                                                                         |
| **Refresh token**                        | Access token de 15 min + refresh de 30 días rotativo. El panel abierto toda la tarde ya no expulsa                                                                                                                    |
| **Sesiones activas**                     | Ver y revocar sesiones por dispositivo. "Cerrar sesión en todos los dispositivos"                                                                                                                                     |
| **Lista de espera**                      | El cliente pide hueco para un rango de fechas y se le avisa por correo en cuanto se libera                                                                                                                            |
| **Recordatorios**                        | Filas en la base con fecha de envío, worker que las manda, hasta 3 reintentos                                                                                                                                         |
| **Check-in**                             | Registro de llegada para medir tiempo de espera real                                                                                                                                                                  |
| **Historial del cliente**                | `GET /api/clients/:id/history`: citas con fecha, servicio, profesional y estado                                                                                                                                       |
| **Notas de cliente**                     | Campo propio, para lo que no es un dato de contacto                                                                                                                                                                   |
| **Informes**                             | Ocupación, tasa de realización, ausencias, servicios más pedidos, motivos de cancelación, **exportación CSV**                                                                                                         |
| **Auditoría**                            | `AuditLog` de todo lo que se crea, edita y borra. Solo lectura                                                                                                                                                        |
| **Baja lógica**                          | `deletedAt` en todo. Los datos sobreviven a un borrado                                                                                                                                                                |
| **Paginación por cursor**                | Además de `?limit=&offset=`                                                                                                                                                                                           |
| **Preferencias de usuario**              | Opt-in de correo, tema, zona, idioma                                                                                                                                                                                  |
| **Worker en segundo plano**              | Retenciones, recordatorios, purgas y avisos                                                                                                                                                                           |
| **Tareas forzadas**                      | Vencidas, `dueDate` correcta, calculada en la zona del negocio                                                                                                                                                        |
| **Duración y color por servicio**        | `Category.durationMin`, `color`, `precio`                                                                                                                                                                             |

### Infraestructura

| Antes                  | Ahora                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| Sin tests              | **Tests** con el runner nativo de Node (cero dependencias)                                       |
| Sin linter             | ESLint plano + Prettier, con `npm run check` (lint → formato → tests)                            |
| `console.log` sueltos  | Logger estructurado con `requestId`, JSON en producción, secretos filtrados                      |
| Sin observabilidad     | `X-Request-Id` en toda respuesta, log de peticiones lentas, audit log                            |
| Sin copia de seguridad | `npm run db:backup`, consistente con el WAL y con rotación                                       |
| Despliegue a ciegas    | `npm start` comprueba el entorno; el arranque verifica el esquema y el índice anti-doble-reserva |
| Sin health check real  | `/api/health` y `/api/ready` para balanceadores                                                  |

---

## Estructura

```
appv2/
├── index.js                      Arranque + cierre ordenado
├── config/
│   ├── env.js                    Variables de entorno tipadas y validadas
│   ├── driver.js                 Instancia única de Prisma + ping() para /ready
│   ├── logger.js                 Logger estructurado + hashToken
│   └── mailer.js                 Resend, opcional, nunca lanza
├── prisma/
│   ├── schema.prisma             Esquema canónico (SQLite)
│   ├── migrations/0001_init/     SQL real, con los índices UNIQUE parciales
│   ├── seed.js                   Datos de ejemplo
│   ├── reset.js                  Vaciar conservando el superadmin
│   ├── setup.js                  Reconstruir desde cero (pregunta antes de borrar)
│   └── backup.js                 Copia consistente con VACUUM INTO
├── src/
│   ├── server.js                 createApp(): middlewares, API, estáticos, errores
│   ├── pages.routes.js           Rutas del frontend
│   ├── jobs/
│   │   ├── scheduler.js          setTimeout encadenado + aislamiento de fallos
│   │   └── index.js              Registro de tareas periódicas
│   ├── middlewares/
│   │   ├── requestId.js          requestId + slowRequest
│   │   ├── logger.js             Log de peticiones con requestId
│   │   ├── auth.js               authenticate, requireRole, withBusiness
│   │   ├── rateLimit.js          General, login, registro y recuperación
│   │   ├── security.js           helmet + CSP
│   │   └── cors.js               CORS
│   ├── utils/
│   │   ├── ApiError.js           Errores tipados + traducción de Prisma
│   │   ├── validation.js         Patrones, validadores, validatePatch
│   │   ├── dates.js              Zonas horarias, "hoy" del negocio
│   │   ├── pagination.js         Offset + cursor
│   │   ├── password.js           scrypt nativo
│   │   ├── tokens.js             Access y refresh
│   │   └── audit.js              Escritura de auditoría
│   ├── api/
│   │   ├── router.js             health · ready · montaje de módulos
│   │   ├── auth/                 register · login · refresh · forgot · reset · sesiones
│   │   ├── business/  super/     Empresas públicas + panel de plataforma
│   │   ├── user/                 Cuentas del negocio (nuevo)
│   │   ├── staff/                Profesionales · plantillas · lista de espera (nuevo)
│   │   ├── client/ category/     Clientes (+ historial) y catálogo
│   │   ├── task/                 Lista de trabajo
│   │   ├── availability/         Bloques + retenciones
│   │   ├── appointment/          Reserva · transiciones · recordatorios
│   │   ├── notification/         Campana · correos (.ics)
│   │   ├── report/               Informes y CSV (nuevo)
│   │   ├── audit/                Rastro de cambios (nuevo)
│   │   └── docs/                 OpenAPI 3 + Swagger UI
│   └── views/                    Frontend responsive
└── tests/                        Tests, runner nativo de Node
```

---

## Endpoints

**Prefijo** `/api` · **Auth** `Authorization: Bearer <accessToken>` · `?businessId=` para `SUPERADMIN`

### Sistema

| Método | Ruta                           | Qué                                          |
| ------ | ------------------------------ | -------------------------------------------- |
| `GET`  | `/health`                      | Liveness. No consulta la base                |
| `GET`  | `/ready`                       | Readiness. `SELECT 1` · `503` si no responde |
| `GET`  | `/docs` · `/docs/openapi.json` | Swagger UI · OpenAPI 3                       |

### Auth

| Método         | Ruta                                  | Qué                                           |
| -------------- | ------------------------------------- | --------------------------------------------- |
| `POST`         | `/auth/register`                      | Alta de cliente por la puerta de una empresa  |
| `POST`         | `/auth/login`                         | Acceso (global o por `/b/:slug`)              |
| `POST`         | `/auth/refresh`                       | Renovar el access token (rota el refresh)     |
| `POST`         | `/auth/forgot-password`               | Pedir enlace (siempre 200)                    |
| `POST`         | `/auth/reset-password`                | Consumir enlace (un solo uso)                 |
| `GET`          | `/auth/me`                            | Usuario, negocio, rol, settings y nº de citas |
| `POST`         | `/auth/logout`                        | `?todos=true` revoca todas las sesiones       |
| `POST`         | `/auth/password`                      | Cambio de contraseña (expulsa)                |
| `GET` `DELETE` | `/auth/sessions` `/auth/sessions/:id` | Sesiones activas · revocar una                |
| `GET` `PATCH`  | `/auth/settings`                      | Preferencias (opt-in, tema, zona)             |

### Negocios y plataforma

| Método           | Ruta                  | Rol                                       |
| ---------------- | --------------------- | ----------------------------------------- |
| `GET`            | `/negocios`           | 🌐 Empresas activas                       |
| `GET`            | `/negocios/:slug`     | 🌐 Ficha mínima                           |
| `GET` `PATCH`    | `/negocios/settings`  | 🛡️ Retención, recordatorios, canales      |
| `GET` `POST`     | `/super/negocios`     | 👑 Todas · alta con primer admin          |
| `PATCH` `DELETE` | `/super/negocios/:id` | 👑 Editar · baja (el `slug` es inmutable) |

### Usuarios y profesionales _(nuevo)_

| Método                | Ruta                  | Rol                                 |
| --------------------- | --------------------- | ----------------------------------- |
| `GET` `POST`          | `/users`              | 🛡️                                  |
| `GET` `PUT` `DELETE`  | `/users/:id`          | 🛡️ Nunca deja la empresa sin admin  |
| `GET` `POST`          | `/staff`              | 🛡️                                  |
| `GET` `PUT` `DELETE`  | `/staff/:id`          | 🛡️ Baja bloquea sus bloques futuros |
| `GET` `POST`          | `/schedules`          | Plantillas de agenda                |
| `PUT` `DELETE`        | `/schedules/:id`      |                                     |
| `POST`                | `/schedules/generate` | Materializar bloques (idempotente)  |
| `GET` `POST` `DELETE` | `/waitlist`           | Lista de espera                     |

### Clientes, categorías, tareas

| Método               | Ruta                   | Rol                                  |
| -------------------- | ---------------------- | ------------------------------------ |
| `GET` `POST`         | `/clients`             | 🛡️ `?q` `?cursor` `?limit` `?offset` |
| `GET` `PUT`          | `/clients/me`          | 👤 Propia                            |
| `GET`                | `/clients/me/history`  | 👤 Historial propio                  |
| `GET` `PUT` `DELETE` | `/clients/:id`         | 🛡️                                   |
| `GET`                | `/clients/:id/history` | 🛡️ **Historial completo**            |
| `GET` `POST`         | `/categories`          | 🔑 lectura · 🛡️ escritura            |
| `PUT` `DELETE`       | `/categories/:id`      | 🛡️                                   |
| `GET` `POST`         | `/tasks`               | 🔑 (el CLIENT ve las suyas)          |
| `GET` `PUT`          | `/tasks/:id`           | 🔑                                   |
| `DELETE`             | `/tasks/:id`           | 🛡️ Baja lógica                       |

### Disponibilidad

| Método                | Ruta                     | Rol                                        |
| --------------------- | ------------------------ | ------------------------------------------ |
| `GET`                 | `/availability`          | 🔑 El CLIENT ve solo `AVAILABLE` y futuros |
| `POST` `PUT` `DELETE` | `/availability[/:id]`    | 🛡️ Rechaza solapes                         |
| `POST` `DELETE`       | `/availability/:id/hold` | 🔑 Retener / soltar                        |

### Citas

| Método               | Ruta                               | Rol                                           |
| -------------------- | ---------------------------------- | --------------------------------------------- |
| `GET`                | `/appointments/resumen`            | 🔑 Cifras + próximas citas                    |
| `GET` `POST`         | `/appointments`                    | 🔑 Reserva (índice único evita doble booking) |
| `GET` `PUT` `DELETE` | `/appointments/:id`                | 🔑 lectura · 🛡️ resto                         |
| `POST`               | `/appointments/:id/coordinar`      | 🛡️ (envía email + `.ics`)                     |
| `POST`               | `/appointments/:id/completar`      | 🛡️                                            |
| `POST`               | `/appointments/:id/no-show`        | 🛡️ Exige motivo                               |
| `POST`               | `/appointments/:id/rechazar`       | 🛡️ Exige motivo                               |
| `POST`               | `/appointments/:id/cancelar-admin` | 🛡️ Exige motivo, avisa a la lista de espera   |
| `POST`               | `/appointments/:id/cancelar`       | 🔑 El cliente cancela la suya                 |
| `POST`               | `/appointments/:id/checkin`        | 🛡️ Registro de llegada                        |
| `GET` `POST`         | `/appointments/:id/reminders`      | 🛡️                                            |

### Notificaciones, informes, auditoría

| Método   | Ruta                                                | Rol             |
| -------- | --------------------------------------------------- | --------------- |
| `GET`    | `/notifications` · `/notifications/unread-count`    | 🔑              |
| `PATCH`  | `/notifications/read-all` · `/:id/read`             | 🔑              |
| `DELETE` | `/notifications/:id`                                | 🔑 Descartar    |
| `GET`    | `/reports/overview` · `/occupancy`                  | 🛡️              |
| `GET`    | `/reports/services` · `/cancellations` · `/no-show` | 🛡️              |
| `GET`    | `/reports/export`                                   | 🛡️ CSV          |
| `GET`    | `/audit` · `/audit/:entity/:entityId`               | 🛡️ Solo lectura |

### Roles

`🌐` público · `🔑` autenticado · `👤` cliente · `🛡️` admin · `👑` superadmin

---

## Máquina de estados de la cita

```
                     crear por ADMIN
                     (ya coordinada)
                           │
                           ▼
   ┌──────────┐      ┌────────────┐      ┌──────────────┐
   │  PENDING │─────►│ COORDINATED│─────►│  COMPLETED   │  ◄── el hueco NO
   │(reserva) │      │(confirmada)│      └──────────────┘      vuelve a libre
   └────┬─────┘      └──────┬─────┘
        │                   ├──────────────► NO_SHOW ──────┐   (final)
        │                   │                  (no asistio)  │
        ▼                   ▼                                 ▼
   ┌──────────┐      ┌──────────────┐   ┌──────────┐   ┌──────────┐
   │ REJECTED │      │  CANCELLED   │   │ COMPLETED│   │  NO_SHOW │
   └──────────┘      └──────────────┘   └──────────┘   └──────────┘
      final              final              final          final
```

| Desde         | Transiciones                           |
| ------------- | -------------------------------------- |
| `PENDING`     | `COORDINATED`, `CANCELLED`, `REJECTED` |
| `COORDINATED` | `COMPLETED`, `CANCELLED`, `NO_SHOW`    |
| resto         | — finales                              |

| Estado        | Tarea detrás | Hueco                    | Notificación                          |
| ------------- | ------------ | ------------------------ | ------------------------------------- |
| `PENDING`     | `PENDING`    | ocupa                    | interna                               |
| `COORDINATED` | `PENDING`    | ocupa                    | interna + **email con `.ics`**        |
| `COMPLETED`   | `COMPLETED`  | **retiene** (`RESERVED`) | interna                               |
| `NO_SHOW`     | `CANCELLED`  | **retiene** (`RESERVED`) | interna                               |
| `CANCELLED`   | `CANCELLED`  | **libera**               | interna + email + **lista de espera** |
| `REJECTED`    | `CANCELLED`  | **libera**               | interna + email                       |

---

## Ciclo de vida de un hueco

```
  crear → AVAILABLE ──retener──► HELD ──caduca (worker)──► AVAILABLE
              │                     │
              │ reservar            │ soltar
              ▼                     │
          RESERVED ◄───────────────┘
              │
    ┌─────────┼──────────┬────────────┐
    │         │          │            │
 cancelar  completar  no-show      editar
    │         │          │
    ▼         ▼          ▼
AVAILABLE  RESERVED   RESERVED
(liberado) (consumido) (consumido)

  editar → BLOCKED (no ocupa agenda, no bloquea a los demás)
```

**Regla clave:** una cita completada o ausente **no** devuelve el hueco a `AVAILABLE`. Devolverlo lo volvería a poner a la venta para el mismo día y hora, que ya se usó.

---

## Decisiones de diseño

**Todo lo que va en la base que se puede upholdir en la base.** El `service` comprueba antes de escribir para dar un mensaje claro, pero lo que garantiza la integridad es el índice. La aplicación da el mensaje; la base garantiza.

**Baja lógica por defecto, borrado real aparte.** Un `DELETE` de más en un sistema de citas se lleva el historial de un cliente entero. El borrado real existe (`?hard=true`), vive en su propia ruta y no se puede alcanzar desde un formulario.

**El permiso se decide en el router, no en el service.** El service sabe qué reglas de negocio hay; qué quien pueda invocarlas lo sabe el `routes.js`, y en un solo sitio se lee de un vistazo.

**Transiciones de estado como rutas distintas**, no un `PATCH { status }`. El estado de destino no lo elige quien llama.

**Zona horaria en el negocio, no en el servidor.** La agenda se lee con el calendario del navegador, que va en la zona de quien mira.

**Correo fuera de la transacción, nunca bloquea.** Si Resend está caído, la cita ya está confirmada. El único sitio donde se **espera** al correo es la recuperación de contraseña: si el correo no sale, el usuario espera un enlace que no existe y no hay forma de que se entere.

**Un único formato de error**, con todos los campos incorrectos a la vez. Y `details` es siempre una lista.

**El rate limit va en memoria**, con el trade-off documentado. Cambiar a Redis es tocar un archivo.

---

## Scripts

```bash
npm run dev              # watch
npm start                # producción (comprueba el entorno antes)
npm test                 # tests
npm run test:coverage    # con cobertura
npm run lint             # ESLint
npm run format           # Prettier
npm run check            # lint + formato + tests
npm run smoke            # prueba de humo contra un servidor en marcha

# Base de datos
npm run db:migrate       # aplicar migraciones (seguro, no borra nada)
npm run db:migrate:status# ver cuáles faltan
npm run db:setup         # RECONSTRUIR desde cero (pregunta; borra lo que haya)
npm run db:seed          # datos de ejemplo
npm run db:reset         # vaciar conservando el superadmin
npm run db:backup        # copia consistente a backup/
npm run db:studio        # Prisma Studio
npm run db:validate      # comprobar el esquema
```

---

## Despliegue

```bash
npm ci                       # incluye prisma: está en dependencies a propósito
npm run db:migrate           # aplicar migraciones, antes de aceptar tráfico
NODE_ENV=production npm start
```

`prisma` está en `dependencies`, no en `devDependencies`: es lo que permite que
`npm run db:migrate` funcione en una instalación de producción, que se hace con
`npm ci --omit=dev`. Con el CLI en devDependencies, ese comando no existía y
`npx` intentaba descargarlo de la red en cada despliegue.

### Lo que hay que revisar antes de publicar

| Variable              | Por qué                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV=production` | Cambia el log a JSON, el log level a `info`, apaga Swagger y `synchronous=FULL`                                 |
| `JWT_SECRET`          | 48 bytes, **distinto por entorno** y no el de desarrollo                                                        |
| `APP_URL`             | **Obligatoria.** Es la base de los enlaces de correo y del `.ics`. Sin ella la app no arranca                   |
| `CORS_ORIGIN`         | Lista de orígenes, **nunca `*`**. Con `*` la app no arranca                                                     |
| `TRUST_PROXY`         | `1` **solo** si hay exactamente un proxy delante. Mal puesto, un atacante evade los rate limits falseando su IP |
| `DATABASE_URL`        | Ruta **absoluta** en producción, para que no dependa del directorio desde el que se arranque                    |

### Cosas que conviene saber

- **Correo**: ver [`docs/CORREO.md`](docs/CORREO.md) para las opciones (Resend, Gmail,
  Brevo...) y cómo configurar cada una. `npm run email:probar` comprueba si el envío
  funciona sin levantar nada.

- **Health checks**: `/api/health` para liveness y `/api/ready` para readiness. Además,
  el arranque **verifica el esquema**: si faltan las migraciones o el índice
  `Appointment_hueco_vivo_key` (el que impide el doble booking), el proceso no arranca
  en vez de servir 500 a los primeros clientes.
- **Cierre ordenado**: `SIGINT`, `SIGTERM` y `SIGHUP` cierran conexiones, esperan a que
  termine la ronda de jobs en curso y cierran el pool. Hay un margen
  (`SHUTDOWN_TIMEOUT_MS`) para forzar si algo se queda colgado.
- **Varias instancias**: solo una debe tener `JOBS_ENABLED=true`. Con dos corriendo el
  worker, los clientes reciben correos de recordatorio duplicados. Y el rate limit en
  memoria multiplica el tope real por el número de instancias; migrarlo a Redis está
  aislado en `src/middlewares/rateLimit.js`.
- **SQLite**: un fichero, un escritor. Con varias instancias **no** vale: cada una
  escribiría sobre el mismo fichero y los bloqueos se multiplican.

---

## Documentación

- `GET /api/docs` — Swagger UI interactivo (**apagado en producción** por defecto)
- `GET /api/openapi.json` — documento OpenAPI 3, para Postman o generación de clientes
