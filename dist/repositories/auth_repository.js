"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRepository = exports.AuthRepository = void 0;
// src/repositories/auth_repository.ts
const mssql_1 = __importDefault(require("mssql"));
const db_configuration_1 = require("../db/db_configuration");
const base_repository_1 = require("../repositories/base_repository");
class AuthRepository extends base_repository_1.BaseRepository {
    constructor() {
        super("Users");
    }
    // Cumple: create(item: IUser): Promise<IUser>
    async create(item) {
        const pool = await (0, db_configuration_1.connectDB)();
        // (Opcional) validación rápida
        if (await this.emailExists(item.email)) {
            const err = new Error("Email is already registered");
            err.code = "DUPLICATE_EMAIL";
            throw err;
        }
        // Ejecuta PA usando los campos requeridos (NOT NULL)
        await pool
            .request()
            .input("FirstName", mssql_1.default.NVarChar(30), item.first_name)
            .input("LastName", mssql_1.default.NVarChar(30), item.last_name)
            .input("Email", mssql_1.default.NVarChar(100), item.email)
            .input("PasswordHash", mssql_1.default.NVarChar(255), item.password_hash)
            .execute("sp_InsertUser");
        // Lee desde BD para retornar el registro consistente
        const created = await this.findByEmail(item.email);
        if (!created)
            throw new Error("User not found after insert");
        return created;
    }
    // Cumple: findByEmail(email: string): Promise<IUser | null>
    async findByEmail(email) {
        const pool = await (0, db_configuration_1.connectDB)();
        const result = await pool
            .request()
            .input("email", mssql_1.default.NVarChar(100), email)
            .query(`
        SELECT 
          user_id,
          first_name,
          middle_name,
          last_name,
          second_last_name,
          birth_date,
          role,
          email,
          password_hash,
          created_at
        FROM Users
        WHERE email = @email
      `);
        return result.recordset?.[0] ?? null;
    }
    // Cumple: findAll(): Promise<IUser[]>
    async findAll() {
        const pool = await (0, db_configuration_1.connectDB)();
        const result = await pool.request().query(`
      SELECT 
        user_id,
        first_name,
        middle_name,
        last_name,
        second_last_name,
        birth_date,
        role,
        email,
        password_hash,
        created_at
      FROM Users
    `);
        return result.recordset;
    }
    // Cumple: updateByEmail(email: string, item: Partial<IUser>): Promise<IUser | null>
    async updateByEmail(email, partial) {
        if (!Object.keys(partial).length)
            return this.findByEmail(email);
        const allowed = [
            "first_name",
            "middle_name",
            "last_name",
            "second_last_name",
            "birth_date",
            "role",
            "password_hash",
        ];
        const sets = [];
        const pool = await (0, db_configuration_1.connectDB)();
        const req = pool.request().input("email", mssql_1.default.NVarChar(100), email);
        for (const k of allowed) {
            const v = partial[k];
            if (v !== undefined) {
                sets.push(`${k} = @${k}`);
                if (k === "birth_date")
                    req.input(k, mssql_1.default.Date, v);
                else if (k === "role")
                    req.input(k, mssql_1.default.NVarChar(20), v);
                else if (k === "password_hash")
                    req.input(k, mssql_1.default.NVarChar(255), v);
                else
                    req.input(k, mssql_1.default.NVarChar(30), v);
            }
        }
        if (!sets.length)
            return this.findByEmail(email);
        await req.query(`UPDATE Users SET ${sets.join(", ")} WHERE email = @email`);
        return this.findByEmail(email);
    }
    // Cumple: deleteByEmail(email: string): Promise<boolean>
    async deleteByEmail(email) {
        const pool = await (0, db_configuration_1.connectDB)();
        const res = await pool
            .request()
            .input("email", mssql_1.default.NVarChar(100), email)
            .query(`DELETE FROM Users WHERE email = @email`);
        return res.rowsAffected?.[0] > 0;
    }
    // --- Helper privado ---
    async emailExists(email) {
        const pool = await (0, db_configuration_1.connectDB)();
        const result = await pool
            .request()
            .input("email", mssql_1.default.NVarChar(100), email)
            .query(`SELECT 1 AS x FROM Users WHERE email = @email`);
        return result.recordset.length > 0;
    }
}
exports.AuthRepository = AuthRepository;
exports.authRepository = new AuthRepository();
//# sourceMappingURL=auth_repository.js.map