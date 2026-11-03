/**
 * ตัวรับข้อมูลแบบสัมภาษณ์ → Google Sheets
 *
 * วิธีติดตั้ง (ทำครั้งเดียว):
 *   1. สร้าง Google Sheet ใหม่ → เมนู ส่วนขยาย (Extensions) → Apps Script
 *   2. ลบโค้ดเดิม วางไฟล์นี้ทั้งไฟล์ แล้วเปลี่ยน TEAM_CODE, READ_CODE (และ ADMIN_CODE ถ้าจะแก้แบบสอบถาม) ด้านล่าง
 *   3. กด Deploy → New deployment → เลือกชนิด Web app
 *        Execute as: Me   ·   Who has access: Anyone
 *   4. กด Deploy → อนุญาตสิทธิ์ (Authorize) → คัดลอก Web app URL (ลงท้ายด้วย /exec)
 *   5. ในเว็บแบบสัมภาษณ์ เมนู ตั้งค่า → วาง URL และรหัสทีม → ทดสอบการเชื่อมต่อ
 *
 * "Anyone" หมายถึงใครก็ส่งข้อมูลมาที่ URL นี้ได้ แต่ข้อมูลจะถูกบันทึกเฉพาะเมื่อรหัสทีมถูกต้อง
 * ตัว Sheet ยังเป็นของคุณคนเดียว (แชร์ให้ใครดูเองตามต้องการ)
 *
 * v2: ผู้ดูแลแก้แบบสอบถามได้จากหน้า admin.html → เก็บทุกเวอร์ชันไว้ในชีต "forms"
 *     ต้องตั้ง ADMIN_CODE (คนละรหัสกับ TEAM_CODE ให้เฉพาะผู้ดูแล) แล้ว Deploy → Manage deployments → New version
 * v4: รหัสนักศึกษา — ชีต "students" (หัวหน้าทีมกรอก: sid | first | last | faculty) ให้แอปเติมชื่อ/คณะจากรหัส (action "student" ใช้รหัสทีม คืนเฉพาะชื่อของรหัสที่ถาม)
 *     ตอนบันทึก สคริปต์ตรวจรหัสกับรายชื่อเอง (คอลัมน์ iv_sid_ok) และจดทุกครั้งที่ส่ง/แก้ลงชีต "activity" (เวลา รหัส ชื่อ ชุด สร้าง/แก้ คอลัมน์ที่เปลี่ยน — ไม่เก็บค่าคำตอบ)
 *     action "mine" (รหัสทีม) คืนรายการชุดที่ส่งแล้วของรหัสนักศึกษาหนึ่งคน (บ้านเลขที่ เพศ อายุ วันที่ ความครบ — ไม่มีคำตอบรายข้อ) สำหรับหน้า "รายการของฉัน"
 * v3: รหัส 3 ระดับ — รหัสทีมส่งข้อมูลได้อย่างเดียว อ่านข้อมูลดิบไม่ได้ (ข้อมูลสุขภาพ, PDPA)
 *     หน้าวิเคราะห์ใช้ READ_CODE (หรือ ADMIN_CODE) และส่งรหัสใน POST body ไม่ใส่ใน URL
 */
const TEAM_CODE = "เปลี่ยนเป็นรหัสทีม";        // ← นักศึกษาทุกคนใช้: ส่งข้อมูล + โหลดแบบสอบถาม (อ่านข้อมูลที่ส่งแล้วไม่ได้)
const READ_CODE = "เปลี่ยนเป็นรหัสดูผล";      // ← หัวหน้าทีม/อาจารย์: เปิดหน้าวิเคราะห์และดาวน์โหลดข้อมูล (ยาว 6 ตัวขึ้นไป ห้ามซ้ำกับ TEAM_CODE)
const ADMIN_CODE = "เปลี่ยนเป็นรหัสผู้ดูแล";    // ← ผู้แก้แบบสอบถาม: ทำได้ทุกอย่าง (ยาว 6 ตัวขึ้นไป ห้ามซ้ำกับรหัสอื่น)
const SHEET_NAME = "responses";
const LOG_SHEET = "log";
const FORM_SHEET = "forms";      // 1 แถว = 1 เวอร์ชัน: saved_at | version | note | sections | questions | json (แบ่งหลายช่อง)
const CHUNK = 45000;             // 1 ช่องของ Google Sheets เก็บได้ไม่เกิน 50,000 ตัวอักษร

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------- questionnaire versions
function formSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(FORM_SHEET);
  if (!sh) {
    sh = ss.insertSheet(FORM_SHEET);
    sh.getRange(1, 1, 1, 6).setValues([["saved_at", "version", "note", "sections", "questions", "json (ต่อกันทุกช่องในแถว)"]]).setFontWeight("bold");
    sh.setFrozenRows(1);
  }
  return sh;
}
function formRows_() {
  const sh = formSheet_();
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
}
const iso_ = (d) => (d instanceof Date ? d.toISOString() : String(d));
function getForm_(version) {
  const rows = formRows_();
  const r = version ? rows.filter((x) => String(x[1]) === version).pop() : rows[rows.length - 1];
  if (!r) return { ok: true, form: null };
  return { ok: true, form: JSON.parse(r.slice(5).join("")), version: String(r[1]), saved_at: iso_(r[0]), note: String(r[2]) };
}
function formHistory_() {
  return { ok: true, versions: formRows_().map((r) => ({ saved_at: iso_(r[0]), version: String(r[1]), note: String(r[2]), sections: r[3], questions: r[4] })) };
}

/**
 * GET ?token=…                     = ทดสอบการเชื่อมต่อ (คืนแค่จำนวนแถว)
 * GET ?token=…&action=form         = แบบสอบถามเวอร์ชันล่าสุดที่ผู้ดูแลเผยแพร่ (form: null ถ้ายังไม่เคยเผยแพร่)
 * GET ?token=…&action=form&version=v = เวอร์ชันที่ระบุ
 * GET ?token=…&action=formHistory  = รายการเวอร์ชันทั้งหมด
 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.token !== TEAM_CODE) return json_({ ok: false, error: "รหัสทีมไม่ถูกต้อง" });
  if (p.action === "form") return json_(getForm_(p.version));
  if (p.action === "formHistory") return json_(formHistory_());
  if (p.action === "rows") return json_({ ok: false, error: "หน้าวิเคราะห์ต้องใช้รหัสดูผล (READ_CODE) — โหลดหน้าวิเคราะห์เวอร์ชันใหม่" });
  const sh = sheet_();
  return json_({ ok: true, rows: Math.max(0, sh.getLastRow() - 1) });
}

/** POST { action:"rows" | "publishedForm", readCode } — หน้าวิเคราะห์ (ไม่ต้องรอ lock เพราะอ่านอย่างเดียว) */
function readAction_(body) {
  if (!codeReady_(READ_CODE, "เปลี่ยนเป็นรหัสดูผล") && !adminReady_()) return json_({ ok: false, error: "ยังไม่ได้ตั้ง READ_CODE ใน Apps Script (ยาว 6 ตัวขึ้นไป และไม่ซ้ำกับรหัสทีม)" });
  const ok = (codeReady_(READ_CODE, "เปลี่ยนเป็นรหัสดูผล") && body.readCode === READ_CODE) || (adminReady_() && body.readCode === ADMIN_CODE);
  if (!ok) { log_(`${body.action}: wrong read code`); return json_({ ok: false, error: "รหัสดูผลไม่ถูกต้อง" }); }
  if (body.action === "publishedForm") return json_(getForm_());
  if (body.action === "activity") {   // latest 300 save/edit events
    const ash = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ACTIVITY_SHEET);
    if (!ash || ash.getLastRow() < 2) return json_({ ok: true, rows: [] });
    const n = Math.min(300, ash.getLastRow() - 1);
    return json_({ ok: true, rows: ash.getRange(ash.getLastRow() - n + 1, 1, n, ACTIVITY_HEADER.length).getDisplayValues() });
  }
  const sh = sheet_();
  const values = sh.getLastRow() > 0 ? sh.getDataRange().getDisplayValues() : [];
  const header = values.shift() || [];
  return json_({ ok: true, header: header, rows: values });
}

/** POST = รับข้อมูล: { token, columns:[...], textColumns:[...], records:[{uuid,...}, ...] } */
function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: "คำขอไม่ถูกต้อง" }); }
  if (body.action === "rows" || body.action === "publishedForm" || body.action === "activity") return readAction_(body);
  if (body.action === "student") return studentAction_(body);
  if (body.action === "mine") return mineAction_(body);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // admin page: every request carries the admin code in the POST body (never in the URL)
    if (["checkAdmin", "getForm", "formHistory", "saveForm"].indexOf(body.action) >= 0) {
      if (!adminReady_()) return json_({ ok: false, error: "ยังไม่ได้ตั้ง ADMIN_CODE ใน Apps Script (ต้องยาว 6 ตัวขึ้นไป และไม่ซ้ำกับรหัสทีม)" });
      if (body.adminCode !== ADMIN_CODE) { log_(`${body.action}: wrong admin code`); return json_({ ok: false, error: "รหัสผู้ดูแลไม่ถูกต้อง" }); }
      if (body.action === "checkAdmin") return json_({ ok: true });
      if (body.action === "getForm") return json_(getForm_(body.version));
      if (body.action === "formHistory") return json_(formHistory_());
      return saveForm_(body);
    }
    if (body.token !== TEAM_CODE) return json_({ ok: false, error: "รหัสทีมไม่ถูกต้อง" });
    const recs = body.records || [];
    if (!recs.length) return json_({ ok: true, saved: [] });
    const roster = loadRoster_();   // null when nobody filled the "students" tab yet: then nothing is checked or overwritten
    if (roster) recs.forEach((r) => {
      const s = r.iv_sid ? roster[normSid_(r.iv_sid)] : null;
      r.iv_sid_ok = s ? 1 : 0;
      if (s) { if (s.first) r.iv_first = s.first; if (s.last) r.iv_last = s.last; }   // names come from the roster, not from typing
    });
    const events = [];

    const sh = sheet_();
    // header: the form's column order first, then anything new (a later form version adds columns at the end)
    let header = sh.getLastRow() > 0 ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].filter(String) : [];
    const want = (body.columns || []).concat(...recs.map(Object.keys));
    want.forEach((k) => { if (header.indexOf(k) < 0) header.push(k); });
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight("bold");
    sh.setFrozenRows(1);
    // keep house numbers like 12/3 or dates as text (Sheets would turn them into dates)
    (body.textColumns || []).forEach((k) => {
      const c = header.indexOf(k) + 1;
      if (c > 0) sh.getRange(2, c, Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat("@");
    });

    const uuidCol = header.indexOf("uuid") + 1;
    const n = sh.getLastRow() - 1;
    const ids = n > 0 ? sh.getRange(2, uuidCol, n, 1).getValues().map((r) => String(r[0])) : [];
    const saved = [];
    recs.forEach((r) => {
      const row = header.map((k) => (r[k] === undefined || r[k] === null ? "" : r[k]));
      const at = ids.indexOf(String(r.uuid));
      if (at >= 0) {
        const old = sh.getRange(at + 2, 1, 1, Math.min(header.length, sh.getMaxColumns())).getValues()[0];
        const changed = changedCols_(header, old, row);
        events.push(activityRow_(r, changed.length ? "update" : "resend", changed));
        sh.getRange(at + 2, 1, 1, row.length).setValues([row]);   // re-sent after an edit: update in place
      } else {
        events.push(activityRow_(r, "new", []));
        sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
        ids.push(String(r.uuid));
      }
      saved.push(r.uuid);
    });
    try { writeActivity_(events); } catch (err) { log_("activity error " + err); }   // the log must never stop a save
    log_(`saved ${saved.length} (${saved.slice(0, 3).join(", ")}${saved.length > 3 ? ", …" : ""})`);
    return json_({ ok: true, saved: saved });
  } catch (err) {
    log_("error " + err);
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- student roster + activity log
const STUDENT_SHEET = "students";   // filled by the team lead: sid | first | last | faculty
const ACTIVITY_SHEET = "activity";  // one row per save or edit
const ACTIVITY_HEADER = ["time", "sid", "name", "uuid", "record_id", "action", "form_version", "complete_pct", "changed_columns"];
const ACTIVITY_SKIP = ["updated_at", "submitted_at", "created_at", "started_at", "finished_at", "duration_min", "complete_pct", "iv_sid_ok"];
function normSid_(v) {
  return String(v == null ? "" : v).replace(/[๐-๙]/g, (c) => "๐๑๒๓๔๕๖๗๘๙".indexOf(c)).replace(/[\s​]+/g, "").toUpperCase();
}
function loadRoster_() {   // { SID: {first, last, faculty} } or null when there is no roster yet
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(STUDENT_SHEET);
  if (!sh || sh.getLastRow() < 1 || sh.getLastColumn() < 1) return null;
  const vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  const names = { sid: ["sid", "id", "student_id", "รหัส", "รหัสนักศึกษา"], first: ["first", "ชื่อ"], last: ["last", "นามสกุล"], faculty: ["faculty", "คณะ"] };
  const head = vals[0].map((x) => String(x).trim().toLowerCase());
  const at = {};
  let isHead = false;
  Object.keys(names).forEach((k, n) => {
    const i = head.findIndex((h) => names[k].indexOf(h) >= 0);
    if (i >= 0) isHead = true;
    at[k] = i >= 0 ? i : n;   // columns not named in a header row fall back to their position
  });
  const out = {};
  for (let i = isHead ? 1 : 0; i < vals.length; i++) {
    const sid = normSid_(vals[i][at.sid]);
    if (sid) out[sid] = { first: String(vals[i][at.first] || "").trim(), last: String(vals[i][at.last] || "").trim(), faculty: String(vals[i][at.faculty] || "").trim() };
  }
  return Object.keys(out).length ? out : null;
}
/** POST { action:"student", token, sid } — คืนเฉพาะชื่อ/คณะของรหัสที่ถาม ไม่ส่งรายชื่อทั้งหมด (อ่านอย่างเดียว ไม่ต้อง lock) */
function studentAction_(body) {
  if (body.token !== TEAM_CODE) return json_({ ok: false, error: "รหัสทีมไม่ถูกต้อง" });
  const roster = loadRoster_();
  if (!roster) return json_({ ok: true, found: false, noRoster: true });
  const s = roster[normSid_(body.sid)];
  return json_(s ? { ok: true, found: true, first: s.first, last: s.last, faculty: s.faculty } : { ok: true, found: false });
}
function changedCols_(header, old, row) {   // names of the columns whose value differs (values are never copied into the log)
  const out = [];
  header.forEach((k, i) => { if (ACTIVITY_SKIP.indexOf(k) < 0 && String(old[i] === undefined ? "" : old[i]) !== String(row[i])) out.push(k); });
  return out;
}
function activityRow_(r, action, changed) {
  return [new Date().toISOString(), String(r.iv_sid || ""), [r.iv_first, r.iv_last].filter(Boolean).join(" "), String(r.uuid || ""), String(r.record_id || ""), action,
    String(r.form_version || ""), r.complete_pct === undefined ? "" : r.complete_pct, changed.slice(0, 40).join(",")];
}
function writeActivity_(events) {
  if (!events.length) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(ACTIVITY_SHEET);
  if (!sh) {
    sh = ss.insertSheet(ACTIVITY_SHEET);
    sh.getRange(1, 1, 1, ACTIVITY_HEADER.length).setValues([ACTIVITY_HEADER]).setFontWeight("bold");
    sh.getRange(2, 1, Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat("@");   // keep the ISO time as text (Sheets would turn it into a date)
    sh.setFrozenRows(1);
  }
  sh.getRange(sh.getLastRow() + 1, 1, events.length, ACTIVITY_HEADER.length).setValues(events);
}

/** POST { action:"mine", token, sid } — ชุดที่ส่งแล้วของรหัสนักศึกษานี้ (ไม่รวมแถว MOCK และแถวที่ใส่ 1 ในคอลัมน์ exclude) ไม่มีคำตอบรายข้อ ไม่มีวันเกิด */
function mineAction_(body) {
  if (body.token !== TEAM_CODE) return json_({ ok: false, error: "รหัสทีมไม่ถูกต้อง" });
  const sid = normSid_(body.sid);
  const sh = sheet_();
  if (!sid || sh.getLastRow() < 2 || sh.getLastColumn() < 1) return json_({ ok: true, rows: [] });
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getDisplayValues();
  const ix = {};
  ["uuid", "record_id", "iv_zone", "iv_sid", "h_house_type", "h_moo", "h_house_no", "q1_1", "q1_2_age", "iv_date", "complete_pct", "submitted_at", "exclude"].forEach((k) => (ix[k] = header.indexOf(k)));
  const get = (row, k) => (ix[k] < 0 ? "" : String(row[ix[k]]).trim());
  const isEx = (v) => v !== "" && ["0", "no", "n", "false", "ไม่"].indexOf(v.toLowerCase()) < 0;
  const rows = [];
  vals.forEach((row) => {
    if (normSid_(get(row, "iv_sid")) !== sid) return;
    if (get(row, "record_id").indexOf("MOCK") === 0 || get(row, "iv_zone") === "MOCK" || isEx(get(row, "exclude"))) return;
    rows.push({ uuid: get(row, "uuid"), record_id: get(row, "record_id"), date: get(row, "iv_date"), htype: get(row, "h_house_type"), moo: get(row, "h_moo"), no: get(row, "h_house_no"),
      sex: get(row, "q1_1"), age: get(row, "q1_2_age"), pct: get(row, "complete_pct"), t: get(row, "submitted_at") });
  });
  return json_({ ok: true, rows: rows.slice(-300).reverse() });   // newest first (rows are appended in the order they were first sent)
}

// a code is usable once it was changed from the placeholder, is long enough and differs from the team code
function codeReady_(code, placeholder) {
  return !!code && code !== placeholder && code !== TEAM_CODE && code.length >= 6;
}
function adminReady_() {
  return codeReady_(ADMIN_CODE, "เปลี่ยนเป็นรหัสผู้ดูแล") && ADMIN_CODE !== READ_CODE;
}

/** POST { action:"saveForm", adminCode, form:{version, title, sections:[…]}, note } — เพิ่มเป็นเวอร์ชันใหม่ ไม่ทับของเดิม */
function saveForm_(body) {
  const f = body.form;
  if (!f || !f.version || !Array.isArray(f.sections) || !f.sections.length) return json_({ ok: false, error: "แบบสอบถามไม่ครบ (ต้องมี version และ sections)" });
  const version = String(f.version).trim();
  if (formRows_().some((r) => String(r[1]) === version)) return json_({ ok: false, error: `มีเวอร์ชัน “${version}” อยู่แล้ว ตั้งชื่อเวอร์ชันใหม่` });
  const text = JSON.stringify(f);
  const chunks = [];
  for (let i = 0; i < text.length; i += CHUNK) chunks.push(text.slice(i, i + CHUNK));
  const nq = f.sections.reduce((n, s) => n + ((s.q || []).length), 0);
  const sh = formSheet_();
  const row = [new Date(), version, String(body.note || "").slice(0, 500), f.sections.length, nq].concat(chunks);
  const at = sh.getLastRow() + 1;
  sh.getRange(at, 6, 1, chunks.length).setNumberFormat("@");   // keep JSON as plain text
  sh.getRange(at, 1, 1, row.length).setValues([row]);
  log_(`saveForm ${version} (${f.sections.length} sections, ${nq} questions, ${text.length} chars)`);
  return json_({ ok: true, version: version, saved_at: row[0].toISOString() });
}

function log_(msg) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const lg = ss.getSheetByName(LOG_SHEET) || ss.insertSheet(LOG_SHEET);
  lg.appendRow([new Date(), msg]);
}
