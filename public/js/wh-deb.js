// ── HELPERS ──────────────────────────────────────────────
// Declarations at top to avoid hoisting issues
const _debSelectedTids = new Set();
let _debHistory = null;

// Centered warning modal — replaces corner toast for validation errors
function debWarn(title, message) {
  var existing = document.getElementById('_deb-warn-modal');
  if (existing) existing.remove();
  var modal = document.createElement('div');
  modal.id = '_deb-warn-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML =
    '<div style="background:var(--card);border-radius:14px;width:100%;max-width:380px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.25)">' +
      '<div style="background:#fffbeb;border-bottom:2px solid #fcd34d;padding:16px 20px;display:flex;align-items:center;gap:10px">' +
        '<span style="font-size:1.4rem">⚠️</span>' +
        '<span style="font-size:.95rem;font-weight:700;color:#92400e">' + title + '</span>' +
      '</div>' +
      '<div style="padding:16px 20px;font-size:.84rem;color:var(--text-2);line-height:1.6">' + message + '</div>' +
      '<div style="padding:0 20px 16px;text-align:right">' +
        '<button id="_deb-warn-ok" class="btn btn-primary" style="min-width:80px">OK</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
  modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
  var ok = document.getElementById('_deb-warn-ok');
  if (ok) ok.onclick = function() { modal.remove(); };
  // Auto-dismiss after 6 seconds
  setTimeout(function() { var m = document.getElementById('_deb-warn-modal'); if (m) m.remove(); }, 6000);
}

function fmtDate(d){if(!d)return '-';const dt=new Date(d);return isNaN(dt)?d:dt.toLocaleDateString('en-IN',{day:'2-digit',month:'short'});}
function fmtAmt(v){return '₹'+parseFloat(v||0).toLocaleString('en-IN',{minimumFractionDigits:2});}

// ── TAB SWITCHING ─────────────────────────────────────────
function debTab(t){
  debCurTab=t;
  ['final','new','recovery','caseopen','history'].forEach(k=>{
    const el=document.getElementById('deb-t-'+k);
    if(el) el.classList.toggle('active',t===k);
  });
  const isHistory=t==='history';
  document.getElementById('deb-active-section').style.display=isHistory?'none':'block';
  document.getElementById('deb-history-section').style.display=isHistory?'block':'none';

  const thead=document.getElementById('deb-thead');
  if(thead){
    thead.style.cssText='position:sticky;top:0;z-index:2;background:var(--card)';
    const chkTh='<th style="width:32px"><input type="checkbox" id="deb-chk-all" onchange="debSelectAll(this.checked)" title="Select all"></th>';
    if(t==='final'){
      thead.innerHTML=`<tr>${chkTh}<th style="text-align:center">TID / Date</th><th style="text-align:center">Bucket / Sub</th><th style="text-align:center">Amount</th><th style="text-align:center">Shipment Type</th><th style="text-align:center">IC / Staff</th><th style="text-align:center">Confirm By</th><th style="text-align:center">Cluster Manager</th><th style="text-align:center">Accept Loss?</th><th style="text-align:center">Remarks</th></tr>`;
    } else if(t==='new'){
      thead.innerHTML=`<tr><th style="text-align:center">TID / Date</th><th style="text-align:center">Bucket / Sub</th><th style="text-align:center">Amount</th><th style="text-align:center">Shipment Type</th><th style="text-align:center">Categorise As</th></tr>`;
    } else if(t==='recovery'){
      thead.innerHTML=`<tr>${chkTh}<th style="text-align:center">TID / Date</th><th style="text-align:center">Bucket / Sub</th><th style="text-align:center">Amount</th><th style="text-align:center">Shipment Type</th><th style="text-align:center">Confirm By</th><th style="text-align:center">Recovery Type</th><th style="text-align:center">IC / Staff</th><th style="text-align:center">Remarks</th><th style="text-align:center"></th></tr>`;
    } else if(t==='caseopen'){
      thead.innerHTML=`<tr>${chkTh}<th style="text-align:center">TID / Date</th><th style="text-align:center">Bucket / Sub</th><th style="text-align:center">Amount</th><th style="text-align:center">Shipment Type</th><th style="text-align:center">Dispute Type</th><th style="text-align:center">TT #</th><th style="text-align:center">Orphan / Label ID</th><th style="text-align:center">Remarks</th><th style="text-align:center"></th></tr>`;
    }
  }

  if(t==='history') loadDebHistory();
  else {
    _debSelectedTids.clear();
    _debUpdateSubmitBtn();
    renderDeb();
  }
}

// ── ROW SELECTION ─────────────────────────────────────────

function debRowToggle(tid, checked){
  if(checked) _debSelectedTids.add(tid);
  else _debSelectedTids.delete(tid);
  const row=document.getElementById('deb-row-'+tid.replace(/[^a-z0-9]/gi,'_'));
  if(row){
    row.style.background=checked?'rgba(34,197,94,.12)':'';
    row.style.outline=checked?'2px solid var(--green-d)':'';
  }
  _debUpdateSubmitBtn();
}

function debSelectAll(checked){
  document.querySelectorAll('.deb-row-chk').forEach(chk=>{
    chk.checked=checked;
    debRowToggle(chk.dataset.tid,checked);
  });
}

function _debUpdateSubmitBtn(){
  const btn=document.getElementById('deb-submit-btn');
  if(!btn) return;
  if(debCurTab==='new'){btn.textContent='CONFIRM CATEGORISATION';return;}
  const n=_debSelectedTids.size;
  btn.textContent=n>0?`SUBMIT ${n} SELECTED ROW${n===1?'':'S'}`:'FINAL SUBMIT DEBIT RESPONSES';
}

// ── RENDER TABLE ──────────────────────────────────────────
function renderDeb(){
  const body=document.getElementById('deb-body');
  const tab=debCurTab;

  const typeMap={'final':'Final Loss','new':'New','recovery':'Recovery','caseopen':'Case Open'};
  const subType=typeMap[tab];
  if(!subType){body.innerHTML='';return;}

  const items=(stationData.debit||[]).filter(i=>i.sub_type===subType);

  if(!items.length){
    const cols={'final':10,'new':5,'recovery':10,'caseopen':10};
    body.innerHTML=`<tr class="empty-row"><td colspan="${cols[tab]||6}" style="text-align:center;padding:28px;color:var(--text-3)">No records in this category</td></tr>`;
    return;
  }

  const chkCell=i=>`<td style="text-align:center"><input type="checkbox" class="deb-row-chk" data-tid="${i.tid}" onchange="debRowToggle('${i.tid}',this.checked)"></td>`;
  const tidCell=i=>`<td><strong style="font-family:'DM Mono',monospace;font-size:.8rem">${i.tid}</strong><div style="font-size:.7rem;color:var(--text-3)">${fmtDate(i.debit_date)}</div></td>`;
  const bucketCell=i=>`<td style="font-size:.78rem">${i.bucket||'-'}<br><span style="color:var(--text-3);font-size:.7rem">${i.loss_sub_bucket||''}</span></td>`;
  const amtCell=i=>`<td style="text-align:center"><strong style="color:var(--red-d)">${fmtAmt(i.amount)}</strong></td>`;
  const icBadges=n=>renderPills(n);  // uses shared renderPills (3 visible, +N more)

  if(tab==='new'){
    body.innerHTML=items.map(i=>`<tr id="deb-row-${i.tid.replace(/[^a-z0-9]/gi,'_')}">
      ${tidCell(i)}${bucketCell(i)}${amtCell(i)}
      <td style="font-size:.78rem;white-space:nowrap;color:var(--text-2);text-align:center">${i.shipment_type||'-'}</td>
      <td style="min-width:150px;text-align:center">
        <select class="deb-cat" data-tid="${i.tid}" style="font-size:.82rem;width:100%">
          <option value="">-- Categorise --</option>
          <option value="Recovery">Recovery</option>
          <option value="Case Open">Case Open</option>
        </select>
      </td>
    </tr>`).join('');
    return;
  }

  if(tab==='final'){
    body.innerHTML=items.map(i=>`<tr id="deb-row-${i.tid.replace(/[^a-z0-9]/gi,'_')}" class="deb-selectable-row">
      ${chkCell(i)}${tidCell(i)}${bucketCell(i)}${amtCell(i)}
      <td style="font-size:.78rem;color:var(--text-2);text-align:center">${i.shipment_type||'-'}</td>
      <td style="font-size:.75rem;text-align:center">${icBadges(i.ic_name)}</td>
      <td style="font-size:.78rem;white-space:nowrap;text-align:center">${i.confirm_by||'-'}</td>
      <td style="font-size:.78rem;white-space:nowrap;color:var(--green-d);font-weight:600;text-align:center">${i.cluster||i.cluster_manager||'-'}</td>
      <td style="min-width:140px;text-align:center">
        <select class="deb-dec" data-tid="${i.tid}" style="font-size:.82rem;width:100%">
          <option value="">Select…</option>
          <option value="Yes">Yes — accept loss</option>
          <option value="No">No — dispute</option>
        </select>
      </td>
      <td style="min-width:180px;text-align:center">
        <input type="text" class="deb-remarks" data-tid="${i.tid}" placeholder="Remarks…" style="font-size:.8rem;width:100%">
      </td>
    </tr>`).join('');
    return;
  }

  if(tab==='recovery'){
    const icOpts=(stationData.ics||[]).map(ic=>`<option value="${ic.ic_name}">${ic.ic_name}</option>`).join('');
    body.innerHTML=items.map(i=>`<tr id="deb-row-${i.tid.replace(/[^a-z0-9]/gi,'_')}" class="deb-selectable-row">
      ${chkCell(i)}${tidCell(i)}${bucketCell(i)}${amtCell(i)}
      <td style="font-size:.78rem;white-space:nowrap;text-align:center">${i.shipment_type||'-'}</td>
      <td style="min-width:120px;text-align:center"><input type="text" class="deb-confirm" data-tid="${i.tid}" value="${i.confirm_by||''}" placeholder="Confirm By…" style="font-size:.8rem;width:100%"></td>
      <td style="min-width:130px;text-align:center">
        <select class="deb-rectype" data-tid="${i.tid}" style="font-size:.82rem;width:100%">
          <option value="">Recovery Type…</option>
          <option value="IC Payment"${i.cash_recovery_type==='IC Payment'?' selected':''}>IC Payment</option>
          <option value="SHIP BANK"${i.cash_recovery_type==='SHIP BANK'?' selected':''}>SHIP BANK</option>
          <option value="CASH"${i.cash_recovery_type==='CASH'?' selected':''}>CASH</option>
        </select>
      </td>
      <td style="min-width:200px;text-align:center">
        <select class="deb-ic-resp" data-tid="${i.tid}" multiple style="font-size:.8rem;width:100%;min-height:56px;border:1px solid var(--border);border-radius:6px;padding:2px">
          ${(stationData.ics||[]).map(ic=>{
            const preSelected=(i.ic_name||'').split(',').map(n=>n.trim()).includes(ic.ic_name);
            return `<option value="${ic.ic_name}"${preSelected?' selected':''}>${ic.ic_name}</option>`;
          }).join('')}
        </select>
        <div style="font-size:.68rem;color:var(--text-3);margin-top:2px">Pre-filled from admin · Hold Ctrl/⌘ to add/remove</div>
      </td>
      <td style="min-width:160px;text-align:center"><input type="text" class="deb-remarks" data-tid="${i.tid}" placeholder="Remarks…" style="font-size:.8rem;width:100%"></td>
      <td><button onclick="moveDebToNew('${i.tid}')" style="font-size:.7rem;padding:3px 8px;border:1px solid var(--text-3);border-radius:6px;background:none;color:var(--text-2);cursor:pointer;white-space:nowrap">↩ New</button></td>
    </tr>`).join('');
    return;
  }

  // Case Open
  body.innerHTML=items.map(i=>`<tr id="deb-row-${i.tid.replace(/[^a-z0-9]/gi,'_')}" class="deb-selectable-row">
    ${chkCell(i)}${tidCell(i)}${bucketCell(i)}${amtCell(i)}
    <td style="font-size:.78rem;white-space:nowrap;text-align:center">${i.shipment_type||'-'}</td>
    <td style="min-width:140px;text-align:center">
      <select class="deb-dispute" data-tid="${i.tid}" style="font-size:.82rem;width:100%">
        <option value="">Dispute Type…</option>
        <option>Orphan</option><option>Scan Issue</option><option>Label Issue</option><option>Seller Issue</option><option>Other</option>
      </select>
    </td>
    <td style="min-width:120px;text-align:center"><input type="text" class="deb-tt" data-tid="${i.tid}" placeholder="TT #" style="font-size:.8rem;width:100%"></td>
    <td style="min-width:160px;text-align:center"><input type="text" class="deb-orphan" data-tid="${i.tid}" placeholder="Orphan / Label ID" style="font-size:.8rem;width:100%"></td>
    <td style="min-width:160px;text-align:center"><input type="text" class="deb-remarks" data-tid="${i.tid}" placeholder="Remarks…" style="font-size:.8rem;width:100%"></td>
    <td><button onclick="moveDebToNew('${i.tid}')" style="font-size:.7rem;padding:3px 8px;border:1px solid var(--text-3);border-radius:6px;background:none;color:var(--text-2);cursor:pointer;white-space:nowrap">↩ New</button></td>
  </tr>`).join('');
}

// ── CATEGORISE (New → Recovery / Case Open) ───────────────
async function submitDebCategorise(){
  const items=(stationData.debit||[]).filter(i=>i.sub_type==='New');
  const toMove=items.filter(i=>{
    const val=document.querySelector(`.deb-cat[data-tid="${i.tid}"]`)?.value||'';
    return val==='Recovery'||val==='Case Open';
  });
  if(!toMove.length){debWarn('No Category Selected', 'Please categorise at least one entry before confirming.');return;}
  let ok=0,fail=0;
  for(const i of toMove){
    const cat=document.querySelector(`.deb-cat[data-tid="${i.tid}"]`).value;
    try{
      const r=await fetch('/api/wh/debit-categorise',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({station:session.station,tid:i.tid,sub_type:cat})});
      if(r.ok){i.sub_type=cat;ok++;}else fail++;
    }catch{fail++;}
  }
  if(ok) toast(`${ok} entr${ok===1?'y':'ies'} categorised.${fail?' '+fail+' failed.':''}`,fail?'warning':'success');
  else   toast('Categorisation failed.','error');
  debTab('recovery'); // switch to recovery/case open to show moved items
}

// ── MOVE BACK TO NEW ──────────────────────────────────────
async function moveDebToNew(tid){
  try{
    const r=await fetch('/api/wh/debit-categorise',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({station:session.station,tid,sub_type:'New'})});
    if(r.ok){
      const item=(stationData.debit||[]).find(i=>i.tid===tid);
      if(item) item.sub_type='New';
      _debSelectedTids.delete(tid);
      toast('Moved back to New.','success');
      renderDeb();
    }else{
      const d=await r.json();
      toast(d.error||'Failed to move.','error');
    }
  }catch(e){toast('Error: '+e.message,'error');}
}

// ── FACE GATE ─────────────────────────────────────────────
function debSubmitWithVerification(){
  const ics=stationData.ics||[];
  if(!ics.length){toast('No ICs loaded — cannot verify.','error');return;}

  let overlay=document.getElementById('deb-verif-overlay');
  if(!overlay){
    overlay=document.createElement('div');
    overlay.id='deb-verif-overlay';
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9000;display:flex;align-items:center;justify-content:center';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML=`
    <div style="background:var(--card);border-radius:var(--r);padding:1.5rem;max-width:360px;width:90%;box-shadow:var(--shadow-md)">
      <div style="font-size:.7rem;color:var(--text-3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px">BIOMETRIC VERIFICATION</div>
      <div style="font-size:1rem;font-weight:700;color:var(--navy);margin-bottom:14px">Who is submitting?</div>
      <select id="deb-verif-ic-sel" style="width:100%;padding:8px 10px;font-size:.9rem;border:1px solid var(--border);border-radius:8px;margin-bottom:14px">
        <option value="">-- Select IC --</option>
        ${ics.map(ic=>`<option value="${ic.ic_id}" data-name="${ic.ic_name}">${ic.ic_name}</option>`).join('')}
      </select>
      <div style="display:flex;gap:10px">
        <button onclick="document.getElementById('deb-verif-overlay').style.display='none'"
          style="flex:1;padding:9px;border:1px solid var(--border);border-radius:8px;background:none;cursor:pointer;font-size:.88rem">Cancel</button>
        <button onclick="debStartFaceVerif()"
          style="flex:2;padding:9px;background:var(--navy);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:.88rem;font-weight:600">
          📷 Scan Face & Submit
        </button>
      </div>
    </div>`;
  overlay.style.display='flex';
}

function debStartFaceVerif(){
  const sel=document.getElementById('deb-verif-ic-sel');
  const icId=sel.value;
  const icName=sel.options[sel.selectedIndex]?.dataset?.name||'';
  if(!icId){debWarn('No IC Selected', 'Please select who is submitting this debit response.');return;}
  document.getElementById('deb-verif-overlay').style.display='none';
  window._faceVerifyCallback=(verifiedName)=>{submitDeb(verifiedName);};
  openFace(icId,icName,true,false,'VERIFY_SUBMIT');
  setTimeout(()=>{const lbl=document.getElementById('face-mode-lbl');if(lbl)lbl.textContent='DEBIT VERIFY';},50);
}

// ── SUBMIT RESPONSES ──────────────────────────────────────
// Collects only currently-visible (current tab) rows that are checked + filled
async function submitDeb(verifiedBy){
  const tab=debCurTab;
  console.log('[submitDeb] tab='+tab+' verifiedBy='+verifiedBy);
  const subTypeMap={'final':'Final Loss','recovery':'Recovery','caseopen':'Case Open'};
  const subType=subTypeMap[tab];
  if(!subType){debWarn('Wrong Tab', 'Please switch to Final Loss, Recovery or Case Open tab to submit responses.');return;}

  // Get items for current tab only
  const tabItems=(stationData.debit||[]).filter(i=>i.sub_type===subType);
  console.log('[submitDeb] tabItems='+tabItems.length+' selected='+_debSelectedTids.size);

  // If checkboxes used, filter to selected; otherwise use all in tab
  const useSelected=_debSelectedTids.size>0;
  const candidates=useSelected?tabItems.filter(i=>_debSelectedTids.has(i.tid)):tabItems;
  console.log('[submitDeb] candidates='+candidates.length);

  // Build rows from DOM — read values from currently rendered inputs
  const rows=[];
  for(const i of candidates){
    const tid=i.tid;
    if(subType==='Final Loss'){
      const decEl=document.querySelector(`.deb-dec[data-tid="${tid}"]`);
      const decision=decEl?decEl.value:'';
      console.log('[submitDeb] FL tid='+tid+' decEl='+(decEl?'found':'MISSING')+' decision='+decision);
      if(!decision){if(useSelected)debWarn('Decision Required', `Please select Yes or No for TID <strong>${tid}</strong> before submitting.`);continue;}
      const remarks=document.querySelector(`.deb-remarks[data-tid="${tid}"]`)?.value||'';
      rows.push({tid,subType:subType,decision,remarks});

    }else if(subType==='Recovery'){
      const rectype=document.querySelector(`.deb-rectype[data-tid="${tid}"]`)?.value||'';
      const confirm=document.querySelector(`.deb-confirm[data-tid="${tid}"]`)?.value||'';
      const icSel=document.querySelector(`.deb-ic-resp[data-tid="${tid}"]`);
      const ics=icSel?[...icSel.selectedOptions].map(o=>o.value).join(', '):'';
      const remarks=document.querySelector(`.deb-remarks[data-tid="${tid}"]`)?.value||'';
      if(!rectype&&!confirm&&!ics&&!remarks){if(useSelected)debWarn('Data Required', `Please fill in at least one field for TID <strong>${tid}</strong> before submitting.`);continue;}
      rows.push({tid,subType:subType,decision:rectype,tt:confirm,orphan:ics,remarks});

    }else{
      // Case Open
      const dispute=document.querySelector(`.deb-dispute[data-tid="${tid}"]`)?.value||'';
      const tt=document.querySelector(`.deb-tt[data-tid="${tid}"]`)?.value||'';
      const orphan=document.querySelector(`.deb-orphan[data-tid="${tid}"]`)?.value||'';
      const remarks=document.querySelector(`.deb-remarks[data-tid="${tid}"]`)?.value||'';
      if(!dispute&&!tt&&!orphan&&!remarks){if(useSelected)debWarn('Data Required', `Please fill in at least one field for TID <strong>${tid}</strong> before submitting.`);continue;}
      rows.push({tid,subType:subType,decision:dispute,tt,orphan,remarks});
    }
  }

  console.log('[submitDeb] rows built: '+rows.length, rows);
  if(!rows.length){
    debWarn('Required Fields Missing', 'Please fill in the required fields for the rows you want to submit.<br><br>For <b>Final Loss</b>: select Yes or No.<br>For <b>Recovery</b>: enter recovery type or confirm by.<br>For <b>Case Open</b>: select dispute type or enter TT #.');
    return;
  }

  try{
    const r=await fetch('/api/submit-deb',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({station:session.station,periodLabel:session.periodLabel,rows,verifiedBy:verifiedBy||null})
    });
    const d=await r.json();
    console.log('[submitDeb] server response:', r.status, JSON.stringify(d));
    if(!r.ok){toast(d.error||'Submit failed.','error');return;}

    // Success
    toast(`${d.submitted} response${d.submitted===1?'':'s'} submitted ✓`,'success');
    _debHistory=null; // force history reload
    _debSelectedTids.clear();

    // Update local stationData — remove submitted tids from debit array
    rows.forEach(row=>{
      const idx=(stationData.debit||[]).findIndex(i=>i.tid===row.tid);
      if(idx>=0) stationData.debit.splice(idx,1);
    });

    if(d.allDone){
      stationData.locks.DEB=true;
      updateModuleBadges();
    }

    // Show updated tab first, then switch to history so user sees confirmation
    renderDeb();
    setTimeout(()=>debTab('history'),800);

  }catch(e){
    toast('Error: '+e.message,'error');
  }
}

// ── HISTORY ───────────────────────────────────────────────

async function loadDebHistory(){
  const cont=document.getElementById('deb-history-body');
  var si=document.getElementById('deb-hist-search'); if(si) si.value='';
  if(_debHistory){renderDebHistory(_debHistory,cont);return;}
  cont.innerHTML='<div style="padding:28px;text-align:center;color:var(--text-3)">Loading history…</div>';
  try{
    const r=await fetch(`/api/deb-history/${session.station}`);
    _debHistory=await r.json();
    renderDebHistory(_debHistory,cont);
  }catch(e){cont.innerHTML='<div style="padding:28px;text-align:center;color:var(--red-d)">Failed to load history.</div>';}
}

function renderDebHistory(groups,cont){
  // Populate lookup cache
  _debHistCache = {};
  (groups||[]).forEach(function(g){ (g.items||[]).forEach(function(i){ _debHistCache[i.tid]=i; }); });
  if(!groups||!groups.length){
    cont.innerHTML='<div style="padding:28px;text-align:center;color:var(--text-3)">No submitted debit history found.</div>';
    return;
  }
  cont.innerHTML=groups.map((g,gi)=>`
    <div class="deb-month-block">
      <div class="deb-month-hd" onclick="debToggleMonth(${gi})">
        <span style="font-weight:700;font-size:.92rem">${g.label}</span>
        <span style="font-size:.8rem;color:var(--text-3);margin-left:10px">${g.items.length} entr${g.items.length===1?'y':'ies'}</span>
        <span style="margin-left:auto;font-size:.9rem" id="deb-chevron-${gi}">▾</span>
      </div>
      <div id="deb-month-${gi}" style="display:${gi===0?'block':'none'}">
        <div class="tbl-wrap" style="margin:0;border-radius:0 0 8px 8px;border-top:none;max-height:55vh;overflow-y:auto;overflow-x:auto">
          <table style="font-size:.78rem">
            <thead style="position:sticky;top:0;z-index:2;background:var(--card)"><tr>
              <th>Debit Type</th><th>TID / Date</th><th>Bucket / Sub</th><th>Shipment Type</th>
              <th style="text-align:center">Amount</th><th style="text-align:center">IC / Staff</th>
              <th>Accept Loss?</th><th>Recovery Type</th><th>Confirm By</th>
              <th>Dispute Type</th><th>TT #</th><th>Orphan Ref</th>
              <th>Rec. Month</th><th>Cluster Manager</th><th>WH Remarks</th><th>Submitted</th>
            </tr></thead>
            <tbody>
              ${g.items.map(i=>`<tr onclick="_debHistOpenDrawer(\'${i.tid}\')" style="cursor:pointer" data-search="${(i.tid||'').toLowerCase()} ${(i.sub_type||'').toLowerCase()} ${(i.bucket||'').toLowerCase()} ${(i.ic_name||'').toLowerCase()} ${(i.recovery_ic_names||'').toLowerCase()} ${(i.shipment_type||'').toLowerCase()} ${(i.recovery_type||i.cash_recovery_type||'').toLowerCase()} ${(i.confirm_by||'').toLowerCase()} ${(i.cluster||'').toLowerCase()} ${(i.wh_remarks||i.remarks||'').toLowerCase()}">
                <td><span style="font-size:.7rem;padding:2px 6px;border-radius:4px;white-space:nowrap;background:${i.sub_type==='Final Loss'?'var(--red-bg)':i.sub_type==='Recovery'?'#dbeafe':'#fef9c3'};color:${i.sub_type==='Final Loss'?'var(--red-d)':i.sub_type==='Recovery'?'var(--navy)':'#92400e'}">${i.sub_type||'-'}</span></td>
                <td><strong style="font-family:'DM Mono',monospace;font-size:.72rem">${i.tid}</strong><div style="font-size:.7rem;color:var(--text-3)">${fmtDate(i.debit_date)}</div></td>
                <td style="font-size:.78rem;text-align:center">${i.bucket||'-'}<br><span style="color:var(--text-3);font-size:.7rem">${i.loss_sub_bucket||''}</span></td>
                <td style="font-size:.73rem;white-space:nowrap;text-align:center">${i.shipment_type||'-'}</td>
                <td style="text-align:center;font-weight:700;color:var(--red-d)">${fmtAmt(i.amount)}</td>
                <td style="min-width:120px;text-align:center">${
                  i.sub_type==='Recovery' && i.recovery_ic_names
                    ? renderPills(i.recovery_ic_names)
                    : renderPills(i.ic_name)
                }</td>
                <td style="font-size:.72rem;text-align:center;font-weight:600">${
                  i.sub_type==='Final Loss'
                    ? (i.decision==='Yes' ? '<span style=\"color:var(--red-d)\">Yes</span>' : i.decision==='No' ? '<span style=\"color:var(--green-d)\">No</span>' : '-')
                    : '-'
                }</td>
                <td style="font-size:.72rem;white-space:nowrap;text-align:center">${i.sub_type==='Recovery' ? (i.recovery_type||'-') : '-'}</td>
                <td style="font-size:.72rem;white-space:nowrap;text-align:center">${i.sub_type==='Recovery' ? (i.recovery_confirm_by||'-') : '-'}</td>
                <td style="font-size:.72rem;color:var(--blue);text-align:center">${i.sub_type==='Case Open' ? (i.decision||'-') : '-'}</td>
                <td style="font-family:monospace;font-size:.72rem;text-align:center">${i.sub_type==='Case Open' ? (i.tt_number||'-') : '-'}</td>
                <td style="font-family:monospace;font-size:.72rem;text-align:center">${i.sub_type==='Case Open' ? (i.orphan_ref||'-') : '-'}</td>
                <td style="font-size:.72rem;text-align:center">${['',"Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+i.recovery_month]||'-'}</td>
                <td style="font-size:.72rem;white-space:nowrap;color:var(--green-d);font-weight:600;text-align:center">${i.cluster||i.cluster_manager||'-'}</td>
                <td style="max-width:160px;text-align:center">${truncRemark(i.wh_remarks||i.remarks)}</td>
                <td style="white-space:nowrap;color:var(--text-3);text-align:center">${fmtDate(i.submitted_at)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>`).join('');
}


// ── WH HISTORY DRAWER ────────────────────────────────────────────────────────
var _debDrawerItem = null;
var _debHistCache = {}; // tid -> item, populated on render

function _debHistOpenDrawer(tid) {
  var item = _debHistCache[tid] || {};
  _debDrawerItem = item;
  var d = item;
  var MONTHS = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Create or reuse drawer overlay
  var overlay = document.getElementById('_deb-drawer-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = '_deb-drawer-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:8000;background:rgba(0,0,0,.35)';
    overlay.onclick = function(e){ if(e.target===overlay) _debCloseDrawer(); };
    document.body.appendChild(overlay);
  }

  var drawer = document.getElementById('_deb-drawer');
  if (!drawer) {
    drawer = document.createElement('div');
    drawer.id = '_deb-drawer';
    drawer.style.cssText = [
      'position:fixed','top:0','right:0','height:100%','width:480px','max-width:95vw',
      'background:var(--card)','box-shadow:-8px 0 40px rgba(0,0,0,.18)',
      'z-index:8001','display:flex','flex-direction:column','overflow:hidden',
      'transform:translateX(100%)','transition:transform .25s cubic-bezier(.4,0,.2,1)'
    ].join(';');
    overlay.appendChild(drawer);
  }

  // Build header
  var subColor = d.sub_type==='Final Loss' ? 'var(--red-d)' : d.sub_type==='Recovery' ? 'var(--navy)' : '#92400e';
  var subBg    = d.sub_type==='Final Loss' ? 'var(--red-bg)' : d.sub_type==='Recovery' ? '#dbeafe' : '#fef9c3';

  // Read-only field helper
  function roField(label, value) {
    if (!value || value==='-') return '';
    return '<div style="display:flex;gap:8px;padding:7px 0;border-bottom:1px solid var(--border)">' +
      '<span style="font-size:.78rem;color:var(--text-3);min-width:130px;flex-shrink:0">' + label + '</span>' +
      '<span style="font-size:.78rem;font-weight:500;color:var(--text-1);word-break:break-word">' + (value||'—') + '</span>' +
      '</div>';
  }

  // Determine response label based on sub_type
  var decisionLabel = d.sub_type==='Final Loss' ? 'WH Decision (Accept/Dispute)' : d.sub_type==='Case Open' ? 'Dispute Type' : 'WH Recovery Type';

  drawer.innerHTML =
    // Header
    '<div style="padding:18px 20px 14px;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;gap:12px">' +
      '<div style="flex:1">' +
        '<div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-3);margin-bottom:4px">Debit Note</div>' +
        '<div style="font-size:1rem;font-weight:700;color:var(--navy);font-family:monospace">' + (d.tid||'') + '</div>' +
        '<div style="margin-top:6px;display:flex;gap:6px;align-items:center">' +
          '<span style="font-size:.75rem;font-weight:600;padding:2px 8px;border-radius:6px;background:' + subBg + ';color:' + subColor + '">' + (d.sub_type||'-') + '</span>' +
          '<span style="font-size:.75rem;color:var(--text-3)">' + (session.station||'') + '</span>' +
        '</div>' +
      '</div>' +
      '<button onclick="_debCloseDrawer()" style="background:none;border:none;cursor:pointer;font-size:1.4rem;color:var(--text-3);line-height:1;padding:4px">×</button>' +
    '</div>' +

    // Scrollable body
    '<div style="flex:1;overflow-y:auto;padding:0 20px">' +

      // Section: Debit Info (read-only)
      '<div style="margin-top:14px">' +
        '<div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-3);margin-bottom:6px">Debit Info</div>' +
        roField('Impact Date', d.debit_date ? String(d.debit_date).substring(0,10) : null) +
        roField('Loss Bucket', d.bucket) +
        roField('Sub Bucket', d.loss_sub_bucket) +
        roField('Shipment Type', d.shipment_type) +
        roField('Amount', d.amount ? '₹' + parseFloat(d.amount).toLocaleString('en-IN', {minimumFractionDigits:2}) : null) +
        roField('IC / Staff', (d.ic_name||'').replace(/,/g, ', ')) +
        roField('Recovery Month', d.recovery_month ? MONTHS[+d.recovery_month] : null) +
        roField('Cluster Manager', d.cluster) +
        roField('Confirm By', d.confirm_by) +
      '</div>' +

      // Divider
      '<div style="margin:16px 0 10px;border-top:2px solid var(--border)"></div>' +

      // Section: WH Response (read-only)
      '<div style="margin-bottom:20px">' +
        '<div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-3);margin-bottom:6px">WH Response</div>' +
        (d.sub_type==='Final Loss' ? roField('Accept Loss?', d.decision==='Yes' ? 'Yes — accept loss' : d.decision==='No' ? 'No — dispute' : null) : '') +
        (d.sub_type==='Recovery' ? roField('Recovery Type', d.recovery_type || null) : '') +
        (d.sub_type==='Recovery' ? roField('Confirm By (WH)', d.recovery_confirm_by || null) : '') +
        (d.sub_type==='Recovery' ? roField('IC / Staff', (d.recovery_ic_names||'').replace(/,/g,', ') || null) : '') +
        (d.sub_type==='Case Open' ? roField('Dispute Type', d.decision || null) : '') +
        (d.sub_type==='Case Open' ? roField('TT #', d.tt_number || null) : '') +
        (d.sub_type==='Case Open' ? roField('Orphan / Label Ref', d.orphan_ref || null) : '') +
        roField('WH Remarks', d.wh_remarks || d.remarks || null) +
      '</div>' +
    '</div>' + // end scrollable body

    // Footer — close only
    '<div style="padding:14px 20px;border-top:1px solid var(--border);text-align:right">' +
      '<button onclick="_debCloseDrawer()" style="padding:9px 24px;font-size:.85rem;border:1.5px solid var(--border);border-radius:8px;background:none;cursor:pointer;color:var(--text-2)">Close</button>' +
    '</div>';

  // Show overlay + animate drawer in
  overlay.style.display = 'block';
  requestAnimationFrame(function(){
    drawer.style.transform = 'translateX(0)';
  });
}

function _debCloseDrawer() {
  var drawer  = document.getElementById('_deb-drawer');
  var overlay = document.getElementById('_deb-drawer-overlay');
  if (drawer)  drawer.style.transform = 'translateX(100%)';
  setTimeout(function(){
    if (overlay) overlay.style.display = 'none';
  }, 260);
}

function _debHistSearch() {
  var term = (document.getElementById('deb-hist-search').value || '').toLowerCase().trim();
  // Show/hide individual rows across all month blocks
  document.querySelectorAll('#deb-history-body tr[data-search]').forEach(function(tr) {
    var show = !term || tr.dataset.search.includes(term);
    tr.style.display = show ? '' : 'none';
  });
  // Show/hide month blocks that have no visible rows
  document.querySelectorAll('#deb-history-body .deb-month-block').forEach(function(block) {
    var hasVisible = block.querySelectorAll('tr[data-search]:not([style*="display: none"]):not([style*="display:none"])').length > 0;
    block.style.display = (!term || hasVisible) ? '' : 'none';
    // Auto-expand blocks that have matches when searching
    if (term && hasVisible) {
      var body = block.querySelector('[id^="deb-month-"]');
      var chev = block.querySelector('[id^="deb-chevron-"]');
      if (body) body.style.display = 'block';
      if (chev) chev.textContent = '▾';
    }
  });
}

function debToggleMonth(gi){
  const body=document.getElementById(`deb-month-${gi}`);
  const chev=document.getElementById(`deb-chevron-${gi}`);
  const open=body.style.display!=='none';
  body.style.display=open?'none':'block';
  chev.textContent=open?'▸':'▾';
}