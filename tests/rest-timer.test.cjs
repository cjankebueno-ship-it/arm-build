const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const H=require('../trainer-floor/history.js');
const html=fs.readFileSync(require.resolve('../trainer-floor/index.html'),'utf8');
const source=html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\nstart\(\);/,'');

function app(storage=new Map()){
  let now=1000000;
  const ticks=new Map();
  let tickId=0;
  class Clock extends Date{static now(){return now;}}
  const nodes={
    '#restTimer':{hidden:true},
    '#restTimerTime':{textContent:''},
    '#screen':{classList:{toggle(){}}}
  };
  const bubble={dataset:{set:'0:0'},textContent:'',classList:{toggle(){}}};
  const context=vm.createContext({TrainerHistory:H,crypto,console,Date:Clock,setTimeout,clearTimeout,
    setInterval:fn=>{ticks.set(++tickId,fn);return tickId;},clearInterval:id=>ticks.delete(id),
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    document:{querySelector:key=>nodes[key]||null,querySelectorAll:key=>key==='[data-set]'?[bubble]:[]}
  });
  vm.runInContext(source,context);
  const run=code=>vm.runInContext(code,context);
  run(`state.user={id:'trainer-a'};state.data={clients:[],sessions:[]};
    const session={id:'session-a',clientId:'client-a',exercises:[{id:'exercise-a',sets:[null,null,null],progressAt:15},{id:'exercise-b',sets:[null,null],progressAt:12}]};
    let saves=0;saveSession=()=>saves++;`);
  return {run,context,nodes,bubble,storage,ticks,advance:milliseconds=>{now+=milliseconds;for(const tick of ticks.values()) tick();}};
}

test('tapping the actual set button logs reps and shows the count-up timer',()=>{
  const a=app();a.run('wireExerciseCards(session)');a.bubble.onclick();
  assert.equal(a.bubble.textContent,15);
  assert.equal(a.nodes['#restTimer'].hidden,false);
  assert.equal(a.nodes['#restTimerTime'].textContent,'0:00');
  a.advance(65000);
  assert.equal(a.nodes['#restTimerTime'].textContent,'1:05');
  a.bubble.onclick();
  assert.equal(a.bubble.textContent,14);
  assert.equal(a.nodes['#restTimerTime'].textContent,'1:05');
  assert.equal(a.run('saves'),2);
  assert.equal(a.ticks.size,1);
});

test('the next set or exercise restarts rest; correcting an older set does not',()=>{
  const a=app();a.run('logSet(session,0,0)');a.advance(90000);
  a.run('logSet(session,0,1)');assert.equal(a.nodes['#restTimerTime'].textContent,'0:00');
  a.advance(12000);a.run('logSet(session,0,0)');
  assert.equal(a.nodes['#restTimerTime'].textContent,'0:12');
  assert.equal(a.run('getRestTimer(session).setIndex'),1);
  a.run('logSet(session,1,0)');assert.equal(a.nodes['#restTimerTime'].textContent,'0:00');
  assert.equal(a.run('session.exercises[1].sets[0]'),12);
});

test('elapsed time survives refresh and a long background pause',()=>{
  const storage=new Map(),a=app(storage);a.run('logSet(session,0,0)');
  const reloaded=app(storage);reloaded.advance(3723000);reloaded.run('refreshRestTimer(session)');
  assert.equal(reloaded.nodes['#restTimerTime'].textContent,'1:02:03');
  reloaded.run('refreshRestTimer(session)');assert.equal(reloaded.ticks.size,1);
});

test('client sessions and signed-in trainers keep separate timers',()=>{
  const a=app();a.run('logSet(session,0,0)');a.advance(30000);
  assert.equal(a.run(`getRestTimer({...session,id:'session-b'})`),null);
  a.run(`state.user={id:'trainer-b'}`);assert.equal(a.run('getRestTimer(session)'),null);
  a.run(`state.user={id:'trainer-a'};refreshRestTimer(session)`);
  assert.equal(a.nodes['#restTimerTime'].textContent,'0:30');
});

test('clearing the latest set or stopping rest hides and removes the timer',()=>{
  const a=app();a.run('session.exercises[0].progressAt=1;logSet(session,0,0);logSet(session,0,0)');
  assert.equal(a.nodes['#restTimer'].hidden,true);assert.equal(a.ticks.size,0);assert.equal(a.storage.size,0);
  a.run('logSet(session,0,0);saveRestTimer(session,null);refreshRestTimer(session)');
  assert.equal(a.nodes['#restTimer'].hidden,true);assert.equal(a.storage.size,0);
});

test('rest can restart manually; completed sessions never restore an active timer',()=>{
  const a=app();a.run('logSet(session,0,0)');a.advance(60000);
  a.run('saveRestTimer(session,{...getRestTimer(session),startedAt:Date.now()});refreshRestTimer(session)');
  assert.equal(a.nodes['#restTimerTime'].textContent,'0:00');
  a.run(`session.completedAt='2026-10-27T12:00:00Z';refreshRestTimer(session)`);
  assert.equal(a.nodes['#restTimer'].hidden,true);assert.equal(a.ticks.size,0);
});

test('malformed or blocked browser storage does not prevent logging',()=>{
  for(const value of ['bad json','{"startedAt":"bad"}','{"startedAt":123,"exerciseId":"e","setIndex":-1}']){
    const a=app(new Map([['trainer_floor_rest_v1:trainer-a:session-a',value]]));
    assert.equal(a.run('getRestTimer(session)'),null);
  }
  const a=app();a.run(`localStorage.getItem=localStorage.setItem=localStorage.removeItem=()=>{throw new Error('Storage unavailable')};logSet(session,0,0)`);
  a.advance(2000);assert.equal(a.nodes['#restTimerTime'].textContent,'0:02');assert.equal(a.run('saves'),1);
});
