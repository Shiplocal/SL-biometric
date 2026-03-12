async function updateDebSubType(id, subType) {
  const r = await fetch(`/api/admin/debit-data/${id}/subtype`, {
    method: 'PATCH',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({sub_type: subType})
  });
  if (!r.ok) {
    const d = await r.json().catch(()=>({}));
    toast('Could not update type: ' + (d.error||'error'), 'error');
    loadDebAdmin(); // revert on failure
  }
}

// ── DEBIT SUB-TAB SWITCHER ─────────────────────────────────
function debSubTab(t) {
  document.getElementById('deb-panel-resp').style.display = t === 'resp' ? 'block' : 'none';
  document.getElementById('deb-panel-pub').style.display  = t === 'pub'  ? 'block' : 'none';
  document.getElementById('deb-sub-resp').classList.toggle('active', t === 'resp');
  document.getElementById('deb-sub-pub').classList.toggle('active',  t === 'pub');
  if (t === 'resp') loadDeb();
  if (t === 'pub')  loadDebAdmin();
}

// ── RESPONSES SELECTION + SEND-BACK ───────────────────────
const debRespSelectedTids = new Set();

function debRespRowCheck(tid, checked) {
  checked ? debRespSelectedTids.add(tid) : debRespSelectedTids.delete(tid);
  const row = document.getElementById(`dresp-row-${CSS.escape(tid)}`);
  if (row) row.classList.toggle('row-selected', checked);
  document.getElementById('deb-resp-sel-count').textContent = `${debRespSelectedTids.size} selected`;
}

function debRespToggleAll(chk) {
  document.querySelectorAll('#deb-body .deb-resp-chk').forEach(c => {
    c.checked = chk.checked;
    debRespRowCheck(c.value, chk.checked);
  });
}

async function sendBackRespSelected() {
  if (!debRespSelectedTids.size) return toast('Select responded entries to send back.', 'warning');
  const station = document.getElementById('deb-resp-station')?.value || '';
  if (!station) return toast('Filter by a specific station before sending back.', 'warning');
  if (!confirm(`Send back ${debRespSelectedTids.size} entr${debRespSelectedTids.size===1?'y':'ies'} to the station?`)) return;
  // We send back by TID + station — endpoint needs to accept tids array
  const r = await fetch('/api/admin/debit-sendback-tids', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({tids: [...debRespSelectedTids], station})
  });
  if (r.ok) {
    toast('Sent back ✓ — station can now re-respond', 'success');
    debRespSelectedTids.clear();
    document.getElementById('deb-resp-sel-count').textContent = '0 selected';
    const allChk = document.getElementById('deb-resp-chk-all');
    if (allChk) allChk.checked = false;
    loadDeb();
  } else {
    const d = await r.json().catch(() => ({}));
    toast('Send back failed: ' + (d.error || 'unknown error'), 'error');
  }
}

// ── DEBIT RESPONSES VIEW (answered entries) ───────────────
async function populateDebResponseFilters() {
  const sel = document.getElementById('deb-resp-month');
  if (!sel || sel.dataset.loaded) return;
  try {
    const months = await fetch('/api/admin/deb-months').then(r => r.json());
    sel.innerHTML = '<option value="">All Months</option>';
    months.forEach(m => {
      const [yr, mo] = m.split('-');
      const label = mo && yr ? new Date(yr, parseInt(mo)-1, 1).toLocaleDateString('en-IN',{month:'short',year:'numeric'}) : m;
      sel.innerHTML += `<option value="${m}">${label}</option>`;
    });
    sel.dataset.loaded = '1';
  } catch(e) {}
}

let _debRespCurTab = 'finalloss';

function debRespTab(t) {
  _debRespCurTab = t;
  document.getElementById('deb-rt-fl') .classList.toggle('active', t === 'finalloss');
  document.getElementById('deb-rt-rec').classList.toggle('active', t === 'recovery');
  document.getElementById('deb-rt-co') .classList.toggle('active', t === 'caseopen');
  document.getElementById('deb-rt-panel-fl') .style.display = t === 'finalloss' ? '' : 'none';
  document.getElementById('deb-rt-panel-rec').style.display = t === 'recovery'  ? '' : 'none';
  document.getElementById('deb-rt-panel-co') .style.display = t === 'caseopen'  ? '' : 'none';
  debRespSelectedTids.clear();
  document.getElementById('deb-resp-sel-count').textContent = '0 selected';
}

async function loadDeb() {
  await populateDebResponseFilters();
  const month   = document.getElementById('deb-resp-month')?.value   || '';
  const station = document.getElementById('deb-resp-station')?.value || '';

  ['deb-body-fl','deb-body-rec','deb-body-co'].forEach(id => {
    document.getElementById(id).innerHTML =
      '<tr><td colspan="13" style="text-align:center;padding:16px;color:var(--text-3)">Loading\u2026</td></tr>';
  });
  debRespSelectedTids.clear();
  document.getElementById('deb-resp-sel-count').textContent = '0 selected';

  const qp = new URLSearchParams();
  if (month)   qp.set('month',   month);
  if (station) qp.set('station', station);

  try {
    const data = await fetch('/api/admin/deb-report?' + qp).then(r => r.json());
    const esc  = v => (v||'').toString().replace(/</g,'&lt;');
    const fmtD = v => v ? String(v).substring(0,10) : '-';
    const fmtA = v => '\u20b9' + parseFloat(v||0).toLocaleString('en-IN',{minimumFractionDigits:2});

    if (!Array.isArray(data)) {
      ['deb-body-fl','deb-body-rec','deb-body-co'].forEach(id => {
        document.getElementById(id).innerHTML = '<tr class="empty-row"><td colspan="13">Error loading data</td></tr>';
      });
      return;
    }

    const fl  = data.filter(r => r.sub_type === 'Final Loss');
    const rec = data.filter(r => r.sub_type === 'Recovery');
    const co  = data.filter(r => r.sub_type === 'Case Open');

    // ── Final Loss ──────────────────────────────────────────
    document.getElementById('deb-body-fl').innerHTML = fl.length
      ? fl.map(r => `
        <tr class="dadmin-row" data-search="${esc(r.station_code).toLowerCase()} ${esc(r.tid).toLowerCase()} ${esc(r.ic_name).toLowerCase()}">
          <td style="text-align:center"><input type="checkbox" class="deb-resp-chk" value="${esc(r.tid)}" data-station="${esc(r.station_code)}" onchange="debRespRowCheck('${esc(r.tid)}',this.checked)"></td>
          <td style="font-family:monospace;font-size:.72rem;font-weight:700">${esc(r.station_code)}</td>
          <td style="font-family:monospace;font-size:.7rem">${esc(r.tid)}</td>
          <td style="font-size:.74rem;white-space:nowrap">${fmtD(r.debit_date)}</td>
          <td style="font-size:.74rem">${esc(r.bucket)}<br><span style="color:var(--text-3);font-size:.68rem">${esc(r.loss_sub_bucket)}</span></td>
          <td style="font-size:.72rem">${esc(r.ic_name)}</td>
          <td style="font-weight:700;text-align:right">${fmtA(r.amount)}</td>
          <td style="font-size:.72rem">${esc(r.confirm_by)}</td>
          <td><span style="font-weight:600;color:${r.decision==='Yes'?'var(--green-d)':'var(--red-d)'}">${esc(r.decision)||'-'}</span></td>
          <td style="font-size:.72rem;color:var(--text-2)">${esc(r.remarks)||'-'}</td>
          <td style="font-size:.72rem;color:var(--text-3);white-space:nowrap">${fmtD(r.submitted_at)}</td>
        </tr>`).join('')
      : '<tr class="empty-row"><td colspan="11">No Final Loss responses</td></tr>';

    // ── Recovery & Case Open (same columns) ─────────────────
    const disputeRow = r => `
      <tr class="dadmin-row" data-search="${esc(r.station_code).toLowerCase()} ${esc(r.tid).toLowerCase()} ${esc(r.ic_name).toLowerCase()}">
        <td style="text-align:center"><input type="checkbox" class="deb-resp-chk" value="${esc(r.tid)}" data-station="${esc(r.station_code)}" onchange="debRespRowCheck('${esc(r.tid)}',this.checked)"></td>
        <td style="font-family:monospace;font-size:.72rem;font-weight:700">${esc(r.station_code)}</td>
        <td style="font-family:monospace;font-size:.7rem">${esc(r.tid)}</td>
        <td style="font-size:.74rem;white-space:nowrap">${fmtD(r.debit_date)}</td>
        <td style="font-size:.74rem">${esc(r.bucket)}<br><span style="color:var(--text-3);font-size:.68rem">${esc(r.loss_sub_bucket)}</span></td>
        <td style="font-size:.72rem">${esc(r.ic_name)}</td>
        <td style="font-weight:700;text-align:right">${fmtA(r.amount)}</td>
        <td style="font-size:.72rem">${esc(r.confirm_by)}</td>
        <td style="font-size:.72rem;font-weight:600;color:var(--blue)">${esc(r.decision)||'-'}</td>
        <td style="font-family:monospace;font-size:.72rem">${esc(r.tt_number)||'-'}</td>
        <td style="font-family:monospace;font-size:.72rem">${esc(r.orphan_ref)||'-'}</td>
        <td style="font-size:.72rem;color:var(--text-2)">${esc(r.remarks)||'-'}</td>
        <td style="font-size:.72rem;font-weight:600;color:var(--green-d)">${esc(r.verified_by)||'-'}</td>
        <td style="font-size:.72rem;color:var(--text-3);white-space:nowrap">${fmtD(r.submitted_at)}</td>
      </tr>`;

    document.getElementById('deb-body-rec').innerHTML = rec.length
      ? rec.map(disputeRow).join('')
      : '<tr class="empty-row"><td colspan="13">No Recovery responses</td></tr>';

    document.getElementById('deb-body-co').innerHTML = co.length
      ? co.map(disputeRow).join('')
      : '<tr class="empty-row"><td colspan="13">No Case Open responses</td></tr>';

  } catch(e) {
    ['deb-body-fl','deb-body-rec','deb-body-co'].forEach(id => {
      document.getElementById(id).innerHTML = `<tr class="empty-row"><td colspan="13">Error: ${e.message}</td></tr>`;
    });
  }
}
// ── DEBIT MANAGEMENT (queue) ───────────────────────────────
async function loadDebAdmin() {
  const station = document.getElementById('deb-admin-station-filter')?.value || '';
  const status  = document.getElementById('deb-admin-status-filter')?.value  || '';
  const body    = document.getElementById('deb-admin-body');
  body.innerHTML = '<tr><td colspan="15" style="text-align:center;padding:16px;color:var(--text-3)">Loading…</td></tr>';
  debSelectedIds.clear();
  updateDebSelCount();
  const allChk = document.getElementById('deb-chk-all');
  if (allChk) allChk.checked = false;

  const qp = new URLSearchParams();
  if (station) qp.set('station', station);
  if (status)  qp.set('status',  status);

  try {
    const resp = await fetch('/api/admin/debit-queue?' + qp).then(r => r.json());
    if (!Array.isArray(resp)) {
      body.innerHTML = `<tr class="empty-row"><td colspan="15">Error: ${resp.error||'Unexpected response'}</td></tr>`;
      return;
    }
    debAdminData = resp;
    if (!debAdminData.length) {
      body.innerHTML = '<tr class="empty-row"><td colspan="15">No entries found</td></tr>';
      return;
    }
    const esc = v => (v||'').toString().replace(/"/g,'&quot;').replace(/</g,'&lt;');
    body.innerHTML = debAdminData.map(it => `
      <tr id="dadmin-row-${it.id}" class="dadmin-row">
        <td style="text-align:center"><input type="checkbox" class="deb-row-chk" value="${it.id}" onchange="debRowCheck(${it.id},this.checked)"></td>
        <td style="font-family:monospace;font-size:.72rem;font-weight:700">${esc(it.station_code)}</td>
        <td style="font-family:monospace;font-size:.7rem">${esc(it.tid)}</td>
        <td style="white-space:nowrap;font-size:.74rem">${it.debit_date?it.debit_date.toString().substring(0,10):'-'}</td>
        <td style="font-size:.72rem;color:var(--text-3)">${esc(it.cluster)}</td>
        <td style="font-size:.74rem">${esc(it.bucket)}</td>
        <td style="font-size:.72rem;color:var(--text-2)">${esc(it.loss_sub_bucket)}</td>
        <td style="font-size:.72rem">${esc(it.shipment_type)}</td>
        <td style="font-size:.72rem">${esc(it.ic_name)}</td>
        <td style="font-weight:700;text-align:right">₹${parseFloat(it.amount||0).toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
        <td style="font-size:.72rem">${esc(it.confirm_by)}</td>
        <td style="font-size:.72rem">${esc(it.cash_recovery_type)}</td>
        <td style="font-size:.72rem;text-align:center">${it.cm_confirm||'-'}</td>
        <td style="font-size:.72rem">${
          it.status === 'draft'
            ? `<select class="tbl-inp" style="font-size:.72rem;padding:1px 4px;border-radius:6px;width:110px" onchange="updateDebSubType(${it.id},this.value)">
                 <option value="Final Loss" ${it.sub_type==='Final Loss'?'selected':''}>Final Loss</option>
                 <option value="New"        ${it.sub_type==='New'       ?'selected':''}>New</option>
               </select>`
            : `<span style="padding:2px 7px;border-radius:6px;font-weight:600;background:${
                it.sub_type==='Final Loss' ? 'var(--red-bg)' : 'var(--blue-bg)'};color:${
                it.sub_type==='Final Loss' ? 'var(--red-d)'  : 'var(--blue)'}">${esc(it.sub_type)||'-'}</span>`
        }</td>
        <td style="font-size:.72rem;color:var(--text-2)">${esc(it.remarks)}</td>
        <td>${STATUS_PILL[it.status]||it.status}</td>
        <td style="white-space:nowrap;display:flex;gap:3px">
          ${it.status==='draft'
            ? `<button class="btn btn-green btn-sm" onclick="publishSelected([${it.id}])" title="Publish">🚀</button>`
            : ''}
          <button class="btn btn-red btn-sm" onclick="deleteDebEntry(${it.id})" title="Delete">✕</button>
        </td>
      </tr>`).join('');
  } catch(e) {
    body.innerHTML = `<tr class="empty-row"><td colspan="15">Error: ${e.message}</td></tr>`;
  }
}

// ── SELECTION ──────────────────────────────────────────────

function debRowCheck(id, checked) {
  checked ? debSelectedIds.add(id) : debSelectedIds.delete(id);
  const row = document.getElementById(`dadmin-row-${id}`);
  if (row) row.classList.toggle('row-selected', checked);
  updateDebSelCount();
}

function debToggleAll(chk) {
  // Scope to body rows only — header checkbox is NOT .deb-row-chk
  document.querySelectorAll('#deb-admin-body .deb-row-chk').forEach(c => {
    c.checked = chk.checked;
    debRowCheck(parseInt(c.value), chk.checked);
  });
}

function updateDebSelCount() {
  document.getElementById('deb-selected-count').textContent = `${debSelectedIds.size} selected`;
}

// ── BULK ACTIONS ───────────────────────────────────────────
async function publishSelected(ids) {
  const toPublish = ids || [...debSelectedIds];
  if (!toPublish.length) return toast('Select entries to publish.', 'warning');
  const r = await fetch('/api/admin/debit-publish', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ids: toPublish})
  });
  if (r.ok) { toast(`Published ${toPublish.length} entr${toPublish.length===1?'y':'ies'} ✓`, 'success'); loadDebAdmin(); }
  else toast('Publish failed.', 'error');
}

async function publishAllDraft() {
  if (!confirm('Publish ALL draft entries?')) return;
  const r = await fetch('/api/admin/debit-publish', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ids:[]})
  });
  if (r.ok) { toast('All draft entries published ✓', 'success'); loadDebAdmin(); }
  else toast('Publish failed.', 'error');
}

async function sendBackSelected(ids) {
  const toSend = ids || [...debSelectedIds];
  if (!toSend.length) return toast('Select answered entries to send back.', 'warning');
  const r = await fetch('/api/admin/debit-sendback', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ids: toSend})
  });
  if (r.ok) { toast('Sent back ✓', 'success'); loadDebAdmin(); }
  else toast('Failed.', 'error');
}

async function deleteDebEntry(id) {
  if (!confirm('Delete this debit entry?')) return;
  const r = await fetch(`/api/admin/debit-data/${id}`, {method:'DELETE'});
  if (r.ok) { document.getElementById(`dadmin-row-${id}`)?.remove(); toast('Deleted.', 'success'); }
  else toast('Delete failed.', 'error');
}

async function deleteSelected() {
  if (!debSelectedIds.size) return toast('Select entries to delete.', 'warning');
  if (!confirm(`Delete ${debSelectedIds.size} entries?`)) return;
  await Promise.all([...debSelectedIds].map(id =>
    fetch(`/api/admin/debit-data/${id}`, {method:'DELETE'})
  ));
  toast('Deleted.', 'success');
  loadDebAdmin();
}

// ── ADD ENTRY PANEL ────────────────────────────────────────
function toggleAddEntryPanel() {
  const panel = document.getElementById('deb-add-panel');
  const btn   = document.getElementById('btn-add-entry');
  const open  = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : 'block';
  btn.textContent     = open ? '＋ Add Entry' : '✕ Cancel';
  if (!open) {
    populateDebStations();
    document.getElementById('dnew-tid')?.focus();
  }
}

async function loadNewRowICs() {
  const station = document.getElementById('dnew-station').value;
  const sel     = document.getElementById('dnew-ic');
  if (!station) { sel.innerHTML = '<option value="">Select station first…</option>'; return; }
  sel.innerHTML = '<option>Loading…</option>';
  try {
    const data = await fetch(`/api/ic-list?station=${encodeURIComponent(station)}`).then(r => r.json());
    const ics  = data.ics || [];
    sel.innerHTML = '<option value="">Select IC…</option>';
    if (ics.length) {
      ics.forEach(u => {
        const name = (u.ic_name||'').trim();
        const opt  = document.createElement('option');
        opt.value = name;
        opt.textContent = name + (u.designation ? ' ('+u.designation+')' : '');
        sel.appendChild(opt);
      });
    } else {
      sel.innerHTML = `<option value="">No staff for ${station}</option>`;
    }
  } catch(e) { sel.innerHTML = '<option value="">Could not load</option>'; }
}

async function saveNewDebRow() {
  const tid     = document.getElementById('dnew-tid').value.trim();
  const station = document.getElementById('dnew-station').value;
  const value   = document.getElementById('dnew-value').value;
  if (!tid)     return toast('TID is required.', 'warning');
  if (!station) return toast('Station is required.', 'warning');
  if (!value || parseFloat(value) <= 0) return toast('Amount must be > 0.', 'warning');

  const payload = {
    tid, station_code: station,
    impact_date:        document.getElementById('dnew-date').value || null,
    loss_bucket:        document.getElementById('dnew-bucket').value,
    loss_sub_bucket:    document.getElementById('dnew-subbucket').value,
    shipment_type:      document.getElementById('dnew-shiptype').value,
    cluster:            document.getElementById('dnew-cluster').value || null,
    ic_name:            document.getElementById('dnew-ic').value,
    value:              parseFloat(value),
    confirm_by:         document.getElementById('dnew-confirmby').value,
    cash_recovery_type: document.getElementById('dnew-recovery').value,
    cm_confirm:         document.getElementById('dnew-cmconfirm').value,
    sub_type:           document.getElementById('dnew-subtype').value || 'New',
    remarks:            document.getElementById('dnew-remarks').value,
  };

  const r = await fetch('/api/admin/debit-data/single', {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
  });
  if (r.ok) {
    toast('Entry added as draft ✓', 'success');
    ['dnew-tid','dnew-date','dnew-bucket','dnew-subbucket','dnew-value','dnew-confirmby','dnew-remarks','dnew-cluster']
      .forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
    ['dnew-station','dnew-shiptype','dnew-recovery','dnew-cmconfirm','dnew-ic','dnew-subtype']
      .forEach(id => { const el = document.getElementById(id); if(el) el.selectedIndex=0; });
    loadDebAdmin();
  } else {
    const d = await r.json();
    toast('Error: ' + d.error, 'error');
  }
}

// ── COMPAT STUBS ───────────────────────────────────────────
async function loadDebitCycles() { loadDebAdmin(); }
async function openDebitEdit() {}
async function loadDebitEditItems() {}
const debRowEdits = {};
function debRowChanged() {}
async function saveDebRow() {}
async function deleteDebRow(id) { deleteDebEntry(id); }
async function createOrGetCycle() {}
function autoFillDebLabel() {}

// ── DEBIT UPLOAD — PARSE → PREVIEW → IMPORT ───────────────
let debAdmFile = null;
let _debParsedRows = [];

function onDebAdmFileSelected(inp) {
  debAdmFile = inp.files[0] || null;
  document.getElementById('deb-adm-file-lbl').textContent = debAdmFile ? debAdmFile.name : 'Upload Excel';
  document.getElementById('btn-deb-adm-upload').disabled = !debAdmFile;
  // Clear any existing preview
  _debParsedRows = [];
  const prev = document.getElementById('deb-upload-preview');
  if(prev) prev.style.display = 'none';
}

async function uploadDebEntries() {
  if (!debAdmFile) return;

  // If preview already shown and confirmed, do the import
  if (_debParsedRows.length) {
    await _debImportRows();
    return;
  }

  const statusEl = document.getElementById('deb-adm-status');
  statusEl.textContent = 'Parsing file…';

  const fd = new FormData();
  fd.append('file', debAdmFile);

  const res = await fetch('/api/admin/debit-parse', {method:'POST', body: fd});
  const d = await res.json();

  if (!d.success) { statusEl.textContent = 'Parse error: ' + d.error; return; }
  if (!d.rows.length) { statusEl.textContent = 'No valid rows found in file.'; return; }

  _debParsedRows = d.rows;
  statusEl.textContent = '';
  _debRenderPreview();
}

function _debRenderPreview() {
  // Create or reuse preview container below the status line
  let prev = document.getElementById('deb-upload-preview');
  if (!prev) {
    prev = document.createElement('div');
    prev.id = 'deb-upload-preview';
    const statusEl = document.getElementById('deb-adm-status');
    statusEl.parentNode.insertBefore(prev, statusEl.nextSibling);
  }

  const rows = _debParsedRows;
  prev.style.display = 'block';
  prev.innerHTML = `
    <div style="padding:10px 16px 6px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <div style="font-size:.82rem;font-weight:700;color:var(--navy)">${rows.length} rows parsed — review &amp; edit impact dates before importing</div>
      <div style="display:flex;gap:8px">
        <button onclick="_debCancelPreview()"
          style="padding:5px 14px;font-size:.78rem;border:1px solid var(--border);border-radius:7px;background:none;cursor:pointer">Cancel</button>
        <button onclick="_debImportRows()"
          style="padding:5px 14px;font-size:.78rem;font-weight:700;border:none;border-radius:7px;background:var(--amber);color:#fff;cursor:pointer">
          Import ${rows.length} rows →
        </button>
      </div>
    </div>
    <div style="overflow-x:auto;max-height:340px;overflow-y:auto;border-top:1px solid var(--border)">
      <table style="width:100%;border-collapse:collapse;font-size:.78rem">
        <thead style="position:sticky;top:0;background:var(--bg);z-index:1">
          <tr>
            <th style="padding:6px 10px;text-align:left;border-bottom:1px solid var(--border);white-space:nowrap">TID</th>
            <th style="padding:6px 10px;text-align:left;border-bottom:1px solid var(--border)">Station</th>
            <th style="padding:6px 10px;text-align:left;border-bottom:1px solid var(--border);white-space:nowrap">Impact Date <span style="font-weight:400;color:var(--amber-d)">(editable)</span></th>
            <th style="padding:6px 10px;text-align:left;border-bottom:1px solid var(--border)">Bucket</th>
            <th style="padding:6px 10px;text-align:left;border-bottom:1px solid var(--border)">Sub Bucket</th>
            <th style="padding:6px 10px;text-align:left;border-bottom:1px solid var(--border)">Shipment Type</th>
            <th style="padding:6px 10px;text-align:right;border-bottom:1px solid var(--border)">Amount</th>
            <th style="padding:6px 10px;text-align:left;border-bottom:1px solid var(--border)">IC Name</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r,idx) => `<tr style="border-bottom:1px solid var(--border)">
            <td style="padding:5px 10px;font-family:'DM Mono',monospace;font-size:.74rem;white-space:nowrap">${esc(r.tid)}</td>
            <td style="padding:5px 10px">${esc(r.station)}</td>
            <td style="padding:5px 10px">
              <input type="date" value="${r.impact_date||''}"
                onchange="_debPreviewEdit(${idx},'impact_date',this.value)"
                style="font-size:.76rem;padding:3px 6px;border:1px solid var(--border);border-radius:5px;background:var(--card);color:var(--navy);font-weight:600">
            </td>
            <td style="padding:5px 10px;font-size:.74rem">${esc(r.loss_bucket)}</td>
            <td style="padding:5px 10px;font-size:.74rem;color:var(--text-2)">${esc(r.loss_sub_bucket)}</td>
            <td style="padding:5px 10px;font-size:.74rem">${esc(r.shipment_type)}</td>
            <td style="padding:5px 10px;text-align:right;font-weight:600;color:var(--red-d)">₹${Number(r.amount).toLocaleString('en-IN')}</td>
            <td style="padding:5px 10px;font-size:.74rem">${esc(r.ic_name)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function _debPreviewEdit(idx, field, value) {
  if (_debParsedRows[idx]) _debParsedRows[idx][field] = value;
}

function _debCancelPreview() {
  _debParsedRows = [];
  debAdmFile = null;
  document.getElementById('deb-adm-file-lbl').textContent = 'Upload Excel';
  document.getElementById('btn-deb-adm-upload').disabled = true;
  const prev = document.getElementById('deb-upload-preview');
  if(prev) prev.style.display = 'none';
  document.getElementById('deb-adm-status').textContent = '';
  // Reset file input
  const fi = document.getElementById('deb-adm-file');
  if(fi) fi.value = '';
}

async function _debImportRows() {
  const statusEl = document.getElementById('deb-adm-status');
  statusEl.textContent = 'Importing…';
  const prev = document.getElementById('deb-upload-preview');
  if(prev) prev.style.display = 'none';

  const res = await fetch('/api/admin/debit-import-rows', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({rows: _debParsedRows})
  });
  const d = await res.json();
  if (d.success) {
    statusEl.innerHTML = `<span style="color:var(--green-d)">✓ ${d.inserted} entries imported as draft${d.skipped ? ` · ${d.skipped} skipped` : ''}.</span>`;
    _debCancelPreview();
    loadDebAdmin();
  } else {
    statusEl.textContent = 'Error: ' + d.error;
  }
}