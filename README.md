# Gestión de tareas, clientes y citas

Aplicación web completa para administrar usuarios, clientes, tareas, categorías,
disponibilidad horaria, citas, calendario e historial, con **Express**,
**Prisma ORM** y **SQLite** en el backend y **JavaScript vanilla** en el
frontend. Un mismo login identifica **clientes** y **administradores**: lo que
decide el panel es el rol de la cuenta.

## Arranque

```bash
npm install
npx prisma migrate dev     # crea prisma/dev.db
npx prisma db seed         # datos de ejemplo deterministas
npm run dev                # http://localhost:3000
```

## Cuentas del seed

| Rol | Correo | Contraseña |
| --- | --- | --- |
| Administración | `admin@ejemplo.com` | `Admin1234` |
| Cliente | `ana@ejemplo.com` | `Cliente1234` |
| Cliente | `luis@ejemplo.com` | `Cliente1234` |

Cámbialas en cuanto entres. Para crear otro administrador, edita `prisma/seed.js`
o da de alta un cliente desde el panel y cambia su rol en la base de datos.

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

## Pruebas

```bash
npm test              # 38 pruebas: reglas de negocio y capa HTTP
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
