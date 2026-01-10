const { useState, useEffect } = React;

const TitlePreview = () => {
    // 既存のボタン機能はダミーとして定義
    const setShowDifficultySelect = () => alert("SINGLE BATTLE clicked");
    const setView = (view) => alert(`${view.toUpperCase()} clicked`);
    const setShowTutorial = () => alert("TUTORIAL clicked");
    const handleVersionTap = () => alert("Version Tapped");

    return (
        <div className="w-full h-full relative overflow-hidden bg-black font-zen text-white select-none">
            {/* 背景画像レイヤー */}
            <div className="absolute inset-0 z-0">
                <img src="./img/menu_bg.png" className="w-full h-full object-cover opacity-80" alt="Cyber Background" />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/60 mix-blend-multiply"></div>
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.8)_100%)]"></div>
            </div>

            {/* スキャンライン & グリッチエフェクト */}
            <div className="scanline z-10 pointer-events-none opacity-30"></div>
            <div className="absolute inset-0 z-10 pointer-events-none bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%] opacity-20"></div>

            {/* コンテンツレイヤー */}
            <div className="relative z-20 w-full h-full flex flex-col items-center justify-center p-6">

                {/* タイトルロゴエリア */}
                <div className="mb-12 relative group cursor-default">
                    <h1 className="text-8xl md:text-9xl font-teko font-bold tracking-widest text-transparent bg-clip-text bg-gradient-to-b from-white via-cyan-100 to-cyan-500 relative z-10 leading-[0.85] text-center filter drop-shadow-[0_0_10px_rgba(34,211,238,0.8)]">
                        VERSUS<br />
                        <span className="text-6xl md:text-7xl tracking-[0.2em] bg-clip-text bg-gradient-to-br from-cyan-400 to-purple-500">MONSTERS</span>
                    </h1>

                    {/* ゴースト/グリッチレイヤー */}
                    <h1 className="absolute inset-0 text-8xl md:text-9xl font-teko font-bold tracking-widest text-red-500 opacity-40 blur-[1px] animate-pulse leading-[0.85] text-center translate-x-1 select-none pointer-events-none mix-blend-screen">
                        VERSUS<br /><span className="text-6xl md:text-7xl tracking-[0.2em]">MONSTERS</span>
                    </h1>
                    <h1 className="absolute inset-0 text-8xl md:text-9xl font-teko font-bold tracking-widest text-blue-500 opacity-40 blur-[1px] animate-pulse delay-75 leading-[0.85] text-center -translate-x-1 select-none pointer-events-none mix-blend-screen">
                        VERSUS<br /><span className="text-6xl md:text-7xl tracking-[0.2em]">MONSTERS</span>
                    </h1>

                    <p className="text-cyan-400/80 mt-6 font-teko tracking-[0.5em] text-sm md:text-base text-center border-t border-cyan-500/30 pt-4 w-full max-w-lg mx-auto uppercase">
                        Tactical Battle Simulation - Ver 4.1.0
                    </p>
                </div>

                {/* メニューボタンエリア */}
                <div className="w-full max-w-sm space-y-4 perspective-1000">

                    {/* Single Battle */}
                    <button onClick={setShowDifficultySelect} className="group relative w-full py-4 bg-slate-900/40 backdrop-blur-md border border-cyan-500/30 rounded overflow-hidden transition-all duration-300 hover:scale-105 hover:bg-cyan-900/30 hover:border-cyan-400 hover:shadow-[0_0_20px_rgba(34,211,238,0.3)]">
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-cyan-400/10 to-transparent -translate-x-full group-hover:animate-shine"></div>
                        <div className="flex items-center justify-center gap-3">
                            <span className="w-2 h-2 bg-cyan-400 rounded-full shadow-[0_0_5px_cyan]"></span>
                            <span className="font-teko text-2xl font-bold tracking-widest text-cyan-100 group-hover:text-white">SINGLE BATTLE</span>
                            <span className="w-2 h-2 bg-cyan-400 rounded-full shadow-[0_0_5px_cyan]"></span>
                        </div>
                    </button>

                    {/* Online Battle */}
                    <button onClick={() => setView('online_lobby')} className="group relative w-full py-4 bg-slate-900/40 backdrop-blur-md border border-purple-500/30 rounded overflow-hidden transition-all duration-300 hover:scale-105 hover:bg-purple-900/30 hover:border-purple-400 hover:shadow-[0_0_20px_rgba(168,85,247,0.3)]">
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-purple-400/10 to-transparent -translate-x-full group-hover:animate-shine"></div>
                        <div className="flex items-center justify-center gap-3">
                            <span className="w-2 h-2 bg-purple-400 rounded-full shadow-[0_0_5px_purple]"></span>
                            <span className="font-teko text-2xl font-bold tracking-widest text-purple-100 group-hover:text-white">ONLINE BATTLE</span>
                            <span className="w-2 h-2 bg-purple-400 rounded-full shadow-[0_0_5px_purple]"></span>
                        </div>
                    </button>

                    {/* Sub Menus */}
                    <div className="grid grid-cols-2 gap-3 pt-2">
                        <button onClick={() => setView('team')} className="py-3 bg-slate-900/30 border border-slate-600/50 rounded hover:bg-slate-800/50 hover:border-slate-400 hover:text-white text-slate-400 font-teko tracking-wider text-lg transition-all">
                            TEAM EDIT
                        </button>
                        <button onClick={() => setView('encyclopedia')} className="py-3 bg-slate-900/30 border border-slate-600/50 rounded hover:bg-slate-800/50 hover:border-slate-400 hover:text-white text-slate-400 font-teko tracking-wider text-lg transition-all">
                            MONSTER DATA
                        </button>
                    </div>

                    <button onClick={setShowTutorial} className="w-full py-2 mt-2 text-slate-500 text-xs font-teko tracking-[0.2em] hover:text-cyan-400 transition-colors uppercase">
                        System Guide & Tutorial
                    </button>

                </div>

                {/* Footer / Copyright */}
                <div className="absolute bottom-4 text-[10px] text-slate-600 font-teko tracking-widest mix-blend-plus-lighter">
                    Created with Gemini 1.5 Pro | System All Green
                </div>

            </div>

            {/* CSS for animations (Scoped) */}
            <style>{`
                .perspective-1000 { perspective: 1000px; }
                @keyframes shine {
                    0% { transform: translateX(-100%) skewX(-15deg); }
                    100% { transform: translateX(200%) skewX(-15deg); }
                }
                .group-hover\\:animate-shine { animation: shine 0.7s; }
            `}</style>
        </div>
    );
};

// Mount it
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<TitlePreview />);
