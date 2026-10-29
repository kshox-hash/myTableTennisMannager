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
  competition_format:   "groups_bracket" | "round_robin";
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
              bracket_start_mode, scheduled_bracket_at, competition_format
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
              bracket_start_mode, scheduled_bracket_at, competition_format, finished_early
       FROM tournament_categories
       WHERE id_tournament = $1
       ORDER BY category_type, category_range`,
      [id_tournament]
    );
    return res.rows;
  }

  // Al salir de inscripción la categoría se cierra sola (también cuando
  // arranca por horario programado): en fase de grupos la inscripción online
  // vuelve a funcionar si el organizador la reabre, así que no puede quedar
  // abierta "de arrastre". Una categoría cancelada no se toca.
  async setPhase(id_category: string, phase: CategoryPhase): Promise<void> {
    await this.pool.query(
      // $1::text en las dos partes: usado como columna y como texto a la vez,
      // Postgres no podía deducir su tipo ("tipos de dato inconsistentes") y
      // TODO cambio de fase fallaba DESPUÉS de crear grupos/llave.
      `UPDATE tournament_categories
       SET phase = $1::text,
           status = CASE WHEN $1::text <> 'enrollment' AND status = 'active' THEN 'closed' ELSE status END
       WHERE id_category = $2`,
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
  // La categoría termina cuando la FINAL (el partido de la última ronda)
  // tiene ganador. Antes se exigía que TODOS los partidos de la llave lo
  // tuvieran: un lugar vacío de pre-llave o un BYE sin cerrar dejaba la
  // categoría "en curso" para siempre, sin podio ni celebración.
  async allBracketMatchesFinished(id_category: string): Promise<boolean> {
    const res = await this.pool.query<{ winner_id: string | null }>(
      `SELECT winner_id FROM bracket_matches
       WHERE id_category = $1
         AND round = (SELECT MAX(round) FROM bracket_matches WHERE id_category = $1)
       ORDER BY match_number ASC
       LIMIT 1`,
      [id_category]
    );
    return res.rows[0]?.winner_id != null;
  }

  // Reparación al arrancar: categorías con la final jugada que quedaron "en
  // curso" (p. ej. por el error del cambio de fase) y categorías terminadas
  // en los últimos 60 días cuyos jugadores no recibieron su celebración.
  async categoriesToRepair(): Promise<{ toFinish: string[]; toNotify: string[] }> {
    const fin = await this.pool.query<{ id_category: string }>(
      `SELECT tc.id_category FROM tournament_categories tc
       WHERE tc.phase = 'bracket'
         AND EXISTS (
           SELECT 1 FROM bracket_matches bm
           WHERE bm.id_category = tc.id_category AND bm.winner_id IS NOT NULL
             AND bm.round = (SELECT MAX(round) FROM bracket_matches b2 WHERE b2.id_category = tc.id_category)
         )`
    );
    const notify = await this.pool.query<{ id_category: string }>(
      `SELECT tc.id_category FROM tournament_categories tc
       JOIN tournaments t ON t.id_tournament = tc.id_tournament
       WHERE tc.phase = 'finished' AND NOT COALESCE(tc.finished_early, false)
         AND COALESCE(t.event_date, t.created_at::date) >= CURRENT_DATE - INTERVAL '60 days'
         AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.id_category = tc.id_category AND n.type = 'final_position')`
    );
    return { toFinish: fin.rows.map((r) => r.id_category), toNotify: notify.rows.map((r) => r.id_category) };
  }

  // Para el job: categorías con inicio programado que aún no arrancaron
  async getPendingScheduled(): Promise<CategoryPhaseRow[]> {
    const res = await this.pool.query<CategoryPhaseRow>(
      `SELECT id_category, id_tournament, category_type, category_range,
              phase, groups_start_mode, scheduled_groups_at,
              bracket_start_mode, scheduled_bracket_at, competition_format
       FROM tournament_categories
       WHERE
         (phase = 'enrollment' AND groups_start_mode  = 'scheduled' AND scheduled_groups_at  <= NOW())
         OR
         (phase = 'groups'     AND bracket_start_mode = 'scheduled' AND scheduled_bracket_at <= NOW())`
    );
    return res.rows;
  }
}
