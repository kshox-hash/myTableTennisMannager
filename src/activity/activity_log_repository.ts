import type { Pool, PoolClient } from "pg";
import DB from "../db/db_configuration";

export type ActivityAction =
  | "tournament_cancelled"
  | "tournament_updated"
  | "table_assigned"
  | "table_released"
  | "match_result_undone"
  | "bracket_generated";

export type ActivityLogRow = {
  id_activity: string;
  id_user: string;
  action: ActivityAction;
  detail: string | null;
  created_at: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
};

export class ActivityLogRepository {
  private pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool ?? DB.getPool();
  }

  private runner(client?: PoolClient) {
    return client ?? this.pool;
  }

  async record(
    idTournament: string,
    idUser: string,
    action: ActivityAction,
    detail?: string | null,
    client?: PoolClient
  ): Promise<void> {
    await this.runner(client).query(
      `INSERT INTO activity_log (id_tournament, id_user, action, detail)
       VALUES ($1, $2, $3, $4)`,
      [idTournament, idUser, action, detail ?? null]
    );
  }

  // offset permite "Cargar más" en vez de traer el historial entero del
  // torneo de una — antes solo había un límite fijo (100) sin forma de
  // pedir lo que quedaba después.
  async listByTournament(idTournament: string, limit = 100, offset = 0): Promise<ActivityLogRow[]> {
    const res = await this.pool.query<ActivityLogRow>(
      `SELECT a.id_activity, a.id_user, a.action, a.detail, a.created_at::text,
              u.email, u.first_name, u.last_name
       FROM activity_log a
       JOIN users u ON u.id_user = a.id_user
       WHERE a.id_tournament = $1
       ORDER BY a.created_at DESC
       LIMIT $2 OFFSET $3`,
      [idTournament, limit, offset]
    );
    return res.rows;
  }
}
