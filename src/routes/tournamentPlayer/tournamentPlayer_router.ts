// src/routes/players_routes.ts

import express, { Router } from "express";
import {TournamentPlayerService} from "../../services/tournamentPlayer/tournamentPlayer_service"
import {TournamentPlayerRepository} from "../../repositories/tournamentPlayer_repository"
import {TournamentPlayerController} from "../../controller/tournamentPlayer/tournamentPlayer_controller"

const router: Router = express.Router();
const tournamentPlayerRepository = new TournamentPlayerRepository();
const tournamentPlayerService = new TournamentPlayerService(tournamentPlayerRepository);
const tournamentPlayerController = new TournamentPlayerController(tournamentPlayerService)

// Inscribir un usuario a un torneo
router.post("/api/player/:tournamentId/register", (req, res) => {
   tournamentPlayerController.addPlayerToTournament(req, res)
});

// Listar todos los participantes de un torneo
router.get("/api/player/:tournamentId/participants", (req, res) => {
   
});

// (Opcional) Eliminar inscripción de un usuario
router.delete("/api/player/:tournamentId/unregister/:userId", (req, res) => {
    tournamentPlayerController.dropPlayerFromTournament(req, res);
});

export default router;
