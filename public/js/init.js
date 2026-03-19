// --- Application bootstrap ---

function setupDelegatedEventHandlers() {
    if (document.body.dataset.delegatedEventsBound === 'true') return;

    document.addEventListener('click', (event) => {
        const actionEl = event.target.closest('[data-action]');
        if (!actionEl) return;

        const action = actionEl.dataset.action;
        if (!action) return;

        switch (action) {
            case 'select-view': {
                const viewId = actionEl.dataset.viewId;
                if (viewId) selectView(viewId, actionEl);
                break;
            }
            case 'save-quick-range':
                saveQuickRangeToSavedRanges();
                break;
            case 'start-scan':
                startScan();
                break;
            case 'stop-scan':
                stopScan();
                break;
            case 'load-test-data':
                loadTestData();
                break;
            case 'clear-table':
                handleClearTableAction();
                break;
            case 'open-modal': {
                const viewId = actionEl.dataset.viewId;
                if (viewId) openModal(viewId);
                break;
            }
            case 'toggle-edit-mode':
                toggleEditMode();
                break;
            case 'save-range-builder':
                saveRangeFromBuilder();
                break;
            case 'clear-range-builder':
                clearRangeBuilderInputs();
                break;
            case 'reset-scan-concurrency':
                resetScanConcurrencySetting();
                break;
            case 'clear-cached-miners':
                clearCachedMinerData();
                break;
            case 'apply-columns':
                applyChanges();
                break;
            case 'close-modal':
                closeModal();
                break;
            case 'toggle-flag': {
                const ip = actionEl.dataset.ip || '';
                const viewId = actionEl.dataset.viewId || 'dashboardView';
                handleFlagButtonAction(ip, viewId);
                event.stopPropagation();
                break;
            }
            case 'open-debug-json': {
                const ip = actionEl.dataset.ip || '';
                openMinerDebugJson(ip);
                event.stopPropagation();
                break;
            }
            case 'edit-saved-range': {
                const rangeId = actionEl.dataset.rangeId;
                if (rangeId) editSavedRange(rangeId);
                break;
            }
            case 'delete-saved-range': {
                const rangeId = actionEl.dataset.rangeId;
                if (rangeId) deleteSavedRange(rangeId);
                break;
            }
            case 'toggle-site-map-expand': {
                const itemId = actionEl.dataset.itemId;
                if (itemId) toggleSiteMapExpand(itemId);
                event.stopPropagation();
                break;
            }
            case 'delete-site-map-item': {
                const itemId = actionEl.dataset.itemId;
                if (itemId) deleteSiteMapItem(itemId);
                event.stopPropagation();
                break;
            }
            default:
                break;
        }
    });

    document.addEventListener('input', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;

        if (target.id === 'directRangeInput') {
            updateRangeBuilderPreview();
            return;
        }

        if (target.id === 'scanConcurrencyInput') {
            handleScanConcurrencyInput();
        }
    });

    document.addEventListener('change', (event) => {
        const checkbox = event.target.closest('[data-action="select-saved-range"]');
        if (!checkbox) return;
        selectSavedRange(checkbox.dataset.rangeId, checkbox.checked);
    });

    document.addEventListener('mousedown', (event) => {
        const handle = event.target.closest('[data-action="begin-site-map-resize"]');
        if (!handle) return;
        const itemId = handle.dataset.itemId;
        if (!itemId) return;
        beginSiteMapResize(event, itemId);
    });

    document.body.dataset.delegatedEventsBound = 'true';
}

window.onload = () => {
    setupDelegatedEventHandlers();
    initFlaggedMiners();
    initCachedMinerData();
    updateMinerCacheStatus();
    renderHeaders();
    renderTable();
    // Validate current range input on load
    const rangeInput = getEl('rangeInput');
    if (rangeInput) rangeInput.addEventListener('input', handleQuickRangeInput);
    updateRangeInfo();
    initSavedRangesManager();
    // Auto-apply saved ranges to scanner input on app load
    applySelectedRangesToScannerInput(false);
    updateRangeBuilderPreview();
    initScanConcurrencySetting();
    initSidebarResize();
    // Site Map intentionally disabled for now.
};
