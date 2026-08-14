const UNITS = ['nol', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];

function numberToWordsId(n) {
  if (n < 0 || !Number.isFinite(n)) return String(n);
  if (n < 12) return UNITS[n];
  if (n < 20) return numberToWordsId(n - 10) + ' belas';
  if (n < 100) {
    const puluh = Math.floor(n / 10);
    const sisa = n % 10;
    const kata = puluh === 1 ? 'sepuluh' : UNITS[puluh];
    return sisa === 0 ? kata + ' puluh' : kata + ' puluh ' + UNITS[sisa];
  }
  if (n < 1000) {
    const ratus = Math.floor(n / 100);
    const sisa = n % 100;
    const kata = ratus === 1 ? 'seratus' : UNITS[ratus] + ' ratus';
    return sisa === 0 ? kata : kata + ' ' + numberToWordsId(sisa);
  }
  if (n < 1000000) {
    const ribu = Math.floor(n / 1000);
    const sisa = n % 1000;
    const kata = ribu === 1 ? 'seribu' : numberToWordsId(ribu) + ' ribu';
    return sisa === 0 ? kata : kata + ' ' + numberToWordsId(sisa);
  }
  return String(n);
}

function queueNumberToWords(value, prefix) {
  const cleaned = String(value).toUpperCase().trim();
  const digits = cleaned.startsWith(prefix) ? cleaned.slice(prefix.length) : cleaned;
  const number = parseInt(digits, 10);
  if (Number.isNaN(number)) return cleaned;
  return prefix + ' ' + numberToWordsId(number);
}

let preferredVoice = null;
const ttsListeners = [];

function pickIndonesianVoice() {
  if (typeof speechSynthesis === 'undefined') return;
  const voices = speechSynthesis.getVoices();
  preferredVoice =
    voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('id')) || null;
  notifyTtsListeners();
}

if (typeof speechSynthesis !== 'undefined') {
  pickIndonesianVoice();
  speechSynthesis.onvoiceschanged = pickIndonesianVoice;
}

function ttsState() {
  if (typeof speechSynthesis === 'undefined') {
    return { supported: false, voices: 0, hasVoice: false, hasIdVoice: false };
  }
  const voices = speechSynthesis.getVoices();
  return {
    supported: true,
    voices: voices.length,
    hasVoice: voices.length > 0,
    hasIdVoice: voices.some((v) => v.lang && v.lang.toLowerCase().startsWith('id')),
  };
}

function notifyTtsListeners() {
  const state = ttsState();
  ttsListeners.forEach((fn) => fn(state));
}

function onTtsStateChange(fn) {
  ttsListeners.push(fn);
  fn(ttsState());
}

function unlockAudio() {
  if (typeof speechSynthesis === 'undefined') return;
  speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(' ');
  utter.volume = 0;
  utter.onstart = () => speechSynthesis.cancel();
  speechSynthesis.speak(utter);
  notifyTtsListeners();
}

function speakText(text) {
  if (typeof speechSynthesis === 'undefined' || window.__queueMuted) return;
  speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'id-ID';
  utter.rate = 0.95;
  if (preferredVoice) utter.voice = preferredVoice;
  utter.onerror = () => notifyTtsListeners();
  speechSynthesis.speak(utter);
}

function speechSupported() {
  return typeof speechSynthesis !== 'undefined';
}

function buildAnnouncement(event, cfg) {
  const counter = cfg.counterLabel || 'loket';
  if (event.type === 'number') {
    const words = queueNumberToWords(event.value, cfg.queuePrefix || 'A');
    return 'Nomor antrian ' + words + ', silakan menuju ' + counter + '.';
  }
  return 'Kepada ' + event.value + ', silakan menuju ' + counter + '.';
}
