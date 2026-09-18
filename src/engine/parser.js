/**
 * @fileoverview Enhanced Assembly language parser, machine code encoder & disassembler for SIMT-Flow.
 */

import { Opcode, createInstruction } from './types.js';

/**
 * Parses a register string like 'R0', 'r7' and returns its integer index.
 * @param {string} regStr
 * @returns {number|null}
 */
export function parseRegister(regStr) {
    if (!regStr) return null;
    const match = regStr.trim().match(/^R([0-7])$/i);
    if (!match) {
        throw new Error(`Invalid register: ${regStr}. Expected R0-R7.`);
    }
    return parseInt(match[1], 10);
}

/**
 * Parses an immediate value string like '10', '-4', '#15', '0x1F'.
 * @param {string} immStr
 * @returns {number}
 */
export function parseImmediate(immStr) {
    if (!immStr) return 0;
    let s = immStr.trim();
    if (s.startsWith('#')) s = s.slice(1);
    let val = 0;
    if (s.startsWith('0x') || s.startsWith('0X')) {
        val = parseInt(s, 16);
    } else {
        val = parseInt(s, 10);
    }
    if (isNaN(val)) {
        throw new Error(`Invalid immediate constant: ${immStr}`);
    }
    return val;
}

/**
 * Parses a memory operand string like '[R1]', '[R1 + 4]', or '4[R1]'.
 * @param {string} memStr
 * @returns {{ reg: number, offset: number }}
 */
export function parseMemoryOperand(memStr) {
    const s = memStr.trim();
    // Format: [R1] or [R1 + 4] or [R1 - 4]
    const matchBracket = s.match(/^\[\s*R([0-7])\s*(?:([+-])\s*(\d+|0x[0-9a-fA-F]+))?\s*\]$/i);
    if (matchBracket) {
        const reg = parseInt(matchBracket[1], 10);
        let offset = 0;
        if (matchBracket[2] && matchBracket[3]) {
            const rawOffset = parseImmediate(matchBracket[3]);
            offset = matchBracket[2] === '-' ? -rawOffset : rawOffset;
        }
        return { reg, offset };
    }

    // Format: offset[R1] or offset(R1)
    const matchOffset = s.match(/^([+-]?\d+|[+-]?0x[0-9a-fA-F]+)\s*[(\[]\s*R([0-7])\s*[)\]]$/i);
    if (matchOffset) {
        const offset = parseImmediate(matchOffset[1]);
        const reg = parseInt(matchOffset[2], 10);
        return { reg, offset };
    }

    throw new Error(`Invalid memory operand: ${memStr}. Expected [Rx] or [Rx + offset].`);
}

// ─── Machine Code Opcode Encodings ──────────────────────────────────────────
const OPCODE_MAP = {
    [Opcode.ADD]:    0x00,
    [Opcode.SUB]:    0x01,
    [Opcode.MUL]:    0x02,
    [Opcode.DIV]:    0x03,
    [Opcode.AND]:    0x04,
    [Opcode.OR]:     0x05,
    [Opcode.XOR]:    0x06,
    [Opcode.SLT]:    0x07,
    [Opcode.ADDI]:   0x08,
    [Opcode.SLL]:    0x09,
    [Opcode.SRL]:    0x0A,
    [Opcode.LD]:     0x10,
    [Opcode.ST]:     0x11,
    [Opcode.BEQ]:    0x18,
    [Opcode.BNE]:    0x19,
    [Opcode.BLT]:    0x1A,
    [Opcode.BGE]:    0x1B,
    [Opcode.J]:      0x20,
    [Opcode.JAL]:    0x21,
    [Opcode.JR]:     0x22,
    [Opcode.DIV_IF]: 0x28,
    [Opcode.NOP]:    0x3E,
    [Opcode.HALT]:   0x3F,
};

/**
 * Encode an instruction into a 32-bit machine code hex string.
 */
export function encodeMachineCode(opcode, rd, rs1, rs2, imm, labelIndex) {
    const op = OPCODE_MAP[opcode] !== undefined ? OPCODE_MAP[opcode] : 0;
    const r_d = (rd ?? 0) & 0x7;
    const r_s1 = (rs1 ?? 0) & 0x7;
    const r_s2 = (rs2 ?? 0) & 0x7;
    const immediate = (imm !== null && imm !== undefined ? imm : (labelIndex ?? 0)) & 0xFFFF;

    let word = 0;
    // R-type format: [opcode: 6][rd: 5][rs1: 5][rs2: 5][unused: 11]
    if ([Opcode.ADD, Opcode.SUB, Opcode.MUL, Opcode.DIV, Opcode.AND, Opcode.OR, Opcode.XOR, Opcode.SLT].includes(opcode) && (imm === null || imm === undefined)) {
        word = ((op & 0x3F) << 26) | (r_d << 21) | (r_s1 << 16) | (r_s2 << 11);
    }
    // I-type format: [opcode: 6][rd: 5][rs1: 5][imm: 16]
    else if ([Opcode.ADDI, Opcode.SLL, Opcode.SRL, Opcode.LD, Opcode.ST].includes(opcode) || (imm !== null && imm !== undefined)) {
        word = ((op & 0x3F) << 26) | (r_d << 21) | (r_s1 << 16) | (immediate & 0xFFFF);
    }
    // Branch format: [opcode: 6][rs1: 5][rs2: 5][offset: 16]
    else if ([Opcode.BEQ, Opcode.BNE, Opcode.BLT, Opcode.BGE].includes(opcode)) {
        word = ((op & 0x3F) << 26) | (r_s1 << 21) | (r_s2 << 16) | (immediate & 0xFFFF);
    }
    // Jump format: [opcode: 6][target: 26]
    else if ([Opcode.J, Opcode.JAL].includes(opcode)) {
        const target = (labelIndex ?? 0) & 0x3FFFFFF;
        word = ((op & 0x3F) << 26) | target;
    }
    else if (opcode === Opcode.JR) {
        word = ((op & 0x3F) << 26) | (r_s1 << 16);
    }
    else if (opcode === Opcode.DIV_IF) {
        word = ((op & 0x3F) << 26) | (r_d << 21);
    }
    else {
        word = (op & 0x3F) << 26;
    }

    return '0x' + (word >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

/**
 * Parses multi-line assembly text and produces an array of instruction objects and a label map.
 * @param {string} sourceText
 * @returns {{instructions: Object[], labels: Object<string, number>}}
 */
export function parseAssembly(sourceText) {
    const lines = sourceText.split('\n');
    const instructions = [];
    const labels = {};
    let instructionIndex = 0;

    for (let i = 0; i < lines.length; i++) {
        const originalLine = lines[i];
        // Strip comments (everything after ;)
        let line = originalLine.split(';')[0].trim();

        if (!line) {
            continue; // Skip blank lines
        }

        // Check for labels (e.g., "target:" or "loop: ADD R1, R2, R3")
        const labelPrefixMatch = line.match(/^([a-zA-Z0-9_]+):(.*)$/);
        if (labelPrefixMatch) {
            const labelName = labelPrefixMatch[1];
            if (labels.hasOwnProperty(labelName)) {
                throw new Error(`Line ${i + 1}: Duplicate label definition: ${labelName}`);
            }
            labels[labelName] = instructionIndex;
            line = labelPrefixMatch[2].trim();
            if (!line) {
                continue; // Line only contained a label
            }
        }

        // Parse instruction
        const parts = line.split(/[\s,]+/).filter(p => p.length > 0);
        const opcodeStr = parts[0].toUpperCase();

        let opcode, rd = null, rs1 = null, rs2 = null, imm = null, label = null;

        try {
            switch (opcodeStr) {
                case 'ADD':
                case 'SUB':
                case 'MUL':
                case 'DIV':
                case 'AND':
                case 'OR':
                case 'XOR':
                case 'SLT':
                    if (parts.length !== 4) throw new Error(`Expected 3 operands for ${opcodeStr}`);
                    opcode = Opcode[opcodeStr];
                    rd = parseRegister(parts[1]);
                    rs1 = parseRegister(parts[2]);
                    // Check if 3rd operand is an immediate (e.g. ADD R1, R1, 10)
                    if (/^[+-]?\d+|^#?[+-]?\d+|^0x[0-9a-fA-F]+/i.test(parts[3])) {
                        imm = parseImmediate(parts[3]);
                        rs2 = null;
                        if (opcode === Opcode.ADD) opcode = Opcode.ADDI;
                    } else {
                        rs2 = parseRegister(parts[3]);
                    }
                    break;

                case 'ADDI':
                    if (parts.length !== 4) throw new Error(`Expected 3 operands for ADDI: Rd, Rs1, imm`);
                    opcode = Opcode.ADDI;
                    rd = parseRegister(parts[1]);
                    rs1 = parseRegister(parts[2]);
                    imm = parseImmediate(parts[3]);
                    break;

                case 'SLL':
                case 'SRL':
                    if (parts.length !== 4) throw new Error(`Expected 3 operands for ${opcodeStr}: Rd, Rs1, shamt`);
                    opcode = Opcode[opcodeStr];
                    rd = parseRegister(parts[1]);
                    rs1 = parseRegister(parts[2]);
                    imm = parseImmediate(parts[3]);
                    break;

                case 'LD':
                    if (parts.length !== 3) throw new Error(`Expected 2 operands for LD: Rd, [Rs1]`);
                    opcode = Opcode.LD;
                    rd = parseRegister(parts[1]);
                    const memOpLD = parseMemoryOperand(parts[2]);
                    rs1 = memOpLD.reg;
                    imm = memOpLD.offset;
                    break;

                case 'ST':
                    if (parts.length !== 3) throw new Error(`Expected 2 operands for ST: [Rd], Rs1`);
                    opcode = Opcode.ST;
                    const memOpST = parseMemoryOperand(parts[1]);
                    rd = memOpST.reg;       // address register
                    imm = memOpST.offset;   // address offset
                    rs1 = parseRegister(parts[2]); // data to store
                    break;

                case 'BEQ':
                case 'BNE':
                case 'BLT':
                case 'BGE':
                    if (parts.length !== 4) throw new Error(`Expected 3 operands for ${opcodeStr}: Rs1, Rs2, label`);
                    opcode = Opcode[opcodeStr];
                    rs1 = parseRegister(parts[1]);
                    rs2 = parseRegister(parts[2]);
                    label = parts[3];
                    break;

                case 'J':
                    if (parts.length !== 2) throw new Error(`Expected 1 operand for J: label`);
                    opcode = Opcode.J;
                    label = parts[1];
                    break;

                case 'JAL':
                    if (parts.length === 2) {
                        opcode = Opcode.JAL;
                        rd = 7; // default link register
                        label = parts[1];
                    } else if (parts.length === 3) {
                        opcode = Opcode.JAL;
                        rd = parseRegister(parts[1]);
                        label = parts[2];
                    } else {
                        throw new Error(`Expected JAL label or JAL Rd, label`);
                    }
                    break;

                case 'JR':
                    if (parts.length !== 2) throw new Error(`Expected 1 operand for JR: Rs1`);
                    opcode = Opcode.JR;
                    rs1 = parseRegister(parts[1]);
                    break;

                case 'DIV_IF':
                    if (parts.length !== 2) throw new Error(`Expected 1 operand for DIV_IF`);
                    opcode = Opcode.DIV_IF;
                    rd = parseRegister(parts[1]);
                    break;

                case 'NOP':
                    if (parts.length !== 1) throw new Error(`Expected 0 operands for NOP`);
                    opcode = Opcode.NOP;
                    break;

                case 'HALT':
                    if (parts.length !== 1) throw new Error(`Expected 0 operands for HALT`);
                    opcode = Opcode.HALT;
                    break;

                default:
                    throw new Error(`Unknown instruction: ${opcodeStr}`);
            }
        } catch (e) {
            throw new Error(`Line ${i + 1}: ${e.message}`);
        }

        const machineCode = encodeMachineCode(opcode, rd, rs1, rs2, imm, null);
        instructions.push(createInstruction(opcode, rd, rs1, rs2, label, i, originalLine, imm, machineCode, instructionIndex));
        instructionIndex++;
    }

    return { instructions, labels };
}

/**
 * Resolves labels in instructions to their target instruction indices.
 * @param {Object[]} instructions
 * @param {Object<string, number>} labels
 * @returns {Object[]} A new array of instructions with resolved branch targets.
 */
export function resolveLabels(instructions, labels) {
    return instructions.map(inst => {
        if (inst.label !== null) {
            if (!labels.hasOwnProperty(inst.label)) {
                throw new Error(`Line ${inst.line + 1}: Undefined label: ${inst.label}`);
            }
            const targetIndex = labels[inst.label];
            const machineCode = encodeMachineCode(inst.opcode, inst.rd, inst.rs1, inst.rs2, inst.imm, targetIndex);
            return createInstruction(
                inst.opcode,
                inst.rd,
                inst.rs1,
                inst.rs2,
                targetIndex,
                inst.line,
                inst.raw,
                inst.imm,
                machineCode,
                inst.index
            );
        }
        return inst;
    });
}
