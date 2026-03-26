// --- Table rendering and sorting ---

let exportCsvViewId = 'dashboardView';
let exportCsvColumns = [];
let exportCsvDragStartIndex = -1;

function getSortedMinersList(miners) {
    const list = [...miners];
    list.sort((a, b) => {
        let valA = a[sortCol];
        let valB = b[sortCol];

        if (sortCol === 'ip') {
            valA = ipToNum(valA);
            valB = ipToNum(valB);
        } else if (['hashrate', 'temp'].includes(sortCol)) {
            valA = parseFloat(valA) || 0;
            valB = parseFloat(valB) || 0;
        }

        if (valA < valB) return sortAsc ? -1 : 1;
        if (valA > valB) return sortAsc ? 1 : -1;
        return 0;
    });
    return list;
}

function getFlaggedMinersList() {
    const minerByIp = new Map(minersData.map((item) => [String(item.ip || ''), item]));

    return getSortedMinersList(
        flaggedMinerIps.map((ip) => {
            const miner = minerByIp.get(String(ip || ''));
            if (miner) return miner;
            return {
                ip, status: 'online',
                hostname: 'N/A', mac: 'N/A', ipMode: 'N/A', os: 'N/A', osVersion: 'N/A',
                minerType: 'N/A', cbType: 'N/A', psuInfo: 'N/A', temp: 'N/A',
                fans: 'N/A', fanStatus: 'N/A', voltage: 'N/A', frequencyMHz: 'N/A',
                hashrate: 'N/A', activeHashboards: 'N/A', hashboards: 'N/A', pools: 'N/A'
            };
        })
    );
}

function csvEscape(value) {
    const text = String(value === undefined || value === null ? '' : value);
    return `"${text.replace(/"/g, '""')}"`;
}

function getExportCellValue(miner, colId) {
    if (colId === 'status') return 'Online';
    if (colId === 'hashrate') {
        const hr = String(miner.hashrate || 'N/A').trim();
        return hr && hr !== 'N/A' ? `${hr} TH/s` : 'N/A';
    }
    return String(miner[colId] || 'N/A');
}

function getExportRowsForView(viewId) {
    if (viewId === 'flaggedMinersView') return getFlaggedMinersList();
    return getSortedMinersList(minersData);
}

function openExportCsvModal(viewId = 'dashboardView') {
    exportCsvViewId = viewId;
    exportCsvColumns = getColumnsForView(viewId)
        .filter(col => col.id !== 'flag')
        .map(col => ({
            id: col.id,
            label: col.label,
            selected: Boolean(col.visible)
        }));

    renderExportCsvList();

    const modal = getEl('exportCsvModal');
    if (!modal) return;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
}

function closeExportCsvModal() {
    const modal = getEl('exportCsvModal');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
}

function renderExportCsvList() {
    const list = getEl('exportCsvList');
    if (!list) return;

    bindExportCsvListEvents(list);

    list.innerHTML = exportCsvColumns.map((col, index) => {
        const checked = col.selected ? 'checked' : '';

        return `
            <div class="export-col-item" draggable="true" data-export-col-index="${index}">
                <span class="drag-handle" aria-hidden="true">☰</span>
                <label class="export-col-toggle">
                    <input type="checkbox" data-action="toggle-export-csv-column" data-index="${index}" ${checked}>
                    <span>${escapeHtml(col.label)}</span>
                </label>
            </div>
        `;
    }).join('');

    updateExportCsvSelectedCount();
}

function updateExportCsvSelectedCount() {
    const meta = getEl('exportCsvSelectionMeta');
    if (!meta) return;
    const selectedCount = exportCsvColumns.filter(col => col.selected).length;
    meta.innerText = `${selectedCount} column${selectedCount === 1 ? '' : 's'} selected.`;
    updateExportCsvSelectAllButton();
}

function updateExportCsvSelectAllButton() {
    const btn = getEl('exportCsvSelectAllBtn');
    if (!btn) return;

    const hasColumns = exportCsvColumns.length > 0;
    const selectedCount = exportCsvColumns.filter(col => col.selected).length;
    const allSelected = hasColumns && selectedCount === exportCsvColumns.length;

    btn.innerText = allSelected ? 'Deselect All' : 'Select All';
    btn.setAttribute('aria-label', allSelected ? 'Deselect all columns' : 'Select all columns');
    btn.title = allSelected ? 'Deselect all columns' : 'Select all columns';
    btn.classList.toggle('is-deselect', allSelected);
}

function bindExportCsvListEvents(list) {
    if (list.dataset.eventsBound === 'true') return;

    list.addEventListener('dragstart', (event) => {
        const item = event.target.closest('.export-col-item[data-export-col-index]');
        if (!item) return;
        exportCsvDragStart(event, Number(item.dataset.exportColIndex));
    });

    list.addEventListener('dragover', (event) => {
        const item = event.target.closest('.export-col-item[data-export-col-index]');
        if (!item) return;
        exportCsvDragOver(event);
    });

    list.addEventListener('dragenter', (event) => {
        const item = event.target.closest('.export-col-item[data-export-col-index]');
        if (!item) return;
        exportCsvDragEnter(event, item);
    });

    list.addEventListener('dragleave', (event) => {
        const item = event.target.closest('.export-col-item[data-export-col-index]');
        if (!item) return;
        exportCsvDragLeave(event, item);
    });

    list.addEventListener('drop', (event) => {
        const item = event.target.closest('.export-col-item[data-export-col-index]');
        if (!item) return;
        exportCsvDrop(event, Number(item.dataset.exportColIndex));
    });

    list.addEventListener('dragend', (event) => {
        const item = event.target.closest('.export-col-item[data-export-col-index]');
        if (!item) return;
        exportCsvDragEnd(event);
    });

    list.dataset.eventsBound = 'true';
}

function setExportCsvColumnSelected(index, selected) {
    const idx = Number(index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= exportCsvColumns.length) return;
    exportCsvColumns[idx].selected = Boolean(selected);
    updateExportCsvSelectedCount();
}

function selectAllExportCsvColumns() {
    const allSelected = exportCsvColumns.length > 0 && exportCsvColumns.every(col => col.selected);
    exportCsvColumns.forEach((col) => {
        col.selected = !allSelected;
    });
    renderExportCsvList();
}

function exportCsvDragStart(event, index) {
    exportCsvDragStartIndex = index;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
    setTimeout(() => {
        event.target.classList.add('collapsed-slot');
        event.target.classList.add('export-col-dragging');
    }, 0);
}

function exportCsvDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
}

function exportCsvDragEnter(event, item) {
    event.preventDefault();
    item.classList.add('drag-over');
}

function exportCsvDragLeave(event, item) {
    if (!item.contains(event.relatedTarget)) {
        item.classList.remove('drag-over');
    }
}

function exportCsvDrop(event, dropIndex) {
    event.preventDefault();
    const dropTarget = event.target.closest('.export-col-item');
    if (dropTarget) dropTarget.classList.remove('drag-over');
    if (exportCsvDragStartIndex === dropIndex || exportCsvDragStartIndex < 0) return;

    const [item] = exportCsvColumns.splice(exportCsvDragStartIndex, 1);
    exportCsvColumns.splice(dropIndex, 0, item);
    renderExportCsvList();
}

function exportCsvDragEnd(event) {
    exportCsvDragStartIndex = -1;
    event.target.classList.remove('collapsed-slot');
    event.target.classList.remove('export-col-dragging');
    document.querySelectorAll('.export-col-item').forEach(el => el.classList.remove('drag-over'));
}

function confirmExportCsv() {
    const selectedColumns = exportCsvColumns.filter(col => col.selected);
    exportTableCsv(exportCsvViewId, selectedColumns);
    closeExportCsvModal();
}

function exportTableCsv(viewId = 'dashboardView', selectedColumns = null) {
    const rows = getExportRowsForView(viewId);
    const columns = Array.isArray(selectedColumns)
        ? selectedColumns
        : getColumnsForView(viewId)
            .filter(col => col.visible && col.id !== 'flag')
            .map(col => ({ id: col.id, label: col.label }));

    if (!columns.length) {
        setStatus('No visible data columns to export.', 'var(--error-color)');
        return;
    }

    const headerLine = columns.map(col => csvEscape(col.label)).join(',');
    const dataLines = rows.map((miner) => {
        return columns
            .map(col => csvEscape(getExportCellValue(miner, col.id)))
            .join(',');
    });

    const csv = [headerLine, ...dataLines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const prefix = viewId === 'flaggedMinersView' ? 'flagged-miners' : 'miners';

    link.href = url;
    link.download = `${prefix}-${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setStatus(`Exported ${rows.length} row${rows.length === 1 ? '' : 's'} to CSV.`, 'var(--success-color)');
}

function renderTableBody(bodyId, miners, viewId) {
    const tbody = getEl(bodyId);
    if (!tbody) return;

    const visibleCols = getColumnsForView(viewId).filter(c => c.visible);
    const rowsHtml = miners.map((miner) => {
        let rowHtml = '';
        const flagged = isMinerFlagged(miner.ip);
        const pendingRemoval = viewId === 'flaggedMinersView' && isFlaggedMinerPendingRemoval(miner.ip);
        const homeLocked = viewId === 'dashboardView' && flagged;
        const hasDebugPayload = Boolean(miner.hasDebugPayload || miner.data);
        const safeIp = escapeHtml(miner.ip || 'N/A');
        const safeIpHref = escapeHtml(`http://${String(miner.ip || '').trim()}`);
        const flagButtonLabel = flagged
            ? (viewId === 'flaggedMinersView' ? (pendingRemoval ? 'Remove' : 'Reviewed') : 'Flagged')
            : 'Flag';
        const flagButtonAriaLabel = viewId === 'flaggedMinersView'
            ? (pendingRemoval ? `Remove miner ${safeIp} from flagged list` : `Mark miner ${safeIp} as reviewed`)
            : `${flagged ? 'Flagged miner' : 'Flag miner'} ${safeIp}`;

        visibleCols.forEach(col => {
            if (col.id === 'flag') {
                const showDebugButton = devMode && hasDebugPayload;
                const debugButtonHtml = showDebugButton
                    ? `<button
                                type="button"
                                class="debug-json-btn"
                                data-action="open-debug-json"
                                data-ip="${escapeHtml(String(miner.ip || ''))}"
                                aria-label="Open debug JSON for miner ${safeIp}"
                            >Debug JSON</button>`
                    : '';

                rowHtml += `
                    <td class="flag-action-cell">
                        <div class="flagged-actions">
                            <button
                                type="button"
                                class="flag-toggle-btn${flagged ? ' active' : ''}${pendingRemoval ? ' pending-remove' : ''}${homeLocked ? ' home-locked' : ''}"
                                data-action="toggle-flag"
                                data-ip="${escapeHtml(String(miner.ip || ''))}"
                                data-view-id="${viewId}"
                                aria-label="${flagButtonAriaLabel}"
                            >${flagButtonLabel}</button>
                            ${debugButtonHtml}
                        </div>
                    </td>
                `;
            } else if (col.id === 'status') {
                rowHtml += `<td class="online">Online</td>`;
            } else if (col.id === 'ip') {
                rowHtml += `<td><strong><a href="${safeIpHref}" target="_blank" rel="noopener noreferrer" class="ip-link">${safeIp}</a></strong></td>`;
            } else if (col.id === 'hashrate') {
                const hr = miner.hashrate;
                const safeHashrate = hr && hr !== 'N/A' ? `${escapeHtml(hr)} TH/s` : 'N/A';
                rowHtml += `<td>${safeHashrate}</td>`;
            } else if (col.id === 'fanStatus') {
                const fanStatus = miner.fanStatus || 'N/A';
                const match = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(String(fanStatus));
                const isAlert = match && Number(match[1]) < Number(match[2]);
                rowHtml += `<td${isAlert ? ' class="fan-alert"' : ''}>${escapeHtml(fanStatus)}</td>`;
            } else {
                rowHtml += `<td>${escapeHtml(miner[col.id] || 'N/A')}</td>`;
            }
        });

        return `<tr>${rowHtml}</tr>`;
    }).join('');

    tbody.innerHTML = rowsHtml;
}

function renderTable() {
    renderTableBody('minerTableBody', getSortedMinersList(minersData), 'dashboardView');

    const flaggedMiners = getFlaggedMinersList();
    renderTableBody('flaggedMinerTableBody', flaggedMiners, 'flaggedMinersView');
}

// Sorting now happens from header arrow controls only
function setSortDirection(column, ascending) {
    if (isDraggingHeader) return;

    sortCol = column;
    sortAsc = ascending;
    renderHeaders();
    renderTable();
}
