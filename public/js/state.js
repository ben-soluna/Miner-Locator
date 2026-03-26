// --- Shared Application State & Constants ---

// SSE connection + table state
let eventSource;
let scanInProgress = false;
let minersData = [];
let sortCol = 'ip';
let sortAsc = true;
let columnDragEnabled = false;
let editModeEnabled = false;
let sidebarResizing = false;
let devMode = false;
let sidebarResizeStart = 0;
const defaultSidebarWidth = 46;
const minSidebarWidth = 46;
const maxSidebarWidth = 220;
const expandThreshold = 100;
const sidebarWidthStorageKey = 'minerLocator.sidebarWidth';

// Used to prevent sorting when finishing a drag
let isDraggingHeader = false;
let draggedHeaderId = null;
let draggedHeaderViewId = null;
let headerDropTarget = null;
const headerSnapZonePx = 18;
const headerSnapZoneRatio = 0.24;

// Per-view column configuration for table + modal
const defaultColumns = [
    { id: 'ip', label: 'IP Address', visible: true },
    { id: 'status', label: 'Status', visible: true },
    { id: 'mac', label: 'MAC Address', visible: false },
    { id: 'ipMode', label: 'IP Mode', visible: false },
    { id: 'os', label: 'OS', visible: false },
    { id: 'osVersion', label: 'OS Version', visible: false },
    { id: 'minerType', label: 'Miner Type', visible: true },
    { id: 'cbType', label: 'Ctrl Board', visible: false },
    { id: 'psuInfo', label: 'PSU Info', visible: false },
    { id: 'temp', label: 'Temp', visible: true },
    { id: 'fans', label: 'Fan Speeds', visible: false },
    { id: 'fanStatus', label: 'Fans Active', visible: false },
    { id: 'voltage', label: 'Voltage', visible: false },
    { id: 'frequencyMHz', label: 'Frequency (MHz)', visible: false },
    { id: 'hashrate', label: 'Hashrate (TH/s)', visible: true },
    { id: 'activeHashboards', label: 'Active Boards', visible: false },
    { id: 'hashboards', label: 'Hashboards', visible: true },
    { id: 'pools', label: 'Pools', visible: true },
    { id: 'flag', label: 'Flag', visible: true, lockVisible: true }
];

let homeColumns = JSON.parse(JSON.stringify(defaultColumns));
let flaggedColumns = JSON.parse(JSON.stringify(defaultColumns));

let pendingColumns = [];
let pendingColumnsViewId = 'dashboardView';
let dragStartIndex = -1;
let savedRanges = [];
let selectedSavedRangeIds = [];
let flaggedMinerIps = [];
let pendingFlaggedRemovalIps = [];
let pendingClearMinerTable = false;
let quickRangeOverrideActive = false;
let suppressQuickRangeInputHandler = false;
let siteMapItems = [];
let siteMapCounters = { building: 1, rack: 1, miner: 1 };
let activeSiteMapDrag = null;
let activeSiteMapResize = null;
let selectedSiteMapItemId = null;
let siteMapLayoutLocked = false;
let siteMapEditMode = true;
const siteMapStorageKey = 'minerLocator.siteMapLayout';
const scanConcurrencyStorageKey = 'minerLocator.scanConcurrency';
const defaultScanConcurrency = 256;
const minScanConcurrency = 1;
const maxScanConcurrency = 2000;
const flaggedMinerStorageKey = 'minerLocator.flaggedMinerIps';
const minerDataStorageKey = 'minerLocator.cachedMinersData';
const minerDataUpdatedAtStorageKey = 'minerLocator.cachedMinersDataUpdatedAt';
const savedRangesStorageKey = 'minerLocator.savedRanges';
const selectedRangeIdsStorageKey = 'minerLocator.selectedRangeIds';
const legacySelectedRangeIdStorageKey = 'minerLocator.selectedRangeId';
const cachePersistDebounceMs = 250;
let scanConcurrency = defaultScanConcurrency;
let minerDataLastUpdatedAt = null;
let scanRenderRafId = null;
let cachePersistTimerId = null;
const domCache = Object.create(null);
