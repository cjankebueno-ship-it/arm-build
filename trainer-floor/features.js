let deviceStore=null,saveRetry=null,retryDelay=1000,refreshingExtras=false;
const deviceStorage={getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)};
function clientFromRow(c){return {id:c.id,name:c.name,note:c.note||'',archived:c.archived,createdAt:c.created_at,pinnedOn:c.pinned_on,revision:c.revision||1};}
function sessionFromRow(s){return {id:s.id,clientId:s.client_id,date:s.session_date,createdAt:s.created_at,completedAt:s.completed_at,sessionNote:s.session_note||'',exercises:Array.isArray(s.workout)?s.workout:[],revision:s.revision||1};}
function recordPayload(kind,record){return kind==='client'?{id:record.id,name:record.name,note:record.note||'',archived:!!record.archived,pinned_on:record.pinnedOn||null}:{id:record.id,client_id:record.clientId,session_date:record.date,workout:record.exercises||[],session_note:record.sessionNote||'',completed_at:record.completedAt||null};}
function initializeDeviceStore(user){
  if(deviceStore?.userId===user.id)return deviceStore;
  deviceStore?.close();clearTimeout(saveRetry);
  deviceStore=new TrainerStore.Store({userId:user.id,storage:deviceStorage,online:()=>navigator.onLine!==false,
    send:async item=>{const {data}=await authenticatedApi('/rest/v1/rpc/tf_save_record',{method:'POST',body:{p_kind:item.kind,p_record:recordPayload(item.kind,item.record),p_expected_revision:item.expectedRevision,p_mutation_id:item.mutationId}});return data;},
    onAck:(item,result)=>{const list=item.kind==='client'?state.data?.clients:state.data?.sessions;const local=list?.find(x=>x.id===item.record.id);if(local)local.revision=result.revision;},
    onChange:()=>renderSaveStatus()
  });return deviceStore;
}
function queueRecord(kind,record){
  if(!state.user||!record)return false;
  const store=initializeDeviceStore(state.user);
  if(!store.cache)store.snapshot(state.data);
  const persisted=store.queue(kind,record);scheduleSave();return persisted;
}
function scheduleSave(delay=200){
  clearTimeout(saveRetry);
  const store=deviceStore;
  saveRetry=setTimeout(async()=>{
    if(store!==deviceStore||store?.closed)return;
    await store.flush();
    if(store.status().pending && !store.status().conflicts){retryDelay=Math.min(retryDelay*2,30000);scheduleSave(retryDelay);}else retryDelay=1000;
  },delay);
}
async function saveRecordNow(kind,record){
  const persisted=queueRecord(kind,record);const store=deviceStore;
  if(!store)throw Error('Sign in to save');
  await store.flush();
  if(store.pending[kind+':'+record.id])throw Error(store.error||(!persisted?'Device and cloud save unavailable':'Saved on this device; waiting for cloud sync'));
}
function renderSaveStatus(){
  const el=document.querySelector('#saveStatus');if(!el||!deviceStore)return;
  const s=deviceStore.status();
  el.textContent=s.storageError?'Save warning':s.conflicts?'Review save conflict':s.offline?(s.pending?'Offline · saved on device':'Offline'):s.saving?'Saving…':s.pending?'Saved on device · retrying':'Saved';
  el.dataset.state=s.storageError||s.conflicts?'error':s.offline||s.pending?'pending':'saved';
  el.title=s.storageError||s.error||'Tap to review save status';
}
function restoreCachedUser(){
  const saved=readStoredSession();if(!saved?.user?.id)return false;
  const store=initializeDeviceStore(saved.user);if(!store.cache)return false;
  state.user=saved.user;state.data=store.hydrate(store.cache);state.data.offline=true;return true;
}
async function refreshExtras(){
  if(!state.user||refreshingExtras||navigator.onLine===false)return;
  refreshingExtras=true;
  try{
    const [recovered,receipts,integration]=await Promise.all([restSelectAll('tf_recovered_notes','select=*&order=created_at.asc'),restSelectAll('tf_asana_sync','select=*'),restSelect('tf_integrations','select=*')]);
    state.data.recovered=recovered;state.data.asana=receipts;state.data.integration=integration?.[0]||null;
    deviceStore?.snapshot(state.data);
  }catch{}finally{refreshingExtras=false;}
}
function setupRecoveryEvents(){
  window.addEventListener('online',()=>{retryDelay=1000;scheduleSave(0);refreshExtras();renderSaveStatus();});
  window.addEventListener('offline',renderSaveStatus);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){scheduleSave(0);refreshExtras();checkForAppUpdate();}});
  window.addEventListener('pagehide',()=>{if(state.user&&state.data)deviceStore?.snapshot(state.data);});
  window.addEventListener('beforeunload',event=>{if(deviceStore?.status().storageError&&deviceStore.status().pending){event.preventDefault();event.returnValue='';}});
}
function saveStatusHtml(){
  const s=deviceStore?.status()||{pending:0};
  const conflicts=Object.entries(deviceStore?.pending||{}).filter(([,v])=>v.conflict);
  return modalWrap('Save status',`<p>${s.pending?`${s.pending} change${s.pending===1?'':'s'} waiting for cloud sync.`:'All changes are saved to your account.'}</p><p class="muted">${s.storageError?esc(s.storageError):'Changes are also kept on this device so you can keep logging without a connection.'}</p>${s.error?`<p class="muted">${esc(s.error)}</p>`:''}<button class="primary-btn full" id="retrySaves">Retry saves</button>${s.pending?'<button class="ghost-btn full" id="reconnectAccount">Sign in again to reconnect</button>':''}${conflicts.map(([key,item])=>`<div class="note-card"><strong>${esc(item.kind==='client'?item.record.name:state.data.clients.find(c=>c.id===item.record.clientId)?.name||'Workout')}</strong><p>This record changed on another device. Both copies are preserved until you choose.</p><button class="small-btn" data-conflict="${esc(key)}">Compare versions</button></div>`).join('')}`);
}
async function showConflict(key){
  const item=deviceStore.pending[key];if(!item)return;
  try{const table=item.kind==='client'?'tf_clients':'tf_sessions';const rows=await restSelect(table,`select=*&id=eq.${q(item.record.id)}`);if(!rows?.[0])throw Error('Cloud version unavailable');const remote=item.kind==='client'?clientFromRow(rows[0]):sessionFromRow(rows[0]);state.modal={type:'conflict',key,remote};render();}catch(e){toast(e.message);}
}
function conflictHtml(){
  const m=state.modal,item=deviceStore.pending[m.key];if(!item)return modalWrap('Already resolved','<p>This save no longer needs review.</p>');
  const summary=record=>item.kind==='client'?`${record.name}\n${record.note||''}`:`${record.date}\n${(record.exercises||[]).map(ex=>ex.name+': '+historyExerciseSummary(ex)).join('\n')}\n${record.sessionNote||''}`;
  return modalWrap('Choose the version to save',`<h3>This device</h3><pre class="record-copy">${esc(summary(item.record))}</pre><h3>Cloud</h3><pre class="record-copy">${esc(summary(m.remote))}</pre><p class="muted">A copy of both versions is kept in your device backup. Cloud session revisions are retained when replaced.</p><button class="primary-btn full" id="keepLocal">Save this device’s version</button><button class="ghost-btn full" id="keepCloud">Use cloud version</button>`);
}
function resolveSaveConflict(keepLocal){
  const m=state.modal,item=deviceStore.pending[m.key];if(!item)return;
  try{localStorage.setItem('trainer_floor_conflict:'+state.user.id+':'+Date.now(),JSON.stringify({local:item.record,cloud:m.remote}));}catch{toast('Could not keep a backup. Export your data first.');return;}
  if(!keepLocal){const list=item.kind==='client'?state.data.clients:state.data.sessions;const i=list.findIndex(x=>x.id===m.remote.id);if(i>=0)list[i]=m.remote;}
  deviceStore.resolve(m.key,m.remote,keepLocal);state.modal=null;render();scheduleSave(0);
}

function activeDraft(clientId){return state.data.sessions.filter(s=>s.clientId===clientId&&!s.completedAt&&!s.sessionNote?.startsWith('[PROGRAM TEMPLATE]')).sort((a,b)=>(b.date||'').localeCompare(a.date||''))[0];}
function todayClients(){return activeClientsForDisplay().filter(c=>c.pinnedOn===todayKey()||activeDraft(c.id)?.date===todayKey());}
function quickClientsHtml(){const clients=todayClients();return clients.length?`<div class="quick-clients" aria-label="Today’s clients">${clients.map(c=>`<button class="small-btn ${c.id===state.selectedClientId?'selected':''}" data-quick-client="${c.id}">${esc(c.name.split(' ')[0])}${activeDraft(c.id)?' · ↺':''}</button>`).join('')}</div>`:'';}
function toggleToday(client){client.pinnedOn=client.pinnedOn===todayKey()?null:todayKey();saveClient(client);render();}

function progressHtml(clientId){
  const client=state.data.clients.find(c=>c.id===clientId);
  const sessions=state.data.sessions.filter(s=>s.clientId===clientId&&s.completedAt);
  const names=[...new Set(sessions.flatMap(s=>(s.exercises||[]).map(e=>e.name)))].sort();
  const selected=state.progressExercise&&names.includes(state.progressExercise)?state.progressExercise:names[0];
  const groups=TrainerProgress.records(TrainerProgress.series(sessions,clientId,selected));
  return modalWrap(`${esc(client?.name||'Client')} · Progress`,`<label class="filter-label" for="progressExercise">Exercise</label><select class="search" id="progressExercise">${names.map(name=>`<option ${name===selected?'selected':''}>${esc(name)}</option>`).join('')}</select>${groups.map(group=>{
    const recent=group.points.slice(-12),max=Math.max(...recent.map(p=>p.weight),1);
    return `<div class="note-card"><strong>Best recorded: ${group.best.weight} ${group.unit} × ${group.best.reps}</strong><p class="muted">${esc(group.best.date)} · Latest ${group.latest.weight} ${group.unit} × ${group.latest.reps}</p><div class="progress-chart" role="img" aria-label="Recorded working weights over time">${recent.map(p=>`<div class="progress-column"><span>${p.weight}</span><div style="height:${Math.max(4,80*p.weight/max)}px"></div><small>${esc(p.date.slice(5))}</small></div>`).join('')}</div></div><div class="progress-table">${recent.slice().reverse().map(p=>`<div><span>${esc(p.date)}</span><b>${p.weight} ${group.unit} × ${p.reps}</b><span>${p.sets} sets · ${p.totalReps} total reps</span></div>`).join('')}</div>`;
  }).join('')||'<p class="muted">No comparable recorded weights and reps for this exercise yet.</p>'}<p class="tiny">Only completed, dated results are charted. Kilograms and pounds stay separate. Mixed loads, assistance, rep ranges, and unknown values remain in History.</p>`);
}
function asanaSettingsHtml(){
  return `<div class="settings-card asana-card">
    <div class="asana-heading"><h3>Asana sync</h3><button class="asana-help-button" id="asanaHelp" type="button" aria-label="Why connect Asana?" aria-expanded="false" aria-controls="asanaHelpText"><span aria-hidden="true">?</span></button></div>
    <div class="asana-help-copy" id="asanaHelpText" hidden><strong>An extra copy of your workout logs</strong><p>Once connected, Asana will give you another place to organize and review completed sessions, including the summary, exercises, weights, sets, and reps. Your workouts will still be saved in Trainer Floor.</p></div>
    <div class="asana-connection-row"><p>Not connected for this account.</p><button class="primary-btn" id="connectAsana" type="button" aria-describedby="asanaAvailability">Connect Asana</button></div>
    <p class="tiny" id="asanaAvailability">Connection setup coming soon.</p>
  </div>`;
}
function wireAsanaSettings(){
  $('#asanaHelp').onclick=()=>{
    const button=$('#asanaHelp'),copy=$('#asanaHelpText');
    copy.hidden=!copy.hidden;button.setAttribute('aria-expanded',String(!copy.hidden));
  };
  $('#connectAsana').onclick=()=>{state.modal={type:'asanaSetup'};render();};
}
function asanaSetupHtml(){
  return modalWrap('Connect Asana',`<p><strong>Asana connection is not available yet.</strong></p><p class="muted">Once setup is complete, you’ll sign in to Asana, approve access, and choose a project for your completed workout logs.</p><p class="muted">Your workouts continue to save in Trainer Floor. No Asana connection is required to train or track clients.</p><button class="primary-btn full" id="asanaSetupDone" type="button">Got it</button>`);
}
function asanaStatusHtml(session){
  if(!state.data.integration)return '';
  const receipt=(state.data.asana||[]).find(r=>r.session_id===session.id);
  const synced=receipt?.status==='synced'&&receipt.synced_revision>=session.revision;
  return `<p class="sync-note">Asana: ${synced?`synced${receipt.asana_url?` · <a href="${esc(receipt.asana_url)}" target="_blank" rel="noopener">View full log</a>`:''}`:receipt?.status==='error'?'retry needed':'queued for the next hourly sync'}.</p>`;
}
function recoveredHtml(clientId){
  const notes=(state.data.recovered||[]).filter(r=>r.client_id===clientId);
  return modalWrap('Recovered source notes',notes.length?notes.map(n=>`<div class="note-card"><strong>${esc(n.source_name)}</strong><p class="muted">Original notes are preserved. Plans and uncertain entries remain here for reference.</p><pre class="record-copy">${esc(n.raw_text)}</pre></div>`).join(''):'<p>No recovered source note is stored for this client.</p>');
}

function historyEditHtml(){
  const s=state.modal.draft;
  return modalWrap('Correct saved workout',`<form id="editHistoryForm"><div class="field"><label>Date</label><input id="historyDate" type="date" max="${todayKey()}" value="${s.date==='1900-01-01'?'':esc(s.date)}"></div><p class="tiny">Leave the date blank if it is unknown.</p><div class="field"><label>Session note</label><textarea id="historySessionNote">${esc(s.sessionNote||'')}</textarea></div>${s.exercises.map((ex,i)=>`<div class="settings-card"><div class="field"><label>Exercise</label><input data-edit-name="${i}" value="${esc(ex.name)}" required></div><div class="field"><label>Weight or load, including units</label><input data-edit-weight="${i}" value="${esc(ex.weight??'')}"></div><div class="field"><label>Reps for each set (comma separated; ? = unknown)</label><input data-edit-sets="${i}" value="${esc((ex.sets||[]).map(n=>n==null?'?':n).join(', '))}"></div><div class="field"><label>Exercise note</label><textarea data-edit-note="${i}">${esc(ex.note||'')}</textarea></div></div>`).join('')}<button class="primary-btn full" type="submit">Save corrections</button><p class="tiny">The previous saved version stays in revision history.</p></form>`);
}
function openHistoryEdit(id){const original=state.data.sessions.find(s=>s.id===id);if(!original)return;state.modal={type:'editHistory',draft:JSON.parse(JSON.stringify(original))};render();}
function saveHistoryEdit(event){
  event.preventDefault();const draft=state.modal.draft;let date=$('#historyDate').value;
  if(date&&(!H.dateKey(date)||date>todayKey())){toast('Choose a valid past or current date');return;}
  try{
    draft.date=date||'1900-01-01';draft.sessionNote=$('#historySessionNote').value.trim().replace(/^\[DATE UNKNOWN\]\s*/,'');
    if(!date)draft.sessionNote='[DATE UNKNOWN] '+draft.sessionNote;
    draft.exercises=draft.exercises.map((ex,i)=>{
      const raw=document.querySelector(`[data-edit-sets="${i}"]`).value.trim();
      const sets=raw?raw.split(',').map(n=>{n=n.trim();if(n==='?'||n==='')return null;if(!/^\d+$/.test(n)||+n>10000)throw Error('Use whole rep counts or ? for unknown sets');return +n;}):[];
      const name=document.querySelector(`[data-edit-name="${i}"]`).value.trim();if(!name)throw Error('Exercise name required');
      return {...ex,name,weight:document.querySelector(`[data-edit-weight="${i}"]`).value.trim(),sets,note:document.querySelector(`[data-edit-note="${i}"]`).value.trim()};
    });
    const index=state.data.sessions.findIndex(s=>s.id===draft.id);state.data.sessions[index]=draft;saveSession(draft);state.modal={type:'history',sessionId:draft.id};render();toast('Corrections saved on this device');
  }catch(e){toast(e.message);}
}
async function showRevisions(sessionId){
  try{const rows=await restSelect('tf_session_revisions',`select=*&session_id=eq.${q(sessionId)}&order=revision.desc&limit=20`);state.modal={type:'revisions',sessionId,rows};render();}catch{toast('Connect to view saved revisions');}
}
function revisionsHtml(){return modalWrap('Previous versions',state.modal.rows.length?state.modal.rows.map(row=>`<details><summary>Version ${row.revision} · ${esc(new Date(row.saved_at).toLocaleString())}</summary><pre class="record-copy">${esc(row.snapshot.session_date+'\n'+(row.snapshot.workout||[]).map(ex=>ex.name+': '+historyExerciseSummary(ex)+(ex.note?'\n'+ex.note:'')).join('\n')+'\n'+row.snapshot.session_note)}</pre><button class="small-btn" data-restore-revision="${row.id}">Restore this version</button></details>`).join(''):'<p>No previous cloud versions yet.</p>');}
function restoreRevision(id){const row=state.modal.rows.find(r=>r.id===id),current=state.data.sessions.find(s=>s.id===row?.session_id);if(!current)return;const restored={...sessionFromRow(row.snapshot),revision:current.revision};Object.assign(current,restored);saveSession(current);state.modal={type:'history',sessionId:current.id};render();toast('Previous version restored');}
function wireFeatureModal(){
  const m=state.modal;if(!m)return;
  if(m.type==='saveStatus'){if($('#reconnectAccount'))$('#reconnectAccount').onclick=()=>{state.modal=null;renderLogin('Sign in to the same account to reconnect. Your pending changes remain on this device.');$('#email').value=state.user?.email||state.data.profile?.email||'';$('#email').readOnly=true;$('#createAccount').hidden=true;};$('#retrySaves').onclick=()=>{scheduleSave(0);toast('Retrying saves');};document.querySelectorAll('[data-conflict]').forEach(b=>b.onclick=()=>showConflict(b.dataset.conflict));}
  if(m.type==='conflict'){$('#keepLocal').onclick=()=>resolveSaveConflict(true);$('#keepCloud').onclick=()=>resolveSaveConflict(false);}
  if(m.type==='progress')$('#progressExercise').onchange=event=>{state.progressExercise=event.target.value;render();};
  if(m.type==='editHistory')$('#editHistoryForm').onsubmit=saveHistoryEdit;
  if(m.type==='history'){
    $('#editHistory').onclick=()=>openHistoryEdit(m.sessionId);
    $('#historyRevisions').onclick=()=>showRevisions(m.sessionId);
    $('#reopenSession').onclick=()=>{const s=state.data.sessions.find(x=>x.id===m.sessionId);s.completedAt=null;saveSession(s);state.modal=null;state.selectedClientId=s.clientId;state.selectedSessionId=s.id;state.view='workout';render();};
  }
  if(m.type==='revisions')document.querySelectorAll('[data-restore-revision]').forEach(b=>b.onclick=()=>restoreRevision(b.dataset.restoreRevision));
}

let waitingUpdate=null,updateRequested=false;
async function setupInstallableApp(){
  if(!('serviceWorker' in navigator)||location.hostname==='raw.githack.com')return;
  try{
    const registration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});
    const ready=worker=>{waitingUpdate=worker;renderUpdateNotice();};
    if(registration.waiting)ready(registration.waiting);
    registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)ready(worker);});});
    let reloading=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(reloading||!updateRequested)return;reloading=true;location.reload();});
  }catch{}
}
function renderUpdateNotice(){const el=$('#appUpdate');if(!el)return;el.hidden=!waitingUpdate;el.onclick=async()=>{if(deviceStore?.status().storageError&&deviceStore.status().pending){toast('Save or export your pending changes first');return;}deviceStore?.snapshot(state.data);updateRequested=true;waitingUpdate?.postMessage({type:'SKIP_WAITING'});};}
function checkForAppUpdate(){navigator.serviceWorker?.getRegistration?.().then(r=>r?.update()).catch(()=>{});}
