import type { Pool } from "pg";
import DB from "../db/db_configuration";
import { ROLE_IDS } from "../core/constants/roles";
import type {
  CreateUserInput,
  UserCreatedDB,
  RoleIdDB,
  UserWithPasswordDB,
  UserAuthProfileDB,
  CreateGoogleUserInput,
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
        category,
        dominant_hand
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
      params.dominant_hand ?? null,
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

  async findAuthProfileByGoogleSub(googleSub: string): Promise<UserAuthProfileDB | null> {
    const query = `
      SELECT u.id_user, u.email, u.gender, u.google_sub, r.name AS role
      FROM ${this.usersTable} u
      JOIN ${this.rolesTable} r ON r.id_role = u.id_role
      WHERE u.google_sub = $1
      LIMIT 1;
    `;
    const res = await this.pool.query<UserAuthProfileDB>(query, [googleSub]);
    return res.rows[0] ?? null;
  }

  async findAuthProfileByEmail(email: string): Promise<UserAuthProfileDB | null> {
    const query = `
      SELECT u.id_user, u.email, u.gender, u.google_sub, r.name AS role
      FROM ${this.usersTable} u
      JOIN ${this.rolesTable} r ON r.id_role = u.id_role
      WHERE u.email = $1
      LIMIT 1;
    `;
    const res = await this.pool.query<UserAuthProfileDB>(query, [email]);
    return res.rows[0] ?? null;
  }

  // Cuenta existente (creada por email/contraseña) que inicia sesión con
  // Google por primera vez — le sumamos el google_sub para reconocerla la
  // próxima vez sin tocar nada más (nombre, club, password, etc. quedan
  // como estaban).
  async linkGoogleSub(id_user: string, googleSub: string): Promise<void> {
    await this.pool.query(`UPDATE ${this.usersTable} SET google_sub = $1 WHERE id_user = $2`, [googleSub, id_user]);
  }

  async createGoogleUser(params: CreateGoogleUserInput): Promise<UserAuthProfileDB> {
    const query = `
      INSERT INTO ${this.usersTable} (
        email, password_hash, id_role, first_name, last_name, google_sub, avatar_url
      )
      VALUES ($1, NULL, $2, $3, $4, $5, $6)
      RETURNING id_user, email, gender, google_sub;
    `;
    const values = [
      params.email,
      ROLE_IDS.player,
      params.first_name ?? null,
      params.last_name ?? null,
      params.google_sub,
      params.avatar_url ?? null,
    ];
    const res = await this.pool.query(query, values);
    return { ...res.rows[0], role: "player" } as UserAuthProfileDB;
  }
}