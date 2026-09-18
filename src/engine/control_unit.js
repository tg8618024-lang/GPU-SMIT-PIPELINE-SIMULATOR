// ──────────────────────────────────────────────────────────────────────────────
// SIMT-Flow: Centralized CPU Control Unit
// ──────────────────────────────────────────────────────────────────────────────
// Generates all pipeline control signals based on instruction opcode.
// Controls signal propagation through IF/ID -> ID/EX -> EX/MEM -> MEM/WB.
// ──────────────────────────────────────────────────────────────────────────────

import { Opcode } from './types.js';

export class ControlUnit {
    /**
     * Decode an instruction and generate architectural control signals.
     * @param {Object} instruction
     * @returns {Object} Control signals bundle
     */
    static decode(instruction) {
        if (!instruction || !instruction.opcode) {
            return this.getNopSignals();
        }

        const op = instruction.opcode;

        switch (op) {
            // ─── R-Type Arithmetic & Logical ───
            case Opcode.ADD:
                return {
                    regWrite:   true,
                    memRead:    false,
                    memWrite:   false,
                    memToReg:   false,
                    aluSrc:     false, // rs2 register
                    aluOp:      Opcode.ADD,
                    branch:     false,
                    jump:       false,
                    branchType: 'NONE',
                    isHalt:     false,
                    isNop:      false,
                };

            case Opcode.SUB:
                return {
                    regWrite:   true,
                    memRead:    false,
                    memWrite:   false,
                    memToReg:   false,
                    aluSrc:     instruction.imm !== null && instruction.imm !== undefined && instruction.rs2 === null,
                    aluOp:      Opcode.SUB,
                    branch:     false,
                    jump:       false,
                    branchType: 'NONE',
                    isHalt:     false,
                    isNop:      false,
                };

            case Opcode.MUL:
                return {
                    regWrite:   true,
                    memRead:    false,
                    memWrite:   false,
                    memToReg:   false,
                    aluSrc:     false,
                    aluOp:      Opcode.MUL,
                    branch:     false,
                    jump:       false,
                    branchType: 'NONE',
                    isHalt:     false,
                    isNop:      false,
                };

            case Opcode.DIV:
                return {
                    regWrite:   true,
                    memRead:    false,
                    memWrite:   false,
                    memToReg:   false,
                    aluSrc:     false,
                    aluOp:      Opcode.DIV,
                    branch:     false,
                    jump:       false,
                    branchType: 'NONE',
                    isHalt:     false,
                    isNop:      false,
                };

            case Opcode.AND:
                return {
                    regWrite:   true,
                    memRead:    false,
                    memWrite:   false,
                    memToReg:   false,
                    aluSrc:     false,
                    aluOp:      Opcode.AND,
                    branch:     false,
                    jump:       false,
                    branchType: 'NONE',
                    isHalt:     false,
                    isNop:      false,
                };

            case Opcode.OR:
                return {
                    regWrite:   true,
                    memRead:    false,
                    memWrite:   false,
                    memToReg:   false,
                    aluSrc:     false,
                    aluOp:      Opcode.OR,
                    branch:     false,
                    jump:       false,
                    branchType: 'NONE',
                    isHalt:     false,
                    isNop:      false,
                };

            case Opcode.XOR:
                return {
                    regWrite:   true,
                    memRead:    false,
                    memWrite:   false,
                    memToReg:   false,
                    aluSrc:     false,
                    aluOp:      Opcode.XOR,
                    branch:     false,
                    jump:       false,
                    branchType: 'NONE',
                    isHalt:     false,
                    isNop:      false,
                };

            case Opcode.SLT:
                return {
                    regWrite:   true,
                    memRead:    false,
                    memWrite:   false,
                    memToReg:   false,
                    aluSrc:     false,
                    aluOp:      Opcode.SLT,
                    branch:     false,
                    jump:       false,
                    branchType: 'NONE',
                    isHalt:     false,
                    isNop:      false,
                };

            case Opcode.SLL:
                return {
                    regWrite:   true,
                    memRead:    false,
                    memWrite:   false,
                    memToReg:   false,
                    aluSrc:     true, // shift amount is immediate
                    aluOp:      Opcode.SLL,
                    branch:     false,
                    jump:       false,
                    branchType: 'NONE',
                    isHalt:     false,
                    isNop:      false,
                };

            case Opcode.SRL:
                return {
                    regWrite:   true,
                    memRead:    false,
                    memWrite:   false,
                    memToReg:   false,
                    aluSrc:     true, // shift amount is immediate
                    aluOp:      Opcode.SRL,
                    branch:     false,
                    jump:       false,
                    branchType: 'NONE',
                    isHalt:     false,
                    isNop:      false,
                };

            // ─── I-Type Immediate Arithmetic ───
            case Opcode.ADDI:
                return {
                    regWrite:   true,
                    memRead:    false,
                    memWrite:   false,
                    memToReg:   false,
                    aluSrc:     true, // immediate
                    aluOp:      Opcode.ADD,
                    branch:     false,
                    jump:       false,
                    branchType: 'NONE',
                    isHalt:     false,
                    isNop:      false,
                };

            // ─── Memory Operations ───
            case Opcode.LD:
                return {
                    regWrite:   true,
                    memRead:    true,
                    memWrite:   false,
                    memToReg:   true,
                    aluSrc:     true, // base + offset (or base + 0)
                    aluOp:      Opcode.ADD,
                    branch:     false,
                    jump:       false,
                    branchType: 'NONE',
                    isHalt:     false,
                    isNop:      false,
                };

            case Opcode.ST:
                return {
                    regWrite:   false,
                    memRead:    false,
                    memWrite:   true,
                    memToReg:   false,
                    aluSrc:     true, // base + offset (or base + 0)
                    aluOp:      Opcode.ADD,
                    branch:     false,
                    jump:       false,
                    branchType: 'NONE',
                    isHalt:     false,
                    isNop:      false,
                };

            // ─── Branches & Jumps ───
            case Opcode.BEQ:
                return {
                    regWrite:   false,
                    memRead:    false,
                    memWrite:   false,
                    memToReg:   false,
                    aluSrc:     false,
                    aluOp:      Opcode.SUB, // comparison via subtraction
                    branch:     true,
                    jump:       false,
                    branchType: 'BEQ',
                    isHalt:     false,
                    isNop:      false,
                };

            case Opcode.BNE:
                return {
                    regWrite:   false,
                    memRead:    false,
                    memWrite:   false,
                    memToReg:   false,
                    aluSrc:     false,
                    aluOp:      Opcode.SUB,
                    branch:     true,
                    jump:       false,
                    branchType: 'BNE',
                    isHalt:     false,
                    isNop:      false,
                };

            case Opcode.BLT:
                return {
                    regWrite:   false,
                    memRead:    false,
                    memWrite:   false,
                    memToReg:   false,
                    aluSrc:     false,
                    aluOp:      Opcode.SLT,
                    branch:     true,
                    jump:       false,
                    branchType: 'BLT',
                    isHalt:     false,
                    isNop:      false,
                };

            case Opcode.BGE:
                return {
                    regWrite:   false,
                    memRead:    false,
                    memWrite:   false,
                    memToReg:   false,
                    aluSrc:     false,
                    aluOp:      Opcode.SLT,
                    branch:     true,
                    jump:       false,
                    branchType: 'BGE',
                    isHalt:     false,
                    isNop:      false,
                };

            case Opcode.J:
                return {
                    regWrite:   false,
                    memRead:    false,
                    memWrite:   false,
                    memToReg:   false,
                    aluSrc:     false,
                    aluOp:      Opcode.NOP,
                    branch:     false,
                    jump:       true,
                    branchType: 'J',
                    isHalt:     false,
                    isNop:      false,
                };

            case Opcode.JAL:
                return {
                    regWrite:   true, // saves PC+4 in Rd
                    memRead:    false,
                    memWrite:   false,
                    memToReg:   false,
                    aluSrc:     false,
                    aluOp:      Opcode.NOP,
                    branch:     false,
                    jump:       true,
                    branchType: 'JAL',
                    isHalt:     false,
                    isNop:      false,
                };

            case Opcode.JR:
                return {
                    regWrite:   false,
                    memRead:    false,
                    memWrite:   false,
                    memToReg:   false,
                    aluSrc:     false,
                    aluOp:      Opcode.NOP,
                    branch:     false,
                    jump:       true,
                    branchType: 'JR',
                    isHalt:     false,
                    isNop:      false,
                };

            // ─── Control Instructions ───
            case Opcode.HALT:
                return {
                    regWrite:   false,
                    memRead:    false,
                    memWrite:   false,
                    memToReg:   false,
                    aluSrc:     false,
                    aluOp:      Opcode.NOP,
                    branch:     false,
                    jump:       false,
                    branchType: 'NONE',
                    isHalt:     true,
                    isNop:      false,
                };

            case Opcode.NOP:
            default:
                return this.getNopSignals();
        }
    }

    /**
     * Default control signals for NOP / Bubble / Flushed stage.
     */
    static getNopSignals() {
        return {
            regWrite:   false,
            memRead:    false,
            memWrite:   false,
            memToReg:   false,
            aluSrc:     false,
            aluOp:      Opcode.NOP,
            branch:     false,
            jump:       false,
            branchType: 'NONE',
            isHalt:     false,
            isNop:      true,
        };
    }
}
