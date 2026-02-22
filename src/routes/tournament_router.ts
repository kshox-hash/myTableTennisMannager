import { Router } from "express";
import { TournamentController } from "../tournament/tournament_controller";
import { TournamentService } from "../tournament/tournament_service";
import { TournamentRepository } from "../tournament/tournament_repository";

const tournamentRouter = Router();

const repo = new TournamentRepository();
const service = new TournamentService(repo);
const controller = new TournamentController(service);

tournamentRouter.post("/createTournament", controller.createTournament);
tournamentRouter.get("/listTournament", controller.listTournament);

export default tournamentRouter;
