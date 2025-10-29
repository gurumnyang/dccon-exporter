'use strict';

require('dotenv').config({ override: true });

const express = require('express');
const cors = require('cors');
const {
  createJob,
  listJobs,
  getJob,
  getJobDownloadData,
} = require('./jobQueue');

const PORT = process.env.PORT || 4000;

function resolveSessionId(req) {
  const headerValue = req.headers['x-session-id'];
  if (Array.isArray(headerValue)) {
    return headerValue[0]?.trim();
  }
  if (typeof headerValue === 'string') {
    return headerValue.trim();
  }
  const queryValue = req.query?.session_id;
  if (Array.isArray(queryValue)) {
    return queryValue[0]?.trim();
  }
  if (typeof queryValue === 'string') {
    return queryValue.trim();
  }
  return '';
}

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/jobs', (req, res) => {
  const sessionId = resolveSessionId(req);
  if (!sessionId) {
    res.status(400).json({ error: '세션 식별자가 필요합니다.' });
    return;
  }
  res.json(listJobs(sessionId));
});

app.get('/api/jobs/:id', (req, res, next) => {
  try {
    const sessionId = resolveSessionId(req);
    if (!sessionId) {
      res.status(400).json({ error: '세션 식별자가 필요합니다.' });
      return;
    }

    const job = getJob(sessionId, req.params.id);
    if (!job) {
      res.status(404).json({ error: '작업을 찾을 수 없습니다.' });
      return;
    }
    res.json(job);
  } catch (error) {
    next(error);
  }
});

app.post('/api/jobs', (req, res, next) => {
  try {
    const sessionId = resolveSessionId(req);
    if (!sessionId) {
      res.status(400).json({ error: '세션 식별자가 필요합니다.' });
      return;
    }

    const { url, resize } = req.body || {};
    if (!url || typeof url !== 'string') {
      res.status(400).json({ error: 'URL을 입력해주세요.' });
      return;
    }

    const job = createJob(url, sessionId, { resize });
    res.status(201).json(job);
  } catch (error) {
    next(error);
  }
});

app.get('/api/jobs/:id/download', (req, res, next) => {
  try {
    const sessionId = resolveSessionId(req);
    if (!sessionId) {
      res.status(400).json({ error: '세션 식별자가 필요합니다.' });
      return;
    }

    const zip = getJobDownloadData(sessionId, req.params.id);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(zip.filename)}"`,
    );
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', zip.size);
    res.send(zip.buffer);
  } catch (error) {
    next(error);
  }
});

app.use((err, req, res, _next) => {
  const statusCode = err.statusCode || 500;
  const message =
    statusCode === 500 ? '알 수 없는 오류가 발생했습니다.' : err.message;

  if (statusCode === 500) {
    console.error(err);
  }

  res.status(statusCode).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`server listening on http://localhost:${PORT}`);
});
