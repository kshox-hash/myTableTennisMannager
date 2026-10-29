// Prueba local de "los grupos de Oro siempre se arman de a 4": categoría
// Oro/Plata con 9 inscritos (no múltiplo de 4) → deben salir 2 grupos de 4
// (ningún grupo de 3 ni de 2) y el jugador 9 (el de peor ranking) pasa
// directo a la llave de Oro sin jugar fase de grupos — via API real
// (preview + confirmar grupos).
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

  // 1) Crear torneo con categoría Oro/Plata.
  const created = await post(`/tournament/admin/create/tournament`, {
    tournament_name: "Prueba grupos de 4 Oro",
    region: "Metropolitana de Santiago",
    event_date: new Date().toISOString().slice(0, 10),
    categories: [
      {
        category_type: "Prueba OroPlata4",
        category_range: "General",
        gender: "mixed",
        competition_format: "groups_bracket",
        inscription_price: 0,
        quotas: null,
        qualifiers_per_group: 2,
        createSilverPair: true,
      },
    ],
  });
  if (created.status !== 201) throw new Error(`create tournament falló: ${created.status} ${JSON.stringify(created.json)}`);
  const t = created.json.data.id_tournament;
  const goldId = created.json.data.categories[0].id_category;

  // 2) Inscribir 9 jugadores cualquiera (no múltiplo de 4).
  const players = (await q(`SELECT id_user FROM users WHERE id_role = '22222222-2222-2222-2222-222222222222' LIMIT 9`)).rows;
  if (players.length < 9) throw new Error("Faltan jugadores de prueba en la base local");
  for (const p of players) await q(`INSERT INTO enrollments (id_user, id_tournament, id_category) VALUES ($1,$2,$3)`, [p.id_user, t, goldId]);

  // 3) Previsualizar: tiene que salir [4,4] + 1 pase directo.
  const preview = await get(`/tournament/${t}/categories/${goldId}/preview-groups`);

  // 4) Confirmar grupos (vía API real) y revisar lo persistido.
  const startGroups = await post(`/tournament/${t}/categories/${goldId}/start-groups`, { best_of_sets: 3 });
  if (startGroups.status !== 200) throw new Error(`start-groups falló: ${startGroups.status} ${JSON.stringify(startGroups.json)}`);

  const groupSizes = (
    await q(
      `SELECT g.id_group, count(*) AS n FROM category_groups g JOIN group_members gm ON gm.id_group = g.id_group
       WHERE g.id_category = $1 GROUP BY g.id_group ORDER BY n DESC`,
      [goldId]
    )
  ).rows.map((r) => Number(r.n));

  const directAdvance = (
    await q(
      `SELECT id_user, qualification_type, checked_in FROM enrollments WHERE id_category = $1 AND status = 'active' AND qualification_type != 'group'`,
      [goldId]
    )
  ).rows;

  const groupedCount = (await q(`SELECT count(*) AS n FROM group_members gm JOIN category_groups g ON g.id_group = gm.id_group WHERE g.id_category = $1`, [goldId])).rows[0].n;

  console.log({
    createTournamentStatus: created.status,
    previewStatus: preview.status,
    previewGroupSizes: preview.json?.data?.groups?.map((g: any) => g.target_size),
    previewDirectAdvanceCount: preview.json?.data?.direct_advance_players?.length,
    startGroupsStatus: startGroups.status,
    gruposPersistidos: groupSizes, // esperado: [4, 4]
    jugadoresEnGrupos: Number(groupedCount), // esperado: 8
    pasesDirectos: directAdvance.map((r) => ({ qt: r.qualification_type, checkedIn: r.checked_in })), // esperado: 1 x direct_advance, checked_in=true
  });

  // limpieza
  await q(`DELETE FROM tournaments WHERE id_tournament = $1`, [t]);
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
