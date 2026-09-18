// ──────────────────────────────────────────────────────────────────────────────
// SIMT-Flow: L1 Cache Hierarchy Engine
// ──────────────────────────────────────────────────────────────────────────────
// Models a cycle-accurate L1 Instruction Cache (L1-I) and L1 Data Cache (L1-D)
// with configurable associativity (Direct-Mapped or 2-Way Set-Associative),
// address decomposition (Tag, Set Index, Block Offset), replacement policies,
// write policies (Write-Through / Write-Back), and miss penalty stall bubbles.
// ──────────────────────────────────────────────────────────────────────────────

import { CacheType, WritePolicy, MissType, createCacheBlock } from './types.js';

export class L1Cache {
    /**
     * @param {object} options
     * @param {string} options.name - 'L1-I' or 'L1-D'
     * @param {string} options.cacheType - CacheType.DIRECT_MAPPED or CacheType.TWO_WAY_SET
     * @param {number} options.numSets - Number of sets (default 8)
     * @param {number} options.blockSize - Words per block (default 4)
     * @param {string} options.writePolicy - WritePolicy.WRITE_THROUGH or WritePolicy.WRITE_BACK
     * @param {number} options.missPenalty - Stall cycles on cache miss (default 4)
     */
    constructor(options = {}) {
        this.name = options.name || 'L1-D';
        this.cacheType = options.cacheType || CacheType.DIRECT_MAPPED;
        this.numSets = options.numSets || 8;
        this.blockSize = options.blockSize || 4; // words per cache line
        this.associativity = this.cacheType === CacheType.TWO_WAY_SET ? 2 : 1;
        this.writePolicy = options.writePolicy || WritePolicy.WRITE_THROUGH;
        this.missPenalty = options.missPenalty !== undefined ? options.missPenalty : 4;
        this.enabled = true;

        // Bit widths for word-level addresses
        this.offsetBits = Math.log2(this.blockSize);
        this.indexBits = Math.log2(this.numSets);

        this.reset();
    }

    /**
     * Reset cache state and performance counters.
     */
    reset() {
        // Sets array: each set contains 'associativity' blocks
        this.sets = Array.from({ length: this.numSets }, () =>
            Array.from({ length: this.associativity }, () =>
                createCacheBlock(null, new Array(this.blockSize).fill(0), false, false)
            )
        );

        // Telemetry
        this.accessCount = 0;
        this.hitCount = 0;
        this.missCount = 0;
        this.coldMisses = 0;
        this.conflictMisses = 0;
        this.capacityMisses = 0;

        // In-flight miss stall state
        this.stallRemaining = 0;
        this.pendingAccess = null;
        this.lastAccessResult = null;
    }

    get hits() {
        return this.hitCount;
    }

    get misses() {
        return this.missCount;
    }

    /**
     * Decompose a 32-bit word address into { tag, index, offset, blockAddress }.
     * @param {number} wordAddress - Address in words (byteAddr >> 2 or direct word address)
     */
    decodeAddress(wordAddress) {
        const addr = wordAddress >>> 0;
        const offsetMask = (1 << this.offsetBits) - 1;
        const offset = addr & offsetMask;

        const indexMask = (1 << this.indexBits) - 1;
        const index = (addr >>> this.offsetBits) & indexMask;

        const tag = addr >>> (this.offsetBits + this.indexBits);
        const blockAddress = (addr >>> this.offsetBits) << this.offsetBits;

        return { tag, index, offset, blockAddress };
    }

    /**
     * Perform a cache access (Read or Write).
     * @param {number} address - Word address
     * @param {boolean} isWrite - True if store, false if load/fetch
     * @param {number} writeData - Value to write (if isWrite)
     * @param {number} currentCycle - Current CPU clock cycle
     * @param {Array<number>} backingMemory - Main memory array
     * @returns {object} Access result { hit, missType, data, tag, index, offset, stallCycles }
     */
    access(address, isWrite = false, writeData = 0, currentCycle = 0, backingMemory = null) {
        if (!this.enabled) {
            // Bypass mode: always 1-cycle hit to memory
            const val = backingMemory ? (backingMemory[address] ?? 0) : 0;
            if (isWrite && backingMemory) {
                backingMemory[address] = writeData;
            }
            return {
                hit: true,
                missType: MissType.NONE,
                data: val,
                tag: 0,
                index: 0,
                offset: 0,
                stallCycles: 0,
                bypassed: true,
            };
        }

        const { tag, index, offset, blockAddress } = this.decodeAddress(address);
        const targetSet = this.sets[index];

        this.accessCount++;

        // 1. Check for Hit across all ways in this set
        let hitWay = -1;
        for (let way = 0; way < this.associativity; way++) {
            const block = targetSet[way];
            if (block.valid && block.tag === tag) {
                hitWay = way;
                break;
            }
        }

        if (hitWay !== -1) {
            // ─── CACHE HIT ─────────────────────────────────────────────
            this.hitCount++;
            const block = targetSet[hitWay];
            block.lastAccessedCycle = currentCycle;

            let resultData = block.data[offset];

            if (isWrite) {
                block.data[offset] = writeData;
                resultData = writeData;

                if (this.writePolicy === WritePolicy.WRITE_THROUGH) {
                    if (backingMemory && address >= 0 && address < backingMemory.length) {
                        backingMemory[address] = writeData;
                    }
                } else {
                    block.dirty = true;
                }
            }

            const res = {
                hit: true,
                missType: MissType.NONE,
                data: resultData,
                tag,
                index,
                offset,
                way: hitWay,
                stallCycles: 0,
            };
            this.lastAccessResult = res;
            return res;
        }

        // ─── CACHE MISS ────────────────────────────────────────────────
        this.missCount++;

        // Classify Miss Type
        let missType = MissType.COLD;
        const allBlocksValidInSet = targetSet.every(b => b.valid);
        if (allBlocksValidInSet) {
            // If all blocks in this set are already occupied, it's a conflict or capacity miss
            missType = (this.associativity === 1) ? MissType.CONFLICT : MissType.CAPACITY;
            if (missType === MissType.CONFLICT) this.conflictMisses++;
            else this.capacityMisses++;
        } else {
            this.coldMisses++;
        }

        // Select replacement victim way (LRU)
        let victimWay = 0;
        let oldestCycle = Infinity;
        for (let way = 0; way < this.associativity; way++) {
            const block = targetSet[way];
            if (!block.valid) {
                victimWay = way;
                break; // Empty line found, allocate immediately
            }
            if (block.lastAccessedCycle < oldestCycle) {
                oldestCycle = block.lastAccessedCycle;
                victimWay = way;
            }
        }

        const victim = targetSet[victimWay];

        // If victim is dirty (Write-Back policy), write it back to memory
        if (victim.valid && victim.dirty && this.writePolicy === WritePolicy.WRITE_BACK && backingMemory) {
            const victimBaseAddr = ((victim.tag << (this.offsetBits + this.indexBits)) | (index << this.offsetBits)) >>> 0;
            for (let i = 0; i < this.blockSize; i++) {
                const memAddr = victimBaseAddr + i;
                if (memAddr >= 0 && memAddr < backingMemory.length) {
                    backingMemory[memAddr] = victim.data[i];
                }
            }
        }

        // Fetch new block from backing memory
        const newBlockData = new Array(this.blockSize).fill(0);
        if (backingMemory) {
            for (let i = 0; i < this.blockSize; i++) {
                const memAddr = blockAddress + i;
                if (memAddr >= 0 && memAddr < backingMemory.length) {
                    newBlockData[i] = backingMemory[memAddr];
                }
            }
        }

        // If this access was a write, modify the word in cache
        let resultData = newBlockData[offset];
        let isDirty = false;

        if (isWrite) {
            newBlockData[offset] = writeData;
            resultData = writeData;

            if (this.writePolicy === WritePolicy.WRITE_THROUGH) {
                if (backingMemory && address >= 0 && address < backingMemory.length) {
                    backingMemory[address] = writeData;
                }
            } else {
                isDirty = true;
            }
        }

        // Install new block in cache
        victim.valid = true;
        victim.tag = tag;
        victim.data = newBlockData;
        victim.dirty = isDirty;
        victim.lastAccessedCycle = currentCycle;

        const res = {
            hit: false,
            missType,
            data: resultData,
            tag,
            index,
            offset,
            way: victimWay,
            stallCycles: this.missPenalty,
        };
        this.lastAccessResult = res;
        return res;
    }

    /**
     * Return immutable snapshot for visualization.
     */
    getSnapshot() {
        const hitRate = this.accessCount > 0 ? (this.hitCount / this.accessCount) * 100 : 0;
        return {
            name: this.name,
            cacheType: this.cacheType,
            writePolicy: this.writePolicy,
            associativity: this.associativity,
            numSets: this.numSets,
            blockSize: this.blockSize,
            missPenalty: this.missPenalty,
            enabled: this.enabled,
            accessCount: this.accessCount,
            hitCount: this.hitCount,
            missCount: this.missCount,
            hitRate: hitRate.toFixed(1),
            coldMisses: this.coldMisses,
            conflictMisses: this.conflictMisses,
            capacityMisses: this.capacityMisses,
            lastAccessResult: this.lastAccessResult ? { ...this.lastAccessResult } : null,
            sets: this.sets.map((set, setIdx) => ({
                setIndex: setIdx,
                ways: set.map((block, wayIdx) => ({
                    wayIndex: wayIdx,
                    valid: block.valid,
                    dirty: block.dirty,
                    tag: block.tag !== null ? '0x' + block.tag.toString(16).toUpperCase() : '—',
                    tagRaw: block.tag,
                    data: [...block.data],
                    lastAccessedCycle: block.lastAccessedCycle,
                })),
            })),
        };
    }
}
