const { useState } = React;
const { doc, setDoc, onSnapshot, updateDoc, getDoc } = window.fb;
const { db, auth } = window;

const OnlineLobby = ({ onBack, onGameStart }) => {
    const [mode, setMode] = useState('menu');
    const [roomId, setRoomId] = useState('');
    const [inputRoomId, setInputRoomId] = useState('');
    const [error, setError] = useState('');
    const [isLoggingIn, setIsLoggingIn] = useState(true);

    // Default to logging in anonymously when component mounts
    React.useEffect(() => {
        const login = async () => {
            try {
                if (!auth.currentUser) {
                    await window.fb.signInAnonymously(auth);
                }
                setIsLoggingIn(false);
            } catch (err) {
                console.error("Login Error:", err);
                setError("Login failed: " + err.message);
                setIsLoggingIn(false);
            }
        };
        login();
    }, []);

    const createRoom = async () => {
        if (isLoggingIn) return;
        const user = auth.currentUser;
        if (!user) { alert("ログインできていません。再読み込みしてください。"); return setError("Login failed"); }

        // Generate a random 4-digit numeric ID
        const newRoomId = Math.floor(1000 + Math.random() * 9000).toString();
        try {
            await setDoc(doc(db, "battles", newRoomId), { hostId: user.uid, status: 'waiting', createdAt: new Date().toISOString() });
            setRoomId(newRoomId); setMode('waiting');
            const unsub = onSnapshot(doc(db, "battles", newRoomId), (docSnap) => {
                const data = docSnap.data();
                if (data && data.guestId) {
                    unsub();
                    onGameStart({ roomId: newRoomId, role: 'host' });
                }
            });
        } catch (e) {
            console.error("Room Create Error:", e);
            alert("部屋の作成に失敗しました。\nFirebaseのセキュリティルールを確認してください。\n" + e.message);
        }
    };

    const joinRoom = async () => {
        if (isLoggingIn) return;
        const user = auth.currentUser;
        if (!user) return setError("Login failed");
        if (inputRoomId.length !== 4) return setError("Enter 4 digits");

        try {
            const roomRef = doc(db, "battles", inputRoomId);
            const roomSnap = await getDoc(roomRef);
            if (roomSnap.exists() && roomSnap.data().status === 'waiting') {
                await updateDoc(roomRef, { guestId: user.uid, status: 'matched' });
                onGameStart({ roomId: inputRoomId, role: 'guest' });
            } else {
                setError("Room not found or full");
            }
        } catch (e) {
            console.error("Join Error:", e);
            setError("Join failed: " + e.message);
        }
    };
    return (
        <div className="flex flex-col h-full bg-slate-900 p-6 text-center text-white justify-center">
            <h2 className="text-3xl font-teko mb-6 tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">ONLINE BATTLE</h2>
            {isLoggingIn && <div className="animate-pulse text-blue-400 font-teko text-xl mb-4">CONNECTING TO SERVER...</div>}
            {!isLoggingIn && error && <div className="text-red-500 text-xs mb-4 border border-red-500/50 p-2 rounded bg-red-900/20">{error}</div>}

            {!isLoggingIn && mode === 'menu' && (<div className="space-y-6 animate-fade-in"> <button onClick={createRoom} className="w-full py-4 bg-blue-700 rounded font-bold border-t border-blue-400 shadow-lg hover:scale-105 transition">CREATE ROOM</button> <button onClick={() => setMode('join')} className="w-full py-4 bg-purple-700 rounded font-bold border-t border-purple-400 shadow-lg hover:scale-105 transition">JOIN ROOM</button> <button onClick={onBack} className="text-gray-500 font-teko tracking-widest mt-4">BACK TO TITLE</button> <div className="text-xs text-gray-500 mt-8">※現在、誰でも部屋を作成・入室できるテストモードです。</div> </div>)}
            {mode === 'waiting' && (<div className="flex flex-col items-center justify-center h-full animate-fade-in"> <p className="text-gray-400 text-sm mb-2">WAITING FOR CHALLENGER...</p> <div className="text-6xl font-teko font-bold text-yellow-400 tracking-widest mb-4">{roomId}</div> <div className="loading-spinner mb-8"></div> <p className="text-xs text-gray-500">Share this ID with your friend</p> <button onClick={onBack} className="mt-8 text-gray-500 text-xs">CANCEL</button> </div>)}
            {mode === 'join' && (<div className="flex flex-col items-center justify-center h-full animate-fade-in space-y-4"> <p className="text-gray-300 font-bold">ENTER ROOM ID</p> <input type="number" className="bg-slate-800 text-white text-center text-3xl p-3 w-full rounded border border-slate-600 focus:border-blue-500 outline-none font-teko tracking-widest" placeholder="0000" value={inputRoomId} onChange={(e) => setInputRoomId(e.target.value.slice(0, 4))} /> {error && <p className="text-red-500 text-xs">{error}</p>} <button onClick={joinRoom} className="w-full py-3 bg-green-600 rounded font-bold hover:bg-green-500 transition">JOIN</button> <button onClick={() => setMode('menu')} className="text-gray-500 text-xs">CANCEL</button> </div>)}
        </div>
    );
};
window.OnlineLobby = OnlineLobby;