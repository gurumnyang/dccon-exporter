'use strict';

const { nanoid } = require('nanoid');
const { downloadDcConPackage } = require('./dcconDownloader');
const { extractPackageId, formatBytes } = require('./utils');

const jobs = new Map();
const queue = [];
const sessionJobs = new Map();

const MAX_STORED_JOBS_PER_SESSION = 15;
const JOB_TTL_MS = 1000 * 60 * 30; // 30분

let processingJob = null;

function normalizeResizeOption(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  const rounded = Math.round(numeric);
  const clamped = Math.min(512, Math.max(16, rounded));
  return clamped;
}

function assertSessionId(sessionId) {
  if (!sessionId || typeof sessionId !== 'string' || !sessionId.trim()) {
    const error = new Error('세션 식별자가 필요합니다.');
    error.statusCode = 400;
    throw error;
  }
  return sessionId.trim();
}

function getSessionOrder(sessionId) {
  const existing = sessionJobs.get(sessionId);
  if (existing) {
    return existing;
  }
  const placeholder = [];
  sessionJobs.set(sessionId, placeholder);
  return placeholder;
}

function removeJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) {
    return false;
  }
  if (job.status === 'processing') {
    return false;
  }

  jobs.delete(jobId);

  const order = sessionJobs.get(job.sessionId);
  if (order) {
    const idx = order.indexOf(jobId);
    if (idx !== -1) {
      order.splice(idx, 1);
    }
    if (!order.length) {
      sessionJobs.delete(job.sessionId);
    }
  }

  let queueIndex = queue.indexOf(jobId);
  while (queueIndex !== -1) {
    queue.splice(queueIndex, 1);
    queueIndex = queue.indexOf(jobId);
  }

  return true;
}

function cleanupExpiredJobs() {
  const now = Date.now();
  for (const [jobId, job] of jobs) {
    if (job.status === 'processing' || job.status === 'queued') {
      continue;
    }

    const updatedAt = new Date(job.updatedAt || job.createdAt).getTime();
    if (Number.isNaN(updatedAt)) {
      continue;
    }

    if (now - updatedAt > JOB_TTL_MS) {
      removeJob(jobId);
    }
  }
}

function trimSessionJobs(sessionId) {
  const order = sessionJobs.get(sessionId);
  if (!order) {
    return;
  }

  while (order.length > MAX_STORED_JOBS_PER_SESSION) {
    const oldestId = order[0];
    if (!removeJob(oldestId)) {
      break;
    }
  }
}

function createJob(url, sessionId, options = {}) {
  const validSessionId = assertSessionId(sessionId);
  cleanupExpiredJobs();

  const trimmedUrl = url.trim();
  const packageId = extractPackageId(trimmedUrl);

  if (!packageId) {
    const error = new Error('유효한 디시콘 URL이 아닙니다.');
    error.statusCode = 400;
    throw error;
  }

  const resizeOption = normalizeResizeOption(options?.resize);

  const now = new Date().toISOString();
  const job = {
    id: nanoid(),
    sessionId: validSessionId,
    url: trimmedUrl,
    packageId,
    options: {
      resize: resizeOption,
    },
    status: 'queued',
    progress: 0,
    stage: 'queued',
    message: '다운로드 대기 중',
    createdAt: now,
    updatedAt: now,
    packageTitle: null,
    packageInfo: null,
    items: [],
    previews: [],
    zip: null,
    error: null,
  };

  jobs.set(job.id, job);

  const order = getSessionOrder(validSessionId);
  order.push(job.id);
  trimSessionJobs(validSessionId);

  queue.push(job.id);
  processQueue();

  return toPublicJob(job);
}

function processQueue() {
  if (processingJob || queue.length === 0) {
    return;
  }

  const nextJobId = queue.shift();
  const job = jobs.get(nextJobId);

  if (!job || job.status !== 'queued') {
    setImmediate(processQueue);
    return;
  }

  processingJob = job.id;
  runJob(job)
    .catch((error) => {
      console.error(error);
    })
    .finally(() => {
      processingJob = null;
      setImmediate(processQueue);
    });
}

async function runJob(job) {
  job.status = 'processing';
  job.stage = 'initializing';
  job.progress = 0.01;
  job.message = '작업을 준비하는 중입니다.';
  job.startedAt = new Date().toISOString();
  job.updatedAt = job.startedAt;

  const onProgress = ({ stage, progress, message }) => {
    job.stage = stage;
    job.progress = Math.min(1, Math.max(0, progress));
    job.message = message;
    job.updatedAt = new Date().toISOString();
  };

  try {
    const { info, items, previews, zip } = await downloadDcConPackage({
      packageId: job.packageId,
      onProgress,
      options: job.options,
    });

    job.packageTitle = info?.title ?? null;
    job.packageInfo = info ?? null;
    job.items = items;
    job.previews = previews;
    job.zip = zip;

    job.status = 'completed';
    job.stage = 'completed';
    job.progress = 1;
    job.message = '다운로드가 완료되었습니다.';
    job.completedAt = new Date().toISOString();
  } catch (error) {
    job.status = 'failed';
    job.stage = 'failed';
    job.error =
      error && typeof error.message === 'string'
        ? error.message
        : '알 수 없는 오류가 발생했습니다.';
    job.message = job.error;
  } finally {
    job.updatedAt = new Date().toISOString();
  }
}

function summariseItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item) => ({
    idx: item.idx,
    sort: item.sort,
    title: item.title,
    ext: item.ext,
    size: item.size,
    sizeLabel: formatBytes(item.size),
    mimeType: item.mimeType,
    resized: Boolean(item.resized),
    dataUrl:
      item.buffer && item.mimeType
        ? `data:${item.mimeType};base64,${item.buffer.toString('base64')}`
        : null,
  }));
}

function toPublicJob(job) {
  if (!job) {
    return null;
  }

  return {
    id: job.id,
    url: job.url,
    packageId: job.packageId,
    options: job.options,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    message: job.message,
    error: job.error,
    packageTitle: job.packageTitle,
    packageInfo: job.packageInfo,
    itemCount: job.items?.length ?? 0,
    items: summariseItems(job.items),
    previews: job.previews?.map((preview) => ({
      idx: preview.idx,
      title: preview.title,
      mimeType: preview.mimeType,
      dataUrl: preview.dataUrl,
    })),
    archive: job.zip
      ? {
          filename: job.zip.filename,
          size: job.zip.size,
          sizeLabel: formatBytes(job.zip.size),
        }
      : null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  };
}

function listJobs(sessionId) {
  const validSessionId = assertSessionId(sessionId);
  cleanupExpiredJobs();

  const order = sessionJobs.get(validSessionId);
  if (!order || !order.length) {
    return [];
  }

  const visibleJobs = [];
  for (let index = 0; index < order.length; ) {
    const jobId = order[index];
    const job = jobs.get(jobId);
    if (job) {
      visibleJobs.push(toPublicJob(job));
      index += 1;
    } else {
      order.splice(index, 1);
    }
  }

  if (!order.length) {
    sessionJobs.delete(validSessionId);
  }

  return visibleJobs;
}

function getJob(sessionId, jobId) {
  const validSessionId = assertSessionId(sessionId);
  cleanupExpiredJobs();

  const job = jobs.get(jobId);
  if (!job || job.sessionId !== validSessionId) {
    return null;
  }

  return toPublicJob(job);
}

function getJobDownloadData(sessionId, jobId) {
  const validSessionId = assertSessionId(sessionId);
  cleanupExpiredJobs();

  const job = jobs.get(jobId);
  if (!job || job.sessionId !== validSessionId) {
    const error = new Error('작업을 찾을 수 없습니다.');
    error.statusCode = 404;
    throw error;
  }

  if (job.status !== 'completed' || !job.zip) {
    const error = new Error('아직 다운로드할 수 없습니다.');
    error.statusCode = 409;
    throw error;
  }

  return job.zip;
}

module.exports = {
  createJob,
  listJobs,
  getJob,
  getJobDownloadData,
};
