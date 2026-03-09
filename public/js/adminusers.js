let allEnrolled = [];

async function loadEnroll() {
  try {
    const pending = await fetch('/api/enroll-pending').then(r=>r.json());
    const badge = document.getElementById('cnt-enroll');
    if (badge) { badge.textContent = pending.length; badge.style.display = pending.length ? '' : 'none'; }
    const pw = document.getElementById('enroll-pending-wrap');
    if (!pending.length) {
      pw.innerHTML = '<div style="text-align:center;color:var(--text-3);padding:28px;font-size:.84rem">No pending enrolments ✓</div>';
    } else {
      // Store photos in a map - avoid passing base64 as onclick param
      window._enrollPhotos = {};
      pending.forEach(function(e){ if(e.enroll_photo) window._enrollPhotos[e.ic_id] = e.enroll_photo; });
      const cards = pending.map(function(e) {
        const nm = (e.ic_name||'Unknown').replace(/'/g,'&#39;');
        const id = String(e.ic_id);
        const st = String(e.station_code);
        const at = String(e.enrolled_at||'');
        const photoEl = e.enroll_photo
          ? '<img class="enroll-photo" src="' + e.enroll_photo + '" onclick="showPhotoById(\'' + id + '\',\'' + nm + '\',\'' + st + '\',\'' + at + '\')" style="cursor:zoom-in">'
          : '<div class="enroll-photo-placeholder">👤</div>';
        const time = e.enrolled_at ? new Date(e.enrolled_at).toLocaleString('en-IN') : '-';
        return '<div class="enroll-card pending">' +
          photoEl +
          '<div class="enroll-info">' +
            '<div class="enroll-name">' + (e.ic_name||'Unknown') + '</div>' +
            '<div class="enroll-id">' + id + '</div>' +
            '<div class="enroll-st">📍 ' + st + '</div>' +
            '<div class="enroll-time">🕐 ' + time + '</div>' +
            '<div class="enroll-acts">' +
              '<button class="btn btn-green btn-sm" onclick="approveEnroll(\'' + id + '\',\'' + nm + '\')">✓ Approve</button>' +
              '<button class="btn btn-red btn-sm" onclick="rejectEnroll(\'' + id + '\',\'' + nm + '\')">✕ Reject</button>' +
            '</div>' +
          '</div></div>';
      });
      pw.innerHTML = '<div class="enroll-grid">' + cards.join('') + '</div>';
    }
    const users = await fetch('/api/users').then(r=>r.json());
    allEnrolled = users.filter(function(u){ return u.enroll_status === 'APPROVED'; });
    renderApproved(allEnrolled);
  } catch(e) { toast('Failed to load enrolments.','error'); }
}

function renderApproved(list) {
  const aw = document.getElementById('enroll-approved-wrap');
  if (!list.length) { aw.innerHTML='<div style="text-align:center;color:var(--text-3);padding:24px;font-size:.84rem">No approved enrolments yet</div>'; return; }
  const cards = list.map(function(u) {
    const init = (u.ic_name||'?').split(' ').map(function(w){return w[0];}).slice(0,2).join('').toUpperCase();
    const nm = (u.ic_name||'').replace(/'/g,'&#39;');
    const id = String(u.ic_id);
    const st = String(u.station_code);
    const photoEl = u.enroll_photo
      ? '<img class="enroll-photo" src="' + u.enroll_photo + '" style="cursor:zoom-in;border-radius:8px" onclick="showPhoto(\'' + id + '\',\'' + nm + '\',\'' + st + '\',\'\',\'\')">'
      : '<div class="ap-photo-placeholder">' + init + '</div>';
    const search = (u.ic_name||'').toLowerCase() + ' ' + id + ' ' + st.toLowerCase();
    return '<div class="ap-card" data-search="' + search + '">' +
      photoEl +
      '<div class="ap-info">' +
        '<div class="ap-name">' + (u.ic_name||'-') + '</div>' +
        '<div class="ap-meta">' + id + ' · ' + st + '</div>' +
      '</div></div>';
  });
  aw.innerHTML = '<div class="approved-grid">' + cards.join('') + '</div>';
}

function filterEnrolled(term) {
  const t = term.toLowerCase();
  document.querySelectorAll('#enroll-approved-wrap .ap-card').forEach(function(c){
    c.style.display = c.dataset.search.includes(t) ? '' : 'none';
  });
}

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

// -- MACHINES ----------------------------------------------
async function loadUsers(){
  try{
    const users = await fetch('/api/users').then(r=>r.json());
    allUsersData = users;
    document.getElementById('cnt-users').textContent = users.length;
    // Populate station filter
    const stSel = document.getElementById('users-station-filter');
    const stations = [...new Set(users.map(u=>u.station_code))].sort();
    const curSt = stSel.value;
    stSel.innerHTML = '<option value="">All Stations</option>';
    stations.forEach(s => stSel.innerHTML += `<option value="${s}" ${s===curSt?'selected':''}>${s}</option>`);
    renderUsers();
  } catch(e){ toast('Failed to load users: '+e.message,'error'); }
}

function renderUsers() {
  const stFilter  = document.getElementById('users-station-filter').value;
  const stStatus  = document.getElementById('users-status-filter').value;
  let users = allUsersData;
  if (stFilter) users = users.filter(u => u.station_code === stFilter);
  if (stStatus === 'active')      users = users.filter(u => u.is_active !== 0);
  if (stStatus === 'offboarded')  users = users.filter(u => u.is_active === 0);
  document.getElementById('all-users').innerHTML = users.map(u => {
    const isOff = u.is_active === 0;
    const statusPill = u.enroll_status==='APPROVED'
      ? '<span class="pill p-enrolled">Face ✓</span>'
      : u.enroll_status==='PENDING'
      ? '<span class="pill p-sys">Pending</span>'
      : '<span class="pill p-open">No face</span>';
    const activePill = isOff
      ? '<span class="pill" style="background:var(--red-bg);color:var(--red-d);border:1px solid rgba(239,68,68,.2)">Offboarded</span>'
      : '<span class="pill p-active">Active</span>';
    const hasAccess = !!u.can_access_modules;
    const isEnrolled = u.enroll_status === 'APPROVED';
    const accessBtn = (!isOff && isEnrolled)
      ? `<button class="btn btn-sm ${hasAccess?'btn-amber':'btn-green'}" 
           title="${hasAccess?'Revoke module access':'Grant module access'}"
           onclick="toggleUserAccess('${u.ic_id}','${u.ic_name.replace(/'/g,"\\'")}',${!hasAccess})">
           ${hasAccess?'🔓 Revoke Access':'🔑 Grant Access'}
         </button>` : '';
    const acts = isOff
      ? `<button class="btn btn-ghost btn-sm" onclick="reactivateUser('${u.ic_id}','${u.ic_name.replace(/'/g,"\\'")}')">↩ Reactivate</button>`
      : isEnrolled
      ? `<div class="acts">
           <button class="btn btn-ghost btn-sm" onclick="deregUser('${u.ic_id}','${u.ic_name.replace(/'/g,"\\'")}')">Remove Face</button>
           <button class="btn btn-red btn-sm" onclick="openOffboard('${u.ic_id}','${u.ic_name.replace(/'/g,"\\'")}')">✕ Offboard</button>
         </div>`
      : '';
    return `<tr data-search="${u.ic_name.toLowerCase()} ${u.ic_id} ${u.station_code.toLowerCase()}" style="${isOff?'opacity:.55':''}">
      <td><strong>${u.ic_name}</strong></td>
      <td><span class="mono">${u.ic_id}</span></td>
      <td>${u.station_code}</td>
      <td>${statusPill}</td>
      <td>${u.open_violations>0?`<span class="v-cnt">⚠ ${u.open_violations}</span>`:'-'}</td>
      <td>
        ${activePill}
        ${hasAccess&&!isOff?'<span class="pill p-enrolled" style="margin-top:3px;display:block;font-size:.65rem">Module Access ✓</span>':''}
      </td>
      <td>
        ${accessBtn}
        ${acts}
      </td>
    </tr>`;
  }).join('') || '<tr class="empty-row"><td colspan="7">No users found</td></tr>';
}

function filterUsersStation() { renderUsers(); }

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
    await pool; // placeholder
    const r = await fetch('/api/reactivate-user', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({icId})});
    if (r.ok) { toast(`${name} reactivated.`,'success'); loadUsers(); }
    else toast('Failed.','error');
  });
}

async function deregUser(icId,name){confirm2(`Remove face data for ${name}?`,`They must re-enrol at the WH machine.`,async()=>{
  const r=await fetch('/api/user-deregister',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({icId})});
  if(r.ok){toast(`${name} - face removed.`,'success');loadUsers();loadEnroll();}else toast('Failed.','error');
});}