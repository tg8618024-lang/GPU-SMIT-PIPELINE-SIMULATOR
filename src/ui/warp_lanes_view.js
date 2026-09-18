import { WarpState, SIMT_LANES, NUM_WARPS, NUM_REGISTERS } from '../engine/types.js';

export class WarpLanesView {
    /**
     * @param {HTMLElement} containerElement 
     */
    constructor(containerElement) {
        this.container = containerElement;
        this.container.classList.add('warp-lanes-view');
        this.selectedWarpId = 0;

        this._buildDOM();
    }

    _buildDOM() {
        this.container.innerHTML = '';

        // A. Warp Selector Tabs
        this.tabsContainer = document.createElement('div');
        this.tabsContainer.className = 'warp-tabs';
        this.tabs = [];
        
        for (let i = 0; i < NUM_WARPS; i++) {
            const tab = document.createElement('div');
            tab.className = 'warp-tab';
            tab.dataset.warpId = i;
            tab.addEventListener('click', () => this.selectWarp(i));

            const title = document.createElement('div');
            title.className = 'warp-tab-title';
            title.textContent = `W${i}`;

            const badge = document.createElement('div');
            badge.className = 'warp-tab-badge warp-state-finished';
            badge.textContent = 'FINISHED';

            const pc = document.createElement('div');
            pc.className = 'warp-tab-pc';
            pc.textContent = 'PC: 0';

            tab.appendChild(title);
            tab.appendChild(badge);
            tab.appendChild(pc);
            
            this.tabs.push({ element: tab, badge, pc });
            this.tabsContainer.appendChild(tab);
        }
        this.container.appendChild(this.tabsContainer);

        // B. SIMT Lane Grid
        this.gridContainer = document.createElement('div');
        this.gridContainer.className = 'simt-grid';

        // Active mask row
        this.activeMaskDisplay = document.createElement('div');
        this.activeMaskDisplay.className = 'active-mask-display';
        this.gridContainer.appendChild(this.activeMaskDisplay);

        this.lanesContainer = document.createElement('div');
        this.lanesContainer.className = 'lanes-container';
        this.lanes = [];
        
        for (let i = 0; i < SIMT_LANES; i++) {
            const lane = document.createElement('div');
            lane.className = 'lane lane-masked';
            
            const title = document.createElement('div');
            title.className = 'lane-title';
            title.textContent = `T${i}`;

            const alu = document.createElement('div');
            alu.className = 'lane-alu';
            alu.textContent = '-';

            const regs = document.createElement('div');
            regs.className = 'lane-regs';
            for (let r = 0; r < NUM_REGISTERS; r++) {
                const reg = document.createElement('div');
                reg.className = 'lane-reg';
                reg.textContent = `R${r}: 0`;
                regs.appendChild(reg);
            }

            lane.appendChild(title);
            lane.appendChild(alu);
            lane.appendChild(regs);
            
            this.lanes.push({ element: lane, alu, regsContainer: regs });
            this.lanesContainer.appendChild(lane);
        }
        this.gridContainer.appendChild(this.lanesContainer);
        this.container.appendChild(this.gridContainer);

        // C. Warp Scheduler Queue
        this.schedulerContainer = document.createElement('div');
        this.schedulerContainer.className = 'scheduler-queue';
        this.container.appendChild(this.schedulerContainer);

        // D. Memory Coalescing Result
        this.coalescingContainer = document.createElement('div');
        this.coalescingContainer.className = 'coalescing-result';
        this.coalescingContainer.style.display = 'none';
        this.container.appendChild(this.coalescingContainer);
    }

    selectWarp(warpId) {
        this.selectedWarpId = warpId;
        
        // Update tab styles
        this.tabs.forEach((tab, i) => {
            if (i === warpId) {
                tab.element.classList.add('warp-tab-active');
            } else {
                tab.element.classList.remove('warp-tab-active');
            }
        });
        
        // If we have a stored snapshot, re-render the lanes for this newly selected warp
        if (this.lastSnapshot) {
            this._updateLanes(this.lastSnapshot);
        }
    }

    /**
     * Update the warp visualization from a GPU snapshot.
     * @param {GPUSnapshot} snapshot
     */
    update(snapshot) {
        this.lastSnapshot = snapshot;

        // Auto-select scheduled warp if available
        if (snapshot.schedulerChoice !== null && snapshot.schedulerChoice !== undefined) {
            this.selectWarp(snapshot.schedulerChoice);
        } else if (this.selectedWarpId === null) {
            this.selectWarp(0);
        } else {
            // Re-apply selection to ensure active class
            this.selectWarp(this.selectedWarpId);
        }

        // Update Tabs (A)
        snapshot.warps.forEach((warp, i) => {
            const tab = this.tabs[i];
            tab.pc.textContent = `PC: ${warp.pc}`;
            tab.badge.textContent = warp.state;
            
            // Update state class
            tab.badge.className = 'warp-tab-badge';
            switch (warp.state) {
                case WarpState.READY: tab.badge.classList.add('warp-state-ready'); break;
                case WarpState.RUNNING: tab.badge.classList.add('warp-state-running'); break;
                case WarpState.STALLED: tab.badge.classList.add('warp-state-stalled'); break;
                case WarpState.DIVERGED: tab.badge.classList.add('warp-state-diverged'); break;
                case WarpState.FINISHED: tab.badge.classList.add('warp-state-finished'); break;
                default: tab.badge.classList.add('warp-state-finished'); break;
            }
        });

        // Update Scheduler Queue (C)
        this.schedulerContainer.innerHTML = '<h4>Scheduler Status</h4>';
        snapshot.warps.forEach((warp, i) => {
            const entry = document.createElement('div');
            if (i === snapshot.schedulerChoice) {
                entry.textContent = `W${i}: SCHEDULED`;
                entry.style.fontWeight = 'bold';
                entry.style.color = '#2e8b57';
            } else {
                let reason = 'Skipped';
                if (warp.state === WarpState.FINISHED) reason = 'Finished';
                else if (warp.state === WarpState.STALLED) reason = 'Stalled on Scoreboard';
                else reason = 'Lower Priority';
                entry.textContent = `W${i}: ${reason}`;
            }
            this.schedulerContainer.appendChild(entry);
        });

        // Update Memory Coalescing Result (D)
        if (snapshot.coalescingResult && snapshot.coalescingResult.addresses && snapshot.coalescingResult.addresses.length > 0) {
            this.coalescingContainer.style.display = 'block';
            this.coalescingContainer.innerHTML = '<h4>Memory Coalescing</h4>';
            
            const isCoalesced = snapshot.coalescingResult.coalesced || snapshot.coalescingResult.transactions === 1;
            const statusDiv = document.createElement('div');
            statusDiv.className = isCoalesced ? 'coalescing-good' : 'coalescing-bad';
            statusDiv.textContent = `Transactions: ${snapshot.coalescingResult.transactions} - ${isCoalesced ? 'Coalesced' : 'Uncoalesced'}`;
            this.coalescingContainer.appendChild(statusDiv);
            
            const addrDiv = document.createElement('div');
            addrDiv.textContent = `Addresses: [${snapshot.coalescingResult.addresses.join(', ')}]`;
            this.coalescingContainer.appendChild(addrDiv);
        } else {
            this.coalescingContainer.style.display = 'none';
        }

        this._updateLanes(snapshot);
    }

    _updateLanes(snapshot) {
        const warp = snapshot.warps[this.selectedWarpId];
        if (!warp) return;

        // Update Active Mask display
        let maskStr = '';
        for (let i = 0; i < SIMT_LANES; i++) {
            const bit = (warp.activeMask >> i) & 1;
            maskStr += `[${bit}]`;
        }
        this.activeMaskDisplay.textContent = `Active Mask: ${maskStr}`;

        // Update each lane (B)
        for (let i = 0; i < SIMT_LANES; i++) {
            const isActive = ((warp.activeMask >> i) & 1) === 1;
            const laneUI = this.lanes[i];
            
            laneUI.element.className = 'lane';
            if (isActive) {
                laneUI.element.classList.add('lane-active');
                
                // Show ALU operation if running
                if (warp.state === WarpState.RUNNING || warp.state === WarpState.DIVERGED) {
                    laneUI.alu.textContent = warp.instruction ? warp.instruction.opcode : 'IDLE';
                } else {
                    laneUI.alu.textContent = '-';
                }
            } else {
                laneUI.element.classList.add('lane-masked');
                laneUI.alu.textContent = 'MASKED';
            }

            // Update registers
            for (let r = 0; r < NUM_REGISTERS; r++) {
                const regDiv = laneUI.regsContainer.children[r];
                const val = warp.registers ? warp.registers[i][r] : 0;
                regDiv.textContent = `R${r}: ${val}`;
            }
        }
    }

    clear() {
        this.lastSnapshot = null;
        
        // Reset tabs
        this.tabs.forEach((tab, i) => {
            tab.pc.textContent = 'PC: 0';
            tab.badge.textContent = 'READY';
            tab.badge.className = 'warp-tab-badge warp-state-ready';
            if (i === 0) {
                this.selectWarp(0);
            }
        });

        // Reset lanes
        this.activeMaskDisplay.textContent = '';
        for (let i = 0; i < SIMT_LANES; i++) {
            const laneUI = this.lanes[i];
            laneUI.element.className = 'lane lane-masked';
            laneUI.alu.textContent = '-';
            for (let r = 0; r < NUM_REGISTERS; r++) {
                laneUI.regsContainer.children[r].textContent = `R${r}: 0`;
            }
        }

        this.schedulerContainer.innerHTML = '';
        this.coalescingContainer.style.display = 'none';
        this.coalescingContainer.innerHTML = '';
    }
}
