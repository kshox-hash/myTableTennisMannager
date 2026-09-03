import type { Pool, PoolClient, QueryResult } from "pg";
import DB from "../../db/db_configuration";
import { NotificationsRepository } from "../../notifications/notifications_repository";
import { ActivityLogRepository, type ActivityLogRow } from "../../activity/activity_log_repository";

import type {
  TournamentCreateDTO,
  TournamentUpdateDTO,
  ITournament,
  TournamentCategoryDTO,
  TournamentVisibility,
  AdminTournamentRow,
  EnrollmentRow,
  AdminCategoryRow,
  AdminCategoryPlayerRow,
  AdminAddPlayerInput,
  AdminAddPlayerResult,
  PaginatedTournamentResult,
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
  visibility: TournamentVisibility;
  num_tables: number | string;
  default_best_of_sets: number | string;
  event_date: string | Date | null;
  event_time: string | null;
  created_at?: string | Date | null;
  status?: "active" | "cancelled";
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
  qualifiers_per_group: number | string;
  priority: number | string;
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
  visibility: TournamentVisibility;
  num_tables: number | string;
  default_best_of_sets: number | string;
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
  phase: string | null;
  priority?: number | string | null;
  enrolled_count?: number | string | null;
  is_enrolled?: boolean | null;
};

export class AdminTournamentRepository {
  private pool: Pool;
  private notifications: NotificationsRepository;
  private activityLog: ActivityLogRepository;

  private tournamentsTable = "tournaments";
  private enrollmentsTable = "enrollments";
  private usersTable = "users";
  private tournamentCategoriesTable = "tournament_categories";
  private clubsTable = "clubs";

  constructor(pool?: Pool) {
    this.pool = pool ?? DB.getPool();
    this.notifications = new NotificationsRepository(this.pool);
    this.activityLog = new ActivityLogRepository(this.pool);
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

  // Dueño del torneo O coorganizador invitado — mismo criterio para editar y
  // cancelar. Invitar/sacar coorganizadores en sí queda restringido a solo el
  // dueño (ver tournament_organizers_repository.ts).
  private async isOwnerOrOrganizer(
    client: Pool | PoolClient,
    idTournament: string,
    userId: string,
    createdBy: string
  ): Promise<boolean> {
    if (createdBy === userId) return true;
    const res = await client.query(
      `SELECT 1 FROM tournament_organizers WHERE id_tournament = $1 AND id_user = $2`,
      [idTournament, userId]
    );
    return (res.rowCount ?? 0) > 0;
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
      qualifiers_per_group: Number(row.qualifiers_per_group ?? 2),
      priority: Number(row.priority ?? 1),
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
      visibility: tournamentRow.visibility ?? "public",
      num_tables: Number(tournamentRow.num_tables ?? 4),
      default_best_of_sets: Number(tournamentRow.default_best_of_sets ?? 3),
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
      visibility: row.visibility ?? "public",
      num_tables: Number(row.num_tables ?? 4),
      default_best_of_sets: Number(row.default_best_of_sets ?? 3),
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
      visibility: row.visibility ?? "public",
      num_tables: Number(row.num_tables ?? 4),
      default_best_of_sets: Number(row.default_best_of_sets ?? 3),
      event_date: row.event_date ? this.formatDate(row.event_date) : null,
      event_time: row.event_time ? this.formatTime(row.event_time) : null,
      created_at: row.created_at ? row.created_at.toString() : "",
      status: row.status ?? "active",
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
      qualifiers_per_group: Number(row.qualifiers_per_group ?? 2),
      priority: Number(row.priority ?? 1),
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
          region,
          visibility,
          num_tables,
          default_best_of_sets
        )
      VALUES
        ($1, $2, $3, $4, $5, $6::date, $7::time, $8, $9, $10, $11, $12)
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
      payload.visibility ?? "public",
      payload.num_tables ?? 4,
      payload.default_best_of_sets ?? 3,
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
      const base = index * 9;

      placeholders.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`
      );

      values.push(
        tournamentId,
        cat.category_type.trim(),
        cat.category_range.trim(),
        cat.gender,
        cat.inscription_price,
        cat.quotas ?? null,
        cat.status ?? "active",
        cat.qualifiers_per_group ?? 2,
        cat.priority ?? 1
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
          status,
          qualifiers_per_group,
          priority
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
  // ADMIN: UPDATE TOURNAMENT (solo el organizador; categorías con inscritos son inmutables)
  // -----------------------
  async updateTournament(
    tournamentId: string,
    requestedBy: string,
    payload: TournamentUpdateDTO
  ): Promise<{
    tournament: ITournament | null;
    error?: "TOURNAMENT_NOT_FOUND" | "NOT_TOURNAMENT_OWNER" | "TOURNAMENT_ALREADY_CANCELLED";
  }> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      const tRes = await client.query<{ created_by: string; status: string }>(
        `SELECT created_by, status FROM ${this.tournamentsTable} WHERE id_tournament = $1 FOR UPDATE`,
        [tournamentId]
      );
      const t = tRes.rows[0];

      if (!t) {
        await client.query("ROLLBACK");
        return { tournament: null, error: "TOURNAMENT_NOT_FOUND" };
      }
      if (!(await this.isOwnerOrOrganizer(client, tournamentId, requestedBy, t.created_by))) {
        await client.query("ROLLBACK");
        return { tournament: null, error: "NOT_TOURNAMENT_OWNER" };
      }
      if (t.status === "cancelled") {
        await client.query("ROLLBACK");
        return { tournament: null, error: "TOURNAMENT_ALREADY_CANCELLED" };
      }

      const fields: string[] = [];
      const values: Array<string | number | null> = [];
      let i = 1;

      if (payload.tournament_name !== undefined) {
        fields.push(`tournament_name = $${i++}`);
        values.push(payload.tournament_name.trim());
      }
      if (payload.description !== undefined) {
        fields.push(`description = $${i++}`);
        values.push(payload.description);
      }
      if (payload.address !== undefined) {
        fields.push(`address = $${i++}`);
        values.push(payload.address);
      }
      if (payload.region !== undefined) {
        fields.push(`region = $${i++}`);
        values.push(payload.region);
      }
      if (payload.visibility !== undefined) {
        fields.push(`visibility = $${i++}`);
        values.push(payload.visibility);
      }
      if (payload.num_tables !== undefined) {
        fields.push(`num_tables = $${i++}`);
        values.push(payload.num_tables);
      }
      if (payload.default_best_of_sets !== undefined) {
        fields.push(`default_best_of_sets = $${i++}`);
        values.push(payload.default_best_of_sets);
      }
      if (payload.event_date !== undefined) {
        fields.push(`event_date = $${i++}::date`);
        values.push(payload.event_date);
      }
      if (payload.event_time !== undefined) {
        fields.push(`event_time = $${i++}::time`);
        values.push(payload.event_time);
      }

      if (fields.length > 0) {
        values.push(tournamentId);
        await client.query(
          `UPDATE ${this.tournamentsTable} SET ${fields.join(", ")} WHERE id_tournament = $${i}`,
          values
        );
      }

      if (payload.categories) {
        await this.syncCategories(client, tournamentId, payload.categories);
      }

      const tournamentRes = await client.query<TournamentRow>(
        `SELECT * FROM ${this.tournamentsTable} WHERE id_tournament = $1`,
        [tournamentId]
      );
      const categoryRes = await client.query<CategoryRow>(
        `SELECT * FROM ${this.tournamentCategoriesTable}
         WHERE id_tournament = $1
         ORDER BY category_type ASC, category_range ASC, gender ASC`,
        [tournamentId]
      );

      await this.activityLog.record(tournamentId, requestedBy, "tournament_updated", null, client);

      await client.query("COMMIT");

      return {
        tournament: this.mapTournamentRowToITournament(tournamentRes.rows[0], categoryRes.rows),
      };
    } catch (error: any) {
      await this.safeRollback(client);

      if (error?.code === "23505") {
        throw new Error("CATEGORY_DUPLICATE");
      }

      console.error("[AdminTournamentRepository.updateTournament] Error:", error);
      throw new Error(error?.message || "UPDATE_TOURNAMENT_FAILED");
    } finally {
      client.release();
    }
  }

  // Categorías con inscritos activos son inmutables: se actualizan/insertan/eliminan
  // únicamente las que no tienen inscripciones.
  private async syncCategories(
    client: PoolClient,
    tournamentId: string,
    categories: TournamentCategoryDTO[]
  ): Promise<void> {
    const existingRes = await client.query<CategoryRow & { enrolled_count: number }>(
      `SELECT c.*, COUNT(e.id_enrollment) FILTER (WHERE e.status = 'active')::int AS enrolled_count
       FROM ${this.tournamentCategoriesTable} c
       LEFT JOIN ${this.enrollmentsTable} e
         ON e.id_category = c.id_category AND e.id_tournament = c.id_tournament
       WHERE c.id_tournament = $1
       GROUP BY c.id_category`,
      [tournamentId]
    );
    const existingById = new Map(existingRes.rows.map((row) => [row.id_category, row]));
    const incomingIds = new Set(
      categories.filter((c) => c.id_category).map((c) => c.id_category as string)
    );

    for (const cat of categories) {
      const existing = cat.id_category ? existingById.get(cat.id_category) : undefined;

      if (existing) {
        if (Number(existing.enrolled_count) > 0) continue; // categoría con inscritos: inmutable

        await client.query(
          `UPDATE ${this.tournamentCategoriesTable}
             SET category_type = $1, category_range = $2, gender = $3,
                 inscription_price = $4, quotas = $5, qualifiers_per_group = $6,
                 priority = $7
           WHERE id_category = $8`,
          [
            cat.category_type.trim(),
            cat.category_range.trim(),
            cat.gender,
            cat.inscription_price,
            cat.quotas ?? null,
            cat.qualifiers_per_group ?? 2,
            cat.priority ?? 1,
            cat.id_category,
          ]
        );
      } else {
        await client.query(
          `INSERT INTO ${this.tournamentCategoriesTable}
             (id_tournament, category_type, category_range, gender, inscription_price, quotas, status, qualifiers_per_group, priority)
           VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8)`,
          [
            tournamentId,
            cat.category_type.trim(),
            cat.category_range.trim(),
            cat.gender,
            cat.inscription_price,
            cat.quotas ?? null,
            cat.qualifiers_per_group ?? 2,
            cat.priority ?? 1,
          ]
        );
      }
    }

    for (const existing of existingRes.rows) {
      if (!incomingIds.has(existing.id_category) && Number(existing.enrolled_count) === 0) {
        await client.query(
          `DELETE FROM ${this.tournamentCategoriesTable} WHERE id_category = $1`,
          [existing.id_category]
        );
      }
    }
  }

  // -----------------------
  // LIST TOURNAMENTS (paginado)
  // -----------------------
  async findAll(
    filters?: { q?: string; region?: string },
    pagination?: { page: number; limit: number },
    userId?: string
  ): Promise<PaginatedTournamentResult> {
    const page  = Math.max(1, pagination?.page  ?? 1);
    const limit = Math.min(100, Math.max(1, pagination?.limit ?? 20));
    const offset = (page - 1) * limit;

    const where: string[] = ["t.status = 'active'"];
    const values: (string | number | null)[] = [];
    let i = 1;

    const q      = (filters?.q      ?? "").trim();
    const region = (filters?.region ?? "").trim();

    if (region) {
      where.push(`t.region = $${i++}`);
      values.push(region);
    }

    if (q) {
      where.push(`(
        t.tournament_name ILIKE $${i}
        OR COALESCE(t.region, '')        ILIKE $${i}
        OR COALESCE(t.address, '')       ILIKE $${i}
        OR COALESCE(c.category_type, '') ILIKE $${i}
        OR COALESCE(c.category_range, '') ILIKE $${i}
      )`);
      values.push(`%${q}%`);
      i++;
    }

    // Visibilidad: público siempre se ve; privado/interno solo para quien
    // organiza (dueño o co-organizador) o, si es "interno", para alguien
    // del mismo club que el organizador. userId en null (no debería pasar,
    // esta lista siempre va detrás de authRequired, pero por las dudas)
    // hace que created_by/o.id_user/viewer.id_user nunca calcen — SQL trata
    // "columna = NULL" como no-verdadero solo, así que degrada solo a
    // "solo lo público" sin necesidad de un caso aparte.
    const visibilityUserParam = i++;
    where.push(`(
      t.visibility = 'public'
      OR t.created_by = $${visibilityUserParam}
      OR EXISTS (
        SELECT 1 FROM tournament_organizers o
        WHERE o.id_tournament = t.id_tournament AND o.id_user = $${visibilityUserParam}
      )
      OR (
        t.visibility = 'internal'
        AND EXISTS (
          SELECT 1 FROM users creator
          JOIN users viewer ON viewer.id_club = creator.id_club
          WHERE creator.id_user = t.created_by
            AND viewer.id_user = $${visibilityUserParam}
            AND creator.id_club IS NOT NULL
        )
      )
    )`);
    values.push(userId ?? null);

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    // El JOIN contra tournament_categories solo hace falta para el texto
    // libre (busca en category_type/category_range) — sin `q`, unirlo
    // igual produce el producto cruzado de TODOS los torneos × TODAS sus
    // categorías antes del GROUP BY/DISTINCT, solo para terminar
    // devolviendo el mismo id_tournament que ya estaba en `tournaments`.
    // Con 1000 torneos y ~3 categorías c/u eso son ~3000 filas de más en
    // el caso común (navegar sin buscar nada), por una sola columna que
    // ya estaba disponible sin el join.
    const needsCategoryJoin = q.length > 0;
    const categoryJoin = needsCategoryJoin
      ? `LEFT JOIN ${this.tournamentCategoriesTable} c ON c.id_tournament = t.id_tournament`
      : "";

    try {
      // 1. Total de torneos distintos que cumplen el filtro
      const countRes = await this.pool.query<{ total: number }>(
        needsCategoryJoin
          ? `SELECT COUNT(DISTINCT t.id_tournament)::int AS total
             FROM ${this.tournamentsTable} t
             ${categoryJoin}
             ${whereClause}`
          : `SELECT COUNT(*)::int AS total
             FROM ${this.tournamentsTable} t
             ${whereClause}`,
        values
      );
      const total = countRes.rows[0]?.total ?? 0;

      if (total === 0) {
        return { data: [], total: 0, page, limit, total_pages: 0 };
      }

      // 2. IDs paginados (evita OFFSET + JOIN duplicando filas)
      const idsRes = await this.pool.query<{ id_tournament: string }>(
        needsCategoryJoin
          ? `SELECT t.id_tournament
             FROM ${this.tournamentsTable} t
             ${categoryJoin}
             ${whereClause}
             GROUP BY t.id_tournament, t.event_date, t.created_at
             ORDER BY t.event_date DESC NULLS LAST, t.created_at DESC, t.id_tournament DESC
             LIMIT $${i} OFFSET $${i + 1}`
          : `SELECT t.id_tournament
             FROM ${this.tournamentsTable} t
             ${whereClause}
             ORDER BY t.event_date DESC NULLS LAST, t.created_at DESC, t.id_tournament DESC
             LIMIT $${i} OFFSET $${i + 1}`,
        [...values, limit, offset]
      );

      const ids = idsRes.rows.map((r) => r.id_tournament);

      // 3. Datos completos para esos torneos
      const dataRes = await this.pool.query<TournamentWithCategoryRow>(
        `SELECT
           t.id_tournament, t.tournament_name, t.description, t.created_by,
           t.allow_mixed, t.allow_olympic, t.address, t.region, t.visibility,
           t.num_tables, t.default_best_of_sets,
           t.event_date, t.event_time, t.created_at,
           c.id_category, c.category_type, c.category_range, c.gender,
           c.inscription_price, c.quotas, c.status, c.phase, c.priority,
           (SELECT COUNT(*)::int FROM ${this.enrollmentsTable} e
            WHERE e.id_category = c.id_category AND e.status = 'active') AS enrolled_count,
           EXISTS (
             SELECT 1 FROM ${this.enrollmentsTable} e
             WHERE e.id_category = c.id_category AND e.status = 'active' AND e.id_user = $2
           ) AS is_enrolled
         FROM ${this.tournamentsTable} t
         LEFT JOIN ${this.tournamentCategoriesTable} c ON c.id_tournament = t.id_tournament
         WHERE t.id_tournament = ANY($1::uuid[])
         ORDER BY t.event_date DESC NULLS LAST, t.created_at DESC,
                  c.category_type ASC, c.category_range ASC, c.gender ASC`,
        [ids, userId ?? null]
      );

      // Mantener el orden de paginación usando el array de IDs
      const map = new Map<string, ITournament>();
      for (const id of ids) {
        const row = dataRes.rows.find((r) => r.id_tournament === id);
        if (row) map.set(id, this.mapTournamentListBase(row));
      }
      for (const row of dataRes.rows) {
        if (row.id_category) {
          map.get(row.id_tournament)?.categories.push({
            id_category: row.id_category,
            category_type: row.category_type ?? "",
            category_range: row.category_range ?? "",
            gender: row.gender ?? "mixed",
            inscription_price: Number(row.inscription_price),
            quotas: row.quotas === null ? null : Number(row.quotas),
            status: row.status ?? "active",
            phase: row.phase ?? "enrollment",
            priority: Number(row.priority ?? 1),
            enrolled_count: Number(row.enrolled_count ?? 0),
            is_enrolled: Boolean(row.is_enrolled),
          });
        }
      }

      return {
        data: Array.from(map.values()),
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      };
    } catch (error: any) {
      console.error("[AdminTournamentRepository.findAll] Error:", error);
      throw new Error(error?.message || "Error fetching tournaments");
    }
  }

  // -----------------------
  // UN TORNEO PUNTUAL CON SUS CATEGORÍAS (jugador toca un evento del
  // calendario o vuelve a un torneo desde afuera de la lista paginada) —
  // mismo shape que findAll, solo que filtrado a un solo id_tournament.
  // -----------------------
  async findById(id_tournament: string, userId?: string): Promise<ITournament | null> {
    const dataRes = await this.pool.query<TournamentWithCategoryRow>(
      `SELECT
         t.id_tournament, t.tournament_name, t.description, t.created_by,
         t.allow_mixed, t.allow_olympic, t.address, t.region, t.visibility,
         t.num_tables, t.default_best_of_sets,
         t.event_date, t.event_time, t.created_at,
         c.id_category, c.category_type, c.category_range, c.gender,
         c.inscription_price, c.quotas, c.status, c.phase, c.priority,
         (SELECT COUNT(*)::int FROM ${this.enrollmentsTable} e
          WHERE e.id_category = c.id_category AND e.status = 'active') AS enrolled_count,
         EXISTS (
           SELECT 1 FROM ${this.enrollmentsTable} e
           WHERE e.id_category = c.id_category AND e.status = 'active' AND e.id_user = $2
         ) AS is_enrolled
       FROM ${this.tournamentsTable} t
       LEFT JOIN ${this.tournamentCategoriesTable} c ON c.id_tournament = t.id_tournament
       WHERE t.id_tournament = $1
       ORDER BY c.category_type ASC, c.category_range ASC, c.gender ASC`,
      [id_tournament, userId ?? null]
    );

    if (dataRes.rows.length === 0) return null;

    const tournament = this.mapTournamentListBase(dataRes.rows[0]);
    for (const row of dataRes.rows) {
      if (row.id_category) {
        tournament.categories.push({
          id_category: row.id_category,
          category_type: row.category_type ?? "",
          category_range: row.category_range ?? "",
          gender: row.gender ?? "mixed",
          inscription_price: Number(row.inscription_price),
          quotas: row.quotas === null ? null : Number(row.quotas),
          status: row.status ?? "active",
          phase: row.phase ?? "enrollment",
          priority: Number(row.priority ?? 1),
          enrolled_count: Number(row.enrolled_count ?? 0),
          is_enrolled: Boolean(row.is_enrolled),
        });
      }
    }
    return tournament;
  }

  // -----------------------
  // TOURNAMENTS CREATED BY ADMIN (o donde es coorganizador invitado)
  // -----------------------
  // Antes traía TODOS los campeonatos del admin de una — sin límite, y cada
  // uno "activo" disparaba además su propio request de dashboard en
  // paralelo (ver AdminHomePage en el frontend). Paginado igual que el
  // listado público (COUNT aparte + LIMIT/OFFSET), con el mismo filtro de
  // texto y un filtro de "incluir cancelados" — así el fan-out de
  // dashboards queda acotado al tamaño de página, no al total histórico.
  async findByCreator(
    createdBy: string,
    filters: { q?: string; includeCancelled?: boolean },
    pagination: { page: number; limit: number }
  ): Promise<{ rows: AdminTournamentRow[]; total: number; cancelledCount: number }> {
    const ownerClause = `(t.created_by = $1 OR EXISTS (
         SELECT 1 FROM tournament_organizers o
         WHERE o.id_tournament = t.id_tournament AND o.id_user = $1
       ))`;
    const conditions: string[] = [ownerClause];
    const values: unknown[] = [createdBy];
    let i = 2;

    if (filters.q) {
      conditions.push(
        `(t.tournament_name ILIKE $${i} OR t.address ILIKE $${i} OR t.region ILIKE $${i})`
      );
      values.push(`%${filters.q}%`);
      i++;
    }
    if (!filters.includeCancelled) {
      conditions.push(`t.status <> 'cancelled'`);
    }
    const where = `WHERE ${conditions.join(" AND ")}`;

    const client = await this.pool.connect();
    try {
      const countRes = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ${this.tournamentsTable} t ${where}`,
        values
      );
      const total = Number(countRes.rows[0]?.count ?? 0);

      // Para el label "Mostrar cancelados (N)" — cuenta aparte, sin el
      // filtro de status <> 'cancelled' que ya metimos arriba en `where`.
      const cancelledRes = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ${this.tournamentsTable} t WHERE ${ownerClause} AND t.status = 'cancelled'`,
        [createdBy]
      );
      const cancelledCount = Number(cancelledRes.rows[0]?.count ?? 0);

      const offset = (pagination.page - 1) * pagination.limit;
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
          t.visibility,
          t.num_tables,
          t.default_best_of_sets,
          t.event_date,
          t.event_time,
          t.created_at,
          t.status
        FROM ${this.tournamentsTable} t
        ${where}
        ORDER BY t.created_at DESC, t.id_tournament DESC
        LIMIT $${i++} OFFSET $${i++};
      `;

      const res: QueryResult<TournamentRow> = await client.query(query, [
        ...values,
        pagination.limit,
        offset,
      ]);

      return { rows: res.rows.map((row) => this.mapAdminTournamentRow(row)), total, cancelledCount };
    } finally {
      client.release();
    }
  }

  // -----------------------
  // BITÁCORA DE ACTIVIDAD (dueño o coorganizador)
  // -----------------------
  async getActivity(
    idTournament: string,
    requestedBy: string,
    limit?: number,
    offset?: number
  ): Promise<{ data: ActivityLogRow[]; error?: "TOURNAMENT_NOT_FOUND" | "NOT_TOURNAMENT_OWNER" }> {
    const tRes = await this.pool.query<{ created_by: string }>(
      `SELECT created_by FROM ${this.tournamentsTable} WHERE id_tournament = $1`,
      [idTournament]
    );
    const t = tRes.rows[0];
    if (!t) return { data: [], error: "TOURNAMENT_NOT_FOUND" };
    if (!(await this.isOwnerOrOrganizer(this.pool, idTournament, requestedBy, t.created_by))) {
      return { data: [], error: "NOT_TOURNAMENT_OWNER" };
    }
    const data = await this.activityLog.listByTournament(idTournament, limit, offset);
    return { data };
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
          e.checked_in,

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
        c.qualifiers_per_group,
        c.priority,
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
  // ADMIN ADD PLAYER
  // -----------------------
  async adminAddPlayer(input: AdminAddPlayerInput): Promise<AdminAddPlayerResult> {
    try {
      return await this.withTransaction(async (client) => {
        // El insert no tiene FK ni CHECK que impida esto: sin este chequeo el
        // admin puede agregar (y el jugador recibe notificación de "inscripción
        // confirmada" para) un torneo que ya está cancelado.
        const statusRes = await client.query<{ status: string }>(
          `SELECT status FROM ${this.tournamentsTable} WHERE id_tournament = $1`,
          [input.tournamentId]
        );
        if (statusRes.rows[0]?.status === "cancelled") {
          throw new Error("TOURNAMENT_ALREADY_CANCELLED");
        }

        // ON CONFLICT en vez de un INSERT liso: si a este jugador ya lo
        // habían sacado de la categoría antes, su fila queda con
        // status='cancelled' (no se borra) y un INSERT normal chocaba con
        // el UNIQUE (id_user, id_tournament, id_category) — el 23505 se
        // traducía en un falso "ya está inscrito". Volver a agregarlo revive
        // esa fila en vez de intentar crear una nueva.
        // La condición WHERE en el DO UPDATE es la que evita "revivir" a
        // alguien que ya está activo (nada que hacer ahí más que avisar que
        // ya está inscrito, como antes) — solo pisa la fila cuando lo que
        // había era una inscripción cancelada.
        const insertRes = await client.query<AdminAddPlayerResult>(
          `INSERT INTO ${this.enrollmentsTable}
             (id_user, id_tournament, id_category, qualification_type)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id_user, id_tournament, id_category)
           DO UPDATE SET
             status = 'active',
             enrolled_at = NOW(),
             qualification_type = EXCLUDED.qualification_type,
             seed = NULL,
             checked_in = true
           WHERE ${this.enrollmentsTable}.status <> 'active'
           RETURNING
             id_enrollment,
             id_user,
             id_tournament,
             id_category,
             qualification_type,
             status;`,
          [input.userId, input.tournamentId, input.categoryId, input.qualificationType]
        );
        if (insertRes.rowCount === 0) {
          throw new Error("PLAYER_ALREADY_ENROLLED");
        }
        const enrollment = insertRes.rows[0];

        const ctxRes = await client.query<{
          tournament_name: string;
          category_type: string;
          category_range: string;
        }>(
          `SELECT t.tournament_name, tc.category_type, tc.category_range
           FROM tournaments t
           JOIN tournament_categories tc ON tc.id_category = $1
           WHERE t.id_tournament = $2`,
          [input.categoryId, input.tournamentId]
        );
        const ctx = ctxRes.rows[0];
        if (ctx) {
          await this.notifications.create(
            {
              idUser: input.userId,
              type: "enrollment_confirmed",
              title: "Inscripción confirmada",
              message: `Fuiste inscrito en ${ctx.category_type} ${ctx.category_range} (${ctx.tournament_name})`,
              idTournament: input.tournamentId,
              idCategory: input.categoryId,
            },
            client
          );
        }

        return enrollment;
      });
    } catch (error: any) {
      if (error?.message === "TOURNAMENT_ALREADY_CANCELLED") throw error;
      if (error?.code === "23505") throw new Error("PLAYER_ALREADY_ENROLLED");
      if (error?.code === "23503") throw new Error("INVALID_IDS");
      throw error;
    }
  }

  // -----------------------
  // CANCEL ENROLLMENT
  // -----------------------
  // -----------------------
  // CANCEL TOURNAMENT (real, no simulado)
  // -----------------------
  async cancelTournament(
    idTournament: string,
    requestedBy: string
  ): Promise<{ cancelled: boolean; error?: "TOURNAMENT_NOT_FOUND" | "NOT_TOURNAMENT_OWNER" | "TOURNAMENT_ALREADY_CANCELLED" }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const tRes = await client.query<{ created_by: string; status: string; tournament_name: string }>(
        `SELECT created_by, status, tournament_name FROM ${this.tournamentsTable}
         WHERE id_tournament = $1 FOR UPDATE`,
        [idTournament]
      );
      const t = tRes.rows[0];

      if (!t) {
        await client.query("ROLLBACK");
        return { cancelled: false, error: "TOURNAMENT_NOT_FOUND" };
      }
      if (!(await this.isOwnerOrOrganizer(client, idTournament, requestedBy, t.created_by))) {
        await client.query("ROLLBACK");
        return { cancelled: false, error: "NOT_TOURNAMENT_OWNER" };
      }
      if (t.status === "cancelled") {
        await client.query("ROLLBACK");
        return { cancelled: false, error: "TOURNAMENT_ALREADY_CANCELLED" };
      }

      await client.query(
        `UPDATE ${this.tournamentsTable} SET status = 'cancelled' WHERE id_tournament = $1`,
        [idTournament]
      );

      const enrolledRes = await client.query<{ id_user: string }>(
        `SELECT DISTINCT id_user FROM ${this.enrollmentsTable}
         WHERE id_tournament = $1 AND status = 'active'`,
        [idTournament]
      );
      const userIds = enrolledRes.rows.map((r) => r.id_user);

      if (userIds.length > 0) {
        await this.notifications.createForMany(
          userIds,
          {
            type: "tournament_cancelled",
            title: "Campeonato cancelado",
            message: `El campeonato "${t.tournament_name}" fue cancelado por el organizador.`,
            idTournament,
          },
          client
        );
      }

      await this.activityLog.record(idTournament, requestedBy, "tournament_cancelled", null, client);

      await client.query("COMMIT");
      return { cancelled: true };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async cancelEnrollment(params: {
    tournamentId: string;
    userId: string;
    categoryId: string;
  }): Promise<{ cancelled: boolean; error?: "CATEGORY_ALREADY_STARTED" }> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      // Una vez que la categoría salió de "enrollment" (ya se generaron grupos)
      // ya no se puede sacar gente: rompería los grupos/cuadros ya armados.
      const phaseRes = await client.query<{ phase: string }>(
        `SELECT phase FROM ${this.tournamentCategoriesTable} WHERE id_category = $1 FOR UPDATE`,
        [params.categoryId]
      );
      const phase = phaseRes.rows[0]?.phase ?? "enrollment";
      if (phase !== "enrollment") {
        await client.query("ROLLBACK");
        return { cancelled: false, error: "CATEGORY_ALREADY_STARTED" };
      }

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

      const cancelled = (res.rowCount ?? 0) > 0;

      if (cancelled) {
        const ctxRes = await client.query<{
          tournament_name: string;
          category_type: string;
          category_range: string;
        }>(
          `SELECT t.tournament_name, tc.category_type, tc.category_range
           FROM tournaments t
           JOIN tournament_categories tc ON tc.id_category = $1
           WHERE t.id_tournament = $2`,
          [params.categoryId, params.tournamentId]
        );
        const ctx = ctxRes.rows[0];
        if (ctx) {
          await this.notifications.create(
            {
              idUser: params.userId,
              type: "enrollment_removed",
              title: "Inscripción cancelada",
              message: `Tu inscripción en ${ctx.category_type} ${ctx.category_range} (${ctx.tournament_name}) fue cancelada por el organizador`,
              idTournament: params.tournamentId,
              idCategory: params.categoryId,
            },
            client
          );
        }
      }

      await client.query("COMMIT");
      return { cancelled };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async setCheckIn(params: {
    tournamentId: string;
    userId: string;
    categoryId: string;
    checkedIn: boolean;
  }): Promise<{ ok: boolean; error?: "CATEGORY_ALREADY_STARTED" }> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      // Mismo criterio que cancelEnrollment: una vez que la categoría salió
      // de "enrollment" (ya se generaron grupos) el check-in ya no tiene
      // efecto — no tiene sentido dejar tocarlo.
      const phaseRes = await client.query<{ phase: string }>(
        `SELECT phase FROM ${this.tournamentCategoriesTable} WHERE id_category = $1 FOR UPDATE`,
        [params.categoryId]
      );
      const phase = phaseRes.rows[0]?.phase ?? "enrollment";
      if (phase !== "enrollment") {
        await client.query("ROLLBACK");
        return { ok: false, error: "CATEGORY_ALREADY_STARTED" };
      }

      const query = `
        UPDATE ${this.enrollmentsTable}
           SET checked_in = $4
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
        params.checkedIn,
      ]);

      await client.query("COMMIT");
      return { ok: (res.rowCount ?? 0) > 0 };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw error;
    } finally {
      client.release();
    }
  }
}