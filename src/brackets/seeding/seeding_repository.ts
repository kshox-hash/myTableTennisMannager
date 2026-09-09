import type { Pool } from "pg";
import DB from "../../db/db_configuration";
import { RANKED_PLAYERS_CTE, RankingRepository } from "../../ranking/ranking_repository";

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

// "general" = ranking nacional (todos los torneos de la plataforma, tabla
// player_stats). "interno" = ranking privado del ADMIN DUEÑO de este
// torneo (solo sus propios torneos) — el mismo que ve en "Mi Ranking",
// para admins que arman su propio circuito y quieren sembrar según su
// propia historia, no la de toda la plataforma.
export type RankingSource = "general" | "interno";

export class SeedingRepository {
  private pool: Pool;
  private rankingRepo: RankingRepository;
  constructor(pool?: Pool) {
    this.pool = pool ?? DB.getPool();
    this.rankingRepo = new RankingRepository(this.pool);
  }

  // El ranking detectado (ranking_points/ranking_position) viaja acá para que
  // la pantalla de semillas pueda proponer un orden inicial basado en el
  // ranking real — mismo CTE que ya usa loadPlayersForCategory para el
  // armado de grupos, así que ambos coinciden siempre. rankingSource permite
  // pedir en cambio el ranking privado del admin dueño del torneo (ver
  // RankingSource arriba) — se resuelve con una query aparte
  // (getOrganizerRanking, la misma que alimenta "Mi Ranking") y se pega acá
  // en JS, para no duplicar esa unión de group_matches+bracket_matches
  // dentro de esta consulta.
  async getSeeds(id_tournament: string, id_category: string, rankingSource: RankingSource = "general"): Promise<SeedRow[]> {
    if (rankingSource === "interno") {
      return this.getSeedsWithOrganizerRanking(id_tournament, id_category);
    }

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

  private async getSeedsWithOrganizerRanking(id_tournament: string, id_category: string): Promise<SeedRow[]> {
    const ownerRes = await this.pool.query<{ created_by: string }>(
      `SELECT created_by FROM tournaments WHERE id_tournament = $1`,
      [id_tournament]
    );
    const idAdmin = ownerRes.rows[0]?.created_by ?? null;

    const rankByUser = new Map<string, { points: number; position: number }>();
    if (idAdmin) {
      const rows = await this.rankingRepo.getOrganizerRanking(idAdmin);
      for (const r of rows) rankByUser.set(r.id_user, { points: r.ranking_points, position: r.ranking_position });
    }

    const res = await this.pool.query<Omit<SeedRow, "ranking_points" | "ranking_position">>(
      `SELECT e.id_enrollment, e.id_user, u.first_name, u.last_name, u.email, e.seed
       FROM enrollments e
       JOIN users u ON u.id_user = e.id_user
       WHERE e.id_tournament = $1
         AND e.id_category   = $2
         AND e.status = 'active'
       ORDER BY e.seed ASC NULLS LAST, u.last_name ASC, u.first_name ASC`,
      [id_tournament, id_category]
    );
    return res.rows.map(r => {
      const rank = rankByUser.get(r.id_user);
      return {
        ...r,
        seed: r.seed != null ? Number(r.seed) : null,
        ranking_points: rank?.points ?? null,
        ranking_position: rank?.position ?? null,
      };
    });
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
