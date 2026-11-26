// Campeonato EN CURSO (hoy, fase de grupos a medio jugar) en la base LOCAL
// con un usuario dado inscrito, para diseñar el Inicio del jugador con datos:
// el jugador ya jugó 2 partidos de su grupo y le queda 1 pendiente; los demás
// grupos van a la mitad.
// Uso (backend local corriendo, con el .env cargado):
//   npx ts-node --transpile-only scripts/seed_in_progress_with_player.ts jugador@myttm.local
import DB from "../src/db/db_configuration";
import { signToken } from "../src/jwt/jwt";

const API = "http://localhost:4310/api/v1";
const TOTAL = 16;

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

  const today = new Date().toISOString().slice(0, 10);
  const created = await call("POST", `/tournament/admin/create/tournament`, {
    tournament_name: "Copa Primavera (en curso)",
    region: "Metropolitana de Santiago",
    address: "Club Deportivo La Reina",
    event_date: today,
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
      },
    ],
  });
  const t = created.data.id_tournament as string;
  const cat = created.data.categories[0].id_category as string;

  const others = (
    await q(
      `SELECT id_user FROM users
       WHERE id_role = '22222222-2222-2222-2222-222222222222' AND NOT is_team AND id_club IS NOT NULL AND id_user <> $2
       ORDER BY md5(id_user::text || 'encurso') LIMIT $1`,
      [TOTAL - 1, me]
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

  const rnd = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
  const set = (w: boolean) => {
    const l = rnd(4, 9);
    return w ? { p1: 11, p2: l } : { p1: l, p2: 11 };
  };
  // Mejor de 3. El jugador de prueba gana uno y pierde otro (para ver G y P).
  const result = (p1: string, p2: string, p1Wins: boolean) => {
    const loserSets = rnd(0, 1);
    const order = [true, ...Array(loserSets).fill(false)].sort(() => Math.random() - 0.5);
    order.push(true);
    return {
      winner_id: p1Wins ? p1 : p2,
      sets_player1: p1Wins ? 2 : loserSets,
      sets_player2: p1Wins ? loserSets : 2,
      set_scores: order.map((w) => set(w === p1Wins)),
    };
  };

  await call("POST", `/tournament/${t}/categories/${cat}/start-groups`, { best_of_sets: 3, group_size_mode: "fours" });
  const matches = (
    await q(
      `SELECT gm.id_match, gm.player1_id, gm.player2_id, gm.id_group
       FROM group_matches gm JOIN category_groups cg ON cg.id_group = gm.id_group
       WHERE cg.id_category = $1 AND gm.player1_id IS NOT NULL AND gm.player2_id IS NOT NULL
       ORDER BY gm.match_number`,
      [cat]
    )
  ).rows;

  let mine = 0;
  let played = 0;
  for (const m of matches) {
    const isMine = m.player1_id === me || m.player2_id === me;
    if (isMine) {
      mine++;
      if (mine > 2) continue; // el 3° queda pendiente
      const iWin = mine === 1; // gana el 1°, pierde el 2°
      const p1Wins = m.player1_id === me ? iWin : !iWin;
      await call("POST", `/bracket/matches/${m.id_match}/result`, result(m.player1_id, m.player2_id, p1Wins));
    } else {
      if (Math.random() < 0.5) continue; // el resto de los grupos va a la mitad
      await call("POST", `/bracket/matches/${m.id_match}/result`, result(m.player1_id, m.player2_id, Math.random() < 0.5));
    }
    played++;
  }
  console.log(`Partidos jugados: ${played} de ${matches.length} (del jugador: ${Math.min(mine, 2)} de ${mine})`);
  console.log(`Campeonato: ${t}`);
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
