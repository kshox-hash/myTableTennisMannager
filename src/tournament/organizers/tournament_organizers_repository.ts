import type { Pool } from "pg";
import DB from "../../db/db_configuration";
import { NotificationsRepository } from "../../notifications/notifications_repository";

export type OrganizerRole = "organizer" | "viewer";

export type OrganizerRow = {
  id_user: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: OrganizerRole;
  created_at: string;
};

export type TeamOwner = {
  id_user: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
};

export type TournamentTeam = {
  /** Rol de quien pide: la web oculta lo que ese rol no puede hacer. */
  my_role: "owner" | OrganizerRole;
  owner: TeamOwner;
  organizers: OrganizerRow[];
};

const ROLE_LABEL: Record<OrganizerRole, string> = {
  organizer: "coorganizador",
  viewer: "invitado (solo lectura)",
};

export class TournamentOrganizersRepository {
  private pool: Pool;
  private notifications: NotificationsRepository;

  constructor(pool?: Pool) {
    this.pool = pool ?? DB.getPool();
    this.notifications = new NotificationsRepository(this.pool);
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

  // Nombre para los avisos: el de organizador si lo tiene, si no el de
  // jugador, y si no el email.
  private async displayName(idUser: string): Promise<string> {
    const res = await this.pool.query<{ name: string | null; email: string }>(
      `SELECT NULLIF(TRIM(CONCAT_WS(' ', COALESCE(organizer_first_name, first_name), COALESCE(organizer_last_name, last_name))), '') AS name, email
       FROM users WHERE id_user = $1`,
      [idUser]
    );
    const row = res.rows[0];
    return row?.name ?? row?.email ?? "Un organizador";
  }

  private async tournamentName(idTournament: string): Promise<string> {
    const res = await this.pool.query<{ tournament_name: string }>(
      `SELECT tournament_name FROM tournaments WHERE id_tournament = $1`,
      [idTournament]
    );
    return res.rows[0]?.tournament_name ?? "el campeonato";
  }

  async list(idTournament: string): Promise<OrganizerRow[]> {
    const res = await this.pool.query<OrganizerRow>(
      `SELECT u.id_user, u.email, u.first_name, u.last_name, o.role, o.created_at::text
       FROM tournament_organizers o
       JOIN users u ON u.id_user = o.id_user
       WHERE o.id_tournament = $1
       ORDER BY o.created_at ASC`,
      [idTournament]
    );
    return res.rows;
  }

  // Equipo completo (dueño + coorganizadores) y el rol de quien pregunta.
  // La ruta ya filtró con requireTournamentOwnership (allowViewer), así que
  // quien llega acá es dueño, coorganizador o invitado.
  async team(idTournament: string, userId: string): Promise<TournamentTeam | null> {
    const ownerRes = await this.pool.query<TeamOwner>(
      `SELECT u.id_user, u.email,
              COALESCE(u.organizer_first_name, u.first_name) AS first_name,
              COALESCE(u.organizer_last_name, u.last_name) AS last_name
       FROM tournaments t JOIN users u ON u.id_user = t.created_by
       WHERE t.id_tournament = $1`,
      [idTournament]
    );
    const owner = ownerRes.rows[0];
    if (!owner) return null;
    const organizers = await this.list(idTournament);
    const mine = organizers.find((o) => o.id_user === userId);
    return { my_role: owner.id_user === userId ? "owner" : mine?.role ?? "viewer", owner, organizers };
  }

  async invite(
    idTournament: string,
    invitedBy: string,
    email: string,
    role: OrganizerRole = "organizer"
  ): Promise<
    | { ok: true; data: OrganizerRow }
    | { ok: false; error: "NOT_TOURNAMENT_OWNER" | "USER_NOT_FOUND" | "USER_NOT_ADMIN" | "IS_OWNER" }
  > {
    if (!(await this.isOwner(idTournament, invitedBy))) {
      return { ok: false, error: "NOT_TOURNAMENT_OWNER" };
    }

    const userRes = await this.pool.query<{ id_user: string; role: string }>(
      `SELECT u.id_user, r.name AS role FROM users u
       JOIN roles r ON r.id_role = u.id_role
       WHERE LOWER(u.email) = LOWER($1)`,
      [email]
    );
    const user = userRes.rows[0];
    if (!user) return { ok: false, error: "USER_NOT_FOUND" };
    if (user.id_user === invitedBy) return { ok: false, error: "IS_OWNER" };
    if (user.role !== "admin") return { ok: false, error: "USER_NOT_ADMIN" };

    const prevRes = await this.pool.query<{ role: OrganizerRole }>(
      `SELECT role FROM tournament_organizers WHERE id_tournament = $1 AND id_user = $2`,
      [idTournament, user.id_user]
    );
    const previousRole = prevRes.rows[0]?.role ?? null;

    // Si ya estaba invitado con otro rol, se actualiza al nuevo -- re-invitar
    // es la forma de cambiarle el rol a alguien sin sacarlo y volver a
    // agregarlo.
    await this.pool.query(
      `INSERT INTO tournament_organizers (id_tournament, id_user, invited_by, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id_tournament, id_user) DO UPDATE SET role = EXCLUDED.role`,
      [idTournament, user.id_user, invitedBy, role]
    );

    // Aviso al invitado (en la campana de su área de organizador y push):
    // antes no se enteraba, el campeonato solo aparecía en su Panel.
    if (previousRole !== role) {
      const [inviter, name] = await Promise.all([this.displayName(invitedBy), this.tournamentName(idTournament)]);
      await this.notifications
        .create({
          idUser: user.id_user,
          type: "organizer_invited",
          title: previousRole ? "Cambió tu rol en un campeonato" : "Te sumaron a un campeonato",
          message: previousRole
            ? `${inviter} te dejó como ${ROLE_LABEL[role]} de "${name}".`
            : `${inviter} te invitó como ${ROLE_LABEL[role]} de "${name}". Ya lo tienes en tu Panel.`,
          idTournament,
        })
        .catch(() => undefined);
    }

    const res = await this.pool.query<OrganizerRow>(
      `SELECT u.id_user, u.email, u.first_name, u.last_name, o.role, o.created_at::text
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

    const del = await this.pool.query(
      `DELETE FROM tournament_organizers WHERE id_tournament = $1 AND id_user = $2`,
      [idTournament, idUser]
    );
    if ((del.rowCount ?? 0) > 0) {
      const [owner, name] = await Promise.all([this.displayName(requestedBy), this.tournamentName(idTournament)]);
      await this.notifications
        .create({
          idUser,
          type: "organizer_removed",
          title: "Ya no coorganizas un campeonato",
          message: `${owner} te sacó del equipo de "${name}".`,
          idTournament,
        })
        .catch(() => undefined);
    }
    return { ok: true };
  }
}
