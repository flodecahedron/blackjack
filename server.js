// server.js
const { WebSocketServer } = require('ws');
const game = require('./game');

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT, host: '0.0.0.0' });

// Base de données en mémoire des salons actifs
const rooms = {};

console.log(`[Main] Serveur Blackjack WebSockets démarré sur le port ${PORT}`);

wss.on('connection', (ws) => {
    // Initialisation du profil de connexion du client
    ws.id = "_" + Math.random().toString(36).substr(2, 9);
    ws.playerName = "Joueur " + ws.id.substr(1, 3).toUpperCase();
    ws.roomCode = null;

    console.log(`[Réseau] Connexion établie pour ${ws.playerName}`);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const room = rooms[ws.roomCode];

            switch(data.action) {
                case 'create_room':
                    game.createRoom(rooms, ws);
                    break;
                    
                case 'join_room':
                    game.joinRoom(rooms, ws, data.room_code);
                    break;
                    
                case 'get_table_state':
                    if (room) game.broadcastToRoom(room, "update_table", game.getSanitizedState(room));
                    break;

                case 'become_dealer':
                    game.toggleDealerMode(room, ws);
                    break;

                case 'start_round':
                    game.startRound(room);
                    break;

                case 'hit':
                    if (room?.status === "dealer_turn") {
                        game.handleDealerHit(room, ws);
                    } else {
                        game.handleHit(room, ws);
                    }
                    break;

                case 'stand':
                    if (room?.status === "dealer_turn") {
                        game.handleDealerStand(room, ws);
                    } else {
                        game.handleStand(room, ws);
                    }
                    break;
                
                default:
                    console.log(`[Réseau] Action inconnue reçue : ${data.action}`);
            }
        } catch (e) {
            console.error("[Réseau] Erreur de traitement du message JSON", e);
        }
    });

    ws.on('close', () => {
        game.handleDisconnect(rooms, ws);
    });
});