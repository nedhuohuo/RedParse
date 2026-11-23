const CODEC_MAP = {
  h264: { display: 'H.264', tag: 'H264', compatRank: 1, note: '兼容性最好' },
  avc: { display: 'H.264', tag: 'H264', compatRank: 1, note: '兼容性最好' },
  ef4: { display: 'H.264', tag: 'H264', compatRank: 1, note: '兼容性最好' },

  h265: { display: 'H.265', tag: 'H265', compatRank: 2, note: '体积更小，部分旧设备/软件可能不兼容' },
  hevc: { display: 'H.265', tag: 'H265', compatRank: 2, note: '体积更小，部分旧设备/软件可能不兼容' },
  ef5: { display: 'H.265', tag: 'H265', compatRank: 2, note: '体积更小，部分旧设备/软件可能不兼容' },

  h266: { display: 'H.266', tag: 'H266', compatRank: 3, note: '较新编码，部分播放器可能不支持' },
  vvc: { display: 'H.266', tag: 'H266', compatRank: 3, note: '较新编码，部分播放器可能不支持' },
  ef6: { display: 'H.266', tag: 'H266', compatRank: 3, note: '较新编码，部分播放器可能不支持' },

  av1: { display: 'AV1', tag: 'AV1', compatRank: 3, note: '较新编码，部分播放器可能不支持' },
  ef7: { display: 'AV1', tag: 'AV1', compatRank: 3, note: '较新编码，部分播放器可能不支持' },

  original: { display: '原画', tag: 'ORIGIN', compatRank: 4, note: '原始上传文件，编码取决于作者上传格式' }
};

export function normalizeCodec(rawKey, rawCodecField) {
  const candidates = [rawCodecField, rawKey].filter((v) => typeof v === 'string' && v.trim());
  for (const candidate of candidates) {
    const key = candidate.trim().toLowerCase();
    if (CODEC_MAP[key]) {
      return {
        raw: candidate.trim(),
        ...CODEC_MAP[key]
      };
    }
  }
  const fallback = candidates[0] ? candidates[0].trim() : 'UNKNOWN';
  return {
    raw: fallback,
    display: fallback.toUpperCase(),
    tag: fallback.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'VIDEO',
    compatRank: 5,
    note: ''
  };
}

export function getResolutionLabel(width, height) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (!w || !h) return '';
  const shortEdge = Math.min(w, h);
  if (shortEdge >= 2100) return '4K';
  if (shortEdge >= 1400) return '2K';
  if (shortEdge >= 1060) return '1080p';
  if (shortEdge >= 700) return '720p';
  if (shortEdge >= 520) return '540p';
  if (shortEdge >= 460) return '480p';
  if (shortEdge >= 340) return '360p';
  return `${shortEdge}p`;
}

function normalizeStreamItem(item, codecKey) {
  if (!item || typeof item !== 'object') return null;

  const masterUrl = item.masterUrl || item.master_url || '';
  const rawBackups = item.backupUrls || item.backup_urls || [];
  const backupUrls = Array.isArray(rawBackups)
    ? rawBackups.filter((u) => typeof u === 'string' && u.startsWith('http'))
    : [];

  const primaryUrl = typeof masterUrl === 'string' && masterUrl.startsWith('http')
    ? masterUrl
    : backupUrls[0] || '';

  if (!primaryUrl) return null;

  const dedupedBackups = backupUrls.filter((u) => u !== primaryUrl);
  const width = Number(item.width) || 0;
  const height = Number(item.height) || 0;
  const codec = normalizeCodec(codecKey, item.videoCodec || item.video_codec);
  const resolutionLabel = getResolutionLabel(width, height);
  const bitrate = Number(item.avgBitrate || item.avg_bitrate || item.videoBitrate || item.video_bitrate) || 0;
  const sizeBytes = Number(item.size) || 0;
  const durationMs = Number(item.duration || item.videoDuration || item.video_duration) || 0;
  const fps = Number(item.fps) || 0;
  const ext = (item.format || 'mp4').toLowerCase();
  const streamType = item.streamType ?? item.stream_type ?? null;
  const streamDesc = item.streamDesc || item.stream_desc || item.qualityType || item.quality_type || '';

  return {
    id: `${codec.tag}_${width}x${height}_${streamType ?? streamDesc ?? sizeBytes}`,
    kind: 'stream',
    url: primaryUrl,
    backupUrls: dedupedBackups,
    width,
    height,
    pixels: width * height,
    resolutionLabel,
    dimensionsLabel: width && height ? `${width}×${height}` : '',
    codec: codec.display,
    codecRaw: codec.raw,
    codecTag: codec.tag,
    compatRank: codec.compatRank,
    compatibilityNote: codec.note,
    bitrate,
    sizeBytes,
    durationMs,
    fps,
    ext,
    streamDesc,
    recommended: false
  };
}

function extractStreamObject(video) {
  const directStream = video?.media?.stream;
  if (directStream && typeof directStream === 'object') {
    const hasEntries = Object.values(directStream).some(
      (list) => Array.isArray(list) && list.length > 0
    );
    if (hasEntries) return directStream;
  }

  // 兜底：解析 video.mediaV2 JSON 字符串
  if (typeof video?.mediaV2 === 'string' && video.mediaV2.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(video.mediaV2);
      if (parsed?.stream && typeof parsed.stream === 'object') {
        return parsed.stream;
      }
    } catch {
      // 忽略 mediaV2 解析失败
    }
  }

  return null;
}

function dedupeVariants(variants) {
  const seen = new Set();
  const out = [];
  for (const v of variants) {
    const key = v.url.split('?')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function sortVariants(variants) {
  return [...variants].sort((a, b) => {
    // 原画没有宽高时排在最前面还是最后面？排在已知分辨率后面，避免抢占默认位
    if (b.pixels !== a.pixels) return b.pixels - a.pixels;
    if (a.compatRank !== b.compatRank) return a.compatRank - b.compatRank;
    if (b.bitrate !== a.bitrate) return b.bitrate - a.bitrate;
    return b.sizeBytes - a.sizeBytes;
  });
}

function markRecommended(variants) {
  if (!variants.length) return variants;

  // 默认选择“兼容性最好”优先：优先 H.264 (compatRank === 1) 中分辨率最高、码率最高的版本
  // 如果没有 H.264，则按 compatRank 从小到大降级
  const ranked = [...variants].sort((a, b) => {
    if (a.compatRank !== b.compatRank) return a.compatRank - b.compatRank;
    if (b.pixels !== a.pixels) return b.pixels - a.pixels;
    if (b.bitrate !== a.bitrate) return b.bitrate - a.bitrate;
    return b.sizeBytes - a.sizeBytes;
  });

  const bestId = ranked[0].id;
  return variants.map((v) => ({
    ...v,
    recommended: v.id === bestId
  }));
}

export function parseVideoNote(note) {
  const video = note?.video;
  if (!video || typeof video !== 'object') {
    return [];
  }

  const rawVariants = [];
  const streamObj = extractStreamObject(video);
  if (streamObj) {
    for (const [codecKey, list] of Object.entries(streamObj)) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const normalized = normalizeStreamItem(item, codecKey);
        if (normalized) rawVariants.push(normalized);
      }
    }
  }

  // 如果存在 originVideoKey，追加原画选项
  const originKey = video?.consumer?.originVideoKey;
  if (typeof originKey === 'string' && originKey.trim()) {
    const cleanKey = originKey.trim().replace(/^\/+/, '');
    const codec = normalizeCodec('original');
    rawVariants.push({
      id: `ORIGIN_${cleanKey.slice(-12)}`,
      kind: 'origin',
      url: `https://sns-video-bd.xhscdn.com/${cleanKey}`,
      backupUrls: [`http://sns-video-bd.xhscdn.com/${cleanKey}`],
      width: 0,
      height: 0,
      pixels: 0,
      resolutionLabel: '原画',
      dimensionsLabel: '原始上传',
      codec: codec.display,
      codecRaw: 'originVideoKey',
      codecTag: codec.tag,
      compatRank: codec.compatRank,
      compatibilityNote: codec.note,
      bitrate: 0,
      sizeBytes: 0,
      durationMs: (Number(video?.capa?.duration) || 0) * 1000,
      fps: 0,
      ext: 'mp4',
      streamDesc: 'origin',
      recommended: false
    });
  }

  const unique = dedupeVariants(rawVariants);
  if (!unique.length) return [];

  const sorted = sortVariants(unique);
  const withRecommended = markRecommended(sorted);

  const durationMs =
    withRecommended.find((v) => v.durationMs > 0)?.durationMs ||
    (Number(video?.capa?.duration) || Number(video?.media?.video?.duration) || 0) * 1000;

  return [
    {
      id: String(video?.media?.videoId || note?.noteId || 'video_0'),
      kind: 'video',
      durationMs,
      variants: withRecommended
    }
  ];
}
