const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const H=require('../trainer-floor/history.js');
const html=fs.readFileSync(require.resolve('../trainer-floor/index.html'),'utf8');
const source=html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\nstart\(\);/,'');
function app(){
  const context=vm.createContext({TrainerHistory:H,crypto,console,Date,setTimeout,clearTimeout,localStorage:{getItem:()=>null,setItem:()=>{}},document:{querySelector:()=>null,querySelectorAll:()=>[]}});
  vm.runInContext(source,context);
  vm.runInContext(`state.user={id:'owner'};state.data={clients:[],sessions:[],plan:'pro'};restSelect=async()=>[];syncClient=async()=>{};syncSession=async()=>{};saveSession=()=>{};render=()=>{};`,context);
  return {run:code=>vm.runInContext(code,context),context};
}
const fixture=()=>({clients:[{name:'Taylor',sessions:[{date:'2026-09-14',completed:true,session_note:'Recorded session',exercises:[{name:'Row',weight:'20 kg',sets:[15,12],note:'Controlled descent'}]}],current_workout:[{name:'Row',weight:'20 kg',sets:[15,15]}]}]});
test('structured import preserves every client and only confirmed sessions',()=>{
  const input=fixture();input.clients[0].sessions.push({date:'2026-09-15',completed:false,exercises:[{name:'Squat',sets:[15]}]});
  input.clients.push({name:'Morgan',note:'No individual log',sessions:[]});
  const result=H.normalize(input);
  assert.equal(result.clients.length,2);assert.equal(result.clients[0].sessions.length,1);
  assert.deepEqual(result.clients[0].current_workout[0].sets,[null,null]);
  assert.match(result.clients[0].current_workout[0].note,/Target reps/);
});
test('invalid dates fail instead of silently creating invented dates',()=>{
  for(const date of ['2026-02-30','not a date','2099-01-01']){const input=fixture();input.clients[0].sessions[0].date=date;assert.throws(()=>H.normalize(input));}
});
test('rep ranges and unknown loads retain their meaning',()=>{
  const input=fixture();input.clients[0].sessions[0].exercises[0].sets=['10–12',null,'',true];
  const ex=H.normalize(input).clients[0].sessions[0].exercises[0];
  assert.deepEqual(ex.sets,[null,null,null,null]);assert.match(ex.note,/10–12/);
  const a=app();assert.equal(a.run(`formatHistoryWeight('bodyweight')`),'bodyweight');
});
test('master notes are split by client without dropping first or last',()=>{
  const chunks=H.splitNotes('Instructions\nCLIENT: Taylor\nOne\nCLIENT: Morgan\nTwo');
  assert.equal(chunks.length,2);assert.match(chunks[0].text,/Instructions/);assert.match(chunks[1].text,/Two/);
});
test('repeat imports skip saved history and never overwrite a logged draft',async()=>{
  const a=app();a.context.input=H.normalize(fixture());
  a.run(`state.data.clients=[{id:'t',name:'Taylor',archived:false}];state.data.sessions=[{id:'draft',clientId:'t',date:todayKey(),completedAt:null,sessionNote:'In progress',exercises:[{name:'Press',sets:[12],weight:'35'}]}];`);
  const first=await a.run('importSmartHistory(input)');
  const second=await a.run('importSmartHistory(input)');
  assert.equal(first.importedSessions,1);assert.equal(second.importedSessions,0);assert.equal(second.skippedSessions,1);
  assert.equal(a.run('state.data.sessions.length'),3);assert.equal(a.run(`state.data.sessions.find(s=>s.id==='draft').exercises[0].sets[0]`),12);
  assert.equal(a.run('state.data.clients.length'),1);
});
test('an archived alias never takes priority over an active client',async()=>{
  const a=app();a.context.input=H.normalize(fixture());
  a.run(`state.data.clients=[{id:'active',name:'Taylor',archived:false},{id:'archived',name:'Taylor',archived:true}];`);
  await a.run('importSmartHistory(input)');assert.equal(a.run('state.data.sessions[0].clientId'),'active');
});
test('partial failure continues with other clients and retry resumes',async()=>{
  const a=app();const input=fixture();input.clients[0].sessions.push({...input.clients[0].sessions[0],date:'2026-09-16'});input.clients.push({name:'Morgan',sessions:[input.clients[0].sessions[0]]});
  a.context.input=H.normalize(input);
  a.run(`let failedOnce=false;syncSession=async s=>{if(s.date==='2026-09-16'&&!failedOnce){failedOnce=true;throw new Error('Connection lost')}};`);
  const first=await a.run('importSmartHistory(input)');assert.equal(first.failures.length,1);assert.equal(first.clients.length,1);assert.equal(first.importedSessions,2);
  const second=await a.run('importSmartHistory(input)');assert.equal(second.failures.length,0);assert.equal(second.importedSessions,1);assert.equal(second.skippedSessions,2);
});
test('undated imports remain undated and idempotent',async()=>{
  const input=fixture();input.clients[0].sessions[0].date=null;input.clients[0].sessions[0].exercises[0].sets=[];
  const a=app();a.context.input=H.normalize(input);await a.run('importSmartHistory(input)');await a.run('importSmartHistory(input)');
  assert.equal(a.run('state.data.sessions.filter(s=>s.completedAt).length'),1);
  assert.equal(a.run('H.dateLabel(state.data.sessions[0])'),'Date unknown');
  assert.equal(a.run('state.data.sessions[0].exercises[0].sets.length'),0);
});
test('distinct same-day workouts with different notes are retained',async()=>{
  const input=fixture();input.clients[0].sessions.push({...input.clients[0].sessions[0],session_note:'Second session in the evening'});
  const a=app();a.context.input=H.normalize(input);const result=await a.run('importSmartHistory(input)');
  assert.equal(result.importedSessions,2);
});
test('history loads beyond the database page size',async()=>{
  const a=app();a.run(`let calls=0;restSelect=async()=>{calls++;return Array(calls===1?500:7).fill({id:'test'})};`);
  const rows=await a.run(`restSelectAll('tf_sessions','select=*')`);assert.equal(rows.length,507);
});
test('local calendar date and session date are not shifted to UTC',()=>{
  assert.equal(H.localDay(new Date('2026-10-27T06:00:00Z')),'2026-10-26');
  assert.match(H.dateLabel({date:'2026-10-07',completedAt:'2026-10-08T02:00:00Z'}),/Oct 7, 2026/);
});
test('empty drafts receive recovered exercises with blank sets',()=>{
  const a=app();a.run(`state.data.clients=[{id:'t',name:'Taylor'}];state.data.sessions=[{id:'empty',clientId:'t',date:todayKey(),exercises:[],sessionNote:'',completedAt:null},{id:'history',clientId:'t',date:'2026-09-14',completedAt:'2026-09-14T12:00:00Z',exercises:[{name:'Row',sets:[],weight:'20 kg'}]}];`);
  assert.equal(a.run(`ensureTodaySession('t').id`),'empty');assert.equal(a.run(`ensureTodaySession('t').exercises[0].sets.length`),3);
  assert.equal(a.run('state.data.sessions.length'),2);
});
test('exercise notes and untrusted strings are escaped in history HTML',()=>{
  const a=app();a.run(`state.selectedClientId='t';state.data.clients=[{id:'t',name:'Taylor'}];state.data.sessions=[{id:'h',clientId:'t',date:'2026-09-14',completedAt:'x',exercises:[{name:'Row',weight:'20 kg',sets:[15],note:'<img src=x onerror=alert(1)>'}]}];state.modal={type:'history',sessionId:'h'};`);
  assert.match(a.run('modalHtml()'),/&lt;img/);assert.doesNotMatch(a.run('modalHtml()'),/<img/);
  assert.match(a.run(`previousExerciseHtml({name:'Row'})`),/20 kg/);
});
