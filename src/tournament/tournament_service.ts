import type { TournamentCreateDTO, ITournament } from "../interfaces/dto/tournament_dto";
import { TournamentRepository } from "./tournament_repository";

export class TournamentService {
  constructor(private repo: TournamentRepository) {}

  async createTournament(payload: TournamentCreateDTO): Promise<ITournament> {
    // ✅ Aquí podrías validar formato fecha si quieres, pero por ahora directo:
    return this.repo.create(payload);
  }

  async listTournament(): Promise<ITournament[]> {
    return this.repo.getAll();
  }
}
