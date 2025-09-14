"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const tournament_controller_1 = require("../../controller/tournament/tournament_controller");
const tournament_service_1 = require("../../services/tournament_service");
const tournament_repository_1 = require("../../repositories/tournament_repository");
const db_configuration_1 = require("../../db/db_configuration");
const router = express_1.default.Router();
router.post("api/tournaments/create-tournament", function () {
    const tournamentRepository = new tournament_repository_1.TournamentRepository(db_configuration_1.connectDB);
    const tournamentService = new tournament_service_1.TournamentService(tournamentRepository);
    const tournament = new tournament_controller_1.TournamentController(tournamentService);
    return tournament.create;
});
//router.post("api/tournaments/modify-tournament");
exports.default = router;
