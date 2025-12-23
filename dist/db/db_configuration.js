"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectDB = connectDB;
// src/db/db_configuration.ts
const mssql_1 = __importDefault(require("mssql"));
const config = {
    user: "sa",
    password: "123",
    server: "KSHOX", // o KSHOX\\SQLEXPRESS si es una instancia
    database: "MYTTM",
    options: {
        encrypt: false,
        trustServerCertificate: true,
    },
};
let pool = null;
async function connectDB() {
    try {
        if (pool)
            return pool; // reutilizar conexión
        pool = await mssql_1.default.connect(config);
        console.log("✅ Conexión a SQL Server establecida");
        return pool;
    }
    catch (err) {
        console.log(err);
        console.error("❌ Error de conexión a SQL Server:", err);
        throw err;
    }
}
//# sourceMappingURL=db_configuration.js.map