import type { Pool } from "pg";
import DB from "../db/db_configuration";
import { ROLE_IDS, type DbRole, getSuperadminEmails } from "../core/constants/roles";

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

export type PlayerListRow = {
  id_user: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  country: string | null;
  region: string | null;
  created_at: string;
  club_name: string | null;
  tournaments: string[];
  total: number;
};

export type UserSearchRow = {
  id_user: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: DbRole;
  created_at: string;
};

export type PlatformStatsRow = {
  total_users: number;
  total_players: number;
  total_admins: number;
  active_users: number;
  currently_enrolled_users: number;
  total_clubs: number;
  total_tournaments: number;
  active_tournaments: number;
  new_users_today: number;
  new_users_week: number;
  new_users_month: number;
};

export type RegistrationsByDayRow = { day: string; count: number };
export type GenderBreakdownRow = { gender: string; count: number };
export type CountryBreakdownRow = { country: string; count: number };
export type MonthlyRegistrationsRow = { month: string; players: number; admins: number };
export type TopClubRow = { id_club: string; name: string; member_count: number };

export class SuperadminRepository {
  private pool: Pool;
  constructor(pool?: Pool) {
    this.pool = pool ?? DB.getPool();
  }

  // Panel resumen: cuántos torneos armó cada admin, a cuántos jugadores
  // distintos les tocó jugar en esos torneos, y cuándo fue la última vez
  // que quedó algo registrado en activity_log para alguno de ellos —
  // reusa tablas que ya existen, sin migración nueva.
  //
  // Excluye las cuentas de superadmin (su rol efectivo es "superadmin", no
  // "admin" — aunque en la base sigan guardadas con id_role = admin, no
  // corresponde que aparezcan mezcladas en el listado de admins comunes,
  // ni que "Quitar rol admin" tenga sentido para ellas).
  async listAdmins(): Promise<AdminSummaryRow[]> {
    const superadminEmails = getSuperadminEmails();
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
       WHERE u.id_role = $1 AND NOT (LOWER(u.email) = ANY($2::text[]))
       ORDER BY u.created_at DESC`,
      [ROLE_IDS.admin, superadminEmails]
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

  // Antes de que el superadmin elimine una cuenta: qué lo impediría. Un
  // superadmin no se elimina desde acá; quien administra un club o creó
  // campeonatos tampoco, porque el club y los campeonatos quedarían sin dueño.
  async deletionBlocker(
    idUser: string
  ): Promise<"NOT_FOUND" | "SUPERADMIN" | "CLUB_ADMIN" | "HAS_TOURNAMENTS" | null> {
    const res = await this.pool.query<{ email: string; club_admin: boolean; has_tournaments: boolean }>(
      `SELECT u.email,
              EXISTS (SELECT 1 FROM clubs c WHERE c.created_by = u.id_user) AS club_admin,
              EXISTS (SELECT 1 FROM tournaments t WHERE t.created_by = u.id_user) AS has_tournaments
       FROM users u
       WHERE u.id_user = $1 AND u.is_team = false AND u.deleted_at IS NULL`,
      [idUser]
    );
    const row = res.rows[0];
    if (!row) return "NOT_FOUND";
    if (getSuperadminEmails().includes(row.email.toLowerCase())) return "SUPERADMIN";
    if (row.club_admin) return "CLUB_ADMIN";
    if (row.has_tournaments) return "HAS_TOURNAMENTS";
    return null;
  }

  // Personas registradas, las más nuevas primero. Una pareja de dobles se
  // inscribe como usuario equipo (migración 044): sus campeonatos se le
  // cuentan a los dos jugadores reales, que son quienes aparecen acá.
  async getDownloadStats(): Promise<{
    total: number;
    today: number;
    week: number;
    month: number;
    web: number;
    app: number;
    daily: { day: string; count: number }[];
  }> {
    const tz = "America/Santiago";
    const t = await this.pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE (created_at AT TIME ZONE $1)::date = (NOW() AT TIME ZONE $1)::date)::int AS today,
              COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS week,
              COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS month,
              COUNT(*) FILTER (WHERE source = 'web')::int AS web,
              COUNT(*) FILTER (WHERE source = 'app')::int AS app
         FROM app_downloads`,
      [tz]
    );
    const d = await this.pool.query<{ day: string; count: number }>(
      `SELECT to_char(g.day, 'YYYY-MM-DD') AS day, COUNT(a.id_download)::int AS count
         FROM generate_series((NOW() AT TIME ZONE $1)::date - 29, (NOW() AT TIME ZONE $1)::date, '1 day') AS g(day)
         LEFT JOIN app_downloads a ON (a.created_at AT TIME ZONE $1)::date = g.day
        GROUP BY g.day ORDER BY g.day`,
      [tz]
    );
    return { ...t.rows[0], daily: d.rows };
  }

  async listPlayers(params: {
    q: string;
    enrolledOnly: boolean;
    /** Solo los registrados (o agregados) en los últimos 7 días. */
    newOnly?: boolean;
    limit: number;
    offset: number;
  }): Promise<{ players: PlayerListRow[]; total: number }> {
    const res = await this.pool.query<PlayerListRow>(
      `SELECT u.id_user, u.email, u.first_name, u.last_name, u.country, u.region, u.created_at,
              c.name AS club_name,
              COALESCE(en.names, '{}') AS tournaments,
              COUNT(*) OVER()::int AS total
       FROM users u
       LEFT JOIN clubs c ON c.id_club = u.id_club
       LEFT JOIN LATERAL (
         SELECT array_agg(DISTINCT t.tournament_name) AS names
         FROM enrollments e
         JOIN tournaments t ON t.id_tournament = e.id_tournament
         LEFT JOIN doubles_teams dt ON dt.id_user = e.id_user
         WHERE e.status = 'active' AND t.status = 'active'
           AND (e.id_user = u.id_user OR dt.id_player_1 = u.id_user OR dt.id_player_2 = u.id_user)
       ) en ON TRUE
       WHERE u.is_team = false
         AND u.deleted_at IS NULL
         AND ($1 = '%%'
           OR u.email ILIKE $1
           OR TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) ILIKE $1)
         AND (NOT $2 OR en.names IS NOT NULL)
         AND (NOT $5 OR u.created_at >= NOW() - INTERVAL '7 days')
       ORDER BY u.created_at DESC, u.id_user
       LIMIT $3 OFFSET $4`,
      [`%${params.q}%`, params.enrolledOnly, params.limit, params.offset, params.newOnly ?? false]
    );
    return { players: res.rows, total: res.rows[0]?.total ?? 0 };
  }

  // Panel de estadísticas de la plataforma — todo en una sola consulta
  // (subconsultas escalares en paralelo dentro del mismo SELECT) para no
  // hacer 10 round-trips separados. `is_team = false` en todos lados:
  // los usuarios "equipo" sintéticos de dobles (ver migración 044) no son
  // personas reales, no deben contar en ninguna métrica.
  //
  // "Activos" = jugaron al menos un partido de verdad (player_stats.
  // matches_played > 0) — no hay tracking de último login en el sistema,
  // así que "activo" no puede significar "entró hace poco"; esto mide
  // compromiso real con la plataforma en vez de solo tener una cuenta.
  //
  // "Actualmente inscritos" = inscripción activa en un torneo que sigue
  // activo (no cancelado) — un torneo cancelado o ya terminado no cuenta
  // como "ahora mismo compitiendo".
  async getPlatformStats(): Promise<PlatformStatsRow> {
    const superadminEmails = getSuperadminEmails();
    const res = await this.pool.query<PlatformStatsRow>(
      `SELECT
         (SELECT COUNT(*) FROM users WHERE is_team = false)::int AS total_users,
         (SELECT COUNT(*) FROM users u JOIN roles r ON r.id_role = u.id_role
            WHERE r.name = 'player' AND u.is_team = false)::int AS total_players,
         (SELECT COUNT(*) FROM users u JOIN roles r ON r.id_role = u.id_role
            WHERE r.name = 'admin' AND u.is_team = false AND NOT (LOWER(u.email) = ANY($1::text[])))::int AS total_admins,
         (SELECT COUNT(*) FROM player_stats WHERE matches_played > 0)::int AS active_users,
         (SELECT COUNT(DISTINCT e.id_user) FROM enrollments e
            JOIN tournaments t ON t.id_tournament = e.id_tournament
            WHERE e.status = 'active' AND t.status = 'active')::int AS currently_enrolled_users,
         (SELECT COUNT(*) FROM clubs WHERE created_by IS NOT NULL)::int AS total_clubs,
         (SELECT COUNT(*) FROM tournaments)::int AS total_tournaments,
         (SELECT COUNT(*) FROM tournaments WHERE status = 'active')::int AS active_tournaments,
         (SELECT COUNT(*) FROM users WHERE is_team = false AND created_at >= CURRENT_DATE)::int AS new_users_today,
         (SELECT COUNT(*) FROM users WHERE is_team = false AND created_at >= CURRENT_DATE - INTERVAL '7 days')::int AS new_users_week,
         (SELECT COUNT(*) FROM users WHERE is_team = false AND created_at >= CURRENT_DATE - INTERVAL '30 days')::int AS new_users_month`,
      [superadminEmails]
    );
    return res.rows[0];
  }

  // Serie diaria de registros para el gráfico — generate_series rellena
  // los días sin ningún registro con 0 en vez de saltárselos, así el
  // gráfico no tiene huecos silenciosos que se puedan confundir con "no
  // se cargó el dato".
  async getRegistrationsByDay(days: number): Promise<RegistrationsByDayRow[]> {
    const res = await this.pool.query<RegistrationsByDayRow>(
      `WITH bounds AS (
         SELECT generate_series(
           CURRENT_DATE - ($1::int - 1) * INTERVAL '1 day',
           CURRENT_DATE,
           INTERVAL '1 day'
         )::date AS day
       )
       SELECT to_char(b.day, 'YYYY-MM-DD') AS day, COUNT(u.id_user)::int AS count
       FROM bounds b
       LEFT JOIN users u ON DATE(u.created_at) = b.day AND u.is_team = false
       GROUP BY b.day
       ORDER BY b.day ASC`,
      [days]
    );
    return res.rows;
  }

  async getGenderBreakdown(): Promise<GenderBreakdownRow[]> {
    const res = await this.pool.query<GenderBreakdownRow>(
      `SELECT COALESCE(NULLIF(gender, ''), 'unknown') AS gender, COUNT(*)::int AS count
       FROM users WHERE is_team = false
       GROUP BY 1
       ORDER BY count DESC`
    );
    return res.rows;
  }

  async getCountryBreakdown(limit = 8): Promise<CountryBreakdownRow[]> {
    const res = await this.pool.query<CountryBreakdownRow>(
      `SELECT country, COUNT(*)::int AS count
       FROM users
       WHERE is_team = false AND country IS NOT NULL AND country <> ''
       GROUP BY country
       ORDER BY count DESC
       LIMIT $1`,
      [limit]
    );
    return res.rows;
  }

  // Mismo criterio anti-huecos que getRegistrationsByDay pero agrupado por
  // mes, separando jugadores de admins (dos series para un gráfico
  // apilado) — sirve para ver de un vistazo si el crecimiento reciente es
  // sobre todo jugadores nuevos o admins abriendo cuenta para organizar.
  async getMonthlyRegistrationsByRole(months: number): Promise<MonthlyRegistrationsRow[]> {
    const superadminEmails = getSuperadminEmails();
    const res = await this.pool.query<MonthlyRegistrationsRow>(
      `WITH bounds AS (
         SELECT generate_series(
           date_trunc('month', CURRENT_DATE) - ($1::int - 1) * INTERVAL '1 month',
           date_trunc('month', CURRENT_DATE),
           INTERVAL '1 month'
         )::date AS month
       )
       SELECT to_char(b.month, 'YYYY-MM') AS month,
              COUNT(u.id_user) FILTER (WHERE r.name = 'player')::int AS players,
              COUNT(u.id_user) FILTER (
                WHERE r.name = 'admin' AND NOT (LOWER(u.email) = ANY($2::text[]))
              )::int AS admins
       FROM bounds b
       LEFT JOIN users u ON date_trunc('month', u.created_at) = b.month AND u.is_team = false
       LEFT JOIN roles r ON r.id_role = u.id_role
       GROUP BY b.month
       ORDER BY b.month ASC`,
      [months, superadminEmails]
    );
    return res.rows;
  }

  // Clubes curados (con dueño) ordenados por cantidad de socios actuales —
  // los "clubes" de texto libre de antes del sistema de solicitudes
  // (created_by IS NULL) quedan afuera, no son un club real que alguien
  // administre.
  async getTopClubsByMembers(limit = 8): Promise<TopClubRow[]> {
    const res = await this.pool.query<TopClubRow>(
      `SELECT c.id_club, c.name, COUNT(u.id_user)::int AS member_count
       FROM clubs c
       LEFT JOIN users u ON u.id_club = c.id_club
       WHERE c.created_by IS NOT NULL
       GROUP BY c.id_club, c.name
       ORDER BY member_count DESC, c.name ASC
       LIMIT $1`,
      [limit]
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
