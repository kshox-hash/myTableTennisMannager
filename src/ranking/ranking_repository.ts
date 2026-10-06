import type { Pool } from "pg";
import DB from "../db/db_configuration";

import { ittfTotalsSql } from "./ittf_points";

// Puntaje viejo (3 por victoria, acumulado en player_stats.ranking_points).
// Ya no se usa: el ranking se calcula con la tabla ITTF por ronda alcanzada
// en la llave (ittf_points.ts). Queda apagado para que BracketsRepository
// no siga sumando a esa columna.
export const RANKING_POINTS_PER_WIN = 3;
export const LEGACY_WIN_POINTS_ENABLED = false;

// Ranking general (toda la plataforma): puntos ITTF de los últimos 12 meses.
export const GLOBAL_RANKING_ENABLED = true;

// La posición NO se guarda — se calcula al leer. Un mismo fragmento de SQL
// alimenta la pantalla de ranking (getGlobalRanking) y el sembrado de
// grupos/llave (BracketsRepository.loadPlayersForCategory, SeedingRepository).
export const RANKED_PLAYERS_CTE = `
  SELECT
    pts.id_user, pts.ranking_points,
    COALESCE(ps.matches_played, 0) AS matches_played,
    COALESCE(ps.matches_won, 0) AS matches_won,
    COALESCE(ps.matches_lost, 0) AS matches_lost,
    ROW_NUMBER() OVER (
      ORDER BY pts.ranking_points DESC, COALESCE(ps.matches_won, 0) DESC, pts.id_user ASC
    ) AS ranking_position
  FROM (${ittfTotalsSql()}) pts
  LEFT JOIN player_stats ps ON ps.id_user = pts.id_user
`;

export type RankingRow = {
  id_user: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  club_name: string | null;
  avatar_url: string | null;
  ranking_points: number;
  ranking_position: number;
  matches_played: number;
  matches_won: number;
};

// pg devuelve COUNT/ROW_NUMBER (bigint) como texto: se pasan a número.
function numericRow(r: any): RankingRow {
  return {
    ...r,
    ranking_points: Number(r.ranking_points),
    ranking_position: Number(r.ranking_position),
    matches_played: Number(r.matches_played),
    matches_won: Number(r.matches_won),
  };
}

export class RankingRepository {
  private pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool ?? DB.getPool();
  }

  async getGlobalRanking(limit = 200): Promise<RankingRow[]> {
    const q = `
      WITH ranked_players AS (${RANKED_PLAYERS_CTE})
      SELECT
        rp.id_user, u.first_name, u.last_name, u.email, u.avatar_url,
        cl.name AS club_name,
        rp.ranking_points, rp.ranking_position, rp.matches_played, rp.matches_won
      FROM ranked_players rp
      JOIN users u ON u.id_user = rp.id_user
      LEFT JOIN clubs cl ON cl.id_club = u.id_club
      ORDER BY rp.ranking_position ASC
      LIMIT $1;
    `;
    const res = await this.pool.query(q, [limit]);
    return res.rows.map(numericRow);
  }

  // Un jugador puntual, para la tarjeta "Ranking nacional" del dashboard —
  // sin traer el resto de la tabla completa solo para encontrarse a sí
  // mismo. null = todavía no jugó ningún partido en la plataforma (no
  // entra en RANKED_PLAYERS_CTE, que filtra matches_played > 0).
  async getPlayerRanking(idUser: string): Promise<RankingRow | null> {
    const q = `
      WITH ranked_players AS (${RANKED_PLAYERS_CTE})
      SELECT
        rp.id_user, u.first_name, u.last_name, u.email, u.avatar_url,
        cl.name AS club_name,
        rp.ranking_points, rp.ranking_position, rp.matches_played, rp.matches_won
      FROM ranked_players rp
      JOIN users u ON u.id_user = rp.id_user
      LEFT JOIN clubs cl ON cl.id_club = u.id_club
      WHERE rp.id_user = $1;
    `;
    const res = await this.pool.query(q, [idUser]);
    return res.rows[0] ? numericRow(res.rows[0]) : null;
  }

  // Ranking privado de UN administrador: mismos puntos ITTF que el general,
  // pero solo de los campeonatos que él creó (created_by). matches_played/won
  // cuentan todos sus partidos (también los de torneos no puntuables).
  async getOrganizerRanking(idAdmin: string, limit = 200): Promise<RankingRow[]> {
    const q = `
      WITH admin_tournaments AS (
        SELECT id_tournament, is_ranked FROM tournaments WHERE created_by = $1
      ),
      pts AS (${ittfTotalsSql("t.created_by = $1")}),
      tm AS (
        SELECT gm.player1_id AS p1, gm.player2_id AS p2, gm.winner_id, at.is_ranked
        FROM group_matches gm
        JOIN category_groups cg ON cg.id_group = gm.id_group
        JOIN admin_tournaments at ON at.id_tournament = cg.id_tournament
        WHERE gm.winner_id IS NOT NULL
        UNION ALL
        SELECT bm.player1_id, bm.player2_id, bm.winner_id, at.is_ranked
        FROM bracket_matches bm
        JOIN admin_tournaments at ON at.id_tournament = bm.id_tournament
        WHERE bm.winner_id IS NOT NULL
      ),
      players AS (
        SELECT p1 AS id_user FROM tm WHERE p1 IS NOT NULL
        UNION
        SELECT p2 FROM tm WHERE p2 IS NOT NULL
      ),
      agg AS (
        SELECT
          p.id_user,
          (SELECT COUNT(*) FROM tm WHERE tm.p1 = p.id_user OR tm.p2 = p.id_user) AS matches_played,
          (SELECT COUNT(*) FROM tm WHERE tm.winner_id = p.id_user) AS matches_won,
          COALESCE((SELECT pts.ranking_points FROM pts WHERE pts.id_user = p.id_user), 0) AS points
        FROM players p
      )
      SELECT
        a.id_user, u.first_name, u.last_name, u.email, u.avatar_url,
        cl.name AS club_name,
        a.points AS ranking_points,
        a.matches_played, a.matches_won,
        ROW_NUMBER() OVER (
          ORDER BY a.points DESC, a.matches_won DESC, u.last_name ASC NULLS LAST
        ) AS ranking_position
      FROM agg a
      JOIN users u ON u.id_user = a.id_user
      LEFT JOIN clubs cl ON cl.id_club = u.id_club
      -- v1 dobles: los "usuarios equipo" quedan afuera de este ranking
      -- por-organizador (el ranking nacional sí los reparte bien, via
      -- player_stats). Pendiente: expandir la pareja a sus 2 jugadores acá.
      WHERE u.is_team = false
      ORDER BY ranking_position ASC
      LIMIT $2;
    `;
    const res = await this.pool.query(q, [idAdmin, limit]);
    return res.rows.map((r: any) => ({
      ...r,
      ranking_points: Number(r.ranking_points),
      ranking_position: Number(r.ranking_position),
      matches_played: Number(r.matches_played),
      matches_won: Number(r.matches_won),
    })) as RankingRow[];
  }
}
