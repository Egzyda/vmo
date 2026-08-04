// AdventureCapture.js - 捕獲システム（アドベンチャー専用、対戦モードのデータ/ロジックには触れない）
// SPEC.md 4.5 仲間加入 に対応

const CAPTURE_RATES = window.CAPTURE_RATES = {
    normal: 0.30, // 通常の野生ヴァーモン
    elite: 0.15,  // 強化個体（エリート戦闘）
    boss: 0.10    // フロアボス
};

// 同調デバイス（捕獲率アイテム）。Mk-Vのみ確定捕獲でレベル補正を無視する。
// レベル補正後の捕獲率に「固定で加算」する方式（旧版は倍率だったため、
// レベル補正で捕獲率が下がるほどデバイスの効果まで目減りし、
// 高レベル相手ほどデバイスの価値を感じられない問題があった）
const CAPTURE_DEVICES = window.CAPTURE_DEVICES = {
    "同調デバイス Mk-I": 0.10,
    "同調デバイス Mk-II": 0.20,
    "同調デバイス Mk-III": 0.35,
    "同調デバイス Mk-IV": 0.55,
    "同調デバイス Mk-V": "guaranteed"
};

// 相手レベルが高いほど捕まりにくい（Lv1で1.0倍、Lv100で下限0.3倍）
const getCaptureLevelPenalty = window.getCaptureLevelPenalty = (targetLevel) => {
    const lv = Math.max(1, targetLevel || 1);
    return Math.max(0.3, 1 - (lv - 1) * 0.008);
};

// 捕獲成功率を計算（0〜1にクランプ）
const getCaptureRate = window.getCaptureRate = (tier, targetLevel = 1, deviceName = null) => {
    const device = deviceName ? CAPTURE_DEVICES[deviceName] : 0;
    if (device === "guaranteed") return 1.0;

    const base = CAPTURE_RATES[tier];
    if (base === undefined) throw new Error(`Unknown capture tier: ${tier}`);

    return Math.min(1, base * getCaptureLevelPenalty(targetLevel) + (device || 0));
};

// 同一モンスターは1体のみ（SPEC 4.5）
const isAlreadyOwned = window.isAlreadyOwned = (monsterId, ownedIds) => {
    return (ownedIds || []).includes(monsterId);
};

// 捕獲を試みる。野生ヴァーモンを撃破した後に呼ぶ想定
// （研究員トレーナー戦は人間なので捕獲対象外）
const attemptCapture = window.attemptCapture = ({
    monsterId, tier, targetLevel = 1, deviceName = null, ownedIds = [], rng = Math.random
}) => {
    if (isAlreadyOwned(monsterId, ownedIds)) {
        return { success: false, reason: 'already_owned', rate: 0 };
    }
    const rate = getCaptureRate(tier, targetLevel, deviceName);
    const success = rng() < rate;
    return { success, reason: success ? null : 'failed', rate };
};
