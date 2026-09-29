import type { Pool } from "pg";
import DB from "../db/db_configuration";

export type CalendarEventRow = {
  date: string;
  type: "tournament";
  tournament_id: string;
  tournament_name: string;
  address: string | null;
  category_id: string;
  category_type: string;
  category_range: string;
  gender: string;
  status: string;
  phase: string;
};

export class CalendarRepository {
  private pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool ?? DB.getPool();
  }

  async myEventsInRange(userId: string, from: string, to: string): Promise<CalendarEventRow[]> {
    // Si la categoría ya terminó, el evento va en el día en que de verdad se
    // jugó (último partido), no en la fecha agendada: un campeonato que se
    // adelantó y ya se jugó no debe seguir apareciendo como "próximo".
    const q = `
      WITH ev AS (
        SELECT
          CASE
            WHEN c.phase = 'finished' THEN COALESCE(
              (SELECT MAX(x.played_at)::date FROM (
                 SELECT gm.played_at FROM group_matches gm
                   JOIN category_groups cg ON cg.id_group = gm.id_group
                  WHERE cg.id_category = c.id_category
                 UNION ALL
                 SELECT bm.played_at FROM bracket_matches bm WHERE bm.id_category = c.id_category
               ) x),
              t.event_date)
            ELSE t.event_date
          END                AS day,
          t.id_tournament    AS tournament_id,
          t.tournament_name,
          t.address,
          c.id_category      AS category_id,
          c.category_type,
          c.category_range,
          c.gender,
          c.phase,
          e.status
        FROM enrollments e
        JOIN tournament_categories c ON c.id_category = e.id_category
        JOIN tournaments t           ON t.id_tournament = e.id_tournament
        WHERE e.id_user = $1
          AND e.status = 'active'
      )
      SELECT day::text AS date, 'tournament' AS type, tournament_id, tournament_name, address,
             category_id, category_type, category_range, gender, phase, status
        FROM ev
       WHERE day >= $2::date AND day <= $3::date
       ORDER BY day ASC, tournament_name ASC, category_type ASC, category_range ASC;
    `;

    const res = await this.pool.query(q, [userId, from, to]);
    return res.rows as CalendarEventRow[];
  }
}
