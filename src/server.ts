// src/app.ts
// dotenv PRIMERO de todo: los módulos que se importan abajo (r2_client, db
// config, etc.) leen process.env en su carga — si dotenv corre después, ven
// el entorno vacío. En Render no pasa (las env vars ya están en el proceso),
// pero en local con .env el orden importa.
import "dotenv/config";
import express from "express";
import http from "http";

import config from "./config";
import router from "./router";
import { runMigrations } from "./db/run_migrations";

class Server {
    private app : express.Express;
    private service! : http.Server;
    private PORT : number = parseInt(process.env.PORT ?? "3000", 10)

    constructor( ){
        this.app = express()
    }

    async start(){
        await runMigrations();

        config(this.app);
        router(this.app);

        this.service! = this.app.listen(this.PORT,"0.0.0.0", () => {
            console.log("server up")
        })

        return this.service!
    }

    async close(){
        this.service!.close();
        console.log("server stopped")

    }
}

const server = new Server()

server.start();

export default server;




 