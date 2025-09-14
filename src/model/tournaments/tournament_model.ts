// src/models/Tournament.ts
export interface ITournament {

  nombre: string;
  //categoria: string; // Platinum, Gold, Silver, Bronze
  fecha_inicio: Date;
  fecha_fin: Date;
  creador : number

}

export class Tournament implements ITournament {
  constructor(
    

    public nombre: string,
   // public categoria: string,
    public fecha_inicio: Date,
    public fecha_fin: Date,
    public creador : number

  ) {}

  isActive(): boolean {
    const hoy = new Date();
    return hoy >= this.fecha_inicio && hoy <= this.fecha_fin;
  }
}
