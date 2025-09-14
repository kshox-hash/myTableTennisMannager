"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroupStage = void 0;
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
