# BOZINO — راهنمای اجرا
نیازمندی: Node.js نسخهٔ ۲۲.۵ یا بالاتر (بدون npm install).
اجرا: `ADMIN_PASSWORD=رمزتان PORT=3000 node --no-warnings server.js`
سایت: / — پنل مدیریت: /admin — دیتابیس: bozino.db (SQLite دائمی)
نکته‌ها: پشت HTTPS (nginx/Caddy) منتشر کنید. تنظیمات مختصات کافه، هزینه ارسال و تلگرام داخل پنل > تنظیمات است.
ورود مشتری با OTP است؛ برای پیامک واقعی، در server.js بخش /api/customer/otp را به سرویس پیامک وصل کنید (برای تست: SHOW_OTP=1).
