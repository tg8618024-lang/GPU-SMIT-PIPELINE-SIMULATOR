// ──────────────────────────────────────────────────────────────────────────────
// SIMT-Flow: Specialized UI Views & Visualizers
// ──────────────────────────────────────────────────────────────────────────────
// Implements:
//   - RegisterView: Live register file (Hex, Dec, Bin, Producer, Changed flash)
//   - MemoryView: Interactive data memory grid with read/write highlights
//   - HazardView: Dedicated hazard & forwarding diagnostic panel
//   - ProgramView: Instruction panel with addresses, machine code, breakpoints
//   - MetricsView: Performance dashboard (CPI, IPC, utilization, cycles lost)
//   - ComparisonView: Technical CPU vs GPU comparison breakdown
//   - StageInspectorView: Deep signal inspection of latches & control lines
// ──────────────────────────────────────────────────────────────────────────────

import { ForwardSrc, HazardType, NUM_REGISTERS, MEM_SIZE } from '../engine/types.js';

// ──────────────────────────────────────────────────────────────────────────────
// 1. REGISTER FILE VIEWER
// ──────────────────────────────────────────────────────────────────────────────
export class RegisterView {
    constructor(container, onRegisterChange = null) {
        this.container = container;
        this.onRegisterChange = onRegisterChange;
        this.prevRegisters = new Array(NUM_REGISTERS).fill(0);
        this.displayFormat = 'dec'; // 'dec', 'hex', 'bin'
    }

    render(snap, regHistory = []) {
        if (!this.container) return;
        const regs = snap.registers || [];

        let html = `
            <div class="view-header">
                <div class="view-title">Architectural Register File (R0..R7)</div>
                <div class="format-toggles">
                    <button class="fmt-btn ${this.displayFormat === 'dec' ? 'active' : ''}" data-fmt="dec">DEC</button>
                    <button class="fmt-btn ${this.displayFormat === 'hex' ? 'active' : ''}" data-fmt="hex">HEX</button>
                    <button class="fmt-btn ${this.displayFormat === 'bin' ? 'active' : ''}" data-fmt="bin">BIN</button>
                </div>
            </div>
            <div class="reg-table-container">
                <table class="reg-table">
                    <thead>
                        <tr>
                            <th>Reg</th>
                            <th>Value</th>
                            <th>Hex</th>
                            <th>Binary</th>
                            <th>Last Mod</th>
                            <th>Producer</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        for (let i = 0; i < NUM_REGISTERS; i++) {
            const val = regs[i] ?? 0;
            const changed = val !== this.prevRegisters[i] && snap.cycle > 0;
            const hist = regHistory[i] || { lastModifiedCycle: 0, producerInstruction: '—' };

            let valStr = val.toString();
            if (this.displayFormat === 'hex') {
                valStr = '0x' + (val >>> 0).toString(16).toUpperCase().padStart(8, '0');
            } else if (this.displayFormat === 'bin') {
                valStr = (val >>> 0).toString(2).padStart(32, '0').match(/.{1,8}/g).join(' ');
            }

            const hexStr = '0x' + (val >>> 0).toString(16).toUpperCase().padStart(8, '0');
            const binStr = (val >>> 0).toString(2).padStart(32, '0').match(/.{1,8}/g).join(' ');

            html += `
                <tr class="${changed ? 'reg-changed-flash' : ''}">
                    <td class="reg-label mono font-bold">R${i} ${i === 0 ? '<span class="reg-zero-tag">[HARDWIRED $zero]</span>' : ''}</td>
                    <td class="reg-val mono ${changed ? 'val-highlight' : ''}" data-reg="${i}" title="${i === 0 ? 'R0 is read-only zero' : 'Click to edit register value'}" style="${i > 0 ? 'cursor: pointer;' : ''}">${valStr}</td>
                    <td class="reg-hex mono">${hexStr}</td>
                    <td class="reg-bin mono text-xs">${binStr}</td>
                    <td class="reg-cycle">C${hist.lastModifiedCycle || 0}</td>
                    <td class="reg-prod mono text-truncate" title="${hist.producerInstruction || '—'}">${hist.producerInstruction || '—'}</td>
                </tr>
            `;
        }

        html += `
                    </tbody>
                </table>
            </div>
        `;

        this.container.innerHTML = html;
        this.prevRegisters = [...regs];

        // Bind format toggles
        this.container.querySelectorAll('.fmt-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.displayFormat = e.target.dataset.fmt;
                this.render(snap, regHistory);
            });
        });

        // Bind interactive register editing
        if (this.onRegisterChange) {
            this.container.querySelectorAll('.reg-val').forEach(td => {
                td.addEventListener('click', (e) => {
                    const regIdx = parseInt(e.currentTarget.dataset.reg, 10);
                    if (regIdx === 0) return; // R0 is hardwired 0
                    const currentVal = regs[regIdx] ?? 0;
                    const input = prompt(`Enter new value for R${regIdx} (Decimal or 0xHex):`, currentVal);
                    if (input !== null && input.trim() !== '') {
                        const parsed = input.startsWith('0x') || input.startsWith('0X') ? parseInt(input, 16) : parseInt(input, 10);
                        if (!isNaN(parsed)) {
                            this.onRegisterChange(regIdx, parsed);
                        }
                    }
                });
            });
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// 2. INTERACTIVE MEMORY VIEWER
// ──────────────────────────────────────────────────────────────────────────────
export class MemoryView {
    constructor(container, onMemoryChange = null) {
        this.container = container;
        this.onMemoryChange = onMemoryChange;
        this.searchAddr = 0;
        this.pageSize = 32;
        this.page = 0;
    }

    render(snap) {
        if (!this.container) return;
        const mem = snap.memory || [];
        const activeAddr = snap.activeSignals?.memAddress;
        const isRead = snap.EX_MEM?.memRead;
        const isWrite = snap.EX_MEM?.memWrite;
        const activeInst = snap.stageInstructions?.MEM?.raw || snap.EX_MEM?.instruction?.raw;

        const start = this.page * this.pageSize;
        const end = Math.min(start + this.pageSize, MEM_SIZE);

        let html = `
            <div class="view-header">
                <div class="view-title">Data Memory (256 Words / 1 KB)</div>
                <div class="mem-controls" style="display: flex; gap: 8px; align-items: center;">
                    <div class="mem-search-wrap" style="display: flex; gap: 4px;">
                        <input type="text" id="mem-search-input" class="mem-search-input" style="background: #11141e; border: 1px solid #334155; color: #fff; padding: 2px 6px; font-size: 11px; width: 110px; border-radius: 4px;" placeholder="Addr (e.g. 16/0x10)" value="${this.searchAddr !== null && this.searchAddr !== undefined && this.searchAddr > 0 ? this.searchAddr : ''}">
                        <button class="mem-search-btn" id="mem-search-btn" style="background: #1e293b; border: 1px solid #475569; color: #94a3b8; padding: 2px 6px; font-size: 11px; border-radius: 4px; cursor: pointer;">Go</button>
                    </div>
                    <div class="mem-pagination">
                        <button class="mem-page-btn" id="mem-prev" ${this.page === 0 ? 'disabled' : ''}>◀</button>
                        <span class="mem-page-label">Words ${start}..${end - 1}</span>
                        <button class="mem-page-btn" id="mem-next" ${end >= MEM_SIZE ? 'disabled' : ''}>▶</button>
                    </div>
                </div>
            </div>
            <div class="mem-grid-container">
                <table class="mem-table">
                    <thead>
                        <tr>
                            <th>Address</th>
                            <th>Hex</th>
                            <th>Dec</th>
                            <th>Binary</th>
                            <th>ASCII</th>
                            <th>Active Access</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        for (let a = start; a < end; a++) {
            const val = mem[a] ?? 0;
            const isActive = activeAddr === a;
            let accessTag = '—';
            let rowClass = '';

            if (isActive) {
                if (isWrite) {
                    accessTag = `<span class="badge badge-red">WRITE: ${val} (${activeInst || 'SW'})</span>`;
                    rowClass = 'mem-write-active';
                } else if (isRead) {
                    accessTag = `<span class="badge badge-green">READ: ${val} (${activeInst || 'LW'})</span>`;
                    rowClass = 'mem-read-active';
                }
            }

            const hexAddr = '0x' + a.toString(16).toUpperCase().padStart(2, '0');
            const hexVal = '0x' + (val >>> 0).toString(16).toUpperCase().padStart(8, '0');
            const binVal = (val >>> 0).toString(2).padStart(8, '0');
            const asciiVal = (val >= 32 && val <= 126) ? String.fromCharCode(val) : '·';

            html += `
                <tr class="${rowClass}">
                    <td class="mono font-bold">${hexAddr} [${a}]</td>
                    <td class="mono">${hexVal}</td>
                    <td class="mono mem-val" data-addr="${a}" title="Click to edit memory word" style="cursor: pointer;">${val}</td>
                    <td class="mono text-xs">${binVal}</td>
                    <td class="mono">${asciiVal}</td>
                    <td>${accessTag}</td>
                </tr>
            `;
        }

        html += `
                    </tbody>
                </table>
            </div>
        `;

        this.container.innerHTML = html;

        // Bind pagination
        const btnPrev = this.container.querySelector('#mem-prev');
        const btnNext = this.container.querySelector('#mem-next');
        if (btnPrev) btnPrev.addEventListener('click', () => { if (this.page > 0) { this.page--; this.render(snap); } });
        if (btnNext) btnNext.addEventListener('click', () => { if (end < MEM_SIZE) { this.page++; this.render(snap); } });

        // Bind search
        const btnSearch = this.container.querySelector('#mem-search-btn');
        const searchInput = this.container.querySelector('#mem-search-input');
        const doSearch = () => {
            const query = searchInput.value.trim();
            if (!query) return;
            let addr = query.startsWith('0x') || query.startsWith('0X') ? parseInt(query, 16) : parseInt(query, 10);
            if (!isNaN(addr) && addr >= 0 && addr < MEM_SIZE) {
                this.searchAddr = addr;
                this.page = Math.floor(addr / this.pageSize);
                this.render(snap);
            }
        };
        if (btnSearch) btnSearch.addEventListener('click', doSearch);
        if (searchInput) searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

        // Bind interactive memory editing
        if (this.onMemoryChange) {
            this.container.querySelectorAll('.mem-val').forEach(td => {
                td.addEventListener('click', (e) => {
                    const addr = parseInt(e.currentTarget.dataset.addr, 10);
                    const currentVal = mem[addr] ?? 0;
                    const input = prompt(`Enter new value for Word [${addr}] (Decimal or 0xHex):`, currentVal);
                    if (input !== null && input.trim() !== '') {
                        const parsed = input.startsWith('0x') || input.startsWith('0X') ? parseInt(input, 16) : parseInt(input, 10);
                        if (!isNaN(parsed)) {
                            this.onMemoryChange(addr, parsed);
                        }
                    }
                });
            });
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// 3. HAZARD & FORWARDING VISUALIZER
// ──────────────────────────────────────────────────────────────────────────────
export class HazardView {
    constructor(container) {
        this.container = container;
    }

    render(snap) {
        if (!this.container) return;

        const hazard = snap.hazard || HazardType.NONE;
        const details = snap.hazardDetails;
        const fwdDetails = snap.forwardDetails || {};
        const fwdA = snap.forwardA || 0;
        const fwdB = snap.forwardB || 0;

        let hazardBadge = '<span class="badge badge-green">NO HAZARD</span>';
        if (hazard === HazardType.LOAD_USE) {
            hazardBadge = '<span class="badge badge-red">LOAD-USE HAZARD</span>';
        } else if (hazard === HazardType.RAW) {
            hazardBadge = '<span class="badge badge-red">RAW DATA HAZARD</span>';
        } else if (hazard === HazardType.CONTROL) {
            hazardBadge = '<span class="badge badge-amber">CONTROL HAZARD</span>';
        }

        let html = `
            <div class="view-header">
                <div class="view-title">Hazard & Forwarding Network</div>
                <div>${hazardBadge}</div>
            </div>
            <div class="hazard-cards-container">
        `;

        // Hazard Diagnostic Card
        if (hazard !== HazardType.NONE && details) {
            html += `
                <div class="diagnostic-card ${hazard === HazardType.CONTROL ? 'card-control' : 'card-hazard'}">
                    <div class="diag-header">
                        <span class="diag-icon">${hazard === HazardType.CONTROL ? '🔀' : '⚠️'}</span>
                        <span class="diag-title">${hazard}: ${details.reason || (details.reg !== undefined ? `Dependency on R${details.reg}` : '')}</span>
                    </div>
                    ${details.producer ? `<div class="diag-row"><span>Producer:</span> <code class="mono">${details.producer}</code></div>` : ''}
                    ${details.consumer ? `<div class="diag-row"><span>Consumer:</span> <code class="mono">${details.consumer}</code></div>` : ''}
                    ${details.resolution ? `<div class="diag-row"><span>Resolution:</span> <em>${details.resolution}</em></div>` : ''}
                    ${details.action ? `<div class="diag-row"><span>Hardware Action:</span> <strong>${details.action}</strong></div>` : ''}
                </div>
            `;
        } else {
            html += `
                <div class="diagnostic-card card-nominal">
                    <div class="diag-header">
                        <span class="diag-icon">✓</span>
                        <span class="diag-title">Nominal Execution — Pipeline Flowing Smoothly</span>
                    </div>
                    <div class="diag-row"><span>State:</span> No interlock stalls or branch flushes this cycle.</div>
                </div>
            `;
        }

        // Forwarding MUX Status
        const fwdStore = fwdDetails.fwdStore || 'NONE';
        html += `
            <div class="fwd-summary-card">
                <div class="card-subtitle">ALU & Store Bypass Multiplexers</div>
                <div class="fwd-mux-grid">
                    <div class="mux-block ${fwdA !== 0 ? 'mux-active' : ''}">
                        <div class="mux-title">Forward MUX A (rs1)</div>
                        <div class="mux-status font-bold">${fwdDetails.fwdA || 'NONE (RegFile)'}</div>
                        <div class="mux-desc text-xs">${fwdDetails.reasonA || 'Operand read directly from register file.'}</div>
                    </div>
                    <div class="mux-block ${fwdB !== 0 ? 'mux-active' : ''}">
                        <div class="mux-title">Forward MUX B (rs2)</div>
                        <div class="mux-status font-bold">${fwdDetails.fwdB || 'NONE (RegFile/Imm)'}</div>
                        <div class="mux-desc text-xs">${fwdDetails.reasonB || 'Operand read from register file or immediate.'}</div>
                    </div>
                    <div class="mux-block ${fwdStore !== 'NONE' ? 'mux-active' : ''}">
                        <div class="mux-title">Store Data MUX (MEM)</div>
                        <div class="mux-status font-bold">${fwdStore !== 'NONE' ? `MEM/WB Bypass` : 'NONE'}</div>
                        <div class="mux-desc text-xs">${fwdStore !== 'NONE' ? 'Store value forwarded from MEM/WB stage.' : 'Store data read directly from ID/EX register.'}</div>
                    </div>
                </div>
            </div>
        `;

        html += `</div>`;
        this.container.innerHTML = html;
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// 4. PROGRAM / INSTRUCTION PANEL
// ──────────────────────────────────────────────────────────────────────────────
export class ProgramView {
    constructor(container, onToggleBreakpoint) {
        this.container = container;
        this.onToggleBreakpoint = onToggleBreakpoint;
    }

    render(snap, instructions = [], breakpoints = new Set()) {
        if (!this.container) return;

        let html = `
            <div class="view-header">
                <div class="view-title">Program Disassembly & Pipeline Tracking</div>
                <span class="text-xs text-muted">${instructions.length} instructions loaded</span>
            </div>
            <div class="prog-table-container">
                <table class="prog-table">
                    <thead>
                        <tr>
                            <th width="30">BP</th>
                            <th>Address</th>
                            <th>Machine Code</th>
                            <th>Assembly Source</th>
                            <th>Pipeline Stage</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        const currentPC = snap.pc;

        // Map instruction index to active stage
        const activeStageMap = new Map();
        if (snap.instructionStages && Array.isArray(snap.instructionStages)) {
            for (const item of snap.instructionStages) {
                if (item && item.instructionIndex !== undefined && item.instructionIndex !== null) {
                    activeStageMap.set(item.instructionIndex, item.stage);
                }
            }
        }

        for (let i = 0; i < instructions.length; i++) {
            const inst = instructions[i];
            const instIdx = inst.index !== undefined ? inst.index : i;
            const byteAddr = instIdx * 4;
            const hexAddr = '0x' + byteAddr.toString(16).toUpperCase().padStart(4, '0');
            const hasBP = breakpoints.has(byteAddr);

            // Determine stage and status
            let stageBadge = '—';
            let rowHighlight = '';
            let statusText = 'NOT_STARTED';

            const activeStage = activeStageMap.get(instIdx);
            if (activeStage) {
                stageBadge = `<span class="badge stage-${activeStage.toLowerCase()}">${activeStage}</span>`;
                rowHighlight = `stage-highlight-${activeStage.toLowerCase()}`;
                statusText = `<span class="text-accent font-bold">IN_FLIGHT (${activeStage})</span>`;
            } else {
                // Check reservation grid history for completion or squash
                const cells = snap.grid?.[instIdx]?.cells || [];
                const hasCompleted = cells.some(c => c && c.stage === 'WB');
                const wasFlushed = cells.some(c => c && (c.stage === 'FLUSHED' || c.flags?.flushed));
                if (hasCompleted) {
                    statusText = '<span class="text-muted">COMPLETED</span>';
                    stageBadge = '<span class="badge badge-green">RETIRED</span>';
                } else if (wasFlushed) {
                    statusText = '<span class="text-dim">SQUASHED/FLUSHED</span>';
                    stageBadge = '<span class="badge badge-amber">FLUSHED</span>';
                } else if (cells.length > 0) {
                    statusText = '<span class="text-accent">IN_FLIGHT</span>';
                } else {
                    statusText = '<span class="text-dim">NOT_STARTED</span>';
                }
            }

            html += `
                <tr class="${rowHighlight}">
                    <td class="bp-col">
                        <input type="checkbox" class="bp-checkbox" data-addr="${byteAddr}" ${hasBP ? 'checked' : ''} title="Toggle Breakpoint">
                    </td>
                    <td class="mono ${currentPC === byteAddr ? 'text-accent font-bold' : ''}">${hexAddr} [${byteAddr}]</td>
                    <td class="mono text-dim">${inst.machineCode || '0x00000000'}</td>
                    <td class="mono font-bold">${inst.raw || 'NOP'}</td>
                    <td>${stageBadge}</td>
                    <td>${statusText}</td>
                </tr>
            `;
        }

        html += `
                    </tbody>
                </table>
            </div>
        `;

        this.container.innerHTML = html;

        // Bind breakpoint clicks
        this.container.querySelectorAll('.bp-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const addr = parseInt(e.target.dataset.addr, 10);
                if (this.onToggleBreakpoint) this.onToggleBreakpoint(addr);
            });
        });
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// 5. PERFORMANCE METRICS DASHBOARD
// ──────────────────────────────────────────────────────────────────────────────
export class MetricsView {
    constructor(container) {
        this.container = container;
    }

    render(snap) {
        if (!this.container) return;
        const stats = snap.stats || {};
        const cycle = snap.cycle || 0;
        const completed = stats.completedInstructions || 0;
        const stalls = stats.stalls || 0;
        const flushes = stats.flushes || 0;
        const fwdEvents = stats.forwardingEvents || 0;
        const loadUseHazards = stats.loadUseHazards || 0;
        const branchesTotal = stats.branchesTotal || 0;
        const branchesTaken = stats.branchesTaken || 0;
        const branchesNotTaken = stats.branchesNotTaken || 0;
        const branchTakenPct = branchesTotal > 0 ? ((branchesTaken / branchesTotal) * 100).toFixed(1) + '%' : '—';
        const cpi = completed > 0 ? (cycle / completed).toFixed(2) : '—';
        const ipc = cycle > 0 ? (completed / cycle).toFixed(2) : '—';
        const ideal = stats.idealCycles || (completed > 0 ? completed + 4 : 0);
        const lostStalls = stalls;
        const lostFlushes = flushes;

        const utilPercent = cycle > 0 ? Math.min(100, Math.round((completed * 5) / (cycle * 5) * 100)) : 0;

        let html = `
            <div class="view-header">
                <div class="view-title">CPU Microarchitecture Performance Telemetry</div>
            </div>
            <div class="metrics-grid">
                <div class="metric-card">
                    <span class="metric-lbl">Total Cycles</span>
                    <span class="metric-num">${cycle}</span>
                </div>
                <div class="metric-card">
                    <span class="metric-lbl">Retired Instructions</span>
                    <span class="metric-num">${completed}</span>
                </div>
                <div class="metric-card ${cpi <= 1.2 && cpi !== '—' ? 'metric-good' : ''}">
                    <span class="metric-lbl">Cycles Per Instruction (CPI)</span>
                    <span class="metric-num text-accent">${cpi}</span>
                </div>
                <div class="metric-card">
                    <span class="metric-lbl">Instructions / Cycle (IPC)</span>
                    <span class="metric-num">${ipc}</span>
                </div>
                <div class="metric-card ${stalls > 0 ? 'metric-warn' : ''}">
                    <span class="metric-lbl">Pipeline Stalls</span>
                    <span class="metric-num">${stalls}</span>
                </div>
                <div class="metric-card ${flushes > 0 ? 'metric-warn' : ''}">
                    <span class="metric-lbl">Pipeline Flushes</span>
                    <span class="metric-num">${flushes}</span>
                </div>
                <div class="metric-card">
                    <span class="metric-lbl">Forwarding Events</span>
                    <span class="metric-num">${fwdEvents}</span>
                </div>
                <div class="metric-card">
                    <span class="metric-lbl">Load-Use Interlocks</span>
                    <span class="metric-num">${loadUseHazards}</span>
                </div>
                <div class="metric-card">
                    <span class="metric-lbl">Branches Total</span>
                    <span class="metric-num">${branchesTotal}</span>
                </div>
                <div class="metric-card">
                    <span class="metric-lbl">Branches Taken (Rate)</span>
                    <span class="metric-num">${branchesTaken} (${branchTakenPct})</span>
                </div>
                <div class="metric-card">
                    <span class="metric-lbl">Pipeline Utilization</span>
                    <span class="metric-num">${utilPercent}%</span>
                </div>
            </div>

            <!-- Pipeline Efficiency Breakdown -->
            <div class="efficiency-section">
                <div class="card-subtitle">Pipeline Cycle Allocation Breakdown</div>
                <div class="cycle-bar-container">
                    <div class="cycle-bar-segment seg-ideal" style="width: ${cycle > 0 ? Math.min(100, (ideal / cycle) * 100) : 50}%" title="Ideal Useful Work (${ideal} cycles)"></div>
                    <div class="cycle-bar-segment seg-stall" style="width: ${cycle > 0 ? Math.min(100, (lostStalls / cycle) * 100) : 25}%" title="Lost to Stalls (${lostStalls} cycles)"></div>
                    <div class="cycle-bar-segment seg-flush" style="width: ${cycle > 0 ? Math.min(100, (lostFlushes / cycle) * 100) : 25}%" title="Lost to Flushes (${lostFlushes} cycles)"></div>
                </div>
                <div class="cycle-legend">
                    <span class="legend-item"><span class="legend-box box-ideal"></span> Useful Work: ${ideal} cycles (${cycle > 0 ? ((ideal / cycle) * 100).toFixed(1) : 0}%)</span>
                    <span class="legend-item"><span class="legend-box box-stall"></span> Stalls: ${lostStalls} cycles (${cycle > 0 ? ((lostStalls / cycle) * 100).toFixed(1) : 0}%)</span>
                    <span class="legend-item"><span class="legend-box box-flush"></span> Flushes: ${lostFlushes} cycles (${cycle > 0 ? ((lostFlushes / cycle) * 100).toFixed(1) : 0}%)</span>
                </div>
            </div>
        `;

        this.container.innerHTML = html;
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// 6. CPU VS GPU EDUCATIONAL COMPARISON
// ──────────────────────────────────────────────────────────────────────────────
export class ComparisonView {
    constructor(container) {
        this.container = container;
    }

    render() {
        if (!this.container) return;

        let html = `
            <div class="view-header">
                <div class="view-title">Architectural Paradigm: CPU 5-Stage vs GPU SIMT Streaming Multiprocessor</div>
            </div>
            <div class="comparison-container">
                <div class="comparison-columns">
                    <!-- CPU Column -->
                    <div class="paradigm-card card-cpu">
                        <div class="paradigm-header">
                            <span class="paradigm-icon">💻</span>
                            <h3>Latency-Oriented CPU (ILP)</h3>
                        </div>
                        <ul class="paradigm-list">
                            <li><strong>Design Goal:</strong> Minimize single-thread execution latency.</li>
                            <li><strong>Execution Model:</strong> Single instruction stream through deep pipelined stages (IF → ID → EX → MEM → WB).</li>
                            <li><strong>Hazard Resolution:</strong> Silicon-heavy bypass/forwarding networks (EX/MEM → EX, MEM/WB → EX) and interlock logic.</li>
                            <li><strong>Control Hazards:</strong> Branch predictors with costly flushes upon misprediction.</li>
                            <li><strong>Silicon Allocation:</strong> Large caches, out-of-order schedulers, and extensive bypass muxes dominate die area.</li>
                        </ul>
                    </div>

                    <!-- GPU Column -->
                    <div class="paradigm-card card-gpu">
                        <div class="paradigm-header">
                            <span class="paradigm-icon">⚡</span>
                            <h3>Throughput-Oriented GPU (SIMT / TLP)</h3>
                        </div>
                        <ul class="paradigm-list">
                            <li><strong>Design Goal:</strong> Maximize aggregate computational throughput across thousands of threads.</li>
                            <li><strong>Execution Model:</strong> Warps (e.g., 32 threads, modeled as 8 lanes) executing in lockstep SIMT.</li>
                            <li><strong>Hazard Resolution:</strong> <em>Zero-Overhead Warp Scheduling!</em> Modern GPUs avoid massive bypass routing. When Warp 0 stalls on memory, Warp 1 issues immediately.</li>
                            <li><strong>Control Hazards:</strong> Handled via SIMT Divergence Stack & Active Masks (serializing divergent paths).</li>
                            <li><strong>Silicon Allocation:</strong> Replaces massive caches and bypass muxes with thousands of ALUs and dense register files.</li>
                        </ul>
                    </div>
                </div>

                <!-- Live Side-by-Side Tradeoff Table -->
                <div class="comparison-table-wrap">
                    <table class="comparison-table">
                        <thead>
                            <tr>
                                <th>Microarchitectural Dimension</th>
                                <th>CPU Pipeline</th>
                                <th>GPU Streaming Multiprocessor (SM)</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>Primary Parallelism</td>
                                <td>ILP (Instruction-Level Parallelism)</td>
                                <td>TLP (Thread-Level Parallelism) & SIMT</td>
                            </tr>
                            <tr>
                                <td>Data Forwarding</td>
                                <td>Full bypass network (EX→EX, MEM→EX)</td>
                                <td>Omitted; Scoreboard hides latency via warp context switch</td>
                            </tr>
                            <tr>
                                <td>Memory Stalls</td>
                                <td>Pipeline freezes (bubbles injected)</td>
                                <td>Scoreboard triggers warp scheduler to switch warps</td>
                            </tr>
                            <tr>
                                <td>Branch Handling</td>
                                <td>Branch prediction + 1-2 cycle pipeline flush</td>
                                <td>Active Mask serialization + Reconvergence Stack</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        this.container.innerHTML = html;
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// 7. PIPELINE STAGE INSPECTOR
// ──────────────────────────────────────────────────────────────────────────────
export class StageInspectorView {
    constructor(container) {
        this.container = container;
        this.selectedStage = 'EX'; // 'IF', 'ID', 'EX', 'MEM', 'WB'
    }

    render(snap) {
        if (!this.container) return;

        const stages = ['IF', 'ID', 'EX', 'MEM', 'WB'];
        let html = `
            <div class="view-header">
                <div class="view-title">Stage Register & Control Signal Inspector</div>
                <div class="stage-nav-tabs">
        `;

        for (const s of stages) {
            html += `<button class="stage-nav-btn ${this.selectedStage === s ? 'active' : ''}" data-stage="${s}">${s}</button>`;
        }

        html += `
                </div>
            </div>
            <div class="inspector-content">
        `;

        let data = {};
        let title = '';
        const activeInst = snap.stageInstructions?.[this.selectedStage]?.raw || snap.stages?.[this.selectedStage] || 'NOP';

        if (this.selectedStage === 'IF') {
            title = 'IF/ID Pipeline Register';
            data = snap.IF_ID || {};
        } else if (this.selectedStage === 'ID') {
            title = 'ID/EX Pipeline Register';
            data = snap.ID_EX || {};
        } else if (this.selectedStage === 'EX') {
            title = 'EX/MEM Pipeline Register';
            data = snap.EX_MEM || {};
        } else if (this.selectedStage === 'MEM') {
            title = 'MEM/WB Pipeline Register';
            data = snap.MEM_WB || {};
        } else if (this.selectedStage === 'WB') {
            title = 'WB Writeback Stage & Register File Commit';
            data = snap.MEM_WB || {};
        }

        const isValid = this.selectedStage === 'WB' ? (data.valid && data.regWrite) : data.valid;

        html += `
            <div class="inspector-card">
                <div class="inspector-title">
                    <h4>${title}</h4>
                    <span class="badge ${isValid ? 'badge-green' : 'badge-red'}">${isValid ? 'ACTIVE' : 'BUBBLE / NOP'}</span>
                </div>
                <div class="inspector-grid">
                    <div class="insp-item"><span>Current Active Instruction:</span> <code class="mono font-bold text-accent">${activeInst}</code></div>
                    <div class="insp-item"><span>PC:</span> <code class="mono">0x${(data.pc ?? 0).toString(16).toUpperCase().padStart(4, '0')}</code></div>
                    ${data.pcPlus4 !== undefined ? `<div class="insp-item"><span>PC+4:</span> <code class="mono">0x${data.pcPlus4.toString(16).toUpperCase().padStart(4, '0')}</code></div>` : ''}
                    ${data.aluResult !== undefined ? `<div class="insp-item"><span>ALU Result:</span> <code class="mono font-bold text-accent">${data.aluResult}</code></div>` : ''}
                    ${data.memData !== undefined ? `<div class="insp-item"><span>Mem Read Data:</span> <code class="mono">${data.memData}</code></div>` : ''}
                    ${data.storeData !== undefined ? `<div class="insp-item"><span>Store Data:</span> <code class="mono">${data.storeData}</code></div>` : ''}
                    ${data.rd !== undefined ? `<div class="insp-item"><span>Dest Reg (Rd):</span> <code class="mono font-bold">R${data.rd ?? '—'}</code></div>` : ''}
                    ${data.rs1 !== undefined ? `<div class="insp-item"><span>Source Reg 1 (Rs1):</span> <code class="mono">R${data.rs1 ?? '—'} (val: ${data.val1 ?? 0})</code></div>` : ''}
                    ${data.rs2 !== undefined ? `<div class="insp-item"><span>Source Reg 2 (Rs2):</span> <code class="mono">R${data.rs2 ?? '—'} (val: ${data.val2 ?? 0})</code></div>` : ''}
                    ${data.imm !== undefined ? `<div class="insp-item"><span>Immediate:</span> <code class="mono">${data.imm}</code></div>` : ''}
                    ${data.regWrite !== undefined ? `<div class="insp-item"><span>RegWrite:</span> <strong>${data.regWrite ? '1 (Active)' : '0 (Disabled)'}</strong></div>` : ''}
                    ${data.memRead !== undefined ? `<div class="insp-item"><span>MemRead:</span> <strong>${data.memRead ? '1 (Active)' : '0 (Disabled)'}</strong></div>` : ''}
                    ${data.memWrite !== undefined ? `<div class="insp-item"><span>MemWrite:</span> <strong>${data.memWrite ? '1 (Active)' : '0 (Disabled)'}</strong></div>` : ''}
                    ${data.memToReg !== undefined ? `<div class="insp-item"><span>MemToReg:</span> <strong>${data.memToReg ? '1 (Memory)' : '0 (ALU)'}</strong></div>` : ''}
                    ${data.aluSrc !== undefined ? `<div class="insp-item"><span>ALUSrc:</span> <strong>${data.aluSrc ? 'Immediate' : 'Register'}</strong></div>` : ''}
                    ${data.aluOp !== undefined ? `<div class="insp-item"><span>ALUOp:</span> <code class="mono">${data.aluOp}</code></div>` : ''}
                    ${this.selectedStage === 'WB' ? `<div class="insp-item"><span>Writeback Commit:</span> <strong class="text-accent">${(data.valid && data.regWrite && data.rd !== 0) ? `R${data.rd} ← ${data.memToReg ? data.memData : data.aluResult}` : 'No Commit (NOP/R0)'}</strong></div>` : ''}
                </div>
            </div>
        `;

        html += `</div>`;
        this.container.innerHTML = html;

        this.container.querySelectorAll('.stage-nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.selectedStage = e.target.dataset.stage;
                this.render(snap);
            });
        });
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// 8. L1 CACHE HIERARCHY VIEWER
// ──────────────────────────────────────────────────────────────────────────────
export class CacheView {
    constructor(container, onConfigChange = null) {
        this.container = container;
        this.onConfigChange = onConfigChange;
        this.activeTab = 'L1-D'; // 'L1-D' or 'L1-I'
    }

    render(snap) {
        if (!this.container) return;

        const l1d = snap?.l1dCache;
        const l1i = snap?.l1iCache;
        const currentCache = this.activeTab === 'L1-I' ? l1i : l1d;

        let html = `
            <div class="view-header">
                <div class="view-title">L1 Cache Hierarchy (Instruction & Data)</div>
                <div class="format-toggles">
                    <button class="fmt-btn ${this.activeTab === 'L1-D' ? 'active' : ''}" data-tab="L1-D">L1-D (Data Cache)</button>
                    <button class="fmt-btn ${this.activeTab === 'L1-I' ? 'active' : ''}" data-tab="L1-I">L1-I (Instruction Cache)</button>
                </div>
            </div>
        `;

        if (!currentCache) {
            html += `<div class="p-4 text-muted text-center mono">Cache subsystem snapshot not available.</div>`;
            this.container.innerHTML = html;
            return;
        }

        const isEnabled = currentCache.enabled;
        const hitRate = currentCache.hitRate || '0.0';

        html += `
            <div class="cache-dashboard" style="display: flex; flex-direction: column; gap: 14px; margin-top: 8px;">
                
                <!-- Metrics Bar & Config Controls -->
                <div class="metrics-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px;">
                    <div class="metric-card">
                        <div class="metric-label">Status</div>
                        <div class="metric-val ${isEnabled ? 'text-accent' : 'text-muted'}">${isEnabled ? 'ENABLED' : 'BYPASSED'}</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-label">Hit Rate</div>
                        <div class="metric-val text-accent">${hitRate}%</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-label">Hits / Accesses</div>
                        <div class="metric-val">${currentCache.hitCount} / ${currentCache.accessCount}</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-label">Misses</div>
                        <div class="metric-val ${currentCache.missCount > 0 ? 'text-red' : ''}">${currentCache.missCount}</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-label">Cold Misses</div>
                        <div class="metric-val">${currentCache.coldMisses}</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-label">Conflict / Capacity</div>
                        <div class="metric-val">${currentCache.conflictMisses} / ${currentCache.capacityMisses}</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-label">Miss Penalty</div>
                        <div class="metric-val">${currentCache.missPenalty} Cycles</div>
                    </div>
                </div>

                <!-- Address Decomposition Box -->
                <div class="address-decoder-box" style="background: #0d1117; padding: 10px 14px; border-radius: 6px; border: 1px solid #1e293b;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <span class="mono text-xs font-bold text-accent">32-Bit Word Address Breakdown</span>
                        <span class="mono text-xs text-muted">Config: ${currentCache.associativity}-Way Set-Associative (${currentCache.numSets} Sets, ${currentCache.blockSize} words/block)</span>
                    </div>
                    <div style="display: flex; gap: 4px; font-family: monospace; font-size: 11px;">
                        <div style="flex: 25; background: #0f172a; border: 1px solid #38bdf8; padding: 6px; text-align: center; border-radius: 4px;">
                            <div style="color: #38bdf8; font-weight: bold;">TAG [31:5] (27 bits)</div>
                            <div style="color: #94a3b8; font-size: 10px;">Set Match Identifier</div>
                        </div>
                        <div style="flex: 3; background: #064e3b; border: 1px solid #76b900; padding: 6px; text-align: center; border-radius: 4px;">
                            <div style="color: #76b900; font-weight: bold;">SET [4:2] (3 bits)</div>
                            <div style="color: #a7f3d0; font-size: 10px;">Set 0..7</div>
                        </div>
                        <div style="flex: 2; background: #451a03; border: 1px solid #f97316; padding: 6px; text-align: center; border-radius: 4px;">
                            <div style="color: #f97316; font-weight: bold;">OFFSET [1:0] (2 bits)</div>
                            <div style="color: #fdba74; font-size: 10px;">Word 0..3</div>
                        </div>
                    </div>
                    ${currentCache.lastAccessResult ? `
                        <div class="mono text-xs" style="margin-top: 8px; color: ${currentCache.lastAccessResult.hit ? '#34d399' : '#f87171'};">
                            Last Access: Tag 0x${(currentCache.lastAccessResult.tag || 0).toString(16).toUpperCase()} | Set ${currentCache.lastAccessResult.index} | Offset ${currentCache.lastAccessResult.offset} → 
                            <strong>${currentCache.lastAccessResult.hit ? 'HIT (1 Cycle)' : `MISS (${currentCache.lastAccessResult.missType}, +${currentCache.missPenalty} Cycle Stall)`}</strong>
                        </div>
                    ` : ''}
                </div>

                <!-- Cache Lines Table -->
                <div class="cache-table-wrapper" style="overflow-x: auto; background: #07090e; border: 1px solid #1e293b; border-radius: 6px;">
                    <table class="mono text-xs" style="width: 100%; border-collapse: collapse; text-align: left;">
                        <thead>
                            <tr style="background: #0d1117; border-bottom: 1px solid #334155; color: #94a3b8;">
                                <th style="padding: 6px 10px;">Set</th>
                                <th style="padding: 6px 10px;">Way</th>
                                <th style="padding: 6px 10px;">Valid</th>
                                <th style="padding: 6px 10px;">Dirty</th>
                                <th style="padding: 6px 10px;">Tag</th>
                                <th style="padding: 6px 10px;">Word 0</th>
                                <th style="padding: 6px 10px;">Word 1</th>
                                <th style="padding: 6px 10px;">Word 2</th>
                                <th style="padding: 6px 10px;">Word 3</th>
                                <th style="padding: 6px 10px;">Last Used</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${(currentCache.sets || []).map(set => {
                                return set.ways.map((way, wayIdx) => {
                                    const isValid = way.valid;
                                    const isDirty = way.dirty;
                                    const isHot = (currentCache.lastAccessResult && currentCache.lastAccessResult.index === set.setIndex && currentCache.lastAccessResult.way === wayIdx);
                                    return `
                                        <tr style="border-bottom: 1px solid #1e293b; background: ${isHot ? '#064e3b' : wayIdx % 2 === 0 ? '#0a0d14' : '#07090e'};">
                                            <td style="padding: 5px 10px; font-weight: bold; color: #38bdf8;">${set.setIndex}</td>
                                            <td style="padding: 5px 10px; color: #94a3b8;">Way ${way.wayIndex}</td>
                                            <td style="padding: 5px 10px;">
                                                <span class="badge ${isValid ? 'badge-green' : 'badge-dim'}" style="font-size: 9px;">${isValid ? '1' : '0'}</span>
                                            </td>
                                            <td style="padding: 5px 10px;">
                                                <span class="badge ${isDirty ? 'badge-red' : 'badge-dim'}" style="font-size: 9px;">${isDirty ? 'DIRTY' : 'CLEAN'}</span>
                                            </td>
                                            <td style="padding: 5px 10px; color: ${isValid ? '#f8fafc' : '#475569'};">${way.tag}</td>
                                            <td style="padding: 5px 10px; color: ${isValid ? '#cbd5e1' : '#475569'};">${way.data[0] ?? 0}</td>
                                            <td style="padding: 5px 10px; color: ${isValid ? '#cbd5e1' : '#475569'};">${way.data[1] ?? 0}</td>
                                            <td style="padding: 5px 10px; color: ${isValid ? '#cbd5e1' : '#475569'};">${way.data[2] ?? 0}</td>
                                            <td style="padding: 5px 10px; color: ${isValid ? '#cbd5e1' : '#475569'};">${way.data[3] ?? 0}</td>
                                            <td style="padding: 5px 10px; color: #64748b;">${way.lastAccessedCycle > 0 ? 'C' + way.lastAccessedCycle : '—'}</td>
                                        </tr>
                                    `;
                                }).join('');
                            }).join('')}
                        </tbody>
                    </table>
                </div>

            </div>
        `;

        this.container.innerHTML = html;

        // Bind tab switching
        this.container.querySelectorAll('.format-toggles .fmt-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.activeTab = e.target.dataset.tab;
                this.render(snap);
            });
        });
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// 9. DYNAMIC BRANCH PREDICTOR & BTB VIEWER
// ──────────────────────────────────────────────────────────────────────────────
export class BranchPredictorView {
    constructor(container) {
        this.container = container;
    }

    render(snap) {
        if (!this.container) return;
        const bp = snap?.branchPredictor;

        let html = `
            <div class="view-header">
                <div class="view-title">Dynamic 2-Bit Branch Predictor & Branch Target Buffer (BTB)</div>
                <div class="mono text-xs text-muted">Model: 2-Bit Saturating Counter FSM + 16-Entry BTB</div>
            </div>
        `;

        if (!bp) {
            html += `<div class="p-4 text-muted text-center mono">Branch predictor snapshot not available.</div>`;
            this.container.innerHTML = html;
            return;
        }

        const accuracy = bp.accuracy || '0.0';
        const lastPred = bp.lastPrediction;
        const currentState = lastPred ? lastPred.state : 1; // Default Weakly Not Taken

        html += `
            <div class="branch-predictor-dashboard" style="display: flex; flex-direction: column; gap: 14px; margin-top: 8px;">
                
                <!-- Performance Metrics -->
                <div class="metrics-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px;">
                    <div class="metric-card">
                        <div class="metric-label">Status</div>
                        <div class="metric-val ${bp.enabled ? 'text-accent' : 'text-muted'}">${bp.enabled ? 'DYNAMIC 2-BIT' : 'STATIC (NT)'}</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-label">Prediction Accuracy</div>
                        <div class="metric-val text-accent">${accuracy}%</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-label">Total Predictions</div>
                        <div class="metric-val">${bp.totalPredictions}</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-label">Correct Predictions</div>
                        <div class="metric-val text-accent">${bp.correctPredictions}</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-label">Mispredictions (Flush)</div>
                        <div class="metric-val ${bp.mispredictions > 0 ? 'text-red' : ''}">${bp.mispredictions}</div>
                    </div>
                </div>

                <!-- 2-Bit Saturating Counter FSM Visualizer -->
                <div class="fsm-visual-box" style="background: #0d1117; padding: 14px; border-radius: 6px; border: 1px solid #1e293b;">
                    <div class="mono text-xs font-bold text-accent" style="margin-bottom: 8px;">2-Bit Saturating Counter State Diagram</div>
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
                        
                        <!-- State 00 -->
                        <div class="fsm-state-bubble ${currentState === 0 ? 'fsm-state-active' : ''}" 
                             style="flex: 1; min-width: 140px; padding: 10px; border-radius: 8px; border: 2px solid ${currentState === 0 ? '#ef4444' : '#334155'}; background: ${currentState === 0 ? '#450a0a' : '#07090e'}; text-align: center;">
                            <div class="mono font-bold" style="font-size: 16px; color: ${currentState === 0 ? '#f87171' : '#64748b'};">00</div>
                            <div class="mono text-xs font-bold" style="color: #fca5a5;">Strongly Not-Taken</div>
                            <div class="mono text-xs text-muted" style="font-size: 10px; margin-top: 4px;">Predict NT (Fall-through)</div>
                        </div>

                        <div class="mono text-xs text-muted">⇄</div>

                        <!-- State 01 -->
                        <div class="fsm-state-bubble ${currentState === 1 ? 'fsm-state-active' : ''}" 
                             style="flex: 1; min-width: 140px; padding: 10px; border-radius: 8px; border: 2px solid ${currentState === 1 ? '#f59e0b' : '#334155'}; background: ${currentState === 1 ? '#451a03' : '#07090e'}; text-align: center;">
                            <div class="mono font-bold" style="font-size: 16px; color: ${currentState === 1 ? '#fbbf24' : '#64748b'};">01</div>
                            <div class="mono text-xs font-bold" style="color: #fde68a;">Weakly Not-Taken</div>
                            <div class="mono text-xs text-muted" style="font-size: 10px; margin-top: 4px;">Predict NT (Fall-through)</div>
                        </div>

                        <div class="mono text-xs text-muted">⇄</div>

                        <!-- State 10 -->
                        <div class="fsm-state-bubble ${currentState === 2 ? 'fsm-state-active' : ''}" 
                             style="flex: 1; min-width: 140px; padding: 10px; border-radius: 8px; border: 2px solid ${currentState === 2 ? '#38bdf8' : '#334155'}; background: ${currentState === 2 ? '#082f49' : '#07090e'}; text-align: center;">
                            <div class="mono font-bold" style="font-size: 16px; color: ${currentState === 2 ? '#38bdf8' : '#64748b'};">10</div>
                            <div class="mono text-xs font-bold" style="color: #bae6fd;">Weakly Taken</div>
                            <div class="mono text-xs text-muted" style="font-size: 10px; margin-top: 4px;">Predict Taken (BTB Target)</div>
                        </div>

                        <div class="mono text-xs text-muted">⇄</div>

                        <!-- State 11 -->
                        <div class="fsm-state-bubble ${currentState === 3 ? 'fsm-state-active' : ''}" 
                             style="flex: 1; min-width: 140px; padding: 10px; border-radius: 8px; border: 2px solid ${currentState === 3 ? '#76b900' : '#334155'}; background: ${currentState === 3 ? '#064e3b' : '#07090e'}; text-align: center;">
                            <div class="mono font-bold" style="font-size: 16px; color: ${currentState === 3 ? '#76b900' : '#64748b'};">11</div>
                            <div class="mono text-xs font-bold" style="color: #86efac;">Strongly Taken</div>
                            <div class="mono text-xs text-muted" style="font-size: 10px; margin-top: 4px;">Predict Taken (BTB Target)</div>
                        </div>

                    </div>
                </div>

                <!-- 16-Entry BTB Table -->
                <div class="btb-table-wrapper" style="overflow-x: auto; background: #07090e; border: 1px solid #1e293b; border-radius: 6px;">
                    <table class="mono text-xs" style="width: 100%; border-collapse: collapse; text-align: left;">
                        <thead>
                            <tr style="background: #0d1117; border-bottom: 1px solid #334155; color: #94a3b8;">
                                <th style="padding: 6px 10px;">Entry</th>
                                <th style="padding: 6px 10px;">Valid</th>
                                <th style="padding: 6px 10px;">Branch PC (Tag)</th>
                                <th style="padding: 6px 10px;">Predicted Target PC</th>
                                <th style="padding: 6px 10px;">Counter State</th>
                                <th style="padding: 6px 10px;">Prediction</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${(bp.btb || []).map(entry => {
                                const isValid = entry.valid;
                                const isPredictedTaken = entry.state >= 2;
                                return `
                                    <tr style="border-bottom: 1px solid #1e293b; background: ${isValid ? '#0a0d14' : '#07090e'};">
                                        <td style="padding: 5px 10px; font-weight: bold; color: #38bdf8;">${entry.index}</td>
                                        <td style="padding: 5px 10px;">
                                            <span class="badge ${isValid ? 'badge-green' : 'badge-dim'}" style="font-size: 9px;">${isValid ? 'VALID' : 'EMPTY'}</span>
                                        </td>
                                        <td style="padding: 5px 10px; color: ${isValid ? '#f8fafc' : '#475569'};">${entry.tag}</td>
                                        <td style="padding: 5px 10px; color: ${isValid ? '#76b900' : '#475569'};">${entry.targetPC}</td>
                                        <td style="padding: 5px 10px; color: #cbd5e1;">${entry.stateName} (0b${(entry.state || 0).toString(2).padStart(2, '0')})</td>
                                        <td style="padding: 5px 10px;">
                                            <span class="badge ${isPredictedTaken ? 'badge-green' : 'badge-dim'}" style="font-size: 9px;">
                                                ${isPredictedTaken ? 'TAKEN' : 'NOT-TAKEN'}
                                            </span>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>

            </div>
        `;

        this.container.innerHTML = html;
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// 10. GPU SHARED MEMORY 8-BANK CONFLICT VIEWER
// ──────────────────────────────────────────────────────────────────────────────
export class SharedMemoryView {
    constructor(container, onSchedulerToggle = null) {
        this.container = container;
        this.onSchedulerToggle = onSchedulerToggle;
    }

    render(snap) {
        if (!this.container) return;

        const conflictRes = snap?.bankConflictResult;
        const schedulerType = snap?.schedulerType || 'ROUND_ROBIN';
        const numBanks = 8;

        let html = `
            <div class="view-header">
                <div class="view-title">GPU Shared Memory 8-Bank Conflict & Scheduler Visualizer</div>
                <div class="format-toggles">
                    <button class="fmt-btn ${schedulerType === 'ROUND_ROBIN' ? 'active' : ''}" data-sched="ROUND_ROBIN">Round-Robin</button>
                    <button class="fmt-btn ${schedulerType === 'GTO' ? 'active' : ''}" data-sched="GTO">Greedy-Then-Oldest (GTO)</button>
                </div>
            </div>

            <div class="shared-mem-dashboard" style="display: flex; flex-direction: column; gap: 14px; margin-top: 8px;">
                
                <!-- Status Banner -->
                <div class="metrics-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px;">
                    <div class="metric-card">
                        <div class="metric-label">Active Scheduler</div>
                        <div class="metric-val text-accent">${schedulerType === 'GTO' ? 'GTO (Greedy Priority)' : 'Round-Robin'}</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-label">Bank Conflict Status</div>
                        <div class="metric-val ${conflictRes?.hasConflict ? 'text-red' : 'text-accent'}">
                            ${conflictRes ? (conflictRes.hasConflict ? `${conflictRes.serializedCycles}-WAY CONFLICT` : 'CONFLICT-FREE') : 'IDLE'}
                        </div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-label">Serialization Penalty</div>
                        <div class="metric-val">${conflictRes ? `${conflictRes.serializedCycles} Cycle(s)` : '1 Cycle'}</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-label">Conflict Count</div>
                        <div class="metric-val ${conflictRes?.conflicts > 0 ? 'text-red' : ''}">${conflictRes?.conflicts || 0}</div>
                    </div>
                </div>

                <!-- 8 Banks Grid Visualizer -->
                <div class="banks-grid-wrapper" style="background: #07090e; padding: 14px; border-radius: 8px; border: 1px solid #1e293b;">
                    <div class="mono text-xs font-bold text-accent" style="margin-bottom: 10px;">
                        8 Shared Memory Banks (Word Address % 8 → Bank ID)
                    </div>

                    <div style="display: grid; grid-template-columns: repeat(8, 1fr); gap: 10px;">
                        ${Array.from({ length: numBanks }, (_, bankId) => {
                            const requests = conflictRes?.bankMapping?.[bankId] || [];
                            const count = requests.length;
                            const hasLocalConflict = count > 1 && new Set(requests.map(r => r.address)).size > 1;
                            const isBroadcast = count > 1 && !hasLocalConflict;

                            return `
                                <div class="bank-column" style="background: #0d1117; border: 2px solid ${hasLocalConflict ? '#ef4444' : count > 0 ? '#76b900' : '#1e293b'}; border-radius: 6px; padding: 8px; min-height: 120px; display: flex; flex-direction: column; justify-content: space-between;">
                                    <div style="text-align: center; border-bottom: 1px solid #1e293b; padding-bottom: 4px;" class="mono text-xs font-bold">
                                        <div style="color: #38bdf8;">Bank ${bankId}</div>
                                        <div style="font-size: 9px; color: ${hasLocalConflict ? '#f87171' : count > 0 ? '#34d399' : '#64748b'};">
                                            ${hasLocalConflict ? 'CONFLICT!' : isBroadcast ? 'BROADCAST' : count === 1 ? '1 REQUEST' : 'IDLE'}
                                        </div>
                                    </div>

                                    <!-- Lane Requests -->
                                    <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 6px;">
                                        ${requests.map(req => `
                                            <div style="background: ${hasLocalConflict ? '#450a0a' : '#064e3b'}; border: 1px solid ${hasLocalConflict ? '#f87171' : '#34d399'}; border-radius: 4px; padding: 3px 4px; font-size: 9px;" class="mono">
                                                <div style="color: #f8fafc; font-weight: bold;">Lane ${req.lane}</div>
                                                <div style="color: #94a3b8;">Addr: ${req.address}</div>
                                            </div>
                                        `).join('')}
                                    </div>

                                    <div style="margin-top: 6px; text-align: center; font-size: 9px; color: #475569;" class="mono">
                                        Offset % 8
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>

                    <div class="mono text-xs text-muted" style="margin-top: 12px; font-size: 11px;">
                        ${conflictRes?.hasConflict
                            ? `⚠️ Hardware Warning: ${conflictRes.serializedCycles} threads are serialized accessing different words in the same memory bank, degrading memory throughput by ${((1 - 1/conflictRes.serializedCycles) * 100).toFixed(0)}%.`
                            : `✓ Conflict-Free: Each active lane addresses a distinct memory bank or uses conflict-free broadcast.`
                        }
                    </div>
                </div>

            </div>
        `;

        this.container.innerHTML = html;

        // Bind scheduler toggles
        this.container.querySelectorAll('.format-toggles .fmt-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const sched = e.target.dataset.sched;
                if (this.onSchedulerToggle) {
                    this.onSchedulerToggle(sched);
                }
            });
        });
    }
}

