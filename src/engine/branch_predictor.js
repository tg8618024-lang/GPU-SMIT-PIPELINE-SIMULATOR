// ──────────────────────────────────────────────────────────────────────────────
// SIMT-Flow: Dynamic Branch Predictor & Branch Target Buffer (BTB) Engine
// ──────────────────────────────────────────────────────────────────────────────
// Implements:
//   1. 2-Bit Saturating Counter FSM:
//      - 0b00: Strongly Not Taken
//      - 0b01: Weakly Not Taken
//      - 0b10: Weakly Taken
//      - 0b11: Strongly Taken
//   2. Branch Target Buffer (BTB):
//      - Direct-mapped cache storing predicted target PC indexed by branch PC
//   3. Speculative execution metrics (Total, Hits, Mispredictions, Accuracy %)
// ──────────────────────────────────────────────────────────────────────────────

import { BranchPredictorType, PredictorState, createBTBEntry } from './types.js';

export class BranchPredictor {
    /**
     * @param {object} options
     * @param {string} options.type - BranchPredictorType.DYNAMIC_2BIT or STATIC
     * @param {number} options.btbEntries - Number of BTB entries (default 16)
     */
    constructor(options = {}) {
        this.type = options.type || BranchPredictorType.DYNAMIC_2BIT;
        this.numEntries = options.btbEntries || 16;
        this.enabled = true;

        this.reset();
    }

    /**
     * Reset predictor counters and clear BTB cache.
     */
    reset() {
        this.btb = Array.from({ length: this.numEntries }, () => createBTBEntry(0, 0, false));

        // Global telemetry
        this.totalPredictions = 0;
        this.correctPredictions = 0;
        this.mispredictions = 0;
        this.lastPrediction = null;
        this.lastUpdate = null;
    }

    /**
     * Predict whether a branch at PC will be taken and what its target is.
     * Called during the IF stage.
     * @param {number} pc - Current instruction PC (byte address)
     * @returns {object} { predictedTaken, targetPC, state, btbHit }
     */
    predict(pc) {
        if (!this.enabled || this.type === BranchPredictorType.STATIC) {
            // Static prediction: Always predict Not-Taken (fall-through PC+4)
            const result = {
                predictedTaken: false,
                targetPC: pc + 4,
                state: PredictorState.WEAKLY_NOT_TAKEN,
                btbHit: false,
            };
            this.lastPrediction = result;
            return result;
        }

        const index = (pc >>> 2) % this.numEntries;
        const entry = this.btb[index];

        if (entry.valid && entry.tag === pc) {
            // BTB Hit: predict based on 2-bit counter
            const predictedTaken = entry.state >= PredictorState.WEAKLY_TAKEN;
            const targetPC = predictedTaken ? entry.targetPC : pc + 4;

            const result = {
                predictedTaken,
                targetPC,
                state: entry.state,
                btbHit: true,
                index,
            };
            this.totalPredictions++;
            this.lastPrediction = result;
            return result;
        }

        // BTB Miss: default to fall-through (Not Taken)
        const result = {
            predictedTaken: false,
            targetPC: pc + 4,
            state: PredictorState.WEAKLY_NOT_TAKEN,
            btbHit: false,
            index,
        };
        this.totalPredictions++;
        this.lastPrediction = result;
        return result;
    }

    /**
     * Update the 2-bit saturating counter and BTB entry when branch resolves.
     * Called during the ID/EX stage.
     * @param {number} pc - Branch instruction PC
     * @param {boolean} actualTaken - True if branch condition was met
     * @param {number} actualTarget - Actual resolved target PC
     * @param {boolean} wasPredictedTaken - What the IF stage predicted
     */
    update(pc, actualTaken, actualTarget, wasPredictedTaken = false) {
        if (!this.enabled) return;

        const isCorrect = actualTaken === wasPredictedTaken;
        if (isCorrect) {
            this.correctPredictions++;
        } else {
            this.mispredictions++;
        }

        const index = (pc >>> 2) % this.numEntries;
        const entry = this.btb[index];

        // 2-bit saturating counter transition
        let nextState = entry.valid && entry.tag === pc ? entry.state : PredictorState.WEAKLY_TAKEN;

        if (actualTaken) {
            nextState = Math.min(PredictorState.STRONGLY_TAKEN, nextState + 1);
        } else {
            nextState = Math.max(PredictorState.STRONGLY_NOT_TAKEN, nextState - 1);
        }

        // Update BTB entry
        entry.valid = true;
        entry.tag = pc;
        entry.targetPC = actualTarget;
        entry.state = nextState;

        this.lastUpdate = {
            pc,
            actualTaken,
            actualTarget,
            wasPredictedTaken,
            isCorrect,
            newState: nextState,
            index,
        };
    }

    /**
     * Get snapshot for visualization.
     */
    getSnapshot() {
        const accuracy = this.totalPredictions > 0
            ? ((this.correctPredictions / this.totalPredictions) * 100).toFixed(1)
            : '100.0';

        return {
            type: this.type,
            enabled: this.enabled,
            totalPredictions: this.totalPredictions,
            correctPredictions: this.correctPredictions,
            mispredictions: this.mispredictions,
            accuracyPct: accuracy,
            lastPrediction: this.lastPrediction ? { ...this.lastPrediction } : null,
            lastUpdate: this.lastUpdate ? { ...this.lastUpdate } : null,
            btb: this.btb.map((e, idx) => ({
                index: idx,
                tag: e.valid ? '0x' + e.tag.toString(16).toUpperCase().padStart(4, '0') : '—',
                tagRaw: e.tag,
                targetPC: e.valid ? '0x' + e.targetPC.toString(16).toUpperCase().padStart(4, '0') : '—',
                targetRaw: e.targetPC,
                valid: e.valid,
                state: e.state,
                stateLabel: this._getStateLabel(e.state),
            })),
        };
    }

    _getStateLabel(state) {
        switch (state) {
            case PredictorState.STRONGLY_NOT_TAKEN: return '00: Strongly Not Taken';
            case PredictorState.WEAKLY_NOT_TAKEN:   return '01: Weakly Not Taken';
            case PredictorState.WEAKLY_TAKEN:       return '10: Weakly Taken';
            case PredictorState.STRONGLY_TAKEN:     return '11: Strongly Taken';
            default: return '01: Weakly Not Taken';
        }
    }
}
