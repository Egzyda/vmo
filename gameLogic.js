// src/utils/gameLogic.js

const CONSTANTS = window.CONSTANTS = {
    WEAKNESS_MULTIPLIER: 1.5,
    RESISTANCE_MULTIPLIER: 0.5,
    HEAL_PERCENT: 0.30
};

const TYPES = window.TYPES = {
    FIRE: 'fire', WATER: 'water', GRASS: 'grass',
    LIGHT: 'light', DARK: 'dark', NONE: 'normal'
};

// 旧データ(絵文字ID)との後方互換。
// localStorage / Firestore に保存済みのパーティは絵文字typeを持つため、
// 読み込み時に normalizeType() を通して英語IDへ寄せる。
const LEGACY_TYPE_MAP = window.LEGACY_TYPE_MAP = {
    '🔥': 'fire', '💧': 'water', '🌿': 'grass',
    '✨': 'light', '🟣': 'dark', '🌑': 'dark', '⚪': 'normal'
};

const normalizeType = window.normalizeType = (type) => LEGACY_TYPE_MAP[type] || type;

// パーティ配列内の各モンスターのtypeを英語IDへ正規化する（保存データ読み込み用）
const normalizePartyTypes = window.normalizePartyTypes = (party) => {
    if (!Array.isArray(party)) return party;
    return party.map(mon => (mon && mon.type) ? { ...mon, type: normalizeType(mon.type) } : mon);
};

const TYPE_COLORS = window.TYPE_COLORS = {
    'fire': 'text-red-500 border-red-500 bg-red-900/40',
    'water': 'text-blue-500 border-blue-500 bg-blue-900/40',
    'grass': 'text-green-500 border-green-500 bg-green-900/40',
    'light': 'text-yellow-400 border-yellow-400 bg-yellow-900/40',
    'dark': 'text-purple-400 border-purple-400 bg-purple-900/40',
    'normal': 'text-gray-400 border-gray-400 bg-gray-800/40'
};

const TYPE_BG = window.TYPE_BG = {
    'fire': 'bg-red-900', 'water': 'bg-blue-900', 'grass': 'bg-green-900',
    'light': 'bg-yellow-900', 'dark': 'bg-purple-900', 'normal': 'bg-gray-800'
};

// 表示は漢字一文字バッジ（絵文字は使用しない）
const TYPE_NAMES = window.TYPE_NAMES = {
    'fire': '炎', 'water': '水', 'grass': '草',
    'light': '光', 'dark': '闇', 'normal': '無'
};

const getTypeMultiplier = window.getTypeMultiplier = (moveType, defType, specialType = null) => {
    // 保存データ由来の絵文字IDが混ざっても正しく判定できるよう正規化する
    moveType = normalizeType(moveType);
    defType = normalizeType(defType);

    if (moveType === TYPES.NONE && !specialType) return 1.0;

    if (specialType === 'ice') {
        if (defType === TYPES.GRASS) return CONSTANTS.WEAKNESS_MULTIPLIER;
        if (defType === TYPES.FIRE) return CONSTANTS.RESISTANCE_MULTIPLIER;
        if (defType === TYPES.WATER) return CONSTANTS.RESISTANCE_MULTIPLIER;
        return 1.0;
    }

    if (moveType === defType) return CONSTANTS.RESISTANCE_MULTIPLIER;

    if (moveType === TYPES.FIRE) return defType === TYPES.GRASS ? CONSTANTS.WEAKNESS_MULTIPLIER : (defType === TYPES.WATER ? CONSTANTS.RESISTANCE_MULTIPLIER : 1.0);
    if (moveType === TYPES.WATER) return defType === TYPES.FIRE ? CONSTANTS.WEAKNESS_MULTIPLIER : (defType === TYPES.GRASS ? CONSTANTS.RESISTANCE_MULTIPLIER : 1.0);
    if (moveType === TYPES.GRASS) return defType === TYPES.WATER ? CONSTANTS.WEAKNESS_MULTIPLIER : (defType === TYPES.FIRE ? CONSTANTS.RESISTANCE_MULTIPLIER : 1.0);
    if (moveType === TYPES.LIGHT) return defType === TYPES.DARK ? CONSTANTS.WEAKNESS_MULTIPLIER : 1.0;
    if (moveType === TYPES.DARK) return defType === TYPES.LIGHT ? CONSTANTS.WEAKNESS_MULTIPLIER : 1.0;
    return 1.0;
};

const getStatMultiplier = window.getStatMultiplier = (stage) => {
    if (stage >= 2) return 2.0;
    if (stage === 1) return 1.5;
    if (stage === 0) return 1.0;
    if (stage === -1) return 0.75;
    if (stage <= -2) return 0.5;
    return 1.0;
};

const createLCG = window.createLCG = (seed) => {
    return () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
    };
};
