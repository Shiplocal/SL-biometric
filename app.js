/**
 * ShipLocal Warehouse Portal - app.js v4.0
 * Modules: Biometric Attendance + KMS/IC + Attendance Period + Advances + Debit Flow
 */

const express  = require('express');
const mysql    = require('mysql2/promise');
const crypto   = require('crypto');
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

const app    = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(express.json({ limit: '5mb' }));

const pool = mysql.createPool({
  host: 'localhost', user: 'bifmein1_dbuser',
  password: '_VF&dOshcD_%J*gf', database: 'bifmein1_aiauto-biometric'
});

// Legacy DB - read-only, used for stations, staff, login
const legacyPool = mysql.createPool({
  host: 'localhost', user: 'bifmein1_aws2019',
  password: 'eA]n(gsN=[_2', database: 'bifmein1_nship24'
});

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
    const [r] = await legacyPool.execute(
      `SELECT REPLACE(REPLACE(station_code,CHAR(13),''),CHAR(10),'') AS station_code,
              TRIM(IFNULL(store_id,'')) AS store_name
       FROM stores WHERE is_delete=0 AND status=0
         AND REPLACE(REPLACE(station_code,CHAR(13),''),CHAR(10),'')!=''
       ORDER BY station_code`
    );
    res.json(r);
  } catch(e) { res.status(500).json({error:e.message}); }
})

app.post('/api/manager-login', async (req, res) => {
  const {station, password} = req.body;
  try {
    const [r] = await legacyPool.execute(
      `SELECT REPLACE(REPLACE(station_code,CHAR(13),''),CHAR(10),'') AS station_code
       FROM stores
       WHERE REPLACE(REPLACE(station_code,CHAR(13),''),CHAR(10),'')=?
         AND is_delete=0 AND status=0`,
      [station]
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

app.get('/api/staff/:station', async (req, res) => {
  try {
    const station = req.params.station;
    const SC = "REPLACE(REPLACE(s.station_code,CHAR(13),''),CHAR(10),'')";
    const [ics] = await legacyPool.execute(
      `SELECT u.id AS ic_id,
              TRIM(CONCAT(u.fname,' ',COALESCE(NULLIF(u.mname,''),''),' ',u.lname)) AS ic_name,
              ${SC} AS station_code
       FROM users u LEFT JOIN stores s ON s.id=u.store_id
       WHERE u.is_delete=0 AND u.status=0
         AND u.designation IN ('Delivery Associate','Station Associate','Station Incharge','Station Incahrge','Van Associate')
         AND ${SC}=?
       ORDER BY ic_name`, [station]
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
    const SC = "REPLACE(REPLACE(s.station_code,CHAR(13),''),CHAR(10),'')";
    // Fetch all three datasets in parallel instead of sequential giant IN clauses
    const [[ics], [bioRows], [accRows]] = await Promise.all([
      legacyPool.execute(
        `SELECT u.id AS ic_id,
                TRIM(CONCAT(u.fname,' ',COALESCE(NULLIF(u.mname,''),''),' ',u.lname)) AS ic_name,
                ${SC} AS station_code, u.status
         FROM users u LEFT JOIN stores s ON s.id=u.store_id
         WHERE u.is_delete=0
           AND u.designation IN ('Delivery Associate','Station Associate','Station Incharge','Station Incahrge','Van Associate')
         ORDER BY station_code, ic_name`
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
      is_active: ic.status === 0 ? 1 : 0,
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
      const [legIc] = await legacyPool.execute(
        "SELECT TRIM(CONCAT(fname,' ',COALESCE(NULLIF(mname,''),''),' ',lname)) AS ic_name FROM users WHERE id=?", [icId]
      ).catch(()=>[[]]);
      if (legIc.length) icName = legIc[0].ic_name.trim();
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

app.get('/api/violations', async (req, res) => {
  try {
    const {month, station, resolved} = req.query;
    let sql = 'SELECT * FROM attendance_violations';
    const p=[], wh=[];
    if (month){wh.push('month_year=?');p.push(month);}
    if (station){wh.push('station_code=?');p.push(station);}
    if (resolved!==undefined){wh.push('resolved=?');p.push(resolved==='true'?1:0);}
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
  // Filter to only rows that have a response filled in — New rows are categorised separately
  const filled = (rows||[]).filter(r => {
    if (r.subType === 'New') return false;
    return r.subType==='Final Loss' ? !!r.decision : !!(r.dispute||r.tt||r.orphan||r.remarks);
  });
  if (!filled.length) return res.status(400).json({error:'No completed responses to submit'});

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const r of filled) {
      const decision = r.subType==='Final Loss' ? (r.decision||'') : (r.dispute||'');
      await conn.execute(
        `INSERT INTO debit_responses
           (station_code,tid,sub_type,decision,tt_number,orphan_ref,remarks,submitted_by,period_label,verified_by)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           decision=VALUES(decision), tt_number=VALUES(tt_number),
           orphan_ref=VALUES(orphan_ref), remarks=VALUES(remarks),
           submitted_by=VALUES(submitted_by), submitted_at=NOW(),
           verified_by=VALUES(verified_by)`,
        [station, r.tid, r.subType||'', decision,
         r.tt||'', r.orphan||'', r.remarks||'', r.user||'Manager',
         periodLabel, verifiedBy||null]
      );
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
app.get('/api/admin/kms-report', async (req, res) => {
  const {period} = req.query;
  try {
    const [r] = await pool.execute('SELECT * FROM log_amx WHERE period_label=? ORDER BY station_code,amx_id', [period]);
    res.json(r);
  } catch(e) { res.status(500).json({error:'Failed'}); }
});

app.get('/api/admin/att-report', async (req, res) => {
  const {period} = req.query;
  try {
    const [r] = await pool.execute('SELECT l.station_code, l.ic_id, l.ic_name, p.period_label, COUNT(DISTINCT DATE(l.`timestamp`)) AS days_submitted FROM log_attendance_wh l JOIN config_period p ON DATE(l.`timestamp`) BETWEEN p.period_start AND p.period_end WHERE p.period_label=? AND l.punch_type=\'CLOCK_IN\' GROUP BY l.station_code,l.ic_id,l.ic_name,p.period_label ORDER BY l.station_code,l.ic_name', [period]);
    res.json(r);
  } catch(e) { res.status(500).json({error:'Failed'}); }
});

app.get('/api/admin/adv-report', async (req, res) => {
  const {period} = req.query;
  try {
    const [r] = await pool.execute('SELECT * FROM log_advances WHERE period_label=? ORDER BY station_code,ic_name', [period]);
    res.json(r);
  } catch(e) { res.status(500).json({error:'Failed'}); }
});

app.get('/api/admin/deb-report', async (req, res) => {
  const {month, station} = req.query;
  try {
    let sql = `SELECT d.tid, d.station_code, d.debit_date, d.bucket, d.loss_sub_bucket,
                      d.shipment_type, d.ic_name, d.amount, d.confirm_by,
                      d.cash_recovery_type, d.cm_confirm, d.publish_month,
                      r.decision, r.tt_number, r.orphan_ref,
                      r.remarks, r.submitted_at, r.sub_type, r.verified_by
               FROM debit_data d
               JOIN debit_responses r ON r.tid = d.tid AND r.station_code = d.station_code
               WHERE 1=1`;
    const params = [];
    if (month)   { sql += ' AND d.publish_month=?';   params.push(month); }
    if (station) { sql += ' AND d.station_code=?';    params.push(station); }
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

app.get('/api/admin/submission-status', async (req, res) => {
  const {period} = req.query;
  try {
    // Primary: get stations from legacy stores table
    let stationCodes = [];
    try {
      const [rows] = await legacyPool.execute(
        `SELECT REPLACE(REPLACE(station_code,CHAR(13),''),CHAR(10),'') AS station_code
         FROM stores WHERE is_delete=0 AND status=0
           AND REPLACE(REPLACE(station_code,CHAR(13),''),CHAR(10),'')!=''
         ORDER BY station_code`
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
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const period = await getActivePeriod();
    // All staff grouped by station from legacy DB
    const SC = "REPLACE(REPLACE(s.station_code,CHAR(13),''),CHAR(10),'')";
    const [[staffRows], [clockIns], [openShifts]] = await Promise.all([
      legacyPool.execute(
        `SELECT u.id AS ic_id, TRIM(CONCAT(u.fname,' ',COALESCE(NULLIF(u.mname,''),''),' ',u.lname)) AS ic_name,
                ${SC} AS station_code
         FROM users u LEFT JOIN stores s ON s.id=u.store_id
         WHERE u.is_delete=0 AND u.status=0
           AND u.designation IN ('Delivery Associate','Station Associate','Station Incharge','Station Incahrge','Van Associate')`
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

app.delete('/api/admin/debit-data/:id', async (req, res) => {
  try { await pool.execute('DELETE FROM debit_data WHERE id=?', [req.params.id]); res.json({success:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/admin/debit-data/single', async (req, res) => {
  const {tid, station_code, impact_date, loss_bucket, loss_sub_bucket, shipment_type,
         cluster, ic_name, value, confirm_by, cash_recovery_type, cm_confirm,
         sub_type, remarks} = req.body;
  if (!tid || !station_code) return res.status(400).json({error:'tid and station_code required'});
  function toYMD(s) { if(!s) return null; const p=s.trim().split('-'); if(p.length!==3) return null; if(p[0].length===4) return s; return `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`; }
  try {
    await pool.execute(
      `INSERT INTO debit_data (tid,station_code,debit_date,bucket,loss_sub_bucket,shipment_type,
         cluster,ic_name,amount,confirm_by,cash_recovery_type,cm_confirm,sub_type,remarks,status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft')
       ON DUPLICATE KEY UPDATE debit_date=VALUES(debit_date),bucket=VALUES(bucket),
         loss_sub_bucket=VALUES(loss_sub_bucket),shipment_type=VALUES(shipment_type),
         cluster=VALUES(cluster),ic_name=VALUES(ic_name),amount=VALUES(amount),
         confirm_by=VALUES(confirm_by),cash_recovery_type=VALUES(cash_recovery_type),
         cm_confirm=VALUES(cm_confirm),sub_type=VALUES(sub_type),remarks=VALUES(remarks)`,
      [tid.trim(), station_code.toUpperCase().trim(), toYMD(impact_date),
       loss_bucket||'', loss_sub_bucket||null, shipment_type||null,
       cluster||null, ic_name||null, parseFloat(value)||0,
       confirm_by||'', cash_recovery_type||null, cm_confirm||null,
       (['Final Loss','New'].includes(sub_type) ? sub_type : 'New'), remarks||null]
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
    if (status)  { sql += ' AND d.status=?';       params.push(status); }
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

// WH debit history — answered items for this station, last 6 months, joined with responses
app.get('/api/deb-history/:station', async (req, res) => {
  const station = req.params.station;
  try {
    const [rows] = await pool.execute(
      `SELECT d.id, d.tid, d.debit_date, d.bucket, d.loss_sub_bucket, d.shipment_type,
              d.ic_name, d.amount, d.confirm_by, d.cash_recovery_type, d.cm_confirm,
              d.publish_month, d.published_at, d.sub_type,
              r.decision, r.tt_number, r.orphan_ref, r.remarks AS wh_remarks,
              r.submitted_at
       FROM debit_data d
       JOIN debit_responses r ON r.tid = d.tid AND r.station_code = d.station_code
       WHERE d.station_code = ?
         AND d.status = 'answered'
         AND d.published_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
       ORDER BY d.published_at DESC, d.tid`,
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
  const headers  = ['tid','impact_date','loss_bucket','loss_sub_bucket','shipment_type','station','cluster','user_name','value','confirm_by','cash_recovery_type','cm_confirm','debit_type','remarks'];
  const example1 = ['365433739065','03-12-2025','Ageing','Shipment Not Departed','Delivery','ANDD','GJ','Rahul Sharma','1190.00','Amitbhai','IC Payment','YES','Final Loss','Confirmed by CM'];
  const example2 = ['629518827741','26-01-2026','WRTS but MDR','Wrong Photo at RTS','ReturnPickup','VDDA','GJ','Harendra Sahu','2111.00','Amitbhai','SHIP BANK','NO','New','WH to categorise as Recovery or Case Open'];
  const notes = [
    'Tracking ID (required) — numeric, or Short Cash / Penalty for non-TID entries',
    'DD-MM-YYYY format (required)',
    'Ageing / Package Loss / WRTS but MDR / SLP Mail / Panalty',
    'Sub-category free text e.g. Shipment Not Departed',
    'Delivery / ReturnPickup / MFN',
    'Station code e.g. ANDD (required)',
    'Cluster / region code e.g. GJ, MH (optional)',
    'IC or DA name responsible for the loss',
    'Amount in ₹ — no commas e.g. 1801.85 (required)',
    'Name of manager / AM confirming the debit note',
    'IC Payment / SHIP BANK / CASH',
    'YES or NO — CM / Manager confirmation',
    'Ignored on upload — all CSV entries are created as New by default. Mark as Final Loss individually in the admin queue after upload.',
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
      const p = s.trim().split('-');
      if(p.length!==3) return s.trim();
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
    function normAmt(s){ if(!s) return 0; return parseFloat(String(s).replace(/,/g,'')) || 0; }

    const raw = csv.parse(content, {columns:true, skip_empty_lines:true, to:500});
    const junkTids = new Set(['tid','tracking id (required)','tracking id']);
    const rows = raw
      .filter(r => {
        const t = normTid(r['tid']||'').toLowerCase();
        return t && !junkTids.has(t) && !t.startsWith('. column');
      })
      .map(r => ({
        tid:            normTid(r['tid']||''),
        station:        (r['station']||r['station_code']||'').toUpperCase().trim(),
        impact_date:    toYMD(r['impact_date']||''),
        loss_bucket:    r['loss_bucket'] || '',
        loss_sub_bucket:r['loss_sub_bucket'] || '',
        shipment_type:  r['shipment_type'] || '',
        cluster:        r['cluster'] || r['Cluster'] || '',
        ic_name:        r['user_name'] || r['ic_name'] || '',
        amount:         normAmt(r['value'] || r['amount'] || '0'),
        confirm_by:     r['confirm_by'] || '',
        cash_recovery_type: r['cash_recovery_type'] || '',
        cm_confirm:     r['cm_confirm'] || '',
        remarks:        r['remarks'] || r['Remarks'] || '',
      }))
      .filter(r => r.tid && r.station);

    res.json({success:true, rows});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── DEBIT IMPORT ROWS — accepts pre-parsed (possibly edited) JSON rows ──
app.post('/api/admin/debit-import-rows', async (req, res) => {
  const {rows} = req.body;
  if (!rows||!rows.length) return res.status(400).json({error:'No rows'});
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  let inserted=0, skipped=0, firstError=null;
  for (const r of rows) {
    if (!r.tid || !r.station) { skipped++; continue; }
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
        [r.tid, r.station, r.impact_date||null, r.loss_bucket||'', r.loss_sub_bucket||null,
         r.shipment_type||null, r.cluster||null, r.ic_name||null, r.amount||0,
         r.confirm_by||'', r.cash_recovery_type||null, r.cm_confirm||null, 'New', r.remarks||null]
      );
      inserted++;
    } catch(e2) { skipped++; firstError = firstError || `${e2.message} [tid=${r.tid}]`; }
  }
  await conn.commit();
  conn.release();
  res.json({success:true, inserted, skipped, firstError});
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
app.get('/api/enroll-pending', async (req, res) => {
  try { const [r] = await pool.execute("SELECT * FROM biometric_vault WHERE enroll_status='PENDING' ORDER BY enrolled_at DESC"); res.json(r); }
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


app.get('/api/admin/recent-submissions', async (req, res) => {
  try {
    const [r] = await pool.execute(
      `SELECT station_code, module, period_label, status, submitted_at
       FROM config_status WHERE status='SUBMITTED'
       ORDER BY submitted_at DESC LIMIT 50`
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
app.get('/api/admin/kms-summary', async (req, res) => {
  try {
    const {cycleId} = req.query;
    if (!cycleId) return res.status(400).json({error:'cycleId required'});

    // period_label from active config_period (log_amx has no cycle_id column)
    const periodLabel = (await getActivePeriod()).period_label;

    // Single query: total groups per station for this cycle
    const [totals] = await pool.execute(
      `SELECT station_code, COUNT(DISTINCT CONCAT(amx_id,'_',delivery_date)) AS total
       FROM edsp_data WHERE cycle_id=? GROUP BY station_code ORDER BY station_code`,
      [cycleId]
    );
    // Single query: submitted groups per station for this period
    const [subs] = await pool.execute(
      `SELECT station_code, COUNT(DISTINCT CONCAT(amx_id,'_',delivery_date)) AS submitted
       FROM log_amx WHERE period_label=? GROUP BY station_code`,
      [periodLabel]
    );
    // Single query: KMS submission status per station
    const [statuses] = await pool.execute(
      `SELECT station_code, status FROM config_status WHERE module='KMS' AND period_label=?`,
      [periodLabel]
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
    const [[s]] = await legacyPool.execute('SELECT COUNT(*) AS c FROM stores WHERE is_delete=0');
    const [[i]] = await legacyPool.execute('SELECT COUNT(*) AS c FROM config_whic WHERE is_active=1').catch(()=>[[{c:0}]]);
    const [[u]] = await legacyPool.execute('SELECT COUNT(*) AS c FROM users WHERE status=0').catch(()=>[[{c:0}]]);
    res.json({connected:true, stores:s.c, ics:i.c, users:u.c});
  } catch(e) { res.json({connected:false, error:e.message}); }
});
app.get('/api/legacy/stations', async (req, res) => {
  try { const [r] = await legacyPool.execute('SELECT station_code,store_id AS store_name,state,status FROM stores WHERE is_delete=0 ORDER BY station_code LIMIT 500'); res.json(r); }
  catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/api/legacy/ics', async (req, res) => {
  try {
    const q = req.query.q ? '%'+req.query.q+'%' : '%';
    const [r] = await legacyPool.execute('SELECT ic_id,ic_name,station_code,enrollment_status,is_active FROM config_whic WHERE (ic_id LIKE ? OR ic_name LIKE ?) LIMIT 500', [q,q]);
    res.json(r);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/api/legacy/users', async (req, res) => {
  try {
    const q = req.query.q ? '%'+req.query.q+'%' : '%';
    const [r] = await legacyPool.execute('SELECT id,CONCAT(fname," ",lname) AS name,mobile,email,status FROM users WHERE (fname LIKE ? OR lname LIKE ? OR mobile LIKE ?) LIMIT 500', [q,q,q]);
    res.json(r);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/api/legacy/managers', async (req, res) => {
  try { const [r] = await legacyPool.execute('SELECT id,CONCAT(fname," ",lname) AS name,mobile,station_code FROM users WHERE user_type=2 AND status=0 LIMIT 200'); res.json(r); }
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
  await addCol("ALTER TABLE debit_data ADD COLUMN ic_name VARCHAR(100) DEFAULT NULL");
  await addCol("ALTER TABLE debit_data ADD COLUMN cash_recovery_type VARCHAR(50) DEFAULT NULL");
  await addCol("ALTER TABLE debit_data ADD COLUMN cm_confirm VARCHAR(10) DEFAULT NULL");
  await addCol("ALTER TABLE debit_data ADD COLUMN cluster VARCHAR(20) DEFAULT NULL");
  await addCol("ALTER TABLE debit_data ADD COLUMN sub_type VARCHAR(50) DEFAULT NULL");
  await addCol("ALTER TABLE debit_data ADD COLUMN remarks TEXT DEFAULT NULL");
  await addCol("ALTER TABLE debit_data ADD COLUMN confirm_by VARCHAR(100) DEFAULT NULL");
  await addCol("ALTER TABLE debit_responses ADD COLUMN verified_by VARCHAR(100) DEFAULT NULL");
  await addCol("ALTER TABLE log_advances ADD COLUMN verified_by VARCHAR(100) DEFAULT NULL");
  console.log('Migrations done.');
})().catch(e => console.error('Migration error:', e.message));


app.get('/api/shift-status-batch/:station', async (req, res) => {
  try {
    const station = req.params.station;
    // Get all staff IDs for this station from legacy DB
    const SC = "REPLACE(REPLACE(s.station_code,CHAR(13),''),CHAR(10),'')";
    const [staff] = await legacyPool.execute(
      `SELECT u.id AS ic_id FROM users u LEFT JOIN stores s ON s.id=u.store_id
       WHERE u.is_delete=0 AND u.status=0
         AND u.designation IN ('Delivery Associate','Station Associate','Station Incharge','Station Incahrge','Van Associate')
         AND ${SC}=?`, [station]
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

app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (req,res) => res.sendFile(path.join(__dirname,'public','admin.html')));
app.get('*',     (req,res) => res.sendFile(path.join(__dirname,'public','index.html')));
module.exports = app;