// --- Saved IP ranges manager ---

function initSavedRangesManager() {
    const storedRanges = readStoredJson(savedRangesStorageKey, []);
    savedRanges = Array.isArray(storedRanges)
        ? storedRanges.filter(item => item && item.id && item.title && item.expression)
        : [];

    const storedSelectedIds = readStoredJson(selectedRangeIdsStorageKey, []);
    if (Array.isArray(storedSelectedIds)) {
        selectedSavedRangeIds = storedSelectedIds;
    } else {
        selectedSavedRangeIds = [];
    }

    if (!selectedSavedRangeIds.length) {
        const legacySingle = localStorage.getItem(legacySelectedRangeIdStorageKey);
        if (legacySingle) selectedSavedRangeIds = [legacySingle];
    }

    selectedSavedRangeIds = selectedSavedRangeIds.filter(id => savedRanges.some(r => r.id === id));

    renderSavedRangesList();
    updateSelectedRangesDisplay();
}

function persistSavedRanges() {
    writeStoredJson(savedRangesStorageKey, savedRanges);
    if (selectedSavedRangeIds.length > 0) {
        writeStoredJson(selectedRangeIdsStorageKey, selectedSavedRangeIds);
    } else {
        localStorage.removeItem(selectedRangeIdsStorageKey);
    }
    // Cleanup legacy single-select key
    localStorage.removeItem(legacySelectedRangeIdStorageKey);
}

function applySelectedRangesToScannerInput(showStatus = true) {
    const selectedItems = getSelectedSavedRanges();
    const combinedExpression = selectedItems.map(item => item.expression).join(',');
    const quickInput = getEl('rangeInput');
    if (!quickInput) return;

    if (quickRangeOverrideActive) {
        if (showStatus) setStatus('Quick IP Range override is active.');
        return;
    }

    if (combinedExpression) {
        suppressQuickRangeInputHandler = true;
        quickInput.value = '';
        quickInput.dataset.rangeExpression = combinedExpression;
        suppressQuickRangeInputHandler = false;
        updateRangeInfo();
        if (showStatus) setStatus(`Selected ${selectedItems.length} saved range${selectedItems.length === 1 ? '' : 's'}.`);
    } else {
        suppressQuickRangeInputHandler = true;
        quickInput.value = '';
        quickInput.dataset.rangeExpression = '';
        suppressQuickRangeInputHandler = false;
        updateRangeInfo();
        if (showStatus) setStatus('No saved ranges selected.');
    }

    updateSelectedRangesDisplay();
}

function updateSelectedRangesDisplay() {
    const indicatorButton = getEl('activeRangesSelectedBtn');
    if (!indicatorButton) return;

    const count = getSelectedSavedRanges().length;
    indicatorButton.innerText = `${count} Range${count === 1 ? '' : 's'} Selected`;
}

function saveRangeFromBuilder() {
    const titleInput = getEl('rangeTitleInput');
    if (!titleInput) return;
    const title = titleInput.value.trim();
    const built = getBuiltRangeExpression();

    if (!title) {
        setStatus('Please enter a range title.', 'var(--error-color)');
        return;
    }
    if (built.error) {
        setStatus(built.error, 'var(--error-color)');
        return;
    }

    const parsed = parseIPRangeInput(built.expression);
    if (parsed.error) {
        setStatus(parsed.error, 'var(--error-color)');
        return;
    }

    const count = totalIPsInRanges(parsed.ranges);
    const item = {
        id: Date.now().toString(36),
        title,
        expression: built.expression,
        count
    };

    savedRanges.unshift(item);
    persistSavedRanges();
    renderSavedRangesList();
    setStatus(`Saved IP range: ${title}`, 'var(--success-color)');
}

function saveQuickRangeToSavedRanges() {
    const quickInput = getEl('rangeInput');
    if (!quickInput) return;
    const expression = String(quickInput.dataset.rangeExpression || '').trim();

    if (!expression || !quickRangeOverrideActive) {
        setStatus('Enter a Quick IP Range first.', 'var(--error-color)');
        return;
    }

    const parsed = parseIPRangeInput(expression);
    if (parsed.error) {
        setStatus(parsed.error, 'var(--error-color)');
        return;
    }

    const normalizedExpression = expression.replace(/\s+/g, '');
    const alreadySaved = savedRanges.some(item => String(item.expression || '').replace(/\s+/g, '') === normalizedExpression);
    if (alreadySaved) {
        setStatus('This IP range is already saved.');
        return;
    }

    const title = 'untitled';
    const count = totalIPsInRanges(parsed.ranges);
    savedRanges.unshift({
        id: Date.now().toString(36),
        title,
        expression,
        count
    });

    persistSavedRanges();
    renderSavedRangesList();
    setStatus(`Saved IP range: ${title}`, 'var(--success-color)');
}

function clearRangeBuilderInputs() {
    const titleInput = getEl('rangeTitleInput');
    const directRangeInput = getEl('directRangeInput');
    if (titleInput) titleInput.value = '';
    if (directRangeInput) directRangeInput.value = '';
    updateRangeBuilderPreview();
}

function selectSavedRange(rangeId, checked) {
    if (!checked) {
        selectedSavedRangeIds = selectedSavedRangeIds.filter(id => id !== rangeId);
        persistSavedRanges();
        renderSavedRangesList();
        applySelectedRangesToScannerInput();
        return;
    }

    if (!selectedSavedRangeIds.includes(rangeId)) selectedSavedRangeIds.push(rangeId);
    persistSavedRanges();
    renderSavedRangesList();
    applySelectedRangesToScannerInput();
}

function editSavedRange(rangeId) {
    const item = savedRanges.find(r => r.id === rangeId);
    if (!item) return;

    const nextTitle = prompt('Edit range title:', item.title);
    if (nextTitle === null) return;
    const title = nextTitle.trim();
    if (!title) {
        setStatus('Range title cannot be empty.', 'var(--error-color)');
        return;
    }

    const nextExpression = prompt('Edit IP range expression:', item.expression);
    if (nextExpression === null) return;
    const expression = nextExpression.trim();
    const parsed = parseIPRangeInput(expression);
    if (parsed.error) {
        setStatus(parsed.error, 'var(--error-color)');
        return;
    }

    item.title = title;
    item.expression = expression;
    item.count = totalIPsInRanges(parsed.ranges);
    persistSavedRanges();
    renderSavedRangesList();

    if (selectedSavedRangeIds.includes(rangeId)) applySelectedRangesToScannerInput(false);

    setStatus(`Updated saved range: ${item.title}`, 'var(--success-color)');
}

function deleteSavedRange(rangeId) {
    savedRanges = savedRanges.filter(r => r.id !== rangeId);
    selectedSavedRangeIds = selectedSavedRangeIds.filter(id => id !== rangeId);
    persistSavedRanges();
    renderSavedRangesList();
    applySelectedRangesToScannerInput(false);
}

function renderSavedRangesList() {
    const list = getEl('savedRangesList');
    if (!list) return;

    const headerRow = `
        <div class="saved-range-row saved-range-header">
            <div>Title</div>
            <div>IP Range</div>
            <div></div>
        </div>
    `;

    if (savedRanges.length === 0) {
        list.innerHTML = `${headerRow}<div class="saved-range-row"><div class="saved-range-expression">No saved IP ranges yet.</div></div>`;
        return;
    }

    list.innerHTML = headerRow + savedRanges.map(item => `
        <div class="saved-range-row">
            <div>
                <div class="saved-range-title">${escapeHtml(item.title)}</div>
                <div class="range-inline-meta">${item.count} IP${item.count === 1 ? '' : 's'}</div>
            </div>
            <div class="saved-range-expression">${escapeHtml(item.expression)}</div>
            <div class="saved-range-actions">
                <input type="checkbox" data-action="select-saved-range" data-range-id="${item.id}" aria-label="Select ${escapeHtml(item.title)}" ${selectedSavedRangeIds.includes(item.id) ? 'checked' : ''}>
                <button type="button" class="saved-action-icon" data-action="edit-saved-range" data-range-id="${item.id}" aria-label="Edit ${escapeHtml(item.title)}" title="Edit">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 20h4l10-10-4-4L4 16v4z"></path>
                        <path d="M12 6l4 4"></path>
                    </svg>
                </button>
                <button type="button" class="saved-action-icon" data-action="delete-saved-range" data-range-id="${item.id}" aria-label="Delete ${escapeHtml(item.title)}" title="Delete">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M3 6h18"></path>
                        <path d="M8 6V4h8v2"></path>
                        <path d="M19 6l-1 14H6L5 6"></path>
                        <path d="M10 11v6"></path>
                        <path d="M14 11v6"></path>
                    </svg>
                </button>
            </div>
        </div>
    `).join('');
}
