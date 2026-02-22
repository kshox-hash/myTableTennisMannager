// src/competitions/competition_repository.ts
import type { PoolClient } from "pg";

type CategoryRow = { status: "open" | "closed" | "generated" };
type CompetitionRow = { id_competition: string };
type GroupRow = { id_group: string; group_name: string };

export class CompetitionRepository {
  private categoriesTable = "tournament_categories";
  private competitionsTable = "category_competitions";
  private compPlayersTable = "competition_players";

  private groupsTable = "groups";
  private groupMembersTable = "group_members";
  private groupStandingsTable = "group_standings";

  private matchesTable = "matches";
  private enrollmentsTable = "enrollments";

  private usersTable = "users";
  private rolesTable = "roles";

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

  async getCategoryForUpdate(client: PoolClient, tournamentId: string, categoryId: string): Promise<CategoryRow> {
    const q = `
      SELECT status
      FROM ${this.categoriesTable}
      WHERE id_category = $1 AND id_tournament = $2
      FOR UPDATE;
    `;
    const res = await client.query(q, [categoryId, tournamentId]);
    if (res.rows.length === 0) throw new Error("CATEGORY_NOT_FOUND");
    return res.rows[0] as CategoryRow;
  }

  async setCategoryStatus(client: PoolClient, categoryId: string, status: "open" | "closed" | "generated") {
    const q = `UPDATE ${this.categoriesTable} SET status = $1 WHERE id_category = $2;`;
    await client.query(q, [status, categoryId]);
  }

  async ensureCompetition(client: PoolClient, tournamentId: string, categoryId: string): Promise<CompetitionRow> {
    const find = `
      SELECT id_competition
      FROM ${this.competitionsTable}
      WHERE id_tournament = $1 AND id_category = $2
      LIMIT 1;
    `;
    const r1 = await client.query(find, [tournamentId, categoryId]);

    if (r1.rows.length > 0) {
      return { id_competition: r1.rows[0].id_competition as string };
    }

    const ins = `
      INSERT INTO ${this.competitionsTable} (id_tournament, id_category, format)
      VALUES ($1, $2, 'groups_then_bracket')
      RETURNING id_competition;
    `;
    const r2 = await client.query(ins, [tournamentId, categoryId]);
    return { id_competition: r2.rows[0].id_competition as string };
  }

  async hasGroups(client: PoolClient, competitionId: string) {
    const q = `
      SELECT 1
      FROM ${this.groupsTable}
      WHERE id_competition = $1
      LIMIT 1;
    `;
    const res = await client.query(q, [competitionId]);
    return res.rows.length > 0;
  }

  async getActivePlayersForCategory(
  client: PoolClient,
  tournamentId: string,
  categoryId: string
) {
  const q = `
    SELECT
      e.id_user,
      COALESCE(u.club_name, 'SIN_CLUB') AS club_name,
      ROW_NUMBER() OVER (ORDER BY e.enrolled_at ASC) AS seed_rank
    FROM enrollments e
    JOIN users u ON u.id_user = e.id_user
    WHERE e.id_tournament = $1
      AND e.id_category = $2
      AND e.status = 'active'
    ORDER BY e.enrolled_at ASC;
  `;
  const res = await client.query(q, [tournamentId, categoryId]);
  return res.rows as {
    id_user: string;
    club_name: string;
    seed_rank: number;
  }[];
}


  async insertCompetitionPlayers(client: PoolClient, competitionId: string, players: { id_user: string }[]) {
    if (players.length === 0) return;

    const placeholders: string[] = [];
    const values: any[] = [competitionId];

    players.forEach((p, i) => {
      placeholders.push(`($1, $${i + 2})`);
      values.push(p.id_user);
    });

    const q = `
      INSERT INTO ${this.compPlayersTable} (id_competition, id_user)
      VALUES ${placeholders.join(",")}
      ON CONFLICT DO NOTHING;
    `;
    await client.query(q, values);
  }

  // ✅ 1 query en vez de loop
  async createGroups(client: PoolClient, competitionId: string, groupCount: number): Promise<GroupRow[]> {
    const names = Array.from({ length: groupCount }, (_, i) => String.fromCharCode(65 + i)); // A,B,C...

    const q = `
      INSERT INTO ${this.groupsTable} (id_competition, group_name)
      SELECT $1, x.group_name
      FROM UNNEST($2::text[]) AS x(group_name)
      RETURNING id_group, group_name;
    `;
    const res = await client.query(q, [competitionId, names]);
    return res.rows as GroupRow[];
  }

  async insertGroupMembersAndStandings(
    client: PoolClient,
    assignments: { id_group: string; id_user: string; seed: number }[]
  ) {
    if (assignments.length === 0) return;

    // ✅ group_members batch + evita duplicados si se re-intenta
    {
      const values: any[] = [];
      const placeholders: string[] = [];

      assignments.forEach((a, i) => {
        const base = i * 3;
        placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
        values.push(a.id_group, a.id_user, a.seed);
      });

      const q = `
        INSERT INTO ${this.groupMembersTable} (id_group, id_user, seed)
        VALUES ${placeholders.join(",")}
        ON CONFLICT DO NOTHING;
      `;
      await client.query(q, values);
    }

    // ✅ group_standings batch + evita duplicados
    {
      const values: any[] = [];
      const placeholders: string[] = [];

      assignments.forEach((a, i) => {
        const base = i * 2;
        placeholders.push(`($${base + 1}, $${base + 2})`);
        values.push(a.id_group, a.id_user);
      });

      const q = `
        INSERT INTO ${this.groupStandingsTable} (id_group, id_user)
        VALUES ${placeholders.join(",")}
        ON CONFLICT DO NOTHING;
      `;
      await client.query(q, values);
    }
  }

  // ✅ evita 1 INSERT por match (más rápido). Igual respeta best_of_groups desde DB.
  async createGroupRoundRobinMatches(
    client: PoolClient,
    competitionId: string,
    groups: { id_group: string }[]
  ) {
    // traemos best_of_groups 1 sola vez
    const bo = await client.query(
      `SELECT best_of_groups FROM ${this.competitionsTable} WHERE id_competition = $1 LIMIT 1;`,
      [competitionId]
    );
    const bestOfGroups = bo.rows[0]?.best_of_groups as number | undefined;

    for (const g of groups) {
      const usersRes = await client.query(
        `SELECT id_user FROM ${this.groupMembersTable} WHERE id_group = $1 ORDER BY seed ASC`,
        [g.id_group]
      );
      const users = usersRes.rows.map((r) => r.id_user as string);

      // genera pares (i<j)
      const pairs: { p1: string; p2: string }[] = [];
      for (let i = 0; i < users.length; i++) {
        for (let j = i + 1; j < users.length; j++) {
          pairs.push({ p1: users[i], p2: users[j] });
        }
      }
      if (pairs.length === 0) continue;

      // batch insert
      const values: any[] = [competitionId, g.id_group, bestOfGroups ?? 3];
      const placeholders: string[] = [];

      pairs.forEach((pair, idx) => {
        const base = 3 + idx * 2;
        placeholders.push(`($1, 'group', $2, $3, $${base + 1}, $${base + 2}, 'scheduled')`);
        values.push(pair.p1, pair.p2);
      });

      const q = `
        INSERT INTO ${this.matchesTable}
          (id_competition, stage, id_group, best_of_sets, player1_id, player2_id, status)
        VALUES
          ${placeholders.join(",")};
      `;
      await client.query(q, values);
    }
  }

  async setCompetitionStatus(
    client: PoolClient,
    competitionId: string,
    status: "draft" | "generated_groups" | "in_groups" | "generated_bracket" | "in_bracket" | "finished"
  ) {
    const q = `
      UPDATE ${this.competitionsTable}
      SET status = $1, generated_at = COALESCE(generated_at, NOW())
      WHERE id_competition = $2;
    `;
    await client.query(q, [status, competitionId]);
  }

  // dentro de CompetitionRepository

async getCompetitionId(client: PoolClient, tournamentId: string, categoryId: string) {
  const q = `
    SELECT id_competition
    FROM category_competitions
    WHERE id_tournament = $1 AND id_category = $2
    LIMIT 1;
  `;
  const res = await client.query(q, [tournamentId, categoryId]);
  if (res.rows.length === 0) throw new Error("COMPETITION_NOT_FOUND");
  return res.rows[0].id_competition as string;
}

async getGroupsWithPlayers(client: PoolClient, competitionId: string) {
  const q = `
    SELECT
      g.id_group,
      g.group_name,
      gm.seed,
      u.id_user,
      u.email,
      COALESCE(u.club_name, 'SIN_CLUB') AS club_name
    FROM groups g
    JOIN group_members gm ON gm.id_group = g.id_group
    JOIN users u ON u.id_user = gm.id_user
    WHERE g.id_competition = $1
    ORDER BY g.group_name ASC, gm.seed ASC;
  `;
  const res = await client.query(q, [competitionId]);
  return res.rows as {
    id_group: string;
    group_name: string;
    seed: number;
    id_user: string;
    email: string;
    club_name: string;
  }[];
}

}
