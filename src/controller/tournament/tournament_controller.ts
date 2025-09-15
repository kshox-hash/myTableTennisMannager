// src/controllers/TournamentController.ts

import { Request, Response } from "express";
import { TournamentService } from "../../services/tournament_service";

// El controlador gestiona las solicitudes HTTP relacionadas con torneos
export class TournamentController {
  constructor(private tournamentService: TournamentService) {}

  /**
   * Crear un nuevo torneo
   * Método POST /tournaments
   */
  create = async (req: Request, res: Response) => {
    try {
      // Se espera que req.body tenga los datos necesarios del torneo
      const torneo = await this.tournamentService.createTournament(req.body);
      res.status(201).json(torneo); // 201 Created
    } catch (err: any) {
      res.status(500).json({ error: err.message }); // Error interno del servidor
    }
  };

  /**
   * Listar todos los torneos
   * Método GET /tournaments
   */
  listTournaments = async (req: Request, res: Response) => {
    try {
      const tournaments = await this.tournamentService.listTournaments();
      res.status(200).json(tournaments); // 200 OK
    } catch (err: any) {
      res.status(500).json({ error: err.message }); // Error interno
    }
  };

  /**
   * Obtener un torneo por ID
   * Método GET /tournaments/:id
   */
  getTournament = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      // Validar que se proporciona un ID
      if (!id) {
        return res.status(400).json({ error: "Tournament ID is required" }); // 400 Bad Request
      }

      const tournament = await this.tournamentService.getTournament(id);

      // Si no se encuentra el torneo
      if (!tournament) {
        return res.status(404).json({ error: "Tournament not found" }); // 404 Not Found
      }

      res.status(200).json(tournament); // 200 OK
    } catch (err: any) {
      res.status(500).json({ error: err.message }); // Error interno
    }
  };

  /**
   * Eliminar un torneo por ID
   * Método DELETE /tournaments/:id
   */
  deleteTournament = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      // Validar que se proporciona un ID
      if (!id) {
        return res.status(400).json({ error: "Tournament ID is required" });
      }

      const deleted = await this.tournamentService.deleteTournament(id);

      if (!deleted) {
        return res.status(404).json({ error: "Tournament not found or already deleted" });
      }

      res.status(200).json({ message: "Tournament deleted successfully" }); // 200 OK
    } catch (err: any) {
      res.status(500).json({ error: err.message }); // Error interno
    }
  };
}
