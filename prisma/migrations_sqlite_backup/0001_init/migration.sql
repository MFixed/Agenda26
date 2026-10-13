-- Agenda26 v2 · Esquema inicial en SQLite3.
--
-- Este archivo es la fuente. `prisma migrate deploy` lo aplica entero.
--
-- Lo que cambia respecto a PostgreSQL y POR QUE:
--
--  - `INTEGER PRIMARY KEY AUTOINCREMENT` en vez de `SERIAL`. AUTOINCREMENT
--    garantiza que un id borrado no se reutiliza nunca, que es justo lo que hace
--    mal una cita y luego aparece como "cita 12" en el historial de otra.
--
--  - `TEXT` en vez de `VARCHAR(n)`. SQLite no aplica longitud: el limite se
--    comprueba en el service, que es donde estan los mensajes de error utiles.
--
--  - Sin tipos ENUM. SQLite no los tiene. Los valores permitidos estan en
--    `schema.prisma` como comentario y los valida `validateOneOf` en cada
--    `.validation.js`. SQLite acepta cualquier texto, asi que una escritura
--    directa por consola se saltaria la validacion: es el precio de SQLite y
--    compensa en desarrollo.
--
--  - Sin extension `pg_trgm`. La busqueda por texto usa `LIKE '%x%'`, que es un
--    recorrido de tabla. Con la base de desarrollo va bien; si algun dia hay que
--    buscar entre miles de filas, la solucion en SQLite es FTS5.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

CREATE TABLE "Business" (
    "id"          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nombre"      TEXT NOT NULL,
    "slug"        TEXT NOT NULL,
    "descripcion" TEXT,
    "activo"      BOOLEAN NOT NULL DEFAULT true,
    "deletedAt"   DATETIME,
    "timezone"    TEXT NOT NULL DEFAULT 'UTC',
    "bufferMin"   INTEGER NOT NULL DEFAULT 0,
    "slotMinutes" INTEGER NOT NULL DEFAULT 60,
    "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   DATETIME NOT NULL
);

CREATE TABLE "BusinessSettings" (
    "id"                INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "businessId"        INTEGER NOT NULL,
    "holdMinutes"       INTEGER NOT NULL DEFAULT 10,
    "reminderBeforeMin" INTEGER NOT NULL DEFAULT 1440,
    "remindersEnabled"  BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled"      BOOLEAN NOT NULL DEFAULT true,
    "whatsappEnabled"   BOOLEAN NOT NULL DEFAULT false,
    "updatedAt"         DATETIME NOT NULL,
    CONSTRAINT "BusinessSettings_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "User" (
    "id"              INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nombre"          TEXT NOT NULL,
    "email"           TEXT NOT NULL,
    "passwordHash"    TEXT NOT NULL,
    "role"            TEXT NOT NULL DEFAULT 'CLIENT',
    "activo"          BOOLEAN NOT NULL DEFAULT true,
    "ultimoAcceso"    DATETIME,
    "tokenVersion"    INTEGER NOT NULL DEFAULT 0,
    "emailVerifiedAt" DATETIME,
    "deletedAt"       DATETIME,
    "createdAt"       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       DATETIME NOT NULL,
    "businessId"      INTEGER,
    CONSTRAINT "User_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "UserSettings" (
    "id"         INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId"     INTEGER NOT NULL,
    "emailOptIn" BOOLEAN NOT NULL DEFAULT true,
    "locale"     TEXT NOT NULL DEFAULT 'es',
    "timezone"   TEXT,
    "theme"      TEXT NOT NULL DEFAULT 'system',
    "updatedAt"  DATETIME NOT NULL,
    CONSTRAINT "UserSettings_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "RefreshToken" (
    "id"        INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId"    INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "userAgent" TEXT,
    "ip"        TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RefreshToken_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "PasswordResetToken" (
    "id"             INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId"         INTEGER NOT NULL,
    "tokenHash"      TEXT NOT NULL,
    "expiresAt"      DATETIME NOT NULL,
    "usedAt"         DATETIME,
    "createdAt"      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedEmail" TEXT,
    CONSTRAINT "PasswordResetToken_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Client" (
    "id"              INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId"          INTEGER NOT NULL,
    "businessId"      INTEGER NOT NULL,
    "nombre"          TEXT NOT NULL,
    "documento"       TEXT,
    "fechaNacimiento" DATETIME,
    "telefono"        TEXT,
    "direccion"       TEXT,
    "deletedAt"       DATETIME,
    "createdAt"       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       DATETIME NOT NULL,
    CONSTRAINT "Client_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Client_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ClientProfile" (
    "id"               INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "clientId"         INTEGER NOT NULL,
    "notas"            TEXT,
    "aceptaMarketing"  BOOLEAN NOT NULL DEFAULT false,
    "consentimientoAt" DATETIME,
    "exportadoEn"      DATETIME,
    "updatedAt"        DATETIME NOT NULL,
    CONSTRAINT "ClientProfile_clientId_fkey"
        FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Category" (
    "id"          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "businessId"  INTEGER NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "deletedAt"   DATETIME,
    "durationMin" INTEGER NOT NULL DEFAULT 60,
    "color"       TEXT DEFAULT '#2563eb',
    "precio"      REAL,
    "activo"      BOOLEAN NOT NULL DEFAULT true,
    "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   DATETIME NOT NULL,
    CONSTRAINT "Category_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Staff" (
    "id"           INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "businessId"   INTEGER NOT NULL,
    "userId"       INTEGER,
    "nombre"       TEXT NOT NULL,
    "email"        TEXT,
    "telefono"     TEXT,
    "especialidad" TEXT,
    "color"        TEXT DEFAULT '#0891b2',
    "activo"       BOOLEAN NOT NULL DEFAULT true,
    "deletedAt"    DATETIME,
    "createdAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    DATETIME NOT NULL,
    CONSTRAINT "Staff_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Staff_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "BusinessSchedule" (
    "id"          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "businessId"  INTEGER NOT NULL,
    "weekday"     INTEGER NOT NULL,
    "startTime"   TEXT NOT NULL,
    "endTime"     TEXT NOT NULL,
    "slotMinutes" INTEGER NOT NULL DEFAULT 60,
    "note"        TEXT,
    "activo"      BOOLEAN NOT NULL DEFAULT true,
    "staffId"     INTEGER,
    "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   DATETIME NOT NULL,
    CONSTRAINT "BusinessSchedule_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BusinessSchedule_staffId_fkey"
        FOREIGN KEY ("staffId") REFERENCES "Staff" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Availability" (
    "id"         INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "businessId" INTEGER NOT NULL,
    "date"       DATETIME NOT NULL,
    "startTime"  TEXT NOT NULL,
    "endTime"    TEXT NOT NULL,
    "status"     TEXT NOT NULL DEFAULT 'AVAILABLE',
    "note"       TEXT,
    "heldUntil"  DATETIME,
    "heldById"   INTEGER,
    "staffId"    INTEGER,
    "deletedAt"  DATETIME,
    "createdAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  DATETIME NOT NULL,
    CONSTRAINT "Availability_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Availability_staffId_fkey"
        FOREIGN KEY ("staffId") REFERENCES "Staff" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Availability_heldById_fkey"
        FOREIGN KEY ("heldById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "Task" (
    "id"          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "businessId"  INTEGER NOT NULL,
    "title"       TEXT NOT NULL,
    "description" TEXT,
    "categoryId"  INTEGER,
    "clientId"    INTEGER,
    "dueDate"     DATETIME,
    "dueTime"     TEXT,
    "status"      TEXT NOT NULL DEFAULT 'PENDING',
    "deletedAt"   DATETIME,
    "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   DATETIME NOT NULL,
    CONSTRAINT "Task_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_categoryId_fkey"
        FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_clientId_fkey"
        FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "Appointment" (
    "id"             INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "businessId"     INTEGER NOT NULL,
    "taskId"         INTEGER NOT NULL,
    "clientId"       INTEGER NOT NULL,
    "availabilityId" INTEGER NOT NULL,
    "staffId"        INTEGER,
    "note"           TEXT,
    "status"         TEXT NOT NULL DEFAULT 'PENDING',
    "deletedAt"      DATETIME,
    "cancelReason"   TEXT,
    "checkedInAt"    DATETIME,
    "version"        INTEGER NOT NULL DEFAULT 0,
    "createdAt"      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      DATETIME NOT NULL,
    CONSTRAINT "Appointment_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Appointment_taskId_fkey"
        FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Appointment_clientId_fkey"
        FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Appointment_availabilityId_fkey"
        FOREIGN KEY ("availabilityId") REFERENCES "Availability" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Appointment_staffId_fkey"
        FOREIGN KEY ("staffId") REFERENCES "Staff" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "AppointmentEvent" (
    "id"            INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "appointmentId" INTEGER NOT NULL,
    "actorId"       INTEGER,
    "fromStatus"    TEXT,
    "toStatus"      TEXT NOT NULL,
    "note"          TEXT,
    "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppointmentEvent_appointmentId_fkey"
        FOREIGN KEY ("appointmentId") REFERENCES "Appointment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AppointmentEvent_actorId_fkey"
        FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "Notification" (
    "id"            INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId"        INTEGER NOT NULL,
    "appointmentId" INTEGER,
    "channel"       TEXT NOT NULL DEFAULT 'INTERNAL',
    "type"          TEXT NOT NULL,
    "title"         TEXT NOT NULL,
    "message"       TEXT NOT NULL,
    "readAt"        DATETIME,
    "deletedAt"     DATETIME,
    "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_appointmentId_fkey"
        FOREIGN KEY ("appointmentId") REFERENCES "Appointment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Reminder" (
    "id"            INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "appointmentId" INTEGER NOT NULL,
    "channel"       TEXT NOT NULL,
    "status"        TEXT NOT NULL DEFAULT 'PENDING',
    "scheduledFor"  DATETIME NOT NULL,
    "sentAt"        DATETIME,
    "attempts"      INTEGER NOT NULL DEFAULT 0,
    "lastError"     TEXT,
    "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "staffId"       INTEGER,
    "createdById"   INTEGER,
    CONSTRAINT "Reminder_appointmentId_fkey"
        FOREIGN KEY ("appointmentId") REFERENCES "Appointment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Reminder_staffId_fkey"
        FOREIGN KEY ("staffId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Reminder_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "WaitlistEntry" (
    "id"         INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "businessId" INTEGER NOT NULL,
    "clientId"   INTEGER NOT NULL,
    "categoryId" INTEGER,
    "staffId"    INTEGER,
    "dateFrom"   DATETIME NOT NULL,
    "dateTo"     DATETIME,
    "note"       TEXT,
    "status"     TEXT NOT NULL DEFAULT 'WAITING',
    "notifiedAt" DATETIME,
    "expiresAt"  DATETIME,
    "createdAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  DATETIME NOT NULL,
    CONSTRAINT "WaitlistEntry_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WaitlistEntry_clientId_fkey"
        FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WaitlistEntry_categoryId_fkey"
        FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- `payload` es TEXT con el JSON serializado: SQLite no tiene tipo JSON.
CREATE TABLE "AuditLog" (
    "id"         INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "businessId" INTEGER,
    "actorId"    INTEGER,
    "action"     TEXT NOT NULL,
    "entity"     TEXT NOT NULL,
    "entityId"   INTEGER,
    "payload"    TEXT,
    "ip"         TEXT,
    "userAgent"  TEXT,
    "createdAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_actorId_fkey"
        FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- ---------------------------------------------------------------------------
-- Indices
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX "Business_slug_key" ON "Business"("slug");
CREATE INDEX "Business_activo_idx" ON "Business"("activo");
CREATE INDEX "Business_deletedAt_idx" ON "Business"("deletedAt");

CREATE UNIQUE INDEX "BusinessSettings_businessId_key" ON "BusinessSettings"("businessId");

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_role_idx" ON "User"("role");
CREATE INDEX "User_businessId_idx" ON "User"("businessId");
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");

CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");
CREATE INDEX "RefreshToken_userId_revokedAt_idx" ON "RefreshToken"("userId", "revokedAt");
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_usedAt_idx" ON "PasswordResetToken"("userId", "usedAt");
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

CREATE UNIQUE INDEX "Client_userId_key" ON "Client"("userId");
-- `documento` admite NULL y en SQLite los NULL no chocan en un indice UNIQUE, asi
-- que quedan varias fichas sin documento. Es lo correcto, no un descuido.
CREATE UNIQUE INDEX "Client_businessId_documento_key" ON "Client"("businessId", "documento");
CREATE INDEX "Client_nombre_idx" ON "Client"("nombre");
CREATE INDEX "Client_businessId_idx" ON "Client"("businessId");
CREATE INDEX "Client_businessId_deletedAt_idx" ON "Client"("businessId", "deletedAt");

CREATE UNIQUE INDEX "ClientProfile_clientId_key" ON "ClientProfile"("clientId");

CREATE UNIQUE INDEX "Category_businessId_name_key" ON "Category"("businessId", "name");
CREATE INDEX "Category_businessId_idx" ON "Category"("businessId");
CREATE INDEX "Category_businessId_deletedAt_idx" ON "Category"("businessId", "deletedAt");

CREATE UNIQUE INDEX "Staff_userId_key" ON "Staff"("userId");
CREATE INDEX "Staff_businessId_idx" ON "Staff"("businessId");
CREATE INDEX "Staff_businessId_deletedAt_idx" ON "Staff"("businessId", "deletedAt");

CREATE INDEX "BusinessSchedule_businessId_weekday_activo_idx" ON "BusinessSchedule"("businessId", "weekday", "activo");

-- Un bloque se identifica por empresa + profesional + dia + hora de inicio.
--
-- El `COALESCE("staffId", 0)` es lo que permite que el indice siga siendo UNIQUE y
-- a la vez admita bloques SIN profesional asignado. SQLite no indexa NULL en un
-- indice UNIQUE (los NULL no chocan entre si), asi que un indice normal sobre
-- (businessId, staffId, date, startTime) dejaria pasar infinitos bloques "de la
-- empresa entera" a la misma hora.
--
-- Y al reves: sin profesional en la clave, dos profesionales distintos no podrian
-- tener bloque a la misma hora, que es justo lo que un negocio con dos profesionales
-- necesita. Un indice de EXPRESION resuelve las dos cosas a la vez.
--
-- Prisma no lo expresa, asi que vive solo aqui:
--
--   CREATE UNIQUE INDEX "Availability_businessId_staffId_date_startTime_key"
--     ON "Availability"("businessId", COALESCE("staffId", 0), "date", "startTime");
CREATE UNIQUE INDEX "Availability_businessId_staffId_date_startTime_key"
    ON "Availability"("businessId", COALESCE("staffId", 0), "date", "startTime");
CREATE INDEX "Availability_businessId_idx" ON "Availability"("businessId");
CREATE INDEX "Availability_date_idx" ON "Availability"("date");
CREATE INDEX "Availability_status_idx" ON "Availability"("status");
-- El filtro por defecto del listado es negocio + estado + rango de fechas. Con
-- indices separados SQLite los cruza mal; este los cubre en un solo orden.
CREATE INDEX "Availability_businessId_status_date_idx" ON "Availability"("businessId", "status", "date");
CREATE INDEX "Availability_heldUntil_idx" ON "Availability"("heldUntil");
CREATE INDEX "Availability_deletedAt_idx" ON "Availability"("deletedAt");

CREATE INDEX "Task_businessId_idx" ON "Task"("businessId");
CREATE INDEX "Task_status_idx" ON "Task"("status");
CREATE INDEX "Task_dueDate_idx" ON "Task"("dueDate");
CREATE INDEX "Task_categoryId_idx" ON "Task"("categoryId");
CREATE INDEX "Task_clientId_idx" ON "Task"("clientId");
CREATE INDEX "Task_businessId_deletedAt_idx" ON "Task"("businessId", "deletedAt");

CREATE INDEX "Appointment_businessId_idx" ON "Appointment"("businessId");
CREATE INDEX "Appointment_clientId_idx" ON "Appointment"("clientId");
CREATE INDEX "Appointment_taskId_idx" ON "Appointment"("taskId");
CREATE INDEX "Appointment_availabilityId_idx" ON "Appointment"("availabilityId");
CREATE INDEX "Appointment_status_idx" ON "Appointment"("status");
CREATE INDEX "Appointment_createdAt_idx" ON "Appointment"("createdAt");
CREATE INDEX "Appointment_availabilityId_status_idx" ON "Appointment"("availabilityId", "status");
CREATE INDEX "Appointment_businessId_deletedAt_idx" ON "Appointment"("businessId", "deletedAt");
CREATE INDEX "Appointment_staffId_idx" ON "Appointment"("staffId");

-- ---------------------------------------------------------------------------
-- LA QUE IMPIDE EL DOBLE BOOKING
-- ---------------------------------------------------------------------------
--
-- Una cita solo bloquea el hueco mientras esta viva (PENDING o COORDINATED). Al
-- completarse o cancelarse su fila deja de contar y el hueco queda libre para otra
-- cita, que es justo lo que se quiere: una cita de hace un mes no puede impedir
-- reservar el mismo bloque manana.
--
-- Sin este indice, el service tiene que comprobarlo antes de escribir y dos
-- peticiones simultaneas pueden pasar ambas la comprobacion y reservar el mismo
-- horario. Aqui no: la segunda recibe un error de restriccion UNIQUE y
-- `utils/ApiError.js` lo traduce a un 409 legible.
--
-- Los indices PARCIALES son exactamente igual en SQLite que en PostgreSQL: los
-- soporta desde la version 3.8 (2013).
--
-- Prisma no expresa indices parciales, asi que este vive solo aqui. La misma
-- linea comentada en `schema.prisma` evita que `migrate dev` lo marque como
-- borrado:
--
--   CREATE UNIQUE INDEX "Appointment_hueco_vivo_key"
--     ON "Appointment"("availabilityId")
--     WHERE "status" IN ('PENDING','COORDINATED') AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX "Appointment_hueco_vivo_key"
    ON "Appointment"("availabilityId")
    WHERE "status" IN ('PENDING', 'COORDINATED') AND "deletedAt" IS NULL;

CREATE INDEX "AppointmentEvent_appointmentId_createdAt_idx" ON "AppointmentEvent"("appointmentId", "createdAt");
CREATE INDEX "AppointmentEvent_actorId_idx" ON "AppointmentEvent"("actorId");

CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");
CREATE INDEX "Notification_userId_deletedAt_idx" ON "Notification"("userId", "deletedAt");

CREATE INDEX "Reminder_status_scheduledFor_idx" ON "Reminder"("status", "scheduledFor");
CREATE INDEX "Reminder_appointmentId_idx" ON "Reminder"("appointmentId");

CREATE INDEX "WaitlistEntry_businessId_status_idx" ON "WaitlistEntry"("businessId", "status");
CREATE INDEX "WaitlistEntry_clientId_idx" ON "WaitlistEntry"("clientId");

CREATE INDEX "AuditLog_businessId_createdAt_idx" ON "AuditLog"("businessId", "createdAt");
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");