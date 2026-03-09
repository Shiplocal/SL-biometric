/**
 * ShipLocal — One-time data import script
 * Maps real CSV columns → DB schema for EDSP + Debit data
 * Run: node import_data.js
 */

const mysql    = require('mysql2/promise');
const fs       = require('fs');
const readline = require('readline');

const pool = mysql.createPool({
  host: 'localhost', user: 'bifmein1_dbuser',
  password: '_VF&dOshcD_%J*gf',
  database: 'bifmein1_aiauto-biometric',
  waitForConnections: true, connectionLimit: 5
});

// ─── CSV parser (handles commas inside quoted fields) ────
function parseCSV(text) {
  const lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
  const headers = splitCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = splitCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => { row[h] = (vals[idx] || '').trim(); });
    rows.push(row);
  }
  return rows;
}

function splitCSVLine(line) {
  const vals = []; let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === ',' && !inQ) { vals.push(cur.trim().replace(/^"|"$/g,'')); cur = ''; }
    else cur += ch;
  }
  vals.push(cur.trim().replace(/^"|"$/g,''));
  return vals;
}

// ─── Date parsers ────────────────────────────────────────
function parseDate_MDY(str) {
  // M/D/YYYY → YYYY-MM-DD
  if (!str) return null;
  const p = str.trim().split('/');
  if (p.length !== 3) return null;
  return `${p[2]}-${p[0].padStart(2,'0')}-${p[1].padStart(2,'0')}`;
}

function parseDate_DMY(str) {
  // DD-MM-YYYY → YYYY-MM-DD
  if (!str) return null;
  const p = str.trim().split('-');
  if (p.length !== 3) return null;
  return `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
}

// ─── EDSP Import ─────────────────────────────────────────
// CSV cols: holder_employee_id, Amx_ID, report_date, station_code,
//           sp_code, sp_name, shipment_type,
//           final_delivery_count_excluding_swa_smd_smd2.0,
//           final_creturn_count, overall_delivered_swa,
//           overall_delivered_smd2.0, final_mfn_count, final_seller_returns
//
// DB cols:  station_code, amx_id, delivery_date, period_label,
//           parcel_type, delivered, pickup, swa, smd, mfn, returns
async function importEDSP(csvPath, periodLabel) {
  console.log(`\n── EDSP Import ──────────────────────────────`);
  console.log(`   File   : ${csvPath}`);
  console.log(`   Period : ${periodLabel}`);

  const text  = fs.readFileSync(csvPath, 'utf8');
  const rows  = parseCSV(text);
  console.log(`   Parsed : ${rows.length} rows`);

  // Clear existing for this period
  const [del] = await pool.execute('DELETE FROM edsp_data WHERE period_label=?', [periodLabel]);
  console.log(`   Cleared: ${del.affectedRows} existing rows`);

  let inserted = 0, skipped = 0, errors = 0;
  for (const r of rows) {
    const station = (r['station_code'] || '').toUpperCase().trim();
    const amxId   = (r['Amx_ID'] || '').trim();
    const dateStr = (r['report_date'] || '').trim();
    const stype   = (r['shipment_type'] || '').trim();

    // Skip header repeats or empty rows
    if (!station || !amxId || station === 'STATION_CODE' || amxId === 'Amx_ID') { skipped++; continue; }
    if (!dateStr || dateStr === 'report_date') { skipped++; continue; }

    const delivDate = parseDate_MDY(dateStr);
    if (!delivDate) { console.log(`   SKIP bad date: "${dateStr}"`); skipped++; continue; }

    // Map counts per shipment_type
    const isDelivery = stype === 'Delivery';
    const isMFN      = stype === 'MFNPickup';
    const isReturn   = stype === 'ReturnPickup';

    const delivered = isDelivery ? (parseInt(r['final_delivery_count_excluding_swa_smd_smd2.0']) || 0) : 0;
    const cReturns  = isDelivery ? (parseInt(r['final_creturn_count']) || 0) : 0;
    const swa       = isDelivery ? (parseInt(r['overall_delivered_swa']) || 0) : 0;
    const smd       = isDelivery ? (parseInt(r['overall_delivered_smd2.0']) || 0) : 0;
    const mfn       = isMFN      ? (parseInt(r['final_mfn_count']) || 0) : 0;
    const pickup    = isReturn   ? (parseInt(r['final_seller_returns']) || 0) : 0;

    const parcelType = isDelivery ? 'Delivery' : isMFN ? 'MFNPickup' : isReturn ? 'ReturnPickup' : stype;

    try {
      await pool.execute(
        `INSERT INTO edsp_data
           (station_code, amx_id, delivery_date, period_label, parcel_type,
            delivered, pickup, swa, smd, mfn, returns)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [station, amxId, delivDate, periodLabel, parcelType,
         delivered, pickup, swa, smd, mfn, cReturns]
      );
      inserted++;
    } catch(e) {
      if (errors < 5) console.log(`   ERR: ${e.message.substring(0,80)} | ${station}/${amxId}`);
      errors++;
    }
  }
  console.log(`   ✓ Inserted: ${inserted} | Skipped: ${skipped} | Errors: ${errors}`);
}

// ─── Debit Import ─────────────────────────────────────────
// CSV cols: tid, impact_date, loss_bucket, loss_sub_bucket, shipment_type,
//           station, value, Cluster, Status, User Name,
//           Debit Note Confirm by, Cash Recovery Type, Dispute, TT,
//           Orphan ID/Double Lable Id, CM Confirm, Remarks, Debit-Type
//
// DB cols:  tid, station_code, period_label, debit_date,
//           bucket, amount, confirm_by, sub_type
async function importDebit(csvPath, periodLabel) {
  console.log(`\n── Debit Import ─────────────────────────────`);
  console.log(`   File   : ${csvPath}`);
  console.log(`   Period : ${periodLabel}`);

  const text = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCSV(text);
  console.log(`   Parsed : ${rows.length} rows`);

  const [del] = await pool.execute('DELETE FROM debit_data WHERE period_label=?', [periodLabel]);
  console.log(`   Cleared: ${del.affectedRows} existing rows`);

  let inserted = 0, skipped = 0, errors = 0;
  for (const r of rows) {
    const tid     = (r['tid'] || '').trim();
    const station = (r['station'] || '').toUpperCase().trim();
    const dateStr = (r['impact_date'] || '').trim();
    const amount  = parseFloat(r['value']) || 0;
    const bucket  = (r['loss_bucket'] || '').trim();
    const subType = (r['Debit-Type'] || 'Final Loss').trim();
    const confirmBy = (r['Debit Note Confirm by'] || '').trim();

    if (!tid || tid === 'tid') { skipped++; continue; }
    if (!station) { skipped++; continue; }

    // DD-MM-YYYY format
    const debitDate = parseDate_DMY(dateStr);

    try {
      await pool.execute(
        `INSERT INTO debit_data
           (tid, station_code, period_label, debit_date, bucket, amount, confirm_by, sub_type)
         VALUES (?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           station_code=VALUES(station_code), period_label=VALUES(period_label),
           debit_date=VALUES(debit_date), bucket=VALUES(bucket),
           amount=VALUES(amount), confirm_by=VALUES(confirm_by), sub_type=VALUES(sub_type)`,
        [tid, station, periodLabel, debitDate, bucket, amount, confirmBy, subType]
      );
      inserted++;
    } catch(e) {
      if (errors < 5) console.log(`   ERR: ${e.message.substring(0,80)} | tid=${tid}`);
      errors++;
    }
  }
  console.log(`   ✓ Inserted: ${inserted} | Skipped: ${skipped} | Errors: ${errors}`);
}

// ─── Advance debug ────────────────────────────────────────
async function debugAdvances() {
  console.log(`\n── Advance Data Debug ───────────────────────`);
  // Check what's actually in the table
  const [rows] = await pool.execute(
    'SELECT station_code, period_label, ic_name, amount, submitted_at FROM log_advances ORDER BY submitted_at DESC LIMIT 20'
  );
  if (!rows.length) {
    console.log('   ✗ log_advances is EMPTY');
  } else {
    console.log(`   Found ${rows.length} rows:`);
    rows.forEach(r => console.log(`     ${r.station_code} | ${r.period_label} | ${r.ic_name} | ₹${r.amount}`));
  }

  // Check active period
  const [periods] = await pool.execute('SELECT * FROM config_period WHERE is_active=1');
  if (periods.length) {
    const p = periods[0];
    console.log(`\n   Active period: ${p.period_label}`);
    const [matching] = await pool.execute(
      'SELECT COUNT(*) AS cnt FROM log_advances WHERE period_label=?', [p.period_label]
    );
    console.log(`   Advances for active period: ${matching[0].cnt}`);
    if (!matching[0].cnt && rows.length) {
      console.log(`   ⚠  Period mismatch! Advances saved as "${rows[0].period_label}" but active is "${p.period_label}"`);
      console.log(`      Fix: UPDATE log_advances SET period_label='${p.period_label}' WHERE period_label='${rows[0].period_label}';`);
    }
  } else {
    console.log('   ✗ No active period found');
  }
}

// ─── Main ─────────────────────────────────────────────────
async function main() {
  const PERIOD = '2026-01-B';  // Jan 16–31 2026

  await importEDSP(
    '/mnt/user-data/uploads/PortalSheet_-_EDSP_data.csv',
    PERIOD
  );

  await importDebit(
    '/mnt/user-data/uploads/DebitFlow_-_Debit_data.csv',
    PERIOD
  );

  await debugAdvances();

  console.log('\n✓ Done.\n');
  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });