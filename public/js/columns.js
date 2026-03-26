// --- Column config, header drag/drop, column modal ---

function getColumnsForView(viewId) {
    return viewId === 'flaggedMinersView' ? flaggedColumns : homeColumns;
}

function setColumnsForView(viewId, nextColumns) {
    if (viewId === 'flaggedMinersView') {
        flaggedColumns = nextColumns;
        return;
    }
    homeColumns = nextColumns;
}

// --- Main Table Header Drag Logic ---
function headerDragStart(e, id, viewId) {
    if (!columnDragEnabled) {
        e.preventDefault();
        return;
    }

    isDraggingHeader = true;
    draggedHeaderId = id;
    draggedHeaderViewId = viewId;
    headerDropTarget = null;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify({ id, viewId }));
    setTimeout(() => e.target.classList.add('header-dragging'), 0);
}

function clearHeaderDropMarkers() {
    document.querySelectorAll('th.header-drop-before, th.header-drop-after').forEach(el => {
        el.classList.remove('header-drop-before', 'header-drop-after');
    });
}

function getHeaderDropPlacement(el, clientX) {
    const rect = el.getBoundingClientRect();
    const localX = clientX - rect.left;
    const snapZone = Math.min(rect.width / 2, Math.max(headerSnapZonePx, rect.width * headerSnapZoneRatio));

    if (localX <= snapZone) return 'before';
    if (localX >= rect.width - snapZone) return 'after';

    return localX < rect.width / 2 ? 'before' : 'after';
}

function headerDragOver(e, el) {
    e.preventDefault();
    if (!columnDragEnabled || !draggedHeaderId) return;

    e.dataTransfer.dropEffect = 'move';

    const targetId = el.dataset.colId;
    const targetViewId = el.dataset.viewId;
    if (!targetId || targetId === draggedHeaderId || !targetViewId || targetViewId !== draggedHeaderViewId) {
        clearHeaderDropMarkers();
        headerDropTarget = null;
        return;
    }

    const placement = getHeaderDropPlacement(el, e.clientX);
    clearHeaderDropMarkers();
    el.classList.add(placement === 'before' ? 'header-drop-before' : 'header-drop-after');
    headerDropTarget = { id: targetId, placement, viewId: targetViewId };
}

function getReorderedColumnsWithPlacement(sourceId, targetId, placement, sourceColumns) {
    const sourceIndex = sourceColumns.findIndex(c => c.id === sourceId);
    const targetIndex = sourceColumns.findIndex(c => c.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return null;

    const nextColumns = [...sourceColumns];
    const [draggedColumn] = nextColumns.splice(sourceIndex, 1);

    let insertionIndex = targetIndex;
    if (sourceIndex < targetIndex) insertionIndex -= 1;
    if (placement === 'after') insertionIndex += 1;

    insertionIndex = Math.max(0, Math.min(nextColumns.length, insertionIndex));
    nextColumns.splice(insertionIndex, 0, draggedColumn);
    return nextColumns;
}

function headerDrop(e) {
    e.preventDefault();

    if (!draggedHeaderId || !headerDropTarget) {
        clearHeaderDropMarkers();
        return;
    }

    const nextColumns = getReorderedColumnsWithPlacement(
        draggedHeaderId,
        headerDropTarget.id,
        headerDropTarget.placement,
        getColumnsForView(headerDropTarget.viewId)
    );
    clearHeaderDropMarkers();
    if (!nextColumns) return;

    setColumnsForView(headerDropTarget.viewId, nextColumns);

    renderHeaders();
    renderTable();
}

function headerDragEnd(e) {
    e.target.classList.remove('header-dragging');
    clearHeaderDropMarkers();

    // Give the browser 50ms to realize we dropped it before allowing clicks again
    // This prevents the table from accidentally sorting when you drop a column
    setTimeout(() => {
        isDraggingHeader = false;
        draggedHeaderId = null;
        draggedHeaderViewId = null;
        headerDropTarget = null;
    }, 50);
}

// --- Modal Logic ---
function openModal(viewId) {
    pendingColumnsViewId = viewId || 'dashboardView';
    pendingColumns = JSON.parse(JSON.stringify(getColumnsForView(pendingColumnsViewId)));
    getEl('applyBtn').disabled = true;
    renderModalList();
    refreshToggleAllColumnsButton();
    getEl('colModal').classList.add('is-open');
}

function closeModal() { getEl('colModal').classList.remove('is-open'); }

function applyChanges() {
    setColumnsForView(pendingColumnsViewId, JSON.parse(JSON.stringify(pendingColumns)));
    renderHeaders();
    renderTable();
    getEl('applyBtn').disabled = true;
}

function markAsChanged() { getEl('applyBtn').disabled = false; }

function areAllEditablePendingColumnsVisible() {
    const editableColumns = pendingColumns.filter((col) => !col.lockVisible);
    if (editableColumns.length === 0) return true;
    return editableColumns.every((col) => col.visible);
}

function refreshToggleAllColumnsButton() {
    const toggleBtn = getEl('toggleAllColsBtn');
    if (!toggleBtn) return;
    toggleBtn.innerText = areAllEditablePendingColumnsVisible() ? 'Deselect All' : 'Select All';
}

function setAllPendingColumnsVisible(visible) {
    let changed = false;
    pendingColumns.forEach((col) => {
        if (col.lockVisible) return;
        if (col.visible !== visible) {
            col.visible = visible;
            changed = true;
        }
    });

    if (!changed) return;
    markAsChanged();
    renderModalList();
    refreshToggleAllColumnsButton();
}

function toggleAllColumnsInModal() {
    const allVisible = areAllEditablePendingColumnsVisible();
    setAllPendingColumnsVisible(!allVisible);
}

function renderModalList() {
    const list = getEl('colList');
    if (!list) return;
    bindModalListEvents(list);
    list.innerHTML = '';
    pendingColumns.forEach((col, index) => {
        list.innerHTML += `
            <div class="col-item" draggable="true" data-col-index="${index}">
                <span class="drag-handle">☰</span>
                <input type="checkbox" data-action="toggle-col" data-col-index="${index}" ${col.visible ? 'checked' : ''} ${col.lockVisible ? 'disabled' : ''}>
                <span class="label-text">${col.label}</span>
            </div>
        `;
    });
    refreshToggleAllColumnsButton();
}

function bindModalListEvents(list) {
    if (list.dataset.eventsBound === 'true') return;

    list.addEventListener('change', (event) => {
        const checkbox = event.target.closest('input[data-action="toggle-col"]');
        if (!checkbox) return;
        const index = Number(checkbox.dataset.colIndex);
        if (!Number.isInteger(index)) return;
        toggleCol(index);
    });

    list.addEventListener('dragstart', (event) => {
        const item = event.target.closest('.col-item[data-col-index]');
        if (!item) return;
        modalDragStart(event, Number(item.dataset.colIndex));
    });

    list.addEventListener('dragover', (event) => {
        const item = event.target.closest('.col-item[data-col-index]');
        if (!item) return;
        modalDragOver(event);
    });

    list.addEventListener('dragenter', (event) => {
        const item = event.target.closest('.col-item[data-col-index]');
        if (!item) return;
        modalDragEnter(event, item);
    });

    list.addEventListener('dragleave', (event) => {
        const item = event.target.closest('.col-item[data-col-index]');
        if (!item) return;
        modalDragLeave(event, item);
    });

    list.addEventListener('drop', (event) => {
        const item = event.target.closest('.col-item[data-col-index]');
        if (!item) return;
        modalDrop(event, Number(item.dataset.colIndex));
    });

    list.addEventListener('dragend', (event) => {
        const item = event.target.closest('.col-item[data-col-index]');
        if (!item) return;
        modalDragEnd(event);
    });

    list.dataset.eventsBound = 'true';
}

function toggleCol(index) {
    if (pendingColumns[index].lockVisible) return;
    pendingColumns[index].visible = !pendingColumns[index].visible;
    markAsChanged();
}

function modalDragStart(e, index) {
    dragStartIndex = index;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index);
    setTimeout(() => { e.target.classList.add('collapsed-slot'); }, 0);
}
function modalDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
function modalDragEnter(e, el) { e.preventDefault(); el.classList.add('drag-over'); }
function modalDragLeave(e, el) { if (!el.contains(e.relatedTarget)) el.classList.remove('drag-over'); }

function modalDrop(e, dropIndex) {
    e.preventDefault();
    const dropTarget = e.target.closest('.col-item');
    if (dropTarget) dropTarget.classList.remove('drag-over');
    if (dragStartIndex === dropIndex) return;
    const item = pendingColumns.splice(dragStartIndex, 1)[0];
    pendingColumns.splice(dropIndex, 0, item);
    markAsChanged();
    renderModalList();
}

function modalDragEnd(e) {
    e.target.classList.remove('collapsed-slot');
    document.querySelectorAll('.col-item').forEach(el => el.classList.remove('drag-over'));
}

// --- Table Rendering Logic ---
function renderHeadersInto(headerRowId, viewId) {
    const headerRow = getEl(headerRowId);
    if (!headerRow) return;
    bindHeaderRowEvents(headerRow);
    headerRow.innerHTML = '';
    const columns = getColumnsForView(viewId);

    columns.filter(c => c.visible).forEach(col => {
        const draggable = columnDragEnabled ? 'true' : 'false';
        const dragClass = columnDragEnabled ? 'header-draggable' : '';
        const ascActive = sortCol === col.id && sortAsc ? 'active' : '';
        const descActive = sortCol === col.id && !sortAsc ? 'active' : '';

        if (col.id === 'flag') {
            headerRow.innerHTML += `
                <th class="header-action-cell ${dragClass}" draggable="${draggable}" data-col-id="${col.id}" data-view-id="${viewId}">
                    <span class="header-content">
                        <span class="header-label">${col.label}</span>
                    </span>
                </th>
            `;
            return;
        }

        headerRow.innerHTML += `
            <th class="${dragClass}" draggable="${draggable}" data-col-id="${col.id}" data-view-id="${viewId}">
                <span class="header-content">
                    <span class="header-label">${col.label}</span>
                    <span class="sort-controls">
                        <button class="sort-arrow-btn ${ascActive}" type="button" data-action="set-sort-direction" data-column-id="${col.id}" data-ascending="true" aria-label="Sort ${col.label} ascending">▲</button>
                        <button class="sort-arrow-btn ${descActive}" type="button" data-action="set-sort-direction" data-column-id="${col.id}" data-ascending="false" aria-label="Sort ${col.label} descending">▼</button>
                    </span>
                </span>
            </th>
        `;
    });
}

function bindHeaderRowEvents(headerRow) {
    if (headerRow.dataset.eventsBound === 'true') return;

    headerRow.addEventListener('dragstart', (event) => {
        const th = event.target.closest('th[data-col-id][data-view-id]');
        if (!th) return;
        headerDragStart(event, th.dataset.colId, th.dataset.viewId);
    });

    headerRow.addEventListener('dragover', (event) => {
        const th = event.target.closest('th[data-col-id][data-view-id]');
        if (!th) return;
        headerDragOver(event, th);
    });

    headerRow.addEventListener('drop', (event) => {
        const th = event.target.closest('th[data-col-id][data-view-id]');
        if (!th) return;
        headerDrop(event);
    });

    headerRow.addEventListener('dragend', (event) => {
        const th = event.target.closest('th[data-col-id][data-view-id]');
        if (!th) return;
        headerDragEnd(event);
    });

    headerRow.addEventListener('click', (event) => {
        const sortBtn = event.target.closest('[data-action="set-sort-direction"]');
        if (!sortBtn) return;
        event.stopPropagation();
        setSortDirection(sortBtn.dataset.columnId, sortBtn.dataset.ascending === 'true');
    });

    headerRow.dataset.eventsBound = 'true';
}

function renderHeaders() {
    renderHeadersInto('tableHeaderRow', 'dashboardView');
    renderHeadersInto('flaggedTableHeaderRow', 'flaggedMinersView');
}
