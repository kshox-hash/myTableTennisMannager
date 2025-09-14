"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TournamentRepository = void 0;
const base_repository_1 = require("./base_repository");
class TournamentRepository extends base_repository_1.BaseRepository {
    constructor(db) {
        super("tournaments");
        this.db = db;
    }
    async create(item) {
        const [result] = await this.db.execute(`INSERT INTO ${this.tableName} (nombre, tipo, categoria, fechaInicio, fechaFin, ubicacion, sets, estado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
            item.nombre,
            item.tipo,
            item.categoria,
            item.fechaInicio,
            item.fechaFin,
            item.ubicacion,
            item.sets,
            item.estado,
        ]);
        return { ...item, id: result.insertId };
    }
    async findById(id) {
        const [rows] = await this.db.execute(`SELECT * FROM ${this.tableName} WHERE id = ?`, [id]);
        const data = rows[0];
        return data ? data : null;
    }
    async findAll() {
        const [rows] = await this.db.execute(`SELECT * FROM ${this.tableName}`);
        return rows;
    }
    async update(id, item) {
        const keys = Object.keys(item);
        const values = Object.values(item);
        const setClause = keys.map((key) => `${key} = ?`).join(", ");
        await this.db.execute(`UPDATE ${this.tableName} SET ${setClause} WHERE id = ?`, [...values, id]);
        return this.findById(id);
    }
    async delete(id) {
        const [result] = await this.db.execute(`DELETE FROM ${this.tableName} WHERE id = ?`, [id]);
        return result.affectedRows > 0;
    }
}
exports.TournamentRepository = TournamentRepository;
