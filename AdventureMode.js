// AdventureMode.js - アドベンチャーモード本体（拠点 + 探索 + 戦闘オーケストレーション）
// SPEC.md 4.8 / 4.9 / 4.12 / 4.17 に対応

const { useState, useEffect, useRef } = React;

const AdventureMode = window.AdventureMode = ({ onBack, dbMonsters, dbMoves }) => {
    const W = window;
    const [save, setSave] = useState(null);
    const [view, setView] = useState('loading'); // loading|starter|base|dungeon|battle|learn
    const [baseTab, setBaseTab] = useState('home'); // home|party|moves|shop|items
    const [msg, setMsg] = useState('');
    const [msgKey, setMsgKey] = useState(0); // 同じ文言のトーストでもスライドインし直すためのkey

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
    const [restConfirm, setRestConfirm] = useState(false); // 休憩確認モーダル
    const [capturing, setCapturing] = useState(false); // 捕獲演出中フラグ
    const [itemTarget, setItemTarget] = useState(null); // 道具の使用対象選択中のアイテム名
    const [floorClearInfo, setFloorClearInfo] = useState(null); // フロアボス撃破時のクリア表示 { floorId, floorName, text, reward }
    const [lastReward, setLastReward] = useState(null); // 直前の戦闘報酬 { money, exp }（クリアモーダル表示用）
    const [battleReward, setBattleReward] = useState(null); // 通常戦闘の戦績表示 { money, exp, levelUps }
    const battleRewardNextRef = useRef(null); // 戦績画面を閉じた後に行う遷移処理
    const [shopBuy, setShopBuy] = useState(null); // ショップ購入確認 { item, qty }
    const [boxSort, setBoxSort] = useState(null); // ボックスの並び替え基準 null|'hp'|'atk'|'def'|'spd'
    const [boxFilter, setBoxFilter] = useState(null); // ボックスの属性絞り込み null|'fire'|'water'|'grass'|'light'|'dark'|'normal'
    // ドラッグでの並び替え/入れ替え共通状態。
    // { source: 'party'|'box', index, moved, overSource, overIndex }
    const [drag, setDrag] = useState(null);
    const [moveDrag, setMoveDrag] = useState(null); // 装備技並び替え用ドラッグ状態 { partyIndex, index, moved, overIndex }
    const logEndRef = useRef(null);

    // ドラッグで並び替え/入れ替えが起きた直後、指を離した位置の要素にタップ扱いのclickが
    // 誤発火して装備解除やパネル開閉が起きてしまうのを防ぐ（次のclick 1回だけ握りつぶす）
    const suppressNextClickRef = useRef(false);
    useEffect(() => {
        const handler = (e) => {
            if (suppressNextClickRef.current) {
                suppressNextClickRef.current = false;
                e.stopPropagation();
                e.preventDefault();
            }
        };
        document.addEventListener('click', handler, true);
        return () => document.removeEventListener('click', handler, true);
    }, []);

    const baseOf = (id) => dbMonsters.find(m => m.id === id);

    // ---------- 初期ロード ----------
    useEffect(() => {
        let alive = true;
        (async () => {
            const s = await W.loadAdventureSave();
            if (!alive) return;
            setSave(s);
            // ダンジョン探索中にクラッシュ/リロードした場合、その途中から再開する。
            // 戦闘中の状態は保存していないため、直前のチェックポイント（フロア入場 or 前の一歩）まで戻る
            if (s.dungeonRun && W.getFloorByPosition(s.dungeonRun.floorPos)) {
                setRun(s.dungeonRun);
                setView('dungeon');
                flash('ダンジョン探索を再開しました');
            } else {
                setView(s.party.length === 0 ? 'prologue' : 'base');
            }
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

    const flash = (text) => { setMsg(text); setMsgKey(k => k + 1); setTimeout(() => setMsg(''), 2600); };

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
        const nextRun = { floorPos, step: 0, restsLeft: floor.rests, log: [] };
        setRun(nextRun);
        setPanel(null);
        setEvent(null);
        setView('dungeon');
        persist({ ...save, dungeonRun: nextRun });
    };

    // フロア内で起きたことをクリアまで残す（何をしてきたか見返せるように）
    const addLog = (text, tone = 'info') => {
        setRun(r => r ? { ...r, log: [...(r.log || []), { text, tone }] } : r);
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
            // 強化個体(elite)はステータス倍率ではなくレベルそのものを引き上げる方式。
            // 捕獲すれば実際に高レベルな個体が手に入り、経験値・所持金も多くもらえる
            const lvl = tier === 'elite' ? Math.round(floor.level * 1.2) : floor.level;
            const inst = { id: bd.id, level: lvl, exp: 0, knownMoves: [], equippedMoves: [] };
            inst.equippedMoves = (tier === 'normal')
                ? W.getWildMoveSet(bd, run.floorPos, dbMoves)
                : W.getEliteMoves(bd, lvl, dbMoves, run.floorPos);
            // 序盤フロアの野生は弱体個体（floor.wildStatMult）
            const extra = (tier === 'normal' && floor.wildStatMult) ? floor.wildStatMult : 1;
            // 野生は「強化個体(elite)」でも訓練された存在ではないので、AI判断は常に野生扱い。
            // 強さの差はレベルだけで表現するので、ステータス倍率(ENEMY_STAT_MULTIPLIERS)は乗せない
            return W.toBattleMonster(inst, bd, { tier: 'normal', fullHeal: true, extraMult: extra, isWild: true });
        });
    };

    const buildBoss = () => {
        // 研究員ボス（SPEC 4.16の応用）: フロアボスの代わりにエリート研究員編成を戦わせる
        if (floor.bossKind === 'researcher') return buildResearcher('researcher_elite');

        // floor.boss は通常は種族名の文字列だが、bossDuo の場合は異なる2種族の配列
        // （「同じ個体が2体」ではなく別々の個体2体を相手取らせる）
        const bossNames = Array.isArray(floor.boss) ? floor.boss : [floor.boss];
        // フロアレベル×1.4倍。捕獲率が一番渋い(10%)ぶん、後で同じ種族が雑魚として
        // 出てきた時より確実に強い個体にして「捕まえる価値」を持たせる
        const lvl = floor.bossLevel || Math.round(floor.level * 1.4);
        // 通常ボス(bossTier:'elite')だけ、レベルとは別にステータスへ追加倍率をかける。
        // レベルをこれ以上上げると捕獲時の個体が破格に強くなりすぎるため、
        // 戦闘の手応え自体はステータス側で足す（捕獲した個体には乗らない、戦闘専用の補正）。
        // チュートリアル(B30/B28, tier:'normal')・二体ボス・ラスボス(finalBossStats)は対象外
        const bossExtraMult = (floor.bossTier === 'elite' && !floor.bossDuo) ? 1.2 : 1;
        const buildOne = (name) => {
            const bd = dbMonsters.find(m => m.name === name);
            if (!bd) return null;
            const inst = { id: bd.id, level: lvl, exp: 0, knownMoves: [], equippedMoves: [] };
            // floor.bossMoves があれば手動指定を優先（チュートリアルボスの調整用）
            inst.equippedMoves = floor.bossMoves && floor.bossMoves.length
                ? floor.bossMoves.filter(m => dbMoves[m])
                : W.getEliteMoves(bd, lvl, dbMoves, run.floorPos);
            // ボス単体を歪に強くしない方針（SPEC 4.10）のため、二体ボスは
            // 各個体の補正をnormal(1.0倍)まで下げ、異なる2個体を同時に相手取る戦術的な難しさで強さを出す
            return W.toBattleMonster(inst, bd, {
                tier: floor.bossDuo ? 'normal' : (floor.bossTier || 'boss'), fullHeal: true,
                extraMult: bossExtraMult,
                statOverride: floor.finalBossStats || null,
                // ボスは訓練された編成ではないので、研究員のような「複数体を巻き込むほど得」
                // という計算はさせない（AI判断だけ野生寄りにして、全体技の連打を防ぐ）
                isWild: true
            });
        };
        return bossNames.map(buildOne).filter(Boolean);
    };

    // 改造研究員（SPEC 4.16）。雑魚研究員は野生と同格の1〜2体、
    // エリート研究員はアーキタイプ編成（4体・専用moves）をそのまま装備させる
    const buildResearcher = (kind) => {
        if (kind === 'researcher_weak') {
            const pool = floor.wild.map(n => dbMonsters.find(m => m.name === n)).filter(Boolean);
            if (!pool.length) return [];
            // 野生の二体遭遇と見分けがつかなくなるため、雑魚研究員は3体固定
            // （エリート研究員の4体編成と対になる中間の格にする）
            const count = Math.min(3, pool.length);
            const picks = [];
            for (let i = 0; i < count; i++) picks.push(pool[Math.floor(Math.random() * pool.length)]);
            return picks.map(bd => {
                const inst = { id: bd.id, level: floor.level, exp: 0, knownMoves: [], equippedMoves: [] };
                inst.equippedMoves = W.getWildMoveSet(bd, run.floorPos, dbMoves);
                // 雑魚研究員は野生と同格の個体（SPEC 4.16）なのでAI判断も野生扱い
                return W.toBattleMonster(inst, bd, { tier: 'normal', fullHeal: true, isWild: true });
            });
        }
        const team = W.RESEARCHER_TEAMS[Math.floor(Math.random() * W.RESEARCHER_TEAMS.length)];
        // 4体編成のためelite補正(1.2倍)を全員に掛けると数の暴力になりすぎる。
        // 個体はnormal相当のステータスのまま、編成の噛み合わせ自体を強さにする。
        // ただしエリート研究員は人間に訓練された編成のため、AI判断は賢いまま（isWildなし）
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
        // B3のようなbossKind:'researcher'は「boss」ボタンから来る（researcherKind未指定）ので
        // ここでも研究員扱いだと分かるようにしておく（捕獲対象外・撃破報酬アイテムの判定に使う）
        const isBossResearcher = tier === 'boss' && floor.bossKind === 'researcher';
        const effectiveKind = isBossResearcher ? 'researcher_elite' : researcherKind;
        const isResearcher = !!(effectiveKind && effectiveKind !== 'wild');
        const enemyParty = tier === 'boss' ? buildBoss() : isResearcher ? buildResearcher(effectiveKind) : buildEnemy(tier);
        if (!enemyParty.length) { flash('敵の生成に失敗した'); return; }
        setBattle({ enemyParty, tier, isBoss: tier === 'boss', isResearcher, researcherKind: isResearcher ? effectiveKind : null });
        setView('battle');
    };

    // runPatch: run側に反映したい差分（休憩消費罠など）。呼び出し元のadvanceStepで
    // step増加・ヒント再抽選と同じsetRunにまとめて適用する（連続setRunによる競合を避けるため）
    const applyTrap = async (trap) => {
        let next = { ...save };
        let runPatch = null;
        const eff = trap.effect;
        if (eff.type === 'damage_all') {
            next.party = next.party.map(m => ({ ...m, currentHp: Math.max(0, m.currentHp - eff.value) }));
        } else if (eff.type === 'poison_all') {
            next.party = next.party.map(m => ({ ...m, pendingStatus: 'poison' }));
        } else if (eff.type === 'lose_money_percent') {
            next.money = Math.max(0, Math.floor(next.money * (1 - eff.value)));
        } else if (eff.type === 'lose_rest') {
            runPatch = { restsLeft: Math.max(0, run.restsLeft - 1) };
        } else if (eff.type === 'debuff_random') {
            // next戦闘開始時に1ステータスがデバフ状態で始まる。どれが下がるかは個体ごとにランダム
            const stats = ['atk', 'def', 'spd'];
            next.party = next.party.map(m => ({ ...m, pendingDebuff: stats[Math.floor(Math.random() * stats.length)] }));
        }
        await persist(next);
        return { next, runPatch };
    };

    const chooseNode = async (choiceId) => {
        const outcome = W.rollNodeOutcome(choiceId, run.floorPos);
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
            const next = W.addItem(save, got.name);
            await persist(next);
            addLog(`${got.name} を入手した`, 'good');
            setEvent({ icon: '🎁', title: `${got.name} を入手！`, desc: flavor, tone: 'good' });
            advanceStep(next);
        } else if (outcome === 'trap') {
            const trap = W.rollTrap();
            const { next, runPatch } = await applyTrap(trap);
            addLog(`罠【${trap.name}】を踏んだ`, 'bad');
            setEvent({ icon: '⚠️', title: `罠だ！ ${trap.name}`, desc: `${flavor}\n${trap.desc}`, tone: 'bad' });
            advanceStep(next, runPatch);
        }
    };

    // baseSave: 呼び出し元が直前にpersistした最新のsave（省略時はclosureのsaveを使う）。
    // runPatch: step増加と一緒に適用したいrunの差分（罠の休憩消費など）
    const advanceStep = async (baseSave, runPatch) => {
        if (!run) return;
        const nextRun = { ...run, ...(runPatch || {}), step: run.step + 1 };
        setRun(nextRun);
        await persist({ ...(baseSave || save), dungeonRun: nextRun });
    };

    // 道具の使用。拠点でも探索中でも同じ処理を使う
    // アイテムを使える対象かどうか（種類ごとに対象条件が異なる）
    const isItemEligible = (def, m, bd) => {
        if (!bd) return false;
        if (def.kind === 'heal') return m.currentHp > 0 && m.currentHp < W.getEffectiveStats(m, bd).hp;
        if (def.kind === 'revive') return m.currentHp <= 0;
        if (def.kind === 'cure') return !!m.pendingStatus;
        return false;
    };

    // 道具は必ず対象を1体選んで使う（薬草等が全員に効いてしまわないように）
    const useItem = async (name, targetIndex) => {
        const def = W.SHOP_ITEMS.find(i => i.name === name) || {};
        let next = W.consumeItem(save, name);
        const targetBd = baseOf(save.party[targetIndex]?.id);
        next.party = next.party.map((m, i) => {
            if (i !== targetIndex) return m;
            const bd = baseOf(m.id); if (!bd) return m;
            const max = W.getEffectiveStats(m, bd).hp;
            if (def.kind === 'heal' && m.currentHp > 0) return { ...m, currentHp: Math.min(max, m.currentHp + Math.floor(max * def.value)) };
            if (def.kind === 'revive' && m.currentHp <= 0) return { ...m, currentHp: Math.floor(max * def.value) };
            if (def.kind === 'cure') return { ...m, pendingStatus: null };
            return m;
        });
        await persist(next);
        setItemTarget(null);
        const tname = targetBd ? targetBd.name : '';
        if (run) addLog(`${tname}に${name}を使った`, 'good'); else flash(`${tname}に${name}を使った`);
    };

    // パーティ全員に効果があるアイテム（対象選択なしで即使用）
    const useItemAll = async (name) => {
        const def = W.SHOP_ITEMS.find(i => i.name === name) || {};
        let next = W.consumeItem(save, name);
        if (def.kind === 'cure_all') {
            next.party = next.party.map(m => ({ ...m, pendingStatus: null }));
            await persist(next);
            const msg = `${name}を使った（全員の状態異常を回復）`;
            if (run) addLog(msg, 'good'); else flash(msg);
            return;
        }
        next.party = next.party.map(m => {
            const bd = baseOf(m.id); if (!bd) return m;
            if (m.currentHp <= 0) return m;
            const max = W.getEffectiveStats(m, bd).hp;
            return { ...m, currentHp: Math.min(max, m.currentHp + Math.floor(max * def.value)) };
        });
        await persist(next);
        if (run) addLog(`${name}を使った（全員回復）`, 'good'); else flash(`${name}を使った（全員回復）`);
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

    // ---------- ドラッグ並べ替え／入れ替え（パーティ内・パーティ⇔ボックス共通） ----------
    // 専用のつまみ(ドラッグハンドル)からのみ開始するので、詳細を開くタップ操作とは競合しない。
    // Pointer Events でマウス・タッチ両対応。実際のドロップ先は指/カーソル直下の
    // data-drag-slot 要素から判定する（要素の並び替えアニメーションはせず、対象枠をハイライトするだけ）
    // 割り込み式（splice）ではなく、2要素をそのまま入れ替える方式
    const reorderArray = (arr, from, to) => {
        const copy = [...arr];
        [copy[from], copy[to]] = [copy[to], copy[from]];
        return copy;
    };

    const performDrop = async (srcSource, srcIndex, dstSource, dstIndex) => {
        if (srcSource === dstSource && srcIndex === dstIndex) return;
        if (srcSource === 'party' && dstSource === 'party') {
            await persist({ ...save, party: reorderArray(save.party, srcIndex, dstIndex) });
        } else if (srcSource === 'box' && dstSource === 'box') {
            await persist({ ...save, box: reorderArray(save.box, srcIndex, dstIndex) });
        } else {
            // パーティ⇔ボックスの入れ替え
            const party = [...save.party];
            const box = [...save.box];
            if (srcSource === 'party') { const t = party[srcIndex]; party[srcIndex] = box[dstIndex]; box[dstIndex] = t; }
            else { const t = box[srcIndex]; box[srcIndex] = party[dstIndex]; party[dstIndex] = t; }
            await persist({ ...save, party, box });
            flash('入れ替えた');
        }
    };

    const dragHandleProps = (source, index) => ({
        style: { touchAction: 'none' },
        onPointerDown: (e) => {
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            setDrag({ source, index, x: e.clientX, y: e.clientY, moved: false, overSource: null, overIndex: null });
        },
        onPointerMove: (e) => {
            setDrag(d => {
                if (!d || d.source !== source || d.index !== index) return d;
                const moved = d.moved || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8;
                const el = document.elementFromPoint(e.clientX, e.clientY);
                const slotEl = el && el.closest && el.closest('[data-drag-slot]');
                const overSource = slotEl ? slotEl.getAttribute('data-drag-source') : null;
                const overIndex = slotEl ? parseInt(slotEl.getAttribute('data-drag-index'), 10) : null;
                return { ...d, moved, overSource, overIndex };
            });
        },
        onPointerUp: (e) => {
            setDrag(d => {
                if (d && d.moved) {
                    suppressNextClickRef.current = true;
                    if (d.overSource != null && !Number.isNaN(d.overIndex)) {
                        performDrop(d.source, d.index, d.overSource, d.overIndex);
                    }
                }
                return null;
            });
        },
        onPointerCancel: () => setDrag(null)
    });

    const dragSlotProps = (source, index) => ({
        'data-drag-slot': 'true',
        'data-drag-source': source,
        'data-drag-index': index
    });

    // ---------- 装備技の並び替え（ドラッグ／スワイプ） ----------
    // バトル画面のコマンドボタンは equippedMoves の並び順そのまま出るので、
    // ここでの並び替えは「よく使う技を押しやすい位置に置く」実利がある
    const reorderEquipped = async (partyIndex, from, to) => {
        const m = save.party[partyIndex];
        const arr = [...m.equippedMoves];
        [arr[from], arr[to]] = [arr[to], arr[from]];
        const updated = W.setEquippedMoves(m, arr);
        await persist({ ...save, party: save.party.map((x, j) => j === partyIndex ? updated : x) });
    };

    const moveDragHandleProps = (partyIndex, index) => ({
        style: { touchAction: 'none' },
        onPointerDown: (e) => {
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            setMoveDrag({ partyIndex, index, x: e.clientX, y: e.clientY, moved: false, overIndex: null });
        },
        onPointerMove: (e) => {
            setMoveDrag(d => {
                if (!d || d.partyIndex !== partyIndex || d.index !== index) return d;
                const moved = d.moved || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8;
                const el = document.elementFromPoint(e.clientX, e.clientY);
                const slotEl = el && el.closest && el.closest('[data-move-slot]');
                const overIndex = (slotEl && slotEl.getAttribute('data-move-party') === String(partyIndex))
                    ? parseInt(slotEl.getAttribute('data-move-index'), 10) : null;
                return { ...d, moved, overIndex };
            });
        },
        onPointerUp: () => {
            setMoveDrag(d => {
                if (d && d.moved) {
                    suppressNextClickRef.current = true;
                    if (d.overIndex != null && d.overIndex !== d.index) {
                        reorderEquipped(d.partyIndex, d.index, d.overIndex);
                    }
                }
                return null;
            });
        },
        onPointerCancel: () => setMoveDrag(null)
    });

    // 拠点「技」タブ・探索中PARTYパネルの両方から使う共通の装備エディタ。
    // 装備中（並び替え可）と未装備（タップで装備）を分けて表示する
    const MoveEquipEditor = ({ partyIndex, m, compact }) => {
        const unequipped = m.knownMoves.filter(mv => !m.equippedMoves.includes(mv));
        const rowCls = compact ? 'px-2 py-1' : 'px-2 py-1.5';
        return (
            <div>
                <div className="text-[9px] text-slate-500 mb-1">装備中（⠿を掴んでドラッグで並び替え・最大3）</div>
                {m.equippedMoves.map((mv, mi) => {
                    const d = dbMoves[mv] || {};
                    const isDragOver = moveDrag && moveDrag.partyIndex === partyIndex && moveDrag.overIndex === mi && moveDrag.index !== mi;
                    const isDragging = moveDrag && moveDrag.partyIndex === partyIndex && moveDrag.index === mi;
                    return (
                        <div key={mv} {...{ 'data-move-slot': 'true', 'data-move-party': partyIndex, 'data-move-index': mi }}
                            className={`w-full flex items-center gap-1 mb-0.5 rounded text-[11px] border transition ${isDragOver ? 'border-yellow-400 bg-yellow-950/30' : 'border-cyan-400 bg-cyan-900/30'} ${isDragging ? 'opacity-40' : ''}`}>
                            <button onClick={() => toggleEquip(partyIndex, mv)} className={`flex-1 flex flex-col ${rowCls} text-left`}>
                                <div className="w-full flex justify-between items-center">
                                    <span>{mv}</span>
                                    <span>{W.TYPE_NAMES[d.type]} P:{d.power || '-'}</span>
                                </div>
                                {d.desc && <div className="text-[9px] text-slate-400 mt-0.5">{d.desc}</div>}
                            </button>
                            <div {...moveDragHandleProps(partyIndex, mi)}
                                className="w-6 h-6 flex-none flex items-center justify-center text-slate-400 text-xs cursor-grab active:cursor-grabbing select-none">⠿</div>
                        </div>
                    );
                })}
                {unequipped.length > 0 && (
                    <>
                        <div className="text-[9px] text-slate-500 mt-2 mb-1">未装備（タップで装備）</div>
                        {unequipped.map(mv => {
                            const d = dbMoves[mv] || {};
                            return (
                                <button key={mv} onClick={() => toggleEquip(partyIndex, mv)}
                                    className={`w-full flex flex-col ${rowCls} mb-0.5 rounded text-[11px] border border-slate-700 bg-slate-800/60 text-slate-400 text-left`}>
                                    <div className="w-full flex justify-between items-center">
                                        <span>{mv}</span>
                                        <span>{W.TYPE_NAMES[d.type]} P:{d.power || '-'}</span>
                                    </div>
                                    {d.desc && <div className="text-[9px] text-slate-500 mt-0.5">{d.desc}</div>}
                                </button>
                            );
                        })}
                    </>
                )}
            </div>
        );
    };

    const doRest = async () => {
        if (run.restsLeft <= 0) { flash('もう休憩できない'); return; }
        const nextRun = { ...run, restsLeft: run.restsLeft - 1 };
        const next = {
            ...save,
            dungeonRun: nextRun,
            party: save.party.map(m => {
                if (m.currentHp <= 0) return m; // 戦闘不能のヴァーモンは休憩では蘇生しない
                const bd = baseOf(m.id);
                if (!bd) return m;
                const max = W.getEffectiveStats(m, bd).hp;
                return { ...m, currentHp: Math.min(max, m.currentHp + Math.floor(max * 0.3)) };
            })
        };
        setRun(nextRun);
        await persist(next);
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
            const levelUps = [];
            next.party = next.party.map((inst, idx) => {
                const gained = W.getExp(totalExp, inst.level, avgEnemyLv);
                const r = W.grantExp(inst, gained);
                if (r.pendingLearns > 0) queue.push({ partyIndex: idx, count: r.pendingLearns });
                if (r.leveledUp) {
                    const bd = baseOf(inst.id);
                    levelUps.push({ name: bd ? bd.name : '？', from: r.fromLevel, to: r.toLevel });
                }
                return r.instance;
            });
            setLastReward({ money, exp: totalExp, levelUps });

            // 図鑑登録
            enemies.forEach(e => { next.seenIds = [...new Set([...next.seenIds, e.id])]; });

            const foeNames = [...new Set(enemies.map(e => e.name))].join('・');
            let rewardLog = `${foeNames} を撃破（+${money}円 / +${totalExp}exp）`;

            // 研究員は訓練された相手なので撃破時にランダムでアイテムを1つドロップする
            // （雑魚研究員は安価な消耗品、エリート研究員はやや高価な品から）
            if (battle.isResearcher) {
                const dropNames = battle.researcherKind === 'researcher_elite'
                    ? ['回復スプレー', '解毒スプレー', '同調デバイス Mk-II', '同調デバイス Mk-III']
                    : ['薬草', '回復薬', 'アドレナリン', '万能薬', '蘇生器', '同調デバイス Mk-I'];
                const dropName = dropNames[Math.floor(Math.random() * dropNames.length)];
                next = W.addItem(next, dropName);
                rewardLog += ` / ${dropName}を入手`;
            }

            addLog(rewardLog, 'good');
            // レベルアップしたヴァーモンをログに残す（一覧を流し見るだけで気づける）
            levelUps.forEach(lv => addLog(`${lv.name} レベルアップ！ Lv${lv.from}→${lv.to}`, 'good'));
            await persist(next);

            // 未所持の相手だけ捕獲画面に回す（所持済みの周回でタップを増やさない）。
            // 研究員は人間なので捕獲対象外
            const ownedIds = [...next.party, ...next.box].map(m => m.id);
            const targets = battle.isResearcher ? [] : enemies.filter(e => !ownedIds.includes(e.id))
                .filter((e, i, arr) => arr.findIndex(x => x.id === e.id) === i);

            setLearnQueue(queue);
            const proceed = () => {
                if (targets.length) { setCaptureQueue(targets); setView('capture'); }
                else if (queue.length) setView('learn');
                else finishBattleStep(next);
            };
            if (battle.isBoss) {
                // ボス戦の報酬はFLOOR CLEARモーダル側で表示するので、ここでは挟まない
                proceed();
            } else {
                // 通常戦闘は毎回、簡単な戦績画面（お金・経験値・レベルアップ）を挟む
                setBattle(null);
                battleRewardNextRef.current = proceed;
                setBattleReward({ money, exp: totalExp, levelUps });
                setView('reward');
            }
        } else {
            // 全滅: 拠点へ強制送還。進捗・所持品は保持（SPEC方針）
            await persist(healAtBase({ ...next, dungeonRun: null }));
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
        setCapturing(true);
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
        // 一瞬で結果が出ると呆気ないので、捕獲デバイスが揺れる演出を1秒挟んでから結果を見せる
        await new Promise(r => setTimeout(r, 1000));
        setCapturing(false);
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
                    gameCleared: s.gameCleared || isFinalFloor,
                    dungeonRun: null
                }));
                setRun(null);
                setBaseTab('home');
                if (firstClear) {
                    setEpiloguePage(0);
                    setView('epilogue');
                } else {
                    const nextFloor = W.getFloorByPosition(nextPos);
                    setView('base');
                    setFloorClearInfo({
                        floorId: floor.id, floorName: floor.name,
                        text: W.FLOOR_CLEAR[floor.id] || `${floor.id} クリア！`,
                        reward: lastReward,
                        nextFloor: (nextPos > s.currentFloorPosition && nextFloor) ? nextFloor : null
                    });
                }
            })();
        } else {
            advanceStep(s);
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

    // 回復薬などの道具は必ず対象を1体選ばせる（全員に効くのは薬草にしては強すぎる）
    const ItemTargetPicker = () => {
        if (!itemTarget) return null;
        const def = W.SHOP_ITEMS.find(i => i.name === itemTarget) || {};
        const eligible = save.party
            .map((m, i) => ({ m, i, bd: baseOf(m.id) }))
            .filter(({ m, bd }) => isItemEligible(def, m, bd));
        const emptyMsg = def.kind === 'heal' ? '全員HPが満タン'
            : def.kind === 'revive' ? '戦闘不能のヴァーモンがいない'
                : '状態異常のヴァーモンがいない';
        return (
            <div className="absolute inset-0 z-[160] bg-black/80 flex flex-col justify-end" onClick={() => setItemTarget(null)}>
                <div className="bg-slate-900 border-t border-slate-600 rounded-t-lg max-h-[70%] flex flex-col safe-bottom"
                    onClick={e => e.stopPropagation()}>
                    <div className="flex-none flex justify-between items-center p-3 border-b border-slate-800">
                        <span className="font-teko text-lg tracking-wider text-cyan-300">{itemTarget} を誰に使う？ <span className="text-[10px] text-slate-500 font-zen">（残り{save.items[itemTarget] || 0}個）</span></span>
                        <button onClick={() => setItemTarget(null)} className="text-[11px] px-2.5 py-1 rounded border border-slate-600 bg-slate-800/80 text-slate-300 active:scale-95 transition">閉じる</button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3">
                        {eligible.length === 0
                            ? <div className="text-xs text-slate-500">{emptyMsg}</div>
                            : eligible.map(({ m, i, bd }) => {
                                const max = W.getEffectiveStats(m, bd).hp;
                                const pct = Math.max(0, Math.round(m.currentHp / max * 100));
                                return (
                                    <button key={i} onClick={() => useItem(itemTarget, i)}
                                        className="w-full flex items-center gap-2 p-2 mb-1 rounded bg-slate-800 border border-slate-700 hover:border-cyan-400 text-left">
                                        <div className="w-9 h-9 bg-slate-900 rounded overflow-hidden flex-none">
                                            {bd.img && <img src={bd.img} className="w-full h-full object-contain" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-xs font-bold truncate">{bd.name} <span className="text-slate-500">Lv{m.level}</span></div>
                                            <div className="text-[9px] text-slate-400">HP{m.currentHp}/{max}（{pct}%）{m.pendingStatus ? ' ・ 状態異常' : ''}</div>
                                        </div>
                                    </button>
                                );
                            })}
                    </div>
                </div>
            </div>
        );
    };

    const Msg = () => msg ? (
        <div key={msg + msgKey} className="absolute top-14 right-2 z-50 max-w-[240px] bg-slate-900/95 border border-cyan-500 rounded px-3 py-2 text-xs text-cyan-100 shadow-lg anim-toast-in">{msg}</div>
    ) : null;

    // フロアボス撃破後、拠点にいきなり戻って気づかないことがないよう
    // 明示的に「クリア」を示してから閉じさせる
    const FloorClearModal = () => {
        if (!floorClearInfo) return null;
        return (
            <div className="absolute inset-0 z-[150] bg-black/85 flex items-center justify-center p-6 animate-fade-in"
                onClick={() => setFloorClearInfo(null)}>
                <div className="w-full max-w-[320px] rounded-lg border-2 border-yellow-400 bg-slate-900 p-5 text-center shadow-[0_0_40px_rgba(250,204,21,0.3)]"
                    onClick={e => e.stopPropagation()}>
                    <div className="text-4xl mb-1">🏆</div>
                    <div className="font-teko text-3xl tracking-widest text-yellow-300 mb-1">FLOOR CLEAR</div>
                    <div className="text-sm font-bold text-white mb-2">{floorClearInfo.floorId} {floorClearInfo.floorName}</div>
                    <p className="text-xs text-slate-300 leading-relaxed mb-3">{floorClearInfo.text}</p>
                    {floorClearInfo.reward && (
                        <div className="flex justify-center gap-4 text-xs mb-3">
                            <span className="text-yellow-300">+{floorClearInfo.reward.money}円</span>
                            <span className="text-cyan-300">+{floorClearInfo.reward.exp}exp</span>
                        </div>
                    )}
                    {floorClearInfo.reward && floorClearInfo.reward.levelUps && floorClearInfo.reward.levelUps.length > 0 && (
                        <div className="text-[11px] text-green-300 bg-green-950/40 border border-green-800 rounded px-2 py-1.5 mb-3 space-y-0.5">
                            {floorClearInfo.reward.levelUps.map((lv, i) => (
                                <div key={i}>🆙 {lv.name} Lv{lv.from}→<span className="font-bold">{lv.to}</span></div>
                            ))}
                        </div>
                    )}
                    {floorClearInfo.nextFloor && (
                        <div className="text-[10px] text-slate-400 mb-3">
                            次のフロア解放: {floorClearInfo.nextFloor.id} {floorClearInfo.nextFloor.name}
                        </div>
                    )}
                    <button onClick={() => setFloorClearInfo(null)}
                        className="w-full py-2.5 rounded bg-gradient-to-b from-yellow-500 to-yellow-700 border border-yellow-300 text-sm font-bold text-slate-950 active:scale-95 transition">
                        拠点へ戻る
                    </button>
                </div>
            </div>
        );
    };

    // ショップ購入確認（個数もここで決めて一気に買える）
    const ShopBuyModal = () => {
        if (!shopBuy) return null;
        const { item, qty } = shopBuy;
        const total = item.price * qty;
        const maxQty = Math.min(99, Math.max(1, Math.floor(save.money / item.price) || 1));
        const setQty = (q) => setShopBuy(s => s ? { ...s, qty: Math.max(1, Math.min(99, q)) } : s);
        const confirm = async () => {
            const r = W.buyItem(save, item.name, qty);
            if (r.ok) { await persist(r.save); flash(`${item.name} を${qty}個購入`); setShopBuy(null); }
            else flash('所持金が足りない');
        };
        return (
            <div className="absolute inset-0 z-[160] bg-black/80 flex items-center justify-center p-6" onClick={() => setShopBuy(null)}>
                <div className="w-full max-w-[300px] rounded-lg border-2 border-cyan-600 bg-slate-900 p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
                    <div className="text-center mb-3">
                        <div className="font-bold text-base text-white">{item.name}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">{item.effect}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">現在の所持数: {save.items[item.name] || 0}個</div>
                    </div>
                    <div className="flex items-center justify-center gap-3 mb-3">
                        <button onClick={() => setQty(qty - 1)} disabled={qty <= 1}
                            className={`w-9 h-9 rounded border text-lg font-bold ${qty <= 1 ? 'border-slate-800 text-slate-700' : 'border-slate-600 bg-slate-800 text-slate-200 active:scale-95 transition'}`}>−</button>
                        <div className="w-14 text-center">
                            <div className="text-xl font-bold font-teko">{qty}</div>
                            <div className="text-[9px] text-slate-500">個</div>
                        </div>
                        <button onClick={() => setQty(qty + 1)} disabled={qty >= maxQty}
                            className={`w-9 h-9 rounded border text-lg font-bold ${qty >= maxQty ? 'border-slate-800 text-slate-700' : 'border-slate-600 bg-slate-800 text-slate-200 active:scale-95 transition'}`}>＋</button>
                    </div>
                    {maxQty > 1 && (
                        <button onClick={() => setQty(maxQty)} className="w-full text-[10px] text-cyan-400 mb-3 underline underline-offset-2">
                            買えるだけ（{maxQty}個）
                        </button>
                    )}
                    <div className="flex justify-between items-baseline mb-4 px-1">
                        <span className="text-[10px] text-slate-400">合計</span>
                        <span className={`text-lg font-bold ${total > save.money ? 'text-red-400' : 'text-yellow-300'}`}>{total}円</span>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={() => setShopBuy(null)} className="flex-1 py-2.5 rounded bg-slate-700 border border-slate-600 text-sm font-bold">やめる</button>
                        <button onClick={confirm} disabled={total > save.money}
                            className={`flex-1 py-2.5 rounded text-sm font-bold border ${total > save.money ? 'bg-slate-800 border-slate-700 text-slate-600' : 'bg-cyan-700 border-cyan-500 active:scale-95 transition'}`}>
                            購入する
                        </button>
                    </div>
                </div>
            </div>
        );
    };

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
                    <button onClick={onBack} className="w-full py-1.5 mt-1 rounded border border-slate-700 bg-slate-800/60 text-slate-400 text-[10px] active:scale-95 transition">BACK</button>
                </div>
            </div>
        );
    }

    // ---- 戦闘 ----
    if (view === 'battle' && battle) {
        const mine = myBattleParty();
        // 戦闘不能のヴァーモンを先頭に置いたまま出撃すると、戦闘不能のまま1ターン
        // 場に居座ってしまう（交代アナウンスが1ターン遅れる）ので、生存個体を優先して
        // 初期の出撃枠に入れる
        const aliveIdx = mine.map((m, i) => i).filter(i => mine[i].currentHp > 0);
        const slots = mine.length > 1 ? 2 : 1;
        const myField = [aliveIdx[0] ?? -1, slots > 1 ? (aliveIdx[1] ?? -1) : -1];
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

    // ---- 通常戦闘の戦績（お金・経験値・レベルアップ） ----
    if (view === 'reward' && battleReward) {
        const dismiss = () => {
            setBattleReward(null);
            const next = battleRewardNextRef.current;
            battleRewardNextRef.current = null;
            if (next) next();
        };
        return (
            <div className="app-container p-4 text-white flex flex-col items-center justify-center safe-bottom">
                <div className="font-teko text-4xl tracking-widest text-yellow-300 mb-4">BATTLE WON!</div>
                <div className="flex gap-6 text-lg mb-4">
                    <span className="text-yellow-300 font-bold">+{battleReward.money}円</span>
                    <span className="text-cyan-300 font-bold">+{battleReward.exp}exp</span>
                </div>
                {battleReward.levelUps.length > 0 && (
                    <div className="w-full max-w-[280px] text-sm text-green-300 bg-green-950/40 border border-green-800 rounded px-3 py-2 mb-4 space-y-1">
                        {battleReward.levelUps.map((lv, i) => (
                            <div key={i}>🆙 {lv.name} Lv{lv.from}→<span className="font-bold">{lv.to}</span></div>
                        ))}
                    </div>
                )}
                <button onClick={dismiss} className="px-8 py-3 bg-white text-black font-bold rounded font-teko text-xl tracking-wider">次へ</button>
            </div>
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

        if (capturing) {
            return (
                <div className="app-container p-4 text-white flex flex-col items-center justify-center safe-bottom">
                    <div className="w-32 h-32 bg-slate-900 rounded-lg overflow-hidden mb-3 border border-slate-700 flex items-center justify-center">
                        <span className="text-6xl anim-capture-wobble">🔴</span>
                    </div>
                    <div className="font-teko text-2xl tracking-widest text-slate-300 animate-pulse">捕獲中...</div>
                </div>
            );
        }

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

                <button onClick={skipCapture} className="w-full py-2 mt-2 rounded border border-slate-700 bg-slate-800/60 text-slate-400 text-xs active:scale-95 transition">何もしない</button>
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
                    <button onClick={() => setPendingLearn(null)} className="w-full py-2 mt-1 rounded border border-slate-700 bg-slate-800/60 text-slate-400 text-[11px] active:scale-95 transition">
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
                        <button onClick={() => setRetreatConfirm(true)}
                            className="text-[10px] px-2.5 py-1 rounded border border-red-900/60 bg-red-950/30 text-red-300 active:scale-95 transition">🚪 撤退</button>
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

                {/* 手持ちHP（拠点と同じアイコン表示＋HP数値） */}
                <div className="flex-none px-3 py-1.5 border-t border-slate-800 bg-slate-950/60">
                    <div className="flex gap-1.5">
                        {save.party.map((m, i) => {
                            const bd = baseOf(m.id); if (!bd) return null;
                            const max = W.getEffectiveStats(m, bd).hp;
                            const pct = Math.max(0, Math.round(m.currentHp / max * 100));
                            const isFront = i < 2;
                            return (
                                <button key={i} onClick={() => setDetailMon(W.toBattleMonster(m, bd))}
                                    className={`relative flex-1 min-w-0 rounded border overflow-hidden text-left active:scale-95 transition ${isFront ? 'bg-cyan-950/50 border-cyan-600' : 'bg-slate-900/80 border-slate-700'}`}>
                                    {isFront && <div className="absolute top-0.5 left-0.5 z-10 text-[7px] px-1 rounded bg-cyan-600 text-cyan-50 leading-tight">前衛</div>}
                                    {m.pendingStatus === 'poison' && <div className="absolute top-0.5 right-0.5 z-10 text-[9px] leading-none" title="毒">💀</div>}
                                    {m.pendingDebuff && <div className="absolute bottom-0.5 right-0.5 z-10 text-[7px] px-1 rounded bg-blue-900/90 text-blue-300 font-bold leading-tight" title={`次の戦闘、${m.pendingDebuff.toUpperCase()}がデバフ状態で開始`}>↓{m.pendingDebuff.toUpperCase()}</div>}
                                    <div className="w-full aspect-square bg-slate-950">
                                        {bd.img && <img src={bd.img} className={`w-full h-full object-contain ${m.currentHp <= 0 ? 'grayscale opacity-40' : ''}`} />}
                                    </div>
                                    <div className="px-1 pb-1">
                                        <div className="text-[8px] text-slate-400 leading-tight">Lv{m.level}</div>
                                        <div className="h-1 bg-slate-800 rounded overflow-hidden">
                                            <div className={`h-full ${pct < 25 ? 'bg-red-500' : pct < 50 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: pct + '%' }} />
                                        </div>
                                        <div className="text-[7px] text-slate-400 leading-tight text-right">{m.currentHp}/{max}</div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* 選択肢は片手で押せるよう画面下部にまとめる */}
                <div className="flex-none px-3 pt-2 border-t border-slate-800 bg-slate-900/80 safe-bottom">
                    {isBossNext ? (
                        <button onClick={() => enterBattle('boss')}
                            className="w-full py-5 rounded bg-red-900/70 border-2 border-red-500 font-teko text-2xl tracking-widest">
                            BOSS
                        </button>
                    ) : (
                        <div className="space-y-1.5">
                            {Object.values(W.NODE_CHOICES).map(c => {
                                // c.desc/c.tone は固定の説明文（何が起こりやすいかの傾向）。
                                // 個別の抽選結果は選ぶまで分からない
                                const tone = c.tone === 'danger' ? 'text-red-400' :
                                    c.tone === 'good' ? 'text-green-400' :
                                        c.tone === 'warn' ? 'text-yellow-400' : 'text-slate-400';
                                return (
                                    <button key={c.id} onClick={() => chooseNode(c.id)}
                                        className="w-full flex flex-col items-start px-3 py-2.5 rounded bg-slate-800/90 border border-slate-700 hover:border-cyan-400 text-left">
                                        <span className="font-bold text-sm">{c.icon} {c.label}</span>
                                        <span className={`text-[10px] mt-0.5 ${tone}`}>{c.desc}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    <div className="grid grid-cols-3 gap-1.5 mt-1.5">
                        <button onClick={() => setRestConfirm(true)} disabled={run.restsLeft <= 0}
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
                                <button onClick={() => setPanel(null)} className="text-[11px] px-2.5 py-1 rounded border border-slate-600 bg-slate-800/80 text-slate-300 active:scale-95 transition">閉じる</button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-3">
                                {Object.keys(save.items).length === 0
                                    ? <div className="text-xs text-slate-500">所持品なし</div>
                                    : Object.entries(save.items).map(([name, qty]) => {
                                        const def = W.SHOP_ITEMS.find(i => i.name === name) || {};
                                        const usable = def.kind === 'heal' || def.kind === 'cure' || def.kind === 'revive' || def.kind === 'heal_all' || def.kind === 'cure_all';
                                        return (
                                            <div key={name} className="flex items-center gap-2 p-2 mb-1 bg-slate-800 rounded border border-slate-700">
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-xs font-bold truncate">{name} ×{qty}</div>
                                                    <div className="text-[9px] text-slate-400">{def.effect || ''}</div>
                                                </div>
                                                {usable
                                                    ? <button onClick={() => (def.kind === 'heal_all' || def.kind === 'cure_all') ? useItemAll(name) : setItemTarget(name)} className="text-[10px] px-3 py-1.5 bg-green-700 rounded flex-none">使う</button>
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
                                <button onClick={() => { setPanel(null); setMovePartyIndex(null); }}
                                    className="text-[10px] px-2.5 py-1 rounded border border-slate-600 bg-slate-800/80 text-slate-300 active:scale-95 transition">閉じる</button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-3">
                                <div className="text-[9px] text-slate-500 mb-2">先頭2体が出撃時の前衛になる・⠿を掴んでドラッグでも並び替えられる</div>
                                {save.party.map((m, i) => {
                                    const bd = baseOf(m.id); if (!bd) return null;
                                    const st = W.getEffectiveStats(m, bd);
                                    const open = movePartyIndex === i;
                                    const isFront = i < 2;
                                    const isDragOver = drag && drag.overSource === 'party' && drag.overIndex === i && !(drag.source === 'party' && drag.index === i);
                                    const isDragging = drag && drag.source === 'party' && drag.index === i;
                                    return (
                                        <div key={i} {...dragSlotProps('party', i)}
                                            className={`mb-2 rounded border transition ${isDragOver ? 'border-yellow-400 bg-yellow-950/30' : isFront ? 'bg-cyan-950/40 border-cyan-700' : 'bg-slate-800 border-slate-700'} ${isDragging ? 'opacity-40' : ''}`}>
                                            <div className="flex items-center gap-2 p-2">
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
                                                <div {...dragHandleProps('party', i)}
                                                    className="w-5 h-8 flex-none flex items-center justify-center text-slate-500 text-sm cursor-grab active:cursor-grabbing select-none">⠿</div>
                                            </div>
                                            {open && (
                                                <div className="px-2 pb-2">
                                                    {MoveEquipEditor({ partyIndex: i, m })}
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
                {restConfirm && (
                    <div className="absolute inset-0 z-[150] bg-black/80 flex items-center justify-center p-6" onClick={() => setRestConfirm(false)}>
                        <div className="w-full max-w-[300px] rounded-lg border-2 border-slate-600 bg-slate-900 p-5 text-center shadow-2xl" onClick={e => e.stopPropagation()}>
                            <div className="text-3xl mb-2">🛌</div>
                            <div className="font-bold text-base text-white mb-1">休憩する？</div>
                            <p className="text-xs text-slate-400 mb-4">
                                手持ち全員のHPを30%回復する（戦闘不能のヴァーモンは回復しない）。<br />
                                このフロアで残り<span className="text-white font-bold">{run.restsLeft}回</span>のうち1回を消費する
                            </p>
                            <div className="flex gap-2">
                                <button onClick={() => setRestConfirm(false)} className="flex-1 py-2.5 rounded bg-slate-700 text-sm font-bold">戻る</button>
                                <button onClick={async () => { setRestConfirm(false); await doRest(); }}
                                    className="flex-1 py-2.5 rounded bg-cyan-700 text-sm font-bold">休憩する</button>
                            </div>
                        </div>
                    </div>
                )}
                {retreatConfirm && (
                    <div className="absolute inset-0 z-[150] bg-black/80 flex items-center justify-center p-6" onClick={() => setRetreatConfirm(false)}>
                        <div className="w-full max-w-[300px] rounded-lg border-2 border-slate-600 bg-slate-900 p-5 text-center shadow-2xl" onClick={e => e.stopPropagation()}>
                            <div className="text-3xl mb-2">🚪</div>
                            <div className="font-bold text-base text-white mb-1">このフロアから撤退する？</div>
                            <p className="text-xs text-slate-400 mb-4">拠点に戻り全回復するが、フロアの進行状況（{Math.min(run.step, floor.battles)}/{floor.battles}）は失われる</p>
                            <div className="flex gap-2">
                                <button onClick={() => setRetreatConfirm(false)} className="flex-1 py-2.5 rounded bg-slate-700 text-sm font-bold">戻る</button>
                                <button onClick={async () => { setRetreatConfirm(false); await persist(healAtBase({ ...save, dungeonRun: null })); setRun(null); setBaseTab('home'); setView('base'); }}
                                    className="flex-1 py-2.5 rounded bg-red-700 text-sm font-bold">撤退する</button>
                            </div>
                        </div>
                    </div>
                )}
                <EventModal />
                <ItemTargetPicker />
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
                    <button onClick={() => setView('base')} className="text-[10px] px-2.5 py-1 rounded border border-slate-600 bg-slate-800/80 text-slate-300 active:scale-95 transition">BACK</button>
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
                                            {f.bossKind === 'researcher' ? (
                                                <span className="text-[9px] px-1.5 py-0.5 rounded border border-red-700 text-red-300">
                                                    BOSS エリート研究員 編成部隊
                                                </span>
                                            ) : (Array.isArray(f.boss) ? f.boss : [f.boss]).map(name => {
                                                const bossBd = dbMonsters.find(m => m.name === name);
                                                const bossOwned = bossBd && [...save.party, ...save.box].some(m => m.id === bossBd.id);
                                                return (
                                                    <span key={name} className={`text-[9px] px-1.5 py-0.5 rounded border ${bossOwned ? 'border-slate-700 text-slate-500' : 'border-red-600 text-red-300'}`}>
                                                        BOSS {name}{bossOwned ? '（捕獲済）' : ' ★'}
                                                    </span>
                                                );
                                            })}
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
                        <button onClick={onBack} className="text-[10px] px-2.5 py-1 rounded border border-slate-600 bg-slate-800/80 text-slate-300 active:scale-95 transition">TITLE</button>
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
                <FloorClearModal />
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

            {baseTab === 'party' ? (
                // 手持ち・絞り込み・ソートは「スクロールしない固定エリア」として
                // スクロール領域の外に出す。sticky で固定するとスクロール領域自身の
                // padding 分だけ上に隙間が残り、そこをボックスの行が通り抜けて
                // 見えてしまうため、スクロールする範囲をボックス一覧だけに限定している
                <div className="flex-1 min-h-0 flex flex-col">
                    <div className="flex-none p-3 pb-2 border-b border-slate-800">
                        <div className="text-[10px] text-slate-400 mb-1">手持ち（最大4）・先頭2体が出撃時の前衛になる・⠿を掴んでドラッグで並び替え・ボックスとの入れ替えもできる</div>
                        {save.party.map((m, i) => {
                            const bd = baseOf(m.id); if (!bd) return null;
                            const st = W.getEffectiveStats(m, bd);
                            const isFront = i < 2;
                            const isDragOver = drag && drag.overSource === 'party' && drag.overIndex === i && !(drag.source === 'party' && drag.index === i);
                            const isDragging = drag && drag.source === 'party' && drag.index === i;
                            const rowClick = () => setDetailMon({ ...W.toBattleMonster(m, bd), knownMoves: m.knownMoves });
                            return (
                                <div key={i} {...dragSlotProps('party', i)}
                                    className={`flex items-center gap-2 p-1.5 mb-1 rounded border transition ${isDragOver ? 'border-yellow-400 bg-yellow-950/30' : isFront ? 'bg-cyan-950/40 border-cyan-700' : 'bg-slate-800 border-slate-700'} ${isDragging ? 'opacity-40' : ''}`}>
                                    <button onClick={rowClick}
                                        className="w-7 h-7 bg-slate-900 rounded overflow-hidden flex-none relative">
                                        {bd.img && <img src={bd.img} className="w-full h-full object-contain" />}
                                    </button>
                                    <div className="text-[11px] flex-1 min-w-0" onClick={rowClick}>
                                        <div className="truncate flex items-center gap-1">
                                            {bd.name} <span className="text-slate-500">Lv{m.level}</span>
                                            <span className={`px-1 rounded text-[8px] text-white font-bold flex-none ${W.TYPE_BG[bd.type]}`}>{W.TYPE_NAMES[bd.type]}</span>
                                            {isFront && <span className="text-[8px] px-1 rounded bg-cyan-700 text-cyan-100 flex-none">前衛</span>}
                                        </div>
                                        <div className="text-[9px] flex gap-1.5 flex-wrap">
                                            <span><span className="text-green-400 font-bold">HP</span> <span className="text-slate-300">{m.currentHp}/{st.hp}</span></span>
                                            <span><span className="text-red-400 font-bold">ATK</span> <span className="text-slate-300">{st.atk}</span></span>
                                            <span><span className="text-blue-400 font-bold">DEF</span> <span className="text-slate-300">{st.def}</span></span>
                                            <span><span className="text-yellow-400 font-bold">SPD</span> <span className="text-slate-300">{st.spd}</span></span>
                                        </div>
                                    </div>
                                    <div {...dragHandleProps('party', i)}
                                        className="w-5 h-8 flex-none flex items-center justify-center text-slate-500 text-sm cursor-grab active:cursor-grabbing select-none">⠿</div>
                                </div>
                            );
                        })}
                        {save.box.length > 0 && (
                            <>
                                <div className="flex items-center gap-1 mt-2 mb-1 flex-wrap">
                                    <span className="text-[9px] text-slate-500">属性:</span>
                                    {['fire', 'water', 'grass', 'light', 'dark', 'normal'].map(t => (
                                        <button key={t} onClick={() => setBoxFilter(boxFilter === t ? null : t)}
                                            className={`text-[9px] px-1.5 py-0.5 rounded border font-bold text-white ${boxFilter === t ? `${W.TYPE_BG[t]} border-white` : 'bg-slate-800 border-slate-700 opacity-50'}`}>{W.TYPE_NAMES[t]}</button>
                                    ))}
                                </div>
                                <div className="flex items-center gap-1 mb-1 flex-wrap">
                                    <span className="text-[9px] text-slate-500">並び替え:</span>
                                    {[['hp', 'HP', 'text-green-400'], ['atk', 'ATK', 'text-red-400'], ['def', 'DEF', 'text-blue-400'], ['spd', 'SPD', 'text-yellow-400']].map(([key, label, color]) => (
                                        <button key={key} onClick={() => setBoxSort(boxSort === key ? null : key)}
                                            className={`text-[9px] px-1.5 py-0.5 rounded border font-bold ${boxSort === key ? `${color} border-current bg-slate-800` : 'text-slate-500 border-slate-700'}`}>{label}</button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto p-3 pt-2">
                        {save.box.length > 0 && (() => {
                            const boxView = save.box.map((m, i) => ({ m, i, bd: baseOf(m.id) }))
                                .filter(x => x.bd && (!boxFilter || x.bd.type === boxFilter))
                                .sort((a, b) => boxSort ? W.getEffectiveStats(b.m, b.bd)[boxSort] - W.getEffectiveStats(a.m, a.bd)[boxSort] : 0);
                            return (
                            <>
                                <div className="text-[10px] text-slate-400 mb-1">ボックス（{save.box.length}）・タップで詳細、⠿を掴んでドラッグで手持ちと入れ替え</div>
                                {boxView.length === 0 && <div className="text-[10px] text-slate-600">この属性の所持なし</div>}
                                {boxView.map(({ m, i, bd }) => {
                                    const st = W.getEffectiveStats(m, bd);
                                    const isDragOver = drag && drag.overSource === 'box' && drag.overIndex === i && !(drag.source === 'box' && drag.index === i);
                                    const isDragging = drag && drag.source === 'box' && drag.index === i;
                                    return (
                                        <div key={i} {...dragSlotProps('box', i)}
                                            onClick={() => setDetailMon({ ...W.toBattleMonster(m, bd), knownMoves: m.knownMoves })}
                                            className={`flex items-center gap-2 p-1.5 mb-1 rounded border cursor-pointer transition ${isDragOver ? 'border-yellow-400 bg-yellow-950/30' : 'bg-slate-800/70 border-slate-700'} ${isDragging ? 'opacity-40' : ''}`}>
                                            <div className="w-7 h-7 bg-slate-900 rounded overflow-hidden flex-none">
                                                {bd.img && <img src={bd.img} className="w-full h-full object-contain" />}
                                            </div>
                                            <div className="text-[11px] flex-1 min-w-0">
                                                <div className="truncate flex items-center gap-1">
                                                    {bd.name} <span className="text-slate-500">Lv{m.level}</span>
                                                    <span className={`px-1 rounded text-[8px] text-white font-bold flex-none ${W.TYPE_BG[bd.type]}`}>{W.TYPE_NAMES[bd.type]}</span>
                                                </div>
                                                <div className="text-[9px] flex gap-1.5 flex-wrap">
                                                    <span><span className="text-green-400 font-bold">HP</span> <span className="text-slate-300">{st.hp}</span></span>
                                                    <span><span className="text-red-400 font-bold">ATK</span> <span className="text-slate-300">{st.atk}</span></span>
                                                    <span><span className="text-blue-400 font-bold">DEF</span> <span className="text-slate-300">{st.def}</span></span>
                                                    <span><span className="text-yellow-400 font-bold">SPD</span> <span className="text-slate-300">{st.spd}</span></span>
                                                </div>
                                            </div>
                                            <div {...dragHandleProps('box', i)}
                                                className="w-5 h-7 flex-none flex items-center justify-center text-slate-500 text-sm cursor-grab active:cursor-grabbing select-none">⠿</div>
                                        </div>
                                    );
                                })}
                            </>
                            );
                        })()}
                    </div>
                </div>
            ) : (
            <div className="flex-1 overflow-y-auto p-3">
                {baseTab === 'moves' && save.party.map((m, i) => {
                    const bd = baseOf(m.id); if (!bd) return null;
                    return (
                        <div key={i} className="mb-3">
                            <div className="text-xs font-bold mb-1">{bd.name} <span className="text-slate-500">Lv{m.level}</span>
                                <span className="text-[9px] text-slate-500 ml-1">装備 {m.equippedMoves.length}/3</span></div>
                            {MoveEquipEditor({ partyIndex: i, m, compact: true })}
                        </div>
                    );
                })}

                {baseTab === 'shop' && W.SHOP_ITEMS.map(item => (
                    <div key={item.name} className="flex items-center gap-2 p-2 mb-1 bg-slate-800 rounded border border-slate-700">
                        <div className="flex-1 min-w-0">
                            <div className="text-xs font-bold truncate">{item.name} <span className="text-slate-500 text-[10px]">所持{save.items[item.name] || 0}</span></div>
                            <div className="text-[9px] text-slate-400">{item.effect}</div>
                        </div>
                        <div className="text-[10px] text-yellow-300 flex-none">{item.price}円</div>
                        <button onClick={() => setShopBuy({ item, qty: 1 })}
                            className="text-[9px] px-2 py-1 bg-cyan-700 rounded flex-none border border-cyan-500 active:scale-95 transition">買う</button>
                    </div>
                ))}

                {baseTab === 'items' && (
                    Object.keys(save.items).length === 0
                        ? <div className="text-xs text-slate-500">所持品なし</div>
                        : Object.entries(save.items).map(([name, qty]) => {
                            const def = W.SHOP_ITEMS.find(i => i.name === name) || {};
                            const usable = def.kind === 'heal' || def.kind === 'cure' || def.kind === 'revive' || def.kind === 'heal_all' || def.kind === 'cure_all';
                            return (
                                <div key={name} className="flex items-center gap-2 p-2 mb-1 bg-slate-800 rounded border border-slate-700">
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-bold truncate">{name} ×{qty}</div>
                                        <div className="text-[9px] text-slate-400">{def.effect || ''}</div>
                                    </div>
                                    {usable && (
                                        <button onClick={() => (def.kind === 'heal_all' || def.kind === 'cure_all') ? useItemAll(name) : setItemTarget(name)}
                                            className="text-[9px] px-2 py-1 bg-green-700 rounded flex-none">使う</button>
                                    )}
                                </div>
                            );
                        })
                )}
            </div>
            )}

            <div className="flex-none p-3 border-t border-slate-800 safe-bottom">
                <button onClick={() => setBaseTab('home')}
                    className="w-full py-2 rounded bg-slate-800 border border-slate-600 text-sm font-teko tracking-wider">
                    ホームに戻る
                </button>
            </div>
            {detailMon && <window.MonsterDetailModal monster={detailMon} showMoves dbMoves={dbMoves} onClose={() => setDetailMon(null)} />}
            <ItemTargetPicker />
            <ShopBuyModal />
            <Msg />
        </div>
    );
};
