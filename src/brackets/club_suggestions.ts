/**
 * Recomendaciones para la mesa de control con la llave ya armada (sobre todo
 * la adelantada, donde al sortear no se sabía quién iba a clasificar): busca
 * primeros partidos entre dos que ya jugaron en el MISMO GRUPO o que son del
 * MISMO CLUB y, para cada uno, propone un cambio de lugar que lo evite SIN
 * crear ningún problema nuevo:
 *
 *   - nadie vuelve a cruzarse con uno de su grupo antes de lo debido (el 2°
 *     sigue en la mitad opuesta a su 1°, y nadie queda contra uno de su grupo);
 *   - solo cambian dos del mismo tipo: 1° con 1° de la misma banda de
 *     semillas, 2° con 2°; y de la misma ronda (nadie gana ni pierde un BYE
 *     ni entra o sale de la pre-llave);
 *   - nunca se toca un partido jugado, en vivo o ya en una mesa.
 *
 * No aplica nada: la mesa de control decide (Aplicar / Dejar así).
 */
import { seedBand } from "../bracket_generation_logic";

export type Occupant = {
  /** id del jugador o "slot:<grupo>:<puesto>" para un cupo sin llenar. */
  ref: string;
  name: string;
  /** Club (null = sin club o cupo sin llenar: nunca choca). */
  club: string | null;
  clubName: string | null;
  /** Grupo del que salió (null = pase directo). */
  group: string | null;
  /** "GR-11" (para los avisos). */
  groupName?: string | null;
  /** 1 = 1° de grupo, 2 = 2°, null = otro (pase directo, Plata). */
  rank: 1 | 2 | null;
};

export type Position = {
  round: number;
  match_number: number;
  next_match_number: number | null;
  next_match_slot: 1 | 2 | null;
  slot: 1 | 2;
  seed: number | null;
  locked: boolean;
  /** null = cupo que llena una pre-llave (no se mueve). */
  occupant: Occupant | null;
};

export type ClubSuggestion = {
  /** "group" = ya jugaron en el mismo grupo (lo más grave); "club" = mismo club. */
  kind: "group" | "club";
  a: { ref: string; name: string; club: string | null };
  b: { ref: string; name: string; club: string | null };
  clubName: string;
  /** Grupo en que ya jugaron (solo kind = "group"). */
  groupName: string | null;
  /** El cambio más recomendado (= options[0]); null = no hay uno que no rompa reglas. */
  swap: SwapOption | null;
  /** Hasta 3 cambios posibles, del más recomendado al menos. */
  options: SwapOption[];
};

export type SwapOption = {
  move: { ref: string; name: string; club: string | null; to: Destination };
  with: { ref: string; name: string; club: string | null; to: Destination };
  /** Por qué se recomienda, en una frase. */
  reason: string;
};

const MAX_OPTIONS = 3;

/** Adónde queda cada uno con el cambio: el partido y contra quién juega ahí. */
export type Destination = {
  /** "Pre-llave 2" o "Partido 12". */
  match: string;
  /** Nombre del rival, o "el ganador de la pre-llave 1". */
  opponent: string;
  /** Club del rival (si se conoce). */
  opponentClub: string | null;
};

/** Partido de un puesto y, una vez hecho el cambio, quién queda enfrente. */
function destination(positions: Position[], at: number, arriving: Occupant): Destination {
  const p = positions[at];
  const match = p.round === 0 ? `Pre-llave ${p.match_number}` : `Partido ${p.match_number}`;
  const otherSlot = p.slot === 1 ? 2 : 1;
  const other = positions.find((x) => x.round === p.round && x.match_number === p.match_number && x.slot === otherSlot);
  if (other?.occupant) {
    return {
      match,
      opponent: other.occupant.ref === arriving.ref ? "—" : other.occupant.name,
      opponentClub: other.occupant.clubName,
    };
  }
  const feeder = positions.find(
    (x) => x.round === 0 && x.next_match_number === p.match_number && x.next_match_slot === otherSlot
  );
  return { match, opponent: feeder ? `el ganador del partido previo ${feeder.match_number}` : "por definir", opponentClub: null };
}

/** Pares de rivales del primer partido de cada uno (índices de `positions`). */
function firstMeetings(positions: Position[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  const idx = (round: number, match: number, slot: 1 | 2) =>
    positions.findIndex((p) => p.round === round && p.match_number === match && p.slot === slot);
  const feeders = (match: number, slot: 1 | 2) =>
    positions
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.round === 0 && p.next_match_number === match && p.next_match_slot === slot && p.occupant)
      .map(({ i }) => i);

  for (const m of new Set(positions.filter((p) => p.round === 0).map((p) => p.match_number))) {
    const a = idx(0, m, 1);
    const b = idx(0, m, 2);
    if (a >= 0 && b >= 0 && positions[a].occupant && positions[b].occupant) pairs.push([a, b]);
  }
  for (const m of new Set(positions.filter((p) => p.round === 1).map((p) => p.match_number))) {
    const a = idx(1, m, 1);
    const b = idx(1, m, 2);
    if (a < 0 || b < 0) continue;
    const sideA = positions[a].occupant ? [a] : feeders(m, 1);
    const sideB = positions[b].occupant ? [b] : feeders(m, 2);
    // Dos lados que salen de pre-llave no se cruzan en su PRIMER partido.
    if (!positions[a].occupant && !positions[b].occupant) continue;
    for (const x of sideA) for (const y of sideB) pairs.push([x, y]);
  }
  return pairs;
}

function sameClub(a: Occupant | null, b: Occupant | null): boolean {
  return !!a && !!b && !!a.club && a.club === b.club;
}

/** Mitad de la llave oficial (0 arriba, 1 abajo) de cada puesto. */
function halves(positions: Position[]): number[] {
  const firstRound = positions.filter((p) => p.round === 1).length / 2;
  return positions.map((p) => {
    const m = p.round === 0 ? p.next_match_number ?? 0 : p.match_number;
    return m <= firstRound / 2 ? 0 : 1;
  });
}

/** Cuántas reglas duras se rompen: revancha de grupo en el primer partido, o 2° en la mitad de su 1°. */
/** Reglas duras rotas, cada una con una clave (para saber si un cambio crea una NUEVA). */
function hardViolations(positions: Position[], pairs: Array<[number, number]>, half: number[]): Set<string> {
  const v = new Set<string>();
  for (const [x, y] of pairs) {
    const a = positions[x].occupant;
    const b = positions[y].occupant;
    if (a?.group && a.group === b?.group) v.add(`rematch:${[a.ref, b!.ref].sort().join("|")}`);
  }
  const winnerHalf = new Map<string, number>();
  positions.forEach((p, i) => {
    if (p.occupant?.rank === 1 && p.occupant.group) winnerHalf.set(p.occupant.group, half[i]);
  });
  positions.forEach((p, i) => {
    const o = p.occupant;
    if (o?.rank === 2 && o.group && winnerHalf.get(o.group) === half[i]) v.add(`half:${o.group}`);
  });
  return v;
}

function clubClashes(positions: Position[], pairs: Array<[number, number]>): number {
  return pairs.filter(([x, y]) => sameClub(positions[x].occupant, positions[y].occupant)).length;
}

export function clubSuggestions(positions: Position[]): ClubSuggestion[] {
  const half = halves(positions);
  const pairs = firstMeetings(positions);
  const baseClashes = clubClashes(positions, pairs);
  const baseViolations = hardViolations(positions, pairs, half);
  const out: ClubSuggestion[] = [];
  const seen = new Set<string>();

  for (const [x, y] of pairs) {
    const A = positions[x].occupant!;
    const B = positions[y].occupant!;
    const sameGroup = !!A.group && A.group === B.group;
    if (!sameGroup && !sameClub(A, B)) continue;
    const kind: "group" | "club" = sameGroup ? "group" : "club";
    // Si los dos ya están en un partido en juego o en mesa, no hay nada que hacer.
    if (positions[x].locked && positions[y].locked) continue;
    const key = [A.ref, B.ref].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);

    // Se prueba mover primero al de peor puesto (2°, o semilla más alta).
    const order = [y, x].sort((i, j) => {
      const ri = positions[i].occupant!.rank ?? 3;
      const rj = positions[j].occupant!.rank ?? 3;
      return rj - ri || (positions[j].seed ?? 0) - (positions[i].seed ?? 0);
    });
    const quarter = (i: number) => {
      const p = positions[i];
      const m = p.round === 0 ? p.next_match_number ?? 0 : p.match_number;
      const firstRound = positions.filter((q) => q.round === 1).length / 2;
      return Math.ceil(m / Math.max(1, firstRound / 4));
    };
    const found: Array<{ move: number; with: number; score: number; fixedClubs: number; fixedGroups: number; sameQuarter: boolean }> = [];
    order.forEach((mover, moverIndex) => {
      if (positions[mover].locked) return;
      const M = positions[mover];
      positions.forEach((T, t) => {
        if (t === mover || T.locked || !T.occupant || t === x || t === y) return;
        if (T.round !== M.round) return;
        if ((T.occupant.rank ?? 0) !== (M.occupant!.rank ?? 0)) return;
        if (M.occupant!.rank === 1 && M.seed !== null && T.seed !== null && seedBand(M.seed) !== seedBand(T.seed)) return;
        // Probar el cambio.
        const tmp = positions[mover].occupant;
        positions[mover].occupant = positions[t].occupant;
        positions[t].occupant = tmp;
        const clashes = clubClashes(positions, pairs);
        const violations = hardViolations(positions, pairs, half);
        positions[t].occupant = positions[mover].occupant;
        positions[mover].occupant = tmp;
        // Nunca crea un problema nuevo (aunque arregle otro), y tiene que
        // arreglar ESTE: que esos dos dejen de cruzarse.
        if ([...violations].some((k) => !baseViolations.has(k))) return;
        if (kind === "group" ? violations.has(`rematch:${key}`) || clashes > baseClashes : clashes >= baseClashes) return;
        const fixedGroups = baseViolations.size - violations.size;
        // Más recomendado, en este orden:
        //  1) el que arregla más problemas en total (cruces de club + revanchas de grupo);
        //  2) mover al de peor puesto (el 2° antes que el 1°);
        //  3) que no salga de su cuarto de llave;
        //  4) el lugar más parecido al suyo (semilla cercana).
        const fixedClubs = baseClashes - clashes;
        const sameQuarter = quarter(mover) === quarter(t);
        const score =
          -(fixedClubs + fixedGroups) * 100000 +
          moverIndex * 10000 +
          (sameQuarter ? 0 : 1000) +
          Math.abs((M.seed ?? 500) - (T.seed ?? 500));
        found.push({ move: mover, with: t, score, fixedClubs, fixedGroups, sameQuarter });
      });
    });
    const options: SwapOption[] = found
      .sort((p, q) => p.score - q.score)
      .slice(0, MAX_OPTIONS)
      .map((pick) => ({
        reason:
          pick.fixedGroups - (kind === "group" ? 1 : 0) > 0
            ? `Además saca a ${positions[pick.with].occupant!.name} de un partido contra alguien de su mismo grupo.`
            : pick.fixedClubs - (kind === "club" ? 1 : 0) > 0
              ? "Además arregla un cruce del mismo club."
              : pick.sameQuarter
                ? "Es el cambio más chico: nadie sale de su cuarto de llave."
                : "Es el cambio que menos desordena la llave.",
        // Cada uno pasa al puesto del otro.
        move: {
          ref: positions[pick.move].occupant!.ref,
          name: positions[pick.move].occupant!.name,
          club: positions[pick.move].occupant!.clubName,
          to: destination(positions, pick.with, positions[pick.move].occupant!),
        },
        with: {
          ref: positions[pick.with].occupant!.ref,
          name: positions[pick.with].occupant!.name,
          club: positions[pick.with].occupant!.clubName,
          to: destination(positions, pick.move, positions[pick.with].occupant!),
        },
      }));
    out.push({
      kind,
      a: { ref: A.ref, name: A.name, club: A.clubName },
      b: { ref: B.ref, name: B.name, club: B.clubName },
      clubName: A.clubName ?? "mismo club",
      groupName: sameGroup ? A.groupName ?? null : null,
      swap: options[0] ?? null,
      options,
    });
  }
  return out.sort((p, q) => (p.kind === q.kind ? 0 : p.kind === "group" ? -1 : 1));
}
