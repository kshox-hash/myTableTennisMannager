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

  // Ranking privado de UN administrador: no vive en player_stats (eso es el
  // acumulado global de TODA la plataforma, sin distinguir quién organizó
  // qué) — se recalcula al leer, igual que getPointsSummary de un torneo
  // puntual (tournament_dashboard_repository.ts), pero uniendo TODOS los
  // torneos de los que este admin es dueño (created_by). matches_played/won
  // cuentan siempre (mismo criterio que player_stats en brackets_repository);
  // ranking_points solo suma los partidos de torneos puntuables
  // (is_ranked = true) — así un admin que arma un torneo amistoso no le
  // infla los puntos a nadie en SU propio ranking tampoco.
  async getOrganizerRanking(idAdmin: string, limit = 200): Promise<RankingRow[]> {
    const q = `
      WITH admin_tournaments AS (
        SELECT id_tournament, is_ranked FROM tournaments WHERE created_by = $1
      ),
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
          (SELECT COUNT(*) FROM tm WHERE tm.winner_id = p.id_user AND tm.is_ranked) AS ranked_wins
        FROM players p
      )
      SELECT
        a.id_user, u.first_name, u.last_name, u.email,
        cl.name AS club_name,
        (a.ranked_wins * ${RANKING_POINTS_PER_WIN}) AS ranking_points,
        a.matches_played, a.matches_won,
        ROW_NUMBER() OVER (
          ORDER BY (a.ranked_wins * ${RANKING_POINTS_PER_WIN}) DESC, a.matches_played ASC, u.last_name ASC NULLS LAST
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
