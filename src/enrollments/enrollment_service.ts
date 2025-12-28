import DB from "../db/db_configuration";
import type { PoolClient } from "pg";
import { EnrollmentRepository } from "./enrollment_repository";

export class EnrollmentService {
  private repo = new EnrollmentRepository();

  async enroll(payload: { id_user: string; id_tournament: string; id_category: string }) {
    const db = new DB();
    const client = (await db.connect()) as PoolClient;

    try {
      await client.query("BEGIN");

      // 1) Asegurar que el user es player
      await this.repo.assertUserIsPlayer(client, payload.id_user);

      // 2) Bloquear categoría (evita sobrepasar cupos)
      const category = await this.repo.lockCategoryRow(
        client,
        payload.id_tournament,
        payload.id_category
      );

      // 3) Contar inscritos activos en esa categoría
      const current = await this.repo.countActiveByCategory(client, payload.id_category);

      // 4) Validar cupos
      if (current >= Number(category.quotas)) {
        throw new Error("CATEGORY_FULL");
      }

      // 5) Insertar (si ya estaba inscrito, UNIQUE explotará)
      const enrollment = await this.repo.create(
        client,
        payload.id_user,
        payload.id_tournament,
        payload.id_category
      );

      await client.query("COMMIT");
      return enrollment;
    } catch (err: any) {
      await client.query("ROLLBACK");

      // Manejo de error UNIQUE (duplicado)
      if (err?.code === "23505") {
        // error de unique constraint
        throw new Error("ALREADY_ENROLLED");
      }

      throw err;
    }
  }
}
