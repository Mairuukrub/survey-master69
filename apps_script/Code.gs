/**
 * ตัวรับข้อมูลแบบสัมภาษณ์ → Google Sheets
 *
 * วิธีติดตั้ง (ทำครั้งเดียว):
 *   1. สร้าง Google Sheet ใหม่ → เมนู ส่วนขยาย (Extensions) → Apps Script
 *   2. ลบโค้ดเดิม วางไฟล์นี้ทั้งไฟล์ แล้วเปลี่ยน TEAM_CODE ด้านล่างเป็นรหัสของทีม
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
 */
const TEAM_CODE = "เปลี่ยนเป็นรหัสทีม";        // ← เปลี่ยนก่อน Deploy (นักศึกษาทุกคนใช้)
const ADMIN_CODE = "เปลี่ยนเป็นรหัสผู้ดูแล";    // ← เปลี่ยนก่อน Deploy (เฉพาะผู้แก้แบบสอบถาม ห้ามซ้ำกับ TEAM_CODE)
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
 * GET ?token=…&action=rows         = ข้อมูลทั้งหมด สำหรับหน้าวิเคราะห์ (dashboard.html) — ต้องมีรหัสทีม
 * GET ?token=…&action=form         = แบบสอบถามเวอร์ชันล่าสุดที่ผู้ดูแลเผยแพร่ (form: null ถ้ายังไม่เคยเผยแพร่)
 * GET ?token=…&action=form&version=v = เวอร์ชันที่ระบุ
 * GET ?token=…&action=formHistory  = รายการเวอร์ชันทั้งหมด
 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.token !== TEAM_CODE) return json_({ ok: false, error: "รหัสทีมไม่ถูกต้อง" });
  if (p.action === "form") return json_(getForm_(p.version));
  if (p.action === "formHistory") return json_(formHistory_());
  const sh = sheet_();
  if (p.action === "rows") {
    const values = sh.getLastRow() > 0 ? sh.getDataRange().getDisplayValues() : [];
    const header = values.shift() || [];
    return json_({ ok: true, header: header, rows: values });
  }
  return json_({ ok: true, rows: Math.max(0, sh.getLastRow() - 1) });
}

/** POST = รับข้อมูล: { token, columns:[...], textColumns:[...], records:[{uuid,...}, ...] } */
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const body = JSON.parse(e.postData.contents);
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
        sh.getRange(at + 2, 1, 1, row.length).setValues([row]);   // re-sent after an edit: update in place
      } else {
        sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
        ids.push(String(r.uuid));
      }
      saved.push(r.uuid);
    });
    log_(`saved ${saved.length} (${saved.slice(0, 3).join(", ")}${saved.length > 3 ? ", …" : ""})`);
    return json_({ ok: true, saved: saved });
  } catch (err) {
    log_("error " + err);
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function adminReady_() {
  return ADMIN_CODE && ADMIN_CODE !== "เปลี่ยนเป็นรหัสผู้ดูแล" && ADMIN_CODE !== TEAM_CODE && ADMIN_CODE.length >= 6;
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
