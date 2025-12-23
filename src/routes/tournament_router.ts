// src/routes/tournament_routes.ts
import express, { Router } from "express";
import TournamentController  from "../controller/tournament_controller";
import { TournamentService } from "../services/tournament_service";
import { TournamentRepository } from "../repositories/tournament_repository";

const tournamentRouter: Router = express.Router();

// Instancias de repositorio, servicio y controlador
const tournamentRepository = new TournamentRepository();
const tournamentService = new TournamentService(tournamentRepository);
const tournamentController = new TournamentController(tournamentService);

// Crear campeonato
tournamentRouter.post("/create", tournamentController.createTournament);


export default tournamentRouter; 
