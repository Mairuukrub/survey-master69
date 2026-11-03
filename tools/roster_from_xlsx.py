#!/usr/bin/env python3
"""Turn the student roster workbook into the CSV that goes into the "students" tab of the Google Sheet.

    python -X utf8 tools/roster_from_xlsx.py "รายชื่อเขต 8.xlsx" students.csv

Expected columns of the first sheet (first row = header, skipped):
    A  student id        B  full name with title (นาย / นางสาว / นาง / ...)        C  faculty

Output columns: sid,first,last,faculty   (the title is dropped; first = first word after it, last = the rest)
Needs `pip install openpyxl`. KEEP THE OUTPUT OUT OF THE REPOSITORY (it is personal data): the web app is public.
In Google Sheets set column A to "Plain text" BEFORE pasting so long ids are not shown as 6.63E+10.
"""
import csv
import re
import sys

import openpyxl

TITLES = ("นางสาว", "นาง", "นาย", "น.ส.", "ด.ช.", "ด.ญ.", "Mr.", "Mr", "Miss", "Mrs.", "Mrs")


def split_name(full):
    full = " ".join(str(full).split())
    for t in sorted(TITLES, key=len, reverse=True):
        if full.startswith(t):
            full = full[len(t):].strip()
            break
    parts = full.split(" ")
    return parts[0], " ".join(parts[1:])


def main(src, dst):
    ws = openpyxl.load_workbook(src, data_only=True).worksheets[0]
    rows, seen, problems = [], set(), []
    for n, r in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if not any(c not in (None, "") for c in r[:3]):
            continue
        sid = re.sub(r"\s+", "", str(r[0] if r[0] is not None else ""))
        if sid.endswith(".0"):
            sid = sid[:-2]
        first, last = split_name(r[1] if r[1] is not None else "")
        faculty = str(r[2] if r[2] is not None else "").strip()
        if not sid or not first:
            problems.append(f"row {n}: missing id or name")
            continue
        if sid in seen:
            problems.append(f"row {n}: duplicate id {sid[:3]}***")
            continue
        seen.add(sid)
        rows.append([sid, first, last, faculty])
    with open(dst, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["sid", "first", "last", "faculty"])
        w.writerows(rows)
    print(f"{len(rows)} students written to {dst}")
    for p in problems:
        print("WARNING", p)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
