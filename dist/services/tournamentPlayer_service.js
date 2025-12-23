"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TournamentPlayerService = void 0;
class TournamentPlayerService {
    constructor(playerRepo) {
        this.playerRepo = playerRepo;
    }
    async registerPlayerToTournament(data) {
        return this.playerRepo.create(data);
    }
    async getPlayer() { }
    async listPlayer() { }
    async deletePlayer() { }
    async updatePlayer() { }
}
exports.TournamentPlayerService = TournamentPlayerService;
//# sourceMappingURL=tournamentPlayer_service.js.map