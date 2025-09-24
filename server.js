const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { WEAPONS, LOCATIONS, CHARACTERS, BOARD_LAYOUT, STARTING_POSITION_INDEX } = require('./gameData.js');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const port = process.env.PORT || 3000; // Use the host's port, or 3000 for local testing
app.use(express.static('public'));

const gameRooms = new Map();

// ### HELPER FUNCTIONS ###

function addToLog(roomCode, message) {
    const room = gameRooms.get(roomCode);
    if (!room) return;
    room.gameState.log.push(message);
    io.to(room.hostId).emit('updateLog', room.gameState.log);
}

function endGame(roomCode, winningTeam, reason) {
    const room = gameRooms.get(roomCode);
    if (!room || room.gameState.phase === 'GAME_OVER') return;
    if(room.accusationTimer) clearTimeout(room.accusationTimer);
    room.gameState.phase = 'GAME_OVER';

    const allPlayersInfo = room.players.map(p => ({
        name: p.name,
        characterName: p.character.name,
        characterColor: p.character.color,
        role: p.role
    }));

    const payload = {
        winningTeam: winningTeam,
        reason: reason,
        plot: room.gameState.plot,
        players: allPlayersInfo
    };
    io.to(roomCode).emit('gameOver', payload);
}

function resyncPlayerState(roomCode, player) {
    const room = gameRooms.get(roomCode);
    if (!room) return;
    const { gameState, players } = room;
    const { phase, proposal, scoutIndex } = gameState;
    const scout = players[scoutIndex];
    io.to(room.hostId).emit('updateGameState', gameState);
    if (phase === 'SCOUT_PHASE' && scout.playerId === player.playerId) {
        startScoutPhase(roomCode);
    } else if (phase === 'VOTE_PHASE' && (!proposal.votes || proposal.votes[player.socketId] === undefined)) {
        const bodyguardPlayer = players.find(p => p.playerId === proposal.bodyguard);
        const proposalData = { 
            scoutName: scout.name, 
            teamNames: proposal.team.map(pId => players.find(p => p.playerId === pId)).filter(p => p).map(p => p.name), 
            locationName: proposal.location, 
            bodyguardName: bodyguardPlayer ? bodyguardPlayer.name : "Unknown Player"
        };
        io.to(player.socketId).emit('voteOnProposal', { ...proposalData, scoutId: scout.socketId });
    } else if (phase === 'DISARM_PHASE' && proposal.team.includes(player.playerId) && (!proposal.submittedCards || !proposal.submittedCards[player.socketId])) {
        const trap = gameState.traps[proposal.location];
        io.to(player.socketId).emit('disarmPhase', { trap });
    } else if (phase === 'FINAL_ACCUSATION_VOTE') {
        io.to(player.socketId).emit('startAccusationVote', {
            suspects: CHARACTERS.map(c => c.name),
            weapons: WEAPONS,
            locations: LOCATIONS,
            declarations: gameState.declarations
        });
    }
}

function startFinalAccusationPhase(roomCode) {
    const room = gameRooms.get(roomCode);
    if (!room) return;
    const { players, gameState } = room;
    gameState.phase = 'FINAL_ACCUSATION_TEAM_SELECT';
    addToLog(roomCode, 'Mr. Coral is dead! Time for a final accusation.');
    io.to(room.hostId).emit('distributeCardsAnnouncement', { text: "MR. CORAL IS DEAD! Time for a final accusation." });
    gameState.scoutIndex = (gameState.scoutIndex + 1) % players.length;
    const scout = players[gameState.scoutIndex];
    if (room.disconnectedPlayers.has(scout.playerId)) {
        setTimeout(() => startFinalAccusationPhase(roomCode), 100);
        return;
    }
    addToLog(roomCode, `It is ${scout.name}'s turn to lead the final accusation.`);
    const playerInfo = players.map(p => ({ playerId: p.playerId, name: p.name }));
    io.to(scout.socketId).emit('finalScoutPhase', { players: playerInfo });
}

function startFinalClueDeal(roomCode) {
    const room = gameRooms.get(roomCode);
    if (!room) return;
    const { players, gameState } = room;
    gameState.phase = 'FINAL_ACCUSATION_DECLARE';
    const remainingClues = [];
    Object.entries(gameState.traps).forEach(([locationName, trap]) => {
        if (!trap.disarmed) {
            const clues = gameState.clues[locationName];
            if(clues.location !== "No Clue Found") remainingClues.push({type: 'Location', value: clues.location});
            if(clues.weapon !== "No Clue Found") remainingClues.push({type: 'Weapon', value: clues.weapon});
        }
    });
    remainingClues.sort(() => 0.5 - Math.random());
    const finalTeamIds = gameState.proposal.team;
    const finalTeam = players.filter(p => finalTeamIds.includes(p.playerId) && !room.disconnectedPlayers.has(p.playerId));
    gameState.finalDeclarationsNeeded = finalTeam.length;
    gameState.finalDeclarationsReceived = 0;
    if (finalTeam.length > 0) {
        finalTeam.forEach(p => p.finalClues = []);
        let i = 0;
        remainingClues.forEach(clue => {
            finalTeam[i % finalTeam.length].finalClues.push(clue);
            i++;
        });
        finalTeam.forEach(player => {
            io.to(player.socketId).emit('receiveFinalClues', {
                clues: player.finalClues,
                weapons: WEAPONS,
                locations: LOCATIONS
            });
        });
        addToLog(roomCode, `The final clues have been dealt.`);
        io.to(room.hostId).emit('distributeCardsAnnouncement', { text: "Waiting for the final team to declare their clues..." });
    } else {
        startAccusationVote(roomCode);
    }
}

function startAccusationVote(roomCode) {
    const room = gameRooms.get(roomCode);
    if (!room) return;
    const { players, gameState } = room;
    gameState.phase = 'FINAL_ACCUSATION_VOTE';
    gameState.finalVotes = {};
    players.forEach(p => p.hasVoted = false);
    addToLog(roomCode, `A 5-minute timer starts now for the final vote!`);
    if (room.accusationTimer) clearTimeout(room.accusationTimer);
    room.accusationTimer = setTimeout(() => {
        tallyFinalVotes(roomCode);
    }, 300000);
    const suspectList = CHARACTERS.map(c => c.name);
    io.to(roomCode).emit('startAccusationVote', {
        suspects: suspectList,
        weapons: WEAPONS,
        locations: LOCATIONS,
        declarations: gameState.declarations
    });
}

function tallyFinalVotes(roomCode) {
    const room = gameRooms.get(roomCode);
    if (!room || room.gameState.phase === 'GAME_OVER') return;
    const { players, gameState } = room;
    const counts = { suspect: {}, weapon: {}, location: {} };
    Object.values(gameState.finalVotes).forEach(vote => {
        counts.suspect[vote.suspect] = (counts.suspect[vote.suspect] || 0) + 1;
        counts.weapon[vote.weapon] = (counts.weapon[vote.weapon] || 0) + 1;
        counts.location[vote.location] = (counts.location[vote.location] || 0) + 1;
    });
    const findWinner = (categoryCounts) => {
        let winners = [];
        let maxVotes = 0;
        if (Object.keys(categoryCounts).length === 0) return [ "No one voted" ];
        for (const [item, votes] of Object.entries(categoryCounts)) {
            if (votes > maxVotes) {
                maxVotes = votes;
                winners = [item];
            } else if (votes === maxVotes) {
                winners.push(item);
            }
        }
        return winners.length > 0 ? winners : ["No one voted"];
    };
    const suspectWinners = findWinner(counts.suspect);
    const weaponWinners = findWinner(counts.weapon);
    const locationWinners = findWinner(counts.location);
    const finalAccusation = {};
    const ties = {};
    if (suspectWinners.length === 1) finalAccusation.suspect = suspectWinners[0];
    else ties.suspect = suspectWinners;
    if (weaponWinners.length === 1) finalAccusation.weapon = weaponWinners[0];
    else ties.weapon = weaponWinners;
    if (locationWinners.length === 1) finalAccusation.location = locationWinners[0];
    else ties.location = locationWinners;
    if (Object.keys(ties).length > 0) {
        gameState.phase = 'FINAL_ACCUSATION_TIEBREAK';
        gameState.finalAccusation = finalAccusation;
        const scout = players[gameState.scoutIndex];
        addToLog(roomCode, `There's a tie! The Scout, ${scout.name}, must decide.`);
        if(!room.disconnectedPlayers.has(scout.playerId)) {
            io.to(scout.socketId).emit('resolveTie', ties);
        }
    } else {
        checkForFinalWinner(roomCode, finalAccusation);
    }
}

function checkForFinalWinner(roomCode, finalAccusation) {
    const room = gameRooms.get(roomCode);
    if (!room) return;
    const { players, gameState } = room;
    const ringleader = players.find(p => p.isRingleader);
    const correctSuspect = ringleader.character.name;
    const correctWeapon = gameState.plot.weapon;
    const correctLocation = gameState.plot.location;
    addToLog(roomCode, `The final accusation is: ${finalAccusation.suspect}, in the ${finalAccusation.location}, with the ${finalAccusation.weapon}.`);
    if (finalAccusation.suspect === correctSuspect && finalAccusation.weapon === correctWeapon && finalAccusation.location === correctLocation) {
        endGame(roomCode, 'Friends', 'The final accusation was correct!');
    } else {
        endGame(roomCode, 'Conspiracy', 'The final accusation was incorrect!');
    }
}

io.on('connection', (socket) => {
    socket.on('hostCreateGame', () => {
        let roomCode = '';
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        for (let i = 0; i < 6; i++) {
            roomCode += characters.charAt(Math.floor(Math.random() * characters.length));
        }

        socket.join(roomCode);
        gameRooms.set(roomCode, { 
            hostId: socket.id, 
            players: [], 
            disconnectedPlayers: new Map(),
            availableCharacters: [...CHARACTERS],
            gameState: { 
                phase: 'LOBBY', 
                playerPositions: {}, health: 3, stormPosition: 0, 
                consecutiveFailedVotes: 0, finalVoteFails: 0, traps: {}, clues: {},
                publicClue: null, declarations: [], log: [], paused: false
            }
        });
        socket.emit('gameCreated', roomCode);
    });

    socket.on('playerJoinGame', (data) => {
        const { playerName, roomCode, playerId } = data;
        const room = gameRooms.get(roomCode);
        if (!room) return socket.emit('joinError', 'This room does not exist.');
        if (playerId && room.disconnectedPlayers.has(playerId)) {
            const player = room.players.find(p => p.playerId === playerId);
            if (player) {
                player.socketId = socket.id;
                room.disconnectedPlayers.delete(playerId);
                socket.join(roomCode);
                const payload = { playerId: player.playerId, playerName: player.name };
                socket.emit('joinSuccess', payload);
                io.to(roomCode).emit('lobbyUpdate', { players: room.players.map(p=>({name:p.name, character:p.character})), availableCharacters: room.availableCharacters });
                socket.emit('gameStartedPlayer');
                const rolePayload = { role: player.role, character: player.character, hand: player.hand };
                if (player.role.includes('Conspiracy')) {
                    rolePayload.plot = room.gameState.plot;
                    const conspiracyMembers = room.players.filter(p => p.role.includes('Conspiracy'));
                    rolePayload.conspiracyTeammates = conspiracyMembers.map(p => ({
                        name: p.name, characterName: p.character.name, role: p.role
                    }));
                }
                io.to(player.socketId).emit('yourRole', rolePayload);
                resyncPlayerState(roomCode, player);
                if (room.disconnectedPlayers.size === 0) {
                    room.gameState.paused = false;
                    io.to(roomCode).emit('gameResumed');
                    addToLog(roomCode, `Player ${player.name} has reconnected. Game resumed!`);
                }
                return;
            }
        }
        if (room.gameState.phase !== 'LOBBY' && room.gameState.phase !== 'GAME_OVER') {
            return socket.emit('joinError', 'Game has already started.');
        }
        const nameExists = room.players.some(p => p.name.toLowerCase() === playerName.toLowerCase());
        if (nameExists) {
            return socket.emit('joinError', 'A player with that name is already in the lobby.');
        }
        const newPlayerId = uuidv4();
        const newPlayer = { socketId: socket.id, playerId: newPlayerId, name: playerName, character: null };
        room.players.push(newPlayer);
        socket.join(roomCode);
        socket.emit('joinSuccess', { playerName: newPlayer.name, playerId: newPlayer.playerId });
        io.to(roomCode).emit('lobbyUpdate', { 
            players: room.players.map(p => ({name: p.name, character: p.character})), 
            availableCharacters: room.availableCharacters 
        });
    });

    socket.on('selectCharacter', ({ roomCode, characterName }) => {
        const room = gameRooms.get(roomCode);
        if (!room) return;
        const player = room.players.find(p => p.socketId === socket.id);
        const chosenChar = CHARACTERS.find(c => c.name === characterName);
        if (player && chosenChar && room.availableCharacters.some(c => c.name === characterName)) {
            if (player.character) {
                room.availableCharacters.push(player.character);
            }
            player.character = chosenChar;
            room.availableCharacters = room.availableCharacters.filter(c => c.name !== characterName);
            io.to(roomCode).emit('lobbyUpdate', { 
                players: room.players.map(p => ({ name: p.name, character: p.character })), 
                availableCharacters: room.availableCharacters 
            });
        }
    });

    socket.on('startGame', (roomCode) => {
        const room = gameRooms.get(roomCode);
        if (room && room.hostId === socket.id) {
            if (room.players.some(p => !p.character)) {
                return io.to(socket.id).emit('gameStartError', 'All players must select a character before starting.');
            }
            assignRolesAndCharacters(room.players);
            const supplyDeck = createSupplyDeck();
            const cardsPerPlayer = room.players.length >= 5 ? 3 : 4;
            room.players.forEach(p => { 
                p.hand = []; 
                for(let i=0; i<cardsPerPlayer; i++) if(supplyDeck.length > 0) p.hand.push(supplyDeck.pop());
            });
            room.gameState.supplyDeck = supplyDeck;
            const traps = createTrapTiles(room.players.length);
            const { plot, publicClue, locationClues, weaponClues } = setThePlot();
            room.gameState.plot = plot;
            room.gameState.publicClue = publicClue;
            BOARD_LAYOUT.filter(sq => sq.type === 'room').forEach((roomLocation, index) => {
                room.gameState.traps[roomLocation.name] = traps[index];
                room.gameState.clues[roomLocation.name] = { location: locationClues[index], weapon: weaponClues[index] };
            });
            room.players.forEach(p => { room.gameState.playerPositions[p.playerId] = STARTING_POSITION_INDEX; });
            room.gameState.scoutIndex = 0;
            room.gameState.phase = 'SCOUT_PHASE';
            io.to(room.hostId).emit('gameStarted', { 
                players: room.players,
                board: BOARD_LAYOUT, 
                traps: room.gameState.traps, 
                publicClue: room.gameState.publicClue,
                gameState: room.gameState
            });
            io.to(roomCode).emit('gameStartedPlayer');
            const conspiracyMembers = room.players.filter(p => p.role.includes('Conspiracy'));
            const conspiracyTeamInfo = conspiracyMembers.map(p => ({ name: p.name, characterName: p.character.name, role: p.role }));
            room.players.forEach(player => {
                const payload = { role: player.role, character: player.character, hand: player.hand };
                if (player.role.includes('Conspiracy')) {
                    payload.plot = room.gameState.plot;
                    payload.conspiracyTeammates = conspiracyTeamInfo;
                }
                io.to(player.socketId).emit('yourRole', payload);
            });
            addToLog(roomCode, `Game started with ${room.players.length} players.`);
            addToLog(roomCode, `Publicly Revealed Safe Location: ${publicClue}`);
            startScoutPhase(roomCode);
        }
    });
    
    socket.on('playAgain', (roomCode) => {
        const room = gameRooms.get(roomCode);
        if (room && room.hostId === socket.id) {
            room.gameState = { ...room.gameState, phase: 'LOBBY', playerPositions: {}, health: 3, stormPosition: 0, consecutiveFailedVotes: 0, finalVoteFails: 0, traps: {}, clues: {}, publicClue: null, declarations: [], log: [] };
            room.availableCharacters = [...CHARACTERS];
            room.players.forEach(p => { p.hand = []; p.role = null; p.character = null; p.isRingleader = false; p.hasVoted = false; p.finalClues = []; });
            io.to(roomCode).emit('returnToLobby');
            io.to(roomCode).emit('lobbyUpdate', { players: room.players.map(p=>({name:p.name, character:p.character})), availableCharacters: room.availableCharacters });
        }
    });

    socket.on('proposeTeam', (data) => {
        const { proposedTeam, proposedLocation, bodyguardId, roomCode } = data;
        const room = gameRooms.get(roomCode);
        if (!room) return;
        const scout = room.players[room.gameState.scoutIndex];
        room.gameState.proposal = { team: proposedTeam, location: proposedLocation, bodyguard: bodyguardId, votes: {}, votedCount: 0 };
        room.gameState.phase = 'VOTE_PHASE';
        room.players.forEach(p => p.hasVoted = false);
        room.gameState.proposal.votes[scout.socketId] = true;
        room.gameState.proposal.votedCount++;
        scout.hasVoted = true;
        const bodyguardPlayer = room.players.find(p => p.playerId === bodyguardId);
        const proposalData = { 
            scoutName: scout.name, 
            teamNames: proposedTeam.map(pId => room.players.find(p => p.playerId === pId)).filter(p => p).map(p => p.name), 
            locationName: proposedLocation, 
            bodyguardName: bodyguardPlayer ? bodyguardPlayer.name : "Unknown Player"
        };
        io.to(room.hostId).emit('showProposal', proposalData);
        io.to(room.hostId).emit('updateGameState', room.gameState);
        io.to(roomCode).emit('voteOnProposal', { ...proposalData, scoutId: scout.socketId });
        addToLog(roomCode, `${scout.name} proposed a team for ${proposedLocation}.`);
    });

    socket.on('proposeFinalTeam', (data) => {
        const { proposedTeam, roomCode } = data;
        const room = gameRooms.get(roomCode);
        if (!room || room.gameState.phase !== 'FINAL_ACCUSATION_TEAM_SELECT') return;
        const scout = room.players[room.gameState.scoutIndex];
        room.gameState.proposal = { team: proposedTeam, location: null, bodyguard: null, votes: {}, votedCount: 0 };
        room.players.forEach(p => p.hasVoted = false);
        room.gameState.proposal.votes[scout.socketId] = true;
        room.gameState.proposal.votedCount++;
        scout.hasVoted = true;
        const proposalData = {
            scoutName: scout.name,
            teamNames: proposedTeam.map(pId => room.players.find(p => p.playerId === pId)).filter(p => p).map(p => p.name),
            locationName: "the final clue deal",
            bodyguardName: "N/A"
        };
        io.to(room.hostId).emit('showProposal', proposalData);
        io.to(room.hostId).emit('updateGameState', room.gameState);
        io.to(roomCode).emit('voteOnProposal', { ...proposalData, scoutId: scout.socketId });
        addToLog(roomCode, `${scout.name} proposed the final team to receive clues.`);
    });

    socket.on('submitVote', (data) => {
        const { vote, roomCode } = data;
        const room = gameRooms.get(roomCode);
        if (!room || !room.gameState.proposal || room.gameState.proposal.votes[socket.id] !== undefined) return;
        room.gameState.proposal.votes[socket.id] = vote;
        room.gameState.proposal.votedCount++;
        const votingPlayer = room.players.find(p => p.socketId === socket.id);
        if (votingPlayer) votingPlayer.hasVoted = true;
        io.to(room.hostId).emit('updateGameState', room.gameState);
        const activePlayers = room.players.length - room.disconnectedPlayers.size;
        if (room.gameState.proposal.votedCount >= activePlayers) {
            processVoteResult(roomCode);
        }
    });

    socket.on('submitFinalVote', (data) => {
        const { roomCode, suspect, weapon, location } = data;
        const room = gameRooms.get(roomCode);
        if (!room || room.gameState.phase !== 'FINAL_ACCUSATION_VOTE') return;
        const player = room.players.find(p => p.socketId === socket.id);
        if (player && !player.hasVoted) {
            room.gameState.finalVotes[player.playerId] = { suspect, weapon, location };
            player.hasVoted = true;
            io.to(room.hostId).emit('updateGameState', room.gameState);
            const activePlayers = room.players.length - room.disconnectedPlayers.size;
            if (Object.keys(room.gameState.finalVotes).length >= activePlayers) {
                if(room.accusationTimer) clearTimeout(room.accusationTimer);
                tallyFinalVotes(roomCode);
            }
        }
    });

    socket.on('submitTieBreaker', (data) => {
        const { roomCode, choices } = data;
        const room = gameRooms.get(roomCode);
        if (!room || room.gameState.phase !== 'FINAL_ACCUSATION_TIEBREAK') return;
        const scout = room.players[room.gameState.scoutIndex];
        if (scout.socketId === socket.id) {
            let finalAccusation = { ...room.gameState.finalAccusation };
            finalAccusation = { ...finalAccusation, ...choices };
            checkForFinalWinner(roomCode, finalAccusation);
        }
    });
    
    socket.on('submitFinalDeclaration', (data) => {
        const { roomCode, declarations } = data;
        const room = gameRooms.get(roomCode);
        if (!room || room.gameState.phase !== 'FINAL_ACCUSATION_DECLARE') return;
        const player = room.players.find(p => p.socketId === socket.id);
        if (player) {
            declarations.forEach(d => {
                const newDeclaration = {
                    bodyguardName: player.name,
                    declaredLocation: d.type === 'Location' ? d.declaredValue : 'N/A',
                    declaredWeapon: d.type === 'Weapon' ? d.declaredValue : 'N/A',
                };
                room.gameState.declarations.push(newDeclaration);
            });
            io.to(room.hostId).emit('updateDeclaredClues', room.gameState.declarations);
            addToLog(roomCode, `${player.name} declared their final clues.`);
            room.gameState.finalDeclarationsReceived++;
            if (room.gameState.finalDeclarationsReceived >= room.gameState.finalDeclarationsNeeded) {
                startAccusationVote(roomCode);
            }
        }
    });

    socket.on('submitCardsForTrap', (data) => {
        const { cards, roomCode } = data;
        const room = gameRooms.get(roomCode);
        if (!room || room.gameState.phase !== 'DISARM_PHASE' || !room.gameState.proposal) return;
        if (!room.gameState.proposal.submittedCards) room.gameState.proposal.submittedCards = {};
        if (room.gameState.proposal.submittedCards[socket.id]) return;
        room.gameState.proposal.submittedCards[socket.id] = cards;
        const player = room.players.find(p => p.socketId === socket.id);
        cards.forEach(submittedCard => {
            const cardIndex = player.hand.findIndex(c => c.value === submittedCard.value && c.suit === submittedCard.suit);
            if (cardIndex > -1) player.hand.splice(cardIndex, 1);
        });
        io.to(player.socketId).emit('handUpdate', player.hand);
        const teamPlayers = room.players.filter(p => room.gameState.proposal.team.includes(p.playerId));
        const activeTeamPlayers = teamPlayers.filter(p => !room.disconnectedPlayers.has(p.playerId));
        if (Object.keys(room.gameState.proposal.submittedCards).length >= activeTeamPlayers.length) {
            resolveTrap(roomCode);
        }
    });

    socket.on('collectClues', (data) => {
        const { roomCode } = data;
        const room = gameRooms.get(roomCode);
        if (!room || !room.gameState.proposal) return;
        const { proposal, clues } = room.gameState;
        const revealedClues = clues[proposal.location];
        socket.emit('cluesRevealed', revealedClues);
    });

    socket.on('declareClues', (data) => {
        const { roomCode, declaredLocation, declaredWeapon } = data;
        const room = gameRooms.get(roomCode);
        if (!room) return;
        const bodyguard = room.players.find(p => p.socketId === socket.id);
        if (bodyguard) {
            const declaration = { bodyguardName: bodyguard.name, declaredLocation: declaredLocation, declaredWeapon: declaredWeapon };
            room.gameState.declarations.push(declaration);
            io.to(room.hostId).emit('updateDeclaredClues', room.gameState.declarations);
            addToLog(roomCode, `${bodyguard.name} declared they found: ${declaredLocation} & ${declaredWeapon}`);
        }
        startCardDistribution(roomCode);
    });

    socket.on('disconnect', (data) => {
        for (const [roomCode, room] of gameRooms.entries()) {
            const player = room.players.find(p => p.socketId === socket.id);
            if (player) {
                if (room.gameState.phase !== 'LOBBY' && room.gameState.phase !== 'GAME_OVER') {
                    console.log(`Player ${player.name} disconnected from room ${roomCode}`);
                    room.disconnectedPlayers.set(player.playerId, player.name);
                    room.gameState.paused = true;
                    io.to(roomCode).emit('gamePaused', `${player.name} has disconnected. The game is paused.`);
                    addToLog(roomCode, `Player ${player.name} has disconnected. Pausing game...`);
                } else {
                    room.players = room.players.filter(p => p.playerId !== player.playerId);
                    if (player.character) {
                        room.availableCharacters.push(player.character);
                    }
                    io.to(roomCode).emit('lobbyUpdate', { 
                        players: room.players.map(p => ({name: p.name, character: p.character})), 
                        availableCharacters: room.availableCharacters 
                    });
                }
                break;
            }
        }
    });
});

function processVoteResult(roomCode) {
    const room = gameRooms.get(roomCode);
    if (!room || !room.gameState.proposal) return;
    const { players, gameState } = room;
    const { proposal } = gameState;
    const activePlayers = players.length - room.disconnectedPlayers.size;
    const yesVotes = Object.values(proposal.votes).filter(v => v === true).length;
    const noVotes = activePlayers - yesVotes;
    const passed = yesVotes > noVotes;
    addToLog(roomCode, `Vote ${passed ? 'PASSED' : 'FAILED'} (${yesVotes} Yes, ${noVotes} No).`);
    io.to(roomCode).emit('voteResult', { passed, yesVotes, noVotes });
    players.forEach(p => p.hasVoted = false);
    if (gameState.phase === 'FINAL_ACCUSATION_TEAM_SELECT') {
        if (passed) {
            addToLog(roomCode, 'The final team has been chosen.');
            startFinalClueDeal(roomCode);
        } else {
            gameState.finalVoteFails++;
            addToLog(roomCode, `Final team vote failed. (${gameState.finalVoteFails}/3)`);
            if (gameState.finalVoteFails >= 3) {
                endGame(roomCode, 'Conspiracy', 'The final team vote failed three times.');
            } else {
                startFinalAccusationPhase(roomCode);
            }
        }
        return;
    }
    if (passed) {
        const { plot, health } = gameState;
        const bodyguard = players.find(p => p.playerId === proposal.bodyguard);
        if (proposal.location === plot.location && bodyguard && bodyguard.isRingleader && health <= 2) {
            endGame(roomCode, 'Conspiracy', 'The Ringleader executed the secret plot.');
            return;
        }
        gameState.stormPosition = 0;
        gameState.consecutiveFailedVotes = 0;
        
        const locationIndex = BOARD_LAYOUT.findIndex(l => l.name === proposal.location);
        const gatherSuppliesIndex = BOARD_LAYOUT.findIndex(l => l.type === 'supply');

        players.forEach(player => {
            if (proposal.team.includes(player.playerId)) {
                gameState.playerPositions[player.playerId] = locationIndex;
            } else {
                gameState.playerPositions[player.playerId] = gatherSuppliesIndex;
            }
        });
        
        io.to(room.hostId).emit('updateGameState', gameState);

        const trap = gameState.traps[proposal.location];
        if (trap.disarmed) {
            addToLog(roomCode, `Team visits the safe location at ${proposal.location}.`);
            setTimeout(() => startCardDistribution(roomCode), 2000);
        } else {
            gameState.phase = 'DISARM_PHASE';
            proposal.team.forEach(playerId => {
                const teamMember = players.find(p => p.playerId === playerId);
                if(teamMember && !room.disconnectedPlayers.has(teamMember.playerId)) io.to(teamMember.socketId).emit('disarmPhase', { trap });
            });
        }
    } else {
        gameState.stormPosition++;
        gameState.consecutiveFailedVotes++;
        if (gameState.consecutiveFailedVotes >= 3) {
            gameState.health--;
            gameState.consecutiveFailedVotes = 0;
            addToLog(roomCode, '3 consecutive failed votes! The team takes 1 damage. Storm Tracker reset.');
            if (gameState.health <= 0) {
                startFinalAccusationPhase(roomCode);
                return;
            }
        }
        gameState.scoutIndex = (gameState.scoutIndex + 1) % players.length;
        io.to(room.hostId).emit('updateGameState', gameState);
        setTimeout(() => startScoutPhase(roomCode), 4000);
    }
}

function resolveTrap(roomCode) {
    const room = gameRooms.get(roomCode);
    if (!room || !room.gameState.proposal) return;
    const { gameState, players } = room;
    const { proposal } = gameState;
    const trap = gameState.traps[proposal.location];
    const submittedCardsNested = Object.values(proposal.submittedCards);
    const submittedCardsFlat = submittedCardsNested.flat();
    let totalValue = 0;
    submittedCardsFlat.forEach(card => {
        if (card.value === 1) {
            totalValue += 1;
        } else if (trap.suit === 'both' || card.suit === trap.suit) {
            totalValue += 2;
        } else { // Card suit does not match trap suit
            totalValue -= 2;
        }
    });
    const success = totalValue >= trap.value;
    const shuffledPlayedCards = [...submittedCardsFlat].sort(() => Math.random() - 0.5);
    io.to(roomCode).emit('trapResult', { success, totalValue, trapValue: trap.value, playedCards: shuffledPlayedCards });
    if (success) {
        trap.disarmed = true;
        addToLog(roomCode, `Trap at ${proposal.location} DISARMED! (Value: ${totalValue} vs ${trap.value})`);
    } else {
        gameState.health--;
        addToLog(roomCode, `Trap at ${proposal.location} FAILED! ... Team health is now ${gameState.health}.`);
        io.to(room.hostId).emit('updateGameState', gameState);
        if (gameState.health <= 0) {
            startFinalAccusationPhase(roomCode);
            return;
        }
        trap.disarmed = true; 
        addToLog(roomCode, `Despite the failure, the trap at ${proposal.location} was cleared.`);
    }
    if (Object.values(gameState.traps).every(t => t.disarmed)) {
        endGame(roomCode, 'Friends', 'All traps were disarmed.');
        return; 
    }
    gameState.phase = 'CLUE_PHASE';
    const bodyguard = players.find(p => p.playerId === proposal.bodyguard);
    if (bodyguard) {
        io.to(bodyguard.socketId).emit('cluePhase', {
            locations: LOCATIONS, weapons: WEAPONS, publicClue: gameState.publicClue
        });
    }
}

function startCardDistribution(roomCode) {
    const room = gameRooms.get(roomCode);
    if (!room) return;
    const { players, gameState } = room;
    const { proposal, supplyDeck } = gameState;
    const missionTeamIds = proposal ? proposal.team : [];
    const maxHandSize = players.length >= 5 ? 3 : 4;
    
    // Movement logic has been moved to processVoteResult. This function now only deals cards.
    addToLog(roomCode, 'Non-mission players draw cards.');

    players.forEach(player => {
        if (!missionTeamIds.includes(player.playerId)) {
            while (player.hand.length < maxHandSize && supplyDeck.length > 0) {
                player.hand.push(supplyDeck.pop());
            }
            if(!room.disconnectedPlayers.has(player.playerId)) io.to(player.socketId).emit('handUpdate', player.hand);
        }
    });

    room.gameState.scoutIndex = (room.gameState.scoutIndex + 1) % players.length;
    // No need to send a gameState update here, as only hands changed, which are sent directly.
    setTimeout(() => startScoutPhase(roomCode), 4000);
}

function startScoutPhase(roomCode) {
    const room = gameRooms.get(roomCode);
    if (!room) return;
    const { players, gameState } = room;
    
    // Reset all player positions to Start at the beginning of the round
    players.forEach(player => {
        gameState.playerPositions[player.playerId] = STARTING_POSITION_INDEX;
    });

    gameState.phase = 'SCOUT_PHASE';
    const scout = players[gameState.scoutIndex];
    if (room.disconnectedPlayers.has(scout.playerId)) {
        room.gameState.scoutIndex = (room.gameState.scoutIndex + 1) % players.length;
        setTimeout(() => startScoutPhase(roomCode), 100);
        return;
    }
    const otherPlayers = players.filter(p => p.playerId !== scout.playerId);
    const eligibleTeammates = otherPlayers.filter(p => p.hand.length > 0 && !room.disconnectedPlayers.has(p.playerId));
    if (eligibleTeammates.length === 0) {
        addToLog(roomCode, `Scout ${scout.name} has no eligible teammates. The team is stuck!`);
        gameState.health--;
        addToLog(roomCode, `The team loses 1 health. Health is now ${gameState.health}.`);
        if (gameState.health <= 0) {
            startFinalAccusationPhase(roomCode);
            return;
        }
        const gatherSuppliesIndex = BOARD_LAYOUT.findIndex(l => l.type === 'supply');
        const maxHandSize = players.length >= 5 ? 3 : 4;
        players.forEach(player => {
            if (gatherSuppliesIndex !== -1) gameState.playerPositions[player.playerId] = gatherSuppliesIndex;
            while (player.hand.length < maxHandSize && gameState.supplyDeck.length > 0) player.hand.push(gameState.supplyDeck.pop());
            if(!room.disconnectedPlayers.has(player.playerId)) io.to(player.socketId).emit('handUpdate', player.hand);
        });
        addToLog(roomCode, 'All players move to Gather Supplies and draw cards.');
        gameState.scoutIndex = (room.gameState.scoutIndex + 1) % players.length;
        io.to(room.hostId).emit('updateGameState', gameState);
        setTimeout(() => startScoutPhase(roomCode), 4000);
        return; 
    }
    io.to(room.hostId).emit('updateGameState', gameState);
    if (scout) {
        addToLog(roomCode, `It is ${scout.name}'s turn to be the Scout.`);
        const { publicClue, traps } = gameState;
        let availableLocations = BOARD_LAYOUT.filter(s => s.type === 'room');
        if (publicClue && traps[publicClue] && traps[publicClue].disarmed) {
            availableLocations = availableLocations.filter(loc => loc.name !== publicClue);
        }
        const playersWithCardCount = players.map(p => ({
            playerId: p.playerId, name: p.name, character: p.character, cardCount: p.hand.length
        }));
        io.to(scout.socketId).emit('scoutPhase', { 
            players: playersWithCardCount, 
            locations: availableLocations, 
            roomCode: roomCode 
        });
    }
}

function createSupplyDeck() {
    const deck = [];
    for (let i = 0; i < 11; i++) deck.push({ value: 2, suit: 'yellow' });
    for (let i = 0; i < 11; i++) deck.push({ value: 2, suit: 'pink' });
    for (let i = 0; i < 6; i++) deck.push({ value: 1, suit: 'neutral' });
    deck.sort(() => Math.random() - 0.5);
    return deck;
}

function createTrapTiles(numPlayers) {
    let tiles = [];
    if (numPlayers >= 8) {
        // 8-10 players: each value is increased
        tiles = [
            { value: 10, suit: 'yellow', disarmed: false }, { value: 9, suit: 'pink', disarmed: false },
            { value: 8, suit: 'yellow', disarmed: false }, { value: 8, suit: 'pink', disarmed: false },
            { value: 9, suit: 'pink', disarmed: false }, { value: 8, suit: 'pink', disarmed: false },
            { value: 11, suit: 'both', disarmed: false }, { value: 8, suit: 'yellow', disarmed: false },
            { value: 9, suit: 'yellow', disarmed: false }
        ];
    } else {
        // 4-7 players
        tiles = [
            { value: 8, suit: 'yellow', disarmed: false }, { value: 7, suit: 'pink', disarmed: false },
            { value: 6, suit: 'yellow', disarmed: false }, { value: 6, suit: 'pink', disarmed: false },
            { value: 7, suit: 'pink', disarmed: false }, { value: 6, suit: 'pink', disarmed: false },
            { value: 9, suit: 'both', disarmed: false }, { value: 6, suit: 'yellow', disarmed: false },
            { value: 7, suit: 'yellow', disarmed: false }
        ];
    }
    return tiles.sort(() => Math.random() - 0.5);
}

function setThePlot() {
    const shuffledLocations = [...LOCATIONS].sort(() => 0.5 - Math.random());
    const plotLocation = shuffledLocations.pop();
    const publicClue = shuffledLocations.pop();
    let locationCluePool = [...shuffledLocations];
    locationCluePool.push("No Clue Found", "No Clue Found");
    locationCluePool.sort(() => 0.5 - Math.random());

    const shuffledWeapons = [...WEAPONS].sort(() => 0.5 - Math.random());
    const plotWeapon = shuffledWeapons.pop();
    let weaponCluePool = [...shuffledWeapons];
    weaponCluePool.push("No Clue Found", "No Clue Found");
    weaponCluePool.sort(() => 0.5 - Math.random());

    return { 
        plot: { weapon: plotWeapon, location: plotLocation }, 
        publicClue: publicClue,
        locationClues: locationCluePool, 
        weaponClues: weaponCluePool 
    };
}

function assignRolesAndCharacters(players) {
    const numPlayers = players.length;
    let roles = [];
    const roleDistribution = {
        3: { friends: 2, accomplices: 0, ringleader: 1 },
        4: { friends: 2, accomplices: 1, ringleader: 1 },
        5: { friends: 3, accomplices: 1, ringleader: 1 },
        6: { friends: 4, accomplices: 1, ringleader: 1 },
        7: { friends: 4, accomplices: 2, ringleader: 1 },
        8: { friends: 5, accomplices: 2, ringleader: 1 },
        9: { friends: 5, accomplices: 3, ringleader: 1 },
        10: { friends: 6, accomplices: 3, ringleader: 1 }
    };
    const counts = roleDistribution[numPlayers] || roleDistribution[5];
    for (let i = 0; i < counts.friends; i++) roles.push('Friend');
    for (let i = 0; i < counts.accomplices; i++) roles.push('Conspiracy Accomplice');
    if (counts.ringleader === 1) roles.push('Conspiracy Ringleader');
    roles.sort(() => 0.5 - Math.random());
    
    players.forEach((player, index) => {
        player.role = roles[index] || 'Friend';
        player.isRingleader = player.role === 'Conspiracy Ringleader';
    });
}

server.listen(port, () => { console.log(`Server is running at http://localhost:${port}`); });