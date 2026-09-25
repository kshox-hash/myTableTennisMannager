// Prueba local del motivo de resultado (060): registra "lesión" en un
// partido de grupo pendiente, verifica en la base y lo deshace.
import DB from "../src/db/db_configuration";
import { signToken } from "../src/jwt/jwt";

const API = "http://localhost:4310/api/v1";
(async () => {
  if (!(process.env.PGDATABASE ?? "").endsWith("_local")) throw new Error("Solo base local");
  const pool = DB.getPool();
  const m = (
    await pool.query(
      `SELECT gm.id_match, gm.player1_id, gm.player2_id, t.created_by
       FROM group_matches gm JOIN category_groups g ON g.id_group = gm.id_group
       JOIN tournaments t ON t.id_tournament = g.id_tournament
       WHERE gm.status = 'scheduled' AND gm.player1_id IS NOT NULL AND gm.player2_id IS NOT NULL LIMIT 1`
    )
  ).rows[0];
  const tok = signToken({ id_user: m.created_by, role: "admin" });
  const call = (path: string, body?: unknown) =>
    fetch(API + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, body: await r.text() }));

  // player1 se lesiona → gana player2
  const rec = await call(`/bracket/matches/${m.id_match}/result`, {
    winner_id: m.player2_id, sets_player1: 0, sets_player2: 3, walkover: true, result_reason: "injury",
  });
  const after = (await pool.query(`SELECT status, winner_id = $2 AS p2_won, result_reason FROM group_matches WHERE id_match = $1`, [m.id_match, m.player2_id])).rows[0];
  const pub = await fetch(`${API}/player/match/group/${m.id_match}`, { headers: { Authorization: `Bearer ${tok}` } }).then((r) => r.text());
  const undo = await call(`/bracket/matches/${m.id_match}/undo`);
  const undone = (await pool.query(`SELECT status, result_reason FROM group_matches WHERE id_match = $1`, [m.id_match])).rows[0];
  // un motivo inválido tiene que rechazarse
  const bad = await call(`/bracket/matches/${m.id_match}/result`, {
    winner_id: m.player2_id, sets_player1: 0, sets_player2: 3, walkover: true, result_reason: "cansancio",
  });
  console.log({
    registrar: rec.status,
    guardado: after,
    apiDevuelveMotivo: pub.includes('"result_reason":"injury"'),
    deshacer: undo.status,
    trasDeshacer: undone,
    motivoInvalido: bad.status,
  });
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
