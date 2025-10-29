<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const API_BASE_URL = (
  'https://api.dcconexporter.gurum.cat/'
).replace(/\/$/, '')

const SESSION_STORAGE_KEY = 'dccon-exporter-session'
const fallbackThumbnail =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='

function createSessionId() {
  return `sess_${Math.random().toString(36).slice(2, 10)}`
}

function getSessionId() {
  if (typeof window === 'undefined') {
    return createSessionId()
  }

  try {
    const existing = window.localStorage.getItem(SESSION_STORAGE_KEY)
    if (existing) {
      return existing
    }
    const generated = createSessionId()
    window.localStorage.setItem(SESSION_STORAGE_KEY, generated)
    return generated
  } catch (_error) {
    return createSessionId()
  }
}

const sessionId = getSessionId()

const resizeOptions = [
  { value: 'original', label: '원본 유지 (200 x 200)' },
  { value: '128', label: '128 x 128' },
  { value: '150', label: '150 x 150' },
  { value: '200', label: '200 x 200' },
  { value: '256', label: '256 x 256' },
  { value: '300', label: '300 x 300' },
  { value: '400', label: '400 x 400' },
]

const urlInput = ref('')
const jobs = ref([])
const selectedResize = ref('original')
const isSubmitting = ref(false)
const feedback = ref(null)
const lastCreatedJobId = ref(null)
const lastFetchError = ref('')
const expandedState = ref({})

let pollingHandle = null

const exampleImage = new URL('./assets/example.png', import.meta.url).href

const orderedJobs = computed(() => jobs.value)

const statusLabels = {
  queued: '대기 중',
  processing: '진행 중',
  completed: '완료',
  failed: '실패',
}

function progressPercent(job) {
  if (job?.status === 'completed') {
    return 100
  }
  return Math.min(100, Math.round((job?.progress ?? 0) * 100))
}

function statusClass(status) {
  return `status-${status}`
}

function statusLabel(status) {
  return statusLabels[status] || status
}

function formatResizeLabel(resizeValue) {
  if (!resizeValue) {
    return '원본 (200 x 200)'
  }
  return `${resizeValue} x ${resizeValue}`
}

function formatRelative(isoString) {
  if (!isoString) return '—'
  const timestamp = new Date(isoString).getTime()
  if (Number.isNaN(timestamp)) return '—'

  const deltaSeconds = Math.floor((Date.now() - timestamp) / 1000)
  if (deltaSeconds < 10) return '방금 전'
  if (deltaSeconds < 60) return `${deltaSeconds}초 전`
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}분 전`
  if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)}시간 전`
  return new Date(isoString).toLocaleString()
}

async function fetchJobs() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/jobs`, {
      headers: {
        'x-session-id': sessionId,
      },
    })
    if (!response.ok) {
      throw new Error()
    }
    const data = await response.json()
    if (Array.isArray(data)) {
      const nextState = {}
      data.forEach((job) => {
        nextState[job.id] = expandedState.value[job.id] ?? true
      })
      expandedState.value = nextState
      jobs.value = data
      lastFetchError.value = ''
    }
  } catch (error) {
    lastFetchError.value = '큐 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.'
  }
}

function clearFeedback(delay = 4000) {
  if (!feedback.value) return
  setTimeout(() => {
    feedback.value = null
  }, delay)
}

async function createJob(rawUrl, overrideResize) {
  const trimmed = (rawUrl || '').trim()
  if (!trimmed) {
    feedback.value = { type: 'error', message: '디시콘 URL을 입력해주세요.' }
    clearFeedback(3000)
    return
  }

  isSubmitting.value = true
  feedback.value = null

  try {
    let requestedResize
    if (overrideResize !== undefined) {
      requestedResize = overrideResize
    } else if (selectedResize.value === 'original') {
      requestedResize = null
    } else {
      requestedResize = Number.parseInt(selectedResize.value, 10)
    }

    const normalizedResize =
      requestedResize === null || requestedResize === undefined
        ? null
        : Number.parseInt(requestedResize, 10)

    const requestBody = {
      url: trimmed,
      resize:
        normalizedResize && !Number.isNaN(normalizedResize) && normalizedResize > 0
          ? normalizedResize
          : null,
    }

    const response = await fetch(`${API_BASE_URL}/api/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': sessionId,
      },
      body: JSON.stringify(requestBody),
    })

    const payload = await response.json()

    if (!response.ok) {
      throw new Error(payload?.error || '요청이 실패했습니다.')
    }

    lastCreatedJobId.value = payload.id
    feedback.value = { type: 'success', message: '다운로드 큐에 추가되었습니다.' }
    urlInput.value = ''
    expandedState.value = {
      ...expandedState.value,
      [payload.id]: true,
    }
    await fetchJobs()

    clearFeedback()
    setTimeout(() => {
      lastCreatedJobId.value = null
    }, 4000)
  } catch (error) {
    feedback.value = {
      type: 'error',
      message: error.message || '요청이 실패했습니다.',
    }
    clearFeedback(4000)
  } finally {
    isSubmitting.value = false
  }
}

function submitForm() {
  if (!isSubmitting.value) {
    createJob(urlInput.value)
  }
}

function retryJob(job) {
  if (!isSubmitting.value) {
    createJob(job.url, job.options?.resize ?? null)
  }
}

function downloadJob(job) {
  const link = document.createElement('a')
  link.href = `${API_BASE_URL}/api/jobs/${job.id}/download?session_id=${encodeURIComponent(sessionId)}`
  link.rel = 'noopener'
  link.target = '_blank'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

onMounted(() => {
  fetchJobs()
  pollingHandle = setInterval(fetchJobs, 5000)
})

onBeforeUnmount(() => {
  if (pollingHandle) {
    clearInterval(pollingHandle)
  }
})

function isJobExpanded(jobId) {
  return expandedState.value[jobId] ?? true
}

function onJobToggle(jobId, event) {
  const open = Boolean(event?.target?.open)
  expandedState.value = {
    ...expandedState.value,
    [jobId]: open,
  }
}
</script>

<template>
  <div class="app-shell">
    <header class="hero">
      <div class="hero-text">
        <h1>구름 디시콘 다운로더</h1>
      </div>
    </header>

    <section class="form-card">
      <form @submit.prevent="submitForm">
        <label class="form-label" for="dccon-url">디시콘 페이지 URL</label>
        <div class="input-row">
          <input
            id="dccon-url"
            v-model="urlInput"
            type="url"
            :disabled="isSubmitting"
            placeholder="https://dccon.dcinside.com/#123456"
            autocomplete="off"
            required
          />
          <button
            type="submit"
            class="primary icon-button"
            :disabled="isSubmitting"
            :aria-label="isSubmitting ? '추출 중' : '대기열 추가'"
          >
            <span v-if="isSubmitting" class="spinner" aria-hidden="true" />
            <svg
              v-else
              class="send-icon"
              aria-hidden="true"
              viewBox="0 0 24 24"
            >
              <path
                d="M5 3.75a.75.75 0 0 0-1.1.66v15.18a.75.75 0 0 0 1.1.66l14-7.59a.75.75 0 0 0 0-1.32L5 3.75zm.9 2.74 10.22 5.51-10.22 5.51V6.49z"
              />
            </svg>
            <span class="sr-only">
              {{ isSubmitting ? '추출 중' : '대기열 추가' }}
            </span>
          </button>
        </div>
        <div class="options-row">
          <label class="resize-label" for="resize-select">이미지 크기</label>
          <select
            id="resize-select"
            v-model="selectedResize"
            :disabled="isSubmitting"
          >
            <option
              v-for="option in resizeOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </div>
        <p class="helper-text">
          URL을 입력하고 원하는 출력 크기를 선택하세요. (기본 200 x 200)
        </p>
      </form>
      <transition name="fade">
        <p
          v-if="feedback"
          class="feedback"
          :class="feedback.type"
        >
          {{ feedback.message }}
        </p>
      </transition>
    </section>
    <section class="queue-card">
      <header class="section-header">
        <div>
          <h2>대기열</h2>
        </div>
        <span class="counter">{{ orderedJobs.length }}</span>
      </header>

      <p v-if="lastFetchError" class="inline-error">
        {{ lastFetchError }}
      </p>

      <div v-if="!orderedJobs.length" class="empty-state">
        <img src="https://dummyimage.com/300x200/1f2937/fff&text=DCCon" alt="queue placeholder" />
        <h3>아직 대기 중인 작업이 없습니다.</h3>
        <p>디시콘 모음집 주소를 입력하고 첫 추출을 시작해보세요.</p>
      </div>

      <div v-else class="job-list">
        <details
          v-for="(job, index) in orderedJobs"
          :key="job.id"
          class="job-card"
          :class="[statusClass(job.status), { highlight: job.id === lastCreatedJobId }]"
          :open="isJobExpanded(job.id)"
          @toggle="onJobToggle(job.id, $event)"
        >
          <summary class="job-summary">
            <div class="summary-main">
              <h3>{{ job.packageTitle || `모음집 추출 준비 중 #${index + 1}` }}</h3>
              <span class="job-url" :title="job.url">{{ job.url }}</span>
            </div>
            <div class="summary-meta">
              <span class="status-pill summary-status" :class="statusClass(job.status)">
                {{ statusLabel(job.status) }}
              </span>
              <span class="summary-chip">진행률 {{ progressPercent(job) }}%</span>
              <span v-if="job.archive" class="summary-chip">ZIP {{ job.archive.sizeLabel }}</span>
              <span class="summary-chip">크기 {{ formatResizeLabel(job.options?.resize) }}</span>
              <span class="summary-chip">생성 {{ formatRelative(job.createdAt) }}</span>
            </div>
          </summary>

          <div class="job-body">
            <div class="progress">
              <div class="progress-bar" :style="{ width: `${progressPercent(job)}%` }"></div>
            </div>

            <div class="job-meta">
              <span>진행률 {{ progressPercent(job) }}%</span>
              <span v-if="job.archive">ZIP {{ job.archive.sizeLabel }}</span>
              <span>크기 {{ formatResizeLabel(job.options?.resize) }}</span>
              <span>생성 {{ formatRelative(job.createdAt) }}</span>
            </div>

            <p class="job-message">{{ job.message }}</p>

            <div v-if="job.previews?.length" class="preview-strip">
              <img
                v-for="preview in job.previews"
                :key="preview.idx"
                :src="preview.dataUrl"
                :alt="preview.title || '디시콘 미리보기'"
              />
            </div>

            <details v-if="job.items?.length" class="item-gallery">
              <summary>
                콘텐츠 ({{ job.itemCount }})
              </summary>
              <div class="item-grid">
                <div
                  v-for="item in job.items"
                  :key="item.idx"
                  class="item-card"
                >
                  <div class="item-thumb">
                    <img
                      :src="item.dataUrl || fallbackThumbnail"
                      :alt="item.title || `디시콘 ${item.sort}`"
                      loading="lazy"
                    />
                  </div>
                  <div class="item-text">
                    <span class="item-name">
                      {{ item.title || `콘 ${item.sort}` }}
                    </span>
                    <span class="item-meta">
                      {{ (item.ext || 'png').toUpperCase() }} · {{ item.sizeLabel || '—' }}
                    </span>
                  </div>
                  <span v-if="item.resized" class="item-tag">RESIZED</span>
                </div>
              </div>
            </details>

            <footer class="job-actions">
              <button
                v-if="job.status === 'completed'"
                type="button"
                class="primary ghost-border"
                @click="downloadJob(job)"
              >
                ZIP 다운로드
              </button>
              <button
                v-else-if="job.status === 'failed'"
                type="button"
                class="ghost"
                @click="retryJob(job)"
              >
                재시도
              </button>
            </footer>
          </div>
        </details>
      </div>
    </section>

    <div class="guide-card">
      <img
        :src="exampleImage"
        alt="디시콘 링크 주소 복사 예시"
      />
      <p>
        디시콘 목록에서 디시콘을 우클릭 후 <strong>링크 주소 복사</strong>를 선택하면 모음집 주소를 손쉽게 가져올 수 있습니다.
      </p>
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  padding-bottom: 4rem;
}

.hero {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 2rem;
}

.hero-text {
  max-width: 720px;
}

.hero h1 {
  font-size: clamp(2rem, 4vw, 2.8rem);
  margin: 0.5rem 0;
  line-height: 1.15;
}

.hero p {
  margin: 0;
  color: var(--muted-foreground);
  font-size: 1.05rem;
}

.badge {
  display: inline-flex;
  align-items: center;
  padding: 0.35rem 0.8rem;
  border-radius: 999px;
  font-weight: 600;
  font-size: 0.85rem;
  background: rgba(59, 130, 246, 0.15);
  color: #3b82f6;
  letter-spacing: 0.04em;
}

.form-card {
  padding: 2.5rem 2.2rem;
}
.queue-card {
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(148, 163, 184, 0.15);
  border-radius: 20px;
  padding: 2.5rem 2.2rem;
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.35);
  backdrop-filter: blur(22px);
}

.form-label {
  display: block;
  font-weight: 600;
  margin-bottom: 0.5rem;
  font-size: 0.95rem;
  color: var(--muted-foreground);
}

.input-row {
  display: flex;
  flex-direction: row;
  gap: 1rem;
}

.options-row {
  margin-top: 0.5rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
}

.resize-label {
  font-size: 0.9rem;
  font-weight: 600;
  color: rgba(148, 163, 184, 0.85);
}

.options-row select {
  min-width: 200px;
  padding: 0.65rem 1rem;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  background: rgba(15, 23, 42, 0.65);
  color: #e2e8f0;
  font-size: 0.95rem;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.options-row select:focus {
  outline: none;
  border-color: rgba(59, 130, 246, 0.55);
  box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.15);
}

@media (min-width: 640px) {
  .input-row {
    flex-direction: row;
    align-items: center;
  }
}

input[type='url'] {
  flex: 1;
  padding: 0.95rem 1.2rem;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  background: rgba(15, 23, 42, 0.65);
  color: #e2e8f0;
  font-size: 1rem;
  transition: border-color 0.2s, box-shadow 0.2s;
}

input[type='url']::placeholder {
  color: rgba(148, 163, 184, 0.65);
}

input[type='url']:focus {
  outline: none;
  border-color: rgba(59, 130, 246, 0.55);
  box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.15);
}

button {
  appearance: none;
  cursor: pointer;
  border-radius: 12px;
  padding: 0.8rem 1.4rem;
  font-weight: 600;
  font-size: 0.95rem;
  border: 1px solid transparent;
  background: none;
  color: inherit;
  transition: background 0.15s ease, border-color 0.15s ease;
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.8rem;
  height: 2.8rem;
  padding: 0;
}

.send-icon {
  width: 18px;
  height: 18px;
  fill: currentColor;
}

.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(248, 250, 252, 0.25);
  border-top-color: #f8fafc;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.primary {
  background: #2563eb;
  color: #f8fafc;
  border-color: #1d4ed8;
}

.primary:hover:not(:disabled) {
  background: #1d4ed8;
}

.ghost {
  background: rgba(148, 163, 184, 0.12);
  color: #e2e8f0;
  border: 1px solid rgba(148, 163, 184, 0.2);
}

.ghost-border {
  border: 1px solid rgba(59, 130, 246, 0.3);
}

.helper-text {
  margin: 0.5rem 0 0;
  color: rgba(148, 163, 184, 0.8);
  font-size: 0.9rem;
}

.feedback {
  margin-top: 1.5rem;
  padding: 0.9rem 1.1rem;
  border-radius: 12px;
  font-size: 0.95rem;
  font-weight: 500;
}

.feedback.success {
  background: rgba(34, 197, 94, 0.12);
  color: #34d399;
  border: 1px solid rgba(34, 197, 94, 0.2);
}

.feedback.error {
  background: rgba(248, 113, 113, 0.12);
  color: #fca5a5;
  border: 1px solid rgba(248, 113, 113, 0.2);
}

.guide-card {
  margin-top: 2rem;
  border-radius: 16px;
  background: rgba(15, 23, 42, 0.6);
  border: 1px dashed rgba(148, 163, 184, 0.35);
  padding: 1.2rem;
  display: grid;
  gap: 1rem;
}

.guide-card img {
  width: 100%;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.25);
}

.guide-card p {
  margin: 0;
  color: rgba(226, 232, 240, 0.88);
  font-size: 0.9rem;
}

.guide-card strong {
  color: #bfdbfe;
}

.queue-card .section-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 2rem;
}

.queue-card .section-header h2 {
  margin: 0;
  font-size: 1.5rem;
}

.queue-card .section-header p {
  margin: 0.35rem 0 0;
  color: var(--muted-foreground);
}

.counter {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 3rem;
  padding: 0.4rem 0.8rem;
  background: rgba(59, 130, 246, 0.18);
  color: #bfdbfe;
  border-radius: 14px;
  font-weight: 600;
}

.inline-error {
  padding: 0.9rem 1.1rem;
  border-radius: 12px;
  background: rgba(248, 113, 113, 0.08);
  border: 1px solid rgba(248, 113, 113, 0.2);
  color: #fecaca;
  margin-bottom: 1.5rem;
}

.empty-state {
  text-align: center;
  color: var(--muted-foreground);
  display: grid;
  gap: 1rem;
  justify-items: center;
}

.empty-state img {
  border-radius: 18px;
  opacity: 0.8;
}

.job-list {
  display: grid;
  gap: 1rem;
}

.job-card {
  position: relative;
  border-radius: 16px;
  background: rgba(15, 23, 42, 0.82);
  border: 1px solid rgba(148, 163, 184, 0.16);
  transition: transform 0.18s ease, border-color 0.18s ease,
    box-shadow 0.28s ease;
  overflow: hidden;
}

.job-card[open] {
  box-shadow: 0 16px 36px rgba(15, 23, 42, 0.3);
}

.job-card.highlight {
  border-color: rgba(59, 130, 246, 0.55);
  box-shadow: 0 12px 32px rgba(59, 130, 246, 0.22);
}

.job-card summary {
  padding: 1.2rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  cursor: pointer;
}

.job-card summary::-webkit-details-marker {
  display: none;
}

.job-card:hover {
  transform: translateY(-2px);
  border-color: rgba(148, 163, 184, 0.28);
}

.job-headline {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
}

.title-group h3 {
  margin: 0;
  font-size: 1.25rem;
}

.job-url {
  display: block;
  margin-top: 0.3rem;
  color: rgba(148, 163, 184, 0.75);
  font-size: 0.86rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  padding: 0.45rem 0.9rem;
  border-radius: 999px;
  font-weight: 600;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.status-pill.status-queued {
  background: rgba(234, 179, 8, 0.18);
  color: #facc15;
}

.status-pill.status-processing {
  background: rgba(96, 165, 250, 0.18);
  color: #93c5fd;
}

.status-pill.status-completed {
  background: rgba(34, 197, 94, 0.18);
  color: #86efac;
}

.status-pill.status-failed {
  background: rgba(248, 113, 113, 0.18);
  color: #fca5a5;
}

.job-summary {
  position: relative;
}

.summary-main h3 {
  margin: 0;
  font-size: 1.1rem;
}

.summary-main {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.summary-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.6rem;
}

.summary-chip {
  font-size: 0.8rem;
  padding: 0.3rem 0.6rem;
  border-radius: 10px;
  background: rgba(148, 163, 184, 0.1);
  color: rgba(226, 232, 240, 0.85);
  border: 1px solid rgba(148, 163, 184, 0.18);
}

.job-body {
  padding: 0 1.5rem 1.3rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.job-card:not([open]) .job-body {
  display: none;
}

.progress {
  width: 100%;
  height: 9px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.15);
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background: linear-gradient(135deg, #2563eb, #38bdf8);
  border-radius: 999px;
  transition: width 0.3s ease;
}

.summary-status {
  margin-right: auto;
}

.job-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem 1.2rem;
  font-size: 0.86rem;
  color: rgba(148, 163, 184, 0.82);
}

.job-message {
  margin: 0;
  font-weight: 500;
  color: #e2e8f0;
}

.preview-strip {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(64px, 88px);
  gap: 0.75rem;
  overflow-x: auto;
  padding-bottom: 0.4rem;
}

.preview-strip img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 14px;
  background: rgba(148, 163, 184, 0.12);
  border: 1px solid rgba(148, 163, 184, 0.2);
}

.item-gallery {
  border-radius: 16px;
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(148, 163, 184, 0.15);
  padding: 0;
  overflow: hidden;
}

.item-gallery summary {
  cursor: pointer;
  padding: 0.85rem 1.1rem;
  font-weight: 600;
  font-size: 0.95rem;
  color: #f8fafc;
  list-style: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.item-gallery summary::after {
  content: '⌄';
  font-size: 1rem;
  opacity: 0.6;
  transition: transform 0.2s ease;
}

.item-gallery[open] summary::after {
  transform: rotate(180deg);
}

.item-grid {
  display: grid;
  gap: 0.8rem;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  padding: 0.85rem 1.1rem 1.1rem;
}

.item-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding: 0.75rem;
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.15);
}

.item-thumb {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.85);
  border: 1px solid rgba(148, 163, 184, 0.15);
}

.item-thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.item-text {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.item-name {
  font-weight: 600;
  font-size: 0.9rem;
  color: #f8fafc;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-meta {
  font-size: 0.75rem;
  color: rgba(148, 163, 184, 0.75);
}

.item-tag {
  position: absolute;
  top: 0.6rem;
  right: 0.6rem;
  padding: 0.18rem 0.48rem;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.25);
  color: #bfdbfe;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.05em;
}

.job-actions {
  display: flex;
  gap: 0.8rem;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (max-width: 960px) {
  .hero {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
