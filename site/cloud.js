/* ============================================================================
   فاکتورساز — لایهٔ حساب کاربری و همگام‌سازی آنلاین (Supabase، بدون کتابخانهٔ بیرونی)
   - فقط با REST رسمی Supabase (GoTrue + PostgREST) کار می‌کند؛ کلید مخفی ندارد.
   - اگر cloud-config.js خالی باشد، این فایل هیچ کاری نمی‌کند و برنامه مثل نسخهٔ قبل (محلی/لایسنس) کار می‌کند.
   - قانون سهمیه و اشتراک فقط در سرور (RPC: save_invoice) اعمال می‌شود؛ این فایل فقط درخواست می‌فرستد.
   ============================================================================ */
(function(){
  'use strict';
  var CFG = Object.assign({ supabaseUrl:'', anonKey:'', siteUrl:'', captcha:{ provider:'', siteKey:'' }, requireLoginOnStart:true }, window.CLOUD_CONFIG || {});
  var ENABLED = !!(CFG.supabaseUrl && CFG.anonKey);

  // ---------- ابزارهای عمومی ----------
  var LS = {
    get: function(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
    set: function(k, v){ try{ localStorage.setItem(k, v); }catch(e){} },
    del: function(k){ try{ localStorage.removeItem(k); }catch(e){} }
  };
  function readJSON(k, d){ try{ var v = JSON.parse(LS.get(k)); return v === null || v === undefined ? d : v; }catch(e){ return d; } }
  function isFa(){ return LS.get('inv_lang') !== 'en'; }
  function T(fa, en){ return isFa() ? fa : en; }
  function uuid(){
    if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var a = new Uint8Array(16); crypto.getRandomValues(a); a[6] = (a[6] & 15) | 64; a[8] = (a[8] & 63) | 128;
    var h = Array.prototype.map.call(a, function(b){ return ('0' + b.toString(16)).slice(-2); }).join('');
    return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
  }
  function esc(s){ return String(s === null || s === undefined ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function toast(msg){ if(window.__showToast) window.__showToast(msg); else { try{ console.log(msg); }catch(e){} } }
  function fmtDate(iso){
    if(!iso) return '—';
    try{ return new Intl.DateTimeFormat(isFa() ? 'fa-IR' : 'en-US', { dateStyle:'medium' }).format(new Date(iso)); }catch(e){ return String(iso).slice(0,10); }
  }

  // ---------- پیام‌های خطا (فارسی/انگلیسی) ----------
  function errText(code){
    var m = {
      offline:            T('اتصال اینترنت برقرار نیست. این کار فقط با اینترنت ممکن است.', 'No internet connection. This action needs internet.'),
      session_expired:    T('نشست شما منقضی شده؛ دوباره وارد شوید.', 'Your session has expired; please sign in again.'),
      not_authenticated:  T('برای ادامه وارد حساب شوید.', 'Please sign in to continue.'),
      invalid_credentials:T('ایمیل یا رمز عبور درست نیست.', 'Wrong email or password.'),
      email_not_confirmed:T('ایمیل شما هنوز تأیید نشده است؛ لینک ارسال‌شده به ایمیل را باز کنید.', 'Your email is not confirmed yet; open the link we sent you.'),
      user_already_exists:T('با این ایمیل قبلاً ثبت‌نام شده است؛ وارد شوید یا رمز را بازیابی کنید.', 'This email is already registered; sign in or reset your password.'),
      weak_password:      T('رمز عبور ضعیف است (حداقل ۸ نویسه).', 'Password is too weak (min 8 characters).'),
      validation_failed:  T('ایمیل یا رمز معتبر نیست.', 'Email or password is not valid.'),
      over_request_rate_limit: T('درخواست‌ها زیاد است؛ چند دقیقه بعد دوباره تلاش کنید.', 'Too many requests; try again in a few minutes.'),
      over_email_send_rate_limit: T('ایمیل‌های زیادی فرستاده شد؛ کمی بعد دوباره تلاش کنید.', 'Too many emails sent; try again shortly.'),
      captcha_failed:     T('تأیید «ربات نبودن» انجام نشد؛ دوباره تلاش کنید.', 'CAPTCHA failed; try again.'),
      signup_disabled:    T('ثبت‌نام فعلاً بسته است.', 'Sign-ups are currently disabled.'),
      quota_exceeded:     T('سهمیهٔ شما تمام شده است. برای ساخت فاکتور جدید، اشتراک یا بستهٔ فاکتور تهیه کنید.', 'Your quota is used up. Get a subscription or an invoice pack to create new invoices.'),
      blocked:            T('حساب شما مسدود شده است. با پشتیبانی تماس بگیرید.', 'Your account is blocked. Please contact support.'),
      rate_limited:       T('درخواست‌های شما بیش از حد مجاز است؛ چند دقیقه بعد دوباره تلاش کنید.', 'Too many requests; try again in a few minutes.'),
      stale_revision:     T('این فاکتور در دستگاه دیگری تغییر کرده؛ نسخهٔ جدید بارگذاری شد. تغییراتتان را دوباره اعمال کنید.', 'This invoice changed on another device; the latest version was loaded. Re-apply your changes.'),
      stale_settings:     T('تنظیمات در دستگاه دیگری تغییر کرده بود؛ نسخهٔ حساب بارگذاری شد.', 'Settings were changed on another device; the account version was loaded.'),
      invoice_deleted:    T('این فاکتور در سطل زباله است؛ ابتدا بازگردانی کنید.', 'This invoice is in the trash; restore it first.'),
      too_large:          T('حجم اطلاعات بیش از حد مجاز است.', 'Data is too large.'),
      device_limit:       T('تعداد دستگاه‌های مجاز حساب شما تکمیل است.', 'Your account reached its device limit.'),
      device_not_registered: T('این دستگاه برای حساب ثبت نشده است.', 'This device is not registered for the account.'),
      import_limit:       T('تعداد فاکتورهای قابل انتقال از حد مجاز بیشتر است.', 'Too many invoices to import.'),
      bad_data:           T('اطلاعات ارسالی معتبر نیست.', 'Invalid data.'),
      forbidden:          T('دسترسی مجاز نیست.', 'Forbidden.')
    };
    return m[code] || T('خطای ناشناخته از سرور (' + code + ')؛ دوباره تلاش کنید.', 'Unexpected server error (' + code + '); try again.');
  }

  // ============================================================================
  //  کلاینت REST (Auth + RPC + Select)
  // ============================================================================
  var base = String(CFG.supabaseUrl || '').replace(/\/+$/, '');
  var session = null;
  var refreshing = null;
  var listeners = {};
  function on(ev, fn){ (listeners[ev] = listeners[ev] || []).push(fn); }
  function emit(ev, p){ (listeners[ev] || []).forEach(function(f){ try{ f(p); }catch(e){} }); }

  function readSession(){
    try{ var s = JSON.parse(LS.get('inv_cloud_session') || 'null'); return s && s.access_token ? s : null; }catch(e){ return null; }
  }
  function writeSession(s){ session = s; if(s) LS.set('inv_cloud_session', JSON.stringify(s)); else LS.del('inv_cloud_session'); }
  function fromTokens(j){
    return { access_token: j.access_token, refresh_token: j.refresh_token,
             expires_at: Math.floor(Date.now() / 1000) + (Number(j.expires_in) || 3600),
             user: { id: j.user && j.user.id, email: j.user && j.user.email } };
  }
  function siteBase(){
    if(CFG.siteUrl) return CFG.siteUrl.replace(/\/*$/, '/');
    return location.origin + location.pathname.replace(/[^\/]*$/, '');
  }
  function refreshSession(){
    if(!session || !session.refresh_token) return Promise.resolve(false);
    if(refreshing) return refreshing;
    refreshing = (function(){
      return fetch(base + '/auth/v1/token?grant_type=refresh_token', {
        method:'POST', headers:{ 'apikey': CFG.anonKey, 'Content-Type':'application/json' },
        body: JSON.stringify({ refresh_token: session.refresh_token })
      }).then(function(res){
        if(!res.ok){
          if(res.status === 400 || res.status === 401 || res.status === 403){ writeSession(null); emit('signedout', { reason:'expired' }); }
          return false;
        }
        return res.json().then(function(j){ writeSession(fromTokens(j)); return true; });
      }).catch(function(){ return false; /* آفلاین: نشست حفظ می‌شود */ })
        .then(function(ok){ refreshing = null; return ok; });
    })();
    return refreshing;
  }
  function ensureFresh(){
    if(session && session.expires_at - Math.floor(Date.now() / 1000) < 60) return refreshSession();
    return Promise.resolve(true);
  }
  function http(path, o){
    o = o || {};
    var auth = o.auth !== false;
    return (auth && session ? ensureFresh() : Promise.resolve(true)).then(function(){
      var tok = (auth && session) ? session.access_token : CFG.anonKey;
      var headers = Object.assign({ 'apikey': CFG.anonKey, 'Authorization': 'Bearer ' + tok, 'Content-Type':'application/json' }, o.headers || {});
      return fetch(base + path, { method: o.method || 'GET', headers: headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) })
        .catch(function(){ throw { code:'offline', message:'network' }; })
        .then(function(res){
          return res.text().then(function(txt){
            var data = null; try{ data = txt ? JSON.parse(txt) : null; }catch(e){ data = txt; }
            if(res.status === 401 && auth && session && o.retry !== false){
              return refreshSession().then(function(ok){
                if(ok) return http(path, Object.assign({}, o, { retry:false }));
                throw { code:'session_expired', status:401 };
              });
            }
            if(!res.ok){
              throw { code: (data && (data.error_code || data.code)) || ('http_' + res.status), status: res.status,
                      message: (data && (data.msg || data.message || data.error_description || data.error)) || res.statusText, data: data };
            }
            return { data: data, headers: res.headers };
          });
        });
    });
  }
  function secBody(captcha){ return captcha ? { gotrue_meta_security: { captcha_token: captcha } } : {}; }

  var auth = {
    signUp: function(email, password, captcha){
      return http('/auth/v1/signup?redirect_to=' + encodeURIComponent(siteBase()), { method:'POST', auth:false,
        body: Object.assign({ email: email, password: password }, secBody(captcha)) }).then(function(r){
          if(r.data && r.data.access_token){ writeSession(fromTokens(r.data)); return { session:true }; }
          return { session:false };
        });
    },
    signIn: function(email, password, captcha){
      return http('/auth/v1/token?grant_type=password', { method:'POST', auth:false,
        body: Object.assign({ email: email, password: password }, secBody(captcha)) }).then(function(r){ writeSession(fromTokens(r.data)); return true; });
    },
    resend: function(email, captcha){
      return http('/auth/v1/resend', { method:'POST', auth:false, body: Object.assign({ type:'signup', email: email }, secBody(captcha)) });
    },
    recover: function(email, captcha){
      return http('/auth/v1/recover?redirect_to=' + encodeURIComponent(siteBase()), { method:'POST', auth:false, body: Object.assign({ email: email }, secBody(captcha)) });
    },
    updatePassword: function(pw){ return http('/auth/v1/user', { method:'PUT', body:{ password: pw } }); },
    signOut: function(){
      var p = session ? http('/auth/v1/logout', { method:'POST', retry:false }).catch(function(){}) : Promise.resolve();
      return p.then(function(){ writeSession(null); });
    },
    setSessionFromHash: function(h){
      var q = {}; String(h).replace(/^#/, '').split('&').forEach(function(kv){ var i = kv.indexOf('='); if(i > 0) q[decodeURIComponent(kv.slice(0,i))] = decodeURIComponent(kv.slice(i+1).replace(/\+/g,' ')); });
      if(q.error || q.error_description){ return { error: q.error_description || q.error, code: q.error_code || q.error }; }
      if(q.access_token){
        var u = null; try{ var pl = JSON.parse(atob(q.access_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))); u = { id: pl.sub, email: pl.email }; }catch(e){}
        writeSession({ access_token: q.access_token, refresh_token: q.refresh_token, expires_at: Math.floor(Date.now()/1000) + (Number(q.expires_in) || 3600), user: u || {} });
        return { type: q.type || 'signup' };
      }
      return null;
    }
  };
  function rpc(name, args){ return http('/rest/v1/rpc/' + name, { method:'POST', body: args || {} }).then(function(r){ return r.data; }); }
  function select(table, query, range){
    return http('/rest/v1/' + table + (query ? '?' + query : ''), { headers: range ? { 'Range-Unit':'items', 'Range': range } : {} }).then(function(r){ return r.data; });
  }
  session = readSession();

  window.CloudClient = { enabled: ENABLED, config: CFG, auth: auth, rpc: rpc, select: select,
    session: function(){ return session; }, errText: errText, on: on, uuid: uuid, esc: esc, fmtDate: fmtDate, T: T };

  // ============================================================================
  //  حالت غیرفعال: هیچ کاری نکن (برنامه مثل قبل کار می‌کند)
  // ============================================================================
  var STUB = {
    active: function(){ return false; }, loggedIn: function(){ return false; }, openAuth: function(){}, openAccount: function(){},
    saveInvoice: function(){ return Promise.resolve({ ok:false, error:'cloud_disabled' }); }, handleSaveError: function(){},
    onRecordsWrite: function(){}, queueDelete: function(){}, queueRestore: function(){}, queuePurge: function(){},
    onSettingChanged: function(){}, pull: function(){ return Promise.resolve(); }, rerender: function(){}, openMigration: function(){}, paid: function(){ return false; }
  };
  if(!ENABLED){ window.Cloud = STUB; return; }

  // لایسنس قدیمی (کد فعال‌سازی) وقتی حساب آنلاین فعال است کنار گذاشته می‌شود؛ کدها و فایل‌ها حذف نمی‌شوند
  if(window.LICENSE_CONFIG){ window.LICENSE_CONFIG.publicKey = null; }

  var IS_APP = false;           // در admin.html نیست
  var account = null;
  var settingsTimer = null;
  var flushing = false;
  var suppressSettings = false;
  var captchaToken = '';

  var SYNC_KEYS = ['inv_companyName','inv_companyPhone','inv_companyAddress','inv_companyEconomicId','inv_companyNationalId','inv_companyPostalCode','inv_companyCardNumber','inv_companySheba','inv_companyBankName','inv_companyAccountHolder',
    'inv_logo','inv_alwaysShowIds','inv_alwaysShowCustIds','inv_design','inv_saved_palettes','inv_presets_base','inv_presets_removed','inv_categories_base','inv_categories_removed',
    'inv_job','inv_job_label','inv_app_title','inv_default_note','inv_default_reminder_months','inv_default_reminder_on','inv_show_vat_column','inv_show_unit_column','inv_show_row_total_column',
    'inv_profiles','inv_last_number','inv_last_pf','inv_overdue_days','inv_reminder_lead_days','inv_custom_pdf_name_on'];
  var NUMERIC_MAX_KEYS = { inv_last_number:1, inv_last_pf:1 };
  var CACHE_KEYS = ['inv_records','inv_trash','inv_cloud_owner','inv_cloud_queue','inv_cloud_settings_rev','inv_cloud_settings_dirty','inv_cloud_first_link','inv_cloud_account'];

  function deviceId(){ var d = LS.get('inv_cloud_device'); if(!d){ d = uuid().replace(/-/g,'').slice(0,24); LS.set('inv_cloud_device', d); } return d; }
  function reloadSoon(){ setTimeout(function(){ location.reload(); }, 150); }

  // ============================================================================
  //  همگام‌سازی تنظیمات
  // ============================================================================
  function collectSettings(){
    var o = {}; SYNC_KEYS.forEach(function(k){ var v = LS.get(k); if(v !== null) o[k] = v; }); return o;
  }
  function applySettings(server, merge){
    var changed = false;
    suppressSettings = true;
    try{
      SYNC_KEYS.forEach(function(k){
        var sv = Object.prototype.hasOwnProperty.call(server, k) ? server[k] : null;
        var lv = LS.get(k);
        if(NUMERIC_MAX_KEYS[k] && sv !== null && lv !== null){ sv = String(Math.max(Number(sv) || 0, Number(lv) || 0)); }
        if(sv === null){ if(lv !== null && !merge){ LS.del(k); changed = true; } }
        else if(sv !== lv){ LS.set(k, sv); changed = true; }
      });
    } finally { suppressSettings = false; }
    return changed;
  }
  function settingsDiffer(a, b){
    return SYNC_KEYS.some(function(k){ var x = a[k] === undefined ? null : a[k], y = b[k] === undefined ? null : b[k]; return x !== y && !(NUMERIC_MAX_KEYS[k]); });
  }
  function pushSettings(){
    if(!session) return Promise.resolve(false);
    return rpc('save_settings', { p_settings: collectSettings(), p_base_rev: Number(LS.get('inv_cloud_settings_rev') || 0) }).then(function(res){
      if(res && res.ok){ LS.set('inv_cloud_settings_rev', String(res.rev)); LS.del('inv_cloud_settings_dirty'); return true; }
      if(res && res.error === 'stale_settings'){
        toast(errText('stale_settings'));
        return pullSettings(true).then(function(){ return false; });
      }
      if(res && res.error) toast(errText(res.error));
      return false;
    }).catch(function(e){ if(e && e.code !== 'offline') toast(errText(e.code)); return false; });
  }
  function pullSettings(applyAndReload){
    return select('profiles', 'select=settings,settings_rev&id=eq.' + encodeURIComponent(session.user.id)).then(function(rows){
      var row = rows && rows[0]; if(!row) return false;
      var server = row.settings || {};
      LS.set('inv_cloud_settings_rev', String(row.settings_rev || 0));
      LS.del('inv_cloud_settings_dirty');
      var changed = applySettings(server, false);
      if(changed && applyAndReload) reloadSoon();
      return changed;
    });
  }
  function syncSettings(acc){
    return select('profiles', 'select=settings,settings_rev&id=eq.' + encodeURIComponent(acc.id)).then(function(rows){
      var row = rows && rows[0] || { settings:{}, settings_rev:0 };
      var server = row.settings || {}; var srev = Number(row.settings_rev) || 0;
      var localRev = Number(LS.get('inv_cloud_settings_rev') || 0);
      var dirty = LS.get('inv_cloud_settings_dirty') === '1';
      var first = LS.get('inv_cloud_first_link') === '1';
      var local = collectSettings();
      if(srev === 0 || !Object.keys(server).length){
        LS.set('inv_cloud_settings_rev', '0');
        LS.del('inv_cloud_first_link');
        return Object.keys(local).length ? pushSettings() : false;
      }
      if(first){
        LS.del('inv_cloud_first_link');
        if(settingsDiffer(local, server)){
          var useCloud = window.confirm(T('تنظیمات این دستگاه با تنظیمات حساب شما فرق دارد.\n\nOK = استفاده از تنظیمات حساب\nCancel = جایگزینی تنظیمات حساب با تنظیمات این دستگاه', 'This device\'s settings differ from your account settings.\n\nOK = use the account settings\nCancel = replace account settings with this device\'s settings'));
          if(!useCloud){ LS.set('inv_cloud_settings_rev', String(srev)); return pushSettings(); }
        }
        LS.set('inv_cloud_settings_rev', String(srev));
        var ch = applySettings(server, false); if(ch) reloadSoon(); return ch;
      }
      if(dirty && srev === localRev){ return pushSettings(); }
      if(srev !== localRev){
        LS.set('inv_cloud_settings_rev', String(srev)); LS.del('inv_cloud_settings_dirty');
        var changed = applySettings(server, false);
        if(changed) reloadSoon();
        return changed;
      }
      return false;
    });
  }
  function onSettingChanged(key){
    if(suppressSettings || !session || SYNC_KEYS.indexOf(key) < 0) return;
    LS.set('inv_cloud_settings_dirty', '1');
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(function(){ pushSettings(); }, 2500);
  }

  // ============================================================================
  //  همگام‌سازی فاکتورها
  // ============================================================================
  function setRaw(k, v){ var o = suppressSettings; suppressSettings = true; LS.set(k, v); suppressSettings = o; }
  function readQueue(){ return readJSON('inv_cloud_queue', []); }
  function writeQueue(q){ if(q.length) LS.set('inv_cloud_queue', JSON.stringify(q)); else LS.del('inv_cloud_queue'); renderChip(); }
  function pendingIds(){ var o = {}; readQueue().forEach(function(op){ o[op.id] = true; }); return o; }
  function stripMeta(rec){ var c = Object.assign({}, rec); delete c._rev; delete c.deletedAt; return c; }
  function refreshUI(){ if(window.__cloudRefreshUI) try{ window.__cloudRefreshUI(); }catch(e){} }

  function pull(){
    if(!session || !account || !account.email_confirmed) return Promise.resolve();
    var pend = pendingIds();
    return rpc('purge_old_trash').catch(function(){}).then(function(){
      var rows = [];
      function page(from){
        return select('invoices', 'select=id,rev,deleted_at&order=updated_at.desc', from + '-' + (from + 999)).then(function(r){
          rows = rows.concat(r || []); if(r && r.length === 1000) return page(from + 1000);
        });
      }
      return page(0).then(function(){
        var records = readJSON('inv_records', []); var trash = readJSON('inv_trash', []);
        var local = {}; records.forEach(function(r){ local[r.id] = r; }); trash.forEach(function(r){ local[r.id] = r; });
        var need = []; var serverIds = {};
        rows.forEach(function(s){
          serverIds[s.id] = s;
          var l = local[s.id];
          if(pend[s.id]) return;
          if(!l || l._rev !== s.rev || (!!l.deletedAt) !== (!!s.deleted_at)) need.push(s.id);
        });
        var chain = Promise.resolve([]);
        for(var i = 0; i < need.length; i += 40){
          (function(chunk){
            chain = chain.then(function(acc){
              var list = chunk.map(function(id){ return '"' + String(id).replace(/"/g,'') + '"'; }).join(',');
              return select('invoices', 'select=id,data,rev,deleted_at&id=in.(' + encodeURIComponent(list) + ')').then(function(r){ return acc.concat(r || []); });
            });
          })(need.slice(i, i + 40));
        }
        return chain.then(function(full){
          var newRecords = [], newTrash = [];
          var fullMap = {}; full.forEach(function(f){ fullMap[f.id] = f; });
          // رکوردهای محلی که هنوز با سرور یکی‌اند یا تغییر در انتظارِ ارسال دارند
          Object.keys(local).forEach(function(id){
            var l = local[id]; var s = serverIds[id];
            if(!s){ if(pend[id]) (l.deletedAt ? newTrash : newRecords).push(l); return; }   // حذف‌شده در سرور → از کش بردار
            if(pend[id] || fullMap[id]) return;
            (l.deletedAt ? newTrash : newRecords).push(l);
          });
          full.forEach(function(f){
            var rec = Object.assign({}, f.data, { id: f.id, _rev: f.rev });
            if(f.deleted_at){ rec.deletedAt = new Date(f.deleted_at).getTime(); newTrash.push(rec); } else { delete rec.deletedAt; newRecords.push(rec); }
          });
          newRecords.sort(function(a, b){ return (b.savedAt || 0) - (a.savedAt || 0); });
          newTrash.sort(function(a, b){ return (b.deletedAt || 0) - (a.deletedAt || 0); });
          var before = LS.get('inv_records') + '|' + LS.get('inv_trash');
          var nr = JSON.stringify(newRecords), nt = JSON.stringify(newTrash);
          if(before !== nr + '|' + nt){ setRaw('inv_records', nr); setRaw('inv_trash', nt); refreshUI(); }
        });
      });
    }).catch(function(e){ if(e && e.code !== 'offline') toast(errText(e.code)); });
  }

  function saveInvoice(record, o){
    o = o || {};
    if(!session) return Promise.resolve({ ok:false, error:'not_authenticated' });
    var requestId = uuid();
    function attempt(n){
      return rpc('save_invoice', { p_id: record.id, p_data: stripMeta(record), p_request_id: requestId, p_base_rev: o.baseRev === undefined ? null : o.baseRev, p_device_id: deviceId() })
        .catch(function(e){
          // قطع شبکه یا خطای ۵xx: همان requestId دوباره فرستاده می‌شود؛ اگر سرور قبلاً ذخیره کرده باشد همان نتیجه را می‌دهد (مصرف تکراری ندارد)
          var ambiguous = e && (e.code === 'offline' || e.status >= 500);
          if(ambiguous && n < 2) return new Promise(function(r){ setTimeout(r, 400); }).then(function(){ return attempt(n + 1); });
          throw e;
        });
    }
    return attempt(0).then(function(res){
      if(res && res.ok){ account = Object.assign({}, account || {}, { state: res.state }); LS.set('inv_cloud_account', JSON.stringify(account)); renderChip(); }
      return res;
    }).catch(function(e){ return { ok:false, error: (e && e.code) || 'unknown' }; });
  }
  function handleSaveError(res){
    var code = res && res.error;
    if(code === 'quota_exceeded'){ if(res.state) account = Object.assign({}, account || {}, { state: res.state }); openPaywall(); return; }
    if(code === 'not_authenticated' || code === 'session_expired'){ openAuth(errText(code)); return; }
    if(code === 'email_not_confirmed'){ openAuth(errText(code)); return; }
    if(code === 'stale_revision' || code === 'invoice_deleted'){ pull(); }
    toast(errText(code));
  }

  function enqueue(op){
    var q = readQueue().filter(function(x){ return !(x.id === op.id && x.op === op.op); });
    if(op.op === 'save'){ q = q.filter(function(x){ return !(x.id === op.id && (x.op === 'delete' || x.op === 'purge')); }); }
    q.push(op); writeQueue(q); flushQueue();
  }
  function onRecordsWrite(prev, next){
    if(!session) return;
    var pm = {}; (prev || []).forEach(function(r){ pm[r.id] = r; });
    (next || []).forEach(function(r){
      var p = pm[r.id]; if(!p) return;
      var a = Object.assign({}, p), b = Object.assign({}, r); delete a._rev; delete b._rev;
      if(JSON.stringify(a) !== JSON.stringify(b)) enqueue({ op:'save', id: r.id, record: stripMeta(r), rev: r._rev, t: Date.now() });
    });
  }
  function flushQueue(){
    if(flushing || !session || !account || !account.email_confirmed) return Promise.resolve();
    var q = readQueue(); if(!q.length) return Promise.resolve();
    flushing = true;
    function step(){
      q = readQueue(); if(!q.length){ flushing = false; renderChip(); return pull(); }
      var op = q[0];
      var call;
      if(op.op === 'save') call = rpc('save_invoice', { p_id: op.id, p_data: op.record, p_request_id: uuid(), p_base_rev: op.rev === undefined ? null : op.rev, p_device_id: deviceId() });
      else if(op.op === 'delete') call = rpc('delete_invoice', { p_id: op.id });
      else if(op.op === 'restore') call = rpc('restore_invoice', { p_id: op.id });
      else call = rpc('purge_invoice', { p_id: op.id });
      return call.then(function(res){
        if(res && res.ok){
          writeQueue(readQueue().slice(1)); return step();
        }
        var err = res && res.error;
        if(err === 'rate_limited'){ flushing = false; setTimeout(flushQueue, 60000); return; }
        writeQueue(readQueue().slice(1));                       // خطای غیرقابل‌تکرار: عملیات را رها کن و نسخهٔ سرور را بگیر
        if(err && err !== 'not_found' && err !== 'not_in_trash') toast(errText(err));
        return step();
      }).catch(function(e){
        flushing = false; renderChip();
        if(e && e.code !== 'offline'){ writeQueue(readQueue().slice(1)); toast(errText(e.code)); setTimeout(flushQueue, 500); }
      });
    }
    return step();
  }

  // ============================================================================
  //  ورود، حساب و مهاجرت
  // ============================================================================
  function wipeCache(){
    CACHE_KEYS.forEach(function(k){ LS.del(k); });
    SYNC_KEYS.forEach(function(k){ LS.del(k); });
    setRaw('inv_records', '[]'); setRaw('inv_trash', '[]');
  }
  function syncOwnership(acc){
    var uid = acc.id; var owner = LS.get('inv_cloud_owner');
    if(owner === uid) return false;
    var recs = readJSON('inv_records', []), trash = readJSON('inv_trash', []);
    if(!owner){
      // داده‌های قبلیِ این مرورگر (حالت محلی/مهمان): یک نسخهٔ امن نگه داشته می‌شود و هرگز خودکار پاک نمی‌شود
      if(recs.length || trash.length){
        if(!LS.get('inv_legacy_records')) LS.set('inv_legacy_records', JSON.stringify(recs));
        if(!LS.get('inv_legacy_trash')) LS.set('inv_legacy_trash', JSON.stringify(trash));
        LS.set('inv_cloud_migrate_pending', '1');
      }
      setRaw('inv_records', '[]'); setRaw('inv_trash', '[]');
      LS.set('inv_cloud_owner', uid); LS.set('inv_cloud_first_link', '1');
      reloadSoon(); return true;
    }
    // حساب دیگری قبلاً روی این مرورگر وارد شده بود: کش او باید پاک شود (حریم خصوصی)
    wipeCache(); LS.set('inv_cloud_owner', uid); LS.set('inv_cloud_first_link', '1'); reloadSoon(); return true;
  }
  function registerDevice(){
    return rpc('register_device', { p_device_id: deviceId(), p_label: (navigator.userAgent || '').slice(0, 60) }).then(function(r){
      if(r && r.error === 'device_limit'){ toast(errText('device_limit')); openAccount(); }
    }).catch(function(){});
  }
  function loadAccount(){
    return rpc('get_account').then(function(acc){
      if(acc && acc.ok){ if(window.__cloudRefreshPreview) setTimeout(window.__cloudRefreshPreview, 0); account = acc; LS.set('inv_cloud_account', JSON.stringify({ id: acc.id, email: acc.email, email_confirmed: acc.email_confirmed, state: acc.state, is_admin: acc.is_admin })); renderChip(); return acc; }
      throw { code: (acc && acc.error) || 'unknown' };
    });
  }
  function afterLogin(){
    return loadAccount().then(function(acc){
      if(!acc.email_confirmed){ openAuth(errText('email_not_confirmed')); return; }
      registerDevice();
      if(syncOwnership(acc)) return;
      return syncSettings(acc).then(function(){ return pull(); }).then(function(){
        flushQueue(); maybePromptMigration();
      });
    }).catch(function(e){
      if(e && e.code === 'offline'){ var c = readJSON('inv_cloud_account', null); if(c) account = c; renderChip(); return; }
      if(e && (e.code === 'session_expired' || e.status === 401)){ openAuth(errText('session_expired')); return; }
      toast(errText(e && e.code));
    });
  }
  function signOutFlow(){
    var q = readQueue();
    if(q.length && !window.confirm(T('هنوز ' + q.length + ' تغییر به سرور ارسال نشده و با خروج از بین می‌رود. خارج می‌شوید؟', q.length + ' changes have not been synced and will be lost. Sign out anyway?'))) return;
    auth.signOut().then(function(){ wipeCache(); LS.del('inv_cloud_migrate_pending'); location.reload(); });
  }

  // ---------- مهاجرت داده‌های قدیمی مرورگر ----------
  function legacyRecords(){ return readJSON('inv_legacy_records', []); }
  function maybePromptMigration(){
    if(LS.get('inv_cloud_migrate_pending') === '1' && legacyRecords().length && LS.get('inv_legacy_migrated') !== '1'){ openMigration(); }
  }
  function downloadLegacyBackup(){
    var data = { inv_records: LS.get('inv_legacy_records') || '[]', inv_trash: LS.get('inv_legacy_trash') || '[]' };
    var blob = new Blob([JSON.stringify({ app:'invoice-generator-ac', version:1, exportedAt:new Date().toISOString(), data: data }, null, 2)], { type:'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'factorsaz-local-backup.json'; document.body.appendChild(a); a.click(); a.remove();
  }
  function runMigration(statusEl){
    var recs = legacyRecords().filter(function(r){ return r && r.id; });
    var total = recs.length, done = 0, inserted = 0, skipped = 0;
    function say(t){ if(statusEl) statusEl.textContent = t; }
    function next(){
      if(done >= total){ return Promise.resolve(); }
      var batch = recs.slice(done, done + 40).map(function(r){ return { id: String(r.id), data: stripMeta(r) }; });
      return rpc('import_invoices', { p_items: batch }).then(function(res){
        if(!res || !res.ok){ throw { code: res && res.error || 'unknown', allowance: res && res.allowance }; }
        inserted += res.inserted; skipped += res.skipped; done += batch.length; say(T('در حال انتقال... ', 'Migrating... ') + done + '/' + total); return next();
      });
    }
    say(T('در حال انتقال...', 'Migrating...'));
    return next().then(function(){
      LS.set('inv_legacy_migrated', '1'); LS.del('inv_cloud_migrate_pending');
      say(T('انتقال تمام شد: ' + inserted + ' فاکتور منتقل شد، ' + skipped + ' مورد تکراری یا نامعتبر نادیده گرفته شد. نسخهٔ محلی قدیمی حذف نشد.', 'Done: ' + inserted + ' invoices migrated, ' + skipped + ' skipped (duplicates/invalid). The old local copy was kept.'));
      return pull().then(function(){ return true; });
    }).catch(function(e){
      say(T('انتقال کامل نشد (', 'Migration incomplete (') + errText(e && e.code) + T(' ). اطلاعات محلی شما دست‌نخورده مانده است.', ' ). Your local data is untouched.'));
      return false;
    });
  }

  // ============================================================================
  //  رابط کاربری (فقط در صفحهٔ برنامه)
  // ============================================================================
  var overlay = null, chip = null;
  var CSS = '.cloud-bar{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;width:100%;margin:0;padding:8px 12px;border:1px solid var(--line);border-radius:12px;background:var(--panel);color:var(--ink);font-family:inherit;font-size:12.5px;line-height:1.7;cursor:pointer;text-align:start}'
    + '.cloud-bar .cb-name{font-weight:700;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:ltr;unicode-bidi:plaintext}'
    + '.cloud-bar .cb-pill{padding:1px 10px;border-radius:100px;background:var(--line-soft);white-space:nowrap}'
    + '.cloud-bar.warn{border-color:var(--warn)}.cloud-bar.warn .cb-plan{color:var(--warn);font-weight:700}.cloud-bar.ok{border-color:var(--ok)}'
    + '@media (max-width:480px){.cloud-bar{font-size:12px;padding:7px 10px}.cloud-bar .cb-name{flex:1 1 100%}}'
    + '@media print{.cloud-bar,#cloudOverlay{display:none !important}}'
    + '#cloudOverlay .cl-tabs{display:flex;gap:6px}#cloudOverlay .cl-tabs button{flex:1}'
    + '#cloudOverlay .cl-msg{font-size:12.5px;line-height:1.9;min-height:20px}#cloudOverlay .cl-msg.err{color:var(--warn)}#cloudOverlay .cl-msg.ok{color:var(--ok)}'
    + '#cloudOverlay input.cl-in{font-family:inherit;font-size:14px;width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink);direction:ltr;text-align:left}'
    + '#cloudOverlay .cl-row{display:flex;justify-content:space-between;gap:8px;font-size:13px;padding:5px 0;border-bottom:1px dashed var(--line-soft)}'
    + '#cloudOverlay .cl-link{background:none;border:none;color:var(--muted);font-family:inherit;font-size:12px;cursor:pointer;text-decoration:underline;padding:4px}'
    + '#cloudOverlay .cl-box{border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:12.5px;line-height:1.9}'
    + '#cloudOverlay .cl-sec{font-weight:700;font-size:12.5px;margin-top:4px}';

  function planText(){
    var st = account && account.state; if(!st) return '';
    if(st.sub_active) return T('اشتراک فعال تا ', 'Subscription until ') + fmtDate(st.sub_ends_at);
    var parts = [];
    if(st.free_left > 0) parts.push(T(st.free_left + ' فاکتور رایگان', st.free_left + ' free'));
    if(st.pack_left > 0) parts.push(T(st.pack_left + ' فاکتور بسته', st.pack_left + ' pack'));
    return parts.length ? parts.join(' + ') : T('سهمیه تمام شده', 'Quota used up');
  }
  function daysLeft(iso){
    if(!iso) return null;
    var d = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
    return isFinite(d) ? d : null;
  }
  function renderChip(){
    if(!chip) return;
    var q = readQueue().length;
    if(!session){ chip.innerHTML = '<span>☁️</span><span class="cb-pill cb-plan">' + esc(T('ورود / ثبت‌نام', 'Sign in / Sign up')) + '</span>'; chip.className = 'cloud-bar warn'; return; }
    var st = account && account.state;
    var low = st && !st.sub_active && (st.free_left + st.pack_left) <= 0;
    var html = '<span>☁️</span><span class="cb-name">' + esc(account && account.email ? account.email : (session.user && session.user.email) || '') + '</span>';
    if(st){
      if(st.sub_active){
        html += '<span class="cb-pill cb-plan">' + esc(T('اشتراک فعال', 'Subscription active')) + '</span>';
        var dl = daysLeft(st.sub_ends_at);
        if(dl !== null) html += '<span class="cb-pill cb-days">' + esc(dl <= 0 ? T('امروز تمام می‌شود', 'ends today') : T(dl + ' روز مانده', dl + ' days left')) + '</span>';
      } else {
        html += '<span class="cb-pill cb-plan">' + esc(planText()) + '</span>';
      }
    }
    if(q) html += '<span class="cb-pill">⏳ ' + q + '</span>';
    chip.innerHTML = html;
    chip.className = 'cloud-bar' + (low ? ' warn' : (st && st.paid ? ' ok' : ''));
  }
  function setupDom(){
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    chip = document.createElement('button'); chip.type = 'button'; chip.className = 'cloud-bar'; chip.id = 'cloudChip';
    chip.addEventListener('click', function(){ if(session) openAccount(); else openAuth(); });
    var head = document.getElementById('appHead');
    if(head && head.parentNode) head.parentNode.insertBefore(chip, head.nextSibling);
    else { var fc = document.querySelector('.form-col'); if(fc) fc.insertBefore(chip, fc.firstChild); else document.body.appendChild(chip); }
    overlay = document.createElement('div'); overlay.id = 'cloudOverlay'; overlay.className = 'lic-overlay'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = '<div class="lic-card" id="cloudCard"></div>';
    overlay.addEventListener('mousedown', function(e){ if(e.target === overlay && !overlay.getAttribute('data-lock')) closeModal(); });
    document.body.appendChild(overlay);
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && !overlay.getAttribute('data-lock')) closeModal(); });
    renderChip();
  }
  function card(){ return document.getElementById('cloudCard'); }
  function openModal(html, lock){ card().innerHTML = html; if(lock) overlay.setAttribute('data-lock', '1'); else overlay.removeAttribute('data-lock'); overlay.classList.add('open'); }
  function closeModal(){ if(overlay){ overlay.classList.remove('open'); overlay.removeAttribute('data-lock'); } }
  function head(title, closable){ return '<div class="lic-head"><div class="lic-title">' + title + '</div>' + (closable === false ? '' : '<button type="button" class="lic-close" data-act="close">✕</button>') + '</div>'; }
  function msgBox(txt, kind){ return '<div class="cl-msg ' + (kind || '') + '" id="clMsg">' + esc(txt || '') + '</div>'; }
  function setMsg(txt, kind){ var m = document.getElementById('clMsg'); if(m){ m.textContent = txt || ''; m.className = 'cl-msg ' + (kind || ''); } }

  var authMode = 'signin';
  function authView(message){
    var si = authMode === 'signin';
    var cap = CFG.captcha && CFG.captcha.provider && CFG.captcha.siteKey ? '<div id="clCaptcha"></div>' : '';
    openModal(
      head('☁️ ' + T('حساب فاکتورساز', 'Factorsaz account')) +
      '<div class="lic-msg">' + esc(T('اطلاعات شما به حساب‌تان وصل می‌شود و در هر دستگاه در دسترس است. سهمیهٔ رایگان و اشتراک هم به همین حساب وابسته است.', 'Your data is linked to your account and available on any device. Your free quota and subscription belong to this account.')) + '</div>' +
      '<div class="cl-tabs"><button type="button" class="btn ' + (si ? '' : 'outline') + '" data-act="tab-signin">' + T('ورود', 'Sign in') + '</button><button type="button" class="btn ' + (si ? 'outline' : '') + '" data-act="tab-signup">' + T('ثبت‌نام', 'Sign up') + '</button></div>' +
      '<input class="cl-in" id="clEmail" type="email" autocomplete="email" placeholder="email@example.com">' +
      '<input class="cl-in" id="clPass" type="password" autocomplete="' + (si ? 'current-password' : 'new-password') + '" placeholder="' + T('رمز عبور (حداقل ۸ نویسه)', 'Password (min 8 chars)') + '">' +
      cap +
      '<button type="button" class="btn" data-act="submit">' + (si ? T('ورود', 'Sign in') : T('ساخت حساب', 'Create account')) + '</button>' +
      msgBox(message, message ? 'err' : '') +
      '<div style="display:flex;justify-content:space-between;flex-wrap:wrap;"><button type="button" class="cl-link" data-act="forgot">' + T('رمز را فراموش کرده‌ام', 'Forgot password') + '</button><button type="button" class="cl-link" data-act="resend">' + T('ارسال دوبارهٔ ایمیل تأیید', 'Resend confirmation email') + '</button></div>',
      false);
    loadCaptcha();
  }
  function loadCaptcha(){
    var c = CFG.captcha || {}; var box = document.getElementById('clCaptcha'); captchaToken = '';
    if(!box || !c.provider || !c.siteKey) return;
    var url = c.provider === 'hcaptcha' ? 'https://js.hcaptcha.com/1/api.js?render=explicit' : 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    function render(){
      var api = c.provider === 'hcaptcha' ? window.hcaptcha : window.turnstile; if(!api || !document.getElementById('clCaptcha')) return;
      api.render('#clCaptcha', { sitekey: c.siteKey, callback: function(t){ captchaToken = t; }, 'expired-callback': function(){ captchaToken = ''; } });
    }
    if((c.provider === 'hcaptcha' && window.hcaptcha) || (c.provider !== 'hcaptcha' && window.turnstile)){ render(); return; }
    var s = document.createElement('script'); s.src = url; s.async = true; s.onload = render; document.head.appendChild(s);
  }
  function openAuth(message){ authView(message); }

  function openRecovery(){
    openModal(head('🔑 ' + T('تعیین رمز جدید', 'Set a new password'), false) +
      '<input class="cl-in" id="clPass" type="password" autocomplete="new-password" placeholder="' + T('رمز جدید (حداقل ۸ نویسه)', 'New password (min 8 chars)') + '">' +
      '<button type="button" class="btn" data-act="setpass">' + T('ذخیرهٔ رمز', 'Save password') + '</button>' + msgBox(''), true);
  }

  function openPaywall(){
    var C = window.LICENSE_CONFIG || {};
    var plans = Array.isArray(C.plans) ? C.plans : [];
    var st = account && account.state || {};
    var info = (account ? T('ایمیل حساب: ', 'Account email: ') + account.email + '\n' + T('شناسهٔ حساب: ', 'Account ID: ') + account.id : '');
    openModal(head('🔒 ' + T('برای ساخت فاکتور جدید، اشتراک یا بسته لازم است', 'A plan is needed to create new invoices')) +
      '<div class="lic-msg">' + esc(T('سهمیهٔ رایگان (' + (st.free_limit || 5) + ' فاکتور) تمام شده است. فاکتورهای قبلی شما همچنان قابل مشاهده، ویرایش و دریافت PDF هستند.', 'Your free quota (' + (st.free_limit || 5) + ' invoices) is used up. Your existing invoices remain viewable, editable and exportable.')) + '</div>' +
      '<div class="lic-plans">' + plans.map(function(p){ return '<div class="lic-plan"><div><div class="pn">' + esc((isFa() ? p.title : (p.title_en || p.title)) || '') + '</div>' + ((isFa() ? p.note : (p.note_en || p.note)) ? '<div class="pt">' + esc(isFa() ? p.note : (p.note_en || p.note)) + '</div>' : '') + '</div><div class="pp">' + esc((isFa() ? p.price : (p.price_en || p.price)) || '') + '</div></div>'; }).join('') + '</div>' +
      (C.buyUrl ? '<button type="button" class="btn" data-act="buy">' + esc((isFa() ? C.buyLabel : (C.buyLabel_en || C.buyLabel)) || T('خرید', 'Buy')) + '</button>' : '') +
      '<div class="cl-box">' + esc(T('بعد از پرداخت، ایمیل و شناسهٔ حساب خود را برای ما بفرستید تا اشتراک همین حساب فعال شود. (نیازی به کد فعال‌سازی نیست.)', 'After paying, send us your account email and ID so we can activate this very account. (No activation code needed.)')) +
      '<div style="direction:ltr;text-align:left;font-size:11.5px;word-break:break-all;margin-top:6px;">' + esc(account ? account.email : '') + '<br>' + esc(account ? account.id : '') + '</div></div>' +
      '<button type="button" class="btn outline" data-act="copyinfo" data-info="' + esc(info) + '">' + T('کپی ایمیل و شناسهٔ حساب', 'Copy account email & ID') + '</button>' +
      '<div class="lic-msg">' + esc(isFa() ? (C.contact || '') : (C.contact_en || C.contact || '')) + '</div>');
  }

  function openAccount(){
    if(!session){ openAuth(); return; }
    var st = account && account.state || {};
    var ents = account && account.entitlements || [];
    var rows = '';
    rows += '<div class="cl-row"><span>' + T('ایمیل', 'Email') + '</span><span style="direction:ltr">' + esc(account ? account.email : session.user && session.user.email) + '</span></div>';
    rows += '<div class="cl-row"><span>' + T('وضعیت', 'Status') + '</span><span>' + esc(planText() || '—') + '</span></div>';
    if(st.free_limit !== undefined) rows += '<div class="cl-row"><span>' + T('سهمیهٔ رایگان', 'Free quota') + '</span><span>' + (st.free_used || 0) + ' / ' + st.free_limit + '</span></div>';
    if(st.pack_left) rows += '<div class="cl-row"><span>' + T('فاکتور بستهٔ باقی‌مانده', 'Pack invoices left') + '</span><span>' + st.pack_left + '</span></div>';
    if(st.sub_ends_at) rows += '<div class="cl-row"><span>' + T('پایان اشتراک', 'Subscription ends') + '</span><span>' + fmtDate(st.sub_ends_at) + '</span></div>';
    var hist = ents.map(function(e){ return '<div class="cl-row"><span>' + esc(e.plan_id || e.kind) + (e.status === 'cancelled' ? ' (' + T('لغو‌شده', 'cancelled') + ')' : '') + '</span><span>' + (e.kind === 'sub' ? fmtDate(e.starts_at) + ' → ' + fmtDate(e.ends_at) : (e.invoices_remaining + ' / ' + e.invoices_total)) + '</span></div>'; }).join('');
    var q = readQueue().length;
    openModal(head('☁️ ' + T('حساب من', 'My account')) +
      '<div>' + rows + '</div>' +
      (hist ? '<div class="cl-sec">' + T('تاریخچهٔ اشتراک و بسته‌ها', 'Plan history') + '</div><div>' + hist + '</div>' : '') +
      (q ? '<div class="cl-msg err">' + T(q + ' تغییر هنوز به سرور ارسال نشده است.', q + ' changes are not synced yet.') + '</div>' : '') +
      '<button type="button" class="btn" data-act="plans">' + T('خرید / تمدید اشتراک', 'Buy / renew a plan') + '</button>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;"><button type="button" class="btn outline sm" data-act="syncnow">' + T('همگام‌سازی اکنون', 'Sync now') + '</button>' +
      '<button type="button" class="btn outline sm" data-act="copyinfo" data-info="' + esc((account ? account.email + '\n' + account.id : '')) + '">' + T('کپی شناسهٔ حساب', 'Copy account ID') + '</button>' +
      (legacyRecords().length ? '<button type="button" class="btn outline sm" data-act="migrate">' + T('انتقال اطلاعات قدیمی این دستگاه', 'Migrate old data from this device') + '</button>' : '') +
      (account && account.is_admin ? '<a class="btn outline sm" style="text-decoration:none;display:inline-block;" href="admin.html">' + T('پنل مدیریت', 'Admin panel') + '</a>' : '') +
      '</div>' + msgBox('') +
      '<button type="button" class="btn danger" data-act="signout">' + T('خروج از حساب', 'Sign out') + '</button>');
  }

  function openMigration(){
    var n = legacyRecords().length;
    var allow = account && account.import_allowance;
    openModal(head('📦 ' + T('انتقال اطلاعات قدیمی به حساب', 'Move your old data into your account')) +
      '<div class="lic-msg">' + esc(T('روی این دستگاه ' + n + ' فاکتور از نسخهٔ قبلی برنامه پیدا شد. با انتقال، آن‌ها در حساب شما ذخیره می‌شوند و از هر دستگاه در دسترس‌اند. هیچ‌چیز از این دستگاه حذف نمی‌شود.', n + ' invoices from the previous version were found on this device. Migrating stores them in your account for every device. Nothing is deleted from this device.')) + '</div>' +
      '<div class="cl-box">' + esc(T('۱) اول پشتیبان بگیرید (توصیه می‌شود).  ۲) سپس «انتقال» را بزنید. اگر دوباره بزنید، رکورد تکراری ساخته نمی‌شود. فاکتورهای واردشده سهمیه مصرف نمی‌کنند ولی سقف تعداد دارند' + (allow !== undefined ? ' (باقی‌مانده: ' + allow + ')' : '') + '.', '1) Download a backup first (recommended). 2) Then press Migrate. Running it twice never creates duplicates. Imported invoices do not use quota but there is a cap' + (allow !== undefined ? ' (remaining: ' + allow + ')' : '') + '.')) + '</div>' +
      '<button type="button" class="btn outline" data-act="legacybackup">' + T('📥 دانلود پشتیبان', '📥 Download backup') + '</button>' +
      '<button type="button" class="btn" data-act="runmigrate">' + T('انتقال به حساب', 'Migrate to my account') + '</button>' +
      '<div class="cl-msg" id="clMsg"></div>' +
      '<button type="button" class="btn ghost" data-act="close">' + T('بعداً', 'Later') + '</button>');
  }

  function copyText(t){
    try{ if(navigator.clipboard) return navigator.clipboard.writeText(t).then(function(){ toast(T('کپی شد', 'Copied')); }); }catch(e){}
    var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try{ document.execCommand('copy'); toast(T('کپی شد', 'Copied')); }catch(e){} ta.remove();
  }
  function authError(e){ return errText(e && e.code === 'invalid_credentials' ? 'invalid_credentials' : (e && (e.code || 'unknown'))); }

  function onCardClick(e){
    var b = e.target.closest('[data-act]'); if(!b) return;
    var act = b.getAttribute('data-act');
    var email = (document.getElementById('clEmail') || {}).value; email = email ? email.trim() : '';
    var pass = (document.getElementById('clPass') || {}).value || '';
    if(act === 'close'){ closeModal(); return; }
    if(act === 'tab-signin'){ authMode = 'signin'; authView(); return; }
    if(act === 'tab-signup'){ authMode = 'signup'; authView(); return; }
    if(act === 'buy'){ var C = window.LICENSE_CONFIG || {}; try{ window.open(C.buyUrl, '_blank', 'noopener'); }catch(er){} return; }
    if(act === 'plans'){ openPaywall(); return; }
    if(act === 'copyinfo'){ copyText(b.getAttribute('data-info') || ''); return; }
    if(act === 'signout'){ signOutFlow(); return; }
    if(act === 'syncnow'){ setMsg(T('در حال همگام‌سازی...', 'Syncing...')); afterLogin().then(function(){ setMsg(T('همگام‌سازی انجام شد.', 'Synced.'), 'ok'); }); return; }
    if(act === 'migrate'){ openMigration(); return; }
    if(act === 'legacybackup'){ downloadLegacyBackup(); return; }
    if(act === 'runmigrate'){ runMigration(document.getElementById('clMsg')); return; }
    if(act === 'forgot'){
      if(!email){ setMsg(T('ایمیل را وارد کنید.', 'Enter your email.'), 'err'); return; }
      auth.recover(email, captchaToken).then(function(){ setMsg(T('اگر این ایمیل ثبت‌نام کرده باشد، لینک بازیابی رمز برایش ارسال شد.', 'If this email is registered, a reset link was sent.'), 'ok'); })
        .catch(function(er){ setMsg(authError(er), 'err'); });
      return;
    }
    if(act === 'resend'){
      if(!email){ setMsg(T('ایمیل را وارد کنید.', 'Enter your email.'), 'err'); return; }
      auth.resend(email, captchaToken).then(function(){ setMsg(T('ایمیل تأیید دوباره ارسال شد.', 'Confirmation email re-sent.'), 'ok'); })
        .catch(function(er){ setMsg(authError(er), 'err'); });
      return;
    }
    if(act === 'setpass'){
      if(pass.length < 8){ setMsg(errText('weak_password'), 'err'); return; }
      auth.updatePassword(pass).then(function(){ closeModal(); toast(T('رمز جدید ذخیره شد.', 'Password saved.')); afterLogin(); })
        .catch(function(er){ setMsg(authError(er), 'err'); });
      return;
    }
    if(act === 'submit'){
      if(!email || pass.length < 8){ setMsg(!email ? T('ایمیل را وارد کنید.', 'Enter your email.') : errText('weak_password'), 'err'); return; }
      if(CFG.captcha && CFG.captcha.provider && CFG.captcha.siteKey && !captchaToken){ setMsg(errText('captcha_failed'), 'err'); return; }
      setMsg(T('لطفاً صبر کنید...', 'Please wait...'));
      if(authMode === 'signin'){
        auth.signIn(email, pass, captchaToken).then(function(){ closeModal(); toast(T('وارد شدید.', 'Signed in.')); afterLogin(); })
          .catch(function(er){ setMsg(authError(er), 'err'); loadCaptcha(); });
      } else {
        auth.signUp(email, pass, captchaToken).then(function(r){
          if(r.session){ closeModal(); afterLogin(); }
          else setMsg(T('حساب ساخته شد. لینک تأیید به ایمیل شما ارسال شد؛ بعد از تأیید، وارد شوید. (پوشهٔ هرزنامه را هم ببینید.)', 'Account created. A confirmation link was emailed to you; confirm, then sign in. (Check spam too.)'), 'ok');
        }).catch(function(er){ setMsg(authError(er), 'err'); loadCaptcha(); });
      }
    }
  }

  // ---------- برند، وضعیت پولی ----------
  function installBrand(){
    window.__licPaid = function(){ return !!(account && account.state && account.state.paid); };
    window.__licBrand = function(){
      var C = window.LICENSE_CONFIG || {};
      if(C.brandEnabled === false) return '';
      if(window.__invBrandFree && window.__invBrandFree()) return '';
      if(window.__licPaid()) return '';
      var url = String(C.brandUrl || siteBase()).replace(/^https?:\/\//, '');
      var txt = (isFa() ? C.brandText : (C.brandText_en || C.brandText)) || T('ساخته‌شده با فاکتورساز', 'Made with Factor-Saz');
      return '<div class="inv-brand-line">' + esc(txt) + ' · <bdi>' + esc(url) + '</bdi></div>';
    };
  }

  // ---------- راه‌اندازی ----------
  function handleHash(){
    if(!location.hash || location.hash.length < 3) return null;
    var r = auth.setSessionFromHash(location.hash);
    if(r){ try{ history.replaceState(null, '', location.pathname + location.search); }catch(e){} }
    return r;
  }
  var hashResult = handleHash();

  window.Cloud = {
    active: function(){ return true; },
    loggedIn: function(){ return !!session; },
    verified: function(){ return !!(account && account.email_confirmed); },
    openAuth: openAuth, openAccount: openAccount, openMigration: openMigration, openPaywall: openPaywall,
    saveInvoice: saveInvoice, handleSaveError: handleSaveError,
    onRecordsWrite: onRecordsWrite,
    queueDelete:  function(id){ if(session) enqueue({ op:'delete',  id: id, t: Date.now() }); },
    queueRestore: function(id){ if(session) enqueue({ op:'restore', id: id, t: Date.now() }); },
    queuePurge:   function(id){ if(session) enqueue({ op:'purge',   id: id, t: Date.now() }); },
    onSettingChanged: onSettingChanged,
    pull: pull, flush: flushQueue, afterLogin: afterLogin,
    paid: function(){ return !!(account && account.state && account.state.paid); },
    account: function(){ return account; },
    rerender: function(){ renderChip(); if(overlay && overlay.classList.contains('open') && session) openAccount(); },
    setState: function(state){ if(state){ account = Object.assign({}, account || {}, { state: state }); renderChip(); } },
    wipe: wipeCache
  };

  on('signedout', function(){ renderChip(); openAuth(errText('session_expired')); });

  // پنجرهٔ «انتخاب شغل» (اولین ورود) نباید زیر پنجرهٔ ورود بماند؛ اول شغل انتخاب شود، بعد ورود/ثبت‌نام
  function whenJobChosen(fn){
    var jo = document.getElementById('jobOverlay');
    if(!jo || !jo.classList.contains('open')){ fn(); return; }
    var t = setInterval(function(){ if(!jo.classList.contains('open')){ clearInterval(t); fn(); } }, 400);
  }
  function boot(){
    IS_APP = !!document.getElementById('invoiceSheet');
    if(!IS_APP) return;
    installBrand();
    if(window.__cloudRefreshPreview) window.__cloudRefreshPreview();
    setupDom();
    card().addEventListener('click', onCardClick);
    var cached = readJSON('inv_cloud_account', null); if(cached && session) account = cached;
    renderChip();
    if(hashResult && hashResult.error){ openAuth(T('لینک نامعتبر یا منقضی است؛ دوباره تلاش کنید.', 'The link is invalid or expired; try again.')); }
    else if(hashResult && hashResult.type === 'recovery'){ openRecovery(); }
    else if(session){ afterLogin(); }
    else if(CFG.requireLoginOnStart){ whenJobChosen(function(){ if(!session) openAuth(); }); }
    window.addEventListener('online', function(){ if(session){ flushQueue(); afterLogin(); } });
    document.addEventListener('visibilitychange', function(){ if(!document.hidden && session && account && Date.now() - (Cloud._t || 0) > 120000){ Cloud._t = Date.now(); loadAccount().then(function(){ return pull(); }).catch(function(){}); } });
    setInterval(function(){ if(session && !document.hidden){ loadAccount().then(function(){ return pull(); }).then(flushQueue).catch(function(){}); } }, 300000);
    if(hashResult && hashResult.type && hashResult.type !== 'recovery' && session){ toast(T('ایمیل شما تأیید شد.', 'Your email is confirmed.')); }
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
