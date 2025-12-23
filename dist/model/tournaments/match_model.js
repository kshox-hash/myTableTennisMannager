"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Match = void 0;
class Match {
    constructor(id, torneoId, jugador1, jugador2, sets, resultado, estado) {
        this.id = id;
        this.torneoId = torneoId;
        this.jugador1 = jugador1;
        this.jugador2 = jugador2;
        this.sets = sets;
        this.resultado = resultado;
        this.estado = estado;
    }
    isFinished() {
        return this.estado === "finalizado";
    }
}
exports.Match = Match;
//# sourceMappingURL=match_model.js.map