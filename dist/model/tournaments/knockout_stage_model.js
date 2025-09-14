"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KnockoutStage = void 0;
class KnockoutStage {
    constructor(id, torneoId, ronda, jugadores, configuracionSets) {
        this.id = id;
        this.torneoId = torneoId;
        this.ronda = ronda;
        this.jugadores = jugadores;
        this.configuracionSets = configuracionSets;
    }
    advanceWinners(winners) {
        this.jugadores = winners;
    }
}
exports.KnockoutStage = KnockoutStage;
