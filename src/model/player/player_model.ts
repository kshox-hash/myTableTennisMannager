// src/models/Player.ts
export interface IPlayer {
  userId : number,
  tournamentId : number
}

export class Player implements IPlayer {
  constructor(
      public userId: number,
      public tournamentId : number
  ){}
}