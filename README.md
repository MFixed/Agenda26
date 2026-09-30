# Gestión de tareas, clientes y citas

Aplicación web completa para administrar usuarios, clientes, tareas, categorías,
disponibilidad horaria, citas, calendario e historial, con **Express**,
**Prisma ORM** y **SQLite** en el backend y **JavaScript vanilla** en el
frontend. Un mismo login identifica **clientes** y **administradores**: lo que
decide el panel es el rol de la cuenta.

## Arranque

Hace falta **PostgreSQL**. No hay modo SQLite: el proveedor del esquema es
`postgresql` y el código usa `mode: "insensitive"` en la búsqueda de clientes,
que Prisma sólo acepta en PostgreSQL y MongoDB.

### Con Docker (lo más rápido)

```bash
docker run -d --name agenda-postgres \\
  -e POSTGRES_PASSWORD=agenda123 \\
  -e POSTGRES_DB=agenda \\
  -p 5432:5432 postgres:17

cp .env.example .env      # y pon la URL de abajo
```

Y en `.env`:

```bash
DATABASE_URL="postgresql://postgres:agenda123@localhost:5432/agenda"
```

### Con PostgreSQL instalado en Windows

Igual, pero sin la primera línea. La URL va con la contraseña y el puerto que
hayas puesto al instalar.

### Puesta en marcha

```bash
npm install
npm run prisma:generate   # genera el cliente; el motor es específico del sistema
npm run prisma:deploy     # crea las tablas
npm run db:seed           # datos de ejemplo
npm run dev               # http://localhost:3000
```

**`prisma:generate` es obligatorio y no es opcional.** El motor de Prisma
descarga un binario para el sistema operativo, así que el que se genera en
Windows no vale en Linux. Si despliegas sin regenerar, en el servidor falla con un
error de motor que no tiene nada que ver con tu código.

### Cuentas del seed

| Correo | Contraseña | Rol |
| --- | --- | --- |
| `admin@ejemplo.com` | `Admin1234` | administración |
| `ana@ejemplo.com` | `Cliente1234` | cliente |
| `luis@ejemplo.com` | `Cliente1234` | cliente |
## Rutas

| Ruta | Quién |
| --- | --- |
| `/inicio` · `/login` · `/registro` | público |
| `/admin` · `/admin/citas` · `/admin/calendario` · `/admin/tareas` · `/admin/clientes` | sólo ADMIN |
| `/cliente` · `/cliente/citas` · `/cliente/perfil` | sólo CLIENT |

El rol se comprueba en el navegador para pintar el panel adecuado, y **en la
API** para todo lo demás: cambiar una URL a mano no da acceso a nada.

## El concepto

```
TAREA          = qué hay que hacer      (puede existir sola, sin fecha y sin cita)
CLIENTE        = para quién             (perfil 1:1 de un usuario con rol CLIENT)
DISPONIBILIDAD = cuándo hay hueco       (la crea el administrador)
CITA           = TAREA + CLIENTE + DISPONIBILIDAD
```

Nada se duplica: el nombre del servicio y la fecha se leen de `Task` y de
`Availability`, nunca se copian en `Appointment`.

## Decisiones que conviene conocer

**1. El bloqueo de un horario es un compare-and-swap sobre `Availability`.**

Reservar es un UPDATE condicional dentro de una transacción:

```sql
UPDATE Availability SET status='HELD' WHERE id=? AND status='AVAILABLE'
```

Si otra petición cambió el estado antes, el UPDATE no afecta a ninguna fila y la
segunda reserva falla con un 409. SQLite serializa las escrituras, así que dos
clientes simultáneos no pueden quedarse con el mismo hueco.

Por eso `Appointment.availabilityId` **no** lleva `UNIQUE`: un horario rechazado
o cancelado tiene que poder volver a reservarse. Si se pusiera la restricción, el
hueco quedaría inutilizado para siempre.

**2. Estados de la disponibilidad:** `AVAILABLE` → `HELD` (cita en espera) →
`RESERVED` (confirmada) → `AVAILABLE` si se rechaza o cancela. `BLOCKED` es un
hueco que el administrador ha cerrado a propósito.

**3. `Task.dueDate = NULL` significa "sin fecha".** Nunca se guarda una fecha
ficticia ni `01/01/1970`. La vista "Tareas sin fecha" filtra por `IS NULL`.

**4. Las citas no se borran con `availabilityId` único**, y la tarea que origina
una cita no se destruye al cancelarla: la tarea es "qué hay que hacer" y no
depende de la reserva.

**5. Todo cambio de estado deja rastro** en `AppointmentEvent` con su autor y su
fecha, y genera la notificación correspondiente en la misma transacción.

**6. `Client` no duplica el email ni la contraseña**: viven en `User`. El perfil
del cliente edita ambos a la vez porque son la misma persona, pero cada dato
tiene una sola casa.

## Convenciones de fechas

Ver `src/utils/date.js`, que es la única fuente de verdad:

| Dato | Almacenamiento | Lo que ve el usuario | Devuelto por la API |
| --- | --- | --- | --- |
| Fechas sin hora (`dueDate`, `Availability.date`, `fechaNacimiento`) | `DateTime` en medianoche **UTC** | `30/09/2026` | `"2026-09-30"` |
| Horas (`startTime`, `endTime`, `dueTime`) | `String` `"HH:mm"` | `15:00` | `"15:00"` |
| Marcas de tiempo (`createdAt`, `updatedAt`) | `DateTime` | `28/09/2026 14:05` | ISO 8601 UTC |

Se usa medianoche UTC para que el mismo dato produzca el mismo día en cualquier
zona horaria del servidor. Las horas son hora local del negocio y se guardan como
texto, porque SQLite no tiene tipo hora y meter una `DateTime` para "las 15:00"
sería un artificial. Prisma guarda los `DateTime` en SQLite como enteros de
milisegundos epoch, que es lo que permite ordenar y filtrar por fecha.

## API

| Método y ruta | Acceso |
| --- | --- |
| `GET /api/health` | público (estado y diagnóstico; 503 si la base falla) |
| `POST /api/auth/register` | público (siempre `role: CLIENT`) |
| `POST /api/auth/login` | público |
| `POST /api/auth/logout` | sesión |
| `GET /api/auth/me` | sesión |
| `POST /api/auth/password` | sesión |
| `GET /api/clients` · `POST /api/clients` | ADMIN |
| `GET /api/clients/:id` · `PUT` · `DELETE` | admin o el propio cliente |
| `GET /api/clients/me` · `PUT /api/clients/me` | el propio cliente |
| `GET /api/categories` | ambos |
| `POST/PUT/DELETE /api/categories` | ADMIN |
| `GET /api/tasks` · `GET /:id` | listar, ADMIN; detalle, admin o dueño |
| `POST/PUT/DELETE /api/tasks` | ADMIN |
| `GET /api/availability` · `/huecos` | ambos (el cliente sólo ve huecos libres) |
| `POST/PUT/DELETE /api/availability` | ADMIN |
| `GET /api/appointments` | admin: todas · cliente: las suyas |
| `POST /api/appointments` | cliente: solicita · admin: registra por un cliente |
| `GET /api/appointments/:id` · `/:id/historial` | admin o dueño |
| `POST /api/appointments/:id/cancelar` | el propio cliente, sólo si está PENDING |
| `POST /:id/coordinar` · `/rechazar` · `/completar` · `/cancelar-admin` | ADMIN |
| `PUT /api/appointments/:id` | ADMIN (nota o reprogramación) |
| `DELETE /api/appointments/:id` | ADMIN |
| `GET /api/notifications` · `PUT /:id/read` · `PUT /read-all` | sesión (sólo las propias) |

Las transiciones de estado son rutas explícitas y no un `PATCH` con un `status`
libre: cada transición tiene sus requisitos y no se puede saltar de estado desde
el frontend.

## Seguridad

- Contraseñas con **scrypt** (`node:crypto`, sin bcrypt) y sal de 16 bytes. Los
  parámetros se guardan dentro de la cadena, así que subirlos no rompe las
  cuentas existentes. Comparación en tiempo constante.
- El hash nunca sale por la API: `utils/serialize.js` es el único que construye
  los objetos públicos.
- Si el correo no existe se verifica la contraseña contra un hash señuelo, para
  que el tiempo de respuesta no revele qué correos están dados de alta, y el
  mensaje de error es idéntico en ambos casos.
- El token JWT es mínimo (`sub`, `rol`) y **el rol y el estado se vuelven a leer
  de la base de datos en cada petición**: una baja o un cambio de rol surte efecto
  al instante, sin esperar a que caduque el token.
- Los ids de las rutas se validan antes de tocar la base de datos, y los filtros
  de listado imponen el `clientId` del propio cliente: un `?clientId=` en la URL
  no abre datos de otro.
- Validación por campo con lista blanca: se rechaza cualquier campo no permitido
  en el cuerpo (así nadie se auto-asigna el rol), se recortan longitudes y se
  devuelven los errores por campo (`422 { error, details }`).
- Manejador de errores centralizado: al cliente nunca se le filtra un mensaje de
  Prisma ni un nombre de columna.
- Cabeceras `X-Content-Type-Options`, `X-Frame-Options` y `Referrer-Policy` sin
  helmet.

**Para producción**: el token vive en `localStorage`, que es cómodo pero queda
expuesto a XSS. Si el despliegue lo permite, muévelo a una cookie `HttpOnly` +
`SameSite=Strict`; el resto de la estructura se mantiene igual.

# Despliegue en Render

Hay un `render.yaml` en la raíz. Si lo apuntas en **Dashboard > New > Blueprint**,
Render se configura solo. Antes hay que crear la base de datos en el panel
(**New > Postgres**) con el nombre que aparece abajo en el fichero.

### La base ya está creada y migrada

`prisma/migrations/20260930124037_inicial_postgresql` está aplicada en la base de
Render: 8 tablas, 5 enums, 22 índices, 7 claves foráneas con ON DELETE CASCADE y
el UNIQUE de `(date, startTime)`. **Sube el repositorio tal cual: no vuelvas a
borrar las migraciones ni a ejecutarlas a mano**, que si no la base y el historial
se desincronizan.

### La contraseña no va en el repositorio

Está en `.env`, que está en el `.gitignore` y no se sube. En Render la URL la
rellena el propio `render.yaml` con `fromDatabase`, así que **tampoco hay que
pegarla en el panel**.

Y dicho esto, que es lo importante: **cambia esa contraseña antes de nada.** Ha
ido escrita en un chat, en el log de un despliegue y en el `.env` de tu máquina.
En el panel, *Settings → Database*, o.reset* la base y te dará una nueva. Es
sano hacerlo ahora, con la base recién creada y sin datos que perder.

### La URL de Render Postgres no vale tal cual

Render entrega la conexión pelada:

```
postgresql://usuario:clave:dgrc-xxxxx/gestion
```

Faltan dos parámetros, y sin ellos falla o se agota:

| Parámetro | Por qué |
|---|---|
| `?sslmode=require` | Render exige TLS |
| `&connection_limit=1` | El plan gratuito limita las conexiones y Prisma abre un pool por defecto que las agota |

Con `fromDatabase` en el `render.yaml` no hay que pegar la URL: Render añade lo
que hace falta. Si la escribes a mano, con esos parámetros.

### P3019: las migraciones no se pueden cambiar de proveedor

Si alguna vez el esquema dice `postgresql` y las migraciones son de SQLite, el
despliegue se para así:

```
Error: P3019
The datasource provider `postgresql` specified in your schema does not match
the one specified in the migration_lock.toml, `sqlite`.
```

Las dos migraciones que había estaban escritas en dialecto de SQLite, con
`AUTOINCREMENT`, `DATETIME`, `TEXT` y `PRAGMA`, que PostgreSQL no entiende. Hay
que rehacer el historial entero, y son **tres** cosas:

1. `prisma/schema.prisma` con `provider = "postgresql"`
2. `prisma/migrations/` borrada y generada de cero
3. `prisma/migrations/migration_lock.toml` con `provider = "postgresql"`

El paso 3 es el que más se olvida, y es el que vuelve a dar P3019: el fichero
tiene que estar **dentro** de `prisma/migrations/`. Uno puesto en
`prisma/migration_lock.toml` no lo lee nadie.

### Cómo se genera sin base de datos

`prisma migrate dev` necesita una base conectada. Para rehacer el historial no
hace falta: `migrate diff` genera el SQL desde el esquema solo.

```bash
npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script
```

El nombre de la carpeta tiene que ser 14 dígitos y un guion bajo
(`20260930124037_inicial_postgresql`). Con una `T` de más en medio, Prisma no la ve
y no aplica nada sin avisar.

### Las transacciones necesitan más tiempo

Prisma corta las transacciones interactivas a los **5 segundos**. Ese valor se
calibró con SQLite en local, donde cada consulta es una llamada a un fichero.
Contra PostgreSQL en otra máquina cada consulta es un viaje de ida y vuelta, y una
transacción que bloquea un hueco se pasa:

```
P2028: Transaction already closed. The timeout for this transaction was 5000 ms
```

Salió la primera vez que se ejecutó el flujo de reservas contra la base de
Render. Las ocho transacciones de `appointment.service.js` y `client.service.js`
usan ya `enTransaccion()`, que sube el límite a 20 s. Si añades transacciones
nuevas, usa ese helper y no `prisma.$transaction` a pelo.

### La versión de Node

`package.json` declara `">=20.19.0 <25"`. El techo está a propósito: sin él,
Render instala la última Node que exista —la 26 cuando se escribió esto— que es
más nueva que Prisma 6.19.3, y el despliegue se rompe sin que nadie haya tocado
el proyecto.

### El build command y el start command no son intercambiables

Poner `npx prisma migrate deploy && node src/server.js` en el campo de **build**
arranca el servidor durante la compilación. Cuando el build acaba, Render mata el
proceso, y como el build no ha instalado nunca las dependencias, el fallo
siguiente será otro distinto y no tendrá nada que ver con la causa.

| Campo | Qué va |
|---|---|
| Build | `npm ci && npx prisma generate` |
| Start | `npm run start:prod` (migra y luego arranca) |

`npm ci` **no** es opcional: si el repositorio lleva `node_modules` subido, son
los binarios de Windows y el motor de Prisma no arranca en Linux. Son los 165 MB
de la primera descarga.

### Los fallos y lo que se veía en el navegador

Por qué existe `/api/health`: sin él, estos son indistinguibles desde el
navegador, porque los tres contestaban `"Error interno del servidor."`.

| Lo que pasa por debajo | Lo que se veía |
|---|---|
| `DATABASE_URL` sin definir | 500, sin explicación |
| `DATABASE_URL` con la URL de SQLite y el esquema en postgres | 503, diciendo que falta |
| Migraciones sin aplicar | 500, sin explicación |

Ahora los tres devuelven **503 con el motivo y el arreglo**, y `GET /api/health`
los distingue. Es la primera URL que hay que abrir cuando algo va mal, antes que
el registro del servidor: el registro de un despliegue se lee una vez y se pierde
en el siguiente.

### La búsqueda de clientes estaba rota con SQLite

`mode: "insensitive"` sólo existe en PostgreSQL y MongoDB. Con el conector de
SQLite la consulta lanzaba:

```
Unknown argument `mode`. Did you mean `lte`?
```

Es decir, **cualquier búsqueda en `/admin/clientes` devolvía un 500** desde el
principio, y no se notó porque no había ninguna prueba de búsqueda. Ahora hay
tres, y con PostgreSQL funcionan.

### Primera puesta en marcha

Las migraciones crean las tablas vacías. Para tener datos con los que entrar, desde
la consola de Render (o en local):

```bash
npm run db:seed     # admin@ejemplo.com / Admin1234
npm run simular     # 10 clientes y 10 citas de ejemplo
```

Ojo: `db:seed` **borra la base** antes de rellenarla. En un despliegue nuevo no
importa, pero no lo ejecutes encima de datos que te importen.

**Y cambia las contraseñas del seed antes de enseñarle esto a nadie.** Son
públicas: `admin@ejemplo.com / Admin1234` está en el repositorio.

### Si te quedas sin PostgreSQL: SQLite con disco

No hace falta cambiar de motor. Con SQLite el `render.yaml` sería distinto: lleva
un `disk` y la URL es `file:/opt/render/project/src/data/agenda.db`. El problema
es que **el disco persistente requiere un plan de pago** y SQLite sin disco se
vacía en cada despliegue.

### Lo que no aguanta

- **`mode: "insensitive"` obliga a PostgreSQL.** No hay marcha atrás al motor
  SQLite con el código como está.
- **`data/.jwt-secret`.** En local se guarda en un fichero y las sesiones
  sobreviven a un reinicio. En Render ese directorio es efímero, así que sólo
  sirve si `JWT_SECRET` está en el entorno. Si no lo está, funciona y avisa.

## Pruebas

```bash
npm test              # 47 pruebas: reglas de negocio, capa HTTP y despliegue
npm run check:imports # comprueba que todos los imports existen
npm run escenario     # los 30 puntos del escenario de aceptación, sobre el servidor
```

`npm test` cubre el flujo completo de reserva, el bloqueo de horarios, las
transiciones inválidas, la reutilización de un hueco rechazado, el aislamiento
entre clientes y la validación de entrada. `npm run escenario` recorre los 30
puntos de §29 contra el servidor arrancado y limpia lo que crea.

## Estructura

```
prisma/
  schema.prisma        8 modelos normalizados, enums, índices y UNIQUE
  seed.js              datos deterministas
src/
  app.js               Express, cabeceras y montaje de rutas
  server.js            punto de entrada (app.js se importa sin abrir el puerto)
  config/              PrismaClient y configuración
  routes/              7 routers, uno por recurso
  controllers/         traducen HTTP <-> servicios
  services/            reglas de negocio y transacciones
  middleware/          authenticate, requireAdmin/Client, errores, validación
  validators/          reglas por campo y por payload
  utils/               password, jwt, date, http, serialize
public/
  index.html login.html register.html 404.html
  admin/               dashboard, calendar, tasks, appointments, clients
  client/              dashboard, appointments, profile
  css/app.css
  js/                  api.js (capa de API), ui.js (piezas comunes) y un
                       fichero por página
test/                  reglas.test.js (servicios) y api.test.js (HTTP)
scripts/               escenario.js, simulacion.js, limpiar.js, estado.js,
                       comprobar-imports.mjs
```

Dependencias: `express`, `jsonwebtoken` y `@prisma/client`. Nada más — sin
bcrypt, helmet, cors, dotenv, ejs, bundler ni framework de frontend. Prisma trae
su propio generador de cliente, así que no hay paso de compilación aparte.

## Utilidades

```bash
npm run dev            # con recarga automática
npm start              # sin recarga
npm run prisma:studio  # explorador de la base de datos
npm run reset -- --seed   # borra la base y vuelve a migrar + seed (prueba desde cero)
npm run reset          # borra la base y la deja vacía, sin seed
npm run simular        # 10 clientes, 10 citas y unas pocas tareas propias
npm run simular -- --limpiar  # borra sólo lo que creó la simulación
npm run estado         # qué hay ahora mismo en cada tabla
```

`npm run reset` borra también `data/.jwt-secret`, así que las sesiones de la
ejecución anterior dejan de valer y todo empieza de verdad.

## Simulación de usuarios

`SIMULACION-USUARIOS.md` no forma parte de la aplicación: es un documento de
trabajo con 15 perfiles simulados de 10 rubros distintos, lo que piden de la
aplicación, lo que les sobra, qué precio aceptarían y una hoja de ruta de
mejoras. **Las personas son ficticias y los precios de mercado que se citan
como referencia sí son reales** (recogidos en septiembre de 2026). El propio
documento explica cómo sustituir la simulación por entrevistas reales. No lo
tomes por investigación de mercado.

## Simulación de datos

`npm run simular` crea 10 clientes con cuenta (`cliente01@simulacion.local` …
`cliente10@simulacion.local`, contraseña `Cliente1234`) y 10 citas repartidas
por todos los estados, más 10 horarios publicados para los días siguientes. Las
citas no se escriben a mano: la pide cada cliente con el servicio real y luego el
administrador las mueve, de modo que quedan historial, notificaciones y
disponibilidad bloqueada como en producción. Los datos son fijos, sin números
aleatorios, y repetir la simulación da el mismo resultado.

No toca al administrador ni a los clientes del seed. Para quitar sólo lo suyo,
`npm run simular -- --limpiar`.

### Tareas propias frente a tareas de cita

Cada cita registrada genera también una tarea. Con 10 citas son 10 tareas más en
la base, y en la lista de trabajo del administrador eso es ruido: ya se gestionan
en "Citas" y en el calendario. Por eso las tareas se pueden pedir con un
alcance, que se combina con cualquier filtro:

| Alcance | Qué trae |
| --- | --- |
| `alcance=propias` (por defecto en `/admin/tareas`) | las sueltas del administrador |
| `alcance=de-citas` | las que nacieron de una cita |
| sin alcance | todas |

Las tarjetas de resumen respetan el alcance de la vista activa, y la lista
avisa de cuántas quedan fuera y enlaza a la vista que las trae. El panel y el
calendario cuentan con el mismo alcance, así que las cifras de un sitio y otro
no se contradicen.
