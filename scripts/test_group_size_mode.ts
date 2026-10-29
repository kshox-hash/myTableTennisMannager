// Prueba local del selector "cómo armar los grupos" (normal vs. grupos de
// 4) en una categoría NORMAL (sin Oro/Plata): con group_size_mode omitido
// debe salir el plan de siempre (prioriza 3), y con group_size_mode="fours"
// debe salir de a 4 (+ pase directo si sobra 1) — igual que una categoría
// Oro, pero acá es una elección explícita del admin, no automática.
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

  // Torneo con UNA categoría normal (sin createSilverPair).
  const created = await post(`/tournament/admin/create/tournament`, {
    tournament_name: "Prueba modo de grupos",
    region: "Metropolitana de Santiago",
    event_date: new Date().toISOString().slice(0, 10),
    categories: [
      {
        category_type: "Prueba ModoGrupos",
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

  // 9 inscritos (no múltiplo de 4, remainder 1 en ambos planes).
  const players = (await q(`SELECT id_user FROM users WHERE id_role = '22222222-2222-2222-2222-222222222222' LIMIT 9`)).rows;
  for (const p of players) await q(`INSERT INTO enrollments (id_user, id_tournament, id_category) VALUES ($1,$2,$3)`, [p.id_user, t, catId]);

  // 1) Sin group_size_mode (default "normal") -> plan de siempre: prioriza 3.
  const previewNormal = await get(`/tournament/${t}/categories/${catId}/preview-groups`);

  // 2) Con group_size_mode=fours -> plan de a 4 + 1 pase directo.
  const previewFours = await get(`/tournament/${t}/categories/${catId}/preview-groups?group_size_mode=fours`);

  // 3) Confirmar con group_size_mode=fours (vía API real) y revisar lo persistido.
  const startGroups = await post(`/tournament/${t}/categories/${catId}/start-groups`, {
    best_of_sets: 3,
    group_size_mode: "fours",
  });

  const groupSizes = (
    await q(
      `SELECT g.id_group, count(*) AS n FROM category_groups g JOIN group_members gm ON gm.id_group = g.id_group
       WHERE g.id_category = $1 GROUP BY g.id_group ORDER BY n DESC`,
      [catId]
    )
  ).rows.map((r) => Number(r.n));

  const directAdvance = (
    await q(`SELECT qualification_type FROM enrollments WHERE id_category = $1 AND status = 'active' AND qualification_type != 'group'`, [catId])
  ).rows;

  console.log({
    createTournamentStatus: created.status,
    previewNormalSizes: previewNormal.json?.data?.groups?.map((g: any) => g.target_size), // esperado: prioriza 3 -> [3,3,3]
    previewFoursSizes: previewFours.json?.data?.groups?.map((g: any) => g.target_size), // esperado: [4,4]
    previewFoursDirectAdvance: previewFours.json?.data?.direct_advance_players?.length, // esperado: 1
    startGroupsStatus: startGroups.status,
    gruposPersistidos: groupSizes, // esperado: [4, 4]
    pasesDirectos: directAdvance.map((r) => r.qualification_type), // esperado: ['direct_advance']
  });

  // limpieza
  await q(`DELETE FROM tournaments WHERE id_tournament = $1`, [t]);
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
