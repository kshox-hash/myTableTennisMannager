import type { Pool, PoolClient } from "pg";
import DB from "../db/db_configuration";
import { sendPush } from "./push";

/** Tipos que se avisan al celular (push) y como aviso emergente en la app/web.
 * Mismo listado en la app (notification_popups.dart) y en la web
 * (NotificationPopups.tsx). */
// Avisos que son para el organizador / dueño de club (rol admin). Todo lo
// demás es del rol jugador. Con ?audience= cada área ve solo lo suyo.
export const ADMIN_TYPES = ["enrollment_created", "player_unenrolled", "club_join_request", "organizer_invited", "organizer_removed"];
export type Audience = "admin" | "player" | null;
export function parseAudience(v: unknown): Audience {
  return v === "admin" || v === "player" ? v : null;
}
// Avisos de organizador que también se ven en la vista Jugador: a una
// cuenta que está mirando como jugador la invitan a coorganizar y, si solo
// salía en la campana de Administrador, no se enteraba hasta cambiar de vista.
export const SHARED_TYPES = ["organizer_invited", "organizer_removed"];
function audienceSql(audience: Audience, param: string): string {
  if (audience === "admin") return ` AND n.type = ANY(${param}::text[])`;
  if (audience === "player") {
    const shared = SHARED_TYPES.map((t) => `'${t}'`).join(", ");
    return ` AND (NOT (n.type = ANY(${param}::text[])) OR n.type IN (${shared}))`;
  }
  return "";
}

export const PUSH_TYPES: ReadonlySet<string> = new Set([
  "tournament_reminder",
  "groups_started",
  "match_up_soon",
  "match_on_table",
  "groups_ending",
  "group_outcome",
  "final_position",
  "tournament_cancelled",
  "tournament_updated",
  "enrollment_removed",
  "match_result_corrected",
  "group_changed",
  "bracket_changed",
  "club_join_request",
  "club_join_approved",
  "club_join_rejected",
  "referee_assigned",
  "tournament_finished",
  "organizer_invited",
]);

export type NotificationType =
  | "enrollment_created"
  | "enrollment_confirmed"
  | "enrollment_removed"
  | "groups_started"
  | "group_changed"
  | "bracket_generated"
  | "bracket_bye"
  | "bracket_changed"
  | "next_match_ready"
  | "match_on_table"
  | "match_result"
  | "tournament_cancelled"
  | "club_join_request"
  | "club_join_approved"
  | "club_join_rejected"
  | "group_outcome"
  | "final_position"
  | "tournament_updated"
  | "match_result_corrected"
  | "club_payment"
  | "match_up_soon"
  | "queue_skipped"
  | "groups_ending"
  | "player_unenrolled"
  | "referee_assigned"
  | "tournament_finished"
  | "tournament_reminder"
  // Coorganizadores: te sumaron (o te cambiaron el rol) / te sacaron.
  | "organizer_invited"
  | "organizer_removed";

export type NotificationRow = {
  id_notification: string;
  type: NotificationType;
  title: string;
  message: string;
  id_tournament: string | null;
  id_category: string | null;
  id_match: string | null;
  match_type: "group" | "bracket" | null;
  is_read: boolean;
  created_at: string;
};

type CreateInput = {
  idUser: string;
  type: NotificationType;
  title: string;
  message: string;
  idTournament?: string | null;
  idCategory?: string | null;
  idMatch?: string | null;
  matchType?: "group" | "bracket" | null;
};

export class NotificationsRepository {
  private pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool ?? DB.getPool();
  }

  private runner(client?: PoolClient) {
    return client ?? this.pool;
  }

  // Dobles (044): una pareja es un "usuario equipo" sin cuenta ni celular.
  // Un aviso dirigido a la pareja se les manda a los DOS jugadores reales —
  // antes quedaba en la campana del equipo, que nadie ve, y el push no
  // llegaba a ninguno.
  private async expandTeams(userIds: string[], client?: PoolClient): Promise<string[]> {
    if (userIds.length === 0) return userIds;
    const res = await this.runner(client).query<{ id_user: string; id_player_1: string; id_player_2: string }>(
      `SELECT id_user, id_player_1, id_player_2 FROM doubles_teams WHERE id_user = ANY($1::uuid[])`,
      [userIds]
    );
    if (res.rows.length === 0) return userIds;
    const members = new Map(res.rows.map((r) => [r.id_user, [r.id_player_1, r.id_player_2]]));
    return [...new Set(userIds.flatMap((id) => members.get(id) ?? [id]))];
  }

  async create(input: CreateInput, client?: PoolClient): Promise<void> {
    const recipients = await this.expandTeams([input.idUser], client);
    if (recipients.length !== 1 || recipients[0] !== input.idUser) {
      const { idUser: _team, ...rest } = input;
      return this.createForMany(recipients, rest, client);
    }
    await this.runner(client).query(
      `INSERT INTO notifications (id_user, type, title, message, id_tournament, id_category, id_match, match_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.idUser,
        input.type,
        input.title,
        input.message,
        input.idTournament ?? null,
        input.idCategory ?? null,
        input.idMatch ?? null,
        input.matchType ?? null,
      ]
    );
    this.push([input.idUser], input);
  }

  // Además de guardarla, la notificación sale como push al celular (si
  // Firebase está configurado — ver push.ts). Sin await: nunca demora ni
  // rompe la acción que la originó. Si se llamó dentro de una transacción
  // que después hace ROLLBACK el push igual ya salió; es un caso raro
  // (la acción falla después de haber avisado) y se acepta.
  private push(userIds: string[], input: Omit<CreateInput, "idUser">) {
    // Solo lo importante sale como push (llegaban avisos por cada acción y
    // saturaban); el resto queda igual guardado en la campana.
    if (!PUSH_TYPES.has(input.type)) return;
    void sendPush(userIds, {
      title: input.title,
      body: input.message,
      data: {
        type: input.type,
        id_tournament: input.idTournament,
        id_category: input.idCategory,
        id_match: input.idMatch,
        match_type: input.matchType,
      },
    });
  }

  async createForMany(
    userIds: string[],
    input: Omit<CreateInput, "idUser">,
    client?: PoolClient
  ): Promise<void> {
    const ids = await this.expandTeams([...new Set(userIds)], client);
    if (ids.length === 0) return;

    const runner = this.runner(client);
    const values: unknown[] = [];
    const placeholders: string[] = [];

    ids.forEach((idUser, i) => {
      const base = i * 8;
      placeholders.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`
      );
      values.push(
        idUser,
        input.type,
        input.title,
        input.message,
        input.idTournament ?? null,
        input.idCategory ?? null,
        input.idMatch ?? null,
        input.matchType ?? null
      );
    });

    await runner.query(
      `INSERT INTO notifications (id_user, type, title, message, id_tournament, id_category, id_match, match_type)
       VALUES ${placeholders.join(",")}`,
      values
    );
    this.push(ids, input);
  }

  // Token del celular para push (la app lo registra al iniciar sesión).
  async saveDeviceToken(idUser: string, token: string, platform: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO device_tokens (token, id_user, platform, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (token) DO UPDATE SET id_user = EXCLUDED.id_user, platform = EXCLUDED.platform, updated_at = NOW()`,
      [token, idUser, platform]
    );
  }

  async deleteDeviceToken(idUser: string, token: string): Promise<void> {
    await this.pool.query(`DELETE FROM device_tokens WHERE token = $1 AND id_user = $2`, [token, idUser]);
  }

  async listForUser(idUser: string, limit = 50, audience: Audience = null): Promise<NotificationRow[]> {
    const res = await this.pool.query<NotificationRow>(
      // Nombres de torneo y categoría para que la app pueda abrir la pantalla
      // correcta al tocar la notificación (antes solo la marcaba leída).
      `SELECT n.id_notification, n.type, n.title, n.message, n.id_tournament, n.id_category, n.id_match, n.match_type,
              n.is_read, n.created_at,
              t.tournament_name,
              NULLIF(TRIM(CONCAT_WS(' ', tc.category_type, NULLIF(tc.category_range, 'General'))), '') AS category_label
       FROM notifications n
       LEFT JOIN tournaments t ON t.id_tournament = n.id_tournament
       LEFT JOIN tournament_categories tc ON tc.id_category = n.id_category
       WHERE n.id_user = $1${audienceSql(audience, "$3")}
       ORDER BY n.created_at DESC
       LIMIT $2`,
      audience ? [idUser, limit, ADMIN_TYPES] : [idUser, limit]
    );
    return res.rows;
  }

  async countUnread(idUser: string, audience: Audience = null): Promise<number> {
    const res = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM notifications n WHERE n.id_user = $1 AND n.is_read = FALSE${audienceSql(audience, "$2")}`,
      audience ? [idUser, ADMIN_TYPES] : [idUser]
    );
    return Number(res.rows[0]?.count ?? 0);
  }

  async markRead(idNotification: string, idUser: string): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE notifications SET is_read = TRUE WHERE id_notification = $1 AND id_user = $2`,
      [idNotification, idUser]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async markAllRead(idUser: string, audience: Audience = null): Promise<void> {
    await this.pool.query(
      `UPDATE notifications n SET is_read = TRUE WHERE n.id_user = $1 AND n.is_read = FALSE${audienceSql(audience, "$2")}`,
      audience ? [idUser, ADMIN_TYPES] : [idUser]
    );
  }
}
