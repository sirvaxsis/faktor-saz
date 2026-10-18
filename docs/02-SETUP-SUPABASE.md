# ۰۲ — راه‌اندازی Supabase (گام‌به‌گام)

> من به حساب Supabase شما دسترسی ندارم و پروژه‌ای نساخته‌ام. این راهنما کارهایی است که **شما** باید انجام دهید. هیچ مقدار واقعی (آدرس پروژه، کلید) جعل نشده؛ جای‌نگهدارها با `<...>` مشخص‌اند.

## ۱) ساخت پروژه
1. در supabase.com حساب بسازید → **New project**.
2. نام: مثلاً `factorsaz`. رمز دیتابیس را در مدیر رمز نگه دارید (**جایی در کد یا مخزن نگذارید**). منطقه (Region): نزدیک‌ترین به کاربران‌تان (مثلاً Frankfurt).
3. پلن: پلن رایگان برای آزمایش مناسب است. **برای استفادهٔ تجاری** شرایط و محدودیت‌های فعلی پلن رایگان را در سایت Supabase بخوانید (مثلاً توقف خودکار پروژه‌های رایگان بدون فعالیت، محدودیت پشتیبان‌گیری) و در صورت نیاز پلن پولی بگیرید.

## ۲) اجرای SQL (به‌ترتیب)
در **SQL Editor** سه فایل را به‌ترتیب اجرا کنید (Run):
1. `supabase/001_schema.sql` (جدول‌ها، ایندکس‌ها، تریگر ساخت پروفایل، پلن‌ها)
2. `supabase/002_functions.sql` (توابع RPC)
3. `supabase/003_security.sql` (RLS، مجوزها، بستن توابع داخلی)

اگر خطا دیدید، همان‌جا متوقف شوید و متن خطا را بفرستید؛ ⚠️ **این SQLها هنوز روی PostgreSQL واقعی اجرا نشده‌اند** (محیط من PostgreSQL نداشت).

## ۳) آزمون SQL (اجباری پیش از استفاده)
1. یک پروژهٔ **آزمایشی** (یا همین پروژه قبل از ثبت‌نام کاربر واقعی) را در نظر بگیرید.
2. محتوای `tests/004_tests.sql` را در SQL Editor اجرا کنید. همه‌چیز داخل یک تراکنش است و آخرش `ROLLBACK` می‌شود.
3. باید پیام‌های `PASS 1` … `PASS 9` را در بخش Messages/Notices ببینید. هر `FAIL:` یعنی مشکلی هست؛ **بدون رفع آن به فروش نروید.**
4. آزمون هم‌زمانی دستی (انتهای همان فایل) را با دو تب SQL Editor انجام دهید.
5. در **Database → Security Advisor** اخطارهای RLS/Function را ببینید؛ باید جدولی بدون RLS نباشد.

## ۴) تنظیمات Authentication
مسیر: **Authentication**
- **Providers → Email:** فعال؛ **Confirm email = ON** (ضروری: سهمیهٔ رایگان فقط برای ایمیل تأییدشده است)؛ حداقل طول رمز ≥ ۸.
- **URL Configuration:** *Site URL* = آدرس نهایی سایت با اسلش آخر. در *Redirect URLs* هر دو را بگذارید: `<آدرس نهایی>/` و `<آدرس نهایی>/index.html` (برای آزمایش محلی: `http://localhost:8765/`). لینک تأیید ایمیل و بازیابی رمز فقط به همین آدرس‌ها برمی‌گردد.
- **Rate Limits:** مقادیر پیش‌فرض را نگه دارید یا سخت‌تر کنید (ثبت‌نام، ورود، ارسال ایمیل).
- **Attack Protection → CAPTCHA** (اختیاری ولی توصیه می‌شود): Cloudflare Turnstile یا hCaptcha را فعال و *Secret* را فقط در همین داشبورد وارد کنید؛ سپس *Site key* عمومی را در `cloud-config.js` بگذارید (`captcha: { provider: 'turnstile', siteKey: '...' }`). ⚠️ این بخش آزمایش نشده است.
- **Allow anonymous sign-ins:** خاموش بماند.
- **SMTP (بسیار مهم):** ایمیل پیش‌فرض Supabase سقف ارسال بسیار کمی دارد و برای تولید مناسب نیست. یک SMTP واقعی (مثلاً Resend، Brevo، Amazon SES …) وصل کنید و دامنهٔ فرستنده را SPF/DKIM کنید، وگرنه ایمیل تأیید به هرزنامه می‌رود یا ارسال نمی‌شود.
- **Email Templates:** متن ایمیل تأیید/بازیابی را فارسی کنید و لینک `{{ .ConfirmationURL }}` را نگه دارید.

## ۵) اتصال سایت
1. **Project Settings → API:** مقادیر *Project URL* و کلید **anon / publishable** را بردارید.
2. فایل `site/cloud-config.js`:
   ```js
   window.CLOUD_CONFIG = {
     supabaseUrl: '<PROJECT_URL>',
     anonKey: '<ANON_OR_PUBLISHABLE_KEY>',
     siteUrl: '',   // خالی = خودکار
     captcha: { provider: '', siteKey: '' },
     requireLoginOnStart: true
   };
   ```
3. **هرگز** `service_role`، «secret key»، رمز دیتابیس یا JWT Secret را در فایل‌های `site/` نگذارید. (آزمون خودکار این را اسکن می‌کند.)
4. تا وقتی این دو مقدار خالی‌اند، برنامه مثل نسخهٔ قبل (ذخیرهٔ محلی + کد فعال‌سازی) کار می‌کند؛ می‌توانید کد را بدون خطر منتشر کنید و بعد فعال کنید.

## ۵.۱) تغییر سقف‌ها (اختیاری)
جدول `app_settings` (فقط با SQL):
```sql
update public.app_settings set value = '5'::jsonb  where key = 'free_invoice_limit';  -- سهمیهٔ رایگان
update public.app_settings set value = '3'::jsonb  where key = 'max_devices';         -- 0 = بدون محدودیت دستگاه
```

## ۶) ساخت اولین مدیر
1. در سایت با ایمیل خودتان ثبت‌نام و ایمیل را تأیید کنید.
2. در SQL Editor:
   ```sql
   insert into public.admins (user_id) select id from auth.users where email = '<ایمیل شما>';
   ```
3. به `<سایت>/admin.html` بروید و وارد شوید. (راهنمای کامل: `03-ADMIN-GUIDE.md`)

## ۷) پیش از انتشار
فهرست `06-KNOWN-LIMITS-AND-CHECKLIST.md` را مرور و تیک بزنید.
