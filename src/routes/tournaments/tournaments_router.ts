import express, { Router } from "express";
import {TournamentController } from "../../controller/tournament/tournament_controller"
import { TournamentService} from "../../services/tournament_service"
import {TournamentRepository } from "../../repositories/tournament_repository"


const router : Router = express.Router();

const tournamentRepository = new TournamentRepository()
const tournamentService = new TournamentService(tournamentRepository)
const tournament = new TournamentController(tournamentService)

router.post("/POST/api/tournaments", (req, res) => {

    return tournament.create(req, res);
}

);
//router.post("api/tournaments/modify-tournament");
export default router;
