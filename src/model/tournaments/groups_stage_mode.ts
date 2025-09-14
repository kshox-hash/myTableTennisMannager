// src/models/GroupStage.ts
export interface IGroupStage {
  id: number;
  torneoId: number;
  grupo: string;
  jugadores: number[];
  configuracionSets: number;
}

export class GroupStage implements IGroupStage {
  constructor(
    public id: number,
    public torneoId: number,
    public grupo: string,
    public jugadores: number[],
    public configuracionSets: number
  ) {}

  addPlayer(jugadorId: number): void {
    this.jugadores.push(jugadorId);
  }
}
