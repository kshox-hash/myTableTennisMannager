import type { Pool, PoolClient } from "pg";
import DB from "../../db/db_configuration";
import type { EnrollmentDTO } from "../../enrollment/schema/enrollment_schema";
import { NotificationsRepository } from "../../notifications/notifications_repository";

type EnrollmentRow = {
  id_enrollment: string;
  id_user: string;
  id_tournament: string;
  id_category: string;
  status: string;
  enrolled_at: string | Date;
};

export class EnrollmentsRepository {
  private pool: Pool;
  private notifications: NotificationsRepository;

  constructor(pool?: Pool) {
    this.pool = pool ?? DB.getPool();
    this.notifications = new NotificationsRepository(this.pool);
  }

  private async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  }

  async subscribe(id_user: string, payload: EnrollmentDTO): Promise<EnrollmentRow> {
    try {
      return await this.withTransaction(async (client) => {
        // Bloquea la fila de la categoría para serializar accesos concurrentes al cupo
        const quotaRes = await client.query<{
          quotas: number | null;
          enrolled_count: number;
          already_enrolled: boolean;
          tournament_status: string;
          category_status: string;
          category_phase: string;
          category_gender: "male" | "female" | "mixed";
          user_gender: "male" | "female" | "other" | null;
        }>(
          `SELECT
             tc.quotas,
             (SELECT COUNT(*)::int
              FROM enrollments e
              WHERE e.id_category   = tc.id_category
                AND e.id_tournament = tc.id_tournament
                AND e.status        = 'active'
             ) AS enrolled_count,
             EXISTS (
               SELECT 1 FROM enrollments e
               WHERE e.id_category   = tc.id_category
                 AND e.id_tournament = tc.id_tournament
                 AND e.id_user       = $3
                 AND e.status        = 'active'
             ) AS already_enrolled,
             t.status AS tournament_status,
             tc.status AS category_status,
             COALESCE(tc.phase, 'enrollment') AS category_phase,
             tc.gender AS category_gender,
             u.gender AS user_gender
           FROM tournament_categories tc
           JOIN tournaments t ON t.id_tournament = tc.id_tournament
           JOIN users u ON u.id_user = $3
           WHERE tc.id_category   = $1
             AND tc.id_tournament = $2
           FOR UPDATE OF tc`,
          [payload.id_category, payload.id_tournament, id_user]
        );

        if ((quotaRes.rowCount ?? 0) === 0) {
          throw new Error("INVALID_TOURNAMENT_OR_CATEGORY");
        }

        const {
          quotas, enrolled_count, already_enrolled, tournament_status,
          category_status, category_phase, category_gender, user_gender,
        } = quotaRes.rows[0];

        // Antes que nada: si ya está inscrito, ese es el motivo real del
        // rechazo — chequearlo después del cupo hacía que alguien que ya
        // ocupa el único cupo se llevara un confuso "no quedan cupos" al
        // reintentar inscribirse.
        if (already_enrolled) {
          throw new Error("CONFLICT_ALREADY_ENROLLED");
        }

        if (tournament_status === "cancelled") {
          throw new Error("TOURNAMENT_CANCELLED");
        }

        if (category_status !== "active") {
          throw new Error("CATEGORY_NOT_OPEN");
        }

        if (category_phase !== "enrollment") {
          throw new Error("CATEGORY_ALREADY_STARTED");
        }

        if (category_gender !== "mixed") {
          if (!user_gender) throw new Error("GENDER_REQUIRED");
          if (user_gender !== category_gender) throw new Error("GENDER_MISMATCH");
        }

        if (quotas !== null && enrolled_count >= Number(quotas)) {
          throw new Error("QUOTA_EXCEEDED");
        }

        // ON CONFLICT en vez de un INSERT liso: si el jugador ya había estado
        // inscripto antes y un admin lo sacó, su fila queda en la tabla con
        // status='cancelled' (no se borra) — un INSERT normal chocaba con el
        // UNIQUE (id_user, id_tournament, id_category) y el 23505 se
        // traducía en un falso "ya estás inscrito" aunque no lo estuviera
        // más. Reinscribirse revive esa fila en vez de crear una nueva.
        const res = await client.query<EnrollmentRow>(
          `INSERT INTO enrollments (id_user, id_tournament, id_category)
           VALUES ($1, $2, $3)
           ON CONFLICT (id_user, id_tournament, id_category)
           DO UPDATE SET
             status = 'active',
             enrolled_at = NOW(),
             qualification_type = 'group',
             seed = NULL,
             checked_in = true
           RETURNING id_enrollment, id_user, id_tournament, id_category, status, enrolled_at`,
          [id_user, payload.id_tournament, payload.id_category]
        );

        const ctxRes = await client.query<{
          created_by: string;
          tournament_name: string;
          description: string | null;
          address: string | null;
          event_date: string | null;
          category_type: string;
          category_range: string;
          first_name: string | null;
          last_name: string | null;
          email: string;
        }>(
          `SELECT t.created_by, t.tournament_name, t.description, t.address, t.event_date::text,
                  tc.category_type, tc.category_range,
                  u.first_name, u.last_name, u.email
           FROM tournaments t
           JOIN tournament_categories tc ON tc.id_category = $1
           JOIN users u ON u.id_user = $2
           WHERE t.id_tournament = $3`,
          [payload.id_category, id_user, payload.id_tournament]
        );

        const ctx = ctxRes.rows[0];
        if (ctx) {
          const playerName =
            [ctx.first_name, ctx.last_name].filter(Boolean).join(" ") || ctx.email;
          const categoryLabel = `${ctx.category_type} ${ctx.category_range}`;

          await this.notifications.create(
            {
              idUser: ctx.created_by,
              type: "enrollment_created",
              title: "Nuevo inscrito",
              message: `${playerName} se inscribió en ${categoryLabel} (${ctx.tournament_name})`,
              idTournament: payload.id_tournament,
              idCategory: payload.id_category,
            },
            client
          );

          const details = [
            ctx.event_date ? `📅 ${ctx.event_date}` : null,
            ctx.address ? `📍 ${ctx.address}` : null,
            ctx.description ? ctx.description : null,
          ]
            .filter(Boolean)
            .join(" · ");

          await this.notifications.create(
            {
              idUser: id_user,
              type: "enrollment_confirmed",
              title: "Inscripción confirmada",
              message: `Quedaste inscrito en ${categoryLabel} de ${ctx.tournament_name}.${
                details ? ` ${details}` : ""
              }`,
              idTournament: payload.id_tournament,
              idCategory: payload.id_category,
            },
            client
          );
        }

        return res.rows[0];
      });
    } catch (error: any) {
      if (error?.message === "QUOTA_EXCEEDED")                 throw error;
      if (error?.message === "TOURNAMENT_CANCELLED")           throw error;
      if (error?.message === "INVALID_TOURNAMENT_OR_CATEGORY") throw error;
      if (error?.code   === "23505") throw new Error("CONFLICT_ALREADY_ENROLLED");
      if (error?.code   === "23503") throw new Error("INVALID_TOURNAMENT_OR_CATEGORY");
      throw error;
    }
  }
}
