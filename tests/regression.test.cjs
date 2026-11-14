const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const site = path.join(__dirname, '../site');
const read = name => fs.readFileSync(path.join(site, name), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function environment(initial = {}, unavailable = false) {
  const values = new Map(Object.entries(initial));
  const context = {
    document: { readyState: 'loading', body: null, addEventListener() {}, getElementById() { return null; } },
    location: { hash: '', origin: 'http://localhost', pathname: '/', search: '' },
    navigator: {}, setTimeout() {}, setInterval() {}, clearInterval() {},
    crypto: require('node:crypto').webcrypto,
    localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem(key, value) { if (unavailable) throw Error('full'); values.set(key, String(value)); },
      removeItem(key) { if (unavailable) throw Error('blocked'); values.delete(key); },
      get length() { return values.size; }, key: i => [...values.keys()][i]
    }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(read('storage.js'), context);
  vm.runInContext(read('invoice-core.js'), context);
  return context;
}

function cloudEnvironment(initial = {}) {
  const context = environment({
    inv_cloud_session: JSON.stringify({ access_token: 'test', refresh_token: 'refresh',
      expires_at: 9999999999, user: { id: 'user-a' } }), ...initial
  });
  context.CLOUD_CONFIG = { supabaseUrl: 'https://test.invalid', anonKey: 'public-test-key' };
  let source = read('cloud.js');
  const end = source.lastIndexOf('})();');
  source = source.slice(0, end) + `
    window.harness = { enqueue:enqueue, pull:pull,
      setRpc:function(fn){ rpc=fn; }, setSelect:function(fn){ select=fn; } };
    account={id:'user-a',email_confirmed:true};
  ` + source.slice(end);
  vm.runInContext(source, context);
  return context;
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('storage reads the newest value after quota failure and includes it in backup keys', () => {
  const c = environment({ inv_records: 'old' }, true);
  assert.equal(c.InvoiceStorage.set('inv_records', 'new'), false);
  assert.equal(c.InvoiceStorage.get('inv_records'), 'new');
  c.InvoiceStorage.set('inv_new_setting', 'value');
  assert.ok(c.InvoiceStorage.keys().includes('inv_new_setting'));
  c.InvoiceStorage.del('inv_records');
  assert.equal(c.InvoiceStorage.get('inv_records'), null);
  assert.ok(!c.InvoiceStorage.keys().includes('inv_records'));
});

test('logo validation rejects markup, SVG and external URLs but accepts uploaded raster images', () => {
  const c = environment();
  for (const value of ['x" onerror="alert(document.domain)', 'data:image/svg+xml;base64,PHN2Zz4=', 'https://example.com/logo.png', {}, null]) {
    assert.equal(c.InvoiceCore.safeLogo(value), '');
  }
  const logo = 'data:image/png;base64,aGVsbG8=';
  assert.equal(c.InvoiceCore.safeLogo(logo), logo);
});

test('discount is allocated before mixed tax; full/excess discount produces zero payable', () => {
  const core = environment().InvoiceCore;
  const items = [{ qty: 1, unitPrice: 1000 }, { qty: 1, unitPrice: 1000, useCustomTax: true, customTaxPercent: 20 }];
  const t = core.totals(items, 1000, 10);
  assert.equal(t.taxAmount, 150);
  assert.equal(t.grandTotal, 1150);
  assert.deepEqual(plain(t.lineTaxes), [50, 100]);
  assert.equal(core.totals(items, 2000, 10).grandTotal, 0);
  assert.equal(core.totals(items, 9000, 10).discount, 2000);
  assert.equal(core.totals([], 100, 10).grandTotal, 0);
  assert.equal(core.totals(items, 1000, 10, true).taxAmount, 300);
});

test('newer edit survives an in-flight save and uses its returned revision', async () => {
  const c = cloudEnvironment();
  const calls = [], responses = [];
  c.harness.setRpc((name, args) => {
    if (name === 'purge_old_trash') return Promise.resolve({ ok: true });
    calls.push(plain(args));
    return new Promise(resolve => responses.push(resolve));
  });
  c.harness.setSelect(() => Promise.resolve([]));
  c.harness.enqueue({ op: 'save', id: 'invoice-a', record: { paidStatus: 'paid' }, rev: 1 });
  c.harness.enqueue({ op: 'save', id: 'invoice-a', record: { paidStatus: 'unpaid' }, rev: 1 });
  responses.shift()({ ok: true, id: 'invoice-a', rev: 2 });
  await tick();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].p_data.paidStatus, 'unpaid');
  assert.equal(calls[1].p_base_rev, 2);
  responses.shift()({ ok: true, id: 'invoice-a', rev: 3 });
  await tick();
  assert.equal(c.InvoiceStorage.get('inv_cloud_queue'), null);
});

test('network retry keeps request identity so a committed request cannot consume quota twice', async () => {
  const c = cloudEnvironment();
  const calls = [];
  c.harness.setRpc((name, args) => { calls.push(plain(args)); return Promise.reject({ code: 'offline' }); });
  c.harness.enqueue({ op: 'save', id: 'invoice-a', record: {}, rev: 1 });
  await tick();
  await c.Cloud.flush();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].p_request_id, calls[1].p_request_id);
  assert.equal(JSON.parse(c.InvoiceStorage.get('inv_cloud_queue')).length, 1);
});

test('pull retains pending local changes when the server has an older version', async () => {
  const c = cloudEnvironment({
    inv_records: JSON.stringify([{ id: 'invoice-a', _rev: 1, paidStatus: 'paid' }]),
    inv_cloud_queue: JSON.stringify([{ token: 'pending', id: 'invoice-a', op: 'save' }])
  });
  c.harness.setRpc(() => Promise.resolve({ ok: true }));
  c.harness.setSelect(() => Promise.resolve([{ id: 'invoice-a', rev: 1, deleted_at: null }]));
  await c.harness.pull();
  assert.equal(JSON.parse(c.InvoiceStorage.get('inv_records'))[0].paidStatus, 'paid');
});

test('rejected edits are archived for recovery instead of being silently discarded', async () => {
  const c = cloudEnvironment();
  c.harness.setRpc(name => Promise.resolve(name === 'save_invoice' ? { ok: false, error: 'stale_revision' } : { ok: true }));
  c.harness.setSelect(() => Promise.resolve([]));
  c.harness.enqueue({ op: 'save', id: 'invoice-a', record: { note: 'keep this' }, rev: 1 });
  await tick();
  const conflicts = JSON.parse(c.InvoiceStorage.get('inv_sync_conflicts'));
  assert.equal(conflicts[0].operation.record.note, 'keep this');
  assert.equal(conflicts[0].error, 'stale_revision');
});

test('an older pull cannot overwrite a revision saved while its response was in flight', async () => {
  const c = cloudEnvironment({ inv_records: JSON.stringify([{ id: 'invoice-a', _rev: 1, note: 'old' }]) });
  let resolveFull;
  c.harness.setRpc(() => Promise.resolve({ ok: true }));
  c.harness.setSelect((table, query) => query.startsWith('select=id,rev')
    ? Promise.resolve([{ id: 'invoice-a', rev: 2, deleted_at: null }])
    : new Promise(resolve => { resolveFull = resolve; }));
  const pulling = c.harness.pull();
  await tick();
  c.InvoiceStorage.set('inv_records', JSON.stringify([{ id: 'invoice-a', _rev: 3, note: 'just saved' }]));
  resolveFull([{ id: 'invoice-a', rev: 2, data: { note: 'older remote snapshot' } }]);
  await pulling;
  assert.equal(JSON.parse(c.InvoiceStorage.get('inv_records'))[0].note, 'just saved');
});

test('an invoice created during a pull is kept even when absent from its remote snapshot', async () => {
  const c = cloudEnvironment();
  let resolveRows;
  c.harness.setRpc(() => Promise.resolve({ ok: true }));
  c.harness.setSelect(() => new Promise(resolve => { resolveRows = resolve; }));
  const pulling = c.harness.pull();
  await tick();
  c.InvoiceStorage.set('inv_records', JSON.stringify([{ id: 'invoice-new', _rev: 1 }]));
  resolveRows([]);
  await pulling;
  assert.equal(JSON.parse(c.InvoiceStorage.get('inv_records'))[0].id, 'invoice-new');
});

test('all application scripts parse, including admin; record identifiers are escaped', () => {
  for (const file of ['storage.js', 'invoice-core.js', 'cloud.js', 'sw.js', 'license-config.js', 'cloud-config.js']) new vm.Script(read(file));
  for (const file of ['index.html', 'admin.html']) {
    for (const match of read(file).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
      if (match[1].trim()) new vm.Script(match[1]);
    }
    assert.ok(read(file).indexOf('storage.js') < read(file).indexOf('cloud.js'));
  }
  assert.ok(!read('index.html').includes('${r.id}'));
});
