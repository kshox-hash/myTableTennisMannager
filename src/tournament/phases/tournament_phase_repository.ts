import type { Pool } from "pg";
import DB from "../../db/db_configuration";

export type CategoryPhase = "enrollment" | "groups" | "bracket" | "finished";
export type StartMode    = "manual" | "auto" | "scheduled";

export type CategoryPhaseRow = {
  id_category:          string;
  id_tournament:        string;
  category_type:        string;
  category_range:       string;
  phase:                CategoryPhase;
  groups_start_mode:    StartMode;
  scheduled_groups_at:  string | null;
  bracket_start_mode:   StartMode;
  scheduled_bracket_at: string | null;
};

export type PhaseConfig = {
  groups_start_mode:    StartMode;
  scheduled_groups_at?: string | null;
  bracket_start_mode:   StartMode;
  scheduled_bracket_at?: string | null;
};

export class TournamentPhaseRepository {
  private pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool ?? DB.getPool();
  }

  async getCategoryPhase(id_category: string): Promise<CategoryPhaseRow | null> {
    const res = await this.pool.query<CategoryPhaseRow>(
      `SELECT id_category, id_tournament, category_type, category_range,
              phase, groups_start_mode, scheduled_groups_at,
              bracket_start_mode, scheduled_bracket_at
       FROM tournament_categories
       WHERE id_category = $1`,
      [id_category]
    );
    return res.rows[0] ?? null;
  }

  async getCategoriesByTournament(id_tournament: string): Promise<CategoryPhaseRow[]> {
    const res = await this.pool.query<CategoryPhaseRow>(
      `SELECT id_category, id_tournament, category_type, category_range,
              phase, groups_start_mode, scheduled_groups_at,
              bracket_start_mode, scheduled_bracket_at
       FROM tournament_categories
       WHERE id_tournament = $1
       ORDER BY category_type, category_range`,
      [id_tournament]
    );
    return res.rows;
  }

  async setPhase(id_category: string, phase: CategoryPhase): Promise<void> {
    await this.pool.query(
      `UPDATE tournament_categories SET phase = $1 WHERE id_category = $2`,
      [phase, id_category]
    );
  }

  async saveConfig(id_category: string, config: PhaseConfig): Promise<void> {
    await this.pool.query(
      `UPDATE tournament_categories
       SET groups_start_mode    = $1,
           scheduled_groups_at  = $2,
           bracket_start_mode   = $3,
           scheduled_bracket_at = $4
       WHERE id_category = $5`,
      [
        config.groups_start_mode,
        config.scheduled_groups_at ?? null,
        config.bracket_start_mode,
        config.scheduled_bracket_at ?? null,
        id_category,
      ]
    );
  }

  // Verifica si todos los partidos de grupo tienen resultado
  async allGroupMatchesFinished(id_category: string): Promise<boolean> {
    const res = await this.pool.query<{ total: string; finished: string }>(
      `SELECT
         COUNT(*)                                    AS total,
         COUNT(*) FILTER (WHERE winner_id IS NOT NULL) AS finished
       FROM group_matches gm
       JOIN category_groups cg ON cg.id_group = gm.id_group
       WHERE cg.id_category = $1`,
      [id_category]
    );
    const { total, finished } = res.rows[0];
    return parseInt(total) > 0 && total === finished;
  }

  // Verifica si todos los partidos de llaves tienen resultado
  async allBracketMatchesFinished(id_category: string): Promise<boolean> {
    const res = await this.pool.query<{ total: string; finished: string }>(
      `SELECT
         COUNT(*)                                    AS total,
         COUNT(*) FILTER (WHERE winner_id IS NOT NULL) AS finished
       FROM bracket_matches
       WHERE id_category = $1`,
      [id_category]
    );
    const { total, finished } = res.rows[0];
    return parseInt(total) > 0 && total === finished;
  }

  // Para el job: categorías con inicio programado que aún no arrancaron
  async getPendingScheduled(): Promise<CategoryPhaseRow[]> {
    const res = await this.pool.query<CategoryPhaseRow>(
      `SELECT id_category, id_tournament, category_type, category_range,
              phase, groups_start_mode, scheduled_groups_at,
              bracket_start_mode, scheduled_bracket_at
       FROM tournament_categories
       WHERE
         (phase = 'enrollment' AND groups_start_mode  = 'scheduled' AND scheduled_groups_at  <= NOW())
         OR
         (phase = 'groups'     AND bracket_start_mode = 'scheduled' AND scheduled_bracket_at <= NOW())`
    );
    return res.rows;
  }
}
