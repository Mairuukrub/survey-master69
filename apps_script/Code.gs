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
 */
const TEAM_CODE = "เปลี่ยนเป็นรหัสทีม";   // ← เปลี่ยนก่อน Deploy
const SHEET_NAME = "responses";
const LOG_SHEET = "log";

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * GET ?token=…            = ทดสอบการเชื่อมต่อ (คืนแค่จำนวนแถว)
 * GET ?token=…&action=rows = ข้อมูลทั้งหมด สำหรับหน้าวิเคราะห์ (dashboard.html) — ต้องมีรหัสทีม
 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.token !== TEAM_CODE) return json_({ ok: false, error: "รหัสทีมไม่ถูกต้อง" });
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

function log_(msg) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const lg = ss.getSheetByName(LOG_SHEET) || ss.insertSheet(LOG_SHEET);
  lg.appendRow([new Date(), msg]);
}
