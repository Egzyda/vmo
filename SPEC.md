# VMO ハイクオリティ化 最終仕様書 v1.2

> **目標**: 誰が実装しても同じゲームになる詳細仕様

## 重要方針

> [!IMPORTANT]
> **既存対戦モードへの影響最小化**
> - 既存の `BattleEngine.js` のロジックは極力変更しない
> - アドベンチャー専用機能（下位技、レベル、経験値等）は別ファイルで管理
> - 対戦モードとアドベンチャーモードでデータを分離
> - 共通変更は「技4つ化」「6ステータス化」「属性ID化」「UI改修」のみ

---

## 1. 全体システム仕様

### 1.1 属性定義

| 内部ID | 日本語 | バッジ背景色 | 相性（2倍） | 相性（0.5倍） |
|--------|--------|-------------|-------------|---------------|
| `fire` | 炎 | 赤系 | grass | water, fire |
| `water` | 水 | 青系 | fire | grass, water |
| `grass` | 草 | 緑系 | water | fire, grass |
| `light` | 光 | 金/白系 | dark | light |
| `dark` | 闘 | 紫/黒系 | light | dark |
| `normal` | 無 | グレー系 | なし | なし |

※絵文字は使用しない。内部は英語ID、表示は漢字一文字バッジ

### 1.2 ステータス構成

```javascript
{
  id: number,
  name: string,
  type: "fire" | "water" | "grass" | "light" | "dark" | "normal",
  hp: number,      // HP（5の倍数）
  atk: number,     // 物理攻撃（5の倍数）
  spAtk: number,   // 特殊攻撃（5の倍数）
  def: number,     // 物理防御（5の倍数）
  spDef: number,   // 特殊防御（5の倍数）
  spd: number,     // 素早さ（5の倍数）
  moves: string[],
  img: string,
  desc: string
}
```

### 1.3 ステータスバランス

```javascript
const STAT_WEIGHTS = {
  hp: 1.0, atk: 1.3, spAtk: 1.3, def: 1.1, spDef: 1.1, spd: 1.2
};
const TARGET_TOTAL = 500;
const TOLERANCE = 10;
// 既存モンスターの個性を維持しながら分割
```

### 1.4 技の数
- **対戦・アドベンチャー共通**: 4技

---

## 2. 技システム仕様

### 2.1 汎用技（物理/特殊両版、威力同じ）

#### 炎属性（威力110/65）
| 技名 | 威力 | カテゴリ | 対象 |
|------|------|----------|------|
| フレイムバースト | 110 | special | single |
| ファイアクロー | 110 | physical | single |
| ヒートウェーブ | 65 | special | all_enemies |
| フレイムラッシュ | 65 | physical | all_enemies |

#### 水属性（威力110/65）
| 技名 | 威力 | カテゴリ | 対象 |
|------|------|----------|------|
| アクアストリーム | 110 | special | single |
| アクアファング | 110 | physical | single |
| マッドウェーブ | 65 | special | all_enemies |
| タイダルスラッシュ | 65 | physical | all_enemies |

#### 草属性（威力110/65）
| 技名 | 威力 | カテゴリ | 対象 |
|------|------|----------|------|
| リーフストーム | 110 | special | single |
| ソーンウィップ | 110 | physical | single |
| カッターウィンド | 65 | special | all_enemies |
| ブレイドリーフ | 65 | physical | all_enemies |

#### 光属性（威力100/65）
| 技名 | 威力 | カテゴリ | 対象 |
|------|------|----------|------|
| ホーリーレイ | 100 | special | single |
| ホーリークロー | 100 | physical | single |
| フラッシュバン | 65 | special | all_enemies |
| ライトスラッシュ | 65 | physical | all_enemies |

#### 闇属性（威力100/65）
| 技名 | 威力 | カテゴリ | 対象 |
|------|------|----------|------|
| ダークレイ | 100 | special | single |
| ダークインパクト | 100 | physical | single |
| ダークミスト | 65 | special | all_enemies |
| シャドウストライク | 65 | physical | all_enemies |

#### 無属性（威力90）
| 技名 | 威力 | カテゴリ | 対象 |
|------|------|----------|------|
| ラッシュ | 90 | physical | single |
| マインドショット | 90 | special | single |

### 2.2 バフ/デバフ技

#### バフ
| 技名 | 効果 | 対象 |
|------|------|------|
| パワーチャージ | buff_atk | ally |
| コンセントレート | buff_spAtk | ally |
| アイアンシェル | buff_def | ally |
| マインドバリア | buff_spDef | ally |
| アクセルステップ | buff_spd | ally |

#### デバフ
| 技名 | 効果 | 対象 |
|------|------|------|
| インティミデイト | debuff_atk | all_enemies |
| サイレンス | debuff_spAtk | all_enemies |
| アシッドボム | debuff_def | all_enemies |
| マインドクラッシュ | debuff_spDef | all_enemies |
| スパイダーネット | debuff_spd | all_enemies |

### 2.3 アドベンチャー専用技（下位互換）

| 技名 | 属性 | 威力 | カテゴリ |
|------|------|------|----------|
| プチファイア | fire | 40 | special |
| スパーク | fire | 40 | physical |
| アクアショット | water | 40 | special |
| アクアタックル | water | 40 | physical |
| リーフショット | grass | 40 | special |
| ツルアタック | grass | 40 | physical |
| ミニレイ | light | 35 | special |
| ライトタッチ | light | 35 | physical |
| シャドウタッチ | dark | 35 | physical |
| ダークパルス | dark | 35 | special |
| タックル | normal | 30 | physical |
| ウェーブ | normal | 30 | special |

---

## 3. バトルシステム仕様

### 3.1 ダメージ計算式

```javascript
function calculateDamage(actor, target, move, rng) {
  const isSpecial = move.category === "special";
  const atk = isSpecial 
    ? actor.spAtk * getStatMultiplier(actor.buffs.spAtk)
    : actor.atk * getStatMultiplier(actor.buffs.atk);
  const def = isSpecial
    ? target.spDef * getStatMultiplier(target.buffs.spDef)
    : target.def * getStatMultiplier(target.buffs.def);
  
  let damage = Math.floor((atk * move.power / def / 2));
  
  if (actor.level) {
    damage = Math.floor(damage * getLevelMultiplier(actor.level));
  }
  
  damage = Math.floor(damage * getTypeMultiplier(move.type, target.type));
  damage = Math.floor(damage * (0.9 + rng * 0.1));
  return Math.max(1, damage);
}
```

### 3.2 技演出仕様
- **実装**: CSS/SVGアニメーション
- **表示位置**: ターゲットのモンスター画像上
- **属性別**: 炎=赤炎、水=青波紋、草=緑葉、光=金閃光、闇=紫オーラ、無=灰衝撃波

---

## 4. アドベンチャーモード仕様

### 4.1 概要
- **舞台**: 地下研究施設「アーク」
- **目標**: 地下30階→地上（地下1階）
- **ラスボス**: ヴァーサス（地下1階）
- **初回リリース**: B30～B20

### 4.2 初期選択（6体から2体）
| 属性 | 選択肢1 | 選択肢2 |
|------|---------|---------|
| 炎 | フレイミー | エンガール |
| 水 | ウォータル | スイネーク |
| 草 | ハッパンク | リーファム |

### 4.3 レベルシステム

```javascript
const MAX_LEVEL = 100;

function getLevelMultiplier(level) {
  // Lv1=0.3, Lv100=1.0
  return 0.3 + (level - 1) * 0.007;
}

function getRequiredExp(level) {
  return Math.floor(10 * Math.pow(level, 1.8));
}
```

### 4.4 経験値システム

```javascript
function getBaseExp(enemyLevel) {
  return 10 + enemyLevel * 5;
}

function getExpMultiplier(myLevel, enemyLevel) {
  const diff = enemyLevel - myLevel;
  if (diff >= 10) return 3.0;
  if (diff >= 5) return 2.0;
  if (diff >= 1) return 1.5;
  if (diff === 0) return 1.0;
  if (diff >= -5) return 0.5;
  if (diff >= -10) return 0.2;
  return 0.05;
}
// 全所持モンスターが同量取得（レベル差補正は各自適用）
```

### 4.5 仲間加入

```javascript
const CAPTURE_RATES = {
  normal: 0.30,  // 通常: 30%
  boss: 0.10     // ボス: 10%
};

// アイテム補正
const CAPTURE_ITEMS = {
  "フレンドチャーム": 1.5,   // ×1.5
  "マスターチャーム": 3.0    // ×3.0
};
// 同一モンスターは1体のみ
```

### 4.6 ショップ

```javascript
// 通貨: 円（乱数幅あり）
function getDropMoney(enemyLevel) {
  const base = 50 + enemyLevel * 10;
  const variance = Math.floor(base * 0.2); // ±20%
  return base + Math.floor(Math.random() * variance * 2) - variance;
}

const SHOP_ITEMS = [
  { name: "回復薬", price: 100, effect: "HP50%回復" },
  { name: "万能薬", price: 200, effect: "HP100%回復" },
  { name: "フレンドチャーム", price: 500, effect: "捕獲率1.5倍" },
  { name: "マスターチャーム", price: 5000, effect: "捕獲率3倍" }
];
```

### 4.7 セーブシステム
- **方式**: Firebase Authentication（Googleログイン）
- **保存先**: Firestore
- **保存内容**: 所持モンスター、レベル、覚えた技、所持金、攻略進捗

### 4.8 ダンジョン進行

```
┌─────────────────────────────────────┐
│ ダンジョン進行画面                   │
├─────────────────────────────────────┤
│                                     │
│  現在地: B28 炎の実験エリア          │
│  残り休憩回数: 2/3                  │
│                                     │
│  ┌─────────┐  ┌─────────┐          │
│  │ 進む    │  │ 休憩    │          │
│  │ (戦闘)  │  │ (回復)  │          │
│  └─────────┘  └─────────┘          │
│                                     │
└─────────────────────────────────────┘
```

- **進む**: 戦闘発生（ランダム敵 or イベント）
- **休憩**: HP30%回復、技入れ替え可
- **休憩回数**: 階層ごとに決まった回数まで（例: B30=2回、B25=3回）
- **ボス**: 各階最後に固定ボス

### 4.9 敵編成

| パターン | 説明 | ボス補正 |
|----------|------|----------|
| 2対1 | 敵1体 | - |
| 2対2 | 敵2体 | - |
| ボス戦 | ボス1体 | HP/ステ×1.5倍 |

### 4.10 階層構成（B30-B20）

| 階層 | 名称 | 戦闘数 | 休憩 | ボス |
|------|------|--------|------|------|
| B30 | 炎の実験エリア | 3 | 2回 | フレイミー(強化) |
| B29 | 水辺エリア | 3 | 2回 | ウォータル(強化) |
| B28 | 草原エリア | 3 | 2回 | ハッパンク(強化) |
| B27 | 光の研究室 | 4 | 2回 | ライトラ(強化) |
| B26 | 闇の実験場 | 4 | 2回 | エルダーク(強化) |
| B25 | 混合エリア(炎+水) | 4 | 3回 | レイコーン(強化) |
| B24 | 混合エリア(草+光) | 5 | 3回 | アカリード(強化) |
| B23 | 廃棄エリア | 5 | 3回 | ザルディヴァ(強化) |
| B22 | 高速テストエリア | 5 | 3回 | フィンレーツ(強化) |
| B21 | 重装テストエリア | 5 | 3回 | マグマス(強化) |
| B20 | 中間管理エリア | 6 | 4回 | ミレメント(強化) |

---

## 5. UI仕様

### 5.1 技コマンド（4技縦並び、情報量維持）

```
┌────────────────────────────────────────┐
│ モンスター名                    [BACK] │
├────────────────────────────────────────┤
│ ┌──────────────────────────────┐ ┌──┐ │
│ │ 技1名        [炎] P:110      │ │⇄│ │
│ │ 説明文テキスト...            │ │交│ │
│ ├──────────────────────────────┤ │代│ │
│ │ 技2名        [水] P:110      │ │  │ │
│ │ 説明文テキスト...            │ │  │ │
│ ├──────────────────────────────┤ │  │ │
│ │ 技3名        [草] P:65       │ │  │ │
│ │ 説明文テキスト...            │ │  │ │
│ ├──────────────────────────────┤ │  │ │
│ │ 技4名        [無] P:90       │ │  │ │
│ │ 説明文テキスト...            │ └──┘ │
│ └──────────────────────────────┘      │
└────────────────────────────────────────┘
```
- 縦並び1列、現在と同じ表示形式
- 技名・属性バッジ・威力・説明文を常時表示
- コマンドエリア高さを必要に応じて調整（220px→240px程度）
- 技ボタンをコンパクト化しつつ情報量は維持

### 5.2 背景画像

| 画面 | 背景 |
|------|------|
| タイトル | menu_bg.png |
| 対戦バトル | **新規作成**（電子フィールド） |
| 拠点 | base_bg.webp |

### 5.3 メニュー構成
```
[ADVENTURE MODE] ← 最上部
[SINGLE BATTLE]
[ONLINE BATTLE]
[TEAM EDIT] [MONSTER DATA]
```

---

## 6. ファイル構成

### 新規作成
| ファイル | 内容 |
|----------|------|
| AdventureMode.js | 拠点+ダンジョン選択 |
| AdventureBattle.js | レベル補正バトル |
| AdventureData.js | 全データ |
| SkillEffects.js | 技演出 |
| img/battle_bg.webp | 対戦背景 |

### 変更ファイル
| ファイル | 変更 |
|----------|------|
| monsters.js | 6ステータス、type文字列化 |
| moves.js | 両版追加、type文字列化 |
| BattleEngine.js | 計算分岐、4技UI、背景 |
| Shared.js | バッジ対応 |
| app.js | メニュー変更、Firebase Auth統合 |

---

## 7. 実装順序

1. Phase 0: 属性文字列ID化
2. Phase 1: 技4つ対応+UI改修
3. Phase 2: 6ステータス+ダメージ計算
4. Phase 3: 対戦背景追加
5. Phase 4: アドベンチャー基盤+Firebase Auth
6. Phase 5: ダンジョンB30-B20
7. Phase 6: 技演出
