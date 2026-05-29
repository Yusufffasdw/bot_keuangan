# 🤖 Bot Keuangan WhatsApp + Dashboard

## Cara Setup (Step by Step)

---

## LANGKAH 1 — Daftar Twilio (Gratis)

1. Buka https://www.twilio.com/try-twilio → Daftar akun gratis
2. Masuk ke Console → catat:
   - **Account SID** (mulai ACxxx...)
   - **Auth Token**
3. Klik menu **Messaging → Try it out → Send a WhatsApp message**
4. Ikuti instruksi: simpan nomor Twilio Sandbox di HP kamu
5. Kirim kode join (contoh: `join apple-mango`) ke nomor Twilio via WhatsApp

---

## LANGKAH 2 — Deploy ke Railway (Gratis)

1. Buka https://railway.app → Login dengan GitHub
2. Klik **New Project → Deploy from GitHub repo**
   - Upload folder ini ke GitHub dulu (github.com → New repo → upload files)
3. Setelah deploy, klik **Settings → Variables** → tambahkan:
   ```
   TWILIO_ACCOUNT_SID = ACxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN  = xxxxxxxxxxxxxxxx
   DASHBOARD_URL      = (URL dashboard kamu, boleh kosong dulu)
   ```
4. Klik **Settings → Networking → Generate Domain**
   - Catat URL-nya, contoh: `https://whatsapp-bot-production.railway.app`

---

## LANGKAH 3 — Hubungkan Twilio ke Railway

1. Di Twilio Console → **Messaging → Settings → WhatsApp Sandbox Settings**
2. Pada kolom **"When a message comes in"**, isi:
   ```
   https://whatsapp-bot-production.railway.app/webhook
   ```
   Ganti dengan URL Railway kamu
3. Klik **Save**

---

## LANGKAH 4 — Test Bot

Kirim pesan ke nomor Twilio WhatsApp kamu:

- Ketik `pemasukan` → bot tanya jumlah → ketik nominalnya → bot tanya keterangan
- Ketik `pengeluaran` → bot tanya jumlah → ketik nominalnya → bot tanya keterangan  
- Ketik `ringkasan` → bot balas saldo & riwayat

---

## LANGKAH 5 — Buka Dashboard

1. Buka file `dashboard.html` di browser (klik 2x, atau upload ke hosting)
2. Masukkan URL Railway kamu di kolom atas:
   ```
   https://whatsapp-bot-production.railway.app
   ```
3. Klik **Refresh** — data transaksi langsung tampil!
4. Dashboard auto-refresh setiap 10 detik

---

## Perintah Bot WhatsApp

| Ketik          | Fungsi                          |
|----------------|---------------------------------|
| `pemasukan`    | Catat uang masuk                |
| `pengeluaran`  | Catat uang keluar               |
| `ringkasan`    | Lihat saldo & 5 transaksi terakhir |
| `batal`        | Batalkan input yang sedang berjalan |

---

## Struktur File

```
whatsapp-bot/
├── server.js         ← Backend bot (Node.js + Express)
├── package.json      ← Daftar dependency
├── .env.example      ← Template variabel environment
├── dashboard.html    ← Dashboard web (buka di browser)
└── README.md         ← Panduan ini
```

---

## Catatan Penting

- Data tersimpan **di memory server** — akan hilang jika Railway restart
- Untuk data permanen, tambahkan database (MongoDB Atlas gratis / Supabase)
- Railway gratis memberikan $5 kredit/bulan (cukup untuk project kecil)
- Twilio Sandbox gratis tapi hanya untuk nomor yang sudah join sandbox
