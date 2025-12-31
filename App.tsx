import React, { useEffect, useState, useMemo, useRef } from 'react';
import { GameData, PlayerColor, Position, GameStatus } from './types';
import { createGame, joinGame, subscribeToGame, performMove, getPlayerIdentity, resignGame, declareWinner, proposeRematch } from './services/gameService';
import { calculateAllowedMoves, applyMove, initializeBoard } from './rules/checkersRules';
import { getSmartBotMove } from './ai/bot';
import { isConfigured } from './services/firebase';
import Board from './components/Board';
import GameLobby from './components/GameLobby';
import JoinGameScreen from './components/JoinGameScreen';
import { Toaster, toast } from 'react-hot-toast';

type ColorSelection = PlayerColor | 'RANDOM';

const App: React.FC = () => {
  // Game State
  const [gameId, setGameId] = useState<string | null>(null);
  const [gameData, setGameData] = useState<GameData | null>(null);
  const [isLocalGame, setIsLocalGame] = useState(false);
  const [isSpectator, setIsSpectator] = useState(false);
  
  // UI State
  const [selectedPos, setSelectedPos] = useState<Position | null>(null);
  const [playerId] = useState<string>(() => getPlayerIdentity().id);
  const [loading, setLoading] = useState(false);
  const [rematchLoading, setRematchLoading] = useState(false);
  const [selectedColorMode, setSelectedColorMode] = useState<ColorSelection>(PlayerColor.WHITE);
  
  // Track if we initiated the rematch to show correct button state
  const [iProposedRematch, setIProposedRematch] = useState(false);

  // Ref to track if we are performing an optimistic update to prevent jitter
  const pendingMoveRef = useRef(false);

  // --- 1. Navigation & State Synchronization ---
  
  const safePushState = (url: string) => {
    try {
      window.history.pushState({}, '', url);
    } catch (err) {
      console.warn("URL update failed:", err);
    }
  };

  // Handle Browser Back/Forward buttons
  useEffect(() => {
    const handleUrlChange = () => {
      const params = new URLSearchParams(window.location.search);
      const id = params.get('game');
      
      // Only react if the ID actually changed from what we have
      if (id !== gameId) {
          if (id) {
            setGameId(id);
            // Reset game data to force reload/check
            setGameData(null); 
          } else {
            // Returned to menu
            setGameId(null);
            setGameData(null);
            setIsLocalGame(false);
          }
      }
    };
    
    window.addEventListener('popstate', handleUrlChange);
    return () => window.removeEventListener('popstate', handleUrlChange);
  }, [gameId]);

  // Initial Load from URL
  useEffect(() => {
     const params = new URLSearchParams(window.location.search);
     const id = params.get('game');
     if (id && !gameId) {
         setGameId(id);
     }
  }, []); 

  // --- 2. Game Connection Logic ---

  // NOTE: We REMOVED the auto-join useEffect.
  // Instead, we just subscribe to data. Joining is now an explicit user action
  // unless we are the creator (which is checked via playerId).

  // Subscription Side Effect
  useEffect(() => {
    if (!gameId || gameId === "local_bot") return;

    const unsubscribe = subscribeToGame(gameId, (data) => {
      // If we made a move optimistically, ignore "stale" updates from server 
      // until server catches up to our version
      if (pendingMoveRef.current) {
        if (data.version > (gameData?.version || 0)) {
           pendingMoveRef.current = false;
           setGameData(data);
        }
      } else {
        setGameData(data);
      }
    });
    return () => unsubscribe();
  }, [gameId, gameData?.version]);

  // --- 3. Actions ---

  // Explicit Join Action (triggered from JoinGameScreen)
  const handleJoinGame = async () => {
    if (!gameId) return;
    setLoading(true);
    try {
        await joinGame(gameId, playerId);
        setIsSpectator(false);
        toast.success("Вы присоединились к игре!");
    } catch (err: any) {
        if (err.message === "Game is full") {
            setIsSpectator(true);
            toast("Комната заполнена. Вы присоединились как зритель.", { icon: '👀' });
        } else {
            toast.error("Ошибка подключения");
        }
    } finally {
        setLoading(false);
    }
  };

  const createOptimisticGameData = (myColor: PlayerColor, isRandom: boolean): GameData => {
      const initialBoard = initializeBoard();
      const oneDayMs = 24 * 60 * 60 * 1000;
      return {
          board: JSON.stringify(initialBoard),
          turn: PlayerColor.WHITE,
          players: {
              white: myColor === PlayerColor.WHITE ? playerId : null,
              black: myColor === PlayerColor.BLACK ? playerId : null,
          },
          status: GameStatus.WAITING,
          winner: null,
          version: 0,
          halfMoveClock: 0,
          createdAt: Date.now(),
          expireAt: Date.now() + oneDayMs,
          metadata: {
              isRandomColor: isRandom
          }
      };
  };

  const switchToNewGame = (newId: string, initialData?: GameData) => {
      setIProposedRematch(false);
      setRematchLoading(false);
      setSelectedPos(null);
      setIsLocalGame(false);
      setIsSpectator(false);
      if (initialData) setGameData(initialData);
      else setGameData(null);
      setGameId(newId);
      safePushState(`${window.location.pathname}?game=${newId}`);
  };

  const handleStartBotGame = () => {
    const initialBoard = initializeBoard();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const newData: GameData = {
      board: JSON.stringify(initialBoard),
      turn: PlayerColor.WHITE,
      players: { white: 'local', black: 'bot' },
      status: GameStatus.ACTIVE,
      winner: null,
      version: 0,
      halfMoveClock: 0,
      createdAt: Date.now(),
      expireAt: Date.now() + oneDayMs
    };
    
    setGameData(newData);
    setIsLocalGame(true);
    setGameId("local_bot");
    setIProposedRematch(false);
    safePushState(window.location.pathname); 
  };

  const handleCreateGame = async () => {
    if (!isConfigured) return;
    setLoading(true);
    try {
      const isRandom = selectedColorMode === 'RANDOM';
      // If random, decide the actual internal color now, but pass isRandom flag to hide it
      const finalColor: PlayerColor = isRandom 
        ? (Math.random() < 0.5 ? PlayerColor.WHITE : PlayerColor.BLACK) 
        : selectedColorMode;
      
      const id = await createGame(playerId, finalColor, isRandom);
      
      const optimisticData = createOptimisticGameData(finalColor, isRandom);
      switchToNewGame(id, optimisticData);
      
      toast.success("Игра создана!");
    } catch (e: any) {
      console.error(e);
      toast.error("Ошибка создания игры.");
    } finally {
      setLoading(false);
    }
  };

  const handleRematch = async () => {
    // Prevent double clicking or race conditions
    if (rematchLoading) return;
    setRematchLoading(true);

    if (gameData?.rematchId) {
        // --- JOIN EXISTING REMATCH ---
        // If the game already exists, we just switch to it.
        // We know the rematchId from Firestore updates.
        switchToNewGame(gameData.rematchId, undefined);
    } else {
        // --- PROPOSE NEW REMATCH ---
        try {
            const newColor = myColor === PlayerColor.WHITE ? PlayerColor.BLACK : PlayerColor.WHITE;
            const isRandom = !!gameData?.metadata?.isRandomColor;
            
            setIProposedRematch(true); // Disable button locally immediately
            
            const newGameId = await proposeRematch(gameId!, playerId, myColor!, isRandom);
            const optimisticData = createOptimisticGameData(newColor, isRandom);
            
            switchToNewGame(newGameId, optimisticData);
            toast.success("Реванш создан!");
        } catch (e) {
            console.error(e);
            toast.error("Не удалось создать реванш");
            setRematchLoading(false);
            setIProposedRematch(false);
        }
    }
  };

  const handleReturnToMenu = () => {
    safePushState(window.location.pathname);
    setGameId(null);
    setGameData(null);
    setIsLocalGame(false);
    setIsSpectator(false);
    setIProposedRematch(false);
    setRematchLoading(false);
  };

  // --- 4. Game Logic (Derived State & Effects) ---

  const board = useMemo(() => {
    if (!gameData || !gameData.board) return [];
    try { return JSON.parse(gameData.board); } catch (e) { return []; }
  }, [gameData]);
  
  const myColor = useMemo(() => {
    if (!gameData) return null;
    if (isLocalGame) return PlayerColor.WHITE;
    if (gameData.players.white === playerId) return PlayerColor.WHITE;
    if (gameData.players.black === playerId) return PlayerColor.BLACK;
    return null; 
  }, [gameData, playerId, isLocalGame]);

  const effectiveIsSpectator = isSpectator || (gameData && myColor === null && !isLocalGame);
  const isMyTurn = gameData?.status === GameStatus.ACTIVE && gameData?.turn === myColor && !effectiveIsSpectator;
  const isRotated = myColor === PlayerColor.BLACK;

  const legalMoves = useMemo(() => {
    if (!gameData || !myColor || board.length === 0 || effectiveIsSpectator) return [];
    if (gameData.status !== GameStatus.ACTIVE) return [];
    return calculateAllowedMoves(board, gameData.turn);
  }, [board, gameData?.turn, gameData?.status, myColor, effectiveIsSpectator]);

  const maxCapturesAvailable = useMemo(() => {
    if (legalMoves.length === 0) return 0;
    return Math.max(...legalMoves.map(m => m.captures.length));
  }, [legalMoves]);

  // Auto-lose if no moves
  useEffect(() => {
    if (!gameData || isLocalGame || effectiveIsSpectator) return;
    if (gameData.status !== GameStatus.ACTIVE) return;
    if (isMyTurn && legalMoves.length === 0) {
        const winner = myColor === PlayerColor.WHITE ? PlayerColor.BLACK : PlayerColor.WHITE;
        declareWinner(gameId!, winner);
        toast.error("Нет доступных ходов. Вы проиграли.");
    }
  }, [gameData?.status, isMyTurn, legalMoves.length, isLocalGame]);

  // Bot Turn
  useEffect(() => {
    if (!isLocalGame || !gameData || gameData.status !== GameStatus.ACTIVE) return;
    if (gameData.turn === PlayerColor.WHITE) return; 

    // Use a small delay so the user sees the bot "thinking"
    const botTimeout = setTimeout(() => {
      const bestMove = getSmartBotMove(board, PlayerColor.BLACK);
      
      if (!bestMove) {
        setGameData(prev => prev ? ({ ...prev, status: GameStatus.FINISHED, winner: PlayerColor.WHITE }) : null);
        toast.success("Вы победили!");
        return;
      }

      const nextBoard = applyMove(board, bestMove);
      const nextGameData: GameData = {
        ...gameData,
        board: JSON.stringify(nextBoard),
        turn: PlayerColor.WHITE,
        version: gameData.version + 1,
        lastMove: { from: bestMove.from, to: bestMove.to, ts: Date.now() },
        halfMoveClock: 0 
      };

      setGameData(nextGameData);
      
      const playerMoves = calculateAllowedMoves(nextBoard, PlayerColor.WHITE);
      if (playerMoves.length === 0) {
         setGameData(prev => prev ? ({ ...prev, status: GameStatus.FINISHED, winner: PlayerColor.BLACK }) : null);
         toast.error("Бот выиграл!");
      }
    }, 600);
    return () => clearTimeout(botTimeout);
  }, [gameData, isLocalGame, board]);

  // --- 5. Interaction Handlers (Move Logic) ---

  const handleCopyLink = () => {
    let link = window.location.href;
    if (gameId && !link.includes(gameId)) link = `${link}${link.includes('?') ? '&' : '?'}game=${gameId}`;
    navigator.clipboard.writeText(link);
    toast.success("Ссылка скопирована!");
  };

  const executeMove = async (from: Position, to: Position) => {
    if (!gameData || !isMyTurn) return;

    const move = legalMoves.find(
        m => m.from.row === from.row && m.from.col === from.col &&
             m.to.row === to.row && m.to.col === to.col
    );

    if (move) {
        const nextTurn = gameData.turn === PlayerColor.WHITE ? PlayerColor.BLACK : PlayerColor.WHITE;
        const nextBoard = applyMove(board, move);
        const nextVersion = gameData.version + 1;
        
        pendingMoveRef.current = true;
        const prevGameData = { ...gameData };
        const nextGameData = {
          ...gameData,
          board: JSON.stringify(nextBoard),
          turn: nextTurn,
          lastMove: { from: move.from, to: move.to, ts: Date.now() },
          version: nextVersion
        };

        setGameData(nextGameData);
        setSelectedPos(null);

        if (isLocalGame) {
           pendingMoveRef.current = false;
           return;
        }

        try {
          await performMove(gameId!, prevGameData, move, nextTurn);
        } catch (e) {
          console.error(e);
          toast.error("Ошибка синхронизации.");
          pendingMoveRef.current = false;
          setGameData(prevGameData);
        }
    } else {
        setSelectedPos(null);
    }
  };

  const handleSquareClick = async (pos: Position) => {
    if (selectedPos) {
      if (selectedPos.row === pos.row && selectedPos.col === pos.col) {
        setSelectedPos(null);
        return;
      }
      const move = legalMoves.find(
        m => m.from.row === selectedPos.row && m.from.col === selectedPos.col &&
             m.to.row === pos.row && m.to.col === pos.col
      );
      if (move) {
        await executeMove(selectedPos, pos);
        return;
      }
    }

    const movesFromHere = legalMoves.filter(m => m.from.row === pos.row && m.from.col === pos.col);
    if (movesFromHere.length > 0) {
      setSelectedPos(pos);
    } else {
      setSelectedPos(null);
    }
  };

  // --- RENDER ---

  // 1. Menu
  if (!gameId) {
    return (
      <div className="min-h-[100dvh] bg-[#1e1b18] flex items-center justify-center p-4">
        <div className="max-w-xl w-full bg-[#2a2622] p-6 lg:p-8 rounded-3xl shadow-2xl border border-stone-700 space-y-6 lg:space-y-8 animate-fade-in">
          <div className="text-center">
            <h1 className="text-5xl lg:text-6xl font-black text-[#e3c193] tracking-widest uppercase drop-shadow-lg mb-2">Шашки</h1>
            <p className="text-stone-500 tracking-wider text-sm uppercase">Русские правила</p>
          </div>
          <div className="space-y-4 lg:space-y-6">
             <button onClick={handleStartBotGame} className="w-full py-4 lg:py-5 rounded-2xl bg-stone-700 hover:bg-stone-600 active:scale-95 border border-stone-500 transition-all shadow-xl group flex items-center justify-center gap-3">
              <span className="text-2xl group-hover:scale-110 transition-transform">🤖</span>
              <span className="text-white font-bold text-lg">Тренировка с ботом</span>
            </button>
            <div className="relative flex items-center justify-center">
              <div className="absolute w-full border-t border-stone-600"></div>
              <span className="relative bg-[#2a2622] px-4 text-stone-500 text-xs font-bold uppercase tracking-wider">Создать Онлайн Игру</span>
            </div>
            <div className="grid grid-cols-3 gap-3 lg:gap-4">
              <button onClick={() => setSelectedColorMode(PlayerColor.WHITE)} className={`relative overflow-hidden h-24 lg:h-32 rounded-2xl border-2 transition-all duration-200 group ${selectedColorMode === PlayerColor.WHITE ? 'border-[#e3c193] ring-2 ring-[#e3c193]/30 scale-105' : 'border-stone-700 bg-stone-800/50 hover:border-stone-500'}`}>
                <div className="absolute inset-0 bg-gradient-to-br from-[#f8f8f8] to-[#d0d0d0] opacity-90"></div>
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-10">
                   <div className="w-8 h-8 lg:w-10 lg:h-10 rounded-full bg-white shadow-lg border-2 border-gray-200"></div>
                   <span className="font-bold text-black text-xs lg:text-sm">БЕЛЫЕ</span>
                </div>
              </button>
              <button onClick={() => setSelectedColorMode('RANDOM')} className={`relative overflow-hidden h-24 lg:h-32 rounded-2xl border-2 transition-all duration-200 group ${selectedColorMode === 'RANDOM' ? 'border-purple-500 ring-2 ring-purple-500/30 scale-105' : 'border-stone-700 bg-stone-800/50 hover:border-stone-500'}`}>
                <div className="absolute inset-0 bg-gradient-to-br from-purple-900 to-indigo-900 opacity-90"></div>
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-10"><span className="text-xl lg:text-2xl">🎲</span><span className="font-bold text-white text-xs lg:text-sm">СЛУЧАЙНО</span></div>
              </button>
              <button onClick={() => setSelectedColorMode(PlayerColor.BLACK)} className={`relative overflow-hidden h-24 lg:h-32 rounded-2xl border-2 transition-all duration-200 group ${selectedColorMode === PlayerColor.BLACK ? 'border-gray-500 ring-2 ring-gray-500/30 scale-105' : 'border-stone-700 bg-stone-800/50 hover:border-stone-500'}`}>
                 <div className="absolute inset-0 bg-gradient-to-br from-[#303030] to-[#101010] opacity-90"></div>
                 <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-10"><div className="w-8 h-8 lg:w-10 lg:h-10 rounded-full bg-black shadow-lg border-2 border-gray-700"></div><span className="font-bold text-white text-xs lg:text-sm">ЧЕРНЫЕ</span></div>
              </button>
            </div>
             <button onClick={handleCreateGame} disabled={loading} className={`w-full py-4 lg:py-5 font-bold rounded-2xl text-lg lg:text-xl transition-all shadow-xl ${loading ? 'bg-stone-700 cursor-not-allowed text-stone-500' : 'bg-gradient-to-r from-amber-600 to-orange-700 text-white hover:brightness-110 active:scale-95'}`}>
              {loading ? "Создаем..." : "Начать Игру"}
            </button>
          </div>
        </div>
        <Toaster />
      </div>
    );
  }

  // 2. Initial Loading
  if (gameId && !gameData) {
     return (
        <div className="min-h-[100dvh] bg-[#1e1b18] flex items-center justify-center">
            <div className="flex flex-col items-center gap-4 animate-pulse">
                <div className="w-12 h-12 rounded-full border-4 border-stone-700 border-t-amber-600 animate-spin"></div>
                <span className="text-stone-500 text-xs uppercase tracking-widest">Подключение...</span>
            </div>
        </div>
     );
  }

  // 3. CHECK FOR JOIN SCREEN
  // If we have gameData, but we are not one of the players yet, and it's Waiting
  const isParticipant = gameData?.players.white === playerId || gameData?.players.black === playerId;
  
  if (gameData?.status === GameStatus.WAITING && !isParticipant && !isLocalGame) {
      return (
          <>
            <JoinGameScreen gameData={gameData} onJoin={handleJoinGame} />
            {loading && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="animate-spin w-8 h-8 border-4 border-white border-t-transparent rounded-full"></div>
                </div>
            )}
            <Toaster position="top-center"/>
          </>
      );
  }

  // 4. Lobby (Creator waiting for joiner)
  if (gameData?.status === GameStatus.WAITING && !isLocalGame && isParticipant) {
    return (
      <div className="min-h-[100dvh] bg-[#1e1b18] flex items-center justify-center">
         <GameLobby gameId={gameId} gameData={gameData} playerId={playerId} onCancel={handleReturnToMenu} />
         <Toaster position="top-center" toastOptions={{ style: { background: '#2a2622', color: '#e3c193', border: '1px solid #444' } }}/>
      </div>
    );
  }

  const statusText = {
    [GameStatus.WAITING]: "Ожидание...",
    [GameStatus.ACTIVE]: isLocalGame ? "Бой с ботом" : "Бой",
    [GameStatus.FINISHED]: "Конец",
    [GameStatus.DRAW]: "Ничья"
  };
  const turnText = isMyTurn ? "ВАШ ХОД" : (gameData?.turn === PlayerColor.WHITE ? "ХОД БЕЛЫХ" : "ХОД ЧЕРНЫХ");
  const myRoleText = effectiveIsSpectator ? "Зритель" : (isLocalGame ? "Вы" : (myColor === PlayerColor.WHITE ? "Белые" : "Черные"));

  return (
    <div className="h-[100dvh] w-screen bg-[#1e1b18] overflow-hidden relative pt-safe flex items-center justify-center">
      <div className="flex flex-col lg:flex-row items-center justify-center gap-0 lg:max-w-[1250px] lg:w-full">
      
        {/* MOBILE HEADER */}
        <div className="lg:hidden w-full flex justify-between items-center px-4 py-2 mb-2 bg-[#2a2622] border-y border-stone-700/50">
           <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${gameData?.status === GameStatus.ACTIVE ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`}></div>
              <span className="text-stone-400 text-xs font-bold uppercase">{statusText[gameData?.status || GameStatus.WAITING]}</span>
           </div>
           <div className="flex items-center gap-2">
              <span className="text-stone-500 text-xs">Вы:</span>
              <span className="text-[#e3c193] font-bold text-sm">{myRoleText}</span>
           </div>
        </div>

        {/* BOARD AREA */}
        <div className="flex items-center justify-center relative z-10">
             <div className="relative aspect-square 
                w-[min(95vw,60vh)] h-[min(95vw,60vh)]
                lg:w-[min(82vh,82vh)] lg:h-[min(82vh,82vh)] 
                max-w-[800px] max-h-[800px] shadow-2xl">
               {gameData && board.length > 0 ? (
                 <>
                  <Board 
                    board={board} 
                    validMoves={legalMoves}
                    selectedPos={selectedPos}
                    onSquareClick={handleSquareClick}
                    onMovePiece={executeMove}
                    lastMove={gameData?.lastMove}
                    rotated={isRotated}
                  />
                  {maxCapturesAvailable > 0 && isMyTurn && !selectedPos && (
                     <div className="absolute -top-8 lg:-top-12 left-0 w-full text-center pointer-events-none z-20">
                        <span className="bg-amber-600/95 text-white px-3 py-1 lg:px-4 lg:py-1 rounded-full text-xs lg:text-sm font-bold shadow-lg animate-bounce inline-block border border-amber-400/30">⚠️ Обязательное взятие</span>
                     </div>
                  )}
                 </>
               ) : (
                 // Loading Skeleton
                 <div className="w-full h-full bg-[#3e2723] rounded-md border-[16px] border-[#3e2723] shadow-[0_20px_50px_rgba(0,0,0,0.7)]">
                    <div className="w-full h-full bg-[#2a2622] animate-pulse flex flex-col items-center justify-center text-stone-600 gap-4">
                        <div className="w-16 h-16 rounded-full border-4 border-stone-700 border-t-amber-600 animate-spin"></div>
                        <span className="text-xs font-bold tracking-widest uppercase">Загрузка доски...</span>
                    </div>
                 </div>
               )}
            </div>
        </div>

        {/* CONTROLS AREA */}
        <div className="w-full lg:w-[420px] flex flex-col gap-2 lg:gap-6 z-20 shrink-0 mt-4 lg:mt-0 lg:h-[min(82vh,82vh)] bg-[#1e1b18] lg:bg-transparent lg:pl-0">
          <div className="flex flex-col h-full gap-4 lg:bg-[#1e1b18] lg:border-l lg:border-[#3d3632] lg:pl-6 lg:justify-center">
            
            {/* Header */}
            <div className="hidden lg:block bg-[#2a2622] p-6 rounded-3xl shadow-xl border border-stone-700 min-h-[140px]">
              {gameData ? (
                <>
                  <div className="flex justify-between items-center mb-4">
                    <div className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-full ${gameData?.status === GameStatus.ACTIVE ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`}></div>
                        <span className="text-stone-300 font-bold text-sm uppercase tracking-wider">{statusText[gameData?.status || GameStatus.WAITING]}</span>
                    </div>
                    {!isLocalGame && <span className="font-mono text-xs text-stone-500 border border-stone-800 bg-[#1e1b18] px-2 py-1 rounded select-all">#{gameId}</span>}
                  </div>
                  <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-bold text-stone-500 uppercase tracking-widest mb-2">Вы играете за</p>
                        <div className="flex items-center gap-3">
                          {!effectiveIsSpectator ? (
                            <div className={`w-8 h-8 rounded-full border-2 shadow-sm ${myColor === PlayerColor.WHITE ? 'bg-[#f2e8d5] border-[#e6e0d0]' : 'bg-black border-gray-600'}`}></div>
                          ) : <span className="text-3xl">👀</span>}
                          <span className="font-black text-3xl text-[#e3c193]">{myRoleText}</span>
                        </div>
                      </div>
                  </div>
                </>
              ) : (
                <div className="h-full flex items-center justify-center">
                    <span className="text-stone-600 text-xs animate-pulse">Инициализация...</span>
                </div>
              )}
            </div>

            {/* Status */}
            {(gameData?.status === GameStatus.ACTIVE || gameData?.status === GameStatus.FINISHED || gameData?.status === GameStatus.DRAW) && (
              <div className={`mx-4 lg:mx-0 p-3 lg:p-6 rounded-xl lg:rounded-2xl border-2 transition-all duration-300 shadow-lg ${isMyTurn ? 'bg-gradient-to-br from-green-900/90 to-green-800/90 border-green-500/50' : 'bg-[#2a2622] border-stone-700'}`}>
                <h3 className="text-lg lg:text-2xl font-black text-center text-white tracking-widest uppercase leading-tight">
                  {gameData.status === GameStatus.FINISHED ? (
                    <span className="text-yellow-400">🏆 {gameData.winner === PlayerColor.WHITE ? 'БЕЛЫЕ ПОБЕДИЛИ' : 'ЧЕРНЫЕ ПОБЕДИЛИ'}</span>
                  ) : gameData.status === GameStatus.DRAW ? (
                    <span className="text-stone-400">🤝 НИЧЬЯ (50 ходов)</span>
                  ) : (
                    turnText
                  )}
                </h3>
              </div>
            )}
            
            {gameData?.status === GameStatus.ACTIVE && !isLocalGame && (
               <div className="flex justify-center">
                  <button onClick={handleCopyLink} className="text-stone-500 text-xs hover:text-stone-300 flex items-center gap-1 uppercase font-bold tracking-widest"><span>🔗</span> Скопировать ссылку для зрителя</button>
               </div>
            )}

            {/* Buttons */}
            <div className="grid grid-cols-2 gap-3 lg:gap-4 px-4 lg:px-0 mt-auto pb-4 lg:pb-0">
                <button onClick={handleReturnToMenu} disabled={rematchLoading} className="py-3 lg:py-6 px-4 bg-[#3d3632] hover:bg-[#4a423d] rounded-xl lg:rounded-2xl text-stone-300 font-bold text-xs lg:text-xl uppercase tracking-wider transition shadow-lg border-2 border-stone-700/50 disabled:opacity-50 disabled:cursor-not-allowed">Меню</button>
                
                {gameData?.status === GameStatus.ACTIVE && !gameData.winner && !effectiveIsSpectator && (
                <button onClick={() => { if (isLocalGame) { setGameData(prev => prev ? ({ ...prev, status: GameStatus.FINISHED, winner: PlayerColor.BLACK }) : null); } else { resignGame(gameId!, playerId); } }} className="py-3 lg:py-6 px-4 bg-red-900/30 hover:bg-red-900/50 border-2 border-red-900/30 rounded-xl lg:rounded-2xl text-red-200 font-bold text-xs lg:text-xl uppercase tracking-wider transition shadow-lg">Сдаться</button>
                )}
                
                {(gameData?.status === GameStatus.FINISHED || gameData?.status === GameStatus.DRAW) && !effectiveIsSpectator && !isLocalGame && (
                    <button 
                      onClick={handleRematch} 
                      disabled={(iProposedRematch && !!gameData.rematchId) || rematchLoading} 
                      className={`py-3 lg:py-6 px-4 rounded-xl lg:rounded-2xl font-bold text-xs lg:text-xl uppercase tracking-wider transition shadow-lg border-2 
                        ${rematchLoading ? 'bg-stone-800 border-stone-700 text-stone-500 cursor-wait' : 
                          (gameData.rematchId && !iProposedRematch) ? 'bg-green-700 hover:bg-green-600 text-white border-green-600/50 animate-pulse' : 
                          (iProposedRematch && gameData.rematchId) ? 'bg-stone-700 text-stone-400 border-stone-600 cursor-default' : 
                          'bg-amber-700 hover:bg-amber-600 text-white border-amber-600/50'}`
                      }>
                        {rematchLoading 
                           ? (gameData.rematchId ? "Входим..." : "Создание...") 
                           : (gameData.rematchId ? (iProposedRematch ? "Реванш создан" : "Принять Реванш!") : "Предложить Реванш")}
                    </button>
                )}
                
                {(gameData?.status === GameStatus.FINISHED || gameData?.status === GameStatus.DRAW) && isLocalGame && (
                    <button onClick={handleStartBotGame} className="py-3 lg:py-6 px-4 bg-amber-700 hover:bg-amber-600 rounded-xl lg:rounded-2xl text-white font-bold text-xs lg:text-xl uppercase tracking-wider transition shadow-lg border-2 border-amber-600/50">Играть снова</button>
                )}
            </div>
          </div>
        </div>
      
      </div>

      <Toaster position="top-center" toastOptions={{ style: { background: '#2a2622', color: '#e3c193', border: '1px solid #444' } }}/>
    </div>
  );
};

export default App;