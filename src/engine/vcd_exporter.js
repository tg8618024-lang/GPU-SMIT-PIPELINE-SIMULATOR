// ──────────────────────────────────────────────────────────────────────────────
// SIMT-Flow: VCD (Value Change Dump) Waveform Exporter
// ──────────────────────────────────────────────────────────────────────────────
// Generates standard IEEE 1364 VCD files from pipeline simulation history.
// VCD files can be opened in GTKWave, ModelSim, or any waveform viewer —
// proving to ASIC/RTL interviewers that you think like a verification engineer.
//
// Signals exported:
//   CPU Mode:
//     - clk          : Clock signal (toggles 0/1 each half-cycle)
//     - pc[7:0]      : Program Counter
//     - if_valid      : IF stage has a valid instruction
//     - id_valid      : ID stage valid
//     - ex_valid      : EX stage valid
//     - mem_valid     : MEM stage valid
//     - wb_valid      : WB stage valid
//     - stall         : Pipeline stall signal
//     - flush         : Pipeline flush signal
//     - fwd_a[1:0]    : Forward mux A selection
//     - fwd_b[1:0]    : Forward mux B selection
//     - hazard[2:0]   : Active hazard type encoding
//     - R0..R7        : Register file contents
//
//   GPU Mode:
//     - clk           : Clock
//     - active_warp[1:0] : Currently scheduled warp ID
//     - w0_state..w3_state : Warp states
//     - w0_pc..w3_pc  : Warp PCs
//     - w0_mask..w3_mask : Active masks (8-bit)
//     - scoreboard[7:0] : Combined scoreboard busy bits
// ──────────────────────────────────────────────────────────────────────────────

import { HazardType, ForwardSrc, WarpState } from './types.js';

// ─── Hazard Type → VCD Encoding ─────────────────────────────────────────────
const HAZARD_ENCODING = {
    [HazardType.NONE]:       0,
    [HazardType.RAW]:        1,
    [HazardType.LOAD_USE]:   2,
    [HazardType.CONTROL]:    3,
    [HazardType.STRUCTURAL]: 4,
};

// ─── Warp State → VCD Encoding ──────────────────────────────────────────────
const WARP_STATE_ENCODING = {
    [WarpState.READY]:    0,
    [WarpState.RUNNING]:  1,
    [WarpState.STALLED]:  2,
    [WarpState.DIVERGED]: 3,
    [WarpState.FINISHED]: 4,
};

/**
 * Convert an integer to a VCD binary string of given width.
 * @param {number} value
 * @param {number} width - Number of bits
 * @returns {string} e.g. "b01010101"
 */
function toBinaryVCD(value, width) {
    const unsigned = value >>> 0; // ensure unsigned
    const bits = unsigned.toString(2).padStart(width, '0').slice(-width);
    return `b${bits}`;
}

/**
 * Generate a VCD file string from CPU pipeline history.
 * @param {CPUSnapshot[]} history - Array of CPU snapshots
 * @returns {string} Complete VCD file content
 */
export function exportCPUtoVCD(history) {
    if (!history || history.length === 0) {
        return ''; 
    }

    const lines = [];
    const timescale = '1ns';
    const date = new Date().toISOString();

    // ─── VCD Header ─────────────────────────────────────────────────────
    lines.push('$date');
    lines.push(`  ${date}`);
    lines.push('$end');
    lines.push('$version');
    lines.push('  SIMT-Flow CPU Pipeline Simulator v1.0');
    lines.push('$end');
    lines.push(`$timescale ${timescale} $end`);
    lines.push('');

    // ─── Variable Definitions ───────────────────────────────────────────
    lines.push('$scope module cpu_pipeline $end');
    lines.push('  $var wire 1 ! clk $end');
    lines.push('  $var wire 8 # pc [7:0] $end');
    lines.push('  $var wire 1 A if_valid $end');
    lines.push('  $var wire 1 B id_valid $end');
    lines.push('  $var wire 1 C ex_valid $end');
    lines.push('  $var wire 1 D mem_valid $end');
    lines.push('  $var wire 1 E wb_valid $end');
    lines.push('  $var wire 1 F stall $end');
    lines.push('  $var wire 1 G flush $end');
    lines.push('  $var wire 2 H fwd_a [1:0] $end');
    lines.push('  $var wire 2 I fwd_b [1:0] $end');
    lines.push('  $var wire 3 J hazard [2:0] $end');

    // Register file
    const regSymbols = ['K', 'L', 'M', 'N', 'O', 'P', 'Q', 'S'];
    for (let i = 0; i < 8; i++) {
        lines.push(`  $var wire 32 ${regSymbols[i]} R${i} [31:0] $end`);
    }

    lines.push('$upscope $end');
    lines.push('$enddefinitions $end');
    lines.push('');

    // ─── Initial Values ─────────────────────────────────────────────────
    lines.push('#0');
    lines.push('0!');  // clk = 0
    lines.push(`${toBinaryVCD(0, 8)} #`);
    lines.push('0A'); lines.push('0B'); lines.push('0C');
    lines.push('0D'); lines.push('0E');
    lines.push('0F'); lines.push('0G');
    lines.push(`${toBinaryVCD(0, 2)} H`);
    lines.push(`${toBinaryVCD(0, 2)} I`);
    lines.push(`${toBinaryVCD(0, 3)} J`);
    for (let i = 0; i < 8; i++) {
        lines.push(`${toBinaryVCD(0, 32)} ${regSymbols[i]}`);
    }
    lines.push('');

    // ─── Value Changes Per Cycle ────────────────────────────────────────
    for (let c = 0; c < history.length; c++) {
        const snap = history[c];
        const t = (c + 1) * 10;  // Each cycle = 10 time units

        // Rising edge
        lines.push(`#${t}`);
        lines.push('1!');

        // PC
        lines.push(`${toBinaryVCD(snap.pc, 8)} #`);

        // Stage valids
        lines.push(`${snap.IF_ID.valid ? '1' : '0'}A`);
        lines.push(`${snap.ID_EX.valid ? '1' : '0'}B`);
        lines.push(`${snap.EX_MEM.valid ? '1' : '0'}C`);
        lines.push(`${snap.MEM_WB.valid ? '1' : '0'}D`);
        // WB valid = MEM_WB was valid (it completes this cycle)
        lines.push(`${snap.MEM_WB.valid && snap.MEM_WB.regWrite ? '1' : '0'}E`);

        // Control signals
        lines.push(`${snap.stall ? '1' : '0'}F`);
        lines.push(`${snap.flush ? '1' : '0'}G`);
        lines.push(`${toBinaryVCD(snap.forwardA, 2)} H`);
        lines.push(`${toBinaryVCD(snap.forwardB, 2)} I`);
        lines.push(`${toBinaryVCD(HAZARD_ENCODING[snap.hazard] || 0, 3)} J`);

        // Register file
        for (let i = 0; i < 8; i++) {
            const val = snap.registers[i] || 0;
            lines.push(`${toBinaryVCD(val, 32)} ${regSymbols[i]}`);
        }

        // Falling edge
        lines.push(`#${t + 5}`);
        lines.push('0!');
        lines.push('');
    }

    return lines.join('\n');
}

/**
 * Generate a VCD file string from GPU pipeline history.
 * @param {GPUSnapshot[]} history - Array of GPU snapshots
 * @returns {string} Complete VCD file content
 */
export function exportGPUtoVCD(history) {
    if (!history || history.length === 0) {
        return '';
    }

    const lines = [];
    const date = new Date().toISOString();

    // ─── VCD Header ─────────────────────────────────────────────────────
    lines.push('$date');
    lines.push(`  ${date}`);
    lines.push('$end');
    lines.push('$version');
    lines.push('  SIMT-Flow GPU SM Pipeline Simulator v1.0');
    lines.push('$end');
    lines.push('$timescale 1ns $end');
    lines.push('');

    // ─── Variable Definitions ───────────────────────────────────────────
    lines.push('$scope module gpu_sm $end');
    lines.push('  $var wire 1 ! clk $end');
    lines.push('  $var wire 2 # active_warp [1:0] $end');

    const warpSymStart = 'A';
    for (let w = 0; w < 4; w++) {
        const base = warpSymStart.charCodeAt(0) + w * 3;
        lines.push(`  $var wire 3 ${String.fromCharCode(base)} w${w}_state [2:0] $end`);
        lines.push(`  $var wire 8 ${String.fromCharCode(base + 1)} w${w}_pc [7:0] $end`);
        lines.push(`  $var wire 8 ${String.fromCharCode(base + 2)} w${w}_mask [7:0] $end`);
    }

    // Scoreboard (combined: OR of all warps' busy registers)
    lines.push('  $var wire 8 Z scoreboard [7:0] $end');
    lines.push('$upscope $end');
    lines.push('$enddefinitions $end');
    lines.push('');

    // ─── Initial Values ─────────────────────────────────────────────────
    lines.push('#0');
    lines.push('0!');
    lines.push(`${toBinaryVCD(0, 2)} #`);
    for (let w = 0; w < 4; w++) {
        const base = warpSymStart.charCodeAt(0) + w * 3;
        lines.push(`${toBinaryVCD(0, 3)} ${String.fromCharCode(base)}`);
        lines.push(`${toBinaryVCD(0, 8)} ${String.fromCharCode(base + 1)}`);
        lines.push(`${toBinaryVCD(0xFF, 8)} ${String.fromCharCode(base + 2)}`);
    }
    lines.push(`${toBinaryVCD(0, 8)} Z`);
    lines.push('');

    // ─── Value Changes ──────────────────────────────────────────────────
    for (let c = 0; c < history.length; c++) {
        const snap = history[c];
        const t = (c + 1) * 10;

        lines.push(`#${t}`);
        lines.push('1!');

        // Active warp
        const activeWarp = snap.schedulerChoice ?? 0;
        lines.push(`${toBinaryVCD(activeWarp, 2)} #`);

        // Per-warp signals
        for (let w = 0; w < 4 && w < snap.warps.length; w++) {
            const warp = snap.warps[w];
            const base = warpSymStart.charCodeAt(0) + w * 3;
            lines.push(`${toBinaryVCD(WARP_STATE_ENCODING[warp.state] || 0, 3)} ${String.fromCharCode(base)}`);
            lines.push(`${toBinaryVCD(warp.pc, 8)} ${String.fromCharCode(base + 1)}`);
            lines.push(`${toBinaryVCD(warp.activeMask, 8)} ${String.fromCharCode(base + 2)}`);
        }

        // Scoreboard: combine all warps' busy registers into a single bitmask
        let scoreboardBits = 0;
        for (const [, busySet] of Object.entries(snap.scoreboard)) {
            for (const reg of busySet) {
                scoreboardBits |= (1 << reg);
            }
        }
        lines.push(`${toBinaryVCD(scoreboardBits, 8)} Z`);

        // Falling edge
        lines.push(`#${t + 5}`);
        lines.push('0!');
        lines.push('');
    }

    return lines.join('\n');
}

/**
 * Trigger a browser download of a VCD file.
 * @param {string} vcdContent - The VCD file content string
 * @param {string} filename - Download filename (e.g., 'cpu_trace.vcd')
 */
export function downloadVCD(vcdContent, filename = 'simt_flow_trace.vcd') {
    const blob = new Blob([vcdContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
