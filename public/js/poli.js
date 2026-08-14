let lastCallId = null;
let audioUnlocked = false;
const calledNames = new Set();
let lastQueueData = null;
let lastCalls = [];

const $ = (id) => document.getElementById(id);

function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function updateClock() {
  const now = new Date();
  $('clock').textContent = now.toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }) + '  ' + now.toLocaleTimeString('id-ID');
}

function setConnStatus(text) {
  $('connStatus').textContent = text;
}

function renderTtsStatus(state) {
  const el = $('ttsStatus');
  if (!el) return;
  if (!state.supported) {
    el.textContent = 'Suara tidak didukung di browser ini (teks tetap tampil)';
  } else if (!audioUnlocked) {
    el.textContent = 'Ketuk layar untuk mengaktifkan suara';
  } else if (!state.hasVoice) {
    el.textContent = 'Tidak ada voice TTS ditemukan - periksa pengaturan TTS perangkat';
  } else if (!state.hasIdVoice) {
    el.textContent = 'Voice Bahasa Indonesia tidak ditemukan - suara default dipakai';
  } else {
    el.textContent = 'Suara siap (Bahasa Indonesia)';
  }
}

function unlockAudioAndHide() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  const overlay = $('audioOverlay');
  if (overlay) overlay.classList.add('hidden');
  unlockAudio();
}

function classifyRuangan(ruangan) {
  const r = String(ruangan || '').toLowerCase();
  if (r.includes('penyakit dalam')) return 'penyakit-dalam';
  if (r.includes('anak')) return 'poli-anak';
  if (r.includes('umum')) return 'poli-umum';
  return null;
}

function renderColumn(column) {
  const queue = lastQueueData ? (lastQueueData[column] || []) : [];

  const currentCall = lastCalls.find((c) => classifyRuangan(c.ruangan) === column);
  const nowEl = $('now-' + column);
  if (currentCall && currentCall.name) {
    nowEl.textContent = currentCall.name;
  } else {
    nowEl.textContent = 'Menunggu panggilan';
  }

  const nextPatient = queue.find((p) => !calledNames.has(p.name));
  const nextEl = $('next-' + column);
  if (nextPatient) {
    nextEl.textContent = nextPatient.name;
  } else {
    nextEl.textContent = queue.length > 0 ? 'Semua selesai' : '-';
  }
}

function renderAllColumns() {
  ['penyakit-dalam', 'poli-anak', 'poli-umum'].forEach(renderColumn);
}

function handleQueueSnapshot(snapshot) {
  const grouped = { 'penyakit-dalam': [], 'poli-anak': [], 'poli-umum': [] };
  snapshot.docs.forEach((doc) => {
    const d = doc.data();
    const column = classifyRuangan(d.RUANGAN);
    if (!column) return;
    grouped[column].push({
      name: String(d.NAMA || '').trim(),
      nomor: typeof d.NOMOR === 'number' ? d.NOMOR : 0,
    });
  });
  ['penyakit-dalam', 'poli-anak', 'poli-umum'].forEach((column) => {
    grouped[column].sort((a, b) => a.nomor - b.nomor);
  });
  lastQueueData = grouped;
  renderAllColumns();
}

function poliLabel(ruangan) {
  const cleaned = String(ruangan || '').trim();
  if (!cleaned) return 'poli';
  return 'poli ' + cleaned.replace(/^poli\s+/i, '');
}

function speakAnnouncement(name, ruangan) {
  const spokenName = normalizeNameForTts(name);
  const spokenRuangan = normalizeRuanganForTts(poliLabel(ruangan));
  const text = 'Kepada pasien atas nama ' + spokenName + ', silakan menuju ke ' + spokenRuangan + '.';
  speakRepeated(text, 2, 2500);
}

function handleCallSnapshot(snapshot) {
  const calls = snapshot.docs.map((doc) => ({
    id: doc.id,
    name: String(doc.data().name || '').trim(),
    ruangan: String(doc.data().ruangan || '').trim(),
  }));

  calledNames.clear();
  calls.forEach((c) => {
    if (c.name) calledNames.add(c.name);
  });
  lastCalls = calls;
  renderAllColumns();

  if (calls.length === 0) {
    lastCallId = null;
    return;
  }
  const top = calls[0];
  if (lastCallId === null) {
    lastCallId = top.id;
    return;
  }
  if (top.id === lastCallId) return;
  lastCallId = top.id;
  if (top.name) speakAnnouncement(top.name, top.ruangan);
}

async function init() {
  updateClock();
  setInterval(updateClock, 1000);

  onTtsStateChange(renderTtsStatus);

  if (speechSupported()) {
    const overlay = $('audioOverlay');
    if (overlay) overlay.classList.remove('hidden');
    ['click', 'touchstart', 'keydown'].forEach((evt) =>
      document.addEventListener(evt, unlockAudioAndHide)
    );
  }

  const { db } = initFirebase();
  db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
    if (err.code !== 'failed-precondition' && err.code !== 'unimplemented') {
      console.warn('Persistence poli:', err);
    }
  });

  db.collection('antrian_hari_ini')
    .where('TANGGAL', '==', localDateStr())
    .onSnapshot(handleQueueSnapshot, (err) => {
      setConnStatus('Koneksi realtime terputus: ' + err.message);
    });

  db.collection('poli_calls')
    .where('calledAt', '>=', new Date(new Date().setHours(0, 0, 0, 0)))
    .orderBy('calledAt', 'desc')
    .limit(50)
    .onSnapshot(handleCallSnapshot, () => {});

  setConnStatus('Terhubung - pembaruan otomatis aktif');

  window.addEventListener('offline', () => setConnStatus('Tidak ada koneksi internet'));
  window.addEventListener('online', () => setConnStatus('Terhubung - pembaruan otomatis aktif'));
}

init().catch((err) => {
  setConnStatus('Gagal memuat: ' + err.message);
  const el = $('fatalError');
  if (el) {
    el.textContent = 'Terjadi kesalahan: ' + err.message;
    el.classList.remove('hidden');
  }
});
