// ── HELPERS ───────────────────────────────────────────────
function filterTbl(tbodyId,inputId){
  const term=document.getElementById(inputId).value.toLowerCase();
  document.querySelectorAll(`#${tbodyId} tr[data-search]`).forEach(r=>r.style.display=r.dataset.search.includes(term)?'':'none');
}
function closeModal(id){document.getElementById(id).classList.add('hidden');}
function confirm2(title,sub,cb){
  document.getElementById('conf-title').textContent=title; document.getElementById('conf-sub').textContent=sub;
  document.getElementById('confirm-modal').classList.remove('hidden');
  document.getElementById('conf-ok').onclick=async()=>{closeModal('confirm-modal');await cb();};
}
['approve-modal','success-modal','confirm-modal','resolve-modal','photo-modal','offboard-modal'].forEach(id=>{
  document.getElementById(id).addEventListener('click',function(e){if(e.target===this)closeModal(id);});
});
// defaults
// Use local date to avoid UTC/IST mismatch
function _localDateStr() { var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
document.getElementById('ov-date').value = _localDateStr();
document.getElementById('viol-month').value=_localDateStr().substring(0,7);
// init overview
// Wait for auth guard to complete before loading overview data
(function() {
  var tries = 0;
  var initCheck = setInterval(function() {
    tries++;
    if (window._adminUser || tries > 30) {
      clearInterval(initCheck);
      setOvView('att');
      // Populate station filters now that we know the user
      if (typeof populateFilters === 'function') populateFilters();
    }
  }, 100);
})();