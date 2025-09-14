// src/controllers/TournamentController.ts
import { Request, Response } from "express";
import { TournamentService } from "../../services/tournament_service";

export class TournamentController {
  constructor(private tournamentService: TournamentService) {}

  create = async (req: Request, res: Response) => {
    console.log("aqui estamos en el controlador")
    console.log(req.body)
    try {
      const torneo = await this.tournamentService.createTournament(req.body);
      res.status(201).json(torneo);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  list = async (req: Request, res: Response) => {
    const torneos = await this.tournamentService.listTournaments();
    res.json(torneos);
  };
}
