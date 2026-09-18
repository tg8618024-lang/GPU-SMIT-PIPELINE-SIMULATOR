// ──────────────────────────────────────────────────────────────────────────────
// SIMT-Flow: Application Orchestrator & View Controller
// ──────────────────────────────────────────────────────────────────────────────
// Top-level controller that manages the simulation lifecycle (step, run, rewind,
// reset, speed), manages tabs, handles breakpoints, and updates views.
// ──────────────────────────────────────────────────────────────────────────────

import { parseAssembly, resolveLabels } from '../engine/parser.js';
import { CPUPipeline }   from '../engine/cpu_pipeline.js';
import { GPUPipeline }   from '../engine/gpu_pipeline.js';
import { BENCHMARKS, getBenchmarkById } from '../engine/benchmarks.js';
import { exportCPUtoVCD, exportGPUtoVCD, downloadVCD } from '../engine/vcd_exporter.js';
import { compileCToAssembly } from '../engine/c_compiler.js';
import { PipelineGrid }   from './pipeline_grid.js';
import { DatapathView }   from './datapath_view.js';
import { WarpLanesView }  from './warp_lanes_view.js';
import { TestRunner }     from './test_runner.js';
import { WaveformViewer } from './waveform_viewer.js';
import { SystolicView }   from './systolic_view.js';
import { AudioSynthesizer } from './audio_synthesizer.js';
import { TelemetryStream }  from './telemetry_stream.js';
import {
    RegisterView,
    MemoryView,
    HazardView,
    ProgramView,
    MetricsView,
    ComparisonView,
    StageInspectorView,
    CacheView,
    BranchPredictorView,
    SharedMemoryView,
} from './views.js';

const Mode = Object.freeze({ CPU: 'cpu', GPU: 'gpu' });

export class App {
    constructor() {
        // State
        this.mode = Mode.CPU;
        this.engine = null;         // CPUPipeline or GPUPipeline
        this.playing = false;
        this.playInterval = null;
        this.speed = 500;           // ms per cycle when playing

        // Active Tabs
        this.activeDatapathTab = 'schematic'; // 'schematic', 'waveform', 'systolic', 'program', 'comparison'
        this.activeStateTab = 'registers';   // 'registers', 'memory', 'caches', 'branch', 'shared', 'hazards', 'inspector', 'metrics'

        // Audio & Telemetry Systems
        this.audio = new AudioSynthesizer();
        this.telemetryStream = null;

        // DOM references
        this.els = {};

        // Views
        this.pipelineGrid        = null;
        this.datapathView        = null;
        this.warpLanesView       = null;
        this.testRunner          = null;
        this.waveformViewer      = null;
        this.systolicView        = null;
        this.registerView        = null;
        this.memoryView          = null;
        this.cacheView           = null;
        this.branchPredictorView = null;
        this.sharedMemoryView    = null;
        this.hazardView          = null;
        this.programView         = null;
        this.metricsView         = null;
        this.comparisonView      = null;
        this.stageInspectorView  = null;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════

    init() {
        this._cacheDOMRefs();
        this._initViews();
        this._bindEvents();
        this._populatePresets();
        this._loadDefaultBenchmark();
    }

    _cacheDOMRefs() {
        const q = (sel) => document.querySelector(sel);
        this.els = {
            // Mode toggle
            btnCPU:       q('#btn-mode-cpu'),
            btnGPU:       q('#btn-mode-gpu'),

            // Transport controls
            btnRewind:    q('#btn-rewind'),
            btnStep:      q('#btn-step'),
            btnPlay:      q('#btn-play'),
            btnReset:     q('#btn-reset'),
            speedSlider:  q('#speed-slider'),

            // Telemetry
            cycleDisplay:  q('#cycle-display'),
            cpiDisplay:    q('#cpi-display'),
            hazardDisplay: q('#hazard-display'),

            // Code editor & compiler
            tabBtnAsm:            q('#tab-btn-asm'),
            tabBtnC:              q('#tab-btn-c'),
            asmEditorContainer:   q('#asm-editor-container'),
            cEditorContainer:     q('#c-editor-container'),
            cCodeEditor:          q('#c-code-editor'),
            btnCompileC:          q('#btn-compile-c'),
            codeTextarea:         q('#code-editor'),
            presetSelect:         q('#preset-select'),
            fwdToggle:            q('#fwd-toggle'),
            fwdLabel:             q('#fwd-label'),
            cacheToggle:          q('#cache-toggle'),
            cacheLabel:           q('#cache-label'),
            cacheToggleWrapper:   q('#cache-toggle-wrapper'),
            bpToggle:             q('#bp-toggle'),
            bpLabel:              q('#bp-label'),
            bpToggleWrapper:      q('#bp-toggle-wrapper'),
            btnLoad:              q('#btn-load'),

            // View containers
            gridContainer:        q('#pipeline-grid-container'),
            datapathContainer:    q('#datapath-container'),
            waveformContainer:    q('#waveform-container'),
            systolicContainer:    q('#systolic-container'),
            programContainer:     q('#program-container'),
            comparisonContainer:  q('#comparison-container'),
            warpContainer:        q('#warp-lanes-container'),
            stateContainer:       q('#state-container'),

            // Tab Buttons
            datapathTabs: q('#datapath-tabs'),
            stateTabs:    q('#state-tabs'),

            // Panels
            panelDatapath:  q('#panel-datapath'),
            panelWarpLanes: q('#panel-warp-lanes'),

            // Hero & Nav
            heroBanner:         q('#hero-landing-banner'),
            heroDismissBtn:     q('#hero-dismiss-btn'),
            heroCtaWorkbench:   q('#hero-cta-workbench'),
            heroCtaTests:       q('#hero-cta-tests'),
            heroCtaCheatsheet:  q('#hero-cta-cheatsheet'),
            navBtnWorkbench:    q('#nav-btn-workbench'),
            navBtnHero:         q('#nav-btn-hero'),
            navBtnCheatsheet:   q('#nav-btn-cheatsheet'),
            navBtnTests:        q('#nav-btn-tests'),

            // Engine status LED
            engineStatusPill:   q('#engine-status-pill'),
            engineStatusDot:    q('#engine-status-dot'),
            engineStatusText:   q('#engine-status-text'),

            // Theme & Audio
            themeSelector:      q('#theme-selector'),
            btnAudioToggle:     q('#btn-audio-toggle'),

            // Cheat Sheet Modal
            cheatsheetModal:    q('#cheatsheet-modal'),
            btnCloseCheatsheet: q('#btn-close-cheatsheet'),

            // Telemetry Stream
            telemetryStreamContainer: q('#telemetry-stream-container'),

            // Quick view bar & App main
            quickViewBar:       q('#quick-view-bar'),
            appMain:            q('#app-main'),

            // Export & Test
            btnExportVCD:  q('#btn-export-vcd'),
            btnRunTests:   q('#btn-run-tests'),
            testModal:     q('#test-modal'),
        };
    }

    _initViews() {
        this.pipelineGrid = new PipelineGrid(this.els.gridContainer);

        // Telemetry Stream
        if (this.els.telemetryStreamContainer) {
            this.telemetryStream = new TelemetryStream(this.els.telemetryStreamContainer);
        }

        // Apply theme from localStorage
        const savedTheme = localStorage.getItem('simt_theme') || 'nvidia';
        document.documentElement.setAttribute('data-theme', savedTheme);
        if (this.els.themeSelector) {
            this.els.themeSelector.value = savedTheme;
        }
        this._updateAudioBtn();

        // Datapath view with stage click handler -> switches to Stage Inspector
        this.datapathView = new DatapathView(this.els.datapathContainer, (stageName) => {
            this._switchStateTab('inspector');
            if (this.stageInspectorView) {
                this.stageInspectorView.selectedStage = stageName;
                if (this.engine) {
                    this.stageInspectorView.render(this.engine.getCurrentSnapshot());
                }
            }
        });

        // Digital Logic Waveform Viewer
        this.waveformViewer = new WaveformViewer(this.els.waveformContainer, (cycle) => {
            this._goToCycle(cycle);
        });

        // 4x4 Tensor Core Systolic Array View
        this.systolicView = new SystolicView(this.els.systolicContainer);

        this.warpLanesView = new WarpLanesView(this.els.warpContainer);
        this.testRunner    = new TestRunner(this.els.testModal, (passed, failed) => {
            if (failed === 0) {
                this.audio.playFanfare();
            }
        });

        // Specialized State & Subsystem Views
        this.registerView = new RegisterView(this.els.stateContainer, (regIdx, newVal) => {
            if (this.engine && this.mode === Mode.CPU && this.engine.registers) {
                if (regIdx > 0 && regIdx < 8) {
                    this.engine.registers[regIdx] = newVal;
                    this._render();
                }
            }
        });
        this.memoryView = new MemoryView(this.els.stateContainer, (addr, newVal) => {
            if (this.engine && this.mode === Mode.CPU && this.engine.memory) {
                if (addr >= 0 && addr < 256) {
                    this.engine.memory[addr] = newVal;
                    this._render();
                }
            }
        });
        this.cacheView           = new CacheView(this.els.stateContainer);
        this.branchPredictorView = new BranchPredictorView(this.els.stateContainer);
        this.sharedMemoryView    = new SharedMemoryView(this.els.stateContainer, (sched) => {
            if (this.engine && this.mode === Mode.GPU) {
                this.engine.schedulerType = sched;
                this._render();
            }
        });
        this.hazardView         = new HazardView(this.els.stateContainer);
        this.metricsView        = new MetricsView(this.els.stateContainer);
        this.stageInspectorView = new StageInspectorView(this.els.stateContainer);

        // Program Disassembly View (with breakpoint toggle callback)
        this.programView = new ProgramView(this.els.programContainer, (byteAddr) => {
            if (this.engine && this.engine.toggleBreakpoint) {
                this.engine.toggleBreakpoint(byteAddr);
                this._render();
            }
        });

        // Comparison View
        this.comparisonView = new ComparisonView(this.els.comparisonContainer);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // EVENT BINDING
    // ═══════════════════════════════════════════════════════════════════════

    _bindEvents() {
        // Mode toggle
        this.els.btnCPU.addEventListener('click', () => this._setMode(Mode.CPU));
        this.els.btnGPU.addEventListener('click', () => this._setMode(Mode.GPU));

        // Transport controls
        this.els.btnStep.addEventListener('click',   () => this._stepForward());
        this.els.btnRewind.addEventListener('click',  () => this._stepBackward());
        this.els.btnPlay.addEventListener('click',    () => this._togglePlay());
        this.els.btnReset.addEventListener('click',   () => this._reset());

        // Speed slider
        this.els.speedSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            this.speed = Math.max(50, 1050 - val * 100);
            if (this.playing) {
                this._stopPlay();
                this._startPlay();
            }
        });

        // Assembly / C Editor Tab Switching
        if (this.els.tabBtnAsm && this.els.tabBtnC) {
            this.els.tabBtnAsm.addEventListener('click', () => {
                this.els.tabBtnAsm.classList.add('active');
                this.els.tabBtnC.classList.remove('active');
                if (this.els.asmEditorContainer) this.els.asmEditorContainer.style.display = 'flex';
                if (this.els.cEditorContainer) this.els.cEditorContainer.style.display = 'none';
            });

            this.els.tabBtnC.addEventListener('click', () => {
                this.els.tabBtnC.classList.add('active');
                this.els.tabBtnAsm.classList.remove('active');
                if (this.els.asmEditorContainer) this.els.asmEditorContainer.style.display = 'none';
                if (this.els.cEditorContainer) this.els.cEditorContainer.style.display = 'flex';
            });
        }

        // Micro-C Compile & Load
        if (this.els.btnCompileC) {
            this.els.btnCompileC.addEventListener('click', () => {
                const cSource = this.els.cCodeEditor ? this.els.cCodeEditor.value : '';
                try {
                    const asmOutput = compileCToAssembly(cSource);
                    this.els.codeTextarea.value = asmOutput;
                    // Switch back to assembly tab to show the compiled instructions
                    if (this.els.tabBtnAsm) this.els.tabBtnAsm.click();
                    this._loadProgram();
                    this._clearError();
                } catch (err) {
                    this._showError(`C Compiler: ${err.message}`);
                }
            });
        }

        // Forwarding toggle
        this.els.fwdToggle.addEventListener('change', () => {
            if (this.engine && this.mode === Mode.CPU) {
                this.engine.forwardingEnabled = this.els.fwdToggle.checked;
                this.els.fwdLabel.textContent = this.els.fwdToggle.checked ? 'ON' : 'OFF';
                this._reset();
            }
        });

        // L1 Cache Stalls toggle
        if (this.els.cacheToggle) {
            this.els.cacheToggle.addEventListener('change', () => {
                const enabled = this.els.cacheToggle.checked;
                if (this.els.cacheLabel) this.els.cacheLabel.textContent = enabled ? 'ON' : 'OFF';
                if (this.engine && this.mode === Mode.CPU) {
                    if (this.engine.l1iCache) this.engine.l1iCache.enabled = enabled;
                    if (this.engine.l1dCache) this.engine.l1dCache.enabled = enabled;
                    this._reset();
                }
            });
        }

        // 2-Bit Branch Predictor toggle
        if (this.els.bpToggle) {
            this.els.bpToggle.addEventListener('change', () => {
                const enabled = this.els.bpToggle.checked;
                if (this.els.bpLabel) this.els.bpLabel.textContent = enabled ? 'ON' : 'OFF';
                if (this.engine && this.mode === Mode.CPU) {
                    if (this.engine.branchPredictor) this.engine.branchPredictor.enabled = enabled;
                    this._reset();
                }
            });
        }

        // Load / Assemble button
        this.els.btnLoad.addEventListener('click', () => this._loadProgram());

        // Preset selector
        this.els.presetSelect.addEventListener('change', () => {
            const id = this.els.presetSelect.value;
            if (id) {
                const bench = getBenchmarkById(id);
                if (bench) {
                    this.els.codeTextarea.value = bench.assembly;
                    if (bench.mode !== this.mode) {
                        this._setMode(bench.mode);
                    }
                    if (bench.mode === 'cpu') {
                        if (bench.forwardingEnabled !== undefined) {
                            this.els.fwdToggle.checked = bench.forwardingEnabled;
                            this.els.fwdLabel.textContent = bench.forwardingEnabled ? 'ON' : 'OFF';
                        }
                        if (bench.l1dEnabled !== undefined && this.els.cacheToggle) {
                            this.els.cacheToggle.checked = bench.l1dEnabled;
                            if (this.els.cacheLabel) this.els.cacheLabel.textContent = bench.l1dEnabled ? 'ON' : 'OFF';
                        }
                        if (bench.branchPredictorEnabled !== undefined && this.els.bpToggle) {
                            this.els.bpToggle.checked = bench.branchPredictorEnabled;
                            if (this.els.bpLabel) this.els.bpLabel.textContent = bench.branchPredictorEnabled ? 'ON' : 'OFF';
                        }
                    } else if (bench.mode === 'gpu') {
                        if (bench.schedulerType && this.engine) {
                            this.engine.schedulerType = bench.schedulerType;
                        }
                    }
                    this._loadProgram();
                }
            }
        });

        // Tab Switching: Datapath panel
        if (this.els.datapathTabs) {
            this.els.datapathTabs.querySelectorAll('.tab-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    this._switchDatapathTab(e.target.dataset.tab);
                });
            });
        }

        // Tab Switching: State panel
        if (this.els.stateTabs) {
            this.els.stateTabs.querySelectorAll('.tab-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    this._switchStateTab(e.target.dataset.tab);
                });
            });
        }

        // Export VCD
        this.els.btnExportVCD.addEventListener('click', () => this._exportVCD());

        // Run Verification Tests
        this.els.btnRunTests.addEventListener('click', () => {
            this.testRunner.show();
            this.testRunner.runAll();
        });

        // Hero Landing Banner Interactions
        this.els.heroDismissBtn?.addEventListener('click', () => {
            this.els.heroBanner?.classList.add('hero-hidden');
        });
        this.els.heroCtaWorkbench?.addEventListener('click', () => {
            this.els.heroBanner?.classList.add('hero-hidden');
            this.els.quickViewBar?.scrollIntoView({ behavior: 'smooth' });
        });
        this.els.heroCtaTests?.addEventListener('click', () => {
            this.testRunner.show();
            this.testRunner.runAll();
        });
        this.els.heroCtaCheatsheet?.addEventListener('click', () => {
            this._openCheatsheet();
        });

        // Top Navigation Bar
        this.els.navBtnWorkbench?.addEventListener('click', () => {
            this.els.quickViewBar?.scrollIntoView({ behavior: 'smooth' });
        });
        this.els.navBtnHero?.addEventListener('click', () => {
            this.els.heroBanner?.classList.toggle('hero-hidden');
            this.els.heroBanner?.scrollIntoView({ behavior: 'smooth' });
        });
        this.els.navBtnCheatsheet?.addEventListener('click', () => {
            this._openCheatsheet();
        });
        this.els.navBtnTests?.addEventListener('click', () => {
            this.testRunner.show();
            this.testRunner.runAll();
        });

        // Theme Selector
        this.els.themeSelector?.addEventListener('change', (e) => {
            const theme = e.target.value;
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem('simt_theme', theme);
        });

        // Audio Toggle
        this.els.btnAudioToggle?.addEventListener('click', () => {
            const enabled = this.audio.toggle();
            this._updateAudioBtn();
            if (enabled) this.audio.playClick();
        });

        // Cheat Sheet Modal Close
        this.els.btnCloseCheatsheet?.addEventListener('click', () => {
            this._closeCheatsheet();
        });
        this.els.cheatsheetModal?.addEventListener('click', (e) => {
            if (e.target === this.els.cheatsheetModal) {
                this._closeCheatsheet();
            }
        });

        // Ergonomic Quick-Access View Pills (No Zooming Needed)
        document.querySelectorAll('.view-pill').forEach(pill => {
            pill.addEventListener('click', (e) => {
                document.querySelectorAll('.view-pill').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                this._setFocusView(pill.dataset.view);
            });
        });

        // Panel Maximize Buttons
        document.querySelectorAll('.panel-btn-maximize').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetId = btn.dataset.target;
                const panel = document.getElementById(targetId);
                if (panel) {
                    const isMax = panel.classList.toggle('panel-maximized');
                    btn.textContent = isMax ? '🗗 Restore' : '⛶ Maximize';
                }
            });
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
            switch (e.key) {
                case 'ArrowRight': case 'n': e.preventDefault(); this._stepForward(); break;
                case 'ArrowLeft':  case 'p': e.preventDefault(); this._stepBackward(); break;
                case ' ':          e.preventDefault(); this._togglePlay(); break;
                case 'r':          e.preventDefault(); this._reset(); break;
                case 'Escape':     this._closeCheatsheet(); this.testRunner?.hide(); break;
            }
        });
    }

    _openCheatsheet() {
        if (this.els.cheatsheetModal) this.els.cheatsheetModal.classList.remove('hidden');
    }

    _closeCheatsheet() {
        if (this.els.cheatsheetModal) this.els.cheatsheetModal.classList.add('hidden');
    }

    _updateAudioBtn() {
        if (this.els.btnAudioToggle) {
            const on = this.audio && this.audio.enabled;
            this.els.btnAudioToggle.textContent = on ? '🔊 SFX' : '🔇 SFX';
            this.els.btnAudioToggle.title = on ? 'Tactile Sound Effects: Enabled (Click to Mute)' : 'Tactile Sound Effects: Muted (Click to Enable)';
            this.els.btnAudioToggle.style.opacity = on ? '1' : '0.6';
        }
    }

    _setFocusView(view) {
        if (!this.els.appMain) return;
        this.els.appMain.classList.remove('focus-datapath', 'focus-grid', 'focus-state', 'focus-compiler');
        if (view === 'datapath') this.els.appMain.classList.add('focus-datapath');
        else if (view === 'grid') this.els.appMain.classList.add('focus-grid');
        else if (view === 'state') this.els.appMain.classList.add('focus-state');
        else if (view === 'compiler') this.els.appMain.classList.add('focus-compiler');
    }

    _switchDatapathTab(tabId) {
        this.activeDatapathTab = tabId;
        if (this.els.datapathTabs) {
            this.els.datapathTabs.querySelectorAll('.tab-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.tab === tabId);
            });
        }

        if (this.els.datapathContainer)   this.els.datapathContainer.style.display   = tabId === 'schematic' ? '' : 'none';
        if (this.els.waveformContainer)   this.els.waveformContainer.style.display   = tabId === 'waveform' ? '' : 'none';
        if (this.els.systolicContainer)   this.els.systolicContainer.style.display   = tabId === 'systolic' ? '' : 'none';
        if (this.els.programContainer)    this.els.programContainer.style.display    = tabId === 'program' ? '' : 'none';
        if (this.els.comparisonContainer) this.els.comparisonContainer.style.display = tabId === 'comparison' ? '' : 'none';

        this._render();
    }

    _switchStateTab(tabId) {
        this.activeStateTab = tabId;
        if (this.els.stateTabs) {
            this.els.stateTabs.querySelectorAll('.tab-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.tab === tabId);
            });
        }
        this._render();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // MODE SWITCHING
    // ═══════════════════════════════════════════════════════════════════════

    _setMode(mode) {
        this.mode = mode;
        this._stopPlay();

        // Update toggle buttons
        this.els.btnCPU.classList.toggle('active', mode === Mode.CPU);
        this.els.btnGPU.classList.toggle('active', mode === Mode.GPU);

        // Show/hide mode-specific panels
        if (this.els.panelDatapath) {
            this.els.panelDatapath.style.display  = mode === Mode.CPU ? '' : 'none';
        }
        if (this.els.panelWarpLanes) {
            this.els.panelWarpLanes.style.display = mode === Mode.GPU ? '' : 'none';
        }

        // Show/hide CPU-only feature toggles
        const fwdGroup = this.els.fwdToggle?.closest('.toggle-group');
        if (fwdGroup) {
            fwdGroup.style.display = mode === Mode.CPU ? '' : 'none';
        }
        if (this.els.cacheToggleWrapper) {
            this.els.cacheToggleWrapper.style.display = mode === Mode.CPU ? '' : 'none';
        }
        if (this.els.bpToggleWrapper) {
            this.els.bpToggleWrapper.style.display = mode === Mode.CPU ? '' : 'none';
        }

        this._populatePresets();
        this._loadDefaultBenchmark();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PROGRAM LOADING
    // ═══════════════════════════════════════════════════════════════════════

    _populatePresets() {
        const sel = this.els.presetSelect;
        sel.innerHTML = '<option value="">— Select Preset —</option>';
        BENCHMARKS
            .filter(b => b.mode === this.mode)
            .forEach(b => {
                const opt = document.createElement('option');
                opt.value = b.id;
                opt.textContent = b.name;
                sel.appendChild(opt);
            });
    }

    _loadDefaultBenchmark() {
        const defaultBench = BENCHMARKS.find(b => b.mode === this.mode);
        if (defaultBench) {
            this.els.codeTextarea.value = defaultBench.assembly;
            this.els.presetSelect.value = defaultBench.id;
            if (this.mode === 'cpu') {
                if (defaultBench.forwardingEnabled !== undefined) {
                    this.els.fwdToggle.checked = defaultBench.forwardingEnabled;
                    this.els.fwdLabel.textContent = defaultBench.forwardingEnabled ? 'ON' : 'OFF';
                }
                if (defaultBench.l1dEnabled !== undefined && this.els.cacheToggle) {
                    this.els.cacheToggle.checked = defaultBench.l1dEnabled;
                    if (this.els.cacheLabel) this.els.cacheLabel.textContent = defaultBench.l1dEnabled ? 'ON' : 'OFF';
                }
                if (defaultBench.branchPredictorEnabled !== undefined && this.els.bpToggle) {
                    this.els.bpToggle.checked = defaultBench.branchPredictorEnabled;
                    if (this.els.bpLabel) this.els.bpLabel.textContent = defaultBench.branchPredictorEnabled ? 'ON' : 'OFF';
                }
            }
            this._loadProgram();
        }
    }

    _loadProgram() {
        this._stopPlay();
        const source = this.els.codeTextarea.value;

        try {
            const { instructions, labels } = parseAssembly(source);
            const resolved = resolveLabels(instructions, labels);

            if (this.mode === Mode.CPU) {
                this.engine = new CPUPipeline(resolved, labels);
                this.engine.forwardingEnabled = this.els.fwdToggle.checked;
                if (this.engine.l1iCache) this.engine.l1iCache.enabled = this.els.cacheToggle?.checked || false;
                if (this.engine.l1dCache) this.engine.l1dCache.enabled = this.els.cacheToggle?.checked || false;
                if (this.engine.branchPredictor) this.engine.branchPredictor.enabled = this.els.bpToggle?.checked || false;
            } else {
                this.engine = new GPUPipeline(resolved, labels);
                const bench = getBenchmarkById(this.els.presetSelect?.value);
                if (bench?.schedulerType) {
                    this.engine.schedulerType = bench.schedulerType;
                }
            }

            this.engine.reset();
            this._render();
            this._clearError();
        } catch (err) {
            this._showError(err.message);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TRANSPORT CONTROLS
    // ═══════════════════════════════════════════════════════════════════════

    _stepForward() {
        if (!this.engine || this.engine.isHalted) return;
        this.audio.playClick();
        this.engine.stepForward();
        this._render();
    }

    _stepBackward() {
        if (!this.engine || this.engine.currentCycle <= 0) return;
        this.audio.playRewind();
        this.engine.stepBackward();
        this._render();
    }

    /**
     * Jump/scrub to a specific clock cycle in history (powered by Waveform clicks).
     */
    _goToCycle(targetCycle) {
        if (!this.engine) return;
        this._stopPlay();
        const maxCycle = Math.max(0, this.engine.getHistory().length - 1);
        const clampedTarget = Math.max(0, Math.min(targetCycle, maxCycle));

        while (this.engine.currentCycle > clampedTarget) {
            this.engine.stepBackward();
        }
        while (this.engine.currentCycle < clampedTarget && !this.engine.isHalted) {
            this.engine.stepForward();
        }
        this._render();
    }

    _togglePlay() {
        if (this.playing) {
            this._stopPlay();
        } else {
            this._startPlay();
        }
    }

    _startPlay() {
        if (!this.engine || this.engine.isHalted) return;
        this.playing = true;
        this.els.btnPlay.textContent = '⏸';
        this.els.btnPlay.classList.add('active');

        this.playInterval = setInterval(() => {
            if (!this.engine || this.engine.isHalted) {
                this._stopPlay();
                return;
            }

            // Check Breakpoints in CPU mode
            if (this.mode === Mode.CPU && this.engine.breakpoints && this.engine.breakpoints.has(this.engine.pc)) {
                this._stopPlay();
                alert(`🛑 Breakpoint hit at PC 0x${this.engine.pc.toString(16).toUpperCase().padStart(4, '0')}`);
                return;
            }

            this.engine.stepForward();
            this._render();
        }, this.speed);
    }

    _stopPlay() {
        this.playing = false;
        if (this.playInterval) {
            clearInterval(this.playInterval);
            this.playInterval = null;
        }
        if (this.els.btnPlay) {
            this.els.btnPlay.textContent = '▶';
            this.els.btnPlay.classList.remove('active');
        }
    }

    _reset() {
        this._stopPlay();
        if (this.engine) {
            this.engine.reset();
            this._render();
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RENDERING
    // ═══════════════════════════════════════════════════════════════════════

    _render() {
        if (!this.engine) return;

        const snap = this.engine.getCurrentSnapshot();

        // Telemetry Stream Recording
        if (this.telemetryStream) {
            this.telemetryStream.recordSnapshot(snap);
        }

        // Global Engine Status LED & Sound Triggers
        const isHazard = (snap.hazard && snap.hazard !== 'NONE') || snap.stall || snap.flush;
        if (isHazard) {
            if (this.els.engineStatusDot) this.els.engineStatusDot.className = 'status-dot status-hazard';
            if (this.els.engineStatusText) this.els.engineStatusText.textContent = 'HAZARD STALL';
            this.audio.playHazard();
        } else if (this.engine.isHalted) {
            if (this.els.engineStatusDot) this.els.engineStatusDot.className = 'status-dot status-halted';
            if (this.els.engineStatusText) this.els.engineStatusText.textContent = 'HALTED';
        } else if (this.playing) {
            if (this.els.engineStatusDot) this.els.engineStatusDot.className = 'status-dot status-running';
            if (this.els.engineStatusText) this.els.engineStatusText.textContent = 'RUNNING';
        } else {
            if (this.els.engineStatusDot) this.els.engineStatusDot.className = 'status-dot status-ready';
            if (this.els.engineStatusText) this.els.engineStatusText.textContent = 'READY';
        }

        // Telemetry
        this.els.cycleDisplay.textContent = snap.cycle;
        if (this.mode === Mode.CPU) {
            const cpi = this.engine.cpi;
            this.els.cpiDisplay.textContent = isFinite(cpi) && cpi > 0 ? cpi.toFixed(2) : '—';
            this.els.hazardDisplay.textContent = snap.hazard || 'NONE';
            this.els.hazardDisplay.className = 'telemetry-value' +
                (snap.hazard !== 'NONE' ? ' hazard-active' : '');
        } else {
            const activeWarps = snap.warps.filter(w => w.state !== 'FINISHED').length;
            this.els.cpiDisplay.textContent = `${activeWarps} active`;
            const scheduled = snap.schedulerChoice !== null ? `W${snap.schedulerChoice}` : 'IDLE';
            this.els.hazardDisplay.textContent = scheduled;
            this.els.hazardDisplay.className = 'telemetry-value';
        }

        // Pipeline Grid
        this._updateGrid(snap);

        // Render Active Datapath Tab
        if (this.activeDatapathTab === 'schematic') {
            if (this.mode === Mode.CPU) {
                this.datapathView.update(snap);
            }
        } else if (this.activeDatapathTab === 'waveform') {
            this.waveformViewer.render(this.engine.getHistory(), snap.cycle);
        } else if (this.activeDatapathTab === 'systolic') {
            this.systolicView.render();
        } else if (this.activeDatapathTab === 'program') {
            this.programView.render(snap, this.engine.instructions, this.engine.breakpoints);
        } else if (this.activeDatapathTab === 'comparison') {
            this.comparisonView.render();
        }

        // Render Active State Tab
        if (this.mode === Mode.CPU) {
            this._renderActiveStateTab(snap);
        } else {
            // GPU Mode View
            this.warpLanesView.update(snap);
            if (this.activeStateTab === 'shared') {
                this.sharedMemoryView.render(snap);
            } else if (this.activeStateTab === 'metrics') {
                this.metricsView.render(snap);
            } else {
                this._renderGPUState(snap);
            }
        }
    }

    _renderActiveStateTab(snap) {
        switch (this.activeStateTab) {
            case 'registers':
                this.registerView.render(snap, this.engine.regHistory);
                break;
            case 'memory':
                this.memoryView.render(snap);
                break;
            case 'caches':
                this.cacheView.render(snap);
                break;
            case 'branch':
                this.branchPredictorView.render(snap);
                break;
            case 'shared':
                this.sharedMemoryView.render(snap);
                break;
            case 'hazards':
                this.hazardView.render(snap);
                break;
            case 'inspector':
                this.stageInspectorView.render(snap);
                break;
            case 'metrics':
                this.metricsView.render(snap);
                break;
            default:
                this.registerView.render(snap, this.engine.regHistory);
                break;
        }
    }

    _renderGPUState(snap) {
        const container = this.els.stateContainer;
        if (!container) return;

        let html = '<div class="state-section"><h3>Register Scoreboard</h3>';
        for (let w = 0; w < snap.warps.length; w++) {
            const busy = snap.scoreboard[w] || new Set();
            html += `<div class="scoreboard-row"><span class="warp-label">W${w}</span><div class="scoreboard-bits">`;
            for (let r = 0; r < 8; r++) {
                const isBusy = busy.has(r);
                html += `<span class="scoreboard-bit ${isBusy ? 'scoreboard-busy' : 'scoreboard-free'}" title="R${r}">${isBusy ? '●' : '○'}</span>`;
            }
            html += '</div></div>';
        }
        html += '</div>';

        // SIMT Divergence Stack
        html += '<div class="state-section"><h3>SIMT Divergence Stack</h3>';
        for (let w = 0; w < snap.warps.length; w++) {
            const warp = snap.warps[w];
            if (warp.divergenceStack.length > 0) {
                html += `<div class="divergence-stack"><span class="warp-label">W${w}</span>`;
                for (const frame of warp.divergenceStack) {
                    html += `<div class="stack-frame"><span class="stack-pc">Reconverge PC: ${frame.reconvergePC}</span></div>`;
                }
                html += '</div>';
            }
        }
        html += '</div>';

        // Memory Coalescing
        if (snap.coalescingResult) {
            const cr = snap.coalescingResult;
            html += '<div class="state-section"><h3>Memory Coalescing</h3>';
            html += `<div class="coalescing-result ${cr.coalesced ? 'coalescing-good' : 'coalescing-bad'}">`;
            html += `<span>${cr.coalesced ? '✓ Coalesced Access' : '✗ Uncoalesced Access'}</span>`;
            html += `<span>${cr.transactions} memory transaction(s)</span>`;
            html += `<div class="coalescing-addrs">Addresses: [${cr.addresses.join(', ')}]</div>`;
            html += '</div></div>';
        }

        container.innerHTML = html;
    }

    _updateGrid(snap) {
        if (!this.engine) return;

        const history = this.engine.getHistory();
        const gridData = this._buildGridData(history);
        const instructions = this.mode === Mode.CPU
            ? this._getCPUInstructions()
            : this._getGPUInstructions(snap);

        this.pipelineGrid.update({
            instructions,
            gridData,
            currentCycle: snap.cycle,
            totalCycles: history.length,
        });
    }

    _buildGridData(history) {
        const gridData = {};

        for (const snap of history) {
            if (snap.type === 'cpu') {
                if (snap.grid && snap.grid.length > 0) {
                    for (const entry of snap.grid) {
                        const idx = entry.id ?? 0;
                        if (!gridData[idx]) gridData[idx] = {};
                        if (entry.cells) {
                            for (let c = 0; c < entry.cells.length; c++) {
                                const cell = entry.cells[c];
                                if (cell && cell.stage) {
                                    gridData[idx][c] = {
                                        stage: cell.stage,
                                        isForwarding: cell.isForwarding || false,
                                        hazardType: cell.hazardType || 'NONE',
                                    };
                                }
                            }
                        }
                    }
                }
            } else if (snap.type === 'gpu') {
                for (const wis of (snap.warpInstructionStages || [])) {
                    const key = `W${wis.warpId}_${wis.instructionIndex ?? 0}`;
                    if (!gridData[key]) gridData[key] = {};
                    gridData[key][snap.cycle] = {
                        stage: wis.stage,
                        isForwarding: false,
                        hazardType: 'NONE',
                    };
                }
            }
        }

        return gridData;
    }

    _getCPUInstructions() {
        if (!this.engine || !this.engine.instructions) return [];
        return this.engine.instructions.map((instr, i) => ({
            index: i,
            text: instr.raw || `Instr ${i}`,
        }));
    }

    _getGPUInstructions(snap) {
        if (!snap || !snap.warps) return [];
        const instructions = [];
        const program = this.engine?.instructions || [];
        for (let w = 0; w < snap.warps.length; w++) {
            for (let i = 0; i < program.length; i++) {
                instructions.push({
                    index: `W${w}_${i}`,
                    text: `W${w}: ${program[i].raw || `Instr ${i}`}`,
                });
            }
        }
        return instructions;
    }

    _exportVCD() {
        if (!this.engine) return;
        const history = this.engine.getHistory();
        let vcd, filename;

        if (this.mode === Mode.CPU) {
            vcd = exportCPUtoVCD(history);
            filename = 'cpu_pipeline_trace.vcd';
        } else {
            vcd = exportGPUtoVCD(history);
            filename = 'gpu_sm_trace.vcd';
        }

        if (vcd) {
            downloadVCD(vcd, filename);
        }
    }

    _showError(msg) {
        let errEl = document.querySelector('.error-banner');
        if (!errEl) {
            errEl = document.createElement('div');
            errEl.className = 'error-banner';
            document.querySelector('.app-header')?.after(errEl);
        }
        errEl.textContent = `⚠ Assembler Error: ${msg}`;
        errEl.style.display = 'block';
    }

    _clearError() {
        const errEl = document.querySelector('.error-banner');
        if (errEl) errEl.style.display = 'none';
    }
}
