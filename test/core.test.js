import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { isSupportedXhsUrl, extractNoteIdFromUrl } from '../src/core/url.js';
import { buildDownloadFilename, sanitizeFilenamePart } from '../src/core/filename.js';
import { parseExtractedPage } from '../src/core/parse.js';
import { getResolutionLabel } from '../src/core/parsers/video.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const efSample = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/video-ef-sample.json'), 'utf8')
);

test('URL recognition and noteId extraction', () => {
  assert.equal(isSupportedXhsUrl('https://www.xiaohongshu.com/explore/6901ec39000000000700238c?xsec_token=abc'), true);
  assert.equal(isSupportedXhsUrl('https://www.rednote.com/discovery/item/abc123'), true);
  assert.equal(isSupportedXhsUrl('https://www.google.com/'), false);
  assert.equal(isSupportedXhsUrl('chrome://extensions/'), false);

  assert.equal(extractNoteIdFromUrl('https://www.xiaohongshu.com/explore/6901ec39000000000700238c?xsec_token=x'), '6901ec39000000000700238c');
  assert.equal(extractNoteIdFromUrl('https://www.xiaohongshu.com/discovery/item/abcd1234'), 'abcd1234');
  assert.equal(extractNoteIdFromUrl('https://www.xiaohongshu.com/user/profile/u123/note999'), 'note999');
  assert.equal(extractNoteIdFromUrl('https://www.xiaohongshu.com/explore'), null);
});

test('Resolution label uses short edge for vertical videos', () => {
  assert.equal(getResolutionLabel(1080, 1920), '1080p');
  assert.equal(getResolutionLabel(720, 1280), '720p');
  assert.equal(getResolutionLabel(1920, 1080), '1080p');
  assert.equal(getResolutionLabel(2160, 3840), '4K');
  assert.equal(getResolutionLabel(0, 0), '');
});

test('Parse real EF4/EF5 vertical video sample and recommend H.264', () => {
  const parsed = parseExtractedPage(efSample);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.noteType, 'video');
  assert.equal(parsed.supported, true);
  assert.equal(parsed.assets.length, 1);

  const variants = parsed.assets[0].variants;
  assert.equal(variants.length, 3);

  // 按分辨率从高到低排，同分辨率 H.264 排在 H.265 前面
  assert.equal(variants[0].resolutionLabel, '1080p');
  assert.equal(variants[0].codec, 'H.265');
  assert.equal(variants[0].recommended, false);

  assert.equal(variants[1].resolutionLabel, '720p');
  assert.equal(variants[1].codec, 'H.264');
  assert.equal(variants[1].recommended, true); // 兼容性最好优先

  assert.equal(variants[2].resolutionLabel, '720p');
  assert.equal(variants[2].codec, 'H.265');
  assert.equal(variants[2].recommended, false);
});

test('Parse mediaV2 JSON fallback and originVideoKey', () => {
  const sample = {
    meta: { urlNoteId: 'n1' },
    initialState: {
      matchedId: 'n1',
      matchedEntry: {
        note: {
          noteId: 'n1',
          title: '测试标题',
          type: 'video',
          video: {
            capa: { duration: 15 },
            consumer: { originVideoKey: '/raw/video_origin.mp4' },
            media: { stream: {} },
            mediaV2: JSON.stringify({
              stream: {
                h264: [
                  {
                    width: 1920,
                    height: 1080,
                    avg_bitrate: 3000000,
                    size: 5000000,
                    format: 'mp4',
                    master_url: 'https://sns-video-qc.xhscdn.com/a.mp4',
                    backup_urls: ['https://sns-bak-v6.xhscdn.com/a.mp4']
                  }
                ]
              }
            })
          }
        }
      }
    }
  };

  const parsed = parseExtractedPage(sample);
  assert.equal(parsed.ok, true);
  const variants = parsed.assets[0].variants;
  assert.equal(variants.length, 2);
  assert.equal(variants[0].codec, 'H.264');
  assert.equal(variants[0].recommended, true);
  assert.equal(variants[1].kind, 'origin');
  assert.equal(variants[1].url, 'https://sns-video-bd.xhscdn.com/raw/video_origin.mp4');
});

test('Detect image and live photo notes as unsupported in v1 (architecture ready)', () => {
  const imageSample = {
    meta: { urlNoteId: 'img1' },
    pinia: {
      matchedId: 'img1',
      matchedEntry: {
        note: {
          noteId: 'img1',
          title: '好看的图集',
          type: 'normal',
          imageList: [{ livePhoto: false }, { livePhoto: false }]
        }
      }
    }
  };
  const parsedImg = parseExtractedPage(imageSample);
  assert.equal(parsedImg.ok, true);
  assert.equal(parsedImg.noteType, 'image');
  assert.equal(parsedImg.supported, false);
  assert.equal(parsedImg.meta.imageCount, 2);

  const liveSample = {
    meta: { urlNoteId: 'live1' },
    pinia: {
      matchedId: 'live1',
      matchedEntry: {
        note: {
          noteId: 'live1',
          title: '实况图测试',
          type: 'normal',
          imageList: [{ livePhoto: true }, { livePhoto: false }]
        }
      }
    }
  };
  const parsedLive = parseExtractedPage(liveSample);
  assert.equal(parsedLive.noteType, 'live_photo');
  assert.equal(parsedLive.supported, false);
  assert.equal(parsedLive.meta.liveCount, 1);
});

test('Filename sanitization and fallback rules', () => {
  assert.equal(sanitizeFilenamePart('Hello/World:Test*?<>|\nLine2'), 'Hello World Test Line2');

  const parsed = parseExtractedPage(efSample);
  const rec = parsed.assets[0].variants.find((v) => v.recommended);
  // title 和 desc 都为空时，回退到 作者_noteId前8位
  assert.equal(buildDownloadFilename(parsed, rec), 'Rhinowalk犀牛·漫步_6901ec39_720p_H264.mp4');

  // 有 title 时优先用 title
  assert.equal(
    buildDownloadFilename({ title: '骑行装备推荐🚴‍♂️', noteId: 'abc' }, rec),
    '骑行装备推荐🚴‍♂️_720p_H264.mp4'
  );
});
