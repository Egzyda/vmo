// AdventureCapture.js - 捕獲システム（アドベンチャー専用、対戦モードのデータ/ロジックには触れない）
// SPEC.md 4.5 仲間加入 / 4.10 敵編成 に対応

const CAPTURE_RATES = window.CAPTURE_RATES = {
    normal: 0.30, // 通常の野生ヴァーモン
    elite: 0.15,  // 強化個体・研究員戦（SPEC 4.10で追加。捕獲率は暫定値、要調整）
    boss: 0.10    // フロアボス
};

const CAPTURE_ITEM_MULTIPLIERS = window.CAPTURE_ITEM_MULTIPLIERS = {
    "フレンドチャーム": 1.5,
    "マスターチャーム": 3.0
};

// 捕獲成功率を計算（0〜1にクランプ）
const getCaptureRate = window.getCaptureRate = (tier, itemName = null) => {
    const base = CAPTURE_RATES[tier];
    if (base === undefined) throw new Error(`Unknown capture tier: ${tier}`);
    const mult = itemName ? (CAPTURE_ITEM_MULTIPLIERS[itemName] || 1) : 1;
    return Math.min(1, base * mult);
};

// 同一モンスターは1体のみ（SPEC 4.5）
const isAlreadyOwned = window.isAlreadyOwned = (monsterId, ownedIds) => {
    return ownedIds.includes(monsterId);
};

// 捕獲を試みる。野生ヴァーモンを撃破した後に呼ぶ想定（研究員トレーナー戦は対象外）
const attemptCapture = window.attemptCapture = ({ monsterId, tier, itemName = null, ownedIds = [], rng = Math.random }) => {
    if (isAlreadyOwned(monsterId, ownedIds)) {
        return { success: false, reason: 'already_owned', rate: 0 };
    }
    const rate = getCaptureRate(tier, itemName);
    const success = rng() < rate;
    return { success, reason: success ? null : 'failed', rate };
};
