"use strict";
// src/services/TournamentService.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.TournamentService = void 0;
/**
 * Servicio que contiene la lógica de negocio para la gestión de torneos.
 * Actúa como intermediario entre el controlador y el repositorio.
 */
class TournamentService {
    constructor(tournamentRepo) {
        this.tournamentRepo = tournamentRepo;
    }
    /**
     * Crear un nuevo torneo
     * @param data Datos del torneo (debe cumplir con la interfaz ITournament)
     * @returns El torneo creado
     */
    async createTournament(data) {
        // Podrías validar aquí los datos (ej. nombre, fecha, etc.)
        return this.tournamentRepo.create(data);
    }
    /**
     * Obtener la lista de todos los torneos
     * @returns Array de torneos
     */
    async listTournaments() {
        return this.tournamentRepo.findAll();
    }
    /**
     * Obtener un torneo por su ID
     * @param id ID del torneo
     * @returns El torneo si se encuentra, o null
     */
    async getTournament(id) {
        if (isNaN(id)) {
            throw new Error("Invalid tournament ID");
        }
        return this.tournamentRepo.findById(id);
    }
    /**
     * Eliminar un torneo por su ID
     * @param id ID del torneo a eliminar
     * @returns true si se eliminó, false si no existía
     */
    async deleteTournament(id) {
        if (isNaN(id)) {
            throw new Error("Invalid tournament ID");
        }
        return this.tournamentRepo.delete(id);
    }
}
exports.TournamentService = TournamentService;
//# sourceMappingURL=tournament_service.js.map