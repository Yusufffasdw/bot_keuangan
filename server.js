require('dotenv').config();
const express = require('express');
const cors = require('cors');
const twilio = require('twilio');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cors());

// ── In-memory storage ────────────────────────────────────────────────────────
const transactions = [];   // { id, type, amount, keterangan, date, phone }
const sessions = {};       // { phone: { step, type, amount } }
let saldoAwal = 0;         // Saldo awal yang bisa ditambahkan manual

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

function getSaldo() {
  const masuk  = totalByType('pemasukan') + saldoAwal;
  const keluar = totalByType('pengeluaran');
  return masuk - keluar;
}

function getRingkasan() {
  const masuk  = totalByType('pemasukan') + saldoAwal;
  const keluar = totalByType('pengeluaran');
  const saldo  = masuk - keluar;
  const last5  = [...transactions].reverse().slice(0, 5);
  const listStr = last5.length
    ? last5.map(t =>
        `  ${t.type === 'pemasukan' ? '✅' : t.type === 'saldo' ? '💵' : '🔴'} ${fmtRupiah(t.amount)} — ${t.keterangan}`
      ).join('\n')
    : '  (belum ada transaksi)';

  return (
    `━━━━━━━━━━━━━━━━━━\n` +
    `📊 *RINGKASAN KEUANGAN*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `💵 Saldo Awal  : ${fmtRupiah(saldoAwal)}\n` +
    `💚 Pemasukan   : ${fmtRupiah(totalByType('pemasukan'))}\n` +
    `❤️  Pengeluaran : ${fmtRupiah(keluar)}\n` +
    `💰 *Saldo Kini : ${fmtRupiah(saldo)}*\n\n` +
    `📋 *5 Transaksi Terakhir:*\n` +
    listStr + '\n' +
    `━━━━━━━━━━━━━━━━━━`
  );
}

// ── Webhook WhatsApp ─────────────────────────────────────────────────────────
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

    // Cek saldo jika pengeluaran
    if (sess.type === 'pengeluaran') {
      const saldoSekarang = getSaldo();
      if (amount > saldoSekarang) {
        sessions[phone] = { step: 'idle' };
        return replyWA(res,
          `❌ *Saldo Tidak Mencukupi!*\n\n` +
          `Pengeluaran : ${fmtRupiah(amount)}\n` +
          `Saldo kamu  : ${fmtRupiah(saldoSekarang)}\n` +
          `Kurang      : ${fmtRupiah(amount - saldoSekarang)}\n\n` +
          `_Transaksi dibatalkan. Tambah saldo atau pemasukan dulu ya!_`
        );
      }
    }

    sessions[phone] = { step: 'wait_keterangan', type: sess.type, amount };
    return replyWA(res,
      `✏️ Untuk apa ${sess.type === 'pemasukan' ? 'pemasukan' : sess.type === 'saldo' ? 'saldo' : 'pengeluaran'} ` +
      `${fmtRupiah(amount)} ini?\n\n` +
      `_Contoh: ${sess.type === 'saldo' ? 'Saldo awal, Tabungan' : sess.type === 'pemasukan' ? 'Gaji, Freelance' : 'Makan siang, Bensin'}_`
    );
  }

  // ── STEP: menunggu keterangan ─────────────────────────────────────────────
  if (sess.step === 'wait_keterangan') {
    const keterangan = req.body.Body.trim();

    // Jika tipe saldo, tambahkan ke saldoAwal
    if (sess.type === 'saldo') {
      saldoAwal += sess.amount;
      transactions.push({
        id: Date.now().toString(),
        type: 'saldo',
        amount: sess.amount,
        keterangan,
        date: new Date().toISOString(),
        phone
      });
      sessions[phone] = { step: 'idle' };
      return replyWA(res,
        `💵 *Saldo Berhasil Ditambahkan!*\n\n` +
        `Ditambahkan  : ${fmtRupiah(sess.amount)}\n` +
        `Keterangan   : ${keterangan}\n` +
        `Saldo Kini   : ${fmtRupiah(getSaldo())}\n\n` +
        `Ketik *ringkasan* untuk melihat detail.`
      );
    }

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
      `Jenis        : ${sess.type.charAt(0).toUpperCase() + sess.type.slice(1)}\n` +
      `Jumlah       : ${fmtRupiah(sess.amount)}\n` +
      `Keterangan   : ${keterangan}\n` +
      `Saldo Kini   : ${fmtRupiah(getSaldo())}\n\n` +
      `Ketik *ringkasan* untuk melihat semua transaksi.`
    );
  }

  // ── STEP: idle — deteksi perintah ─────────────────────────────────────────
  if (body === 'pengeluaran' || body === 'keluar') {
    const saldoSekarang = getSaldo();
    if (saldoSekarang <= 0) {
      sessions[phone] = { step: 'idle' };
      return replyWA(res,
        `❌ *Saldo Kosong!*\n\n` +
        `Saldo kamu saat ini: ${fmtRupiah(saldoSekarang)}\n\n` +
        `Tambah saldo atau pemasukan dulu dengan ketik:\n` +
        `💵 *saldo* — tambah saldo\n` +
        `✅ *pemasukan* — catat uang masuk`
      );
    }
    sessions[phone] = { step: 'wait_amount', type: 'pengeluaran' };
    return replyWA(res,
      `🔴 *Catat Pengeluaran*\n` +
      `Saldo tersedia: ${fmtRupiah(saldoSekarang)}\n\n` +
      `Berapa jumlah pengeluarannya?\n` +
      `_Contoh: 25000_`
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

  if (body === 'saldo' || body === 'tambah saldo') {
    sessions[phone] = { step: 'wait_amount', type: 'saldo' };
    return replyWA(res,
      `💵 *Tambah Saldo*\n` +
      `Saldo saat ini: ${fmtRupiah(getSaldo())}\n\n` +
      `Berapa saldo yang ingin ditambahkan?\n` +
      `_Contoh: 500000_`
    );
  }

  if (body === 'ringkasan' || body === 'laporan' || body === 'cek saldo') {
    sessions[phone] = { step: 'idle' };
    return replyWA(res, getRingkasan());
  }

  if (body === 'batal' || body === 'cancel') {
    sessions[phone] = { step: 'idle' };
    return replyWA(res,
      '❌ Dibatalkan.\n\n' +
      '👋 *Perintah tersedia:*\n\n' +
      '💵 *saldo* — tambah saldo\n' +
      '✅ *pemasukan* — catat uang masuk\n' +
      '🔴 *pengeluaran* — catat uang keluar\n' +
      '📊 *ringkasan* — lihat saldo & riwayat\n\n' +
      '_Ketik *batal* untuk membatalkan input._'
    );
  }

  // ── DEFAULT: menu ─────────────────────────────────────────────────────────
  sessions[phone] = { step: 'idle' };
  return replyWA(res,
    '👋 *Bot Keuangan Pribadi*\n\n' +
    'Ketik salah satu perintah:\n\n' +
    '💵 *saldo* — tambah saldo\n' +
    '✅ *pemasukan* — catat uang masuk\n' +
    '🔴 *pengeluaran* — catat uang keluar\n' +
    '📊 *ringkasan* — lihat saldo & riwayat\n\n' +
    '_Ketik *batal* untuk membatalkan input._'
  );
});

// ── API Dashboard ─────────────────────────────────────────────────────────────
app.get('/api/transactions', (req, res) => {
  const masuk  = totalByType('pemasukan') + saldoAwal;
  const keluar = totalByType('pengeluaran');
  res.json({
    summary: {
      saldoAwal,
      pemasukan   : totalByType('pemasukan'),
      pengeluaran : keluar,
      saldo       : masuk - keluar,
      total       : transactions.length
    },
    transactions: [...transactions].reverse()
  });
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Bot Keuangan WhatsApp aktif 🚀' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server jalan di port ${PORT}`);
  console.log(`📡 Webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`📊 API URL    : http://localhost:${PORT}/api/transactions`);
});