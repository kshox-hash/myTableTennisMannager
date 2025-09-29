// src/db/db_configuration.ts
import sql, { config as SQLConfig, ConnectionPool } from "mssql";

const config: SQLConfig = {
  user: "sa",
  password: "123",
  server: "KSHOX/MSSQLSERVER01", // o KSHOX\\SQLEXPRESS si es una instancia
  database: "MYTTM",
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

let pool: ConnectionPool | null = null;

export async function connectDB(): Promise<ConnectionPool> {
  try {
    if (pool) return pool; // reutilizar conexión
    pool = await sql.connect(config);
    console.log("✅ Conexión a SQL Server establecida");
    return pool;
  } catch (err) {
    console.error("❌ Error de conexión a SQL Server:", err);
    throw err;
  }
}

