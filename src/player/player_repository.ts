import type { Pool } from "pg";
import DB from "../db/db_configuration";
import { TablesRepository } from "../tournament/tables/tables_repository";

export type NextMatch = {
  id_match:        string;
  match_type:      "group" | "bracket";
  id_category:     string;
  id_tournament:   string;
  tournament_name: string;
  category_display:string;
  opponent_id:     string | null;
  opponent_name:   string | null;
  opponent_email:  string | null;
  table_number:    number | null;
  status:          string;
  group_name:      string | null;
  round:           number | null;
  // Solo se completan cuando table_number es null (todavía no le toca mesa)
  queue_position:  number | null;
  queue_total:     number | null;
  queue_blocked:   boolean;
  // Sin mesa, sin posición de cola y sin estar bloqueado por el rival: la
  // única explicación posible es que YA tenés otro partido tuyo ocupando tu
  // turno en la cola (nadie puede estar en dos mesas a la vez) — pasa seguido
  // cuando un jugador tiene varios partidos de grupo pendientes a la vez.
  self_pending:    boolean;
  // Cuando queue_blocked es true, en qué mesa está jugando el rival ahora
  // mismo (para poder seguirlo en vez de solo "esperando" a ciegas). No hay
  // una "posición en la fila" real que dar acá: en cuanto el rival termina,
  // este partido recién entra a la cola normal de mesas, así que cualquier
  // número previo sería inventado.
  blocking_table_number: number | null;
};

export type PlayerStats = {
  matches_played: number;
  matches_won:    number;
  matches_lost:   number;
  sets_won:       number;
  sets_lost:      number;
};

export type PlayerDashboard = {
  next_match:         NextMatch | null;
  // El resto de partidos pendientes en OTRAS categorías en las que el
  // jugador también está inscrito (si tiene más de una activa a la vez).
  other_next_matches: NextMatch[];
  active_enrollments: number;
  stats:              PlayerStats;
};

export class PlayerRepository {
  private pool: Pool;
  private tablesRepo: TablesRepository;
  constructor(pool?: Pool) {
    this.pool = pool ?? DB.getPool();
    this.tablesRepo = new TablesRepository(this.pool);
  }

  async getDashboard(id_user: string): Promise<PlayerDashboard> {
    // Próximo partido pendiente POR CATEGORÍA (grupo o llave — nunca las dos
    // a la vez, porque una categoría está en una sola fase por vez) — así un
    // jugador anotado en varias categorías ve el estado de cada una, no solo
    // la más urgente.
    const [groupNext, bracketNext, enrollCount, stats] = await Promise.all([
      this.pool.query<NextMatch>(
        `SELECT DISTINCT ON (tc.id_category)
           gm.id_match, 'group' AS match_type, tc.id_category,
           t.id_tournament, t.tournament_name,
           tc.category_type || ' ' || tc.category_range AS category_display,
           opp.id_user AS opponent_id,
           COALESCE(
             NULLIF(TRIM(opp.last_name || ' ' || opp.first_name), ''),
             opp.email
           ) AS opponent_name,
           opp.email AS opponent_email,
           gm.table_number,
           gm.status,
           cg.group_name,
           NULL::int AS round
         FROM group_matches gm
         JOIN category_groups cg  ON cg.id_group    = gm.id_group
         JOIN tournament_categories tc ON tc.id_category = cg.id_category
         JOIN tournaments t ON t.id_tournament = cg.id_tournament
         LEFT JOIN users opp ON opp.id_user = CASE
           WHEN gm.player1_id = $1 THEN gm.player2_id
           ELSE gm.player1_id
         END
         WHERE (gm.player1_id = $1 OR gm.player2_id = $1)
           AND gm.winner_id IS NULL
           AND gm.player1_id IS NOT NULL AND gm.player2_id IS NOT NULL
         ORDER BY tc.id_category, gm.table_number DESC NULLS LAST`,
        [id_user]
      ),
      this.pool.query<NextMatch>(
        `SELECT DISTINCT ON (tc.id_category)
           bm.id_match, 'bracket' AS match_type, tc.id_category,
           t.id_tournament, t.tournament_name,
           tc.category_type || ' ' || tc.category_range AS category_display,
           opp.id_user AS opponent_id,
           COALESCE(
             NULLIF(TRIM(opp.last_name || ' ' || opp.first_name), ''),
             opp.email
           ) AS opponent_name,
           opp.email AS opponent_email,
           bm.table_number,
           bm.status,
           NULL::text AS group_name,
           bm.round
         FROM bracket_matches bm
         JOIN tournament_categories tc ON tc.id_category = bm.id_category
         JOIN tournaments t ON t.id_tournament = bm.id_tournament
         LEFT JOIN users opp ON opp.id_user = CASE
           WHEN bm.player1_id = $1 THEN bm.player2_id
           ELSE bm.player1_id
         END
         WHERE (bm.player1_id = $1 OR bm.player2_id = $1)
           AND bm.winner_id IS NULL
           AND bm.player1_id IS NOT NULL AND bm.player2_id IS NOT NULL
         ORDER BY tc.id_category, bm.table_number DESC NULLS LAST`,
        [id_user]
      ),
      this.pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM enrollments
         WHERE id_user = $1 AND status = 'active'`,
        [id_user]
      ),
      this.pool.query<PlayerStats>(
        `SELECT
           COALESCE(matches_played, 0) AS matches_played,
           COALESCE(matches_won,    0) AS matches_won,
           COALESCE(matches_lost,   0) AS matches_lost,
           COALESCE(sets_won,       0) AS sets_won,
           COALESCE(sets_lost,      0) AS sets_lost
         FROM player_stats WHERE id_user = $1`,
        [id_user]
      ),
    ]);

    // Una categoría solo puede tener un partido pendiente "actual" (grupo O
    // llave), pero por las dudas si alguna vez coinciden nos quedamos con el
    // primero que aparezca por categoría.
    const byCategory = new Map<string, NextMatch>();
    for (const row of [...groupNext.rows, ...bracketNext.rows]) {
      if (!byCategory.has(row.id_category)) byCategory.set(row.id_category, row);
    }
    const allNext = [...byCategory.values()];

    // Si todavía no tiene mesa, calculamos en qué posición de la cola está
    // (misma cola/orden que usa "Auto-asignar mesas" del admin) para que el
    // jugador sepa más o menos cuánto le falta, en vez de solo "esperando".
    // La cola es por torneo, así que se pide una sola vez por torneo aunque
    // varias categorías compartan el mismo campeonato.
    const tournamentIds = [...new Set(allNext.filter((m) => m.table_number === null).map((m) => m.id_tournament))];
    const queuesByTournament = new Map<string, { queue: { id_match: string }[]; blocked: { id_match: string }[] }>();
    await Promise.all(
      tournamentIds.map(async (tid) => {
        const { queue, blocked } = await this.tablesRepo.getQueueAndBlocked(tid);
        queuesByTournament.set(tid, { queue, blocked });
      })
    );

    for (const m of allNext) {
      m.queue_position = null;
      m.queue_total = null;
      m.queue_blocked = false;
      m.self_pending = false;
      m.blocking_table_number = null;
      if (m.table_number === null) {
        const q = queuesByTournament.get(m.id_tournament);
        if (q) {
          const idx = q.queue.findIndex((qm) => qm.id_match === m.id_match);
          if (idx !== -1) {
            m.queue_position = idx + 1;
            m.queue_total = q.queue.length;
          } else if (q.blocked.some((bm) => bm.id_match === m.id_match)) {
            m.queue_blocked = true;
          } else {
            m.self_pending = true;
          }
        }
      }
    }

    // Para los bloqueados por rival ocupado, buscamos en qué mesa está jugando
    // el rival ahora mismo — así el jugador puede seguir esa mesa en vez de
    // solo saber que "está esperando" sin ningún dato concreto.
    await Promise.all(
      allNext
        .filter((m) => m.queue_blocked && m.opponent_id)
        .map(async (m) => {
          const res = await this.pool.query<{ table_number: number }>(
            `SELECT table_number FROM group_matches
               WHERE id_tournament = $1 AND table_number IS NOT NULL
                 AND (player1_id = $2 OR player2_id = $2)
             UNION ALL
             SELECT table_number FROM bracket_matches
               WHERE id_tournament = $1 AND table_number IS NOT NULL
                 AND (player1_id = $2 OR player2_id = $2)
             LIMIT 1`,
            [m.id_tournament, m.opponent_id]
          );
          m.blocking_table_number = res.rows[0]?.table_number ?? null;
        })
    );

    // El destacado es el que ya tiene mesa asignada; si ninguno tiene mesa,
    // el que esté más adelante en su cola; el resto queda como "las otras
    // categorías en las que también estás jugando".
    allNext.sort((a, b) => {
      if ((a.table_number !== null) !== (b.table_number !== null)) {
        return a.table_number !== null ? -1 : 1;
      }
      return (a.queue_position ?? Infinity) - (b.queue_position ?? Infinity);
    });

    const next_match = allNext[0] ?? null;
    const other_next_matches = allNext.slice(1);

    const defaultStats: PlayerStats = {
      matches_played: 0, matches_won: 0, matches_lost: 0, sets_won: 0, sets_lost: 0,
    };

    return {
      next_match,
      other_next_matches,
      active_enrollments: Number(enrollCount.rows[0]?.count ?? 0),
      stats: stats.rows[0] ?? defaultStats,
    };
  }

  // Vista de una categoría desde la perspectiva del jugador
  async getCategoryView(id_user: string, id_tournament: string, id_category: string) {
    const [phase, myGroup, myGroupMatches, myBracketMatches] = await Promise.all([
      // Fase actual
      this.pool.query<{ phase: string }>(
        `SELECT COALESCE(phase, 'enrollment') AS phase
         FROM tournament_categories WHERE id_category = $1`,
        [id_category]
      ),
      // Mi grupo
      this.pool.query<{ id_group: string; group_name: string }>(
        `SELECT cg.id_group, cg.group_name
         FROM group_members gm
         JOIN category_groups cg ON cg.id_group = gm.id_group
         WHERE gm.id_user = $1 AND cg.id_category = $2
         LIMIT 1`,
        [id_user, id_category]
      ),
      // Mis partidos de grupo
      this.pool.query(
        `SELECT
           gm.id_match, gm.match_number, gm.status, gm.best_of_sets,
           gm.sets_player1, gm.sets_player2, gm.winner_id, gm.set_scores,
           gm.table_number, gm.played_table_number,
           gm.player1_id, gm.player2_id,
           opp.id_user AS opponent_id,
           COALESCE(NULLIF(TRIM(opp.last_name || ' ' || opp.first_name), ''), opp.email) AS opponent_name,
           oppcl.name AS opponent_club,
           CASE WHEN gm.player1_id = $1 THEN 'player1' ELSE 'player2' END AS my_slot,
           COALESCE(NULLIF(TRIM(ref.last_name || ' ' || ref.first_name), ''), ref.email) AS referee_name
         FROM group_matches gm
         JOIN category_groups cg ON cg.id_group = gm.id_group
         LEFT JOIN users opp ON opp.id_user = CASE
           WHEN gm.player1_id = $1 THEN gm.player2_id ELSE gm.player1_id
         END
         LEFT JOIN clubs oppcl ON oppcl.id_club = opp.id_club
         LEFT JOIN users ref ON ref.id_user = gm.referee_id
         WHERE (gm.player1_id = $1 OR gm.player2_id = $1)
           AND cg.id_category = $2
         ORDER BY gm.match_number`,
        [id_user, id_category]
      ),
      // Mis partidos de llave
      this.pool.query(
        `SELECT
           bm.id_match, bm.round, bm.match_number, bm.status, bm.best_of_sets,
           bm.sets_player1, bm.sets_player2, bm.winner_id, bm.set_scores,
           bm.table_number, bm.played_table_number,
           bm.player1_id, bm.player2_id,
           opp.id_user AS opponent_id,
           COALESCE(NULLIF(TRIM(opp.last_name || ' ' || opp.first_name), ''), opp.email) AS opponent_name,
           oppcl.name AS opponent_club,
           CASE WHEN bm.player1_id = $1 THEN 'player1' ELSE 'player2' END AS my_slot,
           COALESCE(NULLIF(TRIM(ref.last_name || ' ' || ref.first_name), ''), ref.email) AS referee_name
         FROM bracket_matches bm
         LEFT JOIN users opp ON opp.id_user = CASE
           WHEN bm.player1_id = $1 THEN bm.player2_id ELSE bm.player1_id
         END
         LEFT JOIN clubs oppcl ON oppcl.id_club = opp.id_club
         LEFT JOIN users ref ON ref.id_user = bm.referee_id
         WHERE (bm.player1_id = $1 OR bm.player2_id = $1)
           AND bm.id_category = $2
         ORDER BY bm.round, bm.match_number`,
        [id_user, id_category]
      ),
    ]);

    // Obtener todos los standings del grupo para mostrar la tabla completa
    const groupId = myGroup.rows[0]?.id_group;
    let allStandings: object[] = [];
    if (groupId) {
      const res = await this.pool.query(
        `SELECT
           gs.id_user, gs.played, gs.won, gs.lost,
           gs.sets_for, gs.sets_against, gs.points_for, gs.points_against, gs.position, gs.qualified_to_bracket,
           COALESCE(NULLIF(TRIM(u.last_name || ' ' || u.first_name), ''), u.email) AS player_name,
           cl.name AS club_name
         FROM group_standings gs
         JOIN users u ON u.id_user = gs.id_user
         LEFT JOIN clubs cl ON cl.id_club = u.id_club
         WHERE gs.id_group = $1
         ORDER BY gs.won DESC, (gs.sets_for - gs.sets_against) DESC, (gs.points_for - gs.points_against) DESC`,
        [groupId]
      );
      allStandings = res.rows;
    }

    // Total de rondas del cuadro (para poder mostrar "Semifinal"/"Cuartos de final")
    const totalRoundsRes = await this.pool.query<{ total_rounds: number | null }>(
      `SELECT MAX(round) AS total_rounds FROM bracket_matches WHERE id_category = $1`,
      [id_category]
    );

    return {
      phase:              phase.rows[0]?.phase ?? "enrollment",
      my_group:           myGroup.rows[0] ?? null,
      standings:          allStandings,
      my_group_matches:   myGroupMatches.rows,
      my_bracket_matches: myBracketMatches.rows,
      bracket_total_rounds: totalRoundsRes.rows[0]?.total_rounds ?? null,
    };
  }

  // Inscritos de una categoría (visible para cualquier jugador, no solo
  // durante inscripciones abiertas — sirve para "ver quién juega" en
  // cualquier fase). No se expone el email: solo nombre, club y género.
  async getCategoryParticipants(id_tournament: string, id_category: string) {
    const res = await this.pool.query(
      `SELECT
         u.id_user,
         COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email) AS player_name,
         cl.name AS club_name,
         u.gender,
         e.enrolled_at
       FROM enrollments e
       JOIN users u ON u.id_user = e.id_user
       LEFT JOIN clubs cl ON cl.id_club = u.id_club
       WHERE e.id_tournament = $1 AND e.id_category = $2 AND e.status = 'active'
       ORDER BY e.enrolled_at ASC`,
      [id_tournament, id_category]
    );
    return res.rows;
  }

  // Posiciones finales de una categoría ya terminada — se arman a partir de
  // en qué ronda de la llave quedó eliminado cada jugador (el campeón sale
  // del ganador de la final, el resto se agrupa por ronda: los que caen en
  // semis empatan en 3°, los de cuartos empatan en 5°, etc. — el clásico
  // "ranking 1-2-2-4" de los cuadros eliminatorios). Si la categoría nunca
  // llegó a llave (solo grupos), se usa la tabla de posiciones del grupo.
  async getCategoryStandings(id_tournament: string, id_category: string) {
    // Solo mostramos posiciones cuando la categoría ya está 100% terminada —
    // a mitad de torneo esto daría un podio incompleto/engañoso.
    const phaseRes = await this.pool.query(
      `SELECT phase FROM tournament_categories WHERE id_category = $1`,
      [id_category]
    );
    if (phaseRes.rows[0]?.phase !== "finished") {
      return { source: "none" as const, standings: [] };
    }

    const bracketRes = await this.pool.query(
      `SELECT COUNT(*)::int AS n FROM bracket_matches WHERE id_tournament = $1 AND id_category = $2`,
      [id_tournament, id_category]
    );
    const hasBracket = (bracketRes.rows[0]?.n ?? 0) > 0;

    if (hasBracket) {
      const query = `
        WITH total_rounds AS (
          SELECT MAX(round) AS tr FROM bracket_matches WHERE id_tournament = $1 AND id_category = $2
        ),
        final_match AS (
          SELECT bm.winner_id
          FROM bracket_matches bm, total_rounds tr
          WHERE bm.id_tournament = $1 AND bm.id_category = $2
            AND bm.round = tr.tr AND bm.match_number = 1
        ),
        losers AS (
          SELECT
            CASE WHEN bm.winner_id = bm.player1_id THEN bm.player2_id ELSE bm.player1_id END AS id_user,
            (POWER(2, (tr.tr - bm.round))::int + 1) AS position
          FROM bracket_matches bm, total_rounds tr
          WHERE bm.id_tournament = $1 AND bm.id_category = $2
            AND bm.status IN ('played', 'walkover')
            AND bm.is_bye = FALSE
            AND bm.player1_id IS NOT NULL AND bm.player2_id IS NOT NULL
        ),
        placed AS (
          SELECT winner_id AS id_user, 1 AS position FROM final_match WHERE winner_id IS NOT NULL
          UNION ALL
          SELECT id_user, position FROM losers WHERE id_user IS NOT NULL
        )
        SELECT
          p.position,
          u.id_user,
          COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email) AS player_name,
          cl.name AS club_name
        FROM placed p
        JOIN users u ON u.id_user = p.id_user
        LEFT JOIN clubs cl ON cl.id_club = u.id_club
        ORDER BY p.position ASC, player_name ASC
      `;
      const res = await this.pool.query(query, [id_tournament, id_category]);
      return { source: "bracket" as const, standings: res.rows };
    }

    const query = `
      SELECT
        gs.position,
        u.id_user,
        COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email) AS player_name,
        cl.name AS club_name
      FROM group_standings gs
      JOIN category_groups cg ON cg.id_group = gs.id_group
      JOIN users u ON u.id_user = gs.id_user
      LEFT JOIN clubs cl ON cl.id_club = u.id_club
      WHERE cg.id_tournament = $1 AND cg.id_category = $2 AND gs.position IS NOT NULL
      ORDER BY gs.position ASC, player_name ASC
    `;
    const res = await this.pool.query(query, [id_tournament, id_category]);
    return { source: "group" as const, standings: res.rows };
  }

  // Todos los inscritos de TODAS las categorías de un torneo en una sola
  // lista — para la pestaña "Jugadores" (antes había que abrir categoría por
  // categoría para ver quién estaba inscrito).
  async getTournamentParticipants(id_tournament: string) {
    const res = await this.pool.query(
      `SELECT
         u.id_user,
         COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email) AS player_name,
         cl.name AS club_name,
         u.gender,
         tc.id_category,
         tc.category_type, tc.category_range,
         e.enrolled_at,
         -- Los "jugadores rápidos" que crea el admin (walk-in sin cuenta
         -- propia, ver createQuickPlayer) reciben un email sintético
         -- sin-registro+<uuid>@myttm.local y una password que nadie
         -- conoce — nunca se pueden loguear. Este flag distingue esos
         -- "walk-in" de una cuenta real para que la UI los pinte distinto,
         -- sin exponer el email real de nadie en la respuesta.
         (u.email NOT LIKE 'sin-registro+%@myttm.local') AS is_registered
       FROM enrollments e
       JOIN users u ON u.id_user = e.id_user
       JOIN tournament_categories tc ON tc.id_category = e.id_category
       LEFT JOIN clubs cl ON cl.id_club = u.id_club
       WHERE e.id_tournament = $1 AND e.status = 'active'
       ORDER BY tc.category_type ASC, tc.category_range ASC, player_name ASC`,
      [id_tournament]
    );
    return res.rows;
  }

  // Partidos de TODO el torneo (todas las categorías), para el feed de
  // "últimos resultados" en la portada y la pestaña pública de Partidos.
  // status: 'all' | 'scheduled' (sin mesa todavía) | 'live' (con mesa, sin
  // jugar) | 'finished' (jugado o walkover).
  async getTournamentMatches(
    id_tournament: string,
    opts: { status?: "all" | "scheduled" | "live" | "finished"; limit?: number; offset?: number } = {}
  ) {
    const status = opts.status ?? "all";
    const limit = Math.min(opts.limit ?? 100, 100);
    const offset = Math.max(opts.offset ?? 0, 0);

    let statusClause = "";
    if (status === "finished") statusClause = "AND status IN ('played', 'walkover')";
    else if (status === "live") statusClause = "AND status NOT IN ('played', 'walkover') AND table_number IS NOT NULL";
    else if (status === "scheduled") statusClause = "AND status NOT IN ('played', 'walkover') AND table_number IS NULL";

    // Con status="all" (la página "ver todos los partidos", que arma sus
    // propias secciones/pestañas en el front) no queremos ordenar por
    // played_at: eso empuja los partidos sin jugar todavía al final, y si el
    // torneo tiene muchos partidos, el LIMIT los corta antes de llegar a
    // ellos — se veían "llaves" con la mayoría de los partidos faltantes.
    const orderClause =
      status === "finished"
        ? "ORDER BY played_at DESC NULLS LAST, category_type ASC, match_number ASC"
        : "ORDER BY category_type ASC, round ASC NULLS LAST, group_sort_order ASC NULLS LAST, match_number ASC";

    const query = `
      WITH matches AS (
        SELECT
          gm.id_match, 'group'::text AS match_type,
          tc.id_category, tc.category_type, tc.category_range,
          cg.group_name, cg.sort_order AS group_sort_order, NULL::int AS round, NULL::int AS total_rounds,
          gm.match_number,
          gm.player1_id,
          COALESCE(NULLIF(TRIM(p1.last_name || ' ' || p1.first_name), ''), p1.email) AS player1_name,
          p1cl.name AS player1_club,
          gm.player2_id,
          COALESCE(NULLIF(TRIM(p2.last_name || ' ' || p2.first_name), ''), p2.email) AS player2_name,
          p2cl.name AS player2_club,
          gm.status, gm.sets_player1, gm.sets_player2, gm.winner_id, gm.set_scores,
          gm.played_at::text, gm.table_number, gm.played_table_number,
          NULL::int AS next_round, NULL::int AS next_match_number, NULL::int AS next_match_slot
        FROM group_matches gm
        JOIN category_groups cg ON cg.id_group = gm.id_group
        JOIN tournament_categories tc ON tc.id_category = cg.id_category
        LEFT JOIN users p1 ON p1.id_user = gm.player1_id
        LEFT JOIN clubs p1cl ON p1cl.id_club = p1.id_club
        LEFT JOIN users p2 ON p2.id_user = gm.player2_id
        LEFT JOIN clubs p2cl ON p2cl.id_club = p2.id_club
        WHERE cg.id_tournament = $1

        UNION ALL

        SELECT
          bm.id_match, 'bracket'::text AS match_type,
          tc.id_category, tc.category_type, tc.category_range,
          NULL::text AS group_name, NULL::int AS group_sort_order, bm.round,
          MAX(bm.round) OVER (PARTITION BY bm.id_category) AS total_rounds,
          bm.match_number,
          bm.player1_id,
          COALESCE(NULLIF(TRIM(p1.last_name || ' ' || p1.first_name), ''), p1.email) AS player1_name,
          p1cl.name AS player1_club,
          bm.player2_id,
          COALESCE(NULLIF(TRIM(p2.last_name || ' ' || p2.first_name), ''), p2.email) AS player2_name,
          p2cl.name AS player2_club,
          bm.status, bm.sets_player1, bm.sets_player2, bm.winner_id, bm.set_scores,
          bm.played_at::text, bm.table_number, bm.played_table_number,
          bm.next_round, bm.next_match_number, bm.next_match_slot
        FROM bracket_matches bm
        JOIN tournament_categories tc ON tc.id_category = bm.id_category
        LEFT JOIN users p1 ON p1.id_user = bm.player1_id
        LEFT JOIN clubs p1cl ON p1cl.id_club = p1.id_club
        LEFT JOIN users p2 ON p2.id_user = bm.player2_id
        LEFT JOIN clubs p2cl ON p2cl.id_club = p2.id_club
        WHERE bm.id_tournament = $1
      )
      SELECT * FROM matches
      WHERE NOT (player1_id IS NULL AND player2_id IS NULL) ${statusClause}
      ${orderClause}
      LIMIT $2 OFFSET $3
    `;

    // Antes el frontend pedía limit=1000 fijo para "traer todo" — sin forma
    // de pedir más, los partidos que sobraban ese límite desaparecían de la
    // lista sin ningún aviso. Con offset real hace falta el total para que
    // el frontend sepa cuántas páginas mostrar.
    const countQuery = `
      WITH matches AS (
        SELECT gm.player1_id, gm.player2_id, gm.status
        FROM group_matches gm
        JOIN category_groups cg ON cg.id_group = gm.id_group
        WHERE cg.id_tournament = $1

        UNION ALL

        SELECT bm.player1_id, bm.player2_id, bm.status
        FROM bracket_matches bm
        WHERE bm.id_tournament = $1
      )
      SELECT COUNT(*)::text AS count FROM matches
      WHERE NOT (player1_id IS NULL AND player2_id IS NULL) ${statusClause}
    `;

    const [res, countRes] = await Promise.all([
      this.pool.query(query, [id_tournament, limit, offset]),
      this.pool.query<{ count: string }>(countQuery, [id_tournament]),
    ]);
    return { rows: res.rows, total: Number(countRes.rows[0]?.count ?? 0) };
  }

  // Detalle completo de UN partido (grupo o llave) — alimenta la página de
  // detalle de partido: sets, mesa, árbitro, torneo/categoría/ronda.
  async getMatchDetail(matchType: "group" | "bracket", id_match: string) {
    const query =
      matchType === "group"
        ? `
      SELECT
        gm.id_match, 'group'::text AS match_type,
        t.tournament_name,
        tc.category_type, tc.category_range,
        cg.group_name, NULL::int AS round, NULL::int AS total_rounds,
        gm.match_number, gm.best_of_sets,
        gm.player1_id,
        COALESCE(NULLIF(TRIM(p1.last_name || ' ' || p1.first_name), ''), p1.email) AS player1_name,
        p1cl.name AS player1_club,
        gm.player2_id,
        COALESCE(NULLIF(TRIM(p2.last_name || ' ' || p2.first_name), ''), p2.email) AS player2_name,
        p2cl.name AS player2_club,
        gm.winner_id, gm.sets_player1, gm.sets_player2, gm.set_scores,
        gm.status, gm.played_at::text, gm.table_number, gm.played_table_number,
        gm.referee_id,
        COALESCE(NULLIF(TRIM(ref.last_name || ' ' || ref.first_name), ''), ref.email) AS referee_name,
        NULL::int AS seed1, NULL::int AS seed2
      FROM group_matches gm
      JOIN category_groups cg ON cg.id_group = gm.id_group
      JOIN tournament_categories tc ON tc.id_category = cg.id_category
      JOIN tournaments t ON t.id_tournament = cg.id_tournament
      LEFT JOIN users p1 ON p1.id_user = gm.player1_id
      LEFT JOIN clubs p1cl ON p1cl.id_club = p1.id_club
      LEFT JOIN users p2 ON p2.id_user = gm.player2_id
      LEFT JOIN clubs p2cl ON p2cl.id_club = p2.id_club
      LEFT JOIN users ref ON ref.id_user = gm.referee_id
      WHERE gm.id_match = $1
    `
        : `
      SELECT
        bm.id_match, 'bracket'::text AS match_type,
        t.tournament_name,
        tc.category_type, tc.category_range,
        NULL::text AS group_name, bm.round,
        (SELECT MAX(bm2.round) FROM bracket_matches bm2 WHERE bm2.id_category = bm.id_category) AS total_rounds,
        bm.match_number, bm.best_of_sets,
        bm.player1_id,
        COALESCE(NULLIF(TRIM(p1.last_name || ' ' || p1.first_name), ''), p1.email) AS player1_name,
        p1cl.name AS player1_club,
        bm.player2_id,
        COALESCE(NULLIF(TRIM(p2.last_name || ' ' || p2.first_name), ''), p2.email) AS player2_name,
        p2cl.name AS player2_club,
        bm.winner_id, bm.sets_player1, bm.sets_player2, bm.set_scores,
        bm.status, bm.played_at::text, bm.table_number, bm.played_table_number,
        bm.referee_id,
        COALESCE(NULLIF(TRIM(ref.last_name || ' ' || ref.first_name), ''), ref.email) AS referee_name,
        bm.seed1, bm.seed2
      FROM bracket_matches bm
      JOIN tournament_categories tc ON tc.id_category = bm.id_category
      JOIN tournaments t ON t.id_tournament = bm.id_tournament
      LEFT JOIN users p1 ON p1.id_user = bm.player1_id
      LEFT JOIN clubs p1cl ON p1cl.id_club = p1.id_club
      LEFT JOIN users p2 ON p2.id_user = bm.player2_id
      LEFT JOIN clubs p2cl ON p2cl.id_club = p2.id_club
      LEFT JOIN users ref ON ref.id_user = bm.referee_id
      WHERE bm.id_match = $1
    `;
    const res = await this.pool.query(query, [id_match]);
    return res.rows[0] ?? null;
  }

  // Historial de partidos jugados de UN jugador puntual, cruzando todos sus
  // torneos — es lo que alimenta la pestaña "Partidos" de la ficha pública
  // de cualquier jugador (no solo la propia).
  async getPlayerMatchHistory(id_user: string, limit = 15) {
    const query = `
      WITH matches AS (
        SELECT
          gm.id_match, 'group'::text AS match_type,
          t.tournament_name,
          tc.category_type, tc.category_range,
          cg.group_name, NULL::int AS round, NULL::int AS total_rounds,
          gm.player1_id,
          COALESCE(NULLIF(TRIM(p1.last_name || ' ' || p1.first_name), ''), p1.email) AS player1_name,
          gm.player2_id,
          COALESCE(NULLIF(TRIM(p2.last_name || ' ' || p2.first_name), ''), p2.email) AS player2_name,
          oppcl.name AS opponent_club,
          gm.status, gm.sets_player1, gm.sets_player2, gm.winner_id, gm.played_at::text
        FROM group_matches gm
        JOIN category_groups cg ON cg.id_group = gm.id_group
        JOIN tournament_categories tc ON tc.id_category = cg.id_category
        JOIN tournaments t ON t.id_tournament = cg.id_tournament
        LEFT JOIN users p1 ON p1.id_user = gm.player1_id
        LEFT JOIN users p2 ON p2.id_user = gm.player2_id
        LEFT JOIN users opp ON opp.id_user = CASE WHEN gm.player1_id = $1 THEN gm.player2_id ELSE gm.player1_id END
        LEFT JOIN clubs oppcl ON oppcl.id_club = opp.id_club
        WHERE (gm.player1_id = $1 OR gm.player2_id = $1)
          AND gm.status IN ('played', 'walkover')

        UNION ALL

        SELECT
          bm.id_match, 'bracket'::text AS match_type,
          t.tournament_name,
          tc.category_type, tc.category_range,
          NULL::text AS group_name, bm.round,
          (SELECT MAX(bm2.round) FROM bracket_matches bm2 WHERE bm2.id_category = bm.id_category) AS total_rounds,
          bm.player1_id,
          COALESCE(NULLIF(TRIM(p1.last_name || ' ' || p1.first_name), ''), p1.email) AS player1_name,
          bm.player2_id,
          COALESCE(NULLIF(TRIM(p2.last_name || ' ' || p2.first_name), ''), p2.email) AS player2_name,
          oppcl.name AS opponent_club,
          bm.status, bm.sets_player1, bm.sets_player2, bm.winner_id, bm.played_at::text
        FROM bracket_matches bm
        JOIN tournament_categories tc ON tc.id_category = bm.id_category
        JOIN tournaments t ON t.id_tournament = bm.id_tournament
        LEFT JOIN users p1 ON p1.id_user = bm.player1_id
        LEFT JOIN users p2 ON p2.id_user = bm.player2_id
        LEFT JOIN users opp ON opp.id_user = CASE WHEN bm.player1_id = $1 THEN bm.player2_id ELSE bm.player1_id END
        LEFT JOIN clubs oppcl ON oppcl.id_club = opp.id_club
        WHERE (bm.player1_id = $1 OR bm.player2_id = $1)
          AND bm.status IN ('played', 'walkover')
      )
      SELECT * FROM matches
      ORDER BY played_at DESC NULLS LAST
      LIMIT $2
    `;
    const res = await this.pool.query(query, [id_user, Math.min(limit, 50)]);
    return res.rows;
  }

  // Podio (top 3) de este jugador en categorías ya finalizadas — mismo
  // criterio de posición que getCategoryStandings, generalizado a todas
  // las categorías de una — para mostrar logros en el perfil en vez de
  // solo datos de cuenta.
  async getPlayerAchievements(id_user: string) {
    const query = `
      WITH my_categories AS (
        SELECT DISTINCT tc.id_category, tc.id_tournament, tc.category_type, tc.category_range,
               t.tournament_name, t.event_date
        FROM enrollments e
        JOIN tournament_categories tc ON tc.id_category = e.id_category
        JOIN tournaments t ON t.id_tournament = tc.id_tournament
        WHERE e.id_user = $1 AND tc.phase = 'finished'
      ),
      bracket_totals AS (
        SELECT id_category, MAX(round) AS total_rounds
        FROM bracket_matches
        GROUP BY id_category
      ),
      final_matches AS (
        SELECT bm.id_category, bm.winner_id
        FROM bracket_matches bm
        JOIN bracket_totals bt ON bt.id_category = bm.id_category AND bm.round = bt.total_rounds
        WHERE bm.match_number = 1
      ),
      losers AS (
        SELECT bm.id_category,
               CASE WHEN bm.winner_id = bm.player1_id THEN bm.player2_id ELSE bm.player1_id END AS id_user,
               (POWER(2, (bt.total_rounds - bm.round))::int + 1) AS position
        FROM bracket_matches bm
        JOIN bracket_totals bt ON bt.id_category = bm.id_category
        WHERE bm.status IN ('played', 'walkover')
          AND bm.is_bye = FALSE
          AND bm.player1_id IS NOT NULL AND bm.player2_id IS NOT NULL
      ),
      placed AS (
        SELECT id_category, winner_id AS id_user, 1 AS position FROM final_matches WHERE winner_id IS NOT NULL
        UNION ALL
        SELECT id_category, id_user, position FROM losers WHERE id_user IS NOT NULL
      )
      SELECT
        mc.id_tournament, mc.tournament_name, mc.event_date::text,
        mc.id_category, mc.category_type, mc.category_range,
        p.position
      FROM my_categories mc
      JOIN placed p ON p.id_category = mc.id_category AND p.id_user = $1
      WHERE p.position <= 3
      ORDER BY mc.event_date DESC NULLS LAST, p.position ASC
    `;
    const res = await this.pool.query(query, [id_user]);
    return res.rows;
  }

  // Mis inscripciones activas con info del torneo y fase de cada categoría
  async getMyEnrollments(id_user: string) {
    const res = await this.pool.query(
      `SELECT
         t.id_tournament, t.tournament_name, t.event_date, t.address, t.region,
         tc.id_category, tc.category_type, tc.category_range, tc.gender,
         COALESCE(tc.phase, 'enrollment') AS phase,
         e.enrolled_at
       FROM enrollments e
       JOIN tournament_categories tc ON tc.id_category = e.id_category
       JOIN tournaments t ON t.id_tournament = e.id_tournament
       WHERE e.id_user = $1 AND e.status = 'active'
       ORDER BY t.event_date DESC NULLS LAST, t.tournament_name`,
      [id_user]
    );
    return res.rows;
  }
}
