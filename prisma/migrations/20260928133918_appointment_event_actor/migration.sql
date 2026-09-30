-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AppointmentEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "appointmentId" INTEGER NOT NULL,
    "actorId" INTEGER,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppointmentEvent_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AppointmentEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AppointmentEvent" ("actorId", "appointmentId", "createdAt", "fromStatus", "id", "note", "toStatus") SELECT "actorId", "appointmentId", "createdAt", "fromStatus", "id", "note", "toStatus" FROM "AppointmentEvent";
DROP TABLE "AppointmentEvent";
ALTER TABLE "new_AppointmentEvent" RENAME TO "AppointmentEvent";
CREATE INDEX "AppointmentEvent_appointmentId_createdAt_idx" ON "AppointmentEvent"("appointmentId", "createdAt");
CREATE INDEX "AppointmentEvent_actorId_idx" ON "AppointmentEvent"("actorId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
