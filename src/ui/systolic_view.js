// ──────────────────────────────────────────────────────────────────────────────
// SIMT-Flow: 4×4 Tensor Core / Systolic Array Matrix Multiplication Visualizer
// ──────────────────────────────────────────────────────────────────────────────
// Models cycle-by-cycle hardware wave propagation across a 2D grid of 16 PEs:
//   - Matrix A rows shift horizontally from the left (skewed by row index: c = r + k)
//   - Matrix B cols shift vertically from the top (skewed by col index: c = col + k)
//   - Each PE computes: C[r][c] += A[r] * B[c] (Multiply-Accumulate, MAC)
//   - Total 4×4 computation completes in 2N-1 + N = 10 clock cycles
// ──────────────────────────────────────────────────────────────────────────────

export class SystolicView {
    constructor(container) {
        this.container = container;
        this.size = 4; // 4x4 array
        this.currentCycle = 0;
        this.maxCycles = 11;
        this.isPlaying = false;
        this.timer = null;

        // Preset 4x4 Matrices
        this.matrixA = [
            [1, 2, 0, 1],
            [0, 1, 3, 2],
            [2, 0, 1, 1],
            [1, 1, 0, 2]
        ];

        this.matrixB = [
            [1, 0, 2, 1],
            [0, 2, 1, 0],
            [1, 1, 0, 3],
            [2, 0, 1, 1]
        ];

        this.reset();
    }

    reset() {
        this.currentCycle = 0;
        this.isPlaying = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        // PE State: 4x4 grid of { a: 0, b: 0, c: 0, active: false, lastProduct: 0 }
        this.pes = Array.from({ length: this.size }, () =>
            Array.from({ length: this.size }, () => ({
                a: 0,
                b: 0,
                c: 0,
                lastProduct: 0,
                active: false,
            }))
        );

        // Precompute expected result matrix C = A * B
        this.expectedC = Array.from({ length: this.size }, () => new Array(this.size).fill(0));
        for (let r = 0; r < this.size; r++) {
            for (let c = 0; c < this.size; c++) {
                let sum = 0;
                for (let k = 0; k < this.size; k++) {
                    sum += this.matrixA[r][k] * this.matrixB[k][c];
                }
                this.expectedC[r][c] = sum;
            }
        }

        this.render();
    }

    step() {
        if (this.currentCycle >= this.maxCycles) {
            return;
        }

        this.currentCycle++;

        // For each PE[r][c], determine incoming inputs at currentCycle
        // In an output-stationary or weight-stationary systolic array:
        // Input A[r][k] arrives at PE[r][c] at cycle = r + c + k + 1
        // For standard 2D systolic array with inputs shifting:
        // PE[r][c] receives A from PE[r][c-1] and B from PE[r-1][c]
        // Skewed input feeding:
        // A[r] fed into column 0 at cycle = r + k + 1
        // B[c] fed into row 0 at cycle = c + k + 1
        
        const nextPEs = this.pes.map(row => row.map(pe => ({ ...pe })));

        for (let r = 0; r < this.size; r++) {
            for (let c = 0; c < this.size; c++) {
                // k index active at this PE during this cycle:
                // k = (cycle - 1) - (r + c)
                const k = (this.currentCycle - 1) - (r + c);
                if (k >= 0 && k < this.size) {
                    const aVal = this.matrixA[r][k];
                    const bVal = this.matrixB[k][c];
                    const prod = aVal * bVal;

                    nextPEs[r][c].a = aVal;
                    nextPEs[r][c].b = bVal;
                    nextPEs[r][c].lastProduct = prod;
                    nextPEs[r][c].c += prod;
                    nextPEs[r][c].active = true;
                } else {
                    nextPEs[r][c].active = false;
                    nextPEs[r][c].a = 0;
                    nextPEs[r][c].b = 0;
                    nextPEs[r][c].lastProduct = 0;
                }
            }
        }

        this.pes = nextPEs;
        this.render();
    }

    play() {
        if (this.isPlaying) return;
        this.isPlaying = true;
        this.timer = setInterval(() => {
            if (this.currentCycle >= this.maxCycles) {
                this.pause();
            } else {
                this.step();
            }
        }, 800);
        this.render();
    }

    pause() {
        this.isPlaying = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.render();
    }

    render() {
        if (!this.container) return;

        let html = `
            <div class="view-header">
                <div class="view-title">NVIDIA Tensor Core 4×4 Systolic Array (FP16/INT8 MAC Units)</div>
                <div class="systolic-controls">
                    <span class="mono text-xs text-muted">Cycle: <strong class="text-accent">${this.currentCycle}</strong> / ${this.maxCycles}</span>
                    <button class="fmt-btn ${this.isPlaying ? 'active' : ''}" id="sys-play-btn">${this.isPlaying ? 'Pause ⏸' : 'Play ▶'}</button>
                    <button class="fmt-btn" id="sys-step-btn" ${this.currentCycle >= this.maxCycles ? 'disabled' : ''}>Step ⏭</button>
                    <button class="fmt-btn" id="sys-reset-btn">Reset ↺</button>
                    <select id="sys-preset-select" class="fmt-select" style="background:#0d1117; color:#94a3b8; border:1px solid #334155; border-radius:4px; padding:2px 6px; font-size:11px;">
                        <option value="dense">Preset: Dense Matrix</option>
                        <option value="identity">Preset: Identity Multiply</option>
                        <option value="conv">Preset: 4x4 Conv Filter</option>
                    </select>
                </div>
            </div>

            <div class="systolic-container" style="display: flex; gap: 20px; align-items: flex-start; margin-top: 10px; flex-wrap: wrap;">
                
                <!-- Left: Matrix A Input Queue -->
                <div class="systolic-matrix-box" style="background: #0d1117; padding: 10px; border-radius: 6px; border: 1px solid #1e293b;">
                    <div class="mono text-xs font-bold text-accent" style="margin-bottom: 6px;">Matrix A [4×4] (Left Input Wave)</div>
                    <table class="mono text-xs" style="border-collapse: collapse;">
                        ${this.matrixA.map((row, r) => `
                            <tr>
                                <td class="text-muted" style="padding: 3px 6px;">Row ${r}:</td>
                                ${row.map(val => `<td style="padding: 3px 8px; text-align: center; border: 1px solid #1e293b; background: #07090e; color: #38bdf8;">${val}</td>`).join('')}
                            </tr>
                        `).join('')}
                    </table>
                </div>

                <!-- Center: 4x4 PE Grid -->
                <div class="systolic-pe-grid-wrapper" style="background: #07090e; padding: 15px; border-radius: 8px; border: 1px solid #334155; position: relative;">
                    <!-- Top Column Inputs (Matrix B) -->
                    <div style="display: flex; margin-left: 50px; margin-bottom: 8px; gap: 12px;">
                        ${this.matrixB[0].map((_, c) => {
                            // Find active B value feeding column c
                            const k = (this.currentCycle - 1) - c;
                            const activeVal = (k >= 0 && k < this.size) ? this.matrixB[k][c] : '—';
                            const isFed = activeVal !== '—';
                            return `
                                <div style="width: 80px; text-align: center;" class="mono text-xs">
                                    <div class="text-muted" style="font-size: 10px;">Col ${c}</div>
                                    <div style="padding: 2px 4px; border-radius: 4px; background: ${isFed ? '#065f46' : '#1e293b'}; color: ${isFed ? '#34d399' : '#64748b'}; font-weight: bold; margin-top: 2px;">
                                        ↓ ${activeVal}
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>

                    <!-- Grid Rows with Left Row Inputs -->
                    <div style="display: flex; flex-direction: column; gap: 12px;">
                        ${this.pes.map((row, r) => {
                            // Find active A value feeding row r
                            const k = (this.currentCycle - 1) - r;
                            const activeA = (k >= 0 && k < this.size) ? this.matrixA[r][k] : '—';
                            const isFedA = activeA !== '—';

                            return `
                                <div style="display: flex; align-items: center; gap: 12px;">
                                    <!-- Left Input Badge -->
                                    <div style="width: 38px; text-align: right;" class="mono text-xs">
                                        <span style="display: inline-block; padding: 2px 4px; border-radius: 4px; background: ${isFedA ? '#075985' : '#1e293b'}; color: ${isFedA ? '#38bdf8' : '#64748b'}; font-weight: bold;">
                                            ${activeA} →
                                        </span>
                                    </div>

                                    <!-- 4 PEs in this row -->
                                    ${row.map((pe, c) => `
                                        <div class="pe-cell ${pe.active ? 'pe-active' : ''}" 
                                             style="width: 80px; height: 80px; border-radius: 6px; border: 2px solid ${pe.active ? '#76b900' : '#1e293b'}; background: ${pe.active ? '#064e3b' : '#0d1117'}; padding: 6px; display: flex; flex-direction: column; justify-content: space-between; box-shadow: ${pe.active ? '0 0 10px rgba(118,185,0,0.3)' : 'none'}; transition: all 0.2s;">
                                            <div style="display: flex; justify-content: space-between; align-items: center;" class="mono text-xs">
                                                <span style="font-size: 9px; color: #64748b;">PE[${r},${c}]</span>
                                                <span class="badge ${pe.active ? 'badge-green' : 'badge-dim'}" style="font-size: 8px; padding: 1px 3px;">
                                                    ${pe.active ? 'MAC' : 'IDLE'}
                                                </span>
                                            </div>
                                            <div class="mono text-xs" style="text-align: center; color: ${pe.active ? '#a7f3d0' : '#475569'}; font-size: 10px;">
                                                ${pe.active ? `${pe.a} × ${pe.b} = +${pe.lastProduct}` : '—'}
                                            </div>
                                            <div class="mono font-bold" style="text-align: center; font-size: 13px; color: ${pe.c > 0 ? '#76b900' : '#94a3b8'};">
                                                C: ${pe.c}
                                            </div>
                                        </div>
                                    `).join('')}
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>

                <!-- Right: Expected Accumulator Output C = A * B -->
                <div class="systolic-matrix-box" style="background: #0d1117; padding: 10px; border-radius: 6px; border: 1px solid #1e293b;">
                    <div class="mono text-xs font-bold text-accent" style="margin-bottom: 6px;">Matrix C [4×4] (Result)</div>
                    <table class="mono text-xs" style="border-collapse: collapse;">
                        ${this.pes.map((row, r) => `
                            <tr>
                                <td class="text-muted" style="padding: 3px 6px;">Row ${r}:</td>
                                ${row.map((pe, c) => {
                                    const expected = this.expectedC[r][c];
                                    const isDone = (pe.c === expected && this.currentCycle >= 7);
                                    return `
                                        <td style="padding: 3px 8px; text-align: center; border: 1px solid #1e293b; background: ${isDone ? '#064e3b' : '#07090e'}; color: ${isDone ? '#76b900' : '#cbd5e1'}; font-weight: ${isDone ? 'bold' : 'normal'};">
                                            ${pe.c} / ${expected}
                                        </td>
                                    `;
                                }).join('')}
                            </tr>
                        `).join('')}
                    </table>
                    <div class="mono text-xs text-muted" style="margin-top: 8px; font-size: 10px;">
                        Hardware Throughput: 16 MAC operations / cycle
                    </div>
                </div>

            </div>
        `;

        this.container.innerHTML = html;

        // Bind control buttons
        const playBtn = this.container.querySelector('#sys-play-btn');
        const stepBtn = this.container.querySelector('#sys-step-btn');
        const resetBtn = this.container.querySelector('#sys-reset-btn');
        const presetSelect = this.container.querySelector('#sys-preset-select');

        if (playBtn) playBtn.onclick = () => { if (this.isPlaying) this.pause(); else this.play(); };
        if (stepBtn) stepBtn.onclick = () => this.step();
        if (resetBtn) resetBtn.onclick = () => this.reset();

        if (presetSelect) {
            presetSelect.onchange = (e) => {
                const val = e.target.value;
                if (val === 'identity') {
                    this.matrixA = [[2, 1, 0, 3], [1, 2, 1, 0], [0, 1, 2, 1], [3, 0, 1, 2]];
                    this.matrixB = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
                } else if (val === 'conv') {
                    this.matrixA = [[1, 0, -1, 0], [0, 1, 0, -1], [1, 2, 1, 0], [0, 1, 2, 1]];
                    this.matrixB = [[1, 2, 1, 0], [0, 1, 2, 1], [-1, 0, 1, 2], [0, -1, 0, 1]];
                } else {
                    this.matrixA = [[1, 2, 0, 1], [0, 1, 3, 2], [2, 0, 1, 1], [1, 1, 0, 2]];
                    this.matrixB = [[1, 0, 2, 1], [0, 2, 1, 0], [1, 1, 0, 3], [2, 0, 1, 1]];
                }
                this.reset();
            };
        }
    }
}
