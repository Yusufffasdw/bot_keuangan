require('dotenv').config();
const express = require('express');
const cors = require('cors');
const twilio = require('twilio');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cors());

// ── In-memory storage (data tetap selama server hidup) ──────────────────────
const transactions = [];   // { id, type, amount, keterangan, date, phone }
const sessions = {};       // { phone: { step, type, amount } }

// ── Helper ───────────────────────────────────────────────────────────────────
function fmtRupiah(n) {
  return 'Rp ' + Number(n).toLocaleString('id-ID');
}

function replyWA(res, message) {
  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(message);
  res.type('text/xml').send(twiml.toString());
}

function totalByType(type) {
  return transactions
    .filter(t => t.type === type)
    .reduce((sum, t) => sum + t.amount, 0);
}

function getRingkasan() {
  const masuk  = totalByType('pemasukan');
  const keluar = totalByType('pengeluaran');
  const saldo  = masuk - keluar;
  const last5  = [...transactions].reverse().slice(0, 5);
  const listStr = last5.length
    ? last5.map(t =>
        `  ${t.type === 'pemasukan' ? '✅' : '🔴'} ${fmtRupiah(t.amount)} — ${t.keterangan}`
      ).join('\n')
    : '  (belum ada transaksi)';

  return (
    `━━━━━━━━━━━━━━━━━━\n` +
    `📊 *RINGKASAN KEUANGAN*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `💚 Pemasukan : ${fmtRupiah(masuk)}\n` +
    `❤️  Pengeluaran: ${fmtRupiah(keluar)}\n` +
    `💰 Saldo     : ${fmtRupiah(saldo)}\n\n` +
    `📋 *5 Transaksi Terakhir:*\n` +
    listStr + '\n' +
    `━━━━━━━━━━━━━━━━━━`
  );
}

// ── Webhook WhatsApp (Twilio kirim POST ke sini) ─────────────────────────────
app.post('/webhook', (req, res) => {
  const body  = (req.body.Body || '').trim().toLowerCase();
  const phone = req.body.From || 'unknown';
  const sess  = sessions[phone] || { step: 'idle' };

  // ── STEP: menunggu jumlah ─────────────────────────────────────────────────
  if (sess.step === 'wait_amount') {
    const raw    = body.replace(/[^0-9]/g, '');
    const amount = parseInt(raw, 10);

    if (!amount || amount <= 0) {
      sessions[phone] = sess;
      return replyWA(res,
        '⚠️ Jumlah tidak valid.\n' +
        'Masukkan angka saja, contoh: *50000*'
      );
    }

    sessions[phone] = { step: 'wait_keterangan', type: sess.type, amount };
    return replyWA(res,
      `✏️ Untuk apa ${sess.type === 'pemasukan' ? 'pemasukan' : 'pengeluaran'} ` +
      `${fmtRupiah(amount)} ini?\n\n` +
      `_Contoh: Gaji, Makan siang, Bensin_`
    );
  }

  // ── STEP: menunggu keterangan ─────────────────────────────────────────────
  if (sess.step === 'wait_keterangan') {
    const keterangan = req.body.Body.trim(); // pakai teks asli (bukan lowercase)

    const tx = {
      id         : Date.now().toString(),
      type       : sess.type,
      amount     : sess.amount,
      keterangan,
      date       : new Date().toISOString(),
      phone
    };
    transactions.push(tx);
    sessions[phone] = { step: 'idle' };

    const emoji = sess.type === 'pemasukan' ? '✅' : '🔴';
    return replyWA(res,
      `${emoji} *Berhasil dicatat!*\n\n` +
      `Jenis       : ${sess.type.charAt(0).toUpperCase() + sess.type.slice(1)}\n` +
      `Jumlah      : ${fmtRupiah(sess.amount)}\n` +
      `Keterangan  : ${keterangan}\n\n` +
      `Ketik *ringkasan* untuk melihat semua transaksi.\n` +
      `Buka dashboard di: ${process.env.DASHBOARD_URL || 'URL_DASHBOARD_KAMU'}`
    );
  }

  // ── STEP: idle — deteksi perintah ─────────────────────────────────────────
  if (body === 'pengeluaran' || body === 'keluar') {
    sessions[phone] = { step: 'wait_amount', type: 'pengeluaran' };
    return replyWA(res,
      '🔴 *Catat Pengeluaran*\n\n' +
      'Berapa jumlah pengeluarannya?\n' +
      '_Contoh: 25000_'
    );
  }

  if (body === 'pemasukan' || body === 'masuk') {
    sessions[phone] = { step: 'wait_amount', type: 'pemasukan' };
    return replyWA(res,
      '✅ *Catat Pemasukan*\n\n' +
      'Berapa jumlah pemasukannya?\n' +
      '_Contoh: 5000000_'
    );
  }

  if (body === 'ringkasan' || body === 'saldo' || body === 'laporan') {
    sessions[phone] = { step: 'idle' };
    return replyWA(res, getRingkasan());
  }

  if (body === 'batal' || body === 'cancel') {
    sessions[phone] = { step: 'idle' };
    return replyWA(res, '❌ Dibatalkan.\n\nKetik perintah yang tersedia di bawah:\n' + getMenu());
  }

  // ── DEFAULT: tampilkan menu ───────────────────────────────────────────────
  sessions[phone] = { step: 'idle' };
  return replyWA(res,
    '👋 *Bot Keuangan Pribadi*\n\n' +
    'Ketik salah satu perintah:\n\n' +
    '📥 *pemasukan* — catat uang masuk\n' +
    '📤 *pengeluaran* — catat uang keluar\n' +
    '📊 *ringkasan* — lihat saldo & riwayat\n\n' +
    '_Ketik *batal* untuk membatalkan input._'
  );
});

// ── API untuk Dashboard (GET /api/transactions) ──────────────────────────────
app.get('/api/transactions', (req, res) => {
  const masuk  = totalByType('pemasukan');
  const keluar = totalByType('pengeluaran');
  res.json({
    summary: {
      pemasukan   : masuk,
      pengeluaran : keluar,
      saldo       : masuk - keluar,
      total       : transactions.length
    },
    transactions: [...transactions].reverse()
  });
});

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Bot Keuangan WhatsApp aktif 🚀' });
});

// ── Start server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server jalan di port ${PORT}`);
  console.log(`📡 Webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`📊 API URL    : http://localhost:${PORT}/api/transactions`);
});
