# ۰۷ — گزارش آزمون‌ها (نتیجهٔ واقعی)

## خلاصه
| بخش | وضعیت |
|---|---|
| آزمون‌های مرورگر روی **شبیه‌ساز** Supabase (`tests/run_ui_tests.py`) | **55 از 55 موفق** |
| آزمون SQL/RLS/توابع روی PostgreSQL **واقعی** (`tests/004_tests.sql`) | ⚠️ **اجرا نشده** — محیط من PostgreSQL نداشت؛ شما باید اجرا کنید |
| آزمون هم‌زمانی واقعی دیتابیس (دو تب SQL) | ⚠️ **اجرا نشده** (فقط روی شبیه‌ساز با قفل نخ‌ها آزمایش شد) |
| ایمیل واقعی، CAPTCHA، Safari/iOS، دسترسی از ایران | ⚠️ **اجرا نشده** |
| برنامه با `cloud-config.js` خالی مثل قبل (محلی + لایسنس) کار می‌کند | ✅ آزمون دودی اجرا شد |

> شبیه‌ساز، «قرارداد API» را مطابق `002_functions.sql` بازتولید می‌کند تا رفتار مرورگر (ورود، سهمیه، دستگاه دوم، قطع شبکه، مهاجرت، پنل مدیریت) آزمایش شود. **درستیِ SQL واقعی را ثابت نمی‌کند.**

## تطبیق با فهرست آزمون‌های درخواستی
| # | سناریو | نتیجه |
|---|---|---|
| ۱ | ثبت‌نام، تأیید ایمیل، ورود و خروج | ✅ روی شبیه‌ساز (ایمیل واقعی آزمایش نشد) |
| ۲ | ساخت ۵ فاکتور و تمام‌شدن سهمیه | ✅ |
| ۳ | تلاش برای فاکتور ششم | ✅ رد شد، چیزی ذخیره/مصرف نشد |
| ۴ | مرورگر ناشناس و ورود به همان حساب | ✅ |
| ۵ | دستگاه دوم | ✅ همان فاکتورها و همان سهمیه |
| ۶ | پاک‌کردن داده‌های مرورگر و ورود مجدد | ✅ سهمیه ریست نشد، فاکتورها برگشتند |
| ۷ | تغییر `user_id` / خواندن فاکتور حساب دیگر | ✅ در شبیه‌ساز؛ ⚠️ RLS واقعی باید با `004_tests.sql` (آزمون ۴ و ۵) تأیید شود |
| ۸ | درخواست مستقیم API برای دور زدن سهمیه | ✅ شبیه‌ساز؛ ⚠️ SQL واقعی: `004` آزمون ۱ |
| ۹ | دو درخواست هم‌زمان برای آخرین فاکتور | ✅ شبیه‌ساز (۵ درخواست موازی → فقط ۱ موفق)؛ ⚠️ دیتابیس واقعی دستی |
| ۱۰ | خطای شبکه هنگام ذخیره | ✅ بدون مصرف/ذخیره؛ پاسخ گم‌شده بعد از commit با همان request_id دوباره مصرف نمی‌کند؛ توکن منقضی خودکار تازه می‌شود |
| ۱۱ | خرید دستی، تأیید مدیر، تمدید، انقضا | ✅ خرید/تأیید/تأیید دوباره(رد)/رسید تکراری(رد)؛ ⚠️ تمدید جمع‌شونده و انقضا فقط در SQL واقعی (`004` آزمون ۷) |
| ۱۲ | لغو اشتراک و بازگشت به قواعد رایگان | ✅ |
| ۱۳ | کد اشتراک نامعتبر/تکراری | — در حالت حساب آنلاین کد فعال‌سازی وجود ندارد؛ رفتار قدیمی در حالت خاموش بودن حساب دست‌نخورده است (آزمون دودی) |
| ۱۴ | بازیابی از فایل پشتیبان | ✅ از مسیر مهاجرت، بدون تکرار |
| ۱۵ | PWA و به‌روزرسانی | ✅ سرویس‌ورکر ثبت، کش نسخه‌دار و بدون کش‌شدن API؛ ⚠️ آفلاین‌ماندن/به‌روزرسانی روی گوشی واقعی آزمایش نشد |
| ۱۶ | نبودن کلید محرمانه در خروجی عمومی | ✅ اسکن خودکار (service_role، secret key، JWT، PEM) |

## جزئیات هر بررسی
| آزمون | نتیجه |
|---|---|
| 1a: guest sees the auth modal on start (after choosing a job) | ✅ PASS |
| 1b: signup shows "confirm your email" message | ✅ PASS |
| 1c: login refused before email confirmation | ✅ PASS |
| 1d: login after confirmation works | ✅ PASS |
| 1e: chip shows 5 free invoices | ✅ PASS |
| 2a: five invoices created | ✅ PASS |
| 2b: server free_used = 5 and 5 invoices stored | ✅ PASS |
| 2c: local cache has the 5 server invoices | ✅ PASS |
| 3a: 6th invoice blocked and paywall shown | ✅ PASS |
| 3b: 6th invoice was NOT stored and quota unchanged | ✅ PASS |
| 3c: nothing extra in local cache after rejection | ✅ PASS |
| 4a: second device/incognito sees the same 5 invoices | ✅ PASS |
| 4b: quota is per account — 6th still blocked on the other device | ✅ PASS |
| 6a: after clearing site data the app asks to sign in | ✅ PASS |
| 6b: invoices come back after re-login | ✅ PASS |
| 6c: clearing browser data did NOT reset the free quota | ✅ PASS |
| 7a: direct API call cannot bypass the quota | ✅ PASS |
| 7b: anonymous call to save_invoice is refused | ✅ PASS |
| 8a: another account cannot read A's invoices (REST) | ✅ PASS |
| 8b: another account cannot delete A's invoice | ✅ PASS |
| 8c: non-admin cannot call admin functions | ✅ PASS |
| 9: 5 parallel requests for the last free invoice → exactly 1 succeeds, free_used = 5 | ✅ PASS |
| 9b: replaying the same request id does not consume quota twice | ✅ PASS |
| 9c: a plain edit does not consume quota | ✅ PASS |
| 9d: an "edit" that changes number+customer is treated as a NEW invoice (original kept) | ✅ PASS |
| 10a: first invoice for D | ✅ PASS |
| 10b: offline save fails cleanly (no local record, no quota consumed) | ✅ PASS |
| 10c: response lost after server commit → retry is idempotent (exactly +1 consumed) | ✅ PASS |
| 10d: expired access token is refreshed transparently | ✅ PASS |
| 10e: fully expired session asks to sign in again and saves nothing | ✅ PASS |
| 11a: admin can log in to the admin page | ✅ PASS |
| 11b: payment recorded + approved from the admin page → pack of 5 active | ✅ PASS |
| 11c: approving the same payment twice is refused | ✅ PASS |
| 11d: the same receipt cannot be recorded twice | ✅ PASS |
| 11e: after purchase the user can create invoices again (pack decremented) | ✅ PASS |
| 11f: cancelling the pack removes access immediately | ✅ PASS |
| 11g: after cancellation the user is back to the free rules (blocked) | ✅ PASS |
| 11h: admin actions are audited | ✅ PASS |
| 12a: migration dialog is offered when old local invoices exist | ✅ PASS |
| 12b: old local data is kept safely before anything is moved | ✅ PASS |
| 12c: 3 invoices migrated, no quota used | ✅ PASS |
| 12d: running migration again creates no duplicates | ✅ PASS |
| 12e: legacy copy still on device after migration (never auto-deleted) | ✅ PASS |
| 12f: migrated invoices appear in the app | ✅ PASS |
| 13a: restoring a backup in cloud mode goes through the migration path | ✅ PASS |
| 13b: backup invoices imported without duplicates | ✅ PASS |
| 13c: company settings are stored in the account | ✅ PASS |
| 14a: sign-out wipes the cached invoices, settings and session | ✅ PASS |
| 14b: legacy device copy is still there after sign-out | ✅ PASS |
| 14c: a different account on the same browser sees none of the previous account data | ✅ PASS |
| 15a: service worker registered, cache is versioned | ✅ PASS |
| 15b: API/auth responses are never cached by the service worker | ✅ PASS |
| 15c: no secret keys / private keys / JWTs in the public site files | ✅ PASS |
| 15d: license-generator.html (private) is not inside the public site folder | ✅ PASS |
| 16: no uncaught JavaScript errors on the main page | ✅ PASS |

## مشکلاتی که خود آزمون‌ها پیدا کردند و اصلاح شد
- پنجرهٔ «انتخاب شغل» (اولین ورود) و پنجرهٔ ورود هم‌زمان باز می‌شدند و ورود پشت آن می‌ماند ← اکنون اول شغل، بعد ورود.
- ارسال مجدد پس از قطع/خطای ۵xx ممکن بود فاکتور تکراری بسازد ← اکنون با همان `request_id` و بدون مصرف دوباره.
- باگ قدیمی `sw.js` (همهٔ ناوبری‌ها روی `index.html` کش می‌شد) ← اصلاح شد.

## اجرای دوبارهٔ آزمون‌ها
```
pip install playwright flask requests && playwright install chromium
python3 tests/run_ui_tests.py        # همه چیز (شبیه‌ساز + وب‌سرور) را خودش بالا می‌آورد
```
