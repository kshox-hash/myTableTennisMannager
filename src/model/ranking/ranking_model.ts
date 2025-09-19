// src/models/Ranking.ts
export interface IRanking {
  userId : number;
  points : number
}

export class RankingModel implements IRanking {
  constructor(
    public userId : number,
    public points : number
  ) {}

}
