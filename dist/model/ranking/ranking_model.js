"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Ranking = void 0;
class Ranking {
    constructor(jugadorId, puntosTotales, setsGanados, diferencialPuntos, posicion) {
        this.jugadorId = jugadorId;
        this.puntosTotales = puntosTotales;
        this.setsGanados = setsGanados;
        this.diferencialPuntos = diferencialPuntos;
        this.posicion = posicion;
    }
    addPoints(puntos) {
        this.puntosTotales += puntos;
    }
}
exports.Ranking = Ranking;
