# GKD 规则编写 Skill（gkd-rule-writer）

一个给 AI Agent（CodeBuddy / 支持 skill 的客户端）用的 skill：**把"写 GKD 广告/弹窗关闭规则"这件事标准化、可复现**。

GKD 是开源 Android 无障碍自动化工具（[gkd-kit/gkd](https://github.com/gkd-kit/gkd)）。它用类 CSS 选择器定位界面节点、自动点击。但写一条"真的能命中、不误触、不循环"的规则，需要读懂无障碍节点树、避开一堆坑。这个 skill 把作者给十几个 App 写规则踩过的坑，全部固化成了 agent 的工作流。

## 它解决什么痛点

- **照抄博客必错**：网上大量 GKD 字段是 AI 幻觉（`delay`/`maxMatch`/`priority` 等根本不存在），只有 `gkd.li/api` 里的字段才算数。
- **选择器拍脑袋必翻车**：`[text="广告"]` 看起来对，实际可能匹配到 6 个节点、点了没反应、或点完循环弹。
- **无障碍盲区**：有些按钮（如微信朋友圈"广告"按钮）被自定义 View 画在父容器里，没有独立可点击节点，必须靠 `position` 坐标偏移才能点。

本 skill 的核心是：**用 GKD 官方 `@gkd-kit/selector` 引擎，在用户给的快照节点树上实跑验证选择器命中**，确认"精确命中、本屏唯一"才出规则。不靠猜。

## 核心能力

| 能力 | 说明 |
|---|---|
| 官方引擎验证 | `verify_selector.mjs` 把你写的候选选择器在真实快照上跑一遍，输出命中节点、本屏匹配数、`fastQuery` 是否生效 |
| 快照节点树分析 | `analyze_snapshot.py` 解压 zip、列出所有带 `text/desc/vid/id` 的节点及坐标/可点击状态，定位广告与关闭按钮 |
| 防误触三板斧 | `actionMaximum`+`resetMatch` 防循环、`excludeMatches` 用弹窗根 id 做开关、`preKeys` 串多步流程 |
| 实战案例库 | 知乎（结构关系 + preKeys 串两步）、菜鸟（vid 自带 close 语义）、微信朋友圈（`@`+`position` 点无障碍盲区）、喜马拉雅（并列 vid 用文字锚定父容器） |

## 目录结构

```
gkd-rule-writer/
├── SKILL.md                      # Skill 本体：触发条件 + 心智模型 + 6 步工作流
├── README.md                     # 本文件
├── LICENSE                       # MIT
├── scripts/
│   ├── verify_selector.mjs       # 用官方 @gkd-kit/selector 引擎验证选择器命中（首跑自动装依赖）
│   └── analyze_snapshot.py       # 解压快照 zip、列出节点树、按关键词/上下文分析
└── references/
    ├── gkd-cheatsheet.md         # 选择器语法 / 字段 API / 转义 / fastQuery 完整速查
    └── snapshot-workflow.md      # 详细工作流 + 真实 App 实战案例与经验
```

## 安装

### 方式 A：作为 CodeBuddy Skill 安装

把整个仓库内容放进你的 skill 目录即可（保持 `SKILL.md` 在目录顶层）：

```bash
git clone https://github.com/baigegege/gkd-rule-writer.git
cd gkd-rule-writer
cp -r . ~/.codebuddy/skills/gkd-rule-writer
```

之后让 agent「写个规则关掉这个广告」时，它会自动走这套工作流。

### 方式 B：当通用参考文档读

不需要装 skill，直接看 `SKILL.md` + `references/` 两份文档，按里面的步骤手动写规则也完全够用。`references/gkd-cheatsheet.md` 是口语化速查表，`references/snapshot-workflow.md` 是带真实截图的案例拆解。

## 典型使用流程（agent 视角）

1. 用户发 GKD 快照 `.zip`（长按悬浮窗 → 快照审查 → 导出）或 `i.gkd.li` 链接。
2. `python3 scripts/analyze_snapshot.py snap.zip --grep 广告|关闭|取消` 分析节点树。
3. 构造候选选择器（优先稳定 `vid`/`id`，并列 vid 用文字锚定父容器）。
4. `node scripts/verify_selector.mjs snap.json '候选选择器'` **实跑验证命中**。
5. 配防误触字段（`actionMaximum`/`excludeMatches`/`preKeys`/`actionDelay`）。
6. 输出可直接粘贴进 GKD → 订阅 → 本地订阅 → 应用规则 → `+` 的 JSON5。

## 依赖

- `analyze_snapshot.py`：Python 3（仅标准库，无需安装）。
- `verify_selector.mjs`：Node.js 22+。首次运行自动 `npm install @gkd-kit/selector@0.5.23`（官方选择器引擎，已锁版本——最新版 API 已改会报错）。

## 许可证

[MIT](./LICENSE) —— 自由使用、修改、分发。
