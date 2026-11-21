// Campeonato en la base LOCAL con la fase de grupos TERMINADA y lista para
// pasar a la llave: 24 inscritos (6 grupos de 4), Oro (2 por grupo) y Plata
// (los terceros), a nombre de kshox@gmail.com. Usa la misma API que el panel.
// Uso (backend local en :4310): npx ts-node --transpile-only scripts/seed_groups_ready.ts
import DB from "../src/db/db_configuration";
import { signToken } from "../src/jwt/jwt";

const API = "http://localhost:4310/api/v1";
const TOTAL = Number(process.env.TOTAL ?? 24);

(async () => {
  if (!(process.env.PGDATABASE ?? "").endsWith("_local")) throw new Error("Solo base local");
  const pool = DB.getPool();
  const q = (sql: string, p: unknown[] = []) => pool.query(sql, p);

  const admin = (await q(`SELECT id_user FROM users WHERE email = 'kshox@gmail.com'`)).rows[0]?.id_user;
  if (!admin) throw new Error("Falta kshox@gmail.com");
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

  // 1) Campeonato con Oro y Plata.
  const created = await call("POST", `/tournament/admin/create/tournament`, {
    tournament_name: `Grupos listos ${new Date().toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}`,
    region: "Metropolitana de Santiago",
    address: "Club Deportivo La Reina",
    event_date: new Date().toISOString().slice(0, 10),
    num_tables: 9,
    categories: [
      {
        category_type: "Todo Competidor",
        category_range: "General",
        gender: "mixed",
        competition_format: "groups_bracket",
        inscription_price: 5000,
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

  // 2) 124 inscritos, todos presentes; casi todos pagados.
  const players = (
    await q(
      `SELECT id_user FROM users
       WHERE id_role = '22222222-2222-2222-2222-222222222222' AND NOT is_team AND id_club IS NOT NULL
       ORDER BY md5(id_user::text || now()::text) LIMIT $1`,
      [TOTAL]
    )
  ).rows.map((r: any) => r.id_user as string);
  if (players.length < TOTAL) throw new Error(`Solo hay ${players.length} jugadores con club`);
  for (let i = 0; i < players.length; i++) {
    const isPaid = i % 10 !== 9;
    await q(
      `INSERT INTO enrollments (id_user, id_tournament, id_category, paid, paid_at, payment_method, attendance, checked_in)
       VALUES ($1, $2, $3, $4, CASE WHEN $4 THEN now() ELSE NULL END, $5, 'present', true)`,
      [players[i], t, gold, isPaid, isPaid ? (i % 5 < 3 ? "transfer" : "cash") : null]
    );
  }
  await q(`UPDATE tournament_categories SET status = 'closed' WHERE id_category = $1`, [gold]);

  // Nivel de cada jugador: el mejor gana más seguido (con sorpresas).
  const level = new Map(players.map((p) => [p, 20 + Math.random() * 80]));
  const rnd = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
  const setScore = (winnerFirst: boolean) => {
    // 11 a 3–9, o con "deuce" (desde 10-10 se gana por exactamente 2: 12-10, 13-11…).
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
    // Sets del perdedor repartidos antes del último (que siempre gana el ganador).
    const order: boolean[] = [...Array(need - 1).fill(true), ...Array(loserSets).fill(false)].sort(() => Math.random() - 0.5);
    order.push(true);
    const set_scores = order.map((winnerTookIt) => setScore(winnerTookIt === p1Wins));
    return {
      winner_id: p1Wins ? p1 : p2,
      sets_player1: p1Wins ? need : loserSets,
      sets_player2: p1Wins ? loserSets : need,
      set_scores,
    };
  };

  // 3) Grupos (de 4, al mejor de 3) y todos sus partidos.
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
  const groups = (await q(`SELECT count(*)::int AS n FROM category_groups WHERE id_category = $1`, [gold])).rows[0].n;
  console.log(`Grupos: ${groups} · partidos de grupo: ${groupMatches.length}`);

  const phase = (await q(`SELECT phase FROM tournament_categories WHERE id_category = $1`, [gold])).rows[0]?.phase;
  console.log("Fase:", phase);
  console.log(`http://localhost:5180/admin/tournaments/${t}`);
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
