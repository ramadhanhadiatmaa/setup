let db = null;
let user = null;
let unsubQueues = null;
let unsubEvents = null;

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

function subscribeLive() {
  const today = localDateStr();
  const queuesQuery = db
    .collection('queues')
    .where('queueDate', '==', today);

  const eventsQuery = db
    .collection('call_events')
    .where('calledAt', '>=', localMidnight())
    .orderBy('calledAt', 'desc');

  unsubQueues = queuesQuery.onSnapshot((snap) => {
    const queues = snap.docs.map((d) => d.data());
    renderStatus(queues);
  });

  unsubEvents = eventsQuery.onSnapshot((snap) => {
    const events = snap.docs.map((d) => d.data());
    $('statTotal').textContent = String(events.length);
    renderLog(events);
  });
}

function unsubscribeLive() {
  if (unsubQueues) { unsubQueues(); unsubQueues = null; }
  if (unsubEvents) { unsubEvents(); unsubEvents = null; }
}

function setView(loggedIn) {
  hidden($('loginView'));
  hidden($('appView'));
  if (loggedIn) {
    show($('appView'));
    subscribeLive();
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
  const max = await maxQueueNumberToday();
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
    calledBy: user.uid,
    calledAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  await batch.commit();
  return num;
}

async function recall() {
  const cur = $('statLast').textContent;
  if (!cur || cur === '-') throw new Error('Belum ada nomor yang dipanggil hari ini');
  await db.collection('call_events').add({
    type: 'number',
    value: cur,
    calledBy: user.uid,
    calledAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

async function skipNext() {
  const today = localDateStr();
  const max = await maxQueueNumberToday();
  const num = QUEUE_PREFIX + String(max + 1).padStart(2, '0');
  const batch = db.batch();
  batch.set(db.collection('queues').doc(), {
    queueNumber: num,
    status: 'skipped',
    queueDate: today,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  await batch.commit();
  return num;
}

async function callManual(rawNumber) {
  const num = normalizeQueueNumber(rawNumber);
  if (!num) throw new Error('Format nomor antrian tidak valid');
  const today = localDateStr();
  const snap = await db.collection('queues').where('queueDate', '==', today).get();
  const existing = snap.docs.find((d) => d.data().queueNumber === num);
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
    calledBy: user.uid,
    calledAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  await batch.commit();
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
    $('counterLabel').textContent = COUNTER_LABEL;

    auth.onAuthStateChanged((u) => {
      user = u;
      if (u) {
        $('userEmail').textContent = u.email;
        setView(true);
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
