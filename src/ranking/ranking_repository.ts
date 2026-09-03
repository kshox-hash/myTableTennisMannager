import type { Pool } from "pg";
import DB from "../db/db_configuration";

// Puntaje simple para arrancar: puntos fijos por victoria (walkover incluido,
// mismo criterio que ya usa player_stats.matches_won). Nada de rating
// dinámico (Elo) todavía.
export const RANKING_POINTS_PER_WIN = 3;

// La posición NO se guarda — se calcula acá, al leer. Recalcularla en cada
// resultado de partido implicaría tocar a TODOS los jugadores de la
// plataforma (a diferencia de la posición dentro de un grupo, que son 2-4
// jugadores). Un mismo fragmento de SQL alimenta tanto la pantalla de
// ranking (getGlobalRanking) como el armado de grupos
// (BracketsRepository.loadPlayersForCategory), para no duplicar el criterio
// de orden en dos lugares.
export const RANKED_PLAYERS_CTE = `
  SELECT
    id_user, ranking_points, matches_played, matches_won, matches_lost,
    ROW_NUMBER() OVER (
      ORDER BY ranking_points DESC, (sets_won - sets_lost) DESC, matches_played ASC, id_user ASC
    ) AS ranking_position
  FROM player_stats
  WHERE matches_played > 0
`;

export type RankingRow = {
  id_user: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  club_name: string | null;
  ranking_points: number;
  ranking_position: number;
  matches_played: number;
  matches_won: number;
};

export class RankingRepository {
  private pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool ?? DB.getPool();
  }

  async getGlobalRanking(limit = 200): Promise<RankingRow[]> {
    const q = `
      WITH ranked_players AS (${RANKED_PLAYERS_CTE})
      SELECT
        rp.id_user, u.first_name, u.last_name, u.email,
        cl.name AS club_name,
        rp.ranking_points, rp.ranking_position, rp.matches_played, rp.matches_won
      FROM ranked_players rp
      JOIN users u ON u.id_user = rp.id_user
      LEFT JOIN clubs cl ON cl.id_club = u.id_club
      ORDER BY rp.ranking_position ASC
      LIMIT $1;
    `;
    const res = await this.pool.query(q, [limit]);
    return res.rows as RankingRow[];
  }

  // Un jugador puntual, para la tarjeta "Ranking nacional" del dashboard —
  // sin traer el resto de la tabla completa solo para encontrarse a sí
  // mismo. null = todavía no jugó ningún partido en la plataforma (no
  // entra en RANKED_PLAYERS_CTE, que filtra matches_played > 0).
  async getPlayerRanking(idUser: string): Promise<RankingRow | null> {
    const q = `
      WITH ranked_players AS (${RANKED_PLAYERS_CTE})
      SELECT
        rp.id_user, u.first_name, u.last_name, u.email,
        cl.name AS club_name,
        rp.ranking_points, rp.ranking_position, rp.matches_played, rp.matches_won
      FROM ranked_players rp
      JOIN users u ON u.id_user = rp.id_user
      LEFT JOIN clubs cl ON cl.id_club = u.id_club
      WHERE rp.id_user = $1;
    `;
    const res = await this.pool.query(q, [idUser]);
    return (res.rows[0] as RankingRow) ?? null;
  }
}
