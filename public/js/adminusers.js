// ── ADMIN USER MANAGEMENT ─────────────────────────────────────────────────────

var _umUsers = [];

var ROLE_LABELS = {
  superadmin: '👑 Superadmin',
  ops_admin:  '⚙️ Ops Admin',
  finance:    '💰 Finance',
  hr:         '👥 HR',
  viewer:     '👁 Viewer',
  cluster_manager: '🗺 Cluster Manager'
};

var ALL_TABS = [
  {id:'t-ov',       label:'Overview'},
  {id:'t-users',    label:'WHIC'},
  {id:'t-machines', label:'Machines'},
  {id:'t-violations',label:'Violations'},
  {id:'t-kms',      label:'KMS'},
  {id:'t-advances', label:'Advances'},
  {id:'t-deb',      label:'Debit Notes'},
  {id:'t-data',     label:'Settings'},
  {id:'t-stations', label:'Stations'},
  {id:'t-legacy',   label:'Legacy Data'},
  {id:'t-test',     label:'Test Mode'},
  {id:'t-payroll',  label:'Finance'},
];

// Called when Settings tab is opened
async function umLoad() {
  var panel = document.getElementById('user-mgmt-panel');
  var body  = document.getElementById('um-body');
  if (!panel || !body) return;

  // Only show to superadmin
  var user = window._adminUser || JSON.parse(sessionStorage.getItem('adm_user') || 'null');
  if (!user || user.role !== 'superadmin') {
    panel.style.display = 'none';
    return;
  }

  try {
    var r = await fetch('/api/admin/users', {credentials:'include'});
    _umUsers = await r.json();
    umRender();
  } catch(e) {
    body.innerHTML = '<div style="color:var(--red-d);padding:16px">Error loading users: ' + e.message + '</div>';
  }
}

function umRender() {
  var body = document.getElementById('um-body');
  if (!_umUsers.length) {
    body.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-3)">No admin users yet</div>';
    return;
  }
  var me = window._adminUser || {};
  var html = '<div style="overflow-x:auto"><table style="width:100%;font-size:.82rem;border-collapse:collapse">' +
    '<thead><tr style="border-bottom:2px solid var(--border)">' +
    '<th style="padding:8px 10px;text-align:left">Name</th>' +
    '<th style="padding:8px 10px;text-align:left">Email</th>' +
    '<th style="padding:8px 10px;text-align:center">Role</th>' +
    '<th style="padding:8px 10px;text-align:center">Status</th>' +
    '<th style="padding:8px 10px;text-align:left">Last Login</th>' +
    '<th style="padding:8px 10px;text-align:center">Actions</th>' +
    '</tr></thead><tbody>';

  _umUsers.forEach(function(u) {
    var isSelf = u.id === me.id;
    var locked = u.locked_until && new Date(u.locked_until) > new Date();
    var statusHtml = !u.is_active
      ? '<span style="color:var(--red-d);font-weight:600;font-size:.75rem">Disabled</span>'
      : locked
      ? '<span style="color:var(--amber-d,#b45309);font-size:.75rem">Locked</span>'
      : u.force_pw_change
      ? '<span style="color:var(--amber-d,#b45309);font-size:.75rem">Pw Reset</span>'
      : '<span style="color:var(--green-d);font-size:.75rem">Active</span>';

    html += '<tr style="border-bottom:1px solid var(--border)' + (isSelf ? ';background:var(--blue-bg)' : '') + '">' +
      '<td style="padding:8px 10px;font-weight:600">' + escH(u.name) + (isSelf ? ' <span style="font-size:.7rem;color:var(--blue)">(you)</span>' : '') + '</td>' +
      '<td style="padding:8px 10px;color:var(--text-2)">' + escH(u.email) + '</td>' +
      '<td style="padding:8px 10px;text-align:center">' +
        '<span style="padding:2px 8px;border-radius:6px;font-size:.75rem;font-weight:600;background:var(--bg)">' + escH(ROLE_LABELS[u.role] || u.role) + '</span>' +
      '</td>' +
      '<td style="padding:8px 10px;text-align:center">' + statusHtml + '</td>' +
      '<td style="padding:8px 10px;font-size:.76rem;color:var(--text-3)">' +
        (u.last_login ? String(u.last_login).substring(0,16) + (u.last_login_ip ? '<br><span style="font-size:.7rem">' + escH(u.last_login_ip) + '</span>' : '') : '—') +
      '</td>' +
      '<td style="padding:8px 10px;text-align:center;white-space:nowrap">' +
        (!isSelf ? '<button class="btn btn-ghost btn-sm" style="font-size:.72rem;margin-right:3px" data-id="' + u.id + '" onclick="umOpenEdit(parseInt(this.dataset.id))">✏️ Edit</button>' : '') +
        (!isSelf ? '<button class="btn btn-ghost btn-sm" style="font-size:.72rem;color:var(--red-d)" data-id="' + u.id + '" onclick="umRevokeAll(parseInt(this.dataset.id), this)">⊘ Sessions</button>' : '') +
      '</td>' +
    '</tr>';
  });

  html += '</tbody></table></div>';
  document.getElementById('um-body').innerHTML = html;
}

// ── CREATE USER ───────────────────────────────────────────────────────────────
function umOpenCreate() {
  umShowDrawer(null);
}

function umOpenEdit(id) {
  var u = _umUsers.find(function(x){ return x.id === id; });
  if (u) umShowDrawer(u);
}

function umShowDrawer(user, prefill) {
  if (prefill && !user) {
    // Pre-fill from CM or other source — treat as new user with defaults
    user = null;
    document.getElementById('um-legacy-search') && (document.getElementById('um-legacy-search').value = '');
  }
  var isEdit = !!user;
  var overlay = document.getElementById('_um-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = '_um-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:flex-end';
    overlay.onclick = function(e){ if(e.target===overlay) umCloseDrawer(); };
    document.body.appendChild(overlay);
  }
  var drawer = document.getElementById('_um-drawer');
  if (!drawer) {
    drawer = document.createElement('div');
    drawer.id = '_um-drawer';
    drawer.style.cssText = 'width:480px;max-width:96vw;height:100%;background:var(--card);box-shadow:-8px 0 40px rgba(0,0,0,.2);overflow-y:auto;padding:24px;font-size:.85rem';
    overlay.appendChild(drawer);
  }

  var extraTabs = user ? (Array.isArray(user.extra_tabs)  ? user.extra_tabs  : JSON.parse(user.extra_tabs  || '[]')) : [];
  var deniedTabs= user ? (Array.isArray(user.denied_tabs) ? user.denied_tabs : JSON.parse(user.denied_tabs || '[]')) : [];

  // Build visual tab permission selector
  // For each tab show: inherited from role | extra granted | denied
  var selectedRole = user ? user.role : 'viewer';
  var roleTabs = {
    superadmin: ['t-ov','t-users','t-machines','t-violations','t-kms','t-advances','t-deb','t-data','t-stations','t-legacy','t-test','t-payroll'],
    ops_admin:  ['t-ov','t-users','t-machines','t-violations','t-kms','t-advances','t-deb','t-data','t-stations','t-legacy'],
    finance:    ['t-ov','t-advances','t-deb','t-legacy','t-payroll'],
    hr:         ['t-ov','t-users','t-violations','t-advances','t-stations'],
    viewer:           ['t-ov','t-users','t-violations','t-kms','t-advances','t-deb','t-legacy'],
  cluster_manager:  ['t-ov','t-users','t-violations','t-kms','t-advances','t-deb'],
  };
  // tabCheckboxes / denyCheckboxes kept for umSave() compatibility — hidden inputs
  var tabCheckboxes = '';
  var denyCheckboxes = '';
  extraTabs.forEach(function(t){ tabCheckboxes += '<input type="checkbox" class="um-extra-tab" value="' + t + '" checked style="display:none">'; });
  deniedTabs.forEach(function(t){ denyCheckboxes += '<input type="checkbox" class="um-denied-tab" value="' + t + '" checked style="display:none">'; });

  function inp(id, val, type) {
    return '<input id="' + id + '" type="' + (type||'text') + '" value="' + escH(val||'') + '" ' +
      'style="width:100%;box-sizing:border-box;padding:8px 10px;font-size:.85rem;border:1.5px solid var(--border);border-radius:8px;font-family:inherit;margin-top:4px">';
  }
  function row(label, html) {
    return '<div style="margin-bottom:14px"><label style="font-size:.78rem;color:var(--text-2);font-weight:500">' + label + '</label>' + html + '</div>';
  }

  drawer.innerHTML =
    '<div style="display:flex;align-items:center;margin-bottom:20px">' +
      '<div style="font-size:.95rem;font-weight:700;color:var(--navy);flex:1">' + (isEdit ? '✏️ Edit User' : '➕ New Admin User') + '</div>' +
      '<button onclick="umCloseDrawer()" style="background:none;border:none;cursor:pointer;font-size:1.3rem;color:var(--text-3)">×</button>' +
    '</div>' +

    '<div id="um-draw-err" style="display:none;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:8px 12px;font-size:.8rem;color:var(--red-d);margin-bottom:14px"></div>' +

    // Legacy staff search — only shown when creating new user
    (!isEdit ? (
      '<div style="margin-bottom:16px;padding:12px;background:var(--blue-bg);border:1px solid var(--blue);border-radius:8px">' +
        '<div style="font-size:.78rem;font-weight:600;color:var(--blue);margin-bottom:6px">🔍 Search from existing staff</div>' +
        '<div style="display:flex;gap:6px">' +
          '<input type="text" id="um-legacy-search" placeholder="Name, email or mobile…" oninput="umLegacySearch()" ' +
          'style="flex:1;padding:7px 10px;font-size:.83rem;border:1.5px solid var(--border);border-radius:7px;font-family:inherit">' +
        '</div>' +
        '<div id="um-legacy-results" style="margin-top:6px;max-height:160px;overflow-y:auto"></div>' +
      '</div>'
    ) : '') +

    row('Full Name', inp('um-name', user && user.name)) +
    row('Email Address', inp('um-email', user && user.email, 'email')) +
    row(isEdit ? 'Reset Password (leave blank to keep current)' : 'Temporary Password (user must change on first login)',
        inp('um-pw', '', 'password')) +

    '<div style="margin-bottom:14px">' +
      '<label style="font-size:.78rem;color:var(--text-2);font-weight:500">Role</label>' +
      '<select id="um-role" style="width:100%;padding:8px 10px;font-size:.85rem;border:1.5px solid var(--border);border-radius:8px;margin-top:4px">' +
      Object.keys(ROLE_LABELS).map(function(r) {
        return '<option value="' + r + '"' + (user && user.role===r ? ' selected' : '') + '>' + ROLE_LABELS[r] + '</option>';
      }).join('') + '</select>' +
    '</div>' +

    (isEdit ? '<div style="margin-bottom:14px"><label style="font-size:.78rem;color:var(--text-2);font-weight:500">Status</label>' +
      '<select id="um-active" style="width:100%;padding:8px 10px;font-size:.85rem;border:1.5px solid var(--border);border-radius:8px;margin-top:4px">' +
      '<option value="1"' + (user.is_active ? ' selected' : '') + '>Active</option>' +
      '<option value="0"' + (!user.is_active ? ' selected' : '') + '>Disabled</option>' +
      '</select></div>' : '') +

    // Hidden inputs for form submission
    tabCheckboxes + denyCheckboxes +

    '<div style="margin-bottom:20px">' +
      '<div style="font-size:.78rem;font-weight:600;color:var(--text-2);margin-bottom:8px">Tab Access</div>' +
      '<div style="font-size:.74rem;color:var(--text-3);margin-bottom:10px">Click a tab to toggle access. ' +
        '<span style="background:#dbeafe;color:#1d4ed8;padding:1px 6px;border-radius:4px;font-size:.7rem">Role</span> = included by role &nbsp;' +
        '<span style="background:#dcfce7;color:#15803d;padding:1px 6px;border-radius:4px;font-size:.7rem">✓ Added</span> = extra access &nbsp;' +
        '<span style="background:#fee2e2;color:#dc2626;padding:1px 6px;border-radius:4px;font-size:.7rem">✕ Denied</span> = removed' +
      '</div>' +
      '<div id="um-tab-selector" style="display:grid;grid-template-columns:1fr 1fr;gap:6px"></div>' +
    '</div>' +

    '<div style="display:flex;gap:8px">' +
      '<button onclick="umCloseDrawer()" style="flex:1;padding:9px;border:1.5px solid var(--border);border-radius:8px;background:none;cursor:pointer;font-size:.84rem">Cancel</button>' +
      '<button onclick="umSave(' + (user ? user.id : 'null') + ')" id="um-save-btn" data-cm-staff-id="' + ((prefill && prefill.cm_staff_id) ? prefill.cm_staff_id : '') + '" style="flex:2;padding:9px;border:none;border-radius:8px;background:var(--navy);color:#fff;font-weight:700;cursor:pointer;font-size:.84rem">' +
        (isEdit ? '💾 Save Changes' : '✅ Create User') + '</button>' +
    '</div>';

  overlay.style.display = 'flex';
  // Init visual tab selector after DOM renders
  setTimeout(function() {
    var effRole = (prefill && prefill.role) ? prefill.role : selectedRole;
    umInitTabSelector(effRole, extraTabs, deniedTabs);
    // Apply prefill values if provided
    if (prefill && !user) {
      var ne = document.getElementById('um-name');  if(ne && prefill.name)  ne.value = prefill.name;
      var ee = document.getElementById('um-email'); if(ee && prefill.email) ee.value = prefill.email;
      var re = document.getElementById('um-role');  if(re && prefill.role)  re.value = prefill.role;
      if (re) re.dispatchEvent(new Event('change'));
    }
  }, 50);
}

// ── VISUAL TAB SELECTOR ───────────────────────────────────────────────────────
var ROLE_TABS_DEF = {
  superadmin: ['t-ov','t-users','t-machines','t-violations','t-kms','t-advances','t-deb','t-data','t-stations','t-legacy','t-test','t-payroll'],
  ops_admin:  ['t-ov','t-users','t-machines','t-violations','t-kms','t-advances','t-deb','t-data','t-stations','t-legacy'],
  finance:    ['t-ov','t-advances','t-deb','t-legacy','t-payroll'],
  hr:         ['t-ov','t-users','t-violations','t-advances','t-stations'],
  viewer:           ['t-ov','t-users','t-violations','t-kms','t-advances','t-deb','t-legacy'],
  cluster_manager:  ['t-ov','t-users','t-violations','t-kms','t-advances','t-deb'],
};

var _umTabState = {}; // tabId -> 'role' | 'extra' | 'denied' | 'off'

function umInitTabSelector(role, extraTabs, deniedTabs) {
  var sel = document.getElementById('um-tab-selector');
  if (!sel) return;
  var roleTabs = ROLE_TABS_DEF[role] || [];
  _umTabState = {};

  ALL_TABS.forEach(function(t) {
    var inRole   = roleTabs.indexOf(t.id) !== -1;
    var inExtra  = extraTabs.indexOf(t.id) !== -1;
    var inDenied = deniedTabs.indexOf(t.id) !== -1;
    if (inDenied)     _umTabState[t.id] = 'denied';
    else if (inExtra) _umTabState[t.id] = 'extra';
    else if (inRole)  _umTabState[t.id] = 'role';
    else              _umTabState[t.id] = 'off';
  });

  umRenderTabSelector(role);

  // Re-render when role changes
  var roleEl = document.getElementById('um-role');
  if (roleEl) {
    roleEl.onchange = function() {
      var newRole = roleEl.value;
      var newRoleTabs = ROLE_TABS_DEF[newRole] || [];
      // Recalculate state: keep extra/denied, recalc role membership
      ALL_TABS.forEach(function(t) {
        var cur = _umTabState[t.id];
        var nowInRole = newRoleTabs.indexOf(t.id) !== -1;
        if (cur === 'role' || cur === 'off') {
          _umTabState[t.id] = nowInRole ? 'role' : 'off';
        }
        // keep 'extra' and 'denied' as-is
      });
      umRenderTabSelector(newRole);
    };
  }
}

function umRenderTabSelector(role) {
  var sel = document.getElementById('um-tab-selector');
  if (!sel) return;
  var roleTabs = ROLE_TABS_DEF[role] || [];

  sel.innerHTML = ALL_TABS.map(function(t) {
    var state = _umTabState[t.id] || 'off';
    var inRole = roleTabs.indexOf(t.id) !== -1;

    var bg, color, border, badge, opacity;
    if (state === 'denied') {
      bg='#fee2e2'; color='#dc2626'; border='#fca5a5'; badge='<span style="font-size:.68rem;margin-left:4px;font-weight:700">✕</span>'; opacity='1';
    } else if (state === 'extra') {
      bg='#dcfce7'; color='#15803d'; border='#86efac'; badge='<span style="font-size:.68rem;margin-left:4px;font-weight:700">+</span>'; opacity='1';
    } else if (state === 'role') {
      bg='#dbeafe'; color='#1d4ed8'; border='#93c5fd'; badge=''; opacity='1';
    } else {
      bg='var(--bg)'; color='var(--text-3)'; border='var(--border)'; badge=''; opacity='.7';
    }

    return '<button type="button" data-tab="' + t.id + '" data-inrole="' + inRole + '" onclick="umToggleTab(this)" ' +
      'style="display:flex;align-items:center;justify-content:space-between;padding:7px 10px;border-radius:8px;border:1.5px solid ' + border + ';' +
      'background:' + bg + ';color:' + color + ';cursor:pointer;font-size:.8rem;font-weight:600;opacity:' + opacity + ';text-align:left;font-family:inherit">' +
      '<span>' + escH(t.label) + badge + '</span>' +
      (inRole && state !== 'denied' ? '<span style="font-size:.65rem;opacity:.6">role</span>' : '') +
    '</button>';
  }).join('');
}

function umToggleTab(btn) {
  var tabId  = btn.dataset.tab;
  var inRole = btn.dataset.inrole === 'true';
  var cur    = _umTabState[tabId] || 'off';
  var roleEl = document.getElementById('um-role');
  var role   = roleEl ? roleEl.value : 'viewer';

  // Cycle: role→denied | off→extra | extra→off | denied→role(if inrole) or off
  var next;
  if (cur === 'role')  next = 'denied';
  else if (cur === 'denied') next = inRole ? 'role' : 'off';
  else if (cur === 'extra') next = 'off';
  else next = 'extra'; // off → extra

  _umTabState[tabId] = next;
  umRenderTabSelector(role);
  umSyncHiddenInputs();
}

function umSyncHiddenInputs() {
  // Remove existing hidden inputs
  document.querySelectorAll('.um-extra-tab, .um-denied-tab').forEach(function(el){ el.remove(); });
  var drawer = document.getElementById('_um-drawer');
  if (!drawer) return;
  Object.keys(_umTabState).forEach(function(tabId) {
    var state = _umTabState[tabId];
    if (state === 'extra' || state === 'denied') {
      var inp = document.createElement('input');
      inp.type = 'checkbox';
      inp.className = state === 'extra' ? 'um-extra-tab' : 'um-denied-tab';
      inp.value = tabId;
      inp.checked = true;
      inp.style.display = 'none';
      drawer.appendChild(inp);
    }
  });
}



// ── LEGACY STAFF SEARCH ───────────────────────────────────────────────────────
var _umLegacyTimer = null;

function umLegacySearch() {
  clearTimeout(_umLegacyTimer);
  _umLegacyTimer = setTimeout(async function() {
    var q = (document.getElementById('um-legacy-search') || {}).value || '';
    var results = document.getElementById('um-legacy-results');
    if (!results) return;
    if (q.length < 2) { results.innerHTML = ''; return; }

    results.innerHTML = '<div style="font-size:.76rem;color:var(--text-3);padding:4px">Searching…</div>';
    try {
      var r = await fetch('/api/admin/users/legacy-search?q=' + encodeURIComponent(q), {credentials:'include'});
      var d = await r.json();
      if (!d.length) { results.innerHTML = '<div style="font-size:.76rem;color:var(--text-3);padding:4px">No staff found</div>'; return; }
      results.innerHTML = d.map(function(s) {
        return '<div onclick="umFillFromLegacy(' + JSON.stringify(s).replace(/"/g, '&quot;') + ')" ' +
          'style="padding:7px 10px;cursor:pointer;border-radius:6px;font-size:.82rem;display:flex;align-items:center;gap:8px" ' +
          '>' +
          '<div style="flex:1">' +
            '<div style="font-weight:600;color:var(--navy)">' + escH(s.name) + '</div>' +
            '<div style="font-size:.74rem;color:var(--text-3)">' +
              (s.email ? escH(s.email) : '') +
              (s.station_code ? ' · ' + escH(s.station_code) : '') +
              (s.mobile ? ' · ' + escH(s.mobile) : '') +
            '</div>' +
          '</div>' +
          '<span style="font-size:.72rem;color:var(--blue);font-weight:600">Select →</span>' +
          '</div>';
      }).join('');
    } catch(e) {
      results.innerHTML = '<div style="font-size:.76rem;color:var(--red-d);padding:4px">Search error</div>';
    }
  }, 300);
}

function umFillFromLegacy(staff) {
  // Fill name and email from legacy staff record
  var nameEl  = document.getElementById('um-name');
  var emailEl = document.getElementById('um-email');
  if (nameEl)  nameEl.value  = staff.name  || '';
  if (emailEl) emailEl.value = staff.email || '';
  // Clear search
  var searchEl  = document.getElementById('um-legacy-search');
  var resultsEl = document.getElementById('um-legacy-results');
  if (searchEl)  searchEl.value = '';
  if (resultsEl) resultsEl.innerHTML = '<div style="font-size:.76rem;color:var(--green-d);padding:4px">✓ Filled from: ' + escH(staff.name) + '</div>';
  // Focus password field
  var pwEl = document.getElementById('um-pw');
  if (pwEl) pwEl.focus();
}

function umCloseDrawer() {
  var el = document.getElementById('_um-overlay');
  if (el) el.style.display = 'none';
}

async function umSave(userId) {
  var name    = (document.getElementById('um-name')  || {}).value || '';
  var email   = (document.getElementById('um-email') || {}).value || '';
  var pw      = (document.getElementById('um-pw')    || {}).value || '';
  var role    = (document.getElementById('um-role')  || {}).value || 'viewer';
  var active  = document.getElementById('um-active') ? parseInt(document.getElementById('um-active').value) : 1;
  var extra   = Array.from(document.querySelectorAll('.um-extra-tab:checked')).map(function(el){return el.value;});
  var denied  = Array.from(document.querySelectorAll('.um-denied-tab:checked')).map(function(el){return el.value;});
  var errEl   = document.getElementById('um-draw-err');
  var btn     = document.getElementById('um-save-btn');

  if (!name.trim() || !email.trim()) { errEl.textContent='Name and email are required.'; errEl.style.display='block'; return; }
  if (!userId && pw.length < 8)      { errEl.textContent='Password must be at least 8 characters.'; errEl.style.display='block'; return; }
  if (pw && pw.length < 8)           { errEl.textContent='Password must be at least 8 characters.'; errEl.style.display='block'; return; }

  btn.disabled = true; btn.textContent = 'Saving…';

  var cmStaffId = (document.getElementById('um-save-btn') || {}).dataset && document.getElementById('um-save-btn').dataset.cmStaffId;
  var body = {name:name.trim(), email:email.trim(), role, extra_tabs:extra, denied_tabs:denied};
  if (cmStaffId) body.cm_staff_id = parseInt(cmStaffId);
  if (!userId) body.password = pw;
  else if (pw) body.reset_password = pw;
  if (userId) body.is_active = active;

  try {
    var url = userId ? '/api/admin/users/' + userId : '/api/admin/users';
    var method = userId ? 'PATCH' : 'POST';
    var r = await fetch(url, {method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    var d = await r.json();
    if (r.ok) {
      umCloseDrawer();
      toast(userId ? 'User updated ✓' : 'User created ✓', 'success');
      umLoad();
    } else {
      errEl.textContent = d.error || 'Save failed';
      errEl.style.display = 'block';
      btn.disabled = false; btn.textContent = userId ? '💾 Save Changes' : '✅ Create User';
    }
  } catch(e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
    btn.disabled = false; btn.textContent = userId ? '💾 Save Changes' : '✅ Create User';
  }
}

async function umRevokeAll(userId, btn) {
  _umConfirm('Revoke all sessions for this user? They will be logged out immediately.', async function() {
    btn.disabled = true;
    try {
      await fetch('/api/admin/users/' + userId + '/sessions', {method:'DELETE'});
      _umToast('Sessions revoked — user will need to log in again', 'success');
    } catch(e) { _umToast('Failed: ' + e.message, 'error'); }
    btn.disabled = false;
  });
}

// ── Local toast for adminusers (uses global toast if available, else own impl)
function _umToast(msg, type) {
  if (typeof toast === 'function') { toast(msg, type); return; }
  // Fallback — create toast element directly
  var el = document.createElement('div');
  el.className = 'toast ' + (type||'info');
  el.style.cssText = 'position:fixed;top:18px;right:18px;z-index:99999;' +
    'display:flex;align-items:center;gap:9px;background:var(--card);' +
    'border:1px solid var(--border);border-left:3px solid ' +
    (type==='success'?'var(--green)':type==='error'?'var(--red)':'var(--blue)') + ';' +
    'border-radius:9px;padding:11px 16px;font-size:.84rem;font-weight:500;' +
    'box-shadow:0 8px 40px rgba(0,0,0,.16);animation:tIn .3s ease;max-width:320px';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(function(){ el.style.opacity='0'; el.style.transition='opacity .3s'; setTimeout(function(){ el.remove(); }, 300); }, 3500);
}

// ── Inline confirm modal (replaces browser confirm())
function _umConfirmClose() {
  var m = document.getElementById('_um-confirm');
  if (m) m.remove();
}

function _umConfirm(msg, onConfirm) {
  var existing = document.getElementById('_um-confirm');
  if (existing) existing.remove();
  var el = document.createElement('div');
  el.id = '_um-confirm';
  el.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:20px';
  el.innerHTML =
    '<div style="background:var(--card);border-radius:12px;padding:24px 28px;max-width:380px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.2)">' +
      '<div style="font-size:.95rem;font-weight:700;color:var(--navy);margin-bottom:8px">⚠️ Confirm Action</div>' +
      '<div style="font-size:.84rem;color:var(--text-2);margin-bottom:20px;line-height:1.5">' + escH(msg) + '</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end">' +
        '<button onclick="_umConfirmClose()" ' +
        'style="padding:8px 18px;border:1.5px solid var(--border);border-radius:8px;background:none;cursor:pointer;font-size:.84rem">Cancel</button>' +
        '<button id="_um-confirm-ok" ' +
        'style="padding:8px 18px;border:none;border-radius:8px;background:var(--red-d);color:#fff;cursor:pointer;font-weight:700;font-size:.84rem">Confirm</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(el);
  document.getElementById('_um-confirm-ok').onclick = function() {
    el.remove();
    onConfirm();
  };
}

// Load when Settings tab is opened
var _origSw = typeof sw === 'function' ? sw : null;
document.addEventListener('DOMContentLoaded', function() {
  // Patch the sw() function to load user management when Settings is opened
  var origSwRef = window.sw;
  window.sw = function(tab) {
    if (typeof origSwRef === 'function') origSwRef(tab);
    if (tab === 't-data') umLoad();
  };
});

// ── DOWNLOAD CSV TEMPLATE ─────────────────────────────────────────────────────
function umDownloadTemplate() {
  var headers = ['name','email','password','role','extra_tabs','denied_tabs'];
  var roles = 'superadmin | ops_admin | finance | hr | viewer';
  var tabs  = 't-ov | t-users | t-machines | t-violations | t-kms | t-advances | t-deb | t-data | t-stations | t-legacy | t-test | t-payroll';
  var sample = [
    ['Rahul Sharma',  'rahul@bifme.in',  'TempPass@123', 'ops_admin', '',           ''],
    ['Priya Mehta',   'priya@bifme.in',  'TempPass@123', 'finance',   't-users',    't-test'],
    ['Kiran Patel',   'kiran@bifme.in',  'TempPass@123', 'hr',        '',           ''],
    ['Anita Desai',   'anita@bifme.in',  'TempPass@123', 'viewer',    't-advances', ''],
  ];

  var csv = [
    '# ShipLocal Admin Users Import Template',
    '# role must be one of: ' + roles,
    '# extra_tabs / denied_tabs: space-separated tab IDs from: ' + tabs,
    '# extra_tabs = grant access BEYOND role default | denied_tabs = REMOVE from role default',
    '# password: temporary — user will be forced to change on first login',
    '',
    headers.join(','),
  ].concat(sample.map(function(r){ return r.map(function(v){ return '"' + v + '"'; }).join(','); })).join('\n');

  var blob = new Blob([csv], {type:'text/csv'});
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'admin_users_template.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── IMPORT USERS MODAL ────────────────────────────────────────────────────────
function umOpenImport() {
  var modal = document.getElementById('hist-upload-modal');
  var title = document.getElementById('hist-upload-title');
  var cont  = document.getElementById('hist-upload-content');
  if (!modal) return;

  title.textContent = '↑ Import Admin Users from CSV';
  cont.innerHTML =
    '<div style="margin-bottom:12px;font-size:.82rem;color:var(--text-2)">' +
      'Upload a CSV file with columns: <strong>name, email, password, role, extra_tabs, denied_tabs</strong>.<br>' +
      'Download the template first to see the correct format. ' +
      'Existing users (matched by email) will be <strong>updated</strong>, not duplicated.' +
    '</div>' +
    '<div id="um-import-drop" style="border:2px dashed var(--border);border-radius:10px;padding:28px;text-align:center;cursor:pointer;background:var(--bg);margin-bottom:12px" ' +
      'onclick="document.getElementById(\'um-import-file\').click()" ' +
      'ondragover="event.preventDefault();this.style.borderColor=\'var(--navy)\'" ' +
      'ondragleave="this.style.borderColor=\'var(--border)\'" ' +
      'ondrop="event.preventDefault();umHandleImportFile(event.dataTransfer.files[0])">' +
      '<div style="font-size:1.8rem;margin-bottom:6px">📋</div>' +
      '<div style="font-weight:600;color:var(--navy);font-size:.88rem">Drop CSV file here or click to browse</div>' +
      '<div style="font-size:.76rem;color:var(--text-3);margin-top:4px">.csv files only</div>' +
    '</div>' +
    '<input type="file" id="um-import-file" accept=".csv" style="display:none" onchange="umHandleImportFile(this.files[0])">' +
    '<div id="um-import-log" style="max-height:300px;overflow-y:auto"></div>';

  modal.style.display = 'flex';
}

function umHandleImportFile(file) {
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    umPreviewImport(e.target.result);
  };
  reader.readAsText(file);
}

function umPreviewImport(csv) {
  var log = document.getElementById('um-import-log');
  // Parse CSV — skip comment lines starting with #
  var lines = csv.split('\n').filter(function(l){ return l.trim() && !l.trim().startsWith('#'); });
  if (!lines.length) { log.innerHTML = '<div style="color:var(--red-d)">No data found in file.</div>'; return; }

  // Parse header
  var header = lines[0].split(',').map(function(h){ return h.replace(/"/g,'').trim().toLowerCase(); });
  var required = ['name','email','password','role'];
  var missing = required.filter(function(r){ return header.indexOf(r) === -1; });
  if (missing.length) {
    log.innerHTML = '<div style="color:var(--red-d)">Missing required columns: <strong>' + missing.join(', ') + '</strong></div>';
    return;
  }

  var users = [];
  var errors = [];
  var validRoles = ['superadmin','ops_admin','finance','hr','viewer'];

  for (var i = 1; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    // Simple CSV parse — handle quoted values
    var cols = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|^(?=,)|(?<=,)$)/g) || [];
    cols = cols.map(function(c){ return c.replace(/^"|"$/g,'').trim(); });
    var row = {};
    header.forEach(function(h, idx){ row[h] = cols[idx] || ''; });

    if (!row.name)  { errors.push('Row ' + i + ': name is required'); continue; }
    if (!row.email) { errors.push('Row ' + i + ': email is required'); continue; }
    if (!row.password || row.password.length < 8) { errors.push('Row ' + i + ' (' + row.email + '): password must be 8+ chars'); continue; }
    if (validRoles.indexOf(row.role) === -1) { errors.push('Row ' + i + ' (' + row.email + '): invalid role "' + row.role + '"'); continue; }

    users.push({
      name:        row.name,
      email:       row.email.toLowerCase(),
      password:    row.password,
      role:        row.role,
      extra_tabs:  row.extra_tabs  ? row.extra_tabs.split(/[\s|,]+/).filter(Boolean)  : [],
      denied_tabs: row.denied_tabs ? row.denied_tabs.split(/[\s|,]+/).filter(Boolean) : []
    });
  }

  if (!users.length && errors.length) {
    log.innerHTML = '<div style="color:var(--red-d);font-size:.82rem">' + errors.map(function(e){ return escH(e); }).join('<br>') + '</div>';
    return;
  }

  // Show preview + confirm button
  var html = '';
  if (errors.length) {
    html += '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 12px;font-size:.78rem;color:var(--red-d);margin-bottom:12px">' +
      '<strong>Skipped rows:</strong><br>' + errors.map(function(e){ return escH(e); }).join('<br>') + '</div>';
  }
  html += '<div style="font-size:.82rem;font-weight:600;color:var(--navy);margin-bottom:8px">Preview — ' + users.length + ' user(s) to import:</div>' +
    '<table style="width:100%;font-size:.78rem;border-collapse:collapse;margin-bottom:14px">' +
    '<thead><tr style="border-bottom:2px solid var(--border)">' +
    '<th style="padding:5px 8px;text-align:left">Name</th><th style="padding:5px 8px;text-align:left">Email</th>' +
    '<th style="padding:5px 8px;text-align:center">Role</th><th style="padding:5px 8px;text-align:center">Extra</th><th style="padding:5px 8px;text-align:center">Denied</th>' +
    '</tr></thead><tbody>';
  users.forEach(function(u) {
    html += '<tr style="border-bottom:1px solid var(--border)">' +
      '<td style="padding:5px 8px">' + escH(u.name) + '</td>' +
      '<td style="padding:5px 8px;color:var(--text-2)">' + escH(u.email) + '</td>' +
      '<td style="padding:5px 8px;text-align:center"><span style="font-size:.72rem;padding:2px 7px;border-radius:5px;background:var(--bg)">' + escH(u.role) + '</span></td>' +
      '<td style="padding:5px 8px;text-align:center;font-size:.72rem;color:var(--green-d)">' + escH(u.extra_tabs.join(', ')||'—') + '</td>' +
      '<td style="padding:5px 8px;text-align:center;font-size:.72rem;color:var(--red-d)">'  + escH(u.denied_tabs.join(', ')||'—') + '</td>' +
      '</tr>';
  });
  html += '</tbody></table>' +
    '<button onclick="umConfirmImport(' + escH(JSON.stringify(users)) + ')" ' +
    'style="width:100%;padding:10px;font-size:.88rem;font-weight:700;border:none;border-radius:8px;background:var(--navy);color:#fff;cursor:pointer">' +
    '✅ Import ' + users.length + ' User(s)</button>';

  log.innerHTML = html;
}

async function umConfirmImport(users) {
  if (typeof users === 'string') {
    try { users = JSON.parse(users); } catch(e) { toast('Parse error', 'error'); return; }
  }
  var log = document.getElementById('um-import-log');
  log.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-3)">Importing…</div>';

  try {
    var r = await fetch('/api/admin/users/import', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({users})
    });
    var d = await r.json();
    if (r.ok) {
      var html = '<div style="padding:12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;font-size:.82rem;margin-bottom:10px">' +
        '✅ <strong>' + (d.created||0) + ' created</strong>, ' +
        '<strong>' + (d.updated||0) + ' updated</strong>' +
        (d.errors && d.errors.length ? ', <span style="color:var(--red-d)">' + d.errors.length + ' errors</span>' : '') +
        '</div>';
      if (d.errors && d.errors.length) {
        html += '<div style="font-size:.78rem;color:var(--red-d)">' + d.errors.map(function(e){ return escH(e); }).join('<br>') + '</div>';
      }
      log.innerHTML = html;
      umLoad();
    } else {
      log.innerHTML = '<div style="color:var(--red-d);font-size:.82rem">' + escH(d.error || 'Import failed') + '</div>';
    }
  } catch(e) {
    log.innerHTML = '<div style="color:var(--red-d);font-size:.82rem">Error: ' + escH(e.message) + '</div>';
  }
}