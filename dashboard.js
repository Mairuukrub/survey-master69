(() => {
  "use strict";
  let S = window.SURVEY;  // replaced by the admin-published form once loaded
  const app = document.getElementById("app");
  const tip = document.getElementById("tip");
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const qp = new URLSearchParams(location.search);
  let settings = { api: qp.get("api") || load("m69.settings", {}).api || "", team: qp.get("team") || load("m69.settings", {}).team || "" };
  let ALL = [];          // rows as objects keyed by column
  let source = "";
  const F = { moo: "", sex: "", age: "", mock: true, sec: "s15" };

  let Q = {};            // question id -> question (incl. grid rows)
  function indexForm() {
    Q = {};
    S.sections.forEach((s) => s.q.forEach((q) => { Q[q.id] = { ...q, section: s.id }; if (q.rows) q.rows.forEach((r) => (Q[r.id] = { ...r, parent: q })); }));
    if (!S.sections.some((s) => s.id === F.sec)) F.sec = S.sections[S.sections.length - 1].id;
  }
  indexForm();

  // ------------------------------------------------------------ dom
  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (k === "class") n.className = v;
      else if (k === "style") n.setAttribute("style", v);
      else if (k === "value") n.value = v;
      else if (k === "checked") n.checked = !!v;
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return n;
  }
  const mount = (node, ...kids) => node.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
  const pct = (n, d) => (d ? (100 * n) / d : 0);
  const fmtPct = (n, d) => (d ? `${pct(n, d).toLocaleString("th-TH", { maximumFractionDigits: 1 })}%` : "–");
  const num = (v) => (v === "" || v == null ? null : Number(v));
  function hover(el, text) {
    el.addEventListener("pointermove", (e) => { tip.textContent = text; tip.hidden = false; tip.style.left = Math.min(e.clientX + 14, innerWidth - 330) + "px"; tip.style.top = e.clientY + 14 + "px"; });
    el.addEventListener("pointerleave", () => (tip.hidden = true));
  }

  // ------------------------------------------------------------ data
  async function fetchRows() {
    const res = await fetch(`${settings.api}?token=${encodeURIComponent(settings.team)}&action=rows`);
    const d = await res.json();
    if (!d.ok) throw new Error(d.error || "อ่านข้อมูลไม่สำเร็จ");
    return d.header.length ? d.rows.map((r) => Object.fromEntries(d.header.map((k, i) => [k, r[i]]))) : [];
  }
  function parseCsv(text) {
    const rows = []; let row = [], cur = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
      else cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    const header = (rows.shift() || []).map((x) => x.replace(/^﻿/, ""));
    return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((k, i) => [k, r[i] ?? ""])));
  }

  const isMock = (r) => String(r.record_id || "").startsWith("MOCK") || r.iv_zone === "MOCK";
  function filtered() {
    return ALL.filter((r) => (F.mock || !isMock(r))
      && (!F.moo || String(r.h_moo) === F.moo)
      && (!F.sex || String(r.q1_1) === F.sex)
      && (!F.age || (F.age === "lt60" ? num(r.q1_2_age) < 60 : num(r.q1_2_age) >= 60)));
  }

  // single: share of each option among those who answered; multi: share ticking each option among those who answered
  function single(rows, id) {
    const q = Q[id], ans = rows.filter((r) => r[id] !== "" && r[id] != null);
    if (!q || !q.o) return { d: 0, items: [] };
    return { d: ans.length, items: q.o.map((x) => ({ label: x.label, n: ans.filter((r) => Number(r[id]) === x.v).length })) };
  }
  function multi(rows, id, { dropNone = false } = {}) {
    const q = Q[id];
    if (!q || !q.o) return { d: 0, items: [] };
    const ans = rows.filter((r) => q.o.some((x) => r[`${id}_o${x.v}`] !== "" && r[`${id}_o${x.v}`] != null));
    return { d: ans.length, items: q.o.filter((x) => !(dropNone && x.exclusive)).map((x) => ({ label: x.label, n: ans.filter((r) => String(r[`${id}_o${x.v}`]) === "1").length })) };
  }
  function gridShare(rows, gridId, codes) {
    const g = Q[gridId];
    if (!g || !g.rows) return [];
    return g.rows.map((r) => { const ans = rows.filter((x) => x[r.id] !== "" && x[r.id] != null); return { label: r.t, n: ans.filter((x) => codes.includes(Number(x[r.id]))).length, d: ans.length }; });
  }
  const sortDesc = (items) => [...items].sort((a, b) => pct(b.n, b.d) - pct(a.n, a.d));

  // ------------------------------------------------------------ visuals
  function bars(items, d, { sort = true, s2 = false } = {}) {
    const list = items.map((x) => ({ ...x, d: x.d ?? d }));
    const rows = sort ? sortDesc(list).filter((x) => x.n > 0) : list;  // nominal lists: hide options nobody picked
    const max = Math.max(1, ...rows.map((x) => pct(x.n, x.d)));
    return h("div", { class: "bars" }, rows.map((x) => {
      const w = (pct(x.n, x.d) / max) * 100;
      const el = h("div", { class: "brow" }, h("span", { class: "bl", title: x.label }, x.label),
        h("span", { class: "btrack" }, h("span", { class: "bfill" + (s2 ? " s2" : ""), style: `width:calc((100% - 92px) * ${(w / 100).toFixed(4)})` }),
          h("span", { class: "bval" }, fmtPct(x.n, x.d), " ", h("small", null, `(${x.n}/${x.d})`))));
      hover(el, `${x.label}: ${fmtPct(x.n, x.d)} — ${x.n} จาก ${x.d} คน`);
      return el;
    }));
  }
  function bySex(rows, labels) {   // grouped bars: ชาย vs หญิง for several yes/no measures
    const m = rows.filter((r) => String(r.q1_1) === "1"), f = rows.filter((r) => String(r.q1_1) === "2");
    const items = labels.map(([label, test, base]) => {
      const bm = base ? m.filter(base) : m, bf = base ? f.filter(base) : f;
      return { label, m: { n: bm.filter(test).length, d: bm.length }, f: { n: bf.filter(test).length, d: bf.length } };
    });
    const max = Math.max(1, ...items.flatMap((x) => [pct(x.m.n, x.m.d), pct(x.f.n, x.f.d)]));
    return h("div", null, h("div", { class: "legend" }, h("span", null, h("i"), `ชาย (${m.length})`), h("span", null, h("i", { class: "s2" }), `หญิง (${f.length})`)),
      h("div", { class: "bars" }, items.map((x) => h("div", { class: "brow" }, h("span", { class: "bl", title: x.label }, x.label),
        h("span", { class: "gpair" }, [["m", ""], ["f", " s2"]].map(([k, cls]) => {
          const v = x[k], w = pct(v.n, v.d) / max;
          const el = h("span", { class: "btrack" }, h("span", { class: "bfill" + cls, style: `width:calc((100% - 92px) * ${w.toFixed(4)})` }), h("span", { class: "bval" }, fmtPct(v.n, v.d), " ", h("small", null, `(${v.n}/${v.d})`)));
          hover(el, `${x.label} · ${k === "m" ? "ชาย" : "หญิง"}: ${fmtPct(v.n, v.d)} (${v.n}/${v.d})`);
          return el;
        }))))));
  }
  function pyramid(rows) {
    const bands = ["20-29", "30-39", "40-49", "50-59", "60-69", "70-79", "80+"];
    const band = (a) => (a < 30 ? 0 : a < 40 ? 1 : a < 50 ? 2 : a < 60 ? 3 : a < 70 ? 4 : a < 80 ? 5 : 6);
    const cnt = bands.map(() => ({ m: 0, f: 0 }));
    rows.forEach((r) => { const a = num(r.q1_2_age); if (a == null || a < 15) return; const b = cnt[band(a)]; if (String(r.q1_1) === "1") b.m++; else if (String(r.q1_1) === "2") b.f++; });
    const max = Math.max(1, ...cnt.flatMap((c) => [c.m, c.f]));
    return h("div", null, h("div", { class: "legend" }, h("span", null, h("i"), "ชาย"), h("span", null, h("i", { class: "s2" }), "หญิง")),
      h("div", { class: "pyr" }, bands.map((b, i) => i).reverse().map((i) => h("div", { class: "prow" },
        h("span", { class: "l" }, h("span", { class: "n" }, cnt[i].m), h("span", { class: "pbar m", style: `width:${(cnt[i].m / max) * 85}%` })),
        h("span", { class: "age" }, bands[i]),
        h("span", { class: "r" }, h("span", { class: "pbar f", style: `width:${(cnt[i].f / max) * 85}%` }), h("span", { class: "n" }, cnt[i].f))))));
  }
  const card = (title, sub, body, wide) => h("div", { class: "card" + (wide ? " wide" : "") }, h("h3", null, title), sub ? h("p", { class: "sub" }, sub) : null, body);
  const kpi = (v, k, s) => h("div", { class: "kpi" }, h("div", { class: "v" }, v), h("div", { class: "k" }, k), s ? h("div", { class: "s" }, s) : null);
  const section = (title, ...cards) => h("section", { class: "dsec" }, h("h2", null, title), h("div", { class: "cards" }, cards));

  // one card per question, chosen by its type: works for any question the admin adds
  function cardQ(rows, id, { title, sub, wide } = {}) {
    const q = Q[id];
    if (!q) return null;
    const t = title || [q.no, q.t].filter(Boolean).join(" ");
    if (q.type === "single") { const x = single(rows, id); return card(t, sub || `${x.d} คนที่ตอบ`, x.d ? bars(x.items, x.d, { sort: false }) : h("p", { class: "empty-c" }, "ยังไม่มีคำตอบ"), wide); }
    if (q.type === "multi") {
      const x = multi(rows, id, { dropNone: true }), none = q.o.find((o) => o.exclusive);
      const nNone = none ? rows.filter((r) => String(r[`${id}_o${none.v}`]) === "1").length : 0;
      return card(t, sub || `${x.d} คนที่ตอบ · ตอบได้หลายข้อ${none ? ` · ${none.label} ${fmtPct(nNone, x.d)}` : ""}`, x.d ? bars(x.items, x.d) : h("p", { class: "empty-c" }, "ยังไม่มีคำตอบ"), wide);
    }
    if (q.type === "grid") {
      return card(t, sub || "ร้อยละของผู้ตอบแต่ละข้อย่อย", h("div", { style: "overflow-x:auto" }, h("table", { class: "tbl" },
        h("thead", null, h("tr", null, h("th", null, ""), q.scale.map((x) => h("th", { class: "n" }, x.label)), h("th", { class: "n" }, "n"))),
        h("tbody", null, q.rows.map((r) => {
          const ans = rows.filter((x) => x[r.id] !== "" && x[r.id] != null);
          return h("tr", null, h("td", null, r.t), q.scale.map((x) => h("td", { class: "n" }, fmtPct(ans.filter((y) => Number(y[r.id]) === x.v).length, ans.length))), h("td", { class: "n" }, ans.length));
        })))), true);
    }
    if (q.type === "number") {
      const v = rows.map((r) => num(r[id])).filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
      if (!v.length) return card(t, sub, h("p", { class: "empty-c" }, "ยังไม่มีคำตอบ"));
      const mean = v.reduce((a, b) => a + b, 0) / v.length, med = v[Math.floor((v.length - 1) / 2)];
      const f = (x) => x.toLocaleString("th-TH", { maximumFractionDigits: 1 });
      return card(t, sub || `${v.length} คนที่ตอบ${q.unit ? ` · หน่วย ${q.unit}` : ""}`, h("div", { class: "kpis" }, kpi(f(mean), "ค่าเฉลี่ย"), kpi(f(med), "มัธยฐาน"), kpi(`${f(v[0])}–${f(v[v.length - 1])}`, "ต่ำสุด–สูงสุด")));
    }
    return null;  // free text, dates: read them in the Sheet
  }

  function autoSection(R) {
    const sec = S.sections.find((s) => s.id === F.sec) || S.sections[0];
    const cards = sec.q.map((q) => cardQ(R, q.id)).filter(Boolean);
    return h("section", { class: "dsec" },
      h("h2", null, "สรุปรายข้อ (อัตโนมัติ ทุกข้อที่เป็นตัวเลือก/ตัวเลข)"),
      h("div", { class: "filters", style: "position:static" }, h("label", null, "ส่วนของแบบสอบถาม",
        h("select", { onchange: (e) => { F.sec = e.target.value; render(); } }, S.sections.map((s) => h("option", { value: s.id, selected: s.id === sec.id }, s.title))))),
      h("p", { class: "fine" }, "ร้อยละคิดจากผู้ที่ตอบข้อนั้น (ข้อที่ถูกข้ามตามเงื่อนไขไม่นับ) · ข้อที่ผู้ดูแลเพิ่มภายหลังจะขึ้นที่นี่เอง"),
      cards.length ? h("div", { class: "cards" }, cards) : h("p", { class: "empty" }, "ส่วนนี้ไม่มีข้อที่สรุปเป็นกราฟได้"));
  }

  // ------------------------------------------------------------ the report
  function report() {
    const R = filtered();
    const n = R.length;
    if (!n) return h("p", { class: "empty" }, "ยังไม่มีข้อมูลตามตัวกรองนี้");
    const age = R.map((r) => num(r.q1_2_age)).filter((x) => x != null);
    const yes = (id, v) => (r) => String(r[id]) === String(v);
    const hasOpt = (id, v) => (r) => String(r[`${id}_o${v}`]) === "1";
    const answered = (id) => (r) => r[id] !== "" && r[id] != null;
    const disAns = R.filter((r) => r.q3_1_o1 !== "" && r.q3_1_o1 != null);
    const chronic = disAns.filter((r) => String(r.q3_1_o14) !== "1");
    const smokeAns = R.filter(answered("q4_1")), smokers = smokeAns.filter((r) => ["1", "2"].includes(String(r.q4_1)));
    const phqAns = R.filter((r) => r.q8_1_1 !== "" || r.q8_1_2 !== ""), phqPos = phqAns.filter((r) => String(r.q8_1_1) === "1" || String(r.q8_1_2) === "1");
    const bmi = R.map((r) => num(r.bmi)).filter((x) => x != null && x > 10 && x < 70);
    const dm = R.filter(hasOpt("q3_1", 1)), ht = R.filter(hasOpt("q3_1", 2));
    const pain = multi(R, "q7_1", { dropNone: true });
    const painAny = R.filter((r) => r.q7_1_o1 !== "" && String(r.q7_1_o1) !== "1");
    const farmer = R.filter(yes("q2_1", 1)), notFarmer = R.filter((r) => r.q2_1 !== "" && String(r.q2_1) !== "1");
    const painIn = (g) => ({ n: g.filter((r) => r.q7_1_o1 !== "" && String(r.q7_1_o1) !== "1").length, d: g.filter((r) => r.q7_1_o1 !== "").length });
    const bmiCats = [["น้อยกว่า 18.5 (ผอม)", (b) => b < 18.5], ["18.5–22.9 (ปกติ)", (b) => b >= 18.5 && b < 23], ["23–24.9 (ท้วม)", (b) => b >= 23 && b < 25], ["25–29.9 (อ้วนระดับ 1)", (b) => b >= 25 && b < 30], ["30 ขึ้นไป (อ้วนระดับ 2)", (b) => b >= 30]];
    const ivs = {};
    R.forEach((r) => { const k = [r.iv_first, r.iv_last].filter(Boolean).join(" ") || "ไม่ระบุ"; (ivs[k] = ivs[k] || []).push(num(r.complete_pct) || 0); });
    const dates = {};
    R.forEach((r) => (dates[r.iv_date] = (dates[r.iv_date] || 0) + 1));
    const animals = [["cattle", "โค/กระบือ"], ["poultry", "สัตว์ปีก"], ["dog", "สุนัข"], ["cat", "แมว"], ["pig", "สุกร"]];
    const petHh = R.filter(yes("q11_1", 1));
    const animalSum = (key, f) => petHh.reduce((s, r) => s + (num(r[`q11_2_${key}_${f}`]) || 0), 0);
    const util = gridShare(R, "q13_utils", [1]).concat(gridShare(R, "q13_3", [1]).map((x) => ({ ...x, label: x.label }))) ;

    return h("div", null,
      h("div", { class: "kpis" },
        kpi(n.toLocaleString("th-TH"), "ครัวเรือนที่สัมภาษณ์"),
        kpi(age.length ? (age.reduce((a, b) => a + b, 0) / age.length).toFixed(1) : "–", "อายุเฉลี่ยผู้ให้ข้อมูล (ปี)"),
        kpi(fmtPct(age.filter((a) => a >= 60).length, age.length), "อายุ 60 ปีขึ้นไป"),
        kpi(fmtPct(chronic.length, disAns.length), "มีโรคประจำตัว", `${chronic.length}/${disAns.length} คน`),
        kpi(fmtPct(bmi.filter((b) => b >= 25).length, bmi.length), "BMI ≥ 25 (อ้วน)", `${bmi.filter((b) => b >= 25).length}/${bmi.length} คน`),
        kpi(fmtPct(smokers.length, smokeAns.length), "สูบบุหรี่ปัจจุบัน", `${smokers.length}/${smokeAns.length} คน`),
        kpi(fmtPct(phqPos.length, phqAns.length), "คัดกรองซึมเศร้า (PHQ-2) ผลบวก", `${phqPos.length}/${phqAns.length} คน`),
        kpi(fmtPct(painAny.length, pain.d), "ปวดกล้ามเนื้อใน 3 เดือน", `${painAny.length}/${pain.d} คน`)),

      section("ข้อมูลทั่วไป",
        card("อายุและเพศของผู้ให้ข้อมูล", `${age.length} คน`, pyramid(R)),
        card("อาชีพ", null, bars(single(R, "q2_1").items, single(R, "q2_1").d)),
        card("รายได้รวมของครอบครัวต่อเดือน", null, bars(single(R, "q1_8").items, single(R, "q1_8").d, { sort: false })),
        card("ระดับการศึกษา", null, bars(single(R, "q1_7").items.filter((x) => x.n), single(R, "q1_7").d, { sort: false }))),

      section("สุขภาพร่างกาย",
        card("โรคที่แพทย์เคยวินิจฉัย", "ร้อยละของผู้ตอบ · ตอบได้หลายข้อ", bars(multi(R, "q3_1", { dropNone: true }).items, multi(R, "q3_1").d)),
        card("ดัชนีมวลกาย (BMI)", "เกณฑ์คนเอเชีย", bars(bmiCats.map(([label, t]) => ({ label, n: bmi.filter(t).length })), bmi.length, { sort: false })),
        card("การดูแลตัวเองของผู้ป่วยเบาหวานและความดัน", `เบาหวาน ${dm.length} คน · ความดัน ${ht.length} คน`, bars([
          { label: "เบาหวาน: กินยาทุกวัน", n: dm.filter(yes("q3_4_2_1", 1)).length, d: dm.filter(answered("q3_4_2_1")).length },
          { label: "เบาหวาน: ตรวจทุก 1–3 เดือน", n: dm.filter((r) => ["1", "2"].includes(String(r.q3_4_2_3))).length, d: dm.filter(answered("q3_4_2_3")).length },
          { label: "ความดัน: กินยาทุกวัน", n: ht.filter(yes("q3_4_2_4", 1)).length, d: ht.filter(answered("q3_4_2_4")).length },
          { label: "ความดัน: วัดความดันอย่างน้อยเดือนละครั้ง", n: ht.filter((r) => ["1", "2"].includes(String(r.q3_4_2_5))).length, d: ht.filter(answered("q3_4_2_5")).length },
        ], 0, { sort: false })),
        card("อาการผิดปกติในปัจจุบัน", "ตอบได้หลายข้อ", bars(multi(R, "q3_2", { dropNone: true }).items, multi(R, "q3_2").d)),
        card("การมองเห็น การได้ยิน การหกล้ม", null, bars([
          { label: "มองเห็นไม่ค่อยชัด/ไม่ชัด", n: R.filter((r) => ["2", "3"].includes(String(r.q3_5))).length, d: R.filter(answered("q3_5")).length },
          { label: "ได้ยินไม่ค่อยชัด/ไม่ชัด", n: R.filter((r) => ["2", "3"].includes(String(r.q3_6))).length, d: R.filter(answered("q3_6")).length },
          { label: "ตนเอง/ผู้สูงอายุในบ้านหกล้มใน 1 ปี", n: R.filter(yes("q3_7", 1)).length, d: R.filter(answered("q3_7")).length },
        ], 0))),

      section("ปัจจัยเสี่ยงต่อโรคไม่ติดต่อ",
        card("พฤติกรรมเสี่ยง แยกเพศ", "ร้อยละของผู้ตอบในแต่ละเพศ", bySex(R, [
          ["สูบบุหรี่ปัจจุบัน", (r) => ["1", "2"].includes(String(r.q4_1)), answered("q4_1")],
          ["ดื่มเครื่องดื่มแอลกอฮอล์", yes("q4_2", 2), answered("q4_2")],
          ["ไม่ออกกำลังกายเลย", yes("q4_3", 1), answered("q4_3")],
          ["ชอบรสเค็ม", yes("q10_1", 1), answered("q10_1")],
          ["เติมเครื่องปรุงทุกมื้อ", yes("q10_2", 1), answered("q10_2")],
          ["BMI ≥ 25", (r) => num(r.bmi) >= 25, (r) => num(r.bmi) != null],
        ]), true),
        card("พฤติกรรมการกิน: ทำ 4 วันขึ้นไปต่อสัปดาห์", "ร้อยละที่ตอบ ‘เป็นประจำ’ หรือ ‘บางครั้ง (4–6 วัน)’", bars(gridShare(R, "q10_grid", [1, 2]), 0), true)),

      section("บริการสุขภาพและการใช้ยา",
        card("สถานพยาบาลหลักเมื่อเจ็บป่วย", null, bars(single(R, "q5_1").items.filter((x) => x.n), single(R, "q5_1").d)),
        card("อุปสรรคในการไปรักษา", "ตอบได้หลายข้อ", bars(multi(R, "q5_4").items, multi(R, "q5_4").d)),
        card("การอ่านฉลากยาเมื่อซื้อยาเอง", null, bars(single(R, "q9_3").items, single(R, "q9_3").d, { sort: false }))),

      section("สุขภาพช่องปาก",
        card("ปัญหาช่องปากใน 1 ปีที่ผ่านมา", `ไม่มีปัญหาเลย ${fmtPct(R.filter((r) => String(r.q6_4_o7) === "1").length, multi(R, "q6_4").d)} · ตอบได้หลายข้อ`, bars(multi(R, "q6_4", { dropNone: true }).items, multi(R, "q6_4").d)),
        card("จำนวนครั้งที่รับบริการทันตกรรมใน 1 ปี", null, bars(single(R, "q6_7").items, single(R, "q6_7").d, { sort: false })),
        card("การแปรงฟันต่อวัน", null, bars(single(R, "q6_1").items, single(R, "q6_1").d, { sort: false }))),

      section("อาการปวดกล้ามเนื้อ (3 เดือน)",
        card("ตำแหน่งที่ปวด", "ร้อยละของผู้ตอบ · ตอบได้หลายข้อ", bars(pain.items, pain.d)),
        card("ปวดกล้ามเนื้อ: เกษตรกร เทียบอาชีพอื่น", null, bars([{ label: "เกษตรกร (ทำนา ทำไร่)", ...painIn(farmer) }, { label: "อาชีพอื่น/ไม่ได้ทำงาน", ...painIn(notFarmer) }], 0, { sort: false })),
        card("วิธีบรรเทาอาการ", null, bars(multi(R, "q7_1_2").items, multi(R, "q7_1_2").d))),

      section("สุขภาพจิต",
        card("คัดกรองซึมเศร้า 2 คำถาม (PHQ-2)", "ตอบ ‘มี’ อย่างน้อย 1 ข้อ = ควรประเมินต่อด้วย 9Q", bars([
          { label: "หดหู่ เศร้า ท้อแท้สิ้นหวัง", n: R.filter(yes("q8_1_1", 1)).length, d: R.filter(answered("q8_1_1")).length },
          { label: "เบื่อ ทำอะไรก็ไม่เพลิดเพลิน", n: R.filter(yes("q8_1_2", 1)).length, d: R.filter(answered("q8_1_2")).length },
          { label: "มีอย่างน้อย 1 ข้อ", n: phqPos.length, d: phqAns.length },
        ], 0, { sort: false })),
        card("วิธีจัดการความเครียด", "ตอบได้หลายข้อ", bars(multi(R, "q8_3").items, multi(R, "q8_3").d)),
        card("ขอความช่วยเหลือจากใคร", "ตอบได้หลายข้อ", bars(multi(R, "q8_4").items, multi(R, "q8_4").d))),

      section("สัตว์เลี้ยงและโรคจากสัตว์",
        card("ครัวเรือนที่เลี้ยงสัตว์แต่ละชนิด", `เลี้ยงสัตว์ ${petHh.length}/${R.filter(answered("q11_1")).length} ครัวเรือน`, bars(animals.map(([k, l]) => ({ label: l, n: petHh.filter((r) => String(r[`q11_2_${k}_has`]) === "2").length })), petHh.length)),
        card("สุนัขและแมวที่ได้รับวัคซีน", "จำนวนตัวที่ได้รับวัคซีน ÷ จำนวนตัวทั้งหมด", bars([["dog", "สุนัข"], ["cat", "แมว"]].map(([k, l]) => ({ label: l, n: animalSum(k, "vacc"), d: animalSum(k, "n") })), 0, { sort: false }))),

      section("สิ่งแวดล้อม",
        card("วิธีจัดการขยะของครัวเรือน", "ตอบได้หลายข้อ", bars(multi(R, "q12_1_1").items, multi(R, "q12_1_1").d)),
        card("แหล่งมลพิษทางอากาศที่ได้รับ", `เคยได้รับผล ${fmtPct(R.filter(yes("q12_4_1", 1)).length, R.filter(answered("q12_4_1")).length)} ของผู้ตอบ`, bars(multi(R, "q12_4_2").items, multi(R, "q12_4_2").d)),
        card("สารเคมีทางการเกษตร", `ใช้สารเคมี ${fmtPct(R.filter(yes("q12_3_1", 1)).length, R.filter(answered("q12_3_1")).length)} ของผู้ตอบ · ผลข้างเคียงในผู้ใช้`, bars(multi(R, "q12_3_1_2").items, multi(R, "q12_3_1_2").d))),

      section("สาธารณูปโภคและปัญหาชุมชน",
        card("ปัญหาสาธารณูปโภค", "ร้อยละที่ตอบ ‘บ่อยครั้ง’ (ไฟฟ้า ประปา) หรือ ‘มีปัญหา’ (ถนน)", bars(util, 0)),
        card("ปัญหาในชุมชนที่ผู้ตอบรับรู้", "ร้อยละที่ตอบว่า ‘มี’", bars(gridShare(R, "q14_2", [2]), 0)),
        card("ช่องทางรับข่าวสารในหมู่บ้าน", null, bars(multi(R, "q14_1_1").items, multi(R, "q14_1_1").d))),

      section("อาการไข้ (เพิ่มใน v2)",
        cardQ(R, "q15_1"), cardQ(R, "q15_3", { title: "สิ่งที่ทำเป็นอันดับแรกเมื่อมีไข้" }),
        cardQ(R, "q15_4", { title: "วัดอุณหภูมิก่อนตัดสินใจไปโรงพยาบาล" }),
        cardQ(R, "q15_6", { title: "ความเข้าใจ: เมื่อไหร่เรียกว่า “มีไข้”", sub: "คำตอบที่ถูกคือ ตัวร้อน · ตอบได้หลายข้อ" })),

      section("การใช้ยาแก้ปวดและความปลอดภัย (เพิ่มใน v2)",
        cardQ(R, "q16_1", { title: "ยาแก้ปวดที่ใช้ใน 3 เดือน" }),
        Q.q16_4 ? card("พฤติกรรมเสี่ยงในการใช้ยาแก้ปวด", "ร้อยละของผู้ที่ใช้ยาแก้ปวดและตอบข้อนั้น", bars([
          { label: "ไม่อ่านฉลากก่อนใช้", n: R.filter(yes("q16_4", 3)).length, d: R.filter(answered("q16_4")).length },
          { label: "ไม่ทราบ/ไม่แน่ใจขนาดยา", n: R.filter((r) => ["2", "3"].includes(String(r.q16_5))).length, d: R.filter(answered("q16_5")).length },
          { label: "เคยกินเกินขนาด", n: R.filter(yes("q16_6", 1)).length, d: R.filter(answered("q16_6")).length },
          { label: "เคยใช้ 2 ชนิดที่ตัวยาซ้ำกัน", n: R.filter(yes("q16_7", 1)).length, d: R.filter(answered("q16_7")).length },
          { label: "เคยใช้ NSAIDs หลายตัวพร้อมกัน", n: R.filter(yes("q16_8", 1)).length, d: R.filter(answered("q16_8")).length },
          { label: "เคยแบ่งยาให้คนอื่น", n: R.filter(yes("q16_11", 1)).length, d: R.filter(answered("q16_11")).length },
        ], 0)) : null,
        cardQ(R, "q16_3", { title: "ผู้แนะนำให้ใช้ยา" })),

      section("ยาเสพติดและผู้ป่วยจิตเวชในชุมชน (เพิ่มใน v2)",
        cardQ(R, "q17_1", { title: "พบเห็น/รับรู้ปัญหายาเสพติดใน 1 ปี" }),
        cardQ(R, "q17_2", { title: "สารเสพติดที่พบหรือสงสัย" }),
        cardQ(R, "q17_4", { title: "ผลกระทบต่อตนเอง/ครอบครัว" }),
        cardQ(R, "q17_6", { title: "สิ่งที่ทำเมื่อพบผู้มีอาการคลั่ง" }),
        cardQ(R, "q17_7", { title: "อุปสรรคการบำบัด" }),
        cardQ(R, "q17_8", { title: "มาตรการที่ชาวบ้านเห็นว่าดีที่สุด" })),

      section("แหล่งน้ำและโรงงานใกล้บ้าน (เพิ่มใน v2)",
        cardQ(R, "q18_1", { title: "แหล่งน้ำที่ครัวเรือนใช้" }),
        cardQ(R, "q18_3", { title: "สิ่งผิดปกติที่เคยพบในแหล่งน้ำ" }),
        cardQ(R, "q18_5", { title: "มีโรงงานในระยะ 1 กม." }),
        cardQ(R, "q18_4", { title: "เคยกินปลาจากแหล่งน้ำชุมชนใน 12 เดือน" })),

      section("ผู้ป่วยเบาหวาน/ความดัน และอาชีพ (เพิ่มใน v2)",
        cardQ(R, "q3_8_1", { title: "เบาหวาน: ความถี่ในการตรวจน้ำตาล" }),
        cardQ(R, "q3_8_4", { title: "เบาหวาน: จัดการแผลเล็กที่เท้าอย่างไร" }),
        cardQ(R, "q3_9_1", { title: "ความดัน: ภาวะแทรกซ้อนที่เคยมี" }),
        cardQ(R, "q2_2_8", { title: "เกษตรกร: อุปกรณ์ป้องกันที่ใช้" }),
        cardQ(R, "q2_3_12", { title: "พนักงานโรงงาน: อาการหลังทำงาน" })),

      autoSection(R),

      section("คุณภาพการเก็บข้อมูล",
        card("รายผู้สัมภาษณ์", null, h("table", { class: "tbl" }, h("thead", null, h("tr", null, h("th", null, "ผู้สัมภาษณ์"), h("th", { class: "n" }, "ครัวเรือน"), h("th", { class: "n" }, "ตอบครบเฉลี่ย"))),
          h("tbody", null, Object.entries(ivs).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => h("tr", null, h("td", null, k), h("td", { class: "n" }, v.length), h("td", { class: "n" }, `${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(0)}%`)))))),
        card("รายวันที่สัมภาษณ์", null, h("table", { class: "tbl" }, h("thead", null, h("tr", null, h("th", null, "วันที่"), h("th", { class: "n" }, "ครัวเรือน"))),
          h("tbody", null, Object.entries(dates).sort().map(([k, v]) => h("tr", null, h("td", null, k), h("td", { class: "n" }, v))))))));
  }

  // ------------------------------------------------------------ page
  function render() {
    const moos = [...new Set(ALL.map((r) => String(r.h_moo)).filter(Boolean))].sort((a, b) => a - b);
    const mockN = ALL.filter(isMock).length;
    const sel = (key, opts, label) => h("label", null, label, h("select", { onchange: (e) => { F[key] = e.target.value; render(); } }, opts.map(([v, l]) => h("option", { value: v, selected: F[key] === v }, l))));
    mount(app,
      h("header", { class: "top" },
        h("a", { class: "brand", href: "index.html" }, h("span", { class: "mark" }, "44"), h("span", null, h("b", null, "สรุปผลแบบสัมภาษณ์ชุมชน"), h("small", null, "อัปเดตทุกครั้งที่เปิดหน้า"))),
        h("div", { class: "top-r" }, h("button", { class: "btn ghost", type: "button", onclick: start }, "โหลดใหม่"), h("a", { class: "btn ghost", href: "index.html" }, "แบบฟอร์ม"))),
      h("main", { class: "dwrap" },
        h("div", { class: "filters" },
          sel("moo", [["", "ทุกหมู่"], ...moos.map((m) => [m, `หมู่ ${m}`])], "หมู่ที่"),
          sel("sex", [["", "ทั้งหมด"], ["1", "ชาย"], ["2", "หญิง"]], "เพศ"),
          sel("age", [["", "ทุกอายุ"], ["lt60", "ต่ำกว่า 60 ปี"], ["ge60", "60 ปีขึ้นไป"]], "อายุ"),
          mockN ? h("label", { class: "chk" }, h("input", { type: "checkbox", checked: F.mock, onchange: (e) => { F.mock = e.target.checked; render(); } }), `รวมข้อมูลจำลอง (${mockN})`) : null,
          h("span", { class: "meta" }, `${source} · โหลดเมื่อ ${new Date().toLocaleTimeString("th-TH")}`)),
        mockN && F.mock ? h("div", { class: "mockbar" }, `มีข้อมูลจำลอง (MOCK) ${mockN} ครัวเรือน — ตัวเลขยังไม่ใช่ผลจริง ลบแถวที่ record_id ขึ้นต้นด้วย MOCK ใน Sheet ก่อนเก็บข้อมูลจริง`) : null,
        report()));
  }

  function setup(msg) {
    const url = h("input", { type: "url", value: settings.api, placeholder: "https://script.google.com/macros/s/…/exec" });
    const team = h("input", { type: "text", value: settings.team, placeholder: "รหัสทีม" });
    const file = h("input", { type: "file", accept: ".csv,text/csv", onchange: async (e) => { const f = e.target.files[0]; if (!f) return; ALL = parseCsv(await f.text()); source = `ไฟล์ ${f.name}`; render(); } });
    mount(app, h("main", { class: "wrap setup" },
      h("h1", null, "สรุปผลแบบสัมภาษณ์ชุมชน"),
      msg ? h("div", { class: "notice bad" }, msg) : null,
      h("label", { class: "field" }, "URL ของ Google Apps Script", url),
      h("label", { class: "field" }, "รหัสทีม", team),
      h("button", { class: "btn primary", type: "button", onclick: () => { settings = { api: url.value.trim(), team: team.value.trim() }; localStorage.setItem("m69.settings", JSON.stringify(settings)); start(); } }, "โหลดข้อมูลจาก Google Sheets"),
      h("p", { class: "fine" }, "หรือเปิดไฟล์ CSV ที่ดาวน์โหลดจาก Google Sheets (ไฟล์ → ดาวน์โหลด → .csv) / ไฟล์สำรองจากแบบฟอร์ม"), file));
  }

  async function start() {
    if (!settings.api || !settings.team) return setup();
    mount(app, h("main", { class: "wrap" }, h("p", null, "กำลังโหลดข้อมูล…")));
    try {
      const [rows, pub] = await Promise.all([fetchRows(), M69.fetchPublished(settings.api, settings.team).catch(() => null)]);
      if (pub && pub.form && !M69.validateForm(pub.form).length) { S = pub.form; indexForm(); }
      ALL = rows; source = `Google Sheets ${ALL.length} แถว · แบบสอบถาม ${S.version}`; render();
    }
    catch (e) { setup(`โหลดไม่สำเร็จ: ${e.message || e}`); }
  }
  start();
})();
