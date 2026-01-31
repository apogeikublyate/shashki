import React, { useEffect, useState, useMemo, useRef } from 'react';
import { GameData, PlayerColor, Position, GameStatus, BoardState } from './types';
import { createGame, joinGame, subscribeToGame, performMove, getPlayerIdentity, resignGame, proposeRematch, requestTakeback, resolveTakeback } from './services/gameService';
import { calculateAllowedMoves, applyMove, initializeBoard } from './rules/checkersRules';
import { getSmartBotMove } from './ai/bot';
import { isConfigured } from './services/firebase';
import Board from './components/Board';
import GameLobby from './components/GameLobby';
import JoinGameScreen from './components/JoinGameScreen';
import { Toaster, toast } from 'react-hot-toast';

type ColorSelection = PlayerColor | 'RANDOM';

type EditorTool = 
  | 'WHITE_PAWN' 
  | 'WHITE_KING' 
  | 'BLACK_PAWN' 
  | 'BLACK_KING' 
  | 'ERASER';

const App: React.FC = () => {
  // Game State
  const [gameId, setGameId] = useState<string | null>(null);
  const [gameData, setGameData] = useState<GameData | null>(null);
  const [isLocalGame, setIsLocalGame] = useState(false);
  const [isSpectator, setIsSpectator] = useState(false);
  
  // Editor State
  const [isEditorMode, setIsEditorMode] = useState(false);
  const [editorBoard, setEditorBoard] = useState<BoardState>(initializeBoard());
  const [selectedTool, setSelectedTool] = useState<EditorTool>('WHITE_PAWN');

  // Local Game History (Snapshot before player move)
  const [localGameSnapshot, setLocalGameSnapshot] = useState<GameData | null>(null);
  const botTimerRef = useRef<number | null>(null);
  
  // UI State
  const [selectedPos, setSelectedPos] = useState<Position | null>(null);
  const [playerId] = useState<string>(() => getPlayerIdentity().id);
  const [loading, setLoading] = useState(false);
  const [rematchLoading, setRematchLoading] = useState(false);
  const [selectedColorMode, setSelectedColorMode] = useState<ColorSelection>(PlayerColor.WHITE);
  const [takebackLoading, setTakebackLoading] = useState(false);
  
  const [iProposedRematch, setIProposedRematch] = useState(false);

  const pendingMoveRef = useRef(false);

  // Navigation Logic
  const safePushState = (url: string) => {
    try {
      window.history.pushState({}, '', url);
    } catch (err) {
      console.warn("URL update failed:", err);
    }
  };

  useEffect(() => {
    const handleUrlChange = () => {
      const params = new URLSearchParams(window.location.search);
      const id = params.get('game');
      if (id !== gameId) {
          if (id) {
            setGameId(id);
            setGameData(null); 
            setLocalGameSnapshot(null);
            setIsEditorMode(false);
          } else {
            setGameId(null);
            setGameData(null);
            setLocalGameSnapshot(null);
            setIsLocalGame(false);
            setIsEditorMode(false);
          }
      }
    };
    window.addEventListener('popstate', handleUrlChange);
    return () => window.removeEventListener('popstate', handleUrlChange);
  }, [gameId]);

  useEffect(() => {
     const params = new URLSearchParams(window.location.search);
     const id = params.get('game');
     if (id && !gameId) {
         setGameId(id);
     }
  }, []); 

  // Game Subscription
  useEffect(() => {
    if (!gameId || gameId === "local_bot") return;

    const unsubscribe = subscribeToGame(gameId, (data) => {
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

  // Actions
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

  const createOptimisticGameData = (myColor: PlayerColor, isRandom: boolean, initialBoard: BoardState): GameData => {
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
          metadata: { isRandomColor: isRandom },
          takebackRequest: null,
          previousState: null
      };
  };

  const switchToNewGame = (newId: string, initialData?: GameData) => {
      setIProposedRematch(false);
      setRematchLoading(false);
      setSelectedPos(null);
      setIsLocalGame(false);
      setIsSpectator(false);
      setLocalGameSnapshot(null);
      setIsEditorMode(false);
      if (initialData) setGameData(initialData);
      else setGameData(null);
      setGameId(newId);
      safePushState(`${window.location.pathname}?game=${newId}`);
  };

  const handleStartBotGame = () => {
    // If in editor mode, use editorBoard, else standard
    const boardToUse = isEditorMode ? editorBoard : initializeBoard();
    
    const oneDayMs = 24 * 60 * 60 * 1000;
    const newData: GameData = {
      board: JSON.stringify(boardToUse),
      turn: PlayerColor.WHITE,
      players: { white: 'local', black: 'bot' },
      status: GameStatus.ACTIVE,
      winner: null,
      version: 0,
      halfMoveClock: 0,
      createdAt: Date.now(),
      expireAt: Date.now() + oneDayMs,
      takebackRequest: null,
      previousState: null
    };
    
    setGameData(newData);
    setIsLocalGame(true);
    setLocalGameSnapshot(null);
    setIsEditorMode(false);
    setGameId("local_bot");
    setIProposedRematch(false);
    safePushState(window.location.pathname); 
  };

  const handleCreateGame = async () => {
    if (!isConfigured) return;
    setLoading(true);
    try {
      const isRandom = selectedColorMode === 'RANDOM';
      const finalColor: PlayerColor = isRandom 
        ? (Math.random() < 0.5 ? PlayerColor.WHITE : PlayerColor.BLACK) 
        : selectedColorMode;
      
      const boardToUse = isEditorMode ? editorBoard : initializeBoard();

      const id = await createGame(playerId, finalColor, isRandom, boardToUse);
      const optimisticData = createOptimisticGameData(finalColor, isRandom, boardToUse);
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
    if (rematchLoading) return;
    setRematchLoading(true);

    if (gameData?.rematchId) {
        // Accept Rematch
        switchToNewGame(gameData.rematchId, undefined);
    } else {
        // Propose Rematch
        try {
            const newColor = myColor === PlayerColor.WHITE ? PlayerColor.BLACK : PlayerColor.WHITE;
            const isRandom = !!gameData?.metadata?.isRandomColor;
            
            setIProposedRematch(true); // Optimistically set this
            
            const newGameId = await proposeRematch(gameId!, playerId, myColor!, isRandom);
            
            // If newGameId matches existing (rare race), handling is same as accept
            if (newGameId !== gameData?.rematchId) {
               // We created it, wait for opponent
            }
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
    setLocalGameSnapshot(null);
    if (botTimerRef.current) clearTimeout(botTimerRef.current);
    setIsLocalGame(false);
    setIsSpectator(false);
    setIProposedRematch(false);
    setRematchLoading(false);
    setIsEditorMode(false);
  };

  const handleRequestTakeback = async () => {
      if (takebackLoading) return;

      // Local Game (Bot) - Instant Undo
      if (isLocalGame && gameData) {
          if (localGameSnapshot) {
              if (botTimerRef.current) clearTimeout(botTimerRef.current);
              setGameData(localGameSnapshot);
              setLocalGameSnapshot(null); 
              toast.success("Ход возвращен");
          }
          return;
      }

      // Online Game - Request
      if(!gameId) return;
      
      setTakebackLoading(true);
      try {
          await requestTakeback(gameId, playerId);
          toast.success("Запрос на возврат хода отправлен");
      } catch (e) {
          toast.error("Ошибка отправки запроса");
          setTakebackLoading(false);
      }
  };

  const handleResolveTakeback = async (accepted: boolean) => {
      if(!gameId || isLocalGame) return;
      try {
          await resolveTakeback(gameId, accepted);
      } catch (e) {
          toast.error("Ошибка");
      }
  };

  // --- EDITOR HANDLERS ---
  const handleEditorSquareClick = (pos: Position) => {
      // Only dark squares allowed
      if ((pos.row + pos.col) % 2 === 0) return;

      const newBoard = editorBoard.map(row => [...row]);
      
      if (selectedTool === 'ERASER') {
          newBoard[pos.row][pos.col] = null;
      } else {
          const isWhite = selectedTool.startsWith('WHITE');
          const isKing = selectedTool.endsWith('KING');
          newBoard[pos.row][pos.col] = {
              color: isWhite ? PlayerColor.WHITE : PlayerColor.BLACK,
              isKing: isKing
          };
      }
      setEditorBoard(newBoard);
  };

  const handleClearBoard = () => {
      const empty: BoardState = Array(8).fill(null).map(() => Array(8).fill(null));
      setEditorBoard(empty);
  };

  const handleResetBoard = () => {
      setEditorBoard(initializeBoard());
  };


  // --- Derived State ---

  const board = useMemo(() => {
    if (isEditorMode) return editorBoard;
    if (!gameData || !gameData.board) return [];
    try { return JSON.parse(gameData.board); } catch (e) { return []; }
  }, [gameData, isEditorMode, editorBoard]);
  
  const myColor = useMemo(() => {
    if (isEditorMode) return PlayerColor.WHITE; // Default view for editor
    if (!gameData) return null;
    if (isLocalGame) return PlayerColor.WHITE;
    if (gameData.players.white === playerId) return PlayerColor.WHITE;
    if (gameData.players.black === playerId) return PlayerColor.BLACK;
    return null; 
  }, [gameData, playerId, isLocalGame, isEditorMode]);

  const effectiveIsSpectator = isSpectator || (gameData && myColor === null && !isLocalGame);
  const isMyTurn = gameData?.status === GameStatus.ACTIVE && gameData?.turn === myColor && !effectiveIsSpectator;
  const isRotated = myColor === PlayerColor.BLACK;

  const legalMoves = useMemo(() => {
    if (isEditorMode) return [];
    if (!gameData || !myColor || board.length === 0 || effectiveIsSpectator) return [];
    if (gameData.status !== GameStatus.ACTIVE) return [];
    return calculateAllowedMoves(board, gameData.turn);
  }, [board, gameData?.turn, gameData?.status, myColor, effectiveIsSpectator, isEditorMode]);

  const maxCapturesAvailable = useMemo(() => {
    if (legalMoves.length === 0) return 0;
    return Math.max(...legalMoves.map(m => m.captures.length));
  }, [legalMoves]);

  // Bot Turn
  useEffect(() => {
    if (isEditorMode) return;
    if (!isLocalGame || !gameData || gameData.status !== GameStatus.ACTIVE) return;
    if (gameData.turn === PlayerColor.WHITE) return; 

    // Clear previous timer if exists to avoid double moves
    if (botTimerRef.current) clearTimeout(botTimerRef.current);

    botTimerRef.current = window.setTimeout(() => {
      const bestMove = getSmartBotMove(board, PlayerColor.BLACK);
      
      if (!bestMove) {
        setGameData(prev => prev ? ({ ...prev, status: GameStatus.FINISHED, winner: PlayerColor.WHITE }) : null);
        toast.success("Вы победили!");
        return;
      }

      const nextBoard = applyMove(board, bestMove);
      const playerMoves = calculateAllowedMoves(nextBoard, PlayerColor.WHITE);
      
      let winner: PlayerColor | null = null;
      let status = GameStatus.ACTIVE;

      if (playerMoves.length === 0) {
         status = GameStatus.FINISHED;
         winner = PlayerColor.BLACK;
         toast.error("Бот выиграл!");
      }

      // Check Draw
      let whiteCount = 0, blackCount = 0, whiteKings = 0, blackKings = 0;
      for(let r=0; r<8; r++) {
         for(let c=0; c<8; c++) {
            const p = nextBoard[r][c];
            if(p) {
               if(p.color === PlayerColor.WHITE) { whiteCount++; if(p.isKing) whiteKings++; }
               else { blackCount++; if(p.isKing) blackKings++; }
            }
         }
      }
      if (whiteCount === 1 && whiteKings === 1 && blackCount === 1 && blackKings === 1) {
          status = GameStatus.DRAW;
          toast("Ничья! (Дамка против Дамки)", { icon: '🤝' });
      }

      const nextGameData: GameData = {
        ...gameData,
        board: JSON.stringify(nextBoard),
        turn: PlayerColor.WHITE,
        version: gameData.version + 1,
        lastMove: { from: bestMove.from, to: bestMove.to, path: bestMove.path, ts: Date.now() },
        halfMoveClock: 0,
        status: status,
        winner: winner
      };

      setGameData(nextGameData);
    }, 600);
    return () => {
        if (botTimerRef.current) clearTimeout(botTimerRef.current);
    };
  }, [gameData, isLocalGame, board, isEditorMode]);

  // Move Handling
  const executeMove = async (from: Position, to: Position) => {
    if (isEditorMode) return;
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
        
        if (isLocalGame) {
            setLocalGameSnapshot(prevGameData);
        }

        const nextGameData = {
          ...gameData,
          board: JSON.stringify(nextBoard),
          turn: nextTurn,
          lastMove: { from: move.from, to: move.to, path: move.path, ts: Date.now() },
          version: nextVersion,
          takebackRequest: null 
        };

        setGameData(nextGameData);
        setSelectedPos(null);

        if (isLocalGame) {
           pendingMoveRef.current = false;
           // Local win/draw logic is handled in the bot effect (since bot replies) 
           // BUT if playing local PvP (not implemented yet) or bot is next, we wait.
           // However, if HUMAN move ends game, we must check here.
           const botMoves = calculateAllowedMoves(nextBoard, PlayerColor.BLACK);
           if (botMoves.length === 0) {
               setGameData({ ...nextGameData, status: GameStatus.FINISHED, winner: PlayerColor.WHITE });
               toast.success("Вы победили!");
           }
           
           let whiteCount = 0, blackCount = 0, whiteKings = 0, blackKings = 0;
            for(let r=0; r<8; r++) {
                for(let c=0; c<8; c++) {
                    const p = nextBoard[r][c];
                    if(p) {
                    if(p.color === PlayerColor.WHITE) { whiteCount++; if(p.isKing) whiteKings++; }
                    else { blackCount++; if(p.isKing) blackKings++; }
                    }
                }
            }
            if (whiteCount === 1 && whiteKings === 1 && blackCount === 1 && blackKings === 1) {
                setGameData({ ...nextGameData, status: GameStatus.DRAW });
                toast("Ничья! (Дамка против Дамки)", { icon: '🤝' });
            }

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
    if (isEditorMode) {
        handleEditorSquareClick(pos);
        return;
    }
    
    // Normal Game Logic
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

  // --- RENDERS ---

  if (!gameId && !isEditorMode) {
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
            
            <button onClick={() => { setIsEditorMode(true); setEditorBoard(initializeBoard()); }} className="w-full py-3 bg-[#3d3632] hover:bg-[#4a423d] text-stone-300 font-bold uppercase tracking-wider text-xs rounded-xl border border-stone-600 transition-colors">
                 🛠 Редактор доски
            </button>
          </div>
        </div>
        <Toaster />
      </div>
    );
  }

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

  const isParticipant = gameData?.players.white === playerId || gameData?.players.black === playerId;
  
  if (gameData?.status === GameStatus.WAITING && !isParticipant && !isLocalGame) {
      return (
          <>
            <JoinGameScreen gameData={gameData} onJoin={handleJoinGame} />
            {loading && <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"><div className="animate-spin w-8 h-8 border-4 border-white border-t-transparent rounded-full"></div></div>}
            <Toaster position="top-center"/>
          </>
      );
  }

  if (gameData?.status === GameStatus.WAITING && !isLocalGame && isParticipant) {
    return (
      <div className="min-h-[100dvh] bg-[#1e1b18] flex items-center justify-center">
         <GameLobby gameId={gameId!} gameData={gameData} playerId={playerId} onCancel={handleReturnToMenu} />
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

  // Undo / Takeback Status
  const takebackIncoming = !!gameData?.takebackRequest?.requesterId && gameData.takebackRequest.requesterId !== playerId;
  const takebackSent = gameData?.takebackRequest?.requesterId === playerId;
  
  // Clear loading state if request was successfully processed (reflected in gameData)
  if (takebackSent && takebackLoading) {
      setTakebackLoading(false);
  } else if (!takebackSent && takebackLoading && !isLocalGame) {
      // If we were loading but the request is gone and we are not the sender, it means it was rejected or handled
      setTakebackLoading(false);
  }

  const canRequestTakeback = isLocalGame 
       ? (gameData?.status === GameStatus.ACTIVE && !!localGameSnapshot) 
       : (!takebackSent && !takebackIncoming && gameData?.status === GameStatus.ACTIVE && !!gameData?.previousState);

  // Rematch Status
  const opponentProposedRematch = !!gameData?.rematchId && !iProposedRematch;
  const waitingForOpponentRematch = !!gameData?.rematchId && iProposedRematch;

  return (
    <div className="h-[100dvh] w-screen bg-[#1e1b18] overflow-hidden relative pt-safe flex items-center justify-center">
      <div className="flex flex-col lg:flex-row items-center justify-center gap-0 lg:max-w-[1250px] lg:w-full">
      
        {/* MOBILE HEADER */}
        {!isEditorMode && (
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
        )}

        {/* BOARD AREA */}
        <div className="flex items-center justify-center relative z-10">
             {/* INCREASED SIZE HERE: min(96vw, 85vh) for mobile to fill almost all available height */}
             <div className="relative aspect-square w-[min(98vw,80vh)] h-[min(98vw,80vh)] lg:w-[min(85vh,85vh)] lg:h-[min(85vh,85vh)] max-w-[900px] max-h-[900px] shadow-2xl">
               {(gameData || isEditorMode) && board.length > 0 ? (
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
                  {!isEditorMode && maxCapturesAvailable > 0 && isMyTurn && !selectedPos && (
                     <div className="absolute -top-8 lg:-top-12 left-0 w-full text-center pointer-events-none z-20">
                        <span className="bg-amber-600/95 text-white px-3 py-1 lg:px-4 lg:py-1 rounded-full text-xs lg:text-sm font-bold shadow-lg animate-bounce inline-block border border-amber-400/30">⚠️ Обязательное взятие</span>
                     </div>
                  )}
                 </>
               ) : (
                 <div className="w-full h-full bg-[#3e2723] rounded-md border-[16px] border-[#3e2723] shadow-[0_20px_50px_rgba(0,0,0,0.7)] flex items-center justify-center">
                    <div className="w-16 h-16 rounded-full border-4 border-stone-700 border-t-amber-600 animate-spin"></div>
                 </div>
               )}
            </div>
        </div>

        {/* CONTROLS AREA */}
        <div className="w-full lg:w-[420px] flex flex-col gap-2 lg:gap-6 z-20 shrink-0 mt-4 lg:mt-0 lg:h-[min(85vh,85vh)] bg-[#1e1b18] lg:bg-transparent lg:pl-0">
          <div className="flex flex-col h-full gap-4 lg:bg-[#1e1b18] lg:border-l lg:border-[#3d3632] lg:pl-6 lg:justify-center">
            
            {/* EDITOR CONTROLS */}
            {isEditorMode ? (
                <div className="bg-[#2a2622] p-4 lg:p-6 rounded-3xl shadow-xl border border-stone-700 space-y-4">
                     <div className="flex justify-between items-center mb-2">
                        <h2 className="text-[#e3c193] font-bold text-lg uppercase tracking-wider">Редактор</h2>
                        <button onClick={handleReturnToMenu} className="text-stone-500 hover:text-stone-300 text-xs uppercase font-bold">Выход</button>
                     </div>
                     
                     <div className="grid grid-cols-5 gap-2">
                        {[
                           { id: 'WHITE_PAWN', label: '⚪' },
                           { id: 'WHITE_KING', label: '♔' },
                           { id: 'BLACK_PAWN', label: '⚫' },
                           { id: 'BLACK_KING', label: '♚' },
                           { id: 'ERASER', label: '✖' }
                        ].map(tool => (
                             <button 
                                key={tool.id}
                                onClick={() => setSelectedTool(tool.id as EditorTool)}
                                className={`aspect-square rounded-lg flex items-center justify-center text-2xl border-2 transition-all ${selectedTool === tool.id ? 'bg-amber-700 border-amber-500 text-white scale-110 shadow-lg' : 'bg-stone-800 border-stone-600 text-stone-400 hover:bg-stone-700'}`}
                             >
                                 {tool.label}
                             </button>
                        ))}
                     </div>
                     
                     <div className="grid grid-cols-2 gap-2 mt-4">
                         <button onClick={handleClearBoard} className="py-2 text-xs font-bold uppercase text-stone-400 bg-stone-800 hover:bg-stone-700 rounded-lg">Очистить</button>
                         <button onClick={handleResetBoard} className="py-2 text-xs font-bold uppercase text-stone-400 bg-stone-800 hover:bg-stone-700 rounded-lg">Сброс</button>
                     </div>

                     <div className="pt-4 border-t border-stone-700 space-y-2">
                        <button onClick={handleStartBotGame} className="w-full py-3 bg-gradient-to-r from-blue-700 to-blue-900 text-white font-bold rounded-xl shadow-lg border border-blue-500/30">
                            Играть с ботом
                        </button>
                        <button onClick={handleCreateGame} className="w-full py-3 bg-gradient-to-r from-amber-700 to-orange-800 text-white font-bold rounded-xl shadow-lg border border-amber-500/30">
                            Создать Онлайн (Белые)
                        </button>
                     </div>
                </div>
            ) : (
                /* NORMAL GAME INFO */
                <>
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

                {/* TAKEBACK NOTIFICATION AREA */}
                {takebackIncoming && (
                    <div className="mx-4 lg:mx-0 p-4 rounded-xl bg-[#2a2622] border border-stone-600 shadow-xl animate-fade-in flex flex-col gap-3">
                        <div className="flex items-center gap-2 text-stone-300">
                            <span className="text-xl">↩️</span>
                            <span className="text-sm font-bold">Соперник просит вернуть ход</span>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={() => handleResolveTakeback(true)} className="flex-1 py-3 bg-green-800/50 hover:bg-green-700 text-green-200 border border-green-700 rounded-lg font-bold text-sm uppercase tracking-wider transition">✔ Вернуть</button>
                            <button onClick={() => handleResolveTakeback(false)} className="flex-1 py-3 bg-red-900/40 hover:bg-red-900/60 text-red-300 border border-red-800 rounded-lg font-bold text-sm uppercase tracking-wider transition">✖ Отказать</button>
                        </div>
                    </div>
                )}
                
                {takebackSent && (
                    <div className="mx-4 lg:mx-0 p-3 rounded-xl bg-[#2a2622] border border-stone-700 shadow-xl flex items-center justify-center gap-2">
                        <div className="w-4 h-4 rounded-full border-2 border-stone-500 border-t-amber-600 animate-spin"></div>
                        <span className="text-stone-400 text-sm font-bold">Ожидание ответа соперника...</span>
                    </div>
                )}

                {/* Game Status Banner */}
                {(!takebackIncoming && !takebackSent) && (gameData?.status === GameStatus.ACTIVE || gameData?.status === GameStatus.FINISHED || gameData?.status === GameStatus.DRAW) && (
                <div className={`mx-4 lg:mx-0 p-3 lg:p-6 rounded-xl lg:rounded-2xl border-2 transition-all duration-300 shadow-lg ${isMyTurn ? 'bg-gradient-to-br from-green-900/90 to-green-800/90 border-green-500/50' : 'bg-[#2a2622] border-stone-700'}`}>
                    <h3 className="text-lg lg:text-2xl font-black text-center text-white tracking-widest uppercase leading-tight">
                    {gameData.status === GameStatus.FINISHED ? (
                        <span className="text-yellow-400">🏆 {gameData.winner === PlayerColor.WHITE ? 'БЕЛЫЕ ПОБЕДИЛИ' : 'ЧЕРНЫЕ ПОБЕДИЛИ'}</span>
                    ) : gameData.status === GameStatus.DRAW ? (
                        <span className="text-stone-400">🤝 НИЧЬЯ</span>
                    ) : (
                        turnText
                    )}
                    </h3>
                    {gameData.status === GameStatus.DRAW && (
                        <p className="text-stone-500 text-center text-xs mt-1 uppercase font-bold">50 ходов или дамки 1x1</p>
                    )}
                </div>
                )}
                
                {/* Buttons Row */}
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 px-4 lg:px-0 mt-auto pb-4 lg:pb-0">
                    
                    {/* MENU */}
                    <button onClick={handleReturnToMenu} disabled={rematchLoading} className="py-3 px-2 bg-[#3d3632] hover:bg-[#4a423d] rounded-xl text-stone-300 font-bold text-xs uppercase tracking-wider transition shadow-lg border-2 border-stone-700/50">Меню</button>
                    
                    {/* ACTIVE GAME CONTROLS */}
                    {gameData?.status === GameStatus.ACTIVE && !gameData.winner && !effectiveIsSpectator && (
                        <>
                            <button 
                                onClick={handleRequestTakeback} 
                                disabled={!canRequestTakeback || takebackLoading} 
                                className={`py-3 px-2 bg-[#3d3632] hover:bg-[#4a423d] disabled:opacity-30 disabled:cursor-not-allowed rounded-xl text-stone-300 border-2 border-stone-700/50 flex items-center justify-center transition shadow-lg group ${takebackLoading ? 'animate-pulse' : ''}`}
                                title="Вернуть ход"
                            >
                            {takebackLoading ? (
                                <div className="w-5 h-5 rounded-full border-2 border-stone-500 border-t-amber-600 animate-spin"></div>
                            ) : (
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-stone-400 group-hover:text-white transition-colors">
                                    <path d="M3 10h10a5 5 0 0 1 5 5v2" />
                                    <path d="M3 10l6-6" />
                                    <path d="M3 10l6 6" />
                                </svg>
                            )}
                            </button>
                            <button onClick={() => { if (isLocalGame) { setGameData(prev => prev ? ({ ...prev, status: GameStatus.FINISHED, winner: PlayerColor.BLACK }) : null); } else { resignGame(gameId!, playerId); } }} className="py-3 px-2 bg-red-900/30 hover:bg-red-900/50 border-2 border-red-900/30 rounded-xl text-red-200 font-bold text-xs uppercase tracking-wider transition shadow-lg">Сдаться</button>
                        </>
                    )}
                    
                    {/* END GAME CONTROLS */}
                    {(gameData?.status === GameStatus.FINISHED || gameData?.status === GameStatus.DRAW) && !effectiveIsSpectator && !isLocalGame && (
                        <button 
                        onClick={handleRematch} 
                        disabled={(waitingForOpponentRematch) || rematchLoading} 
                        className={`col-span-2 py-3 px-4 rounded-xl font-bold text-xs lg:text-sm uppercase tracking-wider transition-all shadow-lg border-2 
                            ${rematchLoading ? 'bg-stone-800 border-stone-700 text-stone-500 cursor-wait' : 
                            opponentProposedRematch ? 'bg-green-700 hover:bg-green-600 text-white border-green-600/50 animate-pulse scale-105' : 
                            waitingForOpponentRematch ? 'bg-stone-700 text-stone-400 border-stone-600 cursor-default' : 
                            'bg-amber-700 hover:bg-amber-600 text-white border-amber-600/50'}`
                        }>
                            {rematchLoading 
                            ? (gameData.rematchId ? "Входим..." : "Создание...") 
                            : (opponentProposedRematch 
                                ? "⚡ ПРИНЯТЬ РЕВАНШ!" 
                                : (waitingForOpponentRematch ? "Ожидание соперника..." : "Предложить Реванш")
                            )}
                        </button>
                    )}
                    
                    {(gameData?.status === GameStatus.FINISHED || gameData?.status === GameStatus.DRAW) && isLocalGame && (
                        <button onClick={handleStartBotGame} className="col-span-2 py-3 px-4 bg-amber-700 hover:bg-amber-600 rounded-xl text-white font-bold text-xs lg:text-sm uppercase tracking-wider transition shadow-lg border-2 border-amber-600/50">Играть снова</button>
                    )}
                </div>
                </>
            )}
          </div>
        </div>
      
      </div>

      <Toaster position="top-center" toastOptions={{ style: { background: '#2a2622', color: '#e3c193', border: '1px solid #444' } }}/>
    </div>
  );
};

export default App;