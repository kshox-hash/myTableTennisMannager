import { generateGroupsFromPlayers, buildManualGroups } from "../group_generation_logic";
import {
  drawBracketSlotsForGroups,
  buildBracketForSize,
  bracketSizeOptions,
  defaultBracketSize,
  groupSlotId,
  isGroupSlotId,
  resolveGroupSlots,
  getSeedPositions,
  type DrawnSlot,
  type GroupSeededEntry,
} from "../bracket_generation_logic";
import { BracketsRepository, type WithdrawalMatch } from "./brackets_repository";
import { notifyGroupOutcome } from "../notifications/player_outcomes";
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
import { followersBracketReady, followersCategoryStarted } from "../notifications/followers";

// Si vienen los puntajes por set, deben ser consistentes con los sets ganados declarados
// (ningún set puede terminar empatado, y la cuenta de sets ganados por cada uno debe calzar).
// Un set de tenis de mesa se gana con 11 puntos (o 21, formato "1 set a 21"
// — ver points_per_set), salvo que quede a un punto del empate (10-10 u
// 20-20), caso en el que se gana por una diferencia de 2 puntos (deuce). Por
// ejemplo 11-9 es válido, pero 11-10 no lo es: el set debía seguir hasta
// 12-10, 13-11, etc.
function isLegalSetScore(p1: number, p2: number, pointsToWin: 11 | 21 = 11): boolean {
  if (p1 === p2) return false;
  const winner = Math.max(p1, p2);
  const loser = Math.min(p1, p2);
  if (winner < pointsToWin) return false;
  if (winner === pointsToWin) return loser <= pointsToWin - 2;
  return loser === winner - 2;
}

function setScoresMatchAggregate(
  setScores: Array<{ p1: number; p2: number }> | undefined,
  setsPlayer1: number,
  setsPlayer2: number,
  pointsToWin: 11 | 21 = 11
): boolean {
  if (!setScores || setScores.length === 0) return true;

  let p1Wins = 0;
  let p2Wins = 0;
  for (const s of setScores) {
    if (!isLegalSetScore(s.p1, s.p2, pointsToWin)) return false;
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

// 21 puntos solo existe en "1 set a 21". Los campeonatos pueden traer 21 guardado
// aunque jueguen a mejor de 3, y eso no debe llegar a sus partidos.
function pointsFor(bestOfSets: number, pointsPerSet?: 11 | 21): 11 | 21 {
  return bestOfSets === 1 ? (pointsPerSet ?? 11) : 11;
}

export class BracketsService {
  constructor(private repo: BracketsRepository) {}

  /** Llave adelantada: se llama cuando el último grupo con cupos termina
   *  (la usa TournamentPhaseService para armar la Plata recién ahí). */
  onAllGroupSlotsFilled?: (tournamentId: string, categoryId: string) => Promise<void>;

  // ─── GRUPOS ──────────────────────────────────────────────

  // Lo que elige el admin manda. Sin elección, Oro arma de a 4 (con 2
  // clasificados deja 2 arriba y 2 abajo) y el resto prioriza grupos de 3.
  private async prefersFours(categoryId: string, mode?: "normal" | "fours"): Promise<boolean> {
    return mode ? mode === "fours" : this.repo.isGoldCategory(categoryId);
  }

  // Previsualiza la composición de los grupos (algoritmo real de
  // ranking/serpentina) SIN persistir nada — para la pantalla de fixture
  // donde el admin elige el orden de juego antes de confirmar. El algoritmo
  // es determinístico (sin sorteo/azar), así que no hace falta que el
  // admin mande de vuelta la composición al confirmar: alcanza con volver a
  // correrlo (ver generateGroups más abajo).
  async previewGroups(
    tournamentId: string,
    categoryId: string,
    splitFours: number[] = [],
    groupSizeMode?: "normal" | "fours"
  ): Promise<Result<GroupsPreview, BracketsError>> {
    const alreadyExist = await this.repo.groupsExist(tournamentId, categoryId);
    if (alreadyExist) return fail(BRACKETS_ERRORS.GROUPS_ALREADY_EXIST);

    const players = await this.repo.loadPlayersForCategory(tournamentId, categoryId);
    if (players.length < 2) return fail(BRACKETS_ERRORS.NOT_ENOUGH_PLAYERS);

    const singleGroup = await this.repo.isRoundRobinCategory(categoryId);
    const preferFours = await this.prefersFours(categoryId, groupSizeMode);
    const generated = generateGroupsFromPlayers(players, { bestOfGroups: 3, singleGroup, splitFours, preferFours });

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
        base_index: g.base_index,
        is_split: g.is_split,
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
      // Categoría Oro: jugador que sobró al armar grupos de 4 — no juega
      // grupo, pasa directo a la llave (ver generateGroupsFromPlayers).
      direct_advance_players: generated.directAdvancePlayers.map((idUser) => ({
        id_user: idUser,
        ...nameFields(idUser),
      })),
    });
  }

  async generateGroups(
    tournamentId: string,
    categoryId: string,
    input: GenerateGroupsInput,
    groupOrder?: GroupOrderInput,
    expectedPlayerIds?: string[]
  ): Promise<Result<CategoryGroupsView, BracketsError>> {
    const alreadyExist = await this.repo.groupsExist(tournamentId, categoryId);
    if (alreadyExist) return fail(BRACKETS_ERRORS.GROUPS_ALREADY_EXIST);

    const players = await this.repo.loadPlayersForCategory(tournamentId, categoryId);
    if (players.length < 2) return fail(BRACKETS_ERRORS.NOT_ENOUGH_PLAYERS);

    if (expectedPlayerIds) {
      // Confirmando un fixture ya previsualizado: los inscritos activos
      // ahora mismo tienen que ser EXACTAMENTE los mismos que vio el admin
      // al previsualizar — antes esto solo comparaba los NOMBRES de grupo
      // resultantes (GR-1, GR-2...), que podían coincidir por pura
      // casualidad (mismo total de grupos) aunque la composición real
      // hubiera cambiado — p.ej. alguien se autoinscribió mientras el
      // admin miraba Sembrado (las inscripciones se mantienen abiertas
      // durante todo el sembrado, a propósito). Mismo criterio que ya usa
      // generateBracket para SEEDING_OUT_OF_DATE.
      const currentIds = new Set(players.map((p) => p.id_user));
      const expectedIds = new Set(expectedPlayerIds);
      const sameRoster =
        currentIds.size === expectedIds.size && [...currentIds].every((id) => expectedIds.has(id));
      if (!sameRoster) return fail(BRACKETS_ERRORS.GROUPS_OUT_OF_DATE);
    }

    const generated = generateGroupsFromPlayers(players, {
      bestOfGroups: input.best_of_sets ?? 3,
      pointsPerSet: pointsFor(input.best_of_sets ?? 3, input.points_per_set),
      singleGroup: await this.repo.isRoundRobinCategory(categoryId),
      splitFours: input.split_fours ?? [],
      preferFours: await this.prefersFours(categoryId, input.group_size_mode),
    });

    if (groupOrder) {
      // Orden de juego elegido por el admin — ya se validó arriba que el
      // roster no cambió, así que los nombres de grupo que arma el
      // algoritmo ahora mismo necesariamente son los mismos que vio.
      const currentNames = new Set(generated.groups.map((g) => g.group_name));
      const givenNames = new Set(groupOrder);
      const sameSet = currentNames.size === givenNames.size && [...currentNames].every((n) => givenNames.has(n));
      if (!sameSet) return fail(BRACKETS_ERRORS.GROUPS_OUT_OF_DATE);

      for (const group of generated.groups) {
        group.sort_order = groupOrder.indexOf(group.group_name) + 1;
      }
    }

    const qualifiersPerGroup = await this.repo.getCategoryQualifiersPerGroup(categoryId);
    const persisted = await this.repo.persistGroups(tournamentId, categoryId, generated, qualifiersPerGroup);
    if (!persisted.persisted) return fail(BRACKETS_ERRORS.GROUPS_ALREADY_EXIST);

    // Categoría Oro: el jugador que sobró al armar grupos de 4 (ver
    // generateGroupsFromPlayers) no juega grupo — pasa directo a la llave.
    await this.repo.markDirectAdvance(tournamentId, categoryId, generated.directAdvancePlayers);

    const directAdvanceIds = new Set(generated.directAdvancePlayers);
    const names = await this.repo.getTournamentCategoryNames(tournamentId, categoryId);
    if (names) {
      await this.repo.notifications.createForMany(
        players.filter((p) => !directAdvanceIds.has(p.id_user)).map((p) => p.id_user),
        {
          type: "groups_started",
          title: "Arrancó la fase de grupos",
          message: `Ya se generaron los grupos de ${names.categoryType} ${names.categoryRange} (${names.tournamentName}). Revisa tu grupo y tus partidos.`,
          idTournament: tournamentId,
          idCategory: categoryId,
        }
      );
    }
    // Quienes siguen el campeonato sin jugarlo.
    void followersCategoryStarted(categoryId);

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
      pointsPerSet: pointsFor(input.best_of_sets ?? 3, input.points_per_set),
      singleGroup: await this.repo.isRoundRobinCategory(categoryId),
      preferFours: input.group_size_mode
        ? input.group_size_mode === "fours"
        : (await this.repo.isGoldCategory(categoryId)) && (await this.repo.groupsMostlyFours(categoryId)),
    });

    const qualifiersPerGroup = await this.repo.getCategoryQualifiersPerGroup(categoryId);
    await this.repo.regenerateGroups(tournamentId, categoryId, generated, qualifiersPerGroup);

    // Categoría Oro: el jugador que sobró al armar grupos de 4 (ver
    // generateGroupsFromPlayers) no juega grupo — pasa directo a la llave.
    await this.repo.markDirectAdvance(tournamentId, categoryId, generated.directAdvancePlayers);

    const directAdvanceIds = new Set(generated.directAdvancePlayers);
    const names = await this.repo.getTournamentCategoryNames(tournamentId, categoryId);
    if (names) {
      await this.repo.notifications.createForMany(
        players.filter((p) => !directAdvanceIds.has(p.id_user)).map((p) => p.id_user),
        {
          type: "groups_started",
          title: "Se rearmaron los grupos",
          message: `Se volvieron a armar los grupos de ${names.categoryType} ${names.categoryRange} (${names.tournamentName}) con los inscritos actuales. Revisa tu grupo y tus partidos.`,
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
    input: { groups: string[][]; bestOfSets?: 1 | 3 | 5 | 7; pointsPerSet?: 11 | 21 }
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
    const generated = buildManualGroups(groupBuckets, input.bestOfSets ?? 3, pointsFor(input.bestOfSets ?? 3, input.pointsPerSet));

    const qualifiersPerGroup = await this.repo.getCategoryQualifiersPerGroup(categoryId);
    await this.repo.regenerateGroups(tournamentId, categoryId, generated, qualifiersPerGroup);

    const names = await this.repo.getTournamentCategoryNames(tournamentId, categoryId);
    if (names) {
      await this.repo.notifications.createForMany(flatIds, {
        type: "groups_started",
        title: "Se rearmaron los grupos",
        message: `El organizador rearmó manualmente los grupos de ${names.categoryType} ${names.categoryRange} (${names.tournamentName}). Revisa tu grupo y tus partidos.`,
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
    const r = await this.repo.setGroupMatchReferee(matchId, refereeId);
    if (r === "not_found") return fail(BRACKETS_ERRORS.MATCH_NOT_FOUND);
    if (r === "own_match") return fail(BRACKETS_ERRORS.OWN_MATCH_REFEREE);
    if (r === "referee_busy") return fail(BRACKETS_ERRORS.REFEREE_BUSY);
    return ok({ updated: true });
  }

  async setMatchesBestOf(tournamentId: string, categoryId: string, bestOfSets: number): Promise<number> {
    return this.repo.setPendingMatchesBestOf(tournamentId, categoryId, bestOfSets);
  }

  async setBracketMatchReferee(
    matchId: string,
    refereeId: string | null
  ): Promise<Result<{ updated: true }, BracketsError>> {
    const r = await this.repo.setBracketMatchReferee(matchId, refereeId);
    if (r === "not_found") return fail(BRACKETS_ERRORS.MATCH_NOT_FOUND);
    if (r === "own_match") return fail(BRACKETS_ERRORS.OWN_MATCH_REFEREE);
    if (r === "referee_busy") return fail(BRACKETS_ERRORS.REFEREE_BUSY);
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

  async swapGroupMembers(input: {
    tournamentId: string;
    categoryId: string;
    userA: string;
    userB: string;
  }): Promise<Result<{ swapped: true }, BracketsError>> {
    const result = await this.repo.swapGroupMembers(input);
    if (!result.swapped) return fail(result.error);
    return ok({ swapped: true });
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

  // Grupo nuevo aparte de los existentes — para sumar gente que llegó
  // después del sorteo sin tocar los grupos que ya están jugando (ver
  // brackets_repository.createManualGroup).
  async createManualGroup(
    tournamentId: string,
    categoryId: string,
    memberUserIds: string[]
  ): Promise<Result<{ groupId: string; groupName: string }, BracketsError>> {
    const result = await this.repo.createManualGroup({ tournamentId, categoryId, memberUserIds });
    if (!result.created) return fail(result.error);
    return ok({ groupId: result.groupId, groupName: result.groupName });
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
      qualifiers_per_group: await this.repo.getCategoryQualifiersPerGroup(categoryId),
      has_silver: await this.repo.categoryHasSilver(categoryId),
    };

    return ok(view);
  }

  async recordResult(
    matchId: string,
    input: MatchResultInput,
    // Interno: los W.O. que cierra closeAbsentMatches no vuelven a dispararlo.
    opts: { fromAbsentClose?: boolean } = {}
  ): Promise<Result<{ recorded: true; tournamentId: string; categoryId: string }, BracketsError>> {
    const match = await this.repo.findMatch(matchId);
    if (!match) return fail(BRACKETS_ERRORS.MATCH_NOT_FOUND);
    if (match.status !== "scheduled") return fail(BRACKETS_ERRORS.MATCH_ALREADY_PLAYED);

    const { winner_id, sets_player1, sets_player2, set_scores, result_reason } = input;

    // No se presentó ninguno: se cierra sin ganador y pierden los dos.
    if (result_reason === "double_no_show") {
      if (!match.player1_id || !match.player2_id) return fail(BRACKETS_ERRORS.INVALID_WINNER);
      await this.repo.recordDoubleNoShow({
        matchId,
        groupId: match.id_group,
        player1Id: match.player1_id,
        player2Id: match.player2_id,
        tournamentId: match.id_tournament,
        categoryId: match.id_category,
      });
      await this.afterGroupResult(match.id_group, match.id_tournament, match.id_category, opts);
      return ok({ recorded: true, tournamentId: match.id_tournament, categoryId: match.id_category });
    }

    // Un motivo (lesión, abandono, no se presentó, descalificación) siempre
    // es un resultado no jugado: se guarda como walkover + el motivo.
    const walkover = input.walkover === true || !!result_reason;

    if (!winner_id || (winner_id !== match.player1_id && winner_id !== match.player2_id)) {
      return fail(BRACKETS_ERRORS.INVALID_WINNER);
    }

    if (!walkover) {
      const setsToWin = Math.ceil(match.best_of_sets / 2);
      const winnerSets = winner_id === match.player1_id ? sets_player1 : sets_player2;
      const loserSets  = winner_id === match.player1_id ? sets_player2 : sets_player1;
      if (winnerSets !== setsToWin || loserSets >= setsToWin) {
        return fail(BRACKETS_ERRORS.INVALID_SET_COUNT);
      }
      if (!setScoresMatchAggregate(set_scores, sets_player1, sets_player2, match.points_per_set)) {
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

    await this.repo.setResultReason("group", matchId, walkover ? result_reason ?? null : null);
    await this.afterGroupResult(match.id_group, match.id_tournament, match.id_category, opts);
    return ok({ recorded: true, tournamentId: match.id_tournament, categoryId: match.id_category });
  }

  // Tras un resultado de grupo: si con eso solo quedan partidos de jugadores
  // marcados "No vino", se cierran solos (y ese cierre ya llena la llave);
  // si no, se revisa si el grupo terminó para llenar sus cupos.
  private async afterGroupResult(groupId: string, tournamentId: string, categoryId: string, opts: { fromAbsentClose?: boolean }) {
    const closed = opts.fromAbsentClose ? 0 : await this.closeAbsentMatches(groupId);
    if (closed === 0) {
      await this.fillBracketSlotsIfGroupFinished(groupId, tournamentId, categoryId);
      await this.reconcileGroupWithBrackets(groupId, tournamentId, categoryId);
    }
  }

  /**
   * Un grupo corregido con las llaves ya armadas (Oro y, si hay, Plata): ÚNICO
   * camino para llevar la corrección a las llaves (lo usan "Cambiar ganador" y
   * volver a cargar un resultado deshecho).
   *
   * Cada grupo tiene cupos fijos en el sorteo: el del 1° (lugar de semilla), el
   * del 2° (mitad opuesta) y el de Plata (el 3°). Cada cupo pasa a quien ahora
   * ocupa ese puesto en el grupo: si el 1° y el 2° solo se dieron vuelta,
   * intercambian lugar; si entra uno nuevo, toma el cupo del puesto que ganó.
   * El que baja de Oro entra a la Plata y viceversa, en el mismo paso.
   *
   * Nunca mueve resultados ya jugados: si alguno de los que cambian ya jugó un
   * partido de llave, no toca nada y devuelve quiénes (lo decide el admin).
   */
  async reconcileGroupWithBrackets(
    groupId: string,
    tournamentId: string,
    categoryId: string,
    requestedBy?: string
  ): Promise<{ changed: boolean; blockedBy?: string[] }> {
    const phase = await this.repo.getCategoryPhase(categoryId);
    if (phase !== "bracket" && phase !== "finished") return { changed: false };
    if (await this.repo.groupHasBracketSlots(groupId)) return { changed: false }; // llave adelantada: sus cupos se llenan solos
    const qualifiers = (await this.repo.loadGroupQualifiers(tournamentId, categoryId))
      .filter((q) => q.id_group === groupId)
      .sort((a, b) => a.rank_in_group - b.rank_in_group);
    if (qualifiers.length === 0 || !qualifiers[0].group_finished) return { changed: false };

    const plan: Array<{ categoryId: string; moves: Array<{ from: string; to: string }>; silver: boolean }> = [];
    const gold = await this.slotMoves(groupId, categoryId, qualifiers.map((q) => q.id_user));
    if (gold.length > 0) plan.push({ categoryId, moves: gold, silver: false });

    const silverCategoryId = await this.repo.getSilverCategoryId(categoryId);
    if (silverCategoryId) {
      const groupMembers = new Set(await this.repo.groupMemberIds(groupId));
      const wantedSilver = (await this.repo.loadGroupSilverPlayers(tournamentId, categoryId))
        .filter((p) => groupMembers.has(p.id_user))
        .map((p) => p.id_user);
      const silver = await this.slotMoves(groupId, silverCategoryId, wantedSilver);
      if (silver.length > 0) plan.push({ categoryId: silverCategoryId, moves: silver, silver: true });
    }
    if (plan.length === 0) {
      await this.repo.remarkGroupQualifiers(tournamentId, categoryId, groupId);
      return { changed: false };
    }

    // ¿Alguno de los que se mueven ya jugó en esa llave? Entonces no se toca nada.
    const blocked = new Set<string>();
    for (const step of plan) {
      const ids = step.moves.flatMap((m) => [m.from, m.to]);
      for (const id of await this.repo.playersWithPlayedBracketMatch(step.categoryId, ids)) blocked.add(id);
    }
    if (blocked.size > 0) {
      const names = await this.repo.getUserNames([...blocked]);
      const label = [...blocked].map((id) => {
        const n = names.get(id);
        return [n?.first_name, n?.last_name].filter(Boolean).join(" ") || "un jugador";
      });
      await this.repo.remarkGroupQualifiers(tournamentId, categoryId, groupId);
      return { changed: false, blockedBy: label };
    }

    for (const step of plan) {
      await this.repo.replaceInUnplayedBracket(tournamentId, step.categoryId, step.moves);
      if (step.silver) {
        for (const m of step.moves) await this.repo.swapSilverEnrollment(tournamentId, step.categoryId, m.from, m.to);
      }
    }
    await this.repo.remarkGroupQualifiers(tournamentId, categoryId, groupId);
    if (requestedBy) {
      const ids = plan.flatMap((s) => s.moves.flatMap((m) => [m.from, m.to]));
      const names = await this.repo.getUserNames(ids);
      const nm = (id: string) => {
        const n = names.get(id);
        return [n?.first_name, n?.last_name].filter(Boolean).join(" ");
      };
      const detail = plan
        .map((s) => `${s.silver ? "Plata" : "Oro"}: ${s.moves.map((m) => `${nm(m.to)} en lugar de ${nm(m.from)}`).join(", ")}`)
        .join(" · ");
      await this.repo.activityLog.record(tournamentId, requestedBy, "bracket_adjusted", detail);
    }
    return { changed: true };
  }

  /**
   * Cupos que tiene el grupo en la llave de [bracketCategoryId], en orden de
   * puesto (el del 1° primero: se reconoce por quién lo tenía marcado como 1°
   * o 2°; si no, por semilla), y qué cambio necesita cada uno para quedar en
   * manos de [wanted] (en orden de puesto). Vacío si no hay nada que cambiar o
   * no alcanzan los clasificados.
   */
  private async slotMoves(
    groupId: string,
    bracketCategoryId: string,
    wanted: string[]
  ): Promise<Array<{ from: string; to: string }>> {
    const role = (label: string | null) => (label === "first" ? 0 : label === "second" ? 1 : 2);
    const slots = (await this.repo.groupPlayersInCategoryBracket(groupId, bracketCategoryId)).sort(
      (a, b) => role(a.label) - role(b.label) || (a.seed ?? 999) - (b.seed ?? 999)
    );
    if (slots.length === 0 || wanted.length < slots.length) return [];
    return slots.map((slot, i) => ({ from: slot.id_user, to: wanted[i] })).filter((m) => m.from !== m.to);
  }

  /**
   * Jugadores marcados "No vino" en la mesa de control: sus partidos se
   * cierran solos recién cuando ya se jugó todo lo que queda entre los que
   * sí vinieron (antes no, para poder reemplazarlos). Contra uno que vino es
   * W.O. para el que vino; si faltaron los dos, "no se presentó ninguno".
   * Así el grupo termina y clasifican los que jugaron. Devuelve cuántos cerró.
   */
  async closeAbsentMatches(groupId: string): Promise<number> {
    const pending = await this.repo.pendingGroupMatchesWithAbsence(groupId);
    if (pending.length === 0) return 0;
    if (pending.some((m) => !m.p1_absent && !m.p2_absent)) return 0;

    let closed = 0;
    for (const m of pending) {
      const need = Math.ceil(m.best_of_sets / 2);
      const input: MatchResultInput =
        m.p1_absent && m.p2_absent
          ? { sets_player1: 0, sets_player2: 0, walkover: true, result_reason: "double_no_show" }
          : {
              winner_id: m.p1_absent ? m.player2_id : m.player1_id,
              sets_player1: m.p1_absent ? 0 : need,
              sets_player2: m.p1_absent ? need : 0,
              walkover: true,
              result_reason: "no_show",
            };
      const r = await this.recordResult(m.id_match, input, { fromAbsentClose: true });
      if (r.ok) closed++;
    }
    return closed;
  }

  /**
   * "Cambiar ganador" de un partido de grupo (resultado cargado al revés).
   * Corrige el grupo y, si las llaves ya están armadas, las ajusta con
   * reconcileGroupWithBrackets (Oro y Plata a la vez, sin mover resultados
   * jugados). `bracketBlockedBy`: la llave NO se tocó porque esos jugadores
   * ya jugaron en ella.
   */
  async fixGroupWinner(
    matchId: string,
    requestedBy?: string
  ): Promise<Result<{ fixed: true; tournamentId: string; categoryId: string; bracketBlockedBy?: string[] }, BracketsError>> {
    const r = await this.repo.fixGroupWinner(matchId);
    if (!r.fixed) return fail(r.error === "MATCH_NOT_FOUND" ? BRACKETS_ERRORS.MATCH_NOT_FOUND : BRACKETS_ERRORS.MATCH_NOT_PLAYED);
    const { groupId, tournamentId, categoryId } = r;
    if (requestedBy) {
      const names = await this.repo.getUserNames([r.oldWinnerId, r.newWinnerId]);
      const nm = (id: string) => [names.get(id)?.first_name, names.get(id)?.last_name].filter(Boolean).join(" ");
      await this.repo.activityLog.record(
        tournamentId,
        requestedBy,
        "group_winner_fixed",
        `Ganador cambiado: ${nm(r.newWinnerId)} (antes ${nm(r.oldWinnerId)})`
      );
    }
    const rec = await this.reconcileGroupWithBrackets(groupId, tournamentId, categoryId, requestedBy);
    return ok({ fixed: true, tournamentId, categoryId, ...(rec.blockedBy ? { bracketBlockedBy: rec.blockedBy } : {}) });
  }

  /** Al marcar "No vino" con los grupos en juego: por si con eso el grupo ya puede cerrarse. */
  async closeAbsentMatchesForPlayer(tournamentId: string, categoryId: string, userId: string): Promise<number> {
    if ((await this.repo.getCategoryPhase(categoryId)) !== "groups") return 0;
    const groupId = await this.repo.findUserGroup(tournamentId, categoryId, userId);
    return groupId ? this.closeAbsentMatches(groupId) : 0;
  }

  // Llave adelantada: al terminar el grupo, sus clasificados entran a la llave.
  private async fillBracketSlotsIfGroupFinished(groupId: string, tournamentId: string, categoryId: string): Promise<void> {
    if (!(await this.repo.groupHasBracketSlots(groupId))) return;
    const qualifiers = (await this.repo.loadGroupQualifiers(tournamentId, categoryId)).filter((q) => q.id_group === groupId);
    if (qualifiers.length === 0 || !qualifiers[0].group_finished) return;

    await this.repo.fillGroupSlots(groupId, qualifiers);
    await this.repo.markGroupQualifiers(tournamentId, categoryId, [groupId]);

    const names = await this.repo.getTournamentCategoryNames(tournamentId, categoryId);
    if (names) {
      await this.repo.notifications.createForMany(qualifiers.map((q) => q.id_user), {
        type: "bracket_generated",
        title: "Clasificaste a la llave",
        message: `Ya estás en la llave de ${names.categoryType} ${names.categoryRange} (${names.tournamentName}). Mira contra quién te toca.`,
        idTournament: tournamentId,
        idCategory: categoryId,
      });
    }
    if (!(await this.repo.hasPendingGroupSlots(categoryId))) {
      const seeded = await this.loadSeededPlayers(tournamentId, categoryId);
      void notifyGroupOutcome(categoryId, seeded.map((p) => p.id_user));
      await this.onAllGroupSlotsFilled?.(tournamentId, categoryId);
    }
  }

  // Deshace un resultado de partido de grupo ya cargado (ej: error de digitación).
  // Solo mientras la categoría siga en fase "groups" — una vez generado el
  // cuadro eliminatorio, los clasificados ya quedaron fijados a partir de
  // estos resultados y deshacer uno rompería esa foto. En una llave adelantada
  // un grupo con cupos se puede corregir mientras nadie los haya jugado.
  async undoGroupMatchResult(
    matchId: string,
    requestedBy: string
  ): Promise<Result<{ undone: true; tournamentId: string; categoryId: string }, BracketsError>> {
    const match = await this.repo.findMatch(matchId);
    if (!match) return fail(BRACKETS_ERRORS.MATCH_NOT_FOUND);
    if (match.status === "scheduled") return fail(BRACKETS_ERRORS.MATCH_NOT_PLAYED);

    const phase = await this.repo.getCategoryPhase(match.id_category);
    // Grupo único ya cerrado: se puede corregir un resultado (vuelve a
    // "groups" abajo). En grupos + llave, con la llave armada no.
    const reopenRoundRobin =
      phase === "finished" && (await this.repo.isRoundRobinCategory(match.id_category));
    const hasSlots = phase === "bracket" && (await this.repo.groupHasBracketSlots(match.id_group));
    // Llave armada (sin cupos por grupo): se puede corregir mientras nadie de
    // este grupo haya jugado en la llave. Al cargar el resultado correcto, la
    // llave se ajusta sola (ver syncGroupIntoBracket).
    const bracketUntouched =
      phase === "bracket" && !hasSlots && !(await this.repo.groupMembersPlayedInBracket(match.id_group));
    if (phase === "bracket" && !hasSlots && !bracketUntouched) return fail(BRACKETS_ERRORS.GROUP_LOCKED_BY_BRACKET);
    if (phase !== "groups" && !reopenRoundRobin && !hasSlots && !bracketUntouched) return fail(BRACKETS_ERRORS.CATEGORY_ALREADY_ADVANCED);
    if (hasSlots && (await this.repo.groupSlotsPlayed(match.id_group))) return fail(BRACKETS_ERRORS.GROUP_LOCKED_BY_BRACKET);

    if (match.status === "walkover" && !match.winner_id) {
      await this.repo.undoDoubleNoShow({
        matchId,
        groupId: match.id_group,
        player1Id: match.player1_id!,
        player2Id: match.player2_id!,
        tournamentId: match.id_tournament,
        requestedBy,
      });
      if (reopenRoundRobin) await this.repo.reopenRoundRobinCategory(match.id_category);
      if (hasSlots) await this.repo.clearGroupSlots(match.id_group);
      return ok({ undone: true, tournamentId: match.id_tournament, categoryId: match.id_category });
    }

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

    if (reopenRoundRobin) await this.repo.reopenRoundRobinCategory(match.id_category);
    if (hasSlots) await this.repo.clearGroupSlots(match.id_group);

    return ok({ undone: true, tournamentId: match.id_tournament, categoryId: match.id_category });
  }

  // ─── CUADRO ELIMINATORIO ─────────────────────────────────

  // Clasificados de grupos + pases directos, en orden de semilla (index 0 =
  // semilla 1). Compartido por previewBracket y generateBracket para que
  // ambos partan siempre del mismo criterio. group_name/qualification_label
  // vienen null para los pases directos (no salieron de ningún grupo).
  // Con `early`, un grupo sin terminar aporta cupos (groupSlotId) en vez de
  // quién va ganando: su seed depende del grupo y del puesto, no del resultado.
  private async loadSeededPlayers(
    tournamentId: string,
    categoryId: string,
    early = false
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
      ...groupQualifiers.map((q) => {
        const pending = early && !q.group_finished;
        return {
        id_user: pending ? groupSlotId(q.id_group, q.rank_in_group) : q.id_user,
        group_name: q.group_name,
        qualification_label: (q.rank_in_group === 1 ? "first" : q.rank_in_group === 2 ? "second" : null) as
          | "first"
          | "second"
          | null,
        id_club: pending ? null : q.id_club,
        };
      }),
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
    categoryId: string,
    requestedSize?: number,
    early = false
  ): Promise<Result<BracketPreview, BracketsError>> {
    const exists = await this.repo.bracketExists(tournamentId, categoryId);
    if (exists) return fail(BRACKETS_ERRORS.BRACKET_ALREADY_EXISTS);

    const seededPlayers = await this.loadSeededPlayers(tournamentId, categoryId, early);
    if (seededPlayers.length < 2) return fail(BRACKETS_ERRORS.NOT_ENOUGH_QUALIFIERS);
    const seededIds = seededPlayers.map((p) => p.id_user);

    const drawn = drawBracketSlotsForGroups(this.toGroupSeededEntries(seededPlayers));

    const allIds = [...new Set([...seededIds, ...drawn.map((d) => d.player)].filter((id): id is string => id !== null))];
    const names = await this.repo.getUserNames(allIds.filter((id) => !isGroupSlotId(id)));
    const originOf = new Map(seededPlayers.map((p, i) => [p.id_user, i]));
    const nameFields = (idUser: string | null) => {
      if (isGroupSlotId(idUser)) {
        const p = seededPlayers[originOf.get(idUser!)!];
        const rank = idUser!.split(":").pop();
        return { first_name: `${rank}° ${p.group_name}`, last_name: null, email: "" };
      }
      const n = idUser ? names.get(idUser) : undefined;
      return { first_name: n?.first_name ?? null, last_name: n?.last_name ?? null, email: n?.email ?? "" };
    };

    // slots viene indexado por semilla (drawn[0] = semilla 1), así que el
    // mismo índice sirve para volver a buscar de qué grupo salió cada uno en
    // seededPlayers (que está en ese mismo orden) — sin otra consulta.
    const originByUser = new Map(seededPlayers.map((p) => [p.id_user, p]));

    // Cuál es el cuadro OFICIAL que se va a generar de verdad — mismo
    // cálculo que usará generateBracket al confirmar, para que la
    // previsualización nunca muestre un tamaño de cuadro ni un "BYE" que
    // después no exista. Sin tamaño pedido, el de defaultBracketSize.
    const rankedRealPlayers = drawn
      .filter((d): d is DrawnSlot => d.player !== null)
      .sort((a, b) => a.seed - b.seed);
    const sizeOptions = bracketSizeOptions(rankedRealPlayers.length);
    const targetSize = requestedSize ?? defaultBracketSize(rankedRealPlayers.length);
    if (!sizeOptions.includes(targetSize)) return fail(BRACKETS_ERRORS.INVALID_BRACKET_SIZE);
    const withPreRound = buildBracketForSize(rankedRealPlayers, targetSize, 5);
    const preRoundTempMatches = withPreRound.matches.filter((m) => m.round === 0);
    const bracketSize = withPreRound.bracket_size;

    // Cada fila de la planilla es un cupo de la llave, en el mismo orden: lo
    // que se ve al sortear es lo que queda en el cuadro.
    const seedOrder = getSeedPositions(bracketSize);

    // El "cuadro" que se muestra en la sección 2 (Posiciones) es el OFICIAL
    // (tamaño floor si hay pre-llave, sin ningún BYE real): semillas
    // 1..(bracketSize - sobrantes) son los sembrados directos, y las
    // restantes (sobrantes) quedan como "pendiente de pre-llave" en vez de
    // BYE — se resuelven jugando la ronda 0 de abajo, no son un pase gratis.
    // Con pre-llave, cada fila sale del partido de ronda 1 que se va a guardar
    // (la llave se arma plegando el cuadro grande, ver buildBracketWithPreRound):
    // el que entra directo con su semilla, o el cupo que llena una pre-llave
    // (con la mejor semilla de esa pre-llave, solo para ordenar).
    const officialRows: DrawnSlot[] | null =
      preRoundTempMatches.length > 0
        ? withPreRound.matches
            .filter((m) => m.round === 1)
            .sort((a, b) => a.match_number - b.match_number)
            .flatMap((m) =>
              ([1, 2] as const).map((slot) => {
                const player = slot === 1 ? m.player1_id : m.player2_id;
                const seed = slot === 1 ? m.seed1 : m.seed2;
                if (player) return { player, seed: seed ?? 0 };
                const feeder = preRoundTempMatches.find(
                  (p) => p.next_match_number === m.match_number && p.next_match_slot === slot
                );
                return { player: null, seed: Math.min(feeder?.seed1 ?? 999, feeder?.seed2 ?? 999) };
              })
            )
        : null;
    const officialDrawn: DrawnSlot[] = [...drawn].sort((a, b) => a.seed - b.seed);

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
      size_options: sizeOptions,
      early: seededPlayers.some((p) => isGroupSlotId(p.id_user)),
      qualifiers: seededPlayers.map((p, i) => ({
        id_user: p.id_user,
        seed: i + 1,
        group_name: p.group_name,
        qualification_label: p.qualification_label,
        ...nameFields(p.id_user),
      })),
      slots: seedOrder.map((seed, i) => {
        const d = officialRows ? officialRows[i] : officialDrawn[seed - 1];
        const origin = d.player ? originByUser.get(d.player) : undefined;
        return {
          position: i + 1,
          match_number: Math.floor(i / 2) + 1,
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
    input: GenerateBracketInput & { early?: boolean },
    slotAssignment?: BracketSlotAssignmentInput,
    requestedBy?: string
  ): Promise<Result<BracketView, BracketsError>> {
    const exists = await this.repo.bracketExists(tournamentId, categoryId);
    if (exists) return fail(BRACKETS_ERRORS.BRACKET_ALREADY_EXISTS);

    const bestOfSets = (input.best_of_sets ?? 5) as 1 | 3 | 5 | 7;
    const pointsPerSet = pointsFor(bestOfSets, input.points_per_set);

    // Semilla final: primero clasificados de grupo, luego pases directos.
    const seededPlayers = await this.loadSeededPlayers(tournamentId, categoryId, input.early === true);
    const seededIds = seededPlayers.map((p) => p.id_user);
    const pendingGroups = seededPlayers.some((p) => isGroupSlotId(p.id_user));

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

    const sizeOptions = bracketSizeOptions(rankedRealPlayers.length);
    const targetSize = input.bracket_size ?? defaultBracketSize(rankedRealPlayers.length);
    if (!sizeOptions.includes(targetSize)) return fail(BRACKETS_ERRORS.INVALID_BRACKET_SIZE);

    const generated = resolveGroupSlots(buildBracketForSize(rankedRealPlayers, targetSize, bestOfSets, pointsPerSet));
    await this.repo.persistBracket(tournamentId, categoryId, generated, requestedBy);
    if (pendingGroups) {
      const qualifiers = await this.repo.loadGroupQualifiers(tournamentId, categoryId);
      const finished = [...new Set(qualifiers.filter((q) => q.group_finished).map((q) => q.id_group))];
      await this.repo.markGroupQualifiers(tournamentId, categoryId, finished);
    } else {
      await this.repo.markGroupQualifiers(tournamentId, categoryId);
    }

    const names = await this.repo.getTournamentCategoryNames(tournamentId, categoryId);
    if (names) {
      const realPlayers = rankedRealPlayers
        .map((d) => d.player)
        .filter((p): p is string => p !== null && !isGroupSlotId(p));
      // Aviso aparte de clasificación (clasificaste / quedaste fuera) a
      // todos los que jugaron los grupos — antes solo se enteraban los
      // clasificados, y sin saber en qué puesto.
      // Con grupos en juego se avisa cuando se llene el último cupo.
      if (!pendingGroups) void notifyGroupOutcome(categoryId, realPlayers);
      await this.repo.notifications.createForMany(realPlayers, {
        type: "bracket_generated",
        title: "Se generó el cuadro eliminatorio",
        message: `Ya está el cuadro eliminatorio de ${names.categoryType} ${names.categoryRange} (${names.tournamentName}). Mira contra quién te toca.`,
        idTournament: tournamentId,
        idCategory: categoryId,
      });
      // Quienes siguen el campeonato sin jugarlo.
      void followersBracketReady(categoryId);

      // Avisar aparte a quienes avanzan directo por bye (sin jugar) en la ronda 1
      const byeWinners = generated.matches
        .filter((m) => m.is_bye && m.winner_id)
        .map((m) => m.winner_id as string);

      if (byeWinners.length > 0) {
        await this.repo.notifications.createForMany(byeWinners, {
          type: "bracket_bye",
          title: "Avanzaste de ronda",
          message: `Te tocó bye en la primera ronda de ${names.categoryType} ${names.categoryRange} (${names.tournamentName}): pasas directo a la siguiente ronda sin jugar.`,
          idTournament: tournamentId,
          idCategory: categoryId,
        });
      }
    }

    return this.getBracket(tournamentId, categoryId);
  }

  // "Crear una llave" — ver el comentario largo en
  // brackets_repository.ts#createBracketPreRoundMatch.
  async createBracketPreRoundMatch(
    tournamentId: string,
    categoryId: string,
    pullUserId: string
  ): Promise<Result<{ matchId: string }, BracketsError>> {
    const result = await this.repo.createBracketPreRoundMatch({ tournamentId, categoryId, pullUserId });
    if (!result.created) return fail(result.error);
    return ok({ matchId: result.matchId });
  }

  // "Agregar un jugador" a la pre-llave creada arriba.
  async addPlayerToBracketMatch(
    matchId: string,
    userId: string
  ): Promise<Result<{ opponentId: string }, BracketsError>> {
    const result = await this.repo.addPlayerToBracketMatch({ matchId, userId });
    if (!result.added) return fail(result.error);
    return ok({ opponentId: result.opponentId });
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

  /**
   * Sacar a un inscrito de una categoría ya empezada.
   * - Todavía sin jugar en su grupo (y sin llave armada): sale del grupo y de
   *   la categoría, como si no se hubiera inscrito ("removed").
   * - Ya jugó o está en la llave: se retira ("withdrawn"). Lo jugado queda y
   *   cada partido pendiente se cierra por W.O. a favor del rival (en la
   *   llave el rival avanza). Un partido de llave cuyo rival todavía no se
   *   conoce queda para cerrarlo cuando se defina (`waiting`).
   */
  async withdrawPlayer(
    tournamentId: string,
    categoryId: string,
    userId: string,
    reason: "retired" | "injury" | "no_show" | "disqualified" = "retired"
  ): Promise<Result<{ mode: "removed" | "withdrawn"; walkovers: number; waiting: number }, BracketsError>> {
    const st = await this.repo.loadWithdrawalState(categoryId, userId);
    if (!st.phase || st.phase === "enrollment") return fail(BRACKETS_ERRORS.PLAYER_NOT_IN_GROUP);

    const inBracket = st.readyBracketMatches.length > 0 || st.waitingBracketMatches > 0;
    const slotsLocked = st.idGroup ? await this.repo.groupHasBracketSlots(st.idGroup) : false;
    if (st.phase === "groups" && st.playedGroupMatches === 0 && !inBracket && !slotsLocked) {
      await this.repo.removeUnplayedFromGroup(tournamentId, categoryId, userId, st.idGroup);
      return ok({ mode: "removed", walkovers: 0, waiting: 0 });
    }

    const wo = (m: WithdrawalMatch) => {
      const need = Math.ceil(m.best_of_sets / 2);
      const p1Wins = m.player2_id === userId;
      return {
        winner_id: p1Wins ? m.player1_id : m.player2_id,
        sets_player1: p1Wins ? need : 0,
        sets_player2: p1Wins ? 0 : need,
        result_reason: reason,
      };
    };
    let walkovers = 0;
    for (const m of st.pendingGroupMatches) {
      if (!m.player1_id || !m.player2_id) continue;
      const r = await this.recordResult(m.id_match, wo(m));
      if (r.ok) walkovers++;
    }
    for (const m of st.readyBracketMatches) {
      const r = await this.recordBracketResult(m.id_match, wo(m));
      if (r.ok) walkovers++;
    }
    return ok({ mode: "withdrawn", walkovers, waiting: st.waitingBracketMatches });
  }

  async recordBracketResult(
    matchId: string,
    input: MatchResultInput
  ): Promise<Result<{ recorded: true; tournamentId: string; categoryId: string }, BracketsError>> {
    const match = await this.repo.findBracketMatch(matchId);
    if (!match) return fail(BRACKETS_ERRORS.MATCH_NOT_FOUND);
    if (match.status !== "ready")  return fail(BRACKETS_ERRORS.MATCH_NOT_READY);

    const { winner_id, sets_player1, sets_player2, set_scores, result_reason } = input;
    // Un motivo (lesión, abandono, no se presentó, descalificación) siempre
    // es un resultado no jugado: se guarda como walkover + el motivo.
    const walkover = input.walkover === true || !!result_reason;

    if (result_reason === "double_no_show") return fail(BRACKETS_ERRORS.DOUBLE_NO_SHOW_NOT_IN_BRACKET);
    if (!winner_id || (winner_id !== match.player1_id && winner_id !== match.player2_id)) {
      return fail(BRACKETS_ERRORS.INVALID_WINNER);
    }

    if (!walkover) {
      const setsToWin = Math.ceil(match.best_of_sets / 2);
      const winnerSets = winner_id === match.player1_id ? sets_player1 : sets_player2;
      const loserSets  = winner_id === match.player1_id ? sets_player2 : sets_player1;
      if (winnerSets !== setsToWin || loserSets >= setsToWin) {
        return fail(BRACKETS_ERRORS.INVALID_SET_COUNT);
      }
      if (!setScoresMatchAggregate(set_scores, sets_player1, sets_player2, match.points_per_set)) {
        return fail(BRACKETS_ERRORS.INVALID_SET_COUNT);
      }
    }

    const loserId = winner_id === match.player1_id ? match.player2_id : match.player1_id;
    const winnerSetsFor    = winner_id === match.player1_id ? sets_player1 : sets_player2;
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

    await this.repo.setResultReason("bracket", matchId, walkover ? result_reason ?? null : null);
    return ok({ recorded: true, tournamentId: match.id_tournament, categoryId: match.id_category });
  }

  // Deshace un resultado de partido de LLAVE ya cargado (ej: error de
  // digitación) — mismo espíritu que undoGroupMatchResult, pero acá no
  // hay guard de fase (la fase "bracket" dura toda la eliminatoria, a
  // diferencia de "groups"): el guard real vive en el repo, que aborta si
  // el resultado ya avanzó a un partido más adelante que a su vez ya se
  // jugó de verdad.
  async undoBracketMatchResult(
    matchId: string,
    requestedBy: string
  ): Promise<Result<{ undone: true; tournamentId: string; categoryId: string }, BracketsError>> {
    const match = await this.repo.findBracketMatch(matchId);
    if (!match) return fail(BRACKETS_ERRORS.MATCH_NOT_FOUND);
    if (match.status !== "played" && match.status !== "walkover") return fail(BRACKETS_ERRORS.MATCH_NOT_PLAYED);
    if (!match.winner_id) return fail(BRACKETS_ERRORS.MATCH_NOT_PLAYED);

    const winnerIsPlayer1 = match.winner_id === match.player1_id;
    const loserId = winnerIsPlayer1 ? match.player2_id : match.player1_id;
    if (!loserId) return fail(BRACKETS_ERRORS.MATCH_NOT_PLAYED);

    const winnerSetsFor     = winnerIsPlayer1 ? match.sets_player1 : match.sets_player2;
    const winnerSetsAgainst = winnerIsPlayer1 ? match.sets_player2 : match.sets_player1;

    const result = await this.repo.undoBracketMatchResult({
      matchId,
      winnerId: match.winner_id,
      loserId,
      winnerSetsFor,
      winnerSetsAgainst,
      tournamentId: match.id_tournament,
      categoryId: match.id_category,
      requestedBy,
    });
    if (!result.undone) return fail(BRACKETS_ERRORS.BRACKET_RESULT_ALREADY_ADVANCED);

    // Si una corrección de grupo había quedado pendiente porque estos dos ya
    // habían jugado en la llave, ahora que el partido se deshizo la llave se
    // vuelve a cuadrar con sus grupos.
    const goldCategoryId = (await this.repo.getGoldCategoryId(match.id_category)) ?? match.id_category;
    for (const userId of [match.winner_id, loserId]) {
      const groupId = await this.repo.findUserGroup(match.id_tournament, goldCategoryId, userId);
      if (groupId) await this.reconcileGroupWithBrackets(groupId, match.id_tournament, goldCategoryId, requestedBy);
    }

    return ok({ undone: true, tournamentId: match.id_tournament, categoryId: match.id_category });
  }
}
