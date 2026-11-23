const SUPPORTED_HOSTS = ['xiaohongshu.com', 'rednote.com'];

const NOTE_ID_PATTERNS = [
  /\/explore\/([a-zA-Z0-9]+)/,
  /\/discovery\/item\/([a-zA-Z0-9]+)/,
  /\/user\/profile\/[^/]+\/([a-zA-Z0-9]+)/,
  /\/notes?\/([a-zA-Z0-9]+)/
];

export function isSupportedXhsUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const { hostname, protocol } = new URL(rawUrl);
    if (protocol !== 'http:' && protocol !== 'https:') return false;
    return SUPPORTED_HOSTS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}

export function extractNoteIdFromUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const { pathname } = new URL(rawUrl);
    return extractNoteIdFromPathname(pathname);
  } catch {
    return extractNoteIdFromPathname(rawUrl);
  }
}

export function extractNoteIdFromPathname(pathname) {
  if (!pathname || typeof pathname !== 'string') return null;
  for (const re of NOTE_ID_PATTERNS) {
    const match = pathname.match(re);
    if (match && match[1] && match[1] !== 'undefined') {
      return match[1];
    }
  }
  return null;
}

export function isValidNoteId(id) {
  return typeof id === 'string' && id.trim().length > 0 && id !== 'undefined' && id !== 'null';
}
