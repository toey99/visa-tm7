// TM30 Bot — แผงควบคุม + ขั้นตอนอัปโหลด Excel และดาวน์โหลด PDF ทีละคน
(() => {
  if (window.__tm30botUI) return;
  window.__tm30botUI = true;

  const DEFAULTS = { pattern: '{LAST} {FIRST} tm30', subfolder: 'TM30/{DATE}', autoNext: true, listen: false, base: 'https://tm7.toyka.net' };
  const cfg = Object.assign({}, DEFAULTS);
  let dirHandle = null;
  let running = false;
  let stopFlag = false;
  let ui = null;

  // ---------- ตัวช่วยทั่วไป ----------
  const q = (s, r) => (r || document).querySelector(s);
  const qa = (s, r) => Array.from((r || document).querySelectorAll(s));
  const visible = (el) => !!el && el.getClientRects().length > 0;
  const onRoute = (part) => location.hash.indexOf(part) !== -1;
  const overlay = () => q('.cdk-overlay-container');
  const busy = () => !!q('.ngx-spinner-overlay');

  function check() {
    if (stopFlag) throw new Error('__stopped__');
  }
  async function sleep(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      check();
      await new Promise((r) => setTimeout(r, Math.min(150, end - Date.now())));
    }
    check();
  }
  // หน่วงแบบคนกด ไม่ยิงถี่
  const human = () => sleep(600 + Math.random() * 600);

  async function waitFor(fn, timeout, label) {
    const end = Date.now() + timeout;
    for (;;) {
      check();
      let v = null;
      try { v = fn(); } catch (e) {}
      if (v) return v;
      if (Date.now() > end) {
        const dlg = overlay() && overlay().textContent.trim().replace(/\s+/g, ' ').slice(0, 200);
        throw new Error('รอ "' + label + '" ไม่เจอ' + (dlg ? ' — หน้าเว็บแจ้งว่า: ' + dlg : ''));
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  async function idle() {
    await sleep(300);
    await waitFor(() => !busy(), 60000, 'หน้าเว็บโหลดเสร็จ');
  }
  function btn(re, root) {
    return qa('button, a', root || document).find((b) => visible(b) && re.test(b.textContent));
  }
  async function click(el) {
    check();
    el.scrollIntoView({ block: 'center' });
    await sleep(150);
    el.click();
  }

  // ---------- คุยกับ hook.js ----------
  let pdfWaiter = null;
  const notes = [];
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__tm30bot !== 'main') return;
    if (e.data.type === 'pdf' && pdfWaiter) {
      const w = pdfWaiter;
      pdfWaiter = null;
      w(e.data.blob);
    } else if (e.data.type === 'note') {
      notes.push(e.data.msg);
      if (notes.length > 8) notes.shift();
    }
  });
  const arm = (on) => window.postMessage({ __tm30bot: 'ui', type: 'arm', on }, location.origin);
  function nextPdf(timeout) {
    return new Promise((resolve, reject) => {
      notes.length = 0;
      const t = setTimeout(() => {
        pdfWaiter = null;
        reject(new Error('กด Export แล้วแต่จับไฟล์ PDF ไม่ได้ — ถ่ายรูปกล่องข้อความนี้ส่งให้ Claude ดู [' + (notes.join(' ; ') || 'เว็บไม่ได้เปิดหน้าต่างหรือส่งไฟล์') + ']'));
      }, timeout);
      pdfWaiter = (b) => { clearTimeout(t); resolve(b); };
    });
  }

  // ---------- บันทึกไฟล์ ----------
  const today = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  };
  const clean = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();

  function fileName(info) {
    let s = cfg.pattern || DEFAULTS.pattern;
    const hasName = info.first || info.last;
    s = s.replace(/\{LAST\}/gi, hasName ? info.last : info.full)
      .replace(/\{FIRST\}/gi, hasName ? info.first : '')
      .replace(/\{MIDDLE\}/gi, info.middle || '')
      .replace(/\{FULL\}/gi, info.full || [info.first, info.last].filter(Boolean).join(' '))
      .replace(/\{PASSPORT\}/gi, info.passport || '')
      .replace(/\{DATE\}/gi, today());
    s = clean(s) || clean(info.passport) || 'tm30';
    return s + '.pdf';
  }
  const blobToDataUrl = (blob) =>
    new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(blob);
    });

  async function savePdf(blob, name) {
    if (dirHandle) {
      const fh = await dirHandle.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
      return dirHandle.name + '/' + name;
    }
    const sub = (cfg.subfolder || '').replace(/\{DATE\}/gi, today())
      .split(/[\\/]+/).map(clean).filter(Boolean).join('/');
    const path = (sub ? sub + '/' : '') + name;
    const dataUrl = await blobToDataUrl(blob);
    const r = await chrome.runtime.sendMessage({ type: 'tm30-download', dataUrl, filename: path });
    if (!r || !r.ok) throw new Error('บันทึกไฟล์ไม่ได้: ' + ((r && r.error) || 'ไม่ทราบสาเหตุ'));
    return 'Downloads/' + path;
  }

  // ---------- ขั้นตอน: อัปโหลด Excel ----------
  const PASSPORT_RE = /^(?=.*\d)[A-Z0-9]{5,15}$/;

  async function gotoImport() {
    if (onRoute('/ifa/import')) return;
    const b = onRoute('/ifa/search') && btn(/import\s*Excel/i, q('#main-content'));
    if (b) await click(b);
    else location.hash = '#/external/ifa/import';
    await waitFor(() => onRoute('/ifa/import'), 15000, 'หน้านำเข้า Excel');
  }

  let lastImportMsg = '';
  async function runUpload(file, ask) {
    log('เริ่มอัปโหลด: ' + file.name);
    await gotoImport();
    await waitFor(() => q('app-sit-upload-v2 input[type=file]'), 20000, 'ช่องเลือกไฟล์');
    await idle();

    // 1) ที่อยู่
    const radios = () => qa('mat-radio-button[sit-element="address-radio"] input[type=radio]');
    await waitFor(() => radios().length, 20000, 'รายการที่อยู่');
    if (!radios().some((r) => r.checked)) {
      if (radios().length === 1) {
        await click(radios()[0]);
      } else {
        log('มีหลายที่อยู่ — เลือกที่อยู่ในหน้าเว็บก่อน บอทรออยู่', 'warn');
        await waitFor(() => radios().some((r) => r.checked), 180000, 'การเลือกที่อยู่');
      }
    }
    await human();

    // 2) ใส่ไฟล์
    const inp = q('app-sit-upload-v2 input[type=file]');
    const dt = new DataTransfer();
    dt.items.add(file);
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => (q('[sit-element="input-name-file"]') || {}).value, 10000, 'ชื่อไฟล์ในช่อง');
    await human();

    // 3) แสดงข้อมูลจาก Excel
    await click(q('[sit-element="btn-view-file"]'));
    const table = () => q('app-imform-accom-import-table');
    const previewPassports = () =>
      qa('td, mat-cell, [role="cell"], [role="gridcell"]', table())
        .map((c) => c.textContent.trim()).filter((t) => PASSPORT_RE.test(t));
    await waitFor(() => {
      const s = q('[sit-element="btn-save"]');
      return s && !s.disabled && previewPassports().length > 0;
    }, 45000, 'ตารางข้อมูลจาก Excel');
    await idle();
    const passports = Array.from(new Set(previewPassports()));
    log('เว็บอ่านไฟล์ได้ ' + passports.length + ' คน');

    // 4) ให้คนตรวจก่อนบันทึก
    const ok = ask
      ? await ask(passports)
      : await ui.askConfirm('เว็บอ่านได้ ' + passports.length + ' คน — ตรวจชื่อ/เลขพาสปอร์ตในตารางให้ครบ แล้วกดยืนยัน');
    if (!ok) {
      log('ยกเลิก ยังไม่ได้บันทึก', 'warn');
      const c = q('[sit-element="btn-cancel"]');
      if (ask && c) { try { await click(c); } catch (e) {} }
      return null;
    }

    // 5) บันทึก → Confirm → Ok
    await click(q('[sit-element="btn-save"]'));
    const confirmBtn = await waitFor(() => btn(/^\s*Confirm\s*$/i, overlay()), 15000, 'ปุ่ม Confirm');
    await human();
    await click(confirmBtn);
    const okBtn = await waitFor(() => !busy() && btn(/^\s*Ok\s*$/i, overlay()), 120000, 'ผลการนำเข้า');
    const dlg = okBtn.closest('mat-dialog-container, .mat-mdc-dialog-container, .cdk-overlay-pane') || overlay();
    const msg = dlg.textContent.replace(/\s+/g, ' ').replace(/\s*Ok\s*$/i, '').trim();
    lastImportMsg = msg;
    log('ผลจากเว็บ: ' + msg, 'ok');
    await human();
    await click(okBtn);
    await idle();
    return passports;
  }

  // ---------- ขั้นตอน: ดาวน์โหลด PDF ----------
  async function gotoSearch() {
    if (onRoute('/ifa/search')) return;
    const link = q('a.main-page-link');
    if (link) await click(link);
    else location.hash = '#/external/ifa/search';
    try {
      await waitFor(() => onRoute('/ifa/search'), 8000, 'หน้าค้นหา');
    } catch (e) {
      if (e.message === '__stopped__') throw e;
      location.hash = '#/external/ifa/search';
      await waitFor(() => onRoute('/ifa/search'), 15000, 'หน้าค้นหา');
    }
  }

  function rows() {
    const out = [];
    const seen = new Set();
    for (const tr of qa('#main-content tr, #main-content mat-row, #main-content [role="row"]')) {
      if (seen.has(tr) || qa('tr, mat-row, [role="row"]', tr).length) continue;
      seen.add(tr);
      const cells = qa('td, mat-cell, [role="cell"], [role="gridcell"]', tr);
      const texts = cells.map((c) => c.textContent.trim());
      const pi = texts.findIndex((t) => PASSPORT_RE.test(t));
      if (pi < 0) continue;
      let viewBtn = qa('button', tr).find((b) => /^\s*search\s*$/.test((q('mat-icon', b) || {}).textContent || ''));
      if (!viewBtn) {
        viewBtn = qa('button, a, [role="button"], .pointer, mat-icon, img', tr)
          .find((el) => !el.closest('mat-checkbox') && visible(el));
      }
      if (!viewBtn) continue;
      const cb = q('input[type=checkbox]', tr);
      out.push({ el: tr, passport: texts[pi], full: texts[pi + 2] || '', viewBtn, ticked: !!(cb && cb.checked) });
    }
    return out;
  }

  async function ensureResults(force) {
    await gotoSearch();
    await idle();
    if (!force) {
      try { await waitFor(() => rows().length, 3000, 'รายชื่อ'); return; } catch (e) {
        if (e.message === '__stopped__') throw e;
      }
    }
    const s = await waitFor(() => btn(/ค้นหา\s*\/\s*Search/i, q('#main-content')), 15000, 'ปุ่มค้นหา');
    await click(s);
    await idle();
    try { await waitFor(() => rows().length, 12000, 'รายชื่อ'); } catch (e) {
      if (e.message === '__stopped__') throw e;
    }
  }

  function fieldByLabel(re) {
    for (const s of qa('#main-content sit-label')) {
      if (!re.test(s.textContent)) continue;
      for (let n = s.nextElementSibling, i = 0; n && i < 3; n = n.nextElementSibling, i++) {
        const inp = n.matches('input') ? n : q('input', n);
        if (inp) return (inp.value || '').trim();
      }
    }
    return '';
  }

  async function runDownload(onlyList, sink) {
    const done = new Set();
    let saved = 0;
    await ensureResults(!onlyList ? false : true);
    let only = onlyList && onlyList.length ? new Set(onlyList) : null;
    if (!only) {
      const ticked = rows().filter((r) => r.ticked).map((r) => r.passport);
      if (ticked.length) only = new Set(ticked);
    }
    if (!rows().length) { log('ไม่มีรายชื่อในผลค้นหา (เว็บแสดงเฉพาะวันที่เข้าพักที่เลือก)', 'warn'); return { saved: 0, missing: onlyList || [] }; }
    log(only ? 'จะโหลด PDF ' + only.size + ' คน' : 'จะโหลด PDF ทุกคนในผลค้นหา');

    for (let guard = 0; guard < 3000; guard++) {
      if (only && done.size >= only.size) break;
      await ensureResults(false);
      const target = rows().find((r) => !done.has(r.passport) && (!only || only.has(r.passport)));
      if (!target) {
        const next = q('button.mat-mdc-paginator-navigation-next');
        if (next && !next.disabled && !next.classList.contains('mat-mdc-button-disabled')) {
          const before = rows().map((r) => r.passport).join(',');
          await click(next);
          await idle();
          try {
            await waitFor(() => rows().length && rows().map((r) => r.passport).join(',') !== before, 10000, 'หน้าถัดไป');
          } catch (e) {
            if (e.message === '__stopped__') throw e;
            break;
          }
          continue;
        }
        break;
      }
      done.add(target.passport);
      const listFull = target.full;
      ui.setProgress(saved + 1, only ? only.size : null, target.passport);

      await human();
      await click(target.viewBtn);
      const exportBtn = await waitFor(
        () => onRoute('/ifa/view/') && btn(/Export|นำออก/i, q('#main-content')), 30000, 'หน้ารายละเอียด');
      await idle();
      await sleep(400);
      const info = {
        first: fieldByLabel(/First Name/i),
        middle: fieldByLabel(/Middle Name/i),
        last: fieldByLabel(/Last Name/i),
        passport: fieldByLabel(/Passport No/i) || target.passport,
        full: listFull,
      };
      if (info.passport !== target.passport) {
        throw new Error('หน้ารายละเอียดเป็นคนละคนกับแถวที่กด (' + info.passport + ' / ' + target.passport + ') หยุดเพื่อความปลอดภัย');
      }

      arm(true);
      let blob;
      try {
        const p = nextPdf(45000);
        await click(exportBtn);
        blob = await p;
      } finally {
        await new Promise((r) => setTimeout(r, 400));
        arm(false);
      }
      const where = sink ? await sink(blob, info) : await savePdf(blob, fileName(info));
      if (where) { saved++; log('✓ ' + where, 'ok'); }

      await human();
      const closeBtn = await waitFor(() => btn(/ปิด\s*\/\s*Close/i, q('#main-content')), 10000, 'ปุ่มปิด');
      await click(closeBtn);
      await waitFor(() => onRoute('/ifa/search'), 20000, 'กลับหน้ารายชื่อ');
    }

    const missing = only ? Array.from(only).filter((p) => !done.has(p)) : [];
    if (missing.length) log('ไม่เจอในรายชื่อ: ' + missing.join(', '), 'warn');
    log('เสร็จ บันทึก PDF ' + saved + ' ไฟล์', 'ok');
    return { saved, missing };
  }

  // ---------- งานจาก tm7.toyka.net (สั่งจากมือถือ ให้เครื่องนี้ทำ) ----------
  const api = (m) => chrome.runtime.sendMessage(Object.assign({ type: 'tm30-toyka', base: cfg.base || DEFAULTS.base }, m));
  const cleanPp = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  async function runJob(job) {
    const patch = (body) => api({ method: 'PATCH', path: '/api/tm30', json: Object.assign({ id: job.id, who: 'bot' }, body) });
    const claim = await patch({ status: 'working', message: '' });
    if (!claim || !claim.ok) return;                       // ถูกยกเลิก หรือมีอีกแท็บรับไปแล้ว
    log('รับงานจาก toyka: ' + job.label);
    try {
      const f = await api({ path: '/api/tm30/file?id=' + encodeURIComponent(job.id), binary: true });
      if (!f || !f.ok) throw new Error('โหลดไฟล์ Excel ของงานจาก toyka ไม่ได้');
      const bin = atob(f.b64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const file = new File([u8], 'TM30_' + job.id + '.xls', { type: 'application/vnd.ms-excel' });

      const passports = await runUpload(file, async (preview) => {
        const r = await patch({ status: 'review', preview });
        if (!r || !r.ok) return false;
        log('รอกด "ยืนยันบันทึก" ที่หน้า toyka…', 'warn');
        const end = Date.now() + 30 * 60 * 1000;
        for (;;) {
          await sleep(3000);
          const g = await api({ path: '/api/tm30' });
          const j = g && g.ok && (g.data.jobs || []).find((x) => x.id === job.id);
          if (j && j.status === 'cancelled') return false;
          if (j && j.status === 'confirmed') {
            const s2 = await patch({ status: 'saving' });
            return !!(s2 && s2.ok);
          }
          if (Date.now() > end) {
            await patch({ status: 'error', message: 'รอยืนยันเกิน 30 นาที บอทยกเลิกการอัปครั้งนี้ ยังไม่ได้บันทึก' });
            return false;
          }
        }
      });
      if (!passports) return;

      await patch({ status: 'downloading', message: lastImportMsg });
      const wanted = job.people.map((p) => cleanPp(p.passportNo));
      const only = passports.map(cleanPp).filter((p) => wanted.includes(p));
      let res = { saved: 0, missing: [] };
      if (only.length) {
        res = await runDownload(only, async (blob, info) => {
          const up = await api({
            method: 'POST', path: '/api/tm30/pdf',
            form: { fields: { id: job.id, passport: info.passport }, fileDataUrl: await blobToDataUrl(blob), fileName: 'tm30.pdf', fileType: 'application/pdf' },
          });
          if (up && up.ok) return 'ขึ้นบอร์ด toyka: ' + ((up.data && up.data.name) || info.passport);
          if (up && (up.status === 404 || up.status === 409)) {
            log('toyka ไม่รับ ' + info.passport + ': ' + ((up.data && up.data.error) || up.status), 'warn');
            return '';
          }
          throw new Error('ส่ง PDF ขึ้น toyka ไม่ได้ (' + ((up && (up.error || up.status)) || 'ไม่มีคำตอบ') + ')');
        });
      }
      const note = [lastImportMsg, res.missing.length ? 'ไม่เจอในรายชื่อ TM30: ' + res.missing.join(', ') : ''].filter(Boolean).join(' · ');
      await patch({ status: 'done', message: note });
    } catch (e) {
      const stopped = e && e.message === '__stopped__';
      try { await patch({ status: 'error', message: stopped ? 'มีคนกดหยุดที่เครื่องบ้าน' : String((e && e.message) || e) }); } catch (e2) {}
      throw e;
    }
  }

  let lastPoll = 0;
  async function pollJobs() {
    if (!cfg.listen || running || !ui) return;
    if (!/\/external\//.test(location.hash)) { ui.setLink('รอ login เว็บ TM30', 'warn'); return; }
    if (Date.now() - lastPoll < 19000) return;
    lastPoll = Date.now();
    let r;
    try { r = await api({ path: '/api/tm30?bot=1' }); } catch (e) { r = null; }
    if (!r || !r.ok) {
      ui.setLink(r && r.login ? 'ยังไม่ได้ login tm7.toyka.net ใน Chrome นี้' : 'ต่อ toyka ไม่ได้' + (r && r.error ? ': ' + r.error : ''), 'err');
      return;
    }
    ui.setLink('เชื่อม toyka แล้ว · รองาน', 'ok');
    const next = (r.data.jobs || []).filter((j) => j.status === 'queued').sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0];
    if (next && !running) run(() => runJob(next));
  }
  setInterval(() => { pollJobs().catch(() => {}); }, 5000);

  // ---------- ตัวครอบการทำงาน ----------
  async function run(job) {
    if (running) return;
    running = true;
    stopFlag = false;
    ui.setRunning(true);
    try {
      await job();
    } catch (e) {
      if (e && e.message === '__stopped__') log('หยุดแล้ว', 'warn');
      else log('✗ ' + ((e && e.message) || e), 'err');
    } finally {
      arm(false);
      pdfWaiter = null;
      running = false;
      ui.setRunning(false);
      ui.hideConfirm();
    }
  }

  function log(msg, kind) {
    if (ui) ui.log(msg, kind);
  }

  // ---------- แผงควบคุม ----------
  function buildUI() {
    const host = document.createElement('div');
    host.id = 'tm30bot-host';
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; font-family: "Segoe UI", Tahoma, "Leelawadee UI", sans-serif; }
  .card { width: 320px; background: #fffafc; border: 2px solid #f9c5d9; border-radius: 18px;
          box-shadow: 0 8px 28px rgba(214,120,160,.28); overflow: hidden; color: #4a3b52; font-size: 13px; }
  .head { display:flex; align-items:center; justify-content:space-between; padding: 9px 12px;
          background: linear-gradient(90deg,#ffc8dd,#cdb4f6 55%,#a8e0f5); font-weight: 700; font-size: 14px; cursor: pointer; }
  .head button { all: unset; cursor: pointer; padding: 0 6px; font-size: 16px; }
  .body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 8px; }
  .min .body { display: none; }
  .btn { display:block; width:100%; border:0; border-radius: 12px; padding: 9px 10px; font-size: 13px; font-weight: 700;
         cursor:pointer; text-align:center; color:#4a3b52; }
  .btn:disabled, .btn.off { opacity:.45; cursor:not-allowed; pointer-events:none; }
  .b1 { background:#bde7f7; } .b2 { background:#c9f2d3; } .b3 { background:#ffe3a6; } .stop { background:#ffb3c1; }
  .row { display:flex; gap:6px; align-items:center; }
  .row > * { flex:1; }
  label.chk { display:flex; gap:6px; align-items:center; font-size:12px; }
  label.chk input { flex:0 0 auto; }
  .hint { font-size: 11px; color:#8a7a94; line-height:1.35; }
  .confirm { display:none; background:#fff3c9; border:1.5px solid #ffd76a; border-radius:12px; padding:8px; }
  .confirm.show { display:block; }
  .confirm p { margin:0 0 6px; font-weight:700; }
  details { background:#f6efff; border-radius:12px; padding:6px 8px; }
  summary { cursor:pointer; font-weight:700; font-size:12px; }
  input[type=text] { width:100%; border:1.5px solid #dccbf5; border-radius:8px; padding:5px 7px; font-size:12px; margin:3px 0 6px; background:#fff; color:#4a3b52; }
  .toyka { background:#e8f7ff; border:1.5px solid #bde7f7; border-radius:12px; padding:7px 8px; }
  .prog { font-weight:700; color:#7b5fc4; min-height: 16px; }
  .log { max-height: 130px; overflow:auto; background:#fff; border:1.5px solid #f3dbe6; border-radius:10px; padding:6px; font-size:11.5px; line-height:1.4; }
  .log div { word-break: break-word; }
  .ok { color:#1f9d55; } .err { color:#d6336c; font-weight:700; } .warn { color:#c77700; } .dim { color:#a79bb0; }
</style>
<div class="card" id="card">
  <div class="head" id="head"><span>🤖 TM30 Bot</span><button id="min" title="ย่อ/ขยาย">–</button></div>
  <div class="body">
    <label class="btn b1" id="upLabel">① เลือกไฟล์ Excel แล้วอัปโหลด
      <input type="file" id="file" accept=".xls,.xlsx" hidden>
    </label>
    <label class="chk"><input type="checkbox" id="autoNext"> อัปเสร็จแล้วโหลด PDF ของชุดนี้ต่อเลย</label>
    <div class="confirm" id="confirm">
      <p id="confirmText"></p>
      <div class="row"><button class="btn b2" id="yes">ยืนยันบันทึก</button><button class="btn stop" id="no">ยกเลิก</button></div>
    </div>
    <button class="btn b2" id="dl">② ดาวน์โหลด PDF</button>
    <div class="hint">ติ๊กช่องหน้าชื่อในตาราง = โหลดเฉพาะคนที่ติ๊ก · ไม่ติ๊กเลย = โหลดทุกคนในผลค้นหา</div>
    <div class="toyka">
      <label class="chk"><input type="checkbox" id="listen"> <b>รับงานจาก toyka</b> (สั่งจากมือถือ)</label>
      <div class="hint" id="link">ปิดอยู่</div>
    </div>
    <details>
      <summary>ตั้งค่าชื่อไฟล์ / โฟลเดอร์</summary>
      <div class="hint">ชื่อไฟล์: {LAST} {FIRST} {MIDDLE} {PASSPORT} {DATE}</div>
      <input type="text" id="pattern">
      <button class="btn b3" id="pick">เลือกโฟลเดอร์ปลายทาง…</button>
      <div class="hint" id="dirInfo"></div>
      <div class="hint">ถ้าไม่เลือกโฟลเดอร์ จะเก็บใน Downloads ตามโฟลเดอร์ย่อยนี้:</div>
      <input type="text" id="subfolder">
      <div class="hint">เว็บ toyka ที่รับงาน:</div>
      <input type="text" id="base">
    </details>
    <button class="btn stop off" id="stop">■ หยุด</button>
    <div class="prog" id="prog"></div>
    <div class="log" id="log"></div>
  </div>
</div>`;
    const $ = (id) => root.getElementById(id);
    let confirmResolve = null;

    const api = {
      log(msg, kind) {
        const d = document.createElement('div');
        if (kind) d.className = kind;
        d.textContent = msg;
        $('log').appendChild(d);
        $('log').scrollTop = $('log').scrollHeight;
      },
      setRunning(on) {
        $('upLabel').classList.toggle('off', on);
        $('dl').disabled = on;
        $('stop').classList.toggle('off', !on);
        if (!on) $('prog').textContent = '';
      },
      setProgress(i, total, passport) {
        $('prog').textContent = 'กำลังโหลดคนที่ ' + i + (total ? ' / ' + total : '') + ' · ' + passport;
      },
      askConfirm(text) {
        $('confirmText').textContent = text;
        $('confirm').classList.add('show');
        $('card').classList.remove('min');
        return new Promise((resolve) => {
          confirmResolve = resolve;
          const poll = setInterval(() => {
            if (stopFlag && confirmResolve) { clearInterval(poll); api.hideConfirm(); resolve(false); }
            if (!confirmResolve) clearInterval(poll);
          }, 300);
        });
      },
      hideConfirm() {
        $('confirm').classList.remove('show');
        confirmResolve = null;
      },
      setLink(text, kind) {
        $('link').textContent = text;
        $('link').className = 'hint ' + (kind || '');
      },
    };
    const answer = (v) => { const r = confirmResolve; api.hideConfirm(); if (r) r(v); };
    $('yes').addEventListener('click', () => answer(true));
    $('no').addEventListener('click', () => answer(false));

    $('head').addEventListener('click', () => $('card').classList.toggle('min'));
    $('stop').addEventListener('click', () => { stopFlag = true; });

    $('file').addEventListener('change', () => {
      const f = $('file').files[0];
      $('file').value = '';
      if (!f) return;
      run(async () => {
        const passports = await runUpload(f);
        if (passports && cfg.autoNext) await runDownload(passports);
      });
    });
    $('dl').addEventListener('click', () => run(() => runDownload(null)));

    const showDir = () => {
      $('dirInfo').textContent = dirHandle ? 'จะเก็บที่: ' + dirHandle.name + ' (ต้องเลือกใหม่ทุกครั้งที่เปิดเว็บ)' : 'ยังไม่ได้เลือก';
    };
    $('pick').addEventListener('click', async () => {
      if (!window.showDirectoryPicker) { api.log('Chrome รุ่นนี้เลือกโฟลเดอร์ไม่ได้ จะเก็บใน Downloads แทน', 'warn'); return; }
      try {
        dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      } catch (e) {
        if (e && e.name !== 'AbortError') api.log('เลือกโฟลเดอร์ไม่ได้: ' + e.message, 'warn');
      }
      showDir();
    });

    const save = () => { try { chrome.storage.local.set({ tm30bot: cfg }); } catch (e) {} };
    $('pattern').addEventListener('change', () => { cfg.pattern = $('pattern').value.trim() || DEFAULTS.pattern; $('pattern').value = cfg.pattern; save(); });
    $('subfolder').addEventListener('change', () => { cfg.subfolder = $('subfolder').value.trim(); save(); });
    $('autoNext').addEventListener('change', () => { cfg.autoNext = $('autoNext').checked; save(); });
    $('listen').addEventListener('change', () => {
      cfg.listen = $('listen').checked;
      save();
      lastPoll = 0;
      api_setLink();
    });
    $('base').addEventListener('change', () => { cfg.base = ($('base').value.trim() || DEFAULTS.base).replace(/\/+$/, ''); $('base').value = cfg.base; save(); lastPoll = 0; });
    function api_setLink() { api.setLink(cfg.listen ? 'กำลังเชื่อม toyka…' : 'ปิดอยู่', ''); }

    const fill = () => {
      $('pattern').value = cfg.pattern;
      $('subfolder').value = cfg.subfolder;
      $('autoNext').checked = !!cfg.autoNext;
      $('listen').checked = !!cfg.listen;
      $('base').value = cfg.base || DEFAULTS.base;
      api_setLink();
      showDir();
    };
    fill();
    try {
      chrome.storage.local.get('tm30bot', (r) => {
        if (r && r.tm30bot) Object.assign(cfg, r.tm30bot);
        fill();
      });
    } catch (e) {}

    document.documentElement.appendChild(host);
    api.log('พร้อมใช้งาน — login แล้วกด ① หรือ ②', 'dim');
    return api;
  }

  // เว็บนี้บางทีโหลดค้างนาน จึงไม่รอ event โหลดเสร็จ รอแค่ให้มี <body>
  const boot = () => {
    if (ui) return;
    if (!document.body) { setTimeout(boot, 200); return; }
    ui = buildUI();
  };
  boot();
})();
