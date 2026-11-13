import type { Pool, PoolClient } from "pg";
import DB from "../db/db_configuration";
import type { CompetitionPlayerInput, GeneratedGroupsResult } from "../group_generation_logic";
import { nextManualGroupName } from "../group_generation_logic";
import type { GeneratedBracketResult } from "../bracket_generation_logic";
import { NotificationsRepository } from "../notifications/notifications_repository";
import { ActivityLogRepository } from "../activity/activity_log_repository";
import { RANKING_POINTS_PER_WIN, RANKED_PLAYERS_CTE, LEGACY_WIN_POINTS_ENABLED } from "../ranking/ranking_repository";
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

// El árbitro puede no jugar en el campeonato (se agrega por correo): su nombre no
// está entre los jugadores de la categoría y hay que traerlo aparte.
// Clasificación de cada grupo para pasar a la llave, compartida por
// loadGroupQualifiers / loadGroupSilverPlayers / markGroupQualifiers.
// - Los que no vinieron ("No vino" en la mesa de control, o perdieron TODOS
//   sus partidos por no presentarse / W.O. doble) se sacan ANTES de numerar:
//   nunca clasifican y el siguiente del grupo sube a su puesto (antes el cupo
//   quedaba vacío y con la llave adelantada no se llenaba nunca).
// - group_number: el número del grupo (GR-7 → 7), que es el orden de siembra
//   de la serpentina. NO el orden de juego (sort_order), que el admin puede
//   cambiar en el fixture sin que eso deba tocar las semillas de la llave.
// Usa $1 = torneo y $2 = categoría.
const GROUP_RANKING_CTE = `
  ranked AS (
    SELECT
      gs.id_user,
      gs.id_group,
      cg.group_name,
      ROW_NUMBER() OVER (
        PARTITION BY gs.id_group
        ORDER BY gs.won DESC,
                 (gs.sets_for - gs.sets_against) DESC,
                 (gs.points_for - gs.points_against) DESC,
                 gs.id_user ASC
      ) AS rank_in_group,
      COALESCE(NULLIF(substring(cg.group_name from '[0-9]+'), '')::int, 100000 + cg.sort_order) AS group_number,
      cg.qualifiers_per_group AS qualifiers_per_group
    FROM group_standings gs
    JOIN category_groups cg ON cg.id_group = gs.id_group
    WHERE cg.id_tournament = $1 AND cg.id_category = $2
      AND NOT EXISTS (
        SELECT 1 FROM enrollments ea
         WHERE ea.id_user = gs.id_user AND ea.id_tournament = $1 AND ea.id_category = $2
           AND ea.status = 'active' AND ea.attendance = 'absent'
      )
      AND NOT (
        EXISTS (SELECT 1 FROM group_matches x
                 WHERE x.id_group = gs.id_group AND (x.player1_id = gs.id_user OR x.player2_id = gs.id_user))
        AND NOT EXISTS (
          SELECT 1 FROM group_matches x
           WHERE x.id_group = gs.id_group AND (x.player1_id = gs.id_user OR x.player2_id = gs.id_user)
             AND NOT (x.status = 'walkover' AND (COALESCE(x.result_reason, '') = 'double_no_show'
                   OR (COALESCE(x.result_reason, '') = 'no_show' AND x.winner_id IS DISTINCT FROM gs.id_user)))
        )
      )
  )`;
/** Un puesto de la llave al cambiar jugadores: su ocupante (jugador o cupo) y su rival. */
type SwapPosition = {
  id_match: string;
  round: number;
  match_number: number;
  slot: 1 | 2;
  player: string | null;
  sourceGroup: string | null;
  sourceRank: number | null;
  filledAt: string | null;
  unconfirmed: boolean;
  rival: string | null;
  rivalSourceGroup: string | null;
  live: boolean;
};

/** Puesto de la pre-llave o la primera ronda (ver bracketPositions). */
export type BracketPosition = {
  id_match: string;
  round: number;
  match_number: number;
  next_match_number: number | null;
  next_match_slot: 1 | 2 | null;
  slot: 1 | 2;
  player: string | null;
  source_group: string | null;
  source_rank: number | null;
  seed: number | null;
  locked: boolean;
};

const REFEREE_NAME_SQL = (alias: string) =>
  `(SELECT COALESCE(NULLIF(TRIM(COALESCE(r.first_name, '') || ' ' || COALESCE(r.last_name, '')), ''), r.email)
    FROM users r WHERE r.id_user = ${alias}.referee_id)`;

export type WithdrawalMatch = { id_match: string; player1_id: string; player2_id: string; best_of_sets: number };

export class BracketsRepository {
  private pool: Pool;
  notifications: NotificationsRepository;
  readonly activityLog: ActivityLogRepository;

  /** Dónde está un inscrito dentro de una categoría ya empezada: su grupo,
   *  cuántos partidos jugó y los que le quedan (de grupo y de llave). */
  async loadWithdrawalState(categoryId: string, userId: string) {
    const phase = (await this.pool.query(`SELECT phase FROM tournament_categories WHERE id_category = $1`, [categoryId])).rows[0]?.phase ?? null;
    const group = (
      await this.pool.query(
        `SELECT gm.id_group FROM group_members gm JOIN category_groups cg ON cg.id_group = gm.id_group
         WHERE cg.id_category = $1 AND gm.id_user = $2 LIMIT 1`,
        [categoryId, userId]
      )
    ).rows[0]?.id_group ?? null;
    const groupMatches = (
      await this.pool.query(
        `SELECT m.id_match, m.player1_id, m.player2_id, m.best_of_sets, m.status
         FROM group_matches m JOIN category_groups cg ON cg.id_group = m.id_group
         WHERE cg.id_category = $1 AND (m.player1_id = $2 OR m.player2_id = $2)`,
        [categoryId, userId]
      )
    ).rows;
    const bracketMatches = (
      await this.pool.query(
        `SELECT id_match, player1_id, player2_id, best_of_sets, status FROM bracket_matches
         WHERE id_category = $1 AND (player1_id = $2 OR player2_id = $2) AND winner_id IS NULL`,
        [categoryId, userId]
      )
    ).rows;
    return {
      phase: phase as string | null,
      idGroup: group as string | null,
      playedGroupMatches: groupMatches.filter((m: any) => m.status !== "scheduled").length,
      pendingGroupMatches: groupMatches.filter((m: any) => m.status === "scheduled") as WithdrawalMatch[],
      readyBracketMatches: bracketMatches.filter((m: any) => m.status === "ready") as WithdrawalMatch[],
      waitingBracketMatches: bracketMatches.filter((m: any) => m.status === "pending").length,
    };
  }

  /** Saca del todo a un inscrito que todavía no jugó en su grupo: sus
   *  partidos pendientes, su fila de la tabla, el grupo y la inscripción. */
  async removeUnplayedFromGroup(tournamentId: string, categoryId: string, userId: string, groupId: string | null): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (groupId) {
        await client.query(
          `DELETE FROM group_matches WHERE id_group = $1 AND status = 'scheduled' AND (player1_id = $2 OR player2_id = $2)`,
          [groupId, userId]
        );
        await client.query(`DELETE FROM group_standings WHERE id_group = $1 AND id_user = $2`, [groupId, userId]);
        await client.query(`DELETE FROM group_members WHERE id_group = $1 AND id_user = $2`, [groupId, userId]);
      }
      await client.query(
        `UPDATE enrollments SET status = 'cancelled'
         WHERE id_tournament = $1 AND id_category = $2 AND id_user = $3 AND status = 'active'`,
        [tournamentId, categoryId, userId]
      );
      const ctx = (
        await client.query(
          `SELECT t.tournament_name, tc.category_type, tc.category_range
           FROM tournaments t JOIN tournament_categories tc ON tc.id_category = $1
           WHERE t.id_tournament = $2`,
          [categoryId, tournamentId]
        )
      ).rows[0];
      if (ctx) {
        await this.notifications.create(
          {
            idUser: userId,
            type: "enrollment_removed",
            title: "Inscripción cancelada",
            message: `El organizador te sacó de ${ctx.category_type} ${ctx.category_range} (${ctx.tournament_name})`,
            idTournament: tournamentId,
            idCategory: categoryId,
          },
          client
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

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
  async isRoundRobinCategory(categoryId: string): Promise<boolean> {
    const res = await this.pool.query<{ competition_format: string }>(
      `SELECT competition_format FROM tournament_categories WHERE id_category = $1`,
      [categoryId]
    );
    return res.rows[0]?.competition_format === "round_robin";
  }

  // Categoría Oro (tiene una Plata hermana): sus grupos se arman siempre de
  // a 4 (2 clasifican a la llave de Oro, 2 pasan a Plata) — ver
  // buildGroupPlan(..., preferFours).
  async isGoldCategory(categoryId: string): Promise<boolean> {
    const res = await this.pool.query<{ silver_category_id: string | null }>(
      `SELECT silver_category_id FROM tournament_categories WHERE id_category = $1`,
      [categoryId]
    );
    return res.rows[0]?.silver_category_id != null;
  }

  // Rearmar una categoría Oro respeta cómo estaba armada: Oro y Plata también
  // se puede activar con grupos de 3 ya confirmados, y rearmar no debe
  // pasarlos a grupos de 4.
  async groupsMostlyFours(categoryId: string): Promise<boolean> {
    const res = await this.pool.query<{ fours: number; threes: number }>(
      `SELECT count(*) FILTER (WHERE target_size = 4)::int AS fours,
              count(*) FILTER (WHERE target_size = 3)::int AS threes
       FROM category_groups WHERE id_category = $1`,
      [categoryId]
    );
    const row = res.rows[0];
    return !!row && row.fours >= row.threes;
  }

  // Jugador que sobró al armar grupos de 4 en una categoría Oro (ver
  // group_generation_logic.ts generateGroupsFromPlayers): queda enrolado en
  // la MISMA categoría pero sin jugar grupo — pasa directo a la llave
  // (loadSeededPlayers ya suma loadDirectEntryPlayers a los clasificados de
  // grupo al armar el sorteo).
  async markDirectAdvance(tournamentId: string, categoryId: string, userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    await this.pool.query(
      `UPDATE enrollments SET qualification_type = 'direct_advance', checked_in = true
       WHERE id_tournament = $1 AND id_category = $2 AND id_user = ANY($3::uuid[])`,
      [tournamentId, categoryId, userIds]
    );
    const ctxRes = await this.pool.query<{ tournament_name: string; category_type: string; category_range: string }>(
      `SELECT t.tournament_name, tc.category_type, tc.category_range
       FROM tournaments t
       JOIN tournament_categories tc ON tc.id_category = $1
       WHERE t.id_tournament = $2`,
      [categoryId, tournamentId]
    );
    const ctx = ctxRes.rows[0];
    if (ctx) {
      for (const userId of userIds) {
        await this.notifications.create({
          idUser: userId,
          type: "enrollment_confirmed",
          title: "Pasas directo a la llave",
          message: `No quedaste en ningún grupo (sobraste al armar grupos de 4) de ${ctx.category_type} ${ctx.category_range} (${ctx.tournament_name}): pasas directo a la llave, sin jugar fase de grupos.`,
          idTournament: tournamentId,
          idCategory: categoryId,
        });
      }
    }
  }

  // Deshacer un resultado de un grupo único ya cerrado lo vuelve a abrir.
  async reopenRoundRobinCategory(categoryId: string): Promise<void> {
    await this.pool.query(
      `UPDATE tournament_categories SET phase = 'groups'
       WHERE id_category = $1 AND phase = 'finished' AND competition_format = 'round_robin'`,
      [categoryId]
    );
  }

  async getCategoryQualifiersPerGroup(categoryId: string): Promise<number> {
    const res = await this.pool.query<{ qualifiers_per_group: number }>(
      `SELECT qualifiers_per_group FROM tournament_categories WHERE id_category = $1`,
      [categoryId]
    );
    return Number(res.rows[0]?.qualifiers_per_group ?? 2);
  }

  async categoryHasSilver(categoryId: string): Promise<boolean> {
    const res = await this.pool.query<{ silver_category_id: string | null }>(
      `SELECT silver_category_id FROM tournament_categories WHERE id_category = $1`,
      [categoryId]
    );
    return !!res.rows[0]?.silver_category_id;
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
      LEFT JOIN clubs cl ON cl.id_club = COALESCE(e.club_override, u.id_club)
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
          group.sort_order, group.status, group.group_kind, group.qualifiers_override ?? qualifiersPerGroup,
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
            best_of_sets, points_per_set, player1_id, player2_id, status, source_note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          id_group, tournamentId, categoryId, match.stage, match.round_number,
          match.match_number, match.best_of_sets, match.points_per_set, match.player1_id,
          match.player2_id, match.status, match.source_note,
        ]
      );
    }
  }

  // El chequeo "GROUPS_ALREADY_EXIST" en generateGroups (service) es solo
  // un fail-fast antes de correr el algoritmo — la verificación que
  // realmente cuenta es esta de acá: bloquea la fila de la categoría
  // (mismo patrón que createManualGroup/addPlayerToGroup/moveGroupMember)
  // y recién ahí vuelve a chequear si ya hay grupos, todo en la misma
  // transacción del INSERT. Sin esto, dos "Confirmar grupos" casi
  // simultáneos (doble clic, o dos admins) podían pasar los dos el
  // chequeo de afuera antes de que cualquiera escribiera, y terminar
  // creando dos juegos de grupos duplicados para la misma categoría —
  // category_groups no tiene ningún UNIQUE que lo evite a nivel de base.
  async persistGroups(
    tournamentId: string,
    categoryId: string,
    result: GeneratedGroupsResult,
    qualifiersPerGroup: number
  ): Promise<{ persisted: true } | { persisted: false; error: "GROUPS_ALREADY_EXIST" }> {
    return this.withTransaction(async (client) => {
      await client.query(`SELECT 1 FROM tournament_categories WHERE id_category = $1 FOR UPDATE`, [categoryId]);

      const existsRes = await client.query(
        `SELECT 1 FROM category_groups WHERE id_tournament = $1 AND id_category = $2 LIMIT 1`,
        [tournamentId, categoryId]
      );
      if ((existsRes.rowCount ?? 0) > 0) {
        return { persisted: false, error: "GROUPS_ALREADY_EXIST" as const };
      }

      await this.insertGroupsData(client, tournamentId, categoryId, result, qualifiersPerGroup);
      return { persisted: true as const };
    });
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
                u.first_name, u.last_name, u.email, u.avatar_url, cl.name AS club_name,
                cl.crest_image_url AS club_crest_url,
                EXTRACT(YEAR FROM AGE(u.birth_date::date))::int AS age,
                e.attendance
         FROM group_members gm
         JOIN category_groups cg ON cg.id_group = gm.id_group
         JOIN users u ON u.id_user = gm.id_user
         LEFT JOIN enrollments e
           ON e.id_user = gm.id_user AND e.id_tournament = cg.id_tournament AND e.id_category = cg.id_category
         LEFT JOIN clubs cl ON cl.id_club = COALESCE(e.club_override, u.id_club)
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
                gm.best_of_sets, gm.points_per_set, gm.player1_id, gm.player2_id, gm.winner_id,
                gm.sets_player1, gm.sets_player2, gm.status, gm.source_note, gm.table_number,
                gm.played_table_number, gm.set_scores, gm.result_reason, gm.referee_id,
                ${REFEREE_NAME_SQL("gm")} AS referee_name
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
              best_of_sets, points_per_set, player1_id, player2_id, winner_id,
              sets_player1, sets_player2, status, source_note, set_scores, result_reason, played_table_number
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

  // Torneos "no puntuables" (is_ranked = FALSE) siguen jugándose y sumando
  // matches_played/won/lost normal -- solo no reparten ranking_points, para
  // no ensuciar el ranking público con partidos de prueba/amistosos aunque
  // el torneo sea visible. Independiente de `visibility`: un torneo privado
  // puede seguir siendo puntuable.
  private async isTournamentRanked(client: PoolClient, tournamentId: string): Promise<boolean> {
    const res = await client.query<{ is_ranked: boolean }>(
      `SELECT is_ranked FROM tournaments WHERE id_tournament = $1`,
      [tournamentId]
    );
    return res.rows[0]?.is_ranked ?? true;
  }

  // Dobles: un "usuario equipo" es el participante en el grupo/llave, pero
  // las estadísticas globales y los puntos de ranking se le acreditan a los
  // DOS jugadores reales de la pareja (el usuario equipo nunca entra a
  // player_stats). En singles devuelve al mismo jugador.
  private async statTargets(client: PoolClient, participantId: string): Promise<string[]> {
    const res = await client.query<{ id_player_1: string; id_player_2: string }>(
      `SELECT id_player_1, id_player_2 FROM doubles_teams WHERE id_user = $1`,
      [participantId]
    );
    const row = res.rows[0];
    return row ? [row.id_player_1, row.id_player_2] : [participantId];
  }

  private async creditWinnerStats(
    client: PoolClient, participantId: string, setsFor: number, setsAgainst: number, pointsAwarded: number
  ): Promise<void> {
    for (const id of await this.statTargets(client, participantId)) {
      await client.query(
        `INSERT INTO player_stats (id_user, matches_played, matches_won, matches_lost, sets_won, sets_lost, ranking_points)
         VALUES ($1, 1, 1, 0, $2, $3, $4)
         ON CONFLICT (id_user) DO UPDATE SET
           matches_played = player_stats.matches_played + 1,
           matches_won    = player_stats.matches_won + 1,
           sets_won       = player_stats.sets_won + EXCLUDED.sets_won,
           sets_lost      = player_stats.sets_lost + EXCLUDED.sets_lost,
           ranking_points = player_stats.ranking_points + $4,
           updated_at     = NOW()`,
        [id, setsFor, setsAgainst, pointsAwarded]
      );
    }
  }

  private async creditLoserStats(
    client: PoolClient, participantId: string, setsFor: number, setsAgainst: number
  ): Promise<void> {
    for (const id of await this.statTargets(client, participantId)) {
      await client.query(
        `INSERT INTO player_stats (id_user, matches_played, matches_won, matches_lost, sets_won, sets_lost)
         VALUES ($1, 1, 0, 1, $2, $3)
         ON CONFLICT (id_user) DO UPDATE SET
           matches_played = player_stats.matches_played + 1,
           matches_lost   = player_stats.matches_lost + 1,
           sets_won       = player_stats.sets_won + EXCLUDED.sets_won,
           sets_lost      = player_stats.sets_lost + EXCLUDED.sets_lost,
           updated_at     = NOW()`,
        [id, setsFor, setsAgainst]
      );
    }
  }

  // Revierte en player_stats TODO lo que este torneo acreditó — se llama
  // desde AdminTournamentRepository.deleteTournament justo antes del DELETE
  // en cascada. player_stats es la única tabla que NO cuelga del torneo por
  // FK (es un acumulado global de carrera por jugador), así que borrar el
  // torneo sin esto dejaba matches_played/won/lost/sets/ranking_points de
  // sus partidos para siempre, sin ningún rastro de dónde salieron. No hace
  // falta caminar la cadena de avance de llave (a diferencia de
  // undoBracketMatchResult): acá se borra el cuadro entero igual, así que
  // no hay nada que "desenganchar" de un partido siguiente — solo revertir
  // los números. Los BYE nunca acreditan stats (ver advanceBracketWinner),
  // así que no hace falta tocarlos.
  // Motivo de un resultado no jugado (ver 060). Se escribe después de
  // recordMatchResult/recordBracketResult; null = partido jugado normal.
  async setResultReason(kind: "group" | "bracket", matchId: string, reason: string | null): Promise<void> {
    const table = kind === "group" ? "group_matches" : "bracket_matches";
    await this.pool.query(`UPDATE ${table} SET result_reason = $1 WHERE id_match = $2`, [reason, matchId]);
  }

  /**
   * Intercambia de lugar dos puestos de la llave que aún no se juegan, de
   * cualquier ronda. Cada lado es un jugador (su id) o, con la llave
   * adelantada, un cupo que todavía no se llena ("slot:<grupo>:<puesto>"):
   * así la mesa de control puede ir acomodando la llave a medida que terminan
   * los grupos. Se mueve el ocupante con su origen (de qué grupo y puesto
   * viene); la semilla es del PUESTO y queda donde estaba.
   *
   * Sin `confirm`, si el cambio deja a alguien frente a uno de su mismo grupo
   * o de su mismo club en su próximo partido, no cambia nada y devuelve los
   * avisos para que el admin confirme.
   */
  async swapBracketPlayers(params: {
    tournamentId: string;
    categoryId: string;
    userA: string;
    userB: string;
    confirm?: boolean;
    requestedBy?: string;
  }): Promise<
    | { swapped: true }
    | { swapped: false; error: "SAME_PLAYER" | "NOT_IN_BRACKET" | "DIFFERENT_ROUND" | "MATCH_LIVE" }
    | { swapped: false; error: "NEEDS_CONFIRM"; warnings: string[] }
  > {
    const { tournamentId, categoryId, userA, userB } = params;
    if (userA === userB) return { swapped: false, error: "SAME_PLAYER" };
    return this.withTransaction(async (client) => {
      const a = await this.findSwapPosition(client, tournamentId, categoryId, userA);
      const b = await this.findSwapPosition(client, tournamentId, categoryId, userB);
      if (!a || !b) return { swapped: false, error: "NOT_IN_BRACKET" as const };
      // Se permite entre rondas distintas (p. ej. uno de pre-llave con uno de la llave).
      if (a.live || b.live) return { swapped: false, error: "MATCH_LIVE" as const };

      if (!params.confirm) {
        const warnings = await this.swapWarnings(client, tournamentId, categoryId, [
          { occupant: b, into: a },
          { occupant: a, into: b },
        ]);
        if (warnings.length > 0) return { swapped: false, error: "NEEDS_CONFIRM" as const, warnings };
      }

      const put = (s: SwapPosition, from: SwapPosition) =>
        client.query(
          s.slot === 1
            ? `UPDATE bracket_matches SET player1_id = $2, player1_source_group = $3, player1_source_rank = $4, player1_filled_at = $5, player1_unconfirmed = $6 WHERE id_match = $1`
            : `UPDATE bracket_matches SET player2_id = $2, player2_source_group = $3, player2_source_rank = $4, player2_filled_at = $5, player2_unconfirmed = $6 WHERE id_match = $1`,
          [s.id_match, from.player, from.sourceGroup, from.sourceRank, from.filledAt, from.unconfirmed]
        );
      await put(a, b);
      await put(b, a);
      // Estado: con los dos jugadores el partido queda listo; con un cupo vacío, pendiente.
      await client.query(
        `UPDATE bracket_matches
            SET status = CASE WHEN player1_id IS NOT NULL AND player2_id IS NOT NULL
                                AND NOT player1_unconfirmed AND NOT player2_unconfirmed THEN 'ready' ELSE 'pending' END
          WHERE id_match = ANY($1::uuid[]) AND status IN ('pending', 'ready')`,
        [[a.id_match, b.id_match]]
      );
      const players = [a.player, b.player].filter((p): p is string => !!p);
      if (a.player && b.player) {
        // Si alguno llegó a su partido por BYE, ese BYE pasa a nombre del otro.
        await client.query(
          `UPDATE bracket_matches
              SET player1_id = CASE WHEN player1_id = $3 THEN $4::uuid WHEN player1_id = $4 THEN $3::uuid ELSE player1_id END,
                  player2_id = CASE WHEN player2_id = $3 THEN $4::uuid WHEN player2_id = $4 THEN $3::uuid ELSE player2_id END,
                  winner_id  = CASE WHEN winner_id  = $3 THEN $4::uuid WHEN winner_id  = $4 THEN $3::uuid ELSE winner_id END
            WHERE id_tournament = $1 AND id_category = $2 AND status = 'bye'
              AND ($3 IN (player1_id, player2_id) OR $4 IN (player1_id, player2_id))`,
          [tournamentId, categoryId, a.player, b.player]
        );
      }
      // Si era árbitro del partido al que ahora entra a jugar, deja de serlo.
      await client.query(
        `UPDATE bracket_matches SET referee_id = NULL
          WHERE id_match = ANY($1::uuid[]) AND referee_id IN (player1_id, player2_id)`,
        [[a.id_match, b.id_match]]
      );
      if (players.length > 0) {
        await this.notifications.createForMany(
          players,
          {
            type: "next_match_ready",
            title: "Cambió tu partido en la llave",
            message: "El organizador te cambió de lugar en la llave. Revisa contra quién juegas.",
            idTournament: tournamentId,
            idCategory: categoryId,
            matchType: "bracket",
          },
          client
        );
      }
      if (params.requestedBy) {
        await this.activityLog.record(
          tournamentId,
          params.requestedBy,
          "bracket_players_swapped",
          `${await this.positionName(client, a)} ↔ ${await this.positionName(client, b)}${params.confirm ? " (con aviso confirmado)" : ""}`,
          client
        );
      }
      return { swapped: true as const };
    });
  }

  /** Puesto de la llave sin jugar de un jugador (su primer partido pendiente) o de un cupo "slot:<grupo>:<puesto>". */
  private async findSwapPosition(
    client: PoolClient,
    tournamentId: string,
    categoryId: string,
    ref: string
  ): Promise<SwapPosition | null> {
    const slotRef = /^slot:([0-9a-f-]{36}):(\d+)$/i.exec(ref);
    const r = await client.query<{
      id_match: string;
      round: number;
      match_number: number;
      player1_id: string | null;
      player2_id: string | null;
      player1_source_group: string | null;
      player1_source_rank: number | null;
      player2_source_group: string | null;
      player2_source_rank: number | null;
      player1_filled_at: string | null;
      player2_filled_at: string | null;
      player1_unconfirmed: boolean;
      player2_unconfirmed: boolean;
      live: boolean;
    }>(
      `SELECT id_match, round, match_number, player1_id, player2_id,
              player1_source_group, player1_source_rank, player2_source_group, player2_source_rank,
              player1_filled_at, player2_filled_at, player1_unconfirmed, player2_unconfirmed,
              (set_scores IS NOT NULL OR table_number IS NOT NULL) AS live
         FROM bracket_matches
        WHERE id_tournament = $1 AND id_category = $2
          AND status IN ('pending', 'ready') AND NOT is_bye
          AND (${
            slotRef
              ? `(player1_id IS NULL AND player1_source_group = $3::uuid AND player1_source_rank = $4)
                 OR (player2_id IS NULL AND player2_source_group = $3::uuid AND player2_source_rank = $4)`
              : `player1_id = $3::uuid OR player2_id = $3::uuid`
          })
        ORDER BY round ASC
        LIMIT 1
        FOR UPDATE`,
      slotRef ? [tournamentId, categoryId, slotRef[1], Number(slotRef[2])] : [tournamentId, categoryId, ref]
    );
    const m = r.rows[0];
    if (!m) return null;
    const isOne = slotRef
      ? m.player1_id === null && m.player1_source_group === slotRef[1] && Number(m.player1_source_rank) === Number(slotRef[2])
      : m.player1_id === ref;
    const slot: 1 | 2 = isOne ? 1 : 2;
    return {
      id_match: m.id_match,
      round: m.round,
      match_number: m.match_number,
      slot,
      player: slot === 1 ? m.player1_id : m.player2_id,
      sourceGroup: slot === 1 ? m.player1_source_group : m.player2_source_group,
      sourceRank: slot === 1 ? m.player1_source_rank : m.player2_source_rank,
      filledAt: slot === 1 ? m.player1_filled_at : m.player2_filled_at,
      unconfirmed: slot === 1 ? m.player1_unconfirmed : m.player2_unconfirmed,
      rival: slot === 1 ? m.player2_id : m.player1_id,
      rivalSourceGroup: slot === 1 ? m.player2_source_group : m.player1_source_group,
      live: m.live,
    };
  }

  /** "Juan Pérez" o "cupo 2° GR-12" (para el historial y los avisos). */
  private async positionName(client: PoolClient, p: SwapPosition): Promise<string> {
    if (p.player) {
      const r = await client.query<{ n: string }>(
        `SELECT TRIM(CONCAT(first_name, ' ', last_name)) AS n FROM users WHERE id_user = $1`,
        [p.player]
      );
      return r.rows[0]?.n ?? "un jugador";
    }
    const g = await client.query<{ group_name: string }>(`SELECT group_name FROM category_groups WHERE id_group = $1`, [
      p.sourceGroup,
    ]);
    return `cupo ${p.sourceRank}° ${g.rows[0]?.group_name ?? ""}`.trim();
  }

  /**
   * Avisos de un cambio de lugar en la llave: contra quién quedaría cada uno
   * en su próximo partido (el rival que ya está, o los que juegan el partido
   * que define a ese rival) y si es de su mismo grupo o de su mismo club. Un
   * cupo sin llenar avisa si quedaría contra alguien de su mismo grupo.
   */
  private async swapWarnings(
    client: PoolClient,
    tournamentId: string,
    categoryId: string,
    moves: Array<{ occupant: SwapPosition; into: SwapPosition }>
  ): Promise<string[]> {
    const warnings: string[] = [];
    // Grupo de cada jugador en esta categoría (o en el Oro, si esta es la Plata).
    const groupOf = async (userId: string): Promise<string | null> => {
      const r = await client.query<{ id_group: string }>(
        `SELECT g1.id_group FROM group_members g1
           JOIN category_groups cg ON cg.id_group = g1.id_group
           LEFT JOIN tournament_categories tc ON tc.id_category = cg.id_category
          WHERE g1.id_user = $1 AND cg.id_tournament = $2 AND (cg.id_category = $3 OR tc.silver_category_id = $3)
          LIMIT 1`,
        [userId, tournamentId, categoryId]
      );
      return r.rows[0]?.id_group ?? null;
    };
    for (const { occupant, into } of moves) {
      const otherMove = moves.find((m) => m.into !== into)!;
      const other = otherMove.into; // el puesto que deja
      const otherOccupant = otherMove.occupant; // quien llega al puesto que deja
      // Rivales en el puesto nuevo: { jugador | null, grupo }.
      type Rival = { player: string | null; group: string | null };
      let rivals: Rival[] = [];
      if (into.rival || into.rivalSourceGroup) {
        const same = into.rival !== null && into.rival === occupant.player;
        rivals = same ? [] : [{ player: into.rival, group: into.rival ? await groupOf(into.rival) : into.rivalSourceGroup }];
        if (into.id_match === other.id_match) rivals = []; // los dos en el mismo partido: siguen enfrentados
      } else {
        const feeder = await client.query<{ player1_id: string | null; player2_id: string | null }>(
          `SELECT player1_id, player2_id FROM bracket_matches
            WHERE id_tournament = $1 AND id_category = $2 AND next_round = $3 AND next_match_number = $4
              AND next_match_slot = $5`,
          [tournamentId, categoryId, into.round, into.match_number, into.slot === 1 ? 2 : 1]
        );
        for (const f of feeder.rows) {
          for (const p of [f.player1_id, f.player2_id]) {
            if (!p) continue;
            // Después del cambio: donde estaba el que se mueve queda el otro, y
            // viceversa (antes se tomaba al mismo jugador como su propio rival).
            let who: string | null = p;
            if (p === occupant.player) who = otherOccupant.player;
            else if (p === otherOccupant.player) who = occupant.player;
            if (who && who !== occupant.player) rivals.push({ player: who, group: await groupOf(who) });
          }
        }
      }
      const myGroup = occupant.player ? await groupOf(occupant.player) : occupant.sourceGroup;
      const myName = await this.positionName(client, occupant);
      for (const rv of rivals) {
        const rivalName = rv.player
          ? await this.positionName(client, { ...occupant, player: rv.player })
          : "un cupo de su mismo grupo";
        if (myGroup && rv.group && myGroup === rv.group) {
          warnings.push(`${myName} quedaría contra ${rivalName}, que estuvo en su mismo grupo`);
          continue;
        }
        if (occupant.player && rv.player) {
          const c = await client.query<{ same: boolean }>(
            `SELECT (a.id_club IS NOT NULL AND a.id_club = b.id_club) AS same FROM users a, users b
              WHERE a.id_user = $1 AND b.id_user = $2`,
            [occupant.player, rv.player]
          );
          if (c.rows[0]?.same) warnings.push(`${myName} quedaría contra ${rivalName}, de su mismo club`);
        }
      }
    }
    return warnings;
  }

  /**
   * Puestos de la pre-llave y la primera ronda (los primeros partidos de cada
   * uno). locked = ya no se puede mover (jugado, en vivo o en una mesa).
   */
  async bracketPositions(tournamentId: string, categoryId: string): Promise<BracketPosition[]> {
    const r = await this.pool.query<BracketPosition>(
      `SELECT bm.id_match, bm.round, bm.match_number, bm.next_match_number, bm.next_match_slot, s.slot,
              CASE s.slot WHEN 1 THEN bm.player1_id ELSE bm.player2_id END AS player,
              CASE s.slot WHEN 1 THEN bm.player1_source_group ELSE bm.player2_source_group END AS source_group,
              CASE s.slot WHEN 1 THEN bm.player1_source_rank ELSE bm.player2_source_rank END AS source_rank,
              CASE s.slot WHEN 1 THEN bm.seed1 ELSE bm.seed2 END AS seed,
              (bm.status NOT IN ('pending', 'ready') OR bm.is_bye OR bm.set_scores IS NOT NULL
                 OR bm.table_number IS NOT NULL) AS locked
         FROM bracket_matches bm CROSS JOIN (VALUES (1), (2)) AS s(slot)
        WHERE bm.id_tournament = $1 AND bm.id_category = $2 AND bm.round IN (0, 1)
        ORDER BY bm.round, bm.match_number, s.slot`,
      [tournamentId, categoryId]
    );
    return r.rows.map((x) => ({ ...x, source_rank: x.source_rank === null ? null : Number(x.source_rank) }));
  }

  /** Nombre, club, grupo y puesto con que clasificó cada jugador (grupo del Oro si es la Plata). */
  async bracketPlayerInfo(
    tournamentId: string,
    categoryId: string,
    ids: string[]
  ): Promise<Map<string, { name: string; club: string | null; clubName: string | null; group: string | null; label: string | null }>> {
    const r = await this.pool.query<{
      id_user: string;
      name: string;
      id_club: string | null;
      club_name: string | null;
      id_group: string | null;
      label: string | null;
    }>(
      `SELECT u.id_user, TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS name, u.id_club, c.name AS club_name,
              g.id_group, gs.qualification_label AS label
         FROM users u
         LEFT JOIN clubs c ON c.id_club = u.id_club
         LEFT JOIN LATERAL (
           SELECT gm.id_group FROM group_members gm
             JOIN category_groups cg ON cg.id_group = gm.id_group
             LEFT JOIN tournament_categories tc ON tc.id_category = cg.id_category
            WHERE gm.id_user = u.id_user AND cg.id_tournament = $1 AND (cg.id_category = $2 OR tc.silver_category_id = $2)
            LIMIT 1
         ) g ON TRUE
         LEFT JOIN group_standings gs ON gs.id_group = g.id_group AND gs.id_user = u.id_user
        WHERE u.id_user = ANY($3::uuid[])`,
      [tournamentId, categoryId, ids]
    );
    return new Map(
      r.rows.map((x) => [x.id_user, { name: x.name, club: x.id_club, clubName: x.club_name, group: x.id_group, label: x.label }])
    );
  }

  async groupNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const r = await this.pool.query<{ id_group: string; group_name: string }>(
      `SELECT id_group, group_name FROM category_groups WHERE id_group = ANY($1::uuid[])`,
      [ids]
    );
    return new Map(r.rows.map((x) => [x.id_group, x.group_name]));
  }

  /**
   * Llave adelantada: la mesa de control acepta cómo entraron los
   * clasificados de un grupo. Sus partidos quedan listos (si ya tienen a los
   * dos jugadores y nadie más está por confirmar). Devuelve cuántos confirmó.
   */
  async confirmGroupEntry(tournamentId: string, categoryId: string, groupId: string): Promise<number> {
    return this.withTransaction(async (client) => {
      let n = 0;
      for (const slot of ["player1", "player2"]) {
        const r = await client.query(
          `UPDATE bracket_matches SET ${slot}_unconfirmed = FALSE
            WHERE id_tournament = $1 AND id_category = $2 AND ${slot}_source_group = $3 AND ${slot}_unconfirmed`,
          [tournamentId, categoryId, groupId]
        );
        n += r.rowCount ?? 0;
      }
      await client.query(
        `UPDATE bracket_matches SET status = 'ready'
          WHERE id_tournament = $1 AND id_category = $2 AND status = 'pending' AND NOT is_bye
            AND player1_id IS NOT NULL AND player2_id IS NOT NULL
            AND NOT player1_unconfirmed AND NOT player2_unconfirmed`,
        [tournamentId, categoryId]
      );
      return n;
    });
  }

  /**
   * Llave adelantada: para cada grupo sin terminar, el club de quien hoy va en
   * cada puesto (por resultados; sin resultados, por sembrado). Se usa como
   * estimación del club de sus cupos al sortear: casi siempre clasifican los
   * favoritos, así el sorteo puede separar clubes también ahí.
   */
  async estimatedGroupClubs(groupIds: string[]): Promise<Map<string, Map<number, string | null>>> {
    const out = new Map<string, Map<number, string | null>>();
    if (groupIds.length === 0) return out;
    const r = await this.pool.query<{ id_group: string; pos: number; id_club: string | null }>(
      `SELECT gm.id_group, u.id_club,
              ROW_NUMBER() OVER (
                PARTITION BY gm.id_group
                ORDER BY COALESCE(gs.won, 0) DESC,
                         COALESCE(gs.sets_for - gs.sets_against, 0) DESC,
                         COALESCE(gs.points_for - gs.points_against, 0) DESC,
                         gm.group_position ASC NULLS LAST, gm.id_user ASC
              ) AS pos
         FROM group_members gm
         JOIN users u ON u.id_user = gm.id_user
         LEFT JOIN group_standings gs ON gs.id_group = gm.id_group AND gs.id_user = gm.id_user
        WHERE gm.id_group = ANY($1::uuid[])`,
      [groupIds]
    );
    for (const row of r.rows) {
      const m = out.get(row.id_group) ?? new Map<number, string | null>();
      m.set(Number(row.pos), row.id_club);
      out.set(row.id_group, m);
    }
    return out;
  }

  /** Cupos de un grupo en la llave adelantada: quién los ocupa y de qué puesto son. */
  async groupSourcePositions(groupId: string): Promise<Array<{ id_category: string; player: string | null; rank: number }>> {
    const r = await this.pool.query<{ id_category: string; player: string | null; rank: number }>(
      `SELECT id_category, player1_id AS player, player1_source_rank AS rank FROM bracket_matches WHERE player1_source_group = $1
       UNION ALL
       SELECT id_category, player2_id, player2_source_rank FROM bracket_matches WHERE player2_source_group = $1`,
      [groupId]
    );
    return r.rows.map((x) => ({ ...x, rank: Number(x.rank) }));
  }

  /** ¿Algún jugador de este grupo ya jugó (o ganó por W.O.) un partido de la llave de Oro o de Plata? */
  async groupMembersPlayedInBracket(groupId: string): Promise<boolean> {
    const r = await this.pool.query(
      `SELECT 1
         FROM category_groups cg
         JOIN tournament_categories tc ON tc.id_category = cg.id_category
         JOIN group_members gm ON gm.id_group = cg.id_group
         JOIN bracket_matches bm ON bm.id_tournament = cg.id_tournament
                                AND bm.id_category IN (cg.id_category, tc.silver_category_id)
        WHERE cg.id_group = $1 AND bm.status IN ('played', 'walkover') AND NOT bm.is_bye
          AND gm.id_user IN (bm.player1_id, bm.player2_id)
        LIMIT 1`,
      [groupId]
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** De [ids], los que ya jugaron (o ganaron por W.O.) un partido de la llave de [categoryId]. */
  async playersWithPlayedBracketMatch(categoryId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const r = await this.pool.query<{ id_user: string }>(
      `SELECT DISTINCT u.id AS id_user
         FROM unnest($2::uuid[]) AS u(id)
         JOIN bracket_matches bm ON bm.id_category = $1 AND u.id IN (bm.player1_id, bm.player2_id)
        WHERE bm.status IN ('played', 'walkover') AND NOT bm.is_bye`,
      [categoryId, ids]
    );
    return r.rows.map((x) => x.id_user);
  }

  /** Plata (se arma por inscripción): el que sale deja de estar inscrito y el que entra queda inscrito. */
  async swapSilverEnrollment(tournamentId: string, silverCategoryId: string, outUser: string, inUser: string): Promise<void> {
    await this.pool.query(
      `UPDATE enrollments SET status = 'cancelled'
        WHERE id_tournament = $1 AND id_category = $2 AND id_user = $3 AND status = 'active'`,
      [tournamentId, silverCategoryId, outUser]
    );
    await this.pool.query(
      `INSERT INTO enrollments (id_user, id_tournament, id_category, status, attendance, checked_in, qualification_type)
       VALUES ($3, $1, $2, 'active', 'present', true, 'direct_advance')
       ON CONFLICT (id_user, id_tournament, id_category)
       DO UPDATE SET status = 'active', attendance = 'present', checked_in = true, qualification_type = 'direct_advance'`,
      [tournamentId, silverCategoryId, inUser]
    );
  }

  /**
   * Cambia jugadores en la llave según [moves] (de → a), en todos los partidos
   * que aún no se juegan (incluido un BYE y el partido al que ese BYE lo hizo
   * avanzar), conservando cupo y siembra. Un solo UPDATE: así también sirve
   * para dos que solo cambian de lugar entre sí (A→B y B→A).
   */
  async replaceInUnplayedBracket(tournamentId: string, categoryId: string, moves: Array<{ from: string; to: string }>): Promise<void> {
    if (moves.length === 0) return;
    const from = moves.map((m) => m.from);
    const to = moves.map((m) => m.to);
    const mapped = (col: string) =>
      `COALESCE((SELECT m.t FROM unnest($3::uuid[], $4::uuid[]) AS m(f, t) WHERE m.f = ${col}), ${col})`;
    await this.pool.query(
      `UPDATE bracket_matches
          SET player1_id = ${mapped("player1_id")},
              player2_id = ${mapped("player2_id")},
              winner_id  = CASE WHEN status = 'bye' THEN ${mapped("winner_id")} ELSE winner_id END,
              referee_id = CASE WHEN referee_id = ANY($4::uuid[]) THEN NULL ELSE referee_id END
        WHERE id_tournament = $1 AND id_category = $2 AND status IN ('pending', 'ready', 'bye')
          AND (player1_id = ANY($3::uuid[]) OR player2_id = ANY($3::uuid[]))`,
      [tournamentId, categoryId, from, to]
    );
  }

  /** Vuelve a marcar quién clasificó en un grupo (después de corregir un resultado). */
  async remarkGroupQualifiers(tournamentId: string, categoryId: string, groupId: string): Promise<void> {
    await this.pool.query(
      `UPDATE group_standings SET qualified_to_bracket = FALSE, qualification_label = NULL WHERE id_group = $1`,
      [groupId]
    );
    await this.markGroupQualifiers(tournamentId, categoryId, [groupId]);
  }

  async getSilverCategoryId(categoryId: string): Promise<string | null> {
    const r = await this.pool.query<{ silver_category_id: string | null }>(
      `SELECT silver_category_id FROM tournament_categories WHERE id_category = $1`,
      [categoryId]
    );
    return r.rows[0]?.silver_category_id ?? null;
  }

  /** Si [categoryId] es la Plata de otra categoría, esa categoría (el Oro). */
  async getGoldCategoryId(categoryId: string): Promise<string | null> {
    const r = await this.pool.query<{ id_category: string }>(
      `SELECT id_category FROM tournament_categories WHERE silver_category_id = $1 LIMIT 1`,
      [categoryId]
    );
    return r.rows[0]?.id_category ?? null;
  }

  async groupMemberIds(groupId: string): Promise<string[]> {
    const r = await this.pool.query<{ id_user: string }>(`SELECT id_user FROM group_members WHERE id_group = $1`, [groupId]);
    return r.rows.map((x) => x.id_user);
  }

  /** Grupo de un inscrito en la categoría (null si no está en ninguno). */
  async findUserGroup(tournamentId: string, categoryId: string, userId: string): Promise<string | null> {
    const r = await this.pool.query<{ id_group: string }>(
      `SELECT cg.id_group FROM group_members gm
         JOIN category_groups cg ON cg.id_group = gm.id_group
        WHERE gm.id_user = $1 AND cg.id_tournament = $2 AND cg.id_category = $3
        LIMIT 1`,
      [userId, tournamentId, categoryId]
    );
    return r.rows[0]?.id_group ?? null;
  }

  /** Partidos por jugar del grupo, con quién de los dos está marcado "No vino". */
  async pendingGroupMatchesWithAbsence(groupId: string): Promise<
    Array<{ id_match: string; player1_id: string; player2_id: string; best_of_sets: number; p1_absent: boolean; p2_absent: boolean }>
  > {
    const r = await this.pool.query(
      `SELECT gm.id_match, gm.player1_id, gm.player2_id, gm.best_of_sets,
              COALESCE(e1.attendance = 'absent', false) AS p1_absent,
              COALESCE(e2.attendance = 'absent', false) AS p2_absent
         FROM group_matches gm
         JOIN category_groups cg ON cg.id_group = gm.id_group
         LEFT JOIN enrollments e1 ON e1.id_user = gm.player1_id AND e1.id_tournament = cg.id_tournament
                                 AND e1.id_category = cg.id_category AND e1.status = 'active'
         LEFT JOIN enrollments e2 ON e2.id_user = gm.player2_id AND e2.id_tournament = cg.id_tournament
                                 AND e2.id_category = cg.id_category AND e2.status = 'active'
        WHERE gm.id_group = $1 AND gm.status = 'scheduled'
          AND gm.player1_id IS NOT NULL AND gm.player2_id IS NOT NULL`,
      [groupId]
    );
    return r.rows;
  }

  // Recalcula la posición dentro del grupo (mismo criterio que recordMatchResult).
  private async rerankGroup(client: PoolClient, groupId: string): Promise<void> {
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
  }

  // No se presentó ninguno (ver 088): el partido se cierra sin ganador y los
  // dos lo pierden 0-0 — partido jugado y perdido en la tabla del grupo y en
  // sus estadísticas, sin victoria para nadie.
  async recordDoubleNoShow(params: {
    matchId: string;
    groupId: string;
    player1Id: string;
    player2Id: string;
    tournamentId: string;
    categoryId: string;
  }): Promise<void> {
    const { matchId, groupId, player1Id, player2Id, tournamentId, categoryId } = params;
    await this.withTransaction(async (client) => {
      await client.query(
        `UPDATE group_matches
         SET winner_id = NULL, sets_player1 = 0, sets_player2 = 0,
             status = 'walkover', played_at = NOW(), set_scores = NULL, result_reason = 'double_no_show',
             played_table_number = table_number, table_number = NULL
         WHERE id_match = $1`,
        [matchId]
      );
      await client.query(
        `UPDATE group_standings SET played = played + 1, lost = lost + 1
         WHERE id_group = $1 AND id_user = ANY($2::uuid[])`,
        [groupId, [player1Id, player2Id]]
      );
      await this.creditLoserStats(client, player1Id, 0, 0);
      await this.creditLoserStats(client, player2Id, 0, 0);
      await this.rerankGroup(client, groupId);
      await this.notifications.createForMany(
        [player1Id, player2Id],
        {
          type: "match_result",
          title: "Partido no jugado",
          message: "Tu partido de grupo se cerró porque no se presentó ninguno de los dos.",
          idTournament: tournamentId,
          idCategory: categoryId,
          idMatch: matchId,
          matchType: "group",
        },
        client
      );
    });
  }

  async undoDoubleNoShow(params: {
    matchId: string;
    groupId: string;
    player1Id: string;
    player2Id: string;
    tournamentId: string;
    requestedBy: string;
  }): Promise<void> {
    const { matchId, groupId, player1Id, player2Id, tournamentId, requestedBy } = params;
    await this.withTransaction(async (client) => {
      await client.query(
        `UPDATE group_matches
         SET winner_id = NULL, sets_player1 = 0, sets_player2 = 0,
             status = 'scheduled', played_at = NULL, set_scores = NULL, result_reason = NULL,
             table_number = played_table_number, played_table_number = NULL
         WHERE id_match = $1`,
        [matchId]
      );
      await client.query(
        `UPDATE group_standings SET played = played - 1, lost = lost - 1
         WHERE id_group = $1 AND id_user = ANY($2::uuid[])`,
        [groupId, [player1Id, player2Id]]
      );
      for (const participant of [player1Id, player2Id]) {
        for (const id of await this.statTargets(client, participant)) {
          await client.query(
            `UPDATE player_stats
             SET matches_played = matches_played - 1, matches_lost = matches_lost - 1, updated_at = NOW()
             WHERE id_user = $1`,
            [id]
          );
        }
      }
      await this.rerankGroup(client, groupId);
      await this.activityLog.record(tournamentId, requestedBy, "match_result_undone", null, client);
      await this.notifications.createForMany(
        [player1Id, player2Id],
        {
          type: "match_result_corrected",
          title: "Se corrigió el resultado de tu partido",
          message: "El organizador borró el resultado cargado. El partido vuelve a quedar por jugar hasta que se registre el correcto.",
          idTournament: tournamentId,
          idMatch: matchId,
          matchType: "group",
        },
        client
      );
    });
  }

  async reverseTournamentStats(client: PoolClient, tournamentId: string): Promise<void> {
    const isRanked = await this.isTournamentRanked(client, tournamentId);
    const pointsToRevert = LEGACY_WIN_POINTS_ENABLED && isRanked ? RANKING_POINTS_PER_WIN : 0;

    const groupRes = await client.query<{
      winner_id: string; player1_id: string; player2_id: string; sets_player1: number; sets_player2: number;
    }>(
      `SELECT winner_id, player1_id, player2_id, sets_player1, sets_player2
       FROM group_matches
       WHERE id_tournament = $1 AND status IN ('played', 'walkover') AND winner_id IS NOT NULL`,
      [tournamentId]
    );
    const bracketRes = await client.query<{
      winner_id: string; player1_id: string; player2_id: string; sets_player1: number; sets_player2: number;
    }>(
      `SELECT winner_id, player1_id, player2_id, sets_player1, sets_player2
       FROM bracket_matches
       WHERE id_tournament = $1 AND status IN ('played', 'walkover') AND winner_id IS NOT NULL`,
      [tournamentId]
    );

    for (const m of [...groupRes.rows, ...bracketRes.rows]) {
      const winnerIsP1 = m.winner_id === m.player1_id;
      const loserId = winnerIsP1 ? m.player2_id : m.player1_id;
      const winnerSetsFor = winnerIsP1 ? m.sets_player1 : m.sets_player2;
      const winnerSetsAgainst = winnerIsP1 ? m.sets_player2 : m.sets_player1;

      for (const id of await this.statTargets(client, m.winner_id)) {
        await client.query(
          `UPDATE player_stats
           SET matches_played = matches_played - 1, matches_won = matches_won - 1,
               sets_won = sets_won - $1, sets_lost = sets_lost - $2,
               ranking_points = ranking_points - $3, updated_at = NOW()
           WHERE id_user = $4`,
          [winnerSetsFor, winnerSetsAgainst, pointsToRevert, id]
        );
      }
      if (loserId) {
        for (const id of await this.statTargets(client, loserId)) {
          await client.query(
            `UPDATE player_stats
             SET matches_played = matches_played - 1, matches_lost = matches_lost - 1,
                 sets_won = sets_won - $1, sets_lost = sets_lost - $2, updated_at = NOW()
             WHERE id_user = $3`,
            [winnerSetsAgainst, winnerSetsFor, id]
          );
        }
      }
    }

    // No se presentó ninguno (088): los dos sumaron un partido perdido 0-0.
    const doubleRes = await client.query<{ player1_id: string; player2_id: string }>(
      `SELECT player1_id, player2_id FROM group_matches
       WHERE id_tournament = $1 AND status = 'walkover' AND winner_id IS NULL AND result_reason = 'double_no_show'`,
      [tournamentId]
    );
    for (const m of doubleRes.rows) {
      for (const participant of [m.player1_id, m.player2_id]) {
        for (const id of await this.statTargets(client, participant)) {
          await client.query(
            `UPDATE player_stats
             SET matches_played = matches_played - 1, matches_lost = matches_lost - 1, updated_at = NOW()
             WHERE id_user = $1`,
            [id]
          );
        }
      }
    }
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
      const isRanked = await this.isTournamentRanked(client, tournamentId);
      const pointsAwarded = LEGACY_WIN_POINTS_ENABLED && isRanked ? RANKING_POINTS_PER_WIN : 0;

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

      // Estadísticas globales — matches_played/won/sets siempre; ranking_points
      // solo si el torneo es puntuable (pointsAwarded = 0 si no). En dobles se
      // acredita a los dos jugadores reales de la pareja (ver statTargets).
      await this.creditWinnerStats(client, winnerId, winnerSetsFor, winnerSetsAgainst, pointsAwarded);
      // Un walkover sigue siendo un partido perdido (cuenta PJ/derrotas).
      await this.creditLoserStats(client, loserId, loserSetsFor, loserSetsAgainst);

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
          idMatch: matchId,
          matchType: "group",
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
          idMatch: matchId,
          matchType: "group",
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
      // Mismo flag que en recordMatchResult: si el torneo no era puntuable
      // (o el ranking general está desactivado) no se le restan puntos a
      // nadie (nunca se le sumaron).
      const isRanked = await this.isTournamentRanked(client, tournamentId);
      const pointsToRevert = LEGACY_WIN_POINTS_ENABLED && isRanked ? RANKING_POINTS_PER_WIN : 0;

      await client.query(
        `UPDATE group_matches
         SET winner_id = NULL, sets_player1 = 0, sets_player2 = 0,
             status = 'scheduled', played_at = NULL, set_scores = NULL, result_reason = NULL,
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

      // En dobles los puntos se habían acreditado a los dos jugadores de la
      // pareja (ver statTargets) — al deshacer hay que descontárselos a los
      // dos, no al usuario equipo.
      for (const id of await this.statTargets(client, winnerId)) {
        await client.query(
          `UPDATE player_stats
           SET matches_played = matches_played - 1, matches_won = matches_won - 1,
               sets_won = sets_won - $1, sets_lost = sets_lost - $2,
               ranking_points = ranking_points - $3, updated_at = NOW()
           WHERE id_user = $4`,
          [winnerSetsFor, winnerSetsAgainst, pointsToRevert, id]
        );
      }

      for (const id of await this.statTargets(client, loserId)) {
        await client.query(
          `UPDATE player_stats
           SET matches_played = matches_played - 1, matches_lost = matches_lost - 1,
               sets_won = sets_won - $1, sets_lost = sets_lost - $2, updated_at = NOW()
           WHERE id_user = $3`,
          [loserSetsFor, loserSetsAgainst, id]
        );
      }

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
      // Aviso a los dos jugadores: su resultado se borró y el partido vuelve
      // a quedar por jugar (antes solo quedaba en la bitácora del admin).
      await this.notifications.createForMany(
        [winnerId, loserId],
        {
          type: "match_result_corrected",
          title: "Se corrigió el resultado de tu partido",
          message: "El organizador borró el resultado cargado. El partido vuelve a quedar por jugar hasta que se registre el correcto.",
          idTournament: tournamentId,
          idMatch: matchId,
          matchType: "group",
        },
        client
      );

    });
  }

  // Deshace un resultado de partido de LLAVE ya cargado (ej: error de
  // digitación) — hasta ahora esto solo existía para grupos. A diferencia
  // de grupos, acá el resultado puede haber disparado una cadena de BYEs
  // automáticos (ver advanceBracketWinner: si el otro cupo del siguiente
  // partido está muerto, se resuelve solo y el ganador sigue avanzando,
  // puede repetirse varias rondas). Por eso primero se camina esa misma
  // cadena hacia adelante (con FOR UPDATE en cada partido, para no pisarse
  // con un recordBracketResult concurrente) y si CUALQUIER partido de la
  // cadena ya tiene un resultado real (jugado o walkover) se aborta todo
  // sin escribir nada — esa consecuencia ya se consumió más adelante y hay
  // que deshacerla primero ahí. Si la cadena está libre, se revierte el
  // partido original y cada eslabón de la cadena (un BYE se vuelve a
  // 'pending' vacío; el partido "ready" en el que había quedado esperando
  // el ganador también vuelve a 'pending' con ese cupo vacío de nuevo).
  async undoBracketMatchResult(params: {
    matchId: string;
    winnerId: string;
    loserId: string;
    winnerSetsFor: number;
    winnerSetsAgainst: number;
    tournamentId: string;
    categoryId: string;
    requestedBy: string;
  }): Promise<{ undone: true } | { undone: false; error: "BRACKET_RESULT_ALREADY_ADVANCED" }> {
    const { matchId, winnerId, loserId, winnerSetsFor, winnerSetsAgainst, tournamentId, categoryId, requestedBy } = params;

    return this.withTransaction(async (client) => {
      const isRanked = await this.isTournamentRanked(client, tournamentId);
      const pointsToRevert = LEGACY_WIN_POINTS_ENABLED && isRanked ? RANKING_POINTS_PER_WIN : 0;

      const startRes = await client.query<{
        next_round: number | null; next_match_number: number | null; next_match_slot: 1 | 2 | null;
      }>(
        `SELECT next_round, next_match_number, next_match_slot FROM bracket_matches WHERE id_match = $1 FOR UPDATE`,
        [matchId]
      );
      let round = startRes.rows[0]?.next_round ?? null;
      let matchNumber = startRes.rows[0]?.next_match_number ?? null;
      let slot = startRes.rows[0]?.next_match_slot ?? null;

      const chain: string[] = [];
      while (round && matchNumber && slot) {
        const nextRes = await client.query<{
          id_match: string; status: string;
          next_round: number | null; next_match_number: number | null; next_match_slot: 1 | 2 | null;
        }>(
          `SELECT id_match, status, next_round, next_match_number, next_match_slot
           FROM bracket_matches
           WHERE id_tournament = $1 AND id_category = $2 AND round = $3 AND match_number = $4
           FOR UPDATE`,
          [tournamentId, categoryId, round, matchNumber]
        );
        const next = nextRes.rows[0];
        if (!next) break;
        if (next.status === "played" || next.status === "walkover") {
          return { undone: false, error: "BRACKET_RESULT_ALREADY_ADVANCED" };
        }
        chain.push(next.id_match);
        if (next.status !== "bye") break; // no se encadenó más allá de acá
        round = next.next_round;
        matchNumber = next.next_match_number;
        slot = next.next_match_slot;
      }

      await client.query(
        `UPDATE bracket_matches
         SET winner_id = NULL, sets_player1 = 0, sets_player2 = 0,
             status = 'ready', played_at = NULL, set_scores = NULL, result_reason = NULL,
             table_number = played_table_number, played_table_number = NULL
         WHERE id_match = $1`,
        [matchId]
      );

      for (const id of chain) {
        await client.query(
          `UPDATE bracket_matches
           SET player1_id = CASE WHEN player1_id = $1 THEN NULL ELSE player1_id END,
               player2_id = CASE WHEN player2_id = $1 THEN NULL ELSE player2_id END,
               winner_id  = CASE WHEN status = 'bye' THEN NULL ELSE winner_id END,
               is_bye     = CASE WHEN status = 'bye' THEN FALSE ELSE is_bye END,
               played_at  = CASE WHEN status = 'bye' THEN NULL ELSE played_at END,
               status     = CASE WHEN status IN ('bye', 'ready') THEN 'pending' ELSE status END
           WHERE id_match = $2`,
          [winnerId, id]
        );
      }

      // Mismas cantidades que se acreditaron en recordBracketResult, en
      // dobles a los dos jugadores de la pareja (ver statTargets).
      for (const id of await this.statTargets(client, winnerId)) {
        await client.query(
          `UPDATE player_stats
           SET matches_played = matches_played - 1, matches_won = matches_won - 1,
               sets_won = sets_won - $1, sets_lost = sets_lost - $2,
               ranking_points = ranking_points - $3, updated_at = NOW()
           WHERE id_user = $4`,
          [winnerSetsFor, winnerSetsAgainst, pointsToRevert, id]
        );
      }
      for (const id of await this.statTargets(client, loserId)) {
        await client.query(
          `UPDATE player_stats
           SET matches_played = matches_played - 1, matches_lost = matches_lost - 1,
               sets_won = sets_won - $1, sets_lost = sets_lost - $2, updated_at = NOW()
           WHERE id_user = $3`,
          [winnerSetsAgainst, winnerSetsFor, id]
        );
      }

      await this.activityLog.record(tournamentId, requestedBy, "bracket_result_undone", null, client);
      // Aviso a los dos jugadores: su resultado se borró y el partido vuelve
      // a quedar por jugar (antes solo quedaba en la bitácora del admin).
      await this.notifications.createForMany(
        [winnerId, loserId],
        {
          type: "match_result_corrected",
          title: "Se corrigió el resultado de tu partido",
          message: "El organizador borró el resultado cargado. El partido vuelve a quedar por jugar hasta que se registre el correcto.",
          idTournament: tournamentId,
          idMatch: matchId,
          matchType: "bracket",
        },
        client
      );


      return { undone: true };
    });
  }

  /**
   * "Cambiar ganador": el resultado de un partido de llave se cargó al revés.
   * El otro jugador pasa a ser el ganador (el marcador se da vuelta) y toma
   * el lugar del que figuraba como ganador en los partidos siguientes, con
   * los resultados que ya tengan (en la mesa los jugó él). Las estadísticas
   * de los dos se corrigen partido por partido.
   */
  async fixBracketWinner(matchId: string, requestedBy: string): Promise<
    | { fixed: true; tournamentId: string; categoryId: string; newWinnerId: string; oldWinnerId: string }
    | { fixed: false; error: "MATCH_NOT_FOUND" | "MATCH_NOT_PLAYED" }
  > {
    return this.withTransaction(async (client) => {
      const r = await client.query<{
        id_tournament: string; id_category: string; round: number; status: string;
        player1_id: string | null; player2_id: string | null; winner_id: string | null;
        sets_player1: number; sets_player2: number;
      }>(
        `SELECT id_tournament, id_category, round, status, player1_id, player2_id, winner_id, sets_player1, sets_player2
           FROM bracket_matches WHERE id_match = $1 FOR UPDATE`,
        [matchId]
      );
      const m = r.rows[0];
      if (!m) return { fixed: false as const, error: "MATCH_NOT_FOUND" as const };
      if ((m.status !== "played" && m.status !== "walkover") || !m.winner_id || !m.player1_id || !m.player2_id) {
        return { fixed: false as const, error: "MATCH_NOT_PLAYED" as const };
      }
      const oldW = m.winner_id;
      const newW = oldW === m.player1_id ? m.player2_id : m.player1_id;
      const isRanked = await this.isTournamentRanked(client, m.id_tournament);
      const pts = LEGACY_WIN_POINTS_ENABLED && isRanked ? RANKING_POINTS_PER_WIN : 0;

      const unWin = async (who: string, setsFor: number, setsAgainst: number) => {
        for (const id of await this.statTargets(client, who)) {
          await client.query(
            `UPDATE player_stats SET matches_played = matches_played - 1, matches_won = matches_won - 1,
                    sets_won = sets_won - $1, sets_lost = sets_lost - $2, ranking_points = ranking_points - $3, updated_at = NOW()
              WHERE id_user = $4`,
            [setsFor, setsAgainst, pts, id]
          );
        }
      };
      const unLose = async (who: string, setsFor: number, setsAgainst: number) => {
        for (const id of await this.statTargets(client, who)) {
          await client.query(
            `UPDATE player_stats SET matches_played = matches_played - 1, matches_lost = matches_lost - 1,
                    sets_won = sets_won - $1, sets_lost = sets_lost - $2, updated_at = NOW()
              WHERE id_user = $3`,
            [setsFor, setsAgainst, id]
          );
        }
      };

      // 1) Este partido: se da vuelta (los sets de cada uno pasan al otro).
      const wFor = oldW === m.player1_id ? m.sets_player1 : m.sets_player2;
      const wAgainst = oldW === m.player1_id ? m.sets_player2 : m.sets_player1;
      await unWin(oldW, wFor, wAgainst);
      await unLose(newW, wAgainst, wFor);
      await this.creditWinnerStats(client, newW, wFor, wAgainst, pts);
      await this.creditLoserStats(client, oldW, wAgainst, wFor);
      await client.query(
        `UPDATE bracket_matches
            SET winner_id = $2, sets_player1 = sets_player2, sets_player2 = sets_player1,
                set_scores = CASE WHEN set_scores IS NULL THEN NULL ELSE (
                  SELECT COALESCE(jsonb_agg(jsonb_build_object('p1', e->'p2', 'p2', e->'p1') ORDER BY i), '[]'::jsonb)
                    FROM jsonb_array_elements(set_scores) WITH ORDINALITY AS t(e, i)
                ) END
          WHERE id_match = $1`,
        [matchId, newW]
      );

      // 2) Partidos siguientes donde figuraba el ganador equivocado: sus
      //    resultados ya cargados pasan a ser del ganador correcto.
      const later = await client.query<{
        id_match: string; status: string; player1_id: string | null; player2_id: string | null;
        winner_id: string | null; sets_player1: number; sets_player2: number;
      }>(
        `SELECT id_match, status, player1_id, player2_id, winner_id, sets_player1, sets_player2
           FROM bracket_matches
          WHERE id_tournament = $1 AND id_category = $2 AND round > $3 AND $4 IN (player1_id, player2_id)
          FOR UPDATE`,
        [m.id_tournament, m.id_category, m.round, oldW]
      );
      for (const x of later.rows) {
        if ((x.status === "played" || x.status === "walkover") && x.winner_id) {
          const mine = oldW === x.player1_id ? x.sets_player1 : x.sets_player2;
          const theirs = oldW === x.player1_id ? x.sets_player2 : x.sets_player1;
          if (x.winner_id === oldW) {
            await unWin(oldW, mine, theirs);
            await this.creditWinnerStats(client, newW, mine, theirs, pts);
          } else {
            await unLose(oldW, mine, theirs);
            await this.creditLoserStats(client, newW, mine, theirs);
          }
        }
      }
      await client.query(
        `UPDATE bracket_matches
            SET player1_id = CASE WHEN player1_id = $4 THEN $5::uuid ELSE player1_id END,
                player2_id = CASE WHEN player2_id = $4 THEN $5::uuid ELSE player2_id END,
                winner_id  = CASE WHEN winner_id  = $4 THEN $5::uuid ELSE winner_id END,
                referee_id = CASE WHEN referee_id = $5 THEN NULL ELSE referee_id END
          WHERE id_tournament = $1 AND id_category = $2 AND round > $3 AND $4 IN (player1_id, player2_id)`,
        [m.id_tournament, m.id_category, m.round, oldW, newW]
      );

      await this.activityLog.record(m.id_tournament, requestedBy, "bracket_result_undone", null, client);
      await this.notifications.createForMany(
        [oldW, newW],
        {
          type: "match_result_corrected",
          title: "Se corrigió el resultado de tu partido",
          message: "El organizador corrigió quién ganó tu partido de llave. Revisa el cuadro.",
          idTournament: m.id_tournament,
          idMatch: matchId,
          matchType: "bracket",
        },
        client
      );
      return { fixed: true as const, tournamentId: m.id_tournament, categoryId: m.id_category, newWinnerId: newW, oldWinnerId: oldW };
    });
  }

  private async statsUnWin(client: PoolClient, who: string, setsFor: number, setsAgainst: number, pts: number) {
    for (const id of await this.statTargets(client, who)) {
      await client.query(
        `UPDATE player_stats SET matches_played = matches_played - 1, matches_won = matches_won - 1,
                sets_won = sets_won - $1, sets_lost = sets_lost - $2, ranking_points = ranking_points - $3, updated_at = NOW()
          WHERE id_user = $4`,
        [setsFor, setsAgainst, pts, id]
      );
    }
  }

  private async statsUnLose(client: PoolClient, who: string, setsFor: number, setsAgainst: number) {
    for (const id of await this.statTargets(client, who)) {
      await client.query(
        `UPDATE player_stats SET matches_played = matches_played - 1, matches_lost = matches_lost - 1,
                sets_won = sets_won - $1, sets_lost = sets_lost - $2, updated_at = NOW()
          WHERE id_user = $3`,
        [setsFor, setsAgainst, id]
      );
    }
  }

  /**
   * "Cambiar ganador" de un partido de grupo cargado al revés: el otro pasa a
   * ganar (marcador al revés), la tabla del grupo y las estadísticas se
   * corrigen. Lo que eso cambie en la llave lo arregla el servicio.
   */
  async fixGroupWinner(matchId: string): Promise<
    | { fixed: true; groupId: string; tournamentId: string; categoryId: string; oldWinnerId: string; newWinnerId: string }
    | { fixed: false; error: "MATCH_NOT_FOUND" | "MATCH_NOT_PLAYED" }
  > {
    return this.withTransaction(async (client) => {
      const r = await client.query<{
        id_group: string; id_tournament: string; id_category: string; status: string;
        player1_id: string | null; player2_id: string | null; winner_id: string | null;
        sets_player1: number; sets_player2: number; set_scores: Array<{ p1: number; p2: number }> | null;
      }>(
        `SELECT gm.id_group, cg.id_tournament, cg.id_category, gm.status, gm.player1_id, gm.player2_id, gm.winner_id,
                gm.sets_player1, gm.sets_player2, gm.set_scores
           FROM group_matches gm JOIN category_groups cg ON cg.id_group = gm.id_group
          WHERE gm.id_match = $1 FOR UPDATE OF gm`,
        [matchId]
      );
      const m = r.rows[0];
      if (!m) return { fixed: false as const, error: "MATCH_NOT_FOUND" as const };
      if ((m.status !== "played" && m.status !== "walkover") || !m.winner_id || !m.player1_id || !m.player2_id) {
        return { fixed: false as const, error: "MATCH_NOT_PLAYED" as const };
      }
      const oldW = m.winner_id;
      const newW = oldW === m.player1_id ? m.player2_id : m.player1_id;
      const oldIsP1 = oldW === m.player1_id;
      const wFor = oldIsP1 ? m.sets_player1 : m.sets_player2;
      const wAg = oldIsP1 ? m.sets_player2 : m.sets_player1;
      // Puntos reales jugados (los W.O. no suman puntos).
      const sets = m.status === "walkover" ? [] : m.set_scores ?? [];
      const p1Pts = sets.reduce((a, x) => a + (x.p1 ?? 0), 0);
      const p2Pts = sets.reduce((a, x) => a + (x.p2 ?? 0), 0);
      const wPts = oldIsP1 ? p1Pts : p2Pts;
      const lPts = oldIsP1 ? p2Pts : p1Pts;

      // Tabla del grupo: lo que sumó cada uno pasa a ser lo del otro.
      await client.query(
        `UPDATE group_standings
            SET won = won - 1, lost = lost + 1,
                sets_for = sets_for + $3 - $2, sets_against = sets_against + $2 - $3,
                points_for = points_for + $5 - $4, points_against = points_against + $4 - $5
          WHERE id_group = $1 AND id_user = $6`,
        [m.id_group, wFor, wAg, wPts, lPts, oldW]
      );
      await client.query(
        `UPDATE group_standings
            SET won = won + 1, lost = lost - 1,
                sets_for = sets_for + $2 - $3, sets_against = sets_against + $3 - $2,
                points_for = points_for + $4 - $5, points_against = points_against + $5 - $4
          WHERE id_group = $1 AND id_user = $6`,
        [m.id_group, wFor, wAg, wPts, lPts, newW]
      );
      await this.rerankGroup(client, m.id_group);

      const isRanked = await this.isTournamentRanked(client, m.id_tournament);
      const pts = LEGACY_WIN_POINTS_ENABLED && isRanked ? RANKING_POINTS_PER_WIN : 0;
      await this.statsUnWin(client, oldW, wFor, wAg, pts);
      await this.statsUnLose(client, newW, wAg, wFor);
      await this.creditWinnerStats(client, newW, wFor, wAg, pts);
      await this.creditLoserStats(client, oldW, wAg, wFor);

      await client.query(
        `UPDATE group_matches
            SET winner_id = $2, sets_player1 = sets_player2, sets_player2 = sets_player1,
                set_scores = CASE WHEN set_scores IS NULL THEN NULL ELSE (
                  SELECT COALESCE(jsonb_agg(jsonb_build_object('p1', e->'p2', 'p2', e->'p1') ORDER BY i), '[]'::jsonb)
                    FROM jsonb_array_elements(set_scores) WITH ORDINALITY AS t(e, i)
                ) END
          WHERE id_match = $1`,
        [matchId, newW]
      );
      await this.notifications.createForMany(
        [oldW, newW],
        {
          type: "match_result_corrected",
          title: "Se corrigió el resultado de tu partido",
          message: "El organizador corrigió quién ganó tu partido de grupo.",
          idTournament: m.id_tournament,
          idCategory: m.id_category,
          idMatch: matchId,
          matchType: "group",
        },
        client
      );
      return {
        fixed: true as const, groupId: m.id_group, tournamentId: m.id_tournament, categoryId: m.id_category,
        oldWinnerId: oldW, newWinnerId: newW,
      };
    });
  }

  /** Jugadores de un grupo que están en la llave de [bracketCategoryId] (puede ser la Plata), con su siembra. */
  async groupPlayersInCategoryBracket(
    groupId: string,
    bracketCategoryId: string
  ): Promise<Array<{ id_user: string; seed: number | null; label: string | null }>> {
    const r = await this.pool.query<{ id_user: string; seed: number | null; label: string | null }>(
      `SELECT gm.id_user,
              MIN(CASE WHEN bm.player1_id = gm.id_user THEN bm.seed1 ELSE bm.seed2 END) AS seed,
              MAX(gs.qualification_label) AS label
         FROM group_members gm
         JOIN bracket_matches bm ON bm.id_category = $2 AND gm.id_user IN (bm.player1_id, bm.player2_id)
         LEFT JOIN group_standings gs ON gs.id_group = gm.id_group AND gs.id_user = gm.id_user
        WHERE gm.id_group = $1
        GROUP BY gm.id_user`,
      [groupId, bracketCategoryId]
    );
    return r.rows;
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
  ): Promise<
    Array<{
      id_user: string;
      id_group: string;
      group_name: string;
      rank_in_group: number;
      id_club: string | null;
      group_finished: boolean;
    }>
  > {
    const query = `
      WITH ${GROUP_RANKING_CTE}
      SELECT ranked.id_user, ranked.id_group, ranked.group_name, ranked.rank_in_group, u.id_club,
             NOT EXISTS (
               SELECT 1 FROM group_matches gm WHERE gm.id_group = ranked.id_group AND gm.status = 'scheduled'
             ) AS group_finished
      FROM ranked
      JOIN users u ON u.id_user = ranked.id_user
      WHERE rank_in_group <= qualifiers_per_group
      ORDER BY rank_in_group ASC, group_number ASC;
    `;

    const res = await this.pool.query(query, [tournamentId, categoryId]);
    return res.rows.map(
      (r: {
        id_user: string;
        id_group: string;
        group_name: string;
        rank_in_group: string | number;
        id_club: string | null;
        group_finished: boolean;
      }) => ({
        id_user: r.id_user,
        id_group: r.id_group,
        group_name: r.group_name,
        rank_in_group: Number(r.rank_in_group),
        id_club: r.id_club,
        group_finished: r.group_finished,
      })
    );
  }

  // ─── Llave adelantada: cupos que salen de un grupo ───────

  async groupHasBracketSlots(groupId: string): Promise<boolean> {
    const res = await this.pool.query(
      `SELECT 1 FROM bracket_matches WHERE player1_source_group = $1 OR player2_source_group = $1 LIMIT 1`,
      [groupId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  // Sus clasificados ya jugaron en la llave: corregir el grupo dejaría en la
  // llave a alguien que quizá no clasificaba.
  async groupSlotsPlayed(groupId: string): Promise<boolean> {
    const res = await this.pool.query(
      `SELECT 1 FROM bracket_matches
       WHERE (player1_source_group = $1 OR player2_source_group = $1) AND status IN ('played', 'walkover')
       LIMIT 1`,
      [groupId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async hasPendingGroupSlots(categoryId: string): Promise<boolean> {
    const res = await this.pool.query(
      `SELECT 1 FROM bracket_matches
       WHERE id_category = $1
         AND ((player1_source_group IS NOT NULL AND player1_id IS NULL)
           OR (player2_source_group IS NOT NULL AND player2_id IS NULL))
       LIMIT 1`,
      [categoryId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async fillGroupSlots(groupId: string, qualifiers: Array<{ id_user: string; rank_in_group: number }>): Promise<void> {
    await this.withTransaction(async (client) => {
      for (const q of qualifiers) {
        for (const slot of ["player1", "player2"]) {
          await client.query(
            `UPDATE bracket_matches SET ${slot}_id = $1, ${slot}_filled_at = now(), ${slot}_unconfirmed = TRUE
             WHERE ${slot}_source_group = $2 AND ${slot}_source_rank = $3 AND ${slot}_id IS DISTINCT FROM $1`,
            [q.id_user, groupId, q.rank_in_group]
          );
        }
      }
      await client.query(
        `UPDATE bracket_matches SET winner_id = COALESCE(player1_id, player2_id)
         WHERE (player1_source_group = $1 OR player2_source_group = $1) AND is_bye AND winner_id IS NULL`,
        [groupId]
      );
      await client.query(
        `UPDATE bracket_matches SET status = 'ready'
         WHERE (player1_source_group = $1 OR player2_source_group = $1)
           AND status = 'pending' AND player1_id IS NOT NULL AND player2_id IS NOT NULL
           AND NOT player1_unconfirmed AND NOT player2_unconfirmed`,
        [groupId]
      );
    });
  }

  // Se corrigió un resultado de un grupo ya terminado y ningún partido de
  // llave con sus clasificados se jugó: los cupos vuelven a quedar por llenar.
  async clearGroupSlots(groupId: string): Promise<void> {
    await this.withTransaction(async (client) => {
      for (const slot of ["player1", "player2"]) {
        await client.query(
          `UPDATE bracket_matches SET ${slot}_id = NULL, ${slot}_filled_at = NULL, ${slot}_unconfirmed = FALSE WHERE ${slot}_source_group = $1`,
          [groupId]
        );
      }
      await client.query(
        `UPDATE bracket_matches SET winner_id = NULL
         WHERE (player1_source_group = $1 OR player2_source_group = $1) AND is_bye`,
        [groupId]
      );
      await client.query(
        `UPDATE bracket_matches SET status = 'pending', table_number = NULL, referee_id = NULL, set_scores = NULL
         WHERE (player1_source_group = $1 OR player2_source_group = $1) AND status = 'ready'`,
        [groupId]
      );
      await client.query(
        `UPDATE group_standings SET qualified_to_bracket = FALSE, qualification_label = NULL WHERE id_group = $1`,
        [groupId]
      );
    });
  }

  // Formato "Oro y Plata" (ver TournamentPhaseService.populateSilverBracket):
  // el primero que queda fuera en cada grupo (el 3° con 2 clasificados), sea
  // de 3 o de 4; el 4° queda eliminado. Mismo ranking/desempate que
  // loadGroupQualifiers.
  async loadGroupSilverPlayers(
    tournamentId: string,
    categoryId: string
  ): Promise<Array<{ id_user: string; group_name: string; rank_in_group: number; id_club: string | null }>> {
    const query = `
      WITH ${GROUP_RANKING_CTE}
      SELECT ranked.id_user, ranked.group_name, ranked.rank_in_group, u.id_club
      FROM ranked
      JOIN users u ON u.id_user = ranked.id_user
      WHERE rank_in_group = qualifiers_per_group + 1
      ORDER BY rank_in_group ASC, group_number ASC;
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
  async markGroupQualifiers(tournamentId: string, categoryId: string, onlyGroups?: string[]): Promise<void> {
    await this.pool.query(
      `WITH ${GROUP_RANKING_CTE}
       UPDATE group_standings gs
       SET qualified_to_bracket = TRUE,
           qualification_label = CASE
             WHEN ranked.rank_in_group = 1 THEN 'first'
             WHEN ranked.rank_in_group = 2 THEN 'second'
             ELSE NULL
           END
       FROM ranked
       WHERE gs.id_group = ranked.id_group AND gs.id_user = ranked.id_user
         AND ranked.rank_in_group <= ranked.qualifiers_per_group
         AND ($3::uuid[] IS NULL OR gs.id_group = ANY($3))`,
      [tournamentId, categoryId, onlyGroups ?? null]
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
      ORDER BY e.seed ASC NULLS LAST, e.enrolled_at ASC, u.id_user ASC;
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
              winner_id, is_bye, best_of_sets, points_per_set, status, dead_slot, seed1, seed2,
              player1_source_group, player1_source_rank, player2_source_group, player2_source_rank)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
          [
            tournamentId, categoryId, match.round, match.match_number,
            match.player1_id, match.player2_id,
            match.next_round, match.next_match_number, match.next_match_slot,
            match.winner_id, match.is_bye, match.best_of_sets, match.points_per_set, match.status,
            match.dead_slot, match.seed1, match.seed2,
            match.player1_source_group ?? null, match.player1_source_rank ?? null,
            match.player2_source_group ?? null, match.player2_source_rank ?? null,
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
              winner_id, sets_player1, sets_player2, best_of_sets, points_per_set,
              is_bye, status, played_at::text, set_scores, result_reason, table_number, played_table_number,
              referee_id, ${REFEREE_NAME_SQL("bracket_matches")} AS referee_name, dead_slot, seed1, seed2,
              (SELECT player1_source_rank::text || '° ' || cg.group_name FROM category_groups cg
                WHERE cg.id_group = player1_source_group) AS player1_slot_label,
              (SELECT player2_source_rank::text || '° ' || cg.group_name FROM category_groups cg
                WHERE cg.id_group = player2_source_group) AS player2_slot_label,
              (SELECT player1_source_rank::text || '° ' || cg.group_name FROM category_groups cg
                WHERE cg.id_group = player1_source_group) AS player1_source_label,
              (SELECT player2_source_rank::text || '° ' || cg.group_name FROM category_groups cg
                WHERE cg.id_group = player2_source_group) AS player2_source_label,
              to_char(player1_filled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS player1_filled_at,
              to_char(player2_filled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS player2_filled_at,
              player1_unconfirmed, player2_unconfirmed, player1_source_group, player2_source_group,
              CASE WHEN player1_id IS NULL AND player1_source_group IS NOT NULL
                   THEN 'slot:' || player1_source_group || ':' || player1_source_rank END AS player1_slot_ref,
              CASE WHEN player2_id IS NULL AND player2_source_group IS NOT NULL
                   THEN 'slot:' || player2_source_group || ':' || player2_source_rank END AS player2_slot_ref
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
              winner_id, sets_player1, sets_player2, best_of_sets, points_per_set,
              is_bye, status, played_at::text, set_scores, result_reason, dead_slot
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
        unconfirmed: boolean;
      }>(
        `SELECT id_match, player1_id, player2_id, dead_slot, status,
                next_round, next_match_number, next_match_slot,
                (player1_unconfirmed OR player2_unconfirmed) AS unconfirmed
         FROM bracket_matches
         WHERE id_tournament = $1 AND id_category = $2 AND round = $3 AND match_number = $4`,
        [tournamentId, categoryId, round, matchNumber]
      );
      const match = rows[0];
      if (!match || match.status !== "pending") return;

      if (match.player1_id !== null && match.player2_id !== null && !match.unconfirmed) {
        await client.query(`UPDATE bracket_matches SET status = 'ready' WHERE id_match = $1`, [match.id_match]);
        await this.notifyWaitingOpponent(client, {
          tournamentId,
          categoryId,
          winnerId,
          waitingPlayerId: match.player1_id === winnerId ? match.player2_id : match.player1_id,
          nextMatchId: match.id_match,
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
    params: {
      tournamentId: string;
      categoryId: string;
      winnerId: string;
      waitingPlayerId: string | null;
      nextMatchId: string;
    }
  ): Promise<void> {
    const { tournamentId, categoryId, winnerId, waitingPlayerId, nextMatchId } = params;
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
        message: `Tu próximo partido en el cuadro ya está listo: juegas contra ${winnerName}.`,
        idTournament: tournamentId,
        idCategory: categoryId,
        idMatch: nextMatchId,
        matchType: "bracket",
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
      const isRanked = await this.isTournamentRanked(client, tournamentId);
      const pointsAwarded = LEGACY_WIN_POINTS_ENABLED && isRanked ? RANKING_POINTS_PER_WIN : 0;

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

      // Estadísticas globales (en dobles → a los dos jugadores de la pareja).
      await this.creditWinnerStats(client, winnerId, winnerSetsFor, winnerSetsAgainst, pointsAwarded);
      // El perdedor puede no existir (un bye no tiene uno).
      if (loserId) {
        await this.creditLoserStats(client, loserId, winnerSetsAgainst, winnerSetsFor);
      }

      const isFinal = !nextRound;
      await this.notifications.create(
        {
          idUser: winnerId,
          type: "match_result",
          title: isFinal ? "¡Ganaste el torneo!" : "Ganaste tu partido de llave",
          message: `Ganaste ${winnerSetsFor}-${winnerSetsAgainst}${isFinal ? " y te llevaste el título" : ", avanzas a la siguiente ronda"}`,
          idTournament: tournamentId,
          idCategory: categoryId,
          idMatch: matchId,
          matchType: "bracket",
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
            idMatch: matchId,
            matchType: "bracket",
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

      const fromRes = await client.query<{ id_group: string; seed: number | null; group_kind: string }>(
        `SELECT cg.id_group, gm.seed, cg.group_kind
         FROM group_members gm
         JOIN category_groups cg ON cg.id_group = gm.id_group
         WHERE gm.id_user = $1 AND cg.id_tournament = $2 AND cg.id_category = $3`,
        [userId, tournamentId, categoryId]
      );
      const from = fromRes.rows[0];
      if (!from) return { moved: false, error: "PLAYER_NOT_IN_GROUP" as BracketsError };
      if (from.id_group === toGroupId) return { moved: false, error: "SAME_GROUP" as BracketsError };

      const toRes = await client.query<{ id_group: string; group_kind: string }>(
        `SELECT id_group, group_kind FROM category_groups
         WHERE id_group = $1 AND id_tournament = $2 AND id_category = $3`,
        [toGroupId, tournamentId, categoryId]
      );
      const to = toRes.rows[0];
      if (!to) return { moved: false, error: "GROUP_NOT_FOUND" as BracketsError };

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

      // Un grupo manual no tiene piso ni techo — puede quedar en 0 miembros
      // o crecer a cualquier cantidad. Los automáticos siguen con las
      // mismas reglas de siempre (2 a 4, todos-contra-todos).
      if (from.group_kind !== "manual" && fromCount - 1 < 2) {
        return { moved: false, error: "SOURCE_GROUP_TOO_SMALL" as BracketsError };
      }
      if (to.group_kind !== "manual" && toCount + 1 > 4) {
        return { moved: false, error: "TARGET_GROUP_FULL" as BracketsError };
      }

      // Sale del grupo de origen: sus partidos ahí seguían sin jugar (ya validado arriba).
      await client.query(
        `DELETE FROM group_matches WHERE id_group = $1 AND (player1_id = $2 OR player2_id = $2)`,
        [from.id_group, userId]
      );
      await client.query(`DELETE FROM group_standings WHERE id_group = $1 AND id_user = $2`, [from.id_group, userId]);
      await client.query(`DELETE FROM group_members WHERE id_group = $1 AND id_user = $2`, [from.id_group, userId]);

      const newFromCount = fromCount - 1;
      const fromIsManual = from.group_kind === "manual";
      await client.query(
        `UPDATE category_groups SET target_size = $1, group_kind = $2 WHERE id_group = $3`,
        [newFromCount, fromIsManual ? "manual" : newFromCount === 2 ? "playoff_two" : "normal", from.id_group]
      );
      // Si el grupo de origen quedó con un solo jugador, ese pasa como 1°
      // (mismo criterio que addMemberToGroup para un grupo de uno).
      if (newFromCount === 1) {
        await client.query(`UPDATE group_standings SET position = 1 WHERE id_group = $1`, [from.id_group]);
      }

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
          message: "El organizador te movió a otro grupo en la fase de grupos. Revisa tus nuevos partidos.",
          idTournament: tournamentId,
          idCategory: categoryId,
        },
        client
      );

      return { moved: true };
    });
  }

  // Intercambia a dos jugadores de grupos distintos: cada uno toma el LUGAR
  // del otro (misma posición en el grupo y los mismos partidos, solo cambia
  // quién los juega) — así sirve aunque los dos grupos estén llenos (4), cosa
  // que "mover jugador" no puede, y no se desordena el orden de partidos.
  // Solo si ninguno de los dos jugó todavía en su grupo, ni tiene un partido
  // en mesa o con marcador en vivo.
  // Reemplazar a un jugador que NO vino por otro, con los grupos ya armados:
  // el que entra ocupa su lugar (mismos partidos pendientes, misma fila de
  // la tabla y posición en el grupo); el que sale queda con la inscripción
  // cancelada. Solo si el que sale todavía no jugó ni está en mesa. El que
  // entra no puede estar ya en un grupo; se inscribe solo (sin cupos).
  async replaceGroupMember(params: {
    tournamentId: string;
    categoryId: string;
    outUser: string;
    inUser: string;
  }): Promise<{ replaced: true; groupId: string } | { replaced: false; error: BracketsError }> {
    const { tournamentId, categoryId, outUser, inUser } = params;
    if (outUser === inUser) return { replaced: false, error: "DUPLICATE_PLAYER" as BracketsError };
    return this.withTransaction(async (client) => {
      const phaseRes = await client.query<{ phase: string }>(
        `SELECT phase FROM tournament_categories WHERE id_category = $1 FOR UPDATE`,
        [categoryId]
      );
      if ((phaseRes.rows[0]?.phase ?? "enrollment") !== "groups") {
        return { replaced: false, error: "GROUPS_LOCKED" as BracketsError };
      }
      const groupOf = async (userId: string) => {
        const r = await client.query<{ id_group: string }>(
          `SELECT cg.id_group FROM group_members gm
             JOIN category_groups cg ON cg.id_group = gm.id_group
            WHERE gm.id_user = $1 AND cg.id_tournament = $2 AND cg.id_category = $3`,
          [userId, tournamentId, categoryId]
        );
        return r.rows[0]?.id_group ?? null;
      };
      const group = await groupOf(outUser);
      if (!group) return { replaced: false, error: "PLAYER_NOT_IN_GROUP" as BracketsError };
      if (await groupOf(inUser)) return { replaced: false, error: "ALREADY_IN_A_GROUP" as BracketsError };

      const st = await client.query<{ played: boolean | null; busy: boolean | null }>(
        `SELECT bool_or(status <> 'scheduled') AS played,
                bool_or(status = 'scheduled' AND (table_number IS NOT NULL OR set_scores IS NOT NULL)) AS busy
           FROM group_matches WHERE id_group = $1 AND (player1_id = $2 OR player2_id = $2)`,
        [group, outUser]
      );
      if (st.rows[0]?.played) return { replaced: false, error: "PLAYER_ALREADY_PLAYED" as BracketsError };
      if (st.rows[0]?.busy) return { replaced: false, error: "PLAYER_ON_TABLE" as BracketsError };

      await client.query(
        `UPDATE group_matches
            SET player1_id = CASE WHEN player1_id = $2 THEN $3::uuid ELSE player1_id END,
                player2_id = CASE WHEN player2_id = $2 THEN $3::uuid ELSE player2_id END,
                referee_id = CASE WHEN referee_id = $2 THEN NULL ELSE referee_id END
          WHERE id_group = $1 AND (player1_id = $2 OR player2_id = $2 OR referee_id = $2)`,
        [group, outUser, inUser]
      );
      await client.query(`UPDATE group_standings SET id_user = $3 WHERE id_group = $1 AND id_user = $2`, [group, outUser, inUser]);
      await client.query(
        `UPDATE group_members SET id_user = $3, assignment_type = 'manual' WHERE id_group = $1 AND id_user = $2`,
        [group, outUser, inUser]
      );
      await client.query(
        `UPDATE enrollments SET status = 'cancelled'
          WHERE id_tournament = $1 AND id_category = $2 AND id_user = $3 AND status = 'active'`,
        [tournamentId, categoryId, outUser]
      );
      // El que entra queda inscrito acá mismo, SIN mirar cupos: ocupa el
      // lugar del que sale (antes había que inscribirlo aparte y, con la
      // categoría llena, "cupos completos" no dejaba reemplazar). Si ya
      // tenía una inscripción (activa o cancelada) se reactiva esa.
      await client.query(
        `INSERT INTO enrollments (id_user, id_tournament, id_category, status, attendance, checked_in, qualification_type)
         VALUES ($3, $1, $2, 'active', 'present', true, 'group')
         ON CONFLICT (id_user, id_tournament, id_category)
         DO UPDATE SET status = 'active', attendance = 'present', checked_in = true, qualification_type = 'group'`,
        [tournamentId, categoryId, inUser]
      );
      await this.notifications.create(
        {
          idUser: inUser,
          type: "groups_started",
          title: "Entraste a un grupo",
          message: "El organizador te sumó a la fase de grupos en reemplazo de otro jugador. Revisa tu grupo y tus partidos.",
          idTournament: tournamentId,
          idCategory: categoryId,
        },
        client
      );
      await this.notifications.create(
        {
          idUser: outUser,
          type: "enrollment_removed",
          title: "Inscripción cancelada",
          message: "No te presentaste y el organizador te reemplazó en tu grupo.",
          idTournament: tournamentId,
          idCategory: categoryId,
        },
        client
      );
      return { replaced: true, groupId: group };
    });
  }

  async swapGroupMembers(params: {
    tournamentId: string;
    categoryId: string;
    userA: string;
    userB: string;
  }): Promise<{ swapped: true } | { swapped: false; error: BracketsError }> {
    const { tournamentId, categoryId, userA, userB } = params;

    return this.withTransaction(async (client) => {
      const phaseRes = await client.query<{ phase: string }>(
        `SELECT phase FROM tournament_categories WHERE id_category = $1 FOR UPDATE`,
        [categoryId]
      );
      if ((phaseRes.rows[0]?.phase ?? "enrollment") !== "groups") {
        return { swapped: false, error: "GROUPS_LOCKED" as BracketsError };
      }

      const groupOf = async (userId: string) => {
        const r = await client.query<{ id_group: string }>(
          `SELECT cg.id_group FROM group_members gm
             JOIN category_groups cg ON cg.id_group = gm.id_group
            WHERE gm.id_user = $1 AND cg.id_tournament = $2 AND cg.id_category = $3`,
          [userId, tournamentId, categoryId]
        );
        return r.rows[0]?.id_group ?? null;
      };
      const groupA = await groupOf(userA);
      const groupB = await groupOf(userB);
      if (!groupA || !groupB) return { swapped: false, error: "PLAYER_NOT_IN_GROUP" as BracketsError };
      if (groupA === groupB) return { swapped: false, error: "SAME_GROUP" as BracketsError };

      // Ninguno jugó, ni está en mesa / con marcador en vivo en su grupo.
      const checks: Array<[string, string]> = [[groupA, userA], [groupB, userB]];
      for (const [g, u] of checks) {
        const r = await client.query<{ played: boolean | null; busy: boolean | null }>(
          `SELECT bool_or(status <> 'scheduled') AS played,
                  bool_or(status = 'scheduled' AND (table_number IS NOT NULL OR set_scores IS NOT NULL)) AS busy
             FROM group_matches
            WHERE id_group = $1 AND (player1_id = $2 OR player2_id = $2)`,
          [g, u]
        );
        if (r.rows[0]?.played) return { swapped: false, error: "PLAYER_ALREADY_PLAYED" as BracketsError };
        if (r.rows[0]?.busy) return { swapped: false, error: "PLAYER_ON_TABLE" as BracketsError };
      }

      // Cada uno ocupa el lugar del otro: partidos, fila de la tabla y lugar
      // en el grupo (posición y semilla del lugar se mantienen).
      const take = async (group: string, from: string, to: string) => {
        await client.query(
          `UPDATE group_matches
              SET player1_id = CASE WHEN player1_id = $2 THEN $3::uuid ELSE player1_id END,
                  player2_id = CASE WHEN player2_id = $2 THEN $3::uuid ELSE player2_id END
            WHERE id_group = $1 AND (player1_id = $2 OR player2_id = $2)`,
          [group, from, to]
        );
        await client.query(`UPDATE group_standings SET id_user = $3 WHERE id_group = $1 AND id_user = $2`, [group, from, to]);
        await client.query(
          `UPDATE group_members SET id_user = $3, assignment_type = 'manual' WHERE id_group = $1 AND id_user = $2`,
          [group, from, to]
        );
      };
      await take(groupA, userA, userB);
      await take(groupB, userB, userA);

      for (const userId of [userA, userB]) {
        await this.notifications.create(
          {
            idUser: userId,
            type: "group_changed",
            title: "Te cambiaron de grupo",
            message: "El organizador te cambió de grupo en la fase de grupos. Revisa tus nuevos partidos.",
            idTournament: tournamentId,
            idCategory: categoryId,
          },
          client
        );
      }
      return { swapped: true };
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

    // Un grupo MANUAL nunca deja de serlo, sin importar cuántos miembros
    // tenga — así no pierde la etiqueta "Manual" (GroupsPanel.tsx) al ir
    // sumando gente, y de paso no queda atado al límite de 4 que sí tienen
    // los grupos automáticos (playoff_two/normal, ver más abajo).
    const kindRes = await client.query<{ group_kind: string }>(
      `SELECT group_kind FROM category_groups WHERE id_group = $1`,
      [groupId]
    );
    const isManual = kindRes.rows[0]?.group_kind === "manual";

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

    // Solo en su grupo = 1° del grupo (no tiene contra quién jugar). Si
    // después se suma alguien y todavía no hay resultados, esa posición
    // vuelve a quedar pendiente hasta que jueguen.
    const sizeRes = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM group_members WHERE id_group = $1`,
      [groupId]
    );
    if (Number(sizeRes.rows[0]?.n ?? 0) === 1) {
      await client.query(`UPDATE group_standings SET position = 1 WHERE id_group = $1`, [groupId]);
    } else {
      await client.query(
        `UPDATE group_standings SET position = NULL
          WHERE id_group = $1 AND played = 0
            AND NOT EXISTS (
              SELECT 1 FROM group_matches
               WHERE id_group = $1 AND status IN ('played', 'walkover')
            )`,
        [groupId]
      );
    }

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
          !isManual && newCount === 2 ? "two_player_group" : "group_stage",
        ]
      );
    }

    // target_size siempre queda en el conteo real actual — ya no hay CHECK
    // que limite a 2/3/4 (ver migración 048), así que esto vale incluso
    // para el primer miembro de un grupo recién creado (newCount === 1).
    // group_kind: un grupo manual se queda "manual" siempre; uno automático
    // sigue el criterio de siempre (2 -> playoff_two, si no -> normal).
    await client.query(
      `UPDATE category_groups SET target_size = $1, group_kind = $2 WHERE id_group = $3`,
      [newCount, isManual ? "manual" : newCount === 2 ? "playoff_two" : "normal", groupId]
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
      const groupRes = await client.query<{ id_tournament: string; id_category: string; group_kind: string }>(
        `SELECT id_tournament, id_category, group_kind FROM category_groups WHERE id_group = $1 FOR UPDATE`,
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

      // El tope de 4 es del formato todos-contra-todos automático — un
      // grupo manual (group_kind = 'manual') no lo tiene, a pedido: se le
      // puede aplicar cualquier cantidad de jugadores.
      if (group.group_kind !== "manual" && count + 1 > 4) {
        return { added: false, error: "TARGET_GROUP_FULL" as BracketsError };
      }

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
            message: `Te agregaron al grupo de ${ctx.category_type} ${ctx.category_range} (${ctx.tournament_name}). Revisa tus partidos.`,
            idTournament: group.id_tournament,
            idCategory: group.id_category,
          },
          client
        );
      }

      return { added: true };
    });
  }

  // Crea un grupo NUEVO, aparte de los que ya existen, con la lista exacta
  // de jugadores que pasa el admin — para cuando llega gente después del
  // sorteo y los grupos existentes ya están llenos (o ya jugando: no se
  // tocan). A diferencia de setGroupsManual (que REARMA todo desde cero),
  // esto solo agrega — reusa addMemberToGroup jugador por jugador, así los
  // partidos todos-contra-todos del grupo nuevo se generan igual que
  // cuando addPlayerToGroup suma a alguien a un grupo existente.
  async createManualGroup(params: {
    tournamentId: string;
    categoryId: string;
    memberUserIds: string[];
  }): Promise<
    | { created: true; groupId: string; groupName: string }
    | { created: false; error: BracketsError }
  > {
    const { tournamentId, categoryId, memberUserIds } = params;

    return this.withTransaction(async (client) => {
      const phaseRes = await client.query<{ phase: string }>(
        `SELECT phase FROM tournament_categories WHERE id_category = $1 FOR UPDATE`,
        [categoryId]
      );
      if ((phaseRes.rows[0]?.phase ?? "enrollment") !== "groups") {
        return { created: false, error: "GROUPS_LOCKED" as BracketsError };
      }

      // Mismas dos validaciones que addPlayerToGroup, una por cada
      // jugador propuesto — nada se inserta hasta que TODOS pasen (si uno
      // falla, no queda un grupo a medio armar).
      for (const userId of memberUserIds) {
        const enrolledRes = await client.query(
          `SELECT 1 FROM enrollments
           WHERE id_user = $1 AND id_tournament = $2 AND id_category = $3
             AND status = 'active' AND qualification_type = 'group'`,
          [userId, tournamentId, categoryId]
        );
        if ((enrolledRes.rowCount ?? 0) === 0) {
          return { created: false, error: "PLAYER_NOT_ENROLLED" as BracketsError };
        }
        const alreadyInGroupRes = await client.query(
          `SELECT 1 FROM group_members gm
           JOIN category_groups cg ON cg.id_group = gm.id_group
           WHERE gm.id_user = $1 AND cg.id_category = $2`,
          [userId, categoryId]
        );
        if ((alreadyInGroupRes.rowCount ?? 0) > 0) {
          return { created: false, error: "ALREADY_IN_A_GROUP" as BracketsError };
        }
      }
      if (new Set(memberUserIds).size !== memberUserIds.length) {
        return { created: false, error: "DUPLICATE_PLAYER" as BracketsError };
      }

      // group_name sigue el mismo "GR-N" que arma el generador automático
      // — nextManualGroupName (group_generation_logic.ts, con sus propios
      // tests unitarios) calcula el próximo N libre a partir de los
      // nombres existentes, no de la cantidad de filas, por si algún día
      // queda un hueco. Se resuelve en JS, no con una regex de Postgres,
      // para poder probarlo sin necesitar una base de datos.
      const existingRes = await client.query<{ group_name: string; sort_order: number }>(
        `SELECT group_name, sort_order FROM category_groups WHERE id_category = $1`,
        [categoryId]
      );
      const sortOrder = existingRes.rows.reduce((max, r) => Math.max(max, r.sort_order), 0) + 1;
      const groupName = nextManualGroupName(existingRes.rows.map((r) => r.group_name));

      // Mismo qualifiers_per_group que ya tienen TODOS los demás grupos de
      // esta categoría (insertGroupsData lo aplica parejo a cada grupo al
      // generar/rearmar) — sin esto, el grupo manual quedaba pegado al
      // default de la columna (2) sin importar lo que el admin haya
      // configurado para la categoría, dejando un grupo con un criterio de
      // clasificación distinto al resto sin que nadie lo haya elegido así.
      const qualifiersRes = await client.query<{ qualifiers_per_group: number }>(
        `SELECT qualifiers_per_group FROM tournament_categories WHERE id_category = $1`,
        [categoryId]
      );
      const qualifiersPerGroup = Number(qualifiersRes.rows[0]?.qualifiers_per_group ?? 2);

      // target_size arranca con la cantidad inicial de miembros — puede ser
      // 0 (grupo vacío, se le van sumando jugadores uno a uno después vía
      // POST /groups/:id/members). Sin CHECK de 2/3/4 (migración 048), no
      // hace falta ningún mínimo acá.
      const insertRes = await client.query<{ id_group: string }>(
        `INSERT INTO category_groups
           (id_tournament, id_category, group_name, target_size, sort_order, status, group_kind, qualifiers_per_group)
         VALUES ($1, $2, $3, $4, $5, 'active', 'manual', $6)
         RETURNING id_group`,
        [tournamentId, categoryId, groupName, memberUserIds.length, sortOrder, qualifiersPerGroup]
      );
      const groupId = insertRes.rows[0].id_group;

      let currentCount = 0;
      for (const userId of memberUserIds) {
        await this.addMemberToGroup(client, {
          groupId,
          tournamentId,
          categoryId,
          userId,
          seed: null,
          currentCount,
          assignmentType: "manual",
        });
        currentCount++;
      }

      const ctxRes = await client.query<{
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
      const ctx = ctxRes.rows[0];
      if (ctx) {
        // Mismo mensaje para todos los miembros nuevos — createForMany en
        // vez de un create() por jugador (mismo criterio que ya usan
        // regenerateGroups/setGroupsManual para este mismo tipo de aviso).
        await this.notifications.createForMany(
          memberUserIds,
          {
            type: "group_changed",
            title: "Te sumaron a un grupo",
            message: `Te agregaron al grupo ${groupName} de ${ctx.category_type} ${ctx.category_range} (${ctx.tournament_name}). Revisa tus partidos.`,
            idTournament: tournamentId,
            idCategory: categoryId,
          },
          client
        );
      }

      return { created: true, groupId, groupName };
    });
  }

  // "Crear una llave" — postergar a un jugador YA sembrado en un partido de
  // ronda 1 (todavía no jugado) a una pre-llave nueva (ronda 0), para poder
  // sumar ahí a alguien que llegó tarde sin tocar el resto del cuadro ya
  // generado. Reusa EXACTAMENTE el mismo mecanismo de pre-llave que ya usa
  // buildBracketWithPreRound (next_round/next_match_number/next_match_slot
  // apuntando al cupo que se vació) — así recordBracketResult/
  // advanceBracketWinner no necesitan saber que este partido se creó a
  // mano: para ellos es un partido de ronda 0 más.
  //
  // Solo se permite postergar desde un partido con status 'pending' o
  // 'ready' (nunca 'bye'/'played'/'walkover'): en la ronda 1 de este
  // sistema nunca hay dead_slot propio (ver bracket_generation_logic.ts),
  // así que cualquier partido 'pending'/'ready' tiene su OTRO cupo real (ya
  // ocupado, o legítimamente esperando el resultado de otra pre-llave
  // previa) — nunca un cupo estructuralmente muerto. Eso evita tener que
  // tocar dead_slot acá.
  async createBracketPreRoundMatch(params: {
    tournamentId: string;
    categoryId: string;
    pullUserId: string;
  }): Promise<
    | { created: true; matchId: string; pulledFromMatchId: string }
    | { created: false; error: BracketsError }
  > {
    const { tournamentId, categoryId, pullUserId } = params;

    return this.withTransaction(async (client) => {
      const phaseRes = await client.query<{ phase: string }>(
        `SELECT phase FROM tournament_categories WHERE id_category = $1 FOR UPDATE`,
        [categoryId]
      );
      if ((phaseRes.rows[0]?.phase ?? "enrollment") !== "bracket") {
        return { created: false, error: "BRACKET_LOCKED" as BracketsError };
      }

      const candidateRes = await client.query<{
        id_match: string;
        match_number: number;
        player1_id: string | null;
        player2_id: string | null;
        best_of_sets: 3 | 5 | 7;
      }>(
        `SELECT id_match, match_number, player1_id, player2_id, best_of_sets
         FROM bracket_matches
         WHERE id_tournament = $1 AND id_category = $2 AND round = 1
           AND status IN ('pending', 'ready')
           AND (player1_id = $3 OR player2_id = $3)
         FOR UPDATE`,
        [tournamentId, categoryId, pullUserId]
      );
      const candidate = candidateRes.rows[0];
      if (!candidate) {
        return { created: false, error: "PLAYER_NOT_PULLABLE" as BracketsError };
      }
      const slot: 1 | 2 = candidate.player1_id === pullUserId ? 1 : 2;

      const roundZeroRes = await client.query<{ max_num: number | null }>(
        `SELECT MAX(match_number) AS max_num FROM bracket_matches
         WHERE id_tournament = $1 AND id_category = $2 AND round = 0`,
        [tournamentId, categoryId]
      );
      const newMatchNumber = Number(roundZeroRes.rows[0]?.max_num ?? 0) + 1;

      const insertRes = await client.query<{ id_match: string }>(
        `INSERT INTO bracket_matches
           (id_tournament, id_category, round, match_number,
            player1_id, player2_id,
            next_round, next_match_number, next_match_slot,
            best_of_sets, status)
         VALUES ($1, $2, 0, $3, $4, NULL, 1, $5, $6, $7, 'pending')
         RETURNING id_match`,
        [tournamentId, categoryId, newMatchNumber, pullUserId, candidate.match_number, slot, candidate.best_of_sets]
      );
      const matchId = insertRes.rows[0].id_match;

      // Vaciar el cupo que se acaba de postergar — el partido de ronda 1
      // vuelve a 'pending' (ya no puede estar 'ready') hasta que la
      // pre-llave se juegue y advanceBracketWinner lo rellene solo.
      await client.query(
        slot === 1
          ? `UPDATE bracket_matches SET player1_id = NULL, status = 'pending' WHERE id_match = $1`
          : `UPDATE bracket_matches SET player2_id = NULL, status = 'pending' WHERE id_match = $1`,
        [candidate.id_match]
      );

      const ctx = await this.getTournamentCategoryNames(tournamentId, categoryId);
      if (ctx) {
        await this.notifications.create(
          {
            idUser: pullUserId,
            type: "bracket_changed",
            title: "Tu partido de llave cambió",
            message: `Tu partido de primera ronda de ${ctx.categoryType} ${ctx.categoryRange} (${ctx.tournamentName}) ahora depende de una pre-llave: primero juegas esa, y si ganas sigues donde ya estabas.`,
            idTournament: tournamentId,
            idCategory: categoryId,
          },
          client
        );
      }

      return { created: true, matchId, pulledFromMatchId: candidate.id_match };
    });
  }

  // "Agregar un jugador" a la pre-llave manual creada arriba — llena el
  // cupo vacío (player2, siempre el que queda libre) con quien llegó tarde.
  // Una vez lleno, el partido queda 'ready' y sigue el camino normal
  // (MatchResultForm → recordBracketResult → advanceBracketWinner), sin
  // ningún código nuevo de avance: nada distingue una pre-llave manual de
  // una automática desde ese punto en adelante.
  async addPlayerToBracketMatch(params: {
    matchId: string;
    userId: string;
  }): Promise<
    | { added: true; opponentId: string }
    | { added: false; error: BracketsError }
  > {
    const { matchId, userId } = params;

    return this.withTransaction(async (client) => {
      // A diferencia de createBracketPreRoundMatch (que arranca desde
      // tournamentId/categoryId de la URL), esta ruta solo trae id_match
      // (mismo patrón que recordBracketResult/setBracketMatchReferee) — el
      // torneo/categoría se derivan del propio partido.
      const matchRes = await client.query<{
        id_match: string;
        id_tournament: string;
        id_category: string;
        player1_id: string | null;
        player2_id: string | null;
      }>(
        `SELECT id_match, id_tournament, id_category, player1_id, player2_id
         FROM bracket_matches
         WHERE id_match = $1
           AND round = 0 AND status = 'pending'
           AND ((player1_id IS NULL AND player1_source_group IS NULL)
             OR (player2_id IS NULL AND player2_source_group IS NULL))
         FOR UPDATE`,
        [matchId]
      );
      const match = matchRes.rows[0];
      if (!match) {
        return { added: false, error: "PRE_ROUND_SLOT_NOT_FOUND" as BracketsError };
      }
      const { id_tournament: tournamentId, id_category: categoryId } = match;

      const phaseRes = await client.query<{ phase: string }>(
        `SELECT phase FROM tournament_categories WHERE id_category = $1 FOR UPDATE`,
        [categoryId]
      );
      if ((phaseRes.rows[0]?.phase ?? "enrollment") !== "bracket") {
        return { added: false, error: "BRACKET_LOCKED" as BracketsError };
      }

      const opponentId = match.player1_id ?? match.player2_id;
      if (!opponentId) {
        return { added: false, error: "PRE_ROUND_SLOT_NOT_FOUND" as BracketsError };
      }
      if (opponentId === userId) {
        return { added: false, error: "DUPLICATE_PLAYER" as BracketsError };
      }

      const enrolledRes = await client.query(
        `SELECT 1 FROM enrollments
         WHERE id_user = $1 AND id_tournament = $2 AND id_category = $3 AND status = 'active'`,
        [userId, tournamentId, categoryId]
      );
      if ((enrolledRes.rowCount ?? 0) === 0) {
        return { added: false, error: "PLAYER_NOT_ENROLLED" as BracketsError };
      }

      const alreadyInBracketRes = await client.query(
        `SELECT 1 FROM bracket_matches
         WHERE id_tournament = $1 AND id_category = $2 AND (player1_id = $3 OR player2_id = $3)`,
        [tournamentId, categoryId, userId]
      );
      if ((alreadyInBracketRes.rowCount ?? 0) > 0) {
        return { added: false, error: "ALREADY_IN_BRACKET" as BracketsError };
      }

      await client.query(
        match.player1_id === null
          ? `UPDATE bracket_matches SET player1_id = $1, status = 'ready' WHERE id_match = $2`
          : `UPDATE bracket_matches SET player2_id = $1, status = 'ready' WHERE id_match = $2`,
        [userId, matchId]
      );

      const ctx = await this.getTournamentCategoryNames(tournamentId, categoryId);
      if (ctx) {
        await this.notifications.createForMany(
          [userId, opponentId],
          {
            type: "bracket_changed",
            title: "Nuevo partido de pre-llave",
            message: `Se armó tu partido de pre-llave de ${ctx.categoryType} ${ctx.categoryRange} (${ctx.tournamentName}). Mira contra quién te toca.`,
            idTournament: tournamentId,
            idCategory: categoryId,
          },
          client
        );
      }

      return { added: true, opponentId };
    });
  }

  // Árbitro sugerido/anotado para un partido puntual — no es un rol oficial,
  // así que no valida nada (puede ser cualquier inscrito, o limpiarse con null).
  // ¿Está esta persona en una mesa del torneo (jugando o arbitrando un
  // partido con mesa asignada), sin contar el partido [exceptMatch]?
  private async isAtOtherTable(idTournament: string, idUser: string, exceptMatch: string): Promise<boolean> {
    const r = await this.pool.query(
      `SELECT 1 FROM group_matches gm JOIN category_groups cg ON cg.id_group = gm.id_group
        WHERE cg.id_tournament = $1 AND gm.table_number IS NOT NULL AND gm.id_match <> $3
          AND $2 IN (gm.player1_id, gm.player2_id, gm.referee_id)
       UNION ALL
       SELECT 1 FROM bracket_matches bm
        WHERE bm.id_tournament = $1 AND bm.table_number IS NOT NULL AND bm.id_match <> $3
          AND $2 IN (bm.player1_id, bm.player2_id, bm.referee_id)
       LIMIT 1`,
      [idTournament, idUser, exceptMatch]
    );
    return (r.rowCount ?? 0) > 0;
  }

  async setGroupMatchReferee(matchId: string, refereeId: string | null): Promise<"ok" | "not_found" | "own_match" | "referee_busy"> {
    const cur = await this.pool.query<{ player1_id: string | null; player2_id: string | null; table_number: number | null; id_tournament: string }>(
      `SELECT gm.player1_id, gm.player2_id, gm.table_number, cg.id_tournament
         FROM group_matches gm JOIN category_groups cg ON cg.id_group = gm.id_group
        WHERE gm.id_match = $1`,
      [matchId]
    );
    const m = cur.rows[0];
    if (!m) return "not_found";
    // Nadie arbitra su propio partido.
    if (refereeId && (refereeId === m.player1_id || refereeId === m.player2_id)) return "own_match";
    // Partido ya en mesa: el árbitro no puede estar en otra mesa a la vez.
    if (refereeId && m.table_number != null && (await this.isAtOtherTable(m.id_tournament, refereeId, matchId))) return "referee_busy";
    await this.pool.query(`UPDATE group_matches SET referee_id = $1 WHERE id_match = $2`, [refereeId, matchId]);
    return "ok";
  }

  // Corrige el formato de una categoría ya armada: mejor de N, sets a 11. Lo
  // jugado no se toca: esos resultados quedarían fuera de regla.
  async setPendingMatchesBestOf(tournamentId: string, categoryId: string, bestOfSets: number): Promise<number> {
    const groups = await this.pool.query(
      `UPDATE group_matches gm SET best_of_sets = $1, points_per_set = 11
         FROM category_groups cg
        WHERE cg.id_group = gm.id_group AND cg.id_tournament = $2 AND cg.id_category = $3
          AND (gm.best_of_sets <> $1 OR gm.points_per_set <> 11) AND gm.status NOT IN ('played', 'walkover')`,
      [bestOfSets, tournamentId, categoryId]
    );
    const bracket = await this.pool.query(
      `UPDATE bracket_matches SET best_of_sets = $1, points_per_set = 11
        WHERE id_tournament = $2 AND id_category = $3
          AND (best_of_sets <> $1 OR points_per_set <> 11) AND status NOT IN ('played', 'walkover', 'bye')`,
      [bestOfSets, tournamentId, categoryId]
    );
    return (groups.rowCount ?? 0) + (bracket.rowCount ?? 0);
  }

  async setBracketMatchReferee(matchId: string, refereeId: string | null): Promise<"ok" | "not_found" | "own_match" | "referee_busy"> {
    const cur = await this.pool.query<{ player1_id: string | null; player2_id: string | null; table_number: number | null; id_tournament: string }>(
      `SELECT player1_id, player2_id, table_number, id_tournament FROM bracket_matches WHERE id_match = $1`,
      [matchId]
    );
    const m = cur.rows[0];
    if (!m) return "not_found";
    // Nadie arbitra su propio partido.
    if (refereeId && (refereeId === m.player1_id || refereeId === m.player2_id)) return "own_match";
    // Partido ya en mesa: el árbitro no puede estar en otra mesa a la vez.
    if (refereeId && m.table_number != null && (await this.isAtOtherTable(m.id_tournament, refereeId, matchId))) return "referee_busy";
    await this.pool.query(`UPDATE bracket_matches SET referee_id = $1 WHERE id_match = $2`, [refereeId, matchId]);
    return "ok";
  }
}
