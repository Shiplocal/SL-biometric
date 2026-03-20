// ── CLUSTER MANAGER TAB ───────────────────────────────────────────────────────

var _cmData = [];       // full list from server
var _cmFiltered = [];   // after search filter

async function loadCMTab() {
  var body = document.getElementById('cm-body');
  if (!body) return;
  body.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-3)">Loading…</div>';
  try {
    var r = await fetch('/api/admin/cluster-managers', {credentials:'include'});
    _cmData = await r.json();
    if (!Array.isArray(_cmData)) { body.innerHTML = '<div style="color:var(--red-d);padding:16px">Error loading</div>'; return; }
    _cmFiltered = _cmData.slice();
    cmRender();
  } catch(e) {
    body.innerHTML = '<div style="color:var(--red-d);padding:16px">Error: ' + e.message + '</div>';
  }
}

function cmFilterList() {
  var q = ((document.getElementById('cm-search') || {}).value || '').toLowerCase().trim();
  _cmFiltered = q
    ? _cmData.filter(function(cm) {
        return (cm.full_name||'').toLowerCase().includes(q) ||
               (cm.email||'').toLowerCase().includes(q) ||
               (cm.assigned_stations||'').toLowerCase().includes(q);
      })
    : _cmData.slice();
  cmRender();
}

function cmRender() {
  var body = document.getElementById('cm-body');
  if (!body) return;
  if (!_cmFiltered.length) {
    body.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-3)">No cluster managers found</div>';
    return;
  }

  var user = window._adminUser || {};
  var canEdit = ['superadmin','ops_admin'].includes(user.role);

  var html = '<div style="overflow-x:auto"><table style="width:100%;font-size:.82rem;border-collapse:collapse">' +
    '<thead><tr style="border-bottom:2px solid var(--border);background:var(--bg)">' +
    '<th style="padding:10px 14px;text-align:left;font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3)">Name</th>' +
    '<th style="padding:10px 14px;text-align:left;font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3)">Contact</th>' +
    '<th style="padding:10px 14px;text-align:center;font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3)">Stations</th>' +
    '<th style="padding:10px 14px;text-align:left;font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3)">Assigned Stations</th>' +
    '<th style="padding:10px 14px;text-align:center;font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3)">Admin Access</th>' +
    (canEdit ? '<th style="padding:10px 14px;text-align:center;font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3)">Actions</th>' : '') +
    '</tr></thead><tbody>';

  _cmFiltered.forEach(function(cm) {
    var hasAdmin = !!cm.admin_user_id;
    var adminBadge = hasAdmin
      ? (cm.admin_active
          ? '<span style="padding:2px 8px;border-radius:5px;font-size:.72rem;font-weight:600;background:#dcfce7;color:#15803d">● Active</span>'
          : '<span style="padding:2px 8px;border-radius:5px;font-size:.72rem;font-weight:600;background:#fee2e2;color:#dc2626">● Disabled</span>')
      : '<span style="padding:2px 8px;border-radius:5px;font-size:.72rem;font-weight:600;background:var(--bg);color:var(--text-3)">No access</span>';

    var stations = (cm.assigned_stations || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean);
    var stationPills = stations.length
      ? stations.map(function(s){ return '<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:.72rem;font-weight:600;background:var(--blue-bg);color:var(--blue);margin:1px">' + escH(s) + '</span>'; }).join(' ')
      : '<span style="color:var(--text-3);font-size:.78rem">No stations assigned</span>';

    html += '<tr style="border-bottom:1px solid var(--border);cursor:pointer" onclick="cmOpenDrawer(' + cm.id + ')">' +
      '<td style="padding:10px 14px">' +
        '<div style="font-weight:700;color:var(--navy)">' + escH(cm.full_name) + '</div>' +
        (cm.station_code ? '<div style="font-size:.74rem;color:var(--text-3)">Home: ' + escH(cm.station_code) + '</div>' : '') +
      '</td>' +
      '<td style="padding:10px 14px">' +
        (cm.email ? '<div style="font-size:.78rem;color:var(--text-2)">' + escH(cm.email) + '</div>' : '') +
        (cm.mobile ? '<div style="font-size:.76rem;color:var(--text-3)">' + escH(cm.mobile) + '</div>' : '') +
      '</td>' +
      '<td style="padding:10px 14px;text-align:center">' +
        '<span style="font-size:1rem;font-weight:700;color:' + (cm.station_count > 0 ? 'var(--navy)' : 'var(--text-3)') + '">' + (cm.station_count || 0) + '</span>' +
      '</td>' +
      '<td style="padding:10px 14px;max-width:280px">' + stationPills + '</td>' +
      '<td style="padding:10px 14px;text-align:center">' + adminBadge + '</td>' +
      (canEdit ?
        '<td style="padding:10px 14px;text-align:center;white-space:nowrap" onclick="event.stopPropagation()">' +
          '<button class="btn btn-ghost btn-sm" style="font-size:.72rem;margin-right:3px" data-id="' + cm.id + '" onclick="cmOpenDrawer(parseInt(this.dataset.id))">✏️ Manage</button>' +
          (!hasAdmin && cm.email ?
            '<button class="btn btn-ghost btn-sm" style="font-size:.72rem;color:var(--green-d)" data-id="' + cm.id + '" onclick="cmCreateAdminUser(parseInt(this.dataset.id))">+ Admin Access</button>' : '') +
        '</td>' : '') +
      '</tr>';
  });

  html += '</tbody></table></div>';

  // Summary stats
  var withAccess = _cmData.filter(function(cm){ return !!cm.admin_user_id && cm.admin_active; }).length;
  var withStations = _cmData.filter(function(cm){ return cm.station_count > 0; }).length;
  html = '<div style="display:flex;gap:20px;padding:12px 16px;border-bottom:1px solid var(--border);background:var(--bg);font-size:.8rem;flex-wrap:wrap">' +
    '<span>Total CMs: <strong>' + _cmData.length + '</strong></span>' +
    '<span>With stations: <strong>' + withStations + '</strong></span>' +
    '<span>With admin access: <strong style="color:var(--green-d)">' + withAccess + '</strong></span>' +
    '</div>' + html;

  body.innerHTML = html;
}

// ── CM DETAIL DRAWER ──────────────────────────────────────────────────────────
var _cmDrawerCM = null;
var _cmAllStations = [];

async function cmOpenDrawer(id) {
  _cmDrawerCM = _cmData.find(function(cm){ return cm.id === id; });
  if (!_cmDrawerCM) return;

  var overlay = document.getElementById('_cm-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = '_cm-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:8000;background:rgba(0,0,0,.45)';
    overlay.onclick = function(e){ if(e.target===overlay) cmCloseDrawer(); };
    document.body.appendChild(overlay);
  }
  var drawer = document.getElementById('_cm-drawer');
  if (!drawer) {
    drawer = document.createElement('div');
    drawer.id = '_cm-drawer';
    drawer.style.cssText = 'position:fixed;top:0;right:0;height:100%;width:540px;max-width:96vw;' +
      'background:var(--card);box-shadow:-8px 0 40px rgba(0,0,0,.18);z-index:8001;' +
      'display:flex;flex-direction:column;overflow:hidden;' +
      'transform:translateX(100%);transition:transform .25s cubic-bezier(.4,0,.2,1)';
    overlay.appendChild(drawer);
  }

  // Load CM's stations + all available stations in parallel
  try {
    var [cmStations, allStationsR] = await Promise.all([
      fetch('/api/admin/cluster-managers/' + id + '/stations').then(function(r){ return r.json(); }),
      fetch('/api/admin/stations-list').then(function(r){ return r.json(); })
    ]);
    _cmAllStations = Array.isArray(allStationsR) ? allStationsR : [];
    cmBuildDrawer(drawer, _cmDrawerCM, cmStations);
  } catch(e) {
    drawer.innerHTML = '<div style="padding:20px;color:var(--red-d)">Error: ' + e.message + '</div>';
  }

  overlay.style.display = 'block';
  requestAnimationFrame(function(){ drawer.style.transform = 'translateX(0)'; });
}

function cmBuildDrawer(drawer, cm, cmStations) {
  var hasAdmin = !!cm.admin_user_id;
  var user = window._adminUser || {};
  var canEdit = ['superadmin','ops_admin'].includes(user.role);

  var assignedCodes = cmStations.map(function(s){ return s.station_code; });

  var stationsList = _cmAllStations.map(function(st) {
    var assigned = assignedCodes.indexOf(st.station_code) !== -1;
    return '<label style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);cursor:' + (canEdit?'pointer':'default') + '">' +
      '<input type="checkbox" class="cm-station-chk" value="' + escH(st.station_code) + '"' +
        (assigned ? ' checked' : '') +
        (!canEdit ? ' disabled' : '') +
        ' style="width:15px;height:15px;cursor:' + (canEdit?'pointer':'default') + '">' +
      '<div style="flex:1">' +
        '<span style="font-weight:600;font-size:.82rem">' + escH(st.station_code) + '</span>' +
        (st.store_name ? '<span style="font-size:.76rem;color:var(--text-3);margin-left:6px">' + escH(st.store_name) + '</span>' : '') +
      '</div>' +
      (assigned ? '<span style="font-size:.7rem;color:var(--green-d);font-weight:600">✓ Assigned</span>' : '') +
    '</label>';
  }).join('');

  var adminSection = hasAdmin
    ? '<div style="padding:12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;margin-bottom:16px">' +
        '<div style="font-size:.78rem;font-weight:700;color:var(--green-d);margin-bottom:4px">✓ Admin Portal Access</div>' +
        '<div style="font-size:.8rem;color:var(--text-2)">' + escH(cm.admin_email||'') + '</div>' +
        '<div style="font-size:.76rem;color:var(--text-3);margin-top:2px">Role: ' + escH(cm.admin_role||'') + ' · ' + (cm.admin_active ? 'Active' : 'Disabled') + '</div>' +
        (canEdit ? '<button onclick="cmOpenAdminEdit(' + cm.id + ')" style="margin-top:8px;padding:4px 12px;font-size:.76rem;border:1.5px solid var(--border);border-radius:6px;background:none;cursor:pointer">Edit Access</button>' : '') +
      '</div>'
    : (cm.email && canEdit
        ? '<div style="padding:12px;background:var(--bg);border:1px dashed var(--border);border-radius:8px;margin-bottom:16px;text-align:center">' +
            '<div style="font-size:.8rem;color:var(--text-3);margin-bottom:8px">No admin portal access yet</div>' +
            '<button onclick="cmCreateAdminUser(' + cm.id + ')" style="padding:7px 16px;font-size:.82rem;font-weight:700;border:none;border-radius:8px;background:var(--navy);color:#fff;cursor:pointer">+ Grant Admin Access</button>' +
          '</div>'
        : (!cm.email
            ? '<div style="padding:12px;background:#fef9c3;border:1px solid #fde68a;border-radius:8px;margin-bottom:16px;font-size:.8rem;color:#92400e">⚠️ No email on file — cannot create admin account</div>'
            : ''));

  drawer.innerHTML =
    '<div style="padding:16px 20px 12px;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;gap:10px">' +
      '<div style="flex:1">' +
        '<div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.07em;color:var(--text-3);margin-bottom:4px">Cluster Manager</div>' +
        '<div style="font-size:1rem;font-weight:700;color:var(--navy)">' + escH(cm.full_name) + '</div>' +
        '<div style="font-size:.78rem;color:var(--text-2);margin-top:3px">' + escH(cm.email||cm.mobile||'') + '</div>' +
      '</div>' +
      '<button onclick="cmCloseDrawer()" style="background:none;border:none;cursor:pointer;font-size:1.4rem;color:var(--text-3);line-height:1;padding:4px">×</button>' +
    '</div>' +

    '<div style="flex:1;overflow-y:auto;padding:16px 20px">' +
      adminSection +

      '<div style="font-size:.78rem;font-weight:700;color:var(--text-2);margin-bottom:10px">' +
        'Station Assignments <span style="font-weight:400;color:var(--text-3);font-size:.74rem" id="cm-sta-count">(' + assignedCodes.length + ' assigned)</span>' +
      '</div>' +
      '<div style="margin-bottom:10px">' +
        '<input type="text" placeholder="Search stations…" oninput="cmFilterStations(this.value)" ' +
        'style="width:100%;padding:7px 10px;font-size:.82rem;border:1.5px solid var(--border);border-radius:8px;box-sizing:border-box">' +
      '</div>' +
      '<div id="cm-stations-list" style="max-height:340px;overflow-y:auto">' + stationsList + '</div>' +
    '</div>' +

    (canEdit ?
      '<div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end">' +
        '<button onclick="cmCloseDrawer()" style="padding:8px 18px;font-size:.84rem;border:1.5px solid var(--border);border-radius:8px;background:none;cursor:pointer;color:var(--text-2)">Cancel</button>' +
        '<button onclick="cmSaveStations(' + cm.id + ')" style="padding:8px 20px;font-size:.84rem;font-weight:700;border:none;border-radius:8px;background:var(--navy);color:#fff;cursor:pointer">💾 Save Stations</button>' +
      '</div>'
    :
      '<div style="padding:12px 20px;border-top:1px solid var(--border);text-align:right">' +
        '<button onclick="cmCloseDrawer()" style="padding:8px 18px;font-size:.84rem;border:1.5px solid var(--border);border-radius:8px;background:none;cursor:pointer">Close</button>' +
      '</div>'
    );

  // Update count on checkbox change
  drawer.querySelectorAll('.cm-station-chk').forEach(function(chk) {
    chk.onchange = function() {
      var checked = drawer.querySelectorAll('.cm-station-chk:checked').length;
      var el = document.getElementById('cm-sta-count');
      if (el) el.textContent = '(' + checked + ' assigned)';
    };
  });
}

function cmFilterStations(q) {
  var labels = document.querySelectorAll('#cm-stations-list label');
  q = q.toLowerCase();
  labels.forEach(function(lbl) {
    lbl.style.display = (!q || lbl.textContent.toLowerCase().includes(q)) ? '' : 'none';
  });
}

async function cmSaveStations(cmId) {
  var checked = Array.from(document.querySelectorAll('.cm-station-chk:checked')).map(function(el){ return el.value; });
  var unchecked = Array.from(document.querySelectorAll('.cm-station-chk:not(:checked)')).map(function(el){ return el.value; });

  try {
    var r = await fetch('/api/admin/cluster-managers/' + cmId + '/stations', {
      method: 'PATCH',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ add_stations: checked, remove_stations: unchecked })
    });
    var d = await r.json();
    if (r.ok) {
      if (typeof toast === 'function') toast('Station assignments saved ✓', 'success');
      cmCloseDrawer();
      loadCMTab();
    } else {
      if (typeof toast === 'function') toast('Save failed: ' + (d.error||'unknown'), 'error');
    }
  } catch(e) {
    if (typeof toast === 'function') toast('Error: ' + e.message, 'error');
  }
}

function cmCloseDrawer() {
  var drawer  = document.getElementById('_cm-drawer');
  var overlay = document.getElementById('_cm-overlay');
  if (drawer)  drawer.style.transform = 'translateX(100%)';
  setTimeout(function(){ if(overlay) overlay.style.display = 'none'; }, 260);
  _cmDrawerCM = null;
}

// ── CREATE ADMIN USER FOR CM ──────────────────────────────────────────────────
async function cmCreateAdminUser(cmId) {
  var cm = _cmData.find(function(c){ return c.id === cmId; });
  if (!cm || !cm.email) return;

  // Open the admin user creation drawer pre-filled with CM data
  if (typeof umShowDrawer === 'function') {
    cmCloseDrawer();
    // Pre-populate a fake user object for the drawer
    var fakeCM = {
      id: null,
      name: cm.full_name,
      email: cm.email,
      role: 'cluster_manager',
      extra_tabs: [],
      denied_tabs: [],
      is_active: 1,
      cm_staff_id: cm.id  // Link admin account to staff record by ID, not email
    };
    umShowDrawer(null, fakeCM);
  }
}

function cmOpenAdminEdit(cmId) {
  var cm = _cmData.find(function(c){ return c.id === cmId; });
  if (!cm || !cm.admin_user_id) return;
  var adminUser = _umUsers ? _umUsers.find(function(u){ return u.id === cm.admin_user_id; }) : null;
  if (adminUser && typeof umShowDrawer === 'function') {
    cmCloseDrawer();
    umShowDrawer(adminUser);
  }
}

// ── ESC closes CM drawer ──────────────────────────────────────────────────────
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') cmCloseDrawer();
});

function escH(v) {
  return (v||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
}