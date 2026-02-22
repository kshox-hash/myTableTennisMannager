// src/db/db_configuration.ts
import { Pool, PoolClient } from "pg";

type TxFn<T> = (client: PoolClient) => Promise<T>;

export default class DB {
  private static pool: Pool | null = null;

  static getPool(): Pool {
    if (!DB.pool) {
      DB.pool = new Pool({
        host: process.env.PGHOST ?? "localhost",
        port: Number(process.env.PGPORT ?? 5432),
        user: process.env.PGUSER ?? "postgres",
        password: process.env.PGPASSWORD ?? "123",
        database: process.env.PGDATABASE ?? "myttm",
        max: 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
      });
    }
    return DB.pool;
  }

  // ✅ helper transaccional
  static async withTransaction<T>(fn: TxFn<T>): Promise<T> {
    const pool = DB.getPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // si rollback falla, igual re-lanzamos el error original
      }
      throw err;
    } finally {
      client.release();
    }
  }
}
