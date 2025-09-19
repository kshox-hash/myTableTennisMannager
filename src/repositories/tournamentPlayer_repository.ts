import { BaseRepository } from "./base_repository";
import {IPlayer} from "../model/player/player_model";
import {} from "../services/tournamentPlayer/tournamentPlayer_service";
import { connectDB } from "../db/db_configuration"

export class TournamentPlayerRepository extends BaseRepository<IPlayer> {

        constructor(){
            super("Participantes")
        }

       async create(item: IPlayer): Promise<IPlayer> {
            const pool = await connectDB();

            const result = await pool.request()
            .input("userId", item.userId)
            .input("tournamentId", item.tournamentId)
            .query("");

            return item
     }


async findById(id: number): Promise<number | null> {
  const pool = await connectDB();

  const result = await pool.request()
    .input("id", id)
    .query(`
      SELECT id
      FROM Players
      WHERE id = @id
    `);

  if (result.recordset.length > 0) {
    return result.recordset[0].id;
  }

  return null;
}





        findAll(): Promise<IPlayer[]> {
            throw new Error("Method not implemented.");
        }
        update(id: number, item: Partial<IPlayer>): Promise<IPlayer | null> {
            throw new Error("Method not implemented.");
        }
        delete(id: number): Promise<boolean> {
            throw new Error("Method not implemented.");
        }

}