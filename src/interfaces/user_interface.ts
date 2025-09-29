 export interface IUser {
    id_usuario : number;
    rut : number;
    email : string;
    password_hash : string, 
    password_salt : string,
    name? : string | null,
    secondName? : string | null,
    lastName? : string | null,
    secondLastName? : string | null,
    username? : string | null,
    birthdate? : Date | null,
    category? : string[]| null,   
    rol : string;
    
}

