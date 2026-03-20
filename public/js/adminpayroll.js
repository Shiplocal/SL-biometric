// ── Payroll Tab — restricted access ─────────────────────────────────────────

// ── Universal header-name-based column mapper ─────────────────────────────────
// Converts a header row into a lookup function so parsers find columns by name
// regardless of column position. Case-insensitive, punctuation-stripped matching.
// Usage:
//   const col = makeColMap(raw[0], { bank_transfer: ['Bank transfer RS','Bank Transfer','BANK_TRANSFER'] });
//   const bankIdx = col('bank_transfer');  // → column index or null
//   const val = bankIdx !== null ? num(row[bankIdx]) : 0;
function makeColMap(headerRow, aliases) {
  var norm = function(s) { return String(s||'').toLowerCase().replace(/[^a-z0-9]/g,''); };
  var hdrMap = {};
  (headerRow||[]).forEach(function(h, i) { if (h != null) hdrMap[norm(h)] = i; });
  var colMap = {};
  Object.keys(aliases).forEach(function(canonical) {
    var variants = Array.isArray(aliases[canonical]) ? aliases[canonical] : [aliases[canonical]];
    for (var v = 0; v < variants.length; v++) {
      var n = norm(variants[v]);
      if (hdrMap[n] !== undefined) { colMap[canonical] = hdrMap[n]; break; }
    }
  });
  return function(key) { return colMap[key] !== undefined ? colMap[key] : null; };
}


let _payrollClickCount = 0;
let _payrollClickTimer = null;
let _payrollUnlocked = true; // Now controlled by admin auth session — no separate password needed
let _payrollStaffData = [];

// Legacy unlock click — no-op now (tab visibility handled by auth permissions)
function _payrollUnlockClick() {}

// ── Sub-tab switcher ─────────────────────────────────────
function paySubTab(t) {
  ['edsp','dsp','history'].forEach(s => {
    const panel = document.getElementById('pay-panel-' + s);
    const btn   = document.getElementById('pay-sub-' + s);
    if (panel) panel.style.display = s === t ? 'block' : 'none';
    if (btn)   btn.classList.toggle('active', s === t);
  });
  if (t === 'edsp') { _loadStationSelectors().then(function(){ loadPayrollStaff('EDSP'); }); }
  if (t === 'dsp')  { _loadStationSelectors(); _renderStationSelector('dsp'); }
  if (t === 'history') _histInit();
}

// ── Load payroll tab ─────────────────────────────────────
function loadPayrollTab() {
  _payrollLoadMonthFilter();
  _loadStationSelectors();
  paySubTab('edsp');
}

async function _payrollLoadMonthFilter() {
  const sel = document.getElementById('pay-month-filter');
  if (!sel || sel.dataset.loaded) return;
  sel.dataset.loaded = '1'; // set immediately to prevent double-load
  try {
    const months = await fetch('/api/admin/payroll-history-months', {credentials:'include'}).then(r=>r.json());
    // Sort chronologically: parse mon-yyyy into a sortable date
    const mnames = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    months.sort(function(a, b) {
      var pa = a.payroll_month.split('-'), pb = b.payroll_month.split('-');
      var ya = parseInt(pa[1])||0, yb = parseInt(pb[1])||0;
      var ma = mnames.indexOf(pa[0]), mb = mnames.indexOf(pb[0]);
      return (yb - ya) || (mb - ma); // newest first
    });
    // Clear existing options except first placeholder
    while (sel.options.length > 1) sel.remove(1);
    months.forEach(function(m) {
      var opt = document.createElement('option');
      opt.value = m.payroll_month;
      opt.textContent = m.payroll_month;
      sel.appendChild(opt);
    });
  } catch(e) {}
}

// ── Station selectors ────────────────────────────────────────────────────────
var _allStations = [];
var _edspSelected = [];
var _dspSelected  = [];
var _stationsLoaded = false;

async function _loadStationSelectors() {
  if (_stationsLoaded) return Promise.resolve();
  try {
    _allStations = await fetch('/api/admin/stations-by-type', {credentials:'include'}).then(function(r){return r.json();});
    // Default selections by type
    var defaultEdsp = _allStations.filter(function(s){return s.station_type==='EDSP';}).map(function(s){return s.station_code;});
    var defaultDsp  = _allStations.filter(function(s){return s.station_type==='DSP';}).map(function(s){return s.station_code;});
    // Restore from localStorage if saved, else use defaults
    try {
      var savedEdsp = localStorage.getItem('payroll_edsp_stations');
      var savedDsp  = localStorage.getItem('payroll_dsp_stations');
      _edspSelected = savedEdsp ? JSON.parse(savedEdsp) : defaultEdsp;
      _dspSelected  = savedDsp  ? JSON.parse(savedDsp)  : defaultDsp;
      // Validate — remove any saved codes that no longer exist in DB
      var allCodes = _allStations.map(function(s){return s.station_code;});
      _edspSelected = _edspSelected.filter(function(c){return allCodes.indexOf(c)>=0;});
      _dspSelected  = _dspSelected.filter(function(c){return allCodes.indexOf(c)>=0;});
    } catch(e) {
      _edspSelected = defaultEdsp;
      _dspSelected  = defaultDsp;
    }
    _stationsLoaded = true;
    _renderStationSelector('edsp');
    _renderStationSelector('dsp');
  } catch(e) { console.error('station load error', e); }
}

function _saveStationSelection(type) {
  try {
    if (type === 'edsp') localStorage.setItem('payroll_edsp_stations', JSON.stringify(_edspSelected));
    else                 localStorage.setItem('payroll_dsp_stations',  JSON.stringify(_dspSelected));
  } catch(e) {}
}

function _renderStationSelector(type) {
  var el = document.getElementById(type + '-station-selector');
  if (!el) return;
  var stations = _allStations.filter(function(s){ return s.station_type === (type === 'edsp' ? 'EDSP' : 'DSP'); });
  var selected = type === 'edsp' ? _edspSelected : _dspSelected;
  var html = stations.map(function(s) {
    var on = selected.indexOf(s.station_code) >= 0;
    var bg = on ? 'var(--navy)' : 'var(--card)';
    var fg = on ? '#fff' : 'var(--text-2)';
    return '<span data-type="' + type + '" data-code="' + s.station_code + '" onclick="_toggleStationClick(this.dataset.type,this.dataset.code)" ' +
      'style="padding:3px 8px;border-radius:6px;border:1px solid var(--border);cursor:pointer;font-size:.73rem;font-weight:600;background:' + bg + ';color:' + fg + '">' +
      s.station_code + '</span>';
  }).join('');
  html += ' <button class="btn btn-ghost btn-sm" data-type="' + type + '" data-all="1" style="font-size:.7rem" onclick="_selectAllStations(this.dataset.type,true)">All</button>';
  html += ' <button class="btn btn-ghost btn-sm" data-type="' + type + '" data-all="0" style="font-size:.7rem" onclick="_selectAllStations(this.dataset.type,false)">None</button>';
  el.innerHTML = html;
}

function _toggleStationClick(type, code) {
  var arr = type === 'edsp' ? _edspSelected : _dspSelected;
  var idx = arr.indexOf(code);
  if (idx >= 0) arr.splice(idx, 1); else arr.push(code);
  _renderStationSelector(type);
}

function _applyEdspStations() {
  _saveStationSelection('edsp');
  _toggleEdspSettings();
  loadPayrollStaff('EDSP');
}

function _toggleEdspSettings() {
  var panel = document.getElementById('edsp-settings-panel');
  if (!panel) return;
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

function _selectAllStations(type, all) {
  if (type === 'edsp') {
    _edspSelected = all ? _allStations.filter(function(s){return s.station_type==='EDSP';}).map(function(s){return s.station_code;}) : [];
  } else {
    _dspSelected = all ? _allStations.filter(function(s){return s.station_type==='DSP';}).map(function(s){return s.station_code;}) : [];
  }
  _renderStationSelector(type);
}

// ── Load staff payroll data ───────────────────────────────
async function loadPayrollStaff(stationType) {
  const COLS = 39;
  const body  = document.getElementById('pay-staff-body');
  const count = document.getElementById('pay-staff-count');
  if (!body) return;
  body.innerHTML = `<tr><td colspan="${COLS}" style="text-align:center;padding:20px;color:var(--text-3)">Loading…</td></tr>`;

  stationType = stationType || 'EDSP';
  window._currentPayrollStationType = stationType; // store for export
  await _loadStationSelectors();
  const selectedStations = stationType === 'DSP' ? _dspSelected.slice() : _edspSelected.slice();
  const userType = (document.getElementById('pay-type-filter') ? document.getElementById('pay-type-filter').value : '') || '';
  const month    = (document.getElementById('pay-month-filter') ? document.getElementById('pay-month-filter').value : '') || '';
  const qp = new URLSearchParams();
  qp.set('station_type', stationType);
  if (userType) qp.set('user_type', userType);
  if (month)    qp.set('month', month);

  try {
    const allData = await fetch('/api/admin/payroll-staff?' + qp).then(r=>r.json(), {credentials:'include'});
    _payrollStaffData = allData.filter(function(r) { return selectedStations.includes(r.station_code); });
    if (count) count.textContent = _payrollStaffData.length;
    if (!_payrollStaffData.length) {
      body.innerHTML = `<tr><td colspan="${COLS}" style="text-align:center;padding:20px;color:var(--text-3)">No staff found</td></tr>`;
      return;
    }
    const fmt  = (n) => n == null || n === '' ? '—' : Number(n).toLocaleString('en-IN', {maximumFractionDigits:2});
    const fmtR = (n) => n == null || n === '' ? '—' : '₹' + Number(n).toLocaleString('en-IN', {maximumFractionDigits:0});
    const src  = (r) => {
      if (!month) return '';
      const e = r._has_edsp ? '📊' : '';
      const p = r._has_payroll ? '💰' : '';
      return `<span title="EDSP:${r._has_edsp} Payroll:${r._has_payroll}" style="font-size:.65rem;color:var(--text-3)">${e}${p}</span>`;
    };
    const att='background:#f0f9ff'; const par='background:#f0fdf4'; const pay='background:#fefce8'; const ded='background:#fef2f2';
    body.innerHTML = _payrollStaffData.map(r => `
      <tr style="font-size:.72rem">
        <td style="white-space:nowrap;padding:4px 8px">${escH(r.store_name)}</td>
        <td style="font-family:monospace;padding:4px 8px">${escH(r.station_code)}</td>
        <td style="font-family:monospace;padding:4px 8px">${r.id}</td>
        <td style="white-space:nowrap;font-size:.68rem;color:var(--text-3);padding:4px 8px">${escH(r.head)||'—'}</td>
        <td style="white-space:nowrap;font-weight:500;padding:4px 8px">${escH(r.full_name)} ${src(r)}</td>
        <td style="font-size:.68rem;color:var(--text-3);padding:4px 8px">${escH(r.associate_id)||'—'}</td>
        <td style="text-align:right;padding:4px 8px;${att}">${fmt(r.present_days)}</td>
        <td style="text-align:right;padding:4px 8px;${att}">${fmt(r.week_off)}</td>
        <td style="text-align:right;padding:4px 8px;${att}">${fmt(r.total_days)}</td>
        <td style="text-align:right;padding:4px 8px;${par}">${fmt(r.delivery)}</td>
        <td style="text-align:right;padding:4px 8px;${par}">${fmt(r.pickup)}</td>
        <td style="text-align:right;padding:4px 8px;${par}">${fmt(r.swa)}</td>
        <td style="text-align:right;padding:4px 8px;${par}">${fmt(r.smd)}</td>
        <td style="text-align:right;padding:4px 8px;${par}">${fmt(r.mfn)}</td>
        <td style="text-align:right;padding:4px 8px;${par}">${fmt(r.seller_returns)}</td>
        <td style="text-align:right;font-weight:600;padding:4px 8px;${par}">${fmt(r.total_parcels)}</td>
        <td style="text-align:right;padding:4px 8px;${pay}">${fmtR(r.payment)}</td>
        <td style="text-align:right;padding:4px 8px;${pay}">${fmtR(r.incentive)}</td>
        <td style="text-align:right;font-weight:600;padding:4px 8px;${pay}">${fmtR(r.gross_payment)}</td>
        <td style="text-align:right;color:var(--red-d);padding:4px 8px;${ded}">${r.debit_note ? fmtR(r.debit_note) : '—'}</td>
        <td style="text-align:right;font-weight:700;color:var(--green-d);padding:4px 8px;${pay}">${fmtR(r.net_pay)}</td>
        <td style="text-align:right;color:var(--text-3);padding:4px 8px;${ded}">${r.advance ? fmtR(r.advance) : '—'}</td>
        <td style="text-align:right;padding:4px 8px;${ded}">${fmtR(r.tds)}</td>
        <td style="text-align:right;font-weight:700;padding:4px 8px;${par}">${fmtR(r.bank_transfer)}</td>
        <td style="text-align:right;padding:4px 8px">${fmtR(r.ctc)}</td>
        <td style="font-size:.68rem;padding:4px 8px">${escH(r.pay_type)||'—'}</td>
        <td style="text-align:right;padding:4px 8px">${r.petrol ? fmtR(r.petrol) : '—'}</td>
        <td style="text-align:right;padding:4px 8px">${fmt(r.parcel_count)}</td>
        <td style="text-align:right;padding:4px 8px">${fmt(r.per_parcel_cost)}</td>
        <td style="text-align:right;padding:4px 8px">${fmt(r.average)}</td>
        <td style="text-align:right;padding:4px 8px;color:${r.diff<0?'var(--red-d)':'var(--green-d)'}">${fmt(r.diff)}</td>
        <td style="font-family:monospace;font-size:.68rem;padding:4px 8px">${escH(r.pan_card)||'—'}</td>
        <td style="font-size:.68rem;padding:4px 8px">${escH(r.user_type)}</td>
        <td style="font-size:.68rem;white-space:nowrap;padding:4px 8px">${escH(r.cluster_manager)||'—'}</td>
        <td style="font-size:.65rem;color:var(--text-3);padding:4px 8px">${escH(r.pnl_use)||'—'}</td>
        <td style="padding:4px 8px;max-width:180px">${truncRemark(r.remarks)}</td>
        <td style="font-size:.65rem;padding:4px 8px">${escH(r.state)||'—'}</td>
        <td style="font-size:.65rem;padding:4px 8px">${escH(r.tally_ledger)||'—'}</td>
        <td style="font-size:.65rem;padding:4px 8px">${escH(r.cost_centre)||'—'}</td>
      </tr>`).join('');
  } catch(e) {
    body.innerHTML = `<tr><td colspan="${COLS}" style="text-align:center;color:var(--red-d);padding:20px">Error: ${e.message}</td></tr>`;
  }
}

// ── Export to Excel ───────────────────────────────────────
function exportPayrollExcel() {
  if (!_payrollStaffData.length) { toast('No data to export.', 'warning'); return; }

  const headers = [
    'Store Name','Station Code','ID','Head','Name','Associate ID',
    'Present day','Week off','Total',
    'Delivery','Pick-up ','SWA','SMD','MFN','Seller Returns','Total',
    'Payment','Incentive ','Gross Payment','Debit Note','Net Pay',
    'Advanced','TDS','Bank transfer RS',
    'CTC','Type','Petrol','Parcel','Per Parcel Cost','Average','Diff.',
    'Pan Card','User type','CM',
    'For PNL USE','Remarks','State','Tally Ledger Name','Cost Centre'
  ];

  const rows = _payrollStaffData.map(r => [
    r.store_name, r.station_code, r.id, r.head, r.full_name, r.associate_id,
    r.present_days, r.week_off, r.total_days,
    r.delivery, r.pickup, r.swa, r.smd, r.mfn, r.seller_returns, r.total_parcels,
    r.payment, r.incentive, r.gross_payment, r.debit_note, r.net_pay,
    r.advance, r.tds, r.bank_transfer,
    r.ctc, r.pay_type, r.petrol, r.parcel_count, r.per_parcel_cost, r.average, r.diff,
    r.pan_card, r.user_type, r.cluster_manager,
    r.pnl_use, r.remarks, r.state, r.tally_ledger, r.cost_centre
  ]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

  // Force account-like columns as text
  const textCols = [2, 5]; // ID, Associate ID
  rows.forEach((row, ri) => {
    textCols.forEach(ci => {
      const ref = XLSX.utils.encode_cell({r: ri+1, c: ci});
      if (ws[ref]) ws[ref].t = 's';
    });
    // Bank transfer as text to preserve
    const bankRef = XLSX.utils.encode_cell({r: ri+1, c: 23});
    if (ws[bankRef]) { ws[bankRef].t = 's'; ws[bankRef].z = '@'; }
  });

  ws['!cols'] = [
    {wch:18},{wch:8},{wch:6},{wch:8},{wch:24},{wch:30},
    {wch:8},{wch:8},{wch:6},
    {wch:8},{wch:8},{wch:6},{wch:6},{wch:6},{wch:10},{wch:10},
    {wch:10},{wch:10},{wch:12},{wch:10},{wch:10},
    {wch:10},{wch:8},{wch:14},
    {wch:8},{wch:10},{wch:8},{wch:8},{wch:12},{wch:10},{wch:8},
    {wch:14},{wch:18},{wch:20},
    {wch:10},{wch:20},{wch:10},{wch:22},{wch:12}
  ];

  const month   = (document.getElementById('pay-month-filter') ? document.getElementById('pay-month-filter').value : '') || 'export';
  const station = window._currentPayrollStationType || 'EDSP';
  XLSX.utils.book_append_sheet(wb, ws, 'Payroll');
  XLSX.writeFile(wb, `Payroll_${month}_${station}.xlsx`);
  toast(`Exported ${_payrollStaffData.length} records ✓`, 'success');
}

// ── Past Data strip architecture ─────────────────────────────────────────────

function _histInit() { /* legacy compat no-op */ }

var _histOpenKey = null;
var _PAGE_SIZE = 12;
var _histState = {};

var _HIST_KEYS = ['kms','payroll','dsp-payroll','petrol','rent','addl','bank'];

function _histToggleStrip(key) {
  var isOpen = _histOpenKey === key;
  // Close all
  _HIST_KEYS.forEach(function(k) {
    var body  = document.getElementById('hist-' + k + '-body');
    var chev  = document.getElementById('hist-' + k + '-toggle');
    var strip = document.getElementById('hist-strip-' + k);
    if (body)  body.style.display = 'none';
    if (chev)  chev.textContent = '▼';
    if (strip) strip.classList.remove('open');
  });
  if (isOpen) { _histOpenKey = null; return; }
  // Open this one
  var body  = document.getElementById('hist-' + key + '-body');
  var chev  = document.getElementById('hist-' + key + '-toggle');
  var strip = document.getElementById('hist-strip-' + key);
  if (body)  body.style.display = 'block';
  if (chev)  chev.textContent = '▲';
  if (strip) strip.classList.add('open');
  _histOpenKey = key;
  _histLoadList(key);
  setTimeout(function() {
    var target = strip || body;
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 80);
}

function _histLoadList(key) {
  if (key === 'kms')         _edspLoadPeriods();
  if (key === 'petrol')      _petrolLoadList();
  if (key === 'payroll')     _phLoadMonths();
  if (key === 'dsp-payroll') _dspPhLoadMonths();
  if (key === 'rent')        _rentLoadListDirect();
  if (key === 'addl')        _addlLoadListDirect();
  if (key === 'bank')        _bankLoadList();
}

function _fmtAmt(n) {
  var v = parseFloat(n) || 0;
  if (v >= 1e7) return '₹' + (v/1e7).toFixed(1) + 'Cr';
  if (v >= 1e5) return '₹' + (v/1e5).toFixed(1) + 'L';
  return '₹' + v.toLocaleString('en-IN',{maximumFractionDigits:0});
}

function _monthBadge(m) {
  if (!m) return '—';
  var months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  var base = m.replace(/-[ab12]$/,'');
  var parts = base.split('-');
  var mi = months.indexOf(parts[0]), yr = parseInt(parts[1])||0;
  var now = new Date(), diff = (now.getFullYear()-yr)*12 + (now.getMonth()-mi);
  var color = diff===0?'#15803d':diff<=3?'var(--navy)':'var(--text-2)';
  var bg    = diff===0?'#dcfce7':diff<=3?'#dbeafe':'var(--bg)';
  return '<span style="font-weight:700;color:'+color+';background:'+bg+';padding:2px 8px;border-radius:6px;font-size:.78rem">'+escH(m)+'</span>';
}


// ── FINANCIAL YEAR UTILITIES ──────────────────────────────────────────────────

// Parse any month string → {month:0-11, year:YYYY}
function _parseMonthStr(m) {
  if (!m) return null;
  var months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  var s = String(m).toLowerCase().replace(/-[ab12]$/,'');

  // "jan-2026" format
  var p1 = s.match(/^([a-z]{3})-(\d{4})$/);
  if (p1) { var mi = months.indexOf(p1[1]); if (mi>=0) return {month:mi, year:parseInt(p1[2])}; }

  // "sep'25" format (kms period labels)
  var p2 = s.match(/^([a-z]{3})'(\d{2})$/);
  if (p2) { var mi2 = months.indexOf(p2[1]); if (mi2>=0) return {month:mi2, year:2000+parseInt(p2[2])}; }

  // "YYYY-MM" format
  var p3 = s.match(/^(\d{4})-(\d{2})$/);
  if (p3) return {month:parseInt(p3[2])-1, year:parseInt(p3[1])};

  // "YYYY-MM-DD" format
  var p4 = s.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (p4) return {month:parseInt(p4[2])-1, year:parseInt(p4[1])};

  // "DD-MM-YYYY" format
  var p5 = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (p5) return {month:parseInt(p5[2])-1, year:parseInt(p5[3])};

  return null;
}

// Get FY label for a month string e.g. "jan-2026" → "FY25-26"
function _monthToFY(m) {
  var p = _parseMonthStr(m);
  if (!p) return 'Unknown';
  // FY starts April (month 3). Jan-Mar belong to previous FY.
  var fyStart = p.month >= 3 ? p.year : p.year - 1;
  var s = String(fyStart).slice(2);
  var e = String(fyStart + 1).slice(2);
  return 'FY' + s + '-' + e;
}

// Get sorted list of unique FYs from an array of month strings
function _getFYList(monthStrings) {
  var fys = {};
  monthStrings.forEach(function(m) { if(m) fys[_monthToFY(m)] = true; });
  return Object.keys(fys).sort().reverse(); // Most recent first
}

// Current active FY per strip
var _histFY = {};

// Render FY tabs above a strip's content
function _renderFYTabs(key, allFYs, activeFY, onSwitch) {
  if (!allFYs.length) return '';
  var html = '<div style="display:flex;gap:4px;padding:10px 16px;border-bottom:1px solid var(--border);background:var(--bg);flex-wrap:wrap;align-items:center">' +
    '<span style="font-size:.72rem;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-right:4px">FY</span>';
  allFYs.forEach(function(fy) {
    var active = fy === activeFY;
    html += '<button data-key="' + escH(key) + '" data-fy="' + escH(fy) + '" onclick="_switchFY(this.dataset.key, this.dataset.fy)" ' +
      'style="padding:3px 12px;font-size:.78rem;font-weight:' + (active?'700':'500') + ';border-radius:6px;cursor:pointer;border:1.5px solid ' +
      (active?'var(--navy)':'var(--border)') + ';background:' + (active?'var(--navy)':'var(--card)') + ';color:' +
      (active?'#fff':'var(--text-2)') + '">' + escH(fy) + '</button>';
  });
  html += '</div>';
  return html;
}

function _switchFY(key, fy) {
  _histFY[key] = fy;
  if (_histState[key]) _histState[key].page = 1;
  _histLoadList(key);
}

// Filter rows to only those matching the active FY
// rowDateGetter(row) should return the month string for that row
function _filterRowsByFY(rows, allData, key, monthGetter) {
  var allFYs = _getFYList(allData.map(monthGetter));
  if (!allFYs.length) return { rows: rows, fyHtml: '' };

  // Default to most recent FY
  if (!_histFY[key]) _histFY[key] = allFYs[0];
  var activeFY = _histFY[key];

  // Filter
  var filtered = rows.filter(function(row, i) {
    var m = monthGetter(allData[i] || {});
    return _monthToFY(m) === activeFY;
  });

  return {
    rows: filtered,
    fyHtml: _renderFYTabs(key, allFYs, activeFY, _switchFY),
    allFYs: allFYs
  };
}

function _histRenderList(key, listEl, rows, colDefs, statsHtml, highlightVal, fyHtml) {
  if (!listEl) return;
  if (!_histState[key]) _histState[key] = {page:1,sortCol:-1,sortDir:-1};
  var state = _histState[key];
  var sorted = rows.slice();
  if (state.sortCol >= 0) {
    sorted.sort(function(a,b) {
      var av=a[state.sortCol], bv=b[state.sortCol];
      if (av==null) return 1; if (bv==null) return -1;
      var an=parseFloat(String(av).replace(/[^\d.]/g,'')), bn=parseFloat(String(bv).replace(/[^\d.]/g,''));
      if (!isNaN(an)&&!isNaN(bn)) return state.sortDir*(an-bn);
      return state.sortDir*String(av).localeCompare(String(bv));
    });
  }
  var total = sorted.length;
  var pages = Math.max(1, Math.ceil(total/_PAGE_SIZE));
  state.pages = pages;
  if (state.page > pages) state.page = pages;
  var start = (state.page-1)*_PAGE_SIZE;
  var pageRows = sorted.slice(start, start+_PAGE_SIZE);
  var html = '';
  if (fyHtml) html += fyHtml;
  if (statsHtml) html += '<div class="hist-strip-stats">'+statsHtml+'</div>';
  html += '<div style="overflow:auto;max-height:440px"><table class="hist-list-table"><thead><tr>';
  colDefs.forEach(function(col,i) {
    var cls = state.sortCol===i?(state.sortDir>0?'sort-asc':'sort-desc'):'';
    var thAlign = col.right ? ' style="text-align:right"' : ' style="text-align:left"';
    html += '<th class="'+cls+'"'+thAlign+' data-key="'+key+'" data-col="'+i+'" onclick="_histSortList(this.dataset.key,parseInt(this.dataset.col))">'+escH(col.label)+'</th>';
  });
  html += '</tr></thead><tbody>';
  if (!pageRows.length) {
    html += '<tr><td colspan="'+colDefs.length+'" class="hist-empty">No data yet — click ↑ Upload to add</td></tr>';
  } else {
    pageRows.forEach(function(row) {
      var hi = highlightVal && row.some(function(v){return v&&String(v)===highlightVal;});
      html += '<tr'+(hi?' class="highlight"':'')+'>'; 
      row.forEach(function(v,i) {
        var align = colDefs[i]&&colDefs[i].right?'text-align:right':'text-align:left';
        var isHtmlVal = colDefs[i] && colDefs[i].html;
        html += '<td style="'+align+'">'+(v==null?'—':(isHtmlVal?String(v):escH(String(v))))+'</td>';
      });
      html += '</tr>';
    });
  }
  html += '</tbody></table></div>';
  if (pages > 1) {
    html += '<div class="hist-pagination" data-key="'+key+'">';
    html += '<span>'+(start+1)+'-'+Math.min(start+_PAGE_SIZE,total)+' of '+total+'</span>';
    html += '<div style="margin-left:auto;display:flex;gap:4px">';
    html += '<button class="hist-page-btn" data-key="'+key+'" data-page="1" onclick="_histGoPage(this.dataset.key,1)">«</button>';
    html += '<button class="hist-page-btn" data-key="'+key+'" data-page="'+(state.page-1)+'" onclick="_histGoPage(this.dataset.key,parseInt(this.dataset.page))">‹</button>';
    for (var p=Math.max(1,state.page-2);p<=Math.min(pages,state.page+2);p++) {
      html += '<button class="hist-page-btn'+(p===state.page?' active':'')+'" data-key="'+key+'" data-page="'+p+'" onclick="_histGoPage(this.dataset.key,parseInt(this.dataset.page))">'+p+'</button>';
    }
    html += '<button class="hist-page-btn" data-key="'+key+'" data-page="'+(state.page+1)+'" onclick="_histGoPage(this.dataset.key,parseInt(this.dataset.page))">›</button>';
    html += '<button class="hist-page-btn" data-key="'+key+'" data-page="'+pages+'" onclick="_histGoPage(this.dataset.key,parseInt(this.dataset.page))">»</button>';
    html += '</div></div>';
  }
  listEl.innerHTML = html;
}

function _histSortList(key, colIdx) {
  if (!_histState[key]) _histState[key]={page:1,sortCol:-1,sortDir:-1};
  var s = _histState[key];
  if (s.sortCol===colIdx) s.sortDir*=-1; else {s.sortCol=colIdx;s.sortDir=-1;}
  s.page=1; _histLoadList(key);
}

function _histGoPage(key, page) {
  if (!_histState[key]) _histState[key]={page:1,sortCol:-1,sortDir:-1};
  var pages = _histState[key].pages||1;
  _histState[key].page = Math.max(1,Math.min(page,pages));
  _histLoadList(key);
}

var _histCurrentUploadKey = null;

function _histUpload(key) {
  _histCurrentUploadKey = key;
  var modal   = document.getElementById('hist-upload-modal');
  var title   = document.getElementById('hist-upload-title');
  var cont    = document.getElementById('hist-upload-content');
  if (!modal || !cont) return;
  var titles = {
    'kms':         '🚚 Upload KMS / EDSP Data',
    'payroll':     '💰 Upload EDSP Payroll Data',
    'dsp-payroll': '🚐 Upload DSP Payroll Data',
    'petrol':      '⛽ Upload Petrol Expenses',
    'rent':        '🏠 Upload Rent Payments',
    'addl':        '💳 Upload Additional Payments',
    'bank':        '🏦 Upload Bank Payment File'
  };
  if (title) title.textContent = titles[key] || 'Upload';
  cont.innerHTML = '';
  modal.style.display = 'flex';
  if (key === 'kms')         _histInjectKmsUpload(cont);
  if (key === 'payroll')     _histInjectPayrollUpload(cont);
  if (key === 'dsp-payroll') _histInjectDspUpload(cont);
  if (key === 'petrol')      _histInjectPetrolUpload(cont);
  if (key === 'rent')        _histInjectRentUpload(cont);
  if (key === 'addl')        _histInjectAddlUpload(cont);
  if (key === 'bank')        _histInjectBankUpload(cont);
}

function _histCloseUpload() {
  var modal = document.getElementById('hist-upload-modal');
  if (modal) modal.style.display = 'none';
  if (_histCurrentUploadKey) {
    // Auto-open the strip to show updated data
    if (_histOpenKey !== _histCurrentUploadKey) {
      _histToggleStrip(_histCurrentUploadKey);
    } else {
      _histLoadList(_histCurrentUploadKey);
    }
  }
}

function _histInjectKmsUpload(container) {
  container.innerHTML =
    '<div style="font-size:.78rem;color:var(--text-3);margin-bottom:14px">Upload Amazon EDSP response Excel. Auto-detects period label (e.g. feb-2026-a).</div>' +
    '<div id="edsp-dropzone" style="border:2px dashed var(--border);border-radius:12px;padding:28px;text-align:center;cursor:pointer;margin-bottom:14px">' +
    '<div style="font-size:1.8rem;margin-bottom:6px">📂</div>' +
    '<div style="font-size:.85rem;font-weight:600;color:var(--navy)">Drop EDSP Excel here or click to browse</div>' +
    '<div style="font-size:.73rem;color:var(--text-3);margin-top:4px">Accepts .xlsx</div>' +
    '<input type="file" id="edsp-file-input" accept=".xlsx" style="display:none"></div>' +
    '<div id="edsp-preview" style="display:none;background:var(--bg);border-radius:10px;padding:14px;margin-bottom:14px;font-size:.82rem">' +
    '<div style="font-weight:600;color:var(--navy);margin-bottom:10px">📋 Preview</div>' +
    '<div id="edsp-preview-body"></div>' +
    '<div style="display:flex;gap:8px;margin-top:12px">' +
    '<button class="btn btn-ghost btn-sm" id="edsp-cancel-btn">✕ Cancel</button>' +
    '<button class="btn btn-green btn-sm" id="edsp-confirm-btn">✓ Confirm</button></div></div>' +
    '<div id="edsp-result" style="display:none;font-size:.82rem"></div>';
  var dz=document.getElementById('edsp-dropzone'), fi=document.getElementById('edsp-file-input');
  if(dz){dz.addEventListener('click',function(){fi&&fi.click();});dz.addEventListener('dragover',function(e){e.preventDefault();dz.style.borderColor='var(--navy)';});dz.addEventListener('dragleave',function(){dz.style.borderColor='var(--border)';});dz.addEventListener('drop',function(e){e.preventDefault();dz.style.borderColor='var(--border)';if(e.dataTransfer.files[0])_edspFileChosen(e.dataTransfer.files[0]);});}
  if(fi)fi.addEventListener('change',function(){if(fi.files[0])_edspFileChosen(fi.files[0]);});
  var cb=document.getElementById('edsp-confirm-btn'),cc=document.getElementById('edsp-cancel-btn');
  if(cb)cb.addEventListener('click',_edspConfirmUpload);
  if(cc)cc.addEventListener('click',_edspReset);
}

function _histInjectPayrollUpload(container) {
  container.innerHTML =
    '<div style="font-size:.78rem;color:var(--text-3);margin-bottom:14px">Upload monthly IC payment Excel files. Auto-detects month from filename.</div>' +
    '<div id="ph-dropzone" style="border:2px dashed var(--border);border-radius:12px;padding:28px;text-align:center;cursor:pointer;margin-bottom:14px">' +
    '<div style="font-size:1.8rem;margin-bottom:6px">📂</div>' +
    '<div style="font-size:.85rem;font-weight:600;color:var(--navy)">Drop Payroll Excel here or click to browse</div>' +
    '<div style="font-size:.73rem;color:var(--text-3);margin-top:4px">Jan_IC_Payment.xlsx style</div>' +
    '<input type="file" id="ph-file-input" accept=".xlsx" style="display:none"></div>' +
    '<div id="ph-preview" style="display:none;background:var(--bg);border-radius:10px;padding:14px;margin-bottom:14px;font-size:.82rem">' +
    '<div style="font-weight:600;color:var(--navy);margin-bottom:10px">📋 Preview</div>' +
    '<div id="ph-preview-body"></div>' +
    '<div style="display:flex;gap:8px;margin-top:12px">' +
    '<button class="btn btn-ghost btn-sm" id="ph-cancel-btn">✕ Cancel</button>' +
    '<button class="btn btn-green btn-sm" id="ph-confirm-btn">✓ Confirm</button></div></div>' +
    '<div id="ph-result" style="display:none;font-size:.82rem"></div>';
  var dz=document.getElementById('ph-dropzone'), fi=document.getElementById('ph-file-input');
  if(dz){dz.addEventListener('click',function(){fi&&fi.click();});dz.addEventListener('dragover',function(e){e.preventDefault();dz.style.borderColor='var(--navy)';});dz.addEventListener('dragleave',function(){dz.style.borderColor='var(--border)';});dz.addEventListener('drop',function(e){e.preventDefault();dz.style.borderColor='var(--border)';if(e.dataTransfer.files[0])_phFileChosen(e.dataTransfer.files[0]);});}
  if(fi)fi.addEventListener('change',function(){if(fi.files[0])_phFileChosen(fi.files[0]);});
  var cb=document.getElementById('ph-confirm-btn'),cc=document.getElementById('ph-cancel-btn');
  if(cb)cb.addEventListener('click',_phConfirmUpload);
  if(cc)cc.addEventListener('click',_phReset);
}

function _histInjectDspUpload(container) {
  container.innerHTML =
    '<div style="font-size:.78rem;color:var(--text-3);margin-bottom:6px">Upload DSP IC payment Excel one station at a time. Same month files accumulate.</div>' +
    '<div style="font-size:.75rem;color:var(--amber-d,#b45309);background:#fef9c3;border-radius:6px;padding:6px 10px;margin-bottom:14px">⚠ Supports BDQE (Final Payout), AMDE and GNNT formats. Station auto-detected from filename.</div>' +
    '<div id="dsp-ph-dropzone" style="border:2px dashed var(--border);border-radius:12px;padding:28px;text-align:center;cursor:pointer;margin-bottom:14px">' +
    '<div style="font-size:1.8rem;margin-bottom:6px">📂</div>' +
    '<div style="font-size:.85rem;font-weight:600;color:var(--navy)">Drop DSP Payroll Excel here or click to browse</div>' +
    '<div style="font-size:.73rem;color:var(--text-3);margin-top:4px">Accepts .xlsx</div>' +
    '<input type="file" id="dsp-ph-file" accept=".xlsx" style="display:none"></div>' +
    '<div id="dsp-ph-preview" style="display:none;background:var(--bg);border-radius:10px;padding:14px;margin-bottom:14px;font-size:.82rem">' +
    '<div style="font-weight:600;color:var(--navy);margin-bottom:10px">📋 Preview</div>' +
    '<div id="dsp-ph-preview-body"></div>' +
    '<div style="display:flex;gap:8px;margin-top:12px">' +
    '<button class="btn btn-ghost btn-sm" id="dsp-ph-cancel">✕ Cancel</button>' +
    '<button class="btn btn-green btn-sm" id="dsp-ph-confirm">✓ Confirm</button></div></div>' +
    '<div id="dsp-ph-result" style="display:none;font-size:.82rem"></div>';
  var dz=document.getElementById('dsp-ph-dropzone'), fi=document.getElementById('dsp-ph-file');
  if(dz){dz.addEventListener('click',function(){fi&&fi.click();});dz.addEventListener('dragover',function(e){e.preventDefault();dz.style.borderColor='var(--navy)';});dz.addEventListener('dragleave',function(){dz.style.borderColor='var(--border)';});dz.addEventListener('drop',function(e){e.preventDefault();dz.style.borderColor='var(--border)';if(e.dataTransfer.files[0])_dspPhChosen(e.dataTransfer.files[0]);});}
  if(fi)fi.addEventListener('change',function(){if(fi.files[0])_dspPhChosen(fi.files[0]);});
  var cb=document.getElementById('dsp-ph-confirm'),cc=document.getElementById('dsp-ph-cancel');
  if(cb)cb.addEventListener('click',_dspPhConfirm);
  if(cc)cc.addEventListener('click',_dspPhReset);
}

function _histInjectRentUpload(container) {
  var w = document.createElement('div'); w.id='hist-rent-upload-w'; container.appendChild(w);
  _buildUploadWidget({bodyId:'hist-rent-upload-w', desc:'Upload monthly station rent Excel. Auto-detects month from filename.',
    checkUrl:'/api/admin/rent-history-check', uploadUrl:'/api/admin/upload-rent-history',
    monthsUrl:'/api/admin/rent-history-months', parseFile:_rentParseXlsx,
    renderMonths:function(){return '';}});
}

function _histInjectAddlUpload(container) {
  var w = document.createElement('div'); w.id='hist-addl-upload-w'; container.appendChild(w);
  _buildUploadWidget({bodyId:'hist-addl-upload-w', desc:'Upload additional payment sheets (IC Advance, EV EMI, Van Payment). Uses Sheet1 only.',
    checkUrl:'/api/admin/addl-payments-check', uploadUrl:'/api/admin/upload-addl-payments',
    monthsUrl:'/api/admin/addl-payments-months', parseFile:_addlParseXlsx,
    renderMonths:function(){return '';}});
}

// ── Payroll History Upload ───────────────────────────────────────────────────
let _payrollHistInitDone = false;
let _payrollHistPendingRows = null;
let _payrollHistPendingMonth = null;

function _payrollHistInit() {
  if (_payrollHistInitDone) return;
  _payrollHistInitDone = true;
  const body = document.getElementById('hist-payroll-body');
  if (!body) return;
  body.innerHTML = `
    <div style="font-size:.78rem;color:var(--text-3);margin-bottom:14px">
      Upload monthly IC payment Excel files. Auto-detects month from file data.
      Format: Store Name, Station Code, ID, Head, Name … (39 columns).
    </div>
    <div id="ph-dropzone" onclick="document.getElementById('ph-file-input').click()"
      style="border:2px dashed var(--border);border-radius:12px;padding:28px;text-align:center;cursor:pointer;margin-bottom:14px"
      ondragover="event.preventDefault();this.style.borderColor='var(--navy)'"
      ondragleave="this.style.borderColor='var(--border)'"
      ondrop="_phDrop(event)">
      <div style="font-size:1.8rem;margin-bottom:6px">📂</div>
      <div style="font-size:.85rem;font-weight:600;color:var(--navy)">Drop Payroll Excel file here or click to browse</div>
      <div style="font-size:.73rem;color:var(--text-3);margin-top:4px">Accepts .xlsx — Jan_IC_Payment.xlsx style</div>
      <input type="file" id="ph-file-input" accept=".xlsx" style="display:none" onchange="_phFileChosen(this.files[0])">
    </div>
    <div id="ph-preview" style="display:none;background:var(--bg);border-radius:10px;padding:14px;margin-bottom:14px;font-size:.82rem">
      <div style="font-weight:600;color:var(--navy);margin-bottom:10px">📋 File Preview</div>
      <div id="ph-preview-body"></div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-ghost btn-sm" onclick="_phReset()">✕ Cancel</button>
        <button class="btn btn-green btn-sm" id="ph-confirm-btn" onclick="_phConfirmUpload()">✓ Confirm Upload</button>
      </div>
    </div>
    <div id="ph-result" style="display:none;font-size:.82rem"></div>
    <div style="margin-top:18px;border-top:1px solid var(--border);padding-top:14px">
      <div style="font-weight:600;color:var(--navy);font-size:.83rem;margin-bottom:10px">📁 Uploaded Months</div>
      <div id="ph-months-list" style="font-size:.78rem;color:var(--text-3)">Loading…</div>
    </div>`;
  _phLoadMonths();
}

function _phDrop(e) {
  e.preventDefault();
  document.getElementById('ph-dropzone').style.borderColor = 'var(--border)';
  const file = e.dataTransfer.files[0];
  if (file) _phFileChosen(file);
}

function _phFileChosen(file) {
  if (!file || !file.name.endsWith('.xlsx')) { toast('Please select an .xlsx file', 'warning'); return; }
  const preview = document.getElementById('ph-preview');
  const body    = document.getElementById('ph-preview-body');
  if (preview) preview.style.display = 'block';
  if (body)    body.innerHTML = '<div style="color:var(--text-3)">📂 Reading file…</div>';
  setTimeout(() => _phRunPreview(file), 50);
}

function _phParseXlsx(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb   = XLSX.read(e.target.result, {type:'array'});
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const raw  = XLSX.utils.sheet_to_json(ws, {defval:null, header:1});
        const san  = v => (v == null ? null : String(v).replace(/\r/g,'').replace(/\n/g,'').trim() || null);
        const num  = v => (v == null || v === '' ? null : parseFloat(v) || 0);
        const rows = [];

        // Detect month from filename e.g. Jan_IC_Payment.xlsx → jan-2026
        // We'll detect from a date column later; use filename hint for now
        const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
        const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
        const fname = file.name.toLowerCase();
        let detectedMonth = null;
        for (let i = 0; i < monthNames.length; i++) {
          if (fname.includes(monthNames[i]) || fname.includes(months[i])) {
            // Guess year from current date
            const yr = new Date().getFullYear();
            // If month index > current month, it's probably last year
            const curMon = new Date().getMonth();
            const guessYr = i > curMon ? yr - 1 : yr;
            detectedMonth = months[i] + '-' + guessYr;
            break;
          }
        }

        // Header-based column mapping — resilient to column reordering
        const col = makeColMap(raw[0]||[], {
          store_name:      ['Store Name','Store','Station Name'],
          station_code:    ['Station Code','Station'],
          ic_emp:          ['IC / Emp','IC/Emp','Head','Payroll Head'],
          id:              ['ID','E.ID','Emp ID','Employee ID'],
          name:            ['Name','Employee Name','Staff Name'],
          associate_id:    ['Associate ID','Amazon ID','Amz ID'],
          present_days:    ['Present day','Present Days','Present'],
          week_off:        ['Week off','Week Off','WO'],
          total_days:      ['Total','Total Days'],
          delivery:        ['Delivery','Delivery - Bifme','Delivery - EDSP'],
          pickup:          ['Pick-up','Pick up','Pick-up - Bifme','Pick-up - EDSP','Pickup'],
          swa:             ['SWA','V.Bifme'],
          smd:             ['SMD'],
          mfn:             ['MFN','MFN - Bifme','MFN - EDSP'],
          seller_returns:  ['Seller Returns','Seller Returns - EDSP'],
          total_parcels:   ['Total Parcel - Bifme','Total Parcel - EDSP','Total Parcels','Total Parcel','Approved Parcel By CM'],
          payment:         ['Payment','Total Pay RS - Petrol'],
          incentive:       ['Incentive'],
          gross_payment:   ['Gross Payment','Gross Pay'],
          debit_note:      ['Debit Note','Debit'],
          net_pay:         ['Net Pay','Net Pay RS'],
          advance:         ['Advanced','Advance'],
          tds:             ['TDS'],
          bank_transfer:   ['Bank transfer RS','Bank Transfer','Bank Transfer RS','Total Pay - Bank transfer','Total Bank Transfer'],
          ctc:             ['CTC'],
          pay_type:        ['Type','Pay Type','Payment Type'],
          petrol:          ['Petrol'],
          parcel_count:    ['Parcel','Approved Parcel'],
          per_parcel_cost: ['Per Parcel Cost','Per parcel cost'],
          average:         ['Average'],
          diff:            ['Diff.','Diff'],
          pan_card:        ['Pan Card','PAN Card','PAN'],
          user_type:       ['User type','User Type','Designation'],
          cluster_manager: ['CM','Cluster Manager'],
          pnl_use:         ['For PNL USE','PNL Use','PNL'],
          remarks:         ['Remarks','Remark'],
          state:           ['State'],
          tally_ledger:    ['Tally Ledger Name','Tally Ledger'],
          cost_centre:     ['Cost Centre','Cost Center'],
        });

        for (let i = 1; i < raw.length; i++) {
          const r = raw[i];
          const idVal = col('id') !== null ? r[col('id')] : null;
          if (!idVal) continue;
          const staff_id = parseInt(idVal);
          if (!staff_id || isNaN(staff_id)) continue;
          const stRaw = col('station_code') !== null ? san(r[col('station_code')]) : null;
          rows.push({
            staff_id,
            store_name:      col('store_name')     !== null ? san(r[col('store_name')])     : null,
            station_code:    stRaw ? stRaw.toUpperCase() : null,
            head:            col('ic_emp')         !== null ? san(r[col('ic_emp')])         : null,
            name:            col('name')           !== null ? san(r[col('name')])           : null,
            associate_id:    col('associate_id')   !== null ? san(r[col('associate_id')])   : null,
            present_days:    col('present_days')   !== null ? num(r[col('present_days')])   : 0,
            week_off:        col('week_off')       !== null ? num(r[col('week_off')])       : 0,
            total_days:      col('total_days')     !== null ? num(r[col('total_days')])     : 0,
            delivery:        col('delivery')       !== null ? num(r[col('delivery')])       : 0,
            pickup:          col('pickup')         !== null ? num(r[col('pickup')])         : 0,
            swa:             col('swa')            !== null ? num(r[col('swa')])            : 0,
            smd:             col('smd')            !== null ? num(r[col('smd')])            : 0,
            mfn:             col('mfn')            !== null ? num(r[col('mfn')])            : 0,
            seller_returns:  col('seller_returns') !== null ? num(r[col('seller_returns')]) : 0,
            total_parcels:   col('total_parcels')  !== null ? num(r[col('total_parcels')])  : 0,
            payment:         col('payment')        !== null ? num(r[col('payment')])        : 0,
            incentive:       col('incentive')      !== null ? num(r[col('incentive')])      : 0,
            gross_payment:   col('gross_payment')  !== null ? num(r[col('gross_payment')])  : 0,
            debit_note:      col('debit_note')     !== null ? num(r[col('debit_note')])     : 0,
            net_pay:         col('net_pay')        !== null ? num(r[col('net_pay')])        : 0,
            advance:         col('advance')        !== null ? num(r[col('advance')])        : 0,
            tds:             col('tds')            !== null ? num(r[col('tds')])            : 0,
            bank_transfer:   col('bank_transfer')  !== null ? num(r[col('bank_transfer')])  : 0,
            ctc:             col('ctc')            !== null ? num(r[col('ctc')])            : 0,
            pay_type:        col('pay_type')       !== null ? san(r[col('pay_type')])       : null,
            petrol:          col('petrol')         !== null ? num(r[col('petrol')])         : 0,
            parcel_count:    col('parcel_count')   !== null ? num(r[col('parcel_count')])   : 0,
            per_parcel_cost: col('per_parcel_cost')!== null ? num(r[col('per_parcel_cost')]): 0,
            average:         col('average')        !== null ? num(r[col('average')])        : 0,
            diff:            col('diff')           !== null ? num(r[col('diff')])           : 0,
            pan_card:        col('pan_card')       !== null ? san(r[col('pan_card')])       : null,
            user_type:       col('user_type')      !== null ? san(r[col('user_type')])      : null,
            cluster_manager: col('cluster_manager')!== null ? san(r[col('cluster_manager')]): null,
            pnl_use:         col('pnl_use')        !== null ? san(r[col('pnl_use')])        : null,
            remarks:         col('remarks')        !== null ? san(r[col('remarks')])        : null,
            state:           col('state')          !== null ? san(r[col('state')])          : null,
            tally_ledger:    col('tally_ledger')   !== null ? san(r[col('tally_ledger')])   : null,
            cost_centre:     col('cost_centre')    !== null ? san(r[col('cost_centre')])    : null,
          });
        }
        resolve({rows, detectedMonth});
      } catch(e) { reject(e); }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

async function _phRunPreview(file) {
  const body = document.getElementById('ph-preview-body');
  try {
    const {rows, detectedMonth} = await _phParseXlsx(file);
    _payrollHistPendingRows  = rows;
    _payrollHistPendingMonth = detectedMonth;

    // Check if month exists
    let existsWarning = '';
    if (detectedMonth) {
      const chk = await fetch('/api/admin/payroll-history-check?month=' + encodeURIComponent(detectedMonth)).then(r=>r.json(), {credentials:'include'});
      if (chk.exists) {
        existsWarning = `<div style="margin-top:8px;padding:8px 12px;background:#fef9c3;border-radius:8px;color:#92400e;font-size:.75rem">
          ⚠ <strong>${escH(detectedMonth)}</strong> already has ${chk.count} rows. Confirming will replace all existing data for this month.</div>`;
      }
    }

    const stations = [...new Set(rows.map(r=>r.station_code).filter(Boolean))].sort();
    const heads    = [...new Set(rows.map(r=>r.head).filter(Boolean))].sort();
    const totalNet = rows.reduce((s,r) => s + (r.net_pay||0), 0);

    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 20px">
        <div><span style="color:var(--text-3)">Detected month:</span>
          <input type="text" id="ph-month-input" value="${escH(detectedMonth||'')}"
            placeholder="e.g. jan-2026"
            style="margin-left:6px;padding:3px 8px;border:1px solid var(--border);border-radius:6px;font-size:.8rem;width:110px">
        </div>
        <div><span style="color:var(--text-3)">Rows:</span> <strong>${rows.length}</strong></div>
        <div><span style="color:var(--text-3)">Stations (${stations.length}):</span> <span style="font-family:monospace;font-size:.73rem">${stations.join(', ')}</span></div>
        <div><span style="color:var(--text-3)">Heads:</span> <strong>${heads.join(', ')}</strong></div>
        <div><span style="color:var(--text-3)">Total Net Pay:</span> <strong>₹${totalNet.toLocaleString('en-IN', {maximumFractionDigits:0})}</strong></div>
      </div>
      ${existsWarning}`;
  } catch(e) {
    body.innerHTML = `<span style="color:var(--red-d)">Error reading file: ${e.message}</span>`;
  }
}

async function _phConfirmUpload() {
  if (!_payrollHistPendingRows) return;
  const monthInput = document.getElementById('ph-month-input');
  const month = monthInput ? monthInput.value.trim() : _payrollHistPendingMonth;
  if (!month) { toast('Please enter a month label (e.g. jan-2026)', 'warning'); return; }

  const btn = document.getElementById('ph-confirm-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Uploading…'; }

  const result  = document.getElementById('ph-result');
  const preview = document.getElementById('ph-preview');

  try {
    const r = await fetch('/api/admin/upload-payroll-history', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({rows: _payrollHistPendingRows, month, replace: true})
    });
    const d = await r.json();
    preview.style.display = 'none';
    result.style.display  = 'block';
    if (d.ok) {
      result.innerHTML = `<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:14px">
        <div style="font-weight:600;color:#15803d;margin-bottom:4px">✅ Upload successful</div>
        <div>Month: <strong>${escH(d.month)}</strong> &nbsp;|&nbsp; Inserted: <strong>${d.inserted}</strong> rows &nbsp;|&nbsp; Skipped: <strong>${d.skipped}</strong></div>
      </div>`;
      _phReset();
      _phLoadMonths();
    } else {
      result.innerHTML = `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:14px;color:var(--red-d)">❌ ${escH(d.error)}</div>`;
      if (btn) { btn.disabled = false; btn.textContent = '✓ Confirm Upload'; }
    }
  } catch(e) {
    if (btn) { btn.disabled = false; btn.textContent = '✓ Confirm Upload'; }
    toast('Upload failed: ' + e.message, 'error');
  }
}

function _phReset() {
  _payrollHistPendingRows  = null;
  _payrollHistPendingMonth = null;
  const fi = document.getElementById('ph-file-input');
  if (fi) fi.value = '';
  const preview = document.getElementById('ph-preview');
  if (preview) preview.style.display = 'none';
  const result = document.getElementById('ph-result');
  if (result) result.style.display = 'none';
  const btn = document.getElementById('ph-confirm-btn');
  if (btn) { btn.disabled = false; btn.textContent = '✓ Confirm Upload'; }
}

async function _phLoadMonths() {
  const el = document.getElementById('ph-months-list') || document.getElementById('hist-payroll-list');
  if (!el) return;
  try {
    const r = await fetch('/api/admin/payroll-history-months', {credentials:'include'});
    const d = await r.json();
    const totalNet = d.reduce(function(s,p){return s+parseFloat(p.total_net_pay||0);},0);
    const totalBank = d.reduce(function(s,p){return s+parseFloat(p.total_bank_transfer||0);},0);
    const stats = '<span><strong>'+d.length+'</strong> months</span>' +
      '<span>Net Pay total: <strong>'+_fmtAmt(totalNet)+'</strong></span>' +
      '<span>Bank Transfer total: <strong>'+_fmtAmt(totalBank)+'</strong></span>';
    const cols = [
      {label:'Month'},{label:'Staff',right:true},{label:'Net Pay',right:true},
      {label:'Bank Transfer',right:true},{label:'TDS',right:true},{label:'Actions',html:true}
    ];
    const rows = d.map(function(p) {
      return [
        p.payroll_month, p.staff_count,
        _fmtAmt(p.total_net_pay), _fmtAmt(p.total_bank_transfer), _fmtAmt(p.total_tds),
        '<span style="white-space:nowrap">' +
        '<button class="btn btn-ghost btn-sm" style="font-size:.7rem;margin-right:4px" data-m="'+escH(p.payroll_month)+'" data-type="payroll" onclick="_histReview(this.dataset.type,this.dataset.m)">👁 Review</button>' +
        '<button class="btn btn-ghost btn-sm" style="font-size:.7rem;color:var(--red-d)" data-m="'+escH(p.payroll_month)+'" onclick="_phDelete(this.dataset.m)">🗑</button>' +
        '</span>'
      ];
    });
    var fyResult = _filterRowsByFY(rows, d, 'payroll', function(item){ return item.payroll_month; });
    _histRenderList('payroll', el, fyResult.rows, cols, stats, null, fyResult.fyHtml);
    var tbody = el.querySelector('tbody');
    var fyD = d.filter(function(item){ return _monthToFY(item.payroll_month) === (_histFY['payroll'] || (fyResult.allFYs||[])[0]); });
    if (tbody) Array.from(tbody.querySelectorAll('tr')).forEach(function(tr,i) {
      if (fyD[i]) tr.cells[0].innerHTML = _monthBadge(fyD[i].payroll_month);
    });
  } catch(e) {
    el.innerHTML = '<span style="color:var(--red-d)">Error: '+e.message+'</span>';
  }
}

async function _phDelete(month) {
  _showConfirmModal(
    '🗑 Delete Payroll Month',
    'Delete all payroll data for <strong>' + month + '</strong>? This cannot be undone.',
    'Delete', 'var(--red-d)',
    async function() {
      try {
        var r = await fetch('/api/admin/payroll-history/' + encodeURIComponent(month), {method:'DELETE'});
        var d = await r.json();
        if (d.ok) { _showResultModal('✅ Deleted', month + ' payroll deleted (' + d.deleted + ' rows).', 'success'); _phLoadMonths(); }
        else _showResultModal('❌ Error', d.error||'Delete failed', 'error');
      } catch(e) { _showResultModal('❌ Error', e.message, 'error'); }
    }
  );
}

// ── Historical EDSP / KMS Upload ─────────────────────────────────────────────

let _edspPendingFile = null;
let _edspPreviewData = null;

async function _edspLoadSummary() {
  const el = document.getElementById('edsp-summary-list');
  if (!el) return;
  try {
    const r = await fetch('/api/admin/edsp-all-periods', {credentials:'include'});
    const d = await r.json();
    if (!d.length) { el.innerHTML = '<div style="color:var(--text-3)">No data in system yet.</div>'; return; }
    el.innerHTML = '<table style="width:100%;border-collapse:collapse">' +
      '<thead><tr style="border-bottom:2px solid var(--border);color:var(--text-2)">' +
      '<th style="padding:5px 8px;text-align:left">Period</th>' +
      '<th style="padding:5px 8px;text-align:left">Source</th>' +
      '<th style="padding:5px 8px;text-align:left">Date Range</th>' +
      '<th style="padding:5px 8px;text-align:right">Rows</th>' +
      '<th style="padding:5px 8px;text-align:right">Stations</th>' +
      '<th style="padding:5px 8px;text-align:right">ICs</th>' +
      '<th style="padding:5px 8px;text-align:right">Deliveries</th>' +
      '<th style="padding:5px 8px;text-align:right">Actions</th></tr></thead><tbody>' +
      d.map(function(p) {
        var isHist = p.source === 'historical';
        var source = isHist
          ? '<span style="font-size:.7rem;padding:2px 6px;background:#dbeafe;color:#1d4ed8;border-radius:4px">Historical</span>'
          : '<span style="font-size:.7rem;padding:2px 6px;background:#dcfce7;color:#15803d;border-radius:4px">Portal</span>';
        var delBtn = isHist
          ? '<button class="btn btn-ghost btn-sm" style="color:var(--red-d);font-size:.7rem" onclick="_edspDeletePeriod(\'' + escH(p.period_label) + '\')">🗑</button>'
          : '';
        return '<tr style="border-bottom:1px solid var(--border)">' +
          '<td style="padding:6px 8px;font-weight:600;color:var(--navy)">' + escH(p.period_label) + '</td>' +
          '<td style="padding:6px 8px">' + source + '</td>' +
          '<td style="padding:6px 8px;color:var(--text-2);font-size:.73rem">' + p.date_from + ' → ' + p.date_to + '</td>' +
          '<td style="padding:6px 8px;text-align:right">' + Number(p.total_rows).toLocaleString() + '</td>' +
          '<td style="padding:6px 8px;text-align:right">' + p.stations + '</td>' +
          '<td style="padding:6px 8px;text-align:right">' + p.ics + '</td>' +
          '<td style="padding:6px 8px;text-align:right">' + Number(p.total_delivered).toLocaleString() + '</td>' +
          '<td style="padding:6px 8px;white-space:nowrap">' +
          '<button class="btn btn-ghost btn-sm" style="font-size:.7rem;margin-right:4px" ' +
          'data-period="' + escH(p.period_label) + '" ' +
          'onclick="_histReview(\'kms\',this.dataset.period)">👁 Review</button>' +
          delBtn + '</td></tr>';
      }).join('') +
      '</tbody></table>';
  } catch(e) {
    el.innerHTML = '<span style="color:var(--red-d)">Error: ' + e.message + '</span>';
  }
}


// ── Generic historical upload widget builder ─────────────────────────────────
function _buildUploadWidget(opts) {
  // opts: {bodyId, desc, accept, parseFile, checkUrl, uploadUrl, monthsUrl, deleteUrl,
  //        previewFields, monthsColumns}
  var body = document.getElementById(opts.bodyId);
  if (!body || body.dataset.init) return;
  body.dataset.init = '1';
  body.innerHTML =
    '<div style="padding:16px">' +
    '<div style="font-size:.78rem;color:var(--text-3);margin-bottom:14px">' + opts.desc + '</div>' +
    '<div id="' + opts.bodyId + '-drop" style="border:2px dashed var(--border);border-radius:12px;padding:28px;text-align:center;cursor:pointer;margin-bottom:14px">' +
    '<div style="font-size:1.8rem;margin-bottom:6px">📂</div>' +
    '<div style="font-size:.85rem;font-weight:600;color:var(--navy)">Drop file here or click to browse</div>' +
    '<div style="font-size:.73rem;color:var(--text-3);margin-top:4px">Accepts .xlsx</div>' +
    '<input type="file" id="' + opts.bodyId + '-file" accept=".xlsx" style="display:none">' +
    '</div>' +
    '<div id="' + opts.bodyId + '-preview" style="display:none;background:var(--bg);border-radius:10px;padding:14px;margin-bottom:14px;font-size:.82rem">' +
    '<div style="font-weight:600;color:var(--navy);margin-bottom:10px">📋 File Preview</div>' +
    '<div id="' + opts.bodyId + '-preview-body"></div>' +
    '<div style="display:flex;gap:8px;margin-top:12px">' +
    '<button class="btn btn-ghost btn-sm" id="' + opts.bodyId + '-cancel">✕ Cancel</button>' +
    '<button class="btn btn-green btn-sm" id="' + opts.bodyId + '-confirm">✓ Confirm Upload</button>' +
    '</div></div>' +
    '<div id="' + opts.bodyId + '-result" style="display:none;font-size:.82rem"></div>' +
    '<div style="margin-top:18px;border-top:1px solid var(--border);padding-top:14px">' +
    '<div style="font-weight:600;color:var(--navy);font-size:.83rem;margin-bottom:8px">📁 Uploaded Months</div>' +
    '<div id="' + opts.bodyId + '-months" style="font-size:.78rem;color:var(--text-3)">Loading…</div>' +
    '</div></div>';

  // Wire events after DOM is set (avoids invalid inline handler names with dashes)
  var dropEl = document.getElementById(opts.bodyId + '-drop');
  var fileEl = document.getElementById(opts.bodyId + '-file');
  if (dropEl) {
    dropEl.addEventListener('click', function() { if (fileEl) fileEl.click(); });
    dropEl.addEventListener('dragover', function(e) { e.preventDefault(); dropEl.style.borderColor='var(--navy)'; });
    dropEl.addEventListener('dragleave', function() { dropEl.style.borderColor='var(--border)'; });
    dropEl.addEventListener('drop', function(e) {
      e.preventDefault(); dropEl.style.borderColor='var(--border)';
      var f = e.dataTransfer.files[0];
      if (f) window[opts.bodyId + '_chosen'](f);
    });
  }
  if (fileEl) {
    fileEl.addEventListener('change', function() { if (fileEl.files[0]) window[opts.bodyId + '_chosen'](fileEl.files[0]); });
  }
  var cancelEl  = document.getElementById(opts.bodyId + '-cancel');
  var confirmEl = document.getElementById(opts.bodyId + '-confirm');
  if (cancelEl)  cancelEl.addEventListener('click',  function() { window[opts.bodyId + '_reset'](); });
  if (confirmEl) confirmEl.addEventListener('click', function() { window[opts.bodyId + '_confirm'](); });

  // Register global handlers for this widget
  window[opts.bodyId + '_drop'] = function(e) {
    e.preventDefault();
    document.getElementById(opts.bodyId + '-drop').style.borderColor = 'var(--border)';
    var f = e.dataTransfer.files[0];
    if (f) window[opts.bodyId + '_chosen'](f);
  };
  window[opts.bodyId + '_pendingRows'] = null;
  window[opts.bodyId + '_pendingMonth'] = null;

  window[opts.bodyId + '_chosen'] = function(file) {
    if (!file || !file.name.endsWith('.xlsx')) { toast('Please select an .xlsx file', 'warning'); return; }
    var preview = document.getElementById(opts.bodyId + '-preview');
    var pbody   = document.getElementById(opts.bodyId + '-preview-body');
    if (preview) preview.style.display = 'block';
    if (pbody)   pbody.innerHTML = '<div style="color:var(--text-3)">📂 Reading file…</div>';
    setTimeout(function() { window[opts.bodyId + '_runPreview'](file); }, 50);
  };

  window[opts.bodyId + '_runPreview'] = async function(file) {
    var pbody = document.getElementById(opts.bodyId + '-preview-body');
    try {
      var result = await opts.parseFile(file);
      window[opts.bodyId + '_pendingRows']  = result.rows;
      window[opts.bodyId + '_pendingMonth'] = result.month;
      var chk = result.month ? await fetch(opts.checkUrl + '?month=' + encodeURIComponent(result.month)).then(function(r){return r.json();}) : {exists:false};
      var warn = chk.exists ? '<div style="margin-top:8px;padding:8px 12px;background:#fef9c3;border-radius:8px;color:#92400e;font-size:.75rem">⚠ <strong>' + escH(result.month) + '</strong> already has ' + chk.count + ' rows. Confirming will replace.</div>' : '';
      pbody.innerHTML =
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 20px">' +
        '<div><span style="color:var(--text-3)">Month:</span> <input type="text" id="' + opts.bodyId + '-month-input" value="' + escH(result.month||'') + '" placeholder="e.g. jan-2026" style="margin-left:6px;padding:3px 8px;border:1px solid var(--border);border-radius:6px;font-size:.8rem;width:110px"></div>' +
        '<div><span style="color:var(--text-3)">Rows:</span> <strong>' + result.rows.length + '</strong></div>' +
        (result.summary || '') +
        '</div>' + warn;
    } catch(e) {
      pbody.innerHTML = '<span style="color:var(--red-d)">Error: ' + e.message + '</span>';
    }
  };

  window[opts.bodyId + '_confirm'] = async function() {
    var rows = window[opts.bodyId + '_pendingRows'];
    if (!rows) return;
    var inp = document.getElementById(opts.bodyId + '-month-input');
    var month = inp ? inp.value.trim() : window[opts.bodyId + '_pendingMonth'];
    if (!month) { toast('Enter a month label', 'warning'); return; }
    var btn = document.getElementById(opts.bodyId + '-confirm');
    if (btn) { btn.disabled = true; btn.textContent = 'Uploading…'; }
    var result  = document.getElementById(opts.bodyId + '-result');
    var preview = document.getElementById(opts.bodyId + '-preview');
    try {
      var r = await fetch(opts.uploadUrl, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({rows:rows, month:month, replace:true})});
      var d = await r.json();
      if (preview) preview.style.display = 'none';
      if (result)  result.style.display = 'block';
      if (d.ok) {
        result.innerHTML = '<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:14px"><div style="font-weight:600;color:#15803d;margin-bottom:4px">✅ Upload successful</div><div>Month: <strong>' + escH(d.month) + '</strong> | Inserted: <strong>' + d.inserted + '</strong> | Skipped: <strong>' + d.skipped + '</strong></div></div>';
        window[opts.bodyId + '_reset']();
        window[opts.bodyId + '_loadMonths']();
      } else {
        result.innerHTML = '<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:14px;color:var(--red-d)">❌ ' + escH(d.error||'Error') + '</div>';
        if (btn) { btn.disabled = false; btn.textContent = '✓ Confirm Upload'; }
      }
    } catch(e) {
      if (btn) { btn.disabled = false; btn.textContent = '✓ Confirm Upload'; }
      toast('Upload failed: ' + e.message, 'error');
    }
  };

  window[opts.bodyId + '_reset'] = function() {
    window[opts.bodyId + '_pendingRows'] = null;
    var fi = document.getElementById(opts.bodyId + '-file');
    if (fi) fi.value = '';
    var preview = document.getElementById(opts.bodyId + '-preview');
    if (preview) preview.style.display = 'none';
    var result = document.getElementById(opts.bodyId + '-result');
    if (result) result.style.display = 'none';
    var btn = document.getElementById(opts.bodyId + '-confirm');
    if (btn) { btn.disabled = false; btn.textContent = '✓ Confirm Upload'; }
  };

  window[opts.bodyId + '_loadMonths'] = async function() {
    var el = document.getElementById(opts.bodyId + '-months');
    if (!el) return;
    try {
      var r = await fetch(opts.monthsUrl);
      var d = await r.json();
      if (!d.length) { el.innerHTML = '<div style="color:var(--text-3)">No data uploaded yet.</div>'; return; }
      el.innerHTML = opts.renderMonths(d);
    } catch(e) { el.innerHTML = '<span style="color:var(--red-d)">Error: ' + e.message + '</span>'; }
  };

  window[opts.bodyId + '_loadMonths']();
}


// ── DSP Payroll History ───────────────────────────────────────────────────────
function _dspPayrollHistInit() {
  var body = document.getElementById('hist-dsp-payroll-body');
  if (!body || body.dataset.init) return;
  body.dataset.init = '1';
  body.innerHTML =
    '<div style="padding:16px">' +
    '<div style="font-size:.78rem;color:var(--text-3);margin-bottom:6px">Upload DSP IC payment Excel files one station at a time. Files from same month accumulate together.</div>' +
    '<div style="font-size:.75rem;color:var(--amber-d,#b45309);background:#fef9c3;border-radius:6px;padding:6px 10px;margin-bottom:14px">⚠ Supports BDQE (Final Payout sheet), AMDE and GNNT formats. Station auto-detected from filename or data.</div>' +
    '<div id="dsp-ph-dropzone" style="border:2px dashed var(--border);border-radius:12px;padding:28px;text-align:center;cursor:pointer;margin-bottom:14px">' +
    '<div style="font-size:1.8rem;margin-bottom:6px">📂</div>' +
    '<div style="font-size:.85rem;font-weight:600;color:var(--navy)">Drop DSP Payroll Excel here or click to browse</div>' +
    '<div style="font-size:.73rem;color:var(--text-3);margin-top:4px">Accepts .xlsx</div>' +
    '<input type="file" id="dsp-ph-file" accept=".xlsx" style="display:none">' +
    '</div>' +
    '<div id="dsp-ph-preview" style="display:none;background:var(--bg);border-radius:10px;padding:14px;margin-bottom:14px;font-size:.82rem">' +
    '<div style="font-weight:600;color:var(--navy);margin-bottom:10px">📋 File Preview</div>' +
    '<div id="dsp-ph-preview-body"></div>' +
    '<div style="display:flex;gap:8px;margin-top:12px">' +
    '<button class="btn btn-ghost btn-sm" id="dsp-ph-cancel">✕ Cancel</button>' +
    '<button class="btn btn-green btn-sm" id="dsp-ph-confirm">✓ Confirm Upload</button>' +
    '</div></div>' +
    '<div id="dsp-ph-result" style="display:none;font-size:.82rem"></div>' +
    '<div style="margin-top:18px;border-top:1px solid var(--border);padding-top:14px">' +
    '<div style="font-weight:600;color:var(--navy);font-size:.83rem;margin-bottom:8px">📁 Uploaded DSP Payroll</div>' +
    '<div id="dsp-ph-months" style="font-size:.78rem;color:var(--text-3)">Loading…</div>' +
    '</div></div>';

  var dropEl = document.getElementById('dsp-ph-dropzone');
  var fileEl = document.getElementById('dsp-ph-file');
  var cancelEl  = document.getElementById('dsp-ph-cancel');
  var confirmEl = document.getElementById('dsp-ph-confirm');

  if (dropEl) {
    dropEl.addEventListener('click', function() { if (fileEl) fileEl.click(); });
    dropEl.addEventListener('dragover', function(e) { e.preventDefault(); dropEl.style.borderColor='var(--navy)'; });
    dropEl.addEventListener('dragleave', function() { dropEl.style.borderColor='var(--border)'; });
    dropEl.addEventListener('drop', function(e) {
      e.preventDefault(); dropEl.style.borderColor='var(--border)';
      if (e.dataTransfer.files[0]) _dspPhChosen(e.dataTransfer.files[0]);
    });
  }
  if (fileEl)    fileEl.addEventListener('change', function() { if (fileEl.files[0]) _dspPhChosen(fileEl.files[0]); });
  if (cancelEl)  cancelEl.addEventListener('click',  _dspPhReset);
  if (confirmEl) confirmEl.addEventListener('click', _dspPhConfirm);

  _dspPhLoadMonths();
}

var _dspPhPendingRows  = null;
var _dspPhPendingMonth = null;
var _dspPhPendingStation = null;
var _dspPhPendingCycle = 1;

function _dspPhChosen(file) {
  var preview = document.getElementById('dsp-ph-preview');
  var pbody   = document.getElementById('dsp-ph-preview-body');
  if (preview) preview.style.display = 'block';
  if (pbody)   pbody.innerHTML = '<div style="color:var(--text-3)">📂 Reading file…</div>';
  setTimeout(function() { _dspPhRunPreview(file); }, 50);
}

async function _dspPhRunPreview(file) {
  var pbody = document.getElementById('dsp-ph-preview-body');
  try {
    var result = await _dspParseXlsx(file);
    _dspPhPendingRows    = result.rows;
    _dspPhPendingMonth   = result.month;
    _dspPhPendingStation = result.station_code;
    _dspPhPendingCycle   = result.cycle || 1;

    var chk = await fetch('/api/admin/dsp-payroll-check?month=' + encodeURIComponent(result.month) + '&station=' + encodeURIComponent(result.station_code)).then(function(r){return r.json();});
    var warn = chk.exists
      ? '<div style="margin-top:8px;padding:8px 12px;background:#fef9c3;border-radius:8px;color:#92400e;font-size:.75rem">⚠ ' + escH(result.station_code) + ' already has ' + chk.count + ' rows for ' + escH(result.month) + '. Confirming will replace this station data.</div>'
      : '';

    pbody.innerHTML =
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 20px">' +
      '<div><span style="color:var(--text-3)">Station:</span> <strong>' + escH(result.station_code) + '</strong></div>' +
      '<div><span style="color:var(--text-3)">Month:</span> <input type="text" id="dsp-ph-month-input" value="' + escH(result.month) + '" placeholder="e.g. feb-2026" style="margin-left:6px;padding:3px 8px;border:1px solid var(--border);border-radius:6px;font-size:.8rem;width:110px"></div>' +
      '<div><span style="color:var(--text-3)">Rows:</span> <strong>' + result.rows.length + '</strong></div>' +
      '<div><span style="color:var(--text-3)">Cycle:</span> <strong>' + (result.cycle === 2 ? '2 (2nd half)' : '1 (1st half)') + '</strong> <span style="font-size:.72rem;color:var(--text-3)">(auto-detected)</span></div>' +
      '<div><span style="color:var(--text-3)">Total Net Pay:</span> <strong>₹' + result.rows.reduce(function(s,r){return s+(r.net_pay||0);},0).toLocaleString('en-IN',{maximumFractionDigits:0}) + '</strong></div>' +
      '</div>' + warn;
  } catch(e) {
    pbody.innerHTML = '<span style="color:var(--red-d)">Error: ' + e.message + '</span>';
  }
}

async function _dspPhConfirm() {
  if (!_dspPhPendingRows) return;
  var inp = document.getElementById('dsp-ph-month-input');
  var month = inp ? inp.value.trim() : _dspPhPendingMonth;
  if (!month) { toast('Enter a month label', 'warning'); return; }
  var btn = document.getElementById('dsp-ph-confirm');
  if (btn) { btn.disabled = true; btn.textContent = 'Uploading…'; }
  var result  = document.getElementById('dsp-ph-result');
  var preview = document.getElementById('dsp-ph-preview');
  try {
    var r = await fetch('/api/admin/upload-dsp-payroll', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({rows: _dspPhPendingRows, month: month, station_code: _dspPhPendingStation, cycle: _dspPhPendingCycle||1, replace: true})
    });
    var d = await r.json();
    if (preview) preview.style.display = 'none';
    if (result)  result.style.display  = 'block';
    if (d.ok) {
      result.innerHTML = '<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:14px"><div style="font-weight:600;color:#15803d;margin-bottom:4px">✅ Upload successful</div><div>Station: <strong>' + escH(_dspPhPendingStation) + '</strong> | Month: <strong>' + escH(d.month) + '</strong> | Inserted: <strong>' + d.inserted + '</strong></div></div>';
      _dspPhReset();
      _dspPhLoadMonths();
    } else {
      result.innerHTML = '<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:14px;color:var(--red-d)">❌ ' + escH(d.error||'Error') + '</div>';
      if (btn) { btn.disabled = false; btn.textContent = '✓ Confirm Upload'; }
    }
  } catch(e) {
    if (btn) { btn.disabled = false; btn.textContent = '✓ Confirm Upload'; }
    toast('Upload failed: ' + e.message, 'error');
  }
}

function _dspPhReset() {
  _dspPhPendingRows = null;
  var fi = document.getElementById('dsp-ph-file');
  if (fi) fi.value = '';
  var preview = document.getElementById('dsp-ph-preview');
  if (preview) preview.style.display = 'none';
  var result = document.getElementById('dsp-ph-result');
  if (result) result.style.display = 'none';
  var btn = document.getElementById('dsp-ph-confirm');
  if (btn) { btn.disabled = false; btn.textContent = '✓ Confirm Upload'; }
}

async function _dspPhLoadMonths() {
  var el = document.getElementById('dsp-ph-months') || document.getElementById('hist-dsp-payroll-list');
  if (!el) return;
  try {
    var r = await fetch('/api/admin/dsp-payroll-months', {credentials:'include'});
    var d = await r.json();
    var totalNet = d.reduce(function(s,p){return s+(parseFloat(p.total_net_pay)||0);},0);
    var stats = '<span><strong>'+d.length+'</strong> entries</span><span>Net Pay total: <strong>'+_fmtAmt(totalNet)+'</strong></span>';
    var cols = [{label:'Month'},{label:'Station'},{label:'Cycle',right:true},{label:'Staff',right:true},{label:'Net Pay',right:true},{label:'Bank Transfer',right:true},{label:'Actions',html:true}];
    var rows = d.map(function(p) {
      return [p.payment_month, p.station_code, p.cycle||1, p.staff_count,
        _fmtAmt(p.total_net_pay), _fmtAmt(p.total_bank_transfer),
        '<span style="white-space:nowrap"><button class="btn btn-ghost btn-sm" style="font-size:.7rem;margin-right:4px" data-month="'+escH(p.payment_month)+'" data-station="'+escH(p.station_code)+'" data-cycle="'+(p.cycle||1)+'" onclick="_editDspPeriod(this.dataset.month,this.dataset.station,this.dataset.cycle)" title="Edit period">📅</button><button class="btn btn-ghost btn-sm" style="font-size:.7rem;margin-right:4px" data-month="'+escH(p.payment_month)+'" data-station="'+escH(p.station_code)+'" data-cycle="'+(p.cycle||1)+'" onclick="_histReviewDsp(this.dataset.month,this.dataset.station,this.dataset.cycle)">👁 Review</button><button class="btn btn-ghost btn-sm" style="color:var(--red-d);font-size:.7rem" data-month="'+escH(p.payment_month)+'" data-station="'+escH(p.station_code)+'" data-cycle="'+(p.cycle||1)+'" onclick="_dspPhDelete(this.dataset.month,this.dataset.station,this.dataset.cycle)">🗑</button></span>'];
    });
    var fyResult = _filterRowsByFY(rows, d, 'dsp-payroll', function(item){ return item.payment_month; });
    _histRenderList('dsp-payroll', el, fyResult.rows, cols, stats, null, fyResult.fyHtml);
    var tbody = el.querySelector('tbody');
    if (tbody) Array.from(tbody.querySelectorAll('tr')).forEach(function(tr,i){if(d[i])tr.cells[0].innerHTML=_monthBadge(d[i].payment_month);});
  } catch(e) { el.innerHTML = '<span style="color:var(--red-d)">Error: '+e.message+'</span>'; }
}

async function _dspPhDelete(month, station, cycle) {
  _showConfirmModal(
    '🗑 Delete DSP Payroll',
    'Delete DSP payroll for ' + station + ' cycle ' + (cycle||1) + ' — ' + month + '? This cannot be undone.',
    'Delete', 'var(--red-d)',
    async function() {
      try {
        var r = await fetch('/api/admin/dsp-payroll/'+encodeURIComponent(month)+'/'+encodeURIComponent(station)+'/'+(cycle||1), {method:'DELETE'});
        var d = await r.json();
        if (d.ok) { _showResultModal('✅ Deleted', 'DSP payroll deleted.', 'success'); _dspPhLoadMonths(); }
        else _showResultModal('❌ Error', d.error||'Delete failed', 'error');
      } catch(e) { _showResultModal('❌ Error', e.message, 'error'); }
    }
  );
}

function _dspParseXlsx(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var wb  = XLSX.read(e.target.result, {type:'array'});
        var san = function(v) { return v == null ? null : String(v).split('\r').join('').split('\n').join('').trim() || null; };
        var num = function(v) { return v == null ? null : parseFloat(v) || 0; };

        // Detect station from filename
        var fname = file.name.toUpperCase();
        var station_code = null;
        ['BDQE','AMDE','GNNT'].forEach(function(s) { if (fname.includes(s)) station_code = s; });

        // Detect month from filename
        var months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
        var mfull  = ['january','february','march','april','may','june','july','august','september','october','november','december'];
        // Also match common abbreviations/typos in filenames
        var mabbr  = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec',
                      'nove','octo','sept','augu','july','june'];
        var mabbrMap = {'nove':10,'octo':9,'sept':8,'augu':7,'july':6,'june':5};
        var fnlow = file.name.toLowerCase();
        var month = null;
        for (var mi = 0; mi < mfull.length; mi++) {
          if (fnlow.includes(mfull[mi]) || fnlow.includes(months[mi])) {
            var yr = new Date().getFullYear();
            var guessYr = mi > new Date().getMonth() ? yr - 1 : yr;
            month = months[mi] + '-' + guessYr; break;
          }
        }
        // Try abbreviations if not found
        if (!month) {
          var abbrKeys = Object.keys(mabbrMap);
          for (var ai = 0; ai < abbrKeys.length; ai++) {
            if (fnlow.includes(abbrKeys[ai])) {
              var mi2 = mabbrMap[abbrKeys[ai]];
              var yr2 = new Date().getFullYear();
              var guessYr2 = mi2 > new Date().getMonth() ? yr2 - 1 : yr2;
              month = months[mi2] + '-' + guessYr2; break;
            }
          }
        }

        var rows = [];
        var sheetName = wb.SheetNames[0]; // default
        var preferredSheets = ['Final Payout', 'Final Data', 'IC Payment', 'Sheet1'];
        for (var si = 0; si < preferredSheets.length; si++) {
          if (wb.SheetNames.includes(preferredSheets[si])) { sheetName = preferredSheets[si]; break; }
        }
        var ws = wb.Sheets[sheetName];
        var raw = XLSX.utils.sheet_to_json(ws, {defval:null, header:1});
        var headers = raw[0] ? raw[0].map(function(h){return san(h);}) : [];

        // Detect if first column is 'Cycle' — shift all indices by 1
        var hasCycleCol = headers[0] && san(headers[0]).toLowerCase().includes('cycle');
        var o = hasCycleCol ? 1 : 0; // offset

        // Detect cycle from data if Cycle column exists
        var dataCycle = cycle; // default from filename detection

        // Detect format by headers (after possible offset)
        var isBDQE   = headers.includes('Total Parcel') || headers.includes('Buy Back');
        var isAMDE   = (headers.includes('A-Block') || headers.includes('A-Payment')) && !isBDQE;
        var isAMDESimple = headers.includes('Payment') && !headers.includes('A-Block') && !headers.includes('A BLOCK') && !isBDQE;
        var isGNNT   = headers.includes('A BLOCK') || headers.includes('Present ');

        // Build DSP header-based column map once (handles all BDQE/AMDE/GNNT variants)
        var dc = makeColMap(raw[0]||[], {
          station_code:     ['Station Code','Station','Store'],
          staff_id:         ['ID','Emp ID','Employee ID','Staff ID'],
          name:             ['Name','Employee Name','Staff Name'],
          vehicle_type:     ['Type','Vehicle Type','Vehicle','Pay Type'],
          present_days:     ['Present','Present Days','Present day','Present '],
          block_a:          ['A-Block','A Block','A BLOCK','Block A'],
          block_b:          ['B-Block','B Block','B BLOCK','Block B'],
          block_c:          ['C-Block','C Block','C BLOCK','Block C'],
          block_d:          ['D-Block','D Block','D BLOCK','Block D'],
          block_z:          ['Z-Block','Z Block','Z BLOCK','Block Z'],
          delivery:         ['Delivery','Delivery Parcel'],
          c_return:         ['C Return','C-Return','Return'],
          buy_back:         ['Buy Back','Buyback'],
          total_parcels:    ['Total Parcel','Total Parcels'],
          per_parcel_rate:  ['Per Parcel Rate','Per Parcel','Rate'],
          total_parcel_amt: ['Total Parcel Amt','Total Parcel Amount'],
          payment:          ['Payment','A-Payment','A Payment'],
          incentive:        ['Incentive'],
          gross_payment:    ['Gross Payment','Gross Pay','Gross'],
          debit_note:       ['Debit Note','Debit'],
          net_pay:          ['Net Pay','Net Payment'],
          advance:          ['Advance','Advanced'],
          tds:              ['TDS'],
          bank_transfer:    ['Bank Transfer','Bank transfer RS','Bank Transfer RS'],
          remarks:          ['Remarks','Remark'],
          pan_card:         ['PAN Card','Pan Card','PAN'],
          ifsc_code:        ['IFSC Code','IFSC'],
          account_number:   ['Account Number','Account No','Acc No'],
          tally_ledger:     ['Tally Ledger Name','Tally Ledger'],
          cost_centre:      ['Cost Centre','Cost Center'],
        });

        for (var i = 1; i < raw.length; i++) {
          var r = raw[i];
          if (!r || (r[o] == null && r[o+1] == null)) continue;

          // Extract cycle from data row if cycle col present
          if (hasCycleCol && r[0]) {
            var cv = san(r[0]).toLowerCase();
            if (cv.includes('2nd') || cv.includes('second') || cv === '2') dataCycle = 2;
            else if (cv.includes('1st') || cv.includes('first') || cv === '1') dataCycle = 1;
          }

          // Header-based mapping for all DSP formats — resilient to column shifts
          // Build once before loop (dc = dsp col map)
          var row = {};
          var sid = dc('staff_id') !== null ? parseInt(r[dc('staff_id')]) : null;
          // Fallback: BDQE has no station col, uses filename
          var rowStation = dc('station_code') !== null ? (san(r[dc('station_code')])||station_code) : station_code;
          row = {
            station_code:     rowStation || station_code || 'UNKNOWN',
            staff_id:         sid || null,
            name:             dc('name')           !== null ? san(r[dc('name')])           : null,
            vehicle_type:     dc('vehicle_type')   !== null ? san(r[dc('vehicle_type')])   : null,
            present_days:     dc('present_days')   !== null ? num(r[dc('present_days')])   : null,
            block_a:          dc('block_a')        !== null ? num(r[dc('block_a')])        : 0,
            block_b:          dc('block_b')        !== null ? num(r[dc('block_b')])        : 0,
            block_c:          dc('block_c')        !== null ? num(r[dc('block_c')])        : 0,
            block_d:          dc('block_d')        !== null ? num(r[dc('block_d')])        : 0,
            block_z:          dc('block_z')        !== null ? num(r[dc('block_z')])        : 0,
            delivery:         dc('delivery')       !== null ? num(r[dc('delivery')])       : 0,
            c_return:         dc('c_return')       !== null ? num(r[dc('c_return')])       : 0,
            buy_back:         dc('buy_back')       !== null ? num(r[dc('buy_back')])       : 0,
            total_parcels:    dc('total_parcels')  !== null ? num(r[dc('total_parcels')])  : 0,
            per_parcel_rate:  dc('per_parcel_rate')!== null ? num(r[dc('per_parcel_rate')]): 0,
            total_parcel_amt: dc('total_parcel_amt')!==null ? num(r[dc('total_parcel_amt')]): 0,
            payment:          dc('payment')        !== null ? num(r[dc('payment')])        : 0,
            incentive:        dc('incentive')      !== null ? num(r[dc('incentive')])      : 0,
            gross_payment:    dc('gross_payment')  !== null ? num(r[dc('gross_payment')])  : 0,
            debit_note:       dc('debit_note')     !== null ? num(r[dc('debit_note')])     : 0,
            net_pay:          dc('net_pay')        !== null ? num(r[dc('net_pay')])        : 0,
            advance:          dc('advance')        !== null ? num(r[dc('advance')])        : 0,
            tds:              dc('tds')            !== null ? num(r[dc('tds')])            : 0,
            bank_transfer:    dc('bank_transfer')  !== null ? num(r[dc('bank_transfer')])  : 0,
            remarks:          dc('remarks')        !== null ? san(r[dc('remarks')])        : null,
            pan_card:         dc('pan_card')       !== null ? san(r[dc('pan_card')])       : null,
            ifsc_code:        dc('ifsc_code')      !== null ? san(r[dc('ifsc_code')])      : null,
            account_number:   dc('account_number') !== null ? san(r[dc('account_number')]) : null,
            tally_ledger:     dc('tally_ledger')   !== null ? san(r[dc('tally_ledger')])   : null,
            cost_centre:      dc('cost_centre')    !== null ? san(r[dc('cost_centre')])    : null,
          };

          if (row.staff_id || row.name) rows.push(row);
        }
        // Use dataCycle if derived from data (overrides filename detection)
        cycle = dataCycle;

        // If station not detected from filename, get from first data row
        if (!station_code && rows.length) {
          station_code = rows[0].station_code || 'UNKNOWN';
        }
        // Normalize station codes in all rows to match detected station
        if (station_code && station_code !== 'UNKNOWN') {
          rows.forEach(function(r) {
            if (!r.station_code || r.station_code === 'UNKNOWN') r.station_code = station_code;
          });
        }

        // Detect cycle from filename: -01, _01, Feb-01 → cycle 1; -02, _02, Feb-02 → cycle 2
        var cycle = 1;
        if (/-02|_02/i.test(file.name) || /2nd|second/i.test(file.name)) cycle = 2;

        resolve({rows: rows, month: month || 'unknown', station_code: station_code, cycle: cycle || dataCycle || 1});
      } catch(e) { reject(e); }
    };
    reader.onerror = function() { reject(new Error('Failed to read file')); };
    reader.readAsArrayBuffer(file);
  });
}


// ── Rent history ──────────────────────────────────────────────────────────────
function _rentHistInit() {
  _buildUploadWidget({
    bodyId: 'hist-rent-body',
    desc: 'Upload monthly station rent Excel files. Auto-detects month from filename.',
    checkUrl: '/api/admin/rent-history-check',
    uploadUrl: '/api/admin/upload-rent-history',
    monthsUrl: '/api/admin/rent-history-months',
    parseFile: _rentParseXlsx,
    renderMonths: function(d) {
      return '<table style="width:100%;border-collapse:collapse">' +
        '<thead><tr style="border-bottom:2px solid var(--border);color:var(--text-2);text-align:left">' +
        '<th style="padding:5px 8px">Month</th><th style="padding:5px 8px;text-align:right">Stations</th>' +
        '<th style="padding:5px 8px;text-align:right">Total Payable</th><th style="padding:5px 8px;text-align:right">TDS</th>' +
        '<th style="padding:5px 8px"></th></tr></thead><tbody>' +
        d.map(function(p) { return '<tr style="border-bottom:1px solid var(--border)">' +
          '<td style="padding:6px 8px;font-weight:600;color:var(--navy)">' + escH(p.payment_month) + '</td>' +
          '<td style="padding:6px 8px;text-align:right">' + p.station_count + '</td>' +
          '<td style="padding:6px 8px;text-align:right">₹' + Number(p.total_payable||0).toLocaleString('en-IN',{maximumFractionDigits:0}) + '</td>' +
          '<td style="padding:6px 8px;text-align:right">₹' + Number(p.total_tds||0).toLocaleString('en-IN',{maximumFractionDigits:0}) + '</td>' +
          '<td style="padding:6px 8px"><button class="btn btn-ghost btn-sm" style="color:var(--red-d);font-size:.7rem" onclick="if(confirm(\'Delete all rent data for ' + escH(p.payment_month) + '? This cannot be undone.\'))fetch(\'/api/admin/rent-history/' + escH(p.payment_month) + '\',{method:\'DELETE\'}).then(function(){window[\'hist-rent-body_loadMonths\']();toast(\'Deleted\',\'success\')})">🗑</button></td>' +
          '</tr>'; }).join('') + '</tbody></table>';
    }
  });
}

function _rentParseXlsx(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var wb  = XLSX.read(e.target.result, {type:'array'});
        var ws  = wb.Sheets[wb.SheetNames[0]];
        var raw = XLSX.utils.sheet_to_json(ws, {defval:null, header:1});
        var san = function(v) { return v == null ? null : String(v).split('\r').join('').split('\n').join('').trim() || null; };
        var num = function(v) { return v == null ? null : parseFloat(v) || 0; };
        var rows = [];
        var rc = makeColMap(raw[0]||[], {
          station_code:    ['Station Code','Station'],
          station_name:    ['Station Name','Store Name','Store'],
          inv_number:      ['Invoice Number','Inv No','Inv Number','Invoice No'],
          rent_amount:     ['Rent Amount','Rent','Rent RS'],
          gst:             ['GST','GST Amount'],
          total_rent:      ['Total Rent','Total','Total Amount'],
          tds:             ['TDS'],
          payable_amount:  ['Payable Amount','Payable','Net Payable'],
          shop_owner_name: ['Shop Owner Name','Owner Name','Landlord Name','Owner'],
          account_number:  ['Account Number','Account No','Acc No'],
          ifsc_code:       ['IFSC Code','IFSC'],
          pan_card_number: ['Pan Card Number','PAN','PAN Number'],
          pan_card_name:   ['Pan Card Name','PAN Name','Name on PAN'],
          bank_remarks:    ['Bank Remarks','Bank Narration'],
          remarks:         ['Remarks','Remark'],
          remarks2:        ['Remarks2','Remarks 2'],
          property_type:   ['Property Type','Type'],
          tally_ledger:    ['Tally Ledger Name','Tally Ledger'],
          cost_centre:     ['Cost Centre','Cost Center'],
          cm:              ['CM','Cluster Manager'],
        });
        for (var i = 1; i < raw.length; i++) {
          var r = raw[i];
          var scIdx = rc('station_code'); if (scIdx === null) scIdx = 0;
          if (!r || !r[scIdx]) continue;
          var scVal = san(r[scIdx]);
          if (!scVal) continue;
          rows.push({
            station_code:    scVal.toUpperCase(),
            station_name:    rc('station_name')    !== null ? san(r[rc('station_name')])    : null,
            inv_number:      rc('inv_number')      !== null ? san(r[rc('inv_number')])      : null,
            rent_amount:     rc('rent_amount')     !== null ? num(r[rc('rent_amount')])     : 0,
            gst:             rc('gst')             !== null ? num(r[rc('gst')])             : 0,
            total_rent:      rc('total_rent')      !== null ? num(r[rc('total_rent')])      : 0,
            tds:             rc('tds')             !== null ? num(r[rc('tds')])             : 0,
            payable_amount:  rc('payable_amount')  !== null ? num(r[rc('payable_amount')])  : 0,
            shop_owner_name: rc('shop_owner_name') !== null ? san(r[rc('shop_owner_name')]) : null,
            account_number:  rc('account_number')  !== null ? san(r[rc('account_number')])  : null,
            ifsc_code:       rc('ifsc_code')       !== null ? san(r[rc('ifsc_code')])       : null,
            pan_card_number: rc('pan_card_number') !== null ? san(r[rc('pan_card_number')]) : null,
            pan_card_name:   rc('pan_card_name')   !== null ? san(r[rc('pan_card_name')])   : null,
            bank_remarks:    rc('bank_remarks')    !== null ? san(r[rc('bank_remarks')])    : null,
            remarks:         rc('remarks')         !== null ? san(r[rc('remarks')])         : null,
            remarks2:        rc('remarks2')        !== null ? san(r[rc('remarks2')])        : null,
            property_type:   rc('property_type')   !== null ? san(r[rc('property_type')])   : null,
            tally_ledger:    rc('tally_ledger')    !== null ? san(r[rc('tally_ledger')])    : null,
            cost_centre:     rc('cost_centre')     !== null ? san(r[rc('cost_centre')])     : null,
            cm:              rc('cm')              !== null ? san(r[rc('cm')])              : null,
          });
        }
        // Detect month from filename
        var months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
        var mnames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
        var fname = file.name.toLowerCase();
        var month = null;
        for (var mi = 0; mi < mnames.length; mi++) {
          if (fname.includes(mnames[mi]) || fname.includes(months[mi])) {
            var yr = new Date().getFullYear();
            var curMon = new Date().getMonth();
            var guessYr = mi > curMon ? yr - 1 : yr;
            month = months[mi] + '-' + guessYr; break;
          }
        }
        var total = rows.reduce(function(s,r){return s+(r.payable_amount||0);},0);
        resolve({rows: rows, month: month,
          summary: '<div><span style="color:var(--text-3)">Total Payable:</span> <strong>₹' + total.toLocaleString('en-IN',{maximumFractionDigits:0}) + '</strong></div>'});
      } catch(e) { reject(e); }
    };
    reader.onerror = function() { reject(new Error('Failed to read file')); };
    reader.readAsArrayBuffer(file);
  });
}

// ── Additional Payments history ───────────────────────────────────────────────
function _addlHistInit() {
  _buildUploadWidget({
    bodyId: 'hist-addl-body',
    desc: 'Upload additional payment sheets (IC Advance, EV EMI, Van Payment etc). Uses Sheet1 only.',
    checkUrl: '/api/admin/addl-payments-check',
    uploadUrl: '/api/admin/upload-addl-payments',
    monthsUrl: '/api/admin/addl-payments-months',
    parseFile: _addlParseXlsx,
    renderMonths: function(d) {
      return '<table style="width:100%;border-collapse:collapse">' +
        '<thead><tr style="border-bottom:2px solid var(--border);color:var(--text-2);text-align:left">' +
        '<th style="padding:5px 8px">Month</th><th style="padding:5px 8px;text-align:right">Entries</th>' +
        '<th style="padding:5px 8px;text-align:right">Total Bank Transfer</th><th style="padding:5px 8px;text-align:right">TDS</th>' +
        '<th style="padding:5px 8px"></th></tr></thead><tbody>' +
        d.map(function(p) { return '<tr style="border-bottom:1px solid var(--border)">' +
          '<td style="padding:6px 8px;font-weight:600;color:var(--navy)">' + escH(p.payment_month) + '</td>' +
          '<td style="padding:6px 8px;text-align:right">' + p.entry_count + '</td>' +
          '<td style="padding:6px 8px;text-align:right">₹' + Number(p.total_bank_transfer||0).toLocaleString('en-IN',{maximumFractionDigits:0}) + '</td>' +
          '<td style="padding:6px 8px;text-align:right">₹' + Number(p.total_tds||0).toLocaleString('en-IN',{maximumFractionDigits:0}) + '</td>' +
          '<td style="padding:6px 8px"><button class="btn btn-ghost btn-sm" style="color:var(--red-d);font-size:.7rem" onclick="if(confirm(\'Delete all additional payments for ' + escH(p.payment_month) + '? This cannot be undone.\'))fetch(\'/api/admin/addl-payments/' + escH(p.payment_month) + '\',{method:\'DELETE\'}).then(function(){window[\'hist-addl-body_loadMonths\']();toast(\'Deleted\',\'success\')})">🗑</button></td>' +
          '</tr>'; }).join('') + '</tbody></table>';
    }
  });
}

function _addlParseXlsx(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var wb  = XLSX.read(e.target.result, {type:'array', cellDates:true});
        var ws  = wb.Sheets['Sheet1'] || wb.Sheets[wb.SheetNames[0]];
        var raw = XLSX.utils.sheet_to_json(ws, {defval:null, header:1});
        var san = function(v) { return v == null ? null : String(v).split('\r').join('').split('\n').join('').trim() || null; };
        var num = function(v) { return v == null ? null : parseFloat(v) || 0; };
        var rows = [];
        var monthCount = {};
        var ac = makeColMap(raw[0]||[], {
          sr_no:          ['Sr No','Sr.No','S.No','Serial No','#'],
          payment_date:   ['Payment Date','Date','Pay Date'],
          station_code:   ['Station Code','Station'],
          payment_head:   ['Payment Head','Pay Head','Head','Category'],
          company_name:   ['Company Name','Company','Firm Name'],
          employee_id:    ['Employee ID','Emp ID','IC ID','ID'],
          name:           ['Name','Employee Name'],
          billing_month:  ['Billing Month','Month','Bill Month'],
          inv_number:     ['Invoice Number','Invoice No','Inv No','Inv Number'],
          inv_taxable_amt:['Inv Taxable Amt','Taxable Amount','Taxable Amt'],
          gst:            ['GST','GST Amount'],
          total_inv_amt:  ['Total Inv Amt','Total Invoice Amount','Total Amount','Total'],
          tds_rate:       ['TDS Rate','TDS %'],
          tds:            ['TDS','TDS Amount'],
          actual_amt:     ['Actual Amt','Actual Amount','Net Amount'],
          advance_debit:  ['Advance Debit','Advance','Advance/Debit'],
          bank_transfer:  ['Bank Transfer','Bank transfer RS','Bank Transfer RS'],
          pan_card:       ['Pan Card','PAN','PAN Number'],
          ifsc_code:      ['IFSC Code','IFSC'],
          account_number: ['Account Number','Account No','Acc No'],
          account_name:   ['Account Name','Name on Account','Account Holder'],
          remarks:        ['Remarks','Remark'],
          naisad_remarks: ['Naisad Remarks','NAISAD Remarks','Special Remarks'],
          tally_ledger:   ['Tally Ledger Name','Tally Ledger'],
          cost_centre:    ['Cost Centre','Cost Center'],
        });
        for (var i = 1; i < raw.length; i++) {
          var r = raw[i];
          var srIdx = ac('sr_no'); if (srIdx === null) srIdx = 0;
          if (!r || r[srIdx] == null) continue;
          // Billing month
          var bmIdx = ac('billing_month');
          var bm = bmIdx !== null ? r[bmIdx] : r[7];
          if (bm instanceof Date) bm = bm.toISOString().substring(0,7);
          else bm = san(bm);
          if (bm) monthCount[bm] = (monthCount[bm]||0) + 1;
          // Payment date
          var pdIdx = ac('payment_date');
          var pd = pdIdx !== null ? r[pdIdx] : r[1];
          if (pd instanceof Date) pd = pd.toISOString().substring(0,10);
          else pd = san(pd);
          var scIdx2 = ac('station_code'); var scVal2 = scIdx2 !== null ? san(r[scIdx2]) : null;
          rows.push({
            sr_no:           srIdx !== null        ? parseInt(r[srIdx])||null : null,
            payment_date:    pd,
            station_code:    scVal2 ? scVal2.toUpperCase() : null,
            payment_head:    ac('payment_head')    !== null ? san(r[ac('payment_head')])    : null,
            company_name:    ac('company_name')    !== null ? san(r[ac('company_name')])    : null,
            employee_id:     ac('employee_id')     !== null ? san(r[ac('employee_id')])     : null,
            name:            ac('name')            !== null ? san(r[ac('name')])            : null,
            billing_month:   bm,
            inv_number:      ac('inv_number')      !== null ? san(r[ac('inv_number')])      : null,
            inv_taxable_amt: ac('inv_taxable_amt') !== null ? num(r[ac('inv_taxable_amt')]) : 0,
            gst:             ac('gst')             !== null ? num(r[ac('gst')])             : 0,
            total_inv_amt:   ac('total_inv_amt')   !== null ? num(r[ac('total_inv_amt')])   : 0,
            tds_rate:        ac('tds_rate')        !== null ? num(r[ac('tds_rate')])        : 0,
            tds:             ac('tds')             !== null ? num(r[ac('tds')])             : 0,
            actual_amt:      ac('actual_amt')      !== null ? num(r[ac('actual_amt')])      : 0,
            advance_debit:   ac('advance_debit')   !== null ? num(r[ac('advance_debit')])   : 0,
            bank_transfer:   ac('bank_transfer')   !== null ? num(r[ac('bank_transfer')])   : 0,
            pan_card:        ac('pan_card')        !== null ? san(r[ac('pan_card')])        : null,
            ifsc_code:       ac('ifsc_code')       !== null ? san(r[ac('ifsc_code')])       : null,
            account_number:  ac('account_number')  !== null ? san(r[ac('account_number')])  : null,
            account_name:    ac('account_name')    !== null ? san(r[ac('account_name')])    : null,
            remarks:         ac('remarks')         !== null ? san(r[ac('remarks')])         : null,
            naisad_remarks:  ac('naisad_remarks')  !== null ? san(r[ac('naisad_remarks')])  : null,
            tally_ledger:    ac('tally_ledger')    !== null ? san(r[ac('tally_ledger')])    : null,
            cost_centre:     ac('cost_centre')     !== null ? san(r[ac('cost_centre')])     : null,
          });
        }
        // Detect month from filename first (most reliable), fall back to billing month majority
        var mnames = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
        var mfull  = ['january','february','march','april','may','june','july','august','september','october','november','december'];
        var month = null;
        var fname  = file.name.toLowerCase();
        for (var mi = 0; mi < mfull.length; mi++) {
          if (fname.includes(mfull[mi]) || fname.includes(mnames[mi])) {
            var yr = new Date().getFullYear();
            var curMon = new Date().getMonth();
            var guessYr = mi > curMon ? yr - 1 : yr;
            month = mnames[mi] + '-' + guessYr; break;
          }
        }
        // Fall back to billing month majority if filename gave no hint
        if (!month && Object.keys(monthCount).length) {
          var topYM = Object.entries(monthCount).sort(function(a,b){return b[1]-a[1];})[0][0];
          var parts = topYM.split('-');
          var mi2 = parseInt(parts[1])-1;
          month = mnames[mi2] + '-' + parts[0];
        }
        var total = rows.reduce(function(s,r){return s+(r.bank_transfer||0);},0);
        var heads = [...new Set(rows.map(function(r){return r.payment_head;}).filter(Boolean))];
        resolve({rows: rows, month: month,
          summary: '<div><span style="color:var(--text-3)">Payment heads:</span> <strong>' + heads.join(', ') + '</strong></div>' +
                   '<div><span style="color:var(--text-3)">Total Bank Transfer:</span> <strong>₹' + total.toLocaleString('en-IN',{maximumFractionDigits:0}) + '</strong></div>'});
      } catch(e) { reject(e); }
    };
    reader.onerror = function() { reject(new Error('Failed to read file')); };
    reader.readAsArrayBuffer(file);
  });
}

function _edspDrop(e) {
  e.preventDefault();
  document.getElementById('edsp-dropzone').style.borderColor = 'var(--border)';
  const file = e.dataTransfer.files[0];
  if (file) _edspFileChosen(file);
}

function _edspFileChosen(file) {
  if (!file || !file.name.endsWith('.xlsx')) {
    toast('Please select an .xlsx file', 'warning'); return;
  }
  // Show loading state immediately, then parse async after UI renders
  const preview = document.getElementById('edsp-preview');
  const body    = document.getElementById('edsp-preview-body');
  if (preview) preview.style.display = 'block';
  if (body)    body.innerHTML = '<div style="color:var(--text-3)">📂 Reading file — this may take a few seconds for large files…</div>';
  setTimeout(() => _edspRunPreview(file), 50);
}

// Parse XLSX file in browser using SheetJS, return clean rows array
function _edspParseXlsx(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, {type:'array', cellDates:true});
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, {defval:null});
        const san = v => (v == null ? '' : String(v).replace(/\r/g,'').replace(/\n/g,'').trim());
        const parsed = [];
        for (const row of raw) {
          const ic_id        = parseInt(row['ID']) || null;
          const ic_name      = san(row['NAME '] || row['Name'] || row['NAME']);
          const amx_id       = san(row['holder_employee_id']);
          const station_code = san(row['station_code']).toUpperCase();
          const shipType     = san(row['shipment_type']);
          let dDate = row['report_date'];
          if (dDate instanceof Date) {
            // Use local date parts to avoid UTC timezone shift
            const y = dDate.getFullYear();
            const m = String(dDate.getMonth()+1).padStart(2,'0');
            const d2 = String(dDate.getDate()).padStart(2,'0');
            dDate = y+'-'+m+'-'+d2;
          } else dDate = san(dDate).substring(0,10);
          if (!dDate || dDate === '0000-00-00' || !station_code || !amx_id) continue;
          let parcel_type = shipType === 'Delivery' ? 'Delivery'
                          : shipType === 'ReturnPickup' ? 'ReturnPickup'
                          : shipType === 'MFNPickup'    ? 'MFNPickup'
                          : (shipType || 'Delivery');
          parsed.push({
            ic_id, ic_name, amx_id, station_code, dDate, parcel_type,
            delivered: parseInt(row['final_delivery_count_excluding_swa_smd_smd2.0']) || 0,
            pickup:    parseInt(row['final_creturn_count']) || 0,
            swa:       parseInt(row['overall_delivered_swa']) || 0,
            smd:       parseInt(row['overall_delivered_smd2.0']) || 0,
            mfn:       parseInt(row['final_mfn_count']) || 0,
            returns:   parseInt(row['final_seller_returns']) || 0
          });
        }
        resolve(parsed);
      } catch(e) { reject(e); }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

async function _edspRunPreview(file) {
  const preview = document.getElementById('edsp-preview');
  const body    = document.getElementById('edsp-preview-body');
  const result  = document.getElementById('edsp-result');
  if (result) result.style.display = 'none';

  preview.style.display = 'block';

  try {
    const parsed = await _edspParseXlsx(file);
    _edspPendingFile = parsed; // store parsed rows, not raw file

    const r = await fetch('/api/admin/upload-historical-edsp', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({rows: parsed, preview: true})
    });
    const d = await r.json();
    if (!d.ok) { body.innerHTML = `<span style="color:var(--red-d)">Error: ${escH(d.error)}</span>`; return; }
    _edspPreviewData = d;

    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 20px">
        <div><span style="color:var(--text-3)">Period label:</span> <strong>${escH(d.period_label)}</strong></div>
        <div><span style="color:var(--text-3)">Date range:</span> <strong>${d.date_from} → ${d.date_to}</strong></div>
        <div><span style="color:var(--text-3)">Rows to insert:</span> <strong>${d.rows}</strong></div>
        <div><span style="color:var(--text-3)">Unique ICs:</span> <strong>${d.ic_count}</strong></div>
        <div style="grid-column:1/-1"><span style="color:var(--text-3)">Stations (${d.stations.length}):</span>
          <span style="font-family:monospace;font-size:.75rem">${d.stations.join(', ')}</span>
        </div>
      </div>
      <div style="margin-top:10px;padding:8px 12px;background:var(--amber-l,#fff8e1);border-radius:8px;color:var(--amber-d,#b45309);font-size:.75rem">
        ⚠ KMS will be set to 0 for all rows. Upload the KMS file separately to patch values.
      </div>`;
  } catch(e) {
    body.innerHTML = `<span style="color:var(--red-d)">Error: ${e.message}</span>`;
  }
}

async function _edspConfirmUpload() {
  if (!_edspPendingFile || !_edspPreviewData) return;
  const btn = document.getElementById('edsp-confirm-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Uploading…'; }

  // Show row count so user knows it's working
  const body = document.getElementById('edsp-preview-body');
  if (body) body.innerHTML += `<div style="margin-top:8px;color:var(--text-3);font-size:.75rem">
    ⏳ Sending ${_edspPendingFile.length.toLocaleString()} rows to server — please wait…</div>`;

  const result  = document.getElementById('edsp-result');
  const preview = document.getElementById('edsp-preview');

  // Poll for completion — server may take 30-60s for large files
  // Use a keep-alive ping approach: send data, poll status
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 120000); // 2 min max

  try {
    const r = await fetch('/api/admin/upload-historical-edsp', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({rows: _edspPendingFile}),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    let d;
    try { d = await r.json(); }
    catch(je) {
      // Server returned non-JSON — show raw text
      const txt = await r.text().catch(()=>'');
      preview.style.display = 'none';
      result.style.display = 'block';
      result.innerHTML = `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:14px;color:var(--red-d)">
        ❌ Server error (${r.status}): ${escH(txt.substring(0,300))}</div>`;
      if (btn) { btn.disabled = false; btn.textContent = '✓ Confirm Upload'; }
      return;
    }

    preview.style.display = 'none';
    result.style.display = 'block';

    if (d.ok) {
      _edspReset();
      if (d.accepted) {
        // Fire-and-forget mode — server is processing in background
        result.innerHTML = `
          <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:14px">
            <div style="font-weight:600;color:#15803d;margin-bottom:6px">✅ Upload accepted — processing ${d.rows.toLocaleString()} rows in background</div>
            <div style="color:var(--text-3);margin-top:6px">Period: <strong>${escH(d.period_label)}</strong> — data will appear below in ~30 seconds</div>
          </div>`;
        // Poll every 5s for up to 2 mins
        let polls = 0;
        const pollTimer = setInterval(async () => {
          polls++;
          await _edspLoadPeriods();
          const el = document.getElementById('edsp-periods-list');
          const found = el && el.innerHTML.includes(d.period_label);
          if (found || polls >= 24) clearInterval(pollTimer);
        }, 5000);
      } else {
        result.innerHTML = `
          <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:14px">
            <div style="font-weight:600;color:#15803d;margin-bottom:6px">✅ Upload successful</div>
            <div>Period: <strong>${escH(d.period_label)}</strong> &nbsp;|&nbsp;
                 Inserted: <strong>${d.inserted}</strong> rows</div>
          </div>`;
        _edspLoadPeriods();
      }
    } else {
      result.innerHTML = `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:14px;color:var(--red-d)">
        ❌ Error: ${escH(d.error||'Unknown error')}</div>`;
      if (btn) { btn.disabled = false; btn.textContent = '✓ Confirm Upload'; }
    }
  } catch(e) {
    clearTimeout(timeoutId);
    preview.style.display = 'none';
    result.style.display = 'block';
    const isTimeout = e.name === 'AbortError';
    result.innerHTML = `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:14px;color:var(--red-d)">
      ${isTimeout
        ? '⏱ Upload timed out after 2 minutes. Check "Uploaded Historical Periods" below — data may have been saved. <button class="btn btn-ghost btn-sm" onclick="_edspLoadPeriods()">Check now</button>'
        : '❌ Upload failed: ' + escH(e.message)
      }</div>`;
    if (btn) { btn.disabled = false; btn.textContent = '✓ Confirm Upload'; }
    if (isTimeout) _edspLoadPeriods();
  }
}

function _edspReset() {
  _edspPendingFile = null;
  _edspPreviewData = null;
  const fi = document.getElementById('edsp-file-input');
  if (fi) fi.value = '';
  _edspPendingFile = null;
  const preview = document.getElementById('edsp-preview');
  if (preview) preview.style.display = 'none';
}

async function _edspLoadPeriods() {
  const el = document.getElementById('edsp-periods-list') || document.getElementById('hist-kms-list');
  if (!el) return;
  try {
    const r = await fetch('/api/admin/historical-edsp-periods', {credentials:'include'});
    const d = await r.json();
    if (!d.length) { el.innerHTML = '<div style="color:var(--text-3);padding:8px 0">No historical data uploaded yet.</div>'; return; }

    // FY tabs for KMS
    var allFYsKms = _getFYList(d.map(function(p){ return p.period_label; }));
    if (!_histFY['kms']) _histFY['kms'] = allFYsKms[0];
    var activeFYkms = _histFY['kms'];
    var filteredD = d.filter(function(p){ return _monthToFY(p.period_label) === activeFYkms; });
    var fyTabsHtml = _renderFYTabs('kms', allFYsKms, activeFYkms, _switchFY);

    // Check which base months have both -a and -b available for rollup
    const labels = new Set(filteredD.map(p => p.period_label));
    const rollupReady = new Set(
      filteredD.map(p => p.period_label)
        .filter(l => l.endsWith('-a'))
        .map(l => l.slice(0, -2))
        .filter(base => labels.has(base + '-b'))
    );

    el.innerHTML = fyTabsHtml + `
      <table style="width:100%;font-size:.78rem;border-collapse:collapse">
        <thead>
          <tr style="border-bottom:2px solid var(--border)">
            <th style="padding:6px 10px;color:var(--text-2);text-align:left">Period</th>
            <th style="padding:6px 10px;color:var(--text-2);text-align:left">Date Range</th>
            <th style="padding:6px 10px;color:var(--text-2);text-align:right">Rows</th>
            <th style="padding:6px 10px;color:var(--text-2);text-align:right">Stations</th>
            <th style="padding:6px 10px;color:var(--text-2);text-align:right">ICs</th>
            <th style="padding:6px 10px;color:var(--text-2);text-align:right">Total KMs</th>
            <th style="padding:6px 10px;text-align:right">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filteredD.map(p => {
            const base = p.period_label.replace(/-[ab]$/, '');
            const canRollup = p.period_label.endsWith('-a') && rollupReady.has(base);
            return `
            <tr style="border-bottom:1px solid var(--border)">
              <td style="padding:8px 10px;font-weight:600;color:var(--navy)">${escH(p.period_label)}</td>
              <td style="padding:8px 10px;color:var(--text-2)">${p.date_from||'—'} → ${p.date_to||'—'} ${!p.has_override ? '<span style="font-size:.68rem;color:var(--amber-d);font-style:italic">(auto)</span>' : ''}</td>
              <td style="padding:8px 10px;text-align:right">${Number(p.total_rows||p.rows||0).toLocaleString()}</td>
              <td style="padding:8px 10px;text-align:right">${p.stations}</td>
              <td style="padding:8px 10px;text-align:right">${p.ics||'—'}</td>
              <td style="padding:8px 10px;text-align:right;font-weight:600">${p.total_kms ? Number(p.total_kms).toLocaleString('en-IN') : '—'}</td>
              <td style="padding:8px 10px;text-align:right;white-space:nowrap">
                <button class="btn btn-ghost btn-sm" style="font-size:.7rem;margin-right:4px;color:${p.has_override?'var(--green-d)':'var(--text-3)'}"
                  title="${p.has_override?'Edit date range (currently set)':'Set date range for this period'}"
                  onclick="_edspSetPeriodDates('${escH(p.period_label)}','${p.date_from||''}','${p.date_to||''}',${!!p.has_override})">📅</button>
                <button class="btn btn-ghost btn-sm" style="font-size:.7rem;margin-right:4px"
                  onclick="_histReview('kms','${escH(p.period_label)}')">👁 Review</button>
                ${canRollup ? `<button class="btn btn-ghost btn-sm" style="color:var(--green-d);margin-right:4px"
                  onclick="event.stopPropagation();_edspRollup('${escH(base)}')" title="Merge -a and -b into ${escH(base)}">⟳ Roll up</button>` : ''}
                <button class="btn btn-ghost btn-sm" style="color:var(--red-d)"
                  onclick="_edspDeletePeriod('${escH(p.period_label)}')">🗑</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  } catch(e) {
    el.innerHTML = '<span style="color:var(--red-d)">Error loading periods</span>';
  }
}

// ── View period detail ────────────────────────────────────
let _edspViewCurrent = null;
async function _edspViewPeriod(period) {
  _edspViewCurrent = period;
  // Show modal
  let modal = document.getElementById('edsp-view-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'edsp-view-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
    modal.innerHTML = `
      <div style="background:var(--card);border-radius:14px;width:100%;max-width:900px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.25)">
        <div style="display:flex;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border)">
          <div style="font-weight:700;font-size:1rem;color:var(--navy)" id="edsp-modal-title">Loading…</div>
          <div style="margin-left:auto;display:flex;gap:8px">
            <select id="edsp-modal-station" style="padding:5px 10px;font-size:.78rem;border-radius:6px;border:1px solid var(--border)" onchange="_edspModalFilter()">
              <option value="">All Stations</option>
            </select>
            <button class="btn btn-ghost btn-sm" onclick="document.getElementById('edsp-view-modal').remove()">✕ Close</button>
          </div>
        </div>
        <div style="overflow:auto;flex:1;padding:16px">
          <div id="edsp-modal-body" style="font-size:.75rem"></div>
        </div>
        <div style="padding:12px 20px;border-top:1px solid var(--border);font-size:.75rem;color:var(--text-3)" id="edsp-modal-footer"></div>
      </div>`;
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  document.getElementById('edsp-modal-title').textContent = 'Loading ' + period + '…';
  document.getElementById('edsp-modal-body').innerHTML = '<div style="color:var(--text-3);padding:20px;text-align:center">Loading…</div>';

  const station = (document.getElementById('edsp-modal-station') ? document.getElementById('edsp-modal-station').value : '') || '';
  const qp = new URLSearchParams({period});
  if (station) qp.set('station', station);

  try {
    const r = await fetch('/api/admin/historical-edsp-detail?' + qp, {credentials:'include'});
    const d = await r.json();

    document.getElementById('edsp-modal-title').textContent = '📋 ' + period + ' — ' + d.rows.length.toLocaleString() + ' rows';
    document.getElementById('edsp-modal-footer').textContent = `Showing ${d.rows.length.toLocaleString()} rows · ${d.stations.length} stations · Click row to expand`;

    // Populate station filter
    const sel = document.getElementById('edsp-modal-station');
    if (sel && sel.options.length === 1) {
      d.stations.forEach(s => sel.innerHTML += `<option value="${escH(s)}">${escH(s)}</option>`);
    }

    // Group by station for display
    const byStation = {};
    d.rows.forEach(r => {
      if (!byStation[r.station_code]) byStation[r.station_code] = [];
      byStation[r.station_code].push(r);
    });

    const body = document.getElementById('edsp-modal-body');
    body.innerHTML = Object.entries(byStation).map(([sc, rows]) => `
      <div style="margin-bottom:16px">
        <div style="font-weight:600;color:var(--navy);padding:4px 0;border-bottom:1px solid var(--border);margin-bottom:4px">
          📍 ${escH(sc)} <span style="font-weight:400;color:var(--text-3)">(${rows.length} rows)</span>
        </div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="color:var(--text-3)">
            <th style="text-align:left;padding:3px 8px">Date</th>
            <th style="text-align:left;padding:3px 8px">AMX ID</th>
            <th style="text-align:left;padding:3px 8px">IC Name</th>
            <th style="text-align:left;padding:3px 8px">Type</th>
            <th style="text-align:right;padding:3px 8px">Del</th>
            <th style="text-align:right;padding:3px 8px">Ret</th>
            <th style="text-align:right;padding:3px 8px">SWA</th>
            <th style="text-align:right;padding:3px 8px">MFN</th>
            <th style="text-align:right;padding:3px 8px">KMS</th>
          </tr></thead>
          <tbody>
            ${rows.map(r => `<tr style="border-bottom:1px solid var(--border)" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
              <td style="padding:3px 8px;font-family:monospace">${r.delivery_date||''}</td>
              <td style="padding:3px 8px;font-family:monospace;font-size:.7rem">${escH(r.amx_id||'')}</td>
              <td style="padding:3px 8px">${escH(r.ic_name||'—')}</td>
              <td style="padding:3px 8px"><span style="font-size:.7rem;padding:1px 5px;background:var(--bg);border-radius:4px">${escH(r.parcel_type||'')}</span></td>
              <td style="padding:3px 8px;text-align:right">${r.delivered||0}</td>
              <td style="padding:3px 8px;text-align:right">${r.pickup||0}</td>
              <td style="padding:3px 8px;text-align:right">${r.swa||0}</td>
              <td style="padding:3px 8px;text-align:right">${r.mfn||0}</td>
              <td style="padding:3px 8px;text-align:right">${r.kms||0}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`).join('');
  } catch(e) {
    document.getElementById('edsp-modal-body').innerHTML = `<div style="color:var(--red-d);padding:20px">Error: ${e.message}</div>`;
  }
}

function _edspModalFilter() { if (_edspViewCurrent) _edspViewPeriod(_edspViewCurrent); }

async function _edspRollup(base) {
  if (!confirm(`Merge ${base}-a and ${base}-b into ${base}? This combines both halves into one period.`)) return;
  try {
    const r = await fetch('/api/admin/edsp-rollup', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({month: base})
    });
    const d = await r.json();
    if (d.ok) { toast(`Rolled up to ${d.rolled_up_to} ✓`, 'success'); _edspLoadPeriods(); }
    else toast('Error: ' + d.error, 'error');
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

async function _edspDeletePeriod(period) {
  if (!confirm(`Delete ALL data for period "${period}"? This cannot be undone.`)) return;
  try {
    const r = await fetch(`/api/admin/historical-edsp/${encodeURIComponent(period)}`, {method:'DELETE'});
    const d = await r.json();
    if (d.ok) {
      toast(`Cleared ${d.log_amx_deleted} rows for ${period}`, 'success');
      _edspLoadPeriods();
    } else {
      toast('Error: ' + d.error, 'error');
    }
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}


// ── Review Modal ──────────────────────────────────────────────────────────────
var _histReviewAllRows = [];
var _histReviewHeaders = [];

async function _histReview(type, key) {
  var modal = document.getElementById('hist-review-modal');
  var title = document.getElementById('hist-review-title');
  var thead = document.getElementById('hist-review-thead');
  var tbody = document.getElementById('hist-review-tbody');
  var count = document.getElementById('hist-review-count');
  var search = document.getElementById('hist-review-search');
  if (!modal) return;
  modal.style.display = 'flex';
  if (search) search.value = '';
  tbody.innerHTML = '<tr><td colspan="99" style="text-align:center;padding:20px;color:var(--text-3)">Loading…</td></tr>';

  var typeLabels = {'kms':'KMS/EDSP','payroll':'EDSP Payroll','dsp-payroll':'DSP Payroll','rent':'Rent','addl':'Additional Payments'};
  if (title) title.textContent = (typeLabels[type]||type) + ' — ' + key;

  try {
    var rows = [], headers = [];
    if (type === 'kms') {
      var r = await fetch('/api/admin/historical-edsp-detail?period=' + encodeURIComponent(key), {credentials:'include'});
      var d = await r.json();
      headers = ['Station','AMX ID','IC Name','Date','Type','Delivered','Pickup','SWA','SMD','MFN','Returns','KMS'];
      rows = d.rows.map(function(r) { return [r.station_code,r.amx_id,r.ic_name,r.delivery_date,r.parcel_type,r.delivered,r.pickup,r.swa,r.smd,r.mfn,r.returns,r.kms]; });
    } else if (type === 'payroll') {
      var r2 = await fetch('/api/admin/payroll-history-detail?month=' + encodeURIComponent(key), {credentials:'include'});
      var d2 = await r2.json();
      headers = ['Station','ID','Head','Name','Present','W/Off','Total','Delivery','Pickup','SWA','SMD','MFN','Sel.Ret','Parcels','Payment','Incentive','Gross','Debit','Net Pay','Advance','TDS','Bank Trf','CTC','Type','Petrol','PAN','User Type','CM'];
      rows = d2.map(function(r) { return [r.station_code,r.staff_id,r.head,r.name,r.present_days,r.week_off,r.total_days,r.delivery,r.pickup,r.swa,r.smd,r.mfn,r.seller_returns,r.total_parcels,r.payment,r.incentive,r.gross_payment,r.debit_note,r.net_pay,r.advance,r.tds,r.bank_transfer,r.ctc,r.pay_type,r.petrol,r.pan_card,r.user_type,r.cluster_manager]; });
    } else if (type === 'dsp-payroll') {
      var parts = key.split('/');
      var r3 = await fetch('/api/admin/dsp-payroll-detail?month=' + encodeURIComponent(parts[0]) + '&station=' + encodeURIComponent(parts[1]) + '&cycle=' + encodeURIComponent(parts[2]||1), {credentials:'include'});
      var d3 = await r3.json();
      headers = ['Station','ID','Name','Type','Cycle','A','B','C','D','Z','Payment','Incentive','Gross','Debit','Net Pay','Advance','TDS','Bank Trf','PAN','IFSC','Account'];
      rows = d3.map(function(r) { return [r.station_code,r.staff_id,r.name,r.vehicle_type,r.cycle,r.block_a,r.block_b,r.block_c,r.block_d,r.block_z,r.payment,r.incentive,r.gross_payment,r.debit_note,r.net_pay,r.advance,r.tds,r.bank_transfer,r.pan_card,r.ifsc_code,r.account_number]; });
    } else if (type === 'petrol') {
      var rp = await fetch('/api/admin/petrol-detail?batch=' + encodeURIComponent(key), {credentials:'include'});
      var dp = await rp.json();
      headers = ['Station','Store','ID','Name','Del','Pick','SWA','SMD','MFN','Ret','Parcels','KM','Per KM','Petrol RS','Advance','Bank Trf','Per Parcel','Account','IFSC','CM','Type'];
      rows = dp.map(function(r) { return [r.station_code,r.store_name,r.staff_id,r.name,r.delivered,r.pickup,r.swa,r.smd,r.mfn,r.seller_return,r.total_parcels,r.total_km,r.per_km_rate,r.total_petrol_rs,r.advance_petrol,r.total_bank_transfer,r.per_parcel_cost,r.account_number,r.ifsc_code,r.cm,r.user_type]; });
    } else if (type === 'rent') {
      var r4 = await fetch('/api/admin/rent-history-detail?month=' + encodeURIComponent(key), {credentials:'include'});
      var d4 = await r4.json();
      headers = ['Station','Station Name','Inv#','Rent','GST','Total','TDS','Payable','Owner','Account','IFSC','PAN','Property','CM'];
      rows = d4.map(function(r) { return [r.station_code,r.station_name,r.inv_number,r.rent_amount,r.gst,r.total_rent,r.tds,r.payable_amount,r.shop_owner_name,r.account_number,r.ifsc_code,r.pan_card_number,r.property_type,r.cm]; });
    } else if (type === 'bank') {
      var r5b = await fetch('/api/admin/bank-payment-detail?batch=' + encodeURIComponent(key), {credentials:'include'});
      var d5b = await r5b.json();
      headers = ['Date','Category','Mode','Beneficiary','Account No','IFSC','Amount','Purpose','Debit Narr','Mobile','Remark'];
      rows = d5b.map(function(r) { return [r.payment_date,r.payment_category,r.pymt_mode,r.debit_narr,r.bene_acc_no,r.bene_ifsc,r.amount,r.bnf_name,r.credit_narr,r.mobile_num,r.remark]; });
    } else if (type === 'addl') {
      var r5 = await fetch('/api/admin/addl-payments-detail?month=' + encodeURIComponent(key), {credentials:'include'});
      var d5 = await r5.json();
      headers = ['#','Date','Station','Head','Company','Emp ID','Name','Billing Month','Inv#','Taxable','GST','Total','TDS Rate','TDS','Actual','Adv/Deb','Bank Trf','PAN','IFSC','Account'];
      rows = d5.map(function(r) { return [r.sr_no,r.payment_date,r.station_code,r.payment_head,r.company_name,r.employee_id,r.name,r.billing_month,r.inv_number,r.inv_taxable_amt,r.gst,r.total_inv_amt,r.tds_rate,r.tds,r.actual_amt,r.advance_debit,r.bank_transfer,r.pan_card,r.ifsc_code,r.account_number]; });
    }

    _histReviewAllRows = rows;
    _histReviewHeaders = headers;
    _histRenderReview(rows, headers);
    if (count) count.textContent = rows.length + ' rows';
  } catch(e) {
    tbody.innerHTML = '<tr><td colspan="99" style="text-align:center;color:var(--red-d);padding:20px">Error: ' + e.message + '</td></tr>';
  }
}

function _histRenderReview(rows, headers) {
  var thead = document.getElementById('hist-review-thead');
  var tbody = document.getElementById('hist-review-tbody');
  var count = document.getElementById('hist-review-count');
  if (thead) thead.innerHTML = '<tr>' + (headers||_histReviewHeaders).map(function(h){return '<th>'+escH(h)+'</th>';}).join('') + '</tr>';
  if (tbody) tbody.innerHTML = (rows||_histReviewAllRows).map(function(row) {
    return '<tr>' + row.map(function(v){return '<td>' + escH(v==null?'—':String(v)) + '</td>';}).join('') + '</tr>';
  }).join('');
  if (count) count.textContent = (rows||_histReviewAllRows).length + ' rows';
}

function _histReviewSearch(q) {
  if (!q) { _histRenderReview(_histReviewAllRows, _histReviewHeaders); return; }
  var ql = q.toLowerCase();
  var filtered = _histReviewAllRows.filter(function(row) {
    return row.some(function(v){ return v != null && String(v).toLowerCase().includes(ql); });
  });
  _histRenderReview(filtered, _histReviewHeaders);
}

// ── Direct list loaders for rent and addl strips ──────────────────────────────
async function _rentLoadListDirect() {
  var el = document.getElementById('hist-rent-list');
  if (!el) return;
  try {
    var r = await fetch('/api/admin/rent-history-months', {credentials:'include'});
    var d = await r.json();
    var totalPay = d.reduce(function(s,p){return s+(parseFloat(p.total_payable)||0);},0);
    var stats = '<span><strong>'+d.length+'</strong> months</span><span>Total Payable: <strong>'+_fmtAmt(totalPay)+'</strong></span>';
    var cols = [{label:'Month'},{label:'Stations',right:true},{label:'Payable',right:true},{label:'TDS',right:true},{label:'Actions',html:true}];
    var rows = d.map(function(p) {
      return [p.payment_month, p.station_count, _fmtAmt(p.total_payable), _fmtAmt(p.total_tds),
        '<span style="white-space:nowrap"><button class="btn btn-ghost btn-sm" style="font-size:.7rem;margin-right:4px" data-m="'+escH(p.payment_month)+'" data-type="rent" onclick="_histReview(this.dataset.type,this.dataset.m)">👁 Review</button><button class="btn btn-ghost btn-sm" style="color:var(--red-d);font-size:.7rem" data-m="'+encodeURIComponent(p.payment_month)+'" onclick="_histDeleteRent(this.dataset.m)">🗑</button></span>'];
    });
    var fyResult = _filterRowsByFY(rows, d, 'rent', function(item){ return item.payment_month; });
    _histRenderList('rent', el, fyResult.rows, cols, stats, null, fyResult.fyHtml);
    var tbody = el.querySelector('tbody');
    var fyD = d.filter(function(item){ return _monthToFY(item.payment_month) === (_histFY['rent'] || (fyResult.allFYs||[])[0]); });
    if (tbody) Array.from(tbody.querySelectorAll('tr')).forEach(function(tr,i){if(fyD[i])tr.cells[0].innerHTML=_monthBadge(fyD[i].payment_month);});
  } catch(e) { el.innerHTML = '<span style="color:var(--red-d)">Error: '+e.message+'</span>'; }
}

async function _addlLoadListDirect() {
  var el = document.getElementById('hist-addl-list');
  if (!el) return;
  try {
    var r = await fetch('/api/admin/addl-payments-months', {credentials:'include'});
    var d = await r.json();
    var totalBank = d.reduce(function(s,p){return s+(parseFloat(p.total_bank_transfer)||0);},0);
    var stats = '<span><strong>'+d.length+'</strong> months</span><span>Bank Transfer total: <strong>'+_fmtAmt(totalBank)+'</strong></span>';
    var cols = [{label:'Month'},{label:'Entries',right:true},{label:'Bank Transfer',right:true},{label:'TDS',right:true},{label:'Actions',html:true}];
    var rows = d.map(function(p) {
      return [p.payment_month, p.entry_count, _fmtAmt(p.total_bank_transfer), _fmtAmt(p.total_tds),
        '<span style="white-space:nowrap"><button class="btn btn-ghost btn-sm" style="font-size:.7rem;margin-right:4px" data-m="'+escH(p.payment_month)+'" data-type="addl" onclick="_histReview(this.dataset.type,this.dataset.m)">👁 Review</button><button class="btn btn-ghost btn-sm" style="color:var(--red-d);font-size:.7rem" data-m="'+encodeURIComponent(p.payment_month)+'" onclick="_histDeleteAddl(this.dataset.m)">🗑</button></span>'];
    });
    var fyResult = _filterRowsByFY(rows, d, 'addl', function(item){ return item.payment_month; });
    _histRenderList('addl', el, fyResult.rows, cols, stats, null, fyResult.fyHtml);
    var tbody = el.querySelector('tbody');
    var fyD = d.filter(function(item){ return _monthToFY(item.payment_month) === (_histFY['addl'] || (fyResult.allFYs||[])[0]); });
    if (tbody) Array.from(tbody.querySelectorAll('tr')).forEach(function(tr,i){if(fyD[i])tr.cells[0].innerHTML=_monthBadge(fyD[i].payment_month);});
  } catch(e) { el.innerHTML = '<span style="color:var(--red-d)">Error: '+e.message+'</span>'; }
}

async function _addlLoadListDirect() {
  var el = document.getElementById('hist-addl-list');
  if (!el) return;
  try {
    var r = await fetch('/api/admin/addl-payments-months', {credentials:'include'});
    var d = await r.json();
    if (!d.length) { el.innerHTML = '<div style="color:var(--text-3);padding:10px 14px">No additional payments data uploaded yet.</div>'; return; }
    var html = '<table style="width:100%;border-collapse:collapse;font-size:.78rem">' +
      '<thead><tr style="border-bottom:2px solid var(--border);color:var(--text-2);background:var(--bg)">' +
      '<th style="padding:6px 12px">Month</th><th style="padding:6px 12px;text-align:right">Entries</th>' +
      '<th style="padding:6px 12px;text-align:right">Bank Transfer</th><th style="padding:6px 12px;text-align:right">TDS</th>' +
      '<th style="padding:6px 12px"></th></tr></thead><tbody>';
    d.forEach(function(p) {
      html += '<tr style="border-bottom:1px solid var(--border)">' +
        '<td style="padding:7px 12px;font-weight:600;color:var(--navy)">' + escH(p.payment_month) + '</td>' +
        '<td style="padding:7px 12px;text-align:right">' + p.entry_count + '</td>' +
        '<td style="padding:7px 12px;text-align:right">₹' + Number(p.total_bank_transfer||0).toLocaleString('en-IN',{maximumFractionDigits:0}) + '</td>' +
        '<td style="padding:7px 12px;text-align:right">₹' + Number(p.total_tds||0).toLocaleString('en-IN',{maximumFractionDigits:0}) + '</td>' +
        '<td style="padding:7px 12px;white-space:nowrap">' +
        '<button class="btn btn-ghost btn-sm" style="font-size:.7rem;margin-right:4px" onclick="_histReview(\'addl\',\'' + escH(p.payment_month) + '\')">👁 Review</button>' +
        '<button class="btn btn-ghost btn-sm" style="color:var(--red-d);font-size:.7rem" ' +
        'onclick="if(confirm(\'Delete additional payments for ' + escH(p.payment_month) + '?\'))fetch(\'/api/admin/addl-payments/' + encodeURIComponent(p.payment_month) + '\',{method:\'DELETE\'}).then(function(){_addlLoadListDirect();toast(\'Deleted\',\'success\')})">🗑</button>' +
        '</td></tr>';
    });
    html += '</tbody></table>';
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<span style="color:var(--red-d)">Error: ' + e.message + '</span>'; }
}

// ── Delete helpers (avoid inline confirm quote issues) ────────────────────────
async function _histDeleteRent(month) {
  _showConfirmModal(
    '🗑 Delete Rent Data',
    'Delete rent data for ' + decodeURIComponent(month) + '? This cannot be undone.',
    'Delete', 'var(--red-d)',
    async function() {
      try {
        var r = await fetch('/api/admin/rent-history/'+month, {method:'DELETE'});
        var d = await r.json();
        if (d.ok) { _showResultModal('✅ Deleted', 'Rent data deleted.', 'success'); _rentLoadListDirect(); }
        else _showResultModal('❌ Error', d.error||'Delete failed', 'error');
      } catch(e) { _showResultModal('❌ Error', e.message, 'error'); }
    }
  );
}
async function _histDeleteAddl(month) {
  _showConfirmModal(
    '🗑 Delete Additional Payments',
    'Delete additional payments for ' + decodeURIComponent(month) + '? This cannot be undone.',
    'Delete', 'var(--red-d)',
    async function() {
      try {
        var r = await fetch('/api/admin/addl-payments/'+month, {method:'DELETE'});
        var d = await r.json();
        if (d.ok) { _showResultModal('✅ Deleted', 'Additional payments deleted.', 'success'); _addlLoadListDirect(); }
        else _showResultModal('❌ Error', d.error||'Delete failed', 'error');
      } catch(e) { _showResultModal('❌ Error', e.message, 'error'); }
    }
  );
}

function _histReviewDsp(month, station, cycle) {
  _histReview('dsp-payroll', month + '/' + station + '/' + cycle);
}

// ── Bank Payments ─────────────────────────────────────────────────────────────
function _histInjectBankUpload(container) {
  container.innerHTML =
    '<div style="font-size:.78rem;color:var(--text-3);margin-bottom:6px">Upload bank payment files sent to HDFC. All 19 columns preserved. Payment category auto-detected from BNF_NAME column.</div>' +
    '<div style="font-size:.75rem;background:#dbeafe;color:#1e40af;border-radius:6px;padding:6px 10px;margin-bottom:14px">ℹ Supports any bank file with the standard 19-col format. Multiple files upload to same batch date.</div>' +
    '<div id="bank-dropzone" style="border:2px dashed var(--border);border-radius:12px;padding:28px;text-align:center;cursor:pointer;margin-bottom:14px">' +
    '<div style="font-size:1.8rem;margin-bottom:6px">🏦</div>' +
    '<div style="font-size:.85rem;font-weight:600;color:var(--navy)">Drop Bank File Excel here or click to browse</div>' +
    '<div style="font-size:.73rem;color:var(--text-3);margin-top:4px">Bank_File_DD-MM-YYYY_SLLPT.xlsx format</div>' +
    '<input type="file" id="bank-file-input" accept=".xlsx" style="display:none"></div>' +
    '<div id="bank-preview" style="display:none;background:var(--bg);border-radius:10px;padding:14px;margin-bottom:14px;font-size:.82rem">' +
    '<div style="font-weight:600;color:var(--navy);margin-bottom:10px">📋 Preview</div>' +
    '<div id="bank-preview-body"></div>' +
    '<div style="display:flex;gap:8px;margin-top:12px">' +
    '<button class="btn btn-ghost btn-sm" id="bank-cancel-btn">✕ Cancel</button>' +
    '<button class="btn btn-green btn-sm" id="bank-confirm-btn">✓ Confirm Upload</button></div></div>' +
    '<div id="bank-result" style="display:none;font-size:.82rem"></div>';

  var dz = document.getElementById('bank-dropzone');
  var fi = document.getElementById('bank-file-input');
  if (dz) {
    dz.addEventListener('click', function() { fi && fi.click(); });
    dz.addEventListener('dragover', function(e) { e.preventDefault(); dz.style.borderColor='var(--navy)'; });
    dz.addEventListener('dragleave', function() { dz.style.borderColor='var(--border)'; });
    dz.addEventListener('drop', function(e) { e.preventDefault(); dz.style.borderColor='var(--border)'; if(e.dataTransfer.files[0]) _bankFileChosen(e.dataTransfer.files[0]); });
  }
  if (fi) fi.addEventListener('change', function() { if(fi.files[0]) _bankFileChosen(fi.files[0]); });
  var cb = document.getElementById('bank-confirm-btn');
  var cc = document.getElementById('bank-cancel-btn');
  if (cb) cb.addEventListener('click', _bankConfirmUpload);
  if (cc) cc.addEventListener('click', _bankReset);
}

var _bankPendingRows = null;
var _bankPendingDate = null;
var _bankPendingBatch = null;

function _bankFileChosen(file) {
  var preview = document.getElementById('bank-preview');
  var pbody = document.getElementById('bank-preview-body');
  if (preview) preview.style.display = 'block';
  if (pbody) pbody.innerHTML = '<div style="color:var(--text-3)">📂 Reading file…</div>';
  setTimeout(function() { _bankRunPreview(file); }, 50);
}

async function _bankRunPreview(file) {
  var pbody = document.getElementById('bank-preview-body');
  try {
    var result = await _bankParseXlsx(file);
    _bankPendingRows  = result.rows;
    _bankPendingDate  = result.file_date;
    _bankPendingBatch = result.batch_id;

    // Category breakdown
    var cats = {};
    result.rows.forEach(function(r) {
      var c = r.payment_category || 'Other';
      cats[c] = (cats[c]||0) + 1;
    });
    var catHtml = Object.keys(cats).map(function(c) {
      return '<span style="background:var(--bg);padding:2px 8px;border-radius:4px;font-size:.72rem;margin-right:4px">'+escH(c)+': '+cats[c]+'</span>';
    }).join('');

    var totalAmt = result.rows.reduce(function(s,r){return s+(r.amount||0);},0);

    pbody.innerHTML =
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 20px;margin-bottom:10px">' +
      '<div><span style="color:var(--text-3)">File date:</span> <strong>'+escH(result.file_date)+'</strong></div>' +
      '<div><span style="color:var(--text-3)">Rows:</span> <strong>'+result.rows.length+'</strong></div>' +
      '<div><span style="color:var(--text-3)">Total Amount:</span> <strong>'+_fmtAmt(totalAmt)+'</strong></div>' +
      '<div><span style="color:var(--text-3)">Payment Date:</span> <strong>'+escH(result.rows[0] && result.rows[0].payment_date || '—')+'</strong></div>' +
      '</div>' +
      '<div style="margin-top:6px"><span style="color:var(--text-3);font-size:.75rem">Categories: </span>'+catHtml+'</div>';
  } catch(e) {
    pbody.innerHTML = '<span style="color:var(--red-d)">Error: '+e.message+'</span>';
  }
}

async function _bankConfirmUpload() {
  if (!_bankPendingRows) return;
  var btn = document.getElementById('bank-confirm-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Uploading…'; }
  try {
    var r = await fetch('/api/admin/upload-bank-payments', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({rows: _bankPendingRows, file_date: _bankPendingDate, batch_id: _bankPendingBatch})
    });
    var d = await r.json();
    var result = document.getElementById('bank-result');
    var preview = document.getElementById('bank-preview');
    if (preview) preview.style.display = 'none';
    if (result) result.style.display = 'block';
    if (d.ok) {
      result.innerHTML = '<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:14px"><div style="font-weight:600;color:#15803d;margin-bottom:4px">✅ Upload successful</div><div>Inserted: <strong>'+d.inserted+'</strong> rows · Skipped (duplicates): '+d.skipped+'</div></div>';
      _bankReset();
      _histCloseUpload();
    } else {
      result.innerHTML = '<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:14px;color:var(--red-d)">❌ '+escH(d.error||'Error')+'</div>';
      if (btn) { btn.disabled = false; btn.textContent = '✓ Confirm Upload'; }
    }
  } catch(e) {
    toast('Upload failed: '+e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '✓ Confirm Upload'; }
  }
}

function _bankReset() {
  _bankPendingRows = null;
  var fi = document.getElementById('bank-file-input');
  if (fi) fi.value = '';
  var preview = document.getElementById('bank-preview');
  if (preview) preview.style.display = 'none';
  var result = document.getElementById('bank-result');
  if (result) result.style.display = 'none';
  var btn = document.getElementById('bank-confirm-btn');
  if (btn) { btn.disabled = false; btn.textContent = '✓ Confirm Upload'; }
}

async function _bankLoadList() {
  var el = document.getElementById('hist-bank-list');
  if (!el) return;
  try {
    var r = await fetch('/api/admin/bank-payment-batches', {credentials:'include'});
    var d = await r.json();
    var totalAll = d.reduce(function(s,p){return s+(parseFloat(p.total_amount)||0);},0);
    var stats = '<span><strong>'+d.length+'</strong> uploads</span>' +
      '<span>Total disbursed: <strong>'+_fmtAmt(totalAll)+'</strong></span>';
    var cols = [
      {label:'File Date'},{label:'Payment Date'},{label:'Rows',right:true},
      {label:'Total Amount',right:true},{label:'Categories'},{label:'Actions',html:true}
    ];
    var rows = d.map(function(p) {
      return [
        p.file_date, p.min_date, p.row_count, _fmtAmt(p.total_amount),
        p.categories,
        '<span style="white-space:nowrap">' +
        '<button class="btn btn-ghost btn-sm" style="font-size:.7rem;margin-right:4px" data-batch="'+escH(p.upload_batch)+'" onclick="_histReview(\'bank\',this.dataset.batch)">👁 Review</button>' +
        '<button class="btn btn-ghost btn-sm" style="color:var(--red-d);font-size:.7rem" data-batch="'+escH(p.upload_batch)+'" onclick="_bankDelete(this.dataset.batch)">🗑</button>' +
        '</span>'
      ];
    });
    var fyResult = _filterRowsByFY(rows, d, 'bank', function(item){ return item.file_date || item.min_date || ''; });
    _histRenderList('bank', el, fyResult.rows, cols, stats, null, fyResult.fyHtml);
    var tbody = el.querySelector('tbody');
    var fyD = d.filter(function(item){ return _monthToFY(item.file_date || item.min_date || '') === (_histFY['bank'] || (fyResult.allFYs||[])[0]); });
    if (tbody) Array.from(tbody.querySelectorAll('tr')).forEach(function(tr,i){
      if(fyD[i] && fyD[i].file_date) tr.cells[0].innerHTML = '<span style="font-weight:600;color:var(--navy);font-size:.8rem">'+escH(fyD[i].file_date)+'</span>';
    });
  } catch(e) { el.innerHTML = '<span style="color:var(--red-d)">Error: '+e.message+'</span>'; }
}

async function _bankDelete(batch) {
  _showConfirmModal(
    '🗑 Delete Bank Payment Batch',
    'This will permanently delete all payments in this batch. This cannot be undone.',
    'Delete', 'var(--red-d)',
    async function() {
      try {
        var r = await fetch('/api/admin/bank-payment-batch/'+encodeURIComponent(batch), {method:'DELETE'});
        var d = await r.json();
        if (d.ok) { _showResultModal('✅ Deleted', 'Bank payment batch deleted ('+d.deleted+' rows).', 'success'); _bankLoadList(); }
        else _showResultModal('❌ Error', d.error||'Delete failed', 'error');
      } catch(e) { _showResultModal('❌ Error', e.message, 'error'); }
    }
  );
}

function _bankParseXlsx(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var wb = XLSX.read(e.target.result, {type:'array'});
        var ws = wb.Sheets[wb.SheetNames[0]];
        var raw = XLSX.utils.sheet_to_json(ws, {defval:null, header:1});

        // Extract date from filename: Bank_File_-_DD-MM-YYYY_-_SLLPT.xlsx
        var fname = file.name;
        var dateMatch = fname.match(/(\d{2}-\d{2}-\d{4})/);
        var file_date = dateMatch ? dateMatch[1] : 'unknown';
        var batch_id = fname.replace('.xlsx','').replace(/[^a-zA-Z0-9_-]/g,'_') + '_' + Date.now();

        var san = function(v) { return v == null ? null : String(v).trim() || null; };
        var num = function(v) { return v == null ? null : parseFloat(v) || 0; };

        // Build header-based column map (fallback to positional if headers missing)
        var _bankColMap = makeColMap(raw[0]||[], {
          pymt_prod_type: ['PYMT PROD TYPE','Product Type','Payment Product Type'],
          pymt_mode:      ['PYMT MODE','Payment Mode','Mode'],
          debit_acc_no:   ['DEBIT ACC NO','Debit Account','Debit Acc'],
          bnf_name:       ['BNF NAME','Beneficiary Name','BNF_NAME','Payment Purpose'],
          bene_acc_no:    ['BENE ACC NO','Beneficiary Account','Bene Account'],
          bene_ifsc:      ['BENE IFSC CODE','IFSC Code','IFSC','Bene IFSC'],
          amount:         ['AMOUNT','Amount','Payment Amount'],
          debit_narr:     ['DEBIT NARR','Debit Narration','Narration','Beneficiary'],
          credit_narr:    ['CREDIT NARR','Credit Narration'],
          mobile_num:     ['MOBILE NO','Mobile','Mobile Number'],
          email_id:       ['EMAIL ID','Email','Email ID'],
          remark:         ['REMARKS','Remark','Remarks'],
          payment_date:   ['PYMT DATE','Payment Date','Date','PYMT_DATE'],
          ref_no:         ['REF NO','Reference No','Ref No'],
          addl_info1:     ['ADDL INFO1','Additional Info 1'],
          addl_info2:     ['ADDL INFO2','Additional Info 2'],
          addl_info3:     ['ADDL INFO3','Additional Info 3'],
          addl_info4:     ['ADDL INFO4','Additional Info 4'],
          addl_info5:     ['ADDL INFO5','Additional Info 5'],
        });

        // Auto-detect payment category from BNF_NAME (col index 3)
        function detectCategory(bnfName) {
          if (!bnfName) return 'Other';
          var b = String(bnfName).toLowerCase();
          if (b.includes('ic payment') || b.includes('feb ic') || b.includes('jan ic') || b.includes('salary')) return 'IC Payroll';
          if (b.includes('rent')) return 'Rent';
          if (b.includes('petrol')) return 'Petrol';
          if (b.includes('advance') || b.includes('adv')) return 'Advance';
          if (b.includes('ev rent') || b.includes('ev emi') || b.includes('van payment')) return 'EV/Van';
          if (b.includes('dsp') || b.includes('gnnt') || b.includes('amde') || b.includes('bdqe')) return 'DSP Payroll';
          return 'Other';
        }

        var rows = [];
        for (var i = 1; i < raw.length; i++) {
          var r = raw[i];
          if (!r || !r[6]) continue; // skip if no amount
          var bkc = _bankColMap; // set once before loop
          rows.push({
            payment_date:     bkc('payment_date')    !== null ? san(r[bkc('payment_date')])    : san(r[12]),
            payment_category: detectCategory(bkc('bnf_name') !== null ? r[bkc('bnf_name')] : r[3]),
            pymt_prod_type:   bkc('pymt_prod_type')  !== null ? san(r[bkc('pymt_prod_type')])  : san(r[0]),
            pymt_mode:        bkc('pymt_mode')        !== null ? san(r[bkc('pymt_mode')])        : san(r[1]),
            debit_acc_no:     bkc('debit_acc_no')    !== null ? san(r[bkc('debit_acc_no')])    : san(r[2]),
            bnf_name:         bkc('bnf_name')        !== null ? san(r[bkc('bnf_name')])        : san(r[3]),
            bene_acc_no:      bkc('bene_acc_no')     !== null ? san(r[bkc('bene_acc_no')])     : san(r[4]),
            bene_ifsc:        bkc('bene_ifsc')       !== null ? san(r[bkc('bene_ifsc')])       : san(r[5]),
            amount:           bkc('amount')          !== null ? num(r[bkc('amount')])          : num(r[6]),
            debit_narr:       bkc('debit_narr')      !== null ? san(r[bkc('debit_narr')])      : san(r[7]),
            credit_narr:      bkc('credit_narr')     !== null ? san(r[bkc('credit_narr')])     : san(r[8]),
            mobile_num:       bkc('mobile_num')      !== null ? san(r[bkc('mobile_num')])      : san(r[9]),
            email_id:         bkc('email_id')        !== null ? san(r[bkc('email_id')])        : san(r[10]),
            remark:           bkc('remark')          !== null ? san(r[bkc('remark')])          : san(r[11]),
            ref_no:           bkc('ref_no')          !== null ? san(r[bkc('ref_no')])          : san(r[13]),
            addl_info1:       bkc('addl_info1')      !== null ? san(r[bkc('addl_info1')])      : san(r[14]),
            addl_info2:       bkc('addl_info2')      !== null ? san(r[bkc('addl_info2')])      : san(r[15]),
            addl_info3:       bkc('addl_info3')      !== null ? san(r[bkc('addl_info3')])      : san(r[16]),
            addl_info4:       bkc('addl_info4')      !== null ? san(r[bkc('addl_info4')])      : san(r[17]),
            addl_info5:       bkc('addl_info5')      !== null ? san(r[bkc('addl_info5')])      : san(r[18]),
          });
        }
        resolve({rows:rows, file_date:file_date, batch_id:batch_id});
      } catch(e) { reject(e); }
    };
    reader.onerror = function() { reject(new Error('Failed to read file')); };
    reader.readAsArrayBuffer(file);
  });
}

// ── Petrol Expenses ───────────────────────────────────────────────────────────
function _histInjectPetrolUpload(container) {
  container.innerHTML =
    '<div style="font-size:.78rem;color:var(--text-3);margin-bottom:6px">Upload petrol expense sheets. Period auto-detected from filename (DD-MM-YYYY_to_DD-MM-YYYY). Supports both old and new column layouts.</div>' +
    '<div style="font-size:.75rem;background:#fef9c3;color:#92400e;border-radius:6px;padding:6px 10px;margin-bottom:14px">⚠ Uses <strong>Worksheet</strong> sheet tab. Station/Store column order auto-detected.</div>' +
    '<div id="petrol-dropzone" style="border:2px dashed var(--border);border-radius:12px;padding:28px;text-align:center;cursor:pointer;margin-bottom:14px">' +
    '<div style="font-size:1.8rem;margin-bottom:6px">⛽</div>' +
    '<div style="font-size:.85rem;font-weight:600;color:var(--navy)">Drop Petrol Excel here or click to browse</div>' +
    '<div style="font-size:.73rem;color:var(--text-3);margin-top:4px">005__01-12-2025_to_15-12-2025_-_Petrol_SLLPT.xlsx style</div>' +
    '<input type="file" id="petrol-file-input" accept=".xlsx" style="display:none"></div>' +
    '<div id="petrol-preview" style="display:none;background:var(--bg);border-radius:10px;padding:14px;margin-bottom:14px;font-size:.82rem">' +
    '<div style="font-weight:600;color:var(--navy);margin-bottom:10px">📋 Preview</div>' +
    '<div id="petrol-preview-body"></div>' +
    '<div style="display:flex;gap:8px;margin-top:12px">' +
    '<button class="btn btn-ghost btn-sm" id="petrol-cancel-btn">✕ Cancel</button>' +
    '<button class="btn btn-green btn-sm" id="petrol-confirm-btn">✓ Confirm Upload</button></div></div>' +
    '<div id="petrol-result" style="display:none;font-size:.82rem"></div>';

  var dz = document.getElementById('petrol-dropzone');
  var fi = document.getElementById('petrol-file-input');
  if (dz) {
    dz.addEventListener('click', function() { fi && fi.click(); });
    dz.addEventListener('dragover', function(e) { e.preventDefault(); dz.style.borderColor='var(--navy)'; });
    dz.addEventListener('dragleave', function() { dz.style.borderColor='var(--border)'; });
    dz.addEventListener('drop', function(e) { e.preventDefault(); dz.style.borderColor='var(--border)'; if(e.dataTransfer.files[0]) _petrolFileChosen(e.dataTransfer.files[0]); });
  }
  if (fi) fi.addEventListener('change', function() { if(fi.files[0]) _petrolFileChosen(fi.files[0]); });
  var cb = document.getElementById('petrol-confirm-btn');
  var cc = document.getElementById('petrol-cancel-btn');
  if (cb) cb.addEventListener('click', _petrolConfirmUpload);
  if (cc) cc.addEventListener('click', _petrolReset);
}

var _petrolPendingRows  = null;
var _petrolPendingBatch = null;
var _petrolPendingFile  = null;

function _petrolFileChosen(file) {
  var preview = document.getElementById('petrol-preview');
  var pbody   = document.getElementById('petrol-preview-body');
  if (preview) preview.style.display = 'block';
  if (pbody)   pbody.innerHTML = '<div style="color:var(--text-3)">📂 Reading file…</div>';
  setTimeout(function() { _petrolRunPreview(file); }, 50);
}

async function _petrolRunPreview(file) {
  var pbody = document.getElementById('petrol-preview-body');
  try {
    var result = await _petrolParseXlsx(file);
    _petrolPendingRows  = result.rows;
    _petrolPendingBatch = result.upload_batch;
    _petrolPendingFile  = result.filename;

    var chk = await fetch('/api/admin/petrol-check?batch=' + encodeURIComponent(result.upload_batch)).then(function(r){return r.json();});
    var warn = chk.exists
      ? '<div style="margin-top:8px;padding:8px 12px;background:#fef9c3;border-radius:8px;color:#92400e;font-size:.75rem">⚠ This file was already uploaded ('+chk.count+' rows). Confirming will replace it.</div>'
      : '';

    var totalPetrol = result.rows.reduce(function(s,r){return s+(r.total_petrol_rs||0);},0);
    var totalBank   = result.rows.reduce(function(s,r){return s+(r.total_bank_transfer||0);},0);
    var totalKm     = result.rows.reduce(function(s,r){return s+(r.total_km||0);},0);
    var today = new Date().toISOString().slice(0,10);

    pbody.innerHTML =
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 20px;margin-bottom:10px">' +
      '<div style="grid-column:1/-1"><span style="color:var(--text-3)">File:</span> <strong style="font-size:.78rem">'+escH(result.filename)+'</strong></div>' +
      '<div><span style="color:var(--text-3)">Upload date:</span> <input type="date" id="petrol-date-input" value="'+today+'" style="margin-left:6px;padding:3px 8px;border:1px solid var(--border);border-radius:6px;font-size:.8rem"></div>' +
      '<div><span style="color:var(--text-3)">Staff:</span> <strong>'+result.rows.length+'</strong></div>' +
      '<div><span style="color:var(--text-3)">Total Petrol:</span> <strong>'+_fmtAmt(totalPetrol)+'</strong></div>' +
      '<div><span style="color:var(--text-3)">Bank Transfer:</span> <strong>'+_fmtAmt(totalBank)+'</strong></div>' +
      '<div><span style="color:var(--text-3)">Total KM:</span> <strong>'+Math.round(totalKm).toLocaleString('en-IN')+'</strong></div>' +
      '<div><span style="color:var(--text-3)">Layout:</span> <strong>'+escH(result.layout)+'</strong></div>' +
      '</div>' +
      '<div style="font-size:.73rem;color:var(--text-3);background:var(--bg);padding:6px 10px;border-radius:6px">ℹ Date range (period) can be set after upload from the list view.</div>' +
      warn;
  } catch(e) {
    pbody.innerHTML = '<span style="color:var(--red-d)">Error: '+e.message+'</span>';
  }
}

async function _petrolConfirmUpload() {
  if (!_petrolPendingRows) return;
  var dateInp = document.getElementById('petrol-date-input');
  var upload_date = dateInp ? dateInp.value : new Date().toISOString().slice(0,10);
  var btn = document.getElementById('petrol-confirm-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Uploading…'; }
  try {
    var r = await fetch('/api/admin/upload-petrol', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        rows: _petrolPendingRows, upload_batch: _petrolPendingBatch,
        upload_date: upload_date, filename: _petrolPendingFile, replace: true
      })
    });
    var d = await r.json();
    var result  = document.getElementById('petrol-result');
    var preview = document.getElementById('petrol-preview');
    if (preview) preview.style.display = 'none';
    if (result)  result.style.display  = 'block';
    if (d.ok) {
      result.innerHTML = '<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:14px"><div style="font-weight:600;color:#15803d;margin-bottom:4px">✅ Upload successful</div><div>Inserted: <strong>'+d.inserted+'</strong> rows · You can set the date range from the list view.</div></div>';
      _petrolReset();
      _histCloseUpload();
    } else {
      result.innerHTML = '<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:14px;color:var(--red-d)">❌ '+escH(d.error||'Error')+'</div>';
      if (btn) { btn.disabled = false; btn.textContent = '✓ Confirm Upload'; }
    }
  } catch(e) {
    toast('Upload failed: '+e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '✓ Confirm Upload'; }
  }
}

function _petrolReset() {
  _petrolPendingRows = null;
  var fi = document.getElementById('petrol-file-input');
  if (fi) fi.value = '';
  var preview = document.getElementById('petrol-preview');
  if (preview) preview.style.display = 'none';
  var result = document.getElementById('petrol-result');
  if (result) result.style.display = 'none';
  var btn = document.getElementById('petrol-confirm-btn');
  if (btn) { btn.disabled = false; btn.textContent = '✓ Confirm Upload'; }
}

async function _petrolLoadList() {
  var el = document.getElementById('hist-petrol-list');
  if (!el) return;
  try {
    var r = await fetch('/api/admin/petrol-periods', {credentials:'include'});
    var d = await r.json();
    if (!Array.isArray(d)) { el.innerHTML = '<div class="hist-empty">No petrol data uploaded yet — click ↑ Upload to add</div>'; return; }
    var totalPetrol = d.reduce(function(s,p){return s+(parseFloat(p.total_petrol)||0);},0);
    var totalBank   = d.reduce(function(s,p){return s+(parseFloat(p.total_bank)||0);},0);
    var stats = '<span><strong>'+d.length+'</strong> uploads</span>' +
      '<span>Petrol total: <strong>'+_fmtAmt(totalPetrol)+'</strong></span>' +
      '<span>Bank Transfer: <strong>'+_fmtAmt(totalBank)+'</strong></span>';
    var cols = [
      {label:'Upload Date'},{label:'Period From'},{label:'Period To'},
      {label:'Staff',right:true},{label:'Total Petrol',right:true},
      {label:'Bank Transfer',right:true},{label:'Total KM',right:true},{label:'Actions',html:true}
    ];
    var rows = d.map(function(p) {
      return [
        p.upload_date||'—', p.period_from||'—', p.period_to||'—', p.staff_count,
        _fmtAmt(p.total_petrol), _fmtAmt(p.total_bank),
        Math.round(p.total_km||0).toLocaleString('en-IN'),
        '<span style="white-space:nowrap">' +
        '<button class="btn btn-ghost btn-sm" style="font-size:.7rem;margin-right:4px" title="Set date range" data-b="'+escH(p.upload_batch||'__null__')+'" onclick="_petrolSetPeriod(this.dataset.b)">📅</button>' +
        '<button class="btn btn-ghost btn-sm" style="font-size:.7rem;margin-right:4px" data-b="'+escH(p.upload_batch||'__null__')+'" data-type="petrol" onclick="_histReview(this.dataset.type,this.dataset.b)">👁 Review</button>' +
        '<button class="btn btn-ghost btn-sm" style="color:var(--red-d);font-size:.7rem" data-b="'+escH(p.upload_batch||'__null__')+'" onclick="_petrolDelete(this.dataset.b)">🗑</button>' +
        '</span>'
      ];
    });
    var fyResult = _filterRowsByFY(rows, d, 'petrol', function(item){ return item.upload_date || ''; });
    _histRenderList('petrol', el, fyResult.rows, cols, stats, null, fyResult.fyHtml);
    // Highlight rows with no period set
    var tbody = el.querySelector('tbody');
    if (tbody) Array.from(tbody.querySelectorAll('tr')).forEach(function(tr,i){
      if (d[i] && !d[i].period_from) {
        tr.cells[1].innerHTML = '<span style="color:var(--amber-d,#b45309);font-size:.72rem">not set</span>';
        tr.cells[2].innerHTML = '<span style="color:var(--amber-d,#b45309);font-size:.72rem">not set</span>';
      }
    });
  } catch(e) { el.innerHTML = '<span style="color:var(--red-d)">Error: '+e.message+'</span>'; }
}

function _petrolSetPeriod(batch) {
  var existing = document.getElementById('_petrol-period-modal');
  if (existing) existing.remove();

  var modal = document.createElement('div');
  modal.id = '_petrol-period-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';

  modal.innerHTML = [
    '<div style="background:var(--card);border-radius:16px;width:100%;max-width:500px;box-shadow:0 24px 60px rgba(0,0,0,.3);overflow:hidden">',
      '<div style="padding:22px 24px 16px;border-bottom:1px solid var(--border)">',
        '<div style="font-size:1rem;font-weight:700;color:var(--navy)">📅 Set Petrol Period</div>',
        '<div style="font-size:.78rem;color:var(--text-3);margin-top:3px">Which dates does this petrol file cover?</div>',
      '</div>',
      '<div style="padding:20px 24px">',
        // Flight-booking style date range
        '<div style="display:flex;border:2px solid var(--border);border-radius:12px;overflow:hidden;transition:border-color .15s" id="_pp-box">',
          // FROM
          '<div style="flex:1;padding:14px 16px;border-right:1px solid var(--border);cursor:pointer" id="_pp-from-box">',
            '<div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-3);margin-bottom:8px">✈ PERIOD START</div>',
            '<input type="date" id="_pp-from" style="border:none;background:transparent;font-size:1rem;font-weight:700;color:var(--navy);width:100%;outline:none;cursor:pointer" onchange="_ppUpdate()">',
            '<div style="font-size:.72rem;color:var(--text-3);margin-top:4px" id="_pp-from-lbl">Click to select</div>',
          '</div>',
          // TO
          '<div style="flex:1;padding:14px 16px;cursor:pointer" id="_pp-to-box">',
            '<div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-3);margin-bottom:8px">🏁 PERIOD END</div>',
            '<input type="date" id="_pp-to" style="border:none;background:transparent;font-size:1rem;font-weight:700;color:var(--navy);width:100%;outline:none;cursor:pointer" onchange="_ppUpdate()">',
            '<div style="font-size:.72rem;color:var(--text-3);margin-top:4px" id="_pp-to-lbl">Click to select</div>',
          '</div>',
        '</div>',
        // Duration / error hint
        '<div id="_pp-hint" style="margin-top:12px;min-height:22px;text-align:center;font-size:.8rem"></div>',
      '</div>',
      '<div style="display:flex;justify-content:flex-end;gap:8px;padding:0 24px 20px">',
        '<button class="btn btn-ghost" id="_pp-cancel">Cancel</button>',
        '<button class="btn btn-green" id="_pp-save" disabled>Save Period</button>',
      '</div>',
    '</div>'
  ].join('');

  document.body.appendChild(modal);
  modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
  document.getElementById('_pp-cancel').onclick = function() { modal.remove(); };
  document.getElementById('_pp-from-box').onclick = function() {
    var f = document.getElementById('_pp-from');
    if (f) { if(f.showPicker) f.showPicker(); f.focus(); }
    _ppHighlight('from');
  };
  document.getElementById('_pp-to-box').onclick = function() {
    var t = document.getElementById('_pp-to');
    if (t) { if(t.showPicker) t.showPicker(); t.focus(); }
    _ppHighlight('to');
  };
  document.getElementById('_pp-save').onclick = function() { _ppSave(batch); };
  document.getElementById('_pp-from').addEventListener('change', function() {
    var to = document.getElementById('_pp-to');
    if (this.value && to && !to.value) {
      setTimeout(function(){
        var toEl = document.getElementById('_pp-to');
        if(toEl){ if(toEl.showPicker) toEl.showPicker(); toEl.focus(); }
        _ppHighlight('to');
      }, 100);
    }
    _ppUpdate();
  });

  // Focus from on open
  setTimeout(function() {
    var f = document.getElementById('_pp-from');
    if (f) { f.focus(); _ppHighlight('from'); }
  }, 80);
}

function _ppHighlight(which) {
  var box = document.getElementById('_pp-box');
  if (box) box.style.borderColor = 'var(--navy)';
}

function _ppUpdate() {
  var from  = document.getElementById('_pp-from');
  var to    = document.getElementById('_pp-to');
  var hint  = document.getElementById('_pp-hint');
  var save  = document.getElementById('_pp-save');
  var fl    = document.getElementById('_pp-from-lbl');
  var tl    = document.getElementById('_pp-to-lbl');
  if (!from || !to) return;

  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function fmtDate(v) {
    if (!v) return null;
    var p = v.split('-');
    return p[2]+' '+months[parseInt(p[1])-1]+' '+p[0];
  }

  if (fl) fl.textContent = fmtDate(from.value) || 'Click to select';
  if (tl) tl.textContent = fmtDate(to.value)   || 'Click to select';

  var valid = from.value && to.value && from.value <= to.value;
  if (save) save.disabled = !valid;

  if (from.value && to.value) {
    if (from.value > to.value) {
      if (hint) hint.innerHTML = '<span style="color:var(--red-d)">⚠ End date must be after start date</span>';
    } else {
      var d1 = new Date(from.value), d2 = new Date(to.value);
      var days = Math.round((d2-d1)/(86400000))+1;
      if (hint) hint.innerHTML = '<span style="color:var(--green-d);font-weight:600">✓ '+days+' day period — '+fmtDate(from.value)+' to '+fmtDate(to.value)+'</span>';
    }
  } else {
    if (hint) hint.innerHTML = '';
  }
}

async function _ppSave(batch) {
  var from = document.getElementById('_pp-from');
  var to   = document.getElementById('_pp-to');
  if (!from || !to || !from.value || !to.value) return;
  var btn = document.getElementById('_pp-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    var r = await fetch('/api/admin/petrol-period/'+encodeURIComponent(batch), {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({period_from:from.value, period_to:to.value})
    });
    var d = await r.json();
    var modal = document.getElementById('_petrol-period-modal');
    if (modal) modal.remove();
    if (d.ok) {
      _showResultModal('✅ Period Saved', from.value+' → '+to.value+' saved successfully.', 'success');
      _petrolLoadList();
    } else {
      _showResultModal('❌ Error', d.error||'Save failed', 'error');
    }
  } catch(e) {
    _showResultModal('❌ Error', e.message, 'error');
    if (btn) { btn.disabled=false; btn.textContent='Save Period'; }
  }
}


async function _petrolDelete(batch) {
  _showConfirmModal(
    '🗑 Delete Petrol Upload',
    'This will permanently delete all petrol data for this upload. This cannot be undone.',
    'Delete', 'var(--red-d)',
    async function() {
      try {
        var r = await fetch('/api/admin/petrol/'+encodeURIComponent(batch), {method:'DELETE'});
        var d = await r.json();
        if (d.ok) {
          _showResultModal('✅ Deleted', 'Petrol data deleted successfully ('+d.deleted+' rows removed).', 'success');
          _petrolLoadList();
        } else {
          _showResultModal('❌ Error', d.error||'Delete failed', 'error');
        }
      } catch(e) {
        _showResultModal('❌ Error', e.message, 'error');
      }
    }
  );
}

function _petrolParseXlsx(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var wb = XLSX.read(e.target.result, {type:'array'});
        var san = function(v) {
          if (v == null) return null;
          return String(v).replace(/\r/g,'').replace(/\n/g,' ').trim() || null;
        };
        var num = function(v) {
          if (v == null) return 0;
          var n = parseFloat(String(v).replace(/[^0-9.-]/g,''));
          return isNaN(n) ? 0 : n;
        };

        // Find the right sheet: prefer 'Worksheet', then 'Petrol', then first sheet with >50 rows
        var sheetName = null;
        var preferred = ['Worksheet','Petrol','Sheet1'];
        for (var si=0; si<preferred.length; si++) {
          if (wb.SheetNames.includes(preferred[si])) {
            var testWs = wb.Sheets[preferred[si]];
            var testRaw = XLSX.utils.sheet_to_json(testWs, {defval:null, header:1});
            if (testRaw.length > 10 && testRaw[0] && testRaw[0].length > 10) {
              sheetName = preferred[si]; break;
            }
          }
        }
        if (!sheetName) sheetName = wb.SheetNames[0];

        var ws = wb.Sheets[sheetName];
        var raw = XLSX.utils.sheet_to_json(ws, {defval:null, header:1});
        var headers = (raw[0]||[]).map(function(h){return san(h);});

        // Detect layout version by column count and key header names
        var colCount = headers.length;
        // Old format (39-col, pre-Dec 2025): has 'E.ID', 'Employee Name', 'Amazon ID'
        // New format (25-26 col): has 'ID', 'Name', 'Associate ID'
        var isOldFormat = colCount >= 35 || (headers[2] && String(headers[2]).includes('E.ID')) || (headers[4] && String(headers[4]).toLowerCase().includes('employee'));
        // Mid format (26-col, Station first): Station Code | Store Name | ID...
        var stationFirst = headers[0] && headers[0].toLowerCase().includes('station');
        var iStation = stationFirst ? 0 : 1;
        var iStore   = stationFirst ? 1 : 0;

        var layout = isOldFormat ? 'Legacy (39-col)' : (stationFirst ? 'v2 (Station|Store)' : 'v3 (Store|Station)');

        // Extract period from filename: DD-MM-YYYY_to_DD-MM-YYYY
        var fname = file.name;
        var dateRe = /(\d{2}-\d{2}-\d{4})_to_(\d{2}-\d{2}-\d{4})/i;
        var dm = fname.match(dateRe);
        var period_from = null, period_to = null, period_label = 'unknown';
        if (dm) {
          var toISO = function(d) { var p=d.split('-'); return p[2]+'-'+p[1]+'-'+p[0]; };
          period_from  = toISO(dm[1]);
          period_to    = toISO(dm[2]);
          period_label = dm[1] + ' to ' + dm[2];
        }

        // Header-based column map — works across all petrol format versions
        var pc = makeColMap(raw[0]||[], {
          station_code:        ['Station Code','Station'],
          store_name:          ['Store Name','Station Name','Store'],
          staff_id:            ['ID','E.ID','Emp ID','Employee ID'],
          name:                ['Name','Employee Name'],
          associate_id:        ['Associate ID','Amazon ID','Amz ID'],
          delivered:           ['Delivered Parcel','Delivery - Bifme','Delivery - EDSP','Delivery'],
          pickup:              ['Pick up','Pick-up','Pick up - Bifme','Pickup'],
          swa:                 ['SWA','V.Bifme'],
          smd:                 ['SMD'],
          mfn:                 ['MFN','MFN - Bifme','MFN - EDSP'],
          seller_return:       ['Seller Return','Seller Returns - EDSP','Seller Returns'],
          total_parcels:       ['Total Parcel By CM','Approved Parcel By CM','Total Parcels','Approved Parcel'],
          total_km:            ['Total KM Approved By CM','Approved KM By CM','Total KM'],
          per_km_rate:         ['Per KM Rate','KM Rate'],
          total_petrol_rs:     ['Total Petrol RS','Total Pay RS - Petrol','Total Petrol','Total Pay RS'],
          advance_petrol:      ['Advance Petrol','Advance','Advanced'],
          total_bank_transfer: ['Total Bank Transfer','Bank Transfer','Total Pay - Bank transfer','Bank transfer RS'],
          per_parcel_cost:     ['Per Parcel  Petrol Cost','Per Parcel Petrol Cost','Per parcel cost','Per Parcel Cost'],
          average:             ['Average'],
          account_number:      ['Account Number','Account No'],
          ifsc_code:           ['IFSC Code','IFSC'],
          cm:                  ['CM','Cluster Manager'],
          user_type:           ['Designation','User type','User Type'],
          remarks:             ['Remakrs','Remarks','Remark'],
          tally_ledger:        ['Tally Ledger','Tally Ledger Name'],
          cost_centre:         ['Cost Centre','Cost Center'],
        });

        var layout = 'Header-mapped';
        var rows = [];
        for (var i=1; i<raw.length; i++) {
          var r = raw[i];
          var sidIdx = pc('staff_id');
          if (sidIdx === null) continue;
          var staffId = parseInt(r[sidIdx]);
          if (!staffId || isNaN(staffId)) continue;
          var stIdx = pc('station_code');
          var stVal = stIdx !== null ? san(r[stIdx]) : null;
          rows.push({
            period_from:         period_from,
            period_to:           period_to,
            station_code:        stVal,
            store_name:          pc('store_name')        !== null ? san(r[pc('store_name')])        : null,
            staff_id:            staffId,
            name:                pc('name')              !== null ? san(r[pc('name')])              : null,
            associate_id:        pc('associate_id')      !== null ? san(r[pc('associate_id')])      : null,
            delivered:           pc('delivered')         !== null ? num(r[pc('delivered')])         : 0,
            pickup:              pc('pickup')            !== null ? num(r[pc('pickup')])            : 0,
            swa:                 pc('swa')               !== null ? num(r[pc('swa')])               : 0,
            smd:                 pc('smd')               !== null ? num(r[pc('smd')])               : 0,
            mfn:                 pc('mfn')               !== null ? num(r[pc('mfn')])               : 0,
            seller_return:       pc('seller_return')     !== null ? num(r[pc('seller_return')])     : 0,
            total_parcels:       pc('total_parcels')     !== null ? num(r[pc('total_parcels')])     : 0,
            total_km:            pc('total_km')          !== null ? num(r[pc('total_km')])          : 0,
            per_km_rate:         pc('per_km_rate')       !== null ? num(r[pc('per_km_rate')])       : 0,
            total_petrol_rs:     pc('total_petrol_rs')   !== null ? num(r[pc('total_petrol_rs')])   : 0,
            advance_petrol:      pc('advance_petrol')    !== null ? num(r[pc('advance_petrol')])    : 0,
            total_bank_transfer: pc('total_bank_transfer')!==null ? num(r[pc('total_bank_transfer')]): 0,
            per_parcel_cost:     pc('per_parcel_cost')   !== null ? num(r[pc('per_parcel_cost')])   : 0,
            average:             pc('average')           !== null ? num(r[pc('average')])           : 0,
            account_number:      pc('account_number')    !== null ? san(r[pc('account_number')])    : null,
            ifsc_code:           pc('ifsc_code')         !== null ? san(r[pc('ifsc_code')])         : null,
            cm:                  pc('cm')                !== null ? san(r[pc('cm')])                : null,
            user_type:           pc('user_type')         !== null ? san(r[pc('user_type')])         : null,
            remarks:             pc('remarks')           !== null ? san(r[pc('remarks')])           : null,
            tally_ledger:        pc('tally_ledger')      !== null ? san(r[pc('tally_ledger')])      : null,
            cost_centre:         pc('cost_centre')       !== null ? san(r[pc('cost_centre')])       : null,
          });
        }
        var batchId = file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
        resolve({rows:rows, layout:layout, filename:file.name, upload_batch:batchId, period_from:period_from, period_to:period_to});
      } catch(err) { reject(err); }
    };
    reader.onerror = function() { reject(new Error('Failed to read file')); };
    reader.readAsArrayBuffer(file);
  });
}

// ── KMS/EDSP period date range setter ────────────────────────────────────────
function _edspSetPeriodDates(period, currentFrom, currentTo, hasOverride) {
  var existing = document.getElementById('_edsp-period-modal');
  if (existing) existing.remove();

  var modal = document.createElement('div');
  modal.id = '_edsp-period-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = [
    '<div style="background:var(--card);border-radius:16px;width:100%;max-width:500px;box-shadow:0 24px 60px rgba(0,0,0,.3);overflow:hidden">',
      '<div style="padding:22px 24px 16px;border-bottom:1px solid var(--border)">',
        '<div style="font-size:1rem;font-weight:700;color:var(--navy)">📅 Set Period Date Range</div>',
        '<div style="font-size:.78rem;color:var(--text-3);margin-top:3px">Override date range for period <strong>' + escH(period) + '</strong></div>',
        (!hasOverride ? '<div style="font-size:.75rem;color:var(--amber-d);margin-top:4px">⚠ Currently showing auto-detected dates from delivery data</div>' : ''),
      '</div>',
      '<div style="padding:20px 24px">',
        '<div style="display:flex;border:2px solid var(--border);border-radius:12px;overflow:hidden;transition:border-color .15s" id="_ep-box">',
          '<div style="flex:1;padding:14px 16px;border-right:1px solid var(--border);cursor:pointer" id="_ep-from-box">',
            '<div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-3);margin-bottom:8px">✈ PERIOD START</div>',
            '<input type="date" id="_ep-from" value="' + (currentFrom||'') + '" style="border:none;background:transparent;font-size:1rem;font-weight:700;color:var(--navy);width:100%;outline:none;cursor:pointer" onchange="_epUpdate()">',
            '<div style="font-size:.72rem;color:var(--text-3);margin-top:4px" id="_ep-from-lbl">' + (currentFrom ? _edspFmtDate(currentFrom) : 'Click to select') + '</div>',
          '</div>',
          '<div style="flex:1;padding:14px 16px;cursor:pointer" id="_ep-to-box">',
            '<div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-3);margin-bottom:8px">🏁 PERIOD END</div>',
            '<input type="date" id="_ep-to" value="' + (currentTo||'') + '" style="border:none;background:transparent;font-size:1rem;font-weight:700;color:var(--navy);width:100%;outline:none;cursor:pointer" onchange="_epUpdate()">',
            '<div style="font-size:.72rem;color:var(--text-3);margin-top:4px" id="_ep-to-lbl">' + (currentTo ? _edspFmtDate(currentTo) : 'Click to select') + '</div>',
          '</div>',
        '</div>',
        '<div id="_ep-hint" style="margin-top:12px;min-height:22px;text-align:center;font-size:.8rem"></div>',
      '</div>',
      '<div style="display:flex;justify-content:flex-end;gap:8px;padding:0 24px 20px">',
        (hasOverride ? '<button class="btn btn-ghost" id="_ep-clear" style="margin-right:auto;color:var(--amber-d)">Clear Override</button>' : ''),
        '<button class="btn btn-ghost" id="_ep-cancel">Cancel</button>',
        '<button class="btn btn-green" id="_ep-save">Save Period</button>',
      '</div>',
    '</div>'
  ].join('');

  document.body.appendChild(modal);
  modal.onclick = function(e) { if (e.target === modal) modal.remove(); };

  document.getElementById('_ep-cancel').onclick = function() { modal.remove(); };
  document.getElementById('_ep-from-box').onclick = function() {
    var f = document.getElementById('_ep-from'); if(f){if(f.showPicker)f.showPicker();f.focus();}
  };
  document.getElementById('_ep-to-box').onclick = function() {
    var t = document.getElementById('_ep-to'); if(t){if(t.showPicker)t.showPicker();t.focus();}
  };
  document.getElementById('_ep-save').onclick = function() { _epSave(period); };
  var clearBtn = document.getElementById('_ep-clear');
  if (clearBtn) clearBtn.onclick = function() { _epSaveDates(period, null, null); };

  // Auto-advance to end when start selected
  document.getElementById('_ep-from').addEventListener('change', function() {
    var to = document.getElementById('_ep-to');
    if (this.value && to && !to.value) {
      setTimeout(function(){var t=document.getElementById('_ep-to');if(t){if(t.showPicker)t.showPicker();t.focus();}},100);
    }
    _epUpdate();
  });
  _epUpdate();
}

function _edspFmtDate(v) {
  if (!v) return 'Click to select';
  var p = v.split('-'); var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return p[2]+' '+months[parseInt(p[1])-1]+' '+p[0];
}

function _epUpdate() {
  var from = document.getElementById('_ep-from');
  var to   = document.getElementById('_ep-to');
  var hint = document.getElementById('_ep-hint');
  var fl   = document.getElementById('_ep-from-lbl');
  var tl   = document.getElementById('_ep-to-lbl');
  if (!from || !to) return;
  if (fl) fl.textContent = _edspFmtDate(from.value) || 'Click to select';
  if (tl) tl.textContent = _edspFmtDate(to.value)   || 'Click to select';
  if (from.value && to.value) {
    if (from.value > to.value) {
      if (hint) hint.innerHTML = '<span style="color:var(--red-d)">⚠ End date must be after start date</span>';
    } else {
      var days = Math.round((new Date(to.value)-new Date(from.value))/86400000)+1;
      if (hint) hint.innerHTML = '<span style="color:var(--green-d);font-weight:600">✓ '+days+' day period — '+_edspFmtDate(from.value)+' to '+_edspFmtDate(to.value)+'</span>';
    }
  } else {
    if (hint) hint.innerHTML = '';
  }
}

async function _epSave(period) {
  var from = document.getElementById('_ep-from');
  var to   = document.getElementById('_ep-to');
  if (!from || !to || !from.value || !to.value) {
    _showResultModal('⚠️ Both Dates Required', 'Please select both start and end dates.', 'info'); return;
  }
  if (from.value > to.value) {
    _showResultModal('⚠️ Invalid Range', 'End date must be after start date.', 'info'); return;
  }
  await _epSaveDates(period, from.value, to.value);
}

async function _epSaveDates(period, from, to) {
  try {
    var r = await fetch('/api/admin/edsp-period-dates/' + encodeURIComponent(period), {
      method: 'PATCH', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({period_from: from, period_to: to})
    });
    var d = await r.json();
    var modal = document.getElementById('_edsp-period-modal');
    if (modal) modal.remove();
    if (d.ok) {
      _showResultModal('✅ ' + (from ? 'Period Saved' : 'Override Cleared'),
        from ? (from + ' → ' + to) : 'Date override removed. Auto-detected dates will be shown.',
        'success');
      _edspLoadPeriods();
    } else {
      _showResultModal('❌ Error', d.error||'Save failed', 'error');
    }
  } catch(e) { _showResultModal('❌ Error', e.message, 'error'); }
}

// ── Modern confirm/result modals ──────────────────────────────────────────────
function _showConfirmModal(title, message, actionLabel, actionColor, onConfirm) {
  var existing = document.getElementById('_hist-confirm-modal');
  if (existing) existing.remove();

  var modal = document.createElement('div');
  modal.id = '_hist-confirm-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML =
    '<div style="background:var(--card);border-radius:14px;width:100%;max-width:420px;box-shadow:0 20px 60px rgba(0,0,0,.3);overflow:hidden">' +
    '<div style="padding:20px 24px 0">' +
    '<div style="font-size:1rem;font-weight:700;color:var(--navy);margin-bottom:10px">'+escH(title)+'</div>' +
    '<div style="font-size:.84rem;color:var(--text-2);line-height:1.5">'+escH(message)+'</div>' +
    '</div>' +
    '<div style="display:flex;justify-content:flex-end;gap:8px;padding:20px 24px">' +
    '<button id="_hcm-cancel" class="btn btn-ghost">Cancel</button>' +
    '<button id="_hcm-confirm" class="btn" style="background:'+actionColor+';color:#fff;border:none">'+escH(actionLabel)+'</button>' +
    '</div></div>';
  document.body.appendChild(modal);

  document.getElementById('_hcm-cancel').onclick = function() { modal.remove(); };
  document.getElementById('_hcm-confirm').onclick = function() { modal.remove(); onConfirm(); };
  modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
}

function _showResultModal(title, message, type) {
  var existing = document.getElementById('_hist-result-modal');
  if (existing) existing.remove();

  var colors = {
    success: {bg:'#f0fdf4', border:'#86efac', title:'#15803d'},
    error:   {bg:'#fef2f2', border:'#fca5a5', title:'var(--red-d)'},
    info:    {bg:'#dbeafe', border:'#93c5fd', title:'var(--navy)'}
  };
  var c = colors[type] || colors.info;

  var modal = document.createElement('div');
  modal.id = '_hist-result-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML =
    '<div style="background:'+c.bg+';border:1.5px solid '+c.border+';border-radius:14px;width:100%;max-width:380px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.2);text-align:center">' +
    '<div style="font-size:1rem;font-weight:700;color:'+c.title+';margin-bottom:8px">'+escH(title)+'</div>' +
    '<div style="font-size:.84rem;color:var(--text-2);margin-bottom:20px">'+escH(message)+'</div>' +
    '<button class="btn btn-ghost" onclick="document.getElementById(\'_hist-result-modal\').remove()">OK</button>' +
    '</div>';
  document.body.appendChild(modal);
  // Auto-dismiss after 4 seconds
  setTimeout(function() { var m = document.getElementById('_hist-result-modal'); if (m) m.remove(); }, 4000);
  modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
}

// ── Period Edit Modal ─────────────────────────────────────────────────────────
// config: { title, currentValue, label, hint, onSave(newValue) }
function _showPeriodEditModal(config) {
  var existing = document.getElementById('_period-edit-modal');
  if (existing) existing.remove();

  var modal = document.createElement('div');
  modal.id = '_period-edit-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML =
    '<div style="background:var(--card);border-radius:14px;width:100%;max-width:440px;box-shadow:0 20px 60px rgba(0,0,0,.3);overflow:hidden">' +
    '<div style="padding:20px 24px 0">' +
    '<div style="font-size:1rem;font-weight:700;color:var(--navy);margin-bottom:4px">'+escH(config.title||'Edit Period')+'</div>' +
    '<div style="font-size:.78rem;color:var(--text-3);margin-bottom:16px">'+escH(config.hint||'Correct the period label for this data.')+'</div>' +
    '<label style="font-size:.8rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">'+escH(config.label||'Period')+'</label>' +
    '<input id="_pem-input" type="text" value="'+escH(config.currentValue||'')+'" placeholder="'+escH(config.placeholder||'')+'"' +
    ' style="width:100%;box-sizing:border-box;padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:.88rem;font-family:monospace">' +
    '<div id="_pem-error" style="font-size:.75rem;color:var(--red-d);margin-top:6px;display:none"></div>' +
    '</div>' +
    '<div style="display:flex;justify-content:flex-end;gap:8px;padding:20px 24px">' +
    '<button id="_pem-cancel" class="btn btn-ghost">Cancel</button>' +
    '<button id="_pem-save" class="btn btn-green">Save</button>' +
    '</div></div>';
  document.body.appendChild(modal);

  var input = document.getElementById('_pem-input');
  var errEl = document.getElementById('_pem-error');
  input.focus(); input.select();

  document.getElementById('_pem-cancel').onclick = function() { modal.remove(); };
  modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
  input.onkeydown = function(e) { if (e.key === 'Enter') doSave(); };

  document.getElementById('_pem-save').onclick = doSave;

  function doSave() {
    var val = input.value.trim();
    if (!val) { errEl.textContent = 'Period cannot be empty'; errEl.style.display='block'; return; }
    if (val === config.currentValue) { modal.remove(); return; }
    errEl.style.display = 'none';
    var btn = document.getElementById('_pem-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    config.onSave(val, function(err) {
      if (err) { errEl.textContent = err; errEl.style.display='block'; btn.disabled=false; btn.textContent='Save'; }
      else { modal.remove(); }
    });
  }
}

// ── Period edit handlers per section ─────────────────────────────────────────

function _editEdspPeriod(oldPeriod) {
  _showPeriodEditModal({
    title: '📅 Edit KMS/EDSP Period',
    currentValue: oldPeriod,
    label: 'Period label',
    placeholder: 'e.g. feb-2026-a',
    hint: 'Format: mon-yyyy or mon-yyyy-a / mon-yyyy-b. Renames all rows in this period.',
    onSave: async function(newVal, done) {
      try {
        var r = await fetch('/api/admin/historical-edsp-period', {
          method:'PATCH', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({old_period: oldPeriod, new_period: newVal})
        });
        var d = await r.json();
        if (d.ok) { _showResultModal('✅ Period updated', newVal+' ('+d.updated+' rows)', 'success'); _edspLoadPeriods(); done(); }
        else done(d.error||'Update failed');
      } catch(e) { done(e.message); }
    }
  });
}

function _editPayrollPeriod(oldMonth) {
  _showPeriodEditModal({
    title: '📅 Edit EDSP Payroll Month',
    currentValue: oldMonth,
    label: 'Payroll month',
    placeholder: 'e.g. jan-2026',
    hint: 'Format: mon-yyyy. Renames all rows for this month.',
    onSave: async function(newVal, done) {
      try {
        var r = await fetch('/api/admin/payroll-history-period', {
          method:'PATCH', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({old_month: oldMonth, new_month: newVal})
        });
        var d = await r.json();
        if (d.ok) { _showResultModal('✅ Period updated', newVal+' ('+d.updated+' rows)', 'success'); _phLoadMonths(); done(); }
        else done(d.error||'Update failed');
      } catch(e) { done(e.message); }
    }
  });
}

function _editDspPeriod(oldMonth, stationCode, cycle) {
  _showPeriodEditModal({
    title: '📅 Edit DSP Payroll Month',
    currentValue: oldMonth,
    label: 'Payment month',
    placeholder: 'e.g. feb-2026',
    hint: 'Editing month for ' + stationCode + ' cycle ' + cycle + '. Format: mon-yyyy.',
    onSave: async function(newVal, done) {
      try {
        var r = await fetch('/api/admin/dsp-payroll-period', {
          method:'PATCH', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({old_month: oldMonth, new_month: newVal, station_code: stationCode, cycle: cycle})
        });
        var d = await r.json();
        if (d.ok) { _showResultModal('✅ Period updated', newVal+' ('+d.updated+' rows)', 'success'); _dspPhLoadMonths(); done(); }
        else done(d.error||'Update failed');
      } catch(e) { done(e.message); }
    }
  });
}

function _editRentPeriod(oldMonth) {
  _showPeriodEditModal({
    title: '📅 Edit Rent Payment Month',
    currentValue: oldMonth,
    label: 'Payment month',
    placeholder: 'e.g. feb-2026',
    hint: 'Format: mon-yyyy. Renames all rent rows for this month.',
    onSave: async function(newVal, done) {
      try {
        var r = await fetch('/api/admin/rent-history-period', {
          method:'PATCH', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({old_month: oldMonth, new_month: newVal})
        });
        var d = await r.json();
        if (d.ok) { _showResultModal('✅ Period updated', newVal+' ('+d.updated+' rows)', 'success'); _rentLoadListDirect(); done(); }
        else done(d.error||'Update failed');
      } catch(e) { done(e.message); }
    }
  });
}

function _editAddlPeriod(oldMonth) {
  _showPeriodEditModal({
    title: '📅 Edit Additional Payments Month',
    currentValue: oldMonth,
    label: 'Payment month',
    placeholder: 'e.g. feb-2026',
    hint: 'Format: mon-yyyy. Renames all rows for this month.',
    onSave: async function(newVal, done) {
      try {
        var r = await fetch('/api/admin/addl-payments-period', {
          method:'PATCH', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({old_month: oldMonth, new_month: newVal})
        });
        var d = await r.json();
        if (d.ok) { _showResultModal('✅ Period updated', newVal+' ('+d.updated+' rows)', 'success'); _addlLoadListDirect(); done(); }
        else done(d.error||'Update failed');
      } catch(e) { done(e.message); }
    }
  });
}

function _editBankPeriod(batch, oldDate) {
  _showPeriodEditModal({
    title: '📅 Edit Bank File Date',
    currentValue: oldDate||'',
    label: 'File date',
    placeholder: 'e.g. 12-03-2026',
    hint: 'Format: DD-MM-YYYY. Corrects the date label for this bank file.',
    onSave: async function(newVal, done) {
      try {
        var r = await fetch('/api/admin/bank-payment-period', {
          method:'PATCH', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({batch: batch, new_date: newVal})
        });
        var d = await r.json();
        if (d.ok) { _showResultModal('✅ Date updated', newVal+' ('+d.updated+' rows)', 'success'); _bankLoadList(); done(); }
        else done(d.error||'Update failed');
      } catch(e) { done(e.message); }
    }
  });
}

// Replace old petrol prompt with modal


// ── EXPORT WITH FACE VERIFY ──────────────────────────────────────────────────

var _exportPending = null; // {type, params, label}

// Strip key → export config
var _EXPORT_CONFIG = {
  'kms':         { label:'KMS / EDSP Data',       endpoint:'/api/admin/export/kms',         paramKey:'period',  paramLabel:'Period',  paramEl:'#hist-kms-period-sel' },
  'payroll':     { label:'EDSP Payroll',           endpoint:'/api/admin/export/payroll',     paramKey:'month',   paramLabel:'Month',   paramEl:'#hist-payroll-month-sel' },
  'dsp-payroll': { label:'DSP Payroll',            endpoint:'/api/admin/export/dsp-payroll', paramKey:'month',   paramLabel:'Month',   paramEl:'#hist-dsp-month-sel' },
  'petrol':      { label:'Petrol Expenses',        endpoint:'/api/admin/export/petrol',      paramKey:'batch',   paramLabel:'Batch',   paramEl:'#hist-petrol-batch-sel' },
  'rent':        { label:'Rent Payments',          endpoint:'/api/admin/export/rent',        paramKey:'month',   paramLabel:'Month',   paramEl:'#hist-rent-month-sel' },
  'addl':        { label:'Additional Payments',    endpoint:'/api/admin/export/addl',        paramKey:'month',   paramLabel:'Month',   paramEl:'#hist-addl-month-sel' },
  'bank':        { label:'Bank Payments',          endpoint:'/api/admin/export/bank',        paramKey:'batch',   paramLabel:'Batch',   paramEl:'#hist-bank-batch-sel' },
  'invoices':    { label:'Amazon Invoices',        endpoint:'/api/admin/export/invoices',    paramKey:'station', paramLabel:'Station', paramEl:'#inv-station' }
};

function _histExport(key) {
  var cfg = _EXPORT_CONFIG[key];
  if (!cfg) return;

  // Get current filter value from the open strip
  var paramEl = document.querySelector(cfg.paramEl);
  var paramVal = paramEl ? paramEl.value : '';

  // Build label for what's being exported
  var scopeLabel = paramVal ? (cfg.paramLabel + ': ' + paramVal) : 'All';

  _exportPending = { type: key, endpoint: cfg.endpoint, paramKey: cfg.paramKey, paramVal: paramVal, label: cfg.label + ' (' + scopeLabel + ')' };

  // Show face verify modal
  _showExportVerifyModal();
}

function _showExportVerifyModal() {
  // Use logged-in user's name directly — already authenticated, no second password needed
  var user = window._adminUser || JSON.parse(sessionStorage.getItem('adm_user') || 'null');
  if (user && user.name) {
    if (_exportPending) toast('Exporting ' + escH(_exportPending.label) + '…', 'info');
    _runExport(user.name);
    return;
  }
  // Fallback (session not loaded) — ask name only, no password
  var existing = document.getElementById('export-verify-modal');
  if (existing) existing.remove();
  var modal = document.createElement('div');
  modal.id = 'export-verify-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML =
    '<div style="background:var(--card);border-radius:14px;width:100%;max-width:380px;box-shadow:0 20px 60px rgba(0,0,0,.25);overflow:hidden">' +
      '<div style="padding:18px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px">' +
        '<div style="font-size:1.3rem">📥</div>' +
        '<div style="font-weight:700;font-size:.95rem;color:var(--navy)">Export: ' + (_exportPending ? escH(_exportPending.label) : '') + '</div>' +
        '<button onclick="document.getElementById(\'export-verify-modal\').remove()" style="margin-left:auto;background:none;border:none;cursor:pointer;font-size:1.2rem;color:var(--text-3)">×</button>' +
      '</div>' +
      '<div style="padding:20px">' +
        '<div style="margin-bottom:14px">' +
          '<label style="font-size:.8rem;color:var(--text-2);display:block;margin-bottom:5px;font-weight:500">Your Name (for audit log)</label>' +
          '<input type="text" id="export-name" placeholder="Your name…" onkeydown="if(event.key===\'Enter\')_exportVerifySubmit()" ' +
          'style="width:100%;box-sizing:border-box;padding:9px 12px;font-size:.88rem;border:1.5px solid var(--border);border-radius:8px;font-family:inherit">' +
        '</div>' +
        '<div id="export-verify-err" style="font-size:.8rem;color:var(--red-d);margin-bottom:10px;display:none"></div>' +
        '<button onclick="_exportVerifySubmit()" style="width:100%;padding:10px;font-size:.88rem;font-weight:700;border:none;border-radius:8px;background:var(--navy);color:#fff;cursor:pointer">📥 Export Excel</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
  setTimeout(function(){ var el = document.getElementById('export-name'); if(el) el.focus(); }, 100);
}

function _exportVerifySubmit() {
  var name = (document.getElementById('export-name') || {}).value || '';
  var errEl = document.getElementById('export-verify-err');
  if (!name.trim()) { errEl.textContent = 'Please enter your name.'; errEl.style.display='block'; return; }
  var modal = document.getElementById('export-verify-modal');
  if (modal) modal.remove();
  _runExport(name.trim());
}

async function _runExport(exportedBy) {
  if (!_exportPending) return;
  var cfg = _exportPending;

  try {
    toast('Preparing export…', 'info');

    // Build query params
    var qp = new URLSearchParams();
    qp.set('exported_by', exportedBy);
    if (cfg.paramVal) qp.set(cfg.paramKey, cfg.paramVal);

    // Special handling for invoices — also pass from/to/entity
    if (cfg.type === 'invoices') {
      var from = (document.getElementById('inv-from') || {}).value || '';
      var to   = (document.getElementById('inv-to')   || {}).value || '';
      var ent  = (document.getElementById('inv-entity') || {}).value || '';
      if (from) qp.set('from', from + '-01');
      if (to)   qp.set('to', to + '-01');
      if (ent)  qp.set('entity', ent);
    }

    var r = await fetch(cfg.endpoint + '?' + qp);
    var data = await r.json();

    if (!Array.isArray(data) || !data.length) {
      toast('No data to export for selected filters.', 'warning'); return;
    }

    // Build XLSX using SheetJS
    _generateXlsx(data, cfg.label, exportedBy);

  } catch(e) {
    toast('Export failed: ' + e.message, 'error');
  }
  _exportPending = null;
}

function _generateXlsx(data, sheetName, exportedBy) {
  if (typeof XLSX === 'undefined') { toast('XLSX library not loaded.', 'error'); return; }

  // Flatten any nested objects
  var rows = data.map(function(row) {
    var flat = {};
    Object.keys(row).forEach(function(k) {
      var v = row[k];
      if (v !== null && typeof v === 'object') {
        flat[k] = JSON.stringify(v);
      } else {
        flat[k] = v;
      }
    });
    return flat;
  });

  var ws = XLSX.utils.json_to_sheet(rows);
  var wb = XLSX.utils.book_new();
  var safeSheet = sheetName.replace(/[\\/*?:[\]]/g, '').substring(0, 31);
  XLSX.utils.book_append_sheet(wb, ws, safeSheet);

  // Add export info sheet
  var infoData = [
    ['Export Label', sheetName],
    ['Exported By', exportedBy],
    ['Exported At', new Date().toLocaleString('en-IN')],
    ['Row Count', rows.length]
  ];
  var wsInfo = XLSX.utils.aoa_to_sheet(infoData);
  XLSX.utils.book_append_sheet(wb, wsInfo, 'Export Info');

  var filename = safeSheet.replace(/\s+/g, '_') + '_' + new Date().toISOString().substring(0,10) + '.xlsx';
  XLSX.writeFile(wb, filename);
  toast('✓ Exported ' + rows.length + ' rows as ' + filename, 'success');
}

// ── EXPORT LOG VIEWER ────────────────────────────────────────────────────────
async function showExportLog() {
  try {
    var rows = await fetch('/api/admin/export-log').then(function(r){ return r.json(); });
    var modal = document.getElementById('hist-upload-modal');
    var title = document.getElementById('hist-upload-title');
    var cont  = document.getElementById('hist-upload-content');
    if (!modal) return;
    title.textContent = '📋 Export Audit Log';
    var html = '<table style="width:100%;font-size:.8rem;border-collapse:collapse">' +
      '<thead><tr style="border-bottom:2px solid var(--border)">' +
      '<th style="padding:6px 8px;text-align:left">Type</th>' +
      '<th style="padding:6px 8px;text-align:left">Exported By</th>' +
      '<th style="padding:6px 8px;text-align:left">Filters</th>' +
      '<th style="padding:6px 8px;text-align:right">Rows</th>' +
      '<th style="padding:6px 8px;text-align:left">When</th>' +
      '</tr></thead><tbody>';
    (Array.isArray(rows) ? rows : []).forEach(function(r) {
      var params = '';
      try { var p = JSON.parse(r.export_params||'{}'); params = Object.entries(p).filter(function(e){ return e[1]; }).map(function(e){ return e[0]+': '+e[1]; }).join(', '); } catch(e2){}
      html += '<tr style="border-bottom:1px solid var(--border)">' +
        '<td style="padding:6px 8px;font-weight:600;color:var(--navy)">' + escH(r.export_type) + '</td>' +
        '<td style="padding:6px 8px">' + escH(r.exported_by) + '</td>' +
        '<td style="padding:6px 8px;color:var(--text-3);font-size:.76rem">' + escH(params||'—') + '</td>' +
        '<td style="padding:6px 8px;text-align:right;font-family:monospace">' + (r.row_count||0) + '</td>' +
        '<td style="padding:6px 8px;color:var(--text-3);white-space:nowrap">' + escH(String(r.exported_at).substring(0,16)) + '</td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    if (!rows.length) html = '<div style="text-align:center;padding:32px;color:var(--text-3)">No exports logged yet</div>';
    cont.innerHTML = html;
    modal.style.display = 'flex';
  } catch(e) { toast('Failed to load log: ' + e.message, 'error'); }
}