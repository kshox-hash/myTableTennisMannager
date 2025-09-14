// src/services/TournamentService.ts
import { TournamentRepository } from "../repositories/tournament_repository";
import { ITournament } from "../model/tournaments/tournament_model";

export class TournamentService {
  constructor(private tournamentRepo: TournamentRepository) {}

  async createTournament(data: ITournament) {
    return this.tournamentRepo.create(data);
  }

  async listTournaments() {
    return this.tournamentRepo.findAll();
  }

  async getTournament(id: number) {
    return this.tournamentRepo.findById(id);
  }
}
