// ── ADMIN FINANCE — AMAZON INVOICE MANAGEMENT ────────────────────────────────

var _invData = [];
var _invDrawerOpen = false;

// ── TOGGLE ────────────────────────────────────────────────────────────────────
function _invToggle() {
  var body  = document.getElementById('hist-invoices-body');
  var btn   = document.getElementById('hist-invoices-toggle');
  var strip = document.getElementById('hist-strip-invoices');
  if (!body) return;
  var open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  btn.textContent = open ? '▼' : '▲';
  if (!open) {
    invLoad();
    invPopulateStations();
    setTimeout(function() {
      var target = strip || body;
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }
}

// ── POPULATE STATION FILTER ───────────────────────────────────────────────────
async function invPopulateStations() {
  try {
    var sel = document.getElementById('inv-station');
    if (!sel || sel.options.length > 1) return;
    var rows = await fetch('/api/admin/invoices?limit=1000').then(function(r){ return r.json(); });
    var stations = [...new Set((Array.isArray(rows) ? rows : []).map(function(r){ return r.station; }).filter(Boolean))].sort();
    stations.forEach(function(s) {
      var o = document.createElement('option'); o.value = s; o.textContent = s;
      sel.appendChild(o);
    });
  } catch(e) {}
}

// ── LOAD & RENDER TABLE ───────────────────────────────────────────────────────
async function invLoad() {
  var body = document.getElementById('inv-body');
  if (!body) return;
  body.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--text-3)">Loading…</td></tr>';

  var qp = new URLSearchParams();
  var q       = (document.getElementById('inv-q')       || {}).value || '';
  var station = (document.getElementById('inv-station') || {}).value || '';
  var entity  = (document.getElementById('inv-entity')  || {}).value || '';
  var from    = (document.getElementById('inv-from')    || {}).value || '';
  var to      = (document.getElementById('inv-to')      || {}).value || '';

  if (q)       qp.set('q', q);
  if (station) qp.set('station', station);
  if (entity)  qp.set('entity', entity);
  if (from)    qp.set('from', from + '-01');
  if (to) {
    // last day of month
    var d = new Date(to + '-01'); d.setMonth(d.getMonth()+1); d.setDate(0);
    qp.set('to', d.toISOString().substring(0,10));
  }

  try {
    var data = await fetch('/api/admin/invoices?' + qp).then(function(r){ return r.json(); });
    if (!Array.isArray(data)) { body.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--red-d)">Error loading</td></tr>'; return; }
    _invData = data;
    document.getElementById('inv-count').textContent = data.length + ' invoice' + (data.length!==1?'s':'');
    // FY tabs for invoices
    var allFYsInv = (typeof _getFYList !== 'undefined') ? _getFYList(data.map(function(r){ return r.invoice_date||''; })) : [];
    if (allFYsInv.length) {
      var invFyContainer = document.getElementById('inv-fy-tabs');
      if (!invFyContainer) {
        invFyContainer = document.createElement('div');
        invFyContainer.id = 'inv-fy-tabs';
        var summaryEl = document.getElementById('inv-summary');
        if (summaryEl) summaryEl.parentNode.insertBefore(invFyContainer, summaryEl);
      }
      if (!window._invActiveFY) window._invActiveFY = allFYsInv[0];
      var fyHtmlInv = '';
      if (typeof _renderFYTabs !== 'undefined') {
        fyHtmlInv = '<div style="display:flex;gap:4px;padding:10px 16px;border-bottom:1px solid var(--border);background:var(--bg);flex-wrap:wrap;align-items:center">' +
          '<span style="font-size:.72rem;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-right:4px">FY</span>';
        allFYsInv.forEach(function(fy) {
          var active = fy === window._invActiveFY;
          fyHtmlInv += '<button data-fy="' + fy + '" onclick="window._invActiveFY=this.dataset.fy;invLoad()" ' +
            'style="padding:3px 12px;font-size:.78rem;font-weight:' + (active?'700':'500') + ';border-radius:6px;cursor:pointer;border:1.5px solid ' +
            (active?'var(--navy)':'var(--border)') + ';background:' + (active?'var(--navy)':'var(--card)') + ';color:' +
            (active?'#fff':'var(--text-2)') + '">' + fy + '</button>';
        });
        fyHtmlInv += '</div>';
      }
      invFyContainer.innerHTML = fyHtmlInv;
      // Filter data to active FY
      data = data.filter(function(r){ return (typeof _monthToFY!=='undefined') ? _monthToFY(r.invoice_date||'')===window._invActiveFY : true; });
    }
    invRenderSummary(data);
    if (!data.length) {
      body.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:32px;color:var(--text-3)">No invoices found</td></tr>';
      return;
    }
    var fmtA = function(v) { return '₹' + parseFloat(v||0).toLocaleString('en-IN',{minimumFractionDigits:2}); };
    var fmtD = function(s) { return s ? String(s).substring(0,10) : '-'; };
    body.innerHTML = data.map(function(r) {
      var cbColor = parseFloat(r.total_chargebacks||0) > 0 ? 'color:var(--red-d);font-weight:700' : 'color:var(--text-3)';
      return '<tr style="cursor:pointer" onclick="invOpenDrawer(' + r.id + ')" class="dadmin-row">' +
        '<td style="padding:8px 10px;font-family:monospace;font-size:.72rem;font-weight:700;white-space:nowrap;text-align:left">' + esc(r.invoice_number) + '</td>' +
        '<td style="padding:8px 10px;text-align:center;font-weight:700;font-size:.78rem">' + esc(r.station) + '</td>' +
        '<td style="padding:8px 10px;text-align:center;font-size:.72rem">' +
          '<span style="padding:2px 7px;border-radius:5px;font-size:.7rem;font-weight:600;background:' +
          (r.amazon_entity==='ASSPL'?'var(--blue-bg);color:var(--blue)':'var(--amber-bg);color:var(--amber-d)') + '">' +
          esc(r.amazon_entity||'-') + '</span></td>' +
        '<td style="padding:8px 10px;text-align:center;font-size:.72rem;white-space:nowrap">' + fmtD(r.invoice_date) + '</td>' +
        '<td style="padding:8px 10px;text-align:center;font-size:.72rem;white-space:nowrap;color:var(--text-2)">' +
          fmtD(r.period_from) + ' → ' + fmtD(r.period_to) + '</td>' +
        '<td style="padding:8px 10px;text-align:right;font-weight:700;color:var(--navy);white-space:nowrap">' + fmtA(r.net_amount_due) + '</td>' +
        '<td style="padding:8px 10px;text-align:right;white-space:nowrap;' + cbColor + '">' + fmtA(r.total_chargebacks) + '</td>' +
        '<td style="padding:8px 10px;text-align:right;white-space:nowrap;color:var(--text-2)">' + fmtA(r.total_gst) + '</td>' +
        '<td style="padding:8px 10px;text-align:center;font-size:.7rem;color:var(--text-3)">' + esc(r.pdf_filename||'-') + '</td>' +
        '<td style="padding:8px 10px;text-align:center">' +
          '<button onclick="event.stopPropagation();invDelete(' + r.id + ',\'' + esc(r.invoice_number) + '\')" ' +
          'style="background:none;border:none;cursor:pointer;color:var(--text-3);font-size:.8rem;padding:2px 6px" title="Delete">✕</button>' +
        '</td>' +
      '</tr>';
    }).join('');
  } catch(e) {
    body.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--red-d)">Error: ' + e.message + '</td></tr>';
  }
}

// ── SUMMARY BAR ───────────────────────────────────────────────────────────────
function invRenderSummary(data) {
  var el = document.getElementById('inv-summary');
  if (!el || !data.length) { if(el) el.innerHTML=''; return; }
  var totalNet = data.reduce(function(s,r){ return s + parseFloat(r.net_amount_due||0); }, 0);
  var totalCB  = data.reduce(function(s,r){ return s + parseFloat(r.total_chargebacks||0); }, 0);
  var totalGST = data.reduce(function(s,r){ return s + parseFloat(r.total_gst||0); }, 0);
  var fmtA = function(v) { return '₹' + v.toLocaleString('en-IN',{minimumFractionDigits:2}); };
  el.innerHTML =
    '<div style="display:flex;flex-direction:column"><span style="font-size:.68rem;color:var(--text-3);text-transform:uppercase;letter-spacing:.05em">Total Net</span><strong style="color:var(--navy)">' + fmtA(totalNet) + '</strong></div>' +
    '<div style="width:1px;background:var(--border)"></div>' +
    '<div style="display:flex;flex-direction:column"><span style="font-size:.68rem;color:var(--text-3);text-transform:uppercase;letter-spacing:.05em">Total Chargebacks</span><strong style="color:var(--red-d)">' + fmtA(totalCB) + '</strong></div>' +
    '<div style="width:1px;background:var(--border)"></div>' +
    '<div style="display:flex;flex-direction:column"><span style="font-size:.68rem;color:var(--text-3);text-transform:uppercase;letter-spacing:.05em">Total GST (IGST 18%)</span><strong style="color:var(--text-2)">' + fmtA(totalGST) + '</strong></div>' +
    '<div style="width:1px;background:var(--border)"></div>' +
    '<div style="display:flex;flex-direction:column"><span style="font-size:.68rem;color:var(--text-3);text-transform:uppercase;letter-spacing:.05em">Invoices</span><strong>' + data.length + '</strong></div>';
}

// ── UPLOAD MODAL ──────────────────────────────────────────────────────────────
function invOpenUpload() {
  var modal = document.getElementById('hist-upload-modal');
  var title = document.getElementById('hist-upload-title');
  var cont  = document.getElementById('hist-upload-content');
  if (!modal) return;
  title.textContent = '📄 Upload Amazon Invoice PDFs';
  cont.innerHTML =
    '<div id="inv-drop" style="border:2px dashed var(--blue);border-radius:10px;padding:32px;text-align:center;cursor:pointer;background:var(--blue-bg);transition:all .15s" ' +
    'onclick="document.getElementById(\'inv-file-input\').click()" ' +
    'ondragover="event.preventDefault();this.style.borderColor=\'var(--navy)\'" ' +
    'ondragleave="this.style.borderColor=\'var(--blue)\'" ' +
    'ondrop="event.preventDefault();invHandleFiles(event.dataTransfer.files)">' +
      '<div style="font-size:2rem;margin-bottom:8px">📄</div>' +
      '<div style="font-weight:700;color:var(--navy);margin-bottom:4px">Drop PDF invoices here</div>' +
      '<div style="font-size:.8rem;color:var(--text-3)">or click to browse — multiple files supported</div>' +
    '</div>' +
    '<input type="file" id="inv-file-input" accept=".pdf" multiple style="display:none" onchange="invHandleFiles(this.files)">' +
    '<div id="inv-upload-log" style="margin-top:14px;max-height:300px;overflow-y:auto"></div>';
  modal.style.display = 'flex';
}

async function invHandleFiles(files) {
  if (!files || !files.length) return;
  var log = document.getElementById('inv-upload-log');
  log.innerHTML = '<div style="font-size:.82rem;color:var(--text-2);margin-bottom:8px">Uploading ' + files.length + ' file(s)…</div>';

  var fd = new FormData();
  for (var i = 0; i < files.length; i++) fd.append('pdfs', files[i]);
  fd.append('uploaded_by', 'Admin');

  try {
    var r = await fetch('/api/admin/invoices/upload', { method:'POST', body: fd , credentials:'include'});
    var d = await r.json();
    var html = '';
    (d.results||[]).forEach(function(res) {
      if (res.status === 'saved') {
        html += '<div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:.8rem">' +
          '<span style="color:var(--green-d);font-weight:700">✓</span>' +
          '<div style="flex:1"><strong>' + esc(res.invoice_number) + '</strong> · ' + esc(res.station) + '</div>' +
          '<div style="color:var(--navy);font-weight:600">₹' + parseFloat(res.net_amount_due||0).toLocaleString('en-IN',{minimumFractionDigits:2}) + '</div>' +
          (res.chargebacks > 0 ? '<div style="color:var(--red-d);font-size:.72rem">CB: ₹' + parseFloat(res.chargebacks).toLocaleString('en-IN',{minimumFractionDigits:2}) + '</div>' : '') +
          '</div>';
      } else {
        html += '<div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:.8rem">' +
          '<span style="color:var(--red-d);font-weight:700">✗</span>' +
          '<div style="flex:1;color:var(--red-d)">' + esc(res.file) + ': ' + esc(res.error||'Unknown error') + '</div>' +
          '</div>';
      }
    });
    html += '<div style="margin-top:10px;padding:8px 12px;border-radius:7px;background:var(--bg);font-size:.82rem;font-weight:600">' +
      '✓ Saved: ' + (d.saved||0) + ' &nbsp;|&nbsp; ✗ Errors: ' + (d.errors||0) + '</div>';
    log.innerHTML = html;
    if (d.saved > 0) {
      // refresh table if visible
      var body = document.getElementById('hist-invoices-body');
      if (body && body.style.display !== 'none') invLoad();
    }
  } catch(e) {
    log.innerHTML = '<div style="color:var(--red-d);font-size:.82rem">Upload failed: ' + e.message + '</div>';
  }
}

// ── ROW DETAIL DRAWER ─────────────────────────────────────────────────────────
async function invOpenDrawer(id) {
  var row = _invData.find(function(r){ return r.id === id; });
  if (!row) return;

  var overlay = document.getElementById('_inv-drawer-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = '_inv-drawer-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:8000;background:rgba(0,0,0,.45)';
    overlay.onclick = function(e){ if(e.target===overlay) invCloseDrawer(); };
    document.body.appendChild(overlay);
  }
  var drawer = document.getElementById('_inv-drawer');
  if (!drawer) {
    drawer = document.createElement('div');
    drawer.id = '_inv-drawer';
    drawer.style.cssText = 'position:fixed;top:0;right:0;height:100%;width:560px;max-width:96vw;' +
      'background:var(--card);box-shadow:-8px 0 40px rgba(0,0,0,.18);z-index:8001;' +
      'display:flex;flex-direction:column;overflow:hidden;' +
      'transform:translateX(100%);transition:transform .25s cubic-bezier(.4,0,.2,1)';
    overlay.appendChild(drawer);
  }

  var fmtA = function(v) { return '₹' + parseFloat(v||0).toLocaleString('en-IN',{minimumFractionDigits:2}); };
  var fmtD = function(s) { return s ? String(s).substring(0,10) : '—'; };
  function ro(label, val) {
    if (!val && val !== 0) return '';
    return '<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:7px 0;border-bottom:1px solid var(--border)">' +
      '<span style="font-size:.78rem;color:var(--text-3);flex:0 0 160px">' + label + '</span>' +
      '<span style="font-size:.82rem;font-weight:500;color:var(--navy);text-align:right;flex:1">' + val + '</span></div>';
  }

  // Load line items
  var lineItems = [];
  try {
    lineItems = await fetch('/api/admin/invoices/' + id + '/lineitems').then(function(r){ return r.json(); });
  } catch(e) {}

  var cbHtml = '';
  if (parseFloat(row.chargeback_package_loss||0) > 0)
    cbHtml += ro('Package Loss', '<span style="color:var(--red-d);font-weight:700">- ' + fmtA(row.chargeback_package_loss) + '</span>');
  if (parseFloat(row.chargeback_cod_loss||0) > 0)
    cbHtml += ro('COD Loss', '<span style="color:var(--red-d);font-weight:700">- ' + fmtA(row.chargeback_cod_loss) + '</span>');

  var lineHtml = '';
  if (lineItems.length) {
    lineHtml = '<div style="margin-top:16px">' +
      '<div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-3);margin-bottom:8px">Line Items</div>' +
      '<table style="width:100%;font-size:.78rem;border-collapse:collapse">' +
      '<thead><tr style="border-bottom:2px solid var(--border)">' +
      '<th style="text-align:left;padding:5px 8px;font-size:.7rem;color:var(--text-3);font-weight:600">Description</th>' +
      '<th style="text-align:right;padding:5px 8px;font-size:.7rem;color:var(--text-3);font-weight:600">Base</th>' +
      '<th style="text-align:right;padding:5px 8px;font-size:.7rem;color:var(--text-3);font-weight:600">GST</th>' +
      '<th style="text-align:right;padding:5px 8px;font-size:.7rem;color:var(--text-3);font-weight:600">Net</th>' +
      '</tr></thead><tbody>';
    lineItems.forEach(function(li) {
      lineHtml += '<tr style="border-bottom:1px solid var(--border)">' +
        '<td style="padding:6px 8px;color:var(--text-2)">' + esc(li.description) + '</td>' +
        '<td style="padding:6px 8px;text-align:right;font-family:monospace;font-size:.76rem">' + fmtA(li.base_amount) + '</td>' +
        '<td style="padding:6px 8px;text-align:right;font-family:monospace;font-size:.76rem;color:var(--text-3)">' + fmtA(li.tax_amount) + '</td>' +
        '<td style="padding:6px 8px;text-align:right;font-family:monospace;font-size:.76rem;font-weight:600;color:var(--navy)">' + fmtA(li.net_amount) + '</td>' +
        '</tr>';
    });
    lineHtml += '</tbody></table></div>';
  }

  drawer.innerHTML =
    '<div style="padding:16px 20px 12px;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;gap:10px">' +
      '<div style="flex:1">' +
        '<div style="font-size:.7rem;color:var(--text-3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px">Amazon Invoice</div>' +
        '<div style="font-size:1rem;font-weight:700;color:var(--navy);font-family:monospace">' + esc(row.invoice_number) + '</div>' +
        '<div style="margin-top:5px;display:flex;gap:6px;align-items:center">' +
          '<span style="font-weight:700;font-size:.82rem">' + esc(row.station) + '</span>' +
          '<span style="padding:2px 7px;border-radius:5px;font-size:.7rem;font-weight:600;background:' +
            (row.amazon_entity==='ASSPL'?'var(--blue-bg);color:var(--blue)':'var(--amber-bg);color:var(--amber-d)') +
          '">' + esc(row.amazon_entity||'') + '</span>' +
        '</div>' +
      '</div>' +
      '<button onclick="invCloseDrawer()" style="background:none;border:none;cursor:pointer;font-size:1.4rem;color:var(--text-3);line-height:1;padding:4px">×</button>' +
    '</div>' +
    '<div style="flex:1;overflow-y:auto;padding:16px 20px">' +
      '<div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-3);margin-bottom:8px">Invoice Details</div>' +
      ro('Invoice Date',  fmtD(row.invoice_date)) +
      ro('Service Period', fmtD(row.period_from) + ' → ' + fmtD(row.period_to)) +
      ro('PDF File',      esc(row.pdf_filename||'')) +
      ro('Uploaded',      fmtD(row.uploaded_at)) +
      '<div style="margin:16px 0 8px;border-top:2px solid var(--border)"></div>' +
      '<div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-3);margin-bottom:8px">Financials</div>' +
      ro('Taxable Subtotal', fmtA(row.taxable_subtotal)) +
      ro('Total GST (IGST 18%)', fmtA(row.total_gst)) +
      ro('Total Taxable Txns', fmtA(row.total_taxable)) +
      (parseFloat(row.total_chargebacks||0) > 0 ?
        '<div style="margin:12px 0 6px;border-top:1px solid var(--border)"></div>' +
        '<div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--red-d);margin-bottom:6px">Chargebacks</div>' +
        cbHtml +
        ro('Total Chargebacks', '<span style="color:var(--red-d);font-weight:700">- ' + fmtA(row.total_chargebacks) + '</span>') : '') +
      '<div style="margin:12px 0 8px;border-top:2px solid var(--border)"></div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0">' +
        '<span style="font-size:.85rem;font-weight:700;color:var(--text-2)">Net Amount Due</span>' +
        '<span style="font-size:1.1rem;font-weight:800;color:var(--navy)">' + fmtA(row.net_amount_due) + '</span>' +
      '</div>' +
      lineHtml +
      '<div style="margin-top:20px">' +
        '<div style="font-size:.78rem;font-weight:600;color:var(--text-2);margin-bottom:6px">Notes</div>' +
        '<textarea id="_inv-notes" rows="3" style="width:100%;box-sizing:border-box;padding:8px 10px;font-size:.82rem;border:1.5px solid var(--border);border-radius:8px;resize:vertical;font-family:inherit">' +
          esc(row.notes||'') + '</textarea>' +
      '</div>' +
    '</div>' +
    '<div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end">' +
      '<button onclick="invCloseDrawer()" style="padding:8px 18px;font-size:.84rem;border:1.5px solid var(--border);border-radius:8px;background:none;cursor:pointer;color:var(--text-2)">Close</button>' +
      '<button onclick="invSaveNotes(' + id + ')" style="padding:8px 20px;font-size:.84rem;font-weight:600;border:none;border-radius:8px;background:var(--navy);color:#fff;cursor:pointer">💾 Save Notes</button>' +
    '</div>';

  overlay.style.display = 'block';
  requestAnimationFrame(function(){ drawer.style.transform = 'translateX(0)'; });
}

function invCloseDrawer() {
  var drawer  = document.getElementById('_inv-drawer');
  var overlay = document.getElementById('_inv-drawer-overlay');
  if (drawer)  drawer.style.transform = 'translateX(100%)';
  setTimeout(function(){ if(overlay) overlay.style.display = 'none'; }, 260);
}

async function invSaveNotes(id) {
  var notes = (document.getElementById('_inv-notes')||{}).value || '';
  try {
    await fetch('/api/admin/invoices/' + id + '/notes', {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ notes })
    });
    // Update local cache
    var row = _invData.find(function(r){ return r.id === id; });
    if (row) row.notes = notes;
    toast('Notes saved', 'success');
  } catch(e) { toast('Save failed: ' + e.message, 'error'); }
}

async function invDelete(id, invNum) {
  if (!confirm('Delete invoice ' + invNum + '? This cannot be undone.')) return;
  try {
    await fetch('/api/admin/invoices/' + id, { method:'DELETE' });
    invLoad();
    toast('Invoice deleted', 'success');
  } catch(e) { toast('Delete failed: ' + e.message, 'error'); }
}

// ── ESC closes drawer ─────────────────────────────────────────────────────────
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') invCloseDrawer();
});

function esc(v) { return (v||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }