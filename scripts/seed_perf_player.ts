// Historial de ejemplo para "Mi juego › Rendimiento": varios campeonatos
// COMPLETOS (grupos + llave, todo jugado) en la base LOCAL con un jugador
// inscrito, hasta que ese jugador junte ~50 partidos terminados. Cada
// campeonato en un mes distinto y con un nivel del jugador al azar, para que
// la comparación "último vs anterior" muestre mejoras y bajas.
// Uso (backend local corriendo, con el .env cargado):
//   npx ts-node --transpile-only scripts/seed_perf_player.ts jugador@myttm.local 50
import DB from "../src/db/db_configuration";
import { signToken } from "../src/jwt/jwt";

const API = "http://localhost:4310/api/v1";
const FIELD = 16; // jugadores por campeonato

(async () => {
  if (!(process.env.PGDATABASE ?? "").endsWith("_local")) throw new Error("Solo base local");
  const email = process.argv[2];
  const target = Number(process.argv[3] ?? 50);
  if (!email) throw new Error("Falta el email del jugador");
  const pool = DB.getPool();
  const q = (sql: string, p: unknown[] = []) => pool.query(sql, p);

  const admin = (await q(`SELECT id_user FROM users WHERE email = 'admin@myttm.local'`)).rows[0]?.id_user;
  const me = (await q(`SELECT id_user FROM users WHERE email = $1`, [email])).rows[0]?.id_user;
  if (!admin || !me) throw new Error("Falta admin@myttm.local o el jugador");
  const tok = signToken({ id_user: admin, role: "admin" });
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(API + path, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(json)}`);
    return json;
  };
  const myPlayed = async () =>
    (
      await q(
        `SELECT (
           (SELECT count(*) FROM group_matches WHERE status IN ('played','walkover') AND (player1_id = $1 OR player2_id = $1)) +
           (SELECT count(*) FROM bracket_matches WHERE status IN ('played','walkover') AND is_bye = false AND (player1_id = $1 OR player2_id = $1))
         )::int AS n`,
        [me]
      )
    ).rows[0].n as number;

  const rnd = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
  const months = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2025-12", "2026-01", "2026-02", "2025-09", "2025-10", "2025-11"];
  const names = ["Abierto de Otoño", "Copa Ñuñoa", "Torneo Providencia", "Copa Las Condes", "Abierto Maipú", "Copa La Florida", "Torneo Viña", "Copa Rancagua", "Abierto de Primavera", "Copa Talca", "Torneo Concepción", "Copa Valparaíso", "Copa Iquique", "Abierto La Serena", "Copa Temuco"];

  // Sigue desde los campeonatos de prueba que ya existan (si se corre dos veces).
  let k = (await q(`SELECT count(*)::int AS n FROM tournaments WHERE tournament_name LIKE $1`, ["% (prueba)"])).rows[0].n as number;
  while ((await myPlayed()) < target && k < months.length) {
    const date = `${months[k]}-${String(rnd(5, 25)).padStart(2, "0")}`;
    const bestGroups = Math.random() < 0.5 ? 3 : 5;
    // Nivel del jugador en ESTE campeonato (a veces anda bien, a veces no).
    const myLevel = 35 + Math.random() * 55;
    const created = await call("POST", `/tournament/admin/create/tournament`, {
      tournament_name: `${names[k]} (prueba)`,
      region: "Metropolitana de Santiago",
      address: "Club Deportivo de Prueba",
      event_date: date,
      num_tables: 6,
      categories: [
        {
          category_type: "Todo Competidor",
          category_range: "General",
          gender: "mixed",
          competition_format: "groups_bracket",
          inscription_price: 0,
          quotas: null,
          qualifiers_per_group: 2,
        },
      ],
    });
    const t = created.data.id_tournament as string;
    const cat = (await q(`SELECT id_category FROM tournament_categories WHERE id_tournament = $1 LIMIT 1`, [t])).rows[0].id_category;
    await q(`UPDATE tournaments SET is_ranked = true, ranking_level = $2 WHERE id_tournament = $1`, [t, ["local", "regional", "nacional"][rnd(0, 2)]]);

    const others = (
      await q(
        `SELECT id_user FROM users
         WHERE id_role = '22222222-2222-2222-2222-222222222222' AND NOT is_team AND id_club IS NOT NULL AND id_user <> $2
         ORDER BY md5(id_user::text || $3) LIMIT $1`,
        [FIELD - 1, me, t]
      )
    ).rows.map((r: any) => r.id_user as string);
    const players = [me, ...others];
    for (const p of players) {
      await q(
        `INSERT INTO enrollments (id_user, id_tournament, id_category, paid, paid_at, payment_method, attendance, checked_in)
         VALUES ($1, $2, $3, true, now(), 'transfer', 'present', true)`,
        [p, t, cat]
      );
    }
    await q(`UPDATE tournament_categories SET status = 'closed' WHERE id_category = $1`, [cat]);

    const level = new Map(players.map((p) => [p, p === me ? myLevel : 30 + Math.random() * 60]));
    const setScore = (winnerFirst: boolean) => {
      const deuce = Math.random() < 0.18;
      const ll = deuce ? 10 + rnd(0, 3) : rnd(2, 9);
      const ww = deuce ? ll + 2 : 11;
      return winnerFirst ? { p1: ww, p2: ll } : { p1: ll, p2: ww };
    };
    const result = (p1: string, p2: string, bestOf: number) => {
      const a = level.get(p1) ?? 50;
      const b = level.get(p2) ?? 50;
      const p1Wins = Math.random() < a / (a + b);
      const need = Math.ceil(bestOf / 2);
      const loserSets = rnd(0, need - 1);
      const order: boolean[] = [...Array(need - 1).fill(true), ...Array(loserSets).fill(false)].sort(() => Math.random() - 0.5);
      order.push(true);
      return {
        winner_id: p1Wins ? p1 : p2,
        sets_player1: p1Wins ? need : loserSets,
        sets_player2: p1Wins ? loserSets : need,
        set_scores: order.map((w) => setScore(w === p1Wins)),
      };
    };

    await call("POST", `/tournament/${t}/categories/${cat}/start-groups`, { best_of_sets: bestGroups, group_size_mode: "fours" });
    const gms = (
      await q(
        `SELECT gm.id_match, gm.player1_id, gm.player2_id
         FROM group_matches gm JOIN category_groups cg ON cg.id_group = gm.id_group
         WHERE cg.id_category = $1 AND gm.winner_id IS NULL AND gm.player1_id IS NOT NULL AND gm.player2_id IS NOT NULL`,
        [cat]
      )
    ).rows;
    for (const m of gms) await call("POST", `/bracket/matches/${m.id_match}/result`, result(m.player1_id, m.player2_id, bestGroups));

    await call("POST", `/tournament/${t}/categories/${cat}/start-bracket`, { best_of_sets: 5 });
    for (let guard = 0; guard < 20; guard++) {
      const pending = (
        await q(
          `SELECT id_match, player1_id, player2_id FROM bracket_matches
           WHERE id_category = $1 AND winner_id IS NULL AND player1_id IS NOT NULL AND player2_id IS NOT NULL`,
          [cat]
        )
      ).rows;
      if (pending.length === 0) break;
      for (const m of pending) await call("POST", `/bracket/bracket-matches/${m.id_match}/result`, result(m.player1_id, m.player2_id, 5));
    }
    const phase = (await q(`SELECT phase FROM tournament_categories WHERE id_category = $1`, [cat])).rows[0]?.phase;
    if (phase !== "finished") await call("POST", `/tournament/categories/${cat}/finish`, {}).catch((e) => console.log("finish:", e.message));
    // Partidos en orden de fecha: los del campeonato quedan en su día.
    await q(`UPDATE group_matches gm SET played_at = ($2::date + (random() * interval '6 hours') + interval '9 hours')
             FROM category_groups cg WHERE cg.id_group = gm.id_group AND cg.id_category = $1`, [cat, date]);
    await q(`UPDATE bracket_matches SET played_at = ($2::date + interval '16 hours' + round * interval '30 minutes') WHERE id_category = $1`, [cat, date]);
    k++;
    console.log(`${date} ${names[k - 1]}: nivel ${Math.round(myLevel)} → partidos del jugador: ${await myPlayed()}`);
  }
  await new Promise((r) => setTimeout(r, 2000));
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
