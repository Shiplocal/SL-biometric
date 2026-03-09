// CSV parsing runs in a Web Worker - UI stays fully responsive.
// Upload state persists in window._edspUploadState so admin
// can navigate to other tabs and come back to see live progress.

let _edspCycles = [];

// Persistent state - survives tab switches within the admin portal
if (!window._edspUploadState) {
  window._edspUploadState = {
    phase:         'idle',   // idle | parsing | parsed | uploading | done | error
    parsed:        null,     // { rowCount, dateFrom, dateTo, cycleLabel, stationCodes }
    uploadResult:  null,     // { inserted, periodLabel, cycleId }
    errorMsg:      '',
    parseProgress: { done: 0, total: 0 },
    file:          null      // File object held for upload after parse
  };
}

// -- Entry point -------------------------------------------
async function loadEdspTab() {
  await loadEdspCycles();
  renderEdspUploadForm();
  restoreEdspUploadState();   // re-paint whatever was in-progress
}

// -- Cycle list --------------------------------------------
async function loadEdspCycles() {
  try {
    const r = await fetch('/api/admin/edsp-cycles');
    _edspCycles = await r.json();
    renderCycleList();
  } catch(e) {
    const el = document.getElementById('edsp-cycle-list');
    if (el) el.innerHTML = '<p style="color:var(--danger);padding:12px">Failed to load cycles: ' + e.message + '</p>';
  }
}

function renderCycleList() {
  const el = document.getElementById('edsp-cycle-list');
  if (!el) return;
  if (!_edspCycles.length) {
    el.innerHTML = '<p style="color:var(--text-2);padding:12px 0">No EDSP cycles uploaded yet.</p>';
    return;
  }
  let html = '<table class="data-tbl" style="width:100%"><thead><tr>'
    + '<th>Cycle Label</th><th>Date From</th><th>Date To</th><th>Period Label</th>'
    + '<th style="text-align:center">Active</th><th style="text-align:center">Actions</th>'
    + '</tr></thead><tbody>';
  _edspCycles.forEach(function(c) {
    const isActive = c.is_active == 1;
    html += '<tr>'
      + '<td style="font-weight:500">' + escH(c.cycle_label) + '</td>'
      + '<td>' + fmtD(c.date_from) + '</td>'
      + '<td>' + fmtD(c.date_to) + '</td>'
      + '<td><span class="badge badge-blue">' + escH(c.period_label || '-') + '</span></td>'
      + '<td style="text-align:center">'
      + (isActive ? '<span class="badge badge-green">● Active</span>'
                  : '<span class="badge" style="background:#f1f5f9;color:#64748b">Inactive</span>')
      + '</td>'
      + '<td style="text-align:center">'
      + (isActive
          ? '<button class="btn btn-sm btn-outline" onclick="publishCycle(' + c.id + ',false)">Unpublish</button>'
          : '<button class="btn btn-sm btn-primary" onclick="publishCycle(' + c.id + ',true)">Publish</button>')
      + '</td></tr>';
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

// -- Upload form shell -------------------------------------
function renderEdspUploadForm() {
  const el = document.getElementById('edsp-upload-form');
  if (!el) return;
  el.innerHTML =
    '<div class="card" style="max-width:600px">'
    + '<div class="card-header">'
    + '<h3 class="card-title">Upload EDSP / AMX Data</h3>'
    + '<p style="color:var(--text-2);font-size:.82rem;margin-top:4px">'
    + 'Select a CSV - dates and period are detected automatically. '
    + 'You can navigate to other tabs while it processes and come back to check progress.'
    + '</p></div>'
    + '<div class="card-body" style="display:flex;flex-direction:column;gap:14px">'

    + '<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:10px 14px;font-size:.8rem;color:#0369a1">'
    + '<b>Expected columns:</b> '
    + '<span style="font-family:monospace;font-size:.75rem">station_code, name, report_date, shipment_type, '
    + 'final_delivery_count_excluding_swa_smd_smd2.0, final_creturn_count, overall_delivered_swa, '
    + 'overall_delivered_smd2.0, final_mfn_count, final_seller_returns</span>'
    + ' &nbsp;<a href="#" onclick="downloadEdspSample();return false;" '
    + 'style="color:#0369a1;font-weight:600;text-decoration:underline">Download sample CSV</a>'
    + '</div>'

    + '<div><label class="form-label">CSV File <span style="color:var(--danger)">*</span></label>'
    + '<input type="file" id="edsp-file-input" accept=".csv"'
    + ' style="display:block;width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem;background:#fff;cursor:pointer"'
    + ' onchange="onEdspFileChange(this)"></div>'

    + '<div id="edsp-status-area"></div>'

    + '<div id="edsp-preview-box" style="display:none;background:#f8fafc;border:1px solid var(--border);border-radius:8px;padding:12px 14px;font-size:.82rem;line-height:1.9">'
    + '<div style="font-weight:600;margin-bottom:6px;color:var(--text-1)">Detected from file:</div>'
    + '<div><span style="color:var(--text-2)">Date range:</span> <b id="prev-dates">-</b></div>'
    + '<div><span style="color:var(--text-2)">Cycle label:</span> <b id="prev-label">-</b></div>'
    + '<div><span style="color:var(--text-2)">Period matched:</span> <b id="prev-period" style="color:var(--primary)">checking…</b></div>'
    + '<div><span style="color:var(--text-2)">Rows:</span> <b id="prev-rows">-</b></div>'
    + '<div><span style="color:var(--text-2)">Stations:</span> <span id="prev-stations" style="color:var(--text-2)">-</span></div>'
    + '</div>'

    + '<div id="edsp-upload-error" style="display:none;font-size:.82rem;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 14px;color:var(--danger)"></div>'

    + '<div style="display:flex;gap:10px;align-items:center">'
    + '<button id="edsp-upload-btn" class="btn btn-primary" onclick="submitEdspUpload()" disabled>Upload &amp; Save</button>'
    + '<button id="edsp-reset-btn" class="btn btn-ghost btn-sm" onclick="resetEdspUpload()" style="display:none">&#x2715; Reset</button>'
    + '</div>'

    + '<div id="edsp-upload-result" style="display:none"></div>'
    + '</div></div>';
}


// -- Restore UI state when admin returns to this tab -------
function restoreEdspUploadState() {
  const s = window._edspUploadState;
  const resetBtn = document.getElementById('edsp-reset-btn');
  if (resetBtn) resetBtn.style.display = s.phase === 'idle' ? 'none' : 'inline-flex';

  if (s.phase === 'idle') return;

  if (s.phase === 'parsing') {
    showParseProgress(s.parseProgress.done, s.parseProgress.total);
  }
  if (s.phase === 'parsed' && s.parsed) {
    showEdspPreview(s.parsed);
  }
  if (s.phase === 'uploading') {
    showUploadingBanner();
    document.getElementById('edsp-upload-btn').disabled = true;
  }
  if (s.phase === 'done' && s.uploadResult) {
    showUploadDone(s.uploadResult);
  }
  if (s.phase === 'error') {
    showEdspError(s.errorMsg);
    if (s.parsed) showEdspPreview(s.parsed);
  }
}

// -- File picked - chunked async parse (no Worker needed) -
function onEdspFileChange(input) {
  const file = input.files[0];
  if (!file) return;

  resetEdspUpload();

  const s      = window._edspUploadState;
  s.phase      = 'parsing';
  s.file       = file;
  s.parseProgress = { done: 0, total: 0 };

  hideEdspError();
  document.getElementById('edsp-upload-btn').disabled = true;
  document.getElementById('edsp-preview-box').style.display = 'none';
  const rb = document.getElementById('edsp-reset-btn');
  if (rb) rb.style.display = 'inline-flex';

  showParseProgress(0, 0);

  const reader  = new FileReader();
  reader.onload = function(e) {
    const text    = e.target.result;
    const lines   = text.split(/\r?\n/).filter(function(l){ return l.trim(); });

    if (lines.length < 2) {
      s.phase = 'error'; s.errorMsg = 'CSV is empty or has no data rows';
      clearStatusArea(); showEdspError(s.errorMsg); return;
    }

    const headers    = lines[0].split(',').map(function(h){ return h.trim().toLowerCase().replace(/"/g,'').replace(/^\uFEFF/,''); });
    const dateIdx    = headers.findIndex(function(h){ return h==='delivery_date'||h==='report_date'; });
    const stationIdx = headers.findIndex(function(h){ return h==='station_code'||h==='station'; });

    if (dateIdx === -1) {
      s.phase = 'error';
      s.errorMsg = '<b>Date column not found in CSV.</b><br>'
        + 'Expected: <code>report_date</code> or <code>delivery_date</code><br>'
        + 'Columns found in your file: <code>' + headers.join(', ') + '</code><br>'
        + 'Check the column names match and re-upload. '
        + '<a href="#" onclick="downloadEdspSample();return false;" style="color:var(--danger);text-decoration:underline">Download sample CSV</a>';
      clearStatusArea(); showEdspError(s.errorMsg); return;
    }

    if (stationIdx === -1) {
      s.phase = 'error';
      s.errorMsg = '<b>Column <code>station_code</code> not found in CSV.</b><br>'
        + 'This column is required to assign data to stations.<br>'
        + 'Columns found in your file: <code>' + headers.join(', ') + '</code><br>'
        + '<a href="#" onclick="downloadEdspSample();return false;" style="color:var(--danger);text-decoration:underline">Download sample CSV</a>';
      clearStatusArea(); showEdspError(s.errorMsg); return;
    }

    const dataLines = lines.slice(1);
    const total     = dataLines.length;
    const dates     = [];
    const stations  = {};
    const CHUNK     = 1000;  // rows per tick - keeps UI responsive
    let   i         = 0;

    s.parseProgress = { done: 0, total: total };
    showParseProgress(0, total);

    function processChunk() {
      const end = Math.min(i + CHUNK, total);
      for (; i < end; i++) {
        const cols = dataLines[i].split(',');
        const d    = (cols[dateIdx]||'').trim().replace(/"/g,'');
        if (d) dates.push(d);
        if (stationIdx >= 0) {
          const sc = (cols[stationIdx]||'').trim().replace(/"/g,'').toUpperCase();
          if (sc) stations[sc] = 1;
        }
      }

      s.parseProgress = { done: i, total: total };
      showParseProgress(i, total);

      if (i < total) {
        // Yield to browser - lets UI update and user can navigate away
        setTimeout(processChunk, 0);
        return;
      }

      // Done - build result
      if (!dates.length) {
        s.phase = 'error'; s.errorMsg = 'No date values found in CSV';
        clearStatusArea(); showEdspError(s.errorMsg); return;
      }

      const sorted   = dates.slice().sort();
      const dateFrom = toIso(sorted[0]);
      const dateTo   = toIso(sorted[sorted.length - 1]);

      if (!dateFrom || !dateTo) {
        s.phase = 'error'; s.errorMsg = 'Could not parse date column - expected YYYY-MM-DD or DD-MM-YYYY';
        clearStatusArea(); showEdspError(s.errorMsg); return;
      }

      const cycleLabel = buildCycleLabel(dateFrom, dateTo);
      s.phase  = 'parsed';
      s.parsed = {
        rowCount: total, dateFrom: dateFrom, dateTo: dateTo,
        cycleLabel: cycleLabel, stationCodes: Object.keys(stations)
      };
      clearStatusArea();
      showEdspPreview(s.parsed);
    }

    setTimeout(processChunk, 0);
  };
  reader.readAsText(file);
}


// -- Status area helpers -----------------------------------
function showParseProgress(done, total) {
  const area = document.getElementById('edsp-status-area');
  if (!area) return;
  const pct  = total > 0 ? Math.round(done / total * 100) : 0;
  const dStr = done.toLocaleString('en-IN');
  const tStr = total > 0 ? total.toLocaleString('en-IN') : '…';
  area.innerHTML =
    '<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 14px">'
    + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'
    + '<div style="width:9px;height:9px;border-radius:50%;background:#f59e0b;animation:pulse 1.2s infinite;flex-shrink:0"></div>'
    + '<div style="font-size:.83rem;font-weight:600;color:#92400e">'
    + (total > 0 ? 'Scanning CSV - ' + pct + '%' : 'Reading file…')
    + '</div></div>'
    + '<div style="background:#fef3c7;border-radius:6px;height:8px;overflow:hidden;margin-bottom:8px">'
    + '<div style="height:8px;background:#f59e0b;border-radius:6px;width:' + pct + '%;transition:width .3s"></div>'
    + '</div>'
    + '<div style="font-size:.75rem;color:#92400e">'
    + (total > 0
        ? dStr + ' of ' + tStr + ' rows scanned'
        + ' &nbsp;·&nbsp; <b>You can switch tabs and come back - progress is saved</b>'
        : 'Loading file into memory…')
    + '</div></div>';
}

function showUploadingBanner() {
  const area = document.getElementById('edsp-status-area');
  if (!area) return;
  area.innerHTML =
    '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px 14px">'
    + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">'
    + '<div style="width:9px;height:9px;border-radius:50%;background:#3b82f6;animation:pulse 1.2s infinite;flex-shrink:0"></div>'
    + '<div style="font-size:.83rem;font-weight:600;color:#1e40af">Uploading to server and inserting rows…</div>'
    + '</div>'
    + '<div style="font-size:.75rem;color:#1e40af"><b>You can switch tabs and come back - upload continues in the background</b></div>'
    + '</div>';
}

function showUploadDone(result) {
  clearStatusArea();
  const resEl = document.getElementById('edsp-upload-result');
  if (resEl) {
    resEl.style.display = 'block';
    resEl.innerHTML =
      '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 14px;font-size:.83rem;line-height:1.9">'
      + '<div style="font-weight:600;color:#15803d;margin-bottom:4px">✓ Upload successful</div>'
      + '<div>' + Number(result.inserted).toLocaleString('en-IN') + ' rows inserted</div>'
      + '<div>Period tagged: <b>' + escH(result.periodLabel) + '</b></div>'
      + '<div>Cycle ID: ' + result.cycleId + '</div>'
      + '</div>';
  }
  const btn = document.getElementById('edsp-upload-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Upload & Save'; }
}

function clearStatusArea() {
  const area = document.getElementById('edsp-status-area');
  if (area) area.innerHTML = '';
}

// -- Preview box -------------------------------------------
async function showEdspPreview(parsed) {
  hideEdspError();
  const box = document.getElementById('edsp-preview-box');
  if (!box) return;
  box.style.display = 'block';
  document.getElementById('prev-dates').textContent = fmtD(parsed.dateFrom) + ' \u2192 ' + fmtD(parsed.dateTo);
  document.getElementById('prev-label').textContent = parsed.cycleLabel;
  document.getElementById('prev-rows').textContent  = parsed.rowCount.toLocaleString('en-IN') + ' rows';
  document.getElementById('prev-stations').textContent =
    parsed.stationCodes && parsed.stationCodes.length ? parsed.stationCodes.join(', ') : '(no station_code column)';
  document.getElementById('prev-period').textContent = 'checking…';
  document.getElementById('prev-period').style.color = 'var(--text-2)';
  try {
    const r       = await fetch('/api/admin/periods');
    const periods = await r.json();
    const match   = periods.find(function(p) {
      return p.period_start && p.period_end
        && new Date(p.period_start) <= new Date(parsed.dateTo)
        && new Date(p.period_end)   >= new Date(parsed.dateFrom);
    });
    if (match) {
      document.getElementById('prev-period').textContent = match.period_label + ' (matched)';
      document.getElementById('prev-period').style.color = 'var(--success, #16a34a)';
    } else {
      document.getElementById('prev-period').textContent = 'No match - will auto-create';
      document.getElementById('prev-period').style.color = 'var(--warning, #d97706)';
    }
  } catch(e) {
    document.getElementById('prev-period').textContent = 'Could not check';
    document.getElementById('prev-period').style.color = 'var(--danger)';
  }
  document.getElementById('edsp-upload-btn').disabled = false;
}

// -- Submit upload -----------------------------------------
async function submitEdspUpload() {
  const s = window._edspUploadState;
  if (!s.parsed || !s.file) return;

  const btn       = document.getElementById('edsp-upload-btn');
  btn.disabled    = true;
  btn.textContent = 'Uploading…';
  hideEdspError();
  document.getElementById('edsp-upload-result').style.display = 'none';

  s.phase = 'uploading';
  showUploadingBanner();

  try {
    const formData = new FormData();
    formData.append('file',       s.file);
    formData.append('dateFrom',   s.parsed.dateFrom);
    formData.append('dateTo',     s.parsed.dateTo);
    formData.append('cycleLabel', s.parsed.cycleLabel);

    const r    = await fetch('/api/admin/edsp-cycles/upload-direct', { method: 'POST', body: formData });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Upload failed');

    s.phase        = 'done';
    s.uploadResult = data;
    showUploadDone(data);

    document.getElementById('edsp-file-input').value  = '';
    document.getElementById('edsp-preview-box').style.display = 'none';
    await loadEdspCycles();

  } catch(e) {
    s.phase    = 'error';
    s.errorMsg = e.message;
    clearStatusArea();
    showEdspError(e.message);
    btn.disabled    = false;
    btn.textContent = 'Retry Upload';
  }
}

// -- Reset -------------------------------------------------
function resetEdspUpload() {
  window._edspUploadState = {
    phase:'idle', parsed:null, uploadResult:null,
    errorMsg:'', parseProgress:{done:0,total:0}, file:null
  };
  const fi = document.getElementById('edsp-file-input');    if (fi)  fi.value = '';
  const box = document.getElementById('edsp-preview-box');  if (box) box.style.display = 'none';
  const res = document.getElementById('edsp-upload-result');if (res) res.style.display = 'none';
  const btn = document.getElementById('edsp-upload-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Upload & Save'; }
  const rb = document.getElementById('edsp-reset-btn');     if (rb)  rb.style.display = 'none';
  clearStatusArea();
  hideEdspError();
}

// -- Publish / unpublish -----------------------------------
async function publishCycle(cycleId, publish) {
  try {
    const r = await fetch('/api/admin/edsp-cycles/publish', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({cycleId, publish})
    });
    if (!r.ok) throw new Error('Failed');
    await loadEdspCycles();
    toast(publish ? 'Cycle published - stations will see this data.' : 'Cycle unpublished.', publish ? 'success' : 'info');
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

// -- Sample CSV download -----------------------------------
function downloadEdspSample() {
  var headers = [
    'holder_employee_id','name','report_date','station_code',
    'sp_code','sp_name','shipment_type',
    'final_delivery_count_excluding_swa_smd_smd2.0',
    'final_creturn_count','overall_delivered_swa',
    'overall_delivered_smd2.0','final_mfn_count','final_seller_returns'
  ];
  var rows = [
    ['2000020000001','Ravi Kumar / SPVAN_AMDE / 200241001','01-01-2026','AMDE','SIPZ','Shiplocal Logistics Pvt. Ltd','Delivery','25','2','1','0','0','1'],
    ['2000020000002','Priya Singh / SPVAN_ANDD / 200241002','02-01-2026','ANDD','SIPZ','Shiplocal Logistics Pvt. Ltd','Delivery','18','0','2','0','0','0'],
    ['2000020000003','Arjun Patel / SPVAN_BDQE / 200241003','03-01-2026','BDQE','SIPZ','Shiplocal Logistics Pvt. Ltd','Pickup','0','5','0','0','0','0'],
  ];
  var csv = headers.join(',') + '\n';
  rows.forEach(function(r){ csv += r.join(',') + '\n'; });
  var blob = new Blob([csv], {type:'text/csv'});
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url; a.download = 'edsp_sample.csv';
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

// -- Helpers -----------------------------------------------
// Convert DD-MM-YYYY or YYYY-MM-DD to YYYY-MM-DD. Returns null if unparseable.
function toIso(s) {
  if (!s) return null;
  var p = s.trim().split('-');
  if (p.length !== 3) return null;
  if (p[0].length === 4) return s.trim();
  return p[2] + '-' + p[1].padStart(2,'0') + '-' + p[0].padStart(2,'0');
}
// Build a human-readable cycle label: "Feb 1-15 2025"
function buildCycleLabel(from, to) {
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var f = new Date(from), t = new Date(to);
  if (isNaN(f) || isNaN(t)) return from + ' - ' + to;
  if (f.getMonth() === t.getMonth() && f.getFullYear() === t.getFullYear())
    return months[f.getMonth()] + ' ' + f.getDate() + '-' + t.getDate() + ' ' + t.getFullYear();
  return months[f.getMonth()] + ' ' + f.getDate() + ' - ' + months[t.getMonth()] + ' ' + t.getDate() + ' ' + t.getFullYear();
}
function escH(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function fmtD(s) {
  if (!s) return '\u2014';
  const d = new Date(s);
  if (isNaN(d)) return s;
  return d.toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'});
}

function showEdspError(msg) {
  const el = document.getElementById('edsp-upload-error');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function hideEdspError() {
  const el = document.getElementById('edsp-upload-error');
  if (el) el.style.display = 'none';
}