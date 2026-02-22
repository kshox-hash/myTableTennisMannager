import type { Pool, PoolClient } from "pg";
import DB from "../db/db_configuration";
import type {
  TournamentCreateDTO,
  ITournament,
  TournamentCategoryDTO,
} from "../interfaces/dto/tournament_dto";

export class TournamentRepository {
  private pool: Pool;

  private tournamentsTable = "tournaments";
  private tournamentCategoriesTable = "tournament_categories";

  constructor(pool?: Pool) {
    this.pool = pool ?? DB.getPool();
  }

  private async insertTournament(client: PoolClient, payload: TournamentCreateDTO) {
    const query = `
      INSERT INTO ${this.tournamentsTable}
        (tournament_name, description, location, created_by, event_date, event_time)
      VALUES
        ($1, $2, $3, $4, $5::date, $6::time)
      RETURNING *;
    `;

    const values = [
      payload.tournament_name?.trim(),
      payload.description ?? null,
      payload.location ?? null,
      payload.created_by,

      // ✅ NUEVO
      payload.event_date,
      payload.event_time ?? null,
    ];

    const res = await client.query(query, values);
    return res.rows[0];
  }

  private async insertCategories(
    client: PoolClient,
    tournament_id: string,
    categories?: TournamentCategoryDTO[]
  ) {
    if (!Array.isArray(categories) || categories.length === 0) return [];

    const values: any[] = [];
    const placeholders: string[] = [];

    categories.forEach((cat, index) => {
      const base = index * 5;
      placeholders.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`
      );

      values.push(
        tournament_id,
        cat.category_name.trim(),
        cat.gender,
        cat.inscription_price,
        cat.quotas
      );
    });

    const query = `
      INSERT INTO ${this.tournamentCategoriesTable}
        (id_tournament, category_name, gender, inscription_price, quotas)
      VALUES ${placeholders.join(",")}
      RETURNING *;
    `;

    const res = await client.query(query, values);
    return res.rows;
  }

  async create(payload: TournamentCreateDTO): Promise<ITournament> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      const tournamentRow = await this.insertTournament(client, payload);
      const tournament_id: string = tournamentRow.id_tournament;

      const categoryRows = await this.insertCategories(
        client,
        tournament_id,
        payload.categories
      );

      await client.query("COMMIT");

      const categoriesDTO: TournamentCategoryDTO[] = categoryRows.map((row: any) => ({
        id_category: row.id_category,
        category_name: row.category_name,
        gender: row.gender,
        inscription_price: Number(row.inscription_price),
        quotas: Number(row.quotas),
      }));

      return {
        id_tournament: tournament_id,
        tournament_name: tournamentRow.tournament_name,
        description: tournamentRow.description,
        location: tournamentRow.location,
        created_by: tournamentRow.created_by,

        // ✅ NUEVO
        event_date: tournamentRow.event_date?.toString() ?? "",
        event_time: tournamentRow.event_time ? tournamentRow.event_time.toString() : null,

        categories: categoriesDTO,
      };
    } catch (error: any) {
      await client.query("ROLLBACK");

      if (error?.code === "23505") {
        throw new Error("Conflicto: ya existe una categoría igual en este torneo");
      }

      console.error("[TournamentRepository.create] Error:", error);
      throw new Error(error?.message || "Error creating tournament");
    } finally {
      client.release();
    }
  }

  async getAll(): Promise<ITournament[]> {
    const client = await this.pool.connect();

    try {
      const query = `
        SELECT
          t.id_tournament,
          t.tournament_name,
          t.description,
          t.location,
          t.created_by,

          -- ✅ NUEVO
          t.event_date,
          t.event_time,

          t.created_at,

          c.id_category,
          c.category_name,
          c.gender,
          c.inscription_price,
          c.quotas
        FROM ${this.tournamentsTable} t
        LEFT JOIN ${this.tournamentCategoriesTable} c
          ON c.id_tournament = t.id_tournament
        ORDER BY
          t.event_date DESC NULLS LAST,
          t.created_at DESC,
          c.category_name ASC,
          c.gender ASC;
      `;

      const res = await client.query(query);
      const map = new Map<string, ITournament>();

      for (const row of res.rows) {
        if (!map.has(row.id_tournament)) {
          map.set(row.id_tournament, {
            id_tournament: row.id_tournament,
            tournament_name: row.tournament_name,
            description: row.description,
            location: row.location,
            created_by: row.created_by,

            // ✅ NUEVO
            event_date: row.event_date?.toString() ?? "",
            event_time: row.event_time ? row.event_time.toString() : null,

            categories: [],
          });
        }

        if (row.id_category) {
          map.get(row.id_tournament)!.categories.push({
            id_category: row.id_category,
            category_name: row.category_name,
            gender: row.gender,
            inscription_price: Number(row.inscription_price),
            quotas: Number(row.quotas),
          });
        }
      }

      return Array.from(map.values());
    } catch (error: any) {
      console.error("[TournamentRepository.getAll] Error:", error);
      throw new Error(error?.message || "Error fetching tournaments");
    } finally {
      client.release();
    }
  }
}
