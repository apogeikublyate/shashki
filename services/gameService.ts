import firebase from 'firebase/compat/app';
import { db } from './firebase';
import { GameData, GameStatus, PlayerColor, Move, BoardState, PlayerIdentity } from '../types';
import { initializeBoard, applyMove, calculateAllowedMoves } from '../rules/checkersRules';

const generateId = () => Math.random().toString(36).substring(2, 9);

export const getPlayerIdentity = (): PlayerIdentity => {
  let stored = localStorage.getItem('checkers_player_id');
  if (!stored) {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      stored = crypto.randomUUID();
    } else {
      stored = Math.random().toString(36).substring(2) + Date.now().toString(36);
    }
    localStorage.setItem('checkers_player_id', stored);
  }
  return { id: stored, name: `Player ${stored.substring(0, 4)}` };
};

export const createGame = async (
    playerId: string, 
    preferredColor: PlayerColor, 
    isRandomColor: boolean = false,
    initialBoard?: BoardState
): Promise<string> => {
  const gameId = generateId();
  const board = initialBoard || initializeBoard();
  
  // TTL: 24 hours from now
  const oneDayMs = 24 * 60 * 60 * 1000;
  const expireDate = new Date(Date.now() + oneDayMs); // Firestore needs Date object or timestamp

  const gameData: GameData = {
    board: JSON.stringify(board),
    turn: PlayerColor.WHITE,
    players: {
      white: preferredColor === PlayerColor.WHITE ? playerId : null,
      black: preferredColor === PlayerColor.BLACK ? playerId : null
    },
    status: GameStatus.WAITING,
    winner: null,
    version: 0,
    halfMoveClock: 0,
    createdAt: Date.now(),
    expireAt: expireDate.getTime(),
    metadata: {
      isRandomColor: isRandomColor
    },
    previousState: null,
    takebackRequest: null
  };

  await db.collection('games').doc(gameId).set(gameData);
  return gameId;
};

export const joinGame = async (gameId: string, playerId: string): Promise<void> => {
  const gameRef = db.collection('games').doc(gameId);
  
  await db.runTransaction(async (transaction) => {
    const gameDoc = await transaction.get(gameRef);
    if (!gameDoc.exists) throw new Error("Game not found");
    
    const data = gameDoc.data() as GameData;
    
    // Check if player is already in the game
    if (data.players.white === playerId || data.players.black === playerId) return;

    // Join strictly to the empty slot
    if (data.players.black === null && data.players.white !== null) {
      transaction.update(gameRef, {
        'players.black': playerId,
        status: GameStatus.ACTIVE,
        version: data.version + 1
      });
    } else if (data.players.white === null && data.players.black !== null) {
       transaction.update(gameRef, {
        'players.white': playerId,
        status: GameStatus.ACTIVE,
        version: data.version + 1
      });
    } else {
      throw new Error("Game is full");
    }
  });
};

export const subscribeToGame = (gameId: string, callback: (data: GameData) => void) => {
  return db.collection('games').doc(gameId).onSnapshot((docSnap) => {
    if (docSnap.exists) {
      callback(docSnap.data() as GameData);
    }
  });
};

export const performMove = async (
  gameId: string, 
  gameData: GameData, 
  move: Move, 
  nextTurn: PlayerColor
) => {
  const gameRef = db.collection('games').doc(gameId);
  const currentBoard: BoardState = JSON.parse(gameData.board);
  
  // Need to check if it's a pawn move to reset draw counter
  const movingPiece = currentBoard[move.from.row][move.from.col];
  const isPawnMove = movingPiece && !movingPiece.isKing;
  const isCapture = move.captures.length > 0;

  const newBoard = applyMove(currentBoard, move);

  // --- IMMEDIATE WIN/DRAW DETECTION ---
  let status = gameData.status;
  let winner = null;

  // 1. Check if next player has any moves
  const nextPlayerMoves = calculateAllowedMoves(newBoard, nextTurn);
  if (nextPlayerMoves.length === 0) {
      status = GameStatus.FINISHED;
      // The player who made the move (current gameData.turn) is the winner
      winner = gameData.turn; 
  }

  // 2. Check for 1v1 King Draw
  // Count pieces
  let whiteCount = 0, blackCount = 0;
  let whiteKings = 0, blackKings = 0;
  
  for(let r=0; r<8; r++) {
      for(let c=0; c<8; c++) {
          const p = newBoard[r][c];
          if(p) {
              if(p.color === PlayerColor.WHITE) { whiteCount++; if(p.isKing) whiteKings++; }
              else { blackCount++; if(p.isKing) blackKings++; }
          }
      }
  }

  if (status !== GameStatus.FINISHED && whiteCount === 1 && whiteKings === 1 && blackCount === 1 && blackKings === 1) {
      status = GameStatus.DRAW;
  }
  
  // --- END DETECTION ---

  await db.runTransaction(async (transaction) => {
    const freshDoc = await transaction.get(gameRef);
    if (!freshDoc.exists) throw new Error("Game missing");
    
    const freshData = freshDoc.data() as GameData;
    if (freshData.version !== gameData.version) {
      throw new Error("Game state has changed, reload recommended");
    }

    // Logic for Draw (50 moves without capture or pawn move = 25 turns each)
    let newHalfMoveClock = freshData.halfMoveClock + 1;
    if (isPawnMove || isCapture) {
      newHalfMoveClock = 0;
    }

    // Only apply 50-move rule if game isn't already finished by logic above
    if (status !== GameStatus.FINISHED && status !== GameStatus.DRAW) {
         if (newHalfMoveClock >= 60) {
            status = GameStatus.DRAW;
        }
    }

    const oneDayMs = 24 * 60 * 60 * 1000;
    const newExpireAt = Date.now() + oneDayMs;

    // Construct Previous State (Snapshot of what it is NOW before update)
    const previousState = {
        board: freshData.board,
        turn: freshData.turn,
        halfMoveClock: freshData.halfMoveClock,
        lastMove: freshData.lastMove || null
    };

    transaction.update(gameRef, {
      board: JSON.stringify(newBoard),
      turn: nextTurn,
      lastMove: { 
        from: move.from, 
        to: move.to, 
        path: move.path, // Save path for animation
        ts: Date.now() 
      },
      halfMoveClock: newHalfMoveClock,
      status: status,
      winner: winner,
      version: freshData.version + 1,
      expireAt: newExpireAt,
      // Save history and clear any pending requests since a move was made
      previousState: previousState,
      takebackRequest: null 
    });
  });
};

// --- TAKEBACK LOGIC ---

export const requestTakeback = async (gameId: string, playerId: string) => {
    await db.collection('games').doc(gameId).update({
        takebackRequest: {
            requesterId: playerId,
            createdAt: Date.now()
        }
    });
};

export const resolveTakeback = async (gameId: string, accepted: boolean) => {
    const gameRef = db.collection('games').doc(gameId);
    
    await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(gameRef);
        if (!doc.exists) return;
        const data = doc.data() as GameData;
        
        if (!accepted) {
            // Just clear the request
            transaction.update(gameRef, { takebackRequest: null });
            return;
        }

        // If accepted, we must have a previous state to revert to
        if (data.previousState) {
            transaction.update(gameRef, {
                board: data.previousState.board,
                turn: data.previousState.turn,
                halfMoveClock: data.previousState.halfMoveClock,
                lastMove: data.previousState.lastMove || firebase.firestore.FieldValue.delete(),
                // Clear history (cannot undo twice in a row for simplicity, or keep it if we wanted multi-undo)
                // For MVP, we clear previousState to prevent loops unless we stored a deeper stack.
                previousState: null, 
                takebackRequest: null,
                version: data.version + 1
            });
        } else {
             // Fallback if state missing
             transaction.update(gameRef, { takebackRequest: null });
        }
    });
};

export const resignGame = async (gameId: string, playerId: string) => {
    const gameRef = db.collection('games').doc(gameId);
    await db.runTransaction(async (transaction) => {
      const docSnap = await transaction.get(gameRef);
      if(!docSnap.exists) return;
      const data = docSnap.data() as GameData;
      
      let winner: PlayerColor | null = null;
      if (data.players.white === playerId) winner = PlayerColor.BLACK;
      if (data.players.black === playerId) winner = PlayerColor.WHITE;
      
      if(winner) {
          transaction.update(gameRef, {
              status: GameStatus.FINISHED,
              winner: winner,
              version: data.version + 1
          });
      }
    });
};

export const declareWinner = async (gameId: string, winner: PlayerColor) => {
    const gameRef = db.collection('games').doc(gameId);
    await gameRef.update({
        status: GameStatus.FINISHED,
        winner: winner,
        version: firebase.firestore.FieldValue.increment(1)
    } as any);
};

export const proposeRematch = async (oldGameId: string, myPlayerId: string, myOldColor: PlayerColor, isRandom: boolean) => {
    const gameRef = db.collection('games').doc(oldGameId);
    
    // Use transaction to prevent race condition where both players create a new game
    return await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(gameRef);
        if (!doc.exists) throw new Error("Game not found");
        
        const data = doc.data() as GameData;
        
        // If rematchId already exists, it means the opponent created it. Return it!
        if (data.rematchId) {
            return data.rematchId;
        }

        // Otherwise, create a new game
        const newColor = myOldColor === PlayerColor.WHITE ? PlayerColor.BLACK : PlayerColor.WHITE;
        const newGameId = await createGame(myPlayerId, newColor, isRandom);
        
        // Update the old game with the link
        transaction.update(gameRef, {
            rematchId: newGameId
        });
        
        return newGameId;
    });
};