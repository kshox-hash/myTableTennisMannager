/**
 * Genera el cuadro eliminatorio (llaves) de acuerdo al estándar ITTF:
 * - Distribución serpentina: semillas 1 y 2 solo se pueden encontrar en la final.
 * - Los byes se asignan a las mejores semillas.
 * - El tamaño del cuadro es la potencia de 2 inmediatamente superior al número de jugadores.
 * - Semilla 1 siempre arriba, semilla 2 siempre abajo. El resto de las semillas
 *   (3-4, 5-8, 9-16, ...) tiene una "banda" protegida fija para no cruzarse
 *   entre sí demasiado pronto, pero DENTRO de esa banda se sortea al azar
 *   quién ocupa cada posición exacta (igual que en un sorteo real de torneo).
 */

export type TempBracketMatch = {
  temp_id: string;
  round: number;             // 1 = primera ronda, sube hasta la final
  match_number: number;      // posición dentro del round
  player1_id: string | null; // null = TBD o BYE
  player2_id: string | null;
  next_round: number | null;
  next_match_number: number | null;
  next_match_slot: 1 | 2 | null;
  winner_id: string | null;
  is_bye: boolean;
  status: "pending" | "ready" | "bye";
  best_of_sets: 3 | 5 | 7;
  // Cuál de los dos cupos (1 o 2) nunca va a llenarse porque esa mitad del
  // cuadro no tiene ningún jugador real (rama muerta por datos incompletos).
  // Se usa en tiempo de ejecución para que, cuando se juegue el partido real
  // del otro lado, el ganador siga avanzando solo en vez de quedar esperando
  // un rival que no existe.
  dead_slot: 1 | 2 | null;
  // Semilla original (1 = mejor) de cada jugador en SU primer partido de la
  // llave — solo se completa en la ronda 1, es puramente informativo para
  // mostrar "semilla 1 vs semilla 8" en la UI.
  seed1: number | null;
  seed2: number | null;
};

export type GeneratedBracketResult = {
  matches: TempBracketMatch[];
  bracket_size: number;
  total_rounds: number;
};

export function nextPowerOf2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

// La potencia de 2 anterior o igual a n (mayor potencia de 2 <= n) — el
// tamaño de la llave "oficial" del sistema de pre-llaves: nunca se agranda
// hacia arriba con BYEs, se arma con los que caben exactamente y el resto
// se resuelve en una ronda previa (ver buildBracketWithPreRound).
export function prevPowerOf2(n: number): number {
  let p = 1;
  while (p * 2 <= n) p *= 2;
  return p;
}

/**
 * Devuelve el orden de semillas para un cuadro de tamaño n.
 * Para n=8: [1, 8, 4, 5, 2, 7, 3, 6]
 * → Match 1: semilla 1 vs semilla 8
 * → Match 2: semilla 4 vs semilla 5
 * → Match 3: semilla 2 vs semilla 7
 * → Match 4: semilla 3 vs semilla 6
 * Garantiza que 1 y 2 se encuentran solo en la final.
 */
export function getSeedPositions(n: number): number[] {
  if (n === 1) return [1];
  const prev = getSeedPositions(n / 2);
  const result: number[] = [];
  for (const seed of prev) {
    result.push(seed);
    result.push(n + 1 - seed);
  }
  return result;
}

/**
 * Banda protegida a la que pertenece una semilla: 1 sola (seed 1), 1 sola
 * (seed 2), luego de a pares/potencias de 2 (3-4, 5-8, 9-16...). Dos semillas
 * de la misma banda son "intercambiables" sin romper la garantía de que no
 * se crucen antes de tiempo con las semillas superiores.
 */
function seedBand(seed: number): number {
  return seed <= 1 ? 0 : Math.ceil(Math.log2(seed));
}

/**
 * Sorteo real: dentro de cada banda protegida, sortea al azar qué jugador
 * ocupa cada posición. No mezcla jugadores reales con posiciones vacías
 * (BYE) de otra banda: los BYE siempre quedan para las semillas más bajas,
 * nunca le "roban" el pase libre a un jugador mejor rankeado.
 */
export function shuffleWithinSeedBands<T>(players: T[], isReal: (p: T) => boolean): T[] {
  const result = [...players];
  const numReal = result.filter(isReal).length;

  let i = 0;
  while (i < result.length) {
    const band = seedBand(i + 1);
    let end = i;
    while (end < result.length && seedBand(end + 1) === band) end++;

    const shuffleEnd = Math.min(end, numReal);
    for (let j = shuffleEnd - 1; j > i; j--) {
      const k = i + Math.floor(Math.random() * (j - i + 1));
      [result[j], result[k]] = [result[k], result[j]];
    }
    i = end;
  }

  return result;
}

/**
 * Banda de la posición física p (1 = primera fila) en la planilla de sorteo:
 * misma numeración que seedBand (0 = semilla 1, 1 = semilla 2, 2 = semillas
 * 3-4, ...), pero aplicada al LUGAR en el cuadro en vez de a la semilla.
 * Verificado contra una planilla real de sorteo ITTF de 32 jugadores: la
 * semilla 1 siempre en la posición 1, la semilla 2 en la última, semillas
 * 3-4 exactamente en el medio, 5-8 en los cuartos, 9-16 en los octavos, y el
 * resto ("2do") rellenando el resto — ver getPhysicalDisplayOrder más abajo.
 */
function positionBands(n: number): number[] {
  const band = new Array(n + 1).fill(-1); // 1-indexado, band[0] sin usar
  band[1] = 0;
  band[n] = 1;
  function recurse(lo: number, hi: number, depth: number) {
    if (hi - lo < 1) return;
    const mid = lo + Math.floor((hi - lo + 1) / 2);
    band[mid - 1] = depth;
    band[mid] = depth;
    recurse(lo, mid - 2, depth + 1);
    recurse(mid + 1, hi, depth + 1);
  }
  recurse(2, n - 1, 2);
  return band.slice(1); // 0-indexado por posición-1
}

/**
 * Orden FÍSICO (visual) del cuadro para mostrarlo como una planilla de
 * sorteo real, distinto del orden de emparejamiento de partidos que arma
 * buildBracketFromSlots (getSeedPositions). Acá lo que importa es: dado un
 * BYE, ¿en qué posición de la lista aparece? Los BYE siempre son las
 * semillas más débiles (las que sobran al rellenar hasta la potencia de 2), y
 * la convención estándar les da la posición más cercana a la semilla 1
 * primero, después la más cercana a la semilla 2, y así hacia adentro —
 * exactamente la misma banda protegida que ya usa el sorteo, solo que acá se
 * usa para decidir la fila visual en vez de el rival de la ronda 1.
 *
 * Devuelve, para cada posición física p (1..n, índice p-1), el índice
 * (0-based, semilla-1) del arreglo `drawn` de drawBracketSlots que debe
 * mostrarse ahí.
 */
export function getPhysicalDisplayOrder(n: number): number[] {
  if (n === 1) return [0];
  const posBand = positionBands(n);
  const depthFromEdge = (p: number) => Math.min(p, n + 1 - p);

  // Posiciones ordenadas de "más candidata a BYE" a "menos": primero por
  // banda descendente (la banda más débil primero), y dentro de una banda,
  // por cercanía al borde ascendente (más cerca de la semilla 1 o 2 = más
  // prioridad para quedar vacía).
  const weakestFirst = Array.from({ length: n }, (_, i) => i + 1).sort(
    (a, b) => posBand[b - 1] - posBand[a - 1] || depthFromEdge(a) - depthFromEdge(b)
  );

  const result = new Array(n);
  for (let seedIdx = 0; seedIdx < n; seedIdx++) {
    // seedIdx 0 = semilla 1 (la más fuerte) debe caer en la posición MENOS
    // candidata a BYE → se recorre weakestFirst desde el final.
    result[weakestFirst[n - 1 - seedIdx] - 1] = seedIdx;
  }
  return result;
}

export type DrawnSlot = { player: string | null; seed: number };

/**
 * Parte "azarosa" del sorteo: completa con BYEs hasta la potencia de 2 y
 * sortea dentro de cada banda protegida (ver seedBand/shuffleWithinSeedBands).
 * Se sortea el par [jugador, semilla original] junto para poder mostrar
 * después qué semilla le tocó a cada uno, aunque el sorteo haya movido de
 * posición dentro de su banda. Separada de buildBracketFromSlots para poder
 * previsualizar el resultado del sorteo antes de confirmar y persistir el
 * cuadro — se corre UNA sola vez y el mismo resultado se usa para mostrar
 * la previsualización y para guardar el cuadro real, sin volver a sortear.
 */
export function drawBracketSlots(
  seededPlayers: Array<string | null> // ordenados por semilla (0 = mejor), null = BYE
): DrawnSlot[] {
  const realPlayers = seededPlayers.filter((p) => p !== null).length;
  if (realPlayers < 2) {
    throw new Error("Se requieren al menos 2 jugadores para generar el cuadro");
  }

  const bracketSize = nextPowerOf2(seededPlayers.length);

  // Completar con BYEs hasta potencia de 2
  const padded: Array<string | null> = [...seededPlayers];
  while (padded.length < bracketSize) padded.push(null);

  const indexed = padded.map((p, i) => ({ player: p, seed: i + 1 }));
  return shuffleWithinSeedBands(indexed, (x) => x.player !== null);
}

export type GroupSeededEntry = {
  id: string;
  // Nombre del grupo del que salió (mismo string que category_groups.group_name
  // — alcanza como clave, es único dentro de la categoría). null = pase
  // directo (no clasificó por grupo).
  groupName: string | null;
  // 1 = ganador de grupo, 2 = segundo del grupo, null = pase directo (o un
  // 3er/4to clasificado si el grupo tiene qualifiers_per_group > 2 — la ITTF
  // no da una regla para ese caso, se trata como pase directo).
  rankInGroup: 1 | 2 | null;
  // Club/asociación — null si no tiene. Se usa solo como último criterio,
  // de mejor esfuerzo (ver drawBracketSlotsForGroups): "Finally separate by
  // Association as far as possible".
  clubId: string | null;
};

function shuffleArray<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function drawBracketSlotsForGroupsOnce(entries: GroupSeededEntry[]): DrawnSlot[] {
  const realPlayers = entries.length;
  if (realPlayers < 2) {
    throw new Error("Se requieren al menos 2 jugadores para generar el cuadro");
  }

  const bracketSize = nextPowerOf2(realPlayers);
  const seedOrder = getSeedPositions(bracketSize);
  const half = bracketSize / 2;
  const firstHalfSeeds = new Set(seedOrder.slice(0, half));
  const isTopHalf = (seed: number) => firstHalfSeeds.has(seed);

  const winners = entries.filter((e) => e.rankInGroup === 1);
  const runnersUp = entries.filter((e) => e.rankInGroup === 2);
  const direct = entries.filter((e) => e.rankInGroup !== 1 && e.rankInGroup !== 2);

  // 1) Ganadores de grupo: mismo sistema de bandas protegidas que ya usa
  // drawBracketSlots, aplicado solo a ellos (el resto queda "pendiente").
  const winnerPadded: Array<string | null> = [
    ...winners.map((w) => w.id),
    ...new Array(bracketSize - winners.length).fill(null),
  ];
  const winnerIndexed = winnerPadded.map((p, i) => ({ player: p, seed: i + 1 }));
  const winnerPlaced = shuffleWithinSeedBands(winnerIndexed, (x) => x.player !== null);

  const bySeed: Array<string | null> = winnerPlaced.map((x) => x.player);
  const pendingSeeds = new Set<number>();
  const winnerHalfByGroup = new Map<string, "top" | "bottom">();
  for (let i = 0; i < bracketSize; i++) {
    const seedNum = i + 1;
    if (bySeed[i] === null) {
      pendingSeeds.add(seedNum);
    } else {
      const winner = winners.find((w) => w.id === bySeed[i]);
      if (winner?.groupName) {
        winnerHalfByGroup.set(winner.groupName, isTopHalf(seedNum) ? "top" : "bottom");
      }
    }
  }

  // 2) Segundos de grupo: siempre en la mitad opuesta a su propio ganador.
  // Se procesan en orden al azar para no favorecer sistemáticamente a ningún
  // grupo cuando hay que repartir cupos limitados de una mitad ("drawn at
  // random" — el azar está en QUIÉN llega primero a reclamar el cupo más
  // fuerte disponible), pero dentro de esa mitad siempre se ocupa la semilla
  // más fuerte todavía libre: así lo que queda pendiente (y termina siendo
  // BYE) son siempre las semillas más débiles de cada mitad, igual que exige
  // la regla de BYE ("placed first against seeded places, in seeding
  // order") — si se eligiera al azar dentro de la mitad, un BYE podría
  // terminar protegiendo una semilla media (p.ej. 4) mientras una más débil
  // (p.ej. 7) queda con jugador real, lo cual rompe esa regla.
  for (const runnerUp of shuffleArray(runnersUp)) {
    const winnerHalf = runnerUp.groupName ? winnerHalfByGroup.get(runnerUp.groupName) : undefined;
    const targetHalf = winnerHalf === "top" ? "bottom" : "top";
    let candidates = [...pendingSeeds].filter((s) => (isTopHalf(s) ? "top" : "bottom") === targetHalf);
    // Si no queda cupo en la mitad correcta (dato límite: muy pocos cupos
    // libres), mejor ubicarlo en cualquier lado a fallar el sorteo entero.
    if (candidates.length === 0) candidates = [...pendingSeeds];
    const chosen = candidates.sort((a, b) => a - b)[0];
    bySeed[chosen - 1] = runnerUp.id;
    pendingSeeds.delete(chosen);
  }

  // 3) Pases directos: rellenan las semillas pendientes más fuertes primero,
  // para que lo que quede libre (BYE) sean siempre las semillas más débiles
  // — mismo criterio de protección que en drawBracketSlots.
  const pendingStrongestFirst = [...pendingSeeds].sort((a, b) => a - b);
  for (const entry of direct) {
    const seedNum = pendingStrongestFirst.shift();
    if (seedNum === undefined) break; // no debería pasar si los conteos cuadran
    bySeed[seedNum - 1] = entry.id;
    pendingSeeds.delete(seedNum);
  }

  // 4) Lo que sigue pendiente son BYE (ya están en null en bySeed).
  return bySeed.map((player, i) => ({ player, seed: i + 1 }));
}

// Partidos de la ronda 1 con los dos jugadores del mismo club (id_club no
// nulo, igual entre ambos) — cuenta cuántos "cruces de asociación" tiene un
// sorteo, para poder comparar intentos y quedarse con el mejor.
function countClubClashes(
  drawn: DrawnSlot[],
  clubById: Map<string, string | null>,
  seedOrder: number[]
): number {
  let clashes = 0;
  for (let i = 0; i < seedOrder.length; i += 2) {
    const a = drawn.find((d) => d.seed === seedOrder[i]);
    const b = drawn.find((d) => d.seed === seedOrder[i + 1]);
    const clubA = a?.player ? clubById.get(a.player) : null;
    const clubB = b?.player ? clubById.get(b.player) : null;
    if (clubA && clubB && clubA === clubB) clashes++;
  }
  return clashes;
}

const CLUB_SEPARATION_ATTEMPTS = 25;

/**
 * Sorteo según el ITTF Handbook for Tournament Referees, sección 3.7.2
 * ("Rules for KO Draw" — el paso de fase de grupos a cuadro eliminatorio):
 *
 *   - Los ganadores de grupo ocupan las posiciones de semilla protegidas
 *     (1 arriba, 2 abajo, 3-4 entre mitades, 5-8 en cuartos, ... "Continue
 *     this principle until all group winners are placed").
 *   - "Second placed players in group are drawn AT RANDOM into the
 *     OPPOSITE HALF to their group winner" — un segundo de grupo nunca
 *     puede caer en la misma mitad que el primero de SU PROPIO grupo (así
 *     no se vuelven a cruzar en la primera ronda, ya jugaron en la fase de
 *     grupos).
 *   - Los pases directos (sin grupo) rellenan lo que sobra.
 *   - Los BYE quedan, por descarte, en las semillas más débiles que sigan
 *     libres — así siguen protegiendo a los mejores ubicados, igual que en
 *     drawBracketSlots.
 *   - "Finally separate by Association as far as possible" — ÚLTIMO
 *     criterio, de mejor esfuerzo: entre varios sorteos igualmente válidos
 *     (todos cumplen las reglas de arriba), se sortea varias veces y se
 *     elige el que menos partidos de ronda 1 tenga entre jugadores del mismo
 *     club. No se sacrifica ninguna regla de mayor prioridad para lograrlo
 *     — si nunca se puede evitar un cruce (p.ej. medio equipo es del mismo
 *     club), simplemente queda el sorteo con menos cruces posibles.
 *
 * "Mitad" acá es la mitad de la LLAVE (qué semifinal le toca), no la fila
 * física de la planilla — se determina viendo en qué mitad del arreglo de
 * getSeedPositions(bracketSize) cae cada número de semilla.
 */
export function drawBracketSlotsForGroups(entries: GroupSeededEntry[]): DrawnSlot[] {
  const hasClubOverlap = entries.some(
    (a) => a.clubId && entries.some((b) => b !== a && b.clubId === a.clubId)
  );
  // Sin overlap de club posible, no hay nada que optimizar — un solo sorteo.
  if (!hasClubOverlap) return drawBracketSlotsForGroupsOnce(entries);

  const bracketSize = nextPowerOf2(entries.length);
  const seedOrder = getSeedPositions(bracketSize);
  const clubById = new Map(entries.map((e) => [e.id, e.clubId]));

  let best = drawBracketSlotsForGroupsOnce(entries);
  let bestClashes = countClubClashes(best, clubById, seedOrder);

  for (let attempt = 1; attempt < CLUB_SEPARATION_ATTEMPTS && bestClashes > 0; attempt++) {
    const candidate = drawBracketSlotsForGroupsOnce(entries);
    const clashes = countClubClashes(candidate, clubById, seedOrder);
    if (clashes < bestClashes) {
      best = candidate;
      bestClashes = clashes;
    }
  }

  return best;
}

/**
 * Arma todos los partidos de todas las rondas a partir de un sorteo YA
 * decidido (ver drawBracketSlots) — no vuelve a sortear nada, así lo que se
 * confirma es exactamente lo que se previsualizó.
 */
export function buildBracketFromSlots(
  drawnIndexed: DrawnSlot[],
  bestOfSets: 3 | 5 | 7 = 5
): GeneratedBracketResult {
  const drawn = drawnIndexed.map((x) => x.player);
  const drawnSeeds = drawnIndexed.map((x) => x.seed);
  const bracketSize = drawnIndexed.length;
  const totalRounds = Math.log2(bracketSize);

  const allMatches: TempBracketMatch[] = [];

  // Generar todos los slots de partidos para todos los rounds
  for (let round = 1; round <= totalRounds; round++) {
    const matchesInRound = bracketSize / Math.pow(2, round);
    const isLastRound = round === totalRounds;

    for (let matchNum = 1; matchNum <= matchesInRound; matchNum++) {
      allMatches.push({
        temp_id: `r${round}_m${matchNum}`,
        round,
        match_number: matchNum,
        player1_id: null,
        player2_id: null,
        next_round: isLastRound ? null : round + 1,
        next_match_number: isLastRound ? null : Math.ceil(matchNum / 2),
        next_match_slot: isLastRound ? null : ((matchNum % 2 === 1 ? 1 : 2) as 1 | 2),
        winner_id: null,
        is_bye: false,
        status: "pending",
        best_of_sets: bestOfSets,
        dead_slot: null,
        seed1: null,
        seed2: null,
      });
    }
  }

  // Asignar jugadores al round 1 según posiciones de semilla
  const seedOrder = getSeedPositions(bracketSize);
  const round1 = allMatches.filter((m) => m.round === 1);

  for (let i = 0; i < round1.length; i++) {
    const match = round1[i];
    match.player1_id = drawn[seedOrder[i * 2] - 1] ?? null;
    match.player2_id = drawn[seedOrder[i * 2 + 1] - 1] ?? null;
    match.seed1 = match.player1_id !== null ? drawnSeeds[seedOrder[i * 2] - 1] : null;
    match.seed2 = match.player2_id !== null ? drawnSeeds[seedOrder[i * 2 + 1] - 1] : null;

    if (match.player1_id !== null && match.player2_id !== null) {
      match.status = "ready";
    } else if (match.player1_id !== null) {
      match.is_bye = true;
      match.winner_id = match.player1_id;
      match.status = "bye";
    } else if (match.player2_id !== null) {
      match.is_bye = true;
      match.winner_id = match.player2_id;
      match.status = "bye";
    }
  }

  // Propagar ganadores a los siguientes rounds. Si los datos de grupos están
  // incompletos puede haber sub-ramas enteras sin ningún jugador real, y el
  // BYE que antes solo se resolvía en la ronda 1 puede aparecer en cualquier
  // ronda (un jugador que va encadenando pases libres). Para resolverlo bien
  // hay que distinguir tres casos en cada partido, según cuántos jugadores
  // reales son alcanzables en su sub-rama (realCount):
  //   0 → rama muerta: nunca va a haber nadie ahí, queda "pending" para
  //       siempre sin bloquear nada (nada depende de que "gane").
  //   1 → un solo sobreviviente: avanza directo sin jugar (BYE), en
  //       cualquier ronda, no solo en la primera.
  //   2+ → hay (o habrá) un partido real por jugar en algún punto de la
  //       rama: se deja "pending"/"ready" esperando el resultado real, igual
  //       que antes — nunca se inventa un ganador.
  const matchMap = new Map(allMatches.map((m) => [m.temp_id, m]));
  const realCount = new Map<string, number>();
  for (const match of round1) {
    realCount.set(match.temp_id, (match.player1_id !== null ? 1 : 0) + (match.player2_id !== null ? 1 : 0));
  }

  for (let round = 1; round < totalRounds; round++) {
    const thisRound = allMatches.filter((m) => m.round === round);

    for (const match of thisRound) {
      if (!match.next_round || !match.next_match_number) continue;
      const nextMatch = matchMap.get(`r${match.next_round}_m${match.next_match_number}`);
      if (!nextMatch) continue;

      if (match.winner_id) {
        if (match.next_match_slot === 1) nextMatch.player1_id = match.winner_id;
        else nextMatch.player2_id = match.winner_id;
      }

      const carried = realCount.get(match.temp_id) ?? 0;
      realCount.set(nextMatch.temp_id, (realCount.get(nextMatch.temp_id) ?? 0) + carried);
      if (carried === 0 && match.next_match_slot) {
        nextMatch.dead_slot = match.next_match_slot;
      }
    }

    for (const nextMatch of allMatches.filter((m) => m.round === round + 1)) {
      const count = realCount.get(nextMatch.temp_id) ?? 0;
      const lone = nextMatch.player1_id ?? nextMatch.player2_id;

      if (count === 1 && lone) {
        nextMatch.is_bye = true;
        nextMatch.winner_id = lone;
        nextMatch.status = "bye";
      } else if (count >= 2 && nextMatch.player1_id !== null && nextMatch.player2_id !== null) {
        nextMatch.status = "ready";
      }
    }
  }

  return { matches: allMatches, bracket_size: bracketSize, total_rounds: totalRounds };
}

/**
 * Variante de buildBracketFromSlots para cuando N no es una potencia de 2
 * exacta: en vez de completar con BYEs hasta la potencia de 2 siguiente
 * (nextPowerOf2), los 2×surplus sembrados más débiles juegan una "pre-llave"
 * (ronda 0) para ganarse su lugar, y la llave oficial (ronda 1 en adelante)
 * queda del tamaño de la potencia de 2 ANTERIOR (prevPowerOf2) —
 * completamente llena, sin ningún BYE. Ver Punto 3 del documento fundacional
 * del proyecto ("Pre-llaves y Byes").
 *
 * `rankedRealPlayers` debe venir sin huecos, ordenado por semilla real
 * (índice 0 = semilla 1) — exactamente el resultado de drawBracketSlots /
 * drawBracketSlotsForGroups filtrando los BYE (que siempre quedan al final:
 * shuffleWithinSeedBands nunca cruza un jugador real más allá de la
 * cantidad total de jugadores reales, así que drawn.slice(0, n) ya da la
 * lista limpia ordenada por semilla).
 */
export function buildBracketWithPreRound(
  rankedRealPlayers: DrawnSlot[],
  bestOfSets: 3 | 5 | 7 = 5
): GeneratedBracketResult {
  const n = rankedRealPlayers.length;
  const floor = prevPowerOf2(n);

  if (floor === n) {
    // Ya es una potencia de 2 exacta: no hace falta pre-llave, mismo camino
    // de siempre (cero BYEs de por sí).
    return buildBracketFromSlots(rankedRealPlayers, bestOfSets);
  }

  const surplus = n - floor;
  // Semillas 1..floor-surplus: entran directo a la ronda 1.
  const direct = rankedRealPlayers.slice(0, floor - surplus);
  // Semillas floor-surplus+1..n (2×surplus jugadores): juegan la ronda 0.
  const preRoundPool = rankedRealPlayers.slice(floor - surplus);

  const totalRounds = Math.log2(floor);
  const allMatches: TempBracketMatch[] = [];

  // A qué partido (y a qué cupo, 1 o 2) de la ronda 1 le corresponde cada
  // semilla del cuadro de tamaño floor — mismo criterio de emparejamiento
  // que ya usa buildBracketFromSlots para la ronda 1 normal.
  const round1SeedOrder = getSeedPositions(floor);
  const round1MatchBySeed = new Map<number, number>();
  const round1SlotBySeed = new Map<number, 1 | 2>();
  round1SeedOrder.forEach((seed, i) => {
    round1MatchBySeed.set(seed, Math.floor(i / 2) + 1);
    round1SlotBySeed.set(seed, i % 2 === 0 ? 1 : 2);
  });

  // Ronda 0 (pre-llave): empareja "de afuera hacia adentro" — el sembrado
  // más fuerte del pool contra el más débil, el segundo más fuerte contra
  // el segundo más débil, etc. (2×surplus siempre es par, así que no hace
  // falta lidiar con BYE acá). OJO: NO se usa getSeedPositions para esto —
  // esa función asume que su tamaño es una potencia de 2 (recursión
  // n -> n/2 hasta llegar a 1) y 2×surplus casi nunca lo es, así que la
  // habíamos usado mal acá: para un N feo (ej. 23 jugadores) terminaba en
  // recursión infinita ("Maximum call stack size exceeded"). Acá alcanza
  // con un emparejamiento simple: no hay múltiples rondas dentro de la
  // pre-llave que requieran la garantía "semilla 1 y 2 se cruzan recién en
  // la final" — cada partido de ronda 0 es autocontenido, el ganador pasa
  // directo a la ronda 1.
  for (let matchNum = 1; matchNum <= surplus; matchNum++) {
    const p1 = preRoundPool[matchNum - 1];
    const p2 = preRoundPool[preRoundPool.length - matchNum];
    const targetSeed = floor - surplus + matchNum;
    allMatches.push({
      temp_id: `r0_m${matchNum}`,
      round: 0,
      match_number: matchNum,
      player1_id: p1.player,
      player2_id: p2.player,
      next_round: 1,
      next_match_number: round1MatchBySeed.get(targetSeed)!,
      next_match_slot: round1SlotBySeed.get(targetSeed)!,
      winner_id: null,
      is_bye: false,
      status: "ready",
      best_of_sets: bestOfSets,
      dead_slot: null,
      seed1: p1.seed,
      seed2: p2.seed,
    });
  }

  // Rondas 1..totalRounds: mismos "shells" que buildBracketFromSlots.
  for (let round = 1; round <= totalRounds; round++) {
    const matchesInRound = floor / Math.pow(2, round);
    const isLastRound = round === totalRounds;

    for (let matchNum = 1; matchNum <= matchesInRound; matchNum++) {
      allMatches.push({
        temp_id: `r${round}_m${matchNum}`,
        round,
        match_number: matchNum,
        player1_id: null,
        player2_id: null,
        next_round: isLastRound ? null : round + 1,
        next_match_number: isLastRound ? null : Math.ceil(matchNum / 2),
        next_match_slot: isLastRound ? null : ((matchNum % 2 === 1 ? 1 : 2) as 1 | 2),
        winner_id: null,
        is_bye: false,
        status: "pending",
        best_of_sets: bestOfSets,
        dead_slot: null,
        seed1: null,
        seed2: null,
      });
    }
  }

  // Ronda 1: los sembrados directos ya se conocen de entrada; los que
  // dependen de la pre-llave quedan null hasta que el loop de propagación
  // de abajo (el mismo de buildBracketFromSlots, generalizado a arrancar en
  // ronda 0) complete el winner_id de su partido de ronda 0.
  const round1 = allMatches.filter((m) => m.round === 1);
  for (const match of round1) {
    const seedSlot1 = round1SeedOrder[(match.match_number - 1) * 2];
    const seedSlot2 = round1SeedOrder[(match.match_number - 1) * 2 + 1];
    if (seedSlot1 <= floor - surplus) {
      match.player1_id = direct[seedSlot1 - 1].player;
      match.seed1 = direct[seedSlot1 - 1].seed;
    }
    if (seedSlot2 <= floor - surplus) {
      match.player2_id = direct[seedSlot2 - 1].player;
      match.seed2 = direct[seedSlot2 - 1].seed;
    }
    if (match.player1_id !== null && match.player2_id !== null) {
      match.status = "ready";
    }
  }

  // Mismo mecanismo de propagación que buildBracketFromSlots (realCount /
  // dead_slot / BYE en cascada) — ver el comentario largo ahí. Acá arranca
  // en la ronda 0 en vez de la ronda 1, así los partidos de pre-llave
  // "cuentan" para decidir cuándo la ronda 1 queda lista/pendiente, con el
  // mismo código sin duplicar nada.
  const matchMap = new Map(allMatches.map((m) => [m.temp_id, m]));
  const realCount = new Map<string, number>();
  for (const match of allMatches.filter((m) => m.round === 0 || m.round === 1)) {
    realCount.set(match.temp_id, (match.player1_id !== null ? 1 : 0) + (match.player2_id !== null ? 1 : 0));
  }

  for (let round = 0; round < totalRounds; round++) {
    const thisRound = allMatches.filter((m) => m.round === round);

    for (const match of thisRound) {
      if (!match.next_round || !match.next_match_number) continue;
      const nextMatch = matchMap.get(`r${match.next_round}_m${match.next_match_number}`);
      if (!nextMatch) continue;

      if (match.winner_id) {
        if (match.next_match_slot === 1) nextMatch.player1_id = match.winner_id;
        else nextMatch.player2_id = match.winner_id;
      }

      const carried = realCount.get(match.temp_id) ?? 0;
      realCount.set(nextMatch.temp_id, (realCount.get(nextMatch.temp_id) ?? 0) + carried);
      if (carried === 0 && match.next_match_slot) {
        nextMatch.dead_slot = match.next_match_slot;
      }
    }

    for (const nextMatch of allMatches.filter((m) => m.round === round + 1)) {
      const count = realCount.get(nextMatch.temp_id) ?? 0;
      const lone = nextMatch.player1_id ?? nextMatch.player2_id;

      if (count === 1 && lone) {
        nextMatch.is_bye = true;
        nextMatch.winner_id = lone;
        nextMatch.status = "bye";
      } else if (count >= 2 && nextMatch.player1_id !== null && nextMatch.player2_id !== null) {
        nextMatch.status = "ready";
      }
    }
  }

  return { matches: allMatches, bracket_size: floor, total_rounds: totalRounds };
}

/**
 * Atajo que hace todo de una: sortea y arma el cuadro en un solo llamado.
 * Se mantiene para quien no necesite previsualizar el sorteo antes.
 */
export function generateElimBracket(
  seededPlayers: Array<string | null>,
  bestOfSets: 3 | 5 | 7 = 5
): GeneratedBracketResult {
  const drawn = drawBracketSlots(seededPlayers);
  return buildBracketFromSlots(drawn, bestOfSets);
}
