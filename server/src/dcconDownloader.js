'use strict';

const archiver = require('archiver');
const sharp = require('sharp');
const { buildArchiveFilename, sanitizeFilename } = require('./utils');

const BASE_URL = 'https://dccon.dcinside.com';
const IMAGE_ENDPOINT = 'https://dcimg5.dcinside.com/dccon.php?no=';
const REFERER = `${BASE_URL}/`;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PREVIEW_COUNT = 4;
const RESIZABLE_FORMATS = new Set(['png', 'jpeg', 'jpg', 'webp']);
const MIME_BY_FORMAT = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

function canResize(ext, mimeType) {
  const normalizedExt = (ext || '').toLowerCase();
  if (RESIZABLE_FORMATS.has(normalizedExt)) {
    return true;
  }
  if (!mimeType) {
    return false;
  }
  const lowerMime = mimeType.toLowerCase();
  return Object.values(MIME_BY_FORMAT).includes(lowerMime);
}

async function applyResize(buffer, ext, mimeType, size) {
  if (!size || !canResize(ext, mimeType)) {
    return { buffer, ext, mimeType, resized: false };
  }

  try {
    const { data, info } = await sharp(buffer)
      .resize(size, size, {
        fit: 'contain',
        withoutEnlargement: false,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .toBuffer({ resolveWithObject: true });

    const format = (info?.format || ext || '').toLowerCase();
    const normalizedFormat = format === 'jpeg' ? 'jpg' : format;
    const newExt = normalizedFormat || ext || 'png';
    const newMime = MIME_BY_FORMAT[normalizedFormat] || mimeType || 'image/png';

    return {
      buffer: data,
      ext: newExt,
      mimeType: newMime,
      resized: true,
    };
  } catch (error) {
    console.warn('이미지 리사이즈 실패:', error.message);
    return { buffer, ext, mimeType, resized: false };
  }
}

async function initializeSession() {
  const response = await fetch(`${BASE_URL}/`, {
    headers: {
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'ko,en-US;q=0.9,en;q=0.8',
      'User-Agent': USER_AGENT,
      'Upgrade-Insecure-Requests': '1',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error('초기 연결에 실패했습니다.');
  }

  const rawSetCookies = getSetCookies(response.headers);
  const parsedCookies = rawSetCookies
    .filter(Boolean)
    .map((cookie) => cookie.split(';')[0]);
  const cookieHeader = parsedCookies.join('; ');
  const csrfCookie = parsedCookies.find((cookie) => cookie.startsWith('ci_c='));

  if (!csrfCookie) {
    throw new Error('인증 토큰을 가져오지 못했습니다.');
  }

  const csrfToken = csrfCookie.split('=')[1];
  return { cookieHeader, csrfToken };
}

function getSetCookies(headers) {
  if (!headers) {
    return [];
  }
  if (typeof headers.getSetCookie === 'function') {
    const values = headers.getSetCookie();
    if (Array.isArray(values)) {
      return values;
    }
    return values ? [values] : [];
  }
  const value = headers.get('set-cookie');
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

async function fetchPackageDetail(session, packageId) {
  const body = new URLSearchParams({
    ci_t: session.csrfToken,
    package_idx: packageId,
    code: '',
  });

  const response = await fetch(`${BASE_URL}/index/package_detail`, {
    method: 'POST',
    headers: {
      Accept: '*/*',
      'Accept-Language': 'ko,en-US;q=0.9,en;q=0.8',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Cookie: session.cookieHeader,
      Referer: REFERER,
      'User-Agent': USER_AGENT,
      'X-Requested-With': 'XMLHttpRequest',
    },
    body,
  });

  if (!response.ok) {
    throw new Error('디시콘 정보를 불러오지 못했습니다.');
  }

  const data = await response.json();

  if (!data || !data.detail || !Array.isArray(data.detail)) {
    throw new Error('디시콘 정보 형식이 올바르지 않습니다.');
  }

  return data;
}

async function fetchImageBuffer(session, path) {
  const response = await fetch(`${IMAGE_ENDPOINT}${path}`, {
    headers: {
      Accept:
        'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Accept-Language': 'ko,en-US;q=0.9,en;q=0.8',
      Cookie: session.cookieHeader,
      Referer: REFERER,
      'User-Agent': USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error('이미지를 다운로드하지 못했습니다.');
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const mimeType = response.headers.get('content-type') || 'image/png';
  return { buffer, mimeType };
}

function createZipBuffer(items) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks = [];

    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', (error) => reject(error));

    items.forEach((item) => {
      const paddedSort = String(item.sort || item.index || items.indexOf(item))
        .padStart(3, '0');
      const safeTitle = sanitizeFilename(item.title, `dccon_${paddedSort}`);
      const extension = item.ext || 'png';
      archive.append(item.buffer, {
        name: `${paddedSort}_${safeTitle}.${extension}`,
      });
    });

    archive.finalize();
  });
}

async function downloadDcConPackage({ packageId, onProgress, options = {} }) {
  const session = await initializeSession();
  onProgress?.({
    stage: 'session',
    progress: 0.05,
    message: '세션을 초기화하는 중입니다.',
  });

  const detail = await fetchPackageDetail(session, packageId);
  onProgress?.({
    stage: 'detail',
    progress: 0.15,
    message: '디시콘 상세 정보를 불러왔습니다.',
  });

  const resizeOption =
    typeof options.resize === 'number' && options.resize > 0
      ? options.resize
      : null;

  const items = [];
  for (let index = 0; index < detail.detail.length; index += 1) {
    const item = detail.detail[index];
    const { buffer, mimeType } = await fetchImageBuffer(session, item.path);
    const processed = await applyResize(
      buffer,
      item.ext,
      mimeType,
      resizeOption,
    );

    items.push({
      idx: item.idx,
      packageIdx: item.package_idx,
      title: item.title,
      sort: Number(item.sort) || index + 1,
      ext: processed.ext || item.ext || 'png',
      path: item.path,
      buffer: processed.buffer,
      mimeType: processed.mimeType || mimeType,
      size: processed.buffer.length,
      resized: processed.resized,
    });

    onProgress?.({
      stage: 'image',
      progress: 0.15 + ((index + 1) / detail.detail.length) * 0.75,
      message: `${index + 1}/${detail.detail.length}개의 이미지를 저장했습니다.${
        processed.resized ? ' (리사이즈 적용)' : ''
      }`,
    });
  }

  const archiveFilename = buildArchiveFilename(detail.info?.title, packageId);
  const zipBuffer = await createZipBuffer(items);
  onProgress?.({
    stage: 'archive',
    progress: 0.95,
    message: 'ZIP 파일을 생성했습니다.',
  });

  const previews = items.slice(0, PREVIEW_COUNT).map((item) => ({
    idx: item.idx,
    title: item.title,
    mimeType: item.mimeType,
    dataUrl: `data:${item.mimeType};base64,${item.buffer.toString('base64')}`,
  }));

  onProgress?.({
    stage: 'complete',
    progress: 1,
    message: '모든 작업이 완료되었습니다.',
  });

  return {
    info: detail.info,
    items,
    previews,
    options: {
      resize: resizeOption,
    },
    zip: {
      buffer: zipBuffer,
      filename: archiveFilename,
      size: zipBuffer.length,
    },
  };
}

module.exports = {
  downloadDcConPackage,
};
