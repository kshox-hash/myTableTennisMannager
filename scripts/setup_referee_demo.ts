// Arma (o borra con "clean") un campeonato de prueba local con un partido
// pendiente cuyo árbitro es ignacio@gmail.com — para probar la app.
import DB from "../src/db/db_configuration";
import { signToken } from "../src/jwt/jwt";
const API = "http://localhost:4310/api/v1";
(async () => {
  if (!(process.env.PGDATABASE ?? "").endsWith("_local")) throw new Error("Solo base local");
  const pool = DB.getPool();
  const q = (sql: string, p: unknown[] = []) => pool.query(sql, p);
  if (process.argv[2] === "clean") {
    const ids = (await q(`SELECT id_tournament FROM tournaments WHERE tournament_name = 'Prueba árbitro app'`)).rows.map((r) => r.id_tournament);
    for (const id of ids) {
      await q(`DELETE FROM notifications WHERE id_tournament = $1`, [id]);
      await q(`DELETE FROM tournaments WHERE id_tournament = $1`, [id]);
    }
    console.log("borrados", ids.length);
    return pool.end();
  }
  const org = (await q(`SELECT u.id_user FROM users u JOIN roles r ON r.id_role = u.id_role WHERE r.name = 'admin' ORDER BY u.created_at LIMIT 1`)).rows[0].id_user;
  const ref = (await q(`SELECT id_user FROM users WHERE email = 'ignacio@gmail.com'`)).rows[0].id_user;
  const t = (await q(`INSERT INTO tournaments (tournament_name, created_by, region, event_date, status, visibility, default_best_of_sets, kind)
     VALUES ('Prueba árbitro app', $1, 'Metropolitana de Santiago', CURRENT_DATE, 'active', 'private', 3, 'tournament') RETURNING id_tournament`, [org])).rows[0].id_tournament;
  const c = (await q(`INSERT INTO tournament_categories (id_tournament, category_type, category_range, gender, inscription_price, format, competition_format)
     VALUES ($1, 'Todo Competidor', 'General', 'mixed', 0, 'singles', 'round_robin') RETURNING id_category`, [t])).rows[0].id_category;
  const players = (await q(`SELECT u.id_user FROM users u JOIN roles r ON r.id_role = u.id_role WHERE r.name = 'player' AND u.id_user <> $1 ORDER BY u.created_at LIMIT 3`, [ref])).rows.map((r) => r.id_user);
  for (const p of players) await q(`INSERT INTO enrollments (id_user, id_tournament, id_category) VALUES ($1,$2,$3)`, [p, t, c]);
  const admin = signToken({ id_user: org, role: "admin" });
  const call = (method: string, path: string, body?: unknown) => fetch(API + path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${admin}` }, body: body ? JSON.stringify(body) : undefined });
  await call("POST", `/tournament/${t}/categories/${c}/start-groups`, { best_of_sets: 3 });
  const m = (await q(`SELECT gm.id_match FROM group_matches gm JOIN category_groups g ON g.id_group = gm.id_group WHERE g.id_category = $1 ORDER BY gm.match_number LIMIT 1`, [c])).rows[0];
  await q(`UPDATE group_matches SET table_number = 3 WHERE id_match = $1`, [m.id_match]);
  const r = await call("PATCH", `/bracket/matches/${m.id_match}/referee`, { referee_id: ref });
  console.log({ torneo: t, partido: m.id_match, asignar: r.status });
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
