// Prueba de punta a punta de la LLAVE ADELANTADA en la base LOCAL: 40
// inscritos (10 grupos de 4, muchos del mismo club), Oro y Plata. Se juega la
// mitad de los grupos, se adelanta la llave y se revisa: reglas del sorteo con
// cupos, recomendaciones para la mesa de control, mover cupos a mano, llenado
// de cupos al terminar cada grupo y "Cambiar ganador" con la llave adelantada.
// Uso (backend local en :4310): npx ts-node --transpile-only scripts/e2e_llave_adelantada.ts
import "dotenv/config";
import DB from "../src/db/db_configuration";
import { signToken } from "../src/jwt/jwt";

const API = "http://localhost:4310/api/v1";
const TOTAL = 40;
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
    tournament_name: "E2E Adelantada " + new Date().toISOString().slice(11, 19),
    region: "Metropolitana de Santiago",
    address: "Local",
    event_date: "2026-11-21",
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
        createSilverPair: true,
      },
    ],
  });
  const t = created.data.id_tournament as string;
  const cats = (await q(`SELECT id_category, silver_category_id FROM tournament_categories WHERE id_tournament = $1`, [t])).rows;
  const gold = cats.find((c: any) => c.silver_category_id)!.id_category as string;
  const silver = cats.find((c: any) => c.id_category !== gold)!.id_category as string;

  // La mitad del club más grande y el resto de otros: así aparecen cruces de club.
  const bigClub = (
    await q(
      `SELECT id_club FROM users WHERE id_role = '22222222-2222-2222-2222-222222222222' AND NOT is_team AND id_club IS NOT NULL
        GROUP BY id_club ORDER BY count(*) DESC LIMIT 1`
    )
  ).rows[0].id_club;
  const pick = async (sameClub: boolean, n: number) =>
    (
      await q(
        `SELECT id_user FROM users WHERE id_role = '22222222-2222-2222-2222-222222222222' AND NOT is_team
            AND id_club IS NOT NULL AND (id_club = $1) = $2 ORDER BY md5(id_user::text || 'adel') LIMIT $3`,
        [bigClub, sameClub, n]
      )
    ).rows.map((r: any) => r.id_user as string);
  const big = await pick(true, 18);
  const rest = await pick(false, TOTAL - big.length);
  const players = [...big, ...rest].sort(() => Math.random() - 0.5);
  for (let i = 0; i < players.length; i++) {
    await q(
      `INSERT INTO enrollments (id_user, id_tournament, id_category, attendance, checked_in, seed)
       VALUES ($1, $2, $3, 'present', true, $4)`,
      [players[i], t, gold, i + 1]
    );
  }
  await q(`UPDATE tournament_categories SET status = 'closed' WHERE id_category = $1`, [gold]);
  await call("POST", `/tournament/${t}/categories/${gold}/start-groups`, { best_of_sets: 3, group_size_mode: "fours" });

  const members = (
    await q(
      `SELECT cg.id_group, cg.group_name, gm.id_user, e.seed FROM group_members gm
         JOIN category_groups cg ON cg.id_group = gm.id_group
         JOIN enrollments e ON e.id_user = gm.id_user AND e.id_category = cg.id_category
        WHERE cg.id_category = $1`,
      [gold]
    )
  ).rows;
  const seedOf = new Map(members.map((m: any) => [m.id_user, m.seed]));
  const groupIds = [...new Set(members.map((m: any) => m.id_group))] as string[];
  const nameOf = new Map(members.map((m: any) => [m.id_group, m.group_name]));
  const ordered = groupIds.sort((a, b) => Number(nameOf.get(a)!.slice(3)) - Number(nameOf.get(b)!.slice(3)));
  const res = (p1: string, p2: string) => {
    const p1Wins = seedOf.get(p1)! < seedOf.get(p2)!;
    return {
      winner_id: p1Wins ? p1 : p2,
      sets_player1: p1Wins ? 2 : 0,
      sets_player2: p1Wins ? 0 : 2,
      set_scores: p1Wins ? [{ p1: 11, p2: 5 }, { p1: 11, p2: 6 }] : [{ p1: 5, p2: 11 }, { p1: 6, p2: 11 }],
    };
  };
  const playGroup = async (gid: string) => {
    const ms = (await q(`SELECT id_match, player1_id, player2_id FROM group_matches WHERE id_group = $1 AND status = 'scheduled'`, [gid])).rows;
    for (const m of ms) await call("POST", `/bracket/matches/${m.id_match}/result`, res(m.player1_id, m.player2_id));
  };
  for (const g of ordered.slice(0, 5)) await playGroup(g);

  // ── Adelantar la llave con 5 grupos sin terminar ──
  await call("POST", `/tournament/${t}/categories/${gold}/start-bracket`, { best_of_sets: 3, early: true });
  const bm = async () => (await q(`SELECT * FROM bracket_matches WHERE id_category = $1 ORDER BY round, match_number`, [gold])).rows;
  let matches = await bm();
  const slotsCount = matches.reduce((n: number, m: any) => n + (m.player1_source_group && !m.player1_id ? 1 : 0) + (m.player2_source_group && !m.player2_id ? 1 : 0), 0);
  check("llave adelantada con 10 cupos por llenar (5 grupos × 2)", slotsCount === 10, `${slotsCount}`);

  // Mitades: con cupos, el grupo se reconoce por source_group.
  const firstRound = matches.filter((m: any) => m.round === 1);
  const half = (m: any) => ((m.round === 0 ? m.next_match_number : m.match_number) <= firstRound.length / 2 ? 0 : 1);
  const labelOf = new Map(
    (await q(`SELECT gs.id_user, gs.qualification_label FROM group_standings gs JOIN category_groups cg ON cg.id_group = gs.id_group WHERE cg.id_category = $1`, [gold])).rows.map((r: any) => [r.id_user, r.qualification_label])
  );
  const groupOfUser = new Map(members.map((m: any) => [m.id_user, m.id_group]));
  const pos: Array<{ group: string; rank: number; half: number }> = [];
  for (const m of matches.filter((x: any) => x.round <= 1)) {
    for (const s of [1, 2]) {
      const p = m[`player${s}_id`];
      const sg = m[`player${s}_source_group`];
      if (sg) pos.push({ group: sg, rank: Number(m[`player${s}_source_rank`]), half: half(m) });
      else if (p && labelOf.get(p)) pos.push({ group: groupOfUser.get(p)!, rank: labelOf.get(p) === "first" ? 1 : 2, half: half(m) });
    }
  }
  const halvesOk = ordered.every((g) => {
    const f = pos.find((x) => x.group === g && x.rank === 1);
    const s = pos.find((x) => x.group === g && x.rank === 2);
    return f && s && f.half !== s.half;
  });
  check("cada 2° (jugador o cupo) en la mitad opuesta a su 1°", halvesOk);

  // ── Recomendaciones ──
  const sug1 = (await call("GET", `/bracket/tournaments/${t}/categories/${gold}/suggestions`)).data as any[];
  console.log(`   recomendaciones: ${sug1.length}`, sug1.map((s) => `${s.a.name} vs ${s.b.name}${s.swap ? ` → ${s.swap.move.name} ↔ ${s.swap.with.name}` : " (sin cambio posible)"}`).join(" | "));
  const applicable = sug1.find((s) => s.swap);
  if (applicable) {
    await call("POST", `/bracket/tournaments/${t}/categories/${gold}/swap-bracket-players`, {
      user_a: applicable.swap.move.ref,
      user_b: applicable.swap.with.ref,
      confirm: true,
    });
    const sug2 = (await call("GET", `/bracket/tournaments/${t}/categories/${gold}/suggestions`)).data as any[];
    const stillThere = sug2.some((s) => [s.a.ref, s.b.ref].sort().join() === [applicable.a.ref, applicable.b.ref].sort().join());
    check("aplicar la recomendación resuelve ese cruce", !stillThere, `antes ${sug1.length}, después ${sug2.length}`);
  } else {
    console.log("   (no hubo recomendación aplicable en este sorteo)");
  }

  // ── Mover cupos a mano: dos cupos de 2° de grupos sin terminar ──
  matches = await bm();
  const slotRefs: Array<{ ref: string; group: string; rank: number; half: number }> = [];
  for (const m of matches.filter((x: any) => x.round <= 1)) {
    for (const s of [1, 2]) {
      if (!m[`player${s}_id`] && m[`player${s}_source_group`]) {
        slotRefs.push({ ref: `slot:${m[`player${s}_source_group`]}:${m[`player${s}_source_rank`]}`, group: m[`player${s}_source_group`], rank: Number(m[`player${s}_source_rank`]), half: half(m) });
      }
    }
  }
  const s2 = slotRefs.filter((x) => x.rank === 2);
  const pair = s2.find((x) => s2.some((y) => y !== x && y.half === x.half));
  if (pair) {
    const other = s2.find((y) => y !== pair && y.half === pair.half)!;
    const r = await call("POST", `/bracket/tournaments/${t}/categories/${gold}/swap-bracket-players`, { user_a: pair.ref, user_b: other.ref });
    check("cambiar de lugar dos cupos sin llenar (misma mitad)", r.data?.swapped === true, JSON.stringify(r.data));
  } else {
    console.log("   (no hay dos cupos de 2° en la misma mitad)");
  }

  // ── Terminan los grupos que faltaban: los cupos se llenan solos y se arma la Plata ──
  for (const g of ordered.slice(5)) await playGroup(g);
  matches = await bm();
  const empty = matches.filter((m: any) => (m.player1_source_group && !m.player1_id) || (m.player2_source_group && !m.player2_id)).length;
  check("al terminar los grupos, todos los cupos quedan llenos", empty === 0, `${empty} vacíos`);
  const quals = (await q(`SELECT gs.id_user, gs.qualification_label, gs.id_group FROM group_standings gs JOIN category_groups cg ON cg.id_group = gs.id_group WHERE cg.id_category = $1 AND gs.qualified_to_bracket`, [gold])).rows;
  const inGold = (id: string) => matches.some((m: any) => m.player1_id === id || m.player2_id === id);
  check("los 20 clasificados están en la llave", quals.length === 20 && quals.every((x: any) => inGold(x.id_user)));
  const silverPlayers = new Set(
    (await q(`SELECT player1_id, player2_id FROM bracket_matches WHERE id_category = $1`, [silver])).rows.flatMap((r: any) => [r.player1_id, r.player2_id]).filter(Boolean)
  );
  check("la Plata se armó sola con los 10 terceros", silverPlayers.size === 10, `${silverPlayers.size}`);

  // ── Confirmación de la mesa: los recién clasificados entran "por confirmar" ──
  {
    const waiting = (await bm()).filter((m: any) => m.player1_unconfirmed || m.player2_unconfirmed);
    check(
      "al terminar un grupo, sus clasificados quedan por confirmar y su partido no queda listo",
      waiting.length > 0 && waiting.every((m: any) => m.status === "pending"),
      `${waiting.length} partidos en espera`
    );
    const groupsToConfirm = new Set<string>(
      waiting.flatMap((m: any) => [m.player1_unconfirmed ? m.player1_source_group : null, m.player2_unconfirmed ? m.player2_source_group : null]).filter(Boolean)
    );
    for (const g of groupsToConfirm) {
      await call("POST", `/bracket/tournaments/${t}/categories/${gold}/confirm-entry`, { group_id: g });
    }
    const after = await bm();
    const stillWaiting = after.filter((m: any) => m.player1_unconfirmed || m.player2_unconfirmed).length;
    const readyNow = after.filter((m: any) => waiting.some((w: any) => w.id_match === m.id_match) && m.player1_id && m.player2_id);
    check(
      "al confirmar cada grupo, sus partidos con los dos jugadores quedan listos para mesa",
      stillWaiting === 0 && readyNow.every((m: any) => m.status === "ready"),
      `${groupsToConfirm.size} grupos confirmados`
    );
    matches = after;
  }

  // ── Un cruce de club que aparece después (como al llenarse un cupo): la app lo detecta y propone ──
  {
    const clubOf = new Map(
      (await q(`SELECT id_user, id_club FROM users WHERE id_user = ANY($1)`, [players])).rows.map((r: any) => [r.id_user, r.id_club])
    );
    const afterFill = (await call("GET", `/bracket/tournaments/${t}/categories/${gold}/suggestions`)).data as any[];
    console.log(`   recomendaciones al llenarse los cupos: ${afterFill.length}`, afterFill.map((s) => `${s.a.name} vs ${s.b.name}${s.swap ? ` → ${s.swap.move.name} ↔ ${s.swap.with.name}` : " (sin cambio posible)"}`).join(" | "));
    const real = afterFill.find((s) => s.swap);
    if (real) {
      await call("POST", `/bracket/tournaments/${t}/categories/${gold}/swap-bracket-players`, {
        user_a: real.swap.move.ref,
        user_b: real.swap.with.ref,
        confirm: true,
      });
      const after = (await call("GET", `/bracket/tournaments/${t}/categories/${gold}/suggestions`)).data as any[];
      const key = (s: any) => [s.a.ref, s.b.ref].sort().join();
      check(
        "aplicar la recomendación resuelve ese cruce y no crea más cruces",
        !after.some((s) => key(s) === key(real)) && after.length < afterFill.length,
        `antes ${afterFill.length}, después ${after.length}`
      );
      matches = await bm();
    }
    // Puestos al día (los últimos grupos terminaron recién).
    labelOf.clear();
    for (const r of (await q(`SELECT gs.id_user, gs.qualification_label FROM group_standings gs JOIN category_groups cg ON cg.id_group = gs.id_group WHERE cg.id_category = $1`, [gold])).rows) {
      labelOf.set(r.id_user, r.qualification_label);
    }
    const r1 = matches.filter((m: any) => m.round === 1 && m.player1_id && m.player2_id && m.status === "ready");
    let forced = false;
    for (const m of r1) {
      for (const [y, z] of [[m.player1_id, m.player2_id], [m.player2_id, m.player1_id]]) {
        if (clubOf.get(y) !== bigClub || labelOf.get(z) !== "second") continue;
        // Un 2° del club grande, de otro grupo, en la misma mitad, para ponerlo contra y.
        const x = r1
          .filter((o: any) => o !== m && half(o) === half(m))
          .flatMap((o: any) => [o.player1_id, o.player2_id])
          .find((p: string) => clubOf.get(p) === bigClub && labelOf.get(p) === "second" && groupOfUser.get(p) !== groupOfUser.get(y));
        if (!x) continue;
        await call("POST", `/bracket/tournaments/${t}/categories/${gold}/swap-bracket-players`, { user_a: x, user_b: z, confirm: true });
        const sug = (await call("GET", `/bracket/tournaments/${t}/categories/${gold}/suggestions`)).data as any[];
        const mine = sug.find((s) => [s.a.ref, s.b.ref].sort().join() === [x, y].sort().join());
        check("la mesa de control ve el cruce de club nuevo como recomendación", !!mine, mine ? `${mine.a.name} vs ${mine.b.name}` : "");
        if (mine?.swap) {
          await call("POST", `/bracket/tournaments/${t}/categories/${gold}/swap-bracket-players`, {
            user_a: mine.swap.move.ref,
            user_b: mine.swap.with.ref,
            confirm: true,
          });
          const after = (await call("GET", `/bracket/tournaments/${t}/categories/${gold}/suggestions`)).data as any[];
          check("al aplicarla, ese cruce desaparece", !after.some((s) => [s.a.ref, s.b.ref].sort().join() === [x, y].sort().join()));
        } else if (mine) {
          console.log("   (sin cambio posible para ese cruce: lo decide la mesa a mano)");
        }
        forced = true;
        break;
      }
      if (forced) break;
    }
    if (!forced) console.log("   (no se encontró cómo forzar un cruce de club en este sorteo)");
    matches = await bm();
  }

  // ── Cambiar ganador con la llave adelantada (grupo que llenó cupos) ──
  const g = ordered[7];
  const gm = members.filter((m: any) => m.id_group === g).sort((a: any, b: any) => a.seed - b.seed).map((m: any) => m.id_user);
  const slotPos = async (id: string) => {
    const r = (await q(`SELECT id_match, player1_id FROM bracket_matches WHERE id_category = $1 AND round <= 1 AND (player1_id = $2 OR player2_id = $2)`, [gold, id])).rows[0];
    return r ? `${r.id_match}-${r.player1_id === id ? 1 : 2}` : null;
  };
  const before1 = await slotPos(gm[0]);
  const before2 = await slotPos(gm[1]);
  const m12 = (await q(`SELECT id_match FROM group_matches WHERE id_group = $1 AND ((player1_id = $2 AND player2_id = $3) OR (player1_id = $3 AND player2_id = $2))`, [g, gm[0], gm[1]])).rows[0];
  await call("POST", `/bracket/matches/${m12.id_match}/fix-winner`);
  check("llave adelantada: 1°↔2° cambian de cupo", (await slotPos(gm[1])) === before1 && (await slotPos(gm[0])) === before2);
  const m23 = (await q(`SELECT id_match FROM group_matches WHERE id_group = $1 AND ((player1_id = $2 AND player2_id = $3) OR (player1_id = $3 AND player2_id = $2))`, [g, gm[1], gm[2]])).rows[0];
  // gm[1] es ahora el 1°; se da vuelta su partido con el 3°: el 3° pasa a 2°… o se reordena todo. Basta con que la llave siga al grupo.
  await call("POST", `/bracket/matches/${m23.id_match}/fix-winner`);
  const qualsNow = (await q(`SELECT gs.id_user FROM group_standings gs WHERE gs.id_group = $1 AND gs.qualified_to_bracket`, [g])).rows.map((r: any) => r.id_user);
  matches = await bm();
  const goldNow = new Set(matches.flatMap((m: any) => [m.player1_id, m.player2_id]).filter(Boolean));
  const silverNow = new Set(
    (await q(`SELECT player1_id, player2_id FROM bracket_matches WHERE id_category = $1`, [silver])).rows.flatMap((r: any) => [r.player1_id, r.player2_id]).filter(Boolean)
  );
  check(
    "llave adelantada: tras otro cambio, Oro tiene a los clasificados del grupo y nadie está en las dos llaves",
    qualsNow.every((id: string) => goldNow.has(id)) && gm.every((id: string) => !(goldNow.has(id) && silverNow.has(id))),
    `clasificados ${qualsNow.length}`
  );

  console.log(failures === 0 ? "\nTODO OK" : `\n${failures} FALLA(S)`);
  console.log(`http://localhost:5173/admin/tournaments/${t}`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
