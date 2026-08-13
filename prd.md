# Product Requirements Document (PRD)
## Sistem Display & Pemanggil Antrian — RSU Santa Elisabeth

**Versi:** 1.0
**Tanggal:** 13 Agustus 2026
**Status:** Draft

---

## 1. Latar Belakang

RSU Santa Elisabeth membutuhkan sistem antrian digital untuk 1 loket layanan, terdiri dari dua halaman utama:
1. **Halaman Display** — ditampilkan di layar TV/monitor ruang tunggu, menunjukkan nomor/nama pasien yang sedang dipanggil.
2. **Halaman Petugas (Admin)** — digunakan petugas loket untuk memanggil antrian, baik berdasarkan nomor urut maupun dengan mengetik nama pasien secara manual, disertai suara panggilan otomatis (text-to-speech).

Seluruh stack yang digunakan mengutamakan **tier gratis**: Golang untuk backend, Supabase untuk database & realtime, Vercel untuk hosting/deploy.

---

## 2. Tujuan

- Mengurangi kebingungan pasien di ruang tunggu dengan info antrian yang jelas secara visual & suara.
- Mempermudah petugas memanggil pasien tanpa perangkat tambahan (cukup browser).
- Menggunakan biaya operasional Rp0 (full free-tier), sesuai skala 1 loket.

## 3. Ruang Lingkup

### In-Scope (v1)
- 1 loket/counter.
- Halaman Display publik (read-only, auto-update).
- Halaman Petugas dengan login sederhana.
- Panggil nomor antrian berikutnya (otomatis increment harian).
- Panggil ulang (recall) nomor yang sama.
- Skip nomor (lewati, tidak dipanggil).
- Input nomor antrian manual (loncat ke nomor tertentu).
- **Panggil berdasarkan nama pasien** (petugas ketik nama bebas, sistem umumkan via suara + tampilkan di display).
- Text-to-speech (TTS) otomatis saat ada panggilan baru (nomor atau nama).
- Reset otomatis nomor antrian setiap hari.

### Out-of-Scope (v1 — bisa jadi v2)
- Multi-loket/multi-counter.
- Kiosk pengambilan nomor otomatis (mesin tiket).
- Integrasi SMS/WhatsApp notifikasi ke pasien.
- Statistik/laporan antrian harian (dashboard analitik).
- Multi-cabang/multi-poli.
- Aplikasi mobile terpisah.

---

## 4. Pengguna & Peran

| Peran | Deskripsi | Akses |
|---|---|---|
| **Petugas Loket** | Memanggil antrian, input nama, skip/recall | Login (Supabase Auth) |
| **Pasien/Publik** | Melihat & mendengar nomor yang dipanggil | Tanpa login, akses halaman display |
| **(Opsional) Admin** | Kelola akun petugas | Login dengan role admin |

---

## 5. Fitur & User Stories

### 5.1 Halaman Display (Publik)
- Sebagai pasien, saya ingin melihat nomor/nama yang sedang dipanggil dengan jelas (font besar) di layar.
- Sebagai pasien, saya ingin mendengar suara panggilan otomatis saat nomor/nama saya dipanggil.
- Sebagai pasien, saya ingin melihat riwayat 3–5 panggilan terakhir sebagai referensi.
- Halaman ini harus auto-update tanpa refresh manual (via Supabase Realtime).

### 5.2 Halaman Petugas (Admin)
- Sebagai petugas, saya harus login terlebih dahulu sebelum bisa memanggil antrian.
- Sebagai petugas, saya ingin menekan tombol **"Panggil Berikutnya"** untuk memanggil nomor urut selanjutnya secara otomatis.
- Sebagai petugas, saya ingin menekan tombol **"Panggil Ulang"** jika pasien belum datang saat dipanggil.
- Sebagai petugas, saya ingin bisa **melewati (skip)** nomor jika pasien tidak hadir.
- Sebagai petugas, saya ingin bisa **input nomor secara manual** (misal pasien prioritas/lansia yang perlu didahulukan).
- Sebagai petugas, saya ingin bisa **mengetik nama pasien** dan menekan "Panggil" agar sistem mengumumkan nama tersebut via suara — berguna untuk pasien yang dipanggil di luar sistem nomor urut (misal pemanggilan hasil lab, konsultasi lanjutan, dll).
- Sebagai petugas, saya ingin melihat status antrian saat ini (nomor terakhir dipanggil, jumlah pasien menunggu — estimasi).

### 5.3 Text-to-Speech (TTS)
- Setiap kali ada panggilan baru (nomor atau nama), sistem otomatis membacakan melalui suara di halaman Display.
- Bahasa: Indonesia (id-ID).
- Format ucapan nomor, contoh: *"Nomor antrian A dua puluh tiga, silakan menuju loket."*
- Format ucapan nama, contoh: *"Bapak/Ibu [nama], silakan menuju loket."*

---

## 6. Arsitektur Teknis (Full Free-Tier)

```
┌─────────────────┐        ┌──────────────────┐
│  Halaman Display │◄──────►│                  │
│  (browser publik)│  RT    │                  │
└─────────────────┘        │    Supabase       │
                            │  (Postgres DB +   │
┌─────────────────┐        │   Realtime +      │
│ Halaman Petugas  │◄──────►│   Auth)          │
│  (browser login) │  API   │                  │
└────────┬────────┘        └──────────────────┘
         │
         ▼
┌─────────────────┐
│  Backend Go      │
│ (Vercel Serverless│
│  Functions)       │
└─────────────────┘
```

### Catatan Arsitektur Penting
- **Vercel + Go**: Vercel mendukung Go sebagai *serverless function* (folder `/api/*.go`), tapi bersifat *stateless* dan tidak mendukung koneksi persisten (WebSocket) dalam durasi lama. Karena itu:
  - Backend Go **hanya menangani mutasi data** (panggil nomor, panggil nama, skip, recall) via REST API sederhana, lalu menulis ke Supabase.
  - **Update realtime ke halaman Display TIDAK lewat Go**, melainkan langsung dari **Supabase Realtime** (client-side subscribe ke perubahan tabel Postgres). Ini gratis, stabil, dan menghindari keterbatasan serverless Vercel untuk koneksi persisten.
- **TTS gratis**: menggunakan **Web Speech API** (`SpeechSynthesisUtterance`) bawaan browser — tanpa biaya, tanpa API key. Catatan: kualitas & ketersediaan suara Bahasa Indonesia tergantung browser/OS yang dipakai di layar display (perlu testing di perangkat aktual yang dipasang di ruang tunggu).
- **Auth petugas**: pakai Supabase Auth (email/password), gratis untuk skala kecil (1–beberapa akun petugas).

### Stack Detail
| Layer | Teknologi | Tier |
|---|---|---|
| Frontend (Display & Admin) | HTML/JS sederhana atau React (statis) | Gratis |
| Hosting Frontend + API | Vercel (Hobby plan) | Gratis |
| Backend API | Golang (Vercel Serverless Functions) | Gratis |
| Database | Supabase Postgres | Gratis (tier free: 500MB DB) |
| Realtime | Supabase Realtime (Postgres changes) | Gratis (termasuk free tier) |
| Auth | Supabase Auth | Gratis |
| Text-to-Speech | Web Speech API (browser) | Gratis (native browser) |

---

## 7. Skema Data (Draft)

### Tabel `queues`
| Kolom | Tipe | Keterangan |
|---|---|---|
| id | uuid (PK) | |
| queue_number | varchar | contoh: "A023" |
| status | enum | `waiting`, `called`, `done`, `skipped` |
| created_at | timestamptz | |
| called_at | timestamptz | nullable |
| queue_date | date | untuk reset harian |

### Tabel `call_events`
| Kolom | Tipe | Keterangan |
|---|---|---|
| id | uuid (PK) | |
| type | enum | `number`, `name` |
| value | text | isi nomor antrian ATAU nama pasien |
| counter_id | uuid (FK) | referensi loket (disiapkan meski v1 cuma 1) |
| called_by | uuid (FK → auth.users) | petugas yang memanggil |
| called_at | timestamptz | |

### Tabel `counters`
| Kolom | Tipe | Keterangan |
|---|---|---|
| id | uuid (PK) | |
| name | varchar | contoh: "Loket 1" |
| is_active | boolean | |

> Halaman Display cukup subscribe ke tabel `call_events` (insert baru) untuk trigger tampilan + suara.

---

## 8. Non-Functional Requirements

- **Performa**: update di halaman Display muncul < 2 detik setelah petugas menekan tombol panggil (via Supabase Realtime).
- **Reliabilitas**: sistem harus tetap berjalan meski koneksi sempat putus — perlu reconnect otomatis untuk Realtime subscription.
- **Keamanan**: halaman petugas wajib login; halaman display tidak boleh bisa memanggil antrian (read-only).
- **Batasan free-tier yang perlu diwaspadai**:
  - Supabase free tier: proyek bisa "paused" otomatis jika tidak ada aktivitas >7 hari — perlu dipertimbangkan karena ini sistem produksi harian di RS (kemungkinan tidak masalah karena dipakai tiap hari).
  - Vercel Hobby plan: batas eksekusi function per bulan — untuk 1 loket RS skala kecil-menengah, kemungkinan besar masih dalam batas gratis, tapi perlu dimonitor.
- **Aksesibilitas**: font besar & kontras tinggi di halaman Display agar mudah dibaca dari jarak ruang tunggu.

---

## 9. Rencana Deployment

1. Setup project Supabase → buat tabel sesuai skema di atas → aktifkan Realtime untuk tabel `call_events`.
2. Setup repo dengan struktur Vercel (`/api/*.go` untuk backend, `/public` atau folder frontend untuk Display & Admin).
3. Konfigurasi environment variables Supabase (URL & anon key) di Vercel.
4. Deploy ke Vercel, uji koneksi Realtime dari 2 device berbeda (simulasi layar display terpisah dari komputer petugas).
5. Uji TTS di perangkat/browser yang akan benar-benar dipasang di ruang tunggu RS.

---

## 10. Asumsi & Risiko

**Asumsi:**
- Layar display terhubung ke perangkat (PC/TV browser) yang mendukung Web Speech API dengan suara Bahasa Indonesia.
- Koneksi internet ruang tunggu & loket stabil (karena bergantung pada Supabase Realtime, bukan LAN lokal).
- Skala penggunaan kecil-menengah, cukup untuk tetap di free tier.

**Risiko:**
- Ketersediaan suara TTS Bahasa Indonesia berbeda-beda antar browser/OS — perlu fallback (misal teks besar di layar jika suara tidak tersedia).
- Supabase/Vercel free tier punya batas kuota — jika penggunaan RS ternyata tinggi, mungkin perlu upgrade ke tier berbayar di masa depan.
- Tidak ada backup lokal jika internet mati — perlu SOP manual (panggil manual/mikrofon) sebagai cadangan.

---

## 11. Kemungkinan Pengembangan Selanjutnya (v2+)

- Multi-loket/multi-poli.
- Dashboard laporan jumlah pasien harian.
- Integrasi kiosk pengambilan nomor otomatis.
- Notifikasi WhatsApp saat mendekati giliran.

---

## 12. Lampiran: Contoh Alur Pemanggilan Nama

1. Pasien datang untuk hasil lab / konsultasi lanjutan (tanpa nomor antrian formal).
2. Petugas membuka halaman Admin, mengetik nama pasien di kolom "Panggil Nama".
3. Petugas menekan tombol "Panggil".
4. Backend Go mencatat event ke tabel `call_events` (type: `name`).
5. Supabase Realtime mengirim perubahan ke halaman Display.
6. Halaman Display menampilkan nama + memutar suara TTS: *"Bapak/Ibu [nama], silakan menuju loket."*
