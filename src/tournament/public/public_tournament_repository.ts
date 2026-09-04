import type { Pool } from "pg";
import DB from "../../db/db_configuration";

export interface PublicTournamentRow {
  id_tournament: string;
  tournament_name: string;
  description: string | null;
  address: string | null;
  region: string | null;
  event_date: string | Date | null;
  event_time: string | null;
  status: string;
  category_count: number;
  enrolled_count: number;
}

export interface PublicCategoryRow {
  id_category: string;
  category_type: string;
  category_range: string;
  gender: string;
  status: string;
  enrolled_count: number;
  has_bracket: boolean;
  is_finished: boolean;
  // Fase real de la categoría (enrollment/groups/bracket/finished) — el
  // frontend público la usaba solo indirecto (has_bracket/is_finished),
  // así que "enrollment" (todavía no se generaron grupos) y "groups" (ya
  // hay grupos jugándose) se veían igual, ambos como "Group stage".
  phase: string;
}

export interface PublicTournamentDetailRow {
  id_tournament: string;
  tournament_name: string;
  description: string | null;
  address: string | null;
  region: string | null;
  event_date: string | Date | null;
  event_time: string | null;
  status: string;
  organizer_club_name: string | null;
  // El admin que crea el torneo no siempre tiene un club asignado — sin
  // esto, "organizer_club_name" quedaba null y la vitrina pública no
  // mostraba quién organiza.
  organizer_user_name: string | null;
}

export class PublicTournamentRepository {
  private pool: Pool;
  constructor(pool?: Pool) {
    this.pool = pool ?? DB.getPool();
  }

  async list(
    filters: {
      q?: string;
      region?: string;
      status?: string;
      categoryType?: string;
      categoryRange?: string;
      gender?: string;
    },
    pagination: { page: number; limit: number }
  ): Promise<{ rows: PublicTournamentRow[]; total: number }> {
    // Fijo, no depende de ningún filtro que mande el cliente — un torneo
    // 'private' o 'internal' nunca puede aparecer en el listado público sin
    // login. El acceso directo por id (getById más abajo) no tiene este
    // filtro a propósito: así "privado" sigue siendo accesible con el link.
    const conditions: string[] = ["t.visibility = 'public'"];
    const values: unknown[] = [];
    let i = 1;

    if (filters.q) {
      conditions.push(`t.tournament_name ILIKE $${i++}`);
      values.push(`%${filters.q}%`);
    }
    if (filters.region) {
      conditions.push(`t.region = $${i++}`);
      values.push(filters.region);
    }
    if (filters.status) {
      // Mismo cálculo que `displayStatus` en el router (la tabla solo guarda
      // active/cancelled, el resto se deriva de event_date vs hoy) — repetido
      // acá en SQL para poder filtrar/paginar sobre el estado ya calculado.
      conditions.push(
        `(CASE
            WHEN t.status = 'cancelled' THEN 'cancelled'
            WHEN t.event_date IS NULL THEN 'upcoming'
            WHEN t.event_date > CURRENT_DATE THEN 'upcoming'
            WHEN t.event_date = CURRENT_DATE THEN 'ongoing'
            ELSE 'finished'
          END) = $${i++}`
      );
      values.push(filters.status);
    }
    // Filtro de categoría — categoryType/categoryRange/gender viven en
    // tournament_categories, no en tournaments, así que van como EXISTS en
    // vez de una condición directa (un torneo puede tener varias
    // categorías; alcanza con que UNA matchee los tres). Un solo EXISTS con
    // las tres condiciones adentro en vez de tres EXISTS separados: así
    // exige que sea la MISMA categoría la que cumpla tipo+rango+género, no
    // que cada condición la cumpla una categoría distinta del torneo.
    if (filters.categoryType || filters.categoryRange || filters.gender) {
      const sub: string[] = ["tc.id_tournament = t.id_tournament"];
      if (filters.categoryType) {
        sub.push(`tc.category_type = $${i++}`);
        values.push(filters.categoryType);
      }
      if (filters.categoryRange) {
        sub.push(`tc.category_range = $${i++}`);
        values.push(filters.categoryRange);
      }
      if (filters.gender) {
        sub.push(`tc.gender = $${i++}`);
        values.push(filters.gender);
      }
      conditions.push(`EXISTS (SELECT 1 FROM tournament_categories tc WHERE ${sub.join(" AND ")})`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countRes = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM tournaments t ${where}`,
      values
    );
    const total = Number(countRes.rows[0]?.count ?? 0);

    const offset = (pagination.page - 1) * pagination.limit;
    // Subconsultas escalares en vez de LEFT JOIN + GROUP BY: unir
    // tournament_categories Y enrollments directo contra tournaments
    // produce el producto cruzado de ambas por cada torneo ANTES de que el
    // GROUP BY lo vuelva a juntar — con 3 categorías × 36 inscritos
    // promedio, son ~108 filas intermedias por torneo, sea cual sea el
    // LIMIT pedido. Medido con EXPLAIN ANALYZE (1000 torneos): 175ms con
    // el join, 1.5ms con las subconsultas — porque ahora cada una corre
    // solo sobre las 12 filas que quedaron después del LIMIT, ya indexadas
    // por id_tournament, en vez de aportar al armado de la página entera.
    const rowsRes = await this.pool.query<PublicTournamentRow>(
      `SELECT
         t.id_tournament, t.tournament_name, t.description, t.address, t.region,
         t.event_date, t.event_time, t.status,
         (SELECT COUNT(*) FROM tournament_categories tc WHERE tc.id_tournament = t.id_tournament)::int AS category_count,
         (SELECT COUNT(*) FROM enrollments e WHERE e.id_tournament = t.id_tournament AND e.status = 'active')::int AS enrolled_count
       FROM tournaments t
       ${where}
       ORDER BY t.event_date ASC NULLS LAST, t.created_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
      [...values, pagination.limit, offset]
    );

    return { rows: rowsRes.rows, total };
  }

  async getById(id_tournament: string): Promise<PublicTournamentDetailRow | null> {
    const res = await this.pool.query<PublicTournamentDetailRow>(
      `SELECT t.id_tournament, t.tournament_name, t.description, t.address, t.region,
              t.event_date, t.event_time, t.status, c.name AS organizer_club_name,
              NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS organizer_user_name
       FROM tournaments t
       LEFT JOIN users u ON u.id_user = t.created_by
       LEFT JOIN clubs c ON c.id_club = u.id_club
       WHERE t.id_tournament = $1`,
      [id_tournament]
    );
    return res.rows[0] ?? null;
  }

  // Números reales para la vitrina del landing — nada de cifras infladas,
  // los mismos que ve un admin, solo agregados a nivel plataforma.
  async getStats(): Promise<{ tournaments: number; categories: number; players: number }> {
    const res = await this.pool.query<{ tournaments: string; categories: string; players: string }>(
      `SELECT
         (SELECT COUNT(*) FROM tournaments WHERE status != 'cancelled')::text AS tournaments,
         (SELECT COUNT(*) FROM tournament_categories)::text AS categories,
         (SELECT COUNT(DISTINCT id_user) FROM enrollments WHERE status = 'active')::text AS players`
    );
    const row = res.rows[0];
    return {
      tournaments: Number(row?.tournaments ?? 0),
      categories: Number(row?.categories ?? 0),
      players: Number(row?.players ?? 0),
    };
  }

  // Valores REALES para poblar los selects de "tipo de categoría" y "rango"
  // del filtro de /torneos — category_type/category_range son texto libre
  // (VARCHAR sin lista fija en la base), así que no se puede hardcodear una
  // lista como con las regiones: se listan los valores que efectivamente
  // existen hoy, y solo de torneos públicos (mismo filtro de visibilidad
  // que list()), para no exponer nombres de categorías de torneos privados.
  async getCategoryFilters(): Promise<{ categoryTypes: string[]; categoryRanges: string[] }> {
    const res = await this.pool.query<{ category_type: string; category_range: string }>(
      `SELECT DISTINCT tc.category_type, tc.category_range
       FROM tournament_categories tc
       JOIN tournaments t ON t.id_tournament = tc.id_tournament
       WHERE t.visibility = 'public'
       ORDER BY tc.category_type ASC, tc.category_range ASC`
    );
    return {
      categoryTypes: [...new Set(res.rows.map((r) => r.category_type))].sort(),
      categoryRanges: [...new Set(res.rows.map((r) => r.category_range))].sort(),
    };
  }

  // Todos los partidos del torneo (grupos + llave, de todas las categorías)
  // en una sola grilla — es lo que en la referencia es la pestaña "Matches"
  // a nivel torneo, en vez de tener que entrar categoría por categoría.
  // Grilla combinada de grupos + llave, paginada — antes traía TODOS los
  // partidos del torneo de una sola vez (tráfico anónimo, el de mayor
  // volumen del sitio), sin límite. El UNION ALL queda igual, solo se
  // envuelve para poder contar y paginar sobre el resultado combinado.
  async getAllMatches(
    id_tournament: string,
    pagination: { page: number; limit: number }
  ): Promise<{
    rows: Array<{
      id_match: string;
      stage: "group" | "bracket";
      category_type: string;
      category_range: string;
      gender: string;
      round: number | null;
      player1_id: string | null;
      player1_first: string | null;
      player1_last: string | null;
      player1_club: string | null;
      player2_id: string | null;
      player2_first: string | null;
      player2_last: string | null;
      player2_club: string | null;
      winner_id: string | null;
      sets_player1: number;
      sets_player2: number;
      status: string;
      best_of_sets: number;
      played_at: string | Date | null;
      set_scores: unknown;
    }>;
    total: number;
  }> {
    const union = `
      SELECT gm.id_match, 'group' AS stage, tc.category_type, tc.category_range, tc.gender,
             NULL::int AS round,
             gm.player1_id, u1.first_name AS player1_first, u1.last_name AS player1_last, c1.name AS player1_club,
             gm.player2_id, u2.first_name AS player2_first, u2.last_name AS player2_last, c2.name AS player2_club,
             gm.winner_id, gm.sets_player1, gm.sets_player2, gm.status, gm.best_of_sets, gm.played_at, gm.set_scores
      FROM group_matches gm
      JOIN tournament_categories tc ON tc.id_category = gm.id_category
      JOIN users u1 ON u1.id_user = gm.player1_id
      JOIN users u2 ON u2.id_user = gm.player2_id
      LEFT JOIN clubs c1 ON c1.id_club = u1.id_club
      LEFT JOIN clubs c2 ON c2.id_club = u2.id_club
      WHERE gm.id_tournament = $1

      UNION ALL

      SELECT bm.id_match, 'bracket' AS stage, tc.category_type, tc.category_range, tc.gender,
             bm.round,
             bm.player1_id, u1.first_name AS player1_first, u1.last_name AS player1_last, c1.name AS player1_club,
             bm.player2_id, u2.first_name AS player2_first, u2.last_name AS player2_last, c2.name AS player2_club,
             bm.winner_id, bm.sets_player1, bm.sets_player2, bm.status, bm.best_of_sets, bm.played_at, bm.set_scores
      FROM bracket_matches bm
      JOIN tournament_categories tc ON tc.id_category = bm.id_category
      LEFT JOIN users u1 ON u1.id_user = bm.player1_id
      LEFT JOIN users u2 ON u2.id_user = bm.player2_id
      LEFT JOIN clubs c1 ON c1.id_club = u1.id_club
      LEFT JOIN clubs c2 ON c2.id_club = u2.id_club
      WHERE bm.id_tournament = $1 AND bm.is_bye = FALSE AND bm.player1_id IS NOT NULL AND bm.player2_id IS NOT NULL
    `;

    const countRes = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM (${union}) sub`,
      [id_tournament]
    );
    const total = Number(countRes.rows[0]?.count ?? 0);

    const offset = (pagination.page - 1) * pagination.limit;
    const rowsRes = await this.pool.query(
      `SELECT * FROM (${union}) sub
       ORDER BY played_at DESC NULLS LAST, status ASC, category_type ASC
       LIMIT $2 OFFSET $3`,
      [id_tournament, pagination.limit, offset]
    );
    return { rows: rowsRes.rows, total };
  }

  async getCategoryDetail(id_category: string): Promise<{
    category: { id_category: string; id_tournament: string; category_type: string; category_range: string; gender: string } | null;
    players: Array<{ id_user: string; first_name: string | null; last_name: string | null; club_name: string | null }>;
    groups: Array<{
      id_group: string;
      group_name: string;
      standings: Array<{
        id_user: string; name: string; played: number; won: number; lost: number;
        sets_for: number; sets_against: number; position: number | null; qualified_to_bracket: boolean;
      }>;
      matches: Array<{
        id_match: string; player1_id: string; player1_name: string; player2_id: string; player2_name: string;
        sets_player1: number; sets_player2: number; status: string; best_of_sets: number;
      }>;
    }>;
    bracketMatches: Array<{
      id_match: string; round: number; match_number: number; player1_id: string | null; player1_name: string | null;
      player2_id: string | null; player2_name: string | null; winner_id: string | null;
      sets_player1: number; sets_player2: number; status: string; is_bye: boolean; best_of_sets: number;
      set_scores: unknown;
    }>;
  }> {
    const categoryRes = await this.pool.query(
      `SELECT id_category, id_tournament, category_type, category_range, gender
       FROM tournament_categories WHERE id_category = $1`,
      [id_category]
    );
    const category = categoryRes.rows[0] ?? null;
    if (!category) {
      return { category: null, players: [], groups: [], bracketMatches: [] };
    }

    const playersRes = await this.pool.query(
      `SELECT DISTINCT u.id_user, u.first_name, u.last_name, c.name AS club_name
       FROM enrollments e
       JOIN users u ON u.id_user = e.id_user
       LEFT JOIN clubs c ON c.id_club = u.id_club
       WHERE e.id_category = $1 AND e.status = 'active'
       ORDER BY u.first_name ASC, u.last_name ASC`,
      [id_category]
    );

    const groupsRes = await this.pool.query(
      `SELECT id_group, group_name FROM category_groups WHERE id_category = $1 ORDER BY sort_order ASC`,
      [id_category]
    );

    const groups = [];
    for (const g of groupsRes.rows) {
      const standingsRes = await this.pool.query(
        `SELECT gs.id_user, u.first_name, u.last_name, gs.played, gs.won, gs.lost,
                gs.sets_for, gs.sets_against, gs.position, gs.qualified_to_bracket
         FROM group_standings gs
         JOIN users u ON u.id_user = gs.id_user
         WHERE gs.id_group = $1
         ORDER BY gs.position ASC NULLS LAST, gs.won DESC`,
        [g.id_group]
      );
      const matchesRes = await this.pool.query(
        `SELECT gm.id_match, gm.player1_id, u1.first_name AS p1_first, u1.last_name AS p1_last,
                gm.player2_id, u2.first_name AS p2_first, u2.last_name AS p2_last,
                gm.sets_player1, gm.sets_player2, gm.status, gm.best_of_sets
         FROM group_matches gm
         JOIN users u1 ON u1.id_user = gm.player1_id
         JOIN users u2 ON u2.id_user = gm.player2_id
         WHERE gm.id_group = $1
         ORDER BY gm.match_number ASC`,
        [g.id_group]
      );
      groups.push({
        id_group: g.id_group,
        group_name: g.group_name,
        standings: standingsRes.rows.map((r) => ({
          id_user: r.id_user,
          name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(),
          played: r.played,
          won: r.won,
          lost: r.lost,
          sets_for: r.sets_for,
          sets_against: r.sets_against,
          position: r.position,
          qualified_to_bracket: r.qualified_to_bracket,
        })),
        matches: matchesRes.rows.map((r) => ({
          id_match: r.id_match,
          player1_id: r.player1_id,
          player1_name: `${r.p1_first ?? ""} ${r.p1_last ?? ""}`.trim(),
          player2_id: r.player2_id,
          player2_name: `${r.p2_first ?? ""} ${r.p2_last ?? ""}`.trim(),
          sets_player1: r.sets_player1,
          sets_player2: r.sets_player2,
          status: r.status,
          best_of_sets: r.best_of_sets,
        })),
      });
    }

    const bracketRes = await this.pool.query(
      `SELECT bm.id_match, bm.round, bm.match_number, bm.player1_id, u1.first_name AS p1_first, u1.last_name AS p1_last,
              bm.player2_id, u2.first_name AS p2_first, u2.last_name AS p2_last,
              bm.winner_id, bm.sets_player1, bm.sets_player2, bm.status, bm.is_bye, bm.best_of_sets, bm.set_scores
       FROM bracket_matches bm
       LEFT JOIN users u1 ON u1.id_user = bm.player1_id
       LEFT JOIN users u2 ON u2.id_user = bm.player2_id
       WHERE bm.id_category = $1
       ORDER BY bm.round ASC, bm.match_number ASC`,
      [id_category]
    );

    return {
      category,
      players: playersRes.rows,
      groups,
      bracketMatches: bracketRes.rows.map((r) => ({
        id_match: r.id_match,
        round: r.round,
        match_number: r.match_number,
        player1_id: r.player1_id,
        player1_name: r.player1_id ? `${r.p1_first ?? ""} ${r.p1_last ?? ""}`.trim() : null,
        player2_id: r.player2_id,
        player2_name: r.player2_id ? `${r.p2_first ?? ""} ${r.p2_last ?? ""}`.trim() : null,
        winner_id: r.winner_id,
        sets_player1: r.sets_player1,
        sets_player2: r.sets_player2,
        status: r.status,
        is_bye: r.is_bye,
        best_of_sets: r.best_of_sets,
        set_scores: r.set_scores,
      })),
    };
  }

  // Ficha de un partido puntual — mismo shape que
  // PlayerRepository.getMatchDetail (endpoint autenticado), sin id/nombre
  // del árbitro (dato interno de organización, no hace falta en la vista
  // pública) y agregando id_tournament/id_category para armar los links de
  // "volver" sin otro pedido aparte.
  async getMatchDetail(matchType: "group" | "bracket", id_match: string): Promise<any | null> {
    const query =
      matchType === "group"
        ? `
      SELECT
        gm.id_match, 'group'::text AS match_type,
        t.id_tournament, t.tournament_name,
        tc.id_category, tc.category_type, tc.category_range,
        cg.group_name, NULL::int AS round, NULL::int AS total_rounds,
        gm.match_number, gm.best_of_sets,
        gm.player1_id,
        COALESCE(NULLIF(TRIM(p1.first_name || ' ' || p1.last_name), ''), 'Jugador sin nombre') AS player1_name,
        p1cl.name AS player1_club,
        gm.player2_id,
        COALESCE(NULLIF(TRIM(p2.first_name || ' ' || p2.last_name), ''), 'Jugador sin nombre') AS player2_name,
        p2cl.name AS player2_club,
        gm.winner_id, gm.sets_player1, gm.sets_player2, gm.set_scores,
        gm.status, gm.played_at::text, gm.table_number, gm.played_table_number,
        NULL::int AS seed1, NULL::int AS seed2
      FROM group_matches gm
      JOIN category_groups cg ON cg.id_group = gm.id_group
      JOIN tournament_categories tc ON tc.id_category = cg.id_category
      JOIN tournaments t ON t.id_tournament = cg.id_tournament
      LEFT JOIN users p1 ON p1.id_user = gm.player1_id
      LEFT JOIN clubs p1cl ON p1cl.id_club = p1.id_club
      LEFT JOIN users p2 ON p2.id_user = gm.player2_id
      LEFT JOIN clubs p2cl ON p2cl.id_club = p2.id_club
      WHERE gm.id_match = $1
    `
        : `
      SELECT
        bm.id_match, 'bracket'::text AS match_type,
        t.id_tournament, t.tournament_name,
        tc.id_category, tc.category_type, tc.category_range,
        NULL::text AS group_name, bm.round,
        (SELECT MAX(bm2.round) FROM bracket_matches bm2 WHERE bm2.id_category = bm.id_category) AS total_rounds,
        bm.match_number, bm.best_of_sets,
        bm.player1_id,
        COALESCE(NULLIF(TRIM(p1.first_name || ' ' || p1.last_name), ''), 'Jugador sin nombre') AS player1_name,
        p1cl.name AS player1_club,
        bm.player2_id,
        COALESCE(NULLIF(TRIM(p2.first_name || ' ' || p2.last_name), ''), 'Jugador sin nombre') AS player2_name,
        p2cl.name AS player2_club,
        bm.winner_id, bm.sets_player1, bm.sets_player2, bm.set_scores,
        bm.status, bm.played_at::text, bm.table_number, bm.played_table_number,
        bm.seed1, bm.seed2
      FROM bracket_matches bm
      JOIN tournament_categories tc ON tc.id_category = bm.id_category
      JOIN tournaments t ON t.id_tournament = bm.id_tournament
      LEFT JOIN users p1 ON p1.id_user = bm.player1_id
      LEFT JOIN clubs p1cl ON p1cl.id_club = p1.id_club
      LEFT JOIN users p2 ON p2.id_user = bm.player2_id
      LEFT JOIN clubs p2cl ON p2cl.id_club = p2.id_club
      WHERE bm.id_match = $1
    `;
    const res = await this.pool.query(query, [id_match]);
    return res.rows[0] ?? null;
  }

  async getCategories(id_tournament: string): Promise<PublicCategoryRow[]> {
    const res = await this.pool.query<PublicCategoryRow>(
      `SELECT
         c.id_category, c.category_type, c.category_range, c.gender, c.status, c.phase,
         COUNT(e.id_enrollment) FILTER (WHERE e.status = 'active')::int AS enrolled_count,
         EXISTS(SELECT 1 FROM bracket_matches bm WHERE bm.id_category = c.id_category) AS has_bracket,
         EXISTS(
           SELECT 1 FROM bracket_matches bm
           WHERE bm.id_category = c.id_category
             AND bm.status IN ('played', 'walkover')
             AND bm.round = (SELECT MAX(round) FROM bracket_matches WHERE id_category = c.id_category)
         ) AS is_finished
       FROM tournament_categories c
       LEFT JOIN enrollments e ON e.id_category = c.id_category
       WHERE c.id_tournament = $1
       GROUP BY c.id_category
       ORDER BY c.category_type ASC, c.category_range ASC, c.gender ASC`,
      [id_tournament]
    );
    return res.rows;
  }
}
