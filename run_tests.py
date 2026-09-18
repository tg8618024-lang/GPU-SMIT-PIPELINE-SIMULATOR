"""
Automated Verification Runner for SIMT-Flow
Runs all 18 microarchitectural verification tests using Chrome Headless.
"""
import http.server
import socketserver
import subprocess
import threading
import os
import sys
import json
import re
import time

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

PORT = 8009
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def log_message(self, format, *args):
        pass # suppress access logs

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def guess_type(self, path):
        if path.endswith('.js'):
            return 'application/javascript'
        return super().guess_type(path)

def run_server():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), QuietHandler) as httpd:
        httpd.serve_forever()

def main():
    # Start server in background thread
    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()
    time.sleep(0.5)

    chrome_paths = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    ]
    browser_exe = None
    for p in chrome_paths:
        if os.path.exists(p):
            browser_exe = p
            break

    if not browser_exe:
        print("ERROR: Neither Chrome nor Edge found.")
        sys.exit(1)

    url = f"http://localhost:{PORT}/test.html"
    cmd = [
        browser_exe,
        "--headless=new",
        "--disable-gpu",
        "--dump-dom",
        url
    ]

    try:
        proc = subprocess.run(cmd, capture_output=True, encoding='utf-8', errors='replace', timeout=15)
        output = proc.stdout
    except Exception as e:
        print(f"Error executing browser: {e}")
        sys.exit(1)

    # Extract JSON inside <div id="results">...</div>
    match = re.search(r'<div id="results">(.*?)</div>', output, re.DOTALL)
    if not match:
        print("Failed to find #results in browser output.")
        print(output[:500])
        sys.exit(1)

    raw_json = match.group(1).strip()
    # Unescape HTML entities if needed
    raw_json = raw_json.replace('&quot;', '"').replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&')

    try:
        data = json.loads(raw_json)
    except Exception as e:
        print(f"JSON parse error: {e}")
        print("Raw text:", raw_json[:300])
        sys.exit(1)

    if "error" in data:
        print(f"FAILED with runtime error: {data['error']}")
        sys.exit(1)

    print("\n" + "=" * 65)
    print(" ⚡ SIMT-FLOW HARDWARE VERIFICATION SUITE RESULTS")
    print("=" * 65)

    for item in data.get("results", []):
        status = "✓ PASS" if item.get("passed") else "✗ FAIL"
        name = item.get("name", "Test")
        details = item.get("details", "")
        print(f" [{status}] {name}")
        if not item.get("passed"):
            print(f"          Expected: {item.get('expected')}")
            print(f"          Actual:   {item.get('actual')}")
            print(f"          Details:  {details}")

    print("-" * 65)
    total = data.get("total", 0)
    passed = data.get("passed", 0)
    failed = data.get("failed", 0)
    print(f" Summary: {passed}/{total} Passed, {failed} Failed")

    # ─── Check index.html UI Rendering ────────────────────────────────────────
    print("\n" + "=" * 65)
    print(" 🖥️  INDEX.HTML UI RENDERING SANITY CHECK")
    print("=" * 65)
    ui_passed = False
    try:
        ui_url = f"http://localhost:{PORT}/index.html"
        cmd_ui = [
            browser_exe,
            "--headless=new",
            "--disable-gpu",
            "--dump-dom",
            ui_url
        ]
        proc_ui = subprocess.run(cmd_ui, capture_output=True, encoding='utf-8', errors='replace', timeout=12)
        dom = proc_ui.stdout
        checks = [
            ("SVG Datapath", "<svg" in dom),
            ("Reservation Table", "pipeline-grid" in dom or "pipeline-scroll-wrapper" in dom),
            ("Register Table", "reg-table" in dom or "Register File" in dom),
            ("Tab Buttons", "tab-btn" in dom),
            ("Preset Select", "preset-select" in dom),
        ]
        all_ui_ok = True
        for name, ok in checks:
            status = "✓ PASS" if ok else "✗ FAIL"
            print(f" [{status}] UI Element: {name}")
            if not ok:
                all_ui_ok = False
        ui_passed = all_ui_ok
    except Exception as e:
        print(f" UI Check Error: {e}")

    print("=" * 65 + "\n")

    if failed > 0 or not ui_passed:
        sys.exit(1)
    else:
        sys.exit(0)

if __name__ == '__main__':
    main()
