const { useState, useEffect, useRef } = React;
const { doc, onSnapshot, updateDoc } = window.fb;
const { db, ResultModal, ProgressBar, MonsterCard, getStatMultiplier, getTypeMultiplier, createLCG, CONSTANTS, TYPE_BG, TYPE_NAMES, getBestAIAction, getGeminiAction } = window;

const BattleEngine = ({
    myParty, enemyParty, initialMyField, initialEnemyField,
    onExit, dbMoves, isOnline, roomId, role, dbMonsters, difficulty,
    gameRules = { flatDamageBonus: 2, minDamage: 0 }
}) => {
     const safeMyParty = myParty || [];
     const safeEnemyParty = enemyParty || [];
     const [turn, setTurn] = useState(1);
     const [logs, setLogs] = useState([{ id: 0, text: "Battle Start!", type: 'normal' }]);
     const [myField, setMyField] = useState(initialMyField || [-1, -1]);
     const [enemyField, setEnemyField] = useState(initialEnemyField || [-1, -1]);
     const [myState, setMyState] = useState(JSON.parse(JSON.stringify(safeMyParty)));
     const [enemyState, setEnemyState] = useState(JSON.parse(JSON.stringify(safeEnemyParty)));
     const [distortion, setDistortion] = useState(false);
     const [distortionTurns, setDistortionTurns] = useState(0);
     const [phase, setPhase] = useState('command');
     const [currentCmdIndex, setCurrentCmdIndex] = useState(0);
     const [commands, setCommands] = useState({});
     const [selectingMove, setSelectingMove] = useState(null);
     const [showSwitchUI, setShowSwitchUI] = useState(false);
     const [forcedSwitchNeeded, setForcedSwitchNeeded] = useState(false);
     const [resultModal, setResultModal] = useState(null);
     const myStateRef = useRef(myState); const enemyStateRef = useRef(enemyState);
     const myFieldRef = useRef(myField); const enemyFieldRef = useRef(enemyField);

     // 同時ダウン時に敵の交代情報を一時保存するRef
     const pendingEnemyFieldUpdateRef = useRef(null);

     const aiDecisionPromiseRef = useRef(null);

     useEffect(() => { myStateRef.current = myState; }, [myState]); useEffect(() => { enemyStateRef.current = enemyState; }, [enemyState]);
     useEffect(() => { myFieldRef.current = myField; }, [myField]); useEffect(() => { enemyFieldRef.current = enemyField; }, [enemyField]);

     const logContainerRef = useRef(null);
     useEffect(() => {
         if (logContainerRef.current) {
             logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
         }
     }, [logs]);

     const addLog = (text, type = 'normal') => { setLogs(prev => [...prev, { id: Date.now() + Math.random(), text, type }]); };

    const decideEnemyActionAsync = async (monIndex, slotIdx) => {
        if (difficulty === 'master') {
            try {
                const geminiAction = await getGeminiAction(
                    monIndex,
                    slotIdx,
                    enemyStateRef.current,
                    myStateRef.current,
                    enemyFieldRef.current,
                    myFieldRef.current,
                    distortion,
                    dbMoves
                );
                if (geminiAction) return geminiAction;
            } catch (e) {
                console.warn("Gemini skipped/failed, falling back to rule-based AI.", e);
            }
        }

        const ruleAction = getBestAIAction(
            monIndex,
            slotIdx,
            enemyStateRef.current,
            myStateRef.current,
            enemyFieldRef.current,
            myFieldRef.current,
            dbMoves,
            distortion
        );
        return ruleAction;
    };

    useEffect(() => {
        if (!isOnline && phase === 'command' && currentCmdIndex === 0) {
            if (difficulty === 'master') {
                 addLog("🤖 相手が思考中...", "normal");
            }

            aiDecisionPromiseRef.current = Promise.all(
                enemyFieldRef.current.map(async (pIdx, slotIdx) => {
                    if (pIdx === -1) return null;
                    const action = await decideEnemyActionAsync(pIdx, slotIdx);
                    return { slotIdx, action };
                })
            );
        }
    }, [phase, turn, isOnline]);

    useEffect(() => {
        if (!isOnline) return;
        const unsub = onSnapshot(doc(db, "battles", roomId), (doc) => {
            const data = doc.data();
            if (!data) return;
            if (data.hostCommand && data.guestCommand && phase !== 'processing') {
                if (data.turnSeed !== undefined) {
                    const myCmds = role === 'host' ? data.hostCommand : data.guestCommand;
                    const enCmds = role === 'host' ? data.guestCommand : data.hostCommand;
                    const syncedRng = createLCG(data.turnSeed);
                    executeTurn(myCmds, enCmds, syncedRng);
                }
            }
        });
        return () => unsub();
    }, [isOnline, roomId, role, phase]);

    const executeTurn = async (currentCommands, onlineEnemyCommands = null, rngFunc = Math.random) => {
        setPhase('processing');
        let enemyCommands = {};

        if (onlineEnemyCommands) {
            enemyCommands = onlineEnemyCommands;
        } else {
            if (aiDecisionPromiseRef.current) {
                try {
                    const aiResults = await aiDecisionPromiseRef.current;
                    aiResults.forEach(res => { if (res && res.action) enemyCommands[res.slotIdx] = res.action; });
                } catch (e) {
                    console.error("AI Pre-calculation failed:", e);
                }
            } else {
                const aiPromises = enemyFieldRef.current.map(async (pIdx, slotIdx) => {
                    if (pIdx === -1) return null;
                    const action = await decideEnemyActionAsync(pIdx, slotIdx);
                    return { slotIdx, action };
                });
                const aiResults = await Promise.all(aiPromises);
                aiResults.forEach(res => { if (res && res.action) enemyCommands[res.slotIdx] = res.action; });
            }
        }

        let actionPool = [];
        Object.keys(currentCommands).forEach(slot => {
            const cmd = currentCommands[slot];
            const idx = myFieldRef.current[parseInt(slot)];
            if(idx !== -1 && myStateRef.current[idx].currentHp > 0) {
                const moveData = dbMoves[cmd.moveName] || {};
                const p = cmd.type === 'switch' ? 6 : (moveData.priority || 0);
                actionPool.push({ ...cmd, priority: p, side: 'player', actorSlot: parseInt(slot), speedTieBreaker: rngFunc() });
            }
        });
        Object.keys(enemyCommands).forEach(slot => {
            const cmd = enemyCommands[slot];
            const idx = enemyFieldRef.current[parseInt(slot)];
            if(idx !== -1 && enemyStateRef.current[idx].currentHp > 0) {
                const moveData = dbMoves[cmd.moveName] || {};
                const p = cmd.type === 'switch' ? 6 : (moveData.priority || 0);
                actionPool.push({ ...cmd, priority: p, side: 'enemy', actorSlot: parseInt(slot), speedTieBreaker: rngFunc() });
            }
        });

        const resetTurnState = (s) => s.forEach(m => {
            m.lastTakenDamage = 0;
            m.lastTakenDamageSource = null;
            if (m.status === undefined) m.status = null;
        });
        resetTurnState(myStateRef.current); resetTurnState(enemyStateRef.current);
        setMyState([...myStateRef.current]); setEnemyState([...enemyStateRef.current]);

        const wait = (ms) => new Promise(r => setTimeout(r, ms));
        const checkWin = async () => { const myAlive = myStateRef.current.filter(m => m.currentHp > 0).length; const enAlive = enemyStateRef.current.filter(m => m.currentHp > 0).length; if (myAlive === 0 || enAlive === 0) { await wait(2000); setResultModal(myAlive === 0 ? 'lose' : 'win'); return true; } return false; };
        if(await checkWin()) return;

        while (actionPool.length > 0) {
             if(await checkWin()) break;
             actionPool.sort((a, b) => {
                 if (a.priority !== b.priority) return b.priority - a.priority;
                 const getLiveSpd = (side, slot) => {
                    const field = side === 'player' ? myFieldRef.current : enemyFieldRef.current;
                    const state = side === 'player' ? myStateRef.current : enemyStateRef.current;
                    const idx = field[slot];
                    if (idx === -1) return 0;
                    return state[idx].spd * getStatMultiplier(state[idx].buffs.spd);
                 };
                 const aSpd = getLiveSpd(a.side, a.actorSlot);
                 const bSpd = getLiveSpd(b.side, b.actorSlot);

                 const diff = distortion ? aSpd - bSpd : bSpd - aSpd;
                 if (diff === 0) {
                     return b.speedTieBreaker - a.speedTieBreaker;
                 }
                 return diff;
             });

            const action = actionPool.shift();
            await wait(1200);
            const actorState = action.side === 'player' ? myStateRef.current : enemyStateRef.current;
            const actorField = action.side === 'player' ? myFieldRef.current : enemyFieldRef.current;
            const actorIdx = actorField[action.actorSlot];

            if (actorIdx === -1 || actorState[actorIdx].currentHp <= 0) continue;
            const actor = actorState[actorIdx];
            const sidePrefix = action.side === 'player' ? (isOnline?'自分':'味方') + 'の' : (isOnline?'相手':'敵') + 'の';

            if (action.type === 'switch') {
                // 交代先が既に場にいないかチェック（分身バグ防止）
                const currentField = action.side === 'player' ? myFieldRef.current : enemyFieldRef.current;
                if (currentField.includes(action.targetIndex)) {
                    if (action.side === 'player') addLog("しかし 既に場に出ていた！");
                    continue;
                }

                addLog(`${sidePrefix}${actor.name} 交代！`);
                actor.buffs = { atk: 0, def: 0, spd: 0 };
                actor.protectStreak = 0;
                actor.isProtected = false;
                await wait(500);

                if (action.side === 'player') {
                    addLog(`Go! ${myStateRef.current[action.targetIndex].name}!`);
                    const newField = [...myFieldRef.current];
                    newField[action.actorSlot] = action.targetIndex;
                    setMyField(newField);
                    myFieldRef.current = newField;
                } else {
                    addLog(`相手は ${enemyStateRef.current[action.targetIndex].name} を繰り出した！`);
                    const newField = [...enemyFieldRef.current];
                    if (action.actorSlot >= 0 && action.actorSlot < newField.length) {
                        newField[action.actorSlot] = action.targetIndex;
                        setEnemyField(newField);
                        enemyFieldRef.current = newField;
                    }
                }
                setMyState([...myStateRef.current]);
                setEnemyState([...enemyStateRef.current]);
                continue;
            }

            const moveData = dbMoves[action.moveName];
            if (!moveData) continue;
            addLog(`${sidePrefix}${actor.name}の${action.moveName}!`, 'move'); await wait(1500);

            if (moveData.effect === 'protect') {
                let chance = 100; if (actor.protectStreak > 0) chance = 30;
                if (rngFunc() * 100 < chance) { actor.isProtected = true; actor.protectStreak = (actor.protectStreak || 0) + 1; addLog(`${actor.name}は守りの体勢に入った！`); }
                else { addLog("しかし うまく決まらなかった！"); actor.protectStreak = 0; }
                if(action.side === 'player') setMyState([...myStateRef.current]); else setEnemyState([...enemyStateRef.current]); continue;
            } else { actor.protectStreak = 0; }

            if (moveData.effect === 'counter') {
                if (actor.lastTakenDamage > 0 && actor.lastTakenDamageSource !== null) {
                    const dmg = Math.floor(actor.lastTakenDamage * 1.5);
                    const targetSideState = action.side === 'player' ? enemyStateRef.current : myStateRef.current;
                    const tIdx = (action.side === 'player' ? enemyFieldRef.current : myFieldRef.current)[actor.lastTakenDamageSource];
                    if (tIdx !== -1 && targetSideState[tIdx].currentHp > 0) {
                        const target = targetSideState[tIdx];
                        target.currentHp = Math.max(0, target.currentHp - dmg);
                        target.isDamaged = true;
                        addLog(`${target.name}に${dmg}のダメージ(倍返し)！`);
                        if(action.side === 'player') setEnemyState([...enemyStateRef.current]); else setMyState([...myStateRef.current]);
                    } else {
                        addLog("しかし 攻撃は外れた！");
                    }
                } else {
                    addLog("しかし うまく決まらなかった！");
                }
                continue;
            }
            if (moveData.effect === 'trick_room') { if (distortion) { addLog("しかし 技は失敗した！"); } else { setDistortion(true); setDistortionTurns(5); addLog(`ディストーション空間が展開された！(5ターン)`); } continue; }

            let targets = [];
            const targetSideState = action.side === 'player' ? enemyStateRef.current : myStateRef.current;
            const targetSideField = action.side === 'player' ? enemyFieldRef.current : myFieldRef.current;
            const allySideState = action.side === 'player' ? myStateRef.current : enemyStateRef.current;
            const allySideField = action.side === 'player' ? myFieldRef.current : enemyFieldRef.current;

            if (moveData.target === 'single' || moveData.target === 'enemy') {
                let tSlot = action.targetSlot;
                if (typeof tSlot !== 'number') tSlot = 0;

                let tIdx = targetSideField[tSlot];
                let finalTarget = (tIdx !== -1) ? targetSideState[tIdx] : null;

                if (!finalTarget || finalTarget.currentHp <= 0) {
                    const otherSlot = tSlot === 0 ? 1 : 0;
                    const otherIdx = targetSideField[otherSlot];
                    const otherMon = (otherIdx !== -1) ? targetSideState[otherIdx] : null;
                    if (otherMon && otherMon.currentHp > 0) {
                        tSlot = otherSlot;
                        finalTarget = otherMon;
                    }
                }

                if (finalTarget && finalTarget.currentHp > 0) {
                    targets.push({ mon: finalTarget, slot: tSlot });
                } else {
                    addLog("しかし 攻撃は外れた！(対象不在)");
                }
            }
            else if (moveData.target === 'all_enemies') { targetSideField.forEach((pidx, s) => { if (pidx !== -1 && targetSideState[pidx].currentHp > 0) targets.push({ mon: targetSideState[pidx], slot: s }); }); }
            else if (moveData.target === 'self') { targets.push({ mon: actor, slot: action.actorSlot }); }
            else if (moveData.target === 'ally') { let slot = action.targetSlot !== undefined ? action.targetSlot : action.actorSlot; const tIdx = allySideField[slot]; if (tIdx !== -1 && allySideState[tIdx].currentHp > 0) targets.push({ mon: allySideState[tIdx], slot: slot }); else targets.push({ mon: actor, slot: action.actorSlot }); }
            else if (moveData.target === 'any_single') { const sideState = action.targetSide === 'enemy' ? targetSideState : allySideState; const sideField = action.targetSide === 'enemy' ? targetSideField : allySideField; const tIdx = sideField[action.targetSlot]; if (tIdx !== -1 && sideState[tIdx].currentHp > 0) targets.push({ mon: sideState[tIdx], slot: action.targetSlot }); }
            else if (moveData.target === 'all_allies') { allySideField.forEach((pidx, s) => { if (pidx !== -1 && allySideState[pidx].currentHp > 0) targets.push({ mon: allySideState[pidx], slot: s }); }); }
            else if (moveData.target === 'all') {
                targetSideField.forEach((pidx, s) => { if (pidx !== -1 && targetSideState[pidx].currentHp > 0) targets.push({ mon: targetSideState[pidx], slot: s }); });
                allySideField.forEach((pidx, s) => { if (pidx !== -1 && allySideState[pidx].currentHp > 0 && s !== action.actorSlot) targets.push({ mon: allySideState[pidx], slot: s }); });
            }

            let totalActualDamageDealt = 0;

            if (targets.length > 0) {
                targets.forEach(t => {
                    const targetMon = t.mon;
                    if (!targetMon) return;

                    if (moveData.category === 'special_damage') {
                        if (targetMon.isProtected) {
                            addLog(`${targetMon.name}は 攻撃を防いだ！`);
                        } else {
                            let damage = 0;
                            if (moveData.effect === 'half_hp') {
                                damage = Math.floor(targetMon.currentHp * 0.5);
                                if (damage < 1) damage = 1;
                            } else {
                                const atk = actor.atk * getStatMultiplier(actor.buffs.atk);
                                const def = targetMon.def * getStatMultiplier(targetMon.buffs.def);
                                damage = Math.floor((atk * moveData.power / def / 2));
                                const typeMod = getTypeMultiplier(moveData.type, targetMon.type, moveData.special_type);
                                damage = Math.floor(damage * typeMod);

                                if (actor.level) {
                                    const levelScale = 0.2 + (actor.level / 50) * 0.8;
                                    damage = Math.floor(damage * Math.min(1.0, levelScale));
                                }

                                if (gameRules.minDamage) {
                                    damage = Math.max(gameRules.minDamage, damage);
                                }
                            }

                            const actualDamage = Math.min(targetMon.currentHp, damage);
                            targetMon.currentHp -= actualDamage;
                            targetMon.isDamaged = true;
                            totalActualDamageDealt += actualDamage;
                            addLog(`${targetMon.name}に${damage}のダメージ！`);
                        }
                    }
                    else if (moveData.category === 'physical') {
                        if (targetMon.isProtected) { addLog(`${targetMon.name}は 攻撃を防いだ！`); } else {
                            const atk = actor.atk * getStatMultiplier(actor.buffs.atk);
                            const def = targetMon.def * getStatMultiplier(targetMon.buffs.def);

                            let power = moveData.power;
                            if (moveData.effect === 'full_hp_double' && targetMon.currentHp === targetMon.maxHp) {
                                power *= 2;
                                addLog("奇襲成功！威力が2倍になった！", 'important');
                            }

                            let damage = Math.floor((atk * power / def / 2));

                            if (actor.level) {
                                const levelScale = 0.2 + (actor.level / 50) * 0.8;
                                damage = Math.floor(damage * Math.min(1.0, levelScale));
                            }

                            const typeMod = getTypeMultiplier(moveData.type, targetMon.type, moveData.special_type);
                            damage = Math.floor(damage * typeMod);

                            const randomMod = 0.9 + rngFunc() * 0.1;
                            damage = Math.floor(damage * randomMod);

                            if (gameRules.flatDamageBonus) {
                                damage += gameRules.flatDamageBonus;
                            }
                            if (gameRules.minDamage) {
                                damage = Math.max(gameRules.minDamage, damage);
                            }

                            const actualDamage = Math.min(targetMon.currentHp, damage);
                            targetMon.currentHp -= actualDamage;
                            targetMon.isDamaged = true;
                            totalActualDamageDealt += actualDamage;

                            targetMon.lastTakenDamage = damage; targetMon.lastTakenDamageSource = action.actorSlot; let msg = `${targetMon.name}に${damage}ダメージ`; let msgType = 'normal'; if (typeMod > 1.0) { msg += "！弱点！！"; msgType = 'important'; } else if (typeMod < 1.0 && typeMod > 0) { msg += "……半減……"; msgType = 'weak'; } addLog(msg, msgType);

                            if (moveData.effect && moveData.effect.startsWith('debuff')) {
                                const statMap = {'debuff_atk':'atk', 'debuff_def':'def', 'debuff_spd':'spd'};
                                const s = statMap[moveData.effect];
                                if(s) {
                                    if(targetMon.buffs[s] <= -2) addLog(`${targetMon.name}の${s.toUpperCase()}はもう下がらない！`);
                                    else {
                                        targetMon.buffs[s] -= 1;
                                        addLog(`${targetMon.name}の${s.toUpperCase()}が下がった`);
                                    }
                                }
                            }
                        }
                    } else if (moveData.category === 'status') {
                        if (targetMon.isProtected) {
                            addLog(`${targetMon.name}は 攻撃を防いだ！`);
                        } else {
                            if (moveData.effect === 'heal') {
                                const percent = moveData.heal_percent || CONSTANTS.HEAL_PERCENT;
                                const heal = Math.floor(targetMon.maxHp * percent);
                                targetMon.currentHp = Math.min(targetMon.maxHp, targetMon.currentHp + heal);
                                addLog(`${targetMon.name}を回復`);
                            } else if (moveData.effect.startsWith('buff')) {
                                const statMap = {'buff_atk':'atk', 'buff_def':'def', 'buff_spd':'spd'};
                                const s = statMap[moveData.effect];
                                if (targetMon.buffs[s] >= 2) addLog(`${targetMon.name}の${s.toUpperCase()}はもう上がらない！`);
                                else {
                                    targetMon.buffs[s] += 1;
                                    addLog(`${targetMon.name}の${s.toUpperCase()}が上がった`);
                                }
                            } else if (moveData.effect.startsWith('debuff')) {
                                const statMap = {'debuff_atk':'atk', 'debuff_def':'def', 'debuff_spd':'spd'};
                                const s = statMap[moveData.effect];
                                if (targetMon.buffs[s] <= -2) addLog(`${targetMon.name}の${s.toUpperCase()}はもう下がらない！`);
                                else {
                                    targetMon.buffs[s] -= 1;
                                    addLog(`${targetMon.name}の${s.toUpperCase()}が下がった`);
                                }
                            } else if (moveData.effect === 'reverse_stats') {
                                ['atk', 'def', 'spd'].forEach(s => {
                                    targetMon.buffs[s] = -targetMon.buffs[s];
                                });
                                addLog(`${targetMon.name}のステータス変化が逆転した！`);
                            }
                        }
                    }
                });
            }

            if (moveData.effect === 'drain' && totalActualDamageDealt > 0) {
                const drain = Math.floor(totalActualDamageDealt * 0.5);
                actor.currentHp = Math.min(actor.maxHp, actor.currentHp + drain);
                addLog(`${actor.name}はHPを${drain}吸収した`);
            }

            if (moveData.side_effect === 'poison_target') {
                targets.forEach(t => {
                    if (t.mon && t.mon.currentHp > 0) {
                        if (!t.mon.status) {
                            t.mon.status = 'poison';
                            addLog(`${t.mon.name}は毒を浴びた！`, 'important');
                        } else if (t.mon.status === 'poison') {
                            addLog(`${t.mon.name}はすでに毒状態だ`);
                        }
                    }
                });
            }

            if (moveData.side_effect) {
                 const parts = moveData.side_effect.split('_');
                 if (parts.length >= 3 && parts[2] === 'self') {
                     const isBuff = parts[0] === 'buff';
                     const stat = parts[1];
                     const amount = parts.length === 4 && parts[3] === '2' ? 2 : 1;

                     if (isBuff) {
                         if (actor.buffs[stat] < 2) {
                             const newVal = Math.min(2, actor.buffs[stat] + amount);
                             const actualChange = newVal - actor.buffs[stat];
                             if(actualChange > 0) {
                                actor.buffs[stat] = newVal;
                                addLog(`${actor.name}の${stat.toUpperCase()}が${actualChange===2?'ぐーんと':''}上がった(効果)`);
                             }
                         }
                     } else {
                         if (actor.buffs[stat] > -2) {
                             const newVal = Math.max(-2, actor.buffs[stat] - amount);
                             const actualChange = actor.buffs[stat] - newVal;
                             if (actualChange > 0) {
                                 actor.buffs[stat] = newVal;
                                 addLog(`${actor.name}の${stat.toUpperCase()}が${actualChange===2?'ガクッと':''}下がった(反動)`);
                             }
                         }
                     }
                 }
            }

            if (moveData.side_effect_target) {
                const parts = moveData.side_effect_target.split('_');
                const isBuff = parts[0] === 'buff';
                const stat = parts[1];
                const amount = parts.length === 4 && parts[3] === '2' ? 2 : 1;

                targets.forEach(t => {
                    if (!t.mon || t.mon.currentHp <= 0 || t.mon.isProtected) return;
                    if (isBuff) {
                        if (t.mon.buffs[stat] < 2) {
                            const newVal = Math.min(2, t.mon.buffs[stat] + amount);
                            const change = newVal - t.mon.buffs[stat];
                            if (change > 0) { t.mon.buffs[stat] = newVal; addLog(`${t.mon.name}の${stat.toUpperCase()}が上がった！`); }
                        }
                    } else {
                        if (t.mon.buffs[stat] > -2) {
                            const newVal = Math.max(-2, t.mon.buffs[stat] - amount);
                            const change = t.mon.buffs[stat] - newVal;
                            if (change > 0) { t.mon.buffs[stat] = newVal; addLog(`${t.mon.name}の${stat.toUpperCase()}が下がった！`); }
                        }
                    }
                });
            }

            setMyState([...myStateRef.current]); setEnemyState([...enemyStateRef.current]);
            setTimeout(() => { const clearShake = (s) => s.forEach(m => m.isDamaged = false); clearShake(myStateRef.current); clearShake(enemyStateRef.current); setMyState([...myStateRef.current]); setEnemyState([...enemyStateRef.current]); }, 500);
        }

        if(isOnline) {
            await updateDoc(doc(db, "battles", roomId), {
                hostCommand: null,
                guestCommand: null,
            });
        }

        await wait(1000);
        const cleanupTurn = (s) => s.forEach(m => { m.isProtected = false; m.isDamaged = false; });
        cleanupTurn(myStateRef.current); cleanupTurn(enemyStateRef.current);
        setMyState([...myStateRef.current]); setEnemyState([...enemyStateRef.current]);
        if(!await checkWin()) await checkPostTurn();
    };

    const checkPostTurn = async () => {
        if (distortion) { if (distortionTurns <= 1) { setDistortion(false); setDistortionTurns(0); addLog("ディストーション空間が元に戻った！"); } else setDistortionTurns(prev => prev - 1); }

        const allActive = [...myFieldRef.current.map(i => ({idx: i, state: myStateRef.current})), ...enemyFieldRef.current.map(i => ({idx: i, state: enemyStateRef.current}))];
        let poisonOccurred = false;
        for (const entry of allActive) {
            if (entry.idx !== -1) {
                const mon = entry.state[entry.idx];
                if (mon.currentHp > 0 && mon.status === 'poison') {
                    const dmg = Math.max(1, Math.floor(mon.maxHp / 10));
                    mon.currentHp = Math.max(0, mon.currentHp - dmg);
                    mon.isDamaged = true;
                    addLog(`${mon.name}は毒のダメージを受けている！(-${dmg})`);
                    poisonOccurred = true;
                }
            }
        }
        if (poisonOccurred) {
            setMyState([...myStateRef.current]); setEnemyState([...enemyStateRef.current]);
            await new Promise(r => setTimeout(r, 800));
            const clearShake = (s) => s.forEach(m => m.isDamaged = false);
            clearShake(myStateRef.current); clearShake(enemyStateRef.current);
            setMyState([...myStateRef.current]); setEnemyState([...enemyStateRef.current]);
        }

        const nextMyField = [...myFieldRef.current]; nextMyField.forEach((pidx, slot) => { if (pidx !== -1 && myStateRef.current[pidx].currentHp <= 0) nextMyField[slot] = -1; }); setMyField(nextMyField); myFieldRef.current = nextMyField;
        const nextEnemyField = [...enemyFieldRef.current]; nextEnemyField.forEach((pidx, slot) => { if (pidx !== -1 && enemyStateRef.current[pidx].currentHp <= 0) nextEnemyField[slot] = -1; });

        const myAlive = myStateRef.current.filter(m => m.currentHp > 0).length; const enAlive = enemyStateRef.current.filter(m => m.currentHp > 0).length;
        if (enAlive === 0) { setTimeout(() => setResultModal('win'), 2000); return; } if (myAlive === 0) { setTimeout(() => setResultModal('lose'), 2000); return; }

        const myDeadOnField = nextMyField.includes(-1) && myAlive > nextMyField.filter(x=>x!==-1).length;
        const enDeadOnField = nextEnemyField.includes(-1) && enAlive > nextEnemyField.filter(x=>x!==-1).length;

        let nextEnemyFieldFinal = [...nextEnemyField];
        if (enDeadOnField) {
            const bench = enemyStateRef.current.map((m, i) => ({m, i})).filter(x => x.m.currentHp > 0 && !nextEnemyField.includes(x.i));
            nextEnemyFieldFinal.forEach((v, s) => { if (v === -1 && bench.length > 0) nextEnemyFieldFinal[s] = bench.pop().i; });
        }

        if (myDeadOnField) {
            if (enDeadOnField) {
                pendingEnemyFieldUpdateRef.current = nextEnemyFieldFinal;
                setEnemyField(nextEnemyField);
                enemyFieldRef.current = nextEnemyField;
            } else {
                setEnemyField(nextEnemyFieldFinal);
                enemyFieldRef.current = nextEnemyFieldFinal;
            }

            const bench = myStateRef.current.map((m, i) => ({m, i})).filter(x => x.m.currentHp > 0 && !nextMyField.includes(x.i));
            if (bench.length > 0) {
                setPhase('switch');
                setForcedSwitchNeeded(true);
                addLog("交代を選んでください");
                return;
            }
        } else {
            // 【修正箇所2】プレイヤーの交代がない場合のみ、ここで敵フィールドを更新
            // これにより、論理分岐を明確にし、予期せぬ状態上書きを防ぐ
            setEnemyField(nextEnemyFieldFinal);
            enemyFieldRef.current = nextEnemyFieldFinal;
        }

        startNextTurn();
    };

    const startNextTurn = () => { setTurn(t => t + 1); setCommands({}); setCurrentCmdIndex(0); setSelectingMove(null); setPhase('command'); addLog(`Turn ${turn + 1}`); };

    const handleCommandSelect = async (type, data) => {
        const activeSlots = myFieldRef.current.map((pidx, slot) => ({pidx, slot})).filter(x => x.pidx !== -1);
        if (currentCmdIndex >= activeSlots.length) return;
        const currentSlot = activeSlots[currentCmdIndex].slot;
        const newCommands = { ...commands, [currentSlot]: { type, ...data } };
        setCommands(newCommands);
        if (currentCmdIndex + 1 < activeSlots.length) {
            setCurrentCmdIndex(currentCmdIndex + 1);
            setSelectingMove(null);
        } else {
            if (isOnline) {
                setPhase('waiting_online');
                const updateData = role === 'host'
                    ? { hostCommand: newCommands, turnSeed: Math.floor(Math.random() * 100000) }
                    : { guestCommand: newCommands };
                await updateDoc(doc(db, "battles", roomId), updateData);
            } else {
                executeTurn(newCommands);
            }
        }
    };

    const handleCancel = () => {
        if(currentCmdIndex > 0) {
            const prevIndex = currentCmdIndex - 1;
            const activeSlots = myFieldRef.current.map((pidx, slot) => ({pidx, slot})).filter(x => x.pidx !== -1);
            const slotToRemove = activeSlots[prevIndex].slot;
            const newCommands = { ...commands };
            delete newCommands[slotToRemove];
            setCommands(newCommands);
            setCurrentCmdIndex(prevIndex);
            setSelectingMove(null);
        }
    };

    const handleForcedSwitch = (idx) => {
        const empty = myFieldRef.current.indexOf(-1);
        if(empty === -1) return;
        const next = [...myFieldRef.current];
        next[empty] = idx;
        setMyField(next);
        myFieldRef.current = next;

        setTimeout(() => {
            const hasMoreEmpty = next.includes(-1);
            const hasBench = myStateRef.current.some((m, i) => m.currentHp > 0 && !next.includes(i));

            if(!hasMoreEmpty || !hasBench) {
                setForcedSwitchNeeded(false);

                if (pendingEnemyFieldUpdateRef.current) {
                    setEnemyField(pendingEnemyFieldUpdateRef.current);
                    enemyFieldRef.current = pendingEnemyFieldUpdateRef.current;
                    pendingEnemyFieldUpdateRef.current = null;
                    addLog("相手もヴァーモンを繰り出した！");
                }

                startNextTurn();
            }
        }, 50);
    };

    const activeSlots = myField.map((pidx, slot) => ({pidx, slot})).filter(x => x.pidx !== -1);
    const actingSlot = activeSlots[currentCmdIndex]?.slot ?? -1;
    const actingMon = actingSlot !== -1 ? myState[myField[actingSlot]] : null;
    const selectedSwitchTargets = Object.values(commands).filter(cmd => cmd.type === 'switch').map(cmd => cmd.targetIndex);

    if (!myState || !enemyState) return <div className="h-full flex items-center justify-center text-white">LOADING...</div>;

    return (
        <div className="app-container pb-6">
            <ResultModal result={resultModal} onExit={onExit} />

            {/* ENEMY AREA */}
            <div className="h-[25%] relative p-1 flex flex-col justify-end bg-gradient-to-b from-slate-800 to-slate-900 border-b border-slate-700 flex-none mt-4">
                {/* Enemy Bench Status */}
                <div className="absolute top-2 right-1 flex flex-col gap-2 z-10 w-16">
                    {enemyState.map((m, i) => {
                        if (enemyField.includes(i) || m.currentHp <= 0) return null;
                        const tBg = TYPE_BG[m.type] || TYPE_BG['⚪'];
                        return (
                            <div key={i} className="w-14 h-16 bg-slate-800 border border-slate-600 rounded p-0.5 flex flex-col items-center shadow-lg relative group">
                                <div className="w-full aspect-square rounded overflow-hidden relative mb-0.5 bg-slate-900">
                                     {m.img ? ( <img src={m.img} className={`w-full h-full object-contain opacity-80 ${m.status === 'poison' ? 'status-poison-tint' : ''}`} /> ) : ( <div className={`w-full h-full ${tBg} opacity-50`}></div> )}
                                     {m.status === 'poison' && (
                                         <div className="absolute top-0.5 left-0.5 z-20 bg-purple-900/90 border border-purple-400 rounded-full w-4 h-4 flex items-center justify-center shadow-md">
                                             <span className="text-[8px] leading-none">💀</span>
                                         </div>
                                     )}
                                </div>
                                <div className="w-full px-0.5 mb-0.5">
                                    <ProgressBar current={m.currentHp} max={m.maxHp} colorClass={m.currentHp < m.maxHp * 0.2 ? 'bg-red-500' : (m.currentHp < m.maxHp * 0.5 ? 'bg-yellow-500' : 'bg-green-500')} />
                                </div>
                                <div className="font-bold text-[8px] truncate text-white font-zen text-center w-full">{m.name}</div>
                            </div>
                        );
                    })}
                </div>
                {/* Enemy Field */}
                <div className="flex justify-center items-end gap-2 w-full h-full pb-1 px-2">
                     {enemyField.map((pidx, slot) => {
                        const mon = pidx !== -1 ? enemyState[pidx] : null;
                        return (
                            <div key={slot} className="w-[28%] max-w-[130px] aspect-[3/4] relative" onClick={() => {
                                if (phase === 'command' && selectingMove) {
                                    const mData = dbMoves[selectingMove];
                                    if (mData && (mData.target === 'single' || mData.target === 'enemy' || mData.target === 'any_single')) handleCommandSelect('move', { moveName: selectingMove, targetSlot: slot, targetSide: 'enemy' });
                                }
                            }}>
                                <MonsterCard monster={mon} isTargetable={phase==='command' && selectingMove && dbMoves[selectingMove] && (dbMoves[selectingMove].target === 'single' || dbMoves[selectingMove].target === 'enemy' || dbMoves[selectingMove].target === 'any_single') && mon && mon.currentHp > 0} compact={true} />
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* LOG AREA */}
            <div className="flex-none h-[15%] min-h-[60px] bg-slate-950/90 border-y border-slate-700 overflow-y-auto battle-log text-xs font-mono leading-tight relative z-20 shadow-inner" ref={logContainerRef}>
                 {distortion && (
                    <div className="sticky top-0 left-0 w-full bg-purple-900/90 text-white text-[12px] px-2 py-0.5 mb-1 border-b border-purple-500 text-center font-bold font-teko tracking-wider shadow-lg">
                        ディストーション空間（残り{distortionTurns}ターン）
                    </div>
                )}
                <div className="p-1">
                    {logs.map((l, i) => (
                        <div key={l.id} className={`mb-0.5 border-b border-white/5 ${
                            l.type === 'move' ? 'text-yellow-300 text-base font-bold py-1 tracking-wider' :
                            (l.type === 'important' ? 'text-red-400 font-black' :
                            (l.type === 'weak' ? 'text-blue-400 font-black' : 'text-slate-300'))
                        }`}>
                            {l.text}
                        </div>
                    ))}
                </div>
            </div>

            {/* PLAYER AREA */}
            <div className="flex-1 relative p-1 flex flex-col justify-end min-h-[80px] bg-slate-900 pt-8">
                {/* My Bench Status */}
                <div className="absolute top-2 right-1 flex flex-col gap-2 z-10 w-16">
                    {myState.map((m, i) => {
                        if (myField.includes(i) || m.currentHp <= 0) return null;
                        const tBg = TYPE_BG[m.type] || TYPE_BG['⚪'];
                        return (
                            <div key={i} className="w-14 h-16 bg-slate-800 border border-slate-600 rounded p-0.5 flex flex-col items-center shadow-lg relative group">
                                <div className="w-full aspect-square rounded overflow-hidden relative mb-0.5 bg-slate-900">
                                     {m.img ? ( <img src={m.img} className={`w-full h-full object-contain opacity-80 ${m.status === 'poison' ? 'status-poison-tint' : ''}`} /> ) : ( <div className={`w-full h-full ${tBg} opacity-50`}></div> )}
                                     {m.status === 'poison' && (
                                         <div className="absolute top-0.5 left-0.5 z-20 bg-purple-900/90 border border-purple-400 rounded-full w-4 h-4 flex items-center justify-center shadow-md">
                                             <span className="text-[8px] leading-none">💀</span>
                                         </div>
                                     )}
                                </div>
                                <div className="w-full px-0.5 mb-0.5">
                                    <ProgressBar current={m.currentHp} max={m.maxHp} colorClass={m.currentHp < m.maxHp * 0.2 ? 'bg-red-500' : (m.currentHp < m.maxHp * 0.5 ? 'bg-yellow-500' : 'bg-green-500')} />
                                </div>
                                <div className="font-bold text-[8px] truncate text-white font-zen text-center w-full">{m.name}</div>
                            </div>
                        );
                    })}
                </div>
                {/* My Field */}
                <div className="flex justify-center items-end gap-2 w-full h-full pb-2 px-2">
                    {myField.map((pidx, slot) => {
                        const mon = pidx !== -1 ? myState[pidx] : null;
                        const isActing = slot === actingSlot && phase === 'command';
                        return (
                            <div key={slot} className={`w-[28%] max-w-[130px] aspect-[3/4] relative transition-transform ${isActing ? '-translate-y-1' : ''}`}
                            onClick={() => {
                                if (phase === 'command' && selectingMove) {
                                    const mData = dbMoves[selectingMove];
                                    if (mData && (mData.target === 'ally' || mData.target === 'any_single')) handleCommandSelect('move', { moveName: selectingMove, targetSlot: slot, targetSide: 'player' });
                                }
                            }}>
                                <MonsterCard monster={mon} isActive={isActing} isSelected={isActing} isTargetable={phase==='command' && selectingMove && dbMoves[selectingMove] && (dbMoves[selectingMove].target === 'ally' || dbMoves[selectingMove].target === 'any_single') && mon && mon.currentHp > 0} />
                                {isActing && <div className="absolute -top-8 left-0 w-full text-center text-xs text-yellow-400 font-bold animate-bounce z-30">▼ COMMAND</div>}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* COMMAND UI */}
            <div className="flex-none h-[220px] bg-slate-950 border-t border-slate-800 shadow-2xl z-30 shrink-0">
                 {phase === 'command' && actingMon && !showSwitchUI && (
                    <div className="h-full flex flex-col p-2">
                        <div className="flex justify-between items-center mb-1 border-b border-slate-800 pb-1"><span className="text-sm font-bold text-blue-300">{actingMon.name}</span>{currentCmdIndex > 0 && <button onClick={handleCancel} className="text-xs px-2 bg-slate-700 hover:bg-slate-600 rounded text-slate-300">BACK</button>}</div>
                        {!selectingMove ? (
                            <div className="flex gap-2 h-full pb-1">
                                <div className="flex-1 overflow-y-auto custom-scroll pr-1">
                                    <div className="grid grid-cols-1 gap-1">
                                    {actingMon.selectedMoves.map(m => {
                                        const moveData = dbMoves[m] || {};
                                        const tBg = TYPE_BG[moveData.type] || TYPE_BG['⚪'];
                                        const tName = TYPE_NAMES[moveData.type] || '?';
                                        return (
                                        <button key={m} onClick={() => {
                                            if(['all_enemies','self','field','all'].includes(moveData.target)) handleCommandSelect('move', { moveName: m, targetSlot: null });
                                            else setSelectingMove(m);
                                        }} className="flex flex-col justify-center px-2 py-2 bg-slate-900 border border-slate-700 rounded text-left hover:bg-slate-800 active:bg-slate-700 transition-colors">
                                            <div className="flex justify-between w-full text-sm font-bold text-slate-300 mb-0.5"><span className="text-white">{m}</span><div className="flex gap-1"><span className={`text-[9px] px-1 py-0.5 rounded text-white font-bold ${tBg}`}>{tName}</span><span className="text-[9px] bg-black/50 px-1 rounded text-slate-400">P:{moveData.power||'-'}</span></div></div>
                                            <div className="text-[10px] text-slate-400 font-bold truncate">{moveData.desc}</div>
                                        </button>
                                    )})}
                                    </div>
                                </div>
                                <button onClick={() => setShowSwitchUI(true)} className="w-12 bg-blue-900/20 border border-blue-800 rounded flex flex-col items-center justify-center text-blue-300 font-bold text-[10px] hover:bg-blue-900/40 transition-colors"><span>⇄</span><span>交代</span></button>
                            </div>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-yellow-400 text-sm animate-pulse"><span>ターゲットを選択してください</span><button onClick={() => setSelectingMove(null)} className="mt-2 text-xs bg-slate-800 px-3 py-1 rounded text-slate-400 hover:bg-slate-700">CANCEL</button></div>
                        )}
                    </div>
                 )}
                 {(showSwitchUI || phase === 'switch') && (
                     <div className="h-full flex flex-col p-2">
                         <div className="flex justify-between mb-1"><span className="text-sm font-bold text-white">{phase==='switch' ? '交代先を選択' : '交代'}</span>{phase!=='switch' && <button onClick={()=>setShowSwitchUI(false)} className="text-xs bg-slate-700 px-2 rounded hover:bg-slate-600">BACK</button>}</div>
                         <div className="flex gap-2 overflow-x-auto pb-2 h-full items-center">
                             {myState.map((m, i) => {
                                 const active = myField.includes(i);
                                 const dead = m.currentHp <= 0;
                                 const alreadySelected = phase !== 'switch' && selectedSwitchTargets.includes(i);
                                 const tBg = TYPE_BG[m.type] || TYPE_BG['⚪'];
                                 return (
                                     <button key={i} disabled={active||dead||alreadySelected} onClick={() => {
                                         if(phase==='switch') handleForcedSwitch(i);
                                         else { handleCommandSelect('switch', {targetIndex: i}); setShowSwitchUI(false); }
                                     }} className={`min-w-[60px] w-16 h-20 p-0.5 rounded border flex flex-col items-center relative ${(!active&&!dead&&!alreadySelected)?'bg-slate-800 border-slate-600 hover:bg-slate-700':'bg-black/50 border-transparent opacity-50'}`}>
                                         <div className="w-full aspect-square rounded overflow-hidden relative mb-0.5 bg-slate-900">
                                             {m.img ? ( <img src={m.img} className="w-full h-full object-contain opacity-80" /> ) : ( <div className={`w-full h-full ${tBg} opacity-50`}></div> )}
                                         </div>
                                         <div className="w-full px-0.5 mb-0.5">
                                             <ProgressBar current={m.currentHp} max={m.maxHp} colorClass={m.currentHp < m.maxHp * 0.2 ? 'bg-red-500' : (m.currentHp < m.maxHp * 0.5 ? 'bg-yellow-500' : 'bg-green-500')} />
                                         </div>
                                         <div className="font-bold truncate w-full text-center text-[8px] text-white font-zen">{m.name}</div>
                                         <div className="absolute top-0 right-0 text-[9px] text-slate-300 bg-black/60 px-1 rounded-bl">{active?'FIELD':(dead?'DEAD':(alreadySelected?'PICKED':''))}</div>
                                     </button>
                                 )
                             })}
                         </div>
                     </div>
                 )}
                 {phase === 'processing' && <div className="h-full flex items-center justify-center text-slate-500 text-lg tracking-widest font-teko">PROCESSING...</div>}
                 {phase === 'waiting_online' && <div className="h-full flex items-center justify-center text-blue-400 text-lg tracking-widest font-teko animate-pulse">WAITING FOR OPPONENT...</div>}
            </div>
        </div>
    );
};

window.BattleEngine = BattleEngine;