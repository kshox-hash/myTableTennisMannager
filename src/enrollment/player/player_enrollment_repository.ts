import type { Pool, PoolClient, QueryResult } from "pg";
import DB from "../../db/db_configuration";
import type { EnrollmentDTO } from "../../enrollment/schema/enrollent_schema";

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

  private enrollmentsTable = "enrollments";

  constructor(pool?: Pool) {
    this.pool = pool ?? DB.getPool();
  }

  async subscribe(payload: EnrollmentDTO): Promise<EnrollmentRow> {
    const client: PoolClient = await this.pool.connect();

    try {
      const query = `
        INSERT INTO ${this.enrollmentsTable} (
          id_user,
          id_tournament,
          id_category
        )
        VALUES ($1, $2, $3)
        RETURNING
          id_enrollment,
          id_user,
          id_tournament,
          id_category,
          status,
          enrolled_at;
      `;

      const values = [
        payload.id_user,
        payload.id_tournament,
        payload.id_category,
      ];

      const res: QueryResult<EnrollmentRow> = await client.query(query, values);
      return res.rows[0];
    } catch (error: any) {
      if (error?.code === "23505") {
        throw new Error("CONFLICT_ALREADY_ENROLLED");
      }

      if (error?.code === "23503") {
        throw new Error("INVALID_TOURNAMENT_OR_CATEGORY");
      }

      console.error("[EnrollmentsRepository.subscribe] Error:", error);
      throw new Error(error?.message || "SUBSCRIBE_ENROLLMENT_FAILED");
    } finally {
      client.release();
    }
  }
}