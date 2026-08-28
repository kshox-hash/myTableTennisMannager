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

    // Stats por categoría — subconsultas escalares en vez de LEFT JOIN +
    // GROUP BY: unir enrollments, group_matches Y bracket_matches directo
    // contra tournament_categories producía el producto cruzado de las
    // tres tablas por cada categoría ANTES de que el GROUP BY lo volviera
    // a juntar (mismo bug ya arreglado en public_tournament_repository.ts
    // y admin_tournament_repository.ts, acá con tres joins fanning en vez
    // de dos).
    //
    // Las subconsultas de group_matches repiten `cg.id_tournament = $1`
    // a propósito, aunque ya se sepa por el WHERE de afuera: category_groups
    // solo tiene el índice compuesto (id_tournament, id_category) — sin la
    // columna líder, Postgres no puede usarlo para filtrar por id_category
    // sola y cae a Seq Scan. Verificado con EXPLAIN ANALYZE: la primera
    // versión (solo id_category) terminaba escaneando group_matches entera
    // y salía MÁS LENTA que el LEFT JOIN original (35ms vs 4.5ms) — esta
    // versión, con las dos columnas, usa el índice como corresponde.
    const catRes = await this.pool.query<CategoryDashboard>(
      `SELECT
         tc.id_category,
         tc.category_type,
         tc.category_range,
         tc.gender,
         COALESCE(tc.phase, 'enrollment') AS phase,

         (SELECT COUNT(*) FROM enrollments e
          WHERE e.id_category = tc.id_category AND e.status = 'active') AS enrolled,

         (SELECT COUNT(*) FROM group_matches gm
          JOIN category_groups cg ON cg.id_group = gm.id_group
          WHERE cg.id_tournament = $1 AND cg.id_category = tc.id_category) AS group_matches_total,
         (SELECT COUNT(*) FROM group_matches gm
          JOIN category_groups cg ON cg.id_group = gm.id_group
          WHERE cg.id_tournament = $1 AND cg.id_category = tc.id_category AND gm.winner_id IS NOT NULL) AS group_matches_played,

         (SELECT COUNT(*) FROM bracket_matches bm
          WHERE bm.id_tournament = $1 AND bm.id_category = tc.id_category) AS bracket_matches_total,
         (SELECT COUNT(*) FROM bracket_matches bm
          WHERE bm.id_tournament = $1 AND bm.id_category = tc.id_category AND bm.winner_id IS NOT NULL) AS bracket_matches_played

       FROM tournament_categories tc
       WHERE tc.id_tournament = $1
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
