/**
 * popup.js - Claude Chat PDF Exporter
 *
 * 流程：
 *   1. 向当前标签页的 content.js 发消息，提取对话数据
 *   2. 将提取到的数据渲染为自包含的打印 HTML
 *   3. 用 window.open + document.write 打开新窗口并自动触发打印
 */

document.addEventListener('DOMContentLoaded', () => {
  const btn    = document.getElementById('exportBtn');
  const status = document.getElementById('status');

  btn.addEventListener('click', handleExport);

  async function handleExport() {
    btn.disabled = true;
    showStatus('info', '正在提取对话内容…');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab?.url?.includes('claude.ai')) {
        showStatus('error', '请先打开一个 Claude.ai 对话页面，再点击导出。');
        return;
      }

      // 尝试联系 content script；若页面加载前扩展刚安装，则先注入
      let response;
      try {
        response = await chrome.tabs.sendMessage(tab.id, { action: 'extractConversation' });
      } catch {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        response = await chrome.tabs.sendMessage(tab.id, { action: 'extractConversation' });
      }

      if (!response) {
        showStatus('error', '无法连接到页面，请刷新页面后重试。');
        return;
      }

      if (!response.success) {
        showStatus('error', response.error);
        return;
      }

      showStatus('info', `找到 ${response.messages.length} 条消息，正在生成打印预览…`);

      openPrintWindow(buildPrintHtml(response));
      showStatus('success', '✓ 打印预览已打开\n在对话框中选择「另存为 PDF」保存。');

    } catch (e) {
      showStatus('error', `导出失败：${e.message}`);
    } finally {
      btn.disabled = false;
    }
  }

  function showStatus(type, text) {
    status.className = type;
    status.textContent = text;
  }

  // ─── 打印 HTML 生成 ──────────────────────────────────────────────────────

  function buildPrintHtml({ title, messages, url, timestamp }) {
    const messagesHtml = messages.map(msg => {
      const label     = msg.role === 'human' ? '您' : msg.role === 'assistant' ? 'Claude' : '内容';
      const roleClass = msg.role === 'human' ? 'human' : msg.role === 'assistant' ? 'assistant' : 'unknown';
      return `<div class="msg ${roleClass}">
  <div class="msg-role">${label}</div>
  <div class="msg-body">${msg.html}</div>
</div>`;
    }).join('\n');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${esc(title)}</title>
  <style>
    /* ── Reset ── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    /* ── Page ── */
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Noto Sans SC',
                   'Microsoft YaHei', 'Helvetica Neue', sans-serif;
      font-size: 11.5pt;
      line-height: 1.75;
      color: #1a1a1a;
      background: #fff;
      max-width: 800px;
      margin: 0 auto;
      padding: 32px 24px;
    }

    /* ── Header ── */
    .doc-header {
      border-bottom: 1.5px solid #ddd;
      padding-bottom: 14px;
      margin-bottom: 28px;
    }
    .doc-header h1 {
      font-size: 17pt;
      font-weight: 700;
      color: #111;
      margin-bottom: 5px;
    }
    .doc-header .meta {
      font-size: 9pt;
      color: #999;
    }

    /* ── Messages ── */
    .msg {
      margin-bottom: 22px;
      padding: 13px 16px;
      border-radius: 8px;
      page-break-inside: avoid;
    }
    .msg.human {
      background: #f6f6f6;
      border-left: 3px solid #aaa;
      margin-left: 24px;
    }
    .msg.assistant {
      background: #fff;
      border: 1px solid #e5e5e5;
      border-left: 3px solid #5b5ea6;
    }

    .msg-role {
      font-size: 8.5pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      margin-bottom: 7px;
    }
    .msg.human     .msg-role { color: #666; }
    .msg.assistant .msg-role { color: #5b5ea6; }

    /* ── Prose Typography ── */
    .msg-body p { margin-bottom: 0.75em; }
    .msg-body p:last-child { margin-bottom: 0; }

    .msg-body h1, .msg-body h2, .msg-body h3,
    .msg-body h4, .msg-body h5, .msg-body h6 {
      font-weight: 600;
      line-height: 1.35;
      margin: 1.1em 0 0.45em;
    }
    .msg-body h1 { font-size: 14.5pt; }
    .msg-body h2 { font-size: 13pt;   }
    .msg-body h3 { font-size: 12pt;   }
    .msg-body h4, .msg-body h5, .msg-body h6 { font-size: 11.5pt; }

    .msg-body ul, .msg-body ol {
      padding-left: 1.6em;
      margin-bottom: 0.75em;
    }
    .msg-body li { margin-bottom: 0.25em; }
    .msg-body li > p { margin-bottom: 0.2em; }

    .msg-body strong { font-weight: 600; }
    .msg-body em     { font-style: italic; }

    .msg-body a { color: #5b5ea6; text-decoration: underline; }

    .msg-body hr {
      border: none;
      border-top: 1px solid #ddd;
      margin: 1em 0;
    }

    .msg-body blockquote {
      border-left: 3px solid #ccc;
      padding-left: 14px;
      color: #555;
      margin: 0.75em 0;
    }

    /* ── Code ── */
    .msg-body code {
      font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', Consolas,
                   'Courier New', monospace;
      font-size: 10pt;
      background: #f0f0f0;
      padding: 1px 5px;
      border-radius: 3px;
    }
    .msg-body pre {
      background: #f5f5f5;
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      padding: 13px 15px;
      margin: 0.8em 0;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
      page-break-inside: avoid;
    }
    .msg-body pre code {
      background: none;
      padding: 0;
      font-size: 10pt;
      color: #333;
      line-height: 1.55;
    }
    /* 清除语法高亮色彩，确保打印黑白可读 */
    .msg-body pre code span { color: inherit !important; }

    /* 代码块语言标签（如果 claude.ai 生成了的话） */
    .msg-body [class*="code-block-header"],
    .msg-body [class*="CodeBlockHeader"] {
      font-family: 'SF Mono', Consolas, monospace;
      font-size: 9pt;
      color: #888;
      background: #ebebeb;
      padding: 3px 10px;
      border-radius: 6px 6px 0 0;
      border: 1px solid #e0e0e0;
      border-bottom: none;
      margin-bottom: -1px;
    }

    /* ── Tables ── */
    .msg-body table {
      border-collapse: collapse;
      width: 100%;
      margin: 0.8em 0;
      font-size: 11pt;
    }
    .msg-body th, .msg-body td {
      border: 1px solid #ccc;
      padding: 6px 10px;
      text-align: left;
    }
    .msg-body th { background: #f0f0f0; font-weight: 600; }
    .msg-body tr:nth-child(even) td { background: #fafafa; }

    /* ── Images ── */
    .msg-body img { max-width: 100%; height: auto; border-radius: 4px; }

    /* ── Footer ── */
    .doc-footer {
      margin-top: 36px;
      padding-top: 12px;
      border-top: 1px solid #e5e5e5;
      font-size: 8.5pt;
      color: #bbb;
      text-align: center;
    }

    /* ── Print ── */
    @page { margin: 18mm 15mm; }
    @media print {
      body { padding: 0; }
      .msg { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="doc-header">
    <h1>${esc(title)}</h1>
    <p class="meta">导出时间：${timestamp}&nbsp;&nbsp;|&nbsp;&nbsp;来源：${esc(url)}</p>
  </div>

  <div class="conversation">
${messagesHtml}
  </div>

  <div class="doc-footer">由 Claude Chat PDF 导出插件生成 · claude.ai</div>

  <script>
    window.addEventListener('load', function () {
      setTimeout(function () { window.print(); }, 600);
    });
  </script>
</body>
</html>`;
  }

  function openPrintWindow(html) {
    const win = window.open('', '_blank');
    if (!win) {
      showStatus('error', '浏览器阻止了弹窗，请在地址栏右侧允许弹窗后重试。');
      return;
    }
    win.document.write(html);
    win.document.close();
  }

  /** 转义 HTML 特殊字符 */
  function esc(str) {
    return (str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
});
