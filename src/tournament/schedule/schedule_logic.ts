// Simula un cronograma estimado (Punto 7 de la spec: "Cálculo del
// Cronograma") — NO es un horario fijo ni definitivo, es una proyección de
// cuándo se jugaría cada partido si todos duraran lo mismo en promedio.
// Sirve para que el organizador tenga una idea de a qué hora conviene citar
// a cada categoría, no para bloquear mesas de verdad (eso lo sigue haciendo
// el panel de Mesas en vivo, con los tiempos reales de cada partido).

export type ScheduleMatchInput = {
  id_match: string;
  match_type: "group" | "bracket";
  id_category: string;
  category_type: string;
  category_range: string;
  group_name: string | null;
  round: number | null;
  match_number: number;
  player1_id: string;
  player2_id: string;
};

export type ScheduledMatch = ScheduleMatchInput & {
  table_number: number;
  start_minute: number; // minutos desde el inicio de la jornada
  end_minute: number;
};

export type SimulateScheduleOptions = {
  numTables: number;
  avgMatchMinutes: number;
  // Descanso mínimo entre dos partidos del mismo jugador — la ITTF no
  // garantiza un descanso largo entre partidos sucesivos de un jugador,
  // pero sí le permite reclamar hasta 5 minutos si lo obligan a jugar
  // seguido (Reglamento de Competencias Internacionales ITTF). Default 5
  // para no simular un cronograma más agresivo que el que la propia ITTF
  // considera aceptable.
  minRestMinutes?: number;
  // Prioridad de categorías, de mayor a menor (ids de categoría) — la
  // primera de la lista entra primero a la cola de reparto justo, así que
  // consigue mesa antes que el resto cuando varias categorías compiten por
  // las mismas mesas libres. Categorías no incluidas en la lista quedan al
  // final, en el orden alfabético de siempre.
  categoryOrder?: string[];
};

// Reparto justo entre categorías: mismo criterio que applyFairOrder en
// tables_repository — ninguna categoría acapara todas las mesas mientras
// otra espera su turno. Se aplica antes de simular para decidir el ORDEN de
// entrada a la cola, no el horario en sí.
function applyFairOrder(matches: ScheduleMatchInput[], categoryOrder?: string[]): ScheduleMatchInput[] {
  const byCategory = new Map<string, ScheduleMatchInput[]>();
  for (const m of matches) {
    const list = byCategory.get(m.id_category);
    if (list) list.push(m);
    else byCategory.set(m.id_category, [m]);
  }

  const priority = new Map((categoryOrder ?? []).map((id, i) => [id, i]));
  const categoryIds = [...byCategory.keys()].sort((a, b) => {
    const pa = priority.get(a);
    const pb = priority.get(b);
    if (pa !== undefined && pb !== undefined) return pa - pb;
    if (pa !== undefined) return -1;
    if (pb !== undefined) return 1;
    const first = byCategory.get(a)![0];
    const second = byCategory.get(b)![0];
    return first.category_type.localeCompare(second.category_type);
  });

  const queues = categoryIds.map((id) => byCategory.get(id)!);
  const result: ScheduleMatchInput[] = [];
  let tookAny = true;
  while (tookAny) {
    tookAny = false;
    for (const queue of queues) {
      const next = queue.shift();
      if (next) {
        result.push(next);
        tookAny = true;
      }
    }
  }
  return result;
}

/**
 * Simulación greedy: cada vez que una mesa queda libre, le asigna el
 * próximo partido de la cola cuyos dos jugadores estén libres a esa hora.
 * Si ningún partido de la cola puede jugarse todavía (todos tienen algún
 * jugador ocupado), la mesa "espera" hasta el momento más próximo en que
 * alguno se libere — no queda parada indefinidamente ni se salta el orden
 * sin motivo.
 */
export function simulateSchedule(
  matches: ScheduleMatchInput[],
  options: SimulateScheduleOptions
): ScheduledMatch[] {
  const { numTables, avgMatchMinutes, minRestMinutes = 5, categoryOrder } = options;
  if (numTables < 1) throw new Error("numTables debe ser al menos 1");
  if (avgMatchMinutes < 1) throw new Error("avgMatchMinutes debe ser al menos 1");
  if (minRestMinutes < 0) throw new Error("minRestMinutes no puede ser negativo");

  const queue = applyFairOrder(matches, categoryOrder);
  const tableFreeAt = Array<number>(numTables).fill(0);
  const playerBusyUntil = new Map<string, number>();
  const scheduled: ScheduledMatch[] = [];

  while (queue.length > 0) {
    // Mesa que se libera más temprano.
    let tableIdx = 0;
    for (let i = 1; i < numTables; i++) {
      if (tableFreeAt[i] < tableFreeAt[tableIdx]) tableIdx = i;
    }
    const tableTime = tableFreeAt[tableIdx];

    const candidateIdx = queue.findIndex(
      (m) =>
        (playerBusyUntil.get(m.player1_id) ?? -Infinity) <= tableTime &&
        (playerBusyUntil.get(m.player2_id) ?? -Infinity) <= tableTime
    );

    if (candidateIdx === -1) {
      // Ningún partido pendiente puede jugarse todavía en esta mesa — la
      // adelantamos hasta que el jugador más próximo a liberarse (de entre
      // los que aparecen en la cola) quede disponible.
      let nextFree = Infinity;
      for (const m of queue) {
        const p1 = playerBusyUntil.get(m.player1_id) ?? -Infinity;
        const p2 = playerBusyUntil.get(m.player2_id) ?? -Infinity;
        nextFree = Math.min(nextFree, Math.max(p1, p2));
      }
      tableFreeAt[tableIdx] = Number.isFinite(nextFree) ? nextFree : tableTime;
      continue;
    }

    const match = queue.splice(candidateIdx, 1)[0];
    const endTime = tableTime + avgMatchMinutes;

    scheduled.push({
      ...match,
      table_number: tableIdx + 1,
      start_minute: tableTime,
      end_minute: endTime,
    });

    tableFreeAt[tableIdx] = endTime;
    playerBusyUntil.set(match.player1_id, endTime + minRestMinutes);
    playerBusyUntil.set(match.player2_id, endTime + minRestMinutes);
  }

  return scheduled.sort((a, b) => a.start_minute - b.start_minute || a.table_number - b.table_number);
}
