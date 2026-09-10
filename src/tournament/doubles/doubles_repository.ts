import type { Pool, PoolClient } from "pg";
import { randomUUID } from "crypto";
import DB from "../../db/db_configuration";
import { hashPassword } from "../../bcrypt/bcrypt";
import { ROLE_IDS } from "../../core/constants/roles";

export type DoublesTeamRow = {
  id_user: string; // el "usuario equipo"
  team_label: string;
  player1_id: string;
  player1_name: string;
  player2_id: string;
  player2_name: string;
  checked_in: boolean;
};

export type CreateTeamError =
  | "CATEGORY_NOT_FOUND"
  | "NOT_DOUBLES"
  | "SAME_PLAYER"
  | "PLAYER_NOT_FOUND"
  | "ALREADY_IN_TEAM"
  | "MIXED_RULE"
  | "CATEGORY_STARTED";

export type DissolveTeamError = "TEAM_NOT_FOUND" | "CATEGORY_STARTED";

function personLabel(first: string | null, last: string | null): string {
  const full = [first, last].filter(Boolean).join(" ").trim();
  return full || "Jugador";
}

export class DoublesRepository {
  private pool: Pool;
  constructor(pool?: Pool) {
    this.pool = pool ?? DB.getPool();
  }

  private async withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const out = await fn(client);
      await client.query("COMMIT");
      return out;
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      throw e;
    } finally {
      client.release();
    }
  }

  async listTeams(id_tournament: string, id_category: string): Promise<DoublesTeamRow[]> {
    const res = await this.pool.query<DoublesTeamRow>(
      `SELECT
         t.id_user,
         tu.first_name AS team_label,
         t.id_player_1 AS player1_id,
         COALESCE(NULLIF(TRIM(CONCAT(p1.first_name, ' ', p1.last_name)), ''), 'Jugador') AS player1_name,
         t.id_player_2 AS player2_id,
         COALESCE(NULLIF(TRIM(CONCAT(p2.first_name, ' ', p2.last_name)), ''), 'Jugador') AS player2_name,
         COALESCE(e.checked_in, false) AS checked_in
       FROM doubles_teams t
       JOIN users tu ON tu.id_user = t.id_user
       JOIN users p1 ON p1.id_user = t.id_player_1
       JOIN users p2 ON p2.id_user = t.id_player_2
       LEFT JOIN enrollments e
         ON e.id_user = t.id_user AND e.id_tournament = $1 AND e.id_category = $2
       WHERE t.id_category = $2
         AND (e.status IS NULL OR e.status = 'active')
       ORDER BY tu.first_name ASC`,
      [id_tournament, id_category]
    );
    return res.rows;
  }

  async createTeam(input: {
    id_tournament: string;
    id_category: string;
    player1_id: string;
    player2_id: string;
  }): Promise<{ ok: true; team: DoublesTeamRow } | { ok: false; error: CreateTeamError }> {
    const { id_tournament, id_category, player1_id, player2_id } = input;
    if (player1_id === player2_id) return { ok: false, error: "SAME_PLAYER" };

    return this.withTx(async (client) => {
      const catRes = await client.query<{ gender: string; format: string; phase: string }>(
        `SELECT gender, format, COALESCE(phase, 'enrollment') AS phase
         FROM tournament_categories WHERE id_category = $1 AND id_tournament = $2`,
        [id_category, id_tournament]
      );
      const cat = catRes.rows[0];
      if (!cat) return { ok: false as const, error: "CATEGORY_NOT_FOUND" as const };
      if (cat.format !== "doubles") return { ok: false as const, error: "NOT_DOUBLES" as const };
      if (cat.phase !== "enrollment") return { ok: false as const, error: "CATEGORY_STARTED" as const };

      const playersRes = await client.query<{ id_user: string; first_name: string | null; last_name: string | null; gender: string | null }>(
        `SELECT id_user, first_name, last_name, gender FROM users WHERE id_user = ANY($1::uuid[])`,
        [[player1_id, player2_id]]
      );
      if (playersRes.rows.length !== 2) return { ok: false as const, error: "PLAYER_NOT_FOUND" as const };
      const p1 = playersRes.rows.find((r) => r.id_user === player1_id)!;
      const p2 = playersRes.rows.find((r) => r.id_user === player2_id)!;

      // Dobles mixtos: exigir 1 varón + 1 dama SOLO si ambos géneros están
      // cargados (un walk-in del admin puede no tener género) — mejor dejar
      // pasar que bloquear una inscripción por un dato que falta.
      if (cat.gender === "mixed" && p1.gender && p2.gender && p1.gender === p2.gender) {
        return { ok: false as const, error: "MIXED_RULE" as const };
      }

      const dupRes = await client.query(
        `SELECT 1 FROM doubles_teams
         WHERE id_category = $1
           AND (id_player_1 = ANY($2::uuid[]) OR id_player_2 = ANY($2::uuid[]))
         LIMIT 1`,
        [id_category, [player1_id, player2_id]]
      );
      if ((dupRes.rowCount ?? 0) > 0) return { ok: false as const, error: "ALREADY_IN_TEAM" as const };

      const label = `${personLabel(p1.first_name, p1.last_name)} / ${personLabel(p2.first_name, p2.last_name)}`;
      const email = `team+${randomUUID()}@myttm.local`;
      const passwordHash = await hashPassword(randomUUID());

      const teamRes = await client.query<{ id_user: string }>(
        `INSERT INTO users (email, password_hash, id_role, first_name, is_team)
         VALUES ($1, $2, $3, $4, true)
         RETURNING id_user`,
        [email, passwordHash, ROLE_IDS.player, label]
      );
      const teamUserId = teamRes.rows[0].id_user;

      await client.query(
        `INSERT INTO doubles_teams (id_user, id_player_1, id_player_2, id_category)
         VALUES ($1, $2, $3, $4)`,
        [teamUserId, player1_id, player2_id, id_category]
      );

      await client.query(
        `INSERT INTO enrollments (id_user, id_tournament, id_category, qualification_type, checked_in)
         VALUES ($1, $2, $3, 'group', true)`,
        [teamUserId, id_tournament, id_category]
      );

      const team: DoublesTeamRow = {
        id_user: teamUserId,
        team_label: label,
        player1_id,
        player1_name: personLabel(p1.first_name, p1.last_name),
        player2_id,
        player2_name: personLabel(p2.first_name, p2.last_name),
        checked_in: true,
      };
      return { ok: true as const, team };
    });
  }

  async dissolveTeam(input: {
    id_tournament: string;
    id_category: string;
    team_user_id: string;
  }): Promise<{ ok: true } | { ok: false; error: DissolveTeamError }> {
    const { id_tournament, id_category, team_user_id } = input;
    return this.withTx(async (client) => {
      const teamRes = await client.query<{ phase: string }>(
        `SELECT COALESCE(tc.phase, 'enrollment') AS phase
         FROM doubles_teams t
         JOIN tournament_categories tc ON tc.id_category = t.id_category
         WHERE t.id_user = $1 AND t.id_category = $2`,
        [team_user_id, id_category]
      );
      const row = teamRes.rows[0];
      if (!row) return { ok: false as const, error: "TEAM_NOT_FOUND" as const };
      if (row.phase !== "enrollment") return { ok: false as const, error: "CATEGORY_STARTED" as const };

      // Borrar el usuario equipo arrastra doubles_teams + enrollments +
      // group_members etc. por ON DELETE CASCADE. Los dos jugadores reales
      // no se tocan.
      await client.query(`DELETE FROM users WHERE id_user = $1 AND is_team = true`, [team_user_id]);
      // no-op read solo para usar id_tournament y que TS no marque el
      // parámetro como sin uso — la validación real de pertenencia ya la
      // hizo el SELECT de arriba (doubles_teams.id_category).
      void id_tournament;
      return { ok: true as const };
    });
  }

  // teamUserId -> [player1_id, player2_id]. Usado para acreditar puntos de
  // ranking a los dos jugadores reales cuando gana un equipo.
  async membersOf(teamUserIds: string[]): Promise<Map<string, [string, string]>> {
    if (teamUserIds.length === 0) return new Map();
    const res = await this.pool.query<{ id_user: string; id_player_1: string; id_player_2: string }>(
      `SELECT id_user, id_player_1, id_player_2 FROM doubles_teams WHERE id_user = ANY($1::uuid[])`,
      [teamUserIds]
    );
    const map = new Map<string, [string, string]>();
    for (const r of res.rows) map.set(r.id_user, [r.id_player_1, r.id_player_2]);
    return map;
  }
}
