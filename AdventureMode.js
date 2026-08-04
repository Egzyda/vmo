// AdventureMode.js - アドベンチャーモード本体（拠点 + 探索 + 戦闘オーケストレーション）
// SPEC.md 4.8 / 4.9 / 4.12 / 4.17 に対応

const { useState, useEffect, useRef } = React;

const AdventureMode = window.AdventureMode = ({ onBack, dbMonsters, dbMoves }) => {
    const W = window;
    const [save, setSave] = useState(null);
    const [view, setView] = useState('loading'); // loading|starter|base|dungeon|battle|learn
    const [baseTab, setBaseTab] = useState('home'); // home|party|moves|shop|items
    const [msg, setMsg] = useState('');

    // ダンジョン進行状態
    const [run, setRun] = useState(null); // { floorPos, step, restsLeft, hints }
    const [battle, setBattle] = useState(null); // { enemyParty, tier, isBoss }
    const [learnQueue, setLearnQueue] = useState([]); // [{ partyIndex, count }]
    const [captureQueue, setCaptureQueue] = useState([]); // 未所持の撃破相手
    const [captureResult, setCaptureResult] = useState(null); // { name, success }
    // 罠・アイテムなどのイベントは画面中央のモーダルで見せる（トーストだと見落とす）
    const [event, setEvent] = useState(null); // { icon, title, desc, tone }
    // 探索中に開けるサブパネル（道具 / 手持ち）
    const [panel, setPanel] = useState(null); // null|'items'|'party'
    const [detailMon, setDetailMon] = useState(null); // MonsterDetailModal 用
    const [movePartyIndex, setMovePartyIndex] = useState(null); // 技入れ替え対象
    const [pendingLearn, setPendingLearn] = useState(null); // 装備満杯時の入れ替え選択中の技名
    const [retreatConfirm, setRetreatConfirm] = useState(false); // 撤退確認モーダル
    const logEndRef = useRef(null);

    const baseOf = (id) => dbMonsters.find(m => m.id === id);

    // ---------- 初期ロード ----------
    useEffect(() => {
        let alive = true;
        (async () => {
            const s = await W.loadAdventureSave();
            if (!alive) return;
            setSave(s);
            setView(s.party.length === 0 ? 'prologue' : 'base');
        })();
        return () => { alive = false; };
    }, []);

    // ログが増えたら最新行まで送る
    useEffect(() => {
        if (logEndRef.current) logEndRef.current.scrollIntoView({ block: 'end' });
    }, [run && run.log ? run.log.length : 0, view]);

    const persist = async (next) => {
        setSave(next);
        await W.saveAdventureSave(next);
    };

    // 拠点に戻ったら全回復（ジャンルの慣例。回復薬を買わないと再挑戦できないのは苦行）
    const healAtBase = (s) => ({
        ...s,
        party: s.party.map(m => {
            const bd = baseOf(m.id);
            if (!bd) return m;
            return { ...m, currentHp: W.getEffectiveStats(m, bd).hp, pendingStatus: null, pendingDebuff: null };
        })
    });

    const flash = (text) => { setMsg(text); setTimeout(() => setMsg(''), 2600); };

    // ---------- 初期選択（6体から2体） ----------
    const [starterPicks, setStarterPicks] = useState([]);
    const [prologuePage, setProloguePage] = useState(0);
    const [epiloguePage, setEpiloguePage] = useState(0);
    const toggleStarter = (name) => {
        setStarterPicks(p => p.includes(name) ? p.filter(n => n !== name)
            : (p.length < 2 ? [...p, name] : p));
    };
    const confirmStarters = async () => {
        let s = W.createDefaultSave();
        starterPicks.forEach(name => {
            const bd = dbMonsters.find(m => m.name === name);
            if (bd) s = W.addMonsterToSave(s, W.createAdventureMonster(bd, 1, dbMoves));
        });
        await persist(s);
        setBaseTab('home');
        setView('base');
    };

    // ---------- ダンジョン ----------
    const startRun = (floorPos) => {
        const floor = W.getFloorByPosition(floorPos);
        if (!floor) return;
        const alive = save.party.filter(m => m.currentHp > 0);
        if (alive.length === 0) { flash('戦えるヴァーモンがいない。拠点で回復しよう'); return; }
        setRun({ floorPos, step: 0, restsLeft: floor.rests, hints: rollHints(floorPos), log: [] });
        setPanel(null);
        setEvent(null);
        setView('dungeon');
    };

    // フロア内で起きたことをクリアまで残す（何をしてきたか見返せるように）
    const addLog = (text, tone = 'info') => {
        setRun(r => r ? { ...r, log: [...(r.log || []), { text, tone }] } : r);
    };

    // 4択それぞれの結果を先に確定し、ヒントだけ提示する（SPEC 4.8）
    const rollHints = (floorPos) => {
        const h = {};
        Object.keys(W.NODE_CHOICES).forEach(id => { h[id] = W.rollNodeOutcome(id, floorPos); });
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
                : W.getEliteMoves(bd, lvl, dbMoves, run.floorPos);
            // 序盤フロアの野生は弱体個体（floor.wildStatMult）
            const extra = (tier === 'normal' && floor.wildStatMult) ? floor.wildStatMult : 1;
            return W.toBattleMonster(inst, bd, { tier, fullHeal: true, extraMult: extra });
        });
    };

    const buildBoss = () => {
        const bd = dbMonsters.find(m => m.name === floor.boss);
        if (!bd) return [];
        // 既定は敵レベル+1。+2だと手持ちが揃わない序盤でボス戦だけ突出して難しくなる
        const lvl = floor.bossLevel || (floor.level + 1);
        const inst = { id: bd.id, level: lvl, exp: 0, knownMoves: [], equippedMoves: [] };
        // floor.bossMoves があれば手動指定を優先（チュートリアルボスの調整用）
        inst.equippedMoves = floor.bossMoves && floor.bossMoves.length
            ? floor.bossMoves.filter(m => dbMoves[m])
            : W.getEliteMoves(bd, lvl, dbMoves, run.floorPos);
        return [W.toBattleMonster(inst, bd, {
            tier: floor.bossTier || 'boss', fullHeal: true,
            statOverride: floor.finalBossStats || null
        })];
    };

    // 改造研究員（SPEC 4.16）。雑魚研究員は野生と同格の1〜2体、
    // エリート研究員はアーキタイプ編成（4体・専用moves）をそのまま装備させる
    const buildResearcher = (kind) => {
        if (kind === 'researcher_weak') {
            const pool = floor.wild.map(n => dbMonsters.find(m => m.name === n)).filter(Boolean);
            if (!pool.length) return [];
            const count = W.rollEnemyCount(floor, run.step);
            const picks = [];
            for (let i = 0; i < count; i++) picks.push(pool[Math.floor(Math.random() * pool.length)]);
            return picks.map(bd => {
                const inst = { id: bd.id, level: floor.level, exp: 0, knownMoves: [], equippedMoves: [] };
                inst.equippedMoves = W.getWildMoveSet(bd, run.floorPos, dbMoves);
                return W.toBattleMonster(inst, bd, { tier: 'normal', fullHeal: true });
            });
        }
        const team = W.RESEARCHER_TEAMS[Math.floor(Math.random() * W.RESEARCHER_TEAMS.length)];
        // 4体編成のためelite補正(1.2倍)を全員に掛けると数の暴力になりすぎる。
        // 個体はnormal相当のステータスのまま、編成の噛み合わせ自体を強さにする
        return team.members.map(mem => {
            const bd = dbMonsters.find(m => m.id === mem.id);
            if (!bd) return null;
            const inst = { id: bd.id, level: floor.level, exp: 0, knownMoves: [], equippedMoves: mem.moves };
            return W.toBattleMonster(inst, bd, { tier: 'normal', fullHeal: true });
        }).filter(Boolean);
    };

    const myBattleParty = () =>
        save.party.map(inst => {
            const bd = baseOf(inst.id);
            return bd ? W.toBattleMonster(inst, bd) : null;
        }).filter(Boolean);

    const enterBattle = (tier, researcherKind) => {
        const isResearcher = researcherKind && researcherKind !== 'wild';
        const enemyParty = tier === 'boss' ? buildBoss() : isResearcher ? buildResearcher(researcherKind) : buildEnemy(tier);
        if (!enemyParty.length) { flash('敵の生成に失敗した'); return; }
        setBattle({ enemyParty, tier, isBoss: tier === 'boss', isResearcher });
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
            // next戦闘開始時に1ステータスがデバフ状態で始まる。どれが下がるかは個体ごとにランダム
            const stats = ['atk', 'def', 'spd'];
            next.party = next.party.map(m => ({ ...m, pendingDebuff: stats[Math.floor(Math.random() * stats.length)] }));
        }
        await persist(next);
    };

    const chooseNode = async (choiceId) => {
        const outcome = run.hints[choiceId];
        const flavor = W.pickFlavor(outcome);
        if (outcome === 'normal' || outcome === 'elite') {
            const kind = outcome === 'elite' ? W.getEliteEncounterKind(run.floorPos) : 'wild';
            const meta = {
                wild: outcome === 'elite'
                    ? { icon: '⚔️', title: '強化個体、出現！', log: '強化個体と遭遇した' }
                    : { icon: '👁️', title: 'ヴァーモンと遭遇！', log: 'ヴァーモンと遭遇した' },
                researcher_weak: { icon: '🧪', title: '研究員の気配！', log: '雑魚研究員と交戦になった' },
                researcher_elite: { icon: '🧬', title: 'エリート研究員、出現！', log: 'エリート研究員の編成部隊と交戦になった' }
            }[kind];
            addLog(meta.log, outcome === 'elite' ? 'bad' : 'info');
            setEvent({
                icon: meta.icon,
                title: meta.title,
                desc: flavor,
                tone: outcome === 'elite' ? 'bad' : 'info',
                onConfirm: () => enterBattle(outcome, kind)
            });
        } else if (outcome === 'item') {
            const cheap = W.SHOP_ITEMS.filter(i => i.price <= 300);
            const got = cheap[Math.floor(Math.random() * cheap.length)];
            await persist(W.addItem(save, got.name));
            addLog(`${got.name} を入手した`, 'good');
            setEvent({ icon: '🎁', title: `${got.name} を入手！`, desc: flavor, tone: 'good' });
            advanceStep();
        } else if (outcome === 'trap') {
            const trap = W.rollTrap();
            await applyTrap(trap);
            addLog(`罠【${trap.name}】を踏んだ`, 'bad');
            setEvent({ icon: '⚠️', title: `罠だ！ ${trap.name}`, desc: `${flavor}\n${trap.desc}`, tone: 'bad' });
            advanceStep();
        }
    };

    const advanceStep = () => {
        setRun(r => r ? { ...r, step: r.step + 1, hints: rollHints(r.floorPos) } : r);
    };

    // 道具の使用。拠点でも探索中でも同じ処理を使う
    const useItem = async (name) => {
        const def = W.SHOP_ITEMS.find(i => i.name === name) || {};
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
        if (run) addLog(`${name} を使った`, 'good'); else flash(`${name} を使った`);
    };

    // 装備技のON/OFF。拠点・探索中の両方から呼ぶ
    const toggleEquip = async (partyIndex, mv) => {
        const m = save.party[partyIndex];
        const cur = m.equippedMoves;
        let nextMoves;
        if (cur.includes(mv)) { if (cur.length <= 1) return; nextMoves = cur.filter(x => x !== mv); }
        else { if (cur.length >= 3) return; nextMoves = [...cur, mv]; }
        const updated = W.setEquippedMoves(m, nextMoves);
        await persist({ ...save, party: save.party.map((x, j) => j === partyIndex ? updated : x) });
    };

    // 手持ちの並び替え。先頭2体がそのまま出撃時の前衛（フィールド）になるため、
    // 誰を前衛にするかを並び替えで直接コントロールできるようにする
    const moveParty = async (i, dir) => {
        const j = i + dir;
        if (j < 0 || j >= save.party.length) return;
        const party = [...save.party];
        [party[i], party[j]] = [party[j], party[i]];
        await persist({ ...save, party });
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
        addLog('休憩した（HP30%回復）', 'good');
    };

    // ---------- 戦闘終了処理 ----------
    const onBattleEnd = async (result, finalMyState) => {
        const enemies = battle.enemyParty;
        let next = { ...save };

        // HP と状態異常を戦闘後の状態へ反映。
        // 罠の持ち越し（pendingDebuff）は1戦で消費されるのでここでクリアする
        if (Array.isArray(finalMyState)) {
            next.party = next.party.map((inst, i) => {
                const after = finalMyState[i];
                if (!after) return inst;
                return {
                    ...inst,
                    currentHp: Math.max(0, after.currentHp),
                    pendingStatus: after.status || null,
                    pendingDebuff: null
                };
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

            // 図鑑登録
            enemies.forEach(e => { next.seenIds = [...new Set([...next.seenIds, e.id])]; });

            const foeNames = [...new Set(enemies.map(e => e.name))].join('・');
            addLog(`${foeNames} を撃破（+${money}円 / +${totalExp}exp）`, 'good');
            await persist(next);

            // 未所持の相手だけ捕獲画面に回す（所持済みの周回でタップを増やさない）
            const ownedIds = [...next.party, ...next.box].map(m => m.id);
            const targets = enemies.filter(e => !ownedIds.includes(e.id))
                .filter((e, i, arr) => arr.findIndex(x => x.id === e.id) === i);

            setLearnQueue(queue);
            if (targets.length) { setCaptureQueue(targets); setView('capture'); }
            else if (queue.length) setView('learn');
            else finishBattleStep(next);
        } else {
            // 全滅: 拠点へ強制送還。進捗・所持品は保持（SPEC方針）
            await persist(healAtBase(next));
            setRun(null);
            setBattle(null);
            setBaseTab('home');
            setView('base');
            flash('全滅した… 拠点に戻され、手当てを受けた（HP全回復）');
        }
    };

    // 捕獲を1体分解決する。deviceName=null なら素手
    const resolveCapture = async (deviceName) => {
        const target = captureQueue[0];
        if (!target) return;
        const tier = battle && battle.tier === 'boss' ? 'boss' : (battle ? battle.tier : 'normal');
        let next = { ...save };
        const ownedIds = [...next.party, ...next.box].map(m => m.id);

        const res = W.attemptCapture({
            monsterId: target.id, tier, targetLevel: target.level || 1,
            deviceName, ownedIds
        });
        if (deviceName) next = W.consumeItem(next, deviceName);

        const bd = baseOf(target.id);
        if (res.success && bd) {
            next = W.addMonsterToSave(next, W.createAdventureMonster(bd, target.level || 1, dbMoves));
        }
        await persist(next);
        const nm = bd ? bd.name : '？';
        addLog(res.success ? `${nm} を捕獲した！` : `${nm} の捕獲に失敗`, res.success ? 'good' : 'bad');
        setCaptureResult({ name: nm, success: res.success });
    };

    const skipCapture = () => advanceCaptureQueue();

    const advanceCaptureQueue = () => {
        setCaptureResult(null);
        const rest = captureQueue.slice(1);
        setCaptureQueue(rest);
        if (rest.length === 0) {
            if (learnQueue.length) setView('learn');
            else finishBattleStep(save);
        }
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
                const isFinalFloor = run.floorPos >= W.FLOORS.length;
                const firstClear = isFinalFloor && !s.gameCleared;
                const nextPos = Math.min(W.FLOORS.length, run.floorPos + 1);
                await persist(healAtBase({
                    ...s,
                    clearedFloors: cleared,
                    currentFloorPosition: Math.max(s.currentFloorPosition, nextPos),
                    gameCleared: s.gameCleared || isFinalFloor
                }));
                setRun(null);
                setBaseTab('home');
                if (firstClear) {
                    setEpiloguePage(0);
                    setView('epilogue');
                } else {
                    setView('base');
                    flash(W.FLOOR_CLEAR[floor.id] || `${floor.id} クリア！`);
                }
            })();
        } else {
            advanceStep();
            setView('dungeon');
        }
    };

    // ---------- 技習得 ----------
    const resolveLearn = async (moveName, replaceName = null) => {
        const head = learnQueue[0];
        const inst = save.party[head.partyIndex];
        const updated = W.learnMove(inst, moveName, dbMoves, replaceName);
        const next = { ...save, party: save.party.map((m, i) => i === head.partyIndex ? updated : m) };
        await persist(next);
        setPendingLearn(null);
        if (moveName) {
            const bd = baseOf(inst.id);
            addLog(`${bd ? bd.name : ''} が ${moveName} を覚えた`
                + (replaceName ? `（${replaceName} と入れ替え）` : ''), 'good');
        }
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

    // 罠・アイテム発見は画面中央に大きく出し、タップで閉じさせる。
    // 「踏んだ／拾った」手応えを出すのと、下端のトーストを見落とさないための対応
    const EventModal = () => {
        if (!event) return null;
        const style = event.tone === 'bad' ? { border: 'border-red-500 bg-red-950/90', text: 'text-red-200' }
            : event.tone === 'info' ? { border: 'border-cyan-400 bg-slate-900/95', text: 'text-cyan-200' }
                : { border: 'border-yellow-400 bg-slate-900/95', text: 'text-yellow-200' };
        const close = () => { const cb = event.onConfirm; setEvent(null); if (cb) cb(); };
        return (
            <div className="absolute inset-0 z-[140] bg-black/80 flex items-center justify-center p-6 animate-fade-in"
                onClick={close}>
                <div className={`w-full max-w-[300px] rounded-lg border-2 p-5 text-center shadow-2xl ${style.border}`}>
                    <div className="text-5xl leading-none mb-3">{event.icon}</div>
                    <div className={`font-bold text-lg mb-2 ${style.text}`}>{event.title}</div>
                    <p className="text-xs text-slate-300 whitespace-pre-line leading-relaxed">{event.desc}</p>
                    <div className="mt-4 text-[10px] text-slate-400 animate-pulse">▼ タップして{event.onConfirm ? '戦闘開始' : '続ける'}</div>
                </div>
            </div>
        );
    };

    const Msg = () => msg ? (
        <div className="absolute bottom-2 inset-x-2 z-50 bg-slate-900/95 border border-cyan-500 rounded px-3 py-2 text-xs text-cyan-100 shadow-lg">{msg}</div>
    ) : null;

    // ---- プロローグ ----
    if (view === 'prologue') {
        const last = prologuePage >= W.PROLOGUE.length - 1;
        return (
            <div className="app-container relative text-white overflow-hidden"
                onClick={() => last ? setView('starter') : setProloguePage(p => p + 1)}>
                <div className="absolute inset-0">
                    <img src="./img/assets/base_bg.webp" className="w-full h-full object-cover opacity-30" alt="" />
                    <div className="absolute inset-0 bg-slate-950/70"></div>
                </div>
                <div className="relative z-10 h-full flex flex-col justify-end p-5 pb-16">
                    <div className="bg-slate-950/85 border border-slate-700 rounded p-4 backdrop-blur-sm">
                        <p className="text-sm leading-relaxed whitespace-pre-line">{W.PROLOGUE[prologuePage]}</p>
                        <div className="text-right text-[10px] text-cyan-400 mt-3 animate-pulse">
                            {last ? '▼ タップして開始' : '▼ タップ'}
                        </div>
                    </div>
                    <div className="flex justify-center gap-1 mt-3">
                        {W.PROLOGUE.map((_, i) => (
                            <span key={i} className={`w-1.5 h-1.5 rounded-full ${i === prologuePage ? 'bg-cyan-400' : 'bg-slate-700'}`}></span>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    // ---- エピローグ（B1クリア初回のみ）----
    if (view === 'epilogue') {
        const last = epiloguePage >= W.EPILOGUE.length - 1;
        return (
            <div className="app-container relative text-white overflow-hidden"
                onClick={() => last ? (setBaseTab('home'), setView('base')) : setEpiloguePage(p => p + 1)}>
                <div className="absolute inset-0">
                    <img src="./img/assets/base_bg.webp" className="w-full h-full object-cover opacity-30" alt="" />
                    <div className="absolute inset-0 bg-gradient-to-b from-cyan-950/60 via-slate-950/70 to-slate-950/70"></div>
                </div>
                <div className="relative z-10 h-full flex flex-col justify-end p-5 pb-16">
                    <div className="bg-slate-950/85 border border-cyan-700 rounded p-4 backdrop-blur-sm">
                        <p className="text-sm leading-relaxed whitespace-pre-line">{W.EPILOGUE[epiloguePage]}</p>
                        <div className="text-right text-[10px] text-cyan-400 mt-3 animate-pulse">
                            {last ? '▼ タップして拠点に戻る' : '▼ タップ'}
                        </div>
                    </div>
                    <div className="flex justify-center gap-1 mt-3">
                        {W.EPILOGUE.map((_, i) => (
                            <span key={i} className={`w-1.5 h-1.5 rounded-full ${i === epiloguePage ? 'bg-cyan-400' : 'bg-slate-700'}`}></span>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    // ---- 初期選択（1画面に収める）----
    if (view === 'starter') {
        return (
            <div className="app-container text-white relative flex flex-col overflow-hidden">
                <div className="flex-none px-3 pt-3">
                    <h2 className="font-teko text-2xl tracking-wider text-cyan-300 leading-none">SELECT PARTNERS</h2>
                    <p className="text-[10px] text-slate-400">脱出に連れていく2体を選べ</p>
                </div>
                <div className="flex-1 px-3 py-2 grid grid-cols-3 gap-1.5 content-start">
                    {W.STARTER_CHOICES.flatMap(g => g.options).map(name => {
                        const bd = dbMonsters.find(m => m.name === name);
                        const sel = starterPicks.includes(name);
                        return (
                            <button key={name} onClick={() => toggleStarter(name)}
                                className={`relative rounded border overflow-hidden flex flex-col ${sel ? 'border-yellow-400 bg-yellow-400/10' : 'border-slate-700 bg-slate-800/70'}`}>
                                <div className="w-full aspect-square bg-slate-900 overflow-hidden">
                                    {bd && bd.img && <img src={bd.img} className="w-full h-full object-contain" />}
                                </div>
                                <div className="px-1 py-0.5">
                                    <div className="flex items-center gap-1">
                                        <span className={`px-1 rounded text-[8px] text-white ${W.TYPE_BG[bd.type]}`}>{W.TYPE_NAMES[bd.type]}</span>
                                        <span className="text-[10px] font-bold truncate">{name}</span>
                                    </div>
                                    <div className="text-[8px] text-slate-400 leading-tight">H{bd.hp} A{bd.atk} D{bd.def} S{bd.spd}</div>
                                </div>
                                {sel && <div className="absolute top-0.5 right-0.5 w-4 h-4 bg-yellow-400 text-black rounded-full text-[10px] font-bold flex items-center justify-center">✓</div>}
                            </button>
                        );
                    })}
                </div>
                <div className="flex-none p-3 pt-0 safe-bottom">
                    <button disabled={starterPicks.length !== 2} onClick={confirmStarters}
                        className={`w-full py-3 rounded font-teko text-xl tracking-wider ${starterPicks.length === 2 ? 'bg-cyan-500 text-black' : 'bg-slate-800 text-slate-600'}`}>
                        START ({starterPicks.length}/2)
                    </button>
                    <button onClick={onBack} className="w-full py-1.5 mt-1 text-slate-500 text-[10px]">BACK</button>
                </div>
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

    // ---- 捕獲 ----
    if (view === 'capture' && captureQueue.length) {
        const target = captureQueue[0];
        const bd = baseOf(target.id);
        const tier = battle && battle.tier === 'boss' ? 'boss' : (battle ? battle.tier : 'normal');
        const devices = Object.keys(W.CAPTURE_DEVICES)
            .filter(n => (save.items[n] || 0) > 0)
            .map(n => ({ name: n, qty: save.items[n], rate: W.getCaptureRate(tier, target.level || 1, n) }));
        const bareRate = W.getCaptureRate(tier, target.level || 1, null);

        if (captureResult) {
            return (
                <div className="app-container p-4 text-white flex flex-col items-center justify-center safe-bottom">
                    <div className="w-32 h-32 bg-slate-900 rounded-lg overflow-hidden mb-3 border border-slate-700">
                        {bd && bd.img && <img src={bd.img} className={`w-full h-full object-contain ${captureResult.success ? '' : 'grayscale opacity-50'}`} />}
                    </div>
                    <div className={`font-teko text-4xl tracking-widest mb-2 ${captureResult.success ? 'text-yellow-300' : 'text-slate-400'}`}>
                        {captureResult.success ? 'CAPTURED!' : 'ESCAPED...'}
                    </div>
                    <p className="text-sm mb-6">
                        {captureResult.success ? `${captureResult.name} が仲間になった！` : `${captureResult.name} は逃げてしまった`}
                    </p>
                    <button onClick={advanceCaptureQueue} className="px-8 py-3 bg-white text-black font-bold rounded font-teko text-xl tracking-wider">OK</button>
                </div>
            );
        }

        return (
            <div className="app-container p-4 text-white overflow-y-auto safe-bottom">
                <h2 className="font-teko text-2xl text-cyan-300 tracking-wider">CAPTURE</h2>
                <div className="flex items-center gap-3 my-3">
                    <div className="w-20 h-20 bg-slate-900 rounded overflow-hidden border border-slate-700 flex-none">
                        {bd && bd.img && <img src={bd.img} className="w-full h-full object-contain" />}
                    </div>
                    <div>
                        <div className="font-bold">{bd ? bd.name : '？'} <span className="text-slate-500 text-xs">Lv{target.level}</span></div>
                        <div className="text-[11px] text-slate-400">未登録のヴァーモンだ。捕獲を試みるか？</div>
                    </div>
                </div>

                <button onClick={() => resolveCapture(null)}
                    className="w-full flex justify-between items-center p-3 mb-2 rounded bg-slate-800 border border-slate-600 hover:border-cyan-400">
                    <span className="text-sm font-bold">素手で試す</span>
                    <span className="text-xs text-cyan-300">{Math.round(bareRate * 100)}%</span>
                </button>

                {devices.map(d => (
                    <button key={d.name} onClick={() => resolveCapture(d.name)}
                        className="w-full flex justify-between items-center p-3 mb-2 rounded bg-slate-800 border border-purple-700 hover:border-purple-400">
                        <span className="text-sm font-bold">{d.name} <span className="text-slate-500 text-xs">×{d.qty}</span></span>
                        <span className="text-xs text-purple-300">{Math.round(d.rate * 100)}%</span>
                    </button>
                ))}
                {devices.length === 0 && (
                    <div className="text-[10px] text-slate-500 mb-2">同調デバイスを持っていれば成功率を上げられる（拠点のショップ）</div>
                )}

                <button onClick={skipCapture} className="w-full py-2 mt-2 text-slate-500 text-xs">何もしない</button>
            </div>
        );
    }

    // ---- 技習得 ----
    if (view === 'learn' && learnQueue.length) {
        const head = learnQueue[0];
        const inst = save.party[head.partyIndex];
        const bd = inst ? baseOf(inst.id) : null;
        // 初回習得は補助技のみに絞られる（getLearnOptions が担保）
        const options = bd ? W.getLearnOptions(bd, inst.knownMoves, dbMoves) : [];
        if (!options.length) {
            // 覚える技が残っていない場合はスキップ
            setTimeout(() => resolveLearn(null), 0);
            return <div className="app-container items-center justify-center text-white">...</div>;
        }
        const MoveRow = ({ mv, onClick, accent }) => {
            const d = dbMoves[mv] || {};
            return (
                <button onClick={onClick}
                    className={`w-full text-left p-2 mb-2 rounded bg-slate-800 border ${accent || 'border-slate-700'} hover:border-cyan-400`}>
                    <div className="flex justify-between items-center">
                        <span className="font-bold text-sm">{mv}</span>
                        <span className="text-[10px]">{W.TYPE_NAMES[d.type]} P:{d.power || '-'}</span>
                    </div>
                    <div className="text-[10px] text-slate-400">{d.desc}</div>
                </button>
            );
        };

        // 装備が3つ埋まっている場合は、どの技と入れ替えるかを自分で選ぶ
        if (pendingLearn) {
            return (
                <div className="app-container p-3 text-white overflow-y-auto safe-bottom">
                    <h2 className="font-teko text-2xl text-yellow-300 tracking-wider">REPLACE MOVE</h2>
                    <p className="text-xs text-slate-300 mb-1">{bd.name} は装備が3つ埋まっている。</p>
                    <p className="text-xs text-cyan-300 mb-3">どの技を <span className="font-bold">{pendingLearn}</span> と入れ替える？</p>
                    {inst.equippedMoves.map(mv => (
                        <MoveRow key={mv} mv={mv} onClick={() => resolveLearn(pendingLearn, mv)} accent="border-red-800" />
                    ))}
                    <button onClick={() => resolveLearn(pendingLearn, null)}
                        className="w-full py-2 mt-1 rounded bg-slate-800 border border-slate-600 text-xs">
                        入れ替えず、覚えるだけにする（拠点で装備可）
                    </button>
                    <button onClick={() => setPendingLearn(null)} className="w-full py-2 mt-1 text-slate-500 text-[11px]">
                        別の技を選び直す
                    </button>
                </div>
            );
        }

        return (
            <div className="app-container p-3 text-white overflow-y-auto safe-bottom">
                <h2 className="font-teko text-2xl text-yellow-300 tracking-wider">NEW MOVE</h2>
                <p className="text-xs text-slate-300 mb-1">{bd.name} が新しい技を覚えられる（残り{head.count}）</p>
                <div className="text-[10px] text-slate-500 mb-3">装備中: {inst.equippedMoves.join(' / ')}</div>
                {options.map(mv => (
                    <MoveRow key={mv} mv={mv}
                        onClick={() => W.needsMoveReplace(inst) ? setPendingLearn(mv) : resolveLearn(mv)} />
                ))}
            </div>
        );
    }

    // ---- ダンジョン ----
    if (view === 'dungeon' && run && floor) {
        const dblRate = Math.round(W.getDoubleEncounterRate(floor, run.step) * 100);
        const logTone = (t) => t === 'good' ? 'text-green-300' : t === 'bad' ? 'text-red-300' : 'text-slate-300';

        return (
            <div className="app-container text-white relative flex flex-col overflow-hidden">
                {/* ヘッダ */}
                <div className="flex-none px-3 pt-3">
                    <div className="flex justify-between items-baseline">
                        <h2 className="font-teko text-2xl text-cyan-300 tracking-wider leading-none">{floor.id} {floor.name}</h2>
                        <button onClick={() => setRetreatConfirm(true)} className="text-[10px] text-slate-500">撤退</button>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                        進行 {Math.min(run.step, floor.battles)}/{floor.battles} ・ 休憩 {run.restsLeft}/{floor.rests} ・ 2体遭遇率 {dblRate}%
                    </div>
                </div>

                {/* フロアログ（クリアまで残る） */}
                <div className="flex-1 min-h-0 overflow-y-auto custom-scroll px-3 py-2 space-y-1">
                    {W.FLOOR_INTRO[floor.id] && (
                        <div className="text-[11px] text-slate-300 bg-slate-900/70 border-l-2 border-cyan-600 px-2 py-1.5 leading-relaxed">
                            {W.FLOOR_INTRO[floor.id]}
                        </div>
                    )}
                    {(run.log || []).map((e, i) => (
                        <div key={i} className={`text-[11px] leading-snug ${logTone(e.tone)}`}>
                            <span className="text-slate-600 mr-1">›</span>{e.text}
                        </div>
                    ))}
                    {isBossNext && W.BOSS_INTRO[floor.id] && (
                        <div className="text-[11px] text-red-200 bg-red-950/50 border-l-2 border-red-600 px-2 py-1.5 whitespace-pre-line leading-relaxed">
                            {W.BOSS_INTRO[floor.id]}
                        </div>
                    )}
                    <div ref={logEndRef}></div>
                </div>

                {/* 手持ちHP */}
                <div className="flex-none px-3 py-1.5 border-t border-slate-800 bg-slate-950/60">
                    {save.party.map((m, i) => {
                        const bd = baseOf(m.id); if (!bd) return null;
                        const max = W.getEffectiveStats(m, bd).hp;
                        const pct = Math.max(0, Math.round(m.currentHp / max * 100));
                        return (
                            <div key={i} className="flex items-center gap-2 text-[10px] leading-tight">
                                <span className="w-16 truncate">{bd.name}</span>
                                <span className="text-slate-500 w-8">Lv{m.level}</span>
                                <div className="flex-1 h-1.5 bg-slate-900 rounded overflow-hidden">
                                    <div className={`h-full ${pct < 25 ? 'bg-red-500' : pct < 50 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: pct + '%' }} />
                                </div>
                                <span className="w-12 text-right text-slate-400">{m.currentHp}/{max}</span>
                            </div>
                        );
                    })}
                </div>

                {/* 選択肢は片手で押せるよう画面下部にまとめる */}
                <div className="flex-none px-3 pt-2 border-t border-slate-800 bg-slate-900/80 safe-bottom">
                    {isBossNext ? (
                        <button onClick={() => enterBattle('boss')}
                            className="w-full py-5 rounded bg-red-900/70 border-2 border-red-500 font-teko text-2xl tracking-widest">
                            BOSS: {floor.boss}
                        </button>
                    ) : (
                        <div className="space-y-1.5">
                            {Object.values(W.NODE_CHOICES).map(c => {
                                const hint = W.OUTCOME_HINTS[run.hints[c.id]];
                                const tone = hint.tone === 'danger' ? 'text-red-400' :
                                    hint.tone === 'good' ? 'text-green-400' :
                                        hint.tone === 'warn' ? 'text-yellow-400' : 'text-slate-400';
                                return (
                                    <button key={c.id} onClick={() => chooseNode(c.id)}
                                        className="w-full flex justify-between items-center px-3 py-2.5 rounded bg-slate-800/90 border border-slate-700 hover:border-cyan-400">
                                        <span className="font-bold text-sm">{c.icon} {c.label}</span>
                                        <span className={`text-[11px] ${tone}`}>（{hint.text}）</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    <div className="grid grid-cols-3 gap-1.5 mt-1.5">
                        <button onClick={doRest} disabled={run.restsLeft <= 0}
                            className={`py-2 rounded text-[11px] ${run.restsLeft > 0 ? 'bg-slate-700' : 'bg-slate-900 text-slate-600'}`}>
                            休憩 {run.restsLeft}
                        </button>
                        <button onClick={() => setPanel('items')} className="py-2 rounded text-[11px] bg-slate-700">🎒 道具</button>
                        <button onClick={() => setPanel('party')} className="py-2 rounded text-[11px] bg-slate-700">🧬 手持ち</button>
                    </div>
                </div>

                {/* 探索中サブパネル */}
                {panel === 'items' && (
                    <div className="absolute inset-0 z-[120] bg-black/80 flex flex-col justify-end" onClick={() => setPanel(null)}>
                        <div className="bg-slate-900 border-t border-slate-600 rounded-t-lg max-h-[70%] flex flex-col safe-bottom"
                            onClick={e => e.stopPropagation()}>
                            <div className="flex-none flex justify-between items-center p-3 border-b border-slate-800">
                                <span className="font-teko text-xl tracking-wider text-cyan-300">ITEMS</span>
                                <button onClick={() => setPanel(null)} className="text-[11px] text-slate-400">閉じる</button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-3">
                                {Object.keys(save.items).length === 0
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
                                                {usable
                                                    ? <button onClick={() => useItem(name)} className="text-[10px] px-3 py-1.5 bg-green-700 rounded flex-none">使う</button>
                                                    : <span className="text-[9px] text-slate-500 flex-none">戦闘/捕獲用</span>}
                                            </div>
                                        );
                                    })}
                            </div>
                        </div>
                    </div>
                )}

                {panel === 'party' && (
                    <div className="absolute inset-0 z-[120] bg-black/80 flex flex-col justify-end" onClick={() => { setPanel(null); setMovePartyIndex(null); }}>
                        <div className="bg-slate-900 border-t border-slate-600 rounded-t-lg max-h-[80%] flex flex-col safe-bottom"
                            onClick={e => e.stopPropagation()}>
                            <div className="flex-none flex justify-between items-center p-3 border-b border-slate-800">
                                <span className="font-teko text-xl tracking-wider text-cyan-300">PARTY</span>
                                <button onClick={() => { setPanel(null); setMovePartyIndex(null); }} className="text-[11px] text-slate-400">閉じる</button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-3">
                                <div className="text-[9px] text-slate-500 mb-2">先頭2体が出撃時の前衛になる</div>
                                {save.party.map((m, i) => {
                                    const bd = baseOf(m.id); if (!bd) return null;
                                    const st = W.getEffectiveStats(m, bd);
                                    const open = movePartyIndex === i;
                                    const isFront = i < 2;
                                    return (
                                        <div key={i} className={`mb-2 rounded border ${isFront ? 'bg-cyan-950/40 border-cyan-700' : 'bg-slate-800 border-slate-700'}`}>
                                            <div className="flex items-center gap-2 p-2">
                                                <div className="flex flex-col gap-0.5 flex-none">
                                                    <button onClick={() => moveParty(i, -1)} disabled={i === 0}
                                                        className={`w-5 h-5 rounded text-[10px] flex items-center justify-center ${i === 0 ? 'bg-slate-900 text-slate-700' : 'bg-slate-700 text-slate-200'}`}>▲</button>
                                                    <button onClick={() => moveParty(i, 1)} disabled={i === save.party.length - 1}
                                                        className={`w-5 h-5 rounded text-[10px] flex items-center justify-center ${i === save.party.length - 1 ? 'bg-slate-900 text-slate-700' : 'bg-slate-700 text-slate-200'}`}>▼</button>
                                                </div>
                                                <button onClick={() => setDetailMon(W.toBattleMonster(m, bd))}
                                                    className="w-10 h-10 bg-slate-900 rounded overflow-hidden flex-none">
                                                    {bd.img && <img src={bd.img} className="w-full h-full object-contain" />}
                                                </button>
                                                <div className="flex-1 min-w-0" onClick={() => setDetailMon(W.toBattleMonster(m, bd))}>
                                                    <div className="text-xs font-bold truncate flex items-center gap-1">
                                                        {bd.name} <span className="text-slate-500">Lv{m.level}</span>
                                                        {isFront && <span className="text-[8px] px-1 rounded bg-cyan-700 text-cyan-100 flex-none">前衛</span>}
                                                    </div>
                                                    <div className="text-[9px] text-slate-400">HP{m.currentHp}/{st.hp} A{st.atk} D{st.def} S{st.spd}</div>
                                                </div>
                                                <button onClick={() => setMovePartyIndex(open ? null : i)}
                                                    className="text-[10px] px-2 py-1.5 bg-slate-700 rounded flex-none">{open ? '閉' : '技'}</button>
                                            </div>
                                            {open && (
                                                <div className="px-2 pb-2">
                                                    <div className="text-[9px] text-slate-500 mb-1">タップで装備を切り替え（最大3・装備 {m.equippedMoves.length}/3）</div>
                                                    {m.knownMoves.map(mv => {
                                                        const d = dbMoves[mv] || {};
                                                        const on = m.equippedMoves.includes(mv);
                                                        return (
                                                            <button key={mv} onClick={() => toggleEquip(i, mv)}
                                                                className={`w-full flex justify-between items-center px-2 py-1.5 mb-0.5 rounded text-[11px] border ${on ? 'border-cyan-400 bg-cyan-900/30' : 'border-slate-700 bg-slate-800/60 text-slate-400'}`}>
                                                                <span>{mv}</span>
                                                                <span>{W.TYPE_NAMES[d.type]} P:{d.power || '-'}</span>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}

                {detailMon && <window.MonsterDetailModal monster={detailMon} showMoves dbMoves={dbMoves} onClose={() => setDetailMon(null)} />}
                {retreatConfirm && (
                    <div className="absolute inset-0 z-[150] bg-black/80 flex items-center justify-center p-6" onClick={() => setRetreatConfirm(false)}>
                        <div className="w-full max-w-[300px] rounded-lg border-2 border-slate-600 bg-slate-900 p-5 text-center shadow-2xl" onClick={e => e.stopPropagation()}>
                            <div className="text-3xl mb-2">🚪</div>
                            <div className="font-bold text-base text-white mb-1">このフロアから撤退する？</div>
                            <p className="text-xs text-slate-400 mb-4">拠点に戻り全回復するが、フロアの進行状況（{Math.min(run.step, floor.battles)}/{floor.battles}）は失われる</p>
                            <div className="flex gap-2">
                                <button onClick={() => setRetreatConfirm(false)} className="flex-1 py-2.5 rounded bg-slate-700 text-sm font-bold">戻る</button>
                                <button onClick={async () => { setRetreatConfirm(false); await persist(healAtBase(save)); setRun(null); setBaseTab('home'); setView('base'); }}
                                    className="flex-1 py-2.5 rounded bg-red-700 text-sm font-bold">撤退する</button>
                            </div>
                        </div>
                    </div>
                )}
                <EventModal />
                <Msg />
            </div>
        );
    }

    // ---- 拠点 ----
    const maxFloor = Math.min(W.FLOORS.length, save.currentFloorPosition);
    // ---- 階層選択 ----
    if (view === 'floors') {
        return (
            <div className="app-container text-white relative flex flex-col overflow-hidden">
                <div className="absolute inset-0">
                    <img src="./img/assets/base_bg.webp" className="w-full h-full object-cover opacity-20" alt="" />
                    <div className="absolute inset-0 bg-slate-950/80"></div>
                </div>
                <div className="relative z-10 flex-none p-3 flex justify-between items-center border-b border-slate-800">
                    <h2 className="font-teko text-2xl text-cyan-300 tracking-wider">SELECT FLOOR</h2>
                    <button onClick={() => setView('base')} className="text-[10px] text-slate-400">BACK</button>
                </div>
                <div className="relative z-10 flex-1 overflow-y-auto p-3 space-y-2 safe-bottom">
                    {W.FLOORS.slice(0, maxFloor).slice().reverse().map(f => {
                        const cleared = save.clearedFloors.includes(f.position);
                        const avgLv = Math.round(save.party.reduce((s, m) => s + m.level, 0) / Math.max(1, save.party.length));
                        const diff = f.level - avgLv;
                        const tag = diff >= 4 ? { t: '格上', c: 'text-red-400' }
                            : diff >= 1 ? { t: 'やや格上', c: 'text-yellow-400' }
                                : diff >= -2 ? { t: '適正', c: 'text-green-400' }
                                    : { t: '格下', c: 'text-slate-500' };
                        return (
                            <button key={f.id} onClick={() => startRun(f.position)}
                                className={`w-full text-left p-3 rounded border ${cleared ? 'border-slate-700 bg-slate-900/80' : 'border-cyan-500 bg-cyan-950/50'}`}>
                                <div className="flex justify-between items-baseline">
                                    <span className="font-teko text-xl tracking-wider">{f.id} <span className="text-xs font-zen">{f.name}</span></span>
                                    {cleared && <span className="text-[9px] px-1.5 py-0.5 bg-slate-700 rounded">CLEAR</span>}
                                </div>
                                <div className="flex gap-3 text-[10px] mt-1">
                                    <span>適性 Lv{f.level}</span>
                                    <span className={tag.c}>{tag.t}</span>
                                    <span className="text-slate-500">戦闘{f.battles} / 休憩{f.rests}</span>
                                </div>
                                {cleared ? (
                                    <div className="mt-2 pt-2 border-t border-slate-800">
                                        <div className="text-[9px] text-slate-500 mb-1">出現するヴァーモン</div>
                                        <div className="flex flex-wrap gap-1">
                                            {f.wild.map(n => {
                                                const bd = dbMonsters.find(m => m.name === n);
                                                if (!bd) return null;
                                                const owned = [...save.party, ...save.box].some(m => m.id === bd.id);
                                                return (
                                                    <span key={n} className={`text-[9px] px-1.5 py-0.5 rounded border ${owned ? 'border-slate-700 text-slate-500' : 'border-yellow-600 text-yellow-300'}`}>
                                                        {W.TYPE_NAMES[bd.type]} {n}{owned ? '' : ' ★'}
                                                    </span>
                                                );
                                            })}
                                            <span className="text-[9px] px-1.5 py-0.5 rounded border border-red-700 text-red-300">BOSS {f.boss}</span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="mt-1 text-[9px] text-slate-600">未攻略 — 出現ヴァーモンは不明</div>
                                )}
                            </button>
                        );
                    })}
                </div>
                <Msg />
            </div>
        );
    }

    // ---- 拠点（ホーム）----
    if (view === 'base' && baseTab === 'home') {
        const avgLv = Math.round(save.party.reduce((s, m) => s + m.level, 0) / Math.max(1, save.party.length));
        const nextFloor = W.getFloorByPosition(Math.min(W.FLOORS.length, save.currentFloorPosition));
        return (
            <div className="app-container text-white relative flex flex-col overflow-hidden">
                <div className="absolute inset-0">
                    <img src="./img/assets/base_bg.webp" className="w-full h-full object-cover" alt="" />
                    <div className="absolute inset-0 bg-gradient-to-b from-slate-950/80 via-slate-950/40 to-slate-950/90"></div>
                </div>

                <div className="relative z-10 flex-none p-3 flex justify-between items-center">
                    <div>
                        <div className="flex items-center gap-1.5">
                            <span className="font-teko text-2xl text-cyan-300 tracking-wider leading-none">BASE</span>
                            {save.gameCleared && <span className="text-[9px] px-1.5 py-0.5 bg-cyan-700 rounded text-cyan-100">脱出済み</span>}
                        </div>
                        <div className="text-[10px] text-slate-400">
                            {save.gameCleared ? '地上・安全区画（やり込み要素は準備中）' : `アーク B${31 - save.currentFloorPosition}F 付近・安全区画`}
                        </div>
                    </div>
                    <div className="text-right">
                        <div className="text-sm text-yellow-300 font-bold">{save.money} 円</div>
                        <button onClick={onBack} className="text-[10px] text-slate-400">TITLE</button>
                    </div>
                </div>

                {/* 情報（ヘッダ）は上、操作（パーティ・出撃・サブメニュー）は片手で
                    届く下側にまとめる。空白spacerで押し下げる */}
                <div className="flex-1"></div>

                {/* パーティ簡易表示。
                    手持ちの数でサイズが変わらないよう常に4枠のグリッドにし、
                    空き枠はプレースホルダで埋める（2体のとき巨大化するのを防ぐ） */}
                <div className="relative z-10 flex-none px-3">
                    <div className="grid grid-cols-4 gap-1.5">
                        {Array.from({ length: W.ADVENTURE_PARTY_LIMIT }).map((_, i) => {
                            const m = save.party[i];
                            const bd = m ? baseOf(m.id) : null;
                            if (!m || !bd) {
                                return (
                                    <div key={i} className="bg-slate-900/40 rounded border border-dashed border-slate-700/60 overflow-hidden">
                                        <div className="w-full aspect-square flex items-center justify-center">
                                            <span className="text-slate-700 text-lg leading-none">＋</span>
                                        </div>
                                        <div className="px-1 pb-1 h-[26px]"></div>
                                    </div>
                                );
                            }
                            const max = W.getEffectiveStats(m, bd).hp;
                            const pct = Math.max(0, Math.round(m.currentHp / max * 100));
                            const isFront = i < 2;
                            return (
                                <button key={i} onClick={() => setDetailMon(W.toBattleMonster(m, bd))}
                                    className={`relative rounded border overflow-hidden text-left active:scale-95 transition ${isFront ? 'bg-cyan-950/50 border-cyan-600' : 'bg-slate-900/80 border-slate-700'}`}>
                                    {isFront && <div className="absolute top-0.5 left-0.5 z-10 text-[7px] px-1 rounded bg-cyan-600 text-cyan-50 leading-tight">前衛</div>}
                                    <div className="w-full aspect-square bg-slate-950">
                                        {bd.img && <img src={bd.img} className={`w-full h-full object-contain ${m.currentHp <= 0 ? 'grayscale opacity-40' : ''}`} />}
                                    </div>
                                    <div className="px-1 pb-1 h-[26px]">
                                        <div className="text-[8px] truncate leading-tight">{bd.name}</div>
                                        <div className="text-[8px] text-slate-400 leading-tight">Lv{m.level}</div>
                                        <div className="h-1 bg-slate-800 rounded overflow-hidden">
                                            <div className={`h-full ${pct < 25 ? 'bg-red-500' : pct < 50 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: pct + '%' }} />
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* 出撃（片手操作を意識してパーティ表示のすぐ下、画面下側に配置） */}
                <div className="relative z-10 flex-none flex flex-col items-center px-6 pt-4">
                    <button onClick={() => setView('floors')}
                        className="w-full py-7 rounded-lg bg-gradient-to-b from-cyan-500 to-cyan-700 border-2 border-cyan-300 shadow-[0_0_30px_rgba(34,211,238,0.4)] active:scale-95 transition">
                        <div className="font-teko text-4xl tracking-widest text-white leading-none">出撃</div>
                        <div className="text-[10px] text-cyan-100 mt-1">
                            次: {nextFloor ? `${nextFloor.id} ${nextFloor.name}（適性Lv${nextFloor.level}）` : '—'}
                        </div>
                    </button>
                    <div className="text-[10px] text-slate-400 mt-2">平均 Lv{avgLv} ・ 手持ち {save.party.length}/4</div>
                </div>

                {/* 下部: サブメニュー */}
                <div className="relative z-10 flex-none p-3 grid grid-cols-4 gap-1.5 safe-bottom">
                    {[['party', 'パーティ', '🧬'], ['moves', '技', '⚡'], ['shop', 'ショップ', '🛒'], ['items', '道具', '🎒']].map(([k, label, icon]) => (
                        <button key={k} onClick={() => setBaseTab(k)}
                            className="py-2 rounded bg-slate-900/85 border border-slate-700 hover:border-cyan-400">
                            <div className="text-base leading-none">{icon}</div>
                            <div className="text-[9px] text-slate-300 mt-0.5">{label}</div>
                        </button>
                    ))}
                </div>
                {detailMon && <window.MonsterDetailModal monster={detailMon} showMoves dbMoves={dbMoves} onClose={() => setDetailMon(null)} />}
                <Msg />
            </div>
        );
    }

    return (
        <div className="app-container text-white relative overflow-hidden flex flex-col">
            <div className="p-3 border-b border-slate-800 flex justify-between items-center flex-none">
                <button onClick={() => setBaseTab('home')} className="font-teko text-2xl text-cyan-300 tracking-wider">‹ BASE</button>
                <div className="text-xs text-yellow-300">{save.money} 円</div>
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
                        <div className="text-[10px] text-slate-400 mb-1">手持ち（最大4）・先頭2体が出撃時の前衛になる</div>
                        {save.party.map((m, i) => {
                            const bd = baseOf(m.id); if (!bd) return null;
                            const st = W.getEffectiveStats(m, bd);
                            const isFront = i < 2;
                            return (
                                <div key={i} className={`flex items-center gap-2 p-2 mb-1 rounded border ${isFront ? 'bg-cyan-950/40 border-cyan-700' : 'bg-slate-800 border-slate-700'}`}>
                                    <div className="flex flex-col gap-0.5 flex-none">
                                        <button onClick={() => moveParty(i, -1)} disabled={i === 0}
                                            className={`w-5 h-5 rounded text-[10px] flex items-center justify-center ${i === 0 ? 'bg-slate-900 text-slate-700' : 'bg-slate-700 text-slate-200'}`}>▲</button>
                                        <button onClick={() => moveParty(i, 1)} disabled={i === save.party.length - 1}
                                            className={`w-5 h-5 rounded text-[10px] flex items-center justify-center ${i === save.party.length - 1 ? 'bg-slate-900 text-slate-700' : 'bg-slate-700 text-slate-200'}`}>▼</button>
                                    </div>
                                    <button onClick={() => setDetailMon(W.toBattleMonster(m, bd))}
                                        className="w-10 h-10 bg-slate-900 rounded overflow-hidden flex-none relative">
                                        {bd.img && <img src={bd.img} className="w-full h-full object-contain" />}
                                    </button>
                                    <div className="flex-1 min-w-0" onClick={() => setDetailMon(W.toBattleMonster(m, bd))}>
                                        <div className="text-xs font-bold truncate flex items-center gap-1">
                                            {bd.name} <span className="text-slate-500">Lv{m.level}</span>
                                            {isFront && <span className="text-[8px] px-1 rounded bg-cyan-700 text-cyan-100 flex-none">前衛</span>}
                                        </div>
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
                                    <button key={mv} onClick={() => toggleEquip(i, mv)}
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
                                        <button onClick={() => useItem(name)}
                                            className="text-[9px] px-2 py-1 bg-green-700 rounded flex-none">使う</button>
                                    )}
                                </div>
                            );
                        })
                )}
            </div>

            <div className="flex-none p-3 border-t border-slate-800 safe-bottom">
                <button onClick={() => setBaseTab('home')}
                    className="w-full py-2 rounded bg-slate-800 border border-slate-600 text-sm font-teko tracking-wider">
                    ホームに戻る
                </button>
            </div>
            {detailMon && <window.MonsterDetailModal monster={detailMon} showMoves dbMoves={dbMoves} onClose={() => setDetailMon(null)} />}
            <Msg />
        </div>
    );
};
