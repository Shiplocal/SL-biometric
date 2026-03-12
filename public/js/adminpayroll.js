// ── Payroll Tab — restricted access ─────────────────────────────────────────

let _payrollClickCount = 0;
let _payrollClickTimer = null;
let _payrollUnlocked = false;
let _payrollStaffData = [];

// Triple-click on period badge to trigger unlock
function _payrollUnlockClick() {
  _payrollClickCount++;
  clearTimeout(_payrollClickTimer);
  _payrollClickTimer = setTimeout(() => { _payrollClickCount = 0; }, 600);
  if (_payrollClickCount >= 3) {
    _payrollClickCount = 0;
    if (_payrollUnlocked) {
      // Already unlocked — just switch to tab
      sw('t-payroll'); loadPayrollTab();
    } else {
      _payrollPromptPassword();
    }
  }
}

function _payrollPromptPassword() {
  // Build inline prompt modal
  const existing = document.getElementById('payroll-lock-modal');
  if (existing) { existing.classList.remove('hidden'); return; }

  const modal = document.createElement('div');
  modal.id = 'payroll-lock-modal';
  modal.className = 'modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="background:var(--card);border-radius:14px;padding:32px;width:340px;box-shadow:0 20px 60px rgba(0,0,0,.25)">
      <div style="font-size:1.1rem;font-weight:700;color:var(--navy);margin-bottom:6px">🔒 Payroll Access</div>
      <div style="font-size:.82rem;color:var(--text-2);margin-bottom:20px">Enter payroll password to continue</div>
      <input type="password" id="payroll-pw-input" placeholder="Password"
        style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:.9rem;font-family:inherit;margin-bottom:12px;box-sizing:border-box"
        onkeydown="if(event.key==='Enter')_payrollSubmitPassword()">
      <div id="payroll-pw-err" style="font-size:.78rem;color:var(--red-d);min-height:18px;margin-bottom:10px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" onclick="_payrollClosePrompt()">Cancel</button>
        <button class="btn btn-green btn-sm" onclick="_payrollSubmitPassword()">Unlock →</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  setTimeout(() => document.getElementById('payroll-pw-input')?.focus(), 100);
}

async function _payrollSubmitPassword() {
  const pw = document.getElementById('payroll-pw-input')?.value || '';
  const err = document.getElementById('payroll-pw-err');
  if (!pw) return;

  try {
    const r = await fetch('/api/admin/payroll-verify', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({password: pw})
    });
    const d = await r.json();
    if (d.ok) {
      _payrollUnlocked = true;
      sessionStorage.setItem('payroll_unlocked', '1');
      _payrollClosePrompt();
      // Show tab and navigate
      const tab = document.getElementById('tab-t-payroll');
      if (tab) tab.style.display = '';
      sw('t-payroll');
      loadPayrollTab();
    } else {
      if (err) err.textContent = 'Incorrect password.';
      const inp = document.getElementById('payroll-pw-input');
      if (inp) { inp.value = ''; inp.focus(); }
    }
  } catch(e) {
    if (err) err.textContent = 'Error — try again.';
  }
}

function _payrollClosePrompt() {
  const modal = document.getElementById('payroll-lock-modal');
  if (modal) modal.remove();
}

// Restore session if already unlocked
(function() {
  if (sessionStorage.getItem('payroll_unlocked') === '1') {
    _payrollUnlocked = true;
    const tab = document.getElementById('tab-t-payroll');
    if (tab) tab.style.display = '';
  }
})();

// ── Sub-tab switcher ─────────────────────────────────────
function paySubTab(t) {
  ['staff','payroll','kms','petrol'].forEach(s => {
    const panel = document.getElementById('pay-panel-' + s);
    const btn   = document.getElementById('pay-sub-' + s);
    if (panel) panel.style.display = s === t ? 'block' : 'none';
    if (btn)   btn.classList.toggle('active', s === t);
  });
  if (t === 'staff') loadPayrollStaff();
  if (t === 'kms')   _edspLoadPeriods();
}

// ── Load payroll tab ─────────────────────────────────────
function loadPayrollTab() {
  // Populate station filter
  const sel = document.getElementById('pay-station-filter');
  if (sel && sel.options.length === 1 && (window._stations||[]).length) {
    window._stations.forEach(s => {
      sel.innerHTML += `<option value="${(s.station_code||'').trim()}">${(s.station_code||'').trim()} — ${(s.store_name||'').trim()}</option>`;
    });
  }
  paySubTab('staff');
}

// ── Load staff payroll data ───────────────────────────────
async function loadPayrollStaff() {
  const body  = document.getElementById('pay-staff-body');
  const count = document.getElementById('pay-staff-count');
  if (!body) return;
  body.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:20px;color:var(--text-3)">Loading…</td></tr>';

  const station  = document.getElementById('pay-station-filter')?.value || '';
  const userType = document.getElementById('pay-type-filter')?.value || '';
  const qp = new URLSearchParams();
  if (station)  qp.set('station', station);
  if (userType) qp.set('user_type', userType);

  try {
    _payrollStaffData = await fetch('/api/admin/payroll-staff?' + qp).then(r=>r.json());
    if (count) count.textContent = _payrollStaffData.length;
    if (!_payrollStaffData.length) {
      body.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:20px;color:var(--text-3)">No staff found</td></tr>';
      return;
    }
    body.innerHTML = _payrollStaffData.map(r => `
      <tr>
        <td>${escH(r.store_name)}</td>
        <td><span class="mono" style="font-size:.75rem">${escH(r.station_code)}</span></td>
        <td style="font-family:monospace">${r.id}</td>
        <td style="font-weight:500">${escH(r.full_name)}</td>
        <td style="text-align:right">${r.ctc ? '₹'+escH(r.ctc) : '—'}</td>
        <td style="font-family:monospace;font-size:.75rem">${escH(r.pan_card_number)||'—'}</td>
        <td style="font-size:.75rem">${escH(r.user_type)}</td>
        <td style="font-size:.75rem">${escH(r.cluster_manager)||'—'}</td>
        <td style="font-family:monospace;font-size:.75rem">${escH(r.ifsc_code)||'—'}</td>
        <td style="font-family:monospace;font-size:.75rem">${escH(r.account_no)||'—'}</td>
      </tr>`).join('');
  } catch(e) {
    body.innerHTML = `<tr><td colspan="10" style="text-align:center;color:var(--red-d);padding:20px">Error: ${e.message}</td></tr>`;
  }
}

// ── Export to Excel ───────────────────────────────────────
function exportPayrollExcel() {
  if (!_payrollStaffData.length) { toast('No data to export.', 'warning'); return; }

  // Build workbook using SheetJS
  const headers = ['Store Name','Station','ID','Full Name','CTC','PAN','Role','Cluster Manager','IFSC','Account No'];
  const rows = _payrollStaffData.map(r => [
    r.store_name, r.station_code, r.id, r.full_name,
    r.ctc, r.pan_card_number, r.user_type, r.cluster_manager,
    r.ifsc_code, r.account_no
  ]);

  const ws_data = [headers, ...rows];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(ws_data);

  // Force account_no and id columns as text to preserve leading zeros
  const accountCol = 9; // column J (0-indexed)
  rows.forEach((row, ri) => {
    const cellRef = XLSX.utils.encode_cell({r: ri+1, c: accountCol});
    if (ws[cellRef]) {
      ws[cellRef].t = 's'; // force string type
      ws[cellRef].z = '@'; // text format
    }
    // Also force ID column as number (col C)
    const idRef = XLSX.utils.encode_cell({r: ri+1, c: 2});
    if (ws[idRef]) ws[idRef].t = 'n';
  });

  // Set column widths
  ws['!cols'] = [
    {wch:20},{wch:10},{wch:8},{wch:28},{wch:10},
    {wch:14},{wch:22},{wch:24},{wch:14},{wch:20}
  ];

  const station = document.getElementById('pay-station-filter')?.value || 'All';
  const date = new Date().toISOString().substring(0,10);
  XLSX.utils.book_append_sheet(wb, ws, 'Staff Payroll');
  XLSX.writeFile(wb, `Payroll_${station}_${date}.xlsx`);
  toast(`Exported ${_payrollStaffData.length} records ✓`, 'success');
}

// ── Historical EDSP / KMS Upload ─────────────────────────────────────────────

let _edspPendingFile = null;
let _edspPreviewData = null;

function _edspDrop(e) {
  e.preventDefault();
  document.getElementById('edsp-dropzone').style.borderColor = 'var(--border)';
  const file = e.dataTransfer.files[0];
  if (file) _edspFileChosen(file);
}

function _edspFileChosen(file) {
  if (!file || !file.name.endsWith('.xlsx')) {
    toast('Please select an .xlsx file', 'warning'); return;
  }
  // Show loading state immediately, then parse async after UI renders
  const preview = document.getElementById('edsp-preview');
  const body    = document.getElementById('edsp-preview-body');
  if (preview) preview.style.display = 'block';
  if (body)    body.innerHTML = '<div style="color:var(--text-3)">📂 Reading file — this may take a few seconds for large files…</div>';
  setTimeout(() => _edspRunPreview(file), 50);
}

// Parse XLSX file in browser using SheetJS, return clean rows array
function _edspParseXlsx(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, {type:'array', cellDates:true});
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, {defval:null});
        const san = v => (v == null ? '' : String(v).replace(/\r/g,'').replace(/\n/g,'').trim());
        const parsed = [];
        for (const row of raw) {
          const ic_id        = parseInt(row['ID']) || null;
          const ic_name      = san(row['NAME '] || row['Name'] || row['NAME']);
          const amx_id       = san(row['holder_employee_id']);
          const station_code = san(row['station_code']).toUpperCase();
          const shipType     = san(row['shipment_type']);
          let dDate = row['report_date'];
          if (dDate instanceof Date) {
            // Use local date parts to avoid UTC timezone shift
            const y = dDate.getFullYear();
            const m = String(dDate.getMonth()+1).padStart(2,'0');
            const d2 = String(dDate.getDate()).padStart(2,'0');
            dDate = y+'-'+m+'-'+d2;
          } else dDate = san(dDate).substring(0,10);
          if (!dDate || dDate === '0000-00-00' || !station_code || !amx_id) continue;
          let parcel_type = shipType === 'Delivery' ? 'Delivery'
                          : shipType === 'ReturnPickup' ? 'ReturnPickup'
                          : shipType === 'MFNPickup'    ? 'MFNPickup'
                          : (shipType || 'Delivery');
          parsed.push({
            ic_id, ic_name, amx_id, station_code, dDate, parcel_type,
            delivered: parseInt(row['final_delivery_count_excluding_swa_smd_smd2.0']) || 0,
            pickup:    parseInt(row['final_creturn_count']) || 0,
            swa:       parseInt(row['overall_delivered_swa']) || 0,
            smd:       parseInt(row['overall_delivered_smd2.0']) || 0,
            mfn:       parseInt(row['final_mfn_count']) || 0,
            returns:   parseInt(row['final_seller_returns']) || 0
          });
        }
        resolve(parsed);
      } catch(e) { reject(e); }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

async function _edspRunPreview(file) {
  const preview = document.getElementById('edsp-preview');
  const body    = document.getElementById('edsp-preview-body');
  const result  = document.getElementById('edsp-result');
  if (result) result.style.display = 'none';

  preview.style.display = 'block';

  try {
    const parsed = await _edspParseXlsx(file);
    _edspPendingFile = parsed; // store parsed rows, not raw file

    const r = await fetch('/api/admin/upload-historical-edsp', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({rows: parsed, preview: true})
    });
    const d = await r.json();
    if (!d.ok) { body.innerHTML = `<span style="color:var(--red-d)">Error: ${escH(d.error)}</span>`; return; }
    _edspPreviewData = d;

    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 20px">
        <div><span style="color:var(--text-3)">Period label:</span> <strong>${escH(d.period_label)}</strong></div>
        <div><span style="color:var(--text-3)">Date range:</span> <strong>${d.date_from} → ${d.date_to}</strong></div>
        <div><span style="color:var(--text-3)">Rows to insert:</span> <strong>${d.rows}</strong></div>
        <div><span style="color:var(--text-3)">Unique ICs:</span> <strong>${d.ic_count}</strong></div>
        <div style="grid-column:1/-1"><span style="color:var(--text-3)">Stations (${d.stations.length}):</span>
          <span style="font-family:monospace;font-size:.75rem">${d.stations.join(', ')}</span>
        </div>
      </div>
      <div style="margin-top:10px;padding:8px 12px;background:var(--amber-l,#fff8e1);border-radius:8px;color:var(--amber-d,#b45309);font-size:.75rem">
        ⚠ KMS will be set to 0 for all rows. Upload the KMS file separately to patch values.
      </div>`;
  } catch(e) {
    body.innerHTML = `<span style="color:var(--red-d)">Error: ${e.message}</span>`;
  }
}

async function _edspConfirmUpload() {
  if (!_edspPendingFile || !_edspPreviewData) return;
  const btn = document.getElementById('edsp-confirm-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Uploading…'; }

  // Show row count so user knows it's working
  const body = document.getElementById('edsp-preview-body');
  if (body) body.innerHTML += `<div style="margin-top:8px;color:var(--text-3);font-size:.75rem">
    ⏳ Sending ${_edspPendingFile.length.toLocaleString()} rows to server — please wait…</div>`;

  try {
    const r = await fetch('/api/admin/upload-historical-edsp', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({rows: _edspPendingFile})
    });
    const d = await r.json();
    const result = document.getElementById('edsp-result');
    const preview = document.getElementById('edsp-preview');
    preview.style.display = 'none';
    result.style.display = 'block';

    if (d.ok) {
      result.innerHTML = `
        <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:14px">
          <div style="font-weight:600;color:#15803d;margin-bottom:6px">✅ Upload successful</div>
          <div>Period: <strong>${escH(d.period_label)}</strong> &nbsp;|&nbsp;
               Inserted: <strong>${d.inserted}</strong> rows &nbsp;|&nbsp;
               Skipped: <strong>${d.skipped}</strong> duplicates</div>
        </div>`;
      _edspReset();
      _edspLoadPeriods();
    } else {
      result.innerHTML = `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:14px;color:var(--red-d)">
        ❌ Error: ${escH(d.error)}</div>`;
      if (btn) { btn.disabled = false; btn.textContent = '✓ Confirm Upload'; }
    }
  } catch(e) {
    if (btn) { btn.disabled = false; btn.textContent = '✓ Confirm Upload'; }
    toast('Upload failed: ' + e.message, 'error');
  }
}

function _edspReset() {
  _edspPendingFile = null;
  _edspPreviewData = null;
  const fi = document.getElementById('edsp-file-input');
  if (fi) fi.value = '';
  _edspPendingFile = null;
  const preview = document.getElementById('edsp-preview');
  if (preview) preview.style.display = 'none';
}

async function _edspLoadPeriods() {
  const el = document.getElementById('edsp-periods-list');
  if (!el) return;
  try {
    // Get all historical period_labels from log_amx that match xxx-yyyy pattern
    const r = await fetch('/api/admin/historical-edsp-periods');
    const d = await r.json();
    if (!d.length) { el.innerHTML = 'No historical data uploaded yet.'; return; }
    el.innerHTML = d.map(p => `
      <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border)">
        <span style="font-weight:600;min-width:100px">${escH(p.period_label)}</span>
        <span style="color:var(--text-3)">${p.rows} rows &nbsp;·&nbsp; ${p.stations} stations &nbsp;·&nbsp; ${p.date_from} → ${p.date_to}</span>
        <button class="btn btn-ghost btn-sm" style="margin-left:auto;color:var(--red-d)"
          onclick="_edspDeletePeriod('${escH(p.period_label)}')">🗑 Clear</button>
      </div>`).join('');
  } catch(e) {
    el.innerHTML = '<span style="color:var(--red-d)">Error loading periods</span>';
  }
}

async function _edspDeletePeriod(period) {
  if (!confirm(`Delete ALL data for period "${period}"? This cannot be undone.`)) return;
  try {
    const r = await fetch(`/api/admin/historical-edsp/${encodeURIComponent(period)}`, {method:'DELETE'});
    const d = await r.json();
    if (d.ok) {
      toast(`Cleared ${d.log_amx_deleted} rows for ${period}`, 'success');
      _edspLoadPeriods();
    } else {
      toast('Error: ' + d.error, 'error');
    }
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}