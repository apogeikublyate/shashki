import firebase from 'firebase/compat/app';
import { db } from './firebase';
import { GameData, GameStatus, PlayerColor, Move, BoardState, PlayerIdentity } from '../types';
import { initializeBoard, applyMove } from '../rules/checkersRules';

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

export const createGame = async (playerId: string, preferredColor: PlayerColor, isRandomColor: boolean = false): Promise<string> => {
  const gameId = generateId();
  const initialBoard = initializeBoard();
  
  // TTL: 24 hours from now
  const oneDayMs = 24 * 60 * 60 * 1000;
  const expireDate = new Date(Date.now() + oneDayMs); // Firestore needs Date object or timestamp

  const gameData: GameData = {
    board: JSON.stringify(initialBoard),
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
    expireAt: expireDate.getTime(), // Storing as timestamp number for consistency
    metadata: {
      isRandomColor: isRandomColor
    }
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

  await db.runTransaction(async (transaction) => {
    const freshDoc = await transaction.get(gameRef);
    if (!freshDoc.exists) throw new Error("Game missing");
    
    const freshData = freshDoc.data() as GameData;
    if (freshData.version !== gameData.version) {
      throw new Error("Game state has changed, reload recommended");
    }

    // Logic for Draw (50 moves without capture or pawn move = 25 turns each)
    // We count half-moves. 50 half-moves = 25 full turns.
    let newHalfMoveClock = freshData.halfMoveClock + 1;
    if (isPawnMove || isCapture) {
      newHalfMoveClock = 0;
    }

    let status = freshData.status;
    // Auto-Draw condition (e.g., 60 half-moves to be safe, standard is usually 50 for chess, variable for checkers)
    if (newHalfMoveClock >= 60) {
        status = GameStatus.DRAW;
    }

    // Update expiration on move so active games don't die
    const oneDayMs = 24 * 60 * 60 * 1000;
    const newExpireAt = Date.now() + oneDayMs;

    transaction.update(gameRef, {
      board: JSON.stringify(newBoard),
      turn: nextTurn,
      lastMove: { from: move.from, to: move.to, ts: Date.now() },
      halfMoveClock: newHalfMoveClock,
      status: status,
      version: freshData.version + 1,
      expireAt: newExpireAt
    });
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
    // Correct usage: call update on the DocumentReference, not on the 'db' instance.
    // Use firebase.firestore.FieldValue for static values like increment.
    await gameRef.update({
        status: GameStatus.FINISHED,
        winner: winner,
        version: firebase.firestore.FieldValue.increment(1)
    } as any);
};

export const proposeRematch = async (oldGameId: string, myPlayerId: string, myOldColor: PlayerColor, isRandom: boolean) => {
    // Create new game with SWAPPED colors for fairness
    const newColor = myOldColor === PlayerColor.WHITE ? PlayerColor.BLACK : PlayerColor.WHITE;
    
    // We pass the isRandom flag. If true, the GameLobby will hide the colors until start.
    const newGameId = await createGame(myPlayerId, newColor, isRandom);
    
    // Link old game to new game
    await db.collection('games').doc(oldGameId).update({
        rematchId: newGameId
    });
    
    return newGameId;
};