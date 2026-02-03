// monsters.jsに spAtk, spDef を追加するスクリプト
// 既存のatkを基にspAtkを、defを基にspDefを計算
// 物理型(atkが高い)はspAtkを低く、特殊型はspAtkを高く設定

const fs = require('fs');

const content = fs.readFileSync('monsters.js', 'utf8');

// 各モンスターエントリを処理
// "atk": 値, の次行に "spAtk": 値, を追加
// "def": 値, の次行に "spDef": 値, を追加

let result = content;

// 正規表現でatk行を見つけて、その後にspAtk行を挿入
result = result.replace(/"atk": (\d+),\n/g, (match, atkVal) => {
    const atk = parseInt(atkVal);
    // spAtkはatkの±30%のランダム値（多様性を持たせる）
    // ただし総合値を保つため、atk + spAtk の最大値を使う設計
    const spAtk = Math.round(atk * (0.6 + Math.random() * 0.4)); // 60-100%
    return `"atk": ${atk},\n      "spAtk": ${spAtk},\n`;
});

// 同様にdefの後にspDefを追加
result = result.replace(/"def": (\d+),\n/g, (match, defVal) => {
    const def = parseInt(defVal);
    const spDef = Math.round(def * (0.6 + Math.random() * 0.4)); // 60-100%
    return `"def": ${def},\n      "spDef": ${spDef},\n`;
});

fs.writeFileSync('monsters.js', result, 'utf8');
console.log('Successfully added spAtk and spDef to all monsters!');
