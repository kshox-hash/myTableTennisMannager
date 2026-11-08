import { BracketsRepository } from "./brackets_repository";
import { BracketsService } from "./brackets_service";
import { TournamentPhaseRepository } from "../tournament/phases/tournament_phase_repository";
import { TournamentPhaseService } from "../tournament/phases/tournament_phase_service";

let services: { brackets: BracketsService; phases: TournamentPhaseService } | null = null;

function get() {
  if (!services) {
    const repo = new BracketsRepository();
    const brackets = new BracketsService(repo);
    services = { brackets, phases: new TournamentPhaseService(new TournamentPhaseRepository(), brackets, repo) };
  }
  return services;
}

/**
 * Se llama al marcar a un inscrito "No vino" con los grupos en juego: si en
 * su grupo ya se jugó todo entre los que sí vinieron, cierra sus partidos
 * (W.O.) para que el grupo termine, y avanza de fase si corresponde.
 */
export async function closeAbsentMatchesAfterAttendance(tournamentId: string, categoryId: string, userId: string): Promise<void> {
  const { brackets, phases } = get();
  const closed = await brackets.closeAbsentMatchesForPlayer(tournamentId, categoryId, userId);
  if (closed > 0) await phases.checkGroupAutoAdvance(categoryId, tournamentId);
}
