// src/app.ts
import express from "express";
import http from "http";

import config from "./config"
import router from "./router"

class Server {
    private app : express.Express;
    private service! : http.Server;
    private PORT : number = 3000

    constructor( ){
        this.app = express()
    }

    async start(){

        config(this.app);
        router(this.app);

        this.service! = this.app.listen(this.PORT, () => {
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




 