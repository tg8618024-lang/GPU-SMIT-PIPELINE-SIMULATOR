"""
SIMT-Flow Local Development & Simulation Backend Server
Provides:
  1. Static web asset server (HTML, CSS, ES6 JS Modules)
  2. REST API endpoints for simulation control:
     - POST /program/load
     - POST /simulation/step
     - POST /simulation/run
     - POST /simulation/reset
     - GET  /simulation/state
     - GET  /pipeline/state
     - GET  /registers
     - GET  /memory
     - GET  /metrics
     - GET  /api/tests/run
Run: python serve.py
Open: http://localhost:8000
"""
import http.server
import socketserver
import os
import sys
import json
import subprocess
import re
import urllib.parse

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

# ──────────────────────────────────────────────────────────────────────────────
# In-Memory Backend Simulation State
# ──────────────────────────────────────────────────────────────────────────────
class BackendCPUSimulator:
    def __init__(self):
        self.registers = [0] * 8
        self.memory = [0] * 256
        self.pc = 0
        self.cycle = 0
        self.instructions = []
        self.labels = {}
        self.forwarding_enabled = True
        self.is_halted = False
        self.is_paused = False
        self.stalls = 0
        self.flushes = 0
        self.completed = 0
        self.pipeline = {
            'IF_ID': {'pc': 0, 'valid': False, 'raw': 'NOP', 'inst': None},
            'ID_EX': {'pc': 0, 'valid': False, 'raw': 'NOP', 'inst': None},
            'EX_MEM': {'pc': 0, 'valid': False, 'raw': 'NOP', 'inst': None},
            'MEM_WB': {'pc': 0, 'valid': False, 'raw': 'NOP', 'inst': None},
        }

    def _parse_inst(self, line, idx):
        clean = line.split(';')[0].strip()
        if not clean:
            return None
        tokens = re.split(r'[\s,]+', clean)
        op = tokens[0].upper()

        def parse_reg(s):
            s = s.strip().upper()
            if s.startswith('R') and s[1:].isdigit():
                return int(s[1:])
            return 0

        def parse_val(s):
            s = s.strip()
            if s.startswith('0x') or s.startswith('0X'):
                return int(s, 16)
            return int(s)

        rd, rs1, rs2, imm = 0, 0, 0, 0

        if op in ('ADD', 'SUB', 'AND', 'OR', 'XOR', 'SLT'):
            if len(tokens) >= 4:
                rd = parse_reg(tokens[1])
                rs1 = parse_reg(tokens[2])
                if tokens[3].upper().startswith('R'):
                    rs2 = parse_reg(tokens[3])
                else:
                    imm = parse_val(tokens[3])
        elif op in ('ADDI', 'SUBI', 'ANDI', 'ORI', 'XORI'):
            if len(tokens) >= 4:
                rd = parse_reg(tokens[1])
                rs1 = parse_reg(tokens[2])
                imm = parse_val(tokens[3])
        elif op in ('LD', 'LW'):
            if len(tokens) >= 3:
                rd = parse_reg(tokens[1])
                target = tokens[2].strip('[]')
                if target.upper().startswith('R'):
                    rs1 = parse_reg(target)
                else:
                    imm = parse_val(target)
        elif op in ('ST', 'SW'):
            if len(tokens) >= 3:
                target = tokens[1].strip('[]')
                if target.upper().startswith('R'):
                    rs1 = parse_reg(target)
                else:
                    imm = parse_val(target)
                rs2 = parse_reg(tokens[2])
        elif op in ('BEQ', 'BNE'):
            if len(tokens) >= 4:
                rs1 = parse_reg(tokens[1])
                rs2 = parse_reg(tokens[2])
                imm = tokens[3]
        elif op in ('J', 'JAL'):
            if len(tokens) >= 2:
                imm = tokens[1]
                if op == 'JAL':
                    rd = 7
        elif op == 'JR':
            if len(tokens) >= 2:
                rs1 = parse_reg(tokens[1])

        return {
            'op': op,
            'rd': rd,
            'rs1': rs1,
            'rs2': rs2,
            'imm': imm,
            'raw': clean,
            'index': idx,
            'pc': idx * 4,
        }

    def load_program(self, assembly_text, forwarding=True):
        self.forwarding_enabled = forwarding
        self.instructions = []
        self.labels = {}
        raw_lines = assembly_text.splitlines()
        inst_idx = 0

        for line in raw_lines:
            clean = line.split(';')[0].strip()
            if not clean:
                continue
            if clean.endswith(':'):
                label_name = clean[:-1].strip()
                self.labels[label_name] = inst_idx * 4
                continue
            inst_idx += 1

        inst_idx = 0
        for line in raw_lines:
            clean = line.split(';')[0].strip()
            if not clean or clean.endswith(':'):
                continue
            parsed = self._parse_inst(clean, inst_idx)
            if parsed:
                self.instructions.append(parsed)
                inst_idx += 1

        self.reset()
        return {'status': 'loaded', 'num_instructions': len(self.instructions)}

    def reset(self):
        self.registers = [0] * 8
        self.memory = [0] * 256
        self.pc = 0
        self.cycle = 0
        self.is_halted = False
        self.is_paused = False
        self.stalls = 0
        self.flushes = 0
        self.completed = 0
        self.pipeline = {
            'IF_ID': {'pc': 0, 'valid': False, 'raw': 'NOP', 'inst': None},
            'ID_EX': {'pc': 0, 'valid': False, 'raw': 'NOP', 'inst': None},
            'EX_MEM': {'pc': 0, 'valid': False, 'raw': 'NOP', 'inst': None},
            'MEM_WB': {'pc': 0, 'valid': False, 'raw': 'NOP', 'inst': None},
        }
        return self.get_state()

    def step(self):
        if self.is_halted:
            return self.get_state()
        self.cycle += 1

        # WB stage
        mem_wb = self.pipeline['MEM_WB']
        if mem_wb['valid'] and mem_wb.get('inst'):
            inst = mem_wb['inst']
            rd = mem_wb.get('rd', 0)
            if rd > 0 and mem_wb.get('reg_write'):
                wb_data = mem_wb.get('mem_data') if mem_wb.get('mem_to_reg') else mem_wb.get('alu_result', 0)
                self.registers[rd] = wb_data & 0xFFFFFFFF
            self.completed += 1
            if inst.get('op') == 'HALT':
                self.is_halted = True

        # MEM stage
        ex_mem = self.pipeline['EX_MEM']
        next_mem_wb = {'valid': False, 'raw': 'NOP', 'inst': None}
        if ex_mem['valid'] and ex_mem.get('inst'):
            inst = ex_mem['inst']
            alu_res = ex_mem.get('alu_result', 0)
            rd = ex_mem.get('rd', 0)
            reg_write = ex_mem.get('reg_write', False)
            mem_to_reg = ex_mem.get('mem_to_reg', False)
            mem_data = 0

            if inst.get('op') in ('LD', 'LW'):
                addr = alu_res
                if 0 <= addr < len(self.memory):
                    mem_data = self.memory[addr]
            elif inst.get('op') in ('ST', 'SW'):
                addr = alu_res
                store_val = ex_mem.get('store_data', 0)
                if self.forwarding_enabled and mem_wb['valid'] and mem_wb.get('reg_write') and mem_wb.get('rd') == ex_mem.get('rs2') and mem_wb.get('rd') != 0:
                    store_val = mem_wb.get('mem_data') if mem_wb.get('mem_to_reg') else mem_wb.get('alu_result', 0)
                if 0 <= addr < len(self.memory):
                    self.memory[addr] = store_val & 0xFFFFFFFF

            next_mem_wb = {
                'valid': True,
                'raw': inst['raw'],
                'inst': inst,
                'pc': ex_mem['pc'],
                'rd': rd,
                'alu_result': alu_res,
                'mem_data': mem_data,
                'reg_write': reg_write,
                'mem_to_reg': mem_to_reg,
            }

        # EX stage
        id_ex = self.pipeline['ID_EX']
        next_ex_mem = {'valid': False, 'raw': 'NOP', 'inst': None}
        if id_ex['valid'] and id_ex.get('inst'):
            inst = id_ex['inst']
            op = inst['op']
            v1 = id_ex.get('val1', 0)
            v2 = id_ex.get('val2', 0)
            rd = id_ex.get('rd', 0)
            imm = id_ex.get('imm', 0)
            rs1 = id_ex.get('rs1', 0)
            rs2 = id_ex.get('rs2', 0)

            if self.forwarding_enabled:
                if ex_mem['valid'] and ex_mem.get('reg_write') and ex_mem.get('rd') != 0 and ex_mem.get('rd') == rs1:
                    v1 = ex_mem.get('alu_result', 0)
                elif mem_wb['valid'] and mem_wb.get('reg_write') and mem_wb.get('rd') != 0 and mem_wb.get('rd') == rs1:
                    v1 = mem_wb.get('mem_data') if mem_wb.get('mem_to_reg') else mem_wb.get('alu_result', 0)

                if ex_mem['valid'] and ex_mem.get('reg_write') and ex_mem.get('rd') != 0 and ex_mem.get('rd') == rs2:
                    v2 = ex_mem.get('alu_result', 0)
                elif mem_wb['valid'] and mem_wb.get('reg_write') and mem_wb.get('rd') != 0 and mem_wb.get('rd') == rs2:
                    v2 = mem_wb.get('mem_data') if mem_wb.get('mem_to_reg') else mem_wb.get('alu_result', 0)

            alu_res = 0
            reg_write = False
            mem_to_reg = False
            store_data = v2

            if op in ('ADD', 'ADDI'):
                alu_res = v1 + (imm if op == 'ADDI' else v2)
                reg_write = True
            elif op in ('SUB', 'SUBI'):
                alu_res = v1 - (imm if op == 'SUBI' else v2)
                reg_write = True
            elif op in ('AND', 'ANDI'):
                alu_res = v1 & (imm if op == 'ANDI' else v2)
                reg_write = True
            elif op in ('OR', 'ORI'):
                alu_res = v1 | (imm if op == 'ORI' else v2)
                reg_write = True
            elif op in ('XOR', 'XORI'):
                alu_res = v1 ^ (imm if op == 'XORI' else v2)
                reg_write = True
            elif op == 'SLT':
                alu_res = 1 if v1 < v2 else 0
                reg_write = True
            elif op in ('LD', 'LW'):
                alu_res = (v1 if rs1 > 0 else 0) + imm
                reg_write = True
                mem_to_reg = True
            elif op in ('ST', 'SW'):
                alu_res = (v1 if rs1 > 0 else 0) + imm
                store_data = v2
            elif op == 'JAL':
                alu_res = id_ex['pc'] + 4
                reg_write = True

            next_ex_mem = {
                'valid': True,
                'raw': inst['raw'],
                'inst': inst,
                'pc': id_ex['pc'],
                'rd': rd,
                'rs2': rs2,
                'alu_result': alu_res,
                'store_data': store_data,
                'reg_write': reg_write,
                'mem_to_reg': mem_to_reg,
            }

        # ID stage & Hazard Detection
        if_id = self.pipeline['IF_ID']
        next_id_ex = {'valid': False, 'raw': 'NOP', 'inst': None}
        stall = False
        flush = False
        branch_target = None

        if if_id['valid'] and if_id.get('inst'):
            inst = if_id['inst']
            op = inst['op']
            rd = inst['rd']
            rs1 = inst['rs1']
            rs2 = inst['rs2']
            imm = inst['imm']

            # Check Load-Use Hazard
            if id_ex['valid'] and id_ex.get('inst') and id_ex['inst'].get('op') in ('LD', 'LW'):
                load_rd = id_ex.get('rd', 0)
                if load_rd != 0 and (load_rd == rs1 or (load_rd == rs2 and op not in ('LD', 'LW', 'ADDI', 'SUBI', 'ANDI', 'ORI', 'XORI', 'J', 'JAL'))):
                    stall = True
                    self.stalls += 1

            # Check Load-to-Branch Hazard in MEM stage
            if ex_mem['valid'] and ex_mem.get('inst') and ex_mem['inst'].get('op') in ('LD', 'LW') and op in ('BEQ', 'BNE', 'JR'):
                load_rd = ex_mem.get('rd', 0)
                if load_rd != 0 and (load_rd == rs1 or load_rd == rs2):
                    stall = True
                    self.stalls += 1

            if not stall:
                v1 = self.registers[rs1] if rs1 < len(self.registers) else 0
                v2 = self.registers[rs2] if rs2 < len(self.registers) else 0

                taken = False
                if op == 'BEQ':
                    taken = (v1 == v2)
                elif op == 'BNE':
                    taken = (v1 != v2)
                elif op in ('J', 'JAL'):
                    taken = True
                elif op == 'JR':
                    taken = True
                    branch_target = v1

                if taken:
                    flush = True
                    self.flushes += 1
                    if branch_target is None:
                        if isinstance(imm, str) and imm in self.labels:
                            branch_target = self.labels[imm]
                        else:
                            try:
                                branch_target = if_id['pc'] + 4 + (int(imm) * 4 if isinstance(imm, (int, str)) and str(imm).lstrip('-').isdigit() else 0)
                            except Exception:
                                branch_target = if_id['pc'] + 4

                next_id_ex = {
                    'valid': True,
                    'raw': inst['raw'],
                    'inst': inst,
                    'pc': if_id['pc'],
                    'val1': v1,
                    'val2': v2,
                    'rd': rd,
                    'rs1': rs1,
                    'rs2': rs2,
                    'imm': int(imm) if isinstance(imm, int) or (isinstance(imm, str) and imm.lstrip('-').isdigit()) else 0,
                }

        # IF stage
        next_if_id = {'valid': False, 'raw': 'NOP', 'inst': None}
        if stall:
            next_if_id = dict(if_id)
        elif flush:
            next_if_id = {'valid': False, 'raw': 'NOP', 'inst': None}
            self.pc = branch_target if branch_target is not None else self.pc + 4
        else:
            inst_idx = self.pc // 4
            if 0 <= inst_idx < len(self.instructions):
                inst = self.instructions[inst_idx]
                next_if_id = {
                    'valid': True,
                    'raw': inst['raw'],
                    'inst': inst,
                    'pc': self.pc,
                }
                self.pc += 4
            else:
                next_if_id = {'valid': False, 'raw': 'NOP', 'inst': None}

        self.pipeline['MEM_WB'] = next_mem_wb
        self.pipeline['EX_MEM'] = next_ex_mem
        self.pipeline['ID_EX'] = next_id_ex
        self.pipeline['IF_ID'] = next_if_id

        self.registers[0] = 0

        if (self.pc // 4) >= len(self.instructions) and not any(l['valid'] for l in self.pipeline.values()):
            self.is_halted = True

        return self.get_state()

    def run(self, max_cycles=1000):
        while not self.is_halted and not self.is_paused and max_cycles > 0:
            self.step()
            max_cycles -= 1
        return self.get_state()

    def pause(self):
        self.is_paused = True
        return self.get_state()

    def get_state(self):
        cpi = (self.cycle / self.completed) if self.completed > 0 else 0.0
        return {
            'cycle': self.cycle,
            'pc': self.pc,
            'halted': self.is_halted,
            'paused': self.is_paused,
            'registers': self.registers,
            'memory': self.memory[:64],
            'pipeline': {k: {'valid': v.get('valid', False), 'raw': v.get('raw', 'NOP'), 'pc': v.get('pc', 0)} for k, v in self.pipeline.items()},
            'stats': {
                'completed': self.completed,
                'stalls': self.stalls,
                'flushes': self.flushes,
                'cpi': round(cpi, 2),
                'ipc': round(self.completed / self.cycle, 2) if self.cycle > 0 else 0.0,
            }
        }

backend_sim = BackendCPUSimulator()

# ──────────────────────────────────────────────────────────────────────────────
# HTTP Server Handler
# ──────────────────────────────────────────────────────────────────────────────
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def guess_type(self, path):
        if path.endswith('.js'):
            return 'application/javascript'
        return super().guess_type(path)

    def _send_json(self, data, code=200):
        body = json.dumps(data, indent=2).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        url = urllib.parse.urlparse(self.path).path
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8') if content_length > 0 else '{}'
        try:
            payload = json.loads(body) if body else {}
        except Exception:
            payload = {}

        if url in ('/program/load', '/api/program/load'):
            asm = payload.get('assembly', '')
            fwd = payload.get('forwarding', True)
            res = backend_sim.load_program(asm, fwd)
            self._send_json(res)
        elif url in ('/simulation/step', '/api/simulation/step'):
            state = backend_sim.step()
            self._send_json(state)
        elif url in ('/simulation/run', '/api/simulation/run'):
            cycles = payload.get('cycles', 100)
            state = backend_sim.run(cycles)
            self._send_json(state)
        elif url in ('/simulation/pause', '/api/simulation/pause'):
            state = backend_sim.pause()
            self._send_json(state)
        elif url in ('/simulation/reset', '/api/simulation/reset'):
            state = backend_sim.reset()
            self._send_json(state)
        else:
            self._send_json({'error': 'Endpoint not found'}, 404)

    def do_GET(self):
        url = urllib.parse.urlparse(self.path).path

        if url in ('/simulation/state', '/api/simulation/state'):
            self._send_json(backend_sim.get_state())
        elif url in ('/pipeline/state', '/api/pipeline/state'):
            self._send_json(backend_sim.pipeline)
        elif url in ('/registers', '/api/registers'):
            self._send_json({'registers': backend_sim.registers})
        elif url in ('/memory', '/api/memory'):
            query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            start = int(query.get('start', [0])[0])
            length = int(query.get('length', [64])[0])
            end = min(start + length, len(backend_sim.memory))
            self._send_json({'start': start, 'length': end - start, 'memory': backend_sim.memory[start:end]})
        elif url in ('/metrics', '/api/metrics'):
            self._send_json(backend_sim.get_state()['stats'])
        elif url in ('/api/tests/run', '/tests/run'):
            # Run test runner and return results
            try:
                browser_exe = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
                if not os.path.exists(browser_exe):
                    browser_exe = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

                test_url = f"http://localhost:{PORT}/test.html"
                cmd = [
                    browser_exe,
                    "--headless=new",
                    "--disable-gpu",
                    "--run-all-compositor-stages-before-draw",
                    "--virtual-time-budget=5000",
                    "--dump-dom",
                    test_url
                ]
                proc = subprocess.run(cmd, capture_output=True, text=True, timeout=12)
                match = re.search(r'<div id="results">(.*?)</div>', proc.stdout, re.DOTALL)
                if match:
                    raw_json = match.group(1).replace('&quot;', '"').replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&')
                    data = json.loads(raw_json)
                    self._send_json(data)
                    return
            except Exception as e:
                self._send_json({'error': str(e)}, 500)
                return
            self._send_json({'error': 'Could not execute tests'}, 500)
        else:
            # Serve regular static files
            super().do_GET()

if __name__ == '__main__':
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        url = f"http://localhost:{PORT}"
        print(f"\n  ⚡ SIMT-Flow Simulation Server & REST API")
        print(f"  -------------------------------------------")
        print(f"  Serving at: {url}")
        print(f"  REST API:   {url}/api/simulation/state")
        print(f"              {url}/api/registers")
        print(f"              {url}/api/metrics")
        print(f"              {url}/api/tests/run")
        print(f"  Press Ctrl+C to stop\n")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  Server stopped.")
