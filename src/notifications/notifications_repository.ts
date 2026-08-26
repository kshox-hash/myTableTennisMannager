import type { Pool, PoolClient } from "pg";
import DB from "../db/db_configuration";

export type NotificationType =
  | "enrollment_created"
  | "enrollment_confirmed"
  | "enrollment_removed"
  | "groups_started"
  | "group_changed"
  | "bracket_generated"
  | "bracket_bye"
  | "next_match_ready"
  | "match_on_table"
  | "match_result"
  | "tournament_cancelled";

export type NotificationRow = {
  id_notification: string;
  type: NotificationType;
  title: string;
  message: string;
  id_tournament: string | null;
  id_category: string | null;
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
};

export class NotificationsRepository {
  private pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool ?? DB.getPool();
  }

  private runner(client?: PoolClient) {
    return client ?? this.pool;
  }

  async create(input: CreateInput, client?: PoolClient): Promise<void> {
    await this.runner(client).query(
      `INSERT INTO notifications (id_user, type, title, message, id_tournament, id_category)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.idUser,
        input.type,
        input.title,
        input.message,
        input.idTournament ?? null,
        input.idCategory ?? null,
      ]
    );
  }

  async createForMany(
    userIds: string[],
    input: Omit<CreateInput, "idUser">,
    client?: PoolClient
  ): Promise<void> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return;

    const runner = this.runner(client);
    const values: unknown[] = [];
    const placeholders: string[] = [];

    ids.forEach((idUser, i) => {
      const base = i * 6;
      placeholders.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`
      );
      values.push(
        idUser,
        input.type,
        input.title,
        input.message,
        input.idTournament ?? null,
        input.idCategory ?? null
      );
    });

    await runner.query(
      `INSERT INTO notifications (id_user, type, title, message, id_tournament, id_category)
       VALUES ${placeholders.join(",")}`,
      values
    );
  }

  async listForUser(idUser: string, limit = 50): Promise<NotificationRow[]> {
    const res = await this.pool.query<NotificationRow>(
      `SELECT id_notification, type, title, message, id_tournament, id_category, is_read, created_at
       FROM notifications
       WHERE id_user = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [idUser, limit]
    );
    return res.rows;
  }

  async countUnread(idUser: string): Promise<number> {
    const res = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM notifications WHERE id_user = $1 AND is_read = FALSE`,
      [idUser]
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

  async markAllRead(idUser: string): Promise<void> {
    await this.pool.query(
      `UPDATE notifications SET is_read = TRUE WHERE id_user = $1 AND is_read = FALSE`,
      [idUser]
    );
  }
}
