// src/models/Ranking.ts
export interface IRanking {
  jugadorId: number;
  puntosTotales: number;
  setsGanados: number;
  diferencialPuntos: number;
  posicion: number;
}

export class Ranking implements IRanking {
  constructor(
    public jugadorId: number,
    public puntosTotales: number,
    public setsGanados: number,
    public diferencialPuntos: number,
    public posicion: number
  ) {}

  addPoints(puntos: number): void {
    this.puntosTotales += puntos;
  }
}
