# Sistem Display & Pemanggil Antrian — RSU Santa Elisabeth

Sistem antrian digital untuk 1 loket dengan dua halaman statis:

- **`/` (Display)** — ditampilkan di TV ruang tunggu. Menampilkan nomor/nama yang dipanggil (font besar), riwayat 5 panggilan terakhir, dan suara panggilan otomatis (Web Speech API, bahasa Indonesia).
- **`/admin` (Petugas)** — login email/password, tombol Panggil Berikutnya, Panggil Ulang, Skip, panggil nomor manual, dan panggil berdasarkan nama pasien.

## Arsitektur

| Layer | Teknologi |
|---|---|
| Frontend | HTML/JS murni (tanpa build step) |
| Database + Realtime | Firebase Firestore (listener `onSnapshot`) |
| Auth | Firebase Auth (email/password) |
| Keamanan | Firestore Security Rules |
| Hosting | Vercel (Hobby/free) |
| Text-to-Speech | Web Speech API bawaan browser |

Alur: Petugas menekan tombol di `/admin` → halaman menulis langsung ke koleksi `queues` dan `call_events` di Firestore (transaction atomik) → halaman Display menerima update otomatis lewat `onSnapshot` → Display menampilkan + membacakan panggilan.

## 1. Setup Firebase (sekali saja)

1. Buka [console.firebase.google.com](https://console.firebase.google.com) → **Add project** (nama bebas).
2. **Build → Authentication → Get started → Sign-in method** → aktifkan **Email/Password** → **Save**.
3. Buat akun petugas: **Authentication → Users → Add user** → isi email + password (mis. `loket1@rs.com`). Akun ini yang dipakai login di halaman `/admin`.
4. **Build → Firestore Database → Create database**:
   - Mode: **Production mode**
   - Region: **asia-southeast1** (Singapore — terdekat ke Indonesia)
5. Buka tab **Rules** → ganti isinya dengan seluruh isi file `firebase/firestore.rules` → **Publish**.
6. **Project settings (ikon gear) → General** → di bagian **Your apps**, klik **Web app `</>`** → daftarkan aplikasi → salin nilai `firebaseConfig` (apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId) → tempel ke `public/js/config.js` di dalam objek `FIREBASE_CONFIG`.

> Nilai `firebaseConfig` memang dirancang publik oleh Firebase — aman dicantumkan di file statis. Keamanan data diatur oleh Security Rules.

## 2. Menjalankan Lokal

Tidak perlu install apa pun. Dari folder project:

```bash
python3 serve.py
```

Buka `http://localhost:8080/` (display) dan `http://localhost:8080/admin` (petugas; otomatis dialihkan ke `/admin.html`). Untuk menguji realtime, buka keduanya di **2 window/device berbeda**, lalu panggil antrian dari halaman admin.

> `serve.py` adalah server statis berbasis stdlib Python (tanpa dependency). Alternatif: `cd public && python3 -m http.server 8080` — tapi ingat versi ini **tidak** me-redirect `/admin`, jadi buka langsung `/admin.html`.

> Pastikan `FIREBASE_CONFIG` sudah terisi terlebih dahulu (langkah 6 di atas).

## 3. Deploy ke Vercel

```bash
vercel login
vercel          # konekkan folder ini sebagai project baru
vercel --prod   # deploy produksi
```

Setelah deploy, uji dari 2 perangkat berbeda. Test TTS di browser/perangkat TV yang akan benar-benar dipasang di ruang tunggu (dukungan suara Bahasa Indonesia berbeda-beda antar browser/OS — jika tidak ada suara, teks besar di layar tetap tampil).

## 4. Cara Pakai (Petugas)

1. Buka `https://<domain>/admin`, login dengan akun yang dibuat di Firebase.
2. **Panggil Berikutnya** — memanggil nomor urut berikutnya hari ini (`A01`, `A02`, ...; reset otomatis tiap hari karena `queueDate`).
3. **Panggil Ulang** — mengumumkan ulang nomor terakhir (pasien belum datang).
4. **Skip Nomor** — melewati nomor berikutnya (tidak diumumkan).
5. **Panggil Nomor Manual** — ketik `15` atau `A15` untuk memanggil nomor tertentu (prioritas/lansia).
6. **Panggil Berdasarkan Nama** — ketik nama pasien (mis. panggilan hasil lab) → display menampilkan nama + suara "Bapak/Ibu [nama], silakan menuju Loket 1."

Halaman Display (buka di TV): panggilan terbaru tampil besar di tengah, riwayat 5 panggilan terakhir, jam, tombol **Nonaktifkan Suara** dan **Ulangi Panggilan Terakhir**.

## 5. Struktur Project

```
public/
  index.html        halaman Display
  admin.html        halaman Petugas
  css/style.css     styling (tema display kontras tinggi + admin)
  js/config.js      firebaseConfig + COUNTER_LABEL + QUEUE_PREFIX
  js/tts.js         TTS id-ID + konversi angka ke kata (A02 -> "A dua")
  js/display.js     subscribe call_events, tampil + bicara
  js/admin.js       login + aksi antrian (get + batch tulis)
firebase/
  firestore.rules   tempel ke console Firebase (Firestore -> Rules)
vercel.json         rewrite /admin -> /admin.html
```

## 6. Skema Data (Firestore)

Koleksi `queues` (satu dokumen per nomor):

| Field | Tipe | Keterangan |
|---|---|---|
| queueNumber | string | contoh: `A02` |
| status | string | `waiting`, `called`, `done`, `skipped` |
| queueDate | string | `2026-08-13` (reset harian) |
| createdAt | timestamp | |
| calledAt | timestamp | opsional, saat dipanggil |

Koleksi `call_events` (satu dokumen per pengumuman — display hanya subscribe ini):

| Field | Tipe | Keterangan |
|---|---|---|
| type | string | `number` atau `name` |
| value | string | nomor antrian ATAU nama pasien |
| calledBy | string | uid petugas |
| calledAt | timestamp | |

## 7. Catatan Teknis & Batasan

- Tulis antrian memakai pola **baca dulu, lalu `WriteBatch`** (commit atomik: semua dokumen tulis atau tidak sama sekali). Catatan: layer compat SDK tidak mendukung query di dalam `runTransaction`; karenanya nomor max dibaca di luar batch. Untuk skala 1 loket/1 petugas aman — jika dua klik terjadi bersamaan di tab berbeda, kemungkinan nomor ganda sangat kecil (dapat dihindari di v2 dengan Cloud Function).
- Keamanan: Security Rules — publik hanya bisa baca `queues`/`call_events`; tulis wajib login + `calledBy` harus uid yang sedang login; `call_events` tidak bisa di-update/dihapus oleh client.
- Identitas "petugas" = siapa pun yang memiliki akun Auth (akun hanya dibuat via console Firebase oleh admin RS). Untuk v2 bisa ditambah custom claims `role: staff`.
- Batas free tier Firebase: Firestore 1 GiB storage + 50 ribu baca/20 ribu tulis per hari; Auth gratis tanpa batas praktis. Untuk pemakaian harian RS skala 1 loket sangat aman.
- Jika internet mati: tidak ada backup lokal — panggil manual via mikrofon sebagai cadangan (SOP RS).
- Firestore membutuhkan koneksi ke server Firebase (bukan LAN lokal) — pastikan WiFi ruang tunggu & loket stabil.
