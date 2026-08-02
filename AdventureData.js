// AdventureData.js - アドベンチャーモードの全データ・純ロジック
// SPEC.md 第4章に対応。対戦モードのデータ/ロジックには一切触れない。

// ============================================================
// 1. 下位技（SPEC 2.3）
// ============================================================
const STARTER_MOVES = window.STARTER_MOVES = {
    fire: "プチファイア",
    water: "アクアショット",
    grass: "リーフショット",
    light: "ミニレイ",
    dark: "シャドウタッチ",
    normal: "タックル"
};

// ============================================================
// 2. レベル / 経験値（SPEC 4.3, 4.4）
// ============================================================
const MAX_LEVEL = window.MAX_LEVEL = 100;

const getLevelMultiplier = window.getLevelMultiplier = (level) => {
    // Lv1=0.3, Lv100=1.0
    // SPEC の 0.007 刻みだと Lv100 で 0.993 にしかならず、
    // カンストしても種族値に届かない（PvPの数値と一致しない）ため 0.7/99 で刻む
    const lv = Math.max(1, Math.min(MAX_LEVEL, level));
    return 0.3 + (lv - 1) * (0.7 / (MAX_LEVEL - 1));
};

const getRequiredExp = window.getRequiredExp = (level) => {
    return Math.floor(10 * Math.pow(level, 1.8));
};

const getBaseExp = window.getBaseExp = (enemyLevel) => {
    return 10 + enemyLevel * 5;
};

// 自分が格上の場合は指数関数的になだらかに減衰（diff=-10で概ね1/7、下限0.02）
const EXP_DECAY_BASE = Math.pow(1 / 7, 1 / 10);

const getExpMultiplier = window.getExpMultiplier = (myLevel, enemyLevel) => {
    const diff = enemyLevel - myLevel; // 正の値＝相手が格上（美味しい）
    if (diff >= 10) return 3.0;
    if (diff >= 5) return 2.0;
    if (diff >= 1) return 1.5;
    if (diff === 0) return 1.0;
    return Math.max(0.02, Math.pow(EXP_DECAY_BASE, -diff));
};

const getExp = window.getExp = (baseExp, myLevel, enemyLevel) => {
    return Math.max(1, Math.floor(baseExp * getExpMultiplier(myLevel, enemyLevel)));
};

// 所持金ドロップ（SPEC 4.6）
const getDropMoney = window.getDropMoney = (enemyLevel, rng = Math.random) => {
    const base = 50 + enemyLevel * 10;
    const variance = Math.floor(base * 0.2);
    return base + Math.floor(rng() * variance * 2) - variance;
};

// ============================================================
// 3. 技習得（SPEC 4.14）
// ============================================================
const MOVE_LEARN_CHECKPOINTS = window.MOVE_LEARN_CHECKPOINTS = [3, 9, 15, 21, 27];

// 攻撃技を先に並べた候補順（敵の自動編成・途中加入の自動習得に使う）
const getAutoMoveOrder = window.getAutoMoveOrder = (monster, dbMoves) => {
    return [...(monster.moves || [])].sort((a, b) => {
        const aStatus = dbMoves[a] && dbMoves[a].category === 'status' ? 1 : 0;
        const bStatus = dbMoves[b] && dbMoves[b].category === 'status' ? 1 : 0;
        return aStatus - bStatus;
    });
};

// 捕獲直後に知っている技。通過済みチェックポイント分を自動習得済みにする
const getKnownMovesOnCapture = window.getKnownMovesOnCapture = (monster, level, dbMoves) => {
    const passed = MOVE_LEARN_CHECKPOINTS.filter(lv => level >= lv).length;
    const starter = STARTER_MOVES[monster.type];
    return [starter, ...getAutoMoveOrder(monster, dbMoves).slice(0, passed)];
};

// レベルアップでチェックポイントを跨いだか（跨いだなら習得選択を出す）
const getNewlyReachedCheckpoints = window.getNewlyReachedCheckpoints = (oldLevel, newLevel) => {
    return MOVE_LEARN_CHECKPOINTS.filter(lv => oldLevel < lv && newLevel >= lv);
};

// まだ覚えていない候補技（習得選択の選択肢）
const getLearnableMoves = window.getLearnableMoves = (monster, knownMoves) => {
    return (monster.moves || []).filter(m => !knownMoves.includes(m));
};

// ============================================================
// 4. 敵の技構成（SPEC 4.15, 4.16）
// ============================================================

// 野生の雑魚: フロアの深さ（潜った階数 floorPosition, 1始まり）で構成が決まる
const getWildMoveSet = window.getWildMoveSet = (monster, floorPosition, dbMoves, rng = Math.random) => {
    const starter = STARTER_MOVES[monster.type];
    if (floorPosition <= 1) return [starter];

    const pool = monster.moves || [];
    // 1→10階目で 0→6 に線形解放
    const realCount = Math.min(pool.length, Math.round((floorPosition - 1) / 9 * 6));
    const shuffled = [...pool].sort(() => rng() - 0.5);
    const realMoves = shuffled.slice(0, Math.min(3, realCount || 1));

    if (floorPosition < 15) return [starter, ...realMoves].slice(0, 3);
    return realMoves.length ? realMoves : [starter]; // 15階目以降は下位技を使わない
};

// エリート/ボス: 威力順の攻撃技2つ + 補助技1つを機械的に自動編成
const getEliteMoves = window.getEliteMoves = (monster, level, dbMoves) => {
    const starter = STARTER_MOVES[monster.type];
    // 下位技はエリート/ボスの枠を埋めるだけの弱技なので除外する
    // （残りが無くなる場合のみフォールバックとして使う）
    const known = getKnownMovesOnCapture(monster, level, dbMoves).filter(m => m !== starter);

    const attack = known
        .filter(m => dbMoves[m] && dbMoves[m].category !== 'status')
        .sort((a, b) => (dbMoves[b].power || 0) - (dbMoves[a].power || 0));
    const support = known.filter(m => dbMoves[m] && dbMoves[m].category === 'status');

    const equipped = attack.slice(0, 2);
    const third = support[0] || attack[2];
    if (third) equipped.push(third);
    return equipped.length ? equipped : [starter];
};

// ステータス補正（SPEC 4.10）
const ENEMY_STAT_MULTIPLIERS = window.ENEMY_STAT_MULTIPLIERS = {
    normal: 1.0,
    elite: 1.2,
    boss: 1.5
};

// ============================================================
// 5. 探索ノード（SPEC 4.8）
// ============================================================
// 各選択肢の抽選テーブル。合計は必ず 1.0
const NODE_CHOICES = window.NODE_CHOICES = {
    safe: {
        id: 'safe', label: '安全に進む', icon: '⚔️',
        outcomes: { normal: 1.00, elite: 0, item: 0, trap: 0 }
    },
    scout: {
        id: 'scout', label: '索敵する', icon: '🔍',
        outcomes: { normal: 0.60, elite: 0.35, item: 0, trap: 0.05 }
    },
    search: {
        id: 'search', label: 'アイテムを探す', icon: '🎒',
        outcomes: { normal: 0.45, elite: 0, item: 0.35, trap: 0.20 }
    },
    gamble: {
        id: 'gamble', label: 'とにかく進む', icon: '🎲',
        outcomes: { normal: 0.30, elite: 0.20, item: 0.25, trap: 0.25 }
    }
};

// 重み付き抽選
const rollWeighted = window.rollWeighted = (weights, rng = Math.random) => {
    const entries = Object.entries(weights).filter(([, w]) => w > 0);
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let r = rng() * total;
    for (const [key, w] of entries) {
        r -= w;
        if (r < 0) return key;
    }
    return entries.length ? entries[entries.length - 1][0] : null;
};

const rollNodeOutcome = window.rollNodeOutcome = (choiceId, rng = Math.random) => {
    const choice = NODE_CHOICES[choiceId];
    if (!choice) throw new Error(`Unknown node choice: ${choiceId}`);
    return rollWeighted(choice.outcomes, rng);
};

// 選択前に見せるヒント（結果は裏で確定済み、傾向のみ提示）
const OUTCOME_HINTS = window.OUTCOME_HINTS = {
    normal: { text: '静かだ', tone: 'neutral' },
    elite: { text: '強い気配', tone: 'danger' },
    item: { text: '何かの匂い', tone: 'good' },
    trap: { text: '嫌な予感', tone: 'warn' }
};

// ============================================================
// 6. 罠（SPEC 4.9）
// ============================================================
const TRAP_TABLE = window.TRAP_TABLE = [
    { id: 'damage', name: 'ダメージ罠', weight: 0.30, effect: { type: 'damage_all', value: 10 }, desc: '仕掛けが作動した！全員が10ダメージを受けた' },
    { id: 'poison', name: '毒罠', weight: 0.20, effect: { type: 'poison_all' }, desc: '有毒ガスが噴き出した！全員が毒状態になった' },
    { id: 'money', name: '資金ロス罠', weight: 0.20, effect: { type: 'lose_money_percent', value: 0.15 }, desc: '警報が鳴り、資材を落としてしまった（所持金の15%を失った）' },
    { id: 'rest', name: '休憩消費罠', weight: 0.15, effect: { type: 'lose_rest', value: 1 }, desc: '通路が崩落した。迂回で体力を消耗した（休憩回数-1）' },
    { id: 'debuff', name: '弱体化罠', weight: 0.15, effect: { type: 'debuff_random', value: -1 }, desc: '不気味な光を浴びた。次の戦闘に不調を持ち越す' }
];

const rollTrap = window.rollTrap = (rng = Math.random) => {
    const weights = {};
    TRAP_TABLE.forEach(t => { weights[t.id] = t.weight; });
    const id = rollWeighted(weights, rng);
    return TRAP_TABLE.find(t => t.id === id);
};

// ============================================================
// 7. 2体エンカウント率（SPEC 4.10）
// ============================================================
// フロアごとにリセットし、フロア内で奥に進むほど上昇する
const getDoubleEncounterRate = window.getDoubleEncounterRate = (floor, stepInFloor) => {
    const base = floor && typeof floor.baseRate === 'number' ? floor.baseRate : 0;
    const ramp = floor && typeof floor.rampPerStep === 'number' ? floor.rampPerStep : 0;
    return Math.max(0, Math.min(1, base + ramp * Math.max(0, stepInFloor)));
};

const rollEnemyCount = window.rollEnemyCount = (floor, stepInFloor, rng = Math.random) => {
    return rng() < getDoubleEncounterRate(floor, stepInFloor) ? 2 : 1;
};

// ============================================================
// 8. ショップ（SPEC 4.6）
// ============================================================
const SHOP_ITEMS = window.SHOP_ITEMS = [
    { name: "薬草", price: 50, kind: 'heal', value: 0.30, effect: "HP30%回復" },
    { name: "回復薬", price: 100, kind: 'heal', value: 0.50, effect: "HP50%回復" },
    { name: "アドレナリン", price: 250, kind: 'heal', value: 1.00, effect: "HP100%回復" },
    { name: "万能薬", price: 150, kind: 'cure', effect: "状態異常を全回復" },
    { name: "蘇生器", price: 300, kind: 'revive', value: 0.50, effect: "戦闘不能から50%HPで復活" },
    { name: "同調デバイス Mk-I", price: 500, kind: 'capture', effect: "捕獲率×1.3" },
    { name: "同調デバイス Mk-II", price: 1200, kind: 'capture', effect: "捕獲率×1.8" },
    { name: "同調デバイス Mk-III", price: 2500, kind: 'capture', effect: "捕獲率×2.4" },
    { name: "同調デバイス Mk-IV", price: 5000, kind: 'capture', effect: "捕獲率×3.0" },
    { name: "同調デバイス Mk-V", price: 15000, kind: 'capture', effect: "捕獲率100%（確定）" }
];

// アイテムはバトル中使用不可（SPEC 4.6）
const ITEMS_USABLE_IN_BATTLE = window.ITEMS_USABLE_IN_BATTLE = false;

// ============================================================
// 9. フロア構成（SPEC 4.11 / 4.11b）
// ============================================================
// position: 潜り始めてからの通し階数（1=B30）。技構成・レベルはこれを基準にする
const FLOORS = window.FLOORS = [
    { position: 1, id: 'B30', name: '炎の実験エリア', battles: 3, rests: 2, level: 5,
      wild: ['ヒノエナガ', 'ジェケイダ'], boss: 'フレイミー', baseRate: 0.00, rampPerStep: 0.03 },
    { position: 2, id: 'B29', name: '水辺エリア', battles: 3, rests: 2, level: 7,
      wild: ['コペゾー', 'スイネーク'], boss: 'ウォータル', baseRate: 0.00, rampPerStep: 0.03 },
    { position: 3, id: 'B28', name: '草原エリア', battles: 3, rests: 2, level: 9,
      wild: ['ハナーネ', 'フラビット'], boss: 'ハッパンク', baseRate: 0.02, rampPerStep: 0.03 },
    { position: 4, id: 'B27', name: '光の研究室', battles: 4, rests: 2, level: 11,
      wild: ['ツキネ', 'リュミエット'], boss: 'ライトラ', baseRate: 0.04, rampPerStep: 0.04 },
    { position: 5, id: 'B26', name: '闇の実験場', battles: 4, rests: 2, level: 13,
      wild: ['ハリースト', 'モスパーク'], boss: 'エルダーク', baseRate: 0.06, rampPerStep: 0.04 },
    { position: 6, id: 'B25', name: '混合エリア(炎+水)', battles: 4, rests: 3, level: 15,
      wild: ['エンガール', 'ビョウゲツ', 'フレイミー', 'コペゾー', 'ジェケイダ'], boss: 'レイコーン', baseRate: 0.10, rampPerStep: 0.05 },
    { position: 7, id: 'B24', name: '混合エリア(草+光)', battles: 5, rests: 3, level: 16,
      wild: ['シバフールー', 'オヌ・リン', 'ハナーネ', 'ツキネ', 'ライトラ'], boss: 'アカリード', baseRate: 0.13, rampPerStep: 0.05 },
    { position: 8, id: 'B23', name: '廃棄エリア', battles: 5, rests: 3, level: 17,
      wild: ['シカバラス', 'ウィデビット', 'ハリースト', 'モスパーク', 'スイネーク'], boss: 'ザルディヴァ', baseRate: 0.16, rampPerStep: 0.06 },
    { position: 9, id: 'B22', name: '高速テストエリア', battles: 5, rests: 3, level: 18,
      wild: ['ジェケイダ', 'リュミエット', 'ツキネ'], boss: 'フィンレーツ', baseRate: 0.19, rampPerStep: 0.07 },
    { position: 10, id: 'B21', name: '重装テストエリア', battles: 5, rests: 3, level: 19,
      wild: ['ロクザール', 'ペパザール', 'ウォータル', 'ハッパンク', 'ハナーネ'], boss: 'マグマス', baseRate: 0.25, rampPerStep: 0.08 },
    { position: 11, id: 'B20', name: '中間管理エリア', battles: 6, rests: 4, level: 20,
      wild: ['シャコマル', 'デヴィートル', 'エルダーク', 'レイコーン', 'フィンレーツ'], boss: 'ミレメント', baseRate: 0.30, rampPerStep: 0.08 }
];

// B19〜B1（続編フェーズ）。ゾーン単位の骨格のみ定義し、実装時に個別フロアへ展開する
const LATE_ZONES = window.LATE_ZONES = [
    { zone: 'A', range: ['B19', 'B16'], name: '警備強化区画', battles: 5, rests: 3,
      bosses: ['モモ', 'ジェリスタル', 'アルブラン', 'バラビィ'] },
    { zone: 'B', range: ['B15', 'B11'], name: '崩壊隔離区画', battles: 6, rests: 4,
      bosses: ['イグニルフ', 'ツルギ', 'ベルフレム', 'シザール', 'アッピオン'] },
    { zone: 'C', range: ['B10', 'B6'], name: 'コアシステム区画', battles: 6, rests: 4,
      bosses: ['ユッキング', 'ストロビー', 'ボルクマ', 'エルシェント', 'グラシオン'] },
    { zone: 'D', range: ['B5', 'B2'], name: '最終防衛ライン', battles: 7, rests: 5,
      bosses: ['リフェロス', 'オベアー', 'エルダーク', 'マグマス'] },
    { zone: 'FINAL', range: ['B1', 'B1'], name: '地上ゲート', battles: 1, rests: 0,
      bosses: ['ヴァーサス'] }
];

// 初期選択（SPEC 4.2）: 6体から2体
const STARTER_CHOICES = window.STARTER_CHOICES = [
    { type: 'fire', options: ['フレイミー', 'エンガール'] },
    { type: 'water', options: ['ウォータル', 'スイネーク'] },
    { type: 'grass', options: ['ハッパンク', 'リーファム'] }
];

const getFloorByPosition = window.getFloorByPosition = (position) => {
    return FLOORS.find(f => f.position === position) || null;
};
