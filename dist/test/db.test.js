"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const db_configuration_1 = require("../db/db_configuration");
test("conexión real a SQL Server", async () => {
    await (0, db_configuration_1.connectDB)();
    // si no lanza error, asumimos que funciona
    expect(true).toBe(true);
});
