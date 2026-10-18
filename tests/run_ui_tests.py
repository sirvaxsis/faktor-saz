#!/usr/bin/env python3
"""
آزمون‌های مرورگریِ فرانت‌اند حساب‌محور، روی سرور شبیه‌ساز (mock_supabase.py).
نیازمندی: pip install playwright flask requests  و  playwright install chromium
اجرا:     python3 run_ui_tests.py
⚠️ این آزمون‌ها «رفتار مرورگر و قرارداد API» را می‌سنجند؛ درستی SQL/RLS واقعی را نه (برای آن tests/004_tests.sql).
"""
import json, os, re, shutil, subprocess, sys, tempfile, threading, time, urllib.request, urllib.error
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(HERE, '..', 'site')
MOCK, WEB = 8790, 8791
MOCK_URL, WEB_URL = f'http://127.0.0.1:{MOCK}', f'http://127.0.0.1:{WEB}'
ANON = 'test-anon-key'
RESULTS = []
LAST = {'modal': ''}


def check(name, cond, detail=''):
    RESULTS.append({'name': name, 'ok': bool(cond), 'detail': str(detail)[:300]})
    print(('PASS ' if cond else 'FAIL ') + name + ('' if cond else '  -> ' + str(detail)[:300]), flush=True)


def call(path, method='GET', body=None, token=None, headers=None):
    req = urllib.request.Request(MOCK_URL + path, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header('apikey', ANON)
    req.add_header('Authorization', 'Bearer ' + (token or ANON))
    req.add_header('Content-Type', 'application/json')
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            t = r.read().decode()
            return r.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        t = e.read().decode()
        try:
            return e.code, json.loads(t)
        except Exception:
            return e.code, t


def api_user(email, pw='password123', confirm=True):
    call('/auth/v1/signup', 'POST', {'email': email, 'password': pw})
    if confirm:
        call('/mock/confirm?email=' + email)
    s, j = call('/auth/v1/token?grant_type=password', 'POST', {'email': email, 'password': pw})
    return j['access_token'] if s == 200 else None


def mstate(email):
    return call('/mock/state?email=' + email)[1]


def start_servers():
    tmp = tempfile.mkdtemp(prefix='cloudsite_')
    dst = os.path.join(tmp, 'site')
    shutil.copytree(SITE, dst)
    with open(os.path.join(dst, 'cloud-config.js'), 'w') as f:
        f.write("window.CLOUD_CONFIG = { supabaseUrl: '%s', anonKey: '%s', siteUrl: '', captcha: {provider:'',siteKey:''}, requireLoginOnStart: true };" % (MOCK_URL, ANON))
    p1 = subprocess.Popen([sys.executable, os.path.join(HERE, 'mock_supabase.py'), str(MOCK)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    p2 = subprocess.Popen([sys.executable, '-m', 'http.server', str(WEB), '--bind', '127.0.0.1'], cwd=dst, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try:
            urllib.request.urlopen(WEB_URL + '/index.html', timeout=1)
            urllib.request.urlopen(MOCK_URL + '/mock/reset', timeout=1)
            break
        except Exception:
            time.sleep(0.2)
    return [p1, p2], dst


def newpage(browser, **kw):
    ctx = browser.new_context(viewport={'width': 1100, 'height': 900}, **kw)
    pg = ctx.new_page()
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))

    def on_dialog(d):
        if d.type == 'prompt':
            d.accept('دلیل آزمایشی')
        else:
            d.accept()
    pg.on('dialog', on_dialog)
    pg._errors = errors
    return ctx, pg


def modal_open(pg):
    return pg.evaluate("document.getElementById('cloudOverlay') && document.getElementById('cloudOverlay').classList.contains('open')")


def ui_login(pg, email, pw='password123', signup=False):
    pg.wait_for_selector('#clEmail', timeout=8000)
    if signup:
        pg.click('[data-act=tab-signup]')
    pg.fill('#clEmail', email)
    pg.fill('#clPass', pw)
    pg.click('[data-act=submit]')


def wait_logged(pg, timeout=12000):
    pg.wait_for_function("window.Cloud && Cloud.loggedIn() && Cloud.verified()", timeout=timeout)
    pg.wait_for_timeout(700)


def goto_app(pg):
    pg.goto(WEB_URL + '/index.html')
    pg.wait_for_timeout(900)


def pick_job(pg):
    if pg.evaluate("document.getElementById('jobOverlay') && document.getElementById('jobOverlay').classList.contains('open')"):
        pg.click('#jobGrid [data-job=ac]')
        pg.wait_for_timeout(300)


def make_invoice(pg, tag):
    pg.click('#newInvoiceBtn')
    pg.wait_for_timeout(150)
    pg.fill('#custName', 'مشتری ' + tag)
    pg.fill('#custPhone', '0912' + str(abs(hash(tag)) % 10**7).zfill(7))
    pg.fill('.item-row .it-desc', 'سرویس ' + tag)
    pg.fill('.item-row .it-price', '1000')
    pg.click('#shareBtn')
    t0 = time.time()
    while time.time() - t0 < 10:
        if pg.evaluate("document.getElementById('shareOverlay').classList.contains('open')"):
            pg.keyboard.press('Escape')
            pg.wait_for_timeout(150)
            return 'ok'
        if modal_open(pg):
            txt = pg.inner_text('#cloudCard')
            LAST['modal'] = txt
            kind = 'paywall' if 'اشتراک یا بسته لازم است' in txt else ('auth' if pg.query_selector('#clEmail') else 'modal')
            pg.keyboard.press('Escape')
            pg.wait_for_timeout(150)
            return kind
        pg.wait_for_timeout(150)
    return 'timeout'


def local_count(pg, key='inv_records'):
    return pg.evaluate("(JSON.parse(localStorage.getItem('%s') || '[]')).length" % key)


def main():
    procs, site_dir = start_servers()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            run(browser)
            browser.close()
    finally:
        for pr in procs:
            pr.terminate()
    ok = sum(1 for r in RESULTS if r['ok'])
    print('\n=== %d/%d passed ===' % (ok, len(RESULTS)))
    with open(os.path.join(HERE, 'RESULTS.json'), 'w', encoding='utf-8') as f:
        json.dump(RESULTS, f, ensure_ascii=False, indent=1)
    return 0 if ok == len(RESULTS) else 1


def run(browser):
    A = 'alice@test.local'
    # ---------------------------------------------------------------- 1) ثبت‌نام، تأیید ایمیل، ورود، خروج
    ctx, pg = newpage(browser)
    goto_app(pg); pick_job(pg); pg.wait_for_timeout(1000)
    check('1a: guest sees the auth modal on start (after choosing a job)', modal_open(pg))
    ui_login(pg, A, signup=True)
    pg.wait_for_function("document.getElementById('clMsg') && document.getElementById('clMsg').textContent.includes('حساب ساخته شد')", timeout=6000)
    check('1b: signup shows "confirm your email" message', True)
    pg.click('[data-act=tab-signin]'); ui_login(pg, A)
    pg.wait_for_function("document.getElementById('clMsg') && document.getElementById('clMsg').textContent.length > 3 && !document.getElementById('clMsg').textContent.includes('صبر کنید')", timeout=6000)
    msg = pg.inner_text('#clMsg')
    check('1c: login refused before email confirmation', 'تأیید نشده' in msg or 'تأیید' in msg, msg)
    call('/mock/confirm?email=' + A)
    pg.click('[data-act=submit]')
    wait_logged(pg)
    pg.wait_for_timeout(1500)  # reload پس از اتصال حساب به مرورگر
    check('1d: login after confirmation works', pg.evaluate("Cloud.loggedIn()"))
    chip = pg.inner_text('#cloudChip')
    check('1e: chip shows 5 free invoices', '5' in chip or '۵' in chip, chip)

    # ---------------------------------------------------------------- 2/3) پنج فاکتور و فاکتور ششم
    results = []
    for i in range(1, 6):
        results.append(make_invoice(pg, 'A%d' % i))
    check('2a: five invoices created', results == ['ok'] * 5, results)
    st = mstate(A)
    check('2b: server free_used = 5 and 5 invoices stored', st['profile']['free_used'] == 5 and len(st['invoices']) == 5, st['profile'])
    check('2c: local cache has the 5 server invoices', local_count(pg) == 5, local_count(pg))
    r6 = make_invoice(pg, 'A6')
    check('3a: 6th invoice blocked and paywall shown', r6 == 'paywall', r6)
    st = mstate(A)
    check('3b: 6th invoice was NOT stored and quota unchanged', len(st['invoices']) == 5 and st['profile']['free_used'] == 5, st['invoices'])
    check('3c: nothing extra in local cache after rejection', local_count(pg) == 5, local_count(pg))

    # ---------------------------------------------------------------- 4/5) مرورگر ناشناس و دستگاه دوم
    ctx2, pg2 = newpage(browser)
    goto_app(pg2); pick_job(pg2)
    ui_login(pg2, A)
    wait_logged(pg2)
    pg2.wait_for_function("(JSON.parse(localStorage.getItem('inv_records')||'[]')).length === 5", timeout=15000)
    check('4a: second device/incognito sees the same 5 invoices', True)
    r6b = make_invoice(pg2, 'B6')
    check('4b: quota is per account — 6th still blocked on the other device', r6b == 'paywall', r6b)

    # ---------------------------------------------------------------- 6) پاک‌کردن داده‌های مرورگر و ورود دوباره
    pg2.evaluate("localStorage.clear(); sessionStorage.clear();")
    ctx2.clear_cookies()
    goto_app(pg2); pick_job(pg2)
    check('6a: after clearing site data the app asks to sign in', modal_open(pg2) and local_count(pg2) == 0)
    ui_login(pg2, A); wait_logged(pg2)
    pg2.wait_for_function("(JSON.parse(localStorage.getItem('inv_records')||'[]')).length === 5", timeout=15000)
    check('6b: invoices come back after re-login', True)
    r6c = make_invoice(pg2, 'C6')
    check('6c: clearing browser data did NOT reset the free quota', r6c == 'paywall', r6c)
    ctx2.close()

    # ---------------------------------------------------------------- 7/8) دور زدن مستقیم API، حساب دیگر
    tokA = pg.evaluate("JSON.parse(localStorage.getItem('inv_cloud_session')).access_token")
    outs = []
    for i in range(3):
        s, j = call('/rest/v1/rpc/save_invoice', 'POST', {'p_id': 'direct-bypass-%d-xxxxxxxx' % i, 'p_data': {'invNumber': str(900 + i), 'custName': 'Hack'}, 'p_request_id': '00000000-0000-4000-8000-00000000000%d' % i}, token=tokA)
        outs.append(j.get('error'))
    check('7a: direct API call cannot bypass the quota', outs == ['quota_exceeded'] * 3, outs)
    s, j = call('/rest/v1/rpc/save_invoice', 'POST', {'p_id': 'x', 'p_data': {}, 'p_request_id': '00000000-0000-4000-8000-0000000000aa'})
    check('7b: anonymous call to save_invoice is refused', s == 401, s)
    tokB = api_user('bob@test.local')
    s, rows = call('/rest/v1/invoices?select=id', token=tokB)
    check('8a: another account cannot read A\'s invoices (REST)', s == 200 and rows == [], rows)
    s, j = call('/rest/v1/rpc/delete_invoice', 'POST', {'p_id': mstate(A)['invoices'][0]}, token=tokB)
    check('8b: another account cannot delete A\'s invoice', j.get('error') == 'not_found' and len(mstate(A)['invoices']) == 5, j)
    s, j = call('/rest/v1/rpc/admin_find_user', 'POST', {'p_query': 'alice'}, token=tokB)
    check('8c: non-admin cannot call admin functions', s == 403, s)

    # ---------------------------------------------------------------- 9) هم‌زمانی
    C = 'carol@test.local'
    tokC = api_user(C)
    call('/mock/config', 'POST', {'save_delay': 0.15})
    for i in range(4):
        call('/rest/v1/rpc/save_invoice', 'POST', {'p_id': 'carol-seq-%d-xxxxxxxx' % i, 'p_data': {'invNumber': str(i), 'custName': 'c'}, 'p_request_id': '10000000-0000-4000-8000-00000000000%d' % i}, token=tokC)
    res = []
    def worker(i):
        s, j = call('/rest/v1/rpc/save_invoice', 'POST', {'p_id': 'carol-par-%d-xxxxxxxx' % i, 'p_data': {'invNumber': 'p%d' % i, 'custName': 'c'}, 'p_request_id': '20000000-0000-4000-8000-00000000000%d' % i}, token=tokC)
        res.append(j.get('ok'))
    th = [threading.Thread(target=worker, args=(i,)) for i in range(5)]
    [t.start() for t in th]; [t.join() for t in th]
    call('/mock/config', 'POST', {'save_delay': 0})
    st = mstate(C)
    check('9: 5 parallel requests for the last free invoice → exactly 1 succeeds, free_used = 5', res.count(True) == 1 and st['profile']['free_used'] == 5 and len(st['invoices']) == 5, (res, st['profile']))
    # تکرار همان request_id مصرف دوباره ندارد
    s, j1 = call('/rest/v1/rpc/save_invoice', 'POST', {'p_id': 'carol-idem-xxxxxxxx', 'p_data': {'invNumber': 'i', 'custName': 'c'}, 'p_request_id': '30000000-0000-4000-8000-000000000001'}, token=tokB)
    s, j2 = call('/rest/v1/rpc/save_invoice', 'POST', {'p_id': 'carol-idem-xxxxxxxx', 'p_data': {'invNumber': 'i', 'custName': 'c'}, 'p_request_id': '30000000-0000-4000-8000-000000000001'}, token=tokB)
    check('9b: replaying the same request id does not consume quota twice', j1.get('ok') and j2 == j1 and mstate('bob@test.local')['profile']['free_used'] == 1, (j1, j2))
    # ویرایش سهمیه مصرف نمی‌کند ولی «ویرایشِ» تغییردهندهٔ ماهیت فاکتور جدید حساب می‌شود
    inv0 = mstate('bob@test.local')['invoices'][0]
    s, j = call('/rest/v1/rpc/save_invoice', 'POST', {'p_id': inv0, 'p_data': {'invNumber': 'i', 'custName': 'c', 'total': 5}, 'p_request_id': '30000000-0000-4000-8000-000000000002', 'p_base_rev': 1}, token=tokB)
    check('9c: a plain edit does not consume quota', j.get('ok') and not j.get('is_new') and mstate('bob@test.local')['profile']['free_used'] == 1, j)
    s, j = call('/rest/v1/rpc/save_invoice', 'POST', {'p_id': inv0, 'p_data': {'invNumber': '999', 'custName': 'Totally other', 'custPhone': '0999'}, 'p_request_id': '30000000-0000-4000-8000-000000000003'}, token=tokB)
    check('9d: an "edit" that changes number+customer is treated as a NEW invoice (original kept)', j.get('ok') and j.get('forked') and j['id'] != inv0 and mstate('bob@test.local')['profile']['free_used'] == 2, j)

    # ---------------------------------------------------------------- 10) خطای شبکه هنگام ذخیره، پاسخ گم‌شده، نشست منقضی
    D = 'dave@test.local'
    api_user(D)
    ctx3, pg3 = newpage(browser)
    goto_app(pg3); pick_job(pg3)
    ui_login(pg3, D); wait_logged(pg3); pg3.wait_for_timeout(1500)
    check('10a: first invoice for D', make_invoice(pg3, 'D1') == 'ok')
    ctx3.set_offline(True)
    r = make_invoice(pg3, 'D2-offline')
    ctx3.set_offline(False)
    st = mstate(D)
    check('10b: offline save fails cleanly (no local record, no quota consumed)', r != 'ok' and st['profile']['free_used'] == 1 and local_count(pg3) == 1, (r, st['profile'], local_count(pg3)))
    call('/mock/fail_next_response')
    r = make_invoice(pg3, 'D3-lostresp')
    st = mstate(D)
    check('10c: response lost after server commit → retry is idempotent (exactly +1 consumed)', r == 'ok' and st['profile']['free_used'] == 2 and len(st['invoices']) == 2, (r, st['profile']))
    call('/mock/expire_access?email=' + D)
    r = make_invoice(pg3, 'D4-refresh')
    check('10d: expired access token is refreshed transparently', r == 'ok' and mstate(D)['profile']['free_used'] == 3, r)
    call('/mock/revoke_refresh?email=' + D)
    r = make_invoice(pg3, 'D5-expired')
    txt = LAST['modal']
    check('10e: fully expired session asks to sign in again and saves nothing', r == 'auth' and mstate(D)['profile']['free_used'] == 3 and 'منقضی' in txt, (r, txt[:120]))
    ctx3.close()

    # ---------------------------------------------------------------- 11) خرید دستی و پنل مدیریت
    M = 'admin@test.local'
    api_user(M); call('/mock/admin?email=' + M)
    ctxa, pga = newpage(browser)
    pga.goto(WEB_URL + '/admin.html'); pga.wait_for_timeout(600)
    pga.fill('#email', M); pga.fill('#pass', 'password123'); pga.click('#loginBtn')
    pga.wait_for_selector('#q', state='visible', timeout=8000)
    check('11a: admin can log in to the admin page', True)
    pga.fill('#q', 'alice'); pga.click('#findBtn'); pga.wait_for_selector('[data-open]', timeout=6000)
    pga.click('[data-open]'); pga.wait_for_selector('#payBtn', timeout=6000)
    pga.select_option('#payPlan', 'pack_5'); pga.fill('#payAmount', '25000'); pga.fill('#payRef', 'REC-777'); pga.click('#payBtn')
    pga.wait_for_selector('[data-approve]', timeout=6000)
    pga.click('[data-approve]'); pga.wait_for_timeout(800)
    stA = mstate(A)
    check('11b: payment recorded + approved from the admin page → pack of 5 active', stA['quota']['pack_left'] == 5, stA['quota'])
    pid = [x for x in call('/rest/v1/rpc/admin_user_overview', 'POST', {'p_user': stA['id']}, token=api_user(M))[1]['payments']][0]['id']
    tokM = api_user(M)
    s, j = call('/rest/v1/rpc/admin_approve_payment', 'POST', {'p_payment': pid}, token=tokM)
    check('11c: approving the same payment twice is refused', s == 400 and 'not_pending' in json.dumps(j), (s, j))
    s, j = call('/rest/v1/rpc/admin_record_payment', 'POST', {'p_user': stA['id'], 'p_plan': 'pack_5', 'p_amount_text': '1', 'p_channel': 'x', 'p_receipt_ref': 'rec-777', 'p_note': ''}, token=tokM)
    check('11d: the same receipt cannot be recorded twice', s == 409, (s, j))
    pg.evaluate("Cloud.flush(); null"); pg.click('#cloudChip'); pg.wait_for_selector('[data-act=syncnow]'); pg.click('[data-act=syncnow]'); pg.wait_for_timeout(1500); pg.keyboard.press('Escape')
    r = make_invoice(pg, 'A6-after-purchase')
    st = mstate(A)
    check('11e: after purchase the user can create invoices again (pack decremented)', r == 'ok' and st['quota']['pack_left'] == 4 and len(st['invoices']) == 6, (r, st['quota']))
    pga.fill('#q', 'alice'); pga.click('#findBtn'); pga.wait_for_selector('[data-open]'); pga.click('[data-open]'); pga.wait_for_selector('[data-cancel]', timeout=6000)
    pga.click('[data-cancel]'); pga.wait_for_timeout(900)
    st = mstate(A)
    check('11f: cancelling the pack removes access immediately', st['quota']['pack_left'] == 0, st['quota'])
    r = make_invoice(pg, 'A7-after-cancel')
    check('11g: after cancellation the user is back to the free rules (blocked)', r == 'paywall' and len(mstate(A)['invoices']) == 6, r)
    check('11h: admin actions are audited', len([a for a in call('/rest/v1/rpc/admin_user_overview', 'POST', {'p_user': stA['id']}, token=tokM)[1]['audit']]) >= 3)
    ctxa.close()

    # ---------------------------------------------------------------- 12/13) مهاجرت داده‌های قدیمی
    F = 'frank@test.local'
    api_user(F)
    ctx4, pg4 = newpage(browser)
    goto_app(pg4); pick_job(pg4)
    legacy = [{'id': '1700000000%03d-abcde%d' % (i, i), 'invNumber': str(1000 + i), 'custName': 'قدیمی %d' % i, 'custPhone': '0912', 'items': [{'description': 'x', 'qty': 1, 'unitPrice': 10}], 'total': 10, 'savedAt': 1700000000000 + i} for i in range(3)]
    pg4.evaluate("(l) => { localStorage.setItem('inv_records', JSON.stringify(l)); localStorage.setItem('inv_companyName', 'شرکت قدیمی من'); }", legacy)
    pg4.reload(); pg4.wait_for_timeout(700)
    ui_login(pg4, F); wait_logged(pg4)
    pg4.wait_for_selector('[data-act=runmigrate]', timeout=15000)
    check('12a: migration dialog is offered when old local invoices exist', True)
    check('12b: old local data is kept safely before anything is moved', local_count(pg4, 'inv_legacy_records') == 3, local_count(pg4, 'inv_legacy_records'))
    pg4.click('[data-act=runmigrate]')
    pg4.wait_for_function("document.getElementById('clMsg').textContent.includes('انتقال تمام شد')", timeout=10000)
    st = mstate(F)
    check('12c: 3 invoices migrated, no quota used', len(st['invoices']) == 3 and st['profile']['free_used'] == 0, st['profile'])
    pg4.click('[data-act=runmigrate]')
    pg4.wait_for_function("document.getElementById('clMsg').textContent.includes('0 فاکتور')", timeout=10000)
    check('12d: running migration again creates no duplicates', len(mstate(F)['invoices']) == 3)
    check('12e: legacy copy still on device after migration (never auto-deleted)', local_count(pg4, 'inv_legacy_records') == 3)
    pg4.wait_for_function("(JSON.parse(localStorage.getItem('inv_records')||'[]')).length === 3", timeout=10000)
    check('12f: migrated invoices appear in the app', True)
    backup = {'app': 'invoice-generator-ac', 'version': 1, 'data': {'inv_records': json.dumps([{'id': 'restore-legacy-0001', 'invNumber': '5', 'custName': 'از بکاپ', 'items': [], 'total': 1, 'savedAt': 1700000009999}]), 'inv_companyName': 'شرکت از بکاپ'}}
    open('/tmp/_backup.json', 'w', encoding='utf-8').write(json.dumps(backup, ensure_ascii=False))
    pg4.keyboard.press('Escape')
    pg4.set_input_files('#restoreFileInput', '/tmp/_backup.json')
    pg4.wait_for_timeout(2500)
    pg4.wait_for_selector('[data-act=runmigrate]', timeout=15000)
    check('13a: restoring a backup in cloud mode goes through the migration path', local_count(pg4, 'inv_legacy_records') == 1 and len(mstate(F)['invoices']) == 3)
    pg4.click('[data-act=runmigrate]'); pg4.wait_for_function("document.getElementById('clMsg').textContent.includes('انتقال تمام شد')", timeout=10000)
    check('13b: backup invoices imported without duplicates', len(mstate(F)['invoices']) == 4)
    # تنظیمات: لوگو/نام شرکت همگام می‌شود
    pg4.wait_for_timeout(3500)
    srv = call('/rest/v1/profiles?select=settings,settings_rev', token=api_user(F))[1][0]
    check('13c: company settings are stored in the account', 'inv_companyName' in srv['settings'], list(srv['settings'].keys())[:5])

    # ---------------------------------------------------------------- 14) خروج: پاک‌شدن کش و جداسازی حساب‌ها
    pg4.keyboard.press('Escape')
    pg4.click('#cloudChip'); pg4.wait_for_selector('[data-act=signout]'); pg4.click('[data-act=signout]'); pg4.wait_for_timeout(1500)
    left = pg4.evaluate("({rec: localStorage.getItem('inv_records'), name: localStorage.getItem('inv_companyName'), sess: localStorage.getItem('inv_cloud_session'), owner: localStorage.getItem('inv_cloud_owner')})")
    check('14a: sign-out wipes the cached invoices, settings and session', left['sess'] is None and (left['rec'] in (None, '[]')) and left['name'] is None and left['owner'] is None, left)
    check('14b: legacy device copy is still there after sign-out', local_count(pg4, 'inv_legacy_records') >= 1)
    api_user('gina@test.local')
    pick_job(pg4)
    ui_login(pg4, 'gina@test.local'); wait_logged(pg4); pg4.wait_for_timeout(1500)
    check('14c: a different account on the same browser sees none of the previous account data', local_count(pg4) == 0 and len(mstate('gina@test.local')['invoices']) == 0)
    ctx4.close()

    # ---------------------------------------------------------------- 15) PWA/کش و اسرار
    cache_info = pg.evaluate("""async () => { const regs = await navigator.serviceWorker.getRegistrations(); const keys = await caches.keys(); let urls = []; for(const k of keys){ const c = await caches.open(k); urls = urls.concat((await c.keys()).map(r => r.url)); } return { regs: regs.length, keys, urls }; }""")
    check('15a: service worker registered, cache is versioned', cache_info['regs'] >= 1 and any(k.startswith('factor-v14') for k in cache_info['keys']), cache_info['keys'])
    check('15b: API/auth responses are never cached by the service worker', not any(':%d' % MOCK in u for u in cache_info['urls']), [u for u in cache_info['urls'] if ':%d' % MOCK in u][:3])
    bad = []
    for root, _, files in os.walk(SITE):
        for fn in files:
            if fn.endswith(('.html', '.js', '.json', '.webmanifest')):
                t = open(os.path.join(root, fn), encoding='utf-8', errors='ignore').read()
                if fn.endswith('.js'):   # توضیحات (comment) که فقط «اسرار را اینجا نگذارید» می‌گویند خطا نیستند
                    t = re.sub(r'/\*.*?\*/', '', t, flags=re.S)
                    t = '\n'.join(l for l in t.split('\n') if not l.strip().startswith('//'))
                for pat in (r'service_role', r'sb_secret_', r'SUPABASE_SERVICE', r'postgres://', r'-----BEGIN [A-Z ]*PRIVATE KEY', r'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}'):
                    if re.search(pat, t):
                        bad.append((fn, pat))
    check('15c: no secret keys / private keys / JWTs in the public site files', not bad, bad)
    check('15d: license-generator.html (private) is not inside the public site folder', not os.path.exists(os.path.join(SITE, 'license-generator.html')))
    errs = pg._errors + [e for e in []]
    check('16: no uncaught JavaScript errors on the main page', not errs, errs[:3])
    ctx.close()


if __name__ == '__main__':
    sys.exit(main())
