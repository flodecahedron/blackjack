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
 * Nettoie l'état de la table avant envoi (Structure multi-mains adaptative)
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
            hands: p.hands.map(h => ({
                cards: h.cards,
                score: calculateScore(h.cards),
                bet: h.bet,
                status: h.status
            })),
            currentHandIndex: p.currentHandIndex,
            chips: p.chips,
            lastOutcome: p.lastOutcome || null,
            lastReward: p.lastReward || 0
        }))
    };
}

function createRoom(rooms, ws, playerName, chips) {
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
    console.log(`[Room] Table ${roomCode} créée par ${playerName}.`);
    joinRoom(rooms, ws, roomCode, playerName, chips);
}

function joinRoom(rooms, ws, roomCode, playerName, chips) {
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
        name: playerName || "Joueur",
        hands: [],
        currentHandIndex: 0,
        chips: chips !== undefined ? chips : 1000,
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

function startRound(room, customBet = 100) {
    if (!room || room.players.length === 0) return;

    room.status = "playing";
    room.deck = shuffle(createDeck());
    room.dealerHand = [];
    room.currentPlayerIndex = 0;
    
    room.players.forEach(p => {
        p.hands = [{
            cards: [],
            bet: customBet,
            status: "playing"
        }];
        p.currentHandIndex = 0;
        p.lastOutcome = null;
        p.lastReward = 0;
    });

    for (let i = 0; i < 2; i++) {
        room.players.forEach(p => p.hands[0].cards.push(room.deck.pop()));
    }
    room.dealerHand.push(room.deck.pop());

    broadcastToRoom(room, "update_table", getSanitizedState(room));
}

function handleHit(room, ws) {
    if (!room || room.status !== "playing") return;

    const activePlayer = room.players[room.currentPlayerIndex];
    if (!activePlayer || activePlayer.id !== ws.id) return;

    const currentHand = activePlayer.hands[activePlayer.currentHandIndex];
    currentHand.cards.push(room.deck.pop());
    
    if (calculateScore(currentHand.cards) > 21) {
        currentHand.status = "busted";
        goToNextHandOrPlayer(room, activePlayer);
    } else {
        broadcastToRoom(room, "update_table", getSanitizedState(room));
    }
}

function handleDouble(room, ws) {
    if (!room || room.status !== "playing") return;

    const activePlayer = room.players[room.currentPlayerIndex];
    if (!activePlayer || activePlayer.id !== ws.id) return;

    const currentHand = activePlayer.hands[activePlayer.currentHandIndex];
    
    if (activePlayer.chips >= currentHand.bet) {
        currentHand.bet *= 2;
        currentHand.cards.push(room.deck.pop());
        
        if (calculateScore(currentHand.cards) > 21) {
            currentHand.status = "busted";
        } else {
            currentHand.status = "doubled";
        }
        goToNextHandOrPlayer(room, activePlayer);
    } else {
        ws.send(JSON.stringify({ action: "error", message: "Jetons insuffisants" }));
    }
}

function handleSplit(room, ws) {
    if (!room || room.status !== "playing") return;


    //  Uniquement au premier tirage (exactement 2 cartes) et max 1 split
    if (activePlayer.hands.length >= 2 || currentHand.cards.length !== 2) return;
    
    if (currentHand.cards[0].name !== currentHand.cards[1].name) {
        ws.send(JSON.stringify({ action: "error", message: "Le split requiert deux cartes identiques." }));
        return;
    }

    const activePlayer = room.players[room.currentPlayerIndex];
    if (!activePlayer || activePlayer.id !== ws.id) return;

    const currentHand = activePlayer.hands[activePlayer.currentHandIndex];
    if (activePlayer.hands.length >= 2 || currentHand.cards.length !== 2) return;
    
    // Utilisation de la structure d'objet pour comparer les valeurs intrinsèques des cartes
    if (currentHand.cards[0].value !== currentHand.cards[1].value) {
        ws.send(JSON.stringify({ action: "error", message: "Valeurs différentes" }));
        return;
    }

    if (activePlayer.chips < currentHand.bet) {
        ws.send(JSON.stringify({ action: "error", message: "Jetons insuffisants" }));
        return;
    }

    const card2 = currentHand.cards.pop();
    const splitHand = {
        cards: [card2],
        bet: currentHand.bet,
        status: "playing"
    };

    currentHand.cards.push(room.deck.pop());
    splitHand.cards.push(room.deck.pop());

    activePlayer.hands.push(splitHand);
    broadcastToRoom(room, "update_table", getSanitizedState(room));
}

function handleStand(room, ws) {
    if (!room || room.status !== "playing") return;

    const activePlayer = room.players[room.currentPlayerIndex];
    if (!activePlayer || activePlayer.id !== ws.id) return;

    activePlayer.hands[activePlayer.currentHandIndex].status = "stood";
    goToNextHandOrPlayer(room, activePlayer);
}

function goToNextHandOrPlayer(room, activePlayer) {
    if (activePlayer.currentHandIndex < activePlayer.hands.length - 1) {
        activePlayer.currentHandIndex++;
        broadcastToRoom(room, "update_table", getSanitizedState(room));
    } else {
        room.currentPlayerIndex++;
        if (room.currentPlayerIndex >= room.players.length) {
            runDealerTurn(room);
        } else {
            broadcastToRoom(room, "update_table", getSanitizedState(room));
        }
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
        if (p.id === room.dealerType) return;

        let globalReward = 0;
        let outcomes = [];

        p.hands.forEach(h => {
            const playerScore = calculateScore(h.cards);
            let outcome = "push";

            if (playerScore > 21) outcome = "lose";
            else if (dealerScore > 21) outcome = "win";
            else if (playerScore > dealerScore) outcome = "win";
            else if (playerScore < dealerScore) outcome = "lose";

            outcomes.push(outcome);

            if (room.dealerType === "AI") {
                if (outcome === "win") { p.chips += h.bet; globalReward += h.bet; }
                if (outcome === "lose") { p.chips -= h.bet; globalReward -= h.bet; }
            } else if (dealerPlayer) {
                if (outcome === "win") {
                    p.chips += h.bet;
                    dealerPlayer.chips -= h.bet;
                    globalReward += h.bet;
                } else if (outcome === "lose") {
                    p.chips -= h.bet;
                    dealerPlayer.chips += h.bet;
                    globalReward -= h.bet;
                }
            }
        });

        if (p.chips <= 0) p.chips = 100;
        if (dealerPlayer && dealerPlayer.chips <= 0) dealerPlayer.chips = 100;

        p.lastOutcome = outcomes[0]; 
        p.lastReward = globalReward;
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
    handleDouble,
    handleSplit,
    handleDealerHit,
    handleDealerStand,
    handleDisconnect,
    getSanitizedState,
    broadcastToRoom
};