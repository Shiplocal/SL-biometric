let ovView = 'att';   // att | period | submit | adv | deb
let ovData = null;    // cached data for current view
let ovDrillStation = null;

function setOvView(v) {
  ovView = v;
  ovDrillStation = null;
  document.querySelectorAll('.ov-view-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`ovb-${v}`).classList.add('active');
  // Show/hide date vs period selector
  document.getElementById('ov-date').style.display   = v==='att' ? 'block' : 'none';
  document.getElementById('ov-period').style.display = v!=='att' ? 'block' : 'none';
  document.getElementById('ov-breadcrumb').classList.add('hidden');
  renderOvView();
}

async function renderOvView() {
  const content = document.getElementById('ov-content');
  content.innerHTML = '<div style="padding:28px;text-align:center;color:var(--text-3)">Loading…</div>';
  try {
    if (ovView === 'att')    { await renderAttOv(content); }
    if (ovView === 'period') { await renderPeriodAttOv(content); }
    if (ovView === 'submit') { await renderSubmitOv(content); }
    if (ovView === 'adv')    { await renderAdvOv(content); }
    if (ovView === 'deb')    { await renderDebOv(content); }
  } catch(e) { content.innerHTML='<div style="padding:28px;text-align:center;color:var(--text-3)">Failed to load.</div>'; console.error(e); }
}

// -- Attendance Today ------------------------------------
async function renderAttOv(content) {
  const date = document.getElementById('ov-date').value || new Date().toISOString().split('T')[0];
  document.getElementById('ov-date').value = date;
  const d = await fetch(`/api/admin/attendance-overview?date=${date}`).then(r=>r.json());
  ovData = d;
  if (ovDrillStation) { renderAttDrill(content, ovDrillStation, date); return; }
  const totalPresent = d.stations.reduce((a,s)=>a+s.present,0);
  const totalAbsent  = d.stations.reduce((a,s)=>a+s.absent,0);
  const total        = totalPresent + totalAbsent;
  content.innerHTML = `
    <div class="stat-row">
      <div class="stat-box"><div class="stat-val" style="color:var(--green-d)">${totalPresent}</div><div class="stat-lbl">Present</div><div class="stat-sub">${total?Math.round(totalPresent/total*100):0}% attendance</div></div>
      <div class="stat-box"><div class="stat-val" style="color:var(--red-d)">${totalAbsent}</div><div class="stat-lbl">Absent</div></div>
      <div class="stat-box"><div class="stat-val">${total}</div><div class="stat-lbl">Total ICs</div></div>
      <div class="stat-box"><div class="stat-val" style="color:var(--blue)">${d.stations.length}</div><div class="stat-lbl">Stations</div></div>
    </div>
    <div class="ov-grid">${d.stations.map(s => {
      const pct = s.total ? Math.round(s.present/s.total*100) : 0;
      const col = pct>=80?'var(--green)':pct>=50?'var(--amber)':'var(--red)';
      const currentlyIn = s.ics.filter(ic=>ic.clocked_in).length;
      return `<div class="ov-card" onclick="drillStation('${s.station}')">
        <div class="ov-st">${s.station}<span style="font-size:.68rem;font-weight:600;color:var(--blue)">${currentlyIn>0?`${currentlyIn} in`:''}</span></div>
        <div style="display:flex;gap:14px;margin-bottom:8px">
          <div><div style="font-size:1.3rem;font-weight:700;color:var(--green-d)">${s.present}</div><div style="font-size:.65rem;color:var(--text-3)">PRESENT</div></div>
          <div><div style="font-size:1.3rem;font-weight:700;color:var(--red-d)">${s.absent}</div><div style="font-size:.65rem;color:var(--text-3)">ABSENT</div></div>
          <div><div style="font-size:1.3rem;font-weight:700;color:var(--text-2)">${s.total}</div><div style="font-size:.65rem;color:var(--text-3)">TOTAL</div></div>
        </div>
        <div class="ov-prog"><div class="ov-prog-fill" style="width:${pct}%;background:${col}"></div></div>
        <div style="font-size:.68rem;color:var(--text-3);margin-top:4px">${pct}% present · click for detail</div>
      </div>`;
    }).join('')}</div>`;
}

function renderAttDrill(content, station, date) {
  const s = ovData?.stations?.find(x=>x.station===station);
  if (!s) return;
  const sorted = [...s.ics].sort((a,b)=>{
    if (a.clocked_in && !b.clocked_in) return -1;
    if (!a.clocked_in && b.clocked_in) return 1;
    if (a.present && !b.present) return -1;
    if (!a.present && b.present) return 1;
    return a.ic_name.localeCompare(b.ic_name);
  });
  content.innerHTML = `
    <div class="stat-row">
      <div class="stat-box"><div class="stat-val" style="color:var(--green-d)">${s.present}</div><div class="stat-lbl">Present</div></div>
      <div class="stat-box"><div class="stat-val" style="color:var(--red-d)">${s.absent}</div><div class="stat-lbl">Absent</div></div>
      <div class="stat-box"><div class="stat-val">${s.total}</div><div class="stat-lbl">Total ICs</div></div>
      <div class="stat-box"><div class="stat-val" style="color:var(--blue)">${s.ics.filter(i=>i.clocked_in).length}</div><div class="stat-lbl">Currently In</div></div>
    </div>
    <div class="pc"><div class="tbl-wrap" style="border:none;box-shadow:none">
      ${sorted.map(ic => {
        const init   = ic.ic_name.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
        const avCls  = ic.clocked_in ? 'active' : ic.present ? 'present' : 'absent';
        const stCls  = ic.clocked_in ? 'ic-active' : ic.present ? 'ic-present' : 'ic-absent';
        const stLbl  = ic.clocked_in ? '🟢 Clocked In' : ic.present ? '✓ Was Present' : '✕ Absent';
        const timeStr = ic.first_in ? new Date(ic.first_in).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}) : '';
        const durStr  = ic.total_mins ? fmtMins(ic.total_mins) : '';
        const warn    = ic.has_system ? ' ⚠' : '';
        return `<div class="ic-att-row">
          <div class="ic-av ${avCls}">${init}</div>
          <div class="ic-name-col">
            <div>${ic.ic_name}</div>
            <div class="ic-meta">${ic.ic_id}${timeStr?' · First in: '+timeStr:''}${durStr?' · '+durStr+warn:''}</div>
          </div>
          <span class="ic-status ${stCls}">${stLbl}</span>
        </div>`;
      }).join('')}
    </div></div>`;
}

// -- Period Attendance Overview ---------------------------
async function renderPeriodAttOv(content) {
  const period = document.getElementById('ov-period').value || activePL;
  const d = await fetch(`/api/admin/period-attendance-overview?period=${period}`).then(r=>r.json());
  ovData = d;
  if (ovDrillStation) { renderPeriodDrill(content, ovDrillStation); return; }
  const p = d.period || {};
  content.innerHTML = `
    <div class="ov-grid">${(d.stations||[]).map(s => {
      const pct = s.total ? Math.round(s.fully_attended/s.total*100) : 0;
      const col = pct>=80?'var(--green)':pct>=50?'var(--amber)':'var(--red)';
      return `<div class="ov-card" onclick="drillStation('${s.station}')">
        <div class="ov-st">${s.station}</div>
        <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
          <div style="text-align:center"><div style="font-size:1.1rem;font-weight:700;color:var(--green-d)">${s.fully_attended}</div><div style="font-size:.62rem;color:var(--text-3)">GOOD</div></div>
          <div style="text-align:center"><div style="font-size:1.1rem;font-weight:700;color:var(--amber-d)">${s.partial}</div><div style="font-size:.62rem;color:var(--text-3)">PARTIAL</div></div>
          <div style="text-align:center"><div style="font-size:1.1rem;font-weight:700;color:var(--red-d)">${s.absent}</div><div style="font-size:.62rem;color:var(--text-3)">ABSENT</div></div>
          <div style="text-align:center"><div style="font-size:1.1rem;font-weight:700;color:var(--text-2)">${s.total}</div><div style="font-size:.62rem;color:var(--text-3)">TOTAL</div></div>
        </div>
        <div class="ov-prog"><div class="ov-prog-fill" style="width:${pct}%;background:${col}"></div></div>
        <div style="font-size:.68rem;color:var(--text-3);margin-top:4px">${pct}% good attendance · click for detail</div>
      </div>`;
    }).join('')}</div>`;
}

function renderPeriodDrill(content, station) {
  const s = ovData?.stations?.find(x=>x.station===station);
  if (!s) return;
  const p = ovData.period || {};
  const sorted = [...s.ics].sort((a,b)=>b.days_present-a.days_present);
  content.innerHTML = `
    <div class="stat-row">
      <div class="stat-box"><div class="stat-val">${p.period_days||0}</div><div class="stat-lbl">Period Days</div></div>
      <div class="stat-box"><div class="stat-val" style="color:var(--green-d)">${s.fully_attended}</div><div class="stat-lbl">Good (≥80%)</div></div>
      <div class="stat-box"><div class="stat-val" style="color:var(--amber-d)">${s.partial}</div><div class="stat-lbl">Partial</div></div>
      <div class="stat-box"><div class="stat-val" style="color:var(--red-d)">${s.absent}</div><div class="stat-lbl">Zero days</div></div>
    </div>
    <div class="pc"><div class="tbl-wrap" style="border:none;box-shadow:none">
      ${sorted.map(ic => {
        const pct  = p.period_days ? Math.round(ic.days_present/p.period_days*100) : 0;
        const col  = pct>=80?'var(--green)':pct>=50?'var(--amber)':'var(--red)';
        const init = ic.ic_name.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
        const avCls = pct>=80?'present':pct>0?'active':'absent';
        return `<div class="ic-att-row">
          <div class="ic-av ${avCls}">${init}</div>
          <div class="ic-name-col">
            <div>${ic.ic_name}</div>
            <div class="ic-meta">${ic.ic_id} · ${fmtMins(ic.total_mins||0)} total</div>
          </div>
          <div style="text-align:right;min-width:80px">
            <div style="font-size:.85rem;font-weight:700;color:${col}">${ic.days_present} / ${p.period_days||'?'} days</div>
            <div style="font-size:.68rem;color:var(--text-3)">${pct}%</div>
          </div>
        </div>`;
      }).join('')}
    </div></div>`;
}

// -- Submission Overview ---------------------------------
async function renderSubmitOv(content) {
  const p = document.getElementById('ov-period').value || activePL;
  const listRaw = await fetch(`/api/admin/submission-status?period=${p}`).then(r=>r.json());
  if(!Array.isArray(listRaw)){content.innerHTML=`<div style="padding:24px;color:var(--red-d)">Error: ${listRaw.error||'Failed to load'}</div>`;return;}
  const list = listRaw;
  ovData = {stations: list.map(s=>({station:s.station, ...s}))};
  const submitted = list.filter(s=>s.KMS==='SUBMITTED'&&s.ADV==='SUBMITTED'&&s.DEB==='SUBMITTED').length;
  content.innerHTML = `
    <div class="stat-row">
      <div class="stat-box"><div class="stat-val" style="color:var(--green-d)">${submitted}</div><div class="stat-lbl">Fully Submitted</div></div>
      <div class="stat-box"><div class="stat-val" style="color:var(--amber-d)">${list.length-submitted}</div><div class="stat-lbl">Pending</div></div>
      <div class="stat-box"><div class="stat-val">${list.length}</div><div class="stat-lbl">Total Stations</div></div>
    </div>
    <div class="ov-grid">${list.map(s=>`<div class="ov-card" onclick="drillStation('${s.station}')">
      <div class="ov-st">${s.station}</div>
      <div class="ov-mods">
        ${['KMS','ADV','DEB'].map(m=>`<span class="ov-mod ${s[m]==='SUBMITTED'?'sub':'open'}">${m} ${s[m]==='SUBMITTED'?'✓':'-'}</span>`).join('')}
      </div>
    </div>`).join('')}</div>`;
}

// -- Advances Overview -----------------------------------
async function renderAdvOv(content) {
  const p = document.getElementById('ov-period').value || activePL;
  const data = await fetch(`/api/admin/adv-report?period=${p}`).then(r=>r.json());
  if(!Array.isArray(data)){content.innerHTML=`<div style="padding:24px;color:var(--red-d)">Error: ${data.error||'Failed to load'}</div>`;return;}
  ovData = data;
  if (ovDrillStation) {
    const rows = data.filter(r=>r.station_code===ovDrillStation);
    const total = rows.reduce((a,r)=>a+parseFloat(r.amount||0),0);
    content.innerHTML = `
      <div class="stat-row">
        <div class="stat-box"><div class="stat-val" style="color:var(--amber-d)">₹${total.toLocaleString('en-IN')}</div><div class="stat-lbl">Total Advances</div></div>
        <div class="stat-box"><div class="stat-val">${rows.length}</div><div class="stat-lbl">Requests</div></div>
      </div>
      <div class="pc"><div class="tbl-wrap" style="border:none;box-shadow:none">
        ${rows.map(r=>`<div class="ic-att-row">
          <div class="ic-av present">${r.ic_name.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase()}</div>
          <div class="ic-name-col"><div>${r.ic_name}</div><div class="ic-meta">${r.ic_id} · ${r.reason||'No reason'}</div></div>
          <div style="font-weight:700;color:var(--amber-d)">₹${parseFloat(r.amount||0).toLocaleString('en-IN')}</div>
        </div>`).join('') || '<div style="padding:24px;text-align:center;color:var(--text-3)">No advances for this station</div>'}
      </div></div>`;
    return;
  }
  // Station-level rollup
  const stMap = {};
  data.forEach(r => {
    if (!stMap[r.station_code]) stMap[r.station_code] = {station:r.station_code, total:0, count:0};
    stMap[r.station_code].total += parseFloat(r.amount||0);
    stMap[r.station_code].count++;
  });
  const stations = Object.values(stMap).sort((a,b)=>b.total-a.total);
  const grandTotal = stations.reduce((a,s)=>a+s.total,0);
  content.innerHTML = `
    <div class="stat-row">
      <div class="stat-box"><div class="stat-val" style="color:var(--amber-d)">₹${grandTotal.toLocaleString('en-IN')}</div><div class="stat-lbl">Total Advances</div><div class="stat-sub">${data.length} requests</div></div>
      <div class="stat-box"><div class="stat-val">${stations.length}</div><div class="stat-lbl">Stations</div></div>
    </div>
    <div class="ov-grid">${stations.map(s=>`<div class="ov-card" onclick="drillStation('${s.station}')">
      <div class="ov-st">${s.station}</div>
      <div style="font-size:1.3rem;font-weight:700;color:var(--amber-d)">₹${s.total.toLocaleString('en-IN')}</div>
      <div style="font-size:.72rem;color:var(--text-3);margin-top:4px">${s.count} request${s.count!==1?'s':''} · click for detail</div>
    </div>`).join('') || '<div style="padding:28px;text-align:center;color:var(--text-3)">No advances submitted yet</div>'}`;
}

// -- Debit Overview --------------------------------------
async function renderDebOv(content) {
  const p = document.getElementById('ov-period').value || activePL;
  const data = await fetch(`/api/admin/deb-report?period=${p}`).then(r=>r.json());
  if(!Array.isArray(data)){content.innerHTML=`<div style="padding:24px;color:var(--red-d)">Error: ${data.error||'Failed to load'}</div>`;return;}
  const debItems = await fetch(`/api/admin/debit-items?period=${p}`).then(r=>r.json()).catch(()=>[]);
  ovData = {responses:data, items:debItems};
  if (ovDrillStation) {
    const rows = data.filter(r=>r.station_code===ovDrillStation);
    content.innerHTML = `
      <div class="stat-row">
        <div class="stat-box"><div class="stat-val">${rows.length}</div><div class="stat-lbl">Responses</div></div>
        <div class="stat-box"><div class="stat-val" style="color:var(--green-d)">${rows.filter(r=>r.decision==='Accept Loss').length}</div><div class="stat-lbl">Accepted</div></div>
        <div class="stat-box"><div class="stat-val" style="color:var(--red-d)">${rows.filter(r=>r.decision==='Dispute').length}</div><div class="stat-lbl">Disputed</div></div>
      </div>
      <div class="pc"><div class="tbl-wrap" style="border:none;box-shadow:none">
        ${rows.map(r=>{
          const col = r.decision==='Accept Loss'?'ic-present':r.decision==='Dispute'?'ic-status ic-warn':'ic-absent';
          return `<div class="ic-att-row">
            <div style="font-family:'DM Mono',monospace;font-size:.75rem;color:var(--text-2);min-width:70px">${r.tid}</div>
            <div class="ic-name-col"><div>${r.sub_type||'-'}</div><div class="ic-meta">${r.remarks||r.rec_type||'-'}</div></div>
            <span class="ic-status ${col}">${r.decision||r.rec_type||'-'}</span>
          </div>`;
        }).join('') || '<div style="padding:24px;text-align:center;color:var(--text-3)">No responses yet</div>'}
      </div></div>`;
    return;
  }
  const stMap = {};
  data.forEach(r => {
    if (!stMap[r.station_code]) stMap[r.station_code] = {station:r.station_code, total:0, accepted:0, disputed:0, recovery:0};
    stMap[r.station_code].total++;
    if (r.decision==='Accept Loss') stMap[r.station_code].accepted++;
    else if (r.decision==='Dispute') stMap[r.station_code].disputed++;
    else stMap[r.station_code].recovery++;
  });
  const stations = Object.values(stMap).sort((a,b)=>a.station.localeCompare(b.station));
  content.innerHTML = `
    <div class="ov-grid">${stations.map(s=>`<div class="ov-card" onclick="drillStation('${s.station}')">
      <div class="ov-st">${s.station}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <span class="ov-mod sub">${s.accepted} Accept</span>
        <span class="ov-mod" style="background:var(--amber-bg);color:var(--amber-d);border:1px solid rgba(245,158,11,.2)">${s.disputed} Dispute</span>
        ${s.recovery?`<span class="ov-mod open">${s.recovery} Rec</span>`:''}
      </div>
      <div style="font-size:.68rem;color:var(--text-3);margin-top:6px">click for detail</div>
    </div>`).join('') || '<div style="padding:28px;text-align:center;color:var(--text-3)">No debit responses yet</div>'}`;
}

// -- Drill-down helpers ----------------------------------
function drillStation(station) {
  ovDrillStation = station;
  document.getElementById('ov-breadcrumb').classList.remove('hidden');
  document.getElementById('ov-breadcrumb').style.display = 'flex';
  document.getElementById('ov-drill-label').textContent = station;
  renderOvView();
}
function clearOvDrill() {
  ovDrillStation = null;
  document.getElementById('ov-breadcrumb').classList.add('hidden');
  renderOvView();
}

function fmtDate(d){if(!d)return '-';const dt=new Date(d);return dt.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});}
function fmtMins(m) {
  if (!m) return '0m';
  return m<60?`${m}m`:`${Math.floor(m/60)}h${m%60?String(m%60).padStart(2,'0')+'m':''}`;
}