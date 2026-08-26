import type { Pool } from "pg";
import DB from "../../db/db_configuration";
import { RANKED_PLAYERS_CTE } from "../../ranking/ranking_repository";

export type SeedRow = {
  id_enrollment:    string;
  id_user:          string;
  first_name:       string | null;
  last_name:        string | null;
  email:            string;
  seed:             number | null;
  ranking_points:   number | null;
  ranking_position: number | null;
};

export class SeedingRepository {
  private pool: Pool;
  constructor(pool?: Pool) { this.pool = pool ?? DB.getPool(); }

  // El ranking detectado (ranking_points/ranking_position) viaja acá para que
  // la pantalla de semillas pueda proponer un orden inicial basado en el
  // ranking real — mismo CTE que ya usa loadPlayersForCategory para el
  // armado de grupos, así que ambos coinciden siempre.
  async getSeeds(id_tournament: string, id_category: string): Promise<SeedRow[]> {
    const res = await this.pool.query<SeedRow>(
      `WITH ranked_players AS (${RANKED_PLAYERS_CTE})
       SELECT
         e.id_enrollment,
         e.id_user,
         u.first_name,
         u.last_name,
         u.email,
         e.seed,
         rp.ranking_points,
         rp.ranking_position
       FROM enrollments e
       JOIN users u ON u.id_user = e.id_user
       LEFT JOIN ranked_players rp ON rp.id_user = e.id_user
       WHERE e.id_tournament = $1
         AND e.id_category   = $2
         AND e.status = 'active'
       ORDER BY e.seed ASC NULLS LAST, u.last_name ASC, u.first_name ASC`,
      [id_tournament, id_category]
    );
    return res.rows.map(r => ({
      ...r,
      seed: r.seed != null ? Number(r.seed) : null,
      ranking_points: r.ranking_points != null ? Number(r.ranking_points) : null,
      ranking_position: r.ranking_position != null ? Number(r.ranking_position) : null,
    }));
  }

  // Recibe array ordenado de id_enrollment → asigna seed 1, 2, 3...
  async saveSeeds(seeds: { id_enrollment: string; seed: number }[]): Promise<void> {
    if (seeds.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const { id_enrollment, seed } of seeds) {
        await client.query(
          `UPDATE enrollments SET seed = $1 WHERE id_enrollment = $2`,
          [seed, id_enrollment]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async clearSeeds(id_tournament: string, id_category: string): Promise<void> {
    await this.pool.query(
      `UPDATE enrollments SET seed = NULL
       WHERE id_tournament = $1 AND id_category = $2`,
      [id_tournament, id_category]
    );
  }
}
