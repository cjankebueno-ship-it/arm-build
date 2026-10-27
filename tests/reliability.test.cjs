const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {Store}=require('../trainer-floor/store.js');
const P=require('../trainer-floor/progress.js');
const H=require('../trainer-floor/history.js');
const memory=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};};
const client={id:'c',name:'Sample',revision:1};
const session={id:'s',clientId:'c',date:'2026-10-26',revision:1,exercises:[{name:'Row',weight:'20',sets:[12]}]};
function store(opts={}){const s=new Store({userId:'owner',storage:memory(),send:async()=>({revision:2}),...opts});if(!s.cache)s.snapshot({clients:[client],sessions:[session]});return s;}
test('offline edits survive reload, overlay cloud data and stay isolated by account',async()=>{
 const storage=memory(),one=store({storage,online:()=>false});one.queue('session',{...session,exercises:[{name:'Row',sets:[15]}]});await one.flush();
 const restored=store({storage});const data=restored.hydrate({clients:[client],sessions:[session]});assert.equal(data.sessions[0].exercises[0].sets[0],15);assert.equal(restored.status().pending,1);
 const other=new Store({userId:'other',storage,send:()=>{}});assert.equal(other.cache,null);assert.equal(other.status().pending,0);
 await restored.flush();assert.equal(restored.status().pending,0);
});
test('a lost response retries the same mutation without losing the saved record',async()=>{
 const mutations=[];let tries=0;const s=store({send:async item=>{mutations.push(item.mutationId);if(!tries++)throw Error('Network lost after commit');return {revision:2};}});
 s.queue('session',session);await s.flush();assert.equal(s.status().pending,1);await s.flush();assert.equal(mutations[0],mutations[1]);assert.equal(s.status().pending,0);
});
test('edits made during an in-flight save are retained with the acknowledged revision',async()=>{
 let release;const sent=[];const s=store({send:async item=>{sent.push(item);if(sent.length===1)return new Promise(resolve=>{release=resolve});return {revision:3};}});
 s.queue('session',session);const first=s.flush();s.queue('session',{...session,sessionNote:'Newest note'});release({revision:2});await first;
 assert.equal(s.status().pending,1);assert.equal(s.pending['session:s'].record.sessionNote,'Newest note');assert.equal(s.pending['session:s'].expectedRevision,2);
 await s.flush();assert.equal(sent[1].record.sessionNote,'Newest note');assert.equal(s.status().pending,0);
});
test('new clients save before sessions, and failed parents keep children queued',async()=>{
 const sent=[];let fail=true;const s=store({send:async item=>{sent.push(item.kind);if(fail)throw Error('offline');return {revision:1};}});
 s.queue('session',{...session,revision:0});s.queue('client',{...client,revision:0});await s.flush();assert.deepEqual(sent,['client']);assert.equal(s.status().pending,2);
 fail=false;await s.flush();assert.deepEqual(sent,['client','client','session']);
});
test('conflicts require a choice and never silently overwrite cloud changes',async()=>{
 let count=0;const s=store({send:async()=>{count++;throw Error('TF_CONFLICT: changed');}});s.queue('session',session);await s.flush();await s.flush();assert.equal(count,1);assert.equal(s.status().conflicts,1);
 s.resolve('session:s',{...session,revision:8},true);assert.equal(s.pending['session:s'].expectedRevision,8);assert.equal(s.status().conflicts,0);
 s.resolve('session:s',{...session,revision:9,sessionNote:'Cloud copy'},false);assert.equal(s.status().pending,0);assert.equal(s.cache.sessions[0].sessionNote,'Cloud copy');
});
test('storage failures remain visible while cloud saves can still succeed',async()=>{
 const s=store({storage:{getItem:()=>null,setItem:()=>{throw Error('Quota exceeded');}}});assert.equal(s.queue('session',session),false);assert.ok(s.status().storageError);await s.flush();assert.equal(s.status().pending,0);assert.ok(s.status().storageError);
});
test('progress includes completed numeric results and keeps kg, lb and uncertain loads separate',()=>{
 const make=(id,weight,sets,completedAt='done',date='2026-10-20')=>({id,clientId:'c',date,completedAt,exercises:[{name:'Row',weight,sets}]});
 const points=P.series([make('1','20',[15,12]),make('2','20 kg',[10]),make('3','25 lb',[8]),make('4','35',[15],null),make('5','30–40',[15]),make('6','50 lb assistance',[10]),make('7','60',['10–12']),make('8','70',[15],'done','1900-01-01')],'c',' row ');
 assert.equal(points.length,3);const groups=P.records(points);assert.equal(groups.find(g=>g.unit==='lb').best.weight,25);assert.equal(groups.find(g=>g.unit==='kg').best.weight,20);
});
function app(){
 const elements=new Map();const el=selector=>{if(!elements.has(selector))elements.set(selector,{value:'',textContent:'',classList:{toggle(){},add(){},remove(){}},dataset:{}});return elements.get(selector);};
 const storage=memory();const context=vm.createContext({TrainerStore:{Store},TrainerProgress:P,TrainerHistory:H,crypto,console,Date,setTimeout,clearTimeout,localStorage:storage,navigator:{onLine:true},document:{querySelector:el,querySelectorAll:()=>[]},window:{},location:{hostname:'test'}});
 vm.runInContext(fs.readFileSync(require.resolve('../trainer-floor/features.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(require.resolve('../trainer-floor/import-ui.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(require.resolve('../trainer-floor/founder.js'),'utf8'),context);
 const html=fs.readFileSync(require.resolve('../trainer-floor/index.html'),'utf8');vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\nstart\(\);/,''),context);
 vm.runInContext(`state.user={id:'owner'};state.data={clients:[],sessions:[],plan:'pro'};render=()=>{};toast=message=>{lastToast=message};saveSession=s=>{saved=s;return true;};`,context);
 return {run:code=>vm.runInContext(code,context),el,storage,context};
}
test('editing history keeps the original session id and validates rep entries',()=>{
 const a=app();a.context.input={...session,completedAt:'done'};a.run(`state.data.sessions=[input];openHistoryEdit('s');`);
 a.el('#historyDate').value='2026-10-25';a.el('#historySessionNote').value='Correction';a.el('[data-edit-name="0"]').value='Row';a.el('[data-edit-weight="0"]').value='25 kg';a.el('[data-edit-sets="0"]').value='15, ?, 12';a.el('[data-edit-note="0"]').value='Controlled';
 a.run('saveHistoryEdit({preventDefault(){}})');assert.equal(a.run('state.data.sessions.length'),1);assert.equal(a.run('saved.id'),'s');assert.equal(a.run('saved.date'),'2026-10-25');assert.equal(a.run('saved.exercises[0].sets[1]'),null);
 a.run(`openHistoryEdit('s')`);a.el('[data-edit-sets="0"]').value='10–12';a.run('saveHistoryEdit({preventDefault(){}})');assert.match(a.run('lastToast'),/whole rep counts/);
});
test('client switching resumes an older unfinished session without changing its date',()=>{
 const a=app();a.context.input=session;a.run(`state.data.clients=[{id:'c',name:'Sample'}];state.data.sessions=[input,{...input,id:'template',date:todayKey(),sessionNote:'[PROGRAM TEMPLATE] Sample'}];openClient('c');`);
 assert.equal(a.run('currentSession().id'),'s');assert.equal(a.run('currentSession().date'),'2026-10-26');
});
test('progression dialog renders before wiring its controls, and stores its selected target',()=>{
 const a=app();a.context.input=session;a.run(`state.data.clients=[{id:'c',name:'Sample'}];state.data.sessions=[input];state.selectedClientId='c';state.selectedSessionId='s';state.modal={type:'progressionTarget',index:0};`);
 assert.match(a.run('modalHtml()'),/progressionForm/);a.run('wireModal()');a.el('#progressionTarget').value='12';a.el('#progressionForm').onsubmit({preventDefault(){}});assert.equal(a.run('saved.exercises[0].progressAt'),12);
});
test('network failure during token refresh preserves credentials for reconnect',async()=>{
 const a=app();a.context.token={access_token:'fixture',refresh_token:'fixture-refresh',expires_at:1};a.run('writeStoredSession(token);api=async()=>{throw Error("Network unavailable")};');await assert.rejects(a.run('refreshSession(readStoredSession())'),/Network/);assert.equal(a.run('readStoredSession().refresh_token'),'fixture-refresh');
});

test('completed workout summaries retain unknown set positions',()=>{const a=app();const summary=a.run("historyExerciseSummary({weight:'25 lb',sets:[12,null,10]})");assert.match(summary,/Set 2: 25 lb × reps not recorded/);assert.match(summary,/25 lb × 12 reps/);assert.match(summary,/25 lb × 10 reps/);});
