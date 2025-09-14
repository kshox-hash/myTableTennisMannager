"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TournamentService = void 0;
class TournamentService {
    constructor(tournamentRepo) {
        this.tournamentRepo = tournamentRepo;
    }
    async createTournament(data) {
        return this.tournamentRepo.create(data);
    }
    async listTournaments() {
        return this.tournamentRepo.findAll();
    }
    async getTournament(id) {
        return this.tournamentRepo.findById(id);
    }
}
exports.TournamentService = TournamentService;
