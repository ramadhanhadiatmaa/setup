let firebaseApp = null;
let lastAnnouncement = null;
let muted = false;
let lastTopId = null;
let focusTimer = null;
let currentVideoId = null;

const $ = (id) => document.getElementById(id);

function focusDurationMs() {
  return (typeof CALL_FOCUS_MS !== 'undefined' && CALL_FOCUS_MS > 0) ? CALL_FOCUS_MS : 3 * 60 * 1000;
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

function formatTime(ts) {
  const d = ts && ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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

let audioUnlocked = false;

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

function renderCurrent(event) {
  const isNumber = event.type === 'number';
  $('currentLabel').textContent = isNumber ? 'Sedang Dipanggil' : 'Panggilan Pasien';
  $('currentValue').textContent = event.value;
  $('dirCounter').textContent = COUNTER_LABEL;
}

function renderRecent(events) {
  const list = $('recentList');
  list.innerHTML = '';
  events.forEach((ev) => {
    const li = document.createElement('li');
    const badge = document.createElement('span');
    badge.className = 'recent-badge ' + (ev.type === 'number' ? 'num' : 'name');
    badge.textContent = ev.type === 'number' ? 'Nomor' : 'Nama';
    const val = document.createElement('span');
    val.className = 'recent-value';
    val.textContent = ev.value;
    const time = document.createElement('span');
    time.className = 'recent-time';
    time.textContent = formatTime(ev.calledAt);
    li.append(badge, val, time);
    list.appendChild(li);
  });
}

function eventFromDoc(doc) {
  const d = doc.data();
  return {
    id: doc.id,
    type: d.type,
    value: d.value,
    title: d.title || null,
    calledAt: d.calledAt,
  };
}

function handleSnapshot(snapshot) {
  const events = snapshot.docs.map(eventFromDoc);
  if (events.length === 0) {
    $('currentLabel').textContent = 'Menunggu Panggilan';
    $('currentValue').textContent = '\u2014';
    renderRecent([]);
    enterIdle();
    lastTopId = null;
    return;
  }
  renderCurrent(events[0]);
  renderRecent(events);

  const topId = events[0].id;
  if (lastTopId === null) {
    // Load awal / refresh: siapkan teks replay tapi jangan bunyikan ulang otomatis.
    lastAnnouncement = buildAnnouncement(events[0], {
      counterLabel: COUNTER_LABEL,
      queuePrefix: QUEUE_PREFIX,
    });
    const age = Date.now() - getCalledAtMs(events[0].calledAt);
    if (age >= 0 && age < focusDurationMs()) {
      enterCalling(focusDurationMs() - age);
    } else {
      enterIdle();
    }
  } else if (topId !== lastTopId) {
    // Panggilan baru (termasuk recall/nama/manual = dokumen baru) → fokus 3 mnt dari awal.
    lastAnnouncement = buildAnnouncement(events[0], {
      counterLabel: COUNTER_LABEL,
      queuePrefix: QUEUE_PREFIX,
    });
    speakText(lastAnnouncement);
    enterCalling();
  }
  lastTopId = topId;
}

async function init() {
  updateClock();
  setInterval(updateClock, 1000);
  $('dirCounter').textContent = COUNTER_LABEL;

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
      console.warn('Persistence display:', err);
    }
  });

  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);

  const query = db
    .collection('call_events')
    .where('calledAt', '>=', startToday)
    .orderBy('calledAt', 'desc')
    .limit(5);

  query.onSnapshot(
    handleSnapshot,
    (err) => {
      setConnStatus('Koneksi realtime terputus: ' + err.message);
    }
  );

  subscribeVideoSettings(db);

  setConnStatus('Terhubung - pembaruan otomatis aktif');

  window.addEventListener('offline', () => setConnStatus('Tidak ada koneksi internet'));
  window.addEventListener('online', () => setConnStatus('Terhubung - pembaruan otomatis aktif'));

  $('muteBtn').addEventListener('click', () => {
    muted = !muted;
    window.__queueMuted = muted;
    if (muted && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    else unlockAudio();
    $('muteBtn').textContent = muted ? 'Aktifkan Suara' : 'Nonaktifkan Suara';
  });

  $('replayBtn').addEventListener('click', () => {
    if (lastAnnouncement) {
      window.__queueMuted = false;
      muted = false;
      $('muteBtn').textContent = 'Nonaktifkan Suara';
      speakText(lastAnnouncement);
    }
  });

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
