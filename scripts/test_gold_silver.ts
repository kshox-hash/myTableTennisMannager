// Prueba local del formato "Oro y Plata": categoría con createSilverPair
// → se crea la Plata hermana → se arma 1 grupo de 4 (vía API real) → se
// cargan los 6 resultados (también vía API real) → al generar la llave de
// Oro, la Plata se puebla sola con los 2 no clasificados y genera su
// propia llave, saltándose su fase de grupos.
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

  // 1) Crear torneo con una categoría Oro/Plata (vía la API real, zod incluido).
  const created = await post(`/tournament/admin/create/tournament`, {
    tournament_name: "Prueba Oro y Plata",
    region: "Metropolitana de Santiago",
    event_date: new Date().toISOString().slice(0, 10),
    categories: [
      {
        category_type: "Prueba OroPlata",
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
  const goldCat = created.json.data.categories[0];
  const goldId = goldCat.id_category;
  const silverId = goldCat.silver_category_id;
  console.log("Oro:", goldId, "Plata:", silverId);
  if (!silverId) throw new Error("No se creó silver_category_id en la categoría Oro");

  // 2) Inscribir 4 jugadores de prueba en Oro y armar el grupo (vía API real).
  const players = (
    await q(
      `SELECT id_user FROM users WHERE email LIKE '%sim.myttm.cl' AND id_role = '22222222-2222-2222-2222-222222222222' LIMIT 4`
    )
  ).rows;
  if (players.length < 4) throw new Error("Faltan jugadores de prueba — correr simulate_production.ts primero");
  for (const p of players) await q(`INSERT INTO enrollments (id_user, id_tournament, id_category) VALUES ($1,$2,$3)`, [p.id_user, t, goldId]);

  const startGroups = await post(`/tournament/${t}/categories/${goldId}/start-groups`, { best_of_sets: 3 });
  if (startGroups.status !== 200) throw new Error(`start-groups falló: ${startGroups.status} ${JSON.stringify(startGroups.json)}`);

  const matches = (
    await q(
      `SELECT gm.id_match, gm.player1_id, gm.player2_id FROM group_matches gm
       JOIN category_groups g ON g.id_group = gm.id_group WHERE g.id_category = $1 ORDER BY gm.match_number`,
      [goldId]
    )
  ).rows;

  // Orden de jugadores = orden de ranking esperado (el primero le gana a todos).
  const order = players.map((p) => p.id_user);
  const expectedQualifiers = order.slice(0, 2); // 1° y 2° → deberían quedar en Oro
  const expectedSilver = order.slice(2, 4); // 3° y 4° → deberían pasar a Plata

  let recorded = 0;
  for (const m of matches) {
    const p1Better = order.indexOf(m.player1_id) < order.indexOf(m.player2_id);
    const r = await post(`/bracket/matches/${m.id_match}/result`, {
      winner_id: p1Better ? m.player1_id : m.player2_id,
      sets_player1: p1Better ? 2 : 0,
      sets_player2: p1Better ? 0 : 2,
      set_scores: p1Better ? [{ p1: 11, p2: 5 }, { p1: 11, p2: 7 }] : [{ p1: 5, p2: 11 }, { p1: 7, p2: 11 }],
    });
    if (r.status === 200) recorded++;
    else console.error("resultado falló:", r.status, r.json);
  }

  // 3) Avanzar Oro a llave (force, por si el auto-avance ya corrió solo) → dispara populateSilverBracket.
  const bracket = await post(`/tournament/${t}/categories/${goldId}/start-bracket`, { force: true });

  // Pequeño margen: populateSilverBracket corre dentro de advanceToBracket,
  // pero por si el auto-avance (checkGroupAutoAdvance) ya lo disparó antes,
  // la 2da llamada cae en el camino BRACKET_ALREADY_EXISTS (también dispara
  // populateSilverBracket) o en WRONG_PHASE (ya estaba en bracket) — ambos
  // casos son aceptables acá, lo que importa es el estado final.

  const goldRow = (await q(`SELECT phase FROM tournament_categories WHERE id_category = $1`, [goldId])).rows[0];
  const silverRow = (await q(`SELECT phase, status FROM tournament_categories WHERE id_category = $1`, [silverId])).rows[0];
  const silverEnrolled = (
    await q(`SELECT id_user, qualification_type, checked_in FROM enrollments WHERE id_category = $1 AND status = 'active'`, [silverId])
  ).rows;
  const silverBracket = (await q(`SELECT round, match_number, player1_id, player2_id FROM bracket_matches WHERE id_category = $1`, [silverId])).rows;
  const goldBracket = (await q(`SELECT round, match_number FROM bracket_matches WHERE id_category = $1`, [goldId])).rows;

  const silverIds = new Set(silverEnrolled.map((r) => r.id_user));
  const silverRosterOk =
    silverIds.size === 2 && expectedSilver.every((id) => silverIds.has(id)) && !expectedQualifiers.some((id) => silverIds.has(id));

  console.log({
    createTournamentStatus: created.status,
    startGroupsStatus: startGroups.status,
    resultadosRegistrados: `${recorded}/${matches.length}`,
    startBracketStatus: bracket.status,
    faseOro: goldRow?.phase,
    fasePlata: silverRow?.phase,
    silverStatus: silverRow?.status,
    silverInscritos: silverEnrolled.length,
    silverRosterCorrecto: silverRosterOk,
    silverQualificationTypes: [...new Set(silverEnrolled.map((r) => r.qualification_type))],
    silverCheckedIn: silverEnrolled.every((r) => r.checked_in === true),
    partidosLlaveOro: goldBracket.length,
    partidosLlavePlata: silverBracket.length,
  });

  // limpieza
  await q(`DELETE FROM tournaments WHERE id_tournament = $1`, [t]);
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
