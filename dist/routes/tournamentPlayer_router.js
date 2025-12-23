"use strict";
// src/routes/players_routes.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const tournamentPlayer_service_1 = require("../services/tournamentPlayer_service");
const tournamentPlayer_repository_1 = require("../repositories/tournamentPlayer_repository");
const tournamentPlayer_controller_1 = require("../../controller/tournamentPlayer/tournamentPlayer_controller");
const router = express_1.default.Router();
const tournamentPlayerRepository = new tournamentPlayer_repository_1.TournamentPlayerRepository();
const tournamentPlayerService = new tournamentPlayer_service_1.TournamentPlayerService(tournamentPlayerRepository);
const tournamentPlayerController = new tournamentPlayer_controller_1.TournamentPlayerController(tournamentPlayerService);
// Inscribir un usuario a un torneo
router.post("/api/player/:tournamentId/register", (req, res) => {
    tournamentPlayerController.addPlayerToTournament(req, res);
});
// Listar todos los participantes de un torneo
router.get("/api/player/:tournamentId/participants", (req, res) => {
});
// (Opcional) Eliminar inscripción de un usuario
router.delete("/api/player/:tournamentId/unregister/:userId", (req, res) => {
    tournamentPlayerController.dropPlayerFromTournament(req, res);
});
exports.default = router;
//# sourceMappingURL=tournamentPlayer_router.js.map