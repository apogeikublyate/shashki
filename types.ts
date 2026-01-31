export enum PlayerColor {
  WHITE = 'WHITE',
  BLACK = 'BLACK'
}

export enum GameStatus {
  WAITING = 'WAITING',
  ACTIVE = 'ACTIVE',
  FINISHED = 'FINISHED',
  DRAW = 'DRAW'
}

export interface Position {
  row: number;
  col: number;
}

export interface Piece {
  color: PlayerColor;
  isKing: boolean;
}

// 8x8 Grid: null is empty
export type BoardState = (Piece | null)[][];

export interface Move {
  from: Position;
  to: Position;
  captures: Position[]; // Positions of captured pieces
  path: Position[]; // All intermediate landing spots (excluding 'from', including 'to')
  becomesKing: boolean;
}

export interface GameData {
  board: string; // JSON stringified BoardState for simpler Firestore storage
  turn: PlayerColor;
  players: {
    white: string | null; // playerId
    black: string | null; // playerId
  };
  status: GameStatus;
  winner: PlayerColor | null;
  version: number; // For optimistic locking
  lastMove?: {
    from: Position;
    to: Position;
    path?: Position[]; // Added for animations
    ts: number;
  };
  // Counter for 50-move rule (moves without capture or pawn move)
  halfMoveClock: number; 
  // ID of the new game if rematch was created
  rematchId?: string;
  createdAt: number;
  // Date when the game should be auto-deleted by Firestore TTL policies
  expireAt: number; 
  metadata?: {
    isRandomColor: boolean;
  };

  // --- Takeback / Undo Logic ---
  // Stores the state BEFORE the last move was made
  previousState?: {
    board: string;
    turn: PlayerColor;
    halfMoveClock: number;
    lastMove?: { from: Position; to: Position; path?: Position[]; ts: number };
  } | null;

  takebackRequest?: {
    requesterId: string;
    createdAt: number;
  } | null;
}

export interface PlayerIdentity {
  id: string;
  name: string; // Optional for MVP
}