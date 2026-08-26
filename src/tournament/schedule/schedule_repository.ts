import type { Pool } from "pg";
import DB from "../../db/db_configuration";
import type { ScheduleMatchInput } from "./schedule_logic";

export class ScheduleRepository {
  private pool: Pool;
  constructor(pool?: Pool) {
    this.pool = pool ?? DB.getPool();
  }

  async getNumTables(id_tournament: string): Promise<number> {
    const res = await this.pool.query<{ num_tables: number }>(
      `SELECT COALESCE(num_tables, 4) AS num_tables FROM tournaments WHERE id_tournament = $1`,
      [id_tournament]
    );
    return Number(res.rows[0]?.num_tables ?? 4);
  }

  // Todos los partidos de grupo sin resultado todavía, de cualquier
  // categoría del torneo que ya esté en fase de grupos — es lo que la
  // "programación" tiene sentido de proyectar (partidos de llave no entran:
  // sus emparejamientos dependen de resultados que todavía no existen).
  async getPendingGroupMatches(id_tournament: string): Promise<ScheduleMatchInput[]> {
    const res = await this.pool.query<ScheduleMatchInput>(
      `SELECT
         gm.id_match, 'group' AS match_type,
         tc.id_category, tc.category_type, tc.category_range,
         cg.group_name, NULL::int AS round, gm.match_number,
         gm.player1_id, gm.player2_id
       FROM group_matches gm
       JOIN category_groups cg ON cg.id_group = gm.id_group
       JOIN tournament_categories tc ON tc.id_category = cg.id_category
       WHERE cg.id_tournament = $1
         AND gm.status = 'scheduled'
         AND gm.player1_id IS NOT NULL AND gm.player2_id IS NOT NULL
       ORDER BY tc.category_type, cg.sort_order, gm.match_number`,
      [id_tournament]
    );
    return res.rows;
  }
}
