"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Ranking = void 0;
class Ranking {
    constructor(rankingRepo) {
        this.rankingRepo = rankingRepo;
    }
    async getUserRanking(userId) {
        return this.rankingRepo.getUserRanking(userId);
    }
    async listUserRanking(data) {
        return this.rankingRepo.listUsers(data);
    }
}
exports.Ranking = Ranking;
//# sourceMappingURL=ranking_service.js.map