// سرویس‌ورکر: برنامه را برای کار آفلاین کش می‌کند.
// هر بار نسخهٔ جدید فایل‌ها را منتشر کردید، عدد VERSION را یکی بالا ببرید.
//
// نکات امنیتی نسخهٔ حساب‌محور:
//  - فقط فایل‌های «همین سایت» و فونت‌ها کش می‌شوند. درخواست‌های Supabase (احراز هویت، فاکتورها، RPC)
//    از مبدأ دیگری هستند، اصلاً از این سرویس‌ورکر عبور نمی‌کنند و هرگز کش نمی‌شوند؛ پس داده‌ی خصوصی
//    یک کاربر برای کاربر دیگر نمایش داده نمی‌شود.
//  - هر صفحه با آدرس خودش کش می‌شود (قبلاً همهٔ ناوبری‌ها روی index.html نوشته می‌شد؛ با admin.html این اشتباه می‌شد).
//  - لینک تأیید ایمیل / بازیابی رمز با #hash برمی‌گردد؛ hash در درخواست شبکه نمی‌آید و مشکلی ایجاد نمی‌کند.
const VERSION = 'v14-cloud';
const CACHE = 'factor-' + VERSION;
const CORE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './cloud.js', './cloud-config.js', './license-config.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('factor-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // صفحه‌ها: اول شبکه، اگر آفلاین بود از کش (هر صفحه با آدرس خودش)
  if (req.mode === 'navigate') {
    if (url.origin !== location.origin) return;
    e.respondWith(
      fetch(req)
        .then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html') || caches.match('./')))
    );
    return;
  }

  // فونت‌های گوگل: از کش نشان بده و در پس‌زمینه تازه کن
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.open(CACHE).then((c) =>
        c.match(req).then((hit) => {
          const net = fetch(req).then((res) => { c.put(req, res.clone()); return res; }).catch(() => hit);
          return hit || net;
        })
      )
    );
    return;
  }

  // بقیهٔ فایل‌های همین سایت: اول شبکه، آفلاین از کش. (هر مبدأ دیگری، از جمله Supabase، دست‌نخورده می‌ماند.)
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req)
        .then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })
        .catch(() => caches.match(req))
    );
  }
});
