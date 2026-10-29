---
name: gkd-rule-writer
description: "当用户需要为 GKD（开源 Android 无障碍自动化工具）编写、修复或阅读本地订阅规则时使用本 skill。典型触发：用户发来 GKD 快照压缩包（zip）或 i.gkd.li 快照链接要求关掉广告、弹窗或开屏；用户抱怨规则点了关闭却不再处理后续弹窗或不生效；用户要求看懂或改写一份 GKD JSON5 订阅。本 skill 提供以官方 @gkd-kit/selector 引擎驱动的确定性工作流：解压快照、分析无障碍节点树、实跑验证选择器命中、产出可直接粘贴的防误触规则。"
agent_created: true
---

# GKD 规则编写 Skill

## 何时使用

- 用户发来 `.zip` 快照（GKD 长按悬浮窗 → 快照审查 → 导出/上传）或 `https://i.gkd.li/i/xxxxx` 链接，要求写规则。
- 用户描述"某 App 广告/弹窗/开屏想自动关闭"，即使没给快照，也应先引导用户发快照（见工作流 Step 1）。
- 用户说规则"点了 X 不点后续弹窗""点完循环弹""完全没反应"等失效问题。
- 用户贴一段 GKD JSON5，要求解释、纠错或加功能。

**唯一权威来源**：字段只在 https://gkd.li/api/ 出现才算数。网上（CSDN / GitCode / 博客）大量字段是 AI 幻觉，照抄必错，见 `references/gkd-cheatsheet.md` 第 0 节对照表。

## 核心心智模型（必记，否则必写错）

1. **四层嵌套**：订阅 → 应用(App, 按包名) → 规则组(Group, 唯一 key) → 规则(Rule, 唯一 key)。属性可向下继承（写在 Group 的 `activityIds`/`actionCd` 等组内规则自动继承）。固定格式 JSON5（键可无引号、可注释、末位可留逗号）。
2. **`@` 决定"被点的节点"**：不写 `@` 则点击最后一个属性选择器。想点父容器而非文字本身时，`@` 必须挂在父选择器上（经典反例：`@[clickable=true] > TextView[text="重复出现"]` 点的是父 FrameLayout，因为 TextView 本身 `clickable=false`）。
3. **从右往左匹配**：`FrameLayout > TextView` 先找 TextView，再验它爹是不是 FrameLayout。
4. **null 陷阱**：除 `=`/`!=` 外，属性为 `null` 时表达式一律 `false`。`[text!$="广告"]` 在 text 为空时是 false，并非"排除广告"。要表达"不是以广告结尾或为空"写 `!(text$='广告')`。
5. **转义翻倍**：从"审查工具能跑通的选择器"到"规则 JSON5 字符串"，`\` 全部翻倍；用正则 `~=` 再多翻一倍（匹配一个反斜杠最终写 8 个）。
6. **fastQuery 第一位**：开启 `fastQuery:true` 后，要命中快速查询，末尾选择器第一个表达式必须是 `[id=]`/`[vid=]`/`[text=]`/`[text^=]`/`[text*=]`/`[text$=]`（可 `||` 连接），且必须放在每个 `[]` 组的**最前面**。`[childCount=2][vid="x"]` 不生效，要写 `[vid="x"][childCount=2]`。

详细语法、字段、操作符见 `references/gkd-cheatsheet.md`。

## 标准工作流（处理用户快照）

**Step 1 — 接收快照**

- 优先要 `.zip` 快照（最可靠）。用户给的是 zip 路径就直接处理。
- 若用户给 `i.gkd.li/i/xxxxx` 链接：先 `WebFetch` 该 URL 尝试取节点 JSON；多数情况页面是前端应用，无法直接取数据，此时请用户改发"快照审查 → 导出"得到的 zip（GKD 里长按悬浮窗 → 快照审查 → 右上角导出/上传 → 把文件传过来）。不要假装能解析链接。
- 若用户只给截图无快照：根据截图用文字锚点（如 `[text="广告"]`）先给保守版规则，并明确标注"未验证，建议补快照确认"。

**Step 2 — 解压并分析节点树**

```bash
python3 scripts/analyze_snapshot.py /path/to/App_Activity-时间戳.zip
# 带关键词过滤（找广告/关闭/取消等）：
python3 scripts/analyze_snapshot.py /path/to/snap.zip --grep 广告|关闭|取消|跳过
# 展开某节点上下文（祖先链 + 子树），定位关闭按钮的父子关系：
python3 scripts/analyze_snapshot.py /path/to/snap.json --ctx 98 5
```

脚本会自动解压 zip、加载 `nodes`、列出所有带 `text/desc/vid/id` 的节点（含坐标、clickable、visibleToUser、depth、childCount）。从中确定：
- 广告/弹窗的标识节点（如 `text="广告"`、`vid="vip_banner_fl_button_close_view"`）；
- 目标关闭按钮的 `text/vid/id/desc` 及其父容器是否 `clickable`；
- 是否存在"无障碍盲区"——按钮被自定义 View 绘制在父容器内、无独立可点击节点（如微信朋友圈"广告"按钮，见 `references/snapshot-workflow.md`）。

**Step 3 — 构造候选选择器**

- 优先用稳定的 `vid`/`id`（如菜鸟 `vip_banner_fl_button_close_view` 直接就是 close）。
- 同 `vid` 被多个选项共用时（如喜马拉雅 6 个选项同 `vid=host_item_pager_index_bg`），改用文字锚定父容器：`@[clickable=true] > TextView[text="重复出现"]`。
- 需靠邻居定位时，用关系符 `+`/`-`/`>`/`<`/`<<n`。
- 无障碍盲区：用 `action:'clickCenter'` + `position` 把点击点偏移到父节点内的真实按钮位置（相对坐标，可用 `width*0.163` 等表达式）。

**Step 4 — 用官方引擎验证（关键，禁止拍脑袋）**

```bash
node scripts/verify_selector.mjs /path/to/snap.json '候选选择器1' '候选选择器2'
# 验证 fastQuery 是否生效：
FASTQUERY=1 node scripts/verify_selector.mjs /path/to/snap.json '[vid="xxx"]'
```

脚本首次运行会自动 `npm install @gkd-kit/selector`（需联网）。它会直接在快照节点树上跑 GKD 官方选择器引擎，输出：命中节点 id/类名/本屏匹配数、text/desc/vid/id、clickable、rect、fastQuery 是否生效。

**必须**确认：① 选择器精确命中目标按钮且本屏唯一；② 多步流程的每一步都各自验证；③ 用弹窗根节点 id 做"区分度交叉验证"（在广告页无匹配、在弹窗页命中）。

**Step 5 — 配防误触字段**

按场景套用 `references/gkd-cheatsheet.md` 第 5 节与"防误触三板斧"：
- `activityIds`：能写就写（限定 Activity 最安全）。
- `actionMaximum:1` + `resetMatch:'match'|'activity'|'app'`：一张广告/一次进入只处理一次，防循环。
- `excludeMatches`：弹窗已弹出时用弹窗根 id 做开关，避免重复点。
- `actionDelay`：等弹窗动画播完（通常 300–800ms）。
- `preKeys`：多步流程中，后续步骤要求前一步"刚执行过"才生效，防误触。
- 遇到 React Native / Flutter / WebView 页面不触发无障碍事件：加 `forcedTime`。

**Step 6 — 输出规则**

- 给出完整 JSON5（含 `id` 包名、`name`、`groups`、`rules`），可直接粘进 GKD → 订阅 → 本地订阅 → 应用规则 → `+`。
- 说明：粘贴位置、每个关键字段为什么这么设、失效排查顺序。
- **key 冲突提醒**：若用户本地已有同 App 同 `key` 规则组，提醒改成别的数字，否则覆盖。
- 验证过的内容明确标注"已用官方引擎验证命中"；未验证的（如仅截图）明确标注"未验证"。

## 多步流程与 preKeys

"点关闭 → 选原因 → 确认"类流程用 `preKeys` 串起来：

```json5
rules: [
  { key: 1, name: '点叉号', actionMaximum:1, resetMatch:'match',
    excludeMatches:['[id="弹窗根"]'], matches:'@[clickable=true] <n ViewGroup +n FrameLayout >n TextView[text="广告"]' },
  { key: 2, name: '选原因', preKeys:[1], matches:'[desc="内容不相关"][clickable=true]' },
]
```

`key` 一旦设置不可改（改了点击记录会错乱）。实战案例见 `references/snapshot-workflow.md`。

## 常见坑（速查）

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 照抄博客规则报错/失效 | 字段是幻觉（如 `delay`/`maxMatch`/`priority`） | 只用 gkd.li/api 存在的字段 |
| 点到文字无反应 | 文字 TextView `clickable=false` | `@` 挂到可点击父容器 |
| 点完 X 又弹 | 没限次 | `actionMaximum:1` + `resetMatch` |
| 只点叉号不点后续 | 步骤没串 / 没 `preKeys` | 加 `preKeys` 串行 |
| 匹配不到用了 `~=` 正则 | 转义少一层 | 规则字符串里 `\` 再翻倍 |
| 开了 fastQuery 仍慢 | 第一位表达式不是 id/vid/text | 调整顺序 |

完整字段 API、操作符、转义表、fastQuery 规则、各 App 实战套路见 `references/gkd-cheatsheet.md` 与 `references/snapshot-workflow.md`。

## 资源文件

- `scripts/verify_selector.mjs` — 用官方 `@gkd-kit/selector` 引擎在快照 JSON 上验证选择器命中（自动装依赖）。
- `scripts/analyze_snapshot.py` — 解压快照 zip、列出节点树、按关键词/节点上下文分析。
- `references/gkd-cheatsheet.md` — GKD 选择器语法、字段 API、转义、fastQuery、防误触完整速查（口语化，可直接读）。
- `references/snapshot-workflow.md` — 详细工作流 + 5 个真实 App 实战案例（知乎/菜鸟/微信朋友圈/喜马拉雅/通用原则），含"无障碍盲区""并列 vid""混淆 vid 随版本失效"等经验。
