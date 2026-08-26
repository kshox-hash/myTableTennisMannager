import type { Pool } from "pg";
import { randomUUID } from "crypto";
import DB from "../db/db_configuration";
import type { UserProfileDB, PlayerStatsDB, UserSearchRow } from "./dto/user_dto";
import type { UpdateProfileDTO } from "./schema/user_schema";
import { hashPassword } from "../bcrypt/bcrypt";
import { ROLE_IDS } from "../core/constants/roles";

export class UserRepository {
  private pool: Pool;

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

  async updateProfile(id_user: string, input: UpdateProfileDTO): Promise<UserProfileDB | null> {
    let idClub: string | null | undefined = undefined;
    if (input.club_name === null) {
      idClub = null;
    } else if (input.club_name !== undefined) {
      idClub = await this.findOrCreateClub(input.club_name);
    }

    await this.pool.query(
      `UPDATE users SET
         first_name    = COALESCE($1, first_name),
         last_name     = COALESCE($2, last_name),
         gender        = COALESCE($3, gender),
         id_club       = CASE WHEN $4 THEN $5 ELSE id_club END,
         birth_date    = COALESCE($6, birth_date),
         country       = COALESCE($7, country),
         id_document   = COALESCE($8, id_document),
         category      = COALESCE($9, category),
         dominant_hand = COALESCE($10, dominant_hand)
       WHERE id_user = $11`,
      [
        input.first_name ?? null,
        input.last_name ?? null,
        input.gender ?? null,
        idClub !== undefined,
        idClub ?? null,
        input.birth_date ?? null,
        input.country ?? null,
        input.id_document ?? null,
        input.category ?? null,
        input.dominant_hand ?? null,
        id_user,
      ]
    );

    return this.findById(id_user);
  }

  async findById(id_user: string): Promise<UserProfileDB | null> {
    const query = `
      SELECT
        u.id_user,
        u.email,
        u.first_name,
        u.last_name,
        u.gender,
        r.name AS role,
        u.id_club,
        cl.name AS club_name,
        u.birth_date::text,
        u.country,
        u.id_document,
        u.category,
        u.dominant_hand,
        u.created_at::text
      FROM users u
      JOIN roles r ON r.id_role = u.id_role
      LEFT JOIN clubs cl ON cl.id_club = u.id_club
      WHERE u.id_user = $1
      LIMIT 1;
    `;

    const res = await this.pool.query<UserProfileDB>(query, [id_user]);
    return res.rows[0] ?? null;
  }

  // Búsqueda de jugadores por email/nombre — usada por el admin para inscribir manualmente.
  async searchPlayers(q: string, limit = 20): Promise<UserSearchRow[]> {
    const query = `
      SELECT
        u.id_user,
        u.email,
        u.first_name,
        u.last_name,
        cl.name AS club_name
      FROM users u
      JOIN roles r ON r.id_role = u.id_role
      LEFT JOIN clubs cl ON cl.id_club = u.id_club
      WHERE r.name = 'player'
        AND (
          u.email ILIKE $1
          OR COALESCE(u.first_name, '') ILIKE $1
          OR COALESCE(u.last_name, '') ILIKE $1
          OR TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) ILIKE $1
        )
      ORDER BY u.last_name NULLS LAST, u.first_name NULLS LAST, u.email ASC
      LIMIT $2;
    `;

    const res = await this.pool.query<UserSearchRow>(query, [`%${q}%`, limit]);
    return res.rows;
  }

  // Alta rápida de un jugador sin cuenta (walk-in): genera un email y password
  // sintéticos únicos porque la tabla users los exige NOT NULL/UNIQUE, pero
  // nadie va a usarlos para loguearse — el admin lo gestiona directamente.
  async createQuickPlayer(input: {
    firstName: string;
    lastName?: string;
    gender?: "male" | "female" | "other";
    clubName?: string;
  }): Promise<UserSearchRow> {
    const idClub = input.clubName ? await this.findOrCreateClub(input.clubName) : null;
    const email = `sin-registro+${randomUUID()}@myttm.local`;
    const passwordHash = await hashPassword(randomUUID());

    const res = await this.pool.query<{
      id_user: string;
      email: string;
      first_name: string | null;
      last_name: string | null;
    }>(
      `INSERT INTO users (email, password_hash, id_role, first_name, last_name, gender, id_club)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id_user, email, first_name, last_name`,
      [email, passwordHash, ROLE_IDS.player, input.firstName, input.lastName ?? null, input.gender ?? null, idClub]
    );

    const row = res.rows[0];
    return {
      id_user: row.id_user,
      email: row.email,
      first_name: row.first_name,
      last_name: row.last_name,
      club_name: input.clubName ?? null,
    };
  }

  async findStatsById(id_user: string): Promise<PlayerStatsDB | null> {
    const res = await this.pool.query<PlayerStatsDB>(
      `SELECT id_user, matches_played, matches_won, matches_lost,
              sets_won, sets_lost, updated_at::text
       FROM player_stats WHERE id_user = $1`,
      [id_user]
    );
    return res.rows[0] ?? null;
  }
}
