import type { Pool } from "pg";
import DB from "../../db/db_configuration";

export type OrganizerRow = {
  id_user: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
};

export class TournamentOrganizersRepository {
  private pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool ?? DB.getPool();
  }

  // Solo el dueño del torneo (no un coorganizador) puede invitar/sacar gente
  // — mismo criterio que editar/cancelar el torneo.
  private async isOwner(idTournament: string, userId: string): Promise<boolean> {
    const res = await this.pool.query<{ created_by: string }>(
      `SELECT created_by FROM tournaments WHERE id_tournament = $1`,
      [idTournament]
    );
    return res.rows[0]?.created_by === userId;
  }

  async list(idTournament: string): Promise<OrganizerRow[]> {
    const res = await this.pool.query<OrganizerRow>(
      `SELECT u.id_user, u.email, u.first_name, u.last_name, o.created_at::text
       FROM tournament_organizers o
       JOIN users u ON u.id_user = o.id_user
       WHERE o.id_tournament = $1
       ORDER BY o.created_at ASC`,
      [idTournament]
    );
    return res.rows;
  }

  async invite(
    idTournament: string,
    invitedBy: string,
    email: string
  ): Promise<{ ok: true; data: OrganizerRow } | { ok: false; error: "NOT_TOURNAMENT_OWNER" | "USER_NOT_FOUND" | "USER_NOT_ADMIN" }> {
    if (!(await this.isOwner(idTournament, invitedBy))) {
      return { ok: false, error: "NOT_TOURNAMENT_OWNER" };
    }

    const userRes = await this.pool.query<{ id_user: string; role: string }>(
      `SELECT u.id_user, r.name AS role FROM users u
       JOIN roles r ON r.id_role = u.id_role
       WHERE u.email = $1`,
      [email]
    );
    const user = userRes.rows[0];
    if (!user) return { ok: false, error: "USER_NOT_FOUND" };
    if (user.role !== "admin") return { ok: false, error: "USER_NOT_ADMIN" };

    await this.pool.query(
      `INSERT INTO tournament_organizers (id_tournament, id_user, invited_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (id_tournament, id_user) DO NOTHING`,
      [idTournament, user.id_user, invitedBy]
    );

    const res = await this.pool.query<OrganizerRow>(
      `SELECT u.id_user, u.email, u.first_name, u.last_name, o.created_at::text
       FROM tournament_organizers o
       JOIN users u ON u.id_user = o.id_user
       WHERE o.id_tournament = $1 AND o.id_user = $2`,
      [idTournament, user.id_user]
    );
    return { ok: true, data: res.rows[0] };
  }

  async remove(
    idTournament: string,
    requestedBy: string,
    idUser: string
  ): Promise<{ ok: true } | { ok: false; error: "NOT_TOURNAMENT_OWNER" }> {
    if (!(await this.isOwner(idTournament, requestedBy))) {
      return { ok: false, error: "NOT_TOURNAMENT_OWNER" };
    }

    await this.pool.query(
      `DELETE FROM tournament_organizers WHERE id_tournament = $1 AND id_user = $2`,
      [idTournament, idUser]
    );
    return { ok: true };
  }
}
