// Cuentas demo para prospectos (ver migración 096).
//
// createDemoAccount() crea un organizador temporal con un campeonato de
// ejemplo con un formato distinto en cada categoría:
//   - Todo Competidor: grupos + llave, a medias (un partido en vivo en la mesa 1).
//   - Damas: todos contra todos, terminada.
//   - Senior +40: grupos con Copa de Oro y Plata, terminada (campeón de cada copa).
//   - Sub-15: todavía en inscripciones, con pagos pendientes.
//
// Todo pasa por la API real del propio servidor (mismas reglas, mismos
// cálculos), firmada como el organizador demo. El campeonato es privado,
// nunca suma al ranking general (tournaments.is_demo) y los jugadores son
// ficticios (email sintético sin-registro+demo-…, sin cuenta ni avisos).
//
// cleanupExpiredDemos() borra las cuentas vencidas con todo lo que crearon.
import { randomBytes, randomUUID } from "crypto";
import DB from "../db/db_configuration";
import { hashPassword } from "../bcrypt/bcrypt";
import { signToken } from "../jwt/jwt";
import { ROLE_IDS } from "../core/constants/roles";

export const DEMO_DAYS = 7;

const FIRST_M = ["Matías", "Benjamín", "Vicente", "Martín", "Joaquín", "Tomás", "Agustín", "Lucas", "Diego", "Felipe", "Ignacio", "Sebastián", "Nicolás", "Cristóbal", "Gabriel", "Maximiliano", "Rodrigo", "Andrés", "Pablo", "Gonzalo", "Javier", "Bastián", "Emilio", "Simón"];
const FIRST_F = ["Sofía", "Isidora", "Florencia", "Antonella", "Catalina", "Josefa", "Valentina", "Martina", "Fernanda", "Javiera", "Constanza", "Amanda"];
const LAST = ["González", "Muñoz", "Rojas", "Díaz", "Pérez", "Soto", "Contreras", "Silva", "Martínez", "Sepúlveda", "Morales", "Rodríguez", "López", "Fuentes", "Hernández", "Torres", "Araya", "Flores", "Espinoza", "Valenzuela", "Castillo", "Tapia", "Reyes", "Gutiérrez", "Castro", "Pizarro", "Álvarez", "Vásquez", "Sánchez", "Fernández"];

const pick = <T,>(arr: T[], n: number) => [...arr].sort(() => Math.random() - 0.5).slice(0, n);
const rnd = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));

function apiBase() {
  return `http://127.0.0.1:${process.env.PORT ?? "3000"}/api/v1`;
}

function makeCaller(idUser: string) {
  const tok = signToken({ id_user: idUser, role: "admin" });
  return async (method: string, path: string, body?: unknown) => {
    const r = await fetch(apiBase() + path, {
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
    if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(json).slice(0, 300)}`);
    return json;
  };
}

// Resultado verosímil: gana más seguido el de mejor "nivel".
function makeResult(level: Map<string, number>) {
  const setScore = (winnerFirst: boolean) => {
    const deuce = Math.random() < 0.15;
    const ll = deuce ? 10 + rnd(0, 3) : rnd(3, 9);
    const ww = deuce ? ll + 2 : 11;
    return winnerFirst ? { p1: ww, p2: ll } : { p1: ll, p2: ww };
  };
  return (p1: string, p2: string, bestOf: number) => {
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
}

function demoPassword() {
  // Fácil de dictar: 3 bloques sin caracteres ambiguos.
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(12);
  let s = "";
  for (let i = 0; i < 12; i++) s += abc[bytes[i] % abc.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

export type DemoAccount = { idUser: string; email: string; password: string; expiresAt: string; idTournament: string };

export async function createDemoAccount(opts: { organization?: string | null; contactName?: string | null }): Promise<DemoAccount> {
  const pool = DB.getPool();
  const q = (sql: string, p: unknown[] = []) => pool.query(sql, p);

  // 1) Cuenta del organizador demo
  const tag = randomBytes(3).toString("hex");
  const email = `demo-${tag}@myttm.cl`;
  const password = demoPassword();
  // Nombre del organizador: la etiqueta que puso el súper usuario (ej. "Club Ñuñoa"), o "Organizador Demo".
  const label = (opts.contactName ?? "").trim();
  const [first, rest] = label ? [label, []] : ["", [] as string[]];
  const u = await q(
    `INSERT INTO users (email, password_hash, id_role, first_name, last_name, organizer_first_name, organizer_last_name, demo_expires_at)
     VALUES ($1, $2, $3, $4::text, $5::text, $4::text, $5::text, now() + ($6::text || ' days')::interval)
     RETURNING id_user, demo_expires_at`,
    [email, await hashPassword(password), ROLE_IDS.admin, first || "Organizador", rest.join(" ") || "Demo", String(DEMO_DAYS)]
  );
  const idUser: string = u.rows[0].id_user;
  const expiresAt: string = new Date(u.rows[0].demo_expires_at).toISOString();

  try {
    const idTournament = await seedTournament(idUser, opts.organization ?? null);
    return { idUser, email, password, expiresAt, idTournament };
  } catch (e) {
    await deleteDemoAccount(idUser).catch(() => undefined);
    throw e;
  }
}

async function seedTournament(owner: string, organization: string | null): Promise<string> {
  const pool = DB.getPool();
  const q = (sql: string, p: unknown[] = []) => pool.query(sql, p);
  const call = makeCaller(owner);

  const today = new Date();
  const ymd = today.toISOString().slice(0, 10);
  const name = organization ? `Copa ${organization.slice(0, 120)} (demo)` : "Copa de Primavera (demo)";

  const created = await call("POST", `/tournament/admin/create/tournament`, {
    tournament_name: name,
    description: "Campeonato de ejemplo para recorrer MyTTM. Los jugadores son ficticios.",
    region: "Metropolitana de Santiago",
    address: "Gimnasio Municipal",
    event_date: ymd,
    event_time: "09:30",
    num_tables: 6,
    visibility: "private",
    ranking_level: "local",
    categories: [
      { category_type: "Todo Competidor", category_range: "General", gender: "mixed", competition_format: "groups_bracket", inscription_price: 5000, quotas: null, qualifiers_per_group: 2 },
      { category_type: "Damas", category_range: "Todo Competidor", gender: "female", competition_format: "round_robin", inscription_price: 5000, quotas: null },
      { category_type: "Senior", category_range: "+40", gender: "mixed", competition_format: "groups_bracket", inscription_price: 5000, quotas: null, qualifiers_per_group: 2, createSilverPair: true },
      { category_type: "Sub-15", category_range: "Juvenil", gender: "mixed", competition_format: "groups_bracket", inscription_price: 3000, quotas: 16, qualifiers_per_group: 2 },
    ],
  });
  const t: string = created.data.id_tournament;
  await q(`UPDATE tournaments SET is_demo = TRUE WHERE id_tournament = $1`, [t]);
  // Ranking propio del organizador demo (para el paso "Ranking e historial").
  await call("POST", `/tournament/admin/tournaments/${t}/ranking`, { mode: "new", name: "Ranking Demo" });

  const cats = (
    await q(
      `SELECT id_category, category_type, silver_category_id FROM tournament_categories WHERE id_tournament = $1`,
      [t]
    )
  ).rows as { id_category: string; category_type: string; silver_category_id: string | null }[];
  const main = cats.find((c) => c.category_type === "Todo Competidor")!;
  const senior = cats.find((c) => c.silver_category_id)!;
  const silverId = senior.silver_category_id!;
  const damas = cats.find((c) => c.category_type === "Damas")!;
  const sub15 = cats.find((c) => c.category_type === "Sub-15")!;

  // Clubes reales del catálogo con escudo (solo como "juega por", en la inscripción).
  const clubs = (
    await q(`SELECT id_club FROM clubs WHERE is_listed AND crest_image_url IS NOT NULL ORDER BY random() LIMIT 8`)
  ).rows.map((r: any) => r.id_club as string);
  const clubOf = (i: number) => (clubs.length ? clubs[i % clubs.length] : null);

  // Jugadores ficticios (sin cuenta: email sintético que nadie puede usar).
  const used = new Set<string>();
  const fakeName = (female: boolean) => {
    for (;;) {
      const f = pick(female ? FIRST_F : FIRST_M, 1)[0];
      const l = pick(LAST, 1)[0];
      if (!used.has(f + l)) {
        used.add(f + l);
        return [f, l] as const;
      }
    }
  };
  const makePlayers = async (n: number, female: (i: number) => boolean, birth: () => string) => {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const fem = female(i);
      const [f, l] = fakeName(fem);
      const r = await q(
        `INSERT INTO users (email, password_hash, id_role, first_name, last_name, gender, birth_date, demo_owner)
         VALUES ($1, '!', $2, $3, $4, $5, $6, $7) RETURNING id_user`,
        [`sin-registro+demo-${randomUUID()}@myttm.local`, ROLE_IDS.player, f, l, fem ? "female" : "male", birth(), owner]
      );
      ids.push(r.rows[0].id_user);
    }
    return ids;
  };
  const adultBirth = () => `${rnd(1975, 2004)}-0${rnd(1, 9)}-1${rnd(0, 9)}`;
  const kidBirth = () => `${rnd(2011, 2013)}-0${rnd(1, 9)}-1${rnd(0, 9)}`;

  const enroll = async (players: string[], cat: string, opts: { paidRatio?: number; closed?: boolean; offset?: number } = {}) => {
    for (let i = 0; i < players.length; i++) {
      const paid = Math.random() < (opts.paidRatio ?? 1);
      await q(
        `INSERT INTO enrollments (id_user, id_tournament, id_category, paid, paid_at, payment_method, attendance, checked_in, club_override)
         VALUES ($1, $2, $3, $4::boolean, CASE WHEN $4::boolean THEN now() END, CASE WHEN $4::boolean THEN $5::text END, $6, $7, $8)`,
        [players[i], t, cat, paid, Math.random() < 0.5 ? "transfer" : "cash", opts.closed ? "present" : "pending", !!opts.closed, clubOf(i + (opts.offset ?? 0))]
      );
    }
    if (opts.closed) await q(`UPDATE tournament_categories SET status = 'closed' WHERE id_category = $1`, [cat]);
  };

  const seniorBirth = () => `${rnd(1960, 1985)}-0${rnd(1, 9)}-1${rnd(0, 9)}`;
  const mainPlayers = await makePlayers(24, (i) => i % 6 === 0, adultBirth);
  const damasPlayers = await makePlayers(6, () => true, adultBirth);
  const seniorPlayers = await makePlayers(16, (i) => i % 5 === 0, seniorBirth);
  const subPlayers = await makePlayers(11, (i) => i % 3 === 0, kidBirth);
  await enroll(mainPlayers, main.id_category, { closed: true });
  await enroll(damasPlayers, damas.id_category, { closed: true, offset: 3 });
  await enroll(seniorPlayers, senior.id_category, { closed: true, offset: 2 });
  await enroll(subPlayers, sub15.id_category, { paidRatio: 0.6, offset: 5 });

  const level = new Map<string, number>([...mainPlayers, ...damasPlayers, ...seniorPlayers].map((p) => [p, 20 + Math.random() * 70]));
  const result = makeResult(level);

  const pendingGroup = async (cat: string) =>
    (
      await q(
        `SELECT gm.id_match, gm.player1_id, gm.player2_id
           FROM group_matches gm JOIN category_groups cg ON cg.id_group = gm.id_group
          WHERE cg.id_category = $1 AND gm.winner_id IS NULL AND gm.player1_id IS NOT NULL AND gm.player2_id IS NOT NULL`,
        [cat]
      )
    ).rows;
  const pendingBracket = async (cat: string) =>
    (
      await q(
        `SELECT id_match, player1_id, player2_id, round FROM bracket_matches
          WHERE id_category = $1 AND winner_id IS NULL AND player1_id IS NOT NULL AND player2_id IS NOT NULL
          ORDER BY round, id_match`,
        [cat]
      )
    ).rows;
  const playAllGroups = async (cat: string) => {
    await call("POST", `/tournament/${t}/categories/${cat}/start-groups`, { best_of_sets: 3, group_size_mode: "fours" });
    for (const m of await pendingGroup(cat)) await call("POST", `/bracket/matches/${m.id_match}/result`, result(m.player1_id, m.player2_id, 3));
  };
  const playGroups = async (cat: string) => {
    await playAllGroups(cat);
    await call("POST", `/tournament/${t}/categories/${cat}/start-bracket`, { best_of_sets: 5 });
  };
  const playBracketToEnd = async (cat: string) => {
    for (let guard = 0; guard < 12; guard++) {
      const pend = await pendingBracket(cat);
      if (!pend.length) break;
      for (const m of pend) await call("POST", `/bracket/bracket-matches/${m.id_match}/result`, result(m.player1_id, m.player2_id, 5));
    }
  };
  const finish = async (cat: string) => {
    const phase = (await q(`SELECT phase FROM tournament_categories WHERE id_category = $1`, [cat])).rows[0]?.phase;
    if (phase !== "finished") await call("POST", `/tournament/categories/${cat}/finish`, {}).catch(() => undefined);
  };

  // Damas: todos contra todos, terminada (podio por tabla).
  await playAllGroups(damas.id_category);
  await finish(damas.id_category);

  // Senior +40: Copa de Oro y Plata, las dos llaves terminadas.
  await playGroups(senior.id_category);
  await playBracketToEnd(senior.id_category);
  await playBracketToEnd(silverId);
  await finish(senior.id_category);
  await finish(silverId);

  // Todo Competidor: grupos jugados, llave a medias.
  await playGroups(main.id_category);
  const firstRound = await pendingBracket(main.id_category);
  const minRound = Math.min(...firstRound.map((m: any) => m.round));
  for (const m of firstRound.filter((m: any) => m.round === minRound)) {
    await call("POST", `/bracket/bracket-matches/${m.id_match}/result`, result(m.player1_id, m.player2_id, 5));
  }
  const next = await pendingBracket(main.id_category);
  // La mitad de la ronda siguiente jugada; uno en vivo en la mesa 1 y otro esperando en la mesa 2.
  const half = Math.max(0, Math.floor(next.length / 2) - 1);
  for (const m of next.slice(0, half)) await call("POST", `/bracket/bracket-matches/${m.id_match}/result`, result(m.player1_id, m.player2_id, 5));
  const live = next[half];
  const waiting = next[half + 1];
  if (live) {
    await call("PATCH", `/tournament/tables/assign`, { id_match: live.id_match, match_type: "bracket", table_number: 1 }).catch(() => undefined);
    await call("PATCH", `/bracket/bracket-matches/${live.id_match}/live-score`, {
      set_scores: [{ p1: 11, p2: 8 }, { p1: 9, p2: 11 }, { p1: 7, p2: 5 }],
    }).catch(() => undefined);
  }
  if (waiting) {
    await call("PATCH", `/tournament/tables/assign`, { id_match: waiting.id_match, match_type: "bracket", table_number: 2 }).catch(() => undefined);
  }

  // La siembra deja puntos de "deshacer"; para la demo se parte de cero.
  await q(`DELETE FROM undo_points WHERE id_tournament = $1`, [t]).catch(() => undefined);
  return t;
}

// Borra una cuenta demo y todo lo que creó (campeonatos, rankings, jugadores ficticios).
export async function deleteDemoAccount(idUser: string): Promise<void> {
  const pool = DB.getPool();
  const q = (sql: string, p: unknown[] = []) => pool.query(sql, p);
  const isDemo = (await q(`SELECT 1 FROM users WHERE id_user = $1 AND demo_expires_at IS NOT NULL`, [idUser])).rowCount;
  if (!isDemo) return;

  const { AdminTournamentRepository } = await import("../tournament/admin/admin_tournament_repository");
  const repo = new AdminTournamentRepository();
  const ts = (await q(`SELECT id_tournament FROM tournaments WHERE created_by = $1`, [idUser])).rows;
  for (const r of ts) await repo.deleteTournament(r.id_tournament, idUser);
  await q(`DELETE FROM rankings WHERE id_owner = $1`, [idUser]).catch(() => undefined);
  await q(`DELETE FROM users WHERE demo_owner = $1`, [idUser]);
  await q(`UPDATE demo_requests SET demo_user_id = NULL WHERE demo_user_id = $1`, [idUser]);
  await q(`DELETE FROM users WHERE id_user = $1`, [idUser]);
}

export async function cleanupExpiredDemos(): Promise<number> {
  const rows = (await DB.getPool().query(`SELECT id_user FROM users WHERE demo_expires_at < now()`)).rows;
  let n = 0;
  for (const r of rows) {
    try {
      await deleteDemoAccount(r.id_user);
      n++;
    } catch (e) {
      console.error("[demo] no se pudo borrar la cuenta demo", r.id_user, e);
    }
  }
  return n;
}
