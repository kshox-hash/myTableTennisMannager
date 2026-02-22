import type { Pool } from "pg";
import DB from "../db/db_configuration";

export class UserRepository {
  private pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool ?? DB.getPool();
  }

  async getMe(id_user: string) {
    const q = `
      SELECT
        u.id_user,
        u.email,
        r.name as role,
        u.created_at
      FROM users u
      JOIN roles r ON r.id_role = u.id_role
      WHERE u.id_user = $1
      LIMIT 1;
    `;
    const res = await this.pool.query(q, [id_user]);
    return res.rows[0] ?? null;
  }
}
