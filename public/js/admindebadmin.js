// ── SHARED CELL HELPERS ─────────────────────────────────────────────────────
// renderPills: shows first `limit` names as pills, rest behind expand toggle
// truncRemark: truncates long text with inline read-more toggle
// Uses data-attributes + delegated listener — no inline quote-escaping issues.

var _pillSeq   = 0;
var _remarkSeq = 0;

function renderPills(csv, limit) {
  limit = limit || 3;
  var names = (csv || '').split(',').map(function(n){ return n.trim(); }).filter(Boolean);
  if (!names.length) return '<span style="color:var(--text-3);font-size:.75rem">—</span>';

  var id = 'ap-' + (++_pillSeq);

  function pill(n) {
    return '<span style="display:block;background:var(--blue-bg);color:var(--navy);' +
           'border-radius:5px;padding:2px 8px;margin-bottom:2px;font-size:.7rem;' +
           'white-space:nowrap;font-weight:500">' +
           n.replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</span>';
  }

  var visible = names.slice(0, limit);
  var hidden  = names.slice(limit);

  if (!hidden.length) return visible.map(pill).join('');

  var count = hidden.length;
  return visible.map(pill).join('') +
    '<div id="' + id + '-more" style="display:none">' + hidden.map(pill).join('') + '</div>' +
    '<span class="_pill-toggle" data-target="' + id + '-more" data-count="' + count + '" ' +
    'style="display:inline-block;margin-top:3px;padding:1px 8px;border-radius:99px;' +
    'font-size:.68rem;font-weight:600;cursor:pointer;user-select:none;' +
    'background:var(--bg);color:var(--text-3);border:1px solid var(--border);' +
    'transition:all .15s">+' + count + ' more ▾</span>';
}

function truncRemark(text, max) {
  max = max || 60;
  var t = (text || '').trim();
  if (!t) return '<span style="color:var(--text-3)">—</span>';
  var safe = t.replace(/</g,'&lt;');
  if (t.length <= max) return '<span style="font-size:.72rem;color:var(--text-2)">' + safe + '</span>';

  var id   = 'ar-' + (++_remarkSeq);
  var head = safe.substring(0, max);
  var rest = safe.substring(max);
  return '<span style="font-size:.72rem;color:var(--text-2)">' +
    head +
    '<span id="' + id + '-rest" style="display:none">' + rest + '</span>' +
    '…<span class="_rmk-toggle" data-target="' + id + '-rest" ' +
    'style="color:var(--blue);cursor:pointer;font-size:.68rem;font-weight:600;margin-left:2px">more</span>' +
    '</span>';
}

// Delegated click handler for all pill + remark toggles (admin side)
document.addEventListener('click', function(e) {
  if (e.target.classList.contains('_pill-toggle')) {
    var btn  = e.target;
    var more = document.getElementById(btn.dataset.target);
    if (!more) return;
    var open = more.style.display !== 'none';
    more.style.display    = open ? 'none'           : 'block';
    btn.textContent       = open ? '+' + btn.dataset.count + ' more ▾' : '▴ less';
    btn.style.background  = open ? 'var(--bg)'      : 'var(--amber-bg)';
    btn.style.color       = open ? 'var(--text-3)'  : 'var(--amber-d)';
    btn.style.borderColor = open ? 'var(--border)'  : 'var(--amber)';
  }
  if (e.target.classList.contains('_rmk-toggle')) {
    var btn  = e.target;
    var rest = document.getElementById(btn.dataset.target);
    if (!rest) return;
    var open        = rest.style.display !== 'none';
    rest.style.display = open ? 'none' : 'inline';
    btn.textContent    = open ? 'more' : 'less';
    var prev = btn.previousSibling;
    if (prev && prev.nodeType === 3) prev.textContent = open ? '…' : '';
  }
});

// ─────────────────────────────────────────────────────────────────────────────

// ── GLOBAL TABLE SEARCH (used by multiple tabs) ──────────────────────────────
// Searches rows by their data-search attribute. bodyId = tbody element id OR
// 'deb-active-body' = searches whichever deb-body-* has data-active-body=true.
function filterTbl(bodyId, inputId) {
  var term = (document.getElementById(inputId).value || '').toLowerCase().trim();
  var bodies;
  if (bodyId === 'deb-active-body') {
    // Search all 3 debit response tbodies simultaneously
    bodies = ['deb-body-fl','deb-body-rec','deb-body-co']
      .map(function(id){ return document.getElementById(id); })
      .filter(Boolean);
  } else {
    var el = document.getElementById(bodyId);
    bodies = el ? [el] : [];
  }
  bodies.forEach(function(tbody) {
    var vis = 0;
    tbody.querySelectorAll('tr').forEach(function(tr) {
      if (tr.classList.contains('empty-row')) return;
      var haystack = (tr.dataset.search || tr.textContent || '').toLowerCase();
      var show = !term || haystack.includes(term);
      tr.style.display = show ? '' : 'none';
      if (show) vis++;
    });
  });
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


// ── DEBIT RESPONSE SEARCH ────────────────────────────────────────────────────
function debRespSearch() {
  var term = (document.getElementById('s-deb').value || '').toLowerCase().trim();
  // Only search the currently visible panel
  var activePanel = document.getElementById('deb-rt-panel-fl');
  if (document.getElementById('deb-rt-panel-rec').style.display !== 'none') activePanel = document.getElementById('deb-rt-panel-rec');
  if (document.getElementById('deb-rt-panel-co').style.display !== 'none')  activePanel = document.getElementById('deb-rt-panel-co');
  if (!activePanel) return;
  var rows = activePanel.querySelectorAll('tbody tr');
  var vis = 0;
  rows.forEach(function(tr) {
    if (tr.classList.contains('empty-row')) return;
    var haystack = (tr.dataset.search || tr.textContent || '').toLowerCase();
    var show = !term || haystack.includes(term);
    tr.style.display = show ? '' : 'none';
    if (show) vis++;
  });
}

let _debRespCurTab = 'finalloss';
var _adminDebRowCache = {}; // tid -> row object, populated on render
var _debQueueCache = {};    // id -> draft row object, populated on queue render

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
  // Re-apply search filter to newly visible tab
  // Clear search on tab switch
  var s = document.getElementById('s-deb'); if (s) s.value = '';
  debRespSearch();
}


// ── ADMIN DEBIT RESPONSE DRAWER (read-only) ──────────────────────────────────
function _adminDebOpenDrawer(tid) {
  var isCM = window._adminUser && window._adminUser.role === 'cluster_manager';
  var r = _adminDebRowCache[tid] || {};
  var MONTHS = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var esc = function(v){ return (v||'').toString().replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
  var fmtD = function(v){ return v ? String(v).substring(0,10) : '—'; };

  var overlay = document.getElementById('_adeb-drawer-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = '_adeb-drawer-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:8000;background:rgba(0,0,0,.35)';
    overlay.onclick = function(e){ if(e.target===overlay) _adminDebCloseDrawer(); };
    document.body.appendChild(overlay);
  }
  var drawer = document.getElementById('_adeb-drawer');
  if (!drawer) {
    drawer = document.createElement('div');
    drawer.id = '_adeb-drawer';
    drawer.style.cssText = [
      'position:fixed','top:0','right:0','height:100%','width:460px','max-width:95vw',
      'background:var(--card)','box-shadow:-8px 0 40px rgba(0,0,0,.18)',
      'z-index:8001','display:flex','flex-direction:column','overflow:hidden',
      'transform:translateX(100%)','transition:transform .25s cubic-bezier(.4,0,.2,1)'
    ].join(';');
    overlay.appendChild(drawer);
  }

  var subColor = r.sub_type==='Final Loss' ? 'var(--red-d)' : r.sub_type==='Recovery' ? 'var(--navy)' : '#92400e';
  var subBg    = r.sub_type==='Final Loss' ? 'var(--red-bg)' : r.sub_type==='Recovery' ? '#dbeafe' : '#fef9c3';

  function field(label, value, mono) {
    if (!value || value==='—' || value==='-') value = '<span style="color:var(--text-3)">—</span>';
    return '<div style="display:flex;gap:8px;padding:7px 0;border-bottom:1px solid var(--border)">' +
      '<span style="font-size:.78rem;color:var(--text-3);min-width:130px;flex-shrink:0">' + label + '</span>' +
      '<span style="font-size:.78rem;font-weight:500;color:var(--text-1);word-break:break-word' + (mono?';font-family:monospace':'') + '">' + value + '</span>' +
      '</div>';
  }

  var decLabel = r.sub_type==='Final Loss' ? 'WH Decision' : r.sub_type==='Case Open' ? 'Dispute Type' : 'WH Recovery Type';
  var decVal   = esc(r.decision)||'—';
  if (r.sub_type==='Final Loss') {
    decVal = r.decision==='Yes'
      ? '<span style="color:var(--red-d);font-weight:700">Yes — Accept Loss</span>'
      : r.decision==='No'
      ? '<span style="color:var(--green-d);font-weight:700">No — Dispute</span>'
      : '<span style="color:var(--text-3)">—</span>';
  }

  drawer.innerHTML =
    '<div style="padding:18px 20px 14px;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;gap:12px">' +
      '<div style="flex:1">' +
        '<div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-3);margin-bottom:4px">Debit Note Response</div>' +
        '<div style="font-size:1rem;font-weight:700;color:var(--navy);font-family:monospace">' + esc(r.tid) + '</div>' +
        '<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
          '<span style="font-size:.75rem;font-weight:600;padding:2px 8px;border-radius:6px;background:' + subBg + ';color:' + subColor + '">' + esc(r.sub_type||'-') + '</span>' +
          '<span style="font-size:.75rem;font-family:monospace;color:var(--text-3)">' + esc(r.station_code) + '</span>' +
        '</div>' +
      '</div>' +
      '<button onclick="_adminDebCloseDrawer()" style="background:none;border:none;cursor:pointer;font-size:1.4rem;color:var(--text-3);line-height:1;padding:4px">×</button>' +
    '</div>' +
    '<div style="flex:1;overflow-y:auto;padding:0 20px">' +
      '<div style="margin-top:14px">' +
        '<div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-3);margin-bottom:6px">Debit Info</div>' +
        field('Station', esc(r.station_code), true) +
        field('Impact Date', fmtD(r.debit_date)) +
        field('Loss Bucket', esc(r.bucket)) +
        field('Sub Bucket', esc(r.loss_sub_bucket)) +
        field('Shipment Type', esc(r.shipment_type)) +
        field('Amount', r.amount ? '₹' + parseFloat(r.amount).toLocaleString('en-IN',{minimumFractionDigits:2}) : null) +
        field('IC / Staff', esc((r.ic_name||'').replace(/,/g,', '))) +
        field('Recovery Month', r.recovery_month ? MONTHS[+r.recovery_month] : null) +
        field('Cluster Manager', esc(r.cluster||r.cluster_manager)) +
        field('Confirm By', esc(r.confirm_by)) +
      '</div>' +
      '<div style="margin:16px 0 10px;border-top:2px solid var(--border)"></div>' +
      '<div style="margin-bottom:20px">' +
        '<div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-3);margin-bottom:6px">WH Response</div>' +
        field(decLabel, decVal) +
        (r.sub_type==='Recovery' ? field('Confirm By (WH)', esc(r.recovery_confirm_by), false) : '') +
        (r.sub_type==='Recovery' ? field('IC / Staff', esc((r.recovery_ic_names||'').replace(/,/g,', ')), false) : '') +
        (r.sub_type==='Case Open' ? field('TT #', esc(r.tt_number), true) : '') +
        (r.sub_type==='Case Open' ? field('Orphan / Label Ref', esc(r.orphan_ref), false) : '') +
        field('WH Remarks', esc(r.remarks)) +
        field('Verified By', esc(r.verified_by)) +
        field('Submitted', fmtD(r.submitted_at)) +
      '</div>' +
    '</div>' +
    '<div style="padding:14px 20px;border-top:1px solid var(--border);text-align:right">' +
      '<button onclick="_adminDebCloseDrawer()" style="padding:9px 24px;font-size:.85rem;border:1.5px solid var(--border);border-radius:8px;background:none;cursor:pointer;color:var(--text-2)">Close</button>' +
    '</div>';

  overlay.style.display = 'block';
  requestAnimationFrame(function(){ drawer.style.transform = 'translateX(0)'; });
}

function _adminDebCloseDrawer() {
  var drawer  = document.getElementById('_adeb-drawer');
  var overlay = document.getElementById('_adeb-drawer-overlay');
  if (drawer) drawer.style.transform = 'translateX(100%)';
  setTimeout(function(){ if(overlay) overlay.style.display = 'none'; }, 260);
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
    const data = await fetch('/api/admin/deb-report?' + qp).then(r => r.json(), {credentials:'include'});
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
        <tr class="dadmin-row" style="cursor:pointer" onclick="_adminDebOpenDrawer('${esc(r.tid)}')"
            data-search="${esc(r.station_code).toLowerCase()} ${esc(r.tid).toLowerCase()} ${(r.recovery_ic_names||r.ic_name||'').toLowerCase()} ${(r.bucket||'').toLowerCase()} ${(r.shipment_type||'').toLowerCase()} ${(r.decision||'').toLowerCase()}">
          <td style="text-align:center" onclick="event.stopPropagation()">${(window._adminUser&&window._adminUser.role==='cluster_manager') ? '' : `<input type="checkbox" class="deb-resp-chk" value="${esc(r.tid)}" data-station="${esc(r.station_code)}" onchange="debRespRowCheck('${esc(r.tid)}',this.checked)">`}</td>
          <td style="font-family:monospace;font-size:.72rem;font-weight:700;white-space:nowrap;text-align:center">${esc(r.station_code)}</td>
          <td><strong style="font-family:monospace;font-size:.72rem">${esc(r.tid)}</strong><div style="font-size:.7rem;color:var(--text-3)">${fmtD(r.debit_date)}</div></td>
          <td style="font-size:.74rem;text-align:center">${esc(r.bucket)}<br><span style="color:var(--text-3);font-size:.68rem">${esc(r.loss_sub_bucket)}</span></td>
          <td style="font-size:.73rem;white-space:nowrap;text-align:center">${esc(r.shipment_type)||'-'}</td>
          <td style="font-weight:700;text-align:center;white-space:nowrap;color:var(--red-d)">${fmtA(r.amount)}</td>
          <td style="min-width:140px;max-width:200px;padding:4px 8px;text-align:center">${r.sub_type==='Recovery'&&r.recovery_ic_names ? renderPills(r.recovery_ic_names) : renderPills(r.ic_name)}</td>
          <td style="font-size:.72rem;white-space:nowrap;text-align:center">${r.sub_type==='Recovery'?esc(r.recovery_type)||'-':esc(r.cash_recovery_type)||'-'}</td>
          <td style="font-size:.72rem;text-align:center">${['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+r.recovery_month]||'-'}</td>
          <td style="font-size:.72rem;white-space:nowrap;text-align:center">${esc(r.confirm_by)||'-'}</td>
          <td style="font-size:.72rem;white-space:nowrap;color:var(--green-d);font-weight:600;text-align:center">${esc(r.cluster||r.cluster_manager)||'-'}</td>
          <td style="font-size:.72rem;text-align:center">${
            r.sub_type==='Recovery' ? (esc(r.recovery_confirm_by)||'-')
            : r.sub_type==='Case Open' ? (esc(r.tt_number)||'-')
            : '-'
          }</td>
          <td style="font-size:.72rem;max-width:140px;text-align:center">${
            r.sub_type==='Case Open' ? (esc(r.orphan_ref)||'-')
            : '-'
          }</td>
          <td style="font-size:.72rem;color:var(--blue);text-align:center">${
            r.sub_type==='Final Loss'
              ? (r.decision==='Yes' ? '<span style=\"color:var(--red-d);font-weight:700\">Accept Loss</span>'
                : r.decision==='No' ? '<span style=\"color:var(--green-d);font-weight:700\">Dispute</span>'
                : '-')
              : r.sub_type==='Case Open' ? (esc(r.decision)||'-')
              : '-'
          }</td>
          <td style="max-width:180px;text-align:center">${truncRemark(r.remarks)}</td>
          <td style="font-size:.72rem;color:var(--text-3);white-space:nowrap;text-align:center">${fmtD(r.submitted_at)}</td>
        </tr>`).join('')
      : '<tr class="empty-row"><td colspan="15">No Final Loss responses</td></tr>';
    fl.forEach(function(row){ _adminDebRowCache[row.tid] = row; });

    // ── Recovery & Case Open — same column layout as Final Loss ───
    const disputeRow = r => `
      <tr class="dadmin-row" style="cursor:pointer" onclick="_adminDebOpenDrawer('${esc(r.tid)}')"
            data-search="${esc(r.station_code).toLowerCase()} ${esc(r.tid).toLowerCase()} ${(r.recovery_ic_names||r.ic_name||'').toLowerCase()} ${(r.bucket||'').toLowerCase()} ${(r.shipment_type||'').toLowerCase()} ${(r.decision||'').toLowerCase()}">
          <td style="text-align:center" onclick="event.stopPropagation()">${(window._adminUser&&window._adminUser.role==='cluster_manager') ? '' : `<input type="checkbox" class="deb-resp-chk" value="${esc(r.tid)}" data-station="${esc(r.station_code)}" onchange="debRespRowCheck('${esc(r.tid)}',this.checked)">`}</td>
          <td style="font-family:monospace;font-size:.72rem;font-weight:700;white-space:nowrap;text-align:center">${esc(r.station_code)}</td>
          <td><strong style="font-family:monospace;font-size:.72rem">${esc(r.tid)}</strong><div style="font-size:.7rem;color:var(--text-3)">${fmtD(r.debit_date)}</div></td>
          <td style="font-size:.74rem;text-align:center">${esc(r.bucket)}<br><span style="color:var(--text-3);font-size:.68rem">${esc(r.loss_sub_bucket)}</span></td>
          <td style="font-size:.73rem;white-space:nowrap;text-align:center">${esc(r.shipment_type)||'-'}</td>
          <td style="font-weight:700;text-align:center;white-space:nowrap;color:var(--red-d)">${fmtA(r.amount)}</td>
          <td style="min-width:140px;max-width:200px;padding:4px 8px;text-align:center">${r.sub_type==='Recovery'&&r.recovery_ic_names ? renderPills(r.recovery_ic_names) : renderPills(r.ic_name)}</td>
          <td style="font-size:.72rem;white-space:nowrap;text-align:center">${r.sub_type==='Recovery'?esc(r.recovery_type)||'-':esc(r.cash_recovery_type)||'-'}</td>
          <td style="font-size:.72rem;text-align:center">${['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+r.recovery_month]||'-'}</td>
          <td style="font-size:.72rem;white-space:nowrap;text-align:center">${esc(r.confirm_by)||'-'}</td>
          <td style="font-size:.72rem;white-space:nowrap;color:var(--green-d);font-weight:600;text-align:center">${esc(r.cluster||r.cluster_manager)||'-'}</td>
          <td style="font-size:.72rem;text-align:center">${
            r.sub_type==='Recovery' ? (esc(r.recovery_confirm_by)||'-')
            : r.sub_type==='Case Open' ? (esc(r.tt_number)||'-')
            : '-'
          }</td>
          <td style="font-size:.72rem;max-width:140px;text-align:center">${
            r.sub_type==='Case Open' ? (esc(r.orphan_ref)||'-')
            : '-'
          }</td>
          <td style="font-size:.72rem;color:var(--blue);text-align:center">${
            r.sub_type==='Final Loss'
              ? (r.decision==='Yes' ? '<span style=\"color:var(--red-d);font-weight:700\">Accept Loss</span>'
                : r.decision==='No' ? '<span style=\"color:var(--green-d);font-weight:700\">Dispute</span>'
                : '-')
              : r.sub_type==='Case Open' ? (esc(r.decision)||'-')
              : '-'
          }</td>
          <td style="max-width:180px">${truncRemark(r.remarks)}</td>
          <td style="font-size:.72rem;color:var(--text-3);white-space:nowrap">${fmtD(r.submitted_at)}</td>
        </tr>`;

    document.getElementById('deb-body-rec').innerHTML = rec.length
      ? rec.map(disputeRow).join('')
      : '<tr class="empty-row"><td colspan="15">No Recovery responses</td></tr>';
    rec.forEach(function(row){ _adminDebRowCache[row.tid] = row; });

    document.getElementById('deb-body-co').innerHTML = co.length
      ? co.map(disputeRow).join('')
      : '<tr class="empty-row"><td colspan="15">No Case Open responses</td></tr>';
    co.forEach(function(row){ _adminDebRowCache[row.tid] = row; });

  } catch(e) {
    ['deb-body-fl','deb-body-rec','deb-body-co'].forEach(id => {
      document.getElementById(id).innerHTML = `<tr class="empty-row"><td colspan="13">Error: ${e.message}</td></tr>`;
    });
  }
}

// ── DEBIT QUEUE EDIT DRAWER (double-click on draft/published row) ─────────────
var _debQueueDrawerItem = null;

function _debQueueOpenDrawer(id) {
  var it = _debQueueCache[id];
  if (!it) return;
  _debQueueDrawerItem = it;

  var MONTHS = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var isDraft = it.status === 'draft';

  // Get ICs for this station (reuse existing ic list if station matches)
  _debQueueBuildDrawer(it, [], isDraft);
  // Load ICs async and rebuild if needed
  if (it.station_code) {
    fetch('/api/ic-list?station=' + encodeURIComponent(it.station_code))
      .then(function(r){ return r.json(); })
      .then(function(ics){ _debQueueBuildDrawer(it, ics, isDraft); })
      .catch(function(){});
  }
}

function _debQueueBuildDrawer(it, ics, isDraft) {
  var MONTHS = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  var overlay = document.getElementById('_debq-drawer-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = '_debq-drawer-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:8000;background:rgba(0,0,0,.45)';
    overlay.onclick = function(e){ if(e.target===overlay) _debQueueCloseDrawer(); };
    document.body.appendChild(overlay);
  }
  var drawer = document.getElementById('_debq-drawer');
  if (!drawer) {
    drawer = document.createElement('div');
    drawer.id = '_debq-drawer';
    drawer.style.cssText = [
      'position:fixed','top:0','right:0','height:100%','width:520px','max-width:96vw',
      'background:var(--card)','box-shadow:-8px 0 40px rgba(0,0,0,.2)',
      'z-index:8001','display:flex','flex-direction:column','overflow:hidden',
      'transform:translateX(100%)','transition:transform .25s cubic-bezier(.4,0,.2,1)'
    ].join(';');
    overlay.appendChild(drawer);
  }

  var statusPill = it.status === 'draft'
    ? '<span style="font-size:.72rem;padding:2px 8px;border-radius:6px;background:var(--amber-bg);color:var(--amber-d);font-weight:600">Draft</span>'
    : '<span style="font-size:.72rem;padding:2px 8px;border-radius:6px;background:var(--blue-bg);color:var(--navy);font-weight:600">Published</span>';

  function inp(id, val, type) {
    type = type || 'text';
    return '<input id="' + id + '" type="' + type + '" value="' + (val||'') + '" ' +
      'style="width:100%;box-sizing:border-box;padding:8px 10px;font-size:.85rem;border:1.5px solid var(--border);border-radius:8px;font-family:inherit">';
  }
  function sel(id, options, curVal) {
    return '<select id="' + id + '" style="width:100%;padding:8px 10px;font-size:.85rem;border:1.5px solid var(--border);border-radius:8px">' +
      options.map(function(o){
        var v = typeof o === 'object' ? o.value : o;
        var l = typeof o === 'object' ? o.label : o;
        return '<option value="' + v + '"' + (v===curVal?' selected':'') + '>' + l + '</option>';
      }).join('') + '</select>';
  }
  function row(label, inputHtml) {
    return '<div style="margin-bottom:12px">' +
      '<label style="font-size:.78rem;color:var(--text-2);display:block;margin-bottom:4px;font-weight:500">' + label + '</label>' +
      inputHtml + '</div>';
  }

  // IC multi-select — preselect names from it.ic_name
  var selectedNames = (it.ic_name||'').split(',').map(function(n){ return n.trim(); }).filter(Boolean);
  var icSelHtml;
  if (ics.length) {
    icSelHtml = '<select id="_debq-ic" multiple style="width:100%;min-height:80px;padding:4px;font-size:.84rem;border:1.5px solid var(--border);border-radius:8px">' +
      ics.map(function(ic){
        var sel = selectedNames.indexOf(ic.ic_name) !== -1 ? ' selected' : '';
        return '<option value="' + ic.ic_name + '"' + sel + '>' + ic.ic_name + '</option>';
      }).join('') + '</select>' +
      '<div style="font-size:.7rem;color:var(--text-3);margin-top:3px">Hold Ctrl/⌘ to select multiple</div>';
  } else {
    icSelHtml = '<input id="_debq-ic-text" type="text" value="' + (it.ic_name||'') + '" ' +
      'style="width:100%;box-sizing:border-box;padding:8px 10px;font-size:.85rem;border:1.5px solid var(--border);border-radius:8px">' +
      '<div style="font-size:.7rem;color:var(--text-3);margin-top:3px">Loading ICs…</div>';
  }

  var dateVal = it.debit_date ? String(it.debit_date).substring(0,10) : '';

  drawer.innerHTML =
    // Header
    '<div style="padding:16px 20px 12px;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;gap:10px">' +
      '<div style="flex:1">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">' +
          statusPill +
          '<span style="font-size:.7rem;color:var(--text-3)">Double-click to edit · Esc to close</span>' +
        '</div>' +
        '<div style="font-size:.95rem;font-weight:700;color:var(--navy);font-family:monospace">' + (it.tid||'') + '</div>' +
        '<div style="font-size:.78rem;color:var(--text-2);margin-top:2px">' + (it.station_code||'') + ' · ' + (it.debit_date?String(it.debit_date).substring(0,10):'') + '</div>' +
      '</div>' +
      '<button onclick="_debQueueCloseDrawer()" style="background:none;border:none;cursor:pointer;font-size:1.4rem;color:var(--text-3);line-height:1;padding:4px">×</button>' +
    '</div>' +

    // Scrollable form body
    '<div style="flex:1;overflow-y:auto;padding:16px 20px">' +

      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 16px">' +
        row('Impact Date', inp('_debq-date', dateVal, 'date')) +
        row('Amount (₹)', inp('_debq-amount', it.amount||'')) +
      '</div>' +

      row('Loss Bucket', inp('_debq-bucket', it.bucket)) +
      row('Sub Bucket', inp('_debq-subbucket', it.loss_sub_bucket)) +

      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 16px">' +
        row('Shipment Type', sel('_debq-shiptype', [
          {value:'',label:'—'},
          {value:'Delivery',label:'Delivery'},
          {value:'ReturnPickup',label:'Return Pickup'},
          {value:'Return Pickup',label:'Return Pickup (alt)'},
          {value:'Rejects',label:'Rejects'},
          {value:'Other',label:'Other'}
        ], it.shipment_type)) +
        row('Debit Type', sel('_debq-subtype', [
          {value:'New',label:'New'},
          {value:'Final Loss',label:'Final Loss'}
        ], it.sub_type)) +
      '</div>' +

      row('IC / Staff', icSelHtml) +
      row('Cluster Manager', inp('_debq-cluster', it.cluster)) +

      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 16px">' +
        row('Confirm By', inp('_debq-confirmby', it.confirm_by)) +
        row('Recovery Type', sel('_debq-recovery', [
          {value:'',label:'—'},
          {value:'IC Payment',label:'IC Payment'},
          {value:'SHIP BANK',label:'SHIP BANK'},
          {value:'CASH',label:'CASH'}
        ], it.cash_recovery_type)) +
      '</div>' +

      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 16px">' +
        row('Recovery Month', sel('_debq-recmonth',
          [{value:'',label:'—'}].concat(MONTHS.slice(1).map(function(m,i){ return {value:String(i+1),label:m}; })),
          String(it.recovery_month||''))) +
        row('CM Confirm', sel('_debq-cmconfirm', [
          {value:'',label:'—'},{value:'YES',label:'YES'},{value:'NO',label:'NO'}
        ], it.cm_confirm)) +
      '</div>' +

      row('Remarks', '<textarea id="_debq-remarks" rows="2" style="width:100%;box-sizing:border-box;padding:8px 10px;font-size:.85rem;border:1.5px solid var(--border);border-radius:8px;resize:vertical;font-family:inherit">' + (it.remarks||'') + '</textarea>') +

    '</div>' + // end scroll

    // Footer — Save Draft + Publish
    '<div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;gap:8px;align-items:center">' +
      '<button onclick="_debQueueCloseDrawer()" style="padding:8px 16px;font-size:.84rem;border:1.5px solid var(--border);border-radius:8px;background:none;cursor:pointer;color:var(--text-2)">Cancel</button>' +
      '<div style="flex:1"></div>' +
      '<button onclick="_debQueueSave(this.dataset.s)" id="_debq-save-btn" data-s="draft" style="padding:8px 18px;font-size:.84rem;font-weight:600;border:1.5px solid var(--border);border-radius:8px;background:var(--card);cursor:pointer;color:var(--text-2)">💾 Save Draft</button>' +
      ((window._adminUser && window._adminUser.role === 'cluster_manager') ? '' : '<button onclick="_debQueueSave(this.dataset.s)" id="_debq-pub-btn" data-s="published" style="padding:8px 20px;font-size:.84rem;font-weight:700;border:none;border-radius:8px;background:var(--navy);color:#fff;cursor:pointer">🚀 Save & Publish</button>') +
    '</div>';

  overlay.style.display = 'block';
  requestAnimationFrame(function(){ drawer.style.transform = 'translateX(0)'; });
}

function _debQueueCloseDrawer() {
  var drawer  = document.getElementById('_debq-drawer');
  var overlay = document.getElementById('_debq-drawer-overlay');
  if (drawer) drawer.style.transform = 'translateX(100%)';
  setTimeout(function(){ if(overlay) overlay.style.display = 'none'; }, 260);
  _debQueueDrawerItem = null;
}

async function _debQueueSave(btnOrStatus) {
  var targetStatus = (typeof btnOrStatus === 'string') ? btnOrStatus : (btnOrStatus && btnOrStatus.dataset ? btnOrStatus.dataset.s : 'draft');
  if (!_debQueueDrawerItem) return;
  var it  = _debQueueDrawerItem;
  var sBtn = document.getElementById('_debq-save-btn');
  var pBtn = document.getElementById('_debq-pub-btn');
  if (sBtn) sBtn.disabled = true;
  if (pBtn) pBtn.disabled = true;

  // Get IC names — from multi-select if available, else text input
  var icSel  = document.getElementById('_debq-ic');
  var icText = document.getElementById('_debq-ic-text');
  var icName = icSel
    ? Array.from(icSel.selectedOptions).map(function(o){ return o.value; }).filter(Boolean).join(', ')
    : (icText ? icText.value.trim() : it.ic_name||'');

  var payload = {
    impact_date:        document.getElementById('_debq-date').value || null,
    loss_bucket:        document.getElementById('_debq-bucket').value,
    loss_sub_bucket:    document.getElementById('_debq-subbucket').value,
    shipment_type:      document.getElementById('_debq-shiptype').value,
    cluster:            document.getElementById('_debq-cluster').value,
    ic_name:            icName,
    value:              document.getElementById('_debq-amount').value,
    confirm_by:         document.getElementById('_debq-confirmby').value,
    cash_recovery_type: document.getElementById('_debq-recovery').value,
    cm_confirm:         document.getElementById('_debq-cmconfirm').value,
    sub_type:           document.getElementById('_debq-subtype').value,
    remarks:            document.getElementById('_debq-remarks').value,
    recovery_month:     document.getElementById('_debq-recmonth').value,
    status:             targetStatus
  };

  try {
    var r = await fetch('/api/admin/debit-data/' + it.id, {
      method: 'PATCH',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    var d = await r.json();
    if (r.ok && d.success) {
      toast(targetStatus === 'published' ? '🚀 Entry published ✓' : '💾 Draft saved ✓', 'success');
      _debQueueCloseDrawer();
      loadDebAdmin();
    } else {
      toast('Save failed: ' + (d.error||'unknown'), 'error');
      if (sBtn) sBtn.disabled = false;
      if (pBtn) pBtn.disabled = false;
    }
  } catch(e) {
    toast('Error: ' + e.message, 'error');
    if (sBtn) sBtn.disabled = false;
    if (pBtn) pBtn.disabled = false;
  }
}

// Close drawer on Escape key
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    _debQueueCloseDrawer();
    _adminDebCloseDrawer();
  }
});

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
    const resp = await fetch('/api/admin/debit-queue?' + qp).then(r => r.json(), {credentials:'include'});
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
    body.innerHTML = debAdminData.map(it => {
      return `
      <tr id="dadmin-row-${it.id}" class="dadmin-row" style="vertical-align:top;cursor:pointer" ondblclick="_debQueueOpenDrawer(${it.id})">
        <td style="text-align:center;padding-top:8px"><input type="checkbox" class="deb-row-chk" value="${it.id}" onchange="debRowCheck(${it.id},this.checked)"></td>
        <td style="font-family:monospace;font-size:.72rem;font-weight:700;white-space:nowrap;text-align:center">${esc(it.station_code)}</td>
        <td style="font-family:monospace;font-size:.68rem;color:var(--text-2);white-space:nowrap;text-align:center">${esc(it.tid)}</td>
        <td style="white-space:nowrap;font-size:.74rem;text-align:center">${it.debit_date?it.debit_date.toString().substring(0,10):'-'}</td>
        <td style="font-size:.72rem;color:var(--text-3);white-space:nowrap;text-align:center">${esc(it.cluster)}</td>
        <td style="font-size:.74rem;white-space:nowrap;text-align:center">${esc(it.bucket)}</td>
        <td style="font-size:.72rem;color:var(--text-2);white-space:nowrap;text-align:center">${esc(it.loss_sub_bucket)}</td>
        <td style="font-size:.72rem;white-space:nowrap;text-align:center">${esc(it.shipment_type)}</td>
        <td style="min-width:140px;max-width:200px;padding:6px 8px;text-align:center">${renderPills(it.ic_name)}</td>
        <td style="font-weight:700;text-align:center;white-space:nowrap;color:var(--red-d)">₹${parseFloat(it.amount||0).toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
        <td style="font-size:.72rem;white-space:nowrap;text-align:center">${esc(it.confirm_by)}</td>
        <td style="font-size:.72rem;white-space:nowrap;text-align:center">${esc(it.cash_recovery_type)}</td>
        <td style="font-size:.72rem;text-align:center">${it.recovery_month ? ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][it.recovery_month]||it.recovery_month : '—'}</td>
        <td style="font-size:.72rem;text-align:center;white-space:nowrap">${it.cm_confirm||'-'}</td>
        <td style="font-size:.72rem;text-align:center">${
          it.status === 'draft'
            ? `<select class="tbl-inp" style="font-size:.72rem;padding:1px 4px;border-radius:6px;width:110px" onchange="updateDebSubType(${it.id},this.value)">
                 <option value="Final Loss" ${it.sub_type==='Final Loss'?'selected':''}>Final Loss</option>
                 <option value="New"        ${it.sub_type==='New'       ?'selected':''}>New</option>
               </select>`
            : `<span style="padding:2px 7px;border-radius:6px;font-weight:600;font-size:.7rem;background:${
                it.sub_type==='Final Loss' ? 'var(--red-bg)' : 'var(--blue-bg)'};color:${
                it.sub_type==='Final Loss' ? 'var(--red-d)'  : 'var(--blue)'}">${esc(it.sub_type)||'-'}</span>`
        }</td>
        <td style="max-width:180px;text-align:center">${truncRemark(it.remarks)}</td>
        <td>${STATUS_PILL[it.status]||it.status}</td>
        <td style="white-space:nowrap;text-align:center">
          <div style="display:flex;gap:3px">
            ${it.status==='draft'
              ? ((window._adminUser && window._adminUser.role === 'cluster_manager') ? '' : `<button class="btn btn-green btn-sm" onclick="publishSelected([${it.id}])" title="Publish">🚀</button>`)
              : ''}
            <button class="btn btn-red btn-sm" onclick="deleteDebEntry(${it.id})" title="Delete">✕</button>
          </div>
        </td>
      </tr>`;
    }).join('');
    // Populate edit cache
    debAdminData.forEach(function(it){ _debQueueCache[it.id] = it; });
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
  const r = await fetch(`/api/admin/debit-data/${id}`, {method:'DELETE', credentials:'include'});
  if (r.ok) { document.getElementById(`dadmin-row-${id}`)?.remove(); toast('Deleted.', 'success'); }
  else toast('Delete failed.', 'error');
}

async function deleteSelected() {
  if (!debSelectedIds.size) return toast('Select entries to delete.', 'warning');
  if (!confirm(`Delete ${debSelectedIds.size} entries?`)) return;
  await Promise.all([...debSelectedIds].map(id =>
    fetch(`/api/admin/debit-data/${id}`, {method:'DELETE', credentials:'include'})
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
    // Sync station from filter, then load ICs
    setTimeout(function() {
      var filterSel = document.getElementById('deb-admin-station-filter');
      var dnewSel   = document.getElementById('dnew-station');
      // If filter has a specific station selected, mirror it to the new entry form
      if (filterSel && filterSel.value && dnewSel) {
        dnewSel.value = filterSel.value;
      }
      if (dnewSel && dnewSel.value) loadNewRowICs();
    }, 200);
  }
}

async function loadNewRowICs() {
  const station = document.getElementById('dnew-station').value;
  const sel     = document.getElementById('dnew-ic');
  if (!station) { sel.innerHTML = '<option value="">Select station first…</option>'; return; }
  sel.innerHTML = '<option>Loading…</option>';
  try {
    const data = await fetch('/api/ic-list?station=' + encodeURIComponent(station)).then(function(r){return r.json();});
    if (data.error) throw new Error(data.error);
    const ics = data.ics || [];
    // Clear all and ensure nothing pre-selected
    sel.innerHTML = '';
    // Deselect all first (belt-and-braces for multi-select)
    Array.from(sel.options).forEach(function(o){ o.selected = false; });
    if (ics.length) {
      ics.forEach(function(u) {
        const name = (u.ic_name||'').trim();
        const opt  = document.createElement('option');
        opt.value = name;
        opt.textContent = name + (u.designation ? ' · ' + u.designation : '');
        opt.selected = false; // explicitly not selected
        sel.appendChild(opt);
      });
    } else {
      sel.innerHTML = '<option value="">No staff found for ' + station + '</option>';
    }
    // Auto-fill CM directly from the same API response
    const clEl = document.getElementById('dnew-cluster');
    if (clEl && data.cluster_manager) {
      clEl.value = data.cluster_manager;
      clEl.style.background = '#f0fdf4';
      clEl.style.color = 'var(--green-d)';
      clEl.style.fontWeight = '600';
    } else if (clEl) {
      clEl.style.background = '';
      clEl.style.color = '';
      clEl.style.fontWeight = '';
    }
  } catch(e) {
    sel.innerHTML = '<option value="">Could not load staff</option>';
    console.error('ic-list error:', e);
  }
}

async function saveNewDebRow() {
  const tid     = document.getElementById('dnew-tid').value.trim();
  const station = document.getElementById('dnew-station').value;
  const value   = document.getElementById('dnew-value').value;
  const icSel = document.getElementById('dnew-ic');
  const icNames = Array.from(icSel ? icSel.selectedOptions : []).map(function(o){return o.value;}).filter(Boolean);
  if (!tid)            return toast('TID is required.', 'warning');
  if (!station)        return toast('Station is required.', 'warning');
  if (!value || parseFloat(value) <= 0) return toast('Amount must be > 0.', 'warning');

  const payload = {
    tid, station_code: station,
    impact_date:        document.getElementById('dnew-date').value || null,
    loss_bucket:        document.getElementById('dnew-bucket').value,
    loss_sub_bucket:    document.getElementById('dnew-subbucket').value,
    shipment_type:      document.getElementById('dnew-shiptype').value,
    cluster:            document.getElementById('dnew-cluster').value || null,
    ic_name:            Array.from(document.getElementById('dnew-ic').selectedOptions).map(function(o){return o.value;}).filter(Boolean).join(', '),
    value:              parseFloat(value),
    confirm_by:         document.getElementById('dnew-confirmby').value,
    cash_recovery_type: document.getElementById('dnew-recovery').value,
    cm_confirm:         document.getElementById('dnew-cmconfirm').value,
    sub_type:           document.getElementById('dnew-subtype').value || 'New',
    remarks:            document.getElementById('dnew-remarks').value,
    recovery_month:     parseInt(document.getElementById('dnew-recovery-month').value) || null,
  };

  const r = await fetch('/api/admin/debit-data/single', {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
  });
  if (r.ok) {
    const rd = await r.json();
    const msg = rd.was_answered
      ? 'Entry re-created as draft ✓ (previously answered — reset to draft)'
      : 'Entry added as draft ✓';
    toast(msg, 'success');
    ['dnew-tid','dnew-date','dnew-bucket','dnew-subbucket','dnew-value','dnew-confirmby','dnew-remarks','dnew-cluster']
      .forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
    ['dnew-station','dnew-shiptype','dnew-recovery','dnew-recovery-month','dnew-cmconfirm','dnew-subtype']
      .forEach(id => { const el = document.getElementById(id); if(el) el.selectedIndex=0; });
    // Clear multi-select IC
    const icEl = document.getElementById('dnew-ic');
    if (icEl) Array.from(icEl.options).forEach(function(o){o.selected=false;});
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
var debAdmFile = null;
var _debParsedRows = [];

function onDebAdmFileSelected(inp) {
  debAdmFile = inp.files[0] || null;
  var lbl = document.getElementById('deb-adm-file-lbl');
  var btn = document.getElementById('btn-deb-adm-upload');
  if (lbl) lbl.textContent = debAdmFile ? debAdmFile.name : 'Upload Excel';
  if (btn) btn.disabled = !debAdmFile;
  _debParsedRows = [];
  var prev = document.getElementById('deb-upload-preview');
  if (prev) prev.style.display = 'none';
}

async function uploadDebEntries() {
  if (!debAdmFile) return;
  if (_debParsedRows.length) { await _debDoImport(); return; }

  var statusEl = document.getElementById('deb-adm-status');
  statusEl.textContent = 'Parsing file…';

  var fd = new FormData();
  fd.append('file', debAdmFile);
  try {
    var res = await fetch('/api/admin/debit-parse', {method:'POST', body:fd, credentials:'include'});
    var d   = await res.json();
    if (!d.success) { statusEl.textContent = 'Parse error: ' + (d.error||'unknown'); return; }
    if (!d.rows || !d.rows.length) { statusEl.textContent = 'No valid rows found in file.'; return; }
    _debParsedRows = d.rows;
    statusEl.textContent = '';
    _debShowPreview();
  } catch(e) {
    statusEl.textContent = 'Error: ' + e.message;
  }
}

function _debSafeText(v) {
  return (v||'').toString()
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _debShowPreview() {
  var rows = _debParsedRows;
  var prev = document.getElementById('deb-upload-preview');
  if (!prev) {
    prev = document.createElement('div');
    prev.id = 'deb-upload-preview';
    var statusEl = document.getElementById('deb-adm-status');
    statusEl.parentNode.insertBefore(prev, statusEl.nextSibling);
  }

  // Build header row
  var headerCells = ['TID','Station','Impact Date (editable)','Bucket','Sub Bucket','Shipment Type','Amount','Recovery Month','IC / Staff'];
  var theadHtml = '<tr>' + headerCells.map(function(h,i) {
    var extra = (i===2) ? ' style="color:var(--amber-d);font-weight:400"' : '';
    return '<th style="padding:6px 10px;text-align:' + (i===6?'right':'left') + ';border-bottom:2px solid var(--border);white-space:nowrap;font-size:.72rem;color:var(--text-3);text-transform:uppercase">' + h + '</th>';
  }).join('') + '</tr>';

  // Build data rows
  var tbodyHtml = rows.map(function(r, idx) {
    return '<tr style="border-bottom:1px solid var(--border)">' +
      '<td style="padding:5px 10px;font-family:monospace;font-size:.73rem;white-space:nowrap">' + _debSafeText(r.tid) + '</td>' +
      '<td style="padding:5px 10px;font-size:.78rem">' + _debSafeText(r.station) + '</td>' +
      '<td style="padding:5px 10px"><input type="date" value="' + _debSafeText(r.impact_date||'') + '" data-idx="' + idx + '" class="deb-prev-date" style="font-size:.76rem;padding:3px 6px;border:1px solid var(--border);border-radius:5px"></td>' +
      '<td style="padding:5px 10px;font-size:.74rem">' + _debSafeText(r.loss_bucket) + '</td>' +
      '<td style="padding:5px 10px;font-size:.73rem;color:var(--text-2)">' + _debSafeText(r.loss_sub_bucket) + '</td>' +
      '<td style="padding:5px 10px;font-size:.74rem">' + _debSafeText(r.shipment_type) + '</td>' +
      '<td style="padding:5px 10px;text-align:right;font-weight:600;color:var(--red-d)">₹' + Number(r.amount||0).toLocaleString('en-IN') + '</td>' +
      '<td style="padding:5px 10px;font-size:.74rem;text-align:center">' + (r.recovery_month ? ['—','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][r.recovery_month]||r.recovery_month : '—') + '</td>' +
      '<td style="padding:5px 10px;font-size:.74rem">' + _debSafeText(r.ic_name) + '</td>' +
    '</tr>';
  }).join('');

  prev.innerHTML =
    '<div style="padding:10px 16px 8px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;border-bottom:1px solid var(--border)">' +
      '<div style="font-size:.82rem;font-weight:700;color:var(--navy)">' + rows.length + ' rows parsed — review &amp; confirm</div>' +
      '<div style="display:flex;gap:8px">' +
        '<button onclick="_debCancelPreview()" style="padding:5px 14px;font-size:.78rem;border:1px solid var(--border);border-radius:7px;background:none;cursor:pointer">Cancel</button>' +
        '<button onclick="_debDoImport()" style="padding:5px 14px;font-size:.78rem;font-weight:700;border:none;border-radius:7px;background:var(--amber);color:#fff;cursor:pointer">Import ' + rows.length + ' rows →</button>' +
      '</div>' +
    '</div>' +
    '<div style="overflow:auto;max-height:340px">' +
      '<table style="width:100%;border-collapse:collapse;font-size:.78rem">' +
        '<thead style="position:sticky;top:0;background:var(--bg);z-index:1">' + theadHtml + '</thead>' +
        '<tbody>' + tbodyHtml + '</tbody>' +
      '</table>' +
    '</div>';

  prev.style.display = 'block';

  // Wire up date inputs
  prev.querySelectorAll('.deb-prev-date').forEach(function(inp) {
    inp.addEventListener('change', function() {
      var idx = parseInt(this.dataset.idx);
      if (_debParsedRows[idx]) _debParsedRows[idx].impact_date = this.value;
    });
  });
}

function _debCancelPreview() {
  _debParsedRows = [];
  debAdmFile = null;
  var lbl = document.getElementById('deb-adm-file-lbl'); if (lbl) lbl.textContent = 'Upload Excel';
  var btn = document.getElementById('btn-deb-adm-upload'); if (btn) btn.disabled = true;
  var prev = document.getElementById('deb-upload-preview'); if (prev) prev.style.display = 'none';
  var status = document.getElementById('deb-adm-status'); if (status) status.textContent = '';
  var fi = document.getElementById('deb-adm-file'); if (fi) fi.value = '';
}

async function _debDoImport() {
  if (!_debParsedRows.length) return;
  var statusEl = document.getElementById('deb-adm-status');
  statusEl.textContent = 'Importing…';
  var prev = document.getElementById('deb-upload-preview');
  if (prev) prev.style.display = 'none';

  try {
    var res = await fetch('/api/admin/debit-import-rows', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({rows: _debParsedRows})
    });
    var d = await res.json();

    if (!d.success) {
      statusEl.textContent = 'Import error: ' + (d.error||'unknown');
      return;
    }

    var hasDups = d.duplicates && d.duplicates.length > 0;
    statusEl.textContent = d.inserted + ' ' + (d.inserted===1?'entry':'entries') + ' imported as draft' +
      (hasDups ? ' · ' + d.duplicates.length + ' duplicate(s) skipped' : '') + '.';

    _debCancelPreview();
    loadDebAdmin();

    if (hasDups) {
      _debShowDupModal(d.inserted, d.duplicates);
    }

  } catch(e) {
    statusEl.textContent = 'Import error: ' + e.message;
  }
}

function _debShowDupModal(inserted, duplicates) {
  // Remove any existing modal
  var old = document.getElementById('_deb-dup-modal');
  if (old) old.remove();

  // Create overlay
  var overlay = document.createElement('div');
  overlay.id = '_deb-dup-modal';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:9999',
    'background:rgba(0,0,0,.45)',
    'display:flex', 'align-items:center', 'justify-content:center', 'padding:20px'
  ].join(';');

  // Create box
  var box = document.createElement('div');
  box.style.cssText = [
    'background:#eff6ff', 'border:1.5px solid #93c5fd',
    'border-radius:14px', 'width:100%', 'max-width:540px',
    'box-shadow:0 20px 60px rgba(0,0,0,.25)', 'overflow:hidden'
  ].join(';');

  // Title bar
  var titleBar = document.createElement('div');
  titleBar.style.cssText = 'padding:18px 24px 0;font-size:1rem;font-weight:700;color:var(--navy)';
  titleBar.textContent = '⚠️ ' + duplicates.length + ' Duplicate TID' + (duplicates.length===1?'':'s') + ' Skipped';

  // Subtitle
  var sub = document.createElement('div');
  sub.style.cssText = 'padding:6px 24px 0;font-size:.82rem;color:var(--text-2)';
  sub.textContent = 'These TIDs already exist and were not imported:';

  // List container (scrollable)
  var listWrap = document.createElement('div');
  listWrap.style.cssText = 'max-height:280px;overflow-y:auto;padding:12px 24px';

  duplicates.forEach(function(dup) {
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:baseline;gap:8px;padding:5px 0;border-bottom:1px solid rgba(0,0,0,.06)';

    var code = document.createElement('code');
    code.style.cssText = 'font-size:.78rem;background:rgba(0,0,0,.06);padding:2px 6px;border-radius:4px;white-space:nowrap;flex-shrink:0';
    code.textContent = dup.tid;

    var info = document.createElement('span');
    info.style.cssText = 'font-size:.78rem;color:var(--text-2)';
    info.textContent = dup.info;

    row.appendChild(code);
    row.appendChild(info);
    listWrap.appendChild(row);
  });

  // Footer
  var footer = document.createElement('div');
  footer.style.cssText = 'padding:12px 24px 18px;display:flex;align-items:center;justify-content:space-between';

  var note = document.createElement('div');
  note.style.cssText = 'font-size:.78rem;color:var(--green-d);font-weight:600';
  note.textContent = '✓ ' + inserted + ' new ' + (inserted===1?'entry was':'entries were') + ' imported successfully.';

  var okBtn = document.createElement('button');
  okBtn.className = 'btn btn-ghost';
  okBtn.textContent = 'OK';
  okBtn.onclick = function() { overlay.remove(); };

  footer.appendChild(note);
  footer.appendChild(okBtn);

  box.appendChild(titleBar);
  box.appendChild(sub);
  box.appendChild(listWrap);
  box.appendChild(footer);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
}