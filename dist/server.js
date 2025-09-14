"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const dotenv_1 = __importDefault(require("dotenv"));
const tournaments_router_1 = __importDefault(require("./routes/tournaments/tournaments_router"));
const error_handler_1 = require("../src/middlewares/error_handler");
dotenv_1.default.config();
class Server {
    constructor() {
        this.app = (0, express_1.default)();
        this.port = Number(process.env.PORT) || 3000;
        this.middlewares();
        this.routes();
    }
    middlewares() {
        this.app.use(express_1.default.json()); // para recibir JSON
        this.app.use((0, cors_1.default)()); // habilita CORS
        this.app.use((0, helmet_1.default)()); // seguridad HTTP headers
        this.app.use((0, morgan_1.default)("dev")); // logs HTTP
    }
    routes() {
        this.app.use("/tournament", tournaments_router_1.default);
        this.app.use(error_handler_1.errorHandler); // manejo de errores centralizado
    }
    async init() {
        this.app.listen(this.port, () => {
            console.log(`server running on${this.port}`);
        });
    }
}
const server = new Server();
server.init();
