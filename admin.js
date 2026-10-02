// Questionnaire editor for the team admin: edit sections, questions, options and skip rules,
// try the draft in the real form (?preview=1), then publish it as a new version into the Google Sheet ("forms" tab).
// Every interviewer's device picks up the published version the next time it is online.
(() => {
  "use strict";
  const app = document.getElementById("app");
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  const sget = (k) => { try { return sessionStorage.getItem(k) || ""; } catch { return ""; } };
  const sset = (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } };
  const META_KEY = "m69.adminDraftMeta";

  // ------------------------------------------------------------ dom
  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (k === "class") n.className = v;
      else if (k === "value") n.value = v;
      else if (k === "checked") n.checked = !!v;
      else if (k === "selected") n.selected = !!v;
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
    toastTimer = setTimeout(() => (t.className = "toast"), 4000);
  }
  // two-step button instead of a blocking confirm() dialog
  function armedBtn(label, confirmLabel, fn, cls = "btn tiny danger") {
    let armed = false;
    const b = h("button", {
      class: cls, type: "button",
      onclick: (e) => {
        e.stopPropagation();
        if (!armed) { armed = true; b.textContent = confirmLabel; setTimeout(() => { armed = false; b.textContent = label; }, 3000); return; }
        fn();
      },
    }, label);
    return b;
  }
  const field = (label, input, hint) => h("label", { class: "field" }, label, input, hint ? h("small", { class: "fine" }, hint) : null);
  const short = (s, n = 60) => (String(s || "").length > n ? String(s).slice(0, n - 1) + "…" : String(s || ""));

  // ------------------------------------------------------------ state
  const settings0 = load("m69.settings", {});
  const conn = { api: settings0.api || "", admin: sget("m69.adminCode") };
  let published = null;   // latest version on the server { form, version, saved_at, note }
  let history = null;     // [{ saved_at, version, note, sections, questions }]
  let connected = false;
  let form, origin;
  const cachedPub = load(M69.KEY.published, null);
  const draft = load(M69.KEY.draft, null);
  if (draft && Array.isArray(draft.sections)) { form = draft; origin = load(META_KEY, {}).origin || "ฉบับร่างในเครื่องนี้"; }
  else if (cachedPub && cachedPub.form) { form = clone(cachedPub.form); origin = `ฉบับเผยแพร่ ${cachedPub.form.version}`; }
  else { form = clone(window.SURVEY_DEFAULT); origin = `ฉบับตั้งต้นในเว็บ (${form.version})`; }
  let curSec = 0;
  const opened = new WeakSet();
  const jsonMode = new WeakSet();   // questions whose rule is edited as raw JSON

  // questions that already exist in a released form keep their id and type: the Sheet already has columns for them
  function knownMap() {
    const m = new Map();
    const add = (f) => f && f.sections.forEach((s) => s.q.forEach((q) => { m.set(q.id, q); (q.rows || []).forEach((r) => m.set(r.id, { ...r, gridRow: true })); }));
    add(window.SURVEY_DEFAULT);
    add(cachedPub && cachedPub.form);
    add(published && published.form);
    return m;
  }
  let known = knownMap();
  const isKnown = (id) => known.has(id);
  const baseForm = () => (published && published.form) || (cachedPub && cachedPub.form) || window.SURVEY_DEFAULT;

  let saveTimer;
  function changed({ rerender = false } = {}) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { store(M69.KEY.draft, form); store(META_KEY, { origin }); updateChecks(); }, 250);
    if (rerender) render();
  }
  function replaceForm(f, from) {
    form = clone(f); origin = from; curSec = 0;
    store(M69.KEY.draft, form); store(META_KEY, { origin });
    render(); window.scrollTo(0, 0);
    toast(`โหลด${from}แล้ว`);
  }

  // ------------------------------------------------------------ server
  async function post(payload) {
    if (!conn.api) throw new Error("ยังไม่ได้ใส่ URL ของ Apps Script");
    const res = await fetch(conn.api, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ adminCode: conn.admin, ...payload }) });
    const text = await res.text();
    let d;
    try { d = JSON.parse(text); } catch { throw new Error("ตอบกลับไม่ใช่ JSON — ตรวจ URL (ต้องลงท้ายด้วย /exec) และ Deploy Apps Script เวอร์ชันใหม่แล้วหรือยัง"); }
    if (!d.ok) throw new Error(d.error || "ไม่สำเร็จ");
    return d;
  }
  async function connect() {
    try {
      await post({ action: "checkAdmin" });
      const [cur, hist] = await Promise.all([post({ action: "getForm" }), post({ action: "formHistory" })]);
      published = cur.form ? { form: cur.form, version: cur.version, saved_at: cur.saved_at, note: cur.note } : null;
      history = hist.versions || [];
      connected = true;
      if (published) store(M69.KEY.published, { form: published.form, saved_at: published.saved_at });
      known = knownMap();
      toast("เชื่อมต่อแล้ว");
    } catch (e) { connected = false; toast(`เชื่อมต่อไม่สำเร็จ: ${e.message || e}`, true); }
    render();
  }

  // ------------------------------------------------------------ helpers over the form
  const TYPE_LABEL = {
    single: "เลือกข้อเดียว", multi: "เลือกได้หลายข้อ", grid: "ตาราง (หลายข้อย่อย ใช้ระดับคำตอบเดียวกัน)", number: "ตัวเลข", text: "ข้อความสั้น",
    textarea: "ข้อความยาว", date: "วันที่", dob: "วันเกิด/อายุ (พิเศษ)", animals: "สัตว์เลี้ยง (พิเศษ)", computed: "คำนวณอัตโนมัติ (พิเศษ)",
  };
  const EDITABLE_TYPES = ["single", "multi", "grid", "number", "text", "textarea", "date"];
  const allIds = () => new Set(M69.columnSpec(form).map((c) => c.key).concat(form.sections.flatMap((s) => s.q.map((q) => q.id))));
  function nextId(sec, prefixOverride) {
    const m = /^s(\d+)$/.exec(sec.id);
    const prefix = prefixOverride || (m ? `q${m[1]}_` : `q_${sec.id}_`);
    const used = allIds();
    let k = sec.q.length + 1;
    while (used.has(prefix + k) || known.has(prefix + k)) k++;
    return { id: prefix + k, k };
  }
  const opts = (...labels) => labels.map((label, i) => ({ v: i + 1, label, other: false, exclusive: false }));
  function newQuestion(sec, type) {
    const { id, k } = nextId(sec);
    const m = /^s(\d+)$/.exec(sec.id);
    const q = { id, no: m ? `${m[1]}.${k}` : "", t: "", type };
    if (type === "single" || type === "multi") q.o = opts("ตัวเลือกที่ 1", "ตัวเลือกที่ 2");
    if (type === "grid") { q.scale = opts("ใช่", "ไม่ใช่"); q.rows = [{ id: `${id}_1`, no: "", t: "" }]; }
    return q;
  }
  function setType(q, type) {
    for (const k of ["o", "scale", "rows", "unit", "min", "max", "step"]) delete q[k];
    if (type === "single" || type === "multi") q.o = opts("ตัวเลือกที่ 1", "ตัวเลือกที่ 2");
    if (type === "grid") { q.scale = opts("ใช่", "ไม่ใช่"); q.rows = [{ id: `${q.id}_1`, no: "", t: "" }]; }
    q.type = type;
  }
  function eachRule(fn) {
    const walk = (r) => { if (!r) return; if (r.all) r.all.forEach(walk); else if (r.any) r.any.forEach(walk); else fn(r); };
    form.sections.forEach((s) => s.q.forEach((q) => walk(q.show)));
  }
  const refsTo = (id) => { let n = 0; eachRule((r) => { if (r.q === id) n++; }); return n; };
  const renameRefs = (from, to) => eachRule((r) => { if (r.q === from) r.q = to; });
  const move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return false; [arr[i], arr[j]] = [arr[j], arr[i]]; return true; };

  // targets a skip rule can look at: choice/number/text questions and grid rows
  function targets() {
    const out = [];
    form.sections.forEach((s) => s.q.forEach((q) => {
      const label = `${q.no ? q.no + " " : ""}${short(q.t, 50)}`;
      if (q.type === "single") out.push({ id: q.id, label, kind: "single", o: q.o });
      else if (q.type === "multi") out.push({ id: q.id, label, kind: "multi", o: q.o });
      else if (q.type === "number") out.push({ id: q.id, label, kind: "number" });
      else if (q.type === "grid") q.rows.forEach((r) => out.push({ id: r.id, label: `${r.no ? r.no + " " : ""}${short(r.t, 50)}`, kind: "single", o: q.scale }));
      else if (q.type === "dob") out.push({ id: "q1_2_age", label: "อายุ (ปี) จากวันเกิด", kind: "number" });
      else if (["text", "textarea", "date"].includes(q.type)) out.push({ id: q.id, label, kind: "text" });
    }));
    return out;
  }
  const OPS_BY_KIND = { single: ["eq", "neq", "in", "answered"], multi: ["has", "nothas", "answered"], number: ["gte", "lte", "eq", "answered"], text: ["answered"] };
  function ruleText(r, T) {
    if (!r) return "";
    if (r.all) return r.all.map((x) => ruleText(x, T)).join(" และ ");
    if (r.any) return "(" + r.any.map((x) => ruleText(x, T)).join(" หรือ ") + ")";
    const t = T.find((x) => x.id === r.q);
    const lab = (v) => (t && t.o ? (t.o.find((o) => o.v === v) || { label: `รหัส ${v}` }).label : v);
    const val = r.op === "answered" ? "" : Array.isArray(r.v) ? r.v.map(lab).join("/") : lab(r.v);
    return `ข้อ ${t ? (short(t.label.split(" ")[0], 12)) : r.q} ${M69.OPS[r.op] || r.op} ${short(val, 40)}`.trim();
  }

  // ------------------------------------------------------------ views
  function topbar() {
    return h("header", { class: "top" },
      h("a", { class: "brand", href: "admin.html" }, h("span", { class: "mark" }, "44"),
        h("span", null, h("b", null, "ผู้ดูแล: แก้ไขแบบสอบถาม"), h("small", null, `กำลังแก้: ${form.version || "(ยังไม่ตั้งชื่อเวอร์ชัน)"} · ${origin}`))),
      h("div", { class: "top-r" },
        h("button", { class: "btn", type: "button", id: "btn-preview", onclick: preview }, "ทดลองใช้"),
        h("a", { class: "btn ghost", href: "index.html" }, "แบบฟอร์ม")));
  }

  function connPanel() {
    const api = h("input", { type: "url", value: conn.api, placeholder: "https://script.google.com/macros/s/…/exec", oninput: (e) => (conn.api = e.target.value.trim()) });
    const code = h("input", { type: "password", value: conn.admin, autocomplete: "off", placeholder: "รหัสผู้ดูแล (ADMIN_CODE)", oninput: (e) => { conn.admin = e.target.value.trim(); sset("m69.adminCode", conn.admin); } });
    return h("section", { class: "apanel" },
      h("h2", null, "1. เชื่อมต่อ Google Sheets"),
      h("div", { class: "arow" }, field("URL ของ Apps Script", api), field("รหัสผู้ดูแล", code), h("button", { class: "btn primary", type: "button", onclick: connect }, connected ? "โหลดใหม่" : "เชื่อมต่อ")),
      h("p", { class: "status" }, connected
        ? (published ? ["ฉบับที่ใช้อยู่ตอนนี้: ", h("b", null, published.version), ` เผยแพร่เมื่อ ${new Date(published.saved_at).toLocaleString("th-TH")}`, published.note ? ` · ${published.note}` : ""]
          : ["ยังไม่เคยเผยแพร่จากหน้านี้ — ทุกเครื่องใช้ฉบับตั้งต้นในเว็บ (", h("b", null, window.SURVEY_DEFAULT.version), ")"])
        : "ยังไม่ได้เชื่อมต่อ (แก้และทดลองได้เลย แต่ต้องเชื่อมต่อก่อนเผยแพร่) · รหัสผู้ดูแลเก็บไว้ในแท็บนี้เท่านั้น"));
  }

  function sourcePanel() {
    const file = h("input", {
      type: "file", accept: ".json,application/json", hidden: true, onchange: async (e) => {
        const f = e.target.files[0]; if (!f) return;
        try { const j = JSON.parse(await f.text()); if (!Array.isArray(j.sections)) throw new Error("ไม่มี sections"); replaceForm(j, `ไฟล์ ${f.name}`); }
        catch (err) { toast(`อ่านไฟล์ไม่ได้: ${err.message}`, true); }
      },
    });
    const exportJson = () => {
      const blob = new Blob([JSON.stringify(form, null, 1)], { type: "application/json" });
      const a = h("a", { href: URL.createObjectURL(blob), download: `แบบสอบถาม_${form.version || "draft"}.json` });
      document.body.append(a); a.click(); a.remove();
    };
    return h("section", { class: "apanel" },
      h("h2", null, "2. เลือกฉบับที่จะแก้"),
      h("p", { class: "status" }, "ตอนนี้กำลังแก้: ", h("b", null, origin), " — บันทึกเป็นร่างในเครื่องนี้อัตโนมัติ"),
      h("div", { class: "arow" },
        published ? armedBtn("โหลดฉบับที่ใช้อยู่", "ทับร่างนี้?", () => replaceForm(published.form, `ฉบับเผยแพร่ ${published.version}`), "btn tiny") : null,
        armedBtn("เริ่มจากฉบับตั้งต้นในเว็บ", "ทับร่างนี้?", () => replaceForm(window.SURVEY_DEFAULT, `ฉบับตั้งต้นในเว็บ (${window.SURVEY_DEFAULT.version})`), "btn tiny"),
        h("button", { class: "btn tiny", type: "button", onclick: () => file.click() }, "นำเข้าไฟล์ JSON"), file,
        h("button", { class: "btn tiny", type: "button", onclick: exportJson }, "ส่งออกไฟล์ JSON")),
      history && history.length ? h("details", { style: "margin-top:10px" }, h("summary", null, `ประวัติเวอร์ชัน (${history.length})`),
        h("table", { class: "hist" }, h("thead", null, h("tr", null, ["เวอร์ชัน", "เผยแพร่เมื่อ", "ส่วน/ข้อ", "หมายเหตุ", ""].map((x) => h("th", null, x)))),
          h("tbody", null, history.slice().reverse().map((v) => h("tr", null,
            h("td", null, v.version), h("td", null, new Date(v.saved_at).toLocaleString("th-TH")), h("td", null, `${v.sections}/${v.questions}`), h("td", null, v.note || ""),
            h("td", null, armedBtn("โหลดมาแก้", "ทับร่างนี้?", async () => {
              try { const d = await post({ action: "getForm", version: v.version }); replaceForm(d.form, `เวอร์ชัน ${v.version} (จากประวัติ)`); }
              catch (e) { toast(e.message || String(e), true); }
            }, "btn tiny"))))))) : null);
  }

  function diffSummary() {
    const base = baseForm();
    const flat = (f) => new Map(f.sections.flatMap((s) => s.q.map((q) => [q.id, JSON.stringify(q)])));
    const a = flat(base), b = flat(form);
    const added = [...b.keys()].filter((k) => !a.has(k)), removed = [...a.keys()].filter((k) => !b.has(k));
    const edited = [...b.keys()].filter((k) => a.has(k) && a.get(k) !== b.get(k));
    const lost = [];  // option codes that disappear from a question that stays
    base.sections.forEach((s) => s.q.forEach((q) => {
      const now = form.sections.flatMap((x) => x.q).find((x) => x.id === q.id);
      if (now && q.o && now.o) q.o.filter((o) => !now.o.some((x) => x.v === o.v)).forEach((o) => lost.push(`${q.id} รหัส ${o.v}`));
    }));
    const list = (xs) => (xs.length ? ` (${short(xs.join(", "), 140)})` : "");
    return h("div", { class: "diff" },
      h("div", null, `เทียบกับ ${base.version}: เพิ่ม `, h("b", null, added.length), " ข้อ", list(added)),
      h("div", null, "แก้ไข ", h("b", null, edited.length), " ข้อ", list(edited)),
      h("div", null, "ลบ ", h("b", null, removed.length), " ข้อ", list(removed), removed.length ? " — ข้อมูลเดิมของข้อที่ลบยังอยู่ใน Sheet" : ""),
      lost.length ? h("div", { class: "notice" }, `ตัวเลือกที่ถูกลบ: ${short(lost.join(", "), 200)} — คำตอบเดิมที่ใช้รหัสนี้ยังอยู่ใน Sheet แต่จะไม่มีคำอธิบายใน Codebook`) : null);
  }

  function suggestVersion() {
    const used = new Set([(history || []).map((v) => v.version), baseForm().version, window.SURVEY_DEFAULT.version].flat());
    let v = form.version || baseForm().version || "form-v1";
    while (used.has(v)) { const m = /^(.*?)(\d+)$/.exec(v); v = m ? m[1] + (Number(m[2]) + 1) : v + "-2"; }
    return v;
  }

  function checkPanel() {
    const ver = h("input", { type: "text", value: suggestVersion(), id: "pub-ver" });
    const note = h("input", { type: "text", placeholder: "เช่น เพิ่มคำถามเรื่องไข้ / แก้ตัวเลือกข้อ 2.1", id: "pub-note" });
    const title = h("input", { type: "text", value: form.title || "", oninput: (e) => { form.title = e.target.value; changed(); } });
    return h("section", { class: "apanel", id: "checks" },
      h("h2", null, "4. ตรวจสอบและเผยแพร่ ", h("span", { id: "errbadge" })),
      h("div", { id: "errlist" }),
      h("div", { id: "difflist" }),
      field("ชื่อแบบสอบถาม", title),
      h("div", { class: "arow", style: "margin-top:10px" },
        field("ชื่อเวอร์ชันใหม่ (ห้ามซ้ำของเดิม)", ver), field("หมายเหตุการแก้ไข", note),
        h("button", { class: "btn primary", type: "button", id: "btn-publish", onclick: () => publish(ver.value.trim(), note.value.trim()) }, "เผยแพร่ให้ทุกเครื่อง")),
      h("p", { class: "fine" }, "หลังเผยแพร่ เครื่องนักศึกษาจะได้ฉบับใหม่เมื่อเปิดแอปตอนมีอินเทอร์เน็ต (มีแถบให้กดโหลดใหม่) · คำตอบที่กรอกไว้แล้วไม่หาย · รหัสข้อและรหัสตัวเลือกเดิมคงที่ คอลัมน์ใหม่ต่อท้ายใน Sheet"));
  }
  function updateChecks() {
    const errs = M69.validateForm(form);
    const badge = document.getElementById("errbadge");
    if (badge) mount(badge, h("span", { class: "badge" + (errs.length ? "" : " ok") }, errs.length ? `${errs.length} ปัญหา` : "ผ่าน"));
    const list = document.getElementById("errlist");
    if (list) mount(list, errs.length ? h("div", { class: "notice bad" }, h("b", null, "ต้องแก้ก่อนทดลองใช้/เผยแพร่"), h("ul", { class: "errs" }, errs.slice(0, 30).map((e) => h("li", null, e)))) : h("div", { class: "notice good" }, "ไม่พบปัญหา ทดลองใช้หรือเผยแพร่ได้"));
    const d = document.getElementById("difflist");
    if (d) mount(d, diffSummary());
    const pb = document.getElementById("btn-publish"); if (pb) pb.disabled = !!errs.length;
    const pv = document.getElementById("btn-preview"); if (pv) pv.disabled = !!errs.length;
    const t = document.querySelector(".brand small"); if (t) t.textContent = `กำลังแก้: ${form.version || "(ยังไม่ตั้งชื่อเวอร์ชัน)"} · ${origin}`;
    return errs;
  }

  function preview() {
    if (updateChecks().length) { toast("แก้ปัญหาในข้อ 4 ก่อนทดลองใช้", true); return; }
    store(M69.KEY.draft, form);
    window.open("index.html?preview=1", "_blank");
  }

  async function publish(version, note) {
    if (!connected) { toast("เชื่อมต่อ Google Sheets (ข้อ 1) ก่อนเผยแพร่", true); return; }
    if (!version) { toast("ตั้งชื่อเวอร์ชันก่อน", true); return; }
    if ((history || []).some((v) => v.version === version)) { toast(`มีเวอร์ชัน ${version} อยู่แล้ว`, true); return; }
    const out = clone(form);
    out.version = version;
    const errs = M69.validateForm(out);
    if (errs.length) { toast("ยังมีปัญหาที่ต้องแก้", true); updateChecks(); return; }
    const btn = document.getElementById("btn-publish");
    btn.disabled = true; btn.textContent = "กำลังเผยแพร่…";
    try {
      const d = await post({ action: "saveForm", form: out, note });
      form = out; origin = `ฉบับเผยแพร่ ${version}`;
      published = { form: clone(out), version, saved_at: d.saved_at, note };
      store(M69.KEY.published, { form: published.form, saved_at: d.saved_at });
      store(M69.KEY.draft, form); store(META_KEY, { origin });
      history = (await post({ action: "formHistory" })).versions || history;
      known = knownMap();
      toast(`เผยแพร่ ${version} แล้ว`);
    } catch (e) { toast(`เผยแพร่ไม่สำเร็จ: ${e.message || e}`, true); }
    render();
  }

  // ------------------------------------------------------------ editor
  function sectionList() {
    return h("nav", { class: "secs" },
      form.sections.map((s, i) => h("div", { class: "secitem" + (i === curSec ? " cur" : ""), onclick: () => { curSec = i; render(); window.scrollTo(0, document.getElementById("editor").offsetTop - 70); } },
        h("span", null, s.short || s.title || s.id, s.q.some((q) => !isKnown(q.id)) ? h("span", { class: "new" }, "●") : null),
        h("small", null, `${s.q.length} ข้อ`))),
      h("div", { style: "padding:8px" }, h("button", {
        class: "btn tiny", type: "button", onclick: () => {
          const n = Math.max(0, ...form.sections.map((s) => Number((/^s(\d+)$/.exec(s.id) || [])[1]) || 0)) + 1;
          form.sections.push({ id: `s${n}`, title: `ส่วนที่ ${n} (ตั้งชื่อส่วน)`, short: "ส่วนใหม่", q: [] });
          curSec = form.sections.length - 1; changed({ rerender: true });
        },
      }, "+ เพิ่มส่วน")));
  }

  function sectionEditor() {
    const s = form.sections[curSec];
    if (!s) return h("p", null, "ไม่มีส่วน");
    const locked = s.q.some((q) => isKnown(q.id));
    return h("div", null,
      h("div", { class: "apanel" },
        h("div", { class: "g2" },
          field("ชื่อส่วน", h("input", { type: "text", value: s.title || "", oninput: (e) => { s.title = e.target.value; changed(); } })),
          field("ชื่อสั้น (เมนูด้านข้าง)", h("input", { type: "text", value: s.short || "", oninput: (e) => { s.short = e.target.value; changed(); } }))),
        field("คำอธิบายใต้หัวข้อ (ถ้ามี)", h("input", { type: "text", value: s.note || "", oninput: (e) => { if (e.target.value) s.note = e.target.value; else delete s.note; changed(); } })),
        h("div", { class: "arow", style: "margin-top:8px" },
          h("button", { class: "btn tiny", type: "button", disabled: curSec === 0, onclick: () => { if (move(form.sections, curSec, -1)) curSec--; changed({ rerender: true }); } }, "↑ เลื่อนส่วนขึ้น"),
          h("button", { class: "btn tiny", type: "button", disabled: curSec === form.sections.length - 1, onclick: () => { if (move(form.sections, curSec, 1)) curSec++; changed({ rerender: true }); } }, "↓ เลื่อนส่วนลง"),
          form.sections.length > 1 ? armedBtn("ลบส่วนนี้", locked ? "มีข้อเดิม ยืนยันลบ?" : "ยืนยันลบ?", () => { form.sections.splice(curSec, 1); curSec = Math.max(0, curSec - 1); changed({ rerender: true }); }) : null,
          h("span", { class: "fine" }, `รหัสส่วน ${s.id}`))),
      s.q.map((q, i) => questionCard(s, q, i)),
      h("div", { class: "addq" }, h("span", { class: "fine" }, "เพิ่มคำถามท้ายส่วนนี้:"),
        ["single", "multi", "number", "text", "grid"].map((t) => h("button", {
          class: "btn tiny", type: "button", onclick: () => { const q = newQuestion(s, t); s.q.push(q); opened.add(q); changed({ rerender: true }); },
        }, `+ ${TYPE_LABEL[t].split(" (")[0]}`))));
  }

  function questionCard(s, q, i) {
    const T = targets();
    const isOpen = opened.has(q);
    const lockedQ = isKnown(q.id);
    const head = h("div", { class: "qhead", onclick: () => { isOpen ? opened.delete(q) : opened.add(q); render(); } },
      h("div", null,
        h("div", { class: "qt" }, q.no ? h("b", null, q.no) : null, q.t || h("i", { class: "fine" }, "(ยังไม่มีข้อความคำถาม)")),
        h("div", { class: "qmeta" },
          h("span", { class: "tag" }, TYPE_LABEL[q.type] ? TYPE_LABEL[q.type].split(" (")[0] : q.type),
          h("span", { class: "tag" + (lockedQ ? " lock" : " new") }, lockedQ ? `รหัส ${q.id}` : `ใหม่ · ${q.id}`),
          q.req ? h("span", { class: "tag" }, "จำเป็น") : null,
          q.show ? h("span", { class: "tag rule" }, "แสดงเมื่อ " + ruleText(q.show, T)) : null)),
      h("div", { class: "qtools" },
        h("button", { class: "btn tiny", type: "button", title: "เลื่อนขึ้น", disabled: i === 0, onclick: (e) => { e.stopPropagation(); move(s.q, i, -1); changed({ rerender: true }); } }, "↑"),
        h("button", { class: "btn tiny", type: "button", title: "เลื่อนลง", disabled: i === s.q.length - 1, onclick: (e) => { e.stopPropagation(); move(s.q, i, 1); changed({ rerender: true }); } }, "↓"),
        form.sections.length > 1 ? h("select", {
          class: "btn tiny", title: "ย้ายไปส่วนอื่น", style: "width:auto;min-height:32px;padding:2px 6px;font-size:13px", onclick: (e) => e.stopPropagation(),
          onchange: (e) => { const to = Number(e.target.value); if (to >= 0 && to !== curSec) { s.q.splice(i, 1); form.sections[to].q.push(q); changed({ rerender: true }); toast(`ย้ายไป ${form.sections[to].short || form.sections[to].title} แล้ว`); } },
        }, h("option", { value: -1 }, "ย้าย…"), form.sections.map((x, j) => (j === curSec ? null : h("option", { value: j }, short(x.short || x.title, 24))))) : null,
        armedBtn("ลบ", refsTo(q.id) ? `มีข้ออื่นอ้างถึง ${refsTo(q.id)} — ลบ?` : lockedQ ? "ข้อเดิม ยืนยันลบ?" : "ยืนยัน?", () => { s.q.splice(i, 1); changed({ rerender: true }); })));
    return h("div", { class: "qcard" + (isOpen ? " open" : "") }, head, isOpen ? questionBody(q, T) : null);
  }

  function questionBody(q, T) {
    const lockedQ = isKnown(q.id);
    const special = !EDITABLE_TYPES.includes(q.type);
    const idInput = h("input", {
      type: "text", value: q.id, disabled: lockedQ, spellcheck: "false",
      onchange: (e) => {
        const v = e.target.value.trim();
        if (!/^[a-z][a-z0-9_]*$/.test(v)) { toast("รหัสข้อใช้ได้เฉพาะ a-z 0-9 _ และขึ้นต้นด้วยตัวอักษร", true); e.target.value = q.id; return; }
        if (v !== q.id && allIds().has(v)) { toast(`รหัส ${v} ซ้ำกับที่มีอยู่`, true); e.target.value = q.id; return; }
        renameRefs(q.id, v); q.id = v; changed({ rerender: true });
      },
    });
    const typeSel = h("select", {
      disabled: lockedQ || special,
      onchange: (e) => { setType(q, e.target.value); changed({ rerender: true }); },
    }, (special ? [q.type] : EDITABLE_TYPES).map((t) => h("option", { value: t, selected: t === q.type }, TYPE_LABEL[t])));
    const setProp = (k) => (e) => { const v = e.target.value; if (v === "") delete q[k]; else q[k] = v; changed(); };
    const setNum = (k) => (e) => { const v = e.target.value; if (v === "") delete q[k]; else q[k] = Number(v); changed(); };
    return h("div", { class: "qbody" },
      h("div", { class: "g2" },
        field("รหัสข้อ (ชื่อคอลัมน์ใน Sheet)", idInput, lockedQ ? "ข้อนี้มีอยู่ในฉบับที่ใช้แล้ว จึงเปลี่ยนรหัสและชนิดไม่ได้ (ข้อมูลเดิมจะไม่ตรงคอลัมน์)" : "ตั้งได้ครั้งเดียวก่อนเผยแพร่ ภาษาอังกฤษตัวเล็ก ตัวเลข _"),
        field("เลขข้อที่แสดง", h("input", { type: "text", value: q.no || "", oninput: setProp("no") }))),
      field("ข้อความคำถาม", h("textarea", { rows: 2, oninput: (e) => { q.t = e.target.value; changed(); } }, q.t || "")),
      h("div", { class: "g2" },
        field("ชนิดคำถาม", typeSel),
        field("คำแนะนำผู้สัมภาษณ์ (แสดงใต้คำถาม)", h("input", { type: "text", value: q.hint || "", oninput: setProp("hint") }))),
      h("label", { class: "chk" }, h("input", { type: "checkbox", checked: !!q.req, onchange: (e) => { if (e.target.checked) q.req = true; else delete q.req; changed(); } }), "จำเป็นต้องตอบ (ส่งไม่ได้ถ้าไม่ตอบ)"),
      q.type === "single" || q.type === "multi" ? optionEditor(q, q.o, { multi: q.type === "multi", flags: true }) : null,
      q.type === "grid" ? [h("p", { class: "sub" }, "ระดับคำตอบ (ใช้กับทุกข้อย่อย)"), optionEditor(q, q.scale, { flags: false }), gridRowsEditor(q)] : null,
      q.type === "number" ? h("div", { class: "g4" },
        field("หน่วย", h("input", { type: "text", value: q.unit || "", oninput: setProp("unit") })),
        field("ต่ำสุด", h("input", { type: "number", value: q.min ?? "", oninput: setNum("min") })),
        field("สูงสุด", h("input", { type: "number", value: q.max ?? "", oninput: setNum("max") })),
        field("ทศนิยม (step)", h("input", { type: "number", value: q.step ?? "", step: "any", placeholder: "1", oninput: setNum("step") }))) : null,
      special ? h("p", { class: "fine" }, "ชนิดพิเศษ: แก้ได้เฉพาะข้อความและเงื่อนไขการแสดง") : null,
      ruleEditor(q, T));
  }

  function optionEditor(q, list, { multi = false, flags = true } = {}) {
    const knownQ = known.get(q.id);
    const knownCodes = new Set(((knownQ && (knownQ.o || knownQ.scale)) || []).map((o) => o.v));
    return h("div", null,
      flags ? h("p", { class: "sub" }, "ตัวเลือก (ตัวเลขด้านหน้า = รหัสที่บันทึกใน Sheet ไม่เปลี่ยนเมื่อเลื่อนลำดับ)") : null,
      h("div", { class: "olist" }, list.map((o, i) => h("div", { class: "orow" },
        h("span", { class: "code", title: "รหัสคำตอบ" }, o.v),
        h("input", { type: "text", value: o.label, oninput: (e) => { o.label = e.target.value; changed(); } }),
        flags ? h("label", { class: "chk", title: "มีช่องให้พิมพ์ระบุ" }, h("input", { type: "checkbox", checked: !!o.other, onchange: (e) => { o.other = e.target.checked; changed(); } }), "ระบุ") : h("span"),
        flags && multi ? h("label", { class: "chk", title: "เลือกข้อนี้แล้วข้ออื่นถูกล้าง เช่น ‘ไม่มี’" }, h("input", { type: "checkbox", checked: !!o.exclusive, onchange: (e) => { o.exclusive = e.target.checked; changed(); } }), "ตอบเดี่ยว") : h("span"),
        h("span", { class: "mini" },
          h("button", { class: "btn tiny", type: "button", disabled: i === 0, onclick: () => { move(list, i, -1); changed({ rerender: true }); } }, "↑"),
          h("button", { class: "btn tiny", type: "button", disabled: i === list.length - 1, onclick: () => { move(list, i, 1); changed({ rerender: true }); } }, "↓"),
          armedBtn("×", knownCodes.has(o.v) ? "รหัสเดิม ลบ?" : "ลบ?", () => { list.splice(i, 1); changed({ rerender: true }); }))))),
      h("button", {
        class: "btn tiny", type: "button", style: "margin-top:6px",
        onclick: () => { const v = Math.max(0, ...list.map((x) => x.v), ...knownCodes) + 1; list.push({ v, label: `ตัวเลือกที่ ${v}`, other: false, exclusive: false }); changed({ rerender: true }); },
      }, "+ เพิ่มตัวเลือก"));
  }

  function gridRowsEditor(q) {
    return h("div", null,
      h("p", { class: "sub" }, "ข้อย่อย (แต่ละข้อย่อยเป็น 1 คอลัมน์)"),
      h("div", { class: "olist" }, q.rows.map((r, i) => h("div", { class: "orow grow" },
        h("input", {
          type: "text", value: r.id, disabled: isKnown(r.id), title: "รหัสคอลัมน์",
          onchange: (e) => {
            const v = e.target.value.trim();
            if (!/^[a-z][a-z0-9_]*$/.test(v) || (v !== r.id && allIds().has(v))) { toast("รหัสข้อย่อยไม่ถูกต้องหรือซ้ำ", true); e.target.value = r.id; return; }
            renameRefs(r.id, v); r.id = v; changed({ rerender: true });
          },
        }),
        h("input", { type: "text", value: r.no || "", placeholder: "เลขข้อ", oninput: (e) => { r.no = e.target.value; changed(); } }),
        h("input", { type: "text", value: r.t || "", placeholder: "ข้อความข้อย่อย", oninput: (e) => { r.t = e.target.value; changed(); } }),
        h("span", { class: "mini" },
          h("button", { class: "btn tiny", type: "button", disabled: i === 0, onclick: () => { move(q.rows, i, -1); changed({ rerender: true }); } }, "↑"),
          h("button", { class: "btn tiny", type: "button", disabled: i === q.rows.length - 1, onclick: () => { move(q.rows, i, 1); changed({ rerender: true }); } }, "↓"),
          q.rows.length > 1 ? armedBtn("×", isKnown(r.id) ? "ข้อเดิม ลบ?" : "ลบ?", () => { q.rows.splice(i, 1); changed({ rerender: true }); }) : null)))),
      h("button", {
        class: "btn tiny", type: "button", style: "margin-top:6px",
        onclick: () => { const used = allIds(); let k = q.rows.length + 1; while (used.has(`${q.id}_${k}`) || known.has(`${q.id}_${k}`)) k++; q.rows.push({ id: `${q.id}_${k}`, no: "", t: "" }); changed({ rerender: true }); },
      }, "+ เพิ่มข้อย่อย"));
  }

  // ------------------------------------------------------------ skip-rule builder
  function ruleShape(r) {
    if (!r) return { mode: "none", leaves: [] };
    if (r.q) return { mode: "all", leaves: [r] };
    const key = r.all ? "all" : r.any ? "any" : null;
    if (key && r[key].every((x) => x && x.q)) return { mode: key, leaves: r[key] };
    return { mode: "json", leaves: [] };
  }
  function ruleEditor(q, T) {
    const shape = ruleShape(q.show);
    const choices = T.filter((t) => t.id !== q.id && !(q.rows || []).some((r) => r.id === t.id));
    const write = (mode, leaves) => {
      if (mode === "none" || !leaves.length) delete q.show;
      else q.show = leaves.length === 1 ? leaves[0] : { [mode]: leaves };
      changed({ rerender: true });
    };
    // default: the closest choice question above this one
    const before = (x) => { const all = form.sections.flatMap((s) => s.q); const qi = all.indexOf(q); const ti = all.findIndex((y) => y.id === x.id || (y.rows || []).some((r) => r.id === x.id) || (y.type === "dob" && x.id === "q1_2_age")); return ti >= 0 && ti < qi; };
    const defaultLeaf = () => {
      const t = choices.filter(before).reverse().find((x) => x.kind === "single" || x.kind === "multi") || choices.find((x) => x.o) || choices[0];
      const op = OPS_BY_KIND[t.kind][0];
      return { q: t.id, op, ...(t.o ? { v: t.o[0].v } : op === "answered" ? {} : { v: 0 }) };
    };
    const modeSel = h("select", {
      onchange: (e) => {
        const m = e.target.value;
        if (m === "none") return write("none", []);
        if (m === "json") { q.show = q.show || defaultLeaf(); jsonMode.add(q); return changed({ rerender: true }); }
        jsonMode.delete(q);
        write(m, shape.leaves.length ? shape.leaves : [defaultLeaf()]);
      },
    }, [["none", "แสดงทุกครั้ง"], ["all", "แสดงเมื่อเป็นจริงทุกเงื่อนไข (และ)"], ["any", "แสดงเมื่อเป็นจริงอย่างน้อย 1 เงื่อนไข (หรือ)"], ["json", "เงื่อนไขซับซ้อน (แก้เป็น JSON)"]]
      .map(([v, l]) => h("option", { value: v, selected: (jsonMode.has(q) ? "json" : shape.mode) === v }, l)));

    let body;
    if (jsonMode.has(q) || shape.mode === "json") {
      const ta = h("textarea", {
        rows: 4, spellcheck: "false", style: "font-family:ui-monospace,monospace;font-size:13px",
        onchange: (e) => {
          try { const v = JSON.parse(e.target.value || "null"); if (v) q.show = v; else delete q.show; ta.style.borderColor = ""; changed(); }
          catch { ta.style.borderColor = "var(--bad)"; toast("JSON ไม่ถูกต้อง", true); }
        },
      }, JSON.stringify(q.show || null));
      body = [ta, h("p", { class: "fine" }, 'รูปแบบ: {"q":"q3_1","op":"has","v":1} หรือ {"all":[…]} / {"any":[…]} ซ้อนกันได้ · op: ' + Object.keys(M69.OPS).join(", "))];
    } else if (shape.mode !== "none") {
      const leaves = shape.leaves.map((x) => ({ ...x }));
      body = [leaves.map((leaf, i) => leafRow(leaf, choices, () => write(shape.mode, leaves), () => { leaves.splice(i, 1); write(shape.mode, leaves); })),
        h("div", null, h("button", { class: "btn tiny", type: "button", onclick: () => { leaves.push(defaultLeaf()); write(shape.mode, leaves); } }, "+ เพิ่มเงื่อนไข"))];
    }
    return h("div", { class: "rulebox" }, h("p", { class: "sub" }, "เงื่อนไขการแสดงข้อนี้ (ข้อที่ไม่แสดงจะถูกข้ามและเว้นว่างใน Sheet)"), modeSel, body || null);
  }
  function leafRow(leaf, choices, commit, remove) {
    const t = choices.find((x) => x.id === leaf.q);
    const kind = t ? t.kind : "text";
    const ops = OPS_BY_KIND[kind];
    const tSel = h("select", {
      onchange: (e) => {
        const nt = choices.find((x) => x.id === e.target.value);
        leaf.q = nt.id; leaf.op = OPS_BY_KIND[nt.kind][0];
        if (nt.o) leaf.v = leaf.op === "in" ? [nt.o[0].v] : nt.o[0].v; else if (leaf.op === "answered") delete leaf.v; else leaf.v = 0;
        commit();
      },
    }, t ? null : h("option", { value: leaf.q, selected: true }, `⚠ ไม่พบข้อ ${leaf.q}`), choices.map((c) => h("option", { value: c.id, selected: c.id === leaf.q }, `${short(c.label, 58)} (${c.id})`)));
    const opSel = h("select", {
      onchange: (e) => {
        leaf.op = e.target.value;
        if (leaf.op === "answered") delete leaf.v;
        else if (leaf.op === "in") leaf.v = Array.isArray(leaf.v) ? leaf.v : leaf.v != null ? [leaf.v] : t && t.o ? [t.o[0].v] : [];
        else if (Array.isArray(leaf.v)) leaf.v = leaf.v[0] ?? (t && t.o ? t.o[0].v : 0);
        else if (leaf.v == null) leaf.v = t && t.o ? t.o[0].v : 0;
        commit();
      },
    }, (ops.includes(leaf.op) ? ops : [leaf.op, ...ops]).map((o) => h("option", { value: o, selected: o === leaf.op }, M69.OPS[o] || o)));
    let val;
    if (leaf.op === "answered") val = h("span");
    else if (leaf.op === "in" && t && t.o) {
      const cur = new Set(Array.isArray(leaf.v) ? leaf.v : []);
      val = h("div", { class: "inset" }, t.o.map((o) => h("label", { class: "chk" }, h("input", {
        type: "checkbox", checked: cur.has(o.v),
        onchange: (e) => { if (e.target.checked) cur.add(o.v); else cur.delete(o.v); leaf.v = t.o.map((x) => x.v).filter((v) => cur.has(v)); commit(); },
      }), short(o.label, 30))));
    } else if (t && t.o) {
      val = h("select", { onchange: (e) => { leaf.v = Number(e.target.value); commit(); } },
        t.o.map((o) => h("option", { value: o.v, selected: o.v === leaf.v }, `${o.v}. ${short(o.label, 40)}`)));
    } else {
      val = h("input", { type: "number", value: leaf.v ?? "", onchange: (e) => { leaf.v = Number(e.target.value); commit(); } });
    }
    return h("div", { class: "rrow" }, tSel, opSel, val, h("button", { class: "btn tiny danger", type: "button", onclick: remove }, "×"));
  }

  // ------------------------------------------------------------ page
  function render() {
    const y = window.scrollY;
    mount(app, topbar(), h("main", { class: "awrap" },
      connPanel(),
      sourcePanel(),
      h("section", { class: "apanel", style: "padding-bottom:4px" }, h("h2", null, "3. แก้ไขคำถาม"),
        h("p", { class: "fine", style: "margin-top:0" }, "เลือกส่วนทางซ้าย กดที่คำถามเพื่อแก้ · ข้อที่มีอยู่แล้วเปลี่ยนรหัสและชนิดไม่ได้ เพื่อให้ข้อมูลเก่าใน Sheet ยังตรงคอลัมน์ · ทุกการแก้บันทึกเป็นร่างในเครื่องทันที")),
      h("div", { class: "editor", id: "editor" }, sectionList(), sectionEditor()),
      checkPanel()));
    updateChecks();
    window.scrollTo(0, y);
  }
  window.addEventListener("beforeunload", () => store(M69.KEY.draft, form));
  render();
})();
