// GetPRKD private statistics and anonymous shared reports (Cloudflare Worker + D1).
// Required bindings: DB (D1), IP_SALT (secret), ADMIN_TOKEN (secret).
// Set ALLOWED_ORIGIN to https://ollie61.github.io in Worker variables.
const MIN=25*60, MAX=65*60, COOLDOWN=2*60*60;
const metrics=['gives_submitted','gives_published','gives_under_25','gives_over_65','gives_outside_hours','gives_expired','gives_rate_limited','checks','checks_with_match'];
function json(data,status=200,headers={}){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...headers}})}
function day(now){return new Date(now*1000).toISOString().slice(0,10)}
async function inc(db,metric,now){await db.prepare('INSERT INTO counters(day,metric,total) VALUES(?,?,1) ON CONFLICT(day,metric) DO UPDATE SET total=total+1').bind(day(now),metric).run()}
async function digest(s){const bytes=new TextEncoder().encode(s);const hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function expire(db,now){const count=await db.prepare('SELECT COUNT(*) AS n FROM gives WHERE ends_at-? < ?').bind(now,MIN).first();if(count?.n){await db.prepare('DELETE FROM gives WHERE ends_at-? < ?').bind(now,MIN).run();await db.prepare('INSERT INTO counters(day,metric,total) VALUES(?,?,?) ON CONFLICT(day,metric) DO UPDATE SET total=total+excluded.total').bind(day(now),'gives_expired',count.n).run()}}
export default {async fetch(request,env){
 const origin=request.headers.get('Origin'),allowed=env.ALLOWED_ORIGIN||'https://ollie61.github.io';
 const cors={'Access-Control-Allow-Origin':allowed,'Vary':'Origin','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization'};
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(origin && origin!==allowed)return json({error:'Origin not allowed'},403,cors);
 const u=new URL(request.url),now=Math.floor(Date.now()/1000),db=env.DB;
 try{
 if(u.pathname==='/admin/stats'){
   if(!env.ADMIN_TOKEN||request.headers.get('Authorization')!==`Bearer ${env.ADMIN_TOKEN}`)return json({error:'Unauthorized'},401,cors);
   const rows=await db.prepare('SELECT day,metric,total FROM counters ORDER BY day DESC,metric LIMIT 5000').all();
   return json({metrics,rows:rows.results},200,cors);
 }
 if(u.pathname==='/api/check'&&request.method==='GET'){
   const spot=(u.searchParams.get('spot')||'').trim().toUpperCase();
   if(!/^[A-Z0-9-]{1,16}$/.test(spot))return json({error:'Invalid spot'},400,cors);
   await expire(db,now);await inc(db,'checks',now);
   const row=await db.prepare('SELECT ends_at FROM gives WHERE spot=? AND ends_at-? BETWEEN ? AND ? ORDER BY created_at DESC,id DESC LIMIT 1').bind(spot,now,MIN,MAX).first();
   if(row)await inc(db,'checks_with_match',now);
   return json({spot,endsAt:row?.ends_at||null},200,cors);
 }
 if(u.pathname==='/api/give'&&request.method==='POST'){
   if(!env.IP_SALT)return json({error:'Server configuration incomplete'},503,cors);
   const ip=request.headers.get('CF-Connecting-IP');if(!ip)return json({error:'Network unavailable'},400,cors);
   const key=await digest(env.IP_SALT+':'+ip);
   const body=await request.json().catch(()=>null),spot=String(body?.spot||'').trim().toUpperCase(),end=Number(body?.endsAt);
   if(!/^[A-Z0-9-]{1,16}$/.test(spot)||!Number.isInteger(end))return json({error:'Invalid submission'},400,cors);
   await db.prepare('DELETE FROM limits WHERE last_attempt < ?').bind(now-COOLDOWN).run();
   const lock=await db.prepare('INSERT INTO limits(ip_hash,last_attempt) VALUES(?,?) ON CONFLICT(ip_hash) DO UPDATE SET last_attempt=excluded.last_attempt WHERE last_attempt<=?').bind(key,now,now-COOLDOWN).run();
   if(lock.meta.changes===0){await inc(db,'gives_rate_limited',now);return json({error:'Please try again in two hours',code:'rate_limited'},429,cors)}
   await inc(db,'gives_submitted',now);
   const clock=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Toronto',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(end*1000);
   const [hour,minute]=clock.split(':').map(Number),clockMinutes=hour*60+minute;
   const remaining=end-now;
   if(clockMinutes<565||clockMinutes>1260){await inc(db,'gives_outside_hours',now);return json({thanks:true,published:false},200,cors)}
   if(remaining<MIN){await inc(db,'gives_under_25',now);return json({thanks:true,published:false},200,cors)}
   if(remaining>MAX){await inc(db,'gives_over_65',now);return json({thanks:true,published:false},200,cors)}
   await expire(db,now);
   await db.prepare('INSERT INTO gives(spot,created_at,ends_at) VALUES(?,?,?)').bind(spot,now,end).run();
   await inc(db,'gives_published',now);return json({thanks:true,published:true},200,cors);
 }
 return json({error:'Not found'},404,cors);
 }catch(e){return json({error:'Server error'},500,cors)}
}};
