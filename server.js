require('dotenv').config();
const express = require('express');
const cors = require('cors');
const twilio = require('twilio');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cors());

// ── In-memory storage ────────────────────────────────────────────────────────
const transactions = [];
const sessions = {};
let saldoAwal = 0;

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
  return totalByType('pemasukan') + saldoAwal - totalByType('pengeluaran');
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
    `✅ Pemasukan   : ${fmtRupiah(totalByType('pemasukan'))}\n` +
    `🔴 Pengeluaran : ${fmtRupiah(keluar)}\n` +
    `💰 *Saldo Kini : ${fmtRupiah(saldo)}*\n\n` +
    `📋 *5 Transaksi Terakhir:*\n` +
    listStr + '\n' +
    `━━━━━━━━━━━━━━━━━━`
  );
}

// Tampilkan daftar transaksi by type dengan nomor urut
function getDaftarByType(type) {
  const label = type === 'pemasukan' ? '✅ Pemasukan' : '💵 Saldo';
  const list  = transactions
    .map((t, i) => ({ ...t, globalIdx: i }))
    .filter(t => t.type === type);

  if (!list.length) return null;

  const rows = list.map((t, i) =>
    `  *${i + 1}.* ${fmtRupiah(t.amount)} — ${t.keterangan}`
  ).join('\n');

  return `🗑️ *Hapus ${label}*\n\nPilih nomor yang ingin dihapus:\n\n${rows}\n\nBalas dengan *angka* (contoh: 1)\nAtau ketik *batal* untuk membatalkan.`;
}

// ── Webhook ──────────────────────────────────────────────────────────────────
app.post('/webhook', (req, res) => {
  const body  = (req.body.Body || '').trim().toLowerCase();
  const phone = req.body.From || 'unknown';
  const sess  = sessions[phone] || { step: 'idle' };

  // ── STEP: menunggu jumlah ────────────────────────────────────────────────
  if (sess.step === 'wait_amount') {
    const raw    = body.replace(/[^0-9]/g, '');
    const amount = parseInt(raw, 10);

    if (!amount || amount <= 0) {
      sessions[phone] = sess;
      return replyWA(res, '⚠️ Jumlah tidak valid.\nMasukkan angka saja, contoh: *50000*');
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
          `_Transaksi dibatalkan._`
        );
      }
    }

    sessions[phone] = { step: 'wait_keterangan', type: sess.type, amount };
    const contoh = sess.type === 'saldo' ? 'Saldo awal, Tabungan' : sess.type === 'pemasukan' ? '-' : '-';
    return replyWA(res,
      `✏️ Keterangan untuk ${fmtRupiah(amount)} ini?\n\n_Contoh: ${contoh}_`
    );
  }

  // ── STEP: menunggu keterangan ─────────────────────────────────────────────
  if (sess.step === 'wait_keterangan') {
    const keterangan = req.body.Body.trim();

    if (sess.type === 'saldo') {
      saldoAwal += sess.amount;
    }

    transactions.push({
      id: Date.now().toString(),
      type: sess.type,
      amount: sess.amount,
      keterangan,
      date: new Date().toISOString(),
      phone
    });
    sessions[phone] = { step: 'idle' };

    const emoji = sess.type === 'pemasukan' ? '✅' : sess.type === 'saldo' ? '💵' : '🔴';
    const label = sess.type === 'pemasukan' ? 'Pemasukan' : sess.type === 'saldo' ? 'Saldo' : 'Pengeluaran';
    return replyWA(res,
      `${emoji} *${label} Berhasil Dicatat!*\n\n` +
      `Jumlah     : ${fmtRupiah(sess.amount)}\n` +
      `Keterangan : ${keterangan}\n` +
      `Saldo Kini : ${fmtRupiah(getSaldo())}\n\n` +
      `Ketik *ringkasan* untuk melihat detail.`
    );
  }

  // ── STEP: menunggu nomor hapus ────────────────────────────────────────────
  if (sess.step === 'wait_hapus') {
    const num = parseInt(body.replace(/[^0-9]/g, ''), 10);
    const list = transactions
      .map((t, i) => ({ ...t, globalIdx: i }))
      .filter(t => t.type === sess.hapusType);

    if (!num || num < 1 || num > list.length) {
      sessions[phone] = sess;
      return replyWA(res,
        `⚠️ Nomor tidak valid. Masukkan angka 1 sampai ${list.length}.\nAtau ketik *batal*.`
      );
    }

    const target = list[num - 1];
    const label  = target.keterangan;
    const amount = target.amount;

    // Hapus dari array
    transactions.splice(target.globalIdx, 1);

    // Jika saldo, kurangi saldoAwal juga
    if (target.type === 'saldo') {
      saldoAwal -= target.amount;
      if (saldoAwal < 0) saldoAwal = 0;
    }

    sessions[phone] = { step: 'idle' };
    return replyWA(res,
      `🗑️ *Berhasil Dihapus!*\n\n` +
      `Jenis      : ${target.type === 'pemasukan' ? 'Pemasukan' : 'Saldo'}\n` +
      `Jumlah     : ${fmtRupiah(amount)}\n` +
      `Keterangan : ${label}\n` +
      `Saldo Kini : ${fmtRupiah(getSaldo())}\n\n` +
      `Ketik *ringkasan* untuk melihat detail.`
    );
  }

  // ── IDLE: deteksi perintah ────────────────────────────────────────────────

  if (body === 'hapus pemasukan') {
    const daftar = getDaftarByType('pemasukan');
    if (!daftar) {
      return replyWA(res, '⚠️ Belum ada transaksi pemasukan yang bisa dihapus.');
    }
    sessions[phone] = { step: 'wait_hapus', hapusType: 'pemasukan' };
    return replyWA(res, daftar);
  }

  if (body === 'hapus saldo') {
    const daftar = getDaftarByType('saldo');
    if (!daftar) {
      return replyWA(res, '⚠️ Belum ada saldo yang bisa dihapus.');
    }
    sessions[phone] = { step: 'wait_hapus', hapusType: 'saldo' };
    return replyWA(res, daftar);
  }

  if (body === 'pengeluaran' || body === 'keluar') {
    const saldoSekarang = getSaldo();
    if (saldoSekarang <= 0) {
      sessions[phone] = { step: 'idle' };
      return replyWA(res,
        `❌ *Saldo Kosong!*\n\nSaldo kamu: ${fmtRupiah(saldoSekarang)}\n\nTambah dulu:\n💵 *saldo* — tambah saldo\n✅ *pemasukan* — catat uang masuk`
      );
    }
    sessions[phone] = { step: 'wait_amount', type: 'pengeluaran' };
    return replyWA(res,
      `🔴 *Catat Pengeluaran*\nSaldo tersedia: ${fmtRupiah(saldoSekarang)}\n\nBerapa jumlah pengeluarannya?\n_Contoh: 25000_`
    );
  }

  if (body === 'pemasukan' || body === 'masuk') {
    sessions[phone] = { step: 'wait_amount', type: 'pemasukan' };
    return replyWA(res, '✅ *Catat Pemasukan*\n\nBerapa jumlah pemasukannya?\n_Contoh: 5000000_');
  }

  if (body === 'saldo' || body === 'tambah saldo') {
    sessions[phone] = { step: 'wait_amount', type: 'saldo' };
    return replyWA(res,
      `💵 *Tambah Saldo*\nSaldo saat ini: ${fmtRupiah(getSaldo())}\n\nBerapa saldo yang ingin ditambahkan?\n_Contoh: 500000_`
    );
  }

  if (body === 'ringkasan' || body === 'laporan' || body === 'cek saldo') {
    sessions[phone] = { step: 'idle' };
    return replyWA(res, getRingkasan());
  }

  if (body === 'batal' || body === 'cancel') {
    sessions[phone] = { step: 'idle' };
    return replyWA(res,
      '❌ Dibatalkan.\n\n' + getMenu()
    );
  }

  // ── DEFAULT ───────────────────────────────────────────────────────────────
  sessions[phone] = { step: 'idle' };
  return replyWA(res, getMenu());
});

function getMenu() {
  return (
    '👋 *Bot Keuangan Pribadi*\n\n' +
    'Ketik salah satu perintah:\n\n' +
    '💵 *saldo* — tambah saldo\n' +
    '✅ *pemasukan* — catat uang masuk\n' +
    '🔴 *pengeluaran* — catat uang keluar\n' +
    '📊 *ringkasan* — lihat saldo & riwayat\n' +
    '🗑️ *hapus pemasukan* — hapus data pemasukan\n' +
    '🗑️ *hapus saldo* — hapus data saldo\n\n' +
    '_Ketik *batal* untuk membatalkan input._'
  );
}

// ── API Dashboard ─────────────────────────────────────────────────────────────
app.get('/api/transactions', (req, res) => {
  const keluar = totalByType('pengeluaran');
  const masuk  = totalByType('pemasukan') + saldoAwal;
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

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Bot Keuangan WhatsApp aktif 🚀' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server jalan di port ${PORT}`);
  console.log(`📡 Webhook: http://localhost:${PORT}/webhook`);
  console.log(`📊 API    : http://localhost:${PORT}/api/transactions`);
});