/**
 * content.js - Claude Chat PDF Exporter
 *
 * 根据 claude.ai 实际 DOM 诊断结果（2025）定制：
 *   - data-testid="user-message" 标记人类消息
 *   - AI 回复无 testid，通过 DOM 位置推断
 *   - .prose 类不存在，不依赖它
 */

(function () {
  'use strict';

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractConversation') {
      try {
        const data = extractConversation();
        sendResponse({ success: true, ...data });
      } catch (e) {
        console.error('[Claude PDF] 提取失败:', e);
        sendResponse({ success: false, error: e.message });
      }
    }
    return true;
  });

  // ─── 主入口 ──────────────────────────────────────────────────────────────

  function extractConversation() {
    const title = document.title.replace(/\s*[-–|].*$/, '').trim() || 'Claude 对话';
    const messages = findMessages();

    if (!messages || messages.length === 0) {
      // 输出诊断信息帮助调试
      const ids = [...new Set([...document.querySelectorAll('[data-testid]')]
        .map(e => e.getAttribute('data-testid')))].sort().join(', ');
      console.log('[Claude PDF] 页面 data-testid 清单:', ids || '（无）');
      console.log('[Claude PDF] .prose 元素数:', document.querySelectorAll('.prose').length);
      throw new Error(
        '未能找到对话消息内容。\n\n请确认：\n' +
        '1. 当前页面是含有内容的对话（非空对话）\n' +
        '2. 页面已完全加载且 Claude 已完成回复\n\n' +
        '已在 Console 输出诊断信息供排查。'
      );
    }

    const h = messages.filter(m => m.role === 'human').length;
    const a = messages.filter(m => m.role === 'assistant').length;
    console.log(`[Claude PDF] 提取完成：用户消息 ${h} 条，Claude 回复 ${a} 条`);

    return { title, messages, url: location.href, timestamp: new Date().toLocaleString('zh-CN') };
  }

  // ─── 策略调度 ─────────────────────────────────────────────────────────────

  function findMessages() {
    // 策略 1：user-message testid + DOM 位置推断 AI 回复（针对当前 claude.ai）
    const r1 = strategyUserMessage();
    if (r1?.length) { console.log('[Claude PDF] 策略1 生效，消息数:', r1.length); return r1; }

    // 策略 2：双 testid（备用，应对未来可能加回 AI testid 的情况）
    const r2 = strategyBothTestIds();
    if (r2?.length) { console.log('[Claude PDF] 策略2 生效，消息数:', r2.length); return r2; }

    // 策略 3：纯结构扫描
    const r3 = strategyStructural();
    if (r3?.length) { console.log('[Claude PDF] 策略3 生效，消息数:', r3.length); return r3; }

    // 策略 4：兜底
    const r4 = strategyFallback();
    if (r4?.length) { console.log('[Claude PDF] 策略4(fallback) 生效'); return r4; }

    return null;
  }

  // ─── 策略 1：user-message testid（当前 claude.ai DOM 的精确策略）────────
  //
  // claude.ai 用 data-testid="user-message" 标记人类消息，
  // AI 回复无 testid，但紧邻人类消息容器出现在 DOM 中。
  // 算法：
  //   1. 找所有 user-message 元素的最近公共祖先（对话容器）
  //   2. 在该祖先层级内展开子元素树，到"每个子容器含≤1个 user-message"为止
  //   3. 含 user-message → 人类轮次，不含但有文本 → AI 轮次

  function strategyUserMessage() {
    const userMsgEls = [...document.querySelectorAll('[data-testid="user-message"]')];
    if (userMsgEls.length === 0) return null;

    // 找所有 user-message 的最近公共祖先
    let conv = userMsgEls[0];
    for (const el of userMsgEls.slice(1)) {
      conv = findLCA(conv, el);
      if (!conv || conv === document.body || conv === document.documentElement) return null;
    }

    // 展开到每个子容器含 0 或 1 个 user-message 的粒度
    const turns = flattenToOnePerTurn(conv, '[data-testid="user-message"]', userMsgEls.length);

    const messages = [];
    for (const turn of turns) {
      const text = turn.innerText?.trim();
      if (!text) continue;

      // 判断是否是人类轮次
      const userMsgEl =
        (turn.getAttribute('data-testid') === 'user-message' ? turn : null) ||
        turn.querySelector('[data-testid="user-message"]');

      if (userMsgEl) {
        messages.push({ role: 'human', html: cleanHtml(userMsgEl) });
      } else {
        messages.push({ role: 'assistant', html: cleanHtml(turn) });
      }
    }

    const hasHuman = messages.some(m => m.role === 'human');
    const hasAI    = messages.some(m => m.role === 'assistant');
    if (!hasHuman || !hasAI) return null;

    return messages;
  }

  // ─── 策略 2：双 testid（备用）────────────────────────────────────────────

  function strategyBothTestIds() {
    const pairs = [
      ['[data-testid="human-turn"]',   '[data-testid="ai-turn"]'],
      ['[data-testid="user-turn"]',    '[data-testid="assistant-turn"]'],
      ['[data-testid="user-message"]', '[data-testid="assistant-message"]'],
      ['.human-turn',                  '.ai-turn, .assistant-turn'],
    ];

    for (const [hSel, aSel] of pairs) {
      const humans = [...document.querySelectorAll(hSel)];
      const ais    = [...document.querySelectorAll(aSel)];
      if (humans.length === 0 || ais.length === 0) continue;

      const all = [
        ...humans.map(el => ({ el, role: 'human' })),
        ...ais.map(el => ({ el, role: 'assistant' })),
      ].sort((a, b) =>
        a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
      );

      return all.map(({ el, role }) => ({ role, html: cleanHtml(el) }));
    }
    return null;
  }

  // ─── 策略 3：纯 DOM 结构扫描（不依赖任何类名或 testid）────────────────────
  //
  // 原理：
  //   找到包含所有 user-message 的最小祖先容器，
  //   然后遍历其子元素：
  //     • 含 user-message → 人类
  //     • 不含 user-message 但文本量足够 → AI

  function strategyStructural() {
    // 前提：至少能找到 user-message 作为锚点
    const anchor = document.querySelector('[data-testid="user-message"]');
    if (!anchor) {
      // 完全没有锚点，尝试 <main>
      return strategyMainScan();
    }

    // 用单个 anchor 向上走，找到"包含多个明显消息块"的容器
    let container = anchor.parentElement;
    while (container && container !== document.body) {
      const children = [...container.children].filter(c => c.innerText?.trim().length > 5);
      if (children.length >= 2) break;
      container = container.parentElement;
    }

    if (!container || container === document.body) return null;

    const children = [...container.children].filter(c => c.innerText?.trim().length > 5);
    const messages = [];

    for (const child of children) {
      const userEl = child.querySelector('[data-testid="user-message"]') ||
                     (child.getAttribute('data-testid') === 'user-message' ? child : null);
      if (userEl) {
        messages.push({ role: 'human', html: cleanHtml(userEl) });
      } else {
        messages.push({ role: 'assistant', html: cleanHtml(child) });
      }
    }

    const hasHuman = messages.some(m => m.role === 'human');
    const hasAI    = messages.some(m => m.role === 'assistant');
    return (hasHuman && hasAI) ? messages : null;
  }

  function strategyMainScan() {
    const main = document.querySelector('main');
    if (!main) return null;

    // 找 main 内文本量最大的直接子容器，将其子元素作为候选消息块
    const children = [...main.children].filter(c => c.innerText?.trim().length > 20);
    if (children.length === 0) return null;

    // 如果 main 本身有多个有意义的子元素，直接用
    if (children.length >= 2) {
      return children.map((el, i) => ({
        role: i % 2 === 0 ? 'human' : 'assistant',
        html: cleanHtml(el),
      }));
    }

    // 否则进到下一层
    const grandchildren = [...children[0].children].filter(c => c.innerText?.trim().length > 20);
    return grandchildren.map((el, i) => ({
      role: i % 2 === 0 ? 'human' : 'assistant',
      html: cleanHtml(el),
    }));
  }

  // ─── 策略 4：兜底（纯文本）───────────────────────────────────────────────

  function strategyFallback() {
    const main = document.querySelector('main');
    if (!main?.innerText?.trim()) return null;

    return [{
      role: 'assistant',
      html:
        '<p><strong>⚠️ 提示：</strong>无法精确识别对话结构，以下为页面主要内容，格式可能不完整。</p>' +
        `<pre style="white-space:pre-wrap">${escapeHtml(main.innerText)}</pre>`,
    }];
  }

  // ─── 辅助：展开到每个子容器含≤1个目标元素 ────────────────────────────────

  function flattenToOnePerTurn(root, selector, targetCount) {
    let candidates = [...root.children];

    for (let i = 0; i < 10; i++) {
      const withTarget = candidates.filter(c =>
        c.querySelector(selector) || c.matches(selector)
      );
      const allAtMostOne = withTarget.every(c =>
        c.querySelectorAll(selector).length <= 1
      );

      if (allAtMostOne && withTarget.length >= targetCount) break;

      const next = [];
      for (const c of candidates) {
        if (c.querySelectorAll(selector).length > 1) {
          next.push(...c.children);
        } else {
          next.push(c);
        }
      }
      if (next.length === candidates.length) break;
      candidates = next;
    }

    return candidates;
  }

  // ─── 工具函数 ─────────────────────────────────────────────────────────────

  function cleanHtml(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll(
      'button, [role="button"], input, select, textarea, svg, ' +
      '[data-testid="action-bar-copy"], [data-testid="action-bar-retry"], ' +
      '[data-testid="wiggle-controls-actions"], ' +
      '[class*="copy"], [class*="Copy"], [class*="feedback"], [class*="Feedback"], ' +
      '[class*="toolbar"], [class*="Toolbar"], [class*="action-bar"], [class*="ActionBar"]'
    ).forEach(e => e.remove());
    return clone.innerHTML.replace(/\n{3,}/g, '\n\n').trim();
  }

  function findLCA(el1, el2) {
    const ancestors = new Set();
    let node = el1;
    while (node) { ancestors.add(node); node = node.parentElement; }
    node = el2;
    while (node) { if (ancestors.has(node)) return node; node = node.parentElement; }
    return null;
  }

  function escapeHtml(text) {
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(text));
    return d.innerHTML;
  }

})();
