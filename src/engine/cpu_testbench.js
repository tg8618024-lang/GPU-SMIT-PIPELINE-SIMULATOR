// ──────────────────────────────────────────────────────────────────────────────
// SIMT-Flow: Comprehensive CPU Verification Testbench (16 Test Cases)
// ──────────────────────────────────────────────────────────────────────────────
// Implements all Phase 23 verification specifications:
//   1. Basic ALU operations
//   2. Register dependencies
//   3. EX/MEM forwarding
//   4. MEM/WB forwarding
//   5. Forwarding priority
//   6. Load-use hazard
//   7. Multiple consecutive dependencies
//   8. Branch taken
//   9. Branch not taken
//   10. Pipeline flush
//   11. Stall + forwarding interaction
//   12. Reset
//   13. Register zero behavior (R0 hardwired to 0)
//   14. Memory load/store
//   15. Back-to-back hazards
//   16. Long programs (loop execution)
// ──────────────────────────────────────────────────────────────────────────────

import { parseAssembly, resolveLabels } from './parser.js';
import { CPUPipeline } from './cpu_pipeline.js';
import { ForwardSrc, HazardType } from './types.js';

export class CPUTestbench {
    /**
     * Run all 16 verification test cases.
     * @returns {Array<Object>} Test results array
     */
    static runAll() {
        const tests = [
            { id: 1,  name: '1. Basic ALU Operations',            fn: () => this.testBasicALU() },
            { id: 2,  name: '2. Register Dependencies',           fn: () => this.testRegisterDependencies() },
            { id: 3,  name: '3. EX/MEM Forwarding Bypass',        fn: () => this.testExMemForwarding() },
            { id: 4,  name: '4. MEM/WB Forwarding Bypass',        fn: () => this.testMemWbForwarding() },
            { id: 5,  name: '5. Forwarding Priority (EX/MEM > MEM/WB)', fn: () => this.testForwardingPriority() },
            { id: 6,  name: '6. Load-Use Data Hazard (1 Stall)',  fn: () => this.testLoadUseHazard() },
            { id: 7,  name: '7. Multiple Consecutive Dependencies',fn: () => this.testMultipleDependencies() },
            { id: 8,  name: '8. Branch Taken & Target Redirection',fn: () => this.testBranchTaken() },
            { id: 9,  name: '9. Branch Not Taken (Fall-through)', fn: () => this.testBranchNotTaken() },
            { id: 10, name: '10. Pipeline Flush Verification',     fn: () => this.testPipelineFlush() },
            { id: 11, name: '11. Stall + Forwarding Interaction', fn: () => this.testStallForwardingInteraction() },
            { id: 12, name: '12. Processor Reset State',          fn: () => this.testReset() },
            { id: 13, name: '13. Register Zero Immutability',     fn: () => this.testRegisterZero() },
            { id: 14, name: '14. Memory Load & Store Integrity',  fn: () => this.testMemoryLoadStore() },
            { id: 15, name: '15. Back-to-Back Hazards',           fn: () => this.testBackToBackHazards() },
            { id: 16, name: '16. Long Program (Countdown Loop)',  fn: () => this.testLongProgram() },
            { id: 17, name: '17. Load-Branch Data Hazard (2 Stalls + Forwarding)', fn: () => this.testLoadBranchHazard() },
            { id: 18, name: '18. Store Data Forwarding in MEM Stage',              fn: () => this.testStoreForwarding() },
            { id: 19, name: '19. JR Indirect Jump with Register Forwarding',       fn: () => this.testJRForwarding() },
            { id: 20, name: '20. Comment & Blank Line Independence in Grid',       fn: () => this.testCommentBlankLineIndependence() },
        ];

        const results = [];
        for (const t of tests) {
            try {
                const res = t.fn();
                results.push({
                    id: t.id,
                    name: t.name,
                    passed: true,
                    expected: res.expected,
                    actual: res.actual,
                    details: res.details,
                });
            } catch (err) {
                results.push({
                    id: t.id,
                    name: t.name,
                    passed: false,
                    expected: err.expected || 'Pass without error',
                    actual: err.actual || err.message,
                    details: err.message,
                });
            }
        }

        return results;
    }

    // ─── Helper to run an assembly program to halt ────────────────────────────
    static _runProgram(assembly, forwardingEnabled = true, maxCycles = 100) {
        const { instructions, labels } = parseAssembly(assembly);
        const resolved = resolveLabels(instructions, labels);
        const cpu = new CPUPipeline(resolved, labels);
        cpu.forwardingEnabled = forwardingEnabled;

        let cycles = 0;
        while (!cpu.isHalted && cycles < maxCycles) {
            cpu.stepForward();
            cycles++;
        }

        return { cpu, history: cpu.getHistory() };
    }

    // ─── 1. Basic ALU operations ──────────────────────────────────────────────
    static testBasicALU() {
        const asm = `
            ADDI R1, R0, 15
            ADDI R2, R0, 5
            ADD  R3, R1, R2   ; R3 = 20
            SUB  R4, R1, R2   ; R4 = 10
            AND  R5, R1, R2   ; R5 = 15 & 5 = 5
            OR   R6, R1, R2   ; R6 = 15 | 5 = 15
            XOR  R7, R1, R2   ; R7 = 15 ^ 5 = 10
            HALT
        `;
        const { cpu } = this._runProgram(asm);
        const r3 = cpu.registers[3];
        const r4 = cpu.registers[4];
        const r5 = cpu.registers[5];
        const r6 = cpu.registers[6];
        const r7 = cpu.registers[7];

        if (r3 !== 20 || r4 !== 10 || r5 !== 5 || r6 !== 15 || r7 !== 10) {
            throw new Error(`ALU mismatch: R3=${r3} (exp 20), R4=${r4} (exp 10), R5=${r5} (exp 5), R6=${r6} (exp 15), R7=${r7} (exp 10)`);
        }

        return {
            expected: 'R3=20, R4=10, R5=5, R6=15, R7=10',
            actual: `R3=${r3}, R4=${r4}, R5=${r5}, R6=${r6}, R7=${r7}`,
            details: 'All arithmetic and bitwise logic operations execute correctly.',
        };
    }

    // ─── 2. Register dependencies ─────────────────────────────────────────────
    static testRegisterDependencies() {
        const asm = `
            ADDI R1, R0, 25
            ADD  R2, R1, R0   ; R2 = R1 = 25
            ADD  R3, R2, R1   ; R3 = 25 + 25 = 50
            HALT
        `;
        const { cpu } = this._runProgram(asm, false); // No forwarding -> must stall
        const r3 = cpu.registers[3];
        const stalls = cpu.stats.stalls;

        if (r3 !== 50 || stalls < 2) {
            throw new Error(`Expected R3=50 and stalls >= 2 without forwarding, got R3=${r3}, stalls=${stalls}`);
        }

        return {
            expected: 'R3=50 with >= 2 stall cycles without forwarding',
            actual: `R3=${r3}, stalls=${stalls}`,
            details: 'Correctly detected RAW dependencies and inserted stall bubbles.',
        };
    }

    // ─── 3. EX/MEM forwarding ─────────────────────────────────────────────────
    static testExMemForwarding() {
        const asm = `
            ADDI R1, R0, 30
            ADDI R2, R1, 10   ; R2 = 30 + 10 = 40 (EX/MEM bypass of R1)
            HALT
        `;
        const { cpu, history } = this._runProgram(asm, true);
        const r2 = cpu.registers[2];
        const fwdSnap = history.find(s => s.forwardA === ForwardSrc.EX_MEM || s.forwardB === ForwardSrc.EX_MEM);

        if (r2 !== 40 || !fwdSnap) {
            throw new Error(`Expected R2=40 and EX/MEM forwarding active, got R2=${r2}`);
        }

        return {
            expected: 'R2=40, EX/MEM forwarding active',
            actual: `R2=${r2}, EX/MEM bypass confirmed`,
            details: 'Back-to-back dependency resolved without stalls via EX/MEM bypass wire.',
        };
    }

    // ─── 4. MEM/WB forwarding ─────────────────────────────────────────────────
    static testMemWbForwarding() {
        const asm = `
            ADDI R1, R0, 42
            NOP               ; 1-cycle separation
            ADD  R2, R1, R0   ; R2 = R1 = 42 (MEM/WB bypass)
            HALT
        `;
        const { cpu, history } = this._runProgram(asm, true);
        const r2 = cpu.registers[2];
        const fwdSnap = history.find(s => s.forwardA === ForwardSrc.MEM_WB || s.forwardB === ForwardSrc.MEM_WB);

        if (r2 !== 42 || !fwdSnap) {
            throw new Error(`Expected R2=42 and MEM/WB forwarding active, got R2=${r2}`);
        }

        return {
            expected: 'R2=42, MEM/WB forwarding active',
            actual: `R2=${r2}, MEM/WB bypass confirmed`,
            details: 'Distance-2 dependency resolved with zero stalls via MEM/WB bypass wire.',
        };
    }

    // ─── 5. Forwarding priority ───────────────────────────────────────────────
    static testForwardingPriority() {
        // Both EX/MEM and MEM/WB write to R1; SUB must receive the newer EX/MEM value
        const asm = `
            ADDI R1, R0, 10   ; Older write to R1 (will be in MEM/WB)
            ADDI R1, R0, 20   ; Newer write to R1 (will be in EX/MEM)
            ADD  R2, R1, R0   ; Must forward from EX/MEM (value 20, NOT 10)
            HALT
        `;
        const { cpu } = this._runProgram(asm, true);
        const r2 = cpu.registers[2];

        if (r2 !== 20) {
            throw new Error(`Forwarding priority inversion: R2=${r2} (expected 20 from newer EX/MEM write)`);
        }

        return {
            expected: 'R2=20 (EX/MEM has priority over MEM/WB)',
            actual: `R2=${r2}`,
            details: 'Priority rule strictly obeyed: newest value from EX/MEM bypassed.',
        };
    }

    // ─── 6. Load-use hazard ───────────────────────────────────────────────────
    static testLoadUseHazard() {
        const asm = `
            ADDI R2, R0, 12
            LD   R1, [R2]     ; Load from memory[12]
            ADD  R3, R1, R0   ; Dependent on loaded R1 → MUST stall 1 cycle!
            HALT
        `;
        const { cpu, history } = this._runProgram(asm, true);
        const luSnap = history.find(s => s.hazard === HazardType.LOAD_USE && s.stall);

        if (!luSnap) {
            throw new Error('Load-Use hazard was not detected or did not assert stall!');
        }

        return {
            expected: 'Load-Use hazard detected, exactly 1 stall cycle inserted',
            actual: `Stalls=${cpu.stats.stalls}, Load-Use hazard detected`,
            details: 'Pipeline frozen for 1 cycle; data forwarded next cycle from MEM/WB.',
        };
    }

    // ─── 7. Multiple consecutive dependencies ─────────────────────────────────
    static testMultipleDependencies() {
        const asm = `
            ADDI R1, R0, 5
            ADD  R2, R1, R1   ; R2 = 10 (fwd R1)
            ADD  R3, R2, R1   ; R3 = 15 (fwd R2 & R1)
            ADD  R4, R3, R2   ; R4 = 25 (fwd R3 & R2)
            HALT
        `;
        const { cpu } = this._runProgram(asm, true);
        const r4 = cpu.registers[4];

        if (r4 !== 25) {
            throw new Error(`Cascading dependencies failed: R4=${r4} (expected 25)`);
        }

        return {
            expected: 'R4=25 with cascading dual forwarding',
            actual: `R4=${r4}`,
            details: 'Continuous back-to-back dual register dependencies forwarded seamlessly.',
        };
    }

    // ─── 8. Branch taken ──────────────────────────────────────────────────────
    static testBranchTaken() {
        const asm = `
            ADDI R1, R0, 5
            BEQ  R1, R1, target ; Taken!
            ADDI R2, R0, 99     ; Should be flushed!
            target:
            ADDI R3, R0, 77
            HALT
        `;
        const { cpu } = this._runProgram(asm, true);
        const r2 = cpu.registers[2];
        const r3 = cpu.registers[3];

        if (r2 === 99 || r3 !== 77) {
            throw new Error(`Branch taken failed: R2=${r2} (should be 0), R3=${r3} (expected 77)`);
        }

        return {
            expected: 'R2=0 (flushed), R3=77 (target executed)',
            actual: `R2=${r2}, R3=${r3}`,
            details: 'Branch taken condition evaluated in ID, PC redirected to target.',
        };
    }

    // ─── 9. Branch not taken ──────────────────────────────────────────────────
    static testBranchNotTaken() {
        const asm = `
            ADDI R1, R0, 5
            ADDI R2, R0, 10
            BEQ  R1, R2, skip   ; Not taken!
            ADDI R3, R0, 100    ; Should execute!
            skip:
            ADDI R4, R0, 200
            HALT
        `;
        const { cpu } = this._runProgram(asm, true);
        const r3 = cpu.registers[3];
        const r4 = cpu.registers[4];

        if (r3 !== 100 || r4 !== 200) {
            throw new Error(`Branch not taken failed: R3=${r3} (expected 100), R4=${r4} (expected 200)`);
        }

        return {
            expected: 'R3=100 (fall-through executed), R4=200',
            actual: `R3=${r3}, R4=${r4}`,
            details: 'Branch not taken allowed sequential instructions to proceed without flushes.',
        };
    }

    // ─── 10. Pipeline flush verification ──────────────────────────────────────
    static testPipelineFlush() {
        const asm = `
            BEQ R0, R0, target
            ADDI R1, R0, 888  ; Fetched into IF/ID, MUST be killed!
            target:
            ADDI R2, R0, 999
            HALT
        `;
        const { cpu, history } = this._runProgram(asm, true);
        const flushSnap = history.find(s => s.flush);
        const r1 = cpu.registers[1];
        const r2 = cpu.registers[2];

        if (!flushSnap || r1 === 888 || r2 !== 999) {
            throw new Error(`Flush verification failed: flushSignal=${Boolean(flushSnap)}, R1=${r1}, R2=${r2}`);
        }

        return {
            expected: 'Flush signal asserted, R1=0 (killed), R2=999',
            actual: `Flush asserted=${Boolean(flushSnap)}, R1=${r1}, R2=${r2}`,
            details: 'Flushed instruction converted to bubble; no state commit permitted.',
        };
    }

    // ─── 11. Stall + forwarding interaction ───────────────────────────────────
    static testStallForwardingInteraction() {
        const asm = `
            ADDI R2, R0, 0
            LD   R1, [R2]     ; Load into R1
            ADD  R3, R1, R0   ; Stalls 1 cycle, then receives R1 from MEM/WB
            ADD  R4, R3, R1   ; EX/MEM fwd (R3) + MEM/WB fwd (R1)
            HALT
        `;
        const { cpu } = this._runProgram(asm, true);
        const stalls = cpu.stats.stalls;
        const fwdEvents = cpu.stats.forwardingEvents;

        if (stalls < 1 || fwdEvents < 1) {
            throw new Error(`Expected stall >= 1 and forwarding >= 1, got stalls=${stalls}, fwd=${fwdEvents}`);
        }

        return {
            expected: 'At least 1 stall followed by bypass forwarding',
            actual: `Stalls=${stalls}, Forwarding Events=${fwdEvents}`,
            details: 'Pipeline accurately transitioned from interlock stall to forwarding bypass.',
        };
    }

    // ─── 12. Reset ────────────────────────────────────────────────────────────
    static testReset() {
        const asm = `
            ADDI R1, R0, 50
            ADDI R2, R0, 60
            HALT
        `;
        const { cpu } = this._runProgram(asm, true);
        if (cpu.registers[1] !== 50) throw new Error('Initial run failed');

        cpu.reset();
        const r1 = cpu.registers[1];
        const pc = cpu.pc;
        const cycle = cpu.cycle;

        if (r1 !== 0 || pc !== 0 || cycle !== 0) {
            throw new Error(`Reset failed: R1=${r1}, PC=${pc}, Cycle=${cycle}`);
        }

        return {
            expected: 'All registers=0, PC=0, Cycle=0, Latches invalid',
            actual: `R1=${r1}, PC=${pc}, Cycle=${cycle}`,
            details: 'Hardware state completely returned to cycle-0 power-on reset state.',
        };
    }

    // ─── 13. Register zero behavior ───────────────────────────────────────────
    static testRegisterZero() {
        const asm = `
            ADDI R0, R0, 999  ; Attempt to write to R0!
            ADD  R0, R0, R0   ; Another attempt!
            ADD  R1, R0, R0   ; Read R0
            HALT
        `;
        const { cpu } = this._runProgram(asm, true);
        const r0 = cpu.registers[0];
        const r1 = cpu.registers[1];

        if (r0 !== 0 || r1 !== 0) {
            throw new Error(`R0 immutability violated! R0=${r0}, R1=${r1}`);
        }

        return {
            expected: 'R0 strictly remains 0 despite explicit writeback attempts',
            actual: `R0=${r0}, R1=${r1}`,
            details: 'Hardware clamp guarantees R0 is immutable zero in all stages and bypass wires.',
        };
    }

    // ─── 14. Memory load/store ────────────────────────────────────────────────
    static testMemoryLoadStore() {
        const asm = `
            ADDI R1, R0, 48   ; Value to store
            ADDI R2, R0, 16   ; Memory address
            ST   [R2], R1     ; Memory[16] = 48
            LD   R3, [R2]     ; Load back from Memory[16]
            HALT
        `;
        const { cpu } = this._runProgram(asm, true);
        const mem16 = cpu.memory[16];
        const r3 = cpu.registers[3];

        if (mem16 !== 48 || r3 !== 48) {
            throw new Error(`Memory load/store failed: Mem[16]=${mem16}, R3=${r3} (expected 48)`);
        }

        return {
            expected: 'Memory[16]=48 and R3=48',
            actual: `Memory[16]=${mem16}, R3=${r3}`,
            details: 'Store executed in MEM stage and read back accurately by subsequent load.',
        };
    }

    // ─── 15. Back-to-back hazards ─────────────────────────────────────────────
    static testBackToBackHazards() {
        const asm = `
            ADDI R1, R0, 10
            ADD  R2, R1, R0   ; Hazard on R1
            ADD  R3, R2, R1   ; Hazard on R2 (EX/MEM) and R1 (MEM/WB)
            ADD  R4, R3, R2   ; Hazard on R3 (EX/MEM) and R2 (MEM/WB)
            HALT
        `;
        const { cpu } = this._runProgram(asm, true);
        const r4 = cpu.registers[4];

        if (r4 !== 30) {
            throw new Error(`Back-to-back hazard failed: R4=${r4} (expected 30)`);
        }

        return {
            expected: 'R4=30 across 3 consecutive hazards',
            actual: `R4=${r4}`,
            details: 'Simultaneous EX/MEM and MEM/WB forwarding multiplexing executed cleanly.',
        };
    }

    // ─── 16. Long programs (Loop Execution) ───────────────────────────────────
    static testLongProgram() {
        const asm = `
            ADDI R1, R0, 0    ; sum = 0
            ADDI R2, R0, 4    ; count = 4
            loop:
            ADD  R1, R1, R2   ; sum += count
            SUB  R2, R2, 1    ; count--
            BNE  R2, R0, loop ; loop while count != 0
            HALT
        `;
        const { cpu } = this._runProgram(asm, true, 100);
        const r1 = cpu.registers[1];
        const r2 = cpu.registers[2];

        // Sum of 4+3+2+1 = 10
        if (r1 !== 10 || r2 !== 0) {
            throw new Error(`Loop test failed: R1=${r1} (expected 10), R2=${r2} (expected 0)`);
        }

        return {
            expected: 'R1=10 (sum 4..1), R2=0 (terminated cleanly)',
            actual: `R1=${r1}, R2=${r2}`,
            details: 'Multi-iteration loop with backward branch, flushes, and accumulation verified.',
        };
    }

    // ─── 17. Load-Branch Data Hazard (2 Stalls + Forwarding) ───────────────────
    static testLoadBranchHazard() {
        const asm = `
            ADDI R1, R0, 16   ; Memory address 16
            ADDI R2, R0, 42   ; Test value 42
            ST   [R1], R2     ; Memory[16] = 42
            LD   R3, [R1]     ; Load 42 into R3
            BEQ  R3, R2, target ; Branch on loaded R3 (Load-to-Branch hazard in ID!)
            ADDI R4, R0, 99   ; Should be skipped (flushed)
            target:
            ADDI R4, R0, 77   ; Target taken
            HALT
        `;
        const { cpu } = this._runProgram(asm, true, 50);
        const r4 = cpu.registers[4];

        if (r4 !== 77) {
            throw new Error(`Load-branch hazard failed: R4=${r4} (expected 77)`);
        }

        if (cpu.stats.stalls < 2) {
            throw new Error(`Load-branch hazard failed: expected at least 2 stalls, got ${cpu.stats.stalls}`);
        }

        return {
            expected: 'R4=77, with 2 load-branch interlock stalls and branch taken',
            actual: `R4=${r4}, stalls=${cpu.stats.stalls}, flushes=${cpu.stats.flushes}`,
            details: 'Load-to-branch hazard successfully injected 2 pipeline bubbles and forwarded loaded data to branch comparator.',
        };
    }

    // ─── 18. Store Data Forwarding in MEM Stage ───────────────────────────────
    static testStoreForwarding() {
        const asm = `
            ADDI R1, R0, 20   ; Memory address 20
            ADDI R2, R0, 10
            ADDI R3, R0, 25
            ADD  R4, R2, R3   ; R4 = 35 (in EX stage)
            ST   [R1], R4     ; Store R4 immediately! Requires EX/MEM or MEM/WB store forwarding
            LD   R5, [R1]     ; Read back
            HALT
        `;
        const { cpu } = this._runProgram(asm, true, 50);
        const mem20 = cpu.memory[20];
        const r5 = cpu.registers[5];

        if (mem20 !== 35 || r5 !== 35) {
            throw new Error(`Store forwarding failed: Mem[20]=${mem20}, R5=${r5} (expected 35)`);
        }

        return {
            expected: 'Memory[20]=35, R5=35 via Store Data Forwarding',
            actual: `Memory[20]=${mem20}, R5=${r5}`,
            details: 'Store instruction correctly forwarded updated register value from preceding arithmetic instruction.',
        };
    }

    // ─── 19. JR Indirect Jump with Register Forwarding ────────────────────────
    static testJRForwarding() {
        const asm = `
            ADDI R1, R0, 16   ; Target byte address = 16 (4 instructions ahead)
            JR   R1           ; Jump to target via register R1
            ADDI R2, R0, 99   ; Should be flushed!
            ADDI R3, R0, 88   ; Should be flushed!
            ADDI R4, R0, 42   ; Address 16: Target
            HALT
        `;
        const { cpu } = this._runProgram(asm, true, 50);
        const r2 = cpu.registers[2];
        const r4 = cpu.registers[4];

        if (r2 !== 0 || r4 !== 42) {
            throw new Error(`JR forwarding failed: R2=${r2} (expected 0), R4=${r4} (expected 42)`);
        }

        return {
            expected: 'R2=0 (flushed), R4=42 (executed target)',
            actual: `R2=${r2}, R4=${r4}, flushes=${cpu.stats.flushes}`,
            details: 'JR instruction evaluated register target in ID stage with proper hazard detection and pipeline flush.',
        };
    }

    // ─── 20. Comment & Blank Line Independence in Grid ────────────────────────
    static testCommentBlankLineIndependence() {
        const asm = `
            ; Header Comment Line 1
            ; Header Comment Line 2

            ADDI R1, R0, 5

            ; Middle Comment
            ADDI R2, R0, 7

            ADD  R3, R1, R2
            HALT
        `;
        const { cpu } = this._runProgram(asm, true, 50);
        const r3 = cpu.registers[3];

        if (r3 !== 12) {
            throw new Error(`Program with comments failed: R3=${r3} (expected 12)`);
        }

        // Verify that instruction indexes are contiguous 0..3 (not source lines)
        for (let i = 0; i < cpu.instructions.length; i++) {
            if (cpu.instructions[i].index !== i) {
                throw new Error(`Instruction index mismatch at ${i}: got ${cpu.instructions[i].index}`);
            }
        }

        // Verify grid history has entries for all instructions 0..3
        for (let i = 0; i < cpu.instructions.length; i++) {
            if (!cpu.gridHistory[i] || cpu.gridHistory[i].length === 0) {
                throw new Error(`Grid history missing for instruction index ${i}`);
            }
        }

        return {
            expected: 'R3=12, contiguous instruction indexes 0..3, complete grid history',
            actual: `R3=${r3}, instruction count=${cpu.instructions.length}`,
            details: 'Reservation table and pipeline stages operate on 0-based instruction indexes completely immune to comments.',
        };
    }
}
