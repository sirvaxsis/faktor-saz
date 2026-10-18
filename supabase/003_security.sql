-- ============================================================================
--  فاکتورساز — امنیت (RLS، مجوزهای جدول و تابع) — فایل ۳ از ۳
--  اصل: کاربر عادی فقط «می‌خواند» (RLS: فقط ردیف‌های خودش). هر نوشتنی فقط از راه توابع RPC
--  (002_functions.sql) انجام می‌شود تا سهمیه، اشتراک و مالکیت قابل دور زدن نباشند.
--  فعال‌کردن RLS به‌تنهایی کافی نیست؛ این فایل مجوزهای جدول و تابع را هم محدود می‌کند.
-- ============================================================================

-- ---------- ۱) RLS روی همهٔ جدول‌ها ----------
alter table public.app_settings    enable row level security;
alter table public.profiles        enable row level security;
alter table public.invoices        enable row level security;
alter table public.plans           enable row level security;
alter table public.payments        enable row level security;
alter table public.entitlements    enable row level security;
alter table public.quota_events    enable row level security;
alter table public.rate_events     enable row level security;
alter table public.security_events enable row level security;
alter table public.user_devices    enable row level security;
alter table public.admins          enable row level security;
alter table public.admin_audit     enable row level security;

-- ---------- ۲) سیاست‌ها: فقط خواندنِ داده‌های خود کاربر ----------
drop policy if exists profiles_select_own     on public.profiles;
drop policy if exists invoices_select_own     on public.invoices;
drop policy if exists entitlements_select_own on public.entitlements;
drop policy if exists payments_select_own     on public.payments;
drop policy if exists quota_events_select_own on public.quota_events;
drop policy if exists user_devices_select_own on public.user_devices;
drop policy if exists plans_select_active     on public.plans;

create policy profiles_select_own     on public.profiles     for select to authenticated using (id = (select auth.uid()));
create policy invoices_select_own     on public.invoices     for select to authenticated using (user_id = (select auth.uid()));
create policy entitlements_select_own on public.entitlements for select to authenticated using (user_id = (select auth.uid()));
create policy payments_select_own     on public.payments     for select to authenticated using (user_id = (select auth.uid()));
create policy quota_events_select_own on public.quota_events for select to authenticated using (user_id = (select auth.uid()));
create policy user_devices_select_own on public.user_devices for select to authenticated using (user_id = (select auth.uid()));
create policy plans_select_active     on public.plans        for select to authenticated using (active);

-- هیچ سیاست insert/update/delete برای نقش‌های anon/authenticated تعریف نشده است؛
-- جدول‌های app_settings, rate_events, security_events, admins, admin_audit هیچ سیاستی ندارند (دسترسی کامل بسته).

-- ---------- ۳) مجوزهای جدول ----------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- ستون‌های حساس (یادداشت مدیر، شناسهٔ مدیر، دلیل مسدودی داخلی) برای کاربر قابل خواندن نیستند
grant select (id, email, created_at, free_used, blocked, migrated_at, import_count, settings, settings_rev, settings_updated_at)
  on public.profiles to authenticated;
grant select (user_id, id, doc_type, inv_number, data, total, paid_status, rev, source, created_at, updated_at, deleted_at)
  on public.invoices to authenticated;
grant select (id, user_id, kind, plan_id, status, starts_at, ends_at, invoices_total, invoices_remaining, created_at)
  on public.entitlements to authenticated;
grant select (id, user_id, plan_id, amount_text, channel, status, created_at, approved_at)
  on public.payments to authenticated;
grant select (id, user_id, invoice_id, op, created_at)
  on public.quota_events to authenticated;
grant select (user_id, device_id, label, first_seen, last_seen)
  on public.user_devices to authenticated;
grant select on public.plans to authenticated;

-- ---------- ۴) مجوزهای تابع ----------
-- ابتدا همه چیز بسته؛ سپس فقط توابع لازم برای کاربر وارد‌شده باز می‌شود.
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

grant execute on function public.get_account()                                          to authenticated;
grant execute on function public.save_invoice(text, jsonb, uuid, integer, text)         to authenticated;
grant execute on function public.delete_invoice(text)                                   to authenticated;
grant execute on function public.restore_invoice(text)                                  to authenticated;
grant execute on function public.purge_invoice(text)                                    to authenticated;
grant execute on function public.purge_old_trash()                                      to authenticated;
grant execute on function public.save_settings(jsonb, integer)                          to authenticated;
grant execute on function public.import_invoices(jsonb)                                 to authenticated;
grant execute on function public.register_device(text, text)                            to authenticated;
grant execute on function public.list_devices()                                         to authenticated;
grant execute on function public.remove_device(text)                                    to authenticated;
grant execute on function public.is_admin()                                             to authenticated;

-- توابع مدیر: قابل فراخوانی‌اند ولی داخل هر کدام _assert_admin() است (غیرمدیر خطای forbidden می‌گیرد)
grant execute on function public.admin_find_user(text)                                  to authenticated;
grant execute on function public.admin_user_overview(uuid)                              to authenticated;
grant execute on function public.admin_record_payment(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.admin_approve_payment(uuid)                            to authenticated;
grant execute on function public.admin_reject_payment(uuid, text)                       to authenticated;
grant execute on function public.admin_grant_plan(uuid, text, text)                     to authenticated;
grant execute on function public.admin_cancel_entitlement(uuid, text)                   to authenticated;
grant execute on function public.admin_set_free_used(uuid, integer, text)               to authenticated;
grant execute on function public.admin_set_pack_remaining(uuid, integer, text)         to authenticated;
grant execute on function public.admin_set_sub_end(uuid, timestamptz, text)             to authenticated;
grant execute on function public.admin_set_blocked(uuid, boolean, text)                 to authenticated;

-- توابع داخلی (_fail, _digits, _looks_like_new, _setting_int, _log_event, _rate_ok, _quota_state,
-- _assert_admin, _audit, _grant_plan, handle_new_user) عمداً هیچ مجوزی برای anon/authenticated ندارند.

-- ---------- ۵) ساخت اولین مدیر (دستی، فقط با SQL Editor) ----------
-- ابتدا خودتان در برنامه ثبت‌نام کنید و ایمیل را تأیید کنید، سپس (با ایمیل خودتان):
--   insert into public.admins (user_id) select id from auth.users where email = 'YOUR_EMAIL@example.com';
