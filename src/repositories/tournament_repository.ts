// src/repositories/TournamentRepository.ts
import { ITournament } from "../model/tournaments/tournament_model";
import { BaseRepository } from "./base_repository";
import { connectDB } from "../db/db_configuration";

export class TournamentRepository extends BaseRepository<ITournament> {
  private db: any;

  constructor() {
    super("Campeonatos");
  }

  async create(item: ITournament): Promise<ITournament> {
    const pool = await connectDB();

    const result = await pool.request()
      .input("nombre", item.nombre)
      //.input("categoria", item.categoria) // si lo agregas al modelo
      .input("fecha_inicio", item.fecha_inicio)
      .input("fecha_fin", item.fecha_fin)
      .input("creado_por", (item as any).creador) // si existe en tu modelo
      .query(`
        INSERT INTO ${this.tableName} (nombre, fecha_inicio, fecha_fin, creado_por)
        VALUES (@nombre, @fecha_inicio, @fecha_fin, @creado_por)
      `);

    console.log("Resultado INSERT:", result);

    return item; // devuelves lo insertado
  }

  async findById(id: number): Promise<ITournament | null> {
    const pool = await connectDB();

    const result = await pool.request()
      .input("id", id)
      .query(`SELECT * FROM ${this.tableName} WHERE id_campeonato = @id`);

    return result.recordset[0] || null;
  }

  async findAll(): Promise<ITournament[]> {
    const pool = await connectDB();
    const result = await pool.request().query(`SELECT * FROM ${this.tableName}`);
    return result.recordset as ITournament[];
  }

  async update(id: number, item: Partial<ITournament>): Promise<ITournament | null> {
    const pool = await connectDB();
    const keys = Object.keys(item);

    if (keys.length === 0) return this.findById(id);

    const setClause = keys.map((key) => `${key} = @${key}`).join(", ");
    const request = pool.request();

    keys.forEach((key) => request.input(key, (item as any)[key]));

    await request.input("id", id).query(`
      UPDATE ${this.tableName} SET ${setClause} WHERE id_campeonato = @id
    `);

    return this.findById(id);
  }

  async delete(id: number): Promise<boolean> {
    const pool = await connectDB();

    const result = await pool.request()
      .input("id", id)
      .query(`DELETE FROM ${this.tableName} WHERE id_campeonato = @id`);

    return result.rowsAffected[0] > 0;
  }
}
