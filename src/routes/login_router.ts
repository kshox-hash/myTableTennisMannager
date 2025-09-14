import express from "express"
const routerLogin = express.Router()


routerLogin.get("/", (_req, res) => {
    res.send("working")
})

routerLogin.post("api/login/sign_in", )



export default routerLogin;

