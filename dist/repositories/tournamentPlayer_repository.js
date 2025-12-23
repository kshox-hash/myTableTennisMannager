"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TournamentPlayerRepository = void 0;
const base_repository_1 = require("./base_repository");
const db_configuration_1 = require("../db/db_configuration");
class TournamentPlayerRepository extends base_repository_1.BaseRepository {
    constructor() {
        super("Participantes");
    }
    async create(item) {
        const pool = await (0, db_configuration_1.connectDB)();
        const result = await pool.request()
            .input("userId", item.userId)
            .input("tournamentId", item.tournamentId)
            .query("");
        return item;
    }
    async findById() { }
    /*
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
    
    
    */
    findAll() {
        throw new Error("Method not implemented.");
    }
    update(id, item) {
        throw new Error("Method not implemented.");
    }
    delete(id) {
        throw new Error("Method not implemented.");
    }
}
exports.TournamentPlayerRepository = TournamentPlayerRepository;
//# sourceMappingURL=tournamentPlayer_repository.js.map