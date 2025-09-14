// src/repositories/PlayerRepository.ts

import { Player, IPlayer } from "../model/player/player_model";
import { BaseRepository } from "./base_repository"

export class PlayerRepository extends BaseRepository<IPlayer> {
  private db: Pool;

  constructor(db: Pool) {
    super("players");
    this.db = db;
  }

  async create(item: IPlayer): Promise<IPlayer> {
    const [result] = await this.db.execute(
      `INSERT INTO ${this.tableName} (nombre, fechaNacimiento, categoria, pais, club, telefono, email, rut, genero)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.nombre,
        item.fechaNacimiento,
        item.categoria,
        item.pais,
        item.club,
        item.telefono,
        item.email,
        item.rut,
        item.genero,
      ]
    );
    return { ...item, id: (result as any).insertId };
  }

  async findById(id: number): Promise<IPlayer | null> {
    const [rows] = await this.db.execute(
      `SELECT * FROM ${this.tableName} WHERE id = ?`,
      [id]
    );
    const data = (rows as any[])[0];
    return data ? (data as IPlayer) : null;
  }

  async findAll(): Promise<IPlayer[]> {
    const [rows] = await this.db.execute(`SELECT * FROM ${this.tableName}`);
    return rows as IPlayer[];
  }

  async update(id: number, item: Partial<IPlayer>): Promise<IPlayer | null> {
    const keys = Object.keys(item);
    const values = Object.values(item);
    const setClause = keys.map((key) => `${key} = ?`).join(", ");

    await this.db.execute(
      `UPDATE ${this.tableName} SET ${setClause} WHERE id = ?`,
      [...values, id]
    );

    return this.findById(id);
  }

  async delete(id: number): Promise<boolean> {
    const [result] = await this.db.execute(
      `DELETE FROM ${this.tableName} WHERE id = ?`,
      [id]
    );
    return (result as any).affectedRows > 0;
  }
}
