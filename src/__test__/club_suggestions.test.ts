import { clubSuggestions, type Occupant, type Position } from "../brackets/club_suggestions";

// Llave de 8 (4 partidos de primera ronda). Mitad de arriba: partidos 1-2.
function occ(ref: string, group: string, rank: 1 | 2, club: string | null): Occupant {
  return { ref, name: ref, club, clubName: club, group, rank };
}
function r1(match: number, slot: 1 | 2, o: Occupant | null, seed: number | null, locked = false): Position {
  return { round: 1, match_number: match, next_match_number: null, next_match_slot: null, slot, seed, locked, occupant: o };
}

describe("Recomendaciones de club para la mesa de control", () => {
  // 1° de A..D y 2° de A..D, cada 2° en la mitad opuesta a su 1°.
  const base = () => [
    r1(1, 1, occ("A1", "A", 1, "X"), 1),
    r1(1, 2, occ("C2", "C", 2, "X"), 8), // mismo club que A1 → cruce
    r1(2, 1, occ("D2", "D", 2, "Y"), 5),
    r1(2, 2, occ("B1", "B", 1, "Z"), 4),
    r1(3, 1, occ("C1", "C", 1, "W"), 3),
    r1(3, 2, occ("A2", "A", 2, "V"), 6),
    r1(4, 1, occ("B2", "B", 2, "U"), 7),
    r1(4, 2, occ("D1", "D", 1, "T"), 2),
  ];

  it("detecta el cruce y propone un cambio entre dos 2° de la misma mitad", () => {
    const s = clubSuggestions(base());
    expect(s).toHaveLength(1);
    expect([s[0].a.ref, s[0].b.ref].sort()).toEqual(["A1", "C2"]);
    expect(s[0].swap).not.toBeNull();
    // Mueve al 2° (C2) y solo con otro 2° que no deje a nadie en la mitad de su 1°.
    expect(s[0].swap!.move.ref).toBe("C2");
    expect(s[0].swap!.with.ref).toBe("D2");
    // Dice adónde va cada uno y contra quién.
    expect(s[0].swap!.move.to).toEqual({ match: "Partido 2", opponent: "B1" });
    expect(s[0].swap!.with.to).toEqual({ match: "Partido 1", opponent: "A1" });
  });

  it("recomienda primero el cambio que además arregla una revancha de grupo", () => {
    // Arriba: C2 vs A1 (mismo club X) y B2 vs B1 (mismo grupo, revancha).
    // Cambiar a C2 con B2 arregla el cruce de club Y saca a B2 de la revancha,
    // sin crear ningún problema nuevo.
    const p = [
      r1(1, 1, occ("A1", "A", 1, "X"), 1),
      r1(1, 2, occ("C2", "C", 2, "X"), 8),
      r1(2, 1, occ("B2", "B", 2, "U"), 5),
      r1(2, 2, occ("B1", "B", 1, "Z"), 4),
      r1(3, 1, occ("C1", "C", 1, "W"), 3),
      r1(3, 2, occ("A2", "A", 2, "V"), 6),
      r1(4, 1, occ("D2", "D", 2, "Y"), 7),
      r1(4, 2, occ("D1", "D", 1, "T"), 2),
    ];
    const s = clubSuggestions(p);
    const first = s.find((x) => [x.a.ref, x.b.ref].includes("C2"))!;
    expect(first.options[0].with.ref).toBe("B2");
    expect(first.options[0].reason).toMatch(/mismo grupo/);
  });

  it("detecta a dos que ya jugaron en el mismo grupo en su primer partido y propone cómo separarlos", () => {
    // B2 contra B1 en el partido 2 (mitad de arriba): revancha del grupo B.
    const s = clubSuggestions([
      r1(1, 1, occ("A1", "A", 1, "X"), 1),
      r1(1, 2, occ("C2", "C", 2, "Y"), 8),
      r1(2, 1, occ("B2", "B", 2, "U"), 5),
      r1(2, 2, occ("B1", "B", 1, "Z"), 4),
      r1(3, 1, occ("C1", "C", 1, "W"), 3),
      r1(3, 2, occ("A2", "A", 2, "V"), 6),
      r1(4, 1, occ("E2", "E", 2, "Q"), 7),
      r1(4, 2, occ("D1", "D", 1, "T"), 2),
    ]);
    expect(s).toHaveLength(1);
    expect(s[0].kind).toBe("group");
    expect([s[0].a.ref, s[0].b.ref].sort()).toEqual(["B1", "B2"]);
    expect(s[0].options.length).toBeGreaterThan(0);
  });

  it("nunca propone un cambio que cree una regla rota nueva", () => {
    // Igual que el caso base: mover a C2 a la mitad de abajo lo dejaría con su 1° (C1).
    const s = clubSuggestions([
      r1(1, 1, occ("A1", "A", 1, "X"), 1),
      r1(1, 2, occ("C2", "C", 2, "X"), 8),
      r1(2, 1, occ("D2", "D", 2, "Y"), 5),
      r1(2, 2, occ("B1", "B", 1, "Z"), 4),
      r1(3, 1, occ("C1", "C", 1, "W"), 3),
      r1(3, 2, occ("A2", "A", 2, "V"), 6),
      r1(4, 1, occ("B2", "B", 2, "U"), 7),
      r1(4, 2, occ("D1", "D", 1, "T"), 2),
    ]);
    expect(s[0].options.map((o) => o.with.ref)).not.toContain("A2");
    expect(s[0].options.map((o) => o.with.ref)).not.toContain("B2");
  });

  it("no propone nada que rompa reglas: si el único cambio posible es inválido, swap = null", () => {
    const p = base();
    p[2].locked = true; // D2 ya está en mesa: el único 2° de la misma mitad no se puede mover
    p[3].locked = true;
    const s = clubSuggestions(p);
    expect(s).toHaveLength(1);
    expect(s[0].swap).toBeNull();
  });

  it("un partido ya en juego no genera recomendación", () => {
    const p = base();
    p[0].locked = true;
    p[1].locked = true;
    expect(clubSuggestions(p)).toHaveLength(0);
  });

  it("un cupo sin llenar nunca cuenta como cruce de club, pero se puede usar para el cambio", () => {
    const p = base();
    p[2].occupant = { ref: "slot:D:2", name: "cupo 2° D", club: null, clubName: null, group: "D", rank: 2 };
    const s = clubSuggestions(p);
    expect(s).toHaveLength(1);
    expect(s[0].swap!.with.ref).toBe("slot:D:2");
  });
});
