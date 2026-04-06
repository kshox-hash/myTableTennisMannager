import type { Pool, PoolClient, QueryResult } from "pg";
import DB from "../../db/db_configuration";

import type {
  TournamentCreateDTO,
  ITournament,
  TournamentCategoryDTO,
  AdminTournamentRow,
  EnrollmentRow,
  AdminCategoryRow,
  AdminCategoryPlayerRow,
} from "../dto/tournament_dto";

type TournamentRow = {
  id_tournament: string;
  tournament_name: string;
  description: string | null;
  created_by: string;
  allow_mixed: boolean;
  allow_olympic: boolean;
  address: string | null;
  region: string | null;
  event_date: string | Date | null;
  event_time: string | null;
  created_at?: string | Date | null;
};

type CategoryRow = {
  id_category: string;
  id_tournament: string;
  category_type: string;
  category_range: string;
  gender: "male" | "female" | "mixed";
  inscription_price: number | string;
  quotas: number | string | null;
  status: string;
  created_at?: string | Date | null;
};

type TournamentWithCategoryRow = {
  id_tournament: string;
  tournament_name: string;
  description: string | null;
  created_by: string;
  allow_mixed: boolean;
  allow_olympic: boolean;
  address: string | null;
  region: string | null;
  event_date: string | Date | null;
  event_time: string | null;
  created_at?: string | Date | null;

  id_category: string | null;
  category_type: string | null;
  category_range: string | null;
  gender: "male" | "female" | "mixed" | null;
  inscription_price: number | string | null;
  quotas: number | string | null;
  status: string | null;
};

export class AdminTournamentRepository {
  private pool: Pool;

  private tournamentsTable = "tournaments";
  private enrollmentsTable = "enrollments";
  private usersTable = "users";
  private tournamentCategoriesTable = "tournament_categories";
  private clubsTable = "clubs";

  constructor(pool?: Pool) {
    this.pool = pool ?? DB.getPool();
  }

  // -----------------------
  // HELPERS
  // -----------------------
  private async safeRollback(client: PoolClient): Promise<void> {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error(
        "[AdminTournamentRepository.safeRollback] rollback failed:",
        rollbackError
      );
    }
  }

  private async withTransaction<T>(
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await this.safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  private formatDate(value: string | Date | null | undefined): string {
    if (!value) return "";
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return value.toString();
  }

  private formatTime(value: string | null | undefined): string | null {
    if (!value) return null;
    return value.toString();
  }

  private mapCategoryRow(row: CategoryRow): TournamentCategoryDTO {
    return {
      id_category: row.id_category,
      category_type: row.category_type,
      category_range: row.category_range,
      gender: row.gender,
      inscription_price: Number(row.inscription_price),
      quotas: row.quotas === null ? null : Number(row.quotas),
      status: row.status,
    };
  }

  private mapTournamentRowToITournament(
    tournamentRow: TournamentRow,
    categoryRows: CategoryRow[]
  ): ITournament {
    return {
      id_tournament: tournamentRow.id_tournament,
      tournament_name: tournamentRow.tournament_name,
      description: tournamentRow.description ?? null,
      created_by: tournamentRow.created_by,
      allow_mixed: tournamentRow.allow_mixed,
      allow_olympic: tournamentRow.allow_olympic,
      address: tournamentRow.address ?? null,
      region: tournamentRow.region ?? null,
      event_date: this.formatDate(tournamentRow.event_date),
      event_time: this.formatTime(tournamentRow.event_time),
      categories: categoryRows.map((row) => this.mapCategoryRow(row)),
    };
  }

  private mapTournamentListBase(row: TournamentWithCategoryRow): ITournament {
    return {
      id_tournament: row.id_tournament,
      tournament_name: row.tournament_name,
      description: row.description ?? null,
      created_by: row.created_by,
      allow_mixed: row.allow_mixed,
      allow_olympic: row.allow_olympic,
      address: row.address ?? null,
      region: row.region ?? null,
      event_date: this.formatDate(row.event_date),
      event_time: this.formatTime(row.event_time),
      categories: [],
    };
  }

  private mapAdminTournamentRow(row: TournamentRow): AdminTournamentRow {
    return {
      id_tournament: row.id_tournament,
      tournament_name: row.tournament_name,
      description: row.description ?? null,
      created_by: row.created_by,
      allow_mixed: row.allow_mixed,
      allow_olympic: row.allow_olympic,
      address: row.address ?? null,
      region: row.region ?? null,
      event_date: row.event_date ? row.event_date.toString() : null,
      event_time: row.event_time ? row.event_time.toString() : null,
      created_at: row.created_at ? row.created_at.toString() : "",
    };
  }

  private mapEnrollmentRow(row: EnrollmentRow): EnrollmentRow {
    return {
      ...row,
      first_name: row.first_name ?? null,
      last_name: row.last_name ?? null,
      gender: row.gender ?? null,
      id_club: row.id_club ?? null,
      club_name: row.club_name ?? null,
      enrolled_at: row.enrolled_at ? row.enrolled_at.toString() : row.enrolled_at,
    };
  }

  private mapAdminCategoryRow(row: AdminCategoryRow): AdminCategoryRow {
    return {
      ...row,
      inscription_price: Number(row.inscription_price),
      quotas: row.quotas === null ? null : Number(row.quotas),
      enrolled_count: Number(row.enrolled_count),
    };
  }

  private mapAdminCategoryPlayerRow(
    row: AdminCategoryPlayerRow
  ): AdminCategoryPlayerRow {
    return {
      ...row,
      first_name: row.first_name ?? null,
      last_name: row.last_name ?? null,
      id_club: row.id_club ?? null,
      club_name: row.club_name ?? null,
      gender: row.gender ?? null,
      enrolled_at: row.enrolled_at ? row.enrolled_at.toString() : row.enrolled_at,
    };
  }

  // -----------------------
  // CREATE TOURNAMENT (helpers)
  // -----------------------
  private async insertTournament(
    client: PoolClient,
    payload: TournamentCreateDTO
  ): Promise<TournamentRow> {
    const query = `
      INSERT INTO ${this.tournamentsTable}
        (
          tournament_name,
          description,
          created_by,
          allow_mixed,
          allow_olympic,
          event_date,
          event_time,
          address,
          region
        )
      VALUES
        ($1, $2, $3, $4, $5, $6::date, $7::time, $8, $9)
      RETURNING *;
    `;

    const values = [
      payload.tournament_name?.trim(),
      payload.description ?? null,
      payload.created_by,
      payload.allow_mixed,
      payload.allow_olympic,
      payload.event_date,
      payload.event_time ?? null,
      payload.address ?? null,
      payload.region ?? null,
    ];

    const res: QueryResult<TournamentRow> = await client.query(query, values);
    return res.rows[0];
  }

  private async insertCategories(
    client: PoolClient,
    tournamentId: string,
    categories?: TournamentCategoryDTO[]
  ): Promise<CategoryRow[]> {
    if (!Array.isArray(categories) || categories.length === 0) return [];

    const values: Array<string | number | null> = [];
    const placeholders: string[] = [];

    categories.forEach((cat, index) => {
      const base = index * 7;

      placeholders.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`
      );

      values.push(
        tournamentId,
        cat.category_type.trim(),
        cat.category_range.trim(),
        cat.gender,
        cat.inscription_price,
        cat.quotas ?? null,
        cat.status ?? "active"
      );
    });

    const query = `
      INSERT INTO ${this.tournamentCategoriesTable}
        (
          id_tournament,
          category_type,
          category_range,
          gender,
          inscription_price,
          quotas,
          status
        )
      VALUES ${placeholders.join(",")}
      RETURNING *;
    `;

    const res: QueryResult<CategoryRow> = await client.query(query, values);
    return res.rows;
  }

  // -----------------------
  // ADMIN: CREATE TOURNAMENT
  // -----------------------
  async createTournament(payload: TournamentCreateDTO): Promise<ITournament> {
    try {
      return await this.withTransaction(async (client) => {
        const tournamentRow = await this.insertTournament(client, payload);

        const categoryRows = await this.insertCategories(
          client,
          tournamentRow.id_tournament,
          payload.categories
        );

        return this.mapTournamentRowToITournament(tournamentRow, categoryRows);
      });
    } catch (error: any) {
      if (error?.code === "23505") {
        throw new Error("CATEGORY_DUPLICATE");
      }

      console.error("[AdminTournamentRepository.createTournament] Error:", error);
      throw new Error(error?.message || "CREATE_TOURNAMENT_FAILED");
    }
  }

  // -----------------------
  // LIST TOURNAMENTS
  // -----------------------
  async findAll(filters?: { q?: string; region?: string }): Promise<ITournament[]> {
    const client = await this.pool.connect();

    try {
      const where: string[] = [];
      const values: string[] = [];
      let i = 1;

      const q = (filters?.q ?? "").trim();
      const region = (filters?.region ?? "").trim();

      if (region) {
        where.push(`t.region = $${i++}`);
        values.push(region);
      }

      if (q) {
        where.push(`
          (
            t.tournament_name ILIKE $${i}
            OR COALESCE(t.region, '') ILIKE $${i}
            OR COALESCE(t.address, '') ILIKE $${i}
            OR COALESCE(c.category_type, '') ILIKE $${i}
            OR COALESCE(c.category_range, '') ILIKE $${i}
          )
        `);
        values.push(`%${q}%`);
        i++;
      }

      const query = `
        SELECT
          t.id_tournament,
          t.tournament_name,
          t.description,
          t.created_by,
          t.allow_mixed,
          t.allow_olympic,
          t.address,
          t.region,
          t.event_date,
          t.event_time,
          t.created_at,

          c.id_category,
          c.category_type,
          c.category_range,
          c.gender,
          c.inscription_price,
          c.quotas,
          c.status
        FROM ${this.tournamentsTable} t
        LEFT JOIN ${this.tournamentCategoriesTable} c
          ON c.id_tournament = t.id_tournament
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY
          t.event_date DESC NULLS LAST,
          t.created_at DESC,
          c.category_type ASC,
          c.category_range ASC,
          c.gender ASC;
      `;

      const res: QueryResult<TournamentWithCategoryRow> = await client.query(
        query,
        values
      );

      const map = new Map<string, ITournament>();

      for (const row of res.rows) {
        if (!map.has(row.id_tournament)) {
          map.set(row.id_tournament, this.mapTournamentListBase(row));
        }

        if (row.id_category) {
          map.get(row.id_tournament)!.categories.push({
            id_category: row.id_category,
            category_type: row.category_type ?? "",
            category_range: row.category_range ?? "",
            gender: row.gender ?? "mixed",
            inscription_price: Number(row.inscription_price),
            quotas: row.quotas === null ? null : Number(row.quotas),
            status: row.status ?? "active",
          });
        }
      }

      return Array.from(map.values());
    } catch (error: any) {
      console.error("[AdminTournamentRepository.findAll] Error:", error);
      throw new Error(error?.message || "Error fetching tournaments");
    } finally {
      client.release();
    }
  }

  // -----------------------
  // TOURNAMENTS CREATED BY ADMIN
  // -----------------------
  async findByCreator(createdBy: string): Promise<AdminTournamentRow[]> {
    const client = await this.pool.connect();

    try {
      const query = `
        SELECT
          t.id_tournament,
          t.tournament_name,
          t.description,
          t.created_by,
          t.allow_mixed,
          t.allow_olympic,
          t.address,
          t.region,
          t.event_date,
          t.event_time,
          t.created_at
        FROM ${this.tournamentsTable} t
        WHERE t.created_by = $1
        ORDER BY t.created_at DESC;
      `;

      const res: QueryResult<TournamentRow> = await client.query(query, [createdBy]);

      return res.rows.map((row) => this.mapAdminTournamentRow(row));
    } finally {
      client.release();
    }
  }

  // -----------------------
  // ENROLLMENTS BY TOURNAMENT (all categories)
  // -----------------------
  async findEnrollmentsByTournament(tournamentId: string): Promise<EnrollmentRow[]> {
    const client = await this.pool.connect();

    try {
      const query = `
        SELECT
          e.id_user,
          e.id_category,
          e.status,
          e.enrolled_at,

          u.email,
          u.first_name,
          u.last_name,
          u.gender,
          u.id_club,
          cl.name AS club_name,

          c.category_type,
          c.category_range,
          c.gender AS category_gender
        FROM ${this.enrollmentsTable} e
        JOIN ${this.usersTable} u
          ON u.id_user = e.id_user
        LEFT JOIN ${this.clubsTable} cl
          ON cl.id_club = u.id_club
        JOIN ${this.tournamentCategoriesTable} c
          ON c.id_category = e.id_category
        WHERE e.id_tournament = $1
          AND e.status = 'active'
        ORDER BY
          u.last_name NULLS LAST,
          u.first_name NULLS LAST,
          u.email ASC;
      `;

      const res = await client.query(query, [tournamentId]);

      return res.rows.map((row: EnrollmentRow) => this.mapEnrollmentRow(row));
    } finally {
      client.release();
    }
  }

  // -----------------------
  // CATEGORIES WITH COUNT
  // -----------------------
  async findCategoriesWithCount(tournamentId: string): Promise<AdminCategoryRow[]> {
    const query = `
      SELECT
        c.id_category,
        c.category_type,
        c.category_range,
        c.gender,
        c.inscription_price,
        c.quotas,
        c.status,
        COUNT(e.id_enrollment) FILTER (WHERE e.status = 'active')::int AS enrolled_count
      FROM ${this.tournamentCategoriesTable} c
      LEFT JOIN ${this.enrollmentsTable} e
        ON e.id_category = c.id_category
       AND e.id_tournament = c.id_tournament
      WHERE c.id_tournament = $1
      GROUP BY c.id_category
      ORDER BY c.category_type ASC, c.category_range ASC, c.gender ASC;
    `;

    const res = await this.pool.query(query, [tournamentId]);

    return res.rows.map((row: AdminCategoryRow) => this.mapAdminCategoryRow(row));
  }

  // -----------------------
  // PLAYERS BY CATEGORY
  // -----------------------
  async findPlayersByCategory(
    tournamentId: string,
    categoryId: string
  ): Promise<AdminCategoryPlayerRow[]> {
    const query = `
      SELECT
        e.id_enrollment,
        u.id_user,
        u.first_name,
        u.last_name,
        u.email,
        u.id_club,
        cl.name AS club_name,
        u.gender,
        e.enrolled_at
      FROM ${this.enrollmentsTable} e
      JOIN ${this.usersTable} u
        ON u.id_user = e.id_user
      LEFT JOIN ${this.clubsTable} cl
        ON cl.id_club = u.id_club
      WHERE e.id_tournament = $1
        AND e.id_category = $2
        AND e.status = 'active'
      ORDER BY
        u.last_name NULLS LAST,
        u.first_name NULLS LAST,
        u.email ASC;
    `;

    const res = await this.pool.query(query, [tournamentId, categoryId]);

    return res.rows.map((row: AdminCategoryPlayerRow) =>
      this.mapAdminCategoryPlayerRow(row)
    );
  }

  // -----------------------
  // CANCEL ENROLLMENT
  // -----------------------
  async cancelEnrollment(params: {
    tournamentId: string;
    userId: string;
    categoryId: string;
  }): Promise<{ cancelled: boolean }> {
    const client = await this.pool.connect();

    try {
      const query = `
        UPDATE ${this.enrollmentsTable}
           SET status = 'cancelled'
         WHERE id_tournament = $1
           AND id_user = $2
           AND id_category = $3
           AND status = 'active'
         RETURNING id_enrollment;
      `;

      const res = await client.query(query, [
        params.tournamentId,
        params.userId,
        params.categoryId,
      ]);

      return { cancelled: (res.rowCount ?? 0) > 0 };
    } finally {
      client.release();
    }
  }
}