"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Tournament = void 0;
class Tournament {
    constructor(id, nombre, tipo, categoria, fechaInicio, fechaFin, ubicacion, sets, estado) {
        this.id = id;
        this.nombre = nombre;
        this.tipo = tipo;
        this.categoria = categoria;
        this.fechaInicio = fechaInicio;
        this.fechaFin = fechaFin;
        this.ubicacion = ubicacion;
        this.sets = sets;
        this.estado = estado;
    }
    isActive() {
        const hoy = new Date();
        return hoy >= this.fechaInicio && hoy <= this.fechaFin;
    }
}
exports.Tournament = Tournament;
