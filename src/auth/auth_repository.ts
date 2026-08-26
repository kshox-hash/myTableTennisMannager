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

  private async findOrCreateClub(clubName: string): Promise<string> {
    const existing = await this.pool.query<{ id_club: string }>(
      `SELECT id_club FROM clubs WHERE LOWER(name) = LOWER($1) LIMIT 1`,
      [clubName]
    );
    if (existing.rows[0]) return existing.rows[0].id_club;

    const created = await this.pool.query<{ id_club: string }>(
      `INSERT INTO clubs (name) VALUES ($1) RETURNING id_club`,
      [clubName]
    );
    return created.rows[0].id_club;
  }

  async createUser(params: CreateUserInput): Promise<UserCreatedDB> {
    const idClub = params.club_name ? await this.findOrCreateClub(params.club_name) : null;

    const query = `
      INSERT INTO ${this.usersTable} (
        email,
        password_hash,
        id_role,
        first_name,
        last_name,
        gender,
        id_club,
        birth_date,
        country,
        id_document,
        category
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id_user, email, created_at;
    `;

    const values = [
      params.email,
      params.password_hash,
      params.id_role ?? ROLE_IDS.player,
      params.first_name ?? null,
      params.last_name ?? null,
      params.gender ?? null,
      idClub,
      params.birth_date ?? null,
      params.country ?? null,
      params.id_document ?? null,
      params.category ?? null,
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