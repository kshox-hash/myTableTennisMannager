import type { Pool } from "pg";
import DB from "../db/db_configuration";
import { ROLE_IDS } from "../core/constants/roles";
import type {
  CreateUserInput,
  UserCreatedDB,
  RoleIdDB,
  UserWithPasswordDB,
} from "./dto/auth_dto";

export class AuthRepository {
  private pool: Pool;

  private usersTable = "users";
  private rolesTable = "roles";

  constructor(pool?: Pool) {
    this.pool = pool ?? DB.getPool();
  }

  async createUser(params: CreateUserInput): Promise<UserCreatedDB> {
    const query = `
      INSERT INTO ${this.usersTable} (
        email,
        password_hash,
        id_role
      )
      VALUES ($1, $2, $3)
      RETURNING id_user, email, created_at;
    `;

    const values = [
      params.email,
      params.password_hash,
      ROLE_IDS.player,
    ];

    const res = await this.pool.query<UserCreatedDB>(query, values);
    return res.rows[0];
  }

  async findRoleIdByName(name: string): Promise<string> {
    const query = `
      SELECT id_role
      FROM ${this.rolesTable}
      WHERE name = $1
      LIMIT 1;
    `;

    const res = await this.pool.query<RoleIdDB>(query, [name]);

    if (res.rowCount === 0) {
      throw new Error("ROLE_NOT_FOUND");
    }

    return res.rows[0].id_role;
  }

  async findUserByEmail(email: string): Promise<UserWithPasswordDB | null> {
    const query = `
      SELECT
        u.id_user,
        u.email,
        u.password_hash,
        r.name AS role
      FROM ${this.usersTable} u
      JOIN ${this.rolesTable} r
        ON r.id_role = u.id_role
      WHERE u.email = $1
      LIMIT 1;
    `;

    const res = await this.pool.query<UserWithPasswordDB>(query, [email]);

    return res.rows[0] ?? null;
  }
}