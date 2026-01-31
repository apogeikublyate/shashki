import { BoardState, Move, Piece, PlayerColor, Position } from '../types';

export const BOARD_SIZE = 8;

export const initializeBoard = (): BoardState => {
  const board: BoardState = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
  
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if ((row + col) % 2 === 1) { // Dark squares only
        if (row < 3) {
          board[row][col] = { color: PlayerColor.BLACK, isKing: false };
        } else if (row > 4) {
          board[row][col] = { color: PlayerColor.WHITE, isKing: false };
        }
      }
    }
  }
  return board;
};

// Inlined logic for performance in hot paths
// const isValidPos = (r: number, c: number) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;

// Deep copy needed because we simulate moves during recursion
const cloneBoard = (board: BoardState): BoardState => board.map(row => row.map(p => p ? { ...p } : null));

/**
 * Calculates all valid moves for a specific player on the given board.
 */
export const calculateAllowedMoves = (board: BoardState, turn: PlayerColor): Move[] => {
  let allMoves: Move[] = [];
  let hasCaptures = false;

  // 1. Iterate over all pieces of the current player to find ALL possible moves
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = board[r][c];
      if (!piece || piece.color !== turn) continue;

      const pos = { row: r, col: c };
      
      // Get all capture chains for this piece
      const captures = getCaptureMoves(board, pos, piece, [], [], [], pos);
      
      // Get simple moves
      const simple = getSimpleMoves(board, pos, piece);

      if (captures.length > 0) {
        hasCaptures = true;
        allMoves.push(...captures);
      } else {
        allMoves.push(...simple);
      }
    }
  }

  // 2. Filter: If ANY capture exists anywhere on the board, only return capture moves.
  if (hasCaptures) {
    return allMoves.filter(m => m.captures.length > 0);
  }

  return allMoves;
};

const getSimpleMoves = (board: BoardState, from: Position, piece: Piece): Move[] => {
  const moves: Move[] = [];
  const directions = piece.isKing 
    ? [[-1, -1], [-1, 1], [1, -1], [1, 1]]
    : piece.color === PlayerColor.WHITE ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];

  for (const [dr, dc] of directions) {
    let r = from.row + dr;
    let c = from.col + dc;

    if (piece.isKing) {
      // Flying king: can move any distance
      while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
        if (board[r][c] !== null) break; // Blocked
        moves.push({
          from,
          to: { row: r, col: c },
          captures: [],
          path: [{ row: r, col: c }],
          becomesKing: false // King is already king
        });
        r += dr;
        c += dc;
      }
    } else {
      // Simple piece
      if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === null) {
        const isPromotion = (piece.color === PlayerColor.WHITE && r === 0) || 
                            (piece.color === PlayerColor.BLACK && r === 7);
        moves.push({
          from,
          to: { row: r, col: c },
          captures: [],
          path: [{ row: r, col: c }],
          becomesKing: isPromotion
        });
      }
    }
  }
  return moves;
};

// Recursive function to find capture chains
const getCaptureMoves = (
  board: BoardState, 
  currentPos: Position, 
  piece: Piece, 
  currentCaptures: Position[],
  capturedInPath: Position[],
  currentPath: Position[], // Path of landing spots so far
  originalStart: Position // Needed to treat the start square as empty during loops
): Move[] => {
  const moves: Move[] = [];
  const directions = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

  for (const [dr, dc] of directions) {
    if (piece.isKing) {
      // King Capture Logic (Flying)
      let r = currentPos.row + dr;
      let c = currentPos.col + dc;
      
      // Scan along diagonal
      while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
        const cell = board[r][c];
        
        // If we hit a piece...
        if (cell) {
          // Check if it's an enemy and NOT already captured in this sequence
          const isEnemy = cell.color !== piece.color;
          const alreadyCaptured = capturedInPath.some(p => p.row === r && p.col === c);
          
          // Cannot jump own pieces. Cannot jump same enemy twice.
          if (!isEnemy || alreadyCaptured) {
             break; // Path blocked
          }

          // Found valid enemy to capture. Now check landing spots AFTER the enemy.
          let landR = r + dr;
          let landC = c + dc;
          
          while (landR >= 0 && landR < BOARD_SIZE && landC >= 0 && landC < BOARD_SIZE) {
            const destCell = board[landR][landC];
            // We can land if cell is empty OR if it is the starting square (looping back)
            const isStart = landR === originalStart.row && landC === originalStart.col;
            
            if (destCell !== null && !isStart) break; // Blocked by another piece immediately

            // VALID CAPTURE FOUND
            const newCaptures = [...currentCaptures, { row: r, col: c }];
            const newCapturedInPath = [...capturedInPath, { row: r, col: c }];
            const newPath = [...currentPath, { row: landR, col: landC }];
            
            // Recurse from landing spot
            const subsequentMoves = getCaptureMoves(
              board, 
              { row: landR, col: landC }, 
              piece, 
              newCaptures, 
              newCapturedInPath,
              newPath,
              originalStart
            );

            if (subsequentMoves.length > 0) {
              moves.push(...subsequentMoves);
            } else {
              // End of chain
              moves.push({
                from: originalStart, // Always reference the absolute start
                to: { row: landR, col: landC },
                captures: newCaptures,
                path: newPath,
                becomesKing: true
              });
            }
            
            landR += dr;
            landC += dc;
          }
          break; // Can't jump more than one piece in a row on the same line without landing
        }
        r += dr;
        c += dc;
      }

    } else {
      // Simple Piece Capture Logic
      const captureR = currentPos.row + dr;
      const captureC = currentPos.col + dc;
      const landR = currentPos.row + 2 * dr;
      const landC = currentPos.col + 2 * dc;

      if (landR >= 0 && landR < BOARD_SIZE && landC >= 0 && landC < BOARD_SIZE) {
        const midPiece = board[captureR][captureC];
        const destCell = board[landR][landC];
        
        const isEnemy = midPiece && midPiece.color !== piece.color;
        const alreadyCaptured = capturedInPath.some(p => p.row === captureR && p.col === captureC);
        // Valid landing: Empty square OR the square we started the whole move from
        const isStart = landR === originalStart.row && landC === originalStart.col;
        const isOpen = destCell === null || isStart;

        if (isEnemy && !alreadyCaptured && isOpen) {
          const newCaptures = [...currentCaptures, { row: captureR, col: captureC }];
          const newCapturedInPath = [...capturedInPath, { row: captureR, col: captureC }];
          const newPath = [...currentPath, { row: landR, col: landC }];

          // Promotion check during capture (Russian Checkers: become king mid-move)
          const reachedPromotionRow = (piece.color === PlayerColor.WHITE && landR === 0) || 
                                      (piece.color === PlayerColor.BLACK && landR === 7);
          
          let nextPieceState = { ...piece };
          if (reachedPromotionRow) {
            nextPieceState.isKing = true;
          }

          // Recurse
          const subsequentMoves = getCaptureMoves(
            board,
            { row: landR, col: landC },
            nextPieceState,
            newCaptures,
            newCapturedInPath,
            newPath,
            originalStart
          );

          if (subsequentMoves.length > 0) {
            moves.push(...subsequentMoves);
          } else {
            moves.push({
              from: originalStart,
              to: { row: landR, col: landC },
              captures: newCaptures,
              path: newPath,
              becomesKing: reachedPromotionRow || piece.isKing
            });
          }
        }
      }
    }
  }

  return moves;
};

export const applyMove = (board: BoardState, move: Move): BoardState => {
  const newBoard = cloneBoard(board);
  const p = newBoard[move.from.row][move.from.col];
  
  if (!p) return newBoard;

  // Move piece
  newBoard[move.from.row][move.from.col] = null;
  newBoard[move.to.row][move.to.col] = {
    color: p.color,
    isKing: p.isKing || move.becomesKing
  };

  // Remove captured pieces (Russian Checkers: removed at end of move)
  move.captures.forEach(c => {
    newBoard[c.row][c.col] = null;
  });

  return newBoard;
};