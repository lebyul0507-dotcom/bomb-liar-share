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
const aspectRatio = document.getElementById('aspectRatio');
const videoSpec = document.getElementById('videoSpec');

const MAX_IMAGES = 10;
const ASPECT_PRESETS = {
  '9:16': { width: 1080, height: 1920 },
  '3:4': { width: 1080, height: 1440 }
};

function getTargetSize() {
  return ASPECT_PRESETS[aspectRatio?.value] || ASPECT_PRESETS['9:16'];
}

function applyAspectRatioUI() {
  const ratio = aspectRatio?.value || '9:16';
  const { width, height } = getTargetSize();
  document.documentElement.style.setProperty('--video-aspect', `${width} / ${height}`);
  if (videoSpec) {
    videoSpec.textContent = `${width} × ${height} · ${ratio} · 30fps · H.264 · 최대 ${MAX_IMAGES}장`;
  }
}
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
  applyAspectRatioUI();
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

  const { width: targetWidth, height: targetHeight } = getTargetSize();
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, targetWidth, targetHeight);

  const srcRatio = bitmap.width / bitmap.height;
  const dstRatio = targetWidth / targetHeight;
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

  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);
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
  form.append('aspect_ratio', aspectRatio?.value || '9:16');
  return form;
}

async function sendRenderRequest(preparedFiles, requestId) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      if (attempt === 2) {
        setProgress(18, '업로드 연결을 다시 시도하고 있습니다.');
        await new Promise(r => setTimeout(r, 1200));
      } else {
        setProgress(16, '파일을 업로드하고 있습니다.');
      }

      const res = await fetch('/api/render', {
        method: 'POST',
        body: buildForm(preparedFiles, requestId)
      });

      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error(`서버 응답 오류 (${res.status})`);
      }

      if (!res.ok) throw new Error(data.error || '영상 생성 요청에 실패했습니다.');
      return data;
    } catch (err) {
      lastError = err;
      const isNetworkError = err instanceof TypeError || /failed to fetch|network/i.test(String(err?.message || err));
      if (!isNetworkError || attempt === 2) break;
    }
  }
  throw new Error(`업로드 연결에 실패했습니다. 잠시 후 다시 시도해 주세요. (${lastError?.message || 'network error'})`);
}

async function poll(jobId) {
  while (true) {
    const res = await fetch(`/api/status/${jobId}`, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '상태 확인에 실패했습니다.');
    setProgress(data.progress, data.message);
    if (data.status === 'done') return data;
    if (data.status === 'error') throw new Error(data.message || '영상 생성에 실패했습니다.');
    await new Promise(r => setTimeout(r, 500));
  }
}

aspectRatio?.addEventListener('change', () => {
  applyAspectRatioUI();
  resultCard.classList.add('hidden');
  preview.removeAttribute('src');
  preview.load();
});

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
    const preparedFiles = await prepareUploadFiles();
    const totalBytes = preparedFiles.reduce((sum, file) => sum + file.size, 0) + audioFile.size;
    const maxBytes = (window.MAX_UPLOAD_MB || 150) * 1024 * 1024;
    if (totalBytes > maxBytes) {
      throw new Error(`최적화 후 전체 업로드 용량도 ${window.MAX_UPLOAD_MB || 150}MB를 초과합니다.`);
    }

    const requestId = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
    const data = await sendRenderRequest(preparedFiles, requestId);

    await poll(data.job_id);
    preview.src = `/api/preview/${data.job_id}?t=${Date.now()}`;
    downloadBtn.href = `/api/download/${data.job_id}`;
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
