/**
 * ShipLocal Warehouse Portal - app.js v4.0
 * Modules: Biometric Attendance + KMS/IC + Attendance Period + Advances + Debit Flow
 */

// ── Kill stale processes from previous LiteSpeed spawns ──
try { require('./cleanup').cleanupStaleProcesses(); } catch(e) { console.warn('cleanup skip:', e.message); }

const express  = require('express');
const mysql    = require('mysql2/promise');
const crypto   = require('crypto');
const bcrypt   = require('bcrypt');
const path     = require('path');
const multer   = require('multer');
const csvParse = require('csv-parse');
// csv-parse v5+ moved sync to csv-parse/sync; v4 used callback with sync:true
let _syncParse;
try {
  _syncParse = require('csv-parse/sync').parse;
} catch(e) {
  // v4 fallback: wrap callback API as sync
  const _fn = typeof csvParse === 'function' ? csvParse : csvParse.parse;
  _syncParse = (str, opts) => {
    const results = [];
    _fn(str, {...opts, sync: true}, (err, out) => { if (out) results.push(...out); });
    return results;
  };
}
const csv = { parse: (str, opts) => _syncParse(str, opts) };

const cookieParser = require('cookie-parser');
const app    = express();
app.use(cookieParser());
const upload = multer({ storage: multer.memoryStorage() });
app.use(express.json({ limit: '100mb' }));



const pool = mysql.createPool({
  host: 'localhost', user: 'bifmein1_dbuser',
  password: '_VF&dOshcD_%J*gf', database: 'bifmein1_aiauto-biometric',
  dateStrings: true
});

// Legacy DB - read-only, used for stations, staff, login
const legacyPool = mysql.createPool({
  host: 'localhost', user: 'bifmein1_aws2019',
  password: 'eA]n(gsN=[_2', database: 'bifmein1_nship24',
  dateStrings: true
});

// ── ONE-TIME MIGRATIONS ──────────────────────────────────
pool.execute("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='debit_data' AND COLUMN_NAME='recovery_month'")
  .then(function(r){ if(!r[0]||!r[0].length) return pool.execute("ALTER TABLE debit_data ADD COLUMN recovery_month TINYINT NULL"); })
  .catch(function(){});
// ── Admin auth tables ─────────────────────────────────────────────────────────
pool.execute("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='admin_users'")
  .then(function(r){ if(!r[0]||!r[0].length) return pool.execute(`CREATE TABLE admin_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('superadmin','ops_admin','finance','hr','viewer','cluster_manager') NOT NULL DEFAULT 'viewer',
    extra_tabs JSON DEFAULT NULL,
    denied_tabs JSON DEFAULT NULL,
    force_pw_change TINYINT DEFAULT 0,
    is_active TINYINT DEFAULT 1,
    created_by INT DEFAULT NULL,
    last_login DATETIME DEFAULT NULL,
    last_login_ip VARCHAR(45) DEFAULT NULL,
    failed_attempts TINYINT DEFAULT 0,
    locked_until DATETIME DEFAULT NULL,
    created_at DATETIME DEFAULT NOW(),
    UNIQUE KEY uq_email (email)
  )`); })
  .catch(function(e){ console.error('admin_users migration:', e.message); });

pool.execute("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='admin_sessions'")
  .then(function(r){ if(!r[0]||!r[0].length) return pool.execute(`CREATE TABLE admin_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    token_hash VARCHAR(64) NOT NULL,
    ip_address VARCHAR(45) DEFAULT NULL,
    user_agent VARCHAR(300) DEFAULT NULL,
    created_at DATETIME DEFAULT NOW(),
    expires_at DATETIME NOT NULL,
    last_seen DATETIME DEFAULT NOW(),
    revoked TINYINT DEFAULT 0,
    UNIQUE KEY uq_token (token_hash),
    INDEX idx_sess_user (user_id),
    INDEX idx_sess_expires (expires_at)
  )`); })
  .catch(function(e){ console.error('admin_sessions migration:', e.message); });

pool.execute("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='audit_log'")
  .then(function(r){ if(!r[0]||!r[0].length) return pool.execute(`CREATE TABLE audit_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT DEFAULT NULL,
    user_name VARCHAR(100) DEFAULT NULL,
    action VARCHAR(60) NOT NULL,
    entity VARCHAR(60) DEFAULT NULL,
    entity_id VARCHAR(100) DEFAULT NULL,
    detail JSON DEFAULT NULL,
    ip_address VARCHAR(45) DEFAULT NULL,
    created_at DATETIME DEFAULT NOW(),
    INDEX idx_audit_user (user_id),
    INDEX idx_audit_action (action),
    INDEX idx_audit_at (created_at)
  )`); })
  .catch(function(e){ console.error('audit_log migration:', e.message); });

// ── CM WH tokens table
pool.execute("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cm_wh_tokens'")
  .then(function(r){ if(!r[0]||!r[0].length) return pool.execute(`CREATE TABLE cm_wh_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    token VARCHAR(64) NOT NULL,
    admin_user_id INT NOT NULL,
    station_code VARCHAR(20) NOT NULL,
    used TINYINT DEFAULT 0,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT NOW(),
    UNIQUE KEY uq_token (token),
    INDEX idx_cm_wh_exp (expires_at)
  )`); })
  .catch(function(e){ console.error('cm_wh_tokens migration:', e.message); });

// ── Ensure cluster_manager is in admin_users role ENUM
pool.execute("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='admin_users' AND COLUMN_NAME='role'")
  .then(function(){ return pool.execute("ALTER TABLE admin_users MODIFY COLUMN role ENUM('superadmin','ops_admin','finance','hr','viewer','cluster_manager') NOT NULL DEFAULT 'viewer'"); })
  .catch(function(e){ console.error('role enum migration:', e.message); });

// ── CM staff ID link on admin_users
pool.execute("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='admin_users' AND COLUMN_NAME='cm_staff_id'")
  .then(function(r){ if(!r[0]||!r[0].length) return pool.execute("ALTER TABLE admin_users ADD COLUMN cm_staff_id INT DEFAULT NULL, ADD INDEX idx_cm_staff (cm_staff_id)"); })
  .catch(function(e){ console.error('cm_staff_id migration:', e.message); });

// ── CM Attendance table
pool.execute("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cm_attendance'")
  .then(function(r){ if(!r[0]||!r[0].length) return pool.execute(`CREATE TABLE cm_attendance (
    id INT AUTO_INCREMENT PRIMARY KEY,
    cm_staff_id INT NOT NULL,
    cm_name VARCHAR(100) NOT NULL,
    station_code VARCHAR(20) NOT NULL,
    punch_type ENUM('CLOCK_IN','CLOCK_OUT') NOT NULL,
    punched_at DATETIME DEFAULT NOW(),
    source ENUM('WH_MACHINE','MOBILE','LAPTOP') DEFAULT 'MOBILE',
    machine_id VARCHAR(50) DEFAULT NULL,
    ip_address VARCHAR(45) DEFAULT NULL,
    latitude DECIMAL(10,8) DEFAULT NULL,
    longitude DECIMAL(11,8) DEFAULT NULL,
    location_accuracy FLOAT DEFAULT NULL,
    created_at DATETIME DEFAULT NOW(),
    INDEX idx_cma_staff (cm_staff_id),
    INDEX idx_cma_station (station_code),
    INDEX idx_cma_date (punched_at)
  )`); })
  .catch(function(e){ console.error('cm_attendance migration:', e.message); });

// ── Export log table
pool.execute("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='export_log'")
  .then(function(r){ if(!r[0]||!r[0].length) return pool.execute(`CREATE TABLE export_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    exported_by VARCHAR(100) NOT NULL,
    export_type VARCHAR(60) NOT NULL,
    export_params JSON DEFAULT NULL,
    row_count INT DEFAULT 0,
    exported_at DATETIME DEFAULT NOW(),
    INDEX idx_exp_type (export_type),
    INDEX idx_exp_at (exported_at)
  )`); })
  .catch(function(e){ console.error('export_log migration:', e.message); });

// ── Invoice table
pool.execute("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='invoices'")
  .then(function(r){ if(!r[0]||!r[0].length) return pool.execute(`CREATE TABLE invoices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    invoice_number VARCHAR(60) NOT NULL,
    station VARCHAR(20) NOT NULL,
    amazon_entity VARCHAR(20) DEFAULT NULL,
    invoice_date DATE DEFAULT NULL,
    period_from DATE DEFAULT NULL,
    period_to DATE DEFAULT NULL,
    net_amount_due DECIMAL(14,2) DEFAULT 0,
    taxable_subtotal DECIMAL(14,2) DEFAULT 0,
    total_gst DECIMAL(14,2) DEFAULT 0,
    total_taxable DECIMAL(14,2) DEFAULT 0,
    chargeback_package_loss DECIMAL(14,2) DEFAULT 0,
    chargeback_cod_loss DECIMAL(14,2) DEFAULT 0,
    total_chargebacks DECIMAL(14,2) DEFAULT 0,
    line_items JSON DEFAULT NULL,
    pdf_filename VARCHAR(255) DEFAULT NULL,
    uploaded_by VARCHAR(100) DEFAULT NULL,
    uploaded_at DATETIME DEFAULT NOW(),
    notes TEXT DEFAULT NULL,
    UNIQUE KEY uq_inv (invoice_number),
    INDEX idx_inv_station (station),
    INDEX idx_inv_date (invoice_date)
  )`); })
  .catch(function(e){ console.error('Invoice table migration:', e.message); });
// Recovery response columns — each always means the same thing
pool.execute("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='debit_responses' AND COLUMN_NAME='recovery_type'")
  .then(function(r){ if(!r[0]||!r[0].length) return pool.execute("ALTER TABLE debit_responses ADD COLUMN recovery_type VARCHAR(50) NULL"); })
  .catch(function(){});
pool.execute("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='debit_responses' AND COLUMN_NAME='recovery_confirm_by'")
  .then(function(r){ if(!r[0]||!r[0].length) return pool.execute("ALTER TABLE debit_responses ADD COLUMN recovery_confirm_by VARCHAR(100) NULL"); })
  .catch(function(){});
pool.execute("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='debit_responses' AND COLUMN_NAME='recovery_ic_names'")
  .then(function(r){ if(!r[0]||!r[0].length) return pool.execute("ALTER TABLE debit_responses ADD COLUMN recovery_ic_names VARCHAR(2000) NULL"); })
  .catch(function(){});

// SQL helper: timestamp column name (backtick-safe in template literals)

// Helper to inject backtick-timestamp safely

// In-memory test flags (reset on restart)
const testFlags = { bypassFace: false, bypassMachine: false, skipMidnightClose: false };

// -------------------------------------------------------
//  HELPERS
// -------------------------------------------------------

async function getActivePeriod() {
  const [rows] = await pool.execute('SELECT * FROM config_period WHERE is_active=1 ORDER BY id DESC LIMIT 1');
  if (rows.length) return rows[0];
  // Auto-generate current period if none set
  const now = new Date();
  const d = now.getDate();
  const y = now.getFullYear(), m = now.getMonth();
  let start, end, label;
  if (d <= 15) {
    start = new Date(y, m, 1);
    end   = new Date(y, m, 15);
    label = `${y}-${String(m+1).padStart(2,'0')}-A`;
  } else {
    start = new Date(y, m, 16);
    end   = new Date(y, m+1, 0);
    label = `${y}-${String(m+1).padStart(2,'0')}-B`;
  }
  await pool.execute('INSERT INTO config_period (period_start,period_end,period_label,is_active) VALUES (?,?,?,1)',
    [start, end, label]);
  return { period_start: start, period_end: end, period_label: label };
}

async function isLocked(station, module_, periodLabel) {
  const [rows] = await pool.execute(
    "SELECT status FROM config_status WHERE station_code=? AND module=? AND period_label=? AND status='SUBMITTED'",
    [station, module_, periodLabel]
  );
  return rows.length > 0;
}

async function lockModule(station, module_, periodLabel) {
  await pool.execute(
    `INSERT INTO config_status (station_code, module, period_label, status, submitted_at)
     VALUES (?,?,?,'SUBMITTED',NOW())
     ON DUPLICATE KEY UPDATE status='SUBMITTED', submitted_at=NOW()`,
    [station, module_, periodLabel]
  );
}

async function getOpenShift(icId) {
  const [rows] = await pool.execute(
    'SELECT id, `timestamp` AS created_at FROM log_attendance_wh WHERE ic_id=? AND punch_type=\'CLOCK_IN\' AND id NOT IN (SELECT COALESCE(shift_id,0) FROM log_attendance_wh WHERE ic_id=? AND punch_type IN (\'CLOCK_OUT\',\'SYSTEM_LOGOUT\') AND shift_id IS NOT NULL) ORDER BY `timestamp` DESC LIMIT 1',
    [icId, icId]
  );
  return rows.length ? rows[0] : null;
}

async function closeShift(icId, icName, station, machineId, clockInRow, punchType, clockOutTime) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const durMins = Math.round((new Date(clockOutTime) - new Date(clockInRow.created_at)) / 60000);
    await conn.execute(
      `INSERT INTO log_attendance_wh (ic_id,station_code,machine_id,punch_type,shift_id,status) VALUES (?,?,?,?,?,?)`,
      [icId, station, machineId, punchType, clockInRow.id, punchType]
    );
    const shiftStatus = punchType === 'SYSTEM_LOGOUT' ? 'SYSTEM_CLOSED' : 'NORMAL';
    await conn.execute(
      `INSERT INTO attendance_shifts (ic_id,ic_name,station_code,machine_id,clock_in,clock_out,duration_mins,shift_status) VALUES (?,?,?,?,?,?,?,?)`,
      [icId, icName, station, machineId, new Date(clockInRow.created_at), new Date(clockOutTime), durMins, shiftStatus]
    );
    if (punchType === 'SYSTEM_LOGOUT') {
      const vDate = new Date(clockInRow.created_at).toISOString().split('T')[0];
      await conn.execute(
        `INSERT INTO attendance_violations (ic_id,ic_name,station_code,violation_date,violation_type,clock_in,notes,month_year) VALUES (?,?,?,?,'MISSING_CLOCKOUT',?,?,?)`,
        [icId, icName, station, vDate, new Date(clockInRow.created_at), `Auto logout. Duration: ${durMins} mins.`, vDate.substring(0,7)]
      );
    }
    await conn.commit();
    return { durMins, shiftStatus };
  } catch(e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
}

// -------------------------------------------------------
//  STATIONS & AUTH
// -------------------------------------------------------

app.get('/api/stations', async (req, res) => {
  try {
    const [r] = await pool.execute(
      `SELECT station_code, store_name, address, store_email, store_cat,
              esic, latitude, longitude, state, status
       FROM stations WHERE is_delete=0 AND status=0 AND station_code!=''
       ORDER BY station_code`
    );
    res.json(r);
  } catch(e) { res.status(500).json({error:e.message}); }
})

app.post('/api/manager-login', async (req, res) => {
  const {station, password} = req.body;
  try {
    const [r] = await pool.execute(
      `SELECT station_code FROM stations WHERE station_code=? AND is_delete=0 AND status=0`,
      [station.trim()]
    );
    if (r.length) res.json({success:true, stationCode: r[0].station_code});
    else res.status(401).json({success:false, error:'Station not found'});
  } catch(e) { res.status(500).json({error:'Login failed'}); }
})

app.post('/api/admin-verify', (req, res) => {
  if (req.body.password === 'admin123#') res.json({success:true});
  else res.status(401).json({success:false});
});

// -------------------------------------------------------
//  MACHINE MANAGEMENT
// -------------------------------------------------------

app.post('/api/verify-token', async (req, res) => {
  const {token} = req.body;
  if (!token) return res.json({authorized:false});
  try {
    const [r] = await pool.execute('SELECT * FROM config_machines WHERE machine_token=? AND status="ACTIVE"', [token]);
    if (r.length) res.json({authorized:true, station:r[0].station_code, machineId:r[0].machine_id});
    else res.json({authorized:false});
  } catch(e) { res.status(500).json({error:'Failed'}); }
});

app.get('/api/pending-check/:station', async (req, res) => {
  try {
    const [r] = await pool.execute('SELECT id,temp_cctv_code FROM config_machines WHERE station_code=? AND status="AWAITING_CCTV"', [req.params.station]);
    res.json({hasPending: r.length>0, existingCode: (r[0] ? r[0].temp_cctv_code : null)||null});
  } catch(e) { res.status(500).json({error:'Failed'}); }
});

app.post('/api/register-machine', async (req, res) => {
  const {station, code} = req.body;
  try {
    await pool.execute('DELETE FROM config_machines WHERE station_code=? AND status="AWAITING_CCTV"', [station]);
    await pool.execute('INSERT INTO config_machines (station_code,machine_id,status,temp_cctv_code) VALUES (?,?,?,?)', [station, `PENDING-${code}`, 'AWAITING_CCTV', code]);
    res.json({success:true});
  } catch(e) { res.status(500).json({error:'Failed'}); }
});

app.post('/api/approve-machine', async (req, res) => {
  const {cctvCode, stationCode, adminName} = req.body;
  try {
    const [r] = await pool.execute('SELECT * FROM config_machines WHERE temp_cctv_code=? AND station_code=? AND status="AWAITING_CCTV"', [cctvCode, stationCode]);
    if (!r.length) return res.status(404).json({error:'Not found'});
    const token = crypto.randomBytes(32).toString('hex');
    const mid = `WH-${stationCode}-${cctvCode}`;
    await pool.execute('UPDATE config_machines SET status="ACTIVE",machine_token=?,machine_id=?,approved_by=? WHERE temp_cctv_code=? AND station_code=?',
      [token, mid, adminName||'Admin', cctvCode, stationCode]);
    res.json({success:true, token, machineId:mid, station:stationCode});
  } catch(e) { res.status(500).json({error:'Failed'}); }
});

app.post('/api/cancel-machine-request', async (req, res) => {
  try { await pool.execute('DELETE FROM config_machines WHERE id=? AND status="AWAITING_CCTV"', [req.body.id]); res.json({success:true}); }
  catch(e) { res.status(500).json({error:'Failed'}); }
});

app.get('/api/check-approval/:code', async (req, res) => {
  try {
    const [r] = await pool.execute('SELECT machine_token,station_code,machine_id FROM config_machines WHERE temp_cctv_code=? AND status="ACTIVE"', [req.params.code]);
    if (r.length) res.json({approved:true, token:r[0].machine_token, station:r[0].station_code, machineId:r[0].machine_id});
    else res.json({approved:false});
  } catch(e) { res.status(500).json({error:'Failed'}); }
});

app.get('/api/machines', async (req, res) => {
  try { const [r] = await pool.execute('SELECT * FROM config_machines ORDER BY id DESC'); res.json(r); }
  catch(e) { res.status(500).json({error:'Failed'}); }
});

app.post('/api/machine-deactivate', async (req, res) => {
  try { await pool.execute('UPDATE config_machines SET status="INACTIVE" WHERE id=?', [req.body.id]); res.json({success:true}); }
  catch(e) { res.status(500).json({error:'Failed'}); }
});

app.post('/api/machine-delete', async (req, res) => {
  try { await pool.execute('DELETE FROM config_machines WHERE id=?', [req.body.id]); res.json({success:true}); }
  catch(e) { res.status(500).json({error:'Failed'}); }
});

// -------------------------------------------------------
//  STAFF & BIOMETRICS
// -------------------------------------------------------

// ── IC list by station (for debit entry dropdown) ────────────────────────────
app.get('/api/ic-list', async (req, res) => {
  const { station } = req.query;
  if (!station) return res.status(400).json({error:'station required'});
  try {
    const [ics] = await pool.execute(
      `SELECT w.ic_id, w.ic_name,
              CASE COALESCE(s.user_type,0)
                WHEN 2  THEN 'Station Incharge'
                WHEN 4  THEN 'Delivery Associate'
                WHEN 5  THEN 'Cluster Manager'
                WHEN 8  THEN 'Van Associate'
                WHEN 14 THEN 'Station Associate'
                WHEN 19 THEN 'Team Leader'
                WHEN 20 THEN 'Loader'
                ELSE ''
              END AS designation
       FROM config_whic w
       LEFT JOIN staff s ON s.id = w.staff_id
       WHERE w.is_active=1 AND w.station_code=?
       ORDER BY w.ic_name`,
      [station]
    );
    // Also get CM for this station
    const [stRows] = await pool.execute(
      `SELECT s.station_code,
              TRIM(CONCAT(COALESCE(cm.fname,''),' ',COALESCE(cm.lname,''))) AS cluster_manager
       FROM stations s
       LEFT JOIN staff cm ON cm.id = s.primary_cluster_manager
       WHERE s.station_code=? AND s.is_delete=0
       LIMIT 1`,
      [station]
    );
    const cm = stRows[0] ? (stRows[0].cluster_manager||'').trim() : '';
    res.json({ ics, cluster_manager: cm });
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/staff/:station', async (req, res) => {
  try {
    const station = req.params.station;
    const [ics] = await pool.execute(
      `SELECT ic_id, ic_name, station_code FROM config_whic
       WHERE is_active=1 AND station_code=? ORDER BY ic_name`, [station]
    );
    // Merge with biometric status from main DB (parallel queries)
    const icIds = ics.map(ic => String(ic.ic_id));
    const bioMap = {}, accessMap = {}, bioPhotoMap = {};
    if (icIds.length) {
      const ph = icIds.map(()=>'?').join(',');
      const [[bioRows],[accRows]] = await Promise.all([
        pool.execute(`SELECT ic_id,enroll_status FROM biometric_vault WHERE ic_id IN (${ph})`, icIds).catch(()=>[[]]),
        pool.execute(`SELECT ic_id,can_access_modules FROM config_whic WHERE ic_id IN (${ph})`, icIds).catch(()=>[[]])
      ]);
      bioRows.forEach(b => { bioMap[b.ic_id] = b.enroll_status; bioPhotoMap[b.ic_id] = b.enroll_photo; });
      accRows.forEach(a => accessMap[a.ic_id] = a.can_access_modules);
    }
    res.json(ics.map(ic => ({
      ic_id: String(ic.ic_id), ic_name: (ic.ic_name||'').trim(),
      station_code: station,
      has_face: bioMap[String(ic.ic_id)] ? 1 : 0,
      enroll_status: bioMap[String(ic.ic_id)] || 'NONE',
      enroll_photo: bioPhotoMap[String(ic.ic_id)] || null,
      can_access_modules: accessMap[String(ic.ic_id)] || 0
    })));
  } catch(e) { res.status(500).json({error:e.message}); }
})

app.get('/api/users', async (req, res) => {
  try {
    // Fetch all three datasets in parallel instead of sequential giant IN clauses
    const [[ics], [bioRows], [accRows]] = await Promise.all([
      pool.execute(
        `SELECT ic_id, ic_name, station_code, is_active AS status
         FROM config_whic ORDER BY station_code, ic_name`
      ),
      pool.execute('SELECT ic_id, enroll_status, enroll_photo FROM biometric_vault').catch(()=>[[]]),
      pool.execute('SELECT ic_id, can_access_modules FROM config_whic').catch(()=>[[]])
    ]);
    const bioMap = {}, accessMap = {}, bioPhotoMap = {};
    bioRows.forEach(b => { bioMap[b.ic_id] = b.enroll_status; bioPhotoMap[b.ic_id] = b.enroll_photo; });
    accRows.forEach(a => accessMap[a.ic_id] = a.can_access_modules);
    res.json(ics.map(ic => ({
      ic_id: String(ic.ic_id), ic_name: (ic.ic_name||'').trim(),
      station_code: (ic.station_code||'').trim(),
      is_active: ic.status ? 1 : 0,
      has_face: bioMap[String(ic.ic_id)] ? 1 : 0,
      enroll_status: bioMap[String(ic.ic_id)] || 'NONE',
      enroll_photo: bioPhotoMap[String(ic.ic_id)] || null,
      can_access_modules: accessMap[String(ic.ic_id)] || 0
    })));
  } catch(e) { res.status(500).json({error:e.message}); }
})

app.post('/api/enroll-face', async (req, res) => {
  const {icId, descriptor, station, machineId, photo} = req.body;
  try {
    // Get IC name: config_whic first (most reliable), fallback to legacy users
    let icName = '';
    const [wicRow] = await pool.execute('SELECT ic_name FROM config_whic WHERE ic_id=?', [icId]).catch(()=>[[]]);
    if (wicRow.length && wicRow[0].ic_name) {
      icName = wicRow[0].ic_name;
    } else {
      // Fallback: look up from staff table
      const [stRow] = await pool.execute(
        `SELECT TRIM(CONCAT(fname,' ',COALESCE(NULLIF(mname,''),''),' ',lname)) AS ic_name FROM staff WHERE id=?`, [icId]
      ).catch(()=>[[]]);
      if (stRow.length) icName = stRow[0].ic_name.trim();
    }
    // Ensure IC exists in config_whic (FK requirement)
    await pool.execute(
      'INSERT IGNORE INTO config_whic (ic_id, ic_name, station_code, enrollment_status, is_active, can_access_modules) VALUES (?,?,?,\'PENDING\',1,0)',
      [icId, icName, station]
    );
    await pool.execute(
      `INSERT INTO biometric_vault (ic_id,ic_name,station_code,face_descriptor,enrolled_at,enroll_status,enroll_photo,enrolled_by_machine)
       VALUES (?,?,?,?,NOW(),'PENDING',?,?)
       ON DUPLICATE KEY UPDATE
         face_descriptor=VALUES(face_descriptor),
         enroll_photo=VALUES(enroll_photo),
         ic_name=VALUES(ic_name),
         enrolled_at=NOW(),
         enroll_status='PENDING',
         enrolled_by_machine=VALUES(enrolled_by_machine)`,
      [icId, icName, station, descriptor, photo||null, machineId||null]
    );
    res.json({success:true});
  } catch(e) { console.error('enroll-face error:', e.message, e.stack); res.status(500).json({error: e.message, detail: e.code}); }
});

app.get('/api/face/:icId', async (req, res) => {
  try {
    const [r] = await pool.execute('SELECT face_descriptor FROM biometric_vault WHERE ic_id=?', [req.params.icId]);
    if (r.length) res.json({found:true, descriptor:r[0].face_descriptor});
    else res.json({found:false});
  } catch(e) { res.status(500).json({error:'Failed'}); }
});

app.post('/api/user-deregister', async (req, res) => {
  try { await pool.execute('DELETE FROM biometric_vault WHERE ic_id=?', [req.body.icId]); res.json({success:true}); }
  catch(e) { res.status(500).json({error:'Failed'}); }
});

// -------------------------------------------------------
//  SHIFT / BIOMETRIC ATTENDANCE
// -------------------------------------------------------

app.get('/api/shift-status/:icId', async (req, res) => {
  try {
    const open = await getOpenShift(req.params.icId);
    if (open) res.json({status:'CLOCKED_IN', since:open.created_at, durationMins:Math.round((Date.now()-new Date(open.created_at))/60000), logId:open.id});
    else res.json({status:'CLOCKED_OUT'});
  } catch(e) { res.status(500).json({error:'Failed'}); }
});

app.post('/api/punch', async (req, res) => {
  const {icId, icName, station, machineId} = req.body;
  try {
    const open = await getOpenShift(icId);
    if (!open) {
      const [result] = await pool.execute(
        `INSERT INTO log_attendance_wh (ic_id,station_code,machine_id,punch_type,status) VALUES (?,?,?,'CLOCK_IN','CLOCK_IN')`,
        [icId, station, machineId]
      );
      res.json({action:'CLOCK_IN', logId:result.insertId, time:new Date()});
    } else {
      const {durMins} = await closeShift(icId, icName, station, machineId, open, 'CLOCK_OUT', new Date());
      res.json({action:'CLOCK_OUT', durationMins:durMins, time:new Date()});
    }
  } catch(e) { console.error(e); res.status(500).json({error:'Punch failed'}); }
});

app.get('/api/logs', async (req, res) => {
  try {
    const {station, date} = req.query;
    let sql = 'SELECT l.ic_id,w.ic_name,l.station_code,l.machine_id,l.punch_type,l.status,l.`timestamp` AS created_at FROM log_attendance_wh l LEFT JOIN config_whic w ON w.ic_id=l.ic_id';
    const p=[], wh=[];
    if (station){wh.push('l.station_code=?');p.push(station);}
    if (date){wh.push('DATE(l.`timestamp`)=?');p.push(date);}
    if (wh.length) sql+=' WHERE '+wh.join(' AND ');
    sql+=' ORDER BY l.id DESC LIMIT 200';
    const [r] = await pool.execute(sql, p);
    res.json(r);
  } catch(e) { res.status(500).json({error:'Failed'}); }
});

// -------------------------------------------------------
//  VIOLATIONS
// -------------------------------------------------------

app.get('/api/violations', requireAdminAuth, addCMStations, async (req, res) => {
  try {
    const {month, station, resolved} = req.query;
    let sql = 'SELECT * FROM attendance_violations';
    const p=[], wh=[];
    if (month){wh.push('month_year=?');p.push(month);}
    if (station){wh.push('station_code=?');p.push(station);}
    if (resolved!==undefined){wh.push('resolved=?');p.push(resolved==='true'?1:0);}
    // CM station scoping
    const {clause: cmC, params: cmP} = cmStationClause(req, 'station_code');
    if (cmC) { wh.push('station_code IN (' + cmP.map(()=>'?').join(',') + ')'); p.push(...cmP); }
    if (wh.length) sql+=' WHERE '+wh.join(' AND ');
    sql+=' ORDER BY violation_date DESC LIMIT 500';
    const [r] = await pool.execute(sql, p);
    res.json(r);
  } catch(e) { res.status(500).json({error:'Failed'}); }
});

app.post('/api/violations/resolve', async (req, res) => {
  const {id, resolvedBy} = req.body;
  try {
    await pool.execute('UPDATE attendance_violations SET resolved=1,resolved_by=?,resolved_at=NOW() WHERE id=?', [resolvedBy||'Admin', id]);
    res.json({success:true});
  } catch(e) { res.status(500).json({error:'Failed'}); }
});

// Midnight cron
app.post('/api/midnight-close', async (req, res) => {
  if (req.headers['x-cron-secret'] !== 'sl-midnight-2026') return res.status(403).json({error:'Forbidden'});
  try {
    const [open] = await pool.execute(
      'SELECT l.id,l.ic_id,l.station_code,l.machine_id,l.`timestamp` AS created_at,w.ic_name FROM log_attendance_wh l LEFT JOIN config_whic w ON w.ic_id=l.ic_id WHERE l.punch_type=\'CLOCK_IN\' AND l.id NOT IN ( SELECT COALESCE(shift_id,0) FROM log_attendance_wh WHERE punch_type IN (\'CLOCK_OUT\',\'SYSTEM_LOGOUT\') AND shift_id IS NOT NULL )'
    );
    const ct = new Date(); ct.setHours(23,59,0,0);
    for (const row of open) {
      await closeShift(row.ic_id, row.ic_name||'', row.station_code, row.machine_id||'SYSTEM',
        {id:row.id, created_at:row.created_at}, 'SYSTEM_LOGOUT', ct);
    }
    res.json({success:true, closedShifts:open.length});
  } catch(e) { res.status(500).json({error:'Failed'}); }
});

// -------------------------------------------------------
//  PERIOD & MODULE DATA (Station-facing)
// -------------------------------------------------------

// Master data load for a station (mirrors getAmxDataFromServer)
app.get('/api/station-data/:station', async (req, res) => {
  try {
    const station = req.params.station;
    const period  = await getActivePeriod();
    const pl      = period.period_label;

    // Lock status for all 4 modules
    const [locks] = await pool.execute(
      "SELECT module, status FROM config_status WHERE station_code=? AND period_label=?",
      [station, pl]
    );
    const lockMap = {KMS:false, ATT:false, ADV:false, DEB:false};
    locks.forEach(l => { if (l.status==='SUBMITTED') lockMap[l.module]=true; });

    // Staff list
    const [ics] = await pool.execute(
      'SELECT ic_id, ic_name FROM config_whic WHERE station_code=? ORDER BY ic_name', [station]
    );

    // EDSP / AMX data — query by active cycle_id (period_label is not written by upload)
    const [cycRows] = await pool.execute('SELECT id FROM edsp_cycles WHERE is_active=1 LIMIT 1');
    const activeCycleId = cycRows.length ? cycRows[0].id : null;
    const [edsp] = await pool.execute(
      activeCycleId
        ? 'SELECT * FROM edsp_data WHERE station_code=? AND cycle_id=? ORDER BY delivery_date, amx_id'
        : 'SELECT * FROM edsp_data WHERE station_code=? ORDER BY delivery_date, amx_id',
      activeCycleId ? [station, activeCycleId] : [station]
    );

    // Group EDSP rows by amx_id + date (multiple parcel types per AMX/date)
    const groups = {};
    edsp.forEach(r => {
      const key = `${r.amx_id}_${r.delivery_date}`;
      if (!groups[key]) groups[key] = {amxId:r.amx_id, date:r.delivery_date, groupKey:key, children:[]};
      groups[key].children.push({pType:r.parcel_type, delivered:r.delivered, pickup:r.pickup, swa:r.swa, smd:r.smd, mfn:r.mfn, returns:r.returns, edspId:r.id});
    });

    // If KMS locked, get submitted log
    let kmsLog = [];
    if (lockMap.KMS) {
      const [kl] = await pool.execute('SELECT amx_id,ic_name,delivery_date,kms FROM log_amx WHERE station_code=? AND period_label=?', [station, pl]);
      kmsLog = kl;
    }

    // Biometric attendance for this period (days per IC)
    const [attRows] = await pool.execute(
      `SELECT ic_id, COUNT(DISTINCT DATE(clock_in)) AS bio_days
       FROM attendance_shifts WHERE station_code=? AND clock_in>=? AND clock_in<=?
       GROUP BY ic_id`,
      [station, period.period_start, period.period_end]
    );
    const bioMap = {};
    attRows.forEach(r => bioMap[r.ic_id] = r.bio_days);

    // If ATT locked, get submitted log
    let attLog = [];
    if (lockMap.ATT) {
      const [al] = await pool.execute('SELECT ic_id, ic_name, COUNT(DISTINCT DATE(`timestamp`)) AS days_submitted FROM log_attendance_wh l JOIN config_period p ON DATE(l.`timestamp`) BETWEEN p.period_start AND p.period_end WHERE l.station_code=? AND p.period_label=? AND l.punch_type=\'CLOCK_IN\' GROUP BY l.ic_id,l.ic_name', [station, pl]);
      attLog = al;
    }

    // Always load advances for current period (not just when locked)
    let advLog = [];
    {
      const [adl] = await pool.execute(
        'SELECT ic_id,ic_name,amount,reason,verified_by,submitted_at FROM log_advances WHERE station_code=? AND period_label=? ORDER BY submitted_at DESC',
        [station, pl]
      );
      advLog = adl;
    }

    // Debit items for WH — only published (not draft/answered/sent_back)
    const [debitItems] = await pool.execute(
      "SELECT * FROM debit_data WHERE station_code=? AND status='published' ORDER BY debit_date,tid",
      [station]
    );

    const periodDays = Math.round((new Date(period.period_end) - new Date(period.period_start)) / 86400000) + 1;

    res.json({
      period: { label: pl, start: period.period_start, end: period.period_end, days: periodDays },
      locks: lockMap,
      ics,
      groups: Object.values(groups),
      bioMap,
      kmsLog, attLog, advLog,
      debit: debitItems
    });
  } catch(e) { console.error(e); res.status(500).json({error:'Failed to load station data'}); }
});

// -- KMS Submit ---------------------------------------
app.post('/api/submit-kms', async (req, res) => {
  const {station, periodLabel, rows} = req.body;
  if (await isLocked(station, 'KMS', periodLabel)) return res.status(409).json({error:'Already submitted'});
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const r of rows) {
      await conn.execute(
        `INSERT INTO log_amx (station_code,amx_id,ic_id,ic_name,delivery_date,period_label,kms,parcel_type,delivered,pickup,swa,smd,mfn,returns) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [station, r.amxId, r.icId, r.icName, r.date, periodLabel, r.kms||0, r.pType, r.delivered||0, r.pickup||0, r.swa||0, r.smd||0, r.mfn||0, r.returns||0]
      );
    }
    await lockModule(station, 'KMS', periodLabel);
    await conn.commit();
    res.json({success:true});
  } catch(e) { await conn.rollback(); res.status(500).json({error:'Failed'}); }
  finally { conn.release(); }
});

// -- ATT Submit ---------------------------------------
app.post('/api/submit-att', async (req, res) => {
  const {station, periodLabel, rows} = req.body;
  if (await isLocked(station, 'ATT', periodLabel)) return res.status(409).json({error:'Already submitted'});
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const r of rows) {
      await conn.execute(
        `SELECT 1` /* attendance period recorded via log_attendance_wh */,
        []
      );
    }
    await lockModule(station, 'ATT', periodLabel);
    await conn.commit();
    res.json({success:true});
  } catch(e) { await conn.rollback(); res.status(500).json({error:'Failed'}); }
  finally { conn.release(); }
});

// -- ADV Submit ---------------------------------------
app.post('/api/submit-adv', async (req, res) => {
  const {station, periodLabel, rows, verifiedBy} = req.body;
  const eligible = (rows||[]).filter(r => r.amount && parseFloat(r.amount) > 0);
  if (!eligible.length) return res.status(400).json({error:'No advances with an amount.'});

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const inserted = [], skipped = [];
    for (const r of eligible) {
      // Check if this IC already has an advance this period for this station
      const [existing] = await conn.execute(
        `SELECT id FROM log_advances WHERE station_code=? AND ic_id=? AND period_label=? LIMIT 1`,
        [station, r.icId, periodLabel]
      );
      if (existing.length) {
        skipped.push(r.icName);
        continue;
      }
      await conn.execute(
        `INSERT INTO log_advances (station_code,ic_id,ic_name,period_label,amount,reason,verified_by) VALUES (?,?,?,?,?,?,?)`,
        [station, r.icId, r.icName, periodLabel, r.amount, r.reason||'', verifiedBy||null]
      );
      inserted.push(r.icName);
    }
    await conn.commit();
    res.json({success:true, inserted: inserted.length, insertedIds: inserted, skipped});
  } catch(e) { await conn.rollback(); res.status(500).json({error:'Failed'}); }
  finally { conn.release(); }
});

// -- DEB Submit ---------------------------------------
app.post('/api/submit-deb', async (req, res) => {
  const {station, periodLabel, rows, verifiedBy} = req.body;
  console.log('[submit-deb] received', rows?.length, 'rows from', station);
  // Filter to only rows that have a response filled in — New rows are categorised separately
  const filled = (rows||[]).filter(r => {
    if (r.subType === 'New') return false;
    // Final Loss: needs decision; Recovery/Case Open: needs any field filled
    if (r.subType === 'Final Loss') return !!r.decision;
    // For Recovery and Case Open check all possible fields
    return !!(r.decision||r.dispute||r.tt||r.orphan||r.remarks);
  });
  console.log('[submit-deb] filtered to', filled.length, 'filled rows:', filled.map(r=>r.tid+'/'+r.subType));
  if (!filled.length) return res.status(400).json({error:'No completed responses to submit'});

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const r of filled) {
      if (r.subType === 'Final Loss') {
        // Final Loss: decision = Yes/No only
        await conn.execute(
          `INSERT INTO debit_responses
             (station_code,tid,sub_type,decision,remarks,submitted_by,period_label,verified_by)
           VALUES (?,?,?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE
             decision=VALUES(decision), remarks=VALUES(remarks),
             submitted_by=VALUES(submitted_by), submitted_at=NOW(),
             verified_by=VALUES(verified_by)`,
          [station, r.tid, r.subType, r.decision||'',
           r.remarks||'', r.user||'Manager', periodLabel, verifiedBy||null]
        );
      } else if (r.subType === 'Recovery') {
        // Recovery: dedicated columns — never reuse tt_number/orphan_ref
        await conn.execute(
          `INSERT INTO debit_responses
             (station_code,tid,sub_type,recovery_type,recovery_confirm_by,recovery_ic_names,remarks,submitted_by,period_label,verified_by)
           VALUES (?,?,?,?,?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE
             recovery_type=VALUES(recovery_type),
             recovery_confirm_by=VALUES(recovery_confirm_by),
             recovery_ic_names=VALUES(recovery_ic_names),
             remarks=VALUES(remarks),
             submitted_by=VALUES(submitted_by), submitted_at=NOW(),
             verified_by=VALUES(verified_by)`,
          [station, r.tid, r.subType,
           r.decision||'', r.tt||'', r.orphan||'',
           r.remarks||'', r.user||'Manager', periodLabel, verifiedBy||null]
        );
      } else {
        // Case Open: tt_number and orphan_ref always mean TT# and Orphan/Label ID
        await conn.execute(
          `INSERT INTO debit_responses
             (station_code,tid,sub_type,decision,tt_number,orphan_ref,remarks,submitted_by,period_label,verified_by)
           VALUES (?,?,?,?,?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE
             decision=VALUES(decision), tt_number=VALUES(tt_number),
             orphan_ref=VALUES(orphan_ref), remarks=VALUES(remarks),
             submitted_by=VALUES(submitted_by), submitted_at=NOW(),
             verified_by=VALUES(verified_by)`,
          [station, r.tid, r.subType,
           r.dispute||r.decision||'', r.tt||'', r.orphan||'',
           r.remarks||'', r.user||'Manager', periodLabel, verifiedBy||null]
        );
      }
      await conn.execute(
        `UPDATE debit_data SET status='answered' WHERE tid=? AND station_code=? AND status='published'`,
        [r.tid, station]
      );
    }

    const [remaining] = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM debit_data WHERE station_code=? AND status='published'`,
      [station]
    );
    const allDone = remaining[0].cnt === 0;
    if (allDone) await lockModule(station, 'DEB', periodLabel);

    await conn.commit();
    res.json({success:true, submitted: filled.length, allDone});
  } catch(e) {
    await conn.rollback();
    res.status(500).json({error: e.message});
  } finally { conn.release(); }
});

// WH categorise: move New → Recovery/Case Open, or Recovery/Case Open → New
app.patch('/api/wh/debit-categorise', async (req, res) => {
  const {station, tid, sub_type} = req.body;
  const allowed = ['New','Recovery','Case Open'];
  if (!allowed.includes(sub_type)) return res.status(400).json({error:'Invalid category'});
  if (!station || !tid) return res.status(400).json({error:'station and tid required'});
  try {
    const [result] = await pool.execute(
      `UPDATE debit_data SET sub_type=? WHERE tid=? AND station_code=? AND status='published'`,
      [sub_type, tid, station]
    );
    if (result.affectedRows === 0) return res.status(404).json({error:'Row not found or not published'});
    res.json({success:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});



// Upload EDSP/AMX data via CSV
app.post('/api/admin/upload-edsp', upload.single('file'), async (req, res) => {
  try {
    const content = req.file.buffer.toString();
    const records = csv.parse(content, {columns:true, skip_empty_lines:true, trim:true});
    const period  = await getActivePeriod();
    let inserted = 0;
    for (const r of records) {
      await pool.execute(
        `INSERT INTO edsp_data (station_code,amx_id,delivery_date,period_label,parcel_type,delivered,pickup,swa,smd,mfn,returns)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [(r.station_code ? r.station_code.toUpperCase() : ''), r.amx_id, r.delivery_date, r.period_label||period.period_label,
         r.parcel_type||'-', parseInt(r.delivered)||0, parseInt(r.pickup)||0, parseInt(r.swa)||0,
         parseInt(r.smd)||0, parseInt(r.mfn)||0, parseInt(r.returns)||0]
      );
      inserted++;
    }
    res.json({success:true, inserted});
  } catch(e) { console.error(e); res.status(500).json({error:'Upload failed: '+e.message}); }
});

// ── Historical EDSP/KMS upload (Payroll tab) ─────────────────────────────────
app.post('/api/admin/upload-historical-edsp', async (req, res) => {
  const { rows: parsed, preview } = req.body || {};
  if (!parsed || !parsed.length) return res.status(400).json({error:'No data received'});

  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const minDate = parsed.reduce((m,r) => r.dDate < m ? r.dDate : m, parsed[0].dDate);
  const maxDate = parsed.reduce((m,r) => r.dDate > m ? r.dDate : m, parsed[0].dDate);
  // Use majority month + half detection for unified period label (e.g. feb-2026-a, feb-2026-b, feb-2026)
  const monthCount = {};
  parsed.forEach(r => {
    const ym = r.dDate.substring(0, 7);
    monthCount[ym] = (monthCount[ym] || 0) + 1;
  });
  const majorityYM = Object.entries(monthCount).sort((a,b) => b[1]-a[1])[0][0];
  const [py, pm] = majorityYM.split('-').map(Number);
  const mon = months[pm - 1];
  // Determine half from actual date range within majority month
  const [miny_d, minm_d, mind_d] = minDate.split('-').map(Number);
  const [maxy_d, maxm_d, maxd_d] = maxDate.split('-').map(Number);
  let period_label;
  if (maxd_d <= 15) period_label = `${mon}-${py}-a`;
  else if (mind_d >= 16) period_label = `${mon}-${py}-b`;
  else period_label = `${mon}-${py}`;

  // Preview mode — just return stats
  if (preview) {
    const stations = [...new Set(parsed.map(r=>r.station_code))].sort();
    const ics = new Set(parsed.map(r=>r.amx_id)).size;
    return res.json({ok:true, preview:true, rows:parsed.length, period_label,
                     date_from:minDate, date_to:maxDate, stations, ic_count:ics});
  }

  // Insert mode — respond immediately, process in background
  // LiteSpeed proxy times out long-running requests, so we ack first
  res.json({ok:true, accepted:true, rows:parsed.length, period_label});

  // Background processing
  (async () => {
    const conn = await pool.getConnection();
    try {
      await conn.execute('SET SESSION wait_timeout=600, interactive_timeout=600');
      await conn.beginTransaction();

      // Historical upload → log_amx_history only. Never touches log_amx, edsp_cycles or edsp_data.
      const CHUNK = 500;
      for (let i = 0; i < parsed.length; i += CHUNK) {
        const chunk = parsed.slice(i, i + CHUNK);
        const vals = chunk.map(r =>
          [r.station_code, r.amx_id, r.ic_id||null, r.ic_name, r.dDate, period_label,
           0, r.parcel_type, r.delivered||0, r.pickup||0, r.swa||0, r.smd||0, r.mfn||0, r.returns||0]
        );
        await conn.execute(
          `INSERT IGNORE INTO log_amx_history
             (station_code,amx_id,ic_id,ic_name,delivery_date,period_label,
              kms,parcel_type,delivered,pickup,swa,smd,mfn,returns)
           VALUES ${chunk.map(()=>'(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',')}`,
          vals.flat()
        );
      }
      await conn.commit();
      console.log(`[EDSP history] ${period_label} complete — ${parsed.length} rows`);
    } catch(e) {
      await conn.rollback();
      console.error('[EDSP upload] error:', e.message);
    } finally {
      conn.release();
    }
  })();
});

// ── List historical EDSP periods ─────────────────────────────────────────────
app.get('/api/admin/historical-edsp-periods', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT period_label,
             COUNT(*) AS total_rows,
             COUNT(DISTINCT station_code) AS stations,
             COUNT(DISTINCT amx_id) AS ics,
             ROUND(SUM(kms)) AS total_kms,
             MIN(delivery_date) AS date_from,
             MAX(delivery_date) AS date_to,
             MIN(period_from) AS period_from_override,
             MIN(period_to)   AS period_to_override
      FROM log_amx_history
      GROUP BY period_label
      ORDER BY MIN(delivery_date) DESC`);
    // Use override dates if set, else fall back to min/max delivery_date
    const result = rows.map(r => ({
      ...r,
      date_from: r.period_from_override || r.date_from,
      date_to:   r.period_to_override   || r.date_to,
      has_override: !!(r.period_from_override || r.period_to_override)
    }));
    res.json(result);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── Payroll history check ────────────────────────────────────────────────────
app.get('/api/admin/payroll-history-check', async (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({error:'month required'});
  try {
    const [r] = await pool.execute(
      'SELECT COUNT(*) AS cnt FROM payroll_history WHERE payroll_month=?', [month]
    );
    res.json({exists: r[0].cnt > 0, count: r[0].cnt});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── Payroll history upload ────────────────────────────────────────────────────
app.post('/api/admin/upload-payroll-history', async (req, res) => {
  const { rows, month, replace } = req.body || {};
  if (!rows || !rows.length) return res.status(400).json({error:'No data received'});
  if (!month) return res.status(400).json({error:'month required'});

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (replace) {
      await conn.execute('DELETE FROM payroll_history WHERE payroll_month=?', [month]);
    }
    let inserted = 0, skipped = 0;
    for (const r of rows) {
      try {
        await conn.execute(`
          INSERT INTO payroll_history
            (payroll_month, staff_id, store_name, station_code, head, name,
             associate_id, present_days, week_off, total_days,
             delivery, pickup, swa, smd, mfn, seller_returns, total_parcels,
             payment, incentive, gross_payment, debit_note, net_pay,
             advance, tds, bank_transfer, ctc, pay_type, petrol,
             parcel_count, per_parcel_cost, average, diff,
             pan_card, user_type, cluster_manager, pnl_use,
             remarks, state, tally_ledger, cost_centre)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [month, r.staff_id, r.store_name, r.station_code, r.head, r.name,
           r.associate_id, r.present_days, r.week_off, r.total_days,
           r.delivery||0, r.pickup||0, r.swa||0, r.smd||0, r.mfn||0, r.seller_returns||0, r.total_parcels||0,
           r.payment||0, r.incentive||0, r.gross_payment||0, r.debit_note||0, r.net_pay||0,
           r.advance||0, r.tds||0, r.bank_transfer||0, r.ctc, r.pay_type, r.petrol,
           r.parcel_count||0, r.per_parcel_cost, r.average, r.diff,
           r.pan_card, r.user_type, r.cluster_manager, r.pnl_use,
           r.remarks, r.state, r.tally_ledger, r.cost_centre]
        );
        inserted++;
      } catch(e) { skipped++; }
    }
    await conn.commit();
    res.json({ok:true, inserted, skipped, month});
  } catch(e) {
    await conn.rollback();
    res.status(500).json({error:e.message});
  } finally { conn.release(); }
});

// ── Payroll history months list ───────────────────────────────────────────────
app.get('/api/admin/payroll-history-months', async (req, res) => {
  try {
    const [r] = await pool.execute(`
      SELECT payroll_month, COUNT(*) AS staff_count,
             SUM(net_pay) AS total_net_pay,
             SUM(bank_transfer) AS total_bank_transfer,
             SUM(tds) AS total_tds
      FROM payroll_history
      GROUP BY payroll_month
      ORDER BY STR_TO_DATE(CONCAT('01-', payroll_month), '%d-%b-%Y') DESC`);
    res.json(r);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── Payroll history delete ───────────────────────────────────────────────────
app.delete('/api/admin/payroll-history/:month', async (req, res) => {
  const month = decodeURIComponent(req.params.month);
  if (!month) return res.status(400).json({error:'month required'});
  try {
    const [r] = await pool.execute('DELETE FROM payroll_history WHERE payroll_month=?', [month]);
    res.json({ok:true, deleted: r.affectedRows});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── Petrol expenses endpoints ────────────────────────────────────────────────
app.post('/api/admin/upload-petrol', async (req, res) => {
  const { rows, upload_date, upload_batch, filename, replace } = req.body || {};
  if (!rows || !rows.length) return res.status(400).json({error:'No data'});
  if (!upload_batch) return res.status(400).json({error:'upload_batch required'});
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (replace) await conn.execute('DELETE FROM petrol_expenses WHERE upload_batch=?', [upload_batch]);
    let inserted = 0, skipped = 0;
    for (const r of rows) {
      try {
        await conn.execute(`INSERT IGNORE INTO petrol_expenses
          (period_label,period_from,period_to,upload_batch,upload_date,filename,
           station_code,store_name,staff_id,name,associate_id,
           delivered,pickup,swa,smd,mfn,seller_return,total_parcels,total_km,per_km_rate,
           total_petrol_rs,advance_petrol,total_bank_transfer,per_parcel_cost,average,
           account_number,ifsc_code,cm,user_type,remarks,tally_ledger,cost_centre)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [r.period_label||null, r.period_from||null, r.period_to||null,
           upload_batch, upload_date||null, filename||null,
           r.station_code||null, r.store_name||null, r.staff_id||null,
           r.name||null, r.associate_id||null,
           r.delivered||0, r.pickup||0, r.swa||0, r.smd||0, r.mfn||0, r.seller_return||0,
           r.total_parcels||0, r.total_km||0, r.per_km_rate||null,
           r.total_petrol_rs||0, r.advance_petrol||0, r.total_bank_transfer||0,
           r.per_parcel_cost||null, r.average||null,
           r.account_number||null, r.ifsc_code||null, r.cm||null,
           r.user_type||null, r.remarks||null, r.tally_ledger||null, r.cost_centre||null]);
        inserted++;
      } catch(e) { skipped++; }
    }
    await conn.commit();
    res.json({ok:true, inserted, skipped, upload_batch});
  } catch(e) { await conn.rollback(); res.status(500).json({error:e.message}); }
  finally { conn.release(); }
});

app.get('/api/admin/petrol-check', async (req, res) => {
  const { batch } = req.query;
  if (!batch) return res.status(400).json({error:'batch required'});
  try {
    const [r] = await pool.execute('SELECT COUNT(*) AS cnt FROM petrol_expenses WHERE upload_batch=?', [batch]);
    res.json({exists: r[0].cnt > 0, count: r[0].cnt});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/admin/petrol-periods', async (req, res) => {
  try {
    const [r] = await pool.execute(`
      SELECT upload_batch, upload_date, filename,
             MIN(period_from) AS period_from, MAX(period_to) AS period_to,
             COUNT(*) AS staff_count,
             SUM(total_petrol_rs) AS total_petrol,
             SUM(total_bank_transfer) AS total_bank,
             SUM(total_km) AS total_km
      FROM petrol_expenses
      GROUP BY upload_batch, upload_date, filename
      ORDER BY upload_date DESC, upload_batch DESC`);
    res.json(r);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── Period update endpoints for all sections ─────────────────────────────────

// EDSP payroll month update
app.patch('/api/admin/payroll-history-period', async (req, res) => {
  const { old_month, new_month } = req.body || {};
  if (!old_month || !new_month) return res.status(400).json({error:'old_month and new_month required'});
  try {
    const [r] = await pool.execute('UPDATE payroll_history SET payroll_month=? WHERE payroll_month=?', [new_month, old_month]);
    res.json({ok:true, updated: r.affectedRows});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// DSP payroll month update
app.patch('/api/admin/dsp-payroll-period', async (req, res) => {
  const { old_month, new_month, station_code, cycle } = req.body || {};
  if (!old_month || !new_month) return res.status(400).json({error:'old_month and new_month required'});
  try {
    let sql = 'UPDATE dsp_payroll_history SET payment_month=? WHERE payment_month=?';
    const p = [new_month, old_month];
    if (station_code) { sql += ' AND station_code=?'; p.push(station_code); }
    if (cycle) { sql += ' AND cycle=?'; p.push(parseInt(cycle)); }
    const [r] = await pool.execute(sql, p);
    res.json({ok:true, updated: r.affectedRows});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// KMS/EDSP period label update
// Set period date range override for a KMS/EDSP upload period
app.patch('/api/admin/edsp-period-dates/:period', async (req, res) => {
  const period = decodeURIComponent(req.params.period);
  const { period_from, period_to } = req.body || {};
  if (!period) return res.status(400).json({error:'period required'});
  try {
    await pool.execute(
      'UPDATE log_amx_history SET period_from=?, period_to=? WHERE period_label=?',
      [period_from||null, period_to||null, period]
    );
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.patch('/api/admin/historical-edsp-period', async (req, res) => {
  const { old_period, new_period } = req.body || {};
  if (!old_period || !new_period) return res.status(400).json({error:'old_period and new_period required'});
  try {
    const [r] = await pool.execute('UPDATE log_amx_history SET period_label=? WHERE period_label=?', [new_period, old_period]);
    res.json({ok:true, updated: r.affectedRows});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Rent payment month update
app.patch('/api/admin/rent-history-period', async (req, res) => {
  const { old_month, new_month } = req.body || {};
  if (!old_month || !new_month) return res.status(400).json({error:'old_month and new_month required'});
  try {
    const [r] = await pool.execute('UPDATE rent_history SET payment_month=? WHERE payment_month=?', [new_month, old_month]);
    res.json({ok:true, updated: r.affectedRows});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Additional payments month update
app.patch('/api/admin/addl-payments-period', async (req, res) => {
  const { old_month, new_month } = req.body || {};
  if (!old_month || !new_month) return res.status(400).json({error:'old_month and new_month required'});
  try {
    const [r] = await pool.execute('UPDATE additional_payments_history SET payment_month=? WHERE payment_month=?', [new_month, old_month]);
    res.json({ok:true, updated: r.affectedRows});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Bank file date update
app.patch('/api/admin/bank-payment-period', async (req, res) => {
  const { batch, new_date } = req.body || {};
  if (!batch || !new_date) return res.status(400).json({error:'batch and new_date required'});
  try {
    const [r] = await pool.execute('UPDATE bank_payments SET file_date=? WHERE upload_batch=?', [new_date, batch]);
    res.json({ok:true, updated: r.affectedRows});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.patch('/api/admin/petrol-period/:batch', async (req, res) => {
  const { period_from, period_to } = req.body || {};
  try {
    await pool.execute(
      'UPDATE petrol_expenses SET period_from=?, period_to=? WHERE upload_batch=?',
      [period_from||null, period_to||null, req.params.batch]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/admin/petrol-detail', async (req, res) => {
  const { batch } = req.query;
  if (!batch) return res.status(400).json({error:'batch required'});
  try {
    const [r] = await pool.execute(
      'SELECT * FROM petrol_expenses WHERE upload_batch=? ORDER BY station_code, name', [batch]);
    res.json(r);
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.delete('/api/admin/petrol/:batch', async (req, res) => {
  try {
    const batch = decodeURIComponent(req.params.batch);
    let r;
    if (batch === '__null__' || batch === '--') {
      // Delete rows with null upload_batch (pre-migration rows)
      [r] = await pool.execute('DELETE FROM petrol_expenses WHERE upload_batch IS NULL');
    } else {
      [r] = await pool.execute('DELETE FROM petrol_expenses WHERE upload_batch=?', [batch]);
    }
    res.json({ok:true, deleted: r.affectedRows});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── Bank payments endpoints ──────────────────────────────────────────────────
app.post('/api/admin/upload-bank-payments', async (req, res) => {
  const { rows, file_date, batch_id } = req.body || {};
  if (!rows || !rows.length) return res.status(400).json({error:'No data'});
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let inserted = 0, skipped = 0;
    for (const r of rows) {
      try {
        await conn.execute(`INSERT IGNORE INTO bank_payments
          (payment_date,file_date,payment_category,pymt_prod_type,pymt_mode,debit_acc_no,
           bnf_name,bene_acc_no,bene_ifsc,amount,debit_narr,credit_narr,
           mobile_num,email_id,remark,ref_no,addl_info1,addl_info2,addl_info3,addl_info4,addl_info5,upload_batch)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [r.payment_date||null, file_date||null, r.payment_category||null,
           r.pymt_prod_type||null, r.pymt_mode||null, r.debit_acc_no||null,
           r.bnf_name||null, r.bene_acc_no||null, r.bene_ifsc||null,
           r.amount||0, r.debit_narr||null, r.credit_narr||null,
           r.mobile_num||null, r.email_id||null, r.remark||null, r.ref_no||null,
           r.addl_info1||null, r.addl_info2||null, r.addl_info3||null,
           r.addl_info4||null, r.addl_info5||null, batch_id||null]);
        inserted++;
      } catch(e) { skipped++; }
    }
    await conn.commit();
    res.json({ok:true, inserted, skipped});
  } catch(e) { await conn.rollback(); res.status(500).json({error:e.message}); }
  finally { conn.release(); }
});

app.get('/api/admin/bank-payment-batches', async (req, res) => {
  try {
    const [r] = await pool.execute(`
      SELECT
        file_date, upload_batch,
        MIN(payment_date) AS min_date, MAX(payment_date) AS max_date,
        COUNT(*) AS row_count, SUM(amount) AS total_amount,
        GROUP_CONCAT(DISTINCT payment_category ORDER BY payment_category SEPARATOR ', ') AS categories
      FROM bank_payments
      GROUP BY file_date, upload_batch
      ORDER BY min_date DESC, file_date DESC`);
    res.json(r);
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/admin/bank-payment-detail', async (req, res) => {
  const { batch } = req.query;
  if (!batch) return res.status(400).json({error:'batch required'});
  try {
    const [r] = await pool.execute(
      'SELECT * FROM bank_payments WHERE upload_batch=? ORDER BY payment_date, bnf_name',
      [batch]);
    res.json(r);
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.delete('/api/admin/bank-payment-batch/:batch', async (req, res) => {
  try {
    const [r] = await pool.execute(
      'DELETE FROM bank_payments WHERE upload_batch=?', [req.params.batch]);
    res.json({ok:true, deleted: r.affectedRows});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── DSP payroll history endpoints ────────────────────────────────────────────
app.get('/api/admin/dsp-payroll-check', async (req, res) => {
  const { month, station } = req.query;
  if (!month) return res.status(400).json({error:'month required'});
  try {
    let sql = 'SELECT COUNT(*) AS cnt FROM dsp_payroll_history WHERE payment_month=?';
    const p = [month];
    if (station) { sql += ' AND station_code=?'; p.push(station); }
    const [r] = await pool.execute(sql, p);
    res.json({exists: r[0].cnt > 0, count: r[0].cnt});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/admin/upload-dsp-payroll', async (req, res) => {
  const { rows, month, station_code, cycle, replace } = req.body || {};
  if (!rows || !rows.length) return res.status(400).json({error:'No data received'});
  if (!month) return res.status(400).json({error:'month required'});
  const cycleNum = parseInt(cycle) || 1;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Replace only this station+cycle combination, preserving other cycles/stations
    if (replace && station_code) {
      await conn.execute(
        'DELETE FROM dsp_payroll_history WHERE payment_month=? AND station_code=? AND cycle=?',
        [month, station_code, cycleNum]);
    }
    let inserted = 0, skipped = 0;
    for (const r of rows) {
      try {
        await conn.execute(`INSERT IGNORE INTO dsp_payroll_history
          (payment_month,station_code,staff_id,name,vehicle_type,cycle,present_days,
           block_a,block_b,block_c,block_d,block_z,
           delivery,c_return,buy_back,total_parcels,per_parcel_rate,total_parcel_amt,
           payment,incentive,gross_payment,debit_note,net_pay,advance,tds,bank_transfer,
           pan_card,ifsc_code,account_number,tally_ledger,cost_centre,remarks)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [month, r.station_code, r.staff_id, r.name, r.vehicle_type, cycleNum,
           r.present_days||null,
           r.block_a||0, r.block_b||0, r.block_c||0, r.block_d||0, r.block_z||0,
           r.delivery||0, r.c_return||0, r.buy_back||0, r.total_parcels||0,
           r.per_parcel_rate||null, r.total_parcel_amt||0,
           r.payment||0, r.incentive||0, r.gross_payment||0, r.debit_note||0,
           r.net_pay||0, r.advance||0, r.tds||0, r.bank_transfer||0,
           r.pan_card||null, r.ifsc_code||null, r.account_number||null,
           r.tally_ledger||null, r.cost_centre||null, r.remarks||null]);
        inserted++;
      } catch(e) { skipped++; }
    }
    await conn.commit();
    res.json({ok:true, inserted, skipped, month, cycle: cycleNum});
  } catch(e) { await conn.rollback(); res.status(500).json({error:e.message}); }
  finally { conn.release(); }
});

app.get('/api/admin/dsp-payroll-months', async (req, res) => {
  try {
    const [r] = await pool.execute(`
      SELECT payment_month, station_code, cycle,
             COUNT(*) AS staff_count,
             SUM(net_pay) AS total_net_pay,
             SUM(bank_transfer) AS total_bank_transfer,
             SUM(tds) AS total_tds
      FROM dsp_payroll_history
      GROUP BY payment_month, station_code, cycle
      ORDER BY STR_TO_DATE(CONCAT('01-',payment_month),'%d-%b-%Y') DESC, station_code, cycle`);
    res.json(r);
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.delete('/api/admin/dsp-payroll/:month/:station/:cycle', async (req, res) => {
  try {
    const [r] = await pool.execute(
      'DELETE FROM dsp_payroll_history WHERE payment_month=? AND station_code=? AND cycle=?',
      [req.params.month, req.params.station, parseInt(req.params.cycle)||1]);
    res.json({ok:true, rows_deleted: r.affectedRows});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── Rent history endpoints ───────────────────────────────────────────────────
app.get('/api/admin/rent-history-check', async (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({error:'month required'});
  try {
    const [r] = await pool.execute('SELECT COUNT(*) AS cnt FROM rent_history WHERE payment_month=?', [month]);
    res.json({exists: r[0].cnt > 0, count: r[0].cnt});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/admin/upload-rent-history', async (req, res) => {
  const { rows, month, replace } = req.body || {};
  if (!rows || !rows.length) return res.status(400).json({error:'No data received'});
  if (!month) return res.status(400).json({error:'month required'});
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (replace) await conn.execute('DELETE FROM rent_history WHERE payment_month=?', [month]);
    let inserted = 0, skipped = 0;
    for (const r of rows) {
      try {
        await conn.execute(`INSERT INTO rent_history
          (payment_month,station_code,station_name,inv_number,rent_amount,gst,total_rent,
           tds,payable_amount,shop_owner_name,account_number,ifsc_code,pan_card_number,
           pan_card_name,bank_remarks,remarks,remarks2,property_type,tally_ledger,cost_centre,cm)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [month,r.station_code,r.station_name,r.inv_number,r.rent_amount,r.gst,r.total_rent,
           r.tds,r.payable_amount,r.shop_owner_name,r.account_number,r.ifsc_code,r.pan_card_number,
           r.pan_card_name,r.bank_remarks,r.remarks,r.remarks2,r.property_type,r.tally_ledger,r.cost_centre,r.cm]);
        inserted++;
      } catch(e) { skipped++; }
    }
    await conn.commit();
    res.json({ok:true, inserted, skipped, month});
  } catch(e) { await conn.rollback(); res.status(500).json({error:e.message}); }
  finally { conn.release(); }
});

app.get('/api/admin/rent-history-months', async (req, res) => {
  try {
    const [r] = await pool.execute(`
      SELECT payment_month, COUNT(*) AS station_count,
             SUM(payable_amount) AS total_payable, SUM(tds) AS total_tds
      FROM rent_history GROUP BY payment_month ORDER BY payment_month DESC`);
    res.json(r);
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.delete('/api/admin/rent-history/:month', async (req, res) => {
  try {
    const [r] = await pool.execute('DELETE FROM rent_history WHERE payment_month=?', [req.params.month]);
    res.json({ok:true, rows_deleted: r.affectedRows});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── Additional payments history endpoints ─────────────────────────────────────
app.get('/api/admin/addl-payments-check', async (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({error:'month required'});
  try {
    const [r] = await pool.execute('SELECT COUNT(*) AS cnt FROM additional_payments_history WHERE payment_month=?', [month]);
    res.json({exists: r[0].cnt > 0, count: r[0].cnt});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/admin/upload-addl-payments', async (req, res) => {
  const { rows, month, replace } = req.body || {};
  if (!rows || !rows.length) return res.status(400).json({error:'No data received'});
  if (!month) return res.status(400).json({error:'month required'});
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (replace) await conn.execute('DELETE FROM additional_payments_history WHERE payment_month=?', [month]);
    let inserted = 0, skipped = 0;
    for (const r of rows) {
      try {
        await conn.execute(`INSERT INTO additional_payments_history
          (payment_month,sr_no,payment_date,station_code,payment_head,company_name,
           employee_id,name,billing_month,inv_number,inv_taxable_amt,gst,total_inv_amt,
           tds_rate,tds,actual_amt,advance_debit,bank_transfer,pan_card,ifsc_code,
           account_number,account_name,remarks,naisad_remarks,tally_ledger,cost_centre)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [month,r.sr_no,r.payment_date,r.station_code,r.payment_head,r.company_name,
           r.employee_id,r.name,r.billing_month,r.inv_number,r.inv_taxable_amt,r.gst,r.total_inv_amt,
           r.tds_rate,r.tds,r.actual_amt,r.advance_debit,r.bank_transfer,r.pan_card,r.ifsc_code,
           r.account_number,r.account_name,r.remarks,r.naisad_remarks,r.tally_ledger,r.cost_centre]);
        inserted++;
      } catch(e) { skipped++; }
    }
    await conn.commit();
    res.json({ok:true, inserted, skipped, month});
  } catch(e) { await conn.rollback(); res.status(500).json({error:e.message}); }
  finally { conn.release(); }
});

app.get('/api/admin/addl-payments-months', async (req, res) => {
  try {
    const [r] = await pool.execute(`
      SELECT payment_month, COUNT(*) AS entry_count,
             SUM(bank_transfer) AS total_bank_transfer, SUM(tds) AS total_tds
      FROM additional_payments_history GROUP BY payment_month ORDER BY payment_month DESC`);
    res.json(r);
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.delete('/api/admin/addl-payments/:month', async (req, res) => {
  try {
    const [r] = await pool.execute('DELETE FROM additional_payments_history WHERE payment_month=?', [req.params.month]);
    res.json({ok:true, rows_deleted: r.affectedRows});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── Detail endpoints for Review modal ────────────────────────────────────────
app.get('/api/admin/payroll-history-detail', async (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({error:'month required'});
  try {
    const [r] = await pool.execute('SELECT * FROM payroll_history WHERE payroll_month=? ORDER BY station_code, name', [month]);
    res.json(r);
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/admin/dsp-payroll-detail', async (req, res) => {
  const { month, station, cycle } = req.query;
  if (!month) return res.status(400).json({error:'month required'});
  try {
    let sql = 'SELECT * FROM dsp_payroll_history WHERE payment_month=?';
    const p = [month];
    if (station) { sql += ' AND station_code=?'; p.push(station); }
    if (cycle)   { sql += ' AND cycle=?'; p.push(parseInt(cycle)); }
    sql += ' ORDER BY station_code, name';
    const [r] = await pool.execute(sql, p);
    res.json(r);
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/admin/rent-history-detail', async (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({error:'month required'});
  try {
    const [r] = await pool.execute('SELECT * FROM rent_history WHERE payment_month=? ORDER BY station_code', [month]);
    res.json(r);
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/admin/addl-payments-detail', async (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({error:'month required'});
  try {
    const [r] = await pool.execute('SELECT * FROM additional_payments_history WHERE payment_month=? ORDER BY station_code, sr_no', [month]);
    res.json(r);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── Rollup: merge -a and -b into base month label ────────────────────────────
app.post('/api/admin/edsp-rollup', async (req, res) => {
  const { month } = req.body; // e.g. "feb-2026"
  if (!month) return res.status(400).json({error:'month required'});
  const labelA = month + '-a';
  const labelB = month + '-b';
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Update log_amx
    await conn.execute('UPDATE log_amx SET period_label=? WHERE period_label IN (?,?)', [month, labelA, labelB]);
    // Update edsp_cycles labels
    await conn.execute('UPDATE edsp_cycles SET cycle_label=? WHERE cycle_label=?', [month, labelA]);
    await conn.execute('DELETE FROM edsp_cycles WHERE cycle_label=?', [labelB]);
    // Update edsp_data via cycle_id join
    const [cycA] = await conn.execute('SELECT id FROM edsp_cycles WHERE cycle_label=? LIMIT 1', [month]);
    if (cycA.length) {
      const [cycB] = await conn.execute('SELECT id FROM edsp_cycles WHERE cycle_label=? LIMIT 1', [labelB]);
      if (cycB.length) {
        await conn.execute('UPDATE edsp_data SET cycle_id=? WHERE cycle_id=?', [cycA[0].id, cycB[0].id]);
        await conn.execute('DELETE FROM edsp_cycles WHERE id=?', [cycB[0].id]);
      }
    }
    await conn.commit();
    res.json({ok:true, rolled_up_to: month});
  } catch(e) {
    await conn.rollback();
    res.status(500).json({error:e.message});
  } finally { conn.release(); }
});

// ── All periods summary ──────────────────────────────────────────────────────
app.get('/api/admin/edsp-all-periods', async (req, res) => {
  try {
    const [live] = await pool.execute(`
      SELECT period_label, 'live' AS source,
             COUNT(*) AS total_rows,
             COUNT(DISTINCT station_code) AS stations,
             COUNT(DISTINCT amx_id) AS ics,
             MIN(delivery_date) AS date_from,
             MAX(delivery_date) AS date_to,
             SUM(delivered) AS total_delivered,
             SUM(pickup) AS total_pickup
      FROM log_amx
      GROUP BY period_label
      ORDER BY MIN(delivery_date) DESC`);
    const [hist] = await pool.execute(`
      SELECT period_label, 'historical' AS source,
             COUNT(*) AS total_rows,
             COUNT(DISTINCT station_code) AS stations,
             COUNT(DISTINCT amx_id) AS ics,
             MIN(delivery_date) AS date_from,
             MAX(delivery_date) AS date_to,
             SUM(delivered) AS total_delivered,
             SUM(pickup) AS total_pickup
      FROM log_amx_history
      GROUP BY period_label
      ORDER BY MIN(delivery_date) DESC`);
    const rows = [...live, ...hist].sort((a,b) => b.date_from > a.date_from ? 1 : -1);
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── Historical EDSP detail (for review modal) ────────────────────────────────
app.get('/api/admin/historical-edsp-detail', async (req, res) => {
  const { period, station } = req.query;
  if (!period) return res.status(400).json({error:'period required'});
  let sql = `SELECT station_code, amx_id, ic_name, delivery_date, parcel_type,
                    delivered, pickup, swa, smd, mfn, returns, kms
             FROM log_amx_history WHERE period_label=?`;
  const p = [period];
  if (station) { sql += ' AND station_code=?'; p.push(station); }
  sql += ' ORDER BY station_code, delivery_date, amx_id, parcel_type';
  try {
    const [rows] = await pool.execute(sql, p);
    const stations = [...new Set(rows.map(r=>r.station_code))].sort();
    res.json({rows, stations});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── Clear historical EDSP data by period_label ────────────────────────────────
app.delete('/api/admin/historical-edsp/:period', async (req, res) => {
  const period = req.params.period;
  if (!period) return res.status(400).json({error:'period required'});
  try {
    const [la] = await pool.execute('DELETE FROM log_amx_history WHERE period_label=?', [period]);
    res.json({ok:true, rows_deleted: la.affectedRows});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Upload Debit data via CSV
app.post('/api/admin/upload-debit', upload.single('file'), async (req, res) => {
  try {
    const content = req.file.buffer.toString();
    const records = csv.parse(content, {columns:true, skip_empty_lines:true, trim:true});
    const period  = await getActivePeriod();
    let inserted = 0;
    for (const r of records) {
      await pool.execute(
        `INSERT IGNORE INTO debit_data (tid,station_code,period_label,debit_date,bucket,amount,confirm_by,sub_type)
         VALUES (?,?,?,?,?,?,?,?)`,
        [r.tid, (r.station_code ? r.station_code.toUpperCase() : ''), r.period_label||period.period_label,
         r.debit_date, r.bucket||'', parseFloat(r.amount)||0, r.confirm_by||'', r.sub_type||'Final Loss']
      );
      inserted++;
    }
    res.json({success:true, inserted});
  } catch(e) { res.status(500).json({error:'Upload failed: '+e.message}); }
});

// Period management
app.get('/api/admin/periods', async (req, res) => {
  try { const [r] = await pool.execute('SELECT * FROM config_period ORDER BY id DESC'); res.json(r); }
  catch(e) { res.status(500).json({error:'Failed'}); }
});

// Returns the most recently used period_label from config_status (has real submission data)
app.get('/api/admin/last-used-period', async (req, res) => {
  try {
    const [[r]] = await pool.execute(
      `SELECT period_label FROM config_status ORDER BY submitted_at DESC LIMIT 1`
    );
    res.json(r || null);
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/admin/set-period', async (req, res) => {
  const {start, end, label} = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('UPDATE config_period SET is_active=0');
    await conn.execute('INSERT INTO config_period (period_start,period_end,period_label,is_active) VALUES (?,?,?,1)', [start, end, label]);
    await conn.commit();
    res.json({success:true});
  } catch(e) { await conn.rollback(); res.status(500).json({error:'Failed'}); }
  finally { conn.release(); }
});

// Unlock a module for a station
app.post('/api/admin/unlock-module', async (req, res) => {
  const {station, module: mod, periodLabel, adminName} = req.body;
  try {
    await pool.execute(
      "UPDATE config_status SET status='OPEN', unlocked_by=?, unlocked_at=NOW() WHERE station_code=? AND module=? AND period_label=?",
      [adminName||'Admin', station, mod, periodLabel]
    );
    res.json({success:true});
  } catch(e) { res.status(500).json({error:'Failed'}); }
});

// Admin reports
app.get('/api/admin/kms-report', requireAdminAuth, addCMStations, async (req, res) => {
  const {period} = req.query;
  try {
    const {clause, params} = cmStationClause(req, 'station_code');
    const [r] = await pool.execute('SELECT * FROM log_amx WHERE period_label=?' + clause + ' ORDER BY station_code,amx_id', [period, ...params]);
    res.json(r);
  } catch(e) { res.status(500).json({error:'Failed'}); }
});

app.get('/api/admin/att-report', requireAdminAuth, addCMStations, async (req, res) => {
  const {period} = req.query;
  try {
    const {clause, params} = cmStationClause(req, 'l.station_code');
    const [r] = await pool.execute('SELECT l.station_code, l.ic_id, l.ic_name, p.period_label, COUNT(DISTINCT DATE(l.`timestamp`)) AS days_submitted FROM log_attendance_wh l JOIN config_period p ON DATE(l.`timestamp`) BETWEEN p.period_start AND p.period_end WHERE p.period_label=? AND l.punch_type=\'CLOCK_IN\'' + clause + ' GROUP BY l.station_code,l.ic_id,l.ic_name,p.period_label ORDER BY l.station_code,l.ic_name', [period, ...params]);
    res.json(r);
  } catch(e) { res.status(500).json({error:'Failed'}); }
});

app.get('/api/admin/adv-report', requireAdminAuth, addCMStations, async (req, res) => {
  const {period} = req.query;
  try {
    const {clause, params} = cmStationClause(req, 'station_code');
    const [r] = await pool.execute('SELECT * FROM log_advances WHERE period_label=?' + clause + ' ORDER BY station_code,ic_name', [period, ...params]);
    res.json(r);
  } catch(e) { res.status(500).json({error:'Failed'}); }
});

app.get('/api/admin/deb-report', requireAdminAuth, addCMStations, async (req, res) => {
  const {month, station} = req.query;
  try {
    let sql = `SELECT d.tid, d.station_code, d.debit_date, d.bucket, d.loss_sub_bucket,
                      d.shipment_type, d.ic_name, d.amount, d.confirm_by,
                      d.cash_recovery_type, d.cm_confirm, d.publish_month,
                      d.cluster, d.recovery_month,
                      r.decision, r.tt_number, r.orphan_ref,
                      r.recovery_type, r.recovery_confirm_by, r.recovery_ic_names,
                      r.remarks, r.submitted_at, r.sub_type, r.verified_by
               FROM debit_data d
               JOIN debit_responses r ON r.tid = d.tid AND r.station_code = d.station_code
               WHERE 1=1`;
    const params = [];
    if (month)   { sql += ' AND d.publish_month=?';   params.push(month); }
    if (station) { sql += ' AND d.station_code=?';    params.push(station); }
    const {clause: cmClause, params: cmParams} = cmStationClause(req, 'd.station_code');
    if (cmClause) { sql += cmClause; params.push(...cmParams); }
    sql += ' ORDER BY d.station_code, d.tid';
    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch(e) { res.status(500).json({error: e.message}); }
});

// Return distinct publish_months that have answered entries (for admin filter dropdown)
app.get('/api/admin/deb-months', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT DISTINCT d.publish_month
       FROM debit_data d
       JOIN debit_responses r ON r.tid=d.tid AND r.station_code=d.station_code
       WHERE d.publish_month IS NOT NULL
       ORDER BY d.publish_month DESC LIMIT 24`
    );
    res.json(rows.map(r => r.publish_month));
  } catch(e) { res.status(500).json({error: e.message}); }
});

app.get('/api/admin/submission-status', requireAdminAuth, addCMStations, async (req, res) => {
  const {period} = req.query;
  try {
    // Primary: get stations from legacy stores table
    let stationCodes = [];
    try {
      const {clause, params} = cmStationClause(req, 'station_code');
      const [rows] = await pool.execute(
        `SELECT station_code FROM stations WHERE is_delete=0 AND status=0 AND station_code!=''` + clause + ` ORDER BY station_code`,
        params
      );
      stationCodes = rows.map(r => r.station_code).filter(Boolean);
    } catch(e) {}

    // Fallback: if no stations from legacy, use stations that have edsp_data for active cycle
    if (!stationCodes.length) {
      const [cycRows] = await pool.execute('SELECT id FROM edsp_cycles WHERE is_active=1 LIMIT 1');
      if (cycRows.length) {
        const [edspRows] = await pool.execute(
          'SELECT DISTINCT station_code FROM edsp_data WHERE cycle_id=? ORDER BY station_code',
          [cycRows[0].id]
        );
        stationCodes = edspRows.map(r => r.station_code);
      }
    }

    const [statuses] = await pool.execute("SELECT * FROM config_status WHERE period_label=?", [period]);
    const map = {};
    statuses.forEach(s => {
      if (!map[s.station_code]) map[s.station_code] = {};
      map[s.station_code][s.module] = s.status;
    });
    res.json(stationCodes.map(sc => ({
      station: sc,
      KMS:  (map[sc] && map[sc].KMS)  || 'OPEN',
      ATT:  (map[sc] && map[sc].ATT)  || 'OPEN',
      ADV:  (map[sc] && map[sc].ADV)  || 'OPEN',
      DEB:  (map[sc] && map[sc].DEB)  || 'OPEN'
    })));
  } catch(e) { res.status(500).json({error:'Failed'}); }
});


function isoWeekLabel(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  const week = Math.ceil((((d - new Date(Date.UTC(year,0,1))) / 86400000) + 1) / 7);
  return `${year}-W${String(week).padStart(2,'0')}`;
}


app.post('/api/admin/advance-decision', async (req, res) => {
  const {id, status, decidedBy, note} = req.body;
  if (!id||!status) return res.status(400).json({error:'Missing fields'});
  try {
    await pool.execute('UPDATE advance_requests SET status=?,decided_by=?,decided_at=NOW(),decision_note=? WHERE id=?', [status, decidedBy||'Admin', note||'', id]);
    res.json({success:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/admin/advance-requests', async (req, res) => {
  const {status, station} = req.query;
  let sql = 'SELECT * FROM advance_requests WHERE 1=1';
  const p = [];
  if (status)  { sql += ' AND status=?';       p.push(status); }
  if (station) { sql += ' AND station_code=?'; p.push(station); }
  sql += ' ORDER BY requested_at DESC';
  try { const [r] = await pool.execute(sql, p); res.json(r); }
  catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/admin/attendance-overview', async (req, res) => {
  try {
    // Default to IST date (UTC+5:30) if not provided
  const date = req.query.date || nowIST().split(' ')[0];
    const period = await getActivePeriod();
    // Inline CM scoping — check session cookie directly
    var cmStations = null;
    try {
      const raw = req.cookies && req.cookies.adm_session;
      if (raw) {
        const hash = crypto.createHash('sha256').update(raw).digest('hex');
        const [srows] = await pool.execute(
          `SELECT u.role, u.cm_staff_id FROM admin_sessions s
           JOIN admin_users u ON s.user_id=u.id
           WHERE s.token_hash=? AND s.revoked=0 AND s.expires_at>NOW() AND u.is_active=1 LIMIT 1`,
          [hash]
        );
        if (srows.length && srows[0].role === 'cluster_manager' && srows[0].cm_staff_id) {
          const [stRows] = await pool.execute(
            'SELECT station_code FROM stations WHERE primary_cluster_manager=? AND is_delete=0 AND status=0',
            [srows[0].cm_staff_id]
          );
          cmStations = stRows.map(function(r){ return r.station_code; });
        }
      }
    } catch(e2) { console.error('[CM scope]', e2.message); }
    const stationFilter = (cmStations && cmStations.length)
      ? 'AND station_code IN (' + cmStations.map(function(){ return '?'; }).join(',') + ')'
      : '';
    const stationParams = (cmStations && cmStations.length) ? cmStations : [];
    const SC = "REPLACE(REPLACE(s.station_code,CHAR(13),''),CHAR(10),'')";
    const [[staffRows], [clockIns], [openShifts]] = await Promise.all([
      pool.execute(
        `SELECT ic_id, ic_name, station_code FROM config_whic WHERE is_active=1 ${stationFilter}`,
        stationParams
      ),
      // Who punched in on this date
      pool.execute(
        'SELECT ic_id, MIN(`timestamp`) AS first_in, SUM(CASE WHEN punch_type=\'CLOCK_IN\' THEN 1 ELSE 0 END) AS has_clock_in, SUM(CASE WHEN punch_type=\'SYSTEM_LOGOUT\' THEN 1 ELSE 0 END) AS has_system FROM log_attendance_wh WHERE DATE(`timestamp`)=? AND punch_type IN (\'CLOCK_IN\',\'SYSTEM_LOGOUT\') GROUP BY ic_id', [date]
      ),
      // Who is currently clocked in (open shift)
      pool.execute(
        'SELECT l.ic_id, TIMESTAMPDIFF(MINUTE, l.`timestamp`, NOW()) AS mins FROM log_attendance_wh l LEFT JOIN log_attendance_wh co ON co.shift_id=l.id AND co.punch_type IN (\'CLOCK_OUT\',\'SYSTEM_LOGOUT\') WHERE l.punch_type=\'CLOCK_IN\' AND co.id IS NULL'
      )
    ]);
    // Build maps
    const clockMap = {}, openMap = {};
    clockIns.forEach(r => clockMap[String(r.ic_id)] = r);
    openShifts.forEach(r => openMap[String(r.ic_id)] = r.mins);
    // Group by station
    const stationMap = {};
    staffRows.forEach(ic => {
      const st = (ic.station_code||'').trim();
      if (!st) return;
      if (!stationMap[st]) stationMap[st] = { station:st, ics:[] };
      const key = String(ic.ic_id);
      const ci = clockMap[key];
      const clocked_in = openMap[key] !== undefined;
      const present = !!ci;
      stationMap[st].ics.push({
        ic_id: key, ic_name: (ic.ic_name||'').trim(),
        present, clocked_in,
        first_in: ci ? ci.first_in : null,
        total_mins: clocked_in ? openMap[key] : null,
        has_system: ci ? ci.has_system > 0 : false
      });
    });
    const stations = Object.values(stationMap).map(s => ({
      ...s,
      present: s.ics.filter(i=>i.present).length,
      absent:  s.ics.filter(i=>!i.present).length,
      total:   s.ics.length
    })).sort((a,b)=>a.station.localeCompare(b.station));
    res.json({period, stations});
  } catch(e) { console.error('att-overview:', e.message); res.status(500).json({error:e.message}); }
});

app.get('/api/admin/attendance-report', async (req, res) => {
  const {station, month} = req.query;
  try {
    let sql = 'SELECT l.station_code, l.ic_id, l.ic_name, COUNT(DISTINCT DATE(l.`timestamp`)) AS days_worked FROM log_attendance_wh l WHERE l.punch_type=\'CLOCK_IN\'';
    const p = [];
    if (station) { sql += ' AND l.station_code=?'; p.push(station); }
    if (month)   { sql += ' AND DATE_FORMAT(l.`timestamp`,\"%Y-%m\")=?'; p.push(month); }
    sql += ' GROUP BY l.station_code, l.ic_id, l.ic_name ORDER BY l.station_code, l.ic_name';
    const [r] = await pool.execute(sql, p);
    res.json(r);
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/admin/copy-edsp-to-active', async (req, res) => {
  const {cycleId} = req.body;
  try {
    await pool.execute('UPDATE edsp_cycles SET is_active=0');
    await pool.execute('UPDATE edsp_cycles SET is_active=1 WHERE id=?', [cycleId]);
    res.json({success:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.patch('/api/admin/debit-data/:id/subtype', async (req, res) => {
  const {sub_type} = req.body;
  const allowed = ['Final Loss','New'];
  if (!allowed.includes(sub_type)) return res.status(400).json({error:'Invalid sub_type — must be Final Loss or New'});
  try {
    await pool.execute(
      `UPDATE debit_data SET sub_type=? WHERE id=? AND status='draft'`,
      [sub_type, req.params.id]
    );
    res.json({success:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── PATCH full draft edit ──────────────────────────────────
app.patch('/api/admin/debit-data/:id', async (req, res) => {
  const id = req.params.id;
  const {impact_date, loss_bucket, loss_sub_bucket, shipment_type, cluster,
         ic_name, value, confirm_by, cash_recovery_type, cm_confirm,
         sub_type, remarks, recovery_month, status} = req.body;
  const allowedStatus = ['draft','published'];
  if (status && !allowedStatus.includes(status)) return res.status(400).json({error:'Invalid status'});
  function toYMD(s){ if(!s) return null; if(s.includes('/')) { const p=s.split('/'); if(p.length===3&&p[2].length===4) return p[2]+'-'+p[0].padStart(2,'0')+'-'+p[1].padStart(2,'0'); } const p=s.split('-'); if(p.length!==3) return s; if(p[0].length===4) return s; return p[2]+'-'+p[1].padStart(2,'0')+'-'+p[0].padStart(2,'0'); }
  try {
    await pool.execute(
      `UPDATE debit_data SET
         debit_date=?, bucket=?, loss_sub_bucket=?, shipment_type=?,
         cluster=?, ic_name=?, amount=?, confirm_by=?,
         cash_recovery_type=?, cm_confirm=?, sub_type=?, remarks=?,
         recovery_month=?, status=COALESCE(?,status)
       WHERE id=? AND status IN ('draft','published')`,
      [toYMD(impact_date)||null, loss_bucket||'', loss_sub_bucket||null,
       shipment_type||null, cluster||null, ic_name||null,
       parseFloat(value)||0, confirm_by||'', cash_recovery_type||null,
       cm_confirm||null,
       (['Final Loss','New'].includes(sub_type) ? sub_type : 'New'),
       remarks||null, parseInt(recovery_month)||null,
       status||null, id]
    );
    res.json({success:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});




// ════════════════════════════════════════════════════════════════════════════

// CLUSTER MANAGER ENDPOINTS
// ════════════════════════════════════════════════════════════════════════════

// ── GET /api/admin/cluster-managers — list all CMs from staff table ───────
app.get('/api/admin/cluster-managers', requireAdminAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT
        s.id, s.fname, s.lname,
        TRIM(CONCAT(COALESCE(s.fname,''),' ',COALESCE(s.lname,''))) AS full_name,
        s.mobile, s.email, s.station_code,
        GROUP_CONCAT(DISTINCT st.station_code ORDER BY st.station_code SEPARATOR ', ') AS assigned_stations,
        COUNT(DISTINCT st.station_code) AS station_count,
        u.id AS admin_user_id, u.email AS admin_email, u.role AS admin_role, u.is_active AS admin_active
      FROM staff s
      LEFT JOIN stations st ON st.primary_cluster_manager = s.id AND st.is_delete=0 AND st.status=0
      LEFT JOIN admin_users u ON (u.cm_staff_id = s.id OR (u.cm_staff_id IS NULL AND LOWER(u.email) = LOWER(s.email)))
      WHERE s.user_type = 5 AND s.status = 0 AND s.is_delete = 0
      GROUP BY s.id
      ORDER BY s.fname, s.lname
    `);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/admin/cluster-managers/:id/stations — stations for a CM ─────
app.get('/api/admin/cluster-managers/:id/stations', requireAdminAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT st.station_code, st.store_name, st.state, st.status
       FROM stations st
       WHERE st.primary_cluster_manager = ? AND st.is_delete=0
       ORDER BY st.station_code`,
      [req.params.id]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/admin/cluster-managers/:id/stations — update CM station list
app.patch('/api/admin/cluster-managers/:id/stations', requireAdminAuth, async (req, res) => {
  if (!['superadmin','ops_admin'].includes(req.adminUser.role))
    return res.status(403).json({ error: 'Not authorized' });
  const { add_stations, remove_stations } = req.body;
  const staffId = req.params.id;
  try {
    if (Array.isArray(add_stations) && add_stations.length) {
      for (const sc of add_stations) {
        await pool.execute(
          'UPDATE stations SET primary_cluster_manager=? WHERE LOWER(station_code)=LOWER(?) AND is_delete=0',
          [staffId, sc]
        );
      }
    }
    if (Array.isArray(remove_stations) && remove_stations.length) {
      for (const sc of remove_stations) {
        await pool.execute(
          'UPDATE stations SET primary_cluster_manager=NULL WHERE LOWER(station_code)=LOWER(?) AND primary_cluster_manager=?',
          [sc, staffId]
        );
      }
    }
    await writeAudit(req.adminUser.id, req.adminUser.name, 'cm_stations_update', 'staff', staffId,
      { add_stations, remove_stations }, req.ip);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/admin/auth/me — extend to include scoped stations for CM ─────
// (handled in requireAdminAuth — add station_codes to user object)

// ── Middleware: scope data to CM's stations ───────────────────────────────
async function addCMStations(req, res, next) {
  if (!req.adminUser || req.adminUser.role !== 'cluster_manager') return next();
  try {
    // Single query: get cm_staff_id from admin_users, then get their stations
    const [rows] = await pool.execute(
      `SELECT st.station_code
       FROM admin_users u
       JOIN stations st ON st.primary_cluster_manager = u.cm_staff_id
       WHERE u.id = ? AND st.is_delete = 0 AND st.status = 0`,
      [req.adminUser.id]
    );
    req.adminUser.cm_stations = rows.map(function(r){ return r.station_code; });
    console.log('[CM scope] id:', req.adminUser.id, 'stations:', req.adminUser.cm_stations);
  } catch(e) {
    console.error('[CM scope error]', e.message);
    req.adminUser.cm_stations = [];
  }
  next();
}

// ── GET /api/admin/auth/me — also return cm_stations ─────────────────────
// Patch: update requireAdminAuth to return cm_stations
// ── EXPORT ENDPOINTS ─────────────────────────────────────────────────────────

// Log an export action
async function logExport(pool, exported_by, export_type, params, row_count) {
  try {
    await pool.execute(
      'INSERT INTO export_log (exported_by,export_type,export_params,row_count) VALUES (?,?,?,?)',
      [exported_by, export_type, JSON.stringify(params), row_count]
    );
  } catch(e) { console.error('logExport:', e.message); }
}

// Export log viewer
app.get('/api/admin/export-log', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id,exported_by,export_type,export_params,row_count,exported_at FROM export_log ORDER BY exported_at DESC LIMIT 200'
    );
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// KMS / EDSP export
app.get('/api/admin/export/kms', async (req, res) => {
  const {period, exported_by} = req.query;
  if (!exported_by) return res.status(400).json({error:'exported_by required'});
  try {
    let sql = 'SELECT * FROM log_amx_history WHERE 1=1';
    const p = [];
    if (period) { sql += ' AND period_label=?'; p.push(period); }
    sql += ' ORDER BY period_label, station_code, ic_id';
    const [rows] = await pool.execute(sql, p);
    await logExport(pool, exported_by, 'kms', {period}, rows.length);
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// EDSP Payroll export
app.get('/api/admin/export/payroll', async (req, res) => {
  const {month, exported_by} = req.query;
  if (!exported_by) return res.status(400).json({error:'exported_by required'});
  try {
    let sql = 'SELECT * FROM payroll_history WHERE 1=1';
    const p = [];
    if (month) { sql += ' AND payroll_month=?'; p.push(month); }
    sql += ' ORDER BY payroll_month, station_code, ic_name';
    const [rows] = await pool.execute(sql, p);
    await logExport(pool, exported_by, 'edsp_payroll', {month}, rows.length);
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// DSP Payroll export
app.get('/api/admin/export/dsp-payroll', async (req, res) => {
  const {month, station, exported_by} = req.query;
  if (!exported_by) return res.status(400).json({error:'exported_by required'});
  try {
    let sql = 'SELECT * FROM dsp_payroll_history WHERE 1=1';
    const p = [];
    if (month)   { sql += ' AND payment_month=?'; p.push(month); }
    if (station) { sql += ' AND station_code=?'; p.push(station); }
    sql += ' ORDER BY payment_month, station_code, name';
    const [rows] = await pool.execute(sql, p);
    await logExport(pool, exported_by, 'dsp_payroll', {month, station}, rows.length);
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Petrol export
app.get('/api/admin/export/petrol', async (req, res) => {
  const {batch, exported_by} = req.query;
  if (!exported_by) return res.status(400).json({error:'exported_by required'});
  try {
    let sql = 'SELECT * FROM petrol_expenses WHERE 1=1';
    const p = [];
    if (batch) { sql += ' AND upload_batch=?'; p.push(batch); }
    sql += ' ORDER BY upload_batch, station_code, name';
    const [rows] = await pool.execute(sql, p);
    await logExport(pool, exported_by, 'petrol', {batch}, rows.length);
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Rent export
app.get('/api/admin/export/rent', async (req, res) => {
  const {month, exported_by} = req.query;
  if (!exported_by) return res.status(400).json({error:'exported_by required'});
  try {
    let sql = 'SELECT * FROM rent_history WHERE 1=1';
    const p = [];
    if (month) { sql += ' AND payment_month=?'; p.push(month); }
    sql += ' ORDER BY payment_month, station_code';
    const [rows] = await pool.execute(sql, p);
    await logExport(pool, exported_by, 'rent', {month}, rows.length);
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Additional payments export
app.get('/api/admin/export/addl', async (req, res) => {
  const {month, exported_by} = req.query;
  if (!exported_by) return res.status(400).json({error:'exported_by required'});
  try {
    let sql = 'SELECT * FROM additional_payments WHERE 1=1';
    const p = [];
    if (month) { sql += ' AND payment_month=?'; p.push(month); }
    sql += ' ORDER BY payment_month, station_code, ic_name';
    const [rows] = await pool.execute(sql, p);
    await logExport(pool, exported_by, 'addl_payments', {month}, rows.length);
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Bank payments export
app.get('/api/admin/export/bank', async (req, res) => {
  const {batch, exported_by} = req.query;
  if (!exported_by) return res.status(400).json({error:'exported_by required'});
  try {
    let sql = 'SELECT * FROM bank_payments WHERE 1=1';
    const p = [];
    if (batch) { sql += ' AND upload_batch=?'; p.push(batch); }
    sql += ' ORDER BY upload_batch, payment_date, bnf_name';
    const [rows] = await pool.execute(sql, p);
    await logExport(pool, exported_by, 'bank_payments', {batch}, rows.length);
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Amazon invoices export
app.get('/api/admin/export/invoices', async (req, res) => {
  const {station, from, to, entity, exported_by} = req.query;
  if (!exported_by) return res.status(400).json({error:'exported_by required'});
  try {
    let sql = `SELECT invoice_number,station,amazon_entity,invoice_date,period_from,period_to,
                      net_amount_due,taxable_subtotal,total_gst,total_taxable,
                      chargeback_package_loss,chargeback_cod_loss,total_chargebacks,
                      pdf_filename,uploaded_at,notes FROM invoices WHERE 1=1`;
    const p = [];
    if (station) { sql += ' AND station=?'; p.push(station); }
    if (entity)  { sql += ' AND amazon_entity=?'; p.push(entity); }
    if (from)    { sql += ' AND invoice_date>=?'; p.push(from); }
    if (to)      { sql += ' AND invoice_date<=?'; p.push(to); }
    sql += ' ORDER BY invoice_date DESC, station';
    const [rows] = await pool.execute(sql, p);
    await logExport(pool, exported_by, 'invoices', {station,from,to,entity}, rows.length);
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── INVOICE UPLOAD & PARSE ────────────────────────────────
const PDFParser = require('pdf2json');
const os = require('os');
const invoiceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20*1024*1024 } });

function parseInvoiceText(text) {
  const inv = {};
  const clean = (s) => s ? parseFloat(s.replace(/[INR₹,\s]/g,'')) || 0 : 0;

  const m1 = text.match(/Invoice Number\s*[-–]\s*(INV-\S+)/);
  inv.invoice_number = m1 ? m1[1].trim() : '';

  const m2 = text.match(/Bill to:\s*Station:\n.+?\s+([A-Z]{3,6})\n/);
  const m2b = !m2 && text.match(/Station:\s*\n([A-Z]{3,6})\b/);
  inv.station = (m2||m2b) ? (m2||m2b)[1].trim() : '';

  const m3 = text.match(/Invoice Date:\n.+?(\d{2}-\w{3}-\d{4})/);
  const m3b = !m3 && text.match(/\b(\d{2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{4})\n/);
  inv.invoice_date = (m3||m3b) ? (m3||m3b)[1].trim() : null;

  const m4 = text.match(/(\d{2}-\w{3}-\d{4})\s+to\s+(\d{2}-\w{3}-\d{4})/);
  inv.period_from = m4 ? m4[1] : null;
  inv.period_to   = m4 ? m4[2] : null;

  const parseDate = (s) => {
    if (!s) return null;
    const months = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
    const p = s.match(/(\d{2})-(\w{3})-(\d{4})/);
    if (!p) return null;
    return `${p[3]}-${String(months[p[2]]||1).padStart(2,'0')}-${p[1]}`;
  };

  inv.invoice_date_sql = parseDate(inv.invoice_date);
  inv.period_from_sql  = parseDate(inv.period_from);
  inv.period_to_sql    = parseDate(inv.period_to);

  const m5 = text.match(/NET AMOUNT DUE:\s*INR\s*([\d,]+\.?\d*)/);
  inv.net_amount_due = m5 ? clean(m5[1]) : 0;
  const m6 = text.match(/Sub Total \(Taxable Amount\)\s+INR\s+([\d,]+\.?\d*)/);
  inv.taxable_subtotal = m6 ? clean(m6[1]) : 0;
  const m7 = text.match(/Total GST - IGST 18%\s+INR\s+([\d,]+\.?\d*)/);
  inv.total_gst = m7 ? clean(m7[1]) : 0;
  const m8 = text.match(/Total Amount for Taxable Transactions\s+INR\s+([\d,]+\.?\d*)/);
  inv.total_taxable = m8 ? clean(m8[1]) : 0;

  const m9  = text.match(/ChargebackPackageLoss\s+1\s+[-–]\s+([\d,]+\.?\d*)/);
  inv.chargeback_package_loss = m9 ? clean(m9[1]) : 0;
  const m10 = text.match(/ChargebackCashOnDeliveryLoss\s+1\s+[-–]\s+([\d,]+\.?\d*)/);
  inv.chargeback_cod_loss = m10 ? clean(m10[1]) : 0;
  inv.total_chargebacks = inv.chargeback_package_loss + inv.chargeback_cod_loss;

  inv.amazon_entity = text.includes('Amazon Seller Services') ? 'ASSPL'
                    : text.includes('Amazon Transportation')   ? 'ATSPL' : '';

  const items = [];
  const rx = /^(.+?)\s+1\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+18%\s+INR\s+([\d,]+\.?\d*)$/gm;
  let mx;
  while ((mx = rx.exec(text)) !== null) {
    const desc = mx[1].trim();
    if (/^\d{2}\/\d{2}\/\d{4}/.test(desc) || desc.length > 80) continue;
    items.push({ description: desc, base_amount: clean(mx[3]), tax_amount: clean(mx[4]), net_amount: clean(mx[5]) });
  }
  inv.line_items = items;

  return inv;
}

app.post('/api/admin/invoices/upload', invoiceUpload.array('pdfs', 50), async (req, res) => {
  if (!req.files || !req.files.length) return res.status(400).json({ error: 'No files uploaded' });
  const results = [];
  for (const file of req.files) {
    try {
      // Parse PDF using pdf2json
      const pdfText = await new Promise(function(resolve, reject) {
        const parser = new PDFParser(null, 1);
        parser.on('pdfParser_dataError', function(e){ reject(new Error(e.parserError)); });
        parser.on('pdfParser_dataReady', function(){ resolve(parser.getRawTextContent()); });
        parser.parseBuffer(file.buffer);
      });
      const inv = parseInvoiceText(pdfText);
      if (!inv.invoice_number) { results.push({ file: file.originalname, error: 'Could not parse invoice number' }); continue; }
      await pool.execute(
        `INSERT INTO invoices
           (invoice_number,station,amazon_entity,invoice_date,period_from,period_to,
            net_amount_due,taxable_subtotal,total_gst,total_taxable,
            chargeback_package_loss,chargeback_cod_loss,total_chargebacks,
            line_items,pdf_filename,uploaded_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           station=VALUES(station), amazon_entity=VALUES(amazon_entity),
           invoice_date=VALUES(invoice_date), period_from=VALUES(period_from),
           period_to=VALUES(period_to), net_amount_due=VALUES(net_amount_due),
           taxable_subtotal=VALUES(taxable_subtotal), total_gst=VALUES(total_gst),
           total_taxable=VALUES(total_taxable),
           chargeback_package_loss=VALUES(chargeback_package_loss),
           chargeback_cod_loss=VALUES(chargeback_cod_loss),
           total_chargebacks=VALUES(total_chargebacks),
           line_items=VALUES(line_items), pdf_filename=VALUES(pdf_filename)`,
        [ inv.invoice_number, inv.station, inv.amazon_entity,
          inv.invoice_date_sql, inv.period_from_sql, inv.period_to_sql,
          inv.net_amount_due, inv.taxable_subtotal, inv.total_gst, inv.total_taxable,
          inv.chargeback_package_loss, inv.chargeback_cod_loss, inv.total_chargebacks,
          JSON.stringify(inv.line_items), file.originalname, req.body.uploaded_by||'Admin' ]
      );
      results.push({ file: file.originalname, invoice_number: inv.invoice_number, station: inv.station,
                     net_amount_due: inv.net_amount_due, chargebacks: inv.total_chargebacks, status: 'saved' });
    } catch(e) {
      results.push({ file: file.originalname, error: e.message });
    }
  }
  res.json({ results, saved: results.filter(r=>r.status==='saved').length, errors: results.filter(r=>r.error).length });
});

app.get('/api/admin/invoices', async (req, res) => {
  try {
    const { station, from, to, q, entity } = req.query;
    let sql = `SELECT id,invoice_number,station,amazon_entity,invoice_date,period_from,period_to,
                      net_amount_due,taxable_subtotal,total_gst,total_chargebacks,
                      chargeback_package_loss,chargeback_cod_loss,
                      pdf_filename,uploaded_at,notes
               FROM invoices WHERE 1=1`;
    const p = [];
    if (station) { sql += ' AND station=?'; p.push(station); }
    if (entity)  { sql += ' AND amazon_entity=?'; p.push(entity); }
    if (from)    { sql += ' AND invoice_date>=?'; p.push(from); }
    if (to)      { sql += ' AND invoice_date<=?'; p.push(to); }
    if (q)       { sql += ' AND (invoice_number LIKE ? OR station LIKE ?)'; p.push(`%${q}%`,`%${q}%`); }
    sql += ' ORDER BY invoice_date DESC, station LIMIT 500';
    const [rows] = await pool.execute(sql, p);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/invoices/:id/lineitems', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT line_items FROM invoices WHERE id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(JSON.parse(rows[0].line_items || '[]'));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/invoices/:id', async (req, res) => {
  try {
    await pool.execute('DELETE FROM invoices WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/invoices/:id/notes', async (req, res) => {
  try {
    await pool.execute('UPDATE invoices SET notes=? WHERE id=?', [req.body.notes||'', req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/debit-data/:id', async (req, res) => {
  try { await pool.execute('DELETE FROM debit_data WHERE id=?', [req.params.id]); res.json({success:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/admin/debit-data/single', async (req, res) => {
  const {tid, station_code, impact_date, loss_bucket, loss_sub_bucket, shipment_type,
         cluster, ic_name, value, confirm_by, cash_recovery_type, cm_confirm,
         sub_type, remarks, recovery_month} = req.body;
  if (!tid || !station_code) return res.status(400).json({error:'tid and station_code required'});
  function toYMD(s) { if(!s) return null; const p=s.trim().split('-'); if(p.length!==3) return null; if(p[0].length===4) return s; return `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`; }
  try {
    // Hard reject if TID already exists for this station
    const [existing] = await pool.execute(
      `SELECT status, bucket, sub_type FROM debit_data WHERE tid=? AND station_code=?`,
      [tid.trim(), station_code.toUpperCase().trim()]
    );
    if (existing.length > 0) {
      const ex = existing[0];
      const where = ex.bucket ? `"${ex.bucket}"` : 'the debit queue';
      return res.status(409).json({
        duplicate: true,
        error: `TID ${tid.trim()} already exists in ${where} (${ex.sub_type||'draft'} — ${ex.status})`,
        existing: ex
      });
    }

    await pool.execute(
      `INSERT INTO debit_data (tid,station_code,debit_date,bucket,loss_sub_bucket,shipment_type,
         cluster,ic_name,amount,confirm_by,cash_recovery_type,cm_confirm,sub_type,remarks,recovery_month,status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft')`,
      [tid.trim(), station_code.toUpperCase().trim(), toYMD(impact_date),
       loss_bucket||'', loss_sub_bucket||null, shipment_type||null,
       cluster||null, ic_name||null, parseFloat(value)||0,
       confirm_by||'', cash_recovery_type||null, cm_confirm||null,
       (['Final Loss','New'].includes(sub_type) ? sub_type : 'New'), remarks||null,
       parseInt(recovery_month)||null]
    );
    res.json({success:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/admin/debit-items', async (req, res) => {
  const {station, period} = req.query;
  try {
    let sql = 'SELECT * FROM debit_data WHERE 1=1';
    const p = [];
    if (station) { sql += ' AND station_code=?'; p.push(station); }
    if (period)  { sql += ' AND period_label=?'; p.push(period); }
    const [r] = await pool.execute(sql, p);
    res.json(r);
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/admin/debit-publish', async (req, res) => {
  const {ids} = req.body;
  try {
    const month = new Date().toISOString().substring(0,7);
    if (ids && ids.length) {
      // Only publish entries that are still in draft — never re-publish
      await pool.execute(
        `UPDATE debit_data SET status='published',published_at=NOW(),publish_month=?
         WHERE id IN (${ids.map(()=>'?').join(',')}) AND status='draft'`,
        [month, ...ids]
      );
    } else {
      await pool.execute(
        `UPDATE debit_data SET status='published',published_at=NOW(),publish_month=?
         WHERE status='draft'`,
        [month]
      );
    }
    res.json({success:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/admin/debit-queue', async (req, res) => {
  const {station, status} = req.query;
  try {
    let sql = `SELECT d.* FROM debit_data d WHERE 1=1`;
    const params = [];
    if (station) { sql += ' AND d.station_code=?'; params.push(station); }
    if (status)  {
      sql += ' AND d.status=?'; params.push(status);
    } else {
      // Default: only show actionable entries (draft + published + sent_back), never answered
      sql += " AND d.status IN ('draft','published','sent_back')";
    }
    sql += ' ORDER BY d.id DESC LIMIT 1000';
    const [r] = await pool.execute(sql, params);
    res.json(r);
  } catch(e) { res.status(500).json({error:e.message}); }
})

app.post('/api/admin/debit-sendback-tids', async (req, res) => {
  const {tids, station} = req.body;
  if (!tids || !tids.length || !station) return res.status(400).json({error:'tids and station required'});
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const ph = tids.map(() => '?').join(',');
    // Reset debit_data status back to published so WH sees it again
    await conn.execute(
      `UPDATE debit_data SET status='published' WHERE station_code=? AND tid IN (${ph})`,
      [station, ...tids]
    );
    // Delete the existing responses so WH can re-submit
    await conn.execute(
      `DELETE FROM debit_responses WHERE station_code=? AND tid IN (${ph})`,
      [station, ...tids]
    );
    // Also unlock the DEB module for this station if it was locked
    await conn.execute(
      `UPDATE config_status SET status='OPEN', unlocked_by='Admin-SendBack', unlocked_at=NOW()
       WHERE station_code=? AND module='DEB'`,
      [station]
    );
    await conn.commit();
    res.json({success: true});
  } catch(e) {
    await conn.rollback();
    res.status(500).json({error: e.message});
  } finally { conn.release(); }
});

app.post('/api/admin/debit-sendback', async (req, res) => {
  const {ids} = req.body;
  if (!ids||!ids.length) return res.status(400).json({error:'No ids'});
  try {
    await pool.execute(`UPDATE debit_data SET status='sent_back' WHERE id IN (${ids.map(()=>'?').join(',')})`, ids);
    res.json({success:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── UPDATE DEBIT RESPONSE (WH edit from history drawer) ─────
app.patch('/api/deb-response/:tid', async (req, res) => {
  const {tid} = req.params;
  const {station, sub_type, decision, tt_number, orphan_ref,
         recovery_type, recovery_confirm_by, recovery_ic_names, remarks} = req.body;
  if (!tid || !station) return res.status(400).json({error:'tid and station required'});
  try {
    let sql, params;
    if (sub_type === 'Recovery') {
      sql = `UPDATE debit_responses SET recovery_type=?, recovery_confirm_by=?, recovery_ic_names=?, remarks=?
             WHERE tid=? AND station_code=?`;
      params = [recovery_type||'', recovery_confirm_by||'', recovery_ic_names||'', remarks||'', tid, station.toUpperCase()];
    } else if (sub_type === 'Case Open') {
      sql = `UPDATE debit_responses SET decision=?, tt_number=?, orphan_ref=?, remarks=?
             WHERE tid=? AND station_code=?`;
      params = [decision||'', tt_number||'', orphan_ref||'', remarks||'', tid, station.toUpperCase()];
    } else {
      sql = `UPDATE debit_responses SET decision=?, remarks=?
             WHERE tid=? AND station_code=?`;
      params = [decision||'', remarks||'', tid, station.toUpperCase()];
    }
    const [r] = await pool.execute(sql, params);
    if (r.affectedRows === 0) return res.status(404).json({error:'Response not found'});
    res.json({success:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// WH debit history — answered items for this station, last 6 months, joined with responses
app.get('/api/deb-history/:station', async (req, res) => {
  const station = req.params.station;
  try {
    const [rows] = await pool.execute(
      `SELECT d.id, d.tid, d.debit_date, d.bucket, d.loss_sub_bucket, d.shipment_type,
              d.ic_name, d.amount, d.confirm_by, d.cash_recovery_type, d.cm_confirm,
              d.publish_month, d.published_at, d.sub_type, d.cluster, d.recovery_month,
              r.decision, r.tt_number, r.orphan_ref, r.remarks AS wh_remarks,
              r.recovery_type, r.recovery_confirm_by, r.recovery_ic_names,
              r.submitted_at
       FROM debit_data d
       LEFT JOIN debit_responses r ON r.tid = d.tid AND r.station_code = d.station_code
       WHERE d.station_code = ?
         AND (d.status = 'answered' OR r.submitted_at IS NOT NULL)
         AND d.published_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
       ORDER BY COALESCE(r.submitted_at, d.published_at) DESC, d.tid`,
      [station]
    );
    // Group by publish_month
    const grouped = {};
    rows.forEach(r => {
      const month = r.publish_month || (r.published_at ? String(r.published_at).substring(0,7) : 'Unknown');
      if (!grouped[month]) grouped[month] = [];
      grouped[month].push(r);
    });
    // Return as array of {month, label, items} sorted newest first
    const months = Object.keys(grouped).sort((a,b) => b.localeCompare(a));
    const result = months.map(m => {
      const [yr, mo] = m.split('-');
      const label = mo && yr ? new Date(yr, parseInt(mo)-1, 1).toLocaleDateString('en-IN',{month:'long',year:'numeric'}) : m;
      return { month: m, label, items: grouped[m] };
    });
    res.json(result);
  } catch(e) { console.error('deb-history:', e); res.status(500).json({error: e.message}); }
});

app.get('/api/admin/debit-template', (req, res) => {
  const headers  = ['TID','Impact Date','Loss Bucket','Sub Bucket','Shipment Type','Station','Cluster Manager','IC / Staff','Amount ₹','Confirm By','Recovery Type','CM Confirm','Debit Type','Remarks'];
  const example1 = ['365433739065','03-12-2025','Ageing','Shipment Not Departed','Delivery','ANDD','GJ','Rahul Sharma','1190.00','Amitbhai','IC Payment','YES','Final Loss','Confirmed by CM'];
  const example2 = ['629518827741','26-01-2026','WRTS but MDR','Wrong Photo at RTS','ReturnPickup','VDDA','GJ','Harendra Sahu','2111.00','Amitbhai','SHIP BANK','NO','New','WH to categorise as Recovery or Case Open'];
  const notes = [
    'Tracking ID (required) — numeric, or Short Cash / Penalty for non-TID entries',
    'DD-MM-YYYY format (required)',
    'Ageing / Package Loss / WRTS but MDR / SLP Mail / Penalty',
    'Sub-category free text e.g. Shipment Not Departed',
    'Delivery / ReturnPickup / MFN',
    'Station code e.g. ANDD (required)',
    'Cluster Manager name (optional — auto-filled from station on upload)',
    'IC / Staff name responsible for the loss (comma-separated for multiple)',
    'Amount in ₹ — no commas e.g. 1801.85 (required)',
    'Name of manager / AM confirming the debit note',
    'IC Payment / SHIP BANK / CASH',
    'YES or NO — CM / Manager confirmation',
    'Ignored on upload — all entries created as New by default. Mark as Final Loss individually in admin queue after upload.',
    'Any additional notes or context'
  ];
  const rows = [headers, example1, example2, notes];
  const csvOut = '\uFEFF' + rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="Debit_Note_Template.csv"');
  res.send(csvOut);
});

// ── DEBIT PARSE — returns rows as JSON for preview, no DB write ──
app.post('/api/admin/debit-parse', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({error:'No file received'});
  try {
    const content = req.file.buffer.toString('utf8').replace(/^\uFEFF/,'');
    function toYMD(s){
      if(!s) return '';
      s = s.trim();
      // M/D/YYYY or MM/DD/YYYY (new file format)
      if(s.includes('/')) {
        const p = s.split('/');
        if(p.length===3 && p[2].length===4)
          return p[2]+'-'+p[0].padStart(2,'0')+'-'+p[1].padStart(2,'0');
      }
      // DD-MM-YYYY (old file format)
      const p = s.split('-');
      if(p.length!==3) return s;
      if(p[0].length===4) return s; // already YYYY-MM-DD
      return p[2]+'-'+p[1].padStart(2,'0')+'-'+p[0].padStart(2,'0');
    }
    function normTid(s){
      if(!s) return '';
      s = s.trim();
      if(/^[0-9.]+[eE][+][0-9]+$/.test(s)){
        try{ return BigInt(Math.round(parseFloat(s))).toString(); }catch(e){ return s; }
      }
      return s;
    }
    function normAmt(s){ if(!s) return 0; return parseFloat(String(s).replace(/,/g,'')) || 0; }

    const raw = csv.parse(content, {columns:true, skip_empty_lines:true, to:500});
    const junkTids = new Set(['tid','TID','tracking id (required)','tracking id','Tracking ID']);
    const rows = raw
      .filter(r => {
        const t = normTid(r['TID']||r['tid']||'').toLowerCase();
        return t && !junkTids.has(t) && !t.startsWith('. column');
      })
      .map(r => ({
        // Accept both old display names (old file) and new internal column names (new file)
        tid:              normTid(r['TID']||r['tid']||''),
        station:          (r['Station']||r['station']||r['station_code']||'').toUpperCase().trim(),
        impact_date:      toYMD(r['Impact Date']||r['impact_date']||''),
        loss_bucket:      r['Loss Bucket']||r['loss_bucket'] || '',
        loss_sub_bucket:  r['Sub Bucket']||r['loss_sub_bucket'] || '',
        shipment_type:    r['Shipment Type']||r['shipment_type'] || '',
        cluster:          r['Cluster Manager']||r['cluster'] || r['Cluster'] || '',
        ic_name:          r['IC / Staff']||r['user_name'] || r['ic_name'] || '',
        amount:           normAmt(r['Amount ₹']||r['value'] || r['amount'] || '0'),
        confirm_by:       r['Confirm By']||r['confirm_by'] || '',
        cash_recovery_type: r['Recovery Type']||r['cash_recovery_type'] || '',
        cm_confirm:       r['CM Confirm']||r['cm_confirm'] || '',
        remarks:          r['Remarks']||r['remarks'] || '',
        recovery_month:   parseInt(r['recovery_month']||r['Recovery Month']||'') || null,
      }))
      .filter(r => r.tid && r.station);

    res.json({success:true, rows});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── DEBIT IMPORT ROWS — accepts pre-parsed (possibly edited) JSON rows ──
app.post('/api/admin/debit-import-rows', async (req, res) => {
  const {rows} = req.body;
  if (!rows||!rows.length) return res.status(400).json({error:'No rows'});

  // Pre-check: find all existing TIDs for these station codes
  const tidStationPairs = rows.filter(r=>r.tid&&r.station).map(r=>`${r.tid.trim()}::${r.station.toUpperCase().trim()}`);
  const allTids = [...new Set(rows.filter(r=>r.tid).map(r=>r.tid.trim()))];
  let existingMap = {};
  if (allTids.length) {
    const ph = allTids.map(()=>'?').join(',');
    const [exRows] = await pool.execute(
      `SELECT tid, station_code, status, bucket, sub_type FROM debit_data WHERE tid IN (${ph})`,
      allTids
    );
    exRows.forEach(e => { existingMap[`${e.tid}::${e.station_code}`] = e; });
  }

  const conn = await pool.getConnection();
  await conn.beginTransaction();
  let inserted=0;
  const duplicates=[], invalid=[];

  for (const r of rows) {
    if (!r.tid || !r.station) { invalid.push(r.tid||'(blank)'); continue; }
    const key = `${r.tid.trim()}::${r.station.toUpperCase().trim()}`;
    if (existingMap[key]) {
      const ex = existingMap[key];
      duplicates.push({
        tid: r.tid.trim(),
        info: `${ex.bucket||'unknown bucket'} — ${ex.sub_type||'draft'} (${ex.status})`
      });
      continue;
    }
    try {
      await conn.execute(
        `INSERT INTO debit_data
           (tid, station_code, debit_date, bucket, loss_sub_bucket, shipment_type,
            cluster, ic_name, amount, confirm_by, cash_recovery_type, cm_confirm,
            sub_type, remarks, recovery_month, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft')`,
        [r.tid.trim(), r.station.toUpperCase().trim(), r.impact_date||null,
         r.loss_bucket||'', r.loss_sub_bucket||null, r.shipment_type||null,
         r.cluster||null, r.ic_name||null, r.amount||0,
         r.confirm_by||'', r.cash_recovery_type||null, r.cm_confirm||null,
         'New', r.remarks||null, parseInt(r.recovery_month)||null]
      );
      inserted++;
    } catch(e2) { invalid.push(`${r.tid} (${e2.message})`); }
  }
  await conn.commit();
  conn.release();
  res.json({success:true, inserted, duplicates, invalid});
});

app.post('/api/admin/debit-upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({error:'No file received'});
  try {
    const content = req.file.buffer.toString('utf8').replace(/^\uFEFF/,''); // strip BOM

    // DD-MM-YYYY or YYYY-MM-DD → YYYY-MM-DD
    function toYMD(s){
      if(!s) return null;
      const p = s.trim().split('-');
      if(p.length!==3) return null;
      if(p[0].length===4) return s.trim();
      return `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
    }
    function normTid(s){
      if(!s) return '';
      s = s.trim();
      if(/^[0-9.]+[eE][+][0-9]+$/.test(s)){
        try{ return BigInt(Math.round(parseFloat(s))).toString(); }catch(e){ return s; }
      }
      return s;
    }
    function normAmt(s){
      if(!s) return 0;
      return parseFloat(String(s).replace(/,/g,'')) || 0;
    }

    const raw = csv.parse(content, {columns:true, skip_empty_lines:true, to:500});

    const junkTids = new Set(['tid','tracking id (required)','tracking id']);
    const rows = raw.filter(r => {
      const t = normTid(r['tid']||'').toLowerCase();
      return t && !junkTids.has(t) && !t.startsWith('. column');
    });

    const conn = await pool.getConnection();
    await conn.beginTransaction();
    let inserted=0, skipped=0, firstError=null;

    for (const r of rows) {
      const tid     = normTid(r['tid']||'');
      const station = (r['station']||r['station_code']||'').toUpperCase().trim();
      if (!tid || !station) { skipped++; continue; }

      const icName    = r['user_name']   || r['User Name']             || r['ic_name']           || null;
      const confirmBy = r['confirm_by']  || r['Debit Note Confirm by'] || r['confirm by']         || '';
      const recType   = r['cash_recovery_type'] || r['Cash Recovery Type'] || null;
      const cmConfirm = r['cm_confirm']  || r['CM Confirm']            || r['CM/Manager Confirm'] || null;
      const cluster   = r['cluster']     || r['Cluster']               || null;
      const amount    = normAmt(r['value'] || r['amount'] || '0');

      // All CSV uploads default to New — admin marks Final Loss individually via the queue
      const subType = 'New';




      try {
        await conn.execute(
          `INSERT INTO debit_data
             (tid, station_code, debit_date, bucket, loss_sub_bucket, shipment_type,
              cluster, ic_name, amount, confirm_by, cash_recovery_type, cm_confirm,
              sub_type, remarks, status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft')
           ON DUPLICATE KEY UPDATE
             debit_date=VALUES(debit_date), bucket=VALUES(bucket),
             loss_sub_bucket=VALUES(loss_sub_bucket), amount=VALUES(amount),
             cluster=VALUES(cluster), ic_name=VALUES(ic_name),
             sub_type=VALUES(sub_type)`,
          [tid, station,
           toYMD(r['impact_date']||''),
           r['loss_bucket'] || '',
           r['loss_sub_bucket'] || null,
           r['shipment_type'] || null,
           cluster, icName, amount, confirmBy, recType, cmConfirm, subType,
           r['remarks'] || r['Remarks'] || null]
        );
        inserted++;
      } catch(e2) { skipped++; firstError = firstError || `${e2.message} [tid=${tid} station=${station}]`; }
    }

    await conn.commit();
    conn.release();
    res.json({success:true, inserted, skipped, firstError});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/admin/debug-advances', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT station_code, week_label, ic_name, amount, requested_at FROM advance_requests ORDER BY requested_at DESC LIMIT 20');
    const [all] = await pool.execute('SELECT week_label, COUNT(*) as cnt FROM advance_requests GROUP BY week_label');
    res.json({recent: rows, by_week: all});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/admin/edsp-cycles', async (req, res) => {
  try { const [r] = await pool.execute('SELECT * FROM edsp_cycles ORDER BY id DESC LIMIT 50'); res.json(r); }
  catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/api/admin/edsp-cycles/check', async (req, res) => {
  try { const [r] = await pool.execute('SELECT * FROM edsp_cycles WHERE is_active=1 LIMIT 1'); res.json(r[0]||null); }
  catch(e) { res.status(500).json({error:e.message}); }
});
app.post('/api/admin/edsp-cycles/publish', async (req, res) => {
  const {cycleId} = req.body;
  try {
    await pool.execute('UPDATE edsp_cycles SET is_active=0');
    await pool.execute('UPDATE edsp_cycles SET is_active=1 WHERE id=?', [cycleId]);
    res.json({success:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/api/edsp-cycles/:station', async (req, res) => {
  try {
    const [r] = await pool.execute(
      `SELECT e.* FROM edsp_data e
       JOIN edsp_cycles c ON c.id=e.cycle_id AND c.is_active=1
       WHERE e.station_code=? ORDER BY e.delivery_date DESC`, [req.params.station]
    );
    res.json(r);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.post('/api/admin/edsp-cycles/upload', async (req, res) => {
  if (req.headers['x-cron-secret'] !== 'sl-midnight-2026') return res.status(403).json({error:'Forbidden'});
  const {filePath, cycleLabel, dateFrom, dateTo} = req.body;
  if (!filePath) return res.status(400).json({error:'Missing filePath'});
  const fs = require('fs');
  if (!fs.existsSync(filePath)) return res.status(404).json({error:'File not found'});
  try {
    const raw = csv.parse(fs.readFileSync(filePath,'utf8'), {columns:true, skip_empty_lines:true});
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    const [cyc] = await conn.execute(
      'INSERT INTO edsp_cycles (cycle_label, date_from, date_to, is_active) VALUES (?,?,?,0)',
      [cycleLabel||'Import', dateFrom||null, dateTo||null]
    );
    const cycleId = cyc.insertId;
    let inserted = 0;
    for (const r of raw) {
      const sc = (r['station_code']||r['station']||'').toUpperCase().trim();
      if (!sc) continue;
      await conn.execute(
        `INSERT INTO edsp_data (cycle_id, station_code, amx_id, delivery_date, parcel_type, delivered, pickup, swa, smd, mfn, returns)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [cycleId, sc, r['amx_id']||'', r['delivery_date']||null, r['parcel_type']||'',
         parseInt(r['delivered'])||0, parseInt(r['pickup'])||0, parseInt(r['swa'])||0,
         parseInt(r['smd'])||0, parseInt(r['mfn'])||0, parseInt(r['returns'])||0]
      );
      inserted++;
    }
    await conn.commit(); conn.release();
    res.json({success:true, inserted, cycleId});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/admin/period-attendance-overview', async (req, res) => {
  try {
    const period = await getActivePeriod();
    const [rows] = await pool.execute(
      'SELECT station_code, COUNT(DISTINCT ic_id) AS ic_count, COUNT(*) AS total_punches FROM log_attendance_wh l JOIN config_period p ON DATE(l.`timestamp`) BETWEEN p.period_start AND p.period_end WHERE p.period_label=? AND l.punch_type=\'CLOCK_IN\' GROUP BY l.station_code', [period.period_label]
    );
    res.json({period, stations: rows});
  } catch(e) { res.status(500).json({error:e.message}); }
})

app.post('/api/admin/set-user-access', async (req, res) => {
  const {icId, canAccess} = req.body;
  try {
    await pool.execute(
      `INSERT INTO config_whic (ic_id, can_access_modules) VALUES (?,?)
       ON DUPLICATE KEY UPDATE can_access_modules=VALUES(can_access_modules)`,
      [icId, canAccess ? 1 : 0]
    );
    res.json({success:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/admin/upload-file', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({error:'No file'});
  res.json({originalName: req.file.originalname, size: req.file.size});
});

app.post('/api/enroll-approve', async (req, res) => {
  const {icId} = req.body; if (!icId) return res.status(400).json({error:'Missing icId'});
  try { await pool.execute("UPDATE biometric_vault SET enroll_status='APPROVED' WHERE ic_id=?", [icId]); res.json({success:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});
app.post('/api/enroll-reject', async (req, res) => {
  const {icId} = req.body; if (!icId) return res.status(400).json({error:'Missing icId'});
  try { await pool.execute("DELETE FROM biometric_vault WHERE ic_id=? AND enroll_status='PENDING'", [icId]); res.json({success:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});
app.post('/api/reactivate-user', async (req, res) => {
  const {icId} = req.body;
  try { await pool.execute("UPDATE config_whic SET is_active=1 WHERE ic_id=?", [icId]); res.json({success:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});
app.post('/api/offboard-user', async (req, res) => {
  const {icId, reason} = req.body;
  try {
    await pool.execute("DELETE FROM biometric_vault WHERE ic_id=?", [icId]);
    await pool.execute("UPDATE config_whic SET is_active=0 WHERE ic_id=?", [icId]);
    res.json({success:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.post('/api/revoke-machine', async (req, res) => {
  const {id} = req.body;
  try {
    await pool.execute("UPDATE config_machines SET status='REVOKED', machine_token=NULL WHERE id=?", [id]);
    res.json({success:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/api/enroll-pending', requireAdminAuth, addCMStations, async (req, res) => {
  try {
    const {clause: cmCe, params: cmPe} = cmStationClause(req, 'station_code');
    const [r] = await pool.execute("SELECT * FROM biometric_vault WHERE enroll_status='PENDING'" + cmCe + " ORDER BY enrolled_at DESC", cmPe);
    res.json(r);
  }
  catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/api/period-summary/:station', async (req, res) => {
  try {
    const period = await getActivePeriod();
    const [r] = await pool.execute(
      `SELECT module, status FROM config_status WHERE station_code=? AND period_label=?`,
      [req.params.station, period.period_label]
    );
    const map = {}; r.forEach(x => map[x.module] = x.status);
    res.json({period, modules: map});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/test-flags',  (req, res) => res.json(testFlags));
app.post('/api/test-flags', (req, res) => { Object.assign(testFlags, req.body); res.json({success:true}); });


app.get('/api/admin/recent-submissions', requireAdminAuth, addCMStations, async (req, res) => {
  try {
    const {clause: cmC2, params: cmP2} = cmStationClause(req, 'station_code');
    const [r] = await pool.execute(
      `SELECT station_code, module, period_label, status, submitted_at
       FROM config_status WHERE status='SUBMITTED'` + cmC2 + `
       ORDER BY submitted_at DESC LIMIT 50`,
      cmP2
    );
    res.json(r);
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/admin/reset-submission', async (req, res) => {
  const {station, module, periodLabel} = req.body;
  if (!station||!module||!periodLabel) return res.status(400).json({error:'Missing fields'});
  try {
    await pool.execute(
      `DELETE FROM config_status WHERE station_code=? AND module=? AND period_label=?`,
      [station, module, periodLabel]
    );
    // For KMS resets also clear submitted log_amx rows so WH portal can re-enter
    if (module === 'KMS') {
      await pool.execute(
        `DELETE FROM log_amx WHERE station_code=? AND period_label=?`,
        [station, periodLabel]
      );
    }
    res.json({success:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});



// -- KMS SUMMARY (Admin) ----------------------------------
app.get('/api/admin/kms-summary', requireAdminAuth, addCMStations, async (req, res) => {
  try {
    const {cycleId} = req.query;
    if (!cycleId) return res.status(400).json({error:'cycleId required'});

    // period_label from active config_period (log_amx has no cycle_id column)
    const periodLabel = (await getActivePeriod()).period_label;

    const {clause: cmC, params: cmP} = cmStationClause(req, 'station_code');
    // Single query: total groups per station for this cycle
    const [totals] = await pool.execute(
      `SELECT station_code, COUNT(DISTINCT CONCAT(amx_id,'_',delivery_date)) AS total
       FROM edsp_data WHERE cycle_id=?` + cmC + ` GROUP BY station_code ORDER BY station_code`,
      [cycleId, ...cmP]
    );
    // Single query: submitted groups per station for this period
    const [subs] = await pool.execute(
      `SELECT station_code, COUNT(DISTINCT CONCAT(amx_id,'_',delivery_date)) AS submitted
       FROM log_amx WHERE period_label=?` + cmC + ` GROUP BY station_code`,
      [periodLabel, ...cmP]
    );
    // Single query: KMS submission status per station
    const [statuses] = await pool.execute(
      `SELECT station_code, status FROM config_status WHERE module='KMS' AND period_label=?` + cmC,
      [periodLabel, ...cmP]
    );

    const subMap = {};
    subs.forEach(r => subMap[r.station_code] = r.submitted);
    const statusMap = {};
    statuses.forEach(r => statusMap[r.station_code] = r.status);

    const result = totals.map(r => {
      const total = r.total || 0;
      const submitted = subMap[r.station_code] || 0;
      const status = statusMap[r.station_code] || (submitted > 0 ? 'PARTIAL' : 'OPEN');
      return {station_code: r.station_code, total, submitted, pending: total - submitted, status};
    });
    res.json(result);
  } catch(e) { console.error(e); res.status(500).json({error:e.message}); }
});

// --- STARTUP MIGRATIONS -----------------------------------

// -- LEGACY DATA BROWSER (read-only) ----------------------
app.get('/api/legacy/test', async (req, res) => {
  try {
    const [[s]] = await pool.execute('SELECT COUNT(*) AS c FROM stations WHERE is_delete=0').catch(()=>[[{c:0}]]);
    const [[i]] = await pool.execute('SELECT COUNT(*) AS c FROM config_whic WHERE is_active=1').catch(()=>[[{c:0}]]);
    const [[u]] = await pool.execute('SELECT COUNT(*) AS c FROM staff WHERE status=0').catch(()=>[[{c:0}]]);
    res.json({connected:true, stores:s.c, ics:i.c, users:u.c});
  } catch(e) { res.json({connected:false, error:e.message}); }
});

// ── LEGACY SYNC — copy all legacy tables into current DB with L prefix ──
app.post('/api/legacy/sync-tables', async (req, res) => {
  try {
    // Get all tables from legacy DB
    const [tables] = await legacyPool.execute('SHOW TABLES');
    const dbKey = Object.keys(tables[0])[0]; // e.g. "Tables_in_bifmein1_nship24"
    const tableNames = tables.map(t => t[dbKey]);

    const conn = await pool.getConnection();
    const results = [];

    for (const tbl of tableNames) {
      const dest = `L${tbl}`;
      try {
        // Get CREATE TABLE from legacy
        const [[ct]] = await legacyPool.execute(`SHOW CREATE TABLE \`${tbl}\``);
        let createSql = ct['Create Table'];

        // Rename table reference to L-prefixed destination
        createSql = createSql.replace(
          new RegExp(`CREATE TABLE \`${tbl}\``, 'i'),
          `CREATE TABLE IF NOT EXISTS \`${dest}\``
        );
        // Remove ENGINE/CHARSET clauses that may conflict, keep structure
        await conn.execute(createSql).catch(async () => {
          // If CREATE failed (e.g. already exists with different structure), drop and recreate
          await conn.execute(`DROP TABLE IF EXISTS \`${dest}\``);
          await conn.execute(createSql);
        });

        // Clear and re-insert all rows using chunked bulk INSERT
        await conn.execute(`TRUNCATE TABLE \`${dest}\``);
        const [rows] = await legacyPool.execute(`SELECT * FROM \`${tbl}\``);
        if (rows.length) {
          const cols    = Object.keys(rows[0]).map(c=>`\`${c}\``).join(',');
          const phRow   = '(' + Object.keys(rows[0]).map(()=>'?').join(',') + ')';
          const CHUNK   = 500;
          for (let i = 0; i < rows.length; i += CHUNK) {
            const chunk  = rows.slice(i, i + CHUNK);
            const ph     = chunk.map(()=>phRow).join(',');
            const values = chunk.flatMap(row => Object.values(row));
            await conn.execute(
              `INSERT IGNORE INTO \`${dest}\` (${cols}) VALUES ${ph}`,
              values
            ).catch(()=>{}); // skip chunk errors (e.g. FK issues)
          }
        }
        results.push({table: dest, rows: rows.length, status:'ok'});
      } catch(e) {
        results.push({table: dest, rows:0, status:'error', error: e.message});
      }
    }
    conn.release();
    res.json({success:true, synced: results.filter(r=>r.status==='ok').length, total: tableNames.length, results});
  } catch(e) { res.status(500).json({error: e.message}); }
});

// ── LEGACY ALL-TABLES — list all L-prefixed tables with row counts ──
app.get('/api/legacy/all-tables', async (req, res) => {
  try {
    const [tables] = await pool.execute(`SHOW TABLES LIKE 'L%'`);
    const dbKey = Object.keys(tables[0] || {})[0];
    if (!dbKey) return res.json([]);
    const names = tables.map(t => t[dbKey]);
    const result = [];
    for (const tbl of names) {
      const [[cnt]] = await pool.execute(`SELECT COUNT(*) AS c FROM \`${tbl}\``).catch(()=>[[{c:0}]]);
      result.push({table: tbl, rows: cnt.c});
    }
    res.json(result);
  } catch(e) { res.status(500).json({error: e.message}); }
});

// ── LEGACY TABLE BROWSE — paginated rows from any L-prefixed table ──
app.get('/api/legacy/table/:name', async (req, res) => {
  const name = req.params.name;
  if (!name.startsWith('L')) return res.status(400).json({error:'Only L-prefixed tables allowed'});
  const page   = Math.max(1, parseInt(req.query.page)||1);
  const limit  = Math.min(200, parseInt(req.query.limit)||100);
  const offset = (page-1)*limit;
  const search = req.query.search ? `%${req.query.search}%` : null;
  try {
    // Get column names
    const [cols] = await pool.execute(`SHOW COLUMNS FROM \`${name}\``);
    const colNames = cols.map(c=>c.Field);
    const [[{total}]] = await pool.execute(`SELECT COUNT(*) AS total FROM \`${name}\``);

    let rows;
    if (search) {
      // Search across all text/varchar columns
      const textCols = cols.filter(c=>/char|text|enum/i.test(c.Type)).map(c=>c.Field);
      if (textCols.length) {
        const where = textCols.map(c=>`\`${c}\` LIKE ?`).join(' OR ');
        const params = textCols.map(()=>search);
        [rows] = await pool.execute(
          `SELECT * FROM \`${name}\` WHERE ${where} LIMIT ? OFFSET ?`,
          [...params, limit, offset]
        );
      } else {
        [rows] = await pool.execute(`SELECT * FROM \`${name}\` LIMIT ? OFFSET ?`, [limit, offset]);
      }
    } else {
      [rows] = await pool.execute(`SELECT * FROM \`${name}\` LIMIT ? OFFSET ?`, [limit, offset]);
    }
    res.json({columns: colNames, rows, total, page, limit});
  } catch(e) { res.status(500).json({error: e.message}); }
});

app.get('/api/legacy/stations', async (req, res) => {
  try { const [r] = await pool.execute('SELECT station_code, store_name, state, status, address, store_email, store_cat FROM stations WHERE is_delete=0 ORDER BY station_code LIMIT 500'); res.json(r); }
  catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/api/legacy/ics', async (req, res) => {
  try {
    const q = req.query.q ? '%'+req.query.q+'%' : '%';
    const [r] = await pool.execute('SELECT ic_id,ic_name,station_code,enrollment_status,is_active FROM config_whic WHERE (ic_id LIKE ? OR ic_name LIKE ?) LIMIT 500', [q,q]);
    res.json(r);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/api/legacy/users', async (req, res) => {
  try {
    const q = req.query.q ? '%'+req.query.q+'%' : '%';
    const [r] = await pool.execute('SELECT id,CONCAT(fname," ",lname) AS name,mobile,email,status FROM staff WHERE (fname LIKE ? OR lname LIKE ? OR mobile LIKE ?) LIMIT 500', [q,q,q]);
    res.json(r);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/api/legacy/managers', async (req, res) => {
  try { const [r] = await pool.execute('SELECT s.id, CONCAT(s.fname," ",s.lname) AS name, s.mobile, st.station_code FROM staff s LEFT JOIN stations st ON s.store_id=st.legacy_store_id WHERE s.user_type=2 AND s.status=0 LIMIT 200'); res.json(r); }
  catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/api/legacy/debit-notes', async (req, res) => {
  try {
    const q = req.query.q ? '%'+req.query.q+'%' : '%';
    const [r] = await pool.execute('SELECT id,ic_id,ic_name,station_code,status,publish_month FROM debit_data WHERE (ic_id LIKE ? OR ic_name LIKE ? OR station_code LIKE ?) ORDER BY id DESC LIMIT 500', [q,q,q]);
    res.json(r);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/api/legacy/advances', async (req, res) => {
  try {
    const q = req.query.q ? '%'+req.query.q+'%' : '%';
    const [r] = await pool.execute('SELECT id,ic_id,ic_name,station_code,amount,status,week_label,requested_at FROM advance_requests WHERE (ic_id LIKE ? OR ic_name LIKE ? OR station_code LIKE ?) ORDER BY id DESC LIMIT 500', [q,q,q]);
    res.json(r);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/api/legacy/salary-slips', async (req, res) => {
  try {
    const q = req.query.q ? '%'+req.query.q+'%' : '%';
    const [r] = await pool.execute('SELECT ic_id,ic_name,station_code,period_label,days_submitted FROM (SELECT l.ic_id,l.ic_name,l.station_code,p.period_label,COUNT(DISTINCT DATE(l.`+"`"+`timestamp`+"`"+`)) AS days_submitted FROM log_attendance_wh l JOIN config_period p ON DATE(l.`+"`"+`timestamp`+"`"+`) BETWEEN p.period_start AND p.period_end WHERE l.punch_type=\'CLOCK_IN\' GROUP BY l.ic_id,l.ic_name,l.station_code,p.period_label) t WHERE (ic_id LIKE ? OR ic_name LIKE ? OR station_code LIKE ?) ORDER BY period_label DESC LIMIT 500', [q,q,q]);
    res.json(r);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/api/legacy/leaves', async (req, res) => {
  try { res.json([]); } catch(e) { res.status(500).json({error:e.message}); }
});
(async () => {
  // Safe ALTER: catch duplicate column errors (MySQL 5.7 compatible)
  const addCol = (sql) => pool.execute(sql).catch(e => {
    if (!e.message.includes('Duplicate column')) console.error('Migration:', e.message.substring(0,80));
  });
  // edsp_cycles and edsp_data tables already exist — no migration needed
  await pool.execute(`CREATE TABLE IF NOT EXISTS advance_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    station_code VARCHAR(20) NOT NULL,
    ic_id VARCHAR(30) NOT NULL,
    ic_name VARCHAR(100) NOT NULL,
    amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    reason TEXT,
    week_label VARCHAR(20) NOT NULL,
    status ENUM('PENDING','APPROVED','REJECTED') DEFAULT 'PENDING',
    requested_at DATETIME DEFAULT NOW(),
    decided_at DATETIME NULL,
    decided_by VARCHAR(100) NULL,
    decision_note TEXT NULL,
    UNIQUE KEY uq_ic_week (ic_id, week_label)
  )`).catch(()=>{});
  await pool.execute(`CREATE TABLE IF NOT EXISTS debit_responses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    station_code VARCHAR(20) NOT NULL,
    tid VARCHAR(60) NOT NULL,
    decision VARCHAR(30) DEFAULT NULL,
    rec_type VARCHAR(50) DEFAULT NULL,
    tt_number VARCHAR(60) DEFAULT NULL,
    orphan_ref VARCHAR(60) DEFAULT NULL,
    remarks TEXT DEFAULT NULL,
    submitted_by VARCHAR(100) DEFAULT NULL,
    submitted_at DATETIME DEFAULT NOW(),
    UNIQUE KEY uq_resp (tid, station_code)
  )`).catch(()=>{});
  await addCol("ALTER TABLE debit_data ADD COLUMN status ENUM('draft','published','answered','sent_back') DEFAULT 'draft'");
  await addCol("ALTER TABLE debit_data ADD COLUMN publish_month VARCHAR(7) DEFAULT NULL");
  await addCol("ALTER TABLE debit_data ADD COLUMN published_at DATETIME DEFAULT NULL");
  await addCol("ALTER TABLE debit_data ADD COLUMN loss_sub_bucket VARCHAR(100) DEFAULT NULL");
  await addCol("ALTER TABLE debit_data ADD COLUMN shipment_type VARCHAR(50) DEFAULT NULL");
  await addCol("ALTER TABLE debit_data ADD COLUMN ic_name VARCHAR(2000) DEFAULT NULL");
  try { await pool.execute("ALTER TABLE debit_data MODIFY COLUMN ic_name VARCHAR(2000)"); } catch(e) {}
  await addCol("ALTER TABLE debit_data ADD COLUMN cash_recovery_type VARCHAR(50) DEFAULT NULL");
  await addCol("ALTER TABLE debit_data ADD COLUMN cm_confirm VARCHAR(10) DEFAULT NULL");
  await addCol("ALTER TABLE debit_data ADD COLUMN cluster VARCHAR(20) DEFAULT NULL");
  await addCol("ALTER TABLE debit_data ADD COLUMN sub_type VARCHAR(50) DEFAULT NULL");
  await addCol("ALTER TABLE debit_data ADD COLUMN remarks TEXT DEFAULT NULL");
  await addCol("ALTER TABLE debit_data ADD COLUMN confirm_by VARCHAR(100) DEFAULT NULL");
  await addCol("ALTER TABLE debit_responses ADD COLUMN verified_by VARCHAR(100) DEFAULT NULL");
  await addCol("ALTER TABLE log_advances ADD COLUMN verified_by VARCHAR(100) DEFAULT NULL");

  // ── log_amx_history table (historical EDSP — never touches live WH tables) ──
  await pool.execute(`CREATE TABLE IF NOT EXISTS log_amx_history (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    station_code   VARCHAR(20),
    amx_id         VARCHAR(150),
    ic_id          INT,
    ic_name        VARCHAR(100),
    delivery_date  DATE,
    period_label   VARCHAR(30),
    kms            DECIMAL(8,2) DEFAULT 0,
    parcel_type    VARCHAR(30),
    delivered      INT DEFAULT 0,
    pickup         INT DEFAULT 0,
    swa            INT DEFAULT 0,
    smd            INT DEFAULT 0,
    mfn            INT DEFAULT 0,
    returns        INT DEFAULT 0,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_amx_hist (station_code,amx_id,delivery_date,parcel_type,period_label)
  )`);

  // ── petrol_expenses table ────────────────────────────────────────────────────
  await pool.execute(`CREATE TABLE IF NOT EXISTS petrol_expenses (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    period_label        VARCHAR(60),
    upload_batch        VARCHAR(100) NOT NULL,
    upload_date         DATE,
    filename            VARCHAR(200),
    period_from         DATE,
    period_to           DATE,
    station_code        VARCHAR(20),
    store_name          VARCHAR(100),
    staff_id            INT,
    name                VARCHAR(100),
    associate_id        VARCHAR(150),
    delivered           INT DEFAULT 0,
    pickup              INT DEFAULT 0,
    swa                 INT DEFAULT 0,
    smd                 INT DEFAULT 0,
    mfn                 INT DEFAULT 0,
    seller_return       INT DEFAULT 0,
    total_parcels       INT DEFAULT 0,
    total_km            DECIMAL(10,2) DEFAULT 0,
    per_km_rate         DECIMAL(8,2),
    total_petrol_rs     DECIMAL(10,2) DEFAULT 0,
    advance_petrol      DECIMAL(10,2) DEFAULT 0,
    total_bank_transfer DECIMAL(10,2) DEFAULT 0,
    per_parcel_cost     DECIMAL(10,4),
    average             DECIMAL(10,4),
    account_number      VARCHAR(40),
    ifsc_code           VARCHAR(20),
    cm                  VARCHAR(100),
    user_type           VARCHAR(50),
    remarks             VARCHAR(255),
    tally_ledger        VARCHAR(150),
    cost_centre         VARCHAR(50),
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_petrol (upload_batch, station_code, staff_id)
  )`);

  // ── petrol_expenses migrations (add columns if table already existed) ──────────
  try { await pool.execute("ALTER TABLE petrol_expenses ADD COLUMN upload_batch VARCHAR(100)"); } catch(e) {}
  try { await pool.execute("ALTER TABLE log_amx_history ADD COLUMN period_from DATE DEFAULT NULL"); } catch(e) {}
  try { await pool.execute("ALTER TABLE log_amx_history ADD COLUMN period_to DATE DEFAULT NULL"); } catch(e) {}
  try { await pool.execute("ALTER TABLE petrol_expenses ADD COLUMN upload_date DATE"); } catch(e) {}
  try { await pool.execute("ALTER TABLE petrol_expenses ADD COLUMN filename VARCHAR(200)"); } catch(e) {}
  try { await pool.execute("ALTER TABLE petrol_expenses MODIFY COLUMN period_label VARCHAR(60)"); } catch(e) {}
  // Update unique key to use upload_batch instead of period_label
  try { await pool.execute("ALTER TABLE petrol_expenses DROP INDEX uq_petrol"); } catch(e) {}
  try { await pool.execute("ALTER TABLE petrol_expenses ADD UNIQUE KEY uq_petrol (upload_batch, station_code, staff_id)"); } catch(e) {}

  // ── bank_payments table ──────────────────────────────────────────────────────
  await pool.execute(`CREATE TABLE IF NOT EXISTS bank_payments (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    payment_date      DATE NOT NULL,
    file_date         VARCHAR(20),
    payment_category  VARCHAR(50),
    pymt_prod_type    VARCHAR(20),
    pymt_mode         VARCHAR(20),
    debit_acc_no      VARCHAR(30),
    bnf_name          VARCHAR(100),
    bene_acc_no       VARCHAR(40),
    bene_ifsc         VARCHAR(20),
    amount            DECIMAL(12,2),
    debit_narr        VARCHAR(200),
    credit_narr       VARCHAR(200),
    mobile_num        VARCHAR(20),
    email_id          VARCHAR(100),
    remark            VARCHAR(200),
    ref_no            VARCHAR(100),
    addl_info1        VARCHAR(200),
    addl_info2        VARCHAR(200),
    addl_info3        VARCHAR(200),
    addl_info4        VARCHAR(200),
    addl_info5        VARCHAR(200),
    upload_batch      VARCHAR(50),
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_bank_payment (payment_date, bene_acc_no, amount, debit_narr)
  )`);

  // ── dsp_payroll_history table ───────────────────────────────────────────────
  await pool.execute(`CREATE TABLE IF NOT EXISTS dsp_payroll_history (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    payment_month    VARCHAR(20) NOT NULL,
    station_code     VARCHAR(20) NOT NULL,
    staff_id         INT,
    name             VARCHAR(100),
    vehicle_type     VARCHAR(20),
    present_days     DECIMAL(5,1),
    block_a          DECIMAL(8,2) DEFAULT 0,
    block_b          DECIMAL(8,2) DEFAULT 0,
    block_c          DECIMAL(8,2) DEFAULT 0,
    block_d          DECIMAL(8,2) DEFAULT 0,
    block_z          DECIMAL(8,2) DEFAULT 0,
    delivery         INT DEFAULT 0,
    c_return         INT DEFAULT 0,
    buy_back         INT DEFAULT 0,
    total_parcels    INT DEFAULT 0,
    per_parcel_rate  DECIMAL(8,2),
    total_parcel_amt DECIMAL(10,2) DEFAULT 0,
    payment          DECIMAL(10,2) DEFAULT 0,
    incentive        DECIMAL(10,2) DEFAULT 0,
    gross_payment    DECIMAL(10,2) DEFAULT 0,
    debit_note       DECIMAL(10,2) DEFAULT 0,
    net_pay          DECIMAL(10,2) DEFAULT 0,
    advance          DECIMAL(10,2) DEFAULT 0,
    tds              DECIMAL(10,2) DEFAULT 0,
    bank_transfer    DECIMAL(10,2) DEFAULT 0,
    pan_card         VARCHAR(20),
    ifsc_code        VARCHAR(20),
    account_number   VARCHAR(30),
    tally_ledger     VARCHAR(150),
    cost_centre      VARCHAR(50),
    remarks          VARCHAR(255),
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    cycle            TINYINT DEFAULT 1,
    UNIQUE KEY uq_dsp_payroll (staff_id, station_code, payment_month, vehicle_type, cycle)
  )`);
  // Add cycle column if table already exists without it
  try { await pool.execute('ALTER TABLE dsp_payroll_history ADD COLUMN cycle TINYINT DEFAULT 1'); } catch(e) {}
  try { await pool.execute('ALTER TABLE dsp_payroll_history DROP INDEX uq_dsp_payroll'); } catch(e) {}
  try { await pool.execute('ALTER TABLE dsp_payroll_history ADD UNIQUE KEY uq_dsp_payroll (staff_id, station_code, payment_month, vehicle_type, cycle)'); } catch(e) {}

  // ── rent_history table ───────────────────────────────────────────────────────
  await pool.execute(`CREATE TABLE IF NOT EXISTS rent_history (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    payment_month    VARCHAR(20) NOT NULL,
    station_code     VARCHAR(20),
    station_name     VARCHAR(100),
    inv_number       VARCHAR(50),
    rent_amount      DECIMAL(10,2),
    gst              DECIMAL(10,2),
    total_rent       DECIMAL(10,2),
    tds              DECIMAL(10,2),
    payable_amount   DECIMAL(10,2),
    shop_owner_name  VARCHAR(150),
    account_number   VARCHAR(30),
    ifsc_code        VARCHAR(20),
    pan_card_number  VARCHAR(20),
    pan_card_name    VARCHAR(100),
    bank_remarks     VARCHAR(150),
    remarks          VARCHAR(255),
    remarks2         VARCHAR(255),
    property_type    VARCHAR(50),
    tally_ledger     VARCHAR(150),
    cost_centre      VARCHAR(50),
    cm               VARCHAR(100),
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_rent (station_code, payment_month)
  )`);

  // ── additional_payments_history table ─────────────────────────────────────
  await pool.execute(`CREATE TABLE IF NOT EXISTS additional_payments_history (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    payment_month    VARCHAR(20) NOT NULL,
    sr_no            INT,
    payment_date     DATE,
    station_code     VARCHAR(20),
    payment_head     VARCHAR(100),
    company_name     VARCHAR(100),
    employee_id      VARCHAR(20),
    name             VARCHAR(100),
    billing_month    VARCHAR(50),
    inv_number       VARCHAR(50),
    inv_taxable_amt  DECIMAL(10,2),
    gst              DECIMAL(10,2),
    total_inv_amt    DECIMAL(10,2),
    tds_rate         DECIMAL(5,2),
    tds              DECIMAL(10,2),
    actual_amt       DECIMAL(10,2),
    advance_debit    DECIMAL(10,2),
    bank_transfer    DECIMAL(10,2),
    pan_card         VARCHAR(20),
    ifsc_code        VARCHAR(20),
    account_number   VARCHAR(30),
    account_name     VARCHAR(100),
    remarks          VARCHAR(255),
    naisad_remarks   VARCHAR(255),
    tally_ledger     VARCHAR(150),
    cost_centre      VARCHAR(50),
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // ── Migrate any historical data from log_amx → log_amx_history ─────────────
  try {
    // Move rows with month-first labels (e.g. feb-2026, jan-2026-a) to history table
    await pool.execute(`
      INSERT IGNORE INTO log_amx_history
        (station_code,amx_id,ic_id,ic_name,delivery_date,period_label,
         kms,parcel_type,delivered,pickup,swa,smd,mfn,returns)
      SELECT station_code,amx_id,ic_id,ic_name,delivery_date,period_label,
             kms,parcel_type,delivered,pickup,swa,smd,mfn,returns
      FROM log_amx
      WHERE period_label REGEXP '^[a-z]+-[0-9]'`);
    await pool.execute(`DELETE FROM log_amx WHERE period_label REGEXP '^[a-z]+-[0-9]'`);
  } catch(e) { console.log('[migration] log_amx history move:', e.message); }

  // ── payroll_history table ────────────────────────────────────────────────────
  await pool.execute(`CREATE TABLE IF NOT EXISTS payroll_history (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    payroll_month    VARCHAR(20) NOT NULL,
    staff_id         INT NOT NULL,
    store_name       VARCHAR(100),
    station_code     VARCHAR(20),
    head             VARCHAR(20),
    name             VARCHAR(100),
    associate_id     VARCHAR(150),
    present_days     DECIMAL(5,1),
    week_off         DECIMAL(5,1),
    total_days       DECIMAL(5,1),
    delivery         INT DEFAULT 0,
    pickup           INT DEFAULT 0,
    swa              INT DEFAULT 0,
    smd              INT DEFAULT 0,
    mfn              INT DEFAULT 0,
    seller_returns   INT DEFAULT 0,
    total_parcels    INT DEFAULT 0,
    payment          DECIMAL(10,2) DEFAULT 0,
    incentive        DECIMAL(10,2) DEFAULT 0,
    gross_payment    DECIMAL(10,2) DEFAULT 0,
    debit_note       DECIMAL(10,2) DEFAULT 0,
    net_pay          DECIMAL(10,2) DEFAULT 0,
    advance          DECIMAL(10,2) DEFAULT 0,
    tds              DECIMAL(10,2) DEFAULT 0,
    bank_transfer    DECIMAL(10,2) DEFAULT 0,
    ctc              DECIMAL(10,2),
    pay_type         VARCHAR(20),
    petrol           DECIMAL(10,2),
    parcel_count     INT DEFAULT 0,
    per_parcel_cost  DECIMAL(10,4),
    average          DECIMAL(10,4),
    diff             DECIMAL(10,4),
    pan_card         VARCHAR(20),
    user_type        VARCHAR(50),
    cluster_manager  VARCHAR(100),
    pnl_use          VARCHAR(100),
    remarks          VARCHAR(255),
    state            VARCHAR(50),
    tally_ledger     VARCHAR(150),
    cost_centre      VARCHAR(50),
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_payroll (staff_id, payroll_month)
  )`);

  // ── station_type column ─────────────────────────────────────────────────────
  try {
    await pool.execute("ALTER TABLE stations ADD COLUMN station_type VARCHAR(10) NOT NULL DEFAULT 'EDSP'");
  } catch(e) { /* already exists */ }
  // Mark DSP stations
  await pool.execute("UPDATE stations SET station_type='DSP' WHERE station_code IN ('GNNT','AMDE','BDQE')");
  // Ensure all others are EDSP
  await pool.execute("UPDATE stations SET station_type='EDSP' WHERE station_code NOT IN ('GNNT','AMDE','BDQE')");

  // ── Unique keys for log_amx and edsp_data (safe to run multiple times) ──────
  try {
    await pool.execute(`ALTER TABLE log_amx ADD UNIQUE KEY uq_log_amx (station_code,amx_id,delivery_date,parcel_type,period_label)`);
  } catch(e) { /* already exists */ }
  try {
    await pool.execute(`ALTER TABLE edsp_data ADD UNIQUE KEY uq_edsp_data (cycle_id,station_code,amx_id,delivery_date,parcel_type)`);
  } catch(e) { /* already exists */ }

  // ── stations table ──────────────────────────────────────
  await pool.execute(`CREATE TABLE IF NOT EXISTS stations (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    station_code    VARCHAR(20) NOT NULL UNIQUE,
    store_name      VARCHAR(100) DEFAULT NULL,
    legacy_store_id INT DEFAULT NULL,
    address         VARCHAR(300) DEFAULT NULL,
    pincode         VARCHAR(20) DEFAULT NULL,
    store_email     VARCHAR(100) DEFAULT NULL,
    esic            TINYINT(1) DEFAULT 0,
    store_cat       VARCHAR(50) DEFAULT NULL,
    latitude        VARCHAR(100) DEFAULT NULL,
    longitude       VARCHAR(100) DEFAULT NULL,
    amazon_id       VARCHAR(150) DEFAULT NULL,
    serial_no       VARCHAR(50) DEFAULT NULL,
    camera_id       VARCHAR(50) DEFAULT NULL,
    state           INT DEFAULT NULL,
    primary_cluster_manager INT DEFAULT NULL,
    status          TINYINT(1) DEFAULT 0,
    is_delete       TINYINT(1) DEFAULT 0,
    added_date      DATETIME DEFAULT NULL,
    updated_date    DATETIME DEFAULT NULL
  )`).catch(()=>{});

  // ── staff table ─────────────────────────────────────────
  await pool.execute(`CREATE TABLE IF NOT EXISTS staff (
    id                  INT PRIMARY KEY,
    user_type           INT DEFAULT NULL,
    fname               VARCHAR(30) DEFAULT NULL,
    mname               VARCHAR(30) DEFAULT NULL,
    lname               VARCHAR(30) DEFAULT NULL,
    mobile              VARCHAR(20) DEFAULT NULL,
    email               VARCHAR(40) DEFAULT NULL,
    designation         VARCHAR(30) DEFAULT NULL,
    department          VARCHAR(30) DEFAULT NULL,
    store_id            INT DEFAULT NULL,
    station_code        VARCHAR(20) DEFAULT NULL,
    joing_date          DATE DEFAULT NULL,
    resign_date         DATE DEFAULT NULL,
    dob                 DATE DEFAULT NULL,
    blood_group         INT DEFAULT NULL,
    adhar_card          VARCHAR(20) DEFAULT NULL,
    pan_card_number     VARCHAR(100) DEFAULT NULL,
    voter_id            VARCHAR(50) DEFAULT NULL,
    license             VARCHAR(20) DEFAULT NULL,
    licence_expiry      DATE DEFAULT NULL,
    bank_name           VARCHAR(30) DEFAULT NULL,
    account_no          VARCHAR(30) DEFAULT NULL,
    ifsc_code           VARCHAR(20) DEFAULT NULL,
    account_name        VARCHAR(50) DEFAULT NULL,
    uan                 VARCHAR(40) DEFAULT NULL,
    esic                VARCHAR(40) DEFAULT NULL,
    ctc                 VARCHAR(10) DEFAULT NULL,
    gross_salary        VARCHAR(10) DEFAULT NULL,
    per_parcel          VARCHAR(10) DEFAULT NULL,
    salary              DECIMAL(7,2) DEFAULT NULL,
    address             VARCHAR(300) DEFAULT NULL,
    pincode             VARCHAR(20) DEFAULT NULL,
    emergency_contact_1 VARCHAR(20) DEFAULT NULL,
    emergency_contact_2 VARCHAR(20) DEFAULT NULL,
    associate_id        VARCHAR(80) DEFAULT NULL,
    employement_history VARCHAR(300) DEFAULT NULL,
    userid              VARCHAR(30) DEFAULT NULL,
    status              TINYINT(1) DEFAULT NULL,
    inactive_date       DATE DEFAULT NULL,
    is_delete           TINYINT(1) DEFAULT 0,
    added_date          DATETIME DEFAULT NULL,
    updated_date        DATETIME DEFAULT NULL,
    last_login          DATETIME DEFAULT NULL
  )`).catch(()=>{});

  // ── enrich config_whic with staff-linked columns ────────
  await addCol("ALTER TABLE config_whic ADD COLUMN staff_id INT DEFAULT NULL");
  await addCol("ALTER TABLE config_whic ADD COLUMN mobile VARCHAR(20) DEFAULT NULL");
  await addCol("ALTER TABLE config_whic ADD COLUMN dob DATE DEFAULT NULL");
  await addCol("ALTER TABLE config_whic ADD COLUMN joining_date DATE DEFAULT NULL");
  await addCol("ALTER TABLE config_whic ADD COLUMN resign_date DATE DEFAULT NULL");
  await addCol("ALTER TABLE config_whic ADD COLUMN bank_name VARCHAR(30) DEFAULT NULL");
  await addCol("ALTER TABLE config_whic ADD COLUMN account_no VARCHAR(30) DEFAULT NULL");
  await addCol("ALTER TABLE config_whic ADD COLUMN ifsc_code VARCHAR(20) DEFAULT NULL");
  await addCol("ALTER TABLE config_whic ADD COLUMN account_name VARCHAR(50) DEFAULT NULL");
  await addCol("ALTER TABLE config_whic ADD COLUMN per_parcel VARCHAR(10) DEFAULT NULL");

  console.log('Migrations done.');
})().catch(e => console.error('Migration error:', e.message));


// ── Stations by type (for payroll tab config) ────────────────────────────────
app.get('/api/admin/stations-by-type', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT station_code, store_name, station_type
       FROM stations WHERE is_delete=0
       ORDER BY station_type, station_code`
    );
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── Payroll verify ───────────────────────────────────────
app.post('/api/admin/payroll-verify', (req, res) => {
  const { password } = req.body;
  if (password === 'pay@2024') res.json({ok:true});
  else res.status(401).json({ok:false});
});

// ── Payroll staff export ──────────────────────────────────
app.get('/api/admin/payroll-staff', async (req, res) => {
  const { station, user_type, month } = req.query;
  // month e.g. "jan-2026" — used to join payroll_history + log_amx

  const roleMap = {
    1:'Admin', 2:'Station Incharge', 4:'Delivery Associate',
    5:'Cluster Manager', 6:'Store Admin', 7:'Account',
    8:'Van Associate', 11:'Head Office Admin', 13:'Travelling Manager',
    14:'Station Associate', 15:'Operation Manager', 16:'HR Admin',
    17:'Assistance Cluster Manager', 18:'Process Associate',
    19:'SLPT Team Leader', 20:'Loader', 21:'CP Point'
  };

  // Helper: actual days in month from label e.g. "jan-2026" → 31
  const daysInMonth = (label) => {
    if (!label) return 31;
    const mnames = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const parts = label.split('-');
    const mi = mnames.indexOf(parts[0]);
    const yr = parseInt(parts[1]) || new Date().getFullYear();
    if (mi < 0) return 31;
    return new Date(yr, mi + 1, 0).getDate();
  };
  const totalDaysInMonth = daysInMonth(month);

  // Formulas (JS versions of Excel formulas)
  const weekOff = (present) => {
    const p = parseFloat(present) || 0;
    if (p >= 27) return 4;
    if (p >= 24) return 4;
    if (p >= 18) return 3;
    if (p >= 12) return 2;
    if (p >= 6)  return 1;
    return 0;
  };
  const roundUp = (n) => Math.ceil(n * 100) / 100;
  const totalParcels = (d,pk,s,sm,mfn,sr) =>
    Math.ceil((d+pk+s+sm) + (mfn+sr)/3);
  const calcPayment = (payType, ctc, totalDays, parcels, daysInMon) => {
    if (payType === 'Per Parcel') return ctc * parcels;
    if (payType === 'Fix')        return roundUp((ctc / daysInMon) * totalDays);
    if (payType === 'Per Day')    return ctc * totalDays;
    return 0;
  };

  try {
    let staffSql = `
      SELECT s.id, s.user_type, st.store_name, s.station_code,
             TRIM(CONCAT(COALESCE(s.fname,''),' ',COALESCE(s.lname,''))) AS full_name,
             s.ctc, s.pan_card_number, s.ifsc_code, s.account_no, s.per_parcel,
             TRIM(CONCAT(COALESCE(cm.fname,''),' ',COALESCE(cm.lname,''))) AS cluster_manager
      FROM staff s
      LEFT JOIN stations st ON LOWER(st.station_code)=LOWER(s.station_code)
      LEFT JOIN staff cm ON cm.id=st.primary_cluster_manager
      WHERE s.status=0 AND s.is_delete=0`;
    const p = [];
    if (station)   { staffSql += ' AND LOWER(s.station_code)=LOWER(?)'; p.push(station); }
    if (user_type) { staffSql += ' AND s.user_type=?'; p.push(user_type); }
    staffSql += ' ORDER BY s.station_code, s.user_type, s.fname';

    const [staffRows] = await pool.execute(staffSql, p);

    // Build lookup maps for the selected month
    let phMap = {}, edspMap = {}, debitMap = {}, advMap = {};

    if (month) {
      // payroll_history for this month
      const [ph] = await pool.execute(
        'SELECT * FROM payroll_history WHERE payroll_month=?', [month]);
      ph.forEach(r => phMap[r.staff_id] = r);

      // EDSP/log_amx — match period labels that belong to this month
      // e.g. jan-2026 matches jan-2026, jan-2026-a, jan-2026-b
      const mbase = month.replace(/-[ab]$/, '');
      const [edsp] = await pool.execute(`
        SELECT ic_id,
               COUNT(DISTINCT delivery_date) AS present_days,
               SUM(delivered)      AS delivery,
               SUM(pickup)         AS pickup,
               SUM(swa)            AS swa,
               SUM(smd)            AS smd,
               SUM(mfn)            AS mfn,
               SUM(returns)        AS seller_returns
        FROM log_amx
        WHERE (period_label=? OR period_label=? OR period_label=?)
          AND ic_id IS NOT NULL
        GROUP BY ic_id`,
        [mbase, mbase+'-a', mbase+'-b']);
      edsp.forEach(r => edspMap[r.ic_id] = r);

      // Debit notes for this month from debit_data
      const [deb] = await pool.execute(`
        SELECT station_code, SUM(amount) AS total_debit
        FROM debit_data
        WHERE period_label LIKE ?
        GROUP BY station_code`,
        [mbase + '%']);
      deb.forEach(r => debitMap[r.station_code] = parseFloat(r.total_debit)||0);

      // Advances — approved for this month
      const [adv] = await pool.execute(`
        SELECT ic_id, SUM(amount) AS total_advance
        FROM advance_requests
        WHERE status='approved'
          AND DATE_FORMAT(created_at, '%b-%Y') LIKE ?
        GROUP BY ic_id`,
        [month.split('-')[0].charAt(0).toUpperCase() + month.split('-')[0].slice(1) + '-' + month.split('-')[1]]);
      adv.forEach(r => advMap[r.ic_id] = parseFloat(r.total_advance)||0);
    }

    const result = staffRows.map(s => {
      const ph   = phMap[s.id]   || {};
      const edsp = edspMap[s.id] || {};

      // Base counts — prefer EDSP data, fall back to payroll_history
      const present      = parseFloat(edsp.present_days || ph.present_days || 0);
      const wOff         = weekOff(present);
      const totalDays    = present + wOff;
      const delivery     = parseInt(edsp.delivery     || ph.delivery     || 0);
      const pickup       = parseInt(edsp.pickup       || ph.pickup       || 0);
      const swa          = parseInt(edsp.swa          || ph.swa          || 0);
      const smd          = parseInt(edsp.smd          || ph.smd          || 0);
      const mfn          = parseInt(edsp.mfn          || ph.mfn          || 0);
      const sellerRet    = parseInt(edsp.seller_returns || ph.seller_returns || 0);
      const parcels      = totalParcels(delivery, pickup, swa, smd, mfn, sellerRet);
      const parcelWeighted = Math.ceil(delivery + pickup + swa + smd + (mfn + sellerRet)/3);

      // Pay details — prefer payroll_history, fall back to staff table
      const payType      = ph.pay_type  || 'Per Parcel';
      const ctc          = parseFloat(ph.ctc || s.ctc || 0);
      const incentive    = parseFloat(ph.incentive  || 0);
      const debitNote    = parseFloat(ph.debit_note || debitMap[s.station_code] || 0);
      const advance      = parseFloat(ph.advance    || advMap[s.id] || 0);
      const petrol       = parseFloat(ph.petrol     || 0);

      // Calculated
      const payment      = calcPayment(payType, ctc, totalDays, parcels, totalDaysInMonth);
      const grossPayment = Math.ceil(payment + incentive);
      const netPay       = grossPayment - debitNote;
      const tds          = Math.ceil(netPay * 0.01);
      const bankTransfer = netPay - (advance + tds);
      const perParcelCost = parcelWeighted > 0 ? (grossPayment + petrol) / parcelWeighted : 0;
      const average      = parseFloat(ph.average || perParcelCost);
      const diff         = average - ctc;

      return {
        store_name:       s.store_name || '',
        station_code:     s.station_code || '',
        id:               s.id,
        head:             ph.head || '',
        full_name:        s.full_name,
        associate_id:     ph.associate_id || '',
        present_days:     present,
        week_off:         wOff,
        total_days:       totalDays,
        delivery, pickup, swa, smd, mfn,
        seller_returns:   sellerRet,
        total_parcels:    parcels,
        payment:          Math.round(payment * 100) / 100,
        incentive,
        gross_payment:    grossPayment,
        debit_note:       debitNote,
        net_pay:          netPay,
        advance,
        tds,
        bank_transfer:    bankTransfer,
        ctc,
        pay_type:         payType,
        petrol,
        parcel_count:     parcelWeighted,
        per_parcel_cost:  Math.round(perParcelCost * 10000) / 10000,
        average:          Math.round(average * 10000) / 10000,
        diff:             Math.round(diff * 10000) / 10000,
        pan_card:         s.pan_card_number || ph.pan_card || '',
        user_type:        roleMap[s.user_type] || ('Type ' + s.user_type),
        cluster_manager:  s.cluster_manager,
        pnl_use:          ph.pnl_use || '',
        remarks:          ph.remarks || '',
        state:            ph.state || '',
        tally_ledger:     ph.tally_ledger || '',
        cost_centre:      ph.cost_centre || '',
        ifsc_code:        s.ifsc_code || '',
        account_no:       s.account_no || '',
        // Source flags for UI
        _has_edsp:        !!edspMap[s.id],
        _has_payroll:     !!phMap[s.id]
      };
    });

    res.json(result);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── Stations admin list ──────────────────────────────────
app.get('/api/admin/stations-list', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT station_code, store_name, legacy_store_id, address, pincode,
              store_email, esic, store_cat, latitude, longitude,
              amazon_id, serial_no, camera_id, state,
              primary_cluster_manager, status, is_delete, added_date
       FROM stations WHERE is_delete=0 ORDER BY station_code`
    );
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── Staff profile detail ─────────────────────────────────
app.get('/api/admin/staff/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM staff WHERE id=? LIMIT 1', [req.params.id]);
    if (!rows.length) return res.status(404).json({error:'Not found'});
    const r = rows[0];
    const safeDate = v => {
      if (!v) return null;
      const s = String(v).substring(0,10);
      return (s === '0000-00-00' || s.startsWith('Invalid')) ? null : s;
    };
    const safe = {...r};
    delete safe.aadhar_image; delete safe.pan_image; delete safe.cheque_image;
    delete safe.bank_proof; delete safe.license_image; delete safe.voter_image;
    delete safe.profile_image; delete safe.form11;
    ['joing_date','resign_date','dob','inactive_date','licence_expiry'].forEach(k => {
      if (safe[k] !== undefined) safe[k] = safeDate(safe[k]);
    });
    ['added_date','updated_date','last_login'].forEach(k => {
      if (safe[k]) safe[k] = String(safe[k]).substring(0,19);
    });
    res.json(safe);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── Staff Directory ──────────────────────────────────────
app.get('/api/admin/staff-directory', async (req, res) => {
  const {role, status, station, q} = req.query;
  const roleNames = {1:'Admin', 2:'Station Incharge', 3:'Van', 4:'Delivery Associate',
      5:'Cluster Manager', 6:'Store Admin', 7:'Account',
      8:'Van Associate', 11:'Head Office Admin', 13:'Travelling Manager',
      14:'Station Associate', 15:'Operation Manager', 16:'HR Admin',
      17:'Assistance Cluster Manager', 18:'Process Associate',
      19:'SLPT Team Leader', 20:'Loader', 21:'CP Point'};
  let sql = `SELECT id, user_type, fname, mname, lname, mobile, email,
                    designation, station_code, joing_date, resign_date, status, is_delete
             FROM staff WHERE is_delete=0`;
  const p = [];
  if (role)    { sql += ' AND user_type=?'; p.push(role); }
  if (station) { sql += ' AND station_code=?'; p.push(station); }
  if (status === 'active')   { sql += ' AND (resign_date IS NULL OR resign_date=\'0000-00-00\' OR resign_date>CURDATE()) AND status=0'; }
  if (status === 'resigned') { sql += ' AND resign_date IS NOT NULL AND resign_date!=\'0000-00-00\' AND resign_date<=CURDATE()'; }
  if (q) { sql += ' AND (fname LIKE ? OR lname LIKE ? OR mobile LIKE ? OR CAST(id AS CHAR) LIKE ?)';
            const lq = `%${q}%`; p.push(lq,lq,lq,lq); }
  sql += ' ORDER BY fname, lname LIMIT 500';
  try {
    const [rows] = await pool.execute(sql, p);
    const safeDate = v => {
      if (!v) return null;
      const s = v instanceof Date ? v.toISOString().substring(0,10) : String(v).substring(0,10);
      return (s === '0000-00-00' || s.startsWith('Invalid')) ? null : s;
    };
    res.json(rows.map(r => {
      const rd = safeDate(r.resign_date);
      return {
        id: r.id,
        name: [r.fname, r.mname, r.lname].filter(Boolean).map(s=>s.trim()).join(' ').replace(/\s+/,' '),
        user_type: r.user_type,
        role: roleNames[r.user_type] || ('Role ' + r.user_type),
        station_code: r.station_code || '—',
        mobile: r.mobile || '—',
        email: r.email || '',
        joining: safeDate(r.joing_date) || '—',
        resign_date: rd,
        is_active: (!rd || new Date(rd) > new Date()) && r.status === 0
      };
    }));
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── LEGACY SYNC — pull stations + staff + config_whic from legacy DB ──
app.post('/api/admin/legacy-sync', async (req, res) => {
  const results = {stations:0, staff:0, config_whic:0, errors:[]};
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // ── 1. Sync stations from legacy stores ──────────────
    const [stores] = await legacyPool.execute(
      `SELECT s.id, TRIM(REPLACE(REPLACE(s.station_code,CHAR(13),''),CHAR(10),'')) AS station_code,
              TRIM(REPLACE(REPLACE(s.store_id,CHAR(13),''),CHAR(10),'')) AS store_name, s.address, s.pincode, s.store_email,
              s.esic, s.store_cat, s.latitude, s.longitude, s.amazon_id,
              s.serial_no, s.camera_id, s.state, s.primary_cluster_manager,
              s.status, s.is_delete, s.added_date, s.updated_date
       FROM stores s WHERE s.station_code IS NOT NULL AND TRIM(s.station_code)!=''`
    );
    for (const s of stores) {
      if (!s.station_code) continue;
      await conn.execute(
        `INSERT INTO stations
           (station_code, store_name, legacy_store_id, address, pincode, store_email,
            esic, store_cat, latitude, longitude, amazon_id, serial_no, camera_id,
            state, primary_cluster_manager, status, is_delete, added_date, updated_date)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           store_name=VALUES(store_name), legacy_store_id=VALUES(legacy_store_id),
           address=VALUES(address), pincode=VALUES(pincode), store_email=VALUES(store_email),
           esic=VALUES(esic), store_cat=VALUES(store_cat), latitude=VALUES(latitude),
           longitude=VALUES(longitude), amazon_id=VALUES(amazon_id),
           serial_no=VALUES(serial_no), camera_id=VALUES(camera_id),
           state=VALUES(state), primary_cluster_manager=VALUES(primary_cluster_manager),
           status=VALUES(status), is_delete=VALUES(is_delete), updated_date=VALUES(updated_date)`,
        [s.station_code, s.store_name, s.id, s.address, s.pincode, s.store_email,
         s.esic, s.store_cat, s.latitude, s.longitude, s.amazon_id,
         s.serial_no, s.camera_id, s.state, s.primary_cluster_manager,
         s.status, s.is_delete, s.added_date, s.updated_date]
      ).catch(e => results.errors.push(`station ${s.station_code}: ${e.message}`));
      results.stations++;
    }

    // ── 2. Sync all staff from legacy users ──────────────
    const [users] = await legacyPool.execute(
      `SELECT u.id, u.user_type, u.fname, u.mname, u.lname, u.mobile, u.email,
              u.designation, u.department, u.store_id,
              TRIM(REPLACE(REPLACE(s.station_code,CHAR(13),''),CHAR(10),'')) AS station_code,
              u.joing_date, u.resign_date, u.dob, u.blood_group,
              u.adhar_card, u.pan_card_number, u.voter_id,
              u.license, u.licence_expiry,
              u.bank_name, u.account_no, u.ifsc_code, u.account_name,
              u.uan, u.esic, u.ctc, u.gross_salary, u.per_parcel, u.salary,
              u.address, u.pincode, u.emergency_contact_1, u.emergency_contact_2,
              u.associate_id, u.employement_history, u.userid,
              u.status, u.inactive_date, u.is_delete, u.added_date, u.updated_date, u.last_login
       FROM users u LEFT JOIN stores s ON s.id=u.store_id
       WHERE u.is_delete=0`
    );
    const safeD = v => {
      if (!v) return null;
      const s = String(v).substring(0,10);
      return (s === '0000-00-00' || s.startsWith('Invalid') || s === 'null') ? null : s;
    };
    for (const u of users) {
      await conn.execute(
        `INSERT INTO staff
           (id, user_type, fname, mname, lname, mobile, email, designation, department,
            store_id, station_code, joing_date, resign_date, dob, blood_group,
            adhar_card, pan_card_number, voter_id, license, licence_expiry,
            bank_name, account_no, ifsc_code, account_name, uan, esic, ctc,
            gross_salary, per_parcel, salary, address, pincode,
            emergency_contact_1, emergency_contact_2, associate_id,
            employement_history, userid, status, inactive_date, is_delete,
            added_date, updated_date, last_login)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           user_type=VALUES(user_type), fname=VALUES(fname), mname=VALUES(mname),
           lname=VALUES(lname), mobile=VALUES(mobile), email=VALUES(email),
           designation=VALUES(designation), department=VALUES(department),
           store_id=VALUES(store_id), station_code=VALUES(station_code),
           joing_date=VALUES(joing_date), resign_date=VALUES(resign_date),
           dob=VALUES(dob), bank_name=VALUES(bank_name), account_no=VALUES(account_no),
           ifsc_code=VALUES(ifsc_code), per_parcel=VALUES(per_parcel),
           status=VALUES(status), is_delete=VALUES(is_delete),
           updated_date=VALUES(updated_date)`,
        [u.id, u.user_type, u.fname, u.mname, u.lname, u.mobile, u.email,
         u.designation, u.department, u.store_id, u.station_code,
         safeD(u.joing_date), safeD(u.resign_date), safeD(u.dob), u.blood_group,
         u.adhar_card, u.pan_card_number, u.voter_id, u.license, safeD(u.licence_expiry),
         u.bank_name, u.account_no, u.ifsc_code, u.account_name, u.uan, u.esic,
         u.ctc, u.gross_salary, u.per_parcel, u.salary, u.address, u.pincode,
         u.emergency_contact_1, u.emergency_contact_2, u.associate_id,
         u.employement_history, u.userid, u.status, safeD(u.inactive_date), u.is_delete,
         u.added_date, u.updated_date, u.last_login]
      ).catch(e => results.errors.push(`staff ${u.id}: ${e.message}`));
      results.staff++;
    }

    // ── 3. Repopulate config_whic from staff (all operational user types) ──
    const roleMap = {
      1:'Admin', 2:'Station Incharge', 4:'Delivery Associate',
      5:'Cluster Manager', 6:'Store Admin', 7:'Account',
      8:'Van Associate', 11:'Head Office Admin', 13:'Travelling Manager',
      14:'Station Associate', 15:'Operation Manager', 16:'HR Admin',
      17:'Assistance Cluster Manager', 18:'Process Associate',
      19:'SLPT Team Leader', 20:'Loader', 21:'CP Point'
    };
    const whicTypes = new Set([1,2,4,5,6,7,8,11,13,14,15,16,17,18,19,20,21]);
    const whicUsers = users.filter(u => whicTypes.has(u.user_type) && u.station_code);
    for (const u of whicUsers) {
      const fullName = [u.fname, u.mname, u.lname].filter(Boolean).map(s=>s.trim()).join(' ').replace(/\s+/,' ').trim();
      const isActive = (u.status === 0 || u.status === '0') ? 1 : 0;
      await conn.execute(
        `INSERT INTO config_whic
           (ic_id, ic_name, station_code, ic_title, is_active, enrollment_status,
            staff_id, mobile, dob, joining_date, resign_date,
            bank_name, account_no, ifsc_code, account_name, per_parcel,
            can_access_modules)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)
         ON DUPLICATE KEY UPDATE
           ic_name=VALUES(ic_name), station_code=VALUES(station_code),
           ic_title=VALUES(ic_title),
           is_active=VALUES(is_active),
           staff_id=VALUES(staff_id), mobile=VALUES(mobile), dob=VALUES(dob),
           joining_date=VALUES(joining_date), resign_date=VALUES(resign_date),
           bank_name=VALUES(bank_name), account_no=VALUES(account_no),
           ifsc_code=VALUES(ifsc_code), account_name=VALUES(account_name),
           per_parcel=VALUES(per_parcel)`,
        [String(u.id), fullName, u.station_code, roleMap[u.user_type] || ('Type '+u.user_type),
         isActive, 'PENDING', u.id,
         u.mobile??null, safeD(u.dob), safeD(u.joing_date), safeD(u.resign_date),
         u.bank_name??null, u.account_no??null, u.ifsc_code??null,
         u.account_name??null, u.per_parcel??null]
      ).catch(e => results.errors.push(`whic ${u.id}: ${e.message}`));
      results.config_whic++;
    }

    await conn.commit();
    res.json({success:true, ...results});
  } catch(e) {
    await conn.rollback();
    res.status(500).json({error: e.message, partial: results});
  } finally { conn.release(); }
});

app.get('/api/shift-status-batch/:station', async (req, res) => {
  try {
    const station = req.params.station;
    // Get all staff IDs for this station from legacy DB
    const [staff] = await pool.execute(
      `SELECT ic_id FROM config_whic WHERE is_active=1 AND station_code=?`, [station]
    );
    if (!staff.length) return res.json({});
    const ids = staff.map(s => String(s.ic_id));
    const ph = ids.map(()=>'?').join(',');
    // Get all open clock-ins (CLOCK_IN with no matching CLOCK_OUT/SYSTEM_LOGOUT)
    const [rows] = await pool.execute(
      `SELECT id, ic_id, \`timestamp\` AS created_at FROM log_attendance_wh WHERE ic_id IN (${ph}) AND punch_type='CLOCK_IN' AND id NOT IN (SELECT COALESCE(shift_id,0) FROM log_attendance_wh WHERE ic_id IN (${ph}) AND punch_type IN ('CLOCK_OUT','SYSTEM_LOGOUT') AND shift_id IS NOT NULL) ORDER BY \`timestamp\` DESC`, [...ids, ...ids]
    );
    // Build map: ic_id -> shift info (keep only most recent per IC)
    const result = {};
    rows.forEach(r => {
      const key = String(r.ic_id);
      if (!result[key]) {
        const durMins = Math.round((Date.now() - new Date(r.created_at)) / 60000);
        result[key] = {status:'CLOCKED_IN', since:r.created_at, durationMins:durMins, logId:r.id};
      }
    });
    res.json(result);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// -------------------------------------------------------
//  STATIC & ROUTING
// -------------------------------------------------------


// ════════════════════════════════════════════════════════════════════════════
// ADMIN AUTH — Login, Sessions, Middleware, User Management
// ════════════════════════════════════════════════════════════════════════════

// Tab permissions per role — what each role can see by default
const ROLE_TABS = {
  superadmin:       ['t-ov','t-users','t-machines','t-violations','t-kms','t-advances','t-deb','t-data','t-stations','t-cm','t-legacy','t-test','t-payroll'],
  ops_admin:        ['t-ov','t-users','t-machines','t-violations','t-kms','t-advances','t-deb','t-data','t-stations','t-cm','t-legacy'],
  finance:          ['t-ov','t-advances','t-deb','t-legacy','t-payroll'],
  hr:               ['t-ov','t-users','t-violations','t-advances','t-stations'],
  viewer:           ['t-ov','t-users','t-violations','t-kms','t-advances','t-deb','t-legacy'],
  cluster_manager:  ['t-ov','t-users','t-violations','t-kms','t-advances','t-deb'],
};

// API route permissions — which roles can call which endpoint patterns
const ROUTE_PERMS = {
  'GET:/api/admin/stations-list':   ['superadmin','ops_admin','hr'],
  'POST:/api/admin/legacy-sync':    ['superadmin'],
  'POST:/api/admin/set-user-access':['superadmin','ops_admin'],
  'DELETE:/api/admin/debit-data':   ['superadmin','ops_admin','finance'],
  'GET:/api/admin/payroll-staff':   ['superadmin','finance'],
  'GET:/api/admin/export':          ['superadmin','ops_admin','finance','hr'],
};

// ── Helper: get current IST datetime string ──────────────────────────────
function nowIST() {
  // Returns current time as IST (UTC+5:30) formatted for MySQL DATETIME
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().replace('T', ' ').substring(0, 19);
}

// ── Helper: write audit log ────────────────────────────────────────────────
async function writeAudit(userId, userName, action, entity, entityId, detail, ip) {
  try {
    await pool.execute(
      'INSERT INTO audit_log (user_id,user_name,action,entity,entity_id,detail,ip_address) VALUES (?,?,?,?,?,?,?)',
      [userId||null, userName||'system', action, entity||null, entityId||null, detail?JSON.stringify(detail):null, ip||null]
    );
  } catch(e) { console.error('audit_log write:', e.message); }
}

// ── Helper: generate session token ────────────────────────────────────────
function genSessionToken() {
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}


// ── Helper: get station filter clause + params for CM scoping ─────────────
function cmStationClause(req, col) {
  col = col || 'station_code';
  var stations = req.adminUser && req.adminUser.cm_stations;
  if (!stations || !stations.length) return { clause: '', params: [] };
  return {
    clause: ' AND ' + col + ' IN (' + stations.map(function(){ return '?'; }).join(',') + ')',
    params: stations
  };
}

// ── Auth middleware — validates session cookie ────────────────────────────
async function requireAdminAuth(req, res, next) {
  try {
    const raw = req.cookies && req.cookies.adm_session;
    if (!raw) return res.status(401).json({ error: 'Not authenticated', redirect: '/admin/login' });
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const [rows] = await pool.execute(
      `SELECT s.id, s.user_id, s.expires_at, s.revoked,
              u.name, u.email, u.role, u.extra_tabs, u.denied_tabs, u.is_active, u.force_pw_change
       FROM admin_sessions s JOIN admin_users u ON s.user_id=u.id
       WHERE s.token_hash=? LIMIT 1`,
      [hash]
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid session', redirect: '/admin/login' });
    const s = rows[0];
    if (s.revoked) return res.status(401).json({ error: 'Session revoked', redirect: '/admin/login' });
    if (new Date(s.expires_at) < new Date()) return res.status(401).json({ error: 'Session expired', redirect: '/admin/login' });
    if (!s.is_active) return res.status(403).json({ error: 'Account disabled' });
    // Slide expiry — update last_seen every 5 min to avoid constant writes
    const lastSeen = new Date(s.last_seen||0);
    if ((Date.now() - lastSeen.getTime()) > 5*60*1000) {
      const newExp = new Date(Date.now() + 8*60*60*1000);
      await pool.execute('UPDATE admin_sessions SET last_seen=NOW(), expires_at=? WHERE id=?', [newExp, s.id]);
    }
    req.adminUser = { id: s.user_id, name: s.name, email: s.email, role: s.role,
                      extra_tabs: s.extra_tabs, denied_tabs: s.denied_tabs, force_pw_change: s.force_pw_change };
    req.sessionId = s.id;
    next();
  } catch(e) {
    console.error('requireAdminAuth:', e.message);
    res.status(500).json({ error: 'Auth error' });
  }
}

// ── Helper: get allowed tabs for a user ───────────────────────────────────
function getUserTabs(user) {
  let tabs = [...(ROLE_TABS[user.role] || [])];
  const extra  = Array.isArray(user.extra_tabs)  ? user.extra_tabs  : (user.extra_tabs  ? JSON.parse(user.extra_tabs)  : []);
  const denied = Array.isArray(user.denied_tabs) ? user.denied_tabs : (user.denied_tabs ? JSON.parse(user.denied_tabs) : []);
  extra.forEach(function(t){ if (!tabs.includes(t)) tabs.push(t); });
  denied.forEach(function(t){ tabs = tabs.filter(function(x){ return x !== t; }); });
  return tabs;
}

// ════════════════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ════════════════════════════════════════════════════════════════════════════

// ── POST /api/admin/auth/login ────────────────────────────────────────────
app.post('/api/admin/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const ip = req.ip || req.connection.remoteAddress;
  try {
    const [rows] = await pool.execute('SELECT * FROM admin_users WHERE email=? LIMIT 1', [email.toLowerCase().trim()]);
    if (!rows.length) {
      await writeAudit(null, email, 'login_failed', 'admin_users', null, {reason:'user_not_found'}, ip);
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const user = rows[0];
    // Check lockout
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const mins = Math.ceil((new Date(user.locked_until) - Date.now()) / 60000);
      return res.status(403).json({ error: `Account locked. Try again in ${mins} minute(s).` });
    }
    if (!user.is_active) return res.status(403).json({ error: 'Account disabled. Contact admin.' });
    // Verify password
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      const attempts = (user.failed_attempts || 0) + 1;
      const lockUntil = attempts >= 5 ? new Date(Date.now() + 15*60*1000) : null;
      await pool.execute('UPDATE admin_users SET failed_attempts=?, locked_until=? WHERE id=?', [attempts, lockUntil, user.id]);
      await writeAudit(user.id, user.name, 'login_failed', 'admin_users', String(user.id), {attempts}, ip);
      if (lockUntil) return res.status(403).json({ error: 'Too many failed attempts. Account locked for 15 minutes.' });
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    // Success — reset failed attempts, create session
    const { raw, hash } = genSessionToken();
    const expiresAt = new Date(Date.now() + 8*60*60*1000);
    const ua = req.headers['user-agent'] || '';
    await pool.execute(
      'INSERT INTO admin_sessions (user_id,token_hash,ip_address,user_agent,expires_at) VALUES (?,?,?,?,?)',
      [user.id, hash, ip, ua.substring(0,300), expiresAt]
    );
    await pool.execute('UPDATE admin_users SET failed_attempts=0, locked_until=NULL, last_login=NOW(), last_login_ip=? WHERE id=?', [ip, user.id]);
    await writeAudit(user.id, user.name, 'login', 'admin_users', String(user.id), {ip, role:user.role}, ip);
    // Set httpOnly cookie
    res.cookie('adm_session', raw, {
      httpOnly: true, secure: false, sameSite: 'lax',
      maxAge: 8*60*60*1000, path: '/'
    });
    res.json({
      ok: true,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, force_pw_change: user.force_pw_change },
      tabs: getUserTabs(user),
      redirect: user.role === 'cluster_manager' ? '/cm' : '/admin'
    });
  } catch(e) { console.error('login:', e.message); res.status(500).json({ error: 'Login failed' }); }
});

// ── POST /api/admin/auth/logout ───────────────────────────────────────────
app.post('/api/admin/auth/logout', requireAdminAuth, async (req, res) => {
  await pool.execute('UPDATE admin_sessions SET revoked=1 WHERE id=?', [req.sessionId]);
  await writeAudit(req.adminUser.id, req.adminUser.name, 'logout', null, null, null, req.ip);
  res.clearCookie('adm_session', { path: '/' });
  res.json({ ok: true });
});

// ── GET /api/admin/auth/me — verify session + return user info ────────────
app.get('/api/admin/auth/me', requireAdminAuth, addCMStations, async (req, res) => {
  const u = req.adminUser;
  res.json({
    ok: true,
    user: {
      id: u.id, name: u.name, email: u.email, role: u.role,
      force_pw_change: u.force_pw_change,
      cm_stations: u.cm_stations || null,
      cm_staff_id: u.cm_staff_id || null
    },
    tabs: getUserTabs(u)
  });
});

// ── POST /api/admin/auth/change-password ─────────────────────────────────
app.post('/api/admin/auth/change-password', requireAdminAuth, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!new_password || new_password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const [rows] = await pool.execute('SELECT password_hash FROM admin_users WHERE id=?', [req.adminUser.id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    // Skip current_password check if force_pw_change
    if (!req.adminUser.force_pw_change) {
      const match = await bcrypt.compare(current_password || '', rows[0].password_hash);
      if (!match) return res.status(401).json({ error: 'Current password incorrect' });
    }
    const hash = await bcrypt.hash(new_password, 12);
    await pool.execute('UPDATE admin_users SET password_hash=?, force_pw_change=0 WHERE id=?', [hash, req.adminUser.id]);
    await writeAudit(req.adminUser.id, req.adminUser.name, 'password_change', 'admin_users', String(req.adminUser.id), null, req.ip);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// ADMIN USER MANAGEMENT (superadmin only)
// ════════════════════════════════════════════════════════════════════════════

// ── GET /api/admin/users ──────────────────────────────────────────────────
app.get('/api/admin/users', requireAdminAuth, async (req, res) => {
  if (req.adminUser.role !== 'superadmin') return res.status(403).json({ error: 'Superadmin only' });
  try {
    const [rows] = await pool.execute(
      'SELECT id,name,email,role,extra_tabs,denied_tabs,is_active,force_pw_change,last_login,last_login_ip,failed_attempts,locked_until,created_at FROM admin_users ORDER BY name'
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ── GET /api/admin/users/legacy-search — search legacy staff for admin creation
app.get('/api/admin/users/legacy-search', requireAdminAuth, async (req, res) => {
  if (req.adminUser.role !== 'superadmin') return res.status(403).json({ error: 'Superadmin only' });
  const q = req.query.q || '';
  if (q.length < 2) return res.json([]);
  try {
    const like = '%' + q + '%';
    const [rows] = await pool.execute(
      `SELECT s.id, CONCAT(s.fname,' ',s.lname) AS name, s.email, s.mobile,
              st.station_code, s.user_type
       FROM staff s
       LEFT JOIN stations st ON s.store_id = st.legacy_store_id
       WHERE s.status=0
         AND (s.fname LIKE ? OR s.lname LIKE ? OR s.email LIKE ?
              OR CONCAT(s.fname,' ',s.lname) LIKE ? OR s.mobile LIKE ?)
       ORDER BY s.fname, s.lname
       LIMIT 20`,
      [like, like, like, like, like]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/admin/users — create user ──────────────────────────────────
app.post('/api/admin/users', requireAdminAuth, async (req, res) => {
  if (req.adminUser.role !== 'superadmin') return res.status(403).json({ error: 'Superadmin only' });
  const { name, email, password, role, extra_tabs, denied_tabs } = req.body;
  if (!name || !email || !password || !role) return res.status(400).json({ error: 'name, email, password, role required' });
  try {
    const hash = await bcrypt.hash(password, 12);
    const { cm_staff_id } = req.body;
    const [r] = await pool.execute(
      'INSERT INTO admin_users (name,email,password_hash,role,extra_tabs,denied_tabs,force_pw_change,created_by,cm_staff_id) VALUES (?,?,?,?,?,?,1,?,?)',
      [name.trim(), email.toLowerCase().trim(), hash, role, JSON.stringify(extra_tabs||[]), JSON.stringify(denied_tabs||[]), req.adminUser.id, cm_staff_id||null]
    );
    await writeAudit(req.adminUser.id, req.adminUser.name, 'user_create', 'admin_users', String(r.insertId), {name, email, role}, req.ip);
    res.json({ ok: true, id: r.insertId });
  } catch(e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/admin/users/:id — update user ─────────────────────────────
app.patch('/api/admin/users/:id', requireAdminAuth, async (req, res) => {
  if (req.adminUser.role !== 'superadmin') return res.status(403).json({ error: 'Superadmin only' });
  const id = parseInt(req.params.id);
  // Prevent editing own record (except via change-password)
  if (id === req.adminUser.id) return res.status(403).json({ error: 'Cannot edit your own account here. Use Change Password.' });
  const { name, email, role, extra_tabs, denied_tabs, is_active, reset_password } = req.body;
  try {
    if (reset_password) {
      if (reset_password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
      const hash = await bcrypt.hash(reset_password, 12);
      await pool.execute('UPDATE admin_users SET password_hash=?, force_pw_change=1 WHERE id=?', [hash, id]);
      await writeAudit(req.adminUser.id, req.adminUser.name, 'password_reset', 'admin_users', String(id), null, req.ip);
    }
    await pool.execute(
      'UPDATE admin_users SET name=COALESCE(?,name), email=COALESCE(?,email), role=COALESCE(?,role), extra_tabs=COALESCE(?,extra_tabs), denied_tabs=COALESCE(?,denied_tabs), is_active=COALESCE(?,is_active) WHERE id=?',
      [name||null, email?email.toLowerCase().trim():null, role||null,
       extra_tabs!==undefined?JSON.stringify(extra_tabs):null,
       denied_tabs!==undefined?JSON.stringify(denied_tabs):null,
       is_active!==undefined?is_active:null, id]
    );
    await writeAudit(req.adminUser.id, req.adminUser.name, 'user_edit', 'admin_users', String(id), req.body, req.ip);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/admin/users/:id/sessions — revoke all sessions ───────────
app.delete('/api/admin/users/:id/sessions', requireAdminAuth, async (req, res) => {
  if (req.adminUser.role !== 'superadmin') return res.status(403).json({ error: 'Superadmin only' });
  await pool.execute('UPDATE admin_sessions SET revoked=1 WHERE user_id=?', [req.params.id]);
  await writeAudit(req.adminUser.id, req.adminUser.name, 'sessions_revoked', 'admin_users', req.params.id, null, req.ip);
  res.json({ ok: true });
});


// ── POST /api/admin/users/import — bulk import from CSV ──────────────────
app.post('/api/admin/users/import', requireAdminAuth, async (req, res) => {
  if (req.adminUser.role !== 'superadmin') return res.status(403).json({ error: 'Superadmin only' });
  const { users } = req.body;
  if (!Array.isArray(users) || !users.length) return res.status(400).json({ error: 'No users provided' });

  const validRoles = ['superadmin','ops_admin','finance','hr','viewer'];
  let created = 0, updated = 0;
  const errors = [];

  for (const u of users) {
    if (!u.name || !u.email || !u.password || !u.role) { errors.push('Missing fields for ' + (u.email||'unknown')); continue; }
    if (!validRoles.includes(u.role)) { errors.push('Invalid role for ' + u.email); continue; }
    if (u.password.length < 8) { errors.push('Password too short for ' + u.email); continue; }
    try {
      const hash = await bcrypt.hash(u.password, 12);
      const extra  = JSON.stringify(Array.isArray(u.extra_tabs)  ? u.extra_tabs  : []);
      const denied = JSON.stringify(Array.isArray(u.denied_tabs) ? u.denied_tabs : []);
      // Try insert — if duplicate email, update instead
      const [existing] = await pool.execute('SELECT id FROM admin_users WHERE email=?', [u.email.toLowerCase().trim()]);
      if (existing.length) {
        await pool.execute(
          'UPDATE admin_users SET name=?, password_hash=?, role=?, extra_tabs=?, denied_tabs=?, force_pw_change=1 WHERE id=?',
          [u.name.trim(), hash, u.role, extra, denied, existing[0].id]
        );
        updated++;
      } else {
        await pool.execute(
          'INSERT INTO admin_users (name,email,password_hash,role,extra_tabs,denied_tabs,force_pw_change,created_by) VALUES (?,?,?,?,?,?,1,?)',
          [u.name.trim(), u.email.toLowerCase().trim(), hash, u.role, extra, denied, req.adminUser.id]
        );
        created++;
      }
    } catch(e) {
      errors.push('Error for ' + u.email + ': ' + e.message);
    }
  }
  await writeAudit(req.adminUser.id, req.adminUser.name, 'bulk_import_users', 'admin_users', null,
    {created, updated, errors: errors.length}, req.ip);
  res.json({ created, updated, errors });
});

// ── GET /api/admin/audit-log ──────────────────────────────────────────────
app.get('/api/admin/audit-log', requireAdminAuth, async (req, res) => {
  if (!['superadmin','ops_admin'].includes(req.adminUser.role)) return res.status(403).json({ error: 'Not authorized' });
  try {
    const { user_id, action, limit: lim } = req.query;
    let sql = 'SELECT * FROM audit_log WHERE 1=1';
    const p = [];
    if (user_id) { sql += ' AND user_id=?'; p.push(user_id); }
    if (action)  { sql += ' AND action=?'; p.push(action); }
    sql += ' ORDER BY created_at DESC LIMIT ' + (parseInt(lim)||200);
    const [rows] = await pool.execute(sql, p);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Serve static files but block direct access to admin.html


// ════════════════════════════════════════════════════════════════════════════
// CM ATTENDANCE ENDPOINTS
// ════════════════════════════════════════════════════════════════════════════

// ── POST /api/cm/punch — clock in/out from mobile or laptop ──────────────
app.post('/api/cm/punch', async (req, res) => {
  try {
    const raw = req.cookies && req.cookies.adm_session;
    if (!raw) return res.status(401).json({ error: 'Not authenticated' });
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const [sess] = await pool.execute(
      `SELECT u.id, u.name, u.cm_staff_id, u.role, s.expires_at, s.revoked
       FROM admin_sessions s JOIN admin_users u ON s.user_id=u.id
       WHERE s.token_hash=? AND s.revoked=0 AND s.expires_at>NOW() LIMIT 1`, [hash]
    );
    if (!sess.length || sess[0].role !== 'cluster_manager')
      return res.status(403).json({ error: 'Not a cluster manager' });
    const cm = sess[0];
    if (!cm.cm_staff_id) return res.status(400).json({ error: 'No staff record linked' });

    const { station_code, punch_type, latitude, longitude, location_accuracy } = req.body;
    if (!station_code) return res.status(400).json({ error: 'station_code required' });
    if (!['CLOCK_IN','CLOCK_OUT'].includes(punch_type))
      return res.status(400).json({ error: 'punch_type must be CLOCK_IN or CLOCK_OUT' });

    // Verify station is assigned to this CM
    const [stCheck] = await pool.execute(
      'SELECT station_code FROM stations WHERE primary_cluster_manager=? AND LOWER(station_code)=LOWER(?) AND is_delete=0',
      [cm.cm_staff_id, station_code]
    );
    if (!stCheck.length) return res.status(403).json({ error: 'Station not in your scope' });

    // Determine source from accuracy
    let source = 'MOBILE';
    if (!latitude || !longitude) source = 'LAPTOP';
    else if (location_accuracy && location_accuracy > 500) source = 'LAPTOP';

    const ip = req.ip || req.connection.remoteAddress;
    await pool.execute(
      `INSERT INTO cm_attendance (cm_staff_id, cm_name, station_code, punch_type, punched_at, source, ip_address, latitude, longitude, location_accuracy)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [cm.cm_staff_id, cm.name, stCheck[0].station_code, punch_type, nowIST(), source, ip,
       latitude||null, longitude||null, location_accuracy||null]
    );

    await writeAudit(cm.id, cm.name, 'cm_attendance', 'cm_attendance', null,
      {punch_type, station_code, source}, ip);
    res.json({ ok: true, punch_type, station_code, source });
  } catch(e) { console.error('cm/punch:', e.message); res.status(500).json({ error: e.message }); }
});

// ── POST /api/cm/wh-punch — clock in/out from WH machine (CM session + machine token) ──
app.post('/api/cm/wh-punch', async (req, res) => {
  try {
    const raw = req.cookies && req.cookies.adm_session;
    if (!raw) return res.status(401).json({ error: 'Not authenticated' });
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const [sess] = await pool.execute(
      `SELECT u.id, u.name, u.cm_staff_id, u.role, s.expires_at, s.revoked
       FROM admin_sessions s JOIN admin_users u ON s.user_id=u.id
       WHERE s.token_hash=? AND s.revoked=0 AND s.expires_at>NOW() LIMIT 1`, [hash]
    );
    if (!sess.length || sess[0].role !== 'cluster_manager')
      return res.status(403).json({ error: 'Not a cluster manager' });
    const cm = sess[0];
    if (!cm.cm_staff_id) return res.status(400).json({ error: 'No staff record linked' });

    const { station_code, punch_type, machine_id } = req.body;
    if (!station_code || !punch_type || !machine_id)
      return res.status(400).json({ error: 'station_code, punch_type, machine_id required' });

    // Verify machine belongs to this station
    const [mach] = await pool.execute(
      'SELECT machine_id, station_code FROM config_machines WHERE machine_id=? AND LOWER(station_code)=LOWER(?) AND status="ACTIVE"',
      [machine_id, station_code]
    );
    if (!mach.length) return res.status(403).json({ error: 'Invalid machine for this station' });

    const ip = req.ip || req.connection.remoteAddress;
    await pool.execute(
      `INSERT INTO cm_attendance (cm_staff_id, cm_name, station_code, punch_type, punched_at, source, machine_id, ip_address)
       VALUES (?,?,?,?,?,?,?,?)`,
      [cm.cm_staff_id, cm.name, station_code, punch_type, nowIST(), 'WH_MACHINE', machine_id, ip]
    );

    await writeAudit(cm.id, cm.name, 'cm_attendance_wh', 'cm_attendance', null,
      {punch_type, station_code, machine_id}, ip);
    res.json({ ok: true, punch_type, station_code, source: 'WH_MACHINE' });
  } catch(e) { console.error('cm/wh-punch:', e.message); res.status(500).json({ error: e.message }); }
});

// ── GET /api/cm/attendance-today — today's CM attendance ─────────────────
app.get('/api/cm/attendance-today', requireAdminAuth, async (req, res) => {
  try {
    // Default to IST date (UTC+5:30) if not provided
  const date = req.query.date || nowIST().split(' ')[0];
    // CM can see their own; ops_admin/superadmin can see all or by station
    let sql, params;
    if (req.adminUser.role === 'cluster_manager') {
      const [userRow] = await pool.execute('SELECT cm_staff_id FROM admin_users WHERE id=?', [req.adminUser.id]);
      const staffId = userRow.length ? userRow[0].cm_staff_id : null;
      if (!staffId) return res.json([]);
      sql = `SELECT * FROM cm_attendance WHERE cm_staff_id=? AND DATE(punched_at)=? ORDER BY punched_at`;
      params = [staffId, date];
    } else if (['superadmin','ops_admin'].includes(req.adminUser.role)) {
      const { station, cm_staff_id } = req.query;
      sql = `SELECT * FROM cm_attendance WHERE DATE(punched_at)=?`;
      params = [date];
      if (station)     { sql += ' AND station_code=?'; params.push(station); }
      if (cm_staff_id) { sql += ' AND cm_staff_id=?';  params.push(cm_staff_id); }
      sql += ' ORDER BY punched_at';
    } else {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/cm/attendance-summary — all CMs attendance for overview ──────
app.get('/api/cm/attendance-summary', async (req, res) => {
  // Inline auth check (same pattern as attendance-overview)
  try {
    const raw = req.cookies && req.cookies.adm_session;
    if (!raw) return res.status(401).json({ error: 'Not authenticated' });
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const [srows] = await pool.execute(
      `SELECT u.id, u.role, u.is_active, s.expires_at, s.revoked
       FROM admin_sessions s JOIN admin_users u ON s.user_id=u.id
       WHERE s.token_hash=? AND s.revoked=0 AND s.expires_at>NOW() LIMIT 1`, [hash]
    );
    if (!srows.length || !srows[0].is_active) return res.status(401).json({ error: 'Invalid session' });
    if (!['superadmin','ops_admin'].includes(srows[0].role))
      return res.status(403).json({ error: 'Not authorized' });
  } catch(e) { return res.status(500).json({ error: e.message }); }
  try {
    // Default to IST date (UTC+5:30) if not provided
  const date = req.query.date || nowIST().split(' ')[0];
    // Get all CMs with their punches today
    const [rows] = await pool.execute(
      `SELECT a.cm_staff_id, a.cm_name,
              GROUP_CONCAT(DISTINCT a.station_code ORDER BY a.punched_at SEPARATOR ',') AS stations_visited,
              MIN(CASE WHEN a.punch_type='CLOCK_IN' THEN a.punched_at END) AS first_in,
              MAX(CASE WHEN a.punch_type='CLOCK_OUT' THEN a.punched_at END) AS last_out,
              SUM(CASE WHEN a.punch_type='CLOCK_IN' THEN 1 ELSE 0 END) AS clock_ins,
              GROUP_CONCAT(DISTINCT a.source ORDER BY a.punched_at SEPARATOR ',') AS sources
       FROM cm_attendance a
       WHERE DATE(a.punched_at)=?
       GROUP BY a.cm_staff_id, a.cm_name
       ORDER BY a.cm_name`,
      [date]
    );
    // Also get CMs with no punches today
    const [allCMs] = await pool.execute(
      `SELECT s.id AS cm_staff_id, TRIM(CONCAT(COALESCE(s.fname,''),' ',COALESCE(s.lname,''))) AS cm_name,
              GROUP_CONCAT(DISTINCT st.station_code ORDER BY st.station_code SEPARATOR ',') AS assigned_stations
       FROM staff s
       LEFT JOIN stations st ON st.primary_cluster_manager=s.id AND st.is_delete=0 AND st.status=0
       WHERE s.user_type=5 AND s.status=0 AND s.is_delete=0
       GROUP BY s.id`
    );
    const attendMap = {};
    rows.forEach(function(r){ attendMap[r.cm_staff_id] = r; });
    const result = allCMs.map(function(cm) {
      const att = attendMap[cm.cm_staff_id] || {};
      return {
        cm_staff_id:       cm.cm_staff_id,
        cm_name:           cm.cm_name,
        assigned_stations: cm.assigned_stations || '',
        stations_visited:  att.stations_visited || '',
        first_in:          att.first_in || null,
        last_out:          att.last_out || null,
        clock_ins:         att.clock_ins || 0,
        sources:           att.sources || '',
        present:           !!att.first_in
      };
    });
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// CM PORTAL — Landing page + WH bypass routes
// ════════════════════════════════════════════════════════════════════════════

// ── GET /cm — CM landing page (pick Admin or WH)
app.get('/cm', async (req, res) => {
  try {
    const raw = req.cookies && req.cookies.adm_session;
    if (!raw) return res.redirect('/admin/login');
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const [rows] = await pool.execute(
      `SELECT u.id, u.role, u.is_active, s.expires_at, s.revoked
       FROM admin_sessions s JOIN admin_users u ON s.user_id=u.id
       WHERE s.token_hash=? LIMIT 1`, [hash]
    );
    if (!rows.length || rows[0].revoked || new Date(rows[0].expires_at)<new Date() || !rows[0].is_active)
      return res.redirect('/admin/login');
    if (rows[0].role !== 'cluster_manager')
      return res.redirect('/admin'); // non-CM admins go straight to admin
    res.sendFile(path.join(__dirname,'public','cm_landing.html'));
  } catch(e) { res.redirect('/admin/login'); }
});

// ── POST /api/cm/wh-token — CM requests a short-lived WH token for a station
app.post('/api/cm/wh-token', async (req, res) => {
  try {
    const raw = req.cookies && req.cookies.adm_session;
    if (!raw) return res.status(401).json({ error: 'Not authenticated' });
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const [rows] = await pool.execute(
      `SELECT u.id, u.role, u.cm_staff_id, s.expires_at, s.revoked, u.is_active
       FROM admin_sessions s JOIN admin_users u ON s.user_id=u.id
       WHERE s.token_hash=? LIMIT 1`, [hash]
    );
    if (!rows.length || rows[0].revoked || new Date(rows[0].expires_at)<new Date() || !rows[0].is_active)
      return res.status(401).json({ error: 'Invalid session' });
    if (rows[0].role !== 'cluster_manager')
      return res.status(403).json({ error: 'Not a cluster manager' });

    const { station } = req.body;
    if (!station) return res.status(400).json({ error: 'station required' });

    // Verify station belongs to this CM
    const [stRows] = await pool.execute(
      'SELECT station_code FROM stations WHERE primary_cluster_manager=? AND LOWER(station_code)=LOWER(?) AND is_delete=0 AND status=0',
      [rows[0].cm_staff_id, station]
    );
    if (!stRows.length) return res.status(403).json({ error: 'Station not in your scope' });

    // Generate a short-lived one-time token (15 min)
    const token = crypto.randomBytes(24).toString('hex');
    const expires = new Date(Date.now() + 15*60*1000);
    await pool.execute(
      'INSERT INTO cm_wh_tokens (token, admin_user_id, station_code, expires_at) VALUES (?,?,?,?)',
      [token, rows[0].id, stRows[0].station_code, expires]
    );
    res.json({ ok: true, token, station: stRows[0].station_code });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/cm/verify-wh-token — WH portal calls this to verify CM token
app.get('/api/cm/verify-wh-token', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.json({ valid: false });
  try {
    const [rows] = await pool.execute(
      'SELECT station_code, admin_user_id FROM cm_wh_tokens WHERE token=? AND used=0 AND expires_at>NOW()',
      [token]
    );
    if (!rows.length) return res.json({ valid: false });
    // Mark token as used
    await pool.execute('UPDATE cm_wh_tokens SET used=1 WHERE token=?', [token]);
    res.json({ valid: true, station: rows[0].station_code, isCM: true });
  } catch(e) { res.json({ valid: false }); }
});

app.use(function(req, res, next) {
  var url = req.path.toLowerCase();
  // Block direct URL access to admin HTML — must go through /admin route (auth check)
  if (url === '/admin.html' || url === '/admin_login.html') {
    return res.redirect('/admin/login');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin/login', (req,res) => res.sendFile(path.join(__dirname,'public','admin_login.html')));
app.get('/admin', async (req,res) => {
  try {
    const raw = req.cookies && req.cookies.adm_session;
    if (!raw) return res.redirect('/admin/login');
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const [rows] = await pool.execute(
      'SELECT s.revoked, s.expires_at, u.is_active FROM admin_sessions s JOIN admin_users u ON s.user_id=u.id WHERE s.token_hash=? LIMIT 1',
      [hash]
    );
    if (!rows.length || rows[0].revoked || new Date(rows[0].expires_at)<new Date() || !rows[0].is_active)
      return res.redirect('/admin/login');
    res.sendFile(path.join(__dirname,'public','admin.html'));
  } catch(e) { res.redirect('/admin/login'); }
});
app.get('*',     (req,res) => res.sendFile(path.join(__dirname,'public','index.html')));
module.exports = app;