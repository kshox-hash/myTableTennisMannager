
import {RankingRepository} from "../repositories/ranking_repository"

export class Ranking {
    constructor ( private rankingRepo : RankingRepository ){}

    async getUserRanking(userId : number){
        return this.rankingRepo.getUserRanking(userId)
    }

    async listUserRanking(data : number) {
        return this.rankingRepo.listUsers(data)
    }
}