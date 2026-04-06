import express from "express";
import helmet  from "helmet";
import cors from "cors";
import { errorMiddleware } from "./middlewares/error_middleware";

export default (app : express.Express) => {
    app.disable("x-powerded-by");

    app.use(express.json());
    app.use(express.urlencoded({ extended : true}));

    app.use(cors());
    app.use(helmet());
    app.use(errorMiddleware);

}