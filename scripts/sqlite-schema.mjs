/**
 * Genera prisma/schema.sqlite.prisma a partir de prisma/schema.prisma.
 *
 * El esquema canonico es PostgreSQL. SQLite no soporta enums, asi que cada
 * enum se convierte a String y se documentan sus valores permitidos en un
 * comentario. El codigo de la aplicacion nunca importa los tipos del cliente
 * de Prisma: trabaja con strings, asi que el mismo service corre sobre ambas
 * bases sin cambios.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'prisma', 'schema.prisma'), 'utf8');

const enums = new Map();

let schema = source.replace(/datasource db \{[^}]*\}/s, (block) =>
  block.replace('provider = "postgresql"', 'provider = "sqlite"')
);

schema = schema.replace(/^enum (\w+) \{\n([\s\S]*?)^\}/gm, (_, name, body) => {
  const values = body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  enums.set(name, values);
  return `// enum ${name} no soportado en SQLite: usar String. Valores: ${values.join(', ')}`;
});

schema = schema.replace(/\b(Role|TaskStatus|AvailabilityStatus|AppointmentStatus|NotificationChannel)\b/g, 'String');

// Los defaults que apuntan a un enum pasan a ser strings: @default(PENDING) -> @default("PENDING")
const enumValues = new Set([...enums.values()].flat());
schema = schema.replace(/@default\((\w+)\)/g, (match, value) =>
  enumValues.has(value) ? `@default("${value}")` : match
);

const note = [
  '// GENERADO AUTOMATICAMENTE desde prisma/schema.prisma. No editar a mano.',
  '// Ejecutar: npm run prisma:sqlite:schema',
  '',
].join('\n');

writeFileSync(join(root, 'prisma', 'schema.sqlite.prisma'), note + schema);

console.log(`prisma/schema.sqlite.prisma generado (${enums.size} enums convertidos a String)`);