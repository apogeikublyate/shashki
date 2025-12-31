import React from 'react';
import { GameData, PlayerColor } from '../types';

interface JoinGameScreenProps {
  gameData: GameData;
  onJoin: () => void;
}

const JoinGameScreen: React.FC<JoinGameScreenProps> = ({ gameData, onJoin }) => {
  // Logic: If random, HIDE specific color info
  const isRandom = gameData.metadata?.isRandomColor;

  // Determine which color is available (internal logic)
  const creatorIsWhite = !!gameData.players.white;
  const myPotentialColor = creatorIsWhite ? PlayerColor.BLACK : PlayerColor.WHITE;
  
  return (
    <div className="min-h-[100dvh] bg-[#1e1b18] flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-[#2a2622] rounded-xl shadow-2xl border border-stone-700 overflow-hidden animate-fade-in">
        
        {/* Header */}
        <div className="bg-[#3d3632] p-5 border-b border-stone-600 flex justify-between items-center">
            <div className="flex items-center gap-3">
                <span className="w-3 h-3 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.6)] animate-pulse"></span>
                <span className="text-[#e3c193] font-bold text-sm uppercase tracking-wider">Вызов на игру</span>
            </div>
            <div className="text-stone-500 text-xs font-bold uppercase">Русские шашки</div>
        </div>

        {/* Body */}
        <div className="p-8 lg:p-10 flex flex-col items-center gap-8">
            
            <div className="text-center space-y-2">
                <h2 className="text-stone-300 text-2xl lg:text-3xl font-bold">Аноним</h2>
                <p className="text-stone-500 text-sm font-medium uppercase tracking-widest">приглашает вас сыграть</p>
            </div>

            {/* Game Info Card */}
            <div className="w-full bg-[#1e1b18] border border-stone-700/50 rounded-xl flex items-center p-5 gap-5 shadow-inner">
                 
                 {isRandom ? (
                     // Random Icon
                     <div className="w-16 h-16 rounded-full flex-shrink-0 flex items-center justify-center shadow-lg border-2 border-stone-600 bg-gradient-to-br from-[#f0e4cc] to-[#383838]">
                        <span className="text-2xl font-black text-stone-400 mix-blend-difference">?</span>
                     </div>
                 ) : (
                     // Specific Color Icon
                     <div className={`w-16 h-16 rounded-full flex-shrink-0 flex items-center justify-center shadow-lg border-2 ${myPotentialColor === PlayerColor.WHITE ? 'bg-[#f0e4cc] border-[#e6dcc0]' : 'bg-[#1e1e1e] border-[#555]'}`}>
                        <div className={`w-12 h-12 rounded-full border-4 opacity-30 ${myPotentialColor === PlayerColor.WHITE ? 'border-[#a18e6e]' : 'border-[#888]'}`}></div>
                     </div>
                 )}
                 
                 <div className="flex-1 space-y-1">
                     <div className="text-[#e3c193] font-bold text-xl">
                        {isRandom ? "Случайный цвет" : (myPotentialColor === PlayerColor.WHITE ? "Вы играете Белыми" : "Вы играете Черными")}
                     </div>
                     <div className="text-stone-500 text-sm flex flex-col gap-1">
                        <span>{isRandom ? "Цвет определится при старте" : "Роль назначена создателем"}</span>
                        <div className="flex items-center gap-2 mt-1">
                             <span className="text-xs font-bold bg-stone-800 px-2 py-0.5 rounded border border-stone-700">∞ Без времени</span>
                        </div>
                     </div>
                 </div>
            </div>

        </div>

        {/* Footer / Action */}
        <div className="p-6 bg-[#1e1b18] flex justify-center border-t border-stone-700">
            <button 
                onClick={onJoin}
                className="w-full py-4 bg-gradient-to-r from-amber-700 to-orange-800 hover:from-amber-600 hover:to-orange-700 active:scale-[0.98] transition-all text-white font-bold text-lg rounded-xl shadow-lg border border-amber-600/30 uppercase tracking-wider"
            >
                ▶ Принять вызов
            </button>
        </div>

      </div>
    </div>
  );
};

export default JoinGameScreen;