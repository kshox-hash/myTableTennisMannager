
import { TournamentPlayerRepository} from "../repositories/tournamentPlayer_repository"

export class TournamentPlayerService {
    constructor( private playerRepo : TournamentPlayerRepository ){}

    async registerPlayerToTournament(data : any){
        return this.playerRepo.create(data)
    }

    async getPlayer(){}

    async listPlayer(){}

    async deletePlayer(){}

    async updatePlayer(){}

}


