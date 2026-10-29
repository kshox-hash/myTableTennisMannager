export type QualificationType =
  | "group"
  | "direct_advance"
  | "manual"
  | "late_entry"
  | "playoff_two_players";

export type CompetitionPlayerInput = {
  id_user: string;
  ranking_points: number | null;
  ranking_position: number | null;
  seed_number: number | null;
  club_name: string | null;
  qualification_type: QualificationType;
};

export type GroupStatus = "draft" | "active" | "finished";
export type AssignmentType = "auto" | "manual";
export type MatchStatus = "scheduled" | "played" | "walkover";
export type MatchStage = "group";
export type SourceNote = "group_stage" | "two_player_group";

export type GeneratedGroup = {
  temp_group_id: string;
  group_name: string;
  target_size: 2 | 3 | 4;
  sort_order: number;
  status: GroupStatus;
  group_kind: "normal" | "manual" | "playoff_two";
  /** Clasificados de este grupo si no es el de la categoría (grupos divididos: 2). */
  qualifiers_override?: number;
  /** De qué grupo del plan base sale (para "Dividir en 2 de 2" / "Unir"). */
  base_index: number;
  /** Si viene de dividir un grupo de 4 en dos de 2. */
  is_split: boolean;
};

export type GeneratedGroupMember = {
  temp_group_id: string;
  id_user: string;
  seed: number | null;
  assignment_type: AssignmentType;
  // Puesto del jugador DENTRO del grupo (1, 2, 3...) — mismo orden que usa
  // generateRoundRobinMatches para armar los partidos, no la semilla global.
  group_position: number;
};

export type GeneratedStanding = {
  temp_group_id: string;
  id_user: string;
  played: number;
  won: number;
  lost: number;
  sets_for: number;
  sets_against: number;
  points_for: number;
  points_against: number;
  position: number | null;
  qualified_to_bracket: boolean;
  qualification_label: "first" | "second" | null;
};

export type GeneratedMatch = {
  temp_match_id: string;
  temp_group_id: string;
  stage: MatchStage;
  round_number: number;
  match_number: number;
  best_of_sets: 1 | 3 | 5 | 7;
  points_per_set: 11 | 21;
  player1_id: string;
  player2_id: string;
  status: MatchStatus;
  source_note: SourceNote;
};

export type GeneratedGroupsResult = {
  groups: GeneratedGroup[];
  members: GeneratedGroupMember[];
  standings: GeneratedStanding[];
  matches: GeneratedMatch[];
  /** Categoría Oro (preferFours): jugador que sobró tras armar grupos de 4
   *  y pasa directo a la llave sin jugar fase de grupos (ver generateGroupsFromPlayers). */
  directAdvancePlayers: string[];
};

type InternalGroupBucket = {
  temp_group_id: string;
  group_name: string;
  target_size: 2 | 3 | 4;
  sort_order: number;
  status: GroupStatus;
  group_kind: "normal" | "manual" | "playoff_two";
  players: CompetitionPlayerInput[];
};

type GenerateGroupsOptions = {
  bestOfGroups?: 1 | 3 | 5 | 7;
  pointsPerSet?: 11 | 21;
  /** Grupo único: todos los jugadores en un solo grupo (todos contra todos). */
  singleGroup?: boolean;
  /** Índices (del plan base) de grupos de 4 a dividir en dos grupos de 2. */
  splitFours?: number[];
  /** Categoría Oro (ver silver_category_id): fuerza grupos de 4. */
  preferFours?: boolean;
};

/**
 * Normaliza club.
 * null = sin club = no genera conflicto.
 */
function normalizeClubName(clubName: string | null): string | null {
  if (!clubName) return null;

  const normalized = clubName.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function buildGroupName(index: number): string {
  return `GR-${index + 1}`;
}

// Próximo nombre libre para un grupo MANUAL que se agrega aparte de los que
// ya existen (ver brackets_repository.createManualGroup) — a diferencia de
// buildGroupName (que siempre arranca en 0 porque asume que TODOS los
// grupos se arman de cero, como hace buildManualGroups/generateGroupsFromPlayers),
// acá hay que seguir la numeración desde donde quedaron los grupos ya
// creados. Toma el máximo "N" visto en cualquier "GR-N" existente y suma
// uno — no rellena huecos (si en algún momento se borra "GR-2" y quedan
// "GR-1"/"GR-3", el próximo es "GR-4", no "GR-2" de nuevo) para no arriesgar
// un choque de nombre con algo que ya se haya referenciado en otro lado
// (capturas de pantalla, notificaciones ya mandadas, etc.).
export function nextManualGroupName(existingGroupNames: string[]): string {
  let maxNum = 0;
  for (const name of existingGroupNames) {
    const match = /^GR-(\d+)$/.exec(name);
    if (!match) continue;
    const num = Number(match[1]);
    if (num > maxNum) maxNum = num;
  }
  return buildGroupName(maxNum);
}

function buildTempGroupId(index: number): string {
  return `group_${index + 1}`;
}

function buildTempMatchId(groupIndex: number, matchIndex: number): string {
  return `group_${groupIndex + 1}_match_${matchIndex + 1}`;
}

/**
 * Regla base acordada (spec "Proyecto de Sistema de Torneos TDM", Punto 2):
 * - grupos idealmente de 3
 * - si sobra 1 => el ÚLTIMO grupo pasa a 4
 * - si sobran 2 => se arma un grupo de 2 aparte (prioridad a los grupos de 3:
 *   con 14 jugadores, 3+3+3+3+2 y no 3+3+4+4 — pedido del organizador,
 *   2026-10-11: menos partidos). En ese grupo de 2 clasifican los dos.
 * - si sobran 0 => todos de 3
 *
 * Casos mínimos:
 * - 2 jugadores => [2]
 * - 3 jugadores => [3]
 * - 4 jugadores => [4]
 */
export function calculateGroupPlan(totalPlayers: number): Array<2 | 3 | 4> {
  if (totalPlayers < 2) {
    throw new Error("Se requieren al menos 2 jugadores para generar grupos");
  }

  if (totalPlayers === 2) return [2];
  if (totalPlayers === 3) return [3];
  if (totalPlayers === 4) return [4];

  const baseGroups = Math.floor(totalPlayers / 3);
  const remainder = totalPlayers % 3;

  if (remainder === 0) {
    return Array(baseGroups).fill(3) as Array<2 | 3 | 4>;
  }

  const groups = Array(baseGroups).fill(3) as Array<2 | 3 | 4>;

  if (remainder === 1) {
    groups[groups.length - 1] = 4;
    return groups;
  }

  // remainder === 2: un grupo de 2 aparte (prioridad a los grupos de 3).
  groups.push(2);
  return groups;
}

/**
 * Igual que calculateGroupPlan, pero priorizando grupos de 4 en vez de 3 —
 * para categorías Oro (ver silver_category_id): con qualifiers_per_group=2,
 * un grupo de 4 deja siempre 2 arriba (Oro) y 2 abajo (Plata). El remanente
 * (cuando el total no es múltiplo de 4) se absorbe con como máximo un grupo
 * de 3 y/o uno de 2, nunca agrandando o encogiendo los grupos de 4.
 *
 * - sobran 0 => todos de 4
 * - sobran 1 => un 4 menos, + un grupo de 3 y uno de 2 (3+2 = 4+1)
 * - sobran 2 => + un grupo de 2
 * - sobran 3 => + un grupo de 3
 */
export function calculateGroupPlanPreferFours(totalPlayers: number): Array<2 | 3 | 4> {
  if (totalPlayers < 2) {
    throw new Error("Se requieren al menos 2 jugadores para generar grupos");
  }

  if (totalPlayers === 2) return [2];
  if (totalPlayers === 3) return [3];
  if (totalPlayers === 4) return [4];

  const baseGroups = Math.floor(totalPlayers / 4);
  const remainder = totalPlayers % 4;

  if (remainder === 0) {
    return Array(baseGroups).fill(4) as Array<2 | 3 | 4>;
  }

  if (remainder === 1) {
    const groups = Array(baseGroups - 1).fill(4) as Array<2 | 3 | 4>;
    groups.push(3, 2);
    return groups;
  }

  const groups = Array(baseGroups).fill(4) as Array<2 | 3 | 4>;
  groups.push(remainder === 2 ? 2 : 3);
  return groups;
}

/**
 * Plan de grupos con divisiones elegidas por el organizador: cada índice de
 * `splitFours` (posición en el plan base) que sea un grupo de 4 se reemplaza
 * por dos grupos de 2 — más rápido (2 partidos en vez de 6) y, en esos
 * grupos, clasifican los dos (ver qualifiers_override).
 * `source[i]` dice de qué grupo del plan base sale cada grupo final, y
 * `split[i]` si viene de una división.
 * `preferFours`: ver calculateGroupPlanPreferFours (categorías Oro).
 */
export function buildGroupPlan(
  totalPlayers: number,
  splitFours: number[] = [],
  preferFours = false
): { plan: Array<2 | 3 | 4>; source: number[]; split: boolean[] } {
  const base = preferFours ? calculateGroupPlanPreferFours(totalPlayers) : calculateGroupPlan(totalPlayers);
  const toSplit = new Set(splitFours);
  const plan: Array<2 | 3 | 4> = [];
  const source: number[] = [];
  const split: boolean[] = [];
  base.forEach((size, i) => {
    if (size === 4 && toSplit.has(i)) {
      plan.push(2, 2);
      source.push(i, i);
      split.push(true, true);
    } else {
      plan.push(size);
      source.push(i);
      split.push(false);
    }
  });
  return { plan, source, split };
}

/**
 * Orden competitivo:
 * 1) ranking_points DESC
 * 2) ranking_position ASC
 * 3) seed_number ASC
 * 4) id_user ASC
 *
 * null queda al final.
 */
export function sortPlayersForGrouping(
  players: CompetitionPlayerInput[]
): CompetitionPlayerInput[] {
  return [...players].sort((a, b) => {
    const aPoints = a.ranking_points ?? Number.NEGATIVE_INFINITY;
    const bPoints = b.ranking_points ?? Number.NEGATIVE_INFINITY;

    if (aPoints !== bPoints) {
      return bPoints - aPoints;
    }

    const aPos = a.ranking_position ?? Number.POSITIVE_INFINITY;
    const bPos = b.ranking_position ?? Number.POSITIVE_INFINITY;

    if (aPos !== bPos) {
      return aPos - bPos;
    }

    const aSeed = a.seed_number ?? Number.POSITIVE_INFINITY;
    const bSeed = b.seed_number ?? Number.POSITIVE_INFINITY;

    if (aSeed !== bSeed) {
      return aSeed - bSeed;
    }

    return a.id_user.localeCompare(b.id_user);
  });
}

/**
 * Serpentina clásica:
 * grupos GR-1..GR-4 y luego GR-4..GR-1, y así sucesivamente.
 *
 * Ejemplo con 4 grupos y 10 jugadores:
 * [0,1,2,3,3,2,1,0,0,1]
 */
export function buildSerpentineGroupOrder(
  groupCount: number,
  totalPlayers: number
): number[] {
  const order: number[] = [];
  let direction: "forward" | "backward" = "forward";

  while (order.length < totalPlayers) {
    if (direction === "forward") {
      for (let i = 0; i < groupCount && order.length < totalPlayers; i++) {
        order.push(i);
      }
      direction = "backward";
    } else {
      for (let i = groupCount - 1; i >= 0 && order.length < totalPlayers; i--) {
        order.push(i);
      }
      direction = "forward";
    }
  }

  return order;
}

function createEmptyBuckets(plan: Array<2 | 3 | 4>): InternalGroupBucket[] {
  return plan.map((size, index) => ({
    temp_group_id: buildTempGroupId(index),
    group_name: buildGroupName(index),
    target_size: size,
    sort_order: index + 1,
    status: "draft",
    group_kind: size === 2 ? "playoff_two" : "normal",
    players: [],
  }));
}

function groupHasCapacity(group: InternalGroupBucket): boolean {
  return group.players.length < group.target_size;
}

function groupHasSameClub(
  group: InternalGroupBucket,
  player: CompetitionPlayerInput
): boolean {
  const playerClub = normalizeClubName(player.club_name);

  if (!playerClub) return false;

  return group.players.some(
    (existing) => normalizeClubName(existing.club_name) === playerClub
  );
}

/**
 * Selección básica:
 * 1) intenta el grupo sugerido por serpentina
 * 2) si hay choque de club, busca otro grupo con cupo y sin choque
 * 3) si hay varias opciones, toma la más cercana
 * 4) si no hay forma de evitar club, cae al grupo sugerido o al primer grupo libre
 *
 * Esta lógica es una base y puede ajustarse después.
 */
function pickBestGroupIndex(
  groups: InternalGroupBucket[],
  suggestedIndex: number,
  player: CompetitionPlayerInput
): number {
  const suggestedGroup = groups[suggestedIndex];

  if (
    groupHasCapacity(suggestedGroup) &&
    !groupHasSameClub(suggestedGroup, player)
  ) {
    return suggestedIndex;
  }

  const cleanCandidates = groups
    .map((group, index) => ({ group, index }))
    .filter(
      ({ group }) =>
        groupHasCapacity(group) && !groupHasSameClub(group, player)
    )
    .sort((a, b) => {
      const distA = Math.abs(a.index - suggestedIndex);
      const distB = Math.abs(b.index - suggestedIndex);

      if (distA !== distB) return distA - distB;
      return a.group.players.length - b.group.players.length;
    });

  if (cleanCandidates.length > 0) {
    return cleanCandidates[0].index;
  }

  if (groupHasCapacity(suggestedGroup)) {
    return suggestedIndex;
  }

  const fallback = groups
    .map((group, index) => ({ group, index }))
    .filter(({ group }) => groupHasCapacity(group))
    .sort((a, b) => {
      const distA = Math.abs(a.index - suggestedIndex);
      const distB = Math.abs(b.index - suggestedIndex);

      if (distA !== distB) return distA - distB;
      return a.group.players.length - b.group.players.length;
    });

  if (fallback.length === 0) {
    throw new Error("No hay grupos disponibles para asignar jugadores");
  }

  return fallback[0].index;
}

/**
 * Distribución principal:
 * - ordena por ranking
 * - aplica serpentina
 * - intenta evitar mismo club si puede
 */
export function assignPlayersToGroups(
  players: CompetitionPlayerInput[],
  plan: Array<2 | 3 | 4>
): InternalGroupBucket[] {
  const groups = createEmptyBuckets(plan);
  const order = buildSerpentineGroupOrder(groups.length, players.length);

  players.forEach((player, playerIndex) => {
    const suggestedIndex = order[playerIndex];
    const chosenIndex = pickBestGroupIndex(groups, suggestedIndex, player);
    groups[chosenIndex].players.push(player);
  });

  return groups;
}

/**
 * Todos contra todos dentro del grupo.
 * - grupo de 2 => 1 partido
 * - grupo de 3 => 3 partidos
 * - grupo de 4 => 6 partidos
 */
export function generateRoundRobinMatches(
  group: InternalGroupBucket,
  groupIndex: number,
  bestOfSets: 1 | 3 | 5 | 7,
  pointsPerSet: 11 | 21 = 11
): GeneratedMatch[] {
  const matches: GeneratedMatch[] = [];
  let matchNumber = 1;

  // Orden de papeleta: el jugador 1 juega primero contra el último del
  // grupo y va bajando (1vN, 1v(N-1), ..., 1v2), luego el 2 contra los que
  // quedan de mayor a menor, y así — no el orden lexicográfico simple
  // (1v2, 1v3, ..., 2v3) que daría el loop ascendente de siempre.
  for (let i = 0; i < group.players.length; i++) {
    for (let j = group.players.length - 1; j > i; j--) {
      matches.push({
        temp_match_id: buildTempMatchId(groupIndex, matchNumber - 1),
        temp_group_id: group.temp_group_id,
        stage: "group",
        round_number: 1,
        match_number: matchNumber,
        best_of_sets: bestOfSets,
        points_per_set: pointsPerSet,
        player1_id: group.players[i].id_user,
        player2_id: group.players[j].id_user,
        status: "scheduled",
        source_note:
          group.target_size === 2 ? "two_player_group" : "group_stage",
      });

      matchNumber++;
    }
  }

  return matches;
}

function buildMembers(
  group: InternalGroupBucket,
  assignmentType: AssignmentType = "auto"
): GeneratedGroupMember[] {
  return group.players.map((player, index) => ({
    temp_group_id: group.temp_group_id,
    id_user: player.id_user,
    seed: player.seed_number ?? null,
    assignment_type: assignmentType,
    group_position: index + 1,
  }));
}

function buildStandings(group: InternalGroupBucket): GeneratedStanding[] {
  return group.players.map((player) => ({
    temp_group_id: group.temp_group_id,
    id_user: player.id_user,
    played: 0,
    won: 0,
    lost: 0,
    sets_for: 0,
    sets_against: 0,
    points_for: 0,
    points_against: 0,
    position: null,
    qualified_to_bracket: false,
    qualification_label: null,
  }));
}

/**
 * Función principal para discutir y ajustar con el equipo.
 */
export function generateGroupsFromPlayers(
  rawPlayers: CompetitionPlayerInput[],
  options?: GenerateGroupsOptions
): GeneratedGroupsResult {
  if (!Array.isArray(rawPlayers) || rawPlayers.length < 2) {
    throw new Error("Se requieren al menos 2 jugadores para generar grupos");
  }

  const bestOfSets = options?.bestOfGroups ?? 3;
  const pointsPerSet = options?.pointsPerSet ?? 11;
  const preferFours = options?.preferFours ?? false;

  const sortedPlayers = sortPlayersForGrouping(rawPlayers);

  // Categoría Oro (preferFours): si sobra exactamente 1 jugador después de
  // armar todos los grupos de 4 posibles, ese jugador no puede jugar un
  // grupo de 1 (no hay contra quién) — pasa directo a la llave de Oro sin
  // jugar fase de grupos, como un pase directo más (ver
  // BracketsRepository.markDirectAdvance). Se saca al último del orden
  // competitivo (peor ranking/semilla) para no sacar de los grupos reales a
  // alguien mejor ubicado.
  let directAdvancePlayers: CompetitionPlayerInput[] = [];
  let groupingPlayers = sortedPlayers;
  if (preferFours && !options?.singleGroup && sortedPlayers.length > 4 && sortedPlayers.length % 4 === 1) {
    directAdvancePlayers = sortedPlayers.slice(-1);
    groupingPlayers = sortedPlayers.slice(0, -1);
  }

  // Grupo único (competition_format = round_robin): todos en un grupo.
  // target_size no tiene tope en la base (solo >= 0).
  const built = options?.singleGroup
    ? { plan: [groupingPlayers.length] as Array<2 | 3 | 4>, source: [0], split: [false] }
    : buildGroupPlan(groupingPlayers.length, options?.splitFours ?? [], preferFours);
  const buckets = assignPlayersToGroups(groupingPlayers, built.plan);

  const groups: GeneratedGroup[] = buckets.map((group, i) => ({
    temp_group_id: group.temp_group_id,
    group_name: group.group_name,
    target_size: group.target_size,
    sort_order: group.sort_order,
    status: group.status,
    group_kind: group.group_kind,
    base_index: built.source[i],
    is_split: built.split[i],
    // Grupos de 2 (los que salen de dividir uno de 4, o el que sobra al
    // armar los grupos): un solo partido y clasifican los dos.
    ...(built.split[i] || group.target_size === 2 ? { qualifiers_override: 2 } : {}),
  }));

  const members: GeneratedGroupMember[] = buckets.flatMap((group) =>
    buildMembers(group)
  );

  const standings: GeneratedStanding[] = buckets.flatMap((group) =>
    buildStandings(group)
  );

  const matches: GeneratedMatch[] = buckets.flatMap((group, index) =>
    generateRoundRobinMatches(group, index, bestOfSets, pointsPerSet)
  );

  return {
    groups,
    members,
    standings,
    matches,
    directAdvancePlayers: directAdvancePlayers.map((p) => p.id_user),
  };
}

/**
 * Igual que generateGroupsFromPlayers, pero la composición de cada grupo la
 * define el admin (no el algoritmo de ranking/serpentina) — para corregir a
 * mano un armado que no quedó como se esperaba, o replicar un sorteo hecho
 * por fuera del sistema. Cada sub-array de `groups` es un grupo completo, en
 * el orden en que se van a nombrar (GR-1, GR-2, GR-3...).
 */
export function buildManualGroups(
  groups: CompetitionPlayerInput[][],
  bestOfSets: 1 | 3 | 5 | 7 = 3,
  pointsPerSet: 11 | 21 = 11
): GeneratedGroupsResult {
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new Error("Se requiere al menos un grupo");
  }
  for (const players of groups) {
    if (players.length < 2 || players.length > 4) {
      throw new Error("Cada grupo debe tener entre 2 y 4 jugadores");
    }
  }

  const buckets: InternalGroupBucket[] = groups.map((players, index) => ({
    temp_group_id: buildTempGroupId(index),
    group_name: buildGroupName(index),
    target_size: players.length as 2 | 3 | 4,
    sort_order: index + 1,
    status: "draft",
    group_kind: players.length === 2 ? "playoff_two" : "normal",
    players,
  }));

  return {
    groups: buckets.map((group, i) => ({
      temp_group_id: group.temp_group_id,
      group_name: group.group_name,
      target_size: group.target_size,
      sort_order: group.sort_order,
      status: group.status,
      group_kind: group.group_kind,
      base_index: i,
      is_split: false,
    })),
    members: buckets.flatMap((group) => buildMembers(group, "manual")),
    standings: buckets.flatMap((group) => buildStandings(group)),
    matches: buckets.flatMap((group, index) => generateRoundRobinMatches(group, index, bestOfSets, pointsPerSet)),
    directAdvancePlayers: [],
  };
}