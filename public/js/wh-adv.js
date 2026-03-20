// ── ADVANCE MODULE ───────────────────────────────────────────

function advTab(t){
  document.getElementById('adv-t-req').classList.toggle('active', t==='request');
  document.getElementById('adv-t-sub').classList.toggle('active', t==='submitted');
  // Update badge counts
  const reqCnt = document.getElementById('adv-cnt-req');
  const subCnt = document.getElementById('adv-cnt-sub');
  if(reqCnt) reqCnt.textContent = advStore.request.length||'';
  if(subCnt) subCnt.textContent = advStore.submitted.length||'';
  // Swap table header
  const head = document.getElementById('adv-head');
  if(head){
    head.innerHTML = t==='request'
      ? '<tr><th>IC Name</th><th>ID</th><th>Amount (₹)</th><th>Reason</th></tr>'
      : '<tr><th>IC Name</th><th>ID</th><th>Amount (₹)</th><th>Reason</th><th>Verified By</th><th>Submitted</th></tr>';
  }
  renderAdv(t);
}

function renderAdv(tab){
  const body = document.getElementById('adv-body');
  const acts = document.getElementById('adv-actions');

  if(tab==='request'){
    const data = advStore.request;
    body.innerHTML = data.length
      ? data.map(ic=>`<tr>
          <td><strong>${ic.icName}</strong></td>
          <td><span style="font-family:'DM Mono',monospace;font-size:.78rem">${ic.icId}</span></td>
          <td><input type="number" class="adv-amt" data-id="${ic.icId}" value="${ic.amount||''}" placeholder="0" min="0"></td>
          <td><input type="text" class="adv-rsn" data-id="${ic.icId}" value="${ic.reason||''}" placeholder="Reason…"></td>
        </tr>`).join('')
      : '<tr class="empty-row"><td colspan="4">All ICs have advances submitted this period</td></tr>';
    acts.innerHTML = data.length
      ? `<button class="btn btn-primary" onclick="advSubmitWithVerification()">📷 Submit Advance Request</button>`
      : '';

  } else {
    const data = advStore.submitted;
    body.innerHTML = data.length
      ? data.map(ic=>`<tr>
          <td><strong>${ic.icName}</strong></td>
          <td><span style="font-family:'DM Mono',monospace;font-size:.78rem">${ic.icId}</span></td>
          <td style="text-align:right;font-weight:600">₹${Number(ic.amount).toLocaleString('en-IN')}</td>
          <td style="max-width:160px">${truncRemark(ic.reason)}</td>
          <td style="font-size:.72rem;color:var(--green-d);font-weight:600">${ic.verifiedBy||'-'}</td>
          <td style="font-size:.72rem;color:var(--text-3);white-space:nowrap">${fmtAdvDate(ic.submittedAt)}</td>
        </tr>`).join('')
      : '<tr class="empty-row"><td colspan="6">No advances submitted this period yet</td></tr>';
    acts.innerHTML = '';
  }
}

function fmtAdvDate(d){
  if(!d) return '-';
  const dt = new Date(d);
  return isNaN(dt) ? d : dt.toLocaleDateString('en-IN',{day:'2-digit',month:'short'}) +
    ' ' + dt.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
}

// ── FACE GATE ────────────────────────────────────────────────
function advSubmitWithVerification(){
  // Capture current amounts/reasons from inputs before opening modal
  document.querySelectorAll('.adv-amt').forEach(el=>{
    const ic=advStore.request.find(i=>String(i.icId)===el.dataset.id);
    if(ic) ic.amount=el.value;
  });
  document.querySelectorAll('.adv-rsn').forEach(el=>{
    const ic=advStore.request.find(i=>String(i.icId)===el.dataset.id);
    if(ic) ic.reason=el.value;
  });

  const eligible = advStore.request.filter(ic=>ic.amount&&parseFloat(ic.amount)>0);
  if(!eligible.length){ toast('Enter an amount for at least one IC.','warning'); return; }

  const ics = stationData.ics||[];
  if(!ics.length){ toast('No ICs loaded — cannot verify.','error'); return; }

  let overlay = document.getElementById('adv-verif-overlay');
  if(!overlay){
    overlay = document.createElement('div');
    overlay.id = 'adv-verif-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9000;display:flex;align-items:center;justify-content:center';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div style="background:var(--card);border-radius:var(--r);padding:1.5rem;max-width:360px;width:90%;box-shadow:var(--shadow-md)">
      <div style="font-size:.7rem;color:var(--text-3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px">BIOMETRIC VERIFICATION</div>
      <div style="font-size:1rem;font-weight:700;color:var(--navy);margin-bottom:4px">Who is submitting?</div>
      <div style="font-size:.8rem;color:var(--text-2);margin-bottom:12px">Advance for ${eligible.length} IC${eligible.length!==1?'s':''}</div>
      <select id="adv-verif-ic-sel" style="width:100%;padding:8px 10px;font-size:.9rem;border:1px solid var(--border);border-radius:8px;margin-bottom:14px">
        <option value="">-- Select IC --</option>
        ${ics.map(ic=>`<option value="${ic.ic_id}" data-name="${ic.ic_name}">${ic.ic_name}</option>`).join('')}
      </select>
      <div style="display:flex;gap:10px">
        <button onclick="document.getElementById('adv-verif-overlay').style.display='none'"
          style="flex:1;padding:9px;border:1px solid var(--border);border-radius:8px;background:none;cursor:pointer;font-size:.88rem">Cancel</button>
        <button onclick="advStartFaceVerif()"
          style="flex:2;padding:9px;background:var(--navy);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:.88rem;font-weight:600">
          📷 Scan Face & Submit
        </button>
      </div>
    </div>`;
  overlay.style.display = 'flex';
}

function advStartFaceVerif(){
  const sel = document.getElementById('adv-verif-ic-sel');
  const icId = sel.value;
  const icName = sel.options[sel.selectedIndex]?.dataset?.name||'';
  if(!icId){ toast('Please select an IC first.','warning'); return; }

  document.getElementById('adv-verif-overlay').style.display = 'none';
  window._faceVerifyCallback = (verifiedName) => { advFinalCommit(verifiedName); };
  openFace(icId, icName, true, false, 'VERIFY_SUBMIT');
  setTimeout(function() {
    const lbl = document.getElementById('face-mode-lbl');
    if (lbl) lbl.textContent = 'ADVANCE VERIFY';
  }, 50);
}

// ── SUBMIT ───────────────────────────────────────────────────
async function advFinalCommit(verifiedBy){
  const rows = advStore.request.filter(ic=>ic.amount&&parseFloat(ic.amount)>0);
  try{
    const r = await fetch('/api/submit-adv',{method:'POST',headers:{'Content-Type':'application/json'},
      body: JSON.stringify({station:session.station, periodLabel:session.periodLabel, rows, verifiedBy:verifiedBy||null})});
    const data = await r.json();
    if(r.ok){
      const now = new Date();
      const skippedSet = new Set(data.skipped||[]);
      const justSubmitted = rows.filter(ic=>!skippedSet.has(ic.icName));

      // Move submitted ICs from request → submitted in memory
      justSubmitted.forEach(ic=>{
        advStore.submitted.unshift({
          icId: ic.icId, icName: ic.icName,
          amount: ic.amount, reason: ic.reason||'',
          verifiedBy: verifiedBy||'', submittedAt: now
        });
      });
      const submittedIds = new Set(justSubmitted.map(ic=>String(ic.icId)));
      advStore.request = advStore.request.filter(ic=>!submittedIds.has(String(ic.icId)));

      if(data.skipped&&data.skipped.length){
        toast(`${data.inserted} submitted. Already had advance this period: ${data.skipped.join(', ')}`, 'warning');
      } else {
        toast(`${data.inserted} advance${data.inserted!==1?'s':''} submitted ✓`, 'success');
      }
      advTab('submitted');
    } else {
      toast(data.error||'Submit failed.','error');
    }
  }catch(e){ toast('Error submitting advances.','error'); }
}

function showAdvSummary(data){
  showModule('sum');
  document.getElementById('sum-title').textContent='✅ ADV Data Submitted';
  const tbl=document.querySelector('#m-sum .tbl-wrap table');
  if(tbl){tbl.removeAttribute('class');tbl.style.cssText='width:100%;border-collapse:collapse;table-layout:auto';}
  const cols=document.getElementById('sum-cols');if(cols)cols.innerHTML='';
  document.getElementById('sum-head').innerHTML='<tr><th>IC Name</th><th>Amount</th><th>Reason</th></tr>';
  document.getElementById('sum-body').innerHTML=(data||[]).map(r=>
    `<tr><td>${r.name||r.icName||''}</td><td style="text-align:center">₹${r.amount||0}</td><td style="max-width:160px">${truncRemark(r.reason)}</td></tr>`
  ).join('')||'<tr class="empty-row"><td colspan="3">No records</td></tr>';
}