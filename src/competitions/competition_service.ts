import DB from "../db/db_configuration";
import type { PoolClient } from "pg";
import { CompetitionRepository } from "../competitions/competition_repository";

export type GenerateDTO = {
  tournamentId: string;
  categoryId: string;
  createdBy?: string;
};

type Player = {
  id_user: string;
  club_name: string;
  seed_rank: number;
};

type Assignment = {
  id_group: string;
  id_user: string;
  seed: number;
};

export class CompetitionService {
  private repo = new CompetitionRepository();

  async generateGroupsAndMatches(dto: GenerateDTO) {
    return DB.withTransaction(async (client: PoolClient) => {
      await this.assertAdminIfProvided(client, dto.createdBy);

      const competitionId = await this.prepareCompetition(
        client,
        dto.tournamentId,
        dto.categoryId
      );

      const players = await this.freezePlayers(
        client,
        dto.tournamentId,
        dto.categoryId,
        competitionId
      );

      const groupSizes = this.calculateGroupSizes(players.length);

      const groups = await this.repo.createGroups(
        client,
        competitionId,
        groupSizes.length
      );

      const assignments = this.assignPlayers(
        players,
        groups.map(g => g.id_group),
        groupSizes
      );

      await this.repo.insertGroupMembersAndStandings(client, assignments);

      await this.repo.createGroupRoundRobinMatches(
        client,
        competitionId,
        groups
      );

      await this.repo.setCompetitionStatus(
        client,
        competitionId,
        "generated_groups"
      );

      return {
        ok: true,
        competition_id: competitionId,
        group_sizes: groupSizes,
      };
    });
  }

  // =========================
  // DB helpers
  // =========================

  private async assertAdminIfProvided(client: PoolClient, createdBy?: string) {
    if (!createdBy) return;
    await this.repo.assertUserIsAdmin(client, createdBy);
  }

  private async prepareCompetition(
    client: PoolClient,
    tournamentId: string,
    categoryId: string
  ): Promise<string> {
    const cat = await this.repo.getCategoryForUpdate(
      client,
      tournamentId,
      categoryId
    );

    if (cat.status !== "open" && cat.status !== "closed") {
      throw new Error("CATEGORY_NOT_OPEN");
    }

    const comp = await this.repo.ensureCompetition(
      client,
      tournamentId,
      categoryId
    );

    const already = await this.repo.hasGroups(client, comp.id_competition);
    if (already) throw new Error("GROUPS_ALREADY_GENERATED");

    return comp.id_competition;
  }

  private async freezePlayers(
    client: PoolClient,
    tournamentId: string,
    categoryId: string,
    competitionId: string
  ): Promise<Player[]> {
    const rows = await this.repo.getActivePlayersForCategory(
      client,
      tournamentId,
      categoryId
    );

    if (rows.length < 3) throw new Error("NOT_ENOUGH_PLAYERS");

    await this.repo.insertCompetitionPlayers(
      client,
      competitionId,
      rows.map(r => ({ id_user: r.id_user }))
    );

    return rows;
  }

  // =========================
  // GROUP SIZE LOGIC (4-3 + 3-2 for 5)
  // =========================

  private calculateGroupSizes(n: number): number[] {
    if (n === 3) return [3];
    if (n === 4) return [4];
    if (n === 5) return [3, 2];
    if (n === 6) return [3, 3];
    if (n === 7) return [4, 3];
    if (n === 8) return [4, 4];

    const rem = n % 4;
    const k = Math.floor(n / 4);

    if (rem === 0) return Array(k).fill(4);
    if (rem === 3) return [...Array(k).fill(4), 3];
    if (rem === 2) return [...Array(k - 1).fill(4), 3, 3];
    return [...Array(k - 2).fill(4), 3, 3, 3]; // rem === 1
  }

  // =========================
  // ASSIGNMENT
  // =========================

  private assignPlayers(
    players: Player[],
    groupIds: string[],
    groupSizes: number[]
  ): Assignment[] {
    const G = groupIds.length;

    const ordered = [...players].sort(
      (a, b) => a.seed_rank - b.seed_rank
    );

    const groupPlayers: Player[][] = Array.from({ length: G }, () => []);
    const groupClubs: Map<string, number>[] = Array.from(
      { length: G },
      () => new Map()
    );

    const add = (gi: number, p: Player) => {
      groupPlayers[gi].push(p);
      groupClubs[gi].set(
        p.club_name,
        (groupClubs[gi].get(p.club_name) ?? 0) + 1
      );
    };

    const hasClub = (gi: number, club: string) =>
      (groupClubs[gi].get(club) ?? 0) > 0;

    // Heads (1 por grupo)
    for (let gi = 0; gi < G; gi++) {
      if (!ordered[gi]) break;
      add(gi, ordered[gi]);
    }

    const rest = ordered.slice(G);

    for (let i = 0; i < rest.length; i++) {
      const p = rest[i];

      const pos = G + 1 + i;
      const preferred = this.snakeIndex(pos, G);

      const candidates = [
        preferred,
        ...Array.from({ length: G }, (_, k) => k).filter(
          x => x !== preferred
        ),
      ];

      let placed = false;

      // intento sin repetir club
      for (const gi of candidates) {
        if (groupPlayers[gi].length >= groupSizes[gi]) continue;
        if (hasClub(gi, p.club_name)) continue;
        add(gi, p);
        placed = true;
        break;
      }

      // si no se pudo, forzar por cupo (soft club rule)
      if (!placed) {
        for (const gi of candidates) {
          if (groupPlayers[gi].length >= groupSizes[gi]) continue;
          add(gi, p);
          placed = true;
          break;
        }
      }

      if (!placed) throw new Error("GROUP_ASSIGNMENT_ERROR");
    }

    const assignments: Assignment[] = [];

    for (let gi = 0; gi < G; gi++) {
      for (let si = 0; si < groupPlayers[gi].length; si++) {
        assignments.push({
          id_group: groupIds[gi],
          id_user: groupPlayers[gi][si].id_user,
          seed: si + 1,
        });
      }
    }

    return assignments;
  }

  private snakeIndex(pos1Based: number, G: number): number {
    const round = Math.floor((pos1Based - 1) / G);
    const idx = (pos1Based - 1) % G;
    return round % 2 === 0 ? idx : G - 1 - idx;
  }
}
