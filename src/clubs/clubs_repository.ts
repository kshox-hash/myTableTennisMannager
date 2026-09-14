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
  created_at: string;
  created_by: string;
  members: ClubMemberRow[];
  pending_requests: ClubRequestRow[];
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
      header_image_url: string | null; crest_image_url: string | null; created_at: string; created_by: string | null;
    }>(
      `SELECT id_club, name, description, founded_date, header_image_url, crest_image_url, created_at, created_by
       FROM clubs WHERE id_club = $1`,
      [idClub]
    );
    if (head.rowCount === 0 || !head.rows[0].created_by) return null;
    const h = head.rows[0];

    const [membersRes, requestsRes] = await Promise.all([
      this.pool.query<ClubMemberRow>(
        `SELECT id_user, ${NAME_SQL} AS name, email
         FROM users WHERE id_club = $1
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
      header_image_url: h.header_image_url, crest_image_url: h.crest_image_url, created_at: h.created_at,
      created_by: h.created_by!,
      members: membersRes.rows,
      pending_requests: requestsRes.rows,
    };
  }

  async update(idClub: string, patch: {
    name?: string; description?: string | null; founded_date?: string | null;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE clubs SET
         name         = COALESCE($2, name),
         description  = CASE WHEN $3 THEN $4 ELSE description END,
         founded_date = CASE WHEN $5 THEN $6 ELSE founded_date END
       WHERE id_club = $1`,
      [
        idClub,
        patch.name?.trim(),
        patch.description !== undefined, patch.description ?? null,
        patch.founded_date !== undefined, patch.founded_date ?? null,
      ]
    );
  }

  async setHeaderUrl(idClub: string, url: string | null): Promise<void> {
    await this.pool.query(`UPDATE clubs SET header_image_url = $2 WHERE id_club = $1`, [idClub, url]);
  }

  async setCrestUrl(idClub: string, url: string | null): Promise<void> {
    await this.pool.query(`UPDATE clubs SET crest_image_url = $2 WHERE id_club = $1`, [idClub, url]);
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
}
