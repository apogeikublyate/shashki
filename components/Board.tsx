import React, { useRef, useState, useEffect } from 'react';
import { BoardState, Move, PlayerColor, Position } from '../types';

interface BoardProps {
  board: BoardState;
  validMoves: Move[];
  selectedPos: Position | null;
  onSquareClick: (pos: Position) => void;
  onMovePiece: (from: Position, to: Position) => void;
  lastMove?: { from: Position; to: Position };
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
  
  // Drag State
  const [dragState, setDragState] = useState<{
    isDragging: boolean;
    startPos: Position | null;
    currentX: number;
    currentY: number;
  }>({
    isDragging: false,
    startPos: null,
    currentX: 0,
    currentY: 0
  });

  const [previewMove, setPreviewMove] = useState<Move | null>(null);

  // Helper to get logic coordinates from pixel coordinates
  const getSquareFromCoords = (clientX: number, clientY: number): Position | null => {
    if (!gridRef.current) return null;
    const rect = gridRef.current.getBoundingClientRect();
    
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    // Boundary check
    if (x < 0 || x > rect.width || y < 0 || y > rect.height) return null;

    const rawCol = Math.floor((x / rect.width) * 8);
    const rawRow = Math.floor((y / rect.height) * 8);

    const c = Math.max(0, Math.min(7, rawCol));
    const r = Math.max(0, Math.min(7, rawRow));

    if (rotated) {
      return { row: 7 - r, col: 7 - c };
    }
    return { row: r, col: c };
  };

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (!dragState.isDragging) return;
      e.preventDefault();
      
      const newX = e.clientX - prevClientX.current;
      const newY = e.clientY - prevClientY.current;

      setDragState(prev => ({
        ...prev,
        currentX: newX,
        currentY: newY
      }));

      // Preview logic for highlighting path
      const hoverPos = getSquareFromCoords(e.clientX, e.clientY);
      
      if (hoverPos && dragState.startPos) {
        const matchingMove = validMoves.find(
          m => m.from.row === dragState.startPos!.row && 
               m.from.col === dragState.startPos!.col &&
               m.to.row === hoverPos.row && 
               m.to.col === hoverPos.col
        );
        setPreviewMove(matchingMove || null);
      } else {
        setPreviewMove(null);
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!dragState.isDragging || !dragState.startPos) return;
      
      const dropPos = getSquareFromCoords(e.clientX, e.clientY);
      const dist = Math.sqrt(dragState.currentX**2 + dragState.currentY**2);
      
      let moved = false;

      if (dropPos) {
        if (dropPos.row !== dragState.startPos.row || dropPos.col !== dragState.startPos.col) {
           const move = validMoves.find(
             m => m.from.row === dragState.startPos!.row && 
                  m.from.col === dragState.startPos!.col &&
                  m.to.row === dropPos.row && 
                  m.to.col === dropPos.col
           );
           
           if (move) {
             onMovePiece(dragState.startPos, dropPos);
             moved = true;
           }
        }
      }

      if (!moved) {
          if (dist < 5 || (dropPos && dropPos.row === dragState.startPos.row && dropPos.col === dragState.startPos.col)) {
             onSquareClick(dragState.startPos);
          }
      }

      setDragState({
        isDragging: false,
        startPos: null,
        currentX: 0,
        currentY: 0
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
  }, [dragState.isDragging, onMovePiece, onSquareClick, dragState.startPos, validMoves]);

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
      currentY: 0
    });
  };

  const handleSquarePointerEnter = (r: number, c: number) => {
      if (!dragState.isDragging && selectedPos) {
          const move = validMoves.find(
              m => m.from.row === selectedPos.row && m.from.col === selectedPos.col &&
                   m.to.row === r && m.to.col === c
          );
          setPreviewMove(move || null);
      }
  };

  const handleSquarePointerLeave = () => {
      if (!dragState.isDragging) {
          setPreviewMove(null);
      }
  };

  const getVisualPos = (r: number, c: number) => {
    if (rotated) {
      return { top: `${(7 - r) * 12.5}%`, left: `${(7 - c) * 12.5}%` };
    }
    return { top: `${r * 12.5}%`, left: `${c * 12.5}%` };
  };

  const isSquareDark = (r: number, c: number) => (r + c) % 2 === 1;

  const renderSquares = () => {
    const squares = [];
    
    // Determine active context for showing hints
    const activeRow = dragState.isDragging && dragState.startPos ? dragState.startPos.row : selectedPos?.row;
    const activeCol = dragState.isDragging && dragState.startPos ? dragState.startPos.col : selectedPos?.col;
    const activePiece = (activeRow !== undefined && activeCol !== undefined) ? board[activeRow][activeCol] : null;

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const isDark = isSquareDark(r, c);
        const isSelected = selectedPos?.row === r && selectedPos?.col === c;
        const isLastMoveSource = lastMove?.from.row === r && lastMove?.from.col === c;
        const isLastMoveDest = lastMove?.to.row === r && lastMove?.to.col === c;
        
        let isPathStep = false;
        let isFinalDest = false;
        let willBecomeKing = false;
        
        if (activePiece) {
             const relevantMoves = validMoves.filter(
                 m => m.from.row === activeRow && m.from.col === activeCol
             );

             for (const move of relevantMoves) {
                 if (move.to.row === r && move.to.col === c) {
                     isFinalDest = true;
                     // Show promotion hint if this move results in a King AND the piece wasn't already one
                     if (move.becomesKing && !activePiece.isKing) {
                         willBecomeKing = true;
                     }
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

        squares.push(
          <div 
            key={`sq-${r}-${c}`}
            data-pos={`${r}-${c}`} 
            className={`absolute w-[12.5%] h-[12.5%] box-border ${bgClass} ${highlightClass} ${selectClass} flex items-center justify-center`}
            style={style}
            onPointerEnter={() => handleSquarePointerEnter(r, c)}
            onPointerLeave={handleSquarePointerLeave}
            onClick={() => {
                if (!dragState.isDragging && selectedPos) {
                    onSquareClick({ row: r, col: c });
                }
            }}
          >
             {(rotated ? r === 0 : r === 7) && c === 0 && (
               <span className="absolute bottom-0.5 left-1 text-[10px] font-bold opacity-50 text-[#3d2b1f] pointer-events-none">A</span>
             )}
             
             {isPathStep && !isFinalDest && (
                <div className="w-3 h-3 rounded-full bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.8)] pointer-events-none"></div>
             )}

             {/* Destination Marker */}
             {isFinalDest && (
               <>
                 {!willBecomeKing ? (
                   // Standard green dot
                   <div className={`rounded-full shadow-lg pointer-events-none transition-all duration-200
                      ${previewMove && previewMove.to.row === r && previewMove.to.col === c 
                          ? 'w-7 h-7 bg-green-400 shadow-[0_0_15px_rgba(74,222,128,1)]' 
                          : 'w-5 h-5 bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]' 
                       }
                   `}></div>
                 ) : (
                   // GHOST KING - Rendered if we become a king here
                   <div className="absolute w-[85%] h-[85%] flex items-center justify-center opacity-60 animate-pulse pointer-events-none">
                      {(() => {
                        const isWhite = activePiece?.color === PlayerColor.WHITE;
                        const baseColor = isWhite 
                            ? 'bg-gradient-to-br from-[#f0e4cc] via-[#e6dcc0] to-[#d6c4a8]' 
                            : 'bg-gradient-to-br from-[#383838] via-[#242424] to-[#121212]';
                        const ringBorder = isWhite ? 'border-[#bcaaa4]' : 'border-gray-700';

                        return (
                          <div className={`w-full h-full rounded-full ${baseColor} flex items-center justify-center relative shadow-xl border-[1px] ${isWhite ? 'border-[#f5f0e1]' : 'border-[#444]'}`}>
                             <div className={`w-[75%] h-[75%] rounded-full border-[3px] opacity-40 ${ringBorder} absolute`}></div>
                             <svg viewBox="0 0 24 24" className="w-[65%] h-[65%] drop-shadow-md z-10" fill={isWhite ? "url(#goldGradient)" : "url(#goldGradient)"}>
                                <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z"/>
                            </svg>
                          </div>
                        );
                      })()}
                   </div>
                 )}
               </>
             )}
          </div>
        );
      }
    }
    return squares;
  };

  const renderPieces = () => {
    const pieces = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (!piece) continue;

        const isWhite = piece.color === PlayerColor.WHITE;
        const style = getVisualPos(r, c);
        
        const isDraggingThis = dragState.isDragging && dragState.startPos?.row === r && dragState.startPos?.col === c;
        const isSelectedThis = selectedPos?.row === r && selectedPos?.col === c;

        // Visual Promotion Logic:
        // If this piece is being dragged OR selected, AND the current preview move leads to a King,
        // render it as a King immediately to show the outcome.
        const isActive = isDraggingThis || isSelectedThis;
        const showAsKing = piece.isKing || (isActive && previewMove?.becomesKing);

        const baseColor = isWhite 
          ? 'bg-gradient-to-br from-[#f0e4cc] via-[#e6dcc0] to-[#d6c4a8]' 
          : 'bg-gradient-to-br from-[#383838] via-[#242424] to-[#121212]';
        
        const ringBorder = isWhite ? 'border-[#bcaaa4]' : 'border-gray-700';
        const shadow = 'shadow-[0_4px_8px_rgba(0,0,0,0.5),_0_8px_16px_rgba(0,0,0,0.3)]';

        const transformStyle = isDraggingThis ? {
             transform: `translate(${dragState.currentX}px, ${dragState.currentY}px)`,
             zIndex: 50,
             cursor: 'grabbing',
             pointerEvents: 'none' as const 
        } : {
             zIndex: 10,
             cursor: 'grab',
             touchAction: 'none'
        };

        const animationClass = isDraggingThis ? 'scale-110 shadow-2xl' : 'transition-transform duration-100 ease-out hover:scale-105';

        pieces.push(
          <div
            key={`p-${r}-${c}`}
            className={`absolute w-[12.5%] h-[12.5%] flex items-center justify-center will-change-transform`}
            style={{ ...style, ...transformStyle }}
            onPointerDown={(e) => handlePiecePointerDown(e, r, c)}
            onPointerEnter={() => handleSquarePointerEnter(r, c)}
          >
            <div className={`
              w-[85%] h-[85%] rounded-full ${baseColor} ${shadow}
              flex items-center justify-center relative
              border-[1px] ${isWhite ? 'border-[#f5f0e1]' : 'border-[#444]'}
              ${animationClass}
            `}>
              {/* Inner Groove */}
              <div className={`w-[75%] h-[75%] rounded-full border-[3px] opacity-20 ${ringBorder} shadow-inner absolute`}></div>
              
              {/* King Icon (Crown) */}
              {showAsKing && (
                <div className="absolute inset-0 flex items-center justify-center animate-fade-in">
                    {/* Glow for new kings */}
                    {!piece.isKing && (
                        <div className="absolute w-full h-full rounded-full bg-yellow-400/20 animate-pulse"></div>
                    )}
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
      }
    }
    return pieces;
  };

  return (
    <div 
      className="relative w-full h-full shadow-[0_20px_50px_rgba(0,0,0,0.7)] border-[16px] border-[#3e2723] rounded-md bg-[#3e2723] select-none"
      style={{ touchAction: 'none' }} 
    >
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