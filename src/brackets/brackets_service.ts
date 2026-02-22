// src/brackets/brackets_service.ts
import DB from "../db/db_configuration";
import type { PoolClient } from "pg";
import { BracketRepository } from "./brackets_repository";

export type GenerateBracketDTO = {
  tournamentId: string;
  categoryId: string;
  createdBy: string;
};

export type ReportBracketResultDTO = {
  bracketId: string;
  matchId: string;
  winnerId: string;
  setsP1: number;
  setsP2: number;
};

export class BracketService {
  private repo = new BracketRepository();

  async generateBracket(dto: GenerateBracketDTO) {
    return DB.withTransaction(async (client: PoolClient) => {
      await this.repo.assertUserIsAdmin(client, dto.createdBy);

      const comp = await this.repo.getCompetitionForUpdate(
        client,
        dto.tournamentId,
        dto.categoryId
      );

      if (comp.status !== "generated_groups" && comp.status !== "in_groups") {
        throw new Error("COMPETITION_NOT_READY_FOR_BRACKET");
      }

      const exists = await this.repo.hasBracket(client, comp.id_competition);
      if (exists) throw new Error("BRACKET_ALREADY_GENERATED");

      const qualified = await this.repo.getQualifiedFromGroups(
        client,
        comp.id_competition,
        comp.advance_per_group
      );
      if (qualified.length < 2) throw new Error("NOT_ENOUGH_QUALIFIED_PLAYERS");

      const bracketSize = this.pickBracketSize(qualified.length);

      const bracket = await this.repo.createBracket(client, comp.id_competition, bracketSize);

      const seedsOrdered = this.buildSeeds(qualified, bracketSize);

      await this.repo.insertSeeds(client, bracket.id_bracket, seedsOrdered);

      // 1) ✅ Crear árbol completo de matches + links
      const rounds = Math.log2(bracketSize);
      if (!Number.isInteger(rounds)) throw new Error("INVALID_BRACKET_SIZE");

      // matchesByRound[r] = array de matchIds (r empieza en 1)
      const matchesByRound: string[][] = [];

      let globalMatchNumber = 1;

      for (let r = 1; r <= rounds; r++) {
        const matchesInRound = bracketSize / Math.pow(2, r); // ej: r=1 => size/2
        const bestOf = (r === rounds) ? comp.best_of_final : comp.best_of_bracket;

        const roundIds: string[] = [];

        for (let i = 0; i < matchesInRound; i++) {
          const created = await this.repo.createEmptyBracketMatch(
            client,
            comp.id_competition,
            r,
            globalMatchNumber++,
            bestOf
          );
          roundIds.push(created.id_match);
        }

        matchesByRound.push(roundIds);
      }

      // linkear next_match: round r -> round r+1
      for (let r = 0; r < matchesByRound.length; r++) {
        const current = matchesByRound[r];
        const next = matchesByRound[r + 1] ?? null;

        for (let i = 0; i < current.length; i++) {
          const matchId = current[i];
          if (!next) {
            // final: no next
            await this.repo.upsertBracketMatchLink(client, bracket.id_bracket, matchId, null, null);
            continue;
          }

          const nextMatchIndex = Math.floor(i / 2);
          const slot: 1 | 2 = (i % 2 === 0) ? 1 : 2;

          await this.repo.upsertBracketMatchLink(
            client,
            bracket.id_bracket,
            matchId,
            next[nextMatchIndex],
            slot
          );
        }
      }

      // 2) ✅ Asignar jugadores SOLO en ronda 1 según seeds (1 vs size, 2 vs size-1, ...)
      const seedToUser = new Map<number, string>();
      seedsOrdered.forEach(s => seedToUser.set(s.seed_number, s.id_user));

      const round1MatchIds = matchesByRound[0]; // size/2 matches

      for (let i = 0; i < round1MatchIds.length; i++) {
        const aSeed = i + 1;
        const bSeed = bracketSize - i;

        const p1 = seedToUser.get(aSeed);
        const p2 = seedToUser.get(bSeed) ?? null;

        if (!p1) {
          // si ni siquiera existe seed A, dejamos match vacío
          continue;
        }

        await this.repo.setRound1Players(client, round1MatchIds[i], p1, p2);
      }

      // estados
      await this.repo.setCompetitionStatus(client, comp.id_competition, "generated_bracket");
      await this.repo.setBracketStatus(client, bracket.id_bracket, "generated");

      return {
        ok: true,
        id_competition: comp.id_competition,
        id_bracket: bracket.id_bracket,
        qualified: qualified.length,
        bracket_size: bracketSize,
        rounds,
        created_matches_total: bracketSize - 1,
      };
    });
  }

  // ✅ reportar resultado + avanzar winner automáticamente
  async reportBracketResult(dto: ReportBracketResultDTO) {
    return DB.withTransaction(async (client: PoolClient) => {
      const m = await this.repo.getMatchForUpdate(client, dto.matchId);

      if (m.status === "played") throw new Error("MATCH_ALREADY_PLAYED");
      if (!m.player1_id) throw new Error("MATCH_MISSING_PLAYER1");
      if (m.player2_id === null) {
        // era walkover; en teoría ya debería estar resuelto
        throw new Error("MATCH_IS_BYE");
      }

      // winner debe ser uno de los players
      if (dto.winnerId !== m.player1_id && dto.winnerId !== m.player2_id) {
        throw new Error("WINNER_NOT_IN_MATCH");
      }

      await this.repo.setMatchResult(client, dto.matchId, dto.winnerId, dto.setsP1, dto.setsP2);

      const link = await this.repo.getBracketLink(client, dto.bracketId, dto.matchId);

      // si no hay next, era final
      if (!link.next_match_id || !link.next_slot) {
        await this.repo.setBracketStatus(client, dto.bracketId, "finished");
        // opcional: marcar competition finished (cuando final se juega)
        // (para ser exactos: deberías validar que este match era la final)
        return { ok: true, advanced: false, finished: true };
      }

      // colocar winner en el siguiente match
      await this.repo.placeWinnerIntoNextMatch(client, link.next_match_id, link.next_slot, dto.winnerId);

      // bracket pasa a in_progress
      await this.repo.setBracketStatus(client, dto.bracketId, "in_progress");

      return {
        ok: true,
        advanced: true,
        next_match_id: link.next_match_id,
        next_slot: link.next_slot,
      };
    });
  }

  private pickBracketSize(n: number): number {
    const allowed = [8, 16, 32, 64, 128];
    for (const size of allowed) if (n <= size) return size;
    throw new Error("TOO_MANY_PLAYERS_FOR_BRACKET");
  }

private buildSeeds(
  qualified: { id_user: string; id_group: string; group_rank: number }[],
  bracketSize: number
): { seed_number: number; id_user: string }[] {
  // 1) separar por grupo: necesitamos A1 y A2
  const byGroup = new Map<string, { r1?: string; r2?: string }>();

  for (const q of qualified) {
    const g = byGroup.get(q.id_group) ?? {};
    if (q.group_rank === 1) g.r1 = q.id_user;
    if (q.group_rank === 2) g.r2 = q.id_user;
    byGroup.set(q.id_group, g);
  }

  const groups = Array.from(byGroup.keys()).sort(); // determinista por id_group
  const winners: { group: string; user: string }[] = [];
  const runners: { group: string; user: string }[] = [];

  for (const g of groups) {
    const row = byGroup.get(g)!;
    if (row.r1) winners.push({ group: g, user: row.r1 });
    if (row.r2) runners.push({ group: g, user: row.r2 });
  }

  if (winners.length === 0) throw new Error("NO_GROUP_WINNERS");
  // Nota: runners puede ser menor si advance_per_group != 2 o si faltan datos.

  const matchCount = bracketSize / 2;

  // matches[i] representa el match de 1ª ronda i
  // i=0 usa seed1 vs seedSize, i=1 usa seed2 vs seedSize-1, etc.
  const matches: Array<{
    p1?: { group: string; user: string };
    p2?: { group: string; user: string };
  }> = Array.from({ length: matchCount }, () => ({}));

  // 2) Colocar ganadores (rank1) en p1 (mitad superior preferida)
  // La mitad superior de round1 son los matches 0..(matchCount/2 - 1)
  const topHalfEnd = Math.floor(matchCount / 2);

  // primero llenamos mitad superior
  let wi = 0;
  for (let i = 0; i < matchCount && wi < winners.length; i++) {
    const target = i < topHalfEnd ? i : i; // si sobran ganadores, siguen llenando
    if (!matches[target].p1) {
      matches[target].p1 = winners[wi++];
    }
  }

  // 3) Colocar segundos (rank2) en p2 priorizando mitad inferior
  // mitad inferior: matches topHalfEnd..matchCount-1
  const bottomOrder = [
    ...Array.from({ length: matchCount - topHalfEnd }, (_, k) => topHalfEnd + k),
    ...Array.from({ length: topHalfEnd }, (_, k) => k), // si no cabe, empieza arriba
  ];

  for (const r of runners) {
    let placed = false;

    // 3.1 intentar un match con p1 existente y de grupo distinto (evita A1 vs A2 en R1)
    for (const mi of bottomOrder) {
      if (matches[mi].p2) continue;
      if (!matches[mi].p1) continue; // si no hay p1, ese match se omite en tu service
      if (matches[mi].p1!.group === r.group) continue;
      matches[mi].p2 = r;
      placed = true;
      break;
    }

    if (placed) continue;

    // 3.2 fallback: cualquier match con p1 existente (aunque quede en topHalf)
    for (let mi = 0; mi < matchCount; mi++) {
      if (matches[mi].p2) continue;
      if (!matches[mi].p1) continue;
      if (matches[mi].p1!.group === r.group) continue;
      matches[mi].p2 = r;
      placed = true;
      break;
    }

    if (!placed) {
      // 3.3 último recurso (si la cantidad es rara): coloca aunque no haya p1 (pero tu service lo ignorará)
      for (let mi = 0; mi < matchCount; mi++) {
        if (matches[mi].p2) continue;
        matches[mi].p2 = r;
        placed = true;
        break;
      }
    }
  }

  // 4) Convertir matches a seeds
  // match i: seedA = i+1, seedB = bracketSize - i
  const seeds: { seed_number: number; id_user: string }[] = [];

  for (let i = 0; i < matchCount; i++) {
    const seedA = i + 1;
    const seedB = bracketSize - i;

    const p1 = matches[i].p1?.user;
    const p2 = matches[i].p2?.user;

    if (p1) seeds.push({ seed_number: seedA, id_user: p1 });
    if (p2) seeds.push({ seed_number: seedB, id_user: p2 });
  }

  return seeds;
}

}
