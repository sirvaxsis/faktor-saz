#!/usr/bin/env python3
"""
سرور آزمایشیِ «Supabase نما» — فقط برای آزمایش فرانت‌اند (cloud.js / index.html / admin.html).

⚠️ این یک شبیه‌ساز است، نه Supabase واقعی و نه PostgreSQL:
   - قرارداد API را (مسیرهای GoTrue و PostgREST و ورودی/خروجی RPCها) مطابق supabase/002_functions.sql پیاده می‌کند
     تا بتوان رفتار مرورگر را (ورود، سهمیه، مهاجرت، دستگاه دوم، قطع شبکه، ...) آزمود.
   - درستیِ SQL و RLS واقعی را ثابت نمی‌کند؛ آن را با tests/004_tests.sql روی Supabase واقعی آزمایش کنید.
اجرا:  python3 mock_supabase.py [port]      (پیش‌فرض 8790)
"""
import json, re, sys, threading, time, uuid
from datetime import datetime, timedelta, timezone
from flask import Flask, request, jsonify, make_response

app = Flask(__name__)
ANON = 'test-anon-key'
G = threading.RLock()
USER_LOCKS = {}
users = {}            # email -> dict
by_id = {}
access = {}           # access token -> uid
refresh = {}          # refresh token -> uid
profiles = {}
invoices = {}         # (uid, id) -> dict
entitlements = []
payments = []
quota_events = {}     # (uid, request_id) -> dict
audit = []
security = []
admins = set()
devices = {}
SETTINGS = {'free_invoice_limit': 5, 'trash_days': 7, 'max_import_total': 200, 'max_invoice_bytes': 300000, 'max_devices': 0, 'rate_save': 1000}
PLANS = [
    {'id': 'pack_5', 'kind': 'pack', 'title': 'بستهٔ ۵ فاکتور', 'price_text': '۲۵,۰۰۰ تومان', 'invoices': 5, 'days': None, 'sort': 10},
    {'id': 'pack_20', 'kind': 'pack', 'title': 'بستهٔ ۲۰ فاکتور', 'price_text': '۹۰,۰۰۰ تومان', 'invoices': 20, 'days': None, 'sort': 20},
    {'id': 'sub_30', 'kind': 'sub', 'title': 'اشتراک ماهانه', 'price_text': '۱۵۰,۰۰۰ تومان', 'invoices': None, 'days': 30, 'sort': 50},
    {'id': 'sub_365', 'kind': 'sub', 'title': 'اشتراک سالانه', 'price_text': '۱,۲۰۰,۰۰۰ تومان', 'invoices': None, 'days': 365, 'sort': 60},
]
EXPIRED_ACCESS = set()
SAVE_DELAY = {'s': 0.0}
NET = {'fail_next_save_after_commit': False}


def now():
    return datetime.now(timezone.utc)


def iso(d):
    return d.isoformat().replace('+00:00', 'Z') if d else None


def lock_for(uid):
    with G:
        return USER_LOCKS.setdefault(uid, threading.RLock())


@app.after_request
def cors(r):
    r.headers['Access-Control-Allow-Origin'] = '*'
    r.headers['Access-Control-Allow-Headers'] = 'apikey, authorization, content-type, range, range-unit, prefer, x-client-info'
    r.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
    r.headers['Access-Control-Expose-Headers'] = 'content-range'
    return r


@app.route('/<path:_p>', methods=['OPTIONS'])
def opt(_p):
    return make_response('', 204)


def err(status, code, msg=None):
    return make_response(jsonify({'error_code': code, 'code': code, 'msg': msg or code, 'message': msg or code}), status)


def current_uid():
    h = request.headers.get('Authorization', '')
    tok = h.replace('Bearer ', '').strip()
    if tok == ANON or not tok:
        return None, 'anon'
    if tok in EXPIRED_ACCESS:
        return None, 'expired'
    return access.get(tok), 'ok'


def new_tokens(uid):
    a, r = 'acc-' + uuid.uuid4().hex, 'ref-' + uuid.uuid4().hex
    access[a] = uid
    refresh[r] = uid
    return {'access_token': a, 'refresh_token': r, 'expires_in': 3600, 'token_type': 'bearer',
            'user': {'id': uid, 'email': by_id[uid]['email']}}


# ------------------------------------------------------------------ Auth
@app.route('/auth/v1/signup', methods=['POST'])
def signup():
    b = request.get_json() or {}
    email, pw = (b.get('email') or '').strip().lower(), b.get('password') or ''
    if '@' not in email:
        return err(422, 'validation_failed', 'bad email')
    if len(pw) < 8:
        return err(422, 'weak_password', 'weak')
    with G:
        if email in users:
            return err(422, 'user_already_exists', 'User already registered')
        uid = str(uuid.uuid4())
        u = {'id': uid, 'email': email, 'password': pw, 'confirmed': False, 'created_at': now()}
        users[email] = u
        by_id[uid] = u
        profiles[uid] = {'free_used': 0, 'blocked': False, 'settings': {}, 'settings_rev': 0, 'import_count': 0, 'migrated_at': None}
    return jsonify({'id': uid, 'email': email})


@app.route('/auth/v1/token', methods=['POST'])
def token():
    gt = request.args.get('grant_type')
    b = request.get_json() or {}
    if gt == 'password':
        u = users.get((b.get('email') or '').strip().lower())
        if not u or u['password'] != b.get('password'):
            return err(400, 'invalid_credentials', 'Invalid login credentials')
        if not u['confirmed']:
            return err(400, 'email_not_confirmed', 'Email not confirmed')
        return jsonify(new_tokens(u['id']))
    if gt == 'refresh_token':
        uid = refresh.pop(b.get('refresh_token'), None)
        if not uid:
            return err(400, 'refresh_token_not_found', 'Invalid Refresh Token')
        return jsonify(new_tokens(uid))
    return err(400, 'bad_grant')


@app.route('/auth/v1/logout', methods=['POST'])
def logout():
    return make_response('', 204)


@app.route('/auth/v1/recover', methods=['POST'])
def recover():
    return jsonify({})


@app.route('/auth/v1/resend', methods=['POST'])
def resend():
    return jsonify({})


@app.route('/auth/v1/user', methods=['PUT'])
def put_user():
    uid, st = current_uid()
    if not uid:
        return err(401, 'bad_jwt')
    b = request.get_json() or {}
    if len(b.get('password') or '') < 8:
        return err(422, 'weak_password')
    by_id[uid]['password'] = b['password']
    return jsonify({'id': uid})


# --------------------------------------------------------------- test helpers
@app.route('/mock/confirm')
def m_confirm():
    u = users.get(request.args.get('email', '').lower())
    if u:
        u['confirmed'] = True
    return jsonify({'ok': bool(u), 'id': u and u['id']})


@app.route('/mock/admin')
def m_admin():
    u = users.get(request.args.get('email', '').lower())
    if u:
        admins.add(u['id'])
    return jsonify({'ok': bool(u)})


@app.route('/mock/expire_access')
def m_expire():
    u = users.get(request.args.get('email', '').lower())
    EXPIRED_ACCESS.update([t for t, uid in access.items() if u and uid == u['id']])
    return jsonify({'ok': True})


@app.route('/mock/revoke_refresh')
def m_revoke():
    u = users.get(request.args.get('email', '').lower())
    for t in [t for t, uid in refresh.items() if u and uid == u['id']]:
        refresh.pop(t, None)
    EXPIRED_ACCESS.update([t for t, uid in access.items() if u and uid == u['id']])
    return jsonify({'ok': True})


@app.route('/mock/state')
def m_state():
    u = users.get(request.args.get('email', '').lower())
    if not u:
        return jsonify({})
    uid = u['id']
    return jsonify({'id': uid, 'profile': profiles[uid], 'quota': quota_state(uid),
                    'invoices': [k[1] for k, v in invoices.items() if k[0] == uid and not v['deleted_at']],
                    'trash': [k[1] for k, v in invoices.items() if k[0] == uid and v['deleted_at']],
                    'events': [e['op'] for k, e in quota_events.items() if k[0] == uid], 'security': [e['kind'] for e in security if e['user'] == uid]})


@app.route('/mock/config', methods=['POST'])
def m_config():
    b = request.get_json() or {}
    SETTINGS.update(b.get('settings', {}))
    if 'save_delay' in b:
        SAVE_DELAY['s'] = float(b['save_delay'])
    return jsonify(SETTINGS)


@app.route('/mock/reset')
def m_reset():
    with G:
        for d in (users, by_id, access, refresh, profiles, invoices, quota_events, devices):
            d.clear()
        for l in (entitlements, payments, audit, security):
            l.clear()
        admins.clear()
        EXPIRED_ACCESS.clear()
        SETTINGS.update({'free_invoice_limit': 5, 'max_import_total': 200, 'max_devices': 0})
        SAVE_DELAY['s'] = 0
    return jsonify({'ok': True})


# ------------------------------------------------------------------- REST (RLS: only own rows)
@app.route('/rest/v1/invoices')
def rest_invoices():
    uid, st = current_uid()
    if not uid:
        return err(401, 'PGRST301', 'JWT expired' if st == 'expired' else 'no auth')
    rows = [(k[1], v) for k, v in invoices.items() if k[0] == uid]
    q = request.args
    if q.get('id', '').startswith('in.('):
        ids = set(re.findall(r'"([^"]*)"', q['id']))
        rows = [r for r in rows if r[0] in ids]
    rows.sort(key=lambda r: r[1]['updated_at'], reverse=True)
    rng = request.headers.get('Range', '')
    if re.match(r'^\d+-\d+$', rng):
        a, b = [int(x) for x in rng.split('-')]
        rows = rows[a:b + 1]
    out = []
    for iid, v in rows:
        out.append({'id': iid, 'data': v['data'], 'rev': v['rev'], 'deleted_at': iso(v['deleted_at']), 'updated_at': iso(v['updated_at']), 'source': v['source']})
    return jsonify(out)


@app.route('/rest/v1/profiles')
def rest_profiles():
    uid, st = current_uid()
    if not uid:
        return err(401, 'PGRST301', 'no auth')
    p = profiles[uid]
    return jsonify([{'id': uid, 'settings': p['settings'], 'settings_rev': p['settings_rev']}])


@app.route('/rest/v1/plans')
def rest_plans():
    uid, st = current_uid()
    if not uid:
        return err(401, 'PGRST301', 'no auth')
    return jsonify(PLANS)


# ------------------------------------------------------------------- business logic (mirror of 002_functions.sql)
def digits(t):
    t = (t or '')
    t = t.translate(str.maketrans('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'))
    return re.sub(r'[^0-9]', '', t)


def looks_like_new(o, n):
    if (o.get('docType') or 'invoice') == (n.get('docType') or 'invoice') and digits(o.get('invNumber')) != digits(n.get('invNumber')):
        return True
    same_name = (o.get('custName') or '').strip() == (n.get('custName') or '').strip()
    same_phone = digits(o.get('custPhone')) == digits(n.get('custPhone'))
    if not same_name and not same_phone:
        return True
    od = [(i.get('description') or '').strip() for i in (o.get('items') or []) if (i.get('description') or '').strip()]
    nd = [(i.get('description') or '').strip() for i in (n.get('items') or []) if (i.get('description') or '').strip()]
    if od:
        kept = len([d for d in od if d in nd])
        if kept < len(od) / 2.0:
            return True
    return False


def quota_state(uid):
    t = now()
    p = profiles[uid]
    subs = [e for e in entitlements if e['user'] == uid and e['kind'] == 'sub' and e['status'] == 'active' and e['ends_at'] > t]
    sub_now = [e for e in subs if e['starts_at'] <= t]
    packs = [e for e in entitlements if e['user'] == uid and e['kind'] == 'pack' and e['status'] == 'active']
    lim = SETTINGS['free_invoice_limit']
    return {'free_limit': lim, 'free_used': p['free_used'], 'free_left': max(lim - p['free_used'], 0), 'sub_active': bool(sub_now),
            'sub_ends_at': iso(max([e['ends_at'] for e in subs])) if subs else None, 'pack_left': sum(e['remaining'] for e in packs),
            'paid': bool(sub_now) or bool(packs), 'blocked': p['blocked']}


def fail(code, **extra):
    d = {'ok': False, 'error': code}
    d.update(extra)
    return d


def clean(d):
    d = dict(d)
    d.pop('_rev', None)
    d.pop('deletedAt', None)
    return d


def grant_plan(uid, plan_id, payment_id, by):
    plan = next(p for p in PLANS if p['id'] == plan_id)
    t = now()
    if plan['kind'] == 'pack':
        e = {'id': str(uuid.uuid4()), 'user': uid, 'kind': 'pack', 'plan_id': plan_id, 'status': 'active', 'total': plan['invoices'], 'remaining': plan['invoices'], 'starts_at': None, 'ends_at': None, 'created_at': t}
    else:
        start = max([t] + [x['ends_at'] for x in entitlements if x['user'] == uid and x['kind'] == 'sub' and x['status'] == 'active' and x['ends_at'] > t])
        e = {'id': str(uuid.uuid4()), 'user': uid, 'kind': 'sub', 'plan_id': plan_id, 'status': 'active', 'starts_at': start, 'ends_at': start + timedelta(days=plan['days']), 'total': None, 'remaining': None, 'created_at': t}
    entitlements.append(e)
    return e['id']


def rpc_get_account(uid, a):
    u = by_id[uid]
    return {'ok': True, 'id': uid, 'email': u['email'], 'email_confirmed': u['confirmed'], 'is_admin': uid in admins, 'state': quota_state(uid),
            'settings_rev': profiles[uid]['settings_rev'], 'migrated': bool(profiles[uid]['migrated_at']),
            'import_allowance': max(SETTINGS['max_import_total'] - profiles[uid]['import_count'], 0), 'trash_days': 7, 'max_devices': SETTINGS['max_devices'], 'server_time': iso(now()),
            'entitlements': [{'id': e['id'], 'kind': e['kind'], 'plan_id': e['plan_id'], 'status': e['status'], 'starts_at': iso(e['starts_at']), 'ends_at': iso(e['ends_at']), 'invoices_total': e['total'], 'invoices_remaining': e['remaining']} for e in reversed([x for x in entitlements if x['user'] == uid])]}


def rpc_save_invoice(uid, a):
    pid, data, rid = a.get('p_id'), a.get('p_data'), a.get('p_request_id')
    if not pid or len(pid) < 8 or len(pid) > 80 or not rid:
        return fail('bad_request')
    if not isinstance(data, dict):
        return fail('bad_data')
    with lock_for(uid):                      # = SELECT ... FOR UPDATE على profiles
        if SAVE_DELAY['s']:
            time.sleep(SAVE_DELAY['s'])
        p = profiles[uid]
        if p['blocked']:
            security.append({'user': uid, 'kind': 'blocked_save_attempt'})
            return fail('blocked')
        if not by_id[uid]['confirmed']:
            return fail('email_not_confirmed')
        if len(json.dumps(data)) > SETTINGS['max_invoice_bytes']:
            return fail('too_large')
        if SETTINGS['max_devices'] > 0 and (a.get('p_device_id') not in devices.get(uid, {})):
            return fail('device_not_registered')
        prev = quota_events.get((uid, rid))
        if prev:
            return prev['result'] if prev['invoice_id'] == pid else fail('request_reuse')
        st = quota_state(uid)
        ex = invoices.get((uid, pid))
        is_new, forked, target, op, ent_id = False, False, pid, None, None
        if ex:
            if ex['deleted_at']:
                return fail('invoice_deleted')
            if a.get('p_base_rev') is not None and a['p_base_rev'] != ex['rev']:
                return fail('stale_revision', server_rev=ex['rev'])
            if not st['sub_active'] and looks_like_new(ex['data'], data):
                is_new, forked, target = True, True, str(uuid.uuid4())
        else:
            is_new = True
        if is_new:
            if st['sub_active']:
                op = 'consume_sub'
            elif p['free_used'] < SETTINGS['free_invoice_limit']:
                p['free_used'] += 1
                op = 'consume_free'
            else:
                pk = next((e for e in sorted(entitlements, key=lambda x: x['created_at']) if e['user'] == uid and e['kind'] == 'pack' and e['status'] == 'active' and e['remaining'] > 0), None)
                if pk:
                    pk['remaining'] -= 1
                    ent_id = pk['id']
                    op = 'consume_pack'
                else:
                    security.append({'user': uid, 'kind': 'quota_exceeded'})
                    return fail('quota_exceeded', state=quota_state(uid))
        d = clean(data)
        d['id'] = target
        t = now()
        if is_new:
            invoices[(uid, target)] = {'data': d, 'rev': 1, 'deleted_at': None, 'updated_at': t, 'source': 'app'}
        else:
            ex['data'], ex['rev'], ex['updated_at'] = d, ex['rev'] + 1, t
        inv = invoices[(uid, target)]
        res = {'ok': True, 'id': target, 'rev': inv['rev'], 'updated_at': iso(t), 'is_new': is_new, 'forked': forked, 'state': quota_state(uid)}
        if is_new:
            quota_events[(uid, rid)] = {'invoice_id': pid, 'op': op, 'result': res, 'ent': ent_id}
        if NET['fail_next_save_after_commit']:
            NET['fail_next_save_after_commit'] = False
            res['__drop'] = True
        return res


def rpc_simple_inv(uid, a, kind):
    iid = a.get('p_id')
    with lock_for(uid):
        inv = invoices.get((uid, iid))
        if kind == 'delete':
            if not inv or inv['deleted_at']:
                return fail('not_found')
            inv['deleted_at'], inv['rev'], inv['updated_at'] = now(), inv['rev'] + 1, now()
            return {'ok': True, 'rev': inv['rev']}
        if kind == 'restore':
            if not inv or not inv['deleted_at']:
                return fail('not_in_trash')
            inv['deleted_at'], inv['rev'], inv['updated_at'] = None, inv['rev'] + 1, now()
            return {'ok': True, 'rev': inv['rev']}
        if kind == 'purge':
            if inv and inv['deleted_at']:
                del invoices[(uid, iid)]
                return {'ok': True, 'deleted': 1}
            return {'ok': True, 'deleted': 0}


def rpc_import(uid, a):
    items = a.get('p_items')
    if not isinstance(items, list):
        return fail('bad_data')
    with lock_for(uid):
        p = profiles[uid]
        if not by_id[uid]['confirmed']:
            return fail('email_not_confirmed')
        allow = max(SETTINGS['max_import_total'] - p['import_count'], 0)
        if len(items) > allow:
            security.append({'user': uid, 'kind': 'import_limit'})
            return fail('import_limit', allowance=allow)
        ins = skp = 0
        for it in items:
            iid, d = it.get('id'), it.get('data')
            if not iid or len(iid) < 8 or not isinstance(d, dict) or (uid, iid) in invoices:
                skp += 1
                continue
            d = clean(d)
            d['id'] = iid
            invoices[(uid, iid)] = {'data': d, 'rev': 1, 'deleted_at': None, 'updated_at': now(), 'source': 'import'}
            ins += 1
        p['import_count'] += ins
        p['migrated_at'] = p['migrated_at'] or now()
        return {'ok': True, 'inserted': ins, 'skipped': skp}


def rpc_settings(uid, a):
    with lock_for(uid):
        p = profiles[uid]
        if a.get('p_base_rev') is not None and a['p_base_rev'] != p['settings_rev']:
            return fail('stale_settings', server_rev=p['settings_rev'])
        p['settings'], p['settings_rev'] = a['p_settings'], p['settings_rev'] + 1
        return {'ok': True, 'rev': p['settings_rev']}


def need_admin(uid):
    if uid not in admins:
        return err(403, '42501', 'forbidden')


def rpc_admin(uid, name, a):
    bad = need_admin(uid)
    if bad:
        return bad
    if name == 'admin_find_user':
        q = (a.get('p_query') or '').lower()
        if len(q) < 3:
            return err(400, 'P0001', 'query_too_short')
        return [{'id': u['id'], 'email': u['email'], 'created_at': iso(u['created_at']), 'email_confirmed': u['confirmed'], 'blocked': profiles[u['id']]['blocked'], 'free_used': profiles[u['id']]['free_used']} for u in users.values() if q in u['email'] or q == u['id']]
    if name == 'admin_user_overview':
        t = a['p_user']
        u = by_id[t]
        return {'user': {'id': t, 'email': u['email'], 'email_confirmed_at': iso(now()) if u['confirmed'] else None, 'created_at': iso(u['created_at']), 'last_sign_in_at': None},
                'profile': dict(profiles[t], migrated_at=iso(profiles[t]['migrated_at'])), 'state': quota_state(t),
                'invoice_counts': {'active': len([1 for k, v in invoices.items() if k[0] == t and not v['deleted_at']]), 'imported': len([1 for k, v in invoices.items() if k[0] == t and v['source'] == 'import']), 'trash': 0},
                'entitlements': [dict(id=e['id'], kind=e['kind'], plan_id=e['plan_id'], status=e['status'], starts_at=iso(e['starts_at']), ends_at=iso(e['ends_at']), invoices_total=e['total'], invoices_remaining=e['remaining']) for e in entitlements if e['user'] == t],
                'payments': [dict(id=x['id'], plan_id=x['plan_id'], amount_text=x['amount'], channel=x['channel'], receipt_ref=x['receipt'], status=x['status'], created_at=iso(x['created_at'])) for x in payments if x['user'] == t],
                'quota_events': [], 'security_events': [], 'audit': [x for x in audit if x['target'] == t], 'devices': []}
    if name == 'admin_record_payment':
        ref = (a.get('p_receipt_ref') or '').strip().lower()
        if ref and any(x['receipt'] == ref and x['status'] in ('pending', 'approved') for x in payments):
            return err(409, '23505', 'duplicate key value violates unique constraint "payments_receipt_uq"')
        pid = str(uuid.uuid4())
        payments.append({'id': pid, 'user': a['p_user'], 'plan_id': a['p_plan'], 'amount': a.get('p_amount_text'), 'channel': a.get('p_channel'), 'receipt': ref or None, 'status': 'pending', 'created_at': now()})
        audit.append({'target': a['p_user'], 'action': 'record_payment', 'details': {'payment': pid}, 'reason': a.get('p_note'), 'created_at': iso(now())})
        return {'ok': True, 'payment_id': pid}
    if name == 'admin_approve_payment':
        pay = next((x for x in payments if x['id'] == a['p_payment']), None)
        if not pay:
            return err(400, 'P0001', 'payment_not_found')
        with G:
            if pay['status'] != 'pending':
                return err(400, 'P0001', 'payment_not_pending')
            pay['status'] = 'approved'
            eid = grant_plan(pay['user'], pay['plan_id'], pay['id'], uid)
        audit.append({'target': pay['user'], 'action': 'approve_payment', 'details': {'payment': pay['id']}, 'reason': None, 'created_at': iso(now())})
        return {'ok': True, 'entitlement_id': eid}
    if name == 'admin_grant_plan':
        if not (a.get('p_reason') or '').strip():
            return err(400, 'P0001', 'reason_required')
        eid = grant_plan(a['p_user'], a['p_plan'], None, uid)
        audit.append({'target': a['p_user'], 'action': 'grant_plan', 'details': {'plan': a['p_plan']}, 'reason': a['p_reason'], 'created_at': iso(now())})
        return {'ok': True, 'entitlement_id': eid}
    if name == 'admin_cancel_entitlement':
        if not (a.get('p_reason') or '').strip():
            return err(400, 'P0001', 'reason_required')
        e = next(x for x in entitlements if x['id'] == a['p_ent'])
        if e['status'] != 'active':
            return err(400, 'P0001', 'entitlement_not_active')
        e['status'] = 'cancelled'
        if e['kind'] == 'pack':
            e['remaining'] = 0
        else:
            e['ends_at'] = min(e['ends_at'], now())
        audit.append({'target': e['user'], 'action': 'cancel_entitlement', 'details': {}, 'reason': a['p_reason'], 'created_at': iso(now())})
        return {'ok': True}
    if name == 'admin_set_blocked':
        profiles[a['p_user']]['blocked'] = bool(a['p_blocked'])
        audit.append({'target': a['p_user'], 'action': 'block_user' if a['p_blocked'] else 'unblock_user', 'details': {}, 'reason': a.get('p_reason'), 'created_at': iso(now())})
        return {'ok': True}
    if name == 'admin_set_free_used':
        profiles[a['p_user']]['free_used'] = a['p_value']
        return {'ok': True}
    return err(404, 'PGRST202', 'unknown function ' + name)


@app.route('/rest/v1/rpc/<name>', methods=['POST'])
def rpc(name):
    uid, st = current_uid()
    if not uid:
        return err(401, 'PGRST301', 'JWT expired' if st == 'expired' else 'permission denied for function ' + name)
    a = request.get_json() or {}
    if name == 'get_account':
        return jsonify(rpc_get_account(uid, a))
    if name == 'is_admin':
        return jsonify(uid in admins)
    if name == 'save_invoice':
        r = rpc_save_invoice(uid, a)
        if isinstance(r, dict) and r.pop('__drop', False):
            # شبیه‌سازی «سرور ذخیره کرد ولی پاسخ به مرورگر نرسید»
            return make_response('', 502)
        return jsonify(r)
    if name in ('delete_invoice', 'restore_invoice', 'purge_invoice'):
        return jsonify(rpc_simple_inv(uid, a, name.split('_')[0]))
    if name == 'purge_old_trash':
        return jsonify({'ok': True, 'deleted': 0})
    if name == 'save_settings':
        return jsonify(rpc_settings(uid, a))
    if name == 'import_invoices':
        return jsonify(rpc_import(uid, a))
    if name == 'register_device':
        devices.setdefault(uid, {})
        did = a.get('p_device_id')
        if did in devices[uid]:
            return jsonify({'ok': True, 'new': False})
        mx = SETTINGS['max_devices']
        if mx > 0 and len(devices[uid]) >= mx:
            return jsonify(fail('device_limit', max=mx))
        devices[uid][did] = True
        return jsonify({'ok': True, 'new': True})
    if name.startswith('admin_'):
        r = rpc_admin(uid, name, a)
        return r if not isinstance(r, (dict, list)) else jsonify(r)
    return err(404, 'PGRST202', 'unknown function ' + name)


@app.route('/mock/fail_next_response')
def m_fail_next():
    NET['fail_next_save_after_commit'] = True
    return jsonify({'ok': True})


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8790
    app.run(host='127.0.0.1', port=port, threaded=True)
