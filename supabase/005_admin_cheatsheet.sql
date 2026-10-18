-- ============================================================================
--  برگهٔ تقلب مدیر برای SQL Editor (اجرا با نقش postgres؛ auth.uid() ندارد)
--  توابع admin_* در SQL Editor کار نمی‌کنند (forbidden)؛ این‌ها معادل مستقیم‌اند.
--  همیشه <UID> و ایمیل را جایگزین کنید. عملیات تغییردهنده را در admin_audit ثبت کنید.
-- ============================================================================

-- پیدا کردن کاربر و وضعیت سهمیه
select u.id, u.email, u.email_confirmed_at, p.free_used, p.blocked, public._quota_state(u.id) as state
  from auth.users u join public.profiles p on p.id = u.id
 where u.email ilike '%کاربر@example.com%';

-- فعال‌سازی دستی یک پلن (معادل «ثبت پرداخت + تأیید»). plan_id: pack_5 | pack_20 | pack_50 | pack_100 | sub_30 | sub_365
do $$
declare v_uid uuid := '<UID>'; v_plan text := 'sub_30'; v_pay uuid; v_ent uuid;
begin
  insert into public.payments (user_id, plan_id, amount_text, channel, receipt_ref, note, status, approved_at)
  values (v_uid, v_plan, '<مبلغ>', 'telegram', '<شمارهٔ پیگیری یکتا>', 'manual via SQL', 'approved', now())
  returning id into v_pay;
  v_ent := public._grant_plan(v_uid, v_plan, v_pay, null, 'manual via SQL');
  update public.payments set entitlement_id = v_ent where id = v_pay;
  insert into public.admin_audit (admin_id, action, target_user, details, reason)
  values (null, 'grant_plan_sql', v_uid, jsonb_build_object('payment', v_pay, 'entitlement', v_ent, 'plan', v_plan), 'manual via SQL editor');
end $$;

-- لغو یک اشتراک/بسته
update public.entitlements
   set status = 'cancelled', cancelled_at = now(), cancel_reason = '<دلیل>',
       invoices_remaining = case when kind = 'pack' then 0 else invoices_remaining end,
       ends_at = case when kind = 'sub' then least(ends_at, now()) else ends_at end
 where id = '<ENTITLEMENT_ID>' and status = 'active';
insert into public.admin_audit (admin_id, action, target_user, details, reason)
values (null, 'cancel_entitlement_sql', '<UID>', jsonb_build_object('entitlement', '<ENTITLEMENT_ID>'), '<دلیل>');

-- مسدود / رفع مسدودی
update public.profiles set blocked = true, blocked_reason = '<دلیل>', blocked_at = now() where id = '<UID>';
update public.profiles set blocked = false, blocked_reason = null, blocked_at = null where id = '<UID>';

-- اصلاح سهمیهٔ رایگانِ مصرف‌شده (مثلاً اشتباه ثبت شده)
update public.profiles set free_used = 0 where id = '<UID>';

-- آخرین رویدادهای امنیتی و رد‌شدن‌های سهمیه
select * from public.security_events order by created_at desc limit 50;
-- کاربرانی با بیشترین مصرف سهمیه در ۲۴ ساعت اخیر
select user_id, count(*) from public.quota_events where created_at > now() - interval '1 day' group by 1 order by 2 desc limit 20;
-- حساب‌های تازه که فاکتور واردشده (import) زیاد دارند (برای بررسی سوءاستفاده)
select p.email, p.import_count, p.created_at from public.profiles p where p.import_count > 50 order by p.import_count desc;

-- مدیر جدید / حذف مدیر
insert into public.admins (user_id) select id from auth.users where email = '<ایمیل>';
delete from public.admins where user_id = '<UID>';
