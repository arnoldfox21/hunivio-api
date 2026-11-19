# Keyloka API

Backend REST API & WebSocket server untuk platform pencarian dan booking hunian **Keyloka** (`KOST`, `APARTEMEN`, `KONTRAKAN`, dan `HUNIAN_HARIAN`), dibangun menggunakan **NestJS 10**, **TypeORM**, dan **PostgreSQL**.

## Teknologi Utama
- **Framework:** NestJS 10 + TypeScript
- **Database:** PostgreSQL + TypeORM
- **Real-time:** Socket.IO (`ChatsGateway`)
- **Pembayaran:** Duitku (Booking Escrow & Top-up Kredit)
- **Media Storage:** Cloudflare R2 (`@aws-sdk/client-s3` + `sharp`)
- **Notifikasi:** Firebase Admin (`firebase-admin`)

## Struktur Modul (`src/`)
- `auth/` — JWT guard, role guard (`PENYEWA`, `PEMILIK_KOST`, `STAFF`, `ADMINISTRATOR`)
- `users/` — Profil pengguna, login Google, verifikasi pemilik
- `kosts/` — CRUD properti (`KOST`, `APARTEMEN`, `KONTRAKAN`, `HUNIAN_HARIAN`), pencarian, peta, favorit, laporan properti
- `bookings/` — Pengajuan survei (*Tanyakan Ketersediaan*), booking langsung, Escrow, check-in, poin loyalti, callback & sync Duitku
- `chats/` — Chat 1-on-1 real-time (terintegrasi dengan status pengajuan `bookingId`), serta **Grup Penghuni Kost** (khusus properti kategori `KOST`)
- `reviews/` — Ulasan penghuni & laporan ulasan
- `wallet/` — Saldo pemilik, transaksi dompet, top-up kredit boost, dan pengajuan withdraw/payout
- `posts/` — Postingan, komentar, dan like dari pemilik properti
- `locations/` — Data wilayah & seeding lokasi
- `storage/` — Upload & optimasi gambar ke Cloudflare R2

## Konfigurasi Environment
Salin `.env.example` menjadi `.env` dan sesuaikan nilainya:
- `PORT`, `NODE_ENV`, `CORS_ORIGIN`
- `DATABASE_URL` (atau `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DB_SYNCHRONIZE`)
- `JWT_SECRET`
- `DUITKU_IS_PRODUCTION`, `DUITKU_MERCHANT_CODE`, `DUITKU_API_KEY`
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`

## Menjalankan Server Lokal
```bash
npm install
npm run db:up      # Memastikan PostgreSQL lokal berjalan
npm run build
npm run start
# atau untuk development:
npm run start:dev
```

Atau menggunakan Docker Compose:
```bash
docker compose up -d --build
```
