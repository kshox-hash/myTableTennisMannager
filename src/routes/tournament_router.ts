// src/routes/tournament_routes.ts
import express, { Router } from "express";
import TournamentController  from "../tournament/tournament_controller";
import { TournamentService } from "../tournament/tournament_service";
import { TournamentRepository } from "../tournament/tournament_repository";

const tournamentRouter: Router = express.Router();

// Instancias de repositorio, servicio y controlador
const tournamentRepository = new TournamentRepository();
const tournamentService = new TournamentService(tournamentRepository);
const tournamentController = new TournamentController(tournamentService);

// Crear campeonato
tournamentRouter.post("/create", tournamentController.createTournament);
tournamentRouter.get("/getList", tournamentController.listTournament);


export default tournamentRouter; 
