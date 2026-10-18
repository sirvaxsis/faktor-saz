-- ============================================================================
--  فاکتورساز — ساختار دیتابیس (Supabase / PostgreSQL)
--  فایل ۱ از ۳: جدول‌ها، ایندکس‌ها و تریگر. در SQL Editor اجرا کنید.
--  بعد از آن به‌ترتیب 002_functions.sql و 003_security.sql را اجرا کنید.
--
--  ⚠️ این اسکریپت‌ها روی PostgreSQL واقعی اجرا و آزمایش نشده‌اند (محیط توسعه PostgreSQL نداشت).
--     پیش از هر استفادهٔ تجاری، tests/004_tests.sql را روی یک پروژهٔ آزمایشی اجرا کنید.
-- ============================================================================

-- ---------- تنظیمات سراسری (فقط با SQL قابل تغییرند) ----------
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

insert into public.app_settings (key, value) values
  ('free_invoice_limit',   '5'::jsonb),       -- سهمیهٔ رایگان هر حساب (ساخت فاکتور جدید)
  ('trash_days',           '7'::jsonb),       -- مدت نگهداری در سطل زباله
  ('max_invoice_bytes',    '300000'::jsonb),  -- حداکثر حجم JSON هر فاکتور
  ('max_settings_bytes',   '3000000'::jsonb), -- حداکثر حجم تنظیمات (شامل لوگو)
  ('max_import_total',     '200'::jsonb),     -- سقف کل فاکتورهای واردشده (مهاجرت) برای هر حساب
  ('max_devices',          '0'::jsonb),       -- 0 = بدون محدودیت دستگاه
  ('rate_save_10min',      '60'::jsonb),      -- حداکثر ذخیرهٔ فاکتور در ۱۰ دقیقه برای هر حساب
  ('rate_settings_10min',  '60'::jsonb),
  ('rate_import_hour',     '5'::jsonb)
on conflict (key) do nothing;

-- ---------- پروفایل کاربر ----------
create table if not exists public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  email               text,
  created_at          timestamptz not null default now(),
  free_used           integer not null default 0 check (free_used >= 0),
  blocked             boolean not null default false,
  blocked_reason      text,
  blocked_at          timestamptz,
  blocked_by          uuid,
  migrated_at         timestamptz,
  import_count        integer not null default 0 check (import_count >= 0),
  settings            jsonb not null default '{}'::jsonb,
  settings_rev        integer not null default 0,
  settings_updated_at timestamptz
);

-- ---------- فاکتورها ----------
-- id رشته است تا فاکتورهای قدیمیِ مرورگر (شناسهٔ غیر UUID) هنگام مهاجرت همان شناسه را نگه دارند.
-- کلید اصلی (user_id, id) است؛ پس شناسهٔ دو کاربر با هم برخورد نمی‌کند و کسی شناسهٔ دیگری را نمی‌رباید.
create table if not exists public.invoices (
  user_id     uuid not null references auth.users(id) on delete cascade,
  id          text not null check (char_length(id) between 8 and 80),
  doc_type    text not null default 'invoice' check (doc_type in ('invoice','proforma')),
  inv_number  text,
  data        jsonb not null check (jsonb_typeof(data) = 'object'),
  total       numeric not null default 0,
  paid_status text not null default '',
  rev         integer not null default 1,
  source      text not null default 'app' check (source in ('app','import')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  primary key (user_id, id)
);
create index if not exists invoices_user_updated_idx on public.invoices (user_id, updated_at desc);
create index if not exists invoices_user_deleted_idx on public.invoices (user_id, deleted_at) where deleted_at is not null;

-- ---------- پلن‌ها (باید با license-config.js هم‌خوان باشند) ----------
create table if not exists public.plans (
  id          text primary key,
  kind        text not null check (kind in ('pack','sub')),
  title       text not null,
  price_text  text,
  note        text,
  invoices    integer check (invoices is null or invoices > 0),
  days        integer check (days is null or days > 0),
  sort        integer not null default 0,
  active      boolean not null default true,
  check ((kind = 'pack' and invoices is not null) or (kind = 'sub' and days is not null))
);

-- ---------- پرداخت‌های دستی ----------
create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  plan_id         text not null references public.plans(id),
  amount_text     text,
  channel         text not null default 'other',
  receipt_ref     text,
  note            text,
  status          text not null default 'pending' check (status in ('pending','approved','rejected')),
  reject_reason   text,
  entitlement_id  uuid,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  approved_at     timestamptz,
  approved_by     uuid
);
-- یک رسید (شمارهٔ پیگیری) نباید دو بار ثبت یا تأیید شود
create unique index if not exists payments_receipt_uq
  on public.payments (lower(receipt_ref))
  where receipt_ref is not null and status in ('pending','approved');
create index if not exists payments_user_idx on public.payments (user_id, created_at desc);

-- ---------- اشتراک‌ها و بسته‌ها ----------
create table if not exists public.entitlements (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  kind                text not null check (kind in ('pack','sub')),
  plan_id             text references public.plans(id),
  status              text not null default 'active' check (status in ('active','cancelled')),
  starts_at           timestamptz,
  ends_at             timestamptz,
  invoices_total      integer,
  invoices_remaining  integer check (invoices_remaining is null or invoices_remaining >= 0),
  payment_id          uuid references public.payments(id),
  note                text,
  created_at          timestamptz not null default now(),
  created_by          uuid,
  cancelled_at        timestamptz,
  cancelled_by        uuid,
  cancel_reason       text,
  check ((kind = 'pack' and invoices_total is not null and invoices_remaining is not null)
      or (kind = 'sub'  and starts_at is not null and ends_at is not null))
);
create index if not exists entitlements_user_idx on public.entitlements (user_id, kind, status);

-- ---------- مصرف سهمیه ----------
create table if not exists public.quota_events (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  request_id      uuid not null,
  invoice_id      text,
  op              text not null check (op in ('consume_free','consume_pack','consume_sub')),
  entitlement_id  uuid,
  result          jsonb,
  created_at      timestamptz not null default now(),
  unique (user_id, request_id)
);

-- ---------- محدودیت نرخ و رویدادهای امنیتی ----------
create table if not exists public.rate_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null,
  action      text not null,
  created_at  timestamptz not null default now()
);
create index if not exists rate_events_idx on public.rate_events (user_id, action, created_at desc);

create table if not exists public.security_events (
  id          bigint generated always as identity primary key,
  user_id     uuid,
  kind        text not null,
  details     jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists security_events_idx on public.security_events (user_id, created_at desc);

-- ---------- دستگاه‌ها (اختیاری و شفاف؛ پیش‌فرض بدون محدودیت) ----------
create table if not exists public.user_devices (
  user_id     uuid not null references auth.users(id) on delete cascade,
  device_id   text not null check (char_length(device_id) between 8 and 64),
  label       text,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  primary key (user_id, device_id)
);

-- ---------- مدیرها و سابقهٔ عملیات مدیریتی ----------
create table if not exists public.admins (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.admin_audit (
  id           bigint generated always as identity primary key,
  admin_id     uuid,
  action       text not null,
  target_user  uuid,
  details      jsonb,
  reason       text,
  created_at   timestamptz not null default now()
);
create index if not exists admin_audit_target_idx on public.admin_audit (target_user, created_at desc);

-- ---------- ساخت خودکار پروفایل هنگام ثبت‌نام ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- پروفایل کاربرانی که پیش از اجرای این اسکریپت ساخته شده‌اند
insert into public.profiles (id, email)
select u.id, u.email from auth.users u
on conflict (id) do nothing;

-- ---------- پلن‌های فعلی (کپی دقیق از site/license-config.js؛ بدون تغییر عنوان و قیمت) ----------
insert into public.plans (id, kind, title, price_text, note, invoices, days, sort) values
  ('pack_5',   'pack', 'بستهٔ ۵ فاکتور',   '۲۵,۰۰۰ تومان',    'بدون تاریخ انقضا', 5,    null, 10),
  ('pack_20',  'pack', 'بستهٔ ۲۰ فاکتور',  '۹۰,۰۰۰ تومان',    'بدون تاریخ انقضا', 20,   null, 20),
  ('pack_50',  'pack', 'بستهٔ ۵۰ فاکتور',  '۲۱۰,۰۰۰ تومان',   'بدون تاریخ انقضا', 50,   null, 30),
  ('pack_100', 'pack', 'بستهٔ ۱۰۰ فاکتور', '۳۸۰,۰۰۰ تومان',   'بدون تاریخ انقضا', 100,  null, 40),
  ('sub_30',   'sub',  'اشتراک ماهانه',    '۱۵۰,۰۰۰ تومان',   'فاکتور نامحدود',   null, 30,   50),
  ('sub_365',  'sub',  'اشتراک سالانه',    '۱,۲۰۰,۰۰۰ تومان', 'فاکتور نامحدود',   null, 365,  60)
on conflict (id) do nothing;
