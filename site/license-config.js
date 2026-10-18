// ============================================================================
//  تنظیمات لایسنس و اشتراک فاکتورساز
//  این فایل را فقط شما (فروشنده) ویرایش می‌کنید و کنار index.html روی سایت می‌گذارید.
//  هرگز «کلید خصوصی» را اینجا یا روی سایت نگذارید.
// ============================================================================
window.LICENSE_CONFIG = {

  // کلید عمومی (خروجی ابزار license-generator.html). خالی (null) = قفل خاموش
  publicKey: {"kty":"EC","crv":"P-256","x":"pFne4CuYe0mXZI8ZRCpomXzPgX1CeA-jdPCHllPjs0o","y":"NFzdpc1ipRW6G9jTyj2pWlzm0Ogu6SJ5rUr7qhx32Ew"},

  // تعداد فاکتور رایگان (ساخت فاکتور «جدید»؛ ویرایش فاکتورهای قبلی شمرده نمی‌شود)
  freeInvoices: 5,

  // لینک خرید (دکمهٔ «خرید / دریافت کد فعال‌سازی» در پنجرهٔ قفل)
  buyUrl: 'https://t.me/Taha_r6',
  buyLabel: 'خرید / دریافت کد فعال‌سازی',
  buyLabel_en: 'Buy / get an activation code',

  // دکمهٔ تمدید (در هشدار پایان اشتراک و پنجرهٔ تمدید). renewUrl خالی = همان buyUrl
  renewUrl: '',
  renewLabel: '🔄 تمدید اشتراک',
  renewLabel_en: '🔄 Renew subscription',

  // چند روز مانده به پایان اشتراک، نوار هشدار تمدید نشان داده شود
  expiryWarnDays: 7,

  // هر کد اشتراک تا چند روز بعد از ساخته‌شدن قابل فعال‌سازی است
  activationWindowDays: 180,

  message: '',
  message_en: '',

  contact: 'بعد از پرداخت، «کد دستگاه» خود را برای ما بفرستید تا کد فعال‌سازی را دریافت کنید. تلگرام: @Taha_r6 — ایتا: @IceCube',
  contact_en: 'After payment, send us your device code to receive your activation code. Telegram: @Taha_r6 — Eitaa: @IceCube',

  showDeviceCode: true,

  // دکمهٔ ثابت «💬 پشتیبانی» بالای صفحه (هر تعداد لینک که بخواهید)
  supports: [
    { label: 'تلگرام', label_en: 'Telegram', url: 'https://t.me/Taha_r6' },
    { label: 'ایتا',   label_en: 'Eitaa',    url: 'https://eitaa.com/IceCube' },
  ],

  // برند روی فاکتورهای نسخهٔ رایگان (با خرید بسته یا اشتراک حذف می‌شود).
  // brandEnabled: false = هیچ‌وقت نمایش داده نشود. brandUrl خالی = آدرس همین سایت.
  brandEnabled: true,
  brandText: 'ساخته‌شده با فاکتورساز',
  brandText_en: 'Made with Factor-Saz',
  brandUrl: '',

  // پلن‌هایی که به مشتری نشان داده می‌شود (فقط نمایشی؛ نوع و مدت واقعی را موقع ساخت کد تعیین می‌کنید)
  plans: [
    { title: 'بستهٔ ۵ فاکتور',   price: '۲۵,۰۰۰ تومان',    note: 'بدون تاریخ انقضا', title_en: '5-invoice pack',   price_en: '25,000 Toman',    note_en: 'No expiry' },
    { title: 'بستهٔ ۲۰ فاکتور',  price: '۹۰,۰۰۰ تومان',    note: 'بدون تاریخ انقضا', title_en: '20-invoice pack',  price_en: '90,000 Toman',    note_en: 'No expiry' },
    { title: 'بستهٔ ۵۰ فاکتور',  price: '۲۱۰,۰۰۰ تومان',   note: 'بدون تاریخ انقضا', title_en: '50-invoice pack',  price_en: '210,000 Toman',   note_en: 'No expiry' },
    { title: 'بستهٔ ۱۰۰ فاکتور', price: '۳۸۰,۰۰۰ تومان',   note: 'بدون تاریخ انقضا', title_en: '100-invoice pack', price_en: '380,000 Toman',   note_en: 'No expiry' },
    { title: 'اشتراک ماهانه',    price: '۱۵۰,۰۰۰ تومان',   note: 'فاکتور نامحدود',   title_en: 'Monthly',          price_en: '150,000 Toman',   note_en: 'Unlimited invoices' },
    { title: 'اشتراک سالانه',    price: '۱,۲۰۰,۰۰۰ تومان', note: 'فاکتور نامحدود',   title_en: 'Yearly',           price_en: '1,200,000 Toman', note_en: 'Unlimited invoices' },
  ],
};
