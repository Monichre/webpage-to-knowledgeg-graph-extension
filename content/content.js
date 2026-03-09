/**
 * Content Script — Webpage Content Extractor
 * ============================================
 * AI Knowledge Graph Chrome Extension
 *
 * Uses Mozilla Readability (bundled) for article extraction.
 * Falls back to full-body extraction for non-article pages.
 * Chat transcript detection is handled separately.
 */

(function () {
  'use strict';

  // ── Utilities ──────────────────────────────────────────────────────────────

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  }

  // ── Provenance ─────────────────────────────────────────────────────────────

  function getMeta(names) {
    for (const name of names) {
      const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
      const content = el?.getAttribute('content');
      if (content) return content;
    }
    return '';
  }

  function extractProvenance() {
    const visitedUrl = window.location.href;
    const canonicalEl = document.querySelector('link[rel="canonical"]');
    let canonicalUrl = canonicalEl?.getAttribute('href') || '';
    if (canonicalUrl && !canonicalUrl.startsWith('http')) {
      try { canonicalUrl = new URL(canonicalUrl, visitedUrl).href; } catch { canonicalUrl = visitedUrl; }
    }
    canonicalUrl = canonicalUrl || visitedUrl;

    let publishedAt = getMeta(['article:published_time', 'date', 'datePublished', 'pubdate']);
    if (!publishedAt) {
      try {
        const ldEl = document.querySelector('script[type="application/ld+json"]');
        if (ldEl) {
          const parsed = JSON.parse(ldEl.textContent);
          publishedAt = parsed.datePublished || parsed.dateCreated || '';
        }
      } catch { /* ignore */ }
    }

    const allMeta = {};
    document.querySelectorAll('meta').forEach((el) => {
      const name = el.getAttribute('name') || el.getAttribute('property');
      const content = el.getAttribute('content');
      if (name && content) allMeta[name] = content;
    });
    document.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
      try { allMeta['structured_data'] = JSON.parse(el.textContent); } catch { /* ignore */ }
    });

    return {
      canonicalUrl,
      visitedUrl,
      canonicalMatchesVisited: canonicalUrl === visitedUrl,
      title: document.title || '',
      description: getMeta(['description', 'og:description', 'twitter:description']),
      siteName: getMeta(['og:site_name', 'application-name']),
      author: getMeta(['author', 'article:author']),
      publishedAt,
      keywords: getMeta(['keywords']),
      ogImage: getMeta(['og:image']),
      timestamp: new Date().toISOString(),
      metadata: allMeta,
    };
  }

  // ── Auto-scroll ─────────────────────────────────────────────────────────────

  async function autoScroll(scrollOptions) {
    const config = {
      maxPasses: clampNumber(scrollOptions?.maxPasses, 3, 60, 24),
      waitMs: clampNumber(scrollOptions?.waitMs, 100, 2000, 450),
      timeoutMs: clampNumber(scrollOptions?.timeoutMs, 3000, 60000, 20000),
      noGrowthThreshold: clampNumber(scrollOptions?.noGrowthThreshold, 1, 10, 3),
    };
    const startedAt = performance.now();
    const initialY = window.scrollY;
    let maxHeight = document.documentElement.scrollHeight;
    let noGrowthCount = 0;
    let passes = 0;

    while (passes < config.maxPasses && (performance.now() - startedAt) < config.timeoutMs) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await wait(config.waitMs);
      const currentHeight = document.documentElement.scrollHeight;
      if (currentHeight <= maxHeight + 24) {
        noGrowthCount += 1;
      } else {
        noGrowthCount = 0;
        maxHeight = currentHeight;
      }
      passes += 1;
      if (noGrowthCount >= config.noGrowthThreshold) break;
    }
    window.scrollTo(0, initialY);
    return { passes, durationMs: Math.round(performance.now() - startedAt), documentHeight: maxHeight };
  }

  // ── Readability extraction ──────────────────────────────────────────────────

  /**
   * Run Mozilla Readability on a clone of the document.
   * Returns null if Readability is unavailable or the page isn't article-like.
   */
  function runReadability() {
    if (typeof Readability === 'undefined') return null;
    try {
      const docClone = document.cloneNode(true);
      const reader = new Readability(docClone, {
        charThreshold: 100,
        keepClasses: false,
      });
      const article = reader.parse();
      if (!article || !article.textContent || article.textContent.trim().length < 200) return null;
      return article;
    } catch {
      return null;
    }
  }

  // ── Clean HTML → Markdown ──────────────────────────────────────────────────
  //
  // Readability returns clean article HTML. We convert it to structured
  // markdown here so the AI receives clearly segmented, readable text.

  function htmlToMarkdown(html) {
    const container = document.createElement('div');
    container.innerHTML = html;

    function processNode(node, depth) {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent.replace(/\s+/g, ' ');
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return '';

      const tag = node.tagName.toLowerCase();
      const children = () => Array.from(node.childNodes).map((c) => processNode(c, depth + 1)).join('');

      switch (tag) {
        case 'script':
        case 'style':
        case 'noscript':
          return '';

        case 'h1': return `\n\n# ${children().trim()}\n\n`;
        case 'h2': return `\n\n## ${children().trim()}\n\n`;
        case 'h3': return `\n\n### ${children().trim()}\n\n`;
        case 'h4': return `\n\n#### ${children().trim()}\n\n`;
        case 'h5': return `\n\n##### ${children().trim()}\n\n`;
        case 'h6': return `\n\n###### ${children().trim()}\n\n`;

        case 'p': {
          const text = children().trim();
          return text ? `\n\n${text}\n\n` : '';
        }

        case 'br': return '\n';

        case 'strong':
        case 'b': return `**${children().trim()}**`;

        case 'em':
        case 'i': return `*${children().trim()}*`;

        case 'del':
        case 's': return `~~${children().trim()}~~`;

        case 'mark': return `==${children().trim()}==`;

        case 'code': {
          const parent = node.parentElement?.tagName.toLowerCase();
          if (parent === 'pre') return node.textContent;
          return `\`${node.textContent.trim()}\``;
        }

        case 'pre': {
          const codeEl = node.querySelector('code');
          const lang = codeEl?.className?.match(/language-(\w+)/)?.[1] || '';
          const text = (codeEl || node).textContent.trimEnd();
          return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
        }

        case 'blockquote': {
          const inner = children().trim().split('\n').map((l) => `> ${l}`).join('\n');
          return `\n\n${inner}\n\n`;
        }

        case 'a': {
          const href = node.getAttribute('href') || '';
          const text = children().trim() || href;
          const lower = href.toLowerCase();
          if (!href || lower.startsWith('#') || lower.startsWith('javascript')) return text;
          try {
            const abs = new URL(href, window.location.href).href;
            return `[${text}](${abs})`;
          } catch {
            return text;
          }
        }

        case 'img': {
          const alt = node.getAttribute('alt')?.trim() || '';
          const src = node.getAttribute('src') || '';
          if (!src) return alt;
          try {
            const abs = new URL(src, window.location.href).href;
            return alt ? `![${alt}](${abs})` : '';
          } catch {
            return alt;
          }
        }

        case 'ul': {
          const items = Array.from(node.children)
            .filter((c) => c.tagName.toLowerCase() === 'li')
            .map((li) => `- ${processNode(li, depth + 1).trim()}`)
            .join('\n');
          return `\n\n${items}\n\n`;
        }

        case 'ol': {
          const items = Array.from(node.children)
            .filter((c) => c.tagName.toLowerCase() === 'li')
            .map((li, i) => `${i + 1}. ${processNode(li, depth + 1).trim()}`)
            .join('\n');
          return `\n\n${items}\n\n`;
        }

        case 'li': return children().trim();

        case 'table': return buildMarkdownTable(node);

        case 'hr': return '\n\n---\n\n';

        default:
          return children();
      }
    }

    function buildMarkdownTable(tableEl) {
      const rows = Array.from(tableEl.querySelectorAll('tr'));
      if (!rows.length) return '';

      const parseRow = (tr) =>
        Array.from(tr.querySelectorAll('th, td')).map((cell) =>
          cell.textContent.replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')
        );

      const headerCells = parseRow(rows[0]);
      if (!headerCells.length) return '';

      const header = `| ${headerCells.join(' | ')} |`;
      const separator = `| ${headerCells.map(() => '---').join(' | ')} |`;
      const body = rows.slice(1).map((tr) => {
        const cells = parseRow(tr);
        // pad or trim to match header column count
        while (cells.length < headerCells.length) cells.push('');
        return `| ${cells.slice(0, headerCells.length).join(' | ')} |`;
      });

      return `\n\n${[header, separator, ...body].join('\n')}\n\n`;
    }

    const raw = processNode(container, 0);
    return raw
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // ── Plain text from Readability content ────────────────────────────────────

  function cleanPlainText(rawText) {
    return (rawText || '')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // ── Chat transcript ────────────────────────────────────────────────────────

  const CHAT_SELECTORS = [
    '[data-message-id]',
    '[data-testid*="message"]',
    '[data-testid*="conversation"] article',
    '[role="listitem"]',
    'article[data-testid]',
    '.message',
    '.chat-message',
    '.conversation-turn',
    '.group.w-full',
  ];

  function inferChatRole(node, index) {
    const hints = [
      node.getAttribute('data-author-role'),
      node.getAttribute('data-message-author-role'),
      node.getAttribute('aria-label'),
      node.className,
      node.parentElement?.className,
    ].filter(Boolean).join(' ').toLowerCase();

    if (/(assistant|bot|model|\bai\b)/.test(hints)) return 'assistant';
    if (/(user|human|prompt|question)/.test(hints)) return 'user';
    if (/system/.test(hints)) return 'system';
    return index % 2 === 0 ? 'user' : 'assistant';
  }

  function extractChatTranscript(chatOptions) {
    const minMessages = clampNumber(chatOptions?.minMessages, 2, 20, 3);
    const candidates = [];
    const seen = new Set();

    CHAT_SELECTORS.forEach((selector) => {
      try {
        document.querySelectorAll(selector).forEach((node) => {
          if (!seen.has(node)) { seen.add(node); candidates.push(node); }
        });
      } catch { /* ignore invalid selectors */ }
    });

    const messages = [];
    const hashes = new Set();
    candidates.forEach((node, index) => {
      const text = (node.innerText || '').replace(/\s+\n/g, '\n').trim();
      if (text.length < 8) return;
      const hash = text.slice(0, 180);
      if (hashes.has(hash)) return;
      hashes.add(hash);
      messages.push({ role: inferChatRole(node, index), text });
    });

    if (messages.length < minMessages) return null;
    return messages;
  }

  function buildTranscriptMarkdown(messages) {
    let md = `# ${document.title}\n\n> Source: ${window.location.href}\n\n## Transcript\n\n`;
    messages.forEach(({ role, text }) => {
      md += `### ${role.toUpperCase()}\n\n${text}\n\n`;
    });
    return md.trim();
  }

  // ── Main extraction ────────────────────────────────────────────────────────

  async function extractByMode(mode, scrollOptions, chatOptions) {
    const warnings = [];
    const provenance = extractProvenance();
    const stats = { modeRequested: mode, modeUsed: mode, scroll: null, messageCount: 0 };

    // ── Chat transcript mode ──
    if (mode === 'chatTranscript') {
      const transcript = extractChatTranscript(chatOptions);
      if (transcript) {
        const markdown = buildTranscriptMarkdown(transcript);
        const plainText = transcript.map(({ role, text }) => `${role.toUpperCase()}: ${text}`).join('\n\n');
        stats.messageCount = transcript.length;
        return { markdown, plainText, provenance, stats, warnings };
      }
      warnings.push('Chat transcript structure was not detected. Falling back to article extraction.');
      stats.modeUsed = 'standard';
      mode = 'standard';
    }

    // ── Full page mode: scroll first, then attempt Readability ──
    if (mode === 'fullPage') {
      stats.scroll = await autoScroll(scrollOptions);
    }

    // ── Attempt Readability (works for both fullPage and standard) ──
    const article = runReadability();

    if (article) {
      const markdown = `# ${article.title || document.title}\n\n> Source: ${window.location.href}${article.byline ? `\n> By: ${article.byline}` : ''}\n\n${htmlToMarkdown(article.content)}`;
      const plainText = cleanPlainText(article.textContent);
      if (mode === 'fullPage') {
        stats.modeUsed = 'fullPage+readability';
      } else {
        stats.modeUsed = 'readability';
      }
      return { markdown, plainText, provenance, stats, warnings };
    }

    // ── Readability fallback: manual extraction ──
    warnings.push('Readability could not identify a clear article structure. Using full document extraction.');
    stats.modeUsed = mode === 'fullPage' ? 'fullPage+manual' : 'manual';

    // For standard mode prefer article/main, otherwise use body
    const root = mode === 'standard'
      ? (document.querySelector('article') || document.querySelector('main') || document.body)
      : document.body;

    // Clone and strip noise before converting
    const clone = root.cloneNode(true);
    const noiseSelectors = [
      'script', 'style', 'noscript', 'nav', 'footer', 'header', 'aside',
      '.ad', '.advertisement', '.sidebar', '.menu', '.navigation',
      'iframe', '.cookie-banner', '.popup', '.modal',
      '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
      '[role="complementary"]',
    ];
    try {
      clone.querySelectorAll(noiseSelectors.join(',')).forEach((el) => el.remove());
    } catch { /* ignore */ }

    const markdown = `# ${document.title}\n\n> Source: ${window.location.href}\n\n${htmlToMarkdown(clone.innerHTML)}`;
    const plainText = cleanPlainText(clone.innerText || clone.textContent);
    return { markdown, plainText, provenance, stats, warnings };
  }

  // ── Message listener ───────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender?.id && sender.id !== chrome.runtime.id) {
      sendResponse({ success: false, error: { code: 'UNAUTHORIZED_SENDER', message: 'Unauthorized sender' } });
      return false;
    }

    if (!message || message.type !== 'EXTRACT') {
      sendResponse({ success: false, error: { code: 'UNKNOWN_MESSAGE_TYPE', message: 'Unsupported message type' } });
      return false;
    }

    (async () => {
      try {
        const mode = typeof message.mode === 'string' ? message.mode : 'fullPage';
        const result = await extractByMode(mode, message.scrollOptions, message.chatOptions);
        sendResponse({
          success: true,
          data: {
            markdown: result.markdown,
            plainText: result.plainText,
            content: { markdown: result.markdown, plainText: result.plainText },
            provenance: result.provenance,
            stats: result.stats,
            warnings: result.warnings,
            mode: result.stats.modeUsed,
            url: window.location.href,
            title: document.title,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        sendResponse({
          success: false,
          error: { code: 'EXTRACTION_FAILED', message: error?.message || 'Extraction failed' },
        });
      }
    })();

    return true; // keep message channel open for async
  });
})();
