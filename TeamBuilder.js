const { useState, useEffect } = React;
const { TYPE_BG, TYPE_NAMES, BigMonsterCard, db, auth } = window;
const { doc, getDoc, onAuthStateChanged } = window.fb;

const TeamBuilder = ({ savedTeams, currentTeamIndex, setCurrentTeamIndex, updateTeam, onBack, dbMonsters, dbMoves }) => {
    const [selectedSlot, setSelectedSlot] = useState(0);
    const [editMode, setEditMode] = useState('monster');
    const [filterType, setFilterType] = useState('ALL');
    const [sortKey, setSortKey] = useState('id');

    // 捕獲済み(captured)のIDリスト
    const [capturedIds, setCapturedIds] = useState([]);

    const myParty = savedTeams[currentTeamIndex];
    const selectedMon = myParty[selectedSlot] || myParty[0];

    useEffect(() => {
        if (savedTeams && savedTeams.length > 0) {
            savedTeams.forEach((team, index) => {
                localStorage.setItem(`vmo_party_${index + 1}`, JSON.stringify(team));
            });
        }
    }, [savedTeams]);

    // ログイン状態と所持モンスターの同期
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                try {
                    const docRef = doc(db, "users", user.uid, "adventure", "save");
                    const docSnap = await getDoc(docRef);
                    if (docSnap.exists()) {
                        const data = docSnap.data();

                        // ★修正: party(手持ち)とbox(ボックス)の両方からIDを収集
                        const partyList = data.party || [];
                        const boxList = data.box || [];

                        // 両方のリストを結合
                        const allMonsters = [...partyList, ...boxList];

                        // IDを抽出して重複排除 (Set使用)
                        const ids = [...new Set(allMonsters.map(m => m.id))];

                        setCapturedIds(ids);
                    }
                } catch (e) {
                    console.error("Failed to load adventure progress:", e);
                }
            } else {
                setCapturedIds([]);
            }
        });
        return () => unsubscribe();
    }, []);

    // --- Logic ---

    const handleMemberChange = (newMonId) => {
        const existingIndex = myParty.findIndex(m => m.id === newMonId);
        const newParty = [...myParty];

        const baseData = dbMonsters.find(m => m.id === newMonId);
        if (!baseData) return;

        const newInstance = {
            ...baseData,
            uid: Math.random().toString(36).substr(2, 9),
            maxHp: baseData.hp,
            currentHp: baseData.hp,
            buffs: { atk: 0, def: 0, spd: 0 },
            selectedMoves: baseData.moves.slice(0, 3),
            isDamaged: false,
            protectStreak: 0,
            lastTakenDamage: 0
        };

        if (existingIndex !== -1 && existingIndex !== selectedSlot) {
            const temp = newParty[selectedSlot];
            newParty[selectedSlot] = newParty[existingIndex];
            newParty[existingIndex] = temp;
        } else {
            newParty[selectedSlot] = newInstance;
        }
        updateTeam(currentTeamIndex, newParty);
    };

    const handleMoveToggle = (moveName) => {
        const currentMon = myParty[selectedSlot];
        let newMoves = [...currentMon.selectedMoves];

        if (newMoves.includes(moveName)) {
            if (newMoves.length > 1) newMoves = newMoves.filter(m => m !== moveName);
        } else {
            if (newMoves.length < 3) newMoves.push(moveName);
        }

        const newParty = [...myParty];
        newParty[selectedSlot] = { ...currentMon, selectedMoves: newMoves };
        updateTeam(currentTeamIndex, newParty);
    };

    // --- Filters & Sorts ---

    const getFilteredMonsters = () => {
        let list = dbMonsters.filter(m => {
            // 1. 管理者用ボス(999)以外はすべて表示
            return m.id !== 999;
        });

        if (filterType !== 'ALL') {
            list = list.filter(m => m.type === filterType);
        }
        list.sort((a, b) => {
            if (sortKey === 'id') return a.id - b.id;
            return b[sortKey] - a[sortKey];
        });
        return list;
    };

    const getSortedMoves = () => {
        const baseData = dbMonsters.find(m => m.id === selectedMon.id) || selectedMon;
        const moves = baseData.moves || [];

        return [...moves].sort((a, b) => {
            const aSel = selectedMon.selectedMoves.includes(a);
            const bSel = selectedMon.selectedMoves.includes(b);
            if (aSel && !bSel) return -1;
            if (!aSel && bSel) return 1;
            return 0;
        });
    };

    const filteredMonsters = getFilteredMonsters();
    const sortedMoves = getSortedMoves();

    const types = ['ALL', 'fire', 'water', 'grass', 'light', 'dark', 'normal'];
    const sortOptions = [
        { key: 'id', label: 'ID' },
        { key: 'hp', label: 'HP' },
        { key: 'atk', label: 'ATK' },
        { key: 'def', label: 'DEF' },
        { key: 'spd', label: 'SPD' }
    ];

    const bgStyle = {
        backgroundImage: selectedMon.img ? `url(${selectedMon.img})` : 'none',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
    };

    return (
        <div className="w-full h-full bg-slate-900 flex flex-col relative overflow-hidden shadow-2xl font-zen select-none">

            <div className="absolute inset-0 opacity-20 pointer-events-none transition-all duration-700 blur-3xl scale-125" style={bgStyle}>
                <div className={`absolute inset-0 ${!selectedMon.img ? TYPE_BG[selectedMon.type] : ''} mix-blend-overlay`}></div>
            </div>
            <div className="absolute inset-0 bg-gradient-to-b from-slate-900/80 via-slate-900/95 to-slate-950 pointer-events-none"></div>

            {/* HEADER */}
            <div className="relative z-10 px-2 py-2 flex justify-between items-center bg-slate-950/80 border-b border-gray-800 backdrop-blur-md flex-none h-[50px]">
                <h2 className="text-xl font-teko text-white tracking-widest pl-2">TEAM EDIT</h2>
                <button onClick={onBack} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-xs rounded text-white font-bold transition-colors">
                    BACK
                </button>
            </div>

            {/* TEAM TABS */}
            <div className="relative z-10 px-2 py-2 flex gap-1 flex-none h-[40px]">
                {[0, 1, 2].map(idx => (
                    <button
                        key={idx}
                        onClick={() => { setCurrentTeamIndex(idx); setSelectedSlot(0); }}
                        className={`flex-1 text-[11px] font-bold rounded transition-all border
                        ${currentTeamIndex === idx
                            ? 'bg-blue-700 text-white shadow-md border-blue-500'
                            : 'bg-slate-800 text-gray-400 border-slate-700 hover:bg-slate-700'}`}
                    >
                        TEAM {idx + 1}
                    </button>
                ))}
            </div>

            {/* 2x2 Grid */}
            <div className="relative z-10 px-2 flex-none">
                <div className="grid grid-cols-2 gap-2">
                    {myParty.map((mon, idx) => (
                        <BigMonsterCard
                            key={idx}
                            monster={mon}
                            index={idx}
                            isSelected={selectedSlot === idx}
                            onClick={() => setSelectedSlot(idx)}
                        />
                    ))}
                </div>
            </div>

            {/* CONTROLS & EDIT AREA */}
            <div className="flex-1 bg-slate-950/90 backdrop-blur-xl mt-2 border-t border-white/10 flex flex-col overflow-hidden relative z-20 shadow-[0_-5px_20px_rgba(0,0,0,0.5)]">

                {/* Control Bar */}
                <div className="flex px-2 pt-2 border-b border-white/5 pb-2 flex-none h-[50px] items-center gap-1">

                    {/* Left: Filter & Sort */}
                    <div className="flex-1 min-w-0 h-full flex flex-col justify-center">
                        {editMode === 'monster' ? (
                            <>
                                <div className="flex w-full mb-1">
                                    {types.map((t, i) => (
                                        <button
                                            key={t}
                                            onClick={() => setFilterType(t)}
                                            className={`flex-1 py-1 text-[10px] font-bold leading-none transition-all border-y border-r first:border-l
                                            ${i === 0 ? 'rounded-l-[2px]' : ''}
                                            ${i === types.length - 1 ? 'rounded-r-[2px]' : ''}
                                            ${filterType === t
                                                ? 'bg-gray-200 text-black border border-white shadow-[inset_0_0_5px_rgba(0,0,0,0.1)] z-10'
                                                : 'bg-slate-800 text-gray-500 border-gray-700 hover:bg-slate-700 hover:text-gray-300'}`}
                                        >
                                            {t === 'ALL' ? 'ALL' : (TYPE_NAMES[t] || t)}
                                        </button>
                                    ))}
                                </div>
                                <div className="flex w-full">
                                    {sortOptions.map((opt, i) => (
                                        <button
                                            key={opt.key}
                                            onClick={() => setSortKey(opt.key)}
                                            className={`flex-1 py-0.5 text-[8px] font-bold transition-all text-center leading-none border-y border-r first:border-l
                                            ${i === 0 ? 'rounded-l-[2px]' : ''}
                                            ${i === sortOptions.length - 1 ? 'rounded-r-[2px]' : ''}
                                            ${sortKey === opt.key
                                                ? 'bg-blue-900/60 text-blue-200 border border-blue-500 z-10'
                                                : 'bg-slate-800 text-gray-600 border-gray-800 hover:bg-slate-800'}`}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <div className="flex flex-col justify-center h-full pl-1">
                                <div className="text-[10px] text-gray-400 font-bold mb-0.5">SELECT 3 MOVES</div>
                                <div className="text-xs font-bold text-white truncate">{selectedMon.name}</div>
                            </div>
                        )}
                    </div>

                    {/* Right: Mode Tabs */}
                    <div className="w-[90px] flex gap-1 flex-shrink-0 h-full ml-1">
                        <button
                            onClick={() => setEditMode('monster')}
                            className={`flex-1 rounded-[2px] text-[10px] font-bold transition-all border flex flex-col items-center justify-center leading-none
                            ${editMode==='monster'
                                ? 'bg-blue-600 text-white border-blue-400'
                                : 'bg-slate-800 text-gray-500 border-slate-700 hover:bg-slate-700'}`}
                        >
                            MEMBER
                        </button>
                        <button
                            onClick={() => setEditMode('moves')}
                            className={`flex-1 rounded-[2px] text-[10px] font-bold transition-all border flex flex-col items-center justify-center leading-none
                            ${editMode==='moves'
                                ? 'bg-green-600 text-white border-green-400'
                                : 'bg-slate-800 text-gray-500 border-slate-700 hover:bg-slate-700'}`}
                        >
                            MOVES
                        </button>
                    </div>

                </div>

                {/* LIST AREA */}
                <div className="flex-1 overflow-y-auto custom-scroll p-2">
                    {editMode === 'monster' ? (
                        <div className="space-y-1">
                            <p className="text-[10px] text-gray-500 mb-1 font-bold flex justify-between px-1">
                                <span>AVAILABLE MONSTERS</span>
                                <span>{filteredMonsters.length} FOUND</span>
                            </p>
                            {filteredMonsters.map(mon => {
                                const inPartyIdx = myParty.findIndex(p => p.id === mon.id);
                                const isCurrent = myParty[selectedSlot]?.id === mon.id;
                                const isAlreadyInTeam = inPartyIdx !== -1 && !isCurrent;

                                return (
                                    <button
                                        key={mon.id}
                                        onClick={() => handleMemberChange(mon.id)}
                                        className={`w-full flex items-center gap-2 p-1.5 rounded-[2px] border text-left transition-all
                                        ${isCurrent
                                            ? 'bg-blue-900/30 border-blue-500 ring-1 ring-blue-500/50'
                                            : (isAlreadyInTeam
                                                ? 'bg-slate-900 border-slate-800 opacity-60'
                                                : 'bg-slate-900 border-slate-700 hover:bg-slate-800')}`}
                                    >
                                        <div className="w-10 h-10 bg-slate-800 rounded-[2px] flex items-center justify-center border border-slate-700 overflow-hidden relative flex-shrink-0">
                                            {mon.img ? (
                                                <img src={mon.img} className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                                            ) : (
                                                <span className="text-[8px] text-gray-600">IMG</span>
                                            )}
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <div className="flex justify-between items-center mb-0.5">
                                                <span className={`text-xs font-bold truncate ${isCurrent ? 'text-blue-200' : 'text-gray-300'}`}>
                                                    {mon.name}
                                                </span>
                                                {isAlreadyInTeam && (
                                                    <span className="text-[9px] bg-gray-700 px-1 rounded text-gray-400 border border-gray-600">Swap #{inPartyIdx+1}</span>
                                                )}
                                                {(inPartyIdx !== -1 && !isCurrent && !isAlreadyInTeam) && (
                                                    <span className="text-[10px] bg-gray-700 px-1 rounded text-gray-400">#{inPartyIdx+1}</span>
                                                )}
                                            </div>
                                            <div className="flex gap-2 text-[10px] text-gray-500 font-bold items-center">
                                                <span className={`text-[9px] px-1 rounded-[1px] text-white ${TYPE_BG[mon.type] || 'bg-gray-500'}`}>
                                                    {TYPE_NAMES[mon.type]}
                                                </span>
                                                <span className={sortKey === 'hp' ? 'text-green-400' : ''}>H:{mon.hp}</span>
                                                <span className={sortKey === 'atk' ? 'text-red-400' : ''}>A:{mon.atk}</span>
                                                <span className={sortKey === 'def' ? 'text-blue-400' : ''}>B:{mon.def}</span>
                                                <span className={sortKey === 'spd' ? 'text-yellow-400' : ''}>S:{mon.spd}</span>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                            {filteredMonsters.length === 0 && (
                                <div className="text-center text-gray-500 py-4 text-xs">NO MONSTERS FOUND</div>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-1">
                            <p className="text-[10px] text-gray-500 mb-1 font-bold flex justify-between px-1">
                                <span>LEARNABLE MOVES</span>
                                <span>{selectedMon.selectedMoves.length}/3 SELECTED</span>
                            </p>
                            {sortedMoves.map((moveName, i) => {
                                const isSelected = selectedMon.selectedMoves.includes(moveName);
                                const moveData = dbMoves[moveName] || { type: 'normal', power: 0, category: 'status', desc: '詳細不明' };

                                return (
                                    <button
                                        key={moveName}
                                        onClick={() => handleMoveToggle(moveName)}
                                        className={`w-full p-2 rounded-[2px] border flex justify-between items-center transition-all
                                        ${isSelected
                                            ? 'bg-green-900/20 border-green-600'
                                            : 'bg-slate-900 border-slate-800 opacity-60 hover:opacity-100 hover:border-slate-600'}`}
                                    >
                                        <div className="flex-1 text-left min-w-0">
                                            <div className="flex items-center gap-2 mb-0.5">
                                                <span className={`text-xs font-bold ${isSelected ? 'text-green-300' : 'text-gray-300'}`}>{moveName}</span>
                                                <span className={`text-[9px] px-1 rounded text-white ${TYPE_BG[moveData.type]}`}>{TYPE_NAMES[moveData.type]}</span>
                                            </div>
                                            <div className="text-[10px] text-gray-500 truncate">{moveData.desc}</div>
                                        </div>
                                        <div className="flex flex-col items-end pl-2 min-w-[50px]">
                                            {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_5px_lime] mb-1"></div>}
                                            <span className="text-[10px] text-gray-500 font-bold">POW:{moveData.power || '-'}</span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
window.TeamBuilder = TeamBuilder;