// game.js
const { createDeck, shuffle, calculateScore } = require('./deck');

/**
 * Génère un code de table unique à 4 lettres
 */
function generateRoomCode(rooms) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return rooms[code] ? generateRoomCode(rooms) : code;
}

/**
 * Envoie un message JSON à tous les joueurs connectés à une table
 */
function broadcastToRoom(room, action, stateData) {
    if (!room) return;
    const message = JSON.stringify({ action: action, state: stateData });
    room.players.forEach(player => {
        if (player.ws.readyState === 1) { // 1 = OPEN
            player.ws.send(message);
        }
    });
}

/**
 * Nettoie l'état de la table avant envoi (supprime les références WebSocket circulaires)
 */
function getSanitizedState(room) {
    return {
        code: room.code,
        status: room.status,
        dealerType: room.dealerType,
        dealerHand: room.dealerHand,
        dealerScore: calculateScore(room.dealerHand),
        currentPlayerIndex: room.currentPlayerIndex,
        players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            hand: p.hand,
            score: calculateScore(p.hand),
            bet: p.bet,
            chips: p.chips
        }))
    };
}

function createRoom(rooms, ws) {
    const roomCode = generateRoomCode(rooms);
    rooms[roomCode] = {
        code: roomCode,
        status: "waiting",
        dealerType: "AI", 
        dealerHand: [],
        deck: [],
        currentPlayerIndex: 0,
        players: []
    };
    console.log(`[Room] Table ${roomCode} créée.`);
    joinRoom(rooms, ws, roomCode);
}

function joinRoom(rooms, ws, roomCode) {
    const code = roomCode ? roomCode.toUpperCase() : "";
    const room = rooms[code];

    if (!room) {
        ws.send(JSON.stringify({ action: "error", message: "Table introuvable" }));
        return;
    }
    if (room.players.length >= 4) {
        ws.send(JSON.stringify({ action: "error", message: "Table pleine" }));
        return;
    }

    ws.roomCode = code;
    room.players.push({
        id: ws.id,
        name: ws.playerName,
        hand: [],
        bet: 0,
        chips: 1000,
        ws: ws
    });

    ws.send(JSON.stringify({ action: "room_joined", room_code: code }));
    broadcastToRoom(room, "update_table", getSanitizedState(room));
}

function toggleDealerMode(room, ws) {
    if (!room) return;
    room.dealerType = (room.dealerType === ws.id) ? "AI" : ws.id;
    broadcastToRoom(room, "update_table", getSanitizedState(room));
}

function startRound(room) {
    if (!room || room.players.length === 0) return;

    room.status = "playing";
    room.deck = shuffle(createDeck());
    room.dealerHand = [];
    room.currentPlayerIndex = 0;
    
    room.players.forEach(p => {
        p.hand = [];
        p.bet = 100; // Mise automatique par défaut pour le MVP
    });

    // Distribution initiale : 2 cartes par joueur, 1 pour le croupier
    for (let i = 0; i < 2; i++) {
        room.players.forEach(p => p.hand.push(room.deck.pop()));
    }
    room.dealerHand.push(room.deck.pop());

    broadcastToRoom(room, "update_table", getSanitizedState(room));
}

function handleHit(room, ws) {
    if (!room || room.status !== "playing") return;

    const activePlayer = room.players[room.currentPlayerIndex];
    if (!activePlayer || activePlayer.id !== ws.id) return;

    activePlayer.hand.push(room.deck.pop());
    
    if (calculateScore(activePlayer.hand) > 21) {
        goToNextPlayer(room);
    } else {
        broadcastToRoom(room, "update_table", getSanitizedState(room));
    }
}

function handleStand(room, ws) {
    if (!room || room.status !== "playing") return;

    const activePlayer = room.players[room.currentPlayerIndex];
    if (!activePlayer || activePlayer.id !== ws.id) return;

    goToNextPlayer(room);
}

function goToNextPlayer(room) {
    room.currentPlayerIndex++;

    if (room.currentPlayerIndex >= room.players.length) {
        runDealerTurn(room);
    } else {
        broadcastToRoom(room, "update_table", getSanitizedState(room));
    }
}

function runDealerTurn(room) {
    if (room.dealerType === "AI") {
        while (calculateScore(room.dealerHand) < 17) {
            room.dealerHand.push(room.deck.pop());
        }
        resolveRound(room);
    } else {
        room.status = "dealer_turn";
        broadcastToRoom(room, "update_table", getSanitizedState(room));
    }
}

function handleDealerHit(room, ws) {
    if (!room || room.status !== "dealer_turn" || room.dealerType !== ws.id) return;

    room.dealerHand.push(room.deck.pop());

    if (calculateScore(room.dealerHand) > 21) {
        resolveRound(room);
    } else {
        broadcastToRoom(room, "update_table", getSanitizedState(room));
    }
}

function handleDealerStand(room, ws) {
    if (!room || room.status !== "dealer_turn" || room.dealerType !== ws.id) return;
    resolveRound(room);
}

function resolveRound(room) {
    room.status = "resolved";
    const dealerScore = calculateScore(room.dealerHand);
    const dealerPlayer = room.players.find(p => p.id === room.dealerType);

    room.players.forEach(p => {
        if (p.id === room.dealerType) return; // Le joueur-croupier ne joue pas contre lui-même

        const playerScore = calculateScore(p.hand);
        let outcome = "push";

        if (playerScore > 21) outcome = "lose";
        else if (dealerScore > 21) outcome = "win";
        else if (playerScore > dealerScore) outcome = "win";
        else if (playerScore < dealerScore) outcome = "lose";

        // Transfert des jetons
        if (room.dealerType === "AI") {
            if (outcome === "win") p.chips += p.bet;
            if (outcome === "lose") p.chips -= p.bet;
        } else if (dealerPlayer) {
            if (outcome === "win") {
                p.chips += p.bet;
                dealerPlayer.chips -= p.bet;
            } else if (outcome === "lose") {
                p.chips -= p.bet;
                dealerPlayer.chips += p.bet;
            }
        }
    });

    broadcastToRoom(room, "update_table", getSanitizedState(room));
}

function handleDisconnect(rooms, ws) {
    const room = rooms[ws.roomCode];
    if (!room) return;

    room.players = room.players.filter(p => p.id !== ws.id);
    if (room.dealerType === ws.id) room.dealerType = "AI";

    if (room.players.length === 0) {
        delete rooms[ws.roomCode];
        console.log(`[Room] Table ${ws.roomCode} supprimée (vide).`);
    } else {
        if (room.status === "playing" && room.currentPlayerIndex >= room.players.length) {
            runDealerTurn(room);
        } else {
            broadcastToRoom(room, "update_table", getSanitizedState(room));
        }
    }
}

module.exports = {
    createRoom,
    joinRoom,
    toggleDealerMode,
    startRound,
    handleHit,
    handleStand,
    handleDealerHit,
    handleDealerStand,
    handleDisconnect,
    getSanitizedState,
    broadcastToRoom
};