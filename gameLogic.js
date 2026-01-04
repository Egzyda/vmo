// src/utils/gameLogic.js

const CONSTANTS = window.CONSTANTS = {
    WEAKNESS_MULTIPLIER: 1.5,
    RESISTANCE_MULTIPLIER: 0.5,
    HEAL_PERCENT: 0.30
};

const TYPE_COLORS = window.TYPE_COLORS = {
    '🔥': 'text-red-500 border-red-500 bg-red-900/40',
    '💧': 'text-blue-500 border-blue-500 bg-blue-900/40',
    '🌿': 'text-green-500 border-green-500 bg-green-900/40',
    '✨': 'text-yellow-400 border-yellow-400 bg-yellow-900/40',
    '🟣': 'text-purple-400 border-purple-400 bg-purple-900/40',
    '🌑': 'text-purple-400 border-purple-400 bg-purple-900/40',
    '⚪': 'text-gray-400 border-gray-400 bg-gray-800/40'
};

const TYPE_BG = window.TYPE_BG = {
     '🔥': 'bg-red-900', '💧': 'bg-blue-900', '🌿': 'bg-green-900',
     '✨': 'bg-yellow-900', '🟣': 'bg-purple-900', '🌑': 'bg-purple-900', '⚪': 'bg-gray-800'
};

const TYPE_NAMES = window.TYPE_NAMES = { '🔥': '炎', '💧': '水', '🌿': '草', '✨': '光', '🟣': '闇', '🌑': '闇', '⚪': '無' };
const TYPES = window.TYPES = { FIRE: '🔥', WATER: '💧', GRASS: '🌿', LIGHT: '✨', DARK: '🟣', NONE: '⚪' };

const getTypeMultiplier = window.getTypeMultiplier = (moveType, defType, specialType = null) => {
    if (moveType === TYPES.NONE && !specialType) return 1.0;

    if (specialType === 'ice') {
        const isFire = (t) => t === TYPES.FIRE;
        const isGrass = (t) => t === TYPES.GRASS;
        const isWater = (t) => t === TYPES.WATER; // 追加: 水属性判定

        if (isGrass(defType)) return CONSTANTS.WEAKNESS_MULTIPLIER;
        if (isFire(defType)) return CONSTANTS.RESISTANCE_MULTIPLIER;
        if (isWater(defType)) return CONSTANTS.RESISTANCE_MULTIPLIER; // 追加: 対水で半減
        return 1.0;
    }

    if (moveType === defType) return CONSTANTS.RESISTANCE_MULTIPLIER;
    const isFire = (t) => t === TYPES.FIRE;
    const isWater = (t) => t === TYPES.WATER;
    const isGrass = (t) => t === TYPES.GRASS;
    const isLight = (t) => t === TYPES.LIGHT;
    const isDark = (t) => t === TYPES.DARK || t === '🌑';

    if (isFire(moveType)) return isGrass(defType) ? CONSTANTS.WEAKNESS_MULTIPLIER : (isWater(defType) ? CONSTANTS.RESISTANCE_MULTIPLIER : 1.0);
    if (isWater(moveType)) return isFire(defType) ? CONSTANTS.WEAKNESS_MULTIPLIER : (isGrass(defType) ? CONSTANTS.RESISTANCE_MULTIPLIER : 1.0);
    if (isGrass(moveType)) return isWater(defType) ? CONSTANTS.WEAKNESS_MULTIPLIER : (isFire(defType) ? CONSTANTS.RESISTANCE_MULTIPLIER : 1.0);
    if (isLight(moveType)) return isDark(defType) ? CONSTANTS.WEAKNESS_MULTIPLIER : 1.0;
    if (isDark(moveType)) return isLight(defType) ? CONSTANTS.WEAKNESS_MULTIPLIER : 1.0;
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