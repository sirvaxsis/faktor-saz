(function () {
  'use strict';
  var memory = Object.create(null);
  var failed = false;
  function warn() {
    failed = true;
    function show() {
      if (!document.body || document.getElementById('storageWarning')) return;
      var banner = document.createElement('div');
      banner.id = 'storageWarning';
      banner.setAttribute('role', 'alert');
      banner.style.cssText = 'position:sticky;top:0;z-index:100000;padding:12px;background:#fff3cd;color:#664d03;text-align:center';
      banner.textContent = storage.get('inv_lang') === 'en'
        ? 'Browser storage is unavailable or full. Changes are temporary until synced. Download a backup before closing this page.'
        : 'فضای ذخیرهٔ مرورگر در دسترس نیست یا پر شده است. تغییرات تا زمان همگام‌سازی موقت‌اند؛ پیش از بستن صفحه فایل پشتیبان بگیرید.';
      document.body.prepend(banner);
    }
    if (document.body) show();
    else document.addEventListener('DOMContentLoaded', show, { once: true });
  }
  var storage = {
    get: function (key) {
      if (Object.prototype.hasOwnProperty.call(memory, key)) return memory[key];
      try { return localStorage.getItem(key); } catch (e) { return null; }
    },
    set: function (key, value) {
      value = String(value);
      try { localStorage.setItem(key, value); delete memory[key]; return true; }
      catch (e) { memory[key] = value; warn(); return false; }
    },
    del: function (key) {
      try { localStorage.removeItem(key); delete memory[key]; return true; }
      catch (e) { memory[key] = null; warn(); return false; }
    },
    keys: function () {
      var keys = Object.keys(memory);
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var key = localStorage.key(i);
          if (keys.indexOf(key) < 0) keys.push(key);
        }
      } catch (e) {}
      return keys.filter(function (key) { return storage.get(key) !== null; });
    },
    volatile: function () { return failed; }
  };
  window.InvoiceStorage = storage;
})();
