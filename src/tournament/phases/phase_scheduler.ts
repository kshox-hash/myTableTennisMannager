import { TournamentPhaseRepository } from "./tournament_phase_repository";
import { TournamentPhaseService } from "./tournament_phase_service";
import { BracketsRepository } from "../../brackets/brackets_repository";
import { BracketsService } from "../../brackets/brackets_service";

export function startPhaseScheduler(intervalMs = 30_000) {
  const phaseRepo       = new TournamentPhaseRepository();
  const bracketsRepo    = new BracketsRepository();
  const bracketsService = new BracketsService(bracketsRepo);
  const phaseService    = new TournamentPhaseService(phaseRepo, bracketsService);

  setInterval(async () => {
    try {
      await phaseService.processScheduled();
    } catch (err) {
      console.error("[PhaseScheduler] error:", err);
    }
  }, intervalMs);

  console.log(`[PhaseScheduler] iniciado — revisando cada ${intervalMs / 1000}s`);
}
