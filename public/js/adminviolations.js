// -- VIOLATIONS --------------------------------------------
async function loadViol(){
  const month=document.getElementById('viol-month').value, station=document.getElementById('viol-station').value, resolved=document.getElementById('viol-resolved').value;
  let url='/api/violations?'; if(month)url+=`month=${month}&`; if(station)url+=`station=${station}&`; if(resolved!=='')url+=`resolved=${resolved}`;
  try{
    const viols=await fetch(url).then(r=>r.json());
    document.getElementById('cnt-viol').textContent=viols.filter(v=>!v.resolved).length;
    const body=document.getElementById('viol-body');
    if(!viols.length){body.innerHTML='<tr class="empty-row"><td colspan="8">No violations</td></tr>';return;}
    body.innerHTML=viols.map(v=>`<tr data-search="${(v.ic_name||'').toLowerCase()} ${v.ic_id} ${v.station_code.toLowerCase()}">
      <td style="font-size:.8rem">${v.violation_date}</td><td><strong>${v.ic_name||'-'}</strong></td><td><span class="mono">${v.ic_id}</span></td>
      <td>${v.station_code}</td>
      <td style="font-size:.78rem;color:var(--text-2)">${v.clock_in?new Date(v.clock_in).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):'-'}</td>
      <td>${v.resolved?'<span class="pill p-resolved">Resolved</span>':'<span class="pill p-violation">Open</span>'}</td>
      <td style="font-size:.8rem;color:var(--text-2)">${v.resolved_by||'-'}</td>
      <td>${!v.resolved?`<button class="btn btn-green btn-sm" onclick="openResolve(${v.id},'${(v.ic_name||'').replace(/'/g,"\\'")}')">Resolve</button>`:'<span style="color:var(--text-3);font-size:.78rem">Done</span>'}</td>
    </tr>`).join('');
  }catch(e){toast('Failed.','error');}
}

function openResolve(id,name){resolveViolId=id;document.getElementById('resolve-sub').textContent=`Resolving violation for ${name}.`;document.getElementById('resolve-inp').value='';document.getElementById('resolve-modal').classList.remove('hidden');setTimeout(()=>document.getElementById('resolve-inp').focus(),100);}
async function confirmResolve(){const by=document.getElementById('resolve-inp').value.trim();if(!by)return toast('Enter your name.','warning');closeModal('resolve-modal');const r=await fetch('/api/violations/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:resolveViolId,resolvedBy:by})});if(r.ok){toast('Resolved.','success');loadViol();loadUsers();}else toast('Failed.','error');}// -- KMS REPORT --------------------------------------------