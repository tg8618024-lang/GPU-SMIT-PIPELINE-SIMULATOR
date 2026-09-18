// ──────────────────────────────────────────────────────────────────────────────
// SIMT-Flow: Hennessy & Patterson 5-Stage Pipelined CPU Microarchitecture
// ──────────────────────────────────────────────────────────────────────────────
// Full cycle-accurate execution engine with explicit pipeline latches:
//   IF  (Instruction Fetch)   -> IF/ID Latch
//   ID  (Instruction Decode)  -> ID/EX Latch
//   EX  (Execute / ALU)       -> EX/MEM Latch
//   MEM (Data Memory Access)  -> MEM/WB Latch
//   WB  (Register Writeback)  -> Register File (R0..R7)
//
// Subsystems:
//   - Centralized ControlUnit
//   - ForwardingUnit (EX/MEM -> EX, MEM/WB -> EX with priority, R0 protected)
//   - HazardUnit (Load-Use interlock, RAW detection without bypass, Branch flush)
//   - Byte-aligned PC System (PC, PC+4, Branch/Jump Target MUX)
//   - Invariant Assertions & Comprehensive Metrics Tracking
// ──────────────────────────────────────────────────────────────────────────────

import {
    Opcode, LATENCY, Stage, ForwardSrc, HazardType,
    NUM_REGISTERS, MEM_SIZE,
    createInstruction, createBubble,
    createIF_ID, createID_EX, createEX_MEM, createMEM_WB,
    createCPUSnapshot, createGridCell,
    CacheType, WritePolicy, BranchPredictorType,
} from './types.js';
import { ControlUnit } from './control_unit.js';
import { ForwardingUnit } from './forwarding_unit.js';
import { HazardUnit } from './hazard_unit.js';
import { L1Cache } from './cache.js';
import { BranchPredictor } from './branch_predictor.js';

export class CPUPipeline {
    /**
     * @param {Object[]} instructions - Array of parsed instructions
     * @param {Object<string, number>} labels - Label name to instruction index mapping
     */
    constructor(instructions = [], labels = {}) {
        this.instructions = instructions;
        this.labels = labels;
        this._forwardingEnabled = true;

        // Breakpoint support
        this.breakpoints = new Set(); // Set of byte PCs (e.g. 0, 4, 8)

        // Metrics & Statistics
        this.stats = {
            totalCycles: 0,
            completedInstructions: 0,
            stalls: 0,
            flushes: 0,
            forwardingEvents: 0,
            loadUseHazards: 0,
            rawHazards: 0,
            branchesTotal: 0,
            branchesTaken: 0,
            branchesNotTaken: 0,
            jumps: 0,
        };

        // L1 Cache Hierarchy & Branch Predictor Subsystems
        this.l1iCache = new L1Cache({ name: 'L1-I', cacheType: CacheType.DIRECT_MAPPED, numSets: 8, blockSize: 4, missPenalty: 4 });
        this.l1dCache = new L1Cache({ name: 'L1-D', cacheType: CacheType.TWO_WAY_SET, numSets: 8, blockSize: 4, writePolicy: WritePolicy.WRITE_THROUGH, missPenalty: 4 });
        this.branchPredictor = new BranchPredictor({ type: BranchPredictorType.DYNAMIC_2BIT, btbEntries: 16 });

        // Disabled by default for baseline golden tests
        this.l1iCache.enabled = false;
        this.l1dCache.enabled = false;
        this.branchPredictor.enabled = false;

        this.reset();
    }

    get forwardingEnabled() {
        return this._forwardingEnabled;
    }

    set forwardingEnabled(val) {
        if (this._forwardingEnabled !== val) {
            this._forwardingEnabled = Boolean(val);
            this.reset();
        }
    }

    get l1iEnabled() {
        return this.l1iCache.enabled;
    }

    set l1iEnabled(val) {
        this.l1iCache.enabled = Boolean(val);
    }

    get l1dEnabled() {
        return this.l1dCache.enabled;
    }

    set l1dEnabled(val) {
        this.l1dCache.enabled = Boolean(val);
    }

    get branchPredictorEnabled() {
        return this.branchPredictor.enabled;
    }

    set branchPredictorEnabled(val) {
        this.branchPredictor.enabled = Boolean(val);
    }

    /**
     * Resets the CPU pipeline to its initial state at cycle 0.
     */
    reset() {
        // Architectural State
        this.registers = new Array(NUM_REGISTERS).fill(0);
        this.memory = new Array(MEM_SIZE).fill(0);
        this.pc = 0;             // Byte PC (0x0000, 0x0004, 0x0008, ...)
        this.cycle = 0;
        this._isHalted = false;

        // Register write history tracking: register index -> { cycle, pc, instruction }
        this.regHistory = Array.from({ length: NUM_REGISTERS }, () => ({
            lastModifiedCycle: 0,
            producerInstruction: 'Initial',
        }));

        // Pipeline Registers (Latches) - initially all invalid/bubbles
        this.if_id = createIF_ID(0, 4, null, false);
        this.id_ex = createID_EX({ valid: false, isBubble: true });
        this.ex_mem = createEX_MEM({ valid: false, isBubble: true });
        this.mem_wb = createMEM_WB({ valid: false, isBubble: true });

        // Execution & Timeline Tracking
        this.history = [];
        this.instructionTracker = []; // Maps instruction ID to metadata
        this.gridHistory = [];        // gridHistory[instructionIndex][cycle] = GridCell
        this.completedInstructions = 0;

        // Reset Statistics
        this.stats = {
            totalCycles: 0,
            completedInstructions: 0,
            stalls: 0,
            flushes: 0,
            forwardingEvents: 0,
            loadUseHazards: 0,
            rawHazards: 0,
            branchesTotal: 0,
            branchesTaken: 0,
            branchesNotTaken: 0,
            jumps: 0,
        };

        // Populate instruction tracker for grid
        for (let i = 0; i < this.instructions.length; i++) {
            const inst = this.instructions[i];
            this.instructionTracker.push({
                id: i,
                pc: i * 4,
                text: inst.raw || `Instr ${i}`,
                enteredCycle: 0,
            });
            this.gridHistory[i] = [];
        }

        // Reset Subsystems
        this.l1iCache.reset();
        this.l1dCache.reset();
        this.branchPredictor.reset();

        // Save cycle 0 initial snapshot
        this._saveSnapshot();
    }

    get currentCycle() {
        return this.cycle;
    }

    get isHalted() {
        return this._isHalted;
    }

    get cpi() {
        if (this.completedInstructions === 0) return 0;
        return this.cycle / this.completedInstructions;
    }

    get ipc() {
        if (this.cycle === 0) return 0;
        return this.completedInstructions / this.cycle;
    }

    getCurrentSnapshot() {
        return this.history[this.cycle] || this.history[this.history.length - 1];
    }

    getHistory() {
        return this.history;
    }

    /**
     * Add or remove a breakpoint at a given PC address (byte PC).
     */
    toggleBreakpoint(pc) {
        if (this.breakpoints.has(pc)) {
            this.breakpoints.delete(pc);
        } else {
            this.breakpoints.add(pc);
        }
    }

    /**
     * Advance pipeline by exactly one clock cycle.
     */
    stepForward() {
        if (this._isHalted) {
            return this.getCurrentSnapshot();
        }

        this.cycle++;
        this.stats.totalCycles = this.cycle;

        // Architectural state mutations
        const nextRegisters = [...this.registers];
        const nextMemory = [...this.memory];
        let nextPc = this.pc;

        // Pipeline latches for next cycle
        let next_if_id = createIF_ID(0, 4, null, false);
        let next_id_ex = createID_EX({ valid: false, isBubble: true });
        let next_ex_mem = createEX_MEM({ valid: false, isBubble: true });
        let next_mem_wb = createMEM_WB({ valid: false, isBubble: true });

        // Hazard & Control flags
        let stall = false;
        let dCacheStall = false;
        let flush = false;
        let branchTaken = false;
        let isJump = false;
        let branchTarget = 0;
        let activeHazard = HazardType.NONE;
        let hazardDetails = null;

        let fwdA = ForwardSrc.NONE;
        let fwdB = ForwardSrc.NONE;
        let forwardDetails = { fwdA: 'NONE', fwdB: 'NONE', reasonA: '', reasonB: '' };

        let completedInThisCycle = 0;
        const assertions = [];

        // Active signals for datapath visualization
        const activeSignals = {
            pcMux: 'PC+4',
            aluInputA: 0,
            aluInputB: 0,
            aluResult: 0,
            memAddress: null,
            memReadData: null,
            memWriteData: null,
            wbReg: null,
            wbData: null,
        };

        // =====================================================================
        // STAGE 5: WRITE BACK (WB)
        // =====================================================================
        const mem_wb = this.mem_wb;
        if (mem_wb && mem_wb.valid && !mem_wb.isBubble) {
            const inst = mem_wb.instruction;
            const instIdx = inst ? (inst.index ?? inst.line) : null;

            if (mem_wb.regWrite && mem_wb.rd !== null && mem_wb.rd !== undefined) {
                // R0 is strictly hardwired to 0
                if (mem_wb.rd === 0) {
                    assertions.push({ pass: true, msg: 'Write to R0 discarded (hardwired to zero)' });
                } else if (mem_wb.rd > 0 && mem_wb.rd < NUM_REGISTERS) {
                    const writeData = mem_wb.memToReg ? mem_wb.memData : mem_wb.aluResult;
                    nextRegisters[mem_wb.rd] = writeData;
                    activeSignals.wbReg = mem_wb.rd;
                    activeSignals.wbData = writeData;

                    this.regHistory[mem_wb.rd] = {
                        lastModifiedCycle: this.cycle,
                        producerInstruction: inst?.raw || 'Instr',
                    };
                }
            }

            completedInThisCycle++;
            if (instIdx !== null && instIdx >= 0) {
                this._recordGrid(instIdx, Stage.WB, this.cycle);
            }

            // If WB just committed a HALT instruction, halt CPU
            if (inst && inst.opcode === Opcode.HALT) {
                this._isHalted = true;
            }
        }

        // =====================================================================
        // STAGE 4: MEMORY ACCESS (MEM)
        // =====================================================================
        const ex_mem = this.ex_mem;
        if (ex_mem && ex_mem.valid && !ex_mem.isBubble) {
            const inst = ex_mem.instruction;
            const instIdx = inst ? (inst.index ?? inst.line) : null;
            let memReadData = 0;
            const addr = ex_mem.aluResult;

            // Store Data Forwarding: check if MEM/WB writes the register being stored
            let storeVal = ex_mem.storeData;
            const storeReg = ex_mem.rs2 !== null && ex_mem.rs2 !== undefined ? ex_mem.rs2 : (inst ? inst.rs1 : null);
            if (this.forwardingEnabled && mem_wb && mem_wb.valid && !mem_wb.isBubble && mem_wb.regWrite && mem_wb.rd !== 0 && storeReg !== null && mem_wb.rd === storeReg) {
                storeVal = mem_wb.memToReg ? mem_wb.memData : mem_wb.aluResult;
                this.stats.forwardingEvents++;
                forwardDetails.fwdStore = 'MEM/WB';
            }

            // L1 Data Cache Access & Miss Detection
            if (this.l1dCache.enabled && (ex_mem.memRead || ex_mem.memWrite)) {
                if (this.l1dCache.stallRemaining > 0) {
                    this.l1dCache.stallRemaining--;
                    dCacheStall = true;
                } else {
                    const dRes = this.l1dCache.access(addr, ex_mem.memWrite, storeVal, this.cycle, this.memory);
                    if (!dRes.hit) {
                        if (dRes.stallCycles > 1) {
                            this.l1dCache.stallRemaining = dRes.stallCycles - 1;
                        }
                        dCacheStall = true;
                    } else {
                        if (ex_mem.memRead) memReadData = dRes.data;
                    }
                }
            }

            if (dCacheStall) {
                this.stats.stalls++;
                activeHazard = HazardType.RAW;
                hazardDetails = {
                    type: 'DCACHE_MISS',
                    reason: `L1-D Cache miss at word address 0x${addr.toString(16).toUpperCase()}`,
                    action: 'Stall pipeline waiting for memory line fill',
                };
                if (instIdx !== null && instIdx >= 0) {
                    this._recordGrid(instIdx, Stage.BUBBLE, this.cycle, { stalled: true, hazardType: 'DCACHE_MISS' });
                }
                next_mem_wb = createMEM_WB({ valid: false, isBubble: true });
            } else {
                if (ex_mem.memRead) {
                    activeSignals.memAddress = addr;
                    if (!this.l1dCache.enabled) {
                        if (addr >= 0 && addr < MEM_SIZE) {
                            memReadData = this.memory[addr];
                            activeSignals.memReadData = memReadData;
                        } else {
                            assertions.push({ pass: false, msg: `Out of bounds Memory Read at address ${addr}` });
                        }
                    } else {
                        activeSignals.memReadData = memReadData;
                    }
                } else if (ex_mem.memWrite) {
                    activeSignals.memAddress = addr;
                    activeSignals.memWriteData = storeVal;
                    if (!this.l1dCache.enabled) {
                        if (addr >= 0 && addr < MEM_SIZE) {
                            nextMemory[addr] = storeVal;
                        } else {
                            assertions.push({ pass: false, msg: `Out of bounds Memory Write at address ${addr}` });
                        }
                    }
                }

                // Propagate EX/MEM to MEM/WB
                next_mem_wb = createMEM_WB({
                    pc: ex_mem.pc,
                    instruction: ex_mem.instruction,
                    memData: memReadData,
                    aluResult: ex_mem.aluResult,
                    rd: ex_mem.rd,
                    rs2: ex_mem.rs2,
                    regWrite: ex_mem.regWrite,
                    memToReg: ex_mem.memToReg,
                    valid: true,
                    isBubble: false,
                    id: instIdx,
                });

                if (instIdx !== null && instIdx >= 0) {
                    this._recordGrid(instIdx, Stage.MEM, this.cycle);
                }
            }
        } else {
            next_mem_wb = createMEM_WB({ valid: false, isBubble: true });
        }

        // =====================================================================
        // STAGE 3: EXECUTE (EX)
        // =====================================================================
        const id_ex = this.id_ex;
        if (dCacheStall) {
            next_ex_mem = { ...this.ex_mem };
        } else if (id_ex && id_ex.valid && !id_ex.isBubble) {
            const inst = id_ex.instruction;
            const instIdx = inst ? (inst.index ?? inst.line) : null;

            // Compute Forwarding decisions (EX/MEM and MEM/WB bypass multiplexers)
            const fwd = ForwardingUnit.computeEXForwarding({
                id_ex,
                ex_mem,
                mem_wb,
                forwardingEnabled: this.forwardingEnabled,
            });

            fwdA = fwd.fwdA;
            fwdB = fwd.fwdB;
            forwardDetails = {
                fwdA: fwdA === ForwardSrc.EX_MEM ? 'EX/MEM' : fwdA === ForwardSrc.MEM_WB ? 'MEM/WB' : 'NONE',
                fwdB: fwdB === ForwardSrc.EX_MEM ? 'EX/MEM' : fwdB === ForwardSrc.MEM_WB ? 'MEM/WB' : 'NONE',
                reasonA: fwd.reasonA,
                reasonB: fwd.reasonB,
            };

            if (fwdA !== ForwardSrc.NONE || fwdB !== ForwardSrc.NONE) {
                this.stats.forwardingEvents++;
            }

            // ALU Operand selection
            const operandA = fwd.val1;
            // ALUSrc MUX: select between register rs2 (or forwarded value) and Immediate
            const operandB = id_ex.aluSrc ? id_ex.imm : fwd.val2;

            activeSignals.aluInputA = operandA;
            activeSignals.aluInputB = operandB;

            // ALU Arithmetic & Logic Operation
            let aluResult = 0;
            switch (id_ex.aluOp) {
                case Opcode.ADD:
                    aluResult = (operandA + operandB) | 0;
                    break;
                case Opcode.SUB:
                    aluResult = (operandA - operandB) | 0;
                    break;
                case Opcode.MUL:
                    aluResult = Math.imul(operandA, operandB);
                    break;
                case Opcode.DIV:
                    aluResult = operandB !== 0 ? Math.trunc(operandA / operandB) : 0;
                    break;
                case Opcode.AND:
                    aluResult = (operandA & operandB) | 0;
                    break;
                case Opcode.OR:
                    aluResult = (operandA | operandB) | 0;
                    break;
                case Opcode.XOR:
                    aluResult = (operandA ^ operandB) | 0;
                    break;
                case Opcode.SLT:
                    aluResult = operandA < operandB ? 1 : 0;
                    break;
                case Opcode.SLL:
                    aluResult = operandA << (operandB & 0x1F);
                    break;
                case Opcode.SRL:
                    aluResult = operandA >>> (operandB & 0x1F);
                    break;
                default:
                    aluResult = operandA;
                    break;
            }

            // JAL saves PC+4 in destination register
            if (id_ex.jump && id_ex.instruction?.opcode === Opcode.JAL) {
                aluResult = id_ex.pcPlus4;
            }

            activeSignals.aluResult = aluResult;

            // Propagate ID/EX to EX/MEM
            next_ex_mem = createEX_MEM({
                pc: id_ex.pc,
                instruction: id_ex.instruction,
                aluResult,
                storeData: fwd.storeData,
                rd: id_ex.rd,
                rs2: id_ex.rs2,
                regWrite: id_ex.regWrite,
                memRead: id_ex.memRead,
                memWrite: id_ex.memWrite,
                memToReg: id_ex.memToReg,
                valid: true,
                isBubble: false,
                id: instIdx,
            });

            const hasFwd = fwdA !== ForwardSrc.NONE || fwdB !== ForwardSrc.NONE;
            if (instIdx !== null && instIdx >= 0) {
                this._recordGrid(instIdx, Stage.EX, this.cycle, { isForwarding: hasFwd });
            }
        } else {
            next_ex_mem = createEX_MEM({ valid: false, isBubble: true });
        }

        // =====================================================================
        // STAGE 2: INSTRUCTION DECODE & REGISTER FETCH (ID)
        // =====================================================================
        const if_id = this.if_id;
        if (dCacheStall) {
            next_id_ex = { ...this.id_ex };
        } else if (if_id && if_id.valid && !if_id.isBubble) {
            const inst = if_id.instruction;
            const instIdx = inst ? (inst.index ?? inst.line) : null;
            const ctrl = ControlUnit.decode(inst);

            // Decode source and destination registers
            let rs1 = inst.rs1;
            let rs2 = inst.rs2;
            let rd = inst.rd;
            let imm = inst.imm ?? 0;

            // Handle instruction specific mappings
            if (inst.opcode === Opcode.ST) {
                // In ST [Rd], Rs1: inst.rd is the address base reg, inst.rs1 is the data reg
                rs1 = inst.rd;
                rs2 = inst.rs1;
                rd = null; // Store produces no register output
            } else if (inst.opcode === Opcode.LD) {
                rs1 = inst.rs1;
                rs2 = null;
                rd = inst.rd;
            } else if (inst.opcode === Opcode.ADDI || inst.opcode === Opcode.SLL || inst.opcode === Opcode.SRL) {
                rs1 = inst.rs1;
                rs2 = null;
                rd = inst.rd;
            }

            // Register Fetch (reads updated registers with WB-stage internal forwarding)
            const regVal1 = (rs1 !== null && rs1 !== undefined && rs1 >= 0 && rs1 < NUM_REGISTERS) ? nextRegisters[rs1] : 0;
            const regVal2 = (rs2 !== null && rs2 !== undefined && rs2 >= 0 && rs2 < NUM_REGISTERS) ? nextRegisters[rs2] : 0;

            // Hazard Detection Unit Evaluation (check for load-use or EX data dependencies)
            const hazardRes = HazardUnit.detect({
                if_id,
                id_ex,
                ex_mem,
                mem_wb,
                forwardingEnabled: this.forwardingEnabled,
                branchTaken: false,
                isJump: false,
            });

            stall = hazardRes.stall;
            activeHazard = hazardRes.hazard;
            hazardDetails = hazardRes.details;

            if (stall) {
                if (activeHazard === HazardType.LOAD_USE) this.stats.loadUseHazards++;
                if (activeHazard === HazardType.RAW) this.stats.rawHazards++;
                this.stats.stalls++;

                // Stall: Freeze IF/ID, don't advance to ID/EX (inject bubble into ID/EX)
                next_id_ex = createID_EX({ valid: false, isBubble: true });
                if (instIdx !== null && instIdx >= 0) {
                    this._recordGrid(instIdx, Stage.BUBBLE, this.cycle, { stalled: true, hazardType: activeHazard });
                }
            } else {
                // If not stalled, evaluate Branch or Jump
                if (ctrl.branch) {
                    this.stats.branchesTotal++;
                    // Forward latest register values into branch comparator if available
                    const bFwd = ForwardingUnit.computeBranchForwarding({
                        rs1: inst.rs1,
                        rs2: inst.rs2,
                        ex_mem,
                        mem_wb,
                        registers: nextRegisters,
                        forwardingEnabled: this.forwardingEnabled,
                    });

                    const cmp1 = bFwd.val1;
                    const cmp2 = bFwd.val2;

                    switch (ctrl.branchType) {
                        case 'BEQ': branchTaken = (cmp1 === cmp2); break;
                        case 'BNE': branchTaken = (cmp1 !== cmp2); break;
                        case 'BLT': branchTaken = (cmp1 < cmp2); break;
                        case 'BGE': branchTaken = (cmp1 >= cmp2); break;
                        default: branchTaken = false; break;
                    }

                    const targetLabel = inst.label;
                    if (typeof targetLabel === 'number') {
                        branchTarget = targetLabel * 4;
                    } else if (this.labels && this.labels[targetLabel] !== undefined) {
                        branchTarget = this.labels[targetLabel] * 4;
                    }

                    if (this.branchPredictor.enabled) {
                        const wasPredicted = if_id.predictedTaken || false;
                        const predictedTarget = if_id.predictedTarget !== undefined ? if_id.predictedTarget : (if_id.pc + 4);
                        this.branchPredictor.update(if_id.pc, branchTaken, branchTarget, wasPredicted);

                        if (branchTaken === wasPredicted && (!branchTaken || branchTarget === predictedTarget)) {
                            // Correct branch prediction: 0 flush penalty!
                            flush = false;
                            activeSignals.pcMux = branchTaken ? 'Predicted Target (Correct)' : 'PC+4 (Correct NT)';
                            if (branchTaken) {
                                this.stats.branchesTaken++;
                            } else {
                                this.stats.branchesNotTaken++;
                            }
                        } else {
                            // Misprediction!
                            flush = true;
                            this.stats.flushes++;
                            activeHazard = HazardType.CONTROL;
                            hazardDetails = {
                                type: HazardType.CONTROL,
                                reason: `Branch mispredicted (${wasPredicted ? 'Taken' : 'Not-Taken'} predicted, actual: ${branchTaken ? 'Taken' : 'Not-Taken'})`,
                                action: 'Flush fetched instruction and redirect PC',
                            };
                            if (branchTaken) {
                                this.stats.branchesTaken++;
                                nextPc = branchTarget;
                                activeSignals.pcMux = 'Branch Target (Mispredict Taken)';
                            } else {
                                this.stats.branchesNotTaken++;
                                nextPc = if_id.pc + 4;
                                activeSignals.pcMux = 'PC+4 (Mispredict Recovery)';
                            }
                        }
                    } else {
                        if (branchTaken) {
                            this.stats.branchesTaken++;
                            flush = true;
                            activeHazard = HazardType.CONTROL;
                            hazardDetails = {
                                type: HazardType.CONTROL,
                                reason: `Branch ${ctrl.branchType} condition taken`,
                                action: 'Flush fetched instruction in IF/ID',
                            };
                        } else {
                            this.stats.branchesNotTaken++;
                        }
                    }
                } else if (ctrl.jump) {
                    this.stats.jumps++;
                    isJump = true;
                    flush = true;
                    activeHazard = HazardType.CONTROL;
                    hazardDetails = {
                        type: HazardType.CONTROL,
                        reason: `Jump instruction ${inst.opcode}`,
                        action: 'Flush fetched instruction in IF/ID',
                    };
                    if (inst.opcode === Opcode.JR) {
                        const bFwdJR = ForwardingUnit.computeBranchForwarding({
                            rs1: inst.rs1,
                            rs2: null,
                            ex_mem,
                            mem_wb,
                            registers: nextRegisters,
                            forwardingEnabled: this.forwardingEnabled,
                        });
                        branchTarget = bFwdJR.val1;
                    } else {
                        const targetLabel = inst.label;
                        if (typeof targetLabel === 'number') {
                            branchTarget = targetLabel * 4;
                        } else if (this.labels && this.labels[targetLabel] !== undefined) {
                            branchTarget = this.labels[targetLabel] * 4;
                        }
                    }
                }

                if (flush) {
                    if (!this.branchPredictor.enabled || isJump) {
                        this.stats.flushes++;
                        // PC selection MUX redirects to branch/jump target
                        nextPc = branchTarget;
                        activeSignals.pcMux = 'Branch/Jump Target';
                    }
                }

                // Advance IF/ID to ID/EX
                next_id_ex = createID_EX({
                    pc: if_id.pc,
                    pcPlus4: if_id.pcPlus4,
                    instruction: inst,
                    val1: regVal1,
                    val2: regVal2,
                    imm,
                    rd,
                    rs1,
                    rs2,
                    regWrite: ctrl.regWrite,
                    memRead: ctrl.memRead,
                    memWrite: ctrl.memWrite,
                    memToReg: ctrl.memToReg,
                    aluSrc: ctrl.aluSrc,
                    aluOp: ctrl.aluOp,
                    branch: ctrl.branch,
                    jump: ctrl.jump,
                    branchType: ctrl.branchType,
                    valid: true,
                    isBubble: false,
                    id: instIdx,
                });

                if (instIdx !== null && instIdx >= 0) {
                    this._recordGrid(instIdx, Stage.ID, this.cycle);
                }
            }
        } else {
            next_id_ex = createID_EX({ valid: false, isBubble: true });
        }

        // =====================================================================
        // STAGE 1: INSTRUCTION FETCH (IF)
        // =====================================================================
        if (dCacheStall || stall) {
            // Pipeline Stall: Freeze PC and IF/ID latch
            next_if_id = { ...this.if_id };
            assertions.push({ pass: true, msg: 'Pipeline Stalled: PC and IF/ID frozen' });
        } else if (flush) {
            // Pipeline Flush: Kill fetched instruction, insert bubble into IF/ID
            const flushedInst = this.if_id?.instruction;
            const flushedIdx = flushedInst ? (flushedInst.index ?? flushedInst.line) : null;
            if (flushedIdx !== null && flushedIdx >= 0 && this.if_id.valid && !this.if_id.isBubble) {
                this._recordGrid(flushedIdx, Stage.FLUSHED, this.cycle, { flushed: true });
            }
            next_if_id = createIF_ID(this.pc, this.pc + 4, null, false);
            next_if_id.isFlushed = true;
            next_if_id.isBubble = true;
            assertions.push({ pass: true, msg: 'Pipeline Flushed: IF/ID flushed' });
        } else {
            // Check L1-I Cache
            let iCacheStall = false;
            if (this.l1iCache.enabled) {
                if (this.l1iCache.stallRemaining > 0) {
                    this.l1iCache.stallRemaining--;
                    iCacheStall = true;
                } else {
                    const iRes = this.l1iCache.access(this.pc >> 2, false, 0, this.cycle, null);
                    if (!iRes.hit) {
                        if (iRes.stallCycles > 1) {
                            this.l1iCache.stallRemaining = iRes.stallCycles - 1;
                        }
                        iCacheStall = true;
                    }
                }
            }

            if (iCacheStall) {
                next_if_id = createIF_ID(this.pc, this.pc + 4, null, false);
                next_if_id.isBubble = true;
                this.stats.stalls++;
                assertions.push({ pass: true, msg: 'L1-I Cache Miss: Fetch stalled' });
            } else {
                // Normal sequential fetch: instruction index is pc / 4
                const instIndex = this.pc >> 2;
                if (instIndex >= 0 && instIndex < this.instructions.length) {
                    const fetchedInst = this.instructions[instIndex];
                    const pcPlus4 = this.pc + 4;

                    next_if_id = createIF_ID(this.pc, pcPlus4, fetchedInst, true);
                    next_if_id.isBubble = false;
                    next_if_id.id = instIndex;

                    if (this.branchPredictor.enabled) {
                        const pred = this.branchPredictor.predict(this.pc);
                        if (pred.predictedTaken) {
                            next_if_id.predictedTaken = true;
                            next_if_id.predictedTarget = pred.targetPC;
                            nextPc = pred.targetPC;
                            activeSignals.pcMux = 'Branch Predictor Speculative Target';
                        } else {
                            next_if_id.predictedTaken = false;
                            next_if_id.predictedTarget = pcPlus4;
                            nextPc = pcPlus4;
                            activeSignals.pcMux = 'PC+4';
                        }
                    } else {
                        nextPc = pcPlus4;
                        activeSignals.pcMux = 'PC+4';
                    }

                    this._recordGrid(instIndex, Stage.IF, this.cycle);
                } else {
                    // Past program end: fetch bubble
                    next_if_id = createIF_ID(this.pc, this.pc + 4, null, false);
                    next_if_id.isBubble = true;
                }
            }
        }

        // Check Hardware Invariants & Assertions
        if (this.pc % 4 !== 0) {
            assertions.push({ pass: false, msg: `PC misaligned: 0x${this.pc.toString(16)} is not divisible by 4` });
        } else {
            assertions.push({ pass: true, msg: 'PC aligned to 4-byte boundary' });
        }

        if (nextRegisters[0] !== 0) {
            assertions.push({ pass: false, msg: 'CRITICAL: R0 has been modified from 0!' });
            nextRegisters[0] = 0; // Hardware clamp
        } else {
            assertions.push({ pass: true, msg: 'R0 remains strictly 0' });
        }

        // Determine instructions active in each of the 5 pipeline stages this cycle
        const currentStages = {
            IF: (!stall && !flush && (this.pc >> 2) >= 0 && (this.pc >> 2) < this.instructions.length)
                ? this.instructions[this.pc >> 2]
                : null,
            ID: (this.if_id && this.if_id.valid && !this.if_id.isBubble) ? this.if_id.instruction : null,
            EX: (this.id_ex && this.id_ex.valid && !this.id_ex.isBubble) ? this.id_ex.instruction : null,
            MEM: (this.ex_mem && this.ex_mem.valid && !this.ex_mem.isBubble) ? this.ex_mem.instruction : null,
            WB: (this.mem_wb && this.mem_wb.valid && !this.mem_wb.isBubble) ? this.mem_wb.instruction : null,
        };

        const stageStrings = {
            IF: currentStages.IF ? currentStages.IF.raw : (stall ? 'STALL' : (flush ? 'FLUSH' : 'NOP')),
            ID: currentStages.ID ? currentStages.ID.raw : 'NOP',
            EX: currentStages.EX ? currentStages.EX.raw : 'NOP',
            MEM: currentStages.MEM ? currentStages.MEM.raw : 'NOP',
            WB: currentStages.WB ? currentStages.WB.raw : 'NOP',
        };

        // Commit architectural and latch states
        this.registers = nextRegisters;
        this.memory = nextMemory;
        this.pc = nextPc;
        this.if_id = next_if_id;
        this.id_ex = next_id_ex;
        this.ex_mem = next_ex_mem;
        this.mem_wb = next_mem_wb;

        this.completedInstructions += completedInThisCycle;
        this.stats.completedInstructions = this.completedInstructions;

        // Check if CPU has completed execution
        const instIndex = this.pc >> 2;
        if (instIndex >= this.instructions.length &&
            (!this.if_id.valid || this.if_id.isBubble) &&
            (!this.id_ex.valid || this.id_ex.isBubble) &&
            (!this.ex_mem.valid || this.ex_mem.isBubble) &&
            (!this.mem_wb.valid || this.mem_wb.isBubble)) {
            this._isHalted = true;
        }

        // Save Cycle Snapshot
        this._saveSnapshot({
            stages: stageStrings,
            stageInstructions: currentStages,
            hazard: activeHazard,
            hazardDetails,
            stall,
            flush,
            forwardA: fwdA,
            forwardB: fwdB,
            forwardDetails,
            branchInfo: {
                branch: branchTaken || isJump,
                taken: branchTaken,
                target: branchTarget,
            },
            activeSignals,
            assertions,
        });

        return this.getCurrentSnapshot();
    }

    /**
     * Rewind pipeline state by 1 cycle using deterministic snapshot history.
     */
    stepBackward() {
        if (this.cycle > 0) {
            this.cycle--;
            const snap = this.history[this.cycle];
            if (snap) {
                this.registers = [...snap.registers];
                this.memory = [...snap.memory];
                this.pc = snap.pc;

                const latches = snap.latches || {
                    if_id: snap.IF_ID,
                    id_ex: snap.ID_EX,
                    ex_mem: snap.EX_MEM,
                    mem_wb: snap.MEM_WB,
                };

                this.if_id = { ...(latches.if_id || snap.IF_ID || {}) };
                this.id_ex = { ...(latches.id_ex || snap.ID_EX || {}) };
                this.ex_mem = { ...(latches.ex_mem || snap.EX_MEM || {}) };
                this.mem_wb = { ...(latches.mem_wb || snap.MEM_WB || {}) };
                this._isHalted = snap.halted;
                this.completedInstructions = snap.stats?.completedInstructions ?? 0;
            }
        }
        return this.getCurrentSnapshot();
    }

    // ─── Private Helpers ────────────────────────────────────────────────────────

    _recordGrid(instIdx, stage, cycle, flags = {}) {
        if (!this.gridHistory[instIdx]) {
            this.gridHistory[instIdx] = [];
        }
        this.gridHistory[instIdx][cycle] = createGridCell(stage, flags);
    }

    _saveSnapshot(extra = {}) {
        const gridData = [];
        for (let i = 0; i < this.instructions.length; i++) {
            const historyForInst = this.gridHistory[i] || [];
            gridData.push({
                id: i,
                pc: i * 4,
                text: this.instructions[i].raw || `Instr ${i}`,
                cells: [...historyForInst],
            });
        }

        // Build active instruction stages list for timeline
        const instructionStages = [];
        const stageList = [
            { stage: Stage.IF, inst: extra.stageInstructions ? extra.stageInstructions.IF : null },
            { stage: Stage.ID, inst: extra.stageInstructions ? extra.stageInstructions.ID : null },
            { stage: Stage.EX, inst: extra.stageInstructions ? extra.stageInstructions.EX : null },
            { stage: Stage.MEM, inst: extra.stageInstructions ? extra.stageInstructions.MEM : null },
            { stage: Stage.WB, inst: extra.stageInstructions ? extra.stageInstructions.WB : null },
        ];
        for (const sp of stageList) {
            if (sp.inst) {
                instructionStages.push({
                    instructionIndex: sp.inst.index ?? sp.inst.line,
                    instruction: sp.inst,
                    stage: sp.stage,
                    cycle: this.cycle,
                });
            }
        }

        const snapshot = createCPUSnapshot(this.cycle, {
            pc: this.pc,
            IF_ID: { ...this.if_id },
            ID_EX: { ...this.id_ex },
            EX_MEM: { ...this.ex_mem },
            MEM_WB: { ...this.mem_wb },
            stages: extra.stages ?? { IF: 'NOP', ID: 'NOP', EX: 'NOP', MEM: 'NOP', WB: 'NOP' },
            stageInstructions: extra.stageInstructions ?? { IF: null, ID: null, EX: null, MEM: null, WB: null },
            registers: [...this.registers],
            memory: [...this.memory],
            forwardA: extra.forwardA ?? ForwardSrc.NONE,
            forwardB: extra.forwardB ?? ForwardSrc.NONE,
            forwardDetails: extra.forwardDetails ?? { fwdA: 'NONE', fwdB: 'NONE', reasonA: '', reasonB: '' },
            hazard: extra.hazard ?? HazardType.NONE,
            hazardDetails: extra.hazardDetails ?? null,
            stall: extra.stall ?? false,
            flush: extra.flush ?? false,
            branchInfo: extra.branchInfo ?? { branch: false, taken: false, target: null },
            halted: this._isHalted,
            instructionStages,
            grid: gridData,
            stats: {
                cpi: this.cpi,
                ipc: this.ipc,
                completedInstructions: this.completedInstructions,
                totalCycles: this.cycle,
                stalls: this.stats.stalls,
                flushes: this.stats.flushes,
                forwardingEvents: this.stats.forwardingEvents,
                loadUseHazards: this.stats.loadUseHazards,
                branchesTotal: this.stats.branchesTotal,
                branchesTaken: this.stats.branchesTaken,
                branchesNotTaken: this.stats.branchesNotTaken,
                jumps: this.stats.jumps,
                idealCycles: this.completedInstructions > 0 ? this.completedInstructions + 4 : 0,
                pipelineUtilization: this.cycle > 0
                    ? ((this.completedInstructions * 5) / (this.cycle * 5) * 100).toFixed(1) + '%'
                    : '0%',
            },
            activeSignals: extra.activeSignals ?? {},
            assertions: extra.assertions ?? [],
            l1iCache: this.l1iCache ? this.l1iCache.getSnapshot() : null,
            l1dCache: this.l1dCache ? this.l1dCache.getSnapshot() : null,
            branchPredictor: this.branchPredictor ? this.branchPredictor.getSnapshot() : null,
        });

        // Slice history if stepped backward then forward
        if (this.history.length > this.cycle) {
            this.history = this.history.slice(0, this.cycle);
        }
        this.history.push(snapshot);
    }
}
