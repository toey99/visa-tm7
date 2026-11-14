// รับไฟล์ PDF (data URL) จากหน้าเว็บ แล้วบันทึกลงโฟลเดอร์ Downloads
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'tm30-download') return;
  chrome.downloads.download(
    { url: msg.dataUrl, filename: msg.filename, conflictAction: 'uniquify', saveAs: false },
    (id) => {
      const err = chrome.runtime.lastError;
      sendResponse({ ok: !err && id !== undefined, error: err ? err.message : '' });
    }
  );
  return true;
});

// คุยกับ tm7.toyka.net แทนหน้าเว็บ TM30 (ใช้การ login Google ของ Chrome เครื่องนี้ ไม่มีรหัสผ่านเก็บไว้ที่ไหน)
const TOYKA_OK = /^https:\/\/(tm7\.toyka\.net|[a-z0-9-]+\.vercel\.app)$/;
function b64(buf) {
  const u8 = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
async function toyka(msg) {
  const base = String(msg.base || '').replace(/\/+$/, '');
  if (!TOYKA_OK.test(base)) return { ok: false, status: 0, error: 'ที่อยู่เว็บ toyka ไม่ถูกต้อง' };
  const opt = { method: msg.method || 'GET', credentials: 'include', cache: 'no-store' };
  if (msg.json) {
    opt.headers = { 'content-type': 'application/json' };
    opt.body = JSON.stringify(msg.json);
  }
  if (msg.form) {
    const fd = new FormData();
    for (const k of Object.keys(msg.form.fields || {})) fd.set(k, msg.form.fields[k]);
    if (msg.form.fileDataUrl) {
      const blob = await (await fetch(msg.form.fileDataUrl)).blob();
      fd.set('file', new File([blob], msg.form.fileName || 'file', { type: msg.form.fileType || blob.type }));
    }
    opt.body = fd;
  }
  const r = await fetch(base + msg.path, opt);
  const ct = r.headers.get('content-type') || '';
  if (msg.binary) {
    if (!r.ok || /html/i.test(ct)) return { ok: false, status: r.status, login: /html/i.test(ct) };
    return { ok: true, status: r.status, b64: b64(await r.arrayBuffer()) };
  }
  if (!/json/i.test(ct)) return { ok: false, status: r.status, login: true };
  return { ok: r.ok, status: r.status, data: await r.json() };
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'tm30-toyka') return;
  toyka(msg).then(sendResponse, (e) => sendResponse({ ok: false, status: 0, error: String((e && e.message) || e) }));
  return true;
});
