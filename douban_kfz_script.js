// ==UserScript==
// @name         豆瓣 ⇄ 孔夫子互通助手（评分+跳转）
// @namespace    douban-kongfz-bridge
// @version      1.1.0
// @description  在孔夫子旧书网详情页显示豆瓣评分与短评；在豆瓣图书详情页添加“一键搜孔网”按钮。按域名分流执行，互不干扰。
// @author       DRH
// @match        https://book.kongfz.com/*
// @match        https://book.douban.com/subject/*
// @match        http://book.douban.com/subject/*
// @grant        GM_xmlhttpRequest
// @connect      book.douban.com
// @connect      m.douban.com
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const host = location.hostname;
  if (host === 'book.kongfz.com') {
    initKongfzRating();
    return;
  }
  if (host === 'book.douban.com') {
    initDoubanSearchButton();
  }

  function initDoubanSearchButton() {
    if (!/^\/subject\/\d+\/?$/.test(location.pathname)) return;

    const BTN_ID = 'kfz-search-btn';
    waitForElement('#info', { timeoutMs: 10000, intervalMs: 200 })
      .then((info) => {
        if (document.getElementById(BTN_ID)) return;

        const isbn = extractIsbnFromInfo(info);
        if (!isbn) return;

        const searchUrl = `https://search.kongfz.com/product/?keyword=${encodeURIComponent(isbn)}&page=1&sortType=7&actionPath=sortType`;
        const recommendBtn = findRecommendButton();
        const container = recommendBtn ? recommendBtn.parentElement : document.querySelector('#interest_sectl, #info');
        if (!container) return;

        const link = document.createElement('a');
        link.id = BTN_ID;
        link.textContent = '搜孔网';
        link.href = searchUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';

        applyGreenLook(link);
        alignSizeWithRecommend(recommendBtn, link);

        link.addEventListener('click', (e) => {
          e.preventDefault();
          window.open(searchUrl, '_blank', 'noopener');
        });

        if (recommendBtn) {
          recommendBtn.insertAdjacentElement('afterend', link);
        } else {
          container.appendChild(link);
        }
      })
      .catch(() => {});
  }

  function waitForElement(selector, options) {
    const { timeoutMs = 10000, intervalMs = 200 } = options || {};
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        const el = document.querySelector(selector);
        if (el) {
          clearInterval(timer);
          resolve(el);
          return;
        }
        if (Date.now() - start > timeoutMs) {
          clearInterval(timer);
          reject(new Error(`waitForElement timeout: ${selector}`));
        }
      }, intervalMs);
    });
  }

  function applyGreenLook(btn) {
    btn.style.display = 'inline-block';
    btn.style.verticalAlign = 'middle';
    btn.style.background = '#3ca353';
    btn.style.color = '#fff';
    btn.style.textDecoration = 'none';
    btn.style.marginLeft = '8px';
    btn.style.border = '1px solid transparent';
    btn.style.boxSizing = 'border-box';
    btn.style.height = '28px';
    btn.style.lineHeight = '28px';
    btn.style.padding = '0 12px';
    btn.style.fontSize = '14px';
    btn.style.borderRadius = '3px';
  }

  function alignSizeWithRecommend(srcBtn, dstBtn) {
    if (!srcBtn) return;
    const cs = window.getComputedStyle(srcBtn);
    const h = cs.height || '28px';
    const lh = cs.lineHeight && cs.lineHeight !== 'normal' ? cs.lineHeight : h;
    const fs = cs.fontSize || '14px';
    const br = cs.borderRadius || '3px';
    const pL = cs.paddingLeft || '10px';
    const pR = cs.paddingRight || '10px';
    const pT = cs.paddingTop || '0px';
    const pB = cs.paddingBottom || '0px';
    dstBtn.style.height = h;
    dstBtn.style.lineHeight = lh;
    dstBtn.style.fontSize = fs;
    dstBtn.style.borderRadius = br;
    dstBtn.style.paddingLeft = pL;
    dstBtn.style.paddingRight = pR;
    dstBtn.style.paddingTop = pT;
    dstBtn.style.paddingBottom = pB;

    const TWEAK = { heightDeltaPx: 2, paddingLeftDeltaPx: -2, paddingRightDeltaPx: -2 };
    const addPx = (val, delta) => {
      const n = parseFloat(val || '0');
      const unit = (val || '').toString().replace(/^[\d.]+/, '') || 'px';
      return `${Math.max(0, n + delta)}${unit}`;
    };
    if (TWEAK.heightDeltaPx) {
      dstBtn.style.height = addPx(dstBtn.style.height, TWEAK.heightDeltaPx);
      dstBtn.style.lineHeight = dstBtn.style.height;
    }
    if (TWEAK.paddingLeftDeltaPx) {
      dstBtn.style.paddingLeft = addPx(dstBtn.style.paddingLeft, TWEAK.paddingLeftDeltaPx);
    }
    if (TWEAK.paddingRightDeltaPx) {
      dstBtn.style.paddingRight = addPx(dstBtn.style.paddingRight, TWEAK.paddingRightDeltaPx);
    }
  }

  function extractIsbnFromInfo(infoEl) {
    const labelSpan = Array.from(infoEl.querySelectorAll('span.pl')).find((el) => /ISBN/i.test(el.textContent));
    if (labelSpan && labelSpan.nextSibling) {
      const raw = (labelSpan.nextSibling.nodeValue || '').trim();
      const digits = raw.replace(/[^0-9Xx]/g, '');
      if (digits) return digits;
    }
    const m = infoEl.textContent.match(/ISBN\s*[:：]?\s*([0-9Xx\-]+)/i);
    if (m) return m[1].replace(/[^0-9Xx]/g, '');
    return '';
  }

  function findRecommendButton() {
    const candidates = Array.from(document.querySelectorAll('a, button'));
    return candidates.find((el) => el.textContent && el.textContent.trim() === '推荐') || null;
  }

  function initKongfzRating() {
    if (typeof GM_xmlhttpRequest !== 'function') return;

    const WAIT_ISBN_MS = 120;
    const ISBN_POLL_MS = 60;
    const ISBN_RESOLVE_CAP_MS = 700;
    const ENABLE_BODY_ISBN_FALLBACK = false;
    const HTTP_TIMEOUT = 2800;
    const MAX_COMMENTS = 5;
    const MAX_LEN = 85;
    const OPEN_DOUBAN_LINK_IN_NEW_TAB = true;
    const COLLAPSE_KEY = 'kongfz_rating_box_collapsed_v1';
    const FULL_BOX_WIDTH = '360px';
    const COLLAPSED_BOX_WIDTH = '228px';

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const toAscii = (s) => (s || '').replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/[－—–‐]/g, '-');
    const isDetail = (u = location) => u.hostname === 'book.kongfz.com' && /^\/\d{3,}\/\d{6,}\/?$/.test(u.pathname);

    function http(url, headers = {}, timeout = HTTP_TIMEOUT) {
      return new Promise((res, rej) => {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          timeout,
          headers: Object.assign({ 'Accept': 'text/html,*/*;q=0.8', 'Accept-Language': 'zh-CN,zh;q=0.9' }, headers),
          onload: (r) => res(r.responseText),
          onerror: rej,
          ontimeout: () => rej(new Error('timeout'))
        });
      });
    }

    const S_CACHE = 'kongfz_isbn2sid_v1';
    const R_CACHE = 'kongfz_sid2rating_v1';
    const getJSON = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch { return {}; } };
    const setJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
    const cacheSIDGet = (isbn) => getJSON(S_CACHE)[isbn] || null;
    const cacheSIDSet = (isbn, sid) => { const m = getJSON(S_CACHE); m[isbn] = sid; setJSON(S_CACHE, m); };
    const cacheRatingGet = (sid) => {
      const m = getJSON(R_CACHE);
      const e = m[sid];
      if (!e) return null;
      if (Date.now() - e.t > 6 * 3600e3) {
        delete m[sid];
        setJSON(R_CACHE, m);
        return null;
      }
      return e.v;
    };
    const cacheRatingSet = (sid, val) => { const m = getJSON(R_CACHE); m[sid] = { t: Date.now(), v: val }; setJSON(R_CACHE, m); };
    const getCollapsedPref = () => {
      try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
    };
    const setCollapsedPref = (collapsed) => {
      try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch {}
    };

    function updateMini(box) {
      const mini = box.querySelector('#db-mini');
      const st = box.querySelector('#db-status');
      const sc = box.querySelector('#db-score');
      const mt = box.querySelector('#db-meta');
      const collapsed = box.dataset.collapsed === '1';
      if (!mini || !st || !sc) return;
      if (sc.style.display !== 'none' && sc.textContent) {
        const votesText = (mt?.textContent || '').trim();
        if (collapsed) {
          mini.innerHTML = `<div style="color:#16a34a;font-weight:700;font-size:18px;line-height:1.08;">${sc.textContent}</div>${votesText ? `<div style="font-size:11px;color:#6b7280;line-height:1.18;">${votesText}</div>` : ''}`;
        } else {
          mini.innerHTML = `<span style="color:#16a34a;font-weight:700;font-size:18px;letter-spacing:0.2px;">${sc.textContent}</span>${votesText ? `<span style="font-size:11px;color:#6b7280;margin-left:8px;">${votesText}</span>` : ''}`;
        }
      } else if (st.textContent) {
        mini.innerHTML = `<span style="font-size:11px;color:#6b7280;">${st.textContent}</span>`;
      } else {
        mini.innerHTML = '';
      }
    }

    function applyCollapsed(box, collapsed) {
      const body = box.querySelector('#db-body');
      const toggle = box.querySelector('#db-toggle');
      const mini = box.querySelector('#db-mini');
      if (!body || !toggle || !mini) return;
      box.dataset.collapsed = collapsed ? '1' : '0';
      body.style.display = collapsed ? 'none' : 'block';
      mini.style.display = collapsed ? 'inline-block' : 'none';
      toggle.textContent = collapsed ? '▸' : '▾';
      toggle.title = collapsed ? '展开' : '折叠';
      box.style.padding = collapsed ? '8px 10px' : '12px 14px';
      box.style.width = collapsed ? COLLAPSED_BOX_WIDTH : FULL_BOX_WIDTH;
      box.style.minWidth = collapsed ? COLLAPSED_BOX_WIDTH : FULL_BOX_WIDTH;
      box.style.maxWidth = collapsed ? COLLAPSED_BOX_WIDTH : FULL_BOX_WIDTH;
      box.style.borderRadius = '12px';
      box.style.boxShadow = collapsed ? '0 6px 16px rgba(0,0,0,.14)' : '0 8px 24px rgba(0,0,0,.15)';
      mini.style.background = 'transparent';
      mini.style.border = '0';
      mini.style.borderRadius = '0';
      mini.style.padding = '0';
      mini.style.boxShadow = 'none';
      mini.style.maxWidth = collapsed ? '168px' : '120px';
      mini.style.whiteSpace = collapsed ? 'normal' : 'nowrap';
      mini.style.overflow = collapsed ? 'visible' : 'hidden';
      mini.style.textOverflow = collapsed ? 'clip' : 'ellipsis';
      mini.style.lineHeight = collapsed ? '1.2' : '1';
      mini.style.display = collapsed ? 'inline-flex' : 'none';
      mini.style.flexDirection = collapsed ? 'column' : 'row';
      mini.style.alignItems = collapsed ? 'flex-start' : 'center';
      mini.style.justifyContent = collapsed ? 'center' : 'flex-start';
      updateMini(box);
      setCollapsedPref(collapsed);
    }

    function ensureUI() {
      let b = document.getElementById('douban-rating-box');
      if (b) return b;
      b = document.createElement('div');
      b.id = 'douban-rating-box';
      Object.assign(b.style, {
        position: 'fixed', left: '16px', bottom: '16px', zIndex: '999999',
        width: FULL_BOX_WIDTH, minWidth: FULL_BOX_WIDTH, maxWidth: FULL_BOX_WIDTH, background: 'rgba(255,255,255,0.96)',
        border: '1px solid #e5e7eb', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,.15)',
        font: '14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Arial', color: '#111', padding: '12px 14px'
      });
      b.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <strong style="white-space:nowrap;">豆瓣评分</strong>
        <span id="db-mini" style="display:none;font-size:12px;color:#374151;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px;"></span>
        <button id="db-toggle" type="button" title="折叠" style="margin-left:auto;border:0;background:transparent;color:#4b5563;cursor:pointer;font-size:21px;line-height:1;width:30px;height:30px;border-radius:0;padding:0;text-align:center;">▾</button>
      </div>
      <div id="db-body" style="margin-top:6px;">
        <div id="db-status" style="font-size:12px;color:#6b7280;">初始化...</div>
        <div id="db-found"  style="font-size:12px;color:#374151;margin-top:4px;"></div>
        <div id="db-score"  style="font-size:22px;font-weight:700;color:#16a34a;display:none;margin-top:4px;"></div>
        <div id="db-meta"   style="font-size:12px;color:#4b5563;margin-top:2px;display:none;"></div>
        <div id="db-comments" style="margin-top:8px;max-height:220px;overflow:auto;font-size:12px;color:#1f2937;"></div>
        <div id="db-link"   style="margin-top:8px;font-size:12px;"></div>
      </div>`;
      const tg = b.querySelector('#db-toggle');
      tg?.addEventListener('click', () => {
        const next = b.dataset.collapsed !== '1';
        applyCollapsed(b, next);
      });
      document.body.appendChild(b);
      applyCollapsed(b, getCollapsedPref());
      return b;
    }

    const removeUI = () => { const b = document.getElementById('douban-rating-box'); if (b) b.remove(); };
    const setFound = (isbn, title) => {
      ensureUI().querySelector('#db-found').textContent = `识别到：${isbn ? `ISBN ${isbn}` : '(无ISBN)'}${title ? `；书名「${title}」` : ''}`;
    };

    const ISBN_RE = /\b(?:ISBN[:\uFF1A]?\s*)?(97[89][-\s]?\d{1,5}[-\s]?\d{1,7}[-\s]?\d{1,7}[-\s]?\d|\d{9}[\dXx])\b/;
    const normISBN = (v) => v ? v.replace(/[-\s]/g, '').toUpperCase() : null;
    const pickISBNFromText = (txt) => {
      const m = toAscii(txt || '').match(ISBN_RE);
      return m ? normISBN(m[1]) : null;
    };

    function scanISBNInBlocks() {
      const blocks = ['.detail-info', '.bookinfo', '.product-params', '.spu-params', '.tab_con', '#bookDesc']
        .map((s) => document.querySelector(s)).filter(Boolean);
      for (const el of blocks) {
        const x = pickISBNFromText(el.innerText || '');
        if (x) return x;
      }
      return null;
    }

    function scanISBNInBody() {
      return pickISBNFromText(document.body?.innerText || '');
    }

    const cleanTitle = (raw) => {
      if (!raw) return '';
      let t = toAscii(raw.trim());
      t = t.replace(/^【[^】]{1,20}】\s*/g, '');
      t = t.replace(/^(?:新书|二手|现货|包邮|正版|清仓|促销|热销|自营|店铺自营)\s*[·・:：\-—~ ]+\s*/i, '');
      t = t.replace(/^[·・:：\-—~ ]+\s*/g, '');
      t = t.replace(/[（(【\[][^）)】\]]{0,20}[）)】\]]\s*$/g, '');
      t = t.replace(/孔夫子旧书网|拍卖|二手|优品/g, '').trim();
      return t;
    };

    function findTitle() {
      for (const s of ['h1', 'h2', '.book-title', '.product-title', '.detail-right .title', '.product-name', 'title']) {
        const el = document.querySelector(s);
        if (!el) continue;
        const t = cleanTitle(el.innerText || el.textContent || '');
        if (t && t.length >= 4 && !/^(新书|二手|现货|包邮|正版)$/i.test(t)) return t.slice(0, 60);
      }
      return null;
    }

    function parseSubjectId(html) {
      if (!html) return null;
      let m = html.match(/https?:\/\/book\.douban\.com\/subject\/(\d+)\//);
      if (!m) m = html.match(/property="og:url" content="https?:\/\/book\.douban\.com\/subject\/(\d+)\//);
      return m && m[1] ? m[1] : null;
    }

    async function resolveByISBNFast(isbn) {
      const cached = cacheSIDGet(isbn);
      if (cached) return cached;

      const urls = [
        `https://book.douban.com/subject_search?search_text=${encodeURIComponent(isbn)}&cat=1001`,
        `https://book.douban.com/isbn/${isbn}/`
      ];

      return new Promise((resolve) => {
        let pending = urls.length;
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          resolve(null);
        }, ISBN_RESOLVE_CAP_MS);

        const done = (sid) => {
          if (settled) return;
          if (sid) {
            settled = true;
            clearTimeout(timer);
            cacheSIDSet(isbn, sid);
            resolve(sid);
            return;
          }
          pending -= 1;
          if (pending <= 0) {
            settled = true;
            clearTimeout(timer);
            resolve(null);
          }
        };

        urls.forEach((url) => {
          http(url).then((html) => done(parseSubjectId(html))).catch(() => done(null));
        });
      });
    }

    async function resolveByTitle(title) {
      try {
        const h = await http(`https://book.douban.com/subject_search?search_text=${encodeURIComponent(title)}&cat=1001`);
        const m = h.match(/https?:\/\/book\.douban\.com\/subject\/(\d+)\//);
        return m ? m[1] : null;
      } catch {
        return null;
      }
    }

    async function fetchRating(sid) {
      const cached = cacheRatingGet(sid);
      if (cached) return cached;

      const headers = {
        'Accept': 'application/json',
        'Referer': `https://m.douban.com/book/subject/${sid}/`,
        'User-Agent': 'Mozilla/5.0'
      };

      try {
        const txt = await Promise.any([
          http(`https://m.douban.com/rexxar/api/v2/book/${sid}?for_mobile=1`, headers),
          http(`https://m.douban.com/rexxar/api/v2/subject/${sid}?for_mobile=1`, headers)
        ]);
        const d = JSON.parse(txt);
        const r = d?.rating || d?.rating_info;
        if (r) {
          const avg = r.value ?? r.average ?? r.score;
          const cnt = r.count ?? r.numRaters ?? r.total;
          if (avg != null) {
            const v = { score: String(avg), votes: cnt != null ? String(cnt) : '' };
            cacheRatingSet(sid, v);
            return v;
          }
        }
      } catch {}
      return null;
    }

    function parseComments(html, max = MAX_COMMENTS, maxLen = MAX_LEN) {
      const blocks = html.split('<div class="comment">').slice(1);
      const out = [];
      for (const b of blocks) {
        if (out.length >= max) break;
        const sm = b.match(/allstar(\d{2})/);
        if (!sm) continue;
        const n = (parseInt(sm[1], 10) / 10) | 0;
        const star = '⭐'.repeat(Math.max(1, Math.min(5, n)));
        const m = b.match(/<span class="short">([\s\S]*?)<\/span>/);
        if (!m) continue;
        const txt = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        if (Array.from(txt).length > maxLen) continue;
        const um = b.match(/<a [^>]*?href="https?:\/\/www\.douban\.com\/people\/[^\"]+"[^>]*?>([^<]+)<\/a>/);
        const user = um ? `（${um[1].trim()}）` : '';
        out.push(`${star}${user}：${txt}`);
      }
      return out;
    }

    function parseAnyComments(html, max = MAX_COMMENTS) {
      const blocks = html.split('<div class="comment">').slice(1);
      const out = [];
      for (const b of blocks) {
        if (out.length >= max) break;
        const sm = b.match(/allstar(\d{2})/);
        const n = sm ? ((parseInt(sm[1], 10) / 10) | 0) : 0;
        const star = sm ? '⭐'.repeat(Math.max(1, Math.min(5, n))) : '';
        const m = b.match(/<span class="short">([\s\S]*?)<\/span>/);
        if (!m) continue;
        const txt = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        const um = b.match(/<a [^>]*?href="https?:\/\/www\.douban\.com\/people\/[^\"]+"[^>]*?>([^<]+)<\/a>/);
        const user = um ? `（${um[1].trim()}）` : '';
        out.push(`${star}${user}：${txt}`);
      }
      return out;
    }

    async function fetchCommentsHTML(sid) {
      try {
        return await http(`https://book.douban.com/subject/${sid}/comments/?status=P`);
      } catch {
        return null;
      }
    }

    function renderComments(cm, html) {
      if (!html) {
        cm.textContent = '暂无符合条件的短评';
        return;
      }
      const arr = parseComments(html);
      if (arr.length) {
        cm.innerHTML = arr.map((t) => `<div style="margin:4px 0;">${t}</div>`).join('');
        return;
      }
      const any = parseAnyComments(html);
      cm.innerHTML = any.length ? any.map((t) => `<div style="margin:4px 0;">${t}</div>`).join('') : '暂无符合条件的短评';
    }

    async function renderBySID(sid, ui, alive) {
      const { st, sc, mt, cm, lk } = ui;
      const extra = OPEN_DOUBAN_LINK_IN_NEW_TAB ? ' target="_blank" rel="noopener"' : '';
      lk.innerHTML = `<a href="https://book.douban.com/subject/${sid}/"${extra} style="color:#2563eb;text-decoration:none;border:1px solid #cbd5e1;border-radius:8px;padding:6px 10px;display:inline-block;background:#f8fafc;">在豆瓣打开书籍 »</a>`;

      st.textContent = '获取评分...';
      updateMini(ensureUI());
      const r = await fetchRating(sid);
      if (!alive()) return;
      if (r?.score) {
        sc.style.display = 'block';
        sc.textContent = r.score;
        st.textContent = '';
      } else {
        sc.style.display = 'none';
        st.textContent = '未拿到评分';
      }
      if (r?.votes) {
        mt.style.display = 'block';
        mt.textContent = `评分人数：${r.votes}`;
      }
      updateMini(ensureUI());

      const commentsHTML = await fetchCommentsHTML(sid);
      if (!alive()) return;
      renderComments(cm, commentsHTML);
    }

    let rendered = '';
    let runToken = 0;

    async function runOnce() {
      if (!isDetail()) {
        removeUI();
        return;
      }

      const tk = ++runToken;
      const alive = () => tk === runToken;

      const box = ensureUI();
      const st = box.querySelector('#db-status');
      const sc = box.querySelector('#db-score');
      const mt = box.querySelector('#db-meta');
      const cm = box.querySelector('#db-comments');
      const lk = box.querySelector('#db-link');

      st.textContent = '识别中...';
      sc.style.display = 'none';
      mt.style.display = 'none';
      cm.textContent = '';
      lk.innerHTML = '';
      updateMini(box);

      let isbn = scanISBNInBlocks();
      const title = findTitle();
      setFound(isbn, title);

      const end = Date.now() + WAIT_ISBN_MS;
      while (!isbn && Date.now() < end) {
        await sleep(ISBN_POLL_MS);
        isbn = scanISBNInBlocks();
      }
      if (!isbn && ENABLE_BODY_ISBN_FALLBACK) isbn = scanISBNInBody();
      setFound(isbn, title);

      if (isbn) {
        st.textContent = '按ISBN解析...';
        updateMini(box);
        const sid = await resolveByISBNFast(isbn);
        if (!alive()) return;
        if (!sid) {
          st.textContent = '按ISBN未命中';
          updateMini(box);
          return;
        }
        await renderBySID(sid, { st, sc, mt, cm, lk }, alive);
        return;
      }

      const t = title && title.length >= 4 ? title : '';
      if (!t) {
        st.textContent = '未检测到ISBN，且标题不可用';
        updateMini(box);
        return;
      }

      st.textContent = '按书名解析...';
      updateMini(box);
      const sid = await resolveByTitle(t);
      if (!alive()) return;
      if (!sid) {
        st.textContent = '按书名未命中';
        updateMini(box);
        return;
      }
      await renderBySID(sid, { st, sc, mt, cm, lk }, alive);
    }

    function onURL() {
      if (isDetail()) {
        if (location.href !== rendered) {
          rendered = location.href;
          runToken++;
          runOnce();
        }
      } else {
        rendered = '';
        runToken++;
        removeUI();
      }
    }

    const _p = history.pushState;
    const _r = history.replaceState;
    history.pushState = function () { _p.apply(this, arguments); onURL(); };
    history.replaceState = function () { _r.apply(this, arguments); onURL(); };
    window.addEventListener('popstate', onURL);
    window.addEventListener('hashchange', onURL);
    onURL();
  }
})();
