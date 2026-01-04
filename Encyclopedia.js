const { useState, useEffect } = React;
const { TYPE_BG, TYPE_NAMES, TYPES, db, auth } = window;
const { doc, getDoc, onAuthStateChanged } = window.fb;

// unlockedIds を受け取る (デフォルトは空配列)
const Encyclopedia = ({ onBack, dbMonsters, dbMoves, unlockedIds: propUnlockedIds = [] }) => {
    // 初期選択は確実に存在するID:1にする
    const [selectedId, setSelectedId] = useState(1);
    const [filterType, setFilterType] = useState('ALL');
    const [sortKey, setSortKey] = useState('ID');

    // ▼ 追加: 内部で保持する発見済みIDリスト (props または Firestoreから取得)
    const [localUnlockedIds, setLocalUnlockedIds] = useState(propUnlockedIds);

    // ▼ 追加: タイトル画面から開いた場合などのために、Firestoreからデータを取得して同期
    useEffect(() => {
        // propsですでに渡されている場合はそれを使う (AdventureHomeから遷移時など)
        if (propUnlockedIds.length > 0) {
            setLocalUnlockedIds(propUnlockedIds);
            return;
        }

        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                try {
                    const docRef = doc(db, "users", user.uid, "adventure", "save");
                    const docSnap = await getDoc(docRef);
                    if (docSnap.exists()) {
                        setLocalUnlockedIds(docSnap.data().seenIds || []);
                    }
                } catch (e) {
                    console.error("Failed to load encyclopedia data:", e);
                }
            }
        });
        return () => unsubscribe();
    }, [propUnlockedIds]);

    // 表示解禁チェック関数
    const checkUnlocked = (id) => {
        // 全てのモンスターを常に解禁（データを入れれば即座に反映）
        return true;
    };

    const selectedMonData = dbMonsters.find(m => m.id === selectedId);
    // 選択中のモンスターが解禁されているか判定
    const isSelectedUnlocked = selectedMonData && checkUnlocked(selectedMonData.id);

    // データ整理
    const filteredList = dbMonsters.filter(m => {
        if (m.id === 999) return false;
        if (filterType === 'ALL') return true;
        return m.type === filterType;
    }).sort((a, b) => {
        if (sortKey === 'ID') return a.id - b.id;
        // ネタバレ防止: ロックされているモンスターの情報でソートされると推測されるため、
        // ロックされている場合は「0」として扱うなどの配慮も可能ですが、
        // ここではUIの整合性を保つため既存ロジックを維持します（数値は見えません）
        return b[sortKey] - a[sortKey];
    });

    // 技データ取得 (解禁されている場合のみ)
    const monMoves = (isSelectedUnlocked && selectedMonData) ? (selectedMonData.moves || []) : [];

    const TYPES_LIST = Object.values(TYPES);

    return (
        <div className="flex flex-col h-full bg-slate-950 text-white font-zen overflow-hidden">
            {/* --- Header (Fixed) --- */}
            <div className="flex justify-between items-center p-3 border-b border-slate-800 bg-slate-900 flex-none z-20">
                <h2 className="text-xl font-teko tracking-widest text-blue-400">MONSTER DATA</h2>
                <button onClick={onBack} className="px-4 py-1 bg-gray-700 text-xs rounded font-bold hover:bg-gray-600 transition">BACK</button>
            </div>

            {/* --- Top Area: 詳細情報 + 技リスト --- */}
            <div className="flex-none max-h-[55%] overflow-y-auto bg-slate-900/50 border-b border-slate-800 custom-scroll">
                {isSelectedUnlocked && selectedMonData ? (
                    <>
                        <div className="p-4 pb-2">
                            <div className="flex gap-4 mb-2">
                                <div className="w-1/2 aspect-square bg-slate-900 rounded border border-slate-700 overflow-hidden relative shadow-lg flex-shrink-0">
                                    {selectedMonData.img ? (
                                        <img src={selectedMonData.img} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                    ) : (
                                        <div className={`w-full h-full opacity-30 ${TYPE_BG[selectedMonData.type] || 'bg-gray-800'}`}></div>
                                    )}
                                    <div className="absolute top-1 left-1 bg-black/60 px-2 rounded text-xs font-teko border border-slate-600">No.{selectedMonData.id.toString().padStart(3, '0')}</div>
                                </div>

                                <div className="w-1/2 flex flex-col justify-between">
                                    <div>
                                        <div className="flex justify-between items-end border-b border-slate-700 pb-1 mb-2">
                                            <span className="font-bold text-lg leading-none truncate">{selectedMonData.name}</span>
                                            <span className={`px-2 py-0.5 text-xs font-bold rounded text-white ${TYPE_BG[selectedMonData.type] || 'bg-gray-700'}`}>
                                                {TYPE_NAMES[selectedMonData.type]}
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-x-2 text-sm font-bold text-slate-300 mb-2">
                                            <span className="text-green-400">HP {selectedMonData.hp}</span>
                                            <span className="text-red-400">ATK {selectedMonData.atk}</span>
                                            <span className="text-blue-400">DEF {selectedMonData.def}</span>
                                            <span className="text-yellow-400">SPD {selectedMonData.spd}</span>
                                        </div>
                                        <div className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap line-clamp-5">
                                            {selectedMonData.desc || "No Data Available."}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* 技リスト */}
                        <div className="px-4 pb-4">
                             <div className="text-xs text-slate-500 font-bold mb-1 border-b border-slate-800">LEARNED MOVES</div>
                             {monMoves.map((moveName, i) => {
                                 // ★修正: dbMovesが存在するかチェック (クラッシュ防止)
                                 const move = dbMoves ? dbMoves[moveName] : null;
                                 if(!move) return null;
                                 return (
                                     <div key={i} className="mb-1 pb-1 border-b border-slate-800 last:border-0 last:mb-0 bg-slate-900/30 p-1 rounded">
                                         <div className="flex justify-between items-center mb-0.5">
                                             <div className="font-bold text-sm text-white">{moveName}</div>
                                             <div className="flex gap-2 items-center">
                                                 <span className={`text-[10px] px-2 py-0.5 rounded text-white font-bold ${TYPE_BG[move.type]}`}>{TYPE_NAMES[move.type]}</span>
                                                 <span className="text-xs font-bold text-slate-400">威力: {move.power || '-'}</span>
                                             </div>
                                         </div>
                                         <div className="text-[10px] text-slate-400">{move.desc}</div>
                                     </div>
                                 );
                             })}
                             {monMoves.length === 0 && <div className="text-xs text-slate-500">No moves data</div>}
                        </div>
                    </>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-600 min-h-[250px]">
                        <span className="text-4xl mb-2">🔒</span>
                        <span className="font-teko tracking-widest text-lg text-slate-400">UNKNOWN DATA</span>
                        <p className="text-xs text-slate-600 mt-1">このモンスターの情報はまだ記録されていません</p>
                    </div>
                )}
            </div>

            {/* --- Bottom Area: 検索エリア + キャラリスト --- */}
            <div className="flex-1 flex flex-col min-h-0 bg-slate-950">
                {/* 検索・ソート */}
                <div className="flex-none p-2 bg-slate-900 border-b border-slate-800 z-10 shadow">
                    <div className="flex gap-1 overflow-x-auto pb-2 scrollbar-hide mb-1">
                        <button onClick={() => setFilterType('ALL')} className={`px-3 py-1 rounded text-xs font-bold whitespace-nowrap transition ${filterType === 'ALL' ? 'bg-white text-black' : 'bg-slate-800 border border-slate-600 text-slate-400'}`}>ALL</button>
                        {TYPES_LIST.map(t => (
                            <button key={t} onClick={() => setFilterType(t)} className={`px-3 py-1 rounded text-xs font-bold whitespace-nowrap transition ${filterType === t ? 'bg-white text-black' : 'bg-slate-800 border border-slate-600 text-slate-400'}`}>{TYPE_NAMES[t]}</button>
                        ))}
                    </div>
                    <div className="flex gap-1">
                         {['ID', 'HP', 'ATK', 'DEF', 'SPD'].map(k => (
                             <button key={k} onClick={() => setSortKey(k)} className={`flex-1 py-1 rounded text-[10px] font-bold transition ${sortKey === k ? 'bg-blue-600 text-white' : 'bg-slate-800 border border-slate-600 text-slate-400'}`}>
                                {k}
                             </button>
                         ))}
                    </div>
                </div>

                {/* キャラリスト */}
                <div className="flex-1 overflow-y-auto p-2 custom-scroll bg-slate-950">
                     <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2 pb-8">
                        {filteredList.map(mon => {
                            // unlock判定
                            const isUnlocked = checkUnlocked(mon.id);

                            return (
                                <button
                                    key={mon.id}
                                    onClick={() => setSelectedId(mon.id)}
                                    className={`aspect-square relative rounded border transition-all overflow-hidden
                                        ${selectedId === mon.id ? 'border-yellow-400 ring-2 ring-yellow-400/50 z-10' : 'border-slate-700 opacity-70 hover:opacity-100 hover:border-slate-500'}
                                        ${!isUnlocked ? 'bg-slate-900' : ''}
                                    `}
                                >
                                    {isUnlocked ? (
                                        <>
                                            {mon.img ? <img src={mon.img} className="w-full h-full object-cover" loading="lazy" /> : <div className={`w-full h-full ${TYPE_BG[mon.type]} opacity-50`}></div>}
                                            <div className="absolute bottom-0 inset-x-0 bg-black/70 text-[9px] text-center text-white font-teko truncate px-1">
                                                {mon.name}
                                            </div>
                                            {sortKey !== 'ID' && (
                                                <div className="absolute top-0 right-0 bg-blue-600/90 text-white text-[9px] px-1 rounded-bl font-bold shadow">
                                                    {mon[sortKey.toLowerCase()]}
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        <div className="w-full h-full flex flex-col items-center justify-center">
                                            <span className="text-2xl text-slate-700">?</span>
                                            <div className="absolute bottom-0 inset-x-0 bg-black/70 text-[9px] text-center text-slate-500 font-teko truncate px-1">
                                                No.{mon.id}
                                            </div>
                                        </div>
                                    )}
                                </button>
                            );
                        })}
                     </div>
                </div>
            </div>
        </div>
    );
};

window.Encyclopedia = Encyclopedia;