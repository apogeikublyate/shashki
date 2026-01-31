import { BoardState, Move, PlayerColor } from '../types';
import { calculateAllowedMoves, applyMove } from '../rules/checkersRules';

// --- Configuration ---
const MAX_DEPTH = 3; 
// Reduced from 4 to 2 to prevent freezing on complex capture chains
const MAX_Q_DEPTH = 2; 
const INFINITY = 1000000;
const TIMEOUT_MS = 500; // Max execution time before forced return

// --- Heuristic Weights ---
const SCORES = {
    WIN: 100000,
    KING: 800,        
    PIECE: 100,       
    BACK_ROW: 40,     
    CENTER: 15,       
    MOBILITY: 2,      
    ADVANCE: 8,       
    DEFENSE: 10       
};

/**
 * Static evaluation of the board from the perspective of 'color'.
 */
const evaluateBoard = (board: BoardState, color: PlayerColor): number => {
    let score = 0;
    
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const p = board[r][c];
            if (!p) continue;

            let value = 0;
            
            // Material
            value += p.isKing ? SCORES.KING : SCORES.PIECE;

            // Positional: Center control (cols 2-5, rows 2-5)
            if (c >= 2 && c <= 5 && r >= 2 && r <= 5) value += SCORES.CENTER;
            
            // Advancement (for pawns)
            if (!p.isKing) {
                 if (p.color === PlayerColor.WHITE) {
                     value += (7 - r) * SCORES.ADVANCE;
                 } else {
                     value += r * SCORES.ADVANCE;
                 }
            }

            // Back Row Safety (Golden Piece)
            if (p.color === PlayerColor.WHITE && r === 7 && !p.isKing) value += SCORES.BACK_ROW;
            if (p.color === PlayerColor.BLACK && r === 0 && !p.isKing) value += SCORES.BACK_ROW;

            if (p.color === color) {
                score += value;
            } else {
                score -= value;
            }
        }
    }
    return score;
};

// Start time tracker
let searchStartTime = 0;

/**
 * Quiescence Search:
 * Extends the search beyond MAX_DEPTH specifically for "loud" positions (captures).
 */
const quiescence = (
    board: BoardState,
    alpha: number,
    beta: number,
    isMaximizing: boolean,
    botColor: PlayerColor,
    qDepth: number
): number => {
    // Timeout check
    if (Date.now() - searchStartTime > TIMEOUT_MS) {
        return evaluateBoard(board, botColor);
    }

    const turn = isMaximizing ? botColor : (botColor === PlayerColor.WHITE ? PlayerColor.BLACK : PlayerColor.WHITE);
    
    const allMoves = calculateAllowedMoves(board, turn);
    const isCaptureAvailable = allMoves.length > 0 && allMoves[0].captures.length > 0;

    if (!isCaptureAvailable || qDepth === 0) {
        return evaluateBoard(board, botColor);
    }
    
    if (isMaximizing) {
        let maxEval = -INFINITY;
        // Sorting captures by number of pieces taken (greedy heuristic)
        allMoves.sort((a, b) => b.captures.length - a.captures.length);

        for (const move of allMoves) {
            const nextBoard = applyMove(board, move);
            const evalScore = quiescence(nextBoard, alpha, beta, false, botColor, qDepth - 1);
            maxEval = Math.max(maxEval, evalScore);
            alpha = Math.max(alpha, evalScore);
            if (beta <= alpha) break;
        }
        return maxEval;
    } else {
        let minEval = INFINITY;
        allMoves.sort((a, b) => b.captures.length - a.captures.length);

        for (const move of allMoves) {
            const nextBoard = applyMove(board, move);
            const evalScore = quiescence(nextBoard, alpha, beta, true, botColor, qDepth - 1);
            minEval = Math.min(minEval, evalScore);
            beta = Math.min(beta, evalScore);
            if (beta <= alpha) break;
        }
        return minEval;
    }
};

/**
 * Minimax with Alpha-Beta Pruning + Quiescence Search
 */
const minimax = (
    board: BoardState, 
    depth: number, 
    alpha: number, 
    beta: number, 
    isMaximizing: boolean,
    botColor: PlayerColor
): number => {
    // Check timeout
    if (Date.now() - searchStartTime > TIMEOUT_MS) {
        return evaluateBoard(board, botColor);
    }

    // 1. Base case: Depth reached -> Enter Quiescence Search
    if (depth === 0) {
        return quiescence(board, alpha, beta, isMaximizing, botColor, MAX_Q_DEPTH);
    }

    const turn = isMaximizing ? botColor : (botColor === PlayerColor.WHITE ? PlayerColor.BLACK : PlayerColor.WHITE);
    const validMoves = calculateAllowedMoves(board, turn);

    // 2. Base case: Game Over (No moves)
    if (validMoves.length === 0) {
        // Return negative infinity (adjusted by depth to prefer faster wins / slower losses)
        return isMaximizing ? -SCORES.WIN + depth : SCORES.WIN - depth;
    }

    // 3. Recursive Step
    if (isMaximizing) {
        let maxEval = -INFINITY;
        // Optimization: Captures first
        validMoves.sort((a, b) => b.captures.length - a.captures.length);

        for (const move of validMoves) {
            const nextBoard = applyMove(board, move);
            const evalScore = minimax(nextBoard, depth - 1, alpha, beta, false, botColor);
            maxEval = Math.max(maxEval, evalScore);
            alpha = Math.max(alpha, evalScore);
            if (beta <= alpha) break; 
        }
        return maxEval;
    } else {
        let minEval = INFINITY;
        validMoves.sort((a, b) => b.captures.length - a.captures.length);

        for (const move of validMoves) {
            const nextBoard = applyMove(board, move);
            const evalScore = minimax(nextBoard, depth - 1, alpha, beta, true, botColor);
            minEval = Math.min(minEval, evalScore);
            beta = Math.min(beta, evalScore);
            if (beta <= alpha) break; 
        }
        return minEval;
    }
};

export const getSmartBotMove = (board: BoardState, botColor: PlayerColor): Move | null => {
    const validMoves = calculateAllowedMoves(board, botColor);
    if (validMoves.length === 0) return null;
    
    // Forced capture check optimization
    if (validMoves.length === 1) return validMoves[0];

    searchStartTime = Date.now();
    let bestMove: Move | null = null;
    let bestValue = -INFINITY;

    // Root Move Ordering: Randomize equal captures, but prioritize captures over simple moves
    validMoves.sort(() => Math.random() - 0.5); 
    validMoves.sort((a, b) => b.captures.length - a.captures.length);

    for (const move of validMoves) {
        // Break early if timeout happened in previous iteration
        if (Date.now() - searchStartTime > TIMEOUT_MS) break;

        const nextBoard = applyMove(board, move);
        // Next is minimizing player (human)
        const moveValue = minimax(nextBoard, MAX_DEPTH - 1, -INFINITY, INFINITY, false, botColor);
        
        if (moveValue > bestValue) {
            bestValue = moveValue;
            bestMove = move;
        }
    }

    return bestMove || validMoves[0];
};