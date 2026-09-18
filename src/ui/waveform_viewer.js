// ──────────────────────────────────────────────────────────────────────────────
// SIMT-Flow: In-Browser Digital Logic Timing Waveform Viewer (WaveDrom/GTKWave Style)
// ──────────────────────────────────────────────────────────────────────────────
// Features:
//   - Multi-trace digital analyzer (clk, pc, stages, stall, flush, forwarding, regs)
//   - Bus rendering with transitions and hex values
//   - Single-bit high/low digital pulses with glowing active edges
//   - Interactive scrubbable cycle marker synced with engine time-travel
//   - SVG-based responsive rendering with smooth scrolling and zoom controls
// ──────────────────────────────────────────────────────────────────────────────

export class WaveformViewer {
    /**
     * @param {HTMLElement} container - DOM container element
     * @param {Function} onCycleSelect - Callback when user clicks a cycle to scrub: (cycle) => void
     */
    constructor(container, onCycleSelect = null) {
        this.container = container;
        this.onCycleSelect = onCycleSelect;
        this.cycleWidth = 70; // px per cycle
        this.rowHeight = 32;  // px per signal trace
        this.labelWidth = 140; // px for signal names
        this.zoomLevel = 1.0;

        this.signals = [
            { id: 'clk',    name: 'clk',          type: 'clk',    color: '#76b900' },
            { id: 'pc',     name: 'pc[31:0]',     type: 'bus',    color: '#00ffff' },
            { id: 'if',     name: 'stage_if',     type: 'bus',    color: '#38bdf8' },
            { id: 'id',     name: 'stage_id',     type: 'bus',    color: '#2dd4bf' },
            { id: 'ex',     name: 'stage_ex',     type: 'bus',    color: '#76b900' },
            { id: 'mem',    name: 'stage_mem',    type: 'bus',    color: '#c084fc' },
            { id: 'wb',     name: 'stage_wb',     type: 'bus',    color: '#fbbf24' },
            { id: 'stall',  name: 'stall',        type: 'bit',    color: '#ef4444' },
            { id: 'flush',  name: 'flush',        type: 'bit',    color: '#f97316' },
            { id: 'fwd_a',  name: 'fwd_a[1:0]',   type: 'bus',    color: '#10b981' },
            { id: 'fwd_b',  name: 'fwd_b[1:0]',   type: 'bus',    color: '#10b981' },
            { id: 'r1',     name: 'reg_r1[31:0]', type: 'bus',    color: '#94a3b8' },
            { id: 'r2',     name: 'reg_r2[31:0]', type: 'bus',    color: '#94a3b8' },
            { id: 'r3',     name: 'reg_r3[31:0]', type: 'bus',    color: '#94a3b8' },
        ];
    }

    /**
     * Render the timing diagram using the full simulation history.
     * @param {Array<object>} history - CPU or GPU snapshot history
     * @param {number} currentCycle - Active cycle index
     */
    render(history = [], currentCycle = 0) {
        if (!this.container) return;

        const totalCycles = Math.max(history.length - 1, 1);
        const effectiveCycleWidth = this.cycleWidth * this.zoomLevel;
        const totalWidth = this.labelWidth + totalCycles * effectiveCycleWidth + 60;
        const totalHeight = 40 + this.signals.length * this.rowHeight + 20;

        let html = `
            <div class="view-header">
                <div class="view-title">Digital Logic Timing Diagram (VCD Analyzer)</div>
                <div class="waveform-controls">
                    <span class="mono text-xs text-muted">Cycle: <strong class="text-accent">${currentCycle}</strong> / ${totalCycles}</span>
                    <button class="fmt-btn" id="wf-zoom-in" title="Zoom In">+</button>
                    <button class="fmt-btn" id="wf-zoom-out" title="Zoom Out">-</button>
                    <button class="fmt-btn" id="wf-zoom-reset" title="Reset Zoom">1x</button>
                </div>
            </div>
            <div class="waveform-scroll-area" id="wf-scroll-area" style="overflow-x: auto; overflow-y: hidden; max-width: 100%; border: 1px solid var(--border-color); border-radius: 6px; background: #07090e;">
                <svg id="wf-svg" width="${totalWidth}" height="${totalHeight}" style="display: block; font-family: 'JetBrains Mono', monospace; font-size: 11px;">
                    <defs>
                        <pattern id="wf-grid" width="${effectiveCycleWidth}" height="${this.rowHeight}" patternUnits="userSpaceOnUse">
                            <line x1="${effectiveCycleWidth}" y1="0" x2="${effectiveCycleWidth}" y2="${this.rowHeight}" stroke="#1e293b" stroke-width="1" stroke-dasharray="2,2"/>
                        </pattern>
                        <linearGradient id="cursor-glow" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stop-color="#76b900" stop-opacity="0.8"/>
                            <stop offset="100%" stop-color="#76b900" stop-opacity="0.2"/>
                        </linearGradient>
                    </defs>

                    <!-- Background Grid -->
                    <rect x="${this.labelWidth}" y="35" width="${totalCycles * effectiveCycleWidth}" height="${this.signals.length * this.rowHeight}" fill="url(#wf-grid)" />

                    <!-- Cycle Header -->
                    <g class="wf-header">
                        <rect x="0" y="0" width="${totalWidth}" height="35" fill="#0d1117" />
                        <text x="10" y="22" fill="#64748b" font-weight="bold">SIGNAL</text>
        `;

        // Cycle numbers
        for (let c = 1; c <= totalCycles; c++) {
            const x = this.labelWidth + (c - 0.5) * effectiveCycleWidth;
            const isCurrent = (c === currentCycle);
            html += `
                <text x="${x}" y="22" fill="${isCurrent ? '#76b900' : '#64748b'}" font-weight="${isCurrent ? 'bold' : 'normal'}" text-anchor="middle" cursor="pointer" class="cycle-head-label" data-cycle="${c}">
                    C${c}
                </text>
            `;
        }
        html += `</g>`;

        // Signal Rows
        this.signals.forEach((sig, rowIdx) => {
            const y = 35 + rowIdx * this.rowHeight;
            const isEven = rowIdx % 2 === 0;

            // Row background and signal label
            html += `
                <g class="wf-row" data-signal="${sig.id}">
                    <rect x="0" y="${y}" width="${totalWidth}" height="${this.rowHeight}" fill="${isEven ? '#0a0d14' : '#07090e'}" />
                    <rect x="0" y="${y}" width="${this.labelWidth}" height="${this.rowHeight}" fill="#0d1117" />
                    <line x1="0" y1="${y + this.rowHeight}" x2="${totalWidth}" y2="${y + this.rowHeight}" stroke="#1e293b" stroke-width="0.5" />
                    <line x1="${this.labelWidth}" y1="${y}" x2="${this.labelWidth}" y2="${y + this.rowHeight}" stroke="#334155" stroke-width="1" />
                    <text x="12" y="${y + 20}" fill="${sig.color}" font-weight="bold">${sig.name}</text>
            `;

            // Draw wave traces for each cycle
            for (let c = 1; c <= totalCycles; c++) {
                const snap = history[c] || history[history.length - 1];
                const prevSnap = history[c - 1] || snap;
                const xStart = this.labelWidth + (c - 1) * effectiveCycleWidth;
                const xEnd = xStart + effectiveCycleWidth;

                if (sig.type === 'clk') {
                    // Clock square wave: High in first half, low in second half
                    const yHigh = y + 8;
                    const yLow = y + this.rowHeight - 8;
                    const xMid = xStart + effectiveCycleWidth / 2;
                    html += `
                        <path d="M ${xStart} ${yLow} L ${xStart} ${yHigh} L ${xMid} ${yHigh} L ${xMid} ${yLow} L ${xEnd} ${yLow}" 
                              fill="none" stroke="${sig.color}" stroke-width="1.5" />
                    `;
                } else if (sig.type === 'bit') {
                    // 1-bit digital line (stall, flush)
                    const val = (sig.id === 'stall' ? snap?.stall : snap?.flush) ? 1 : 0;
                    const prevVal = (sig.id === 'stall' ? prevSnap?.stall : prevSnap?.flush) ? 1 : 0;
                    const yVal = val ? (y + 8) : (y + this.rowHeight - 8);
                    const yPrev = prevVal ? (y + 8) : (y + this.rowHeight - 8);

                    if (val) {
                        html += `<rect x="${xStart}" y="${y + 8}" width="${effectiveCycleWidth}" height="${this.rowHeight - 16}" fill="${sig.color}" fill-opacity="0.18" />`;
                    }

                    let path = `M ${xStart} ${yPrev}`;
                    if (prevVal !== val) {
                        path += ` L ${xStart} ${yVal}`;
                    }
                    path += ` L ${xEnd} ${yVal}`;

                    html += `<path d="${path}" fill="none" stroke="${val ? sig.color : '#475569'}" stroke-width="${val ? 2 : 1.2}" />`;
                } else if (sig.type === 'bus') {
                    // Bus with value label inside
                    let textVal = '—';
                    if (sig.id === 'pc') {
                        textVal = snap?.pc !== undefined ? '0x' + (snap.pc).toString(16).toUpperCase().padStart(4, '0') : '0x0000';
                    } else if (sig.id === 'if') {
                        textVal = snap?.stages?.IF || 'NOP';
                    } else if (sig.id === 'id') {
                        textVal = snap?.stages?.ID || 'NOP';
                    } else if (sig.id === 'ex') {
                        textVal = snap?.stages?.EX || 'NOP';
                    } else if (sig.id === 'mem') {
                        textVal = snap?.stages?.MEM || 'NOP';
                    } else if (sig.id === 'wb') {
                        textVal = snap?.stages?.WB || 'NOP';
                    } else if (sig.id === 'fwd_a') {
                        textVal = snap?.forwardDetails?.fwdA || 'NONE';
                    } else if (sig.id === 'fwd_b') {
                        textVal = snap?.forwardDetails?.fwdB || 'NONE';
                    } else if (sig.id === 'r1') {
                        textVal = snap?.registers ? snap.registers[1] ?? 0 : 0;
                    } else if (sig.id === 'r2') {
                        textVal = snap?.registers ? snap.registers[2] ?? 0 : 0;
                    } else if (sig.id === 'r3') {
                        textVal = snap?.registers ? snap.registers[3] ?? 0 : 0;
                    }

                    const yTop = y + 6;
                    const yBot = y + this.rowHeight - 6;
                    const inset = 3;

                    // Hexagon bus cell shape
                    const busPath = `
                        M ${xStart + inset} ${yTop} 
                        L ${xEnd - inset} ${yTop} 
                        L ${xEnd} ${(yTop + yBot) / 2} 
                        L ${xEnd - inset} ${yBot} 
                        L ${xStart + inset} ${yBot} 
                        L ${xStart} ${(yTop + yBot) / 2} Z
                    `;

                    const isHighlight = (textVal !== 'NOP' && textVal !== '—' && textVal !== 'NONE' && textVal !== 0);

                    html += `
                        <path d="${busPath}" fill="${isHighlight ? '#1e293b' : '#0a0f1d'}" 
                              stroke="${isHighlight ? sig.color : '#334155'}" stroke-width="${isHighlight ? 1.5 : 1}" />
                        <text x="${(xStart + xEnd) / 2}" y="${y + 19}" fill="${isHighlight ? '#f8fafc' : '#64748b'}" 
                              text-anchor="middle" font-size="10" clip-path="url(#clip-${rowIdx})">
                            ${this._truncateText(String(textVal), Math.floor(effectiveCycleWidth / 7))}
                        </text>
                    `;
                }
            }
            html += `</g>`;
        });

        // Vertical Scrubbable Cycle Cursor
        if (currentCycle >= 1 && currentCycle <= totalCycles) {
            const cursorX = this.labelWidth + (currentCycle - 0.5) * effectiveCycleWidth;
            html += `
                <g class="wf-cursor">
                    <line x1="${cursorX}" y1="0" x2="${cursorX}" y2="${totalHeight}" stroke="#76b900" stroke-width="2" stroke-dasharray="4,2"/>
                    <polygon points="${cursorX-5},0 ${cursorX+5},0 ${cursorX},10" fill="#76b900" />
                </g>
            `;
        }

        html += `
                </svg>
            </div>
        `;

        this.container.innerHTML = html;

        // Bind zoom events
        const zoomIn = this.container.querySelector('#wf-zoom-in');
        const zoomOut = this.container.querySelector('#wf-zoom-out');
        const zoomReset = this.container.querySelector('#wf-zoom-reset');

        if (zoomIn) zoomIn.onclick = () => { this.zoomLevel = Math.min(2.5, this.zoomLevel + 0.25); this.render(history, currentCycle); };
        if (zoomOut) zoomOut.onclick = () => { this.zoomLevel = Math.max(0.5, this.zoomLevel - 0.25); this.render(history, currentCycle); };
        if (zoomReset) zoomReset.onclick = () => { this.zoomLevel = 1.0; this.render(history, currentCycle); };

        // Bind click-to-scrub on cycle headers and SVG
        const svg = this.container.querySelector('#wf-svg');
        if (svg && this.onCycleSelect) {
            svg.addEventListener('click', (e) => {
                const rect = svg.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                if (clickX > this.labelWidth) {
                    const cycleIdx = Math.floor((clickX - this.labelWidth) / effectiveCycleWidth) + 1;
                    if (cycleIdx >= 1 && cycleIdx <= totalCycles) {
                        this.onCycleSelect(cycleIdx);
                    }
                }
            });
        }

        // Auto scroll to active cycle
        const scrollArea = this.container.querySelector('#wf-scroll-area');
        if (scrollArea && currentCycle > 0) {
            const targetX = (currentCycle - 1) * effectiveCycleWidth;
            scrollArea.scrollLeft = Math.max(0, targetX - scrollArea.clientWidth / 2);
        }
    }

    _truncateText(str, maxChars) {
        if (!str) return '';
        if (str.length <= maxChars) return str;
        return str.substring(0, Math.max(1, maxChars - 1)) + '…';
    }
}
