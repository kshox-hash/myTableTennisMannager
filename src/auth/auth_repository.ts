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

  // Solo empareja/crea clubes SIN dueño (texto libre de antes del sistema
  // de solicitudes — ver clubs_repository.ts). Antes buscaba por nombre
  // contra CUALQUIER club, incluidos los que un admin ya creó y cura con
  // aprobación manual — un jugador podía escribir el nombre exacto de un
  // club real y quedar adentro directo, sin pasar por la solicitud que el
  // dueño tiene que aceptar. Un club con dueño solo se entra vía
  // ClubsRepository.decide() (solicitud aprobada).
  private async findOrCreateClub(clubName: string): Promise<string> {
    const existing = await this.pool.query<{ id_club: string }>(
      `SELECT id_club FROM clubs WHERE LOWER(name) = LOWER($1) AND created_by IS NULL LIMIT 1`,
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
        dominant_hand,
        region
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
      params.region ?? null,
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

  // --- Recuperar contraseña (ver 073_account_deletion_password_reset.sql) ---

  // Uno vigente por usuario: pedir otro reemplaza al anterior y reinicia los intentos.
  async saveResetCode(id_user: string, code_hash: string, expires_at: Date): Promise<void> {
    await this.pool.query(
      `INSERT INTO password_reset_codes (id_user, code_hash, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (id_user) DO UPDATE
         SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0, created_at = NOW()`,
      [id_user, code_hash, expires_at]
    );
  }

  async findResetCode(id_user: string): Promise<{ code_hash: string; expires_at: Date; attempts: number } | null> {
    const res = await this.pool.query(
      `SELECT code_hash, expires_at, attempts FROM password_reset_codes WHERE id_user = $1`,
      [id_user]
    );
    return res.rows[0] ?? null;
  }

  async bumpResetAttempts(id_user: string): Promise<void> {
    await this.pool.query(`UPDATE password_reset_codes SET attempts = attempts + 1 WHERE id_user = $1`, [id_user]);
  }

  // Cambia la contraseña y borra el código, todo junto.
  async setPasswordAndClearCode(id_user: string, password_hash: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE ${this.usersTable} SET password_hash = $2 WHERE id_user = $1`, [id_user, password_hash]);
      await client.query(`DELETE FROM password_reset_codes WHERE id_user = $1`, [id_user]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
}