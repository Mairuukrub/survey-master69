(() => {
  "use strict";

  const S = window.SURVEY;  // chosen by form_core.js: admin-published form, built-in default, or a draft in ?preview=1
  const PREVIEW = M69.preview;
  const app = document.getElementById("app");
  // preview keeps its practice records apart from real interviews and never sends them
  const LS = { records: PREVIEW ? "m69.preview.records" : "m69.records", settings: "m69.settings", remember: "m69.remember", backup: "m69.lastBackup" };
  const TH_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
  const BATCH = 20;

  // ------------------------------------------------------------ storage
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  let records = load(LS.records, {});
  let settings = { api: "", team: "", ...load(LS.settings, {}) };
  const saveRecords = () => {
    if (!store(LS.records, records)) toast("บันทึกในเครื่องไม่สำเร็จ (พื้นที่เต็ม?) กรุณาส่งข้อมูลหรือดาวน์โหลดสำรอง", true);
  };

  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); }));
  const nowIso = () => new Date().toISOString();
  const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

  // ------------------------------------------------------------ dom helper (text only, never innerHTML)
  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (k === "class") n.className = v;
      else if (k === "value") n.value = v;
      else if (k === "checked") n.checked = !!v;
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return n;
  }
  const mount = (node, ...kids) => node.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));

  let toastTimer;
  function toast(msg, bad = false) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.className = "toast show" + (bad ? " bad" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = "toast"), 3500);
  }

  // ------------------------------------------------------------ schema helpers
  const allQuestions = S.sections.flatMap((s) => s.q.map((q) => ({ ...q, section: s.id })));
  const visible = (q, a) => M69.evalRule(q.show, a);

  function isAnswered(q, a) {
    switch (q.type) {
      case "multi": return Array.isArray(a[q.id]) && a[q.id].length > 0;
      case "grid": return q.rows.every((r) => a[r.id] != null);
      case "dob": return a.q1_2_age != null && a.q1_2_age !== "";
      case "animals": return q.animals.some((x) => a[`${q.id}_${x.key}_has`] != null);
      case "computed": return true;
      default: return a[q.id] != null && a[q.id] !== "";
    }
  }

  function computeAge(a) {
    const y = Number(a.q1_2_year_be);
    if (!y) return null;
    const by = y - 543, m = Number(a.q1_2_month) || 1, d = Number(a.q1_2_day) || 1;
    const t = new Date();
    let age = t.getFullYear() - by;
    if (t.getMonth() + 1 < m || (t.getMonth() + 1 === m && t.getDate() < d)) age -= 1;
    return age >= 0 && age < 130 ? age : null;
  }
  function computeBmi(a) {
    const hgt = Number(a.q1_3), w = Number(a.q1_4);
    if (!hgt || !w || hgt < 50 || hgt > 250) return null;   // height not in cm: no BMI rather than a wild number in the data
    return Math.round((w / ((hgt / 100) ** 2)) * 10) / 10;
  }
  const bmiClass = (b) => (b == null ? "" : b < 18.5 ? "น้ำหนักน้อย" : b < 23 ? "ปกติ" : b < 25 ? "ท้วม" : b < 30 ? "อ้วนระดับ 1" : "อ้วนระดับ 2");

  // ------------------------------------------------------------ columns / flatten (what goes to Google Sheets)
  const COLUMNS = M69.columnSpec(S);
  const FIELDWORK = { from: "2026-11-04", to: "2026-11-13" };   // soft warning only: interview dates outside this window
  const TEXT_COLUMNS = ["uuid", "record_id", "h_house_no", "h_house_note","h_village", "h_tambon", "h_amphoe", "h_province", "iv_first", "iv_last", "iv_faculty", "iv_zone", "iv_date"];

  function progress(a) {
    const vis = allQuestions.filter((q) => q.type !== "computed" && visible(q, a));
    const done = vis.filter((q) => isAnswered(q, a)).length;
    return vis.length ? Math.round((done / vis.length) * 100) : 0;
  }

  function flatten(rec) {
    const a = rec.answers, row = {};
    COLUMNS.forEach((c) => (row[c.key] = ""));
    Object.assign(row, {
      uuid: rec.uuid, record_id: rec.record_id, form_version: S.version, created_at: rec.created_at,
      updated_at: rec.updated_at, submitted_at: nowIso(), complete_pct: progress(a),
      started_at: rec.started_at || "", finished_at: rec.finished_at || "",
      duration_min: rec.started_at && rec.finished_at ? Math.max(0, Math.round((Date.parse(rec.finished_at) - Date.parse(rec.started_at)) / 60000)) : "",
    });
    for (const q of allQuestions) {
      if (!visible(q, a)) continue;  // skipped by the form's own logic: stays blank
      switch (q.type) {
        case "single":
          if (a[q.id] != null) row[q.id] = a[q.id];
          q.o.filter((x) => x.other && a[q.id] === x.v).forEach((x) => (row[`${q.id}_o${x.v}_text`] = a[`${q.id}__${x.v}`] || ""));
          break;
        case "multi":
          if (Array.isArray(a[q.id])) q.o.forEach((x) => {
            const on = a[q.id].includes(x.v);
            row[`${q.id}_o${x.v}`] = on ? 1 : 0;
            if (x.other && on) row[`${q.id}_o${x.v}_text`] = a[`${q.id}__${x.v}`] || "";
          });
          break;
        case "grid": q.rows.forEach((r) => { if (a[r.id] != null) row[r.id] = a[r.id]; }); break;
        case "dob": ["q1_2_day", "q1_2_month", "q1_2_year_be", "q1_2_age"].forEach((k) => { if (a[k] != null && a[k] !== "") row[k] = a[k]; }); break;
        case "computed": if (q.compute === "bmi") { const b = computeBmi(a); if (b != null) row[q.id] = b; } break;
        case "animals":
          q.animals.forEach((x) => {
            const has = a[`${q.id}_${x.key}_has`];
            if (has != null) row[`${q.id}_${x.key}_has`] = has;
            if (has === 2) {
              ["n", "vacc", "deworm", ...(x.other ? ["name"] : [])].forEach((k) => {
                const v = a[`${q.id}_${x.key}_${k}`];
                if (v != null && v !== "") row[`${q.id}_${x.key}_${k}`] = v;
              });
            }
          });
          break;
        default:
          if (a[q.id] != null && a[q.id] !== "") row[q.id] = a[q.id];
      }
    }
    return row;
  }

  function requiredMissing(a) {
    return allQuestions.filter((q) => q.req && visible(q, a) && !isAnswered(q, a));
  }

  // ------------------------------------------------------------ records
  function newRecord() {
    const rem = load(LS.remember, {});
    const defaults = {};   // q.default = pre-filled but editable; wins over a stale remembered value
    allQuestions.forEach((q) => { if (q.default != null) defaults[q.id] = q.default; });
    const answers = { h_province: "ขอนแก่น", iv_date: todayIso(), ...rem, ...defaults };
    const rec = { uuid: uuid(), record_id: "", created_at: nowIso(), updated_at: nowIso(), status: "draft", answers };
    records[rec.uuid] = rec;
    saveRecords();
    return rec;
  }
  function recordId(a, id) {
    const d = (a.iv_date || todayIso()).replace(/-/g, "");
    const noNumber = a.h_house_type === 2 || a.h_house_type === 3;   // no real number to tell houses apart: add a short unique tail
    const no = noNumber ? `${a.h_house_type === 2 ? "NONO" : "UNK"}-${String(id || "").slice(0, 4)}` : String(M69.normHouseNo(a.h_house_no) || "?").replace(/[^\w/-]/g, "");
    // several people may be interviewed in one house on one day: a short tail from the uuid keeps record_id unique
    // (no-number houses already carry one; MOCK rows have no uuid and keep the old shape)
    const tail = !noNumber && id ? `-${String(id).slice(0, 4)}` : "";
    return `M${a.h_moo || "?"}-${no}-${d}${tail}`;
  }
  function touch(rec) {
    rec.updated_at = nowIso();
    if (!rec.started_at) rec.started_at = rec.updated_at;   // first answer = interview starts
    rec.record_id = recordId(rec.answers, rec.uuid);
    if (rec.status === "sent") rec.status = "ready";  // edited after sending: send again (upsert by uuid)
    saveRecords();
  }
  function rememberInterviewer(a) {
    const rem = {};
    allQuestions.filter((q) => q.remember).forEach((q) => { if (a[q.id]) rem[q.id] = a[q.id]; });
    store(LS.remember, rem);
  }

  // ------------------------------------------------------------ soft checks (never block saving: ask the interviewer to look again)
  const qById = new Map(allQuestions.map((q) => [q.id, q]));
  const sectionOf = (id) => S.sections.findIndex((s) => s.q.some((q) => q.id === id));
  const filled = (v) => v != null && v !== "";
  // two houses are "the same" only when both have a real number: "no number / unknown" must never match each other
  const houseKey = (a) => {
    if (a.h_house_type != null && a.h_house_type !== 1) return "";
    const n = M69.normHouseNo(a.h_house_no);
    return /^\d/.test(n) && filled(a.h_moo) ? `${a.h_moo}|${n}` : "";
  };
  // Several people per house are allowed, so a house number alone is never a duplicate.
  // Only "same house + same sex + same full birth date" suggests the same person was interviewed twice.
  const personKey = (a) => {
    const hk = houseKey(a);
    if (!hk || !filled(a.q1_1) || !filled(a.q1_2_day) || !filled(a.q1_2_month) || !filled(a.q1_2_year_be)) return "";
    return `${hk}|${a.q1_1}|${a.q1_2_year_be}-${a.q1_2_month}-${a.q1_2_day}`;
  };
  // other records of the same house on this device (any status): used for an informational note only
  function housematesOf(rec) {
    const k = houseKey(rec.answers);
    return k ? Object.values(records).filter((r) => r.uuid !== rec.uuid && houseKey(r.answers) === k) : [];
  }
  function samePersonOf(rec) {
    const k = personKey(rec.answers);
    return k ? Object.values(records).filter((r) => r.uuid !== rec.uuid && personKey(r.answers) === k) : [];
  }
  function checks(rec) {
    const a = rec.answers, out = [];
    const add = (id, msg) => out.push({ id, msg });
    const shown = (id) => qById.has(id) && visible(qById.get(id), a);
    let metres = false;
    if (shown("q1_3") && filled(a.q1_3) && a.q1_3 < 3) { add("q1_3", `ดูเหมือนกรอกเป็นเมตร — กรอกเป็นเซนติเมตร เช่น ${Math.round(a.q1_3 * 100) || 160}`); metres = true; }
    for (const q of allQuestions) {
      if (q.type !== "number" || (metres && q.id === "q1_3") || !visible(q, a) || !filled(a[q.id])) continue;
      const v = a[q.id];
      if ((q.min != null && v < q.min) || (q.max != null && v > q.max)) add(q.id, `ค่า ${v.toLocaleString("th-TH")} อยู่นอกช่วงปกติ (${q.min ?? "…"}–${q.max ?? "…"}${q.unit ? " " + q.unit : ""}) — ตรวจอีกครั้ง`);
    }
    if (shown("q1_2")) {
      const y = Number(a.q1_2_year_be);
      if (filled(a.q1_2_year_be) && y >= 1800 && y < 2300) add("q1_2", `ปีเกิด ${y} น่าจะเป็น ค.ศ. — ใช้ปี พ.ศ. (บวก 543 = ${y + 543})`);
      else if (filled(a.q1_2_year_be) && computeAge(a) == null) add("q1_2", "ปีเกิดไม่ถูกต้อง — ตรวจอีกครั้ง");
      if (filled(a.q1_2_age) && a.q1_2_age < 15) add("q1_2", `ผู้ให้ข้อมูลอายุ ${a.q1_2_age} ปี — ควรเป็นผู้ใหญ่ ตรวจวันเกิดอีกครั้ง`);
      else if (filled(a.q1_2_age) && a.q1_2_age > 100) add("q1_2", `อายุ ${a.q1_2_age} ปี — ตรวจวันเกิดอีกครั้ง`);
    }
    const b = computeBmi(a);
    if (shown("bmi") && b != null && !metres && (b < 15 || b > 45)) add("bmi", `BMI ${b} ผิดปกติ — ตรวจส่วนสูงและน้ำหนักอีกครั้ง`);
    if (shown("q4_1_2") && filled(a.q4_1_2) && filled(a.q1_2_age) && a.q4_1_2 > a.q1_2_age) add("q4_1_2", `สูบมา ${a.q4_1_2} ปี มากกว่าอายุผู้ตอบ (${a.q1_2_age} ปี)`);
    allQuestions.filter((q) => q.type === "animals" && visible(q, a)).forEach((q) => q.animals.forEach((x) => {
      const k = `${q.id}_${x.key}`;
      if (a[`${k}_has`] !== 2) return;
      [["vacc", "รับวัคซีน"], ["deworm", "ถ่ายพยาธิ"]].forEach(([f, l]) => {
        if (filled(a[`${k}_n`]) && filled(a[`${k}_${f}`]) && a[`${k}_${f}`] > a[`${k}_n`]) add(q.id, `${x.t}: จำนวนที่${l} (${a[`${k}_${f}`]}) มากกว่าจำนวนทั้งหมด (${a[`${k}_n`]})`);
      });
    }));
    if (shown("h_house_no") && filled(a.h_house_no) && !M69.validHouseNo(M69.normHouseNo(a.h_house_no))) add("h_house_no", "บ้านเลขที่ควรเป็นตัวเลข เช่น 12 หรือ 12/3 — ตรวจอีกครั้ง (ถ้าไม่มีเลขที่ ให้เลือก “ไม่มีบ้านเลขที่” หรือ “ไม่ทราบ” ด้านบน)");
    if (shown("iv_date") && filled(a.iv_date) && (a.iv_date < FIELDWORK.from || a.iv_date > FIELDWORK.to)) add("iv_date", `วันที่ ${a.iv_date} อยู่นอกช่วงภาคสนาม (4–13 พ.ย. 2569) — ตรวจวันที่ หรือนาฬิกาของเครื่อง`);
    const dups = samePersonOf(rec);
    if (shown("q1_2") && dups.length) add("q1_2", `บ้านเลขที่ ${a.h_house_no} หมู่ ${a.h_moo} มีชุดที่เพศและวันเกิดตรงกันในเครื่องนี้แล้ว ${dups.length} ชุด (${dups.map((r) => r.answers.iv_date || (r.created_at || "").slice(0, 10)).join(", ")}) — ถ้าเป็นคนเดียวกัน ให้แก้ชุดเดิมแทน ถ้าเป็นคนละคน (เช่น คนในบ้านเดียวกัน) ไม่ต้องทำอะไร`);
    return out;
  }
  // fill the yellow note under each question on screen
  function refreshChecks(rec) {
    if (!rec) return;
    const by = {};
    checks(rec).forEach((c) => (by[c.id] = (by[c.id] || []).concat(c.msg)));
    document.querySelectorAll(".qwarn").forEach((el) => {
      const msgs = by[el.dataset.q] || [];
      el.hidden = !msgs.length;
      mount(el, msgs.map((m) => h("div", null, m)));
    });
    // neutral note (not a warning): how many people from this house are already on this device
    document.querySelectorAll(".qinfo").forEach((el) => {
      const others = housematesOf(rec), a = rec.answers;
      el.hidden = !others.length;
      mount(el, others.length ? [h("div", null, `บ้านเลขที่ ${a.h_house_no} หมู่ ${a.h_moo} มีในเครื่องนี้ ${others.length + 1} ชุด (รวมชุดนี้) · เห็นเฉพาะข้อมูลในเครื่องนี้ ไม่รวมเครื่องอื่น`)] : []);
    });
  }

  // ------------------------------------------------------------ sync
  async function post(payload) {
    const res = await fetch(settings.api, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },  // simple request: no CORS preflight for Apps Script
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error("ตอบกลับไม่ใช่ JSON — ตรวจ URL ของ Apps Script (ต้องลงท้ายด้วย /exec)"); }
    if (!data.ok) throw new Error(data.error || "ส่งไม่สำเร็จ");
    return data;
  }

  let syncing = false;
  async function syncPending({ quiet = false } = {}) {
    if (syncing) return;
    if (PREVIEW) { if (!quiet) toast("โหมดทดลองแบบสอบถาม (ร่าง) — ไม่ส่งข้อมูลเข้า Sheet", true); return; }
    const pending = Object.values(records).filter((r) => r.status === "ready");
    if (!pending.length) { if (!quiet) toast("ไม่มีข้อมูลค้างส่ง"); return; }
    if (!settings.api || !settings.team) { if (!quiet) toast("ยังไม่ได้ตั้งค่า URL และรหัสทีม (เมนู ตั้งค่า)", true); return; }
    if (!navigator.onLine) { if (!quiet) toast("ไม่มีสัญญาณอินเทอร์เน็ต ข้อมูลยังเก็บในเครื่อง จะส่งเมื่อมีสัญญาณ", true); return; }
    syncing = true; render();
    let sent = 0;
    try {
      for (let i = 0; i < pending.length; i += BATCH) {
        const batch = pending.slice(i, i + BATCH);
        const rows = batch.map(flatten);
        const res = await post({ token: settings.team, form_version: S.version, columns: COLUMNS.map((c) => c.key), textColumns: TEXT_COLUMNS, records: rows });
        const saved = new Set(res.saved || []);
        batch.forEach((r, j) => {
          if (saved.has(r.uuid)) { r.status = "sent"; r.sent_at = rows[j].submitted_at; r.error = ""; sent += 1; }
        });
        saveRecords();
      }
      toast(`ส่งข้อมูลแล้ว ${sent} ครัวเรือน`);
    } catch (e) {
      pending.forEach((r) => { if (r.status === "ready") r.error = String(e.message || e); });
      saveRecords();
      toast(`ส่งไม่สำเร็จ: ${e.message || e}`, true);
    } finally {
      syncing = false; render({ keepScroll: true });
    }
  }
  window.addEventListener("online", () => { updateNet(); syncPending({ quiet: true }); });
  window.addEventListener("offline", updateNet);
  function updateNet() {
    const n = document.getElementById("net");
    if (n) { n.textContent = navigator.onLine ? "ออนไลน์" : "ออฟไลน์ — บันทึกในเครื่อง"; n.className = "net " + (navigator.onLine ? "on" : "off"); }
  }

  // ------------------------------------------------------------ exports
  function download(name, text, type = "text/csv;charset=utf-8") {
    const blob = new Blob(["﻿" + text], { type });
    const a = h("a", { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const csvCell = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  function exportCsv() {
    const rows = Object.values(records).map(flatten);
    const lines = [COLUMNS.map((c) => c.key).join(",")].concat(rows.map((r) => COLUMNS.map((c) => csvCell(r[c.key])).join(",")));
    download(`survey_master69_backup_${todayIso()}.csv`, lines.join("\n"));
    store(LS.backup, Date.now());
  }
  function exportCodebook() {
    const lines = ["column,question_no,label,codes"].concat(COLUMNS.map((c) => [c.key, c.q, c.label, c.codes].map(csvCell).join(",")));
    download("survey_master69_codebook.csv", lines.join("\n"));
  }

  // ------------------------------------------------------------ question widgets
  function optionText(q, a, x) {
    const key = `${q.id}__${x.v}`;
    return h("input", {
      class: "other", type: "text", placeholder: "ระบุ…", value: a[key] || "",
      oninput: (e) => { a[key] = e.target.value; touchDebounced(); },
      onclick: (e) => e.stopPropagation(),
    });
  }

  function choice(q, a, rec, multi) {
    if (!multi && q.ui === "select") {   // single choice shown as a dropdown (same codes/columns as radio)
      if (a[q.id] != null && !q.o.some((x) => x.v === a[q.id])) delete a[q.id];   // stale remembered value from an older form
      const picked = q.o.find((x) => x.v === a[q.id]);
      const sel = h("select", {
        name: q.id,
        onchange: (e) => {
          if (e.target.value === "") delete a[q.id]; else a[q.id] = Number(e.target.value);
          touch(rec); renderSection(rec, { keepScroll: true });
        },
      }, h("option", { value: "" }, "— เลือก —"),
        q.o.map((x) => h("option", { value: x.v, selected: x.v === a[q.id] }, x.label)));
      return h("div", { class: "opts-select" }, sel, picked && picked.other ? optionText(q, a, picked) : null);
    }
    const box = h("div", { class: "opts" + (q.o.length > 4 ? " many" : "") });
    q.o.forEach((x) => {
      const on = multi ? (a[q.id] || []).includes(x.v) : a[q.id] === x.v;
      const input = h("input", {
        type: multi ? "checkbox" : "radio", name: q.id, checked: on,
        onchange: () => {
          if (multi) {
            let cur = new Set(a[q.id] || []);
            if (cur.has(x.v)) cur.delete(x.v);
            else if (x.exclusive) cur = new Set([x.v]);
            else { q.o.filter((y) => y.exclusive).forEach((y) => cur.delete(y.v)); cur.add(x.v); }
            a[q.id] = [...cur].sort((p, r) => p - r);
          } else {
            a[q.id] = x.v;
          }
          touch(rec); renderSection(rec, { keepScroll: true });
        },
      });
      const opt = h("label", { class: "opt" + (on ? " on" : "") + (x.exclusive ? " excl" : "") }, input,
        h("span", { class: "code" }, x.v), h("span", { class: "lbl" }, x.label));
      if (x.other && on) opt.append(optionText(q, a, x));
      box.append(opt);
    });
    if (!multi && a[q.id] != null) {
      box.append(h("button", { type: "button", class: "clear", onclick: () => { delete a[q.id]; touch(rec); renderSection(rec, { keepScroll: true }); } }, "ล้างคำตอบ"));
    }
    return box;
  }

  function numberInput(q, a, key, opts = {}) {
    const inp = h("input", {
      type: "number", inputmode: opts.step && opts.step < 1 ? "decimal" : "numeric", step: opts.step || 1,
      min: opts.min, max: opts.max, value: a[key] ?? "", placeholder: opts.placeholder || "",
      oninput: (e) => {
        const v = e.target.value;
        a[key] = v === "" ? null : Number(v);
        const bad = v !== "" && ((opts.min != null && Number(v) < opts.min) || (opts.max != null && Number(v) > opts.max));
        e.target.classList.toggle("warn", bad);
        if (opts.after) opts.after();
        touchDebounced();
        refreshChecks(currentRec);
      },
    });
    return inp;
  }

  function question(q, a, rec) {
    const head = h("div", { class: "qhead" }, q.no ? h("span", { class: "qno" }, q.no) : null,
      h("span", { class: "qt" }, q.t), q.req ? h("span", { class: "req", title: "จำเป็น" }, "*") : null,
      q.type === "multi" ? h("span", { class: "tag" }, "ตอบได้หลายข้อ") : null);
    const card = h("div", { class: "q" + (isAnswered(q, a) ? " done" : ""), id: `q-${q.id}` }, head);
    if (q.hint) card.append(h("div", { class: "hint" }, q.hint));
    let body;
    switch (q.type) {
      case "single": body = choice(q, a, rec, false); break;
      case "multi": body = choice(q, a, rec, true); break;
      case "text":
        if (q.fixed) { a[q.id] = q.fixed; body = h("div", { class: "fixed" }, q.fixed); break; }
        body = h("input", {
          type: "text", value: a[q.id] || "", oninput: (e) => { a[q.id] = e.target.value; touchDebounced(); },
          onchange: q.fmt === "houseno" ? (e) => { const v = M69.normHouseNo(e.target.value); e.target.value = v; a[q.id] = v; touch(rec); refreshChecks(rec); } : null,
        });
        break;
      case "textarea": body = h("textarea", { rows: 3, oninput: (e) => { a[q.id] = e.target.value; touchDebounced(); } }, a[q.id] || ""); break;
      case "date": body = h("input", { type: "date", value: a[q.id] || "", oninput: (e) => { a[q.id] = e.target.value; touchDebounced(); } }); break;
      case "number": {
        body = h("div", { class: "num" }, numberInput(q, a, q.id, { min: q.min, max: q.max, step: q.step, after: () => updateComputed(a) }), q.unit ? h("span", { class: "unit" }, q.unit) : null);
        break;
      }
      case "computed": {
        body = h("div", { class: "computed", id: `c-${q.id}` });
        break;
      }
      case "dob": {
        const ageBox = h("span", { class: "unit", id: "age-hint" });
        const refreshAge = () => {
          const age = computeAge(a);
          if (age != null) { a.q1_2_age = age; const inp = document.getElementById("age-input"); if (inp) inp.value = age; }
          ageBox.textContent = age != null ? "คำนวณจากวันเกิด" : "ถ้าไม่ทราบวันเกิด กรอกอายุได้เลย";
        };
        const day = h("select", { onchange: (e) => { a.q1_2_day = e.target.value ? Number(e.target.value) : null; refreshAge(); touchDebounced(); } },
          h("option", { value: "" }, "วัน"), ...Array.from({ length: 31 }, (_, i) => h("option", { value: i + 1, selected: a.q1_2_day === i + 1 }, i + 1)));
        const month = h("select", { onchange: (e) => { a.q1_2_month = e.target.value ? Number(e.target.value) : null; refreshAge(); touchDebounced(); } },
          h("option", { value: "" }, "เดือน"), ...TH_MONTHS.map((m, i) => h("option", { value: i + 1, selected: a.q1_2_month === i + 1 }, m)));
        const year = numberInput(q, a, "q1_2_year_be", { min: 2420, max: 2570, placeholder: "ปี พ.ศ.", after: refreshAge });
        const age = numberInput(q, a, "q1_2_age", { min: 0, max: 120, placeholder: "อายุ" });
        age.id = "age-input";
        body = h("div", { class: "dob" }, h("div", { class: "row3" }, day, month, year), h("div", { class: "num" }, h("span", { class: "unit" }, "อายุ"), age, h("span", { class: "unit" }, "ปี"), ageBox));
        setTimeout(refreshAge);
        break;
      }
      case "grid": {
        body = h("div", { class: "grid" }, q.rows.map((r) => {
          const row = h("div", { class: "grow" + (a[r.id] != null ? " done" : "") }, h("div", { class: "glabel" }, h("span", { class: "qno" }, r.no), r.t));
          const opts = h("div", { class: "gopts" });
          q.scale.forEach((x) => opts.append(h("label", { class: "opt small" + (a[r.id] === x.v ? " on" : "") },
            h("input", { type: "radio", name: r.id, checked: a[r.id] === x.v, onchange: () => { a[r.id] = x.v; touch(rec); renderSection(rec, { keepScroll: true }); } }),
            h("span", { class: "lbl" }, x.label))));
          row.append(opts);
          return row;
        }));
        break;
      }
      case "animals": {
        body = h("div", { class: "animals" }, q.animals.map((x) => {
          const key = `${q.id}_${x.key}_has`;
          const row = h("div", { class: "arow" }, h("div", { class: "glabel" }, x.t));
          const opts = h("div", { class: "gopts" });
          [[1, "ไม่มี"], [2, "มี"]].forEach(([v, l]) => opts.append(h("label", { class: "opt small" + (a[key] === v ? " on" : "") },
            h("input", { type: "radio", name: key, checked: a[key] === v, onchange: () => { a[key] = v; touch(rec); renderSection(rec, { keepScroll: true }); } }),
            h("span", { class: "lbl" }, l))));
          row.append(opts);
          if (a[key] === 2) {
            const f = h("div", { class: "afields" });
            if (x.other) f.append(h("label", null, "ชนิด", h("input", { type: "text", value: a[`${q.id}_${x.key}_name`] || "", oninput: (e) => { a[`${q.id}_${x.key}_name`] = e.target.value; touchDebounced(); } })));
            [["n", "จำนวน"], ["vacc", "รับวัคซีน"], ["deworm", "ถ่ายพยาธิ"]].forEach(([k, l]) =>
              f.append(h("label", null, l, numberInput(q, a, `${q.id}_${x.key}_${k}`, { min: 0, max: 100000 }), "ตัว")));
            row.append(f);
          }
          return row;
        }));
        break;
      }
    }
    card.append(body, h("div", { class: "qwarn", "data-q": q.id, hidden: true, role: "status" }));
    if (q.id === "h_house_no") card.append(h("div", { class: "qinfo", "data-q": q.id, hidden: true, role: "status" }));
    return card;
  }

  function updateComputed(a) {
    const el = document.getElementById("c-bmi");
    if (!el) return;
    const b = computeBmi(a);
    const both = filled(a.q1_3) && filled(a.q1_4);
    el.textContent = b != null ? `BMI ${b} กก./ม² · ${bmiClass(b)}` : both ? "คำนวณไม่ได้ — ตรวจส่วนสูง (ซม.) และน้ำหนัก (กก.)" : "กรอกส่วนสูงและน้ำหนักเพื่อคำนวณ";
    el.classList.toggle("warn", (b != null && (b < 15 || b > 45)) || (b == null && both));
  }

  let touchTimer;
  let currentRec = null;
  function touchDebounced() {
    clearTimeout(touchTimer);
    touchTimer = setTimeout(() => { if (currentRec) { touch(currentRec); updateHeaderInfo(currentRec); refreshChecks(currentRec); renderNav(currentRec); } }, 400);
  }

  // ------------------------------------------------------------ views
  let newFormVersion = null;
  function topbar(extra) {
    return [
      h("header", { class: "top" },
        h("a", { class: "brand", href: "#/" }, h("span", { class: "mark" }, "44"), h("span", null, h("b", null, "แบบสัมภาษณ์ชุมชน"), h("small", null, "ฝึกภาคสนามร่วม ศวส. มข. ปีการศึกษา 2569"))),
        h("div", { class: "top-r" }, h("span", { id: "net", class: "net" }), extra)),
      PREVIEW ? h("div", { class: "pvbar" }, `โหมดทดลองแบบสอบถามฉบับร่าง (${S.version}) — ข้อมูลที่กรอกในโหมดนี้ไม่ถูกส่งเข้า Sheet `,
        h("a", { class: "btn tiny", href: "index.html" }, "ไปแบบฟอร์มจริง")) : null,
      newFormVersion ? h("div", { class: "pvbar new" }, `มีแบบสอบถามเวอร์ชันใหม่ (${newFormVersion}) `,
        h("button", { class: "btn tiny", type: "button", onclick: () => location.reload() }, "โหลดใหม่"),
        " คำตอบที่กรอกไว้ยังอยู่ครบ") : null,
    ];
  }
  async function checkFormUpdate({ quiet = true } = {}) {
    try {
      const v = await M69.refresh(settings.api, settings.team);
      if (v) { newFormVersion = v; if (!currentRec) render({ keepScroll: true }); else toast(`มีแบบสอบถามเวอร์ชันใหม่ (${v}) กลับหน้ารายการแล้วกดโหลดใหม่`); }
      else if (!quiet) toast(`ใช้แบบสอบถามล่าสุดอยู่แล้ว (${S.version})`);
    } catch (e) { if (!quiet) toast(`ตรวจหาแบบสอบถามใหม่ไม่ได้: ${e.message || e}`, true); }
  }

  let homeFilter = { q: "", status: "" };
  const isStandalone = () => !!((window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone);
  function onboarding() {
    const step = (done, title, sub, href, cta) => h("li", { class: done ? "done" : "" },
      h("span", { class: "dot" }, done ? "✓" : ""), h("span", null, h("b", null, title), h("small", null, sub)),
      done ? null : h("a", { class: "btn tiny", href }, cta));
    return h("section", { class: "onboard" },
      h("h2", null, "เริ่มต้นใช้งาน"),
      h("ol", null,
        step(settings.api && settings.team, "ตั้งค่าการส่งข้อมูล", "ใส่ URL และรหัสทีมที่หัวหน้าทีมให้", "#/settings", "ตั้งค่า"),
        step(isStandalone(), "เพิ่มไว้หน้าจอโฮม", "เปิดได้แม้ไม่มีสัญญาณ เหมือนแอป", "#/help", "ดูวิธี"),
        step(false, "อ่านวิธีใช้ 1 นาที", "สิ่งที่ต้องทำทุกวัน และสิ่งที่ห้ามทำ", "#/help", "อ่าน")));
  }
  const fmtWhen = (t) => new Date(t).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  function viewHome() {
    currentRec = null;
    const list = Object.values(records).sort((p, r) => (r.updated_at || "").localeCompare(p.updated_at || ""));
    const count = (st) => list.filter((r) => r.status === st).length;
    const pending = count("ready"), drafts = count("draft"), sent = count("sent");
    const noSetup = !settings.api || !settings.team;
    // nudges: unsent data getting old, no recent backup
    const oldestReady = Math.min(...list.filter((r) => r.status === "ready").map((r) => Date.parse(r.updated_at) || Infinity));
    const staleReady = Number.isFinite(oldestReady) && Date.now() - oldestReady > 12 * 3600e3;
    const lastBackup = load(LS.backup, 0);
    const needBackup = !PREVIEW && drafts + pending >= 3 && Date.now() - lastBackup > 24 * 3600e3;

    const matches = (r) => {
      if (homeFilter.status && r.status !== homeFilter.status) return false;
      const words = homeFilter.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.length) return true;
      const a = r.answers;
      const hay = `${a.h_house_no || ""} หมู่ ${a.h_moo || ""} ${a.h_village || ""} ${a.iv_first || ""} ${a.iv_last || ""} ${r.record_id || ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    };
    const listBox = h("div", { class: "list" });
    const fill = () => {
      const shown = list.filter(matches);
      mount(listBox, shown.length ? shown.map(recordRow)
        : h("p", { class: "empty" }, list.length ? "ไม่พบแบบสัมภาษณ์ตามที่ค้นหา" : "ยังไม่มีแบบสัมภาษณ์ กด “สัมภาษณ์ครัวเรือนใหม่” เพื่อเริ่ม"));
    };
    fill();
    const statBtn = (key, label, n) => h("button", {
      type: "button", class: "stat" + (homeFilter.status === key ? " on" : ""), "aria-pressed": String(homeFilter.status === key), title: "กดเพื่อแสดงเฉพาะสถานะนี้",
      onclick: () => { homeFilter.status = homeFilter.status === key ? "" : key; render({ keepScroll: true }); },
    }, h("b", null, n), h("span", null, label));

    mount(app,
      topbar([h("a", { class: "btn ghost", href: "#/help" }, "วิธีใช้"), h("a", { class: "btn ghost", href: "#/settings" }, "ตั้งค่า")]),
      h("main", { class: "wrap" },
        !PREVIEW && previewCount() ? h("div", { class: "notice" },
          `มีแบบสัมภาษณ์ ${previewCount()} ชุดที่กรอกไว้ในโหมดทดลอง (ยังไม่ถูกส่ง) `,
          h("button", { class: "btn tiny", type: "button", onclick: movePreview }, "ย้ายมาเป็นข้อมูลจริง")) : null,
        !list.length && !PREVIEW ? onboarding() : noSetup ? h("div", { class: "notice" }, "ยังไม่ได้เชื่อมต่อ Google Sheets — สัมภาษณ์และบันทึกในเครื่องได้ตามปกติ แล้วตั้งค่าที่เมนู ", h("a", { href: "#/settings" }, "ตั้งค่า"), " ก่อนส่งข้อมูล · ใช้ครั้งแรก อ่าน ", h("a", { href: "#/help" }, "วิธีใช้"), " ก่อน") : null,
        staleReady && !noSetup ? h("div", { class: "notice" }, `มีข้อมูลรอส่งค้างตั้งแต่ ${fmtWhen(oldestReady)} — เมื่อมีสัญญาณให้กด “ส่งข้อมูลที่ค้าง”`) : null,
        needBackup ? h("div", { class: "notice" }, `ยังไม่ได้ส่ง ${drafts + pending} ชุด และ${lastBackup ? `ดาวน์โหลดสำรองล่าสุดเมื่อ ${fmtWhen(lastBackup)}` : "ยังไม่เคยดาวน์โหลดสำรอง"} `,
          h("button", { class: "btn tiny", type: "button", onclick: () => { exportCsv(); render({ keepScroll: true }); } }, "ดาวน์โหลดสำรองตอนนี้")) : null,
        h("div", { class: "hero" },
          h("button", { class: "btn primary big", type: "button", onclick: () => { const r = newRecord(); location.hash = `#/form/${r.uuid}/0`; } }, "+ สัมภาษณ์ครัวเรือนใหม่"),
          h("button", { class: "btn big", type: "button", disabled: syncing || !pending, onclick: () => syncPending() }, syncing ? "กำลังส่ง…" : `ส่งข้อมูลที่ค้าง (${pending})`)),
        h("div", { class: "stats" }, statBtn("draft", "ฉบับร่าง", drafts), statBtn("ready", "รอส่ง", pending), statBtn("sent", "ส่งแล้ว", sent)),
        h("div", { class: "listhead" },
          h("h2", null, homeFilter.status ? `แบบสัมภาษณ์: ${{ draft: "ฉบับร่าง", ready: "รอส่ง", sent: "ส่งแล้ว" }[homeFilter.status]}` : "แบบสัมภาษณ์ในเครื่องนี้"),
          homeFilter.status ? h("button", { class: "btn tiny", type: "button", onclick: () => { homeFilter.status = ""; render({ keepScroll: true }); } }, "แสดงทั้งหมด") : null),
        list.length > 3 ? h("input", { type: "search", class: "search", placeholder: "ค้นหา บ้านเลขที่ หมู่ ชื่อหมู่บ้าน หรือผู้สัมภาษณ์", value: homeFilter.q, "aria-label": "ค้นหาแบบสัมภาษณ์", oninput: (e) => { homeFilter.q = e.target.value; fill(); } }) : null,
        listBox,
        h("div", { class: "foot-actions" },
          h("button", { class: "btn ghost", type: "button", onclick: () => { exportCsv(); render({ keepScroll: true }); }, disabled: !list.length }, "ดาวน์โหลดสำรอง (CSV)"),
          h("button", { class: "btn ghost", type: "button", onclick: exportCodebook }, "ดาวน์โหลด Codebook")),
        h("p", { class: "fine" }, "ข้อมูลเก็บในเครื่องนี้จนกว่าจะส่งสำเร็จ ห้ามล้างข้อมูลเบราว์เซอร์ก่อนส่ง · ข้อมูลส่วนบุคคลใช้เพื่อการศึกษาและวางแผนพัฒนาชุมชนเท่านั้น"),
        h("p", { class: "fine" }, `แบบสอบถามเวอร์ชัน ${S.version} · ${S.sections.length} ส่วน · ${allQuestions.length} ข้อ`)));
    updateNet();
  }

  // interviews filled in ?preview=1 live under their own key; let the user promote the ones with answers
  const PREVIEW_KEY = "m69.preview.records";
  const previewWithAnswers = () => Object.values(load(PREVIEW_KEY, {})).filter((r) => r.answers && (r.answers.h_house_no || progress(r.answers) > 5));
  const previewCount = () => previewWithAnswers().length;
  function movePreview() {
    const moving = previewWithAnswers();
    moving.forEach((r) => (records[r.uuid] = { ...r, status: r.status === "ready" ? "ready" : "draft" }));
    saveRecords();
    store(PREVIEW_KEY, {});
    toast(`ย้ายมาแล้ว ${moving.length} ชุด — ชุดที่ยังเป็นฉบับร่างให้เปิดไปกด “ตรวจทานและส่ง”`);
    render();
  }

  function recordRow(r) {
    const a = r.answers;
    const st = { draft: ["ฉบับร่าง", "draft"], ready: ["รอส่ง", "ready"], sent: ["ส่งแล้ว", "sent"] }[r.status] || ["?", ""];
    let armed = false;
    const del = h("button", {
      class: "btn tiny danger", type: "button",
      onclick: (e) => {
        if (!armed) { armed = true; e.target.textContent = "ยืนยันลบ?"; setTimeout(() => { armed = false; e.target.textContent = "ลบ"; }, 3000); return; }
        delete records[r.uuid]; saveRecords(); render({ keepScroll: true });
      },
    }, "ลบ");
    return h("div", { class: "rec" },
      h("a", { class: "rec-main", href: `#/form/${r.uuid}/0` },
        h("b", null, `บ้านเลขที่ ${a.h_house_no || "–"} หมู่ ${a.h_moo || "–"}`, a.h_village ? ` บ้าน${a.h_village}` : ""),
        h("small", null, `${a.iv_date || ""} · ${[a.iv_first, a.iv_last].filter(Boolean).join(" ")} · ตอบแล้ว ${progress(a)}%`),
        h("span", { class: "pbar thin" }, h("i", { style: `width:${progress(a)}%` })),
        r.error && r.status === "ready" ? h("small", { class: "err" }, `ส่งไม่สำเร็จ: ${r.error}`) : null),
      samePersonOf(r).length ? h("span", { class: "chip dup", title: "บ้านเลขที่ เพศ และวันเกิดตรงกับอีกชุดในเครื่องนี้ — อาจเป็นคนเดียวกันที่ถูกสัมภาษณ์ซ้ำ" }, "คนซ้ำ?") : null,
      h("span", { class: `chip ${st[1]}` }, st[0]),
      r.status !== "sent" ? del : null);
  }

  function updateHeaderInfo(rec) {
    const el = document.getElementById("rec-info");
    const t = rec.updated_at ? new Date(rec.updated_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "";
    const pct = progress(rec.answers);
    if (el) mount(el,
      h("span", null, `บ้านเลขที่ ${rec.answers.h_house_no || "–"} หมู่ ${rec.answers.h_moo || "–"} · ตอบแล้ว ${pct}%`),
      h("span", { class: "saved" }, `✓ บันทึกในเครื่องแล้ว${t ? ` ${t} น.` : ""}`),
      h("span", { class: "pbar", role: "progressbar", "aria-valuenow": pct, "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": "ความคืบหน้าทั้งแบบสอบถาม" }, h("i", { style: `width:${pct}%` })));
    renderFormbar(rec);
  }

  let secIndex = 0;
  // bottom bar while interviewing: prev / where am I (tap = next unanswered question) / next
  const sectionCounts = (s, a) => { const qs = s.q.filter((q) => q.type !== "computed" && visible(q, a)); return { qs, done: qs.filter((q) => isAnswered(q, a)).length }; };
  function renderFormbar(rec) {
    const bar = document.getElementById("formbar");
    if (!bar) return;
    const n = S.sections.length, review = secIndex === n;
    const go = (i) => `#/form/${rec.uuid}/${i}`;
    let mid;
    if (review) mid = h("span", { class: "fb-mid" }, h("b", null, "ตรวจทานและส่ง"), h("small", null, `ตอบแล้ว ${progress(rec.answers)}% ของทั้งชุด`));
    else {
      const { qs, done } = sectionCounts(S.sections[secIndex], rec.answers);
      mid = h("button", {
        type: "button", class: "fb-mid", title: "ไปข้อถัดไปที่ยังไม่ตอบ",
        onclick: () => {
          const next = qs.find((q) => !isAnswered(q, rec.answers));
          const el = next && document.getElementById(`q-${next.id}`);
          if (!el) { toast(secIndex < n - 1 ? "ส่วนนี้ตอบครบแล้ว — กด ถัดไป" : "ตอบครบแล้ว — กด ตรวจทาน"); return; }
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
        },
      }, h("b", null, S.sections[secIndex].short || S.sections[secIndex].title), h("small", null, done === qs.length ? "ตอบครบส่วนนี้แล้ว ✓" : `ตอบแล้ว ${done}/${qs.length} · แตะเพื่อไปข้อที่ยังไม่ตอบ`));
    }
    mount(bar,
      secIndex > 0 ? h("a", { class: "btn", href: go(secIndex - 1) }, "‹ ก่อนหน้า") : h("a", { class: "btn", href: "#/" }, "‹ รายการ"),
      mid,
      review ? h("span", { class: "fb-space" }) : h("a", { class: "btn primary", href: go(secIndex + 1) }, secIndex === n - 1 ? "ตรวจทาน ›" : "ถัดไป ›"));
  }
  function viewForm(id, idx, focusQ) {
    const rec = records[id];
    if (!rec) { location.hash = "#/"; return; }
    currentRec = rec;
    secIndex = Math.max(0, Math.min(S.sections.length, idx));  // == length -> review page
    mount(app,
      topbar(h("a", { class: "btn ghost", href: "#/" }, "← รายการ")),
      h("div", { class: "form-layout" },
        h("nav", { class: "secnav", id: "secnav" }),
        h("main", { class: "form-main" },
          h("div", { class: "rec-info", id: "rec-info" }),
          h("div", { id: "section" }))),
      h("nav", { class: "formbar", id: "formbar", "aria-label": "เลื่อนส่วน" }));
    renderSection(rec);
    updateNet();
    if (focusQ) setTimeout(() => {
      const el = document.getElementById(`q-${focusQ}`);
      if (el) { el.scrollIntoView({ block: "center" }); el.classList.add("flash"); }
    }, 50);
  }

  function renderNav(rec) {
    const nav = document.getElementById("secnav");
    if (!nav) return;
    const a = rec.answers;
    mount(nav, S.sections.map((s, i) => {
      const qs = s.q.filter((q) => q.type !== "computed" && visible(q, a));
      const done = qs.filter((q) => isAnswered(q, a)).length;
      return h("a", { class: "sec" + (i === secIndex ? " cur" : "") + (qs.length && done === qs.length ? " full" : ""), href: `#/form/${rec.uuid}/${i}` },
        h("span", { class: "n" }, qs.length && done === qs.length ? "✓" : i === 0 ? "•" : i), h("span", { class: "t" }, s.short), h("span", { class: "c" }, `${done}/${qs.length}`));
    }), h("a", { class: "sec review" + (secIndex === S.sections.length ? " cur" : ""), href: `#/form/${rec.uuid}/${S.sections.length}` }, h("span", { class: "n" }, "✓"), h("span", { class: "t" }, "ตรวจทานและส่ง")));
    const cur = nav.querySelector(".cur");
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest", inline: "center" });
  }

  function renderSection(rec, { keepScroll = false } = {}) {
    const y = window.scrollY;
    const box = document.getElementById("section");
    if (!box) return;
    const a = rec.answers;
    updateHeaderInfo(rec);
    renderNav(rec);
    if (secIndex === S.sections.length) { mount(box, reviewPanel(rec)); if (!keepScroll) window.scrollTo(0, 0); return; }
    const s = S.sections[secIndex];
    const qs = s.q.filter((q) => visible(q, a));
    const hidden = s.q.length - qs.length;
    mount(box,
      h("h1", null, s.title),
      s.note ? h("p", { class: "snote" }, s.note) : null,
      qs.map((q) => question(q, a, rec)),
      hidden ? h("p", { class: "fine" }, `ข้ามให้อัตโนมัติ ${hidden} ข้อ ตามคำตอบก่อนหน้า`) : null,
      h("a", { class: "btn primary big endnext", href: `#/form/${rec.uuid}/${secIndex + 1}` }, secIndex === S.sections.length - 1 ? "ไปหน้าตรวจทาน ›" : `ถัดไป: ${S.sections[secIndex + 1].short || S.sections[secIndex + 1].title} ›`));
    updateComputed(a);
    refreshChecks(rec);
    if (keepScroll) window.scrollTo(0, y); else window.scrollTo(0, 0);
  }

  function reviewPanel(rec) {
    const a = rec.answers;
    const missing = requiredMissing(a);
    const warns = checks(rec);
    const perSection = S.sections.map((s, i) => {
      const qs = s.q.filter((q) => q.type !== "computed" && visible(q, a));
      const left = qs.filter((q) => !isAnswered(q, a));
      return { s, i, left };
    }).filter((x) => x.left.length);
    const finish = (send) => {
      if (missing.length) { toast("กรอกข้อที่จำเป็น (*) ให้ครบก่อน", true); return; }
      rememberInterviewer(a);
      if (!rec.finished_at) rec.finished_at = nowIso();
      rec.status = "ready"; touch(rec);
      if (send) syncPending().then(() => (location.hash = "#/"));
      else { toast("บันทึกแล้ว รอส่งเมื่อมีสัญญาณ"); location.hash = "#/"; }
    };
    return h("div", null,
      h("h1", null, "ตรวจทานและส่ง"),
      h("p", null, `ตอบแล้ว ${progress(a)}% ของข้อที่ต้องถาม`),
      missing.length ? h("div", { class: "notice bad" }, "ยังไม่ได้กรอกข้อจำเป็น: ", missing.map((q, i) => [i ? ", " : "", h("a", { href: `#/form/${rec.uuid}/${S.sections.findIndex((s) => s.id === q.section)}?q=${q.id}` }, q.t)])) : null,
      warns.length ? h("div", { class: "review" }, h("h3", null, `ค่าที่ควรตรวจอีกครั้ง (${warns.length}) — ส่งได้ แต่ควรดูก่อน`),
        warns.map((c) => { const q = qById.get(c.id); return h("div", { class: "rv warn" }, h("a", { href: `#/form/${rec.uuid}/${sectionOf(c.id)}?q=${c.id}` }, q ? `${q.no ? q.no + " " : ""}${q.t}` : c.id), h("small", null, c.msg)); })) : null,
      perSection.length ? h("div", { class: "review" }, h("h3", null, "ข้อที่ยังไม่ได้ตอบ (ส่งได้ แต่ควรตรวจทาน)"),
        perSection.map(({ s, i, left }) => h("div", { class: "rv" }, h("a", { href: `#/form/${rec.uuid}/${i}` }, s.title),
          h("div", { class: "qlinks" }, left.map((q) => h("a", { href: `#/form/${rec.uuid}/${i}?q=${q.id}`, title: q.t }, q.no || (q.t.length > 24 ? q.t.slice(0, 23) + "…" : q.t)))))))
        : h("div", { class: "notice good" }, "ตอบครบทุกข้อแล้ว"),
      h("div", { class: "pager" },
        h("button", { class: "btn", type: "button", onclick: () => finish(false) }, "บันทึก (ส่งทีหลัง)"),
        h("button", { class: "btn primary", type: "button", onclick: () => finish(true), disabled: PREVIEW || !settings.api || !settings.team }, PREVIEW ? "ส่งไม่ได้ในโหมดทดลอง" : "บันทึกและส่งเลย")),
      !settings.api || !settings.team ? h("p", { class: "fine" }, "ยังไม่ได้ตั้งค่าการเชื่อมต่อ Google Sheets จึงบันทึกไว้ในเครื่องก่อนได้") : null);
  }

  function viewSettings() {
    currentRec = null;
    const url = h("input", { type: "url", value: settings.api, placeholder: "https://script.google.com/macros/s/…/exec" });
    const team = h("input", { type: "text", value: settings.team, placeholder: "รหัสทีมที่หัวหน้าทีมแจก" });
    const result = h("p", { class: "fine", id: "test-result" });
    const save = () => { settings = { api: url.value.trim(), team: team.value.trim() }; store(LS.settings, settings); toast("บันทึกการตั้งค่าแล้ว"); };
    const test = async () => {
      save(); result.textContent = "กำลังทดสอบ…";
      try {
        const res = await fetch(`${settings.api}?token=${encodeURIComponent(settings.team)}`);
        const d = await res.json();
        result.textContent = d.ok ? `เชื่อมต่อสำเร็จ · ใน Sheet มีข้อมูล ${d.rows} ครัวเรือน` : `เชื่อมต่อได้ แต่: ${d.error}`;
      } catch (e) { result.textContent = `เชื่อมต่อไม่ได้: ${e.message || e}`; }
    };
    mount(app,
      topbar(h("a", { class: "btn ghost", href: "#/" }, "← รายการ")),
      h("main", { class: "wrap narrow" },
        h("h1", null, "ตั้งค่าการส่งข้อมูล"),
        h("label", { class: "field" }, "URL ของ Google Apps Script (Web app)", url),
        h("label", { class: "field" }, "รหัสทีม", team),
        h("div", { class: "pager" }, h("button", { class: "btn", type: "button", onclick: test }, "ทดสอบการเชื่อมต่อ"), h("button", { class: "btn primary", type: "button", onclick: save }, "บันทึก")),
        result,
        h("h2", null, "แบบสอบถาม"),
        h("p", null, `ใช้เวอร์ชัน ${S.version} (${{ published: "ที่ผู้ดูแลเผยแพร่", default: "ฉบับตั้งต้นในเว็บ", draft: "ฉบับร่างทดลอง" }[M69.source]})`),
        h("div", { class: "pager" }, h("button", { class: "btn", type: "button", onclick: () => checkFormUpdate({ quiet: false }) }, "ตรวจหาแบบสอบถามใหม่")),
        h("h2", null, "การแสดงผล"),
        displayControls(),
        h("h2", null, "ความปลอดภัยของข้อมูลในเครื่องนี้"),
        deviceStatus(),
        h("p", null, h("a", { href: "#/help" }, "อ่านวิธีใช้และข้อควรระวัง")),
        h("p", { class: "fine" }, h("a", { href: "admin.html" }, "ผู้ดูแล: แก้ไขแบบสอบถาม"), " · ", h("a", { href: "dashboard.html" }, "หัวหน้าทีม: หน้าวิเคราะห์")),
        h("p", { class: "fine" }, "หัวหน้าทีมส่งลิงก์ที่มี URL ให้ได้ เช่น …/index.html#/settings?api=<URL> ส่วนรหัสทีมให้บอกกันโดยตรง ไม่ใส่ในลิงก์")));
    const p = new URLSearchParams((location.hash.split("?")[1] || ""));
    if (p.get("api")) { url.value = p.get("api"); }
    updateNet();
  }

  function displayControls() {
    const d = M69.getDisplay();
    const seg = (key, label, opts) => h("div", { class: "field" }, label, h("div", { class: "seg", role: "radiogroup", "aria-label": label },
      opts.map(([v, l]) => h("button", {
        type: "button", role: "radio", "aria-checked": String((d[key] || "") === v), class: (d[key] || "") === v ? "on" : "",
        onclick: () => { M69.setDisplay({ [key]: v }); render({ keepScroll: true }); },
      }, l))));
    return h("div", null,
      seg("theme", "ธีม (กลางแจ้งแดดจ้า แนะนำแบบสว่าง)", [["", "ตามเครื่อง"], ["light", "สว่าง"], ["dark", "มืด"]]),
      seg("size", "ขนาดตัวอักษร", [["", "ปกติ"], ["l", "ใหญ่"], ["xl", "ใหญ่มาก"]]));
  }

  function deviceStatus() {
    const standalone = isStandalone();
    const row = (ok, good, bad) => h("li", { class: ok ? "ok" : ok === false ? "no" : "" }, ok ? good : bad);
    return h("ul", { class: "status-list" },
      row(persisted, "เบราว์เซอร์จะไม่ลบข้อมูลในเครื่องนี้เอง", persisted === false ? "เบราว์เซอร์อาจลบข้อมูลเมื่อพื้นที่เต็ม — เพิ่มแอปไว้หน้าจอโฮม และส่งข้อมูลทุกวัน" : "กำลังตรวจสอบการป้องกันข้อมูล…"),
      row(!!standalone, "เปิดจากไอคอนบนหน้าจอโฮมแล้ว", "ยังไม่ได้เพิ่มไว้หน้าจอโฮม (แนะนำ ดูวิธีในหน้าวิธีใช้)"),
      row(!!(settings.api && settings.team), "ตั้งค่าการส่งข้อมูลแล้ว", "ยังไม่ได้ตั้งค่าการส่งข้อมูล"),
      row(navigator.onLine, "ออนไลน์อยู่", "ออฟไลน์ — กรอกต่อได้ ข้อมูลจะส่งเมื่อมีสัญญาณ"));
  }

  function viewHelp() {
    currentRec = null;
    const step = (title, ...items) => h("section", { class: "help-card" }, h("h2", null, title), h("ol", null, items.map((x) => h("li", null, x))));
    mount(app,
      topbar(h("a", { class: "btn ghost", href: "#/" }, "← รายการ")),
      h("main", { class: "wrap narrow help" },
        h("h1", null, "วิธีใช้แบบสัมภาษณ์"),
        h("p", { class: "lead" }, "แอปนี้ใช้ได้แม้ไม่มีสัญญาณ ทุกคำตอบบันทึกในเครื่องทันที แล้วส่งเข้า Google Sheets เมื่อมีอินเทอร์เน็ต"),
        deviceStatus(),
        step("1. ก่อนลงพื้นที่ (ทำครั้งเดียว)",
          ["เมนู ", h("a", { href: "#/settings" }, "ตั้งค่า"), " → ใส่ URL และรหัสทีมที่หัวหน้าทีมให้ → กด “ทดสอบการเชื่อมต่อ”"],
          "เพิ่มแอปไว้หน้าจอโฮม — iPhone: Safari → ปุ่มแชร์ → “เพิ่มไปยังหน้าจอโฮม” · Android: Chrome → ⋮ → “เพิ่มลงในหน้าจอหลัก/ติดตั้งแอป”",
          "เปิดแอปจากไอคอนนั้นหนึ่งครั้งตอนมีเน็ต เพื่อให้ใช้แบบออฟไลน์ได้",
          "ลองกรอกแบบทดสอบ 1 ชุดแล้วส่ง เพื่อเช็กว่าทุกอย่างทำงาน (แล้วแจ้งหัวหน้าทีมให้ลบแถวทดสอบ)"),
        step("2. ระหว่างสัมภาษณ์",
          "กด “+ สัมภาษณ์ครัวเรือนใหม่” · ขอความยินยอมและอ่านคำชี้แจงในส่วนแรกให้ผู้ตอบฟังก่อน",
          "ข้อที่ไม่เกี่ยวกับผู้ตอบจะหายไปเอง · อายุและ BMI คำนวณให้",
          "ข้อความสีเหลืองใต้ข้อ = ค่าที่ควรตรวจอีกครั้ง (ไม่บังคับ บันทึกได้)",
          "ปิดแอปกลางคันได้ คำตอบไม่หาย กลับมาเปิดจากรายการแล้วกรอกต่อ"),
        step("3. หลังสัมภาษณ์",
          "ไปหน้า “ตรวจทานและส่ง” → ดูข้อที่ยังไม่ตอบ/ค่าที่ควรตรวจ → กดบันทึก",
          "ทุกเย็นเมื่อมีสัญญาณ กด “ส่งข้อมูลที่ค้าง” ให้เหลือ 0",
          "กด “ดาวน์โหลดสำรอง (CSV)” ทุกวัน ถ้าส่งไม่ได้ให้ส่งไฟล์นี้ให้หัวหน้าทีม",
          "แก้คำตอบหลังส่งได้ ระบบจะส่งไปแก้แถวเดิม ไม่เกิดข้อมูลซ้ำ"),
        h("section", { class: "help-card dont" }, h("h2", null, "ห้ามทำ จนกว่าจะส่งข้อมูลครบ"),
          h("ul", null,
            h("li", null, "ล้างประวัติ / ล้างข้อมูลเว็บไซต์ของเบราว์เซอร์"),
            h("li", null, "ใช้โหมดไม่ระบุตัวตน (Incognito / Private)"),
            h("li", null, "สลับไปใช้เครื่องหรือเบราว์เซอร์อื่น — ข้อมูลไม่ย้ายตาม"),
            h("li", null, "ถ่ายภาพหน้าจอที่มีข้อมูลผู้ตอบลงโซเชียล หรือบอกรหัสทีมในกลุ่มสาธารณะ"))),
        h("section", { class: "help-card" }, h("h2", null, "ปัญหาที่พบบ่อย"),
          h("dl", null,
            h("dt", null, "ส่งไม่ได้: “รหัสทีมไม่ถูกต้อง”"), h("dd", null, "ตรวจรหัสทีมในหน้าตั้งค่า (ตัวพิมพ์ เว้นวรรค) แล้วกดทดสอบอีกครั้ง"),
            h("dt", null, "ส่งไม่ได้: “ตอบกลับไม่ใช่ JSON”"), h("dd", null, "URL ต้องเป็นของ Apps Script และลงท้ายด้วย /exec — คัดลอกจากหัวหน้าทีมใหม่"),
            h("dt", null, "สัมภาษณ์หลายคนในบ้านเดียวกัน"), h("dd", null, "ทำได้ กรอกบ้านเลขที่เดิมแล้วเริ่มชุดใหม่สำหรับแต่ละคน ไม่ต้องลบหรือแก้ชุดของคนก่อนหน้า"),
            h("dt", null, "ขึ้น “คนซ้ำ?” ในรายการ"), h("dd", null, "บ้านเลขที่ เพศ และวันเกิดตรงกับอีกชุด แปลว่าอาจสัมภาษณ์คนเดียวกันซ้ำ ถ้าใช่ให้เก็บชุดที่ครบกว่า แล้วลบอีกชุด (ลบได้เฉพาะชุดที่ยังไม่ส่ง) ถ้าเป็นคนละคนไม่ต้องทำอะไร"),
            h("dt", null, "มีแถบ “แบบสอบถามเวอร์ชันใหม่”"), h("dd", null, "กลับหน้ารายการแล้วกด “โหลดใหม่” คำตอบที่กรอกไว้ไม่หาย"))),
        h("p", { class: "fine" }, `แบบสอบถามเวอร์ชัน ${S.version}`)));
    updateNet();
  }

  // ------------------------------------------------------------ self test (?selftest=1): fills random answers, checks flatten, optional submit
  async function selfTest() {
    const out = [];
    const log = (m) => out.push(m);
    const rnd = (n) => 1 + Math.floor(Math.random() * n);
    let problems = 0;
    const dup = COLUMNS.map((c) => c.key).filter((k, i, all) => all.indexOf(k) !== i);
    if (dup.length) { problems++; log(`duplicate column keys: ${dup.join(",")}`); }
    for (let run = 0; run < 25; run++) {
      const rec = newRecord();
      const a = rec.answers;
      Object.assign(a, { h_house_no: `${rnd(200)}/${rnd(9)}`, h_moo: 11, h_village: "บึงสว่าง", h_tambon: "บ้านเหล่า", h_amphoe: "บ้านฝาง", iv_first: "ทดสอบ", iv_last: "ระบบ", iv_faculty: 4, iv_zone: "1" });
      for (let pass = 0; pass < 3; pass++) {  // answers can reveal later questions
        for (const q of allQuestions) {
          if (!visible(q, a) || isAnswered(q, a)) continue;
          if (q.type === "single") { const x = q.o[rnd(q.o.length) - 1]; a[q.id] = x.v; if (x.other) a[`${q.id}__${x.v}`] = "ข้อความทดสอบ"; }
          else if (q.type === "multi") {
            const pick = q.o.filter(() => Math.random() < 0.35);
            const ex = pick.find((x) => x.exclusive);
            a[q.id] = (ex ? [ex] : pick.length ? pick : [q.o[0]]).map((x) => x.v);
            q.o.filter((x) => x.other && a[q.id].includes(x.v)).forEach((x) => (a[`${q.id}__${x.v}`] = "ระบุทดสอบ"));
          } else if (q.type === "grid") q.rows.forEach((r) => (a[r.id] = rnd(q.scale.length)));
          else if (q.type === "number") a[q.id] = q.min != null ? q.min + rnd(Math.max(1, Math.min(60, (q.max || 100) - q.min))) : rnd(50);
          else if (q.type === "dob") { a.q1_2_day = rnd(28); a.q1_2_month = rnd(12); a.q1_2_year_be = 2480 + rnd(80); a.q1_2_age = computeAge(a); }
          else if (q.type === "animals") q.animals.forEach((x) => { const k = `${q.id}_${x.key}`; a[`${k}_has`] = rnd(2); if (a[`${k}_has`] === 2) { a[`${k}_n`] = rnd(20); a[`${k}_vacc`] = rnd(5); a[`${k}_deworm`] = rnd(5); if (x.other) a[`${k}_name`] = "เป็ด"; } });
          else if (q.type === "text" || q.type === "textarea") a[q.id] = a[q.id] || "ทดสอบ";
          else if (q.type === "date") a[q.id] = todayIso();
        }
      }
      touch(rec);
      const row = flatten(rec);
      const missingCols = COLUMNS.filter((c) => !(c.key in row));
      if (missingCols.length) { problems++; log(`run ${run}: missing columns ${missingCols.map((c) => c.key).join(",")}`); }
      for (const q of allQuestions) {
        if (!visible(q, a)) {
          const keys = COLUMNS.filter((c) => c.key === q.id || c.key.startsWith(q.id + "_o")).map((c) => c.key);
          const leaked = keys.filter((k) => row[k] !== "" && !(q.type === "dob"));
          if (leaked.length && q.type !== "grid") { problems++; log(`run ${run}: hidden ${q.id} leaked ${leaked.join(",")}`); }
        }
        if (q.type === "multi" && visible(q, a) && Array.isArray(a[q.id])) {
          const ex = q.o.filter((x) => x.exclusive && row[`${q.id}_o${x.v}`] === 1);
          const n = q.o.filter((x) => row[`${q.id}_o${x.v}`] === 1).length;
          if (ex.length && n > 1) { problems++; log(`run ${run}: exclusive broken in ${q.id}`); }
        }
      }
      if (requiredMissing(a).length) { problems++; log(`run ${run}: required missing ${requiredMissing(a).map((q) => q.id)}`); }
      rec.status = "ready";
      if (run === 0) log(`sample row (non-empty): ${Object.entries(row).filter(([, v]) => v !== "").length}/${COLUMNS.length} columns filled`);
    }
    saveRecords();
    log(`columns: ${COLUMNS.length}, records: ${Object.keys(records).length}, problems: ${problems}`);
    const p = new URLSearchParams(location.search);
    if (p.get("api")) {
      settings = { api: p.get("api"), team: p.get("team") || "" };
      store(LS.settings, settings);
      try { await syncPending({ quiet: true }); } catch (e) { log(`sync error ${e}`); }
      const st = Object.values(records).reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
      log(`after sync: ${JSON.stringify(st)} errors: ${[...new Set(Object.values(records).map((r) => r.error).filter(Boolean))].join(" | ")}`);
    }
    const pre = h("pre", { id: "selftest" }, out.join("\n"));
    document.body.append(pre);
  }

  // ------------------------------------------------------------ mock data (?mock=N&api=…&team=…): realistic fake households, sent then discarded
  async function mockRun(n) {
    const out = [];
    const log = (m) => { out.push(m); pre.textContent = out.join("\n"); };
    const pre = h("pre", { id: "selftest" });
    document.body.append(pre);
    const R = Math.random;
    const pickW = (ws) => { const t = ws.reduce((x, y) => x + y, 0); let r = R() * t; for (let i = 0; i < ws.length; i++) { r -= ws[i]; if (r <= 0) return i + 1; } return ws.length; };
    const norm = (m, sd) => { let u = 0, v = 0; while (!u) u = R(); while (!v) v = R(); return m + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
    // single-choice weights by option order; anything not listed is near-uniform
    const W = {
      q1_5: [8, 62, 18, 6, 6], q1_6: [97, 1, 1, 1], q1_7: [8, 52, 14, 14, 4, 7, 1, 0], q1_8: [22, 30, 26, 10, 5, 7], q1_9: [35, 65],
      q2_1: [55, 14, 8, 3, 16, 2, 2], q2_1_1: [12, 33, 45, 10], q2_1_2: [40, 30, 15, 15], q2_1_3: [70, 30],
      q3_4_2: [72, 15, 5, 8], q3_4_2_1: [78, 17, 5], q3_4_2_2: [12, 88], q3_4_2_3: [55, 30, 7, 5, 3], q3_4_2_4: [80, 15, 5], q3_4_2_5: [10, 45, 35, 10], q3_4_3: [85, 15],
      q3_5: [60, 33, 7], q3_6: [72, 23, 5], q3_7: [22, 78],
      q4_1_3: [30, 45, 25], q4_2_1: [12, 15, 30, 38, 5], q4_3: [38, 30, 18, 14],
      q5_1: [62, 25, 3, 7, 0.5, 2, 0.5], q5_2: [12, 48, 22, 8, 10], q5_3: [6, 72, 18, 0, 3, 1],
      q6_1: [2, 33, 58, 7], q6_2: [70, 28, 2], q6_7: [62, 27, 8, 3],
      q7_1_1: [8, 35, 25, 32], q9_1: [8, 92], q9_2: [45, 55], q9_3: [40, 35, 25], q9_4: [15, 85], q9_4_1: [70, 20, 2, 7, 1],
      q10_1: [18, 6, 8, 40, 6, 22], q10_2: [20, 50, 30], q10_14: [55, 25, 12, 8],
      q11_1: [78, 22], q12_1_2: [2, 25, 18, 35, 18, 2], q12_1_4: [8, 62, 30], q12_1_5: [75, 22, 3], q12_2_2: [70, 25, 5], q12_3_1: [62, 38], q12_4_1: [58, 42],
      q13_4_1: [92, 8], q13_4_2: [70, 30],
    };
    // multi-choice: probability per option (exclusive "none" is used when nothing else is picked)
    const M = {
      q3_2: [0.25, 0.12, 0.03, 0.08, 0.15, 0.04, 0], q5_4: [0, 0.18, 0.12, 0.10, 0.30, 0.15, 0.03, 0.02],
      q6_3: [0, 0.35, 0.05, 0.12, 0.02], q6_4: [0.25, 0.30, 0.12, 0.20, 0.03, 0.10, 0, 0.02], q6_5: [0.30, 0.15, 0.40, 0.03],
      q6_6: [0.10, 0.18, 0.15, 0.06, 0.01, 0.04, 0.01], q7_1: [0, 0.24, 0.10, 0.08, 0.08, 0.30, 0.03, 0.01, 0.01, 0.005, 0.02],
      q7_1_2: [0.15, 0.45, 0.45, 0.35, 0.15, 0.03],
      q9_5: [0.55, 0.40, 0.08, 0.03], q10_15: [0, 0.45, 0.30, 0.12, 0.25, 0.10, 0.02], q11_3: [0.55, 0.30, 0.20, 0.02], q11_4: [0.55, 0.30, 0.10, 0.05],
      q11_5: [0, 0.03, 0.04, 0.12, 0.01, 0.02], q12_1_1: [0, 0.20, 0.62, 0.15, 0.30, 0.25, 0.02], q12_1_3: [0.45, 0.20, 0.40, 0.10, 0.02],
      q12_2_1: [0, 0.12, 0.18, 0.25, 0.06, 0.04, 0.02, 0.02], q12_3_1_1: [0.55, 0.65, 0.20, 0.85, 0.03], q12_3_1_2: [0, 0.25, 0.05, 0.12, 0.05],
      q12_4_2: [0.55, 0.70, 0.15, 0.30, 0.20, 0.02, 0.35, 0.02], q12_4_3: [0.65, 0.45, 0.12, 0.03], q12_4_4: [0, 0.55, 0.05, 0.35, 0.03],
      q14_1_1: [0.90, 0.45, 0.30, 0.05, 0.05], q4_3_1: [0.75, 0.15, 0.10, 0.08, 0.05], q4_2_2: [0.55, 0.15, 0.02, 0.60, 0.05], q3_4_3_who: [0.95, 0.02, 0.05],
    };
    const GRID = {  // weights per scale option, by row id
      q10_3: [70, 20, 8, 2], q10_4: [45, 35, 18, 2], q10_5: [12, 25, 38, 25], q10_6: [5, 20, 50, 25], q10_7: [10, 30, 45, 15], q10_8: [8, 22, 45, 25],
      q10_9: [15, 25, 40, 20], q10_10: [15, 25, 40, 20], q10_11: [12, 28, 40, 20], q10_12: [6, 18, 46, 30], q10_13: [25, 20, 30, 25], q10_12b: [30, 35, 25, 10], q10_13b: [40, 30, 20, 10],
      q13_1_1: [15, 45, 40], q13_1_2: [10, 35, 55], q13_2_1: [20, 40, 40], q13_2_2: [8, 30, 62], q13_3_1: [45, 55], q13_3_2: [55, 45],
      q13_4_1_1a: [15, 45, 40], q13_4_1_1b: [20, 40, 40], q13_4_2_1a: [20, 45, 35], q13_4_2_1b: [18, 42, 40],
      q14_2_1: [40, 45, 15], q14_2_2: [65, 25, 10], q14_2_3: [55, 30, 15], q14_2_4: [30, 60, 10], q14_2_5: [25, 65, 10], q14_2_6: [60, 25, 15], q14_2_7: [45, 35, 20], q14_2_8: [55, 35, 10], q14_2_9: [55, 20, 25],
    };
    const students = [["ณัฐชา", "ทดสอบ", 3], ["ปวริศ", "ทดสอบ", 1], ["กมลชนก", "ทดสอบ", 4], ["ธนกฤต", "ทดสอบ", 2], ["พิมพ์ชนก", "ทดสอบ", 5], ["ศุภกร", "ทดสอบ", 7]];   // iv_faculty = option code (1=MD … 8=AMS-PT)
    const houses = [...Array(200).keys()].map((i) => i + 1).sort(() => R() - 0.5);
    const recs = [];
    for (let i = 0; i < n; i++) {
      const st = students[i % students.length];
      const d = new Date(Date.now() - Math.floor(R() * 5) * 864e5);
      const a = {
        h_house_type: 1, h_house_no: String(houses[i % houses.length]), h_moo: 11, h_village: "บึงสว่าง", h_tambon: "บ้านเหล่า", h_amphoe: "บ้านฝาง", h_province: "ขอนแก่น",
        iv_first: st[0], iv_last: st[1], iv_faculty: st[2], iv_zone: "MOCK", iv_note: "ข้อมูลจำลองสำหรับทดสอบ (MOCK) ลบได้",
        iv_date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      };
      const male = R() < 0.44;
      const age = Math.round(clamp(norm(57, 14), 20, 92));
      a.q1_1 = male ? 1 : 2; a.q1_2_age = age; a.q1_2_year_be = new Date().getFullYear() + 543 - age; a.q1_2_month = 1 + Math.floor(R() * 12); a.q1_2_day = 1 + Math.floor(R() * 28);
      a.q1_2_age = computeAge(a) ?? age;
      a.q1_3 = Math.round(clamp(norm(male ? 165 : 154, 6), 135, 190));
      a.q1_4 = Math.round(clamp(norm((male ? 23.5 : 24.5) * (a.q1_3 / 100) ** 2, 9), 32, 120));
      if (age >= 60 && R() < 0.75) W.q2_1 = [45, 10, 6, 1, 36, 0, 2]; else W.q2_1 = [48, 16, 9, 4, 8, 4, 2];
      // chronic disease risk rises with age
      const k = age < 40 ? 0.35 : age < 50 ? 0.7 : age < 60 ? 1 : age < 70 ? 1.35 : 1.6;
      const dis = [0.11 * k, 0.24 * k, 0.04 * k, 0.025 * k, 0.01, 0.035 * k, 0.012, 0.03, 0.15 * k, 0.02, 0.01, 0.02, 0.02, 0];
      a.q3_1 = dis.map((p, j) => (R() < p ? j + 1 : 0)).filter(Boolean);
      if (!a.q3_1.length) a.q3_1 = [14];
      const fam = [0.30, 0.35, 0.08, 0.10, 0.10, 0.05, 0.03, 0.03, 0.08, 0.02, 0.02, 0.05, 0.02, 0];
      a.q3_3 = fam.map((p, j) => (R() < p ? j + 1 : 0)).filter(Boolean);
      if (!a.q3_3.length) a.q3_3 = [14];
      a.q4_1 = male ? pickW([26, 9, 18, 47]) : pickW([2, 1, 2, 95]);
      a.q4_2 = male ? pickW([42, 58]) : pickW([84, 16]);
      for (let pass = 0; pass < 4; pass++) {
        for (const q of allQuestions) {
          if (!visible(q, a) || isAnswered(q, a)) continue;
          if (q.type === "single") { const x = q.o[(W[q.id] && W[q.id].length === q.o.length ? pickW(W[q.id]) : pickW(q.o.map((o) => (o.other ? 0.3 : 1)))) - 1]; a[q.id] = x.v; if (x.other) a[`${q.id}__${x.v}`] = "ระบุ (จำลอง)"; }
          else if (q.type === "multi") {
            const ps = M[q.id] || q.o.map((x) => (x.exclusive ? 0 : 0.25));
            let pick = q.o.filter((x, j) => !x.exclusive && R() < (ps[j] || 0)).map((x) => x.v);
            const none = q.o.find((x) => x.exclusive);
            if (!pick.length) pick = none ? [none.v] : [q.o[0].v];
            a[q.id] = pick;
            q.o.filter((x) => x.other && pick.includes(x.v)).forEach((x) => (a[`${q.id}__${x.v}`] = "ระบุ (จำลอง)"));
          } else if (q.type === "grid") q.rows.forEach((r) => { if (a[r.id] == null) a[r.id] = pickW(GRID[r.id] || q.scale.map(() => 1)); });
          else if (q.type === "number") {
            const v = { q1_9_amount: Math.round(Math.exp(norm(11.2, 1)) / 1000) * 1000, q4_1_1: Math.round(clamp(norm(10, 5), 1, 40)), q4_1_2: Math.round(clamp(norm(25, 12), 1, 60)), q4_2_3: Math.round(clamp(norm(3, 2), 1, 15)) }[q.id];
            a[q.id] = v ?? Math.round(clamp(norm(((q.min || 0) + (q.max || 10)) / 2, 2), q.min || 0, q.max || 100));
          } else if (q.type === "animals") q.animals.forEach((x) => {
            const p = { cattle: 0.18, poultry: 0.55, dog: 0.55, cat: 0.30, pig: 0.06, other: 0.04 }[x.key];
            const has = R() < p ? 2 : 1, kx = `${q.id}_${x.key}`;
            a[`${kx}_has`] = has;
            if (has === 2) { const nn = x.key === "poultry" ? 5 + Math.floor(R() * 25) : 1 + Math.floor(R() * 4); a[`${kx}_n`] = nn; a[`${kx}_vacc`] = Math.round(nn * (x.key === "dog" || x.key === "cat" ? 0.7 : 0.3)); a[`${kx}_deworm`] = Math.round(nn * 0.3); if (x.other) a[`${kx}_name`] = "เป็ด"; }
          });
          else if (q.type === "text" && !a[q.id]) a[q.id] = q.id === "q3_4_1" ? `${1 + Math.floor(R() * 15)} ปี` : q.id === "q3_3_relation" ? ["พ่อ", "แม่", "พี่น้อง", "พ่อและแม่"][Math.floor(R() * 4)] : "";
        }
      }
      const t0 = Date.now() - R() * 3 * 86400e3;
      const rec = { uuid: uuid(), created_at: nowIso(), updated_at: nowIso(), status: "ready", answers: a,
        started_at: new Date(t0).toISOString(), finished_at: new Date(t0 + clamp(norm(35, 12), 6, 90) * 60000).toISOString() };
      rec.record_id = "MOCK-" + recordId(a);
      recs.push(rec);
    }
    const rows = recs.map(flatten);
    log(`สร้างข้อมูลจำลอง ${rows.length} ครัวเรือน`);
    const p = new URLSearchParams(location.search);
    settings = { api: p.get("api") || settings.api, team: p.get("team") || settings.team };
    if (!settings.api) { log("ไม่มี api — ไม่ได้ส่ง"); return; }
    let sent = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      try {
        const res = await post({ token: settings.team, form_version: S.version, columns: COLUMNS.map((c) => c.key), textColumns: TEXT_COLUMNS, records: rows.slice(i, i + BATCH) });
        sent += (res.saved || []).length;
        log(`ส่งแล้ว ${sent}/${rows.length}`);
      } catch (e) { log(`ส่งไม่สำเร็จ: ${e.message || e}`); break; }
    }
    log(`DONE sent=${sent}`);
  }

  // ------------------------------------------------------------ router
  function render({ keepScroll = false } = {}) {
    const hash = location.hash.replace(/^#/, "") || "/";
    const [path, query] = hash.split("?");
    const parts = path.split("/").filter(Boolean);
    const y = window.scrollY;
    if (parts[0] === "form") viewForm(parts[1], Number(parts[2] || 0), new URLSearchParams(query || "").get("q"));
    else if (parts[0] === "settings") viewSettings();
    else if (parts[0] === "help") viewHelp();
    else viewHome();
    if (keepScroll) window.scrollTo(0, y);
  }
  window.addEventListener("hashchange", () => render());
  window.addEventListener("storage", (e) => { if (e.key === LS.records) { records = load(LS.records, {}); if (!currentRec) render({ keepScroll: true }); } });

  // without this, mobile browsers may clear site data when the phone runs low on space
  let persisted = null;
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then((p) => p || navigator.storage.persist()).then((ok) => {
      persisted = ok;
      if (/^#\/(help|settings)/.test(location.hash)) render({ keepScroll: true });   // these pages show the result
    }).catch(() => {});
  }

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  const qs = new URLSearchParams(location.search);
  if (qs.get("mock")) mockRun(Math.min(500, Number(qs.get("mock")) || 100));
  else if (qs.get("selftest")) { localStorage.clear(); records = {}; selfTest().then(() => render()); }
  else { render(); if (navigator.onLine) { syncPending({ quiet: true }); checkFormUpdate(); } }
})();
