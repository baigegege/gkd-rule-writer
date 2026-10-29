#!/usr/bin/env node
// verify_selector.mjs
// 用 GKD 官方选择器引擎 (@gkd-kit/selector) 在快照 JSON 上实跑验证选择器能否命中。
//
// 用法:
//   node verify_selector.mjs <快照.json> '选择器1' '选择器2' ...
//   FASTQUERY=1 node verify_selector.mjs <快照.json> '[vid="xxx"]'   # 验证 fastQuery 是否生效
//
// 首次运行若缺少依赖，会自动 `npm install @gkd-kit/selector`（需联网）。
// 依赖会装到本 skill 目录下的 node_modules（scripts/.. = gkd-rule-writer/node_modules）。

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');

function fastQueryHint(src, fast) {
  // 启发式判断是否符合快速查询格式：末尾属性选择器组的第一个表达式须为 id/vid/text(可 ^*/$=/=)
  const groups = [...src.matchAll(/\[([^\]]*)\]/g)];
  if (!groups.length) return '格式不符合(无属性选择器)';
  const inner = groups[groups.length - 1][1].trim();
  const ok = /^(id=|vid=|text)/.test(inner);
  const fmt = ok ? '格式符合(末尾组首位为 id/vid/text)' : '格式不符合(需把 id/vid/text 放到末尾组首位)';
  return fast ? fmt + '，已开启 FASTQUERY' : fmt;
}

async function loadSelector() {
  // 先确认依赖已安装再 import，避免首次 import 失败的负缓存导致导出为 undefined
  const depDir = path.join(skillRoot, 'node_modules', '@gkd-kit', 'selector');
  if (!fs.existsSync(depDir)) {
    console.error('[依赖缺失] 正在安装 @gkd-kit/selector 到 ' + skillRoot + ' ...');
    execSync('npm install @gkd-kit/selector@0.5.23', { cwd: skillRoot, stdio: 'inherit' });
  }
  const mod = await import('@gkd-kit/selector');
  const { Selector, Transform, MatchOption } = mod;
  if (!Selector || !Transform || !MatchOption) {
    console.error('[错误] @gkd-kit/selector 导出缺失，实际导出: ' + Object.keys(mod).join(', '));
    process.exit(1);
  }
  return { Selector, Transform, MatchOption };
}

async function main() {
  const file = process.argv[2];
  const selectors = process.argv.slice(3);
  const fast = process.env.FASTQUERY === '1';

  if (!file || selectors.length === 0) {
    console.error('用法: node verify_selector.mjs <快照.json> \'选择器1\' \'选择器2\' ...');
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error('[错误] 找不到文件: ' + file);
    process.exit(1);
  }

  const { Selector, Transform, MatchOption } = await loadSelector();

  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  const raw = d.nodes;

  const nodes = new Map();
  for (const n of raw) nodes.set(n.id, { _id: n.id, attr: n.attr });
  for (const n of raw) nodes.get(n.id).parent = n.pid === -1 ? null : (nodes.get(n.pid) ?? null);

  const cm = new Map();
  for (const n of raw) {
    if (!cm.has(n.pid)) cm.set(n.pid, []);
    cm.get(n.pid).push(n.id);
  }
  for (const [p, ids] of cm) ids.sort((a, b) => nodes.get(a).attr.index - nodes.get(b).attr.index);
  for (const [id, o] of nodes) o.children = (cm.get(id) ?? []).map((i) => nodes.get(i));

  const root = [...nodes.values()].find((o) => o.parent === null);

  // GKD 的 getAttr / getInvoke 收到的是 QueryContext，真实节点在 .current 上
  const unwrap = (n) => (n && n.current != null ? n.current : n);

  const transform = Transform.Companion.multiplatformBuild(
    (ctx, name) => {
      const node = unwrap(ctx);
      if (node == null || node.attr == null) return null;
      const v = node.attr[name];
      return v === undefined ? null : v;
    },
    (ctx, name, args) => {
      const node = unwrap(ctx);
      if (node == null || node.attr == null) return null;
      if (name === 'getChild') {
        const i = args[0];
        return i == null ? null : (node.children[i] ?? null);
      }
      return null;
    },
    (n) => (n == null ? null : n.attr.name),
    (n) => (n == null ? [] : n.children),
    (n) => (n == null ? null : n.parent),
  );

  const opt = new MatchOption(fast);

  console.log('== 快照: ' + path.basename(file) + ' | 节点数: ' + raw.length + ' | fastQuery=' + fast + ' ==\n');

  for (const src of selectors) {
    let sel;
    try {
      sel = Selector.Companion.parse(src);
    } catch (e) {
      console.log('[语法错误] ' + src);
      console.log('   ' + ((e && e.message) ? e.message : String(e)));
      console.log('');
      continue;
    }

    let hit = null;
    let total = 0;
    try {
      hit = transform.querySelector(root, sel, opt);
      total = transform.querySelectorAllArray(root, sel, opt).length;
    } catch (e) {
      console.log('[运行错误] ' + src + '  ' + ((e && e.message) ? e.message : String(e)));
      console.log('');
      continue;
    }

    const fqDesc = fastQueryHint(src, fast);

    if (hit == null) {
      console.log('[无匹配] ' + src);
      console.log('    fastQuery: ' + fqDesc);
    } else {
      const a = hit.attr;
      console.log('[命中] id=' + hit._id + '  ' + String(a.name).split('.').pop() + '   (本屏共 ' + total + ' 个匹配，取第 1 个)');
      console.log('    text=' + JSON.stringify(a.text) + '  desc=' + JSON.stringify(a.desc) + '  vid=' + (a.vid ?? 'null') + '  id=' + (a.id ?? 'null'));
      console.log('    clickable=' + a.clickable + '  rect=(' + a.left + ',' + a.top + ',' + a.right + ',' + a.bottom + ')  index=' + a.index + '  depth=' + a.depth);
      console.log('    fastQuery: ' + fqDesc);
    }
    console.log('');
  }
}

main().catch((e) => {
  console.error('[致命错误] ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
