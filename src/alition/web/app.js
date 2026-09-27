// ─── State ───────────────────────────────────────────────────────────────────
let currentResult = null;
let currentInput = null;
let charts = {};
let sessionStarted = false;
let historyData = [];
let filteredHistory = [];
let compareSelection = [];
let compareCharts = {};
let currentSortValue = 'date_desc';
let pendingCmpData = null;
let hintsOn = false;
let _cmpExportData = null;  // stores full payload for compare export
let activeHistoryFilepath = null;
let pendingConfirmAction = null;
let isRecalibrationMode = false;

// Environmental Trend variables
let liveTrendLog = [];
let sessionTrendLog = [];
let sessionTrendRecording = false;
let envTrendMode = 'live';
let envTrendCharts = {};
let envTrendVisible = false;

// Ambient sensor display unit state (display only, does NOT affect calculations)
let ambientUnitTemp  = '°C';   // options: '°C', '°F', 'K'
let ambientUnitHum   = '%RH';  // options: '%RH' (humidity is always RH, no conversion needed)
let ambientUnitPress = 'hPa';  // options: 'hPa', 'Pa', 'kPa', 'mbar', 'mmHg', 'atm', 'bar', 'psi'
// Raw values from hardware (always in base units: °C, %RH, hPa)
let _rawTemp = null, _rawHum = null, _rawPress = null;

// Detail Modal variables
let currentDetailModalType = null;
let activeDetailSetpointPct = 0;

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // ── Drag-to-scroll & wheel-to-horizontal for .n-table-wrap ──
    let dragState = null;

    document.addEventListener('mousedown', (e) => {
        const wrap = e.target.closest('.n-table-wrap');
        if (!wrap || wrap.scrollWidth <= wrap.clientWidth) return;
        dragState = { el: wrap, startX: e.pageX, scrollLeft: wrap.scrollLeft };
        wrap.classList.add('dragging');
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!dragState) return;
        const dx = e.pageX - dragState.startX;
        dragState.el.scrollLeft = dragState.scrollLeft - dx;
    });

    document.addEventListener('mouseup', () => {
        if (dragState) {
            dragState.el.classList.remove('dragging');
            dragState = null;
        }
    });

    // Convert vertical mouse wheel to horizontal scroll on table wrappers
    document.addEventListener('wheel', (e) => {
        const wrap = e.target.closest('.n-table-wrap');
        if (!wrap || wrap.scrollWidth <= wrap.clientWidth) return;
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            wrap.scrollLeft += e.deltaY;
            e.preventDefault();
        }
    }, { passive: false });
});


// ─── Confirm Dialog Helper ────────────────────────────────────────────────────
let pendingCancelAction = null;

function showConfirmDialog(title, message, btnText, actionCallback, cancelText = 'Cancel', cancelCallback = null) {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    document.getElementById('confirmOkBtn').textContent = btnText;
    
    const cancelBtn = document.getElementById('confirmCancelBtn');
    if (cancelBtn) {
        cancelBtn.textContent = cancelText;
    }
    
    pendingConfirmAction = actionCallback;
    pendingCancelAction = cancelCallback;
    document.getElementById('confirmOverlay').classList.add('active');
}

function closeConfirm() {
    document.getElementById('confirmOverlay').classList.remove('active');
    const cb = pendingCancelAction;
    pendingConfirmAction = null;
    pendingCancelAction = null;
    if (cb) cb();
}

function executeConfirmAction() {
    document.getElementById('confirmOverlay').classList.remove('active');
    const cb = pendingConfirmAction;
    pendingConfirmAction = null;
    pendingCancelAction = null;
    if (cb) cb();
}

function openStartupOverlay() {
    document.body.classList.add('in-startup');
    const stOverlay = document.getElementById('startupOverlay');
    if (stOverlay) {
        stOverlay.style.display = '';
        stOverlay.classList.add('active');
    }
}

function closeStartupOverlay() {
    document.body.classList.remove('in-startup');
    const stOverlay = document.getElementById('startupOverlay');
    if (stOverlay) {
        stOverlay.style.display = '';
        stOverlay.classList.remove('active');
    }
}

// ─── New Session ──────────────────────────────────────────────────────────────
function promptNewSession() {
    const operator = (document.getElementById('metaOperator')?.value || '').trim();
    if (!sessionStarted && !operator && !currentResult) {
        openStartupOverlay();
        return;
    }
    const hasUnsaved = (currentResult && !document.getElementById('btnSaveData')?.disabled) ||
                       (window.dkdWizardState && dkdWizardState.lastRowResults && dkdWizardState.lastRowResults.length > 0 && !document.getElementById('btnSaveData')?.disabled);

    showConfirmDialog(
        'Start a New Session?',
        hasUnsaved ? 'You have unsaved analysis results. Starting a new session will discard all current data.' : 'This will clear the current session and open the startup form.',
        hasUnsaved ? 'Discard & Continue' : 'Continue',
        executeNewSession
    );
}

function executeNewSession() {
    isRecalibrationMode = false;
    currentResult = null;
    currentInput = null;
    sessionStarted = false;
    activeHistoryFilepath = null;
    
    // Destroy existing charts
    Object.keys(charts).forEach(k => { if (charts[k]) charts[k].destroy(); delete charts[k]; });
    if (window.compareCharts) {
        Object.keys(compareCharts).forEach(k => { if (compareCharts[k]) compareCharts[k].destroy(); delete compareCharts[k]; });
    }

    // Reset DKD wizard and sequence state silently (no unlock toast)
    if (typeof unlockDkdSequence === 'function') {
        unlockDkdSequence(true);
    }

    // Reset ribbon action buttons
    ['btnExportSession', 'btnSaveData', 'btnSaveAsNew', 'btnExportExcel', 'btnExportPdf'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = true;
    });

    // Reset tabs
    ['table', 'graph', 'stats', 'uncert', 'summary'].forEach(id => {
        if (typeof lockMainTab === 'function') lockMainTab(id);
    });
    if (typeof switchMainTab === 'function') switchMainTab('input');

    // Restore laboratory standard default values instead of blank strings
    const defaultVals = {
        dkdLrv: 0,
        dkdUrv: 100,
        dkdRes: 0.01,
        dkdTol: 0.5,
        dkdStdFs: 100,
        dkdStdAcc: 0.025,
        dkdUstdDwt: 0,
        dkdAlphaBeta: 0,
        dkdRhoM: 8000,
        dkdLambda: 0,
        dkdHDiff: 0.0,
        dkdMedRho: 1.2
    };
    Object.keys(defaultVals).forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.value = defaultVals[id];
            el.classList.remove('field-error');
        }
    });

    // Reset unit and calibrator dropdowns
    if (typeof setCustomSelect === 'function') {
        setCustomSelect('dkdUnit', 'bar', 'bar', null, 'dkdUnitWrap');
        setCustomSelect('dkdCalType', 'DIGITAL', 'Digital Calibrator', null, 'dkdCalTypeWrap');
    }
    if (typeof toggleDkdCalType === 'function') {
        toggleDkdCalType();
    }

    // Reset metadata input fields (empty so placeholders are displayed)
    const mOp = document.getElementById('metaOperator');
    if (mOp) mOp.value = '';
    const mMo = document.getElementById('metaModel');
    if (mMo) mMo.value = '';
    const mSn = document.getElementById('metaSerial');
    if (mSn) mSn.value = '';
    const mTg = document.getElementById('metaTag');
    if (mTg) mTg.value = '';
    const mLo = document.getElementById('metaLocation');
    if (mLo) mLo.value = '';
    const mDate = document.getElementById('metaDate');
    if (mDate) mDate.value = new Date().toISOString().split('T')[0];

    // Reset standard selection to DKD-R 6-1
    const selBtn = document.querySelector('#calStandardDropdown .cs-opt');
    if (selBtn && typeof setCalStandard === 'function') {
        setCalStandard('DKD-R 6-1', 'DKD-R 6-1 - Calibration of Pressure Gauges', selBtn);
    }

    refreshHeader();
    const scSeqEl = document.getElementById('scSeqBadge');
    if (scSeqEl) scSeqEl.textContent = 'SEQUENCE -';
    if (typeof updateLiveMetrologyPreview === 'function') {
        updateLiveMetrologyPreview();
    }

    // Reset live sensor state if hardware is not connected
    const isMqttConn = (typeof mqttConnected !== 'undefined' && mqttConnected) || 
                       document.getElementById('mqttStatusBadge')?.classList.contains('connected');
    if (!isMqttConn) {
        _rawTemp = null;
        _rawHum = null;
        _rawPress = null;
        const sT = document.getElementById('sensorTemp');
        const sH = document.getElementById('sensorHumid');
        const sP = document.getElementById('sensorPress');
        if (sT) sT.textContent = '- °C';
        if (sH) sH.textContent = '- %RH';
        if (sP) sP.textContent = '- hPa';
    }

    // Show the startup operator overlay modal cleanly
    openStartupOverlay();
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    openStartupOverlay();
    const dateEl = document.getElementById('metaDate');
    if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
    if (typeof initDataTable === 'function') initDataTable();
    if (typeof Chart !== 'undefined' && Chart && Chart.defaults) {
        Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
    }

    // Direct listener binding for Start Session button & Enter keys
    const btnStart = document.getElementById('btnStartSession');
    if (btnStart) {
        btnStart.addEventListener('click', startCalibration);
    }
    ['metaOperator', 'metaModel', 'metaSerial', 'metaTag', 'metaLocation'].forEach(id => {
        const inp = document.getElementById(id);
        if (inp) {
            inp.addEventListener('keydown', e => {
                if (e.key === 'Enter') startCalibration();
            });
        }
    });

    ['editMetaOperator', 'editMetaModel', 'editMetaSerial', 'editMetaTag', 'editMetaLocation'].forEach(id => {
        const inp = document.getElementById(id);
        if (inp) {
            inp.addEventListener('keydown', e => {
                if (e.key === 'Enter') saveEditedIdentity();
            });
        }
    });

    ['recalOperator', 'recalLocation', 'recalDate'].forEach(id => {
        const inp = document.getElementById(id);
        if (inp) {
            inp.addEventListener('keydown', e => {
                if (e.key === 'Enter') confirmStartRecalibration();
            });
        }
    });

    const certNoInp = document.getElementById('pdfPreviewCertNo');
    if (certNoInp) {
        certNoInp.addEventListener('keydown', e => {
            if (e.key === 'Enter') refreshPdfPreview();
        });
    }

    try {
        if (typeof updateLiveMetrologyPreview === 'function') {
            updateLiveMetrologyPreview();
        }
    } catch (e) {
        console.warn('updateLiveMetrologyPreview boot err:', e);
    }
});

// ─── Startup ──────────────────────────────────────────────────────────────────
function startCalibration() {
    try {
        const op = (document.getElementById('metaOperator')?.value || '').trim();
        const mo = (document.getElementById('metaModel')?.value || '').trim();
        const sn = (document.getElementById('metaSerial')?.value || '').trim();

        // Validate required fields marked with *
        if (!op || !mo || !sn) {
            showToast('Please enter Operator Name, Instrument Model, and Serial Number.', 'warning');
            if (!op) document.getElementById('metaOperator')?.focus();
            else if (!mo) document.getElementById('metaModel')?.focus();
            else if (!sn) document.getElementById('metaSerial')?.focus();
            return;
        }

        sessionStarted = true;
        closeStartupOverlay();

        // Switch workspace based on calibration standard selected
        const standard = document.getElementById('metaCalStandard')?.value || 'DKD-R 6-1';
        if (standard === 'DKD-R 6-1') {
            document.body.classList.add('dkd-mode');
        } else {
            document.body.classList.remove('dkd-mode');
        }

        refreshHeader();
        try {
            if (typeof updateLiveMetrologyPreview === 'function') {
                updateLiveMetrologyPreview();
            }
        } catch (e) {
            console.warn('updateLiveMetrologyPreview startup err:', e);
        }
    } catch (err) {
        console.error('startCalibration error:', err);
        closeStartupOverlay();
    }
}

function getMeta() {
    return {
        operator_name: document.getElementById('metaOperator')?.value.trim() || '',
        instrument_model: document.getElementById('metaModel')?.value.trim() || '',
        serial_number: document.getElementById('metaSerial')?.value.trim() || '',
        tag_number: document.getElementById('metaTag')?.value.trim() || '',
        date: document.getElementById('metaDate')?.value || new Date().toISOString().split('T')[0],
        location: document.getElementById('metaLocation')?.value.trim() || '',
        calibration_standard: document.getElementById('metaCalStandard')?.value || 'DKD-R 6-1'
    };
}

function refreshHeader() {
    const m = getMeta();

    if (sessionStarted && m.instrument_model) {
        // Session bar - individual fields
        const elOp = document.getElementById('infoOperator');
        const elMo = document.getElementById('infoModel');
        const elTg = document.getElementById('infoTag');
        const elSn = document.getElementById('infoSerial');
        const elLo = document.getElementById('infoLocation');
        const elDt = document.getElementById('infoDate');
        if (elOp) elOp.textContent = m.operator_name || '-';
        if (elMo) elMo.textContent = m.instrument_model || '-';
        if (elTg) elTg.textContent = m.tag_number || '-';
        if (elSn) elSn.textContent = m.serial_number || '-';
        if (elLo) elLo.textContent = m.location || '-';
        if (elDt) elDt.textContent = m.date || '-';
    } else {
        ['infoOperator', 'infoModel', 'infoTag', 'infoSerial', 'infoLocation', 'infoDate']
            .forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '-'; });
    }

    const badge = document.getElementById('statusBadge');
    if (badge) {
        if (currentResult) {
            badge.textContent = currentResult.overall_status;
            badge.className = `status-badge ${currentResult.overall_status === 'PASS' ? 'pass' : 'fail'}`;
        } else {
            badge.className = 'status-badge hidden';
        }
    }
}

// ─── Edit Identity Modal ──────────────────────────────────────────────────────
function openEditIdentityModal() {
    const m = getMeta();
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val || '';
    };
    setVal('editMetaOperator', m.operator_name);
    setVal('editMetaModel', m.instrument_model);
    setVal('editMetaSerial', m.serial_number);
    setVal('editMetaTag', m.tag_number);
    setVal('editMetaDate', m.date);
    setVal('editMetaLocation', m.location);

    const overlay = document.getElementById('editIdentityOverlay');
    if (overlay) overlay.classList.add('active');
    setTimeout(() => {
        const opInp = document.getElementById('editMetaOperator');
        if (opInp) opInp.focus();
    }, 100);
}

function closeEditIdentityModal() {
    const overlay = document.getElementById('editIdentityOverlay');
    if (overlay) overlay.classList.remove('active');
}

function saveEditedIdentity() {
    const op = (document.getElementById('editMetaOperator')?.value || '').trim();
    const mo = (document.getElementById('editMetaModel')?.value || '').trim();
    const sn = (document.getElementById('editMetaSerial')?.value || '').trim();
    const tg = (document.getElementById('editMetaTag')?.value || '').trim();
    const lo = (document.getElementById('editMetaLocation')?.value || '').trim();
    const dt = (document.getElementById('editMetaDate')?.value || '').trim();

    if (!op || !mo) {
        showToast('Operator and Instrument Model cannot be empty', 'error');
        return;
    }

    if (document.getElementById('metaOperator')) document.getElementById('metaOperator').value = op;
    if (document.getElementById('metaModel')) document.getElementById('metaModel').value = mo;
    if (document.getElementById('metaSerial')) document.getElementById('metaSerial').value = sn;
    if (document.getElementById('metaTag')) document.getElementById('metaTag').value = tg;
    if (document.getElementById('metaLocation')) document.getElementById('metaLocation').value = lo;
    if (document.getElementById('metaDate')) document.getElementById('metaDate').value = dt;

    if (window.dkdSetupPayload && window.dkdSetupPayload.meta) {
        window.dkdSetupPayload.meta.operator_name = op;
        window.dkdSetupPayload.meta.instrument_model = mo;
        window.dkdSetupPayload.meta.serial_number = sn;
        window.dkdSetupPayload.meta.tag_number = tg;
        window.dkdSetupPayload.meta.location = lo;
        window.dkdSetupPayload.meta.date = dt;
    }

    refreshHeader();
    closeEditIdentityModal();
    showToast('Instrument and operator identity updated successfully', 'success');
}

// ─── Data Table ───────────────────────────────────────────────────────────────
function initDataTable() {
    const dt = document.getElementById('dataTableBody');
    if (!dt) return;
    dt.innerHTML = '';
    for (let i = 0; i < 5; i++) addRow();
}
function addRow() {
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td><input type="number" step="any" placeholder="0.00"></td>
        <td><input type="text" placeholder="0.0;0.0;0.0"></td>
        <td><button class="del-row-btn" onclick="deleteThisRow(this)" title="Delete row">×</button></td>`;
    document.getElementById('dataTableBody').appendChild(tr);
}
function deleteThisRow(btn) {
    const tbody = document.getElementById('dataTableBody');
    if (tbody.rows.length > 1) btn.closest('tr').remove();
    else showToast('At least one row is required.', 'error');
}
function getTablePoints() {
    return [...document.querySelectorAll('#dataTableBody tr')].reduce((acc, row) => {
        const inputs = row.querySelectorAll('input');
        const sp = inputs[0].value.trim(), rd = inputs[1].value.trim();
        if (sp && rd) acc.push({ sp, rd });
        return acc;
    }, []);
}

// ─── DKD-R 6-1 Setup ─────────────────────────────────────────────────────────
function toggleDkdCalType() {
    const type = document.getElementById('dkdCalType').value;
    if (type === 'DIGITAL') {
        document.getElementById('dkdDigitalFields').style.display = 'flex';
        document.getElementById('dkdDwtFields').style.display = 'none';
    } else {
        document.getElementById('dkdDigitalFields').style.display = 'none';
        document.getElementById('dkdDwtFields').style.display = 'grid';
    }
}

// ─── Live Metrology Preview (Antislop Real-Time Calculation) ─────────────────
function updateLiveMetrologyPreview() {
    const unitEl = document.getElementById('dkdUnit');
    const lrvEl = document.getElementById('dkdLrv');
    const urvEl = document.getElementById('dkdUrv');
    const tolEl = document.getElementById('dkdTol');
    if (!unitEl || !lrvEl || !urvEl) return;

    const unit = unitEl.value || 'bar';
    const lrv = parseFloat(lrvEl.value) || 0;
    const urv = parseFloat(urvEl.value) || 0;
    const span = Math.max(0, urv - lrv);
    const tol = parseFloat(tolEl ? tolEl.value : '0.5') || 0;
    const mpeVal = (tol / 100.0) * span;

    // Synchronize all unit suffix tags in the form
    document.querySelectorAll('.live-unit-tag').forEach(el => {
        el.textContent = unit;
    });

    // Update UUT Span Badge
    const spanBadge = document.getElementById('uutSpanBadge');
    if (spanBadge) {
        spanBadge.textContent = `Span: ${span.toFixed(2)} ${unit}`;
    }

    // Factors to Pascal for high pressure threshold check (URV > 2500 bar = 250,000,000 Pa)
    const factors = {
        'bar': 100000.0,
        'psi': 6894.757,
        'kPa': 1000.0,
        'MPa': 1000000.0,
        'Pa': 1.0,
        'mbar': 100.0,
        'hPa': 100.0
    };
    const factor = factors[unit] || 100000.0;
    const urvPa = urv * factor;

    // Sequence assignment per DKD-R 6-1
    let seq = 'B';
    let seqReason = '';
    let preloads = 2;
    let mSeriesCount = 3;
    let seriesDesc = '3 series (M1 ↑, M2 ↓, M3 ↑)';
    let points = [0, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100];
    let stepPct = '12.5%';

    if (tol < 0.1 || urvPa > 250000000.0) {
        seq = 'A';
        preloads = 3;
        mSeriesCount = 6;
        seriesDesc = '6 series (M1 ↑, M2 ↓, M3 ↑, M4 ↓, M5 ↑, M6 ↓)';
        points = [0, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100];
        stepPct = '12.5%';
        seqReason = tol < 0.1 ? 'MPE < 0.10% (High Precision)' : 'URV > 2500 bar (High Pressure)';
    } else if (tol >= 0.1 && tol <= 0.6) {
        seq = 'B';
        preloads = 2;
        mSeriesCount = 3;
        seriesDesc = '3 series (M1 ↑, M2 ↓, M3 ↑)';
        points = [0, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100];
        stepPct = '12.5%';
        seqReason = `0.10% ≤ MPE (${tol.toFixed(2)}%) ≤ 0.60% (Industrial Standard)`;
    } else {
        seq = 'C';
        preloads = 1;
        mSeriesCount = 2;
        seriesDesc = '2 series (M1 ↑, M2 ↓)';
        points = [0, 25, 50, 75, 100];
        stepPct = '25.0%';
        seqReason = `MPE > 0.60% (Routine Verification)`;
    }

    // Update Right Panel UI
    const titleEl = document.getElementById('prevSeqTitle');
    if (titleEl) titleEl.textContent = `Sequence ${seq}`;

    const spanEl = document.getElementById('prevSpanVal');
    if (spanEl) spanEl.textContent = `${span.toFixed(2)} ${unit}`;

    const mpeEl = document.getElementById('prevMpeVal');
    if (mpeEl) mpeEl.textContent = `±${mpeVal.toFixed(3)} ${unit} (${tol.toFixed(2)}%)`;

    const preloadEl = document.getElementById('prevPreloadVal');
    if (preloadEl) preloadEl.textContent = `${preloads}× to ${urv.toFixed(1)} ${unit}`;

    const seriesEl = document.getElementById('prevSeriesVal');
    if (seriesEl) seriesEl.textContent = `${mSeriesCount} Series`;

    const ladderTitleEl = document.getElementById('prevLadderTitle');
    if (ladderTitleEl) ladderTitleEl.textContent = `Measurement Points (${points.length} Points)`;

    const stepInfoEl = document.getElementById('prevStepInfo');
    if (stepInfoEl) stepInfoEl.textContent = `Step: ${stepPct} Span`;

    const ruleSummEl = document.getElementById('dkdRuleSummaryText');
    if (ruleSummEl) ruleSummEl.textContent = `Sequence ${seq} will be locked: ${seqReason}`;

    const footerNoteEl = document.getElementById('prevFooterNote');
    if (footerNoteEl) {
        footerNoteEl.innerHTML = `<strong>Governing Standard:</strong> DKD-R 6-1 mandates <strong>Sequence ${seq}</strong> for this gauge (${seqReason}). Requires <strong>${preloads}× preloading</strong> to full scale (${urv.toFixed(1)} ${unit}) and <strong>${seriesDesc}</strong> across <strong>${points.length} test points</strong>.`;
    }

    // Populate Staircase Table Preview
    const tbody = document.getElementById('prevLadderBody');
    if (tbody) {
        let html = '';
        points.forEach((pct, idx) => {
            const nom = lrv + (pct / 100.0) * span;
            const isZero = pct === 0;
            const isFs = pct === 100;
            const typeLabel = isZero ? 'Zero Point' : (isFs ? 'Full Scale' : 'Step');
            const typeClass = isZero ? 'tag-zero' : (isFs ? 'tag-fs' : 'tag-mid');
            html += `<tr>
                <td class="td-idx">${idx + 1}</td>
                <td class="td-pct">${pct.toFixed(1)}%</td>
                <td class="td-nom"><strong>${nom.toFixed(2)}</strong> <span class="td-unit">${unit}</span></td>
                <td><span class="step-type-pill ${typeClass}">${typeLabel}</span></td>
            </tr>`;
        });
        tbody.innerHTML = html;
    }
}

let currentDkdSetup = null;

// ─── DKD Wizard State ─────────────────────────────────────────────────────────
let dkdWizardState = {
    sequence: 'A', setup: {}, lockResult: {},
    setpoints: [], mSeries: [],
    phase: 'idle',
    preloadRound: 1, preloadCycle: 0, preloadMaxCycles: 3,
    preloadStep: 'max_input',
    currentMIndex: 0, currentPointIndex: 0,
    isBourdonTube: null,
    countdownTimer: null, countdownSeconds: 0, countdownTotal: 0,
    preloadData: [],
    measurementData: {},
    zeroSettingData: null
};

async function lockDkdSequence() {
    const unitEl = document.getElementById('dkdUnit');
    const lrvEl = document.getElementById('dkdLrv');
    const urvEl = document.getElementById('dkdUrv');
    const resEl = document.getElementById('dkdRes');
    const tolEl = document.getElementById('dkdTol');
    const calTypeEl = document.getElementById('dkdCalType');
    const stdFsEl = document.getElementById('dkdStdFs');
    const stdAccEl = document.getElementById('dkdStdAcc');
    const hDiffEl = document.getElementById('dkdHDiff');
    const medRhoEl = document.getElementById('dkdMedRho');
    const ustdDwtEl = document.getElementById('dkdUstdDwt');
    const alphaBetaEl = document.getElementById('dkdAlphaBeta');
    const rhoMEl = document.getElementById('dkdRhoM');
    const lambdaEl = document.getElementById('dkdLambda');

    // Remove previous field error states
    document.querySelectorAll('.field-error').forEach(el => el.classList.remove('field-error'));

    const unit = unitEl ? unitEl.value : 'bar';
    const lrv = parseFloat(lrvEl ? lrvEl.value : '0');
    const urv = parseFloat(urvEl ? urvEl.value : '0');
    const resVal = parseFloat(resEl ? resEl.value : '0');
    const tol = parseFloat(tolEl ? tolEl.value : '0');
    const calType = calTypeEl ? calTypeEl.value : 'DIGITAL';

    if (isNaN(lrv)) {
        if (lrvEl) lrvEl.classList.add('field-error');
        showToast('Please enter a valid Lower Range Value (LRV).', 'warning');
        return;
    }
    if (isNaN(urv)) {
        if (urvEl) urvEl.classList.add('field-error');
        showToast('Please enter a valid Upper Range Value (URV).', 'warning');
        return;
    }
    if (urv <= lrv) {
        if (urvEl) urvEl.classList.add('field-error');
        showToast('URV must be greater than LRV (Span > 0).', 'warning');
        return;
    }
    if (isNaN(resVal) || resVal <= 0) {
        if (resEl) resEl.classList.add('field-error');
        showToast('Resolution must be greater than 0.', 'warning');
        return;
    }
    if (isNaN(tol) || tol <= 0) {
        if (tolEl) tolEl.classList.add('field-error');
        showToast('Tolerance / MPE (%) must be greater than 0.', 'warning');
        return;
    }

    let stdFs = 100, stdAcc = 0.025;
    if (calType === 'DIGITAL') {
        stdFs = parseFloat(stdFsEl ? stdFsEl.value : '0');
        stdAcc = parseFloat(stdAccEl ? stdAccEl.value : '0');
        if (isNaN(stdFs) || stdFs <= 0) {
            if (stdFsEl) stdFsEl.classList.add('field-error');
            showToast('Standard Full Scale must be greater than 0.', 'warning');
            return;
        }
        if (isNaN(stdAcc) || stdAcc <= 0) {
            if (stdAccEl) stdAccEl.classList.add('field-error');
            showToast('Standard Accuracy (%) must be greater than 0.', 'warning');
            return;
        }
    }

    const payload = {
        input_unit: unit,
        lrv: lrv,
        urv: urv,
        resolution: resVal,
        mpe_percent: tol,
        calibrator_type: calType,
        height_diff: parseFloat(hDiffEl ? hDiffEl.value : '0') || 0,
        medium_density: parseFloat(medRhoEl ? medRhoEl.value : '1.2') || 1.2,
        std_full_scale: stdFs,
        std_accuracy_percent: stdAcc,
        u_standard_dwt: parseFloat(ustdDwtEl ? ustdDwtEl.value : '0') || 0,
        alpha_beta: parseFloat(alphaBetaEl ? alphaBetaEl.value : '0') || 0,
        rho_m: parseFloat(rhoMEl ? rhoMEl.value : '8000') || 8000,
        lambda_val: parseFloat(lambdaEl ? lambdaEl.value : '0') || 0
    };

    // Refresh Metadata Badges globally
    refreshHeader();

    showToast('Evaluating DKD Sequence...', 'info');
    try {
        let res;
        if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.evaluate_dkd_setup === 'function') {
            res = await pywebview.api.evaluate_dkd_setup(JSON.stringify(payload));
        } else {
            // Local fallback simulation if running in a standalone browser window
            const factors = { 'bar': 1e5, 'psi': 6894.757, 'kPa': 1e3, 'MPa': 1e6, 'Pa': 1, 'mbar': 100, 'hPa': 100 };
            const f = factors[unit] || 1e5;
            const urvPa = urv * f;
            let lockedSeq = 'B';
            if (tol < 0.1 || urvPa > 250000000.0) lockedSeq = 'A';
            else if (tol >= 0.1 && tol <= 0.6) lockedSeq = 'B';
            else lockedSeq = 'C';
            const stdFsPa = stdFs * f;
            const uStdPa = ((stdAcc / 100.0) * stdFsPa) / Math.sqrt(3);
            res = {
                success: true,
                locked_sequence: lockedSeq,
                u_standard_pa: uStdPa,
                mpe_value_pa: (tol / 100.0) * (urv - lrv) * f
            };
        }

        if (!res || !res.success) {
            showToast(`Error: ${res ? res.message : 'Unknown evaluation error'}`, 'error');
            return;
        }

        currentDkdSetup = payload;
        document.querySelectorAll('.input-layout-grid input, .input-layout-grid select, .input-layout-grid button.cs-trigger').forEach(el => el.disabled = true);
        
        const dkdLockBtn = document.getElementById('dkdLockBtn');
        if (dkdLockBtn) {
            dkdLockBtn.disabled = false;
            dkdLockBtn.style.cursor = 'pointer';
            dkdLockBtn.style.color = '';
            dkdLockBtn.style.background = 'var(--amber)';
            dkdLockBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg><span>Unlock Session Parameters</span>`;
            dkdLockBtn.onclick = confirmUnlockDkdSequence;
        }
        
        const phase1Summ = document.getElementById('dkdPhase1Summary');
        if (phase1Summ) phase1Summ.style.display = 'none';
        const staircaseWrap = document.getElementById('dkdStaircaseWrapper');
        if (staircaseWrap) staircaseWrap.style.display = 'flex';
        
        buildStaircasePreview(res, payload);
        
        // Update Live Metrology Preview Tag
        const statusTag = document.getElementById('prevStatusTag');
        if (statusTag) {
            statusTag.textContent = 'LOCKED';
            statusTag.classList.add('status-locked');
        }

        showToast(`Sequence ${res.locked_sequence} locked!`, 'success');
        
        // Enable ribbon actions
        setActionsEnabled(true);
        
        // Progressive Disclosure: Unlock Tab 2 and Auto-navigate
        unlockMainTab('table');
        switchMainTab('table');
        
    } catch (e) {
        console.error('lockDkdSequence error:', e);
        showToast(`Failed: ${e.message || e}`, 'error');
    }
}

async function confirmUnlockDkdSequence() {
    if (isRecalibrationMode) {
        showToast('Instrument parameters are locked in recalibration mode to maintain history continuity and integrity.', 'warning');
        return;
    }
    showConfirmDialog(
        'Unlock Session Parameters', 
        'Are you sure you want to unlock session parameters? You can reconfigure input values and recalculate sequence.', 
        'Unlock Parameters', 
        () => {
            const btnSaveData = document.getElementById('btnSaveData');
            const hasCalculatedData = window.dkdWizardState && dkdWizardState.lastRowResults && dkdWizardState.lastRowResults.length > 0;
            const hasUnsavedData = btnSaveData && !btnSaveData.disabled && hasCalculatedData;

            if (hasUnsavedData) {
                setTimeout(() => {
                    showConfirmDialog(
                        'Unsaved Data', 
                        'You have unsaved calculation data. Do you want to save it before unlocking?', 
                        'Save & Unlock', 
                        async () => {
                            await ribbonSaveData();
                            unlockDkdSequence(false);
                        },
                        'Discard',
                        () => {
                            unlockDkdSequence(false);
                        }
                    );
                }, 100);
            } else {
                unlockDkdSequence(false);
            }
        },
        'Cancel'
    );
}

function confirmCloseApp() {
    try {
        const btnSaveData = document.getElementById('btnSaveData');
        const hasCalculatedData = window.dkdWizardState && dkdWizardState.lastRowResults && dkdWizardState.lastRowResults.length > 0;
        const hasUnsavedData = btnSaveData && !btnSaveData.disabled && hasCalculatedData;

        const doClose = () => {
            if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.close_window === 'function') {
                window.pywebview.api.close_window();
            } else {
                window.close();
            }
        };

        if (hasUnsavedData) {
            showConfirmDialog(
                'Unsaved Data', 
                'You have calculated data that is not saved yet. Do you want to save it before exiting the application?', 
                'Save & Exit', 
                async () => {
                    await ribbonSaveData();
                    doClose();
                },
                'Exit Without Saving',
                () => {
                    doClose();
                }
            );
        } else {
            doClose();
        }
    } catch (err) {
        console.error('confirmCloseApp err:', err);
        window.close();
    }
}

function handleRibbonDrag(e) {
    if (e.target.closest('button, input, select, .cs-trigger, .cs-opt, .ctb-btn, .conn-ribbon-wrap, .rb, .custom-select')) {
        return;
    }
    if (e.button === 0 && window.pywebview && window.pywebview.api && typeof window.pywebview.api.drag_window === 'function') {
        window.pywebview.api.drag_window();
    }
}

function unlockDkdSequence(silent = false) {
    if (isRecalibrationMode) {
        if (!silent) showToast('Instrument parameters are locked in recalibration mode.', 'warning');
        return;
    }
    document.querySelectorAll('.input-layout-grid input, .input-layout-grid select, .input-layout-grid button.cs-trigger').forEach(el => el.disabled = false);
    
    // Unlock and restore lock button cleanly
    const dkdLockBtn = document.getElementById('dkdLockBtn');
    if (dkdLockBtn) {
        dkdLockBtn.disabled = false;
        dkdLockBtn.style.cursor = 'pointer';
        dkdLockBtn.style.color = '';
        dkdLockBtn.style.background = 'var(--blue)';
        dkdLockBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg><span>Lock Calibration Sequence</span>`;
        dkdLockBtn.onclick = lockDkdSequence;
    }
    
    const statusTag = document.getElementById('prevStatusTag');
    if (statusTag) {
        statusTag.textContent = 'Ready to Lock';
        statusTag.classList.remove('status-locked');
    }
    const phase1Summ = document.getElementById('dkdPhase1Summary');
    if (phase1Summ) phase1Summ.style.display = 'flex';
    const staircaseWrap = document.getElementById('dkdStaircaseWrapper');
    if (staircaseWrap) staircaseWrap.style.display = 'none';
    
    // Restore the Start Preloading button area
    document.querySelectorAll('.start-preload-area').forEach(el => el.style.display = '');
    const scStartBtn = document.getElementById('scStartBtn');
    if (scStartBtn) {
        scStartBtn.disabled = false;
        scStartBtn.style.cursor = 'pointer';
        scStartBtn.style.color = '';
        scStartBtn.style.background = '';
        scStartBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start Preloading`;
        scStartBtn.onclick = startDkdWizard;
    }
    const scUnlockBtn = document.getElementById('scUnlockBtn');
    if (scUnlockBtn) {
        scUnlockBtn.style.display = 'inline-flex';
    }
    
    const resArea = document.getElementById('dkdResultsArea');
    if (resArea) resArea.style.display = 'none';

    // Hide Detail Buttons
    const btnT1 = document.getElementById('btnDetailT1');
    const btnT2 = document.getElementById('btnDetailT2');
    if (btnT1) btnT1.style.display = 'none';
    if (btnT2) btnT2.style.display = 'none';

    // Reset F1 trend session log and recording flag
    sessionTrendLog = [];
    sessionTrendRecording = false;

    closeDkdWizard();
    
    // Reset live sensor state if hardware is not connected
    const isMqttLocked = (typeof mqttConnected !== 'undefined' && mqttConnected) || 
                         document.getElementById('mqttStatusBadge')?.classList.contains('connected');
    if (!isMqttLocked) {
        _rawTemp = null;
        _rawHum = null;
        _rawPress = null;
        const sT = document.getElementById('sensorTemp');
        const sH = document.getElementById('sensorHumid');
        const sP = document.getElementById('sensorPress');
        if (sT) sT.textContent = '- °C';
        if (sH) sH.textContent = '- %RH';
        if (sP) sP.textContent = '- hPa';
    }

    // Relock tabs when unlocking sequence
    ['table', 'graph', 'stats', 'uncert', 'summary'].forEach(id => lockMainTab(id));
    switchMainTab('input'); // Force return to input tab
    
    dkdWizardState = {
        sequence: 'A', setup: {}, lockResult: {}, setpoints: [], mSeries: [],
        phase: 'idle', preloadRound: 1, preloadCycle: 0, preloadMaxCycles: 3,
        preloadStep: 'max_input', currentMIndex: 0, currentPointIndex: 0,
        isBourdonTube: null, countdownTimer: null, countdownSeconds: 0, countdownTotal: 0,
        preloadData: [], measurementData: {}, zeroSettingData: null
    };
    
    // Disable navbar export buttons on reset
    ['btnExportSession', 'btnSaveData', 'btnSaveAsNew', 'btnExportExcel', 'btnExportPdf']
        .forEach(id => { const el = document.getElementById(id); if (el) el.disabled = true; });

    currentDkdSetup = null;
    dkdSessionFilepath = null;   // clear saved path so next Save prompts new file
    if (typeof updateLiveMetrologyPreview === 'function') {
        updateLiveMetrologyPreview();
    }

    if (!silent) {
        showToast('Sequence unlocked. Parameters are editable.', 'info');
    }
}

function buildStaircasePreview(res, setup) {
    const seq = res.locked_sequence;
    const unit = setup.input_unit;
    const span = setup.urv - setup.lrv;
    let preloads, mCols, mLabels, points;
    if (seq === 'A') {
        preloads = 3; points = [0, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100];
        mLabels = ['M1 ↑', 'M2 ↓', 'M3 ↑', 'M4 ↓', 'M5 ↑', 'M6 ↓'];
        mCols = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'];
    } else if (seq === 'B') {
        preloads = 2; points = [0, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100];
        mLabels = ['M1 ↑', 'M2 ↓', 'M3 ↑'];
        mCols = ['M1', 'M2', 'M3'];
    } else {
        preloads = 1; points = [0, 25, 50, 75, 100];
        mLabels = ['M1 ↑', 'M2 ↓'];
        mCols = ['M1', 'M2'];
    }
    // Badge strip update
    const scSeqBadge = document.getElementById('scSeqBadge');
    if (scSeqBadge) scSeqBadge.textContent = `SEQUENCE ${seq}`;
    document.getElementById('scBadgeSeq').textContent = `Sequence ${seq}`;
    document.getElementById('scBadgeMpe').textContent = `${setup.mpe_percent}%`;
    document.getElementById('scBadgeUstd').textContent = `${res.u_standard_pa.toFixed(3)} Pa`;
    document.getElementById('scBadgeMseries').textContent = `${mCols.length} series`;
    document.getElementById('scBadgePreload').textContent = `${preloads}×`;
    document.getElementById('scBadgePoints').textContent = `${points.length} pts`;
    document.getElementById('scStartSeqLabel').textContent = seq;
    // Init wizard state
    dkdWizardState.sequence = seq;
    dkdWizardState.setup = setup;
    dkdWizardState.lockResult = res;
    dkdWizardState.setpoints = points;
    dkdWizardState.mSeries = mCols;
    dkdWizardState.preloadMaxCycles = preloads;
    dkdWizardState.isImported = false;
    mCols.forEach(m => { dkdWizardState.measurementData[m] = []; });
    // Build preview table header
    const thead = document.getElementById('scTableHead');
    let thHtml = `<tr><th class="sc-th-sp">SP%</th><th class="sc-th-nom">Nominal (${unit})</th>`;
    mLabels.forEach(l => thHtml += `<th class="sc-th-m">${l}</th>`);
    thead.innerHTML = thHtml + '</tr>';
    // Build preview table body
    const tbody = document.getElementById('scTableBody');
    let tbHtml = '';
    points.forEach((pct, pi) => {
        const nom = setup.lrv + (pct / 100) * span;
        tbHtml += `<tr id="scRow_${pi}" class="${pct === 100 ? 'row-max' : ''}">
            <td class="res-td-highlight">${pct}%</td>
            <td>${nom.toFixed(2)}</td>`;
        mCols.forEach(m => {
            tbHtml += `<td id="scCell_${m}_${pi}"><span class="cell-empty"></span></td>`;
        });
        tbHtml += '</tr>';
    });
    tbody.innerHTML = tbHtml;

    // Reset the Start Preloading button
    const scStartBtn = document.getElementById('scStartBtn');
    if (scStartBtn) {
        scStartBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start Preloading`;
        scStartBtn.style.background = '';
        scStartBtn.onclick = startDkdWizard;
    }
    const scUnlockBtn = document.getElementById('scUnlockBtn');
    if (scUnlockBtn) {
        scUnlockBtn.style.display = isRecalibrationMode ? 'none' : 'inline-flex';
    }
    const scBadgeUnlockBtn = document.getElementById('scBadgeUnlockBtn');
    if (scBadgeUnlockBtn) {
        scBadgeUnlockBtn.style.display = isRecalibrationMode ? 'none' : 'inline-flex';
    }
    document.querySelectorAll('.start-preload-desc').forEach(el => el.style.display = '');
    document.querySelectorAll('.start-preload-area').forEach(el => el.style.display = 'flex');
}

function updateStaircaseCell(m, ptIdx, value) {
    const cell = document.getElementById(`scCell_${m}_${ptIdx}`);
    if (cell) cell.innerHTML = `<span class="cell-filled">${parseFloat(value).toFixed(3)}</span>`;
    // Highlight current row
    document.querySelectorAll('#scTableBody tr').forEach(r => r.classList.remove('row-active'));
    const row = document.getElementById(`scRow_${ptIdx}`);
    if (row) row.classList.add('row-active');
}

function populateStaircaseTableFromState() {
    const s = dkdWizardState;
    s.mSeries.forEach(m => {
        const seriesData = s.measurementData[m] || [];
        seriesData.forEach(pt => {
            const pi = s.setpoints.indexOf(pt.setpoint_pct);
            if (pi !== -1) {
                updateStaircaseCell(m, pi, pt.reading_uut);
            }
        });
    });
}

// calculateDkdResults is defined below near the wizard functions

// ─── Analysis ─────────────────────────────────────────────────────────────────



async function runAnalyze() {
    const lrv = parseFloat(document.getElementById('cfgLrv').value);
    const urv = parseFloat(document.getElementById('cfgUrv').value);
    const tol = parseFloat(document.getElementById('cfgTol').value);
    const points = getTablePoints();
    if ([lrv, urv, tol].some(isNaN) || points.length === 0) {
        showToast('Fill in all config fields and at least one data row.', 'error'); return;
    }

    // Check for duplicate set points
    const sps = points.map(p => parseFloat(p.sp));
    const uniqueSps = new Set(sps);
    if (uniqueSps.size !== sps.length) {
        showToast('Error: Duplicate Set Points are not allowed.', 'error'); return;
    }
    const payload = JSON.stringify({ lrv, urv, tolerance: tol, metadata: getMeta(), points });
    showToast('Running analysis…', 'info');
    try {
        const res = await pywebview.api.run_analysis(payload);
        if (!res.success) { showToast(`Error: ${res.message}`, 'error'); return; }
        currentInput = res.input; currentResult = res.result;
        renderSummary(currentResult); renderAllCharts(currentInput, currentResult);
        setTabsEnabled(true); setActionsEnabled(true);
        document.getElementById('resetBtn').disabled = false;
        refreshHeader(); switchMainTab('summary');
        showToast('Analysis complete!', 'success');
    } catch (e) { showToast(`Failed: ${e}`, 'error'); }
}

// ─── Summary ──────────────────────────────────────────────────────────────────
function renderSummary(r) {
    const sc = r.overall_status === 'PASS' ? 'pass' : 'fail';
    const rows = r.point_results.map(p => `
        <tr>
            <td>${p.set_point.toFixed(2)}</td>
            <td>${p.avg_reading.toFixed(4)}</td>
            <td>${p.error_pct_span.toFixed(4)}%</td>
            <td>${p.std_dev.toFixed(4)}</td>
            <td>${p.repeatability_pct_span.toFixed(4)}%</td>
            <td><span class="badge-${p.status.toLowerCase()}">${p.status}</span></td>
        </tr>`).join('');

    document.getElementById('summaryContent').innerHTML = `
        <div class="kpi-row">
            <div class="kpi-card ${sc}">
                <div class="kpi-lbl" data-hint="Overall pass/fail verdict based on tolerance limit.">Overall Verdict</div>
                <div class="kpi-val ${sc}">${r.overall_status}</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-lbl" data-hint="Maximum error observed across all test points.">Max Error</div>
                <div class="kpi-val">${r.max_error_pct_span.toFixed(4)}<span class="kpi-unit">%FS</span></div>
            </div>
            <div class="kpi-card">
                <div class="kpi-lbl" data-hint="Actual instrument accuracy based on calibration results.">Accuracy</div>
                <div class="kpi-val">±${r.actual_accuracy_pct.toFixed(4)}<span class="kpi-unit">%</span></div>
            </div>
            <div class="kpi-card">
                <div class="kpi-lbl" data-hint="Linearity error (maximum residual from best-fit line).">Linearity Error</div>
                <div class="kpi-val">${r.linearity_error_pct.toFixed(4)}<span class="kpi-unit">%FS</span></div>
            </div>
        </div>

        <div class="metrics-strip">
            <div class="metric-cell"><div class="m-lbl" data-hint="Average error (bias) across all points.">Mean Bias</div><div class="m-val">${r.mean_error.toFixed(5)}</div></div>
            <div class="metric-cell"><div class="m-lbl" data-hint="Standard deviation of readings (precision).">Std Deviation</div><div class="m-val">${r.std_dev.toFixed(5)}</div></div>
            <div class="metric-cell"><div class="m-lbl" data-hint="Root Mean Square Error.">RMSE</div><div class="m-val">${r.rmse.toFixed(5)}</div></div>
            <div class="metric-cell"><div class="m-lbl" data-hint="Error observed at zero point (LRV).">Zero Error</div><div class="m-val">${r.zero_error.toFixed(5)}</div></div>
            <div class="metric-cell"><div class="m-lbl" data-hint="Error across the measurement span.">Span Error</div><div class="m-val">${r.span_error.toFixed(5)}</div></div>
        </div>

        <div class="points-card">
            <div class="points-hdr">Point-by-Point Results</div>
            <table class="points-table">
                <thead><tr>
                    <th>Set Point</th><th>Avg Reading</th><th>Error %FS</th>
                    <th>Std Dev</th><th>Repeatability %FS</th><th>Status</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;

    document.getElementById('summaryEmpty').classList.add('hidden');
    document.getElementById('summaryContent').classList.remove('hidden');
}

// ─── Charts ───────────────────────────────────────────────────────────────────
function baseOpts(xLabel, yLabel) {
    return {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 350, easing: 'easeInOutQuart' },
        plugins: {
            legend: { labels: { color: '#5a5f7a', padding: 16, font: { size: 12 } } },
            tooltip: { backgroundColor: '#fff', borderColor: '#e2e5ef', borderWidth: 1, titleColor: '#1a1d2e', bodyColor: '#5a5f7a', padding: 10 }
        },
        scales: {
            x: { title: { display: true, text: xLabel, color: '#9096b4', font: { size: 11 } }, ticks: { color: '#9096b4', font: { size: 11 } }, grid: { color: '#ebebf0' } },
            y: { title: { display: true, text: yLabel, color: '#9096b4', font: { size: 11 } }, ticks: { color: '#9096b4', font: { size: 11 } }, grid: { color: '#ebebf0' } }
        }
    };
}

function renderAllCharts(inp, res) {
    const pts = res.point_results;
    const setPoints = pts.map(p => p.set_point);
    const avgRead = pts.map(p => p.avg_reading);
    const errPct = pts.map(p => p.error_pct_span);
    const tol = inp.tolerance_pct;

    if (charts.cal) charts.cal.destroy();
    charts.cal = new Chart(document.getElementById('calChart'), {
        type: 'line',
        data: {
            labels: setPoints,
            datasets: [
                { label: 'Measured', data: avgRead, borderColor: '#3b6ef8', backgroundColor: 'rgba(59,110,248,0.07)', pointBackgroundColor: '#3b6ef8', pointRadius: 5, pointHoverRadius: 7, borderWidth: 2, tension: 0.15, fill: true },
                { label: 'Ideal Reference', data: [inp.lrv, inp.urv], borderColor: '#c0c4d4', borderDash: [5, 4], pointRadius: 0, borderWidth: 1.5 }
            ]
        },
        options: baseOpts('Set Point', 'Measured Output')
    });

    if (charts.err) charts.err.destroy();
    charts.err = new Chart(document.getElementById('errChart'), {
        type: 'line',
        data: {
            labels: setPoints,
            datasets: [{ label: 'Error %FS', data: errPct, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.07)', pointBackgroundColor: errPct.map(e => Math.abs(e) > tol ? '#ef4444' : '#22c55e'), pointRadius: 5, pointHoverRadius: 7, borderWidth: 2, tension: 0.15, fill: true }]
        },
        options: baseOpts('Set Point', 'Error (% Full Span)')
    });

    const n = setPoints.length;
    const sx = setPoints.reduce((a, b) => a + b, 0), sy = avgRead.reduce((a, b) => a + b, 0);
    const sxy = setPoints.reduce((s, x, i) => s + x * avgRead[i], 0), sx2 = setPoints.reduce((s, x) => s + x * x, 0);
    const a = (n * sxy - sx * sy) / (n * sx2 - sx * sx), b = (sy - a * sx) / n;
    const residuals = setPoints.map((x, i) => avgRead[i] - (a * x + b));

    if (charts.res) charts.res.destroy();
    charts.res = new Chart(document.getElementById('resChart'), {
        type: 'scatter',
        data: { datasets: [{ label: 'Residuals', data: setPoints.map((x, i) => ({ x, y: residuals[i] })), backgroundColor: '#8b5cf6', pointRadius: 6, pointHoverRadius: 8, borderColor: '#f0f2f7', borderWidth: 2 }] },
        options: baseOpts('Set Point', 'Residual from Best-Fit Line')
    });
}

// ─── History & Instrument Lifecycle Hub ──────────────────────────────────────
let instrumentsData = [];
let filteredInstruments = [];
let currentHistoryTab = 'instruments';
let activeRecalInstrument = null;
let activeDriftInstrument = null;
let driftChartInstances = { error: null, zero: null, uncertainty: null };
let driftDetailsData = null;

function switchHistoryTab(tab) {
    currentHistoryTab = tab;
    document.querySelectorAll('.htab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.htab-panel').forEach(p => p.classList.remove('active'));
    
    if (tab === 'instruments') {
        const btn = document.getElementById('htabBtn_instruments');
        const panel = document.getElementById('htab_panel_instruments');
        if (btn) btn.classList.add('active');
        if (panel) panel.classList.add('active');
        applyInstrumentFilter();
    } else {
        const btn = document.getElementById('htabBtn_sessions');
        const panel = document.getElementById('htab_panel_sessions');
        if (btn) btn.classList.add('active');
        if (panel) panel.classList.add('active');
        applyHistoryFilter();
    }
}

async function refreshHistoryData() {
    const [insts, list] = await Promise.all([
        pywebview.api.get_instruments_list(),
        pywebview.api.get_history_list()
    ]);
    instrumentsData = insts || [];
    historyData = list || [];
    
    const countInst = document.getElementById('htabCount_instruments');
    const countSess = document.getElementById('htabCount_sessions');
    if (countInst) countInst.textContent = instrumentsData.length;
    if (countSess) countSess.textContent = historyData.length;
    
    applyInstrumentFilter();
    applyHistoryFilter();
}

async function openHistoryDialog() {
    document.getElementById('startupOverlay').classList.remove('active');
    compareSelection = [];
    updateCompareBtn();
    
    const srchS = document.getElementById('historySearch');
    const srchI = document.getElementById('instrumentSearch');
    const srt = document.getElementById('historySort');
    if (srchS) srchS.value = '';
    if (srchI) srchI.value = '';
    if (srt) srt.value = 'date_desc';

    await refreshHistoryData();
    switchHistoryTab(currentHistoryTab || 'instruments');
    document.getElementById('historyOverlay').classList.add('active');
}

function applyInstrumentFilter() {
    const q = (document.getElementById('instrumentSearch')?.value || '').trim().toLowerCase();
    filteredInstruments = q
        ? instrumentsData.filter(i =>
            [i.serial_number, i.model, i.tag_number || '', i.last_operator || '', i.last_location || '', i.last_status || '']
                .some(v => String(v).toLowerCase().includes(q)))
        : [...instrumentsData];
    renderInstrumentTable();
}

let expandedInstruments = new Set();

function toggleInstrumentExpand(sn) {
    if (expandedInstruments.has(sn)) {
        expandedInstruments.delete(sn);
    } else {
        while (expandedInstruments.size >= 2) {
            const oldest = expandedInstruments.values().next().value;
            expandedInstruments.delete(oldest);
        }
        expandedInstruments.add(sn);
    }
    renderInstrumentTable();
}

function renderInstrumentTable() {
    const tbody = document.querySelector('#instrumentTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (filteredInstruments.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:28px;color:var(--mx-muted)">No registered instrument data found.</td></tr>`;
        return;
    }

    filteredInstruments.forEach(inst => {
        const sc = inst.last_status === 'PASS' ? 'badge-pass' : 'badge-fail';
        const displaySn = inst.display_serial || inst.serial_number;
        const tagSub = inst.tag_number ? `<div class="tag-sub">Tag: ${inst.tag_number}</div>` : '';
        const specsText = `${inst.specs.lrv} ~ ${inst.specs.urv} ${inst.specs.unit} <span style="font-size:11px; color:#64748b;">(±${inst.specs.mpe_percent}%)</span>`;
        const snEscaped = String(inst.serial_number).replace(/'/g, "\\'").replace(/"/g, '&quot;');
        const isExp = expandedInstruments.has(inst.serial_number);

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="text-align:center;">
                <button class="btn-expand-inst ${isExp ? 'expanded' : ''}" onclick="toggleInstrumentExpand('${snEscaped}')" title="Click to display calibration session summary">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
            </td>
            <td>
                <span class="sn-badge">${displaySn}</span>
                ${tagSub}
            </td>
            <td>
                <div style="font-weight: 600; color: #0f172a;">${inst.model}</div>
                <div style="font-size: 11px; color: #64748b;">Standard: ${inst.last_standard}</div>
            </td>
            <td style="text-align:center">${specsText}</td>
            <td style="text-align:center">
                <span class="seq-pill">Seq ${inst.specs.sequence || inst.last_sequence || 'A'}</span>
            </td>
            <td style="text-align:center">
                <button class="cal-count-btn" onclick="openInstrumentDriftModal('${snEscaped}', 'sessionsTable')" title="Open all tables and history for this instrument">
                    ${inst.calibration_count} Sessions
                </button>
            </td>
            <td style="text-align:center">
                <span class="${sc}">${inst.last_status}</span>
            </td>
            <td>
                <div style="font-weight: 500;">${inst.last_date}</div>
                <div style="font-size: 11px; color: #64748b;">${inst.last_operator} (${inst.last_location || 'Lab'})</div>
            </td>
            <td style="text-align:center;">
                <div class="inst-action-btns">
                    <button class="btn-action-icon btn-open-table" onclick="openInstrumentDriftModal('${snEscaped}', 'sessionsTable')" title="Open Complete Measurement Tables">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                    <button class="btn-action-icon btn-recal" onclick="openRecalibrateModal('${snEscaped}')" title="Recalibrate Instrument">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                        </svg>
                    </button>
                    <button class="btn-action-icon btn-inst-export" onclick="exportInstrumentBundleDirect('${snEscaped}')" title="Export Complete Instrument History">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);

        // Expanded sub-row
        if (isExp) {
            const expTr = document.createElement('tr');
            expTr.className = 'inst-expanded-row';

            // Filter matching sessions from historyData
            const matchingSessions = historyData.filter(h => {
                const sn = (h.serial_number || '').trim();
                if (!sn && inst.serial_number.startsWith('UNKNOWN-')) {
                    return `UNKNOWN-${(h.model || 'Instrument').replace(/\s+/g, '_')}` === inst.serial_number;
                }
                return sn === inst.serial_number;
            });
            // Sort sessions newest first and limit to max 2 recent calibrations
            matchingSessions.sort((a, b) => String(b.raw_timestamp || b.date).localeCompare(String(a.raw_timestamp || a.date)));
            const displayedSessions = matchingSessions.slice(0, 2);

            let subRowsHtml = '';
            if (displayedSessions.length === 0) {
                subRowsHtml = `<tr><td colspan="7" style="text-align:center; padding:12px; color:#64748b;">No detailed calibration sessions found.</td></tr>`;
            } else {
                displayedSessions.forEach((s, sIdx) => {
                    const sStatusCls = s.status === 'PASS' ? 'badge-pass' : 'badge-fail';
                    const impBadge = s.is_imported ? `<span style="font-size:10px; color:#64748b; font-weight:600; margin-left:4px; letter-spacing:0.02em;">[IMPORTED]</span>` : '';
                    const sFp = (s.filepath || '').replace(/\\/g, '\\\\');
                    const seqName = s.sequence || s.dkd_sequence || 'A';
                    const originalActNum = matchingSessions.length - sIdx;
                    const isLatest = sIdx === 0;
                    subRowsHtml += `
                        <tr>
                            <td style="font-weight:600; color:#0f172a;">
                                Calibration #${originalActNum}
                                ${isLatest ? '<span style="font-size:11px; color:#64748b; font-weight:500; margin-left:6px;">(Recent)</span>' : ''}
                            </td>
                            <td style="text-align:center;"><span class="seq-pill">Seq ${seqName}</span></td>
                            <td>${s.date} ${impBadge}</td>
                            <td>${s.operator} (${s.location || 'Lab'})</td>
                            <td>${s.calibration_standard || 'Default'}</td>
                            <td style="text-align:center;"><span class="${sStatusCls}">${s.status}</span></td>
                            <td style="text-align:center;">
                                <div class="inst-action-btns">
                                    <button class="btn-action-icon btn-open-table" onclick="openInstrumentDriftModal('${snEscaped}', 'sessionsTable', ${matchingSessions.length - 1 - sIdx})" title="Open Measurement Table for this Session">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>
                                        </svg>
                                    </button>
                                    <button class="btn-action-icon" onclick="loadHistoryEntry('${sFp}')" title="Load Session to Workspace">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M5 12h14M12 5l7 7-7 7"/>
                                        </svg>
                                    </button>
                                </div>
                            </td>
                        </tr>
                    `;
                });
            }

            const footerNoteHtml = matchingSessions.length > 2
                ? `<div class="inst-expanded-footer-note">
                       <span>Showing 2 most recent calibrations of ${matchingSessions.length} total activities.</span>
                       <button type="button" onclick="openInstrumentDriftModal('${snEscaped}', 'sessionsTable')">Open full history &amp; calendar &rarr;</button>
                   </div>`
                : '';

            expTr.innerHTML = `
                <td colspan="9">
                    <div class="inst-expanded-container">
                        <div class="inst-expanded-header">
                            <div class="inst-expanded-title">
                                Recent Calibrations for SN <span class="sn-badge">${displaySn}</span>
                                <span class="inst-count-chip">(${matchingSessions.length} Total Sessions)</span>
                            </div>
                        </div>
                        <table class="inst-inline-table">
                            <thead>
                                <tr>
                                    <th>Activity</th>
                                    <th style="text-align:center; width:90px;">Sequence</th>
                                    <th>Calibration Date</th>
                                    <th>Operator & Location</th>
                                    <th>Calibration Standard</th>
                                    <th style="text-align:center;">Status</th>
                                    <th style="text-align:center; width:80px;"></th>
                                </tr>
                            </thead>
                            <tbody>${subRowsHtml}</tbody>
                        </table>
                        ${footerNoteHtml}
                    </div>
                </td>
            `;
            tbody.appendChild(expTr);
        }
    });
}

function applyHistoryFilter() {
    const q = (document.getElementById('historySearch')?.value || '').trim().toLowerCase();
    filteredHistory = q
        ? historyData.filter(h =>
            [h.date, h.model, h.operator, h.location || '', h.serial_number || '', h.tag_number || '', h.status]
                .some(v => String(v).toLowerCase().includes(q)))
        : [...historyData];
    const [field, dir] = currentSortValue.split('_');
    filteredHistory.sort((a, b) => {
        const map = { date: 'raw_timestamp', name: 'operator', instrument: 'model', location: 'location', tag: 'tag_number', serial: 'serial_number' };
        const key = map[field] || 'raw_timestamp';
        const cmp = String(a[key] || '').localeCompare(String(b[key] || ''));
        return dir === 'asc' ? cmp : -cmp;
    });
    renderHistoryTable();
}

function renderHistoryTable() {
    const tbody = document.querySelector('#historyTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (filteredHistory.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:28px;color:var(--mx-muted)">No history records found.</td></tr>`;
        return;
    }
    filteredHistory.forEach(h => {
        const sc = h.status === 'PASS' ? 'badge-pass' : 'badge-fail';
        const fp = h.filepath.replace(/\\/g, '\\\\');
        const selIdx = compareSelection.findIndex(s => s.filepath === h.filepath);
        const isSel = selIdx >= 0;
        const hStd = h.calibration_standard || 'Default';
        const hSeq = h.dkd_sequence || 'A';
        const hSP  = (h.dkd_setpoints || []).map(Number).sort((a, b) => a - b);

        let isDis = !isSel && compareSelection.length >= 2;
        if (!isSel && compareSelection.length === 1) {
            const first = compareSelection[0];
            const fSP = [...(first.setpoints || [])].sort((a, b) => a - b);
            const stdMismatch = first.standard !== hStd;
            const seqMismatch = hStd === 'DKD-R 6-1' && first.dkdSeq !== hSeq;
            const spMismatch  = fSP.length !== hSP.length || fSP.some((v, i) => v !== hSP[i]);
            if (stdMismatch || seqMismatch || spMismatch) isDis = true;
        }

        let timeStr = '';
        if (h.is_imported && h.imported_at) {
            try {
                const dt = new Date(h.imported_at);
                timeStr = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const impBy = h.imported_by ? ` by ${h.imported_by}` : '';
                timeStr = timeStr + ` (Imported${impBy})`;
            } catch (e) { }
        } else if (h.raw_timestamp) {
            try {
                const dt = new Date(h.raw_timestamp);
                timeStr = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            } catch (e) { }
        }

        const importBadge = h.is_imported
            ? `<span style="font-size: 10px; color: #64748b; margin-left: 6px; font-weight: 600; vertical-align: middle;" title="Imported by: ${h.imported_by || 'Unknown'}">[IMPORTED]</span>`
            : '';

        const stdVal = hStd;
        const isDkd  = stdVal === 'DKD-R 6-1';
        const dkdSeq = isDkd ? hSeq : '';

        const spEncoded = JSON.stringify(hSP).replace(/"/g, '&quot;');
        const tr = document.createElement('tr');
        if (isSel) tr.classList.add('row-selected');
        const chkCell = isSel
            ? `<button class="sel-badge-btn" onclick="unselectCompare('${fp}')" title="Click to deselect"><span class="sel-badge">${selIdx + 1}</span></button>`
            : `<input type="checkbox" class="cmp-chk" ${isDis ? 'disabled' : ''}
                 onchange="toggleCompareSelection('${fp}','${h.model.replace(/'/g, "\\'").replace(/"/g, '&quot;')}','${stdVal.replace(/'/g, "\\'").replace(/"/g, '&quot;')}','${dkdSeq}','${spEncoded}',this)">`;
        tr.innerHTML = `
            <td class="col-chk"><div class="cmp-chk-cell">${chkCell}</div></td>
            <td>
                <span class="sn-badge">${h.serial_number || '-'}</span>
                ${h.tag_number ? `<div class="tag-sub">Tag: ${h.tag_number}</div>` : ''}
            </td>
            <td>
                <div style="font-weight:600; color:#0f172a;">${h.model || '-'}</div>
            </td>
            <td style="text-align:center; width:95px;">
                <span class="seq-pill">Seq ${hSeq}</span>
            </td>
            <td style="text-align:center;">
                <span class="std-badge${isDkd ? ' dkd' : ''}">${stdVal}</span>
            </td>
            <td>
                <div style="font-weight:500; color:#1e293b;">${h.operator || '-'}</div>
                <div class="tag-sub">${h.location || '-'}</div>
            </td>
            <td>
                <div style="display:flex; align-items:center; gap:6px;">
                    <span style="font-weight:500;">${h.date}</span>
                    ${importBadge}
                </div>
                <div class="saved-time">${timeStr}</div>
            </td>
            <td style="text-align:center;">
                <span class="${sc}">${h.status}</span>
            </td>
            <td style="text-align:center; width:105px;">
                <div class="inst-action-btns">
                    <button class="btn-action-icon btn-load" onclick="loadHistoryEntry('${fp}')" title="Load Session to Workspace">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M5 12h14M12 5l7 7-7 7"/>
                        </svg>
                    </button>
                    <button class="btn-action-icon btn-inst-export" onclick="exportSingleSessionFile('${fp}')" title="Export Session File">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                    </button>
                    <button class="btn-action-icon btn-del" onclick="deleteHistoryEntry('${fp}')" title="Delete Session Record">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/>
                        </svg>
                    </button>
                </div>
            </td>`;
        tbody.appendChild(tr);
    });
}

// ── Export Handlers ──────────────────────────────────────────────────────────
async function exportSingleSessionFile(filepath) {
    showToast('Preparing session file export...', 'info');
    try {
        const res = await pywebview.api.export_single_session_history(filepath);
        if (res.success) showToast('Session file exported successfully!', 'success');
        else if (res.message !== 'Export cancelled.') showToast(`Export failed: ${res.message}`, 'error');
    } catch (e) {
        showToast(`Export error: ${e}`, 'error');
    }
}

async function exportInstrumentBundleDirect(serialNumber) {
    showToast('Exporting complete instrument history...', 'info');
    try {
        const res = await pywebview.api.export_instrument_bundle(serialNumber);
        if (res.success) showToast('Instrument bundle exported successfully!', 'success');
        else if (res.message !== 'Export cancelled.') showToast(`Export failed: ${res.message}`, 'error');
    } catch (e) {
        showToast(`Export error: ${e}`, 'error');
    }
}

// ── Recalibration Flow Handlers ──────────────────────────────────────────────
function openRecalibrateModal(serialNumber) {
    const inst = instrumentsData.find(i => i.serial_number === serialNumber);
    if (!inst) {
        showToast('Instrument not found.', 'error');
        return;
    }
    activeRecalInstrument = inst;
    
    const specsBox = document.getElementById('recalSpecsBox');
    if (specsBox) {
        specsBox.innerHTML = `
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12.5px;">
                <div><span style="color:#64748b;">Serial Number:</span> <b style="font-family:monospace; color:#1d4ed8;">${inst.display_serial || inst.serial_number}</b></div>
                <div><span style="color:#64748b;">Model:</span> <b>${inst.model}</b></div>
                <div><span style="color:#64748b;">Tag Number:</span> <b>${inst.tag_number || '-'}</b></div>
                <div><span style="color:#64748b;">Standard:</span> <b>${inst.last_standard}</b></div>
                <div><span style="color:#64748b;">Measurement Range:</span> <b>${inst.specs.lrv} ~ ${inst.specs.urv} ${inst.specs.unit}</b></div>
                <div><span style="color:#64748b;">Tolerance (MPE):</span> <b>±${inst.specs.mpe_percent}% FS</b></div>
            </div>
        `;
    }

    const opInp = document.getElementById('recalOperator');
    const locInp = document.getElementById('recalLocation');
    const dateInp = document.getElementById('recalDate');

    if (opInp) opInp.value = inst.last_operator || '';
    if (locInp) locInp.value = inst.last_location || '';
    if (dateInp) dateInp.value = new Date().toISOString().slice(0, 10);

    document.getElementById('recalibrateOverlay').classList.add('active');
    setTimeout(() => {
        const opEl = document.getElementById('recalOperator');
        if (opEl) {
            opEl.focus();
            opEl.select();
        }
    }, 100);
}

function closeRecalibrateModal() {
    const el = document.getElementById('recalibrateOverlay');
    if (el) el.classList.remove('active');
    activeRecalInstrument = null;
}

async function confirmStartRecalibration() {
    if (!activeRecalInstrument) return;
    const inst = activeRecalInstrument;
    const newOp = document.getElementById('recalOperator')?.value.trim() || 'Technician';
    const newLoc = document.getElementById('recalLocation')?.value.trim() || 'Calibration Lab';
    const newDate = document.getElementById('recalDate')?.value || new Date().toISOString().split('T')[0];

    // 1. Mark session started immediately to avoid closeHistoryDialog triggering openStartupOverlay
    sessionStarted = true;

    // 2. Close all modal overlays cleanly
    closeRecalibrateModal();
    const histOverlay = document.getElementById('historyOverlay');
    if (histOverlay) histOverlay.classList.remove('active');
    const driftOverlay = document.getElementById('instrumentDriftOverlay');
    if (driftOverlay) driftOverlay.classList.remove('active');
    closeStartupOverlay();
    document.body.classList.remove('in-startup');

    // 3. Populate global metadata inputs
    const mOp = document.getElementById('metaOperator');
    if (mOp) mOp.value = newOp;
    const mLo = document.getElementById('metaLocation');
    if (mLo) mLo.value = newLoc;
    const mDate = document.getElementById('metaDate');
    if (mDate) mDate.value = newDate;
    const mSn = document.getElementById('metaSerial');
    if (mSn) mSn.value = inst.display_serial || inst.serial_number;
    const mMo = document.getElementById('metaModel');
    if (mMo) mMo.value = inst.model;
    const mTg = document.getElementById('metaTag');
    if (mTg) mTg.value = inst.tag_number || '';

    const standard = inst.last_standard || 'DKD-R 6-1';
    const mStd = document.getElementById('metaCalStandard');
    if (mStd) mStd.value = standard;

    // 4. Clear existing result/calculation states
    currentResult = null;
    currentInput = null;
    activeHistoryFilepath = null;
    dkdSessionFilepath = null;

    Object.keys(charts).forEach(k => { if (charts[k]) charts[k].destroy(); delete charts[k]; });
    if (window.compareCharts) {
        Object.keys(compareCharts).forEach(k => { if (compareCharts[k]) compareCharts[k].destroy(); delete compareCharts[k]; });
    }

    ['btnExportSession', 'btnSaveData', 'btnSaveAsNew', 'btnExportExcel', 'btnExportPdf'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = true;
    });

    // 5. Apply instrument specs and prepare locked setup workspace
    isRecalibrationMode = true;

    if (standard === 'DKD-R 6-1') {
        document.body.classList.add('dkd-mode');

        const unit = inst.specs?.unit || 'bar';
        if (typeof setCustomSelect === 'function') {
            setCustomSelect('dkdUnit', unit, unit, document.querySelector(`#dkdUnitDropdown .cs-opt[onclick*="'${unit}'"]`), 'dkdUnitWrap');
        }

        const lrv = parseFloat(inst.specs?.lrv !== undefined ? inst.specs.lrv : '0');
        const urv = parseFloat(inst.specs?.urv !== undefined ? inst.specs.urv : '100');
        const resVal = parseFloat(inst.specs?.resolution !== undefined ? inst.specs.resolution : '0.01');
        const tol = parseFloat(inst.specs?.mpe_percent !== undefined ? inst.specs.mpe_percent : '0.5');
        const calType = document.getElementById('dkdCalType')?.value || 'DIGITAL';
        const stdFs = parseFloat(document.getElementById('dkdStdFs')?.value || '100') || 100;
        const stdAcc = parseFloat(document.getElementById('dkdStdAcc')?.value || '0.025') || 0.025;

        if (document.getElementById('dkdLrv')) document.getElementById('dkdLrv').value = lrv;
        if (document.getElementById('dkdUrv')) document.getElementById('dkdUrv').value = urv;
        if (document.getElementById('dkdRes')) document.getElementById('dkdRes').value = resVal;
        if (document.getElementById('dkdTol')) document.getElementById('dkdTol').value = tol;

        // Construct calibration setup payload
        const payload = {
            input_unit: unit,
            lrv: lrv,
            urv: urv,
            resolution: resVal,
            mpe_percent: tol,
            calibrator_type: calType,
            height_diff: parseFloat(document.getElementById('dkdHDiff')?.value || '0') || 0,
            medium_density: parseFloat(document.getElementById('dkdMedRho')?.value || '1.2') || 1.2,
            std_full_scale: stdFs,
            std_accuracy_percent: stdAcc,
            u_standard_dwt: parseFloat(document.getElementById('dkdUstdDwt')?.value || '0') || 0,
            alpha_beta: parseFloat(document.getElementById('dkdAlphaBeta')?.value || '0') || 0,
            rho_m: parseFloat(document.getElementById('dkdRhoM')?.value || '8000') || 8000,
            lambda_val: parseFloat(document.getElementById('dkdLambda')?.value || '0') || 0
        };

        // Evaluate DKD sequence automatically
        let res;
        try {
            if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.evaluate_dkd_setup === 'function') {
                res = await pywebview.api.evaluate_dkd_setup(JSON.stringify(payload));
            } else {
                const factors = { 'bar': 1e5, 'psi': 6894.757, 'kPa': 1e3, 'MPa': 1e6, 'Pa': 1, 'mbar': 100, 'hPa': 100 };
                const f = factors[unit] || 1e5;
                const urvPa = urv * f;
                let lockedSeq = 'B';
                if (tol < 0.1 || urvPa > 250000000.0) lockedSeq = 'A';
                else if (tol >= 0.1 && tol <= 0.6) lockedSeq = 'B';
                else lockedSeq = 'C';
                const stdFsPa = stdFs * f;
                const uStdPa = ((stdAcc / 100.0) * stdFsPa) / Math.sqrt(3);
                res = {
                    success: true,
                    locked_sequence: lockedSeq,
                    u_standard_pa: uStdPa,
                    mpe_value_pa: (tol / 100.0) * (urv - lrv) * f
                };
            }
        } catch (e) {
            console.error('DKD evaluate recalibration err:', e);
        }

        if (!res || !res.success) {
            const factors = { 'bar': 1e5, 'psi': 6894.757, 'kPa': 1e3, 'MPa': 1e6, 'Pa': 1, 'mbar': 100, 'hPa': 100 };
            const f = factors[unit] || 1e5;
            res = {
                success: true,
                locked_sequence: 'B',
                u_standard_pa: 0,
                mpe_value_pa: (tol / 100.0) * (urv - lrv) * f
            };
        }

        currentDkdSetup = payload;

        // Lock all inputs in User's Input pane completely
        document.querySelectorAll('.input-layout-grid input, .input-layout-grid select, .input-layout-grid button.cs-trigger').forEach(el => el.disabled = true);

        // Build staircase preview map
        buildStaircasePreview(res, payload);

        // Hide phase 1 summary, display staircase wrapper
        const phase1Summ = document.getElementById('dkdPhase1Summary');
        if (phase1Summ) phase1Summ.style.display = 'none';
        const staircaseWrap = document.getElementById('dkdStaircaseWrapper');
        if (staircaseWrap) staircaseWrap.style.display = 'flex';

        // Lock button becomes a permanent disabled indicator for recalibration mode
        const dkdLockBtn = document.getElementById('dkdLockBtn');
        if (dkdLockBtn) {
            dkdLockBtn.disabled = true;
            dkdLockBtn.onclick = null;
            dkdLockBtn.style.cursor = 'not-allowed';
            dkdLockBtn.style.background = '#e2e8f0';
            dkdLockBtn.style.color = '#475569';
            dkdLockBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg><span>Locked Parameters (Recalibration Mode)</span>`;
        }

        // Hide unlock buttons so parameters cannot be unlocked
        const scUnlockBtn = document.getElementById('scUnlockBtn');
        if (scUnlockBtn) scUnlockBtn.style.display = 'none';
        const scBadgeUnlockBtn = document.getElementById('scBadgeUnlockBtn');
        if (scBadgeUnlockBtn) scBadgeUnlockBtn.style.display = 'none';

        // Update preview status tag
        const statusTag = document.getElementById('prevStatusTag');
        if (statusTag) {
            statusTag.textContent = 'LOCKED (RE-CAL)';
            statusTag.classList.add('status-locked');
        }

        const scSeqEl = document.getElementById('scSeqBadge');
        if (scSeqEl) scSeqEl.textContent = `SEQUENCE ${res.locked_sequence} (RE-CAL)`;
    } else {
        document.body.classList.remove('dkd-mode');

        if (document.getElementById('lrvInput') && inst.specs?.lrv !== undefined) {
            document.getElementById('lrvInput').value = inst.specs.lrv;
        }
        if (document.getElementById('urvInput') && inst.specs?.urv !== undefined) {
            document.getElementById('urvInput').value = inst.specs.urv;
        }
        if (document.getElementById('tolInput') && inst.specs?.mpe_percent !== undefined) {
            document.getElementById('tolInput').value = inst.specs.mpe_percent;
        }

        document.querySelectorAll('#pane_input input, #pane_input select').forEach(el => el.disabled = true);

        const scSeqEl = document.getElementById('scSeqBadge');
        if (scSeqEl) scSeqEl.textContent = `RE-CALIBRATION`;
    }

    // 6. Sync global dkdSetupPayload if exists
    if (window.dkdSetupPayload && window.dkdSetupPayload.meta) {
        window.dkdSetupPayload.meta.operator_name = newOp;
        window.dkdSetupPayload.meta.location = newLoc;
        window.dkdSetupPayload.meta.date = newDate;
        window.dkdSetupPayload.meta.serial_number = inst.display_serial || inst.serial_number;
        window.dkdSetupPayload.meta.instrument_model = inst.model;
        window.dkdSetupPayload.meta.tag_number = inst.tag_number || '';
    }

    // 7. Refresh Header to immediately display new operator, instrument, date
    refreshHeader();

    try {
        if (typeof updateLiveMetrologyPreview === 'function') {
            updateLiveMetrologyPreview();
        }
    } catch (e) {
        console.warn('updateLiveMetrologyPreview recal err:', e);
    }

    // 8. Unlock calibration tabs and navigate directly into calibration execution
    unlockMainTab('table');
    unlockMainTab('graph');

    if (typeof switchMainTab === 'function') {
        switchMainTab('table');
    }

    showToast(`Recalibration active for ${inst.model} (SN: ${inst.display_serial || inst.serial_number}). Specifications locked.`, 'success');
}

// ── Instrument Drift & Comprehensive Calibration Hub Handlers ──────────────
async function openInstrumentDriftModal(serialNumber, defaultTab = 'sessionsTable', focusSessionIdx = null) {
    showToast('Loading instrument calibration records and data...', 'info');
    try {
        const details = await pywebview.api.get_instrument_drift_details(serialNumber);
        if (!details || !details.sessions || details.sessions.length === 0) {
            showToast('No calibration records found for this instrument.', 'error');
            return;
        }
        driftDetailsData = details;
        activeDriftInstrument = { serial_number: serialNumber };

        const inst = instrumentsData.find(i => i.serial_number === serialNumber);
        const modelName = inst ? inst.model : 'Instrument';
        const displaySn = inst ? (inst.display_serial || inst.serial_number) : serialNumber;
        const mainUnit = details.sessions[0]?.setup?.unit || 'bar';

        document.getElementById('driftModalTitle').textContent = `Calibration History & Records: ${modelName}`;
        document.getElementById('driftModalSubtitle').textContent = `Serial Number: ${displaySn} • ${details.session_count} Calibration Sessions Recorded`;

        const ribbon = document.getElementById('driftMetricsRibbon');
        const firstD = details.dates[0] || '-';
        const lastD = details.dates[details.dates.length - 1] || '-';
        const maxErrAll = Math.max(...(details.max_errors || [0]).map(Math.abs), 0).toFixed(4);
        const maxUAll = Math.max(...(details.max_uncertainties || [0]), 0).toFixed(4);

        let stabColor = '#16a34a';
        let stabLabel = 'Highly Stable';
        const rawStab = details.stability_status || '';
        if (rawStab.includes('Signifikan') || rawStab.toLowerCase().includes('significant')) {
            stabColor = '#dc2626';
            stabLabel = 'Significant Drift';
        } else if (rawStab.includes('Moderat') || rawStab.toLowerCase().includes('moderate')) {
            stabColor = '#d97706';
            stabLabel = 'Moderate Drift';
        } else if (rawStab.includes('Stabil') || rawStab.toLowerCase().includes('stable')) {
            stabColor = '#16a34a';
            stabLabel = rawStab.includes('Sangat') ? 'Highly Stable' : 'Stable';
        }

        ribbon.innerHTML = `
            <div class="drift-metric-card">
                <span class="drift-metric-lbl">Total Calibrations</span>
                <span class="drift-metric-val">${details.session_count} Sessions</span>
            </div>
            <div class="drift-metric-card">
                <span class="drift-metric-lbl">Date Range</span>
                <span class="drift-metric-val" style="font-size:13px; font-weight:700;">${firstD} to ${lastD}</span>
            </div>
            <div class="drift-metric-card">
                <span class="drift-metric-lbl">Stability Status</span>
                <span class="drift-metric-val" style="font-size:14px; color:${stabColor};">${stabLabel}</span>
            </div>
            <div class="drift-metric-card">
                <span class="drift-metric-lbl">Max Deviation / Max U</span>
                <span class="drift-metric-val" style="font-size:13.5px;">${maxErrAll} ${mainUnit} / ${maxUAll} ${mainUnit}</span>
            </div>
        `;

        renderInstrumentSessionsTables(details, focusSessionIdx);
        renderInstrumentMatrixTable(details);
        renderDriftCharts(details);
        renderDriftTimeline(details);

        switchDriftTab(defaultTab || 'sessionsTable');
        document.getElementById('instrumentDriftOverlay').classList.add('active');

        if (focusSessionIdx !== null && focusSessionIdx !== undefined) {
            setTimeout(() => {
                const targetCard = document.getElementById(`sessionCard_${focusSessionIdx}`);
                if (targetCard) {
                    targetCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    targetCard.style.outline = '2px solid #0f172a';
                    setTimeout(() => { targetCard.style.outline = 'none'; }, 2000);
                }
            }, 250);
        }
    } catch (e) {
        showToast(`Failed to load calibration data: ${e}`, 'error');
    }
}

function switchDriftTab(tab) {
    document.querySelectorAll('#instrumentDriftOverlay .ctab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#instrumentDriftOverlay .ctab-panel').forEach(p => p.classList.remove('active'));

    const btn = document.getElementById(`dtabBtn_${tab}`);
    const panel = document.getElementById(`dtab_${tab}`);
    if (btn) btn.classList.add('active');
    if (panel) panel.classList.add('active');

    const body = document.querySelector('#instrumentDriftOverlay .compare-body');
    if (body) {
        body.scrollTop = 0;
    }

    if (tab === 'charts') {
        setTimeout(() => {
            Object.values(driftChartInstances).forEach(c => {
                if (c && typeof c.resize === 'function') {
                    c.resize();
                }
            });
        }, 30);
    }
}

function closeInstrumentDriftModal() {
    document.getElementById('instrumentDriftOverlay').classList.remove('active');
    Object.values(driftChartInstances).forEach(c => c && c.destroy());
    driftChartInstances = { error: null, zero: null, uncertainty: null };
    driftDetailsData = null;
    activeDriftInstrument = null;
}

function exportCurrentInstrumentBundle() {
    if (!activeDriftInstrument || !activeDriftInstrument.serial_number) return;
    exportInstrumentBundleDirect(activeDriftInstrument.serial_number);
}

function normalizeDateStr(rawDate) {
    if (!rawDate) return '';
    const clean = String(rawDate).trim().split('T')[0];
    const parts = clean.split('-');
    if (parts.length === 3) {
        const y = parts[0];
        const m = String(parseInt(parts[1], 10)).padStart(2, '0');
        const d = String(parseInt(parts[2], 10)).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    return clean;
}

// ── Calibration History Calendar & Recent Calibrations ──
let calCurrentYear = 2026;
let calCurrentMonth = 8; // 0-based: September
let calSessionsByDate = {};
let calUniqueMonths = [];
let calSelectedDate = null;
let currentCalInstrumentData = null;

function filterInstrumentSessionCards(filterVal) {
    const pills = document.querySelectorAll('.session-filter-pill');
    pills.forEach(p => p.classList.remove('active'));

    const activePill = document.querySelector(`.session-filter-pill[data-filter="${filterVal}"]`);
    if (activePill) activePill.classList.add('active');

    const cards = document.querySelectorAll('.session-table-card');
    cards.forEach((card, idx) => {
        if (filterVal === 'all' || String(idx) === String(filterVal)) {
            card.style.display = 'block';
        } else {
            card.style.display = 'none';
        }
    });

    document.querySelectorAll('.rc-card').forEach(item => {
        item.classList.remove('active');
    });

    if (filterVal !== 'all') {
        const matchingRecent = document.getElementById(`recentCalCard_${filterVal}`);
        if (matchingRecent) matchingRecent.classList.add('active');

        // Synchronize calendar date and view
        if (currentCalInstrumentData && currentCalInstrumentData.sessions && currentCalInstrumentData.sessions[filterVal]) {
            const targetSession = currentCalInstrumentData.sessions[filterVal];
            const normDate = targetSession.normalizedDate || normalizeDateStr(targetSession.date);
            if (normDate) {
                calSelectedDate = normDate;
                const parts = normDate.split('-');
                if (parts.length >= 2) {
                    calCurrentYear = parseInt(parts[0], 10);
                    calCurrentMonth = parseInt(parts[1], 10) - 1;
                }
                renderCalibrationCalendarGrid();
            }
        }

        const target = document.getElementById(`sessionCard_${filterVal}`);
        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }
}

function setupCalibrationCalendar(data, focusSessionIdx) {
    currentCalInstrumentData = data;
    calSessionsByDate = {};
    const monthMap = new Map();
    const monthNamesShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    data.sessions.forEach((s, idx) => {
        s.originalIdx = idx;
        const normDate = normalizeDateStr(s.date);
        s.normalizedDate = normDate;
        if (normDate) {
            calSessionsByDate[normDate] = s;
            const parts = normDate.split('-');
            if (parts.length >= 2) {
                const y = parseInt(parts[0], 10);
                const m = parseInt(parts[1], 10) - 1;
                const key = `${y}-${m}`;
                if (!monthMap.has(key)) {
                    monthMap.set(key, { year: y, month: m, label: `${monthNamesShort[m]} ${y}`, count: 1 });
                } else {
                    monthMap.get(key).count++;
                }
            }
        }
    });

    calUniqueMonths = Array.from(monthMap.values()).sort((a, b) => 
        a.year !== b.year ? a.year - b.year : a.month - b.month
    );

    let initialSession = null;
    if (focusSessionIdx !== null && focusSessionIdx !== undefined && data.sessions[focusSessionIdx]) {
        initialSession = data.sessions[focusSessionIdx];
    } else if (data.sessions.length > 0) {
        const sortedDesc = [...data.sessions].sort((a, b) => String(b.date).localeCompare(String(a.date)));
        initialSession = sortedDesc[0];
    }

    if (initialSession && initialSession.normalizedDate) {
        calSelectedDate = initialSession.normalizedDate;
        const parts = initialSession.normalizedDate.split('-');
        calCurrentYear = parseInt(parts[0], 10);
        calCurrentMonth = parseInt(parts[1], 10) - 1;
    } else {
        const now = new Date();
        calCurrentYear = now.getFullYear();
        calCurrentMonth = now.getMonth();
        calSelectedDate = null;
    }
}

function toggleCalPicker(pickerId, e) {
    if (e) e.stopPropagation();
    const targetWrap = document.getElementById(pickerId);
    if (!targetWrap) return;
    const isCurrentlyOpen = targetWrap.classList.contains('open');

    document.querySelectorAll('.cal-custom-picker').forEach(p => p.classList.remove('open'));

    if (!isCurrentlyOpen) {
        targetWrap.classList.add('open');
        setTimeout(() => {
            document.addEventListener('click', closeAllCalPickersOnce);
        }, 0);
    }
}

function closeAllCalPickersOnce() {
    document.querySelectorAll('.cal-custom-picker').forEach(p => p.classList.remove('open'));
    document.removeEventListener('click', closeAllCalPickersOnce);
}

function selectCalMonth(monthIdx) {
    calCurrentMonth = parseInt(monthIdx, 10);
    closeAllCalPickersOnce();
    renderCalibrationCalendarGrid();
}

function selectCalYear(yearVal) {
    calCurrentYear = parseInt(yearVal, 10);
    closeAllCalPickersOnce();
    renderCalibrationCalendarGrid();
}

function renderCalibrationCalendarGrid() {
    const monthDisplay = document.getElementById('calMonthDisplay');
    const yearDisplay = document.getElementById('calYearDisplay');
    const monthMenu = document.getElementById('calMonthMenu');
    const yearMenu = document.getElementById('calYearMenu');
    const chipsContainer = document.getElementById('calMonthChipsContainer');
    const gridContainer = document.getElementById('calGridContainer');
    if (!gridContainer) return;

    const monthNamesFull = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthNamesShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    if (monthDisplay) {
        monthDisplay.textContent = monthNamesFull[calCurrentMonth];
    }
    if (yearDisplay) {
        yearDisplay.textContent = String(calCurrentYear);
    }

    if (monthMenu) {
        let mHtml = '';
        monthNamesFull.forEach((mName, idx) => {
            const isAct = idx === calCurrentMonth;
            mHtml += `
                <button type="button" class="cal-picker-item ${isAct ? 'active' : ''}" onclick="selectCalMonth(${idx})">
                    <span>${mName}</span>
                    ${isAct ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
                </button>
            `;
        });
        monthMenu.innerHTML = mHtml;
    }

    if (yearMenu) {
        const dataYears = calUniqueMonths.map(m => m.year);
        const minYear = dataYears.length > 0 ? Math.min(...dataYears, calCurrentYear - 2) : (calCurrentYear - 3);
        const maxYear = dataYears.length > 0 ? Math.max(...dataYears, calCurrentYear + 2) : (calCurrentYear + 3);
        let yHtml = '';
        for (let y = minYear; y <= maxYear; y++) {
            const isAct = y === calCurrentYear;
            yHtml += `
                <button type="button" class="cal-picker-item ${isAct ? 'active' : ''}" onclick="selectCalYear(${y})">
                    <span>${y}</span>
                    ${isAct ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
                </button>
            `;
        }
        yearMenu.innerHTML = yHtml;
    }

    if (chipsContainer) {
        let chipsHtml = '';
        calUniqueMonths.forEach(item => {
            const isActive = item.year === calCurrentYear && item.month === calCurrentMonth;
            chipsHtml += `
                <button type="button" class="cal-month-chip ${isActive ? 'active' : ''}" onclick="jumpCalMonth(${item.year}, ${item.month})" title="Open calibrations for this month">
                    ${item.label} (${item.count})
                </button>
            `;
        });
        chipsContainer.innerHTML = chipsHtml;
    }

    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    let gridHtml = '';
    dayNames.forEach(d => {
        gridHtml += `<div class="cal-th-day">${d}</div>`;
    });

    const firstDay = (new Date(calCurrentYear, calCurrentMonth, 1).getDay() + 6) % 7;
    const daysCount = new Date(calCurrentYear, calCurrentMonth + 1, 0).getDate();

    for (let i = 0; i < firstDay; i++) {
        gridHtml += `<div class="cal-day-cell cal-empty-slot"></div>`;
    }

    for (let d = 1; d <= daysCount; d++) {
        const dateStr = `${calCurrentYear}-${String(calCurrentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const session = calSessionsByDate[dateStr];
        const isSelected = calSelectedDate === dateStr;

        if (session) {
            const isPass = session.status === 'PASS';
            const markClass = isPass ? 'cal-marked-pass' : 'cal-marked-fail';
            const statusLabel = isPass ? 'PASS' : 'FAIL';
            const selectedClass = isSelected ? 'cal-day-selected' : '';
            const title = `Calibration #${session.originalIdx + 1} (${session.date}): ${statusLabel} | Operator: ${session.operator}`;

            gridHtml += `
                <div class="cal-day-cell cal-marked ${markClass} ${selectedClass}" onclick="selectCalibrationSessionByDate('${dateStr}')" title="${title}">
                    <span class="cal-day-num">${d}</span>
                    <span class="cal-badge-status ${isPass ? 'badge-pass' : 'badge-fail'}">${statusLabel}</span>
                </div>
            `;
        } else {
            gridHtml += `
                <div class="cal-day-cell cal-empty-day">
                    <span class="cal-day-num">${d}</span>
                </div>
            `;
        }
    }

    gridContainer.innerHTML = gridHtml;
}

function navigateCalYear(delta) {
    calCurrentYear += delta;
    renderCalibrationCalendarGrid();
}

function navigateCalMonth(delta) {
    calCurrentMonth += delta;
    if (calCurrentMonth < 0) {
        calCurrentMonth = 11;
        calCurrentYear--;
    } else if (calCurrentMonth > 11) {
        calCurrentMonth = 0;
        calCurrentYear++;
    }
    renderCalibrationCalendarGrid();
}

function jumpCalMonth(year, month) {
    calCurrentYear = year;
    calCurrentMonth = month;
    const ymPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const matchedDates = Object.keys(calSessionsByDate).filter(d => d.startsWith(ymPrefix));
    if (matchedDates.length > 0) {
        matchedDates.sort().reverse();
        selectCalibrationSessionByDate(matchedDates[0]);
    } else {
        renderCalibrationCalendarGrid();
    }
}

function selectCalibrationSessionByDate(dateStr) {
    const session = calSessionsByDate[dateStr];
    calSelectedDate = dateStr;
    const parts = dateStr.split('-');
    if (parts.length >= 2) {
        calCurrentYear = parseInt(parts[0], 10);
        calCurrentMonth = parseInt(parts[1], 10) - 1;
    }
    renderCalibrationCalendarGrid();

    if (session && session.originalIdx !== undefined) {
        filterInstrumentSessionCards(session.originalIdx);
        const card = document.getElementById(`sessionCard_${session.originalIdx}`);
        if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            card.style.outline = '2px solid #0f172a';
            setTimeout(() => { card.style.outline = 'none'; }, 2000);
        }
    }
}

function renderInstrumentSessionsTables(data, focusSessionIdx = null) {
    const container = document.getElementById('driftSessionsTableContent');
    if (!container) return;
    container.innerHTML = '';

    if (!data.sessions || data.sessions.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:32px; color:#64748b;">No calibration session records found for this instrument.</div>`;
        return;
    }

    setupCalibrationCalendar(data, focusSessionIdx);

    // Prepare 2 most recent calibrations
    const sortedDesc = [...data.sessions].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const recent2 = sortedDesc.slice(0, 2);

    let recentHtml = '';
    if (recent2.length === 0) {
        recentHtml = `<div style="color:#64748b; font-size:12px; padding:12px;">No calibration history available.</div>`;
    } else {
        recent2.forEach((s, rIdx) => {
            const isPass = s.status === 'PASS';
            const stBadge = `<span class="rc-status-pill ${isPass ? 'rc-pass' : 'rc-fail'}">${s.status}</span>`;
            const unit = s.setup?.unit || 'bar';
            const eyebrow = rIdx === 0 ? 'Latest Calibration' : 'Previous Calibration';
            const seq = s.sequence || s.dkd_sequence || 'A';
            const zeroSign = Number(s.zero_error) >= 0 ? '+' : '';
            const isInitialActive = focusSessionIdx !== null ? (s.originalIdx === focusSessionIdx) : (rIdx === 0);

            recentHtml += `
                <div class="rc-card ${isInitialActive ? 'active' : ''}" id="recentCalCard_${s.originalIdx}">
                    <div class="rc-header">
                        <div class="rc-title-block">
                            <span class="rc-eyebrow">${eyebrow}</span>
                            <div class="rc-main-title">
                                <span>Session #${s.originalIdx + 1}</span>
                                <span class="rc-sep">/</span>
                                <span class="rc-date">${s.date}</span>
                                <span class="rc-seq">Seq ${seq}</span>
                            </div>
                        </div>
                        ${stBadge}
                    </div>
                    <div class="rc-meta-line">
                        <span>Operator: <b>${s.operator || 'Technician'}</b></span>
                        <span class="rc-sep">&bull;</span>
                        <span>Location: <b>${s.location || 'Lab'}</b></span>
                        <span class="rc-sep">&bull;</span>
                        <span>Standard: <b>${s.standard || 'DKD-R 6-1'}</b></span>
                    </div>
                    <div class="rc-metrics-strip">
                        <div class="rc-metric-cell">
                            <span class="rc-metric-lbl">Max Dev</span>
                            <span class="rc-metric-val">${Number(s.max_error).toFixed(4)} ${unit}</span>
                        </div>
                        <div class="rc-metric-cell">
                            <span class="rc-metric-lbl">Max U (k=2)</span>
                            <span class="rc-metric-val">&plusmn;${Number(s.max_U || 0).toFixed(4)} ${unit}</span>
                        </div>
                        <div class="rc-metric-cell">
                            <span class="rc-metric-lbl">Zero Error</span>
                            <span class="rc-metric-val">${zeroSign}${Number(s.zero_error || 0).toFixed(4)} ${unit}</span>
                        </div>
                    </div>
                    <div class="rc-actions">
                        <button type="button" class="btn-show-table" onclick="filterInstrumentSessionCards(${s.originalIdx})">Show Table</button>
                    </div>
                </div>
            `;
        });
    }

    const overviewWrapper = document.createElement('div');
    overviewWrapper.className = 'cal-overview-grid';
    overviewWrapper.innerHTML = `
        <!-- Left: Calendar Widget -->
        <div class="cal-calendar-pane">
            <div class="cal-pane-header">
                <div class="cal-pane-title">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                    <span>Calibration History Calendar</span>
                </div>
                <div class="cal-month-nav">
                    <button type="button" class="cal-nav-btn" onclick="navigateCalYear(-1)" title="Previous Year">&laquo;</button>
                    <button type="button" class="cal-nav-btn" onclick="navigateCalMonth(-1)" title="Previous Month">&lsaquo;</button>

                    <!-- Custom Month Picker -->
                    <div class="cal-custom-picker" id="calMonthPickerWrap">
                        <button type="button" class="cal-picker-trigger" id="calMonthTrigger" onclick="toggleCalPicker('calMonthPickerWrap', event)" title="Select Month">
                            <span id="calMonthDisplay">September</span>
                            <svg class="cal-picker-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                        </button>
                        <div class="cal-picker-dropdown-menu" id="calMonthMenu"></div>
                    </div>

                    <!-- Custom Year Picker -->
                    <div class="cal-custom-picker" id="calYearPickerWrap">
                        <button type="button" class="cal-picker-trigger" id="calYearTrigger" onclick="toggleCalPicker('calYearPickerWrap', event)" title="Select Year">
                            <span id="calYearDisplay">2026</span>
                            <svg class="cal-picker-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                        </button>
                        <div class="cal-picker-dropdown-menu" id="calYearMenu"></div>
                    </div>

                    <button type="button" class="cal-nav-btn" onclick="navigateCalMonth(1)" title="Next Month">&rsaquo;</button>
                    <button type="button" class="cal-nav-btn" onclick="navigateCalYear(1)" title="Next Year">&raquo;</button>
                </div>
            </div>
            <div class="cal-month-chips" id="calMonthChipsContainer"></div>
            <div class="cal-grid" id="calGridContainer"></div>
            <div class="cal-legend">
                <span class="cal-legend-item"><span class="cal-legend-dot dot-pass"></span> Within Tolerance (PASS)</span>
                <span class="cal-legend-item"><span class="cal-legend-dot dot-fail"></span> Out of Tolerance (FAIL)</span>
                <span class="cal-legend-hint">Click marked date to display session table</span>
            </div>
        </div>

        <!-- Right: Recent Calibrations (Max 2) -->
        <div class="cal-recent-pane">
            <div class="cal-recent-list">
                ${recentHtml}
            </div>
        </div>
    `;
    container.appendChild(overviewWrapper);
    renderCalibrationCalendarGrid();

    // 2. Render each calibration session table
    data.sessions.forEach((s, idx) => {
        const card = document.createElement('div');
        card.className = 'session-table-card';
        card.id = `sessionCard_${idx}`;

        const sc = s.status === 'PASS' ? 'badge-pass' : 'badge-fail';
        const impTag = s.is_imported ? `<span style="font-size:11px; color:#64748b; font-weight:600;">[Imported: ${s.imported_by || 'Unknown'}]</span>` : '';
        const certTag = s.certificate_number ? `<span class="session-card-cert">Certificate No.: ${s.certificate_number}</span>` : '';
        const unit = s.setup.unit || 'bar';
        const isDkd = (s.standard || '').includes('DKD');
        const fpEscaped = (s.filepath || '').replace(/\\/g, '\\\\');

        let rowsHtml = '';
        if (s.points && s.points.length > 0) {
            s.points.forEach(p => {
                const pStatusCls = p.pass ? 'badge-pass' : 'badge-fail';
                const errSign = p.error >= 0 ? '+' : '';
                const errSpanSign = p.error_pct_span >= 0 ? '+' : '';
                const errCls = p.error >= 0 ? 'err-pos' : 'err-neg';

                const pStdDisplay = p.p_std != null ? Number(p.p_std).toFixed(3) : Number(p.nominal).toFixed(3);
                const readingDisplay = Number(p.reading).toFixed(3);
                const errDisplay = `${errSign}${Number(p.error).toFixed(4)}`;
                const errSpanDisplay = `${errSpanSign}${Number(p.error_pct_span).toFixed(3)}%`;
                const uDisplay = `±${Number(p.U || 0).toFixed(4)}`;
                const hDisplay = `${Number(p.h || 0).toFixed(4)}`;
                const mpeDisplay = `±${Number(p.mpe_val || 0).toFixed(4)}`;

                const hCol = isDkd ? `<td>${hDisplay}</td>` : '';

                rowsHtml += `
                    <tr>
                        <td style="text-align:center; font-weight:600; color:#334155;">${p.setpoint_pct}%</td>
                        <td>${pStdDisplay}</td>
                        <td style="font-weight:600; color:#0f172a;">${readingDisplay}</td>
                        <td class="err-cell ${errCls}">${errDisplay}</td>
                        <td class="err-cell ${errCls}">${errSpanDisplay}</td>
                        <td style="color:#475569;">${uDisplay}</td>
                        ${hCol}
                        <td style="color:#64748b;">${mpeDisplay}</td>
                        <td style="text-align:center;"><span class="${pStatusCls}">${p.pass ? 'PASS' : 'FAIL'}</span></td>
                    </tr>
                `;
            });
        } else {
            rowsHtml = `<tr><td colspan="${isDkd ? 9 : 8}" style="text-align:center; padding:18px; color:#64748b;">Measurement table has no detailed test rows.</td></tr>`;
        }

        const hHeader = isDkd ? `<th>Hysteresis (${unit})</th>` : '';

        card.innerHTML = `
            <div class="session-card-header">
                <div class="session-card-top-row">
                    <div class="session-card-identity">
                        <span class="session-card-badge">Calibration #${idx + 1}</span>
                        <span class="session-card-sep">•</span>
                        <span class="seq-badge-hdr">Sequence ${s.sequence || s.setup.sequence || 'A'}</span>
                        <span class="session-card-sep">•</span>
                        <span class="session-card-date">${s.date}</span>
                        <span class="${sc}">${s.status}</span>
                        ${impTag}
                        ${certTag}
                    </div>
                    <div class="session-card-actions">
                        <button class="btn-action-primary" onclick="closeInstrumentDriftModal(); executeLoadHistory('${fpEscaped}')" title="Load this session data to workspace">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                            <span>Load to Workspace</span>
                        </button>
                        <button class="btn-action-icon btn-inst-export" onclick="exportSingleSessionFile('${fpEscaped}')" title="Export Session File">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        </button>
                    </div>
                </div>
                <div class="session-card-meta-line">
                    <span class="meta-item"><span class="meta-k">Sequence:</span> <span class="meta-v">Seq ${s.sequence || s.setup.sequence || 'A'}</span></span>
                    <span class="meta-sep">•</span>
                    <span class="meta-item"><span class="meta-k">Operator:</span> <span class="meta-v">${s.operator}</span></span>
                    <span class="meta-sep">•</span>
                    <span class="meta-item"><span class="meta-k">Location:</span> <span class="meta-v">${s.location || 'Calibration Lab'}</span></span>
                    <span class="meta-sep">•</span>
                    <span class="meta-item"><span class="meta-k">Standard:</span> <span class="meta-v">${s.standard}</span></span>
                    <span class="meta-sep">•</span>
                    <span class="meta-item"><span class="meta-k">Range:</span> <span class="meta-v">${s.setup.lrv} ~ ${s.setup.urv} ${unit}</span></span>
                    <span class="meta-sep">•</span>
                    <span class="meta-item"><span class="meta-k">MPE Tolerance:</span> <span class="meta-v">±${s.setup.mpe_percent}% FS</span></span>
                </div>
            </div>

            <div class="session-card-body">
                <table class="cal-table-full">
                    <thead>
                        <tr>
                            <th style="width:70px; text-align:center;">Setpoint</th>
                            <th>Standard (${unit})</th>
                            <th>Reading (${unit})</th>
                            <th>Deviation W (${unit})</th>
                            <th>Deviation (% Span)</th>
                            <th>Uncertainty U (${unit})</th>
                            ${hHeader}
                            <th>MPE Limit (${unit})</th>
                            <th style="width:80px; text-align:center;">Decision</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>

            <div class="session-card-footer">
                <div class="session-footer-stats">
                    <span class="session-stat-pill">Zero Shift: <b>${s.zero_error >= 0 ? '+' : ''}${Number(s.zero_error).toFixed(4)} ${unit}</b></span>
                    <span class="session-stat-sep">•</span>
                    <span class="session-stat-pill">Max Deviation: <b>${Number(s.max_error).toFixed(4)} ${unit}</b></span>
                    <span class="session-stat-sep">•</span>
                    <span class="session-stat-pill">Max U (k=2): <b>±${Number(s.max_U || 0).toFixed(4)} ${unit}</b></span>
                    ${isDkd ? `<span class="session-stat-sep">•</span><span class="session-stat-pill">Max Hysteresis: <b>${Number(s.hysteresis_max || 0).toFixed(4)} ${unit}</b></span>` : ''}
                </div>
                <div class="session-footer-verdict ${s.status === 'PASS' ? 'verdict-pass' : 'verdict-fail'}">
                    ${s.status === 'PASS' ? 'Meets Manufacturer Tolerance Limits' : 'Points Exceeding Tolerance Detected'}
                </div>
            </div>
        `;
        container.appendChild(card);
    });

    // Select initial active session
    if (focusSessionIdx !== null && focusSessionIdx !== undefined && data.sessions[focusSessionIdx]) {
        filterInstrumentSessionCards(focusSessionIdx);
    } else if (data.sessions.length > 0) {
        filterInstrumentSessionCards(data.sessions.length - 1);
    }
}

function renderInstrumentMatrixTable(data) {
    const container = document.getElementById('driftMatrixTableContent');
    if (!container) return;
    container.innerHTML = '';

    if (!data.sessions || data.sessions.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:32px; color:#64748b;">No comparison matrix data available.</div>`;
        return;
    }

    const unit = data.sessions[0]?.setup?.unit || 'bar';
    const mpePct = data.sessions[0]?.setup?.mpe_percent || 0.5;
    const span = Math.abs((data.sessions[0]?.setup?.urv || 100) - (data.sessions[0]?.setup?.lrv || 0)) || 1.0;
    const mpeVal = (mpePct / 100.0) * span;

    // Collect all setpoint percentages
    const setpointsSet = new Set();
    data.sessions.forEach(s => {
        (s.points || []).forEach(p => setpointsSet.add(Number(p.setpoint_pct)));
    });
    const setpointsSorted = Array.from(setpointsSet).sort((a, b) => a - b);

    // Build Table Headers
    let headerRow1 = `
        <tr>
            <th rowspan="2" style="width:80px; text-align:center;">Setpoint (%)</th>
            <th rowspan="2" style="width:110px; text-align:center;">Nominal (${unit})</th>
    `;
    data.sessions.forEach((s, idx) => {
        headerRow1 += `
            <th colspan="3" class="group-border" style="text-align:center;">
                Calibration #${idx + 1} (${s.date})
                <div style="font-size:10px; font-weight:normal; color:#64748b; margin-top:2px;">
                    <b style="color:#4338ca;">Seq ${s.sequence || s.setup?.sequence || 'A'}</b> • ${s.operator} • ${s.standard}
                </div>
            </th>
        `;
    });
    headerRow1 += `
            <th rowspan="2" class="group-border" style="width:140px; text-align:center;">Cumulative Shift Δ Drift (${unit})</th>
            <th rowspan="2" style="width:130px; text-align:center;">Stability Evaluation</th>
        </tr>
    `;

    let headerRow2 = '<tr>';
    data.sessions.forEach(() => {
        headerRow2 += `
            <th class="group-border" style="font-size:10.5px;">Reading</th>
            <th style="font-size:10.5px;">Deviation (W)</th>
            <th style="font-size:10.5px;">U (k=2)</th>
        `;
    });
    headerRow2 += '</tr>';

    // Build Table Rows
    let rowsHtml = '';
    setpointsSorted.forEach(sp => {
        // Find nominal value
        let nominalVal = null;
        for (const s of data.sessions) {
            const foundP = (s.points || []).find(p => Number(p.setpoint_pct) === sp);
            if (foundP && foundP.nominal != null) {
                nominalVal = foundP.nominal;
                break;
            }
        }
        const nominalDisplay = nominalVal != null ? Number(nominalVal).toFixed(3) : '-';

        let rowCells = `
            <td class="cell-center" style="font-weight:600; color:#334155;">${sp}%</td>
            <td class="cell-center" style="color:#475569;">${nominalDisplay}</td>
        `;

        let firstErr = null;
        let lastErr = null;

        data.sessions.forEach(s => {
            const pt = (s.points || []).find(p => Number(p.setpoint_pct) === sp);
            if (pt) {
                if (firstErr === null) firstErr = pt.error;
                lastErr = pt.error;

                const errSign = pt.error >= 0 ? '+' : '';
                const errCls = pt.error >= 0 ? 'err-pos' : 'err-neg';

                rowCells += `
                    <td class="group-border" style="font-weight:600; color:#0f172a;">${Number(pt.reading).toFixed(3)}</td>
                    <td class="err-cell ${errCls}">${errSign}${Number(pt.error).toFixed(4)}</td>
                    <td style="color:#64748b;">±${Number(pt.U || 0).toFixed(4)}</td>
                `;
            } else {
                rowCells += `
                    <td colspan="3" class="group-border cell-center" style="color:#94a3b8;">Not Tested</td>
                `;
            }
        });

        // Drift evaluation
        let driftHtml = '-';
        let evalHtml = '<span class="drift-eval-pill stable">Single Session</span>';
        if (firstErr !== null && lastErr !== null && data.sessions.length >= 2) {
            const deltaDrift = lastErr - firstErr;
            const deltaSign = deltaDrift >= 0 ? '+' : '';
            const absDelta = Math.abs(deltaDrift);
            driftHtml = `<b style="color:${absDelta > 0.5 * mpeVal ? '#dc2626' : '#0f172a'}">${deltaSign}${deltaDrift.toFixed(4)}</b>`;

            if (absDelta <= 0.25 * mpeVal) {
                evalHtml = '<span class="drift-eval-pill stable">Highly Stable</span>';
            } else if (absDelta <= 0.75 * mpeVal) {
                evalHtml = '<span class="drift-eval-pill moderate">Controlled Drift</span>';
            } else {
                evalHtml = '<span class="drift-eval-pill significant">Needs Adjustment</span>';
            }
        }

        rowCells += `
            <td class="group-border cell-center">${driftHtml}</td>
            <td class="cell-center">${evalHtml}</td>
        `;

        rowsHtml += `<tr>${rowCells}</tr>`;
    });

    const wrap = document.createElement('div');
    wrap.style.overflowX = 'auto';
    wrap.innerHTML = `
        <div style="margin-bottom:12px; font-size:12px; color:#64748b;">
            Matrix compares identical setpoints horizontally across calibration sessions to evaluate metrological stability over time.
        </div>
        <table class="cal-matrix-table">
            <thead>${headerRow1}${headerRow2}</thead>
            <tbody>${rowsHtml}</tbody>
        </table>
    `;
    container.appendChild(wrap);
}

function renderDriftCharts(data) {
    Object.values(driftChartInstances).forEach(c => c && c.destroy());
    driftChartInstances = { error: null, zero: null, uncertainty: null };

    const labels = data.dates;
    const colors = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#475569'];

    // 1. Error Drift
    const errCanvas = document.getElementById('chartErrorDrift');
    if (errCanvas) {
        const errCtx = errCanvas.getContext('2d');
        const datasets = [];
        let colorIdx = 0;
        for (const [sp, values] of Object.entries(data.drift_by_setpoint)) {
            datasets.push({
                label: `Setpoint ${sp}%`,
                data: values,
                borderColor: colors[colorIdx % colors.length],
                backgroundColor: colors[colorIdx % colors.length],
                borderWidth: 2,
                pointRadius: 5,
                tension: 0.15
            });
            colorIdx++;
        }
        driftChartInstances.error = new Chart(errCtx, {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top' },
                    tooltip: { mode: 'index', intersect: false }
                },
                scales: {
                    x: { title: { display: true, text: 'Calibration Date' } },
                    y: { title: { display: true, text: 'Error / Deviation (Instrument Unit)' } }
                }
            }
        });
    }

    // 2. Zero Drift
    const zeroCanvas = document.getElementById('chartZeroDrift');
    if (zeroCanvas) {
        const zeroCtx = zeroCanvas.getContext('2d');
        driftChartInstances.zero = new Chart(zeroCtx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Zero Shift (Error @ 0%)',
                    data: data.zero_drift,
                    borderColor: '#2563eb',
                    backgroundColor: 'rgba(37, 99, 235, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    pointRadius: 5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { title: { display: true, text: 'Calibration Date' } },
                    y: { title: { display: true, text: 'Zero Error' } }
                }
            }
        });
    }

    // 3. Max Uncertainty & Hysteresis
    const uncCanvas = document.getElementById('chartUncertaintyDrift');
    if (uncCanvas) {
        const uncCtx = uncCanvas.getContext('2d');
        driftChartInstances.uncertainty = new Chart(uncCtx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Max Uncertainty (U, k=2)',
                        data: data.max_uncertainties,
                        borderColor: '#9333ea',
                        backgroundColor: '#9333ea',
                        borderWidth: 2,
                        pointRadius: 4
                    },
                    {
                        label: 'Max Hysteresis',
                        data: data.hysteresis_trend,
                        borderColor: '#d97706',
                        backgroundColor: '#d97706',
                        borderWidth: 2,
                        pointRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { title: { display: true, text: 'Calibration Date' } },
                    y: { title: { display: true, text: 'Value (Instrument Unit)' } }
                }
            }
        });
    }
}

function renderDriftTimeline(data) {
    const container = document.getElementById('driftTimelineContent');
    if (!container) return;
    container.innerHTML = '';

    const listWrap = document.createElement('div');
    listWrap.style.display = 'flex';
    listWrap.style.flexDirection = 'column';
    listWrap.style.gap = '12px';

    data.sessions.forEach((s, idx) => {
        const card = document.createElement('div');
        card.style.padding = '12px 16px';
        card.style.background = '#f8fafc';
        card.style.border = '1px solid #e2e8f0';
        card.style.borderRadius = '8px';
        card.style.display = 'flex';
        card.style.alignItems = 'center';
        card.style.justifyContent = 'space-between';

        const sc = s.status === 'PASS' ? 'badge-pass' : 'badge-fail';
        const importTag = s.is_imported ? `<span style="font-size:9.5px; background:#e0e7ff; color:#3b82f6; padding:2px 6px; border-radius:4px; font-weight:700; margin-left:6px;">IMPORTED (${s.imported_by || 'Unknown'})</span>` : '';

        card.innerHTML = `
            <div>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="font-weight:700; font-size:14px; color:#0f172a;">Session #${idx + 1}: ${s.date}</span>
                    <span class="${sc}">${s.status}</span>
                    ${importTag}
                </div>
                <div style="font-size:12px; color:#64748b; margin-top:4px;">
                    Operator: <b>${s.operator}</b> • Location: <b>${s.location || '-'}</b> • Standard: <b>${s.standard}</b>
                </div>
                <div style="font-size:12px; color:#334155; margin-top:4px;">
                    Zero Error: <b>${s.zero_error}</b> • Max Dev: <b>${s.max_error}</b> • Max U: <b>${s.max_U || '-'}</b>
                </div>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
                <button class="btn-action-secondary" onclick="switchDriftTab('sessionsTable'); filterInstrumentSessionCards(${idx});">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg>
                    <span>View Session Table</span>
                </button>
                <button class="btn-action-primary" onclick="closeInstrumentDriftModal(); executeLoadHistory('${s.filepath.replace(/\\/g, '\\\\')}')">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                    <span>Open Session</span>
                </button>
            </div>
        `;
        listWrap.appendChild(card);
    });

    container.appendChild(listWrap);
}

function toggleCompareSelection(filepath, model, standard, dkdSeq, setpointsJson, checkbox) {
    const realFp   = filepath.replace(/\\\\/g, '\\');
    const setpoints = JSON.parse(setpointsJson || '[]').map(Number).sort((a, b) => a - b);

    if (checkbox.checked) {
        if (compareSelection.length === 0) {
            compareSelection.push({ filepath: realFp, model, standard, dkdSeq, setpoints, label: 'A' });

        } else if (compareSelection.length === 1) {
            const first = compareSelection[0];

            // Guard 1: standard sama
            if (first.standard !== standard) {
                checkbox.checked = false;
                showToast(`Cannot compare: different calibration standards (${first.standard} vs ${standard}).`, 'error');
                return;
            }
            // Guard 2: sequence sama (DKD only)
            if (standard === 'DKD-R 6-1' && first.dkdSeq !== dkdSeq) {
                checkbox.checked = false;
                showToast(`Cannot compare: different sequences (Seq ${first.dkdSeq} vs Seq ${dkdSeq}).`, 'error');
                return;
            }
            // Guard 3: setpoints identik
            const fSP = [...first.setpoints].sort((a, b) => a - b);
            const sSP = [...setpoints];
            const mismatch = fSP.length !== sSP.length || fSP.some((v, i) => v !== sSP[i]);
            if (mismatch) {
                checkbox.checked = false;
                showToast(
                    `Cannot compare: measurement points differ.\nA: [${fSP.join('%, ')}%] vs B: [${sSP.join('%, ')}%]`,
                    'error'
                );
                return;
            }

            compareSelection.push({ filepath: realFp, model, standard, dkdSeq, setpoints, label: 'B' });
        } else {
            checkbox.checked = false;
        }
    } else {
        compareSelection = compareSelection.filter(s => s.filepath !== realFp);
    }
    updateCompareBtn();
    renderHistoryTable();
}

function unselectCompare(filepath) {
    const realFp = filepath.replace(/\\\\/g, '\\');
    compareSelection = compareSelection.filter(s => s.filepath !== realFp);
    updateCompareBtn();
    renderHistoryTable();
}

// ── Custom Calibration Standard Dropdown ──
function toggleCalStandardDropdown(e) {
    e.stopPropagation();
    const wrap = document.getElementById('calStandardSelect');
    const isOpen = wrap.classList.contains('open');
    wrap.classList.toggle('open');
    if (!isOpen) {
        setTimeout(() => document.addEventListener('click', _closeCalStdOnce), 0);
    }
}
function _closeCalStdOnce() {
    const el = document.getElementById('calStandardSelect');
    if (el) el.classList.remove('open');
    document.removeEventListener('click', _closeCalStdOnce);
}
function setCalStandard(value, label, btn) {
    document.getElementById('metaCalStandard').value = value;
    document.getElementById('calStandardLabel').innerHTML = label;
    document.querySelectorAll('#calStandardDropdown .cs-opt').forEach(b => b.classList.remove('cs-opt-active'));
    btn.classList.add('cs-opt-active');
    document.getElementById('calStandardSelect').classList.remove('open');
    document.removeEventListener('click', _closeCalStdOnce);
}

// ── Generic Custom Select ──
function toggleCustomSelect(wrapId, e) {
    e.stopPropagation();
    const wrap = document.getElementById(wrapId);
    const isOpen = wrap.classList.contains('open');
    document.querySelectorAll('.custom-select.open').forEach(el => el.classList.remove('open'));
    if (!isOpen) {
        wrap.classList.add('open');
        document.addEventListener('click', _closeAllCustomSelects);
    }
}
function _closeAllCustomSelects() {
    document.querySelectorAll('.custom-select.open').forEach(el => el.classList.remove('open'));
    document.removeEventListener('click', _closeAllCustomSelects);
}
function setCustomSelect(inputId, value, label, btn, wrapId) {
    const input = document.getElementById(inputId);
    if (input) input.value = value;
    const labelEl = document.getElementById(inputId + 'Label');
    if (labelEl) labelEl.innerHTML = label;
    const wrap = document.getElementById(wrapId);
    if (wrap) {
        wrap.querySelectorAll('.cs-opt').forEach(b => {
            b.classList.remove('cs-opt-active');
            if (!btn && (b.textContent.trim() === label || b.getAttribute('onclick')?.includes(`'${value}'`))) {
                b.classList.add('cs-opt-active');
            }
        });
        if (btn) btn.classList.add('cs-opt-active');
        wrap.classList.remove('open');
    }
}

// ── Display Unit Custom Select ──────────────────────────────────────────────
function populateDisplayUnitSelect(units, activeUnit) {
    const dropdown = document.getElementById('dkdDisplayUnitDropdown');
    const labelEl  = document.getElementById('dkdDisplayUnitLabel');
    const hiddenEl = document.getElementById('dkdDisplayUnit');
    if (!dropdown) return;
    dropdown.innerHTML = units.map(u =>
        `<button class="cs-opt${u === activeUnit ? ' cs-opt-active' : ''}" type="button"
            onclick="setDisplayUnit('${u}', this)">${u}</button>`
    ).join('');
    if (labelEl)  labelEl.textContent = activeUnit;
    if (hiddenEl) hiddenEl.value = activeUnit;
}
function setDisplayUnit(unit, btn) {
    const hiddenEl = document.getElementById('dkdDisplayUnit');
    const labelEl  = document.getElementById('dkdDisplayUnitLabel');
    const wrap     = document.getElementById('dkdDisplayUnitWrap');
    if (hiddenEl) hiddenEl.value = unit;
    if (labelEl)  labelEl.textContent = unit;
    if (wrap) {
        wrap.querySelectorAll('.cs-opt').forEach(b => b.classList.remove('cs-opt-active'));
        if (btn) btn.classList.add('cs-opt-active');
        wrap.classList.remove('open');
    }
    convertAndRerenderTables(unit);
}

// ── Custom Sort Dropdown ──
function toggleSortDropdown(e) {
    e.stopPropagation();
    const wrap = document.getElementById('historySortSelect');
    const isOpen = wrap.classList.contains('open');
    wrap.classList.toggle('open');
    if (!isOpen) {
        setTimeout(() => document.addEventListener('click', _closeSortOnce), 0);
    }
}
function _closeSortOnce() {
    document.getElementById('historySortSelect').classList.remove('open');
    document.removeEventListener('click', _closeSortOnce);
}
function setSortOption(value, label, btn) {
    currentSortValue = value;
    document.getElementById('historySortLabel').textContent = label;
    document.querySelectorAll('.cs-opt').forEach(b => b.classList.remove('cs-opt-active'));
    btn.classList.add('cs-opt-active');
    document.getElementById('historySortSelect').classList.remove('open');
    document.removeEventListener('click', _closeSortOnce);
    applyHistoryFilter();
}

function updateCompareBtn() {
    const btn = document.getElementById('compareBtn');
    const lbl = document.getElementById('compareBtnLabel');
    const n = compareSelection.length;
    btn.disabled = n !== 2;
    lbl.textContent = n === 2 ? 'Compare Selected (2/2)' : `Compare (${n}/2)`;
}

function closeHistoryDialog() {
    document.getElementById('historyOverlay').classList.remove('active');
    if (!sessionStarted) {
        openStartupOverlay();
    }
}

function deleteHistoryEntry(fp) {
    showConfirmDialog(
        'Delete Session?',
        'Are you sure you want to permanently delete this session record? This action cannot be undone.',
        'Delete Record',
        async () => {
            closeConfirm();
            const res = await pywebview.api.delete_history(fp);
            if (res.success) {
                showToast('Record deleted.', 'success');
                compareSelection = compareSelection.filter(s => s.filepath !== fp);
                updateCompareBtn();
                await refreshHistoryData();
            } else {
                showToast(res.message || 'Failed to delete record.', 'error');
            }
        }
    );
}

async function executeLoadHistory(fp) {
    closeConfirm();
    const res = await pywebview.api.load_history(fp);
    if (!res.success) { showToast(`Failed: ${res.message}`, 'error'); return; }

    document.body.classList.remove('in-startup');
    sessionStarted = true;

    // ══════════════════════════════════════════════════════════════════════════
    // DKD Session restore
    // ══════════════════════════════════════════════════════════════════════════
    if (res.is_dkd) {
        const d = res.dkd_data;
        const meta = d.meta || {};

        // ── 0. Build Table Structure First ────────────────────────────────────
        const mockRes = {
            locked_sequence: d.sequence || 'A',
            u_standard_pa: (d.u_std != null ? (d.u_std * unitConvFactor((d.setup || {}).input_unit || 'bar')) : 0)
        };
        buildStaircasePreview(mockRes, d.setup || {});

        // ── 1. Restore dkdWizardState ─────────────────────────────────────────
        dkdWizardState.setup           = d.setup           || {};
        dkdWizardState.sequence        = d.sequence        || 'A';
        dkdWizardState.setpoints       = d.setpoints       || [];
        dkdWizardState.mSeries         = d.mSeries         || [];
        dkdWizardState.preloadData     = d.preloadData     || [];
        dkdWizardState.measurementData = d.measurementData || {};
        dkdWizardState.zeroSettingData = d.zeroSettingData || null;
        dkdWizardState.lastRowResults  = d.rowResults      || [];
        dkdWizardState.lastU_std       = d.u_std  != null  ? d.u_std  : 0;
        dkdWizardState.lastU_res       = d.u_res  != null  ? d.u_res  : 0;
        dkdWizardState.lastU_f0        = d.u_f0   != null  ? d.u_f0   : 0;
        dkdWizardState.lastMpeVal      = d.mpe_val != null ? d.mpe_val : 0;
        dkdWizardState.lastRawUnit     = d.raw_unit || (d.setup || {}).input_unit || '';

        // ── 1.5 Reverse Map Setup Form ────────────────────────────────────────
        const su = d.setup || {};
        const runUnit = su.input_unit || 'bar';
        setCustomSelect('dkdUnit', runUnit, runUnit, document.querySelector(`#dkdUnitDropdown .cs-opt[onclick*="'${runUnit}'"]`), 'dkdUnitWrap');

        document.getElementById('dkdLrv').value = su.lrv !== undefined ? su.lrv : 0;
        document.getElementById('dkdUrv').value = su.urv !== undefined ? su.urv : 100;
        document.getElementById('dkdRes').value = su.resolution !== undefined ? su.resolution : 0.01;
        document.getElementById('dkdTol').value = su.mpe_percent !== undefined ? su.mpe_percent : 0.5;

        const calType = su.calibrator_type || 'DIGITAL';
        const calLabel = calType === 'DWT' ? 'Dead-Weight Tester' : 'Digital Calibrator';
        setCustomSelect('dkdCalType', calType, calLabel, document.querySelector(`#dkdCalTypeDropdown .cs-opt[onclick*="'${calType}'"]`), 'dkdCalTypeWrap');
        toggleDkdCalType();

        document.getElementById('dkdStdFs').value   = su.std_full_scale !== undefined ? su.std_full_scale : 100;
        document.getElementById('dkdStdAcc').value  = su.std_accuracy_percent !== undefined ? su.std_accuracy_percent : 0.025;
        document.getElementById('dkdUstdDwt').value = su.u_standard_dwt !== undefined ? su.u_standard_dwt : 0;
        document.getElementById('dkdAlphaBeta').value = su.alpha_plus_beta !== undefined ? su.alpha_plus_beta : 0;
        document.getElementById('dkdRhoM').value    = su.rho_m !== undefined ? su.rho_m : 8000;
        document.getElementById('dkdLambda').value  = su.lambda_val !== undefined ? su.lambda_val : 0;
        document.getElementById('dkdHDiff').value   = su.height_diff !== undefined ? su.height_diff : 0;
        document.getElementById('dkdMedRho').value  = su.medium_density !== undefined ? su.medium_density : 1.2;

        // ── 2. Populate metadata header fields ────────────────────────────────
        document.getElementById('metaOperator').value = meta.operator_name    || '';
        document.getElementById('metaModel').value    = meta.instrument_model || '';
        const mSnDkd = document.getElementById('metaSerial');
        if (mSnDkd) mSnDkd.value = meta.serial_number || '';
        const mTgDkd = document.getElementById('metaTag');
        if (mTgDkd) mTgDkd.value = meta.tag_number || '';
        document.getElementById('metaDate').value     = meta.date             || '';
        document.getElementById('metaLocation').value = meta.location         || '';
        const stdSel = document.getElementById('metaCalStandard');
        if (stdSel) stdSel.value = 'DKD-R 6-1';

        // ── 3. Switch workspace to DKD ────────────────────────────────────────
        document.body.classList.add('dkd-mode');

        // ── 4. Close history dialog first, mark session started ───────────────
        document.getElementById('historyOverlay').classList.remove('active');
        sessionStarted = true;
        dkdSessionFilepath = fp;   // "Save Data" will overwrite this file

        // ── 5. Replicate calculateDkdResults() DOM side-effects ───────────────
        dkdWizardState.isImported = true;
        
        // Disable Setup Form & Lock Sequence Button
        document.querySelectorAll('.input-layout-grid input, .input-layout-grid select, .input-layout-grid button.cs-trigger').forEach(el => el.disabled = true);
        const dkdLockBtn = document.getElementById('dkdLockBtn');
        if (dkdLockBtn) {
            dkdLockBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Loaded Data`;
            dkdLockBtn.style.background = 'var(--bg-elevated)';
            dkdLockBtn.style.color = 'var(--mx-muted)';
            dkdLockBtn.style.cursor = 'not-allowed';
            dkdLockBtn.onclick = null;
            dkdLockBtn.disabled = true;
        }

        // Unlock table tab and detail buttons
        unlockMainTab('table');
        
        // Show Detail Buttons
        const btnT1 = document.getElementById('btnDetailT1');
        const btnT2 = document.getElementById('btnDetailT2');
        if (btnT1) btnT1.style.display = 'inline-flex';
        if (btnT2) btnT2.style.display = 'inline-flex';

        // ── 6. Populate unit selector ─────────────────────────────────────────
        populateDisplayUnitSelect(['bar', 'psi', 'kPa', 'MPa', 'Pa', 'mbar', 'hPa'], dkdWizardState.lastRawUnit);

        // ── 7. Give DOM one tick to settle, then render all result sections ────
        // Enable ribbon actions (Export, Save, etc) now that the sequence is locked
        setActionsEnabled(true);

        await new Promise(r => setTimeout(r, 60));

        populateStaircaseTableFromState();
        renderPreloadTable();
        convertAndRerenderTables(dkdWizardState.lastRawUnit);
        renderLadderChart();
        calculateDkdResults();

        // ── 8. Ribbon buttons: enable all, disable Save Data (already on disk) ─
        ['btnExportSession','btnSaveData','btnSaveAsNew','btnExportExcel','btnExportPdf']
            .forEach(id => { const el = document.getElementById(id); if (el) el.disabled = false; });
        document.getElementById('btnSaveData').disabled = true;

        refreshHeader();
        // Restore session trend log from loaded DKD session
        restoreSessionTrend(d.session_trend_log || res.session_trend_log, d, d.avg_env);
        showToast('DKD session loaded!', 'success');
        return;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Default calibration session restore
    // ══════════════════════════════════════════════════════════════════════════
    currentInput = res.input; currentResult = res.result;
    activeHistoryFilepath = fp;
    const meta = currentInput.metadata || {};
    document.getElementById('metaOperator').value = meta.operator_name || '';
    document.getElementById('metaModel').value    = meta.instrument_model || '';
    const mSnDef = document.getElementById('metaSerial');
    if (mSnDef) mSnDef.value = meta.serial_number || '';
    const mTgDef = document.getElementById('metaTag');
    if (mTgDef) mTgDef.value = meta.tag_number || '';
    document.getElementById('metaDate').value     = meta.date || '';
    document.getElementById('metaLocation').value = meta.location || '';

    const savedStandard = meta.calibration_standard || 'Default';
    const stdSel = document.getElementById('metaCalStandard');
    if (stdSel) stdSel.value = savedStandard;
    const isDkd = savedStandard === 'DKD-R 6-1';
    document.body.classList.toggle('dkd-mode', isDkd);

    document.getElementById('cfgLrv').value = currentInput.lrv;
    document.getElementById('cfgUrv').value = currentInput.urv;
    document.getElementById('cfgTol').value = currentInput.tolerance_pct;
    document.getElementById('dataTableBody').innerHTML = '';
    currentInput.points.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td><input type="number" step="any" value="${p.set_point}"></td><td><input type="text" value="${p.readings_up.join(';')}"></td><td><button class="del-row-btn" onclick="deleteThisRow(this)" title="Delete row">×</button></td>`;
        document.getElementById('dataTableBody').appendChild(tr);
    });
    document.getElementById('historyOverlay').classList.remove('active');
    sessionStarted = true;
    renderSummary(currentResult); renderAllCharts(currentInput, currentResult);
    setTabsEnabled(true); setActionsEnabled(true);
    document.getElementById('btnSaveData').disabled = true;
    document.getElementById('btnSaveAsNew').disabled = true;
    document.getElementById('resetBtn').disabled = false;
    refreshHeader(); switchMainTab('summary');
    // Restore session trend log from loaded default session
    restoreSessionTrend(res.session_trend_log, null, null);
    showToast('History loaded!', 'success');
}


function loadHistoryEntry(fp) {
    const hasUnsaved = currentResult && !document.getElementById('btnSaveData').disabled;
    if (hasUnsaved) {
        showConfirmDialog(
            'Unsaved Analysis Data',
            'You have unsaved analysis results. Loading another session will discard your current work. Are you sure you want to proceed?',
            'Discard & Load',
            () => executeLoadHistory(fp)
        );
    } else {
        executeLoadHistory(fp);
    }
}

async function saveData() {
    if (document.body.classList.contains('dkd-mode')) {
        // DKD mode: export as JSON session file
        showToast('DKD sessions can be exported via Download PDF or Export Excel.', 'info');
        return;
    }
    const trendJson = JSON.stringify(sessionTrendLog || []);
    const res = await pywebview.api.save_history(activeHistoryFilepath, trendJson);
    if (res.success) {
        activeHistoryFilepath = res.filepath;
        if (res.new_date) document.getElementById('metaDate').value = res.new_date;
        document.getElementById('btnSaveData').disabled = true;
        document.getElementById('btnSaveAsNew').disabled = true;
        refreshHeader();
        showToast('Data saved.', 'success');
    }
    else showToast(`Save failed: ${res.message}`, 'error');
}

async function saveAsNewData() {
    if (document.body.classList.contains('dkd-mode')) {
        showToast('DKD sessions can be exported via Download PDF or Export Excel.', 'info');
        return;
    }
    const trendJson = JSON.stringify(sessionTrendLog || []);
    const res = await pywebview.api.save_history(null, trendJson);
    if (res.success) {
        activeHistoryFilepath = res.filepath;
        if (res.new_date) document.getElementById('metaDate').value = res.new_date;
        document.getElementById('btnSaveData').disabled = true;
        document.getElementById('btnSaveAsNew').disabled = true;
        refreshHeader();
        showToast('Saved as new record.', 'success');
    }
    else showToast(`Save failed: ${res.message}`, 'error');
}

async function exportReport(fmt, certNumber) {
    if (fmt === 'pdf') {
        await openPdfPreviewModal(certNumber);
        return;
    }

    if (document.body.classList.contains('dkd-mode')) {
        await exportDkdReport('excel');
        return;
    }
    showToast('Preparing export…', 'info');
    const res = await pywebview.api.export_report(fmt, certNumber || '');
    if (res.success) showToast('Export complete!', 'success');
    else if (res.message !== 'Export cancelled.') showToast(`Export failed: ${res.message}`, 'error');
}

function importHistory() {
    const input = document.getElementById('importNameInput');
    input.value = document.getElementById('metaOperator').value.trim(); // default to operator if filled
    document.getElementById('importPromptOverlay').classList.add('active');
    setTimeout(() => input.focus(), 100);
}

async function proceedImport() {
    const importerName = document.getElementById('importNameInput').value.trim() || 'Unknown';
    document.getElementById('importPromptOverlay').classList.remove('active');

    showToast('Select one or more Alition history (.json) files to import…', 'info');
    try {
        const res = await pywebview.api.import_history(importerName);
        if (res.success) {
            if (res.conflicts && res.conflicts.length > 0) {
                showToast(`Impor selesai: ${res.message}. Catatan: ${res.conflicts.join(', ')}`, 'warning');
            } else {
                showToast(res.message, 'success');
            }
            if (document.getElementById('historyOverlay').classList.contains('active')) {
                await refreshHistoryData();
            } else {
                openHistoryDialog();
            }
        } else if (res.message !== 'Import cancelled.') {
            showToast(`Import failed: ${res.message}`, 'error');
        }
    } catch (e) {
        showToast(`Import error: ${e}`, 'error');
    }
}

// ── Default-only: export session as JSON ─────────────────────────────────────
async function exportSession() {
    showToast('Preparing session export…', 'info');
    try {
        const res = await pywebview.api.export_session();
        if (res.success) showToast('Session exported successfully!', 'success');
        else if (res.message !== 'Export cancelled.') showToast(`Export failed: ${res.message}`, 'error');
    } catch (e) {
        showToast(`Export error: ${e}`, 'error');
    }
}


// ═══════════════════════════════════════════════════════════════════════════════
// RIBBON DISPATCHERS - completely separate DKD and Default paths
// ═══════════════════════════════════════════════════════════════════════════════

function _isDkdMode() {
    return document.body.classList.contains('dkd-mode');
}

/** Track the current save path for DKD sessions (null = not yet saved) */
let dkdSessionFilepath = null;

/** Helper to extract time-series ambient trend points from DKD measurementData */
function _extractTrendFromMeasurementData(measurementData, mSeries) {
    const list = [];
    if (!measurementData || !mSeries) return list;
    let idx = 0;
    const parseVal = (v) => {
        if (typeof v === 'number') return v;
        if (typeof v === 'string') {
            const m = v.match(/-?\d+(\.\d+)?/);
            return m ? parseFloat(m[0]) : null;
        }
        return null;
    };
    mSeries.forEach(m => {
        (measurementData[m] || []).forEach(r => {
            if (r && r.env) {
                const t = parseVal(r.env.temperature ?? r.env.temp);
                const h = parseVal(r.env.humidity ?? r.env.hum);
                const p = parseVal(r.env.pressure_atm ?? r.env.pressure ?? r.env.press);
                if (t !== null && h !== null && p !== null) {
                    const minutes = Math.floor(idx * 2);
                    const mm = String(minutes).padStart(2, '0');
                    list.push({
                        ts: r.timestamp ? new Date(r.timestamp).getTime() : Date.now() + idx * 120000,
                        timeStr: `${mm}:00`,
                        temp: t,
                        hum: h,
                        press: p
                    });
                    idx++;
                }
            }
        });
    });
    return list;
}

/** Restores sessionTrendLog from loaded history data, with graceful fallback extraction */
function restoreSessionTrend(loadedLog, dkdData, fallbackAvgEnv) {
    if (Array.isArray(loadedLog) && loadedLog.length > 0) {
        sessionTrendLog = loadedLog;
    } else {
        // Fallback: extract from measurementData if available
        let extracted = [];
        if (dkdData && dkdData.measurementData && dkdData.mSeries) {
            extracted = _extractTrendFromMeasurementData(dkdData.measurementData, dkdData.mSeries);
        }
        if (extracted.length > 0) {
            sessionTrendLog = extracted;
        } else if (fallbackAvgEnv && (fallbackAvgEnv.temperature !== undefined || fallbackAvgEnv.temp !== undefined)) {
            const t = fallbackAvgEnv.temperature ?? fallbackAvgEnv.temp ?? 20;
            const h = fallbackAvgEnv.humidity ?? fallbackAvgEnv.hum ?? 50;
            const p = fallbackAvgEnv.pressure_atm ?? fallbackAvgEnv.press ?? 1013.25;
            sessionTrendLog = [
                { ts: Date.now() - 300000, timeStr: "00:00", temp: t, hum: h, press: p },
                { ts: Date.now(),          timeStr: "05:00", temp: t, hum: h, press: p }
            ];
        } else {
            sessionTrendLog = [];
        }
    }

    sessionTrendRecording = false;

    // Switch environmental trend charts to SESSION TREND view and re-render
    switchTrendMode('session', true);
}

/** Build the full DKD payload from current state - used by all DKD save/export actions */
function _buildDkdPayload() {
    const s = dkdWizardState;
    const allEnvs = [];
    s.mSeries.forEach(m => (s.measurementData[m] || []).forEach(r => { if (r.env) allEnvs.push(r.env); }));
    const avgEnv = (key, fb) => {
        const v = allEnvs.map(e => e[key]).filter(x => x !== null && !isNaN(x));
        return v.length > 0 ? v.reduce((a, b) => a + b, 0) / v.length : fb;
    };

    // Use current sessionTrendLog if populated, or fallback extract from measurementData
    let trendToSave = (Array.isArray(sessionTrendLog) && sessionTrendLog.length > 0) ? sessionTrendLog : [];
    if (trendToSave.length === 0 && s.measurementData && s.mSeries) {
        trendToSave = _extractTrendFromMeasurementData(s.measurementData, s.mSeries);
    }

    return JSON.stringify({
        meta:            getMeta(),
        setup:           s.setup,
        sequence:        s.sequence,
        setpoints:       s.setpoints,
        mSeries:         s.mSeries,
        preloadData:     s.preloadData,
        measurementData: s.measurementData,
        zeroSettingData: s.zeroSettingData,
        rowResults:      s.lastRowResults,
        u_std:           s.lastU_std,
        u_res:           s.lastU_res,
        u_f0:            s.lastU_f0,
        mpe_val:         s.lastMpeVal,
        raw_unit:        s.lastRawUnit,
        avg_env: {
            temperature:  avgEnv('temperature',  20),
            humidity:     avgEnv('humidity',     50),
            pressure_atm: avgEnv('pressure_atm', 1013.25)
        },
        session_trend_log: trendToSave
    });
}

// ── Export Session ── Export session data as JSON file ────────────────────────
async function ribbonExportSession() {
    if (_isDkdMode()) {
        showToast('Preparing session JSON export…', 'info');
        try {
            const res = await pywebview.api.export_dkd_session(_buildDkdPayload());
            if (res && res.success) showToast(`Session exported: ${res.filepath}`, 'success');
            else if (res?.message !== 'Export cancelled.') showToast(res?.message || 'Export failed.', 'error');
        } catch (e) { showToast(`Export error: ${e}`, 'error'); }
    } else {
        await exportSession();
    }
}

// ── Save Data ── Save session to existing path (overwrite) ────────────────────
async function ribbonSaveData() {
    if (_isDkdMode()) {
        showToast('Saving DKD session…', 'info');
        try {
            const res = await pywebview.api.save_dkd_session(_buildDkdPayload(), dkdSessionFilepath);
            if (res && res.success) {
                dkdSessionFilepath = res.filepath;
                document.getElementById('btnSaveData').disabled = true;
                showToast(`Session saved: ${res.filepath}`, 'success');
            } else if (res?.message !== 'Save cancelled.') {
                showToast(res?.message || 'Save failed.', 'error');
            }
        } catch (e) { showToast(`Save error: ${e}`, 'error'); }
    } else {
        await saveData();
    }
}

// ── Save as New ── Always save to a new file path ─────────────────────────────
async function ribbonSaveAsNew() {
    if (_isDkdMode()) {
        showToast('Saving DKD session as new…', 'info');
        try {
            // Pass null so backend always prompts for a new path
            const res = await pywebview.api.save_dkd_session(_buildDkdPayload(), null);
            if (res && res.success) {
                dkdSessionFilepath = res.filepath;
                showToast(`Saved as new: ${res.filepath}`, 'success');
            } else if (res?.message !== 'Save cancelled.') {
                showToast(res?.message || 'Save failed.', 'error');
            }
        } catch (e) { showToast(`Save error: ${e}`, 'error'); }
    } else {
        await saveAsNewData();
    }
}

// ── Export Excel ── Export DKD certificate as Excel workbook ──────────────────
async function ribbonExportExcel() {
    if (_isDkdMode()) {
        await exportDkdReport('excel');
    } else {
        showToast('Preparing export…', 'info');
        const res = await pywebview.api.export_report('excel');
        if (res.success) showToast('Export complete!', 'success');
        else if (res.message !== 'Export cancelled.') showToast(`Export failed: ${res.message}`, 'error');
    }
}

function showInputDialog(title, label, placeholder = '') {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100vw';
        overlay.style.height = '100vh';
        overlay.style.backgroundColor = 'rgba(15, 23, 42, 0.6)';
        overlay.style.display = 'flex';
        overlay.style.justifyContent = 'center';
        overlay.style.alignItems = 'center';
        overlay.style.zIndex = '99999';
        overlay.style.backdropFilter = 'blur(4px)';

        const dialog = document.createElement('div');
        dialog.style.width = '360px';
        dialog.style.padding = '24px';
        dialog.style.borderRadius = '12px';
        dialog.style.background = '#ffffff';
        dialog.style.boxShadow = '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)';
        dialog.style.border = '1px solid #e2e8f0';

        const h3 = document.createElement('h3');
        h3.textContent = title;
        h3.style.margin = '0 0 12px 0';
        h3.style.fontFamily = 'Inter, sans-serif';
        h3.style.fontSize = '16px';
        h3.style.fontWeight = '600';
        h3.style.color = '#1e293b';

        const lbl = document.createElement('label');
        lbl.textContent = label;
        lbl.style.display = 'block';
        lbl.style.marginBottom = '6px';
        lbl.style.fontFamily = 'Inter, sans-serif';
        lbl.style.fontSize = '12px';
        lbl.style.fontWeight = '500';
        lbl.style.color = '#64748b';

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = placeholder;
        input.style.width = '100%';
        input.style.padding = '8px 12px';
        input.style.border = '1px solid #cbd5e1';
        input.style.borderRadius = '6px';
        input.style.fontSize = '14px';
        input.style.marginBottom = '18px';
        input.style.boxSizing = 'border-box';
        input.style.outline = 'none';
        input.style.fontFamily = 'Inter, sans-serif';

        const btnRow = document.createElement('div');
        btnRow.style.display = 'flex';
        btnRow.style.justifyContent = 'flex-end';
        btnRow.style.gap = '10px';

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.padding = '6px 14px';
        cancelBtn.style.border = '1px solid #cbd5e1';
        cancelBtn.style.borderRadius = '6px';
        cancelBtn.style.background = '#ffffff';
        cancelBtn.style.cursor = 'pointer';
        cancelBtn.style.fontSize = '13px';
        cancelBtn.style.fontWeight = '500';
        cancelBtn.style.color = '#64748b';
        cancelBtn.style.fontFamily = 'Inter, sans-serif';

        const submitBtn = document.createElement('button');
        submitBtn.textContent = 'Export';
        submitBtn.style.padding = '6px 14px';
        submitBtn.style.border = 'none';
        submitBtn.style.borderRadius = '6px';
        submitBtn.style.background = '#1e3a8a';
        submitBtn.style.color = '#ffffff';
        submitBtn.style.cursor = 'pointer';
        submitBtn.style.fontSize = '13px';
        submitBtn.style.fontWeight = '500';
        submitBtn.style.fontFamily = 'Inter, sans-serif';

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(submitBtn);

        dialog.appendChild(h3);
        dialog.appendChild(lbl);
        dialog.appendChild(input);
        dialog.appendChild(btnRow);
        overlay.appendChild(dialog);

        document.body.appendChild(overlay);
        input.focus();

        cancelBtn.onclick = () => {
            document.body.removeChild(overlay);
            resolve(null);
        };

        submitBtn.onclick = () => {
            const val = input.value.trim();
            document.body.removeChild(overlay);
            resolve(val);
        };

        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                submitBtn.click();
            } else if (e.key === 'Escape') {
                cancelBtn.click();
            }
        };
    });
}

// ── Download PDF ── Export DKD certificate as PDF ─────────────────────────────
async function ribbonExportPdf() {
    await openPdfPreviewModal();
}

// Also reset dkdSessionFilepath when DKD sequence is unlocked



// ─── Reset ────────────────────────────────────────────────────────────────────
function resetApp() {
    executeNewSession();
}

// ─── Main Tab Navigation ────────────────────────────────────────────────────────
function switchMainTab(tabId) {
    const tabBtn = document.getElementById(`pillTab_${tabId}`);
    if (tabBtn && tabBtn.classList.contains('disabled')) {
        // Progressive disclosure toast messages
        if (tabId === 'table') showToast("Please lock your parameters first.", "warning");
        else if (['graph', 'stats', 'uncert', 'summary'].includes(tabId)) showToast("Complete data acquisition (Start Preloading) first.", "warning");
        return;
    }

    // Hide all panes
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    // Deactivate all pill tabs
    document.querySelectorAll('.pill-tab').forEach(b => b.classList.remove('active'));
    
    // Activate selected
    const pane = document.getElementById(`pane_${tabId}`);
    if (pane) pane.classList.add('active');
    if (tabBtn) tabBtn.classList.add('active');

    if (tabId === 'ambien') {
        envTrendVisible = true;
        if (typeof _updateAmbTopHeader === 'function') _updateAmbTopHeader();
        renderEnvTrendCharts();
    } else {
        envTrendVisible = false;
    }
}

function unlockMainTab(tabId) {
    const tabBtn = document.getElementById(`pillTab_${tabId}`);
    if (tabBtn) tabBtn.classList.remove('disabled');
}

function lockMainTab(tabId) {
    const tabBtn = document.getElementById(`pillTab_${tabId}`);
    if (tabBtn) tabBtn.classList.add('disabled');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function setTabsEnabled(on) {
    ['cal_curve', 'err_curve', 'res_curve'].forEach(id => { 
        const btn = document.getElementById(`btnTab_${id}`);
        if(btn) btn.disabled = !on; 
    });
}
function setActionsEnabled(on) {
    ['btnSaveData', 'btnSaveAsNew', 'btnExportExcel', 'btnExportPdf', 'btnExportSession'].forEach(id => { 
        const btn = document.getElementById(id);
        if(btn) btn.disabled = !on; 
    });
}
function showToast(msg, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    // Max 2 toasts at a time: remove oldest if exceeding limit
    while (container.children.length >= 2) {
        container.removeChild(container.firstChild);
    }
    
    // Prevent exactly identical messages stacking simultaneously
    const existing = Array.from(container.children);
    for (const t of existing) {
        if (t.textContent === msg) t.remove();
    }

    const t = document.createElement('div');
    t.className = `toast ${type}`; t.textContent = msg;
    container.appendChild(t);
    setTimeout(() => { if(t.parentNode) t.remove(); }, 3500);
}

// ─── Compare Modal ────────────────────────────────────────────────────────────
async function openCompareModal() {
    if (compareSelection.length !== 2) return;
    if (compareSelection[0].model !== compareSelection[1].model) {
        showToast('Both sessions must use the same instrument model.', 'error'); return;
    }
    showToast('Loading comparison data…', 'info');
    try {
        let [resA, resB] = await Promise.all([
            pywebview.api.load_history_for_compare(compareSelection[0].filepath),
            pywebview.api.load_history_for_compare(compareSelection[1].filepath)
        ]);
        if (!resA.success || !resB.success) {
            showToast('Failed to load history files.', 'error'); return;
        }

        // Hydrate DKD sessions into the default point_results format for comparison compatibility
        const hydrateDkd = (res) => {
            if (!res.is_dkd || !res.dkd_data) return res;
            const dkd = res.dkd_data;
            const span = (dkd.setup.urv - dkd.setup.lrv) || 1;
            res.input = res.input || {};
            res.result = res.result || {};
            res.input.metadata = Object.assign(res.input.metadata || {}, dkd.meta || {});
            res.result.overall_status = dkd.rowResults && dkd.rowResults.every(r => r.pass) ? 'PASS' : 'FAIL';
            res.result.point_results = (dkd.rowResults || []).map(r => ({
                set_point: r.nom_ideal,
                avg_reading: r.mean,
                error: r.dev,
                error_pct_span: (r.dev / span) * 100,
                std_dev: r.std_dev || 0,
                repeatability_pct_span: (r.repeatability || r.h || 0) / span * 100,
                status: r.pass ? 'PASS' : 'FAIL'
            }));
            return res;
        };
        resA = hydrateDkd(resA);
        resB = hydrateDkd(resB);

        const r4 = v => Math.round(v * 10000) / 10000;
        const mapA = {}, mapB = {};
        resA.result.point_results.forEach(p => { mapA[r4(p.set_point)] = p; });
        resB.result.point_results.forEach(p => { mapB[r4(p.set_point)] = p; });
        const commonKeys = Object.keys(mapA).filter(k => mapB[k] !== undefined).map(Number).sort((a, b) => a - b);
        if (commonKeys.length === 0) { showToast('No matching set points between sessions.', 'error'); return; }
        const ptsA = commonKeys.map(k => mapA[k]);
        const ptsB = commonKeys.map(k => mapB[k]);
        const metaA = resA.input.metadata || {};
        const metaB = resB.input.metadata || {};
        // Store export payload
        _cmpExportData = { sessionA: compareSelection[0], sessionB: compareSelection[1], resA, resB, commonKeys };
        renderCompareOverview(resA.result, resB.result, metaA, metaB);
        renderComparePoints(ptsA, ptsB, commonKeys);
        Object.values(compareCharts).forEach(c => c && c.destroy());
        compareCharts = {};
        pendingCmpData = { ptsA, ptsB, commonKeys, metaA, metaB };
        switchCompareTab('overview');
        document.getElementById('compareOverlay').classList.add('active');
    } catch (e) {
        showToast('Compare error: ' + e.message, 'error');
        console.error(e);
    }
}

function closeCompareModal() {
    document.getElementById('compareOverlay').classList.remove('active');
    Object.values(compareCharts).forEach(c => c && c.destroy());
    compareCharts = {};
    pendingCmpData = null;
    _cmpExportData = null;
}

async function exportCompareReport() {
    if (!_cmpExportData) { showToast('No comparison data to export.', 'error'); return; }
    
    const certNumber = await showInputDialog(
        'Calibration Certificate Number',
        'Enter the calibration certificate number (optional):',
        'e.g. CAL-2026-001'
    );
    if (certNumber === null) return; // User cancelled

    showToast('Preparing comparison export…', 'info');
    const res = await pywebview.api.export_compare_report(JSON.stringify(_cmpExportData), certNumber);
    if (res.success) showToast('Comparison exported!', 'success');
    else if (res.message !== 'Export cancelled.') showToast(`Export failed: ${res.message}`, 'error');
}

function switchCompareTab(name) {
    document.querySelectorAll('.ctab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.ctab').forEach(b => b.classList.remove('active'));
    document.getElementById(`ctab_${name}`).classList.add('active');
    document.getElementById(`ctabBtn_${name}`).classList.add('active');
    // Lazy-render charts only when tab is visible
    if (name === 'charts' && pendingCmpData) {
        const { ptsA, ptsB, commonKeys, metaA, metaB } = pendingCmpData;
        pendingCmpData = null;
        setTimeout(() => renderCompareCharts(ptsA, ptsB, commonKeys, metaA, metaB), 50);
    } else if (name === 'charts') {
        setTimeout(() => Object.values(compareCharts).forEach(c => c && c.resize()), 50);
    }
}

function renderCompareOverview(rA, rB, metaA, metaB) {
    const f = (v, d = 4) => v != null ? Number(v).toFixed(d) : '-';
    const statusBadge = s => `<span class="${s === 'PASS' ? 'cmp-status-pass' : 'cmp-status-fail'}">${s}</span>`;
    const deltaRow = (label, vA, vB, lowerBetter = true, d = 4, unit = '') => {
        const fmtA = vA != null ? f(vA, d) + unit : '-';
        const fmtB = vB != null ? f(vB, d) + unit : '-';
        if (vA == null || vB == null) return `<tr><td>${label}</td><td>${fmtA}</td><td>${fmtB}</td><td class="delta-same">-</td></tr>`;
        const delta = Number(vB) - Number(vA);
        const abs = Math.abs(delta);
        let cls = 'delta-same', icon = '';
        if (abs > 0.000001) {
            const isBetter = (delta < 0 && lowerBetter) || (delta > 0 && !lowerBetter);
            cls = isBetter ? 'delta-better' : 'delta-worse';
            icon = isBetter ? ' ▲' : ' ▼';
        }
        const sign = delta > 0 ? '+' : '';
        return `<tr><td>${label}</td><td>${fmtA}</td><td>${fmtB}</td><td class="${cls}">${sign}${f(delta, d)}${unit}${icon}</td></tr>`;
    };
    document.getElementById('compareOverviewContent').innerHTML = `
        <div class="cmp-session-row">
            <div class="cmp-session-card">
                <div class="cmp-session-tag"><span class="cmp-dot"></span>Session A</div>
                <div class="cmp-session-field"><span class="cmp-sf-lbl">Instrument</span><span class="cmp-sf-val">${metaA.instrument_model || '-'}</span></div>
                <div class="cmp-session-field"><span class="cmp-sf-lbl">Operator</span><span class="cmp-sf-val">${metaA.operator_name || '-'}</span></div>
                <div class="cmp-session-field"><span class="cmp-sf-lbl">Date</span><span class="cmp-sf-val">${metaA.date || '-'}</span></div>
                <div class="cmp-session-field"><span class="cmp-sf-lbl">Location</span><span class="cmp-sf-val">${metaA.location || '-'}</span></div>
                <div class="cmp-session-field"><span class="cmp-sf-lbl">Status</span><span class="cmp-sf-val">${statusBadge(rA.overall_status)}</span></div>
            </div>
            <div class="cmp-session-card b">
                <div class="cmp-session-tag"><span class="cmp-dot b"></span>Session B</div>
                <div class="cmp-session-field"><span class="cmp-sf-lbl">Instrument</span><span class="cmp-sf-val">${metaB.instrument_model || '-'}</span></div>
                <div class="cmp-session-field"><span class="cmp-sf-lbl">Operator</span><span class="cmp-sf-val">${metaB.operator_name || '-'}</span></div>
                <div class="cmp-session-field"><span class="cmp-sf-lbl">Date</span><span class="cmp-sf-val">${metaB.date || '-'}</span></div>
                <div class="cmp-session-field"><span class="cmp-sf-lbl">Location</span><span class="cmp-sf-val">${metaB.location || '-'}</span></div>
                <div class="cmp-session-field"><span class="cmp-sf-lbl">Status</span><span class="cmp-sf-val">${statusBadge(rB.overall_status)}</span></div>
            </div>
        </div>
        <div class="cmp-metrics-card">
            <div class="cmp-metrics-hdr">
                <span data-hint="Comparison of result metrics between two sessions.">Result Metrics Comparison</span>
                <small style="font-weight:400;color:var(--green);margin-left:8px">▲ green = better &nbsp; <span style="color:var(--red)">▼ red = worse</span></small>
            </div>
            <table class="cmp-table">
                <thead><tr><th>Metric</th><th class="col-a">Session A</th><th class="col-b">Session B</th><th>Δ (B − A)</th></tr></thead>
                <tbody>
                    <tr><td>Overall Status</td><td>${statusBadge(rA.overall_status)}</td><td>${statusBadge(rB.overall_status)}</td><td class="delta-same">-</td></tr>
                    ${deltaRow('Span', rA.span, rB.span, false, 4)}
                    ${deltaRow('Max Error (%FS)', rA.max_error_pct_span, rB.max_error_pct_span, true, 5)}
                    ${deltaRow('Actual Accuracy (%)', rA.actual_accuracy_pct, rB.actual_accuracy_pct, false, 5)}
                    ${deltaRow('Mean Bias Error', rA.mean_error, rB.mean_error, true, 5)}
                    ${deltaRow('Std Deviation', rA.std_dev, rB.std_dev, true, 5)}
                    ${deltaRow('RMSE', rA.rmse, rB.rmse, true, 5)}
                    ${deltaRow('Linearity Error (%FS)', rA.linearity_error_pct, rB.linearity_error_pct, true, 5)}
                    ${deltaRow('Zero Error', rA.zero_error, rB.zero_error, true, 5)}
                    ${deltaRow('Span Error', rA.span_error, rB.span_error, true, 5)}
                    ${(rA.max_hysteresis != null || rB.max_hysteresis != null) ? deltaRow('Max Hysteresis', rA.max_hysteresis, rB.max_hysteresis, true, 5) : ''}
                </tbody>
            </table>
        </div>`;
}

function renderCompareCharts(ptsA, ptsB, commonKeys, metaA, metaB) {
    const sps = commonKeys;
    const avgA = ptsA.map(p => p.avg_reading), avgB = ptsB.map(p => p.avg_reading);
    const errA = ptsA.map(p => p.error_pct_span), errB = ptsB.map(p => p.error_pct_span);
    const cOpts = (xl, yl) => ({
        responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
        plugins: {
            legend: { labels: { color: '#5a5f7a', padding: 12, font: { size: 11 } } },
            tooltip: { backgroundColor: '#fff', borderColor: '#e2e5ef', borderWidth: 1, titleColor: '#1a1d2e', bodyColor: '#5a5f7a', padding: 8 }
        },
        scales: {
            x: { title: { display: true, text: xl, color: '#9096b4', font: { size: 10 } }, ticks: { color: '#9096b4', font: { size: 10 } }, grid: { color: '#ebebf0' } },
            y: { title: { display: true, text: yl, color: '#9096b4', font: { size: 10 } }, ticks: { color: '#9096b4', font: { size: 10 } }, grid: { color: '#ebebf0' } }
        }
    });
    if (compareCharts.cal) compareCharts.cal.destroy();
    compareCharts.cal = new Chart(document.getElementById('cmpCalChart'), {
        type: 'line',
        data: {
            labels: sps, datasets: [
                { label: 'Session A', data: avgA, borderColor: '#3b6ef8', backgroundColor: 'rgba(59,110,248,0.08)', pointBackgroundColor: '#3b6ef8', pointRadius: 5, borderWidth: 2, tension: 0.15, fill: true },
                { label: 'Session B', data: avgB, borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.08)', pointBackgroundColor: '#f59e0b', pointRadius: 5, borderWidth: 2, tension: 0.15, fill: true }
            ]
        }, options: cOpts('Set Point', 'Measured Output')
    });
    if (compareCharts.err) compareCharts.err.destroy();
    compareCharts.err = new Chart(document.getElementById('cmpErrChart'), {
        type: 'line',
        data: {
            labels: sps, datasets: [
                { label: 'Error A (%FS)', data: errA, borderColor: '#3b6ef8', backgroundColor: 'rgba(59,110,248,0.08)', pointBackgroundColor: '#3b6ef8', pointRadius: 5, borderWidth: 2, tension: 0.15, fill: true },
                { label: 'Error B (%FS)', data: errB, borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.08)', pointBackgroundColor: '#f59e0b', pointRadius: 5, borderWidth: 2, tension: 0.15, fill: true }
            ]
        }, options: cOpts('Set Point', 'Error (%FS)')
    });
    const calcRes = (pts, avgs) => { const n = pts.length, sx = pts.reduce((a, b) => a + b, 0), sy = avgs.reduce((a, b) => a + b, 0), sxy = pts.reduce((s, x, i) => s + x * avgs[i], 0), sx2 = pts.reduce((s, x) => s + x * x, 0), D = n * sx2 - sx * sx; if (!D) return avgs.map(() => 0); const a = (n * sxy - sx * sy) / D, b = (sy - a * sx) / n; return pts.map((x, i) => avgs[i] - (a * x + b)); };
    const resA = calcRes(sps, avgA), resB = calcRes(sps, avgB);
    if (compareCharts.res) compareCharts.res.destroy();
    compareCharts.res = new Chart(document.getElementById('cmpResChart'), {
        type: 'scatter',
        data: {
            datasets: [
                { label: 'Residuals A', data: sps.map((x, i) => ({ x, y: resA[i] })), backgroundColor: '#3b6ef8', pointRadius: 6, borderColor: '#fff', borderWidth: 2 },
                { label: 'Residuals B', data: sps.map((x, i) => ({ x, y: resB[i] })), backgroundColor: '#f59e0b', pointRadius: 6, borderColor: '#fff', borderWidth: 2 }
            ]
        }, options: cOpts('Set Point', 'Residual')
    });
    document.getElementById('cmpLegendContent').innerHTML = `
        <div class="cmp-legend-item">
            <div class="cmp-legend-dot" style="background:#3b6ef8"></div>
            <div class="cmp-legend-info">
                <div class="cmp-legend-label">Session A</div>
                <div class="cmp-legend-detail">${metaA.instrument_model || '-'} · ${metaA.operator_name || '-'}<br>${metaA.date || '-'} · ${metaA.location || '-'}</div>
            </div>
        </div>
        <div class="cmp-legend-item">
            <div class="cmp-legend-dot" style="background:#f59e0b"></div>
            <div class="cmp-legend-info">
                <div class="cmp-legend-label">Session B</div>
                <div class="cmp-legend-detail">${metaB.instrument_model || '-'} · ${metaB.operator_name || '-'}<br>${metaB.date || '-'} · ${metaB.location || '-'}</div>
            </div>
        </div>`;
}

function renderComparePoints(ptsA, ptsB, commonKeys) {
    const f = (v, d = 4) => v != null ? Number(v).toFixed(d) : '-';
    const rows = commonKeys.map((sp, i) => {
        const a = ptsA[i], b = ptsB[i];
        return `<tr>
            <td>${Number(sp).toFixed(2)}</td>
            <td class="col-a-val">${f(a.avg_reading)}</td><td class="col-b-val">${f(b.avg_reading)}</td>
            <td class="col-a-val cmp-pts-sep">${f(a.error, 5)}</td><td class="col-b-val">${f(b.error, 5)}</td>
            <td class="col-a-val cmp-pts-sep">${f(a.error_pct_span, 5)}</td><td class="col-b-val">${f(b.error_pct_span, 5)}</td>
            <td class="col-a-val cmp-pts-sep">${f(a.std_dev, 5)}</td><td class="col-b-val">${f(b.std_dev, 5)}</td>
            <td class="col-a-val cmp-pts-sep">${f(a.repeatability_pct_span, 5)}</td><td class="col-b-val">${f(b.repeatability_pct_span, 5)}</td>
            <td class="cmp-pts-sep"><span class="${a.status === 'PASS' ? 'badge-pass' : 'badge-fail'}">${a.status}</span></td>
            <td><span class="${b.status === 'PASS' ? 'badge-pass' : 'badge-fail'}">${b.status}</span></td>
        </tr>`;
    }).join('');
    document.getElementById('comparePointsContent').innerHTML = `
        <div class="cmp-points-card">
            <div class="cmp-points-hdr">
                <span>Point-by-Point Comparison</span>
                <span class="cmp-match-badge">${commonKeys.length} matching set point${commonKeys.length > 1 ? 's' : ''}</span>
            </div>
            <div class="cmp-pts-wrap">
                <table class="cmp-pts-table">
                    <thead>
                        <tr>
                            <th rowspan="2">Set Point</th>
                            <th colspan="2" class="grp-hdr col-a">Avg Reading</th>
                            <th colspan="2" class="grp-hdr col-b">Error (abs)</th>
                            <th colspan="2" class="grp-hdr col-a">Error (%FS)</th>
                            <th colspan="2" class="grp-hdr col-b">Std Dev</th>
                            <th colspan="2" class="grp-hdr col-a">Repeatability (%FS)</th>
                            <th colspan="2" class="grp-hdr col-b">Status</th>
                        </tr>
                        <tr>
                            <th class="col-a">A</th><th class="col-b">B</th>
                            <th class="col-a">A</th><th class="col-b">B</th>
                            <th class="col-a">A</th><th class="col-b">B</th>
                            <th class="col-a">A</th><th class="col-b">B</th>
                            <th class="col-a">A</th><th class="col-b">B</th>
                            <th class="col-a">A</th><th class="col-b">B</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>`;
}

// ─── Hints System (JS-driven, position:fixed tooltip) ─────────────────────────
function toggleHints() {
    hintsOn = !hintsOn;
    document.body.classList.toggle('hints-on', hintsOn);
    document.getElementById('hintToggleBtn').classList.toggle('hint-active', hintsOn);
    if (hintsOn) {
        document.addEventListener('mouseover', _hintOver);
        document.addEventListener('mouseout', _hintOut);
        document.addEventListener('scroll', _hintHide, true);
    } else {
        document.removeEventListener('mouseover', _hintOver);
        document.removeEventListener('mouseout', _hintOut);
        document.removeEventListener('scroll', _hintHide, true);
        _hintHide();
    }
    showToast(hintsOn ? 'Hints ON - hover labels for explanations.' : 'Hints disabled.', 'info');
}

function _hintOver(e) {
    const el = e.target.closest('[data-hint]');
    if (!el) return;
    const tip = document.getElementById('hintTooltip');
    tip.textContent = el.dataset.hint;
    tip.style.display = 'block';
    _hintPosition(el, tip);
}

function _hintOut(e) {
    const el = e.target.closest('[data-hint]');
    if (!el) return;
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;
    _hintHide();
}

function _hintHide() {
    const tip = document.getElementById('hintTooltip');
    if (tip) tip.style.display = 'none';
}

function _hintPosition(el, tip) {
    const r = el.getBoundingClientRect();
    const tipW = tip.offsetWidth || 200;
    const tipH = tip.offsetHeight || 40;
    const vW = window.innerWidth;
    const vH = window.innerHeight;
    const PAD = 8;

    // Default: below element, centred
    let top = r.bottom + PAD;
    let left = r.left + r.width / 2 - tipW / 2;

    // Clamp horizontal
    if (left + tipW > vW - PAD) left = vW - tipW - PAD;
    if (left < PAD) left = PAD;

    // If no room below, show above
    if (top + tipH > vH - PAD) top = r.top - tipH - PAD;

    tip.style.top = top + 'px';
    tip.style.left = left + 'px';
}

// ─── Connectivity / Provisioning Wizard ──────────────────────────────────────

/** ID dari setInterval polling deteksi ESP32 (State 1). */
let _espPollInterval = null;

/** Data tersimpan sementara setelah config berhasil dikirim (untuk State 3 → MQTT). */
let _provPendingMqtt = null;

/**
 * Buka Provisioning Wizard dan reset ke State 1.
 * Jika status sedang terhubung, buka Connection Info Modal sebagai gantinya.
 */
function openConnectDialog() {
    const badge = document.getElementById('mqttStatusBadge');
    if (badge && badge.classList.contains('connected')) {
        const cachedStr = localStorage.getItem('alition_mqtt_config');
        if (cachedStr) {
            const config = JSON.parse(cachedStr);
            document.getElementById('summaryMqttHost').value = config.host || '-';
            document.getElementById('summaryMqttPort').value = config.port || '-';
            document.getElementById('summaryMqttUser').value = config.mUser ? '••••••••' : '-';
            document.getElementById('summaryDeviceId').value = config.devId || '-';
            
            switchProvState(4);
            document.getElementById('connectOverlay').classList.add('active');
            return;
        }
    }

    // Reset semua state ke awal
    _provPendingMqtt = null;
    switchProvState(1);
    document.getElementById('provScanText').textContent = 'Scanning for device at 192.168.4.1…';
    document.getElementById('provScanStatus').style.borderColor = '';
    document.getElementById('provScanStatus').style.color = '';

    // Buka overlay
    document.getElementById('connectOverlay').classList.add('active');

    // Mulai polling deteksi alat
    _startEspPolling();
}

/** Hentikan polling dan tutup wizard. */
function closeProvisioningDialog() {
    _stopEspPolling();
    document.getElementById('connectOverlay').classList.remove('active');
}

/** Mulai interval polling check_esp_connection() setiap 2 detik. */
function _startEspPolling() {
    _stopEspPolling(); // Pastikan tidak ada duplikasi
    _espPollInterval = setInterval(checkEspConnection, 2000);
}

/** Hentikan interval polling. */
function _stopEspPolling() {
    if (_espPollInterval !== null) {
        clearInterval(_espPollInterval);
        _espPollInterval = null;
    }
}

/**
 * Dipanggil oleh polling interval.
 * Tanya Python: apakah 192.168.4.1 bisa dijangkau?
 * Jika ya:
 *   - Cek apakah ESP32 kembali karena WiFi gagal (status=wifi_failed)
 *   - Jika gagal: highlight SSID/pass dan kembali ke State 2 dengan pesan error
 *   - Jika normal: transisi ke State 2 seperti biasa
 */
async function checkEspConnection() {
    try {
        const res = await pywebview.api.check_esp_connection();
        if (res && res.connected) {
            _stopEspPolling();

            // Cek apakah ESP32 kembali karena WiFi gagal
            let wifiStatus = { status: 'unknown' };
            try { wifiStatus = await pywebview.api.check_esp_wifi_result(); } catch (_) { }

            if (wifiStatus && wifiStatus.status === 'wifi_failed') {
                // WiFi credentials salah - kembali ke State 2 dengan error
                const ssid = wifiStatus.ssid || '';
                switchProvState(2);
                setTimeout(() => {
                    _highlightField('setupWifiSsid');
                    _highlightField('setupWifiPass');
                    showToast(
                        `WiFi "${ssid || 'entered'}" could not connect. ` +
                        'Check the WiFi SSID and password, then try again.',
                        'error', 8000
                    );
                }, 400);
            } else {
                // Normal flow - ESP32 baru pertama kali / belum punya config
                const statusEl = document.getElementById('provScanText');
                statusEl.textContent = 'Device found! Loading configuration form…';
                document.getElementById('provScanStatus').style.color = 'var(--green)';
                document.getElementById('provScanStatus').style.borderColor = 'var(--green)';
                setTimeout(() => switchProvState(2), 600);
            }
        }
    } catch (_) {
        // Silent fail - wizard masih terbuka, polling lanjut
    }
}

/**
 * Transisi antara state wizard (1, 2, atau 3).
 * Mengelola visibility state panel + update step indicator.
 * @param {number} n - nomor state (1 | 2 | 3)
 */
function switchProvState(n) {
    // Sembunyikan semua state
    document.querySelectorAll('.prov-state').forEach(s => s.classList.remove('active'));
    // Tampilkan state target
    const target = document.getElementById(`provState${n}`);
    if (target) target.classList.add('active');

    // Update step indicator
    const steps = [1, 2, 3];
    const lines = [1, 2];

    steps.forEach(i => {
        const el = document.getElementById(`stepInd${i}`);
        if (!el) return;
        el.classList.remove('inactive', 'done');
        if (i < n) el.classList.add('done');
        else if (i > n) el.classList.add('inactive');
    });

    lines.forEach(i => {
        const el = document.getElementById(`stepLine${i}`);
        if (!el) return;
        el.classList.remove('active', 'done');
        if (i < n) el.classList.add('done');
        else if (i === n) el.classList.add('active');
    });

    // Jika kembali ke State 1, restart polling
    if (n === 1) {
        document.getElementById('provScanText').textContent = 'Scanning for device at 192.168.4.1…';
        document.getElementById('provScanStatus').style.borderColor = '';
        document.getElementById('provScanStatus').style.color = '';
        _startEspPolling();
    } else {
        _stopEspPolling();
    }

    // Setiap kali State 2 ditampilkan, SELALU reset tombol Send ke kondisi normal
    // agar tidak terjebak dalam keadaan "Sending…" dari percobaan sebelumnya.
    if (n === 2) {
        _resetSendBtn();
    }
}

/** Reset tombol "Send Config & Reboot" ke kondisi default (aktif, teks normal). */
function _resetSendBtn() {
    const btn = document.getElementById('provSendBtn');
    if (!btn) return;
    btn.disabled = false;
    btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        Send Config &amp; Reboot`;
}

/**
 * Dipanggil tombol "Send Config & Reboot".
 * Validasi form → kirim HTTP POST ke ESP32 via Python → transisi ke State 3.
 */
async function pushConfigToDevice() {
    const ssid = document.getElementById('setupWifiSsid').value.trim();
    const pass = document.getElementById('setupWifiPass').value.trim();
    const host = document.getElementById('setupMqttHost').value.trim();
    const port = parseInt(document.getElementById('setupMqttPort').value.trim()) || 8883;
    const mUser = document.getElementById('setupMqttUser').value.trim();
    const mPass = document.getElementById('setupMqttPass').value.trim();
    const devId = document.getElementById('setupDeviceId').value.trim();

    // Validasi field wajib
    if (!ssid || !host || !devId) {
        showToast('Please fill in SSID, MQTT Broker, and Device ID.', 'error');
        return;
    }

    // Nonaktifkan tombol agar tidak double-click
    const btn = document.getElementById('provSendBtn');
    btn.disabled = true;
    btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin .8s linear infinite">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
        </svg>
        Sending…`;

    showToast('Sending configuration to device…', 'info');

    try {
        const payload = JSON.stringify({ ssid, pass, mqtt_host: host, mqtt_port: port, device_id: devId, mqtt_user: mUser, mqtt_pass: mPass });
        const res = await pywebview.api.push_config_to_device(payload);

        if (res && res.success) {
            _provPendingMqtt = { host, port, devId, mUser, mPass };
            document.getElementById('provSuccessSsid').textContent = ssid;
            switchProvState(3);
            showToast('Config sent! Device is rebooting.', 'success');
        } else {
            showToast(res?.message || 'Failed to send configuration.', 'error');
            _resetSendBtn(); // ← selalu pakai helper
        }
    } catch (err) {
        showToast(`Communication error: ${err}`, 'error');
        _resetSendBtn(); // ← selalu pakai helper
    }
}

/**
 * Helper terpusat untuk update MQTT status badge di ribbon.
 * @param {'offline'|'connecting'|'connected'} state
 */
function setMqttBadge(state) {
    const badge = document.getElementById('mqttStatusBadge');
    const text = document.getElementById('mqttStatusText');
    if (!badge) return;

    badge.classList.remove('connected', 'connecting');
    if (state === 'connected') {
        badge.classList.add('connected');
        text.textContent = 'Connected';
    } else if (state === 'connecting') {
        badge.classList.add('connecting');
        text.textContent = 'Connecting…';
    } else {
        text.textContent = 'Offline';
    }
}

// ─── MQTT Status Polling (Fallback) ─────────────────────────────────────────
// evaluate_js() dari thread paho di Windows sering tidak sampai ke JS.
// Solusi: JS polling get_mqtt_status() ke Python tiap detik setelah connect.

let _mqttPollInterval = null;
let _mqttPollTicks = 0;
const MQTT_POLL_TIMEOUT_SEC = 25; // Diperpanjang jadi 25 detik karena HiveMQ public kadang lambat

function _startMqttStatusPolling() {
    _mqttPollTicks = 0;
    _stopMqttStatusPolling();
    _mqttPollInterval = setInterval(async () => {
        _mqttPollTicks++;
        try {
            const status = await pywebview.api.get_mqtt_status();
            if (status && status.connected) {
                _stopMqttStatusPolling();
                setSensorStatus(true);
                return;
            }
            // Deteksi error spesifik dari rc code (rc != -1 dan != 0 = error dari broker)
            // Python menggunakan -1 untuk status "belum terkoneksi / sedang mencoba"
            if (status && status.rc !== undefined && status.rc > 0) {
                _stopMqttStatusPolling();
                setMqttBadge('offline');
                _showMqttFieldError(status.field || 'mqtt_host', status.message || 'MQTT connection failed.');
                return;
            }
        } catch (_) { /* silent */ }

        if (_mqttPollTicks >= MQTT_POLL_TIMEOUT_SEC) {
            _stopMqttStatusPolling();
            setMqttBadge('offline');
            showToast(
                `Connection to broker slow/unresponsive (timeout ${MQTT_POLL_TIMEOUT_SEC}s). ` +
                'Ensure broker is active. App will keep trying to connect in background.',
                'error', 8000
            );
            // Hapus pemanggilan _showMqttFieldError agar tidak menendang user kembali ke form,
            // karena data sensor kadang-kadang masuk beberapa detik kemudian jika koneksi delay.
        }
    }, 1000);
}

function _stopMqttStatusPolling() {
    if (_mqttPollInterval !== null) {
        clearInterval(_mqttPollInterval);
        _mqttPollInterval = null;
    }
}

/**
 * Dipanggil langsung oleh Python evaluate_js saat on_connect rc != 0.
 * Ini backup path selain polling.
 */
function onMqttConnectError(errObj) {
    _stopMqttStatusPolling();
    setMqttBadge('offline');
    _showMqttFieldError(errObj.field || 'mqtt_host', errObj.message || 'MQTT connection error.');
}

/**
 * Tampilkan pesan error MQTT yang spesifik dan highlight field yang bermasalah.
 * Jika wizard sedang terbuka, kembali ke State 2. Jika tidak, buka wizard ke State 2.
 * @param {string} fieldId - ID input yang perlu disorot ('mqtt_host'|'mqtt_port'|'device_id')
 * @param {string} message - Pesan error yang ditampilkan ke operator
 */
function _showMqttFieldError(fieldId, message) {
    showToast(message, 'error', 8000);

    const overlay = document.getElementById('connectOverlay');
    const isOpen = overlay && overlay.classList.contains('active');

    if (!isOpen) {
        // Wizard tidak terbuka - buka dan langsung ke State 2
        overlay.classList.add('active');
    }
    // Selalu transisi ke State 2 agar operator bisa ubah data
    switchProvState(2);

    // Sorot field yang bermasalah setelah State 2 tampil
    setTimeout(() => {
        // Map field name ke HTML id
        const fieldMap = {
            mqtt_host: 'setupMqttHost',
            mqtt_port: 'setupMqttPort',
            device_id: 'setupDeviceId',
            mqtt_user: 'setupMqttUser',
            mqtt_pass: 'setupMqttPass',
        };
        const htmlId = fieldMap[fieldId] || fieldId;
        _highlightField(htmlId);
    }, 300);
}

/**
 * Highlight sebuah input field dengan border merah + shake animation.
 * Efek hilang otomatis setelah 5 detik.
 * @param {string} id - ID elemen input
 */
function _highlightField(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('field-error');
    el.focus();
    setTimeout(() => el.classList.remove('field-error'), 5000);
}

/**
 * Dipanggil tombol "Connect to MQTT" di State 3.
 * Menutup wizard lalu langsung menghubungkan ke MQTT Broker.
 * Setelah connect berhasil (API return success), JS memulai polling
 * get_mqtt_status() sebagai fallback jika evaluate_js dari paho thread gagal.
 */
async function connectAfterProvisioning() {
    closeProvisioningDialog();
    if (!_provPendingMqtt) return;

    const { host, port, devId, mUser, mPass } = _provPendingMqtt;
    _provPendingMqtt = null;

    setMqttBadge('connecting');
    showToast(`Connecting to MQTT Broker: ${host}…`, 'info');

    try {
        const res = await pywebview.api.connect_mqtt(host, port, devId, mUser, mPass);
        if (res && res.success) {
            // Simpan kredensial ke cache PC
            localStorage.setItem('alition_mqtt_config', JSON.stringify({ host, port, devId, mUser, mPass }));
            
            // Tampilkan tombol disconnect
            const btnDc = document.getElementById('btnDisconnect');
            if(btnDc) btnDc.style.display = 'flex';

            // API berhasil memulai koneksi async → mulai polling fallback
            _startMqttStatusPolling();
        } else {
            setMqttBadge('offline');
            showToast(res?.message || 'Failed to connect to MQTT.', 'error');
        }
    } catch (err) {
        setMqttBadge('offline');
        showToast(`MQTT connection error: ${err}`, 'error');
    }
}

async function manualConnectMqtt() {
    const host = document.getElementById('manualMqttHost').value.trim();
    const port = parseInt(document.getElementById('manualMqttPort').value.trim()) || 8883;
    const mUser = document.getElementById('manualMqttUser').value.trim();
    const mPass = document.getElementById('manualMqttPass').value.trim();
    const devId = document.getElementById('manualDeviceId').value.trim();

    if (!host || !devId) {
        showToast('Please fill in Broker Address and Device ID.', 'error');
        return;
    }

    closeProvisioningDialog();
    setMqttBadge('connecting');
    showToast(`Connecting to MQTT Broker: ${host}…`, 'info');

    try {
        const res = await pywebview.api.connect_mqtt(host, port, devId, mUser, mPass);
        if (res && res.success) {
            localStorage.setItem('alition_mqtt_config', JSON.stringify({ host, port, devId, mUser, mPass }));
            _startMqttStatusPolling();
        } else {
            setMqttBadge('offline');
            showToast(res?.message || 'Failed to connect to MQTT.', 'error');
        }
    } catch (err) {
        setMqttBadge('offline');
        showToast(`MQTT connection error: ${err}`, 'error');
    }
}

// Dipanggil oleh Python (evaluate_js) ATAU oleh polling JS saat status MQTT berubah
function setSensorStatus(isConnected) {
    // Hentikan polling - baik dipanggil dari Python maupun JS polling
    _stopMqttStatusPolling();

    const statusText = document.querySelector('.sensor-status');
    const dots = [document.getElementById('dotTemp'), document.getElementById('dotHumid'), document.getElementById('dotPress')];

    // Update trend toggle button state
    const toggleBtn = document.getElementById('envTrendToggleBtn');
    if (toggleBtn) {
        if (isConnected) {
            toggleBtn.disabled = false;
            toggleBtn.title = "Tampilkan grafik tren sensor";
            toggleBtn.style.cursor = "pointer";
        } else {
            toggleBtn.disabled = true;
            toggleBtn.title = "Sensor not connected";
            toggleBtn.style.cursor = "not-allowed";
            if (envTrendVisible) {
                toggleEnvTrend(); // close it if it was open
            }
        }
    }

    const masterDot = document.getElementById('dotMasterStatus');
    const masterTitle = document.getElementById('ambMasterStatusTitle');
    const masterDesc = document.getElementById('ambMasterStatusDesc');
    const lblT = document.getElementById('stateLabelTemp');
    const lblH = document.getElementById('stateLabelHumid');
    const lblP = document.getElementById('stateLabelPress');

    if (isConnected) {
        setMqttBadge('connected');
        statusText.innerHTML = '<span class="sensor-status-dot" style="background: var(--green);"></span> Connected (Live)';
        dots.forEach(d => {
            if (d) { d.classList.remove('disconnected'); d.classList.add('connected'); }
        });
        if (masterDot) { masterDot.classList.remove('disconnected'); masterDot.classList.add('connected'); }
        if (masterDesc) masterDesc.textContent = 'Online (1.0 Hz)';
        if (lblT) lblT.textContent = 'Active';
        if (lblH) lblH.textContent = 'Active';
        if (lblP) lblP.textContent = 'Active';

        showToast('Connected to hardware stream!', 'success');

        // Mulai polling data sensor setiap 2 detik (fallback dari evaluate_js)
        _startSensorDataPolling();
        
        // Ambient tab is always unlocked now
        const btnDc = document.getElementById('btnDisconnect');
        if(btnDc) btnDc.style.display = 'flex';
    } else {
        setMqttBadge('offline');
        statusText.innerHTML = '<span class="sensor-status-dot"></span> Disconnected';
        
        // Ambient tab remains accessible when disconnected
        dots.forEach(d => {
            if (d) { d.classList.remove('connected'); d.classList.add('disconnected'); }
        });
        if (masterDot) { masterDot.classList.remove('connected'); masterDot.classList.add('disconnected'); }
        if (masterDesc) masterDesc.textContent = 'Sensor Offline';
        if (lblT) lblT.textContent = 'Offline';
        if (lblH) lblH.textContent = 'Offline';
        if (lblP) lblP.textContent = 'Offline';

        _rawTemp = null;
        _rawHum = null;
        _rawPress = null;
        document.getElementById('sensorTemp').textContent = '- °C';
        document.getElementById('sensorHumid').textContent = '- %RH';
        document.getElementById('sensorPress').textContent = '- hPa';
        showToast('Hardware stream disconnected.', 'error');

        // Hentikan polling data sensor
        _stopSensorDataPolling();
        
        const btnDc = document.getElementById('btnDisconnect');
        if(btnDc) btnDc.style.display = 'none';

        // Clear continuous live trend on disconnect
        liveTrendLog = [];
    }
}

// ── Auto-Connect & Disconnect Logic ─────────────────────────────────

window.addEventListener('pywebviewready', function() {
    autoConnectHardware();
});

async function autoConnectHardware() {
    const cachedStr = localStorage.getItem('alition_mqtt_config');
    if (!cachedStr) return; // Tidak ada cache

    try {
        const config = JSON.parse(cachedStr);
        setMqttBadge('connecting');
        
        const res = await pywebview.api.connect_mqtt(config.host, config.port, config.devId, config.mUser, config.mPass);
        if (res && res.success) {
            _startMqttStatusPolling();
            const btnDc = document.getElementById('btnDisconnect');
            if(btnDc) btnDc.style.display = 'flex';
        } else {
            setMqttBadge('offline');
            console.error('Auto-connect failed:', res?.message);
        }
    } catch (e) {
        console.error('Auto-connect error:', e);
        setMqttBadge('offline');
    }
}

async function disconnectHardware() {
    // 1. Hapus cache
    localStorage.removeItem('alition_mqtt_config');
    
    // 2. Putuskan koneksi dari backend
    try {
        await pywebview.api.disconnect_mqtt();
    } catch(e){}
    
    // 3. Update UI
    _stopMqttStatusPolling();
    _stopSensorDataPolling();
    setSensorStatus(false);
    
    showToast('Device forgotten and disconnected.', 'info');
}

// ─── Sensor Data Polling (Fallback) ──────────────────────────────────────────
// evaluate_js() dari thread on_message paho di Windows juga sering tidak sampai.
// Solusi: JS polling get_sensor_data() ke Python setiap 2 detik.

let _sensorPollInterval = null;

function _startSensorDataPolling() {
    _stopSensorDataPolling();
    _sensorPollInterval = setInterval(async () => {
        try {
            const data = await pywebview.api.get_sensor_data();
            if (data && data.timeout) {
                // Alat berhenti memancarkan data (dimatikan atau mode AP)
                setSensorStatus(false);
                return;
            }
            // Hanya update jika ada data (cache tidak kosong)
            if (data && (data.temp !== undefined || data.hum !== undefined || data.press !== undefined)) {
                updateSensorData(data.temp, data.hum, data.press);
            }
        } catch (_) { /* silent */ }
    }, 2000);
}

function _stopSensorDataPolling() {
    if (_sensorPollInterval !== null) {
        clearInterval(_sensorPollInterval);
        _sensorPollInterval = null;
    }
}

// Dipanggil oleh Python (evaluate_js) tiap detik saat data masuk
function updateSensorData(temp, hum, press) {
    // Jika data masuk tapi UI masih mengira offline/timeout, paksa jadi Connected
    const badge = document.getElementById('mqttStatusBadge');
    if (badge && !badge.classList.contains('connected')) {
        setSensorStatus(true);
    }

    // Store raw base-unit values (°C, %RH, hPa), NEVER convert these
    if (temp  !== undefined && temp  !== null) _rawTemp  = temp;
    if (hum   !== undefined && hum   !== null) _rawHum   = hum;
    if (press !== undefined && press !== null) _rawPress = press;

    // Refresh the display cards using currently selected units
    _applyAmbientUnitDisplay();

    // Log environmental data for trend charts (always in raw base units)
    if (_rawTemp !== null && _rawHum !== null && _rawPress !== null) {
        const now = Date.now();
        
        // Continuous Live Trend (no limits as requested)
        const liveRelativeTime = liveTrendLog.length === 0 ? "00:00" : formatRelativeTime(now - liveTrendLog[0].ts);
        liveTrendLog.push({ ts: now, timeStr: liveRelativeTime, temp: _rawTemp, hum: _rawHum, press: _rawPress });
        
        // Session Trend
        if (sessionTrendRecording) {
            const sessionStart = sessionTrendLog.length === 0 ? now : sessionTrendLog[0].ts;
            const sessionRelativeTime = formatRelativeTime(now - sessionStart);
            sessionTrendLog.push({ ts: now, timeStr: sessionRelativeTime, temp: _rawTemp, hum: _rawHum, press: _rawPress });
        }
        
        // Live update trend charts if currently open/visible
        if (envTrendVisible) {
            renderEnvTrendCharts();
        }
    }
}

// ── Ambient Unit Conversion Helpers ──────────────────────────────────────────

/** Convert raw temperature (°C) to the currently selected display unit */
function _convertTemp(rawC) {
    if (rawC === null) return null;
    switch (ambientUnitTemp) {
        case '°F': return rawC * 9/5 + 32;
        case 'K':  return rawC + 273.15;
        default:   return rawC; // °C
    }
}

/** Convert raw pressure (hPa) to the currently selected display unit */
function _convertPress(rawHpa) {
    if (rawHpa === null) return null;
    switch (ambientUnitPress) {
        case 'Pa':   return rawHpa * 100;
        case 'kPa':  return rawHpa / 10;
        case 'mbar': return rawHpa;          // 1 hPa ≡ 1 mbar
        case 'bar':  return rawHpa / 1000;
        case 'psi':  return rawHpa * 0.01450377; // 100 / 6894.757
        case 'mmHg': return rawHpa * 0.750062;
        case 'atm':  return rawHpa / 1013.25;
        default:     return rawHpa; // hPa
    }
}

/** Determine decimal places for pressure display based on unit magnitude */
function _pressDecimals() {
    const dec = { 'Pa': 0, 'mmHg': 2, 'mbar': 1, 'hPa': 2, 'kPa': 3, 'bar': 4, 'psi': 3, 'atm': 4 };
    return dec[ambientUnitPress] ?? 2;
}

/**
 * Re-render the three sensor cards and average badges
 * using the current raw values and the selected display units.
 * Called whenever raw data arrives OR a dropdown changes.
 */
function _applyAmbientUnitDisplay() {
    const tEl = document.getElementById('sensorTemp');
    const hEl = document.getElementById('sensorHumid');
    const pEl = document.getElementById('sensorPress');
    const avgT = document.getElementById('avgTempLabel');
    const avgH = document.getElementById('avgHumLabel');
    const avgP = document.getElementById('avgPressLabel');
    const lblT = document.getElementById('stateLabelTemp');
    const lblH = document.getElementById('stateLabelHumid');
    const lblP = document.getElementById('stateLabelPress');

    if (tEl) {
        if (_rawTemp !== null) {
            const v = _convertTemp(_rawTemp);
            tEl.textContent = v.toFixed(1) + ' ' + ambientUnitTemp;
            if (lblT) lblT.textContent = 'Active';
        } else {
            tEl.textContent = '- ' + ambientUnitTemp;
            if (lblT) lblT.textContent = 'Offline';
        }
    }
    
    if (hEl) {
        if (_rawHum !== null) {
            hEl.textContent = _rawHum.toFixed(1) + ' ' + ambientUnitHum;
            if (lblH) lblH.textContent = 'Active';
        } else {
            hEl.textContent = '- ' + ambientUnitHum;
            if (lblH) lblH.textContent = 'Offline';
        }
    }
    
    if (pEl) {
        if (_rawPress !== null) {
            const v = _convertPress(_rawPress);
            pEl.textContent = v.toFixed(_pressDecimals()) + ' ' + ambientUnitPress;
            if (lblP) lblP.textContent = 'Active';
        } else {
            pEl.textContent = '- ' + ambientUnitPress;
            if (lblP) lblP.textContent = 'Offline';
        }
    }

    // Update chart average badges if they exist
    const bT = document.getElementById('badgeAvgTemp');
    const bH = document.getElementById('badgeAvgHum');
    const bP = document.getElementById('badgeAvgPress');
    const activeLog = (typeof envTrendMode !== 'undefined' && envTrendMode === 'session') ? sessionTrendLog : liveTrendLog;
    if (activeLog && activeLog.length > 0) {
        const avgTVal = _convertTemp(activeLog.reduce((s, d) => s + d.temp, 0) / activeLog.length);
        const avgHVal = activeLog.reduce((s, d) => s + d.hum, 0) / activeLog.length;
        const avgPVal = _convertPress(activeLog.reduce((s, d) => s + d.press, 0) / activeLog.length);
        if (bT) bT.textContent = 'AVERAGE: ' + avgTVal.toFixed(1) + ' ' + ambientUnitTemp;
        if (bH) bH.textContent = 'AVERAGE: ' + avgHVal.toFixed(1) + ' ' + ambientUnitHum;
        if (bP) bP.textContent = 'AVERAGE: ' + avgPVal.toFixed(_pressDecimals()) + ' ' + ambientUnitPress;
        if (avgT) avgT.textContent = 'Average: ' + avgTVal.toFixed(1) + ' ' + ambientUnitTemp;
        if (avgH) avgH.textContent = 'Average: ' + avgHVal.toFixed(1) + ' ' + ambientUnitHum;
        if (avgP) avgP.textContent = 'Average: ' + avgPVal.toFixed(_pressDecimals()) + ' ' + ambientUnitPress;
    } else {
        if (bT) bT.textContent = 'AVERAGE: - ' + ambientUnitTemp;
        if (bH) bH.textContent = 'AVERAGE: - ' + ambientUnitHum;
        if (bP) bP.textContent = 'AVERAGE: - ' + ambientUnitPress;
        if (avgT) avgT.textContent = 'Average: - ' + ambientUnitTemp;
        if (avgH) avgH.textContent = 'Average: - ' + ambientUnitHum;
        if (avgP) avgP.textContent = 'Average: - ' + ambientUnitPress;
    }

    _updateAmbTopHeader();
}

let currentAmbParam = 'temp'; // 'all' | 'temp' | 'hum' | 'baro'

function selectAmbParam(param) {
    currentAmbParam = param;
    
    // Update active class on 4 sidebar selector buttons
    const btnMap = {
        'all': 'btnAmbAll',
        'temp': 'btnAmbTemp',
        'hum': 'btnAmbHum',
        'baro': 'btnAmbBaro'
    };
    Object.keys(btnMap).forEach(key => {
        const b = document.getElementById(btnMap[key]);
        if (b) b.classList.toggle('active', key === param);
    });

    // Update graph container mode class
    const graphArea = document.getElementById('ambGraphArea');
    if (graphArea) {
        graphArea.className = 'amb-frame-graph mode-' + param;
    }

    _updateAmbTopHeader();

    // Redraw charts smoothly to fit updated viewport
    setTimeout(() => {
        if (typeof renderEnvTrendCharts === 'function') {
            renderEnvTrendCharts();
        }
    }, 50);
}

function _updateAmbTopHeader() {
    const valEl = document.getElementById('ambTopDataVal');
    const readoutGroup = document.getElementById('ambTopReadoutGroup');
    const unitTemp = document.getElementById('ambUnitTempWrap');
    const unitHum = document.getElementById('ambUnitHumWrap');
    const unitPress = document.getElementById('ambUnitPressWrap');
    const unitAll = document.getElementById('ambUnitAllWrap');
    const titleEl = document.getElementById('ambActiveTitle');

    if (titleEl) {
        const titleMap = {
            'all': 'ALL DATA',
            'temp': 'TEMPERATURE',
            'hum': 'HUMIDITY',
            'baro': 'BAROMETRIC'
        };
        titleEl.textContent = titleMap[currentAmbParam] || 'ENVIRONMENTAL MONITOR';
    }

    if (!valEl) return;

    if (currentAmbParam === 'temp') {
        if (readoutGroup) readoutGroup.style.display = 'flex';
        valEl.textContent = _rawTemp !== null ? _convertTemp(_rawTemp).toFixed(1) : '-';
        if (unitTemp) unitTemp.style.display = 'inline-flex';
        if (unitHum) unitHum.style.display = 'none';
        if (unitPress) unitPress.style.display = 'none';
        if (unitAll) unitAll.style.display = 'none';
    } else if (currentAmbParam === 'hum') {
        if (readoutGroup) readoutGroup.style.display = 'flex';
        valEl.textContent = _rawHum !== null ? _rawHum.toFixed(1) : '-';
        if (unitTemp) unitTemp.style.display = 'none';
        if (unitHum) unitHum.style.display = 'inline-flex';
        if (unitPress) unitPress.style.display = 'none';
        if (unitAll) unitAll.style.display = 'none';
    } else if (currentAmbParam === 'baro') {
        if (readoutGroup) readoutGroup.style.display = 'flex';
        valEl.textContent = _rawPress !== null ? _convertPress(_rawPress).toFixed(_pressDecimals()) : '-';
        if (unitTemp) unitTemp.style.display = 'none';
        if (unitHum) unitHum.style.display = 'none';
        if (unitPress) unitPress.style.display = 'inline-flex';
        if (unitAll) unitAll.style.display = 'none';
    } else { // 'all'
        if (readoutGroup) readoutGroup.style.display = 'none';
        valEl.textContent = '';
        if (unitTemp) unitTemp.style.display = 'none';
        if (unitHum) unitHum.style.display = 'none';
        if (unitPress) unitPress.style.display = 'none';
        if (unitAll) unitAll.style.display = 'none';
    }
}

/**
 * Called by the dropdown buttons in the sensor cards.
 * Changes ONLY the display unit: raw values and all calculations are unchanged.
 * @param {'temp'|'hum'|'press'} sensor
 * @param {string} unit  e.g. '°F', 'kPa'
 */
function setAmbientUnit(sensor, unit) {
    if (sensor === 'temp')  ambientUnitTemp  = unit;
    if (sensor === 'hum')   ambientUnitHum   = unit;
    if (sensor === 'press') ambientUnitPress = unit;

    // Update active state in the dropdown buttons
    const map = { temp: 'ambUnitTempDd', hum: 'ambUnitHumDd', press: 'ambUnitPressDd' };
    const dd = document.getElementById(map[sensor]);
    if (dd) {
        dd.querySelectorAll('.cs-opt').forEach(btn => {
            btn.classList.toggle('cs-opt-active', btn.dataset.unit === unit);
        });
    }

    // Update trigger button label
    const lblMap = { temp: 'ambUnitTempLabel', hum: 'ambUnitHumLabel', press: 'ambUnitPressLabel' };
    const lbl = document.getElementById(lblMap[sensor]);
    if (lbl) lbl.textContent = unit;

    // Close the dropdown (use 'open' class, consistent with toggleCustomSelect)
    const wrapMap = { temp: 'ambUnitTempWrap', hum: 'ambUnitHumWrap', press: 'ambUnitPressWrap' };
    const wrap = document.getElementById(wrapMap[sensor]);
    if (wrap) wrap.classList.remove('open');

    // Refresh display & charts
    _applyAmbientUnitDisplay();
    _updateAmbTopHeader();
    renderEnvTrendCharts();
}

function formatRelativeTime(ms) {
    const totalSecs = Math.floor(ms / 1000);
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// ─── DKD WIZARD STATE MACHINE ─────────────────────────────────────────────────

function captureSensorData() {
    // If hardware is offline, do NOT capture fake numbers; return null
    if (_rawTemp === null && _rawHum === null && _rawPress === null) {
        return null;
    }
    return {
        temperature:  _rawTemp,
        humidity:     _rawHum,
        pressure_atm: _rawPress
    };
}

function openDkdWizard() {
    document.getElementById('dkdWizardOverlay').classList.add('active');
}

function closeDkdWizard() {
    document.getElementById('dkdWizardOverlay').classList.remove('active');
    if (dkdWizardState.countdownTimer) {
        clearInterval(dkdWizardState.countdownTimer);
        dkdWizardState.countdownTimer = null;
    }
}


// ─── DKD-R 6-1 Calculation Engine ──────────────────────────────────────────────

/** Air density (moist air) - ISO 1217 simplified.
 *  T: °C, H: %RH, Patm_hPa: hPa → returns rho_a in kg/m³ */
function hitungDensitasUdara(T, H, Patm_hPa) {
    const R_d = 287.058, R_v = 461.495;
    const T_K = 273.15 + T;
    const Psat = 611.2 * Math.exp(17.502 * T / (240.97 + T));
    const Pv  = (H / 100) * Psat;
    const Pd  = Patm_hPa * 100 - Pv;
    return Pd / (R_d * T_K) + Pv / (R_v * T_K);
}

function unitConvFactor(unit) {
    const map = { 'bar': 1e5, 'psi': 6894.757, 'kPa': 1e3, 'MPa': 1e6, 'Pa': 1, 'mbar': 100, 'hPa': 100 };
    return map[unit] || 1e5;
}

/** 
 * Smart formatter: rounds to max 8 decimals to fix floating-point bugs,
 * but strips trailing zeroes (e.g. 100.000 -> 100). 
 */
function fmtVal(val, maxDigits=8) {
    if (val === null || val === undefined) return '';
    return parseFloat(Number(val).toFixed(maxDigits)).toString();
}


/** Render Tabel 1: Sertifikat Kalibrasi (physical data) */
function renderCertificateTable(rows, seq, unit, mpeVal) {
    const wrap = document.getElementById('dkdCertTableWrap');
    if (!wrap) return;
    const td = (v, cls) => '<td class="' + (cls||'') + '">' + v + '</td>';

    let heads = ['Target', 'P<sub>std</sub> Actual', 'M1 (Up)'];
    if (seq === 'C')  heads.push('M2 (Down)');
    if (seq === 'B')  heads.push('M2 (Down)', 'M3 (Up)');
    if (seq === 'A')  heads.push('M2 (Down)', 'M3 (Up)', 'M4 (Down)', 'M5 (Up)', 'M6 (Down)');
    heads.push('Average', 'Deviation');
    if (seq !== 'C')  heads.push('Repeatability b\'');
    if (seq === 'A')  heads.push('Reproducibility b');
    heads.push('Hysteresis h', 'U (k=2)', 'Verdict');

    let html = '<table class="res-table"><thead><tr>' + heads.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>';
    rows.forEach(r => {
        const passCls = r.pass ? 'res-td-pass' : 'res-td-fail';
        const devCls  = Math.abs(r.dev) <= mpeVal ? 'res-td-pass' : 'res-td-fail';
        html += '<tr>';
        html += td(r.pct + '% &nbsp;<span style="color:var(--text-muted);font-weight:400">(' + fmtVal(r.nom_ideal) + ' ' + unit + ')</span>', 'res-td-highlight');
        html += td(fmtVal(r.p_std));
        const mkeys = seq==='C' ? ['M1','M2'] : seq==='B' ? ['M1','M2','M3'] : ['M1','M2','M3','M4','M5','M6'];
        mkeys.forEach(mk => { 
            html += td(r.m_vals[mk] !== undefined ? fmtVal(r.m_vals[mk]) : '', 'res-td-blue'); 
        });
        html += td(fmtVal(r.mean), 'res-td-highlight');
        html += td(fmtVal(r.dev), devCls);
        if (seq !== 'C') html += td(r.b_prime_f !== null ? fmtVal(r.b_prime_f) : '');
        if (seq === 'A') html += td(r.b_f !== null ? fmtVal(r.b_f) : '');
        html += td(fmtVal(r.h_f));
        html += td('\u00B1' + fmtVal(r.U), 'res-td-highlight');
        html += '<td class="' + passCls + '">' + (r.pass ? 'PASS' : 'FAIL') + '</td>';
        html += '</tr>';
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
}

/** Render Tabel 2: Uncertainty Budget (statistical) */
function renderUncertaintyBudgetTable(rows, seq, unit, u_std, u_res, u_f0) {
    const wrap = document.getElementById('dkdUncTableWrap');
    if (!wrap) return;
    const td = (v, cls) => '<td class="' + (cls||'') + '">' + v + '</td>';

    let heads = ['Target', 'Deviasi', 'u<sub>std</sub>', 'u<sub>res</sub>', 'u<sub>f0</sub>'];
    if (seq !== 'C') heads.push('u<sub>b\'</sub>');
    if (seq === 'A') heads.push('u<sub>b</sub>');
    heads.push('u<sub>h</sub>', 'u<sub>c</sub>', 'U (k=2)', 'Status');

    let html = '<table class="res-table"><thead><tr>' + heads.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>';
    // Constants row
    html += '<tr style="background:rgba(59,110,248,0.03)"><td colspan="' + heads.length + '" class="res-td-sans" style="font-size:12.5px;padding:12px;color:var(--text-secondary);">'
        + '<b style="color:var(--text-primary)">Konstanta Tetap:</b> &nbsp;&nbsp; u<sub>std</sub> = ' + fmtVal(u_std) + ' &nbsp;&nbsp;|&nbsp;&nbsp; u<sub>res</sub> = ' + fmtVal(u_res) + ' &nbsp;&nbsp;|&nbsp;&nbsp; u<sub>f0</sub> = ' + fmtVal(u_f0) + ' ' + unit
        + '</td></tr>';
    rows.forEach(r => {
        const passCls = r.pass ? 'res-td-pass' : 'res-td-fail';
        html += '<tr>';
        html += td(r.pct + '%', 'res-td-highlight');
        html += td(fmtVal(r.dev));
        html += td(fmtVal(u_std));
        html += td(fmtVal(u_res));
        html += td(fmtVal(u_f0));
        if (seq !== 'C') html += td(fmtVal(r.u_b_prime));
        if (seq === 'A') html += td(fmtVal(r.u_b));
        html += td(fmtVal(r.u_h));
        html += td(fmtVal(r.u_c), 'res-td-highlight');
        html += td('\u00B1' + fmtVal(r.U), 'res-td-highlight');
        html += '<td class="' + passCls + '">' + (r.pass ? 'PASS' : 'FAIL') + '</td>';
        html += '</tr>';
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
}

/** Render Preloading table */
function renderPreloadTable() {
    const s = dkdWizardState;
    const su = s.setup || {};
    const unit = su.input_unit || '';
    const tbody = document.getElementById('dkdPreloadTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    s.preloadData.forEach(r => {
        tbody.innerHTML += '<tr>'
            + '<td style="text-align:left">Round ' + r.round + ' - Cycle ' + r.cycle + ' (Max)</td>'
            + '<td>' + r.cycle + '</td>'
            + '<td style="font-family:var(--mono)">' + (su.urv !== undefined ? fmtVal(su.urv) : '') + ' ' + unit + '</td>'
            + '<td style="font-weight:700;color:var(--green);font-family:var(--mono)">' + (r.reading_max !== undefined ? fmtVal(r.reading_max) : '') + '</td>'
            + '<td>30s</td></tr>'
            + '<tr>'
            + '<td style="text-align:left;color:var(--mx-muted)">Round ' + r.round + ' - Cycle ' + r.cycle + ' (Zero)</td>'
            + '<td>' + r.cycle + '</td>'
            + '<td style="font-family:var(--mono)">0 ' + unit + '</td>'
            + '<td style="font-weight:700;color:var(--blue);font-family:var(--mono)">' + (r.reading_zero !== undefined ? fmtVal(r.reading_zero) : '') + '</td>'
            + '<td>30s</td></tr>';
    });
    if (s.zeroSettingData) {
        tbody.innerHTML += '<tr>'
            + '<td style="text-align:left;font-weight:700;color:var(--blue)">Zero Setting (End)</td>'
            + '<td></td><td>0 ' + unit + '</td>'
            + '<td style="font-weight:700;color:var(--blue);font-family:var(--mono)">' + s.zeroSettingData.reading + '</td>'
            + '<td>30s</td></tr>';
    }
}

// ── MAIN CALCULATION ENGINE ─────────────────────────────────────────────────────
function calculateDkdResults() {
    const s   = dkdWizardState;
    const su  = s.setup || {};
    const seq = s.sequence;
    const unit = su.input_unit || '';
    const lrv  = su.lrv || 0, urv = su.urv || 0;
    const span  = urv - lrv;
    const UCF   = unitConvFactor(unit);
    const mpePct = su.mpe_percent || 0;
    const mpeVal = span * (mpePct / 100);

    // Change Start Preloading button to Reset Calculation or Read-Only for Imported Data
    document.querySelectorAll('.start-preload-desc').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.start-preload-area').forEach(el => el.style.display = 'flex');
    const scStartBtn = document.getElementById('scStartBtn');
    if (scStartBtn) {
        if (s.isImported) {
            scStartBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Imported Session`;
            scStartBtn.style.background = 'var(--bg-elevated)';
            scStartBtn.style.color = 'var(--mx-muted)';
            scStartBtn.style.cursor = 'not-allowed';
            scStartBtn.onclick = null;
        } else {
            scStartBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg> Reset Calculation`;
            scStartBtn.style.background = 'var(--amber)';
            scStartBtn.style.color = '';
            scStartBtn.style.cursor = '';
            scStartBtn.onclick = confirmUnlockDkdSequence;
        }
    }

    const resArea = document.getElementById('dkdResultsArea');
    if (resArea) {
        resArea.style.display = 'flex';
        resArea.style.animation = 'popIn .4s ease';
    }

    // Phase 3: Progressive Disclosure -> Unlock Tabs 3, 4, 5, 7 and Auto-navigate
    ['graph', 'stats', 'uncert', 'summary'].forEach(id => unlockMainTab(id));
    
    // Small delay so UI updates smoothly
    setTimeout(() => {
        switchMainTab('summary');
    }, 100);

    // ── Step 1: Constants ─────────────────────────────────────────────────────
    const u_res = ((su.resolution || 0) / 2) / 1.732;
    let u_std;
    if (su.calibrator_type === 'DWT') {
        u_std = ((su.u_standard_dwt || 0) / 2);
    } else {
        u_std = (((su.std_accuracy_percent || 0) / 100) * (su.std_full_scale || 0)) / 1.732;
    }

    // ── Step 1b: Average environment across all measurements ──────────────────
    const allEnvs = [];
    s.mSeries.forEach(m => (s.measurementData[m] || []).forEach(r => { if (r.env) allEnvs.push(r.env); }));
    const avgEnv = (key, fb) => {
        const v = allEnvs.map(e => e[key]).filter(x => x !== null && !isNaN(x));
        return v.length > 0 ? v.reduce((a,b) => a+b, 0) / v.length : fb;
    };
    const T_avg = avgEnv('temperature', 20);
    const H_avg = avgEnv('humidity', 50);
    const P_atm = avgEnv('pressure_atm', 1013.25);

    const rho_a = hitungDensitasUdara(T_avg, H_avg, P_atm);        // kg/m³
    const rho_f = su.medium_density || 860;                         // kg/m³
    const g     = 9.80665;                                           // m/s²
    const h_diff = su.height_diff || 0;                             // m
    const delta_p_head = ((rho_f - rho_a) * g * h_diff) / UCF;    // in instrument unit

    // ── Step 2: p_standard per reading ───────────────────────────────────────
    const getPstd = (reading_master) => {
        if (su.calibrator_type === 'DWT') {
            const P_nom_pa = reading_master * UCF;
            const alpha_beta = su.alpha_beta || 0;
            const rho_m = su.rho_m || 8000;
            const lambda_val = su.lambda_val || 0;
            
            // Buoyancy correction: (1 - rho_a/rho_m) / (1 - 1.2/rho_m)
            const buoyancy_corr = (1 - rho_a / rho_m) / (1 - 1.2 / rho_m);
            
            // Temp correction: 1 + alpha_beta * (T_avg - 20)
            const temp_corr = 1 + alpha_beta * (T_avg - 20);
            
            // Deformation correction: 1 + lambda_val * P_nom_pa
            const def_corr = 1 + lambda_val * P_nom_pa;
            
            const P_actual_pa = (P_nom_pa * buoyancy_corr) / (temp_corr * def_corr);
            const P_actual = P_actual_pa / UCF;
            
            return P_actual - delta_p_head;
        } else {
            return reading_master - delta_p_head;
        }
    };

    // ── Helper: get record ────────────────────────────────────────────────────
    const getR = (m, pct) => {
        const rec = (s.measurementData[m] || []).find(r => r.setpoint_pct === pct);
        return rec || null;
    };

    // ── u_f0: Zero deviation (computed once) ─────────────────────────────────
    let u_f0 = 0;
    if (seq === 'C') {
        const a = getR('M1', 0), b = getR('M2', 0);
        if (a && b) u_f0 = (Math.abs(b.reading_uut - a.reading_uut) / 2) / 1.732;
    } else if (seq === 'B') {
        const r2 = getR('M2', 0), r3 = getR('M3', 0);
        const z2 = r2 ? Math.abs(r2.reading_uut) : 0;
        const z3 = r3 ? Math.abs(r3.reading_uut) : 0;
        u_f0 = (Math.max(z2, z3) / 2) / 1.732;
    } else {
        const pairs = [['M1','M2'],['M3','M4'],['M5','M6']];
        const diffs = pairs.map(([a,b]) => {
            const ra = getR(a, 0), rb = getR(b, 0);
            return (ra && rb) ? Math.abs(rb.reading_uut - ra.reading_uut) : 0;
        });
        u_f0 = (Math.max(...diffs) / 2) / 1.732;
    }

    // ── Step 3 & 4: Per-row calculation ───────────────────────────────────────
    const rowResults = [];
    s.setpoints.forEach(pct => {
        let row = null;
        if (seq === 'C') {
            const d1 = getR('M1', pct), d2 = getR('M2', pct);
            if (!d1 || !d2) return;
            const M1 = d1.reading_uut, M2 = d2.reading_uut;
            const p_std = (getPstd(d1.reading_master) + getPstd(d2.reading_master)) / 2;
            const mean  = (M1 + M2) / 2;
            const dev   = mean - p_std;
            const h_f   = Math.abs(M2 - M1);
            const u_h   = (h_f / 2) / 1.732;
            const u_c   = Math.sqrt(u_std**2 + u_res**2 + u_f0**2 + u_h**2);
            const U     = 2 * u_c;
            row = { pct, nom_ideal: lrv+(pct/100)*span, 
                master_vals: { M1: getPstd(d1.reading_master), M2: getPstd(d2.reading_master) },
                m_vals:{M1,M2}, p_std, mean, dev, h_f, b_prime_f:null, b_f:null, u_h, u_b_prime:0, u_b:0, u_c, U, pass:(U+Math.abs(dev))<=mpeVal };

        } else if (seq === 'B') {
            const d1=getR('M1',pct), d2=getR('M2',pct), d3=getR('M3',pct);
            if (!d1||!d2||!d3) return;
            const M1=d1.reading_uut, M2=d2.reading_uut, M3=d3.reading_uut;
            const p_std = (getPstd(d1.reading_master)+getPstd(d2.reading_master)+getPstd(d3.reading_master))/3;
            const mean  = (((M1+M3)/2) + M2) / 2;
            const dev   = mean - p_std;
            const h_f   = Math.abs(M2-M1);
            const b_p   = Math.abs(M3-M1);
            const u_h   = (h_f/2)/1.732, u_bp = (b_p/2)/1.732;
            const u_c   = Math.sqrt(u_std**2+u_res**2+u_f0**2+u_bp**2+u_h**2);
            const U     = 2*u_c;
            row = { pct, nom_ideal:lrv+(pct/100)*span, 
                master_vals: { M1: getPstd(d1.reading_master), M2: getPstd(d2.reading_master), M3: getPstd(d3.reading_master) },
                m_vals:{M1,M2,M3}, p_std, mean, dev, h_f, b_prime_f:b_p, b_f:null, u_h, u_b_prime:u_bp, u_b:0, u_c, U, pass:(U+Math.abs(dev))<=mpeVal };

        } else { // Seq A
            const d1=getR('M1',pct),d2=getR('M2',pct),d3=getR('M3',pct);
            const d4=getR('M4',pct),d5=getR('M5',pct),d6=getR('M6',pct);
            if (!d1||!d2||!d3||!d4||!d5||!d6) return;
            const M1=d1.reading_uut,M2=d2.reading_uut,M3=d3.reading_uut;
            const M4=d4.reading_uut,M5=d5.reading_uut,M6=d6.reading_uut;
            const p_std = [d1,d2,d3,d4,d5,d6].map(d=>getPstd(d.reading_master)).reduce((a,b)=>a+b,0)/6;
            const mean  = (M1+M2+M3+M4+M5+M6)/6;
            const dev   = mean - p_std;
            const h_f   = (Math.abs(M2-M1)+Math.abs(M4-M3)+Math.abs(M6-M5))/3;
            const b_p   = Math.max(Math.abs(M3-M1), Math.abs(M4-M2));
            const b_v   = Math.abs(((M1+M2+M3+M4)/4) - ((M5+M6)/2));
            const u_h   = (h_f/2)/1.732, u_bp = (b_p/2)/1.732, u_bv = (b_v/2)/1.732;
            const u_c   = Math.sqrt(u_std**2+u_res**2+u_f0**2+u_bp**2+u_bv**2+u_h**2);
            const U     = 2*u_c;
            row = { pct, nom_ideal:lrv+(pct/100)*span, 
                master_vals: { M1: getPstd(d1.reading_master), M2: getPstd(d2.reading_master), M3: getPstd(d3.reading_master), M4: getPstd(d4.reading_master), M5: getPstd(d5.reading_master), M6: getPstd(d6.reading_master) },
                m_vals:{M1,M2,M3,M4,M5,M6}, p_std, mean, dev, h_f, b_prime_f:b_p, b_f:b_v, u_h, u_b_prime:u_bp, u_b:u_bv, u_c, U, pass:(U+Math.abs(dev))<=mpeVal };
        }
        if (row) rowResults.push(row);
    });

    // ── Step 5: Simpan state & Populate dropdown ─────────────────────────────
    s.lastRowResults = rowResults;
    s.lastU_std  = u_std;
    s.lastU_res  = u_res;
    s.lastU_f0   = u_f0;
    s.lastMpeVal = mpeVal;
    s.lastRawUnit = unit;

    // Populate unit dropdown - raw unit selected by default
    populateDisplayUnitSelect(['bar', 'psi', 'kPa', 'MPa', 'Pa', 'mbar', 'hPa'], unit);

    // ── Step 5: Render Tables & KPI ──────────────────────────────────────────
    renderPreloadTable();
    convertAndRerenderTables(unit);   // initial render at raw unit
    renderLadderChart();

    // F1: Stop recording session trend
    sessionTrendRecording = false;

    // F2 & F3: Show Detail Buttons
    const btnT1 = document.getElementById('btnDetailT1');
    const btnT2 = document.getElementById('btnDetailT2');
    if (btnT1) btnT1.style.display = 'inline-flex';
    if (btnT2) btnT2.style.display = 'inline-flex';

    // ── B.1: Enable navbar export buttons ────────────────────────────────────
    ['btnExportSession', 'btnSaveData', 'btnSaveAsNew', 'btnExportExcel', 'btnExportPdf']
        .forEach(id => { const el = document.getElementById(id); if (el) el.disabled = false; });
}


// ─── Live Unit Conversion ──────────────────────────────────────────────────────
/**
 * Converts all displayed values from raw input unit → targetUnit
 * and re-renders Certificate Table, Uncertainty Budget Table, and KPI Cards.
 * Raw data in dkdWizardState.lastRowResults is NEVER modified.
 */
function convertAndRerenderTables(targetUnit) {
    const s = dkdWizardState;
    if (!s.lastRowResults || s.lastRowResults.length === 0) return;

    const rawUnit = s.lastRawUnit || (s.setup && s.setup.input_unit) || 'bar';
    // Conversion factor: raw unit → target unit (via Pa as bridge)
    const cf = unitConvFactor(rawUnit) / unitConvFactor(targetUnit);

    // Build converted rows - deep clone with scaled physical values
    // Note: .pass verdict is preserved as-is (was computed in raw units - do NOT recompute)
    const cr = s.lastRowResults.map(r => ({
        pct:        r.pct,
        nom_ideal:  r.nom_ideal  * cf,
        p_std:      r.p_std      * cf,
        master_vals:Object.fromEntries(Object.entries(r.master_vals).map(([k,v]) => [k, v * cf])),
        m_vals:     Object.fromEntries(Object.entries(r.m_vals).map(([k,v]) => [k, v * cf])),
        mean:       r.mean       * cf,
        dev:        r.dev        * cf,   // signed - no Math.abs here
        h_f:        r.h_f        * cf,
        b_prime_f:  r.b_prime_f !== null ? r.b_prime_f * cf : null,
        b_f:        r.b_f        !== null ? r.b_f        * cf : null,
        u_h:        r.u_h        * cf,
        u_b_prime:  r.u_b_prime  * cf,
        u_b:        r.u_b        * cf,
        u_c:        r.u_c        * cf,
        U:          r.U          * cf,
        pass:       r.pass               // verdict unchanged - source of truth
    }));

    const mpeVal_c  = s.lastMpeVal * cf;
    const u_std_c   = s.lastU_std  * cf;
    const u_res_c   = s.lastU_res  * cf;
    const u_f0_c    = s.lastU_f0   * cf;

    // Re-render both tables in target unit
    renderCertificateTable(cr, s.sequence, targetUnit, mpeVal_c);
    renderUncertaintyBudgetTable(cr, s.sequence, targetUnit, u_std_c, u_res_c, u_f0_c);

    // Update KPI Cards
    const maxDev  = Math.max(...cr.map(r => Math.abs(r.dev)));
    const maxHyst = Math.max(...cr.map(r => r.h_f));
    const maxBp   = Math.max(...cr.map(r => r.b_prime_f || 0));
    const maxU    = Math.max(...cr.map(r => r.U));
    const allPass = cr.every(r => r.pass);

    document.getElementById('dkdKpiError').textContent  = fmtVal(maxDev)  + ' ' + targetUnit;
    document.getElementById('dkdKpiHyst').textContent   = fmtVal(maxHyst) + ' ' + targetUnit;
    document.getElementById('dkdKpiRepeat').textContent = fmtVal(maxBp)   + ' ' + targetUnit;
    document.getElementById('dkdKpiUncert').textContent = '\u00B1 ' + fmtVal(maxU) + ' ' + targetUnit + ' (k=2)';

    const fs = document.getElementById('dkdFinalStatus');
    if (fs) {
        fs.textContent = allPass
            ? 'PASS - Meets Specification (MPE \u00B1' + fmtVal(mpeVal_c) + ' ' + targetUnit + ')'
            : 'FAIL - Exceeds MPE (\u00B1' + fmtVal(mpeVal_c) + ' ' + targetUnit + ')';
        fs.style.color = allPass ? 'var(--green)' : 'var(--red)';
        document.getElementById('kpiErrorCard').className = 'kpi-card ' + (allPass ? 'pass' : 'fail');
    }
}

let dkdLadderChartInstance = null;
function renderLadderChart() {
    const s  = dkdWizardState;
    const su = s.setup || {};
    const unit = su.input_unit || '';
    const yMin = su.lrv !== undefined ? su.lrv : 0;
    const yMax = su.urv !== undefined ? su.urv : 100;
    const ctx  = document.getElementById('dkdLadderChart').getContext('2d');
    if (dkdLadderChartInstance) dkdLadderChartInstance.destroy();

    const labels      = [];
    const dataValues  = [];
    const actualValues = [];   // parallel array: actual reading_uut per point (null for preload/zero)
    const pointColors = [];
    const CYAN   = '#22d3ee';
    const BLUE   = '#3b6ef8';
    const ORANGE = '#f59e0b';


    // ── Preloading (Round 1) ──────────────
    const p1Data = s.preloadData ? s.preloadData.filter(r => r.round === 1) : [];
    if (p1Data.length > 0) {
        p1Data.forEach(rec => {
            labels.push('Preload ' + rec.cycle + ' Max');  dataValues.push(yMax);  actualValues.push(null); pointColors.push(CYAN);
            labels.push('Preload ' + rec.cycle + ' Zero'); dataValues.push(yMin); actualValues.push(null); pointColors.push(CYAN);
        });
    } else {
        let defCyc = s.sequence === 'B' ? 2 : s.sequence === 'C' ? 1 : 3;
        for (let c = 1; c <= defCyc; c++) {
            labels.push('Preload ' + c + ' Max');  dataValues.push(yMax); actualValues.push(null); pointColors.push(CYAN);
            labels.push('Preload ' + c + ' Zero'); dataValues.push(yMin); actualValues.push(null); pointColors.push(CYAN);
        }
    }

    // ── M-Series (acquisition order, no reversal needed) ──────────────────────
    s.mSeries.forEach((m, mIdx) => {
        const color = isMAscending(mIdx) ? BLUE : ORANGE;
        const records = s.measurementData[m] || [];
        records.forEach(rec => {
            const pctLabel = rec.setpoint_pct !== undefined ? rec.setpoint_pct : '?';
            labels.push(m + ' ' + pctLabel + '%');
            // Chart position = nominal (perfect staircase shape)
            const span = yMax - yMin;
            const nominal = rec.setpoint_pct !== undefined ? (yMin + (rec.setpoint_pct / 100) * span) : null;
            dataValues.push(nominal);
            // Tooltip shows actual user input reading
            actualValues.push(rec.reading_uut !== undefined ? rec.reading_uut : null);
            pointColors.push(color);
        });

        // For Sequence A, insert Preload 4 (2nd Clamping) after M4
        if (s.sequence === 'A' && m === 'M4') {
            labels.push('Preload 4 Max');  dataValues.push(yMax);  actualValues.push(null); pointColors.push(CYAN);
            labels.push('Preload 4 Zero'); dataValues.push(yMin); actualValues.push(null); pointColors.push(CYAN);
        }
    });

    // ── Zero Setting ──────────────────────────────────────────────────────────
    if (s.zeroSettingData && s.zeroSettingData.reading !== undefined) {
        labels.push('Zero Setting');
        dataValues.push(s.zeroSettingData.reading);
        actualValues.push(s.zeroSettingData.reading);
        pointColors.push('#a78bfa');
    }

    dkdLadderChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Metrological Staircase',
                data: dataValues,
                borderColor: BLUE,
                backgroundColor: 'rgba(59,110,248,0.08)',
                borderWidth: 2,
                stepped: 'before',
                pointBackgroundColor: pointColors,
                pointBorderColor: pointColors,
                pointRadius: 5,
                pointHoverRadius: 7,
                fill: true,
                spanGaps: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    title: { display: true, text: 'Pressure (' + unit + ')', font: { size: 12 } },
                    suggestedMin: yMin,
                    suggestedMax: yMax,
                    ticks: { font: { size: 11 } }
                },
                x: { display: false }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15,23,42,0.92)',
                    titleFont: { size: 13, weight: 'bold' },
                    bodyFont:  { size: 12 },
                    padding: 10,
                    callbacks: {
                        title: (items) => labels[items[0].dataIndex],
                        label: (item)  => {
                            const idx    = item.dataIndex;
                            const actual = actualValues[idx];
                            const nom    = item.raw;
                            if (nom === null || nom === undefined) return 'No data';
                            if (actual !== null && actual !== undefined) {
                                // M-series point: show both actual reading and nominal
                                return [
                                    `Actual reading : ${Number(actual).toFixed(4)} ${unit}`,
                                    `Nominal (${((nom - yMin) / (yMax - yMin) * 100).toFixed(1)}%FS) : ${Number(nom).toFixed(4)} ${unit}`
                                ];
                            }
                            return `${Number(nom).toFixed(4)} ${unit}`;
                        }
                    }
                }
            }
        }
    });
}


/**
 * B.4 - Serialisasi penuh dkdWizardState dan kirim ke Python untuk diekspor.
 * @param {'pdf'|'excel'} type
 * @param {string} certNumber
 */
async function exportDkdReport(type = 'pdf', certNumber) {
    const s = dkdWizardState;
    if (!s.lastRowResults || s.lastRowResults.length === 0) {
        showToast('No calculation results to export. Complete a calibration first.', 'error');
        return;
    }
    
    if (type === 'pdf') {
        await openPdfPreviewModal(certNumber);
        return;
    }
    
    showToast('Preparing Excel certificate…', 'info');
    try {
        const res = await pywebview.api.export_dkd_certificate(_buildDkdPayload(), 'excel', certNumber || '');
        if (res && res.success) {
            showToast(`Certificate exported: ${res.filepath}`, 'success');
        } else if (res?.message !== 'Export cancelled.') {
            showToast(res?.message || 'Export failed.', 'error');
        }
    } catch (err) {
        showToast(`Export error: ${err}`, 'error');
    }
}

// ─── PDF Preview Modal Logic ──────────────────────────────────────────────────
let activePreviewBlobUrl = null;
let currentPreviewCertNumber = '';

async function openPdfPreviewModal(certNumber) {
    const isDkd = _isDkdMode();
    if (isDkd) {
        const s = dkdWizardState;
        if (!s.lastRowResults || s.lastRowResults.length === 0) {
            showToast('No calculation results to preview. Complete calibration first.', 'error');
            return;
        }
    } else {
        if (!currentResult) {
            showToast('No calibration results to preview.', 'error');
            return;
        }
    }

    const overlay = document.getElementById('pdfPreviewOverlay');
    if (!overlay) return;

    overlay.classList.add('active');
    const loadingEl = document.getElementById('pdfPreviewLoading');
    if (loadingEl) loadingEl.style.display = 'flex';

    try {
        if (!certNumber) {
            const dateVal = document.getElementById('metaDate')?.value || '';
            certNumber = await pywebview.api.get_auto_certificate_number(dateVal);
        }
        currentPreviewCertNumber = certNumber || '';
        const certInput = document.getElementById('pdfPreviewCertNo');
        if (certInput) certInput.value = currentPreviewCertNumber;

        const payload = isDkd ? _buildDkdPayload() : '';
        const res = await pywebview.api.generate_dkd_certificate_preview(payload, currentPreviewCertNumber);

        if (res && res.success && res.data_uri) {
            const b64Data = res.data_uri.split(',')[1];
            const byteChars = atob(b64Data);
            const byteNums = new Array(byteChars.length);
            for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
            const blob = new Blob([new Uint8Array(byteNums)], { type: 'application/pdf' });

            if (activePreviewBlobUrl) URL.revokeObjectURL(activePreviewBlobUrl);
            activePreviewBlobUrl = URL.createObjectURL(blob);
            const frame = document.getElementById('pdfPreviewFrame');
            if (frame) frame.src = activePreviewBlobUrl;
        } else {
            showToast(res?.message || 'Failed to generate PDF preview', 'error');
        }
    } catch (err) {
        showToast('Preview error: ' + err, 'error');
    } finally {
        if (loadingEl) loadingEl.style.display = 'none';
    }
}

async function refreshPdfPreview() {
    const input = document.getElementById('pdfPreviewCertNo');
    const newCertNo = (input?.value || '').trim();
    if (!newCertNo) {
        showToast('Certificate number cannot be empty', 'error');
        return;
    }
    await openPdfPreviewModal(newCertNo);
}

function closePdfPreviewModal() {
    const overlay = document.getElementById('pdfPreviewOverlay');
    if (overlay) overlay.classList.remove('active');
    if (activePreviewBlobUrl) {
        URL.revokeObjectURL(activePreviewBlobUrl);
        activePreviewBlobUrl = null;
    }
    const frame = document.getElementById('pdfPreviewFrame');
    if (frame) frame.src = 'about:blank';
}

async function downloadPdfFromPreview() {
    const certInput = document.getElementById('pdfPreviewCertNo');
    const certNumber = (certInput?.value || currentPreviewCertNumber || '').trim();
    const isDkd = _isDkdMode();

    showToast('Preparing download...', 'info');
    try {
        if (isDkd) {
            const res = await pywebview.api.export_dkd_certificate(_buildDkdPayload(), 'pdf', certNumber);
            if (res && res.success) {
                showToast(`Certificate exported: ${res.filepath}`, 'success');
                closePdfPreviewModal();
            } else if (res?.message !== 'Export cancelled.') {
                showToast(res?.message || 'Export failed', 'error');
            }
        } else {
            const res = await pywebview.api.export_report('pdf', certNumber);
            if (res && res.success) {
                showToast('Export complete!', 'success');
                closePdfPreviewModal();
            } else if (res?.message !== 'Export cancelled.') {
                showToast(res?.message || 'Export failed', 'error');
            }
        }
    } catch (e) {
        showToast('Export error: ' + e, 'error');
    }
}

function cancelDkdWizard() {
    showConfirmDialog(
        'Cancel Calibration?',
        'Data acquisition process will be stopped and any newly entered data will be discarded. You will return to initial setup.',
        'Yes, Cancel',
        () => {
            closeConfirm();
            closeDkdWizard();
            unlockDkdSequence();
        }
    );
}


function startDkdWizard() {
    const s = dkdWizardState;
    s.phase = 'preload';
    s.preloadRound = 1;
    s.preloadCycle = 0;
    s.preloadStep = 'max_input';
    // M1 is ascending → start from index 0 (0%)
    s.currentMIndex = 0;
    s.currentPointIndex = 0;

    // F1: Clear and start recording session trend
    sessionTrendLog = [];
    sessionTrendRecording = true;

    openDkdWizard();
    renderPreloadMaxInput();
}

// ── Countdown ──────────────────────────────────────────────────────────────────
function startCountdown(totalSecs, labelText, onDone) {
    dkdWizardState.countdownTotal = totalSecs;
    dkdWizardState.countdownSeconds = totalSecs;
    dkdWizardState.countdownOnDone = onDone;
    const circum = 150.796; // 2*π*24
    const cd = document.getElementById('wizCountdown');
    const txt = document.getElementById('wizCdText');
    const lbl = document.getElementById('wizCdLabel');
    const cir = document.getElementById('wizCdCircle');
    cd.style.display = 'flex';
    document.getElementById('wizActions').style.display = 'none';
    lbl.textContent = labelText;
    const tick = () => {
        const s = dkdWizardState.countdownSeconds;
        const mins = Math.floor(s / 60), secs = s % 60;
        txt.textContent = s >= 60 ? `${mins}:${secs.toString().padStart(2, '0')}` : s;
        cir.style.strokeDashoffset = circum - (circum * (dkdWizardState.countdownTotal - s) / dkdWizardState.countdownTotal);
    };
    tick();
    dkdWizardState.countdownTimer = setInterval(() => {
        dkdWizardState.countdownSeconds--;
        tick();
        if (dkdWizardState.countdownSeconds <= 0) {
            clearInterval(dkdWizardState.countdownTimer);
            dkdWizardState.countdownTimer = null;
            cd.style.display = 'none';
            document.getElementById('wizActions').style.display = 'flex';
            if (typeof dkdWizardState.countdownOnDone === 'function') {
                dkdWizardState.countdownOnDone();
            }
        }
    }, 1000);
}

function skipCountdown() {
    if (dkdWizardState.countdownTimer) {
        clearInterval(dkdWizardState.countdownTimer);
        dkdWizardState.countdownTimer = null;
        document.getElementById('wizCountdown').style.display = 'none';
        document.getElementById('wizActions').style.display = 'flex';
        if (typeof dkdWizardState.countdownOnDone === 'function') {
            dkdWizardState.countdownOnDone();
        }
    }
}

// ── Wizard Header Update ────────────────────────────────────────────────────────
function setWizHeader(phaseName, title, subtitle, progress) {
    document.getElementById('wizPhaseBadge').textContent = phaseName;
    document.getElementById('wizTitle').textContent = title;
    document.getElementById('wizSubtitle').textContent = subtitle || 'DKD-R 6-1 Calibration Procedure';
    document.getElementById('wizProgressFill').style.width = `${progress}%`;
    document.getElementById('wizProgressLabel').textContent = `${Math.round(progress)}%`;
}

function wizSetBody(html) {
    document.getElementById('wizBody').innerHTML = html;
    document.getElementById('wizCountdown').style.display = 'none';
    document.getElementById('wizActions').style.display = 'flex';
    document.getElementById('wizNextBtn').disabled = false;
}

function envBadge() {
    const isOnline = _rawTemp !== null && _rawHum !== null && _rawPress !== null;
    if (!isOnline) {
        return `<div class="wiz-env-bar offline">
            <span><span class="sensor-dot disconnected"></span> Hardware Offline</span>
            <span class="wiz-env-note">(No live sensor stream &mdash; standard baseline 20&deg;C, 1013.25 hPa)</span>
        </div>`;
    }
    const t = document.getElementById('sensorTemp').textContent;
    const h = document.getElementById('sensorHumid').textContent;
    const p = document.getElementById('sensorPress').textContent;
    return `<div class="wiz-env-bar">
        <span>T: ${t}</span><span>RH: ${h}</span><span>P: ${p}</span>
        <span class="wiz-env-note">(Captured automatically on Next)</span>
    </div>`;
}

function spBox(nominal, unit) {
    return `<div class="wiz-sp-box">Setpoint: <strong>${nominal.toFixed(2)} ${unit}</strong></div>`;
}

// ── Preloading Phases ──────────────────────────────────────────────────────────
function renderPreloadMaxInput() {
    const s = dkdWizardState;
    const maxCyc = s.preloadMaxCycles;
    const cyc = s.preloadCycle + 1;
    const round = s.preloadRound;
    const setup = s.setup;
    const unit = setup.input_unit;
    const maxNom = setup.urv;
    const roundLabel = round === 2 ? ' (2nd Clamping)' : '';
    const prog = ((s.preloadCycle) / (maxCyc * 2)) * (round === 1 ? 30 : 15);
    setWizHeader('Preloading', `Preloading${roundLabel} / Cycle ${cyc} of ${maxCyc}`,
        `Increase pressure to MAX then record reading`, prog);
    wizSetBody(`
        ${spBox(maxNom, unit)}
        <div class="wiz-instr">Increase pressure until stable at <strong>MAX (${maxNom} ${unit})</strong>,
            then record the instrument reading:</div>
        <div class="wiz-field-wrap">
            <label class="wiz-field-label">Reading at MAX (${unit})</label>
            <input class="wiz-input" id="wizPreloadMaxVal" type="number" step="any" placeholder="0.000">
        </div>
        ${envBadge()}
    `);
    s.preloadStep = 'max_input';
}

function renderPreloadZeroInput() {
    const s = dkdWizardState;
    const setup = s.setup;
    const unit = setup.input_unit;
    setWizHeader('Preloading', `Preloading / Cycle ${s.preloadCycle + 1} / Step 2`,
        'Decrease pressure to ZERO then record reading', 0);
    wizSetBody(`
        ${spBox(0, unit)}
        <div class="wiz-instr">Decrease pressure to <strong>0 (zero)</strong> and wait for stability.
            Record the instrument reading at zero:</div>
        <div class="wiz-field-wrap">
            <label class="wiz-field-label">Zero Reading (${unit})</label>
            <input class="wiz-input" id="wizPreloadZeroVal" type="number" step="any" placeholder="0.000">
        </div>
        ${envBadge()}
    `);
    s.preloadStep = 'zero_input';
}

// ── Measurement Direction Helper ───────────────────────────────────────────────
// M-series index 0,2,4 (M1,M3,M5) = ascending ↑ ; index 1,3,5 (M2,M4,M6) = descending ↓
function isMAscending(mIndex) {
    return (mIndex % 2 === 0);
}

// Get the actual setpoint for current point, respecting direction
function getCurrentSetpoint() {
    const s = dkdWizardState;
    const pts = s.setpoints;
    if (isMAscending(s.currentMIndex)) {
        return pts[s.currentPointIndex];
    } else {
        // Descending: index 0 means last setpoint (100%), index n-1 means first (0%)
        return pts[pts.length - 1 - s.currentPointIndex];
    }
}

// ── Measurement Phases ─────────────────────────────────────────────────────────
function renderMeasurementStep() {
    const s = dkdWizardState;
    const m = s.mSeries[s.currentMIndex];
    const pi = s.currentPointIndex;
    const pct = getCurrentSetpoint();
    const setup = s.setup;
    const unit = setup.input_unit;
    const nom = setup.lrv + (pct / 100) * (setup.urv - setup.lrv);
    const isUp = isMAscending(s.currentMIndex);
    const isMax = pct === 100;
    const isZero = pct === 0;
    const totalPts = s.setpoints.length;
    const totalMs = s.mSeries.length;
    const msDone = s.currentMIndex;
    const prog = ((msDone * totalPts + pi) / (totalMs * totalPts)) * (s.sequence === 'A' ? 60 : 70) + 30;

    setWizHeader(`${m} ${isUp ? 'Ascending' : 'Descending'}`,
        `${m} / Point ${pi + 1} of ${totalPts}${isMax ? ' (MAXIMUM)' : isZero ? ' (ZERO)' : ''}`,
        `Set: ${pct}% = ${nom.toFixed(2)} ${unit}`, prog);

    wizSetBody(`
        ${spBox(nom, unit)}
        <div class="wiz-instr">${isUp
            ? `Increase pressure to <strong>${nom.toFixed(2)} ${unit}</strong> and wait for stability.`
            : `Decrease pressure to <strong>${nom.toFixed(2)} ${unit}</strong> and wait for stability.`}
        </div>
        <div class="wiz-dual-input-grid">
            <div class="wiz-field-wrap">
                <label class="wiz-field-label">Standard/Calibrator Reading (P<sub>std</sub> Actual) in ${unit}</label>
                <input class="wiz-input" id="wizMasterVal" type="number" step="any" placeholder="0.000" autofocus>
                <small class="wiz-field-hint">Reading from the reference standard</small>
            </div>
            <div class="wiz-field-wrap">
                <label class="wiz-field-label">UUT Reading (Instrument Under Test) in ${unit}</label>
                <input class="wiz-input" id="wizUutVal" type="number" step="any" placeholder="0.000">
                <small class="wiz-field-hint">Reading from the instrument being calibrated</small>
            </div>
        </div>
        ${isMax ? `<div class="wiz-bourdon-prompt" id="bourdonPrompt">
            <div class="wiz-bourdon-q">Is the instrument under test a <strong>Bourdon Tube</strong>?</div>
            <div class="wiz-bourdon-btns">
                <button class="wiz-bourdon-yes" onclick="setBourdon(true)">Yes (5 Min Hold)</button>
                <button class="wiz-bourdon-no"  onclick="setBourdon(false)">No (30 Sec Hold)</button>
            </div>
        </div>` : ''}
        ${envBadge()}
    `);

    if (isMax && s.isBourdonTube === null) {
        document.getElementById('wizNextBtn').disabled = true;
    } else if (isMax) {
        const bp = document.getElementById('bourdonPrompt');
        if (bp) bp.style.display = 'none';
    }
    s.phase = 'measurement';
}

function setBourdon(val) {
    dkdWizardState.isBourdonTube = val;
    document.getElementById('bourdonPrompt').style.display = 'none';
    document.getElementById('wizNextBtn').disabled = false;
    showToast(val ? '5-minute hold selected.' : '30-second hold selected.', 'info');
}

function renderClampingNotice() {
    setWizHeader('2nd Clamping', 'Additional Reproducibility Measurement', '2nd Clamping / Seq A', 70);
    wizSetBody(`
        <div class="wiz-clamping-card">
            <div class="wiz-clamping-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
            </div>
            <h3>2nd Clamping Required</h3>
            <p>M4 complete. Before proceeding to M5, perform disconnection and reconnection of the instrument:</p>
            <ol class="wiz-clamping-steps">
                <li>Decrease pressure to <strong>0 (zero)</strong></li>
                <li>Disconnect the instrument from the system</li>
                <li>Reconnect the instrument properly</li>
                <li>Ensure all connections are secure</li>
            </ol>
            <p class="wiz-clamping-note">Click <strong>Next</strong> after reconnection to start Preloading (1 Cycle) before M5.</p>
        </div>
    `);
    dkdWizardState.phase = 'clamping';
}

function renderZeroSetting() {
    const unit = dkdWizardState.setup.input_unit;
    setWizHeader('Zero Setting', 'Zero Setting / End of Sequence B', 'M3 complete', 92);
    wizSetBody(`
        ${spBox(0, unit)}
        <div class="wiz-instr">M3 complete. Decrease pressure to <strong>0 (zero)</strong> and wait for stability.
            Record the instrument reading at zero:</div>
        <div class="wiz-field-wrap">
            <label class="wiz-field-label">Zero Reading (${unit})</label>
            <input class="wiz-input" id="wizZeroSetVal" type="number" step="any" placeholder="0.000">
        </div>
        ${envBadge()}
    `);
    dkdWizardState.phase = 'zero_setting';
}

function renderInterMCountdown(fromM, toM, onDone) {
    setWizHeader('Delay', `${fromM} complete, proceeding to ${toM}`, 'Hold current pressure state.', 0);
    document.getElementById('wizBody').innerHTML = `
        <div class="wiz-interlude">
            <div class="wiz-interlude-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </div>
            <h3>M-Series Delay</h3>
            <p>${fromM} complete. The system requires a <strong>2-minute hold</strong> according to DKD-R 6-1 procedure before starting ${toM}.</p>
            <p class="wiz-interlude-note">Maintain system state. Do not change the pressure.</p>
        </div>
    `;
    startCountdown(120, '2-minute hold between M-series', onDone);
}

// ── Main Dispatcher: onWizardNext ───────────────────────────────────────────────
function onWizardNext() {
    const s = dkdWizardState;

    if (s.phase === 'preload') {
        if (s.preloadStep === 'max_input') {
            const v = parseFloat(document.getElementById('wizPreloadMaxVal')?.value);
            if (isNaN(v)) { showToast('Please enter MAX reading.', 'error'); return; }
            const env = captureSensorData();
            s.preloadData.push({ cycle: s.preloadCycle + 1, round: s.preloadRound, reading_max: v, env_max: env });
            // Start 30s countdown at max
            startCountdown(30, 'Hold at MAX / 30 seconds', () => {
                renderPreloadZeroInput();
            });

        } else if (s.preloadStep === 'zero_input') {
            const v = parseFloat(document.getElementById('wizPreloadZeroVal')?.value);
            if (isNaN(v)) { showToast('Please enter ZERO reading.', 'error'); return; }
            const env = captureSensorData();
            const last = s.preloadData[s.preloadData.length - 1];
            if (last) { last.reading_zero = v; last.env_zero = env; }
            // Start 30s countdown at zero
            startCountdown(30, 'Hold at ZERO / 30 seconds', () => {
                s.preloadCycle++;
                if (s.preloadCycle < s.preloadMaxCycles) {
                    renderPreloadMaxInput();
                } else {
                    // Preloading selesai - mulai M1
                    s.preloadCycle = 0;
                    s.currentMIndex = (s.preloadRound === 2) ? s.mSeries.indexOf('M5') : 0;
                    s.currentPointIndex = 0;
                    renderMeasurementStep();
                }
            });
        }

    } else if (s.phase === 'measurement') {
        const master = parseFloat(document.getElementById('wizMasterVal')?.value);
        const uut    = parseFloat(document.getElementById('wizUutVal')?.value);
        if (isNaN(master)) { showToast('Please enter Master/Calibrator reading.', 'error'); return; }
        if (isNaN(uut))    { showToast('Please enter UUT reading.', 'error'); return; }
        const env = captureSensorData();
        const m   = s.mSeries[s.currentMIndex];
        const pct = getCurrentSetpoint();
        const nom = s.setup.lrv + (pct / 100) * (s.setup.urv - s.setup.lrv);
        s.measurementData[m].push({
            setpoint_pct: pct, nominal_ideal: nom,
            reading_master: master, reading_uut: uut,
            env, timestamp: new Date().toISOString()
        });
        // Update staircase preview dengan nilai UUT
        const rawIdx = s.setpoints.indexOf(pct);
        updateStaircaseCell(m, rawIdx, uut);

        const isMax = pct === 100;
        if (isMax) {
            const holdSecs  = s.isBourdonTube ? 300 : 30;
            const holdLabel = s.isBourdonTube ? 'Hold at MAXIMUM / 5 Minutes (Bourdon Tube)' : 'Hold at MAXIMUM / 30 Seconds';
            startCountdown(holdSecs, holdLabel, () => advanceAfterPoint());
        } else {
            startCountdown(30, 'Hold position / 30 seconds', () => advanceAfterPoint());
        }

    } else if (s.phase === 'clamping') {
        // After 2nd clamping → start 2nd preloading round
        s.preloadRound = 2;
        s.preloadCycle = 0;
        s.preloadStep = 'max_input';
        s.phase = 'preload';
        s.preloadMaxCycles = 1;
        renderPreloadMaxInput();

    } else if (s.phase === 'zero_setting') {
        const v = parseFloat(document.getElementById('wizZeroSetVal')?.value);
        if (isNaN(v)) { showToast('Please enter ZERO reading.', 'error'); return; }
        const env = captureSensorData();
        s.zeroSettingData = { reading: v, env, timestamp: new Date().toISOString() };
        startCountdown(30, 'Hold at ZERO / 30 seconds', () => {
            closeDkdWizard();
            calculateDkdResults();
        });

    } else if (s.phase === 'inter_m') {
        // Handled by countdown callback - button shouldn't be active here
    }
}

function advanceAfterPoint() {
    const s = dkdWizardState;
    const ascending = isMAscending(s.currentMIndex);
    const totalPts = s.setpoints.length;

    // Move to next point in the current direction
    s.currentPointIndex++;

    if (s.currentPointIndex < totalPts) {
        // Still within this M-series
        renderMeasurementStep();
        return;
    }

    // Finished this M-series → reset point index
    s.currentPointIndex = 0;
    const m = s.mSeries[s.currentMIndex];

    // Sequence B: setelah M3 → zero setting
    if (s.sequence === 'B' && m === 'M3') {
        renderZeroSetting(); return;
    }
    // Sequence A: setelah M4 → 2nd clamping
    if (s.sequence === 'A' && m === 'M4') {
        renderClampingNotice(); return;
    }

    s.currentMIndex++;
    if (s.currentMIndex >= s.mSeries.length) {
        closeDkdWizard();
        calculateDkdResults();
        return;
    }

    // Next M-series: if descending, start from last index (100%) i.e. pointIndex=0 maps to pts.last
    // pointIndex always starts at 0; getCurrentSetpoint() handles the reversal
    s.currentPointIndex = 0;

    const nextM = s.mSeries[s.currentMIndex];
    s.phase = 'inter_m';
    renderInterMCountdown(m, nextM, () => {
        s.phase = 'measurement';
        renderMeasurementStep();
    });
}

// ─── F1: Environmental Trend Charts ──────────────────────────────────────────
function toggleEnvTrend() {
    const overlay = document.getElementById('envTrendWorkspaceOverlay');
    const btn = document.getElementById('envTrendToggleBtn');
    if (!overlay || !btn) return;
    const icon = btn.querySelector('svg');

    envTrendVisible = !envTrendVisible;
    if (envTrendVisible) {
        overlay.style.display = 'flex';
        if (icon) icon.style.transform = 'rotate(180deg)';
        btn.title = "Hide trend chart";
        renderEnvTrendCharts();
    } else {
        overlay.style.display = 'none';
        if (icon) icon.style.transform = 'rotate(0deg)';
        btn.title = "Show trend chart";
    }
}

function switchTrendMode(mode, force = false) {
    if (mode === envTrendMode && !force) return;
    envTrendMode = mode;
    const btnLive = document.getElementById('btnTrendLive');
    const btnSess = document.getElementById('btnTrendSession');
    if (btnLive) btnLive.classList.toggle('active', mode === 'live');
    if (btnSess) btnSess.classList.toggle('active', mode === 'session');
    renderEnvTrendCharts();
}

function renderEnvTrendCharts() {
    const dataLog = envTrendMode === 'live' ? liveTrendLog : sessionTrendLog;
    const standbyIds = ['standbyTemp', 'standbyHum', 'standbyPress'];

    if (dataLog.length === 0) {
        const bT = document.getElementById('badgeAvgTemp');
        const bH = document.getElementById('badgeAvgHum');
        const bP = document.getElementById('badgeAvgPress');
        if (bT) bT.textContent = 'AVERAGE: - ' + ambientUnitTemp;
        if (bH) bH.textContent = 'AVERAGE: - ' + ambientUnitHum;
        if (bP) bP.textContent = 'AVERAGE: - ' + ambientUnitPress;
        document.getElementById('avgTempLabel').textContent = 'Average: - ' + ambientUnitTemp;
        document.getElementById('avgHumLabel').textContent = 'Average: - ' + ambientUnitHum;
        document.getElementById('avgPressLabel').textContent = 'Average: - ' + ambientUnitPress;
        if (typeof _updateAmbTopHeader === 'function') _updateAmbTopHeader();
        standbyIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove('hidden');
        });
        return;
    }
    standbyIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    const labels = dataLog.map(d => d.timeStr);
    const rawTemps = dataLog.map(d => d.temp);
    const hums = dataLog.map(d => d.hum);
    const rawPresses = dataLog.map(d => d.press);

    const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
    const avgTemp = avg(rawTemps);
    const avgHum = avg(hums);
    const avgPress = avg(rawPresses);

    const dispAvgTemp = _convertTemp(avgTemp);
    const dispAvgPress = _convertPress(avgPress);

    const temps = rawTemps.map(t => _convertTemp(t));
    const presses = rawPresses.map(p => _convertPress(p));

    const bT = document.getElementById('badgeAvgTemp');
    const bH = document.getElementById('badgeAvgHum');
    const bP = document.getElementById('badgeAvgPress');
    if (bT) bT.textContent = 'AVERAGE: ' + (dispAvgTemp !== null ? dispAvgTemp.toFixed(1) : '-') + ' ' + ambientUnitTemp;
    if (bH) bH.textContent = 'AVERAGE: ' + (avgHum !== null && !isNaN(avgHum) ? avgHum.toFixed(1) : '-') + ' ' + ambientUnitHum;
    if (bP) bP.textContent = 'AVERAGE: ' + (dispAvgPress !== null ? dispAvgPress.toFixed(_pressDecimals()) : '-') + ' ' + ambientUnitPress;

    document.getElementById('avgTempLabel').textContent = 'Average: ' + (dispAvgTemp !== null ? dispAvgTemp.toFixed(1) : '-') + ' ' + ambientUnitTemp;
    document.getElementById('avgHumLabel').textContent = 'Average: ' + avgHum.toFixed(1) + ' ' + ambientUnitHum;
    document.getElementById('avgPressLabel').textContent = 'Average: ' + (dispAvgPress !== null ? dispAvgPress.toFixed(_pressDecimals()) : '-') + ' ' + ambientUnitPress;
    if (typeof _updateAmbTopHeader === 'function') _updateAmbTopHeader();

    const trendOpts = (yLabel) => ({
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: 'rgba(15,23,42,0.95)',
                borderColor: 'rgba(0,0,0,0.05)',
                borderWidth: 1,
                titleColor: '#ffffff',
                bodyColor: '#ffffff',
                titleFont: { size: 10, weight: 'bold' },
                bodyFont: { size: 11, family: 'var(--mono)' },
                padding: 8,
                displayColors: false,
                callbacks: {
                    title: (items) => `Time: ${items[0].label}`,
                    label: (item) => ` ${item.raw.toFixed(1)} ${yLabel}`
                }
            }
        },
        scales: {
            x: {
                ticks: { color: '#9096b4', font: { size: 9, family: 'var(--mono)' }, maxRotation: 0, autoSkip: true, maxTicksLimit: 5 },
                grid: { display: false }
            },
            y: {
                ticks: { color: '#9096b4', font: { size: 9, family: 'var(--mono)' } },
                grid: { color: 'rgba(0, 0, 0, 0.03)', drawBorder: false, borderDash: [3, 3] }
            }
        }
    });

    // Temp Chart
    const tempCanvas = document.getElementById('chartTrendTemp');
    if (tempCanvas) {
        const tempCtx = tempCanvas.getContext('2d');
        const tempGrad = tempCtx.createLinearGradient(0, 0, 0, 240);
        tempGrad.addColorStop(0, 'rgba(245,158,11,0.08)');
        tempGrad.addColorStop(1, 'rgba(245,158,11,0.00)');

        if (envTrendCharts.temp) envTrendCharts.temp.destroy();
        envTrendCharts.temp = new Chart(tempCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        data: temps,
                        borderColor: '#f59e0b',
                        backgroundColor: tempGrad,
                        borderWidth: 2,
                        tension: 0.35,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        pointHoverBackgroundColor: '#f59e0b',
                        fill: true
                    },
                    {
                        data: Array(labels.length).fill(dispAvgTemp),
                        borderColor: 'rgba(245,158,11,0.25)',
                        borderDash: [4, 4],
                        borderWidth: 1,
                        pointRadius: 0,
                        fill: false
                    }
                ]
            },
            options: trendOpts(ambientUnitTemp)
        });
    }

    // Humid Chart
    const humCanvas = document.getElementById('chartTrendHum');
    if (humCanvas) {
        const humCtx = humCanvas.getContext('2d');
        const humGrad = humCtx.createLinearGradient(0, 0, 0, 240);
        humGrad.addColorStop(0, 'rgba(6,182,212,0.08)');
        humGrad.addColorStop(1, 'rgba(6,182,212,0.00)');

        if (envTrendCharts.hum) envTrendCharts.hum.destroy();
        envTrendCharts.hum = new Chart(humCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        data: hums,
                        borderColor: '#06b6d4',
                        backgroundColor: humGrad,
                        borderWidth: 2,
                        tension: 0.35,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        pointHoverBackgroundColor: '#06b6d4',
                        fill: true
                    },
                    {
                        data: Array(labels.length).fill(avgHum),
                        borderColor: 'rgba(6,182,212,0.25)',
                        borderDash: [4, 4],
                        borderWidth: 1,
                        pointRadius: 0,
                        fill: false
                    }
                ]
            },
            options: trendOpts('%RH')
        });
    }

    // Press Chart
    const pressCanvas = document.getElementById('chartTrendPress');
    if (pressCanvas) {
        const pressCtx = pressCanvas.getContext('2d');
        const pressGrad = pressCtx.createLinearGradient(0, 0, 0, 240);
        pressGrad.addColorStop(0, 'rgba(59,110,248,0.08)');
        pressGrad.addColorStop(1, 'rgba(59,110,248,0.00)');

        if (envTrendCharts.press) envTrendCharts.press.destroy();
        envTrendCharts.press = new Chart(pressCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        data: presses,
                        borderColor: '#3b6ef8',
                        backgroundColor: pressGrad,
                        borderWidth: 2,
                        tension: 0.35,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        pointHoverBackgroundColor: '#3b6ef8',
                        fill: true
                    },
                    {
                        data: Array(labels.length).fill(dispAvgPress),
                        borderColor: 'rgba(59,110,248,0.25)',
                        borderDash: [4, 4],
                        borderWidth: 1,
                        pointRadius: 0,
                        fill: false
                    }
                ]
            },
            options: trendOpts(ambientUnitPress)
        });
    }
}

// ─── F2 & F3: Calculation Detail Modals ──────────────────────────────────────
function openDetailModal(type) {
    currentDetailModalType = type;
    const s = dkdWizardState;
    if (!s.lastRowResults || s.lastRowResults.length === 0) return;
    
    // Set first setpoint as active - use lastRowResults[0].pct to guarantee type match
    activeDetailSetpointPct = s.lastRowResults.length > 0
        ? s.lastRowResults[0].pct
        : s.setpoints[0];
    
    // Show modal overlay
    document.getElementById('detailModalOverlay').classList.add('active');
    
    // Set titles
    const titleEl = document.getElementById('detailModalTitle');
    const subtitleEl = document.getElementById('detailModalSubtitle');
    const unitSel = document.getElementById('dkdDisplayUnit');
    const unit = unitSel ? unitSel.value : (s.lastRawUnit || 'bar');
    
    if (type === 'table1') {
        titleEl.textContent = 'Detail Analisis Metrologi - Tabel 1 (Data Pengukuran Fisik)';
        subtitleEl.textContent = `Sequence ${s.sequence} | Unit: ${unit}`;
    } else {
        titleEl.textContent = 'Detail Analisis Metrologi - Tabel 2 (Anggaran Ketidakpastian)';
        subtitleEl.textContent = `Sequence ${s.sequence} | k = 2 | Confidence Level 95% | Unit: ${unit}`;
    }
    
    // Render setpoint tabs and body content
    renderDetailSetpointTabs();
    renderDetailModalBody();
}

function closeDetailModal() {
    document.getElementById('detailModalOverlay').classList.remove('active');
}

function renderDetailSetpointTabs() {
    const s = dkdWizardState;
    const container = document.getElementById('detailSetpointTabs');
    if (!container) return;
    container.innerHTML = '';
    
    s.setpoints.forEach(pct => {
        const tabBtn = document.createElement('button');
        tabBtn.dataset.pct = pct;
        tabBtn.className = `detail-setpoint-tab ${Number(pct) === Number(activeDetailSetpointPct) ? 'active' : ''}`;
        tabBtn.textContent = `${pct}%`;
        tabBtn.onclick = () => {
            activeDetailSetpointPct = pct;
            document.querySelectorAll('.detail-setpoint-tab').forEach(btn => {
                btn.classList.toggle('active', Number(btn.dataset.pct) === Number(pct));
            });
            renderDetailModalBody();
        };
        container.appendChild(tabBtn);
    });
}

function renderDetailModalBody() {
    const container = document.getElementById('detailModalBody');
    if (!container) return;
    
    if (currentDetailModalType === 'table1') {
        container.innerHTML = buildDetailTable1Content(activeDetailSetpointPct);
    } else {
        container.innerHTML = buildDetailTable2Content(activeDetailSetpointPct);
    }
}

function buildDetailTable1Content(pct) {
    const s = dkdWizardState;
    const su = s.setup || {};
    const seq = s.sequence;
    const rawUnit = s.lastRawUnit || 'bar';
    const unitSel = document.getElementById('dkdDisplayUnit');
    const unit = unitSel ? unitSel.value : rawUnit;
    const cf = unitConvFactor(rawUnit) / unitConvFactor(unit);
    
    const lrv  = su.lrv || 0, urv = su.urv || 0;
    const span  = urv - lrv;
    const UCF   = unitConvFactor(unit);
    
    // Find the row result - Number() coercion prevents strict-equality type mismatch
    const r = s.lastRowResults.find(row => Number(row.pct) === Number(pct));
    if (!r) return '<div class="wiz-instr">Data tidak ditemukan untuk setpoint ini.</div>';
    
    // Recompute intermediate env values for documentation
    const allEnvs = [];
    s.mSeries.forEach(m => (s.measurementData[m] || []).forEach(rec => { if (rec.env) allEnvs.push(rec.env); }));
    const avgEnv = (key, fb) => {
        const v = allEnvs.map(e => e[key]).filter(x => x !== null && !isNaN(x));
        return v.length > 0 ? v.reduce((a,b) => a+b, 0) / v.length : fb;
    };
    const T_avg = avgEnv('temperature', 20);
    const H_avg = avgEnv('humidity', 50);
    const P_atm = avgEnv('pressure_atm', 1013.25);
    
    // Detailed moist air density calculations according to ISO/CIPM simplified guidelines
    const R_d = 287.058; // Dry air gas constant [J/(kg.K)]
    const R_v = 461.495; // Water vapor gas constant [J/(kg.K)]
    const T_K = 273.15 + T_avg; // Kelvin
    
    // 1. Saturation vapor pressure (p_sat) in Pa  - Magnus equation, ISO 1217
    const p_sat = 611.2 * Math.exp((17.502 * T_avg) / (240.97 + T_avg));
    // 2. Partial water vapor pressure (p_v) in Pa
    const p_v = (H_avg / 100) * p_sat;
    // 3. Dry air pressure (p_d) in Pa  - P_atm converted from hPa to Pa explicitly
    const p_d = (P_atm * 100) - p_v;
    // 4. Ambient air density (rho_a) in kg/m³  - ISO 1217 Annex C
    const rho_a = p_d / (R_d * T_K) + p_v / (R_v * T_K);
    
    const rho_f = su.medium_density || 1.2; // media density (kg/m³)
    const g = 9.80665;
    const h_diff = su.height_diff || 0;
    
    // Calculate in converted unit directly
    const delta_p_head = ((rho_f - rho_a) * g * h_diff) / UCF;

    // Get the original measurement logs for this setpoint, scaled by cf
    const rawReadings = {};
    s.mSeries.forEach(m => {
        const rec = (s.measurementData[m] || []).find(rec => rec.setpoint_pct === pct);
        if (rec) {
            rawReadings[m] = {
                master: rec.reading_master * cf,
                uut: rec.reading_uut * cf
            };
        }
    });

    let html = '';

    // Step 1: Raw readings
    html += `
    <div class="detail-formula-block">
        <div class="detail-step-header">
            <span>LANGKAH 1 - Data Pembacaan Mentah (Raw Readings)</span>
        </div>
        <div class="detail-math-explanation">
            Berikut adalah data pembacaan langsung dari instrumen UUT (Unit Under Test) dan master/kalibrator standar pada setpoint <strong>${pct}% (${(r.nom_ideal * cf).toFixed(4)} ${unit})</strong>:
        </div>
        <table class="sc-table" style="margin-top: 10px; font-size: 12px; width: 100%;">
            <thead>
                <tr>
                    <th>Siklus / Seri</th>
                    <th>Pembacaan UUT (${unit})</th>
                    <th>Pembacaan Master (${unit})</th>
                </tr>
            </thead>
            <tbody>
    `;
    s.mSeries.forEach(m => {
        const data = rawReadings[m];
        if (data) {
            html += `
                <tr>
                    <td style="font-weight: 700; text-align: center;">${m} (${m.includes('1') || m.includes('3') || m.includes('5') ? 'Naik' : 'Turun'})</td>
                    <td style="text-align: center; font-family: var(--mono);">${data.uut.toFixed(4)}</td>
                    <td style="text-align: center; font-family: var(--mono);">${data.master.toFixed(4)}</td>
                </tr>
            `;
        }
    });
    html += `
            </tbody>
        </table>
    </div>
    `;

    // Step 2: Moist Air Density Equation (Highly Detailed)
    html += `
    <div class="detail-formula-block">
        <div class="detail-step-header">
            <span>LANGKAH 2 - Perhitungan Densitas Udara Basah Ambiens (Ambient Moist Air Density)</span>
        </div>
        <div class="detail-math-explanation">
            Densitas udara basah (&rho;_a) dihitung secara dinamis menggunakan persamaan komparatif CIPM terpadu untuk mengoreksi efek gaya apung udara (air buoyancy effect) terhadap instrumen. Parameter lingkungan rata-rata selama pengujian adalah:<br>
            - Temperatur Rata-rata (T_avg) = <strong>${T_avg.toFixed(2)} °C</strong> (T_K = ${T_K.toFixed(2)} K)<br>
            - Kelembaban Rata-rata (H_avg) = <strong>${H_avg.toFixed(1)} %RH</strong><br>
            - Tekanan Atmosfer Rata-rata (P_atm) = <strong>${P_atm.toFixed(1)} hPa</strong>
        </div>
        
        <div class="detail-math-explanation" style="margin-top: 8px;">
            <strong>A. Tekanan Uap Jenuh (Saturation Vapor Pressure - p_sat):</strong><br>
            Dihitung menggunakan persamaan eksponensial:
        </div>
        <div class="detail-math-formula">
            p_sat = 611.2 &times; e^((17.502 &times; T) / (240.97 + T))  [Pa]
        </div>
        <div class="detail-math-substitution">
            p_sat = 611.2 &times; e^((17.502 &times; ${T_avg.toFixed(2)}) / (240.97 + ${T_avg.toFixed(2)}))<br>
            p_sat = 611.2 &times; e^(${((17.502 * T_avg) / (240.97 + T_avg)).toFixed(4)})<br>
            p_sat = <strong>${p_sat.toFixed(4)} Pa</strong>
        </div>

        <div class="detail-math-explanation" style="margin-top: 8px;">
            <strong>B. Tekanan Uap Parsial (Partial Vapor Pressure - p_v):</strong><br>
            Dihitung berdasarkan kelembaban relatif udara:
        </div>
        <div class="detail-math-formula">
            p_v = (RH / 100) &times; p_sat  [Pa]
        </div>
        <div class="detail-math-substitution">
            p_v = (${H_avg.toFixed(1)} / 100) &times; ${p_sat.toFixed(4)}<br>
            p_v = <strong>${p_v.toFixed(4)} Pa</strong>
        </div>

        <div class="detail-math-explanation" style="margin-top: 8px;">
            <strong>C. Tekanan Udara Kering (Dry Air Pressure - p_d):</strong><br>
            Selisih tekanan atmosfer total dengan tekanan uap air parsial:
        </div>
        <div class="detail-math-formula">
            p_d = (P_atm &times; 100) &minus; p_v  [Pa]  &nbsp;-&nbsp; konversi P_atm: hPa &rarr; Pa
        </div>
        <div class="detail-math-substitution">
            p_d = (${P_atm.toFixed(1)} &times; 100) &minus; ${p_v.toFixed(4)}<br>
            p_d = ${(P_atm * 100).toFixed(1)} &minus; ${p_v.toFixed(4)}<br>
            p_d = <strong>${p_d.toFixed(4)} Pa</strong>
        </div>

        <div class="detail-math-explanation" style="margin-top: 8px;">
            <strong>D. Densitas Udara Basah (&rho;_a):</strong><br>
            Dihitung menggunakan konstanta gas udara kering (R_d = 287.058 J/(kg·K)) dan uap air (R_v = 461.495 J/(kg·K)):
        </div>
        <div class="detail-math-formula">
            &rho;_a = p_d / (R_d &times; T_K) + p_v / (R_v &times; T_K)  [kg/m³]
        </div>
        <div class="detail-math-substitution">
            &rho;_a = ${p_d.toFixed(4)} / (287.058 &times; ${T_K.toFixed(2)}) + ${p_v.toFixed(4)} / (461.495 &times; ${T_K.toFixed(2)})<br>
            &rho;_a = ${p_d.toFixed(4)} / ${(R_d * T_K).toFixed(3)} + ${p_v.toFixed(4)} / ${(R_v * T_K).toFixed(3)}<br>
            &rho;_a = ${(p_d / (R_d * T_K)).toFixed(6)} + ${(p_v / (R_v * T_K)).toFixed(6)}<br>
            &rho;_a = <strong>${rho_a.toFixed(6)} kg/m³</strong>
        </div>
    </div>
    `;

    // Step 3: Hydrostatic Correction
    html += `
    <div class="detail-formula-block">
        <div class="detail-step-header">
            <span>LANGKAH 3 - Koreksi Tekanan Hidrostatis (Head Correction) & P_standard</span>
        </div>
        <div class="detail-math-explanation">
            Adanya perbedaan ketinggian pemasangan sensor (h) memicu timbulnya perbedaan tekanan hidrostatis (&Delta;p_head) antara kalibrator dan instrumen. Koreksi ini dihitung berdasarkan densitas medium (&rho;_f), densitas udara ambien (&rho;_a), gravitasi (g), dan tinggi vertikal (h_diff):
        </div>
        <div class="detail-math-formula">
            &Delta;p_head = ((&rho;_f - &rho;_a) &times; g &times; h_diff) / Faktor Konversi
        </div>
        <div class="detail-math-substitution">
            &Delta;p_head = ((${rho_f} kg/m³ - ${rho_a.toFixed(6)} kg/m³) &times; 9.80665 m/s² &times; ${h_diff} m) / ${UCF}<br>
            &Delta;p_head = (${(rho_f - rho_a).toFixed(6)} &times; 9.80665 &times; ${h_diff}) / ${UCF}<br>
            &Delta;p_head = <strong>${delta_p_head.toFixed(8)} ${unit}</strong>
        </div>
        <div class="detail-math-explanation">
            Perbandingan media menunjukkan bagaimana densitas udara ambien basah (&rho;_a = ${rho_a.toFixed(4)} kg/m³) mempengaruhi efek apung udara terhadap densitas cairan medium (&rho;_f = ${rho_f} kg/m³).
        </div>
        <div class="detail-math-explanation">
            Setiap pembacaan Master dikoreksi dengan mengurangkan nilai &Delta;p_head ini:<br>
            <span style="font-family: var(--mono); font-size: 12px;">P_std = Master - &Delta;p_head</span>
        </div>
        <div class="detail-math-substitution">
    `;
    s.mSeries.forEach(m => {
        const data = rawReadings[m];
        if (data) {
            html += `<span style="font-family: var(--mono); font-size: 12.5px;">P_std_${m} = ${data.master.toFixed(4)} - ${delta_p_head.toFixed(8)} = ${(data.master - delta_p_head).toFixed(6)} ${unit}</span><br>`;
        }
    });
    html += `
        </div>
        <div class="detail-math-explanation">
            Nilai <strong>P_standard</strong> aktual dihitung dari rata-rata pembacaan master yang telah terkoreksi:
        </div>
        <div class="detail-math-formula">
            P_standard = (${s.mSeries.map(m => `P_std_${m}`).join(' + ')}) / ${s.mSeries.length}
        </div>
        <div class="detail-math-substitution">
            P_standard = (${s.mSeries.map(m => (rawReadings[m].master - delta_p_head).toFixed(6)).join(' + ')}) / ${s.mSeries.length}<br>
            P_standard = <strong>${(r.p_std * cf).toFixed(6)} ${unit}</strong>
        </div>
    </div>
    `;

    // Step 4: UUT Average
    html += `
    <div class="detail-formula-block">
        <div class="detail-step-header">
            <span>LANGKAH 4 - Rata-rata Pembacaan UUT (UUT Average)</span>
        </div>
        <div class="detail-math-explanation">
            Nilai rata-rata pembacaan UUT dihitung berdasarkan sekuens pembebanan yang digunakan:
        </div>
    `;
    if (seq === 'C') {
        html += `
        <div class="detail-math-formula">
            UUT_Avg = (M1 + M2) / 2
        </div>
        <div class="detail-math-substitution">
            UUT_Avg = (${rawReadings.M1.uut.toFixed(4)} + ${rawReadings.M2.uut.toFixed(4)}) / 2<br>
            UUT_Avg = <strong>${(r.mean * cf).toFixed(6)} ${unit}</strong>
        </div>
        `;
    } else if (seq === 'B') {
        html += `
        <div class="detail-math-formula">
            UUT_Avg = (((M1 + M3) / 2) + M2) / 2
        </div>
        <div class="detail-math-substitution">
            UUT_Avg = (((${rawReadings.M1.uut.toFixed(4)} + ${rawReadings.M3.uut.toFixed(4)}) / 2) + ${rawReadings.M2.uut.toFixed(4)}) / 2<br>
            UUT_Avg = (${((rawReadings.M1.uut + rawReadings.M3.uut)/2).toFixed(5)} + ${rawReadings.M2.uut.toFixed(4)}) / 2<br>
            UUT_Avg = <strong>${(r.mean * cf).toFixed(6)} ${unit}</strong>
        </div>
        `;
    } else { // Seq A
        html += `
        <div class="detail-math-formula">
            UUT_Avg = (M1 + M2 + M3 + M4 + M5 + M6) / 6
        </div>
        <div class="detail-math-substitution">
            UUT_Avg = (${rawReadings.M1.uut.toFixed(4)} + ${rawReadings.M2.uut.toFixed(4)} + ${rawReadings.M3.uut.toFixed(4)} + ${rawReadings.M4.uut.toFixed(4)} + ${rawReadings.M5.uut.toFixed(4)} + ${rawReadings.M6.uut.toFixed(4)}) / 6<br>
            UUT_Avg = <strong>${(r.mean * cf).toFixed(6)} ${unit}</strong>
        </div>
        `;
    }
    html += `</div>`;

    // Step 5: Deviasi
    html += `
    <div class="detail-formula-block">
        <div class="detail-step-header">
            <span>LANGKAH 5 - Deviasi (Penyimpangan)</span>
        </div>
        <div class="detail-math-explanation">
            Deviasi mengukur selisih rata-rata pembacaan UUT terhadap standar acuan (P_standard) yang telah dikoreksi:
        </div>
        <div class="detail-math-formula">
            Deviasi = UUT_Avg - P_standard
        </div>
        <div class="detail-math-substitution">
            Deviasi = ${(r.mean * cf).toFixed(6)} - ${(r.p_std * cf).toFixed(6)}<br>
            Deviasi = <strong>${(r.dev * cf).toFixed(6)} ${unit}</strong>
        </div>
        <div class="detail-math-explanation">
            ${r.dev >= 0 
                ? 'Hasil menunjukkan bias positif: pembacaan instrumen UUT lebih tinggi dibandingkan nilai tekanan standar.' 
                : 'Hasil menunjukkan bias negatif: pembacaan instrumen UUT lebih rendah dibandingkan nilai tekanan standar.'}
        </div>
    </div>
    `;

    // Step 6: Histeresis
    html += `
    <div class="detail-formula-block">
        <div class="detail-step-header">
            <span>LANGKAH 6 - Histeresis (h)</span>
        </div>
        <div class="detail-math-explanation">
            Mengukur ketidaksesuaian pembacaan akibat histeresis mekanis/deformasi sensor pada siklus naik-turun:
        </div>
    `;
    if (seq === 'C') {
        html += `
        <div class="detail-math-formula">
            h = |M2 - M1|
        </div>
        <div class="detail-math-substitution">
            h = |${rawReadings.M2.uut.toFixed(4)} - ${rawReadings.M1.uut.toFixed(4)}|<br>
            h = <strong>${(r.h_f * cf).toFixed(6)} ${unit}</strong>
        </div>
        `;
    } else if (seq === 'B') {
        html += `
        <div class="detail-math-formula">
            h = |M2 - M1|
        </div>
        <div class="detail-math-substitution">
            h = |${rawReadings.M2.uut.toFixed(4)} - ${rawReadings.M1.uut.toFixed(4)}|<br>
            h = <strong>${(r.h_f * cf).toFixed(6)} ${unit}</strong>
        </div>
        `;
    } else { // Seq A
        html += `
        <div class="detail-math-formula">
            h = (|M2 - M1| + |M4 - M3| + |M6 - M5|) / 3
        </div>
        <div class="detail-math-substitution">
            h = (|${rawReadings.M2.uut.toFixed(4)} - ${rawReadings.M1.uut.toFixed(4)}| + |${rawReadings.M4.uut.toFixed(4)} - ${rawReadings.M3.uut.toFixed(4)}| + |${rawReadings.M6.uut.toFixed(4)} - ${rawReadings.M5.uut.toFixed(4)}|) / 3<br>
            h = (${Math.abs(rawReadings.M2.uut - rawReadings.M1.uut).toFixed(5)} + ${Math.abs(rawReadings.M4.uut - rawReadings.M3.uut).toFixed(5)} + ${Math.abs(rawReadings.M6.uut - rawReadings.M5.uut).toFixed(5)}) / 3<br>
            h = <strong>${(r.h_f * cf).toFixed(6)} ${unit}</strong>
        </div>
        `;
    }
    html += `</div>`;

    // Step 7: Repeatability b'
    if (seq !== 'C') {
        html += `
        <div class="detail-formula-block">
            <div class="detail-step-header">
                <span>LANGKAH 7 - Repeatability (Keterulangan - b')</span>
            </div>
            <div class="detail-math-explanation">
                Mengukur variabilitas pembacaan pada arah pembebanan yang sama di bawah kondisi operasional yang identik:
            </div>
        `;
        if (seq === 'B') {
            html += `
            <div class="detail-math-formula">
                b' = |M3 - M1|
            </div>
            <div class="detail-math-substitution">
                b' = |${rawReadings.M3.uut.toFixed(4)} - ${rawReadings.M1.uut.toFixed(4)}|<br>
                b' = <strong>${(r.b_prime_f * cf).toFixed(6)} ${unit}</strong>
            </div>
            `;
        } else { // Seq A
            html += `
            <div class="detail-math-formula">
                b' = max(|M3 - M1|, |M4 - M2|)
            </div>
            <div class="detail-math-substitution">
                b' = max(|${rawReadings.M3.uut.toFixed(4)} - ${rawReadings.M1.uut.toFixed(4)}|, |${rawReadings.M4.uut.toFixed(4)} - ${rawReadings.M2.uut.toFixed(4)}|)<br>
                b' = max(${Math.abs(rawReadings.M3.uut - rawReadings.M1.uut).toFixed(5)}, ${Math.abs(rawReadings.M4.uut - rawReadings.M2.uut).toFixed(5)})<br>
                b' = <strong>${(r.b_prime_f * cf).toFixed(6)} ${unit}</strong>
            </div>
            `;
        }
        html += `</div>`;
    }

    // Step 8: Reproducibility b (Seq A only)
    if (seq === 'A') {
        html += `
        <div class="detail-formula-block">
            <div class="detail-step-header">
                <span>LANGKAH 8 - Reproducibility (Kereprodusibilitasan - b)</span>
            </div>
            <div class="detail-math-explanation">
                Mengukur pengaruh pembongkaran dan perakitan kembali instrumen (sambungan mekanis/fitting) terhadap konsistensi pembacaan:
            </div>
            <div class="detail-math-formula">
                b = |((M1 + M2 + M3 + M4) / 4) - ((M5 + M6) / 2)|
            </div>
            <div class="detail-math-substitution">
                b = |((${rawReadings.M1.uut.toFixed(4)} + ${rawReadings.M2.uut.toFixed(4)} + ${rawReadings.M3.uut.toFixed(4)} + ${rawReadings.M4.uut.toFixed(4)}) / 4) - ((${rawReadings.M5.uut.toFixed(4)} + ${rawReadings.M6.uut.toFixed(4)}) / 2)|<br>
                b = |${((rawReadings.M1.uut + rawReadings.M2.uut + rawReadings.M3.uut + rawReadings.M4.uut)/4).toFixed(5)} - ${((rawReadings.M5.uut + rawReadings.M6.uut)/2).toFixed(5)}|<br>
                b = <strong>${(r.b_f * cf).toFixed(6)} ${unit}</strong>
            </div>
        </div>
        `;
    }

    return html;
}

function buildDetailTable2Content(pct) {
    const s = dkdWizardState;
    const su = s.setup || {};
    const seq = s.sequence;
    const rawUnit = s.lastRawUnit || 'bar';
    const unitSel = document.getElementById('dkdDisplayUnit');
    const unit = unitSel ? unitSel.value : rawUnit;
    const cf = unitConvFactor(rawUnit) / unitConvFactor(unit);
    
    const lrv  = su.lrv || 0, urv = su.urv || 0;
    const span  = (urv - lrv) * cf;
    const mpeVal = s.lastMpeVal * cf;
    
    // Find the row result
    const r = s.lastRowResults.find(row => row.pct === pct);
    if (!r) return '<div class="wiz-instr">Data tidak ditemukan untuk setpoint ini.</div>';
    
    const u_std = s.lastU_std * cf;
    const u_res = s.lastU_res * cf;
    const u_f0 = s.lastU_f0 * cf;
    const u_c = (r.U * cf) / 2;

    let html = '';

    // Step 1: Global Constants
    html += `
    <div class="detail-global-alert">
        <strong>KOMPONEN GLOBAL (Konstan untuk seluruh setpoint):</strong><br>
        <div style="margin-top: 8px;">
            <strong>1. u_std (Ketidakpastian Kalibrator Standar):</strong><br>
    `;
    if (su.calibrator_type === 'DWT') {
        html += `
            Tipe Standar: Dead-Weight Tester (DWT)<br>
            Rumus: u_std = (U_sertifikat &times; Faktor Konversi) / 2<br>
            Substitusi: u_std = (${su.u_standard_dwt} &times; ${cf}) / 2 = <strong>${u_std.toFixed(6)} ${unit}</strong>
        `;
    } else {
        html += `
            Tipe Standar: Digital Calibrator<br>
            Rumus: u_std = ((Akurasi% / 100) &times; Full Scale) / &radic;3<br>
            Substitusi: u_std = ((${su.std_accuracy_percent}% / 100) &times; ${(su.std_full_scale * cf)}) / 1.73205 = <strong>${u_std.toFixed(6)} ${unit}</strong>
        `;
    }
    html += `
        </div>
        <div style="margin-top: 10px;">
            <strong>2. u_res (Ketidakpastian Resolusi Alat):</strong><br>
            Rumus: u_res = ((Resolusi &times; Faktor Konversi) / 2) / &radic;3<br>
            Substitusi: u_res = (${(su.resolution * cf)} / 2) / 1.73205 = <strong>${u_res.toFixed(6)} ${unit}</strong>
        </div>
        <div style="margin-top: 10px;">
            <strong>3. u_f0 (Ketidakpastian Deviasi Titik Nol):</strong><br>
    `;
    if (seq === 'C') {
        html += `
            Rumus: u_f0 = (|M2(0%) - M1(0%)| / 2) / &radic;3<br>
            Pembacaan UUT di titik nol: M1 = 0, M2 = 0 (setelah auto zero)<br>
            Substitusi: u_f0 = (0 / 2) / 1.73205 = <strong>${u_f0.toFixed(6)} ${unit}</strong>
        `;
    } else if (seq === 'B') {
        html += `
            Rumus: u_f0 = (max(|M2(0%)|, |M3(0%)|) / 2) / &radic;3<br>
            Substitusi: u_f0 = <strong>${u_f0.toFixed(6)} ${unit}</strong>
        `;
    } else { // Seq A
        html += `
            Rumus: u_f0 = (max(|M2(0%)-M1(0%)|, |M4(0%)-M3(0%)|, |M6(0%)-M5(0%)|) / 2) / &radic;3<br>
            Substitusi: u_f0 = <strong>${u_f0.toFixed(6)} ${unit}</strong>
        `;
    }
    html += `
        </div>
    </div>
    `;

    // Local components for active setpoint
    html += `
    <div class="detail-formula-block">
        <div class="detail-step-header">
            <span>LANGKAH 1 - Komponen Ketidakpastian Lokal pada Setpoint ${pct}%</span>
        </div>
        <div class="detail-math-explanation">
            Berikut adalah perhitungan komponen ketidakpastian yang bergantung pada hasil pengukuran spesifik setpoint:
        </div>
        <div style="margin-top: 12px;">
            <strong>1. u_h (Ketidakpastian Histeresis):</strong><br>
            Histeresis h = ${(r.h_f * cf).toFixed(6)} ${unit} (dari Tabel 1)<br>
            Rumus: u_h = (h / 2) / &radic;3<br>
            Substitusi: u_h = (${(r.h_f * cf).toFixed(6)} / 2) / 1.73205 = <strong>${(r.u_h * cf).toFixed(6)} ${unit}</strong>
        </div>
    `;
    if (seq !== 'C') {
        html += `
        <div style="margin-top: 12px;">
            <strong>2. u_b' (Ketidakpastian Repeatability / Keterulangan):</strong><br>
            b' = ${(r.b_prime_f * cf).toFixed(6)} ${unit} (dari Tabel 1)<br>
            Rumus: u_b' = (b' / 2) / &radic;3<br>
            Substitusi: u_b' = (${(r.b_prime_f * cf).toFixed(6)} / 2) / 1.73205 = <strong>${(r.u_b_prime * cf).toFixed(6)} ${unit}</strong>
        </div>
        `;
    }
    if (seq === 'A') {
        html += `
        <div style="margin-top: 12px;">
            <strong>3. u_b (Ketidakpastian Reproducibility / Kereprodusibilitasan):</strong><br>
            b = ${(r.b_f * cf).toFixed(6)} ${unit} (dari Tabel 1)<br>
            Rumus: u_b = (b / 2) / &radic;3<br>
            Substitusi: u_b = (${(r.b_f * cf).toFixed(6)} / 2) / 1.73205 = <strong>${(r.u_b * cf).toFixed(6)} ${unit}</strong>
        </div>
        `;
    }
    html += `</div>`;

    // Combined uncertainty u_c
    html += `
    <div class="detail-formula-block">
        <div class="detail-step-header">
            <span>LANGKAH 2 - Penggabungan Komponen Ketidakpastian (Combined Uncertainty - u_c)</span>
        </div>
        <div class="detail-math-explanation">
            Seluruh komponen ketidakpastian baku digabungkan menggunakan metode Root Sum Square (RSS):
        </div>
    `;
    if (seq === 'C') {
        html += `
        <div class="detail-math-formula">
            u_c = &radic;(u_std² + u_res² + u_f0² + u_h²)
        </div>
        <div class="detail-math-substitution">
            u_c = &radic;( (${u_std.toFixed(6)})² + (${u_res.toFixed(6)})² + (${u_f0.toFixed(6)})² + (${(r.u_h * cf).toFixed(6)})² )<br>
            u_c = &radic;( ${(u_std**2).toExponential(4)} + ${(u_res**2).toExponential(4)} + ${(u_f0**2).toExponential(4)} + ${((r.u_h * cf)**2).toExponential(4)} )<br>
            u_c = &radic;( ${(u_std**2 + u_res**2 + u_f0**2 + (r.u_h * cf)**2).toExponential(4)} )<br>
            u_c = <strong>${u_c.toFixed(6)} ${unit}</strong>
        </div>
        `;
    } else if (seq === 'B') {
        html += `
        <div class="detail-math-formula">
            u_c = &radic;(u_std² + u_res² + u_f0² + u_h² + u_b'²)
        </div>
        <div class="detail-math-substitution">
            u_c = &radic;( (${u_std.toFixed(6)})² + (${u_res.toFixed(6)})² + (${u_f0.toFixed(6)})² + (${(r.u_h * cf).toFixed(6)})² + (${(r.u_b_prime * cf).toFixed(6)})² )<br>
            u_c = &radic;( ${(u_std**2).toExponential(4)} + ${(u_res**2).toExponential(4)} + ${(u_f0**2).toExponential(4)} + ${((r.u_h * cf)**2).toExponential(4)} + ${((r.u_b_prime * cf)**2).toExponential(4)} )<br>
            u_c = &radic;( ${(u_std**2 + u_res**2 + u_f0**2 + (r.u_h * cf)**2 + (r.u_b_prime * cf)**2).toExponential(4)} )<br>
            u_c = <strong>${u_c.toFixed(6)} ${unit}</strong>
        </div>
        `;
    } else { // Seq A
        html += `
        <div class="detail-math-formula">
            u_c = &radic;(u_std² + u_res² + u_f0² + u_h² + u_b'² + u_b²)
        </div>
        <div class="detail-math-substitution">
            u_c = &radic;( (${u_std.toFixed(6)})² + (${u_res.toFixed(6)})² + (${u_f0.toFixed(6)})² + (${(r.u_h * cf).toFixed(6)})² + (${(r.u_b_prime * cf).toFixed(6)})² + (${(r.u_b * cf).toFixed(6)})² )<br>
            u_c = &radic;( ${(u_std**2).toExponential(4)} + ${(u_res**2).toExponential(4)} + ${(u_f0**2).toExponential(4)} + ${((r.u_h * cf)**2).toExponential(4)} + ${((r.u_b_prime * cf)**2).toExponential(4)} + ${((r.u_b * cf)**2).toExponential(4)} )<br>
            u_c = &radic;( ${(u_std**2 + u_res**2 + u_f0**2 + (r.u_h * cf)**2 + (r.u_b_prime * cf)**2 + (r.u_b * cf)**2).toExponential(4)} )<br>
            u_c = <strong>${u_c.toFixed(6)} ${unit}</strong>
        </div>
        `;
    }
    html += `</div>`;

    // Expanded uncertainty U
    html += `
    <div class="detail-formula-block">
        <div class="detail-step-header">
            <span>LANGKAH 3 - Ketidakpastian Diperluas (Expanded Uncertainty - U)</span>
        </div>
        <div class="detail-math-explanation">
            Ketidakpastian diperluas dihitung dengan mengalikan ketidakpastian gabungan u_c dengan faktor cakupan k=2 untuk tingkat kepercayaan sekitar 95%:
        </div>
        <div class="detail-math-formula">
            U = k &times; u_c (k = 2)
        </div>
        <div class="detail-math-substitution">
            U = 2 &times; ${u_c.toFixed(6)}<br>
            U = <strong>&plusmn; ${(r.U * cf).toFixed(6)} ${unit}</strong>
        </div>
    </div>
    `;

    // Decision Rule
    const totalError = Math.abs(r.dev * cf) + (r.U * cf);
    const isPass = totalError <= mpeVal;
    html += `
    <div class="detail-formula-block">
        <div class="detail-step-header">
            <span>LANGKAH 4: Evaluasi Keputusan / Kelulusan (ILAC-G8 Decision Rule)</span>
        </div>
        <div class="detail-math-explanation">
            Berdasarkan dokumen pedoman metrologi internasional ILAC-G8, instrumen dinyatakan memenuhi spesifikasi jika deviasi ditambah dengan bentangan ketidakpastian diperluas tidak melebihi Batas Toleransi/Kesalahan Maksimum yang Diijinkan (MPE):
        </div>
        <div class="detail-math-formula">
            MPE = (Tolerance% / 100) &times; Span = (${su.mpe_percent}% / 100) &times; ${span} = ${mpeVal.toFixed(6)} ${unit}
        </div>
        <div class="detail-math-explanation" style="font-weight: 700; margin-top: 10px;">
            Kriteria Kelulusan:<br>
            <span style="font-family: var(--mono);">|Deviasi| + U &le; MPE</span>
        </div>
        <div class="detail-math-substitution">
            |${(r.dev * cf).toFixed(6)}| + ${(r.U * cf).toFixed(6)} &le; ${mpeVal.toFixed(6)}<br>
            ${(Math.abs(r.dev * cf)).toFixed(6)} + ${(r.U * cf).toFixed(6)} &le; ${mpeVal.toFixed(6)}<br>
            <strong>${totalError.toFixed(6)} &le; ${mpeVal.toFixed(6)}</strong>
        </div>
        <div class="detail-math-result ${isPass ? '' : 'negative'}">
            Hasil Evaluasi: ${isPass ? 'PASS (Memenuhi Spesifikasi)' : 'FAIL (Melebihi Batas Toleransi)'}
        </div>
    </div>
    `;

    return html;
}

try {
    if (typeof updateLiveMetrologyPreview === 'function') {
        updateLiveMetrologyPreview();
    }
} catch (e) {
    console.warn('Initial updateLiveMetrologyPreview err:', e);
}
