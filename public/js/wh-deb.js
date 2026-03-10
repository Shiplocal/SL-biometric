// fmtDate: local copy, no dependency on wh-kms.js
function fmtDate(d){if(!d)return '-';const dt=new Date(d);return isNaN(dt)?d:dt.toLocaleDateString('en-IN',{day:'2-digit',month:'short'});}
function fmtAmt(v){return '₹'+parseFloat(v||0).toLocaleString('en-IN',{minimumFractionDigits:2});}

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
    if(t==='final'){
      thead.innerHTML=`<tr>
        <th>TID / Date</th><th>Bucket / Sub</th>
        <th style="text-align:right">Amount</th>
        <th>Shipment Type</th>
        <th>Accept Loss?</th><th>Remarks</th>
      </tr>`;
    } else if(t==='new'){
      thead.innerHTML=`<tr>
        <th>TID / Date</th><th>Bucket / Sub</th>
        <th style="text-align:right">Amount</th>
        <th>IC / DA</th><th>Categorise As</th>
      </tr>`;
    } else if(t==='recovery'){
      thead.innerHTML=`<tr>
        <th>TID / Date</th><th>Bucket / Sub</th>
        <th style="text-align:right">Amount</th>
        <th>Shipment Type</th>
        <th>Confirm By</th>
        <th>Recovery Type</th>
        <th>IC(s) Responsible</th>
        <th>Remarks</th><th></th>
      </tr>`;
    } else if(t==='caseopen'){
      thead.innerHTML=`<tr>
        <th>TID / Date</th><th>Bucket / Sub</th>
        <th style="text-align:right">Amount</th>
        <th>Shipment Type</th>
        <th>Dispute Type</th><th>TT #</th>
        <th>Orphan / Label ID</th><th>Remarks</th><th></th>
      </tr>`;
    } else {
      thead.innerHTML=`<tr>
        <th>TID / Date</th><th>Bucket / Sub</th>
        <th style="text-align:right">Amount</th>
        <th>Dispute Type</th><th>TT #</th>
        <th>Orphan / Label ID</th><th>Remarks</th><th></th>
      </tr>`;
    }
  }

  if(t==='history') loadDebHistory();
  else {
    const btn=document.getElementById('deb-submit-btn');
    if(btn) btn.textContent=t==='new'?'CONFIRM CATEGORISATION':'FINAL SUBMIT DEBIT RESPONSES';
    renderDeb();
  }
}

function renderDeb(){
  const body=document.getElementById('deb-body');

  let items;
  if(debCurTab==='final')         items=(stationData.debit||[]).filter(i=>i.sub_type==='Final Loss');
  else if(debCurTab==='new')      items=(stationData.debit||[]).filter(i=>i.sub_type==='New');
  else if(debCurTab==='recovery') items=(stationData.debit||[]).filter(i=>i.sub_type==='Recovery');
  else if(debCurTab==='caseopen') items=(stationData.debit||[]).filter(i=>i.sub_type==='Case Open');
  else { body.innerHTML=''; return; }

  if(!items.length){
    const span = debCurTab==='new'||debCurTab==='final' ? 6
               : debCurTab==='recovery' ? 9
               : debCurTab==='caseopen' ? 9 : 6;
    body.innerHTML=`<tr class="empty-row"><td colspan="${span}" style="text-align:center;padding:28px;color:var(--text-3)">No records in this category</td></tr>`;
    return;
  }

  if(debCurTab==='new'){
    body.innerHTML=items.map(i=>`<tr id="deb-row-${i.tid.replace(/[^a-z0-9]/gi,'_')}">
      <td>
        <strong style="font-family:'DM Mono',monospace;font-size:.8rem">${i.tid}</strong>
        <div style="font-size:.7rem;color:var(--text-3)">${fmtDate(i.debit_date)}</div>
      </td>
      <td style="font-size:.78rem">${i.bucket||'-'}<br><span style="color:var(--text-3);font-size:.7rem">${i.loss_sub_bucket||''}</span></td>
      <td style="text-align:right"><strong style="color:var(--red-d)">${fmtAmt(i.amount)}</strong></td>
      <td style="font-size:.78rem">${i.ic_name||'-'}</td>
      <td style="min-width:150px">
        <select class="deb-cat" data-tid="${i.tid}" style="font-size:.82rem;width:100%">
          <option value="">-- Categorise --</option>
          <option value="Recovery">Recovery</option>
          <option value="Case Open">Case Open</option>
        </select>
      </td>
    </tr>`).join('');
    return;
  }

  if(debCurTab==='final'){
    body.innerHTML=items.map(i=>`<tr id="deb-row-${i.tid.replace(/[^a-z0-9]/gi,'_')}">
      <td>
        <strong style="font-family:'DM Mono',monospace;font-size:.8rem">${i.tid}</strong>
        <div style="font-size:.7rem;color:var(--text-3)">${fmtDate(i.debit_date)}</div>
      </td>
      <td style="font-size:.78rem">${i.bucket||'-'}<br><span style="color:var(--text-3);font-size:.7rem">${i.loss_sub_bucket||''}</span></td>
      <td style="text-align:right"><strong style="color:var(--red-d)">${fmtAmt(i.amount)}</strong></td>
      <td style="font-size:.78rem;color:var(--text-2)">${i.shipment_type||'-'}</td>
      <td style="min-width:140px">
        <select class="deb-dec" data-tid="${i.tid}" style="font-size:.82rem;width:100%">
          <option value="">Select…</option>
          <option value="Yes">Yes</option>
          <option value="No">No</option>
        </select>
      </td>
      <td style="min-width:180px">
        <input type="text" class="deb-remarks" data-tid="${i.tid}" placeholder="Remarks…" style="font-size:.8rem;width:100%">
      </td>
    </tr>`).join('');
    return;
  }

  if(debCurTab==='recovery'){
    // Build IC options from station's IC list
    const icOpts = (stationData.ics||[]).map(ic=>
      `<option value="${ic.ic_name}">${ic.ic_name}</option>`
    ).join('');

    body.innerHTML=items.map(i=>`<tr id="deb-row-${i.tid.replace(/[^a-z0-9]/gi,'_')}">
      <td>
        <strong style="font-family:'DM Mono',monospace;font-size:.8rem">${i.tid}</strong>
        <div style="font-size:.7rem;color:var(--text-3)">${fmtDate(i.debit_date)}</div>
      </td>
      <td style="font-size:.78rem">${i.bucket||'-'}<br><span style="color:var(--text-3);font-size:.7rem">${i.loss_sub_bucket||''}</span></td>
      <td style="text-align:right"><strong style="color:var(--red-d)">${fmtAmt(i.amount)}</strong></td>
      <td style="font-size:.78rem;white-space:nowrap">${i.shipment_type||'-'}</td>
      <td style="min-width:120px">
        <input type="text" class="deb-confirm" data-tid="${i.tid}" value="${i.confirm_by||''}" placeholder="Confirm By…" style="font-size:.8rem;width:100%">
      </td>
      <td style="min-width:130px">
        <select class="deb-rectype" data-tid="${i.tid}" style="font-size:.82rem;width:100%">
          <option value="">Recovery Type…</option>
          <option value="IC Payment"${i.cash_recovery_type==='IC Payment'?' selected':''}>IC Payment</option>
          <option value="SHIP BANK"${i.cash_recovery_type==='SHIP BANK'?' selected':''}>SHIP BANK</option>
          <option value="CASH"${i.cash_recovery_type==='CASH'?' selected':''}>CASH</option>
        </select>
      </td>
      <td style="min-width:180px">
        <select class="deb-ic-resp" data-tid="${i.tid}" multiple
          style="font-size:.8rem;width:100%;min-height:56px;border:1px solid var(--border);border-radius:6px;padding:2px">
          ${icOpts}
        </select>
        <div style="font-size:.68rem;color:var(--text-3);margin-top:2px">Hold Ctrl/⌘ to select multiple</div>
      </td>
      <td style="min-width:160px">
        <input type="text" class="deb-remarks" data-tid="${i.tid}" placeholder="Remarks…" style="font-size:.8rem;width:100%">
      </td>
      <td>
        <button onclick="moveDebToNew('${i.tid}')" title="Move back to New"
          style="font-size:.7rem;padding:3px 8px;border:1px solid var(--text-3);border-radius:6px;background:none;color:var(--text-2);cursor:pointer;white-space:nowrap">
          ↩ New
        </button>
      </td>
    </tr>`).join('');
    return;
  }

  // Case Open
  body.innerHTML=items.map(i=>`<tr id="deb-row-${i.tid.replace(/[^a-z0-9]/gi,'_')}">
    <td>
      <strong style="font-family:'DM Mono',monospace;font-size:.8rem">${i.tid}</strong>
      <div style="font-size:.7rem;color:var(--text-3)">${fmtDate(i.debit_date)}</div>
    </td>
    <td style="font-size:.78rem">${i.bucket||'-'}<br><span style="color:var(--text-3);font-size:.7rem">${i.loss_sub_bucket||''}</span></td>
    <td style="text-align:right"><strong style="color:var(--red-d)">${fmtAmt(i.amount)}</strong></td>
    <td style="font-size:.78rem;white-space:nowrap">${i.shipment_type||'-'}</td>
    <td style="min-width:140px">
      <select class="deb-dispute" data-tid="${i.tid}" style="font-size:.82rem;width:100%">
        <option value="">Dispute Type…</option>
        <option>Orphan</option>
        <option>Scan Issue</option>
        <option>Label Issue</option>
        <option>Seller Issue</option>
        <option>Other</option>
      </select>
    </td>
    <td style="min-width:120px">
      <input type="text" class="deb-tt" data-tid="${i.tid}" placeholder="TT #" style="font-size:.8rem;width:100%">
    </td>
    <td style="min-width:160px">
      <input type="text" class="deb-orphan" data-tid="${i.tid}" placeholder="Orphan / Double Label ID" style="font-size:.8rem;width:100%">
    </td>
    <td style="min-width:160px">
      <input type="text" class="deb-remarks" data-tid="${i.tid}" placeholder="Remarks…" style="font-size:.8rem;width:100%">
    </td>
    <td>
      <button onclick="moveDebToNew('${i.tid}')" title="Move back to New"
        style="font-size:.7rem;padding:3px 8px;border:1px solid var(--text-3);border-radius:6px;background:none;color:var(--text-2);cursor:pointer;white-space:nowrap">
        ↩ New
      </button>
    </td>
  </tr>`).join('');
}

// ── CATEGORISE (New → Recovery / Case Open) ─────────────
async function submitDebCategorise(){
  const items=(stationData.debit||[]).filter(i=>i.sub_type==='New');
  const toMove=items.filter(i=>{
    const val=document.querySelector(`.deb-cat[data-tid="${i.tid}"]`)?.value||'';
    return val==='Recovery'||val==='Case Open';
  });
  if(!toMove.length){
    toast('Select a category for at least one entry.','warning');
    return;
  }
  let ok=0, fail=0;
  for(const i of toMove){
    const cat=document.querySelector(`.deb-cat[data-tid="${i.tid}"]`).value;
    try{
      const r=await fetch('/api/wh/debit-categorise',{
        method:'PATCH',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({station:session.station,tid:i.tid,sub_type:cat})
      });
      if(r.ok){ i.sub_type=cat; ok++; }
      else fail++;
    }catch{ fail++; }
  }
  if(ok) toast(`${ok} entr${ok===1?'y':'ies'} categorised.${fail?' '+fail+' failed.':''}`,fail?'warning':'success');
  else   toast('Categorisation failed. Please try again.','error');
  renderDeb();
}

// ── MOVE BACK TO NEW ────────────────────────────────────
async function moveDebToNew(tid){
  try{
    const r=await fetch('/api/wh/debit-categorise',{
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({station:session.station,tid,sub_type:'New'})
    });
    if(r.ok){
      const item=(stationData.debit||[]).find(i=>i.tid===tid);
      if(item) item.sub_type='New';
      toast('Moved back to New.','success');
      renderDeb();
    } else {
      const d=await r.json();
      toast(d.error||'Failed to move.','error');
    }
  }catch(e){toast('Error: '+e.message,'error');}
}

// ── FACE GATE FOR DEBIT SUBMIT ──────────────────────────
function debSubmitWithVerification(){
  // Build IC picker modal
  const ics = stationData.ics||[];
  if(!ics.length){ toast('No ICs loaded — cannot verify.','error'); return; }

  // Create overlay
  let overlay = document.getElementById('deb-verif-overlay');
  if(!overlay){
    overlay = document.createElement('div');
    overlay.id = 'deb-verif-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9000;display:flex;align-items:center;justify-content:center';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
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
  overlay.style.display = 'flex';
}

function debStartFaceVerif(){
  const sel = document.getElementById('deb-verif-ic-sel');
  const icId = sel.value;
  const icName = sel.options[sel.selectedIndex]?.dataset?.name||'';
  if(!icId){ toast('Please select an IC first.','warning'); return; }

  // Hide picker, set callback, open face modal
  document.getElementById('deb-verif-overlay').style.display = 'none';

  // Register one-time success callback
  window._faceVerifyCallback = (verifiedName) => { submitDeb(verifiedName); };

  // Open face modal in VERIFY_SUBMIT mode
  face.icId = icId;
  face.icName = icName;
  face.action = 'VERIFY_SUBMIT';
  const labels = document.getElementById('face-mode-lbl');
  const nameEl = document.getElementById('face-name-lbl');
  if(labels) labels.textContent = 'DEBIT SUBMISSION';
  if(nameEl)  nameEl.textContent = icName;
  document.getElementById('shift-result').style.display = 'none';
  document.getElementById('v-wrap').style.display = 'block';
  setFaceStatus('idle','Initialising camera…');
  const btn = document.getElementById('btn-face-action');
  btn.disabled = true;
  btn.textContent = 'Verify & Submit';
  btn.className = 'btn btn-primary';
  document.getElementById('face-ring').className = 'face-ring';
  document.getElementById('face-overlay').classList.remove('hidden');
  navigator.mediaDevices.getUserMedia({video:{width:640,facingMode:'user'}})
    .then(stream=>{
      face.stream = stream;
      const vid = document.getElementById('face-video');
      vid.srcObject = stream;
      vid.onloadedmetadata = ()=>{
        if(face.aiReady){ setFaceStatus('idle','Ready — click Verify & Submit'); btn.disabled=false; }
        else{
          setFaceStatus('scanning','Loading AI…');
          const w = setInterval(()=>{
            if(face.aiReady){ clearInterval(w); setFaceStatus('idle','Ready — click Verify & Submit'); btn.disabled=false; }
          },500);
        }
      };
    })
    .catch(()=>setFaceStatus('error','Camera access denied'));
}

// ── SUBMIT RESPONSES (Final Loss / Recovery / Case Open) ─
async function submitDeb(verifiedBy){
  const filled=(stationData.debit||[]).filter(i=>{
    if(i.sub_type==='New') return false;
    if(i.sub_type==='Final Loss'){
      return !!(document.querySelector(`.deb-dec[data-tid="${i.tid}"]`)?.value);
    } else if(i.sub_type==='Recovery'){
      const ics     = [...(document.querySelector(`.deb-ic-resp[data-tid="${i.tid}"]`)?.selectedOptions||[])].map(o=>o.value).join(',');
      const confirm = document.querySelector(`.deb-confirm[data-tid="${i.tid}"]`)?.value||'';
      const rectype = document.querySelector(`.deb-rectype[data-tid="${i.tid}"]`)?.value||'';
      const remarks = document.querySelector(`.deb-remarks[data-tid="${i.tid}"]`)?.value||'';
      return !!(ics||confirm||rectype||remarks);
    } else {
      // Case Open
      const dispute = document.querySelector(`.deb-dispute[data-tid="${i.tid}"]`)?.value||'';
      const tt      = document.querySelector(`.deb-tt[data-tid="${i.tid}"]`)?.value||'';
      const orphan  = document.querySelector(`.deb-orphan[data-tid="${i.tid}"]`)?.value||'';
      const remarks = document.querySelector(`.deb-remarks[data-tid="${i.tid}"]`)?.value||'';
      return !!(dispute||tt||orphan||remarks);
    }
  });

  if(!filled.length){
    toast('Please fill in at least one response before submitting.','warning');
    return;
  }

  const rows=filled.map(i=>{
    const remarks = document.querySelector(`.deb-remarks[data-tid="${i.tid}"]`)?.value||'';
    if(i.sub_type==='Final Loss'){
      return {tid:i.tid, subType:i.sub_type,
              decision:document.querySelector(`.deb-dec[data-tid="${i.tid}"]`)?.value||'',
              remarks};
    } else if(i.sub_type==='Recovery'){
      const icSel  = document.querySelector(`.deb-ic-resp[data-tid="${i.tid}"]`);
      const ics    = icSel ? [...icSel.selectedOptions].map(o=>o.value).join(', ') : '';
      const confirm= document.querySelector(`.deb-confirm[data-tid="${i.tid}"]`)?.value||'';
      const rectype= document.querySelector(`.deb-rectype[data-tid="${i.tid}"]`)?.value||'';
      return {tid:i.tid, subType:i.sub_type,
              dispute:rectype, tt:confirm, orphan:ics, remarks};
    } else {
      // Case Open
      return {tid:i.tid, subType:i.sub_type,
              decision:'',
              dispute:document.querySelector(`.deb-dispute[data-tid="${i.tid}"]`)?.value||'',
              tt:     document.querySelector(`.deb-tt[data-tid="${i.tid}"]`)?.value||'',
              orphan: document.querySelector(`.deb-orphan[data-tid="${i.tid}"]`)?.value||'',
              remarks};
    }
  });

  try{
    const r=await fetch('/api/submit-deb',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({station:session.station,periodLabel:session.periodLabel,rows,verifiedBy:verifiedBy||null})
    });
    const d=await r.json();
    if(r.ok){
      if(d.allDone){
        stationData.locks.DEB=true;
        updateModuleBadges();
        toast('All debit responses submitted! ✓','success');
        goHome();
      } else {
        toast(`${d.submitted} response${d.submitted===1?'':'s'} submitted. Continue with remaining items.`,'success');
        try{
          const sd=await fetch(`/api/station-data/${session.station}`).then(x=>x.json());
          stationData.debit=sd.debit||[];
        }catch(e2){}
        renderDeb();
      }
    } else {
      toast(d.error||'Submit failed.','error');
    }
  }catch(e){toast('Error: '+e.message,'error');}
}

// ── HISTORY TAB ─────────────────────────────────────────
let _debHistory=null;

async function loadDebHistory(){
  const cont=document.getElementById('deb-history-body');
  if(_debHistory){renderDebHistory(_debHistory,cont);return;}
  cont.innerHTML='<div style="padding:28px;text-align:center;color:var(--text-3)">Loading history…</div>';
  try{
    const r=await fetch(`/api/deb-history/${session.station}`);
    _debHistory=await r.json();
    renderDebHistory(_debHistory,cont);
  }catch(e){cont.innerHTML='<div style="padding:28px;text-align:center;color:var(--red-d)">Failed to load history.</div>';}
}

function renderDebHistory(groups,cont){
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
        <div class="tbl-wrap" style="margin:0;border-radius:0 0 8px 8px;border-top:none">
          <table style="font-size:.78rem">
            <thead><tr>
              <th>TID</th><th>Date</th><th>Bucket / Sub</th><th>Type</th>
              <th>IC Name</th><th style="text-align:right">Amount</th>
              <th>Confirm By</th><th>CM</th>
              <th style="color:var(--blue)">Decision</th>
              <th style="color:var(--blue)">TT #</th>
              <th style="color:var(--blue)">Orphan Ref</th>
              <th style="color:var(--blue)">WH Remarks</th>
              <th>Submitted</th>
            </tr></thead>
            <tbody>
              ${g.items.map(i=>`<tr>
                <td style="font-family:'DM Mono',monospace;font-size:.72rem;font-weight:700">${i.tid}</td>
                <td style="white-space:nowrap">${fmtDate(i.debit_date)}</td>
                <td>${i.bucket||'-'}<br><span style="color:var(--text-3);font-size:.7rem">${i.loss_sub_bucket||''}</span></td>
                <td>${i.shipment_type||'-'}</td>
                <td>${i.ic_name||'-'}</td>
                <td style="text-align:right;font-weight:700;color:var(--red-d)">${fmtAmt(i.amount)}</td>
                <td>${i.confirm_by||'-'}</td>
                <td style="text-align:center">${i.cm_confirm||'-'}</td>
                <td><span style="font-weight:600;color:${i.decision==='Yes'?'var(--red-d)':'var(--green-d)'}">${i.decision||'-'}</span></td>
                <td style="font-family:'DM Mono',monospace;font-size:.72rem">${i.tt_number||'-'}</td>
                <td style="font-family:'DM Mono',monospace;font-size:.72rem">${i.orphan_ref||'-'}</td>
                <td>${i.wh_remarks||i.remarks||'-'}</td>
                <td style="white-space:nowrap;color:var(--text-3)">${fmtDate(i.submitted_at)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>`).join('');
}

function debToggleMonth(gi){
  const body=document.getElementById(`deb-month-${gi}`);
  const chev=document.getElementById(`deb-chevron-${gi}`);
  const open=body.style.display!=='none';
  body.style.display=open?'none':'block';
  chev.textContent=open?'▸':'▾';
}