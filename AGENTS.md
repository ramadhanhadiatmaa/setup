# AGENTS.md

Sistem antrian RSU Santa Elisabeth: 3 halaman statis + Firebase (Firestore/Auth) + deploy Vercel.
TANPA build step, tanpa package.json, tanpa backend. Kode inti di `public/`.

## Perintah

- Dev lokal: `python3 serve.py` (port 8080; redirect /admin & /poli ke .html). Kalau dijalankan dari agent shell, pakai `setsid` agar bertahan.
- Verifikasi: `node --check public/js/*.js` (satu-satunya "test"). `curl http://localhost:8080/<path>` untuk cek halaman.
- Deploy: TIDAK dari agent shell — user push manual (kredensial GitHub hanya ada di terminal user). Vercel auto-deploy dari GitHub.
- Rules Firestore TIDAK ikut ter-deploy — setelah mengubah `firebase/firestore.rules`, user harus Publish manual di Firebase Console (Firestore → Rules).

## Halaman & alur

- `/` = display utama (index.html): subscribe `call_events`, tampil + TTS. `/admin` = admin (admin.html): menu bar [Pendaftaran | Poli]; Pendaftaran = call-next/recall/skip/manual/nama; Poli = 3 kolom nama + tombol Panggil. `/poli` = display poli (poli.html): 3 kolom + TTS 2x.
- Admin tulis: `queues` (number) + `call_events` (announcement) via baca-lalu-`db.batch()`; poli menulis `poli_calls` (name, ruangan). Display hanya baca.

## Firestore (field PERSIS, huruf besar kecil penting)

- `antrian_hari_ini`: field UPPERCASE `NAMA`, `NOMOR` (int), `RUANGAN`, `TANGGAL` ("YYYY-MM-DD"); read-only, diisi sistem lain. Kelompok kolom poli berdasar `RUANGAN` (lowercase contains): "penyakit dalam"→Penyakit Dalam, "anak"→Poli Anak, "umum"→Poli Umum; lainnya diabaikan.
- `queues`: queueNumber "A01" (padStart(2)), status, queueDate string, createdAt/calledAt. `call_events`: type number|name, value, title (Bapak/Ibu/null), calledAt. `poli_calls`: name, ruangan, calledBy, calledAt.
- Pembersihan data lama otomatis saat admin login (hapus queues/call_events sebelum hari ini).

## Gotchas kritis

- Firebase compat SDK 10.14.1 via CDN gstatic. `config.js` `initFirebase()` memanggil `firebase.auth()` — SEMUA halaman (termasuk display/poli) wajib load firebase-auth-compat.js, kalau tidak error "firebase.auth is not a function". Nama konstanta `firebaseConfig` (lowercase) — jangan diganti.
- `db.runTransaction` di layer compat HANYA menerima DocumentReference (query → error "Expected type 'nc'..."). Pola yang benar: baca di luar transaction, tulis dengan `db.batch()`.
- `call_events` WAJIB menyertakan field `title` (null untuk panggilan nomor, string/null untuk nama) — rules Firestore yang ter-publish menolak dokumen tanpa `title` dengan error "Missing or insufficient permissions" (baca di luar batch ok, tapi batch gagal total). Jangan hapus `title: null` di `callNext()`/`recall()`/`callManual()`.
- TTS Web Speech API: browser wajib tap/klik dulu (overlay "Ketuk layar untuk mengaktifkan suara" + unlockAudio()). Jangan hapus overlay itu. Format pengumuman di tts.js `buildAnnouncement`; panggilan poli memakai `speakRepeated` (2x, jeda 2,5 dtk SETELAH utterance pertama onend — jangan pakai setTimeout tetap, suara pertama akan terpotong) dan teks "Kepada pasien atas nama [NAMA], silakan menuju ke [poli-label]" (normalisasi: strip prefix "Poli " agar tidak "poli Poli Anak"). Nama yang diucapkan WAJIB lewat `normalizeNameForTts` (Title Case — voice mengeja ALL-CAPS per huruf) dan ruangan lewat `normalizeRuanganForTts` ("dr." → "dokter").
- Git: branch `main`; identitas repo-lokal ramadhanhadiatmaa (email GitHub terdaftar, disembunyikan) — email Wajib cocok akun GitHub atau Vercel blokir deploy. Riwayat pernah di-rebase: JANGAN pernah `git pull`/merge (unrelated histories); push dengan `git push --force-with-lease origin main`.
- Nomor antrian & label lokasi di config.js: QUEUE_PREFIX="A", COUNTER_LABEL="Pendaftaran".
