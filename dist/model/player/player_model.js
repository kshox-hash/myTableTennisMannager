"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Player = void 0;
class Player {
    constructor(id, nombre, fechaNacimiento, categoria, pais, club, telefono, email, rut, genero) {
        this.id = id;
        this.nombre = nombre;
        this.fechaNacimiento = fechaNacimiento;
        this.categoria = categoria;
        this.pais = pais;
        this.club = club;
        this.telefono = telefono;
        this.email = email;
        this.rut = rut;
        this.genero = genero;
    }
    getEdad() {
        const diff = Date.now() - this.fechaNacimiento.getTime();
        return new Date(diff).getUTCFullYear() - 1970;
    }
}
exports.Player = Player;
