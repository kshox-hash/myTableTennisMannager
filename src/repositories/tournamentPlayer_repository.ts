import { BaseRepository } from "./base_repository";
import {ITournamentPlayer} from "../model/tournamentPlayer/tournamentPlayer_model";
import { connectDB } from "../db/db_configuration"

export class TournamentPlayerRepository extends BaseRepository<ITournamentPlayer> {

        constructor(){
            super("Participantes")
        }

       async create(item: ITournamentPlayer): Promise<ITournamentPlayer> {
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





        findAll(): Promise<ITournamentPlayer[]> {
            throw new Error("Method not implemented.");
        }
        update(id: number, item: Partial<ITournamentPlayer>): Promise<ITournamentPlayer | null> {
            throw new Error("Method not implemented.");
        }
        delete(id: number): Promise<boolean> {
            throw new Error("Method not implemented.");
        }

}