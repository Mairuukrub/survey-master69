#!/usr/bin/env python3
"""Set APP_BUILD in version.js to the current time (YYYY-MM-DD.HHMM).

Run it before every push that changes the app, so every phone notices the new version:
    python tools/bump_build.py
"""
import datetime, pathlib, re

path = pathlib.Path(__file__).resolve().parent.parent / "version.js"
text = path.read_text(encoding="utf-8")
build = datetime.datetime.now().strftime("%Y-%m-%d.%H%M")
new, n = re.subn(r'(APP_BUILD\s*=\s*")[^"]*(")', lambda m: m.group(1) + build + m.group(2), text)
if n != 1:
    raise SystemExit("APP_BUILD line not found in version.js")
path.write_text(new, encoding="utf-8", newline="")
print("APP_BUILD =", build)
