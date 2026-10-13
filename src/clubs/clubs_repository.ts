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
  fee_mode: FeeMode;
  fee_custom_amount: number | null;
};

export type ClubRequestRow = {
  id_request: string;
  id_user: string;
  name: string;
  email: string;
  requested_at: string;
};

export type FeeFrequency = "monthly" | "weekly";
// "none" = sin fila en club_member_fees (sin cobro).
export type FeeMode = "none" | "standard" | "custom" | "exempt" | "paused";
export type PaymentMethod = "cash" | "transfer" | "other";
// Estado de un socio en UN periodo. "unpaid" es neutro ("sin registrar"),
// no deuda; "not_started" = se le cobra, pero desde un periodo posterior.
export type DueStatus = "paid" | "unpaid" | "not_started" | "none" | "exempt" | "paused";

export type ClubDetail = {
  id_club: string;
  name: string;
  description: string | null;
  founded_date: string | null;
  header_image_url: string | null;
  crest_image_url: string | null;
  monthly_fee: number | null;
  fee_frequency: FeeFrequency;
  show_dues_to_members: boolean;
  created_at: string;
  created_by: string;
  members: ClubMemberRow[];
  pending_requests: ClubRequestRow[];
};

export type ClubPaymentRow = {
  id_payment: string;
  amount: number;
  periods: number;
  method: PaymentMethod | null;
  note: string | null;
  paid_on: string | null;
};

export type ClubDueRow = {
  id_user: string;
  name: string;
  email: string;
  fee_mode: FeeMode;
  amount: number;
  status: DueStatus;
  payment: ClubPaymentRow | null;
};

export type MyPayments = {
  club_name: string;
  fee_frequency: FeeFrequency;
  fee_mode: FeeMode;
  fee_amount: number | null;
  payments: Array<{
    id_payment: string; amount: number; periods: number; first_period: string;
    method: PaymentMethod | null; paid_on: string;
  }>;
};

export type ClubDuesPeriod = {
  periodStart: string;
  periodEnd: string;
  frequency: FeeFrequency;
  rows: ClubDueRow[];
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
  firstUnpaid: string | null;
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

  // El admin que crea el club queda como su MIEMBRO también (id_club),
  // no solo su dueño (created_by) — mismo UPDATE que dispara decide() al
  // aprobar una solicitud. Sin esto, el propio creador aparecía en su
  // perfil de jugador como si no perteneciera a ningún club, invitado a
  // "solicitar unirse" — incluso al club que él mismo creó.
  async create(input: {
    created_by: string;
    name: string;
    description: string | null;
    founded_date: string | null;
  }): Promise<string> {
    return this.withTx(async (c) => {
      const res = await c.query<{ id_club: string }>(
        `INSERT INTO clubs (name, description, founded_date, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id_club`,
        [input.name.trim(), input.description, input.founded_date, input.created_by]
      );
      // Ser dueño NO te hace socio como jugador (users.id_club): si el
      // organizador quiere jugar por su club, manda la solicitud como
      // cualquiera y la acepta él mismo — regla explícita del producto.
      return res.rows[0].id_club;
    });
  }

  async listMine(idAdmin: string): Promise<ClubListRow[]> {
    const res = await this.pool.query<ClubListRow>(
      `SELECT
         c.id_club, c.name, c.description, c.founded_date::text, c.header_image_url, c.crest_image_url, c.created_at,
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

  // Nombres para armar textos de notificación ("Juan Pérez quiere unirse a X").
  async getClubName(idClub: string): Promise<string | null> {
    const r = await this.pool.query<{ name: string }>(`SELECT name FROM clubs WHERE id_club = $1`, [idClub]);
    return r.rows[0]?.name ?? null;
  }

  async getUserDisplayName(idUser: string): Promise<string | null> {
    const r = await this.pool.query<{ name: string | null; email: string }>(
      `SELECT NULLIF(TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), '') AS name, email
       FROM users WHERE id_user = $1`,
      [idUser]
    );
    const row = r.rows[0];
    return row ? row.name ?? row.email : null;
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
      fee_frequency: FeeFrequency; show_dues_to_members: boolean; created_at: string; created_by: string | null;
    }>(
      `SELECT id_club, name, description, founded_date::text, header_image_url, crest_image_url, monthly_fee, fee_frequency, show_dues_to_members, created_at, created_by
       FROM clubs WHERE id_club = $1`,
      [idClub]
    );
    if (head.rowCount === 0 || !head.rows[0].created_by) return null;
    const h = head.rows[0];

    const [membersRes, requestsRes] = await Promise.all([
      this.pool.query<Omit<ClubMemberRow, "fee_custom_amount"> & { fee_custom_amount: string | null }>(
        `SELECT u.id_user, ${NAME_SQL} AS name, u.email,
                (s.id_user IS NOT NULL) AS selected,
                COALESCE(f.mode, 'none') AS fee_mode,
                f.custom_amount AS fee_custom_amount
         FROM users u
         LEFT JOIN club_selected_players s ON s.id_club = u.id_club AND s.id_user = u.id_user
         LEFT JOIN club_member_fees f ON f.id_club = u.id_club AND f.id_user = u.id_user
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
      fee_frequency: h.fee_frequency,
      show_dues_to_members: h.show_dues_to_members,
      created_at: h.created_at,
      created_by: h.created_by!,
      members: membersRes.rows.map((m) => ({
        ...m,
        fee_custom_amount: m.fee_custom_amount === null ? null : Number(m.fee_custom_amount),
      })),
      pending_requests: requestsRes.rows,
    };
  }

  async update(idClub: string, patch: {
    name?: string; description?: string | null; founded_date?: string | null; monthly_fee?: number | null;
    fee_frequency?: FeeFrequency; show_dues_to_members?: boolean;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE clubs SET
         name          = COALESCE($2, name),
         description   = CASE WHEN $3 THEN $4 ELSE description END,
         founded_date  = CASE WHEN $5 THEN $6 ELSE founded_date END,
         monthly_fee   = CASE WHEN $7 THEN $8 ELSE monthly_fee END,
         fee_frequency = COALESCE($9, fee_frequency),
         show_dues_to_members = COALESCE($10, show_dues_to_members)
       WHERE id_club = $1`,
      [
        idClub,
        patch.name?.trim(),
        patch.description !== undefined, patch.description ?? null,
        patch.founded_date !== undefined, patch.founded_date ?? null,
        patch.monthly_fee !== undefined, patch.monthly_fee ?? null,
        patch.fee_frequency ?? null,
        patch.show_dues_to_members ?? null,
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

  async requestJoin(
    idClub: string,
    idUser: string
  ): Promise<Result<{ id_request: string }, "CLUB_NOT_FOUND" | "ALREADY_PENDING" | "ALREADY_MEMBER">> {
    const club = await this.pool.query(`SELECT 1 FROM clubs WHERE id_club = $1 AND created_by IS NOT NULL`, [idClub]);
    if (club.rowCount === 0) return fail("CLUB_NOT_FOUND");

    // Pedir unirse a otro club estando ya en uno = cambio de club (al
    // aprobarse se pisa users.id_club); al mismo club no tiene sentido.
    const member = await this.pool.query(`SELECT 1 FROM users WHERE id_user = $1 AND id_club = $2`, [idUser, idClub]);
    if ((member.rowCount ?? 0) > 0) return fail("ALREADY_MEMBER");

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

  // Salir del club actual como JUGADOR (users.id_club). Vale también para
  // el dueño: la propiedad del club vive en clubs.created_by y no se toca —
  // el rol Jugador es independiente del de Administrador.
  async leaveClub(idUser: string): Promise<Result<true, "NO_CLUB">> {
    const cur = await this.pool.query<{ id_club: string | null }>(
      `SELECT id_club FROM users WHERE id_user = $1`,
      [idUser]
    );
    if (!cur.rows[0]?.id_club) return fail("NO_CLUB");
    await this.pool.query(`UPDATE users SET id_club = NULL WHERE id_user = $1`, [idUser]);
    return ok(true);
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
  // Cuotas — flexibles por socio (ver migración 070).
  //
  // La cuota del club (clubs.monthly_fee) es solo el valor sugerido. Cada
  // socio tiene su modalidad en club_member_fees: normal (la del club),
  // especial (monto propio), exento o en pausa; sin fila = sin cobro. Solo
  // normal/especial generan "por cobrar", y solo desde starts_on.
  //
  // El periodo NO se pide como fecha desde el frontend — se navega con un
  // `offset` entero (0 = periodo actual, -1 = el anterior, etc.) y acá se
  // calculan las fechas reales según clubs.fee_frequency (semana ISO o
  // mes calendario).
  async getDues(idClub: string, offset: number): Promise<ClubDuesPeriod | null> {
    const club = await this.pool.query<{ fee_frequency: FeeFrequency }>(
      `SELECT fee_frequency FROM clubs WHERE id_club = $1`,
      [idClub]
    );
    if (club.rowCount === 0) return null;
    const frequency = club.rows[0].fee_frequency;

    // Solo se pasa $1 (Postgres no infiere el tipo de un parámetro que no
    // aparece en el texto).
    const bounds = await this.pool.query<{ period_start: string; period_end: string }>(
      frequency === "weekly"
        ? `SELECT (date_trunc('week', NOW()) + make_interval(weeks => $1::int))::date::text AS period_start,
                  (date_trunc('week', NOW()) + make_interval(weeks => $1::int) + INTERVAL '6 days')::date::text AS period_end`
        : `SELECT (date_trunc('month', NOW()) + make_interval(months => $1::int))::date::text AS period_start,
                  (date_trunc('month', NOW()) + make_interval(months => $1::int) + INTERVAL '1 month' - INTERVAL '1 day')::date::text AS period_end`,
      [offset]
    );
    const { period_start, period_end } = bounds.rows[0];

    // Alias "player_name" y no "name": con JOIN clubs de por medio, un
    // ORDER BY "name" se resolvía a la columna del club, no al jugador.
    // member_start: un socio no aparece en periodos anteriores a unirse.
    const res = await this.pool.query<{
      id_user: string; player_name: string; email: string;
      fee_mode: FeeMode; fee_amount: string | null; starts_on: string | null;
      paid: boolean; id_payment: string | null; pay_amount: string | null; pay_periods: number | null;
      pay_method: PaymentMethod | null; pay_note: string | null; paid_on: string | null;
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
       )
       SELECT u.id_user, ${NAME_SQL} AS player_name, u.email,
              COALESCE(f.mode, 'none') AS fee_mode,
              CASE WHEN f.mode = 'custom' THEN f.custom_amount
                   WHEN f.mode = 'standard' THEN c.monthly_fee
                   ELSE NULL END AS fee_amount,
              f.starts_on::text AS starts_on,
              (d.paid IS TRUE) AS paid,
              p.id_payment, p.amount AS pay_amount, p.periods AS pay_periods,
              p.method AS pay_method, p.note AS pay_note, p.paid_on::text AS paid_on
       FROM users u
       JOIN clubs c ON c.id_club = u.id_club
       JOIN member_start ms ON ms.id_user = u.id_user
       LEFT JOIN club_member_fees f ON f.id_club = u.id_club AND f.id_user = u.id_user
       LEFT JOIN club_dues d ON d.id_club = u.id_club AND d.id_user = u.id_user AND d.period_start = $2::date
       LEFT JOIN club_payments p ON p.id_payment = d.id_payment
       WHERE u.id_club = $1 AND ms.start_at <= $3::date
       ORDER BY player_name ASC`,
      [idClub, period_start, period_end]
    );

    return {
      periodStart: period_start,
      periodEnd: period_end,
      frequency,
      rows: res.rows.map((r) => {
        const charging = r.fee_mode === "standard" || r.fee_mode === "custom";
        // Se cobra este periodo si la modalidad cobra y ya había empezado
        // (starts_on dentro o antes del periodo).
        const charged = charging && r.starts_on !== null && r.starts_on <= period_end;
        const status: DueStatus = r.paid
          ? "paid"
          : charged ? "unpaid"
          : charging ? "not_started"
          : (r.fee_mode as "none" | "exempt" | "paused");
        return {
          id_user: r.id_user, name: r.player_name, email: r.email,
          fee_mode: r.fee_mode,
          amount: r.fee_amount === null ? 0 : Number(r.fee_amount),
          status,
          payment: r.id_payment
            ? {
                id_payment: r.id_payment,
                amount: Number(r.pay_amount ?? 0),
                periods: Number(r.pay_periods ?? 1),
                method: r.pay_method,
                note: r.pay_note,
                paid_on: r.paid_on,
              }
            : null,
        };
      }),
    };
  }

  // Modalidad de cuota de un socio. "none" borra la fila (sin cobro).
  // starts_on se reinicia al periodo actual cada vez que alguien PASA a
  // cobrarse (desde sin cobro, exento o pausa) — lo anterior no cuenta;
  // entre normal y especial se conserva.
  async setMemberFee(idClub: string, idUser: string, mode: FeeMode, customAmount: number | null): Promise<void> {
    if (mode === "none") {
      await this.pool.query(`DELETE FROM club_member_fees WHERE id_club = $1 AND id_user = $2`, [idClub, idUser]);
      return;
    }
    await this.pool.query(
      `INSERT INTO club_member_fees (id_club, id_user, mode, custom_amount, starts_on)
       SELECT $1, $2, $3, $4,
              CASE WHEN c.fee_frequency = 'weekly' THEN date_trunc('week', NOW())::date
                   ELSE date_trunc('month', NOW())::date END
       FROM clubs c WHERE c.id_club = $1
       ON CONFLICT (id_club, id_user) DO UPDATE SET
         mode = EXCLUDED.mode,
         custom_amount = EXCLUDED.custom_amount,
         updated_at = NOW(),
         starts_on = CASE
           WHEN club_member_fees.mode IN ('standard', 'custom') AND EXCLUDED.mode IN ('standard', 'custom')
             THEN club_member_fees.starts_on
           ELSE EXCLUDED.starts_on
         END`,
      [idClub, idUser, mode, mode === "custom" ? customAmount : null]
    );
  }

  // Registrar un pago: crea el pago, marca como pagados los `periods`
  // periodos consecutivos desde firstPeriod (alineado a semana/mes) y,
  // si se pide, suma el ingreso a la Caja. Todo en una transacción.
  async registerPayment(idClub: string, input: {
    idUser: string; amount: number; periods: number; firstPeriod: string;
    method: PaymentMethod | null; note: string | null; addToCash: boolean; createdBy: string;
  }): Promise<{ ok: true; id_payment: string } | { ok: false; error: "PERIOD_BEFORE_MEMBERSHIP" | "PERIOD_ALREADY_PAID" }> {
    return this.withTx(async (c) => {
      const clubRes = await c.query<{ fee_frequency: FeeFrequency; first: string; allowed: boolean }>(
        `SELECT c.fee_frequency,
                (CASE WHEN c.fee_frequency = 'weekly' THEN date_trunc('week', $3::date)
                      ELSE date_trunc('month', $3::date) END)::date::text AS first,
                (CASE WHEN c.fee_frequency = 'weekly' THEN date_trunc('week', $3::date)
                      ELSE date_trunc('month', $3::date) END)::date
                  >= (CASE WHEN c.fee_frequency = 'weekly' THEN date_trunc('week', ms.start_at)
                           ELSE date_trunc('month', ms.start_at) END)::date AS allowed
         FROM clubs c
         CROSS JOIN LATERAL (
           SELECT COALESCE(
             (SELECT MIN(r.decided_at) FROM club_join_requests r
              WHERE r.id_club = $1 AND r.id_user = $2 AND r.status = 'approved'),
             c.created_at) AS start_at
         ) ms
         WHERE c.id_club = $1`,
        [idClub, input.idUser, input.firstPeriod]
      );
      const club = clubRes.rows[0];
      if (!club.allowed) return { ok: false as const, error: "PERIOD_BEFORE_MEMBERSHIP" as const };
      const step = club.fee_frequency === "weekly" ? "1 week" : "1 month";

      const taken = await c.query(
        `SELECT 1 FROM club_dues
         WHERE id_club = $1 AND id_user = $2 AND paid
           AND period_start IN (SELECT gs::date FROM generate_series($3::date, $3::date + ($4::int - 1) * $5::interval, $5::interval) gs)
         LIMIT 1`,
        [idClub, input.idUser, club.first, input.periods, step]
      );
      if ((taken.rowCount ?? 0) > 0) return { ok: false as const, error: "PERIOD_ALREADY_PAID" as const };

      let idMovement: string | null = null;
      if (input.addToCash && input.amount > 0) {
        const who = await c.query<{ name: string }>(`SELECT ${NAME_SQL} AS name FROM users WHERE id_user = $1`, [input.idUser]);
        const unit = club.fee_frequency === "weekly"
          ? (input.periods === 1 ? "semana" : "semanas")
          : (input.periods === 1 ? "mes" : "meses");
        const mv = await c.query<{ id_movement: string }>(
          `INSERT INTO club_cash_movements (id_club, type, amount, description, created_by)
           VALUES ($1, 'income', $2, $3, $4) RETURNING id_movement`,
          [idClub, input.amount, `Cuota ${who.rows[0]?.name ?? ""} (${input.periods} ${unit})`.slice(0, 200), input.createdBy]
        );
        idMovement = mv.rows[0].id_movement;
      }

      const pay = await c.query<{ id_payment: string }>(
        `INSERT INTO club_payments (id_club, id_user, amount, periods, first_period, method, note, id_movement, created_by)
         VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9) RETURNING id_payment`,
        [idClub, input.idUser, input.amount, input.periods, club.first, input.method, input.note, idMovement, input.createdBy]
      );
      const idPayment = pay.rows[0].id_payment;

      // Monto por periodo: el total repartido (el último absorbe el redondeo).
      const per = Math.floor(input.amount / input.periods);
      await c.query(
        `INSERT INTO club_dues (id_club, id_user, period_start, period_end, amount, paid, paid_at, id_payment)
         SELECT $1, $2, gs::date, (gs + $5::interval - INTERVAL '1 day')::date,
                CASE WHEN ord = $4::int THEN $6::numeric - $7::numeric * ($4::int - 1) ELSE $7::numeric END,
                TRUE, NOW(), $8
         FROM generate_series($3::date, $3::date + ($4::int - 1) * $5::interval, $5::interval) WITH ORDINALITY AS t(gs, ord)
         ON CONFLICT (id_club, id_user, period_start)
         DO UPDATE SET paid = TRUE, paid_at = NOW(), amount = EXCLUDED.amount, id_payment = EXCLUDED.id_payment`,
        [idClub, input.idUser, club.first, input.periods, step, input.amount, per, idPayment]
      );
      return { ok: true as const, id_payment: idPayment };
    });
  }

  // Anular un pago: sus periodos vuelven a "sin registrar" (club_dues se
  // borra en cascada) y, si había sumado a la Caja, ese ingreso se quita.
  async deletePayment(idClub: string, idPayment: string): Promise<boolean> {
    return this.withTx(async (c) => {
      const res = await c.query<{ id_movement: string | null }>(
        `DELETE FROM club_payments WHERE id_club = $1 AND id_payment = $2 RETURNING id_movement`,
        [idClub, idPayment]
      );
      if (res.rowCount === 0) return false;
      const idMovement = res.rows[0].id_movement;
      if (idMovement) {
        await c.query(`DELETE FROM club_cash_movements WHERE id_club = $1 AND id_movement = $2`, [idClub, idMovement]);
      }
      return true;
    });
  }

  // Por cobrar — solo socios con cuota normal o especial, contando desde
  // starts_on (o desde que se unió, lo que sea más tarde) hasta hoy. Es
  // información para el dueño; el socio nunca la ve. firstUnpaid: el
  // periodo más antiguo sin pago, para pre-llenar "Registrar pago".
  async getArrears(idClub: string): Promise<ClubArrearsRow[]> {
    // GROUP BY con las columnas reales (no el alias): con JOIN clubs, un
    // GROUP BY "name" ambiguo agrupaba por el nombre del CLUB.
    const res = await this.pool.query<{
      id_user: string; player_name: string; email: string;
      total_periods: string; paid_periods: string; owed_amount: string; first_unpaid: string | null;
    }>(
      `WITH club AS (
         SELECT id_club, monthly_fee, fee_frequency, created_at FROM clubs WHERE id_club = $1
       ),
       member_start AS (
         SELECT u.id_user,
                GREATEST(
                  f.starts_on::timestamptz,
                  COALESCE(
                    (SELECT MIN(r.decided_at) FROM club_join_requests r
                     WHERE r.id_club = $1 AND r.id_user = u.id_user AND r.status = 'approved'),
                    cl.created_at)
                ) AS start_at,
                cl.fee_frequency,
                CASE WHEN f.mode = 'custom' THEN f.custom_amount ELSE cl.monthly_fee END AS fee
         FROM users u
         CROSS JOIN club cl
         JOIN club_member_fees f ON f.id_club = $1 AND f.id_user = u.id_user AND f.mode IN ('standard', 'custom')
         WHERE u.id_club = $1
       ),
       bounds AS (
         SELECT ms.id_user, ms.fee,
                CASE WHEN ms.fee_frequency = 'weekly'
                  THEN date_trunc('week', GREATEST(ms.start_at, NOW() - INTERVAL '104 weeks'))
                  ELSE date_trunc('month', GREATEST(ms.start_at, NOW() - INTERVAL '35 months'))
                END AS from_ts,
                CASE WHEN ms.fee_frequency = 'weekly'
                  THEN date_trunc('week', NOW())
                  ELSE date_trunc('month', NOW())
                END AS to_ts,
                CASE WHEN ms.fee_frequency = 'weekly' THEN make_interval(weeks => 1) ELSE make_interval(months => 1) END AS step
         FROM member_start ms
       ),
       periods AS (
         SELECT b.id_user, b.fee, gs::date AS period_start
         FROM bounds b
         CROSS JOIN LATERAL generate_series(b.from_ts, b.to_ts, b.step) AS gs
       )
       SELECT p.id_user, ${NAME_SQL} AS player_name, u.email,
              COUNT(*)::int AS total_periods,
              COUNT(*) FILTER (WHERE d.paid IS TRUE)::int AS paid_periods,
              COALESCE(SUM(CASE WHEN d.paid IS NOT TRUE THEN COALESCE(p.fee, 0) ELSE 0 END), 0) AS owed_amount,
              (MIN(p.period_start) FILTER (WHERE d.paid IS NOT TRUE))::text AS first_unpaid
       FROM periods p
       JOIN users u ON u.id_user = p.id_user
       LEFT JOIN club_dues d ON d.id_club = $1 AND d.id_user = p.id_user AND d.period_start = p.period_start
       GROUP BY p.id_user, u.first_name, u.last_name, u.email
       ORDER BY (COUNT(*) - COUNT(*) FILTER (WHERE d.paid IS TRUE)) DESC, player_name ASC`,
      [idClub]
    );
    return res.rows.map((r) => {
      const totalPeriods = Number(r.total_periods);
      const paidPeriods = Number(r.paid_periods);
      return {
        id_user: r.id_user, name: r.player_name, email: r.email,
        totalPeriods, paidPeriods,
        owedPeriods: totalPeriods - paidPeriods,
        owedAmount: Number(r.owed_amount),
        firstUnpaid: r.first_unpaid,
      };
    });
  }

  // Lo que ve el socio de sus cuotas — solo si el dueño activó
  // show_dues_to_members (si no, null y la app no muestra nada). Nunca
  // incluye "deuda": su modalidad y su historial de pagos.
  async getMyPayments(idUser: string): Promise<MyPayments | null> {
    const head = await this.pool.query<{
      id_club: string; club_name: string; show: boolean; fee_frequency: FeeFrequency;
      fee_mode: FeeMode; fee_amount: string | null;
    }>(
      `SELECT c.id_club, c.name AS club_name, c.show_dues_to_members AS show, c.fee_frequency,
              COALESCE(f.mode, 'none') AS fee_mode,
              CASE WHEN f.mode = 'custom' THEN f.custom_amount
                   WHEN f.mode = 'standard' THEN c.monthly_fee ELSE NULL END AS fee_amount
       FROM users u
       JOIN clubs c ON c.id_club = u.id_club
       LEFT JOIN club_member_fees f ON f.id_club = c.id_club AND f.id_user = u.id_user
       WHERE u.id_user = $1`,
      [idUser]
    );
    const h = head.rows[0];
    if (!h || !h.show) return null;
    const pays = await this.pool.query<{
      id_payment: string; amount: string; periods: number; first_period: string;
      method: PaymentMethod | null; paid_on: string;
    }>(
      // Sin la nota: es interna del dueño ("con descuento", etc.).
      `SELECT id_payment, amount, periods, first_period::text, method, paid_on::text
       FROM club_payments WHERE id_club = $1 AND id_user = $2
       ORDER BY paid_on DESC, created_at DESC LIMIT 36`,
      [h.id_club, idUser]
    );
    return {
      club_name: h.club_name,
      fee_frequency: h.fee_frequency,
      fee_mode: h.fee_mode,
      fee_amount: h.fee_amount === null ? null : Number(h.fee_amount),
      payments: pays.rows.map((p) => ({ ...p, amount: Number(p.amount) })),
    };
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
