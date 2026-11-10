/**
 * Reglas del sorteo de la llave después de grupos (ITTF Handbook for
 * Tournament Referees 3.7.2) y del armado de grupos, probadas sobre muchos
 * sorteos al azar. Nacieron del INTERCLUBES RyF (8-nov-2026): 66
 * clasificados, llave de 64 con pre-llave, y salieron revanchas de grupo y
 * cruces del mismo club porque la pre-llave rearmaba el cuadro con otro orden.
 */
import {
  drawBracketSlotsForGroups,
  buildBracketForSize,
  bracketSizeOptions,
  type GroupSeededEntry,
  type DrawnSlot,
  type GeneratedBracketResult,
} from "../bracket_generation_logic";
import { assignPlayersToGroups, calculateGroupPlanPreferFours, calculateGroupPlan } from "../group_generation_logic";

type Entry = GroupSeededEntry;

function qualifiers(groups: number, clubs: string[] | null, rnd: () => number): Entry[] {
  const out: Entry[] = [];
  for (let rank = 1; rank <= 2; rank++) {
    for (let g = 1; g <= groups; g++) {
      out.push({
        id: `G${g}-${rank}`,
        groupName: `GR-${g}`,
        rankInGroup: rank as 1 | 2,
        clubId: clubs ? clubs[Math.floor(rnd() * clubs.length)] : null,
      });
    }
  }
  return out;
}

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function build(entries: Entry[], size: number): GeneratedBracketResult {
  const drawn = drawBracketSlotsForGroups(entries)
    .filter((d): d is DrawnSlot => d.player !== null)
    .sort((a, b) => a.seed - b.seed);
  return buildBracketForSize(drawn, size);
}

/** Mitad (0 arriba, 1 abajo) de la llave oficial en la que entra cada jugador. */
function halfOf(b: GeneratedBracketResult): Map<string, number> {
  const half = new Map<string, number>();
  const r1Matches = b.bracket_size / 2;
  const h = (matchNumber: number) => (matchNumber <= r1Matches / 2 ? 0 : 1);
  for (const m of b.matches) {
    if (m.round === 0) {
      for (const p of [m.player1_id, m.player2_id]) if (p) half.set(p, h(m.next_match_number!));
    }
    if (m.round === 1) {
      for (const p of [m.player1_id, m.player2_id]) if (p && !half.has(p)) half.set(p, h(m.match_number));
    }
  }
  return half;
}

/** Primer partido de cada jugador: [jugador, rival] (con pre-llave, el ganador de la pre-llave cuenta como rivales posibles). */
function firstMeetings(b: GeneratedBracketResult): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  const pre = b.matches.filter((m) => m.round === 0);
  for (const m of pre) pairs.push([m.player1_id!, m.player2_id!]);
  for (const m of b.matches.filter((x) => x.round === 1)) {
    const side = (slot: 1 | 2) => {
      const p = slot === 1 ? m.player1_id : m.player2_id;
      if (p) return { players: [p], direct: true };
      const f = pre.find((x) => x.next_match_number === m.match_number && x.next_match_slot === slot);
      return { players: f ? [f.player1_id!, f.player2_id!] : [], direct: false };
    };
    const a = side(1);
    const c = side(2);
    if (!a.direct && !c.direct) continue;
    for (const x of a.players) for (const y of c.players) pairs.push([x, y]);
  }
  return pairs;
}

describe("Sorteo de la llave después de grupos", () => {
  it("el 2° nunca queda en la misma mitad que el 1° de su grupo (con y sin pre-llave)", () => {
    const rnd = seeded(1);
    for (let groups = 2; groups <= 40; groups++) {
      for (const size of bracketSizeOptions(groups * 2)) {
        for (let t = 0; t < 15; t++) {
          const b = build(qualifiers(groups, null, rnd), size);
          const half = halfOf(b);
          for (let g = 1; g <= groups; g++) {
            expect([groups, size, g, half.get(`G${g}-1`) !== half.get(`G${g}-2`)]).toEqual([groups, size, g, true]);
          }
        }
      }
    }
  });

  it("todos entran una sola vez y la pre-llave tiene n − llave partidos", () => {
    for (let groups = 2; groups <= 40; groups++) {
      const n = groups * 2;
      for (const size of bracketSizeOptions(n)) {
        const b = build(qualifiers(groups, null, Math.random), size);
        const pre = b.matches.filter((m) => m.round === 0);
        const firstRound = b.matches.filter((m) => m.round === 1);
        const seen = [
          ...pre.flatMap((m) => [m.player1_id, m.player2_id]),
          ...firstRound.flatMap((m) => [m.player1_id, m.player2_id]),
        ].filter((p): p is string => !!p);
        expect(new Set(seen).size).toBe(n);
        expect(seen.length).toBe(n);
        expect(pre.length).toBe(size < n ? n - size : 0);
        expect(b.bracket_size).toBe(size);
      }
    }
  });

  it("INTERCLUBES (66 clasificados, llave de 64): sin revanchas y sin club repetido en el primer partido", () => {
    const clubs = ["SM", "SM", "SM", "SpinMaipu", "ACTM", "Penalolen", "Macul", "Nusibell", "Santiago", "Halcones", "MatchPoint", "Paleta"];
    const rnd = seeded(8);
    for (let t = 0; t < 30; t++) {
      const entries = qualifiers(33, clubs, rnd);
      const club = new Map(entries.map((e) => [e.id, e.clubId]));
      const b = build(entries, 64);
      expect(b.matches.filter((m) => m.round === 0)).toHaveLength(2);
      const meetings = firstMeetings(b);
      const sameGroup = meetings.filter(([x, y]) => x.split("-")[0] === y.split("-")[0]);
      expect(sameGroup).toEqual([]);
      const sameClub = meetings.filter(([x, y]) => club.get(x) === club.get(y));
      expect(sameClub).toEqual([]);
    }
  });

  it("los BYE van a los mejores 1° de grupo, en orden (GR-1, GR-2, …)", () => {
    for (let groups = 17; groups <= 31; groups++) {
      const n = groups * 2;
      const size = 64;
      const byes = size - n;
      if (byes <= 0 || byes > groups) continue;
      for (let t = 0; t < 20; t++) {
        const b = build(qualifiers(groups, null, Math.random), size);
        const withBye = b.matches.filter((m) => m.round === 1 && m.is_bye).map((m) => m.winner_id).sort();
        const expected = Array.from({ length: byes }, (_, i) => `G${i + 1}-1`).sort();
        expect([groups, withBye]).toEqual([groups, expected]);
      }
    }
  });

  it("con 33 ganadores, el 1° de grupo que sobra no queda siempre contra el semilla 1", () => {
    const opponents = new Set<string>();
    for (let t = 0; t < 40; t++) {
      const b = build(qualifiers(33, null, Math.random), 64);
      const m = b.matches.find((x) => x.round === 1 && (x.player1_id === "G1-1" || x.player2_id === "G1-1"))!;
      opponents.add(String(m.player1_id === "G1-1" ? m.player2_id : m.player1_id));
    }
    expect(opponents.has("G33-1") && opponents.size === 1).toBe(false);
  });
});

describe("Armado de grupos por filas", () => {
  const p = (i: number, club: string | null) => ({
    id_user: `J${String(i).padStart(3, "0")}`,
    ranking_points: 1000 - i,
    ranking_position: i,
    seed_number: null,
    club_name: club,
    qualification_type: "group" as const,
  });

  it("cada grupo recibe exactamente un jugador de cada fila", () => {
    const rnd = seeded(3);
    const clubs = ["A", "A", "A", "B", "C", "D", "E", "F", "G", "H"];
    for (const n of [12, 17, 23, 40, 66, 101, 132]) {
      for (const plan of [calculateGroupPlanPreferFours(n), calculateGroupPlan(n)]) {
        const players = Array.from({ length: n }, (_, i) => p(i + 1, clubs[Math.floor(rnd() * clubs.length)]));
        const groups = assignPlayersToGroups(players, plan);
        expect(groups.map((g) => g.players.length)).toEqual(plan);
        for (let row = 0; row < 4; row++) {
          const eligible = groups.filter((g) => g.target_size > row).length;
          const start = plan.reduce((acc, _s, k) => acc, 0);
          const rowStart = Array.from({ length: row }, (_, r) => groups.filter((g) => g.target_size > r).length).reduce((a, c) => a + c, start);
          const rowIds = new Set(players.slice(rowStart, rowStart + eligible).map((x) => x.id_user));
          for (const g of groups.filter((x) => x.target_size > row)) {
            expect(g.players.filter((x) => rowIds.has(x.id_user))).toHaveLength(1);
          }
        }
      }
    }
  });

  it("el mejor de cada fila 1 encabeza su grupo: GR-1 tiene al 1, GR-2 al 2…", () => {
    const players = Array.from({ length: 132 }, (_, i) => p(i + 1, i % 4 === 0 ? "SM" : `C${i % 7}`));
    const groups = assignPlayersToGroups(players, calculateGroupPlanPreferFours(132));
    groups.forEach((g, i) => expect(g.players[0].id_user).toBe(`J${String(i + 1).padStart(3, "0")}`));
  });

  it("separa clubes cuando se puede (sin sacar a nadie de su fila)", () => {
    const rnd = seeded(5);
    for (let t = 0; t < 20; t++) {
      // 132 jugadores, 33 grupos; ningún club con más de 33: todo separable.
      const players = Array.from({ length: 132 }, (_, i) => p(i + 1, `C${Math.floor(rnd() * 6)}`));
      const counts = new Map<string, number>();
      players.forEach((x) => counts.set(x.club_name!, (counts.get(x.club_name!) ?? 0) + 1));
      if ([...counts.values()].some((c) => c > 33)) continue;
      const groups = assignPlayersToGroups(players, calculateGroupPlanPreferFours(132));
      const repeated = groups.filter((g) => new Set(g.players.map((x) => x.club_name)).size < g.players.length);
      expect(repeated.length).toBeLessThanOrEqual(1);
    }
  });
});
