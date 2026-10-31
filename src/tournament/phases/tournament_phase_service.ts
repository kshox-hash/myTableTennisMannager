import { notifyFinalPositions } from "../../notifications/player_outcomes";
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
  ) {}

  // Formato "Oro y Plata": si `goldCategoryId` tiene una categoría Plata
  // vinculada (silver_category_id), la puebla con el 3° de cada
  // grupo y genera su llave directo (sin pasar por fase de grupos).
  // Se llama una sola vez, justo después de que Oro queda en
  // phase='bracket' (ver advanceToBracket) — no bloquea ni revierte el
  // avance de Oro si algo falla acá, solo se registra en consola.
  private async populateSilverBracket(goldCategoryId: string, id_tournament: string): Promise<void> {
    try {
      const gold = await this.repo.getCategoryPhase(goldCategoryId);
      if (!gold?.silver_category_id) return;

      const silverPlayers = await this.bracketsRepo.loadGroupSilverPlayers(id_tournament, goldCategoryId);
      if (silverPlayers.length < 2) return; // sin al menos 2, no hay llave de Plata posible

      await this.adminRepo.bulkEnrollDirectAdvance(
        id_tournament,
        gold.silver_category_id,
        silverPlayers.map((p) => p.id_user)
      );
      const result = await this.bracketsService.generateBracket(id_tournament, gold.silver_category_id, { best_of_sets: 5 });
      if (result.ok || result.error === BRACKETS_ERRORS.BRACKET_ALREADY_EXISTS) {
        await this.repo.setPhase(gold.silver_category_id, "bracket");
      } else {
        console.error("[TournamentPhaseService.populateSilverBracket] generateBracket falló:", result.error);
      }
    } catch (error) {
      console.error("[TournamentPhaseService.populateSilverBracket] Error:", error);
    }
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
    opts: { bestOfSets?: 1 | 3 | 5 | 7; pointsPerSet?: 11 | 21; force?: boolean; slotAssignment?: BracketSlotAssignmentInput }
  ) {
    const cat = await this.repo.getCategoryPhase(id_category);
    if (!cat) return { ok: false as const, error: PHASE_ERRORS.CATEGORY_NOT_FOUND };
    if (cat.phase !== "groups") return { ok: false as const, error: PHASE_ERRORS.WRONG_PHASE };
    if (cat.competition_format === "round_robin") {
      return { ok: false as const, error: "Esta categoría es de grupo único: no tiene llave eliminatoria" };
    }

    // Si no es force, verificar que todos los partidos de grupo tengan resultado
    if (!opts.force) {
      const done = await this.repo.allGroupMatchesFinished(id_category);
      if (!done) return { ok: false as const, error: PHASE_ERRORS.GROUPS_NOT_FINISHED };
    }

    const result = await this.bracketsService.generateBracket(
      id_tournament,
      id_category,
      { best_of_sets: opts.bestOfSets ?? 5, points_per_set: opts.pointsPerSet ?? 11 },
      opts.slotAssignment
    );
    if (!result.ok) {
      // Recuperación: la llave quedó creada pero la fase siguió en "groups"
      // (falló el cambio de fase): se completa en vez de responder "ya
      // existe" y dejar la pestaña Llave trabada.
      if (result.error === BRACKETS_ERRORS.BRACKET_ALREADY_EXISTS) {
        await this.repo.setPhase(id_category, "bracket");
        await this.populateSilverBracket(id_category, id_tournament);
        return { ok: true as const, data: null };
      }
      return result;
    }

    await this.repo.setPhase(id_category, "bracket");
    await this.populateSilverBracket(id_category, id_tournament);
    return { ok: true as const, data: result.data };
  }

  // Previsualiza el sorteo (semillas + BYE + sorteo por banda) sin persistir
  // nada, para la pantalla "Sembrar / Sorteo" previa a confirmar el cuadro.
  // `force`: igual que en advanceToBracket, permite previsualizar (y luego
  // confirmar) aunque todavía haya partidos de grupo sin resultado.
  async previewBracket(id_category: string, id_tournament: string, force = false) {
    const cat = await this.repo.getCategoryPhase(id_category);
    if (!cat) return { ok: false as const, error: PHASE_ERRORS.CATEGORY_NOT_FOUND };
    if (cat.phase !== "groups") return { ok: false as const, error: PHASE_ERRORS.WRONG_PHASE };

    if (!force) {
      const done = await this.repo.allGroupMatchesFinished(id_category);
      if (!done) return { ok: false as const, error: PHASE_ERRORS.GROUPS_NOT_FINISHED };
    }

    return this.bracketsService.previewBracket(id_tournament, id_category);
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
