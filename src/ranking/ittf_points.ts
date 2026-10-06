// Puntaje del ranking al estilo ITTF/WTT: los puntos se ganan por la ronda
// que alcanzas en la LLAVE (la fase de grupos no da puntos, igual que en el
// circuito mundial; en grupo único cuenta el puesto final de la tabla). El
// nivel del campeonato (tournaments.ranking_level)
// elige la fila de la tabla oficial:
//   local    → WTT Feeder
//   regional → WTT Contender
//   nacional → WTT Champions
// Clave de cada tabla = tamaño de la ronda en que quedaste: 1 = campeón,
// 2 = finalista, 4 = semifinal, 8 = cuartos, 16 = octavos, 32, 64.

export type RankingLevel = "local" | "regional" | "nacional";

export const ITTF_POINTS: Record<RankingLevel, Record<number, number>> = {
  local: { 1: 125, 2: 90, 4: 45, 8: 25, 16: 15, 32: 8, 64: 2 },
  regional: { 1: 400, 2: 280, 4: 140, 8: 70, 16: 35, 32: 4 },
  nacional: { 1: 1000, 2: 700, 4: 350, 8: 175, 16: 90, 32: 15 },
};

// Ventana del ranking: últimos 12 meses (como el ranking mundial).
export const RANKING_WINDOW = "12 months";

function pointsCase(levelCol: string, sizeCol: string): string {
  const levels = (Object.keys(ITTF_POINTS) as RankingLevel[]).map((lvl) => {
    const whens = Object.entries(ITTF_POINTS[lvl])
      .map(([size, pts]) => `WHEN ${size} THEN ${pts}`)
      .join(" ");
    return `WHEN '${lvl}' THEN CASE ${sizeCol} ${whens} ELSE 0 END`;
  });
  return `CASE ${levelCol} ${levels.join(" ")} ELSE 0 END`;
}

/**
 * SELECT (id_user, id_tournament, points): puntos de cada jugador en cada
 * campeonato puntuable y terminado. Si jugó varias categorías del mismo
 * campeonato cuenta solo la mejor (en el ranking mundial cada torneo suma
 * un resultado de singles). Las categorías cortadas con "Finalizar
 * campeonato" (finished_early) no dan puntos, igual que no dan podio.
 *
 * La ronda 0 es la pre-llave manual: quien pierde ahí queda una ronda
 * antes que la primera de la llave.
 *
 * `scope` es una condición SQL extra sobre `t` (tournaments), p. ej.
 * "t.created_by = $1". `windowed` limita a los últimos 12 meses.
 */
export function ittfPointsByTournamentSql(scope = "TRUE", windowed = true): string {
  return `
    SELECT id_user, id_tournament, MAX(points)::int AS points
    FROM (${ittfPointsByCategorySql(scope, windowed)}) per_category
    GROUP BY id_user, id_tournament
  `;
}

/** Igual, pero un resultado por categoría (id_user, id_tournament, id_category, points). */
export function ittfPointsByCategorySql(scope = "TRUE", windowed = true): string {
  return `
    WITH cat AS (
      SELECT id_tournament, id_category, MAX(round) AS max_round
      FROM bracket_matches
      GROUP BY id_tournament, id_category
    ),
    appear AS (
      SELECT bm.id_tournament, bm.id_category, p.id_user, bm.round, cat.max_round,
             (bm.round = cat.max_round AND bm.winner_id = p.id_user) AS champion
      FROM bracket_matches bm
      JOIN cat ON cat.id_tournament = bm.id_tournament AND cat.id_category = bm.id_category
      CROSS JOIN LATERAL (VALUES (bm.player1_id), (bm.player2_id)) AS p(id_user)
      WHERE p.id_user IS NOT NULL
    ),
    reached AS (
      SELECT id_tournament, id_category, id_user,
             CASE WHEN BOOL_OR(champion) THEN 1
                  ELSE (2 ^ (MAX(max_round) - MAX(round) + 1))::int END AS draw_size
      FROM appear
      GROUP BY id_tournament, id_category, id_user
      UNION ALL
      -- Grupo único (sin llave): la posición final en la tabla equivale a la
      -- ronda alcanzada — 1° campeón, 2° final, 3°–4° semis, 5°–8° cuartos...
      SELECT cg.id_tournament, cg.id_category, gs.id_user,
             CASE WHEN gs.position = 1 THEN 1
                  ELSE (2 ^ CEIL(LOG(2::numeric, gs.position::numeric)))::int END AS draw_size
      FROM group_standings gs
      JOIN category_groups cg ON cg.id_group = gs.id_group
      JOIN tournament_categories rr ON rr.id_category = cg.id_category
      WHERE rr.competition_format = 'round_robin' AND gs.position IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM bracket_matches b WHERE b.id_category = cg.id_category)
    ),
    per_category AS (
      SELECT r.id_user, r.id_tournament, r.id_category, ${pointsCase("t.ranking_level", "r.draw_size")} AS points
      FROM reached r
      JOIN tournaments t ON t.id_tournament = r.id_tournament
      JOIN tournament_categories tc ON tc.id_category = r.id_category
      JOIN users u ON u.id_user = r.id_user
      WHERE t.is_ranked AND t.status <> 'cancelled'
        AND tc.phase = 'finished' AND NOT COALESCE(tc.finished_early, false)
        AND NOT u.is_team
        ${windowed ? `AND COALESCE(t.event_date, t.created_at::date) >= CURRENT_DATE - INTERVAL '${RANKING_WINDOW}'` : ""}
        AND (${scope})
    )
    SELECT id_user, id_tournament, id_category, points::int AS points FROM per_category
  `;
}

/** SELECT (id_user, ranking_points): total de cada jugador con puntos. */
export function ittfTotalsSql(scope = "TRUE"): string {
  return `
    SELECT id_user, SUM(points)::int AS ranking_points
    FROM (${ittfPointsByTournamentSql(scope)}) per_t
    GROUP BY id_user
    HAVING SUM(points) > 0
  `;
}
