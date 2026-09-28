// Service worker: سایت را بعد از اولین بازدید برای استفادهٔ آفلاین نگه می‌دارد.
// استراتژی: اول شبکه (تا همیشه آخرین نسخه‌ی سایت را ببینید)، اگر اینترنت نبود از حافظهٔ پنهان.
// هیچ اطلاعات فاکتور/مشتری‌ای اینجا ذخیره نمی‌شود؛ آن‌ها فقط در localStorage مرورگر هستند.
const CACHE = 'factorsaz-v1';

self.addEventListener('install', (e) => { self.skipWaiting(); });

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if(!sameOrigin && !isFont) return;

  e.respondWith(
    fetch(req)
      .then(res => {
        if(res && (res.ok || res.type === 'opaque')){
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('./') : undefined)))
  );
});
