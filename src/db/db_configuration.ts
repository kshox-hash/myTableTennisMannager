import { Pool } from "pg";


class DB {

  private options : any;

  constructor(){}

  async connect(){

          this.options = new Pool({
          host: "localhost",
          port: 5432,
          user: "postgres",
          password: "123",   
          database: "myttm",
    })

    return this.options;

  }
}

export default DB;



