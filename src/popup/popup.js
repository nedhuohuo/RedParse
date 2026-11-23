import { extractPageData } from '../extract/page-extractor.js';
import { isSupportedXhsUrl } from '../core/url.js';
import { parseExtractedPage } from '../core/parse.js';
import { buildDownloadFilename, sanitizeFilenamePart } from '../core/filename.js';

const SAVE_AS_STORAGE_KEY = 'redparse_save_as';

const mainViewEl = document.getElementById('mainView');
const downloadBarEl = document.getElementById('downloadBar');
const filenameInputEl = document.getElementById('filenameInput');
const saveAsCheckboxEl = document.getElementById('saveAsCheckbox');
const downloadBtnEl = document.getElementById('downloadBtn');
const refreshBtnEl = document.getElementById('refreshBtn');
const statusBannerEl = document.getElementById('statusBanner');

let currentParsed = null;
let currentRawData = null;
let selectedVariant = null;
let userEditedFilename = false;
let activeJobId = null;

// 恢复“每次询问保存位置”偏好
try {
  saveAsCheckboxEl.checked = localStorage.getItem(SAVE_AS_STORAGE_KEY) === '1';
} catch {
  saveAsCheckboxEl.checked = false;
}

saveAsCheckboxEl.addEventListener('change', () => {
  try {
    localStorage.setItem(SAVE_AS_STORAGE_KEY, saveAsCheckboxEl.checked ? '1' : '0');
  } catch {
    // 忽略存储不可用
  }
});

filenameInputEl.addEventListener('input', () => {
  userEditedFilename = true;
});

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatDuration(ms) {
  const totalSec = Math.round((Number(ms) || 0) / 1000);
  if (!totalSec) return '';
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (!n) return '';
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

function formatBitrate(bps) {
  const n = Number(bps) || 0;
  if (!n) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} Mbps`;
  return `${Math.round(n / 1000)} kbps`;
}

function showBanner(type, text) {
  statusBannerEl.className = `status-banner ${type}`;
  statusBannerEl.textContent = text;
}

function hideBanner() {
  statusBannerEl.className = 'status-banner hidden';
  statusBannerEl.textContent = '';
}

function renderState(title, desc, options = {}) {
  downloadBarEl.classList.add('hidden');
  const debugBtnHtml = options.allowCopyDebug
    ? `<div class="state-actions"><button id="copyDebugBtn" class="btn-secondary">复制调试信息</button></div>`
    : '';

  mainViewEl.innerHTML = `
    <div class="state-box">
      <p class="state-title">${escapeHtml(title)}</p>
      ${desc ? `<p class="state-desc">${escapeHtml(desc)}</p>` : ''}
      ${debugBtnHtml}
    </div>
  `;

  if (options.allowCopyDebug) {
    const btn = document.getElementById('copyDebugBtn');
    btn?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(currentRawData || {}, null, 2));
        btn.textContent = '已复制调试信息';
      } catch {
        btn.textContent = '复制失败';
      }
    });
  }
}

function selectVariant(variant) {
  selectedVariant = variant;

  const cards = mainViewEl.querySelectorAll('.variant-card');
  cards.forEach((card) => {
    const isSelected = card.dataset.variantId === variant.id;
    card.classList.toggle('selected', isSelected);
    const radio = card.querySelector('input[type="radio"]');
    if (radio) radio.checked = isSelected;
  });

  if (!userEditedFilename && currentParsed) {
    filenameInputEl.value = buildDownloadFilename(currentParsed, variant);
  }
}

function renderVideoNote(parsed) {
  const asset = parsed.assets[0];
  const variants = asset.variants;
  const defaultVariant = variants.find((v) => v.recommended) || variants[0];

  const displayTitle =
    parsed.title ||
    (parsed.desc ? parsed.desc.split(/\r?\n/)[0].slice(0, 50) : '') ||
    (parsed.author ? `${parsed.author} 的视频` : `视频笔记 ${parsed.noteId}`);

  const metaParts = [];
  if (parsed.author) metaParts.push(`作者：${parsed.author}`);
  const dur = formatDuration(asset.durationMs);
  if (dur) metaParts.push(`时长 ${dur}`);

  const listHtml = variants
    .map((v) => {
      const specs = [
        v.dimensionsLabel,
        formatBitrate(v.bitrate),
        formatSize(v.sizeBytes),
        v.fps ? `${v.fps} fps` : ''
      ]
        .filter(Boolean)
        .join(' · ');

      const codecClass = v.compatRank === 1 ? 'codec-pill h264' : 'codec-pill';
      const recHtml = v.recommended
        ? `<span class="rec-badge">推荐 · 兼容性最好</span>`
        : '';

      return `
        <label class="variant-card" data-variant-id="${escapeHtml(v.id)}">
          <input type="radio" name="variant" value="${escapeHtml(v.id)}" />
          <div class="variant-body">
            <div class="variant-top">
              <span class="res-label">${escapeHtml(v.resolutionLabel || v.dimensionsLabel || '视频')}</span>
              <span class="${codecClass}">${escapeHtml(v.codec)}</span>
              ${recHtml}
            </div>
            ${specs ? `<div class="variant-specs">${escapeHtml(specs)}</div>` : ''}
            ${v.compatibilityNote && !v.recommended ? `<div class="variant-note">${escapeHtml(v.compatibilityNote)}</div>` : ''}
          </div>
        </label>
      `;
    })
    .join('');

  mainViewEl.innerHTML = `
    <div class="note-header">
      <div class="note-title">${escapeHtml(displayTitle)}</div>
      ${metaParts.length ? `<div class="note-meta">${escapeHtml(metaParts.join(' · '))}</div>` : ''}
    </div>
    <div class="section-label">选择要下载的视频版本（共 ${variants.length} 个）</div>
    <div class="variant-list">${listHtml}</div>
  `;

  mainViewEl.querySelectorAll('.variant-card input[type="radio"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const v = variants.find((item) => item.id === radio.value);
      if (v) selectVariant(v);
    });
  });

  userEditedFilename = false;
  selectVariant(defaultVariant);
  downloadBarEl.classList.remove('hidden');
  downloadBtnEl.disabled = false;
}

function sanitizeUserFilename(rawName, fallbackExt = 'mp4') {
  const trimmed = (rawName || '').trim();
  if (!trimmed) {
    return buildDownloadFilename(currentParsed, selectedVariant);
  }
  const dotIdx = trimmed.lastIndexOf('.');
  if (dotIdx > 0 && dotIdx < trimmed.length - 1) {
    const stem = sanitizeFilenamePart(trimmed.slice(0, dotIdx), 100);
    const ext = sanitizeFilenamePart(trimmed.slice(dotIdx + 1), 10).toLowerCase();
    if (stem && ext) return `${stem}.${ext}`;
  }
  const stem = sanitizeFilenamePart(trimmed, 100) || 'xiaohongshu_video';
  return `${stem}.${fallbackExt}`;
}

async function inspectCurrentTab() {
  hideBanner();
  currentParsed = null;
  currentRawData = null;
  selectedVariant = null;
  renderState('正在读取当前笔记…', '');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) {
      renderState('无法访问当前标签页', '请切回小红书页面后重试。');
      return;
    }

    if (!isSupportedXhsUrl(tab.url)) {
      renderState('请在小红书网页版使用', '打开小红书（xiaohongshu.com）视频笔记后，再点击本插件。');
      return;
    }

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: extractPageData
    });

    currentRawData = result;
    const parsed = parseExtractedPage(result);
    currentParsed = parsed;

    if (!parsed.ok) {
      if (parsed.reason === 'NO_NOTE_DATA') {
        renderState(
          '未检测到已打开的笔记',
          '请先点开一篇具体的视频笔记（或刷新当前笔记页）后再试。',
          { allowCopyDebug: true }
        );
      } else {
        renderState(
          '未能解析到视频流',
          '小红书可能刚更新了数据结构，或当前笔记尚未加载完成。请刷新页面重试。',
          { allowCopyDebug: true }
        );
      }
      return;
    }

    if (!parsed.supported) {
      if (parsed.noteType === 'live_photo') {
        renderState(
          '当前是实况图笔记',
          `检测到 ${parsed.meta?.imageCount || 0} 张图片（含 ${parsed.meta?.liveCount || 0} 张实况图）。当前版本仅支持视频下载，实况图功能将在后续版本支持。`
        );
      } else if (parsed.noteType === 'image') {
        renderState(
          '当前是图文笔记',
          `检测到 ${parsed.meta?.imageCount || 0} 张图片。当前版本仅支持视频下载，图文功能将在后续版本支持。`
        );
      } else {
        renderState('暂不支持该类型笔记', '请打开视频笔记后再使用。', { allowCopyDebug: true });
      }
      return;
    }

    renderVideoNote(parsed);
  } catch (err) {
    renderState(
      '读取页面失败',
      err?.message || '请刷新当前页面后重试。',
      { allowCopyDebug: true }
    );
  }
}

downloadBtnEl.addEventListener('click', async () => {
  if (!selectedVariant) return;

  const filename = sanitizeUserFilename(filenameInputEl.value, selectedVariant.ext || 'mp4');
  filenameInputEl.value = filename;

  const urls = [selectedVariant.url, ...(selectedVariant.backupUrls || [])];
  activeJobId = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  downloadBtnEl.disabled = true;
  showBanner('info', '正在发起下载…');

  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'DOWNLOAD_VARIANT',
      jobId: activeJobId,
      urls,
      filename,
      saveAs: saveAsCheckboxEl.checked
    });

    if (!resp?.ok) {
      showBanner('error', `下载失败：${resp?.error || '未知错误'}`);
      downloadBtnEl.disabled = false;
    }
  } catch (err) {
    showBanner('error', `通信失败：${err?.message || err}`);
    downloadBtnEl.disabled = false;
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'DOWNLOAD_STATUS' || message.jobId !== activeJobId) return;

  if (message.status === 'started') {
    showBanner('info', '已开始下载，可在浏览器下载列表查看进度…');
  } else if (message.status === 'retrying') {
    showBanner('info', `主地址失败，正在尝试备用地址（${message.attempt}/${message.total}）…`);
  } else if (message.status === 'complete') {
    showBanner('success', '下载完成！');
    downloadBtnEl.disabled = false;
  } else if (message.status === 'canceled') {
    showBanner('info', '已取消下载。');
    downloadBtnEl.disabled = false;
  } else if (message.status === 'failed') {
    showBanner('error', `下载失败：${message.error || '请刷新页面后重试'}`);
    downloadBtnEl.disabled = false;
  }
});

refreshBtnEl.addEventListener('click', inspectCurrentTab);

inspectCurrentTab();
