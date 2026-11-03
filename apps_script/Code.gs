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
 * v4: ตรวจบ้านข้ามเครื่อง — action "house" (ใช้รหัสทีม) บอกว่าบ้านเลขที่นี้มีข้อมูลในระบบแล้วกี่ชุด (เพศ อายุ วันที่ ผู้สัมภาษณ์) กับจำนวนรวม ไม่คืนชื่อ วันเกิด หรือคำตอบ
 *     วางไฟล์นี้ทับของเดิม (คัดลอกรหัสเดิมกลับมาใส่) แล้ว Deploy → Manage deployments → แก้ไข → Version: New version → Deploy (URL เดิมใช้ต่อได้)
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
  const sh = sheet_();
  const values = sh.getLastRow() > 0 ? sh.getDataRange().getDisplayValues() : [];
  const header = values.shift() || [];
  return json_({ ok: true, header: header, rows: values });
}

/** POST = รับข้อมูล: { token, columns:[...], textColumns:[...], records:[{uuid,...}, ...] } */
function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: "คำขอไม่ถูกต้อง" }); }
  if (body.action === "rows" || body.action === "publishedForm") return readAction_(body);
  if (body.action === "house") return houseAction_(body);
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

// house numbers typed many ways ("12-3", "๑๒/๓", "12 / 3") become one form ("12/3") — same rule as the web app (form_core.js)
function normNo_(s) {
  return String(s == null ? "" : s).replace(/[๐-๙]/g, (c) => "๐๑๒๓๔๕๖๗๘๙".indexOf(c)).replace(/[\s​]+/g, "").replace(/[-–—\\／]/g, "/");
}

/**
 * POST { action:"house", token, moo, no, uuid } — นักศึกษาตรวจว่าบ้านนี้มีข้อมูลในระบบแล้วหรือยัง (ใช้รหัสทีม)
 * คืน sets = ชุดของบ้านนั้น [{sex, age, date, by, fac}] (ไม่รวมชุด uuid ของตัวเอง) และ total = {people, houses} ทั้งหมู่บ้าน
 * ไม่คืนชื่อผู้ตอบ วันเกิด หรือคำตอบรายข้อ · ไม่นับแถว MOCK และแถวที่หัวหน้าทีมใส่ 1 ในคอลัมน์ exclude · อ่านอย่างเดียว (ไม่ต้อง lock) · moo/no ว่าง = ขอเฉพาะจำนวนรวม
 */
function houseAction_(body) {
  if (body.token !== TEAM_CODE) return json_({ ok: false, error: "รหัสทีมไม่ถูกต้อง" });
  const sh = sheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2 || sh.getLastColumn() < 1) return json_({ ok: true, sets: [], total: { people: 0, houses: 0 } });
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const n = lastRow - 1;
  const col = (k) => {
    const c = header.indexOf(k);
    return c < 0 ? new Array(n).fill("") : sh.getRange(2, c + 1, n, 1).getDisplayValues().map((r) => String(r[0]).trim());
  };
  const uuid = col("uuid"), rid = col("record_id"), zone = col("iv_zone"), htype = col("h_house_type");
  const moo = col("h_moo"), no = col("h_house_no"), sex = col("q1_1"), age = col("q1_2_age");
  const date = col("iv_date"), by = col("iv_first"), fac = col("iv_faculty"), excl = col("exclude");
  const isEx = (v) => v !== "" && ["0", "no", "n", "false", "ไม่"].indexOf(v.toLowerCase()) < 0;   // team lead marked this row to leave out
  const wantNo = normNo_(body.no), wantMoo = String(body.moo || "").trim();
  const wantKey = wantNo && wantMoo ? wantMoo + "|" + wantNo : "";
  const mine = String(body.uuid || "");
  const houses = {};
  let people = 0, noKey = 0;
  const sets = [];
  for (let i = 0; i < n; i++) {
    if (rid[i].indexOf("MOCK") === 0 || zone[i] === "MOCK" || isEx(excl[i])) continue;
    people++;
    const nn = normNo_(no[i]);
    const key = (htype[i] === "" || htype[i] === "1") && /^\d/.test(nn) && moo[i] !== "" ? moo[i] + "|" + nn : "";
    if (key) houses[key] = 1; else noKey++;
    if (wantKey && key === wantKey && uuid[i] !== mine && sets.length < 30) sets.push({ sex: sex[i], age: age[i], date: date[i], by: by[i], fac: fac[i] });
  }
  return json_({ ok: true, sets: sets, total: { people: people, houses: Object.keys(houses).length + noKey } });
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
