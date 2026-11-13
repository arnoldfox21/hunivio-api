# Kost2u API (NestJS + PostgreSQL)

Backend REST API untuk aplikasi pencari kost **Kost2u** (seperti Mamikos), dibangun menggunakan **NestJS**, **TypeORM**, dan **PostgreSQL**.

## Konfigurasi Database PostgreSQL Lokal
- **Host:** `localhost`
- **Port:** `5432`
- **User:** `postgres`
- **Database:** `kost2u_db`
- **Binary PostgreSQL Lokal:** `/Applications/Postgres.app/Contents/Versions/16/bin`

## Menjalankan Server API
```bash
npm install
npm run build
npm run start
```

## Daftar Endpoint API (`http://localhost:3001/api`)
- `GET /api/kosts` — Daftar kost (mendukung query: `search`, `type`, `city`, `facility`, `minPrice`, `maxPrice`, `sortBy`)
- `GET /api/kosts/cities` — Daftar kota beserta jumlah kost
- `GET /api/kosts/:id` — Detail kost berdasarkan ID
- `POST /api/kosts` — Tambah kost baru
- `GET /api/bookings` — Daftar pengajuan sewa kost
- `POST /api/bookings` — Buat pengajuan sewa kost baru
