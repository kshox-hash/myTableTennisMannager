"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Tournament = void 0;
class Tournament {
    constructor(nombre, 
    // public categoria: string,
    fecha_inicio, fecha_fin, creador) {
        this.nombre = nombre;
        this.fecha_inicio = fecha_inicio;
        this.fecha_fin = fecha_fin;
        this.creador = creador;
    }
    isActive() {
        const hoy = new Date();
        return hoy >= this.fecha_inicio && hoy <= this.fecha_fin;
    }
}
exports.Tournament = Tournament;
//# sourceMappingURL=tournament_model.js.map