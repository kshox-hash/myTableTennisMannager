// Prueba local de "grupo único" (061): categoría round_robin con 6
// inscritos → start-groups arma 1 grupo con 15 partidos → se juegan todos
// por la API → la categoría queda 'finished' sola y el podio sale de la
// tabla. También verifica que start-bracket se rechace.
import DB from "../src/db/db_configuration";
import { signToken } from "../src/jwt/jwt";

const API = "http://localhost:4310/api/v1";
(async () => {
  if (!(process.env.PGDATABASE ?? "").endsWith("_local")) throw new Error("Solo base local");
  const pool = DB.getPool();
  const q = (sql: string, p: unknown[] = []) => pool.query(sql, p);

  const org = (await q(`SELECT id_user FROM users WHERE email = 'organizador1@sim.myttm.cl'`)).rows[0].id_user;
  const t = (
    await q(
      `INSERT INTO tournaments (tournament_name, created_by, region, event_date, status, visibility, default_best_of_sets, kind)
       VALUES ('Prueba grupo único', $1, 'Metropolitana de Santiago', CURRENT_DATE, 'active', 'private', 3, 'tournament')
       RETURNING id_tournament`,
      [org]
    )
  ).rows[0].id_tournament;
  const c = (
    await q(
      `INSERT INTO tournament_categories (id_tournament, category_type, category_range, gender, inscription_price, format, competition_format)
       VALUES ($1, 'Paralímpico', 'De pie (Clases 6–10)', 'mixed', 0, 'singles', 'round_robin') RETURNING id_category`,
      [t]
    )
  ).rows[0].id_category;
  const players = (await q(`SELECT id_user FROM users WHERE email LIKE '%sim.myttm.cl' AND id_role = '22222222-2222-2222-2222-222222222222' LIMIT 6`)).rows;
  for (const p of players) await q(`INSERT INTO enrollments (id_user, id_tournament, id_category) VALUES ($1,$2,$3)`, [p.id_user, t, c]);

  const tok = signToken({ id_user: org, role: "admin" });
  const post = (path: string, body?: unknown) =>
    fetch(API + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify(body ?? {}),
    }).then(async (r) => ({ status: r.status, text: await r.text() }));

  const start = await post(`/tournament/${t}/categories/${c}/start-groups`, { best_of_sets: 3 });
  const groups = (await q(`SELECT id_group, target_size FROM category_groups WHERE id_category = $1`, [c])).rows;
  const matches = (
    await q(
      `SELECT gm.id_match, gm.player1_id, gm.player2_id FROM group_matches gm
       JOIN category_groups g ON g.id_group = gm.id_group WHERE g.id_category = $1 ORDER BY gm.match_number`,
      [c]
    )
  ).rows;

  // El jugador con menor índice le gana a todos (resultado predecible)
  const order = players.map((p) => p.id_user);
  let recorded = 0;
  for (const m of matches) {
    const p1First = order.indexOf(m.player1_id) < order.indexOf(m.player2_id);
    const r = await post(`/bracket/matches/${m.id_match}/result`, {
      winner_id: p1First ? m.player1_id : m.player2_id,
      sets_player1: p1First ? 2 : 0,
      sets_player2: p1First ? 0 : 2,
      set_scores: p1First ? [{ p1: 11, p2: 5 }, { p1: 11, p2: 7 }] : [{ p1: 5, p2: 11 }, { p1: 7, p2: 11 }],
    });
    if (r.status === 200) recorded++;
  }
  const phase = (await q(`SELECT phase FROM tournament_categories WHERE id_category = $1`, [c])).rows[0].phase;
  const podium = (
    await q(
      `SELECT gs.position, gs.won, gs.id_user FROM group_standings gs
       JOIN category_groups g ON g.id_group = gs.id_group WHERE g.id_category = $1 ORDER BY gs.position`,
      [c]
    )
  ).rows;
  const podiumOk = podium.slice(0, 4).every((r, i) => r.id_user === order[i] && r.position === i + 1);
  // deshacer el último resultado: el grupo único vuelve a "groups"
  const undo = await post(`/bracket/matches/${matches[matches.length - 1].id_match}/undo`);
  const phaseAfterUndo = (await q(`SELECT phase FROM tournament_categories WHERE id_category = $1`, [c])).rows[0].phase;
  const bracket = await post(`/tournament/${t}/categories/${c}/start-bracket`, { force: true });

  console.log({
    startGroups: start.status,
    grupos: groups.length,
    tamañoGrupo: groups[0]?.target_size,
    partidos: matches.length,
    resultadosRegistrados: recorded,
    faseFinal: phase,
    podioCorrecto: podiumOk,
    podio: podium.slice(0, 4).map((r) => `${r.position}° (${r.won} ganados)`),
    deshacer: undo.status,
    faseTrasDeshacer: phaseAfterUndo,
    startBracketRechazado: bracket.status !== 200 ? `${bracket.status} ${JSON.parse(bracket.text).message}` : "NO",
  });

  // limpieza
  await q(`DELETE FROM tournaments WHERE id_tournament = $1`, [t]);
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
