(() => {
  "use strict";

  const S = window.SURVEY;  // chosen by form_core.js: admin-published form, built-in default, or a draft in ?preview=1
  const PREVIEW = M69.preview;
  const app = document.getElementById("app");
  // preview keeps its practice records apart from real interviews and never sends them
  const LS = { records: PREVIEW ? "m69.preview.records" : "m69.records", settings: "m69.settings", remember: "m69.remember" };
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
    for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return n;
  }
  const mount = (node, ...kids) => node.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));

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
    if (!hgt || !w) return null;
    return Math.round((w / ((hgt / 100) ** 2)) * 10) / 10;
  }
  const bmiClass = (b) => (b == null ? "" : b < 18.5 ? "น้ำหนักน้อย" : b < 23 ? "ปกติ" : b < 25 ? "ท้วม" : b < 30 ? "อ้วนระดับ 1" : "อ้วนระดับ 2");

  // ------------------------------------------------------------ columns / flatten (what goes to Google Sheets)
  const COLUMNS = M69.columnSpec(S);
  const TEXT_COLUMNS = ["uuid", "record_id", "h_house_no", "h_village", "h_tambon", "h_amphoe", "h_province", "iv_first", "iv_last", "iv_faculty", "iv_zone", "iv_date"];

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
    const answers = { h_province: "ขอนแก่น", iv_date: todayIso(), ...rem };
    const rec = { uuid: uuid(), record_id: "", created_at: nowIso(), updated_at: nowIso(), status: "draft", answers };
    records[rec.uuid] = rec;
    saveRecords();
    return rec;
  }
  function recordId(a) {
    const d = (a.iv_date || todayIso()).replace(/-/g, "");
    return `M${a.h_moo || "?"}-${String(a.h_house_no || "?").replace(/[^\w/-]/g, "")}-${d}`;
  }
  function touch(rec) {
    rec.updated_at = nowIso();
    rec.record_id = recordId(rec.answers);
    if (rec.status === "sent") rec.status = "ready";  // edited after sending: send again (upsert by uuid)
    saveRecords();
  }
  function rememberInterviewer(a) {
    const rem = {};
    allQuestions.filter((q) => q.remember).forEach((q) => { if (a[q.id]) rem[q.id] = a[q.id]; });
    store(LS.remember, rem);
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
        e.target.title = bad ? `ค่าปกติอยู่ระหว่าง ${opts.min}–${opts.max}` : "";
        if (opts.after) opts.after();
        touchDebounced();
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
        body = h("input", { type: "text", value: a[q.id] || "", oninput: (e) => { a[q.id] = e.target.value; touchDebounced(); } });
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
    card.append(body);
    return card;
  }

  function updateComputed(a) {
    const el = document.getElementById("c-bmi");
    if (!el) return;
    const b = computeBmi(a);
    el.textContent = b == null ? "กรอกส่วนสูงและน้ำหนักเพื่อคำนวณ" : `BMI ${b} กก./ม² · ${bmiClass(b)}`;
    el.classList.toggle("warn", b != null && (b < 12 || b > 60));
  }

  let touchTimer;
  let currentRec = null;
  function touchDebounced() {
    clearTimeout(touchTimer);
    touchTimer = setTimeout(() => { if (currentRec) { touch(currentRec); updateHeaderInfo(currentRec); } }, 400);
  }

  // ------------------------------------------------------------ views
  let newFormVersion = null;
  function topbar(extra) {
    return [
      h("header", { class: "top" },
        h("a", { class: "brand", href: "#/" }, h("span", { class: "mark" }, "44"), h("span", null, h("b", null, "แบบสัมภาษณ์ชุมชน"), h("small", null, "ฝึกภาคสนามร่วม ศวส. มข. ปีการศึกษา 2569"))),
        h("div", { class: "top-r" }, h("span", { id: "net", class: "net" }), extra)),
      PREVIEW ? h("div", { class: "pvbar" }, `โหมดทดลองแบบสอบถามฉบับร่าง (${S.version}) — ข้อมูลที่กรอกไม่ถูกส่งและไม่ปนกับข้อมูลจริง`) : null,
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

  function viewHome() {
    currentRec = null;
    const list = Object.values(records).sort((p, r) => (r.updated_at || "").localeCompare(p.updated_at || ""));
    const pending = list.filter((r) => r.status === "ready").length;
    const drafts = list.filter((r) => r.status === "draft").length;
    const sent = list.filter((r) => r.status === "sent").length;
    const noSetup = !settings.api || !settings.team;
    mount(app,
      topbar(h("a", { class: "btn ghost", href: "#/settings" }, "ตั้งค่า")),
      h("main", { class: "wrap" },
        noSetup ? h("div", { class: "notice" }, "ยังไม่ได้เชื่อมต่อ Google Sheets — สัมภาษณ์และบันทึกในเครื่องได้ตามปกติ แล้วตั้งค่าที่เมนู ", h("a", { href: "#/settings" }, "ตั้งค่า"), " ก่อนส่งข้อมูล") : null,
        h("div", { class: "hero" },
          h("button", { class: "btn primary big", type: "button", onclick: () => { const r = newRecord(); location.hash = `#/form/${r.uuid}/0`; } }, "+ สัมภาษณ์ครัวเรือนใหม่"),
          h("button", { class: "btn big", type: "button", disabled: syncing || !pending, onclick: () => syncPending() }, syncing ? "กำลังส่ง…" : `ส่งข้อมูลที่ค้าง (${pending})`)),
        h("div", { class: "stats" },
          [["ฉบับร่าง", drafts], ["รอส่ง", pending], ["ส่งแล้ว", sent]].map(([k, v]) => h("div", { class: "stat" }, h("b", null, v), h("span", null, k)))),
        h("h2", null, "แบบสัมภาษณ์ในเครื่องนี้"),
        list.length ? h("div", { class: "list" }, list.map(recordRow)) : h("p", { class: "empty" }, "ยังไม่มีแบบสัมภาษณ์ กด “สัมภาษณ์ครัวเรือนใหม่” เพื่อเริ่ม"),
        h("div", { class: "foot-actions" },
          h("button", { class: "btn ghost", type: "button", onclick: exportCsv, disabled: !list.length }, "ดาวน์โหลดสำรอง (CSV)"),
          h("button", { class: "btn ghost", type: "button", onclick: exportCodebook }, "ดาวน์โหลด Codebook")),
        h("p", { class: "fine" }, "ข้อมูลเก็บในเครื่องนี้จนกว่าจะส่งสำเร็จ ห้ามล้างข้อมูลเบราว์เซอร์ก่อนส่ง · ข้อมูลส่วนบุคคลใช้เพื่อการศึกษาและวางแผนพัฒนาชุมชนเท่านั้น"),
        h("p", { class: "fine" }, `แบบสอบถามเวอร์ชัน ${S.version} · ${S.sections.length} ส่วน · ${allQuestions.length} ข้อ`)));
    updateNet();
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
        r.error && r.status === "ready" ? h("small", { class: "err" }, `ส่งไม่สำเร็จ: ${r.error}`) : null),
      h("span", { class: `chip ${st[1]}` }, st[0]),
      r.status !== "sent" ? del : null);
  }

  function updateHeaderInfo(rec) {
    const el = document.getElementById("rec-info");
    if (el) el.textContent = `บ้านเลขที่ ${rec.answers.h_house_no || "–"} หมู่ ${rec.answers.h_moo || "–"} · ตอบแล้ว ${progress(rec.answers)}% · บันทึกอัตโนมัติ`;
  }

  let secIndex = 0;
  function viewForm(id, idx) {
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
          h("div", { id: "section" }))));
    renderSection(rec);
    updateNet();
  }

  function renderNav(rec) {
    const nav = document.getElementById("secnav");
    if (!nav) return;
    const a = rec.answers;
    mount(nav, S.sections.map((s, i) => {
      const qs = s.q.filter((q) => q.type !== "computed" && visible(q, a));
      const done = qs.filter((q) => isAnswered(q, a)).length;
      return h("a", { class: "sec" + (i === secIndex ? " cur" : "") + (qs.length && done === qs.length ? " full" : ""), href: `#/form/${rec.uuid}/${i}` },
        h("span", { class: "n" }, i === 0 ? "•" : i), h("span", { class: "t" }, s.short), h("span", { class: "c" }, `${done}/${qs.length}`));
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
      h("div", { class: "pager" },
        secIndex > 0 ? h("a", { class: "btn", href: `#/form/${rec.uuid}/${secIndex - 1}` }, "← ก่อนหน้า") : h("span"),
        h("a", { class: "btn primary", href: `#/form/${rec.uuid}/${secIndex + 1}` }, secIndex === S.sections.length - 1 ? "ตรวจทาน →" : "ถัดไป →")));
    updateComputed(a);
    if (keepScroll) window.scrollTo(0, y); else window.scrollTo(0, 0);
  }

  function reviewPanel(rec) {
    const a = rec.answers;
    const missing = requiredMissing(a);
    const perSection = S.sections.map((s, i) => {
      const qs = s.q.filter((q) => q.type !== "computed" && visible(q, a));
      const left = qs.filter((q) => !isAnswered(q, a));
      return { s, i, left };
    }).filter((x) => x.left.length);
    const finish = (send) => {
      if (missing.length) { toast("กรอกข้อที่จำเป็น (*) ให้ครบก่อน", true); return; }
      rememberInterviewer(a);
      rec.status = "ready"; touch(rec);
      if (send) syncPending().then(() => (location.hash = "#/"));
      else { toast("บันทึกแล้ว รอส่งเมื่อมีสัญญาณ"); location.hash = "#/"; }
    };
    return h("div", null,
      h("h1", null, "ตรวจทานและส่ง"),
      h("p", null, `ตอบแล้ว ${progress(a)}% ของข้อที่ต้องถาม`),
      missing.length ? h("div", { class: "notice bad" }, "ยังไม่ได้กรอกข้อจำเป็น: ", missing.map((q, i) => [i ? ", " : "", h("a", { href: `#/form/${rec.uuid}/${S.sections.findIndex((s) => s.id === q.section)}` }, q.t)])) : null,
      perSection.length ? h("div", { class: "review" }, h("h3", null, "ข้อที่ยังไม่ได้ตอบ (ส่งได้ แต่ควรตรวจทาน)"),
        perSection.map(({ s, i, left }) => h("div", { class: "rv" }, h("a", { href: `#/form/${rec.uuid}/${i}` }, s.title), h("small", null, left.map((q) => q.no || q.t).join(" · ")))))
        : h("div", { class: "notice good" }, "ตอบครบทุกข้อแล้ว"),
      h("div", { class: "pager" },
        h("button", { class: "btn", type: "button", onclick: () => finish(false) }, "บันทึก (ส่งทีหลัง)"),
        h("button", { class: "btn primary", type: "button", onclick: () => finish(true), disabled: !settings.api || !settings.team }, "บันทึกและส่งเลย")),
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
        h("div", { class: "pager" }, h("button", { class: "btn", type: "button", onclick: () => checkFormUpdate({ quiet: false }) }, "ตรวจหาแบบสอบถามใหม่"), h("a", { class: "btn ghost", href: "admin.html" }, "ผู้ดูแล: แก้ไขแบบสอบถาม")),
        h("p", { class: "fine" }, "หัวหน้าทีมส่งลิงก์ที่มี URL ให้ได้ เช่น …/index.html#/settings?api=<URL> ส่วนรหัสทีมให้บอกกันโดยตรง ไม่ใส่ในลิงก์")));
    const p = new URLSearchParams((location.hash.split("?")[1] || ""));
    if (p.get("api")) { url.value = p.get("api"); }
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
      Object.assign(a, { h_house_no: `${rnd(200)}/${rnd(9)}`, h_moo: 11, h_village: "บึงสว่าง", h_tambon: "บ้านเหล่า", h_amphoe: "บ้านฝาง", iv_first: "ทดสอบ", iv_last: "ระบบ", iv_faculty: "สาธารณสุขศาสตร์", iv_zone: "1" });
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
      q2_1: [55, 14, 8, 3, 16, 2, 5, 2], q2_1_1: [12, 33, 45, 10], q2_1_2: [40, 30, 15, 15], q2_1_3: [70, 30],
      q3_4_2: [72, 15, 5, 8], q3_4_2_1: [78, 17, 5], q3_4_2_2: [12, 88], q3_4_2_3: [55, 30, 7, 5, 3], q3_4_2_4: [80, 15, 5], q3_4_2_5: [10, 45, 35, 10], q3_4_3: [85, 15],
      q3_5: [60, 33, 7], q3_6: [72, 23, 5], q3_7: [22, 78],
      q4_1_3: [30, 45, 25], q4_2_1: [12, 15, 30, 38, 5], q4_2_4: [30, 70], q4_3: [38, 30, 18, 14],
      q5_1: [62, 25, 3, 7, 0.5, 2, 0.5], q5_2: [12, 48, 22, 8, 10], q5_3: [6, 72, 18, 0, 3, 1],
      q6_1: [2, 33, 58, 7], q6_2: [70, 28, 2], q6_7: [62, 27, 8, 3],
      q7_1_1: [8, 35, 25, 32], q8_2: [40, 45, 12, 3], q9_1: [8, 92], q9_2: [45, 55], q9_3: [40, 35, 25], q9_4: [15, 85], q9_4_1: [70, 20, 2, 7, 1],
      q10_1: [18, 6, 8, 40, 6, 22], q10_2: [20, 50, 30], q10_14: [55, 25, 12, 8],
      q11_1: [78, 22], q12_1_2: [2, 25, 18, 35, 18, 2], q12_1_4: [8, 62, 30], q12_1_5: [75, 22, 3], q12_2_2: [70, 25, 5], q12_3_1: [62, 38], q12_4_1: [58, 42],
      q13_4_1: [92, 8], q13_4_2: [70, 30],
      q3_8_1: [40, 35, 15, 10], q3_8_4: [45, 15, 12, 8, 20],
      q15_1: [30, 45, 18, 7], q15_2: [45, 35, 15, 5], q15_3: [30, 10, 35, 15, 8, 2, 0.3], q15_4: [20, 40, 30, 10],
      q16_4: [35, 40, 25], q16_5: [55, 30, 15], q16_6: [15, 75, 10], q16_7: [12, 70, 18], q16_8: [10, 72, 18], q16_10: [70, 15, 15], q16_11: [35, 65],
      q17_1: [35, 40, 18, 7], q17_3: [25, 45, 15, 3, 12], q17_5: [60, 18, 8, 2, 12], q17_6: [20, 45, 15, 10, 10, 0.3], q17_8: [30, 25, 20, 12, 13, 0.3],
      q18_4: [55, 45], q18_5: [60, 25, 15], q18_6: [20, 45, 35], q18_7: [15, 45, 40], q18_8: [10, 50, 40], q18_9: [15, 45, 40],
      q2_2_3: [80, 20], q2_2_4: [75, 25], q2_2_5: [60, 40], q2_2_6: [65, 35], q2_2_7: [70, 30], q2_2_9: [45, 40, 15],
      q2_3_5: [35, 40, 25], q2_3_7: [55, 30, 15], q2_3_11: [60, 40],
    };
    // multi-choice: probability per option (exclusive "none" is used when nothing else is picked)
    const M = {
      q3_2: [0.25, 0.12, 0.03, 0.08, 0.15, 0.04, 0], q5_4: [0, 0.18, 0.12, 0.10, 0.30, 0.15, 0.03, 0.02],
      q6_3: [0, 0.35, 0.05, 0.12, 0.02], q6_4: [0.25, 0.30, 0.12, 0.20, 0.03, 0.10, 0, 0.02], q6_5: [0.30, 0.15, 0.40, 0.03],
      q6_6: [0.10, 0.18, 0.15, 0.06, 0.01, 0.04, 0.01], q7_1: [0, 0.24, 0.10, 0.08, 0.08, 0.30, 0.03, 0.01, 0.01, 0.005, 0.02],
      q7_1_2: [0.15, 0.45, 0.45, 0.35, 0.15, 0.03], q8_3: [0.35, 0.40, 0.30, 0.45, 0.15, 0.10, 0.02, 0.03], q8_4: [0.80, 0.15, 0.15, 0.08, 0],
      q9_5: [0.55, 0.40, 0.08, 0.03], q10_15: [0, 0.45, 0.30, 0.12, 0.25, 0.10, 0.02], q11_3: [0.55, 0.30, 0.20, 0.02], q11_4: [0.55, 0.30, 0.10, 0.05],
      q11_5: [0, 0.03, 0.04, 0.12, 0.01, 0.02], q12_1_1: [0, 0.20, 0.62, 0.15, 0.30, 0.25, 0.02], q12_1_3: [0.45, 0.20, 0.40, 0.10, 0.02],
      q12_2_1: [0, 0.12, 0.18, 0.25, 0.06, 0.04, 0.02, 0.02], q12_3_1_1: [0.55, 0.65, 0.20, 0.85, 0.03], q12_3_1_2: [0, 0.25, 0.05, 0.12, 0.05],
      q12_4_2: [0.55, 0.70, 0.15, 0.30, 0.20, 0.02, 0.35, 0.02], q12_4_3: [0.65, 0.45, 0.12, 0.03], q12_4_4: [0, 0.55, 0.05, 0.35, 0.03],
      q14_1_1: [0.90, 0.45, 0.30, 0.05, 0.05], q4_3_1: [0.75, 0.15, 0.10, 0.08, 0.05], q4_2_2: [0.55, 0.15, 0.02, 0.60, 0.05], q3_4_3_who: [0.95, 0.02, 0.05],
      q3_8_2: [0.55, 0.60, 0.35, 0.50, 0], q3_8_5: [0.80, 0.55, 0.20, 0.35, 0.15], q3_9_1: [0.08, 0.06, 0.07, 0.03, 0.15, 0], q3_9_2: [0.40, 0.85, 0.50, 0.20, 0.10, 0.08, 0.25, 0],
      q15_5: [0.55, 0.40, 0.15, 0.25, 0.08, 0.12, 0.05, 0.08, 0.10, 0.15, 0.01], q15_6: [0.95, 0.15, 0.20, 0.40, 0.35],
      q16_1: [0.70, 0.15, 0.08, 0.05, 0.10, 0.15, 0.30, 0.12, 0.02, 0], q16_2: [0.55, 0.35, 0.40, 0.20, 0.03, 0.01], q16_3: [0.30, 0.25, 0.15, 0.10, 0.25, 0.05, 0.35, 0.01],
      q17_2: [0.55, 0.25, 0.45, 0.10, 0.30, 0.01, 0], q17_4: [0.20, 0.15, 0.08, 0.04, 0.10, 0.01, 0],
      q18_1: [0.70, 0.10, 0.15, 0.05, 0.35, 0.02], q18_2: [0.25, 0.55, 0.70, 0.30, 0.45, 0.30], q18_3: [0.35, 0.15, 0.03, 0.25, 0.08, 0.20, 0],
      q2_2_8: [0.45, 0.40, 0.55, 0.60, 0], q2_3_6: [0.30, 0.25, 0.45, 0.10, 0], q2_3_10: [0.70, 0.30, 0.25, 0.40, 0.15, 0.02, 0], q2_3_12: [0.25, 0.12, 0.20, 0.15, 0.12, 0.02, 0],
    };
    const GRID = {  // weights per scale option, by row id
      q8_1_1: [12, 88], q8_1_2: [14, 86],
      q10_3: [70, 20, 8, 2], q10_4: [45, 35, 18, 2], q10_5: [12, 25, 38, 25], q10_6: [5, 20, 50, 25], q10_7: [10, 30, 45, 15], q10_8: [8, 22, 45, 25],
      q10_9: [15, 25, 40, 20], q10_10: [15, 25, 40, 20], q10_11: [12, 28, 40, 20], q10_12: [6, 18, 46, 30], q10_13: [25, 20, 30, 25], q10_12b: [30, 35, 25, 10], q10_13b: [40, 30, 20, 10],
      q13_1_1: [15, 45, 40], q13_1_2: [10, 35, 55], q13_2_1: [20, 40, 40], q13_2_2: [8, 30, 62], q13_3_1: [45, 55], q13_3_2: [55, 45],
      q13_4_1_1a: [15, 45, 40], q13_4_1_1b: [20, 40, 40], q13_4_2_1a: [20, 45, 35], q13_4_2_1b: [18, 42, 40],
      q14_2_1: [40, 45, 15], q14_2_2: [65, 25, 10], q14_2_3: [55, 30, 15], q14_2_4: [30, 60, 10], q14_2_5: [25, 65, 10], q14_2_6: [60, 25, 15], q14_2_7: [45, 35, 20], q14_2_8: [55, 35, 10], q14_2_9: [55, 20, 25],
    };
    const students = [["ณัฐชา", "ทดสอบ", "พยาบาลศาสตร์"], ["ปวริศ", "ทดสอบ", "แพทยศาสตร์"], ["กมลชนก", "ทดสอบ", "สาธารณสุขศาสตร์"], ["ธนกฤต", "ทดสอบ", "ทันตแพทยศาสตร์"], ["พิมพ์ชนก", "ทดสอบ", "เภสัชศาสตร์"], ["ศุภกร", "ทดสอบ", "เทคนิคการแพทย์"]];
    const houses = [...Array(200).keys()].map((i) => i + 1).sort(() => R() - 0.5);
    const recs = [];
    for (let i = 0; i < n; i++) {
      const st = students[i % students.length];
      const d = new Date(Date.now() - Math.floor(R() * 5) * 864e5);
      const a = {
        h_house_no: String(houses[i % houses.length]), h_moo: 11, h_village: "บึงสว่าง", h_tambon: "บ้านเหล่า", h_amphoe: "บ้านฝาง", h_province: "ขอนแก่น",
        iv_first: st[0], iv_last: st[1], iv_faculty: st[2], iv_zone: "MOCK", iv_note: "ข้อมูลจำลองสำหรับทดสอบ (MOCK) ลบได้",
        iv_date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      };
      const male = R() < 0.44;
      const age = Math.round(clamp(norm(57, 14), 20, 92));
      a.q1_1 = male ? 1 : 2; a.q1_2_age = age; a.q1_2_year_be = new Date().getFullYear() + 543 - age; a.q1_2_month = 1 + Math.floor(R() * 12); a.q1_2_day = 1 + Math.floor(R() * 28);
      a.q1_2_age = computeAge(a) ?? age;
      a.q1_3 = Math.round(clamp(norm(male ? 165 : 154, 6), 135, 190));
      a.q1_4 = Math.round(clamp(norm((male ? 23.5 : 24.5) * (a.q1_3 / 100) ** 2, 9), 32, 120));
      if (age >= 60 && R() < 0.75) W.q2_1 = [45, 10, 6, 1, 36, 0, 1, 2]; else W.q2_1 = [48, 16, 9, 4, 8, 4, 10, 2];
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
      const rec = { uuid: uuid(), created_at: nowIso(), updated_at: nowIso(), status: "ready", answers: a };
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
    const [path] = hash.split("?");
    const parts = path.split("/").filter(Boolean);
    const y = window.scrollY;
    if (parts[0] === "form") viewForm(parts[1], Number(parts[2] || 0));
    else if (parts[0] === "settings") viewSettings();
    else viewHome();
    if (keepScroll) window.scrollTo(0, y);
  }
  window.addEventListener("hashchange", () => render());
  window.addEventListener("storage", (e) => { if (e.key === LS.records) { records = load(LS.records, {}); if (!currentRec) render({ keepScroll: true }); } });

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  const qs = new URLSearchParams(location.search);
  if (qs.get("mock")) mockRun(Math.min(500, Number(qs.get("mock")) || 100));
  else if (qs.get("selftest")) { localStorage.clear(); records = {}; selfTest().then(() => render()); }
  else { render(); if (navigator.onLine) { syncPending({ quiet: true }); checkFormUpdate(); } }
})();
