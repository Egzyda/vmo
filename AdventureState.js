// AdventureState.js - アドベンチャーの所持データ・レベル成長・セーブI/O
// SPEC.md 4.3 / 4.7 / 4.14 に対応。対戦モードのデータには触れない。

const ADVENTURE_SAVE_KEY = 'vmo_adventure_save';
const PARTY_LIMIT = window.ADVENTURE_PARTY_LIMIT = 4;

// ------------------------------------------------------------
// モンスターインスタンス
// ------------------------------------------------------------
// 保存するのは可変分だけ（id/level/exp/技/HP）。
// 種族値・画像・技プールは常に dbMonsters から引き直す。
// 既定の装備技。習得済みから「攻撃技を威力順に2つ + 補助技1つ」を選ぶ。
// 単純に known.slice(0,3) にすると常に [属性下位技, タックル, 補助技] が並び、
// レベルアップで覚えた上位攻撃技が永久に装備されないまま下位技で戦い続けることになる。
const getDefaultEquipped = window.getDefaultEquipped = (knownMoves, dbMoves) => {
    const atk = knownMoves.filter(m => dbMoves[m] && dbMoves[m].category !== 'status')
        .sort((a, b) => (dbMoves[b].power || 0) - (dbMoves[a].power || 0));
    const sup = knownMoves.filter(m => dbMoves[m] && dbMoves[m].category === 'status');
    const out = atk.slice(0, 2);
    if (sup.length) out.push(sup[0]); else out.push(...atk.slice(2, 3));
    return out.filter(Boolean).slice(0, 3);
};

const createAdventureMonster = window.createAdventureMonster = (baseData, level, dbMoves) => {
    const lv = Math.max(1, Math.min(window.MAX_LEVEL, level || 1));
    const known = window.getKnownMovesOnCapture(baseData, lv, dbMoves);
    const stats = getEffectiveStats({ id: baseData.id, level: lv }, baseData);
    return {
        id: baseData.id,
        level: lv,
        exp: 0,
        knownMoves: known,
        equippedMoves: getDefaultEquipped(known, dbMoves),
        currentHp: stats.hp
    };
};

// レベル補正後のステータス。
// SPEC 3.1 はダメージのみにレベル補正をかけていたが、それだとHPが据え置きのため
// 低レベルほど撃破ターン数が伸びて戦闘が間延びする（Lv1で4.5T / Lv100で1.4T）。
// ステータス側にも同じ補正をかけると撃破ターン数がレベル非依存で一定になる。
const getEffectiveStats = window.getEffectiveStats = (instance, baseData) => {
    const m = window.getLevelMultiplier(instance.level || 1);
    return {
        hp: Math.max(1, Math.floor(baseData.hp * m)),
        atk: Math.max(1, Math.floor(baseData.atk * m)),
        def: Math.max(1, Math.floor(baseData.def * m)),
        spd: Math.max(1, Math.floor(baseData.spd * m))
    };
};

// 保存インスタンス + 種族データ → バトルエンジンが食える形に展開する
const toBattleMonster = window.toBattleMonster = (instance, baseData, opts = {}) => {
    const tier = opts.tier || 'normal';
    // extraMult: フロア固有の追加補正（序盤の弱体個体など）
    const statMult = (window.ENEMY_STAT_MULTIPLIERS[tier] || 1) * (opts.extraMult || 1);
    const s = getEffectiveStats(instance, baseData);
    const hp = Math.floor(s.hp * statMult);
    return {
        ...baseData,
        uid: Math.random().toString(36).substr(2, 9),
        level: instance.level,
        hp,
        maxHp: hp,
        currentHp: opts.fullHeal ? hp : Math.min(instance.currentHp != null ? instance.currentHp : hp, hp),
        atk: Math.floor(s.atk * statMult),
        def: Math.floor(s.def * statMult),
        spd: Math.floor(s.spd * statMult),
        selectedMoves: (instance.equippedMoves && instance.equippedMoves.length)
            ? instance.equippedMoves
            : [window.STARTER_MOVES[baseData.type]],
        // 罠の持ち越し効果を戦闘開始状態へ反映する（SPEC 4.9 毒罠・弱体化罠）
        buffs: instance.pendingDebuff
            ? { atk: 0, def: 0, spd: 0, [instance.pendingDebuff]: -1 }
            : { atk: 0, def: 0, spd: 0 },
        isDamaged: false,
        isProtected: false,
        protectStreak: 0,
        lastTakenDamage: 0,
        lastTakenDamageSource: null,
        status: instance.pendingStatus || null
    };
};

// ------------------------------------------------------------
// 経験値・レベルアップ
// ------------------------------------------------------------
// 戻り値の pendingLearns は「技習得チェックポイントを跨いだ回数」。
// UIはこの回数だけプレイヤーに技選択を出す。
const grantExp = window.grantExp = (instance, amount) => {
    const before = instance.level;
    let level = instance.level;
    let exp = instance.exp + Math.max(0, Math.floor(amount));

    while (level < window.MAX_LEVEL && exp >= window.getRequiredExp(level)) {
        exp -= window.getRequiredExp(level);
        level++;
    }
    if (level >= window.MAX_LEVEL) exp = 0;

    return {
        instance: { ...instance, level, exp },
        leveledUp: level > before,
        fromLevel: before,
        toLevel: level,
        pendingLearns: window.getNewlyReachedCheckpoints(before, level).length
    };
};

// 技を1つ習得する（プレイヤーが選択したもの）
// 装備に空きがあれば自動で装備する。空きが無い場合は「覚えるだけ」で止め、
// どれと入れ替えるかは呼び出し側（UI）がプレイヤーに選ばせる。
// replace に装備中の技名を渡すと、その技と入れ替える。
const learnMove = window.learnMove = (instance, moveName, dbMoves, replace = null) => {
    // 覚えられる技が残っていない場合に null が渡ることがある（習得スキップ）
    if (!moveName) return instance;
    if (instance.knownMoves.includes(moveName)) return instance;

    const knownMoves = [...instance.knownMoves, moveName];
    let equippedMoves = instance.equippedMoves;

    if (replace && equippedMoves.includes(replace)) {
        equippedMoves = equippedMoves.map(m => (m === replace ? moveName : m));
    } else if (equippedMoves.length < 3) {
        equippedMoves = [...equippedMoves, moveName];
    }
    return { ...instance, knownMoves, equippedMoves };
};

// 装備が埋まっているか（習得時に入れ替え選択が必要かの判定）
const needsMoveReplace = window.needsMoveReplace = (instance) =>
    (instance.equippedMoves || []).length >= 3;

// 装備技を差し替える（拠点でのみ。最大3つ）
const setEquippedMoves = window.setEquippedMoves = (instance, moves) => {
    const valid = moves.filter(m => instance.knownMoves.includes(m)).slice(0, 3);
    return { ...instance, equippedMoves: valid.length ? valid : instance.equippedMoves };
};

// ------------------------------------------------------------
// セーブデータ
// ------------------------------------------------------------
const createDefaultSave = window.createDefaultSave = () => ({
    party: [],
    box: [],
    money: 300,
    items: {},
    currentFloorPosition: 1,
    clearedFloors: [],
    seenIds: [],
    version: 1
});

// 欠損フィールドを補完する（旧セーブ・部分保存への耐性）
const normalizeSave = window.normalizeSave = (raw) => {
    const d = createDefaultSave();
    if (!raw || typeof raw !== 'object') return d;
    return {
        party: Array.isArray(raw.party) ? raw.party : d.party,
        box: Array.isArray(raw.box) ? raw.box : d.box,
        money: typeof raw.money === 'number' ? raw.money : d.money,
        items: (raw.items && typeof raw.items === 'object') ? raw.items : d.items,
        currentFloorPosition: typeof raw.currentFloorPosition === 'number' ? raw.currentFloorPosition : d.currentFloorPosition,
        clearedFloors: Array.isArray(raw.clearedFloors) ? raw.clearedFloors : d.clearedFloors,
        seenIds: Array.isArray(raw.seenIds) ? raw.seenIds : d.seenIds,
        version: raw.version || d.version
    };
};

// ログイン時は Firestore、未ログイン時は localStorage にフォールバックする。
// （ログインなしでも遊べるようにするため。ログインすればセーブが同期される）
const loadAdventureSave = window.loadAdventureSave = async () => {
    const user = window.auth && window.auth.currentUser;
    if (user && window.db && window.fb) {
        try {
            const ref = window.fb.doc(window.db, "users", user.uid, "adventure", "save");
            const snap = await window.fb.getDoc(ref);
            if (snap.exists()) return normalizeSave(snap.data());
            return createDefaultSave();
        } catch (e) {
            console.warn('Firestore load failed, falling back to localStorage', e);
        }
    }
    try {
        const raw = localStorage.getItem(ADVENTURE_SAVE_KEY);
        return normalizeSave(raw ? JSON.parse(raw) : null);
    } catch (e) {
        return createDefaultSave();
    }
};

const saveAdventureSave = window.saveAdventureSave = async (save) => {
    const data = normalizeSave(save);
    try {
        localStorage.setItem(ADVENTURE_SAVE_KEY, JSON.stringify(data));
    } catch (e) { /* 容量超過などは致命的ではないので握りつぶす */ }

    const user = window.auth && window.auth.currentUser;
    if (user && window.db && window.fb) {
        try {
            const ref = window.fb.doc(window.db, "users", user.uid, "adventure", "save");
            await window.fb.setDoc(ref, data);
        } catch (e) {
            console.warn('Firestore save failed (kept local copy)', e);
        }
    }
    return data;
};

// アドベンチャーのセーブを削除して最初からやり直せるようにする。
// ログイン中は Firestore 側も空データで上書きしないと、次回ログイン時に復活してしまう。
// 対戦モードのチーム編成（versus_monsters_teams）には触らない。
const deleteAdventureSave = window.deleteAdventureSave = async () => {
    try { localStorage.removeItem(ADVENTURE_SAVE_KEY); } catch (e) { /* noop */ }

    const user = window.auth && window.auth.currentUser;
    if (user && window.db && window.fb) {
        try {
            const ref = window.fb.doc(window.db, "users", user.uid, "adventure", "save");
            await window.fb.setDoc(ref, createDefaultSave());
        } catch (e) {
            console.warn('Firestore reset failed (local copy was removed)', e);
            return { ok: false, reason: 'firestore' };
        }
    }
    return { ok: true };
};

// ------------------------------------------------------------
// 所持品・仲間の操作
// ------------------------------------------------------------
const addMonsterToSave = window.addMonsterToSave = (save, instance) => {
    const owned = [...save.party, ...save.box].some(m => m.id === instance.id);
    if (owned) return save; // 同一モンスターは1体のみ
    const next = { ...save, seenIds: [...new Set([...save.seenIds, instance.id])] };
    if (next.party.length < PARTY_LIMIT) next.party = [...next.party, instance];
    else next.box = [...next.box, instance];
    return next;
};

const addItem = window.addItem = (save, itemName, qty = 1) => ({
    ...save,
    items: { ...save.items, [itemName]: (save.items[itemName] || 0) + qty }
});

const consumeItem = window.consumeItem = (save, itemName) => {
    const have = save.items[itemName] || 0;
    if (have <= 0) return save;
    const items = { ...save.items };
    if (have === 1) delete items[itemName]; else items[itemName] = have - 1;
    return { ...save, items };
};

const buyItem = window.buyItem = (save, itemName) => {
    const item = window.SHOP_ITEMS.find(i => i.name === itemName);
    if (!item || save.money < item.price) return { save, ok: false };
    return { save: addItem({ ...save, money: save.money - item.price }, itemName), ok: true };
};
