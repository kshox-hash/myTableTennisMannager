// src/models/Match.ts
export interface IMatch {
  id: number;
  torneoId: number;
  jugador1: number;
  jugador2: number;
  sets: number;
  resultado?: string; // ejemplo: "3-2"
  estado: string; // pendiente, en curso, finalizado
}

export class Match implements IMatch {
  constructor(
    public id: number,
    public torneoId: number,
    public jugador1: number,
    public jugador2: number,
    public sets: number,
    public resultado: string,
    public estado: string
  ) {}

  isFinished(): boolean {
    return this.estado === "finalizado";
  }
}
