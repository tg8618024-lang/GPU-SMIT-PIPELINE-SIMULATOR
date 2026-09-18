// ──────────────────────────────────────────────────────────────────────────────
// SIMT-Flow: Core Types & Micro-ISA Definitions
// ──────────────────────────────────────────────────────────────────────────────
// This file defines every data structure used across the CPU pipeline engine,
// GPU warp engine, and the UI layer. All other modules import from here.
// ──────────────────────────────────────────────────────────────────────────────

// ─── Micro-ISA Opcode Enum ──────────────────────────────────────────────────
export const Opcode = Object.freeze({
    // Standard Arithmetic & Logical
    ADD:    'ADD',
    SUB:    'SUB',
    MUL:    'MUL',
    DIV:    'DIV',
    ADDI:   'ADDI',
    AND:    'AND',
    OR:     'OR',
    XOR:    'XOR',
    SLT:    'SLT',
    SLL:    'SLL',
    SRL:    'SRL',
    
    // Memory Access
    LD:     'LD',     // Load from memory: LD Rd, [Rs1] or LD Rd, imm(Rs1)
    ST:     'ST',     // Store to memory: ST [Rd], Rs1 or ST imm(Rd), Rs1

    // Control Flow
    BEQ:    'BEQ',    // Branch if equal
    BNE:    'BNE',    // Branch if not equal
    BLT:    'BLT',    // Branch if less than
    BGE:    'BGE',    // Branch if greater or equal
    J:      'J',      // Unconditional Jump
    JAL:    'JAL',    // Jump and Link
    JR:     'JR',     // Jump Register

    // SIMT & Execution Control
    DIV_IF: 'DIV_IF', // SIMT divergence: branches based on lane index parity
    NOP:    'NOP',
    HALT:   'HALT',
});

// ─── Instruction Latencies (in execute-stage cycles) ────────────────────────
export const LATENCY = Object.freeze({
    [Opcode.ADD]:    1,
    [Opcode.SUB]:    1,
    [Opcode.MUL]:    1,  // Pipelined single-cycle throughput
    [Opcode.DIV]:    1,
    [Opcode.ADDI]:   1,
    [Opcode.AND]:    1,
    [Opcode.OR]:     1,
    [Opcode.XOR]:    1,
    [Opcode.SLT]:    1,
    [Opcode.SLL]:    1,
    [Opcode.SRL]:    1,
    [Opcode.LD]:     1,  // EX latency; load memory access occurs in MEM stage
    [Opcode.ST]:     1,
    [Opcode.BEQ]:    1,
    [Opcode.BNE]:    1,
    [Opcode.BLT]:    1,
    [Opcode.BGE]:    1,
    [Opcode.J]:      1,
    [Opcode.JAL]:    1,
    [Opcode.JR]:     1,
    [Opcode.DIV_IF]: 1,
    [Opcode.NOP]:    1,
    [Opcode.HALT]:   1,
});

// GPU-specific latency for global memory loads (hides via warp scheduling)
export const GPU_MEM_LATENCY = 4;

// ─── Number of SIMT Lanes per Warp ──────────────────────────────────────────
export const SIMT_LANES = 8;

// ─── Number of Resident Warps in the SM ─────────────────────────────────────
export const NUM_WARPS = 4;

// ─── Register File Size ─────────────────────────────────────────────────────
export const NUM_REGISTERS = 8;   // R0..R7 (R0 is hardwired to 0)

// ─── Data Memory Size (word-addressable) ────────────────────────────────────
export const MEM_SIZE = 256;

// ─── Pipeline Stage Names ───────────────────────────────────────────────────
export const Stage = Object.freeze({
    IF:      'IF',
    ID:      'ID',
    EX:      'EX',
    MEM:     'MEM',
    WB:      'WB',
    BUBBLE:  'BUBBLE',
    FLUSHED: 'FLUSHED',
    DONE:    'DONE',
});

// ─── Forwarding Source ──────────────────────────────────────────────────────
export const ForwardSrc = Object.freeze({
    NONE:    0b00,   // Read from register file
    EX_MEM:  0b10,   // Bypass from EX/MEM pipeline register
    MEM_WB:  0b01,   // Bypass from MEM/WB pipeline register
});

// ─── Hazard Types ───────────────────────────────────────────────────────────
export const HazardType = Object.freeze({
    NONE:       'NONE',
    RAW:        'RAW',        // Read-After-Write data dependency
    LOAD_USE:   'LOAD_USE',   // Load-Use hazard (requires 1-cycle stall)
    CONTROL:    'CONTROL',    // Control hazard (Branch taken / Jump → pipeline flush)
    STRUCTURAL: 'STRUCTURAL', // Resource conflict
});

// ─── Warp State ─────────────────────────────────────────────────────────────
export const WarpState = Object.freeze({
    READY:    'READY',
    RUNNING:  'RUNNING',
    STALLED:  'STALLED',   // Waiting on scoreboard (register dependency / mem latency)
    DIVERGED: 'DIVERGED',  // Executing divergent path
    FINISHED: 'FINISHED',
});

// ──────────────────────────────────────────────────────────────────────────────
// Data Structure Factories
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Represents a single parsed instruction.
 */
export function createInstruction(opcode, rd = null, rs1 = null, rs2 = null, label = null, line = -1, raw = '', imm = null, machineCode = '0x00000000', index = null) {
    return Object.freeze({
        opcode,
        rd:    rd   ?? null,
        rs1:   rs1  ?? null,
        rs2:   rs2  ?? null,
        imm:   imm  ?? null,
        label: label ?? null,
        line,
        raw:   raw.trim(),
        machineCode: machineCode || '0x00000000',
        index: index !== null ? index : (line >= 0 ? line : 0),
    });
}

/** An empty NOP bubble instruction */
export function createBubble(text = '---bubble---') {
    return createInstruction(Opcode.NOP, null, null, null, null, -1, text, null, '0x00000000', -1);
}

// ─── CPU Pipeline Latch Registers ───────────────────────────────────────────

export function createIF_ID(pc = 0, pcPlus4 = 4, instruction = null, valid = false) {
    return {
        pc,
        pcPlus4,
        instruction,
        valid,
        isBubble: !valid,
        isFlushed: false,
        id: instruction ? (instruction.index ?? instruction.line) : null,
    };
}

export function createID_EX(params = {}) {
    const {
        pc = 0,
        pcPlus4 = 4,
        instruction = null,
        val1 = 0,
        val2 = 0,
        imm = 0,
        rd = null,
        rs1 = null,
        rs2 = null,
        regWrite = false,
        memRead = false,
        memWrite = false,
        memToReg = false,
        aluSrc = false,
        aluOp = Opcode.NOP,
        branch = false,
        jump = false,
        branchType = 'BEQ',
        valid = false,
        isBubble = !valid,
        isFlushed = false,
        id = null,
    } = params;

    return {
        pc,
        pcPlus4,
        instruction,
        val1,
        val2,
        imm,
        rd,
        rs1,
        rs2,
        rs1Idx: rs1,
        rs2Idx: rs2,
        rs1Val: val1,
        rs2Val: val2,
        regWrite,
        memRead,
        memWrite,
        memToReg,
        aluSrc,
        aluOp,
        branch,
        jump,
        branchType,
        valid,
        isBubble,
        isFlushed,
        id: id ?? (instruction ? (instruction.index ?? instruction.line) : null),
    };
}

export function createEX_MEM(params = {}) {
    const {
        pc = 0,
        instruction = null,
        aluResult = 0,
        storeData = 0,
        rd = null,
        rs2 = null,
        regWrite = false,
        memRead = false,
        memWrite = false,
        memToReg = false,
        branch = false,
        branchTaken = false,
        branchTarget = 0,
        jump = false,
        valid = false,
        isBubble = !valid,
        isFlushed = false,
        id = null,
    } = params;

    return {
        pc,
        instruction,
        aluResult,
        storeData,
        rs2Val: storeData,
        rd,
        rs2: rs2 !== null ? rs2 : (instruction ? instruction.rs2 : null),
        regWrite,
        memRead,
        memWrite,
        memToReg,
        branch,
        branchTaken,
        branchTarget,
        jump,
        valid,
        isBubble,
        isFlushed,
        id: id ?? (instruction ? (instruction.index ?? instruction.line) : null),
    };
}

export function createMEM_WB(params = {}) {
    const {
        pc = 0,
        instruction = null,
        memData = 0,
        aluResult = 0,
        rd = null,
        rs2 = null,
        regWrite = false,
        memToReg = false,
        valid = false,
        isBubble = !valid,
        isFlushed = false,
        id = null,
    } = params;

    return {
        pc,
        instruction,
        memData,
        aluResult,
        rd,
        rs2,
        regWrite,
        memToReg,
        memRead: memToReg,
        valid,
        isBubble,
        isFlushed,
        id: id ?? (instruction ? (instruction.index ?? instruction.line) : null),
    };
}

/**
 * Complete frozen state of the CPU pipeline at a given clock cycle.
 * The UI renders entirely from this snapshot.
 */
export function createCPUSnapshot(cycle, state) {
    const IF_ID = state.IF_ID ?? state.latches?.if_id ?? {};
    const ID_EX = state.ID_EX ?? state.latches?.id_ex ?? {};
    const EX_MEM = state.EX_MEM ?? state.latches?.ex_mem ?? {};
    const MEM_WB = state.MEM_WB ?? state.latches?.mem_wb ?? {};

    return Object.freeze({
        type: 'cpu',
        cycle,
        pc:             state.pc ?? 0,
        IF_ID,
        ID_EX,
        EX_MEM,
        MEM_WB,
        latches: {
            if_id: IF_ID,
            id_ex: ID_EX,
            ex_mem: EX_MEM,
            mem_wb: MEM_WB,
        },
        stages:         state.stages ?? {
            IF: 'NOP', ID: 'NOP', EX: 'NOP', MEM: 'NOP', WB: 'NOP'
        },
        stageInstructions: state.stageInstructions ?? {
            IF: null, ID: null, EX: null, MEM: null, WB: null
        },
        registers:      state.registers ? [...state.registers] : [],
        memory:         state.memory ? [...state.memory] : [],
        forwardA:       state.forwardA ?? ForwardSrc.NONE,
        forwardB:       state.forwardB ?? ForwardSrc.NONE,
        forwardDetails: state.forwardDetails ?? { fwdA: 'NONE', fwdB: 'NONE', reasonA: '', reasonB: '' },
        hazard:         state.hazard ?? HazardType.NONE,
        hazardDetails:  state.hazardDetails ?? null,
        stall:          state.stall ?? false,
        flush:          state.flush ?? false,
        branchInfo:     state.branchInfo ?? { branch: false, taken: false, target: null },
        halted:         state.halted ?? false,
        instructionStages: state.instructionStages ?? [],
        grid:           state.grid ?? [],
        stats:          state.stats ?? {},
        activeSignals:  state.activeSignals ?? {},
        assertions:     state.assertions ?? [],
        l1iCache:       state.l1iCache ?? null,
        l1dCache:       state.l1dCache ?? null,
        branchPredictor: state.branchPredictor ?? null,
    });
}

// ─── GPU / Warp Structures ──────────────────────────────────────────────────

export function createWarp(id) {
    return {
        id,
        pc: 0,
        state: WarpState.READY,
        activeMask: (1 << SIMT_LANES) - 1,   // 0xFF = all 8 lanes active
        registers: Array.from({ length: SIMT_LANES }, () =>
            new Array(NUM_REGISTERS).fill(0)
        ),
        stallCyclesRemaining: 0,
        stallReason: '',
        divergenceStack: [],
        finished: false,
    };
}

export function createScoreboard() {
    const board = {};
    for (let i = 0; i < NUM_WARPS; i++) {
        board[i] = new Set();
    }
    return board;
}

export function createGPUSnapshot(cycle, {
    warps,
    scoreboard,
    memory,
    schedulerChoice = null,
    schedulerType = WarpSchedulerType.ROUND_ROBIN,
    issuedInstruction = null,
    coalescingResult = null,
    bankConflictResult = null,
    halted = false,
    warpInstructionStages = [],
}) {
    return Object.freeze({
        type: 'gpu',
        cycle,
        warps: warps.map(w => ({
            ...w,
            registers: w.registers.map(lane => [...lane]),
            divergenceStack: w.divergenceStack.map(e => ({ ...e })),
        })),
        scoreboard: Object.fromEntries(
            Object.entries(scoreboard).map(([k, v]) => [k, new Set(v)])
        ),
        memory: [...memory],
        schedulerChoice,
        schedulerType,
        issuedInstruction,
        coalescingResult,
        bankConflictResult,
        halted,
        warpInstructionStages: warpInstructionStages.map(wis => ({
            ...wis,
            stages: wis.stages.map(s => ({ ...s })),
        })),
    });
}

// ─── Coalescing Result ──────────────────────────────────────────────────────

export function createCoalescingResult(addresses, coalesced, transactions) {
    return Object.freeze({ addresses: [...addresses], coalesced, transactions });
}

// ─── Pipeline Grid Cell (for the reservation table) ─────────────────────────

export function createGridCell(stage, isForwarding = false, forwardTarget = '', hazardType = HazardType.NONE) {
    if (typeof isForwarding === 'object' && isForwarding !== null) {
        const opts = isForwarding;
        return Object.freeze({
            stage,
            isForwarding: Boolean(opts.isForwarding),
            forwardTarget: opts.forwardTarget || '',
            hazardType: opts.hazardType || HazardType.NONE,
            stalled: Boolean(opts.stalled),
            flushed: Boolean(opts.flushed),
        });
    }
    return Object.freeze({ stage, isForwarding: Boolean(isForwarding), forwardTarget, hazardType });
}

// ─── Cache Types & Enums ───────────────────────────────────────────────────

export const CacheType = Object.freeze({
    DIRECT_MAPPED:   'DIRECT_MAPPED',
    TWO_WAY_SET:     'TWO_WAY_SET',
});

export const WritePolicy = Object.freeze({
    WRITE_THROUGH:   'WRITE_THROUGH',
    WRITE_BACK:      'WRITE_BACK',
});

export const MissType = Object.freeze({
    NONE:     'NONE',
    COLD:     'COLD',      // Compulsory miss
    CAPACITY: 'CAPACITY',  // Cache is too small
    CONFLICT: 'CONFLICT',  // Multiple addresses map to the same set
});

export function createCacheBlock(tag = null, data = [0, 0, 0, 0], valid = false, dirty = false) {
    return {
        tag,
        data: [...data],
        valid,
        dirty,
        lastAccessedCycle: 0,
    };
}

// ─── Dynamic Branch Predictor Types ────────────────────────────────────────

export const BranchPredictorType = Object.freeze({
    STATIC:        'STATIC',         // Always predict not-taken (or backward-taken)
    DYNAMIC_2BIT:  'DYNAMIC_2BIT',   // 2-bit saturating counter FSM
});

export const PredictorState = Object.freeze({
    STRONGLY_NOT_TAKEN: 0, // 0b00
    WEAKLY_NOT_TAKEN:   1, // 0b01
    WEAKLY_TAKEN:       2, // 0b10
    STRONGLY_TAKEN:     3, // 0b11
});

export function createBTBEntry(tag = 0, targetPC = 0, valid = false) {
    return {
        tag,
        targetPC,
        valid,
        state: PredictorState.WEAKLY_TAKEN,
        history: [],
    };
}

// ─── Advanced GPU Types: Scheduler & Shared Memory Bank Conflicts ──────────

export const WarpSchedulerType = Object.freeze({
    ROUND_ROBIN: 'ROUND_ROBIN',
    GTO:         'GTO', // Greedy-Then-Oldest (NVIDIA default since Fermi/Kepler)
});

export const NUM_SHARED_BANKS = 8;

export function createBankConflictResult(addresses = [], conflicts = 0, serializedCycles = 1, bankMapping = {}) {
    return Object.freeze({
        addresses: [...addresses],
        conflicts,
        serializedCycles,
        bankMapping: { ...bankMapping },
        hasConflict: conflicts > 0,
    });
}

// ─── Systolic Array / Tensor Core Definitions ──────────────────────────────

export function createSystolicState(cycle = 0, aInputs = [0,0,0,0], bInputs = [0,0,0,0], peGrid = null) {
    return {
        cycle,
        aInputs: [...aInputs],
        bInputs: [...bInputs],
        peGrid: peGrid || Array.from({ length: 4 }, () =>
            Array.from({ length: 4 }, () => ({ a: 0, b: 0, c: 0, active: false }))
        ),
    };
}

