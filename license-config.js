// ============================================================================
//  تنظیمات لایسنس و اشتراک فاکتورساز
//  این فایل را فقط شما (فروشنده) ویرایش می‌کنید و کنار index.html روی سایت می‌گذارید.
//
//  ● تا وقتی publicKey خالی (null) باشد، قفل خاموش است و همه‌چیز رایگان و نامحدود است.
//  ● کلید عمومی را از ابزار license-generator.html (که فقط روی کامپیوتر خودتان باز می‌کنید) می‌گیرید.
//  ● هرگز «کلید خصوصی» را اینجا یا روی سایت نگذارید.
// ============================================================================
window.LICENSE_CONFIG = {

  // کلید عمومی (خروجی ابزار license-generator.html؛ یک شیء با kty/crv/x/y). خالی = قفل خاموش
    publicKey: {"kty":"EC","crv":"P-256","x":"pFne4CuYe0mXZI8ZRCpomXzPgX1CeA-jdPCHllPjs0o","y":"NFzdpc1ipRW6G9jTyj2pWlzm0Ogu6SJ5rUr7qhx32Ew"},
  /* مثال:
  publicKey: { "kty": "EC", "crv": "P-256", "x": "....", "y": "...." },
  */

  // تعداد فاکتور رایگان (ساخت فاکتور «جدید»؛ ویرایش فاکتورهای قبلی شمرده نمی‌شود)
  freeInvoices: 5,

  // لینک خرید یا ارتباط با شما (درگاه پرداخت، تلگرام، واتساپ و ...). خالی = دکمه نمایش داده نمی‌شود
               // مثلاً 'https://t.me/your_id'
 
 buyUrl: 'https://t.me/Taha_r6',
  buyLabel: 'خرید / دریافت کد فعال‌سازی',
  buyLabel_en: 'Buy / get an activation code',


  // متن بالای پنجرهٔ قفل (اختیاری؛ خالی = متن پیش‌فرض)
  message: '',
  message_en: '',

  // توضیح تماس زیر دکمهٔ خرید (اختیاری)
             // مثلاً 'پس از پرداخت، کد دستگاه خود را برای ما بفرستید تا کد فعال‌سازی بگیرید.'
  
  contact: 'بعد از پرداخت، «کد دستگاه» خود را برای ما بفرستید تا کد فعال‌سازی را دریافت کنید. تلگرام: @Taha_r6 — ایتا: @IceCube',
  contact_en: 'After payment, send us your device code to receive your activation code. Telegram: @Taha_r6 — Eitaa: @IceCube',

  // نمایش «کد دستگاه» در پنجرهٔ قفل (برای صدور کدهای اختصاصی یک دستگاه)
  showDeviceCode: true,

  // لیست پلن‌هایی که به مشتری نشان داده می‌شود (فقط نمایشی؛ نوع و مدت واقعی را موقع ساخت کد تعیین می‌کنید)

  plans: [
    { title: 'بستهٔ ۵ فاکتور',   price: '۲۵,۰۰۰ تومان',    note: 'بدون تاریخ انقضا', title_en: '5-invoice pack',   price_en: '25,000 Toman',    note_en: 'No expiry' },
    { title: 'بستهٔ ۲۰ فاکتور',  price: '۹۰,۰۰۰ تومان',    note: 'بدون تاریخ انقضا', title_en: '20-invoice pack',  price_en: '90,000 Toman',    note_en: 'No expiry' },
    { title: 'بستهٔ ۵۰ فاکتور',  price: '۲۱۰,۰۰۰ تومان',   note: 'بدون تاریخ انقضا', title_en: '50-invoice pack',  price_en: '210,000 Toman',   note_en: 'No expiry' },
    { title: 'بستهٔ ۱۰۰ فاکتور', price: '۳۸۰,۰۰۰ تومان',   note: 'بدون تاریخ انقضا', title_en: '100-invoice pack', price_en: '380,000 Toman',   note_en: 'No expiry' },
    { title: 'اشتراک ماهانه',    price: '۱۵۰,۰۰۰ تومان',   note: 'فاکتور نامحدود', title_en: 'Monthly',          price_en: '150,000 Toman',   note_en: 'Unlimited invoices' },
    { title: 'اشتراک سالانه',    price: '۱,۲۰۰,۰۰۰ تومان', note: 'فاکتور نامحدود', title_en: 'Yearly',           price_en: '1,200,000 Toman', note_en: 'Unlimited invoices' },
  ],
};
