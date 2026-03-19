// --- Table rendering and sorting ---

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
                const debugButtonHtml = hasDebugPayload
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

    const minerByIp = new Map(minersData.map((item) => [String(item.ip || ''), item]));

    const flaggedMiners = getSortedMinersList(
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
