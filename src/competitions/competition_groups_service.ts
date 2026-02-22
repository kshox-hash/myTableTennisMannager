import DB from "../db/db_configuration";
import type { PoolClient } from "pg";
import { CompetitionRepository } from "./competition_repository";

export class CompetitionGroupsService {
  private repo = new CompetitionRepository();

  async getGroups(tournamentId: string, categoryId: string) {
    return DB.withTransaction(async (client: PoolClient) => {
      const competitionId = await this.repo.getCompetitionId(client, tournamentId, categoryId);
      const rows = await this.repo.getGroupsWithPlayers(client, competitionId);

      // agrupar para respuesta bonita
      const map = new Map<string, any>();

      for (const r of rows) {
        const key = r.id_group;
        if (!map.has(key)) {
          map.set(key, {
            id_group: r.id_group,
            group_name: r.group_name,
            players: [],
          });
        }
        map.get(key).players.push({
          id_user: r.id_user,
          name: r.email,            // por ahora, luego cambias a nombre real
          club: r.club_name,
          seed: r.seed,
        });
      }

      return {
        ok: true,
        competition_id: competitionId,
        groups: Array.from(map.values()),
      };
    });
  }
}
