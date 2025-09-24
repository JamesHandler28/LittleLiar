const socket = io();

// UI Elements
const hostLobbyView = document.getElementById('host-lobby-view');
const hostGameView = document.getElementById('host-game-view');
const roomCodeDisplay = document.getElementById('room-code-display');
const playerList = document.getElementById('player-list');
const startGameBtn = document.getElementById('start-game-btn');
const boardContainer = document.getElementById('board-container');
const gamePlayerList = document.getElementById('game-player-list');
const proposalDisplay = document.getElementById('proposal-display');
const pauseOverlay = document.getElementById('pause-overlay');
const pauseMessage = document.getElementById('pause-message');
const gameLog = document.getElementById('game-log');
const publicClueCard = document.getElementById('public-clue-card');
const declarationsContainer = document.getElementById('declarations-container');
const declarationsList = document.getElementById('declarations-list');
const gameOverOverlay = document.getElementById('game-over-overlay');
const playAgainBtn = document.getElementById('play-again-btn-host');
const finalAccusationOverlay = document.getElementById('final-accusation-overlay');
let accusationTimerInterval;
let gameData = { players: [], boardLayout: [], playerPositions: {} }; // Store persistent game data

// Socket Listeners
socket.on('connect', () => { 
    socket.emit('hostCreateGame'); 
});

socket.on('gameCreated', (roomCode) => { 
    roomCodeDisplay.textContent = roomCode; 
});

socket.on('lobbyUpdate', (data) => {
    playerList.innerHTML = '';
    data.players.forEach(player => {
        const li = document.createElement('li');
        li.classList.add('player-list-item'); // Add a class for styling

        let iconHtml = '';
        if (player.character) {
            iconHtml = `<img src="/assets/token_${player.character.color}.png" class="player-list-icon" alt="${player.character.name} icon">`;
        } else {
            // A placeholder for players who haven't selected a character
            iconHtml = `<div class="player-list-icon-placeholder"></div>`;
        }

        const characterText = player.character ? ` - Playing as ${player.character.name}` : ' - Selecting character...';
        li.innerHTML = `${iconHtml}<span>${player.name}${characterText}</span>`;
        playerList.appendChild(li);
    });

    if (data.players.length >= 3) { 
        startGameBtn.style.display = 'block'; 
    } else { 
        startGameBtn.style.display = 'none'; 
    }
});

startGameBtn.addEventListener('click', () => { 
    socket.emit('startGame', roomCodeDisplay.textContent); 
});

socket.on('gameStartError', (message) => {
    alert(message);
});

playAgainBtn.addEventListener('click', () => {
    socket.emit('playAgain', roomCodeDisplay.textContent);
});

socket.on('gameStarted', (data) => {
    hostLobbyView.style.display = 'none';
    hostGameView.style.display = 'block'; 
    
    // Store the initial full game data
    gameData.players = data.players;
    gameData.boardLayout = data.board;
    gameData.playerPositions = data.gameState.playerPositions;
    
    drawBoard(gameData.boardLayout);
    drawPawns(gameData.players, gameData.playerPositions);
    drawTraps(data.traps);
    drawTrackers(data.gameState);

    if (data.publicClue) {
        publicClueCard.style.display = 'block';
        publicClueCard.innerHTML = `<h4>Publicly Safe Location</h4><p>${data.publicClue}</p>`;
    }
});

socket.on('updateGameState', (gameState) => {
    // Use the stored player list with the new game state data
    gameData.playerPositions = gameState.playerPositions;
    updatePlayerList(gameData.players, gameState.scoutIndex !== undefined ? gameData.players[gameState.scoutIndex]?.playerId : null);
    drawPawns(gameData.players, gameData.playerPositions);
    drawTraps(gameState.traps);
    drawTrackers(gameState);
});

socket.on('startAccusationVote', (data) => {
    finalAccusationOverlay.style.display = 'flex';
    
    let historyContainer = document.querySelector('#final-accusation-overlay #final-declarations-list-container');
    if (!historyContainer) {
        historyContainer = document.createElement('div');
        historyContainer.id = 'final-declarations-list-container';
        document.getElementById('final-vote-container').insertAdjacentElement('beforebegin', historyContainer);
    }
    const declarationsHtml = data.declarations.map(d => `<li><strong>${d.bodyguardName}:</strong> L: ${d.declaredLocation}, W: ${d.declaredWeapon}</li>`).join('');
    historyContainer.innerHTML = `<h4>Declaration History</h4><ul>${declarationsHtml}</ul>`;
    
    document.getElementById('suspect-vote-list').innerHTML = data.suspects.join('<br>');
    document.getElementById('weapon-vote-list').innerHTML = data.weapons.join('<br>');
    document.getElementById('location-vote-list').innerHTML = data.locations.join('<br>');
    
    let duration = 300;
    clearInterval(accusationTimerInterval);
    accusationTimerInterval = setInterval(() => {
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        document.getElementById('accusation-timer').textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        if (--duration < 0) {
            clearInterval(accusationTimerInterval);
        }
    }, 1000);
});

socket.on('updateDeclaredClues', (declarations) => {
    declarationsContainer.style.display = 'block';
    declarationsList.innerHTML = '';

    declarations.forEach(declaration => {
        const li = document.createElement('li');
        li.innerHTML = `<strong>${declaration.bodyguardName} declared:</strong> ${declaration.declaredLocation} & ${declaration.declaredWeapon}`;
        declarationsList.appendChild(li);
    });
});

socket.on('showProposal', (data) => {
    proposalDisplay.style.display = 'block';
    proposalDisplay.innerHTML = `<h4>Vote in Progress...</h4><p><strong>${data.scoutName}</strong> proposes sending team [${data.teamNames.join(', ')}] to the <strong>${data.locationName}</strong>.</p><p><strong>Bodyguard:</strong> ${data.bodyguardName}</p>`;
});

socket.on('voteResult', (data) => {
    proposalDisplay.style.display = 'block';
    proposalDisplay.innerHTML = `<h4>Vote Result: ${data.passed ? 'PASSED' : 'FAILED'}</h4><p>YES: ${data.yesVotes} | NO: ${data.noVotes}</p>`;
});

socket.on('trapResult', (data) => {
    proposalDisplay.style.display = 'block';
    const { success, totalValue, trapValue, playedCards } = data;
    let cardList = '';
    if (playedCards && playedCards.length > 0) {
        cardList = playedCards.map(c => `<div class="card card-suit-${c.suit}"><span class="card-value">${c.value}</span></div>`).join('');
    }
    proposalDisplay.innerHTML = `<h4>Trap Result: ${success ? 'DISARMED' : 'FAILED'}</h4><div style="display: flex; justify-content: center; flex-wrap: wrap;">${cardList}</div><p>Total Value: ${totalValue} vs Trap Value: ${trapValue}</p>`;
});

socket.on('distributeCardsAnnouncement', (data) => {
    proposalDisplay.style.display = 'block';
    proposalDisplay.innerHTML = `<h4>Distributing Cards</h4><p>${data.text}</p>`;
});

socket.on('gamePaused', (message) => {
    pauseMessage.textContent = message;
    pauseOverlay.style.display = 'flex';
});

socket.on('gameResumed', () => {
    pauseOverlay.style.display = 'none';
});

socket.on('updateLog', (logMessages) => {
    gameLog.innerHTML = '';
    logMessages.slice().reverse().forEach(msg => {
        const li = document.createElement('li');
        li.textContent = msg;
        gameLog.appendChild(li);
    });
});

socket.on('gameOver', (data) => {
    clearInterval(accusationTimerInterval);
    finalAccusationOverlay.style.display = 'none';

    const winTitle = document.getElementById('win-title');
    const winReason = document.getElementById('win-reason');
    const plotReveal = document.getElementById('plot-reveal');
    const playerRolesList = document.getElementById('player-roles-list');

    winTitle.textContent = `${data.winningTeam.toUpperCase()} WIN!`;
    winTitle.className = data.winningTeam === 'Friends' ? 'friends-win' : 'conspiracy-win';
    winReason.textContent = data.reason;
    plotReveal.textContent = `${data.plot.weapon} in the ${data.plot.location}`;
    
    playerRolesList.innerHTML = '';
    data.players.forEach(player => {
        const li = document.createElement('li');
        li.className = player.role.includes('Conspiracy') ? 'Conspiracy' : 'Friend';
        li.innerHTML = `<span class="pawn-reveal" style="background-color: ${player.characterColor};"></span> ${player.name} <span>(${player.characterName})</span><br><strong>${player.role}</strong>`;
        playerRolesList.appendChild(li);
    });

    gameOverOverlay.style.display = 'flex';
});

socket.on('returnToLobby', () => {
    gameOverOverlay.style.display = 'none';
    hostGameView.style.display = 'none';
    hostLobbyView.style.display = 'block';
    publicClueCard.style.display = 'none';
    declarationsContainer.style.display = 'none';
    declarationsList.innerHTML = '';
    gameLog.innerHTML = '';
    proposalDisplay.style.display = 'none';
    document.querySelectorAll('.pawn').forEach(pawn => pawn.remove());
});

function drawBoard(board) {
    boardContainer.innerHTML = ''; // Clear the entire board before drawing
    board.forEach((square) => {
        const squareDiv = document.createElement('div');
        squareDiv.classList.add('square');
        squareDiv.dataset.id = square.id;
        squareDiv.style.gridArea = square.gridArea; // Assign the grid area for CSS positioning

        if(square.type === 'start') {
            squareDiv.classList.add('start-square');
        }
        
        const nameDiv = document.createElement('div');
        nameDiv.className = 'square-name';
        nameDiv.textContent = square.name;
        squareDiv.appendChild(nameDiv);

        if (square.type === 'health_tracker' || square.type === 'storm_tracker') {
            const valueDiv = document.createElement('div');
            valueDiv.className = 'tracker-value';
            squareDiv.appendChild(valueDiv);
        }
        boardContainer.appendChild(squareDiv);
    });
}

function drawTraps(traps) {
    if (!gameData.boardLayout.length) return;
    Object.entries(traps).forEach(([locationName, trap]) => {
        const locationData = gameData.boardLayout.find(s => s.name === locationName);
        if (!locationData) return;
        const roomDiv = boardContainer.querySelector(`[data-id='${locationData.id}']`);
        
        if (roomDiv) {
            let trapDiv = roomDiv.querySelector(".trap-info");
            if (!trapDiv) { 
                trapDiv = document.createElement("div"); 
                trapDiv.classList.add("trap-info"); 
                roomDiv.appendChild(trapDiv); 
            }
            if (trap.disarmed) {
                trapDiv.innerHTML = "✅ SAFE";
                trapDiv.style.color = '#27ae60';
            } else {
                const suitClass = `trap-suit-${trap.suit}`;
                trapDiv.innerHTML = `Trap: ${trap.value} <span class="trap-suit ${suitClass}"></span>`;
                trapDiv.style.color = '#ff4d4d';
            }
        }
    });
}

function drawTrackers(gameState) {
    if (!gameState) return;
    
    const healthTrackerData = gameData.boardLayout.find(s => s.type === 'health_tracker');
    if (healthTrackerData) {
        const healthSquare = boardContainer.querySelector(`[data-id='${healthTrackerData.id}']`);
        if (healthSquare) {
            const valueDiv = healthSquare.querySelector('.tracker-value');
            if (valueDiv) {
                valueDiv.innerHTML = `❤️: ${gameState.health}`;
            }
        }
    }

    const stormTrackerData = gameData.boardLayout.find(s => s.type === 'storm_tracker');
    if (stormTrackerData) {
        const stormSquare = boardContainer.querySelector(`[data-id='${stormTrackerData.id}']`);
        if (stormSquare) {
            const valueDiv = stormSquare.querySelector('.tracker-value');
            if (valueDiv) {
                valueDiv.innerHTML = `☁️: ${gameState.stormPosition}`;
            }
        }
    }
}

function updatePlayerList(players, scoutId) {
    if (!players) return;
    gamePlayerList.innerHTML = '';
    players.forEach(player => {
        const li = document.createElement("li");
        li.classList.add('player-list-item'); // Add class for styling

        const voteIndicator = player.hasVoted ? '<span class="voted-check">✓</span>' : "";
        const characterName = player.character ? `(${player.character.name})` : "";
        
        let iconHtml = '';
        if (player.character) {
            iconHtml = `<img src="/assets/token_${player.character.color}.png" class="player-list-icon" alt="${player.character.name} icon">`;
        }

        li.innerHTML = `${iconHtml}<span>${player.name} ${characterName} ${voteIndicator}</span>`;

        if (player.playerId === scoutId) {
            li.classList.add("scout-highlight");
        }
        gamePlayerList.appendChild(li);
    });
}

function drawPawns(players, playerPositions) {
    if (!players || !playerPositions) return;

    // Use multipliers of the pawn's size for responsive spacing
    const offsetMultipliers = [ { x: -0.4, y: -0.4 }, { x: 0.4, y: -0.4 }, { x: -0.4, y: 0.4 }, { x: 0.4, y: 0.4 }, { x: 0, y: -0.5 }, { x: 0, y: 0.5 }, {x: -0.5, y: 0}, {x: 0.5, y: 0}];
    
    const currentPlayerIds = players.map(p => `pawn-${p.playerId}`);
    document.querySelectorAll('.pawn').forEach(pawn => {
        if (!currentPlayerIds.includes(pawn.id)) {
            pawn.remove();
        }
    });

    players.forEach((player, playerIndex) => {
        if (!player.character) return;
        const positionId = playerPositions[player.playerId];
        if (positionId === undefined) return;

        let pawn = document.getElementById(`pawn-${player.playerId}`);
        if (!pawn) {
            pawn = document.createElement('img');
            pawn.id = `pawn-${player.playerId}`;
            pawn.className = 'pawn';
            pawn.title = player.name;
            boardContainer.appendChild(pawn);
        }
        
        pawn.src = `/assets/token_${player.character.color}.png`;

        const roomDiv = boardContainer.querySelector(`[data-id='${positionId}']`);
        if (roomDiv) {
            const pawnSize = pawn.getBoundingClientRect();
            const pawnOffset = pawnSize.width / 2; // For centering

            // Calculate responsive offsets
            const multiplier = offsetMultipliers[playerIndex % offsetMultipliers.length];
            const offsetX = multiplier.x * pawnSize.width;
            const offsetY = multiplier.y * pawnSize.height;

            const squareRect = roomDiv.getBoundingClientRect();
            const boardRect = boardContainer.getBoundingClientRect();
            const destX = (squareRect.left - boardRect.left) + (squareRect.width / 2);
            const destY = (squareRect.top - boardRect.top) + (squareRect.height / 2);

            pawn.style.transform = `translate(${destX + offsetX - pawnOffset}px, ${destY + offsetY - pawnOffset}px)`;
        }
    });
}

// Redraw pawns on window resize to keep them positioned correctly on the responsive board
window.addEventListener('resize', () => {
    if (hostGameView.style.display === 'block') {
        drawPawns(gameData.players, gameData.playerPositions);
    }
});