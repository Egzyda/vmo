const { useState, useEffect, useRef } = React;
const { doc, onSnapshot, updateDoc } = window.fb;
const { db, BigMonsterCard, optimizeEnemyLead, getGeminiLead, normalizePartyTypes } = window;

const MemberSelection = ({ myParty, enemyParty, onComplete, onBack, isOnline, roomId, role, difficulty }) => {
     const [currentParty, setCurrentParty] = useState(myParty);
     const [activeSlot, setActiveSlot] = useState(1);
     const [loadedTeams, setLoadedTeams] = useState({ 1: null, 2: null, 3: null });

     const [selectedIndices, setSelectedIndices] = useState([]);
     const [onlineOpponentParty, setOnlineOpponentParty] = useState(null);
     const [opponentReady, setOpponentReady] = useState(false);
     const [iAmReady, setIAmReady] = useState(false);
     const [isAiThinking, setIsAiThinking] = useState(false);

     const aiSelectionPromiseRef = useRef(null);

     useEffect(() => {
         const teams = { 1: null, 2: null, 3: null };
         let foundSlot = 1;
         const currentJson = JSON.stringify(myParty);

         [1, 2, 3].forEach(i => {
             const saved = localStorage.getItem(`vmo_party_${i}`);
             if (saved) {
                 try {
                     // 旧セーブは絵文字typeを持つため正規化する
                     const parsed = normalizePartyTypes(JSON.parse(saved));
                     teams[i] = parsed;
                     if (JSON.stringify(parsed) === currentJson) {
                         foundSlot = i;
                     }
                 } catch (e) {
                     console.error("Team load error:", e);
                 }
             }
         });
         setLoadedTeams(teams);
         setActiveSlot(foundSlot);
         setCurrentParty(myParty);
     }, [myParty]);

     useEffect(() => {
         if (!isOnline && difficulty === 'master' && enemyParty.length > 0) {
             aiSelectionPromiseRef.current = getGeminiLead(enemyParty, currentParty);
         }
     }, [isOnline, difficulty, enemyParty, currentParty]);

     useEffect(() => {
         if (isOnline && roomId && !iAmReady) {
             const fieldName = role === 'host' ? 'hostParty' : 'guestParty';
             updateDoc(doc(db, "battles", roomId), { [fieldName]: currentParty });
         }
     }, [isOnline, roomId, role, currentParty, iAmReady]);

     useEffect(() => {
         if (!isOnline) return;
         const unsub = onSnapshot(doc(db, "battles", roomId), (doc) => {
             const data = doc.data();
             if (!data) return;
             // 相手が旧バージョン(絵文字type)のクライアントの可能性があるため正規化する
             const opponentPartyRaw = role === 'host' ? data.guestParty : data.hostParty;
             if (opponentPartyRaw) setOnlineOpponentParty(normalizePartyTypes(opponentPartyRaw));

             const myField = role === 'host' ? data.hostField : data.guestField;
             const opField = role === 'host' ? data.guestField : data.hostField;

             if (myField) setIAmReady(true);
             if (opField) setOpponentReady(true);

             if (myField && opField) {
                 const myP = role === 'host' ? data.hostParty : data.guestParty;
                 const enP = role === 'host' ? data.guestParty : data.hostParty;
                 onComplete(myField, opField, normalizePartyTypes(myP), normalizePartyTypes(enP));
             }
         });
         return () => unsub();
     }, [isOnline, roomId, role]);

     const switchTeam = (slot) => {
         if (iAmReady || isAiThinking || !loadedTeams[slot]) return;
         setActiveSlot(slot);
         setCurrentParty(loadedTeams[slot]);
         setSelectedIndices([]);
         if (!isOnline && difficulty === 'master' && enemyParty.length > 0) {
            aiSelectionPromiseRef.current = getGeminiLead(enemyParty, loadedTeams[slot]);
         }
     };

     const toggleSelect = (idx) => {
         if (iAmReady || isAiThinking) return;
         if (selectedIndices.includes(idx)) setSelectedIndices(selectedIndices.filter(i => i !== idx));
         else if (selectedIndices.length < 2) setSelectedIndices([...selectedIndices, idx]);
     };

     const handleStart = async () => {
         const myField = [-1, -1];
         myField[0] = selectedIndices[0];
         myField[1] = selectedIndices[1];

         if (isOnline) {
             setIAmReady(true);
             const fieldName = role === 'host' ? 'hostField' : 'guestField';
             await updateDoc(doc(db, "battles", roomId), { [fieldName]: myField });
         } else {
             let finalEnemyParty = enemyParty;
             let finalEnemyField = [0, 1];

             if (difficulty === 'master' && aiSelectionPromiseRef.current) {
                 setIsAiThinking(true);
                 try {
                     const optimizedParty = await aiSelectionPromiseRef.current;
                     if (optimizedParty) finalEnemyParty = optimizedParty;
                 } catch (e) {
                     console.warn("AI Lead Selection Error:", e);
                 }
                 setIsAiThinking(false);
             } else {
                 finalEnemyParty = optimizeEnemyLead(enemyParty, currentParty);
             }

             onComplete(myField, finalEnemyField, currentParty, finalEnemyParty);
         }
     };

     const displayEnemyParty = isOnline ? (onlineOpponentParty || null) : enemyParty;

     return (
         <div className="flex flex-col h-full bg-slate-900 p-4 text-center text-white justify-center relative">
             {isAiThinking && (
                 <div className="absolute inset-0 bg-black/80 z-50 flex items-center justify-center flex-col">
                     <div className="loading-spinner mb-4"></div>
                     <div className="font-teko text-2xl tracking-widest animate-pulse text-red-500">OPPONENT IS SELECTING...</div>
                 </div>
             )}

             <h2 className="text-xl font-teko text-white mb-2 tracking-widest text-center flex-none">{isOnline ? 'ONLINE PREPARATION' : 'BATTLE PREPARATION'}</h2>

             <div className="flex-1 bg-slate-800 rounded p-3 mb-2 overflow-y-auto min-h-0">
                 <h3 className="text-sm font-bold text-red-400 mb-2">ENEMY TEAM {isOnline && (opponentReady ? '(READY)' : '(CHOOSING...)')}</h3>
                 {displayEnemyParty ? (
                     <div className={`grid grid-cols-2 gap-2 ${opponentReady ? 'opacity-100' : 'opacity-90'}`}>
                         {displayEnemyParty.map((mon, idx) => (
                             <div key={idx} className="relative">
                                {/* ★変更: shortLabelsを追加してスマホ対応 */}
                                <BigMonsterCard monster={mon} index={idx} isSelected={false} shortLabels />
                             </div>
                         ))}
                     </div>
                 ) : (
                     <div className="h-full flex items-center justify-center text-gray-500 font-teko animate-pulse">WAITING FOR OPPONENT...</div>
                 )}
             </div>

             <div className="flex-1 bg-slate-800 rounded p-3 mb-4 relative flex flex-col min-h-0">
                 <div className="flex justify-between items-center mb-2">
                     <h3 className="text-sm font-bold text-blue-400 text-left leading-tight">
                         YOUR TEAM<br/>
                         <span className="text-xs opacity-80">{iAmReady ? '(READY)' : '(SELECT 2)'}</span>
                     </h3>

                     {!iAmReady && (
                         <div className="flex gap-1">
                             {[1, 2, 3].map(slot => (
                                 <button
                                     key={slot}
                                     onClick={() => switchTeam(slot)}
                                     disabled={!loadedTeams[slot]}
                                     className={`px-3 py-0.5 text-xs font-teko tracking-wider border rounded transition-colors
                                         ${activeSlot === slot
                                             ? 'bg-blue-600 border-blue-400 text-white'
                                             : (loadedTeams[slot] ? 'bg-slate-700 border-slate-600 text-gray-400 hover:bg-slate-600' : 'bg-slate-900 border-slate-800 text-slate-700 opacity-50 cursor-not-allowed')
                                         }
                                     `}
                                 >
                                     TEAM {slot}
                                 </button>
                             ))}
                         </div>
                     )}
                 </div>

                 <div className={`grid grid-cols-2 gap-2 flex-1 min-h-0 overflow-y-auto content-start ${iAmReady ? 'opacity-disabled' : ''}`}>
                     {currentParty.map((mon, idx) => {
                         const order = selectedIndices.indexOf(idx);
                         const isSelected = order !== -1;
                         return (
                             <div
                                 key={idx}
                                 onClick={() => toggleSelect(idx)}
                                 className="relative cursor-pointer transition-transform duration-200 hover:scale-[1.02]"
                             >
                                 {/* ★変更: shortLabelsを追加してスマホ対応 */}
                                 <BigMonsterCard monster={mon} index={idx} isSelected={isSelected} onClick={() => toggleSelect(idx)} shortLabels />
                                 {isSelected && <div className="absolute top-0 right-0 bg-blue-600 text-white text-sm font-bold w-6 h-6 flex items-center justify-center rounded-bl shadow z-20 border-l border-b border-blue-400">{order + 1}</div>}
                             </div>
                         );
                     })}
                 </div>

                 {iAmReady && <div className="absolute inset-0 flex items-center justify-center bg-black/30 text-white font-teko text-xl tracking-widest rounded">WAITING...</div>}
             </div>

             <div className="flex gap-2 h-12 flex-none safe-bottom box-content">
                 {!iAmReady && <button onClick={onBack} className="w-1/3 bg-gray-700 rounded text-gray-300 font-bold hover:bg-gray-600 transition">BACK</button>}
                 <button onClick={handleStart} disabled={selectedIndices.length !== 2 || iAmReady || (isOnline && !displayEnemyParty)} className={`flex-1 rounded font-bold text-white transition ${selectedIndices.length === 2 && (!isOnline || (displayEnemyParty && !iAmReady)) ? 'bg-blue-600 hover:bg-blue-500' : 'bg-gray-800 text-gray-500 cursor-not-allowed'}`}>{isOnline ? (iAmReady ? 'WAITING...' : 'READY') : 'BATTLE START'}</button>
             </div>
         </div>
     );
};

window.MemberSelection = MemberSelection;