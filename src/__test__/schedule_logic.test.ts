import { simulateSchedule, type ScheduleMatchInput } from "../tournament/schedule/schedule_logic";

function match(
  id: string,
  category: string,
  categoryType: string,
  p1: string,
  p2: string,
  groupName = "GR-1",
  matchNumber = 1
): ScheduleMatchInput {
  return {
    id_match: id,
    match_type: "group",
    id_category: category,
    category_type: categoryType,
    category_range: "General",
    group_name: groupName,
    round: null,
    match_number: matchNumber,
    player1_id: p1,
    player2_id: p2,
  };
}

describe("simulateSchedule", () => {
  it("no programa más partidos simultáneos que mesas disponibles", () => {
    const matches = [
      match("m1", "cat1", "A", "p1", "p2"),
      match("m2", "cat1", "A", "p3", "p4"),
      match("m3", "cat1", "A", "p5", "p6"),
    ];
    const result = simulateSchedule(matches, { numTables: 2, avgMatchMinutes: 15 });

    // A tiempo 0, solo 2 mesas: uno de los 3 partidos arranca en minuto 15.
    const startTimes = result.map((r) => r.start_minute).sort((a, b) => a - b);
    expect(startTimes).toEqual([0, 0, 15]);
  });

  it("nunca hace jugar al mismo jugador dos partidos a la vez", () => {
    const matches = [
      match("m1", "cat1", "A", "p1", "p2"),
      match("m2", "cat1", "A", "p1", "p3"), // p1 repite
    ];
    const result = simulateSchedule(matches, { numTables: 4, avgMatchMinutes: 10 });

    const m1 = result.find((r) => r.id_match === "m1")!;
    const m2 = result.find((r) => r.id_match === "m2")!;
    // m2 no puede empezar antes de que termine m1 (comparten a p1).
    expect(m2.start_minute).toBeGreaterThanOrEqual(m1.end_minute);
  });

  it("reparte parejo entre categorías en vez de vaciar una primero", () => {
    const matches = [
      match("a1", "catA", "A", "a1p1", "a1p2"),
      match("a2", "catA", "A", "a1p3", "a1p4"),
      match("b1", "catB", "B", "b1p1", "b1p2"),
    ];
    const result = simulateSchedule(matches, { numTables: 1, avgMatchMinutes: 10 });
    // Con 1 sola mesa: A, B, A (fair order) — no A, A, B.
    expect(result.map((r) => r.id_category)).toEqual(["catA", "catB", "catA"]);
  });

  it("programa todos los partidos sin perder ninguno", () => {
    const matches = Array.from({ length: 10 }, (_, i) =>
      match(`m${i}`, "cat1", "A", `p${i * 2}`, `p${i * 2 + 1}`)
    );
    const result = simulateSchedule(matches, { numTables: 3, avgMatchMinutes: 12 });
    expect(result.length).toBe(10);
    expect(new Set(result.map((r) => r.id_match)).size).toBe(10);
  });

  it("por defecto deja 5 minutos de descanso al jugador que repite (mismo margen que permite reclamar la ITTF)", () => {
    const matches = [
      match("m1", "cat1", "A", "p1", "p2"),
      match("m2", "cat1", "A", "p1", "p3"), // p1 repite
    ];
    const result = simulateSchedule(matches, { numTables: 1, avgMatchMinutes: 10 });
    const m1 = result.find((r) => r.id_match === "m1")!;
    const m2 = result.find((r) => r.id_match === "m2")!;
    expect(m2.start_minute).toBe(m1.end_minute + 5);
  });

  it("permite desactivar el descanso mínimo con minRestMinutes: 0", () => {
    const matches = [
      match("m1", "cat1", "A", "p1", "p2"),
      match("m2", "cat1", "A", "p1", "p3"),
    ];
    const result = simulateSchedule(matches, { numTables: 1, avgMatchMinutes: 10, minRestMinutes: 0 });
    const m1 = result.find((r) => r.id_match === "m1")!;
    const m2 = result.find((r) => r.id_match === "m2")!;
    expect(m2.start_minute).toBe(m1.end_minute);
  });

  it("con categoryOrder, la categoría prioritaria entra primero a la cola aunque su nombre vaya después alfabéticamente", () => {
    const matches = [
      match("a1", "catA", "A", "a1p1", "a1p2"),
      match("a2", "catA", "A", "a1p3", "a1p4"),
      match("b1", "catB", "B", "b1p1", "b1p2"),
    ];
    // Sin categoryOrder el fair-order alfabético pondría A primero (test de
    // arriba). Con catB como prioridad, tiene que arrancar primero.
    const result = simulateSchedule(matches, {
      numTables: 1,
      avgMatchMinutes: 10,
      categoryOrder: ["catB", "catA"],
    });
    expect(result.map((r) => r.id_category)).toEqual(["catB", "catA", "catA"]);
  });

  it("respeta el número de mesas: ninguna mesa tiene dos partidos solapados", () => {
    const matches = Array.from({ length: 8 }, (_, i) =>
      match(`m${i}`, "cat1", "A", `p${i * 2}`, `p${i * 2 + 1}`)
    );
    const result = simulateSchedule(matches, { numTables: 3, avgMatchMinutes: 20 });

    const byTable = new Map<number, typeof result>();
    for (const r of result) {
      const list = byTable.get(r.table_number) ?? [];
      list.push(r);
      byTable.set(r.table_number, list);
    }
    for (const list of byTable.values()) {
      const sorted = [...list].sort((a, b) => a.start_minute - b.start_minute);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].start_minute).toBeGreaterThanOrEqual(sorted[i - 1].end_minute);
      }
    }
  });
});
