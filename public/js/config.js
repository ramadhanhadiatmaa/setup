// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBiUsrMSgMYyYQyOBQjWNUe7tVMSjR63tM",
  authDomain: "elisabeth-antrian.firebaseapp.com",
  projectId: "elisabeth-antrian",
  storageBucket: "elisabeth-antrian.firebasestorage.app",
  messagingSenderId: "536771099273",
  appId: "1:536771099273:web:33bee53c39150727ad2458",
  measurementId: "G-9V837DQ198"
};

const COUNTER_LABEL = 'Pendaftaran';
const QUEUE_PREFIX = 'A';

// Durasi panel panggilan tampil besar sebelum kembali ke mode idle (3 menit).
// Tiap ada panggilan baru (termasuk recall/nama) timer dihitung ulang dari awal.
const CALL_FOCUS_MS = 3 * 60 * 1000;

// Fallback bila dokumen settings/display belum ada. Kosong = video disembunyikan.
// Ganti video harian TIDAK lewat sini, melainkan via panel admin (Firestore settings/display).
const DEFAULT_YOUTUBE_URL = '';

// Dokumen tunggal untuk video display pendaftaran (dibaca semua display, ditulis admin login).
const DISPLAY_SETTINGS_COLLECTION = 'settings';
const DISPLAY_SETTINGS_DOC = 'display';

function extractYoutubeId(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  let m = s.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  m = s.match(/(?:youtu\.be\/|youtube\.com\/(?:live|embed|shorts|watch)\/)([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  return null;
}

function buildYoutubeEmbedUrl(videoId) {
  const id = String(videoId || '').trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  const params = 'autoplay=1&mute=1&controls=0&rel=0&playsinline=1&loop=1'
    + '&playlist=' + encodeURIComponent(id)
    + '&modestbranding=1&iv_load_policy=3&disablekb=1';
  return 'https://www.youtube-nocookie.com/embed/' + id + '?' + params;
}

function initFirebase() {
  if (!firebaseConfig || !firebaseConfig.apiKey || !firebaseConfig.projectId) {
    throw new Error('FIREBASE_CONFIG belum diisi di public/js/config.js (copy dari Firebase Console > Project settings > Your apps)');
  }
  firebase.initializeApp(firebaseConfig);
  return {
    auth: firebase.auth(),
    db: firebase.firestore(),
  };
}
