import {
    Opcode, LATENCY, GPU_MEM_LATENCY, Stage, WarpState,
    SIMT_LANES, NUM_WARPS, NUM_REGISTERS, MEM_SIZE,
    createWarp, createGPUSnapshot, createCoalescingResult,
    WarpSchedulerType, NUM_SHARED_BANKS, createBankConflictResult
} from './types.js';

export class GPUPipeline {
    constructor(instructions, labels) {
        this.instructions = instructions || [];
        this.labels = labels || {};
        this.history = [];
        this.states = [];
        this.cycle = 0;
        this.schedulerType = WarpSchedulerType.ROUND_ROBIN;
        
        // Initial state setup
        this.state = this._createInitialState();
        this._saveSnapshot();
    }

    get scheduler() {
        return this.schedulerType;
    }

    set scheduler(type) {
        this.schedulerType = type;
    }

    _createInitialState() {
        const warps = [];
        for (let i = 0; i < NUM_WARPS; i++) {
            warps.push(createWarp(i));
        }

        const scoreboards = [];
        for (let i = 0; i < NUM_WARPS; i++) {
            scoreboards.push({ pendingWrites: [] });
        }

        // Shared memory for all warps
        const memory = new Array(MEM_SIZE).fill(0);

        return {
            warps,
            scoreboards,
            memory,
            lastScheduledWarp: -1,
            coalescingResult: null, // Holds latest memory coalescing result if any
            bankConflictResult: null, // Holds latest shared memory bank conflict result
            warpInstructionStages: Array.from({ length: NUM_WARPS }, () => [])
        };
    }

    reset() {
        this.history = [];
        this.states = [];
        this.cycle = 0;
        this.state = this._createInitialState();
        this._saveSnapshot();
    }

    get currentCycle() {
        return this.cycle;
    }

    get isHalted() {
        return this.state.warps.every(w => w.state === WarpState.FINISHED);
    }

    getCurrentSnapshot() {
        return this.history[this.history.length - 1];
    }

    getHistory() {
        return this.history;
    }

    stepBackward() {
        if (this.cycle > 0 && this.states.length > this.cycle) {
            this.cycle--;
            this.state = this._cloneState(this.states[this.cycle]);
            this.history = this.history.slice(0, this.cycle + 1);
            this.states = this.states.slice(0, this.cycle + 1);
        }
        return this.getCurrentSnapshot();
    }

    stepForward() {
        if (this.isHalted) {
            return this.getCurrentSnapshot();
        }

        this.cycle++;
        const nextState = this._cloneState(this.state);
        
        // Clear transient telemetry from previous cycle
        nextState.coalescingResult = null;
        nextState.bankConflictResult = null;

        // 1. Decrement stall counters and manage scoreboards
        for (let i = 0; i < NUM_WARPS; i++) {
            const warp = nextState.warps[i];
            const scoreboard = nextState.scoreboards[i];

            if (warp.stallCyclesRemaining > 0) {
                warp.stallCyclesRemaining--;
                if (warp.stallCyclesRemaining === 0) {
                    // Remove pending register writes
                    if (scoreboard.pendingWrites.length > 0) {
                        scoreboard.pendingWrites.shift(); 
                    }
                    if (warp.state === WarpState.STALLED) {
                        warp.state = WarpState.READY;
                    }
                }
            } else if (warp.state === WarpState.STALLED) {
                // Failsafe state correction
                warp.state = WarpState.READY;
            }
        }

        // 2. Scheduler selection (Round-robin or Greedy-Then-Oldest)
        const selectedWarpId = this._selectWarp(nextState);

        // 3 & 4. Execute instruction if a warp was selected
        if (selectedWarpId !== -1) {
            nextState.lastScheduledWarp = selectedWarpId;
            const warp = nextState.warps[selectedWarpId];
            const scoreboard = nextState.scoreboards[selectedWarpId];
            const inst = this.instructions[warp.pc];

            // Record stage for visualization
            nextState.warpInstructionStages[selectedWarpId].push({
                instruction: inst,
                stage: Stage.EXECUTE,
                cycle: this.cycle
            });

            if (inst.opcode === Opcode.HALT) {
                warp.state = WarpState.FINISHED;
                warp.pc++;
            } else if (inst.opcode === Opcode.LD || inst.opcode === Opcode.ST) {
                // Memory Coalescing & Bank Conflict Check
                const addresses = [];
                for (let lane = 0; lane < SIMT_LANES; lane++) {
                    if ((warp.activeMask & (1 << lane)) !== 0) {
                        // In SIMT execution: thread lane address = base + lane * stride
                        const rs1Val = inst.rs1 != null ? warp.registers[lane][inst.rs1] : 0;
                        const addr = (rs1Val > 0 ? rs1Val * lane : lane) + (inst.imm || 0);
                        addresses.push(addr);
                        
                        if (inst.opcode === Opcode.LD) {
                            if (inst.rd != null) {
                                warp.registers[lane][inst.rd] = nextState.memory[addr % MEM_SIZE];
                            }
                        } else { // ST
                            if (inst.rs2 != null) {
                                nextState.memory[addr % MEM_SIZE] = warp.registers[lane][inst.rs2];
                            }
                        }
                    }
                }
                
                nextState.coalescingResult = this._computeCoalescing(addresses);
                nextState.bankConflictResult = this._computeBankConflicts(addresses);

                if (inst.opcode === Opcode.LD && inst.rd != null) {
                    scoreboard.pendingWrites.push(inst.rd);
                    warp.state = WarpState.STALLED;
                    const conflictPenalty = nextState.bankConflictResult?.hasConflict ? (nextState.bankConflictResult.serializedCycles - 1) : 0;
                    warp.stallCyclesRemaining = GPU_MEM_LATENCY + conflictPenalty;
                }
                warp.pc++;
            } else if (inst.opcode === Opcode.DIV_IF) {
                // SIMT Divergence handling
                warp.divergenceStack.push({
                    reconvergePC: warp.pc + 3,
                    savedMask: warp.activeMask
                });
                // Set mask to even lanes for "then" path
                warp.activeMask = 0xAA; // 0b10101010
                warp.pc++;
            } else {
                // ALU operation
                for (let lane = 0; lane < SIMT_LANES; lane++) {
                    if ((warp.activeMask & (1 << lane)) !== 0) {
                        this._executeALU(inst, warp.registers[lane]);
                    }
                }

                if (inst.rd != null) {
                    scoreboard.pendingWrites.push(inst.rd);
                    warp.state = WarpState.STALLED;
                    warp.stallCyclesRemaining = LATENCY[inst.opcode] || 1;
                }
                warp.pc++;
            }

            // 5. Divergence management check
            this._handleDivergencePostExecution(warp);
        }

        this.state = nextState;
        this._saveSnapshot();
        return this.getCurrentSnapshot();
    }

    _handleDivergencePostExecution(warp) {
        if (warp.divergenceStack.length > 0) {
            const divState = warp.divergenceStack[warp.divergenceStack.length - 1];
            // If we just finished the "then" path (which is 1 instruction)
            if (warp.pc === divState.reconvergePC - 2) {
                // We advance PC to the else path, swap mask
                warp.activeMask = 0x55; // 0b01010101 (odd lanes)
                warp.pc++; // Skip to else instruction
            } 
            // If we just finished the "else" path
            else if (warp.pc === divState.reconvergePC) {
                warp.activeMask = divState.savedMask;
                warp.divergenceStack.pop();
            }
        }
    }

    _executeALU(inst, regs) {
        if (inst.rd == null || inst.rd === 0) {
            if (regs[0] !== undefined) regs[0] = 0;
            return;
        }
        
        let val1 = inst.rs1 != null ? regs[inst.rs1] : 0;
        let val2 = (inst.opcode === Opcode.ADDI || inst.imm != null)
            ? (inst.imm ?? 0)
            : (inst.rs2 != null ? regs[inst.rs2] : 0);

        switch (inst.opcode) {
            case Opcode.ADD:
            case Opcode.ADDI: regs[inst.rd] = (val1 + val2) | 0; break;
            case Opcode.SUB:  regs[inst.rd] = (val1 - val2) | 0; break;
            case Opcode.MUL:  regs[inst.rd] = (val1 * val2) | 0; break;
            case Opcode.DIV:  regs[inst.rd] = val2 !== 0 ? Math.floor(val1 / val2) : 0; break;
            case Opcode.AND:  regs[inst.rd] = (val1 & val2) | 0; break;
            case Opcode.OR:   regs[inst.rd] = (val1 | val2) | 0; break;
            case Opcode.XOR:  regs[inst.rd] = (val1 ^ val2) | 0; break;
            case Opcode.SLL:  regs[inst.rd] = val1 << (val2 & 0x1F); break;
            case Opcode.SRL:  regs[inst.rd] = val1 >>> (val2 & 0x1F); break;
            default: break;
        }
        regs[0] = 0; // Maintain R0 hardwired zero invariant
    }

    _selectWarp(nextState) {
        const isEligible = (warpId) => {
            const warp = nextState.warps[warpId];
            const scoreboard = nextState.scoreboards[warpId];
            if (warp.state !== WarpState.READY) return false;
            if (warp.pc >= this.instructions.length) {
                warp.state = WarpState.FINISHED;
                return false;
            }
            const inst = this.instructions[warp.pc];
            const needsRs1 = inst.rs1 !== null && inst.rs1 !== undefined;
            const needsRs2 = inst.rs2 !== null && inst.rs2 !== undefined;
            if (needsRs1 && scoreboard.pendingWrites.includes(inst.rs1)) return false;
            if (needsRs2 && scoreboard.pendingWrites.includes(inst.rs2)) return false;
            return true;
        };

        if (this.schedulerType === WarpSchedulerType.GTO) {
            // Greedy-Then-Oldest (GTO):
            // 1. Greedy: if last scheduled warp is still eligible, keep executing it
            if (nextState.lastScheduledWarp >= 0 && isEligible(nextState.lastScheduledWarp)) {
                return nextState.lastScheduledWarp;
            }
            // 2. Oldest: prioritize earliest ready warp (lowest warp index)
            for (let i = 0; i < NUM_WARPS; i++) {
                if (isEligible(i)) {
                    return i;
                }
            }
            return -1;
        }

        // Round-Robin scheduler
        for (let i = 1; i <= NUM_WARPS; i++) {
            const warpId = (nextState.lastScheduledWarp + i) % NUM_WARPS;
            if (isEligible(warpId)) {
                return warpId;
            }
        }
        return -1;
    }

    _computeBankConflicts(addresses) {
        if (!addresses || addresses.length === 0) return null;

        const bankMapping = {};
        for (let b = 0; b < NUM_SHARED_BANKS; b++) {
            bankMapping[b] = [];
        }

        addresses.forEach((addr, lane) => {
            const bankId = ((addr % NUM_SHARED_BANKS) + NUM_SHARED_BANKS) % NUM_SHARED_BANKS;
            const wordOffset = Math.floor(addr / NUM_SHARED_BANKS);
            bankMapping[bankId].push({ lane, address: addr, wordOffset });
        });

        let maxDegree = 1;
        let totalConflicts = 0;

        for (let b = 0; b < NUM_SHARED_BANKS; b++) {
            const reqs = bankMapping[b];
            if (reqs.length > 1) {
                const uniqueAddrs = new Set(reqs.map(r => r.address));
                if (uniqueAddrs.size > 1) {
                    totalConflicts += (uniqueAddrs.size - 1);
                    if (uniqueAddrs.size > maxDegree) {
                        maxDegree = uniqueAddrs.size;
                    }
                }
            }
        }

        return createBankConflictResult(addresses, totalConflicts, maxDegree, bankMapping);
    }

    _computeCoalescing(addresses) {
        if (addresses.length === 0) return null;

        // Assuming 32-byte cache lines, and each word is 4 bytes.
        // Cache line index = Math.floor((addr * 4) / 32) = Math.floor(addr / 8)
        const cacheLines = new Set();
        let isContiguous = true;
        let prevAddr = null;

        for (const addr of addresses) {
            if (prevAddr !== null && addr !== prevAddr + 1) {
                isContiguous = false;
            }
            prevAddr = addr;
            cacheLines.add(Math.floor(addr / 8));
        }

        return createCoalescingResult(addresses, isContiguous, cacheLines.size);
    }

    _cloneState(state) {
        // Deep clone the state to avoid mutating historical snapshots
        return {
            warps: state.warps.map(w => ({
                ...w,
                registers: w.registers.map(r => [...r]),
                divergenceStack: w.divergenceStack.map(d => ({...d}))
            })),
            scoreboards: state.scoreboards.map(s => ({
                ...s,
                pendingWrites: [...s.pendingWrites]
            })),
            memory: [...state.memory],
            lastScheduledWarp: state.lastScheduledWarp,
            coalescingResult: state.coalescingResult ? { ...state.coalescingResult, addresses: [...state.coalescingResult.addresses] } : null,
            bankConflictResult: state.bankConflictResult ? { ...state.bankConflictResult, addresses: [...state.bankConflictResult.addresses], bankMapping: { ...state.bankConflictResult.bankMapping } } : null,
            warpInstructionStages: state.warpInstructionStages.map(stages => [...stages])
        };
    }

    _saveSnapshot() {
        // Adapt internal state to createGPUSnapshot's expected format.
        // The internal scoreboards use arrays (pendingWrites), but the snapshot
        // contract expects an object keyed by warp ID with Sets of busy registers.
        const scoreboardObj = {};
        for (let i = 0; i < NUM_WARPS; i++) {
            scoreboardObj[i] = new Set(this.state.scoreboards[i]?.pendingWrites || []);
        }

        // Build the warpInstructionStages for the grid
        const warpInstructionStages = [];
        for (let w = 0; w < NUM_WARPS; w++) {
            const stages = this.state.warpInstructionStages[w] || [];
            for (const entry of stages) {
                warpInstructionStages.push({
                    warpId: w,
                    instructionIndex: entry.instruction?.line ?? 0,
                    instruction: entry.instruction,
                    stage: entry.stage,
                    cycle: entry.cycle,
                    stages: [entry],
                });
            }
        }

        const snapshot = createGPUSnapshot(this.cycle, {
            warps: this.state.warps,
            scoreboard: scoreboardObj,
            memory: this.state.memory,
            schedulerChoice: this.state.lastScheduledWarp >= 0 ? this.state.lastScheduledWarp : null,
            schedulerType: this.schedulerType,
            issuedInstruction: null,
            coalescingResult: this.state.coalescingResult,
            bankConflictResult: this.state.bankConflictResult,
            halted: this.isHalted,
            warpInstructionStages,
        });
        this.states.push(this._cloneState(this.state));
        this.history.push(snapshot);
    }
}
