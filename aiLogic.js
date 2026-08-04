const { getStatMultiplier, getTypeMultiplier } = window;

/**
 * ---------------------------------------------------------
 * Helper Functions: Basic Calculations
 * ---------------------------------------------------------
 */

/**
 * 実質素早さを計算する (ランク補正込み)
 */
const getEffectiveSpeed = (mon) => {
    return mon.spd * getStatMultiplier(mon.buffs.spd);
};

/**
 * 先攻判定ヘルパー
 * isDistortion(トリル)の状態に応じて、どちらが先に行動するかを判定
 * @returns {boolean} actorがtargetより先手ならtrue
 */
const isFaster = (actor, target, isDistortion) => {
    const s1 = getEffectiveSpeed(actor);
    const s2 = getEffectiveSpeed(target);
    // 同速の場合は乱数ではなく、プレイヤー側有利(false)あるいはAI側有利とするかですが
    // ここでは厳密に数値比較のみ行います
    if (isDistortion) {
        return s1 < s2; // トリル下では遅い方が速い
    }
    return s1 > s2; // 通常時は速いほうが速い
};

/**
 * ダメージ計算ヘルパー
 */
const calculateDamage = (attacker, defender, moveData, atkStage = null, defStage = null) => {
    const aStage = atkStage !== null ? atkStage : attacker.buffs.atk;
    const dStage = defStage !== null ? defStage : defender.buffs.def;
    const atk = attacker.atk * getStatMultiplier(aStage);
    const def = defender.def * getStatMultiplier(dStage);
    let power = moveData.power;
    if (moveData.effect === 'full_hp_double' && defender.currentHp === defender.maxHp) power *= 2;
    const typeMod = getTypeMultiplier(moveData.type, defender.type, moveData.special_type);

    // 命中率は一律100として計算（簡略化）、乱数幅の平均に近い0.95を掛ける
    return Math.floor((atk * power / def / 2) * typeMod * 0.95);
};

/**
 * 敵からの最大被ダメージを予測する
 */
const predictIncomingDamage = (actor, playerState, playerField, dbMoves) => {
    let maxDmg = 0;
    playerField.forEach(pidx => {
        if (pidx !== -1 && playerState[pidx].currentHp > 0) {
            const enemy = playerState[pidx];
            enemy.selectedMoves.forEach(m => {
                 const md = dbMoves[m];
                 if (md && (md.category === 'physical' || md.category === 'special_damage')) {
                    const dmg = calculateDamage(enemy, actor, md);
                    if (dmg > maxDmg) maxDmg = dmg;
                 }
            });
        }
    });
    return maxDmg;
};

/**
 * ---------------------------------------------------------
 * Core Logic: Evaluate Action
 * Phase 4: Tactical Update Implementation
 * ---------------------------------------------------------
 */
const evaluateAction = (moveData, actor, targetSlot, aiState, playerState, myField, playerField, isDistortion, dbMoves) => {
    let score = 0;

    // 現在のフィールドにいる生存している敵のリスト
    const activeEnemies = playerField
        .filter(idx => idx !== -1)
        .map(idx => playerState[idx])
        .filter(mon => mon.currentHp > 0);

    // ターゲットの特定
    let targets = [];
    if (moveData.target === 'all_enemies' || moveData.target === 'all') {
        playerField.forEach((idx, slot) => { if (idx !== -1 && playerState[idx].currentHp > 0) targets.push({ mon: playerState[idx], slot }); });
    } else if (moveData.target === 'field' || moveData.target === 'self') {
        targets.push({ mon: actor, slot: -1 });
    } else if (targetSlot !== null) {
        const tIdx = playerField[targetSlot];
        if (tIdx !== -1 && playerState[tIdx].currentHp > 0) {
            targets.push({ mon: playerState[tIdx], slot: targetSlot });
        }
    }

    // ターゲット不在なら評価しない
    if (targets.length === 0 && moveData.target !== 'field' && moveData.target !== 'self') return -9999;

    // 生存している味方（自分含む）の数
    const aliveAlliesCount = aiState.filter(m => m.currentHp > 0).length;

    // ---------------------------------------------------------
    // 1 & 2. ディストーション (Trick Room) 戦略
    // ---------------------------------------------------------
    if (moveData.effect === 'trick_room') {
        if (isDistortion) return -9999; // 既に展開中なら使わない

        // 仕様2: 実質素早さで「先手を取られている」場合のみ発動
        // 自分が、敵の誰か一人よりも「遅い」なら発動価値あり
        // 逆に、全ての敵に対して「速い」なら発動する意味なし（利敵行為防止）
        const amISlowerThanSomeone = activeEnemies.some(enemy => !isFaster(actor, enemy, false)); // false=通常時判定

        if (!amISlowerThanSomeone && activeEnemies.length > 0) {
            // 俺の方が全員より速いじゃん！なら使わない
            return -500;
        }

        return 50000; // 発動優先
    }

    // ---------------------------------------------------------
    // 3 & 5 & 6. プロテクション (Survival / Stall / Risk)
    // ---------------------------------------------------------
    if (moveData.effect === 'protect') {
        // 連続使用制限
        if (actor.protectStreak > 0) return -9999;

        // 味方が全滅し、自分が最後の1体なら守らない（時間稼ぎは無意味）
        if (aliveAlliesCount === 1) {
            return -500;
        }

        const incomingDmg = predictIncomingDamage(actor, playerState, playerField, dbMoves);
        const hpRate = actor.currentHp / actor.maxHp;
        const isLethal = incomingDmg >= actor.currentHp;

        // 無駄撃ち防止: ダメージ0で、HPに余裕があるなら守らない
        if (incomingDmg === 0 && hpRate > 0.5) {
            return -5000;
        }

        // ▼▼▼ ダブル守るの完全禁止チェック ▼▼▼
        // 相方(パートナー)の状態を確認
        const partnerIdx = myField.find(idx => idx !== -1 && aiState[idx] !== actor);

        if (partnerIdx !== undefined) {
            const partner = aiState[partnerIdx];
            if (partner.currentHp > 0) {
                // 相方は守れる状態(クールダウン無し)か？
                const partnerCanProtect = partner.protectStreak === 0 && partner.selectedMoves.some(m => dbMoves[m]?.effect === 'protect');

                if (partnerCanProtect) {
                    const partnerIncoming = predictIncomingDamage(partner, playerState, playerField, dbMoves);
                    const partnerIsLethal = partnerIncoming >= partner.currentHp;
                    const partnerIsPanic = partner.currentHp / partner.maxHp < 0.25;

                    // 相方が「即死」または「瀕死」で、かつ「守れる」状態なら
                    // 相方は確実に守りたいはずなので、自分は絶対に守らない（権利を譲る）
                    if (partnerIsLethal || partnerIsPanic) {
                        return -9999;
                    }
                }
            }
        }

        // ▼▼▼ プロテクション判断 (50%読み合い実装) ▼▼▼

        // パターンA: 即死ダメージ (Lethal)
        if (isLethal) {
            // 即死確定の場面でも、50%の確率で「あえて守らない」選択をする。
            // これにより「こいつは瀕死だから100%守るはずだ」というプレイヤーの読みを外す。
            if (Math.random() < 0.5) {
                return -500; // 守らず、攻撃や交代判定へ回す
            }
            return 20000; // 基本的には守りたい (ただし交代スコア25000よりは低い)
        }

        // パターンB: 大ダメージ予測 (HP半分以上)
        // ※削除: 初手などで守りすぎるのを防ぐため、ピンチ以外は殴り合う
        /*
        if (incomingDmg > actor.maxHp * 0.5) {
             // ここも少し揺らぎを持たせる（20%で守らない）
             if (Math.random() < 0.2) return -500;
             return 5000;
        }
        */

        // パターンC: 瀕死 (HP25%未満)
        if (hpRate < 0.25) {
             // 50%で守らずに殴る（あがき）
             if (Math.random() < 0.5) return -500;
             return 2000;
        }

        // それ以外（ピンチじゃない）は守らない
        return -1000;
    }

    // ---------------------------------------------------------
    // 4. 攻撃技 (Aggressive Kill)
    // ---------------------------------------------------------
    if (moveData.category === 'physical' || moveData.category === 'special_damage') {
        // actor.isWild: 野生の個体（研究員に訓練された編成やボスではない）は
        // 「複数体に当たるから効率がいい」という損得計算をしない。
        // これをしないと、野生が毎ターン全体技だけを撃ち続ける不自然な動きになる
        const isWild = !!actor.isWild;
        let maxDamage = 0;
        let killCount = 0;
        let isResisted = false;
        let summedDamage = 0;

        targets.forEach(t => {
            const target = t.mon;
            if (target.isProtected) {
                score -= 10000;
                return;
            }

            const dmg = calculateDamage(actor, target, moveData);

            // 仕様4: アグレッシブ・キル
            // 確殺 かつ 先手を取れるなら、プロテクション(20000)や交代(25000)を超えるスコアを出す
            if (dmg >= target.currentHp) {
                killCount++;
                if (isFaster(actor, target, isDistortion)) {
                    score += 35000; // 最優先事項：やられる前にやる
                } else {
                    score += 15000; // 確殺だが後手（相打ち覚悟）
                }
            } else {
                summedDamage += dmg;
            }

            // 削りボーナス
            if (target.currentHp - dmg < target.maxHp * 0.5) score += isWild ? 500 : 2000;
            if (dmg > maxDamage) maxDamage = dmg;

            // タイプ相性
            const typeMod = getTypeMultiplier(moveData.type, target.type, moveData.special_type);
            if (typeMod > 1.0) score += isWild ? 300 : 1000;
            if (typeMod < 1.0) isResisted = true;
        });

        // 通常ダメージの加算方法：知的な個体は複数体分を合算して「効率」を評価するが、
        // 野生は目の前の一番痛い一撃だけを基準に判断する（全体技を数の暴力として選ばない）
        score += isWild ? maxDamage : summedDamage;

        if (isResisted && killCount === 0) score -= 3000;

        if (!isWild && moveData.target === 'all_enemies' && targets.length >= 2) {
            score += 3000;
        }

        return score;
    }

    return -500;
};

/**
 * 交代判断 (Priority Switch)
 */
const evaluateSwitch = (currentMon, benchMon, playerState, playerField, dbMoves) => {
    const incomingDmg = predictIncomingDamage(currentMon, playerState, playerField, dbMoves);

    // 現在のヴァーモンが「即死」する場合のみ検討
    if (currentMon.currentHp <= incomingDmg) {

         // 控えが出た場合に受けるダメージを予測
         let benchIncomingDmg = 0;
         playerField.forEach(pidx => {
            if (pidx !== -1 && playerState[pidx].currentHp > 0) {
                const enemy = playerState[pidx];
                enemy.selectedMoves.forEach(m => {
                    const md = dbMoves[m];
                    if (md && (md.category === 'physical' || md.category === 'special_damage')) {
                        // 交代時は防御ランク0として計算
                        const dmg = calculateDamage(enemy, benchMon, md, null, 0);
                        if (dmg > benchIncomingDmg) benchIncomingDmg = dmg;
                    }
                });
            }
         });

         // 条件: 控えがダメージの2倍以上のHPを持っている（＝余裕で耐える）
         if (benchMon.currentHp > benchIncomingDmg * 2) {
             // 守る(20000)よりも高い優先度(25000)
             // ピンチの時、安全な交代先がいれば「守る」より「交代」を選ぶ
             return 25000;
         }
    }

    return -9999;
};

/**
 * メインAI関数
 */
const getBestAIAction = window.getBestAIAction = (actorIndex, actorSlot, aiState, playerState, myField, playerField, dbMoves, isDistortion) => {
    const actor = aiState[actorIndex];
    if (!actor || actor.currentHp <= 0) return null;

    let candidates = [];
    const moves = actor.selectedMoves || [];

    // 1. 技の評価
    moves.forEach(moveName => {
        const moveData = dbMoves[moveName];
        if (!moveData) return;

        let targetSlots = [];
        if (['all_enemies', 'all', 'field'].includes(moveData.target)) {
            targetSlots.push(null);
        } else if (moveData.target === 'self') {
            targetSlots.push(actorSlot);
        } else {
            [0, 1].forEach(s => {
                if (playerField[s] !== -1 && playerState[playerField[s]].currentHp > 0) {
                    targetSlots.push(s);
                }
            });
        }

        targetSlots.forEach(slot => {
            const score = evaluateAction(moveData, actor, slot, aiState, playerState, myField, playerField, isDistortion, dbMoves);
            candidates.push({
                type: 'move',
                moveName: moveName,
                targetSlot: slot === null ? 0 : slot,
                side: 'enemy',
                actorSlot: actorSlot,
                score: score
            });
        });
    });

    // 2. 交代の評価
    const benchCandidates = aiState.map((m, i) => ({ mon: m, index: i }))
        .filter(data => !myField.includes(data.index) && data.mon.currentHp > 0);

    benchCandidates.forEach(candidate => {
        const switchScore = evaluateSwitch(actor, candidate.mon, playerState, playerField, dbMoves);
        candidates.push({
            type: 'switch',
            targetIndex: candidate.index,
            side: 'enemy',
            actorSlot: actorSlot,
            score: switchScore
        });
    });

    // 3. 最良の手を選択
    candidates.sort((a, b) => b.score - a.score);

    if (candidates.length === 0) return null;

    const bestScore = candidates[0].score;
    // 確殺・必須級アクション(スコア10000以上)は即決
    if (bestScore >= 10000) {
        return candidates[0];
    }

    // 僅差の場合はランダム性を持たせる
    const validCandidates = candidates.filter(c => c.score >= bestScore - 500 && c.score > -5000);
    if (validCandidates.length > 0) {
        const idx = Math.floor(Math.random() * validCandidates.length);
        return validCandidates[idx];
    }

    return candidates[0];
};

/**
 * 先発選出ロジック
 */
const optimizeEnemyLead = window.optimizeEnemyLead = (aiParty, playerParty) => {
    let optimizedParty = [...aiParty];

    const trSetter = optimizedParty.find(m => m.selectedMoves.includes('ディストーション'));

    if (trSetter) {
        let others = optimizedParty.filter(m => m !== trSetter);
        others.sort((a, b) => b.atk - a.atk);

        optimizedParty = [trSetter, ...others];
        console.log("AI Lead: Distortion Mode Active");
    } else {
        optimizedParty.sort((a, b) => b.spd - a.spd);
        console.log("AI Lead: Speed Aggro Mode");
    }

    return optimizedParty;
};