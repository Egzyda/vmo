// src/components/Shared.jsx
const { useState } = React;
const { TYPE_COLORS, TYPE_BG, TYPE_NAMES } = window;

const ProgressBar = window.ProgressBar = ({ current, max, colorClass }) => {
    const percentage = Math.max(0, Math.min(100, (current / max) * 100));
    return (
        <div className="w-full h-3 bg-slate-900 rounded-full overflow-hidden border border-slate-700 shadow-inner relative">
            <div className={`h-full ${colorClass} hp-bar-transition`} style={{ width: `${percentage}%` }} />
        </div>
    );
};

// ★変更: shortLabels機能 (TeamBuilderはデフォルトfalseで既存維持)
const BigMonsterCard = window.BigMonsterCard = ({ monster, isSelected, index, onClick, shortLabels = false }) => {
    // データがない場合のフォールバック
    if (!monster) return <div className="w-full aspect-[4/3] bg-slate-900/50 rounded border border-slate-700"></div>;

    const typeBg = TYPE_BG[monster.type] || 'bg-slate-600';

    // 表示ラベルの切り替え: shortLabelsがtrueの時のみ短縮表記
    const labels = shortLabels
        ? { hp: 'HP', atk: 'A', def: 'D', spd: 'S' }     // 選出画面用 (スマホ対応)
        : { hp: 'HP', atk: 'ATK', def: 'DEF', spd: 'SPD' }; // 編成画面用 (維持)

    return (
        <div
            onClick={onClick}
            className={`relative w-full aspect-[4/3] rounded overflow-hidden cursor-pointer transition-all duration-300 group
            ${isSelected ? 'ring-2 ring-yellow-400 shadow-[0_0_15px_rgba(250,204,21,0.4)] z-10' : 'border border-slate-700 hover:border-slate-500 opacity-90'}`}
        >
            {/* 画像エリア */}
            <div className="absolute inset-0 bg-slate-900 flex items-center justify-center">
                {monster.img ? (
                    <img src={monster.img} className="w-full h-full object-contain transition-transform duration-500 group-hover:scale-110" referrerPolicy="no-referrer" />
                ) : (
                    <div className={`w-full h-full ${typeBg} opacity-20 flex items-center justify-center`}>
                        <span className="text-4xl opacity-50">{TYPE_NAMES[monster.type] || ''}</span>
                    </div>
                )}
                <div className="absolute top-0 inset-x-0 h-8 bg-gradient-to-b from-slate-900/80 to-transparent pointer-events-none"></div>
            </div>

            {/* ナンバリング (indexが渡された場合のみ表示) */}
            {typeof index === 'number' && (
                <div className="absolute top-1 left-1 z-10">
                    <div className="w-5 h-5 bg-black/80 border border-slate-600 flex items-center justify-center shadow rounded-sm">
                        <span className="text-[12px] font-teko text-white pt-0.5">{index + 1}</span>
                    </div>
                </div>
            )}

            {/* 名前とタイプ */}
            <div className="absolute bottom-[25px] left-0 z-10">
                 <div className="bg-slate-900/90 rounded-r px-2 py-0.5 flex items-center gap-1.5 w-fit border-y border-r border-white/10 backdrop-blur-md">
                     <span className={`px-1 rounded-[2px] text-[9px] font-bold text-white shadow ${typeBg} leading-relaxed`}>
                         {TYPE_NAMES[monster.type]}
                     </span>
                     <span className="font-bold text-[11px] text-white tracking-wide truncate font-zen leading-none pt-[1px]">
                         {monster.name}
                     </span>
                 </div>
            </div>

            {/* ステータス (最下部) */}
            <div className="absolute bottom-0 inset-x-0 z-10 bg-slate-900/90 p-1.5 border-t border-white/10 backdrop-blur-sm">
                <div className="flex justify-between px-1 text-xs font-bold text-slate-200 font-zen tracking-tight leading-none">
                    <span className="flex gap-0.5 items-baseline"><span className="text-green-400">{labels.hp}:</span>{monster.hp}</span>
                    <span className="flex gap-0.5 items-baseline"><span className="text-red-400">{labels.atk}:</span>{monster.atk}</span>
                    <span className="flex gap-0.5 items-baseline"><span className="text-blue-400">{labels.def}:</span>{monster.def}</span>
                    <span className="flex gap-0.5 items-baseline"><span className="text-yellow-400">{labels.spd}:</span>{monster.spd}</span>
                </div>
            </div>

            {isSelected && <div className="absolute inset-0 border-2 border-yellow-400/50 rounded pointer-events-none animate-pulse"></div>}
        </div>
    );
};


// 被弾・回復・バフの簡易演出。monster.fx = { kind, type } を見て描画する。
// kind: 'damage' | 'heal' | 'buff' | 'debuff'
const FX_FLASH_COLOR = {
    fire: 'bg-red-500', water: 'bg-blue-400', grass: 'bg-green-500',
    light: 'bg-yellow-300', dark: 'bg-purple-500', normal: 'bg-slate-300'
};

const MonsterFx = window.MonsterFx = ({ fx }) => {
    if (!fx) return null;
    if (fx.kind === 'damage') {
        const c = FX_FLASH_COLOR[fx.type] || FX_FLASH_COLOR.normal;
        return <div className={`absolute inset-0 z-30 pointer-events-none ${c} fx-flash`}></div>;
    }
    if (fx.kind === 'heal') {
        return (
            <div className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center fx-heal">
                <div className="absolute inset-0 bg-green-400/50"></div>
                <span className="relative text-green-100 font-black text-2xl drop-shadow">＋</span>
            </div>
        );
    }
    if (fx.kind === 'buff' || fx.kind === 'debuff') {
        const up = fx.kind === 'buff';
        return (
            <div className={`absolute inset-0 z-30 pointer-events-none flex items-center justify-center ${up ? 'fx-buff' : 'fx-debuff'}`}>
                <span className={`font-black text-3xl drop-shadow ${up ? 'text-red-300' : 'text-blue-300'}`}>{up ? '▲' : '▼'}</span>
            </div>
        );
    }
    return null;
};

const MonsterCard = window.MonsterCard = ({ monster, isActive, isAttacking, isTargetable, isSelected, showStatus = true, compact = false }) => {
    const [imgError, setImgError] = useState(false);
    if (!monster) return <div className={`w-full ${compact ? 'aspect-square' : 'aspect-[3/4]'} rounded bg-slate-900/50 border border-slate-800 flex flex-col items-center justify-center shadow-inner`}><span className="text-slate-600 text-xs font-teko">EMPTY</span></div>;

    const isFainted = monster.currentHp <= 0;

    const buffs = [];
    ['atk', 'def', 'spd'].forEach(stat => {
        if (!monster.buffs) return;
        const stage = monster.buffs[stat];

        // ★修正: バフ表記を A, D, S に変更 (以前は stat.toUpperCase() でした)
        const labelMap = { atk: 'A', def: 'D', spd: 'S' };
        const label = labelMap[stat];

        if (stage > 0) {
            const arrows = stage >= 2 ? '↑↑' : '↑';
            buffs.push({ label: `${label}${arrows}`, color: 'text-red-400' });
        } else if (stage < 0) {
            const arrows = stage <= -2 ? '↓↓' : '↓';
            buffs.push({ label: `${label}${arrows}`, color: 'text-blue-400' });
        }
    });

    const typeColorClass = TYPE_COLORS[monster.type] || TYPE_COLORS['normal'];
    const typeBgClass = TYPE_BG[monster.type] || TYPE_BG['normal'];
    const Header = () => (
        <div className="flex justify-between items-center mb-1 w-full overflow-hidden">
            <span className={`font-bold text-[10px] tracking-tighter whitespace-nowrap overflow-visible ${typeColorClass.split(' ')[0]}`}>{monster.name}</span>
            <span className={`ml-1 px-1 rounded text-[9px] text-white font-bold ${typeBgClass}`}>
                {TYPE_NAMES[monster.type] || monster.type}
            </span>
        </div>
    );

    if (showStatus) {
        return (
            <div className={`relative w-full rounded border transition-all duration-200 select-none overflow-hidden flex flex-col ${isFainted ? 'opacity-50 grayscale' : 'opacity-100'} ${isActive ? 'scale-105 shadow-xl shadow-blue-500/20 z-10 border-blue-400' : 'border-slate-600'} ${isAttacking ? 'ring-4 ring-cyan-400 shadow-xl shadow-cyan-400/40 z-20 scale-105' : ''} ${isTargetable ? 'ring-2 ring-yellow-400 cursor-pointer' : ''} ${monster.fx && monster.fx.kind === 'damage' ? 'fx-hit' : ''} bg-slate-900 p-1`}>
                <Header />
                <div className="w-full aspect-square bg-slate-900 rounded border border-slate-700 flex items-center justify-center overflow-hidden relative group">
                        {monster.img && !imgError ? (
                            <img src={monster.img} alt={monster.name} className={`w-full h-full object-contain ${monster.status === 'poison' ? 'status-poison-tint' : ''}`} referrerPolicy="no-referrer" onError={(e) => { e.target.onerror = null; setImgError(true); }} />
                        ) : (
                            <div className={`w-full h-full ${typeBgClass} opacity-50 flex items-center justify-center`}><span className="text-slate-600 text-xs font-teko">NO IMAGE</span></div>
                        )}
                        {monster.status === 'poison' && (
                            <div className="absolute top-1 left-1 z-30 bg-purple-900/90 border border-purple-400 rounded-full w-5 h-5 flex items-center justify-center shadow-lg animate-pulse">
                                <span className="text-[10px] leading-none">💀</span>
                            </div>
                        )}
                        <div className="absolute bottom-0 w-full bg-black/70 pt-1 pb-0.5 px-1">
                            <ProgressBar current={monster.currentHp} max={monster.maxHp} colorClass={monster.currentHp < monster.maxHp * 0.2 ? 'bg-red-500' : (monster.currentHp < monster.maxHp * 0.5 ? 'bg-yellow-500' : 'bg-green-500')} />
                            <div className="flex justify-end text-xs text-white text-stat text-outline leading-none mt-0.5">{monster.currentHp}/{monster.maxHp}</div>
                        </div>
                        {monster.isProtected && <div className="absolute inset-0 bg-blue-500/30 border-2 border-blue-400 z-20"></div>}
                        <MonsterFx fx={monster.fx} />
                </div>
                <div className="flex gap-1 flex-wrap h-4 overflow-hidden items-start mt-0.5 content-start">
                    {buffs.map((b, i) => (
                        <span key={i} className={`text-[9px] font-black ${b.color} leading-none bg-black/40 px-0.5 rounded`}>{b.label}</span>
                    ))}
                </div>
            </div>
        );
    }
    return (
        <div className={`relative w-full rounded border transition-all duration-200 select-none overflow-hidden flex flex-col ${isFainted ? 'opacity-50 grayscale' : 'opacity-100'} ${isActive ? 'scale-105 shadow-xl shadow-blue-500/20 z-10 border-blue-400' : 'border-slate-600'} ${isAttacking ? 'ring-4 ring-cyan-400 shadow-xl shadow-cyan-400/40 z-20 scale-105' : ''} ${isTargetable ? 'ring-2 ring-yellow-400 cursor-pointer' : ''} ${isSelected ? 'bg-blue-900/40' : 'bg-slate-800'} ${compact ? 'p-1' : 'p-2'}`}>
            <Header />
            <div className={`w-full aspect-square bg-slate-900 rounded border border-slate-700 mb-1 flex items-center justify-center overflow-hidden relative group`}>
                    {monster.img && !imgError ? (
                        <img src={monster.img} alt={monster.name} className={`w-full h-full object-contain ${monster.status === 'poison' ? 'status-poison-tint' : ''}`} referrerPolicy="no-referrer" onError={(e) => { e.target.onerror = null; setImgError(true); }} />
                    ) : (
                        <><div className={`absolute inset-0 opacity-20 ${typeBgClass}`}></div><span className="text-slate-600 text-xs font-teko relative z-10">NO IMAGE</span></>
                    )}
                    {monster.status === 'poison' && (
                        <div className="absolute top-1 left-1 z-30 bg-purple-900/90 border border-purple-400 rounded-full w-4 h-4 flex items-center justify-center shadow-md animate-pulse">
                            <span className="text-[8px] leading-none">💀</span>
                        </div>
                    )}
            </div>
            {compact && (
                <div className="mt-1 text-[9px] text-white font-zen font-bold leading-tight tracking-wide">
                    <div className="flex justify-between"><span>H:{monster.hp}</span><span>A:{monster.atk}</span></div>
                    <div className="flex justify-between"><span>B:{monster.def}</span><span>S:{monster.spd}</span></div>
                </div>
            )}
        </div>
    );
};

const Modal = window.Modal = ({ title, children, onClose }) => {
    return (
        <div className="absolute inset-0 z-[100] modal-overlay flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-600 rounded-lg shadow-2xl w-full max-w-sm flex flex-col max-h-[80%] anim-fade-in">
                <div className="p-3 border-b border-slate-700 flex justify-between items-center bg-slate-800 rounded-t-lg">
                    <h3 className="font-bold text-lg font-teko tracking-wide text-white">{title}</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-white px-2">✕</button>
                </div>
                <div className="p-4 overflow-y-auto custom-scroll text-sm leading-relaxed text-slate-300">{children}</div>
                <div className="p-3 border-t border-slate-700 bg-slate-800 rounded-b-lg">
                    <button onClick={onClose} className="w-full py-2 bg-blue-700 hover:bg-blue-600 rounded text-white font-bold">CLOSE</button>
                </div>
            </div>
        </div>
    );
};

// バトル中にモンスター画像をタップして開く詳細ステータス。
// 敵の技構成は伏せる（showMoves=false）。ステータスは戦略判断のため両陣営とも公開する。
const MonsterDetailModal = window.MonsterDetailModal = ({ monster, showMoves, dbMoves, onClose }) => {
    if (!monster) return null;
    const statMul = window.getStatMultiplier || (() => 1);
    const bg = TYPE_BG[monster.type] || TYPE_BG['normal'];

    const rows = [
        { key: 'atk', label: 'ATK', base: monster.atk, color: 'text-red-400' },
        { key: 'def', label: 'DEF', base: monster.def, color: 'text-blue-400' },
        { key: 'spd', label: 'SPD', base: monster.spd, color: 'text-yellow-400' }
    ];
    const hpPct = monster.maxHp ? Math.max(0, Math.round(monster.currentHp / monster.maxHp * 100)) : 0;

    return (
        <div className="absolute inset-0 z-[150] bg-black/80 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
            <div className="w-full max-w-[300px] bg-slate-900 border border-slate-600 rounded-lg overflow-hidden shadow-2xl"
                onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2 p-2 border-b border-slate-700 bg-slate-950">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold text-white ${bg}`}>{TYPE_NAMES[monster.type] || '?'}</span>
                    <span className="font-bold text-sm text-white truncate flex-1">{monster.name}</span>
                    {monster.level ? <span className="text-[11px] text-slate-400">Lv{monster.level}</span> : null}
                </div>

                <div className="p-2">
                    <div className="w-full aspect-square max-h-32 bg-slate-950 rounded overflow-hidden mb-2 flex items-center justify-center">
                        {monster.img
                            ? <img src={monster.img} className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                            : <span className="text-slate-600 text-xs font-teko">NO IMAGE</span>}
                    </div>

                    <div className="mb-2">
                        <div className="flex justify-between text-[10px] text-slate-300 mb-0.5">
                            <span className="text-green-400 font-bold">HP</span>
                            <span>{monster.currentHp} / {monster.maxHp}</span>
                        </div>
                        <div className="w-full h-2 bg-slate-800 rounded overflow-hidden">
                            <div className={`h-full ${hpPct < 25 ? 'bg-red-500' : hpPct < 50 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: hpPct + '%' }} />
                        </div>
                    </div>

                    {/* 自分の手持ちのみ次のレベルまでの経験値を表示（敵の内部進捗は見せない） */}
                    {showMoves && monster.exp != null && window.getRequiredExp && (
                        <div className="mb-2">
                            <div className="flex justify-between text-[10px] text-slate-300 mb-0.5">
                                <span className="text-cyan-400 font-bold">EXP</span>
                                {monster.level >= (window.MAX_LEVEL || 100)
                                    ? <span className="text-cyan-300">MAX LEVEL</span>
                                    : <span>{monster.exp} / {window.getRequiredExp(monster.level)}</span>}
                            </div>
                            {monster.level < (window.MAX_LEVEL || 100) && (
                                <div className="w-full h-1.5 bg-slate-800 rounded overflow-hidden">
                                    <div className="h-full bg-cyan-400" style={{ width: Math.min(100, Math.round(monster.exp / window.getRequiredExp(monster.level) * 100)) + '%' }} />
                                </div>
                            )}
                        </div>
                    )}

                    {rows.map(r => {
                        const stage = (monster.buffs && monster.buffs[r.key]) || 0;
                        const mul = statMul(stage);
                        const eff = Math.floor((r.base || 0) * mul);
                        const arrow = stage > 0 ? (stage >= 2 ? '↑↑' : '↑') : (stage < 0 ? (stage <= -2 ? '↓↓' : '↓') : '');
                        const arrowColor = stage > 0 ? 'text-red-400' : stage < 0 ? 'text-blue-400' : '';
                        return (
                            <div key={r.key} className="flex items-center justify-between text-[11px] py-0.5 border-b border-slate-800">
                                <span className={`font-bold ${r.color}`}>{r.label}</span>
                                <span className="text-slate-200">
                                    {eff}
                                    {stage !== 0 && <span className="text-slate-500"> （{r.base}）</span>}
                                    {arrow && <span className={`ml-1 font-bold ${arrowColor}`}>{arrow}</span>}
                                </span>
                            </div>
                        );
                    })}

                    {monster.status && (
                        <div className="mt-2 text-[10px] text-purple-300 bg-purple-950/60 border border-purple-700 rounded px-2 py-1">
                            状態異常: {monster.status === 'poison' ? '毒' : monster.status}
                        </div>
                    )}
                    {monster.isProtected && (
                        <div className="mt-1 text-[10px] text-blue-300 bg-blue-950/60 border border-blue-700 rounded px-2 py-1">
                            守りの体勢
                        </div>
                    )}

                    {showMoves ? (
                        <div className="mt-2">
                            <div className="text-[9px] text-slate-500 mb-1">MOVES（装備中）</div>
                            {(monster.selectedMoves || []).map(mv => {
                                const d = (dbMoves && dbMoves[mv]) || {};
                                return (
                                    <div key={mv} className="flex justify-between items-center text-[10px] py-0.5 border-b border-slate-800">
                                        <span className="text-slate-200 truncate">{mv}</span>
                                        <span className="text-slate-400 flex-none ml-2">{TYPE_NAMES[d.type] || ''} P:{d.power || '-'}</span>
                                    </div>
                                );
                            })}
                            {(() => {
                                const unequipped = (monster.knownMoves || []).filter(mv => !(monster.selectedMoves || []).includes(mv));
                                if (!unequipped.length) return null;
                                return (
                                    <>
                                        <div className="text-[9px] text-slate-500 mt-2 mb-1">未装備（習得済み）</div>
                                        {unequipped.map(mv => {
                                            const d = (dbMoves && dbMoves[mv]) || {};
                                            return (
                                                <div key={mv} className="flex justify-between items-center text-[10px] py-0.5 border-b border-slate-800 text-slate-500">
                                                    <span className="truncate">{mv}</span>
                                                    <span className="flex-none ml-2">{TYPE_NAMES[d.type] || ''} P:{d.power || '-'}</span>
                                                </div>
                                            );
                                        })}
                                    </>
                                );
                            })()}
                        </div>
                    ) : (
                        <div className="mt-2 text-[10px] text-slate-500 text-center">相手の技構成は不明</div>
                    )}
                </div>

                <button onClick={onClose} className="w-full py-2 bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold">CLOSE</button>
            </div>
        </div>
    );
};

const ResultModal = window.ResultModal = ({ result, onExit, exitLabel = 'RETURN TO TITLE' }) => {
    if (!result) return null;
    return (
        <div className="absolute inset-0 z-[200] bg-black/80 flex flex-col items-center justify-center animate-fade-in">
            <h1 className={`text-6xl font-teko font-bold tracking-widest mb-4 ${result === 'win' ? 'text-yellow-400' : 'text-blue-400'}`}>
                {result === 'win' ? 'YOU WIN!' : 'YOU LOSE...'}
            </h1>
            <button onClick={() => onExit(result)} className="px-8 py-3 bg-white text-black font-bold rounded hover:scale-105 transition font-teko text-xl tracking-wider">
                {exitLabel}
            </button>
        </div>
    );
};