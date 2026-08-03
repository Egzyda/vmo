const { useState, useEffect } = React;
const dbMonsters = window.dbMonsters;
const dbMoves = window.dbMoves;
const { Modal, OnlineLobby, Encyclopedia, TeamBuilder, MemberSelection, BattleEngine, optimizeEnemyLead } = window;

const App = () => {
    const [view, setView] = useState('loading');
    const loading = false;
    const error = null;

    const [myParty, setMyParty] = useState([]);
    const [enemyParty, setEnemyParty] = useState([]);
    const [showTutorial, setShowTutorial] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [resetConfirm, setResetConfirm] = useState(false);
    const [resetMsg, setResetMsg] = useState('');

    const [showDifficultySelect, setShowDifficultySelect] = useState(false);
    const [difficulty, setDifficulty] = useState('normal');

    const [initialMyField, setInitialMyField] = useState(null);
    const [initialEnemyField, setInitialEnemyField] = useState(null);
    const [savedTeams, setSavedTeams] = useState([[], [], []]);
    const [currentTeamIndex, setCurrentTeamIndex] = useState(0);
    const [onlineData, setOnlineData] = useState({ isOnline: false, roomId: null, role: null });

    useEffect(() => {
        window.scrollTo(0, 0);
    }, [view]);

    const [debugTapCount, setDebugTapCount] = useState(0);

    const createMonsterInstance = (id) => { const data = dbMonsters.find(m => m.id == id); if (!data) return null; return { ...data, uid: Math.random().toString(36).substr(2, 9), maxHp: data.hp, currentHp: data.hp, buffs: { atk: 0, def: 0, spd: 0 }, selectedMoves: data.moves.slice(0, 3), isDamaged: false, isProtected: false, protectStreak: 0, lastTakenDamage: 0, lastTakenDamageSource: null }; };

    // 1. 初心者向け
    const createBeginnerParty = () => {
        if (!dbMonsters || dbMonsters.length === 0) return [];
        // 修正: ID 999(ボス)を除外 かつ ID 24未満(クラシック)のみに限定
        const candidates = dbMonsters.filter(m => m.id != 999 && m.id < 24);
        const shuffled = [...candidates].sort(() => 0.5 - Math.random()).slice(0, 4);
        return shuffled.map(data => { const allMoves = data.moves || []; let attackMoves = allMoves.filter(m => { const md = dbMoves[m]; return md && md.category !== 'status' && m !== 'ラッシュ'; }); let selected = attackMoves.slice(0, 3); if (selected.length < 3) { if (allMoves.includes('ラッシュ') && !selected.includes('ラッシュ')) selected.push('ラッシュ'); const others = allMoves.filter(m => !selected.includes(m) && dbMoves[m]?.category === 'physical'); selected = [...selected, ...others].slice(0, 3); if (selected.length < 3) { const statusMoves = allMoves.filter(m => !selected.includes(m)); selected = [...selected, ...statusMoves].slice(0, 3); } } return { ...data, uid: Math.random().toString(36).substr(2, 9), maxHp: data.hp, currentHp: data.hp, buffs: { atk: 0, def: 0, spd: 0 }, selectedMoves: selected, isDamaged: false, isProtected: false, protectStreak: 0, lastTakenDamage: 0, lastTakenDamageSource: null }; });
    };

    // 2. ELITE向け (LV.2)
    const createEliteParty = () => {
        if (!dbMonsters || dbMonsters.length === 0) return [];

        const ELITE_TEAMS = [
            {
                name: "Speed Blitz",
                desc: "神速アグロ",
                members: [
                    { id: 6, moves: ['ソーンウィップ', 'カッターウィンド', 'プロテクション'] },
                    { id: 19, moves: ['キラーダイブ', 'アクアダッシュ', 'プロテクション'] },
                    { id: 1, moves: ['フレイムバースト', 'ヒートウェーブ', 'プロテクション'] },
                    { id: 13, moves: ['アクアストリーム', 'アイスホーン', 'プロテクション'] }
                ]
            },
            {
                name: "Iron Wall",
                desc: "重戦車タンク",
                members: [
                    { id: 3, moves: ['アクアストリーム', 'マッドウェーブ', 'プロテクション'] },
                    { id: 11, moves: ['フレイムバースト', 'ヒートウェーブ', 'プロテクション'] },
                    { id: 5, moves: ['ソーンウィップ', 'カッターウィンド', 'プロテクション'] },
                    { id: 14, moves: ['アクアストリーム', 'ハーフカット', 'プロテクション'] }
                ]
            },
            {
                name: "Distortion Heavy",
                desc: "空間歪曲・重火力",
                members: [
                    { id: 10, moves: ['ディストーション', 'ダークインパクト', 'プロテクション'] },
                    { id: 9, moves: ['ダークミスト', 'カースドノヴァ', 'プロテクション'] },
                    { id: 15, moves: ['グラスファング', 'カッターウィンド', 'プロテクション'] },
                    { id: 17, moves: ['ボルトクロー', 'フラッシュバン', 'プロテクション'] }
                ]
            },
            // ▼ 追加チーム1: 攻撃技オンリーの水雷物理 (Storm Front)
            {
                name: "Storm Front",
                desc: "轟雷・激流",
                members: [
                    { id: 13, moves: ['アクアストリーム', 'アイスホーン', 'プロテクション'] },
                    { id: 17, moves: ['ボルトクロー', 'フラッシュバン', 'プロテクション'] },
                    { id: 19, moves: ['キラーダイブ', 'アクアダッシュ', 'プロテクション'] },
                    { id: 4, moves: ['アクアストリーム', 'マッドウェーブ', 'プロテクション'] }
                ]
            },
            // ▼ 追加チーム2: 攻撃技オンリーの炎草物理 (Crimson Fang)
            {
                name: "Crimson Fang",
                desc: "紅蓮の牙",
                members: [
                    { id: 15, moves: ['グラスファング', 'カッターウィンド', 'プロテクション'] },
                    { id: 23, moves: ['ヘルブレード', 'ヒートウェーブ', 'プロテクション'] },
                    { id: 12, moves: ['フレイムバースト', 'ラッシュ', 'プロテクション'] },
                    { id: 5, moves: ['ソーンウィップ', 'カッターウィンド', 'プロテクション'] }
                ]
            }
        ];

        const teamPlan = ELITE_TEAMS[Math.floor(Math.random() * ELITE_TEAMS.length)];

        return teamPlan.members.map(memberDef => {
            const data = dbMonsters.find(m => m.id === memberDef.id);
            if (!data) return null;

            return {
                ...data,
                uid: Math.random().toString(36).substr(2, 9),
                maxHp: data.hp, currentHp: data.hp, buffs: { atk: 0, def: 0, spd: 0 },
                selectedMoves: memberDef.moves,
                isDamaged: false, isProtected: false, protectStreak: 0, lastTakenDamage: 0, lastTakenDamageSource: null
            };
        }).filter(m => m !== null);
    };

    // 3. MASTER向け (LV.3)
    const createMasterParty = () => {
        if (!dbMonsters || dbMonsters.length === 0) return [];

        const MASTER_TEAMS = [
            {
                name: "Aggro Rush",
                members: [
                    { id: 19, moves: ['キラーダイブ', 'プロテクション', 'パワーチャージ'] },
                    { id: 1, moves: ['フレイムバースト', 'プロテクション', 'アクセルステップ'] },
                    { id: 7, moves: ['ホーリーレイ', 'フラッシュバン', 'プロテクション'] },
                    { id: 13, moves: ['アクアストリーム', 'アイスホーン', 'プロテクション'] }
                ]
            },
            {
                name: "Synergy Blitz",
                members: [
                    { id: 6, moves: ['アクセルステップ', 'ヒールライト', 'ソーンウィップ'] },
                    { id: 13, moves: ['アイスホーン', 'アクセルステップ', 'ドレインホーン'] },
                    { id: 19, moves: ['キラーダイブ', 'パワーチャージ', 'プロテクション'] },
                    { id: 23, moves: ['ヘルブレード', 'ヒートウェーブ', 'プロテクション'] }
                ]
            },
            {
                name: "Distortion World",
                members: [
                    { id: 10, moves: ['ダークインパクト', 'ディストーション', 'プロテクション'] },
                    { id: 17, moves: ['プロテクション', 'ボルトクロー', 'パワーチャージ'] },
                    { id: 3, moves: ['アクアストリーム', 'アイアンシェル', 'プロテクション'] },
                    { id: 9, moves: ['ダークミスト', 'カースドノヴァ', 'プロテクション'] }
                ]
            },
            // ▼ 追加チーム1: 光属性中心＋加速 (Photon Saber)
            {
                name: "Photon Saber",
                members: [
                    { id: 24, moves: ['ホーリーレイ', 'アイスホーン', 'アクセルステップ'] },
                    { id: 7, moves: ['ホーリーレイ', '光速の爪', 'パワーチャージ'] },
                    { id: 16, moves: ['ハーフカット', 'ソーンウィップ', 'アクセルステップ'] },
                    { id: 18, moves: ['アルティメットレイ', 'ラッシュ', 'プロテクション'] }
                ]
            },
            // ▼ 追加チーム2: 異次元の怪力 (Dimension Power)
            {
                name: "Dimension Power",
                members: [
                    { id: 10, moves: ['ディストーション', 'ダークインパクト', 'プロテクション'] },
                    { id: 11, moves: ['マグマブロック', 'パワーチャージ', 'プロテクション'] },
                    { id: 20, moves: ['ドレインホーン', 'アイアンシェル', 'プロテクション'] },
                    { id: 15, moves: ['グラスファング', 'パワーチャージ', 'プロテクション'] }
                ]
            }
        ];

        const teamPlan = MASTER_TEAMS[Math.floor(Math.random() * MASTER_TEAMS.length)];

        return teamPlan.members.map(memberDef => {
            const data = dbMonsters.find(m => m.id === memberDef.id);
            if (!data) return null;

            return {
                ...data,
                uid: Math.random().toString(36).substr(2, 9),
                maxHp: data.hp, currentHp: data.hp, buffs: { atk: 0, def: 0, spd: 0 },
                selectedMoves: memberDef.moves,
                isDamaged: false, isProtected: false, protectStreak: 0, lastTakenDamage: 0, lastTakenDamageSource: null
            };
        }).filter(m => m !== null);
    };

    const createEnemyParty = (difficulty) => {
        if (difficulty === 'master') {
            return createMasterParty();
        } else if (difficulty === 'elite') {
            return createEliteParty();
        } else {
            return createBeginnerParty();
        }
    };

    useEffect(() => {
        if (!loading && dbMonsters.length > 0) {
            const loadTeams = () => {
                const saved = localStorage.getItem('versus_monsters_teams');
                if (saved) {
                    try {
                        const parsed = JSON.parse(saved);
                        if (parsed.length === 3) {
                            return parsed.map((team, tIdx) => {
                                const hasVersus = team.some(m => m.id === 999);
                                if (hasVersus) return null;
                                return team.map(mon => {
                                    const latestData = dbMonsters.find(dbMon => dbMon.id == mon.id);
                                    if (!latestData) return mon;
                                    const validMoves = mon.selectedMoves
                                        .map(m => m === 'ヒートウェイブ' ? 'ヒートウェーブ' : m)
                                        .filter(m => dbMoves[m] && latestData.moves.includes(m));
                                    const safeMoves = validMoves.length > 0 ? validMoves : latestData.moves.slice(0, 3);
                                    return {
                                        ...mon,
                                        name: latestData.name,
                                        img: latestData.img,
                                        // type は必ず最新データで上書きする。
                                        // 旧セーブは絵文字ID（🔥等）を保持しており、放置すると相性判定が壊れる
                                        type: latestData.type,
                                        maxHp: latestData.hp,
                                        atk: latestData.atk,
                                        def: latestData.def,
                                        spd: latestData.spd,
                                        selectedMoves: safeMoves,
                                        protectStreak: 0,
                                        lastTakenDamage: 0,
                                        buffs: { atk: 0, def: 0, spd: 0 }
                                    };
                                });
                            });
                        }
                    } catch (e) { }
                }
                const t1 = [1, 3, 5, 7].map(createMonsterInstance).filter(m => m !== null);
                const t2 = [2, 4, 9, 10].map(createMonsterInstance).filter(m => m !== null);
                const t3 = [1, 2, 8, 9].map(createMonsterInstance).filter(m => m !== null);
                return [t1, t2, t3];
            };

            const loaded = loadTeams();
            const t1Def = [1, 3, 5, 7].map(createMonsterInstance).filter(m => m !== null);
            const t2Def = [2, 4, 9, 10].map(createMonsterInstance).filter(m => m !== null);
            const t3Def = [1, 2, 8, 9].map(createMonsterInstance).filter(m => m !== null);
            const defaults = [t1Def, t2Def, t3Def];

            const finalTeams = loaded.map((team, i) => team || defaults[i]);

            setSavedTeams(finalTeams);
            setMyParty(finalTeams[0]);
            setEnemyParty(createBeginnerParty());
            setView('title');
        }
    }, [loading, dbMonsters, dbMoves]);

    const updateTeam = (index, newParty) => { const newTeams = [...savedTeams]; newTeams[index] = newParty; setSavedTeams(newTeams); setMyParty(newParty); localStorage.setItem('versus_monsters_teams', JSON.stringify(newTeams)); };

    const handleDifficultySelect = (selectedDiff) => {
        setDifficulty(selectedDiff);
        const enemy = createEnemyParty(selectedDiff);
        setEnemyParty(enemy);
        setShowDifficultySelect(false);
        setOnlineData({ isOnline: false, roomId: null, role: null });
        setView('selection');
    };

    const handleOnlineStart = ({ roomId, role }) => { setOnlineData({ isOnline: true, roomId, role }); setView('selection'); };

    const handleBattleStart = (myF, enemyF, onlineMyP, onlineEnP) => {
        setInitialMyField(myF);
        setInitialEnemyField(enemyF);
        if (onlineMyP) setMyParty(onlineMyP);
        if (onlineEnP) setEnemyParty(onlineEnP);
        setView('battle');
    };

    // ホーム画面に追加したPWAはキャッシュを掴んだまま更新されないため、
    // URLに ?v=<時刻> を付けて読み込み直す（index.html側が各JSのURLへ伝播させる）。
    // Cache Storage も念のため消す。セーブはlocalStorage/Firestoreなので消えない。
    const forceUpdate = async () => {
        try {
            if (window.caches && caches.keys) {
                const keys = await caches.keys();
                await Promise.all(keys.map(k => caches.delete(k)));
            }
        } catch (e) { /* 失敗しても再読み込みは続行する */ }
        const base = location.origin + location.pathname;
        location.replace(base + '?v=' + Date.now());
    };

    // 更新が反映されたか確認できるよう、HTMLの最終更新時刻を出す
    const buildStamp = (() => {
        try {
            const d = new Date(document.lastModified);
            if (isNaN(d.getTime())) return '';
            const p = n => String(n).padStart(2, '0');
            return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
        } catch (e) { return ''; }
    })();

    const handleVersionTap = () => {
        const nextCount = debugTapCount + 1;
        setDebugTapCount(nextCount);
        if (nextCount === 5) {
            let versusData = dbMonsters.find(m => m.id === 999);
            if (!versusData) { alert("エラー: ID:999 (ヴァーサス) のデータがFirestoreに見つかりません。"); setDebugTapCount(0); return; }
            const versusInstance = { ...versusData, uid: Math.random().toString(36).substr(2, 9), maxHp: versusData.hp, currentHp: versusData.hp, buffs: { atk: 0, def: 0, spd: 0 }, selectedMoves: versusData.moves.slice(0, 3), isDamaged: false, isProtected: false, protectStreak: 0, lastTakenDamage: 0, lastTakenDamageSource: null };
            const newTeams = [...savedTeams];
            const currentTeam3 = newTeams[2] || [];
            const otherMembers = currentTeam3.filter(m => m.id !== 999);
            const updatedTeam3 = [versusInstance, ...otherMembers].slice(0, 4);
            newTeams[2] = updatedTeam3;
            setSavedTeams(newTeams);
            localStorage.setItem('versus_monsters_teams', JSON.stringify(newTeams));
            alert("⚠️ ADMIN MODE ACTIVATED ⚠️\nTEAM 3 の先頭に ヴァーサス(GENESIS) を追加しました。");
            setDebugTapCount(0);
        }
    };

    if (loading) return <div className="app-container flex items-center justify-center bg-slate-900 text-white flex-col gap-4"><div className="loading-spinner"></div><div className="font-teko tracking-widest">LOADING DATA...</div></div>;
    if (error) return <div className="app-container flex items-center justify-center text-red-500">Error: {error.message}</div>;

    return (
        <div className="app-container">
            <div className="absolute inset-0 scanline z-50 pointer-events-none"></div>

            {showSettings && (
                <Modal title="SETTINGS" onClose={() => { setShowSettings(false); setResetMsg(''); }}>
                    <div className="space-y-4 font-zen pr-2">
                        <div className="border-l-4 border-slate-500 pl-3">
                            <h4 className="font-bold text-slate-300 text-lg mb-1 font-teko tracking-wider">DATA</h4>
                            <p className="text-xs text-slate-400 mb-3">
                                アドベンチャーモードの進行データ（手持ち・レベル・所持金・攻略状況・図鑑）を削除して、最初からやり直します。<br />
                                <span className="text-slate-500">対戦モードのチーム編成は消えません。</span>
                            </p>

                            {resetMsg ? (
                                <div className="text-xs text-cyan-300 bg-cyan-950/40 border border-cyan-700 rounded px-3 py-2">{resetMsg}</div>
                            ) : !resetConfirm ? (
                                <button onClick={() => setResetConfirm(true)}
                                    className="w-full py-2 rounded bg-red-900/60 border border-red-600 text-red-200 text-sm font-bold hover:bg-red-800/60">
                                    アドベンチャーのデータを削除
                                </button>
                            ) : (
                                <div className="space-y-2">
                                    <div className="text-xs text-red-300 bg-red-950/50 border border-red-700 rounded px-3 py-2">
                                        本当に削除しますか？ この操作は取り消せません。
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button onClick={() => setResetConfirm(false)}
                                            className="py-2 rounded bg-slate-700 text-slate-200 text-sm font-bold">キャンセル</button>
                                        <button onClick={async () => {
                                            const r = await window.deleteAdventureSave();
                                            setResetConfirm(false);
                                            setResetMsg(r.ok
                                                ? '削除しました。ADVENTURE MODE を開くと最初から始まります。'
                                                : '端末のデータは削除しましたが、クラウド側の初期化に失敗しました。通信状態を確認してもう一度お試しください。');
                                        }}
                                            className="py-2 rounded bg-red-700 text-white text-sm font-bold">削除する</button>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="border-l-4 border-slate-700 pl-3">
                            <h4 className="font-bold text-slate-400 text-sm mb-1 font-teko tracking-wider">BUILD</h4>
                            <p className="text-[11px] text-slate-500">
                                VER 4.1.0<br />
                                最終更新: {buildStamp || '不明'}
                            </p>
                            <button onClick={forceUpdate}
                                className="w-full mt-2 py-2 rounded bg-slate-700 border border-slate-500 text-slate-100 text-sm font-bold hover:bg-slate-600">
                                ↻ 最新版に更新
                            </button>
                        </div>
                    </div>
                </Modal>
            )}

            {showTutorial && (
                <Modal title="SYSTEM GUIDE: ADVANCED" onClose={() => setShowTutorial(false)}>
                    <div className="space-y-6 font-zen pr-2">

                        {/* 1. イントロダクション */}
                        <div className="border-l-4 border-blue-500 pl-3">
                            <h4 className="font-bold text-blue-400 text-lg mb-1 font-teko tracking-wider">01. INTRODUCTION</h4>
                            <p className="text-xs text-gray-300 leading-relaxed">
                                電脳空間「VMO アリーナ」へようこそ。<br />
                                ここは戦うために創造されたモンスターを使役する戦術シミュレーターです。<br />
                                4体のチームから2体を選出し、相手を全滅させれば勝利となります。
                            </p>
                        </div>

                        {/* 2. ダメージ計算式 */}
                        <div className="border-l-4 border-red-500 pl-3">
                            <h4 className="font-bold text-red-400 text-lg mb-1 font-teko tracking-wider">02. DAMAGE FORMULA</h4>
                            <div className="bg-slate-800 p-2 rounded border border-slate-700 font-mono text-[10px] text-gray-300 mb-2">
                                Damage = floor( (ATK × Power ÷ DEF ÷ 2) × TypeMod × Random(0.9~1.0) )
                            </div>
                            <ul className="text-xs text-gray-400 space-y-1 list-disc list-inside">
                                <li><span className="text-white">ATK/DEF</span>: バフ補正後の数値を使用</li>
                                <li><span className="text-white">TypeMod</span>: 属性相性倍率 (下記参照)</li>
                                <li><span className="text-white">Random</span>: 最終ダメージは90%〜100%の間で変動</li>
                            </ul>
                        </div>

                        {/* 3. 属性相性 (TYPE CHART) */}
                        <div className="border-l-4 border-yellow-500 pl-3">
                            <h4 className="font-bold text-yellow-400 text-lg mb-1 font-teko tracking-wider">03. TYPE CHART</h4>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="bg-slate-800 p-2 rounded">
                                    <span className="text-red-400 font-bold">WEAKNESS (x1.5 Damage)</span>
                                    <ul className="mt-1 space-y-0.5 text-gray-300">
                                        <li>炎 <span className="text-gray-500">→</span> 草 (炎は草に強い)</li>
                                        <li>草 <span className="text-gray-500">→</span> 水 (草は水に強い)</li>
                                        <li>水 <span className="text-gray-500">→</span> 炎 (水は炎に強い)</li>
                                        <li>光 <span className="text-gray-500">⇄</span> 闇 (光と闇は互いに弱点)</li>
                                    </ul>
                                </div>
                                <div className="bg-slate-800 p-2 rounded">
                                    <span className="text-blue-400 font-bold">RESISTANCE (x0.5 Damage)</span>
                                    <p className="mt-1 text-gray-300 leading-tight">
                                        攻撃側と同じ属性、または耐性属性で受けるとダメージ半減。<br />
                                        <span className="text-[10px] text-gray-500 mt-1 block">例: 炎技を炎モンスターが受けると0.5倍</span>
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* 4. 行動順と優先度 */}
                        <div className="border-l-4 border-purple-500 pl-3">
                            <h4 className="font-bold text-purple-400 text-lg mb-1 font-teko tracking-wider">04. SPEED & PRIORITY</h4>
                            <p className="text-xs text-gray-300 mb-2">行動順は以下の優先順位で決定されます。</p>
                            <ol className="list-decimal list-inside text-xs text-gray-300 space-y-1 bg-slate-800 p-2 rounded">
                                <li><span className="text-yellow-400">技の優先度 (Priority)</span> <span className="text-gray-500 text-[10px]">例：プロテクション(+4) ＞ 先制技(+1) ＞ 通常(0)</span></li>
                                <li><span className="text-green-400">SPDステータス</span> <span className="text-gray-500 text-[10px]">バフ/デバフ補正を含む実数値</span></li>
                                <li><span className="text-gray-400">乱数</span> <span className="text-gray-500 text-[10px]">同速の場合はランダム</span></li>
                            </ol>
                            <div className="mt-2 text-[10px] text-purple-300 border border-purple-500/30 bg-purple-900/20 p-1.5 rounded">
                                <strong>⚠️ FIELD EFFECT: DISTORTION</strong><br />
                                「ディストーション」発動中(5ターン)は、SPD順序が逆転します。<br />
                                (遅いモンスターが先制。ただし技の優先度は維持されます)
                            </div>
                        </div>

                        {/* 5. 能力ランク補正 */}
                        <div className="border-l-4 border-green-500 pl-3">
                            <h4 className="font-bold text-green-400 text-lg mb-1 font-teko tracking-wider">05. STAT BUFFS</h4>
                            <p className="text-xs text-gray-300 mb-2">ステータス変化は最大±2段階まで蓄積します。</p>
                            <div className="flex justify-between text-center bg-slate-800 rounded p-2 text-xs">
                                <div>
                                    <div className="text-red-400 font-bold">-2</div>
                                    <div className="text-gray-400">x0.5</div>
                                </div>
                                <div>
                                    <div className="text-red-300 font-bold">-1</div>
                                    <div className="text-gray-400">x0.75</div>
                                </div>
                                <div>
                                    <div className="text-white font-bold">0</div>
                                    <div className="text-gray-400">x1.0</div>
                                </div>
                                <div>
                                    <div className="text-green-300 font-bold">+1</div>
                                    <div className="text-gray-400">x1.5</div>
                                </div>
                                <div>
                                    <div className="text-green-400 font-bold">+2</div>
                                    <div className="text-gray-400">x2.0</div>
                                </div>
                            </div>
                        </div>

                    </div>
                </Modal>
            )}
            {view === 'title' && (
                <div className="w-full h-full relative overflow-hidden bg-black font-zen text-white select-none flex flex-col items-center justify-center p-6">
                    {/* 背景画像レイヤー */}
                    <div className="absolute inset-0 z-0">
                        <img src="./img/menu_bg.png" className="w-full h-full object-cover opacity-80" alt="Cyber Background" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/60 mix-blend-multiply"></div>
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.8)_100%)]"></div>
                    </div>

                    {/* スキャンライン & グリッチエフェクト (Shared from Global CSS usually, but adding specifics here if needed) */}
                    <div className="absolute inset-0 z-10 pointer-events-none bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%] opacity-20"></div>

                    {/* コンテンツレイヤー */}
                    <div className="relative z-20 w-full flex flex-col items-center justify-center">

                        {/* タイトルロゴエリア */}
                        <div className="mb-8 md:mb-12 relative group cursor-default text-center">
                            <h1 className="text-7xl md:text-8xl font-teko font-bold tracking-widest text-transparent bg-clip-text bg-gradient-to-b from-white via-cyan-100 to-cyan-500 relative z-10 leading-[0.85] filter drop-shadow-[0_0_10px_rgba(34,211,238,0.8)]">
                                VERSUS<br />
                                <span className="text-5xl md:text-6xl tracking-[0.2em] bg-clip-text bg-gradient-to-br from-cyan-400 to-purple-500">MONSTERS</span>
                            </h1>

                            {/* ゴースト/グリッチレイヤー */}
                            <h1 className="absolute inset-0 text-7xl md:text-8xl font-teko font-bold tracking-widest text-red-500 opacity-40 blur-[1px] animate-pulse leading-[0.85] translate-x-1 select-none pointer-events-none mix-blend-screen">
                                VERSUS<br /><span className="text-5xl md:text-6xl tracking-[0.2em]">MONSTERS</span>
                            </h1>
                            <h1 className="absolute inset-0 text-7xl md:text-8xl font-teko font-bold tracking-widest text-blue-500 opacity-40 blur-[1px] animate-pulse delay-75 leading-[0.85] -translate-x-1 select-none pointer-events-none mix-blend-screen">
                                VERSUS<br /><span className="text-5xl md:text-6xl tracking-[0.2em]">MONSTERS</span>
                            </h1>

                            <p className="text-cyan-400/80 mt-4 font-teko tracking-[0.5em] text-xs text-center border-t border-cyan-500/30 pt-2 w-full max-w-xs mx-auto uppercase">
                                Tactical Battle Simulation
                            </p>
                        </div>

                        {/* メニューボタンエリア */}
                        <div className="w-full max-w-sm space-y-3 perspective-1000">

                            {/* Adventure Mode */}
                            <button onClick={() => setView('adventure')} className="group relative w-full py-4 bg-slate-900/40 backdrop-blur-md border border-amber-500/30 rounded overflow-hidden transition-all duration-300 hover:scale-105 hover:bg-amber-900/30 hover:border-amber-400 hover:shadow-[0_0_20px_rgba(245,158,11,0.3)]">
                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-400/10 to-transparent -translate-x-full group-hover:animate-shine"></div>
                                <div className="flex items-center justify-center gap-3">
                                    <span className="w-1.5 h-1.5 bg-amber-400 rounded-full shadow-[0_0_5px_orange]"></span>
                                    <span className="font-teko text-2xl font-bold tracking-widest text-amber-100 group-hover:text-white">ADVENTURE MODE</span>
                                    <span className="w-1.5 h-1.5 bg-amber-400 rounded-full shadow-[0_0_5px_orange]"></span>
                                </div>
                            </button>

                            {/* Single Battle */}
                            <button onClick={() => setShowDifficultySelect(true)} className="group relative w-full py-4 bg-slate-900/40 backdrop-blur-md border border-cyan-500/30 rounded overflow-hidden transition-all duration-300 hover:scale-105 hover:bg-cyan-900/30 hover:border-cyan-400 hover:shadow-[0_0_20px_rgba(34,211,238,0.3)]">
                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-cyan-400/10 to-transparent -translate-x-full group-hover:animate-shine"></div>
                                <div className="flex items-center justify-center gap-3">
                                    <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full shadow-[0_0_5px_cyan]"></span>
                                    <span className="font-teko text-2xl font-bold tracking-widest text-cyan-100 group-hover:text-white">SINGLE BATTLE</span>
                                    <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full shadow-[0_0_5px_cyan]"></span>
                                </div>
                            </button>

                            {/* Online Battle */}
                            <button onClick={() => setView('online_lobby')} className="group relative w-full py-4 bg-slate-900/40 backdrop-blur-md border border-purple-500/30 rounded overflow-hidden transition-all duration-300 hover:scale-105 hover:bg-purple-900/30 hover:border-purple-400 hover:shadow-[0_0_20px_rgba(168,85,247,0.3)]">
                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-purple-400/10 to-transparent -translate-x-full group-hover:animate-shine"></div>
                                <div className="flex items-center justify-center gap-3">
                                    <span className="w-1.5 h-1.5 bg-purple-400 rounded-full shadow-[0_0_5px_purple]"></span>
                                    <span className="font-teko text-2xl font-bold tracking-widest text-purple-100 group-hover:text-white">ONLINE BATTLE</span>
                                    <span className="w-1.5 h-1.5 bg-purple-400 rounded-full shadow-[0_0_5px_purple]"></span>
                                </div>
                            </button>

                            {/* Sub Menus */}
                            <div className="grid grid-cols-2 gap-2 pt-1">
                                <button onClick={() => setView('team')} className="py-3 bg-slate-900/30 border border-slate-600/50 rounded hover:bg-slate-800/50 hover:border-slate-400 hover:text-white text-slate-400 font-teko tracking-wider text-lg transition-all">
                                    TEAM EDIT
                                </button>
                                <button onClick={() => setView('encyclopedia')} className="py-3 bg-slate-900/30 border border-slate-600/50 rounded hover:bg-slate-800/50 hover:border-slate-400 hover:text-white text-slate-400 font-teko tracking-wider text-lg transition-all">
                                    MONSTER DATA
                                </button>
                            </div>

                            <div className="grid grid-cols-3 gap-2 mt-1">
                                <button onClick={() => setShowTutorial(true)} className="py-2 text-slate-500 text-xs font-teko tracking-[0.1em] hover:text-cyan-400 transition-colors uppercase">
                                    Guide
                                </button>
                                <button onClick={() => { setResetConfirm(false); setShowSettings(true); }} className="py-2 text-slate-500 text-xs font-teko tracking-[0.1em] hover:text-slate-200 transition-colors uppercase">
                                    ⚙ 設定
                                </button>
                                <button onClick={forceUpdate} className="py-2 text-slate-500 text-xs font-teko tracking-[0.1em] hover:text-amber-400 transition-colors uppercase">
                                    ↻ 更新
                                </button>
                            </div>

                        </div>

                        <div onClick={handleVersionTap} className="absolute -bottom-8 text-[10px] text-gray-600 font-teko cursor-pointer select-none active:text-gray-400 text-center leading-tight">
                            VER 4.1.0 - Full Unlock<br />
                            <span className="text-[9px] text-gray-700">{buildStamp}</span>
                        </div>
                    </div>
                </div>
            )}

            {showDifficultySelect && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="w-full max-w-sm bg-slate-900 border border-gray-700 rounded-lg p-6 shadow-2xl relative overflow-hidden animate-fade-in-up">
                        <h2 className="text-2xl font-teko text-white text-center mb-6 tracking-widest">SELECT DIFFICULTY</h2>
                        <div className="space-y-3">
                            <button onClick={() => handleDifficultySelect('normal')} className="w-full group relative overflow-hidden rounded border border-blue-500/30 bg-slate-800 p-3 text-left transition hover:border-blue-500 hover:bg-slate-700">
                                <div className="flex items-center justify-between"><span className="font-teko text-xl text-blue-400 group-hover:text-blue-300">NORMAL</span><span className="text-xs font-bold text-gray-500 group-hover:text-gray-300">LV.1</span></div>
                                <p className="text-[10px] text-gray-500 mt-0.5 font-zen">ランダムな敵 / 練習用</p>
                            </button>
                            <button onClick={() => handleDifficultySelect('elite')} className="w-full group relative overflow-hidden rounded border border-yellow-500/30 bg-slate-800 p-3 text-left transition hover:border-yellow-500 hover:bg-slate-700">
                                <div className="flex items-center justify-between"><span className="font-teko text-xl text-yellow-400 group-hover:text-yellow-300">ELITE</span><span className="text-xs font-bold text-yellow-600 group-hover:text-yellow-500">LV.2</span></div>
                                <p className="text-[10px] text-gray-500 mt-0.5 font-zen">ガチ構成 / ルールベースAI</p>
                            </button>
                            <button onClick={() => handleDifficultySelect('master')} className="w-full group relative overflow-hidden rounded border border-red-500/30 bg-slate-800 p-3 text-left transition hover:border-red-500 hover:bg-slate-700 hover:shadow-[0_0_15px_rgba(239,68,68,0.5)]">
                                <div className="absolute -right-6 -top-6 h-16 w-16 rotate-45 bg-red-600/10 group-hover:bg-red-600/20 transition-all"></div>
                                <div className="flex items-center justify-between relative z-10"><span className="font-teko text-xl text-red-400 group-hover:text-red-300">MASTER</span><span className="text-xs font-bold text-red-500 group-hover:text-red-400 animate-pulse">GEMINI AI</span></div>
                                <p className="text-[10px] text-gray-500 mt-0.5 relative z-10 font-zen">最強AI / 君の最強パーティーが通用するか</p>
                            </button>
                        </div>
                        <button onClick={() => setShowDifficultySelect(false)} className="mt-6 w-full py-2 text-xs font-bold text-gray-500 hover:text-white transition">CANCEL</button>
                    </div>
                </div>
            )}

            {view === 'adventure' && <window.AdventureMode onBack={() => setView('title')} dbMonsters={dbMonsters} dbMoves={dbMoves} />}
            {view === 'online_lobby' && <OnlineLobby onBack={() => setView('title')} onGameStart={handleOnlineStart} />}
            {view === 'encyclopedia' && <Encyclopedia onBack={() => setView('title')} dbMonsters={dbMonsters} dbMoves={dbMoves} />}
            {view === 'team' && <TeamBuilder savedTeams={savedTeams} currentTeamIndex={currentTeamIndex} setCurrentTeamIndex={setCurrentTeamIndex} updateTeam={updateTeam} onBack={() => setView('title')} dbMonsters={dbMonsters} dbMoves={dbMoves} />}
            {view === 'selection' && <MemberSelection
                myParty={myParty}
                enemyParty={enemyParty}
                onComplete={handleBattleStart}
                onBack={() => setView('title')}
                isOnline={onlineData.isOnline}
                roomId={onlineData.roomId}
                role={onlineData.role}
                difficulty={difficulty}
            />}

            {view === 'battle' && <BattleEngine myParty={myParty} enemyParty={enemyParty} initialMyField={initialMyField} initialEnemyField={initialEnemyField} onExit={() => setView('title')} dbMoves={dbMoves} isOnline={onlineData.isOnline} roomId={onlineData.roomId} role={onlineData.role} dbMonsters={dbMonsters} difficulty={difficulty} />}

            {/* ▼ 修正: dbMovesを渡す */}
            {/* Adventureは現在無効化されています */}
        </div>
    );
};

window.App = App;