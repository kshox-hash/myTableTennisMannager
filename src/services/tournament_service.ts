import { TournamentRepository } from "../repositories/tournament_repository";
import { TournamentCreateDTO, ITournament } from "../interfaces/dto/tournament_dto";

export class TournamentService {
  constructor(private tournamentRepo: TournamentRepository) {}

  async createTournament(data: TournamentCreateDTO): Promise<ITournament> {
    return this.tournamentRepo.create(data);
  }
}
