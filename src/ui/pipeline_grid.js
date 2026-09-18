import { Stage, HazardType } from '../engine/types.js';

export class PipelineGrid {
    /**
     * Creates a new PipelineGrid instance.
     * @param {HTMLElement} containerElement - The DOM element to render the grid into.
     */
    constructor(containerElement) {
        this.container = containerElement;
        this.table = null;
        this.thead = null;
        this.tbody = null;
        this.lastTotalCycles = 0;
        this.lastNumInstructions = 0;
        
        this._initDOM();
    }

    /**
     * Initializes the DOM structure for the grid.
     */
    _initDOM() {
        this.container.innerHTML = '';
        this.container.classList.add('pipeline-grid-container');
        
        // Use a wrapper for horizontal scrolling
        this.scrollWrapper = document.createElement('div');
        this.scrollWrapper.className = 'pipeline-scroll-wrapper';
        this.scrollWrapper.style.overflowX = 'auto';
        this.scrollWrapper.style.width = '100%';

        this.table = document.createElement('table');
        this.table.className = 'pipeline-grid';
        
        this.thead = document.createElement('thead');
        this.tbody = document.createElement('tbody');
        
        this.table.appendChild(this.thead);
        this.table.appendChild(this.tbody);
        this.scrollWrapper.appendChild(this.table);
        this.container.appendChild(this.scrollWrapper);
    }

    /**
     * Helper to get CSS class for a pipeline stage.
     */
    _getStageClass(stage) {
        switch (stage) {
            case Stage.IF: return 'stage-if';
            case Stage.ID: return 'stage-id';
            case Stage.EX: return 'stage-ex';
            case Stage.MEM: return 'stage-mem';
            case Stage.WB: return 'stage-wb';
            case Stage.BUBBLE: case 'STALL': return 'stage-bubble';
            case Stage.FLUSHED: case 'FLUSH': return 'stage-flushed';
            case 'EXECUTE': return 'stage-ex';
            default: return '';
        }
    }

    /**
     * Helper to get display text for a pipeline stage.
     */
    _getStageText(stage) {
        if (!stage) return '';
        if (stage === Stage.BUBBLE || stage === 'STALL') return '●';
        if (stage === Stage.FLUSHED || stage === 'FLUSH') return '✗';
        if (stage === 'EXECUTE') return 'EX';
        return stage;
    }

    /**
     * Update the grid with the full history up to the current cycle.
     * @param {object} params
     * @param {Array} params.instructions - All program instructions
     * @param {Array<Array<object>>|Map} params.gridData - 2D structure: gridData[instrIndex][cycle] = { stage, isForwarding, hazardType }
     * @param {number} params.currentCycle - The current clock cycle (to highlight)
     * @param {number} params.totalCycles - Total cycles in history
     */
    update({ instructions, gridData, currentCycle, totalCycles }) {
        // Rebuild structure if dimensions changed
        if (this.lastTotalCycles !== totalCycles || this.lastNumInstructions !== instructions.length) {
            this._buildGrid(instructions, totalCycles);
            this.lastTotalCycles = totalCycles;
            this.lastNumInstructions = instructions.length;
        }

        // Update the cells
        this._updateCells(instructions, gridData, currentCycle, totalCycles);
    }

    /**
     * Builds the static table structure (rows and columns).
     */
    _buildGrid(instructions, totalCycles) {
        // Build Header
        this.thead.innerHTML = '';
        const headerRow = document.createElement('tr');
        
        // Sticky first column header for instruction text
        const thInst = document.createElement('th');
        thInst.textContent = 'Instruction';
        thInst.className = 'sticky-col-header';
        headerRow.appendChild(thInst);

        // Cycle columns
        for (let c = 1; c <= totalCycles; c++) {
            const thCycle = document.createElement('th');
            thCycle.textContent = `C${c}`;
            headerRow.appendChild(thCycle);
        }
        this.thead.appendChild(headerRow);

        // Build Body Rows
        this.tbody.innerHTML = '';
        for (let i = 0; i < instructions.length; i++) {
            const row = document.createElement('tr');
            
            // Instruction text cell (sticky)
            const tdInst = document.createElement('td');
            tdInst.textContent = instructions[i].text || `Instr ${i}`;
            tdInst.className = 'sticky-col-cell';
            row.appendChild(tdInst);

            // Cycle cells
            for (let c = 1; c <= totalCycles; c++) {
                const tdCycle = document.createElement('td');
                // Create span for stage text/styling
                const badge = document.createElement('span');
                badge.className = 'stage-badge';
                tdCycle.appendChild(badge);
                row.appendChild(tdCycle);
            }
            this.tbody.appendChild(row);
        }
    }

    /**
     * Updates the content and styling of existing table cells.
     */
    _updateCells(instructions, gridData, currentCycle, totalCycles) {
        // Highlight active cycle column header
        const headers = this.thead.querySelectorAll('th');
        headers.forEach((th, idx) => {
            // idx 0 is the sticky column, so idx 1 corresponds to cycle 1
            if (idx === currentCycle) {
                th.classList.add('active-cycle');
            } else {
                th.classList.remove('active-cycle');
            }
        });

        // Update body rows
        const rows = this.tbody.querySelectorAll('tr');
        for (let i = 0; i < instructions.length; i++) {
            const row = rows[i];
            const cells = row.querySelectorAll('td');
            
            // Allow gridData to be an Array of Arrays, or an object/map
            let instrData = [];
            if (gridData instanceof Map) {
                instrData = gridData.get(i) || [];
            } else {
                instrData = gridData[i] || [];
            }
            
            for (let c = 1; c <= totalCycles; c++) {
                // cells[0] is the instruction text, so cells[c] is cycle c
                const td = cells[c];
                const badge = td.querySelector('.stage-badge');
                
                let cellData = null;
                if (instrData instanceof Map) {
                    cellData = instrData.get(c);
                } else {
                    cellData = instrData[c];
                }
                
                // Active cycle column highlighting
                if (c === currentCycle) {
                    td.classList.add('active-cycle');
                } else {
                    td.classList.remove('active-cycle');
                }

                if (cellData && cellData.stage) {
                    badge.textContent = this._getStageText(cellData.stage);
                    
                    // Construct class string
                    let classNames = `stage-badge ${this._getStageClass(cellData.stage)}`;
                    
                    // Add forwarding indicator if applicable
                    if (cellData.isForwarding) {
                        classNames += ' forwarding-indicator';
                    }
                    
                    badge.className = classNames;
                    
                    // Add hazard tooltip if applicable
                    if (cellData.hazardType && cellData.hazardType !== HazardType.NONE) {
                        td.title = `Hazard: ${cellData.hazardType}`;
                        td.style.cursor = 'help';
                    } else {
                        td.title = '';
                        td.style.cursor = 'default';
                    }
                } else {
                    // Empty cell
                    badge.textContent = '';
                    badge.className = 'stage-badge';
                    td.title = '';
                    td.style.cursor = 'default';
                }
            }
        }

        // Auto-scroll horizontally to keep current cycle visible
        if (currentCycle > 0) {
            const activeHeader = headers[currentCycle];
            if (activeHeader) {
                const scrollLeft = this.scrollWrapper.scrollLeft;
                const wrapperWidth = this.scrollWrapper.clientWidth;
                const cellLeft = activeHeader.offsetLeft;
                const cellWidth = activeHeader.offsetWidth;

                // Scroll if the active cell is out of view
                if (cellLeft + cellWidth > scrollLeft + wrapperWidth || cellLeft < scrollLeft) {
                    this.scrollWrapper.scrollTo({
                        left: Math.max(0, cellLeft - wrapperWidth / 2 + cellWidth / 2),
                        behavior: 'smooth'
                    });
                }
            }
        }
    }

    /**
     * Clears the grid data and structural elements.
     */
    clear() {
        this.thead.innerHTML = '';
        this.tbody.innerHTML = '';
        this.lastTotalCycles = 0;
        this.lastNumInstructions = 0;
    }
}
