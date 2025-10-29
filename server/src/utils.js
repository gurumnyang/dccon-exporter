'use strict';

const FILENAME_SANITIZE_REGEX = /[\\/:*?"<>|\u0000-\u001f]/g;
const WHITESPACE_REGEX = /\s+/g;

function extractPackageId(input) {
  if (!input) {
    return null;
  }

  const trimmed = String(input).trim();
  if (!trimmed) {
    return null;
  }

  const queryMatch = trimmed.match(/(?:package_(?:idx|id)|idx|no)=([0-9]+)/i);
  if (queryMatch) {
    return queryMatch[1];
  }

  try {
    const asUrl = new URL(
      trimmed.startsWith('http') ? trimmed : `https://${trimmed}`,
    );
    const hash = asUrl.hash?.replace(/^#/, '');
    if (hash && /^[0-9]{3,}$/.test(hash)) {
      return hash;
    }
    for (const key of ['package_idx', 'package_id', 'idx', 'no', 'id']) {
      const value = asUrl.searchParams.get(key);
      if (value && /^[0-9]+$/.test(value)) {
        return value;
      }
    }

    const segments = asUrl.pathname.split('/').filter(Boolean).reverse();
    for (const segment of segments) {
      if (/^[0-9]{3,}$/.test(segment)) {
        return segment;
      }
    }
  } catch (error) {
    // Ignore and try fallback regex.
  }

  const numericFallback = trimmed.match(/([0-9]{3,})(?![a-zA-Z])/);
  return numericFallback ? numericFallback[1] : null;
}

function sanitizeFilename(name, fallback = 'untitled') {
  if (!name) {
    return fallback;
  }

  const cleaned = String(name)
    .replace(FILENAME_SANITIZE_REGEX, ' ')
    .replace(WHITESPACE_REGEX, ' ')
    .trim();

  return cleaned || fallback;
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size % 1 === 0 ? size : size.toFixed(size >= 10 ? 1 : 2)} ${
    units[unitIndex]
  }`;
}

function buildArchiveFilename(title, packageId) {
  const safeTitle = sanitizeFilename(title);
  const suffix = packageId ? `_${packageId}` : '';
  return `${safeTitle || 'dccon'}${suffix}.zip`;
}

module.exports = {
  extractPackageId,
  sanitizeFilename,
  formatBytes,
  buildArchiveFilename,
  FILENAME_SANITIZE_REGEX,
};
