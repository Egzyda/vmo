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
    const base = 75 + enemyLevel * 12;
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
// 4b. 改造研究員（SPEC 4.16）
// ============================================================
// 個性は設けないが、雑魚研究員（野生と同格の1〜2体）とエリート研究員（4体の
// アーキタイプ編成）の2段階を用意する。テンプレートは既存のPvP用チーム
// （app.js の ELITE_TEAMS/MASTER_TEAMS）と同じ思想で、明確なコンセプトを持たせる。
const RESEARCHER_TEAMS = window.RESEARCHER_TEAMS = [
    {
        name: 'ディストーション速攻',
        members: [
            { id: 10, moves: ['ダークインパクト', 'ディストーション', 'プロテクション'] },
            { id: 32, moves: ['ダークインパクト', 'ダークファング', 'プロテクション'] },
            { id: 11, moves: ['フレイムバースト', 'マグマブロック', 'プロテクション'] },
            { id: 17, moves: ['ホーリーレイ', 'ボルトクロー', 'プロテクション'] }
        ]
    },
    {
        name: '全体バフ特化',
        members: [
            { id: 9, moves: ['ダークインパクト', 'カースドノヴァ', 'パワーチャージ'] },
            { id: 7, moves: ['ホーリーレイ', '光速の爪', 'パワーチャージ'] },
            { id: 25, moves: ['フレイムバースト', 'ロックパンチ', 'パワーチャージ'] },
            { id: 49, moves: ['ホーリーレイ', 'ハーフカット', 'パワーチャージ'] }
        ]
    },
    {
        name: 'デバフ+削り',
        members: [
            { id: 3, moves: ['アクアストリーム', 'インティミデイト', 'プロテクション'] },
            { id: 20, moves: ['ダークインパクト', 'ドレインホーン', 'アイアンシェル'] },
            { id: 4, moves: ['アクアストリーム', 'アシッドボム', 'ドレインバイト'] },
            { id: 26, moves: ['アクアストリーム', 'インティミデイト', 'アクアブロック'] }
        ]
    },
    {
        name: 'プロテクション粘り',
        members: [
            { id: 14, moves: ['アクアストリーム', 'ヒールライト', 'プロテクション'] },
            { id: 22, moves: ['ソーンウィップ', 'ヒールライト', 'プロテクション'] },
            { id: 48, moves: ['ソーンウィップ', 'グラスヒール', 'プロテクション'] },
            { id: 8, moves: ['ホーリーレイ', 'ヒールライト', 'プロテクション'] }
        ]
    }
];

// 「エリート」を引いた際、強化された野生個体／雑魚研究員／エリート研究員の
// どれになるかをフロアの深さで振り分ける。深く潜るほどエリート研究員の比率が上がる
// （SPEC 4.10「深い階層に進むほどエリート研究員の出現比率が上がる」）。
const getEliteEncounterKind = window.getEliteEncounterKind = (floorPosition, rng = Math.random) => {
    const p = floorPosition || 1;
    let weights;
    if (p <= 4) weights = { wild: 1, researcher_weak: 0, researcher_elite: 0 };
    else if (p <= 10) weights = { wild: 0.7, researcher_weak: 0.3, researcher_elite: 0 };
    else if (p <= 19) weights = { wild: 0.4, researcher_weak: 0.35, researcher_elite: 0.25 };
    else weights = { wild: 0.2, researcher_weak: 0.2, researcher_elite: 0.6 };
    return rollWeighted(weights, rng);
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

// 「安全に進む」だけはフロア位置に応じてわずかにエリート率が乗る（SPEC 4.8）。
// 序盤（B30〜B23相当）は完全に安全（0%）。以降じわじわ上がり、5%で頭打ち。
const getSafeEliteChance = window.getSafeEliteChance = (floorPosition) => {
    const p = floorPosition || 1;
    if (p <= 8) return 0;
    return Math.min(0.05, (p - 8) * 0.005);
};

const rollNodeOutcome = window.rollNodeOutcome = (choiceId, floorPosition, rng = Math.random) => {
    const choice = NODE_CHOICES[choiceId];
    if (!choice) throw new Error(`Unknown node choice: ${choiceId}`);
    if (choiceId === 'safe') {
        const eliteChance = getSafeEliteChance(floorPosition);
        return rollWeighted({ ...choice.outcomes, elite: eliteChance, normal: choice.outcomes.normal - eliteChance }, rng);
    }
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
    return Math.max(0, Math.min(0.9, base + ramp * Math.max(0, stepInFloor)));
};

const rollEnemyCount = window.rollEnemyCount = (floor, stepInFloor, rng = Math.random) => {
    return rng() < getDoubleEncounterRate(floor, stepInFloor) ? 2 : 1;
};

// ============================================================
// 8. ショップ（SPEC 4.6）
// ============================================================
const SHOP_ITEMS = window.SHOP_ITEMS = [
    { name: "薬草", price: 50, kind: 'heal', value: 0.30, effect: "HP30%回復" },
    { name: "回復薬", price: 80, kind: 'heal', value: 0.50, effect: "HP50%回復" },
    { name: "アドレナリン", price: 120, kind: 'heal', value: 1.00, effect: "HP100%回復" },
    { name: "万能薬", price: 150, kind: 'cure', effect: "状態異常を全回復" },
    { name: "蘇生器", price: 300, kind: 'revive', value: 0.50, effect: "戦闘不能から50%HPで復活" },
    { name: "回復スプレー", price: 260, kind: 'heal_all', value: 0.50, effect: "パーティ全員HP50%回復" },
    { name: "同調デバイス Mk-I", price: 380, kind: 'capture', effect: "捕獲率+10%" },
    { name: "同調デバイス Mk-II", price: 850, kind: 'capture', effect: "捕獲率+20%" },
    { name: "同調デバイス Mk-III", price: 1700, kind: 'capture', effect: "捕獲率+35%" },
    { name: "同調デバイス Mk-IV", price: 3400, kind: 'capture', effect: "捕獲率+55%" },
    { name: "同調デバイス Mk-V", price: 9000, kind: 'capture', effect: "捕獲率100%（確定）" }
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
      wild: ['シャコマル', 'デヴィートル', 'オベアー', 'レイコーン'], boss: 'ミレメント', baseRate: 0.30, rampPerStep: 0.08 },

    // ===== B19〜B1（ゾーンA〜D + 地上ゲート）SPEC 4.11b =====
    // ゾーン内のボスは「弱→強」の順で各フロアに割り当て、ゾーン最終フロアだけ
    // bossTier: 'boss'(1.5倍)にして節目を強調する（それ以外は 'elite' 1.2倍）。
    // 雑魚は既出モンスターの使い回し。ゾーンAクリア後はゾーンAのボス格を、
    // ゾーンBクリア後はゾーンBのボス格を…という具合に「元ボスが並みの敵になる」
    // 演出を1体ずつ混ぜる（B20の踏襲）。
    { position: 12, id: 'B19', name: '監視回廊', battles: 5, rests: 3, level: 23, wildStatMult: 0.88, bossTier: 'elite',
      wild: ['ヒノエナガ', 'コペゾー', 'ハナーネ', 'ジェケイダ'], boss: 'モモ', baseRate: 0.31, rampPerStep: 0.08 },
    { position: 13, id: 'B18', name: '非常呼集区画', battles: 5, rests: 3, level: 25, wildStatMult: 0.88, bossTier: 'elite',
      wild: ['スイネーク', 'フラビット', 'ビョウゲツ', 'ツキネ'], boss: 'ジェリスタル', baseRate: 0.32, rampPerStep: 0.08 },
    { position: 14, id: 'B17', name: '検問ゲート', battles: 5, rests: 3, level: 27, wildStatMult: 0.88, bossTier: 'elite',
      wild: ['リュミエット', 'オヌ・リン', 'ハリースト', 'モスパーク'], boss: 'アルブラン', baseRate: 0.33, rampPerStep: 0.08 },
    { position: 15, id: 'B16', name: '武装保管庫', battles: 5, rests: 3, level: 29, wildStatMult: 0.88, bossTier: 'elite',
      wild: ['ウィデビット', 'エンガール', 'シバフールー', 'ロクザール'], boss: 'バラビィ', baseRate: 0.34, rampPerStep: 0.08 },

    { position: 16, id: 'B15', name: '亀裂拡大区画', battles: 6, rests: 4, level: 32, wildStatMult: 0.88, bossTier: 'elite',
      wild: ['シャコマル', 'デヴィートル', 'レイコーン', 'モモ'], boss: 'イグニルフ', baseRate: 0.35, rampPerStep: 0.09 },
    { position: 17, id: 'B14', name: '隔離病棟跡', battles: 6, rests: 4, level: 35, wildStatMult: 0.88, bossTier: 'elite',
      wild: ['ペパザール', 'ライトラ', 'アカリード', 'ジェリスタル'], boss: 'ツルギ', baseRate: 0.36, rampPerStep: 0.09 },
    { position: 18, id: 'B13', name: '陥没通路', battles: 6, rests: 4, level: 38, wildStatMult: 0.88, bossTier: 'elite',
      wild: ['フィンレーツ', 'ミレメント', 'フレイミー', 'アルブラン'], boss: 'ベルフレム', baseRate: 0.37, rampPerStep: 0.09 },
    { position: 19, id: 'B12', name: '汚染浄化区画', battles: 6, rests: 4, level: 41, wildStatMult: 0.88, bossTier: 'elite',
      wild: ['ハッパンク', 'リーファム', 'ヒノエナガ', 'バラビィ'], boss: 'シザール', baseRate: 0.38, rampPerStep: 0.09 },
    { position: 20, id: 'B11', name: '隔壁制御室', battles: 6, rests: 4, level: 44, wildStatMult: 0.88, bossTier: 'elite',
      wild: ['ハナーネ', 'ジェケイダ', 'スイネーク', 'フラビット'], boss: 'アッピオン', baseRate: 0.39, rampPerStep: 0.09 },

    { position: 21, id: 'B10', name: '冷却プラント', battles: 6, rests: 4, level: 47, wildStatMult: 0.88, bossTier: 'elite',
      wild: ['ビョウゲツ', 'ツキネ', 'リュミエット', 'イグニルフ'], boss: 'ユッキング', baseRate: 0.4, rampPerStep: 0.09 },
    { position: 22, id: 'B9', name: '電力中枢', battles: 6, rests: 4, level: 50, wildStatMult: 0.88, bossTier: 'elite',
      wild: ['ハリースト', 'モスパーク', 'ウィデビット', 'ツルギ'], boss: 'ストロビー', baseRate: 0.41, rampPerStep: 0.09 },
    { position: 23, id: 'B8', name: 'データバンク', battles: 6, rests: 4, level: 53, wildStatMult: 0.8, bossTier: 'elite',
      wild: ['シバフールー', 'ロクザール', 'シャコマル', 'ベルフレム'], boss: 'ボルクマ', baseRate: 0.42, rampPerStep: 0.09 },
    { position: 24, id: 'B7', name: 'サーバー回廊', battles: 6, rests: 4, level: 56, wildStatMult: 0.88, bossTier: 'elite',
      wild: ['レイコーン', 'シカバラス', 'ペパザール', 'シザール'], boss: 'エルシェント', baseRate: 0.43, rampPerStep: 0.09 },
    { position: 25, id: 'B6', name: '中央制御室', battles: 6, rests: 4, level: 59, wildStatMult: 0.88, bossTier: 'elite',
      wild: ['アカリード', 'ザルディヴァ', 'フィンレーツ', 'アッピオン'], boss: 'グラシオン', baseRate: 0.44, rampPerStep: 0.09 },

    // 二体ボス（同種×2、各個体はnormal補正=1.0倍）。ボス単体を歪に強くしない方針のまま、
    // 同時2体を相手取る戦術的な難しさで終盤の強さを出す（SPEC 4.10参照）
    { position: 26, id: 'B5', name: '第一防衛ライン', battles: 7, rests: 5, level: 62, wildStatMult: 0.88, bossTier: 'elite',
      wild: ['フレイミー', 'ウォータル', 'ハッパンク', 'リーファム'], boss: 'リフェロス', bossDuo: true, baseRate: 0.45, rampPerStep: 0.1 },
    { position: 27, id: 'B4', name: '対ヴァーモン兵装区画', battles: 7, rests: 5, level: 65, wildStatMult: 0.8, bossTier: 'elite',
      wild: ['ヒノエナガ', 'コペゾー', 'ハナーネ', 'ユッキング'], boss: 'オベアー', baseRate: 0.46, rampPerStep: 0.1 },
    // 研究員ボス: フロアボスの代わりにエリート研究員編成（RESEARCHER_TEAMS）と戦う
    { position: 28, id: 'B3', name: '最終検問', battles: 7, rests: 5, level: 68, wildStatMult: 0.88, bossTier: 'elite',
      wild: ['スイネーク', 'フラビット', 'ビョウゲツ', 'ストロビー'], boss: 'エルダーク', bossKind: 'researcher', baseRate: 0.47, rampPerStep: 0.1 },
    { position: 29, id: 'B2', name: '地上直結エレベーター', battles: 7, rests: 5, level: 71, wildStatMult: 0.88, bossTier: 'elite',
      wild: ['リュミエット', 'オヌ・リン', 'ハリースト', 'ボルクマ'], boss: 'マグマス', bossDuo: true, baseRate: 0.48, rampPerStep: 0.1 },

    // B1: 地上ゲート。雑魚戦なし、ラスボス:ヴァーサスのみの一本勝負。
    // 種族データ(id999)はHP9999の管理者イースターエッグ用なのでそのまま使わず、
    // finalBossStats で実際に使う実効ステータスを上書きする（AdventureMode.buildBoss参照）。
    // finalBossStats/bossMovesはシミュレーターで実測調整済み（自Lv73・4体で自Lv73未満は0%、
    // 到達直後は僅かに残機ありの辛勝、Lv80/90/100と育てるほど余裕が生まれる曲線）
    { position: 30, id: 'B1', name: '地上ゲート', battles: 0, rests: 0, level: 71, bossTier: 'final',
      wild: [], boss: 'ヴァーサス', baseRate: 0, rampPerStep: 0,
      bossLevel: 80,
      bossMoves: ['カースドノヴァ', 'ラッシュ', 'プロテクション'],
      finalBossStats: { hp: 280, atk: 80, def: 80, spd: 110 } }
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
    B20: "ここから上は管理区画。監視の目が、明らかに濃くなる。",

    B19: "警報が施設全体に響いている。脱走が発覚したのだ。警備が一気に厳しくなる。",
    B18: "赤色灯の下、武装した個体が整列していた。ただの実験体ではない——実戦部隊だ。",
    B17: "検問の残骸が転がっている。誰かが、あるいは何かが、ここを強行突破したらしい。",
    B16: "武器庫の扉が半開きになっている。中の気配は、これまでの階とは明らかに違う。",
    B15: "壁のあちこちに亀裂が入っている。上の階の崩落が、ここまで及んでいるようだ。",
    B14: "使われなくなった病棟。誰も彼もが、ここから出られなかったのだろう。",
    B13: "床が大きく陥没している。落ちれば戻れない、そんな予感がする。",
    B12: "刺激臭が漂っている。浄化作業が追いついていない証拠だ。",
    B11: "巨大な隔壁の制御盤が並ぶ。この先を抜ければ、施設の中枢に届く。",
    B10: "冷気が漂う。巨大な冷却設備が、まだ生きて稼働している。",
    B9: "低い唸りが足元から伝わってくる。電力の中枢が、すぐそこにある。",
    B8: "無数のデータ端末が並ぶ。この施設の記録が、すべてここに眠っている。",
    B7: "サーバーの明滅が、まるで心拍のように通路を照らす。",
    B6: "施設全体を統べる制御室。ここを抜ければ、もう管理区画ではない。",
    B5: "重厚な扉の先、最終防衛ラインが待ち構えている。ここからは後がない。",
    B4: "対ヴァーモン用の兵装がずらりと並ぶ。人類が、本気で牙を剥いてきた区画だ。",
    B3: "最後の検問。ここを抜ければ、あとは地上へ続くエレベーターだけだ。",
    B2: "エレベーターの扉が見える。地上まで、あと一つ。",
    B1: "分厚いゲートの向こう、外の光が僅かに漏れている。地上まで、あと一つの扉。"
};

const BOSS_INTRO = window.BOSS_INTRO = {
    B30: "通路の先を、一体のヴァーモンが塞いでいる。最初の関門だ。",
    B20: "分厚い隔壁の前に、管理個体が立っていた。ここを抜ければ、中層だ。",
    B19: "エレベーターが強制停止した。ここから先は、もう逃げも隠れもできない。管理者直属の部隊が待っている。",
    B15: "崩落の奥から、聞き覚えのある咆哮。B29で退けたはずの個体が、比較にならないほど強化されて立っている。",
    B10: "中枢へ続く扉の前に、番人が立ちはだかる。施設の心臓部を、生きて通す気はないらしい。",
    B5: "最終防衛ライン。ここを抜けなければ、地上には届かない。施設が持てる全戦力が、目の前に集結している。",
    B3: "最後の検問に立っていたのは、ヴァーモンではなかった。エリート研究員の編成部隊——万全の連携で待ち構えている。",
    B2: "エレベーターの前に、二体のマグマスが立ちはだかる。地上へ続く最後の関門は、一体では終わらせてくれないらしい。",
    B1: "光が眩しい。ゲートの向こうに、彼が立っていた。\nヴァーサス——この世界のすべてを管理する者。\n最後の戦いが、始まる。"
};

const FLOOR_CLEAR = window.FLOOR_CLEAR = {
    B30: "隔壁が開いた。地上まで、あと29階。",
    B20: "中間管理区画を突破した。地上の空気が、かすかに感じられる。",
    B16: "警備強化区画を突破した。だが施設はまだ、あなたを逃す気はないようだ。",
    B11: "崩壊隔離区画を抜けた。足元の揺れが収まらない。施設そのものが限界に近い。",
    B6: "コアシステム区画を制圧した。管理区画の中枢は、もう目と鼻の先だ。",
    B2: "最終防衛ラインを突破した。エレベーターの扉が、静かに開く。地上まで、あと一歩。",
    B1: "ヴァーサスを退けた。ゲートの向こうに、地上の光が満ちている。"
};

// 探索テキスト。結果に応じたトーンで「歩いて遭遇した」感を出す
const ENCOUNTER_FLAVOR = window.ENCOUNTER_FLAVOR = {
    normal: [
        "物音がした。", "曲がり角の先に気配がある。", "何かがこちらに気づいた。",
        "闇の中で、目が光った。", "通路の奥から唸り声が聞こえる。",
        "壁づたいに何かが動いている。", "床に新しい爪痕があった。",
        "気配を感じて足を止めた——遅かった。", "視界の端で、何かが動いた。",
        "静寂を裂くように、金属が擦れる音がした。"
    ],
    elite: [
        "空気が変わった。ただの個体ではない。", "重い足音が近づいてくる。",
        "強化個体だ——警戒しろ。", "殺気にも似た気配が、こちらへ向いた。",
        "改造された筐体が軋む音が響く。", "ただならぬ圧が、通路を満たしていく。",
        "本能が警告している。今すぐ構えろ。", "並の個体とは動きが違う。",
        "研究員の手が入っている——強い。", "地響きのような足音が近づく。"
    ],
    item: ["物資コンテナが転がっている。", "誰かの落とし物を見つけた。", "棚の奥に何か残っていた。"],
    trap: ["足元で、何かが小さく鳴った。", "しまった——踏んだ。", "警報装置が作動する。"]
};

const pickFlavor = window.pickFlavor = (outcome, rng = Math.random) => {
    const list = ENCOUNTER_FLAVOR[outcome] || [];
    return list.length ? list[Math.floor(rng() * list.length)] : '';
};
