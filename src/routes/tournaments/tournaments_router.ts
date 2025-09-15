// src/routes/tournament_routes.ts

import express, { Router } from "express";
import { TournamentController } from "../../controller/tournament/tournament_controller";
import { TournamentService } from "../../services/tournament_service";
import { TournamentRepository } from "../../repositories/tournament_repository";

const router: Router = express.Router();

// Instancias de repositorio, servicio y controlador
const tournamentRepository = new TournamentRepository();
const tournamentService = new TournamentService(tournamentRepository);
const tournamentController = new TournamentController(tournamentService);

// Crear un torneo
router.post("/api/create-tournament", (req, res) => {
  return tournamentController.create(req, res);
});

// Listar todos los torneos
router.get("/api/list-tournaments", (req, res) => {
  return tournamentController.listTournaments(req, res);
});

// Obtener un torneo por ID
router.get("/api/get-tournaments/:id", (req, res) => {
  return tournamentController.getTournament(req, res);
});

// Eliminar un torneo por ID
router.delete("/api/delete-tournaments/:id", (req, res) => {
  return tournamentController.deleteTournament(req, res);
});

// (Opcional) Modificar un torneo por ID
// router.put("/api/tournaments/:id", (req, res) => {
//   return tournamentController.updateTournament(req, res);
// });

export default router;
