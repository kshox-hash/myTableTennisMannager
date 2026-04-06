import bcrypt from "bcrypt"

export  function hashPassword(pass : string) : Promise<string>{
    return bcrypt.hash(pass, 10)
}   

export function comparePassword(dataPassword : string, userPassword : string) : Promise<boolean>{
    return bcrypt.compare(dataPassword, userPassword);
}