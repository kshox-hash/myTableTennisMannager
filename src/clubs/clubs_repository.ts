import type { Pool, PoolClient } from "pg";
import DB from "../db/db_configuration";
import { type Result, ok, fail } from "../core/constants/result";

// CONCAT (no `||`) porque `NULL || 'x'` = NULL en SQL — un jugador sin
// apellido cargado no debe caer directo al email. Mismo criterio que
// leagues_repository.NAME_SQL.
const NAME_SQL = `COALESCE(NULLIF(TRIM(CONCAT(first_name, ' ', last_name)), ''), NULLIF(TRIM(first_name), ''), email)`;

export type ClubListRow = {
  id_club: string;
  name: string;
  description: string | null;
  founded_date: string | null;
  header_image_url: string | null;
  crest_image_url: string | null;
  created_at: string;
  member_count: number;
  pending_count: number;
};

export type ClubPublicRow = {
  id_club: string;
  name: string;
  crest_image_url: string | null;
};

export type ClubMemberRow = {
  id_user: string;
  name: string;
  email: string;
  selected: boolean;
};

export type ClubRequestRow = {
  id_request: string;
  id_user: string;
  name: string;
  email: string;
  requested_at: string;
};

export type ClubDetail = {
  id_club: string;
  name: string;
  description: string | null;
  founded_date: string | null;
  header_image_url: string | null;
  crest_image_url: string | null;
  monthly_fee: number | null;
  created_at: string;
  created_by: string;
  members: ClubMemberRow[];
  pending_requests: ClubRequestRow[];
};

export type ClubDueRow = {
  id_user: string;
  name: string;
  email: string;
  amount: number;
  paid: boolean;
  paid_at: string | null;
};

export type ClubCashMovementRow = {
  id_movement: string;
  type: "income" | "expense";
  amount: number;
  description: string;
  occurred_at: string;
  created_at: string;
};

export type ClubCashSummary = {
  balance: number;
  movements: ClubCashMovementRow[];
};

export type ClubArrearsRow = {
  id_user: string;
  name: string;
  email: string;
  totalPeriods: number;
  paidPeriods: number;
  owedPeriods: number;
  owedAmount: number;
};

export type MyRequestRow = {
  id_request: string;
  id_club: string;
  club_name: string;
  status: "pending" | "approved" | "rejected";
  requested_at: string;
};

export class ClubsRepository {
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

  // ─────────────────────────────────────────────────────────
  // Un admin solo puede tener UN club — evita que una misma cuenta arme
  // varios "clanes" y confunda a los jugadores sobre a cuál pedir unirse.
  async hasClub(idAdmin: string): Promise<boolean> {
    const res = await this.pool.query(`SELECT 1 FROM clubs WHERE created_by = $1 LIMIT 1`, [idAdmin]);
    return (res.rowCount ?? 0) > 0;
  }

  async create(input: {
    created_by: string;
    name: string;
    description: string | null;
    founded_date: string | null;
  }): Promise<string> {
    const res = await this.pool.query<{ id_club: string }>(
      `INSERT INTO clubs (name, description, founded_date, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id_club`,
      [input.name.trim(), input.description, input.founded_date, input.created_by]
    );
    return res.rows[0].id_club;
  }

  async listMine(idAdmin: string): Promise<ClubListRow[]> {
    const res = await this.pool.query<ClubListRow>(
      `SELECT
         c.id_club, c.name, c.description, c.founded_date, c.header_image_url, c.crest_image_url, c.created_at,
         (SELECT COUNT(*) FROM users u WHERE u.id_club = c.id_club)::int AS member_count,
         (SELECT COUNT(*) FROM club_join_requests r WHERE r.id_club = c.id_club AND r.status = 'pending')::int AS pending_count
       FROM clubs c
       WHERE c.created_by = $1
       ORDER BY c.created_at DESC`,
      [idAdmin]
    );
    return res.rows;
  }

  // Listado para el selector del jugador — solo clubes con dueño (los
  // creados por texto libre antes de esta migración no tienen created_by
  // y quedan afuera: nadie podría aprobar una solicitud para ellos).
  async listPublic(): Promise<ClubPublicRow[]> {
    const res = await this.pool.query<ClubPublicRow>(
      `SELECT id_club, name, crest_image_url
       FROM clubs
       WHERE created_by IS NOT NULL
       ORDER BY name ASC`
    );
    return res.rows;
  }

  async isMember(idClub: string, idUser: string): Promise<boolean> {
    const res = await this.pool.query(`SELECT 1 FROM users WHERE id_club = $1 AND id_user = $2`, [idClub, idUser]);
    return (res.rowCount ?? 0) > 0;
  }

  async getOwner(idClub: string): Promise<string | null> {
    const res = await this.pool.query<{ created_by: string | null }>(
      `SELECT created_by FROM clubs WHERE id_club = $1`,
      [idClub]
    );
    return res.rows[0]?.created_by ?? null;
  }

  async getDetail(idClub: string): Promise<ClubDetail | null> {
    const head = await this.pool.query<{
      id_club: string; name: string; description: string | null; founded_date: string | null;
      header_image_url: string | null; crest_image_url: string | null; monthly_fee: string | null;
      created_at: string; created_by: string | null;
    }>(
      `SELECT id_club, name, description, founded_date, header_image_url, crest_image_url, monthly_fee, created_at, created_by
       FROM clubs WHERE id_club = $1`,
      [idClub]
    );
    if (head.rowCount === 0 || !head.rows[0].created_by) return null;
    const h = head.rows[0];

    const [membersRes, requestsRes] = await Promise.all([
      this.pool.query<ClubMemberRow>(
        `SELECT u.id_user, ${NAME_SQL} AS name, u.email,
                (s.id_user IS NOT NULL) AS selected
         FROM users u
         LEFT JOIN club_selected_players s ON s.id_club = u.id_club AND s.id_user = u.id_user
         WHERE u.id_club = $1
         ORDER BY name ASC`,
        [idClub]
      ),
      this.pool.query<ClubRequestRow>(
        `SELECT r.id_request, r.id_user, ${NAME_SQL} AS name, u.email, r.requested_at
         FROM club_join_requests r JOIN users u ON u.id_user = r.id_user
         WHERE r.id_club = $1 AND r.status = 'pending'
         ORDER BY r.requested_at ASC`,
        [idClub]
      ),
    ]);

    return {
      id_club: h.id_club, name: h.name, description: h.description, founded_date: h.founded_date,
      header_image_url: h.header_image_url, crest_image_url: h.crest_image_url,
      monthly_fee: h.monthly_fee === null ? null : Number(h.monthly_fee),
      created_at: h.created_at,
      created_by: h.created_by!,
      members: membersRes.rows,
      pending_requests: requestsRes.rows,
    };
  }

  async update(idClub: string, patch: {
    name?: string; description?: string | null; founded_date?: string | null; monthly_fee?: number | null;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE clubs SET
         name         = COALESCE($2, name),
         description  = CASE WHEN $3 THEN $4 ELSE description END,
         founded_date = CASE WHEN $5 THEN $6 ELSE founded_date END,
         monthly_fee  = CASE WHEN $7 THEN $8 ELSE monthly_fee END
       WHERE id_club = $1`,
      [
        idClub,
        patch.name?.trim(),
        patch.description !== undefined, patch.description ?? null,
        patch.founded_date !== undefined, patch.founded_date ?? null,
        patch.monthly_fee !== undefined, patch.monthly_fee ?? null,
      ]
    );
  }

  async setHeaderUrl(idClub: string, url: string | null): Promise<void> {
    await this.pool.query(`UPDATE clubs SET header_image_url = $2 WHERE id_club = $1`, [idClub, url]);
  }

  async setCrestUrl(idClub: string, url: string | null): Promise<void> {
    await this.pool.query(`UPDATE clubs SET crest_image_url = $2 WHERE id_club = $1`, [idClub, url]);
  }

  // ON DELETE CASCADE en club_join_requests y ON DELETE SET NULL en
  // users.id_club se encargan solas de limpiar las solicitudes y de
  // desasignar a los jugadores — no hace falta tocarlas acá.
  async delete(idClub: string): Promise<void> {
    await this.pool.query(`DELETE FROM clubs WHERE id_club = $1`, [idClub]);
  }

  // ─────────────────────────────────────────────────────────
  async getMyRequest(idUser: string): Promise<MyRequestRow | null> {
    const res = await this.pool.query<MyRequestRow>(
      `SELECT r.id_request, r.id_club, c.name AS club_name, r.status, r.requested_at
       FROM club_join_requests r JOIN clubs c ON c.id_club = r.id_club
       WHERE r.id_user = $1
       ORDER BY r.requested_at DESC
       LIMIT 1`,
      [idUser]
    );
    return res.rows[0] ?? null;
  }

  async requestJoin(idClub: string, idUser: string): Promise<Result<{ id_request: string }, "CLUB_NOT_FOUND" | "ALREADY_PENDING">> {
    const club = await this.pool.query(`SELECT 1 FROM clubs WHERE id_club = $1 AND created_by IS NOT NULL`, [idClub]);
    if (club.rowCount === 0) return fail("CLUB_NOT_FOUND");

    try {
      const res = await this.pool.query<{ id_request: string }>(
        `INSERT INTO club_join_requests (id_club, id_user) VALUES ($1, $2) RETURNING id_request`,
        [idClub, idUser]
      );
      return ok({ id_request: res.rows[0].id_request });
    } catch (e: any) {
      // Viola idx_club_join_requests_one_pending (ya tiene una pendiente).
      if (e?.code === "23505") return fail("ALREADY_PENDING");
      throw e;
    }
  }

  async cancelMyRequest(idUser: string): Promise<boolean> {
    const res = await this.pool.query(
      `DELETE FROM club_join_requests WHERE id_user = $1 AND status = 'pending'`,
      [idUser]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async decide(
    idClub: string,
    idRequest: string,
    decision: "approved" | "rejected",
    decidedBy: string
  ): Promise<Result<{ id_user: string }, "REQUEST_NOT_FOUND">> {
    return this.withTx(async (c) => {
      const r = await c.query<{ id_user: string; status: string }>(
        `SELECT id_user, status FROM club_join_requests WHERE id_request = $1 AND id_club = $2 FOR UPDATE`,
        [idRequest, idClub]
      );
      if (r.rowCount === 0 || r.rows[0].status !== "pending") return fail("REQUEST_NOT_FOUND");
      const idUser = r.rows[0].id_user;

      await c.query(
        `UPDATE club_join_requests SET status = $3, decided_at = NOW(), decided_by = $4
         WHERE id_request = $1 AND id_club = $2`,
        [idRequest, idClub, decision, decidedBy]
      );

      if (decision === "approved") {
        await c.query(`UPDATE users SET id_club = $2 WHERE id_user = $1`, [idUser, idClub]);
      }

      return ok({ id_user: idUser });
    });
  }

  // ─────────────────────────────────────────────────────────
  // Cuotas — una fila por (socio, periodo). Se calcula el monto por
  // defecto desde clubs.monthly_fee salvo que el admin lo pise a mano
  // (ej. una cuota rebajada puntual), por eso `amount` vive en la fila
  // y no se recalcula desde clubs en cada lectura.
  async getDues(idClub: string, period: string): Promise<ClubDueRow[]> {
    const res = await this.pool.query<{ id_user: string; name: string; email: string; amount: string | null; paid: boolean | null; paid_at: string | null }>(
      `SELECT u.id_user, ${NAME_SQL} AS name, u.email,
              COALESCE(d.amount, c.monthly_fee) AS amount,
              COALESCE(d.paid, FALSE) AS paid,
              d.paid_at
       FROM users u
       JOIN clubs c ON c.id_club = u.id_club
       LEFT JOIN club_dues d ON d.id_club = u.id_club AND d.id_user = u.id_user AND d.period = $2
       WHERE u.id_club = $1
       ORDER BY name ASC`,
      [idClub, period]
    );
    return res.rows.map((r) => ({
      id_user: r.id_user, name: r.name, email: r.email,
      amount: r.amount === null ? 0 : Number(r.amount),
      paid: r.paid ?? false,
      paid_at: r.paid_at,
    }));
  }

  async setDuePaid(idClub: string, idUser: string, period: string, paid: boolean, amount: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO club_dues (id_club, id_user, period, amount, paid, paid_at)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 THEN NOW() ELSE NULL END)
       ON CONFLICT (id_club, id_user, period)
       DO UPDATE SET paid = $5, paid_at = CASE WHEN $5 THEN NOW() ELSE NULL END, amount = $4`,
      [idClub, idUser, period, amount, paid]
    );
  }

  // Morosidad — a diferencia de getDues (una foto de UN mes), esto mira
  // todos los periodos desde que cada jugador entró al club (fecha de
  // aprobación de su solicitud; si no hay registro, desde que se creó el
  // club) hasta el mes actual, y cuenta cuántos quedaron sin pagar. Tope
  // de 36 meses hacia atrás para no generar una serie enorme en clubes
  // muy antiguos. Sin cuota mensual configurada no hay nada que deber,
  // así que el router no llama esto si clubs.monthly_fee es NULL.
  async getArrears(idClub: string): Promise<ClubArrearsRow[]> {
    const res = await this.pool.query<{
      id_user: string; name: string; email: string;
      total_periods: string; paid_periods: string; owed_amount: string;
    }>(
      `WITH member_start AS (
         SELECT u.id_user,
                COALESCE(
                  (SELECT MIN(r.decided_at) FROM club_join_requests r
                   WHERE r.id_club = $1 AND r.id_user = u.id_user AND r.status = 'approved'),
                  c.created_at
                ) AS start_at
         FROM users u
         JOIN clubs c ON c.id_club = $1
         WHERE u.id_club = $1
       ),
       periods AS (
         SELECT ms.id_user, to_char(gs, 'YYYY-MM') AS period
         FROM member_start ms
         CROSS JOIN LATERAL generate_series(
           date_trunc('month', GREATEST(ms.start_at, NOW() - INTERVAL '35 months')),
           date_trunc('month', NOW()),
           INTERVAL '1 month'
         ) AS gs
       )
       SELECT p.id_user, ${NAME_SQL} AS name, u.email,
              COUNT(*)::int AS total_periods,
              COUNT(*) FILTER (WHERE d.paid IS TRUE)::int AS paid_periods,
              COALESCE(SUM(CASE WHEN d.paid IS NOT TRUE THEN COALESCE(d.amount, c.monthly_fee, 0) ELSE 0 END), 0) AS owed_amount
       FROM periods p
       JOIN users u ON u.id_user = p.id_user
       JOIN clubs c ON c.id_club = $1
       LEFT JOIN club_dues d ON d.id_club = $1 AND d.id_user = p.id_user AND d.period = p.period
       GROUP BY p.id_user, name, u.email
       ORDER BY (COUNT(*) - COUNT(*) FILTER (WHERE d.paid IS TRUE)) DESC, name ASC`,
      [idClub]
    );
    return res.rows.map((r) => {
      const totalPeriods = Number(r.total_periods);
      const paidPeriods = Number(r.paid_periods);
      return {
        id_user: r.id_user, name: r.name, email: r.email,
        totalPeriods, paidPeriods,
        owedPeriods: totalPeriods - paidPeriods,
        owedAmount: Number(r.owed_amount),
      };
    });
  }

  // ─────────────────────────────────────────────────────────
  // Caja — libro simple, el saldo se calcula sumando al leer (no se
  // guarda un saldo acumulado en ninguna parte).
  async getCashMovements(idClub: string): Promise<ClubCashSummary> {
    const res = await this.pool.query<{ id_movement: string; type: "income" | "expense"; amount: string; description: string; occurred_at: string; created_at: string }>(
      `SELECT id_movement, type, amount, description, occurred_at, created_at
       FROM club_cash_movements
       WHERE id_club = $1
       ORDER BY occurred_at DESC, created_at DESC`,
      [idClub]
    );
    const movements = res.rows.map((r) => ({ ...r, amount: Number(r.amount) }));
    const balance = movements.reduce((acc, m) => acc + (m.type === "income" ? m.amount : -m.amount), 0);
    return { balance, movements };
  }

  async addCashMovement(idClub: string, input: {
    type: "income" | "expense"; amount: number; description: string; occurred_at: string | null; created_by: string;
  }): Promise<string> {
    const res = await this.pool.query<{ id_movement: string }>(
      `INSERT INTO club_cash_movements (id_club, type, amount, description, occurred_at, created_by)
       VALUES ($1, $2, $3, $4, COALESCE($5, CURRENT_DATE), $6)
       RETURNING id_movement`,
      [idClub, input.type, input.amount, input.description.trim(), input.occurred_at, input.created_by]
    );
    return res.rows[0].id_movement;
  }

  async deleteCashMovement(idClub: string, idMovement: string): Promise<boolean> {
    const res = await this.pool.query(
      `DELETE FROM club_cash_movements WHERE id_club = $1 AND id_movement = $2`,
      [idClub, idMovement]
    );
    return (res.rowCount ?? 0) > 0;
  }

  // ─────────────────────────────────────────────────────────
  // Plantel seleccionado — no saca a nadie del listado general de
  // socios, solo marca/desmarca la fila puente.
  async setSelected(idClub: string, idUser: string, selected: boolean): Promise<void> {
    if (selected) {
      await this.pool.query(
        `INSERT INTO club_selected_players (id_club, id_user) VALUES ($1, $2)
         ON CONFLICT (id_club, id_user) DO NOTHING`,
        [idClub, idUser]
      );
    } else {
      await this.pool.query(
        `DELETE FROM club_selected_players WHERE id_club = $1 AND id_user = $2`,
        [idClub, idUser]
      );
    }
  }
}
