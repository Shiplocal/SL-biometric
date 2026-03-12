// ── WHIC TAB — Enrolments + Users ───────────────────────────────────────────

let allEnrolled     = [];
let _enrollFiltered = [];
let _enrollPage     = 1;
const ENROLL_PER_PAGE = 15;

let _whicFiltered = [];
let _whicPage     = 1;
const WHIC_PER_PAGE = 15;

// ── Pagination helper ────────────────────────────────────
function _renderPager(containerId, page, total, perPage, onNav) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const from  = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to    = Math.min(page * perPage, total);
  el.innerHTML =
    `<span>${total === 0 ? 'No records' : `${from}–${to} of ${total}`}</span>` +
    `<div style="display:flex;gap:6px">` +
      `<button class="btn btn-ghost btn-sm" ${page<=1?'disabled':''} onclick="(${onNav})(${page-1})">← Prev</button>` +
      `<span style="padding:4px 10px;background:var(--bg-2);border-radius:6px;font-weight:600">${page} / ${pages}</span>` +
      `<button class="btn btn-ghost btn-sm" ${page>=pages?'disabled':''} onclick="(${onNav})(${page+1})">Next →</button>` +
    `</div>`;
}

// ── ENROLMENTS ───────────────────────────────────────────
async function loadEnroll() {
  try {
    const pending = await fetch('/api/enroll-pending').then(r=>r.json());
    const badge = document.getElementById('cnt-enroll');
    if (badge) { badge.textContent = pending.length; badge.style.display = pending.length ? '' : 'none'; }

    // Pending cards
    const pw = document.getElementById('enroll-pending-wrap');
    if (!pending.length) {
      pw.innerHTML = '<div style="text-align:center;color:var(--text-3);padding:28px;font-size:.84rem">No pending enrolments ✓</div>';
    } else {
      window._enrollPhotos = {};
      pending.forEach(e => { if(e.enroll_photo) window._enrollPhotos[e.ic_id] = e.enroll_photo; });
      const cards = pending.map(e => {
        const nm = (e.ic_name||'Unknown').replace(/'/g,'&#39;');
        const id = String(e.ic_id);
        const st = String(e.station_code);
        const at = String(e.enrolled_at||'');
        const photoEl = e.enroll_photo
          ? `<img class="enroll-photo" src="${e.enroll_photo}" onclick="showPhotoById('${id}','${nm}','${st}','${at}')" style="cursor:zoom-in">`
          : '<div class="enroll-photo-placeholder">👤</div>';
        const time = e.enrolled_at ? new Date(e.enrolled_at).toLocaleString('en-IN') : '-';
        return `<div class="enroll-card pending">
          ${photoEl}
          <div class="enroll-info">
            <div class="enroll-name">${e.ic_name||'Unknown'}</div>
            <div class="enroll-id">${id}</div>
            <div class="enroll-st">📍 ${st}</div>
            <div class="enroll-time">🕐 ${time}</div>
            <div class="enroll-acts">
              <button class="btn btn-green btn-sm" onclick="approveEnroll('${id}','${nm}')">✓ Approve</button>
              <button class="btn btn-red btn-sm" onclick="rejectEnroll('${id}','${nm}')">✕ Reject</button>
            </div>
          </div></div>`;
      });
      pw.innerHTML = '<div class="enroll-grid">' + cards.join('') + '</div>';
    }

    // Enrolled (approved) — fetch from /api/users
    const users = await fetch('/api/users').then(r=>r.json());
    allEnrolled = users.filter(u => u.enroll_status === 'APPROVED');
    _enrollFiltered = [...allEnrolled];
    _enrollPage = 1;
    renderApproved();

  } catch(e) { toast('Failed to load enrolments.','error'); }
}

function renderApproved() {
  const aw = document.getElementById('enroll-approved-wrap');
  if (!aw) return;
  if (!_enrollFiltered.length) {
    aw.innerHTML = '<div style="text-align:center;color:var(--text-3);padding:24px;font-size:.84rem">No approved enrolments yet</div>';
    _renderPager('enrolled-pagination', 1, 0, ENROLL_PER_PAGE, '_enrollGoTo');
    return;
  }
  const start = (_enrollPage - 1) * ENROLL_PER_PAGE;
  const page  = _enrollFiltered.slice(start, start + ENROLL_PER_PAGE);
  aw.innerHTML = `<div class="tbl-wrap"><table>
    <thead><tr><th>Name</th><th>IC ID</th><th>Station</th><th>Photo</th><th>Actions</th></tr></thead>
    <tbody>${page.map(u => {
      const nm = (u.ic_name||'').replace(/'/g,"\\'");
      const id = String(u.ic_id);
      const st = String(u.station_code||'');
      const thumb = u.enroll_photo
        ? `<img src="${u.enroll_photo}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;cursor:zoom-in;border:2px solid var(--border)" onclick="showPhoto('${id}','${nm}','${st}','','${u.enroll_photo}')">`
        : `<div style="width:36px;height:36px;border-radius:50%;background:var(--bg-2);display:flex;align-items:center;justify-content:center;font-size:.9rem;font-weight:700;color:var(--text-2)">${(u.ic_name||'?')[0].toUpperCase()}</div>`;
      return `<tr>
        <td><strong>${u.ic_name||'-'}</strong></td>
        <td><span class="mono">${id}</span></td>
        <td>${st}</td>
        <td>${thumb}</td>
        <td><div class="acts">
          <button class="btn btn-ghost btn-sm" onclick="deregUser('${id}','${nm}')">Remove Face</button>
        </div></td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
  _renderPager('enrolled-pagination', _enrollPage, _enrollFiltered.length, ENROLL_PER_PAGE, '_enrollGoTo');
}

function _enrollGoTo(p) { _enrollPage = p; renderApproved(); }

function filterEnrolled(term) {
  const t = (term||'').toLowerCase();
  _enrollFiltered = t
    ? allEnrolled.filter(u =>
        (u.ic_name||'').toLowerCase().includes(t) ||
        String(u.ic_id).includes(t) ||
        (u.station_code||'').toLowerCase().includes(t))
    : [...allEnrolled];
  _enrollPage = 1;
  renderApproved();
}

// ── ALL WHIC STAFF ───────────────────────────────────────
async function loadUsers() {
  try {
    const users = await fetch('/api/users').then(r=>r.json());
    allUsersData = users;
    document.getElementById('cnt-users').textContent = users.length;
    const stSel = document.getElementById('users-station-filter');
    const stations = [...new Set(users.map(u=>u.station_code))].sort();
    const curSt = stSel.value;
    stSel.innerHTML = '<option value="">All Stations</option>';
    stations.forEach(s => stSel.innerHTML += `<option value="${s}" ${s===curSt?'selected':''}>${s}</option>`);
    _applyWhicFilter();
  } catch(e) { toast('Failed to load users: '+e.message,'error'); }
}

function _applyWhicFilter(searchTerm) {
  const stFilter = document.getElementById('users-station-filter')?.value || '';
  const stStatus = document.getElementById('users-status-filter')?.value || 'active';
  const q = (searchTerm !== undefined ? searchTerm : (document.getElementById('s-au')?.value || '')).toLowerCase();
  let users = allUsersData || [];
  if (stFilter) users = users.filter(u => u.station_code === stFilter);
  if (stStatus === 'active')     users = users.filter(u => u.is_active !== 0);
  if (stStatus === 'offboarded') users = users.filter(u => u.is_active === 0);
  if (q) users = users.filter(u =>
    (u.ic_name||'').toLowerCase().includes(q) ||
    String(u.ic_id).includes(q) ||
    (u.station_code||'').toLowerCase().includes(q));
  _whicFiltered = users;
  _whicPage = 1;
  const wc = document.getElementById('whic-count');
  if (wc) wc.textContent = '(' + (allUsersData||[]).length + ')';
  renderUsers();
}

function whicSearch(term) { _applyWhicFilter(term); }
function filterUsersStation() { _applyWhicFilter(); }

function renderUsers() {
  const tbody = document.getElementById('all-users');
  if (!tbody) return;
  if (!_whicFiltered.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No users found</td></tr>';
    _renderPager('whic-pagination', 1, 0, WHIC_PER_PAGE, '_whicGoTo');
    return;
  }
  const start = (_whicPage - 1) * WHIC_PER_PAGE;
  const page  = _whicFiltered.slice(start, start + WHIC_PER_PAGE);
  tbody.innerHTML = page.map(u => {
    const isOff = u.is_active === 0;
    const statusPill = u.enroll_status==='APPROVED'
      ? '<span class="pill p-enrolled">Face ✓</span>'
      : u.enroll_status==='PENDING'
      ? '<span class="pill p-sys">Pending</span>'
      : '<span class="pill p-open">No face</span>';
    const activePill = isOff
      ? '<span class="pill" style="background:var(--red-bg);color:var(--red-d);border:1px solid rgba(239,68,68,.2)">Offboarded</span>'
      : '<span class="pill p-active">Active</span>';
    const hasAccess  = !!u.can_access_modules;
    const isEnrolled = u.enroll_status === 'APPROVED';
    const nm = (u.ic_name||'').replace(/'/g,"\\'");
    const accessBtn = (!isOff && isEnrolled)
      ? `<button class="btn btn-sm ${hasAccess?'btn-amber':'btn-green'}"
           title="${hasAccess?'Revoke module access':'Grant module access'}"
           onclick="toggleUserAccess('${u.ic_id}','${nm}',${!hasAccess})">
           ${hasAccess?'🔓 Revoke':'🔑 Grant'}
         </button>` : '';
    const acts = isOff
      ? `<button class="btn btn-ghost btn-sm" onclick="reactivateUser('${u.ic_id}','${nm}')">↩ Reactivate</button>`
      : isEnrolled
      ? `<div class="acts">
           <button class="btn btn-ghost btn-sm" onclick="deregUser('${u.ic_id}','${nm}')">Remove Face</button>
           <button class="btn btn-red btn-sm" onclick="openOffboard('${u.ic_id}','${nm}')">✕ Offboard</button>
         </div>` : '';
    return `<tr style="${isOff?'opacity:.55':''}">
      <td><strong>${u.ic_name||'-'}</strong></td>
      <td><span class="mono">${u.ic_id}</span></td>
      <td>${u.station_code||'-'}</td>
      <td>${statusPill}</td>
      <td>${u.open_violations>0?`<span class="v-cnt">⚠ ${u.open_violations}</span>`:'-'}</td>
      <td>
        ${activePill}
        ${hasAccess&&!isOff?'<span class="pill p-enrolled" style="margin-top:3px;display:block;font-size:.65rem">Access ✓</span>':''}
      </td>
      <td>${accessBtn}${acts}</td>
    </tr>`;
  }).join('');
  _renderPager('whic-pagination', _whicPage, _whicFiltered.length, WHIC_PER_PAGE, '_whicGoTo');
}

function _whicGoTo(p) { _whicPage = p; renderUsers(); }

// ── Actions ──────────────────────────────────────────────
function approveEnroll(icId, name) {
  confirm2('Approve ' + name + '?', 'Face data will be active for clock-in.', async function() {
    const r = await fetch('/api/enroll-approve', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({icId})});
    if (r.ok) { toast('Approved ✓','success'); loadEnroll(); } else toast('Failed','error');
  });
}

function rejectEnroll(icId, name) {
  confirm2('Reject ' + name + '?', 'Enrollment will be removed.', async function() {
    const r = await fetch('/api/enroll-reject', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({icId})});
    if (r.ok) { toast('Rejected','success'); loadEnroll(); } else toast('Failed','error');
  });
}

function showPhoto(icId, name, station, time, photo) {
  const m = document.getElementById('photo-modal');
  if (!m) return;
  document.getElementById('photo-modal-title').textContent = name + ' (' + icId + ')';
  document.getElementById('photo-modal-sub').textContent = '📍 ' + station + (time ? '  🕐 ' + new Date(time).toLocaleString('en-IN') : '');
  const img = document.getElementById('photo-modal-img');
  if (img) { img.src = photo; img.style.display = photo ? '' : 'none'; }
  m.classList.remove('hidden');
}

async function toggleUserAccess(icId, name, grant) {
  const r = await fetch('/api/admin/set-user-access', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({icId, canAccess: grant})
  });
  if (r.ok) {
    toast(`${name} - module access ${grant?'granted ✓':'revoked'}`, grant?'success':'warning');
    loadUsers();
  } else toast('Failed.','error');
}

function openOffboard(icId, name) {
  pendingOffboard = {icId, icName:name};
  document.getElementById('ob-title').textContent = `Offboard ${name}`;
  document.getElementById('ob-sub').textContent = `IC ${icId} - removes face data and marks inactive. Attendance history preserved.`;
  document.getElementById('ob-admin').value = '';
  document.getElementById('offboard-modal').classList.remove('hidden');
  setTimeout(()=>document.getElementById('ob-admin').focus(), 100);
}

async function confirmOffboard() {
  const adminName = document.getElementById('ob-admin').value.trim();
  const reason    = document.getElementById('ob-reason').value;
  if (!adminName) return toast('Enter your name.','warning');
  closeModal('offboard-modal');
  const r = await fetch('/api/offboard-user', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({icId:pendingOffboard.icId, icName:pendingOffboard.icName, adminName, reason})});
  if (r.ok) {
    toast(`${pendingOffboard.icName} offboarded.`, 'success');
    loadUsers(); loadEnroll();
  } else toast('Failed.','error');
}

async function reactivateUser(icId, name) {
  confirm2(`Reactivate ${name}?`, 'They will appear as active again and can re-enrol their face.', async () => {
    const r = await fetch('/api/reactivate-user', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({icId})});
    if (r.ok) { toast(`${name} reactivated.`,'success'); loadUsers(); }
    else toast('Failed.','error');
  });
}

async function deregUser(icId, name) {
  confirm2(`Remove face data for ${name}?`, `They must re-enrol at the WH machine.`, async () => {
    const r = await fetch('/api/user-deregister', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({icId})});
    if (r.ok) { toast(`${name} - face removed.`,'success'); loadUsers(); loadEnroll(); }
    else toast('Failed.','error');
  });
}