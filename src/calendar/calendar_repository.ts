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
};

export class CalendarRepository {
  private pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool ?? DB.getPool();
  }

  async myEventsInRange(userId: string, from: string, to: string): Promise<CalendarEventRow[]> {
    const q = `
      SELECT
        t.event_date::text AS date,
        'tournament'       AS type,
        t.id_tournament    AS tournament_id,
        t.tournament_name,
        t.address,

        c.id_category      AS category_id,
        c.category_type,
        c.category_range,
        c.gender,

        e.status
      FROM enrollments e
      JOIN tournament_categories c ON c.id_category = e.id_category
      JOIN tournaments t           ON t.id_tournament = e.id_tournament
      WHERE e.id_user = $1
        AND e.status = 'active'
        AND t.event_date >= $2::date
        AND t.event_date <= $3::date
      ORDER BY t.event_date ASC, t.tournament_name ASC, c.category_type ASC, c.category_range ASC;
    `;

    const res = await this.pool.query(q, [userId, from, to]);
    return res.rows as CalendarEventRow[];
  }
}
