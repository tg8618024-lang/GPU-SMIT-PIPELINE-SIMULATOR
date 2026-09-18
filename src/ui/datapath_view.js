// ──────────────────────────────────────────────────────────────────────────────
// SIMT-Flow: Interactive CPU Datapath Schematic (SVG Engine v2.5)
// ──────────────────────────────────────────────────────────────────────────────
// Renders the live 5-stage CPU datapath:
//   - PC & PC+4 Adder
//   - Instruction Memory
//   - IF/ID Pipeline Register (Latch)
//   - Register File & Hazard Detection Unit
//   - ID/EX Pipeline Register (Latch)
//   - Forwarding Unit & ALU Bypass Multiplexers (MUX A, MUX B)
//   - Arithmetic Logic Unit (ALU)
//   - EX/MEM Pipeline Register (Latch)
//   - Data Memory
//   - MEM/WB Pipeline Register (Latch)
//   - Write Back Path to Register File
//
// Advanced features:
//   - Animated electron flow on active buses with keyframe dashFlow
//   - Hardware SVG glowing filters (Emerald, Cyan, Amber, Crimson)
//   - Active MUX selection indicators (00: Reg, 10: EX/MEM, 01: MEM/WB)
//   - Interactive block inspection overlay displaying live signals & RTL logic
//   - Zero-zoom responsive SVG architecture with high-contrast typography
// ──────────────────────────────────────────────────────────────────────────────

import { ForwardSrc, HazardType } from '../engine/types.js';

export class DatapathView {
    /**
     * @param {HTMLElement} containerElement
     * @param {Function} onStageClick - Callback when a stage block is clicked
     */
    constructor(containerElement, onStageClick = null) {
        this.container = containerElement;
        this.onStageClick = onStageClick;
        this.svgNS = 'http://www.w3.org/2000/svg';
        this.elements = {};
        this.lastSnapshot = null;

        this._initSVG();
    }

    _initSVG() {
        this.container.innerHTML = '';

        this.svg = document.createElementNS(this.svgNS, 'svg');
        this.svg.setAttribute('viewBox', '0 0 1200 520');
        this.svg.setAttribute('width', '100%');
        this.svg.setAttribute('height', '100%');
        this.svg.classList.add('datapath-svg');

        // Layout Constants
        const blockW = 105;
        const blockH = 120;
        const regW = 24;
        const regH = 260;

        const blockStyle = "fill: #111827; stroke: #374151; stroke-width: 2px; rx: 8px;";
        const regStyle = "fill: url(#grad-latch); stroke: #4b5563; stroke-width: 2px; rx: 5px;";
        const textStyle = "font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 600; text-anchor: middle; dominant-baseline: middle; fill: #f3f4f6;";
        const subtextStyle = "font-family: 'Inter', sans-serif; font-size: 10px; font-weight: 500; text-anchor: middle; dominant-baseline: middle; fill: #9ca3af;";
        const muxSelStyle = "font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 700; fill: #10b981;";

        // ─── SVG DEFS (Filters, Gradients, Arrows) ───────────────────────────
        const defs = document.createElementNS(this.svgNS, 'defs');
        defs.innerHTML = `
            <!-- Glow Filters -->
            <filter id="glow-green" x="-25%" y="-25%" width="150%" height="150%">
                <feGaussianBlur stdDeviation="3.5" result="blur"/>
                <feMerge>
                    <feMergeNode in="blur"/>
                    <feMergeNode in="SourceGraphic"/>
                </feMerge>
            </filter>
            <filter id="glow-cyan" x="-25%" y="-25%" width="150%" height="150%">
                <feGaussianBlur stdDeviation="3.5" result="blur"/>
                <feMerge>
                    <feMergeNode in="blur"/>
                    <feMergeNode in="SourceGraphic"/>
                </feMerge>
            </filter>
            <filter id="glow-amber" x="-25%" y="-25%" width="150%" height="150%">
                <feGaussianBlur stdDeviation="3.5" result="blur"/>
                <feMerge>
                    <feMergeNode in="blur"/>
                    <feMergeNode in="SourceGraphic"/>
                </feMerge>
            </filter>
            <filter id="glow-red" x="-25%" y="-25%" width="150%" height="150%">
                <feGaussianBlur stdDeviation="4" result="blur"/>
                <feMerge>
                    <feMergeNode in="blur"/>
                    <feMergeNode in="SourceGraphic"/>
                </feMerge>
            </filter>

            <!-- Latch Linear Gradients -->
            <linearGradient id="grad-latch" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#1f2937"/>
                <stop offset="50%" stop-color="#111827"/>
                <stop offset="100%" stop-color="#0f172a"/>
            </linearGradient>
            <linearGradient id="grad-alu" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#111827"/>
                <stop offset="100%" stop-color="#1e293b"/>
            </linearGradient>

            <!-- Wire Directional Arrow Markers -->
            <marker id="arrow-green" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#10b981"/>
            </marker>
            <marker id="arrow-cyan" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#06b6d4"/>
            </marker>
            <marker id="arrow-amber" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#f59e0b"/>
            </marker>
            <marker id="arrow-blue" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#3b82f6"/>
            </marker>
        `;
        this.svg.appendChild(defs);

        const createRect = (id, x, y, w, h, style, title = '', stageHint = '') => {
            const rect = document.createElementNS(this.svgNS, 'rect');
            rect.setAttribute('x', x);
            rect.setAttribute('y', y);
            rect.setAttribute('width', w);
            rect.setAttribute('height', h);
            rect.setAttribute('style', style);
            rect.setAttribute('id', id);
            rect.classList.add('datapath-block');
            if (stageHint) {
                rect.setAttribute('data-stage', stageHint);
                rect.style.cursor = 'pointer';
                rect.addEventListener('click', () => {
                    this._handleBlockClick(id, title, stageHint);
                });
            }
            return rect;
        };

        const createText = (id, x, y, text, style = textStyle) => {
            const t = document.createElementNS(this.svgNS, 'text');
            t.setAttribute('x', x);
            t.setAttribute('y', y);
            t.setAttribute('style', style);
            t.setAttribute('id', id);
            t.textContent = text;
            return t;
        };

        const createWire = (id, d, isDashed = false) => {
            const path = document.createElementNS(this.svgNS, 'path');
            path.setAttribute('d', d);
            path.setAttribute('id', id);
            path.classList.add('datapath-wire');
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', '#374151');
            path.setAttribute('stroke-width', '2px');
            if (isDashed) {
                path.setAttribute('stroke-dasharray', '6,4');
            }
            return path;
        };

        const g = document.createElementNS(this.svgNS, 'g');

        // ─── 1. Core Hardware Functional Units ──────────────────────────────
        const pcBlock = createRect('block-pc', 30, 160, 60, 100, blockStyle, 'Program Counter (PC)', 'IF');
        const imem = createRect('block-imem', 120, 150, blockW, blockH, blockStyle, 'Instruction Memory', 'IF');
        const rf = createRect('block-rf', 280, 150, 110, blockH, blockStyle, 'Register File (8x 32-bit)', 'ID');

        // ALU polygon (Hennessy & Patterson chevron datapath block)
        const alu = document.createElementNS(this.svgNS, 'polygon');
        alu.setAttribute('points', '510,140 575,180 575,240 510,280 510,220 530,210 510,200');
        alu.setAttribute('style', "fill: url(#grad-alu); stroke: #374151; stroke-width: 2px;");
        alu.setAttribute('id', 'block-alu');
        alu.style.cursor = 'pointer';
        alu.addEventListener('click', () => {
            this._handleBlockClick('block-alu', 'Arithmetic Logic Unit (ALU)', 'EX');
        });

        const dmem = createRect('block-dmem', 740, 150, blockW, blockH, blockStyle, 'Data Memory (SRAM)', 'MEM');

        // Control units (Hazard Detection & Forwarding Units)
        const hdu = createRect('block-hdu', 285, 20, 100, 50, blockStyle, 'Hazard Detection Unit', 'ID');
        const fwu = createRect('block-fwu', 470, 20, 120, 50, blockStyle, 'Forwarding & Bypass Unit', 'EX');

        // ─── 2. Inter-Stage Pipeline Latches ───────────────────────────────
        const ifid = createRect('reg-ifid', 235, 80, regW, regH, regStyle, 'IF/ID Latch', 'IF');
        const idex = createRect('reg-idex', 415, 80, regW, regH, regStyle, 'ID/EX Latch', 'ID');
        const exmem = createRect('reg-exmem', 635, 80, regW, regH, regStyle, 'EX/MEM Latch', 'EX');
        const memwb = createRect('reg-memwb', 885, 80, regW, regH, regStyle, 'MEM/WB Latch', 'MEM');

        // Forwarding Bypass Multiplexers
        const muxA = document.createElementNS(this.svgNS, 'polygon');
        muxA.setAttribute('points', '460,150 480,160 480,190 460,200');
        muxA.setAttribute('style', blockStyle);
        muxA.setAttribute('id', 'mux-a');

        const muxB = document.createElementNS(this.svgNS, 'polygon');
        muxB.setAttribute('points', '460,220 480,230 480,260 460,270');
        muxB.setAttribute('style', blockStyle);
        muxB.setAttribute('id', 'mux-b');

        // ─── 3. Text Labels ────────────────────────────────────────────────
        const tPc = createText('text-pc', 60, 200, 'PC');
        const tImem = createText('text-imem', 172, 200, 'Inst Mem');
        const tRf = createText('text-rf', 335, 200, 'Reg File');
        const tAlu = createText('text-alu', 540, 210, 'ALU');
        const tDmem = createText('text-dmem', 792, 200, 'Data Mem');
        const tHdu = createText('text-hdu', 335, 45, 'Hazard Unit');
        const tFwu = createText('text-fwu', 530, 45, 'Forward Unit');

        const tIfid = createText('text-ifid', 247, 60, 'IF/ID', subtextStyle);
        const tIdex = createText('text-idex', 427, 60, 'ID/EX', subtextStyle);
        const tExmem = createText('text-exmem', 647, 60, 'EX/MEM', subtextStyle);
        const tMemwb = createText('text-memwb', 897, 60, 'MEM/WB', subtextStyle);

        // MUX Selection Indicators
        this.elements.muxASel = createText('muxa-sel-text', 470, 140, '00:Reg', muxSelStyle);
        this.elements.muxBSel = createText('muxb-sel-text', 470, 280, '00:Reg', muxSelStyle);

        // Dynamic status badge texts for each stage instruction
        this.elements.instIf = createText('inst-if', 172, 290, 'NOP', subtextStyle);
        this.elements.instId = createText('inst-id', 335, 290, 'NOP', subtextStyle);
        this.elements.instEx = createText('inst-ex', 540, 290, 'NOP', subtextStyle);
        this.elements.instMem = createText('inst-mem', 792, 290, 'NOP', subtextStyle);
        this.elements.instWb = createText('inst-wb', 980, 290, 'NOP', subtextStyle);

        // Hardware diagnostic notification banner inside datapath
        this.elements.banner = createText('datapath-banner', 600, 470, '', "font-family: 'JetBrains Mono', monospace; font-size: 14px; text-anchor: middle; font-weight: bold; fill: #10b981;");

        // Interactive HUD Tooltip Card on the Datapath
        this.elements.hudCard = createText('datapath-hud', 600, 500, '💡 Tip: Click any stage block (ALU, RegFile, Hazard Unit) to inspect internal RTL micro-ops', "font-family: 'Inter', sans-serif; font-size: 11px; text-anchor: middle; fill: #9ca3af;");

        // ─── 4. Signal Wires & Buses ───────────────────────────────────────
        const wPcToImem = createWire('wire-pc-imem', 'M 90 210 L 120 210');
        const wImemToIfid = createWire('wire-imem-ifid', 'M 225 210 L 235 210');
        const wIfidToRf = createWire('wire-ifid-rf', 'M 259 210 L 280 210');

        const wRfOutA = createWire('wire-rf-outa', 'M 390 175 L 415 175');
        const wRfOutB = createWire('wire-rf-outb', 'M 390 245 L 415 245');

        const wIdexToMuxA = createWire('wire-idex-muxa', 'M 439 175 L 460 175');
        const wIdexToMuxB = createWire('wire-idex-muxb', 'M 439 245 L 460 245');

        const wMuxAToAlu = createWire('wire-muxa-alu', 'M 480 175 L 510 175');
        const wMuxBToAlu = createWire('wire-muxb-alu', 'M 480 245 L 510 245');

        const wAluToExmem = createWire('wire-alu-exmem', 'M 575 210 L 635 210');
        const wExmemToDmem = createWire('wire-exmem-dmem', 'M 659 210 L 740 210');
        const wDmemToMemwb = createWire('wire-dmem-memwb', 'M 845 210 L 885 210');

        // Write-Back return bus to Register File
        const wWbBus = createWire('wire-wb-bus', 'M 909 210 L 980 210 L 980 430 L 335 430 L 335 270');

        // Forwarding Bypass Wires (EX/MEM -> MUXes and MEM/WB -> MUXes)
        const wFwdExToMuxA = createWire('wire-fwd-ex-a', 'M 610 210 L 610 115 L 470 115 L 470 150', true);
        const wFwdExToMuxB = createWire('wire-fwd-ex-b', 'M 610 210 L 610 115 L 450 115 L 450 250 L 460 250', true);

        const wFwdMemToMuxA = createWire('wire-fwd-mem-a', 'M 860 210 L 860 90 L 475 90 L 475 150', true);
        const wFwdMemToMuxB = createWire('wire-fwd-mem-b', 'M 860 210 L 860 90 L 445 90 L 445 260 L 460 260', true);

        // Store dynamic elements
        this.elements.wires = {
            pcToImem: wPcToImem,
            imemToIfid: wImemToIfid,
            ifidToRf: wIfidToRf,
            rfOutA: wRfOutA,
            rfOutB: wRfOutB,
            idexToMuxA: wIdexToMuxA,
            idexToMuxB: wIdexToMuxB,
            muxAToAlu: wMuxAToAlu,
            muxBToAlu: wMuxBToAlu,
            aluToExmem: wAluToExmem,
            exmemToDmem: wExmemToDmem,
            dmemToMemwb: wDmemToMemwb,
            wbBus: wWbBus,
            fwdExA: wFwdExToMuxA,
            fwdExB: wFwdExToMuxB,
            fwdMemA: wFwdMemToMuxA,
            fwdMemB: wFwdMemToMuxB,
        };

        this.elements.blocks = {
            pc: pcBlock,
            imem,
            rf,
            alu,
            dmem,
            hdu,
            fwu,
            ifid,
            idex,
            exmem,
            memwb,
            muxA,
            muxB,
        };

        const appendAll = (arr) => arr.forEach(el => g.appendChild(el));

        appendAll([
            // Blocks
            pcBlock, imem, rf, alu, dmem, hdu, fwu,
            ifid, idex, exmem, memwb, muxA, muxB,
            // Wires
            wPcToImem, wImemToIfid, wIfidToRf, wRfOutA, wRfOutB,
            wIdexToMuxA, wIdexToMuxB, wMuxAToAlu, wMuxBToAlu,
            wAluToExmem, wExmemToDmem, wDmemToMemwb, wWbBus,
            wFwdExToMuxA, wFwdExToMuxB, wFwdMemToMuxA, wFwdMemToMuxB,
            // Labels
            tPc, tImem, tRf, tAlu, tDmem, tHdu, tFwu,
            tIfid, tIdex, tExmem, tMemwb,
            this.elements.muxASel, this.elements.muxBSel,
            this.elements.instIf, this.elements.instId, this.elements.instEx, this.elements.instMem, this.elements.instWb,
            this.elements.banner, this.elements.hudCard
        ]);

        this.svg.appendChild(g);
        this.container.appendChild(this.svg);
    }

    _handleBlockClick(blockId, title, stageHint) {
        if (this.onStageClick) {
            this.onStageClick(stageHint);
        }
        if (this.elements.hudCard && this.lastSnapshot) {
            const s = this.lastSnapshot;
            let detail = '';
            if (stageHint === 'IF') {
                detail = `[IF Stage] PC: 0x${(s.pc || 0).toString(16).padStart(4, '0')} | Fetched: ${s.stageInstructions?.IF?.raw || 'NOP'}`;
            } else if (stageHint === 'ID') {
                detail = `[ID Stage] Op: ${s.stageInstructions?.ID?.raw || 'NOP'} | Regs Read: R1=${s.registers?.[1] ?? 0}, R2=${s.registers?.[2] ?? 0}`;
            } else if (stageHint === 'EX') {
                const fwdA = s.forwardA === ForwardSrc.EX_MEM ? 'EX/MEM' : (s.forwardA === ForwardSrc.MEM_WB ? 'MEM/WB' : 'Reg');
                const fwdB = s.forwardB === ForwardSrc.EX_MEM ? 'EX/MEM' : (s.forwardB === ForwardSrc.MEM_WB ? 'MEM/WB' : 'Reg');
                detail = `[EX Stage] Op: ${s.stageInstructions?.EX?.raw || 'NOP'} | MUX A=${fwdA}, MUX B=${fwdB} | ALU Result: ${s.EX_MEM?.aluResult ?? '—'}`;
            } else if (stageHint === 'MEM') {
                detail = `[MEM Stage] Op: ${s.stageInstructions?.MEM?.raw || 'NOP'} | Addr: ${s.EX_MEM?.aluResult ?? '—'}`;
            } else {
                detail = `[Inspection] ${title}`;
            }
            this.elements.hudCard.textContent = detail;
        }
    }

    _setWireColor(wire, color, strokeWidth = '2px', glowFilter = null, animated = false) {
        if (!wire) return;
        wire.setAttribute('stroke', color);
        wire.setAttribute('stroke-width', strokeWidth);
        if (glowFilter) {
            wire.setAttribute('filter', `url(#${glowFilter})`);
        } else {
            wire.removeAttribute('filter');
        }
        if (animated) {
            wire.classList.add('wire-active-flow');
            wire.setAttribute('stroke-dasharray', '8,4');
        } else {
            wire.classList.remove('wire-active-flow');
            wire.removeAttribute('stroke-dasharray');
        }
    }

    _setBlockStyle(block, fill, stroke, strokeWidth = '2px', glow = false) {
        if (!block) return;
        block.setAttribute('style', `fill: ${fill}; stroke: ${stroke}; stroke-width: ${strokeWidth}; rx: 8px;`);
        if (glow) {
            block.setAttribute('filter', 'url(#glow-red)');
        } else {
            block.removeAttribute('filter');
        }
    }

    /**
     * Update the datapath schematic from a CPU cycle snapshot.
     * @param {Object} snapshot
     */
    update(snapshot) {
        if (!snapshot) return;
        this.lastSnapshot = snapshot;

        const if_id = snapshot.IF_ID || {};
        const id_ex = snapshot.ID_EX || {};
        const ex_mem = snapshot.EX_MEM || {};
        const mem_wb = snapshot.MEM_WB || {};

        const stageInsts = snapshot.stageInstructions || {};
        const stageStrs = snapshot.stages || {};

        const IF = stageStrs.IF || (stageInsts.IF ? stageInsts.IF.raw : (if_id.valid ? if_id.instruction?.raw : 'NOP'));
        const ID = stageStrs.ID || (stageInsts.ID ? stageInsts.ID.raw : (id_ex.valid ? id_ex.instruction?.raw : 'NOP'));
        const EX = stageStrs.EX || (stageInsts.EX ? stageInsts.EX.raw : (ex_mem.valid ? ex_mem.instruction?.raw : 'NOP'));
        const MEM = stageStrs.MEM || (stageInsts.MEM ? stageInsts.MEM.raw : (mem_wb.valid ? mem_wb.instruction?.raw : 'NOP'));
        const WB = stageStrs.WB || (stageInsts.WB ? stageInsts.WB.raw : ((mem_wb.valid && mem_wb.regWrite) ? mem_wb.instruction?.raw : '—'));

        this.elements.instIf.textContent = IF || 'NOP';
        this.elements.instId.textContent = ID || 'NOP';
        this.elements.instEx.textContent = EX || 'NOP';
        this.elements.instMem.textContent = MEM || 'NOP';
        this.elements.instWb.textContent = WB || '—';

        // Color Tokens
        const wireOff = '#374151';
        const wireGreen = '#10b981';
        const wireBlue = '#3b82f6';
        const wireCyan = '#06b6d4';
        const wireAmber = '#f59e0b';
        const wireRed = '#ef4444';

        // Reset all wires
        Object.values(this.elements.wires).forEach(w => this._setWireColor(w, wireOff));

        // Highlight Active Stages based on cycle execution
        const ifActive = stageInsts.IF != null || (IF && IF !== 'NOP' && IF !== 'STALL' && IF !== 'FLUSH');
        const idActive = stageInsts.ID != null || (ID && ID !== 'NOP');
        const exActive = stageInsts.EX != null || (EX && EX !== 'NOP');
        const memActive = stageInsts.MEM != null || (MEM && MEM !== 'NOP');
        const wbActive = stageInsts.WB != null || (WB && WB !== 'NOP' && WB !== '—');

        if (ifActive) {
            this._setWireColor(this.elements.wires.pcToImem, wireGreen, '2.5px', 'glow-green', true);
            this._setWireColor(this.elements.wires.imemToIfid, wireGreen, '2.5px', 'glow-green', true);
        }
        if (idActive) {
            this._setWireColor(this.elements.wires.ifidToRf, wireCyan, '2.5px', 'glow-cyan', true);
            this._setWireColor(this.elements.wires.rfOutA, wireCyan, '2px', null, true);
            this._setWireColor(this.elements.wires.rfOutB, wireCyan, '2px', null, true);
        }
        if (exActive) {
            this._setWireColor(this.elements.wires.idexToMuxA, wireGreen, '2px');
            this._setWireColor(this.elements.wires.idexToMuxB, wireGreen, '2px');
            this._setWireColor(this.elements.wires.muxAToAlu, wireGreen, '2.5px', 'glow-green', true);
            this._setWireColor(this.elements.wires.muxBToAlu, wireGreen, '2.5px', 'glow-green', true);
            this._setWireColor(this.elements.wires.aluToExmem, wireGreen, '3px', 'glow-green', true);
        }
        if (memActive) {
            this._setWireColor(this.elements.wires.exmemToDmem, wireBlue, '2.5px', 'glow-cyan', true);
            this._setWireColor(this.elements.wires.dmemToMemwb, wireBlue, '2.5px', 'glow-cyan', true);
        }
        if (wbActive && (mem_wb.regWrite || stageInsts.WB?.regWrite || (stageInsts.WB && stageInsts.WB.rd !== 0))) {
            this._setWireColor(this.elements.wires.wbBus, wireAmber, '3px', 'glow-amber', true);
        }

        // Hazard Detection Status & Visual Badges
        const stall = snapshot.stall || false;
        const flush = snapshot.flush || false;
        const hazard = snapshot.hazard || HazardType.NONE;

        if (stall) {
            this._setBlockStyle(this.elements.blocks.hdu, '#450a0a', wireRed, '3px', true);
            const hText = hazard === HazardType.LOAD_USE ? 'LOAD-USE DATA HAZARD (PC Frozen, Bubble Injected into ID/EX)' : 'RAW DATA HAZARD (Pipeline Stalled)';
            this.elements.banner.textContent = `🛑 STALL — ${hText}`;
            this.elements.banner.setAttribute('fill', wireRed);
        } else if (flush) {
            this._setBlockStyle(this.elements.blocks.hdu, '#451a03', wireAmber, '3px', true);
            this.elements.banner.textContent = '⚡ CONTROL HAZARD — BRANCH/JUMP TAKEN (Pipeline Flushed)';
            this.elements.banner.setAttribute('fill', wireAmber);
        } else {
            this._setBlockStyle(this.elements.blocks.hdu, '#111827', '#374151');
            this.elements.banner.textContent = '';
        }

        // Forwarding Bypass Wiring & MUX A / B Selectors
        const forwardA = snapshot.forwardA || 0;
        const forwardB = snapshot.forwardB || 0;
        let fwuActive = false;

        // MUX A selection
        if (forwardA === ForwardSrc.EX_MEM) {
            fwuActive = true;
            this._setWireColor(this.elements.wires.fwdExA, wireCyan, '3px', 'glow-cyan', true);
            this.elements.muxASel.textContent = '10:EX/MEM';
            this.elements.muxASel.setAttribute('fill', wireCyan);
        } else if (forwardA === ForwardSrc.MEM_WB) {
            fwuActive = true;
            this._setWireColor(this.elements.wires.fwdMemA, wireAmber, '3px', 'glow-amber', true);
            this.elements.muxASel.textContent = '01:MEM/WB';
            this.elements.muxASel.setAttribute('fill', wireAmber);
        } else {
            this.elements.muxASel.textContent = '00:Reg';
            this.elements.muxASel.setAttribute('fill', '#9ca3af');
        }

        // MUX B selection
        if (forwardB === ForwardSrc.EX_MEM) {
            fwuActive = true;
            this._setWireColor(this.elements.wires.fwdExB, wireCyan, '3px', 'glow-cyan', true);
            this.elements.muxBSel.textContent = '10:EX/MEM';
            this.elements.muxBSel.setAttribute('fill', wireCyan);
        } else if (forwardB === ForwardSrc.MEM_WB) {
            fwuActive = true;
            this._setWireColor(this.elements.wires.fwdMemB, wireAmber, '3px', 'glow-amber', true);
            this.elements.muxBSel.textContent = '01:MEM/WB';
            this.elements.muxBSel.setAttribute('fill', wireAmber);
        } else {
            this.elements.muxBSel.textContent = '00:Reg';
            this.elements.muxBSel.setAttribute('fill', '#9ca3af');
        }

        if (fwuActive) {
            this._setBlockStyle(this.elements.blocks.fwu, '#042f2e', wireGreen, '3px');
        } else {
            this._setBlockStyle(this.elements.blocks.fwu, '#111827', '#374151');
        }
    }
}
