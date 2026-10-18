-- ============================================================================
--  آزمون‌های SQL فاکتورساز — در SQL Editor (روی یک پروژهٔ آزمایشی!) اجرا کنید.
--  همه‌چیز داخل یک تراکنش است و در پایان ROLLBACK می‌شود؛ هیچ دادهٔ ماندگاری نمی‌ماند.
--  اگر هر آزمون شکست بخورد، پیام «FAIL: ...» می‌آید و اجرا متوقف می‌شود.
--  ⚠️ این فایل در محیط توسعه اجرا نشده است (PostgreSQL در دسترس نبود). نتیجهٔ اجرا را خودتان ببینید.
--  نکته: آزمون هم‌زمانی واقعی (دو درخواست هم‌زمان) را باید دستی با دو تب SQL انجام دهید: راهنما در انتهای فایل.
-- ============================================================================
begin;

-- کاربران آزمایشی: A (عادی)، B (عادی)، M (مدیر)
insert into auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
 ('aaaaaaaa-0000-0000-0000-000000000001','authenticated','authenticated','a@test.local', now(), now(), now(), '{}', '{}'),
 ('bbbbbbbb-0000-0000-0000-000000000002','authenticated','authenticated','b@test.local', now(), now(), now(), '{}', '{}'),
 ('cccccccc-0000-0000-0000-000000000003','authenticated','authenticated','m@test.local', now(), now(), now(), '{}', '{}'),
 ('dddddddd-0000-0000-0000-000000000004','authenticated','authenticated','u@test.local', null,  now(), now(), '{}', '{}');

insert into public.admins (user_id) values ('cccccccc-0000-0000-0000-000000000003');

-- ---------------------------------------------------------------------------
-- ۱) سهمیهٔ رایگان: ۵ فاکتور مجاز، ششمی رد می‌شود
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  r jsonb; i int; used int;
begin
  perform set_config('request.jwt.claim.sub', a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  for i in 1..5 loop
    r := public.save_invoice('inv-A-000' || i, jsonb_build_object('invNumber', (1000+i)::text, 'custName', 'Ali', 'custPhone', '0912', 'items', jsonb_build_array(jsonb_build_object('description','x')), 'total', 100*i), gen_random_uuid());
    if not (r->>'ok')::boolean then reset role; raise exception 'FAIL: save #% failed: %', i, r; end if;
  end loop;
  r := public.save_invoice('inv-A-0006', jsonb_build_object('invNumber','1006','custName','Ali'), gen_random_uuid());
  reset role;
  if (r->>'ok')::boolean or r->>'error' <> 'quota_exceeded' then raise exception 'FAIL: 6th invoice should be quota_exceeded, got %', r; end if;
  select free_used into used from public.profiles where id = a;
  if used <> 5 then raise exception 'FAIL: free_used should be 5, got %', used; end if;
  if exists (select 1 from public.invoices where user_id = a and id = 'inv-A-0006') then raise exception 'FAIL: 6th invoice was stored'; end if;
  raise notice 'PASS 1: free quota = 5, 6th rejected, nothing stored';
end $$;

-- ---------------------------------------------------------------------------
-- ۲) ویرایش فاکتور موجود سهمیه مصرف نمی‌کند؛ تکرار همان درخواست هم نه
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  r jsonb; used_before int; used_after int; rid uuid := gen_random_uuid(); r2 jsonb; r3 jsonb;
begin
  perform set_config('request.jwt.claim.sub', a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  select free_used into used_before from public.profiles where id = a;
  set local role authenticated;
  r := public.save_invoice('inv-A-0001', jsonb_build_object('invNumber','1001','custName','Ali','custPhone','0912','items', jsonb_build_array(jsonb_build_object('description','x')), 'total', 555, 'paidStatus','paid'), rid, 1);
  r2 := public.save_invoice('inv-A-0001', jsonb_build_object('invNumber','1001','custName','Ali','custPhone','0912','items', jsonb_build_array(jsonb_build_object('description','x')), 'total', 777), gen_random_uuid(), 1);
  reset role;
  if not (r->>'ok')::boolean then raise exception 'FAIL: edit rejected: %', r; end if;
  if (r2->>'error') <> 'stale_revision' then raise exception 'FAIL: stale base_rev should be rejected, got %', r2; end if;
  select free_used into used_after from public.profiles where id = a;
  if used_after <> used_before then raise exception 'FAIL: edit consumed quota (% -> %)', used_before, used_after; end if;
  raise notice 'PASS 2: edit is free, stale revision rejected';
end $$;

-- ---------------------------------------------------------------------------
-- ۳) «ویرایشِ» تغییردهندهٔ ماهیت (شماره + مشتری عوض شود) = فاکتور جدید → اینجا سهمیه تمام است → رد
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  r jsonb;
begin
  perform set_config('request.jwt.claim.sub', a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.save_invoice('inv-A-0001', jsonb_build_object('invNumber','9999','custName','Other','custPhone','0999','items', jsonb_build_array(jsonb_build_object('description','zzz')), 'total', 1), gen_random_uuid());
  reset role;
  if (r->>'ok')::boolean or r->>'error' <> 'quota_exceeded' then raise exception 'FAIL: disguised-new edit must be treated as new, got %', r; end if;
  if (select data->>'custName' from public.invoices where user_id = a and id = 'inv-A-0001') <> 'Ali' then raise exception 'FAIL: original invoice was modified'; end if;
  raise notice 'PASS 3: disguised new invoice consumes quota (and original untouched)';
end $$;

-- ---------------------------------------------------------------------------
-- ۴) RLS و مجوزها: B فاکتور A را نمی‌بیند و هیچ نوشتن مستقیمی ندارد
-- ---------------------------------------------------------------------------
do $$
declare
  b uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  n int; ok boolean;
begin
  perform set_config('request.jwt.claim.sub', b::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.invoices;             -- RLS: فقط خودش (۰)
  if n <> 0 then reset role; raise exception 'FAIL: B can read % invoices of others', n; end if;
  select count(*) into n from public.profiles;             -- فقط پروفایل خودش
  if n <> 1 then reset role; raise exception 'FAIL: B sees % profiles', n; end if;

  ok := false;
  begin insert into public.invoices (user_id, id, data) values (b, 'direct-insert-1', '{}'::jsonb);
  exception when others then ok := true; end;
  if not ok then reset role; raise exception 'FAIL: direct insert into invoices must be denied'; end if;

  ok := false;
  begin update public.profiles set free_used = 0 where id = b;
  exception when others then ok := true; end;
  if not ok then reset role; raise exception 'FAIL: direct update of profiles.free_used must be denied'; end if;

  ok := false;
  begin update public.entitlements set invoices_remaining = 999;
  exception when others then ok := true; end;
  if not ok then reset role; raise exception 'FAIL: direct update of entitlements must be denied'; end if;

  ok := false;
  begin perform public._quota_state(b);
  exception when others then ok := true; end;
  if not ok then reset role; raise exception 'FAIL: internal helper _quota_state must not be callable'; end if;

  ok := false;
  begin perform public.admin_find_user('test');
  exception when others then ok := true; end;
  if not ok then reset role; raise exception 'FAIL: non-admin must not run admin_find_user'; end if;
  reset role;
  raise notice 'PASS 4: RLS + revoked grants OK';
end $$;

-- B با همان شناسهٔ فاکتورِ A فقط فاکتور خودش را می‌سازد؛ فاکتور A دست‌نخورده می‌ماند
do $$
declare
  a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  b uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  r jsonb;
begin
  perform set_config('request.jwt.claim.sub', b::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.save_invoice('inv-A-0001', jsonb_build_object('invNumber','1','custName','HACK'), gen_random_uuid());
  reset role;
  if (select data->>'custName' from public.invoices where user_id = a and id = 'inv-A-0001') = 'HACK' then raise exception 'FAIL: B overwrote A invoice'; end if;
  if not exists (select 1 from public.invoices where user_id = b and id = 'inv-A-0001') then raise exception 'FAIL: B own copy missing'; end if;
  raise notice 'PASS 5: cross-user id collision harmless';
end $$;

-- ---------------------------------------------------------------------------
-- ۶) ایمیل تأییدنشده و کاربر مسدود نمی‌تواند ذخیره کند
-- ---------------------------------------------------------------------------
do $$
declare
  u uuid := 'dddddddd-0000-0000-0000-000000000004';
  b uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  r jsonb;
begin
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.save_invoice('inv-U-0001', jsonb_build_object('invNumber','1','custName','x'), gen_random_uuid());
  reset role;
  if r->>'error' <> 'email_not_confirmed' then raise exception 'FAIL: unconfirmed email must be refused, got %', r; end if;

  update public.profiles set blocked = true, blocked_reason = 'test' where id = b;
  perform set_config('request.jwt.claim.sub', b::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.save_invoice('inv-B-0100', jsonb_build_object('invNumber','1','custName','x'), gen_random_uuid());
  reset role;
  if r->>'error' <> 'blocked' then raise exception 'FAIL: blocked user must be refused, got %', r; end if;
  update public.profiles set blocked = false, blocked_reason = null where id = b;
  if not exists (select 1 from public.security_events where user_id = b and kind = 'blocked_save_attempt') then raise exception 'FAIL: security event not logged'; end if;
  raise notice 'PASS 6: unconfirmed + blocked refused, event logged';
end $$;

-- ---------------------------------------------------------------------------
-- ۷) خرید دستی: ثبت، تأیید (فقط یک‌بار)، مصرف بسته، اشتراک و تمدید پشت‌سرهم، لغو
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  m uuid := 'cccccccc-0000-0000-0000-000000000003';
  r jsonb; pid uuid; ok boolean; rem int; e1 timestamptz; e2 timestamptz; ent uuid;
begin
  perform set_config('request.jwt.claim.sub', m::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.admin_record_payment(a, 'pack_5', '25000', 'telegram', 'REC-1', 'test');
  pid := (r->>'payment_id')::uuid;
  -- ثبت دوبارهٔ همان رسید ممنوع
  ok := false;
  begin perform public.admin_record_payment(a, 'pack_5', '25000', 'telegram', 'rec-1', 'dup');
  exception when others then ok := true; end;
  if not ok then reset role; raise exception 'FAIL: duplicate receipt accepted'; end if;
  perform public.admin_approve_payment(pid);
  -- تأیید دوباره ممنوع
  ok := false;
  begin perform public.admin_approve_payment(pid);
  exception when others then ok := true; end;
  if not ok then reset role; raise exception 'FAIL: payment approved twice'; end if;
  reset role;

  select invoices_remaining into rem from public.entitlements where user_id = a and kind = 'pack';
  if rem <> 5 then raise exception 'FAIL: pack remaining should be 5, got %', rem; end if;

  -- کاربر A حالا از بسته مصرف می‌کند
  perform set_config('request.jwt.claim.sub', a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.save_invoice('inv-A-0007', jsonb_build_object('invNumber','1007','custName','Ali'), gen_random_uuid());
  reset role;
  if not (r->>'ok')::boolean then raise exception 'FAIL: save with pack failed: %', r; end if;
  select invoices_remaining into rem from public.entitlements where user_id = a and kind = 'pack';
  if rem <> 4 then raise exception 'FAIL: pack remaining should be 4, got %', rem; end if;

  -- اشتراک ۳۰ روزه و تمدید: دومی از انتهای اولی شروع می‌شود
  perform set_config('request.jwt.claim.sub', m::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.admin_grant_plan(a, 'sub_30', 'test grant 1');
  perform public.admin_grant_plan(a, 'sub_30', 'test grant 2');
  reset role;
  select min(ends_at), max(ends_at) into e1, e2 from public.entitlements where user_id = a and kind = 'sub';
  if e2 - e1 < interval '29 days' then raise exception 'FAIL: subscriptions did not stack (% vs %)', e1, e2; end if;

  -- با اشتراک فعال، فاکتور جدید سهمیه/بسته مصرف نمی‌کند
  perform set_config('request.jwt.claim.sub', a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.save_invoice('inv-A-0008', jsonb_build_object('invNumber','1008','custName','Ali'), gen_random_uuid());
  reset role;
  select invoices_remaining into rem from public.entitlements where user_id = a and kind = 'pack';
  if rem <> 4 or not (r->>'ok')::boolean then raise exception 'FAIL: with active subscription pack must not be consumed'; end if;

  -- لغو اشتراک‌ها → برگشت به قواعد رایگان/بسته
  perform set_config('request.jwt.claim.sub', m::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  for ent in select id from public.entitlements where user_id = a and kind = 'sub' and status = 'active' loop
    perform public.admin_cancel_entitlement(ent, 'test cancel');
  end loop;
  reset role;
  if (public._quota_state(a)->>'sub_active')::boolean then raise exception 'FAIL: subscription still active after cancel'; end if;
  if (select count(*) from public.admin_audit where target_user = a) < 5 then raise exception 'FAIL: admin audit rows missing'; end if;
  raise notice 'PASS 7: payments, one-time approval, pack/sub consumption, stacking, cancel, audit';
end $$;

-- ---------------------------------------------------------------------------
-- ۸) مهاجرت: سقف و تکراری‌نبودن
-- ---------------------------------------------------------------------------
do $$
declare
  b uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  r jsonb; r2 jsonb; items jsonb;
begin
  perform set_config('request.jwt.claim.sub', b::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  items := jsonb_build_array(
     jsonb_build_object('id','1700000000000-abc123','data', jsonb_build_object('invNumber','10','custName','Old','savedAt',1700000000000)),
     jsonb_build_object('id','1700000000001-def456','data', jsonb_build_object('invNumber','11','custName','Old2')));
  set local role authenticated;
  r  := public.import_invoices(items);
  r2 := public.import_invoices(items);
  reset role;
  if (r->>'inserted')::int <> 2 or (r2->>'inserted')::int <> 0 then raise exception 'FAIL: import not idempotent: % / %', r, r2; end if;
  update public.app_settings set value = '3'::jsonb where key = 'max_import_total';
  perform set_config('request.jwt.claim.sub', b::text, true);
  set local role authenticated;
  r := public.import_invoices(jsonb_build_array(
     jsonb_build_object('id','imp-0000-0001','data','{}'::jsonb), jsonb_build_object('id','imp-0000-0002','data','{}'::jsonb)));
  reset role;
  if r->>'error' <> 'import_limit' then raise exception 'FAIL: import cap not enforced: %', r; end if;
  update public.app_settings set value = '200'::jsonb where key = 'max_import_total';
  raise notice 'PASS 8: import idempotent and capped';
end $$;

-- ---------------------------------------------------------------------------
-- ۹) محدودیت نرخ
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  r jsonb; i int; limited boolean := false;
begin
  update public.app_settings set value = '3'::jsonb where key = 'rate_save_10min';
  delete from public.rate_events where user_id = a;
  perform set_config('request.jwt.claim.sub', a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  for i in 1..6 loop
    r := public.save_invoice('inv-A-0001', jsonb_build_object('invNumber','1001','custName','Ali','custPhone','0912','items', jsonb_build_array(jsonb_build_object('description','x')), 'total', i), gen_random_uuid());
    if r->>'error' = 'rate_limited' then limited := true; end if;
  end loop;
  reset role;
  update public.app_settings set value = '60'::jsonb where key = 'rate_save_10min';
  if not limited then raise exception 'FAIL: rate limit never triggered'; end if;
  raise notice 'PASS 9: rate limit triggers';
end $$;

-- ---------------------------------------------------------------------------
rollback;  -- هیچ‌چیز ذخیره نمی‌شود

-- ============================================================================
--  آزمون دستی هم‌زمانی (دو تب SQL Editor، دو اتصال جدا):
--  ۱) یک کاربر با free_used = 4 بسازید (۱ فاکتور رایگان باقی).
--  ۲) در تب اول:  begin; select * from profiles where id = '<uid>' for update;  (و صبر کنید)
--  ۳) در تب دوم save_invoice را با شناسه و request_id متفاوت اجرا کنید؛ باید منتظر قفل بماند.
--  ۴) در تب اول save_invoice را اجرا و commit کنید؛ تب دوم باید quota_exceeded برگرداند، نه موفقیت.
--  ۵) free_used نباید از 5 بیشتر شود.
-- ============================================================================
