# GKD 快照处理工作流与实战案例

本文件是 `SKILL.md` 工作流的展开版，含真实 App 案例。所有选择器**均已在官方 `@gkd-kit/selector` 引擎上实跑验证命中**——这是本 skill 的硬性要求，不要凭截图拍脑袋写。

---

## 一、完整工作流（逐步）

### Step 1 接收快照

- **最可靠**：用户发 `.zip`（GKD 长按悬浮窗 → 快照审查 → 导出）。zip 内含一份 `*.json`（节点树）+ 可选 `*.png`（截图）。
- **i.gkd.li 链接**：`WebFetch` 该 URL 通常只能拿到前端页面，取不到节点 JSON。别假装能解析，**直接请用户改发 zip**。
- **只有截图**：用文字锚点（`[text="广告"]`）给保守版规则，并明确标注"未验证，建议补快照"。

### Step 2 解压并分析节点树

```bash
python3 scripts/analyze_snapshot.py /path/to/App_Activity-时间戳.zip
# 关键词找广告/关闭/取消：
python3 scripts/analyze_snapshot.py /path/to/snap.zip --grep "广告|关闭|取消|跳过|不感兴趣"
# 展开某节点上下文，确认关闭按钮的父子关系：
python3 scripts/analyze_snapshot.py /path/to/snap.json --ctx 92 5
```

从输出确认：目标节点的 `text/vid/id/desc`、它的父容器是否 `clickable`、是否存在"无障碍盲区"（按钮被画在父容器内无独立节点）。

### Step 3 构造候选选择器
见 `gkd-cheatsheet.md` 第 3 节语法。

### Step 4 用官方引擎验证（关键）

```bash
node scripts/verify_selector.mjs /path/to/snap.json '候选选择器'
FASTQUERY=1 node scripts/verify_selector.mjs /path/to/snap.json '[vid="xxx"]'   # 查 fastQuery 是否生效
```

确认：① 精确命中目标且本屏唯一；② 多步流程每步各自验证；③ 用弹窗根 id 做"区分度交叉验证"——在广告页无匹配、在弹窗页命中。

### Step 5 配防误触字段
`activityIds` / `actionMaximum`+`resetMatch` / `excludeMatches` / `actionDelay` / `preKeys` / `forcedTime`。

### Step 6 输出
完整 JSON5 + 粘贴位置 + 字段说明 + 失效排查 + key 冲突提醒。

---

## 二、实战案例

### 案例 1：知乎短视频广告（两点流程 + 防循环）

**两份快照**：`snap1` 广告卡片页、`snap2` 点叉号后弹出的反馈面板。

**第①步 广告卡片点叉号**（`text="广告"` 标签定位，叉号在广告头部右上角，是 clickable 的祖先）：

```json5
{
  key: 1,
  name: '① 广告卡片-点右上角叉号',
  actionMaximum: 1,
  resetMatch: 'match',
  actionCd: 3000,
  actionDelay: 300,
  excludeMatches: ['[id="Unknown:Popup:ngative_feedback_panel"]'],
  matches: '@[clickable=true] <n ViewGroup +n FrameLayout >n TextView[text="广告"]',
}
```

- 验证：`@[clickable=true] <n ViewGroup +n FrameLayout >n TextView[text="广告"]` 精确命中叉号节点，本屏唯一。
- `<n` = 任意层祖先；`+n` = 任意个前置兄弟。从右往左：先找"广告"文字 → 往上找 FrameLayout → 再找它的前置兄弟 ViewGroup → 命中其可点击祖先（叉号容器）。
- `excludeMatches` 用反馈面板的根节点 id 做开关：面板已弹出时本规则中止，避免重复点叉号。

**第②步 反馈面板点选项**（只有第①步刚执行才触发）：

```json5
{
  key: 2,
  name: '② 反馈面板-点内容不相关',
  preKeys: [1],
  actionDelay: 500,
  anyMatches: [
    '[desc="内容不相关"][clickable=true]',
    '[desc="不喜欢该内容"][clickable=true]',
  ],
}
```

- 验证：`[desc="内容不相关"][clickable=true]` 命中面板选项，本屏唯一。
- `anyMatches` 任一命中即触发；想改默认选项，调整数组顺序或文字。

**为什么这样防循环**：点完叉号广告卡片还在（弹窗只是盖上面）。不加 `actionMaximum:1`+`resetMatch:'match'` 会陷入"点叉号→弹窗→关→又点叉号"死循环。一张广告只处理一次，滑走再回来才重置。

---

### 案例 2：菜鸟物流详情 VIP 横幅（送分题：vid 自带语义）

**现象**：物流详情页底部 VIP 横幅右上角关闭按钮。

**分析**：该按钮 `vid` 直接叫 `vip_banner_fl_button_close_view`——菜鸟自己把 close 写进资源名。

```json5
{
  id: 'com.cainiao.wireless',
  name: '菜鸟',
  groups: [
    {
      key: 1,
      name: '物流详情-VIP横幅广告关闭',
      activityIds: ['com.taobao.cainiao.logistic.ui.view.LogisticDetailActivity'],
      actionMaximum: 1,
      resetMatch: 'activity',
      actionDelay: 500,
      rules: [
        { key: 0, fastQuery: true, matches: '[vid="vip_banner_fl_button_close_view"]' },
      ],
    },
  ],
}
```

- 验证：命中 `ImageView`，全屏唯一，`clickable=true`，快照标记 `idQf=true` → 开 `fastQuery`。
- `resetMatch:'activity'`：每次打开详情页只点一次，换包裹重进自动重置。
- 关掉的是 VIP 横幅（含进度条/领签到入口），不影响看物流。

---

### 案例 3：微信朋友圈广告（无障碍盲区，必须用 position 偏移）

**难点**：朋友圈广告卡片右上角"广告 v"按钮是微信**自定义 View 直接绘制**在广告头部 `LinearLayout`（混淆 `vid="kbe"`）的右端空白，**没有独立可点击节点**。`clickable` 本身在父 LinearLayout 上为 false。

**分析**：
- 普通朋友圈条目头部 `LinearLayout` 混淆名是 `vid="n95"`，广告条目头部是 `vid="kbe"`——靠混淆名区分。
- "广告 v"实际像素约 `(1095~1325, 865~1010)`，在节点 `kbe`（`rect=(251,888,1397,974)`）内，相对右距 `187px`、相对上距 `49px`。

```json5
{
  id: 'com.tencent.mm',
  name: '微信',
  groups: [
    {
      key: 10,
      name: '朋友圈-广告一键关闭',
      activityIds: ['com.tencent.mm.plugin.sns.ui.improve.ImproveSnsTimelineUI'],
      rules: [
        {
          key: 1,
          name: '① 广告卡片-点右上角"广告"按钮',
          actionMaximum: 1,
          resetMatch: 'match',
          actionDelay: 500,
          action: 'clickCenter',
          position: { right: 'width*0.163', top: 'height*0.57' },
          matches: '[vid="kbe"]',
          excludeMatches: ['[text="关闭该广告"]'],
        },
        {
          key: 2,
          name: '② 反馈面板-点关闭该广告',
          preKeys: [1],
          actionDelay: 500,
          action: 'click',
          matches: '[text="关闭该广告"][clickable=true]',
        },
      ],
    },
  ],
}
```

- `action:'clickCenter'`：节点不 clickable 时改算坐标点屏幕。
- `position`：自定义点击位置，**相对匹配到的目标节点**（不是全屏坐标）。`right:'width*0.163'` 表示"目标节点右边界往左 width×0.163"；`top:'height*0.57'` 同理。算出坐标落在"广告 v"中心。用百分比表达式适配不同分辨率。
- 有 `position` 时 `action` 默认就是 `clickCenter`，显式写出便于阅读。
- 第②步 `[text="关闭该广告"]` 是**文字锚点，不会随混淆名失效**，微信文案基本不改。

**硬伤（务必告诉用户）**：第①步依赖 `kbe` 这类**资源混淆短名**，微信每次更新会重新混淆，大概率失效。失效后请用户重截广告卡片快照重写。每 1~2 个月检查一次。

---

### 案例 4：喜马拉雅"不喜欢"面板（并列 vid，用文字锚定父容器）

**难点**：面板里 6 个选项（重复出现/不喜欢此内容/虚假广告/内容不适/侵权违规/其他问题）**共用同一个 `vid=host_item_pager_index_bg`**。直接写 vid 会匹配 6 个取第一个，纯靠运气，布局一变就点错。

**分析**：每个选项是 `FrameLayout(host_item_pager_index_bg)` 内一个 `TextView`，FrameLayout `clickable=true`、TextView `clickable=false`。

```json5
{
  id: 'com.ximalaya.ting.android',
  name: '喜马拉雅',
  groups: [
    {
      key: 1,
      name: '不喜欢反馈弹窗-点重复出现',
      rules: [
        {
          key: 0,
          fastQuery: true,
          actionDelay: 300,
          action: 'click',
          matches: '@[clickable=true] > TextView[text="重复出现"]',
        },
      ],
    },
  ],
}
```

- 验证：`@[clickable=true] > TextView[text="重复出现"]` 精确命中 FrameLayout，本屏唯一。
- **`@` 关键**：不带 `@` 会去点 TextView，而它 `clickable=false`，点了没反应。`@` 把点击目标挪到可点击父容器。
- 换选项只改文字，结构通用：`@[clickable=true] > TextView[text="虚假广告"]`。
- 该弹窗 `activityId` 为 `None`（Dialog 浮层），故不写 `activityIds`，任何页面触发都能关。

---

### 案例 5：B站视频反馈面板（无快照保守版）

用户只给截图、未给快照时，用文字锚点给保守版，**明确标注未验证**：

```json5
{
  id: 'tv.danmaku.bili',
  name: '哔哩哔哩',
  groups: [
    {
      key: 1,
      name: '视频反馈-点击「和当前视频无关」',
      fastQuery: true,
      actionDelay: 500,
      rules: [
        { key: 0, action: 'click', matches: '[text="和当前视频无关"][visibleToUser=true]' },
      ],
    },
  ],
}
```

- 风险：B站可能写成"与当前视频无关"（"与"非"和"）。未验证时请用户用快照审查确认真实 text 文案。
- `visibleToUser=true` 防点到隐藏/遮挡节点。

---

## 三、通用经验与维护

1. **先验证再交付**：所有选择器经 `verify_selector.mjs` 实跑命中，再交给用户。这是本 skill 不可省略的一步。
2. **key 冲突**：用户本地已有同 App 同 `key` 规则组时，新规则会覆盖旧的。提醒改 `key`（规则组 key 与规则 key 都改）。`key` 一旦设置不可改。
3. **混淆 vid 随版本失效**：微信/抖音等大型 App 的 `vid` 是混淆短名，发版即变。失效后请用户重截快照重写。文字锚点（`text`/`desc`）通常稳定。
4. **Dialog 浮层无 activityId**：反馈类底部弹层有时 `activityId=None`，不写 `activityIds` 反而更稳。
5. **链接不解析就引导发 zip**：`i.gkd.li` 链接直接 WebFetch 取不到节点数据，别硬编，让用户发导出的 zip。
6. **React Native / Flutter / WebView**：不触发无障碍事件，`querySelector` 可能永远匹配不上，加 `forcedTime` 主动轮询。
7. **区分度交叉验证**：多步流程里用弹窗根节点 id（如 `Unknown:Popup:...`）做 `excludeMatches` 开关时，务必在"广告页"和"弹窗页"两份快照上分别验证存在性差异，确认开关有效。
