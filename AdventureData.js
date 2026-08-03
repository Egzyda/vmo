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

// 全ヴァーモンが初期から持つ無属性技。属性技より威力が低い代わりに半減されない。
// 無属性モンスターは属性下位技がタックルと同一なので、例外として1つだけ持つ。
const COMMON_STARTER_MOVE = window.COMMON_STARTER_MOVE = "タックル";

const getStartingMoves = window.getStartingMoves = (monster) => {
    const elemental = STARTER_MOVES[monster.type];
    return elemental === COMMON_STARTER_MOVE ? [elemental] : [elemental, COMMON_STARTER_MOVE];
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

// 必要経験値が Lv^1.8 で伸びるのに対し、取得側が線形（10+Lv*5）だと
// 高レベルほど際限なく伸び悩む（Lv70到達に約1,467戦＝本編164戦では到達不能だった）。
// 同じ次数で伸ばすことで、全編通して1レベルあたり約2.5戦の一定ペースになる。
const getBaseExp = window.getBaseExp = (enemyLevel) => {
    return Math.max(1, Math.floor(4 * Math.pow(Math.max(1, enemyLevel), 1.8)));
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
// 候補6技すべてを習得できるよう6箇所。Lv29で全習得完了。
// 到達ペースの実測: Lv3=B30クリア直後 / Lv7=B28頃 / Lv11=B26頃 / Lv16=B23頃
const MOVE_LEARN_CHECKPOINTS = window.MOVE_LEARN_CHECKPOINTS = [3, 7, 11, 16, 22, 29];

const isStatusMove = (name, dbMoves) => !!(dbMoves[name] && dbMoves[name].category === 'status');

// 敵用の候補順: 攻撃技を威力降順で先に、補助技を後ろに。
// 威力順にしないと、レベルが低く1技しか覚えていないボスが
// たまたま配列の先頭にある弱い技／属性の噛み合わない技を主力にしてしまう。
const getAutoMoveOrder = window.getAutoMoveOrder = (monster, dbMoves) => {
    const pool = monster.moves || [];
    const attack = pool.filter(m => !isStatusMove(m, dbMoves))
        .sort((a, b) => (dbMoves[b].power || 0) - (dbMoves[a].power || 0));
    const status = pool.filter(m => isStatusMove(m, dbMoves));
    return [...attack, ...status];
};

// 味方の自動習得順。最初の1つは必ず補助技にする
// （初期技が下位攻撃技2つなので、いきなり上位攻撃技を配ると下位技が即死蔵になる）
const getPlayerAutoMoveOrder = window.getPlayerAutoMoveOrder = (monster, dbMoves) => {
    const pool = monster.moves || [];
    const status = pool.filter(m => isStatusMove(m, dbMoves));
    const attack = pool.filter(m => !isStatusMove(m, dbMoves))
        .sort((a, b) => (dbMoves[a].power || 0) - (dbMoves[b].power || 0)); // 弱い攻撃技から
    if (!status.length) return attack;
    return [status[0], ...attack, ...status.slice(1)];
};

// 捕獲直後に知っている技。通過済みチェックポイント分を自動習得済みにする
const getKnownMovesOnCapture = window.getKnownMovesOnCapture = (monster, level, dbMoves) => {
    const passed = MOVE_LEARN_CHECKPOINTS.filter(lv => level >= lv).length;
    return [...getStartingMoves(monster), ...getPlayerAutoMoveOrder(monster, dbMoves).slice(0, passed)];
};

// 敵が知っている技。味方と違い攻撃技から先に覚える。
// （味方用の補助技優先順を敵に流用すると、低レベルのボスが補助技しか持てなくなる）
const getEnemyKnownMoves = window.getEnemyKnownMoves = (monster, level, dbMoves) => {
    const passed = MOVE_LEARN_CHECKPOINTS.filter(lv => level >= lv).length;
    return [...getStartingMoves(monster), ...getAutoMoveOrder(monster, dbMoves).slice(0, Math.max(1, passed))];
};

// 習得画面に出す選択肢。最初の1つ（候補技を1つも覚えていない状態）は補助技のみに絞る
const getLearnOptions = window.getLearnOptions = (monster, knownMoves, dbMoves) => {
    const remaining = (monster.moves || []).filter(m => !knownMoves.includes(m));
    const learnedFromPool = (monster.moves || []).filter(m => knownMoves.includes(m));
    if (learnedFromPool.length === 0) {
        const statusOnly = remaining.filter(m => isStatusMove(m, dbMoves));
        if (statusOnly.length) return statusOnly;
    }
    return remaining;
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

    // 序盤は威力上限内の技だけを抽選対象にする（ボスと同じ理由。
    // 上限が無いと2階目の雑魚がP110を引き当て、下位技しか無いプレイヤーが即死する）
    const cap = getFloorPowerCap(floorPosition);
    const pool = (monster.moves || []).filter(m => !dbMoves[m] || (dbMoves[m].power || 0) <= cap);
    if (!pool.length) return [starter];

    // 1→10階目で 0→6 に線形解放
    const realCount = Math.min(pool.length, Math.round((floorPosition - 1) / 9 * 6));
    const shuffled = [...pool].sort(() => rng() - 0.5);
    const realMoves = shuffled.slice(0, Math.min(3, realCount || 1));

    if (floorPosition < 15) return [starter, ...realMoves].slice(0, 3);

    // 15階目以降は下位技を使わない。
    // ただし抽選で補助技ばかり引くと攻撃手段が無くなるので、最低1つは攻撃技を保証する
    const hasAttack = realMoves.some(m => dbMoves[m] && dbMoves[m].category !== 'status');
    if (!hasAttack) {
        const attack = pool.find(m => dbMoves[m] && dbMoves[m].category !== 'status');
        if (attack) return [attack, ...realMoves].slice(0, 3);
        return [starter];
    }
    return realMoves;
};

// エリート/ボス: 威力順の攻撃技2つ + 補助技1つを機械的に自動編成
// 序盤フロアの敵が使える技の威力上限。
// プレイヤーは最初の上位攻撃技をLv7（4階目相当）まで持てず、それまで下位技(P30-40)で戦う。
// 敵だけが2階目からP110を振り回すと威力差2.75倍になり、
// ステータス補正をいくら下げてもクリア不能になるため、敵側の技も同じペースで解禁する。
const getFloorPowerCap = window.getFloorPowerCap = (floorPosition) => {
    if (!floorPosition) return Infinity;
    if (floorPosition <= 1) return 40;
    if (floorPosition === 2) return 65;
    if (floorPosition === 3) return 70;
    if (floorPosition === 4) return 80;
    if (floorPosition === 5) return 90;
    if (floorPosition === 6) return 100;
    return Infinity;
};

const getEliteMoves = window.getEliteMoves = (monster, level, dbMoves, floorPosition) => {
    const starting = getStartingMoves(monster);
    const cap = getFloorPowerCap(floorPosition);
    const levelGated = getEnemyKnownMoves(monster, level, dbMoves);

    // 威力上限は候補6技すべてから選び直す。
    // レベルで絞った後に上限を適用すると、残った1技が上限超えだった場合に
    // フォールバックでその技をそのまま使ってしまい、上限が機能しない。
    const poolAttacks = (monster.moves || [])
        .filter(m => dbMoves[m] && dbMoves[m].category !== 'status' && !starting.includes(m))
        .sort((a, b) => (dbMoves[b].power || 0) - (dbMoves[a].power || 0));

    const withinCap = poolAttacks.filter(m => (dbMoves[m].power || 0) <= cap);
    let attack;
    if (withinCap.length) {
        attack = withinCap;
    } else if (poolAttacks.length) {
        attack = [poolAttacks[poolAttacks.length - 1]]; // 上限内が無ければ最弱の1つ
    } else {
        attack = [];
    }
    // 上限が無い（終盤）フロアではレベル解禁の制約を保つ
    if (cap === Infinity) {
        const gated = attack.filter(m => levelGated.includes(m));
        if (gated.length) attack = gated;
    }

    const support = levelGated.filter(m => dbMoves[m] && dbMoves[m].category === 'status' && !starting.includes(m));

    const equipped = attack.slice(0, 2);
    const third = support[0] || attack[2];
    if (third) equipped.push(third);
    return equipped.length ? equipped : [starting[0]];
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
// bossTier: ボスのステータス補正。B30はチュートリアルなので補正なし(1.0)。
// 序盤3フロア(B30-B28)は炎水草の混合。単一属性テーマだと初期選択の属性次第で
// 常時1.5倍被弾になり詰むため、属性テーマはB27(光)から始める。
// ボスには初期選択6体を使わない（自分と同じヴァーモンと戦う違和感を避ける）。
const FLOORS = window.FLOORS = [
    // B30はチュートリアル。自動編成だとシカバラスの単体攻撃がラッシュ(P90)しかなく、
    // 初期技(P30-40)しか持たないLv1パーティに対して火力差が2倍以上つくため技を手動指定する。
    // タックル=プレイヤーと同威力帯 / パワーチャージ=バフの存在を教える
    // wildStatMult: 序盤フロアの野生は「弱体個体」として種族値を割り引く。
    // 下位技(P30-40)では敵HP(36-55)を削るのに4-6ターンかかり、その間の被弾累計が
    // 自軍HP合計を超えてボス到達前に全滅していた。技の威力を上げても敵が同じ技を
    // 使うため相殺されるので、敵の耐久・火力側を下げるのが有効。
    { position: 1, id: 'B30', name: '第三実験区画', battles: 3, rests: 3, level: 2, wildStatMult: 0.7,
      bossTier: 'normal', bossLevel: 4, bossMoves: ['タックル', 'パワーチャージ'],
      wild: ['ヒノエナガ', 'コペゾー', 'ハナーネ'], boss: 'シカバラス', baseRate: 0.00, rampPerStep: 0.02 },
    { position: 2, id: 'B29', name: '飼育プール', battles: 3, rests: 3, level: 4, wildStatMult: 0.8, bossTier: 'elite',
      wild: ['ジェケイダ', 'スイネーク', 'フラビット'], boss: 'イグニルフ', baseRate: 0.00, rampPerStep: 0.03 },
    { position: 3, id: 'B28', name: '培養温室', battles: 4, rests: 3, level: 6, wildStatMult: 0.8, bossTier: 'normal',
      wild: ['バラビィ', 'ビョウゲツ', 'モモ'], boss: 'ペパザール', baseRate: 0.02, rampPerStep: 0.03 },
    { position: 4, id: 'B27', name: '光の研究室', battles: 4, rests: 3, level: 8, bossTier: 'elite',
      wild: ['ツキネ', 'リュミエット', 'オヌ・リン'], boss: 'ライトラ', baseRate: 0.04, rampPerStep: 0.04 },
    { position: 5, id: 'B26', name: '闇の実験場', battles: 4, rests: 3, level: 10, bossTier: 'elite',
      wild: ['ハリースト', 'モスパーク', 'ウィデビット'], boss: 'エルダーク', baseRate: 0.06, rampPerStep: 0.04 },
    { position: 6, id: 'B25', name: '混合エリア(炎+水)', battles: 5, rests: 3, level: 12, bossTier: 'elite', wildStatMult: 0.9,
      wild: ['エンガール', 'ビョウゲツ', 'ヒノエナガ', 'コペゾー'], boss: 'レイコーン', baseRate: 0.10, rampPerStep: 0.05 },
    { position: 7, id: 'B24', name: '混合エリア(草+光)', battles: 5, rests: 3, level: 14, bossTier: 'elite', wildStatMult: 0.9,
      wild: ['シバフールー', 'オヌ・リン', 'ハナーネ', 'ツキネ'], boss: 'アカリード', baseRate: 0.13, rampPerStep: 0.05 },
    { position: 8, id: 'B23', name: '廃棄エリア', battles: 5, rests: 3, level: 16, bossTier: 'elite', wildStatMult: 0.9,
      wild: ['ウィデビット', 'ハリースト', 'モスパーク', 'スイネーク'], boss: 'ザルディヴァ', baseRate: 0.16, rampPerStep: 0.06 },
    { position: 9, id: 'B22', name: '高速テストエリア', battles: 5, rests: 3, level: 18, bossTier: 'elite', wildStatMult: 0.9,
      wild: ['ジェケイダ', 'リュミエット', 'ツキネ', 'ハリースト'], boss: 'フィンレーツ', baseRate: 0.19, rampPerStep: 0.07 },
    { position: 10, id: 'B21', name: '重装テストエリア', battles: 6, rests: 3, level: 19, bossTier: 'elite', wildStatMult: 0.9,
      wild: ['ロクザール', 'ジェリスタル', 'シバフールー', 'フラビット'], boss: 'マグマス', baseRate: 0.25, rampPerStep: 0.08 },
    { position: 11, id: 'B20', name: '中間管理エリア', battles: 6, rests: 4, level: 20, bossTier: 'elite', wildStatMult: 0.9,
      wild: ['シャコマル', 'デヴィートル', 'オベアー', 'レイコーン'], boss: 'ミレメント', baseRate: 0.30, rampPerStep: 0.08 }
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

// ============================================================
// 10. ストーリー / 演出テキスト（SPEC 4.1 / 4.12）
// ============================================================
// 文中で改行せず、意味の切れ目だけで改行する（端末幅に応じて自動折り返しさせる）
const PROLOGUE = window.PROLOGUE = [
    "戦うために造られたモンスター『ヴァーモン』。\nそれを人工的に生み出す地下研究施設——『アーク』。",
    "研究者であるあなたは、施設の管理者に反旗をひるがえし、地下30階の隔離区画に監禁されていた。\n次の被験体は、あなた自身だという。",
    "だがある夜、施設内で暴走したヴァーモンがあなたの監禁ポッドを破壊した。",
    "チャンスは今しかない。\nヴァーモンを従え、地上を目指せ。"
];

const EPILOGUE = window.EPILOGUE = [
    "ゲートが開く。広がる空。本物の風。\n——脱出成功だ。",
    "だが、地平線の向こうに無数の影が蠢いていた。\n地上は、すでにヴァーモンのものだった。"
];

// フロア入場時の一言。地上に近づくほど明るくなる描写を積む
const FLOOR_INTRO = window.FLOOR_INTRO = {
    B30: "非常灯だけが赤く点滅している。ここが地下30階——アークの最下層だ。",
    B29: "足元に水が溜まっている。培養プールの循環が止まっているらしい。",
    B28: "枯れかけた植物が通路を覆っている。空調はとうに死んでいる。",
    B27: "白い照明がまだ生きている。実験記録のモニターが虚しく明滅する。",
    B26: "照明が落ちている。闇の中で、何かがこちらを見ている気配がする。",
    B25: "熱気と湿気が入り混じる。区画の隔壁が溶け落ちたようだ。",
    B24: "陽光を模した照明。植物と光が入り混じる、奇妙に穏やかな区画。",
    B23: "失敗作が打ち捨てられた区画。彼らはまだ生きている。",
    B22: "風を切る音。何かがとてつもない速度で通路を横切った。",
    B21: "床が軋む。重装個体のテストに使われていた区画だ。",
    B20: "ここから上は管理区画。監視の目が、明らかに濃くなる。"
};

const BOSS_INTRO = window.BOSS_INTRO = {
    B30: "通路の先を、一体のヴァーモンが塞いでいる。最初の関門だ。",
    B20: "分厚い隔壁の前に、管理個体が立っていた。ここを抜ければ、中層だ。"
};

const FLOOR_CLEAR = window.FLOOR_CLEAR = {
    B30: "隔壁が開いた。地上まで、あと29階。",
    B20: "中間管理区画を突破した。地上の空気が、かすかに感じられる。"
};

// 探索テキスト。結果に応じたトーンで「歩いて遭遇した」感を出す
const ENCOUNTER_FLAVOR = window.ENCOUNTER_FLAVOR = {
    normal: ["物音がした。", "曲がり角の先に気配がある。", "何かがこちらに気づいた。"],
    elite: ["空気が変わった。ただの個体ではない。", "重い足音が近づいてくる。", "強化個体だ——警戒しろ。"],
    item: ["物資コンテナが転がっている。", "誰かの落とし物を見つけた。", "棚の奥に何か残っていた。"],
    trap: ["足元で、何かが小さく鳴った。", "しまった——踏んだ。", "警報装置が作動する。"]
};

const pickFlavor = window.pickFlavor = (outcome, rng = Math.random) => {
    const list = ENCOUNTER_FLAVOR[outcome] || [];
    return list.length ? list[Math.floor(rng() * list.length)] : '';
};
