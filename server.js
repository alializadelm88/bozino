// BOZINO - بدون وابستگی خارجی. اجرا: ADMIN_PASSWORD=رمز node server.js
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(process.env.DB_PATH||'bozino.db');
db.exec(`CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY,name,description,price INTEGER,image,category,available INTEGER DEFAULT 1,blends,prep_min INTEGER DEFAULT 5,options);
CREATE TABLE IF NOT EXISTS settings(k PRIMARY KEY,v);
CREATE TABLE IF NOT EXISTS customers(id INTEGER PRIMARY KEY,code UNIQUE,name,phone UNIQUE,addresses TEXT DEFAULT '[]');
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY,code UNIQUE,idem UNIQUE,customer_id INTEGER,customer_code,name,phone,address,hood,note,lat REAL,lng REAL,items TEXT,subtotal INTEGER,discount INTEGER,delivery INTEGER,total INTEGER,eta_min INTEGER,status TEXT DEFAULT 'سفارش جدید',paid INTEGER DEFAULT 0,method,created TEXT);
CREATE TABLE IF NOT EXISTS coupons(code PRIMARY KEY,percent INTEGER,active INTEGER DEFAULT 1);`);
const DEF={cafe_lat:38.08,cafe_lng:46.2919,base_fee:20000,per_km:8000,min_fee:25000,max_km:12,free_over:0,min_order:0,open:1,notice:'',per_order_queue_min:5,travel_min_per_km:3,blends_custom:0,telegram_token:'',telegram_chat:'',open_hour:8,close_hour:23};
for(const[k,v]of Object.entries(DEF))db.prepare('INSERT OR IGNORE INTO settings VALUES(?,?)').run(k,JSON.stringify(v));
if(!db.prepare('SELECT 1 FROM products').get()){const B=JSON.stringify([[100,0],[70,30],[50,50],[30,70],[0,100]]);
[['لاته با شیر بز','اسپرسو با شیر تازهٔ بز',180000,'لاته',6],['اسپرسو','یک شات اسپرسوی خالص',90000,'اسپرسو',3],['اسپرسو دبل','دو شات اسپرسو',130000,'اسپرسو',4]]
.forEach(p=>db.prepare('INSERT INTO products(name,description,price,category,blends,prep_min,image,options) VALUES(?,?,?,?,?,?,?,?)').run(p[0],p[1],p[2],p[3],B,p[4],'','[]'));}
try{db.exec('ALTER TABLE customers ADD COLUMN pass TEXT')}catch{}
const S=()=>Object.fromEntries(db.prepare('SELECT * FROM settings').all().map(r=>[r.k,JSON.parse(r.v)]));
const ADMIN_PASS=process.env.ADMIN_PASSWORD||(()=>{const p=crypto.randomBytes(5).toString('hex');console.log('رمز مدیر (موقت):',p);return p})();
const nd=x=>String(x||'').trim().replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const hp=p=>{const s=crypto.randomBytes(16).toString('hex');return s+':'+crypto.scryptSync(p,s,32).toString('hex')};
const vp=(p,h)=>{const[s,k]=h.split(':');return crypto.timingSafeEqual(Buffer.from(k,'hex'),crypto.scryptSync(p,s,32))};
const tokens=new Map(),fails=new Map(),sessions=new Map(),rate=new Map();
const hav=(a,b,c,d)=>{const r=x=>x*Math.PI/180,h=Math.sin(r(c-a)/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(r(d-b)/2)**2;return 6371*2*Math.asin(Math.sqrt(h))*1.3};
function quote(b){const s=S(),items=[];let sub=0,prep=0;
 if(!Array.isArray(b.items)||!b.items.length)throw'سبد خرید خالی است';
 for(const i of b.items){const p=db.prepare('SELECT * FROM products WHERE id=?').get(+i.id);const q=Math.floor(+i.qty);
  if(!p||!p.available)throw'محصول ناموجود است';if(!(q>0&&q<=50))throw'تعداد نامعتبر';
  const bl=JSON.parse(p.blends).find(x=>x[0]==+i.arabica&&x[0]+x[1]==100);
  if(!bl&&!(s.blends_custom&&+i.arabica>=0&&+i.arabica<=100))throw'ترکیب قهوه مجاز نیست';
  const ar=+i.arabica;items.push({id:p.id,name:p.name,qty:q,price:p.price,arabica:ar,robusta:100-ar});sub+=p.price*q;prep+=p.prep_min*q}
 let discount=0;if(b.coupon){const c=db.prepare('SELECT * FROM coupons WHERE code=? AND active=1').get(String(b.coupon));if(!c)throw'کد تخفیف نامعتبر است';discount=Math.floor(sub*c.percent/100)}
 if(sub<s.min_order)throw'حداقل مبلغ سفارش '+s.min_order+' تومان است';
 let km=null,delivery=null,eta=null;
 if(b.lat!=null){km=hav(s.cafe_lat,s.cafe_lng,+b.lat,+b.lng);if(!isFinite(km)||km>s.max_km)throw'آدرس شما خارج از محدودهٔ ارسال است';
  delivery=Math.max(s.min_fee,Math.round((s.base_fee+km*s.per_km)/1000)*1000);if(s.free_over>0&&sub-discount>=s.free_over)delivery=0;
  const queue=db.prepare("SELECT COUNT(*) n FROM orders WHERE status IN ('سفارش جدید','تأیید شده','در حال آماده‌سازی')").get().n;
  eta=Math.round(queue*s.per_order_queue_min+prep+km*s.travel_min_per_km)}
 return{items,subtotal:sub,discount,delivery,total:sub-discount+(delivery||0),km:km&&+km.toFixed(1),eta_min:eta}}
const jalali=d=>new Intl.DateTimeFormat('fa-IR-u-ca-persian',{dateStyle:'medium',timeStyle:'short'}).format(d);
async function tg(o){const s=S();if(!s.telegram_token||!s.telegram_chat)return;
 const t=`🆕 سفارش ${o.code}\nمشتری: ${o.customer_code} - ${o.name}\nتلفن: ${o.phone}\nآدرس: ${o.address}\n${o.items.map(i=>`• ${i.name} ×${i.qty} (${i.arabica}% عربیکا)`).join('\n')}\nمبلغ کل: ${o.total} تومان\n${o.created}`;
 try{await fetch(`https://api.telegram.org/bot${s.telegram_token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:s.telegram_chat,text:t})})}catch{}}
const J=(r,c,o)=>{r.writeHead(c,{'content-type':'application/json; charset=utf-8'});r.end(JSON.stringify(o))};
const body=q=>new Promise((ok,no)=>{let d='';q.on('data',c=>{d+=c;if(d.length>3e6)q.destroy()});q.on('end',()=>{try{ok(d?JSON.parse(d):{})}catch{no('bad json')}})});
const pub=p=>({id:p.id,name:p.name,description:p.description,price:p.price,image:p.image,category:p.category,available:!!p.available,blends:JSON.parse(p.blends)});
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
http.createServer(async(q,r)=>{try{const u=new URL(q.url,'http://x'),P=u.pathname;
 if(!P.startsWith('/api/')){let f=path.join(__dirname,'public',P==='/'?'index.html':P==='/admin'?'admin.html':P);
  if(!f.startsWith(path.join(__dirname,'public'))||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('404')}
  r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});return fs.createReadStream(f).pipe(r)}
 const ip=q.socket.remoteAddress,n=(rate.get(ip)||0)+1;rate.set(ip,n);setTimeout(()=>rate.set(ip,Math.max(0,(rate.get(ip)||1)-1)),60000);if(n>120)return J(r,429,{error:'درخواست بیش از حد'});
 const b=q.method==='GET'?{}:await body(q);const adm=()=>{if(!tokens.has((q.headers.authorization||'').slice(7))){J(r,401,{error:'دسترسی غیرمجاز'});return false}return true};
 const pubSettings=()=>{const s=S();return{open:s.open,notice:s.notice,min_order:s.min_order,max_km:s.max_km,cafe_lat:s.cafe_lat,cafe_lng:s.cafe_lng,blends_custom:s.blends_custom,free_over:s.free_over}};
 if(P==='/api/menu')return J(r,200,{products:db.prepare('SELECT * FROM products').all().map(pub),settings:pubSettings()});
 if(P==='/api/quote'&&q.method==='POST')return J(r,200,quote(b));
 if(P==='/api/order'&&q.method==='POST'){const s=S();if(!s.open)throw s.notice||'سفارش‌گیری فعلاً غیرفعال است';
  const h=new Date().getHours();if(s.open_hour<s.close_hour&&(h<s.open_hour||h>=s.close_hour))throw'خارج از ساعت کاری هستیم';
  if(!b.idem)throw'درخواست نامعتبر';const ex=db.prepare('SELECT code FROM orders WHERE idem=?').get(b.idem);if(ex)return J(r,200,{code:ex.code});
  const name=String(b.name||'').trim(),phone=nd(b.phone);
  if(name.length<3||!/^09\d{9}$/.test(phone)||String(b.address||'').length<8||b.lat==null)throw'نام، تلفن (۰۹...)، آدرس و موقعیت روی نقشه الزامی است';
  if(!['نقدی','کارت‌خوان'].includes(b.method))throw'روش پرداخت نامعتبر';
  const t=quote(b);let c=db.prepare('SELECT * FROM customers WHERE phone=?').get(phone);
  if(!c){const code='C'+crypto.randomInt(100000,999999);db.prepare('INSERT INTO customers(code,name,phone) VALUES(?,?,?)').run(code,name,phone);c=db.prepare('SELECT * FROM customers WHERE phone=?').get(phone)}
  const ad=JSON.parse(c.addresses);if(!ad.some(a=>a.address===b.address)){ad.push({address:b.address,hood:b.hood||'',lat:+b.lat,lng:+b.lng});db.prepare('UPDATE customers SET addresses=? WHERE id=?').run(JSON.stringify(ad),c.id)}
  const code='BZ'+Date.now().toString(36).toUpperCase().slice(-5)+crypto.randomInt(10,99),created=jalali(new Date());
  db.prepare('INSERT INTO orders(code,idem,customer_id,customer_code,name,phone,address,hood,note,lat,lng,items,subtotal,discount,delivery,total,eta_min,method,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
   .run(code,b.idem,c.id,c.code,name,phone,b.address,b.hood||'',b.note||'',+b.lat,+b.lng,JSON.stringify(t.items),t.subtotal,t.discount,t.delivery,t.total,t.eta_min,b.method,created);
  tg({code,customer_code:c.code,name,phone,address:b.address,items:t.items,total:t.total,created});return J(r,200,{code,customer_code:c.code,total:t.total,eta_min:t.eta_min})}
 if(P==='/api/track'){const o=db.prepare('SELECT code,status,paid,eta_min,total,created,items FROM orders WHERE code=? AND phone=?').get(String(u.searchParams.get('code')).trim().toUpperCase(),nd(u.searchParams.get('phone')));
  return o?J(r,200,{...o,items:JSON.parse(o.items)}):J(r,404,{error:'سفارشی یافت نشد'})}
 // حساب مشتری: ثبت‌نام و ورود با شماره و رمز
 if(P==='/api/customer/register'){const ph=nd(b.phone),pw=String(b.password||'');if(!/^09\d{9}$/.test(ph))throw'شماره تلفن نامعتبر است';if(pw.length<6)throw'رمز باید حداقل ۶ کاراکتر باشد';
  let c=db.prepare('SELECT * FROM customers WHERE phone=?').get(ph);
  if(c&&c.pass)throw'با این شماره قبلاً ثبت‌نام شده است؛ وارد شوید';
  if(c){const k=String(b.code||'').trim().toUpperCase();if(!(k===c.code||db.prepare('SELECT 1 FROM orders WHERE customer_id=? AND code=?').get(c.id,k)))throw'برای فعال‌سازی حساب، کد مشتری یا یکی از کدهای سفارش‌های قبلی‌تان را وارد کنید';db.prepare('UPDATE customers SET pass=? WHERE id=?').run(hp(pw),c.id)}
  else{const nm=String(b.name||'').trim();if(nm.length<3)throw'نام را وارد کنید';db.prepare('INSERT INTO customers(code,name,phone,pass) VALUES(?,?,?,?)').run('C'+crypto.randomInt(100000,999999),nm,ph,hp(pw))}
  const t=crypto.randomUUID();sessions.set(t,ph);return J(r,200,{token:t})}
 if(P==='/api/customer/login'){const ph=nd(b.phone),f=fails.get(ph)||0;if(f>=5)throw'تلاش بیش از حد؛ چند دقیقه بعد دوباره امتحان کنید';
  const c=db.prepare('SELECT * FROM customers WHERE phone=?').get(ph);if(!c||!c.pass||!vp(String(b.password||''),c.pass)){fails.set(ph,f+1);setTimeout(()=>fails.delete(ph),6e5);throw'شماره یا رمز نادرست است'}
  fails.delete(ph);const t=crypto.randomUUID();sessions.set(t,ph);return J(r,200,{token:t})}
 if(P==='/api/customer/me'){const ph=sessions.get((q.headers.authorization||'').slice(7));if(!ph)return J(r,401,{error:'ورود لازم است'});const c=db.prepare('SELECT * FROM customers WHERE phone=?').get(ph);
  if(!c)return J(r,200,{customer:null,orders:[]});return J(r,200,{customer:{code:c.code,name:c.name,phone:c.phone,addresses:JSON.parse(c.addresses)},orders:db.prepare('SELECT code,status,total,created,paid FROM orders WHERE customer_id=? ORDER BY id DESC').all(c.id)})}
 // مدیر
 if(P==='/api/admin/login'){if(b.password!==ADMIN_PASS)return J(r,401,{error:'رمز نادرست'});const t=crypto.randomUUID();tokens.set(t,1);return J(r,200,{token:t})}
 if(P.startsWith('/api/admin/')){if(!adm())return;const A=P.slice(11);
  if(A==='orders'){const rows=db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 300').all().map(o=>({...o,items:JSON.parse(o.items)}));return J(r,200,rows)}
  if(A==='order'){if(b.status)db.prepare('UPDATE orders SET status=? WHERE id=?').run(b.status,b.id);if(b.paid!=null)db.prepare('UPDATE orders SET paid=? WHERE id=?').run(b.paid?1:0,b.id);return J(r,200,{ok:1})}
  if(A==='products'){return J(r,200,db.prepare('SELECT * FROM products').all().map(p=>({...pub(p),prep_min:p.prep_min})))}
  if(A==='product'){const v=[b.name,b.description||'',+b.price,b.image||'',b.category||'',b.available?1:0,JSON.stringify(b.blends||[[100,0]]),+b.prep_min||5];
   if(b.delete)db.prepare('DELETE FROM products WHERE id=?').run(b.id);
   else if(b.id)db.prepare('UPDATE products SET name=?,description=?,price=?,image=?,category=?,available=?,blends=?,prep_min=? WHERE id=?').run(...v,b.id);
   else db.prepare('INSERT INTO products(name,description,price,image,category,available,blends,prep_min,options) VALUES(?,?,?,?,?,?,?,?,\'[]\')').run(...v);return J(r,200,{ok:1})}
  if(A==='settings'){if(q.method==='POST'){for(const k of Object.keys(DEF))if(k in b)db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run(k,JSON.stringify(b[k]))}return J(r,200,S())}
  if(A==='coupons'){if(q.method==='POST'){if(b.delete)db.prepare('DELETE FROM coupons WHERE code=?').run(b.code);else db.prepare('INSERT OR REPLACE INTO coupons VALUES(?,?,1)').run(b.code,+b.percent)}return J(r,200,db.prepare('SELECT * FROM coupons').all())}
  if(A==='customers'){const s=`%${u.searchParams.get('q')||''}%`;return J(r,200,db.prepare('SELECT c.code,c.name,c.phone,c.addresses,COUNT(o.id) orders,COALESCE(SUM(o.total),0) spent FROM customers c LEFT JOIN orders o ON o.customer_id=c.id WHERE c.code LIKE ? OR c.phone LIKE ? OR c.name LIKE ? GROUP BY c.id').all(s,s,s))}
  if(A==='reports'){const o=db.prepare("SELECT * FROM orders WHERE status!='لغوشده'").all(),now=Date.now(),day=864e5;
   const sum=(f)=>o.filter(f).reduce((a,x)=>a+x.total,0);const rid=x=>new Date(x.created_at||0);
   const top={};o.forEach(x=>JSON.parse(x.items).forEach(i=>top[i.name]=(top[i.name]||0)+i.qty));
   const rows=db.prepare("SELECT id,total,created FROM orders WHERE status!='لغوشده'").all();
   return J(r,200,{count:o.length,total:sum(()=>1),paid:sum(x=>x.paid),unpaid:sum(x=>!x.paid),unpaid_count:o.filter(x=>!x.paid).length,delivery:o.reduce((a,x)=>a+x.delivery,0),top:Object.entries(top).sort((a,b)=>b[1]-a[1])})}
  if(A==='export'){const rows=db.prepare('SELECT * FROM orders').all();const h=['code','customer_code','name','phone','address','subtotal','delivery','total','status','paid','method','created'];
   r.writeHead(200,{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename=orders.csv'});return r.end('\ufeff'+h.join(',')+'\n'+rows.map(x=>h.map(k=>`"${String(x[k]).replace(/"/g,'""')}"`).join(',')).join('\n'))}
  if(A==='backup'){db.exec("PRAGMA wal_checkpoint(FULL)");r.writeHead(200,{'content-type':'application/octet-stream','content-disposition':'attachment; filename=bozino-backup.db'});return fs.createReadStream(process.env.DB_PATH||'bozino.db').pipe(r)}
 }
 J(r,404,{error:'یافت نشد'})}catch(e){J(r,400,{error:typeof e==='string'?e:'خطای داخلی'});if(typeof e!=='string')console.error(e)}}).listen(process.env.PORT||3000,()=>console.log('BOZINO on :'+(process.env.PORT||3000)));
