import React, { useRef, useState, useEffect, useMemo } from 'react';
import { BoardState, Move, PlayerColor, Position, Piece } from '../types';

interface BoardProps {
  board: BoardState;
  validMoves: Move[];
  selectedPos: Position | null;
  onSquareClick: (pos: Position) => void;
  onMovePiece: (from: Position, to: Position) => void;
  lastMove?: { from: Position; to: Position; path?: Position[] };
  rotated?: boolean;
}

const Board: React.FC<BoardProps> = ({ 
  board, 
  validMoves, 
  selectedPos, 
  onSquareClick,
  onMovePiece,
  lastMove,
  rotated = false
}) => {
  const gridRef = useRef<HTMLDivElement>(null);
  const prevBoardRef = useRef<BoardState>(board);
  
  // Optimization: Pre-calculate move lookups
  const { movesStartMap } = useMemo(() => {
    const startMap = new Map<string, Move[]>();
    validMoves.forEach(m => {
        const startKey = `${m.from.row}-${m.from.col}`;
        if (!startMap.has(startKey)) startMap.set(startKey, []);
        startMap.get(startKey)!.push(m);
    });
    return { movesStartMap: startMap };
  }, [validMoves]);

  // Drag State
  const [dragState, setDragState] = useState<{
    isDragging: boolean;
    startPos: Position | null;
    currentX: number;
    currentY: number;
    hasMoved: boolean; 
  }>({
    isDragging: false,
    startPos: null,
    currentX: 0,
    currentY: 0,
    hasMoved: false
  });

  const [previewMove, setPreviewMove] = useState<Move | null>(null);

  // --- Animation State ---
  const [animatingPiece, setAnimatingPiece] = useState<{
    piece: Piece;
    currentPathIndex: number;
    fullPath: Position[];
    style: React.CSSProperties;
  } | null>(null);

  const prevLastMoveRef = useRef(lastMove);

  // --- Fading Captured Pieces State ---
  const [fadingPieces, setFadingPieces] = useState<{ piece: Piece, r: number, c: number }[]>([]);

  // Detect Board Changes & Trigger Animations / Fading
  useEffect(() => {
    // 1. Detect New Move (Jumping Piece Animation)
    if (lastMove && lastMove !== prevLastMoveRef.current) {
        const isDifferent = !prevLastMoveRef.current || 
           (lastMove.from.row !== prevLastMoveRef.current.from.row || lastMove.from.col !== prevLastMoveRef.current.from.col ||
            lastMove.to.row !== prevLastMoveRef.current.to.row || lastMove.to.col !== prevLastMoveRef.current.to.col);
        
        if (isDifferent) {
            const pieceAtDest = board[lastMove.to.row][lastMove.to.col];
            
            if (pieceAtDest) {
                const path = lastMove.path ? [...lastMove.path] : [lastMove.to];
                const lastPoint = path[path.length - 1];
                if (lastPoint.row !== lastMove.to.row || lastPoint.col !== lastMove.to.col) {
                    path.push(lastMove.to);
                }

                const fullPath = [lastMove.from, ...path];

                setAnimatingPiece({
                    piece: pieceAtDest,
                    currentPathIndex: 0,
                    fullPath: fullPath,
                    style: getVisualPos(lastMove.from.row, lastMove.from.col)
                });
            }
        }
    }
    prevLastMoveRef.current = lastMove;

    // 2. Detect Captured Pieces (Fading Animation)
    const newFading: { piece: Piece, r: number, c: number }[] = [];
    if (lastMove) {
        for(let r=0; r<8; r++) {
            for(let c=0; c<8; c++) {
                const pPrev = prevBoardRef.current[r][c];
                const pCurr = board[r][c];
                
                if (pPrev && !pCurr && (r !== lastMove.from.row || c !== lastMove.from.col)) {
                    newFading.push({ piece: pPrev, r, c });
                }
            }
        }
    }

    if (newFading.length > 0) {
        setFadingPieces(prev => [...prev, ...newFading]);
        setTimeout(() => {
            setFadingPieces(prev => prev.filter(p => !newFading.includes(p)));
        }, 600);
    }

    prevBoardRef.current = board;

  }, [lastMove, board]);

  // Animation Loop for Moving Piece
  useEffect(() => {
    if (!animatingPiece) return;

    const isMultiStep = animatingPiece.fullPath.length > 2;
    const isLastStep = animatingPiece.currentPathIndex === animatingPiece.fullPath.length - 2;

    const BASE_DURATION = 350;
    const FAST_DURATION = 220; 

    const stepDuration = (isMultiStep && !isLastStep) ? FAST_DURATION : BASE_DURATION;
    const ease = (isMultiStep && !isLastStep) ? 'linear' : 'cubic-bezier(0.25, 1, 0.5, 1)';

    if (animatingPiece.currentPathIndex < animatingPiece.fullPath.length - 1) {
        const nextIndex = animatingPiece.currentPathIndex + 1;
        const nextPos = animatingPiece.fullPath[nextIndex];
        const delay = animatingPiece.currentPathIndex === 0 ? 50 : stepDuration;

        const timer = setTimeout(() => {
             setAnimatingPiece(prev => {
                 if (!prev) return null;
                 return {
                     ...prev,
                     currentPathIndex: nextIndex,
                     style: {
                         ...getVisualPos(nextPos.row, nextPos.col),
                         transition: `top ${stepDuration}ms ${ease}, left ${stepDuration}ms ${ease}`
                     }
                 };
             });
        }, delay); 

        return () => clearTimeout(timer);
    } else {
        const timer = setTimeout(() => {
            setAnimatingPiece(null);
        }, stepDuration); 
        return () => clearTimeout(timer);
    }
  }, [animatingPiece?.currentPathIndex]);

  const getSquareFromCoords = (clientX: number, clientY: number): Position | null => {
    if (!gridRef.current) return null;
    const rect = gridRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < 0 || x > rect.width || y < 0 || y > rect.height) return null;
    const rawCol = Math.floor((x / rect.width) * 8);
    const rawRow = Math.floor((y / rect.height) * 8);
    const c = Math.max(0, Math.min(7, rawCol));
    const r = Math.max(0, Math.min(7, rawRow));
    if (rotated) return { row: 7 - r, col: 7 - c };
    return { row: r, col: c };
  };

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (!dragState.isDragging) return;
      e.preventDefault();
      
      const newX = e.clientX - prevClientX.current;
      const newY = e.clientY - prevClientY.current;

      const hasMoved = dragState.hasMoved || (Math.abs(newX) > 5 || Math.abs(newY) > 5);

      setDragState(prev => ({
        ...prev,
        currentX: newX,
        currentY: newY,
        hasMoved
      }));

      const hoverPos = getSquareFromCoords(e.clientX, e.clientY);
      if (hoverPos && dragState.startPos) {
        const key = `${dragState.startPos.row}-${dragState.startPos.col}`;
        const possibleMoves = movesStartMap.get(key);
        
        const matchingMove = possibleMoves?.find(
             m => m.to.row === hoverPos.row && m.to.col === hoverPos.col
        );
        
        setPreviewMove(matchingMove || null);
      } else {
        setPreviewMove(null);
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!dragState.isDragging || !dragState.startPos) return;
      
      const dropPos = getSquareFromCoords(e.clientX, e.clientY);
      let wasDragMove = false;

      if (dropPos) {
         if (dragState.hasMoved && (dropPos.row !== dragState.startPos.row || dropPos.col !== dragState.startPos.col)) {
             const key = `${dragState.startPos.row}-${dragState.startPos.col}`;
             const possibleMoves = movesStartMap.get(key);
             const move = possibleMoves?.find(
                  m => m.to.row === dropPos.row && m.to.col === dropPos.col
             );
             
             if (move) {
               onMovePiece(dragState.startPos, dropPos);
               wasDragMove = true;
             }
         }
      }

      if (!wasDragMove) {
          onSquareClick(dragState.startPos);
      }
      
      setDragState({
        isDragging: false,
        startPos: null,
        currentX: 0,
        currentY: 0,
        hasMoved: false
      });
      setPreviewMove(null);
    };

    if (dragState.isDragging) {
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    }

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [dragState, onMovePiece, movesStartMap, onSquareClick]);

  const prevClientX = useRef(0);
  const prevClientY = useRef(0);

  const handlePiecePointerDown = (e: React.PointerEvent, r: number, c: number) => {
    if (e.button !== 0) return; 
    e.preventDefault();
    e.stopPropagation(); 
    
    prevClientX.current = e.clientX;
    prevClientY.current = e.clientY;

    setDragState({
      isDragging: true,
      startPos: { row: r, col: c },
      currentX: 0,
      currentY: 0,
      hasMoved: false
    });
  };

  const handleSquarePointerEnter = (r: number, c: number) => {
      if (!dragState.isDragging && selectedPos) {
          const key = `${selectedPos.row}-${selectedPos.col}`;
          const possibleMoves = movesStartMap.get(key);
          const move = possibleMoves?.find(m => m.to.row === r && m.to.col === c);
          setPreviewMove(move || null);
      }
  };

  const handleSquarePointerLeave = () => {
      if (!dragState.isDragging) {
          setPreviewMove(null);
      }
  };

  const handlePieceClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const getVisualPos = (r: number, c: number) => {
    if (rotated) {
      return { top: `${(7 - r) * 12.5}%`, left: `${(7 - c) * 12.5}%` };
    }
    return { top: `${r * 12.5}%`, left: `${c * 12.5}%` };
  };

  const isSquareDark = (r: number, c: number) => (r + c) % 2 === 1;

  const renderPiece = (piece: Piece, r: number, c: number, isGhost: boolean = false, customStyle?: React.CSSProperties, extraClasses: string = '') => {
        const isWhite = piece.color === PlayerColor.WHITE;
        const style = customStyle || getVisualPos(r, c);
        
        const isDraggingThis = !isGhost && dragState.isDragging && dragState.startPos?.row === r && dragState.startPos?.col === c;

        const isHiddenByAnimation = !isGhost && animatingPiece && animatingPiece.piece === piece && r === lastMove?.to.row && c === lastMove?.to.col;
        if (isHiddenByAnimation) return null;

        const showAsKing = piece.isKing;

        const baseColor = isWhite 
          ? 'bg-gradient-to-br from-[#f0e4cc] via-[#e6dcc0] to-[#d6c4a8]' 
          : 'bg-gradient-to-br from-[#383838] via-[#242424] to-[#121212]';
        
        const ringBorder = isWhite ? 'border-[#bcaaa4]' : 'border-gray-700';
        const shadow = 'shadow-[0_4px_8px_rgba(0,0,0,0.5),_0_8px_16px_rgba(0,0,0,0.3)]';

        const transformStyle = isDraggingThis ? {
             transform: `translate(${dragState.currentX}px, ${dragState.currentY}px)`,
             zIndex: 50,
             cursor: 'grabbing',
             pointerEvents: 'none' as React.CSSProperties['pointerEvents']
        } : {
             zIndex: isGhost ? 20 : 30, 
             cursor: isGhost ? 'default' : 'pointer',
             touchAction: 'none',
             pointerEvents: (isGhost ? 'none' : 'auto') as React.CSSProperties['pointerEvents']
        };

        const animationClass = isDraggingThis ? 'scale-110 shadow-2xl' : (isGhost ? 'scale-100' : 'transition-transform duration-100 ease-out hover:scale-105');

        return (
          <div
            key={`p-${r}-${c}${isGhost ? '-ghost' : ''}`}
            className={`absolute w-[12.5%] h-[12.5%] flex items-center justify-center will-change-transform ${extraClasses}`}
            style={{ ...style, ...transformStyle }}
            onPointerDown={!isGhost ? (e) => handlePiecePointerDown(e, r, c) : undefined}
            onClick={!isGhost ? handlePieceClick : undefined}
            onPointerEnter={!isGhost ? () => handleSquarePointerEnter(r, c) : undefined}
            onPointerLeave={!isGhost ? handleSquarePointerLeave : undefined}
          >
            <div className={`
              w-[85%] h-[85%] rounded-full ${baseColor} ${shadow}
              flex items-center justify-center relative
              border-[1px] ${isWhite ? 'border-[#f5f0e1]' : 'border-[#444]'}
              ${animationClass}
            `}>
              <div className={`w-[75%] h-[75%] rounded-full border-[3px] opacity-20 ${ringBorder} shadow-inner absolute`}></div>
              {showAsKing && (
                <div className="absolute inset-0 flex items-center justify-center animate-fade-in">
                    <svg viewBox="0 0 24 24" className="w-[60%] h-[60%] drop-shadow-md" fill={isWhite ? "url(#goldGradient)" : "url(#goldGradient)"}>
                        <defs>
                            <linearGradient id="goldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" stopColor="#FFD700" />
                                <stop offset="50%" stopColor="#FDB931" />
                                <stop offset="100%" stopColor="#DAA520" />
                            </linearGradient>
                        </defs>
                        <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z"/>
                    </svg>
                </div>
              )}
            </div>
          </div>
        );
  };

  const renderSquares = () => {
    const squares = [];
    const ghosts = [];
    
    let activeRow: number | undefined;
    let activeCol: number | undefined;

    if (dragState.isDragging && dragState.startPos) {
        activeRow = dragState.startPos.row;
        activeCol = dragState.startPos.col;
    } else if (selectedPos) {
        activeRow = selectedPos.row;
        activeCol = selectedPos.col;
    }

    const activePiece = (activeRow !== undefined && activeCol !== undefined) ? board[activeRow][activeCol] : null;

    const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const numbers = ['8', '7', '6', '5', '4', '3', '2', '1'];

    let activeMoves: Move[] = [];
    if (activeRow !== undefined && activeCol !== undefined) {
         const key = `${activeRow}-${activeCol}`;
         const moves = movesStartMap.get(key);
         if (moves) activeMoves = moves;
    }

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const isDark = isSquareDark(r, c);
        const isSelected = selectedPos?.row === r && selectedPos?.col === c;
        const isLastMoveSource = lastMove?.from.row === r && lastMove?.from.col === c;
        const isLastMoveDest = lastMove?.to.row === r && lastMove?.to.col === c;
        
        let isPathStep = false;
        let isFinalDest = false;
        let willBecomeKing = false;
        let currentMove: Move | undefined;
        
        if (activeMoves.length > 0) {
             for (const move of activeMoves) {
                 if (move.to.row === r && move.to.col === c) {
                     isFinalDest = true;
                     currentMove = move;
                     if (move.becomesKing && activePiece && !activePiece.isKing) willBecomeKing = true;
                 }
                 else if (move.path.some(p => p.row === r && p.col === c)) {
                     isPathStep = true;
                 }
             }
        }

        let bgClass = isDark ? 'bg-[#8B5A2B]' : 'bg-[#E3C193]'; 
        const highlightClass = (isLastMoveSource || isLastMoveDest) ? 'bg-yellow-500/40' : '';
        const selectClass = isSelected ? 'bg-[#5e4b35]/60 ring-inset ring-4 ring-[#ffff00]/50' : '';
        
        const style = getVisualPos(r, c);
        
        // Correct visual positioning logic:
        // Numbers always on the LEFT side of the visual container.
        // Letters always on the BOTTOM side of the visual container.
        
        const showNumber = rotated ? c === 7 : c === 0; 
        const showLetter = rotated ? r === 0 : r === 7;
        
        const textColor = isDark ? 'text-[#E3C193]' : 'text-[#8B5A2B]';

        if (isFinalDest && activePiece && currentMove) {
             const isHoveredDest = previewMove?.to.row === r && previewMove?.to.col === c;
             let ghostOpacity = !previewMove ? 0.35 : (isHoveredDest ? 0.7 : 0.2);
             const ghostPiece = { ...activePiece, isKing: willBecomeKing ? true : activePiece.isKing };
             ghosts.push(renderPiece(ghostPiece, r, c, true, { ...style, opacity: ghostOpacity }));
        }

        squares.push(
          <div 
            key={`sq-${r}-${c}`}
            data-pos={`${r}-${c}`} 
            className={`absolute w-[12.5%] h-[12.5%] box-border ${bgClass} ${highlightClass} ${selectClass} flex items-center justify-center`}
            style={style}
            onClick={() => onSquareClick({ row: r, col: c })}
            onPointerEnter={() => handleSquarePointerEnter(r, c)}
            onPointerLeave={handleSquarePointerLeave}
          >
             {showNumber && (
                 <span 
                    className={`absolute top-1 left-1 text-[10px] lg:text-xs font-bold ${textColor} select-none pointer-events-none z-20 opacity-90`}
                 >
                     {numbers[r]}
                 </span>
             )}
             {showLetter && (
                 <span 
                    className={`absolute bottom-0.5 right-1 text-[10px] lg:text-xs font-bold ${textColor} select-none pointer-events-none z-20 opacity-90`}
                 >
                     {letters[c]}
                 </span>
             )}
             {isPathStep && !isFinalDest && (
                <div className="w-3 h-3 rounded-full bg-stone-900/30 shadow-inner pointer-events-none z-10"></div>
             )}
          </div>
        );
      }
    }
    return [...squares, ...ghosts];
  };

  const renderPieces = () => {
    const pieces = [];
    
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (!piece) continue;
        pieces.push(renderPiece(piece, r, c));
      }
    }

    fadingPieces.forEach((fp) => {
        pieces.push(renderPiece(fp.piece, fp.r, fp.c, true, undefined, 'animate-fadeOut opacity-0'));
    });

    if (animatingPiece) {
        pieces.push(renderPiece(animatingPiece.piece, 0, 0, true, { ...animatingPiece.style, zIndex: 100, opacity: 1 }));
    }
    return pieces;
  };

  return (
    <div 
      className="relative w-full h-full shadow-[0_20px_50px_rgba(0,0,0,0.7)] border-[12px] md:border-[16px] lg:border-[20px] border-[#3e2723] rounded-md bg-[#3e2723] select-none"
      style={{ touchAction: 'none' }} 
    >
      <style>{`
        @keyframes fadeOut {
          0% { opacity: 1; transform: scale(1); }
          50% { opacity: 1; transform: scale(0.9); }
          100% { opacity: 0; transform: scale(0.5); }
        }
        .animate-fadeOut {
          animation: fadeOut 0.6s forwards;
        }
      `}</style>
      <div 
        ref={gridRef}
        className="w-full h-full relative overflow-hidden bg-[#E3C193]"
      >
        {renderSquares()}
        {renderPieces()}
      </div>
    </div>
  );
};

export default Board;