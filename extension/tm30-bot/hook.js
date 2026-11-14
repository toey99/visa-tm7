// ทำงานใน "โลกของหน้าเว็บ" เพื่อดักไฟล์ PDF ตอนกด Export
// ทำงานเฉพาะตอนบอทสั่ง (armed) เท่านั้น เวลาใช้เว็บเองตามปกติจะไม่ไปยุ่งอะไรเลย
(() => {
  if (window.__tm30botHook) return;
  window.__tm30botHook = true;

  let armed = false;
  const blobs = new Map();
  const post = (type, data) =>
    window.postMessage(Object.assign({ __tm30bot: 'main', type }, data), location.origin);
  const note = (msg) => post('note', { msg });

  const isPdf = (u8) =>
    u8.length >= 4 && u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46;

  function offerText(text, via) {
    if (!armed || typeof text !== 'string') return;
    const m = text.match(/JVBERi0[A-Za-z0-9+/=\\\s]{200,}/);
    if (!m) return;
    try {
      const b64 = m[0].replace(/\\[nr]/g, '').replace(/\\\//g, '/').replace(/[\s\\]/g, '');
      const bin = atob(b64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      if (isPdf(u8)) post('pdf', { blob: new Blob([u8], { type: 'application/pdf' }), via });
    } catch (e) {
      note('อ่าน base64 ไม่ได้ (' + via + ')');
    }
  }

  async function offerBlob(blob, via) {
    try {
      if (!armed || !blob || blob.size < 200) return;
      const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
      if (isPdf(head)) {
        post('pdf', { blob: blob.slice(0, blob.size, 'application/pdf'), via });
      } else if (blob.size < 30 * 1024 * 1024 && /json|text/i.test(blob.type || '')) {
        offerText(await blob.text(), via + '-text');
      }
    } catch (e) {}
  }

  // 1) blob ที่หน้าเว็บสร้างขึ้นเพื่อเปิด/ดาวน์โหลด
  const origCreate = URL.createObjectURL;
  URL.createObjectURL = function (obj) {
    const u = origCreate.apply(this, arguments);
    try {
      if (obj instanceof Blob) {
        blobs.set(u, obj);
        if (blobs.size > 40) blobs.delete(blobs.keys().next().value);
        offerBlob(obj, 'createObjectURL');
      }
    } catch (e) {}
    return u;
  };

  // 2) คำตอบจากเซิร์ฟเวอร์ (XHR)
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', () => {
      if (!armed) return;
      try {
        const rt = this.responseType;
        const r = this.response;
        if (r instanceof Blob) offerBlob(r, 'xhr');
        else if (r instanceof ArrayBuffer) offerBlob(new Blob([r]), 'xhr');
        else if (rt === '' || rt === 'text') offerText(this.responseText, 'xhr-text');
        else if (rt === 'json' && r) offerText(JSON.stringify(r), 'xhr-json');
      } catch (e) {}
    });
    return origSend.apply(this, arguments);
  };

  // 3) คำตอบจากเซิร์ฟเวอร์ (fetch)
  const origFetch = window.fetch;
  window.fetch = function () {
    const p = origFetch.apply(this, arguments);
    if (armed) {
      p.then((res) => {
        try {
          res.clone().blob().then((b) => offerBlob(b, 'fetch')).catch(() => {});
        } catch (e) {}
      }).catch(() => {});
    }
    return p;
  };

  // หน้าต่างปลอม: ใช้แทนหน้าต่าง PDF ที่เว็บจะเปิด เพื่อไม่ให้มีแท็บเด้งขึ้นมาทีละคน
  const dummy = new Proxy(function () {}, {
    get: (t, p) => (p === 'then' || typeof p === 'symbol' ? undefined : dummy),
    set: () => true,
    apply: (t, self, args) => {
      for (const a of args) if (typeof a === 'string' && a.length > 300) offerText(a, 'window-write');
      return dummy;
    },
    construct: () => dummy,
  });

  // 4) หน้าต่างใหม่ที่เว็บเปิดเพื่อแสดง PDF
  const origOpen = window.open;
  window.open = function (url) {
    if (!armed) return origOpen.apply(this, arguments);
    const u = String(url || '');
    note('window.open ' + (u ? u.slice(0, 70) : '(ว่าง)'));
    try {
      if (u.startsWith('blob:')) {
        const b = blobs.get(u);
        if (b) offerBlob(b, 'open-blob');
        else origFetch(u).then((r) => r.blob()).then((x) => offerBlob(x, 'open-blob')).catch(() => {});
      } else if (u.startsWith('data:')) {
        offerText(u, 'open-data');
      } else if (u && u !== 'about:blank') {
        origFetch(new URL(u, location.href).href, { credentials: 'include' })
          .then((r) => r.blob())
          .then((x) => offerBlob(x, 'open-url'))
          .catch(() => note('โหลด URL ของ PDF ไม่ได้'));
      }
    } catch (e) {}
    return dummy;
  };

  // 5) ลิงก์ดาวน์โหลดที่เว็บกดเอง (กันไฟล์ซ้ำในโฟลเดอร์ Downloads)
  const origAClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    const h = this.href || '';
    if (armed && (h.startsWith('blob:') || h.startsWith('data:'))) {
      note('a.click ' + h.slice(0, 40));
      if (h.startsWith('blob:')) {
        const b = blobs.get(h);
        if (b) offerBlob(b, 'a-blob');
      } else offerText(h, 'a-data');
      return;
    }
    return origAClick.apply(this, arguments);
  };

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__tm30bot !== 'ui') return;
    if (e.data.type === 'arm') armed = !!e.data.on;
  });
})();
