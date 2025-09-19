import express, { Application } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";

import routerTournament from "./routes/tournaments_router";
import { errorHandler } from "../src/middlewares/error_handler";

dotenv.config();

class Server {
  public app: Application;
  public port: number;

  constructor() {
    this.app = express();
    this.port = Number(process.env.PORT) || 3000;
    this.middlewares();
    this.routes();
  }

  private middlewares(): void {
    this.app.use(express.json()); // para recibir JSON
    this.app.use(cors()); // habilita CORS
    this.app.use(helmet()); // seguridad HTTP headers
    this.app.use(morgan("dev")); // logs HTTP
  }

  private routes(): void {
    this.app.use("/tournament", routerTournament);
    this.app.use(errorHandler); // manejo de errores centralizado
  }

  public async init(): Promise<void> {
    this.app.listen(this.port, () => {
      console.log(`server running on${this.port}`);
    });
  }
}

const server = new Server();
server.init();




