import type { Pool, PoolClient } from "pg";
import { randomUUID } from "crypto";
import DB from "../db/db_configuration";
import { hashPassword } from "../bcrypt/bcrypt";
import { ROLE_IDS } from "../core/constants/roles";
import { roundRobinSchedule } from "./round_robin";

export type LeagueScoring = "2-1-0" | "3-0";

export type LeagueListRow = {
  id_league: string;
  name: string;
  season: string | null;
  scoring: LeagueScoring;
  visibility: string;
  is_ranked: boolean;
  category_type: string;
  category_range: string;
  gender: string;
  format: string;
  division_count: number;
  player_count: number;
};

export type LeaguePlayer = {
  id_user: string;
  name: string;
  is_team: boolean;
};

export type LeagueMatch = {
  id_match: string;
  jornada: number;
  match_number: number;
  player1_id: string;
  player2_id: string;
  winner_id: string | null;
  sets_player1: number;
  sets_player2: number;
  status: string;
  best_of_sets: number;
};

export type LeagueStandingRow = {
  id_user: string;
  name: string;
  played: number;
  won: number;
  lost: number;
  sets_for: number;
  sets_against: number;
  points: number;
  position: number;
};

export type LeagueDivision = {
  id_division: string;
  name: string;
  status: string; // 'draft' = roster abierto | 'active' = fixture generado | 'finished'
  players: LeaguePlayer[];
  matches: LeagueMatch[];
  standings: LeagueStandingRow[];
};

export type LeagueDetail = {
  id_league: string;
  id_category: string;
  name: string;
  region: string | null;
  season: string | null;
  scoring: LeagueScoring;
  visibility: string;
  is_ranked: boolean;
  category_type: string;
  category_range: string;
  gender: string;
  format: string; // 'singles' | 'doubles'
  best_of_sets: number;
  divisions: LeagueDivision[];
};

// CONCAT (no `||`) porque `NULL || 'x'` = NULL en SQL — un walk-in o un
// usuario equipo (is_team) solo tiene first_name, así el nombre no se caía
// al email sintético.
const NAME_SQL = `COALESCE(NULLIF(TRIM(CONCAT(u.last_name, ' ', u.first_name)), ''), NULLIF(TRIM(u.first_name), ''), u.email)`;

function computePoints(scoring: LeagueScoring, won: number, lost: number): number {
  return scoring === "3-0" ? won * 3 : won * 2 + lost * 1;
}

export class LeaguesRepository {
  private pool: Pool;
  constructor(pool?: Pool) {
    this.pool = pool ?? DB.getPool();
  }

  private async withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const out = await fn(client);
      await client.query("COMMIT");
      return out;
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      throw e;
    } finally {
      client.release();
    }
  }

  // ─────────────────────────────────────────────────────────
  async createLeague(input: {
    created_by: string;
    name: string;
    region: string | null;
    visibility: string;
    is_ranked: boolean;
    season: string | null;
    scoring: LeagueScoring;
    category_type: string;
    category_range: string;
    gender: "male" | "female" | "mixed";
    format: "singles" | "doubles";
    best_of_sets: 3 | 5 | 7;
  }): Promise<string> {
    return this.withTx(async (c) => {
      const t = await c.query<{ id_tournament: string }>(
        `INSERT INTO tournaments
           (tournament_name, created_by, allow_mixed, allow_olympic, region, visibility, is_ranked, kind, event_date)
         VALUES ($1, $2, TRUE, FALSE, $3, $4, $5, 'league', NULL)
         RETURNING id_tournament`,
        [input.name.trim(), input.created_by, input.region, input.visibility, input.is_ranked]
      );
      const idLeague = t.rows[0].id_tournament;

      // Una categoría, ya en fase 'groups' (la liga "está jugándose" desde
      // que se crea — no hay inscripción/sembrado/llave).
      const cat = await c.query<{ id_category: string }>(
        `INSERT INTO tournament_categories
           (id_tournament, category_type, category_range, gender, inscription_price, quotas, status, phase, format)
         VALUES ($1, $2, $3, $4, 0, NULL, 'active', 'groups', $5)
         RETURNING id_category`,
        [idLeague, input.category_type.trim(), input.category_range.trim() || "General", input.gender,
         input.format === "doubles" ? "doubles" : "singles"]
      );
      const idCategory = cat.rows[0].id_category;

      await c.query(
        `INSERT INTO league_config (id_tournament, season, scoring) VALUES ($1, $2, $3)`,
        [idLeague, input.season, input.scoring]
      );

      await this.insertDivision(c, idLeague, idCategory, "División 1", 1);

      return idLeague;
    });
  }

  private async insertDivision(c: PoolClient, idLeague: string, idCategory: string, name: string, sortOrder: number): Promise<string> {
    const r = await c.query<{ id_group: string }>(
      `INSERT INTO category_groups
         (id_tournament, id_category, group_name, target_size, sort_order, status, group_kind, qualifiers_per_group)
       VALUES ($1, $2, $3, 2, $4, 'draft', 'league', 2)
       RETURNING id_group`,
      [idLeague, idCategory, name.slice(0, 10), sortOrder]
    );
    return r.rows[0].id_group;
  }

  async addDivision(idLeague: string, name: string): Promise<void> {
    await this.withTx(async (c) => {
      const cat = await c.query<{ id_category: string }>(
        `SELECT id_category FROM tournament_categories WHERE id_tournament = $1 LIMIT 1`,
        [idLeague]
      );
      if (cat.rowCount === 0) throw new Error("LEAGUE_NOT_FOUND");
      const ord = await c.query<{ max: number }>(
        `SELECT COALESCE(MAX(sort_order), 0) AS max FROM category_groups WHERE id_tournament = $1`,
        [idLeague]
      );
      await this.insertDivision(c, idLeague, cat.rows[0].id_category, name, Number(ord.rows[0].max) + 1);
    });
  }

  // ─────────────────────────────────────────────────────────
  async listMine(idAdmin: string): Promise<LeagueListRow[]> {
    const res = await this.pool.query<LeagueListRow>(
      `SELECT
         t.id_tournament AS id_league,
         t.tournament_name AS name,
         lc.season,
         lc.scoring,
         t.visibility,
         t.is_ranked,
         tc.category_type,
         tc.category_range,
         tc.gender,
         tc.format,
         (SELECT COUNT(*) FROM category_groups g WHERE g.id_tournament = t.id_tournament)::int AS division_count,
         (SELECT COUNT(*) FROM group_members gm
          JOIN category_groups g ON g.id_group = gm.id_group
          WHERE g.id_tournament = t.id_tournament)::int AS player_count
       FROM tournaments t
       JOIN league_config lc ON lc.id_tournament = t.id_tournament
       JOIN tournament_categories tc ON tc.id_tournament = t.id_tournament
       WHERE t.kind = 'league' AND t.created_by = $1 AND t.status <> 'cancelled'
       ORDER BY t.created_at DESC`,
      [idAdmin]
    );
    return res.rows;
  }

  async getDetail(idLeague: string): Promise<LeagueDetail | null> {
    const head = await this.pool.query<{
      id_league: string; id_category: string; name: string; region: string | null;
      season: string | null; scoring: LeagueScoring; visibility: string; is_ranked: boolean;
      category_type: string; category_range: string; gender: string; format: string; best_of_sets: number;
    }>(
      `SELECT
         t.id_tournament AS id_league, tc.id_category, t.tournament_name AS name, t.region,
         lc.season, lc.scoring, t.visibility, t.is_ranked,
         tc.category_type, tc.category_range, tc.gender, tc.format,
         COALESCE(t.default_best_of_sets, 3) AS best_of_sets
       FROM tournaments t
       JOIN league_config lc ON lc.id_tournament = t.id_tournament
       JOIN tournament_categories tc ON tc.id_tournament = t.id_tournament
       WHERE t.id_tournament = $1 AND t.kind = 'league'`,
      [idLeague]
    );
    if (head.rowCount === 0) return null;
    const h = head.rows[0];

    const divs = await this.pool.query<{ id_group: string; group_name: string; status: string }>(
      `SELECT id_group, group_name, status FROM category_groups
       WHERE id_tournament = $1 ORDER BY sort_order ASC`,
      [idLeague]
    );

    const [membersRes, matchesRes, standRes] = await Promise.all([
      this.pool.query<{ id_group: string; id_user: string; name: string; is_team: boolean }>(
        `SELECT gm.id_group, gm.id_user, ${NAME_SQL} AS name, u.is_team
         FROM group_members gm JOIN users u ON u.id_user = gm.id_user
         JOIN category_groups g ON g.id_group = gm.id_group
         WHERE g.id_tournament = $1
         ORDER BY name ASC`,
        [idLeague]
      ),
      this.pool.query<any>(
        `SELECT m.id_group, m.id_match, m.round_number AS jornada, m.match_number,
                m.player1_id, m.player2_id, m.winner_id, m.sets_player1, m.sets_player2,
                m.status, m.best_of_sets
         FROM group_matches m
         JOIN category_groups g ON g.id_group = m.id_group
         WHERE g.id_tournament = $1
         ORDER BY m.round_number ASC, m.match_number ASC`,
        [idLeague]
      ),
      this.pool.query<any>(
        `SELECT s.id_group, s.id_user, ${NAME_SQL} AS name,
                s.played, s.won, s.lost, s.sets_for, s.sets_against
         FROM group_standings s JOIN users u ON u.id_user = s.id_user
         JOIN category_groups g ON g.id_group = s.id_group
         WHERE g.id_tournament = $1`,
        [idLeague]
      ),
    ]);

    const divisions: LeagueDivision[] = divs.rows.map((d) => {
      const players = membersRes.rows
        .filter((m) => m.id_group === d.id_group)
        .map((m) => ({ id_user: m.id_user, name: m.name, is_team: m.is_team }));

      const matches: LeagueMatch[] = matchesRes.rows
        .filter((m) => m.id_group === d.id_group)
        .map((m) => ({
          id_match: m.id_match, jornada: Number(m.jornada), match_number: Number(m.match_number),
          player1_id: m.player1_id, player2_id: m.player2_id, winner_id: m.winner_id,
          sets_player1: Number(m.sets_player1), sets_player2: Number(m.sets_player2),
          status: m.status, best_of_sets: Number(m.best_of_sets),
        }));

      const rawStand = standRes.rows
        .filter((s) => s.id_group === d.id_group)
        .map((s) => {
          const won = Number(s.won), lost = Number(s.lost);
          return {
            id_user: s.id_user, name: s.name,
            played: Number(s.played), won, lost,
            sets_for: Number(s.sets_for), sets_against: Number(s.sets_against),
            points: computePoints(h.scoring, won, lost),
          };
        });

      rawStand.sort(
        (a, b) =>
          b.points - a.points ||
          (b.sets_for - b.sets_against) - (a.sets_for - a.sets_against) ||
          b.won - a.won ||
          a.name.localeCompare(b.name)
      );
      const standings: LeagueStandingRow[] = rawStand.map((s, i) => ({ ...s, position: i + 1 }));

      return { id_division: d.id_group, name: d.group_name, status: d.status, players, matches, standings };
    });

    return {
      id_league: h.id_league, id_category: h.id_category, name: h.name, region: h.region,
      season: h.season, scoring: h.scoring, visibility: h.visibility, is_ranked: h.is_ranked,
      category_type: h.category_type, category_range: h.category_range, gender: h.gender,
      format: h.format ?? "singles",
      best_of_sets: Number(h.best_of_sets), divisions,
    };
  }

  // ─────────────────────────────────────────────────────────
  async addPlayer(idLeague: string, idDivision: string, idUser: string): Promise<{ ok: true } | { ok: false; error: string }> {
    return this.withTx(async (c) => {
      const d = await c.query<{ status: string; id_category: string; format: string }>(
        `SELECT g.status, g.id_category, tc.format
         FROM category_groups g JOIN tournament_categories tc ON tc.id_category = g.id_category
         WHERE g.id_group = $1 AND g.id_tournament = $2`,
        [idDivision, idLeague]
      );
      if (d.rowCount === 0) return { ok: false as const, error: "DIVISION_NOT_FOUND" };
      if (d.rows[0].status !== "draft") return { ok: false as const, error: "FIXTURE_ALREADY_GENERATED" };
      if (d.rows[0].format === "doubles") return { ok: false as const, error: "LEAGUE_IS_DOUBLES" };

      const dup = await c.query(`SELECT 1 FROM group_members WHERE id_group = $1 AND id_user = $2`, [idDivision, idUser]);
      if ((dup.rowCount ?? 0) > 0) return { ok: false as const, error: "ALREADY_IN_DIVISION" };

      const u = await c.query(`SELECT 1 FROM users WHERE id_user = $1`, [idUser]);
      if (u.rowCount === 0) return { ok: false as const, error: "PLAYER_NOT_FOUND" };

      await c.query(
        `INSERT INTO group_members (id_group, id_user, assignment_type) VALUES ($1, $2, 'manual')`,
        [idDivision, idUser]
      );
      await c.query(
        `INSERT INTO group_standings (id_group, id_user) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [idDivision, idUser]
      );
      await c.query(
        `INSERT INTO enrollments (id_user, id_tournament, id_category, qualification_type, checked_in)
         VALUES ($1, $2, $3, 'group', true)
         ON CONFLICT (id_user, id_tournament, id_category) DO UPDATE SET status = 'active'`,
        [idUser, idLeague, d.rows[0].id_category]
      );
      return { ok: true as const };
    });
  }

  // Liga de DOBLES: cada "jugador" de una división es una pareja (un
  // usuario equipo, is_team). Mismo criterio que las categorías de dobles
  // (ver doubles_repository) — mixto exige 1 varón + 1 dama si ambos
  // géneros están cargados.
  async addPair(
    idLeague: string, idDivision: string, player1Id: string, player2Id: string
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (player1Id === player2Id) return { ok: false, error: "SAME_PLAYER" };
    return this.withTx(async (c) => {
      const d = await c.query<{ status: string; id_category: string; format: string; gender: string }>(
        `SELECT g.status, g.id_category, tc.format, tc.gender
         FROM category_groups g JOIN tournament_categories tc ON tc.id_category = g.id_category
         WHERE g.id_group = $1 AND g.id_tournament = $2`,
        [idDivision, idLeague]
      );
      if (d.rowCount === 0) return { ok: false as const, error: "DIVISION_NOT_FOUND" };
      if (d.rows[0].status !== "draft") return { ok: false as const, error: "FIXTURE_ALREADY_GENERATED" };
      if (d.rows[0].format !== "doubles") return { ok: false as const, error: "LEAGUE_IS_SINGLES" };
      const idCategory = d.rows[0].id_category;

      const pl = await c.query<{ id_user: string; first_name: string | null; last_name: string | null; gender: string | null }>(
        `SELECT id_user, first_name, last_name, gender FROM users WHERE id_user = ANY($1::uuid[])`,
        [[player1Id, player2Id]]
      );
      if (pl.rows.length !== 2) return { ok: false as const, error: "PLAYER_NOT_FOUND" };
      const p1 = pl.rows.find((r) => r.id_user === player1Id)!;
      const p2 = pl.rows.find((r) => r.id_user === player2Id)!;
      if (d.rows[0].gender === "mixed" && p1.gender && p2.gender && p1.gender === p2.gender) {
        return { ok: false as const, error: "MIXED_RULE" };
      }

      const dup = await c.query(
        `SELECT 1 FROM doubles_teams
         WHERE id_category = $1 AND (id_player_1 = ANY($2::uuid[]) OR id_player_2 = ANY($2::uuid[])) LIMIT 1`,
        [idCategory, [player1Id, player2Id]]
      );
      if ((dup.rowCount ?? 0) > 0) return { ok: false as const, error: "ALREADY_IN_TEAM" };

      const label = (a: typeof p1) =>
        [a.first_name, a.last_name].filter(Boolean).join(" ").trim() || "Jugador";
      const teamLabel = `${label(p1)} / ${label(p2)}`;
      const email = `team+${randomUUID()}@myttm.local`;
      const pwd = await hashPassword(randomUUID());
      const teamRes = await c.query<{ id_user: string }>(
        `INSERT INTO users (email, password_hash, id_role, first_name, is_team)
         VALUES ($1, $2, $3, $4, true) RETURNING id_user`,
        [email, pwd, ROLE_IDS.player, teamLabel]
      );
      const teamUserId = teamRes.rows[0].id_user;

      await c.query(
        `INSERT INTO doubles_teams (id_user, id_player_1, id_player_2, id_category) VALUES ($1, $2, $3, $4)`,
        [teamUserId, player1Id, player2Id, idCategory]
      );
      await c.query(
        `INSERT INTO group_members (id_group, id_user, assignment_type) VALUES ($1, $2, 'manual')`,
        [idDivision, teamUserId]
      );
      await c.query(
        `INSERT INTO group_standings (id_group, id_user) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [idDivision, teamUserId]
      );
      await c.query(
        `INSERT INTO enrollments (id_user, id_tournament, id_category, qualification_type, checked_in)
         VALUES ($1, $2, $3, 'group', true)`,
        [teamUserId, idLeague, idCategory]
      );
      return { ok: true as const };
    });
  }

  async removePlayer(idLeague: string, idDivision: string, idUser: string): Promise<{ ok: true } | { ok: false; error: string }> {
    return this.withTx(async (c) => {
      const d = await c.query<{ status: string; id_category: string }>(
        `SELECT status, id_category FROM category_groups WHERE id_group = $1 AND id_tournament = $2`,
        [idDivision, idLeague]
      );
      if (d.rowCount === 0) return { ok: false as const, error: "DIVISION_NOT_FOUND" };
      if (d.rows[0].status !== "draft") return { ok: false as const, error: "FIXTURE_ALREADY_GENERATED" };

      const isTeam = await c.query<{ is_team: boolean }>(`SELECT is_team FROM users WHERE id_user = $1`, [idUser]);
      if (isTeam.rows[0]?.is_team) {
        // Borra el usuario equipo → arrastra doubles_teams, group_members,
        // group_standings y enrollments por ON DELETE CASCADE.
        await c.query(`DELETE FROM users WHERE id_user = $1 AND is_team = true`, [idUser]);
        return { ok: true as const };
      }

      await c.query(`DELETE FROM group_members WHERE id_group = $1 AND id_user = $2`, [idDivision, idUser]);
      await c.query(`DELETE FROM group_standings WHERE id_group = $1 AND id_user = $2`, [idDivision, idUser]);
      await c.query(
        `UPDATE enrollments SET status = 'cancelled'
         WHERE id_user = $1 AND id_tournament = $2 AND id_category = $3`,
        [idUser, idLeague, d.rows[0].id_category]
      );
      return { ok: true as const };
    });
  }

  async generateFixture(idLeague: string, idDivision: string): Promise<{ ok: true; jornadas: number } | { ok: false; error: string }> {
    return this.withTx(async (c) => {
      const d = await c.query<{ status: string; id_category: string }>(
        `SELECT status, id_category FROM category_groups WHERE id_group = $1 AND id_tournament = $2 FOR UPDATE`,
        [idDivision, idLeague]
      );
      if (d.rowCount === 0) return { ok: false as const, error: "DIVISION_NOT_FOUND" };
      if (d.rows[0].status !== "draft") return { ok: false as const, error: "FIXTURE_ALREADY_GENERATED" };

      const members = await c.query<{ id_user: string }>(
        `SELECT id_user FROM group_members WHERE id_group = $1`,
        [idDivision]
      );
      const ids = members.rows.map((r) => r.id_user);
      if (ids.length < 3) return { ok: false as const, error: "NOT_ENOUGH_PLAYERS" };

      const bestOf = await c.query<{ n: number }>(
        `SELECT COALESCE(default_best_of_sets, 3) AS n FROM tournaments WHERE id_tournament = $1`,
        [idLeague]
      );
      const bestOfSets = Number(bestOf.rows[0]?.n ?? 3);

      const schedule = roundRobinSchedule(ids);
      let matchNumber = 1;
      for (let j = 0; j < schedule.length; j++) {
        for (const [p1, p2] of schedule[j]) {
          await c.query(
            `INSERT INTO group_matches
               (id_group, id_tournament, id_category, round_number, match_number, best_of_sets, player1_id, player2_id, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled')`,
            [idDivision, idLeague, d.rows[0].id_category, j + 1, matchNumber++, bestOfSets, p1, p2]
          );
        }
      }

      await c.query(
        `UPDATE category_groups SET status = 'active', target_size = $2 WHERE id_group = $1`,
        [idDivision, Math.min(64, Math.max(2, ids.length))]
      );
      return { ok: true as const, jornadas: schedule.length };
    });
  }

  async deleteLeague(idLeague: string): Promise<void> {
    // ON DELETE CASCADE limpia categorías, grupos, partidos, standings,
    // inscripciones y league_config.
    await this.pool.query(`DELETE FROM tournaments WHERE id_tournament = $1 AND kind = 'league'`, [idLeague]);
  }
}
