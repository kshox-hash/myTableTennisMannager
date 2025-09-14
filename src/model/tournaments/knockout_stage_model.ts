// src/models/KnockoutStage.ts
export interface IKnockoutStage {
  id: number;
  torneoId: number;
  ronda: number;
  jugadores: number[];
  configuracionSets: number;
}

export class KnockoutStage implements IKnockoutStage {
  constructor(
    public id: number,
    public torneoId: number,
    public ronda: number,
    public jugadores: number[],
    public configuracionSets: number
  ) {}

  advanceWinners(winners: number[]): void {
    this.jugadores = winners;
  }
}
