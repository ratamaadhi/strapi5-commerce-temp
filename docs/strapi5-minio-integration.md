# Strapi v5 + MinIO Integration Guide

## Table of Contents

- [1. MinIO Setup](#1-minio-setup)
- [2. Environment Variables](#2-environment-variables)
- [3. Strapi Configuration](#3-strapi-configuration)
- [4. File Structure](#4-file-structure)
- [5. Verification](#5-verification)
- [6. Troubleshooting](#6-troubleshooting)

---

## 1. MinIO Setup

### 1.1 Menjalankan MinIO (Local)

```bash
docker run -d --name minio \
  -p 9000:9000 \
  -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  -v minio-data:/data \
  minio/minio server /data --console-address ":9001"
```

Akses:
- **Console (Web UI):** `http://localhost:9001` — login `minioadmin` / `minioadmin`
- **S3 API:** `http://localhost:9000`

### 1.2 Membuat Bucket

1. Buka MinIO Console (`localhost:9001`)
2. Login
3. Tab **Buckets** → **Create Bucket**
4. Nama bucket: `strapi-uploads` (atau sesuai keinginan)
5. **Create**

### 1.3 Membuat Access Key

1. Tab **Identity** → **Service Accounts**
2. **Create Service Account**
3. Isi:
   - **Name:** `strapi-uploader`
   - **Bucket:** Assign ke bucket yang sudah dibuat
   - **Access:** ReadWrite
4. Simpan — akan muncul **Access Key** dan **Secret Key**
5. Catat kedua nilai ini — hanya muncul sekali, tidak bisa dilihat lagi

### 1.4 Konfigurasi Bucket Policy (Public Read)

Agar file yang diupload bisa diakses publik tanpa perlu signed URL:

1. Buka MinIO Console → Buckets → **strapi-uploads**
2. Tab **Anonymous**
3. **Add Access Rule**
4. Isi:
   - **Prefix:** (kosongkan)
   - **Access:** `readonly`
5. **Save**

### 1.5 Memahami S3 API vs Console Endpoint

MinIO memiliki dua port berbeda:

| Port | Fungsi | Contoh Hostname |
|------|--------|----------------|
| `9000` | **S3 API** — digunakan oleh `@strapi/provider-upload-aws-s3` | `https://minio-api.domain.com` atau `http://localhost:9000` |
| `9001` | **Console (Web UI)** — untuk admin MinIO | `http://localhost:9001` |

**Jika MinIO di belakang reverse proxy (ngingx + Cloudflare):**
- S3 API: `https://minio-api.domain.com` (standard HTTPS, port 443)
- Console: `https://minio-ui.domain.com`

Pastikan `MINIO_ENDPOINT` mengarah ke **S3 API**, bukan Console.

### 1.6 CORS Configuration (Opsional)

Jika browser Strapi berbeda domain dengan MinIO, Mungkin perlu CORS policy di MinIO:

```bash
mc alias set myminio https://minio-api.domain.com ACCESS_KEY SECRET_KEY
mc admin policy create myminio cors-policy /tmp/cors.json
```

Atau via Console → Bucket → **Access** → **CORS** → tambah rule:

```json
{
  "CORSRules": [
    {
      "AllowedOrigins": ["https://domain-strapi.com"],
      "AllowedMethods": ["GET", "HEAD"],
      "AllowedHeaders": ["*"],
      "MaxAgeSeconds": 3600
    }
  ]
}
```

---

## 2. Environment Variables

### 2.1 Semua Variable

```env
# MinIO (S3-compatible storage)
MINIO_ENDPOINT=https://minio-api.domain.com     # S3 API endpoint (BUKAN Console)
MINIO_ACCESS_KEY=your-access-key                # Dari Service Account MinIO
MINIO_SECRET_KEY=your-secret-key                # Dari Service Account MinIO
MINIO_BUCKET=strapi-uploads                     # Nama bucket yang sudah dibuat
MINIO_REGION=us-east-1                          # Region (default MinIO)
MINIO_HOST=minio-api.domain.com                 # Hostname dari endpoint (tanpa protocol)
```

### 2.2 Cara Mendapatkan Setiap Value

| Variable | Cara Dapatkan |
|----------|--------------|
| `MINIO_ENDPOINT` | URL S3 API MinIO. Local: `http://localhost:9000`. Cloudflare: `https://minio-api.domain.com`. **Verifikasi**: `curl -s https://minio-api.domain.com/` harus return XML (bukan HTML). |
| `MINIO_ACCESS_KEY` | Dari MinIO Console → Identity → Service Accounts → Create. |
| `MINIO_SECRET_KEY` | Ditampilkan sekali saat membuat Service Account. Copy dan simpan. |
| `MINIO_BUCKET` | Nama bucket yang dibuat di MinIO Console → Buckets. Nama harus unik per MinIO server. |
| `MINIO_HOST` | Hostname saja dari `MINIO_ENDPOINT`, tanpa protocol. Contoh: `minio-api.domain.com`. Untuk CSP middleware. |

### 2.3 Contoh `.env`

```env
# Server
HOST=0.0.0.0
PORT=1337

# Database
DATABASE_CLIENT=postgres
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=strapi5_commerce
DATABASE_USERNAME=strapi
DATABASE_PASSWORD=strapi_local_pass
DATABASE_SSL=false

# Secrets
APP_KEYS=key1,key2,key3,key4
API_TOKEN_SALT=your-salt
ADMIN_JWT_SECRET=your-secret
TRANSFER_TOKEN_SALT=your-salt
ENCRYPTION_KEY=your-key
JWT_SECRET=your-jwt-secret

# Environment
NODE_ENV=development

# MinIO (S3-compatible storage)
MINIO_ENDPOINT=https://minio-api.ratama.space
MINIO_ACCESS_KEY=your-access-key
MINIO_SECRET_KEY=your-secret-key
MINIO_BUCKET=strapi5-commerce-temp
MINIO_REGION=us-east-1
MINIO_HOST=minio-api.ratama.space
```

---

## 3. Strapi Configuration

### 3.1 Install Package

```bash
npm install @strapi/provider-upload-aws-s3
```

### 3.2 Plugin Config (`config/plugins.ts`)

```typescript
import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => ({
  upload: {
    config: {
      provider: 'aws-s3',
      providerOptions: {
        s3Options: {
          credentials: {
            accessKeyId: env('MINIO_ACCESS_KEY'),
            secretAccessKey: env('MINIO_SECRET_KEY'),
          },
          region: env('MINIO_REGION', 'us-east-1'),
          endpoint: env('MINIO_ENDPOINT'),
          forcePathStyle: true,
          params: {
            Bucket: env('MINIO_BUCKET'),
            // ACL: undefined prevents default public_read injection
            // Required for modern MinIO (2023+) which disables ACL by default
            ACL: undefined,
          },
        },
      },
      actionOptions: {
        upload: {},
        uploadStream: {},
        delete: {},
      },
    },
  },
});

export default config;
```

**Kenapa `forcePathStyle: true`?** MinIO menggunakan path-style URLs (`https://endpoint/bucket/file`) bukan virtual-hosted (`https://bucket.endpoint/file`).

**Kenapa `ACL: undefined`?** MinIO versi 2023+ menonaktifkan ACL secara default. Provider defaultnya menyisipkan `ACL: public-read`, yang akan menyebabkan error `AccessControlListNotSupported`. Dengan men-set `ACL: undefined`, kita mencegah default injection dan MinIO tidak mengirim ACL header.

### 3.3 CSP Middleware (`config/middlewares.ts`)

```typescript
import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Middlewares => [
  'strapi::logger',
  'strapi::errors',
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'connect-src': ["'self'", 'https:'],
          'img-src': [
            "'self'",
            'data:',
            'blob:',
            'market-assets.strapi.io',
            env('MINIO_HOST', 'localhost'),
          ],
          'media-src': [
            "'self'",
            'data:',
            'blob:',
            'market-assets.strapi.io',
            env('MINIO_HOST', 'localhost'),
          ],
          upgradeInsecureRequests: null,
        },
      },
    },
  },
  'strapi::cors',
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];

export default config;
```

Tanpa konfigurasi CSP ini, preview gambar di Admin Panel Strapi akan diblokir browser.

### 3.4 Docker (Opsional)

Jika menggunakan `docker-compose.yml`, hapus volume mount untuk uploads lokal:

```yaml
services:
  strapi:
    # ... konfigurasi lain
    # HAPUS bagian berikut — file tidak lagi disimpan lokal:
    # volumes:
    #   - strapi-uploads:/opt/app/public/uploads
```

### 3.5 Keamanan Upload (Opsional)

Strapi akan menampilkan warning: `No upload security configuration found`. Untuk menghilangkannya, tambahkan konfigurasi security ke `config/plugins.ts`:

```typescript
upload: {
  config: {
    // ... provider config ...
    security: {
      enable: true,
      allowedMimeTypes: [
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'application/pdf',
      ],
      maxFileSize: 10 * 1024 * 1024, // 10MB
    },
  },
},
```

---

## 4. File Structure

```
project-root/
├── config/
│   ├── plugins.ts          # Upload provider config (aws-s3)
│   └── middlewares.ts      # CSP directives (MinIO host)
├── .env                    # MinIO credentials (jangan di-commit!)
├── .env.example            # Template env (commit)
├── docker-compose.yml      # Hapus uploads volume (opsional)
└── package.json            # Tambah @strapi/provider-upload-aws-s3
```

---

## 5. Verification

### 5.1 Cek TypeScript

```bash
npx tsc --noEmit
```

### 5.2 Cek Build

```bash
npm run build
```

### 5.3 Cek Upload

1. Start Strapi: `npm run develop`
2. Open Admin Panel → Media Library
3. Upload file gambar
4. Klik file → cek URL — harus mengarah ke MinIO (`https://minio-api.domain.com/bucket/...`)
5. Preview gambar harus tampil

### 5.4 Cek Akses Langsung

```bash
# Ganti dengan URL file dari Strapi
curl -sI "https://minio-api.domain.com/bucket/filename.png"
```

Response: `HTTP/2 200`

### 5.5 Cek di MinIO Console

1. Buka MinIO Console
2. Buckets → pilih bucket
3. File harus muncul di daftar objek

---

## 6. Troubleshooting

### 6.1 `AggregateError` pada Upload

**Penyebab:** MinIO tidak bisa dijangkau atau endpoint salah.

**Cek:**
```bash
# Apakah MinIO berjalan?
curl -s https://minio-api.domain.com/

# Apakah endpoint benar (S3 API, bukan Console)?
# S3 API harus return XML, Console return HTML
```

### 6.2 Preview Gambar Broken di Admin Panel

**Penyebab 1 — CSP blokir:**
Buka browser DevTools → Console. Jika ada error CSP, update `config/middlewares.ts` dengan hostname MinIO yang benar.

**Penyebab 2 — Bucket private:**
File di MinIO tidak bisa diakses publik. Set bucket policy ke `readonly` via MinIO Console → Bucket → Anonymous.

**Penyebab 3 — File URL salah:**
Cek di database:
```bash
psql -h localhost -U strapi -d strapi5_commerce -c "SELECT url FROM files ORDER BY id DESC LIMIT 5;"
```
Pastikan URL mengarah ke S3 API yang benar.

### 6.3 `AccessControlListNotSupported` Error

**Penyebab:** MinIO versi 2023+ menonaktifkan ACL.

**Solusi:** Set `ACL: undefined` di `params` pada `config/plugins.ts`:
```typescript
params: {
  Bucket: env('MINIO_BUCKET'),
  ACL: undefined,
},
```

### 6.4 File Terupload Tapi Tidak di MinIO

**Penyebab:** Strapi menggunakan local storage provider (default).

**Cek:**
1. `config/plugins.ts` — pastikan `provider: 'aws-s3'`
2. `.env` — pastikan `MINIO_*` variable terisi benar
3. Restart Strapi setelah mengubah konfigurasi

---

## Architecture Overview

```
┌──────────────┐     Upload File     ┌────────────────────┐
│              │ ──────────────────►  │                    │
│  Browser /   │                     │  Strapi v5         │
│  Admin Panel │ ◄────────────────── │  @strapi/provider- │
│              │  Return MinIO URL   │  upload-aws-s3     │
└──────────────┘                     └─────────┬──────────┘
                                               │
                                               │ AWS SDK v3
                                               │ forcePathStyle
                                               ▼
                                    ┌────────────────────┐
                                    │                    │
                                    │  MinIO             │
                                    │  S3-compatible     │
                                    │  Storage           │
                                    │                    │
                                    └────────────────────┘
```
