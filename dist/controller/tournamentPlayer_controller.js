"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TournamentPlayerController = void 0;
// Controlador encargado de manejar las operaciones relacionadas con jugadores en torneos
class TournamentPlayerController {
    constructor(playerService) {
        this.playerService = playerService;
        /**
         * Método para registrar un jugador en un torneo
         */
        this.addPlayerToTournament = async (req, res) => {
            try {
                // Obtenemos los datos enviados en la petición (ejemplo: { playerId, tournamentId })
                const data = req.body;
                // Validamos datos básicos
                if (!data?.playerId || !data?.tournamentId) {
                    return res.status(400).json({ error: "playerId y tournamentId son requeridos" });
                }
                // Llamamos al servicio que maneja la lógica de negocio
                const playerRegisterResult = await this.playerService.registerPlayerToTournament(data);
                // Respondemos con éxito (201: recurso creado)
                return res.status(201).json(playerRegisterResult);
            }
            catch (err) {
                // Manejo de errores
                return res.status(500).json({ error: err.message });
            }
        };
        /**
         * Método para eliminar a un jugador de un torneo
         */
        this.dropPlayerFromTournament = async (req, res) => {
            try {
                // Podrías obtener el id del jugador y torneo desde params o body
                const { playerId, tournamentId } = req.body;
                if (!playerId || !tournamentId) {
                    return res.status(400).json({ error: "playerId y tournamentId son requeridos" });
                }
                // Llamamos al servicio para eliminar al jugador del torneo
                const playerDropped = await this.playerService.deletePlayer(playerId, tournamentId);
                // Respondemos con éxito (200: recurso eliminado/actualizado)
                return res.status(200).json(playerDropped);
            }
            catch (err) {
                return res.status(500).json({ error: err.message });
            }
        };
    }
}
exports.TournamentPlayerController = TournamentPlayerController;
//# sourceMappingURL=tournamentPlayer_controller.js.map