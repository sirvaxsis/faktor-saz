-- ============================================================================
--  فاکتورساز — توابع (RPC) — فایل ۲ از ۳
--  تمام عملیات حساس (مصرف سهمیه، ذخیرهٔ فاکتور، اشتراک) فقط از این توابع انجام می‌شود.
--  توابع «SECURITY DEFINER» هستند و خودشان auth.uid() را بررسی می‌کنند؛ کاربر عادی
--  هیچ دسترسی نوشتن مستقیم روی جدول‌ها ندارد (003_security.sql).
--
--  قرارداد خطا: خطاهای «قانونی» (سهمیه تمام، مسدود بودن، نرخ، ...) با jsonb {ok:false,error:'...'}
--  برگردانده می‌شوند (تراکنش commit می‌شود تا رویداد امنیتی ثبت شود). خطاهای برنامه‌نویسی/مدیریتی
--  با RAISE EXCEPTION می‌آیند.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  توابع کمکی (داخلی؛ برای کاربران قابل فراخوانی نیستند)
-- ---------------------------------------------------------------------------
create or replace function public._fail(p_code text, p_extra jsonb default '{}'::jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('ok', false, 'error', p_code) || coalesce(p_extra, '{}'::jsonb)
$$;

create or replace function public._setting_int(p_key text, p_default integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (value #>> '{}')::integer from public.app_settings where key = p_key), p_default)
$$;

-- فقط ارقام (فارسی/عربی/انگلیسی → انگلیسی، بقیه حذف)
create or replace function public._digits(p_text text)
returns text
language sql
immutable
as $$
  select regexp_replace(
           translate(coalesce(p_text, ''), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'),
           '[^0-9]', '', 'g')
$$;

-- معادل دقیق looksLikeNewInvoice در index.html: آیا «ویرایش» در واقع یک فاکتور جدید است؟
create or replace function public._looks_like_new(o jsonb, n jsonb)
returns boolean
language plpgsql
stable
as $$
declare
  same_name boolean;
  same_phone boolean;
  old_d text[];
  new_d text[];
  od integer;
  kept integer;
  o_items jsonb;
  n_items jsonb;
begin
  if coalesce(o->>'docType', 'invoice') = coalesce(n->>'docType', 'invoice')
     and public._digits(o->>'invNumber') <> public._digits(n->>'invNumber') then
    return true;
  end if;

  same_name  := btrim(coalesce(o->>'custName', '')) = btrim(coalesce(n->>'custName', ''));
  same_phone := public._digits(o->>'custPhone') = public._digits(n->>'custPhone');
  if (not same_name) and (not same_phone) then
    return true;
  end if;

  o_items := case when jsonb_typeof(o->'items') = 'array' then o->'items' else '[]'::jsonb end;
  n_items := case when jsonb_typeof(n->'items') = 'array' then n->'items' else '[]'::jsonb end;

  select coalesce(array_agg(btrim(i->>'description')), '{}'::text[]) into old_d
    from jsonb_array_elements(o_items) i
   where btrim(coalesce(i->>'description', '')) <> '';
  select coalesce(array_agg(btrim(i->>'description')), '{}'::text[]) into new_d
    from jsonb_array_elements(n_items) i
   where btrim(coalesce(i->>'description', '')) <> '';

  od := coalesce(array_length(old_d, 1), 0);
  if od > 0 then
    select count(*) into kept from unnest(old_d) d where d = any(new_d);
    if kept < od / 2.0 then
      return true;
    end if;
  end if;
  return false;
end
$$;

create or replace function public._log_event(p_uid uuid, p_kind text, p_details jsonb default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.security_events (user_id, kind, details) values (p_uid, p_kind, p_details)
$$;

-- محدودیت نرخ: true یعنی مجاز است. تلاش‌ها حتی وقتی رد می‌شوند ثبت می‌شوند.
create or replace function public._rate_ok(p_uid uuid, p_action text, p_limit integer, p_window interval)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  select count(*) into n from public.rate_events
   where user_id = p_uid and action = p_action and created_at > now() - p_window;
  insert into public.rate_events (user_id, action) values (p_uid, p_action);
  if random() < 0.02 then
    delete from public.rate_events where created_at < now() - interval '2 days';
  end if;
  return n < p_limit;
end
$$;

-- وضعیت سهمیه و اشتراک یک کاربر
create or replace function public._quota_state(p_uid uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
  v_used integer;
  v_blocked boolean;
  v_sub_now timestamptz;
  v_sub_final timestamptz;
  v_pack integer;
  v_has_pack boolean;
begin
  v_limit := public._setting_int('free_invoice_limit', 5);
  select free_used, blocked into v_used, v_blocked from public.profiles where id = p_uid;

  select max(ends_at) into v_sub_now from public.entitlements
   where user_id = p_uid and kind = 'sub' and status = 'active' and starts_at <= now() and ends_at > now();
  select max(ends_at) into v_sub_final from public.entitlements
   where user_id = p_uid and kind = 'sub' and status = 'active' and ends_at > now();
  select coalesce(sum(invoices_remaining), 0), count(*) > 0 into v_pack, v_has_pack from public.entitlements
   where user_id = p_uid and kind = 'pack' and status = 'active';

  return jsonb_build_object(
    'free_limit', v_limit,
    'free_used',  coalesce(v_used, 0),
    'free_left',  greatest(v_limit - coalesce(v_used, 0), 0),
    'sub_active', v_sub_now is not null,
    'sub_ends_at', v_sub_final,
    'pack_left',  v_pack,
    'paid',       (v_sub_now is not null) or v_has_pack,
    'blocked',    coalesce(v_blocked, false)
  );
end
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid())
$$;

create or replace function public._assert_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (select 1 from public.admins a where a.user_id = auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end
$$;

create or replace function public._audit(p_action text, p_target uuid, p_details jsonb, p_reason text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.admin_audit (admin_id, action, target_user, details, reason)
  values (auth.uid(), p_action, p_target, p_details, p_reason)
$$;

-- ایجاد دسترسی از روی پلن (بستهٔ فاکتور یا اشتراک). اشتراک‌ها پشت‌سرهم جمع می‌شوند.
create or replace function public._grant_plan(p_uid uuid, p_plan text, p_payment uuid, p_by uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.plans%rowtype;
  v_start timestamptz;
  v_id uuid;
begin
  select * into v_plan from public.plans where id = p_plan and active;
  if not found then
    raise exception 'unknown_or_inactive_plan';
  end if;

  if v_plan.kind = 'pack' then
    insert into public.entitlements (user_id, kind, plan_id, status, invoices_total, invoices_remaining, payment_id, created_by, note)
    values (p_uid, 'pack', v_plan.id, 'active', v_plan.invoices, v_plan.invoices, p_payment, p_by, p_note)
    returning id into v_id;
  else
    select greatest(now(), coalesce(max(ends_at), now())) into v_start
      from public.entitlements
     where user_id = p_uid and kind = 'sub' and status = 'active' and ends_at > now();
    insert into public.entitlements (user_id, kind, plan_id, status, starts_at, ends_at, payment_id, created_by, note)
    values (p_uid, 'sub', v_plan.id, 'active', v_start, v_start + make_interval(days => v_plan.days), p_payment, p_by, p_note)
    returning id into v_id;
  end if;
  return v_id;
end
$$;

-- ---------------------------------------------------------------------------
--  توابع کاربر
-- ---------------------------------------------------------------------------

-- وضعیت حساب برای نمایش در برنامه
create or replace function public.get_account()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  r jsonb;
begin
  if v_uid is null then
    return public._fail('not_authenticated');
  end if;
  select jsonb_build_object(
           'ok', true,
           'id', u.id,
           'email', u.email,
           'email_confirmed', u.email_confirmed_at is not null,
           'is_admin', exists (select 1 from public.admins a where a.user_id = u.id),
           'state', public._quota_state(u.id),
           'settings_rev', p.settings_rev,
           'migrated', p.migrated_at is not null,
           'import_allowance', greatest(public._setting_int('max_import_total', 200) - p.import_count, 0),
           'trash_days', public._setting_int('trash_days', 7),
           'max_devices', public._setting_int('max_devices', 0),
           'server_time', now(),
           'entitlements', coalesce((
              select jsonb_agg(jsonb_build_object(
                       'id', e.id, 'kind', e.kind, 'plan_id', e.plan_id, 'status', e.status,
                       'starts_at', e.starts_at, 'ends_at', e.ends_at,
                       'invoices_total', e.invoices_total, 'invoices_remaining', e.invoices_remaining)
                     order by e.created_at desc)
                from public.entitlements e where e.user_id = u.id), '[]'::jsonb)
         )
    into r
    from auth.users u join public.profiles p on p.id = u.id
   where u.id = v_uid;
  if r is null then
    return public._fail('no_profile');
  end if;
  return r;
end
$$;

-- ذخیرهٔ فاکتور (ساخت جدید یا ویرایش). تنها مسیر مصرف سهمیه.
create or replace function public.save_invoice(
  p_id text,
  p_data jsonb,
  p_request_id uuid,
  p_base_rev integer default null,
  p_device_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_prof public.profiles%rowtype;
  v_existing public.invoices%rowtype;
  v_found boolean;
  v_prev public.quota_events%rowtype;
  v_state jsonb;
  v_unlimited boolean;
  v_is_new boolean := false;
  v_forked boolean := false;
  v_target text := p_id;
  v_op text;
  v_ent_id uuid;
  v_ent_remaining integer;
  v_total numeric;
  v_doc text;
  v_clean jsonb;
  v_inv public.invoices%rowtype;
  v_result jsonb;
begin
  if v_uid is null then
    return public._fail('not_authenticated');
  end if;
  if p_id is null or char_length(p_id) < 8 or char_length(p_id) > 80 or p_request_id is null then
    return public._fail('bad_request');
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    return public._fail('bad_data');
  end if;

  -- قفل ردیف پروفایل: تمام درخواست‌های هم‌زمان یک کاربر پشت‌سرهم اجرا می‌شوند (جلوگیری از مصرف بیش از سهمیه)
  select * into v_prof from public.profiles where id = v_uid for update;
  if not found then
    insert into public.profiles (id, email) select id, email from auth.users where id = v_uid on conflict (id) do nothing;
    select * into v_prof from public.profiles where id = v_uid for update;
  end if;

  if v_prof.blocked then
    perform public._log_event(v_uid, 'blocked_save_attempt', jsonb_build_object('invoice', p_id));
    return public._fail('blocked');
  end if;
  if not exists (select 1 from auth.users where id = v_uid and email_confirmed_at is not null) then
    return public._fail('email_not_confirmed');
  end if;
  if not public._rate_ok(v_uid, 'save_invoice', public._setting_int('rate_save_10min', 60), interval '10 minutes') then
    perform public._log_event(v_uid, 'rate_limited', jsonb_build_object('action', 'save_invoice'));
    return public._fail('rate_limited');
  end if;
  if octet_length(p_data::text) > public._setting_int('max_invoice_bytes', 300000) then
    return public._fail('too_large');
  end if;
  if public._setting_int('max_devices', 0) > 0 then
    if p_device_id is null or not exists (select 1 from public.user_devices where user_id = v_uid and device_id = p_device_id) then
      return public._fail('device_not_registered');
    end if;
  end if;

  -- تکرار همان درخواست: همان نتیجهٔ قبلی، بدون مصرف دوباره
  select * into v_prev from public.quota_events where user_id = v_uid and request_id = p_request_id;
  if found then
    if v_prev.invoice_id = p_id then
      return v_prev.result;
    end if;
    return public._fail('request_reuse');
  end if;

  select * into v_existing from public.invoices where user_id = v_uid and id = p_id for update;
  v_found := found;
  v_state := public._quota_state(v_uid);
  v_unlimited := coalesce((v_state->>'sub_active')::boolean, false);

  if v_found then
    if v_existing.deleted_at is not null then
      return public._fail('invoice_deleted');
    end if;
    if p_base_rev is not null and p_base_rev <> v_existing.rev then
      return public._fail('stale_revision', jsonb_build_object('server_rev', v_existing.rev));
    end if;
    -- «ویرایشِ» تغییردهندهٔ ماهیت فاکتور = فاکتور جدید (رفتار فعلی برنامه حفظ می‌شود)
    if (not v_unlimited) and public._looks_like_new(v_existing.data, p_data) then
      v_is_new := true;
      v_forked := true;
      v_target := gen_random_uuid()::text;
    end if;
  else
    v_is_new := true;
  end if;

  -- مصرف سهمیه: اشتراک فعال (نامحدود) ← سهمیهٔ رایگان ← بستهٔ فاکتور
  if v_is_new then
    if v_unlimited then
      v_op := 'consume_sub';
    elsif v_prof.free_used < public._setting_int('free_invoice_limit', 5) then
      update public.profiles set free_used = free_used + 1 where id = v_uid;
      v_op := 'consume_free';
    else
      select id, invoices_remaining into v_ent_id, v_ent_remaining
        from public.entitlements
       where user_id = v_uid and kind = 'pack' and status = 'active' and invoices_remaining > 0
       order by created_at asc
       limit 1
       for update;
      if v_ent_id is not null then
        update public.entitlements set invoices_remaining = invoices_remaining - 1 where id = v_ent_id;
        v_op := 'consume_pack';
      else
        perform public._log_event(v_uid, 'quota_exceeded', jsonb_build_object('invoice', p_id));
        return public._fail('quota_exceeded', jsonb_build_object('state', public._quota_state(v_uid)));
      end if;
    end if;
  end if;

  v_total := case when (p_data->>'total') ~ '^-?[0-9]+(\.[0-9]+)?$' then (p_data->>'total')::numeric else 0 end;
  v_doc := case when p_data->>'docType' = 'proforma' then 'proforma' else 'invoice' end;

  if v_is_new then
    v_clean := jsonb_set(p_data - '_rev' - 'deletedAt', '{id}', to_jsonb(v_target));
    insert into public.invoices (user_id, id, doc_type, inv_number, data, total, paid_status, rev, source)
    values (v_uid, v_target, v_doc, left(coalesce(p_data->>'invNumber', ''), 40), v_clean, v_total,
            left(coalesce(p_data->>'paidStatus', ''), 10), 1, 'app')
    returning * into v_inv;
  else
    v_clean := jsonb_set(p_data - '_rev' - 'deletedAt', '{id}', to_jsonb(p_id));
    update public.invoices
       set data = v_clean, doc_type = v_doc, inv_number = left(coalesce(p_data->>'invNumber', ''), 40),
           total = v_total, paid_status = left(coalesce(p_data->>'paidStatus', ''), 10),
           rev = rev + 1, updated_at = now()
     where user_id = v_uid and id = p_id
    returning * into v_inv;
  end if;

  v_result := jsonb_build_object(
    'ok', true, 'id', v_inv.id, 'rev', v_inv.rev, 'updated_at', v_inv.updated_at,
    'is_new', v_is_new, 'forked', v_forked, 'state', public._quota_state(v_uid));

  if v_is_new then
    insert into public.quota_events (user_id, request_id, invoice_id, op, entitlement_id, result)
    values (v_uid, p_request_id, p_id, v_op, v_ent_id, v_result);
  end if;
  return v_result;
end
$$;

-- حذف نرم (سطل زباله). سهمیه برنمی‌گردد.
create or replace function public.delete_invoice(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_rev integer;
begin
  if v_uid is null then return public._fail('not_authenticated'); end if;
  if exists (select 1 from public.profiles where id = v_uid and blocked) then return public._fail('blocked'); end if;
  if not public._rate_ok(v_uid, 'delete_invoice', 120, interval '10 minutes') then return public._fail('rate_limited'); end if;
  update public.invoices set deleted_at = now(), rev = rev + 1, updated_at = now()
   where user_id = v_uid and id = p_id and deleted_at is null
  returning rev into v_rev;
  if v_rev is null then return public._fail('not_found'); end if;
  return jsonb_build_object('ok', true, 'rev', v_rev);
end
$$;

create or replace function public.restore_invoice(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_rev integer;
begin
  if v_uid is null then return public._fail('not_authenticated'); end if;
  if exists (select 1 from public.profiles where id = v_uid and blocked) then return public._fail('blocked'); end if;
  if not public._rate_ok(v_uid, 'restore_invoice', 120, interval '10 minutes') then return public._fail('rate_limited'); end if;
  update public.invoices set deleted_at = null, rev = rev + 1, updated_at = now()
   where user_id = v_uid and id = p_id and deleted_at is not null
     and deleted_at > now() - make_interval(days => public._setting_int('trash_days', 7))
  returning rev into v_rev;
  if v_rev is null then return public._fail('not_in_trash'); end if;
  return jsonb_build_object('ok', true, 'rev', v_rev);
end
$$;

-- حذف همیشگی (فقط از سطل زباله)
create or replace function public.purge_invoice(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  n integer;
begin
  if v_uid is null then return public._fail('not_authenticated'); end if;
  if not public._rate_ok(v_uid, 'purge_invoice', 120, interval '10 minutes') then return public._fail('rate_limited'); end if;
  delete from public.invoices where user_id = v_uid and id = p_id and deleted_at is not null;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'deleted', n);
end
$$;

-- پاک‌کردن خودکار فاکتورهای سطل زبالهٔ قدیمی (پس از trash_days روز)؛ کلاینت هنگام همگام‌سازی صدا می‌زند
create or replace function public.purge_old_trash()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  n integer;
begin
  if v_uid is null then return public._fail('not_authenticated'); end if;
  delete from public.invoices
   where user_id = v_uid and deleted_at is not null
     and deleted_at < now() - make_interval(days => public._setting_int('trash_days', 7));
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'deleted', n);
end
$$;

-- ذخیرهٔ تنظیمات (اطلاعات شرکت، لوگو، ظاهر، فهرست‌ها و ...) با نسخه‌بندی خوش‌بینانه
create or replace function public.save_settings(p_settings jsonb, p_base_rev integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_prof public.profiles%rowtype;
  v_rev integer;
begin
  if v_uid is null then return public._fail('not_authenticated'); end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then return public._fail('bad_data'); end if;
  select * into v_prof from public.profiles where id = v_uid for update;
  if not found then return public._fail('no_profile'); end if;
  if v_prof.blocked then return public._fail('blocked'); end if;
  if not public._rate_ok(v_uid, 'save_settings', public._setting_int('rate_settings_10min', 60), interval '10 minutes') then
    return public._fail('rate_limited');
  end if;
  if octet_length(p_settings::text) > public._setting_int('max_settings_bytes', 3000000) then
    return public._fail('too_large');
  end if;
  if p_base_rev is not null and p_base_rev <> v_prof.settings_rev then
    return public._fail('stale_settings', jsonb_build_object('server_rev', v_prof.settings_rev));
  end if;
  update public.profiles
     set settings = p_settings, settings_rev = settings_rev + 1, settings_updated_at = now()
   where id = v_uid
  returning settings_rev into v_rev;
  return jsonb_build_object('ok', true, 'rev', v_rev);
end
$$;

-- مهاجرت: واردکردن فاکتورهای قبلیِ مرورگر. سهمیه مصرف نمی‌کند ولی سقف کل دارد
-- (جلوگیری از استفادهٔ import به‌عنوان «ساخت رایگان فاکتور»). شناسهٔ تکراری نادیده گرفته می‌شود.
create or replace function public.import_invoices(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_prof public.profiles%rowtype;
  v_item jsonb;
  v_id text;
  v_data jsonb;
  v_allow integer;
  v_inserted integer := 0;
  v_skipped integer := 0;
  v_n integer;
  v_created timestamptz;
  v_max integer;
begin
  if v_uid is null then return public._fail('not_authenticated'); end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then return public._fail('bad_data'); end if;
  select * into v_prof from public.profiles where id = v_uid for update;
  if not found then return public._fail('no_profile'); end if;
  if v_prof.blocked then return public._fail('blocked'); end if;
  if not exists (select 1 from auth.users where id = v_uid and email_confirmed_at is not null) then
    return public._fail('email_not_confirmed');
  end if;
  if not public._rate_ok(v_uid, 'import_invoices', public._setting_int('rate_import_hour', 5), interval '1 hour') then
    return public._fail('rate_limited');
  end if;
  v_allow := greatest(public._setting_int('max_import_total', 200) - v_prof.import_count, 0);
  if jsonb_array_length(p_items) > v_allow then
    perform public._log_event(v_uid, 'import_limit', jsonb_build_object('count', jsonb_array_length(p_items), 'allowance', v_allow));
    return public._fail('import_limit', jsonb_build_object('allowance', v_allow));
  end if;
  v_max := public._setting_int('max_invoice_bytes', 300000);

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_id := v_item->>'id';
    v_data := v_item->'data';
    if v_id is null or char_length(v_id) < 8 or char_length(v_id) > 80
       or v_data is null or jsonb_typeof(v_data) <> 'object'
       or octet_length(v_data::text) > v_max then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_created := case when (v_data->>'savedAt') ~ '^[0-9]{10,13}$'
                      then to_timestamp((v_data->>'savedAt')::numeric / 1000.0) else now() end;
    insert into public.invoices (user_id, id, doc_type, inv_number, data, total, paid_status, rev, source, created_at, updated_at)
    values (v_uid, v_id,
            case when v_data->>'docType' = 'proforma' then 'proforma' else 'invoice' end,
            left(coalesce(v_data->>'invNumber', ''), 40),
            jsonb_set(v_data - '_rev' - 'deletedAt', '{id}', to_jsonb(v_id)),
            case when (v_data->>'total') ~ '^-?[0-9]+(\.[0-9]+)?$' then (v_data->>'total')::numeric else 0 end,
            left(coalesce(v_data->>'paidStatus', ''), 10), 1, 'import', v_created, now())
    on conflict (user_id, id) do nothing;
    get diagnostics v_n = row_count;
    if v_n > 0 then v_inserted := v_inserted + 1; else v_skipped := v_skipped + 1; end if;
  end loop;

  update public.profiles
     set import_count = import_count + v_inserted, migrated_at = coalesce(migrated_at, now())
   where id = v_uid;
  return jsonb_build_object('ok', true, 'inserted', v_inserted, 'skipped', v_skipped);
end
$$;

-- دستگاه‌ها (شفاف و اختیاری؛ فقط وقتی max_devices > 0 باشد اعمال می‌شود)
create or replace function public.register_device(p_device_id text, p_label text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_max integer;
  v_count integer;
begin
  if v_uid is null then return public._fail('not_authenticated'); end if;
  if p_device_id is null or char_length(p_device_id) < 8 or char_length(p_device_id) > 64 then return public._fail('bad_request'); end if;
  if exists (select 1 from public.user_devices where user_id = v_uid and device_id = p_device_id) then
    update public.user_devices set last_seen = now(), label = coalesce(left(p_label, 60), label)
     where user_id = v_uid and device_id = p_device_id;
    return jsonb_build_object('ok', true, 'new', false);
  end if;
  v_max := public._setting_int('max_devices', 0);
  select count(*) into v_count from public.user_devices where user_id = v_uid;
  if v_max > 0 and v_count >= v_max then
    perform public._log_event(v_uid, 'device_limit', jsonb_build_object('count', v_count, 'max', v_max));
    return public._fail('device_limit', jsonb_build_object('max', v_max));
  end if;
  insert into public.user_devices (user_id, device_id, label) values (v_uid, p_device_id, left(p_label, 60));
  return jsonb_build_object('ok', true, 'new', true);
end
$$;

create or replace function public.list_devices()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('device_id', d.device_id, 'label', d.label, 'first_seen', d.first_seen, 'last_seen', d.last_seen)
                            order by d.last_seen desc), '[]'::jsonb)
    from public.user_devices d where d.user_id = auth.uid()
$$;

create or replace function public.remove_device(p_device_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return public._fail('not_authenticated'); end if;
  delete from public.user_devices where user_id = auth.uid() and device_id = p_device_id;
  return jsonb_build_object('ok', true);
end
$$;

-- ---------------------------------------------------------------------------
--  توابع مدیر (همه با _assert_admin شروع می‌شوند و در admin_audit ثبت می‌شوند)
-- ---------------------------------------------------------------------------
create or replace function public.admin_find_user(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q text := lower(btrim(coalesce(p_query, '')));
begin
  perform public._assert_admin();
  if char_length(q) < 3 then
    raise exception 'query_too_short';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(t)::jsonb) from (
      select u.id, u.email, u.created_at, u.email_confirmed_at is not null as email_confirmed,
             p.blocked, p.free_used
        from auth.users u left join public.profiles p on p.id = u.id
       where position(q in lower(u.email)) > 0 or u.id::text = q
       order by u.created_at desc
       limit 20) t), '[]'::jsonb);
end
$$;

create or replace function public.admin_user_overview(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r jsonb;
begin
  perform public._assert_admin();
  select jsonb_build_object(
    'user', jsonb_build_object('id', u.id, 'email', u.email, 'email_confirmed_at', u.email_confirmed_at,
                               'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at),
    'profile', jsonb_build_object('free_used', p.free_used, 'blocked', p.blocked, 'blocked_reason', p.blocked_reason,
                                  'import_count', p.import_count, 'migrated_at', p.migrated_at),
    'state', public._quota_state(u.id),
    'invoice_counts', jsonb_build_object(
        'active',   (select count(*) from public.invoices i where i.user_id = u.id and i.deleted_at is null),
        'imported', (select count(*) from public.invoices i where i.user_id = u.id and i.source = 'import'),
        'trash',    (select count(*) from public.invoices i where i.user_id = u.id and i.deleted_at is not null)),
    'entitlements', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc) from public.entitlements e where e.user_id = u.id), '[]'::jsonb),
    'payments',     coalesce((select jsonb_agg(to_jsonb(pm) order by pm.created_at desc) from public.payments pm where pm.user_id = u.id), '[]'::jsonb),
    'quota_events', coalesce((select jsonb_agg(to_jsonb(q) - 'result' order by q.created_at desc)
                                from (select * from public.quota_events where user_id = u.id order by created_at desc limit 20) q), '[]'::jsonb),
    'security_events', coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at desc)
                                from (select * from public.security_events where user_id = u.id order by created_at desc limit 20) s), '[]'::jsonb),
    'audit',        coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc)
                                from (select * from public.admin_audit where target_user = u.id order by created_at desc limit 30) a), '[]'::jsonb),
    'devices',      coalesce((select jsonb_agg(to_jsonb(d) order by d.last_seen desc) from public.user_devices d where d.user_id = u.id), '[]'::jsonb)
  ) into r
  from auth.users u join public.profiles p on p.id = u.id
  where u.id = p_user;
  if r is null then
    raise exception 'user_not_found';
  end if;
  return r;
end
$$;

-- ثبت پرداخت دریافت‌شده (وضعیت: در انتظار تأیید). p_receipt_ref شمارهٔ پیگیری/رسید است و یکتا باید باشد.
create or replace function public.admin_record_payment(
  p_user uuid, p_plan text, p_amount_text text, p_channel text, p_receipt_ref text, p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public._assert_admin();
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'user_not_found'; end if;
  if not exists (select 1 from public.plans where id = p_plan and active) then raise exception 'unknown_or_inactive_plan'; end if;
  insert into public.payments (user_id, plan_id, amount_text, channel, receipt_ref, note, status, created_by)
  values (p_user, p_plan, left(p_amount_text, 60), coalesce(nullif(left(p_channel, 20), ''), 'other'),
          nullif(btrim(p_receipt_ref), ''), left(p_note, 500), 'pending', auth.uid())
  returning id into v_id;
  perform public._audit('record_payment', p_user, jsonb_build_object('payment', v_id, 'plan', p_plan, 'receipt', p_receipt_ref), p_note);
  return jsonb_build_object('ok', true, 'payment_id', v_id);
end
$$;

-- تأیید پرداخت و فعال‌سازی. فقط یک‌بار ممکن است (قفل ردیف + بررسی وضعیت).
create or replace function public.admin_approve_payment(p_payment uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.payments%rowtype;
  v_ent uuid;
begin
  perform public._assert_admin();
  select * into v_pay from public.payments where id = p_payment for update;
  if not found then raise exception 'payment_not_found'; end if;
  if v_pay.status <> 'pending' then raise exception 'payment_not_pending'; end if;
  v_ent := public._grant_plan(v_pay.user_id, v_pay.plan_id, v_pay.id, auth.uid(), 'approved payment');
  update public.payments set status = 'approved', approved_at = now(), approved_by = auth.uid(), entitlement_id = v_ent
   where id = v_pay.id;
  perform public._audit('approve_payment', v_pay.user_id, jsonb_build_object('payment', v_pay.id, 'plan', v_pay.plan_id, 'entitlement', v_ent), null);
  return jsonb_build_object('ok', true, 'entitlement_id', v_ent);
end
$$;

create or replace function public.admin_reject_payment(p_payment uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.payments%rowtype;
begin
  perform public._assert_admin();
  if p_reason is null or btrim(p_reason) = '' then raise exception 'reason_required'; end if;
  select * into v_pay from public.payments where id = p_payment for update;
  if not found then raise exception 'payment_not_found'; end if;
  if v_pay.status <> 'pending' then raise exception 'payment_not_pending'; end if;
  update public.payments set status = 'rejected', reject_reason = left(p_reason, 300) where id = v_pay.id;
  perform public._audit('reject_payment', v_pay.user_id, jsonb_build_object('payment', v_pay.id), p_reason);
  return jsonb_build_object('ok', true);
end
$$;

-- فعال‌سازی بدون پرداخت (مثلاً انتقال مشتری‌های کد قدیمی یا هدیه). علت اجباری است.
create or replace function public.admin_grant_plan(p_user uuid, p_plan text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay uuid;
  v_ent uuid;
begin
  perform public._assert_admin();
  if p_reason is null or btrim(p_reason) = '' then raise exception 'reason_required'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'user_not_found'; end if;
  insert into public.payments (user_id, plan_id, amount_text, channel, note, status, created_by, approved_at, approved_by)
  values (p_user, p_plan, '0', 'admin_grant', left(p_reason, 500), 'approved', auth.uid(), now(), auth.uid())
  returning id into v_pay;
  v_ent := public._grant_plan(p_user, p_plan, v_pay, auth.uid(), 'admin grant: ' || left(p_reason, 200));
  update public.payments set entitlement_id = v_ent where id = v_pay;
  perform public._audit('grant_plan', p_user, jsonb_build_object('plan', p_plan, 'payment', v_pay, 'entitlement', v_ent), p_reason);
  return jsonb_build_object('ok', true, 'entitlement_id', v_ent);
end
$$;

create or replace function public.admin_cancel_entitlement(p_ent uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_e public.entitlements%rowtype;
begin
  perform public._assert_admin();
  if p_reason is null or btrim(p_reason) = '' then raise exception 'reason_required'; end if;
  select * into v_e from public.entitlements where id = p_ent for update;
  if not found then raise exception 'entitlement_not_found'; end if;
  if v_e.status <> 'active' then raise exception 'entitlement_not_active'; end if;
  update public.entitlements
     set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = left(p_reason, 300),
         invoices_remaining = case when kind = 'pack' then 0 else invoices_remaining end,
         ends_at = case when kind = 'sub' then least(ends_at, now()) else ends_at end
   where id = p_ent;
  perform public._audit('cancel_entitlement', v_e.user_id,
        jsonb_build_object('entitlement', p_ent, 'kind', v_e.kind, 'before_remaining', v_e.invoices_remaining, 'before_ends_at', v_e.ends_at), p_reason);
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.admin_set_free_used(p_user uuid, p_value integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old integer;
begin
  perform public._assert_admin();
  if p_reason is null or btrim(p_reason) = '' then raise exception 'reason_required'; end if;
  if p_value is null or p_value < 0 then raise exception 'bad_value'; end if;
  select free_used into v_old from public.profiles where id = p_user for update;
  if not found then raise exception 'user_not_found'; end if;
  update public.profiles set free_used = p_value where id = p_user;
  perform public._audit('set_free_used', p_user, jsonb_build_object('before', v_old, 'after', p_value), p_reason);
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.admin_set_pack_remaining(p_ent uuid, p_value integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_e public.entitlements%rowtype;
begin
  perform public._assert_admin();
  if p_reason is null or btrim(p_reason) = '' then raise exception 'reason_required'; end if;
  select * into v_e from public.entitlements where id = p_ent and kind = 'pack' for update;
  if not found then raise exception 'entitlement_not_found'; end if;
  if p_value is null or p_value < 0 then raise exception 'bad_value'; end if;
  update public.entitlements set invoices_remaining = p_value where id = p_ent;
  perform public._audit('set_pack_remaining', v_e.user_id, jsonb_build_object('entitlement', p_ent, 'before', v_e.invoices_remaining, 'after', p_value), p_reason);
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.admin_set_sub_end(p_ent uuid, p_ends_at timestamptz, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_e public.entitlements%rowtype;
begin
  perform public._assert_admin();
  if p_reason is null or btrim(p_reason) = '' then raise exception 'reason_required'; end if;
  select * into v_e from public.entitlements where id = p_ent and kind = 'sub' for update;
  if not found then raise exception 'entitlement_not_found'; end if;
  if p_ends_at is null or p_ends_at <= v_e.starts_at then raise exception 'bad_value'; end if;
  update public.entitlements set ends_at = p_ends_at where id = p_ent;
  perform public._audit('set_sub_end', v_e.user_id, jsonb_build_object('entitlement', p_ent, 'before', v_e.ends_at, 'after', p_ends_at), p_reason);
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.admin_set_blocked(p_user uuid, p_blocked boolean, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._assert_admin();
  if p_blocked and (p_reason is null or btrim(p_reason) = '') then raise exception 'reason_required'; end if;
  update public.profiles
     set blocked = p_blocked,
         blocked_reason = case when p_blocked then left(p_reason, 300) else null end,
         blocked_at = case when p_blocked then now() else null end,
         blocked_by = case when p_blocked then auth.uid() else null end
   where id = p_user;
  if not found then raise exception 'user_not_found'; end if;
  perform public._audit(case when p_blocked then 'block_user' else 'unblock_user' end, p_user, '{}'::jsonb, p_reason);
  return jsonb_build_object('ok', true);
end
$$;
