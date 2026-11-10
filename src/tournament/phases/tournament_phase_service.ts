import { notifyFinalPositions } from "../../notifications/player_outcomes";
import DB from "../../db/db_configuration";
import { TournamentPhaseRepository, type PhaseConfig } from "./tournament_phase_repository";
import { BracketsService } from "../../brackets/brackets_service";
import { BracketsRepository } from "../../brackets/brackets_repository";
import { AdminTournamentRepository } from "../admin/admin_tournament_repository";
import { BRACKETS_ERRORS, type BracketSlotAssignmentInput, type GroupOrderInput } from "../../brackets/dto/brackets_dto";

export const PHASE_ERRORS = {
  CATEGORY_NOT_FOUND:    "CATEGORY_NOT_FOUND",
  WRONG_PHASE:           "WRONG_PHASE",
  GROUPS_NOT_FINISHED:   "GROUPS_NOT_FINISHED",
  BRACKET_NOT_FINISHED:  "BRACKET_NOT_FINISHED",
} as const;

export class TournamentPhaseService {
  // bracketsRepo/adminRepo son opcionales (con default propio) para no
  // romper instanciaciones existentes de TournamentPhaseService — solo
  // hacen falta para el formato "Oro y Plata" (populateSilverBracket).
  constructor(
    private repo: TournamentPhaseRepository,
    private bracketsService: BracketsService,
    private bracketsRepo: BracketsRepository = new BracketsRepository(),
    private adminRepo: AdminTournamentRepository = new AdminTournamentRepository()
  ) {
    // Oro y Plata con la llave adelantada: la Plata se arma cuando termina el
    // último grupo (antes no se sabe quién sale 3°), con el mismo formato de
    // sets que la llave de Oro.
    bracketsService.onAllGroupSlotsFilled = async (tournamentId, categoryId) => {
      const gold = (await this.bracketsRepo.findBracket(tournamentId, categoryId)).find((m) => !m.is_bye);
      await this.populateSilverBracket(categoryId, tournamentId, {
        bestOfSets: (gold?.best_of_sets as 1 | 3 | 5 | 7 | undefined) ?? 5,
        pointsPerSet: (gold?.points_per_set as 11 | 21 | undefined) ?? 11,
      });
    };
  }

  // Formato "Oro y Plata": si `goldCategoryId` tiene una categoría Plata
  // vinculada (silver_category_id), la puebla con el 3° de cada
  // grupo y genera su llave directo (sin pasar por fase de grupos).
  // Se llama una sola vez, justo después de que Oro queda en
  // phase='bracket' (ver advanceToBracket) — no bloquea ni revierte el
  // avance de Oro si algo falla acá, solo se registra en consola.
  private async populateSilverBracket(
    goldCategoryId: string,
    id_tournament: string,
    format: { bestOfSets?: 1 | 3 | 5 | 7; pointsPerSet?: 11 | 21 }
  ): Promise<void> {
    try {
      const r = await this.buildSilver(goldCategoryId, id_tournament, format);
      if (!r.ok) console.error("[TournamentPhaseService.populateSilverBracket]", r.message);
    } catch (error) {
      console.error("[TournamentPhaseService.populateSilverBracket] Error:", error);
    }
  }

  /** Arma la Plata de un Oro: inscribe al 3° de cada grupo (los que vinieron) y genera su llave. */
  private async buildSilver(
    goldCategoryId: string,
    id_tournament: string,
    format: { bestOfSets?: 1 | 3 | 5 | 7; pointsPerSet?: 11 | 21 }
  ): Promise<{ ok: true; players: number } | { ok: false; message: string }> {
    const gold = await this.repo.getCategoryPhase(goldCategoryId);
    if (!gold?.silver_category_id) return { ok: false, message: "Esta categoría no tiene Plata vinculada" };

    // Nadie juega las dos llaves: el que está en la de Oro no va a Plata.
    const inGold = await DB.getPool().query<{ id: string }>(
      `SELECT DISTINCT unnest(ARRAY[player1_id, player2_id]) AS id
         FROM bracket_matches WHERE id_tournament = $1 AND id_category = $2`,
      [id_tournament, goldCategoryId]
    );
    const goldIds = new Set(inGold.rows.map((r) => r.id).filter(Boolean));
    const silverPlayers = (await this.bracketsRepo.loadGroupSilverPlayers(id_tournament, goldCategoryId)).filter(
      (p) => !goldIds.has(p.id_user)
    );
    if (silverPlayers.length < 2) {
      return {
        ok: false,
        message: `Solo hay ${silverPlayers.length} jugador${silverPlayers.length === 1 ? "" : "es"} para Plata (el que sale después de los clasificados en cada grupo, sin contar a los que no vinieron): hacen falta al menos 2.`,
      };
    }

    // La Plata se arma con sus inscritos: los que quedaron de un intento
    // anterior (con otros resultados de grupo) y ya no van, se dan de baja.
    await DB.getPool().query(
      `UPDATE enrollments SET status = 'cancelled'
        WHERE id_tournament = $1 AND id_category = $2 AND status = 'active' AND NOT (id_user = ANY($3::uuid[]))`,
      [id_tournament, gold.silver_category_id, silverPlayers.map((p) => p.id_user)]
    );
    await this.adminRepo.bulkEnrollDirectAdvance(id_tournament, gold.silver_category_id, silverPlayers.map((p) => p.id_user));
    // Semilla de Plata = orden de los grupos (el 3° de GR-1 primero, como en
    // el Oro). Antes quedaba por hora de inscripción, que es la misma para
    // todos: el orden no estaba definido.
    await DB.getPool().query(
      `UPDATE enrollments e SET seed = o.n
         FROM unnest($3::uuid[]) WITH ORDINALITY AS o(id_user, n)
        WHERE e.id_tournament = $1 AND e.id_category = $2 AND e.id_user = o.id_user`,
      [id_tournament, gold.silver_category_id, silverPlayers.map((p) => p.id_user)]
    );
    const result = await this.bracketsService.generateBracket(id_tournament, gold.silver_category_id, {
      best_of_sets: format.bestOfSets ?? 5,
      points_per_set: format.pointsPerSet ?? 11,
    });
    if (!result.ok && result.error !== BRACKETS_ERRORS.BRACKET_ALREADY_EXISTS) {
      return { ok: false, message: `No se pudo generar la llave de Plata (${result.error})` };
    }
    await this.repo.setPhase(gold.silver_category_id, "bracket");
    return { ok: true, players: silverPlayers.length };
  }

  /**
   * "Armar llave de Plata" a mano, desde la categoría Plata: por si no se
   * armó sola (o falló). Necesita que los grupos de Oro hayan terminado.
   */
  async buildSilverNow(silverCategoryId: string, id_tournament: string, rebuild = false, requestedBy?: string) {
    const gold = (
      await DB.getPool().query<{ id_category: string }>(
        `SELECT id_category FROM tournament_categories WHERE silver_category_id = $1 AND id_tournament = $2 LIMIT 1`,
        [silverCategoryId, id_tournament]
      )
    ).rows[0];
    if (!gold) return { ok: false as const, message: "Esta categoría no es la Plata de ninguna categoría de Oro" };

    // Ya armada = tiene partidos con jugadores. Si quedó a medias (en fase
    // llave pero vacía, porque el armado automático falló a mitad de
    // camino), se borra lo vacío y se vuelve a armar.
    const silverRows = await DB.getPool().query<{ with_players: number; total: number; played: number }>(
      `SELECT COUNT(*) FILTER (WHERE player1_id IS NOT NULL OR player2_id IS NOT NULL)::int AS with_players,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status IN ('played', 'walkover') AND NOT is_bye)::int AS played
         FROM bracket_matches WHERE id_tournament = $1 AND id_category = $2`,
      [id_tournament, silverCategoryId]
    );
    const { with_players, total, played } = silverRows.rows[0] ?? { with_players: 0, total: 0, played: 0 };
    if (with_players > 0 && !rebuild) {
      return { ok: false as const, message: "La llave de Plata ya está armada. Si está mal, usa \"Rehacer llave de Plata\"." };
    }
    if (played > 0) {
      return {
        ok: false as const,
        message: `Ya se jugaron ${played} partido${played === 1 ? "" : "s"} de Plata: deshaz esos resultados antes de rehacer la llave.`,
      };
    }
    // Rehacer: la llave vuelve a fase de inscripción y se arma de nuevo.
    if (with_players > 0) await this.repo.setPhase(silverCategoryId, "enrollment");
    if (total > 0) {
      await DB.getPool().query(`DELETE FROM bracket_matches WHERE id_tournament = $1 AND id_category = $2`, [
        id_tournament,
        silverCategoryId,
      ]);
    }
    if (!(await this.repo.allGroupMatchesFinished(gold.id_category))) {
      return { ok: false as const, message: "Todavía hay partidos de grupo sin resultado en la categoría de Oro" };
    }
    const goldMatch = (await this.bracketsRepo.findBracket(id_tournament, gold.id_category)).find((m) => !m.is_bye);
    const built = await this.buildSilver(gold.id_category, id_tournament, {
      bestOfSets: (goldMatch?.best_of_sets as 1 | 3 | 5 | 7 | undefined) ?? 5,
      pointsPerSet: (goldMatch?.points_per_set as 11 | 21 | undefined) ?? 11,
    });
    if (built.ok && requestedBy) {
      await this.bracketsRepo.activityLog.record(
        id_tournament,
        requestedBy,
        with_players > 0 ? "silver_rebuilt" : "bracket_generated",
        with_players > 0 ? `${built.players} jugadores` : "Llave de Plata"
      );
    }
    return built;
  }

  // Obtener estado de todas las categorías de un torneo
  async getTournamentPhases(id_tournament: string) {
    const categories = await this.repo.getCategoriesByTournament(id_tournament);
    return { ok: true as const, data: categories };
  }

  // Guardar configuración de inicio de una categoría
  async saveConfig(id_category: string, config: PhaseConfig) {
    const cat = await this.repo.getCategoryPhase(id_category);
    if (!cat) return { ok: false as const, error: PHASE_ERRORS.CATEGORY_NOT_FOUND };

    await this.repo.saveConfig(id_category, config);
    return { ok: true as const };
  }

  // Avanzar manualmente de enrollment → groups (genera grupos)
  async advanceToGroups(
    id_category: string,
    id_tournament: string,
    bestOfSets: 1 | 3 | 5 | 7 = 3,
    groupOrder?: GroupOrderInput,
    expectedPlayerIds?: string[],
    splitFours: number[] = [],
    pointsPerSet: 11 | 21 = 11,
    groupSizeMode?: "normal" | "fours"
  ) {
    const cat = await this.repo.getCategoryPhase(id_category);
    if (!cat) return { ok: false as const, error: PHASE_ERRORS.CATEGORY_NOT_FOUND };
    if (cat.phase !== "enrollment") return { ok: false as const, error: PHASE_ERRORS.WRONG_PHASE };

    const result = await this.bracketsService.generateGroups(
      id_tournament,
      id_category,
      { best_of_sets: bestOfSets, points_per_set: pointsPerSet, split_fours: splitFours, group_size_mode: groupSizeMode },
      groupOrder,
      expectedPlayerIds
    );
    if (!result.ok) {
      // Recuperación: los grupos quedaron creados pero la fase no avanzó
      // (falló el cambio de fase): se completa en vez de trabar la categoría.
      if (result.error === BRACKETS_ERRORS.GROUPS_ALREADY_EXIST) {
        await this.repo.setPhase(id_category, "groups");
        return { ok: true as const, data: null };
      }
      return result;
    }

    await this.repo.setPhase(id_category, "groups");
    return { ok: true as const, data: result.data };
  }

  // Previsualiza la composición de los grupos (sin persistir) para la
  // pantalla de fixture donde el admin elige el orden de juego antes de
  // confirmar generar los grupos de verdad.
  async previewGroups(
    id_category: string,
    id_tournament: string,
    splitFours: number[] = [],
    groupSizeMode?: "normal" | "fours"
  ) {
    const cat = await this.repo.getCategoryPhase(id_category);
    if (!cat) return { ok: false as const, error: PHASE_ERRORS.CATEGORY_NOT_FOUND };
    if (cat.phase !== "enrollment") return { ok: false as const, error: PHASE_ERRORS.WRONG_PHASE };

    return this.bracketsService.previewGroups(id_tournament, id_category, splitFours, groupSizeMode);
  }

  // Avanzar manualmente de groups → bracket (genera llaves)
  async advanceToBracket(
    id_category: string,
    id_tournament: string,
    opts: { bestOfSets?: 1 | 3 | 5 | 7; pointsPerSet?: 11 | 21; force?: boolean; early?: boolean; bracketSize?: number; slotAssignment?: BracketSlotAssignmentInput }
  ) {
    const cat = await this.repo.getCategoryPhase(id_category);
    if (!cat) return { ok: false as const, error: PHASE_ERRORS.CATEGORY_NOT_FOUND };
    if (cat.phase !== "groups") return { ok: false as const, error: PHASE_ERRORS.WRONG_PHASE };
    if (cat.competition_format === "round_robin") {
      return { ok: false as const, error: "Esta categoría es de grupo único: no tiene llave eliminatoria" };
    }

    // Si no es force, verificar que todos los partidos de grupo tengan
    // resultado, salvo al adelantar la llave. Con Oro y Plata también se
    // puede: la Plata se arma sola cuando termina el último grupo (ver
    // onAllGroupSlotsFilled en el constructor).
    const canAdvanceEarly = opts.early === true;
    const groupsDone = await this.repo.allGroupMatchesFinished(id_category);
    if (!opts.force && !canAdvanceEarly && !groupsDone) {
      return { ok: false as const, error: PHASE_ERRORS.GROUPS_NOT_FINISHED };
    }
    // Plata ahora solo si ya terminaron todos los grupos; si no, al terminar el último.
    const silverNow = groupsDone || !canAdvanceEarly;

    const result = await this.bracketsService.generateBracket(
      id_tournament,
      id_category,
      {
        best_of_sets: opts.bestOfSets ?? 5,
        points_per_set: opts.pointsPerSet ?? 11,
        bracket_size: opts.bracketSize,
        early: canAdvanceEarly,
      },
      opts.slotAssignment
    );
    if (!result.ok) {
      // Recuperación: la llave quedó creada pero la fase siguió en "groups"
      // (falló el cambio de fase): se completa en vez de responder "ya
      // existe" y dejar la pestaña Llave trabada.
      if (result.error === BRACKETS_ERRORS.BRACKET_ALREADY_EXISTS) {
        await this.repo.setPhase(id_category, "bracket");
        if (silverNow) await this.populateSilverBracket(id_category, id_tournament, opts);
        return { ok: true as const, data: null };
      }
      return result;
    }

    await this.repo.setPhase(id_category, "bracket");
    if (silverNow) await this.populateSilverBracket(id_category, id_tournament, opts);
    return { ok: true as const, data: result.data };
  }

  // Previsualiza el sorteo (semillas + BYE + sorteo por banda) sin persistir
  // nada, para la pantalla "Sembrar / Sorteo" previa a confirmar el cuadro.
  // `force`: igual que en advanceToBracket, permite previsualizar (y luego
  // confirmar) aunque todavía haya partidos de grupo sin resultado.
  async previewBracket(id_category: string, id_tournament: string, force = false, bracketSize?: number) {
    const cat = await this.repo.getCategoryPhase(id_category);
    if (!cat) return { ok: false as const, error: PHASE_ERRORS.CATEGORY_NOT_FOUND };
    if (cat.phase !== "groups") return { ok: false as const, error: PHASE_ERRORS.WRONG_PHASE };

    // Con grupos en juego se previsualiza la llave adelantada (también con
    // Oro y Plata: la Plata se arma al terminar el último grupo).
    let early = false;
    if (!force) early = !(await this.repo.allGroupMatchesFinished(id_category));

    return this.bracketsService.previewBracket(id_tournament, id_category, bracketSize, early);
  }

  // Marcar categoría como finalizada
  async finishCategory(id_category: string) {
    const cat = await this.repo.getCategoryPhase(id_category);
    if (!cat) return { ok: false as const, error: PHASE_ERRORS.CATEGORY_NOT_FOUND };
    if (cat.phase !== "bracket") return { ok: false as const, error: PHASE_ERRORS.WRONG_PHASE };

    await this.repo.setPhase(id_category, "finished");
    void notifyFinalPositions(id_category);
    return { ok: true as const };
  }

  // Llamado tras registrar resultado de partido de grupo (auto-advance)
  async checkGroupAutoAdvance(id_category: string, id_tournament: string) {
    const cat = await this.repo.getCategoryPhase(id_category);
    if (!cat || cat.phase !== "groups") return;

    // Grupo único: no hay llave — al jugarse el último partido la
    // categoría termina y el podio sale de la tabla del grupo.
    if (cat.competition_format === "round_robin") {
      if (await this.repo.allGroupMatchesFinished(id_category)) {
        await this.repo.setPhase(id_category, "finished");
    void notifyFinalPositions(id_category);
      }
      return;
    }

    if (cat.bracket_start_mode !== "auto") return;

    const done = await this.repo.allGroupMatchesFinished(id_category);
    if (!done) return;

    await this.advanceToBracket(id_category, id_tournament, { force: true });
  }

  // Al arrancar el servidor: termina las categorías con la final jugada que
  // quedaron "en curso" y manda las celebraciones que faltan (idempotente:
  // notifyFinalPositions no repite a quien ya avisó).
  async repairFinishedCategories(): Promise<void> {
    try {
      const { toFinish, toNotify } = await this.repo.categoriesToRepair();
      for (const id of toFinish) {
        await this.repo.setPhase(id, "finished");
        await notifyFinalPositions(id);
      }
      for (const id of toNotify) await notifyFinalPositions(id);
      if (toFinish.length || toNotify.length) {
        console.log(`[phases] reparadas: ${toFinish.length} terminadas, ${toNotify.length} con celebración pendiente`);
      }
    } catch (err) {
      console.error("[phases] repairFinishedCategories", err);
    }
  }

  // Llamado tras registrar resultado de partido de llave (auto-finish)
  async checkBracketAutoFinish(id_category: string) {
    const cat = await this.repo.getCategoryPhase(id_category);
    if (!cat || cat.phase !== "bracket") return;

    const done = await this.repo.allBracketMatchesFinished(id_category);
    if (!done) return;

    await this.repo.setPhase(id_category, "finished");
    void notifyFinalPositions(id_category);
  }

  // Job: revisar categorías con inicio programado
  async processScheduled() {
    const pending = await this.repo.getPendingScheduled();

    for (const cat of pending) {
      if (cat.phase === "enrollment") {
        await this.advanceToGroups(cat.id_category, cat.id_tournament).catch(() => {});
      } else if (cat.phase === "groups") {
        await this.advanceToBracket(cat.id_category, cat.id_tournament, { force: true }).catch(() => {});
      }
    }
  }
}
