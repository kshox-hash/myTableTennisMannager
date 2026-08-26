import type { Pool } from "pg";
import DB from "../../db/db_configuration";

export type CategoryDashboard = {
  id_category:            string;
  category_type:          string;
  category_range:         string;
  gender:                 string;
  phase:                  string;
  enrolled:               number;
  group_matches_total:    number;
  group_matches_played:   number;
  bracket_matches_total:  number;
  bracket_matches_played: number;
};

export type TournamentDashboard = {
  id_tournament:   string;
  tournament_name: string;
  event_date:      string | null;
  event_time:      string | null;
  address:         string | null;
  region:          string | null;
  categories:      CategoryDashboard[];
  totals: {
    enrolled:        number;
    matches_total:   number;
    matches_played:  number;
  };
};

export class TournamentDashboardRepository {
  private pool: Pool;
  constructor(pool?: Pool) { this.pool = pool ?? DB.getPool(); }

  async getDashboard(id_tournament: string): Promise<TournamentDashboard | null> {
    // Torneo base
    const tRes = await this.pool.query<{
      id_tournament: string; tournament_name: string;
      event_date: string | null; event_time: string | null;
      address: string | null; region: string | null;
    }>(
      `SELECT id_tournament, tournament_name, event_date, event_time, address, region
       FROM tournaments WHERE id_tournament = $1`,
      [id_tournament]
    );
    if (tRes.rowCount === 0) return null;
    const t = tRes.rows[0];

    // Stats por categoría en una sola query
    const catRes = await this.pool.query<CategoryDashboard>(
      `SELECT
         tc.id_category,
         tc.category_type,
         tc.category_range,
         tc.gender,
         COALESCE(tc.phase, 'enrollment') AS phase,

         -- Inscritos activos
         COUNT(DISTINCT e.id_user) FILTER (WHERE e.status = 'active') AS enrolled,

         -- Partidos de grupo
         COUNT(DISTINCT gm.id_match)                                    AS group_matches_total,
         COUNT(DISTINCT gm.id_match) FILTER (WHERE gm.winner_id IS NOT NULL) AS group_matches_played,

         -- Partidos de llave
         COUNT(DISTINCT bm.id_match)                                    AS bracket_matches_total,
         COUNT(DISTINCT bm.id_match) FILTER (WHERE bm.winner_id IS NOT NULL) AS bracket_matches_played

       FROM tournament_categories tc
       LEFT JOIN enrollments e
              ON e.id_category = tc.id_category
       LEFT JOIN category_groups cg
              ON cg.id_category = tc.id_category
       LEFT JOIN group_matches gm
              ON gm.id_group = cg.id_group
       LEFT JOIN bracket_matches bm
              ON bm.id_category = tc.id_category
       WHERE tc.id_tournament = $1
       GROUP BY tc.id_category, tc.category_type, tc.category_range, tc.gender, tc.phase
       ORDER BY tc.category_type, tc.category_range`,
      [id_tournament]
    );

    const categories: CategoryDashboard[] = catRes.rows.map(r => ({
      ...r,
      enrolled:               Number(r.enrolled),
      group_matches_total:    Number(r.group_matches_total),
      group_matches_played:   Number(r.group_matches_played),
      bracket_matches_total:  Number(r.bracket_matches_total),
      bracket_matches_played: Number(r.bracket_matches_played),
    }));

    const totals = categories.reduce(
      (acc, c) => ({
        enrolled:       acc.enrolled       + c.enrolled,
        matches_total:  acc.matches_total  + c.group_matches_total  + c.bracket_matches_total,
        matches_played: acc.matches_played + c.group_matches_played + c.bracket_matches_played,
      }),
      { enrolled: 0, matches_total: 0, matches_played: 0 }
    );

    return { ...t, categories, totals };
  }
}
