const API_BASE = 'https://photo-music-video-maker-lebyul.onrender.com';
const apiUrl = (path) => `${API_BASE}${path}`;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function pingApi(timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(apiUrl('/health'), {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
      signal: controller.signal
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForApiReady(maxWaitMs = 120000) {
  const startedAt = Date.now();
  let attempt = 0;

  while (Date.now() - startedAt < maxWaitMs) {
    attempt += 1;
    const ok = await pingApi(10000);
    if (ok) return;

    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    setProgress(
      2,
      `영상 서버를 깨우는 중입니다... ${elapsed}초 (사진과 음악은 그대로 유지됩니다)`
    );
    await sleep(Math.min(5000, 1500 + attempt * 500));
  }

  throw new Error('영상 서버 연결이 오래 지연되고 있습니다. 다시 한 번 영상 만들기를 눌러 주세요.');
}

// First screen is static and instant. Start waking the video server immediately.
pingApi().catch(() => {});

// Keep the backend awake while this page stays open.
setInterval(() => {
  pingApi().catch(() => {});
}, 10 * 60 * 1000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) pingApi().catch(() => {});
});

const imageInput = document.getElementById('imageInput');
const audioInput = document.getElementById('audioInput');
const thumbs = document.getElementById('thumbs');
const imageCount = document.getElementById('imageCount');
const durationText = document.getElementById('durationText');
const musicState = document.getElementById('musicState');
const musicName = document.getElementById('musicName');
const renderBtn = document.getElementById('renderBtn');
const dropzone = document.getElementById('imageDropzone');
const musicDropzone = document.getElementById('musicDropzone');
const progressCard = document.getElementById('progressCard');
const progressBar = document.getElementById('progressBar');
const progressValue = document.getElementById('progressValue');
const progressMessage = document.getElementById('progressMessage');
const resultCard = document.getElementById('resultCard');
const preview = document.getElementById('preview');
const downloadBtn = document.getElementById('downloadBtn');

const MAX_IMAGES = 10;
const TARGET_WIDTH = 1080;
const TARGET_HEIGHT = 1920;
let items = [];
let audioFile = null;
let uid = 0;

const filenameCollator = new Intl.Collator('ko-KR', {
  numeric: true,
  sensitivity: 'base'
});

function formatSeconds(sec) {
  if (sec < 60) return `${sec}초`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}분 ${s}초` : `${m}분`;
}

function updateSummary() {
  const duration = items.length * window.SECONDS_PER_IMAGE;
  imageCount.textContent = `${items.length}/${MAX_IMAGES}장 · ${formatSeconds(duration)}`;
  durationText.textContent = formatSeconds(duration);
  renderBtn.disabled = items.length === 0 || !audioFile;
}

function isSupportedImage(file) {
  const name = file.name.toLowerCase();
  return file.type.startsWith('image/') || name.endsWith('.heic') || name.endsWith('.heif');
}

function isHeic(file) {
  return /\.(heic|heif)$/i.test(file.name);
}

function isSupportedAudio(file) {
  const name = file.name.toLowerCase();
  return file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i.test(name);
}

function sortItemsByFilename() {
  items.sort((a, b) => filenameCollator.compare(a.file.name, b.file.name));
}

function addFiles(files) {
  const supported = [...files].filter(isSupportedImage);
  if (!supported.length) return;

  const remaining = MAX_IMAGES - items.length;
  if (remaining <= 0) {
    alert(`사진은 최대 ${MAX_IMAGES}장까지 업로드할 수 있습니다.`);
    return;
  }

  if (supported.length > remaining) {
    alert(`사진은 최대 ${MAX_IMAGES}장까지 업로드할 수 있습니다. ${remaining}장만 추가됩니다.`);
  }

  supported.slice(0, remaining).forEach(file => {
    items.push({ id: ++uid, file, url: URL.createObjectURL(file) });
  });
  sortItemsByFilename();
  renderThumbs();
}

function setAudioFile(file) {
  if (!file || !isSupportedAudio(file)) {
    if (file) alert('지원되는 음악 파일을 넣어 주세요.');
    return;
  }
  audioFile = file;
  musicName.textContent = audioFile.name;
  musicState.textContent = '선택 완료';
  updateSummary();
}

function renderThumbs() {
  thumbs.innerHTML = '';
  items.forEach((item, index) => {
    const el = document.createElement('div');
    el.className = 'thumb';
    el.draggable = true;
    el.dataset.id = item.id;
    el.title = item.file.name;
    el.innerHTML = `
      <img src="${item.url}" alt="${item.file.name.replaceAll('"', '&quot;')}">
      <span class="badge">${index + 1}</span>
      <span class="filename">${item.file.name.replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</span>
      <button class="remove" type="button" aria-label="삭제">×</button>
    `;
    el.querySelector('.remove').addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const idx = items.findIndex(x => x.id === item.id);
      if (idx >= 0) {
        URL.revokeObjectURL(items[idx].url);
        items.splice(idx, 1);
      }
      renderThumbs();
    });
    el.addEventListener('dragstart', () => el.classList.add('dragging'));
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      document.querySelectorAll('.thumb').forEach(x => x.classList.remove('drag-target'));
    });
    el.addEventListener('dragover', e => {
      e.preventDefault();
      if (!el.classList.contains('dragging')) el.classList.add('drag-target');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drag-target'));
    el.addEventListener('drop', e => {
      e.preventDefault();
      el.classList.remove('drag-target');
      const dragging = document.querySelector('.thumb.dragging');
      if (!dragging || dragging === el) return;
      const fromId = Number(dragging.dataset.id);
      const toId = Number(el.dataset.id);
      const from = items.findIndex(x => x.id === fromId);
      const to = items.findIndex(x => x.id === toId);
      if (from < 0 || to < 0) return;
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved);
      renderThumbs();
    });
    thumbs.appendChild(el);
  });
  updateSummary();
}

imageInput.addEventListener('change', () => {
  addFiles(imageInput.files);
  imageInput.value = '';
});

audioInput.addEventListener('change', () => {
  const file = audioInput.files?.[0] || null;
  if (file) setAudioFile(file);
  else {
    audioFile = null;
    musicName.textContent = '음악 파일 선택 또는 여기로 드래그';
    musicState.textContent = '선택 안 됨';
    updateSummary();
  }
  audioInput.value = '';
});

['dragenter', 'dragover'].forEach(type => dropzone.addEventListener(type, e => {
  e.preventDefault();
  dropzone.classList.add('dragover');
}));
['dragleave', 'drop'].forEach(type => dropzone.addEventListener(type, e => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
}));
dropzone.addEventListener('drop', e => addFiles(e.dataTransfer.files));

['dragenter', 'dragover'].forEach(type => musicDropzone.addEventListener(type, e => {
  e.preventDefault();
  musicDropzone.classList.add('dragover');
}));
['dragleave', 'drop'].forEach(type => musicDropzone.addEventListener(type, e => {
  e.preventDefault();
  musicDropzone.classList.remove('dragover');
}));
musicDropzone.addEventListener('drop', e => {
  const files = [...e.dataTransfer.files];
  const file = files.find(isSupportedAudio);
  if (!file) {
    alert('음악 파일을 드래그해 넣어 주세요.');
    return;
  }
  setAudioFile(file);
});

function setProgress(value, message) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  progressBar.style.width = `${v}%`;
  progressValue.textContent = `${v}%`;
  if (message) progressMessage.textContent = message;
}

function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.9) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('사진 최적화에 실패했습니다.')), type, quality);
  });
}

async function optimizeImage(file) {
  if (isHeic(file)) return file;

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file;
  }

  const canvas = document.createElement('canvas');
  canvas.width = TARGET_WIDTH;
  canvas.height = TARGET_HEIGHT;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT);

  const srcRatio = bitmap.width / bitmap.height;
  const dstRatio = TARGET_WIDTH / TARGET_HEIGHT;
  let sx = 0;
  let sy = 0;
  let sw = bitmap.width;
  let sh = bitmap.height;

  if (srcRatio > dstRatio) {
    sw = bitmap.height * dstRatio;
    sx = (bitmap.width - sw) / 2;
  } else if (srcRatio < dstRatio) {
    sh = bitmap.width / dstRatio;
    sy = (bitmap.height - sh) / 2;
  }

  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, TARGET_WIDTH, TARGET_HEIGHT);
  bitmap.close();

  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.9);
  const base = file.name.replace(/\.[^.]+$/, '') || 'image';
  return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
}

async function prepareUploadFiles() {
  const prepared = [];
  for (let i = 0; i < items.length; i++) {
    const pct = 3 + Math.round(((i + 1) / items.length) * 12);
    setProgress(pct, `사진 업로드 최적화 중... ${i + 1}/${items.length}`);
    prepared.push(await optimizeImage(items[i].file));
  }
  return prepared;
}

function buildForm(preparedFiles, requestId) {
  const form = new FormData();
  preparedFiles.forEach((file, i) => form.append('images', file, file.name || items[i].file.name));
  form.append('audio', audioFile, audioFile.name);
  form.append('order', JSON.stringify(preparedFiles.map((_, i) => i)));
  form.append('request_id', requestId);
  return form;
}

async function sendRenderRequest(preparedFiles, requestId) {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (attempt > 1) {
        const delay = attempt === 2 ? 2000 : 4000;
        setProgress(18, `업로드 연결 재시도 중... ${attempt}/3`);
        await sleep(delay);
      } else {
        setProgress(16, '파일을 업로드하고 있습니다.');
      }

      const res = await fetch(apiUrl('/api/render'), {
        method: 'POST',
        body: buildForm(preparedFiles, requestId)
      });

      let data = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }

      if (res.ok) return data;

      const message = data.error || `서버 응답 오류 (${res.status})`;
      lastError = new Error(message);

      if (res.status < 500 || attempt === 3) {
        throw lastError;
      }
    } catch (err) {
      lastError = err;
      const message = String(err?.message || err || '');
      const retryable =
        err instanceof TypeError ||
        /failed to fetch|network|서버 응답 오류|502|503|504/i.test(message);

      if (!retryable || attempt === 3) break;
    }
  }

  throw new Error(
    `업로드 연결에 실패했습니다. 파일은 그대로 있으니 다시 영상 만들기를 눌러 주세요. (${lastError?.message || 'network error'})`
  );
}

async function poll(jobId) {
  while (true) {
    const res = await fetch(apiUrl(`/api/status/${jobId}`), { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '상태 확인에 실패했습니다.');
    setProgress(data.progress, data.message);
    if (data.status === 'done') return data;
    if (data.status === 'error') throw new Error(data.message || '영상 생성에 실패했습니다.');
    await new Promise(r => setTimeout(r, 500));
  }
}

renderBtn.addEventListener('click', async () => {
  if (!items.length || !audioFile) return;
  if (items.length > MAX_IMAGES) {
    alert(`사진은 최대 ${MAX_IMAGES}장까지 업로드할 수 있습니다.`);
    return;
  }

  renderBtn.disabled = true;
  renderBtn.textContent = '만드는 중...';
  resultCard.classList.add('hidden');
  progressCard.classList.remove('hidden');
  setProgress(2, '사진을 준비하고 있습니다.');

  try {
    setProgress(2, '영상 서버 연결을 확인하고 있습니다.');
    await waitForApiReady();
    setProgress(3, '서버 연결 완료. 사진을 준비하고 있습니다.');

    const preparedFiles = await prepareUploadFiles();
    const totalBytes = preparedFiles.reduce((sum, file) => sum + file.size, 0) + audioFile.size;
    const maxBytes = (window.MAX_UPLOAD_MB || 150) * 1024 * 1024;
    if (totalBytes > maxBytes) {
      throw new Error(`최적화 후 전체 업로드 용량도 ${window.MAX_UPLOAD_MB || 150}MB를 초과합니다.`);
    }

    const requestId = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
    const data = await sendRenderRequest(preparedFiles, requestId);

    await poll(data.job_id);
    preview.src = apiUrl(`/api/preview/${data.job_id}?t=${Date.now()}`);
    downloadBtn.href = apiUrl(`/api/download/${data.job_id}`);
    resultCard.classList.remove('hidden');
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    setProgress(0, `오류: ${err.message}`);
    alert(err.message);
  } finally {
    renderBtn.textContent = '영상 만들기';
    updateSummary();
  }
});

updateSummary();
