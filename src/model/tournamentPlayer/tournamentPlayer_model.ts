// src/models/Player.ts
export interface ITournamentPlayer {
  userId : number,
  tournamentId : number
}

export class TournamentPlayerModel implements ITournamentPlayer {
  constructor(
      public userId: number,
      public tournamentId : number
  ){}
}