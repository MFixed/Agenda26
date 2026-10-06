/**
 * Crea o restablece el superadministrador de la plataforma.
 *
 *   node scripts/superadmin.js                 super@plataforma.com / Super1234
 *   node scripts/superadmin.js --email=otro@x.com --password=Clave1234
 *
 * POR QUÉ EXISTE
 * El superadministrador no pertenece a ninguna empresa y es el único que puede
 * dar de alta empresas. Si la base se vacía sin volver a cargar el seed
 * (`npm run reset`), se queda en una instalación a la que nadie puede entrar por
 * /super, y sin empresas no hay forma de crear el primero: es un callejón sin
 * salida desde el que sólo se sale tocando la base de datos a mano.
 *
 * Por eso esto es un script y no una parte del seed: el seed crea datos de
 * ejemplo para trabajar, esto resuelve un bloqueo. Y por eso puede ejecutarse
 * tantas veces como haga falta sobre una base vacía o llena.
 *
 * No toca empresas, clientes ni citas: sólo crea o restablece ESTA cuenta. Con
 * `--password` genera una contraseña nueva; sin él no se toca la que ya hay, para
 * que volver a ejecutar el script no invalide la sesión de nadie por sorpresa.
 */

import { prisma } from "../src/config/database.js";
import { hashPassword } from "../src/utils/password.js";

const arg = (nombre, porDefecto) => {
  const prefijo = `--${nombre}=`;
  const encontrado = process.argv.find((a) => a.startsWith(prefijo));
  return encontrado ? encontrado.slice(prefijo.length).trim() : porDefecto;
};

const EMAIL_POR_DEFECTO = "super@plataforma.com";
const PASSWORD_POR_DEFECTO = "Super1234";

const email = (arg("email", process.env.SUPERADMIN_EMAIL || EMAIL_POR_DEFECTO) || "").toLowerCase();
const nuevaPassword = arg("password", process.env.SUPERADMIN_PASSWORD || "");
const nombre = arg("nombre", "Equipo Plataforma");

if (!email || !email.includes("@")) {
  console.error(`\nCorreo no válido: "${email}". Usa --email=cuenta@dominio.com\n`);
  process.exit(1);
}

if (nuevaPassword && nuevaPassword.length < 8) {
  console.error("\nLa contraseña debe tener al menos 8 caracteres.\n");
  process.exit(1);
}

const existente = await prisma.user.findUnique({ where: { email } });

if (existente && existente.role !== "SUPERADMIN") {
  /* El rol NO se cambia por la fuerza. Si ese correo ya es una cuenta de
     empresa, convertirlo en superadministrador dejaría a sus citas sin empresa
     que las contenga y convertiría a un cliente en plataforma. Es un caso
     improbable, pero del tipo que no se deshace con otro comando: mejor pararlo
     y que la persona decida qué correo usar. */
  console.error(
    `\nEl correo "${email}" ya existe y NO es un superadministrador (es un ${existente.role}).\n` +
      "  Usa otro correo, o borra esa cuenta antes.\n"
  );
  process.exit(1);
}

if (existente) {
  // Se restablece la cuenta, y sólo si se pidió una contraseña nueva.
  const cambios = { activo: true, nombre };
  if (nuevaPassword) {
    cambios.passwordHash = await hashPassword(nuevaPassword);
  }
  const [, empresas] = await Promise.all([
    prisma.user.update({ where: { id: existente.id }, data: cambios }),
    prisma.business.count()
  ]);

  console.log(`
Superadministrador restablecido
  correo     ${email}
  ${nuevaPassword ? `contraseña ${nuevaPassword}` : "contraseña  sin cambios"}
  empresas   ${empresas} en la base

  Entra en /login (sin identificador de empresa).
`);
} else {
  await prisma.user.create({
    data: {
      nombre,
      email,
      passwordHash: await hashPassword(nuevaPassword || PASSWORD_POR_DEFECTO),
      role: "SUPERADMIN",
      // businessId null a propósito: el superadministrador no pertenece a
      // ninguna empresa, y es lo que le impide entrar en sus datos.
      businessId: null
    }
  });

  console.log(`
Superadministrador creado
  correo      ${email}
  contraseña  ${nuevaPassword || PASSWORD_POR_DEFECTO}

  Entra en /login (sin identificador de empresa) y da de alta empresas desde /super.
`);
}

await prisma.$disconnect();
