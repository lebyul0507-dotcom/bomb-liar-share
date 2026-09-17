const imageInput = document.getElementById('imageInput');
const audioInput = document.getElementById('audioInput');
const thumbs = document.getElementById('thumbs');
const imageCount = document.getElementById('imageCount');
const durationText = document.getElementById('durationText');
const musicState = document.getElementById('musicState');
const musicName = document.getElementById('musicName');
const renderBtn = document.getElementById('renderBtn');
const dropzone = document.getElementById('imageDropzone');
const progressCard = document.getElementById('progressCard');
const progressBar = document.getElementById('progressBar');
const progressValue = document.getElementById('progressValue');
const progressMessage = document.getElementById('progressMessage');
const resultCard = document.getElementById('resultCard');
const preview = document.getElementById('preview');
const downloadBtn = document.getElementById('downloadBtn');

let items = [];
let audioFile = null;
let uid = 0;

function formatSeconds(sec) {
  if (sec < 60) return `${sec}초`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}분 ${s}초` : `${m}분`;
}

function updateSummary() {
  const duration = items.length * window.SECONDS_PER_IMAGE;
  imageCount.textContent = `${items.length}장 · ${formatSeconds(duration)}`;
  durationText.textContent = formatSeconds(duration);
  renderBtn.disabled = items.length === 0 || !audioFile;
}

function isSupportedImage(file) {
  const name = file.name.toLowerCase();
  return file.type.startsWith('image/') || name.endsWith('.heic') || name.endsWith('.heif');
}

function addFiles(files) {
  [...files].forEach(file => {
    if (!isSupportedImage(file)) return;
    items.push({ id: ++uid, file, url: URL.createObjectURL(file) });
  });
  renderThumbs();
}

function renderThumbs() {
  thumbs.innerHTML = '';
  items.forEach((item, index) => {
    const el = document.createElement('div');
    el.className = 'thumb';
    el.draggable = true;
    el.dataset.id = item.id;
    el.innerHTML = `
      <img src="${item.url}" alt="${item.file.name.replaceAll('"', '&quot;')}">
      <span class="badge">${index + 1}</span>
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
  audioFile = audioInput.files?.[0] || null;
  if (audioFile) {
    musicName.textContent = audioFile.name;
    musicState.textContent = '선택 완료';
  } else {
    musicName.textContent = '음악 파일 선택';
    musicState.textContent = '선택 안 됨';
  }
  updateSummary();
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

function setProgress(value, message) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  progressBar.style.width = `${v}%`;
  progressValue.textContent = `${v}%`;
  if (message) progressMessage.textContent = message;
}

async function poll(jobId) {
  while (true) {
    const res = await fetch(`/api/status/${jobId}`, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '상태 확인에 실패했습니다.');
    setProgress(data.progress, data.message);
    if (data.status === 'done') return data;
    if (data.status === 'error') throw new Error(data.message || '영상 생성에 실패했습니다.');
    await new Promise(r => setTimeout(r, 800));
  }
}

renderBtn.addEventListener('click', async () => {
  if (!items.length || !audioFile) return;
  const totalBytes = items.reduce((sum, item) => sum + item.file.size, 0) + audioFile.size;
  const maxBytes = (window.MAX_UPLOAD_MB || 150) * 1024 * 1024;
  if (totalBytes > maxBytes) {
    alert(`전체 업로드 용량은 ${window.MAX_UPLOAD_MB || 150}MB 이하여야 합니다.`);
    return;
  }
  renderBtn.disabled = true;
  renderBtn.textContent = '만드는 중...';
  resultCard.classList.add('hidden');
  progressCard.classList.remove('hidden');
  setProgress(2, '파일을 업로드하고 있습니다.');

  const form = new FormData();
  items.forEach(item => form.append('images', item.file, item.file.name));
  form.append('audio', audioFile, audioFile.name);
  form.append('order', JSON.stringify(items.map((_, i) => i)));

  try {
    const res = await fetch('/api/render', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '영상 생성 요청에 실패했습니다.');

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
