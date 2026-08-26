import type { Pool, PoolClient } from "pg";
import DB from "../db/db_configuration";
import type { CompetitionPlayerInput, GeneratedGroupsResult } from "../group_generation_logic";
import type { GeneratedBracketResult } from "../bracket_generation_logic";
import { NotificationsRepository } from "../notifications/notifications_repository";
import { ActivityLogRepository } from "../activity/activity_log_repository";
import { RANKING_POINTS_PER_WIN, RANKED_PLAYERS_CTE } from "../ranking/ranking_repository";
import type {
  GroupRow,
  GroupMemberRow,
  GroupStandingRow,
  GroupMatchRow,
  BracketMatchRow,
  SetScore,
  MoveGroupMemberInput,
  BracketsError,
} from "./dto/brackets_dto";

export class BracketsRepository {
  private pool: Pool;
  notifications: NotificationsRepository;
  private activityLog: ActivityLogRepository;

  constructor(pool?: Pool) {
    this.pool = pool ?? DB.getPool();
    this.notifications = new NotificationsRepository(this.pool);
    this.activityLog = new ActivityLogRepository(this.pool);
  }

  async getTournamentCategoryNames(
    tournamentId: string,
    categoryId: string
  ): Promise<{ tournamentName: string; categoryType: string; categoryRange: string } | null> {
    const res = await this.pool.query<{
      tournament_name: string;
      category_type: string;
      category_range: string;
    }>(
      `SELECT t.tournament_name, tc.category_type, tc.category_range
       FROM tournaments t
       JOIN tournament_categories tc ON tc.id_category = $1
       WHERE t.id_tournament = $2`,
      [categoryId, tournamentId]
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      tournamentName: row.tournament_name,
      categoryType: row.category_type,
      categoryRange: row.category_range,
    };
  }

  // Ajuste manual: cambia cuántos clasifican de UN grupo puntual, sin tocar
  // el default de la categoría ni el resto de los grupos.
  async setGroupQualifiers(groupId: string, qualifiersPerGroup: number): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE category_groups SET qualifiers_per_group = $1 WHERE id_group = $2`,
      [qualifiersPerGroup, groupId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  // Cantidad de clasificados por grupo configurada a nivel de categoría
  // (se usa como default al crear los grupos; cada grupo puede después
  // ajustarse manualmente sin afectar este valor).
  async getCategoryQualifiersPerGroup(categoryId: string): Promise<number> {
    const res = await this.pool.query<{ qualifiers_per_group: number }>(
      `SELECT qualifiers_per_group FROM tournament_categories WHERE id_category = $1`,
      [categoryId]
    );
    return Number(res.rows[0]?.qualifiers_per_group ?? 2);
  }

  private async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  }

  // ─── GRUPOS ──────────────────────────────────────────────

  async groupsExist(tournamentId: string, categoryId: string): Promise<boolean> {
    const res = await this.pool.query(
      `SELECT 1 FROM category_groups
       WHERE id_tournament = $1 AND id_category = $2 LIMIT 1`,
      [tournamentId, categoryId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  // Solo carga jugadores con qualification_type = 'group' para la etapa de grupos
  async loadPlayersForCategory(
    tournamentId: string,
    categoryId: string
  ): Promise<CompetitionPlayerInput[]> {
    const query = `
      WITH ranked_players AS (${RANKED_PLAYERS_CTE})
      SELECT
        u.id_user,
        rp.ranking_points,
        rp.ranking_position,
        e.seed  AS seed_number,
        cl.name AS club_name
      FROM enrollments e
      JOIN users u ON u.id_user = e.id_user
      LEFT JOIN clubs cl ON cl.id_club = u.id_club
      LEFT JOIN ranked_players rp ON rp.id_user = u.id_user
      WHERE e.id_tournament = $1
        AND e.id_category = $2
        AND e.status = 'active'
        AND e.qualification_type = 'group'
        AND e.checked_in = true
      ORDER BY e.seed ASC NULLS LAST, e.enrolled_at ASC;
    `;

    const res = await this.pool.query(query, [tournamentId, categoryId]);
    return res.rows.map((row) => ({
      id_user: row.id_user as string,
      ranking_points: (row.ranking_points as number | null) ?? null,
      ranking_position: (row.ranking_position as number | null) ?? null,
      seed_number: (row.seed_number as number | null) ?? null,
      club_name: (row.club_name as string | null) ?? null,
      qualification_type: "group" as const,
    }));
  }

  private async insertGroupsData(
    client: PoolClient,
    tournamentId: string,
    categoryId: string,
    result: GeneratedGroupsResult,
    qualifiersPerGroup: number
  ): Promise<void> {
    const groupIdMap = new Map<string, string>();

    for (const group of result.groups) {
      const res = await client.query<{ id_group: string }>(
        `INSERT INTO category_groups
           (id_tournament, id_category, group_name, target_size, sort_order, status, group_kind, qualifiers_per_group)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id_group`,
        [
          tournamentId, categoryId, group.group_name, group.target_size,
          group.sort_order, group.status, group.group_kind, qualifiersPerGroup,
        ]
      );
      groupIdMap.set(group.temp_group_id, res.rows[0].id_group);
    }

    for (const member of result.members) {
      const id_group = groupIdMap.get(member.temp_group_id)!;
      await client.query(
        `INSERT INTO group_members (id_group, id_user, seed, assignment_type, group_position)
         VALUES ($1, $2, $3, $4, $5)`,
        [id_group, member.id_user, member.seed, member.assignment_type, member.group_position]
      );
    }

    for (const standing of result.standings) {
      const id_group = groupIdMap.get(standing.temp_group_id)!;
      await client.query(
        `INSERT INTO group_standings
           (id_group, id_user, played, won, lost,
            sets_for, sets_against, points_for, points_against,
            position, qualified_to_bracket, qualification_label)
         VALUES ($1, $2, 0, 0, 0, 0, 0, 0, 0, NULL, FALSE, NULL)`,
        [id_group, standing.id_user]
      );
    }

    for (const match of result.matches) {
      const id_group = groupIdMap.get(match.temp_group_id)!;
      await client.query(
        `INSERT INTO group_matches
           (id_group, id_tournament, id_category, stage, round_number, match_number,
            best_of_sets, player1_id, player2_id, status, source_note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          id_group, tournamentId, categoryId, match.stage, match.round_number,
          match.match_number, match.best_of_sets, match.player1_id,
          match.player2_id, match.status, match.source_note,
        ]
      );
    }
  }

  async persistGroups(
    tournamentId: string,
    categoryId: string,
    result: GeneratedGroupsResult,
    qualifiersPerGroup: number
  ): Promise<void> {
    await this.withTransaction((client) =>
      this.insertGroupsData(client, tournamentId, categoryId, result, qualifiersPerGroup)
    );
  }

  // Verdadero si algún partido de grupo de la categoría ya tiene resultado cargado.
  async anyGroupMatchPlayed(categoryId: string): Promise<boolean> {
    const res = await this.pool.query(
      `SELECT 1 FROM group_matches WHERE id_category = $1 AND status <> 'scheduled' LIMIT 1`,
      [categoryId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  // Borra los grupos actuales de la categoría (cascada a members/standings/matches)
  // y arma unos nuevos desde cero con los inscritos actuales — todo en una sola
  // transacción para no dejar la categoría sin grupos si algo falla a mitad de camino.
  async regenerateGroups(
    tournamentId: string,
    categoryId: string,
    result: GeneratedGroupsResult,
    qualifiersPerGroup: number
  ): Promise<void> {
    await this.withTransaction(async (client) => {
      await client.query(
        `DELETE FROM category_groups WHERE id_tournament = $1 AND id_category = $2`,
        [tournamentId, categoryId]
      );
      await this.insertGroupsData(client, tournamentId, categoryId, result, qualifiersPerGroup);
    });
  }

  async findGroupsByCategory(
    tournamentId: string,
    categoryId: string
  ): Promise<{
    groups: GroupRow[];
    members: GroupMemberRow[];
    standings: GroupStandingRow[];
    matches: GroupMatchRow[];
  }> {
    const [groupsRes, membersRes, standingsRes, matchesRes] = await Promise.all([
      this.pool.query<GroupRow>(
        `SELECT id_group, id_tournament, id_category, group_name,
                target_size, sort_order, status, group_kind, qualifiers_per_group
         FROM category_groups
         WHERE id_tournament = $1 AND id_category = $2
         ORDER BY sort_order ASC`,
        [tournamentId, categoryId]
      ),
      this.pool.query<GroupMemberRow>(
        `SELECT gm.id_group, gm.id_user, gm.seed, gm.assignment_type, gm.group_position,
                u.first_name, u.last_name, u.email, cl.name AS club_name
         FROM group_members gm
         JOIN category_groups cg ON cg.id_group = gm.id_group
         JOIN users u ON u.id_user = gm.id_user
         LEFT JOIN clubs cl ON cl.id_club = u.id_club
         WHERE cg.id_tournament = $1 AND cg.id_category = $2
         ORDER BY gm.group_position ASC NULLS LAST`,
        [tournamentId, categoryId]
      ),
      this.pool.query<GroupStandingRow>(
        `SELECT gs.id_group, gs.id_user, gs.played, gs.won, gs.lost,
                gs.sets_for, gs.sets_against, gs.points_for, gs.points_against, gs.position,
                gs.qualified_to_bracket, gs.qualification_label
         FROM group_standings gs
         JOIN category_groups cg ON cg.id_group = gs.id_group
         WHERE cg.id_tournament = $1 AND cg.id_category = $2
         ORDER BY gs.won DESC, (gs.sets_for - gs.sets_against) DESC, (gs.points_for - gs.points_against) DESC`,
        [tournamentId, categoryId]
      ),
      this.pool.query<GroupMatchRow>(
        `SELECT gm.id_match, gm.id_group, gm.stage, gm.round_number, gm.match_number,
                gm.best_of_sets, gm.player1_id, gm.player2_id, gm.winner_id,
                gm.sets_player1, gm.sets_player2, gm.status, gm.source_note, gm.table_number,
                gm.played_table_number, gm.set_scores, gm.referee_id
         FROM group_matches gm
         JOIN category_groups cg ON cg.id_group = gm.id_group
         WHERE cg.id_tournament = $1 AND cg.id_category = $2
         ORDER BY gm.id_group ASC, gm.match_number ASC`,
        [tournamentId, categoryId]
      ),
    ]);

    return {
      groups: groupsRes.rows,
      members: membersRes.rows,
      standings: standingsRes.rows,
      matches: matchesRes.rows,
    };
  }

  async findMatch(matchId: string): Promise<GroupMatchRow | null> {
    const res = await this.pool.query<GroupMatchRow>(
      `SELECT id_match, id_group, id_tournament, id_category, stage, round_number, match_number,
              best_of_sets, player1_id, player2_id, winner_id,
              sets_player1, sets_player2, status, source_note, set_scores, played_table_number
       FROM group_matches WHERE id_match = $1`,
      [matchId]
    );
    return res.rows[0] ?? null;
  }

  async getCategoryPhase(categoryId: string): Promise<string> {
    const res = await this.pool.query<{ phase: string }>(
      `SELECT phase FROM tournament_categories WHERE id_category = $1`,
      [categoryId]
    );
    return res.rows[0]?.phase ?? "enrollment";
  }

  async recordMatchResult(params: {
    matchId: string;
    groupId: string;
    winnerId: string;
    loserId: string;
    setsPlayer1: number;
    setsPlayer2: number;
    walkover: boolean;
    setScores?: SetScore[];
    winnerSetsFor: number;
    winnerSetsAgainst: number;
    loserSetsFor: number;
    loserSetsAgainst: number;
    winnerPointsFor: number;
    winnerPointsAgainst: number;
    loserPointsFor: number;
    loserPointsAgainst: number;
    tournamentId: string;
    categoryId: string;
  }): Promise<void> {
    const {
      matchId, groupId, winnerId, loserId,
      setsPlayer1, setsPlayer2, walkover, setScores,
      winnerSetsFor, winnerSetsAgainst,
      loserSetsFor, loserSetsAgainst,
      winnerPointsFor, winnerPointsAgainst,
      loserPointsFor, loserPointsAgainst,
      tournamentId, categoryId,
    } = params;

    await this.withTransaction(async (client) => {
      // Resultado del partido
      await client.query(
        `UPDATE group_matches
         SET winner_id = $1, sets_player1 = $2, sets_player2 = $3,
             status = $4, played_at = NOW(), set_scores = $5,
             played_table_number = table_number, table_number = NULL
         WHERE id_match = $6`,
        [
          winnerId, setsPlayer1, setsPlayer2, walkover ? "walkover" : "played",
          setScores && setScores.length > 0 ? JSON.stringify(setScores) : null,
          matchId,
        ]
      );

      // Tabla de posiciones del grupo
      await client.query(
        `UPDATE group_standings
         SET played = played + 1, won = won + 1,
             sets_for = sets_for + $1, sets_against = sets_against + $2,
             points_for = points_for + $3, points_against = points_against + $4
         WHERE id_group = $5 AND id_user = $6`,
        [winnerSetsFor, winnerSetsAgainst, winnerPointsFor, winnerPointsAgainst, groupId, winnerId]
      );

      await client.query(
        `UPDATE group_standings
         SET played = played + 1, lost = lost + 1,
             sets_for = sets_for + $1, sets_against = sets_against + $2,
             points_for = points_for + $3, points_against = points_against + $4
         WHERE id_group = $5 AND id_user = $6`,
        [loserSetsFor, loserSetsAgainst, loserPointsFor, loserPointsAgainst, groupId, loserId]
      );

      // Estadísticas globales del ganador
      await client.query(
        `INSERT INTO player_stats (id_user, matches_played, matches_won, matches_lost, sets_won, sets_lost, ranking_points)
         VALUES ($1, 1, 1, 0, $2, $3, ${RANKING_POINTS_PER_WIN})
         ON CONFLICT (id_user) DO UPDATE SET
           matches_played = player_stats.matches_played + 1,
           matches_won    = player_stats.matches_won + 1,
           sets_won       = player_stats.sets_won + EXCLUDED.sets_won,
           sets_lost      = player_stats.sets_lost + EXCLUDED.sets_lost,
           ranking_points = player_stats.ranking_points + ${RANKING_POINTS_PER_WIN},
           updated_at     = NOW()`,
        [winnerId, winnerSetsFor, winnerSetsAgainst]
      );

      // Estadísticas globales del perdedor — un walkover sigue siendo un
      // partido perdido (cuenta para PJ/derrotas igual que en group_standings
      // arriba), solo que no suma puntos de ranking.
      await client.query(
        `INSERT INTO player_stats (id_user, matches_played, matches_won, matches_lost, sets_won, sets_lost)
         VALUES ($1, 1, 0, 1, $2, $3)
         ON CONFLICT (id_user) DO UPDATE SET
           matches_played = player_stats.matches_played + 1,
           matches_lost   = player_stats.matches_lost + 1,
           sets_won       = player_stats.sets_won + EXCLUDED.sets_won,
           sets_lost      = player_stats.sets_lost + EXCLUDED.sets_lost,
           updated_at     = NOW()`,
        [loserId, loserSetsFor, loserSetsAgainst]
      );

      // Recalcular posición dentro del grupo: primero partidos ganados, luego
      // diferencia de sets, y recién si siguen empatados, diferencia de puntos
      // reales jugados (mismo criterio que loadGroupQualifiers).
      await client.query(
        `WITH ranked AS (
           SELECT id_user,
                  ROW_NUMBER() OVER (
                    ORDER BY won DESC, (sets_for - sets_against) DESC,
                             (points_for - points_against) DESC, id_user ASC
                  ) AS rnk
           FROM group_standings
           WHERE id_group = $1
         )
         UPDATE group_standings gs
         SET position = ranked.rnk
         FROM ranked
         WHERE gs.id_group = $1 AND gs.id_user = ranked.id_user`,
        [groupId]
      );

      await this.notifications.create(
        {
          idUser: winnerId,
          type: "match_result",
          title: "Ganaste tu partido",
          message: `Ganaste ${winnerSetsFor}-${winnerSetsAgainst} en la fase de grupos`,
          idTournament: tournamentId,
          idCategory: categoryId,
        },
        client
      );
      await this.notifications.create(
        {
          idUser: loserId,
          type: "match_result",
          title: walkover ? "Partido por walkover" : "Perdiste tu partido",
          message: walkover
            ? "Tu partido de grupo se cerró por walkover"
            : `Perdiste ${loserSetsFor}-${loserSetsAgainst} en la fase de grupos`,
          idTournament: tournamentId,
          idCategory: categoryId,
        },
        client
      );
    });
  }

  // Deshace un resultado de partido de grupo ya cargado (típicamente por un
  // error de digitación): vuelve el partido a "scheduled" y resta exactamente
  // lo que ese resultado había sumado a la tabla de posiciones del grupo y a
  // las estadísticas globales del jugador — no recalcula desde cero, así que
  // no importa el orden en que se deshagan varios resultados.
  async undoGroupMatchResult(params: {
    matchId: string;
    groupId: string;
    winnerId: string;
    loserId: string;
    winnerSetsFor: number;
    winnerSetsAgainst: number;
    loserSetsFor: number;
    loserSetsAgainst: number;
    winnerPointsFor: number;
    winnerPointsAgainst: number;
    loserPointsFor: number;
    loserPointsAgainst: number;
    walkover: boolean;
    tournamentId: string;
    requestedBy: string;
  }): Promise<void> {
    const {
      matchId, groupId, winnerId, loserId,
      winnerSetsFor, winnerSetsAgainst,
      loserSetsFor, loserSetsAgainst,
      winnerPointsFor, winnerPointsAgainst,
      loserPointsFor, loserPointsAgainst,
      tournamentId, requestedBy,
    } = params;

    await this.withTransaction(async (client) => {
      await client.query(
        `UPDATE group_matches
         SET winner_id = NULL, sets_player1 = 0, sets_player2 = 0,
             status = 'scheduled', played_at = NULL, set_scores = NULL,
             table_number = played_table_number, played_table_number = NULL
         WHERE id_match = $1`,
        [matchId]
      );

      await client.query(
        `UPDATE group_standings
         SET played = played - 1, won = won - 1,
             sets_for = sets_for - $1, sets_against = sets_against - $2,
             points_for = points_for - $3, points_against = points_against - $4
         WHERE id_group = $5 AND id_user = $6`,
        [winnerSetsFor, winnerSetsAgainst, winnerPointsFor, winnerPointsAgainst, groupId, winnerId]
      );

      await client.query(
        `UPDATE group_standings
         SET played = played - 1, lost = lost - 1,
             sets_for = sets_for - $1, sets_against = sets_against - $2,
             points_for = points_for - $3, points_against = points_against - $4
         WHERE id_group = $5 AND id_user = $6`,
        [loserSetsFor, loserSetsAgainst, loserPointsFor, loserPointsAgainst, groupId, loserId]
      );

      await client.query(
        `UPDATE player_stats
         SET matches_played = matches_played - 1, matches_won = matches_won - 1,
             sets_won = sets_won - $1, sets_lost = sets_lost - $2,
             ranking_points = ranking_points - ${RANKING_POINTS_PER_WIN}, updated_at = NOW()
         WHERE id_user = $3`,
        [winnerSetsFor, winnerSetsAgainst, winnerId]
      );

      await client.query(
        `UPDATE player_stats
         SET matches_played = matches_played - 1, matches_lost = matches_lost - 1,
             sets_won = sets_won - $1, sets_lost = sets_lost - $2, updated_at = NOW()
         WHERE id_user = $3`,
        [loserSetsFor, loserSetsAgainst, loserId]
      );

      // Mismo criterio de reordenamiento que recordMatchResult.
      await client.query(
        `WITH ranked AS (
           SELECT id_user,
                  ROW_NUMBER() OVER (
                    ORDER BY won DESC, (sets_for - sets_against) DESC,
                             (points_for - points_against) DESC, id_user ASC
                  ) AS rnk
           FROM group_standings
           WHERE id_group = $1
         )
         UPDATE group_standings gs
         SET position = ranked.rnk
         FROM ranked
         WHERE gs.id_group = $1 AND gs.id_user = ranked.id_user`,
        [groupId]
      );

      await this.activityLog.record(tournamentId, requestedBy, "match_result_undone", null, client);
    });
  }

  // ─── CUADRO ELIMINATORIO ─────────────────────────────────

  async bracketExists(tournamentId: string, categoryId: string): Promise<boolean> {
    const res = await this.pool.query(
      `SELECT 1 FROM bracket_matches
       WHERE id_tournament = $1 AND id_category = $2 LIMIT 1`,
      [tournamentId, categoryId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  // Retorna clasificados de grupos ordenados por semilla:
  // primero los primeros de cada grupo, luego los segundos, etc.
  // El corte de clasificación es POR GRUPO (cg.qualifiers_per_group), no un
  // número único para toda la categoría: cada grupo puede tener su propio valor
  // (default heredado de la categoría, ajustable a mano por grupo).
  // group_name/rank_in_group viajan para poder mostrar "1º de GR-2" en la
  // previsualización del sorteo (ver BracketsService.previewBracket) — no
  // solo la lista plana de ids.
  async loadGroupQualifiers(
    tournamentId: string,
    categoryId: string
  ): Promise<Array<{ id_user: string; group_name: string; rank_in_group: number; id_club: string | null }>> {
    const query = `
      WITH ranked AS (
        SELECT
          gs.id_user,
          cg.group_name,
          ROW_NUMBER() OVER (
            PARTITION BY gs.id_group
            ORDER BY gs.won DESC,
                     (gs.sets_for - gs.sets_against) DESC,
                     (gs.points_for - gs.points_against) DESC,
                     gs.id_user ASC
          ) AS rank_in_group,
          cg.sort_order AS group_sort_order,
          cg.qualifiers_per_group AS qualifiers_per_group
        FROM group_standings gs
        JOIN category_groups cg ON cg.id_group = gs.id_group
        WHERE cg.id_tournament = $1 AND cg.id_category = $2
      )
      SELECT ranked.id_user, ranked.group_name, ranked.rank_in_group, u.id_club
      FROM ranked
      JOIN users u ON u.id_user = ranked.id_user
      WHERE rank_in_group <= qualifiers_per_group
      ORDER BY rank_in_group ASC, group_sort_order ASC;
    `;

    const res = await this.pool.query(query, [tournamentId, categoryId]);
    return res.rows.map(
      (r: { id_user: string; group_name: string; rank_in_group: string | number; id_club: string | null }) => ({
        id_user: r.id_user,
        group_name: r.group_name,
        rank_in_group: Number(r.rank_in_group),
        id_club: r.id_club,
      })
    );
  }

  // Marca en group_standings quién clasificó al cuadro, con el mismo criterio
  // de desempate/orden y el mismo corte por grupo que loadGroupQualifiers.
  async markGroupQualifiers(tournamentId: string, categoryId: string): Promise<void> {
    await this.pool.query(
      `WITH ranked AS (
         SELECT
           gs.id_group,
           gs.id_user,
           ROW_NUMBER() OVER (
             PARTITION BY gs.id_group
             ORDER BY gs.won DESC, (gs.sets_for - gs.sets_against) DESC,
                      (gs.points_for - gs.points_against) DESC, gs.id_user ASC
           ) AS rank_in_group,
           cg.qualifiers_per_group AS qualifiers_per_group
         FROM group_standings gs
         JOIN category_groups cg ON cg.id_group = gs.id_group
         WHERE cg.id_tournament = $1 AND cg.id_category = $2
       )
       UPDATE group_standings gs
       SET qualified_to_bracket = TRUE,
           qualification_label = CASE
             WHEN ranked.rank_in_group = 1 THEN 'first'
             WHEN ranked.rank_in_group = 2 THEN 'second'
             ELSE NULL
           END
       FROM ranked
       WHERE gs.id_group = ranked.id_group AND gs.id_user = ranked.id_user
         AND ranked.rank_in_group <= ranked.qualifiers_per_group`,
      [tournamentId, categoryId]
    );
  }

  // Jugadores con pase directo (direct_advance / late_entry)
  async loadDirectEntryPlayers(
    tournamentId: string,
    categoryId: string
  ): Promise<Array<{ id_user: string; id_club: string | null }>> {
    const query = `
      SELECT u.id_user, u.id_club
      FROM enrollments e
      JOIN users u ON u.id_user = e.id_user
      WHERE e.id_tournament = $1
        AND e.id_category = $2
        AND e.status = 'active'
        AND e.qualification_type IN ('direct_advance', 'late_entry')
        AND e.checked_in = true
      ORDER BY e.enrolled_at ASC;
    `;

    const res = await this.pool.query(query, [tournamentId, categoryId]);
    return res.rows.map((r: { id_user: string; id_club: string | null }) => ({
      id_user: r.id_user,
      id_club: r.id_club,
    }));
  }

  // Nombres para mostrar en la previsualización del sorteo — batch simple
  // por lista de ids, sin depender de grupos (los pases directos no
  // pertenecen a ningún grupo).
  async getUserNames(
    userIds: string[]
  ): Promise<Map<string, { first_name: string | null; last_name: string | null; email: string }>> {
    if (userIds.length === 0) return new Map();
    const res = await this.pool.query<{
      id_user: string;
      first_name: string | null;
      last_name: string | null;
      email: string;
    }>(`SELECT id_user, first_name, last_name, email FROM users WHERE id_user = ANY($1)`, [userIds]);
    return new Map(res.rows.map((r) => [r.id_user, r]));
  }

  async persistBracket(
    tournamentId: string,
    categoryId: string,
    generated: GeneratedBracketResult,
    requestedBy?: string
  ): Promise<void> {
    await this.withTransaction(async (client) => {
      for (const match of generated.matches) {
        await client.query(
          `INSERT INTO bracket_matches
             (id_tournament, id_category, round, match_number,
              player1_id, player2_id,
              next_round, next_match_number, next_match_slot,
              winner_id, is_bye, best_of_sets, status, dead_slot, seed1, seed2)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            tournamentId, categoryId, match.round, match.match_number,
            match.player1_id, match.player2_id,
            match.next_round, match.next_match_number, match.next_match_slot,
            match.winner_id, match.is_bye, match.best_of_sets, match.status,
            match.dead_slot, match.seed1, match.seed2,
          ]
        );
      }

      // Sin requestedBy (generación automática por el scheduler de fases, no
      // un click del admin) no hay a quién atribuirle la fila — se omite.
      if (requestedBy) {
        await this.activityLog.record(tournamentId, requestedBy, "bracket_generated", null, client);
      }
    });
  }

  async findBracket(tournamentId: string, categoryId: string): Promise<BracketMatchRow[]> {
    const res = await this.pool.query<BracketMatchRow>(
      `SELECT id_match, id_tournament, id_category, round, match_number,
              player1_id, player2_id, next_round, next_match_number, next_match_slot,
              winner_id, sets_player1, sets_player2, best_of_sets,
              is_bye, status, played_at::text, set_scores, table_number, played_table_number,
              referee_id, dead_slot, seed1, seed2
       FROM bracket_matches
       WHERE id_tournament = $1 AND id_category = $2
       ORDER BY round ASC, match_number ASC`,
      [tournamentId, categoryId]
    );
    return res.rows;
  }

  async findBracketMatch(matchId: string): Promise<BracketMatchRow | null> {
    const res = await this.pool.query<BracketMatchRow>(
      `SELECT id_match, id_tournament, id_category, round, match_number,
              player1_id, player2_id, next_round, next_match_number, next_match_slot,
              winner_id, sets_player1, sets_player2, best_of_sets,
              is_bye, status, played_at::text, set_scores, dead_slot
       FROM bracket_matches WHERE id_match = $1`,
      [matchId]
    );
    return res.rows[0] ?? null;
  }

  // Avanza un ganador hasta el partido (round, matchNumber) indicado y, si
  // hace falta, sigue en cascada: cuando la llave se generó con datos
  // incompletos, el otro cupo de un partido puede estar marcado como
  // dead_slot (esa mitad del cuadro nunca va a tener jugador). En ese caso,
  // en vez de dejar al ganador esperando un rival que no existe, el partido
  // se resuelve como BYE al instante y el mismo ganador sigue avanzando
  // hacia la próxima ronda (puede repetirse varias rondas seguidas si hay
  // varias ramas muertas encadenadas).
  private async advanceBracketWinner(
    client: PoolClient,
    params: {
      tournamentId: string;
      categoryId: string;
      winnerId: string;
      round: number;
      matchNumber: number;
      slot: 1 | 2;
    }
  ): Promise<void> {
    const { tournamentId, categoryId, winnerId } = params;
    let { round, matchNumber, slot } = params;

    for (;;) {
      await client.query(
        `UPDATE bracket_matches
         SET player1_id = CASE WHEN $1 = 1 THEN $2 ELSE player1_id END,
             player2_id = CASE WHEN $1 = 2 THEN $2 ELSE player2_id END
         WHERE id_tournament = $3 AND id_category = $4 AND round = $5 AND match_number = $6`,
        [slot, winnerId, tournamentId, categoryId, round, matchNumber]
      );

      const { rows } = await client.query<{
        id_match: string;
        player1_id: string | null;
        player2_id: string | null;
        dead_slot: 1 | 2 | null;
        status: string;
        next_round: number | null;
        next_match_number: number | null;
        next_match_slot: 1 | 2 | null;
      }>(
        `SELECT id_match, player1_id, player2_id, dead_slot, status,
                next_round, next_match_number, next_match_slot
         FROM bracket_matches
         WHERE id_tournament = $1 AND id_category = $2 AND round = $3 AND match_number = $4`,
        [tournamentId, categoryId, round, matchNumber]
      );
      const match = rows[0];
      if (!match || match.status !== "pending") return;

      if (match.player1_id !== null && match.player2_id !== null) {
        await client.query(`UPDATE bracket_matches SET status = 'ready' WHERE id_match = $1`, [match.id_match]);
        await this.notifyWaitingOpponent(client, {
          tournamentId,
          categoryId,
          winnerId,
          waitingPlayerId: match.player1_id === winnerId ? match.player2_id : match.player1_id,
        });
        return;
      }

      const otherSlotIsDead =
        (match.dead_slot === 1 && match.player1_id === null) ||
        (match.dead_slot === 2 && match.player2_id === null);
      if (!otherSlotIsDead) return; // esperando el resultado real del otro lado

      await client.query(
        `UPDATE bracket_matches
         SET winner_id = $1, status = 'bye', is_bye = TRUE, played_at = NOW()
         WHERE id_match = $2`,
        [winnerId, match.id_match]
      );

      if (!match.next_round || !match.next_match_number || !match.next_match_slot) return;
      round = match.next_round;
      matchNumber = match.next_match_number;
      slot = match.next_match_slot;
    }
  }

  private async notifyWaitingOpponent(
    client: PoolClient,
    params: { tournamentId: string; categoryId: string; winnerId: string; waitingPlayerId: string | null }
  ): Promise<void> {
    const { tournamentId, categoryId, winnerId, waitingPlayerId } = params;
    if (!waitingPlayerId) return;

    const winnerNameRes = await client.query<{
      first_name: string | null;
      last_name: string | null;
      email: string;
    }>(`SELECT first_name, last_name, email FROM users WHERE id_user = $1`, [winnerId]);
    const w = winnerNameRes.rows[0];
    const winnerName = w ? [w.first_name, w.last_name].filter(Boolean).join(" ") || w.email : "tu rival";

    await this.notifications.create(
      {
        idUser: waitingPlayerId,
        type: "next_match_ready",
        title: "Ya se definió tu próximo rival",
        message: `Tu próximo partido en el cuadro ya está listo: jugás contra ${winnerName}.`,
        idTournament: tournamentId,
        idCategory: categoryId,
      },
      client
    );
  }

  async recordBracketResult(params: {
    matchId: string;
    winnerId: string;
    loserId: string | null;
    setsPlayer1: number;
    setsPlayer2: number;
    winnerSetsFor: number;
    winnerSetsAgainst: number;
    walkover: boolean;
    setScores?: SetScore[];
    nextRound: number | null;
    nextMatchNumber: number | null;
    nextMatchSlot: 1 | 2 | null;
    tournamentId: string;
    categoryId: string;
  }): Promise<void> {
    const { matchId, winnerId, loserId, setsPlayer1, setsPlayer2,
            winnerSetsFor, winnerSetsAgainst, walkover, setScores,
            nextRound, nextMatchNumber, nextMatchSlot, tournamentId, categoryId } = params;

    await this.withTransaction(async (client) => {
      // Resultado del partido de llave
      await client.query(
        `UPDATE bracket_matches
         SET winner_id = $1, sets_player1 = $2, sets_player2 = $3,
             status = $4, played_at = NOW(), set_scores = $5,
             played_table_number = table_number, table_number = NULL
         WHERE id_match = $6`,
        [
          winnerId, setsPlayer1, setsPlayer2, walkover ? "walkover" : "played",
          setScores && setScores.length > 0 ? JSON.stringify(setScores) : null,
          matchId,
        ]
      );

      if (nextRound && nextMatchNumber && nextMatchSlot) {
        await this.advanceBracketWinner(client, {
          tournamentId,
          categoryId,
          winnerId,
          round: nextRound,
          matchNumber: nextMatchNumber,
          slot: nextMatchSlot,
        });
      }

      // Estadísticas globales del ganador
      await client.query(
        `INSERT INTO player_stats (id_user, matches_played, matches_won, matches_lost, sets_won, sets_lost, ranking_points)
         VALUES ($1, 1, 1, 0, $2, $3, ${RANKING_POINTS_PER_WIN})
         ON CONFLICT (id_user) DO UPDATE SET
           matches_played = player_stats.matches_played + 1,
           matches_won    = player_stats.matches_won + 1,
           sets_won       = player_stats.sets_won + EXCLUDED.sets_won,
           sets_lost      = player_stats.sets_lost + EXCLUDED.sets_lost,
           ranking_points = player_stats.ranking_points + ${RANKING_POINTS_PER_WIN},
           updated_at     = NOW()`,
        [winnerId, winnerSetsFor, winnerSetsAgainst]
      );

      // Estadísticas globales del perdedor (si hay perdedor real — un bye no
      // tiene uno). Un walkover sigue contando como partido jugado/perdido,
      // solo que no suma puntos de ranking.
      if (loserId) {
        await client.query(
          `INSERT INTO player_stats (id_user, matches_played, matches_won, matches_lost, sets_won, sets_lost)
           VALUES ($1, 1, 0, 1, $2, $3)
           ON CONFLICT (id_user) DO UPDATE SET
             matches_played = player_stats.matches_played + 1,
             matches_lost   = player_stats.matches_lost + 1,
             sets_won       = player_stats.sets_won + EXCLUDED.sets_won,
             sets_lost      = player_stats.sets_lost + EXCLUDED.sets_lost,
             updated_at     = NOW()`,
          [loserId, winnerSetsAgainst, winnerSetsFor]
        );
      }

      const isFinal = !nextRound;
      await this.notifications.create(
        {
          idUser: winnerId,
          type: "match_result",
          title: isFinal ? "¡Ganaste el torneo!" : "Ganaste tu partido de llave",
          message: `Ganaste ${winnerSetsFor}-${winnerSetsAgainst}${isFinal ? " y te llevaste el título" : ", avanzás a la siguiente ronda"}`,
          idTournament: tournamentId,
          idCategory: categoryId,
        },
        client
      );
      if (loserId) {
        await this.notifications.create(
          {
            idUser: loserId,
            type: "match_result",
            title: walkover ? "Partido por walkover" : "Quedaste eliminado",
            message: walkover
              ? "Tu partido de llave se cerró por walkover"
              : `Perdiste ${winnerSetsAgainst}-${winnerSetsFor} en el cuadro eliminatorio`,
            idTournament: tournamentId,
            idCategory: categoryId,
          },
          client
        );
      }
    });
  }

  // Mueve un jugador de su grupo actual a otro grupo de la misma categoría.
  // Solo permitido mientras la categoría sigue en fase "groups", el jugador
  // no jugó ningún partido todavía en su grupo actual (así no se pierde
  // historial ni hay que recalcular sets/puntos), el grupo de origen no
  // queda con menos de 2 jugadores y el destino no supera el máximo de 4.
  async moveGroupMember(
    params: MoveGroupMemberInput
  ): Promise<{ moved: true } | { moved: false; error: BracketsError }> {
    const { tournamentId, categoryId, userId, toGroupId } = params;

    return this.withTransaction(async (client) => {
      const phaseRes = await client.query<{ phase: string }>(
        `SELECT phase FROM tournament_categories WHERE id_category = $1 FOR UPDATE`,
        [categoryId]
      );
      if ((phaseRes.rows[0]?.phase ?? "enrollment") !== "groups") {
        return { moved: false, error: "GROUPS_LOCKED" as BracketsError };
      }

      const fromRes = await client.query<{ id_group: string; seed: number | null }>(
        `SELECT cg.id_group, gm.seed
         FROM group_members gm
         JOIN category_groups cg ON cg.id_group = gm.id_group
         WHERE gm.id_user = $1 AND cg.id_tournament = $2 AND cg.id_category = $3`,
        [userId, tournamentId, categoryId]
      );
      const from = fromRes.rows[0];
      if (!from) return { moved: false, error: "PLAYER_NOT_IN_GROUP" as BracketsError };
      if (from.id_group === toGroupId) return { moved: false, error: "SAME_GROUP" as BracketsError };

      const toRes = await client.query(
        `SELECT id_group FROM category_groups
         WHERE id_group = $1 AND id_tournament = $2 AND id_category = $3`,
        [toGroupId, tournamentId, categoryId]
      );
      if (!toRes.rows[0]) return { moved: false, error: "GROUP_NOT_FOUND" as BracketsError };

      const playedRes = await client.query(
        `SELECT 1 FROM group_matches
         WHERE id_group = $1 AND (player1_id = $2 OR player2_id = $2) AND status <> 'scheduled'
         LIMIT 1`,
        [from.id_group, userId]
      );
      if ((playedRes.rowCount ?? 0) > 0) {
        return { moved: false, error: "PLAYER_ALREADY_PLAYED" as BracketsError };
      }

      const countsRes = await client.query<{ id_group: string; count: string }>(
        `SELECT id_group, COUNT(*)::int AS count FROM group_members
         WHERE id_group = ANY($1::uuid[]) GROUP BY id_group`,
        [[from.id_group, toGroupId]]
      );
      const counts = new Map(countsRes.rows.map((r) => [r.id_group, Number(r.count)]));
      const fromCount = counts.get(from.id_group) ?? 0;
      const toCount = counts.get(toGroupId) ?? 0;

      if (fromCount - 1 < 2) return { moved: false, error: "SOURCE_GROUP_TOO_SMALL" as BracketsError };
      if (toCount + 1 > 4) return { moved: false, error: "TARGET_GROUP_FULL" as BracketsError };

      // Sale del grupo de origen: sus partidos ahí seguían sin jugar (ya validado arriba).
      await client.query(
        `DELETE FROM group_matches WHERE id_group = $1 AND (player1_id = $2 OR player2_id = $2)`,
        [from.id_group, userId]
      );
      await client.query(`DELETE FROM group_standings WHERE id_group = $1 AND id_user = $2`, [from.id_group, userId]);
      await client.query(`DELETE FROM group_members WHERE id_group = $1 AND id_user = $2`, [from.id_group, userId]);

      const newFromCount = fromCount - 1;
      await client.query(
        `UPDATE category_groups SET target_size = $1, group_kind = $2 WHERE id_group = $3`,
        [newFromCount, newFromCount === 2 ? "playoff_two" : "normal", from.id_group]
      );

      // Entra al grupo destino, conservando su semilla original.
      await this.addMemberToGroup(client, {
        groupId: toGroupId,
        tournamentId,
        categoryId,
        userId,
        seed: from.seed,
        currentCount: toCount,
        assignmentType: "manual",
      });

      await this.notifications.create(
        {
          idUser: userId,
          type: "group_changed",
          title: "Te cambiaron de grupo",
          message: "El organizador te movió a otro grupo en la fase de grupos. Revisá tus nuevos partidos.",
          idTournament: tournamentId,
          idCategory: categoryId,
        },
        client
      );

      return { moved: true };
    });
  }

  // Inserta a un jugador dentro de un grupo (member + standing + partidos
  // todos-contra-todos contra quienes ya estaban ahí) y deja actualizado el
  // tamaño/tipo del grupo. No valida nada — los llamadores (moveGroupMember,
  // addPlayerToGroup) son responsables de chequear fase, cupos, duplicados, etc.
  private async addMemberToGroup(
    client: PoolClient,
    params: {
      groupId: string;
      tournamentId: string;
      categoryId: string;
      userId: string;
      seed: number | null;
      currentCount: number;
      assignmentType: "auto" | "manual";
    }
  ): Promise<void> {
    const { groupId, tournamentId, categoryId, userId, seed, currentCount, assignmentType } = params;

    // Próximo número consecutivo del grupo — se recalcula con MAX() en vez
    // de confiar en currentCount (que es un COUNT(*) de quien llama y puede
    // no coincidir si alguna vez quedan huecos, por ejemplo tras mover a
    // alguien a otro grupo).
    const positionRes = await client.query<{ next_position: number }>(
      `SELECT COALESCE(MAX(group_position), 0) + 1 AS next_position FROM group_members WHERE id_group = $1`,
      [groupId]
    );
    const groupPosition = Number(positionRes.rows[0]?.next_position ?? 1);

    await client.query(
      `INSERT INTO group_members (id_group, id_user, seed, assignment_type, group_position) VALUES ($1, $2, $3, $4, $5)`,
      [groupId, userId, seed, assignmentType, groupPosition]
    );
    await client.query(
      `INSERT INTO group_standings
         (id_group, id_user, played, won, lost, sets_for, sets_against, points_for, points_against,
          position, qualified_to_bracket, qualification_label)
       VALUES ($1, $2, 0, 0, 0, 0, 0, 0, 0, NULL, FALSE, NULL)`,
      [groupId, userId]
    );

    // Genera los partidos todos-contra-todos con quienes ya estaban en el grupo.
    const existingMembersRes = await client.query<{ id_user: string }>(
      `SELECT id_user FROM group_members WHERE id_group = $1 AND id_user <> $2`,
      [groupId, userId]
    );
    const matchInfoRes = await client.query<{ max_num: number | null; best_of_sets: number | null }>(
      `SELECT MAX(match_number) AS max_num, MIN(best_of_sets) AS best_of_sets
       FROM group_matches WHERE id_group = $1`,
      [groupId]
    );
    const bestOfSets = Number(matchInfoRes.rows[0]?.best_of_sets ?? 3) as 3 | 5 | 7;
    const newCount = currentCount + 1;
    let matchNumber = Number(matchInfoRes.rows[0]?.max_num ?? 0);

    for (const member of existingMembersRes.rows) {
      matchNumber++;
      await client.query(
        `INSERT INTO group_matches
           (id_group, id_tournament, id_category, stage, round_number, match_number,
            best_of_sets, player1_id, player2_id, status, source_note)
         VALUES ($1, $2, $3, 'group', 1, $4, $5, $6, $7, 'scheduled', $8)`,
        [
          groupId, tournamentId, categoryId, matchNumber, bestOfSets,
          userId, member.id_user,
          newCount === 2 ? "two_player_group" : "group_stage",
        ]
      );
    }

    await client.query(
      `UPDATE category_groups SET target_size = $1, group_kind = $2 WHERE id_group = $3`,
      [newCount, newCount === 2 ? "playoff_two" : "normal", groupId]
    );
  }

  // Agrega directamente a un jugador ya inscrito (qualification "group") a un
  // grupo puntual — para cuando el admin quiere sumar gente sin pasar por
  // "rearmar grupos" ni "mover jugador". Solo mientras la categoría siga en
  // fase "groups", el jugador no esté ya en otro grupo de la categoría y el
  // grupo destino tenga cupo (máximo 4).
  async addPlayerToGroup(params: {
    groupId: string;
    userId: string;
  }): Promise<{ added: true } | { added: false; error: BracketsError }> {
    const { groupId, userId } = params;

    return this.withTransaction(async (client) => {
      const groupRes = await client.query<{ id_tournament: string; id_category: string }>(
        `SELECT id_tournament, id_category FROM category_groups WHERE id_group = $1 FOR UPDATE`,
        [groupId]
      );
      const group = groupRes.rows[0];
      if (!group) return { added: false, error: "GROUP_NOT_FOUND" as BracketsError };

      const phaseRes = await client.query<{ phase: string }>(
        `SELECT phase FROM tournament_categories WHERE id_category = $1 FOR UPDATE`,
        [group.id_category]
      );
      if ((phaseRes.rows[0]?.phase ?? "enrollment") !== "groups") {
        return { added: false, error: "GROUPS_LOCKED" as BracketsError };
      }

      const enrolledRes = await client.query(
        `SELECT 1 FROM enrollments
         WHERE id_user = $1 AND id_tournament = $2 AND id_category = $3
           AND status = 'active' AND qualification_type = 'group'`,
        [userId, group.id_tournament, group.id_category]
      );
      if ((enrolledRes.rowCount ?? 0) === 0) {
        return { added: false, error: "PLAYER_NOT_ENROLLED" as BracketsError };
      }

      const alreadyInGroupRes = await client.query(
        `SELECT 1 FROM group_members gm
         JOIN category_groups cg ON cg.id_group = gm.id_group
         WHERE gm.id_user = $1 AND cg.id_category = $2`,
        [userId, group.id_category]
      );
      if ((alreadyInGroupRes.rowCount ?? 0) > 0) {
        return { added: false, error: "ALREADY_IN_A_GROUP" as BracketsError };
      }

      const countRes = await client.query<{ count: string }>(
        `SELECT COUNT(*)::int AS count FROM group_members WHERE id_group = $1`,
        [groupId]
      );
      const count = Number(countRes.rows[0]?.count ?? 0);
      if (count + 1 > 4) return { added: false, error: "TARGET_GROUP_FULL" as BracketsError };

      await this.addMemberToGroup(client, {
        groupId,
        tournamentId: group.id_tournament,
        categoryId: group.id_category,
        userId,
        seed: null,
        currentCount: count,
        assignmentType: "manual",
      });

      const ctxRes = await client.query<{
        tournament_name: string;
        category_type: string;
        category_range: string;
      }>(
        `SELECT t.tournament_name, tc.category_type, tc.category_range
         FROM tournaments t
         JOIN tournament_categories tc ON tc.id_category = $1
         WHERE t.id_tournament = $2`,
        [group.id_category, group.id_tournament]
      );
      const ctx = ctxRes.rows[0];
      if (ctx) {
        await this.notifications.create(
          {
            idUser: userId,
            type: "group_changed",
            title: "Te sumaron a un grupo",
            message: `Te agregaron al grupo de ${ctx.category_type} ${ctx.category_range} (${ctx.tournament_name}). Revisá tus partidos.`,
            idTournament: group.id_tournament,
            idCategory: group.id_category,
          },
          client
        );
      }

      return { added: true };
    });
  }

  // Árbitro sugerido/anotado para un partido puntual — no es un rol oficial,
  // así que no valida nada (puede ser cualquier inscrito, o limpiarse con null).
  async setGroupMatchReferee(matchId: string, refereeId: string | null): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE group_matches SET referee_id = $1 WHERE id_match = $2`,
      [refereeId, matchId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async setBracketMatchReferee(matchId: string, refereeId: string | null): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE bracket_matches SET referee_id = $1 WHERE id_match = $2`,
      [refereeId, matchId]
    );
    return (res.rowCount ?? 0) > 0;
  }
}
