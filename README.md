# ⚡ SIMT-Flow: Professional 5-Stage Pipelined CPU & GPU SIMT Simulator

**Cycle-Accurate Educational Microarchitecture Platform & Hardware Verification Suite**

SIMT-Flow is a comprehensive, cycle-accurate, browser-native hardware simulation environment implementing a textbook Hennessy & Patterson 5-stage RISC pipelined processor alongside an 8-lane SIMT GPU Streaming Multiprocessor (SM), L1 Cache Hierarchy, Dynamic 2-Bit Branch Predictor, Digital Logic Waveform Viewer, GPU 8-Bank Conflict & GTO Scheduler, 4×4 Tensor Core Systolic Array, and Micro-C Compiler.

![Mode: CPU 5-Stage Pipeline](https://img.shields.io/badge/Mode-CPU%205--Stage-blue)
![Mode: GPU SM (SIMT)](https://img.shields.io/badge/Mode-GPU%20SM%20(SIMT)-green)
![Mode: Tensor Core](https://img.shields.io/badge/Mode-4x4%20Tensor%20Core-orange)
![Zero Dependencies](https://img.shields.io/badge/Dependencies-Zero-brightgreen)
![Tests: 26/26 Passing](https://img.shields.io/badge/Verification-26%2F26%20PASS-brightgreen)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow)

### 🌐 [Click Here to Open the Live Simulator Website](https://tg8618024-lang.github.io/GPU-SMIT-PIPELINE-SIMULATOR/)

No installation or setup required. Run cycle-accurate simulations, compiler passes, and hardware benchmarks directly in your browser.

---

## 🚀 Quick Start

### 1. Launch Interactive Web GUI & REST API
```bash
# Clone the repository
git clone <your-repo-url>
cd gpu-simt-pipeline-simulator

# Start the Python server (serves web UI + exposes REST API backend)
python serve.py
```
Open **http://localhost:8000** in any modern web browser (Chrome, Edge, Firefox, Safari).

### 2. Run Automated Verification Suite Headless
```bash
# Runs all 26 hardware invariant tests & UI DOM validation headlessly
python run_tests.py
```

---

## 🏗️ Microarchitectural Design

### Dual-Paradigm Architecture

| Dimension | CPU 5-Stage Pipeline (ILP) | GPU SM Warp Engine (TLP) |
|:---|:---|:---|
| **Goal** | Minimize single-thread execution latency | Maximize aggregate thread throughput |
| **Execution Entity** | Single scalar instruction stream | **Warp** (8 SIMT lanes lockstep) |
| **Hazard Resolution** | **Forwarding / Bypass Network** + Load-Use Stall | **Scoreboard + Zero-Overhead Warp Switching** |
| **Branch Handling** | Early branch resolution (ID stage) + pipeline flush | **Predication & Reconvergence Divergence Stack** |
| **Memory Latency** | Pipeline interlock stall | **Latency hiding** via thread-level parallelism |
| **Register File** | 8 32-bit registers (R0 hardwired zero, R1–R7) | 4 Warps × 8 Registers per warp |

---

## 🔬 CPU 5-Stage Microarchitecture

The CPU simulator models the canonical RISC 5-stage pipeline:

```
           ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
           │    IF    │────▶│    ID    │────▶│    EX    │────▶│   MEM    │────▶│    WB    │
           │Instruction│    │Instruction│   │Execution/│     │  Memory  │     │Writeback │
           │  Fetch   │     │  Decode  │     │Address   │     │  Access  │     │          │
           └──────────┘     └──────────┘     └──────────┘     └──────────┘     └──────────┘
                ▲                │                 │                │                │
                │                │         Forwarding Path A        │                │
                │                │   ┌─────────────────────────────┬┴────────────────┤
                │                │   │     Forwarding Path B       │                 │
                │                ▼   ▼   ┌─────────────────────────┴─────────────────┤
                │             ┌─────────┐│                                           │
                └─────────────│ Hazard  │◀───────────────────────────────────────────┘
                 PC / Stall   │ Control │
                 & Flush      └─────────┘
```

### 1. Pipeline Stages
- **IF (Instruction Fetch)**: Byte-addressed PC (`0x0000`, `0x0004`, ...). Fetches 32-bit instruction from memory. Calculates fall-through `PC + 4`. Controlled by `hazard.pcWrite`.
- **ID (Instruction Decode)**: Generates control signals via centralized `ControlUnit`. Reads source registers from Register File with half-cycle write-before-read bypassing. Resolves branch conditions (`BEQ`, `BNE`, `BLT`, `BGE`) and computes branch targets early in ID to minimize penalty to 1 cycle.
- **EX (Execute / Address Calculation)**: 32-bit ALU performs arithmetic (`ADD`, `SUB`, `MUL`, `DIV`, `ADDI`), bitwise logic (`AND`, `OR`, `XOR`, `SLT`, `SLL`, `SRL`), or memory effective address computation (`[Rs1 + imm]`). Dual 3-to-1 input multiplexers select between register operands and bypass lines.
- **MEM (Memory Access)**: Read/write access to 1024-byte data memory. For stores (`ST`), store data can be forwarded from the WB stage.
- **WB (Write Back)**: Writes ALU result or load data into destination register. Updates register file at the start of the cycle. Enforces `R0 === 0` immutability.

### 2. Inter-Stage Pipeline Latches
State is latched across discrete boundary registers:
- `IF/ID`: Latches instruction machine code, instruction object, fall-through PC+4, current PC, and `valid`/`isBubble` flags.
- `ID/EX`: Latches decoded control bundles (`regWrite`, `memRead`, `memWrite`, `memToReg`, `aluSrc`, `aluOp`), source register addresses (`rs1`, `rs2`), register values (`readData1`, `readData2`), sign-extended immediate, destination register (`rd`), and branch metadata.
- `EX/MEM`: Latches computed ALU result/address, write data (store value), destination register (`rd`), control signals (`regWrite`, `memRead`, `memWrite`, `memToReg`), and zero flag.
- `MEM/WB`: Latches loaded memory data, ALU result, destination register (`rd`), control signals (`regWrite`, `memToReg`), and retirement flags.

### 3. Hazard Detection Unit (`HazardUnit`)
- **Load-Use Data Hazard**:
  - Condition: `ID/EX.memRead == true && (ID/EX.rd == IF/ID.rs1 || ID/EX.rd == IF/ID.rs2)`
  - Action: Assert `stall = true`. Deassert `pcWrite` (freeze PC), deassert `ifIdWrite` (preserve fetched instruction), inject bubble into `ID/EX` latch (`isBubble = true`, `valid = false`).
- **RAW Hazard (Forwarding Disabled)**:
  - When forwarding is toggled OFF, any pending write to `rs1` or `rs2` in `ID/EX`, `EX/MEM`, or `MEM/WB` forces 1–2 bubble cycles until WB commits.
- **Branch Data Hazard**:
  - If a branch in ID compares registers currently being computed in `ID/EX` (ALU instruction) or `ID/EX` (Load instruction), ID stalls 1 cycle until operands advance to MEM/WB where ID branch comparator can forward them.
- **Control Hazards**:
  - When a branch is taken or a jump (`J`, `JAL`, `JR`) is resolved in ID, the instruction already fetched in IF is flushed (`ifFlush = true`).

### 4. Forwarding Unit (`ForwardingUnit`)
Dual ALU input MUXes eliminate RAW data stalls:
- **EX Hazard (Priority 1 - Most Recent)**:
  - If `EX/MEM.regWrite && EX/MEM.rd != 0 && EX/MEM.rd == ID/EX.rs1 && !EX/MEM.memRead`: `forwardA = 0b10` (forward from EX/MEM ALU result).
  - If `EX/MEM.regWrite && EX/MEM.rd != 0 && EX/MEM.rd == ID/EX.rs2 && !EX/MEM.memRead`: `forwardB = 0b10`.
- **MEM Hazard (Priority 2 - Second Most Recent)**:
  - If `MEM/WB.regWrite && MEM/WB.rd != 0 && MEM/WB.rd == ID/EX.rs1`: `forwardA = 0b01` (forward from MEM/WB result).
  - If `MEM/WB.regWrite && MEM/WB.rd != 0 && MEM/WB.rd == ID/EX.rs2`: `forwardB = 0b01`.
- **Store Data Forwarding**:
  - Store instruction memory data (`rs2` / store val) can be bypassed from `MEM/WB` directly into `EX/MEM.writeData`.
- **Branch Forwarding in ID**:
  - Resolves branch comparison registers directly from `EX/MEM` or `MEM/WB` stages.
- **Hardwired Zero Enforcement**:
  - `R0` is never forwarded; it always reads `0x00000000`.

---

## 📜 Micro-ISA Reference

The processor supports 23 instructions spanning integer computation, memory, control flow, and SIMT operations:

| Category | Instruction | Syntax | Opcode | Semantics |
|:---|:---|:---|:---:|:---|
| **ALU Arithmetic** | `ADD` | `ADD Rd, Rs1, Rs2` | `0x01` | `Rd = Rs1 + Rs2` |
| | `SUB` | `SUB Rd, Rs1, Rs2` | `0x02` | `Rd = Rs1 - Rs2` |
| | `MUL` | `MUL Rd, Rs1, Rs2` | `0x03` | `Rd = Rs1 * Rs2` |
| | `DIV` | `DIV Rd, Rs1, Rs2` | `0x04` | `Rd = Rs1 / Rs2` (checked div-by-zero) |
| | `ADDI` | `ADDI Rd, Rs1, imm` | `0x05` | `Rd = Rs1 + imm` |
| **ALU Logical** | `AND` | `AND Rd, Rs1, Rs2` | `0x06` | `Rd = Rs1 & Rs2` |
| | `OR` | `OR Rd, Rs1, Rs2` | `0x07` | `Rd = Rs1 \| Rs2` |
| | `XOR` | `XOR Rd, Rs1, Rs2` | `0x08` | `Rd = Rs1 ^ Rs2` |
| | `SLT` | `SLT Rd, Rs1, Rs2` | `0x09` | `Rd = (Rs1 < Rs2) ? 1 : 0` |
| | `SLL` | `SLL Rd, Rs1, Rs2` | `0x0A` | `Rd = Rs1 << (Rs2 & 0x1F)` |
| | `SRL` | `SRL Rd, Rs1, Rs2` | `0x0B` | `Rd = Rs1 >>> (Rs2 & 0x1F)` |
| **Data Transfer** | `LD` | `LD Rd, [Rs1 + off]` | `0x0C` | `Rd = Mem[Rs1 + off]` |
| | `ST` | `ST [Rd + off], Rs1` | `0x0D` | `Mem[Rd + off] = Rs1` |
| **Branching** | `BEQ` | `BEQ Rs1, Rs2, label` | `0x0E` | If `Rs1 == Rs2`, PC = Target |
| | `BNE` | `BNE Rs1, Rs2, label` | `0x0F` | If `Rs1 != Rs2`, PC = Target |
| | `BLT` | `BLT Rs1, Rs2, label` | `0x10` | If `Rs1 < Rs2`, PC = Target |
| | `BGE` | `BGE Rs1, Rs2, label` | `0x11` | If `Rs1 >= Rs2`, PC = Target |
| **Jumps** | `J` | `J label` | `0x12` | Unconditional PC = Target |
| | `JAL` | `JAL Rd, label` | `0x13` | Link `Rd = PC + 4`, PC = Target |
| | `JR` | `JR Rs1` | `0x14` | PC = `Rs1` |
| **SIMT & Special** | `DIV_IF`| `DIV_IF Rd` | `0x15` | GPU SIMT divergence split |
| | `NOP` | `NOP` | `0x16` | No-operation (`0x00000000`) |
| | `HALT` | `HALT` | `0x17` | Freeze pipeline execution |

### Assembler Syntax
- **Registers**: `R0` through `R7` (`r0`–`r7` case-insensitive). `R0` is constant 0.
- **Immediates**: `#10`, `10`, `-4`, `0xFF`.
- **Memory Addressing**: `[R1]`, `[R1 + 4]`, `[R2 - 8]`, or `[R1 + #4]`.
- **Labels**: `label:` followed by target references `BEQ R1, R2, loop`.
- **Machine Code**: Generates standard 32-bit big-endian binary words `[Opcode:6][Rd:5][Rs1:5][Rs2:5][Imm:11]`.

---

## 🖥️ Interactive Web UI Dashboard

The user interface is arranged into a responsive 4-quadrant layout:

1. **Top-Left (Execution & Assembly)**:
   - Program editor with syntax highlighting, line numbers, and preset selection.
   - Run controls: **Step**, **Run/Pause**, **Rewind**, **Reset**, and Execution Speed slider.
   - Forwarding toggle (ON/OFF) to observe RAW penalty impact in real time.
   - VCD Waveform Download button (`.vcd` export).

2. **Top-Right (Reservation Table & Instruction Pipeline Flow)**:
   - Cycle-by-cycle reservation table mapping every instruction to its active pipeline stage (`IF`, `ID`, `EX`, `MEM`, `WB`, `STALL`, `FLUSH`).
   - Auto-scrolling horizontal cycle grid with stage color tags.

3. **Bottom-Left (Tabbed Architecture & Visualizer)**:
   - **Datapath Schematic Tab**: Animated SVG datapath showing PC, Register File, ALU, Data Memory, inter-stage latches, dynamic bus color-coding, forwarding bypass wires, and hazard badges. Clicking any stage opens the Stage Inspector.
   - **Program Disassembly Tab**: Live disassembly table showing Byte Address, Machine Code (Hex), Source Assembly, and interactive click-to-toggle **Breakpoints**.
   - **CPU vs GPU Architecture Tab**: Side-by-side hardware comparison matrix detailing Latency vs Throughput, Forwarding vs Scoreboarding, Branch Flushes vs SIMT Reconvergence Stacks.

4. **Bottom-Right (Tabbed Hardware Telemetry & State)**:
   - **Registers Tab**: Live view of `R0–R7` with decimal, hexadecimal (`0x`), binary representation, write highlights, and lock status.
   - **Memory Tab**: 1024-byte hex dump viewer with address offsets, ASCII representation, byte-level memory inspector, and memory search/goto.
   - **Hazards & MUXes Tab**: Live diagnostic cards for `Hazard Detection Unit` (interlock status, stall flags, PC write enables) and `Forwarding Unit` (MUX selection codes `0b00`, `0b01`, `0b10`, bypass sources, and store forwarding).
   - **Stage Inspector Tab**: Deep-dive into latches for any selected pipeline stage (Control Bundles, Operands, ALU results, Branch flags, Latch valid/bubble state).
   - **Telemetry & CPI Tab**: Performance metrics dashboard tracking Total Cycles, Instructions Retired, CPI, IPC, Stall Cycles, Flush Cycles, Branch Accuracy, and Visual Cycle Breakdown Bar.

---

## 🌐 REST API Backend (`serve.py`)

In addition to serving static files, `serve.py` includes a lightweight, zero-dependency REST backend for programmatic pipeline automation:

| Method | Route | Description | Example Payload / Response |
|:---|:---|:---|:---|
| `POST` | `/program/load` | Assemble and load assembly code | `{"source": "ADDI R1, R0, 10\nHALT"}` |
| `POST` | `/simulation/step` | Advance CPU or GPU simulation by 1 cycle | Returns updated snapshot JSON |
| `POST` | `/simulation/run` | Execute until HALT, breakpoint, or cycle limit | `{"maxCycles": 1000}` |
| `POST` | `/simulation/reset`| Reset pipeline, registers, and memory | Returns cycle 0 initial state |
| `GET` | `/simulation/state`| Retrieve full snapshot telemetry | Returns complete JSON state |
| `GET` | `/registers` | Retrieve register file values | `{"R0": 0, "R1": 10, ...}` |
| `GET` | `/memory?start=0&len=64` | Read memory block | `{"start": 0, "length": 64, "bytes": [...]}` |
| `GET` | `/metrics` | Retrieve cycle count, CPI, stalls, flushes | `{"cycles": 5, "cpi": 1.25, ...}` |
| `POST` | `/api/tests/run` | Execute headless test suite | `{"total": 26, "passed": 26, "failed": 0}` |

---

## 🧪 Automated Verification Suite (26 Tests)

The verification harness validates microarchitectural invariants across edge cases:

```bash
python run_tests.py
```

### Verified Test Cases:
1. **Basic ALU Operations**: Verifies `ADD`, `SUB`, `MUL`, `DIV`, `AND`, `OR`, `XOR`, `SLT`, `SLL`, `SRL` correctness.
2. **Register Dependencies (No Forwarding)**: Asserts that disabling forwarding causes 2 stall bubbles on RAW dependencies.
3. **EX/MEM Forwarding Bypass**: Confirms that back-to-back ALU operations execute with 0 stalls when forwarding is active.
4. **MEM/WB Forwarding Bypass**: Asserts correct bypass from MEM/WB to EX when separated by one instruction.
5. **Forwarding Priority (EX/MEM > MEM/WB)**: Confirms that when both stages target the same register, the newer EX/MEM value takes precedence.
6. **Load-Use Data Hazard**: Confirms exactly 1 mandatory stall bubble is inserted for `LD R1, [R0]` followed immediately by `ADD R2, R1, R3`.
7. **Multiple Consecutive Dependencies**: Validates pipeline flow through cascades of interdependent instructions.
8. **Branch Taken & Target Redirection**: Confirms correct target calculation, PC redirection, and taken-branch penalty.
9. **Branch Not Taken (Fall-through)**: Confirms seamless fall-through execution with 0 stall bubbles.
10. **Pipeline Flush Verification**: Verifies that speculatively fetched instructions after a taken branch are converted to flushes/bubbles.
11. **Stall + Forwarding Interaction**: Tests Load-Use hazard followed immediately by EX/MEM bypass forwarding.
12. **Processor Reset State**: Asserts that reset clears latches, registers, PC, and cycle counters to known initial states.
13. **Register Zero Immutability**: Proves that writes to `R0` are ignored and `R0` remains `0x00000000`.
14. **Memory Load & Store Integrity**: Verifies byte/word write and read integrity at offset memory locations.
15. **Back-to-Back Hazards**: Validates multiple back-to-back Load-Use and RAW sequences.
16. **Long Program (Countdown Loop)**: Executes multi-iteration arithmetic loop with backward branch to verify cumulative state.
17. **Load-Branch Data Hazard**: Validates 2 mandatory stall bubbles when a branch in ID depends on loaded memory data in EX/MEM.
18. **Store Data Forwarding in MEM Stage**: Confirms that recent ALU results in MEM/WB are bypassed directly into memory write data in the MEM stage.
19. **JR Indirect Jump with Register Forwarding**: Tests computed jump target forwarding from EX/MEM or MEM/WB into ID.
20. **Comment & Blank Line Independence in Grid**: Verifies reservation table row indices decouple from source file line numbers.
21. **GPU Scoreboard Latency Hiding**: Asserts Warp 0 stalls on long memory load while Warp 1 seamlessly issues.
22. **SIMT Warp Divergence & Mask**: Validates active thread mask splitting and reconvergence across lanes.
23. **L1-D Cache Spatial Locality & Stalls**: Verifies 1 cold miss fetches 4-word line, followed by 100% 1-cycle hits for words 1..3.
24. **Dynamic 2-Bit Branch Predictor Training**: Verifies 2-bit counter transitions to Strongly Taken in a loop, eliminating flushes.
25. **GPU Shared Memory 8-Bank Conflicts**: Detects 8-way bank conflict on strided accesses with multi-cycle serialization.
26. **Micro-C Compiler & Program Execution**: Compiles C variables and arithmetic expressions to Micro-ISA and executes accurately.

---

## 📊 VCD Waveform Export (IEEE 1364)

Clicking the **Export VCD** button generates a standard Value Change Dump file compatible with GTKWave, ModelSim, and Vivado:
- **Clock**: `clk`
- **Control & Program Counter**: `pc[31:0]`, `stall`, `flush`
- **Stage Valids**: `if_valid`, `id_valid`, `ex_valid`, `mem_valid`, `wb_valid`
- **Forwarding MUXes**: `fwd_a[1:0]`, `fwd_b[1:0]`
- **Hazard Diagnostic**: `hazard[2:0]`
- **Register File**: `R0[31:0]` through `R7[31:0]`

---

## 📁 Repository Structure

```
gpu-simt-pipeline-simulator/
├── index.html                    # 4-quadrant UI with tabbed datapath, editor & state panels
├── styles.css                    # Modern dark theme, glassmorphic HUD styling, FSM & waveform styles
├── serve.py                      # Python HTTP server + full REST API endpoints
├── run_tests.py                  # Headless automated verification runner (26 tests)
├── test.html                     # Browser-based test harness
├── README.md                     # Microarchitectural documentation
└── src/
    ├── engine/                   # Microarchitectural simulation engine
    │   ├── types.js              # Enums, latch schemas, cache/branch/systolic data types
    │   ├── control_unit.js       # Centralized instruction decoder & control bundle generator
    │   ├── hazard_unit.js        # Hazard detection unit (Load-Use, RAW, Branch stalls/flushes)
    │   ├── forwarding_unit.js    # Bypass unit (EX/MEM, MEM/WB, Store, Branch, R0 immunity)
    │   ├── cpu_pipeline.js       # 5-stage CPU engine with L1 caches & dynamic branch predictor
    │   ├── gpu_pipeline.js       # GPU SM warp scheduler (RR & GTO), scoreboard, 8-bank conflicts
    │   ├── cache.js              # L1 Cache (Direct & 2-Way, Tag/Index/Offset, LRU, Miss Penalty)
    │   ├── branch_predictor.js   # 2-Bit Saturating Counter FSM + 16-entry BTB
    │   ├── c_compiler.js         # Micro-C in-browser compiler to Micro-ISA assembly
    │   ├── parser.js             # Assembly lexer, parser, label resolver & 32-bit machine coder
    │   ├── benchmarks.js         # 10 CPU presets + 4 GPU presets (Cache, Predictor, Conflicts, GTO)
    │   ├── cpu_testbench.js      # 20 CPU invariant verification tests
    │   └── vcd_exporter.js       # IEEE 1364 standard VCD waveform generator
    └── ui/                       # Presentation & visualization layer
        ├── app.js                # Master UI controller, event bindings, compiler & tab routing
        ├── datapath_view.js      # Interactive animated SVG datapath schematic
        ├── waveform_viewer.js    # Digital logic timing analyzer with scrubbable cycle marker
        ├── systolic_view.js      # 4x4 Tensor Core / Systolic Array matrix multiplier visualizer
        ├── pipeline_grid.js      # Cycle-by-cycle reservation table
        ├── views.js              # Registers, Memory, Cache, Predictor, Shared Banks, Hazards, Metrics
        ├── warp_lanes_view.js    # GPU SIMT 8-lane visualizer with divergence mask HUD
        ├── audio_synthesizer.js  # Pure Web Audio API synthesizer for tactile mechanical sound FX
        ├── telemetry_stream.js   # Real-time human-readable silicon execution narrative feed
        └── test_runner.js        # In-browser graphical modal test runner (26 tests)
```

---

## 📜 License

MIT License — free to use, study, modify, and distribute.
