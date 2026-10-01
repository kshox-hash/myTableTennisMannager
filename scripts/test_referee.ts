// Prueba local del arbitraje desde la app: QR de un solo uso, permisos del
// árbitro, marcador en vivo y resultado final. Crea un campeonato de prueba
// (grupo único de 3) y lo borra al final.
import DB from "../src/db/db_configuration";
import { signToken } from "../src/jwt/jwt";

const API = "http://localhost:4310/api/v1";
(async () => {
  if (!(process.env.PGDATABASE ?? "").endsWith("_local")) throw new Error("Solo base local");
  const pool = DB.getPool();
  const q = (sql: string, p: unknown[] = []) => pool.query(sql, p);
  const org = (await q(`SELECT u.id_user FROM users u JOIN roles r ON r.id_role = u.id_role WHERE r.name = 'admin' ORDER BY u.created_at LIMIT 1`)).rows[0].id_user;
  const t = (await q(`INSERT INTO tournaments (tournament_name, created_by, region, event_date, status, visibility, default_best_of_sets, kind)
       VALUES ('Prueba árbitro', $1, 'Metropolitana de Santiago', CURRENT_DATE, 'active', 'private', 3, 'tournament') RETURNING id_tournament`, [org])).rows[0].id_tournament;
  try {
    const c = (await q(`INSERT INTO tournament_categories (id_tournament, category_type, category_range, gender, inscription_price, format, competition_format)
         VALUES ($1, 'Todo Competidor', 'General', 'mixed', 0, 'singles', 'round_robin') RETURNING id_category`, [t])).rows[0].id_category;
    const players = (await q(`SELECT u.id_user FROM users u JOIN roles r ON r.id_role = u.id_role WHERE r.name = 'player' ORDER BY u.created_at LIMIT 5`)).rows.map((r) => r.id_user);
    for (const p of players.slice(0, 3)) await q(`INSERT INTO enrollments (id_user, id_tournament, id_category) VALUES ($1,$2,$3)`, [p, t, c]);
    const referee = players[3], intruder = players[4];

    const call = (tok: string, method: string, path: string, body?: unknown) =>
      fetch(API + path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` }, body: body ? JSON.stringify(body) : undefined })
        .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
    const admin = signToken({ id_user: org, role: "admin" });
    const ref = signToken({ id_user: referee, role: "player" });
    const bad = signToken({ id_user: intruder, role: "player" });

    await call(admin, "POST", `/tournament/${t}/categories/${c}/start-groups`, { best_of_sets: 3 });
    const m = (await q(`SELECT gm.id_match, gm.player1_id, gm.player2_id FROM group_matches gm JOIN category_groups g ON g.id_group = gm.id_group WHERE g.id_category = $1 ORDER BY gm.match_number LIMIT 1`, [c])).rows[0];

    const out: Record<string, unknown> = {};
    out.sinPermisoLive = (await call(ref, "PATCH", `/bracket/referee/matches/${m.id_match}/live-score`, { set_scores: [{ p1: 11, p2: 3 }] })).status;
    const tk = await call(admin, "POST", `/bracket/matches/${m.id_match}/referee-token`);
    out.qrGenerado = tk.status + " " + (tk.json?.data?.qr ?? "").slice(0, 14) + "…";
    out.canjeQR = (await call(ref, "POST", `/bracket/referee/claim`, { token: tk.json.data.qr })).status;
    const reuse = await call(bad, "POST", `/bracket/referee/claim`, { token: tk.json.data.qr });
    out.reusoQR = `${reuse.status} ${reuse.json?.message}`;
    const mine = await call(ref, "GET", `/bracket/referee/my-matches`);
    out.misPartidos = mine.json?.data?.length;
    out.intrusoLive = (await call(bad, "PATCH", `/bracket/referee/matches/${m.id_match}/live-score`, { set_scores: [{ p1: 11, p2: 3 }] })).status;
    out.arbitroLive = (await call(ref, "PATCH", `/bracket/referee/matches/${m.id_match}/live-score`, { set_scores: [{ p1: 11, p2: 3 }] })).status;
    const res = await call(ref, "POST", `/bracket/referee/matches/${m.id_match}/result`, {
      winner_id: m.player1_id, sets_player1: 2, sets_player2: 0, set_scores: [{ p1: 11, p2: 3 }, { p1: 11, p2: 9 }],
    });
    out.arbitroResultado = res.status;
    const row = (await q(`SELECT status, winner_id, set_scores FROM group_matches WHERE id_match = $1`, [m.id_match])).rows[0];
    out.partidoGuardado = `${row.status} ganador=${row.winner_id === m.player1_id ? "jugador1" : "?"} sets=${JSON.stringify(row.set_scores)}`;
    // Asignación desde el panel → aviso
    const m2 = (await q(`SELECT gm.id_match FROM group_matches gm JOIN category_groups g ON g.id_group = gm.id_group WHERE g.id_category = $1 AND gm.winner_id IS NULL LIMIT 1`, [c])).rows[0];
    out.asignarPanel = (await call(admin, "PATCH", `/bracket/matches/${m2.id_match}/referee`, { referee_id: referee })).status;
    await new Promise((r) => setTimeout(r, 500));
    const n = (await q(`SELECT title, message FROM notifications WHERE id_user = $1 AND type = 'referee_assigned' AND id_match = $2`, [referee, m2.id_match])).rows[0];
    out.avisoAsignado = n ? `${n.title}: ${n.message}` : "NO";
    console.log(out);
  } finally {
    await q(`DELETE FROM notifications WHERE id_tournament = $1`, [t]);
    await q(`DELETE FROM tournaments WHERE id_tournament = $1`, [t]);
    await pool.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
