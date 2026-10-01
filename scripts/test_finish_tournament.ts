// Prueba local de "Finalizar campeonato" en cualquier momento. Crea un
// campeonato con 2 categorías (A jugada completa, B a medias), lo finaliza y
// revisa: podio de A intacto, B cortada sin podio, pendientes borrados,
// jugados conservados, aviso a inscritos. Lo borra al final.
import DB from "../src/db/db_configuration";
import { signToken } from "../src/jwt/jwt";
const API = "http://localhost:4310/api/v1";
(async () => {
  if (!(process.env.PGDATABASE ?? "").endsWith("_local")) throw new Error("Solo base local");
  const pool = DB.getPool();
  const q = (sql: string, p: unknown[] = []) => pool.query(sql, p);
  const org = (await q(`SELECT u.id_user FROM users u JOIN roles r ON r.id_role = u.id_role WHERE r.name = 'admin' ORDER BY u.created_at LIMIT 1`)).rows[0].id_user;
  const t = (await q(`INSERT INTO tournaments (tournament_name, created_by, region, event_date, status, visibility, default_best_of_sets, kind)
     VALUES ('Prueba finalizar', $1, 'Metropolitana de Santiago', CURRENT_DATE, 'active', 'private', 3, 'tournament') RETURNING id_tournament`, [org])).rows[0].id_tournament;
  try {
    const mk = async (range: string) => (await q(`INSERT INTO tournament_categories (id_tournament, category_type, category_range, gender, inscription_price, format, competition_format)
       VALUES ($1, 'Todo Competidor', $2, 'mixed', 0, 'singles', 'round_robin') RETURNING id_category`, [t, range])).rows[0].id_category;
    const A = await mk("A"), B = await mk("B");
    const players = (await q(`SELECT u.id_user FROM users u JOIN roles r ON r.id_role = u.id_role WHERE r.name = 'player' ORDER BY u.created_at LIMIT 3`)).rows.map((r) => r.id_user);
    for (const c of [A, B]) for (const p of players) await q(`INSERT INTO enrollments (id_user, id_tournament, id_category) VALUES ($1,$2,$3)`, [p, t, c]);
    const tok = signToken({ id_user: org, role: "admin" });
    const call = (path: string, body?: unknown) => fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` }, body: JSON.stringify(body ?? {}) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
    const matchesOf = async (c: string) => (await q(`SELECT gm.id_match, gm.player1_id, gm.player2_id, gm.status FROM group_matches gm JOIN category_groups g ON g.id_group = gm.id_group WHERE g.id_category = $1 ORDER BY gm.match_number`, [c])).rows;
    const play = (m: any) => call(`/bracket/matches/${m.id_match}/result`, { winner_id: m.player1_id, sets_player1: 2, sets_player2: 0, set_scores: [{ p1: 11, p2: 5 }, { p1: 11, p2: 6 }] });
    for (const c of [A, B]) await call(`/tournament/${t}/categories/${c}/start-groups`, { best_of_sets: 3 });
    for (const m of await matchesOf(A)) await play(m);          // A completa
    const bm = await matchesOf(B); await play(bm[0]);            // B: 1 de 3 jugado
    const phaseA0 = (await q(`SELECT phase FROM tournament_categories WHERE id_category = $1`, [A])).rows[0].phase;

    const fin = await call(`/tournament/admin/tournaments/${t}/finish`);
    const cats = (await q(`SELECT category_range, phase, finished_early FROM tournament_categories WHERE id_tournament = $1 ORDER BY category_range`, [t])).rows;
    const bLeft = await matchesOf(B);
    const notif = (await q(`SELECT COUNT(*)::int AS n FROM notifications WHERE id_tournament = $1 AND type = 'tournament_finished'`, [t])).rows[0].n;
    const again = await call(`/tournament/admin/tournaments/${t}/finish`);
    const { PlayerRepository } = await import("../src/player/player_repository");
    const repo = new PlayerRepository(pool);
    const podA = (await repo.getCategoryStandings(t, A)).standings.length;
    const podB = (await repo.getCategoryStandings(t, B)).standings.length;
    console.log({
      faseA_antes: phaseA0,
      finalizar: `${fin.status} ${JSON.stringify(fin.json?.data)}`,
      categorias: cats.map((c) => `${c.category_range}: ${c.phase}${c.finished_early ? " (cortada)" : ""}`),
      partidosB_quedan: bLeft.map((m) => m.status),
      podioA: podA, podioB: podB,
      avisos: notif,
      finalizarDeNuevo: `${again.status} ${again.json?.message}`,
    });
  } finally {
    await q(`DELETE FROM notifications WHERE id_tournament = $1`, [t]);
    await q(`DELETE FROM tournaments WHERE id_tournament = $1`, [t]);
    await pool.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
