(function () {
  'use strict';
  function positive(value) {
    var n = Number(value);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }
  function safeLogo(value) {
    return typeof value === 'string' && value.length <= 1800000 &&
      /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon);base64,[A-Za-z0-9+/]+={0,2}$/i.test(value) ? value : '';
  }
  function totals(items, discount, taxPercent, legacy) {
    var lineGross = items.map(function (it) { return positive(it.qty) * positive(it.unitPrice); });
    var subtotal = lineGross.reduce(function (sum, value) { return sum + value; }, 0);
    discount = Math.min(subtotal, positive(discount));
    var ratio = subtotal ? (subtotal - discount) / subtotal : 0;
    var lineNet = lineGross.map(function (value) { return value * ratio; });
    var lineTaxes = items.map(function (it, i) {
      var rate = positive(it.useCustomTax ? it.customTaxPercent : taxPercent);
      return Math.round((legacy ? lineGross[i] : lineNet[i]) * rate / 100);
    });
    var taxAmount = lineTaxes.reduce(function (sum, value) { return sum + value; }, 0);
    return { subtotal: subtotal, discount: discount, afterDiscount: subtotal - discount,
      taxAmount: taxAmount, grandTotal: subtotal - discount + taxAmount,
      lineNet: lineNet, lineTaxes: lineTaxes };
  }
  window.InvoiceCore = { safeLogo: safeLogo, totals: totals };
})();
