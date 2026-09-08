// ============================================================
// AppInitManager — extracted from index.html inline <script>
// Manages dashboard init, theme, card visibility, HMS,
// maintenance banners, power-off timer, and startup bootstrap.
// ============================================================

class AppInitManager {
    constructor() {
        // GridStack
        this.dashboardGrid = null;
        this._resizeTimeout = null;

        // Camera
        this.streamRetryTimeout = null;
        this.currentCameraSize = 1;
        this.pipWindow = null;

        // Status loading guard
        this.isLoading = false;

        // HMS
        this.serverDismissedHMSErrors = [];
        this.hmsStatusLoaded = false;

        // Card visibility
        this.cardVisibilitySettings = {};

        // Browser detection
        this.isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        this.isPWA = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
        this.isSafariPWA = this.isSafari && this.isPWA;
    }

    // ========================================
    // GridStack Dashboard - Drag & Drop
    // ========================================

    initGridStack() {
        // On mobile: DON'T initialize GridStack at all!
        // CSS flexbox handles the layout
        if (window.innerWidth <= 768) {
            console.log('📱 Mobile detected - GridStack DISABLED, using CSS flex layout');
            const resetBtn = document.getElementById('dashboard-reset-btn');
            const sidebarResetBtn = document.getElementById('sidebar-reset-btn');
            if (resetBtn) resetBtn.style.display = 'none';
            if (sidebarResetBtn) sidebarResetBtn.style.display = 'none';
            this.adjustGridHeightForMobile(); // Set the grid height for flexbox
            return; // STOP! No GridStack on mobile!
        }

        // ONLY on desktop: initialize GridStack
        console.log('🖥️ Desktop - GridStack init');
        const resetBtn = document.getElementById('dashboard-reset-btn');
        const sidebarResetBtn = document.getElementById('sidebar-reset-btn');
        if (resetBtn) resetBtn.style.display = 'inline-block';
        if (sidebarResetBtn) sidebarResetBtn.style.display = 'flex';

        this.dashboardGrid = GridStack.init({
            column: 12,
            cellHeight: 20,
            margin: 10,
            float: true,
            minRow: 1,
            resizable: {
                handles: 'se, sw',
                // Automatic constraint: resize only within the grid
                autoPosition: true
            },
            draggable: {
                handle: '.card-header'
            },
            animate: false,
            // Disable drag/resize on mobile
            disableDrag: window.innerWidth <= 768,
            disableResize: window.innerWidth <= 768
        });

        // Default layout if no saved layout exists
        const bambu = document.body.dataset.activePrinter !== 'klipper';
        // Bambu: zone layout (variant B). Klipper: classic layout.
        const defaultLayout = bambu ? [
            // Set up and approved by the user: camera and progress side by
            // side up top, the printer zone in full width below on the
            // left, material and drying next to it on the right.
            { "id": "camera-card-grid", "x": 0, "y": 0, "w": 6, "h": 21 },
            { "id": "progress-card-grid", "x": 6, "y": 0, "w": 6, "h": 21 },
            { "id": "printer-zone-card-grid", "x": 0, "y": 22, "w": 6, "h": 18 },
            { "id": "material-zone-card-grid", "x": 6, "y": 22, "w": 3, "h": 18 },
            { "id": "filament-drying-card-grid", "x": 9, "y": 22, "w": 3, "h": 18 }
        ] : [
            { "id": "camera-card-grid", "x": 0, "y": 0, "w": 5, "h": 14 },
            { "id": "progress-card-grid", "x": 0, "y": 15, "w": 5, "h": 16 },
            { "id": "control-card-desktop", "x": 5, "y": 0, "w": 3, "h": 14 },
            { "id": "dev-control-card-desktop", "x": 8, "y": 0, "w": 4, "h": 14 },
            { "id": "spoolman-card-grid", "x": 5, "y": 15, "w": 4, "h": 13 },
            { "id": "filament-drying-card-grid", "x": 9, "y": 15, "w": 3, "h": 17 }
        ];

        // Load saved layout from localStorage
        const savedLayout = localStorage.getItem('dashboard-layout');
        let layoutToApply = savedLayout ? JSON.parse(savedLayout) : defaultLayout;
        let hasCustomLayout = false;

        // Check the grid version: discard old layouts on a change
        // v10 = the default layout was rebuilt after the redesign. Bumping
        // it discards saved layouts once — otherwise nobody would see the
        // new default, since they already have their own arrangement saved.
        const GRID_VERSION = 10; // v1=12cols/40px, v2=broken, v3=12cols/20px, v4=12cols/20px(fixed), v5=compact layout, v6=adjusted heights
        const savedGridVersion = parseInt(localStorage.getItem('dashboard-grid-version') || '0');

        if (savedLayout && savedGridVersion >= GRID_VERSION) {
            try {
                layoutToApply = JSON.parse(savedLayout);
                hasCustomLayout = true;
                console.log('📋 Loading saved layout (v' + GRID_VERSION + '):', layoutToApply);
            } catch (e) {
                console.error('⚠️ Could not load saved layout:', e);
                layoutToApply = defaultLayout;
            }
        } else {
            // Discard the old layout and use the default
            if (savedLayout) {
                console.log('🔄 Old grid layout (v' + savedGridVersion + ') discarded, using default layout');
                localStorage.removeItem('dashboard-layout');
            } else {
                console.log('📋 No saved layout found, using default layout');
            }
            layoutToApply = defaultLayout;
        }

        // Store the grid version
        localStorage.setItem('dashboard-grid-version', String(GRID_VERSION));

        // Desktop-only code from here - mobile already returned above!
        let foundItems = 0;
        let updatedItems = 0;

        // Filter out items that don't exist in DOM (cleanup old layouts)
        const validItems = layoutToApply.filter(item => {
            const exists = document.getElementById(item.id) !== null;
            if (!exists) {
                console.warn(`⚠️ Removing invalid item from layout: ${item.id}`);
            }
            return exists;
        });

        // If items were filtered out, save the cleaned layout
        if (validItems.length !== layoutToApply.length) {
            localStorage.setItem('dashboard-layout', JSON.stringify(validItems));
            console.log(`🧹 Cleaned layout saved (${layoutToApply.length - validItems.length} invalid items removed)`);
        }

        const grid = this.dashboardGrid;

        // Cards for the other mode are hidden via CSS but still occupy
        // space in the grid — when dragging, visible cards then snap to
        // invisible blocks. So take them out of the grid entirely
        // (they stay in the DOM, the status logic needs the button IDs).
        const fremd = (document.body.dataset.activePrinter !== 'klipper')
            ? ['control-card-desktop', 'dev-control-card-desktop']
            : ['printer-zone-card-grid', 'material-zone-card-grid'];
        fremd.forEach(id => {
            const el = document.getElementById(id);
            if (el && el.gridstackNode) {
                try { grid.removeWidget(el, false); } catch (e) { /* doesn't matter */ }
            }
        });

        validItems.forEach(savedItem => {
            const el = document.getElementById(savedItem.id);
            if (el) {
                foundItems++;
                console.log(`🔄 Updating ${savedItem.id}: x=${savedItem.x}, y=${savedItem.y}, w=${savedItem.w}, h=${savedItem.h}`);
                grid.update(el, {
                    x: savedItem.x,
                    y: savedItem.y,
                    w: savedItem.w,
                    h: savedItem.h
                });
                updatedItems++;
            }
        });

        console.log(`✅ Dashboard layout loaded: ${updatedItems} items updated`);

        setTimeout(() => {
            this.adjustGridHeight();
            console.log('✅ Grid height adjusted after layout load');
        }, 100);

        // Save layout on change - DESKTOP ONLY!
        grid.on('change', (event, items) => {
            // Don't save layout changes on mobile
            if (window.innerWidth < 768) {
                console.log('📱 Mobile - skip saving layout');
                return;
            }

            const layout = [];

            // Get layout directly from grid items with their IDs
            const gridItems = grid.getGridItems();
            gridItems.forEach(el => {
                const node = el.gridstackNode;
                if (node && el.id) {
                    // Filter: only save desktop-relevant cards
                    // Skip mobile cards (control-card-mobile, dev-control-card-mobile)
                    const isMobileOnly = el.classList.contains('control-card-mobile');

                    if (!isMobileOnly) {
                        layout.push({
                            id: el.id,
                            x: node.x,
                            y: node.y,
                            w: node.w,
                            h: node.h
                        });
                    }
                }
            });

            localStorage.setItem('dashboard-layout', JSON.stringify(layout));
            console.log('💾 Dashboard layout saved:', layout);

            // Adjust the height after a change
            this.adjustGridHeight();
        });

        // Window resize handler - just for grid height + reset button
        window.addEventListener('resize', () => {
            clearTimeout(this._resizeTimeout);
            this._resizeTimeout = setTimeout(() => {
                // columnOpts handles responsive automatically!
                // We just need to adjust grid height and show/hide the reset button
                const resetBtn = document.getElementById('dashboard-reset-btn');
                const sidebarResetBtn = document.getElementById('sidebar-reset-btn');
                if (resetBtn) {
                    resetBtn.style.display = window.innerWidth <= 768 ? 'none' : 'inline-block';
                }
                if (sidebarResetBtn) {
                    sidebarResetBtn.style.display = window.innerWidth <= 768 ? 'none' : 'flex';
                }
                this.adjustGridHeight();
            }, 250);  // 250ms debounce
        });

        // Patch: GridStack's _updateContainerHeight counts ALL nodes (including display:none).
        // That leaves too much empty space at the bottom. We override the method
        // so only VISIBLE items determine the container height.
        grid._updateContainerHeight = function() {
            if (!this.engine || this.engine.batchMode) return this;

            // Only count visible items (the original counts all)
            let maxRow = 0;
            this.engine.nodes.forEach(n => {
                if (!n.el) return;
                // Inline style or CSS media query (e.g. .control-card-mobile on desktop)
                if (n.el.style.display === 'none' ||
                    window.getComputedStyle(n.el).display === 'none') return;
                const bottom = (n.y || 0) + (n.h || 0);
                if (bottom > maxRow) maxRow = bottom;
            });
            // Extra rows during drag operations + minRow
            maxRow += (this._extraDragRow || 0);
            maxRow = Math.max(maxRow, this.opts.minRow || 0);

            const cellH = this.opts.cellHeight;
            const unit = this.opts.cellHeightUnit;
            if (!cellH) return this;

            this.el.setAttribute('gs-current-row', String(maxRow));
            this.el.style.removeProperty('min-height');
            this.el.style.removeProperty('height');
            if (maxRow) {
                this.el.style.height = maxRow * cellH + unit;
            }
            return this;
        };

        console.log('✅ GridStack initialized');
    }

    // Adjust Grid Height - triggers GridStack's patched _updateContainerHeight
    adjustGridHeight() {
        if (!this.dashboardGrid) return;
        this.dashboardGrid._updateContainerHeight();
    }

    // Adjust Grid Height for Mobile (Flexbox Layout)
    adjustGridHeightForMobile() {
        console.log('📱 Cleaning up GridStack inline-styles for mobile...');

        const gridContainer = document.querySelector('.grid-stack');
        if (gridContainer) {
            // Container: set height to auto, remove all GridStack styles
            gridContainer.style.height = 'auto';
            gridContainer.style.position = '';

            // IMPORTANT: strip all grid-stack-item elements of inline styles
            const gridItems = gridContainer.querySelectorAll('.grid-stack-item');
            gridItems.forEach(item => {
                // Remove ALL GridStack inline styles
                item.style.transform = '';
                item.style.position = '';
                item.style.top = '';
                item.style.left = '';
                item.style.width = '';
                item.style.height = '';

                console.log(`🧹 Cleaned inline-styles from: ${item.id}`);
            });

            console.log(`✅ Mobile cleanup complete: ${gridItems.length} items cleaned`);
        }
    }

    // Reset Dashboard Layout
    resetDashboardLayout() {
        showConfirmDialog({ text: (window.texts || {}).confirm_reset_layout,
            knopf: (window.texts || {}).confirm_reset }, function() {
            localStorage.removeItem('dashboard-layout');
            location.reload();
        });
    }

    // ========================================
    // DOMContentLoaded handler — translation assignments
    // ========================================

    _applyTranslations() {
        const texts = window.texts || {};

        // Desktop Controls
        const controlsTitle = document.getElementById('controls-title-desktop');
        if (controlsTitle) controlsTitle.textContent = texts.controls;

        // Switch button text is set by updateStatusDisplay (turn on/turn off)

        const lightText = document.getElementById('light-text-desktop');
        if (lightText) lightText.textContent = texts.light;

        const mqttText = document.getElementById('mqtt-text-desktop');
        if (mqttText) mqttText.textContent = texts.mqtt;

        const chartsText = document.getElementById('charts-text-desktop');
        if (chartsText) chartsText.textContent = texts.charts;

        const scheduledTextDesktop = document.getElementById('scheduled-text-desktop');
        if (scheduledTextDesktop) scheduledTextDesktop.textContent = texts.scheduled_prints;

        // Switch button text is set by updateStatusDisplay (turn on/turn off)

        const lightTextMobile = document.getElementById('light-text-mobile');
        if (lightTextMobile) lightTextMobile.textContent = texts.light;

        const mqttTextMobile = document.getElementById('mqtt-text-mobile');
        if (mqttTextMobile) mqttTextMobile.textContent = texts.mqtt;

        const chartsTextMobile = document.getElementById('charts-text-mobile');
        if (chartsTextMobile) chartsTextMobile.textContent = texts.charts;

        const scheduledTextMobile = document.getElementById('scheduled-text-mobile');
        if (scheduledTextMobile) scheduledTextMobile.textContent = texts.scheduled_prints;

        // Chart Modal and Tab
        const chartTitle = document.getElementById('chartTitle');
        if (chartTitle) chartTitle.textContent = texts.sensor_history;

        const chartTabText = document.getElementById('chart-tab-text');
        if (chartTabText) chartTabText.textContent = texts.charts;

        const scheduledPrintsTitle = document.getElementById('scheduled-prints-title');
        if (scheduledPrintsTitle) scheduledPrintsTitle.textContent = texts.scheduled_prints;

        // Developer controls — for Klipper "Advanced control" (there's no Bambu
        // "Developer" concept). Bambu mode keeps dev_controls.
        const _ctrlTitle = (window.isKlipperMode && window.isKlipperMode())
            ? (texts.advanced_controls || texts.dev_controls)
            : texts.dev_controls;
        const devControlsTitle = document.getElementById('dev-controls-title-desktop');
        if (devControlsTitle) devControlsTitle.textContent = _ctrlTitle;
        const devControlsTitleMobile = document.getElementById('dev-controls-title-mobile');
        if (devControlsTitleMobile) devControlsTitleMobile.textContent = _ctrlTitle;

        const pauseText = document.getElementById('pause-text-desktop');
        if (pauseText) pauseText.textContent = texts.pause;

        const resumeText = document.getElementById('resume-text-desktop');
        if (resumeText) resumeText.textContent = texts.resume;

        const stopText = document.getElementById('stop-text-desktop');
        if (stopText) stopText.textContent = texts.stop;

        ['mobile', 'desktop'].forEach(seite => {
            const el = document.getElementById('skip-text-' + seite);
            if (el) el.textContent = texts.skip_parts || 'Teile überspringen';
        });

        const sdcardText = document.getElementById('sdcard-text-desktop');
        if (sdcardText) sdcardText.textContent = texts.sdcard;

        const homingText = document.getElementById('homing-text-desktop');
        if (homingText) homingText.textContent = texts.homing;

        const printerControlText = document.getElementById('printer-control-text-desktop');
        if (printerControlText) printerControlText.textContent = texts.printer_control;

        const speedText = document.getElementById('speed-text-desktop');
        if (speedText) speedText.textContent = texts.speed;

        // Spoolman Card
        const spoolSelectOption = document.getElementById('spool-select-option');
        if (spoolSelectOption) spoolSelectOption.textContent = texts.select_spool;

        // Filament Drying Card
        const dryingTitle = document.getElementById('drying-title');
        if (dryingTitle) dryingTitle.textContent = texts.filament_drying;

        const materialSelectLabel = document.getElementById('material-select-label');
        if (materialSelectLabel) materialSelectLabel.textContent = texts.select_material;

        const materialSelectOption = document.getElementById('material-select-option');
        if (materialSelectOption) materialSelectOption.textContent = texts.select_filament;

        const tempLabel = document.getElementById('temp-label');
        if (tempLabel) tempLabel.textContent = texts.temperature;

        const durationLabel = document.getElementById('duration-label');
        if (durationLabel) durationLabel.textContent = texts.duration;

        const skipHomingLabel = document.getElementById('skip-homing-label');
        if (skipHomingLabel) skipHomingLabel.textContent = texts.skip_homing;

        const skipHomingHint = document.getElementById('skip-homing-hint');
        if (skipHomingHint) skipHomingHint.textContent = texts.skip_homing_hint;

        const startDryingText = document.getElementById('start-drying-text');
        if (startDryingText) startDryingText.textContent = texts.start_drying;

        const stopDryingText = document.getElementById('stop-drying-text');
        if (stopDryingText) stopDryingText.textContent = texts.stop_drying;

        // Filament drying banner (top of the main content)
        const filamentDryingTitle = document.getElementById('filament-drying-title');
        if (filamentDryingTitle) filamentDryingTitle.textContent = texts.filament_drying_banner_title;

        const filamentDryingDetails = document.getElementById('filament-drying-details');
        if (filamentDryingDetails) filamentDryingDetails.textContent = texts.filament_drying_banner_fallback;

        // The close button on the printer notification is an X; the
        // label belongs in the tooltip, not on the button.
        const hmsDismissBtn = document.querySelector('.hms-dismiss-btn');
        if (hmsDismissBtn) hmsDismissBtn.title = texts.hms_dismiss;

        // Mobile Controls
        const pauseTextMobile = document.getElementById('pause-text-mobile');
        if (pauseTextMobile) pauseTextMobile.textContent = texts.pause;

        const resumeTextMobile = document.getElementById('resume-text-mobile');
        if (resumeTextMobile) resumeTextMobile.textContent = texts.resume;

        const stopTextMobile = document.getElementById('stop-text-mobile');
        if (stopTextMobile) stopTextMobile.textContent = texts.stop;

        const sdcardTextMobile = document.getElementById('sdcard-text-mobile');
        if (sdcardTextMobile) sdcardTextMobile.textContent = texts.sdcard;
        const sdcardTextControlsMobile = document.getElementById('sdcard-text-controls-mobile');
        if (sdcardTextControlsMobile) sdcardTextControlsMobile.textContent = texts.sdcard;
        const sdcardTextControlsDesktop = document.getElementById('sdcard-text-controls-desktop');
        if (sdcardTextControlsDesktop) sdcardTextControlsDesktop.textContent = texts.sdcard;

        const homingTextMobile = document.getElementById('homing-text-mobile');
        if (homingTextMobile) homingTextMobile.textContent = texts.homing;

        const printerControlTextMobile = document.getElementById('printer-control-text-mobile');
        if (printerControlTextMobile) printerControlTextMobile.textContent = texts.printer_control;

        const speedTextMobile = document.getElementById('speed-text-mobile');
        if (speedTextMobile) speedTextMobile.textContent = texts.speed;

        const tempTextMobile = document.getElementById('temp-text-mobile');
        if (tempTextMobile) tempTextMobile.textContent = texts.temp_control || 'Temp';

        const tempTextDesktop = document.getElementById('temp-text-desktop');
        if (tempTextDesktop) tempTextDesktop.textContent = texts.temp_control || 'Temp';

        const fanTextMobile = document.getElementById('fan-text-mobile');
        if (fanTextMobile) fanTextMobile.textContent = texts.fan_button || 'Lüfter';
        const fanTextDesktop = document.getElementById('fan-text-desktop');
        if (fanTextDesktop) fanTextDesktop.textContent = texts.fan_button || 'Lüfter';

        // Tab Bar Labels
        const tabBarItems = document.querySelectorAll('.floating-tab-bar span[data-i18n]');
        tabBarItems.forEach(item => {
            const key = item.getAttribute('data-i18n');
            if (key && texts[key]) {
                item.textContent = texts[key];
            }
        });

        // Printer Control Modal
        const printerControlModalTitle = document.getElementById('printer-control-modal-title');
        if (printerControlModalTitle) printerControlModalTitle.textContent = texts.printer_control;

        const controlCameraSourceText = document.getElementById('control-camera-source-text');
        if (controlCameraSourceText) controlCameraSourceText.textContent = texts.camera_source;

        // Tabs
        const controlTabAxes = document.getElementById('control-tab-axes');
        if (controlTabAxes) controlTabAxes.textContent = texts.axes_tab;

        const controlTabExtruder = document.getElementById('control-tab-extruder');
        if (controlTabExtruder) controlTabExtruder.textContent = texts.extruder_tab;

        const controlTabFilament = document.getElementById('control-tab-filament');
        if (controlTabFilament) controlTabFilament.textContent = texts.filament_tab;

        // DEPRECATED: homing warning translations removed - X/Y homing happens automatically in the backend

        // Movement Tab
        const controlXyMovement = document.getElementById('control-xy-movement');
        if (controlXyMovement) controlXyMovement.textContent = texts.xy_movement;

        const controlZMovement = document.getElementById('control-z-movement');
        if (controlZMovement) controlZMovement.textContent = texts.z_movement;

        // Map view: the two panels carry the same titles as the button view,
        // because they do the same job by other means.
        const controlXyMovementMap = document.getElementById('control-xy-movement-map');
        if (controlXyMovementMap) controlXyMovementMap.textContent = texts.xy_movement;

        const controlZMovementMap = document.getElementById('control-z-movement-map');
        if (controlZMovementMap) controlZMovementMap.textContent = texts.z_movement;

        const moveViewButtons = document.getElementById('move-view-buttons');
        if (moveViewButtons) moveViewButtons.textContent = texts.move_view_buttons;

        const moveViewMap = document.getElementById('move-view-map');
        if (moveViewMap) moveViewMap.textContent = texts.move_view_map;

        const moveBedClear = document.getElementById('move-bed-clear');
        if (moveBedClear) moveBedClear.textContent = texts.move_bed_clear;

        const moveHeightLabel = document.getElementById('move-height-label');
        if (moveHeightLabel) moveHeightLabel.textContent = texts.move_height;

        const controlZUp = document.getElementById('control-z-up');
        if (controlZUp) controlZUp.textContent = texts.z_up;

        const controlZDown = document.getElementById('control-z-down');
        if (controlZDown) controlZDown.textContent = texts.z_down;

        const controlZHome = document.getElementById('control-z-home');
        if (controlZHome) controlZHome.textContent = texts.z_home;

        const controlXyStepSize = document.getElementById('control-xy-step-size');
        if (controlXyStepSize) controlXyStepSize.textContent = texts.step_size + ':';

        const controlZStepSize = document.getElementById('control-z-step-size');
        if (controlZStepSize) controlZStepSize.textContent = texts.step_size + ':';

        const controlAllAxesHome = document.getElementById('control-all-axes-home');
        if (controlAllAxesHome) controlAllAxesHome.textContent = texts.all_axes_home;

        const controlParkHead = document.getElementById('control-park-head');
        if (controlParkHead) controlParkHead.textContent = texts.park_head;

        const controlCenterHead = document.getElementById('control-center-head');
        if (controlCenterHead) controlCenterHead.textContent = texts.center_head;

        // Extruder Tab
        const controlExtruderTemperature = document.getElementById('control-extruder-temperature');
        if (controlExtruderTemperature) controlExtruderTemperature.textContent = texts.extruder_temperature;

        const controlTargetLabel = document.getElementById('control-target-label');
        if (controlTargetLabel) controlTargetLabel.textContent = texts.target;

        const controlOffBtn = document.getElementById('control-off-btn');
        if (controlOffBtn) controlOffBtn.textContent = texts.off;

        const controlSetBtn = document.getElementById('control-set-btn');
        if (controlSetBtn) controlSetBtn.textContent = texts.set;

        const controlExtruderMovement = document.getElementById('control-extruder-movement');
        if (controlExtruderMovement) controlExtruderMovement.textContent = texts.extruder_movement;

        const controlExtrude = document.getElementById('control-extrude');
        if (controlExtrude) controlExtrude.textContent = texts.extrude;

        const controlRetract = document.getElementById('control-retract');
        if (controlRetract) controlRetract.textContent = texts.retract;

        const controlLength = document.getElementById('control-length');
        if (controlLength) controlLength.textContent = texts.length + ':';

        // Filament Tab
        const controlFilamentManagement = document.getElementById('control-filament-management');
        if (controlFilamentManagement) controlFilamentManagement.textContent = texts.filament_management;

        // Device tab (X2D/H2D & co.) — labels
        const setTxt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
        setTxt('control-tab-device', texts.control_tab_device || 'Gerät');
        setTxt('dev-nozzles-title', texts.dev_nozzles || 'Düsen');
        setTxt('dev-chamber-title', texts.dev_chamber || 'Kammerheizung');
        setTxt('dev-chamber-set', texts.dev_chamber_set || 'Setzen');
        setTxt('dev-chamber-hint', texts.dev_chamber_hint || '');
        setTxt('dev-airduct-title', texts.dev_airduct || 'Luftführung');
        setTxt('dev-fans-title', texts.dev_fans || 'Lüfter');
        setTxt('dev-ams-title', texts.dev_ams || 'AMS');
        setTxt('dev-lights-title', texts.dev_lights || 'Zusatzlichter');
        setTxt('dev-light2-label', texts.light_chamber2 || 'Zweites Kammerlicht');
        setTxt('dev-bedlight-label', texts.light_heatbed || 'Heizbett-Licht');
        setTxt('control-free-move', texts.control_free_move || 'Achsen freigeben');
        setTxt('dev-buzzer-title', texts.dev_buzzer || 'Signalton');
        setTxt('dev-buzzer-silent', texts.buzzer_silent || 'Stumm');
        setTxt('dev-buzzer-beeping', texts.buzzer_beeping || 'Piepen');
        setTxt('dev-buzzer-alarm', texts.buzzer_alarm || 'Alarm');
        setTxt('dev-door-label', (texts.door_label || 'Tür') + ':');
        setTxt('dev-tool-label', (texts.tool_label || 'Werkzeug') + ':');

        // Nozzle selection (only visible with a dual nozzle)
        const ctrlNozzleLabel = document.getElementById('ctrl-nozzle-label');
        if (ctrlNozzleLabel) ctrlNozzleLabel.textContent = (texts.nozzle_select || 'Düse') + ':';
        const ctrlNozzle = document.getElementById('ctrl-nozzle');
        if (ctrlNozzle && ctrlNozzle.options.length === 2) {
            ctrlNozzle.options[0].textContent = texts.nozzle_left || 'Düse 1 (links)';
            ctrlNozzle.options[1].textContent = texts.nozzle_right || 'Düse 2 (rechts)';
        }

        const controlLoad = document.getElementById('control-load');
        if (controlLoad) controlLoad.textContent = texts.load;

        const controlUnload = document.getElementById('control-unload');
        if (controlUnload) controlUnload.textContent = texts.unload;

        // The printer's follow-up prompt after loading
        const amsResume = document.getElementById('control-ams-resume');
        if (amsResume) amsResume.textContent = texts.ams_resume;

        const amsDone = document.getElementById('control-ams-done');
        if (amsDone) amsDone.textContent = texts.ams_done;

        const controlChange = document.getElementById('control-change');
        if (controlChange) controlChange.textContent = texts.change;

        const controlPurge = document.getElementById('control-purge');
        if (controlPurge) controlPurge.textContent = texts.purge;

        const controlTipLabel = document.getElementById('control-tip-label');
        if (controlTipLabel) controlTipLabel.textContent = texts.tip;

        const controlEnsureHot = document.getElementById('control-ensure-hot');
        if (controlEnsureHot) controlEnsureHot.textContent = texts.ensure_hot_extruder;

        // Camera
        const liveCameraTitle = document.getElementById('live-camera-title');
        if (liveCameraTitle) liveCameraTitle.textContent = texts.live_camera;

        const cameraSourceText = document.getElementById('camera-source-text');
        if (cameraSourceText) cameraSourceText.textContent = texts.switch_source;

        const cameraLoadingText = document.getElementById('camera-loading-text');
        if (cameraLoadingText) cameraLoadingText.textContent = texts.camera_loading;

        // Camera Overlay
        const fullscreenText = document.getElementById('fullscreen-text');
        if (fullscreenText) fullscreenText.textContent = texts.fullscreen;

        const zoomResetText = document.getElementById('zoom-reset-text');
        if (zoomResetText) zoomResetText.textContent = texts.zoom_reset;

        // Mobile Controls Header
        const controlsTitleMobile = document.getElementById('controls-title-mobile');
        if (controlsTitleMobile) controlsTitleMobile.textContent = texts.controls;

        // Print Progress Card
        const printStatusText = document.getElementById('print-status-text');
        if (printStatusText) printStatusText.textContent = texts.no_print_active;

        // SD-Card Modal
        const sdCardTitle = document.getElementById('sd-card-title');
        if (sdCardTitle) sdCardTitle.textContent = texts.sd_card_files;

        const uploadFileText = document.getElementById('upload-file-text');
        if (uploadFileText) uploadFileText.textContent = texts.upload_file;

        const sdRefreshText = document.getElementById('sd-refresh-text');
        if (sdRefreshText) sdRefreshText.textContent = texts.refresh;

        // Archive toggle: the label depends on the state, so it goes through
        // its own function instead of being set here.
        if (typeof window.sdArchivKnopfSetzen === 'function') {
            window.sdArchivKnopfSetzen();
        }

        const sdLoadingText = document.getElementById('sd-loading-text');
        if (sdLoadingText) sdLoadingText.textContent = texts.loading_files;

        const sdErrorText = document.getElementById('sd-error-text');
        if (sdErrorText) sdErrorText.textContent = texts.error_loading_files;

        // Schedule Print Modal
        const schedulePrintTitle = document.getElementById('schedule-print-title');
        if (schedulePrintTitle) schedulePrintTitle.textContent = texts.schedule_print;

        const scheduleStartTime = document.getElementById('schedule-start-time');
        if (scheduleStartTime) scheduleStartTime.textContent = texts.schedule_section_time || 'Zeitplan';

        const scheduleAutoPowerLabel = document.getElementById('schedule-auto-power-label');
        if (scheduleAutoPowerLabel) scheduleAutoPowerLabel.textContent = texts.auto_power_on;

        // Header for the material card. select_filament carries a
        // colon (and appears twice in every language file) — so it
        // doesn't work as a section heading.
        const scheduleSelectFilament = document.getElementById('schedule-select-filament');
        if (scheduleSelectFilament) scheduleSelectFilament.textContent = texts.schedule_section_material || 'Material';

        const scheduleNoSpool = document.getElementById('schedule-no-spool');
        if (scheduleNoSpool) scheduleNoSpool.textContent = texts.no_spool_selected;

        const schedulePrintOptions = document.getElementById('schedule-print-options');
        if (schedulePrintOptions) schedulePrintOptions.textContent = texts.schedule_section_options || 'Druckoptionen';

        // Labels for the new cards in the schedule dialog.
        const setzeText = (id, wert) => {
            const el = document.getElementById(id);
            if (el) el.textContent = wert;
        };
        setzeText('schedule-startet-label', texts.schedule_starts_at || 'Druck startet');
        setzeText('schedule-spool-label', texts.schedule_spool_label || 'Spule');
        setzeText('schedule-plate-label', texts.print_prepare_plate || 'Platte');

        // The options and plate selection in the schedule dialog are now
        // labeled by print preparation itself (print-prepare.js).

        // Schedule Modal Buttons
        const scheduleCancelBtn = document.getElementById('schedule-cancel-btn');
        if (scheduleCancelBtn) scheduleCancelBtn.textContent = texts.cancel;

        const scheduleConfirmBtn = document.getElementById('schedule-confirm-btn');
        if (scheduleConfirmBtn) scheduleConfirmBtn.textContent = texts.schedule_print_button;
    }

    // ========================================
    // Theme
    // ========================================

    setupTheme() {
        // Cache reset: clean up body classes for a fresh start
        document.body.classList.remove('dark-mode');

        const savedTheme = localStorage.getItem('theme');

        // Browser logic
        if (savedTheme === 'auto' || !savedTheme) {
            this.applySystemTheme();
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
                if (localStorage.getItem('theme') === 'auto') {
                    this.applySystemTheme();
                }
            });
        } else {
            if (savedTheme === 'dark') {
                document.body.classList.add('dark-mode');
            } else {
                document.body.classList.remove('dark-mode');
            }
        }
        this.updateThemeIcon();
    }

    applySystemTheme() {
        let isDark = false;

        // Browser - Media Query
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            isDark = true;
        }

        if (isDark) {
            document.body.classList.add('dark-mode');
        } else {
            document.body.classList.remove('dark-mode');
        }
        this.updateThemeIcon();
    }

    toggleDarkMode() {
        if (window.themeManager) {
            const newTheme = window.themeManager.toggleTheme();
            this.themenMeldung(newTheme);
        }
    }

    updateThemeIcon() {
        if (window.themeManager) {
            window.themeManager.updateIcons();
        }
    }

    // ========================================
    // Card Visibility
    // ========================================

    applyCardVisibility(cardVisibility) {
        // Default: all cards visible
        const visibility = cardVisibility || {};
        this.cardVisibilitySettings = visibility;
        window.cardVisibilitySettings = visibility;

        // Card Mappings: config key -> grid element ID
        const cardMappings = {
            camera: 'camera-card-grid',
            progress: 'progress-card-grid',
            spoolman: 'spoolman-card-grid',
            drying: 'filament-drying-card-grid'
        };

        Object.entries(cardMappings).forEach(([key, elementId]) => {
            const card = document.getElementById(elementId);
            if (card) {
                // Default is true (visible), only hide when explicitly false
                const isVisible = visibility[key] !== false;
                card.style.display = isVisible ? '' : 'none';

                // For filament drying: also set the internal variable
                if (key === 'drying' && !isVisible) {
                    window.cardDryingHiddenBySettings = true;
                } else if (key === 'drying') {
                    window.cardDryingHiddenBySettings = false;
                }
            }
        });

        console.log('📊 Card visibility applied:', visibility);

        // After applying the settings: apply printer-status-based visibility
        this.updatePrinterDependentCards();

        // Adjust grid height after a visibility change
        setTimeout(() => this.adjustGridHeight(), 50);
    }

    // Cards that should only be visible while the printer is on
    updatePrinterDependentCards() {
        const switchOn = window.lastKnownSwitchState === 'on';
        const mqttConnected = window.lastMqttStatus === true;
        // See status-manager.js: without a configured outlet, the
        // connection decides, not a switch that doesn't exist.
        const printerOnline = (typeof window.druckerDa === 'boolean')
            ? window.druckerDa
            : (switchOn && mqttConnected);

        // Developer card - control visibility via checkDeveloperMode()
        // (shows the card + buttons together, without delay)
        // Klipper: always show (no "printer online via power switch"
        // concept needed, Klipper is there once Moonraker responds).
        if (printerOnline || (window.isKlipperMode && window.isKlipperMode())) {
            checkDeveloperMode();
        } else {
            const devCardMobile = document.getElementById('dev-control-card-mobile');
            const devCardDesktop = document.getElementById('dev-control-card-desktop');
            if (devCardMobile) devCardMobile.style.display = 'none';
            if (devCardDesktop) devCardDesktop.style.display = 'none';
        }

        // Filament drying card - only when the printer is online AND not hidden in settings
        const dryingCard = document.getElementById('filament-drying-card-grid');
        if (dryingCard) {
            const hiddenBySettings = this.cardVisibilitySettings.drying === false;
            if (hiddenBySettings || !printerOnline) {
                dryingCard.style.display = 'none';
            } else {
                // Visibility is controlled by updateFilamentCardVisibility()
                // (also checks whether the feature is enabled)
            }
        }

        // Gray out the Mainsail dock tab when offline (Mainsail is unreachable then).
        if (window.tabBarManager && window.tabBarManager.updateMainsailState) {
            window.tabBarManager.updateMainsailState();
        }

        // Adjust grid height after a visibility change
        setTimeout(() => this.adjustGridHeight(), 50);
    }

    // ========================================
    // Utilities
    // ========================================

    domReady(fn) {
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            setTimeout(fn, 1);
        } else {
            document.addEventListener('DOMContentLoaded', fn);
        }
    }

    // Runs non-critical code after the initial paint, so HTML
    // rendering / the first UI display isn't blocked by side effects.
    // Uses requestIdleCallback when available, otherwise setTimeout as a fallback.
    deferNonCritical(fn, fallbackMs = 150) {
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(fn, { timeout: 1500 });
        } else {
            setTimeout(fn, fallbackMs);
        }
    }

    // ========================================
    // Loading
    // ========================================

    async loadEverything() {
        if (this.isLoading) return;

        this.isLoading = true;
        const texts = window.texts || {};
        try {
            await loadStatus();
        } catch (error) {
            console.error(texts.console_loadeverything_error + ':', error);
        } finally {
            this.isLoading = false;
        }
    }

    loadTitelbild() {
        // No more HA title image — only 3MF thumbnails at print start.
        //
        // But the SPACE stays reserved: when the container was hidden,
        // the printer shifted left as soon as there was no thumbnail
        // (e.g. right after a restart). Only the image gets cleared.
        const bild = document.getElementById('titelbild');
        if (bild) { bild.removeAttribute('src'); bild.style.visibility = 'hidden'; }
    }

    // ========================================
    // Spoolman helper
    // ========================================

    createSpoolButtons() {
        const texts = window.texts || {};

        apiCall('/api/spoolman/spools')
            .then(response => response.json())
            .then(spools => {
                const container = document.getElementById('spool-button-list');
                if (!container) return;

                // Get the currently active spool
                const currentActiveId = window.activeSpoolId;

                let html = `
                    <button onclick="activateSpool('')"
                            style="width:100%; padding:10px; margin-bottom:4px;
                                   background:${!currentActiveId ? '#2196f3' : '#2a2d4a'};
                                   color:${!currentActiveId ? '#fff' : '#9aa0a6'};
                                   border:1px solid ${!currentActiveId ? '#2196f3' : '#3a3d5a'};
                                   border-radius:6px;
                                   text-align:left; font-size:12px; cursor:pointer;">
                        ${texts.no_spool || 'Keine Spule'} ${!currentActiveId ? '✓' : ''}
                    </button>
                `;

                spools.forEach(spool => {
                    const name = spool.filament?.name || 'Unbekannt';
                    const remaining = Math.round(spool.remaining_weight || 0);
                    const color = spool.filament?.color_hex || '888888';
                    const isActive = spool.id == currentActiveId;

                    // Fill level as a colored dot instead of an emoji circle — the same
                    // visual language as the other status dots on the page.
                    const fuellFarbe = remaining <= 50 ? '#ef4444'
                                     : remaining <= 150 ? '#f59e0b' : '#22c55e';
                    const statusIcon = `<span style="display:inline-block;width:8px;height:8px;`
                                     + `border-radius:50%;background:${fuellFarbe};"></span>`;

                    html += `
                        <button onclick="activateSpool('${spool.id}')"
                                style="width:100%; padding:10px; margin-bottom:4px;
                                       background:${isActive ? '#2196f3' : '#1a1f3a'};
                                       color:#e8eaed;
                                       border:1px solid ${isActive ? '#2196f3' : '#2a2d4a'};
                                       border-radius:6px; text-align:left; font-size:12px;
                                       cursor:pointer; display:flex; align-items:center; gap:8px;">
                            <span style="width:16px; height:16px; border-radius:50%;
                                       background:#${color}; border:1px solid #2a2d4a;"></span>
                            <span style="flex:1;">${name}</span>
                            <span>${statusIcon} ${remaining}g ${isActive ? '✓' : ''}</span>
                        </button>
                    `;
                });

                container.innerHTML = html;

                // Update active info
                if (currentActiveId) {
                    const activeSpool = spools.find(s => s.id == currentActiveId);
                    if (activeSpool) {
                        const infoDiv = document.getElementById('active-spool-info');
                        if (!infoDiv) return;
                        const nameDiv = document.getElementById('active-spool-name');
                        if (infoDiv) {
                            infoDiv.style.display = 'block';
                        }
                        if (nameDiv) nameDiv.textContent = activeSpool.filament?.name || 'Unbekannt';
                    }
                } else {
                    const infoDiv = document.getElementById('active-spool-info');
                    if (!infoDiv) return;
                    if (infoDiv) infoDiv.style.display = 'none';
                }
            });
    }

    // ========================================
    // Power-off timer
    // ========================================

    async cancelPowerOffTimer() {
        const texts = window.texts || {};
        // Hide first, then report. The other way around, the banner would
        // still show until the response came back — and if nothing visibly
        // happens, people click again. If the call fails, it comes back.
        const banner = document.getElementById('power-off-banner');
        const warSichtbar = !!(banner && banner.classList.contains('active'));
        if (banner) banner.classList.remove('active');
        window.powerOffTimerActive = false;

        const zurueck = function () {
            if (warSichtbar && banner) banner.classList.add('active');
            window.powerOffTimerActive = warSichtbar;
        };

        try {
            const response = await apiCall('/api/cancel_power_off', {
                method: 'POST'
            });

            if (response.ok) {
                skToast(texts.toast_poweroff_cancelled, 'info');
            } else {
                zurueck();
                skToast(texts.toast_error_cancelling, 'error');
            }
        } catch (error) {
            zurueck();
            console.error(texts.console_error_cancelling_timer + ':', error);
            skToast(texts.toast_error_cancelling, 'error');
        }
    }

    // Cancel from Banner with confirmation
    cancelPowerOffTimerFromBanner() {
        const texts = window.texts || {};
        showConfirmDialog(texts.confirm_cancel_poweroff_timer || 'Cancel auto power-off timer?', () => {
            this.cancelPowerOffTimer();
        });
    }

    // ========================================
    // Report a theme change
    // ========================================

    /**
     * Brief message after switching light/dark/auto.
     *
     * All theme feedback goes through skToast; this only translates the
     * theme key and uses a shorter display duration.
     */
    themenMeldung(schluessel) {
        const texts = window.texts || {};
        const namen = {
            auto:  texts.theme_auto  || 'Automatisch',
            dark:  texts.theme_dark  || 'Dunkel',
            light: texts.theme_light || 'Hell',
        };
        if (namen[schluessel] && typeof window.skToast === 'function') {
            window.skToast(namen[schluessel], 'info', { dauer: 1800 });
        }
    }

    filamentChangeAction(action) {
        // Filament change workflow (multi-color external spool):
        // action: "load" | "done" | "retry"
        //
        // Routing:
        //   Bambu: POST /api/mqtt/filament_change {action}
        //          (backend sends M620 P255/P254 + ams_control)
        //   Klipper: POST /api/printer/<endpoint> (unified dispatcher)
        //          load  -> filament_change_start OR filament_change_inserted
        //                   (phase-dependent, same scheme as the iOS path)
        //          done  -> filament_change_inserted
        //          retry -> filament_change_start
        const csrfToken = sessionStorage.getItem('csrf_token') || localStorage.getItem('csrf_token');
        const isKlipper = !!(window.activePrinter && window.activePrinter.isKlipper);
        let url, body;
        if (isKlipper) {
            let endpoint;
            if (action === 'done') {
                endpoint = 'filament_change_inserted';
            } else if (action === 'retry') {
                endpoint = 'filament_change_start';
            } else { // 'load'
                const phase = (window.lastPrintData &&
                               window.lastPrintData.filament_change_phase) || 0;
                endpoint = (phase === 2) ? 'filament_change_inserted'
                                          : 'filament_change_start';
            }
            url = '/api/printer/' + endpoint;
            body = {};
        } else {
            url = '/api/mqtt/filament_change';
            body = { action: action };
        }
        return fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken || ''
            },
            body: JSON.stringify(body)
        })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                console.log(`🎨 Filament change ${action}:`, data);
            } else {
                console.error(`❌ Filament change ${action} failed:`, data.error);
                window.skToast(((window.texts||{}).set_error_colon || 'Fehler:') + ' '
                    + (data.error || (window.texts||{}).unknown || 'Unbekannt'));
            }
            return data;
        })
        .catch(e => {
            console.error('❌ Filament change error:', e);
            window.skToast(((window.texts||{}).network_error || 'Netzwerkfehler') + ': ' + e.message);
            throw e;
        });
    }

    /**
     * Answer to "was the spool taken off the holder?".
     *
     * action: "reset" | "keep", code: SPULE-LINKS | SPULE-RECHTS
     *
     * Only the answer travels. What follows from it — clearing the spool at
     * the printer, closing the message on every device — happens in the
     * route, so the phone and the desktop cannot drift apart.
     */
    spulenAntwort(action, code) {
        const csrfToken = sessionStorage.getItem('csrf_token')
            || localStorage.getItem('csrf_token');
        const spool = String(code || '').toUpperCase() === 'SPULE-LINKS' ? 254 : 255;
        return fetch('/api/spool_prompt', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken || ''
            },
            body: JSON.stringify({ spool_id: spool, reset: action === 'reset' })
        })
        .then(r => r.json())
        .then(data => {
            if (!data.success) {
                window.skToast(((window.texts||{}).set_error_colon || 'Fehler:') + ' '
                    + (data.error || (window.texts||{}).unknown || 'Unbekannt'));
            }
            return data;
        })
        .catch(e => {
            window.skToast(((window.texts||{}).network_error || 'Netzwerkfehler') + ': ' + e.message);
            throw e;
        });
    }

    dismissHMSError() {
        // Dismissal lives in hms-banner.js — the same implementation the
        // other pages use.
        window.HmsBanner.wegklicken();
    }

    // Check whether an HMS error was dismissed (uses the server list)
    isHMSErrorDismissed(errorCode) {
        // Case doesn't matter: codes have been written in different cases
        // over time (lowercase vs. uppercase like Studio). A character-for-
        // character comparison would make everything previously dismissed
        // reappear once.
        return this.serverDismissedHMSErrors.some(
            c => window.HmsBanner.gleich(c, errorCode));
    }

    // Clear dismissed HMS errors - handled automatically by the server once there are no more errors
    clearDismissedHMSErrors() {
        // Nothing to do - the server handles that
    }

    // Load HMS status from the server (at startup) - MUST finish before progress_update
    async loadHMSStatus() {
        try {
            const response = await fetch('/api/hms/status');
            const data = await response.json();
            if (data.success) {
                this.serverDismissedHMSErrors = data.dismissed_errors || [];
                // Keep bare-global in sync for other modules
                serverDismissedHMSErrors = this.serverDismissedHMSErrors;
                console.log('📥 HMS Status loaded, dismissed:', this.serverDismissedHMSErrors);
            }
        } catch (error) {
            console.error('❌ Error loading HMS status:', error);
        } finally {
            this.hmsStatusLoaded = true;
            // Keep bare-global in sync
            hmsStatusLoaded = true;
            // And draw the state that arrived meanwhile now. This call runs
            // on idle, the first /api/status has long since gone through —
            // the notification was held back because the dismissal list
            // wasn't there yet. The socket only sends again on a change, so
            // it would otherwise never arrive.
            if (window.HmsBanner) {
                window.HmsBanner.nachziehen({
                    geladen: true,
                    weggeklickt: (code) => this.isHMSErrorDismissed(code),
                    aufraeumen: () => this.clearDismissedHMSErrors(),
                });
            }
        }
    }

    // ========================================
    // Power-Off Timer Status
    // ========================================

    async loadPowerOffTimerStatus() {
        try {
            const response = await fetch('/api/power_off_timer/status');
            const data = await response.json();
            console.log('⏰ Power-Off Timer Status loaded:', data);

            const banner = document.getElementById('power-off-banner');
            const bannerCountdown = document.getElementById('power-off-banner-countdown');
            const bannerReason = document.getElementById('power-off-banner-reason');

            if (data.active) {
                window.powerOffTimerActive = true;

                // Show the banner
                if (banner) {
                    banner.classList.add('active');
                    if (bannerReason) bannerReason.textContent = data.reason;
                }

                // Start the countdown
                const updateCountdown = () => {
                    const remaining = Math.max(0, data.end_time - (Date.now() / 1000));
                    const minutes = Math.floor(remaining / 60);
                    const seconds = Math.floor(remaining % 60);
                    const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;

                    if (bannerCountdown) {
                        bannerCountdown.textContent = timeString;
                    }

                    if (remaining > 0 && window.powerOffTimerActive) {
                        requestAnimationFrame(updateCountdown);
                    } else if (remaining <= 0) {
                        // Timer expired - hide the banner
                        if (banner) banner.classList.remove('active');
                    }
                };

                updateCountdown();
            } else {
                // Timer not active - hide the banner
                if (banner) banner.classList.remove('active');
                window.powerOffTimerActive = false;
            }
        } catch (error) {
            console.error('❌ Error loading Power-Off Timer status:', error);
        }
    }

    // ========================================
    // Maintenance banner
    // ========================================

    dismissMaintenanceBanner() {
        const banner = document.getElementById('maintenance-banner');

        // Hide the banner
        banner.classList.remove('active');

        // Dismissed status in localStorage (24h)
        const dismissedUntil = Date.now() + (24 * 60 * 60 * 1000); // 24 hours
        localStorage.setItem('maintenance_banner_dismissed', dismissedUntil);
        console.log('✅ Maintenance banner dismissed for 24h');
    }

    showMaintenanceBanner(task) {
        // Check whether the banner was dismissed for 24h
        const dismissedUntil = localStorage.getItem('maintenance_banner_dismissed');
        if (dismissedUntil && Date.now() < parseInt(dismissedUntil)) {
            console.log('⏭️ Maintenance banner dismissed until', new Date(parseInt(dismissedUntil)));
            return;
        }

        const banner = document.getElementById('maintenance-banner');
        const title = document.getElementById('maintenance-banner-title');
        const message = document.getElementById('maintenance-banner-message');

        const taskName = task.name;
        const daysUntilDue = task.days_until_due;

        // Title based on status
        if (daysUntilDue < 0) {
            // Overdue
            const daysOverdue = Math.abs(daysUntilDue);
            banner.classList.add('overdue');
            title.textContent = getText('maintenance_banner_overdue');
            message.textContent = getText('maintenance_banner_overdue_days').replace('{task}', taskName).replace('{days}', daysOverdue);
        } else if (daysUntilDue === 0) {
            // Due today
            banner.classList.remove('overdue');
            title.textContent = getText('maintenance_banner_due_today');
            message.textContent = getText('maintenance_banner_today').replace('{task}', taskName);
        } else if (daysUntilDue === 1) {
            // Due tomorrow
            banner.classList.remove('overdue');
            title.textContent = getText('maintenance_banner_due_soon');
            message.textContent = getText('maintenance_banner_tomorrow').replace('{task}', taskName);
        } else {
            // Due soon (2-3 days)
            banner.classList.remove('overdue');
            title.textContent = getText('maintenance_banner_due_soon');
            message.textContent = getText('maintenance_banner_due_days').replace('{task}', taskName).replace('{days}', daysUntilDue);
        }

        // Show the banner
        banner.classList.add('active');
        console.log('🔧 Maintenance banner shown:', taskName);
    }

    async checkMaintenanceStatus() {
        try {
            // Fetch due maintenance tasks
            const response = await apiCall('/api/maintenance/tasks/due');
            if (response.ok) {
                const tasks = await response.json();

                if (tasks && tasks.length > 0) {
                    // Show the banner for the most urgent maintenance
                    const mostUrgent = tasks[0]; // Already sorted by priority
                    this.showMaintenanceBanner(mostUrgent);
                }
            }
        } catch (error) {
            console.error('Error checking maintenance status:', error);
        }
    }


    // ========================================
    // init() — called once, sets up everything
    // ========================================

    init() {
        const texts = window.texts || {};
        const self = this;

        // Expose browser detection flags
        window.isSafari = this.isSafari;
        window.isPWA = this.isPWA;
        window.isSafariPWA = this.isSafariPWA;

        // Expose cardVisibilitySettings
        window.cardVisibilitySettings = this.cardVisibilitySettings;

        // Camera error handler
        // Camera errors are handled exclusively by the camera-manager.

        // CRITICAL: run IMMEDIATELY before DOM ready — anti-flicker
        (function() {
            // ONLY for anti-flicker: quick dark mode check
            const savedTheme = localStorage.getItem('theme');
            const systemIsDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

            // Just the simplest possible logic for a fast theme
            if (savedTheme === 'dark' || (!savedTheme && systemIsDark)) {
                document.body.classList.add('dark-mode');
                console.log('Anti-Flicker: Dark Mode aktiviert (savedTheme=' + savedTheme + ', systemIsDark=' + systemIsDark + ')');
            }
        })();

        // Setup theme (synchronous, before DOM ready)
        this.setupTheme();
        console.log(texts.console_dashboard_starting);

        // LEGACY: Keep sdSyncInProgress accessible for socket handlers
        Object.defineProperty(window, 'sdSyncInProgress', {
            get() { return window.sdCardManager ? window.sdCardManager.sdSyncInProgress : false; },
            set(v) { if (window.sdCardManager) window.sdCardManager.sdSyncInProgress = v; }
        });

        // DOMContentLoaded handler
        document.addEventListener('DOMContentLoaded', function() {
            // Initialize GridStack first
            self.initGridStack();
            // Render Tab Bar using shared manager
            if (window.tabBarManager) {
                window.tabBarManager.render();
            }

            // Check URL hash and open modals accordingly
            const hash = window.location.hash;
            if (hash === '#history') {
                // Redirect to history page
                window.location.href = '/static/history.html';
            } else if (hash === '#logs') {
                setTimeout(() => {
                    if (typeof openLogViewer === 'function') {
                        openLogViewer();
                    }
                }, 100);
            } else if (hash === '#settings') {
                setTimeout(() => {
                    if (typeof openSettings === 'function') {
                        openSettings();
                    }
                }, 100);
            }

            // Apply translations
            self._applyTranslations();
        });

        // Window resize handler (GridStack toggle)
        window.addEventListener('resize', () => {
            if (window.innerWidth <= 768 && this.dashboardGrid) {
                this.dashboardGrid.destroy(false);
                this.dashboardGrid = null;
                this.adjustGridHeightForMobile(); // Set the grid height for flexbox
                console.log('📱 GridStack disabled (Mobile)');
            } else if (window.innerWidth > 768 && !this.dashboardGrid) {
                this.initGridStack();
            }
        });

        // WebSocket listener for HMS updates (synchronization)
        if (typeof socket !== 'undefined') {
            socket.on('hms_update', (data) => {
                console.log('📡 HMS Update received:', data);
                this.serverDismissedHMSErrors = data.dismissed_errors || [];
                serverDismissedHMSErrors = this.serverDismissedHMSErrors;

                // Update the banner display
                const banner = document.getElementById('hms-error-banner');
                if (!banner) return;

                const currentErrorCode = banner.dataset.errorCode;
                const activeErrors = data.active_errors || [];

                // Hide the banner when:
                // 1. There are no more active errors OR
                // 2. The currently shown error was dismissed
                if (activeErrors.length === 0) {
                    banner.classList.remove('active');
                    console.log('🧹 HMS Banner hidden - no active errors');
                } else if (currentErrorCode && this.serverDismissedHMSErrors.includes(currentErrorCode)) {
                    banner.classList.remove('active');
                    console.log(`🔕 HMS Banner hidden - error ${currentErrorCode} was dismissed`);
                }
            });
        }

        // Check maintenance status on page load
        setTimeout(() => {
            this.checkMaintenanceStatus();
        }, 2000); // 2 seconds after the page loads

        // domReady callback with loadEverything, spoolman init, camera setup, event handlers
        this.domReady(async function() {
            console.log(texts.console_app_loaded);

            // IMPORTANT: fetch status FIRST (a bridge until the socket connects),
            // so buttons show the right state immediately.
            await self.loadEverything();
            // After that, the socket is the sole live source. Only poll
            // /api/status as a fallback when the socket is NOT connected.
            window.statusUpdateInterval = setInterval(() => {
                // Fully online (socket connected AND printer/mqtt present) -> the socket
                // delivers everything, no poll. Otherwise (socket down OR printer off)
                // fetch /api/status, so the power button/online status catches up
                // (the adapter pushes no printer_state without Moonraker).
                // The socket carries the same data as /api/status — both are
                // built from StatusBuilderService.vollstatus().
                //
                // Now only used as a fallback: socket down or printer offline.
                const online = window.socket && window.socket.connected && window.lastMqttStatus === true;
                if (!online) self.loadEverything();
            }, 8000);

            // The camera belongs entirely to the camera-manager (_initCamera):
            // it negotiates WebRTC/MJPEG/off. Setting img.src=/api/camera
            // here before that negotiation would keep the ffmpeg pipeline
            // alive permanently — don't add it back.

            // Check the Spoolman config and load card visibility.
            // Card visibility is layout-critical (apply immediately),
            // Spoolman fetches (status + spools + spool/N) are non-critical -> defer them.
            apiCall('/api/config')
                .then(response => response.json())
                .then(data => {
                    window.spoolmanEnabled = data.spoolman && data.spoolman.enabled;
                    // Card Visibility SOFORT anwenden (Layout)
                    self.applyCardVisibility(data.ui?.card_visibility);
                    // Move the Spoolman init to idle afterwards
                    self.deferNonCritical(() => {
                        console.log(texts.console_call_init_spoolman);
                        initSpoolman();
                    });
                });

            // checkDeveloperMode() refetches status+config (pooled via TTL cache)
            // and hides certain buttons. Non-critical for the initial paint.
            self.deferNonCritical(() => checkDeveloperMode());

            // Initialize HQ status asynchronously
            setTimeout(() => initHQStatus(), 100);

            // Initialize the camera source button status (direct, no API needed)
            initCameraSourceButton();

            // Power-Off Timer Click Handler
            const powerOffHeader = document.getElementById('power-off-header');
            if (powerOffHeader) {
                powerOffHeader.addEventListener('click', function() {
                    showConfirmDialog(texts.confirm_cancel_poweroff_timer, function() {
                        self.cancelPowerOffTimer();
                    });
                });
            }

            setupSafariStreamFix();

            // Camera stream error handler
            const cameraStreamImg = document.getElementById('camera-stream');
            if (cameraStreamImg) {
            }

            // Mouse-wheel zoom with mouse position
            const cameraStream = document.getElementById('camera-stream');
            if (cameraStream) {
                cameraStream.addEventListener('wheel', function(e) {
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        const delta = e.deltaY < 0 ? 0.1 : -0.1;
                        desktopZoomAtPosition(delta, e.clientX, e.clientY);
                    }
                });
            }

            // socketManager.init() — called here so globals like deferNonCritical are available
            if (window.socketManager) window.socketManager.init();
        });
    }
}

// ============================================================
// Bare-global variables for backward compatibility
// (some modules read these as unqualified names)
// ============================================================
var serverDismissedHMSErrors = [];
var hmsStatusLoaded = false;

// ============================================================
// Instantiate singleton
// ============================================================
window.appInit = new AppInitManager();

// ============================================================
// Global wrappers — functions called by other modules as globals
// ============================================================
window.initGridStack = () => window.appInit.initGridStack();
window.adjustGridHeight = () => window.appInit.adjustGridHeight();
window.adjustGridHeightForMobile = () => window.appInit.adjustGridHeightForMobile();
window.resetDashboardLayout = () => window.appInit.resetDashboardLayout();
window.setupTheme = () => window.appInit.setupTheme();
window.applySystemTheme = () => window.appInit.applySystemTheme();
window.applyCardVisibility = (v) => window.appInit.applyCardVisibility(v);
window.updatePrinterDependentCards = () => window.appInit.updatePrinterDependentCards();
window.domReady = (fn) => window.appInit.domReady(fn);
window.deferNonCritical = (fn, ms) => window.appInit.deferNonCritical(fn, ms);
window.loadEverything = () => window.appInit.loadEverything();
window.loadTitelbild = () => window.appInit.loadTitelbild();
window.createSpoolButtons = () => window.appInit.createSpoolButtons();
window.toggleDarkMode = () => window.appInit.toggleDarkMode();
window.updateThemeIcon = () => window.appInit.updateThemeIcon();
window.cancelPowerOffTimer = () => window.appInit.cancelPowerOffTimer();
window.cancelPowerOffTimerFromBanner = () => window.appInit.cancelPowerOffTimerFromBanner();
window.dismissHMSError = () => window.appInit.dismissHMSError();
window.filamentChangeAction = (action) => window.appInit.filamentChangeAction(action);
window.spulenAntwort = (action, code) => window.appInit.spulenAntwort(action, code);
window.isHMSErrorDismissed = (c) => window.appInit.isHMSErrorDismissed(c);
window.clearDismissedHMSErrors = () => window.appInit.clearDismissedHMSErrors();
window.loadHMSStatus = () => window.appInit.loadHMSStatus();
window.loadPowerOffTimerStatus = () => window.appInit.loadPowerOffTimerStatus();
window.dismissMaintenanceBanner = () => window.appInit.dismissMaintenanceBanner();
window.showMaintenanceBanner = (t) => window.appInit.showMaintenanceBanner(t);
window.checkMaintenanceStatus = () => window.appInit.checkMaintenanceStatus();

// ============================================================
// Auto-init — call init() immediately
// ============================================================
window.appInit.init();
