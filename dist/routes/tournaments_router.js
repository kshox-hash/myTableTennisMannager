"use strict";
// src/routes/tournament_routes.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const tournament_controller_1 = require("../controller/tournament_controller");
const tournament_service_1 = require("../services/tournament_service");
const tournament_repository_1 = require("../repositories/tournament_repository");
const router = express_1.default.Router();
// Instancias de repositorio, servicio y controlador
const tournamentRepository = new tournament_repository_1.TournamentRepository();
const tournamentService = new tournament_service_1.TournamentService(tournamentRepository);
const tournamentController = new tournament_controller_1.TournamentController(tournamentService);
// Crear un torneo
router.post("/api/tournament/create-tournament", (req, res) => {
    return tournamentController.create(req, res);
});
// Listar todos los torneos
router.get("/api/tournament/list-tournaments", (req, res) => {
    return tournamentController.listTournaments(req, res);
});
// Obtener un torneo por ID
router.get("/api/tournament/get-tournaments/:id", (req, res) => {
    return tournamentController.getTournament(req, res);
});
// Eliminar un torneo por ID
router.delete("/api/tournament/delete-tournaments/:id", (req, res) => {
    return tournamentController.deleteTournament(req, res);
});
// (Opcional) Modificar un torneo por ID
// router.put("/api/tournaments/:id", (req, res) => {
//   return tournamentController.updateTournament(req, res);
// });
exports.default = router;
//# sourceMappingURL=tournaments_router.js.map