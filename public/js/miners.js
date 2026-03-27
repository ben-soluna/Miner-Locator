// --- Miner data: cache, flagging, clear table ---

function initFlaggedMiners() {
    const parsed = readStoredJson(flaggedMinerStorageKey, []);
    flaggedMinerIps = Array.isArray(parsed)
        ? Array.from(new Set(parsed
            .map(ip => String(ip || '').trim())
            .filter(Boolean)))
        : [];
    // Flagged miner table will render when main table renders.
}

function initFlaggedMinerReviewState() {
    const parsed = readStoredJson(flaggedMinerReviewStorageKey, {});
    flaggedMinerReviewData = parsed && typeof parsed === 'object' ? parsed : {};

    const selected = String(localStorage.getItem(selectedFlaggedReviewIpStorageKey) || '').trim();
    selectedFlaggedReviewIp = selected;

    pruneFlaggedMinerReviewState();
}

function persistFlaggedMinerReviewState() {
    writeStoredJson(flaggedMinerReviewStorageKey, flaggedMinerReviewData);
    localStorage.setItem(selectedFlaggedReviewIpStorageKey, selectedFlaggedReviewIp || '');
}

function pruneFlaggedMinerReviewState() {
    const allowed = new Set(flaggedMinerIps.map((ip) => String(ip || '').trim()).filter(Boolean));
    const next = {};

    Object.entries(flaggedMinerReviewData || {}).forEach(([ip, details]) => {
        const normalizedIp = String(ip || '').trim();
        if (!normalizedIp || !allowed.has(normalizedIp)) return;
        next[normalizedIp] = details && typeof details === 'object' ? details : {};
    });

    flaggedMinerReviewData = next;

    if (selectedFlaggedReviewIp && !allowed.has(selectedFlaggedReviewIp)) {
        selectedFlaggedReviewIp = '';
    }
}

function ensureFlaggedMinerReviewSelection() {
    const flaggedSet = new Set(flaggedMinerIps.map((ip) => String(ip || '').trim()).filter(Boolean));
    if (selectedFlaggedReviewIp && !flaggedSet.has(selectedFlaggedReviewIp)) {
        selectedFlaggedReviewIp = '';
    }
}

function getFlaggedMinerReviewEntry(ip) {
    const normalizedIp = String(ip || '').trim();
    if (!normalizedIp) return null;

    const current = flaggedMinerReviewData[normalizedIp];
    if (current && typeof current === 'object') return current;

    const nextEntry = {
        scanState: 'idle',
        lastDeepScanAt: null,
        lastLogsFetchAt: null,
        notes: 'No deep scan started yet.',
        logs: '',
        liveLogFixture: ''
    };
    flaggedMinerReviewData[normalizedIp] = nextEntry;
    return nextEntry;
}

function getMinerByIp(ip) {
    const normalizedIp = String(ip || '').trim();
    if (!normalizedIp) return null;
    return minersData.find((miner) => String(miner.ip || '').trim() === normalizedIp) || null;
}

function formatReviewTimestamp(timestamp) {
    if (!timestamp) return '--';
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '--';
    return date.toLocaleString();
}

function buildFlaggedMinerLiveLogFixture(ip, miner) {
    const normalizedIp = String(ip || '').trim() || 'unknown-ip';
    const model = String(miner?.minerType || 'Unknown Miner');
    const fanStatus = String(miner?.fanStatus || 'N/A');
    const temp = String(miner?.temp || 'N/A');
    const hashrate = String(miner?.hashrate || 'N/A');
    const lines = [];

    for (let index = 1; index <= 400; index += 1) {
        const seconds = String((index - 1) % 60).padStart(2, '0');
        const minute = String(Math.floor((index - 1) / 60)).padStart(2, '0');
        lines.push(`2026-03-26 19:${minute}:${seconds} [${normalizedIp}] preview-log-${String(index).padStart(3, '0')} model=${model} fan=${fanStatus} temp=${temp} hashrate=${hashrate}TH/s`);
    }

    return lines.join('\n');
}

function getFlaggedInlineReviewRow(ip) {
    const normalizedIp = String(ip || '').trim();
    if (!normalizedIp) return null;

    const tbody = getEl('flaggedMinerTableBody');
    if (!tbody) return null;

    const rows = tbody.querySelectorAll('.flagged-inline-review-row');
    for (const row of rows) {
        if (String(row.dataset.ip || '').trim() === normalizedIp) return row;
    }

    return null;
}

function scrollFlaggedReviewLogToBottom(ip) {
    const normalizedIp = String(ip || '').trim();
    if (!normalizedIp) return;

    window.requestAnimationFrame(() => {
        const detailRow = getFlaggedInlineReviewRow(normalizedIp);
        if (!detailRow) return;

        const logEl = detailRow.querySelector('.flagged-inline-review-log');
        if (!(logEl instanceof HTMLElement)) return;
        logEl.scrollTop = logEl.scrollHeight;
    });
}

function startFlaggedMinerDeepScan(ip) {
    const normalizedIp = String(ip || '').trim();
    if (!normalizedIp) return;

    const entry = getFlaggedMinerReviewEntry(normalizedIp);
    if (!entry) return;

    const miner = getMinerByIp(normalizedIp);
    const now = new Date();
    entry.scanState = 'complete';
    entry.lastDeepScanAt = now.getTime();
    entry.notes = 'Deep scan data prepared. Use Load Logs or Load Test Logs to populate review logs.';

    persistFlaggedMinerReviewState();
    renderTable();
    setStatus(`Deep scan completed for ${normalizedIp} (frontend preview).`, 'var(--success-color)');
}

function fetchFlaggedMinerLogs(ip) {
    const normalizedIp = String(ip || '').trim();
    if (!normalizedIp) return;

    const entry = getFlaggedMinerReviewEntry(normalizedIp);
    if (!entry) return;

    const now = new Date();
    const miner = getMinerByIp(normalizedIp);
    if (!entry.liveLogFixture) {
        entry.liveLogFixture = buildFlaggedMinerLiveLogFixture(normalizedIp, miner);
    }

    entry.lastLogsFetchAt = now.getTime();
    entry.scanState = entry.scanState === 'idle' ? 'complete' : entry.scanState;
    entry.logs = entry.liveLogFixture;
    entry.notes = 'Loaded full live log payload in inline review view.';

    persistFlaggedMinerReviewState();
    renderTable();
    scrollFlaggedReviewLogToBottom(normalizedIp);
    setStatus(`Loaded logs for ${normalizedIp} (frontend preview).`, 'var(--success-color)');
}

function fetchFlaggedMinerTestLogs(ip) {
    const normalizedIp = String(ip || '').trim();
    if (!normalizedIp) return;
    if (!devMode) return;

    const entry = getFlaggedMinerReviewEntry(normalizedIp);
    if (!entry) return;

    const now = new Date();
    const syntheticLogBlock = `[    0.000000@0] Booting Linux on physical CPU 0x0
[    0.000000@0] Linux version 4.9.113 (jenkins@nomd-nomd-fwc-bj) (gcc version 6.3.1 20170109 (Linaro GCC 6.3-2017.02) ) #1 SMP PREEMPT Mon Dec 26 17:29:52 CST 2022
[    0.000000@0] Boot CPU: AArch64 Processor [410fd034]
[    0.000000@0] earlycon: aml_uart0 at MMIO 0x00000000ff803000 (options '')
[    0.000000@0] bootconsole [aml_uart0] enabled
[    0.000000@0] efi: Getting EFI parameters from FDT:
[    0.000000@0] efi: UEFI not found.
[    0.000000@0]    07400000 - 07500000,     1024 KB, ramoops@0x07400000
[    0.000000@0] __reserved_mem_alloc_size, start:0x0000000005000000, end:0x0000000005400000, len:4 MiB
[    0.000000@0]    05000000 - 05400000,     4096 KB, linux,secmon
[    0.000000@0] __reserved_mem_alloc_size, start:0x000000003e000000, end:0x0000000040000000, len:32 MiB
[    0.000000@0] failed to allocate memory for node linux,meson-fb, size:32 MB
[    0.000000@0] cma: Reserved 16 MiB at 0x000000000f000000
[    0.000000@0] On node 0 totalpages: 65536
[    0.000000@0]   DMA zone: 1024 pages used for memmap
[    0.000000@0]   DMA zone: 0 pages reserved
[    0.000000@0]   DMA zone: 65536 pages, LIFO batch:15
[    0.000000@0] psci: probing for conduit method from DT.
[    0.000000@0] psci: PSCIv1.0 detected in firmware.
[    0.000000@0] psci: Using standard PSCI v0.2 function IDs
[    0.000000@0] psci: MIGRATE_INFO_TYPE not supported.
[    0.000000@0] psci: SMC Calling Convention v1.1
[    0.000000@0] percpu: Embedded 25 pages/cpu @ffffffc00ef53000 s64536 r8192 d29672 u102400
[    0.000000@0] pcpu-alloc: s64536 r8192 d29672 u102400 alloc=25*4096
[    0.000000@0] pcpu-alloc:

    0
    1
    2
    3 

[    0.000000@0] Detected VIPT I-cache on CPU0
[    0.000000@0] CPU features: enabling workaround for ARM erratum 845719
[    0.000000@0] Built 1 zonelists in Zone order, mobility grouping on.  Total pages: 64512
[    0.000000@0] Kernel command line: init=/init console=ttyS0,115200 no_console_suspend earlycon=aml_uart,0xff803000 ramoops.pstore_en=1 ramoops.record_size=0x8000 ramoops.console_size=0x4000 logo=,loaded,androidboot.selinux=enforcing androidboot.firstboot=1 jtag=disable androidboot.hardware=amlogic androidboot.bootloader=U-Boot 2015.01 androidboot.build.expect.baseband=N/A androidboot.serialno=1234567890 androidboot.rpmb_state=0 rootfstype=ramfs init=/sbin/init
[    0.000000@0] PID hash table entries: 1024 (order: 1, 8192 bytes)
[    0.000000@0] Dentry cache hash table entries: 32768 (order: 6, 262144 bytes)
[    0.000000@0] Inode-cache hash table entries: 16384 (order: 5, 131072 bytes)
[    0.000000@0] Memory: 211688K/262144K available (8764K kernel code, 1194K rwdata, 2424K rodata, 3648K init, 1017K bss, 29976K reserved, 20480K cma-reserved)
[    0.000000@0] Virtual kernel memory layout:
[    0.000000@0]     modules : 0xffffff8000000000 - 0xffffff8008000000   (   128 MB)
[    0.000000@0]     vmalloc : 0xffffff8008000000 - 0xffffffbebfff0000   (   250 GB)
[    0.000000@0]       .text : 0xffffff8009080000 - 0xffffff8009910000   (  8768 KB)
[    0.000000@0]     .rodata : 0xffffff8009910000 - 0xffffff8009b80000   (  2496 KB)
[    0.000000@0]       .init : 0xffffff8009b80000 - 0xffffff8009f10000   (  3648 KB)
[    0.000000@0]       .data : 0xffffff8009f10000 - 0xffffff800a03aa00   (  1195 KB)
[    0.000000@0]        .bss : 0xffffff800a03aa00 - 0xffffff800a139034   (  1018 KB)
[    0.000000@0]     fixed   : 0xffffffbefe7fb000 - 0xffffffbefec00000   (  4116 KB)
[    0.000000@0]     PCI I/O : 0xffffffbefee00000 - 0xffffffbeffe00000   (    16 MB)
[    0.000000@0]     vmemmap : 0xffffffbf00000000 - 0xffffffc000000000   (     4 GB maximum)
[    0.000000@0]               0xffffffbf00000000 - 0xffffffbf00400000   (     4 MB actual)
[    0.000000@0]     memory  : 0xffffffc000000000 - 0xffffffc010000000   (   256 MB)
[    0.000000@0] SLUB: HWalign=64, Order=0-3, MinObjects=0, CPUs=4, Nodes=1
[    0.000000@0] Preemptible hierarchical RCU implementation.
[    0.000000@0]    Build-time adjustment of leaf fanout to 64.
[    0.000000@0]    RCU restricting CPUs from NR_CPUS=8 to nr_cpu_ids=4.
[    0.000000@0] RCU: Adjusting geometry for rcu_fanout_leaf=64, nr_cpu_ids=4
[    0.000000@0] NR_IRQS:64 nr_irqs:64 0
[    0.000000@0] irq_meson_gpio: 100 to 8 gpio interrupt mux initialized
[    0.000000@0] axg_aoclkc_init: register ao clk ok!
[    0.000000@0] axg_amlogic_init_sdemmc: register amlogic sdemmc clk
[    0.000000@0] axg_amlogic_init_sdemmc: register amlogic sdemmc clk
[    0.000000@0] axg_amlogic_init_media: register meson media clk
[    0.000000@0] axg_amlogic_init_misc: register amlogic axg misc clks
[    0.000000@0] axg_amlogic_init_misc: register amlogic sdemmc clk
[    0.000000@0] axg_clkc_init initialization complete
[    0.000000@0] arm_arch_timer: Architected cp15 timer(s) running at 24.00MHz (phys).
[    0.000000@0] clocksource: arch_sys_counter: mask: 0xffffffffffffff max_cycles: 0x588fe9dc0, max_idle_ns: 440795202592 ns
[    0.000003@0] sched_clock: 56 bits at 24MHz, resolution 41ns, wraps every 4398046511097ns
[    0.008252@0] meson_bc_timer: mclk->mux_reg =ffffff800800a190,mclk->reg =ffffff800800c194
[    0.016908@0] Console: colour dummy device 80x25
[    0.021107@0] Calibrating delay loop (skipped), value calculated using timer frequency.. 48.00 BogoMIPS (lpj=96000)
[    0.031586@0] pid_max: default: 32768 minimum: 301
[    0.036437@0] thread_stack_cache_init, vmap:ffffffc00e5af600, bitmap:ffffffc00e5a3000, cache page:e5e0
[    0.045772@0] thread_stack_cache_init, allocation vm area:ffffffc00e5d94c0, addr:ffffff8020000000, size:20001000
[    0.056005@0] cpu 0, vmap_stack:[ffffffc00ef5c960-ffffffc00ef60950]
[    0.062304@0] cpu 0, irq_stack: [ffffffc00ef53060-ffffffc00ef57050]
[    0.068604@0] cpu 1, vmap_stack:[ffffffc00ef75960-ffffffc00ef79950]
[    0.074903@0] cpu 1, irq_stack: [ffffffc00ef6c060-ffffffc00ef70050]
[    0.081204@0] cpu 2, vmap_stack:[ffffffc00ef8e960-ffffffc00ef92950]
[    0.087503@0] cpu 2, irq_stack: [ffffffc00ef85060-ffffffc00ef89050]
[    0.093804@0] cpu 3, vmap_stack:[ffffffc00efa7960-ffffffc00efab950]
[    0.100104@0] cpu 3, irq_stack: [ffffffc00ef9e060-ffffffc00efa2050]
[    0.106465@0] Security Framework initialized
[    0.110696@0] SELinux:  Initializing.
[    0.114386@0] SELinux:  Starting in permissive mode
[    0.114422@0] Mount-cache hash table entries: 512 (order: 0, 4096 bytes)
[    0.121107@0] Mountpoint-cache hash table entries: 512 (order: 0, 4096 bytes)
[    0.128836@0] ftrace: allocating 30061 entries in 118 pages
[    0.186540@0] sched-energy: CPU device node has no sched-energy-costs
[    0.187357@0] CPU0: update cpu_capacity 1024
[    0.191684@0] ASID allocator initialised with 32768 entries
[    0.229824@0] secmon: can't fine clear_range
[    0.230029@0] EFI services will not be available.
[    0.233295@0] Meson chip version = RevC (25:C - 23:0)
[    0.266968@1] Detected VIPT I-cache on CPU1
[    0.267028@1] CPU1: update cpu_capacity 1024
[    0.267030@1] CPU1: Booted secondary processor [410fd034]
[    0.295036@2] Detected VIPT I-cache on CPU2
[    0.295089@2] CPU2: update cpu_capacity 1024
[    0.295091@2] CPU2: Booted secondary processor [410fd034]
[    0.323101@3] Detected VIPT I-cache on CPU3
[    0.323151@3] CPU3: update cpu_capacity 1024
[    0.323154@3] CPU3: Booted secondary processor [410fd034]
[    0.323241@0] Brought up 4 CPUs
[    0.362460@0] SMP: Total of 4 processors activated.
[    0.367368@0] CPU features: detected feature: 32-bit EL0 Support
[    0.373405@0] CPU features: detected feature: Kernel page table isolation (KPTI)
[    0.383959@0] CPU: All CPU(s) started at EL2
[    0.385145@0] alternatives: patching kernel code
[    0.390445@1] addr:ffffff802007be10 is in kernel, size fix 4096->10, data:mode=0755
[    0.397672@0] devtmpfs: initialized
[    0.412693@0] DMI not present or invalid.
[    0.413085@0] clocksource: jiffies: mask: 0xffffffff max_cycles: 0xffffffff, max_idle_ns: 7645041785100000 ns
[    0.421062@0] futex hash table entries: 1024 (order: 4, 65536 bytes)
[    0.427642@0] pinctrl core: initialized pinctrl subsystem
[    0.434012@0] NET: Registered protocol family 16
[    0.457590@0] cpuidle: using governor menu
[    0.458100@0] vdso: 2 pages (1 code @ ffffff8009917000, 1 data @ ffffff8009f14000)
[    0.463703@0] hw-breakpoint: found 6 breakpoint and 2 watchpoint registers.
[    0.471106@0] DMA: preallocated 256 KiB pool for atomic allocations
[    0.477239@0] clkmsr: clkmsr: driver init
[    0.481301@0] aml_watch_point_probe, in, wp:2
[    0.486746@0] pstore: using zlib compression
[    0.490144@0] console [pstore-1] enabled
[    0.493579@0] pstore: Registered ramoops as persistent store backend
[    0.499987@0] ramoops: attached 0x100000@0x7400000, ecc: 0/0
[    0.514361@0] aml_iomap: amlogic iomap probe done
[    0.521169@0] clkmsr: msr_clk_reg0=ffffff800817e004,msr_clk_reg2=ffffff80081d100c
[    0.523099@0] clkmsr ffd18004.meson_clk_msr: failed to get msr ring reg0
[    0.612512@0] usbcore: registered new interface driver usbfs
[    0.612674@0] usbcore: registered new interface driver hub
[    0.618333@0] usbcore: registered new device driver usb
[    0.623590@0] pps_core: LinuxPPS API ver. 1 registered
[    0.628525@0] pps_core: Software ver. 5.3.6 - Copyright 2005-2007 Rodolfo Giometti <giometti@linux.it>
[    0.637913@0] PTP clock support registered
[    0.642274@0] dmi: Firmware registration failed.
[    0.647257@0] secmon: reserve_mem_size:0x300000
[    0.651291@0] secmon secmon: assigned reserved memory node linux,secmon
[    0.658133@0] secmon: get page:ffffffbf00140000, 5000
[    0.662890@0] secmon: share in base: 0xffffffc0050fe000, share out base: 0xffffffc0050ff000
[    0.671279@0] secmon: phy_in_base: 0x50fe000, phy_out_base: 0x50ff000
[    0.679151@0] NetLabel: Initializing
[    0.681330@0] NetLabel:  domain hash size = 128
[    0.685914@0] NetLabel:  protocols = UNLABELED CIPSOv4
[    0.691147@0] NetLabel:  unlabeled traffic allowed by default
[    0.697782@0] clocksource: Switched to clocksource arch_sys_counter
[    0.824620@0] VFS: Disk quotas dquot_6.6.0
[    0.824769@0] VFS: Dquot-cache hash table entries: 512 (order 0, 4096 bytes)
[    0.850849@1] NET: Registered protocol family 2
[    0.851896@1] TCP established hash table entries: 2048 (order: 2, 16384 bytes)
[    0.857141@1] TCP bind hash table entries: 2048 (order: 3, 32768 bytes)
[    0.863754@1] TCP: Hash tables configured (established 2048 bind 2048)
[    0.870329@1] UDP hash table entries: 256 (order: 1, 8192 bytes)
[    0.876298@1] UDP-Lite hash table entries: 256 (order: 1, 8192 bytes)
[    0.883045@1] NET: Registered protocol family 1
[    0.888019@1] RPC: Registered named UNIX socket transport module.
[    0.893437@1] RPC: Registered udp transport module.
[    0.898323@1] RPC: Registered tcp transport module.
[    0.903221@1] RPC: Registered tcp NFSv4.1 backchannel transport module.
[    0.912361@1] Unpacking initramfs...
[    1.412959@0] Initramfs unpacking failed: junk in compressed archive
[    1.419802@0] Freeing initrd memory: 6572K
[    1.420709@0] hw perfevents: clusterb_enabled = 0
[    1.423034@0] hw perfevents: cpumasks 0xf, 0x0
[    1.427508@0] hw perfevents: cluster A irq = 7
[    1.432082@0] hw perfevents: enabled with armv8_pmuv3 PMU driver, 7 counters available
[    1.442280@0] audit: initializing netlink subsys (disabled)
[    1.445546@0] audit: type=2000 audit(1.256:1): initialized
[    1.452893@0] workingset: timestamp_bits=62 max_order=16 bucket_order=0
[    1.476969@0] squashfs: version 4.0 (2009/01/31) Phillip Lougher
[    1.479962@0] NFS: Registering the id_resolver key type
[    1.482683@0] Key type id_resolver registered
[    1.486999@0] Key type id_legacy registered
[    1.491652@0] fuse init (API version 7.26)
[    1.496999@0] SELinux:  Registering netfilter hooks
[    1.503150@0] NET: Registered protocol family 38
[    1.503212@0] Key type asymmetric registered
[    1.506454@0] Asymmetric key parser 'x509' registered
[    1.511947@0] Block layer SCSI generic (bsg) driver version 0.4 loaded (major 248)
[    1.519155@0] io scheduler noop registered (default)
[    1.524128@0] io scheduler deadline registered
[    1.528951@0] io scheduler cfq registered
[    1.549242@2] random: fast init done
[    1.549340@2] random: crng init done
[    1.549852@0] Unable to detect cache hierarchy for CPU 0
[    1.586205@0] loop: module loaded
[    1.587720@0] zram: Added device: zram0
[    1.588113@0] mtdoops: mtd device (mtddev=name/number) must be supplied
[    1.595110@0] libphy: Fixed MDIO Bus: probed
[    1.599494@0] tun: Universal TUN/TAP device driver, 1.6
[    1.603973@0] tun: (C) 1999-2004 Max Krasnyansky <maxk@qualcomm.com>
[    1.612155@0]  ee eth reset:Addr = ffffff80081fd008
[    1.619647@0] meson6-dwmac ff3f0000.ethernet: no reset control found
[    1.621597@0] stmmac - user ID: 0x11, Synopsys ID: 0x37
[    1.626870@0]  Ring mode enabled
[    1.630104@0]  DMA HW capability register supported
[    1.634819@0]  Normal descriptors
[    1.638150@0]  RX Checksum Offload Engine supported
[    1.643044@0]    COE Type 2
[    1.645651@0]  TX Checksum insertion supported
[    1.650138@0]  Wake-Up On Lan supported
[    1.654071@0]  Enable RX Mitigation via HW Watchdog Timer
[    1.667494@0] libphy: stmmac: probed
[    1.667550@0] eth%d: PHY ID 0007c0f1 at 0 IRQ POLL (stmmac-0:00) active
[    1.674034@0] PPP generic driver version 2.4.2
[    1.676929@0] PPP BSD Compression module registered
[    1.681491@0] PPP Deflate Compression module registered
[    1.686748@0] PPP MPPE Compression module registered
[    1.691701@0] NET: Registered protocol family 24
[    1.697211@0] ehci_hcd: USB 2.0 'Enhanced' Host Controller (EHCI) Driver
[    1.703123@0] ohci_hcd: USB 1.1 'Open' Host Controller (OHCI) Driver
[    1.710157@0] usbcore: registered new interface driver cdc_acm
[    1.715342@0] cdc_acm: USB Abstract Control Model driver for USB modems and ISDN adapters
[    1.723779@0] usbcore: registered new interface driver usbserial
[    1.730449@0] mousedev: PS/2 mouse device common for all mice
[    1.735876@0] usbcore: registered new interface driver xpad
[    1.741276@2] i2c /dev entries driver
[    1.746096@2] cpu cpu0: bL_cpufreq_init: CPU 0 initialized
[    1.750322@2] arm_big_little: bL_cpufreq_register: Registered platform driver: scpi
[    1.761156@2] ff803000.serial: clock gate not found
[    1.762869@2] meson_uart ff803000.serial: ==uart0 reg addr = ffffff800830d000
[    1.770047@2] ff803000.serial: ttyS0 at MMIO 0xff803000 (irq = 13, base_baud = 1500000) is a meson_uart
[    1.784955@2] meson_uart ff803000.serial: ttyS0 use xtal(24M) 24000000 change 0 to 115200
[    1.787662@2] console [ttyS0] enabled
[    1.794883@2] bootconsole [aml_uart0] disabled
[    1.804541@3] ff804000.serial: clock gate not found
[    1.808667@3] meson_uart ff804000.serial: ==uart3 reg addr = ffffff8008321000
[    1.815767@3] ff804000.serial: ttyS3 at MMIO 0xff804000 (irq = 14, base_baud = 1500000) is a meson_uart
[    1.826158@1] meson_uart ffd24000.serial: ==uart1 reg addr = ffffff8008323000
[    1.832248@1] ffd24000.serial: ttyS1 at MMIO 0xffd24000 (irq = 25, base_baud = 1500000) is a meson_uart
[    1.842446@2] meson_uart ffd23000.serial: ==uart2 reg addr = ffffff8008325000
[    1.848750@2] ffd23000.serial: ttyS2 at MMIO 0xffd23000 (irq = 26, base_baud = 1500000) is a meson_uart
[    1.859650@0] amlogic-new-usb2 ffe09000.usb2phy: USB2 phy probe:phy_mem:0xffe09000, iomap phy_base:0xffffff8008348000
[    1.868987@0] amlogic-new-usb3 ffe09080.usb3phy: This phy has no usb port
[    1.875512@0] amlogic-new-usb3 ffe09080.usb3phy: USB3 phy probe:phy_mem:0xffe09080, iomap phy_base:0xffffff800834c080
[    1.890507@0] i2c i2c-1: of_i2c: modalias failure on /soc/aobus@ff800000/i2c@5000/mcu6350@40
[    1.894325@0] i2c i2c-1: Failed to create I2C device for /soc/aobus@ff800000/i2c@5000/mcu6350@40
[    1.906673@0] aml_dma ff63e000.aml_dma: Aml dma
[    1.909740@0] aml_aes_dma ff63e000.aml_dma:aml_aes: Aml AES_dma
[    1.914884@0] aml_sha_dma ff63e000.aml_dma:aml_sha: Aml SHA1/SHA224/SHA256 dma
[    1.921230@0] efusekeynum: 4
[    1.923564@0] efusekeyname:             mac   offset:     0   size:     6
[    1.929943@0] efusekeyname:          mac_bt   offset:     6   size:     6
[    1.936349@0] efusekeyname:        mac_wifi   offset:    12   size:     6
[    1.942760@0] efusekeyname:            usid   offset:    18   size:    16
[    1.949597@3] efuse efuse: probe OK!
[    1.955110@3] meson-mmc: mmc driver version: 3.02, 2017-05-15: New Emmc Host Controller
[    1.962334@0] meson-mmc: >>>>>>>>hostbase ffffff8008358000, dmode
[    1.967327@0] meson-mmc: actual_clock :400000, HHI_nand: 0x80
[    1.972564@0] meson-mmc: [meson_mmc_clk_set_rate_v3] after clock: 0x1000033c
[    2.017923@0] meson-mmc: meson_mmc_probe() : success!
[    2.018181@0] amlogic mtd driver init
[    2.022269@0] prase_get_dtb_nand_parameter:128,parse dts start
[    2.026999@0] bl mode descrete
[    2.029883@0] fip_copies 4
[    2.032537@0] fip_size 0x200000
[    2.035678@0] nand_clk_ctrl 0xffe07000
[    2.039409@0] prase_get_dtb_nand_parameter:234,parse dts end
[    2.045068@0] nand_clk_ctrl 0xffe07000
[    2.048798@0] nand register base ffffff80083df800, nand clock register ffffff80083e1000
[    2.057535@0] plat->aml_nand_device ffffff800a005c10
[    2.061695@0] m3_nand_probe() aml_nand_device ffffff800a005c10
[    2.067769@0] NAND device id: 2c da 90 95 6 0
[    2.071883@0] NAND device: Manufacturer ID:
[    2.075892@0]  0x2c, Chip ID: 0x2c (Micron A revision NAND 2Gib MT29F2G08-A)
[    2.082934@0] oob_fill_cnt =32 oob_size =64, bch_bytes =14
[    2.088368@0] ecc mode:6 ecc_page_num=2 eep_need_oobsize=16
[    2.093915@0] plane_num=1 writesize=0x800 ecc.size=0x200 bch_mode=1
[    2.100160@0] mtd->oobavail: 0x8
[    2.103555@0] aml_nand_init 2119: plat-name:bootloader
[    2.108479@0] Creating 1 MTD partitions on "bootloader":
[    2.113783@0] 0x000000000000-0x000000200000 : "bootloader"
[    2.122691@1] bootloader initialized ok
[    2.123028@1] plat->aml_nand_device ffffff800a005c10
[    2.128002@1] m3_nand_probe() aml_nand_device ffffff800a005c10
[    2.134142@1] NAND device id: 2c da 90 95 6 0
[    2.138126@1] NAND device: Manufacturer ID:
[    2.142202@1]  0x2c, Chip ID: 0x2c (Micron A revision NAND 2Gib MT29F2G08-A)
[    2.149233@1] oob_fill_cnt =32 oob_size =64, bch_bytes =14
[    2.154676@1] ecc mode:6 ecc_page_num=2 eep_need_oobsize=16
[    2.160216@1] plane_num=1 writesize=0x800 ecc.size=0x200 bch_mode=1
[    2.166464@1] mtd->oobavail: 0x8
[    2.169877@1] aml_nand_init 2119: plat-name:nandnormal
[    2.174811@1] bbt_start=20
[    2.177441@1] env_start=24
[    2.180155@1] key_start=32
[    2.182834@1] dtb_start=40
[    2.185501@1] ddr_start=44
[    2.188208@1] nbbt: info size=0x800 max_scan_blk=24, start_blk=20
[    2.194699@1] get_free_node 43: bitmap=0
[    2.198176@1] get_free_node 55: bitmap=1
[    2.202267@1] get_free_node 43: bitmap=1
[    2.205974@1] get_free_node 55: bitmap=3
[    2.210066@1] get_free_node 43: bitmap=3
[    2.213756@1] get_free_node 55: bitmap=7
[    2.217658@1] nbbt : phy_blk_addr=20, ec=0, phy_page_addr=0, timestamp=1
[    2.224345@1] nbbt free list:
[    2.227293@1] blockN=21, ec=-1, dirty_flag=0
[    2.231539@1] blockN=22, ec=-1, dirty_flag=0
[    2.235785@1] blockN=23, ec=-1, dirty_flag=0
[    2.240034@1] aml_nand_scan_rsv_info 1141: page_num=1
[    2.245441@1] nbbt valid addr: 280000
[    2.248702@1] aml_nand_bbt_check 1306 bbt is valid, reading.
[    2.254335@1] aml_nand_read_rsv_info:423,read nbbt info at 280000
[    2.260595@1] nenv: info size=0x10000 max_scan_blk=32, start_blk=24
[    2.267022@1] get_free_node 43: bitmap=7
[    2.270541@1] get_free_node 55: bitmap=f
[    2.274632@1] get_free_node 43: bitmap=f
[    2.278341@1] get_free_node 55: bitmap=1f
[    2.282519@1] get_free_node 43: bitmap=1f
[    2.286314@1] get_free_node 55: bitmap=3f
[    2.290491@1] get_free_node 43: bitmap=3f
[    2.294287@1] get_free_node 55: bitmap=7f
[    2.298465@1] get_free_node 43: bitmap=7f
[    2.302261@1] get_free_node 55: bitmap=ff
[    2.306438@1] get_free_node 43: bitmap=ff
[    2.310242@1] get_free_node 55: bitmap=1ff
[    2.314500@1] get_free_node 43: bitmap=1ff
[    2.318381@1] get_free_node 55: bitmap=3ff
[    2.322455@1] nenv : phy_blk_addr=24, ec=0, phy_page_addr=0, timestamp=1
[    2.329125@1] nenv free list:
[    2.332072@1] blockN=25, ec=-1, dirty_flag=0
[    2.336318@1] blockN=26, ec=-1, dirty_flag=0
[    2.340565@1] blockN=27, ec=-1, dirty_flag=0
[    2.344812@1] blockN=28, ec=-1, dirty_flag=0
[    2.349059@1] blockN=29, ec=-1, dirty_flag=0
[    2.353305@1] blockN=30, ec=-1, dirty_flag=0
[    2.357552@1] blockN=31, ec=-1, dirty_flag=0
[    2.361800@1] aml_nand_scan_rsv_info 1141: page_num=32
[    2.373161@1] nenv valid addr: 300000
[    2.373195@1] nkey: info size=0x8000 max_scan_blk=40, start_blk=32
[    2.377558@1] get_free_node 43: bitmap=3ff
[    2.381440@1] get_free_node 55: bitmap=7ff
[    2.385702@1] get_free_node 43: bitmap=7ff
[    2.389586@1] get_free_node 55: bitmap=fff
[    2.393852@1] get_free_node 43: bitmap=fff
[    2.397715@1] get_free_node 55: bitmap=1fff
[    2.402085@1] get_free_node 43: bitmap=1fff
[    2.406053@1] get_free_node 55: bitmap=3fff
[    2.410404@1] get_free_node 43: bitmap=3fff
[    2.414373@1] get_free_node 55: bitmap=7fff
[    2.418723@1] get_free_node 43: bitmap=7fff
[    2.422693@1] get_free_node 55: bitmap=ffff
[    2.427044@1] get_free_node 43: bitmap=ffff
[    2.431013@1] get_free_node 55: bitmap=1ffff
[    2.435450@1] get_free_node 43: bitmap=1ffff
[    2.439506@1] get_free_node 55: bitmap=3ffff
[    2.443753@1] nkey : phy_blk_addr=-1, ec=0, phy_page_addr=0, timestamp=0
[    2.450424@1] nkey free list:
[    2.453354@1] blockN=32, ec=-1, dirty_flag=0
[    2.457618@1] blockN=33, ec=-1, dirty_flag=0
[    2.461865@1] blockN=34, ec=-1, dirty_flag=0
[    2.466110@1] blockN=35, ec=-1, dirty_flag=0
[    2.470358@1] blockN=36, ec=-1, dirty_flag=0
[    2.474604@1] blockN=37, ec=-1, dirty_flag=0
[    2.478851@1] blockN=38, ec=-1, dirty_flag=0
[    2.483097@1] blockN=39, ec=-1, dirty_flag=0
[    2.487344@1] aml_nand_scan_rsv_info 1141: page_num=16
[    2.492458@1] nkey valid addr: fffffffffffe0000
[    2.496965@1] aml_nand_key_check 1251 NO key exist
[    2.501732@1] ndtb: info size=0x20000 max_scan_blk=44, start_blk=40
[    2.508164@1] get_free_node 43: bitmap=3ffff
[    2.512220@1] get_free_node 55: bitmap=7ffff
[    2.516845@1] get_free_node 43: bitmap=7ffff
[    2.520713@1] get_free_node 55: bitmap=fffff
[    2.525151@1] get_free_node 43: bitmap=fffff
[    2.529206@1] get_free_node 55: bitmap=1fffff
[    2.533539@1] ndtb : phy_blk_addr=41, ec=0, phy_page_addr=0, timestamp=2
[    2.540210@1] ndtb free list:
[    2.543157@1] blockN=40, ec=-1, dirty_flag=0
[    2.547404@1] blockN=42, ec=-1, dirty_flag=0
[    2.551651@1] blockN=43, ec=-1, dirty_flag=0
[    2.555898@1] aml_nand_scan_rsv_info 1141: page_num=64
[    2.573143@1] ndtb valid addr: 520000
[    2.573177@1] nddr: info size=0x20000 max_scan_blk=46, start_blk=44
[    2.577619@1] get_free_node 43: bitmap=1fffff
[    2.581772@1] get_free_node 55: bitmap=3fffff
[    2.586285@1] get_free_node 43: bitmap=3fffff
[    2.590427@1] get_free_node 55: bitmap=7fffff
[    2.594761@1] nddr : phy_blk_addr=-1, ec=0, phy_page_addr=0, timestamp=0
[    2.601431@1] nddr free list:
[    2.604379@1] blockN=44, ec=-1, dirty_flag=0
[    2.608626@1] blockN=45, ec=-1, dirty_flag=0
[    2.612873@1] aml_nand_scan_rsv_info 1141: page_num=64
[    2.617986@1] nddr valid addr: fffffffffffe0000
[    2.622492@1] aml_nand_ddr_check 1281 NO ddr exist
[    2.627262@1] tpl: off 8388608, size 8388608
[    2.758931@1] Creating 6 MTD partitions on "nandnormal":
[    2.758980@1] 0x000000800000-0x000001000000 : "tpl"
[    2.770426@1] 0x000001000000-0x000001200000 : "misc"
[    2.773515@1] 0x000001200000-0x000002200000 : "recovery"
[    2.785879@3] 0x000002200000-0x000004200000 : "boot"
[    2.804976@0] 0x000004200000-0x000004700000 : "config"
[    2.809675@0] 0x000004700000-0x000010000000 : "nvdata"
[    2.910781@0] nandnormal initialized ok
[    2.910892@0] aml_ubootenv_init: register env chardev
[    2.914397@0] aml_ubootenv_init: register env chardev OK
[    2.919471@0] amlnf_dtb_init: register dtb cdev
[    2.924192@0] amlnf_dtb_init: register dtd cdev OK
[    2.928644@0] mtd_nand_probe 267 , err = 0
[    2.933730@0] aml_vrtc rtc: rtc core: registered aml_vrtc as rtc0
[    2.939192@0] input: aml_vkeypad as /devices/platform/rtc/input/input0
[    2.946279@0] unifykey: storage in base: 0xffffffc005000000
[    2.950805@0] unifykey: storage out base: 0xffffffc005040000
[    2.956432@0] unifykey: storage block base: 0xffffffc005080000
[    2.962225@0] unifykey: probe done!
[    2.966403@0] unifykey: no efuse-version set, use default value: -1
[    2.971948@0] unifykey: key unify config unifykey-num is 6
[    2.977468@0] unifykey: key unify fact unifykey-num is 6
[    2.982683@0] unifykey: unifykey_devno: f200000
[    2.987701@3] unifykey: device unifykeys created ok
[    2.992199@3] unifykey: aml_unifykeys_init done!
[    2.997069@3] sysled: module init
[    3.000573@3] meson_wdt ffd0f0d0.watchdog: start watchdog
[    3.005330@3] meson_wdt ffd0f0d0.watchdog: creat work queue for watch dog
[    3.012803@1] meson_wdt ffd0f0d0.watchdog: AML Watchdog Timer probed done
[    3.021585@3] dmc_monitor_probe
[    3.023953@3] defendkey defendkey: Reserved memory is not enough!
[    3.028081@3] defendkey: probe of defendkey failed with error -22
[    3.034459@3] GACT probability NOT on
[    3.037715@3] Mirror/redirect action on
[    3.041568@3] u32 classifier
[    3.044386@3]     Actions configured
[    3.047954@3] Netfilter messages via NETLINK v0.30.
[    3.053224@3] nf_conntrack version 0.5.0 (2048 buckets, 8192 max)
[    3.059429@3] ctnetlink v0.93: registering with nfnetlink.
[    3.065299@3] xt_time: kernel timezone is -0000
[    3.069024@3] ipip: IPv4 and MPLS over IPv4 tunneling driver
[    3.075644@3] ip_tables: (C) 2000-2006 Netfilter Core Team
[    3.080340@3] arp_tables: arp_tables: (C) 2002 David S. Miller
[    3.085844@3] Initializing XFRM netlink socket
[    3.091352@3] NET: Registered protocol family 10
[    3.097031@3] mip6: Mobile IPv6
[    3.097938@3] ip6_tables: (C) 2000-2006 Netfilter Core Team
[    3.103843@3] sit: IPv6, IPv4 and MPLS over IPv4 tunneling driver
[    3.111858@3] NET: Registered protocol family 17
[    3.114145@3] NET: Registered protocol family 15
[    3.118741@3] bridge: filtering via arp/ip/ip6tables is no longer available by default. Update your scripts to load br_netfilter if you need this.
[    3.131891@3] l2tp_core: L2TP core driver, V2.0
[    3.136284@3] l2tp_ppp: PPPoL2TP kernel driver, V2.0
[    3.141197@3] l2tp_ip: L2TP IP encapsulation support (L2TPv3)
[    3.146952@3] l2tp_netlink: L2TP netlink interface
[    3.151741@3] l2tp_eth: L2TP ethernet pseudowire support (L2TPv3)
[    3.157838@3] l2tp_debugfs: L2TP debugfs support
[    3.162341@3] l2tp_ip6: L2TP IP encapsulation support for IPv6 (L2TPv3)
[    3.169000@3] NET: Registered protocol family 35
[    3.173946@3] Key type dns_resolver registered
[    3.178514@3] Registered swp emulation handler
[    3.182473@3] Registered cp15_barrier emulation handler
[    3.187652@3] Registered setend emulation handler
[    3.192316@3] disable EAS feature
[    3.196894@1] registered taskstats version 1
[    3.213459@3] dwc3 ff500000.dwc3: Configuration mismatch. dr_mode forced to host
[    3.719966@3] xhci-hcd xhci-hcd.0.auto: xHCI Host Controller
[    3.720056@3] xhci-hcd xhci-hcd.0.auto: new USB bus registered, assigned bus number 1
[    3.728351@3] xhci-hcd xhci-hcd.0.auto: hcc params 0x0220f664 hci version 0x100 quirks 0x02010010
[    3.736782@3] xhci-hcd xhci-hcd.0.auto: irq 22, io mem 0xff500000
[    3.744242@2] hub 1-0:1.0: USB hub found
[    3.746724@2] hub 1-0:1.0: 1 port detected
[    3.751331@2] xhci-hcd xhci-hcd.0.auto: xHCI Host Controller
[    3.756352@2] xhci-hcd xhci-hcd.0.auto: new USB bus registered, assigned bus number 2
[    3.764247@2] usb usb2: We don't know the algorithms for LPM for this host, disabling LPM.
[    3.773745@3] hub 2-0:1.0: USB hub found
[    3.776349@3] hub 2-0:1.0: config failed, hub doesn't have any ports! (err -19)
[    3.783632@3] usb usb2: Unsupported the hub
[    3.788392@3] aml_vrtc rtc: setting system clock to 2024-12-10 04:27:11 UTC (1733804831)
[    3.796489@3] dwc_otg ff400000.dwc2_a: dwc_otg_driver_probe(ffffffc00d17b000)
[    3.796566@3] dwc_otg: usb0: type: 2 speed: 0, config: 0, dma: 0, id: 0, phy: ffe09000, ctrl: 0
[    3.804431@3] dwc_otg ff400000.dwc2_a: base=0xffffff8008580000
[    3.804443@3] dwc_otg ff400000.dwc2_a: dwc_otg_device=0xffffffc00bbaf400
[    3.905008@3] dwc_otg: Core Release: 3.10a
[    3.905062@3] dwc_otg: Setting default values for core params
[    3.909250@3] dwc_otg: curmode: 0, host_only: 0
[    3.913754@3] dwc_otg ff400000.dwc2_a: DMA config: BURST_DEFAULT
[    3.926287@3] dwc_otg: Using Buffer DMA mode
[    3.926324@3] dwc_otg: OTG VER PARAM: 1, OTG VER FLAG: 1
[    3.930233@3] dwc_otg: Working on port type = SLAVE
[    3.935090@3] dwc_otg: Dedicated Tx FIFOs mode
[    3.942009@3] thermal thermal_zone0: binding zone soc_thermal with cdev thermal-cpufreq-0 failed:-22
[    3.948792@3] cpucore_cooling_register, max_cpu_core_num:4
[    3.961210@0] gxbb_pm: enter meson_pm_probe!
[    3.961268@0] no vddio3v3_en pin
[    3.962981@0] pm-meson aml_pm: Can't get switch_clk81
[    3.968007@0] gxbb_pm: meson_pm_probe done
[    3.972939@0] meson_uart ff803000.serial: ttyS0 use xtal(24M) 24000000 change 115200 to 115200
[    3.979337@0] Freeing unused kernel memory: 3648K
[    3.994190@0] meson_uart ff803000.serial: ttyS0 use xtal(24M) 24000000 change 115200 to 115200
[    4.245684@1] ubi0: attaching mtd5
[    4.264220@1] ubi0: scanning is finished
[    4.269025@3] ubi0: attached mtd5 (name "config", size 5 MiB)
[    4.269152@3] ubi0: PEB size: 131072 bytes (128 KiB), LEB size: 126976 bytes
[    4.276210@3] ubi0: min./max. I/O unit sizes: 2048/2048, sub-page size 2048
[    4.283128@3] ubi0: VID header offset: 2048 (aligned 2048), data offset: 4096
[    4.290223@3] ubi0: good PEBs: 40, bad PEBs: 0, corrupted PEBs: 0
[    4.296297@3] ubi0: user volume: 1, internal volumes: 1, max. volumes count: 128
[    4.303661@3] ubi0: max/mean erase counter: 3/1, WL threshold: 4096, image sequence number: 2637894120
[    4.312937@3] ubi0: available PEBs: 0, total reserved PEBs: 40, PEBs reserved for bad PEB handling: 4
[    4.322142@1] ubi0: background thread "ubi_bgt0d" started, PID 1076
[    4.335084@0] UBIFS (ubi0:0): background thread "ubifs_bgt0_0" started, PID 1080
[    4.351739@2] UBIFS (ubi0:0): recovery needed
[    4.391135@2] UBIFS (ubi0:0): recovery completed
[    4.391434@2] UBIFS (ubi0:0): UBIFS: mounted UBI device 0, volume 0, name "config_data"
[    4.398142@2] UBIFS (ubi0:0): LEB size: 126976 bytes (124 KiB), min./max. I/O unit sizes: 2048 bytes/2048 bytes
[    4.408180@2] UBIFS (ubi0:0): FS size: 2793472 bytes (2 MiB, 22 LEBs), journal size 1015809 bytes (0 MiB, 6 LEBs)
[    4.418402@2] UBIFS (ubi0:0): reserved for root: 131942 bytes (128 KiB)
[    4.424992@2] UBIFS (ubi0:0): media format: w4/r0 (latest is w4/r0), UUID 4D3C880A-58FD-4FC2-924E-DA4CD7B43DE3, small LPT model
[    4.449249@2] ubi2: attaching mtd6
[    5.121507@2] ubi2: scanning is finished
[    5.128462@3] ubi2: attached mtd6 (name "nvdata", size 185 MiB)
[    5.128764@3] ubi2: PEB size: 131072 bytes (128 KiB), LEB size: 126976 bytes
[    5.135822@3] ubi2: min./max. I/O unit sizes: 2048/2048, sub-page size 2048
[    5.142739@3] ubi2: VID header offset: 2048 (aligned 2048), data offset: 4096
[    5.149835@3] ubi2: good PEBs: 1480, bad PEBs: 0, corrupted PEBs: 0
[    5.156082@3] ubi2: user volume: 1, internal volumes: 1, max. volumes count: 128
[    5.163442@3] ubi2: max/mean erase counter: 2/1, WL threshold: 4096, image sequence number: 424805205
[    5.172635@3] ubi2: available PEBs: 0, total reserved PEBs: 1480, PEBs reserved for bad PEB handling: 4
[    5.182014@1] ubi2: background thread "ubi_bgt2d" started, PID 1087
[    5.194798@3] UBIFS (ubi2:0): background thread "ubifs_bgt2_0" started, PID 1091
[    5.211413@0] UBIFS (ubi2:0): recovery needed
[    5.269611@0] UBIFS (ubi2:0): recovery completed
[    5.269913@0] UBIFS (ubi2:0): UBIFS: mounted UBI device 2, volume 0, name "nvdata_data"
[    5.276615@0] UBIFS (ubi2:0): LEB size: 126976 bytes (124 KiB), min./max. I/O unit sizes: 2048 bytes/2048 bytes
[    5.286660@0] UBIFS (ubi2:0): FS size: 185384960 bytes (176 MiB, 1460 LEBs), journal size 9269248 bytes (8 MiB, 73 LEBs)
[    5.297490@0] UBIFS (ubi2:0): reserved for root: 4952683 bytes (4836 KiB)
[    5.304251@0] UBIFS (ubi2:0): media format: w4/r0 (latest is w4/r0), UUID 34911C95-09FC-4019-B155-86E560615777, small LPT model
[    5.587138@1] eth0: device MAC address 02:4c:a0:87:70:ca
[    5.670872@0] meson6-dwmac ff3f0000.ethernet eth0: fail to init PTP.
[    5.672144@0] IPv6: ADDRCONF(NETDEV_UP): eth0: link is not ready
[    5.917146@1] uart_trans: loading out-of-tree module taints kernel.
[    5.919590@1] register uart_trans chrdev success.
[    5.922945@1] meson_uart ff804000.serial: ttyS3 use xtal(24M) 24000000 change 0 to 9600
[    5.930536@1] tty port open success [/dev/ttyS3]!
[    5.935266@1] meson_uart ff804000.serial: ttyS3 use xtal(24M) 24000000 change 9600 to 115200
[    5.943642@1] init sucess for tty struct (246:3)  [/dev/ttyS3]
[    5.949946@1] meson_uart ffd23000.serial: ttyS2 use xtal(24M) 24000000 change 0 to 9600
[    5.957417@1] tty port open success [/dev/ttyS2]!
[    5.962084@1] meson_uart ffd23000.serial: ttyS2 use xtal(24M) 24000000 change 9600 to 115200
[    5.970470@1] init sucess for tty struct (246:2)  [/dev/ttyS2]
[    5.976660@1] meson_uart ffd24000.serial: ttyS1 use xtal(24M) 24000000 change 0 to 9600
[    5.984804@1] tty port open success [/dev/ttyS1]!
[    5.988938@1] meson_uart ffd24000.serial: ttyS1 use xtal(24M) 24000000 change 9600 to 115200
[    5.997344@1] init sucess for tty struct (246:1)  [/dev/ttyS1]
[    6.005060@0] create workqueue success!
[    7.702055@0] meson6-dwmac ff3f0000.ethernet eth0: Link is Up - 100Mbps/Full - flow control rx/tx
[    7.705350@0] IPv6: ADDRCONF(NETDEV_CHANGE): eth0: link becomes ready


===========================================Miner log===========================================
2024-12-10 04:27:18 Open miner sn file /config/sn error
2024-12-10 04:27:18 Miner compile time: Mon Dec 26 17:10:01 CST 2022 type: Antminer BHB42XXX sn :
2024-12-10 04:27:19 This is fix-freq version
2024-12-10 04:27:19 Miner compile time: Mon Dec 26 17:10:01 CST 2022 type: Antminer BHB42XXX
2024-12-10 04:27:19 commit version: f2ab6bc 2022-12-26 17:08:34, build by: jenkins 2022-12-26 17:22:17
2024-12-10 04:27:19 opt_multi_version     = 1
2024-12-10 04:27:19 opt_bitmain_ab        = 1
2024-12-10 04:27:19 mid_auto_gen          = 1
2024-12-10 04:27:19 opt_bitmain_work_mode = 0
2024-12-10 04:27:19 port 439 already exported
2024-12-10 04:27:19 port 454 already exported
2024-12-10 04:27:19 port 440 already exported
2024-12-10 04:27:19 port 455 already exported
2024-12-10 04:27:19 port 441 already exported
2024-12-10 04:27:19 port 456 already exported
2024-12-10 04:27:19 port 438 already exported
2024-12-10 04:27:19 port 453 already exported
2024-12-10 04:27:19 port 446 already exported
2024-12-10 04:27:19 port 445 already exported
2024-12-10 04:27:19 Note: front fan is power on!
2024-12-10 04:27:19 Note: rear fan is power on!
2024-12-10 04:27:19 start the http log.
2024-12-10 04:27:19 httpListenThread start ret=0
2024-12-10 04:27:19 start listen on 6060 ...
2024-12-10 04:27:19 bad chain id = 3
2024-12-10 04:27:22 bad chain id = 3
2024-12-10 04:27:24 ==========================capability start==========================
2024-12-10 04:27:24 board num = 3
2024-12-10 04:27:24 board id = 0, chain num = 1
2024-12-10 04:27:24    chain id = 0
2024-12-10 04:27:24 board id = 1, chain num = 1
2024-12-10 04:27:24    chain id = 1
2024-12-10 04:27:24 board id = 2, chain num = 1
2024-12-10 04:27:24    chain id = 2
2024-12-10 04:27:24 ==========================capability end============================
2024-12-10 04:27:24 chain num = 3
2024-12-10 04:27:24 skip loading levels for now
2024-12-10 04:27:28 load chain 0 eeprom data
2024-12-10 04:27:28 version invalid 5!=4
2024-12-10 04:27:28 version invalid 5!=4
2024-12-10 04:27:28 got nothing
2024-12-10 04:27:32 load chain 0 eeprom data
2024-12-10 04:27:32 version invalid 5!=4
2024-12-10 04:27:32 version invalid 5!=4
2024-12-10 04:27:32 got nothing
2024-12-10 04:27:35 load chain 0 eeprom data
2024-12-10 04:27:35 version invalid 5!=4
2024-12-10 04:27:35 version invalid 5!=4
2024-12-10 04:27:35 got nothing
2024-12-10 04:27:35 Data load fail for chain 0.
2024-12-10 04:27:38 load chain 1 eeprom data
2024-12-10 04:27:38 version invalid 5!=4
2024-12-10 04:27:38 version invalid 5!=4
2024-12-10 04:27:38 got nothing
2024-12-10 04:27:41 load chain 1 eeprom data
2024-12-10 04:27:41 version invalid 5!=4
2024-12-10 04:27:41 version invalid 5!=4
2024-12-10 04:27:41 got nothing
2024-12-10 04:27:44 load chain 1 eeprom data
2024-12-10 04:27:44 version invalid 5!=4
2024-12-10 04:27:44 version invalid 5!=4
2024-12-10 04:27:44 got nothing
2024-12-10 04:27:44 Data load fail for chain 1.
2024-12-10 04:27:48 load chain 2 eeprom data
2024-12-10 04:27:48 version invalid 5!=4
2024-12-10 04:27:48 version invalid 5!=4
2024-12-10 04:27:48 got nothing
2024-12-10 04:27:51 load chain 2 eeprom data
2024-12-10 04:27:51 version invalid 5!=4
2024-12-10 04:27:51 version invalid 5!=4
2024-12-10 04:27:51 got nothing
2024-12-10 04:27:54 load chain 2 eeprom data
2024-12-10 04:27:54 version invalid 5!=4
2024-12-10 04:27:54 version invalid 5!=4
2024-12-10 04:27:54 got nothing
2024-12-10 04:27:54 Data load fail for chain 2.
2024-12-10 04:27:54 Sweep error string = J7:4.
2024-12-10 04:27:54 Fixture data load failed, exit.
2024-12-10 04:27:54 get board name failed for chain:0
2024-12-10 04:27:54 ERROR_SOC_INIT: basic init failed!
2024-12-10 04:27:54 stop_mining: basic init failed!
2024-12-10 04:27:54 ****power off hashboard****
2024-12-10 04:27:55 fail to write 7
2024-12-10 04:27:55 fail to read 0:2
2024-12-10 04:27:55 fail to read 1:2
2024-12-10 04:27:55 _bitmain_pic_disable_dc_dc_common failed! read_back_data[0] = 0x00, read_back_data[1] = 0x00
2024-12-10 04:27:55 fail to write 7
2024-12-10 04:27:56 fail to read 0:2
2024-12-10 04:27:56 fail to read 1:2
2024-12-10 04:27:56 _bitmain_pic_disable_dc_dc_common failed! read_back_data[0] = 0x00, read_back_data[1] = 0x00
2024-12-10 04:27:56 fail to write 7
2024-12-10 04:27:56 fail to read 0:2
2024-12-10 04:27:56 fail to read 1:2
2024-12-10 04:27:56 _bitmain_pic_disable_dc_dc_common failed! read_back_data[0] = 0x00, read_back_data[1] = 0x00
2024-12-10 04:33:08 reload pool, need recalculate
2024-12-10 04:33:08 set_start_time_point total_tv_start_sys=361 total_tv_end_sys=362`;

    entry.lastLogsFetchAt = now.getTime();
    entry.scanState = entry.scanState === 'idle' ? 'complete' : entry.scanState;
    entry.logs = syntheticLogBlock;
    entry.notes = 'Loaded full test log payload (Developer Mode only).';

    persistFlaggedMinerReviewState();
    renderTable();
    scrollFlaggedReviewLogToBottom(normalizedIp);
    setStatus(`Loaded test logs for ${normalizedIp} (dev mode).`, 'var(--success-color)');
}

function selectFlaggedReviewMiner(ip) {
    const normalizedIp = String(ip || '').trim();
    if (!normalizedIp) return;

    if (!isMinerFlagged(normalizedIp)) {
        setStatus(`Miner ${normalizedIp} is not currently flagged.`, 'var(--error-color)');
        return;
    }

    const isCollapsingCurrent = selectedFlaggedReviewIp === normalizedIp;

    if (isCollapsingCurrent) {
        const detailRow = getFlaggedInlineReviewRow(normalizedIp);
        if (detailRow) {
            detailRow.hidden = false;
            detailRow.classList.remove('expanded');
            detailRow.classList.add('collapsing');

            window.setTimeout(() => {
                if (selectedFlaggedReviewIp !== normalizedIp) return;
                selectedFlaggedReviewIp = '';
                persistFlaggedMinerReviewState();
                renderTable();
            }, 260);
            return;
        }

        selectedFlaggedReviewIp = '';
        persistFlaggedMinerReviewState();
        renderTable();
        return;
    }

    selectedFlaggedReviewIp = normalizedIp;
    persistFlaggedMinerReviewState();
    renderTable();
}

function renderFlaggedReviewPanel() {
    pruneFlaggedMinerReviewState();
    ensureFlaggedMinerReviewSelection();
    persistFlaggedMinerReviewState();
}

function initCachedMinerData() {
    const parsed = readStoredJson(minerDataStorageKey, null);
    if (!Array.isArray(parsed)) {
        minersData = [];
        minerDataLastUpdatedAt = null;
        return;
    }

    minersData = parsed
        .filter((item) => item && typeof item === 'object' && item.ip)
        .map((item) => normalizeMinerRecord(item));

    const rawUpdatedAt = parseInt(localStorage.getItem(minerDataUpdatedAtStorageKey) || '', 10);
    minerDataLastUpdatedAt = Number.isFinite(rawUpdatedAt) ? rawUpdatedAt : null;
}

function persistCachedMinerData() {
    try {
        minerDataLastUpdatedAt = Date.now();
        writeStoredJson(minerDataStorageKey, minersData);
        localStorage.setItem(minerDataUpdatedAtStorageKey, String(minerDataLastUpdatedAt));
    } catch (_err) {
        // Ignore storage quota/write errors.
    }

    updateMinerCacheStatus();
}

function formatMinerCacheTimestamp(timestampMs) {
    if (!Number.isFinite(timestampMs)) return 'Unknown';
    return new Date(timestampMs).toLocaleString();
}

function updateMinerCacheStatus() {
    const statusEl = getEl('minerCacheStatus');
    const frontTimestampEl = getEl('lastUpdatedDisplay');

    if (!minerDataLastUpdatedAt || !minersData.length) {
        if (statusEl) statusEl.innerText = 'Cache status: No cached miner data.';
        if (frontTimestampEl) frontTimestampEl.innerText = 'Last updated: --';
        return;
    }

    const formatted = formatMinerCacheTimestamp(minerDataLastUpdatedAt);
    if (statusEl) statusEl.innerText = `Cache status: ${minersData.length} miner${minersData.length === 1 ? '' : 's'} cached. Last updated: ${formatted}.`;
    if (frontTimestampEl) frontTimestampEl.innerText = `Last updated: ${formatted}`;
}

function syncClearTableButton() {
    const clearBtn = getEl('clearTableBtn');
    if (!clearBtn) return;

    clearBtn.classList.toggle('pending-clear', pendingClearMinerTable);
    clearBtn.innerText = pendingClearMinerTable ? 'Confirm Clear' : 'Clear Table';
}

function resetClearTableButton() {
    if (!pendingClearMinerTable) return;
    pendingClearMinerTable = false;
    syncClearTableButton();
}

function handleClearTableAction() {
    if (!pendingClearMinerTable) {
        pendingClearMinerTable = true;
        syncClearTableButton();
        return;
    }

    clearMinerTable();
}

function clearMinerTable(showStatusMessage = true) {
    flushPendingScanUiUpdate(true);
    minersData = [];
    minerDataLastUpdatedAt = null;
    pendingFlaggedRemovalIps = [];
    pendingClearMinerTable = false;
    localStorage.removeItem(minerDataStorageKey);
    localStorage.removeItem(minerDataUpdatedAtStorageKey);
    updateMinerCacheStatus();
    syncClearTableButton();
    renderTable();

    if (showStatusMessage) setStatus('Cleared miner table.');
}

function scheduleScanUiUpdate() {
    if (!scanRenderRafId) {
        scanRenderRafId = requestAnimationFrame(() => {
            scanRenderRafId = null;
            renderTable();
        });
    }

    if (cachePersistTimerId) return;
    cachePersistTimerId = setTimeout(() => {
        cachePersistTimerId = null;
        persistCachedMinerData();
    }, cachePersistDebounceMs);
}

function flushPendingScanUiUpdate(forcePersist = false) {
    if (scanRenderRafId) {
        cancelAnimationFrame(scanRenderRafId);
        scanRenderRafId = null;
        renderTable();
    }

    if (cachePersistTimerId) {
        clearTimeout(cachePersistTimerId);
        cachePersistTimerId = null;
        persistCachedMinerData();
        return;
    }

    if (forcePersist) {
        persistCachedMinerData();
    }
}

function clearCachedMinerData() {
    clearMinerTable(false);
    setStatus('Cleared cached miner data.');
}

function persistFlaggedMiners() {
    writeStoredJson(flaggedMinerStorageKey, flaggedMinerIps);
}

function isMinerFlagged(ip) {
    return flaggedMinerIps.includes(String(ip || '').trim());
}

function isFlaggedMinerPendingRemoval(ip) {
    return pendingFlaggedRemovalIps.includes(String(ip || '').trim());
}

function handleFlagButtonAction(ip, viewId) {
    const normalizedIp = String(ip || '').trim();
    if (!normalizedIp) return;

    if (viewId !== 'flaggedMinersView') {
        if (!isMinerFlagged(normalizedIp)) {
            toggleFlaggedMiner(normalizedIp);
        }
        return;
    }

    if (!isMinerFlagged(normalizedIp)) {
        toggleFlaggedMiner(normalizedIp);
        return;
    }

    if (isFlaggedMinerPendingRemoval(normalizedIp)) {
        toggleFlaggedMiner(normalizedIp);
        return;
    }

    pendingFlaggedRemovalIps = [normalizedIp];
    renderTable();
}

function openMinerDebugJson(ip) {
    const normalizedIp = String(ip || '').trim();
    if (!normalizedIp) return;
    const url = `/api/scan/last?ip=${encodeURIComponent(normalizedIp)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
}

function toggleFlaggedMiner(ip) {
    const normalizedIp = String(ip || '').trim();
    if (!normalizedIp) return;

    const currentIndex = flaggedMinerIps.indexOf(normalizedIp);
    if (currentIndex >= 0) {
        flaggedMinerIps.splice(currentIndex, 1);
        delete flaggedMinerReviewData[normalizedIp];
        if (selectedFlaggedReviewIp === normalizedIp) {
            selectedFlaggedReviewIp = '';
        }
    } else {
        flaggedMinerIps.unshift(normalizedIp);
    }

    pendingFlaggedRemovalIps = pendingFlaggedRemovalIps.filter((item) => item !== normalizedIp);

    persistFlaggedMiners();
    pruneFlaggedMinerReviewState();
    persistFlaggedMinerReviewState();
    renderTable();
}
