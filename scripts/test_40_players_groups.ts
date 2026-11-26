// Investigación: reporte de que con 40 inscritos (modo "normal") quedaría
// un jugador sin grupo / 13 grupos de 3 sin el último de 4. Prueba contra
// el flujo REAL (preview-groups + start-groups vía HTTP, persistido en la
// base), no solo la función en memoria (que ya se verificó aparte).
import DB from "../src/db/db_configuration";
import { signToken } from "../src/jwt/jwt";

const API = "http://localhost:4310/api/v1";
(async () => {
  if (!(process.env.PGDATABASE ?? "").endsWith("_local")) throw new Error("Solo base local");
  const pool = DB.getPool();
  const q = (sql: string, p: unknown[] = []) => pool.query(sql, p);

  const org = (await q(`SELECT id_user FROM users WHERE email = 'organizador1@sim.myttm.cl'`)).rows[0]?.id_user;
  if (!org) throw new Error("Falta el admin de prueba organizador1@sim.myttm.cl — correr simulate_production.ts primero");
  const tok = signToken({ id_user: org, role: "admin" });
  const post = (path: string, body?: unknown) =>
    fetch(API + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify(body ?? {}),
    }).then(async (r) => ({ status: r.status, json: JSON.parse(await r.text()) }));
  const get = (path: string) =>
    fetch(API + path, { headers: { Authorization: `Bearer ${tok}` } }).then(async (r) => ({
      status: r.status,
      json: JSON.parse(await r.text()),
    }));

  const created = await post(`/tournament/admin/create/tournament`, {
    tournament_name: "Prueba 40 jugadores",
    region: "Metropolitana de Santiago",
    event_date: new Date().toISOString().slice(0, 10),
    categories: [
      {
        category_type: "Prueba40",
        category_range: "General",
        gender: "mixed",
        competition_format: "groups_bracket",
        inscription_price: 0,
        quotas: null,
        qualifiers_per_group: 2,
      },
    ],
  });
  if (created.status !== 201) throw new Error(`create tournament falló: ${created.status} ${JSON.stringify(created.json)}`);
  const t = created.json.data.id_tournament;
  const catId = created.json.data.categories[0].id_category;

  const players = (await q(`SELECT DISTINCT id_user FROM users WHERE id_role = '22222222-2222-2222-2222-222222222222' LIMIT 40`)).rows;
  console.log("jugadores de prueba encontrados:", players.length);
  for (const p of players) await q(`INSERT INTO enrollments (id_user, id_tournament, id_category) VALUES ($1,$2,$3)`, [p.id_user, t, catId]);

  const enrolledCount = (await q(`SELECT count(*) AS n FROM enrollments WHERE id_category = $1 AND status = 'active' AND qualification_type = 'group' AND checked_in = true`, [catId])).rows[0].n;
  console.log("inscritos activos qualification_type=group checked_in=true:", enrolledCount);

  // Preview (modo normal, sin group_size_mode).
  const preview = await get(`/tournament/${t}/categories/${catId}/preview-groups`);
  console.log("preview status:", preview.status);
  console.log("preview group sizes:", preview.json?.data?.groups?.map((g: any) => g.target_size));
  console.log("preview sum:", preview.json?.data?.groups?.reduce((a: number, g: any) => a + g.target_size, 0));
  console.log("preview direct advance:", preview.json?.data?.direct_advance_players?.length);

  // Confirmar grupos de verdad.
  const startGroups = await post(`/tournament/${t}/categories/${catId}/start-groups`, { best_of_sets: 3 });
  console.log("startGroups status:", startGroups.status, startGroups.status !== 200 ? JSON.stringify(startGroups.json) : "");

  const persistedGroups = (
    await q(
      `SELECT g.group_name, g.target_size, count(gm.id_user) AS n
       FROM category_groups g LEFT JOIN group_members gm ON gm.id_group = g.id_group
       WHERE g.id_category = $1 GROUP BY g.id_group, g.group_name, g.target_size ORDER BY g.group_name`,
      [catId]
    )
  ).rows;
  console.log("grupos persistidos:");
  for (const r of persistedGroups) console.log(`  ${r.group_name}: target_size=${r.target_size} miembros_reales=${r.n}`);

  const totalMembers = (await q(`SELECT count(*) AS n FROM group_members gm JOIN category_groups g ON g.id_group = gm.id_group WHERE g.id_category = $1`, [catId])).rows[0].n;
  console.log("total miembros en grupos:", totalMembers);

  const ungroupedActive = (
    await q(
      `SELECT e.id_user FROM enrollments e
       WHERE e.id_category = $1 AND e.status = 'active'
       AND e.id_user NOT IN (SELECT gm.id_user FROM group_members gm JOIN category_groups g ON g.id_group = gm.id_group WHERE g.id_category = $1)`,
      [catId]
    )
  ).rows;
  console.log("inscritos activos SIN grupo:", ungroupedActive.length, ungroupedActive);

  // limpieza
  await q(`DELETE FROM tournaments WHERE id_tournament = $1`, [t]);
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
