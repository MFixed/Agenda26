# API de tareas y citas

API REST para gestionar negocios, clientes, tareas, disponibilidad y citas,
construida siguiendo la guia de arquitectura del proyecto: Node.js, Express,
ES Modules, Prisma y PostgreSQL, con las capas Route → Controller → Service → ORM.

El backend sirve ademas el frontend de `views/`, que es una aplicacion estatica
en JavaScript sin build.

## Puesta en marcha

```bash
npm install
cp .env.example .env        # en Windows: copy .env.example .env
npm run prisma:migrate      # crea las tablas
npm run seed                # datos de prueba (opcional)
npm run dev
```

Las variables de correo (`RESEND_API_KEY`, `EMAIL_FROM`) son opcionales: sin ellas
la API funciona igual, solo que no avisa por correo. Ver [Correo](#correo).

- Frontend: `http://localhost:3000/`
- API: `http://localhost:3000/api`
- Documentacion (Swagger UI): `http://localhost:3000/api/docs`

Cuentas del seed:

| Rol       | Puerta                       | Email                  | Contrasena    |
| --------- | ---------------------------- | ---------------------- | ------------- |
| ADMIN     | `/b/ejemplo/login`           | admin@ejemplo.com      | `Admin1234`   |
| CLIENT    | `/b/ejemplo/login`           | ana@ejemplo.com        | `Cliente1234` |
| SUPERADMIN| `/login`                     | super@plataforma.com   | `Super1234`   |

Los botones de "Cuentas de ejemplo" de las pantallas de acceso rellenan el
formulario con estas cuentas: si se cambian, hay que cambiarlos tambien ahi.

## Estructura

```text
index.js                      arranque y cierre ordenado del servidor
config/
  env.js                      lee y valida el .env
  driver.js                   instancia unica del cliente de Prisma
  mailer.js                   instancia unica del cliente de Resend
prisma/
  schema.prisma               esquema canonico (PostgreSQL)
  seed.js                     datos de prueba
  reset.js                    vacia la base y deja solo el superadministrador
src/
  server.js                   arma Express: rutas, estaticos, errores
  pages.routes.js             rutas de las paginas HTML (/admin, /cliente, …)
  api/
    router.js                 punto de montaje de las rutas
    <entidad>/
      <entidad>.routes.js
      <entidad>.controllers.js
      <entidad>.regex.js      formato de los campos de la entidad
      service/<entidad>.service.js
  middlewares/
    auth.js                   JWT, roles, negocio y version del token
    cors.js                   cabeceras CORS
    logger.js                 log de peticiones con morgan
    rateLimit.js              limite de peticiones, en memoria
    security.js               cabeceras de seguridad con helmet
  docs/
    openapi.js                documento OpenAPI (info, tags, ensamblado)
    components.js             esquemas, parametros y respuestas compartidas
    docs.routes.js            monta Swagger UI y sirve el JSON
    paths/<entidad>.js        las rutas de cada entidad, en el documento
  utils/
    errorHandler.js           ApiError + handler global
    regexValidator.js         validadores reutilizables
    dates.js                  fechas de agenda: parseo y formato
    pagination.js             limit/offset y busquedas por texto
    password.js               hash y verificacion con scrypt
views/                        frontend estatico (HTML + CSS + JS)
```

Los services usan Prisma directamente, sin capa `models.js` intermedia: con un
unico ORM no aporta nada. Si se cambia a otro ORM, se toca el service y el resto
de la aplicacion sigue igual.

## Rutas de las paginas

El frontend son HTML estatico, pero sus enlaces no llevan extension:

| Ruta                     | Archivo                     |
| ------------------------ | --------------------------- |
| `/`, `/inicio`           | `views/index.html`          |
| `/login`, `/registro`    | login y registro del equipo |
| `/b/:slug/login`         | puerta de la empresa        |
| `/b/:slug/registro`      | alta de cliente de la empresa |
| `/super`                 | panel de la plataforma      |
| `/admin`                 | panel de administración     |
| `/admin/citas`           | listado de citas            |
| `/admin/calendario`      | calendario                  |
| `/admin/tareas`          | tareas y categorias         |
| `/admin/clientes`        | clientes                    |
| `/cliente`               | panel del cliente           |
| `/cliente/citas`         | historial de citas          |
| `/cliente/perfil`        | perfil y contrasena         |

Cualquier otra direccion devuelve `views/404.html`. Las que empiezan por `/api`
responden JSON, no HTML: quien las pide es el frontend.

## Documentacion de la API

Con el servidor levantado, `http://localhost:3000/api/docs` abre Swagger UI con
las 47 operaciones, agrupadas por entidad y con el boton **Authorize** para pegar
un token y probar de verdad. El JSON plano esta en
`http://localhost:3000/api/docs/openapi.json`: es la fuente, y la pagina solo lo
pinta, asi que un generador de clientes o las pruebas automaticas lo leen sin
pasar por la interfaz.

El documento se escribe a mano en `src/docs/`, separado por entidad, en vez de
generarlo con comentarios en las rutas: la especificacion es parte del contrato
con quien consume la API y asi se puede leer, revisar y versionar sin arrancar
el servidor. Anadir un endpoint es editar su bloque en
`src/docs/paths/<entidad>.js`.

El boton **Authorize** no sustituye al boton de la aplicacion: el token caduca a
las 8h (`JWT_EXPIRES_IN`) y hay que volver a entrar.

Las piezas transversales se controlan desde `.env`:

| Variable       | Para que sirve                                                                            |
| -------------- | ----------------------------------------------------------------------------------------- |
| `DOCS_ENABLED` | `false` apaga la documentacion. En produccion, si no se quiere exponer el mapa de la API. |
| `CORS_ORIGIN`  | Origenes que pueden llamar a la API, separados por comas. Por defecto `*`.                 |
| `LOG_FORMAT`   | Formato del log: `dev`, `combined`, `short`, `tiny`, `common` o `none`.                    |

Los limites de peticiones y las cabeceras de seguridad se configuran en
[Seguridad](#seguridad).

### CORS

Con el frontend servido por el mismo Express, CORS no hace falta en el uso
normal: el navegador no lo pide porque la peticion va al mismo origen. Importa
cuando el panel se abre desde otro host, y entonces `CORS_ORIGIN` decide quien
puede llamar:

```bash
CORS_ORIGIN=http://localhost:5173,https://app.ejemplo.com
```

Sin esa variable el valor es `*`, que es comodo mientras se desarrolla y lo que
no se debe dejar en produccion. La API va con token en la cabecera
`Authorization`, no con cookies, asi que no hace falta permitir credenciales: sin
`credentials` el navegador no manda cookies y una respuesta con
`Access-Control-Allow-Origin: *` sigue siendo valida.

### Log de peticiones

Morgan registra cada peticion con el formato que marque `LOG_FORMAT`: `dev` en
desarrollo, una linea corta y coloreada, y `combined` en produccion, que es el
que trae remoto, user agent y referer para reconstruir un incidente. Los assets
estaticos, la documentacion y `/api/health` quedan fuera: el monitor pregunta la
salud cada pocos segundos y llenaria el log de ruido.

Las paginas no comprueban la sesion: el `data-page` y el script de cada una
validan el token contra `/api/auth/me` y redirigen al panel que corresponda al
rol. Lo que protege los datos es la API.

## Endpoints

| Metodo | Ruta                                     | Acceso              |
| ------ | ---------------------------------------- | ------------------- |
| GET    | `/api/health`                            | publico             |
| POST   | `/api/auth/register`                     | publico             |
| POST   | `/api/auth/login`                        | publico             |
| GET    | `/api/auth/me`                           | autenticado         |
| POST   | `/api/auth/logout`                       | autenticado         |
| POST   | `/api/auth/password`                     | autenticado         |
| GET    | `/api/negocios`                          | publico             |
| GET    | `/api/negocios/:slug`                    | publico             |
| GET    | `/api/super/negocios`                    | SUPERADMIN          |
| POST   | `/api/super/negocios`                    | SUPERADMIN          |
| PATCH  | `/api/super/negocios/:id`                | SUPERADMIN          |
| GET    | `/api/clients`                           | ADMIN, SUPERADMIN   |
| POST   | `/api/clients`                           | ADMIN, SUPERADMIN   |
| GET    | `/api/clients/me`                        | CLIENT              |
| PUT    | `/api/clients/me`                        | CLIENT              |
| GET    | `/api/clients/:id`                       | ADMIN, SUPERADMIN   |
| PUT    | `/api/clients/:id`                       | ADMIN, SUPERADMIN   |
| DELETE | `/api/clients/:id`                       | ADMIN, SUPERADMIN   |
| GET    | `/api/categories`                        | autenticado         |
| POST   | `/api/categories`                        | ADMIN, SUPERADMIN   |
| PUT    | `/api/categories/:id`                    | ADMIN, SUPERADMIN   |
| DELETE | `/api/categories/:id`                    | ADMIN, SUPERADMIN   |
| GET    | `/api/tasks`                             | autenticado         |
| GET    | `/api/tasks/:id`                         | autenticado         |
| POST   | `/api/tasks`                             | autenticado         |
| PUT    | `/api/tasks/:id`                         | autenticado         |
| DELETE | `/api/tasks/:id`                         | ADMIN, SUPERADMIN   |
| GET    | `/api/availability`                      | autenticado         |
| GET    | `/api/availability/:id`                  | autenticado         |
| POST   | `/api/availability`                      | ADMIN, SUPERADMIN   |
| PUT    | `/api/availability/:id`                  | ADMIN, SUPERADMIN   |
| DELETE | `/api/availability/:id`                  | ADMIN, SUPERADMIN   |
| GET    | `/api/appointments`                      | autenticado         |
| GET    | `/api/appointments/resumen`              | autenticado         |
| GET    | `/api/appointments/:id`                  | autenticado         |
| POST   | `/api/appointments`                      | autenticado         |
| PUT    | `/api/appointments/:id`                  | ADMIN, SUPERADMIN   |
| DELETE | `/api/appointments/:id`                  | ADMIN, SUPERADMIN   |
| POST   | `/api/appointments/:id/coordinar`        | ADMIN, SUPERADMIN   |
| POST   | `/api/appointments/:id/completar`        | ADMIN, SUPERADMIN   |
| POST   | `/api/appointments/:id/rechazar`         | ADMIN, SUPERADMIN   |
| POST   | `/api/appointments/:id/cancelar-admin`   | ADMIN, SUPERADMIN   |
| POST   | `/api/appointments/:id/cancelar`         | CLIENT              |
| GET    | `/api/notifications`                     | autenticado         |
| GET    | `/api/notifications/unread-count`        | autenticado         |
| PATCH  | `/api/notifications/read-all`            | autenticado         |
| PATCH  | `/api/notifications/:id/read`            | autenticado         |

Cada accion de cita es una ruta y no un `PATCH` con `{ status }`: asi el estado
de destino no lo escribe quien llama y una transicion invalida no se puede
alcanzar por error.

### Forma de las respuestas

Los listados devuelven `{ items, total }` y el resto de recursos llegan
envueltos en su nombre: `{ cita }`, `{ tarea }`, `{ cliente }`, `{ negocio }`,
`{ disponibilidad }`, `{ categoria }`. Los errores son `{ error }` con una lista
opcional `details` de `{ field, message }`, que el frontend junta debajo del
formulario.

### Filtros

| Listado         | Parámetros                                                     |
| --------------- | -------------------------------------------------------------- |
| `clients`       | `q` (nombre, documento, teléfono, dirección o correo), `limit`, `offset` |
| `tasks`         | `alcance` (`propias`, `de-citas`), `filtro` (`pendientes`, `completadas`, `sin-fecha`, `agendadas`), `estado`, `categoryId`, `clientId`, `q`, `desde`, `hasta`, `limit`, `offset` |
| `availability`  | `desde`, `hasta`, `estado`, `limit`, `offset`                   |
| `appointments`  | `estado`, `clientId`, `q` (cliente o servicio), `desde`, `hasta`, `limit`, `offset` |

Las fechas viajan siempre como `YYYY-MM-DD`, que es lo que aceptan los campos
`<input type="date">` del frontend.

## Seguridad

### Limite de peticiones

`express-rate-limit`, en memoria y sin Redis. Dos limites distintos:

| Limite | Tope | Que corta |
| ------ | ---- | --------- |
| General (`/api`) | 300 por 15 min | Bucles infinitos, reintentos y abuso tonto. |
| Login y registro | 15 fallos por 15 min, por IP y email | Pruebas de contrasena contra una cuenta. |

El del login **cuenta solo los intentos fallidos**. Es la diferencia entre una
proteccion y una trampa: un usuario que entra bien no gasta nada, y uno que se
equivoca cinco veces seguidas tiene que esperar, que es justo lo que hace un
humano y un ataque automatizado no. El tope viene generoso (15) porque un
limitador mal puesto no protege: solo hace que la aplicacion deje de funcionar
para quien la usa de verdad.

La clave del limite de login es `IP + email`, no solo la IP. Por IP sola, un
atacante con muchos correos distintos no se frenaria nunca.

`/api/health` y `/api/docs` estan exentos: un monitor que consulta la salud cada
pocos segundos no puede gastar el cupo de la API ni ser bloqueado.

| Variable                  | Por defecto | Para que sirve                                |
| ------------------------- | ----------- | --------------------------------------------- |
| `RATE_LIMIT_ENABLED`      | `true`      | `false` apaga todos los limites.              |
| `RATE_LIMIT_MAX`          | `300`       | Peticiones por ventana en toda la API.        |
| `RATE_LIMIT_WINDOW_MINUTES` | `15`      | Ventana de los limites, en minutos.           |
| `LOGIN_RATE_LIMIT_MAX`    | `15`        | Intentos fallidos por ventana y por email.    |
| `TRUST_PROXY`             | `1` en produccion | Cuantos proxies hay delante.           |

**Sobre `TRUST_PROXY`.** Con la API detras de un proxy o un balanceador,
`req.ip` es la maquina de al lado y todas las peticiones comparten un mismo
limite: el primero que moleste tumbaria la API entera. Hay que declararlo.
Ponerlo sin que sea verdad es peor que no ponerlo: un cliente podria mandar su
propia cabecera `X-Forwarded-For` y saltarse el limite falseando esa IP.

El limite general en memoria y suficiente mientras corra **una sola instancia**.
Con varias, cada una lleva su cuenta y el tope real es `limite x instancias`;
habria que bajar el limite al repartir. Ese es el trade-off de no depender de
Redis, y cuando haga falta cambiar a un almacen compartido el cambio se queda
en `src/middlewares/rateLimit.js`.

### Cabeceras de seguridad

`helmet` quita `X-Powered-By` y pone el resto: `X-Content-Type-Options`,
`X-Frame-Options`, `Referrer-Policy`, `Origin-Agent-Cluster` y la
`Content-Security-Policy`.

La CSP viene **laxa a proposito**. El frontend es HTML estatico sin build:
`views/index.html` lleva su script como `<script type="module">` embebido y hay
`style="..."` en linea en varias pantallas, asi que sin `'unsafe-inline'` la
aplicacion se quedaria en blanco. Swagger UI tambien lo necesita: su CSS va
dentro de un `<style>` de la pagina. Lo que si queda cerrado es lo que no cuesta:
`object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'` y recursos solo
del propio origen.

`CSP_ENABLED=false` apaga solo la CSP, por si hay que servir recursos de otro
origen. El resto de cabeceras siguen puestas.

### Sesion y cierre de sesion

El JWT lleva dentro `ver`, la version del token del usuario, y la base la tiene
tambien. `authenticate` las compara en cada peticion: si no coinciden, el token
ya no vale.

Es lo que hace que cerrar sesion y cambiar la contrasena expulsen de verdad. Un
JWT es sin estado, asi que por si solo no hay forma de invalidarlo; subir
`tokenVersion` es la version barato de tener una lista de revocados, y no
necesita ni memoria ni Redis porque vive en la base, que ya esta ahi. El coste
es una columna mas y un entero mas en una peticion que ya consultaba al usuario.

Dos consecuencias que conviene conocer:

- **Cerrar sesion en un sitio cierra todos los dispositivos.** No es la sesion la
  que sube, es el token del usuario.
- **Cambiar la contrasena cierra la sesion.** Quien la cambia tiene que volver
  a entrar, y si alguien habia robado un token, se queda fuera. Es lo correcto,
  pero el frontend tiene que avisar: la respuesta lo dice y hay que borrar el
  token.

El token tampoco viaja al cliente por la respuesta: `USER_PUBLICO` lo saca igual
que saca `passwordHash`.

### Puertas abiertas

`POST /api/auth/register` es la puerta abierta de la plataforma, sin token. Por
eso:

- Va con el mismo limite de intentos que el login.
- Un email ya registrado responde `409` con un mensaje que **no** dice que campo
  fue el que choco. Con un mensaje como "ese email ya esta registrado" se podria
  recorrer correos y sacar la lista de clientes de la plataforma. El login ya
  estaba protegido asi (mismo error para email inexistente y clave mala); el
  registro no, y ahora si.

No hace falta proteccion CSRF: el token va en la cabecera `Authorization`, no en
una cookie, asi que el navegador no lo manda solo.

## Reglas de negocio

- **Puertas por empresa.** Cada negocio tiene su identificador y su propia puerta
  (`/b/:slug/login`). Entrar por la puerta de otra empresa con una cuenta que no
  es de ahí es `403`; contra un identificador inexistente o una empresa
  desactivada se responde `404`.
- **Reserva de cita.** Crear una cita crea tambien la tarea del servicio, la deja
  agendada en el horario, marca el bloque como `RESERVED` y apunta el primer
  evento y la notificacion, todo en una misma transaccion. O pasa todo, o el
  bloque sigue libre.
- **Transiciones de estado.** `PENDING → COORDINATED → COMPLETED`, y desde
  `PENDING` o `COORDINATED` se puede pasar a `CANCELLED` o `REJECTED`. Los
  estados finales no admiten mas cambios.
- **La tarea sigue a la cita.** Al completar, cancelar o rechazar una cita, la
  tarea que tiene detras pasa al estado equivalente; al reprogramarla se mueve de
  fecha y hora.
- **Aviso por correo de la coordinacion.** Al pasar una cita a `COORDINATED`, al
  cliente le llega un correo con el detalle y un `.ics` adjunto para que la
  agregue a su calendario. Ocurre tambien cuando la cita se crea ya
  coordinada.
- **Liberacion del bloque.** Al pasar a `CANCELLED` o `REJECTED` el bloque vuelve
  a `AVAILABLE` si no quedan citas que lo retengan encima. Lo mismo al borrar una
  cita, una tarea o un cliente: los horarios se liberan despues del borrado,
  cuando las citas ya no existen.
- **Un bloque completado no se devuelve.** Al pasar a `COMPLETED` el bloque se
  queda en `RESERVED`: el cliente ya no lo ve (la agenda solo muestra
  `AVAILABLE`) y una reserva nueva sobre el mismo horario da `409`. El rato se
  consumio al realizar la cita y no vuelve a ponerse a la venta. Cancelar o
  rechazar si lo sueltan, porque la cita no llego a celebrarse.
- **Borrar tampoco lo devuelve.** Borrar una cita completada, la tarea que creo o
  la ficha del cliente **no** libera su bloque. Si lo hiciera, la regla de
  arriba se esquivaria por la puerta de atras: bastaba con borrar el registro
  para devolver la franja a la venta.

  Esto tiene un coste que hay que conocer: dar de baja a un cliente con citas
  completadas deja sus franjas marcadas como consumidas, y no se pueden volver a
  usar aunque se publique la agenda entera. Es la decision que se tomo
  deliberadamente: "un horario realizado no se reutiliza" pesa mas que "las
  franjas de un cliente que se fue vuelven a estar libres". Un bloque asi se
  limpia borrando el bloque, que para entonces ya no tiene citas encima.
- **Sin solapamientos.** No se pueden publicar horarios que se pisen en el mismo
  negocio y fecha.
- **Aislamiento por cliente.** Cada cliente solo ve sus propias citas y
  notificaciones. Sobre una cita ajena responde `404`, no `403`: no se confirma
  que exista.
- **Aislamiento por negocio.** Un usuario queda atado a su negocio; el SUPERADMIN
  puede indicar `?businessId=` con el que opera.
- **Roles.** El cliente puede crear tareas para si mismo, reservar y cancelar sus
  citas y editar su perfil. No puede tocar categorias, clientes, bloques de agenda
  ni negocios.

## Correo

Cuando una cita pasa a `COORDINATED` el cliente recibe un aviso por correo con el
servicio, la fecha, el horario y el negocio, y un archivo `.ics` adjunto para que
la cita caiga en su calendario (Google Calendar, Outlook, Apple Calendar) con un
clic. El aviso sale al coordinar la cita y tambien cuando la administracion la
registra ya coordinada desde cero.

El envio lo hace [Resend](https://resend.com) y necesita tres variables de `.env`:

| Variable          | Para que sirve                                                          |
| ----------------- | ----------------------------------------------------------------------- |
| `RESEND_API_KEY`  | Clave de la API de Resend. Sin ella no se manda correo.                 |
| `EMAIL_FROM`      | Remitente. Debe ser un dominio verificado en resend.com.                |
| `APP_URL`         | Base publica de la aplicacion; el correo la usa para apuntar al panel.  |
| `EMAIL_TEST_DESTINO` | Solo desarrollo. Ver abajo.                                         |

Sin `RESEND_API_KEY` la API arranca igual y el cambio de estado se guarda sin
correo: solo queda la notificacion interna de la campana del panel.

`onboarding@resend.dev` sirve para una prueba suelta, pero Resend solo lo deja
enviar al correo del titular de la cuenta: cualquier otro destinatario rebota
con `403 You can only send testing emails to your own email address`. No es un
limite de cantidad de correos, es de destinatario.

`EMAIL_TEST_DESTINO` sortea eso mientras se desarrolla. Con la variable puesta,
los avisos salen a esa direccion en vez de al cliente, y la consola deja
constancia:

```
[correo] EMAIL_TEST_DESTINO activo: "Tu cita esta confirmada: Corte" va a
tucorreo@ejemplo.com (el cliente maxipastore@hotmail.com no lo recibe)
```

Con `NODE_ENV=production` la variable se ignora aunque este en `.env`: los avisos
van siempre a su destinatario real. Para avisos reales hay que verificar un
dominio en resend.com y poner ese dominio en `EMAIL_FROM`; despues se saca
`EMAIL_TEST_DESTINO`.

Tres cosas que conviene tener presentes:

- **El correo no bloquea.** Se manda despues del commit y sin esperar a que
  responda: la coordinacion ya esta guardada. Si Resend falla, se registra en la
  consola y la cita sigue confirmada igual.
- **El aviso es fire and forget.** No queda registro de que se mando en la base:
  la notificacion interna del panel es la que se guarda.
- **El `.ics` va en hora local sin zona** (`DTSTART;20261020T090000`), porque el
  modelo guarda el dia y la franja del negocio, no un instante con zona horaria.
  El `UID` sale del id de la cita, así que al reprogramarla el calendario del
  cliente actualiza el evento en vez de duplicarlo.

## Pruebas

`prueba.sh` necesita la base con los datos del seed (`npm run seed`): entra con
`admin@ejemplo.com` y `ana@ejemplo.com`, que son las cuentas de ejemplo. Sin
ellos falla en la seccion 3.

Va con los limites de peticiones apagados (`RATE_LIMIT_ENABLED=false`): 190
peticiones seguidas contra la API real no son un trafico hostil sino una
comprobacion, y con los limites puestos se bloquearia a si mismo.

```bash
RATE_LIMIT_ENABLED=false npm start   # en una terminal
bash prueba.sh                       # en otra
```

190 comprobaciones contra la API real y las paginas: salud, rutas HTML, puertas
de acceso, autenticacion, validacion de entrada, permisos por rol, publicacion y
solapamiento de horarios, reserva, transiciones de estado, reprogramacion,
liberacion de bloques, historial, notificaciones, bajas en cascada, aislamiento
entre clientes y entre empresas. La seccion 18 comprueba que los campos que el
frontend lee siguen existiendo con el mismo nombre, y la 19 las cabeceras de
seguridad.

Entre las 190 estan las que comprueban que el cierre de sesion invalida el token
de verdad y que se puede volver a entrar despues.

El script usa fechas, documentos, correos e identificadores propios de cada
ejecucion, asi que se puede correr varias veces seguidas.

Los limites van en `prueba-limite.sh`, aparte, porque necesitan el servidor
arrancado con los topes bajos. Los dos se prueban por separado porque comparten
la IP: con los dos bajos a la vez, el general se agota primero y el del login no
llega a verse.

```bash
# Limite del login (4 intentos fallidos por ventana)
RATE_LIMIT_MAX=300 LOGIN_RATE_LIMIT_MAX=4 npm start
bash prueba-limite.sh login

# Limite general (5 peticiones por ventana)
RATE_LIMIT_MAX=5 LOGIN_RATE_LIMIT_MAX=300 npm start
bash prueba-limite.sh general
```

Comprueba que el login corta los intentos fallidos, que un acceso correcto no
gasta cupo, que el limite es por email y no arrastra a otros usuarios, que
`/api/health` y `/api/docs` quedan exentos, y que el error del limite sale con
la forma de la API (`{ error }`) y no como texto plano.

## PostgreSQL y SQLite

El esquema canonico es PostgreSQL. Para correr la API en local sin instalar
PostgreSQL, hay un esquema SQLite derivado por script:

```bash
npm run prisma:sqlite:migrate   # genera el esquema SQLite y aplica la migracion
npm run seed
npm start
```

`scripts/sqlite-schema.mjs` transforma `prisma/schema.prisma` cambiando el
provider y convirtiendo los enums en `String`. El codigo nunca importa los tipos
del cliente de Prisma, trabaja con strings, asi que el mismo service corre sobre
las dos bases. El `.env` de este repositorio apunta a `file:./dev.db`; para
volver a PostgreSQL basta restaurar la `DATABASE_URL` del `.env.example` y
ejecutar `npm run prisma:generate`.

## Vaciar la base

```bash
npm run db:reset              # pregunta antes de borrar
npm run db:reset -- --force   # borra sin preguntar
```

Deja **solo el superadministrador** y borra empresas, clientes, tareas,
horarios, citas, historial y notificaciones. Es lo que hay que correr cuando la
base se ha llenado de datos de prueba: `prueba.sh` deja un negocio y sus
clientes en cada corrida, y `POST /super/negocios` deja una empresa cada vez que
se prueba el panel.

Detalles que hacen que sea seguro repetirlo:

- **El superadministrador se respeta.** No se borra para recrearlo con otro id.
  Es la cuenta con la que se entra despues.
- **No toca su contrasena.** Si ya existe, se limita a asegurar que sea
  `SUPERADMIN`, activo y sin empresa. Un reset no devuelve la clave de ejemplo
  sin querer.
- **El borrado va en orden inverso al de las relaciones**, porque las claves
  foraneas no dejan borrar un padre que todavia tiene hijos.
- **Lista lo que va a borrar antes de hacerlo**, y sin terminal (`--force` sin
  confirmar) se sale en vez de borrar por sorpresa.

Sin `npm run seed` no hay ninguna empresa, asi que solo se puede entrar por
`/login` con el superadministrador y crear la primera desde su panel. Con
`npm run seed` vuelven los datos de ejemplo del [principio](#puesta-en-marcha).