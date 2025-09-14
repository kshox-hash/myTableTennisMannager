"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const routerLogin = express_1.default.Router();
routerLogin.get("/", (_req, res) => {
    res.send("working");
});
routerLogin.post("api/login/sign_in");
exports.default = routerLogin;
