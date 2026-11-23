/**
 * 在目标标签页的 MAIN world 中执行的数据采集函数。
 * 注意：chrome.scripting.executeScript 要求 func 完全自包含，不能依赖外部模块变量。
 */
export function extractPageData() {
  const MAX_DEPTH = 10;

  function unwrap(val) {
    if (!val || typeof val !== 'object') return val;
    if ('_rawValue' in val) return val._rawValue;
    if ('_value' in val) return val._value;
    if ('__v_raw' in val) return val.__v_raw;
    return val;
  }

  function safeClone(val, depth = 0, seen = new WeakSet()) {
    if (depth > MAX_DEPTH) return '[MaxDepth]';
    const raw = unwrap(val);
    if (raw === null || raw === undefined) return raw;
    const t = typeof raw;
    if (t === 'string' || t === 'number' || t === 'boolean') return raw;
    if (t === 'bigint') return raw.toString();
    if (t !== 'object') return `[${t}]`;

    if (seen.has(raw)) return '[Circular]';
    seen.add(raw);

    if (Array.isArray(raw)) {
      return raw.slice(0, 50).map((item) => safeClone(item, depth + 1, seen));
    }

    const out = {};
    for (const key of Object.keys(raw)) {
      // 跳过无关且体积大的评论或推荐流，保留核心笔记与媒体字段
      if (key === 'comments' || key === 'feeds' || key === 'noteList') {
        const v = unwrap(raw[key]);
        out[key] = Array.isArray(v) ? `[Array(${v.length})]` : '[Omitted]';
        continue;
      }
      try {
        out[key] = safeClone(raw[key], depth + 1, seen);
      } catch {
        out[key] = '[Unreadable]';
      }
    }
    return out;
  }

  function extractNoteIdFromPath(pathname) {
    const patterns = [
      /\/explore\/([a-zA-Z0-9]+)/,
      /\/discovery\/item\/([a-zA-Z0-9]+)/,
      /\/user\/profile\/[^/]+\/([a-zA-Z0-9]+)/,
      /\/notes?\/([a-zA-Z0-9]+)/
    ];
    for (const re of patterns) {
      const m = pathname.match(re);
      if (m) return m[1];
    }
    return null;
  }

  function pickNoteFromMap(noteDetailMap, targetIds) {
    const rawMap = unwrap(noteDetailMap);
    if (!rawMap || typeof rawMap !== 'object') {
      return { keys: [], matchedId: null, entry: null };
    }
    const keys = Object.keys(rawMap).filter(
      (k) => k && k !== 'undefined' && k !== 'null'
    );
    for (const id of targetIds) {
      if (id && id !== 'undefined' && id !== 'null' && rawMap[id]) {
        return { keys, matchedId: id, entry: safeClone(rawMap[id]) };
      }
    }
    if (keys.length === 1) {
      return { keys, matchedId: keys[0], entry: safeClone(rawMap[keys[0]]) };
    }
    const fallbackKey = keys[keys.length - 1] || null;
    return {
      keys,
      matchedId: fallbackKey,
      fallback: true,
      entry: fallbackKey ? safeClone(rawMap[fallbackKey]) : null
    };
  }

  const href = window.location.href;
  const pathname = window.location.pathname;
  const urlNoteId = extractNoteIdFromPath(pathname);

  const result = {
    meta: {
      origin: window.location.origin,
      pathname,
      hasXsecToken: new URLSearchParams(window.location.search).has('xsec_token'),
      urlNoteId,
      title: document.title,
      capturedAt: new Date().toISOString()
    },
    initialState: {
      exists: false,
      topKeys: [],
      noteKeys: [],
      currentNoteId: null,
      firstNoteId: null,
      noteDetailMapKeys: [],
      matchedId: null,
      matchedEntry: null
    },
    pinia: {
      exists: false,
      storeKeys: [],
      noteStoreKeys: [],
      currentNoteId: null,
      noteDetailMapKeys: [],
      matchedId: null,
      matchedEntry: null
    },
    domVideos: []
  };

  // 1. 检查 window.__INITIAL_STATE__
  try {
    const initState = unwrap(window.__INITIAL_STATE__);
    if (initState && typeof initState === 'object') {
      result.initialState.exists = true;
      result.initialState.topKeys = Object.keys(initState);

      const noteStore = unwrap(initState.note);
      if (noteStore && typeof noteStore === 'object') {
        result.initialState.noteKeys = Object.keys(noteStore);
        const currentNoteId = unwrap(noteStore.currentNoteId);
        const firstNoteId = unwrap(noteStore.firstNoteId);
        result.initialState.currentNoteId = typeof currentNoteId === 'string' ? currentNoteId : null;
        result.initialState.firstNoteId = typeof firstNoteId === 'string' ? firstNoteId : null;

        const picked = pickNoteFromMap(noteStore.noteDetailMap, [
          urlNoteId,
          result.initialState.currentNoteId,
          result.initialState.firstNoteId
        ]);
        result.initialState.noteDetailMapKeys = picked.keys;
        result.initialState.matchedId = picked.matchedId;
        result.initialState.matchedEntry = picked.entry;
      }
    }
  } catch (err) {
    result.initialState.error = String(err);
  }

  // 2. 检查 Vue 3 Pinia store（SPA 弹窗跳转时可能只更新了这里）
  try {
    const appEl = document.querySelector('#app');
    const vueApp = appEl && appEl.__vue_app__;
    const pinia = vueApp && vueApp.config && vueApp.config.globalProperties && vueApp.config.globalProperties.$pinia;
    const piniaState = pinia && unwrap(pinia.state);
    if (piniaState && typeof piniaState === 'object') {
      result.pinia.exists = true;
      result.pinia.storeKeys = Object.keys(piniaState);
      const noteStore = unwrap(piniaState.note);
      if (noteStore && typeof noteStore === 'object') {
        result.pinia.noteStoreKeys = Object.keys(noteStore);
        const currentNoteId = unwrap(noteStore.currentNoteId);
        result.pinia.currentNoteId = typeof currentNoteId === 'string' ? currentNoteId : null;

        const picked = pickNoteFromMap(noteStore.noteDetailMap, [
          urlNoteId,
          result.pinia.currentNoteId
        ]);
        result.pinia.noteDetailMapKeys = picked.keys;
        result.pinia.matchedId = picked.matchedId;
        result.pinia.matchedEntry = picked.entry;
      }
    }
  } catch (err) {
    result.pinia.error = String(err);
  }

  // 3. 检查页面中的 <video> 元素
  try {
    const videos = Array.from(document.querySelectorAll('video'));
    result.domVideos = videos.map((v, index) => ({
      index,
      src: v.getAttribute('src') || '',
      currentSrc: v.currentSrc || '',
      videoWidth: v.videoWidth || 0,
      videoHeight: v.videoHeight || 0,
      duration: Number.isFinite(v.duration) ? v.duration : null,
      paused: v.paused
    }));
  } catch (err) {
    result.domVideos = [{ error: String(err) }];
  }

  // 检查 href 是否被需要（不放完整 query，避免暴露隐私参数）
  void href;
  return result;
}
