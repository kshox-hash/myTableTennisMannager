import type { PoolClient } from "pg";

export class EnrollmentRepository {
  private table = "enrollments";
  private categoriesTable = "tournament_categories";
  private usersTable = "users";
  private rolesTable = "roles";

  async assertUserIsPlayer(client: PoolClient, userId: string) {
    const q = `
      SELECT u.id_user
      FROM ${this.usersTable} u
      JOIN ${this.rolesTable} r ON r.id_role = u.id_role
      WHERE u.id_user = $1 AND r.name = 'player'
      LIMIT 1;
    `;
    const res = await client.query(q, [userId]);
    if (res.rowCount === 0) throw new Error("USER_NOT_PLAYER");
  }

  async lockCategoryRow(client: PoolClient, tournamentId: string, categoryId: string) {
    const q = `
      SELECT id_category, id_tournament, quotas
      FROM ${this.categoriesTable}
      WHERE id_category = $1 AND id_tournament = $2
      FOR UPDATE;
    `;
    const res = await client.query(q, [categoryId, tournamentId]);
    if (res.rowCount === 0) throw new Error("CATEGORY_NOT_FOUND");
    return res.rows[0] as { quotas: number };
  }

  async countActiveByCategory(client: PoolClient, categoryId: string) {
    const q = `
      SELECT COUNT(*)::int AS total
      FROM ${this.table}
      WHERE id_category = $1 AND status = 'active';
    `;
    const res = await client.query(q, [categoryId]);
    return res.rows[0].total as number;
  }

  async create(client: PoolClient, userId: string, tournamentId: string, categoryId: string) {
    const q = `
      INSERT INTO ${this.table} (id_user, id_tournament, id_category, status)
      VALUES ($1, $2, $3, 'active')
      RETURNING *;
    `;
    const res = await client.query(q, [userId, tournamentId, categoryId]);
    return res.rows[0];
  }
}