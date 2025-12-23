"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroupStageController = exports.GroupStage = void 0;
class GroupStage {
    constructor(id, torneoId, grupo, jugadores, configuracionSets) {
        this.id = id;
        this.torneoId = torneoId;
        this.grupo = grupo;
        this.jugadores = jugadores;
        this.configuracionSets = configuracionSets;
    }
    addPlayer(jugadorId) {
        this.jugadores.push(jugadorId);
    }
}
exports.GroupStage = GroupStage;
class GroupStageController {
}
exports.GroupStageController = GroupStageController;
//repositorio
// service
//controller
//router
//# sourceMappingURL=groups_stage_model.js.map