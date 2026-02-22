import type { Pool, PoolClient } from "pg";
import DB from "../db/db_configuration";

export class EnrollmentsRepository {
  private pool: Pool;

  private enrollmentsTable = "enrollments";
  private categoriesTable = "tournament_categories";

  constructor(pool?: Pool) {
    this.pool = pool ?? DB.getPool();
  }

  /**
   * Inserta inscripción.
   * - La FK compuesta asegura que la categoría pertenece al torneo.
   * - El índice uq_enrollment_active_user_category evita duplicado activo.
   */
  async subscribe(payload: {
    id_user: string;
    id_tournament: string;
    id_category: string;
  }) {
    const client: PoolClient = await this.pool.connect();

    try {
      const query = `
        INSERT INTO ${this.enrollmentsTable} (id_user, id_tournament, id_category)
        VALUES ($1, $2, $3)
        RETURNING id_enrollment, id_user, id_tournament, id_category, status, enrolled_at;
      `;

      const values = [payload.id_user, payload.id_tournament, payload.id_category];

      const res = await client.query(query, values);
      return res.rows[0];
    } catch (error: any) {
      // 23505 = unique_violation (ya inscrito activo en misma categoría)
      if (error?.code === "23505") {
        throw new Error("CONFLICT_ALREADY_ENROLLED");
      }

      // 23503 = foreign_key_violation (ej: categoría no pertenece a torneo / ids inválidos)
      if (error?.code === "23503") {
        throw new Error("INVALID_TOURNAMENT_OR_CATEGORY");
      }

      console.error("[EnrollmentsRepository.subscribe] Error:", error);
      throw new Error(error?.message || "Error subscribing to category");
    } finally {
      client.release();
    }
  }
}
