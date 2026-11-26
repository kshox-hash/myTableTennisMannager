// Emula el campeonato de 124 inscritos (31 grupos de 4, 9 mesas) en la base
// LOCAL, a nombre de admin@myttm.local, en fase de inscripción: listo para
// probar "Empezar campeonato", grupos, programación, caja, etc.
// Uso: npx ts-node scripts/seed_124_players.ts
import DB from "../src/db/db_configuration";
import { signToken } from "../src/jwt/jwt";

const API = "http://localhost:4310/api/v1";
const TOTAL = 124;

(async () => {
  if (!(process.env.PGDATABASE ?? "").endsWith("_local")) throw new Error("Solo base local");
  const pool = DB.getPool();
  const q = (sql: string, p: unknown[] = []) => pool.query(sql, p);

  const admin = (await q(`SELECT id_user FROM users WHERE email = 'admin@myttm.local'`)).rows[0]?.id_user;
  if (!admin) throw new Error("Falta admin@myttm.local");
  const tok = signToken({ id_user: admin, role: "admin" });

  const created = await fetch(`${API}/tournament/admin/create/tournament`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
    body: JSON.stringify({
      tournament_name: "Interclubes RyF (prueba 124)",
      region: "Metropolitana de Santiago",
      address: "Club Deportivo La Reina",
      event_date: "2026-11-08",
      num_tables: 9,
      categories: [
        {
          category_type: "Todo Competidor",
          category_range: "General",
          gender: "mixed",
          competition_format: "groups_bracket",
          inscription_price: 5000,
          quotas: null,
          qualifiers_per_group: 2,
        },
      ],
    }),
  }).then(async (r) => ({ status: r.status, json: JSON.parse(await r.text()) }));
  if (created.status !== 201) throw new Error(`No se pudo crear: ${created.status} ${JSON.stringify(created.json)}`);
  const t = created.json.data.id_tournament as string;
  const cat = created.json.data.categories[0].id_category as string;

  // Jugadores reales de la base local, con club (variedad de clubes).
  const players = (
    await q(
      `SELECT id_user FROM users
       WHERE id_role = '22222222-2222-2222-2222-222222222222' AND NOT is_team AND id_club IS NOT NULL
       ORDER BY md5(id_user::text) LIMIT $1`,
      [TOTAL]
    )
  ).rows;
  if (players.length < TOTAL) throw new Error(`Solo hay ${players.length} jugadores con club`);

  let paid = 0;
  let pending = 0;
  for (let i = 0; i < players.length; i++) {
    // ~75 % pagado (60 % transferencia / 40 % efectivo), el resto pendiente;
    // 4 "por llegar".
    const isPaid = i % 4 !== 3;
    const method = isPaid ? (i % 5 < 3 ? "transfer" : "cash") : null;
    const attendance = i >= TOTAL - 4 ? "pending" : "present";
    await q(
      `INSERT INTO enrollments (id_user, id_tournament, id_category, paid, paid_at, payment_method, attendance, checked_in)
       VALUES ($1, $2, $3, $4, CASE WHEN $4 THEN now() ELSE NULL END, $5, $6, true)`,
      [players[i].id_user, t, cat, isPaid, method, attendance]
    );
    if (isPaid) paid++;
    if (attendance === "pending") pending++;
  }
  await q(`UPDATE tournament_categories SET status = 'closed' WHERE id_category = $1`, [cat]);

  console.log(`Campeonato: ${t}`);
  console.log(`Categoría:  ${cat}`);
  console.log(`Inscritos: ${players.length} · pagados ${paid} · por llegar ${pending}`);
  console.log(`http://localhost:5173/admin/tournaments/${t}`);
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
