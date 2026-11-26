// Campeonato de HOY en curso, con un jugador inscrito en 3 categorías: grupos
// armados, algunos partidos jugados y uno en mesa (en vivo) por categoría.
// Para ver cómo se ve la app de un jugador en pleno campeonato. Base LOCAL.
// Uso (backend local corriendo, con el .env cargado):
//   npx ts-node --transpile-only scripts/seed_live_3cats.ts jugador@myttm.local
import DB from "../src/db/db_configuration";
import { signToken } from "../src/jwt/jwt";

const API = "http://localhost:4310/api/v1";

(async () => {
  if (!(process.env.PGDATABASE ?? "").endsWith("_local")) throw new Error("Solo base local");
  const email = process.argv[2];
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
  const rnd = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
  const today = new Date().toISOString().slice(0, 10);

  const cats = [
    { category_type: "Todo Competidor", category_range: "General" },
    { category_type: "Absoluto", category_range: "Serie A" },
    { category_type: "Master", category_range: "40+" },
  ];
  const created = await call("POST", `/tournament/admin/create/tournament`, {
    tournament_name: "Copa en Vivo (prueba)",
    region: "Metropolitana de Santiago",
    address: "Gimnasio Municipal de Prueba",
    event_date: today,
    num_tables: 8,
    categories: cats.map((c) => ({
      ...c,
      gender: "mixed",
      competition_format: "groups_bracket",
      inscription_price: 0,
      quotas: null,
      qualifiers_per_group: 2,
    })),
  });
  const t = created.data.id_tournament as string;
  const catIds = (await q(`SELECT id_category FROM tournament_categories WHERE id_tournament = $1 ORDER BY category_type`, [t])).rows.map(
    (r: any) => r.id_category as string
  );

  const setScore = (winnerFirst: boolean) => {
    const deuce = Math.random() < 0.18;
    const ll = deuce ? 10 + rnd(0, 3) : rnd(2, 9);
    const ww = deuce ? ll + 2 : 11;
    return winnerFirst ? { p1: ww, p2: ll } : { p1: ll, p2: ww };
  };
  const result = (p1: string, p2: string, bestOf: number) => {
    const p1Wins = Math.random() < (p1 === me ? 0.6 : p2 === me ? 0.4 : 0.5);
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

  let table = 1;
  for (const [i, cat] of catIds.entries()) {
    const others = (
      await q(
        `SELECT id_user FROM users
         WHERE id_role = '22222222-2222-2222-2222-222222222222' AND NOT is_team AND id_club IS NOT NULL AND id_user <> $2
         ORDER BY md5(id_user::text || $3) LIMIT $1`,
        [11, me, cat]
      )
    ).rows.map((r: any) => r.id_user as string);
    for (const p of [me, ...others]) {
      await q(
        `INSERT INTO enrollments (id_user, id_tournament, id_category, paid, paid_at, payment_method, attendance, checked_in)
         VALUES ($1, $2, $3, true, now(), 'transfer', 'present', true)`,
        [p, t, cat]
      );
    }
    await q(`UPDATE tournament_categories SET status = 'closed' WHERE id_category = $1`, [cat]);
    await call("POST", `/tournament/${t}/categories/${cat}/start-groups`, { best_of_sets: 3, group_size_mode: "fours" });

    const gms = (
      await q(
        `SELECT gm.id_match, gm.player1_id, gm.player2_id
         FROM group_matches gm JOIN category_groups cg ON cg.id_group = gm.id_group
         WHERE cg.id_category = $1 AND gm.winner_id IS NULL AND gm.player1_id IS NOT NULL AND gm.player2_id IS NOT NULL
         ORDER BY gm.match_number`,
        [cat]
      )
    ).rows;
    // Del jugador: 1 jugado, 1 en mesa (en vivo) y el resto por jugar.
    const mine = gms.filter((m: any) => m.player1_id === me || m.player2_id === me);
    const others2 = gms.filter((m: any) => m.player1_id !== me && m.player2_id !== me);
    if (mine[0]) await call("POST", `/bracket/matches/${mine[0].id_match}/result`, result(mine[0].player1_id, mine[0].player2_id, 3));
    // La mitad de los partidos de los demás, jugados.
    for (const m of others2.slice(0, Math.ceil(others2.length / 2))) await call("POST", `/bracket/matches/${m.id_match}/result`, result(m.player1_id, m.player2_id, 3));
    if (mine[1]) {
      const iAm1 = mine[1].player1_id === me;
      const a = rnd(3, 9), b = rnd(2, 9);
      // En mesa con el 1er set cerrado y el 2° en juego.
      const sets = [iAm1 ? { p1: 11, p2: rnd(4, 9) } : { p1: rnd(4, 9), p2: 11 }, { p1: a, p2: b }];
      await q(`UPDATE group_matches SET table_number = $2, set_scores = $3::jsonb WHERE id_match = $1`, [mine[1].id_match, table++, JSON.stringify(sets)]);
    }
    console.log(`Categoría ${i + 1}: ${gms.length} partidos de grupo, jugador con ${mine.length}`);
  }
  console.log(`Campeonato: ${t}`);
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
