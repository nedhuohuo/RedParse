const activeDownloads = new Map();

function notifyPopup(payload) {
  chrome.runtime.sendMessage(payload).catch(() => {
    // popup 可能已关闭，忽略无接收方错误
  });
}

async function startAttempt(job) {
  const url = job.urls[job.attemptIndex];
  if (!url) {
    notifyPopup({
      type: 'DOWNLOAD_STATUS',
      jobId: job.jobId,
      status: 'failed',
      error: job.lastError || '所有地址均下载失败'
    });
    return { ok: false, error: job.lastError || '没有可用的下载地址' };
  }

  try {
    const downloadId = await chrome.downloads.download({
      url,
      filename: job.filename,
      saveAs: Boolean(job.saveAs),
      conflictAction: 'uniquify'
    });

    activeDownloads.set(downloadId, job);
    notifyPopup({
      type: 'DOWNLOAD_STATUS',
      jobId: job.jobId,
      status: job.attemptIndex === 0 ? 'started' : 'retrying',
      attempt: job.attemptIndex + 1,
      total: job.urls.length
    });

    return { ok: true, downloadId };
  } catch (err) {
    job.lastError = err?.message || String(err);
    job.attemptIndex += 1;
    if (job.attemptIndex < job.urls.length) {
      return startAttempt(job);
    }
    notifyPopup({
      type: 'DOWNLOAD_STATUS',
      jobId: job.jobId,
      status: 'failed',
      error: job.lastError
    });
    return { ok: false, error: job.lastError };
  }
}

chrome.downloads.onChanged.addListener((delta) => {
  const job = activeDownloads.get(delta.id);
  if (!job) return;

  if (delta.state?.current === 'complete') {
    activeDownloads.delete(delta.id);
    notifyPopup({
      type: 'DOWNLOAD_STATUS',
      jobId: job.jobId,
      status: 'complete'
    });
    return;
  }

  if (delta.state?.current === 'interrupted') {
    activeDownloads.delete(delta.id);
    const reason = delta.error?.current || 'DOWNLOAD_INTERRUPTED';

    // 用户主动取消（如关闭另存为弹窗），不做重试
    if (reason === 'USER_CANCELED') {
      notifyPopup({
        type: 'DOWNLOAD_STATUS',
        jobId: job.jobId,
        status: 'canceled'
      });
      return;
    }

    job.lastError = reason;
    job.attemptIndex += 1;

    if (job.attemptIndex < job.urls.length) {
      startAttempt(job);
    } else {
      notifyPopup({
        type: 'DOWNLOAD_STATUS',
        jobId: job.jobId,
        status: 'failed',
        error: reason
      });
    }
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'DOWNLOAD_VARIANT') return false;

  const urls = Array.isArray(message.urls)
    ? message.urls.filter((u) => typeof u === 'string' && u.startsWith('http'))
    : [];

  if (!urls.length) {
    sendResponse({ ok: false, error: '没有有效的下载地址' });
    return false;
  }

  const job = {
    jobId: message.jobId || String(Date.now()),
    urls,
    filename: message.filename || 'xiaohongshu_video.mp4',
    saveAs: Boolean(message.saveAs),
    attemptIndex: 0,
    lastError: null
  };

  startAttempt(job).then(sendResponse);
  return true; // 保持通道以异步回复
});
