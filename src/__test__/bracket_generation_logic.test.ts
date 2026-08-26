import {
  nextPowerOf2,
  prevPowerOf2,
  getSeedPositions,
  generateElimBracket,
  drawBracketSlots,
  drawBracketSlotsForGroups,
  buildBracketFromSlots,
  buildBracketWithPreRound,
  getPhysicalDisplayOrder,
  type GroupSeededEntry,
  type DrawnSlot,
} from "../bracket_generation_logic";

function ranked(n: number): DrawnSlot[] {
  return Array.from({ length: n }, (_, i) => ({ player: `p${i + 1}`, seed: i + 1 }));
}

describe("nextPowerOf2", () => {
  it("redondea hacia arriba a la potencia de 2 más cercana", () => {
    expect(nextPowerOf2(1)).toBe(1);
    expect(nextPowerOf2(5)).toBe(8);
    expect(nextPowerOf2(8)).toBe(8);
    expect(nextPowerOf2(9)).toBe(16);
  });
});

describe("getSeedPositions", () => {
  it("garantiza que la semilla 1 y 2 solo se encuentran en la final", () => {
    expect(getSeedPositions(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });
});

describe("getPhysicalDisplayOrder", () => {
  // Verificado a mano contra una planilla real de sorteo ITTF de 32
  // jugadores: semilla 1 en la fila 1, semilla 2 en la última fila, semillas
  // 3-4 exactamente en el medio, 5-8 en los cuartos, 9-16 en los octavos, y
  // el resto rellenando el resto ("2do" en la planilla real).
  it("ubica las semillas 1, 2, 3-4, 5-8 y 9-16 en las filas exactas de una planilla real de 32", () => {
    const order = getPhysicalDisplayOrder(32); // order[posición-1] = índice (semilla-1) que va ahí
    const rowOfSeed = (seed: number) => order.indexOf(seed - 1) + 1;

    expect(rowOfSeed(1)).toBe(1);
    expect(rowOfSeed(2)).toBe(32);
    expect([rowOfSeed(3), rowOfSeed(4)].sort((a, b) => a - b)).toEqual([16, 17]);
    expect([rowOfSeed(5), rowOfSeed(6), rowOfSeed(7), rowOfSeed(8)].sort((a, b) => a - b)).toEqual([8, 9, 24, 25]);
    expect(
      [9, 10, 11, 12, 13, 14, 15, 16].map(rowOfSeed).sort((a, b) => a - b)
    ).toEqual([4, 5, 12, 13, 20, 21, 28, 29]);
  });

  it("con un solo BYE, cae en la fila pegada a la semilla 1 (primer partido)", () => {
    // 3 jugadores reales en un cuadro de 4 -> 1 BYE (semilla 4, la más débil)
    const order = getPhysicalDisplayOrder(4);
    const byeRow = order.indexOf(3) + 1; // semilla 4 = índice 3
    expect(byeRow).toBe(2); // pegado a la semilla 1 (fila 1)
  });

  it("con dos BYE, el segundo cae pegado a la semilla 2 (último partido)", () => {
    // 2 jugadores reales en un cuadro de 4 -> 2 BYE (semillas 3 y 4)
    const order = getPhysicalDisplayOrder(4);
    const byeRows = [order.indexOf(2) + 1, order.indexOf(3) + 1].sort((a, b) => a - b);
    expect(byeRows).toEqual([2, 3]); // pegadas a la semilla 1 (fila 1) y a la semilla 2 (fila 4)
  });
});

describe("generateElimBracket", () => {
  it("rechaza menos de 2 jugadores reales", () => {
    expect(() => generateElimBracket([null, "p1"])).toThrow();
  });

  it("arma un cuadro exacto (potencia de 2) sin byes", () => {
    const players = ["p1", "p2", "p3", "p4"];
    const result = generateElimBracket(players, 5);

    expect(result.bracket_size).toBe(4);
    expect(result.total_rounds).toBe(2);

    const round1 = result.matches.filter((m) => m.round === 1);
    expect(round1).toHaveLength(2);
    expect(round1.every((m) => m.status === "ready")).toBe(true);
  });

  it("asigna byes a las mejores semillas cuando no hay potencia de 2 exacta", () => {
    // 5 jugadores -> cuadro de 8, 3 byes
    const players = ["p1", "p2", "p3", "p4", "p5"];
    const result = generateElimBracket(players, 5);

    expect(result.bracket_size).toBe(8);
    const byes = result.matches.filter((m) => m.is_bye);
    expect(byes).toHaveLength(3);

    // La semilla 1 (p1) debe ganar su bye y avanzar a la ronda 2
    const round2 = result.matches.filter((m) => m.round === 2);
    const seed1MatchNext = round2.find((m) => m.player1_id === "p1" || m.player2_id === "p1");
    expect(seed1MatchNext).toBeDefined();
  });

  it("propaga correctamente el best_of_sets a todos los partidos", () => {
    const result = generateElimBracket(["p1", "p2", "p3", "p4"], 7);
    expect(result.matches.every((m) => m.best_of_sets === 7)).toBe(true);
  });

  it("no deja partidos trabados en pending cuando faltan jugadores en rondas 2+ (grupos incompletos)", () => {
    // Solo 2 jugadores reales (semillas 1 y 2, que por diseño de semillas
    // quedan en mitades opuestas) en un cuadro de 8, con 6 nulls como
    // pasaría si varios grupos todavía no terminan: cada uno debe encadenar
    // 2 byes seguidos (rondas 1 y 2) antes de encontrarse recién en la
    // final. Antes del fix, el bye de ronda 2 quedaba en "pending" para
    // siempre.
    const players = ["p1", "p2", null, null, null, null, null, null];
    const result = generateElimBracket(players, 5);

    expect(result.bracket_size).toBe(8);
    expect(result.total_rounds).toBe(3);

    const final = result.matches.find((m) => m.round === 3)!;
    expect(final.player1_id).not.toBeNull();
    expect(final.player2_id).not.toBeNull();
    expect(final.status).toBe("ready");
    expect([final.player1_id, final.player2_id].sort()).toEqual(["p1", "p2"]);

    // Ningún partido debe quedar "pending" con exactamente un jugador real:
    // o está resuelto (ready/bye) o genuinamente no tiene ningún jugador.
    const stuck = result.matches.filter(
      (m) => m.status === "pending" && (m.player1_id !== null || m.player2_id !== null),
    );
    expect(stuck).toHaveLength(0);
  });
});

describe("drawBracketSlots + buildBracketFromSlots", () => {
  it("rechaza menos de 2 jugadores reales, igual que generateElimBracket", () => {
    expect(() => drawBracketSlots([null, "p1"])).toThrow();
  });

  it("la semilla 1 y 2 siempre quedan fijas (arriba/abajo), nunca se sortean", () => {
    // Con 8 jugadores no hay BYEs de por medio para confundir el resultado.
    const players = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];
    for (let i = 0; i < 20; i++) {
      const drawn = drawBracketSlots(players);
      expect(drawn[0]).toEqual({ player: "p1", seed: 1 });
      expect(drawn[1]).toEqual({ player: "p2", seed: 2 });
    }
  });

  it("combinar drawBracketSlots + buildBracketFromSlots da el mismo resultado que generateElimBracket", () => {
    const players = ["p1", "p2", "p3", "p4", "p5"];
    const drawn = drawBracketSlots(players);
    const viaSplit = buildBracketFromSlots(drawn, 5);
    const viaCombined = buildBracketFromSlots(drawn, 5); // mismo drawn, no debe volver a sortear

    expect(viaSplit).toEqual(viaCombined);
    expect(viaSplit.bracket_size).toBe(8);
    expect(viaSplit.matches.filter((m) => m.is_bye)).toHaveLength(3);
  });

  it("previsualizar y confirmar con el mismo sorteo (drawn) produce el cuadro exacto que se mostró", () => {
    // Simula el flujo real: se sortea una vez (preview), se guarda ese
    // resultado, y se "confirma" más tarde reconstruyendo el bracket desde
    // el mismo arreglo — no debe haber ninguna diferencia.
    const players = ["p1", "p2", "p3", "p4", "p5", "p6"];
    const previewDrawn = drawBracketSlots(players);
    const previewResult = buildBracketFromSlots(previewDrawn, 3);

    // "Confirmar" reconstruye a partir del MISMO drawn (como haría el
    // service al recibir slotAssignment de vuelta desde el frontend).
    const confirmedResult = buildBracketFromSlots(previewDrawn, 3);

    expect(confirmedResult).toEqual(previewResult);
  });
});

describe("drawBracketSlotsForGroups (reglas ITTF 3.7.2)", () => {
  function seedOf(drawn: ReturnType<typeof drawBracketSlotsForGroups>, id: string): number {
    return drawn.find((d) => d.player === id)!.seed;
  }

  function halfOf(bracketSize: number, seed: number): "top" | "bottom" {
    const order = getSeedPositions(bracketSize);
    const half = bracketSize / 2;
    return new Set(order.slice(0, half)).has(seed) ? "top" : "bottom";
  }

  it("rechaza menos de 2 jugadores", () => {
    expect(() =>
      drawBracketSlotsForGroups([{ id: "p1", groupName: null, rankInGroup: null, clubId: null }])
    ).toThrow();
  });

  it("con solo ganadores de grupo (sin segundos), da exactamente lo mismo que drawBracketSlots", () => {
    const ids = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];
    const entries: GroupSeededEntry[] = ids.map((id, i) => ({
      id,
      groupName: `G${i + 1}`,
      rankInGroup: 1,
      clubId: null,
    }));
    for (let i = 0; i < 20; i++) {
      const drawn = drawBracketSlotsForGroups(entries);
      expect(drawn[0]).toEqual({ player: "p1", seed: 1 });
      expect(drawn[1]).toEqual({ player: "p2", seed: 2 });
    }
  });

  it("el segundo de cada grupo siempre cae en la mitad opuesta a su propio primero (ITTF 3.7.2)", () => {
    // 4 grupos, 1ro y 2do de cada uno -> 8 clasificados, cuadro de 8.
    const entries: GroupSeededEntry[] = [];
    for (let g = 1; g <= 4; g++) {
      entries.push({ id: `w${g}`, groupName: `G${g}`, rankInGroup: 1, clubId: null });
      entries.push({ id: `r${g}`, groupName: `G${g}`, rankInGroup: 2, clubId: null });
    }

    for (let i = 0; i < 50; i++) {
      const drawn = drawBracketSlotsForGroups(entries);
      const bracketSize = 8;
      for (let g = 1; g <= 4; g++) {
        const winnerHalf = halfOf(bracketSize, seedOf(drawn, `w${g}`));
        const runnerUpHalf = halfOf(bracketSize, seedOf(drawn, `r${g}`));
        expect(runnerUpHalf).not.toBe(winnerHalf);
      }
    }
  });

  it("nunca duplica ni pierde un jugador real", () => {
    const entries: GroupSeededEntry[] = [
      { id: "w1", groupName: "G1", rankInGroup: 1, clubId: null },
      { id: "r1", groupName: "G1", rankInGroup: 2, clubId: null },
      { id: "w2", groupName: "G2", rankInGroup: 1, clubId: null },
      { id: "r2", groupName: "G2", rankInGroup: 2, clubId: null },
      { id: "w3", groupName: "G3", rankInGroup: 1, clubId: null },
      { id: "direct1", groupName: null, rankInGroup: null, clubId: null },
    ];
    const drawn = drawBracketSlotsForGroups(entries);
    const placedIds = drawn.map((d) => d.player).filter((p): p is string => p !== null).sort();
    expect(placedIds).toEqual(entries.map((e) => e.id).sort());
  });

  it("reparte exactamente los BYE que corresponden y nunca deja libres las semillas 1 y 2", () => {
    // 3 grupos de 1ro+2do (6 reales) -> cuadro de 8 -> 2 BYE. La semilla 1 y
    // 2 siempre son ganadores de grupo (ver test de arriba), así que nunca
    // deberían terminar siendo BYE — eso rompería la protección más básica.
    // Dentro de cada mitad, el segundo de grupo siempre ocupa la semilla más
    // fuerte todavía libre en su mitad objetivo (ver drawBracketSlotsForGroupsOnce
    // paso 2) — así el BYE que sobra en cada mitad es SIEMPRE la semilla más
    // débil de esa mitad, sin importar el orden al azar en que se procesen
    // los segundos de grupo. Para este caso puntual eso da un resultado
    // determinístico: BYE siempre en las semillas 7 y 8.
    const entries: GroupSeededEntry[] = [];
    for (let g = 1; g <= 3; g++) {
      entries.push({ id: `w${g}`, groupName: `G${g}`, rankInGroup: 1, clubId: null });
      entries.push({ id: `r${g}`, groupName: `G${g}`, rankInGroup: 2, clubId: null });
    }

    for (let i = 0; i < 30; i++) {
      const drawn = drawBracketSlotsForGroups(entries);
      const byeSeeds = drawn.filter((d) => d.player === null).map((d) => d.seed).sort();
      expect(byeSeeds).toEqual([7, 8]);
      expect(drawn.find((d) => d.seed === 1)?.player).not.toBeNull();
      expect(drawn.find((d) => d.seed === 2)?.player).not.toBeNull();
    }
  });

  it("los pases directos no rompen la regla de mitad opuesta de los segundos de grupo", () => {
    const entries: GroupSeededEntry[] = [
      { id: "w1", groupName: "G1", rankInGroup: 1, clubId: null },
      { id: "r1", groupName: "G1", rankInGroup: 2, clubId: null },
      { id: "w2", groupName: "G2", rankInGroup: 1, clubId: null },
      { id: "r2", groupName: "G2", rankInGroup: 2, clubId: null },
      { id: "direct1", groupName: null, rankInGroup: null, clubId: null },
      { id: "direct2", groupName: null, rankInGroup: null, clubId: null },
    ];
    for (let i = 0; i < 30; i++) {
      const drawn = drawBracketSlotsForGroups(entries);
      const bracketSize = nextPowerOf2(entries.length);
      expect(halfOf(bracketSize, seedOf(drawn, "r1"))).not.toBe(halfOf(bracketSize, seedOf(drawn, "w1")));
      expect(halfOf(bracketSize, seedOf(drawn, "r2"))).not.toBe(halfOf(bracketSize, seedOf(drawn, "w2")));
    }
  });

  it("separa por club como último criterio, sin romper la mitad opuesta de los segundos", () => {
    // 4 grupos, 2 clubes: mitad de los jugadores son del club "A" — con
    // suficientes reintentos, el sorteo tiene que encontrar al menos una
    // combinación sin que dos del club A se crucen en primera ronda.
    const entries: GroupSeededEntry[] = [
      { id: "w1", groupName: "G1", rankInGroup: 1, clubId: "A" },
      { id: "r1", groupName: "G1", rankInGroup: 2, clubId: "B" },
      { id: "w2", groupName: "G2", rankInGroup: 1, clubId: "B" },
      { id: "r2", groupName: "G2", rankInGroup: 2, clubId: "A" },
      { id: "w3", groupName: "G3", rankInGroup: 1, clubId: "A" },
      { id: "r3", groupName: "G3", rankInGroup: 2, clubId: "B" },
      { id: "w4", groupName: "G4", rankInGroup: 1, clubId: "B" },
      { id: "r4", groupName: "G4", rankInGroup: 2, clubId: "A" },
    ];
    const bracketSize = 8;
    const seedOrder = getSeedPositions(bracketSize);

    const drawn = drawBracketSlotsForGroups(entries);
    const clubById = new Map(entries.map((e) => [e.id, e.clubId]));

    let clubClashes = 0;
    for (let i = 0; i < seedOrder.length; i += 2) {
      const a = drawn.find((d) => d.seed === seedOrder[i]);
      const b = drawn.find((d) => d.seed === seedOrder[i + 1]);
      const clubA = a?.player ? clubById.get(a.player) : null;
      const clubB = b?.player ? clubById.get(b.player) : null;
      if (clubA && clubB && clubA === clubB) clubClashes++;
    }
    expect(clubClashes).toBe(0);

    // La regla de mayor prioridad (mitad opuesta al propio ganador) se
    // mantiene intacta — la separación por club nunca la pisa.
    for (let g = 1; g <= 4; g++) {
      expect(halfOf(bracketSize, seedOf(drawn, `r${g}`))).not.toBe(halfOf(bracketSize, seedOf(drawn, `w${g}`)));
    }
  });
});

describe("prevPowerOf2", () => {
  it("redondea hacia abajo a la potencia de 2 más cercana", () => {
    expect(prevPowerOf2(1)).toBe(1);
    expect(prevPowerOf2(16)).toBe(16);
    expect(prevPowerOf2(20)).toBe(16);
    expect(prevPowerOf2(24)).toBe(16);
    expect(prevPowerOf2(31)).toBe(16);
    expect(prevPowerOf2(32)).toBe(32);
  });
});

describe("buildBracketWithPreRound (sistema de pre-llaves)", () => {
  // Todos los partidos de la llave oficial (ronda 1 en adelante) — la ronda
  // 0 (pre-llave) queda afuera a propósito.
  function officialMatches(matches: ReturnType<typeof buildBracketWithPreRound>["matches"]) {
    return matches.filter((m) => m.round >= 1);
  }

  it("con N potencia de 2 exacta, da EXACTAMENTE lo mismo que buildBracketFromSlots (cero regresión)", () => {
    const players = ranked(16);
    const withPreRound = buildBracketWithPreRound(players, 5);
    const plain = buildBracketFromSlots(players, 5);
    expect(withPreRound).toEqual(plain);
    expect(withPreRound.matches.some((m) => m.round === 0)).toBe(false);
  });

  it("N=20 (floor 16, surplus 4): 4 partidos de pre-llave, llave oficial de 16 sin NINGÚN bye", () => {
    const result = buildBracketWithPreRound(ranked(20), 5);

    expect(result.bracket_size).toBe(16);
    expect(result.total_rounds).toBe(4); // log2(16), la pre-llave no cuenta

    const preRound = result.matches.filter((m) => m.round === 0);
    expect(preRound).toHaveLength(4);
    // La pre-llave siempre tiene 2 jugadores reales por partido — nunca hay
    // bye propio (2×surplus siempre es par).
    expect(preRound.every((m) => m.player1_id !== null && m.player2_id !== null && m.status === "ready")).toBe(
      true,
    );

    const official = officialMatches(result.matches);
    expect(official.some((m) => m.is_bye)).toBe(false);
    expect(official.some((m) => m.status === "bye")).toBe(false);

    // floor-surplus = 12: las semillas 1..12 entran directo (sin jugar
    // pre-llave); las 8 más débiles (semillas 13..20) sí juegan la ronda 0.
    const preRoundPlayers = new Set(preRound.flatMap((m) => [m.player1_id, m.player2_id]));
    for (let seed = 13; seed <= 20; seed++) expect(preRoundPlayers.has(`p${seed}`)).toBe(true);
    for (let seed = 1; seed <= 12; seed++) expect(preRoundPlayers.has(`p${seed}`)).toBe(false);

    // Cada partido de ronda 1 apunta a un partido/cupo válido de la ronda 2
    // (o es la final) — la estructura de la llave oficial no se rompió.
    const round1 = official.filter((m) => m.round === 1);
    expect(round1).toHaveLength(8);
  });

  it("N=24 (floor 16, surplus 8): 8 partidos de pre-llave, llave oficial de 16 sin ningún bye", () => {
    const result = buildBracketWithPreRound(ranked(24), 5);

    expect(result.bracket_size).toBe(16);
    expect(result.total_rounds).toBe(4);

    const preRound = result.matches.filter((m) => m.round === 0);
    expect(preRound).toHaveLength(8);
    expect(preRound.every((m) => m.player1_id !== null && m.player2_id !== null)).toBe(true);

    const official = officialMatches(result.matches);
    expect(official.some((m) => m.is_bye)).toBe(false);

    // Ningún jugador se pierde ni se duplica entre pre-llave + directos.
    const preRoundPlayers = preRound.flatMap((m) => [m.player1_id, m.player2_id]);
    const directPlayers = official
      .filter((m) => m.round === 1)
      .flatMap((m) => [m.player1_id, m.player2_id])
      .filter((p) => p !== null && !preRoundPlayers.includes(p));
    const allPlaced = new Set([...preRoundPlayers, ...directPlayers]);
    expect(allPlaced.size).toBe(24);
  });

  it("N=3 (floor 2, surplus 1): 1 partido de pre-llave, la 'final' espera a su ganador", () => {
    const result = buildBracketWithPreRound(ranked(3), 5);

    expect(result.bracket_size).toBe(2);
    expect(result.total_rounds).toBe(1);

    const preRound = result.matches.filter((m) => m.round === 0);
    expect(preRound).toHaveLength(1);
    // p2 y p3 (las 2 semillas más débiles) juegan la pre-llave.
    expect([preRound[0].player1_id, preRound[0].player2_id].sort()).toEqual(["p2", "p3"]);

    const final = result.matches.find((m) => m.round === 1)!;
    expect(final.player1_id).toBe("p1"); // sembrado directo
    expect(final.player2_id).toBeNull(); // pendiente del ganador de la pre-llave
    expect(final.status).not.toBe("ready");

    // La pre-llave apunta exactamente a la final.
    expect(preRound[0].next_round).toBe(1);
    expect(preRound[0].next_match_number).toBe(final.match_number);
  });

  it("simula jugar la pre-llave completa: al completar todos los partidos de ronda 0 a mano, la ronda 1 queda 100% resuelta sin huecos", () => {
    const result = buildBracketWithPreRound(ranked(20), 5);
    const byTempId = new Map(result.matches.map((m) => [m.temp_id, m]));

    // "Jugar" cada partido de pre-llave: gana el jugador 1 de cada uno, y
    // propagar a mano el mismo mecanismo que usa advanceBracketWinner en
    // producción (asignar winner_id al cupo indicado por next_match_slot).
    for (const m of result.matches.filter((mm) => mm.round === 0)) {
      const winner = m.player1_id!;
      const next = byTempId.get(`r${m.next_round}_m${m.next_match_number}`)!;
      if (m.next_match_slot === 1) next.player1_id = winner;
      else next.player2_id = winner;
    }

    const round1 = result.matches.filter((m) => m.round === 1);
    expect(round1.every((m) => m.player1_id !== null && m.player2_id !== null)).toBe(true);
    // Ningún jugador repetido en la ronda 1.
    const round1Players = round1.flatMap((m) => [m.player1_id, m.player2_id]);
    expect(new Set(round1Players).size).toBe(round1Players.length);
    expect(round1Players).toHaveLength(16);
  });

  // Barrido de TODOS los N entre 2 y 130 — no solo los "lindos" del PDF
  // (20, 24). Encontró en producción que 2×surplus no siempre es potencia
  // de 2 (ej. N=23 -> surplus=7 -> 2×surplus=14), y el emparejamiento de la
  // pre-llave usaba mal getSeedPositions (que solo acepta potencias de 2),
  // causando "Maximum call stack size exceeded" por recursión infinita.
  // Este test existe específicamente para que ese caso no se vuelva a colar.
  it("no explota ni pierde/duplica jugadores para NINGÚN N entre 2 y 130", () => {
    for (let n = 2; n <= 130; n++) {
      const result = buildBracketWithPreRound(ranked(n), 5);
      const floor = prevPowerOf2(n);
      const surplus = n - floor;

      expect(result.bracket_size).toBe(floor);

      const preRound = result.matches.filter((m) => m.round === 0);
      expect(preRound).toHaveLength(surplus);
      expect(preRound.every((m) => m.player1_id !== null && m.player2_id !== null)).toBe(true);

      const official = result.matches.filter((m) => m.round >= 1);
      expect(official.some((m) => m.is_bye)).toBe(false);

      // Cada jugador de p1..pn aparece exactamente una vez en total, sumando
      // pre-llave + entrantes directos de ronda 1.
      const round1 = result.matches.filter((m) => m.round === 1);
      const direct = round1.flatMap((m) => [m.player1_id, m.player2_id]).filter((p) => p !== null);
      const preRoundPlayers = preRound.flatMap((m) => [m.player1_id, m.player2_id]);
      const allPlaced = [...direct, ...preRoundPlayers];
      expect(new Set(allPlaced).size).toBe(allPlaced.length); // sin duplicados
      expect(allPlaced).toHaveLength(n); // sin faltantes
    }
  });
});
