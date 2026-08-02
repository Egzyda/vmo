// AdventureMode.js - アドベンチャーモード本体（拠点 + 探索 + 戦闘オーケストレーション）
// SPEC.md 4.8 / 4.9 / 4.12 / 4.17 に対応

const { useState, useEffect, useRef } = React;

const AdventureMode = window.AdventureMode = ({ onBack, dbMonsters, dbMoves }) => {
    const W = window;
    const [save, setSave] = useState(null);
    const [view, setView] = useState('loading'); // loading|starter|base|dungeon|battle|learn
    const [baseTab, setBaseTab] = useState('party'); // party|moves|shop|items
    const [msg, setMsg] = useState('');

    // ダンジョン進行状態
    const [run, setRun] = useState(null); // { floorPos, step, restsLeft, hints }
    const [battle, setBattle] = useState(null); // { enemyParty, tier, isBoss }
    const [learnQueue, setLearnQueue] = useState([]); // [{ partyIndex, count }]

    const baseOf = (id) => dbMonsters.find(m => m.id === id);

    // ---------- 初期ロード ----------
    useEffect(() => {
        let alive = true;
        (async () => {
            const s = await W.loadAdventureSave();
            if (!alive) return;
            setSave(s);
            setView(s.party.length === 0 ? 'starter' : 'base');
        })();
        return () => { alive = false; };
    }, []);

    const persist = async (next) => {
        setSave(next);
        await W.saveAdventureSave(next);
    };

    const flash = (text) => { setMsg(text); setTimeout(() => setMsg(''), 2600); };

    // ---------- 初期選択（6体から2体） ----------
    const [starterPicks, setStarterPicks] = useState([]);
    const toggleStarter = (name) => {
        setStarterPicks(p => p.includes(name) ? p.filter(n => n !== name)
            : (p.length < 2 ? [...p, name] : p));
    };
    const confirmStarters = async () => {
        let s = W.createDefaultSave();
        starterPicks.forEach(name => {
            const bd = dbMonsters.find(m => m.name === name);
            if (bd) s = W.addMonsterToSave(s, W.createAdventureMonster(bd, 5, dbMoves));
        });
        await persist(s);
        setView('base');
    };

    // ---------- ダンジョン ----------
    const startRun = (floorPos) => {
        const floor = W.getFloorByPosition(floorPos);
        if (!floor) return;
        const alive = save.party.filter(m => m.currentHp > 0);
        if (alive.length === 0) { flash('戦えるヴァーモンがいない。拠点で回復しよう'); return; }
        setRun({ floorPos, step: 0, restsLeft: floor.rests, hints: rollHints() });
        setView('dungeon');
    };

    // 4択それぞれの結果を先に確定し、ヒントだけ提示する（SPEC 4.8）
    const rollHints = () => {
        const h = {};
        Object.keys(W.NODE_CHOICES).forEach(id => { h[id] = W.rollNodeOutcome(id); });
        return h;
    };

    const floor = run ? W.getFloorByPosition(run.floorPos) : null;
    const isBossNext = run && floor && run.step >= floor.battles;

    const buildEnemy = (tier) => {
        const pool = floor.wild.map(n => dbMonsters.find(m => m.name === n)).filter(Boolean);
        if (!pool.length) return [];
        const count = tier === 'boss' ? 1 : W.rollEnemyCount(floor, run.step);
        const picks = [];
        for (let i = 0; i < count; i++) picks.push(pool[Math.floor(Math.random() * pool.length)]);

        return picks.map(bd => {
            const lvl = floor.level + (tier === 'boss' ? 2 : tier === 'elite' ? 1 : 0);
            const inst = { id: bd.id, level: lvl, exp: 0, knownMoves: [], equippedMoves: [] };
            inst.equippedMoves = (tier === 'normal')
                ? W.getWildMoveSet(bd, run.floorPos, dbMoves)
                : W.getEliteMoves(bd, lvl, dbMoves);
            return W.toBattleMonster(inst, bd, { tier, fullHeal: true });
        });
    };

    const buildBoss = () => {
        const bd = dbMonsters.find(m => m.name === floor.boss);
        if (!bd) return [];
        const lvl = floor.level + 3;
        const inst = { id: bd.id, level: lvl, exp: 0, knownMoves: [], equippedMoves: [] };
        inst.equippedMoves = W.getEliteMoves(bd, lvl, dbMoves);
        return [W.toBattleMonster(inst, bd, { tier: 'boss', fullHeal: true })];
    };

    const myBattleParty = () =>
        save.party.map(inst => {
            const bd = baseOf(inst.id);
            return bd ? W.toBattleMonster(inst, bd) : null;
        }).filter(Boolean);

    const enterBattle = (tier) => {
        const enemyParty = tier === 'boss' ? buildBoss() : buildEnemy(tier);
        if (!enemyParty.length) { flash('敵の生成に失敗した'); return; }
        setBattle({ enemyParty, tier, isBoss: tier === 'boss' });
        setView('battle');
    };

    const applyTrap = async (trap) => {
        let next = { ...save };
        const eff = trap.effect;
        if (eff.type === 'damage_all') {
            next.party = next.party.map(m => ({ ...m, currentHp: Math.max(0, m.currentHp - eff.value) }));
        } else if (eff.type === 'poison_all') {
            next.party = next.party.map(m => ({ ...m, pendingStatus: 'poison' }));
        } else if (eff.type === 'lose_money_percent') {
            next.money = Math.max(0, Math.floor(next.money * (1 - eff.value)));
        } else if (eff.type === 'lose_rest') {
            setRun(r => ({ ...r, restsLeft: Math.max(0, r.restsLeft - 1) }));
        } else if (eff.type === 'debuff_random') {
            next.party = next.party.map(m => ({ ...m, pendingDebuff: true }));
        }
        await persist(next);
    };

    const chooseNode = async (choiceId) => {
        const outcome = run.hints[choiceId];
        if (outcome === 'normal' || outcome === 'elite') {
            enterBattle(outcome);
        } else if (outcome === 'item') {
            const cheap = W.SHOP_ITEMS.filter(i => i.price <= 300);
            const got = cheap[Math.floor(Math.random() * cheap.length)];
            await persist(W.addItem(save, got.name));
            flash(`${got.name} を見つけた！`);
            advanceStep();
        } else if (outcome === 'trap') {
            const trap = W.rollTrap();
            await applyTrap(trap);
            flash(`【${trap.name}】${trap.desc}`);
            advanceStep();
        }
    };

    const advanceStep = () => {
        setRun(r => r ? { ...r, step: r.step + 1, hints: rollHints() } : r);
    };

    const doRest = async () => {
        if (run.restsLeft <= 0) { flash('もう休憩できない'); return; }
        const next = {
            ...save,
            party: save.party.map(m => {
                const bd = baseOf(m.id);
                if (!bd) return m;
                const max = W.getEffectiveStats(m, bd).hp;
                return { ...m, currentHp: Math.min(max, m.currentHp + Math.floor(max * 0.3)) };
            })
        };
        await persist(next);
        setRun(r => ({ ...r, restsLeft: r.restsLeft - 1 }));
        flash('休憩した（HP30%回復）');
    };

    // ---------- 戦闘終了処理 ----------
    const onBattleEnd = async (result, finalMyState) => {
        const enemies = battle.enemyParty;
        let next = { ...save };

        // HP を戦闘後の状態へ反映
        if (Array.isArray(finalMyState)) {
            next.party = next.party.map((inst, i) => {
                const after = finalMyState[i];
                return after ? { ...inst, currentHp: Math.max(0, after.currentHp) } : inst;
            });
        }

        if (result === 'win') {
            // 経験値・所持金
            const totalExp = enemies.reduce((s, e) => s + W.getBaseExp(e.level || 1), 0);
            const avgEnemyLv = Math.round(enemies.reduce((s, e) => s + (e.level || 1), 0) / enemies.length);
            const money = enemies.reduce((s, e) => s + W.getDropMoney(e.level || 1), 0);
            next.money += money;

            const queue = [];
            next.party = next.party.map((inst, idx) => {
                const gained = W.getExp(totalExp, inst.level, avgEnemyLv);
                const r = W.grantExp(inst, gained);
                if (r.pendingLearns > 0) queue.push({ partyIndex: idx, count: r.pendingLearns });
                return r.instance;
            });

            // 捕獲判定（野生のみ。研究員=トレーナー戦は対象外）
            const ownedIds = [...next.party, ...next.box].map(m => m.id);
            const captured = [];
            enemies.forEach(e => {
                const tier = battle.tier === 'boss' ? 'boss' : battle.tier;
                const device = pickBestDevice(next.items);
                const res = W.attemptCapture({
                    monsterId: e.id, tier, targetLevel: e.level || 1,
                    deviceName: device, ownedIds
                });
                next.seenIds = [...new Set([...next.seenIds, e.id])];
                if (res.success) {
                    const bd = baseOf(e.id);
                    if (bd) {
                        next = W.addMonsterToSave(next, W.createAdventureMonster(bd, e.level || 1, dbMoves));
                        ownedIds.push(e.id);
                        captured.push(bd.name);
                    }
                }
                if (device) next = W.consumeItem(next, device);
            });

            let note = `+${money}円 / +${totalExp}exp`;
            if (captured.length) note += ` / ${captured.join('・')}が仲間になった！`;
            flash(note);

            await persist(next);
            if (queue.length) { setLearnQueue(queue); setView('learn'); }
            else finishBattleStep(next);
        } else {
            // 全滅: 拠点へ強制送還。進捗・所持品は保持（SPEC方針）
            await persist(next);
            setRun(null);
            setBattle(null);
            setView('base');
            flash('全滅した… 拠点に戻された');
        }
    };

    const pickBestDevice = (items) => {
        const order = ['同調デバイス Mk-V', '同調デバイス Mk-IV', '同調デバイス Mk-III', '同調デバイス Mk-II', '同調デバイス Mk-I'];
        return order.find(n => (items || {})[n] > 0) || null;
    };

    // currentSave は呼び出し元が persist した直後の最新値を渡すこと。
    // React の state 更新は非同期なので、ここで closure の `save` を読むと
    // 直前に確定した報酬（所持金・経験値・捕獲）を巻き戻してしまう。
    const finishBattleStep = (currentSave) => {
        const s = currentSave || save;
        const wasBoss = battle && battle.isBoss;
        setBattle(null);
        if (wasBoss) {
            (async () => {
                const cleared = [...new Set([...s.clearedFloors, run.floorPos])];
                const nextPos = Math.min(W.FLOORS.length, run.floorPos + 1);
                await persist({
                    ...s,
                    clearedFloors: cleared,
                    currentFloorPosition: Math.max(s.currentFloorPosition, nextPos)
                });
                setRun(null);
                setView('base');
                flash(`${floor.id} クリア！`);
            })();
        } else {
            advanceStep();
            setView('dungeon');
        }
    };

    // ---------- 技習得 ----------
    const resolveLearn = async (moveName) => {
        const head = learnQueue[0];
        const inst = save.party[head.partyIndex];
        const updated = W.learnMove(inst, moveName);
        const next = { ...save, party: save.party.map((m, i) => i === head.partyIndex ? updated : m) };
        await persist(next);
        const remaining = head.count - 1;
        const q = remaining > 0
            ? [{ ...head, count: remaining }, ...learnQueue.slice(1)]
            : learnQueue.slice(1);
        setLearnQueue(q);
        if (q.length === 0) finishBattleStep(next);
    };

    // ================= 描画 =================
    if (view === 'loading' || !save) {
        return <div className="app-container items-center justify-center text-white font-teko text-xl">LOADING...</div>;
    }

    const Msg = () => msg ? (
        <div className="absolute bottom-2 inset-x-2 z-50 bg-slate-900/95 border border-cyan-500 rounded px-3 py-2 text-xs text-cyan-100 shadow-lg">{msg}</div>
    ) : null;

    // ---- 初期選択 ----
    if (view === 'starter') {
        return (
            <div className="app-container p-3 text-white overflow-y-auto relative">
                <h2 className="font-teko text-3xl tracking-wider text-cyan-300">SELECT PARTNERS</h2>
                <p className="text-xs text-slate-400 mb-3">脱出に連れていく2体を選べ</p>
                {W.STARTER_CHOICES.map(group => (
                    <div key={group.type} className="mb-3">
                        <div className="text-[10px] text-slate-400 mb-1">{W.TYPE_NAMES[group.type]}属性</div>
                        <div className="grid grid-cols-2 gap-2">
                            {group.options.map(name => {
                                const bd = dbMonsters.find(m => m.name === name);
                                const sel = starterPicks.includes(name);
                                return (
                                    <button key={name} onClick={() => toggleStarter(name)}
                                        className={`p-2 rounded border text-left ${sel ? 'border-yellow-400 bg-yellow-400/10' : 'border-slate-700 bg-slate-800'}`}>
                                        <div className="w-full aspect-square bg-slate-900 rounded overflow-hidden mb-1">
                                            {bd && bd.img && <img src={bd.img} className="w-full h-full object-contain" />}
                                        </div>
                                        <div className="text-xs font-bold">{name}</div>
                                        {bd && <div className="text-[9px] text-slate-400">HP{bd.hp} A{bd.atk} D{bd.def} S{bd.spd}</div>}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ))}
                <button disabled={starterPicks.length !== 2} onClick={confirmStarters}
                    className={`w-full py-3 rounded font-teko text-xl tracking-wider ${starterPicks.length === 2 ? 'bg-cyan-500 text-black' : 'bg-slate-800 text-slate-600'}`}>
                    START ({starterPicks.length}/2)
                </button>
                <button onClick={onBack} className="w-full py-2 mt-2 text-slate-500 text-xs">BACK</button>
            </div>
        );
    }

    // ---- 戦闘 ----
    if (view === 'battle' && battle) {
        const mine = myBattleParty();
        const myField = mine.length > 1 ? [0, 1] : [0, -1];
        const enField = battle.enemyParty.length > 1 ? [0, 1] : [0, -1];
        return (
            <window.BattleEngine
                myParty={mine}
                enemyParty={battle.enemyParty}
                initialMyField={myField}
                initialEnemyField={enField}
                dbMoves={dbMoves}
                dbMonsters={dbMonsters}
                difficulty="normal"
                adventureMode={true}
                onExit={onBattleEnd}
            />
        );
    }

    // ---- 技習得 ----
    if (view === 'learn' && learnQueue.length) {
        const head = learnQueue[0];
        const inst = save.party[head.partyIndex];
        const bd = inst ? baseOf(inst.id) : null;
        const options = bd ? W.getLearnableMoves(bd, inst.knownMoves) : [];
        if (!options.length) {
            // 覚える技が残っていない場合はスキップ
            setTimeout(() => resolveLearn(null), 0);
            return <div className="app-container items-center justify-center text-white">...</div>;
        }
        return (
            <div className="app-container p-3 text-white overflow-y-auto">
                <h2 className="font-teko text-2xl text-yellow-300 tracking-wider">NEW MOVE</h2>
                <p className="text-xs text-slate-300 mb-3">{bd.name} が新しい技を覚えられる（残り{head.count}）</p>
                {options.map(mv => {
                    const d = dbMoves[mv] || {};
                    return (
                        <button key={mv} onClick={() => resolveLearn(mv)}
                            className="w-full text-left p-2 mb-2 rounded bg-slate-800 border border-slate-700 hover:border-cyan-400">
                            <div className="flex justify-between items-center">
                                <span className="font-bold text-sm">{mv}</span>
                                <span className="text-[10px]">{W.TYPE_NAMES[d.type]} P:{d.power || '-'}</span>
                            </div>
                            <div className="text-[10px] text-slate-400">{d.desc}</div>
                        </button>
                    );
                })}
            </div>
        );
    }

    // ---- ダンジョン ----
    if (view === 'dungeon' && run && floor) {
        const dblRate = Math.round(W.getDoubleEncounterRate(floor, run.step) * 100);
        return (
            <div className="app-container p-3 text-white relative overflow-y-auto">
                <div className="flex justify-between items-baseline">
                    <h2 className="font-teko text-2xl text-cyan-300 tracking-wider">{floor.id} {floor.name}</h2>
                    <button onClick={() => { setRun(null); setView('base'); }} className="text-[10px] text-slate-500">撤退</button>
                </div>
                <div className="text-[11px] text-slate-400 mb-3">
                    進行 {Math.min(run.step, floor.battles)}/{floor.battles} ・ 休憩 {run.restsLeft}/{floor.rests} ・ 2体遭遇率 {dblRate}%
                </div>

                {isBossNext ? (
                    <button onClick={() => enterBattle('boss')}
                        className="w-full py-6 mb-3 rounded bg-red-900/70 border-2 border-red-500 font-teko text-2xl tracking-widest">
                        BOSS: {floor.boss}
                    </button>
                ) : (
                    <div className="space-y-2 mb-3">
                        {Object.values(W.NODE_CHOICES).map(c => {
                            const hint = W.OUTCOME_HINTS[run.hints[c.id]];
                            const tone = hint.tone === 'danger' ? 'text-red-400' :
                                hint.tone === 'good' ? 'text-green-400' :
                                    hint.tone === 'warn' ? 'text-yellow-400' : 'text-slate-400';
                            return (
                                <button key={c.id} onClick={() => chooseNode(c.id)}
                                    className="w-full flex justify-between items-center p-3 rounded bg-slate-800/90 border border-slate-700 hover:border-cyan-400">
                                    <span className="font-bold text-sm">{c.icon} {c.label}</span>
                                    <span className={`text-[11px] ${tone}`}>（{hint.text}）</span>
                                </button>
                            );
                        })}
                    </div>
                )}

                <button onClick={doRest} disabled={run.restsLeft <= 0}
                    className={`w-full py-2 rounded text-sm ${run.restsLeft > 0 ? 'bg-slate-700' : 'bg-slate-900 text-slate-600'}`}>
                    休憩する（HP30%回復・残り{run.restsLeft}）
                </button>

                <div className="mt-4 border-t border-slate-800 pt-2">
                    {save.party.map((m, i) => {
                        const bd = baseOf(m.id); if (!bd) return null;
                        const max = W.getEffectiveStats(m, bd).hp;
                        const pct = Math.max(0, Math.round(m.currentHp / max * 100));
                        return (
                            <div key={i} className="flex items-center gap-2 mb-1 text-[11px]">
                                <span className="w-20 truncate">{bd.name}</span>
                                <span className="text-slate-500">Lv{m.level}</span>
                                <div className="flex-1 h-2 bg-slate-900 rounded overflow-hidden">
                                    <div className={`h-full ${pct < 25 ? 'bg-red-500' : pct < 50 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: pct + '%' }} />
                                </div>
                                <span className="w-14 text-right text-slate-400">{m.currentHp}/{max}</span>
                            </div>
                        );
                    })}
                </div>
                <Msg />
            </div>
        );
    }

    // ---- 拠点 ----
    const maxFloor = Math.min(W.FLOORS.length, save.currentFloorPosition);
    return (
        <div className="app-container text-white relative overflow-hidden flex flex-col">
            <div className="p-3 border-b border-slate-800 flex justify-between items-center flex-none">
                <h2 className="font-teko text-2xl text-cyan-300 tracking-wider">BASE</h2>
                <div className="text-xs text-yellow-300">{save.money} 円</div>
                <button onClick={onBack} className="text-[10px] text-slate-500">TITLE</button>
            </div>

            <div className="flex flex-none border-b border-slate-800">
                {[['party', 'パーティ'], ['moves', '技'], ['shop', 'ショップ'], ['items', '道具']].map(([k, label]) => (
                    <button key={k} onClick={() => setBaseTab(k)}
                        className={`flex-1 py-2 text-[11px] font-bold ${baseTab === k ? 'bg-slate-700 text-white' : 'text-slate-500'}`}>{label}</button>
                ))}
            </div>

            <div className="flex-1 overflow-y-auto p-3">
                {baseTab === 'party' && (
                    <>
                        <div className="text-[10px] text-slate-400 mb-1">手持ち（最大4）</div>
                        {save.party.map((m, i) => {
                            const bd = baseOf(m.id); if (!bd) return null;
                            const st = W.getEffectiveStats(m, bd);
                            return (
                                <div key={i} className="flex items-center gap-2 p-2 mb-1 bg-slate-800 rounded border border-slate-700">
                                    <div className="w-10 h-10 bg-slate-900 rounded overflow-hidden flex-none">
                                        {bd.img && <img src={bd.img} className="w-full h-full object-contain" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-bold truncate">{bd.name} <span className="text-slate-500">Lv{m.level}</span></div>
                                        <div className="text-[9px] text-slate-400">HP{m.currentHp}/{st.hp} A{st.atk} D{st.def} S{st.spd}</div>
                                    </div>
                                    {save.box.length > 0 && (
                                        <button onClick={async () => {
                                            const box = [...save.box];
                                            const swapIn = box.shift();
                                            const party = [...save.party]; party[i] = swapIn;
                                            await persist({ ...save, party, box: [...box, m] });
                                        }} className="text-[9px] px-2 py-1 bg-slate-700 rounded flex-none">交代</button>
                                    )}
                                </div>
                            );
                        })}
                        {save.box.length > 0 && (
                            <>
                                <div className="text-[10px] text-slate-400 mt-3 mb-1">ボックス（{save.box.length}）</div>
                                {save.box.map((m, i) => {
                                    const bd = baseOf(m.id); if (!bd) return null;
                                    return <div key={i} className="text-[11px] py-1 border-b border-slate-800">{bd.name} <span className="text-slate-500">Lv{m.level}</span></div>;
                                })}
                            </>
                        )}
                    </>
                )}

                {baseTab === 'moves' && save.party.map((m, i) => {
                    const bd = baseOf(m.id); if (!bd) return null;
                    return (
                        <div key={i} className="mb-3">
                            <div className="text-xs font-bold mb-1">{bd.name} <span className="text-slate-500">Lv{m.level}</span>
                                <span className="text-[9px] text-slate-500 ml-1">装備 {m.equippedMoves.length}/3</span></div>
                            {m.knownMoves.map(mv => {
                                const d = dbMoves[mv] || {};
                                const on = m.equippedMoves.includes(mv);
                                return (
                                    <button key={mv} onClick={async () => {
                                        const cur = m.equippedMoves;
                                        let nextMoves;
                                        if (on) { if (cur.length <= 1) return; nextMoves = cur.filter(x => x !== mv); }
                                        else { if (cur.length >= 3) return; nextMoves = [...cur, mv]; }
                                        const updated = W.setEquippedMoves(m, nextMoves);
                                        await persist({ ...save, party: save.party.map((x, j) => j === i ? updated : x) });
                                    }}
                                        className={`w-full flex justify-between items-center px-2 py-1 mb-0.5 rounded text-[11px] border ${on ? 'border-cyan-400 bg-cyan-900/30' : 'border-slate-700 bg-slate-800/60 text-slate-400'}`}>
                                        <span>{mv}</span>
                                        <span>{W.TYPE_NAMES[d.type]} P:{d.power || '-'}</span>
                                    </button>
                                );
                            })}
                        </div>
                    );
                })}

                {baseTab === 'shop' && W.SHOP_ITEMS.map(item => (
                    <div key={item.name} className="flex items-center gap-2 p-2 mb-1 bg-slate-800 rounded border border-slate-700">
                        <div className="flex-1 min-w-0">
                            <div className="text-xs font-bold truncate">{item.name}</div>
                            <div className="text-[9px] text-slate-400">{item.effect}</div>
                        </div>
                        <div className="text-[10px] text-yellow-300 flex-none">{item.price}円</div>
                        <button onClick={async () => {
                            const r = W.buyItem(save, item.name);
                            if (r.ok) { await persist(r.save); flash(`${item.name} を購入`); }
                            else flash('所持金が足りない');
                        }} className="text-[9px] px-2 py-1 bg-cyan-700 rounded flex-none">買う</button>
                    </div>
                ))}

                {baseTab === 'items' && (
                    Object.keys(save.items).length === 0
                        ? <div className="text-xs text-slate-500">所持品なし</div>
                        : Object.entries(save.items).map(([name, qty]) => {
                            const def = W.SHOP_ITEMS.find(i => i.name === name) || {};
                            const usable = def.kind === 'heal' || def.kind === 'cure' || def.kind === 'revive';
                            return (
                                <div key={name} className="flex items-center gap-2 p-2 mb-1 bg-slate-800 rounded border border-slate-700">
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-bold truncate">{name} ×{qty}</div>
                                        <div className="text-[9px] text-slate-400">{def.effect || ''}</div>
                                    </div>
                                    {usable && (
                                        <button onClick={async () => {
                                            let next = W.consumeItem(save, name);
                                            next.party = next.party.map(m => {
                                                const bd = baseOf(m.id); if (!bd) return m;
                                                const max = W.getEffectiveStats(m, bd).hp;
                                                if (def.kind === 'heal' && m.currentHp > 0) return { ...m, currentHp: Math.min(max, m.currentHp + Math.floor(max * def.value)) };
                                                if (def.kind === 'revive' && m.currentHp <= 0) return { ...m, currentHp: Math.floor(max * def.value) };
                                                if (def.kind === 'cure') return { ...m, pendingStatus: null };
                                                return m;
                                            });
                                            await persist(next);
                                            flash(`${name} を使った`);
                                        }} className="text-[9px] px-2 py-1 bg-green-700 rounded flex-none">使う</button>
                                    )}
                                </div>
                            );
                        })
                )}
            </div>

            <div className="flex-none p-3 border-t border-slate-800">
                <div className="text-[10px] text-slate-400 mb-1">出撃</div>
                <div className="flex gap-1 overflow-x-auto pb-1">
                    {W.FLOORS.slice(0, maxFloor).map(f => (
                        <button key={f.id} onClick={() => startRun(f.position)}
                            className={`flex-none px-3 py-2 rounded text-[11px] border ${save.clearedFloors.includes(f.position) ? 'border-slate-600 bg-slate-800 text-slate-400' : 'border-cyan-500 bg-cyan-900/40 text-white'}`}>
                            {f.id}
                            <div className="text-[8px]">{save.clearedFloors.includes(f.position) ? 'CLEAR' : 'Lv' + f.level}</div>
                        </button>
                    ))}
                </div>
            </div>
            <Msg />
        </div>
    );
};
