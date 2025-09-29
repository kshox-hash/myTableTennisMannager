import { connectDB } from "../db/db_configuration";
import { IBaseRepository } from "./base_repository";
import { IUser } from "../interfaces/user_interface";

export class AuthRepository implements IBaseRepository<IUser> {
  constructor(private readonly db : any){}

  async create(item : IUser): Promise<IUser> {
    const db = await this.db.connectDB()
    const result = await db
    .request()
    .input("rut", item.rut)
    .input("email", item.email)
    .input("password_hash", item.password_hash)
    .input("password_salt", item.password_salt)
    return result.recordset[0];
  }

  async findById(id: number): Promise<IUser | null> {
    const db = await this.db.connectDB()
    const result = await db
    .request()
    .input("rut", id)
    .query(`SELECT id_usuario, rut, email, password_hash, password_salt, name, secondName, lastName, secondLastName, username, birthdate, category, rol 
            FROM Users WHERE id_usuario = @id AND active = 1`);
    if (result.recordset.length === 0) return null;
    return result.recordset[0]
  }

  async findByEmail(email: string) {
    const db = await this.db.connectDB()
    const result = await db
    .request()
    .input("email", email)
    .query(`SELECT id_usuario, rut, email, password_hash, password_salt, name, secondName, lastName, secondLastName, username, birthdate, category, rol 
            FROM Users WHERE email = @email AND active = 1`);
    if (result.recordset.length === 0) return null;
    return result.recordset[0]
  }

  async findAll(): Promise<IUser[]> {
    const db = await this.db.connectDB()
    const result = await db
    .request()
    .query(`SELECT id_usuario, rut, email, password_hash, password_salt, name, secondName, lastName, secondLastName, username, birthdate, category, rol 
            FROM Users WHERE active = 1`);
    return result.recordset;
  } 
  async update(id: number, item: Partial<IUser>) : Promise<any | null> {}
  async delete(id: number) : Promise<any> {}
    





}