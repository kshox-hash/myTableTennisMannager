import type { Pool } from "pg";
import DB from "../db/db_configuration";
import type { RoleName } from "../interfaces/dto/auth_dto";

export class AuthRepository {
  private pool: Pool;

  private usersTable = "users";
  private rolesTable = "roles";

  constructor(pool?: Pool) {
    this.pool = pool ?? DB.getPool();
  }

  async findRoleIdByName(name: RoleName): Promise<string> {
    const q = `SELECT id_role FROM ${this.rolesTable} WHERE name = $1 LIMIT 1;`;
    const res = await this.pool.query(q, [name]);
    if (res.rowCount === 0) throw new Error("ROLE_NOT_FOUND");
    return res.rows[0].id_role;
  }

  async findUserByEmail(email: string) {
    const q = `
      SELECT
        u.id_user,
        u.email,
        u.password_hash,
        r.name as role
      FROM ${this.usersTable} u
      JOIN ${this.rolesTable} r ON r.id_role = u.id_role
      WHERE u.email = $1
      LIMIT 1;
    `;
    const res = await this.pool.query(q, [email]);
    return res.rows[0] ?? null;
  }

  async createUser(params: { email: string; password_hash: string; id_role: string }) {
    const q = `
      INSERT INTO ${this.usersTable} (email, password_hash, id_role)
      VALUES ($1, $2, $3)
      RETURNING id_user, email, created_at;
    `;
    const res = await this.pool.query(q, [params.email, params.password_hash, params.id_role]);
    return res.rows[0];
  }
}
