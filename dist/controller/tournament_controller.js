"use strict";
// src/controllers/TournamentController.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.TournamentController = void 0;
// El controlador gestiona las solicitudes HTTP relacionadas con torneos
class TournamentController {
    constructor(tournamentService) {
        this.tournamentService = tournamentService;
        /**
         * Crear un nuevo torneo
         * Método POST /tournaments
         */
        this.create = async (req, res) => {
            try {
                // Se espera que req.body tenga los datos necesarios del torneo
                const torneo = await this.tournamentService.createTournament(req.body);
                res.status(201).json(torneo); // 201 Created
            }
            catch (err) {
                res.status(500).json({ error: err.message }); // Error interno del servidor
            }
        };
        /**
         * Listar todos los torneos
         * Método GET /tournaments
         */
        this.listTournaments = async (req, res) => {
            try {
                const tournaments = await this.tournamentService.listTournaments();
                res.status(200).json(tournaments); // 200 OK
            }
            catch (err) {
                res.status(500).json({ error: err.message }); // Error interno
            }
        };
        /**
         * Obtener un torneo por ID
         * Método GET /tournaments/:id
         */
        this.getTournament = async (req, res) => {
            try {
                const { id } = req.params;
                // Validar que se proporciona un ID
                if (!id) {
                    return res.status(400).json({ error: "Tournament ID is required" }); // 400 Bad Request
                }
                const tournament = await this.tournamentService.getTournament(id);
                // Si no se encuentra el torneo
                if (!tournament) {
                    return res.status(404).json({ error: "Tournament not found" }); // 404 Not Found
                }
                res.status(200).json(tournament); // 200 OK
            }
            catch (err) {
                res.status(500).json({ error: err.message }); // Error interno
            }
        };
        /**
         * Eliminar un torneo por ID
         * Método DELETE /tournaments/:id
         */
        this.deleteTournament = async (req, res) => {
            try {
                const { id } = req.params;
                // Validar que se proporciona un ID
                if (!id) {
                    return res.status(400).json({ error: "Tournament ID is required" });
                }
                const deleted = await this.tournamentService.deleteTournament(id);
                if (!deleted) {
                    return res.status(404).json({ error: "Tournament not found or already deleted" });
                }
                res.status(200).json({ message: "Tournament deleted successfully" }); // 200 OK
            }
            catch (err) {
                res.status(500).json({ error: err.message }); // Error interno
            }
        };
    }
}
exports.TournamentController = TournamentController;
//# sourceMappingURL=tournament_controller.js.map