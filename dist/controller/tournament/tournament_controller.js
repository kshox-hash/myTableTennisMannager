"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TournamentController = void 0;
class TournamentController {
    constructor(tournamentService) {
        this.tournamentService = tournamentService;
        this.create = async (req, res) => {
            console.log(req.body);
            try {
                const torneo = await this.tournamentService.createTournament(req.body);
                res.status(201).json(torneo);
            }
            catch (err) {
                res.status(500).json({ error: err.message });
            }
        };
        this.list = async (req, res) => {
            const torneos = await this.tournamentService.listTournaments();
            res.json(torneos);
        };
    }
}
exports.TournamentController = TournamentController;
