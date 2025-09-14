import { connectDB } from "../db/db_configuration";

test("conexión real a SQL Server", async () => {
  await connectDB();
  // si no lanza error, asumimos que funciona
  expect(true).toBe(true);
});
