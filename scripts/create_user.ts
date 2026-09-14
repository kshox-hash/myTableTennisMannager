// Crea (o resetea la contraseña de) una cuenta directo en la base, sin
// pasar por /auth/sign-up — para dar de alta cuentas puntuales a mano (ej.
// las cuentas de superadmin: no necesitan ser "admin" en la base, alcanza
// con que su email esté en SUPERADMIN_EMAILS — ver core/constants/roles.ts).
//
// Uso:
//   npx ts-node scripts/create_user.ts <email> <password> [nombre] [apellido]
//
// Corre con las mismas env vars que usa el server (PGHOST/PGUSER/etc. —
// ver .env.example) — así que hay que ejecutarlo apuntando a la base que
// corresponda (local o producción), no hace falta nada especial.

import DB from "../src/db/db_configuration";
import { hashPassword } from "../src/bcrypt/bcrypt";
import { ROLE_IDS } from "../src/core/constants/roles";

async function main() {
  const [email, password, firstName, lastName] = process.argv.slice(2);
  if (!email || !password) {
    console.error("Uso: npx ts-node scripts/create_user.ts <email> <password> [nombre] [apellido]");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("La contraseña debe tener al menos 8 caracteres.");
    process.exit(1);
  }

  const pool = DB.getPool();
  const passwordHash = await hashPassword(password);

  const existing = await pool.query<{ id_user: string }>(
    `SELECT id_user FROM users WHERE email = $1`,
    [email.trim().toLowerCase()]
  );

  if (existing.rows[0]) {
    await pool.query(`UPDATE users SET password_hash = $2 WHERE id_user = $1`, [
      existing.rows[0].id_user,
      passwordHash,
    ]);
    console.log(`Contraseña actualizada para ${email} (cuenta ya existía).`);
  } else {
    const res = await pool.query<{ id_user: string }>(
      `INSERT INTO users (email, password_hash, id_role, first_name, last_name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id_user`,
      [email.trim().toLowerCase(), passwordHash, ROLE_IDS.player, firstName ?? null, lastName ?? null]
    );
    console.log(`Cuenta creada para ${email} (id_user=${res.rows[0].id_user}).`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
