import { TournamentPhaseRepository, type PhaseConfig } from "./tournament_phase_repository";
import { BracketsService } from "../../brackets/brackets_service";
import type { BracketSlotAssignmentInput, GroupOrderInput } from "../../brackets/dto/brackets_dto";

export const PHASE_ERRORS = {
  CATEGORY_NOT_FOUND:    "CATEGORY_NOT_FOUND",
  WRONG_PHASE:           "WRONG_PHASE",
  GROUPS_NOT_FINISHED:   "GROUPS_NOT_FINISHED",
  BRACKET_NOT_FINISHED:  "BRACKET_NOT_FINISHED",
} as const;

export class TournamentPhaseService {
  constructor(
    private repo: TournamentPhaseRepository,
    private bracketsService: BracketsService
  ) {}

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
    bestOfSets: 3 | 5 | 7 = 3,
    groupOrder?: GroupOrderInput
  ) {
    const cat = await this.repo.getCategoryPhase(id_category);
    if (!cat) return { ok: false as const, error: PHASE_ERRORS.CATEGORY_NOT_FOUND };
    if (cat.phase !== "enrollment") return { ok: false as const, error: PHASE_ERRORS.WRONG_PHASE };

    const result = await this.bracketsService.generateGroups(
      id_tournament,
      id_category,
      { best_of_sets: bestOfSets },
      groupOrder
    );
    if (!result.ok) return result;

    await this.repo.setPhase(id_category, "groups");
    return { ok: true as const, data: result.data };
  }

  // Previsualiza la composición de los grupos (sin persistir) para la
  // pantalla de fixture donde el admin elige el orden de juego antes de
  // confirmar generar los grupos de verdad.
  async previewGroups(id_category: string, id_tournament: string) {
    const cat = await this.repo.getCategoryPhase(id_category);
    if (!cat) return { ok: false as const, error: PHASE_ERRORS.CATEGORY_NOT_FOUND };
    if (cat.phase !== "enrollment") return { ok: false as const, error: PHASE_ERRORS.WRONG_PHASE };

    return this.bracketsService.previewGroups(id_tournament, id_category);
  }

  // Avanzar manualmente de groups → bracket (genera llaves)
  async advanceToBracket(
    id_category: string,
    id_tournament: string,
    opts: { bestOfSets?: 3 | 5 | 7; force?: boolean; slotAssignment?: BracketSlotAssignmentInput }
  ) {
    const cat = await this.repo.getCategoryPhase(id_category);
    if (!cat) return { ok: false as const, error: PHASE_ERRORS.CATEGORY_NOT_FOUND };
    if (cat.phase !== "groups") return { ok: false as const, error: PHASE_ERRORS.WRONG_PHASE };

    // Si no es force, verificar que todos los partidos de grupo tengan resultado
    if (!opts.force) {
      const done = await this.repo.allGroupMatchesFinished(id_category);
      if (!done) return { ok: false as const, error: PHASE_ERRORS.GROUPS_NOT_FINISHED };
    }

    const result = await this.bracketsService.generateBracket(
      id_tournament,
      id_category,
      { best_of_sets: opts.bestOfSets ?? 5 },
      opts.slotAssignment
    );
    if (!result.ok) return result;

    await this.repo.setPhase(id_category, "bracket");
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
    return { ok: true as const };
  }

  // Llamado tras registrar resultado de partido de grupo (auto-advance)
  async checkGroupAutoAdvance(id_category: string, id_tournament: string) {
    const cat = await this.repo.getCategoryPhase(id_category);
    if (!cat || cat.phase !== "groups") return;
    if (cat.bracket_start_mode !== "auto") return;

    const done = await this.repo.allGroupMatchesFinished(id_category);
    if (!done) return;

    await this.advanceToBracket(id_category, id_tournament, { force: true });
  }

  // Llamado tras registrar resultado de partido de llave (auto-finish)
  async checkBracketAutoFinish(id_category: string) {
    const cat = await this.repo.getCategoryPhase(id_category);
    if (!cat || cat.phase !== "bracket") return;

    const done = await this.repo.allBracketMatchesFinished(id_category);
    if (!done) return;

    await this.repo.setPhase(id_category, "finished");
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
