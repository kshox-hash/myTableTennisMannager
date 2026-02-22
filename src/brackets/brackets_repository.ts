// src/brackets/brackets_repository.ts
import type { PoolClient } from "pg";

type CompetitionConfigRow = {
  id_competition: string;
  advance_per_group: number;
  best_of_bracket: number;
  best_of_final: number;
  status: string;
};

type BracketRow = { id_bracket: string };

type MatchRow = {
  id_match: string;
  round_number: number;
  match_number: number;
  player1_id: string | null;
  player2_id: string | null;
  winner_id: string | null;
  status: "scheduled" | "played" | "walkover";
};

export class BracketRepository {
  private usersTable = "users";
  private rolesTable = "roles";

  private compsTable = "category_competitions";
  private groupsTable = "groups";
  private standingsTable = "group_standings";

  private bracketsTable = "brackets";
  private seedsTable = "bracket_seeds";
  private matchesTable = "matches";
  private bracketMatchesTable = "bracket_matches";

  // -------------------------
  // Admin check (sin auth)
  // -------------------------
  async assertUserIsAdmin(client: PoolClient, userId: string) {
    const q = `
      SELECT u.id_user
      FROM ${this.usersTable} u
      JOIN ${this.rolesTable} r ON r.id_role = u.id_role
      WHERE u.id_user = $1 AND r.name = 'admin'
      LIMIT 1;
    `;
    const res = await client.query(q, [userId]);
    if (res.rows.length === 0) throw new Error("USER_NOT_ADMIN");
  }

  // -------------------------
  // Competition config (lock)
  // -------------------------
  async getCompetitionForUpdate(
    client: PoolClient,
    tournamentId: string,
    categoryId: string
  ): Promise<CompetitionConfigRow> {
    const q = `
      SELECT id_competition, advance_per_group, best_of_bracket, best_of_final, status
      FROM ${this.compsTable}
      WHERE id_tournament = $1 AND id_category = $2
      FOR UPDATE;
    `;
    const res = await client.query(q, [tournamentId, categoryId]);
    if (res.rows.length === 0) throw new Error("COMPETITION_NOT_FOUND");
    return res.rows[0] as CompetitionConfigRow;
  }

  async hasBracket(client: PoolClient, competitionId: string): Promise<boolean> {
    const q = `
      SELECT 1
      FROM ${this.bracketsTable}
      WHERE id_competition = $1
      LIMIT 1;
    `;
    const res = await client.query(q, [competitionId]);
    return res.rows.length > 0;
  }

  // -------------------------
  // Clasificados: top N por grupo (por posición)
  // -------------------------
  async getQualifiedFromGroups(
    client: PoolClient,
    competitionId: string,
    advancePerGroup: number
  ): Promise<{ id_user: string; id_group: string; group_rank: number }[]> {
    const q = `
      SELECT *
      FROM (
        SELECT
          gs.id_user,
          g.id_group,
          ROW_NUMBER() OVER (
            PARTITION BY g.id_group
            ORDER BY
              gs.points DESC,
              gs.won DESC,
              (gs.sets_for - gs.sets_against) DESC,
              gs.sets_for DESC
          ) AS group_rank
        FROM ${this.standingsTable} gs
        JOIN ${this.groupsTable} g ON g.id_group = gs.id_group
        WHERE g.id_competition = $1
      ) ranked
      WHERE group_rank <= $2
      ORDER BY id_group, group_rank;
    `;
    const res = await client.query(q, [competitionId, advancePerGroup]);
    return res.rows as { id_user: string; id_group: string; group_rank: number }[];
  }

  // -------------------------
  // Bracket + seeds
  // -------------------------
  async createBracket(
    client: PoolClient,
    competitionId: string,
    bracketSize: number
  ): Promise<BracketRow> {
    const q = `
      INSERT INTO ${this.bracketsTable} (id_competition, bracket_size, status)
      VALUES ($1, $2, 'generated')
      RETURNING id_bracket;
    `;
    const res = await client.query(q, [competitionId, bracketSize]);
    return { id_bracket: res.rows[0].id_bracket as string };
  }

  async insertSeeds(
    client: PoolClient,
    bracketId: string,
    seeds: { seed_number: number; id_user: string }[]
  ) {
    if (seeds.length === 0) return;

    const values: any[] = [];
    const placeholders: string[] = [];

    seeds.forEach((s, i) => {
      const base = i * 3;
      placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
      values.push(bracketId, s.seed_number, s.id_user);
    });

    const q = `
      INSERT INTO ${this.seedsTable} (id_bracket, seed_number, id_user)
      VALUES ${placeholders.join(",")}
      ON CONFLICT DO NOTHING;
    `;
    await client.query(q, values);
  }

  // =========================================================
  // ✅ NUEVO: Crear árbol completo de matches + links next_match
  // =========================================================

  // crea un match “vacío” (sin players aún), para bracket
  async createEmptyBracketMatch(
    client: PoolClient,
    competitionId: string,
    roundNumber: number,
    matchNumber: number,
    bestOf: number
  ): Promise<{ id_match: string }> {
    const q = `
      INSERT INTO ${this.matchesTable}
        (id_competition, stage, id_group, round_number, match_number, best_of_sets,
         player1_id, player2_id, winner_id, status)
      VALUES
        ($1, 'bracket', NULL, $2, $3, $4,
         NULL, NULL, NULL, 'scheduled')
      RETURNING id_match;
    `;
    const res = await client.query(q, [competitionId, roundNumber, matchNumber, bestOf]);
    return { id_match: res.rows[0].id_match as string };
  }

  // inserta/actualiza el link del árbol
  async upsertBracketMatchLink(
    client: PoolClient,
    bracketId: string,
    matchId: string,
    nextMatchId: string | null,
    nextSlot: 1 | 2 | null
  ) {
    const q = `
      INSERT INTO ${this.bracketMatchesTable} (id_bracket, id_match, next_match_id, next_slot)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id_bracket, id_match)
      DO UPDATE SET next_match_id = EXCLUDED.next_match_id,
                    next_slot = EXCLUDED.next_slot;
    `;
    await client.query(q, [bracketId, matchId, nextMatchId, nextSlot]);
  }

  // asigna players en ronda 1 (con BYE si player2 null)
  async setRound1Players(
    client: PoolClient,
    matchId: string,
    player1Id: string,
    player2Id: string | null
  ) {
    const isBye = player2Id === null;

    const q = `
      UPDATE ${this.matchesTable}
      SET
        player1_id = $2,
        player2_id = $3,
        winner_id  = ${isBye ? "$2" : "NULL"},
        status     = ${isBye ? "'walkover'" : "'scheduled'"},
        played_at  = ${isBye ? "NOW()" : "NULL"}
      WHERE id_match = $1;
    `;
    await client.query(q, [matchId, player1Id, player2Id]);
  }

  // leer match + asegurar que es bracket
  async getMatchForUpdate(client: PoolClient, matchId: string): Promise<MatchRow> {
    const q = `
      SELECT id_match, round_number, match_number, player1_id, player2_id, winner_id, status
      FROM ${this.matchesTable}
      WHERE id_match = $1
      FOR UPDATE;
    `;
    const res = await client.query(q, [matchId]);
    if (res.rows.length === 0) throw new Error("MATCH_NOT_FOUND");
    const row = res.rows[0] as any;
    return {
      id_match: row.id_match,
      round_number: row.round_number,
      match_number: row.match_number,
      player1_id: row.player1_id,
      player2_id: row.player2_id,
      winner_id: row.winner_id,
      status: row.status,
    };
  }

  async setMatchResult(
    client: PoolClient,
    matchId: string,
    winnerId: string,
    setsP1: number,
    setsP2: number
  ) {
    const q = `
      UPDATE ${this.matchesTable}
      SET winner_id = $2,
          sets_p1   = $3,
          sets_p2   = $4,
          status    = 'played',
          played_at = NOW()
      WHERE id_match = $1;
    `;
    await client.query(q, [matchId, winnerId, setsP1, setsP2]);
  }

  async getBracketLink(client: PoolClient, bracketId: string, matchId: string): Promise<{
    next_match_id: string | null;
    next_slot: 1 | 2 | null;
  }> {
    const q = `
      SELECT next_match_id, next_slot
      FROM ${this.bracketMatchesTable}
      WHERE id_bracket = $1 AND id_match = $2
      LIMIT 1;
    `;
    const res = await client.query(q, [bracketId, matchId]);
    if (res.rows.length === 0) throw new Error("BRACKET_LINK_NOT_FOUND");
    return {
      next_match_id: res.rows[0].next_match_id as string | null,
      next_slot: (res.rows[0].next_slot as 1 | 2 | null),
    };
  }

  // coloca ganador en el siguiente match (slot 1 o 2)
  async placeWinnerIntoNextMatch(
    client: PoolClient,
    nextMatchId: string,
    slot: 1 | 2,
    winnerId: string
  ) {
    const col = slot === 1 ? "player1_id" : "player2_id";
    const q = `
      UPDATE ${this.matchesTable}
      SET ${col} = $2
      WHERE id_match = $1;
    `;
    await client.query(q, [nextMatchId, winnerId]);
  }

  async setCompetitionStatus(
    client: PoolClient,
    competitionId: string,
    status: "generated_bracket" | "in_bracket" | "finished"
  ) {
    const q = `
      UPDATE ${this.compsTable}
      SET status = $1, generated_at = COALESCE(generated_at, NOW())
      WHERE id_competition = $2;
    `;
    await client.query(q, [status, competitionId]);
  }

  async setBracketStatus(
    client: PoolClient,
    bracketId: string,
    status: "generated" | "in_progress" | "finished"
  ) {
    const q = `
      UPDATE ${this.bracketsTable}
      SET status = $1
      WHERE id_bracket = $2;
    `;
    await client.query(q, [status, bracketId]);
  }
}
