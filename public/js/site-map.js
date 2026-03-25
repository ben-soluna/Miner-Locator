// --- Site Map ---

function initSiteMap() {
    try {
        const raw = localStorage.getItem(siteMapStorageKey);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed.items)) {
                siteMapItems = parsed.items.map(item => {
                    if (!item) return item;
                    const nextItem = { ...item };
                    if (nextItem.type === 'building' || nextItem.type === 'rack') {
                        if (typeof nextItem.expanded !== 'boolean') nextItem.expanded = true;
                    }
                    if (item && item.type === 'group') {
                        return { ...nextItem, type: 'building', expanded: typeof nextItem.expanded === 'boolean' ? nextItem.expanded : true };
                    }
                    return nextItem;
                });
            }
            if (parsed.counters && typeof parsed.counters === 'object') {
                siteMapCounters.building = parsed.counters.building || parsed.counters.group || 1;
                siteMapCounters.rack = parsed.counters.rack || 1;
                siteMapCounters.miner = parsed.counters.miner || 1;
            }
            siteMapLayoutLocked = Boolean(parsed.layoutLocked);
            siteMapEditMode = !siteMapLayoutLocked;
        }
    } catch (err) {
        siteMapItems = [];
        siteMapCounters = { building: 1, rack: 1, miner: 1 };
        siteMapLayoutLocked = false;
        siteMapEditMode = true;
    }

    document.addEventListener('mousemove', onSiteMapDragMove);
    document.addEventListener('mousemove', onSiteMapResizeMove);
    document.addEventListener('mouseup', stopSiteMapDrag);
    document.addEventListener('mouseup', stopSiteMapResize);
    updateSiteMapEditControls();
    renderSiteMap();
}

function persistSiteMap() {
    localStorage.setItem(siteMapStorageKey, JSON.stringify({
        items: siteMapItems,
        counters: siteMapCounters,
        layoutLocked: siteMapLayoutLocked
    }));
}

function isSiteMapEditable() {
    return siteMapEditMode;
}

function updateSiteMapEditControls() {
    const editBtn = getEl('siteMapEditModeBtn');
    const saveBtn = getEl('siteMapSaveLayoutBtn');
    const addBuildingBtn = getEl('siteMapAddBuildingBtn');
    const addRackBtn = getEl('siteMapAddRackBtn');
    const addMinerBtn = getEl('siteMapAddMinerBtn');
    const syncBtn = getEl('siteMapSyncBtn');
    const clearBtn = getEl('siteMapClearBtn');
    const editable = isSiteMapEditable();
    if (editBtn) {
        editBtn.innerText = `Edit: ${editable ? 'On' : 'Off'}`;
        editBtn.setAttribute('aria-pressed', String(editable));
    }
    if (saveBtn) saveBtn.disabled = !siteMapItems.length;
    if (addBuildingBtn) addBuildingBtn.disabled = !editable;
    if (addRackBtn) addRackBtn.disabled = !editable;
    if (addMinerBtn) addMinerBtn.disabled = !editable;
    if (syncBtn) syncBtn.disabled = !editable;
    if (clearBtn) clearBtn.disabled = !editable;
}

function toggleSiteMapEditMode() {
    siteMapEditMode = !siteMapEditMode;
    updateSiteMapEditControls();
    updateSiteMapContextHint();
    renderSiteMap();
}

function saveSiteMapLayout() {
    siteMapLayoutLocked = true;
    siteMapEditMode = false;
    persistSiteMap();
    updateSiteMapEditControls();
    updateSiteMapContextHint('Layout saved and locked. Enable Edit Mode to make changes.');
    renderSiteMap();
}

function getSiteMapItem(itemId) {
    return siteMapItems.find(item => item.id === itemId) || null;
}

function getSiteMapChildren(parentId) {
    return siteMapItems.filter(item => item.parentId === parentId);
}

function isSiteMapItemVisible(item) {
    if (!item.parentId) return true;
    const parent = getSiteMapItem(item.parentId);
    if (!parent) return true;
    if (parent.expanded === false) return false;
    return isSiteMapItemVisible(parent);
}

function getSiteMapNodeSize(type) {
    if (type === 'building') return { width: 340, height: 220 };
    if (type === 'rack') return { width: 210, height: 120 };
    return { width: 160, height: 74 };
}

function getSiteMapNodeDimensions(item) {
    const defaults = getSiteMapNodeSize(item.type);
    return {
        width: item.width || defaults.width,
        height: item.height || defaults.height
    };
}

function getConstrainedPosition(item, desiredX, desiredY) {
    const mapCanvas = getEl('siteMapCanvas');
    if (!mapCanvas) return { x: desiredX, y: desiredY };

    const size = getSiteMapNodeDimensions(item);
    if (!item.parentId) {
        return {
            x: clamp(desiredX, 4, Math.max(4, mapCanvas.clientWidth - size.width - 4)),
            y: clamp(desiredY, 4, Math.max(4, mapCanvas.clientHeight - size.height - 4))
        };
    }

    const parent = getSiteMapItem(item.parentId);
    if (!parent) {
        return {
            x: clamp(desiredX, 4, Math.max(4, mapCanvas.clientWidth - size.width - 4)),
            y: clamp(desiredY, 4, Math.max(4, mapCanvas.clientHeight - size.height - 4))
        };
    }

    const parentSize = getSiteMapNodeDimensions(parent);
    const inset = 10;
    const minX = parent.x + inset;
    const minY = parent.y + 34;
    const maxX = parent.x + parentSize.width - size.width - inset;
    const maxY = parent.y + parentSize.height - size.height - inset;

    return {
        x: clamp(desiredX, minX, Math.max(minX, maxX)),
        y: clamp(desiredY, minY, Math.max(minY, maxY))
    };
}

function collectDescendantIds(parentId) {
    const ids = [];
    const queue = [parentId];

    while (queue.length) {
        const current = queue.shift();
        const children = siteMapItems.filter(item => item.parentId === current);
        children.forEach(child => {
            ids.push(child.id);
            queue.push(child.id);
        });
    }

    return ids;
}

function getSelectedBuilding() {
    const selected = getSiteMapItem(selectedSiteMapItemId);
    if (selected && selected.type === 'building') return selected;
    if (selected && selected.type === 'rack') return getSiteMapItem(selected.parentId);
    if (selected && selected.type === 'miner') {
        const rack = getSiteMapItem(selected.parentId);
        return rack ? getSiteMapItem(rack.parentId) : null;
    }
    return null;
}

function getSelectedRack() {
    const selected = getSiteMapItem(selectedSiteMapItemId);
    if (selected && selected.type === 'rack') return selected;
    if (selected && selected.type === 'miner') return getSiteMapItem(selected.parentId);
    return null;
}

function toggleSiteMapExpand(itemId) {
    const item = getSiteMapItem(itemId);
    if (!item || !['building', 'rack'].includes(item.type)) return;

    const nextExpanded = item.expanded === false;
    item.expanded = nextExpanded;

    // Keep hierarchy focused: one expanded building and one expanded rack branch at a time.
    if (nextExpanded && item.type === 'building') {
        siteMapItems.forEach(entry => {
            if (entry.id !== item.id && entry.type === 'building') {
                entry.expanded = false;
            }
        });
    }

    if (nextExpanded && item.type === 'rack') {
        siteMapItems.forEach(entry => {
            if (entry.id !== item.id && entry.type === 'rack' && entry.parentId === item.parentId) {
                entry.expanded = false;
            }
        });
    }

    if (item.expanded === false && selectedSiteMapItemId) {
        let cursor = getSiteMapItem(selectedSiteMapItemId);
        while (cursor) {
            if (cursor.id === item.id) {
                selectedSiteMapItemId = item.id;
                break;
            }
            cursor = cursor.parentId ? getSiteMapItem(cursor.parentId) : null;
        }
    }

    persistSiteMap();
    renderSiteMap();
}

function addSiteMapItem(type) {
    if (!isSiteMapEditable()) {
        updateSiteMapContextHint('Layout is locked. Enable Edit Mode to add items.');
        return;
    }

    const mapCanvas = getEl('siteMapCanvas');
    if (!mapCanvas) return;

    let parentId = null;
    let titlePrefix = 'B';
    let desiredX = 20 + ((siteMapItems.length % 6) * 24);
    let desiredY = 20 + ((siteMapItems.length % 6) * 24);

    if (type === 'rack') {
        const building = getSelectedBuilding();
        if (!building) {
            updateSiteMapContextHint('Select a building before adding a rack.');
            return;
        }
        parentId = building.id;
        titlePrefix = 'R';
        const children = getSiteMapChildren(building.id).filter(child => child.type === 'rack');
        desiredX = building.x + 12 + ((children.length % 2) * 110);
        desiredY = building.y + 42 + (Math.floor(children.length / 2) * 62);
    } else if (type === 'miner') {
        const rack = getSelectedRack();
        if (!rack) {
            updateSiteMapContextHint('Select a rack before adding a miner.');
            return;
        }
        parentId = rack.id;
        titlePrefix = 'M';
        const children = getSiteMapChildren(rack.id).filter(child => child.type === 'miner');
        desiredX = rack.x + 10 + ((children.length % 2) * 76);
        desiredY = rack.y + 42 + (Math.floor(children.length / 2) * 34);
    } else {
        type = 'building';
        titlePrefix = 'B';
    }

    const title = `${titlePrefix} ${siteMapCounters[type] || 1}`;
    siteMapCounters[type] = (siteMapCounters[type] || 1) + 1;
    const item = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        type,
        title,
        status: 'online',
        parentId,
        x: desiredX,
        y: desiredY
    };

    if (type === 'building' || type === 'rack') item.expanded = true;

    if (type === 'building') {
        siteMapItems.forEach(entry => {
            if (entry.type === 'building') entry.expanded = false;
        });
    }

    if (type === 'rack' && parentId) {
        siteMapItems.forEach(entry => {
            if (entry.type === 'rack' && entry.parentId === parentId) entry.expanded = false;
        });
    }

    const defaults = getSiteMapNodeSize(type);
    item.width = defaults.width;
    item.height = defaults.height;

    const constrained = getConstrainedPosition(item, desiredX, desiredY);
    item.x = constrained.x;
    item.y = constrained.y;
    siteMapItems.push(item);
    selectedSiteMapItemId = item.id;

    persistSiteMap();
    renderSiteMap();
}

function clearSiteMap() {
    if (!isSiteMapEditable()) {
        updateSiteMapContextHint('Layout is locked. Enable Edit Mode to clear.');
        return;
    }
    siteMapItems = [];
    selectedSiteMapItemId = null;
    persistSiteMap();
    updateSiteMapEditControls();
    renderSiteMap();
}

function deleteSiteMapItem(itemId) {
    if (!isSiteMapEditable()) {
        updateSiteMapContextHint('Layout is locked. Enable Edit Mode to delete.');
        return;
    }
    const idsToDelete = new Set([itemId, ...collectDescendantIds(itemId)]);
    siteMapItems = siteMapItems.filter(item => !idsToDelete.has(item.id));
    if (idsToDelete.has(selectedSiteMapItemId)) selectedSiteMapItemId = null;
    persistSiteMap();
    updateSiteMapEditControls();
    renderSiteMap();
}

function renameSiteMapItem(itemId) {
    if (!isSiteMapEditable()) {
        updateSiteMapContextHint('Layout is locked. Enable Edit Mode to rename.');
        return;
    }
    const item = siteMapItems.find(entry => entry.id === itemId);
    if (!item) return;
    const next = prompt('Rename tile:', item.title);
    if (next === null) return;
    const title = next.trim();
    if (!title) return;
    item.title = title;
    persistSiteMap();
    renderSiteMap();
}

function beginSiteMapDrag(event, itemId) {
    if (!isSiteMapEditable()) return;
    if (event.target.closest('.site-node-delete')) return;
    if (event.target.closest('.site-node-resize-handle')) return;
    if (event.target.closest('.site-node-toggle')) return;

    const item = siteMapItems.find(entry => entry.id === itemId);
    if (!item) return;

    selectedSiteMapItemId = item.id;

    activeSiteMapDrag = {
        itemId,
        startX: event.clientX,
        startY: event.clientY,
        originX: item.x,
        originY: item.y,
        childOrigins: collectDescendantIds(item.id).map(id => {
            const child = getSiteMapItem(id);
            return child ? { id: child.id, x: child.x, y: child.y } : null;
        }).filter(Boolean)
    };
    document.body.style.cursor = 'grabbing';
    event.preventDefault();
    renderSiteMap();
}

function beginSiteMapResize(event, itemId) {
    if (!isSiteMapEditable()) return;

    const item = getSiteMapItem(itemId);
    if (!item || !['building', 'rack'].includes(item.type)) return;

    const dimensions = getSiteMapNodeDimensions(item);
    activeSiteMapResize = {
        itemId,
        startX: event.clientX,
        startY: event.clientY,
        startWidth: dimensions.width,
        startHeight: dimensions.height
    };
    document.body.style.cursor = 'nwse-resize';
    event.preventDefault();
    event.stopPropagation();
}

function onSiteMapResizeMove(event) {
    if (!activeSiteMapResize) return;

    const item = getSiteMapItem(activeSiteMapResize.itemId);
    if (!item) return;

    const deltaX = event.clientX - activeSiteMapResize.startX;
    const deltaY = event.clientY - activeSiteMapResize.startY;

    let nextWidth = activeSiteMapResize.startWidth + deltaX;
    let nextHeight = activeSiteMapResize.startHeight + deltaY;

    if (item.type === 'building') {
        nextWidth = clamp(nextWidth, 260, 560);
        nextHeight = clamp(nextHeight, 170, 460);
    } else {
        nextWidth = clamp(nextWidth, 170, 320);
        nextHeight = clamp(nextHeight, 96, 260);
    }

    item.width = nextWidth;
    item.height = nextHeight;

    const constrained = getConstrainedPosition(item, item.x, item.y);
    item.x = constrained.x;
    item.y = constrained.y;

    const descendants = collectDescendantIds(item.id);
    descendants.forEach(descId => {
        const child = getSiteMapItem(descId);
        if (!child) return;
        const childConstrained = getConstrainedPosition(child, child.x, child.y);
        child.x = childConstrained.x;
        child.y = childConstrained.y;
    });

    renderSiteMap();
}

function stopSiteMapResize() {
    if (!activeSiteMapResize) return;
    activeSiteMapResize = null;
    document.body.style.cursor = '';
    persistSiteMap();
}

function onSiteMapDragMove(event) {
    if (!activeSiteMapDrag) return;

    const mapCanvas = getEl('siteMapCanvas');
    const nodeEl = document.querySelector(`[data-site-node-id="${activeSiteMapDrag.itemId}"]`);
    const item = siteMapItems.find(entry => entry.id === activeSiteMapDrag.itemId);
    if (!mapCanvas || !nodeEl || !item) return;

    const deltaX = event.clientX - activeSiteMapDrag.startX;
    const deltaY = event.clientY - activeSiteMapDrag.startY;

    const constrained = getConstrainedPosition(item, activeSiteMapDrag.originX + deltaX, activeSiteMapDrag.originY + deltaY);
    const shiftX = constrained.x - item.x;
    const shiftY = constrained.y - item.y;

    item.x = constrained.x;
    item.y = constrained.y;
    nodeEl.style.left = `${item.x}px`;
    nodeEl.style.top = `${item.y}px`;

    activeSiteMapDrag.childOrigins.forEach(childOrigin => {
        const child = getSiteMapItem(childOrigin.id);
        if (!child) return;
        const childPosition = getConstrainedPosition(child, childOrigin.x + shiftX, childOrigin.y + shiftY);
        child.x = childPosition.x;
        child.y = childPosition.y;
        const childEl = document.querySelector(`[data-site-node-id="${child.id}"]`);
        if (childEl) {
            childEl.style.left = `${child.x}px`;
            childEl.style.top = `${child.y}px`;
        }
    });
}

function stopSiteMapDrag() {
    if (!activeSiteMapDrag) return;
    activeSiteMapDrag = null;
    document.body.style.cursor = '';
    persistSiteMap();
    renderSiteMap();
}

function syncSiteMapFromMiners() {
    if (!isSiteMapEditable()) {
        updateSiteMapContextHint('Layout is locked. Enable Edit Mode to sync.');
        return;
    }

    if (!minersData.length) {
        updateSiteMapContextHint('No scanned miners');
        return;
    }

    const buckets = {};
    minersData.forEach(miner => {
        const parts = String(miner.ip || '').split('.');
        if (parts.length !== 4) return;
        const subnet = `${parts[0]}.${parts[1]}.${parts[2]}.x`;
        if (!buckets[subnet]) buckets[subnet] = [];
        buckets[subnet].push(miner);
    });

    siteMapItems = siteMapItems.filter(item => item.source !== 'scan-sync');

    const buildingId = `sync-building-${Date.now().toString(36)}`;
    const autoBuilding = {
        id: buildingId,
        type: 'building',
        title: 'B-Auto',
        status: 'online',
        x: 24, y: 24,
        width: 380, height: 240,
        expanded: true,
        source: 'scan-sync'
    };
    siteMapItems.push(autoBuilding);

    const subnets = Object.keys(buckets).sort();
    subnets.forEach((subnet, index) => {
        const rackId = `sync-rack-${Date.now().toString(36)}-${index}`;
        const col = index % 3;
        const row = Math.floor(index / 3);
        const rack = {
            id: rackId,
            type: 'rack',
            title: `R-${subnet}`,
            status: 'online',
            parentId: buildingId,
            x: 36 + (col * 104),
            y: 72 + (row * 62),
            width: 210, height: 120,
            expanded: false,
            source: 'scan-sync'
        };
        siteMapItems.push(rack);

        buckets[subnet].slice(0, 4).forEach((miner, minerIndex) => {
            siteMapItems.push({
                id: `sync-miner-${Date.now().toString(36)}-${index}-${minerIndex}`,
                type: 'miner',
                title: miner.hostname && miner.hostname !== 'N/A' ? miner.hostname : `M-${miner.ip}`,
                status: 'online',
                parentId: rackId,
                x: rack.x + 10 + ((minerIndex % 2) * 78),
                y: rack.y + 42 + (Math.floor(minerIndex / 2) * 30),
                width: 160, height: 74,
                source: 'scan-sync'
            });
        });
    });

    selectedSiteMapItemId = buildingId;

    persistSiteMap();
    updateSiteMapEditControls();
    renderSiteMap();
}

function updateSiteMapContextHint(message) {
    const hint = getEl('siteMapContextHint');
    if (!hint) return;

    if (message) {
        hint.innerText = message;
        return;
    }

    const selected = getSiteMapItem(selectedSiteMapItemId);
    if (!isSiteMapEditable()) {
        hint.innerText = siteMapLayoutLocked ? 'Locked' : 'Edit off';
        return;
    }
    if (!selected) {
        hint.innerText = 'Pick a tile';
        return;
    }
    if (selected.type === 'building') {
        hint.innerText = `Building ${selected.title}`;
        return;
    }
    if (selected.type === 'rack') {
        hint.innerText = `Rack ${selected.title}`;
        return;
    }
    hint.innerText = `Miner ${selected.title}`;
}

function renderSiteMap() {
    const canvas = getEl('siteMapCanvas');
    if (!canvas) return;

    if (!siteMapItems.length) {
        canvas.innerHTML = '<div class="site-map-empty">No layout</div>';
        updateSiteMapEditControls();
        updateSiteMapContextHint();
        return;
    }

    canvas.innerHTML = '';
    const sortWeight = { building: 1, rack: 2, miner: 3 };
    [...siteMapItems]
        .filter(item => isSiteMapItemVisible(item))
        .sort((a, b) => (sortWeight[a.type] || 99) - (sortWeight[b.type] || 99))
        .forEach(item => {
        const node = document.createElement('div');
        node.className = `site-node site-node-${item.type}${item.status === 'offline' ? ' site-node-offline' : ''}`;
        if (item.id === selectedSiteMapItemId) node.className += ' site-node-selected';
        if (isSiteMapEditable()) node.className += ' site-node-editable';
        node.setAttribute('data-site-node-id', item.id);
        node.style.left = `${item.x}px`;
        node.style.top = `${item.y}px`;

        const dimensions = getSiteMapNodeDimensions(item);
        node.style.width = `${dimensions.width}px`;
        node.style.height = `${dimensions.height}px`;

        const isExpandable = item.type === 'building' || item.type === 'rack';
        const expandedIcon = item.expanded === false ? '&#9654;' : '&#9660;';
        node.innerHTML = `
            <div class="site-node-header">
                ${isExpandable ? `<button type="button" class="site-node-toggle" data-action="toggle-site-map-expand" data-item-id="${item.id}" title="${item.expanded === false ? 'Expand' : 'Collapse'}" aria-label="${item.expanded === false ? 'Expand' : 'Collapse'}">${expandedIcon}</button>` : '<span class="site-node-spacer"></span>'}
                <span class="site-node-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
                ${isSiteMapEditable() ? `<button type="button" class="site-node-delete" data-action="delete-site-map-item" data-item-id="${item.id}" title="Delete tile" aria-label="Delete tile">x</button>` : '<span class="site-node-spacer"></span>'}
            </div>
            ${(isSiteMapEditable() && (item.type === 'building' || item.type === 'rack')) ? `<div class="site-node-resize-handle" data-action="begin-site-map-resize" data-item-id="${item.id}" title="Resize"></div>` : ''}
        `;
        if (isSiteMapEditable()) {
            node.onmousedown = (event) => beginSiteMapDrag(event, item.id);
            node.ondblclick = () => renameSiteMapItem(item.id);
        }
        node.onclick = (event) => {
            if (event.target.closest('[data-action]')) return;
            selectedSiteMapItemId = item.id;
            updateSiteMapContextHint();
            renderSiteMap();
        };
        canvas.appendChild(node);
    });

    updateSiteMapEditControls();
    updateSiteMapContextHint();
}
