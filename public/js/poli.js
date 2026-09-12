let lastCallId = null;
let audioUnlocked = false;
let muted = false;
let focusTimer = null;
let currentVideoId = null;
let lastAnnouncementText = null;
const calledNames = new Set();
let lastQueueData = null;
let lastCalls = [];

const $ = (id) => document.getElementById(id);

const POLI_GROUPS = [
  { key: 'penyakit-dalam', label: 'Penyakit Dalam' },
  { key: 'poli-anak', label: 'Poli Anak' },
  { key: 'poli-umum', label: 'Poli Umum' },
];

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

// ---------- Mode idle/calling ala display pendaftaran (durasi 2 menit) ----------

function focusDurationMs() {
  return (typeof POLI_FOCUS_MS !== 'undefined' && POLI_FOCUS_MS > 0) ? POLI_FOCUS_MS : 2 * 60 * 1000;
}

function setMode(mode) {
  document.body.classList.toggle('is-calling', mode === 'calling');
  document.body.classList.toggle('is-idle', mode !== 'calling');
}

function enterIdle() {
  clearTimeout(focusTimer);
  focusTimer = null;
  setMode('idle');
}

function enterCalling(remainingMs) {
  clearTimeout(focusTimer);
  setMode('calling');
  const ms = remainingMs && remainingMs > 0 ? remainingMs : focusDurationMs();
  focusTimer = setTimeout(enterIdle, ms);
}

function getCalledAtMs(calledAt) {
  try {
    if (!calledAt) return 0;
    if (calledAt.toDate) return calledAt.toDate().getTime();
    const t = new Date(calledAt).getTime();
    return Number.isNaN(t) ? 0 : t;
  } catch (err) {
    return 0;
  }
}

// ---------- Video: URL yang sama dengan display pendaftaran (settings/display) ----------

function applyVideoId(videoId) {
  const frame = $('liveVideo');
  const pane = $('videoPane');
  const fallback = $('videoFallback');
  if (!frame || !pane) return;
  if (!videoId) {
    currentVideoId = null;
    frame.removeAttribute('src');
    pane.classList.add('no-video');
    if (fallback) fallback.classList.remove('hidden');
    return;
  }
  if (videoId === currentVideoId && frame.getAttribute('src')) return;
  currentVideoId = videoId;
  const url = buildYoutubeEmbedUrl(videoId);
  if (!url) return;
  // Satu-satunya tempat src ditulis; ganti mode idle/calling hanya tukar class CSS
  // agar iframe tidak reload.
  frame.setAttribute('src', url);
  pane.classList.remove('no-video');
  if (fallback) fallback.classList.add('hidden');
}

function applyYoutubeUrl(rawUrl) {
  const id = (typeof extractYoutubeId === 'function') ? extractYoutubeId(rawUrl) : null;
  applyVideoId(id);
}

function subscribeVideoSettings(db) {
  try {
    const params = new URLSearchParams(location.search);
    const override = params.get('live') || params.get('video') || '';
    const overrideId = override && typeof extractYoutubeId === 'function'
      ? extractYoutubeId(override)
      : null;
    if (overrideId) {
      applyVideoId(overrideId);
      return;
    }
    if (typeof DEFAULT_YOUTUBE_URL !== 'undefined' && DEFAULT_YOUTUBE_URL) {
      applyYoutubeUrl(DEFAULT_YOUTUBE_URL);
    } else {
      applyVideoId(null);
    }
    const col = (typeof DISPLAY_SETTINGS_COLLECTION !== 'undefined') ? DISPLAY_SETTINGS_COLLECTION : 'settings';
    const docId = (typeof DISPLAY_SETTINGS_DOC !== 'undefined') ? DISPLAY_SETTINGS_DOC : 'display';
    db.collection(col).doc(docId).onSnapshot((snap) => {
      if (!snap.exists) {
        if (!currentVideoId) applyVideoId(null);
        return;
      }
      applyYoutubeUrl(snap.data().youtubeUrl || '');
    }, (err) => {
      console.warn('Video settings:', err);
    });
  } catch (err) {
    console.warn('Video settings:', err);
  }
}

// ---------- Daftar antrian (ticker vertikal loop) ----------

function classifyRuangan(ruangan) {
  const r = String(ruangan || '').toLowerCase();
  if (r.includes('penyakit dalam')) return 'penyakit-dalam';
  if (r.includes('anak')) return 'poli-anak';
  if (r.includes('umum')) return 'poli-umum';
  return null;
}

function buildTickerGroup(group) {
  const list = lastQueueData ? (lastQueueData[group.key] || []) : [];
  const sec = document.createElement('div');
  sec.className = 'poli-ticker-group';
  const h = document.createElement('h3');
  h.className = 'poli-ticker-group-title';
  h.textContent = group.label + ' (' + list.length + ')';
  sec.appendChild(h);
  if (list.length === 0) {
    const p = document.createElement('p');
    p.className = 'poli-empty';
    p.textContent = lastQueueData ? 'Belum ada antrian' : 'Memuat...';
    sec.appendChild(p);
    return sec;
  }
  const ul = document.createElement('ul');
  ul.className = 'poli-ticker-list';
  list.forEach((p) => {
    const li = document.createElement('li');
    li.className = 'poli-ticker-item' + (calledNames.has(p.name) ? ' poli-called' : '');
    const num = document.createElement('span');
    num.className = 'poli-ticker-num';
    num.textContent = p.nomor > 0 ? String(p.nomor) : '-';
    const name = document.createElement('span');
    name.className = 'poli-ticker-name';
    name.textContent = p.name;
    li.append(num, name);
    ul.appendChild(li);
  });
  sec.appendChild(ul);
  return sec;
}

function renderPoliTicker() {
  const ticker = $('poliTicker');
  if (!ticker) return;
  ticker.innerHTML = '';
  let total = 0;
  if (lastQueueData) {
    POLI_GROUPS.forEach((g) => {
      total += (lastQueueData[g.key] || []).length;
    });
  }
  if (!lastQueueData || total === 0) {
    if (!lastQueueData) {
      POLI_GROUPS.forEach((g) => ticker.appendChild(buildTickerGroup(g)));
    } else {
      const p = document.createElement('p');
      p.className = 'poli-empty';
      p.textContent = 'Belum ada antrian hari ini';
      ticker.appendChild(p);
    }
    ticker.classList.add('no-anim');
    ticker.style.removeProperty('--ticker-duration');
    return;
  }
  // Selalu animasi selama ada >= 1 pasien. Konten diulang sebanyak salinan
  // genap (wajib genap agar loop translateY(-50%) tetap mulus); makin sedikit
  // data, makin banyak salinan agar viewport terisi dan tidak ada jeda kosong.
  let copies = Math.ceil(12 / Math.max(1, total));
  if (copies < 2) copies = 2;
  if (copies % 2 !== 0) copies += 1;
  for (let i = 0; i < copies; i++) {
    POLI_GROUPS.forEach((g) => {
      const sec = buildTickerGroup(g);
      if (i > 0) sec.setAttribute('aria-hidden', 'true');
      ticker.appendChild(sec);
    });
  }
  ticker.classList.remove('no-anim');
  ticker.style.setProperty('--ticker-duration', Math.min(120, Math.max(20, total * 4)) + 's');
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
  Object.keys(grouped).forEach((column) => {
    grouped[column].sort((a, b) => a.nomor - b.nomor);
  });
  lastQueueData = grouped;
  renderPoliTicker();
}

// ---------- Panggilan poli ----------

function poliLabel(ruangan) {
  const cleaned = String(ruangan || '').trim();
  if (!cleaned) return 'poli';
  return 'poli ' + cleaned.replace(/^poli\s+/i, '');
}

function buildPoliAnnouncementText(name, ruangan) {
  const spokenName = normalizeNameForTts(name);
  const spokenRuangan = normalizeRuanganForTts(poliLabel(ruangan));
  return 'Kepada pasien atas nama ' + spokenName + ', silakan menuju ke ' + spokenRuangan + '.';
}

function speakAnnouncement(name, ruangan) {
  speakRepeated(buildPoliAnnouncementText(name, ruangan), 2, 2500);
}

function renderCurrentCall(call) {
  const labelEl = $('poliCallLabel');
  const nameEl = $('poliCallName');
  const roomEl = $('poliCallRoom');
  if (!labelEl || !nameEl || !roomEl) return;
  if (!call || !call.name) {
    labelEl.textContent = 'Menunggu Panggilan';
    nameEl.textContent = '\u2014';
    roomEl.textContent = 'poli';
    return;
  }
  labelEl.textContent = 'Sedang Dipanggil';
  nameEl.textContent = call.name;
  roomEl.textContent = poliLabel(call.ruangan);
}

function handleCallSnapshot(snapshot) {
  const calls = snapshot.docs.map((doc) => ({
    id: doc.id,
    name: String(doc.data().name || '').trim(),
    ruangan: String(doc.data().ruangan || '').trim(),
    calledAt: doc.data().calledAt,
  }));

  calledNames.clear();
  calls.forEach((c) => {
    if (c.name) calledNames.add(c.name);
  });
  lastCalls = calls;
  renderPoliTicker();

  if (calls.length === 0) {
    lastCallId = null;
    lastAnnouncementText = null;
    renderCurrentCall(null);
    enterIdle();
    return;
  }
  const top = calls[0];
  renderCurrentCall(top);
  if (lastCallId === null) {
    // Load awal / refresh: siapkan teks replay tapi jangan bunyikan ulang otomatis.
    lastCallId = top.id;
    lastAnnouncementText = top.name ? buildPoliAnnouncementText(top.name, top.ruangan) : null;
    const age = Date.now() - getCalledAtMs(top.calledAt);
    if (age >= 0 && age < focusDurationMs()) {
      enterCalling(focusDurationMs() - age);
    } else {
      enterIdle();
    }
    return;
  }
  if (top.id === lastCallId) return;
  // Panggilan baru (recall = dokumen baru) → fokus 2 mnt dari awal.
  lastCallId = top.id;
  if (top.name) {
    lastAnnouncementText = buildPoliAnnouncementText(top.name, top.ruangan);
    speakAnnouncement(top.name, top.ruangan);
  }
  enterCalling();
}

async function init() {
  updateClock();
  setInterval(updateClock, 1000);
  renderPoliTicker();

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

  subscribeVideoSettings(db);

  setConnStatus('Terhubung - pembaruan otomatis aktif');

  window.addEventListener('offline', () => setConnStatus('Tidak ada koneksi internet'));
  window.addEventListener('online', () => setConnStatus('Terhubung - pembaruan otomatis aktif'));

  const muteBtn = $('muteBtn');
  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      muted = !muted;
      window.__queueMuted = muted;
      if (muted && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
      else unlockAudio();
      muteBtn.textContent = muted ? 'Aktifkan Suara' : 'Nonaktifkan Suara';
    });
  }

  const replayBtn = $('replayBtn');
  if (replayBtn) {
    replayBtn.addEventListener('click', () => {
      if (lastAnnouncementText) {
        window.__queueMuted = false;
        muted = false;
        if (muteBtn) muteBtn.textContent = 'Nonaktifkan Suara';
        speakRepeated(lastAnnouncementText, 2, 2500);
      }
    });
  }

  window.__queueMuted = false;
}

init().catch((err) => {
  setConnStatus('Gagal memuat: ' + err.message);
  const el = $('fatalError');
  if (el) {
    el.textContent = 'Terjadi kesalahan: ' + err.message;
    el.classList.remove('hidden');
  }
});
