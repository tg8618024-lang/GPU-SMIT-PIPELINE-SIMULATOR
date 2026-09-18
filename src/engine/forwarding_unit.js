// ──────────────────────────────────────────────────────────────────────────────
// SIMT-Flow: Data Forwarding Unit
// ──────────────────────────────────────────────────────────────────────────────
// Detects RAW dependencies across pipeline stages and controls bypass multiplexers.
// Priority: EX/MEM takes precedence over MEM/WB when both target the same register.
// Hardwired zero register (R0) is never forwarded.
// ──────────────────────────────────────────────────────────────────────────────

import { ForwardSrc } from './types.js';

export class ForwardingUnit {
    /**
     * Compute forwarding decisions for the EX (Execute) stage ALU inputs and store data.
     * @param {Object} params
     * @param {Object} params.id_ex - Latched instruction in ID/EX
     * @param {Object} params.ex_mem - Latched instruction in EX/MEM
     * @param {Object} params.mem_wb - Latched instruction in MEM/WB
     * @param {boolean} params.forwardingEnabled - Global toggle for forwarding
     * @returns {Object} Forwarding control decisions and resolved operand values
     */
    static computeEXForwarding({ id_ex, ex_mem, mem_wb, forwardingEnabled = true }) {
        let fwdA = ForwardSrc.NONE;
        let fwdB = ForwardSrc.NONE;
        let fwdStore = ForwardSrc.NONE;

        let reasonA = 'Read from Register File';
        let reasonB = 'Read from Register File';

        let val1 = id_ex?.val1 ?? 0;
        let val2 = id_ex?.val2 ?? 0;
        let storeData = id_ex?.val2 ?? 0; // In ST, val2 holds data to store

        if (!forwardingEnabled || !id_ex || id_ex.isBubble || !id_ex.valid) {
            return {
                fwdA,
                fwdB,
                fwdStore,
                val1,
                val2,
                storeData,
                reasonA,
                reasonB,
            };
        }

        const rs1 = id_ex.rs1;
        const rs2 = id_ex.rs2;

        // ─────────────────────────────────────────────────────────────────────
        // 1. Forwarding for ALU Input A (rs1)
        // ─────────────────────────────────────────────────────────────────────
        if (rs1 !== null && rs1 !== undefined && rs1 > 0) {
            // Priority 1: EX/MEM Forwarding (most recent instruction in MEM)
            // Note: If ex_mem is a Load, its data is not ready in EX/MEM stage
            if (ex_mem && ex_mem.valid && !ex_mem.isBubble && ex_mem.regWrite && ex_mem.rd === rs1 && !ex_mem.memRead) {
                fwdA = ForwardSrc.EX_MEM;
                val1 = ex_mem.aluResult;
                reasonA = `Forwarded R${rs1} from EX/MEM (ALU result: ${val1})`;
            }
            // Priority 2: MEM/WB Forwarding (instruction in WB stage)
            else if (mem_wb && mem_wb.valid && !mem_wb.isBubble && mem_wb.regWrite && mem_wb.rd === rs1) {
                fwdA = ForwardSrc.MEM_WB;
                val1 = mem_wb.memToReg ? mem_wb.memData : mem_wb.aluResult;
                reasonA = `Forwarded R${rs1} from MEM/WB (${mem_wb.memToReg ? 'Memory data' : 'ALU result'}: ${val1})`;
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // 2. Forwarding for ALU Input B / Store Data (rs2)
        // ─────────────────────────────────────────────────────────────────────
        if (rs2 !== null && rs2 !== undefined && rs2 > 0) {
            // Priority 1: EX/MEM Forwarding
            if (ex_mem && ex_mem.valid && !ex_mem.isBubble && ex_mem.regWrite && ex_mem.rd === rs2 && !ex_mem.memRead) {
                fwdB = ForwardSrc.EX_MEM;
                fwdStore = ForwardSrc.EX_MEM;
                val2 = ex_mem.aluResult;
                storeData = ex_mem.aluResult;
                reasonB = `Forwarded R${rs2} from EX/MEM (ALU result: ${val2})`;
            }
            // Priority 2: MEM/WB Forwarding
            else if (mem_wb && mem_wb.valid && !mem_wb.isBubble && mem_wb.regWrite && mem_wb.rd === rs2) {
                fwdB = ForwardSrc.MEM_WB;
                fwdStore = ForwardSrc.MEM_WB;
                const wbVal = mem_wb.memToReg ? mem_wb.memData : mem_wb.aluResult;
                val2 = wbVal;
                storeData = wbVal;
                reasonB = `Forwarded R${rs2} from MEM/WB (${mem_wb.memToReg ? 'Memory data' : 'ALU result'}: ${val2})`;
            }
        }

        return {
            fwdA,
            fwdB,
            fwdStore,
            val1,
            val2,
            storeData,
            reasonA,
            reasonB,
        };
    }

    /**
     * Compute branch comparator forwarding for ID stage early branch resolution.
     */
    static computeBranchForwarding({ rs1, rs2, ex_mem, mem_wb, registers, forwardingEnabled = true }) {
        let val1 = rs1 !== null && rs1 !== undefined && rs1 >= 0 ? registers[rs1] : 0;
        let val2 = rs2 !== null && rs2 !== undefined && rs2 >= 0 ? registers[rs2] : 0;

        if (!forwardingEnabled) {
            return { val1, val2 };
        }

        // Forward rs1 into branch comparator
        if (rs1 !== null && rs1 > 0) {
            if (ex_mem && ex_mem.valid && !ex_mem.isBubble && ex_mem.regWrite && ex_mem.rd === rs1 && !ex_mem.memRead) {
                val1 = ex_mem.aluResult;
            } else if (mem_wb && mem_wb.valid && !mem_wb.isBubble && mem_wb.regWrite && mem_wb.rd === rs1) {
                val1 = mem_wb.memToReg ? mem_wb.memData : mem_wb.aluResult;
            }
        }

        // Forward rs2 into branch comparator
        if (rs2 !== null && rs2 > 0) {
            if (ex_mem && ex_mem.valid && !ex_mem.isBubble && ex_mem.regWrite && ex_mem.rd === rs2 && !ex_mem.memRead) {
                val2 = ex_mem.aluResult;
            } else if (mem_wb && mem_wb.valid && !mem_wb.isBubble && mem_wb.regWrite && mem_wb.rd === rs2) {
                val2 = mem_wb.memToReg ? mem_wb.memData : mem_wb.aluResult;
            }
        }

        return { val1, val2 };
    }
}
