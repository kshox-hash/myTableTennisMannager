import { generateGroupsFromPlayers, buildManualGroups } from "../group_generation_logic";
import {
  drawBracketSlotsForGroups,
  buildBracketWithPreRound,
  getPhysicalDisplayOrder,
  getSeedPositions,
  type DrawnSlot,
  type GroupSeededEntry,
} from "../bracket_generation_logic";
import { BracketsRepository } from "./brackets_repository";
import {
  BRACKETS_ERRORS,
  type BracketsError,
  type CategoryGroupsView,
  type BracketView,
  type BracketPreview,
  type BracketSlotAssignmentInput,
  type MoveGroupMemberInput,
  type GroupsPreview,
  type GroupOrderInput,
} from "./dto/brackets_dto";
import type {
  GenerateGroupsInput,
  MatchResultInput,
  GenerateBracketInput,
} from "./schema/brackets_schema";
import { type Result, ok, fail } from "../core/constants/result";

// Si vienen los puntajes por set, deben ser consistentes con los sets ganados declarados
// (ningún set puede terminar empatado, y la cuenta de sets ganados por cada uno debe calzar).
// Un set de tenis de mesa se gana con 11 puntos, salvo que quede 10-10 (o
// más), caso en el que se gana por una diferencia de 2 puntos (deuce). Por
// ejemplo 11-9 es válido, pero 11-10 no lo es: el set debía seguir hasta
// 12-10, 13-11, etc.
function isLegalSetScore(p1: number, p2: number): boolean {
  if (p1 === p2) return false;
  const winner = Math.max(p1, p2);
  const loser = Math.min(p1, p2);
  if (winner < 11) return false;
  if (winner === 11) return loser <= 9;
  return loser === winner - 2;
}

function setScoresMatchAggregate(
  setScores: Array<{ p1: number; p2: number }> | undefined,
  setsPlayer1: number,
  setsPlayer2: number
): boolean {
  if (!setScores || setScores.length === 0) return true;

  let p1Wins = 0;
  let p2Wins = 0;
  for (const s of setScores) {
    if (!isLegalSetScore(s.p1, s.p2)) return false;
    if (s.p1 > s.p2) p1Wins++;
    else p2Wins++;
  }

  return p1Wins === setsPlayer1 && p2Wins === setsPlayer2;
}

// Suma los puntos reales de juego (no los sets) a partir del detalle set por set.
function sumRallyPoints(
  setScores: Array<{ p1: number; p2: number }> | undefined
): { p1: number; p2: number } {
  if (!setScores) return { p1: 0, p2: 0 };
  return setScores.reduce(
    (acc, s) => ({ p1: acc.p1 + s.p1, p2: acc.p2 + s.p2 }),
    { p1: 0, p2: 0 }
  );
}

export class BracketsService {
  constructor(private repo: BracketsRepository) {}

  // ─── GRUPOS ──────────────────────────────────────────────

  // Previsualiza la composición de los grupos (algoritmo real de
  // ranking/serpentina) SIN persistir nada — para la pantalla de fixture
  // donde el admin elige el orden de juego antes de confirmar. El algoritmo
  // es determinístico (sin sorteo/azar), así que no hace falta que el
  // admin mande de vuelta la composición al confirmar: alcanza con volver a
  // correrlo (ver generateGroups más abajo).
  async previewGroups(
    tournamentId: string,
    categoryId: string
  ): Promise<Result<GroupsPreview, BracketsError>> {
    const alreadyExist = await this.repo.groupsExist(tournamentId, categoryId);
    if (alreadyExist) return fail(BRACKETS_ERRORS.GROUPS_ALREADY_EXIST);

    const players = await this.repo.loadPlayersForCategory(tournamentId, categoryId);
    if (players.length < 2) return fail(BRACKETS_ERRORS.NOT_ENOUGH_PLAYERS);

    const generated = generateGroupsFromPlayers(players, { bestOfGroups: 3 });

    const names = await this.repo.getUserNames(generated.members.map((m) => m.id_user));
    const nameFields = (idUser: string) => {
      const n = names.get(idUser);
      return { first_name: n?.first_name ?? null, last_name: n?.last_name ?? null, email: n?.email ?? "" };
    };
    const rankingByUser = new Map(players.map((p) => [p.id_user, p]));
    const rankingFields = (idUser: string) => {
      const p = rankingByUser.get(idUser);
      return { ranking_points: p?.ranking_points ?? null, ranking_position: p?.ranking_position ?? null };
    };

    return ok({
      groups: generated.groups.map((g) => ({
        group_name: g.group_name,
        sort_order: g.sort_order,
        target_size: g.target_size,
        group_kind: g.group_kind,
        members: generated.members
          .filter((m) => m.temp_group_id === g.temp_group_id)
          .map((m) => ({
            id_user: m.id_user,
            seed: m.seed,
            group_position: m.group_position,
            ...nameFields(m.id_user),
            ...rankingFields(m.id_user),
          })),
        matches: generated.matches
          .filter((m) => m.temp_group_id === g.temp_group_id)
          .map((m) => ({ match_number: m.match_number, player1_id: m.player1_id, player2_id: m.player2_id })),
      })),
    });
  }

  async generateGroups(
    tournamentId: string,
    categoryId: string,
    input: GenerateGroupsInput,
    groupOrder?: GroupOrderInput
  ): Promise<Result<CategoryGroupsView, BracketsError>> {
    const alreadyExist = await this.repo.groupsExist(tournamentId, categoryId);
    if (alreadyExist) return fail(BRACKETS_ERRORS.GROUPS_ALREADY_EXIST);

    const players = await this.repo.loadPlayersForCategory(tournamentId, categoryId);
    if (players.length < 2) return fail(BRACKETS_ERRORS.NOT_ENOUGH_PLAYERS);

    const generated = generateGroupsFromPlayers(players, {
      bestOfGroups: input.best_of_sets ?? 3,
    });

    if (groupOrder) {
      // Confirmando un fixture ya previsualizado: el orden elegido debe
      // cubrir exactamente los mismos grupos que arma el algoritmo ahora
      // mismo — si no, algo cambió entre previsualizar y confirmar (p.ej.
      // se agregó/sacó un inscrito) y hay que volver a previsualizar.
      const currentNames = new Set(generated.groups.map((g) => g.group_name));
      const givenNames = new Set(groupOrder);
      const sameSet = currentNames.size === givenNames.size && [...currentNames].every((n) => givenNames.has(n));
      if (!sameSet) return fail(BRACKETS_ERRORS.GROUPS_OUT_OF_DATE);

      for (const group of generated.groups) {
        group.sort_order = groupOrder.indexOf(group.group_name) + 1;
      }
    }

    const qualifiersPerGroup = await this.repo.getCategoryQualifiersPerGroup(categoryId);
    await this.repo.persistGroups(tournamentId, categoryId, generated, qualifiersPerGroup);

    const names = await this.repo.getTournamentCategoryNames(tournamentId, categoryId);
    if (names) {
      await this.repo.notifications.createForMany(
        players.map((p) => p.id_user),
        {
          type: "groups_started",
          title: "Arrancó la fase de grupos",
          message: `Ya se generaron los grupos de ${names.categoryType} ${names.categoryRange} (${names.tournamentName}). Revisá tu grupo y tus partidos.`,
          idTournament: tournamentId,
          idCategory: categoryId,
        }
      );
    }

    return this.getGroups(tournamentId, categoryId);
  }

  // Rearma los grupos de cero con TODOS los inscritos activos actuales (incluye
  // los agregados después de la primera generación). Solo mientras nadie haya
  // jugado todavía ningún partido de grupo — si ya hay resultados cargados, no
  // se puede tocar sin perderlos.
  async regenerateGroups(
    tournamentId: string,
    categoryId: string,
    input: GenerateGroupsInput
  ): Promise<Result<CategoryGroupsView, BracketsError>> {
    const exists = await this.repo.groupsExist(tournamentId, categoryId);
    if (!exists) return fail(BRACKETS_ERRORS.GROUP_NOT_FOUND);

    const anyPlayed = await this.repo.anyGroupMatchPlayed(categoryId);
    if (anyPlayed) return fail(BRACKETS_ERRORS.MATCHES_ALREADY_PLAYED);

    const players = await this.repo.loadPlayersForCategory(tournamentId, categoryId);
    if (players.length < 2) return fail(BRACKETS_ERRORS.NOT_ENOUGH_PLAYERS);

    const generated = generateGroupsFromPlayers(players, {
      bestOfGroups: input.best_of_sets ?? 3,
    });

    const qualifiersPerGroup = await this.repo.getCategoryQualifiersPerGroup(categoryId);
    await this.repo.regenerateGroups(tournamentId, categoryId, generated, qualifiersPerGroup);

    const names = await this.repo.getTournamentCategoryNames(tournamentId, categoryId);
    if (names) {
      await this.repo.notifications.createForMany(
        players.map((p) => p.id_user),
        {
          type: "groups_started",
          title: "Se rearmaron los grupos",
          message: `Se volvieron a armar los grupos de ${names.categoryType} ${names.categoryRange} (${names.tournamentName}) con los inscritos actuales. Revisá tu grupo y tus partidos.`,
          idTournament: tournamentId,
          idCategory: categoryId,
        }
      );
    }

    return this.getGroups(tournamentId, categoryId);
  }

  // Rearma los grupos con la composición exacta que definió el admin (no el
  // algoritmo de ranking/serpentina) — para replicar un sorteo externo o
  // corregir a mano un armado que no quedó como se esperaba. Cada sub-array
  // de `groups` es un grupo completo (2 a 4 ids), en el orden A, B, C...
  // Debe cubrir exactamente a todos los inscritos activos con qualification
  // "group" de la categoría: ni de más ni de menos.
  async setGroupsManual(
    tournamentId: string,
    categoryId: string,
    input: { groups: string[][]; bestOfSets?: 3 | 5 | 7 }
  ): Promise<Result<CategoryGroupsView, BracketsError>> {
    const exists = await this.repo.groupsExist(tournamentId, categoryId);
    if (!exists) return fail(BRACKETS_ERRORS.GROUP_NOT_FOUND);

    const anyPlayed = await this.repo.anyGroupMatchPlayed(categoryId);
    if (anyPlayed) return fail(BRACKETS_ERRORS.MATCHES_ALREADY_PLAYED);

    if (input.groups.some((g) => g.length < 2 || g.length > 4)) {
      return fail(BRACKETS_ERRORS.INVALID_GROUP_SIZE);
    }

    const flatIds = input.groups.flat();
    if (new Set(flatIds).size !== flatIds.length) {
      return fail(BRACKETS_ERRORS.DUPLICATE_PLAYER);
    }

    const players = await this.repo.loadPlayersForCategory(tournamentId, categoryId);
    const playerById = new Map(players.map((p) => [p.id_user, p]));

    if (flatIds.some((id) => !playerById.has(id))) {
      return fail(BRACKETS_ERRORS.INVALID_PLAYER);
    }
    if (flatIds.length !== players.length) {
      return fail(BRACKETS_ERRORS.PLAYERS_MISSING);
    }

    const groupBuckets = input.groups.map((ids) => ids.map((id) => playerById.get(id)!));
    const generated = buildManualGroups(groupBuckets, input.bestOfSets ?? 3);

    const qualifiersPerGroup = await this.repo.getCategoryQualifiersPerGroup(categoryId);
    await this.repo.regenerateGroups(tournamentId, categoryId, generated, qualifiersPerGroup);

    const names = await this.repo.getTournamentCategoryNames(tournamentId, categoryId);
    if (names) {
      await this.repo.notifications.createForMany(flatIds, {
        type: "groups_started",
        title: "Se rearmaron los grupos",
        message: `El organizador rearmó manualmente los grupos de ${names.categoryType} ${names.categoryRange} (${names.tournamentName}). Revisá tu grupo y tus partidos.`,
        idTournament: tournamentId,
        idCategory: categoryId,
      });
    }

    return this.getGroups(tournamentId, categoryId);
  }

  // Ajuste manual de clasificados de un grupo puntual (no afecta el default
  // de la categoría ni al resto de los grupos ya generados).
  async updateGroupQualifiers(
    groupId: string,
    qualifiersPerGroup: number
  ): Promise<Result<{ updated: true }, BracketsError>> {
    const updated = await this.repo.setGroupQualifiers(groupId, qualifiersPerGroup);
    if (!updated) return fail(BRACKETS_ERRORS.GROUP_NOT_FOUND);
    return ok({ updated: true });
  }

  // Árbitro sugerido/anotado para un partido puntual (no es un rol oficial:
  // cualquier inscrito puede quedar anotado, o se puede dejar en blanco).
  async setGroupMatchReferee(
    matchId: string,
    refereeId: string | null
  ): Promise<Result<{ updated: true }, BracketsError>> {
    const updated = await this.repo.setGroupMatchReferee(matchId, refereeId);
    if (!updated) return fail(BRACKETS_ERRORS.MATCH_NOT_FOUND);
    return ok({ updated: true });
  }

  async setBracketMatchReferee(
    matchId: string,
    refereeId: string | null
  ): Promise<Result<{ updated: true }, BracketsError>> {
    const updated = await this.repo.setBracketMatchReferee(matchId, refereeId);
    if (!updated) return fail(BRACKETS_ERRORS.MATCH_NOT_FOUND);
    return ok({ updated: true });
  }

  // Mover manualmente a un jugador de un grupo a otro (fix de un error al armar los grupos).
  async moveGroupMember(
    input: MoveGroupMemberInput
  ): Promise<Result<{ moved: true }, BracketsError>> {
    const result = await this.repo.moveGroupMember(input);
    if (!result.moved) return fail(result.error);
    return ok({ moved: true });
  }

  // Agrega directamente a un jugador (ya inscrito) a un grupo puntual, sin
  // pasar por "rearmar grupos" ni "mover jugador".
  async addPlayerToGroup(
    groupId: string,
    userId: string
  ): Promise<Result<{ added: true }, BracketsError>> {
    const result = await this.repo.addPlayerToGroup({ groupId, userId });
    if (!result.added) return fail(result.error);
    return ok({ added: true });
  }

  async getGroups(
    tournamentId: string,
    categoryId: string
  ): Promise<Result<CategoryGroupsView, BracketsError>> {
    const { groups, members, standings, matches } =
      await this.repo.findGroupsByCategory(tournamentId, categoryId);

    const view: CategoryGroupsView = {
      groups: groups.map((g) => ({
        ...g,
        members:   members.filter((m) => m.id_group === g.id_group),
        standings: standings.filter((s) => s.id_group === g.id_group),
        matches:   matches.filter((m) => m.id_group === g.id_group),
      })),
    };

    return ok(view);
  }

  async recordResult(
    matchId: string,
    input: MatchResultInput
  ): Promise<Result<{ recorded: true; tournamentId: string; categoryId: string }, BracketsError>> {
    const match = await this.repo.findMatch(matchId);
    if (!match) return fail(BRACKETS_ERRORS.MATCH_NOT_FOUND);
    if (match.status !== "scheduled") return fail(BRACKETS_ERRORS.MATCH_ALREADY_PLAYED);

    const { winner_id, sets_player1, sets_player2, walkover = false, set_scores } = input;

    if (winner_id !== match.player1_id && winner_id !== match.player2_id) {
      return fail(BRACKETS_ERRORS.INVALID_WINNER);
    }

    if (!walkover) {
      const setsToWin = Math.ceil(match.best_of_sets / 2);
      const winnerSets = winner_id === match.player1_id ? sets_player1 : sets_player2;
      const loserSets  = winner_id === match.player1_id ? sets_player2 : sets_player1;
      if (winnerSets !== setsToWin || loserSets >= setsToWin) {
        return fail(BRACKETS_ERRORS.INVALID_SET_COUNT);
      }
      if (!setScoresMatchAggregate(set_scores, sets_player1, sets_player2)) {
        return fail(BRACKETS_ERRORS.INVALID_SET_COUNT);
      }
    }

    const loserId = winner_id === match.player1_id ? match.player2_id : match.player1_id;
    const rallyPoints = walkover ? { p1: 0, p2: 0 } : sumRallyPoints(set_scores);
    const winnerIsPlayer1 = winner_id === match.player1_id;

    await this.repo.recordMatchResult({
      matchId,
      groupId: match.id_group,
      winnerId: winner_id,
      loserId,
      setsPlayer1: sets_player1,
      setsPlayer2: sets_player2,
      walkover,
      setScores: walkover ? undefined : set_scores,
      winnerSetsFor:     winnerIsPlayer1 ? sets_player1 : sets_player2,
      winnerSetsAgainst: winnerIsPlayer1 ? sets_player2 : sets_player1,
      loserSetsFor:      winnerIsPlayer1 ? sets_player2 : sets_player1,
      loserSetsAgainst:  winnerIsPlayer1 ? sets_player1 : sets_player2,
      winnerPointsFor:     winnerIsPlayer1 ? rallyPoints.p1 : rallyPoints.p2,
      winnerPointsAgainst: winnerIsPlayer1 ? rallyPoints.p2 : rallyPoints.p1,
      loserPointsFor:      winnerIsPlayer1 ? rallyPoints.p2 : rallyPoints.p1,
      loserPointsAgainst:  winnerIsPlayer1 ? rallyPoints.p1 : rallyPoints.p2,
      tournamentId: match.id_tournament,
      categoryId: match.id_category,
    });

    return ok({ recorded: true, tournamentId: match.id_tournament, categoryId: match.id_category });
  }

  // Deshace un resultado de partido de grupo ya cargado (ej: error de digitación).
  // Solo mientras la categoría siga en fase "groups" — una vez generado el
  // cuadro eliminatorio, los clasificados ya quedaron fijados a partir de
  // estos resultados y deshacer uno rompería esa foto.
  async undoGroupMatchResult(
    matchId: string,
    requestedBy: string
  ): Promise<Result<{ undone: true; tournamentId: string; categoryId: string }, BracketsError>> {
    const match = await this.repo.findMatch(matchId);
    if (!match) return fail(BRACKETS_ERRORS.MATCH_NOT_FOUND);
    if (match.status === "scheduled") return fail(BRACKETS_ERRORS.MATCH_NOT_PLAYED);

    const phase = await this.repo.getCategoryPhase(match.id_category);
    if (phase !== "groups") return fail(BRACKETS_ERRORS.CATEGORY_ALREADY_ADVANCED);

    const winnerIsPlayer1 = match.winner_id === match.player1_id;
    const loserId = winnerIsPlayer1 ? match.player2_id : match.player1_id;
    const walkover = match.status === "walkover";
    const rallyPoints = walkover ? { p1: 0, p2: 0 } : sumRallyPoints(match.set_scores ?? undefined);

    await this.repo.undoGroupMatchResult({
      matchId,
      groupId: match.id_group,
      winnerId: match.winner_id!,
      loserId,
      winnerSetsFor:     winnerIsPlayer1 ? match.sets_player1 : match.sets_player2,
      winnerSetsAgainst: winnerIsPlayer1 ? match.sets_player2 : match.sets_player1,
      loserSetsFor:      winnerIsPlayer1 ? match.sets_player2 : match.sets_player1,
      loserSetsAgainst:  winnerIsPlayer1 ? match.sets_player1 : match.sets_player2,
      winnerPointsFor:     winnerIsPlayer1 ? rallyPoints.p1 : rallyPoints.p2,
      winnerPointsAgainst: winnerIsPlayer1 ? rallyPoints.p2 : rallyPoints.p1,
      loserPointsFor:      winnerIsPlayer1 ? rallyPoints.p2 : rallyPoints.p1,
      loserPointsAgainst:  winnerIsPlayer1 ? rallyPoints.p1 : rallyPoints.p2,
      walkover,
      tournamentId: match.id_tournament,
      requestedBy,
    });

    return ok({ undone: true, tournamentId: match.id_tournament, categoryId: match.id_category });
  }

  // ─── CUADRO ELIMINATORIO ─────────────────────────────────

  // Clasificados de grupos + pases directos, en orden de semilla (index 0 =
  // semilla 1). Compartido por previewBracket y generateBracket para que
  // ambos partan siempre del mismo criterio. group_name/qualification_label
  // vienen null para los pases directos (no salieron de ningún grupo).
  private async loadSeededPlayers(
    tournamentId: string,
    categoryId: string
  ): Promise<
    Array<{
      id_user: string;
      group_name: string | null;
      qualification_label: "first" | "second" | null;
      id_club: string | null;
    }>
  > {
    const groupQualifiers = await this.repo.loadGroupQualifiers(tournamentId, categoryId);
    const directEntries = await this.repo.loadDirectEntryPlayers(tournamentId, categoryId);
    return [
      ...groupQualifiers.map((q) => ({
        id_user: q.id_user,
        group_name: q.group_name,
        qualification_label: (q.rank_in_group === 1 ? "first" : q.rank_in_group === 2 ? "second" : null) as
          | "first"
          | "second"
          | null,
        id_club: q.id_club,
      })),
      ...directEntries.map((e) => ({
        id_user: e.id_user,
        group_name: null,
        qualification_label: null,
        id_club: e.id_club,
      })),
    ];
  }

  private toGroupSeededEntries(
    seededPlayers: Array<{
      id_user: string;
      group_name: string | null;
      qualification_label: "first" | "second" | null;
      id_club: string | null;
    }>
  ): GroupSeededEntry[] {
    return seededPlayers.map((p) => ({
      id: p.id_user,
      groupName: p.group_name,
      rankInGroup: p.qualification_label === "first" ? 1 : p.qualification_label === "second" ? 2 : null,
      clubId: p.id_club,
    }));
  }

  // Previsualiza el sorteo (semillas fijas + BYE + sorteo por banda) SIN
  // persistir nada — el admin lo confirma después con generateBracket
  // pasándole el mismo `slotAssignment` que se le mostró, para que lo que
  // se ve en la previsualización sea exactamente lo que se guarda.
  async previewBracket(
    tournamentId: string,
    categoryId: string
  ): Promise<Result<BracketPreview, BracketsError>> {
    const exists = await this.repo.bracketExists(tournamentId, categoryId);
    if (exists) return fail(BRACKETS_ERRORS.BRACKET_ALREADY_EXISTS);

    const seededPlayers = await this.loadSeededPlayers(tournamentId, categoryId);
    if (seededPlayers.length < 2) return fail(BRACKETS_ERRORS.NOT_ENOUGH_QUALIFIERS);
    const seededIds = seededPlayers.map((p) => p.id_user);

    const drawn = drawBracketSlotsForGroups(this.toGroupSeededEntries(seededPlayers));

    const allIds = [...new Set([...seededIds, ...drawn.map((d) => d.player)].filter((id): id is string => id !== null))];
    const names = await this.repo.getUserNames(allIds);
    const nameFields = (idUser: string | null) => {
      const n = idUser ? names.get(idUser) : undefined;
      return { first_name: n?.first_name ?? null, last_name: n?.last_name ?? null, email: n?.email ?? "" };
    };

    // slots viene indexado por semilla (drawn[0] = semilla 1), así que el
    // mismo índice sirve para volver a buscar de qué grupo salió cada uno en
    // seededPlayers (que está en ese mismo orden) — sin otra consulta.
    const originByUser = new Map(seededPlayers.map((p) => [p.id_user, p]));

    // Cuál es el cuadro OFICIAL que se va a generar de verdad — mismo
    // cálculo que usará generateBracket al confirmar (buildBracketWithPreRound
    // decide solo si hace falta pre-llave), para que la previsualización
    // nunca muestre un tamaño de cuadro ni un "BYE" que después no exista.
    const rankedRealPlayers = drawn
      .filter((d): d is DrawnSlot => d.player !== null)
      .sort((a, b) => a.seed - b.seed);
    const withPreRound = buildBracketWithPreRound(rankedRealPlayers, 5);
    const preRoundTempMatches = withPreRound.matches.filter((m) => m.round === 0);
    const bracketSize = withPreRound.bracket_size; // = floor cuando hay pre-llave, = N si ya era potencia de 2

    // El orden físico (visual) de la planilla de sorteo es distinto del
    // orden de emparejamiento de partidos: acá lo que importa es en qué fila
    // aparece cada uno (semilla 1 arriba, semilla 2 abajo, BYE/pendiente
    // pegados a las semillas protegidas primero y después hacia el medio),
    // no quién juega contra quién en la ronda 1 — ver getPhysicalDisplayOrder.
    const displayOrder = getPhysicalDisplayOrder(bracketSize);
    // A qué partido de la ronda 1 corresponde cada semilla (ver
    // getSeedPositions/buildBracketFromSlots) — el orden físico de la
    // planilla (displayOrder) no es el mismo que el de emparejamiento, así
    // que hay que calcularlo aparte para poder mostrar "quién juega contra
    // quién" en la previsualización sin adivinar.
    const seedOrder = getSeedPositions(bracketSize);
    const matchNumberBySeed = new Map<number, number>();
    seedOrder.forEach((seed, i) => matchNumberBySeed.set(seed, Math.floor(i / 2) + 1));

    // El "cuadro" que se muestra en la sección 2 (Posiciones) es el OFICIAL
    // (tamaño floor si hay pre-llave, sin ningún BYE real): semillas
    // 1..(bracketSize - sobrantes) son los sembrados directos, y las
    // restantes (sobrantes) quedan como "pendiente de pre-llave" en vez de
    // BYE — se resuelven jugando la ronda 0 de abajo, no son un pase gratis.
    const officialDrawn: DrawnSlot[] =
      preRoundTempMatches.length > 0
        ? [
            ...rankedRealPlayers.slice(0, bracketSize - preRoundTempMatches.length),
            ...Array.from({ length: preRoundTempMatches.length }, (_, i) => ({
              player: null,
              seed: bracketSize - preRoundTempMatches.length + i + 1,
            })),
          ]
        : rankedRealPlayers;

    // Pre-llave (ronda 0), lista para mostrar aparte de la sección 2 —
    // mismos partidos exactos que va a persistir generateBracket.
    const preRound: BracketPreview["pre_round"] =
      preRoundTempMatches.length > 0
        ? preRoundTempMatches.flatMap((m, i) => {
            const origin1 = m.player1_id ? originByUser.get(m.player1_id) : undefined;
            const origin2 = m.player2_id ? originByUser.get(m.player2_id) : undefined;
            return [
              {
                position: i * 2 + 1,
                match_number: m.match_number,
                id_user: m.player1_id,
                seed: m.seed1!,
                group_name: origin1?.group_name ?? null,
                qualification_label: origin1?.qualification_label ?? null,
                ...(m.player1_id ? nameFields(m.player1_id) : { first_name: null, last_name: null, email: null }),
              },
              {
                position: i * 2 + 2,
                match_number: m.match_number,
                id_user: m.player2_id,
                seed: m.seed2!,
                group_name: origin2?.group_name ?? null,
                qualification_label: origin2?.qualification_label ?? null,
                ...(m.player2_id ? nameFields(m.player2_id) : { first_name: null, last_name: null, email: null }),
              },
            ];
          })
        : undefined;

    return ok({
      bracket_size: bracketSize,
      qualifiers: seededPlayers.map((p, i) => ({
        id_user: p.id_user,
        seed: i + 1,
        group_name: p.group_name,
        qualification_label: p.qualification_label,
        ...nameFields(p.id_user),
      })),
      slots: displayOrder.map((drawnIdx, i) => {
        const d = officialDrawn[drawnIdx];
        const origin = d.player ? originByUser.get(d.player) : undefined;
        return {
          position: i + 1,
          match_number: matchNumberBySeed.get(d.seed)!,
          id_user: d.player,
          seed: d.seed,
          group_name: origin?.group_name ?? null,
          qualification_label: origin?.qualification_label ?? null,
          ...(d.player ? nameFields(d.player) : { first_name: null, last_name: null, email: null }),
        };
      }),
      ...(preRound ? { pre_round: preRound } : {}),
    });
  }

  async generateBracket(
    tournamentId: string,
    categoryId: string,
    input: GenerateBracketInput,
    slotAssignment?: BracketSlotAssignmentInput,
    requestedBy?: string
  ): Promise<Result<BracketView, BracketsError>> {
    const exists = await this.repo.bracketExists(tournamentId, categoryId);
    if (exists) return fail(BRACKETS_ERRORS.BRACKET_ALREADY_EXISTS);

    const bestOfSets = (input.best_of_sets ?? 5) as 3 | 5 | 7;

    // Semilla final: primero clasificados de grupo, luego pases directos.
    const seededPlayers = await this.loadSeededPlayers(tournamentId, categoryId);
    const seededIds = seededPlayers.map((p) => p.id_user);

    if (seededIds.length < 2) {
      return fail(BRACKETS_ERRORS.NOT_ENOUGH_QUALIFIERS);
    }

    let rankedRealPlayers: DrawnSlot[];
    if (slotAssignment) {
      // Confirmando un sorteo ya previsualizado: no se vuelve a sortear,
      // pero se valida que sean los MISMOS clasificados de ahora (por si
      // cambió algo entre previsualizar y confirmar) para no persistir un
      // sorteo desactualizado. slotAssignment ya viene como la lista
      // completa de jugadores reales, sin huecos — ver slotsToAssignment en
      // el frontend, que combina el cuadro oficial + la pre-llave (si
      // corresponde) en una sola lista ordenada por semilla; si viniera
      // algún null suelto (formato viejo) se descarta acá por las dudas.
      const real = slotAssignment.filter((s): s is { player_id: string; seed: number } => s.player_id !== null);
      const currentIds = new Set(seededIds);
      const givenIds = new Set(real.map((s) => s.player_id));
      const sameSet = currentIds.size === givenIds.size && [...currentIds].every((id) => givenIds.has(id));
      if (!sameSet) return fail(BRACKETS_ERRORS.SEEDING_OUT_OF_DATE);
      rankedRealPlayers = real
        .map((s) => ({ player: s.player_id, seed: s.seed }))
        .sort((a, b) => a.seed - b.seed);
    } else {
      const drawn = drawBracketSlotsForGroups(this.toGroupSeededEntries(seededPlayers));
      rankedRealPlayers = drawn
        .filter((d): d is DrawnSlot => d.player !== null)
        .sort((a, b) => a.seed - b.seed);
    }

    const generated = buildBracketWithPreRound(rankedRealPlayers, bestOfSets);
    await this.repo.persistBracket(tournamentId, categoryId, generated, requestedBy);
    await this.repo.markGroupQualifiers(tournamentId, categoryId);

    const names = await this.repo.getTournamentCategoryNames(tournamentId, categoryId);
    if (names) {
      const realPlayers = rankedRealPlayers.map((d) => d.player).filter((p): p is string => p !== null);
      await this.repo.notifications.createForMany(realPlayers, {
        type: "bracket_generated",
        title: "Se generó el cuadro eliminatorio",
        message: `Ya está el cuadro eliminatorio de ${names.categoryType} ${names.categoryRange} (${names.tournamentName}). Mirá contra quién te toca.`,
        idTournament: tournamentId,
        idCategory: categoryId,
      });

      // Avisar aparte a quienes avanzan directo por bye (sin jugar) en la ronda 1
      const byeWinners = generated.matches
        .filter((m) => m.is_bye && m.winner_id)
        .map((m) => m.winner_id as string);

      if (byeWinners.length > 0) {
        await this.repo.notifications.createForMany(byeWinners, {
          type: "bracket_bye",
          title: "Avanzaste de ronda",
          message: `Te tocó bye en la primera ronda de ${names.categoryType} ${names.categoryRange} (${names.tournamentName}): pasás directo a la siguiente ronda sin jugar.`,
          idTournament: tournamentId,
          idCategory: categoryId,
        });
      }
    }

    return this.getBracket(tournamentId, categoryId);
  }

  async getBracket(
    tournamentId: string,
    categoryId: string
  ): Promise<Result<BracketView, BracketsError>> {
    const matches = await this.repo.findBracket(tournamentId, categoryId);

    if (matches.length === 0) {
      return fail(BRACKETS_ERRORS.BRACKET_NOT_FOUND);
    }

    // total_rounds/bracket_size/rounds solo consideran la llave oficial
    // (round >= 1) — la pre-llave (round 0, si existe) se manda aparte en
    // pre_round, no como una ronda más de `rounds` (ver comentario en
    // BracketView).
    const officialMatches = matches.filter((m) => m.round >= 1);
    const totalRounds = officialMatches.length > 0 ? Math.max(...officialMatches.map((m) => m.round)) : 0;
    const bracketSize = Math.pow(2, totalRounds);

    const rounds = Array.from({ length: totalRounds }, (_, i) => ({
      round: i + 1,
      matches: officialMatches.filter((m) => m.round === i + 1),
    }));

    const preRoundMatches = matches.filter((m) => m.round === 0);

    return ok({
      bracket_size: bracketSize,
      total_rounds: totalRounds,
      rounds,
      ...(preRoundMatches.length > 0 ? { pre_round: preRoundMatches } : {}),
    });
  }

  async recordBracketResult(
    matchId: string,
    input: MatchResultInput
  ): Promise<Result<{ recorded: true; tournamentId: string; categoryId: string }, BracketsError>> {
    const match = await this.repo.findBracketMatch(matchId);
    if (!match) return fail(BRACKETS_ERRORS.MATCH_NOT_FOUND);
    if (match.status !== "ready")  return fail(BRACKETS_ERRORS.MATCH_NOT_READY);

    const { winner_id, sets_player1, sets_player2, walkover = false, set_scores } = input;

    if (winner_id !== match.player1_id && winner_id !== match.player2_id) {
      return fail(BRACKETS_ERRORS.INVALID_WINNER);
    }

    if (!walkover) {
      const setsToWin = Math.ceil(match.best_of_sets / 2);
      const winnerSets = winner_id === match.player1_id ? sets_player1 : sets_player2;
      const loserSets  = winner_id === match.player1_id ? sets_player2 : sets_player1;
      if (winnerSets !== setsToWin || loserSets >= setsToWin) {
        return fail(BRACKETS_ERRORS.INVALID_SET_COUNT);
      }
      if (!setScoresMatchAggregate(set_scores, sets_player1, sets_player2)) {
        return fail(BRACKETS_ERRORS.INVALID_SET_COUNT);
      }
    }

    const loserId = winner_id === match.player1_id ? match.player2_id : match.player1_id;
    const winnerSetsFor     = winner_id === match.player1_id ? sets_player1 : sets_player2;
    const winnerSetsAgainst = winner_id === match.player1_id ? sets_player2 : sets_player1;

    await this.repo.recordBracketResult({
      matchId,
      winnerId: winner_id,
      loserId,
      setScores: walkover ? undefined : set_scores,
      setsPlayer1: sets_player1,
      setsPlayer2: sets_player2,
      winnerSetsFor,
      winnerSetsAgainst,
      walkover,
      nextRound: match.next_round,
      nextMatchNumber: match.next_match_number,
      nextMatchSlot: match.next_match_slot,
      tournamentId: match.id_tournament,
      categoryId: match.id_category,
    });

    return ok({ recorded: true, tournamentId: match.id_tournament, categoryId: match.id_category });
  }
}
