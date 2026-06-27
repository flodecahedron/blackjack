// deck.js

/**
 * Crée un paquet standard de 52 cartes
 */
function createDeck() {
    const suits = ['♠', '♥', '♦', '♣'];
    const values = [
        { name: '2', val: 2 }, { name: '3', val: 3 }, { name: '4', val: 4 },
        { name: '5', val: 5 }, { name: '6', val: 6 }, { name: '7', val: 7 },
        { name: '8', val: 8 }, { name: '9', val: 9 }, { name: '10', val: 10 },
        { name: 'J', val: 10 }, { name: 'Q', val: 10 }, { name: 'K', val: 10 },
        { name: 'A', val: 11 }
    ];
    
    let deck = [];
    for (let suit of suits) {
        for (let v of values) {
            deck.push({ text: `${v.name}${suit}`, value: v.val, name: v.name });
        }
    }
    return deck;
}

/**
 * Mélange un paquet (Algorithme de Fisher-Yates)
 */
function shuffle(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

/**
 * Calcule le score d'une main en adaptant la valeur des As (11 ou 1)
 */
function calculateScore(hand) {
    let score = 0;
    let aces = 0;
    
    for (let card of hand) {
        score += card.value;
        if (card.name === 'A') aces++;
    }
    
    while (score > 21 && aces > 0) {
        score -= 10;
        aces--;
    }
    
    return score;
}

module.exports = { createDeck, shuffle, calculateScore };