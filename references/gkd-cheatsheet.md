# GKD 规则编写速查手册

> 基于官方文档 https://gkd.li/ 整理。用途：照着这份手册能直接写出可用的本地订阅规则，也能看懂别人写的远程订阅。
> **判断标准**：字段只在 https://gkd.li/api/ 出现过的才算数。

---

## 0. 先说一件事：网上那些教程有一半是编的

搜 "GKD 规则编写" 出来的 CSDN / GitCode 博客，大量字段是 **AI 幻觉**，照抄会直接报错或规则失效。官方字段里 **不存在** 下面这些：

| 网传字段 | 真相 |
| --- | --- |
| `delay: 1000` | 不存在。延迟执行叫 `actionDelay` |
| `maxMatch` / `repeat` / `interval` | 不存在。限次用 `actionMaximum`，节流用 `actionCd` |
| `priority: 10` | 不存在。顺序用 `order`（数字越小越先），插队用 `priorityTime` |
| `exclude: '...'` | 不存在。排除用 `excludeMatches` / `excludeAllMatches` |
| `direction: 'left'` / `distance: 300` | 不存在。滑动参数统一写在 `swipeArg` 里 |
| `matches: '[text="广告"] + [text="跳过"]'` 表示"和" | 误解。`matches` 数组内是"全都匹配上"，点击**最后一个**选择器 |
| `activityIds` 与 `versionNames` 平级混用 | 可以平级，但要注意它是**组级和规则级都能写**，组级会下发给组内所有规则 |

---

## 1. 四层结构

```
订阅 Subscription (gkd.json5)
 └── 应用 App        ← 按包名隔离，如 com.ss.android.ugc.aweme
      └── 规则组 Group  ← 唯一 key，可单独开关
           └── 规则 Rule  ← 唯一 key，真正干活的
```

- **属性可以继承下发**：写在 Group 上的 `activityIds`、`actionCd`、`matchTime` 等，组内所有 Rule 自动继承。
- **本地订阅**和**远程订阅**格式完全一致，区别只是能不能自动更新。
- 订阅文件用 **JSON5**：键不用加引号、支持注释、数组末尾可留逗号。

---

## 2. 最小可用模板

### 2.1 本地订阅粘贴用（首页 → 订阅 → 本地订阅 → 应用规则）

```json5
{
  id: 'com.zhihu.android',
  name: '知乎',
  groups: [
    {
      key: 0,
      name: '开屏广告',
      rules: {
        matches: 'TextView[id="com.zhihu.android:id/btn_skip"]',
      },
      snapshotUrls: ['https://i.gkd.li/i/13070251'],
    },
  ],
}
```

### 2.2 只加一个规则组（应用 → 右上角添加）

```json5
{
  key: 1,
  name: '全屏广告-会员活动弹窗',
  rules: [
    {
      key: 0,
      fastQuery: true,
      activityIds: 'com.blued.android.core.ui.TransparentActivity',
      matches: '[vid="img_close"]',
      snapshotUrls: 'https://i.gkd.li/i/14310618',
    },
  ],
}
```

### 2.3 全局规则（跨 App 生效，慎用）

```json5
{
  key: 0,
  name: '开屏广告',
  fastQuery: true,
  matchTime: 10000,
  actionMaximum: 1,
  resetMatch: 'app',
  rules: [
    {
      key: 0,
      matches: '[text*="跳过"][text.length<10][visibleToUser=true]',
    },
  ],
}
```

> 全局规则是"广撒网"，**强烈建议**配 `matchTime` + `actionMaximum: 1` + `resetMatch: 'app'` 三件套，否则极易误触。

---

## 3. 选择器语法（核心）

选择器 = **属性选择器** 和 **关系选择器** 交叉组成，**开头末尾必须是属性选择器**，两者之间**必须用空格隔开**。

```
A > B + C
属性  关系 属性 关系 属性
```

> `A>B` 非法，必须写 `A > B`。

### 3.1 属性选择器

结构：`节点名[表达式][表达式]`

| 部分 | 说明 |
| --- | --- |
| `TextView` | 节点的 name，等价 `[name='TextView'\|\|name$='.TextView']` |
| `*` | 匹配任意节点 |
| `[a=1][b=2]` | 并列的 `[]` 等价于 `&&` |
| `[a=1 \|\| b=2]` | 逻辑或，`&&` 优先级更高 |
| `!(...)` | 取反，`!` 后面**必须**跟括号，`!!(...)` 非法 |
| `@` | 标记**目标节点**（实际被点击的那个）。不写则取最后一个属性选择器 |

```txt
@LinearLayout > TextView[text="不感兴趣"]
```
含义：找到 text 是"不感兴趣"的 TextView，它父节点是 LinearLayout，**点击的是 LinearLayout**。

### 3.2 操作符

| 操作符 | 含义 | 适用类型 |
| --- | --- | --- |
| `=` `!=` | 等于 / 不等于 | 全部 |
| `>` `>=` `<` `<=` | 数值比较 | 仅 int |
| `^=` `!^=` | 以…开头 / 不以…开头 | 仅 string |
| `*=` `!*=` | 包含 / 不包含 | 仅 string |
| `$=` `!$=` | 以…结尾 / 不以…结尾 | 仅 string |
| `~=` `!~=` | 正则匹配 / 不匹配 | 仅 string（右侧**只能是字面量**） |

**重要坑**：除 `=`/`!=` 外，当属性是 `null` 时表达式一律为 `false`。
所以 `[text!$="广告"]` 在 text 为 null 时是 false。想要"text 不是以广告结尾或为空"，写 `text=null || text!=$'广告'` 或 `!(text$='广告')`。

### 3.3 关系操作符（6 种）

| 操作符 | 含义 | 示例 |
| --- | --- | --- |
| `+` | 前置兄弟节点 | `[vid="a"] + [vid="b"]` |
| `-` | 后置兄弟节点 | `@[vid="b"] - [vid="a"]` |
| `>` | 祖先节点 | `LinearLayout > ImageView` |
| `<` | 直接子节点 | `ImageView < ViewGroup` |
| `<<` | 子孙节点（深度先序） | `@[text="直播"] <<n [vid="container"]` |
| `->` | 查询过程中回到之前的节点 | `C ->1 B > A` |

**关系表达式**（跟在操作符后面，定义范围）：

| 写法 | 含义 |
| --- | --- |
| 省略 | 等价于 `(0n+1)`，即相邻 1 个 |
| `+3` | 相邻的 3 个之内 |
| `+3n` | 3 的倍数位 |
| `>2` | 往上数第 2 层 |
| `>n` | 任意祖先层（无限） |
| `<<n` | 任意深度子孙 |
| `>(1,2,5)` | 第 1、2、5 层中的任意一层 |

**匹配顺序是从右往左**：`FrameLayout > TextView` 是先找 TextView，再验证它的 parent 是不是 FrameLayout。

### 3.4 逻辑组合

单个选择器参与逻辑运算时**必须加括号**：

```txt
(A + B) || (M > N)     // 或，短路，优先左
(A + B) && (M > N)     // 且，结果取右侧
!(A + B)               // 非；注意 !(@A + B) 里的 @ 无效，结果只能是 B
```

---

## 4. 节点可用属性

### node 类型

| 属性 | 类型 | 属性 | 类型 |
| --- | --- | --- | --- |
| `id` | string（完整资源 id） | `text` | string |
| `vid` | string（id 的 `/` 后部分） | `desc` | string（contentDescription） |
| `name` | string（类名） | `clickable` | boolean |
| `left` `top` `right` `bottom` | int | `longClickable` | boolean |
| `width` `height` | int | `visibleToUser` | boolean |
| `index` `depth` `childCount` | int | `focusable` `checkable` `checked` `editable` | boolean |
| `parent` | node | `getChild(i)` | 方法，取第 i 个子节点 |

> `_id` / `_pid` 只能在网页快照工具里用，**真机不可用**，写进规则会失效。

### int 方法
`plus` `minus` `times` `div` `rem` `more` `moreEqual` `less` `lessEqual` `toString`

### string 方法
`length`（属性）`get` `at` `substring` `toInt` `indexOf`

### context 类型（跨节点取值）
`prev` — 右侧属性选择器的节点；`getPrev(n)` — 深层 prev；`current` — 当前节点

**经典用法：按屏幕位置限制**（比如只点左半屏的按钮）

```txt
@[clickable=true][right<getPrev(1).width.div(2)] >(1,2) [vid="cover"] <<n [parent=null]
```

---

## 5. 规则字段速查

### 5.1 动作 action

| 值 | 说明 |
| --- | --- |
| `click`（默认） | 节点 clickable 就用 clickNode，否则 clickCenter；clickNode 没被接收也会回落 clickCenter |
| `clickNode` | 无障碍节点点击。节点在屏幕外或被遮挡也能触发，但**非 clickable 的节点通常没反应** |
| `clickCenter` | 算中心坐标点屏幕。坐标出屏 = 未匹配；被遮挡会点到上层节点 |
| `longClick` / `longClickNode` / `longClickCenter` | 长按，长按时长 400ms |
| `back` | 模拟返回键 |
| `swipe` | 滑动，参数见 `swipeArg` |
| `none` | 只做匹配标记，不动作（配合 `preKeys` 做流程控制） |

> 有 `position` 时 action 默认为 `clickCenter`；有 `swipeArg` 时默认为 `swipe`。

### 5.2 匹配控制

| 字段 | 说明 |
| --- | --- |
| `matches` | 数组，**全部**匹配上才触发，点击最后一项的目标节点 |
| `anyMatches` | 数组，**任意一个**匹配上就触发；与 matches 同用时仍点击 matches 最后一项 |
| `excludeMatches` | 有一个匹配上就**中止**本规则 |
| `excludeAllMatches` | 全部匹配上才中止本规则 |

### 5.3 时间与次数（防误触的核心）

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `actionCd` | 1000ms | 两次执行的最小间隔（冷却） |
| `actionDelay` | — | 查到节点 → 等一会 → **再查一次还在**才执行。专治"闪现弹窗" |
| `matchDelay` | — | 规则被唤醒后，等多久才开始参与匹配 |
| `matchTime` | — | 规则参与匹配的总时长，超时休眠。开屏广告必配 |
| `actionMaximum` | — | 最大执行次数，用完休眠。开屏/更新弹窗配 `1` |
| `resetMatch` | `'activity'` | 重置条件：`activity` / `match` / `app`。开屏广告配 `'app'` |
| `actionCdKey` | — | 与指定 key 的规则**共享冷却**，一条触发另一条一起进 CD |
| `actionMaximumKey` | — | 与指定 key 的规则**共享次数** |

### 5.4 匹配范围

| 字段 | 说明 |
| --- | --- |
| `activityIds` / `excludeActivityIds` | 限制（或排除）生效的 Activity。**限定越死越安全** |
| `versionNames` / `versionCodes` | 限制 App 版本。App 改版导致规则失效时的隔离带 |
| `matchRoot` | 默认 false。事件节点只有一个小节点在变化时（如倒计时文本），选择器可能永远匹配不上，此时设 `true` 强制从根节点匹配 |
| `forcedTime` | Flutter / WebView 页面不触发无障碍事件时，在一段时间内主动轮询屏幕 |
| `order` | 参与匹配顺序，数字越小越先。同值按数组顺序，**app 规则优先于 global 规则** |
| `priorityTime` | 优先级时间，这段时间内本规则插队到所有普通规则前面。开屏规则被其它规则堵住时用 |
| `priorityActionMaximum` | 默认 1。触发几次后变回普通规则 |

### 5.5 流程控制

`preKeys`：要求某个 key 的规则**刚刚执行过**，本规则才生效。用于"点关闭 → 选原因 → 确认"这类多步流程，防止中间步骤被误触发。

```json5
rules: [
  { key: 1, name: '点关闭',   matches: '[vid="close"]' },
  { key: 2, name: '选原因',   preKeys: [1], matches: '[text="不感兴趣"]' },
  { key: 3, name: '确认关闭', preKeys: [2], matches: '[text="确定"]' },
]
```

> `key` 设置后**不能改**，改了点击记录会错乱。

---

## 6. 性能：fastQuery

开启 `fastQuery: true` 后，符合特定格式的选择器会走 Android 原生 `findAccessibilityNodeInfosByViewId/ByText`，跳过全树遍历。

**末尾属性选择器的第一个表达式**必须是以下之一（或用 `||` 连接）：

```
[id='x']  [vid='x']  [text='x']  [text^='x']  [text*='x']  [text$='x']
```

| 选择器 | 能否快速查询 |
| --- | --- |
| `A > B + C[id='x'][childCount=2]` | 能 |
| `A > B + C[childCount=2][id='x']` | 不能（顺序错了） |
| `A > C[id='x'] <<n D[id='y'] <<n E` | 能，且两处都走快速查询 |
| `!(C + D[id='d'])` | 不能，`!` 会取消内部所有快速查询 |

**写法建议**：把 `[vid=...]` 或 `[text=...]` 放在每个 `[]` 组的**第一位**，从右往左串 `<<n`，性能最好。

```txt
[vid="image"] <<n [vid="recyclerView"] <<n [vid="content_layout"]
```
原本要遍历 7+48+44 次，优化后只需调用 3 次系统 API。

---

## 7. 转义：最容易踩的坑

选择器本身有自己的转义，放进 JSON5 字符串又要转义一次，用正则 `~=` 还要**再多一次**。

| 你想匹配 | 选择器里写 | 写进 JSON5 规则里 |
| --- | --- | --- |
| 一个反斜杠 `\` | `[text="\\"]` | `[text="\\\\"]` |
| 换行符 | `[text="\n"]` | `[text="\\n"]` |
| 正则匹配一个数字 | `[text~="\\d"]` | `[text~="\\\\d"]` |
| 正则匹配一个反斜杠 | `[text~="\\\\"]` | `[text~="\\\\\\\\"]` |

**记忆口诀**：从"审查工具里能跑通的选择器"到"规则文件里的字符串"，`\` 全部翻倍。

另外正则有优化捷径：想忽略大小写做开头/包含/结尾匹配，用 `(?is)` 前缀会自动降级成快速字符串比较，比真跑正则快得多：

```txt
[text~="(?is)abc.*"]     → 忽略大小写 startsWith('abc')
[text~="(?is).*abc.*"]   → 忽略大小写 contains('abc')
```

---

## 8. 写规则的实战套路

### 套路 A：开屏广告（最常见）

```json5
{
  key: 1,
  name: '开屏广告',
  fastQuery: true,
  matchTime: 10000,        // 只在切出 App 的头 10 秒找
  actionMaximum: 1,        // 只点一次
  resetMatch: 'app',       // 重新进 App 才重置
  priorityTime: 10000,     // 插队，别被别的规则堵住
  rules: [
    { key: 0, matches: '[text*="跳过"][text.length<10][visibleToUser=true]' },
  ],
}
```

### 套路 B：限定 Activity 的精准弹窗

```json5
{
  key: 2,
  name: '青少年模式弹窗',
  activityIds: ['com.xxx.MainActivity'],
  actionMaximum: 1,
  rules: [
    { key: 0, matches: '@[text="我知道了"] - [text="青少年模式"]' },
  ],
}
```

### 套路 C：多步流程

见 5.5 的 `preKeys` 示例。

### 套路 D：节点没有 id/text，靠邻居定位

```txt
@ImageView[index=parent.childCount.minus(1)] < ViewGroup[desc^="直播"]
```
父节点 desc 以"直播"开头，点击它最后一个子 ImageView。

```txt
ViewGroup[desc^="直播"][getChild(0).vid="cover_layout"]
```
第一个子节点的 vid 是 cover_layout。

### 套路 E：防误触三板斧

1. **限定 Activity**：`activityIds` 能写就写
2. **限定次数**：`actionMaximum: 1`
3. **限定时长**：`matchTime` + `resetMatch`
4. 加排除项：`excludeMatches: ['[text*="升级"]']`
5. 加可见性：`[visibleToUser=true][text.length<10]`

---

## 9. 代理接任务时该向用户索取什么

**最省事的索取方式（二选一）**：

| 方式 | 操作 |
| --- | --- |
| 快照 zip（推荐） | 让用户在 GKD 里长按悬浮窗 → 快照审查 → 导出/上传 → 把文件传过来 |
| 截图 + 说明 | 截屏广告/弹窗界面 + 问清 App 名 + 想点哪个按钮（此法无法验证，只能给保守版） |

**交付给用户时应当包含**：

- 一段可直接粘进本地订阅的 JSON5 代码
- 选择器已用官方引擎验证命中（见 SKILL.md 工作流 Step 4），若未验证须明确标注
- 该配的防误触字段（`activityIds` / `actionMaximum` / `matchTime` / `excludeMatches` / `preKeys`）一并写好
- 粘贴位置说明 + 失效排查顺序
- key 冲突提醒（用户本地已有同 App 同 key 规则组时需改 key）

---

## 10. 官方链接

- 文档首页：https://gkd.li/guide/
- 选择器语法：https://gkd.li/guide/selector
- 选择器示例：https://gkd.li/guide/example
- 属性方法表：https://gkd.li/guide/node
- 查询优化：https://gkd.li/guide/optimize
- 字段 API：https://gkd.li/api/interfaces/RawSubscription
- 快照审查工具：https://i.gkd.li/
