async function loadMachines(){
  try{
    const m=await fetch('/api/machines').then(r=>r.json());
    document.getElementById('cnt-machines').textContent=m.length;
    const pending=m.filter(x=>x.status==='AWAITING_CCTV');
    const rest=m.filter(x=>x.status!=='AWAITING_CCTV');
    document.getElementById('pend-m').innerHTML=pending.length
      ?pending.map(x=>`<tr data-search="${x.station_code.toLowerCase()} ${x.temp_cctv_code}">
          <td><strong>${x.station_code}</strong></td><td><span class="mono">${x.machine_id}</span></td>
          <td><span class="code-pill">${x.temp_cctv_code}</span></td>
          <td><div class="acts">
            <button class="btn btn-green btn-sm" onclick="openApprove('${x.temp_cctv_code}','${x.station_code}')">✓ Approve</button>
            <button class="btn btn-red btn-sm" onclick="cancelReq(${x.id},'${x.station_code}')">✕ Cancel</button>
          </div></td></tr>`).join('')
      :'<tr class="empty-row"><td colspan="4">No pending requests</td></tr>';
    document.getElementById('all-m').innerHTML=rest.length
      ?rest.map(x=>{
        const isActive = x.status==='ACTIVE';
        const isRevoked = x.status==='REVOKED';
        const statusPill = isActive
          ? '<span class="pill p-active">Active</span>'
          : isRevoked
          ? '<span class="pill" style="background:var(--red-bg);color:var(--red-d);border:1px solid rgba(239,68,68,.2)">Revoked</span>'
          : '<span class="pill p-inactive">Inactive</span>';
        return `<tr data-search="${x.machine_id.toLowerCase()} ${x.station_code.toLowerCase()} ${(x.approved_by||'').toLowerCase()}">
          <td><span class="mono">${x.machine_id}</span></td>
          <td>${x.station_code}</td>
          <td>${statusPill}</td>
          <td style="font-size:.82rem">${x.approved_by||'-'}</td>
          <td><div class="acts">
            ${isActive?`<button class="btn btn-amber btn-sm" onclick="revokeM(${x.id},'${x.machine_id}','${x.station_code}')">⊘ Revoke</button>`:''}
            ${isActive?`<button class="btn btn-ghost btn-sm" onclick="deactivateM(${x.id},'${x.machine_id}')">Deactivate</button>`:''}
            <button class="btn btn-red btn-sm" onclick="deleteM(${x.id},'${x.machine_id}')">Delete</button>
          </div></td></tr>`;
      }).join('')
      :'<tr class="empty-row"><td colspan="5">No machines</td></tr>';
  }catch(e){toast('Failed.','error');}
}

function openApprove(cc,st){pendingApprove={cctvCode:cc,stationCode:st};document.getElementById('approve-title').textContent=`Approve Station ${st}`;document.getElementById('approve-sub').textContent=`CCTV Code: ${cc} - Enter your name.`;document.getElementById('approve-inp').value='';document.getElementById('approve-modal').classList.remove('hidden');setTimeout(()=>document.getElementById('approve-inp').focus(),100);}

async function confirmApprove(){
  const name=document.getElementById('approve-inp').value.trim();
  if(!name)return toast('Enter your name.','warning');
  closeModal('approve-modal');
  const d=await fetch('/api/approve-machine',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cctvCode:pendingApprove.cctvCode,stationCode:pendingApprove.stationCode,adminName:name})}).then(r=>r.json());
  if(d.success){document.getElementById('sm-mid').textContent=d.machineId;document.getElementById('sm-st').textContent=d.station;document.getElementById('sm-adm').textContent=name;document.getElementById('sm-tok').textContent=d.token;document.getElementById('success-modal').classList.remove('hidden');}
  else toast('Approval failed.','error');
}

async function cancelReq(id,st){confirm2(`Cancel request for ${st}?`,`Machine must resubmit.`,async()=>{await fetch('/api/cancel-machine-request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});toast('Cancelled.','success');loadMachines();});}
async function deactivateM(id,mid){confirm2(`Deactivate ${mid}?`,`Access revoked, record kept.`,async()=>{await fetch('/api/machine-deactivate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});toast('Deactivated.','success');loadMachines();});}
async function deleteM(id,mid){confirm2(`Delete ${mid} permanently?`,`Cannot be undone.`,async()=>{await fetch('/api/machine-delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});toast('Deleted.','success');loadMachines();});}

async function revokeM(id, mid, station) {
  confirm2(
    `Revoke ${mid}?`,
    `The machine at ${station} will be immediately logged out and must re-register with a new CCTV code.`,
    async () => {
      const r = await fetch('/api/revoke-machine', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id, adminName:'Admin'})});
      if (r.ok) { toast(`${mid} revoked - machine will re-register on next visit.`,'success'); loadMachines(); }
      else toast('Failed.','error');
    }
  );
}

function showPhotoById(icId, name, station, time) {
  const photo = (window._enrollPhotos || {})[icId] || '';
  showPhoto(icId, name, station, time, photo);
}// -- MACHINES ----------------------------------------------
async function loadMachines(){
  try{
    const m=await fetch('/api/machines').then(r=>r.json());
    document.getElementById('cnt-machines').textContent=m.length;
    const pending=m.filter(x=>x.status==='AWAITING_CCTV');
    const rest=m.filter(x=>x.status!=='AWAITING_CCTV');
    document.getElementById('pend-m').innerHTML=pending.length
      ?pending.map(x=>`<tr data-search="${x.station_code.toLowerCase()} ${x.temp_cctv_code}">
          <td><strong>${x.station_code}</strong></td><td><span class="mono">${x.machine_id}</span></td>
          <td><span class="code-pill">${x.temp_cctv_code}</span></td>
          <td><div class="acts">
            <button class="btn btn-green btn-sm" onclick="openApprove('${x.temp_cctv_code}','${x.station_code}')">✓ Approve</button>
            <button class="btn btn-red btn-sm" onclick="cancelReq(${x.id},'${x.station_code}')">✕ Cancel</button>
          </div></td></tr>`).join('')
      :'<tr class="empty-row"><td colspan="4">No pending requests</td></tr>';
    document.getElementById('all-m').innerHTML=rest.length
      ?rest.map(x=>{
        const isActive = x.status==='ACTIVE';
        const isRevoked = x.status==='REVOKED';
        const statusPill = isActive
          ? '<span class="pill p-active">Active</span>'
          : isRevoked
          ? '<span class="pill" style="background:var(--red-bg);color:var(--red-d);border:1px solid rgba(239,68,68,.2)">Revoked</span>'
          : '<span class="pill p-inactive">Inactive</span>';
        return `<tr data-search="${x.machine_id.toLowerCase()} ${x.station_code.toLowerCase()} ${(x.approved_by||'').toLowerCase()}">
          <td><span class="mono">${x.machine_id}</span></td>
          <td>${x.station_code}</td>
          <td>${statusPill}</td>
          <td style="font-size:.82rem">${x.approved_by||'-'}</td>
          <td><div class="acts">
            ${isActive?`<button class="btn btn-amber btn-sm" onclick="revokeM(${x.id},'${x.machine_id}','${x.station_code}')">⊘ Revoke</button>`:''}
            ${isActive?`<button class="btn btn-ghost btn-sm" onclick="deactivateM(${x.id},'${x.machine_id}')">Deactivate</button>`:''}
            <button class="btn btn-red btn-sm" onclick="deleteM(${x.id},'${x.machine_id}')">Delete</button>
          </div></td></tr>`;
      }).join('')
      :'<tr class="empty-row"><td colspan="5">No machines</td></tr>';
  }catch(e){toast('Failed.','error');}
}

function openApprove(cc,st){pendingApprove={cctvCode:cc,stationCode:st};document.getElementById('approve-title').textContent=`Approve Station ${st}`;document.getElementById('approve-sub').textContent=`CCTV Code: ${cc} - Enter your name.`;document.getElementById('approve-inp').value='';document.getElementById('approve-modal').classList.remove('hidden');setTimeout(()=>document.getElementById('approve-inp').focus(),100);}

async function confirmApprove(){
  const name=document.getElementById('approve-inp').value.trim();
  if(!name)return toast('Enter your name.','warning');
  closeModal('approve-modal');
  const d=await fetch('/api/approve-machine',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cctvCode:pendingApprove.cctvCode,stationCode:pendingApprove.stationCode,adminName:name})}).then(r=>r.json());
  if(d.success){document.getElementById('sm-mid').textContent=d.machineId;document.getElementById('sm-st').textContent=d.station;document.getElementById('sm-adm').textContent=name;document.getElementById('sm-tok').textContent=d.token;document.getElementById('success-modal').classList.remove('hidden');}
  else toast('Approval failed.','error');
}

async function cancelReq(id,st){confirm2(`Cancel request for ${st}?`,`Machine must resubmit.`,async()=>{await fetch('/api/cancel-machine-request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});toast('Cancelled.','success');loadMachines();});}
async function deactivateM(id,mid){confirm2(`Deactivate ${mid}?`,`Access revoked, record kept.`,async()=>{await fetch('/api/machine-deactivate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});toast('Deactivated.','success');loadMachines();});}
async function deleteM(id,mid){confirm2(`Delete ${mid} permanently?`,`Cannot be undone.`,async()=>{await fetch('/api/machine-delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});toast('Deleted.','success');loadMachines();});}

async function revokeM(id, mid, station) {
  confirm2(
    `Revoke ${mid}?`,
    `The machine at ${station} will be immediately logged out and must re-register with a new CCTV code.`,
    async () => {
      const r = await fetch('/api/revoke-machine', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id, adminName:'Admin'})});
      if (r.ok) { toast(`${mid} revoked - machine will re-register on next visit.`,'success'); loadMachines(); }
      else toast('Failed.','error');
    }
  );
}