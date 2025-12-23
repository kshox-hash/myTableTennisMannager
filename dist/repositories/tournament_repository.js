"use strict";
// src/repositories/TournamentRepository.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.TournamentRepository = void 0;
const base_repository_1 = require("./base_repository");
const db_configuration_1 = require("../db/db_configuration");
/**
 * Repositorio que gestiona las operaciones de base de datos para torneos.
 * Extiende una clase base genérica `BaseRepository`.
 */
class TournamentRepository extends base_repository_1.BaseRepository {
    constructor() {
        super("Campeonatos"); // Nombre de la tabla en la base de datos
    }
    /**
     * Crear un nuevo torneo en la base de datos
     * @param item Objeto de torneo a crear
     * @returns El mismo objeto recibido (sin ID generado)
     */
    async create(item) {
        const pool = await (0, db_configuration_1.connectDB)();
        const result = await pool.request()
            .input("nombre", item.nombre)
            // .input("categoria", item.categoria) // Puedes habilitar esto si está en el modelo
            .input("fecha_inicio", item.fecha_inicio)
            .input("fecha_fin", item.fecha_fin)
            .input("creado_por", item.creador) // "creador" si existe en el modelo
            .query(`
        INSERT INTO ${this.tableName} (nombre, fecha_inicio, fecha_fin, creado_por)
        VALUES (@nombre, @fecha_inicio, @fecha_fin, @creado_por)
      `);
        console.log("Resultado INSERT:", result); // Para depuración
        // Nota: Podrías retornar el objeto con ID si haces un SELECT SCOPE_IDENTITY()
        return item;
    }
    /**
     * Buscar un torneo por su ID
     * @param id ID del torneo
     * @returns El torneo si se encuentra, o null
     */
    async findById(id) {
        const pool = await (0, db_configuration_1.connectDB)();
        const result = await pool.request()
            .input("id", id)
            .query(`SELECT * FROM ${this.tableName} WHERE id_campeonato = @id`);
        return result.recordset[0] || null;
    }
    /**
     * Obtener todos los torneos
     * @returns Lista de torneos
     */
    async findAll() {
        const pool = await (0, db_configuration_1.connectDB)();
        const result = await pool.request().query(`SELECT * FROM ${this.tableName}`);
        return result.recordset;
    }
    /**
     * Actualizar un torneo por su ID
     * @param id ID del torneo a actualizar
     * @param item Campos del torneo a modificar
     * @returns El torneo actualizado, o null si no existe
     */
    async update(id, item) {
        const pool = await (0, db_configuration_1.connectDB)();
        const keys = Object.keys(item);
        // Si no hay campos para actualizar, simplemente devuelve el torneo actual
        if (keys.length === 0)
            return this.findById(id);
        // Generar la cláusula SET dinámica
        const setClause = keys.map((key) => `${key} = @${key}`).join(", ");
        const request = pool.request();
        // Agregar cada campo como parámetro
        keys.forEach((key) => {
            request.input(key, item[key]);
        });
        // Ejecutar el UPDATE
        await request.input("id", id).query(`
      UPDATE ${this.tableName} SET ${setClause} WHERE id_campeonato = @id
    `);
        // Retornar el torneo actualizado
        return this.findById(id);
    }
    /**
     * Eliminar un torneo por su ID
     * @param id ID del torneo a eliminar
     * @returns true si fue eliminado, false si no existía
     */
    async delete(id) {
        const pool = await (0, db_configuration_1.connectDB)();
        const result = await pool.request()
            .input("id", id)
            .query(`DELETE FROM ${this.tableName} WHERE id_campeonato = @id`);
        return result.rowsAffected[0] > 0;
    }
}
exports.TournamentRepository = TournamentRepository;
//# sourceMappingURL=tournament_repository.js.map