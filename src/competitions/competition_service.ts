// src/services/competition_service.ts
// Caso de uso: generar competencia (groups + group matches) para una categoría.
// ✅ Sin AuthRepository (mientras no tengas auth/JWT).
// ✅ No depende de EnrollmentRepository.getActivePlayersForCategory (trae inscritos desde CompetitionRepository).

import DB from "../db/db_configuration";
import type { PoolClient } from "pg";
import { CompetitionRepository } from "../competitions/competition_repository";

export type GenerateDTO = {
  tournamentId: string;
  categoryId: string;
  createdBy?: string; // opcional por ahora (sin auth)
};

export class CompetitionService {
  private repo = new CompetitionRepository();

  async generateGroupsAndMatches(dto: GenerateDTO) {
    const db = new DB();
    const client = (await db.connect()) as PoolClient;

    try {
      await client.query("BEGIN");

      // 1) (Opcional) si quieres validar admin por DB aunque no tengas JWT
      // - si no pasas createdBy, saltamos esta validación
      await this.assertAdminIfProvided(client, dto.createdBy);

      // 2) lock + validar estado categoría + asegurar competition + no regenerar
      const competitionId = await this.prepareCompetition(client, dto.tournamentId, dto.categoryId);

      // 3) obtener inscritos activos + congelarlos en competition_players
      const players = await this.freezePlayers(client, dto.tournamentId, dto.categoryId, competitionId);

      // 4) crear grupos + miembros + standings
      const { groups, groupCount } = await this.createGroupsAndMembers(client, competitionId, players);

      // 5) crear partidos de grupos (round robin)
      await this.createGroupMatches(client, competitionId, groups);

      // 6) marcar estados finales
      await this.finalizeGeneration(client, dto.categoryId, competitionId);

      await client.query("COMMIT");

      return {
        ok: true,
        competition_id: competitionId,
        group_count: groupCount,
        players: players.length,
      };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release?.();
    }
  }

  // =========================================================
  // Helpers (una responsabilidad cada uno)
  // =========================================================

  private async assertAdminIfProvided(client: PoolClient, createdBy?: string) {
    if (!createdBy) return;
    await this.repo.assertUserIsAdmin(client, createdBy); // query JOIN roles/users dentro del repo
  }

  private async prepareCompetition(client: PoolClient, tournamentId: string, categoryId: string): Promise<string> {
    const cat = await this.repo.getCategoryForUpdate(client, tournamentId, categoryId);

    // puedes ajustar: permitir solo "closed" si quieres ser más estricto
    if (cat.status !== "open" && cat.status !== "closed") {
      throw new Error("CATEGORY_NOT_OPEN");
    }

    const comp = await this.repo.ensureCompetition(client, tournamentId, categoryId);

    const already = await this.repo.hasGroups(client, comp.id_competition);
    if (already) throw new Error("GROUPS_ALREADY_GENERATED");

    return comp.id_competition;
  }

  private async freezePlayers(
    client: PoolClient,
    tournamentId: string,
    categoryId: string,
    competitionId: string
  ): Promise<{ id_user: string }[]> {
    // ✅ ahora lo leemos desde enrollments directamente en CompetitionRepository
    const players = await this.repo.getActivePlayersForCategory(client, tournamentId, categoryId);

    if (players.length < 3) throw new Error("NOT_ENOUGH_PLAYERS");

    await this.repo.insertCompetitionPlayers(client, competitionId, players);
    return players;
  }

  private async createGroupsAndMembers(
    client: PoolClient,
    competitionId: string,
    players: { id_user: string }[]
  ): Promise<{
    groupCount: number;
    groups: { id_group: string; group_name: string }[];
  }> {
    const groupCount = this.calculateGroupCount(players.length);

    const groups = await this.repo.createGroups(client, competitionId, groupCount);

    const assignments = this.snakeAssign(players, groups);

    await this.repo.insertGroupMembersAndStandings(client, assignments);

    return { groupCount, groups };
  }

  private async createGroupMatches(
    client: PoolClient,
    competitionId: string,
    groups: { id_group: string }[]
  ) {
    await this.repo.createGroupRoundRobinMatches(client, competitionId, groups);
  }

  private async finalizeGeneration(client: PoolClient, categoryId: string, competitionId: string) {
    await this.repo.setCompetitionStatus(client, competitionId, "generated_groups");
    await this.repo.setCategoryStatus(client, categoryId, "generated");
  }

  // =========================================================
  // Pure helpers (no DB)
  // =========================================================

  private calculateGroupCount(n: number): number {
    if (n <= 4) return 1;

    let g = Math.ceil(n / 4);
    const rem = n % 4;

    if (rem === 1) {
      const g3 = Math.ceil(n / 3);
      if (g3 >= 2) g = g3;
    }

    return Math.max(1, g);
  }

  private snakeAssign(
    players: { id_user: string }[],
    groups: { id_group: string; group_name: string }[]
  ): { id_group: string; id_user: string; seed: number }[] {
    const g = groups.length;
    const assignments: { id_group: string; id_user: string; seed: number }[] = [];

    for (let i = 0; i < players.length; i++) {
      const pos = (i % g) + 1;
      const round = Math.floor(i / g);

      const groupIndex = round % 2 === 0 ? pos : g - pos + 1;
      const group = groups[groupIndex - 1];

      assignments.push({
        id_group: group.id_group,
        id_user: players[i].id_user,
        seed: i + 1,
      });
    }

    return assignments;
  }
}
