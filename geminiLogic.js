const { GoogleGenerativeAI, getStatMultiplier, getTypeMultiplier } = window;

const API_KEY = "AIzaSyDhhnL7K7-7lvvTe8nt0wejtP0qy8I8GdQ";

const genAI = new GoogleGenerativeAI(API_KEY);

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const extractJson = (text) => {
    try {
        let cleanText = text.replace(/```json\n?|\n?```/g, '').trim();
        const firstOpen = cleanText.indexOf('{');
        const lastClose = cleanText.lastIndexOf('}');
        if (firstOpen !== -1 && lastClose !== -1) {
            cleanText = cleanText.substring(firstOpen, lastClose + 1);
        }
        return JSON.parse(cleanText);
    } catch (e) {
        return null;
    }
};

const getEffectiveSpeed = (mon) => {
    return mon.spd * getStatMultiplier(mon.buffs.spd);
};

const isFaster = (actor, target, isDistortion) => {
    const s1 = getEffectiveSpeed(actor);
    const s2 = getEffectiveSpeed(target);
    if (isDistortion) return s1 < s2;
    return s1 > s2;
};

// 基本ダメージ計算
const calculateRawDamage = (attacker, defender, moveData) => {
    if (!moveData || moveData.category === 'status') return 0;

    // HP割合ダメージ等の特殊処理
    if (moveData.category === 'special_damage') {
        if (moveData.effect === 'half_hp') return Math.floor(defender.currentHp * 0.5);
        return 0;
    }

    const atk = attacker.atk * getStatMultiplier(attacker.buffs.atk);
    const def = defender.def * getStatMultiplier(defender.buffs.def);
    let power = moveData.power || 0;

    // 特効: 相手HP満タンで威力2倍
    if (moveData.effect === 'full_hp_double' && defender.currentHp === defender.maxHp) power *= 2;

    const typeMod = getTypeMultiplier(moveData.type, defender.type, moveData.special_type);

    // ダメージ計算式 (乱数幅0.95想定)
    return Math.floor((atk * power / def / 2) * typeMod * 0.95);
};

// 被ダメージ予測 (最大ダメージ算出)
const predictMaxIncomingDamage = (defender, enemies, dbMoves) => {
    let maxDmg = 0;
    enemies.forEach(enemy => {
        if (!enemy || enemy.currentHp <= 0) return;
        enemy.selectedMoves.forEach(mName => {
            const mData = dbMoves[mName];
            if (mData && (mData.category === 'physical' || mData.category === 'special_damage')) {
                const dmg = calculateRawDamage(enemy, defender, mData);
                if (dmg > maxDmg) maxDmg = dmg;
            }
        });
    });
    return maxDmg;
};

// 与ダメージ予測 (最大ダメージ算出)
const predictMaxOutgoingDamage = (attacker, defender, dbMoves) => {
    let maxDmg = 0;
    attacker.selectedMoves.forEach(mName => {
        const mData = dbMoves[mName];
        if (mData && (mData.category === 'physical' || mData.category === 'special_damage')) {
            const dmg = calculateRawDamage(attacker, defender, mData);
            if (dmg > maxDmg) maxDmg = dmg;
        }
    });
    return maxDmg;
};

/**
 * プロンプト作成関数 (Phase 4.6: Synergy & Support Logic Added)
 */
const createPrompt = (actor, aiState, playerState, fieldStatus, isDistortion, dbMoves) => {

    const myActiveMons = aiState.filter((m, i) => fieldStatus.myField.includes(i) && m.currentHp > 0);
    const enemyActiveMons = playerState.filter((m, i) => fieldStatus.enemyField.includes(i) && m.currentHp > 0);
    const isLastStand = aiState.filter(m => m.currentHp > 0).length === 1;

    // ---------------------------------------------------------
    // 1. 耐久力計算 (Survival Check)
    // ---------------------------------------------------------
    const maxIncomingDmg = predictMaxIncomingDamage(actor, enemyActiveMons, dbMoves);

    // 確定耐え数 (ダメージ0なら99回)
    const turnsToSurvive = maxIncomingDmg > 0 ? Math.floor(actor.currentHp / maxIncomingDmg) : 99;
    const isLethal = actor.currentHp <= maxIncomingDmg; // 即死圏内か

    // 「2発耐える」の基準
    const canSurviveTwoHits = actor.currentHp > (maxIncomingDmg * 2);

    // ---------------------------------------------------------
    // 2. 敵情報の構築
    // ---------------------------------------------------------
    let tacticalSituations = [];

    const playerInfo = enemyActiveMons.map((m) => {
        const iMoveFirst = isFaster(actor, m, isDistortion);
        const speedRel = iMoveFirst ? "【自分先行】" : "【敵先行】";

        let threatTags = [speedRel];
        if (m.buffs.atk >= 1) threatTags.push("【火力UP中】");
        if (m.isProtected) threatTags.push("【守備中】");

        const myMaxDmg = predictMaxOutgoingDamage(actor, m, dbMoves);
        if (myMaxDmg >= m.currentHp) threatTags.push("★撃破可能★");

        return `- ${m.name} (HP:${m.currentHp}/${m.maxHp}) ${threatTags.join(' ')}`;
    }).join('\n');

    // ---------------------------------------------------------
    // 3. 戦術判定 & 交代判断 (Priority Switch)
    // ---------------------------------------------------------

    // ▼▼▼ 交代ロジック (Switch Priority) ▼▼▼
    if (isLethal && !isLastStand) {
        const benchMons = aiState.filter((m, i) => !fieldStatus.myField.includes(i) && m.currentHp > 0);

        const safeSwitchCandidate = benchMons.find(benchMon => {
             const estimatedDmg = predictMaxIncomingDamage(benchMon, enemyActiveMons, dbMoves);
             return benchMon.currentHp > estimatedDmg * 2;
        });

        if (safeSwitchCandidate) {
            tacticalSituations.push(`★PRIORITY_OVERRIDE: 警告！このターンで撃破される予測が出ている。守るよりも、耐久のある「${safeSwitchCandidate.name}」への交代(SWITCH)を最優先せよ。`);
        }
    } else if (!canSurviveTwoHits && !isLastStand) {
        const benchMons = aiState.filter((m, i) => !fieldStatus.myField.includes(i) && m.currentHp > 0);
        const safeSwitchCandidate = benchMons.find(benchMon => {
             const estimatedDmg = predictMaxIncomingDamage(benchMon, enemyActiveMons, dbMoves);
             return benchMon.currentHp > estimatedDmg * 1.5;
        });
        if (safeSwitchCandidate) {
            tacticalSituations.push(`★SWITCH_ADVICE: 不利対面。余裕があれば「${safeSwitchCandidate.name}」へ交代を検討せよ。`);
        }
    }

    // ▼▼▼ ダブル守る禁止 & 読み合い (Double Protect & Mind Games) ▼▼▼
    const partner = myActiveMons.find(m => m !== actor);
    let partnerLikelyProtect = false;

    if (partner) {
        const pIncoming = predictMaxIncomingDamage(partner, enemyActiveMons, dbMoves);
        if (partner.currentHp <= pIncoming || partner.currentHp / partner.maxHp < 0.25) {
            if (partner.selectedMoves.some(m => dbMoves[m]?.effect === 'protect') && partner.protectStreak === 0) {
                partnerLikelyProtect = true;
            }
        }
    }

    if (partnerLikelyProtect) {
        tacticalSituations.push(`★RESTRICTION: 相方(${partner.name})がピンチであり「守る」を使用する可能性が高い。「ダブル守る」失敗を防ぐため、あなたは絶対に「守る」を選択してはならない。`);
    }

    let preventProtect = false;
    if (actor.protectStreak > 0) {
        preventProtect = true;
        tacticalSituations.push("★RULE: 連続で「守る」は成功しないため選択禁止。");
    }

    let forceAggro = false;
    if (isLethal && !preventProtect && !partnerLikelyProtect) {
        if (Math.random() < 0.5) {
            forceAggro = true;
            tacticalSituations.push(`★MIND_GAME: あなたは瀕死だが、相手は「守る」を読んでいる。裏をかいて「守らずに攻撃(または交代)」を選択せよ。リスクを負ってアドバンテージを取れ。`);
        }
    }

    if (isLastStand) tacticalSituations.push("★CRITICAL: ラスト1体。攻撃こそ最大の防御。");

    // ---------------------------------------------------------
    // 4. 技シミュレーション (Synergy Logic Added)
    // ---------------------------------------------------------
    const moveSimulations = actor.selectedMoves.map(moveName => {
        const data = dbMoves ? dbMoves[moveName] : null;
        if (!data) return `  - ${moveName}: データなし`;

        let simResult = `  - 技名:「${moveName}」`;

        if (data.effect === 'trick_room') simResult += " 【空間操作】";
        else if (data.effect === 'protect') {
            if (preventProtect) {
                simResult += " 【🚫禁止:連続使用🚫】";
            } else if (partnerLikelyProtect) {
                simResult += " 【🚫禁止:相方守る🚫】";
            } else if (forceAggro) {
                simResult += " 【⚠️非推奨:読み合い攻撃優先⚠️】";
            } else {
                simResult += " 【防御】";
            }
        }
        else if (data.category === 'status') {
            simResult += " (補助)";

            // ▼▼▼ 味方へのシナジー判定 (Synergy Check) ▼▼▼
            if (data.target === 'ally' && partner && partner.currentHp > 0) {

                // 1. 素早さバフ (アクセルステップ等)
                if (data.effect === 'buff_spd') {
                    // バフ後の味方の素早さをシミュレート
                    const currentBoost = partner.buffs.spd;
                    const boostedPartner = { ...partner, buffs: { ...partner.buffs, spd: Math.min(6, currentBoost + 1) } };

                    // 「今は抜けない」が「バフれば抜ける」敵を探す
                    const speedBreaks = enemyActiveMons.filter(enemy => {
                        const nowFaster = isFaster(partner, enemy, isDistortion);
                        const thenFaster = isFaster(boostedPartner, enemy, isDistortion);
                        return !nowFaster && thenFaster;
                    });

                    if (speedBreaks.length > 0) {
                        const targetNames = speedBreaks.map(e => e.name).join(',');
                        simResult += ` ★SYNERGY_SPEED: ${partner.name}が[${targetNames}]を抜ける！先手で制圧せよ。★`;
                    }
                }

                // 2. 攻撃バフ (パワーチャージ等)
                else if (data.effect === 'buff_atk') {
                    const currentBoost = partner.buffs.atk;
                    // バフ後の味方でダメージ計算
                    const boostedPartner = { ...partner, buffs: { ...partner.buffs, atk: Math.min(6, currentBoost + 1) } };

                    // 「今は倒せない」が「バフれば倒せる」敵を探す
                    const killOpportunities = enemyActiveMons.filter(enemy => {
                        const currentMaxDmg = predictMaxOutgoingDamage(partner, enemy, dbMoves);
                        const boostedMaxDmg = predictMaxOutgoingDamage(boostedPartner, enemy, dbMoves);

                        return (currentMaxDmg < enemy.currentHp) && (boostedMaxDmg >= enemy.currentHp);
                    });

                    if (killOpportunities.length > 0) {
                        const targetNames = killOpportunities.map(e => e.name).join(',');
                        simResult += ` ★SYNERGY_KILL: ${partner.name}の攻撃で[${targetNames}]を確殺できる！一撃必殺を狙え。★`;
                    }
                }
            }
            // ▲▲▲ シナジー判定終了 ▲▲▲

            // 自分へのバフ判定（既存ロジック）
            if (data.effect && data.effect.startsWith('buff_') && data.target === 'self') {
                const stat = data.effect.replace('buff_', '');
                if (actor.buffs[stat] < 2) {
                    if (canSurviveTwoHits) simResult += " ★SETUP: 耐久十分。積んで有利になれ。★";
                    else simResult += " (使用非推奨: 耐久不足)";
                } else {
                    simResult += " (効果なし:最大)";
                }
            }
            else if (data.effect === 'heal') {
                if (!canSurviveTwoHits) simResult += " ★RECOVERY: 瀕死。直ちに回復せよ。★";
            }
        }
        else {
            // 攻撃技
            simResult += ` (威力${data.power})`;
            if (data.target === 'all_enemies') simResult += " 【全体】";

            if (data.category === 'physical' || data.category === 'special_damage') {
                simResult += " 予測:";
                enemyActiveMons.forEach(target => {
                    if (target.isProtected) {
                         simResult += ` [vs ${target.name}: 無効]`;
                         return;
                    }
                    const dmg = calculateRawDamage(actor, target, data);
                    const isKill = dmg >= target.currentHp;
                    const iMoveFirst = isFaster(actor, target, isDistortion);

                    let killTag = "";
                    if (isKill) {
                        if (iMoveFirst) killTag = " ★AGGRO_KILL(先手確殺)★";
                        else killTag = " ★KILL(相打ち)★";
                    }
                    simResult += ` [vs ${target.name}: ${dmg}ダメ${killTag}]`;
                });
            }
        }
        return simResult;
    }).join('\n');

    return `
あなたは対戦ゲーム「Versus Monsters」の**冷徹な戦術AI**です。
以下の戦況分析とプログラムからの「戦術推奨(PRIORITY)」に従い、JSON形式で一手を選択してください。

【戦況データ】
■ 行動: **${actor.name}** (HP:${actor.currentHp}) ${isLastStand ? "【最後の一匹】" : ""}
■ 耐久予測: 敵の最大火力${maxIncomingDmg}に対して、あと${turnsToSurvive}回耐えられる。
   ${canSurviveTwoHits ? "→【耐久確保済】: バフを積む余裕がある。" : "→【耐久警告】: 余裕なし。攻撃か回復か交代を優先。"}

■ 敵チーム:
${playerInfo}

【戦術推奨 (絶対順守)】
${tacticalSituations.length > 0 ? tacticalSituations.join('\n') : "特になし: 状況に応じて判断せよ。"}

【技リスト】
${moveSimulations}

【思考プロセス】
1. **禁止** や **RESTRICTION** と書かれた行動は絶対選ぶな。
2. **PRIORITY_OVERRIDE** (交代推奨) が出ている場合、防御(protect)を選ばずに「交代(switch)」を選択せよ。
3. **SYNERGY** (シナジー) タグが出ている技は、個人の攻撃よりも優先度が高い場合がある。チーム全体の勝利を考えよ。
4. **MIND_GAME** (読み合い) 指示がある場合、守るを選択せず、攻撃または交代でリスクを取れ。
5. **AGGRO_KILL** (確殺) があるなら、小細工せずに攻撃して数を減らせ。

【回答形式】
JSONのみ出力せよ。
{
  "reasoning": "理由",
  "action": {
    "type": "move" または "switch",
    "moveName": "技名",
    "targetSlot": 0 または 1,
    "targetIndex": 交代先のパーティ内インデックス(switchの場合)
  }
}
`;
};

const getGeminiAction = window.getGeminiAction = async (actorIndex, actorSlot, aiState, playerState, myField, playerField, isDistortion, dbMoves) => {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const actor = aiState[actorIndex];
            if (!actor || actor.currentHp <= 0) return null;

            const model = genAI.getGenerativeModel({
                model: "gemini-flash-latest",
                generationConfig: {
                    temperature: 0.2,
                    topP: 0.95,
                    topK: 40,
                    responseMimeType: "application/json"
                }
            });

            if (!dbMoves) return null;

            // フィールド情報の正規化
            const fieldStatus = { myField, enemyField: playerField };

            const prompt = createPrompt(actor, aiState, playerState, fieldStatus, isDistortion, dbMoves);

            const result = await model.generateContent(prompt);
            const text = result.response.text();

            const decision = extractJson(text);

            if (!decision) throw new Error("Invalid JSON structure");

            console.log(`🤖 Gemini Tactician (${actor.name}):`, decision.reasoning);

            return {
                ...decision.action,
                side: 'enemy',
                actorSlot: actorSlot,
                reasoning: decision.reasoning
            };

        } catch (error) {
            if (error.message.includes('503') || error.message.includes('overloaded') || error.message.includes('429')) {
                console.warn(`Gemini Retrying... (${attempt + 1}/3)`);
                await wait(2000);
                continue;
            }
            console.error("Gemini Error:", error);
            return null;
        }
    }
    return null;
};

// ▼▼▼ 選出ロジック ▼▼▼
const createLeadPrompt = (aiParty, playerParty) => {
    const aiInfo = aiParty.map((m, i) => `ID:${i} Name:${m.name} (Type:${m.type} / Spd:${m.spd} / Moves:[${m.selectedMoves.join(',')}])`).join('\n');
    const playerInfo = playerParty.map((m, i) => `ID:${i} Name:${m.name} (Type:${m.type} / Spd:${m.spd})`).join('\n');

    return `
あなたは対戦ゲーム「Versus Monsters」のAI監督です。
バトルの先発メンバー（2体）を決めてください。

【味方チーム】
${aiInfo}
【相手チーム】
${playerInfo}

【選出指針】
1. ギミック始動役（ディストーション等）は必須。最優先で選べ。
2. 相手の弱点を突ける、または「Spdが高い」アグロなキャラを選べ。

【回答形式】
JSONのみ出力。
{
  "reasoning": "理由",
  "leadIndices": [0, 2]
}
`;
};

// これがエクスポートされていないとエラーになります
const getGeminiLead = window.getGeminiLead = async (aiParty, playerParty) => {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const model = genAI.getGenerativeModel({
                model: "gemini-flash-latest",
                generationConfig: {
                    temperature: 0.1,
                    responseMimeType: "application/json"
                }
            });
            const prompt = createLeadPrompt(aiParty, playerParty);
            const result = await model.generateContent(prompt);
            const text = result.response.text();

            const decision = extractJson(text);
            if (!decision) throw new Error("Invalid JSON structure");

            console.log(`🤖 Gemini Coach:`, decision.reasoning);
            const leads = decision.leadIndices;
            if (!Array.isArray(leads) || leads.length !== 2) return null;
            let newParty = [];
            newParty.push(aiParty[leads[0]]);
            newParty.push(aiParty[leads[1]]);
            aiParty.forEach((m, i) => { if (i !== leads[0] && i !== leads[1]) newParty.push(m); });
            return newParty;
        } catch (error) {
            if (error.message.includes('503') || error.message.includes('overloaded')) {
                await wait(2000); continue;
            }
            return null;
        }
    }
    return null;
};