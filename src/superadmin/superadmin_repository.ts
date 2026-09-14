import type { Pool } from "pg";
import DB from "../db/db_configuration";
import { ROLE_IDS, type DbRole } from "../core/constants/roles";

export type AdminSummaryRow = {
  id_user: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
  tournament_count: number;
  player_count: number;
  last_activity_at: string | null;
};

export type UserSearchRow = {
  id_user: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: DbRole;
  created_at: string;
};

export class SuperadminRepository {
  private pool: Pool;
  constructor(pool?: Pool) {
    this.pool = pool ?? DB.getPool();
  }

  // Panel resumen: cuántos torneos armó cada admin, a cuántos jugadores
  // distintos les tocó jugar en esos torneos, y cuándo fue la última vez
  // que quedó algo registrado en activity_log para alguno de ellos —
  // reusa tablas que ya existen, sin migración nueva.
  async listAdmins(): Promise<AdminSummaryRow[]> {
    const res = await this.pool.query<AdminSummaryRow>(
      `SELECT
         u.id_user, u.email, u.first_name, u.last_name, u.created_at,
         (SELECT COUNT(*) FROM tournaments t WHERE t.created_by = u.id_user)::int AS tournament_count,
         (SELECT COUNT(DISTINCT e.id_user) FROM enrollments e
            JOIN tournaments t ON t.id_tournament = e.id_tournament
            WHERE t.created_by = u.id_user) AS player_count,
         (SELECT MAX(al.created_at) FROM activity_log al
            JOIN tournaments t ON t.id_tournament = al.id_tournament
            WHERE t.created_by = u.id_user) AS last_activity_at
       FROM users u
       WHERE u.id_role = $1
       ORDER BY u.created_at DESC`,
      [ROLE_IDS.admin]
    );
    return res.rows;
  }

  // A diferencia de user_repository.searchPlayers (que solo busca role
  // 'player', para inscribir gente a un torneo), acá hace falta encontrar
  // CUALQUIER cuenta — un jugador para promoverlo, o un admin para
  // revocarlo — así que no filtra por rol.
  async searchUsers(q: string, limit = 20): Promise<UserSearchRow[]> {
    const res = await this.pool.query<UserSearchRow>(
      `SELECT u.id_user, u.email, u.first_name, u.last_name, r.name AS role, u.created_at
       FROM users u
       JOIN roles r ON r.id_role = u.id_role
       WHERE u.is_team = false
         AND (
           u.email ILIKE $1
           OR COALESCE(u.first_name, '') ILIKE $1
           OR COALESCE(u.last_name, '') ILIKE $1
           OR TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) ILIKE $1
         )
       ORDER BY u.last_name NULLS LAST, u.first_name NULLS LAST, u.email ASC
       LIMIT $2`,
      [`%${q}%`, limit]
    );
    return res.rows;
  }

  async setUserRole(idUser: string, role: DbRole): Promise<UserSearchRow | null> {
    const idRole = role === "admin" ? ROLE_IDS.admin : ROLE_IDS.player;
    const res = await this.pool.query<UserSearchRow>(
      `UPDATE users u SET id_role = $2
       FROM roles r
       WHERE u.id_user = $1 AND r.id_role = $2
       RETURNING u.id_user, u.email, u.first_name, u.last_name, r.name AS role, u.created_at`,
      [idUser, idRole]
    );
    return res.rows[0] ?? null;
  }
}
