import React from 'react';
import { toast } from 'react-hot-toast';
import { GameData, PlayerColor } from '../types';

interface GameLobbyProps {
  gameId: string;
  gameData: GameData;
  playerId: string;
  onCancel: () => void;
}

const GameLobby: React.FC<GameLobbyProps> = ({ gameId, gameData, playerId, onCancel }) => {
  const baseUrl = `${window.location.origin}${window.location.pathname}`;
  const gameUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}game=${gameId}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&color=e3c193&bgcolor=2a2622&data=${encodeURIComponent(gameUrl)}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(gameUrl);
    toast.success("Ссылка скопирована!");
  };

  // Logic: If random, HIDE specific color info
  const isRandom = gameData.metadata?.isRandomColor;
  
  // Determine roles (internal, even if hidden)
  const myColor = gameData.players.white === playerId ? PlayerColor.WHITE : PlayerColor.BLACK;
  const isWhite = myColor === PlayerColor.WHITE;
  
  const myColorText = isRandom ? "Случайный цвет" : (isWhite ? "Белыми" : "Черными");
  const opponentColorText = isRandom ? "Соперника" : (isWhite ? "Черных" : "Белых");

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-4xl px-4 animate-fade-in">
      <div className="w-full bg-[#2a2622] rounded-xl shadow-2xl border border-stone-700 overflow-hidden">
        
        {/* Header */}
        <div className="bg-[#3d3632] p-6 border-b border-stone-600 flex flex-col md:flex-row justify-between items-center gap-4">
          <div>
            <h2 className="text-2xl lg:text-3xl font-bold text-[#e3c193] mb-1">Вызов создан</h2>
            <p className="text-stone-400 text-sm uppercase tracking-wider">Русские шашки • 8x8</p>
          </div>
          <div className="flex items-center gap-2 bg-[#2a2622] px-3 py-1.5 rounded-full border border-stone-700">
            <span className="animate-pulse w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.6)]"></span>
            <span className="text-stone-300 text-xs font-bold uppercase tracking-wider">Ожидание соперника...</span>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 lg:p-10 grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-start">
          
          <div className="space-y-6">
            {/* Status Card */}
            <div className="bg-[#1e1b18] rounded-lg border border-stone-700/50 overflow-hidden">
                <div className="p-4 flex items-center gap-4 border-b border-stone-700/50 bg-[#25211d]">
                    {isRandom ? (
                         // Random / Mystery Icon
                         <div className="w-12 h-12 rounded-full shadow-lg border-2 border-stone-500 bg-gradient-to-br from-[#f0e4cc] to-[#383838] flex items-center justify-center relative overflow-hidden">
                            <span className="text-stone-800 font-bold text-lg mix-blend-difference z-10">?</span>
                         </div>
                    ) : (
                        // Specific Color Icon
                        <div className={`w-12 h-12 rounded-full shadow-lg border-2 flex items-center justify-center ${isWhite ? 'bg-[#f0e4cc] border-[#e6dcc0]' : 'bg-[#383838] border-[#555]'}`}>
                            <div className={`w-8 h-8 rounded-full border-2 opacity-50 ${isWhite ? 'border-[#bcaaa4]' : 'border-gray-600'}`}></div>
                        </div>
                    )}
                    
                    <div>
                        <div className="text-[#e3c193] font-bold text-lg leading-tight">
                            {isRandom ? "Цвет скрыт" : `Вы играете ${myColorText}`}
                        </div>
                        <div className="text-stone-500 text-xs font-bold uppercase tracking-wider mt-0.5">
                            {isRandom ? "Определится при старте" : "Цвет определен"}
                        </div>
                    </div>
                </div>
                <div className="p-3 bg-[#1e1b18] text-center">
                    <span className="text-stone-400 text-sm">
                        Ожидаем присоединения {opponentColorText}...
                    </span>
                </div>
            </div>

            <div className="space-y-2">
              <label className="text-stone-500 text-xs font-bold uppercase tracking-widest">
                Ссылка для друга
              </label>
              <div className="flex gap-0 shadow-lg rounded-lg overflow-hidden group">
                <input 
                  readOnly
                  value={gameUrl}
                  className="bg-[#1e1b18] text-stone-300 px-4 py-4 w-full outline-none font-mono text-xs md:text-sm border-y border-l border-stone-700 group-hover:border-stone-500 transition-colors"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button 
                  onClick={handleCopy}
                  className="bg-[#3d3632] hover:bg-stone-600 text-stone-200 px-6 font-bold border border-stone-700 border-l-0 transition-colors"
                  title="Скопировать"
                >
                  📋
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-center justify-center space-y-6 h-full">
            <div className="p-4 bg-white rounded-xl shadow-lg transform hover:scale-105 transition-transform duration-300">
               <img 
                 src={qrUrl} 
                 alt="Scan to Join" 
                 className="w-40 h-40 lg:w-48 lg:h-48 mix-blend-multiply opacity-90"
               />
            </div>
            <p className="text-stone-500 text-xs text-center uppercase tracking-widest max-w-[200px]">
              Отсканируйте, чтобы играть на телефоне
            </p>
          </div>
        </div>

        <div className="bg-[#1e1b18] p-6 border-t border-stone-700 flex justify-center">
           <button 
             onClick={onCancel}
             className="flex items-center gap-2 px-8 py-3 rounded-lg bg-red-900/10 hover:bg-red-900/20 text-red-400/80 border border-red-900/20 transition-all font-bold uppercase text-xs tracking-wider hover:scale-105"
           >
             <span>✖</span> Отменить игру
           </button>
        </div>
      </div>
    </div>
  );
};

export default GameLobby;