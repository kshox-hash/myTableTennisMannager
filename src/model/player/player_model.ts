// src/models/Player.ts
export interface IPlayer {
  id: number;
  nombre: string;
  fechaNacimiento: Date;
  categoria: string;
  pais: string;
  club: string;
  telefono?: string;
  email: string;
  rut: string;
  genero: string;
}

export class Player implements IPlayer {
  constructor(
    public id: number,
    public nombre: string,
    public fechaNacimiento: Date,
    public categoria: string,
    public pais: string,
    public club: string,
    public telefono: string,
    public email: string,
    public rut: string,
    public genero: string
  ) {}

  getEdad(): number {
    const diff = Date.now() - this.fechaNacimiento.getTime();
    return new Date(diff).getUTCFullYear() - 1970;
  }
}
