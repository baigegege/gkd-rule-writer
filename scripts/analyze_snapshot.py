#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""analyze_snapshot.py - 解压并分析 GKD 快照，辅助定位广告/弹窗与关闭按钮。

用法:
  python3 analyze_snapshot.py <快照.zip 或 快照.json>
  python3 analyze_snapshot.py <快照.zip> --grep "广告|关闭|取消|跳过"
  python3 analyze_snapshot.py <快照.json> --ctx 98 5      # 展开节点98的祖先链+子树(向上5层)

说明:
  - 传 .zip 会自动解压到系统临时目录，并定位其中的 *.json 节点文件。
  - 传 .json 直接使用。
  - 不传 --grep 时，列出所有带 text/desc/vid/id 的节点。
  - --grep 用正则(支持 | 多选)，匹配 text/desc/vid/id 任一字段。
  - --ctx N UP 展开 N 号节点的祖先链(根->目标)与前 UP 层祖先的子树，用于确认关闭按钮的父子关系。
"""

import sys
import os
import re
import json
import glob
import tempfile
import shutil
import zipfile


def load_nodes(path):
    """返回 (nodes_by_id, children_map, d)，d 为整份快照。"""
    if path.lower().endswith('.zip'):
        tmp = tempfile.mkdtemp(prefix='gkd_snap_')
        with zipfile.ZipFile(path) as z:
            z.extractall(tmp)
        js = glob.glob(os.path.join(tmp, '**', '*.json'), recursive=True)
        if not js:
            raise SystemExit('[错误] zip 内未找到 .json 节点文件')
        jp = js[0]
        print('[解压] %s -> %s' % (os.path.basename(path), jp))
    else:
        jp = path
    with open(jp, 'r', encoding='utf-8') as f:
        d = json.load(f)
    nodes = {n['id']: n for n in d['nodes']}
    children = {}
    for n in d['nodes']:
        children.setdefault(n['pid'], []).append(n['id'])
    for k in children:
        children[k].sort(key=lambda i: nodes[i]['attr']['index'])
    return nodes, children, d


def short(name):
    return name.split('.')[-1]


def line(nid, ind, nodes):
    a = nodes[nid]['attr']
    bits = []
    if a.get('vid'):
        bits.append('vid=%s' % a['vid'])
    if a.get('id'):
        bits.append('id=%s' % a['id'])
    if a.get('text') is not None:
        bits.append('text=%r' % a['text'])
    if a.get('desc') is not None:
        bits.append('desc=%r' % a['desc'])
    if a.get('childCount'):
        bits.append('cc=%d' % a['childCount'])
    print('%s[%3d] idx=%-2s %-20s click=%-5s vis=%-5s rect=(%s,%s,%s,%s) | %s' % (
        '  ' * ind, nid, a['index'], short(a['name']), a['clickable'], a['visibleToUser'],
        a['left'], a['top'], a['right'], a['bottom'], ' | '.join(bits)[:200]))


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    path = sys.argv[1]

    grep_pat = None
    ctx = None
    for i, a in enumerate(sys.argv[2:]):
        if a == '--grep' and i + 3 <= len(sys.argv):
            grep_pat = sys.argv[i + 3]
        elif a == '--ctx' and i + 4 <= len(sys.argv):
            ctx = (int(sys.argv[i + 3]), int(sys.argv[i + 4]))

    nodes, children, d = load_nodes(path)

    print('=' * 78)
    print('appId: %s' % d.get('appId'))
    print('activityId: %s' % d.get('activityId'))
    print('screen: %sx%s | 节点数: %d' % (d.get('screenWidth'), d.get('screenHeight'), len(nodes)))
    print('=' * 78)

    # ---- 展开上下文模式 ----
    if ctx:
        nid, up = ctx
        if nid not in nodes:
            print('[错误] 节点 %d 不存在' % nid)
            sys.exit(1)
        chain = []
        cur = nid
        while cur != -1 and cur in nodes:
            chain.append(cur)
            cur = nodes[cur]['pid']
        chain.reverse()
        print('--- 祖先链 (根 -> 目标) ---')
        for c in chain[-up:]:
            line(c, 0, nodes)
        print('\n--- 从目标第 %d 层祖先展开子树 ---' % up)
        anc = chain[-up]

        def tree(nid, ind):
            line(nid, ind, nodes)
            for c in children.get(nid, []):
                tree(c, ind + 1)
        tree(anc, 0)
        return

    # ---- 关键词过滤模式 ----
    if grep_pat:
        rx = re.compile(grep_pat)
        hits = []
        for nid in sorted(nodes):
            a = nodes[nid]['attr']
            blob = ' '.join(str(x) for x in [a.get('text'), a.get('desc'), a.get('vid'), a.get('id')] if x)
            if rx.search(blob):
                hits.append(nid)
        print('命中关键词节点数: %d\n' % len(hits))
        for nid in hits:
            a = nodes[nid]['attr']
            print('[%3d] %-18s click=%-5s vis=%-5s rect=(%s,%s,%s,%s)' % (
                nid, short(a['name']), a['clickable'], a['visibleToUser'],
                a['left'], a['top'], a['right'], a['bottom']))
            print('      text=%r desc=%r vid=%r id=%r' % (
                a.get('text'), a.get('desc'), a.get('vid'), a.get('id')))
        return

    # ---- 默认: 列出所有带标识的节点 ----
    print('=== 所有带 text/desc/vid/id 的节点 ===\n')
    for nid in sorted(nodes):
        a = nodes[nid]['attr']
        b = []
        if a.get('vid'):
            b.append('vid=%s' % a['vid'])
        if a.get('text'):
            b.append('text=%r' % a['text'])
        if a.get('desc'):
            b.append('desc=%r' % a['desc'])
        if a.get('id'):
            b.append('id=%s' % a['id'])
        if not b:
            continue
        print('[%3d] d=%-2d %-18s click=%-5s vis=%-5s rect=(%s,%s,%s,%s) | %s' % (
            nid, a['depth'], short(a['name']), a['clickable'], a['visibleToUser'],
            a['left'], a['top'], a['right'], a['bottom'], ' | '.join(b)[:150]))


if __name__ == '__main__':
    main()
