const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|\x00-\x1f]/g;
const MAX_BASE_LENGTH = 60;

export function sanitizeFilenamePart(text, maxLength = MAX_BASE_LENGTH) {
  if (!text || typeof text !== 'string') return '';
  const cleaned = text
    .replace(/\r?\n+/g, ' ')
    .replace(ILLEGAL_FILENAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '');

  if (!cleaned) return '';
  // 按 Unicode 码点截断，避免把 emoji 截成半个代理对
  const chars = Array.from(cleaned);
  return chars.length > maxLength ? chars.slice(0, maxLength).join('').trim() : cleaned;
}

export function pickBaseTitle({ title, desc, author, noteId }) {
  const fromTitle = sanitizeFilenamePart(title);
  if (fromTitle) return fromTitle;

  if (desc && typeof desc === 'string') {
    const firstLine = desc.split(/\r?\n/).find((line) => line.trim().length > 0);
    const fromDesc = sanitizeFilenamePart(firstLine);
    if (fromDesc) return fromDesc;
  }

  const shortId = noteId ? String(noteId).slice(0, 8) : 'video';
  const fromAuthor = sanitizeFilenamePart(author, 30);
  if (fromAuthor) return `${fromAuthor}_${shortId}`;

  return sanitizeFilenamePart(noteId) || 'xiaohongshu_video';
}

export function buildDownloadFilename(note, variant) {
  const base = pickBaseTitle(note || {});
  const parts = [base];

  if (variant?.resolutionLabel) {
    parts.push(sanitizeFilenamePart(variant.resolutionLabel, 16));
  }
  if (variant?.codecTag) {
    parts.push(sanitizeFilenamePart(variant.codecTag, 16));
  }

  const ext = sanitizeFilenamePart(variant?.ext || 'mp4', 8).toLowerCase() || 'mp4';
  const stem = parts.filter(Boolean).join('_');
  return `${stem}.${ext}`;
}
