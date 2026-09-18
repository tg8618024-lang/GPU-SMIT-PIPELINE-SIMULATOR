// ──────────────────────────────────────────────────────────────────────────────
// SIMT-Flow: Live Silicon Architecture Telemetry & Execution Stream
// ──────────────────────────────────────────────────────────────────────────────
// Generates cycle-by-cycle human-readable hardware commentary explaining the
// exact internal cause and effect of microarchitectural events (bypasses,
// stalls, branch predictions, cache fills, and warp context switches).
// ──────────────────────────────────────────────────────────────────────────────

export class TelemetryStream {
    /**
     * @param {HTMLElement} containerElement
     */
    constructor(containerElement) {
        this.container = containerElement;
        this.filter = 'all'; // 'all', 'hazards', 'forwarding', 'branches', 'memory'
        this.logEntries = [];
        this.maxEntries = 150;
        this._buildDOM();
    }

    _buildDOM() {
        if (!this.container) return;

        this.container.innerHTML = `
            <div class="telemetry-stream-header">
                <div class="stream-title">
                    <span class="stream-dot pulse">●</span>
                    <span class="stream-label">Live Silicon Telemetry & Execution Stream</span>
                </div>
                <div class="stream-filter-bar">
                    <button class="filter-chip active" data-filter="all">All Events</button>
                    <button class="filter-chip" data-filter="hazards">Hazards & Stalls</button>
                    <button class="filter-chip" data-filter="forwarding">Forwarding</button>
                    <button class="filter-chip" data-filter="branches">Branches & Flushes</button>
                    <button class="filter-chip" data-filter="memory">Caches & Memory</button>
                    <button class="btn-copy-stream" title="Copy Telemetry Log">📋 Copy</button>
                </div>
            </div>
            <div class="telemetry-stream-feed" id="telemetry-feed">
                <div class="stream-placeholder mono text-xs text-muted">
                    Telemetry ready. Step or run simulation to stream microarchitectural commentary...
                </div>
            </div>
        `;

        this.feed = this.container.querySelector('#telemetry-feed');

        // Filter chips
        this.container.querySelectorAll('.filter-chip').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.container.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.filter = btn.dataset.filter;
                this._renderFeed();
            });
        });

        // Copy button
        const btnCopy = this.container.querySelector('.btn-copy-stream');
        if (btnCopy) {
            btnCopy.addEventListener('click', () => {
                const text = this.logEntries.map(e => `[Cycle ${e.cycle}] [${e.category.toUpperCase()}] ${e.message}`).join('\n');
                navigator.clipboard?.writeText(text).then(() => {
                    btnCopy.textContent = '✓ Copied!';
                    setTimeout(() => { btnCopy.textContent = '📋 Copy'; }, 1500);
                });
            });
        }
    }

    /**
     * Ingest a simulation snapshot and append relevant telemetry narrative.
     * @param {object} snap - CPUSnapshot or GPUSnapshot
     */
    recordSnapshot(snap) {
        if (!snap) return;

        // Deduplicate: don't record the exact same cycle twice
        if (this.logEntries.length > 0 && this.logEntries[this.logEntries.length - 1].cycle === snap.cycle) {
            return;
        }

        const entries = [];

        if (snap.type === 'cpu') {
            this._analyzeCPUSnapshot(snap, entries);
        } else {
            this._analyzeGPUSnapshot(snap, entries);
        }

        if (entries.length === 0 && snap.cycle > 0) {
            entries.push({
                cycle: snap.cycle,
                category: 'normal',
                level: 'info',
                message: `Cycle ${snap.cycle}: Pipeline advanced nominal execution. Instructions in-flight: IF=${snap.stages?.IF || '—'}, ID=${snap.stages?.ID || '—'}, EX=${snap.stages?.EX || '—'}, MEM=${snap.stages?.MEM || '—'}, WB=${snap.stages?.WB || '—'}.`
            });
        }

        this.logEntries.push(...entries);
        if (this.logEntries.length > this.maxEntries) {
            this.logEntries = this.logEntries.slice(-this.maxEntries);
        }

        this._renderFeed();
    }

    _analyzeCPUSnapshot(snap, entries) {
        const c = snap.cycle;
        if (c === 0) return;

        // 1. Data Forwarding
        const fwdDetails = snap.forwardDetails;
        if (fwdDetails && (fwdDetails.fwdA !== 'NONE' || fwdDetails.fwdB !== 'NONE')) {
            const fwdParts = [];
            if (fwdDetails.fwdA !== 'NONE') fwdParts.push(`Operand A ← ${fwdDetails.fwdA} (${fwdDetails.reasonA || 'Bypass'})`);
            if (fwdDetails.fwdB !== 'NONE') fwdParts.push(`Operand B ← ${fwdDetails.fwdB} (${fwdDetails.reasonB || 'Bypass'})`);
            entries.push({
                cycle: c,
                category: 'forwarding',
                level: 'success',
                badge: 'FORWARDING',
                message: `Cycle ${c} (EX Stage): Forwarding Unit active. Direct hardware data bypass applied: ${fwdParts.join(', ')}. RAW hazard resolved with 0 stall cycles.`
            });
        }

        // 2. Hazards & Stalls
        if (snap.stall) {
            const reason = snap.hazardDetails?.reason || 'Pipeline interlock stall';
            const isLoadUse = snap.hazard === 'LOAD_USE' || reason.toLowerCase().includes('load');
            entries.push({
                cycle: c,
                category: 'hazards',
                level: 'warning',
                badge: isLoadUse ? 'LOAD-USE STALL' : 'PIPELINE STALL',
                message: `Cycle ${c} (Hazard Unit): ${reason}. Hardware interlock asserted: PC and IF/ID latches frozen. Synchronous bubble injected into ID/EX.`
            });
        }

        // 3. Branches & Flushes
        if (snap.branchInfo && snap.branchInfo.branch) {
            const taken = snap.branchInfo.taken;
            const target = snap.branchInfo.target !== null ? '0x' + (snap.branchInfo.target).toString(16).toUpperCase().padStart(4, '0') : 'PC+4';
            const bp = snap.branchPredictor;
            const wasPredicted = bp && bp.lastPrediction ? bp.lastPrediction.taken : null;

            if (snap.flush) {
                entries.push({
                    cycle: c,
                    category: 'branches',
                    level: 'danger',
                    badge: 'PIPELINE FLUSH',
                    message: `Cycle ${c} (Control Hazard): Branch resolved Taken to target ${target}. Speculative instruction in IF stage flushed (converted to NOP bubble). Branch penalty: 1 cycle.`
                });
            } else if (bp && bp.enabled && taken) {
                entries.push({
                    cycle: c,
                    category: 'branches',
                    level: 'success',
                    badge: 'PREDICTOR HIT',
                    message: `Cycle ${c} (Dynamic Branch Predictor): Branch accurately predicted Taken by 2-bit counter FSM! Target ${target} speculatively fetched. Branch penalty: 0 cycles.`
                });
            }
        }

        // 4. L1 Cache Events
        if (snap.l1dCache && snap.l1dCache.lastAccessResult) {
            const res = snap.l1dCache.lastAccessResult;
            if (!res.hit && snap.l1dCache.enabled) {
                entries.push({
                    cycle: c,
                    category: 'memory',
                    level: 'warning',
                    badge: 'D-CACHE MISS',
                    message: `Cycle ${c} (L1-D Cache): Compulsory ${res.missType || 'cold'} miss at Set ${res.index}, Tag 0x${(res.tag || 0).toString(16).toUpperCase()}. Memory fill initiated (+${snap.l1dCache.missPenalty || 4} cycle penalty).`
                });
            }
        }
    }

    _analyzeGPUSnapshot(snap, entries) {
        const c = snap.cycle;
        if (c === 0) return;

        // Warp Scheduler Choice
        if (snap.schedulerChoice !== null) {
            const wId = snap.schedulerChoice;
            const schedType = snap.schedulerType || 'Round-Robin';
            entries.push({
                cycle: c,
                category: 'all',
                level: 'info',
                badge: `WARP ${wId}`,
                message: `Cycle ${c} (SM Scheduler): Warp ${wId} scheduled using ${schedType}. SIMT lanes executing in lockstep.`
            });
        }

        // Bank Conflicts
        if (snap.bankConflictResult && snap.bankConflictResult.hasConflict) {
            const cr = snap.bankConflictResult;
            entries.push({
                cycle: c,
                category: 'memory',
                level: 'danger',
                badge: 'BANK CONFLICT',
                message: `Cycle ${c} (Shared Memory): ${cr.serializedCycles}-way bank conflict detected across 8 memory banks (${cr.conflicts} lane clashes). Hardware serializes accesses over ${cr.serializedCycles} clock passes.`
            });
        }
    }

    _renderFeed() {
        if (!this.feed) return;

        const filtered = this.logEntries.filter(e => {
            if (this.filter === 'all') return true;
            return e.category === this.filter;
        });

        if (filtered.length === 0) {
            this.feed.innerHTML = `
                <div class="stream-placeholder mono text-xs text-muted">
                    No events recorded matching filter "${this.filter}".
                </div>
            `;
            return;
        }

        this.feed.innerHTML = filtered.slice(-30).map(entry => {
            const levelClass = entry.level === 'danger' ? 'text-red'
                : entry.level === 'warning' ? 'text-amber'
                : entry.level === 'success' ? 'text-accent'
                : 'text-dim';
            const badgeHtml = entry.badge ? `<span class="stream-badge stream-badge-${entry.level || 'info'}">${entry.badge}</span>` : '';

            return `
                <div class="stream-row fade-in">
                    <span class="stream-cycle mono">C${entry.cycle}</span>
                    ${badgeHtml}
                    <span class="stream-msg ${levelClass}">${entry.message}</span>
                </div>
            `;
        }).join('');

        this.feed.scrollTop = this.feed.scrollHeight;
    }

    reset() {
        this.logEntries = [];
        if (this.feed) {
            this.feed.innerHTML = `
                <div class="stream-placeholder mono text-xs text-muted">
                    Simulation reset. Ready for clock cycles...
                </div>
            `;
        }
    }
}
