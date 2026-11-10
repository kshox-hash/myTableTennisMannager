// Prueba de punta a punta del caso INTERCLUBES RyF (8-nov-2026) en la base
// LOCAL: 132 inscritos, 33 grupos de 4, Oro (1° y 2°, llave de 64 con
// pre-llave) y Plata (3°). Revisa las reglas del sorteo y las correcciones
// con la llave armada (Cambiar ganador, cambiar jugadores, deshacer).
// Uso (backend local corriendo en :4310): npx ts-node scripts/e2e_interclubes.ts
import "dotenv/config";
import DB from "../src/db/db_configuration";
import { signToken } from "../src/jwt/jwt";

const API = "http://localhost:4310/api/v1";
const TOTAL = 132;
let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "OK  " : "FALLA"} ${label}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
};

(async () => {
  if (!(process.env.PGDATABASE ?? "").endsWith("_local")) throw new Error("Solo base local");
  const pool = DB.getPool();
  const q = (sql: string, p: unknown[] = []) => pool.query(sql, p);
  const admin = (await q(`SELECT id_user FROM users WHERE email = 'admin@myttm.local'`)).rows[0]?.id_user;
  const tok = signToken({ id_user: admin, role: "admin" });
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(API + path, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json: any = await r.json().catch(() => null);
    if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(json)}`);
    return json;
  };

  const created = await call("POST", `/tournament/admin/create/tournament`, {
    tournament_name: "E2E Interclubes " + new Date().toISOString().slice(11, 19),
    region: "Metropolitana de Santiago",
    address: "Local",
    event_date: "2026-11-20",
    num_tables: 9,
    categories: [
      {
        category_type: "Todo Competidor",
        category_range: "General",
        gender: "mixed",
        competition_format: "groups_bracket",
        inscription_price: 0,
        quotas: null,
        qualifiers_per_group: 2,
        createSilverPair: true,
      },
    ],
  });
  const t = created.data.id_tournament as string;
  const cats = (await q(`SELECT id_category, silver_category_id FROM tournament_categories WHERE id_tournament = $1`, [t])).rows;
  const gold = cats.find((c: any) => c.silver_category_id)!.id_category as string;
  const silver = cats.find((c: any) => c.id_category !== gold)!.id_category as string;

  const players = (
    await q(
      `SELECT id_user FROM users
       WHERE id_role = '22222222-2222-2222-2222-222222222222' AND NOT is_team AND id_club IS NOT NULL
       ORDER BY md5(id_user::text || 'e2e') LIMIT $1`,
      [TOTAL]
    )
  ).rows.map((r: any) => r.id_user as string);
  for (let i = 0; i < players.length; i++) {
    await q(
      `INSERT INTO enrollments (id_user, id_tournament, id_category, attendance, checked_in, seed)
       VALUES ($1, $2, $3, 'present', true, $4)`,
      [players[i], t, gold, i + 1]
    );
  }
  await q(`UPDATE tournament_categories SET status = 'closed' WHERE id_category = $1`, [gold]);
  const clubOf = new Map(
    (await q(`SELECT id_user, id_club FROM users WHERE id_user = ANY($1)`, [players])).rows.map((r: any) => [r.id_user, r.id_club])
  );

  // ── Grupos ──
  await call("POST", `/tournament/${t}/categories/${gold}/start-groups`, { best_of_sets: 3, group_size_mode: "fours" });
  const members = (
    await q(
      `SELECT cg.group_name, gm.id_user, e.seed FROM group_members gm
         JOIN category_groups cg ON cg.id_group = gm.id_group
         JOIN enrollments e ON e.id_user = gm.id_user AND e.id_category = cg.id_category
        WHERE cg.id_category = $1`,
      [gold]
    )
  ).rows;
  const byGroup = new Map<string, any[]>();
  for (const m of members) byGroup.set(m.group_name, [...(byGroup.get(m.group_name) ?? []), m]);
  check("33 grupos de 4", byGroup.size === 33 && [...byGroup.values()].every((g) => g.length === 4));
  const rowsOk = [...byGroup.values()].every((g) => {
    const rows = g.map((m: any) => Math.floor((m.seed - 1) / 33)).sort();
    return rows.join() === "0,1,2,3";
  });
  check("cada grupo tiene un jugador de cada fila", rowsOk);
  check(
    "GR-N tiene como cabeza de serie al sembrado N",
    [...byGroup.entries()].every(([name, g]) => Math.min(...g.map((m: any) => m.seed)) === Number(name.replace(/\D/g, "")))
  );

  // Resultados: gana siempre el de mejor sembrado (así se sabe quién es 1°, 2° y 3°).
  const seedOf = new Map(members.map((m: any) => [m.id_user, m.seed]));
  const res = (p1: string, p2: string) => {
    const p1Wins = seedOf.get(p1)! < seedOf.get(p2)!;
    return {
      winner_id: p1Wins ? p1 : p2,
      sets_player1: p1Wins ? 2 : 0,
      sets_player2: p1Wins ? 0 : 2,
      set_scores: p1Wins ? [{ p1: 11, p2: 5 }, { p1: 11, p2: 6 }] : [{ p1: 5, p2: 11 }, { p1: 6, p2: 11 }],
    };
  };
  const gms = (
    await q(
      `SELECT gm.id_match, gm.player1_id, gm.player2_id FROM group_matches gm
         JOIN category_groups cg ON cg.id_group = gm.id_group WHERE cg.id_category = $1`,
      [gold]
    )
  ).rows;
  for (const m of gms) await call("POST", `/bracket/matches/${m.id_match}/result`, res(m.player1_id, m.player2_id));

  // ── Llave ──
  await call("POST", `/tournament/${t}/categories/${gold}/start-bracket`, { best_of_sets: 5 });
  const bm = async (cat: string) =>
    (await q(`SELECT * FROM bracket_matches WHERE id_category = $1 ORDER BY round, match_number`, [cat])).rows;
  let goldMatches = await bm(gold);
  const groupOf = new Map(members.map((m: any) => [m.id_user, m.group_name]));
  const pre = goldMatches.filter((m: any) => m.round === 0);
  const r1 = goldMatches.filter((m: any) => m.round === 1);
  check("llave de 64 con 2 partidos de pre-llave", r1.length === 32 && pre.length === 2, `r1=${r1.length} pre=${pre.length}`);
  const firstMeet: Array<[string, string]> = pre.map((m: any) => [m.player1_id, m.player2_id]);
  for (const m of r1) {
    const side = (slot: 1 | 2) => {
      const p = slot === 1 ? m.player1_id : m.player2_id;
      if (p) return [p];
      const f = pre.find((x: any) => x.next_match_number === m.match_number && x.next_match_slot === slot);
      return f ? [f.player1_id, f.player2_id] : [];
    };
    for (const a of side(1)) for (const b of side(2)) firstMeet.push([a, b]);
  }
  check("ninguna revancha de grupo en el primer partido", firstMeet.every(([a, b]) => groupOf.get(a) !== groupOf.get(b)));
  const clubClashes = firstMeet.filter(([a, b]) => clubOf.get(a) === clubOf.get(b));
  check("ningún cruce del mismo club en el primer partido", clubClashes.length === 0, `${clubClashes.length} cruces`);
  const halfOf = (id: string) => {
    const m = r1.find((x: any) => x.player1_id === id || x.player2_id === id);
    const n = m ? m.match_number : pre.find((x: any) => x.player1_id === id || x.player2_id === id)!.next_match_number;
    return n <= 16 ? 0 : 1;
  };
  const quals = (await q(`SELECT gs.id_user, gs.qualification_label, cg.group_name FROM group_standings gs JOIN category_groups cg ON cg.id_group = gs.id_group WHERE cg.id_category = $1 AND gs.qualified_to_bracket`, [gold])).rows;
  const halvesOk = [...byGroup.keys()].every((g) => {
    const f = quals.find((x: any) => x.group_name === g && x.qualification_label === "first");
    const s = quals.find((x: any) => x.group_name === g && x.qualification_label === "second");
    return f && s && halfOf(f.id_user) !== halfOf(s.id_user);
  });
  check("cada 2° en la mitad opuesta a su 1°", halvesOk);

  // ── Plata ──
  const silverMatches = await bm(silver);
  const silverPlayers = new Set(silverMatches.flatMap((m: any) => [m.player1_id, m.player2_id]).filter(Boolean));
  check("Plata armada con los 33 terceros", silverPlayers.size === 33, `${silverPlayers.size}`);
  const silverSeeds = (await q(`SELECT seed FROM enrollments WHERE id_category = $1 AND status = 'active' ORDER BY seed`, [silver])).rows.map((r: any) => r.seed);
  check("semillas de Plata 1..33 por orden de grupo", silverSeeds.join() === Array.from({ length: 33 }, (_, i) => i + 1).join());

  // ── Corrección 1: en GR-5 el 2° y el 3° se dan vuelta (Cambiar ganador) ──
  const g5 = members.filter((m: any) => m.group_name === "GR-5").sort((a: any, b: any) => a.seed - b.seed).map((m: any) => m.id_user);
  const [w5, s5, t5] = g5;
  const m23 = gms.find((m: any) => [m.player1_id, m.player2_id].sort().join() === [s5, t5].sort().join());
  const fx = await call("POST", `/bracket/matches/${m23.id_match}/fix-winner`);
  goldMatches = await bm(gold);
  const inGold = (id: string) => goldMatches.some((m: any) => m.player1_id === id || m.player2_id === id);
  const inSilver = async (id: string) => (await bm(silver)).some((m: any) => m.player1_id === id || m.player2_id === id);
  check("2°↔3°: el nuevo 2° entra al Oro y el viejo sale", inGold(t5) && !inGold(s5), JSON.stringify(fx.data));
  check("2°↔3°: el viejo 2° pasa a la Plata y el nuevo 3° sale", (await inSilver(s5)) && !(await inSilver(t5)));
  const enr = (await q(`SELECT id_user, status FROM enrollments WHERE id_category = $1 AND id_user = ANY($2)`, [silver, [s5, t5]])).rows;
  check(
    "2°↔3°: inscripción de Plata al día",
    enr.find((e: any) => e.id_user === s5)?.status === "active" && enr.find((e: any) => e.id_user === t5)?.status === "cancelled"
  );
  check("el viejo 2° no está en las dos llaves", !(inGold(s5) && (await inSilver(s5))));

  // ── Corrección 2: en GR-7 el 1° y el 2° se dan vuelta: cambian de lugar ──
  const g7 = members.filter((m: any) => m.group_name === "GR-7").sort((a: any, b: any) => a.seed - b.seed).map((m: any) => m.id_user);
  const slotOf = (id: string) => {
    const m = goldMatches.find((x: any) => x.player1_id === id || x.player2_id === id)!;
    return `${m.round}-${m.match_number}-${m.player1_id === id ? 1 : 2}`;
  };
  const before1 = slotOf(g7[0]);
  const before2 = slotOf(g7[1]);
  const m12 = gms.find((m: any) => [m.player1_id, m.player2_id].sort().join() === [g7[0], g7[1]].sort().join());
  await call("POST", `/bracket/matches/${m12.id_match}/fix-winner`);
  goldMatches = await bm(gold);
  check("1°↔2°: el nuevo 1° toma el lugar del 1° y viceversa", slotOf(g7[1]) === before1 && slotOf(g7[0]) === before2);

  // ── Corrección 3: con un partido de llave ya jugado, no se toca la llave ──
  const g9 = members.filter((m: any) => m.group_name === "GR-9").sort((a: any, b: any) => a.seed - b.seed).map((m: any) => m.id_user);
  const playedMatch = goldMatches.find((m: any) => m.status === "ready" && (m.player1_id === g9[1] || m.player2_id === g9[1]));
  await call("POST", `/bracket/bracket-matches/${playedMatch.id_match}/result`, {
    winner_id: playedMatch.player1_id,
    sets_player1: 3,
    sets_player2: 0,
    set_scores: [{ p1: 11, p2: 5 }, { p1: 11, p2: 5 }, { p1: 11, p2: 5 }],
  });
  const m9 = gms.find((m: any) => [m.player1_id, m.player2_id].sort().join() === [g9[1], g9[2]].sort().join());
  const blocked = await call("POST", `/bracket/matches/${m9.id_match}/fix-winner`);
  goldMatches = await bm(gold);
  check(
    "jugador con partido de llave jugado: la llave no se toca y avisa",
    (blocked.data.bracketBlockedBy ?? []).length > 0 && inGold(g9[1]) && !inGold(g9[2]),
    JSON.stringify(blocked.data.bracketBlockedBy)
  );
  // Al deshacer ese partido de llave, la llave se cuadra sola.
  await call("POST", `/bracket/bracket-matches/${playedMatch.id_match}/undo`);
  goldMatches = await bm(gold);
  check("al deshacer el partido de llave, la llave se ajusta al grupo", inGold(g9[2]) && !inGold(g9[1]));

  // ── Cambiar jugadores: avisa si quedaría contra uno de su grupo ──
  goldMatches = await bm(gold);
  const g11 = members.filter((m: any) => m.group_name === "GR-11").map((m: any) => m.id_user);
  const g11first = quals.find((x: any) => x.group_name === "GR-11" && x.qualification_label === "first")!.id_user;
  const g11second = quals.find((x: any) => x.group_name === "GR-11" && x.qualification_label === "second")!.id_user;
  const mFirst = goldMatches.find((m: any) => m.round === 1 && (m.player1_id === g11first || m.player2_id === g11first));
  const rival = mFirst.player1_id === g11first ? mFirst.player2_id : mFirst.player1_id;
  if (rival && rival !== g11second && !g11.includes(rival)) {
    const warn = await call("POST", `/bracket/tournaments/${t}/categories/${gold}/swap-bracket-players`, { user_a: rival, user_b: g11second });
    check("cambiar jugadores: pide confirmar si quedan dos del mismo grupo", warn.data?.needs_confirm === true, (warn.data?.warnings ?? []).join(" | "));
    const done = await call("POST", `/bracket/tournaments/${t}/categories/${gold}/swap-bracket-players`, { user_a: rival, user_b: g11second, confirm: true });
    check("cambiar jugadores: con confirmación se hace", done.data?.swapped === true);
  } else {
    console.log("(sin caso para probar el aviso de cambio)");
  }

  const log = (await q(`SELECT action, detail FROM activity_log WHERE id_tournament = $1 ORDER BY created_at`, [t])).rows;
  check("historial registra los cambios", ["group_winner_fixed", "bracket_adjusted", "bracket_players_swapped"].every((a) => log.some((l: any) => l.action === a)));
  for (const l of log) console.log("   historial:", l.action, "—", l.detail ?? "");

  console.log(failures === 0 ? "\nTODO OK" : `\n${failures} FALLA(S)`);
  console.log(`http://localhost:5173/admin/tournaments/${t}`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
