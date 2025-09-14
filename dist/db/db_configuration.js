"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectDB = connectDB;
const mssql_1 = __importDefault(require("mssql"));
const config = {
    user: "sa",
    password: "123",
    server: "KSHOX",
    database: "MYTTM",
    options: {
        encrypt: false,
        trustServerCertificate: true
    }
};
async function connectDB() {
    try {
        const pool = await mssql_1.default.connect(config);
        return pool;
    }
    catch (err) {
        console.error("conexion error", err);
        return;
    }
}
