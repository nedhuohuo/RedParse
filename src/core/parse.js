import { isValidNoteId } from './url.js';
import { parseVideoNote } from './parsers/video.js';
import { inspectImageNote, parseImageNote } from './parsers/image.js';

/**
 * 解析器注册表：未来新增 image / live_photo 支持时只需实现对应 parser 并开启 supported。
 */
const PARSER_REGISTRY = {
  video: {
    supported: true,
    parse: parseVideoNote
  },
  image: {
    supported: false,
    parse: parseImageNote
  },
  live_photo: {
    supported: false,
    parse: parseImageNote
  }
};

export function selectRawNoteFromExtraction(extracted) {
  if (!extracted || typeof extracted !== 'object') {
    return { source: 'none', noteId: null, note: null };
  }

  const urlNoteId = extracted?.meta?.urlNoteId;
  const candidates = [
    { source: 'pinia', store: extracted.pinia },
    { source: '__INITIAL_STATE__', store: extracted.initialState }
  ];

  // 1. 精确匹配 URL 里的 noteId
  if (isValidNoteId(urlNoteId)) {
    for (const { source, store } of candidates) {
      const note = store?.matchedEntry?.note || store?.matchedEntry;
      if (store?.matchedId === urlNoteId && note && typeof note === 'object') {
        return { source, noteId: urlNoteId, note };
      }
    }
  }

  // 2. 退回到 store.currentNoteId 命中的有效条目
  for (const { source, store } of candidates) {
    const note = store?.matchedEntry?.note || store?.matchedEntry;
    if (isValidNoteId(store?.matchedId) && note && typeof note === 'object') {
      return { source, noteId: store.matchedId, note };
    }
  }

  return { source: 'none', noteId: null, note: null };
}

export function detectNoteType(note) {
  if (!note || typeof note !== 'object') return { noteType: 'unknown', detail: null };

  if (note.type === 'video' || note.video?.media?.stream || note.video?.mediaV2 || note.video?.consumer?.originVideoKey) {
    return { noteType: 'video', detail: null };
  }

  if (Array.isArray(note.imageList) && note.imageList.length > 0) {
    const info = inspectImageNote(note);
    return { noteType: info.noteType, detail: info };
  }

  return { noteType: 'unknown', detail: null };
}

export function parseExtractedPage(extracted) {
  const { source, noteId, note } = selectRawNoteFromExtraction(extracted);

  if (!note) {
    return {
      ok: false,
      reason: 'NO_NOTE_DATA',
      source,
      noteId: extracted?.meta?.urlNoteId || null,
      title: '',
      desc: '',
      author: '',
      noteType: 'unknown',
      supported: false,
      assets: [],
      meta: null
    };
  }

  const { noteType, detail } = detectNoteType(note);
  const entry = PARSER_REGISTRY[noteType];

  const base = {
    source,
    noteId: note.noteId || noteId || extracted?.meta?.urlNoteId || '',
    title: typeof note.title === 'string' ? note.title.trim() : '',
    desc: typeof note.desc === 'string' ? note.desc.trim() : '',
    author: typeof note.user?.nickname === 'string' ? note.user.nickname.trim() : '',
    noteType,
    supported: Boolean(entry?.supported),
    meta: detail
  };

  if (!entry || !entry.supported) {
    return {
      ok: true,
      reason: 'UNSUPPORTED_TYPE',
      ...base,
      assets: []
    };
  }

  const assets = entry.parse(note);
  if (!assets.length) {
    return {
      ok: false,
      reason: 'NO_MEDIA_STREAMS',
      ...base,
      assets: []
    };
  }

  return {
    ok: true,
    reason: null,
    ...base,
    assets
  };
}
