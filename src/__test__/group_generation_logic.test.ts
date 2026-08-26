import {
  calculateGroupPlan,
  sortPlayersForGrouping,
  buildSerpentineGroupOrder,
  assignPlayersToGroups,
  generateRoundRobinMatches,
  generateGroupsFromPlayers,
  type CompetitionPlayerInput,
} from "../group_generation_logic";

function player(id: string, overrides: Partial<CompetitionPlayerInput> = {}): CompetitionPlayerInput {
  return {
    id_user: id,
    ranking_points: null,
    ranking_position: null,
    seed_number: null,
    club_name: null,
    qualification_type: "group",
    ...overrides,
  };
}

describe("calculateGroupPlan", () => {
  it("rechaza menos de 2 jugadores", () => {
    expect(() => calculateGroupPlan(1)).toThrow();
  });

  it("casos mínimos", () => {
    expect(calculateGroupPlan(2)).toEqual([2]);
    expect(calculateGroupPlan(3)).toEqual([3]);
    expect(calculateGroupPlan(4)).toEqual([4]);
  });

  it("sin resto -> todos de 3", () => {
    expect(calculateGroupPlan(6)).toEqual([3, 3]);
    expect(calculateGroupPlan(12)).toEqual([3, 3, 3, 3]);
  });

  it("resto 1 -> el ÚLTIMO grupo pasa a 4", () => {
    expect(calculateGroupPlan(10)).toEqual([3, 3, 4]);
  });

  it("resto 2 -> los ÚLTIMOS DOS grupos pasan a 4", () => {
    expect(calculateGroupPlan(11)).toEqual([3, 4, 4]);
  });

  it("resto 2 con un solo grupo base (5 jugadores) -> grupo nuevo de 2, no hay 'últimos dos' para agrandar", () => {
    expect(calculateGroupPlan(5)).toEqual([3, 2]);
  });
});

describe("sortPlayersForGrouping", () => {
  it("ordena por ranking_points desc, luego ranking_position asc, luego seed asc, luego id_user", () => {
    const players = [
      player("b", { ranking_points: 100 }),
      player("a", { ranking_points: 200 }),
      player("c", { ranking_points: 200, ranking_position: 1 }),
    ];
    const sorted = sortPlayersForGrouping(players);
    expect(sorted.map((p) => p.id_user)).toEqual(["c", "a", "b"]);
  });

  it("deja los null al final de cada criterio", () => {
    const players = [
      player("a", { ranking_points: null }),
      player("b", { ranking_points: 50 }),
    ];
    const sorted = sortPlayersForGrouping(players);
    expect(sorted.map((p) => p.id_user)).toEqual(["b", "a"]);
  });
});

describe("buildSerpentineGroupOrder", () => {
  it("hace zigzag entre los grupos", () => {
    expect(buildSerpentineGroupOrder(4, 10)).toEqual([0, 1, 2, 3, 3, 2, 1, 0, 0, 1]);
  });
});

describe("assignPlayersToGroups", () => {
  it("respeta el tamaño objetivo de cada grupo", () => {
    const players = Array.from({ length: 10 }, (_, i) => player(`p${i}`));
    const plan = calculateGroupPlan(players.length);
    const buckets = assignPlayersToGroups(players, plan);
    expect(buckets.map((b) => b.players.length)).toEqual(plan);
  });

  it("evita juntar jugadores del mismo club cuando es posible", () => {
    const players = [
      player("p1", { club_name: "Club A" }),
      player("p2", { club_name: "Club A" }),
      player("p3", { club_name: "Club B" }),
      player("p4", { club_name: "Club B" }),
      player("p5", { club_name: null }),
      player("p6", { club_name: null }),
    ];
    const plan = calculateGroupPlan(players.length); // [3, 3]
    const buckets = assignPlayersToGroups(players, plan);

    for (const group of buckets) {
      const clubs = group.players.map((p) => p.club_name).filter(Boolean);
      expect(new Set(clubs).size).toBe(clubs.length);
    }
  });
});

describe("generateRoundRobinMatches", () => {
  it("genera el número correcto de partidos por tamaño de grupo", () => {
    const sizes: Array<[2 | 3 | 4, number]> = [[2, 1], [3, 3], [4, 6]];
    for (const [size, expectedMatches] of sizes) {
      const bucket = {
        temp_group_id: "g1",
        group_name: "A",
        target_size: size,
        sort_order: 1,
        status: "draft" as const,
        group_kind: "normal" as const,
        players: Array.from({ length: size }, (_, i) => player(`p${i}`)),
      };
      const matches = generateRoundRobinMatches(bucket, 0, 3);
      expect(matches).toHaveLength(expectedMatches);
    }
  });
});

describe("generateGroupsFromPlayers", () => {
  it("rechaza menos de 2 jugadores", () => {
    expect(() => generateGroupsFromPlayers([player("a")])).toThrow();
  });

  it("arma grupos, standings en cero y partidos todos-contra-todos", () => {
    const players = Array.from({ length: 7 }, (_, i) =>
      player(`p${i}`, { ranking_points: 100 - i })
    );
    const result = generateGroupsFromPlayers(players);

    expect(result.groups.map((g) => g.target_size)).toEqual([3, 4]);
    expect(result.members).toHaveLength(7);
    expect(result.standings.every((s) => s.played === 0 && !s.qualified_to_bracket)).toBe(true);

    const matchesByGroup = new Map<string, number>();
    for (const m of result.matches) {
      matchesByGroup.set(m.temp_group_id, (matchesByGroup.get(m.temp_group_id) ?? 0) + 1);
    }
    expect(matchesByGroup.get("group_1")).toBe(3); // grupo de 3
    expect(matchesByGroup.get("group_2")).toBe(6); // grupo de 4
  });
});
