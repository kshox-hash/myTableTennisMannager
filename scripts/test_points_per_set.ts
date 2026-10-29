// Prueba local de "1 set a 21 puntos": torneo con default_best_of_sets=1 /
// default_points_per_set=21 → grupo de 4 (vía API real) → se cargan
// resultados de 1 set a 21 (incluido un caso deuce, 23-21) → se valida que
// un marcador ilegal (21-20, sin deuce) es rechazado → se avanza a llave
// también a 1 set a 21 y se carga un resultado de llave.
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

  // 1) Crear torneo "1 set a 21" (vía la API real, zod incluido).
  const created = await post(`/tournament/admin/create/tournament`, {
    tournament_name: "Prueba 1 set a 21",
    region: "Metropolitana de Santiago",
    event_date: new Date().toISOString().slice(0, 10),
    default_best_of_sets: 1,
    default_points_per_set: 21,
    categories: [
      {
        category_type: "Prueba 21pts",
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
  console.log("Torneo:", t, "Categoría:", catId);

  // 2) Inscribir 4 jugadores de prueba y armar el grupo con best_of_sets=1 / points_per_set=21.
  const players = (
    await q(
      `SELECT id_user FROM users WHERE email LIKE '%sim.myttm.cl' AND id_role = '22222222-2222-2222-2222-222222222222' LIMIT 4`
    )
  ).rows;
  if (players.length < 4) throw new Error("Faltan jugadores de prueba — correr simulate_production.ts primero");
  for (const p of players) await q(`INSERT INTO enrollments (id_user, id_tournament, id_category) VALUES ($1,$2,$3)`, [p.id_user, t, catId]);

  const startGroups = await post(`/tournament/${t}/categories/${catId}/start-groups`, { best_of_sets: 1, points_per_set: 21 });
  if (startGroups.status !== 200) throw new Error(`start-groups falló: ${startGroups.status} ${JSON.stringify(startGroups.json)}`);

  const groupRow = (await q(`SELECT best_of_sets, points_per_set FROM group_matches WHERE id_group = (SELECT id_group FROM category_groups WHERE id_category = $1 LIMIT 1) LIMIT 1`, [catId])).rows[0];

  const matches = (
    await q(
      `SELECT gm.id_match, gm.player1_id, gm.player2_id FROM group_matches gm
       JOIN category_groups g ON g.id_group = gm.id_group WHERE g.id_category = $1 ORDER BY gm.match_number`,
      [catId]
    )
  ).rows;

  const order = players.map((p) => p.id_user);

  // Primer partido: resultado ILEGAL a propósito (21-20, sin deuce) — debe rechazarse.
  const firstMatch = matches[0];
  const illegalAttempt = await post(`/bracket/matches/${firstMatch.id_match}/result`, {
    winner_id: firstMatch.player1_id,
    sets_player1: 1,
    sets_player2: 0,
    set_scores: [{ p1: 21, p2: 20 }],
  });

  let recorded = 0;
  for (const [i, m] of matches.entries()) {
    const p1Better = order.indexOf(m.player1_id) < order.indexOf(m.player2_id);
    // El segundo partido (índice 1) se carga con un marcador deuce válido (23-21); el resto, 21-15.
    const scores =
      i === 1
        ? (p1Better ? { p1: 23, p2: 21 } : { p1: 21, p2: 23 })
        : (p1Better ? { p1: 21, p2: 15 } : { p1: 15, p2: 21 });
    const r = await post(`/bracket/matches/${m.id_match}/result`, {
      winner_id: p1Better ? m.player1_id : m.player2_id,
      sets_player1: p1Better ? 1 : 0,
      sets_player2: p1Better ? 0 : 1,
      set_scores: [scores],
    });
    if (r.status === 200) recorded++;
    else console.error("resultado falló:", r.status, r.json);
  }

  // 3) Avanzar a llave, también a 1 set a 21.
  const bracket = await post(`/tournament/${t}/categories/${catId}/start-bracket`, { best_of_sets: 1, points_per_set: 21, force: true });
  const bracketMatchesRows = (await q(`SELECT id_match, player1_id, player2_id, best_of_sets, points_per_set FROM bracket_matches WHERE id_category = $1 AND player1_id IS NOT NULL AND player2_id IS NOT NULL ORDER BY round, match_number`, [catId])).rows;

  let bracketRecorded = 0;
  for (const m of bracketMatchesRows) {
    const r = await post(`/bracket/bracket-matches/${m.id_match}/result`, {
      winner_id: m.player1_id,
      sets_player1: 1,
      sets_player2: 0,
      set_scores: [{ p1: 21, p2: 10 }],
    });
    if (r.status === 200) bracketRecorded++;
    else console.error("resultado de llave falló:", r.status, r.json);
  }

  console.log({
    createTournamentStatus: created.status,
    startGroupsStatus: startGroups.status,
    groupMatchBestOfSets: groupRow?.best_of_sets,
    groupMatchPointsPerSet: groupRow?.points_per_set,
    marcadorIlegalRechazado: illegalAttempt.status !== 200,
    marcadorIlegalStatus: illegalAttempt.status,
    resultadosGrupoRegistrados: `${recorded}/${matches.length}`,
    startBracketStatus: bracket.status,
    partidosLlaveConJugadores: bracketMatchesRows.length,
    llaveBestOfSets: bracketMatchesRows[0]?.best_of_sets,
    llavePointsPerSet: bracketMatchesRows[0]?.points_per_set,
    resultadosLlaveRegistrados: `${bracketRecorded}/${bracketMatchesRows.length}`,
  });

  // limpieza
  await q(`DELETE FROM tournaments WHERE id_tournament = $1`, [t]);
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
