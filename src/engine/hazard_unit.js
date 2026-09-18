// ──────────────────────────────────────────────────────────────────────────────
// SIMT-Flow: Hazard Detection & Resolution Unit
// ──────────────────────────────────────────────────────────────────────────────
// Detects structural, data (RAW, Load-Use), and control (Branch/Jump) hazards.
// Controls PC stall, IF/ID latch freeze, and ID/EX bubble insertion.
// ──────────────────────────────────────────────────────────────────────────────

import { HazardType, Opcode } from './types.js';

export class HazardUnit {
    /**
     * Evaluate pipeline state to detect hazards.
     * @param {Object} params
     * @param {Object} params.if_id - Instruction currently in ID stage (from IF/ID)
     * @param {Object} params.id_ex - Instruction currently in EX stage
     * @param {Object} params.ex_mem - Instruction currently in MEM stage
     * @param {Object} params.mem_wb - Instruction currently in WB stage
     * @param {boolean} params.forwardingEnabled - Whether data forwarding is active
     * @param {boolean} params.branchTaken - Whether branch condition was evaluated true in ID
     * @param {boolean} params.isJump - Whether instruction in ID is an unconditional jump
     * @returns {Object} Hazard status, stall flag, flush flag, and diagnostic details
     */
    static detect({
        if_id,
        id_ex,
        ex_mem,
        mem_wb,
        forwardingEnabled = true,
        branchTaken = false,
        isJump = false,
    }) {
        let stall = false;
        let flush = false;
        let hazardType = HazardType.NONE;
        let details = null;

        // If ID stage has no valid instruction, no data hazard can be triggered by ID
        if (!if_id || if_id.isBubble || !if_id.valid || !if_id.instruction) {
            // Control hazard check still applies if branch taken
            if (branchTaken || isJump) {
                return {
                    stall: false,
                    flush: true,
                    hazard: HazardType.CONTROL,
                    details: {
                        type: HazardType.CONTROL,
                        reason: branchTaken ? 'Branch condition taken' : 'Unconditional Jump',
                        action: 'Flush IF/ID (1-cycle penalty)',
                    },
                };
            }
            return { stall: false, flush: false, hazard: HazardType.NONE, details: null };
        }

        const inst = if_id.instruction;
        const op = inst.opcode;

        // Determine source registers read by instruction in ID stage
        let rs1 = null;
        let rs2 = null;

        if (op === Opcode.ADD || op === Opcode.SUB || op === Opcode.MUL || op === Opcode.DIV ||
            op === Opcode.AND || op === Opcode.OR || op === Opcode.XOR || op === Opcode.SLT) {
            rs1 = inst.rs1;
            rs2 = inst.rs2;
        } else if (op === Opcode.ADDI || op === Opcode.SLL || op === Opcode.SRL) {
            rs1 = inst.rs1;
            rs2 = null; // imm is ALU input
        } else if (op === Opcode.LD) {
            rs1 = inst.rs1; // address base register
            rs2 = null;
        } else if (op === Opcode.ST) {
            // For ST [Rd], Rs1:
            // inst.rd is the address register, inst.rs1 is the data register
            rs1 = inst.rd;  // address register (needed for address calculation)
            rs2 = inst.rs1; // value register (needed for memory write)
        } else if (op === Opcode.BEQ || op === Opcode.BNE || op === Opcode.BLT || op === Opcode.BGE) {
            rs1 = inst.rs1;
            rs2 = inst.rs2;
        } else if (op === Opcode.JR) {
            rs1 = inst.rs1;
        }

        // ─────────────────────────────────────────────────────────────────────
        // 1. LOAD-USE DATA HAZARD DETECTION
        // ─────────────────────────────────────────────────────────────────────
        // A load instruction in EX stage (ID/EX) cannot forward loaded data to
        // the immediately following instruction in ID stage because data is only
        // available after the MEM stage.
        // Requires: 1-cycle stall (Freeze PC, Freeze IF/ID, Bubble ID/EX).
        // ─────────────────────────────────────────────────────────────────────
        if (id_ex && id_ex.valid && !id_ex.isBubble && id_ex.memRead && id_ex.rd !== 0 && id_ex.rd !== null) {
            const loadDest = id_ex.rd;
            const matchRs1 = (rs1 !== null && rs1 !== undefined && rs1 === loadDest);
            const matchRs2 = (rs2 !== null && rs2 !== undefined && rs2 === loadDest);

            if (matchRs1 || matchRs2) {
                stall = true;
                hazardType = HazardType.LOAD_USE;
                details = {
                    type: HazardType.LOAD_USE,
                    reg: loadDest,
                    producer: id_ex.instruction?.raw || 'LD',
                    consumer: inst.raw,
                    sourceStage: 'EX (MEM pending)',
                    resolution: 'Freeze PC and IF/ID; inject 1 bubble into ID/EX. Data forwarded next cycle from MEM/WB.',
                };
                return { stall, flush: false, hazard: hazardType, details };
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // 2. RAW DATA HAZARD DETECTION (WITHOUT FORWARDING)
        // ─────────────────────────────────────────────────────────────────────
        // When forwarding is disabled, an instruction cannot proceed to EX if its
        // operands depend on an instruction in EX or MEM stage.
        // Requires: 2 stall cycles until the producer reaches WB stage.
        // ─────────────────────────────────────────────────────────────────────
        if (!forwardingEnabled) {
            const checkDependency = (rs) => {
                if (rs === null || rs === undefined || rs === 0) return null;

                // Dependency with instruction in EX stage
                if (id_ex && id_ex.valid && !id_ex.isBubble && id_ex.regWrite && id_ex.rd === rs && id_ex.rd !== 0) {
                    return { stage: 'EX', producer: id_ex.instruction?.raw, reg: rs };
                }
                // Dependency with instruction in MEM stage
                if (ex_mem && ex_mem.valid && !ex_mem.isBubble && ex_mem.regWrite && ex_mem.rd === rs && ex_mem.rd !== 0) {
                    return { stage: 'MEM', producer: ex_mem.instruction?.raw, reg: rs };
                }
                return null;
            };

            const dep1 = checkDependency(rs1);
            const dep2 = checkDependency(rs2);
            const dep = dep1 || dep2;

            if (dep) {
                stall = true;
                hazardType = HazardType.RAW;
                details = {
                    type: HazardType.RAW,
                    reg: dep.reg,
                    producer: dep.producer,
                    consumer: inst.raw,
                    sourceStage: dep.stage,
                    resolution: `Forwarding disabled. Stalling until R${dep.reg} writes back to register file.`,
                };
                return { stall, flush: false, hazard: hazardType, details };
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // 3. BRANCH & JUMP DATA DEPENDENCY HAZARDS IN ID
        // ─────────────────────────────────────────────────────────────────────
        // Early branch/jump resolution in ID evaluates condition and target.
        // A) If producer is a LOAD in MEM (EX/MEM), data is not yet ready in ID:
        //    Requires 1 stall cycle so producer advances to MEM/WB where it can bypass.
        // B) If producer is in EX (ID/EX), its result is not yet available to ID:
        //    Requires 1 stall cycle so producer advances to EX/MEM.
        // ─────────────────────────────────────────────────────────────────────
        const isBranchOrJump = (op === Opcode.BEQ || op === Opcode.BNE || op === Opcode.BLT || op === Opcode.BGE || op === Opcode.JR);
        if (isBranchOrJump && !stall) {
            // Check dependency on LOAD instruction in MEM stage
            if (ex_mem && ex_mem.valid && !ex_mem.isBubble && ex_mem.memRead && ex_mem.rd !== 0 && ex_mem.rd !== null) {
                if (ex_mem.rd === rs1 || ex_mem.rd === rs2) {
                    stall = true;
                    hazardType = HazardType.LOAD_USE;
                    details = {
                        type: HazardType.LOAD_USE,
                        reg: ex_mem.rd,
                        producer: ex_mem.instruction?.raw || 'LD',
                        consumer: inst.raw,
                        sourceStage: 'MEM (Read pending)',
                        resolution: 'Branch/JR depends on LD in MEM stage. Stalling 1 cycle for MEM/WB bypass.',
                    };
                    return { stall, flush: false, hazard: hazardType, details };
                }
            }

            // Check dependency on instruction in EX stage
            if (id_ex && id_ex.valid && !id_ex.isBubble && id_ex.regWrite && id_ex.rd !== 0 && id_ex.rd !== null) {
                if (id_ex.rd === rs1 || id_ex.rd === rs2) {
                    stall = true;
                    hazardType = HazardType.RAW;
                    details = {
                        type: HazardType.RAW,
                        reg: id_ex.rd,
                        producer: id_ex.instruction?.raw,
                        consumer: inst.raw,
                        sourceStage: 'EX',
                        resolution: 'Branch/JR compares register being computed in EX. Stalling 1 cycle for EX/MEM bypass.',
                    };
                    return { stall, flush: false, hazard: hazardType, details };
                }
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // 4. CONTROL HAZARDS (BRANCH TAKEN OR JUMP)
        // ─────────────────────────────────────────────────────────────────────
        if (!stall && (branchTaken || isJump)) {
            flush = true;
            hazardType = HazardType.CONTROL;
            details = {
                type: HazardType.CONTROL,
                reason: branchTaken ? 'Branch condition taken' : 'Unconditional Jump',
                action: 'Flush fetched instruction in IF/ID (1-cycle branch penalty)',
            };
            return { stall: false, flush: true, hazard: hazardType, details };
        }

        return { stall: false, flush: false, hazard: HazardType.NONE, details: null };
    }
}
