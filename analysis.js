// Analysis-ready exports, shared by the dashboard:
//  - one set of derived-variable definitions (the dashboard's KPIs use the same ones)
//  - a dataset where a blank cell is split into "skipped by the form's logic" (-1) and "should have been asked, not answered" (-9)
//  - a de-identified version for sharing, a codebook, and SPSS / Stata / R syntax that label everything
(() => {
  "use strict";
  const MISS = { skip: -1, na: -9 };
  const MISS_LABEL = [[MISS.skip, "ข้ามตามเงื่อนไขของแบบสอบถาม"], [MISS.na, "ไม่ได้ตอบ"]];
  const blank = (v) => v == null || v === "";
  const num = (v) => { if (blank(v)) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const findQ = (form, id) => M69.questions(form).find((q) => q.id === id);
  const noneCode = (form, id) => { const q = findQ(form, id); const o = q && q.o && q.o.find((x) => x.exclusive); return o ? o.v : null; };
  const exclusiveCodes = (form, id) => { const q = findQ(form, id); return q && q.o ? q.o.filter((x) => x.exclusive).map((x) => x.v) : []; };
  const NEVER_DIAGNOSED = 15;   // option of 3.1 "ไม่เคยได้รับการวินิจฉัย"
  // multi question: null if not answered, else the ticked codes
  const ticked = (row, form, id) => {
    const q = findQ(form, id);
    if (!q || !q.o || !q.o.some((x) => !blank(row[`${id}_o${x.v}`]))) return null;
    return q.o.filter((x) => String(row[`${id}_o${x.v}`]) === "1").map((x) => x.v);
  };
  const yn = (b) => (b ? 1 : 0);

  // ---------------------------------------------------------------- derived variables (one definition for dashboard + exports)
  const AGE_BANDS = [[30, "ต่ำกว่า 30"], [40, "30–39"], [50, "40–49"], [60, "50–59"], [70, "60–69"], [80, "70–79"], [Infinity, "80 ขึ้นไป"]];
  const BMI_CATS = [[18.5, "น้อยกว่า 18.5 (ผอม)"], [23, "18.5–22.9 (ปกติ)"], [25, "23–24.9 (ท้วม)"], [30, "25–29.9 (อ้วนระดับ 1)"], [Infinity, "30 ขึ้นไป (อ้วนระดับ 2)"]];
  const YES_NO = [[1, "ใช่"], [0, "ไม่ใช่"]];
  const validBmi = (row) => { const b = num(row.bmi); return b != null && b > 10 && b < 70 ? b : null; };
  const DERIVED = [
    { key: "age_grp", label: "กลุ่มอายุ (ปี)", codes: AGE_BANDS.map(([, l], i) => [i + 1, l]), def: "จาก q1_2_age",
      fn: (r) => { const a = num(r.q1_2_age); return a == null ? "" : AGE_BANDS.findIndex(([hi]) => a < hi) + 1; } },
    { key: "age_60plus", label: "อายุ 60 ปีขึ้นไป", codes: YES_NO, def: "q1_2_age >= 60",
      fn: (r) => { const a = num(r.q1_2_age); return a == null ? "" : yn(a >= 60); } },
    { key: "bmi_cat", label: "ระดับดัชนีมวลกาย (เกณฑ์คนเอเชีย)", codes: BMI_CATS.map(([, l], i) => [i + 1, l]), def: "จาก bmi (ใช้เฉพาะค่า 10–70)",
      fn: (r) => { const b = validBmi(r); return b == null ? "" : BMI_CATS.findIndex(([hi]) => b < hi) + 1; } },
    { key: "obese", label: "BMI ≥ 25 (อ้วน)", codes: YES_NO, def: "bmi >= 25 (ใช้เฉพาะค่า 10–70)",
      fn: (r) => { const b = validBmi(r); return b == null ? "" : yn(b >= 25); } },
    { key: "ncd_any", label: "มีโรคประจำตัวอย่างน้อย 1 โรค", codes: YES_NO, def: "ข้อ 3.1 เลือกโรคอย่างน้อย 1 โรค = ใช่ · เลือก “ได้รับการวินิจฉัยแล้ว แต่ไม่มีโรคประจำตัว” = ไม่ใช่ · “ไม่เคยได้รับการวินิจฉัย” = ว่าง (ไม่นับในฐาน ดู never_dx)",
      fn: (r, f) => { const t = ticked(r, f, "q3_1"); if (t == null || t.includes(NEVER_DIAGNOSED)) return ""; return yn(!t.some((v) => exclusiveCodes(f, "q3_1").includes(v))); } },
    { key: "never_dx", label: "ไม่เคยได้รับการวินิจฉัยโรค", codes: YES_NO, def: "ข้อ 3.1 เลือก “ไม่เคยได้รับการวินิจฉัย” (รายงานแยกจากร้อยละของผู้มีโรคประจำตัว)",
      fn: (r, f) => { const t = ticked(r, f, "q3_1"); return t == null ? "" : yn(t.includes(NEVER_DIAGNOSED)); } },
    { key: "ncd_n", label: "จำนวนโรคประจำตัวที่เลือก", codes: null, def: "จำนวนตัวเลือกในข้อ 3.1 ที่เลือก ไม่นับ “ได้รับการวินิจฉัยแล้ว แต่ไม่มีโรคประจำตัว” และ “ไม่เคยได้รับการวินิจฉัย”",
      fn: (r, f) => { const t = ticked(r, f, "q3_1"); return t == null ? "" : t.filter((v) => !exclusiveCodes(f, "q3_1").includes(v)).length; } },
    { key: "smoke_cur", label: "สูบบุหรี่ปัจจุบัน", codes: YES_NO, def: "ข้อ 4.1 = สูบทุกวัน (1) หรือ สูบบางวัน (2)",
      fn: (r) => (blank(r.q4_1) ? "" : yn([1, 2].includes(num(r.q4_1)))) },
    { key: "alcohol_cur", label: "ดื่มเครื่องดื่มแอลกอฮอล์ใน 12 เดือนที่ผ่านมา", codes: YES_NO, def: "ข้อ 4.2 = ดื่ม (2) คือดื่มอย่างน้อย 1 ครั้งใน 12 เดือนที่ผ่านมา",
      fn: (r) => (blank(r.q4_2) ? "" : yn(num(r.q4_2) === 2)) },
    { key: "no_exercise", label: "ไม่ออกกำลังกายเลย", codes: YES_NO, def: "ข้อ 4.3 = ไม่ออกกำลังกายเลย (1)",
      fn: (r) => (blank(r.q4_3) ? "" : yn(num(r.q4_3) === 1)) },
    { key: "msk_pain", label: "ปวดกล้ามเนื้อในช่วง 3 เดือน", codes: YES_NO, def: "ข้อ 7.1 ตอบแล้ว และไม่ได้เลือก “ไม่มี”",
      fn: (r, f) => { const t = ticked(r, f, "q7_1"); return t == null ? "" : yn(!t.includes(noneCode(f, "q7_1"))); } },
    { key: "farmer", label: "อาชีพเกษตรกรรม", codes: YES_NO, def: "ข้อ 2.1 อาชีพหลัก (อันดับ 1) = เกษตรกรรม (1)",
      fn: (r) => (blank(r.q2_1) ? "" : yn(num(r.q2_1) === 1)) },
  ];
  function derive(row, form) {
    const out = {};
    for (const d of DERIVED) { try { out[d.key] = d.fn(row, form); } catch { out[d.key] = ""; } }
    return out;
  }

  // ---------------------------------------------------------------- column dictionary
  // kind: "num" | "str" · miss(ctx): which missing code a blank numeric cell gets
  const META_NUM = new Set(["complete_pct", "duration_min"]);
  const AREA_KEEP = new Set(["form_version", "created_at", "updated_at", "submitted_at", "complete_pct", "started_at", "finished_at", "duration_min", "h_tambon", "h_amphoe", "h_province", "iv_faculty", "iv_zone", "iv_date"]);
  function dictionary(form) {
    const labels = new Map(M69.columnSpec(form).map((c) => [c.key, c]));
    const cols = [];
    const add = (key, kind, extra = {}) => { const c = labels.get(key) || {}; cols.push({ key, kind, label: c.label || key, q: c.q || "", source: "question", ...extra }); };
    const byVis = (q) => (ctx) => (ctx.vis(q) ? MISS.na : MISS.skip);
    ["uuid", "record_id", "form_version", "app_build", "created_at", "updated_at", "submitted_at", "complete_pct", "started_at", "finished_at", "duration_min"]
      .forEach((k) => add(k, META_NUM.has(k) ? "num" : "str", { source: "meta" }));
    for (const q of M69.questions(form)) {
      const lab = (o) => o.map((x) => [x.v, x.label]);
      switch (q.type) {
        case "single":
          add(q.id, "num", { codes: lab(q.o), miss: byVis(q) });
          q.o.filter((x) => x.other).forEach((x) => add(`${q.id}_o${x.v}_text`, "str"));
          break;
        case "rank":   // rank 1 in the plain column, then _r2 / _r3
          add(q.id, "num", { codes: lab(q.o), miss: byVis(q) });
          for (let k = 2; k <= (q.max || 3); k++) add(`${q.id}_r${k}`, "num", { codes: lab(q.o), miss: (ctx) => (!ctx.vis(q) || !blank(ctx.row[q.id]) ? MISS.skip : MISS.na) });   // rank 1 given but no rank k = fewer picks, not a missing answer
          q.o.filter((x) => x.other).forEach((x) => add(`${q.id}_o${x.v}_text`, "str"));
          break;
        case "multi":
          q.o.forEach((x) => {
            add(`${q.id}_o${x.v}`, "num", { codes: [[1, "เลือก"], [0, "ไม่เลือก"]], miss: byVis(q) });
            if (x.other) add(`${q.id}_o${x.v}_text`, "str");
          });
          break;
        case "grid": q.rows.forEach((r) => add(r.id, "num", { codes: lab(q.scale), miss: byVis(q) })); break;
        case "number": case "computed": add(q.id, "num", { miss: byVis(q) }); break;
        case "dob": ["q1_2_day", "q1_2_month", "q1_2_year_be", "q1_2_age"].forEach((k) => add(k, "num", { miss: byVis(q) })); add("q1_2_est", "num", { codes: [[1, "ประมาณ"], [0, "ไม่ใช่"]], miss: byVis(q) }); break;
        case "animals":
          q.animals.forEach((x) => {
            const has = `${q.id}_${x.key}_has`;
            add(has, "num", { codes: [[1, "ไม่มี"], [2, "มี"]], miss: byVis(q) });
            if (x.other) add(`${q.id}_${x.key}_name`, "str");
            ["n", "vacc", "deworm"].forEach((k) => {
              // "ไม่ทราบ": the count stays blank (-9 in the export) and the _unk column says it was "don't know", not "not asked"
              add(`${q.id}_${x.key}_${k}`, "num", {
                miss: (ctx) => (!ctx.vis(q) || num(ctx.row[has]) === 1 || (k !== "n" && num(ctx.row[`${q.id}_${x.key}_n_unk`]) === 1) ? MISS.skip : MISS.na),
              });
              add(`${q.id}_${x.key}_${k}_unk`, "num", {
                codes: [[1, "ไม่ทราบ"], [0, "ทราบ"]],
                miss: (ctx) => (!ctx.vis(q) || num(ctx.row[has]) === 1 || (k !== "n" && num(ctx.row[`${q.id}_${x.key}_n_unk`]) === 1) ? MISS.skip : MISS.na),
              });
            });
          });
          break;
        default: add(q.id, "str");   // text, textarea, date
      }
    }
    return cols;
  }

  // rebuild the answers the form's skip rules look at, from one flat row
  function answersOf(row, form) {
    const a = {};
    for (const q of M69.questions(form)) {
      if (q.type === "multi") { const t = ticked(row, form, q.id); if (t) a[q.id] = t; }
      else if (q.type === "grid") q.rows.forEach((r) => { if (!blank(row[r.id])) a[r.id] = num(row[r.id]); });
      else if (q.type === "dob") { if (!blank(row.q1_2_age)) a.q1_2_age = num(row.q1_2_age); }
      else if (q.type === "single" || q.type === "rank" || q.type === "number") { if (!blank(row[q.id])) a[q.id] = num(row[q.id]); }
      else if (!blank(row[q.id])) a[q.id] = row[q.id];
    }
    return a;
  }

  // ---------------------------------------------------------------- datasets
  async function digest(text) {
    if (crypto.subtle) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    let x = 2166136261;   // FNV-1a fallback (no WebCrypto on plain http)
    for (let i = 0; i < text.length; i++) { x ^= text.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; }
    return x.toString(16).padStart(8, "0").repeat(2);
  }

  // rows: objects keyed by column (strings from the Sheet or a CSV) → { cols, rows } ready for analysis
  // deid: drop direct identifiers and all free text, replace record ids with pseudonyms keyed by `salt` (the team code)
  async function build(rawRows, form, { deid = false, salt = "" } = {}) {
    const dict = dictionary(form);
    const known = new Set(dict.map((c) => c.key));
    // columns in the Sheet that this form version does not have (older versions): keep them, numeric if every value is
    const extra = [...new Set(rawRows.flatMap(Object.keys))].filter((k) => !known.has(k) && !DERIVED.some((d) => d.key === k));
    extra.forEach((k) => dict.push({ key: k, kind: rawRows.every((r) => blank(r[k]) || num(r[k]) != null) ? "num" : "str", label: `${k} (ไม่มีในแบบสอบถามฉบับปัจจุบัน)`, q: "", source: "other" }));
    DERIVED.forEach((d) => dict.push({ key: d.key, kind: "num", label: d.label, q: "", codes: d.codes, def: d.def, source: "derived", miss: () => MISS.na }));

    let cols = dict;
    if (deid) cols = [
      { key: "pid", kind: "str", label: "รหัสผู้ตอบแบบนิรนาม (แทน uuid/record_id)", q: "", source: "deid" },
      { key: "iv_id", kind: "str", label: "รหัสผู้สัมภาษณ์แบบนิรนาม (แทนชื่อ-นามสกุล)", q: "", source: "deid" },
      ...dict.filter((c) => c.kind === "num" ? !["q1_2_day", "q1_2_month", "q1_2_year_be"].includes(c.key) : AREA_KEEP.has(c.key)),
    ];

    const rows = [];
    for (const raw of rawRows) {
      const a = answersOf(raw, form);
      const vis = (q) => M69.evalRule(q.show, a);
      const ctx = { row: raw, vis };
      const der = derive(raw, form);
      const out = {};
      for (const c of cols) {
        let v = c.source === "derived" ? der[c.key] : raw[c.key];
        if (c.kind === "num") {
          if (blank(v)) v = c.miss ? c.miss(ctx) : "";
          else { const n = num(v); v = n == null ? v : n; }
        } else if (v == null) v = "";
        out[c.key] = v;
      }
      if (deid) {
        out.pid = "P" + (await digest(`${salt}|${raw.uuid || raw.record_id || JSON.stringify(raw)}`)).slice(0, 10);
        const iv = String(raw.iv_sid || "").trim() || [raw.iv_first, raw.iv_last].filter(Boolean).join(" ").trim();   // the student id when there is one: spelling no longer splits a person in two
        out.iv_id = iv ? "IV" + (await digest(`${salt}|iv|${iv}`)).slice(0, 6) : "";
      }
      rows.push(out);
    }
    return { cols, rows };
  }

  // ---------------------------------------------------------------- files
  const csvCell = (v) => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const toCsv = ({ cols, rows }) => [cols.map((c) => c.key).join(",")].concat(rows.map((r) => cols.map((c) => csvCell(r[c.key])).join(","))).join("\r\n") + "\r\n";
  const valueText = (c) => (c.codes || []).map(([v, l]) => `${v}=${l}`).join("; ");

  function codebookCsv({ cols }, { deid }) {
    const head = ["variable", "question_no", "label", "type", "value_labels", "missing_codes", "source", "definition"];
    const src = { meta: "ระบบ", question: "คำถาม", derived: "ตัวแปรคำนวณ", deid: "รหัสนิรนาม", other: "ฉบับเก่า" };
    const lines = [head.join(",")].concat(cols.map((c) => [
      c.key, c.q, c.label, c.kind === "num" ? "numeric" : "string", valueText(c),
      c.kind === "num" && c.miss ? MISS_LABEL.map(([v, l]) => `${v}=${l}`).join("; ") : "",
      src[c.source] || c.source, c.def || "",
    ].map(csvCell).join(",")));
    lines.push("", csvCell(`หมายเหตุ: ${deid ? "ชุดข้อมูลไม่ระบุตัวตน — ตัดบ้านเลขที่ ชื่อหมู่บ้าน วันเดือนปีเกิด ชื่อผู้สัมภาษณ์ และข้อความอิสระทั้งหมดออก" : "ชุดข้อมูลเต็ม มีข้อมูลระบุตัวตน ห้ามเผยแพร่"} · ช่องข้อความว่าง = ไม่ได้ตอบหรือถูกข้าม`));
    return lines.join("\r\n");
  }

  const spssStr = (s) => `"${String(s).replace(/"/g, '""')}"`;
  function spss({ cols }, csvName) {
    const width = (c) => (c.key === "uuid" ? 40 : ["pid", "iv_id"].includes(c.key) ? 16 : ["iv_date", "form_version"].includes(c.key) ? 32 : 500);
    const fmt = (c) => (c.kind === "num" ? (c.codes ? "F8.0" : "F12.2") : `A${width(c)}`);
    const nums = cols.filter((c) => c.kind === "num" && c.miss);
    const L = [];
    L.push("* Encoding: UTF-8.", "* แบบสัมภาษณ์ชุมชน ฝึกภาคสนามร่วม ครั้งที่ 44 — เปิดไฟล์นี้ใน SPSS แล้วแก้ path ของไฟล์ CSV ด้านล่างให้ตรงกับเครื่อง.",
      "* รหัสสูญหาย: -1 = ข้ามตามเงื่อนไข, -9 = ไม่ได้ตอบ (ตั้งเป็น user-missing ให้แล้ว).", "SET UNICODE=ON.",
      `GET DATA /TYPE=TXT /FILE=${spssStr(csvName)} /ENCODING='UTF8' /DELCASE=LINE /DELIMITERS="," /QUALIFIER='"' /ARRANGEMENT=DELIMITED /FIRSTCASE=2`,
      "  /VARIABLES=");
    cols.forEach((c) => L.push(`  ${c.key} ${fmt(c)}`));
    L.push(".", "", "VARIABLE LABELS");
    cols.forEach((c, i) => L.push(`  ${c.key} ${spssStr(c.label)}${i === cols.length - 1 ? "." : " /"}`));
    const coded = cols.filter((c) => c.kind === "num" && (c.codes || c.miss));
    if (coded.length) {
      L.push("", "VALUE LABELS");
      coded.forEach((c, i) => {
        const pairs = (c.codes || []).concat(c.miss ? MISS_LABEL : []);
        L.push(`  ${c.key} ${pairs.map(([v, l]) => `${v} ${spssStr(l)}`).join(" ")}${i === coded.length - 1 ? "." : " /"}`);
      });
    }
    if (nums.length) L.push("", `MISSING VALUES ${nums.map((c) => c.key).join(" ")} (${MISS.skip}, ${MISS.na}).`);
    L.push("", "EXECUTE.", "");
    return L.join("\r\n");
  }

  const stataStr = (s) => `\`"${String(s).replace(/"'/g, "”'")}"'`;
  function stata({ cols }, csvName) {
    const L = [];
    L.push("* แบบสัมภาษณ์ชุมชน ฝึกภาคสนามร่วม ครั้งที่ 44 — ใช้กับ Stata 14 ขึ้นไป (รองรับ UTF-8)",
      "* แก้ path ของไฟล์ CSV ให้ตรงกับเครื่อง แล้วรัน do-file นี้",
      "* รหัสสูญหาย: -1 = ข้ามตามเงื่อนไข → .a , -9 = ไม่ได้ตอบ → .b",
      "clear", `import delimited using "${csvName}", encoding("utf-8") varnames(1) case(preserve) bindquote(strict) clear`, "");
    cols.forEach((c) => L.push(`capture label variable ${c.key} ${stataStr(c.label.slice(0, 80))}`));
    L.push("");
    const nums = cols.filter((c) => c.kind === "num" && c.miss).map((c) => c.key);
    for (let i = 0; i < nums.length; i += 40) L.push(`capture mvdecode ${nums.slice(i, i + 40).join(" ")}, mv(${MISS.skip}=.a \\ ${MISS.na}=.b)`);
    L.push("");
    let n = 0;
    cols.filter((c) => c.kind === "num" && (c.codes || c.miss)).forEach((c) => {
      n += 1;
      const name = `L${n}`;
      const pairs = (c.codes || []).map(([v, l]) => `${v} ${stataStr(l)}`).concat(c.miss ? [`.a ${stataStr(MISS_LABEL[0][1])}`, `.b ${stataStr(MISS_LABEL[1][1])}`] : []);
      L.push(`label define ${name} ${pairs.join(" ")}, replace`, `capture label values ${c.key} ${name}`);
    });
    L.push("", "compress", "");
    return L.join("\r\n");
  }

  const rStr = (s) => JSON.stringify(String(s));
  function rScript({ cols }, csvName) {
    const nums = cols.filter((c) => c.kind === "num" && c.miss).map((c) => rStr(c.key));
    const coded = cols.filter((c) => c.kind === "num" && c.codes);
    const L = [];
    L.push("# แบบสัมภาษณ์ชุมชน ฝึกภาคสนามร่วม ครั้งที่ 44 — ใช้กับ R 4.0 ขึ้นไป",
      "# แก้ path ของไฟล์ CSV ให้ตรงกับเครื่อง แล้ว source() ไฟล์นี้",
      "# รหัสสูญหาย -1 (ข้ามตามเงื่อนไข) และ -9 (ไม่ได้ตอบ) ถูกแปลงเป็น NA · เหตุผลเดิมดูได้ที่ miss_reason[['ชื่อตัวแปร']]",
      `d <- read.csv(${rStr(csvName)}, fileEncoding = "UTF-8-BOM", stringsAsFactors = FALSE, check.names = FALSE, na.strings = "")`, "",
      `num_vars <- c(${nums.join(", ")})`,
      "num_vars <- intersect(num_vars, names(d))",
      "miss_reason <- lapply(d[num_vars], function(x) ifelse(x == -1, \"skip\", ifelse(x == -9, \"not_answered\", NA)))",
      "for (v in num_vars) d[[v]][d[[v]] %in% c(-1, -9)] <- NA", "",
      "var_labels <- c(");
    cols.forEach((c, i) => L.push(`  ${rStr(c.key)} = ${rStr(c.label)}${i === cols.length - 1 ? "" : ","}`));
    L.push(")", "for (v in intersect(names(var_labels), names(d))) attr(d[[v]], \"label\") <- var_labels[[v]]", "", "value_labels <- list(");
    coded.forEach((c, i) => L.push(`  ${rStr(c.key)} = setNames(c(${c.codes.map(([v]) => v).join(", ")}), c(${c.codes.map(([, l]) => rStr(l)).join(", ")}))${i === coded.length - 1 ? "" : ","}`));
    L.push(")",
      "# แปลงตัวแปรรหัสเป็น factor ที่มีชื่อคำตอบภาษาไทย เช่น  table(as_label(\"q1_1\"))",
      "as_label <- function(v) factor(d[[v]], levels = unname(value_labels[[v]]), labels = names(value_labels[[v]]))",
      "for (v in intersect(names(value_labels), names(d))) attr(d[[v]], \"labels\") <- value_labels[[v]]", "");
    return L.join("\r\n");
  }

  window.M69A = { MISS, MISS_LABEL, DERIVED, AGE_BANDS, BMI_CATS, derive, dictionary, build, toCsv, codebookCsv, spss, stata, rScript };
})();
