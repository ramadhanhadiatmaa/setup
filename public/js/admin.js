let db = null;
let user = null;
let unsubQueues = null;
let unsubEvents = null;
let unsubVideo = null;

const $ = (id) => document.getElementById(id);
const hidden = (el) => el.classList.add('hidden');
const show = (el) => el.classList.remove('hidden');

function formatTime(ts) {
  const d = ts && ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function localMidnight() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function normalizeQueueNumber(raw) {
  const s = String(raw).trim().toUpperCase();
  if (!s) return null;
  const digits = s.startsWith(QUEUE_PREFIX) ? s.slice(QUEUE_PREFIX.length) : s;
  const n = parseInt(digits, 10);
  if (Number.isNaN(n) || n < 1 || n > 9999) return null;
  return QUEUE_PREFIX + String(n).padStart(2, '0');
}

function parseQueueNum(value) {
  const n = parseInt(String(value).replace(/^[A-Za-z]+/, ''), 10);
  return Number.isNaN(n) ? 0 : n;
}

let toastTimer = null;
function showToast(message, isError) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.toggle('error', !!isError);
  show(toast);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hidden(toast), 3500);
}

function renderLog(events) {
  const list = $('logList');
  list.innerHTML = '';
  events.slice(0, 20).forEach((ev) => {
    const li = document.createElement('li');
    const badge = document.createElement('span');
    badge.className = 'recent-badge ' + (ev.type === 'number' ? 'num' : 'name');
    badge.textContent = ev.type === 'number' ? 'Nomor' : 'Nama';
    const val = document.createElement('span');
    val.className = 'log-value';
    val.textContent = ev.value;
    const time = document.createElement('span');
    time.className = 'recent-time';
    time.textContent = formatTime(ev.calledAt);
    li.append(badge, val, time);
    list.appendChild(li);
  });
}

function renderStatus(queues) {
  let lastNumber = null;
  let lastCalledAt = 0;
  let max = 0;
  queues.forEach((q) => {
    const n = parseQueueNum(q.queueNumber);
    if (n > max) max = n;
    const t = q.calledAt && q.calledAt.toMillis ? q.calledAt.toMillis() : 0;
    if (q.status === 'called' && t >= lastCalledAt) {
      lastCalledAt = t;
      lastNumber = q.queueNumber;
    }
  });
  $('statLast').textContent = lastNumber || '-';
  $('statNext').textContent = QUEUE_PREFIX + String(max + 1).padStart(2, '0');
}

let lastListenerError = null;

function onLiveError(source, err) {
  const msg = source + ': ' + err.message;
  if (msg === lastListenerError) return;
  lastListenerError = msg;
  showToast('Gagal membaca data ' + source + ': ' + err.message, true);
}

function subscribeLive() {
  const today = localDateStr();
  const queuesQuery = db
    .collection('queues')
    .where('queueDate', '==', today);

  const eventsQuery = db
    .collection('call_events')
    .where('calledAt', '>=', localMidnight())
    .orderBy('calledAt', 'desc');

  unsubQueues = queuesQuery.onSnapshot(
    (snap) => {
      const queues = snap.docs.map((d) => d.data());
      renderStatus(queues);
    },
    (err) => onLiveError('antrian (queues)', err)
  );

  unsubEvents = eventsQuery.onSnapshot(
    (snap) => {
      const events = snap.docs.map((d) => d.data());
      $('statTotal').textContent = String(events.length);
      renderLog(events);
    },
    (err) => onLiveError('riwayat panggilan', err)
  );
}

function unsubscribeLive() {
  if (unsubQueues) { unsubQueues(); unsubQueues = null; }
  if (unsubEvents) { unsubEvents(); unsubEvents = null; }
  if (unsubVideo) { unsubVideo(); unsubVideo = null; }
}

function renderVideoStatus(rawUrl) {
  const el = $('videoStatus');
  if (!el) return;
  const id = typeof extractYoutubeId === 'function' ? extractYoutubeId(rawUrl) : null;
  if (!rawUrl) {
    el.textContent = 'Video nonaktif — display hanya menampilkan antrian.';
  } else if (id) {
    el.textContent = 'Sedang tayang (ID: ' + id + ') — berlaku di semua display pendaftaran.';
  } else {
    el.textContent = 'Tersimpan tapi format tidak dikenali — periksa URL dan simpan ulang.';
  }
}

function subscribeVideoSettings() {
  const input = $('videoUrlInput');
  try {
    const docRef = db.collection(DISPLAY_SETTINGS_COLLECTION).doc(DISPLAY_SETTINGS_DOC);
    docRef.get().then((snap) => {
      const raw = snap.exists ? (snap.data().youtubeUrl || '') : '';
      if (input && document.activeElement !== input) input.value = raw;
      renderVideoStatus(raw);
    }).catch((err) => onLiveError('pengaturan video', err));
    unsubVideo = docRef.onSnapshot((snap) => {
      const raw = snap.exists ? (snap.data().youtubeUrl || '') : '';
      if (input && document.activeElement !== input) input.value = raw;
      renderVideoStatus(raw);
    }, (err) => onLiveError('pengaturan video', err));
  } catch (err) {
    onLiveError('pengaturan video', err);
  }
}

async function saveVideoSettings(rawInput) {
  const raw = String(rawInput || '').trim();
  if (raw && typeof extractYoutubeId === 'function' && !extractYoutubeId(raw)) {
    throw new Error('URL/ID YouTube tidak valid. Contoh: https://www.youtube.com/live/VIDEO_ID atau ID 11 karakter.');
  }
  if (raw.length > 500) throw new Error('URL terlalu panjang (maks 500 karakter).');
  await db.collection(DISPLAY_SETTINGS_COLLECTION).doc(DISPLAY_SETTINGS_DOC).set({
    youtubeUrl: raw,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: user.uid,
  }, { merge: true });
}

function setView(loggedIn) {
  hidden($('loginView'));
  hidden($('appView'));
  if (loggedIn) {
    show($('appView'));
    subscribeLive();
    subscribeVideoSettings();
  } else {
    unsubscribeLive();
    show($('loginView'));
  }
}

async function maxQueueNumberToday() {
  const today = localDateStr();
  const snap = await db.collection('queues').where('queueDate', '==', today).get();
  let max = 0;
  snap.forEach((d) => {
    const n = parseQueueNum(d.data().queueNumber);
    if (n > max) max = n;
  });
  return max;
}

async function callNext() {
  const today = localDateStr();
  let max;
  try {
    max = await maxQueueNumberToday();
  } catch (err) {
    throw new Error('Gagal membaca data antrian: ' + err.message);
  }
  const num = QUEUE_PREFIX + String(max + 1).padStart(2, '0');
  const batch = db.batch();
  batch.set(db.collection('queues').doc(), {
    queueNumber: num,
    status: 'called',
    queueDate: today,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    calledAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  batch.set(db.collection('call_events').doc(), {
    type: 'number',
    value: num,
    title: null,
    calledBy: user.uid,
    calledAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (err) {
    throw new Error('Gagal menulis antrian: ' + err.message);
  }
  return num;
}

async function recall() {
  const cur = $('statLast').textContent;
  if (!cur || cur === '-') throw new Error('Belum ada nomor yang dipanggil hari ini');
  await db.collection('call_events').add({
    type: 'number',
    value: cur,
    title: null,
    calledBy: user.uid,
    calledAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

async function skipNext() {
  const today = localDateStr();
  let max;
  try {
    max = await maxQueueNumberToday();
  } catch (err) {
    throw new Error('Gagal membaca data antrian: ' + err.message);
  }
  const num = QUEUE_PREFIX + String(max + 1).padStart(2, '0');
  const batch = db.batch();
  batch.set(db.collection('queues').doc(), {
    queueNumber: num,
    status: 'skipped',
    queueDate: today,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (err) {
    throw new Error('Gagal menulis antrian: ' + err.message);
  }
  return num;
}

async function callManual(rawNumber) {
  const num = normalizeQueueNumber(rawNumber);
  if (!num) throw new Error('Format nomor antrian tidak valid');
  const today = localDateStr();
  let existing = null;
  try {
    const snap = await db.collection('queues').where('queueDate', '==', today).get();
    existing = snap.docs.find((d) => d.data().queueNumber === num);
  } catch (err) {
    throw new Error('Gagal membaca data antrian: ' + err.message);
  }
  const batch = db.batch();
  if (!existing) {
    batch.set(db.collection('queues').doc(), {
      queueNumber: num,
      status: 'called',
      queueDate: today,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      calledAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } else if (existing.data().status !== 'called') {
    batch.update(existing.ref, {
      status: 'called',
      calledAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  }
  batch.set(db.collection('call_events').doc(), {
    type: 'number',
    value: num,
    title: null,
    calledBy: user.uid,
    calledAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (err) {
    throw new Error('Gagal menulis antrian: ' + err.message);
  }
  return num;
}

async function callName(name, title) {
  const cleaned = String(name).trim();
  if (!cleaned) throw new Error('Masukkan nama pasien terlebih dahulu');
  if (cleaned.length > 100) throw new Error('Nama terlalu panjang (maks 100 karakter)');
  await db.collection('call_events').add({
    type: 'name',
    value: cleaned,
    title: title || null,
    calledBy: user.uid,
    calledAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  return { name: cleaned, title: title || null };
}

const POLI_COLUMNS = {
  'penyakit-dalam': { id: 'poliListPenyakitDalam' },
  'poli-anak': { id: 'poliListPoliAnak' },
  'poli-umum': { id: 'poliListPoliUmum' },
};
const poliCalledNames = new Set();
let poliQueueData = null;

function poliColumnKey(ruangan) {
  const r = String(ruangan || '').toLowerCase();
  if (r.includes('penyakit dalam')) return 'penyakit-dalam';
  if (r.includes('anak')) return 'poli-anak';
  if (r.includes('umum')) return 'poli-umum';
  return null;
}

function renderPoliAdmin() {
  if (!poliQueueData) return;
  Object.keys(POLI_COLUMNS).forEach((key) => {
    const list = $(POLI_COLUMNS[key].id);
    list.innerHTML = '';
    const patients = poliQueueData[key] || [];
    if (patients.length === 0) {
      const li = document.createElement('li');
      li.className = 'poli-empty';
      li.textContent = 'Belum ada antrian';
      list.appendChild(li);
      return;
    }
    patients.forEach((p) => {
      const li = document.createElement('li');
      li.className = 'poli-admin-row';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'poli-admin-name';
      nameSpan.textContent = p.name;
      const btn = document.createElement('button');
      btn.className = 'btn poli-admin-btn';
      const called = poliCalledNames.has(p.name);
      btn.classList.toggle('called', called);
      btn.textContent = called ? 'Sudah Dipanggil' : 'Panggil';
      btn.addEventListener('click', () => callPoliPatient(p.name, p.ruangan, btn));
      li.append(nameSpan, btn);
      list.appendChild(li);
    });
  });
}

function loadPoliAdmin() {
  db.collection('antrian_hari_ini')
    .where('TANGGAL', '==', localDateStr())
    .onSnapshot((snap) => {
      const grouped = { 'penyakit-dalam': [], 'poli-anak': [], 'poli-umum': [] };
      snap.docs.forEach((doc) => {
        const d = doc.data();
        const key = poliColumnKey(d.RUANGAN);
        if (!key) return;
        grouped[key].push({
          name: String(d.NAMA || '').trim(),
          ruangan: String(d.RUANGAN || '').trim(),
          nomor: typeof d.NOMOR === 'number' ? d.NOMOR : 0,
        });
      });
      Object.keys(grouped).forEach((key) =>
        grouped[key].sort((a, b) => a.nomor - b.nomor)
      );
      poliQueueData = grouped;
      renderPoliAdmin();
    }, (err) => {
      showToast('Gagal memuat daftar pasien poli: ' + err.message, true);
    });

  db.collection('poli_calls')
    .where('calledAt', '>=', localMidnight())
    .onSnapshot((snap) => {
      poliCalledNames.clear();
      snap.docs.forEach((doc) => {
        const name = String(doc.data().name || '').trim();
        if (name) poliCalledNames.add(name);
      });
      renderPoliAdmin();
    }, () => {});
}

async function callPoliPatient(name, ruangan, btn) {
  try {
    poliCalledNames.add(name);
    renderPoliAdmin();
    await db.collection('poli_calls').add({
      name: name,
      ruangan: ruangan,
      calledBy: user.uid,
      calledAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    showToast(name + ' dipanggil ke ' + (ruangan || 'poli'));
  } catch (err) {
    poliCalledNames.delete(name);
    renderPoliAdmin();
    showToast(err.message, true);
  }
}

async function deleteExpiredDocs(query) {
  for (;;) {
    const snap = await query.get();
    if (snap.empty) break;
    const chunk = snap.docs.slice(0, 500);
    const batch = db.batch();
    chunk.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (snap.docs.length <= 500) break;
  }
}

async function cleanupOldData() {
  try {
    await deleteExpiredDocs(
      db.collection('queues').where('queueDate', '<', localDateStr())
    );
    await deleteExpiredDocs(
      db.collection('call_events').where('calledAt', '<', localMidnight())
    );
  } catch (err) {
    console.warn('Pembersihan data lama gagal:', err);
  }
}

function bindActions() {
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('loginError').textContent = '';
    $('loginBtn').disabled = true;
    try {
      await firebase.auth().signInWithEmailAndPassword(
        $('loginEmail').value.trim(),
        $('loginPassword').value
      );
    } catch (err) {
      $('loginError').textContent = 'Email atau password salah.';
    }
    $('loginBtn').disabled = false;
  });

  $('logoutBtn').addEventListener('click', () => firebase.auth().signOut());

  $('callNextBtn').addEventListener('click', async () => {
    try {
      await callNext();
      showToast('Nomor berikutnya dipanggil');
    } catch (err) {
      showToast(err.message, true);
    }
  });

  $('recallBtn').addEventListener('click', async () => {
    try {
      await recall();
      showToast('Panggilan diulang');
    } catch (err) {
      showToast(err.message, true);
    }
  });

  $('skipBtn').addEventListener('click', async () => {
    try {
      await skipNext();
      showToast('Nomor berikutnya dilewati');
    } catch (err) {
      showToast(err.message, true);
    }
  });

  $('manualBtn').addEventListener('click', async () => {
    try {
      const num = await callManual($('manualNumber').value);
      showToast('Nomor ' + num + ' dipanggil');
      $('manualNumber').value = '';
    } catch (err) {
      showToast(err.message, true);
    }
  });

  $('nameBtn').addEventListener('click', async () => {
    try {
      const result = await callName($('nameInput').value, $('nameTitle').value);
      const label = result.title ? result.title + ' ' + result.name : 'Kepada ' + result.name;
      showToast(label + ' dipanggil');
      $('nameInput').value = '';
    } catch (err) {
      showToast(err.message, true);
    }
  });

  $('menuPendaftaran').addEventListener('click', () => setTab('pendaftaran'));
  $('menuPoli').addEventListener('click', () => setTab('poli'));

  $('videoSaveBtn').addEventListener('click', async () => {
    try {
      await saveVideoSettings($('videoUrlInput').value);
      showToast('Video display diperbarui');
    } catch (err) {
      showToast(err.message, true);
    }
  });

  $('videoDisableBtn').addEventListener('click', async () => {
    try {
      await saveVideoSettings('');
      $('videoUrlInput').value = '';
      showToast('Video display dinonaktifkan');
    } catch (err) {
      showToast(err.message, true);
    }
  });
}

function setTab(tab) {
  localStorage.setItem('adminTab', tab);
  $('menuPendaftaran').classList.toggle('active', tab === 'pendaftaran');
  $('menuPoli').classList.toggle('active', tab === 'poli');
  hidden($('viewPendaftaran'));
  hidden($('viewPoli'));
  show(tab === 'pendaftaran' ? $('viewPendaftaran') : $('viewPoli'));
}

function showFatalError(message) {
  const el = $('fatalError');
  el.textContent = 'Terjadi kesalahan: ' + message;
  show(el);
}

let cleanupRan = false;

function init() {
  try {
    const { db: firestore, auth } = initFirebase();
    db = firestore;

    auth.onAuthStateChanged((u) => {
      user = u;
      if (u) {
        $('userEmail').textContent = u.email;
        setView(true);
        loadPoliAdmin();
        setTab(localStorage.getItem('adminTab') === 'poli' ? 'poli' : 'pendaftaran');
        if (!cleanupRan) {
          cleanupRan = true;
          cleanupOldData();
        }
      } else {
        cleanupRan = false;
        setView(false);
      }
    });

    bindActions();
  } catch (err) {
    showFatalError(err.message);
  }
}

init();
