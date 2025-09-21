const socket = io();

// UI Elements
const playerJoinView = document.getElementById('player-join-view');
const playerWaitView = document.getElementById('player-wait-view');
const playerGameView = document.getElementById('player-game-view');
const playerNameInput = document.getElementById('player-name-input');
const roomCodeInput = document.getElementById('room-code-input');
const joinGameBtn = document.getElementById('join-game-btn');
const playerNameDisplay = document.getElementById('player-name-display');
const roleDisplay = document.getElementById('role-display');
const characterDisplay = document.getElementById('character-display');
const playerHand = document.getElementById('player-hand');
const actionArea = document.getElementById('action-area');
const collectedClues = document.getElementById('collected-clues');
const clueList = document.getElementById('clue-list');
const conspiracyPlotInfo = document.getElementById('conspiracy-plot-info');
const conspiracyTeamInfo = document.getElementById('conspiracy-team-info');
const plotDetails = document.getElementById('plot-details');
const pauseOverlay = document.getElementById('pause-overlay');
const pauseMessage = document.getElementById('pause-message');
const gameOverOverlay = document.getElementById('game-over-overlay');
const roleGuideBtn = document.getElementById('role-guide-btn');
const roleGuideOverlay = document.getElementById('role-guide-overlay');
const closeRoleGuideBtn = document.getElementById('close-role-guide-btn');
const finalAccusationOverlay = document.getElementById('final-accusation-overlay');
const tieBreakerOverlay = document.getElementById('tie-breaker-overlay');
const characterSelectionContainer = document.getElementById('character-selection-container');
let accusationTimerInterval;

let currentRoomCode = '';
let myHand = [];
let myCharacter = null;
let allGameLocations = [];
let allGameWeapons = [];
let publicClueLocation = '';

const CHARACTERS = [
    { name: 'Agent Crimson', color: 'red' }, { name: 'General Gold', color: 'yellow' },
    { name: 'Casper Weiss', color: 'white' }, { name: 'Beatrix Verdi', color: 'green' },
    { name: 'Mr. Indigo', color: 'blue' }, { name: 'Violet Vale', color: 'purple' },
    { name: 'Duchess Rosa', color: 'pink' }, { name: 'Analyst Sterling', color: 'gray' },
    { name: 'Lady Marigold', color: 'orange' }, { name: 'The Technician', color: 'brown' }
];

joinGameBtn.addEventListener('click', () => {
    const playerName = playerNameInput.value;
    const roomCode = roomCodeInput.value.toUpperCase();
    let playerId = null;
    if (sessionStorage.getItem('roomCode') === roomCode) {
        playerId = sessionStorage.getItem('playerId');
    } else {
        sessionStorage.removeItem('playerId');
        sessionStorage.removeItem('roomCode');
    }
    if (playerName && roomCode) {
        currentRoomCode = roomCode;
        socket.emit('playerJoinGame', { playerName, roomCode, playerId });
    } else {
        alert('Please enter your name and a room code.');
    }
});

roleGuideBtn.addEventListener('click', () => {
    const isVisible = roleGuideOverlay.style.display === 'flex';
    if (isVisible) {
        roleGuideOverlay.style.display = 'none';
        roleGuideBtn.textContent = 'How to Play';
    } else {
        roleGuideOverlay.style.display = 'flex';
        roleGuideBtn.textContent = 'Hide Rules';
    }
});

closeRoleGuideBtn.addEventListener('click', () => {
    roleGuideOverlay.style.display = 'none';
    roleGuideBtn.textContent = 'How to Play';
});

socket.on('joinSuccess', (data) => {
    playerJoinView.style.display = 'none';
    playerWaitView.style.display = 'block';
    playerNameDisplay.textContent = data.playerName;
    sessionStorage.setItem('playerId', data.playerId);
    sessionStorage.setItem('roomCode', currentRoomCode);
});

socket.on('lobbyUpdate', (data) => {
    if (playerWaitView.style.display === 'block') {
        const me = data.players.find(p => p.name === playerNameDisplay.textContent);
        myCharacter = me ? me.character : null;
        drawCharacterSelection(data.availableCharacters, data.players);
    }
});

socket.on('joinError', (message) => alert(message));
socket.on('gameStartedPlayer', () => {
    playerWaitView.style.display = 'none';
    playerGameView.style.display = 'block';
    roleGuideBtn.textContent = 'How to Play'; // Change text
    roleGuideBtn.style.display = 'inline-block';
});
socket.on('yourRole', (data) => {
    roleDisplay.textContent = data.role;
    characterDisplay.textContent = data.character.name;
    myHand = data.hand;
    drawHand(myHand);
    if (data.plot) {
        conspiracyPlotInfo.style.display = 'block';
        plotDetails.textContent = `Weapon: ${data.plot.weapon}, Location: ${data.plot.location}`;
    }
    if (data.conspiracyTeammates) {
        conspiracyTeamInfo.style.display = 'block';
        const teamList = document.getElementById('conspiracy-team-list');
        teamList.innerHTML = '';
        data.conspiracyTeammates.forEach(teammate => {
            const li = document.createElement('li');
            li.innerHTML = `<strong>${teammate.name}</strong> (${teammate.characterName}) - ${teammate.role}`;
            if (teammate.role === 'Conspiracy Ringleader') li.style.color = '#c0392b';
            teamList.appendChild(li);
        });
    }
});
socket.on('handUpdate', (newHand) => { myHand = newHand; drawHand(myHand); });
socket.on('scoutPhase', (data) => {
    actionArea.innerHTML = `<h3>You are the Scout!</h3><p>Choose a location, team, and Bodyguard.</p><div id="location-choices"></div><br><div id="team-choices"></div><br><button id="propose-team-btn">Propose Team</button>`;
    let selectedLocation = null;
    const locationChoices = document.getElementById('location-choices');
    data.locations.forEach(location => {
        const button = document.createElement('button');
        button.textContent = location.name;
        button.addEventListener('click', () => {
            locationChoices.querySelectorAll('button').forEach(btn => btn.classList.remove('selected'));
            button.classList.add('selected');
            selectedLocation = location.name;
        });
        locationChoices.appendChild(button);
    });
    const teamChoices = document.getElementById('team-choices');
    teamChoices.innerHTML = '<strong>Team:</strong><br>';
    data.players.forEach((player) => {
        const playerRow = document.createElement('div');
        const isScout = player.playerId === sessionStorage.getItem('playerId');
        const isDisabled = player.cardCount === 0 && !isScout;
        playerRow.innerHTML = `<label><input type="radio" name="bodyguard" value="${player.playerId}" id="bg-${player.playerId}" ${isScout || isDisabled ? 'disabled' : ''}> <label for="bg-${player.playerId}">Bodyguard</label></label> <label><input type="checkbox" class="team-checkbox" value="${player.playerId}" id="team-${player.playerId}" ${isScout ? 'checked disabled' : ''} ${isDisabled ? 'disabled' : ''}> <label for="team-${player.playerId}">${player.name} (${player.cardCount} cards)</label></label>`;
        teamChoices.appendChild(playerRow);
        if (!isScout && !isDisabled && !teamChoices.querySelector('input[name="bodyguard"]:checked')) {
            playerRow.querySelector('input[name="bodyguard"]').checked = true;
        }
    });
    document.getElementById('propose-team-btn').addEventListener('click', () => {
        const teamCheckboxes = teamChoices.querySelectorAll('.team-checkbox:checked');
        const proposedTeam = Array.from(teamCheckboxes).map(cb => cb.value);
        const bodyguardId = teamChoices.querySelector('input[name="bodyguard"]:checked')?.value;
        if (selectedLocation && proposedTeam.length > 0 && bodyguardId && proposedTeam.includes(bodyguardId)) {
            socket.emit('proposeTeam', { proposedTeam, proposedLocation: selectedLocation, bodyguardId, roomCode: data.roomCode });
            actionArea.innerHTML = '<p>Proposal sent! Waiting for votes...</p>';
        } else {
            alert('Please select a location, a team, and ensure the chosen Bodyguard is on the team.');
        }
    });
});
socket.on('finalScoutPhase', (data) => {
    actionArea.innerHTML = `<h3>Final Accusation: Choose Team</h3><p>Mr. Coral is dead! As the Scout, you must choose a team to receive the final clues from the board.</p><div id="final-team-choices"></div><button id="propose-final-team-btn">Propose Final Team</button>`;
    const teamChoices = document.getElementById('final-team-choices');
    data.players.forEach((player) => {
        const playerRow = document.createElement('div');
        const isScout = player.playerId === sessionStorage.getItem('playerId');
        playerRow.innerHTML = `<label><input type="checkbox" class="team-checkbox" value="${player.playerId}" ${isScout ? 'checked disabled' : ''}>${player.name}</label>`;
        teamChoices.appendChild(playerRow);
    });
    document.getElementById('propose-final-team-btn').addEventListener('click', () => {
        const teamCheckboxes = teamChoices.querySelectorAll('.team-checkbox:checked');
        if (teamCheckboxes.length === 0) {
            alert('You must select at least one player for the team.');
            return;
        }
        const proposedTeam = Array.from(teamCheckboxes).map(cb => cb.value);
        socket.emit('proposeFinalTeam', { proposedTeam, roomCode: currentRoomCode });
        actionArea.innerHTML = '<p>Final team proposed! Waiting for votes...</p>';
    });
});
socket.on('receiveFinalClues', (data) => {
    const { clues, weapons, locations } = data;
    if (clues.length > 0) {
        clues.forEach(clue => {
            const li = document.createElement('li');
            li.textContent = `Final Clue: ${clue.value}`;
            li.style.color = 'orange';
            clueList.appendChild(li);
        });
    }
    let html = `<h3>Final Clues Received!</h3><p>Secretly, you received the clues above. You must now make a public declaration for each one.</p><hr>`;
    clues.forEach((clue, index) => {
        html += `<div class="final-declaration-row"><p><strong>Real Clue:</strong> ${clue.type} - ${clue.value}</p><label>Declare your finding for this ${clue.type}:</label><select id="declaration-${index}"><option value="No Clue Found">No Clue Found</option>`;
        const list = clue.type === 'Location' ? locations : weapons;
        list.forEach(item => { html += `<option value="${item}">${item}</option>`; });
        html += `</select></div>`;
    });
    if (clues.length === 0) { html += `<p>You received no clues. You must declare "No Clue Found".</p>`; }
    html += `<button id="submit-final-declaration-btn">Submit All Declarations</button>`;
    actionArea.innerHTML = html;
    document.getElementById('submit-final-declaration-btn').addEventListener('click', () => {
        const declarations = clues.map((clue, index) => {
            const declaredValue = document.getElementById(`declaration-${index}`).value;
            return { type: clue.type, declaredValue: declaredValue };
        });
        if (clues.length === 0) { declarations.push({type: "Item", declaredValue: "No Clue Found"}); }
        socket.emit('submitFinalDeclaration', { roomCode: currentRoomCode, declarations });
        actionArea.innerHTML = '<p>You have made your final declaration. Waiting for teammates...</p>';
    });
});
socket.on('startAccusationVote', (data) => {
    actionArea.innerHTML = '';
    roleGuideBtn.style.display = 'none'; // Hide the roles button
    finalAccusationOverlay.style.display = 'flex';
    if (document.getElementById('final-declarations-list-container')) {
        document.getElementById('final-declarations-list-container').remove();
    }
    const createVoteList = (listEl, category, items) => {
        listEl.innerHTML = '';
        items.forEach((item, index) => {
            const label = document.createElement('label');
            const isChecked = index === 0 ? 'checked' : '';
            label.innerHTML = `<input type="radio" name="${category}" value="${item}" id="${category}-${index}" ${isChecked}><label for="${category}-${index}">${item}</label>`;
            listEl.appendChild(label);
        });
    };
    createVoteList(document.getElementById('suspect-vote-list'), 'suspect', data.suspects);
    createVoteList(document.getElementById('weapon-vote-list'), 'weapon', data.weapons);
    createVoteList(document.getElementById('location-vote-list'), 'location', data.locations);
    let duration = 300;
    clearInterval(accusationTimerInterval);
    accusationTimerInterval = setInterval(() => {
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        document.getElementById('accusation-timer').textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        if (--duration < 0) clearInterval(accusationTimerInterval);
    }, 1000);
    document.getElementById('submit-final-vote-btn').onclick = () => {
        const suspect = document.querySelector('input[name="suspect"]:checked')?.value;
        const weapon = document.querySelector('input[name="weapon"]:checked')?.value;
        const location = document.querySelector('input[name="location"]:checked')?.value;
        if (suspect && weapon && location) {
            socket.emit('submitFinalVote', { roomCode: currentRoomCode, suspect, weapon, location });
            document.getElementById('final-vote-container').innerHTML = '<h3>Vote submitted. Waiting for other players...</h3>';
            document.getElementById('submit-final-vote-btn').style.display = 'none';
        } else {
            alert('You must vote in all three categories.');
        }
    };
});
socket.on('resolveTie', (ties) => {
    finalAccusationOverlay.style.display = 'none';
    tieBreakerOverlay.style.display = 'flex';
    const container = document.getElementById('tie-breaker-container');
    container.innerHTML = '';
    Object.entries(ties).forEach(([category, options]) => {
        if (options && options.length > 1) {
            const categoryDiv = document.createElement('div');
            categoryDiv.innerHTML = `<h4>${category.charAt(0).toUpperCase() + category.slice(1)}</h4>`;
            options.forEach((option, index) => {
                const isChecked = index === 0 ? 'checked' : '';
                const label = document.createElement('label');
                label.innerHTML = `<input type="radio" name="${category}-tie" value="${option}" id="tie-${category}-${index}" ${isChecked}><label for="tie-${category}-${index}">${option}</label>`;
                categoryDiv.appendChild(label);
            });
            container.appendChild(categoryDiv);
        }
    });
    document.getElementById('submit-tie-breaker-btn').onclick = () => {
        const choices = {};
        let allTiesResolved = true;
        Object.keys(ties).forEach(category => {
            if (ties[category] && ties[category].length > 1) {
                const choice = document.querySelector(`input[name="${category}-tie"]:checked`)?.value;
                if(choice) choices[category] = choice;
                else allTiesResolved = false;
            }
        });
        if (allTiesResolved) {
            socket.emit('submitTieBreaker', { roomCode: currentRoomCode, choices });
            tieBreakerOverlay.style.display = 'none';
        } else {
            alert('You must resolve all ties.');
        }
    };
});
socket.on('voteOnProposal', (data) => {
    if (data.scoutId === socket.id) {
        actionArea.innerHTML = '<h3>Vote in Progress</h3><p>As the Scout, you automatically vote YES. Waiting for other players...</p>';
    } else {
        actionArea.innerHTML = `<h3>Vote on the Proposal</h3><p>Do you approve this team?</p><button id="vote-yes-btn">Vote YES</button><button id="vote-no-btn">Vote NO</button>`;
        document.getElementById('vote-yes-btn').addEventListener('click', () => { socket.emit('submitVote', { vote: true, roomCode: currentRoomCode }); actionArea.innerHTML = '<p>You voted YES. Waiting for other players...</p>'; });
        document.getElementById('vote-no-btn').addEventListener('click', () => { socket.emit('submitVote', { vote: false, roomCode: currentRoomCode }); actionArea.innerHTML = '<p>You voted NO. Waiting for other players...</p>'; });
    }
});
socket.on('voteResult', (data) => { actionArea.innerHTML = `<p>Vote ${data.passed ? 'PASSED' : 'FAILED'}.</p>${data.passed ? '' : '<p>Next round will begin shortly...</p>'}`; });
socket.on('disarmPhase', (data) => {
    let suitText = '';
    if (data.trap.suit === 'both') {
        suitText = `<strong style="color: #e67e22;">BOTH (no penalty for wrong color)</strong>`;
    } else {
        const suitColor = data.trap.suit === 'yellow' ? '#f1c40f' : '#F472B6';
        suitText = `<strong style="color:${suitColor};">${data.trap.suit.toUpperCase()}</strong>`;
    }
    let html = `<h3>Disarm the Trap!</h3><p>The trap value is <strong>${data.trap.value}</strong>. The matching suit is ${suitText}.</p>`;

    const disarmHandDiv = document.createElement('div');
    if (myHand.length === 0) {
        html += `<p>You have no cards to contribute.</p>`;
    } else {
        html += `<p>Select cards to contribute:</p>`;
        myHand.forEach((card, index) => {
            const label = document.createElement('label');
            label.className = 'clickable';
            const cardDiv = document.createElement('div');
            cardDiv.className = `card card-suit-${card.suit}`;
            cardDiv.innerHTML = `<span class="card-value">${card.value}</span>`;
            label.innerHTML = `<input type="checkbox" value="${index}" class="card-checkbox">`;
            label.appendChild(cardDiv);
            disarmHandDiv.appendChild(label);
        });
    }
    const submitBtn = document.createElement('button');
    submitBtn.id = 'submit-cards-btn';
    submitBtn.textContent = myHand.length === 0 ? 'Acknowledge' : 'Submit Cards';
    actionArea.innerHTML = html;
    actionArea.appendChild(disarmHandDiv);
    actionArea.appendChild(submitBtn);
    submitBtn.addEventListener('click', () => {
        const selectedCheckboxes = disarmHandDiv.querySelectorAll('input[type="checkbox"]:checked');
        const selectedCards = Array.from(selectedCheckboxes).map(cb => myHand[parseInt(cb.value)]);
        socket.emit('submitCardsForTrap', { cards: selectedCards, roomCode: currentRoomCode });
        actionArea.innerHTML = '<p>You have submitted your cards. Waiting for your teammates...</p>';
    });
});
socket.on('trapResult', (data) => { actionArea.innerHTML = `<h4>Trap ${data.success ? 'Disarmed!' : 'Failed!'}</h4>`; });
socket.on('cluePhase', (data) => {
    allGameLocations = data.locations;
    allGameWeapons = data.weapons;
    publicClueLocation = data.publicClue;
    actionArea.innerHTML = '<h3>You are the Bodyguard!</h3><p>The trap was disarmed. You can now collect the clues.</p><button id="collect-clues-btn">Collect Clues</button>';
    document.getElementById('collect-clues-btn').addEventListener('click', () => {
        socket.emit('collectClues', { roomCode: currentRoomCode });
        actionArea.innerHTML = '<p>Collecting clues...</p>';
    });
});
socket.on('cluesRevealed', (clues) => {
    let html = `<div id="real-clues-info"><p><strong>Secretly, you found:</strong><br>Location: ${clues.location}<br>Weapon: ${clues.weapon}</p></div><hr><h4>Make your public declaration:</h4><div><label>Location: </label><select id="location-declaration"><option value="No Clue Found">No Clue Found</option>`;
    allGameLocations.forEach(loc => { if (loc !== publicClueLocation) { html += `<option value="${loc}">${loc}</option>`; } });
    html += `</select></div><div><label>Weapon: </label><select id="weapon-declaration"><option value="No Clue Found">No Clue Found</option>`;
    allGameWeapons.forEach(wep => { html += `<option value="${wep}">${wep}</option>`; });
    html += `</select></div><button id="submit-declaration-btn">Submit Declaration</button>`;
    actionArea.innerHTML = html;
    document.getElementById('submit-declaration-btn').addEventListener('click', () => {
        const declaredLocation = document.getElementById('location-declaration').value;
        const declaredWeapon = document.getElementById('weapon-declaration').value;
        socket.emit('declareClues', { roomCode: currentRoomCode, declaredLocation, declaredWeapon });
        actionArea.innerHTML = '<p>You have made your declaration. Waiting for the next round to begin...</p>';
    });
});
socket.on('gamePaused', (message) => { pauseMessage.textContent = message; pauseOverlay.style.display = 'flex'; });
socket.on('gameResumed', () => { pauseOverlay.style.display = 'none'; });
socket.on('gameOver', (data) => {
    clearInterval(accusationTimerInterval);
    finalAccusationOverlay.style.display = 'none';
    tieBreakerOverlay.style.display = 'none';
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
        li.innerHTML = `${player.name} <span>(${player.characterName})</span><br><strong>${player.role}</strong>`;
        playerRolesList.appendChild(li);
    });
    gameOverOverlay.style.display = 'flex';
});
socket.on('returnToLobby', () => {
    gameOverOverlay.style.display = 'none';
    playerGameView.style.display = 'none';
    playerWaitView.style.display = 'block';
    characterSelectionContainer.innerHTML = '';
    myCharacter = null;
    roleDisplay.textContent = '???';
    characterDisplay.textContent = '???';
    playerHand.innerHTML = '';
    actionArea.innerHTML = '';
    collectedClues.style.display = 'none';
    clueList.innerHTML = '';
    conspiracyPlotInfo.style.display = 'none';
    conspiracyTeamInfo.style.display = 'none';
});

function drawHand(hand) {
    myHand = hand;
    playerHand.innerHTML = '<h4>Your Supply Cards:</h4>';
    if (!hand || hand.length === 0) return;
    const handContainer = document.createElement('div');
    handContainer.className = 'hand-container';
    hand.forEach(card => {
        const cardDiv = document.createElement('div');
        cardDiv.className = `card card-suit-${card.suit}`;
        cardDiv.innerHTML = `<span class="card-value">${card.value}</span>`;
        handContainer.appendChild(cardDiv);
    });
    playerHand.appendChild(handContainer);
}

function drawCharacterSelection(availableCharacters, players = []) {
    characterSelectionContainer.innerHTML = '<h4>Choose Your Character</h4>';
    const characterGrid = document.createElement('div');
    characterGrid.className = 'character-grid';
    CHARACTERS.forEach(char => {
        const charDiv = document.createElement('div');
        charDiv.className = 'character-option';
        const isAvailable = availableCharacters.some(availChar => availChar.name === char.name);
        if (myCharacter && myCharacter.name === char.name) {
            charDiv.classList.add('selected');
        }
        if (!isAvailable) {
            charDiv.classList.add('taken');
            const takingPlayer = players.find(p => p.character && p.character.name === char.name);
            charDiv.innerHTML = `<img class="pawn" src="/assets/token_${char.color}.png"><div>${char.name}<br><small>Taken by ${takingPlayer ? takingPlayer.name : ''}</small></div>`;
        } else {
            charDiv.innerHTML = `<img class="pawn" src="/assets/token_${char.color}.png"><div>${char.name}</div>`;
            charDiv.onclick = () => {
                socket.emit('selectCharacter', { roomCode: currentRoomCode, characterName: char.name });
            };
        }
        characterGrid.appendChild(charDiv);
    });
    characterSelectionContainer.appendChild(characterGrid);
}