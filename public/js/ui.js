// --- UI: sidebar, edit mode, view switching, scan concurrency ---

function clampScanConcurrency(value) {
    const parsed = parseInt(String(value), 10);
    if (!Number.isFinite(parsed)) return defaultScanConcurrency;
    return Math.max(minScanConcurrency, Math.min(maxScanConcurrency, parsed));
}

function clampSidebarWidth(value) {
    const parsed = parseInt(String(value), 10);
    if (!Number.isFinite(parsed)) return defaultSidebarWidth;
    return Math.max(minSidebarWidth, Math.min(maxSidebarWidth, parsed));
}

function updateScanConcurrencyHint() {
    const hint = getEl('scanConcurrencyHint');
    if (!hint) return;

    let profile = 'Balanced';
    if (scanConcurrency <= 96) profile = 'Gentle';
    else if (scanConcurrency >= 768) profile = 'Aggressive';

    hint.innerText = `Current: ${scanConcurrency} (${profile}). Higher is faster; 2000 is max and may stress network/miners.`;
}

function persistScanConcurrencySetting() {
    localStorage.setItem(scanConcurrencyStorageKey, String(scanConcurrency));
}

function updateScanConcurrencyValueDisplay() {
    const valueEl = getEl('scanConcurrencyValue');
    if (!valueEl) return;
    valueEl.innerText = String(scanConcurrency);
}

function initScanConcurrencySetting() {
    const input = getEl('scanConcurrencyInput');
    if (!input) return;

    const raw = localStorage.getItem(scanConcurrencyStorageKey);
    scanConcurrency = clampScanConcurrency(raw || defaultScanConcurrency);
    input.value = String(scanConcurrency);
    updateScanConcurrencyValueDisplay();
    updateScanConcurrencyHint();
}

function handleScanConcurrencyInput() {
    const input = getEl('scanConcurrencyInput');
    if (!input) return;

    scanConcurrency = clampScanConcurrency(input.value);
    input.value = String(scanConcurrency);
    updateScanConcurrencyValueDisplay();
    persistScanConcurrencySetting();
    updateScanConcurrencyHint();
}

function syncEditModeButtons() {
    const buttonIds = ['editModeToggleBtn', 'flaggedEditModeToggleBtn'];
    buttonIds.forEach((id) => {
        const btn = getEl(id);
        if (!btn) return;
        btn.classList.toggle('active', editModeEnabled);
        btn.setAttribute('aria-pressed', String(editModeEnabled));
        btn.innerText = editModeEnabled ? 'Edit Mode Active' : 'Edit Mode';
    });
}

function toggleEditMode() {
    editModeEnabled = !editModeEnabled;
    columnDragEnabled = editModeEnabled;
    isDraggingHeader = false;
    draggedHeaderId = null;
    syncEditModeButtons();

    if (editModeEnabled) {
        document.body.classList.add('edit-mode-active');
        disableScanButtons();
    } else {
        document.body.classList.remove('edit-mode-active');
        enableScanButtons();
    }

    renderHeaders();
}

function disableScanButtons() {
    const buttons = ['scanBtn', 'stopScanBtn', 'saveQuickRangeBtn', 'testBtn'];
    buttons.forEach(id => {
        const btn = getEl(id);
        if (btn) btn.disabled = true;
    });
    const rangeInput = getEl('rangeInput');
    if (rangeInput) rangeInput.disabled = true;
}

function enableScanButtons() {
    const rangeInput = getEl('rangeInput');
    if (rangeInput) rangeInput.disabled = false;
    updateRangeInfo();
    const testBtn = getEl('testBtn');
    if (testBtn) testBtn.disabled = false;
    const stopBtn = getEl('stopScanBtn');
    if (stopBtn && !scanInProgress) stopBtn.disabled = true;
}

function initSidebarResize() {
    loadSidebarWidth();
    const handle = getEl('sidebarResizeHandle');
    if (!handle) return;

    handle.addEventListener('mousedown', beginSidebarResize);
    document.addEventListener('mousemove', onSidebarResizeMove);
    document.addEventListener('mouseup', endSidebarResize);
}

function getCurrentSidebarWidth() {
    const fromCss = parseFloat(getCSSVariableValue('--sidebar-width'));
    if (Number.isFinite(fromCss)) return clampSidebarWidth(fromCss);
    return defaultSidebarWidth;
}

function updateSidebarWidthHint(width) {
    const hint = getEl('sidebarWidthHint');
    if (!hint) return;

    const mode = width > expandThreshold ? 'Expanded labels' : 'Icon rail';
    hint.innerText = `Current: ${Math.round(width)}px (${mode}). Labels auto-expand above ${expandThreshold}px.`;
}

function syncSidebarWidthInputs(width) {
    const slider = getEl('sidebarWidthInput');
    const numberInput = getEl('sidebarWidthNumberInput');
    const rounded = String(Math.round(width));
    if (slider) slider.value = rounded;
    if (numberInput) numberInput.value = rounded;
    updateSidebarWidthHint(width);
}

function initSidebarWidthSetting() {
    const width = getCurrentSidebarWidth();
    syncSidebarWidthInputs(width);
}

function loadSidebarWidth() {
    try {
        const stored = localStorage.getItem(sidebarWidthStorageKey);
        if (stored) {
            const width = Math.max(minSidebarWidth, Math.min(maxSidebarWidth, parseInt(stored, 10)));
            setSidebarWidth(width);
        }
    } catch (err) {
        setSidebarWidth(defaultSidebarWidth);
    }
}

function setSidebarWidth(width) {
    const clamped = clampSidebarWidth(width);
    document.documentElement.style.setProperty('--sidebar-width', clamped + 'px');
    if (clamped > expandThreshold) {
        document.body.classList.add('sidebar-expanded');
    } else {
        document.body.classList.remove('sidebar-expanded');
    }
    syncSidebarWidthInputs(clamped);
}

function persistSidebarWidth() {
    const currentWidth = getCSSVariableValue('--sidebar-width');
    if (currentWidth) {
        localStorage.setItem(sidebarWidthStorageKey, currentWidth);
    }
}

function handleSidebarWidthInput(value) {
    const width = clampSidebarWidth(value);
    setSidebarWidth(width);
    persistSidebarWidth();
}

function resetSidebarWidthSetting() {
    setSidebarWidth(defaultSidebarWidth);
    persistSidebarWidth();
}

function getCSSVariableValue(varName) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return value ? value.replace('px', '') : null;
}

function beginSidebarResize(e) {
    if (!editModeEnabled) return;
    sidebarResizing = true;
    sidebarResizeStart = e.clientX;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
}

function onSidebarResizeMove(e) {
    if (!sidebarResizing) return;
    const delta = e.clientX - sidebarResizeStart;
    const currentWidth = parseFloat(getCSSVariableValue('--sidebar-width')) || defaultSidebarWidth;
    const newWidth = Math.max(minSidebarWidth, Math.min(maxSidebarWidth, currentWidth + delta));
    setSidebarWidth(newWidth);
    sidebarResizeStart = e.clientX;
}

function endSidebarResize() {
    if (!sidebarResizing) return;
    sidebarResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    persistSidebarWidth();
}

function resetScanConcurrencySetting() {
    scanConcurrency = defaultScanConcurrency;
    const input = getEl('scanConcurrencyInput');
    if (input) input.value = String(scanConcurrency);
    updateScanConcurrencyValueDisplay();
    persistScanConcurrencySetting();
    updateScanConcurrencyHint();
}

function handleQuickRangeInput() {
    if (suppressQuickRangeInputHandler) return;

    const rangeInput = getEl('rangeInput');
    if (!rangeInput) return;
    const quickValue = rangeInput.value.trim();
    rangeInput.dataset.rangeExpression = quickValue;
    quickRangeOverrideActive = quickValue.length > 0;
    updateRangeInfo();
}

function getCurrentRangeExpression() {
    const rangeInput = getEl('rangeInput');
    const fromDataset = String(rangeInput?.dataset?.rangeExpression || '').trim();
    if (fromDataset) return fromDataset;
    return String(rangeInput?.value || '').trim();
}

function setQuickRangeInputValue(value) {
    const quickInput = getEl('rangeInput');
    if (!quickInput) return;
    suppressQuickRangeInputHandler = true;
    quickInput.value = value;
    quickInput.dataset.rangeExpression = value;
    suppressQuickRangeInputHandler = false;
}

function logDevModeDebug(stage, details = {}) {
    const timestamp = new Date().toISOString();
    console.log('[DevMode]', timestamp, stage, details);
}

function updateDeveloperUiVisibility() {
    const testBtn = getEl('testBtn');
    const testBtnExists = Boolean(testBtn);
    if (testBtn) {
        testBtn.style.display = devMode ? '' : 'none';
    }

    document.body.classList.toggle('dev-mode-enabled', devMode);
    logDevModeDebug('updateDeveloperUiVisibility', {
        devMode,
        testBtnExists,
        testBtnDisplay: testBtn ? testBtn.style.display || '(default)' : '(missing)',
        bodyHasDevClass: document.body.classList.contains('dev-mode-enabled')
    });
}

// Dev Mode toggle
function initDevModeSetting() {
    const toggle = getEl('devModeToggle');
    if (!toggle) {
        logDevModeDebug('initDevModeSetting:toggle-missing');
        return;
    }
    
    const stored = localStorage.getItem('devMode');
    devMode = stored === 'true';
    toggle.checked = devMode;
    logDevModeDebug('initDevModeSetting:applied', {
        stored,
        parsedDevMode: devMode,
        toggleChecked: toggle.checked
    });
    updateDeveloperUiVisibility();
}

function handleDevModeToggle() {
    const toggle = getEl('devModeToggle');
    if (!toggle) {
        logDevModeDebug('handleDevModeToggle:toggle-missing');
        return;
    }
    
    const previousDevMode = devMode;
    devMode = toggle.checked;
    localStorage.setItem('devMode', String(devMode));
    logDevModeDebug('handleDevModeToggle:changed', {
        previousDevMode,
        nextDevMode: devMode,
        toggleChecked: toggle.checked,
        persisted: localStorage.getItem('devMode')
    });
    updateDeveloperUiVisibility();
    renderTable();
}

// Switches between sidebar views and updates active menu state
function selectView(viewId, clickedButton) {
    if (viewId === 'siteMapView') return;
    document.querySelectorAll('.view-panel').forEach(panel => panel.classList.remove('active'));
    document.querySelectorAll('.menu-item').forEach(item => item.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
    clickedButton.classList.add('active');
}
