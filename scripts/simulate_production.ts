// Simulación de producción para la base LOCAL — llena la app con miles de
// registros realistas (jugadores, organizadores, clubes, socios, cuotas,
// caja, torneos, inscripciones) y juega las competencias a través de la
// API real del backend (grupos, resultados set a set, llaves, campeones),
// para que notificaciones, estadísticas y ranking salgan del mismo código
// que en producción.
//
// Uso (backend corriendo en local, con el .env cargado):
//   set -a && . ./.env && set +a && npx ts-node -T scripts/simulate_production.ts
//
// NUNCA correr contra producción: se niega si PGDATABASE no termina en _local.

import DB from "../src/db/db_configuration";
import { hashPassword } from "../src/bcrypt/bcrypt";
import { signToken } from "../src/jwt/jwt";
import { ROLE_IDS } from "../src/core/constants/roles";

const API = process.env.SIM_API ?? "http://localhost:4310/api/v1";
const pool = DB.getPool();

if (!(process.env.PGDATABASE ?? "").endsWith("_local")) {
  console.error("Abortado: PGDATABASE no es una base local (*_local).");
  process.exit(1);
}

// ---------- azar reproducible ----------
let seed = 20260925;
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
const chance = (p: number) => rnd() < p;
function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysFromNow = (n: number) => new Date(Date.now() + n * 86400000);

// ---------- datos base ----------
const MALE = ["Matías", "Benjamín", "Vicente", "Martín", "Joaquín", "Agustín", "Tomás", "Lucas", "Diego", "Sebastián", "Nicolás", "Felipe", "Ignacio", "Cristóbal", "Maximiliano", "José", "Juan", "Pablo", "Francisco", "Gabriel", "Rodrigo", "Álvaro", "Gonzalo", "Andrés", "Javier", "Camilo", "Bastián", "Emilio", "Renato", "Luis"];
const FEMALE = ["Sofía", "Isidora", "Florencia", "Agustina", "Emilia", "Josefa", "Martina", "Antonia", "Catalina", "Valentina", "Fernanda", "Javiera", "Constanza", "Camila", "Francisca", "Trinidad", "Amanda", "Ignacia", "Daniela", "Paula", "Carolina", "Macarena", "Rocío", "Bárbara", "Gabriela", "María", "Consuelo", "Pía", "Belén", "Lucía"];
const LAST = ["González", "Muñoz", "Rojas", "Díaz", "Pérez", "Soto", "Contreras", "Silva", "Martínez", "Sepúlveda", "Morales", "Rodríguez", "López", "Fuentes", "Hernández", "Torres", "Araya", "Flores", "Espinoza", "Valenzuela", "Castillo", "Tapia", "Reyes", "Gutiérrez", "Castro", "Pizarro", "Álvarez", "Vásquez", "Sánchez", "Fernández", "Ramírez", "Carrasco", "Gómez", "Cortés", "Herrera", "Núñez", "Jara", "Vergara", "Rivera", "Figueroa"];
const CITIES = ["Santiago", "Providencia", "Ñuñoa", "Las Condes", "Maipú", "Valparaíso", "Viña del Mar", "Concepción", "La Serena", "Temuco", "Rancagua", "Talca", "Antofagasta", "Puerto Montt"];
const CLUB_WORDS = ["Club Deportivo", "Club de Tenis de Mesa", "TT Club", "Academia", "Club Atlético"];
const CLUB_NAMES = ["Los Andes", "Ping Pong Ñuñoa", "Raqueta de Oro", "Spin Master", "Top Spin", "Cordillera", "Pacífico", "Bío Bío", "Mapocho", "Estrella Austral", "Revés Cruzado", "Saque Corto", "Los Halcones", "Mesa Rápida", "Valle Central", "Costa Brava", "Loop Chile", "Bloqueo Sur", "Chop Norte", "Remate Club"];
const CATEGORIES: { type: string; range: string; gender: "male" | "female" | "mixed" }[] = [
  { type: "Todo Competidor", range: "General", gender: "mixed" },
  { type: "Absoluto", range: "Serie A Varones", gender: "male" },
  { type: "Absoluto", range: "Serie A Damas", gender: "female" },
  { type: "Absoluto", range: "Serie B Varones", gender: "male" },
  { type: "Master", range: "Veteranos 40+ Mixto", gender: "mixed" },
  { type: "Juvenil", range: "Sub-18 Mixto", gender: "mixed" },
  { type: "Principiantes", range: "Novicios", gender: "mixed" },
];
const TOURNAMENT_WORDS = ["Open", "Copa", "Torneo", "Circuito", "Campeonato", "Grand Prix", "Desafío", "Clásico"];
const EXPENSES = ["Arriendo del gimnasio", "Pelotas 3 estrellas (caja)", "Mallas nuevas", "Arbitraje", "Trofeos y medallas", "Luz y agua", "Reparación de mesa", "Colaciones torneo"];
const INCOMES = ["Inscripciones torneo", "Aporte municipal", "Venta de camisetas", "Clase particular", "Auspicio local", "Rifa del club"];

type Player = { id: string; gender: "male" | "female"; name: string };

// ---------- API ----------
let apiCalls = 0;
let apiErrors = 0;
const errorSamples: string[] = [];
async function api(token: string, method: string, path: string, body?: unknown) {
  apiCalls++;
  const res = await fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok) {
    apiErrors++;
    if (errorSamples.length < 15) errorSamples.push(`${method} ${path} → ${res.status} ${json?.message ?? ""}`);
    return null;
  }
  return json?.data ?? json;
}

// Marcador realista al mejor de N sets.
function playMatch(bestOf: number) {
  const need = Math.ceil(bestOf / 2);
  const p1Wins = chance(0.5);
  let w = 0, l = 0;
  const sets: { p1: number; p2: number }[] = [];
  while (w < need) {
    const winnerTakes = l < need - 1 ? chance(0.62) : true;
    const deuce = chance(0.18);
    const hi = deuce ? int(12, 16) : 11;
    const lo = deuce ? hi - 2 : int(2, 9);
    if (winnerTakes) { w++; sets.push(p1Wins ? { p1: hi, p2: lo } : { p1: lo, p2: hi }); }
    else { l++; sets.push(p1Wins ? { p1: lo, p2: hi } : { p1: hi, p2: lo }); }
  }
  return { p1Wins, sets, s1: p1Wins ? w : l, s2: p1Wins ? l : w };
}

async function main() {
  const t0 = Date.now();
  const hash = await hashPassword("Sim12345");
  const q = (sql: string, params: unknown[] = []) => pool.query(sql, params);

  // ---------- 1) Jugadores ----------
  console.log("1/7 jugadores…");
  const players: Player[] = [];
  const N_PLAYERS = 1200;
  for (let i = 0; i < N_PLAYERS; i += 200) {
    const values: string[] = [];
    const params: unknown[] = [];
    for (let k = i; k < Math.min(i + 200, N_PLAYERS); k++) {
      const gender = chance(0.7) ? "male" : "female";
      const first = pick(gender === "male" ? MALE : FEMALE);
      const last = `${pick(LAST)} ${pick(LAST)}`;
      const email = `${first}.${last.split(" ")[0]}.${k}@sim.myttm.cl`
        .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "");
      const birth = iso(new Date(int(1965, 2011), int(0, 11), int(1, 28)));
      const created = daysFromNow(-int(1, 540)).toISOString();
      const b = params.length;
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10})`);
      params.push(email, hash, ROLE_IDS.player, first, last, gender, birth, chance(0.93) ? "Chile" : pick(["Argentina", "Perú", "Venezuela", "Colombia"]), chance(0.85) ? (chance(0.88) ? "right-handed" : "left-handed") : null, created);
    }
    const r = await q(
      `INSERT INTO users (email, password_hash, id_role, first_name, last_name, gender, birth_date, country, dominant_hand, created_at)
       VALUES ${values.join(",")} RETURNING id_user, gender, first_name, last_name`,
      params
    );
    for (const row of r.rows) players.push({ id: row.id_user, gender: row.gender, name: `${row.first_name} ${row.last_name}` });
  }

  // ---------- 2) Organizadores (+ admin.local) ----------
  console.log("2/7 organizadores…");
  const organizers: string[] = [];
  for (let k = 0; k < 25; k++) {
    const gender = chance(0.75) ? "male" : "female";
    const first = pick(gender === "male" ? MALE : FEMALE);
    const last = pick(LAST);
    const r = await q(
      `INSERT INTO users (email, password_hash, id_role, first_name, last_name, gender, country, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'Chile',$7) RETURNING id_user`,
      [`organizador${k + 1}@sim.myttm.cl`, hash, ROLE_IDS.admin, first, last, gender, daysFromNow(-int(200, 700)).toISOString()]
    );
    organizers.push(r.rows[0].id_user);
  }
  const local = await q(`SELECT id_user FROM users WHERE email = 'admin.local@myttm.cl'`);
  const adminLocal: string | null = local.rows[0]?.id_user ?? null;

  // ---------- 3) Clubes, socios, solicitudes, cuotas, caja ----------
  console.log("3/7 clubes…");
  const clubOwners = [...organizers.slice(0, 19)];
  const clubs: { id: string; owner: string; fee: number | null; weekly: boolean }[] = [];
  for (let k = 0; k < clubOwners.length; k++) {
    const fee = chance(0.8) ? pick([5000, 8000, 10000, 12000, 15000, 20000]) : null;
    const weekly = fee !== null && chance(0.15);
    const r = await q(
      `INSERT INTO clubs (name, description, founded_date, created_by, monthly_fee, fee_frequency, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id_club`,
      [
        `${pick(CLUB_WORDS)} ${CLUB_NAMES[k]}`,
        `Club de tenis de mesa de ${pick(CITIES)}. Entrenamos ${pick(["martes y jueves", "lunes, miércoles y viernes", "fines de semana"])} y competimos en el circuito regional.`,
        iso(new Date(int(1985, 2022), int(0, 11), int(1, 28))),
        clubOwners[k],
        fee,
        weekly ? "weekly" : "monthly",
        daysFromNow(-int(150, 600)).toISOString(),
      ]
    );
    clubs.push({ id: r.rows[0].id_club, owner: clubOwners[k], fee, weekly });
  }
  const localClub = adminLocal ? (await q(`SELECT id_club, monthly_fee FROM clubs WHERE created_by = $1`, [adminLocal])).rows[0] : null;
  if (localClub) {
    await q(`UPDATE clubs SET name = 'Club Deportivo Admin Local', monthly_fee = COALESCE(monthly_fee, 10000) WHERE id_club = $1`, [localClub.id_club]);
    clubs.push({ id: localClub.id_club, owner: adminLocal!, fee: Number(localClub.monthly_fee ?? 10000), weekly: false });
  }

  const shuffled = shuffle(players);
  let cursor = 0;
  const members = new Map<string, string[]>();
  let nReq = 0, nDues = 0, nCash = 0, nSelected = 0;
  for (const c of clubs) {
    const count = int(15, 60);
    const ids = shuffled.slice(cursor, cursor + count).map((p) => p.id);
    cursor += count;
    members.set(c.id, ids);
    for (const id of ids) {
      const when = daysFromNow(-int(20, 400));
      await q(
        `INSERT INTO club_join_requests (id_club, id_user, status, requested_at, decided_at, decided_by)
         VALUES ($1,$2,'approved',$3,$4,$5)`,
        [c.id, id, when.toISOString(), new Date(when.getTime() + int(1, 72) * 3600000).toISOString(), c.owner]
      );
      nReq++;
    }
    if (ids.length) await q(`UPDATE users SET id_club = $1 WHERE id_user = ANY($2::uuid[])`, [c.id, ids]);

    // pendientes y rechazadas (de jugadores sin club)
    const pending = shuffled.slice(cursor, cursor + int(1, 6));
    cursor += pending.length;
    for (const p of pending) {
      await q(`INSERT INTO club_join_requests (id_club, id_user, status, requested_at) VALUES ($1,$2,'pending',$3)`, [c.id, p.id, daysFromNow(-int(0, 10)).toISOString()]);
      nReq++;
    }
    for (let r = 0; r < int(0, 3); r++) {
      const p = shuffled[int(cursor, shuffled.length - 1)];
      await q(
        `INSERT INTO club_join_requests (id_club, id_user, status, requested_at, decided_at, decided_by)
         VALUES ($1,$2,'rejected',$3,$3,$4)`,
        [c.id, p.id, daysFromNow(-int(10, 90)).toISOString(), c.owner]
      );
      nReq++;
    }

    // plantel
    for (const id of shuffle(ids).slice(0, Math.min(ids.length, int(6, 12)))) {
      await q(`INSERT INTO club_selected_players (id_club, id_user) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [c.id, id]);
      nSelected++;
    }

    // cuotas: últimos 4 meses (mensual) — semanal: últimas 8 semanas
    if (c.fee !== null) {
      const periods: [string, string][] = [];
      if (c.weekly) {
        const monday = new Date();
        monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
        for (let w = 0; w < 8; w++) {
          const s = new Date(monday.getTime() - w * 7 * 86400000);
          periods.push([iso(s), iso(new Date(s.getTime() + 6 * 86400000))]);
        }
      } else {
        const now = new Date();
        for (let m = 0; m < 4; m++) {
          const s = new Date(now.getFullYear(), now.getMonth() - m, 1);
          const e = new Date(now.getFullYear(), now.getMonth() - m + 1, 0);
          periods.push([iso(s), iso(e)]);
        }
      }
      const vals: string[] = [];
      const params: unknown[] = [];
      for (const id of ids) {
        const moroso = chance(0.2);
        periods.forEach(([s, e], idx) => {
          const paid = moroso ? idx >= 2 && chance(0.5) : idx === 0 ? chance(0.6) : chance(0.95);
          if (!paid && idx > 0 && !moroso && chance(0.5)) return; // sin fila = pendiente
          const b = params.length;
          vals.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`);
          params.push(c.id, id, c.fee, paid, paid ? new Date(`${s}T12:00:00Z`).toISOString() : null, s, e);
        });
      }
      if (vals.length) {
        await q(
          `INSERT INTO club_dues (id_club, id_user, amount, paid, paid_at, period_start, period_end)
           VALUES ${vals.join(",")} ON CONFLICT DO NOTHING`,
          params
        );
        nDues += vals.length;
      }
    }

    // caja
    for (let m = 0; m < int(8, 22); m++) {
      const income = chance(0.55);
      await q(
        `INSERT INTO club_cash_movements (id_club, type, amount, description, occurred_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [c.id, income ? "income" : "expense", income ? int(10, 300) * 1000 : int(5, 180) * 1000, pick(income ? INCOMES : EXPENSES), iso(daysFromNow(-int(0, 180))), c.owner]
      );
      nCash++;
    }
  }

  // ---------- 4) Torneos, categorías, inscripciones ----------
  console.log("4/7 torneos e inscripciones…");
  type Cat = { id: string; tournament: string; owner: string; stage: "finished" | "bracket" | "groups" | "enrollment" };
  const cats: Cat[] = [];
  const tournamentOwners = adminLocal ? [...organizers, adminLocal, adminLocal, adminLocal] : organizers;
  const plan: ("finished" | "live" | "upcoming" | "cancelled")[] = [];
  for (let k = 0; k < 60; k++) plan.push(k < 26 ? "finished" : k < 38 ? "live" : k < 55 ? "upcoming" : "cancelled");
  let nTournaments = 0, nCategories = 0, nEnroll = 0;
  const enrollNotifs: unknown[][] = [];

  for (let k = 0; k < plan.length; k++) {
    const kind = plan[k];
    const owner = k < tournamentOwners.length ? tournamentOwners[k] : pick(organizers);
    const date =
      kind === "finished" ? daysFromNow(-int(7, 300)) : kind === "live" ? daysFromNow(0) : kind === "upcoming" ? daysFromNow(int(5, 90)) : daysFromNow(int(-30, 30));
    const city = pick(CITIES);
    const name = `${pick(TOURNAMENT_WORDS)} ${city} ${date.getFullYear()}${chance(0.3) ? " — " + pick(["Invierno", "Primavera", "Verano", "Otoño"]) : ""}`;
    const t = await q(
      `INSERT INTO tournaments (tournament_name, description, created_by, address, region, event_date, event_time, num_tables, status, visibility, default_best_of_sets, is_ranked, kind, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'tournament',$13) RETURNING id_tournament`,
      [
        name,
        `Torneo abierto de tenis de mesa en ${city}. Sistema de grupos y llave eliminatoria.`,
        owner,
        `Gimnasio Municipal de ${city}`,
        city,
        iso(date),
        pick(["09:00", "09:30", "10:00", "15:00"]),
        int(4, 12),
        kind === "cancelled" ? "cancelled" : "active",
        chance(0.8) ? "public" : pick(["private", "internal"]),
        pick([3, 5, 5, 5]),
        chance(0.8),
        new Date(date.getTime() - int(15, 60) * 86400000).toISOString(),
      ]
    );
    const tid = t.rows[0].id_tournament;
    nTournaments++;

    for (const def of shuffle(CATEGORIES).slice(0, int(2, 4))) {
      const c = await q(
        `INSERT INTO tournament_categories (id_tournament, category_type, category_range, gender, inscription_price, quotas, priority, format, qualifiers_per_group)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'singles',2) RETURNING id_category`,
        [tid, def.type, def.range, def.gender, pick([0, 5000, 8000, 10000]), chance(0.5) ? 32 : null, int(1, 4)]
      );
      const cid = c.rows[0].id_category;
      nCategories++;
      const pool_ = players.filter((p) => def.gender === "mixed" || p.gender === def.gender);
      const size =
        kind === "upcoming" ? int(0, 20) : kind === "cancelled" ? int(0, 10) : def.gender === "female" ? int(6, 14) : int(10, 28);
      const chosen = shuffle(pool_).slice(0, size);
      if (chosen.length) {
        const vals: string[] = [];
        const params: unknown[] = [];
        for (const p of chosen) {
          const b = params.length;
          const at = new Date(date.getTime() - int(1, 14) * 86400000).toISOString();
          vals.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4})`);
          params.push(p.id, tid, cid, at);
          enrollNotifs.push([owner, "enrollment_created", "Nueva inscripción", `${p.name} se inscribió en ${def.type} ${def.range}.`, tid, cid, at]);
        }
        await q(`INSERT INTO enrollments (id_user, id_tournament, id_category, enrolled_at) VALUES ${vals.join(",")}`, params);
        nEnroll += chosen.length;
      }
      if (kind === "cancelled" || chosen.length < 4) continue;
      const stage: Cat["stage"] =
        kind === "finished" ? "finished" : kind === "live" ? pick(["groups", "groups", "bracket", "bracket", "finished"] as const) : "enrollment";
      cats.push({ id: cid, tournament: tid, owner, stage });
    }
  }
  // Notificaciones de inscripción para el organizador (en lotes)
  for (let i = 0; i < enrollNotifs.length; i += 300) {
    const chunk = enrollNotifs.slice(i, i + 300);
    const vals = chunk.map((_, j) => `($${j * 7 + 1},$${j * 7 + 2},$${j * 7 + 3},$${j * 7 + 4},$${j * 7 + 5},$${j * 7 + 6},$${j * 7 + 7}, TRUE)`);
    await q(
      `INSERT INTO notifications (id_user, type, title, message, id_tournament, id_category, created_at, is_read) VALUES ${vals.join(",")}`,
      chunk.flat()
    );
  }

  // ---------- 5) Competencia por la API ----------
  console.log(`5/7 jugando ${cats.filter((c) => c.stage !== "enrollment").length} categorías por la API…`);
  const tokens = new Map<string, string>();
  const tokenFor = (id: string) => {
    if (!tokens.has(id)) tokens.set(id, signToken({ id_user: id, role: "admin" }));
    return tokens.get(id)!;
  };
  let nGroupResults = 0, nBracketResults = 0, nTables = 0, done = 0;
  const active = cats.filter((c) => c.stage !== "enrollment");

  for (const c of active) {
    const tok = tokenFor(c.owner);
    const bestOf = pick([3, 5, 5]);
    const started = await api(tok, "POST", `/tournament/${c.tournament}/categories/${c.id}/start-groups`, { best_of_sets: bestOf });
    if (!started) continue;

    const gm = await q(
      `SELECT gm.id_match, gm.player1_id, gm.player2_id, gm.best_of_sets
       FROM group_matches gm JOIN category_groups g ON g.id_group = gm.id_group
       WHERE g.id_category = $1 AND gm.status = 'scheduled' AND gm.player1_id IS NOT NULL AND gm.player2_id IS NOT NULL`,
      [c.id]
    );
    const rows = c.stage === "groups" ? gm.rows.slice(0, Math.floor(gm.rows.length * rnd() * 0.8)) : gm.rows;
    for (const m of rows) {
      const wo = chance(0.03);
      const r = playMatch(m.best_of_sets ?? bestOf);
      const need = Math.ceil((m.best_of_sets ?? bestOf) / 2);
      const ok = await api(tok, "POST", `/bracket/matches/${m.id_match}/result`, wo
        ? { winner_id: r.p1Wins ? m.player1_id : m.player2_id, sets_player1: r.p1Wins ? need : 0, sets_player2: r.p1Wins ? 0 : need, walkover: true }
        : { winner_id: r.p1Wins ? m.player1_id : m.player2_id, sets_player1: r.s1, sets_player2: r.s2, set_scores: r.sets });
      if (ok) nGroupResults++;
    }
    if (c.stage === "groups") {
      // un par de partidos a mesa para ver "tu mesa está lista"
      const pending = gm.rows.slice(rows.length, rows.length + 2);
      for (const [i, m] of pending.entries()) {
        if (await api(tok, "PATCH", `/tournament/tables/assign`, { id_match: m.id_match, match_type: "group", table_number: i + 1 })) nTables++;
      }
      done++;
      continue;
    }

    if (!(await api(tok, "POST", `/tournament/${c.tournament}/categories/${c.id}/start-bracket`, { best_of_sets: bestOf, force: true }))) continue;
    let guard = 0;
    while (guard++ < 12) {
      const ready = await q(
        `SELECT id_match, player1_id, player2_id, best_of_sets FROM bracket_matches
         WHERE id_category = $1 AND status = 'ready' AND player1_id IS NOT NULL AND player2_id IS NOT NULL
         ORDER BY round, match_number`,
        [c.id]
      );
      if (ready.rows.length === 0) break;
      // En "bracket" (en vivo) se deja la última ronda sin jugar.
      const isLast = ready.rows.length === 1;
      if (c.stage === "bracket" && (isLast || chance(0.35))) {
        if (await api(tok, "PATCH", `/tournament/tables/assign`, { id_match: ready.rows[0].id_match, match_type: "bracket", table_number: 1 })) nTables++;
        break;
      }
      for (const m of ready.rows) {
        const r = playMatch(m.best_of_sets ?? bestOf);
        const ok = await api(tok, "POST", `/bracket/bracket-matches/${m.id_match}/result`, {
          winner_id: r.p1Wins ? m.player1_id : m.player2_id, sets_player1: r.s1, sets_player2: r.s2, set_scores: r.sets,
        });
        if (ok) nBracketResults++;
      }
    }
    if (c.stage === "finished") {
      const ph = await q(`SELECT phase FROM tournament_categories WHERE id_category = $1`, [c.id]);
      if (ph.rows[0]?.phase !== "finished") await api(tok, "POST", `/tournament/categories/${c.id}/finish`);
    }
    done++;
    if (done % 10 === 0) console.log(`   ${done}/${active.length} categorías · ${apiCalls} llamadas`);
  }

  // ---------- 6) Viejas notificaciones leídas (realismo) ----------
  console.log("6/7 marcando notificaciones antiguas como leídas…");
  await q(`UPDATE notifications SET is_read = TRUE WHERE created_at < NOW() - INTERVAL '2 days' OR random() < 0.6`);

  // ---------- 7) Resumen ----------
  console.log("7/7 resumen");
  const counts = await q(`
    SELECT 'users' t, COUNT(*) n FROM users UNION ALL
    SELECT 'clubs', COUNT(*) FROM clubs UNION ALL
    SELECT 'club_join_requests', COUNT(*) FROM club_join_requests UNION ALL
    SELECT 'club_dues', COUNT(*) FROM club_dues UNION ALL
    SELECT 'club_cash_movements', COUNT(*) FROM club_cash_movements UNION ALL
    SELECT 'tournaments', COUNT(*) FROM tournaments UNION ALL
    SELECT 'tournament_categories', COUNT(*) FROM tournament_categories UNION ALL
    SELECT 'enrollments', COUNT(*) FROM enrollments UNION ALL
    SELECT 'category_groups', COUNT(*) FROM category_groups UNION ALL
    SELECT 'group_matches', COUNT(*) FROM group_matches UNION ALL
    SELECT 'bracket_matches', COUNT(*) FROM bracket_matches UNION ALL
    SELECT 'notifications', COUNT(*) FROM notifications UNION ALL
    SELECT 'player_stats', COUNT(*) FROM player_stats`);
  console.table(counts.rows);
  console.log({
    creados: { jugadores: players.length, organizadores: organizers.length, clubes: clubs.length, solicitudes: nReq, cuotas: nDues, caja: nCash, plantel: nSelected, torneos: nTournaments, categorias: nCategories, inscripciones: nEnroll },
    api: { llamadas: apiCalls, errores: apiErrors, resultadosGrupo: nGroupResults, resultadosLlave: nBracketResults, mesas: nTables },
    segundos: Math.round((Date.now() - t0) / 1000),
  });
  if (errorSamples.length) console.log("Errores de ejemplo:\n" + errorSamples.join("\n"));
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
