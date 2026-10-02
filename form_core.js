// Shared by the form (app.js), the dashboard and the admin editor:
//  - which questionnaire to use (built-in default, the version the admin published, or an admin draft in preview)
//  - skip rules (plain JSON, so the admin page can edit them)
//  - the column layout sent to Google Sheets, and form validation
(() => {
  "use strict";
  const KEY = { published: "m69.form", draft: "m69.adminDraft" };
  const load = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  const preview = new URLSearchParams(location.search).get("preview") === "1";

  // ---------------------------------------------------------------- skip rules
  // leaf: { q, op, v }   ops: eq | neq (answered and different) | in | has | nothas (multi answered, does not include) | answered | gte | lte
  // group: { all: [rules] } | { any: [rules] }
  const OPS = {
    eq: "เท่ากับ", neq: "ตอบแล้ว และไม่ใช่", in: "เป็นข้อใดข้อหนึ่งใน", has: "เลือก (ข้อเลือกได้หลายข้อ)",
    nothas: "ตอบแล้ว และไม่ได้เลือก", answered: "ตอบแล้ว", gte: "มากกว่าหรือเท่ากับ", lte: "น้อยกว่าหรือเท่ากับ",
  };
  const blank = (x) => x == null || x === "" || (Array.isArray(x) && !x.length);
  function evalRule(r, a) {
    if (!r) return true;
    if (Array.isArray(r.all)) return r.all.every((x) => evalRule(x, a));
    if (Array.isArray(r.any)) return r.any.some((x) => evalRule(x, a));
    const x = a[r.q];
    switch (r.op) {
      case "eq": return x === r.v;
      case "neq": return !blank(x) && x !== r.v;
      case "in": return Array.isArray(r.v) && r.v.includes(x);
      case "has": return Array.isArray(x) && x.includes(r.v);
      case "nothas": return Array.isArray(x) && x.length > 0 && !x.includes(r.v);
      case "answered": return !blank(x);
      case "gte": return !blank(x) && Number(x) >= Number(r.v);
      case "lte": return !blank(x) && Number(x) <= Number(r.v);
      default: return true;  // unknown op never hides a question
    }
  }
  const ruleRefs = (r) => (!r ? [] : r.all ? r.all.flatMap(ruleRefs) : r.any ? r.any.flatMap(ruleRefs) : [r]);

  // ---------------------------------------------------------------- columns (what goes to Google Sheets)
  const META = [
    ["uuid", "รหัสระบบ (ไม่ซ้ำ)"], ["record_id", "รหัสแบบสอบถาม"], ["form_version", "เวอร์ชันแบบฟอร์ม"],
    ["created_at", "สร้างเมื่อ"], ["updated_at", "แก้ไขล่าสุด"], ["submitted_at", "ส่งเมื่อ"], ["complete_pct", "ตอบครบ (%)"],
  ];
  const questions = (form) => form.sections.flatMap((s) => s.q.map((q) => ({ ...q, section: s.id })));
  function columnSpec(form) {
    const cols = META.map(([key, label]) => ({ key, label, q: "", codes: "" }));
    const codes = (o) => o.map((x) => `${x.v}=${x.label}`).join("; ");
    for (const q of questions(form)) {
      const qn = [q.no, q.t].filter(Boolean).join(" ");
      switch (q.type) {
        case "single":
          cols.push({ key: q.id, label: qn, q: q.no || "", codes: codes(q.o) });
          q.o.filter((x) => x.other).forEach((x) => cols.push({ key: `${q.id}_o${x.v}_text`, label: `${qn} — ระบุ (${x.label})`, q: q.no || "", codes: "" }));
          break;
        case "multi":
          q.o.forEach((x) => {
            cols.push({ key: `${q.id}_o${x.v}`, label: `${qn} — ${x.label}`, q: q.no || "", codes: "1=เลือก; 0=ไม่เลือก" });
            if (x.other) cols.push({ key: `${q.id}_o${x.v}_text`, label: `${qn} — ระบุ (${x.label})`, q: q.no || "", codes: "" });
          });
          break;
        case "grid":
          q.rows.forEach((r) => cols.push({ key: r.id, label: `${r.no || ""} ${r.t}`.trim(), q: r.no || "", codes: codes(q.scale) }));
          break;
        case "dob":
          [["q1_2_day", "วันเกิด"], ["q1_2_month", "เดือนเกิด (1-12)"], ["q1_2_year_be", "ปีเกิด (พ.ศ.)"], ["q1_2_age", "อายุ (ปี)"]]
            .forEach(([key, label]) => cols.push({ key, label: `2 ${label}`, q: "2", codes: "" }));
          break;
        case "animals":
          q.animals.forEach((x) => {
            cols.push({ key: `${q.id}_${x.key}_has`, label: `${qn} — ${x.t}`, q: q.no, codes: "1=ไม่มี; 2=มี" });
            if (x.other) cols.push({ key: `${q.id}_${x.key}_name`, label: `${qn} — ${x.t} (ชนิด)`, q: q.no, codes: "" });
            [["n", "จำนวน (ตัว)"], ["vacc", "รับวัคซีน (ตัว)"], ["deworm", "รับยาถ่ายพยาธิ (ตัว)"]]
              .forEach(([k, l]) => cols.push({ key: `${q.id}_${x.key}_${k}`, label: `${qn} — ${x.t} ${l}`, q: q.no, codes: "" }));
          });
          break;
        default:
          cols.push({ key: q.id, label: qn, q: q.no || "", codes: "" });
      }
    }
    return cols;
  }

  // ---------------------------------------------------------------- validation (admin publish + safety net when loading a remote form)
  const TYPES = ["single", "multi", "grid", "number", "text", "textarea", "date", "dob", "animals", "computed"];
  const ID_RE = /^[a-z][a-z0-9_]*$/;
  function validateForm(form) {
    const err = [];
    if (!form || !Array.isArray(form.sections) || !form.sections.length) return ["ไม่มีส่วนของแบบสอบถาม"];
    if (!form.version || !String(form.version).trim()) err.push("ยังไม่ได้ตั้งชื่อเวอร์ชัน");
    const secIds = new Set();
    const byId = new Map();
    form.sections.forEach((s, si) => {
      const where = `ส่วน “${s.title || si + 1}”`;
      if (!s.id || secIds.has(s.id)) err.push(`${where}: รหัสส่วนว่างหรือซ้ำ`);
      secIds.add(s.id);
      if (!s.title) err.push(`${where}: ไม่มีชื่อส่วน`);
      if (!Array.isArray(s.q)) { err.push(`${where}: ไม่มีรายการคำถาม`); return; }
      s.q.forEach((q, qi) => {
        const w = `${where} ข้อ ${q.no || qi + 1}`;
        if (!ID_RE.test(q.id || "")) err.push(`${w}: รหัสข้อ “${q.id || ""}” ต้องเป็น a-z 0-9 _ และขึ้นต้นด้วยตัวอักษร`);
        if (!TYPES.includes(q.type)) err.push(`${w}: ชนิดคำถาม “${q.type}” ไม่รู้จัก`);
        if (!String(q.t || "").trim()) err.push(`${w}: ไม่มีข้อความคำถาม`);
        if (q.type === "single" || q.type === "multi") {
          if (!Array.isArray(q.o) || q.o.length < 1) err.push(`${w}: ต้องมีตัวเลือกอย่างน้อย 1 ข้อ`);
          else {
            const vs = q.o.map((x) => x.v);
            if (vs.some((v) => !Number.isInteger(v) || v < 1)) err.push(`${w}: รหัสตัวเลือกต้องเป็นจำนวนเต็มบวก`);
            if (new Set(vs).size !== vs.length) err.push(`${w}: รหัสตัวเลือกซ้ำกัน`);
            if (q.o.some((x) => !String(x.label || "").trim())) err.push(`${w}: มีตัวเลือกที่ไม่มีข้อความ`);
          }
        }
        if (q.type === "grid") {
          if (!Array.isArray(q.scale) || q.scale.length < 2) err.push(`${w}: ตารางต้องมีระดับคำตอบอย่างน้อย 2 ระดับ`);
          if (!Array.isArray(q.rows) || !q.rows.length) err.push(`${w}: ตารางต้องมีข้อย่อยอย่างน้อย 1 ข้อ`);
          else q.rows.forEach((r) => {
            if (!ID_RE.test(r.id || "")) err.push(`${w}: รหัสข้อย่อย “${r.id || ""}” ไม่ถูกต้อง`);
            if (!String(r.t || "").trim()) err.push(`${w}: ข้อย่อย ${r.id} ไม่มีข้อความ`);
            byId.set(r.id, { ...r, type: "single", o: q.scale, section: s.id, gridRow: true });
          });
        }
        if (q.type === "number" && q.min != null && q.max != null && Number(q.min) > Number(q.max)) err.push(`${w}: ค่าต่ำสุดมากกว่าค่าสูงสุด`);
        if (q.id) byId.set(q.id, { ...q, section: s.id });
      });
    });
    // every column name must be unique (question ids, option columns and grid rows share one namespace)
    try {
      const keys = columnSpec(form).map((c) => c.key);
      const dup = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
      if (dup.length) err.push(`ชื่อคอลัมน์ซ้ำกัน: ${dup.join(", ")} (เปลี่ยนรหัสข้อให้ไม่ซ้ำ)`);
    } catch (e) { err.push(`สร้างคอลัมน์ไม่ได้: ${e.message}`); }
    // skip rules must point at a real question and a real option
    form.sections.forEach((s) => (s.q || []).forEach((q) => {
      ruleRefs(q.show).forEach((r) => {
        const w = `ข้อ ${q.no || q.id}: เงื่อนไขการแสดง`;
        if (!OPS[r.op]) { err.push(`${w} ใช้ตัวดำเนินการ “${r.op}” ที่ไม่รู้จัก`); return; }
        const t = byId.get(r.q);
        if (!t) { err.push(`${w} อ้างถึงข้อ “${r.q}” ที่ไม่มีอยู่`); return; }
        if (r.q === q.id) err.push(`${w} อ้างถึงตัวเอง`);
        if (t.o && ["eq", "neq", "has", "nothas"].includes(r.op) && !t.o.some((x) => x.v === r.v)) err.push(`${w} อ้างถึงตัวเลือกรหัส ${r.v} ที่ไม่มีในข้อ ${t.no || t.id}`);
        if (t.o && r.op === "in" && (!Array.isArray(r.v) || r.v.some((v) => !t.o.some((x) => x.v === v)))) err.push(`${w} มีรหัสตัวเลือกที่ไม่มีในข้อ ${t.no || t.id}`);
      });
    }));
    return err;
  }

  // ---------------------------------------------------------------- which form to use
  function resolve() {
    const def = window.SURVEY_DEFAULT;
    if (preview) {
      const d = load(KEY.draft);
      if (d && !validateForm(d).length) return { form: d, source: "draft" };
    }
    const p = load(KEY.published);
    if (p && p.form && !validateForm(p.form).length) return { form: p.form, source: "published", saved_at: p.saved_at };
    return { form: def, source: "default" };
  }
  const chosen = resolve();
  window.SURVEY = chosen.form;

  // ask the Apps Script for the form the admin published; caches it for offline use
  async function fetchPublished(api, team) {
    const res = await fetch(`${api}?token=${encodeURIComponent(team)}&action=form`);
    const d = await res.json();
    if (!d.ok) throw new Error(d.error || "โหลดแบบสอบถามไม่สำเร็จ");
    return d.form ? { form: d.form, version: d.version, saved_at: d.saved_at, note: d.note } : null;
  }
  // returns the new version string when a different published form was stored (page needs a reload to use it)
  async function refresh(api, team) {
    if (!api || !team || preview) return null;
    const got = await fetchPublished(api, team);
    if (!got || validateForm(got.form).length) return null;
    const cur = load(KEY.published);
    if (cur && cur.form && cur.form.version === got.form.version && cur.saved_at === got.saved_at) return null;
    store(KEY.published, { form: got.form, saved_at: got.saved_at });
    return got.form.version !== window.SURVEY.version ? got.form.version : null;
  }

  window.M69 = { OPS, evalRule, ruleRefs, columnSpec, questions, validateForm, fetchPublished, refresh, source: chosen.source, preview, KEY };
})();
