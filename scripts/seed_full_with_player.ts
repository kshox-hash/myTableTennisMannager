// Campeonato COMPLETO (grupos + llave Oro/Plata, todo jugado) en la base
// LOCAL con un usuario dado inscrito como jugador, para ver en la app cómo
// se ve todo desde adentro: sus partidos, su grupo, la llave, el podio, sus
// estadísticas, el historial y los avisos.
// Uso (backend local corriendo, con el .env cargado):
//   npx ts-node --transpile-only scripts/seed_full_with_player.ts jugador.prueba@myttm.local
import DB from "../src/db/db_configuration";
import { signToken } from "../src/jwt/jwt";

const API = "http://localhost:4310/api/v1";
const TOTAL = 24;

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

  const created = await call("POST", `/tournament/admin/create/tournament`, {
    tournament_name: "Copa de Prueba (completa)",
    region: "Metropolitana de Santiago",
    address: "Club Deportivo La Reina",
    event_date: "2026-11-01",
    num_tables: 6,
    categories: [
      {
        category_type: "Todo Competidor",
        category_range: "General",
        gender: "mixed",
        competition_format: "groups_bracket",
        inscription_price: 3000,
        quotas: null,
        qualifiers_per_group: 2,
        createSilverPair: true,
      },
    ],
  });
  const t = created.data.id_tournament as string;
  const cats = (await q(`SELECT id_category, silver_category_id FROM tournament_categories WHERE id_tournament = $1`, [t])).rows;
  const gold = cats.find((c: any) => c.silver_category_id)?.id_category ?? created.data.categories[0].id_category;
  const silver = cats.find((c: any) => c.id_category !== gold)?.id_category ?? null;

  const others = (
    await q(
      `SELECT id_user FROM users
       WHERE id_role = '22222222-2222-2222-2222-222222222222' AND NOT is_team AND id_club IS NOT NULL AND id_user <> $2
       ORDER BY md5(id_user::text || 'completa') LIMIT $1`,
      [TOTAL - 1, me]
    )
  ).rows.map((r: any) => r.id_user as string);
  const players = [me, ...others];
  for (let i = 0; i < players.length; i++) {
    await q(
      `INSERT INTO enrollments (id_user, id_tournament, id_category, paid, paid_at, payment_method, attendance, checked_in)
       VALUES ($1, $2, $3, true, now(), 'transfer', 'present', true)`,
      [players[i], t, gold]
    );
  }
  await q(`UPDATE tournament_categories SET status = 'closed' WHERE id_category = $1`, [gold]);

  // El jugador de prueba juega bien (llega lejos en la llave), con sorpresas.
  const level = new Map(players.map((p) => [p, p === me ? 92 : 20 + Math.random() * 70]));
  const rnd = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
  const setScore = (winnerFirst: boolean) => {
    const deuce = Math.random() < 0.15;
    const ll = deuce ? 10 + rnd(0, 3) : rnd(3, 9);
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

  await call("POST", `/tournament/${t}/categories/${gold}/start-groups`, { best_of_sets: 3, group_size_mode: "fours" });
  const groupMatches = (
    await q(
      `SELECT gm.id_match, gm.player1_id, gm.player2_id
       FROM group_matches gm JOIN category_groups cg ON cg.id_group = gm.id_group
       WHERE cg.id_category = $1 AND gm.winner_id IS NULL AND gm.player1_id IS NOT NULL AND gm.player2_id IS NOT NULL`,
      [gold]
    )
  ).rows;
  for (const m of groupMatches) await call("POST", `/bracket/matches/${m.id_match}/result`, result(m.player1_id, m.player2_id, 3));
  console.log(`Partidos de grupo: ${groupMatches.length}`);

  await call("POST", `/tournament/${t}/categories/${gold}/start-bracket`, { best_of_sets: 5 });
  const bracketCats = [gold, silver].filter(Boolean);
  let played = 0;
  for (let guard = 0; guard < 20; guard++) {
    const pending = (
      await q(
        `SELECT id_match, player1_id, player2_id FROM bracket_matches
         WHERE id_category = ANY($1) AND winner_id IS NULL AND player1_id IS NOT NULL AND player2_id IS NOT NULL`,
        [bracketCats]
      )
    ).rows;
    if (pending.length === 0) break;
    for (const m of pending) {
      await call("POST", `/bracket/bracket-matches/${m.id_match}/result`, result(m.player1_id, m.player2_id, 5));
      played++;
    }
  }
  console.log(`Partidos de llave: ${played}`);
  for (const c of bracketCats) {
    const phase = (await q(`SELECT phase FROM tournament_categories WHERE id_category = $1`, [c])).rows[0]?.phase;
    if (phase !== "finished") await call("POST", `/tournament/categories/${c}/finish`, {}).catch((e) => console.log("finish:", e.message));
  }
  const pos = (
    await q(
      `SELECT count(*)::int AS n FROM group_matches gm JOIN category_groups cg ON cg.id_group = gm.id_group
        WHERE cg.id_category = $1 AND (gm.player1_id = $2 OR gm.player2_id = $2)`,
      [gold, me]
    )
  ).rows[0].n;
  console.log(`Partidos de grupo del jugador: ${pos}`);
  console.log(`Campeonato: ${t}`);
  await new Promise((r) => setTimeout(r, 3000)); // avisos de posiciones finales
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
