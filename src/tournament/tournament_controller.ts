import { Request, Response } from "express";
import { TournamentService } from "./tournament_service";
import { ITournament, TournamentCreateDTO } from "../interfaces/dto/tournament_dto";
import { json } from "zod";


class TournamentController {
  constructor(private tournamentService: TournamentService) {}

  /**
   * POST /tournaments - Create tournament
   */
createTournament = async (req: Request, res: Response) => {

  try {

    const tournamentData = req.body as TournamentCreateDTO;

    const newTournament : ITournament = await this.tournamentService.createTournament(tournamentData);

    return res.status(201).json({
      ok: true,
      data: newTournament,
    });

  } catch (err: any) {
    console.error("[TournamentController.create Function] Error:", err);
    return res.status(500).json({
      ok: false,
      message: err.message || "Internal Server Error",
    });
  }
};

   listTournament = async (_req : Request, res : Response) => {
  
  try {

    const dataTournamentList : ITournament[] = await this.tournamentService.listTournament();
    
    return  res.status(201).json({
      ok : true,
      data : dataTournamentList
    }) 
    
      
  }catch(err : any){

    console.log("[TournamentController.listTournament Function Error :]", err);
    res.status(500).json({
      ok : false,
      message : err.message || "Internal Server Error"
    })
    
  }

}



}

export default TournamentController;