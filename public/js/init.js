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
            case 'reset-sidebar-width':
                resetSidebarWidthSetting();
                break;
            case 'clear-cached-miners':
                clearCachedMinerData();
                break;
            case 'apply-columns':
                applyChanges();
                break;
            case 'toggle-all-columns':
                toggleAllColumnsInModal();
                break;
            case 'close-modal':
                closeModal();
                break;
            case 'export-table-csv': {
                const viewId = actionEl.dataset.viewId || 'dashboardView';
                openExportCsvModal(viewId);
                break;
            }
            case 'confirm-export-csv':
                confirmExportCsv();
                break;
            case 'select-all-export-csv':
                selectAllExportCsvColumns();
                break;
            case 'close-export-csv-modal':
                closeExportCsvModal();
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
            case 'deep-scan-flagged': {
                const ip = actionEl.dataset.ip || '';
                startFlaggedMinerDeepScan(ip);
                event.stopPropagation();
                break;
            }
            case 'load-flagged-logs': {
                const ip = actionEl.dataset.ip || '';
                fetchFlaggedMinerLogs(ip);
                event.stopPropagation();
                break;
            }
            case 'load-flagged-test-logs': {
                const ip = actionEl.dataset.ip || '';
                fetchFlaggedMinerTestLogs(ip);
                event.stopPropagation();
                break;
            }
            case 'view-flagged-review': {
                const ip = actionEl.dataset.ip || '';
                selectFlaggedReviewMiner(ip);
                event.stopPropagation();
                break;
            }
            case 'edit-saved-range': {
                const rangeId = actionEl.dataset.rangeId;
                if (rangeId) editSavedRange(rangeId);
                break;
            }
            case 'save-saved-range-edit':
                saveSavedRangeEdit();
                break;
            case 'close-saved-range-edit':
                closeSavedRangeEditModal();
                break;
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
            return;
        }

        if (target.id === 'sidebarWidthInput' || target.id === 'sidebarWidthNumberInput') {
            handleSidebarWidthInput(target.value);
        }
    });

    document.addEventListener('change', (event) => {
        const exportCsvToggle = event.target.closest('[data-action="toggle-export-csv-column"]');
        if (exportCsvToggle) {
            setExportCsvColumnSelected(exportCsvToggle.dataset.index, exportCsvToggle.checked);
            return;
        }

        const checkbox = event.target.closest('[data-action="select-saved-range"]');
        if (!checkbox) return;
        selectSavedRange(checkbox.dataset.rangeId, checkbox.checked);
    });

    // Dev mode toggle
    const devModeToggle = getEl('devModeToggle');
    if (devModeToggle) {
        devModeToggle.addEventListener('change', handleDevModeToggle);
    }

    document.addEventListener('mousedown', (event) => {
        const handle = event.target.closest('[data-action="begin-site-map-resize"]');
        if (!handle) return;
        const itemId = handle.dataset.itemId;
        if (!itemId) return;
        beginSiteMapResize(event, itemId);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        closeSavedRangeEditModal();
        closeExportCsvModal();
        clearPendingSavedRangeDelete();
        renderSavedRangesList();
        closeModal();
    });

    document.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.id === 'savedRangeEditModal') {
            closeSavedRangeEditModal();
        }
        if (target.id === 'exportCsvModal') {
            closeExportCsvModal();
        }
        if (target.id === 'colModal') {
            closeModal();
        }
    });

    document.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;

        // IP clicks should always navigate to miner web UI.
        if (target.closest('a.ip-link')) return;

        const row = target.closest('tr.miner-data-row[data-view-id="flaggedMinersView"]');
        if (!row) return;

        // Row-only behavior: action controls keep their own handlers.
        if (target.closest('[data-action]')) return;

        const ip = String(row.dataset.ip || '').trim();
        if (!ip) return;
        selectFlaggedReviewMiner(ip);
    });

    document.body.dataset.delegatedEventsBound = 'true';
}

window.onload = () => {
    setupDelegatedEventHandlers();
    initFlaggedMiners();
    initFlaggedMinerReviewState();
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
    initSidebarWidthSetting();
    initDevModeSetting();
    renderFlaggedReviewPanel();
    // Site Map intentionally disabled for now.
};
