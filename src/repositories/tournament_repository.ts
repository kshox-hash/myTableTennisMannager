// src/repositories/tournament_repository.ts

import DB from "../db/db_configuration";
import type { PoolClient } from "pg";
import type {
  TournamentCreateDTO,
  ITournament,
  TournamentCategoryDTO,
} from "../interfaces/dto/tournament_dto";

export class TournamentRepository {
  private tournamentsTable = "tournaments";
  private tournamentCategoriesTable = "tournament_categories";

  // ============================
  // Helper: insert tournament
  // ============================
  private async insertTournament(client: PoolClient, payload: TournamentCreateDTO) {
    const query = `
      INSERT INTO ${this.tournamentsTable}
        (tournament_name, description, location, created_by)
      VALUES
        ($1, $2, $3, $4)
      RETURNING *;
    `;

    const values = [
      payload.tournament_name,
      payload.description,
      payload.location,
      payload.created_by,
    ];

    const res = await client.query(query, values);
    return res.rows[0];
  }

  // =================================
  // Helper: insert tournament categories
  // =================================
  private async insertCategories(
    client: PoolClient,
    tournament_id: string,
    categories: TournamentCategoryDTO[]
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
        cat.category_name,
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

  // ============================
  // CREATE
  // ============================
  async create(payload: TournamentCreateDTO): Promise<ITournament> {
    const db = new DB();                 // ✅ your DB class is fine
    const client = (await db.connect()) as PoolClient;

    try {
      await client.query("BEGIN");

      // 1) Insert tournament
      const tournamentRow = await this.insertTournament(client, payload);
      const tournament_id: string = tournamentRow.id_tournament;

      // 2) Insert categories
      const categoryRows = await this.insertCategories(
        client,
        tournament_id,
        payload.categories
      );

      await client.query("COMMIT");

      // Map DB rows -> DTO
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
        categories: categoriesDTO,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("[TournamentRepository] Error:", error);
      throw new Error("Error creating tournament");
    } 
  }
}
