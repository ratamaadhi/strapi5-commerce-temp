# Strapi v5 + Gmail SMTP Integration Guide

## Table of Contents

- [1. Membuat App Password Gmail](#1-membuat-app-password-gmail)
- [2. Environment Variables](#2-environment-variables)
- [3. Strapi Configuration](#3-strapi-configuration)
- [4. Order Confirmation Lifecycle Hook](#4-order-confirmation-lifecycle-hook)
- [5. Admin Panel Setup](#5-admin-panel-setup)
- [6. Verification](#6-verification)
- [7. Troubleshooting](#7-troubleshooting)

---

## 1. Membuat App Password Gmail

Gmail tidak mengizinkan login SMTP dengan password biasa. Wajib menggunakan **App Password**.

### Prasyarat
- Akun Gmail dengan **2-Step Verification (2FA)** sudah aktif

### Langkah-langkah

1. Buka [Google Account](https://myaccount.google.com/)
2. Navigasi ke **Security > 2-Step Verification** (aktifkan jika belum)
3. Kembali ke **Security > App passwords**
   - Jika tidak muncul, pastikan 2FA sudah aktif
   - Link langsung: https://myaccount.google.com/apppasswords
4. Pilih **Select app** → `Other (Custom name)`
5. Ketik nama, misal: `Strapi E-commerce`
6. Klik **Generate**
7. Akan muncul **16-digit password** (format: `xxxx xxxx xxxx xxxx`)
8. **Salin password ini** — hanya muncul sekali, tidak bisa dilihat lagi

> **Catatan:** Jangan gunakan password Gmail biasa. App password inilah yang akan dipakai di konfigurasi Strapi.

---

## 2. Environment Variables

### 2.1 Edit `.env`

Buka file `.env` di root project. Tambahkan atau isi variabel berikut:

```bash
# SMTP (Gmail)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=emailkamu@gmail.com
SMTP_PASS=xxxx xxxx xxxx xxxx    # App password 16 digit (dengan atau tanpa spasi)
EMAIL_FROM=emailkamu@gmail.com
```

> **Catatan:** `.env` sudah di `.gitignore` — tidak akan tercommit. Aman untuk menyimpan kredensial di sini.

### 2.2 Edit `.env.example`

Untuk memudahkan developer lain, file contoh juga sudah diupdate:

```bash
# SMTP (Gmail)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-16-char-app-password
EMAIL_FROM=your-email@gmail.com
```

---

## 3. Strapi Configuration

### 3.1 Install Package

```bash
npm install @strapi/provider-email-nodemailer
```

### 3.2 Konfigurasi Plugin (`config/plugins.ts`)

Konfigurasi email ditambahkan di `config/plugins.ts`:

```typescript
import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => ({
  // ... konfigurasi lain (upload, documentation, dll)

  email: {
    config: {
      provider: 'nodemailer',
      providerOptions: {
        host: env('SMTP_HOST', 'smtp.gmail.com'),
        port: env.int('SMTP_PORT', 587),
        secure: false,
        auth: {
          user: env('SMTP_USER'),
          pass: env('SMTP_PASS'),
        },
      },
      settings: {
        defaultFrom: env('EMAIL_FROM'),
        defaultReplyTo: env('EMAIL_FROM'),
      },
    },
  },
});

export default config;
```

### Penjelasan Opsi

| Opsi | Nilai | Keterangan |
|------|-------|------------|
| `provider` | `nodemailer` | Provider email menggunakan Nodemailer |
| `host` | `smtp.gmail.com` | SMTP server Gmail |
| `port` | `587` | Port STARTTLS (standar Gmail) |
| `secure` | `false` | `false` untuk port 587 (STARTTLS), `true` untuk port 465 |
| `auth.user` | Gmail kamu | Email untuk autentikasi SMTP |
| `auth.pass` | App Password | Bukan password Gmail biasa! |
| `defaultFrom` | Email kamu | Default `from` address untuk semua email |
| `defaultReplyTo` | Email kamu | Default `reply-to` address |

---

## 4. Order Confirmation Lifecycle Hook

File: `src/api/order/content-types/order/lifecycles.ts`

Hook `afterCreate` otomatis mengirim email konfirmasi setiap kali order dibuat:

```typescript
export default {
  async afterCreate(event: any) {
    const { result } = event;

    try {
      const order = await strapi.documents('api::order.order').findOne({
        documentId: result.documentId,
        populate: ['user', 'items'],
      }) as any;

      const customerEmail = order.user?.email ?? null;
      if (!customerEmail) {
        strapi.log.warn('Order confirmation skipped: order has no associated user with email');
        return;
      }

      const template = {
        subject: `Order #${order.orderNumber} - Confirmed`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #333;">Order Confirmed</h1>
            <p>Thank you for your order! Your order <strong>#<%= orderNumber %></strong> has been received.</p>

            <h2 style="color: #555; border-bottom: 1px solid #ddd; padding-bottom: 4px;">Order Details</h2>
            <p>Status: <strong><%= orderStatus %></strong></p>
            <p>Payment: <strong><%= paymentStatus %></strong></p>

            <h2 style="color: #555; border-bottom: 1px solid #ddd; padding-bottom: 4px;">Items</h2>
            <table style="width: 100%; border-collapse: collapse;">
              <tr style="background: #f5f5f5;">
                <th style="text-align: left; padding: 8px;">Product</th>
                <th style="text-align: right; padding: 8px;">Qty</th>
                <th style="text-align: right; padding: 8px;">Price</th>
                <th style="text-align: right; padding: 8px;">Total</th>
              </tr>
              <% items.forEach(item => { %>
                <tr>
                  <td style="padding: 8px;"><%= item.productName %><% if (item.variantInfo) { %> <small>(<%= item.variantInfo %>)</small><% } %></td>
                  <td style="text-align: right; padding: 8px;"><%= item.quantity %></td>
                  <td style="text-align: right; padding: 8px;"><%= currency %> <%= Number(item.unitPrice).toLocaleString('id-ID') %></td>
                  <td style="text-align: right; padding: 8px;"><%= currency %> <%= Number(item.totalPrice).toLocaleString('id-ID') %></td>
                </tr>
              <% }) %>
            </table>

            <p style="margin-top: 16px; font-weight: bold;">Subtotal: <%= currency %> <%= Number(subtotal).toLocaleString('id-ID') %></p>
            <p>Tax: <%= currency %> <%= Number(tax).toLocaleString('id-ID') %></p>
            <p>Shipping: <%= currency %> <%= Number(shippingCost).toLocaleString('id-ID') %></p>
            <% if (discount > 0) { %><p>Discount: -<%= currency %> <%= Number(discount).toLocaleString('id-ID') %></p><% } %>
            <p style="font-size: 18px; font-weight: bold; color: #d32f2f;">Total: <%= currency %> <%= Number(totalAmount).toLocaleString('id-ID') %></p>

            <% if (shippingAddress) { %>
              <h2 style="color: #555; border-bottom: 1px solid #ddd; padding-bottom: 4px;">Shipping Address</h2>
              <p><%= shippingAddress.firstName %> <%= shippingAddress.lastName %></p>
              <p><%= shippingAddress.addressLine1 %></p>
              <% if (shippingAddress.addressLine2) { %><p><%= shippingAddress.addressLine2 %></p><% } %>
              <p><%= shippingAddress.city %>, <%= shippingAddress.state %> <%= shippingAddress.postalCode %></p>
              <p><%= shippingAddress.country %></p>
            <% } %>

            <hr style="margin-top: 24px; border: none; border-top: 1px solid #eee;" />
            <p style="font-size: 12px; color: #999;">This is an automated message. Please do not reply.</p>
          </div>
        `,
      };

      await strapi.plugins['email'].services.email.sendTemplatedEmail(
        { to: customerEmail },
        template,
        {
          orderNumber: order.orderNumber,
          orderStatus: order.orderStatus,
          paymentStatus: order.paymentStatus,
          items: order.items || [],
          subtotal: order.subtotal,
          tax: order.tax,
          shippingCost: order.shippingCost,
          discount: order.discount,
          totalAmount: order.totalAmount,
          currency: order.currency,
          shippingAddress: order.shippingAddress,
        }
      );

      strapi.log.info(`Order confirmation sent to ${customerEmail}`);
    } catch (err: any) {
      strapi.log.error('Failed to send order confirmation:', err);
    }
  },
};
```

### Cara Kerja

1. Order dibuat via API atau admin panel
2. Lifecycle hook `afterCreate` terpanggil
3. Ambil data order lengkap (user, items)
4. Jika user punya email → kirim konfirmasi
5. Jika tidak ada user/email → skip (log warning)
6. Gagal kirim email → log error, **tidak** mengganggu proses order

---

## 5. Admin Panel Setup

Setelah Strapi berjalan dengan email provider terkonfigurasi, setup melalui admin panel:

### 5.1 Email Templates (Password Reset & Email Confirmation)

1. Buka **Settings > Users & Permissions > Email templates**
2. Edit **Email address confirmation**:
   - **Shipper name:** `Toko Online` (atau nama toko)
   - **Shipper email:** `emailkamu@gmail.com` (sama dengan `EMAIL_FROM`)
   - **Response email:** `emailkamu@gmail.com`
   - **Subject:** edit sesuai keinginan (variabel `USER`, `TOKEN`, `URL`, `CODE` tersedia)
   - **Message:** edit HTML template sesuai keinginan

3. Edit **Reset Password**:
   - **Shipper name:** `Toko Online`
   - **Shipper email:** `emailkamu@gmail.com`
   - **Response email:** `emailkamu@gmail.com`
   - **Subject:** edit sesuai keinginan
   - **Message:** edit HTML template

### 5.2 Enable Email Confirmation

1. Buka **Settings > Users & Permissions > Advanced**
2. **Enable email confirmation** → ON
3. **Redirection url:** URL halaman konfirmasi di frontend (jika ada)

### 5.3 Test Email Delivery

1. Buka **Settings > Email plugin > Configuration**
2. Masukkan email tujuan di field "Send test email"
3. Klik **Send**
4. Jika berhasil, akan muncul notifikasi sukses

---

## 6. Verification

### 6.1 Test Email dari Admin Panel

```bash
# Buka browser, login ke admin panel
# Settings > Email plugin > Configuration > Send test email
```

### 6.2 Test Order Confirmation via API

```bash
# 1. Register user
curl -X POST http://localhost:1337/api/auth/local/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "email": "emailkamu@gmail.com",
    "password": "Test123!"
  }'

# 2. Login untuk dapat JWT
curl -X POST http://localhost:1337/api/auth/local \
  -H "Content-Type: application/json" \
  -d '{
    "identifier": "emailkamu@gmail.com",
    "password": "Test123!"
  }'

# 3. Buat order (ganti JWT dan documentId)
curl -X POST http://localhost:1337/api/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT>" \
  -d '{
    "data": {
      "orderNumber": "ORD-TEST-001",
      "orderStatus": "pending",
      "paymentStatus": "pending",
      "subtotal": 500000,
      "totalAmount": 500000,
      "items": [
        {
          "productName": "Test Product",
          "quantity": 2,
          "unitPrice": 250000,
          "totalPrice": 500000
        }
      ]
    }
  }'
```

### 6.3 Test Forgot Password

```bash
curl -X POST http://localhost:1337/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email": "emailkamu@gmail.com"}'
```

---

## 7. Troubleshooting

### 7.1 Email tidak terkirim

| Kemungkinan | Solusi |
|-------------|--------|
| App Password salah | Generate ulang di https://myaccount.google.com/apppasswords |
| 2FA tidak aktif | App Password hanya bisa dibuat jika 2FA aktif |
| SMTP credential salah | Cek `.env` — pastikan `SMTP_USER` dan `SMTP_PASS` benar |
| Port terblokir | Pastikan port 587 (STARTTLS) tidak diblokir firewall |
| Gmail rate limit | Gmail gratis: ~500 email/hari. Tunggu atau upgrade ke Google Workspace |

### 7.2 Test email dari admin panel gagal

Cek log Strapi:

```bash
# Di terminal Strapi, cari error seperti:
[2026-06-01 12:00:00] error: Failed to send test email...
```

Error umum:
- `Invalid login` → App Password salah
- `connect ECONNREFUSED` → Port SMTP diblokir
- `Username and Password not accepted` → Ganti App Password

### 7.3 App Password ditolak

1. Pastikan **2-Step Verification** sudah aktif di akun Google
2. Generate App Password baru
3. Hapus spasi (jika ada) — format `xxxx xxxx xxxx xxxx` bisa ditulis `xxxxxxxxxxxxxxxx`
4. Update di `.env` dan restart Strapi

### 7.4 Email masuk spam

Self-hosted email sering masuk spam. Tips:
- Gunakan Gmail SMTP langsung (reputasi tinggi)
- Hindari kata-kata spammy di subject/message
- Pastikan `from` email sama dengan akun Gmail yang terautentikasi

---

## Referensi

- [@strapi/provider-email-nodemailer](https://www.npmjs.com/package/@strapi/provider-email-nodemailer)
- [Strapi v5 Email Plugin Docs](https://docs.strapi.io/dev-docs/plugins/email)
- [Google App Passwords](https://support.google.com/accounts/answer/185833)
