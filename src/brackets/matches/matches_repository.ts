import type { Pool } from "pg";
import DB from "../../db/db_configuration";

export type PlayerInfo = {
  id_user:    string;
  first_name: string | null;
  last_name:  string | null;
  email:      string;
};

export type GroupMatchDetail = {
  id_match:     string;
  id_group:     string;
  group_name:   string;
  match_number: number;
  best_of_sets: number;
  player1:      PlayerInfo | null;
  player2:      PlayerInfo | null;
  winner_id:    string | null;
  sets_player1: number | null;
  sets_player2: number | null;
  walkover:     boolean;
  status:       string;
};

export type BracketMatchDetail = {
  id_match:     string;
  round:        number;
  match_number: number;
  best_of_sets: number;
  player1:      PlayerInfo | null;
  player2:      PlayerInfo | null;
  winner_id:    string | null;
  sets_player1: number | null;
  sets_player2: number | null;
  walkover:     boolean;
  is_bye:       boolean;
};

export type AllMatchesResult = {
  phase:   string;
  groups:  { id_group: string; group_name: string; matches: GroupMatchDetail[] }[];
  bracket: { round: number; round_label: string; matches: BracketMatchDetail[] }[];
};

export class MatchesRepository {
  private pool: Pool;
  constructor(pool?: Pool) { this.pool = pool ?? DB.getPool(); }

  async getAllMatches(id_tournament: string, id_category: string): Promise<AllMatchesResult> {
    // Fase actual
    const phaseRes = await this.pool.query<{ phase: string }>(
      `SELECT COALESCE(phase, 'enrollment') AS phase
       FROM tournament_categories WHERE id_category = $1`,
      [id_category]
    );
    const phase = phaseRes.rows[0]?.phase ?? "enrollment";

    // Partidos de grupo con nombres de jugadores
    const groupMatchesRes = await this.pool.query<{
      id_match: string; id_group: string; group_name: string;
      match_number: number; best_of_sets: number;
      p1_id: string | null; p1_first: string | null; p1_last: string | null; p1_email: string | null;
      p2_id: string | null; p2_first: string | null; p2_last: string | null; p2_email: string | null;
      winner_id: string | null; sets_player1: number | null; sets_player2: number | null;
      walkover: boolean; status: string;
    }>(
      `SELECT
         gm.id_match, gm.id_group, cg.group_name, gm.match_number, gm.best_of_sets,
         u1.id_user  AS p1_id, u1.first_name AS p1_first, u1.last_name AS p1_last, u1.email AS p1_email,
         u2.id_user  AS p2_id, u2.first_name AS p2_first, u2.last_name AS p2_last, u2.email AS p2_email,
         gm.winner_id, gm.sets_player1, gm.sets_player2,
         COALESCE(gm.status = 'walkover', false) AS walkover,
         gm.status
       FROM group_matches gm
       JOIN category_groups cg ON cg.id_group = gm.id_group
       LEFT JOIN users u1 ON u1.id_user = gm.player1_id
       LEFT JOIN users u2 ON u2.id_user = gm.player2_id
       WHERE cg.id_tournament = $1 AND cg.id_category = $2
       ORDER BY cg.sort_order ASC, gm.match_number ASC`,
      [id_tournament, id_category]
    );

    // Partidos de llave con nombres de jugadores
    const bracketRes = await this.pool.query<{
      id_match: string; round: number; match_number: number; best_of_sets: number;
      p1_id: string | null; p1_first: string | null; p1_last: string | null; p1_email: string | null;
      p2_id: string | null; p2_first: string | null; p2_last: string | null; p2_email: string | null;
      winner_id: string | null; sets_player1: number | null; sets_player2: number | null;
      walkover: boolean; is_bye: boolean;
    }>(
      `SELECT
         bm.id_match, bm.round, bm.match_number, bm.best_of_sets,
         u1.id_user  AS p1_id, u1.first_name AS p1_first, u1.last_name AS p1_last, u1.email AS p1_email,
         u2.id_user  AS p2_id, u2.first_name AS p2_first, u2.last_name AS p2_last, u2.email AS p2_email,
         bm.winner_id, bm.sets_player1, bm.sets_player2,
         COALESCE(bm.walkover, false) AS walkover,
         COALESCE(bm.is_bye, false)   AS is_bye
       FROM bracket_matches bm
       LEFT JOIN users u1 ON u1.id_user = bm.player1_id
       LEFT JOIN users u2 ON u2.id_user = bm.player2_id
       WHERE bm.id_tournament = $1 AND bm.id_category = $2
       ORDER BY bm.round ASC, bm.match_number ASC`,
      [id_tournament, id_category]
    );

    // Agrupar partidos de grupo por grupo
    const groupMap = new Map<string, { id_group: string; group_name: string; matches: GroupMatchDetail[] }>();
    for (const r of groupMatchesRes.rows) {
      if (!groupMap.has(r.id_group)) {
        groupMap.set(r.id_group, { id_group: r.id_group, group_name: r.group_name, matches: [] });
      }
      groupMap.get(r.id_group)!.matches.push({
        id_match:     r.id_match,
        id_group:     r.id_group,
        group_name:   r.group_name,
        match_number: r.match_number,
        best_of_sets: r.best_of_sets,
        player1: r.p1_id ? { id_user: r.p1_id, first_name: r.p1_first, last_name: r.p1_last, email: r.p1_email! } : null,
        player2: r.p2_id ? { id_user: r.p2_id, first_name: r.p2_first, last_name: r.p2_last, email: r.p2_email! } : null,
        winner_id:    r.winner_id,
        sets_player1: r.sets_player1,
        sets_player2: r.sets_player2,
        walkover:     r.walkover,
        status:       r.status,
      });
    }

    // Agrupar partidos de llave por ronda con label
    const totalRounds = bracketRes.rows.length > 0
      ? Math.max(...bracketRes.rows.map(r => r.round))
      : 0;

    const roundLabel = (round: number) => {
      const fromFinal = totalRounds - round;
      if (fromFinal === 0) return "Final";
      if (fromFinal === 1) return "Semifinal";
      if (fromFinal === 2) return "Cuartos de final";
      return `Ronda ${round}`;
    };

    const bracketMap = new Map<number, { round: number; round_label: string; matches: BracketMatchDetail[] }>();
    for (const r of bracketRes.rows) {
      if (!bracketMap.has(r.round)) {
        bracketMap.set(r.round, { round: r.round, round_label: roundLabel(r.round), matches: [] });
      }
      bracketMap.get(r.round)!.matches.push({
        id_match:     r.id_match,
        round:        r.round,
        match_number: r.match_number,
        best_of_sets: r.best_of_sets,
        player1: r.p1_id ? { id_user: r.p1_id, first_name: r.p1_first, last_name: r.p1_last, email: r.p1_email! } : null,
        player2: r.p2_id ? { id_user: r.p2_id, first_name: r.p2_first, last_name: r.p2_last, email: r.p2_email! } : null,
        winner_id:    r.winner_id,
        sets_player1: r.sets_player1,
        sets_player2: r.sets_player2,
        walkover:     r.walkover,
        is_bye:       r.is_bye,
      });
    }

    return {
      phase,
      groups:  Array.from(groupMap.values()),
      bracket: Array.from(bracketMap.values()).sort((a, b) => a.round - b.round),
    };
  }
}
