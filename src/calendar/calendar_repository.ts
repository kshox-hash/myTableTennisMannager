import type { Pool } from "pg";
import DB from "../db/db_configuration";

export type CalendarEventRow = {
  date: string; // YYYY-MM-DD
  type: "tournament";
  tournament_id: string;
  tournament_name: string;
  location: string | null;

  category_id: string;
  category_name: string;
  gender: string;
  status: string; // enrollment status
};

export class CalendarRepository {
  private pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool ?? DB.getPool();
  }

  async myEventsInRange(userId: string, from: string, to: string): Promise<CalendarEventRow[]> {
    const q = `
      SELECT
        t.event_date::text as date,
        'tournament' as type,
        t.id_tournament as tournament_id,
        t.tournament_name,
        t.location,

        c.id_category as category_id,
        c.category_name,
        c.gender,

        e.status
      FROM enrollments e
      JOIN tournament_categories c ON c.id_category = e.id_category
      JOIN tournaments t ON t.id_tournament = e.id_tournament
      WHERE e.id_user = $1
        AND e.status = 'active'
        AND t.event_date >= $2::date
        AND t.event_date <= $3::date
      ORDER BY t.event_date ASC, t.tournament_name ASC, c.category_name ASC;
    `;

    const res = await this.pool.query(q, [userId, from, to]);
    return res.rows as CalendarEventRow[];
  }
}
