// ============================================================================
//  تنظیمات حساب آنلاین (Supabase)
//  ● تا وقتی supabaseUrl و anonKey را نگذاشته‌اید، قابلیت حساب آنلاین خاموش است و برنامه
//    مثل نسخهٔ قبل (ذخیرهٔ محلی + کد فعال‌سازی) کار می‌کند.
//  ● anonKey (یا همان publishable key) کلید «عمومی» است و گذاشتنش اینجا امن است، به شرط اینکه
//    SQL امنیتی (supabase/003_security.sql) اجرا شده باشد.
//  ● هرگز «service_role» یا «secret key» یا رمز دیتابیس را اینجا نگذارید.
// ============================================================================
window.CLOUD_CONFIG = {
  supabaseUrl: '',     // مثال: 'https://abcdefghijklmnop.supabase.co'
  anonKey: '',         // کلید عمومی (anon / publishable) پروژه
  siteUrl: '',         // آدرس نهایی سایت با اسلش آخر؛ خالی = خودکار. مثال: 'https://factorsaz.pages.dev/'
  captcha: { provider: '', siteKey: '' },   // provider: 'turnstile' یا 'hcaptcha' (اختیاری؛ باید در داشبورد Supabase هم فعال شود)
  requireLoginOnStart: true                  // در اولین ورود، پنجرهٔ ورود/ثبت‌نام نشان داده شود
};
