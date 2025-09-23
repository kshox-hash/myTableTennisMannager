import { IGroupStage } from "../interfaces/IGroupStage";
import { IBaseRepository } from "../repositories/base_repository";
import { connectDB } from "../db/db_configuration"; // ajusta la ruta según tu proyecto

export class GroupStageRepository implements IBaseRepository<IGroupStage> {
  constructor(public db: any) {}

  /**
   * Crear un nuevo grupo en la base de datos
   */
  async create(item: IGroupStage): Promise<IGroupStage> {
    const pool = await connectDB();
    const result = await pool
      .request()
      .input("numero", item.numero)
      .query(
        `INSERT INTO Groups (numero)
         OUTPUT INSERTED.id, INSERTED.numero
         VALUES (@numero)`
      );

    return result.recordset[0];
  }

  /**
   * Buscar un grupo por ID
   */
  async findById(id: number): Promise<IGroupStage | null> {
    const pool = await connectDB();
    const result = await pool
      .request()
      .input("id", id)
      .query(`SELECT id, numero FROM Groups WHERE id = @id`);

    if (result.recordset.length === 0) return null;
    return result.recordset[0];
  }

  /**
   * Obtener todos los grupos
   */
  async findAll(): Promise<IGroupStage[]> {
    const pool = await connectDB();
    const result = await pool.request().query(`SELECT id, numero FROM Groups`);
    return result.recordset;
  }

  /**
   * Actualizar un grupo por ID
   */
  async update(
    id: number,
    item: Partial<IGroupStage>
  ): Promise<IGroupStage | null> {
    const pool = await connectDB();
    const result = await pool
      .request()
      .input("id", id)
      .input("numero", item.numero ?? null)
      .query(
        `UPDATE Groups SET numero = ISNULL(@numero, numero)
         OUTPUT INSERTED.id, INSERTED.numero
         WHERE id = @id`
      );

    if (result.recordset.length === 0) return null;
    return result.recordset[0];
  }

  /**
   * Eliminar un grupo
   */
  async delete(id: number): Promise<boolean> {
    const pool = await connectDB();
    const result = await pool
      .request()
      .input("id", id)
      .query(`DELETE FROM Groups WHERE id = @id`);

    return result.rowsAffected[0] > 0;
  }

  /**
   * Agregar un jugador a un grupo
   */
  async addPlayer(groupId: number, playerId: number): Promise<void> {
    const pool = await connectDB();
    await pool
      .request()
      .input("groupId", groupId)
      .input("playerId", playerId)
      .query(
        `INSERT INTO GroupPlayers (groupId, playerId)
         VALUES (@groupId, @playerId)`
      );
  }

  /**
   * Obtener jugadores de un grupo
   */
  async getPlayers(groupId: number): Promise<any[]> {
    const pool = await connectDB();
    const result = await pool
      .request()
      .input("groupId", groupId)
      .query(
        `SELECT p.id, p.nombre, p.ranking, p.club
         FROM GroupPlayers gp
         JOIN Players p ON p.id = gp.playerId
         WHERE gp.groupId = @groupId`
      );

    return result.recordset;
  }
}
