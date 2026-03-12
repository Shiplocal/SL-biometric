// ── Stations Tab ────────────────────────────────────────────────────────────

let _stationsAll      = [];
let _stationsFiltered = [];
let _stationsPage     = 1;
const STATIONS_PER_PAGE = 20;

async function loadStations() {
  const tbody = document.getElementById('stations-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-3)">Loading…</td></tr>';
  try {
    _stationsAll = await fetch('/api/admin/stations-list').then(r=>r.json());
    _stationsFiltered = [..._stationsAll];
    _stationsPage = 1;
    renderStations();
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--red-d);padding:20px">Error: ${e.message}</td></tr>`;
  }
}

function renderStations() {
  const tbody = document.getElementById('stations-body');
  if (!tbody) return;
  const rows = _stationsFiltered;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-3)">No stations found</td></tr>';
    _stationsPager(0);
    return;
  }
  const start = (_stationsPage - 1) * STATIONS_PER_PAGE;
  const page  = rows.slice(start, start + STATIONS_PER_PAGE);

  tbody.innerHTML = page.map(s => {
    const statusPill = s.status === 0
      ? '<span class="pill p-active">Active</span>'
      : '<span class="pill p-open">Inactive</span>';
    const esicPill = s.esic
      ? '<span class="pill p-enrolled" style="font-size:.7rem">ESIC ✓</span>'
      : '<span style="color:var(--text-3);font-size:.8rem">—</span>';
    const cam = s.camera_id
      ? `<span class="mono" style="font-size:.75rem">${escH(s.camera_id)}</span>`
      : '<span style="color:var(--text-3)">—</span>';
    const addr = s.address
      ? `<div style="font-size:.78rem;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escH(s.address)}">${escH(s.address)}${s.pincode?' — '+s.pincode:''}</div>`
      : '<span style="color:var(--text-3)">—</span>';
    const email = s.store_email
      ? `<a href="mailto:${escH(s.store_email)}" style="font-size:.78rem;color:var(--blue-d)">${escH(s.store_email)}</a>`
      : '<span style="color:var(--text-3)">—</span>';
    const cat = s.store_cat
      ? `<span style="font-size:.75rem;background:var(--bg-2);padding:2px 7px;border-radius:99px">${escH(s.store_cat)}</span>`
      : '—';

    return `<tr style="cursor:pointer" onclick="openStationDetail(${JSON.stringify(s).replace(/"/g,'&quot;')})">
      <td><span class="mono" style="font-weight:700;font-size:.92rem">${escH(s.station_code)}</span></td>
      <td style="font-size:.83rem">${escH(s.store_name||'—')}</td>
      <td>${cat}</td>
      <td>${addr}</td>
      <td>${email}</td>
      <td>${esicPill}</td>
      <td>${cam}</td>
      <td>${statusPill}</td>
    </tr>`;
  }).join('');

  _stationsPager(rows.length);
}

function _stationsPager(total) {
  const el = document.getElementById('stations-pagination');
  if (!el) return;
  const pages = Math.max(1, Math.ceil(total / STATIONS_PER_PAGE));
  const from  = total === 0 ? 0 : (_stationsPage - 1) * STATIONS_PER_PAGE + 1;
  const to    = Math.min(_stationsPage * STATIONS_PER_PAGE, total);
  el.innerHTML =
    `<span>${total === 0 ? 'No stations' : `${from}–${to} of ${total} stations`}</span>` +
    `<div style="display:flex;gap:6px">` +
      `<button class="btn btn-ghost btn-sm" ${_stationsPage<=1?'disabled':''} onclick="_stationsGoTo(${_stationsPage-1})">← Prev</button>` +
      `<span style="padding:4px 10px;background:var(--bg-2);border-radius:6px;font-weight:600">${_stationsPage} / ${pages}</span>` +
      `<button class="btn btn-ghost btn-sm" ${_stationsPage>=pages?'disabled':''} onclick="_stationsGoTo(${_stationsPage+1})">Next →</button>` +
    `</div>`;
}

function _stationsGoTo(p) { _stationsPage = p; renderStations(); }

function filterStations(q) {
  const lq = (q||'').toLowerCase();
  _stationsFiltered = lq
    ? _stationsAll.filter(s =>
        (s.station_code||'').toLowerCase().includes(lq) ||
        (s.store_name||'').toLowerCase().includes(lq) ||
        (s.address||'').toLowerCase().includes(lq) ||
        (s.store_email||'').toLowerCase().includes(lq) ||
        (s.store_cat||'').toLowerCase().includes(lq) ||
        (s.pincode||'').includes(lq))
    : [..._stationsAll];
  _stationsPage = 1;
  renderStations();
}

function openStationDetail(s) {
  // Reuse staff profile modal for station detail
  const modal = document.getElementById('staff-profile-modal');
  if (!modal) return;
  document.getElementById('spm-name').textContent = s.station_code + (s.store_name ? ' — ' + s.store_name : '');
  document.getElementById('spm-role').textContent = (s.store_cat || 'Station') + (s.esic ? ' · ESIC Enabled' : '');
  document.getElementById('spm-body').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      ${_spmSection('Location', [
        ['Address', s.address], ['Pincode', s.pincode],
        ['State', s.state], ['Latitude', s.latitude], ['Longitude', s.longitude]
      ])}
      ${_spmSection('Contact', [
        ['Store Email', s.store_email], ['Amazon ID', s.amazon_id]
      ])}
      ${_spmSection('Infrastructure', [
        ['Serial No', s.serial_no], ['Camera ID', s.camera_id],
        ['ESIC', s.esic ? 'Yes' : 'No'], ['Store Category', s.store_cat]
      ])}
      ${_spmSection('Management', [
        ['Cluster Manager ID', s.primary_cluster_manager],
        ['Legacy Store ID', s.legacy_store_id],
        ['Status', s.status === 0 ? 'Active' : 'Inactive'],
        ['Added', s.added_date ? s.added_date.substring(0,10) : '—']
      ])}
    </div>`;
  modal.classList.remove('hidden');
}