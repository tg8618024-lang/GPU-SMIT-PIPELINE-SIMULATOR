// ──────────────────────────────────────────────────────────────────────────────
// SIMT-Flow: Pre-loaded Benchmark Programs & Micro-Architectural Presets
// ──────────────────────────────────────────────────────────────────────────────
// Golden test cases demonstrating every critical pipeline hazard, forwarding
// bypass, stall, flush, and GPU warp execution concept.
// Includes all 8 Phase 29 CPU presets and 2 GPU architectural benchmarks.
// ──────────────────────────────────────────────────────────────────────────────

export const BENCHMARKS = [
    // ─────────────────────────────────────────────────────────────────────────
    // CPU Preset 1: Basic Arithmetic (Ideal Pipeline Flow)
    // ─────────────────────────────────────────────────────────────────────────
    {
        id: 'basic-arith',
        name: '1. Basic Arithmetic (Ideal Pipeline)',
        description:
            'A sequence of completely independent arithmetic instructions. ' +
            'Demonstrates peak throughput with no hazards, no stalls, and no bubbles. ' +
            'Achieves near-ideal CPI ~ 1.0.',
        mode: 'cpu',
        forwardingEnabled: true,
        assembly: `
; ──────────────────────────────────────────
; Program 1: Basic Arithmetic (Independent)
; Expected: 0 stalls, 0 flushes, smooth flow
; ──────────────────────────────────────────
ADDI R1, R0, 10    ; R1 = 10
ADDI R2, R0, 20    ; R2 = 20
ADD  R3, R0, R0    ; R3 = 0 (independent)
ADDI R4, R0, 5     ; R4 = 5 (independent)
SUB  R5, R4, R0    ; R5 = 5 (independent)
HALT
`.trim(),
        expected: {
            totalBubbles: 0,
            description: 'Independent instructions flow through all 5 stages without any bubbles.',
        },
    },

    // ─────────────────────────────────────────────────────────────────────────
    // CPU Preset 2: RAW Hazard WITHOUT Forwarding
    // ─────────────────────────────────────────────────────────────────────────
    {
        id: 'raw-no-fwd',
        name: '2. RAW Hazard (No Forwarding)',
        description:
            'ADD writes R1, then SUB reads R1 immediately. Without forwarding, ' +
            'the pipeline must stall for 2 cycles (insert 2 bubbles) until the ' +
            'ADD result is written back to the register file.',
        mode: 'cpu',
        forwardingEnabled: false,
        assembly: `
; ──────────────────────────────────────────
; RAW Data Hazard — Forwarding DISABLED
; Expected: 2 bubble cycles between ADD & SUB
; ──────────────────────────────────────────
ADD R1, R2, R3   ; R1 = R2 + R3 (produces R1)
SUB R4, R1, R5   ; R4 = R1 - R5 (consumes R1 → RAW hazard!)
ADD R6, R7, R2   ; Independent instruction
HALT
`.trim(),
        expected: {
            totalBubbles: 2,
            description: 'SUB stalls for exactly 2 cycles waiting for ADD to write R1 back.',
        },
    },

    // ─────────────────────────────────────────────────────────────────────────
    // CPU Preset 3: EX/MEM Forwarding (RAW Resolved with Bypass)
    // ─────────────────────────────────────────────────────────────────────────
    {
        id: 'raw-with-fwd',
        name: '3. EX/MEM Forwarding Bypass',
        description:
            'Back-to-back dependency: ADD writes R1, SUB immediately reads R1. ' +
            'With forwarding ENABLED, the EX/MEM bypass delivers the ALU result ' +
            'directly into the ALU input for SUB — zero bubbles needed.',
        mode: 'cpu',
        forwardingEnabled: true,
        assembly: `
; ──────────────────────────────────────────
; RAW Data Hazard — Forwarding ENABLED
; Expected: 0 bubbles. EX/MEM bypass active.
; ──────────────────────────────────────────
ADD R1, R2, R3   ; Produces R1 in EX stage
SUB R4, R1, R5   ; Consumes R1 → Forwarded from EX/MEM
ADD R6, R7, R2   ; Independent
HALT
`.trim(),
        expected: {
            totalBubbles: 0,
            forwardingUsed: true,
            forwardSource: 'EX_MEM',
            description: 'Zero stalls. Bypass from EX/MEM delivers R1 to SUB in time.',
        },
    },

    // ─────────────────────────────────────────────────────────────────────────
    // CPU Preset 4: MEM/WB Forwarding
    // ─────────────────────────────────────────────────────────────────────────
    {
        id: 'raw-memwb',
        name: '4. MEM/WB Forwarding Bypass',
        description:
            'ADD produces R1, followed by an independent instruction, then SUB ' +
            'reads R1. The producer has moved to WB stage when SUB enters EX. ' +
            'The MEM/WB bypass provides R1 with 0 stalls.',
        mode: 'cpu',
        forwardingEnabled: true,
        assembly: `
; ──────────────────────────────────────────
; MEM/WB Forwarding Bypass
; Expected: 0 stalls. MEM/WB bypass active.
; ──────────────────────────────────────────
ADD R1, R2, R3   ; Produces R1
ADD R6, R7, R2   ; Independent instruction in between
SUB R4, R1, R5   ; Consumes R1 → Forwarded from MEM/WB
HALT
`.trim(),
        expected: {
            totalBubbles: 0,
            forwardingUsed: true,
            forwardSource: 'MEM_WB',
            description: 'MEM/WB forwarding delivers result to ALU operand with 0 bubbles.',
        },
    },

    // ─────────────────────────────────────────────────────────────────────────
    // CPU Preset 5: Load-Use Hazard (1 Mandatory Stall)
    // ─────────────────────────────────────────────────────────────────────────
    {
        id: 'load-use',
        name: '5. Load-Use Data Hazard',
        description:
            'LD loads R1 from memory, then ADD needs R1 immediately. Even with ' +
            'forwarding, the load result is only available at the end of the MEM stage. ' +
            'The pipeline MUST stall for exactly 1 cycle. The MEM/WB bypass ' +
            'then delivers the loaded value to EX.',
        mode: 'cpu',
        forwardingEnabled: true,
        assembly: `
; ──────────────────────────────────────────
; Load-Use Hazard — Forwarding ENABLED
; Expected: Exactly 1 bubble (mandatory stall)
; ──────────────────────────────────────────
ADD R2, R0, R3   ; Setup address in R2
LD  R1, [R2]     ; Load Memory[R2] into R1
ADD R4, R1, R5   ; Consumes R1 → Load-Use hazard! (1 stall)
SUB R6, R7, R3   ; Independent
HALT
`.trim(),
        expected: {
            totalBubbles: 1,
            hazardType: 'LOAD_USE',
            description: 'Exactly 1 bubble inserted. MEM/WB forwarding delivers load result.',
        },
    },

    // ─────────────────────────────────────────────────────────────────────────
    // CPU Preset 6: Control Hazard — Branch Taken + Pipeline Flush
    // ─────────────────────────────────────────────────────────────────────────
    {
        id: 'branch-flush',
        name: '6. Branch Taken & Pipeline Flush',
        description:
            'BEQ tests equal registers (R0 == R0). When the branch is taken in ID, ' +
            'the instruction already fetched in IF/ID is killed (flushed) with a 1-cycle ' +
            'penalty. The PC redirects to the target label.',
        mode: 'cpu',
        forwardingEnabled: true,
        assembly: `
; ──────────────────────────────────────────
; Control Hazard — Branch Taken
; Expected: ADD after BEQ is flushed (1 bubble)
; ──────────────────────────────────────────
BEQ R0, R0, target  ; Always taken (R0 == R0)
ADD R1, R2, R3      ; ← This gets FLUSHED (1-cycle penalty)
target:
SUB R4, R5, R6      ; Execution resumes here
HALT
`.trim(),
        expected: {
            totalBubbles: 1,
            flushOccurred: true,
            description: 'ADD instruction fetched after BEQ is flushed. SUB executes at target.',
        },
    },

    // ─────────────────────────────────────────────────────────────────────────
    // CPU Preset 7: Multiple Back-to-Back Hazards
    // ─────────────────────────────────────────────────────────────────────────
    {
        id: 'multi-hazard',
        name: '7. Complex Multiple Hazards',
        description:
            'Combines back-to-back RAW dependencies, Load-Use stalls, and ' +
            'store data forwarding in rapid succession. Tests forwarding priority ' +
            'and interlock coordination.',
        mode: 'cpu',
        forwardingEnabled: true,
        assembly: `
; ──────────────────────────────────────────
; Multiple Cascading Hazards
; Tests: Load-Use stall + EX/MEM + MEM/WB bypass
; ──────────────────────────────────────────
ADDI R2, R0, 4      ; R2 = 4 (address)
LD   R1, [R2]       ; R1 = Memory[4]
ADD  R3, R1, R2     ; Load-Use stall on R1!
SUB  R4, R3, R1     ; EX/MEM fwd (R3) + MEM/WB fwd (R1)
ST   [R2], R4       ; Store R4 into Memory[R2] (fwd to store)
HALT
`.trim(),
        expected: {
            totalBubbles: 1,
            description: 'Demonstrates smooth coordination of stalls and dual-source forwarding.',
        },
    },

    // ─────────────────────────────────────────────────────────────────────────
    // CPU Preset 8: Realistic Workload (Loop Accumulation)
    // ─────────────────────────────────────────────────────────────────────────
    {
        id: 'realistic-loop',
        name: '8. Loop Workload (Array Accumulator)',
        description:
            'A realistic loop that computes the sum of integers from 5 down to 1. ' +
            'Demonstrates loop branching, register decrement, accumulator updates, ' +
            'and final termination when R2 reaches 0.',
        mode: 'cpu',
        forwardingEnabled: true,
        assembly: `
; ──────────────────────────────────────────
; Realistic Workload: Countdown Sum Loop
; Computes 5 + 4 + 3 + 2 + 1 = 15 into R1
; ──────────────────────────────────────────
ADDI R1, R0, 0      ; R1 = sum = 0
ADDI R2, R0, 5      ; R2 = count = 5
loop:
ADD  R1, R1, R2     ; sum += count (forwarded)
SUB  R2, R2, 1      ; count--
BNE  R2, R0, loop   ; loop if count != 0
HALT                ; Result: R1 = 15
`.trim(),
        expected: {
            description: 'Computes sum of 1..5 = 15 in R1 using 5 loop iterations.',
        },
    },

    // ─────────────────────────────────────────────────────────────────────────
    // GPU Preset 1: Scoreboard Latency Hiding
    // ─────────────────────────────────────────────────────────────────────────
    {
        id: 'gpu-scoreboard',
        name: 'GPU Scoreboard Latency Hiding',
        description:
            'Warp 0 issues a 4-cycle LD (global memory load). Its destination ' +
            'register R1 is marked busy in the scoreboard. Instead of stalling ' +
            'the execution units, the warp scheduler immediately switches to ' +
            'Warp 1, Warp 2, Warp 3 — keeping the ALU pipeline 100% utilized ' +
            'with zero idle cycles.',
        mode: 'gpu',
        assembly: `
; ──────────────────────────────────────────
; GPU Warp Latency Hiding via Scoreboard
; All 4 warps run this same program.
; Warp 0 stalls on LD; Warps 1-3 fill the gap.
; ──────────────────────────────────────────
ADD R2, R0, R3   ; Compute address
LD  R1, [R2]     ; 4-cycle global memory load → Scoreboard marks R1 busy
ADD R4, R1, R5   ; Depends on R1 → Must wait for scoreboard clear
SUB R6, R7, R3   ; Independent
HALT
`.trim(),
        expected: {
            noIdleCycles: true,
            scoreboardTriggered: true,
            description: 'Warp 0 LD stalls on scoreboard. Warps 1-3 execute, hiding latency.',
        },
    },

    // ─────────────────────────────────────────────────────────────────────────
    // GPU Preset 2: SIMT Warp Divergence & Reconvergence
    // ─────────────────────────────────────────────────────────────────────────
    {
        id: 'simt-divergence',
        name: 'SIMT Warp Divergence',
        description:
            'DIV_IF causes the 8 SIMT lanes to diverge based on thread index ' +
            'parity. Even lanes (0,2,4,6) execute ADD R1,R1,10. Odd lanes ' +
            '(1,3,5,7) execute ADD R1,R1,20. The hardware serializes both paths ' +
            'using an Active Mask, then reconverges all 8 lanes.',
        mode: 'gpu',
        assembly: `
; ──────────────────────────────────────────
; SIMT Warp Divergence & Reconvergence
; Even threads: R1 += 10
; Odd threads:  R1 += 20
; Then all threads reconverge.
; ──────────────────────────────────────────
ADD  R1, R0, R3     ; Initialize R1
DIV_IF R1           ; Diverge based on lane parity
ADD  R1, R1, R2     ; THEN path (even lanes) — R2 holds 10
ADD  R1, R1, R3     ; ELSE path (odd lanes)  — R3 holds 20
SUB  R4, R1, R5     ; Reconverged: all 8 lanes active
HALT
`.trim(),
        expected: {
            divergenceOccurred: true,
            masks: ['0xAA', '0x55', '0xFF'],
            description: 'Mask splits to 0xAA (even), then 0x55 (odd), then reconverges to 0xFF.',
        },
    },

    // ─────────────────────────────────────────────────────────────────────────
    // CPU Preset 9: L1 Cache Spatial Locality & Stride Hits
    // ─────────────────────────────────────────────────────────────────────────
    {
        id: 'cpu-cache-locality',
        name: '9. L1 Cache Locality & Block Hits',
        description:
            'Demonstrates spatial locality in a 4-word cache line. The first access to address 0 ' +
            'triggers a cold cache miss (+4 cycle fill stall), fetching words 0..3. The next 3 accesses ' +
            'to addresses 1, 2, and 3 are 100% 1-cycle cache hits with zero stalls.',
        mode: 'cpu',
        forwardingEnabled: true,
        l1dEnabled: true,
        assembly: `
; ──────────────────────────────────────────
; Program 9: L1-D Cache Spatial Locality
; Block size = 4 words. Addresses 0..3 map
; to the exact same cache line!
; ──────────────────────────────────────────
ADDI R1, R0, 0     ; Base address = 0
LD   R2, [R1]      ; Miss! Cold compulsory miss (+fill latency)
ADDI R1, R0, 1     ; Address 1
LD   R3, [R1]      ; HIT! (Same cache line loaded by first LD)
ADDI R1, R0, 2     ; Address 2
LD   R4, [R1]      ; HIT!
ADDI R1, R0, 3     ; Address 3
LD   R5, [R1]      ; HIT!
HALT
`.trim(),
        expected: {
            description: '1 Cold Miss followed by 3 consecutive Cache Hits.',
        },
    },

    // ─────────────────────────────────────────────────────────────────────────
    // CPU Preset 10: Dynamic 2-Bit Branch Predictor Training
    // ─────────────────────────────────────────────────────────────────────────
    {
        id: 'cpu-branch-prediction',
        name: '10. Dynamic 2-Bit Branch Training',
        description:
            'Demonstrates 2-bit saturating counter learning in a countdown loop. ' +
            'Iteration 1 mispredicts (weakly NT -> resolves Taken). Iteration 2 transitions ' +
            'to Strongly Taken, eliminating pipeline flush bubbles for subsequent iterations!',
        mode: 'cpu',
        forwardingEnabled: true,
        branchPredictorEnabled: true,
        assembly: `
; ──────────────────────────────────────────
; Program 10: 2-Bit Branch Predictor Training
; Loop decrements R1 from 4 down to 0.
; Counter saturates at 11 (Strongly Taken).
; ──────────────────────────────────────────
ADDI R1, R0, 4     ; Loop counter R1 = 4
ADDI R2, R0, 1     ; Step = 1
loop:
SUB  R1, R1, R2    ; R1 = R1 - 1
BNE  R1, R0, loop  ; Branch taken until R1 == 0
HALT
`.trim(),
        expected: {
            description: 'Branch predictor learns loop behavior and eliminates flushes.',
        },
    },

    // ─────────────────────────────────────────────────────────────────────────
    // GPU Preset 3: Shared Memory Bank Conflicts (Stride 8)
    // ─────────────────────────────────────────────────────────────────────────
    {
        id: 'gpu-bank-conflicts',
        name: 'GPU Shared Memory Bank Conflicts',
        description:
            'Demonstrates hardware serialization when multiple SIMT threads in a warp ' +
            'target the same memory bank with different word addresses. ' +
            'Lane 0 accesses Bank 0 (Word 0), and Lane 4 accesses Bank 0 (Word 8) -> 2-way bank conflict!',
        mode: 'gpu',
        assembly: `
; ──────────────────────────────────────────
; GPU Shared Memory Bank Conflict Demonstration
; Bank ID = Address % 8.
; R1 contains strided addresses causing conflicts.
; ──────────────────────────────────────────
ADDI R1, R0, 8     ; Address stride
ST   [R1], R2      ; Store creates bank mapping
LD   R3, [R1]      ; Load triggers bank conflict detection
HALT
`.trim(),
        expected: {
            description: 'Detects multi-way bank conflicts across 8 shared memory banks.',
        },
    },

    // ─────────────────────────────────────────────────────────────────────────
    // GPU Preset 4: Greedy-Then-Oldest (GTO) Warp Scheduling
    // ─────────────────────────────────────────────────────────────────────────
    {
        id: 'gpu-gto-scheduling',
        name: 'GPU Greedy-Then-Oldest (GTO)',
        description:
            'Demonstrates NVIDIA standard GTO warp scheduling: the active warp continues ' +
            'executing greedily until it hits a long-latency memory stall (LD), at which point ' +
            'the scheduler switches to the oldest ready warp to maximize latency hiding.',
        mode: 'gpu',
        schedulerType: 'GTO',
        assembly: `
; ──────────────────────────────────────────
; GPU GTO Warp Scheduling Demonstration
; W0 executes greedily until LD memory stall.
; ──────────────────────────────────────────
ADDI R1, R0, 10
ADD  R2, R1, R1
LD   R3, [R0]      ; Long-latency load causes W0 to stall
ADD  R4, R2, R1    ; Depends on W0 readying up
HALT
`.trim(),
        expected: {
            description: 'Greedy execution switches only when stalled.',
        },
    },
];

/**
 * Get a benchmark by its ID.
 * @param {string} id
 * @returns {object|undefined}
 */
export function getBenchmarkById(id) {
    return BENCHMARKS.find(b => b.id === id);
}

/**
 * Get all benchmarks for a given mode.
 * @param {'cpu'|'gpu'} mode
 * @returns {object[]}
 */
export function getBenchmarksByMode(mode) {
    return BENCHMARKS.filter(b => b.mode === mode);
}
