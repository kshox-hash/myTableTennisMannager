import { BaseRepository } from "./base_repository";
import { IRanking } from "../model/ranking/ranking_model";
import { connectDB } from "../db/db_configuration"

export class RankingRepository implements BaseRepository<IRanking>{
    constructor(){
        super("insertar tabla db");
    }

    async create(){}
    async findById(){}
    async findAll(){}
    async update(){}
    async delete(){}
}