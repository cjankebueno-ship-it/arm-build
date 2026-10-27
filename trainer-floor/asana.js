const ASANA_API='https://members.chrisjanke.com/api/trainer-floor/asana';
let asanaUi=null,asanaReturning=false;
const asanaReturn=(()=>{const p=new URLSearchParams(location.hash.slice(1));if(p.get('asana')!=='return')return null;history.replaceState(null,'',location.pathname+location.search);return Object.fromEntries(p);})();
function getAsanaUi(){if(!asanaUi||asanaUi.owner!==state.user?.id)asanaUi={owner:state.user?.id,status:null,loading:false,checkedAt:0,error:''};return asanaUi;}
async function asanaRequest(action,values={}){
  const owner=state.user?.id,token=await freshAuthToken();
  if(!owner||state.user?.id!==owner)throw Error('Sign in to the same trainer account and try again.');
  const response=await fetch(ASANA_API,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action,...values})});
  if(state.user?.id!==owner)throw Error('The signed-in account changed.');
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(response.status===404?'Asana connection setup is not complete yet.':body.error||'Asana is temporarily unavailable.');
  return body;
}
function asanaSettingsHtml(){return `<div id="asanaCardMount">${asanaCardHtml()}</div>`;}
function asanaCardHtml(){
  const ui=getAsanaUi(),s=ui.status,connected=s?.connected;
  return `<div class="settings-card asana-card"><div class="asana-heading"><h3>Asana sync</h3><button class="asana-help-button" id="asanaHelp" type="button" aria-label="Why connect Asana?" aria-expanded="false" aria-controls="asanaHelpText"><span aria-hidden="true">?</span></button></div>
    <div class="asana-help-copy" id="asanaHelpText" hidden><strong>An extra copy of your workout logs</strong><p>Once connected, Asana gives you another place to organize and review completed sessions: summaries, exercises, weights, sets, reps, and session notes. Your original workouts stay in Trainer Floor. Anyone with access to your chosen Asana project can see the copied logs.</p></div>
    <div class="asana-connection-row"><p>${s?.reconnectRequired?'Reconnect to renew access.':connected?s.enabled?'Connected · '+esc(s.project?.name||'Asana'):'Connected · sync paused':ui.loading?'Checking connection…':'Not connected for this account.'}</p><button class="primary-btn" id="connectAsana" type="button" ${ui.loading?'disabled':''}>${s?.reconnectRequired?'Reconnect Asana':connected?'Manage Asana':'Connect Asana'}</button></div>
    <p class="tiny">${s?.available?connected?`${Number(s.pending)||0} workout updates waiting. Checks run automatically every 5 minutes.`:'Choose your Asana account and project to enable syncing.':'Connection setup is not complete yet.'}</p>
    ${ui.error?`<p class="tiny" role="status">${esc(ui.error)}</p>`:''}<button class="small-btn" id="refreshAsana" type="button" ${ui.loading?'disabled':''}>Refresh connection status</button></div>`;
}
function paintAsana(){if(state.view!=='settings'||!$('#asanaCardMount'))return;$('#asanaCardMount').innerHTML=asanaCardHtml();wireAsanaSettings(false);}
async function refreshAsana(){
  const ui=getAsanaUi();if(ui.loading)return;ui.loading=true;paintAsana();
  try{const s=await asanaRequest('status');if(asanaUi===ui){ui.status=s;ui.error='';}}
  catch(e){if(asanaUi===ui)ui.error=e.message;}
  finally{if(asanaUi===ui){ui.loading=false;ui.checkedAt=Date.now();paintAsana();}}
}
function wireAsanaSettings(load=true){
  $('#asanaHelp').onclick=()=>{const b=$('#asanaHelp'),p=$('#asanaHelpText');p.hidden=!p.hidden;b.setAttribute('aria-expanded',String(!p.hidden));};
  $('#refreshAsana').onclick=refreshAsana;
  $('#connectAsana').onclick=async()=>{
    const ui=getAsanaUi();
    if(!ui.status?.available){state.modal={type:'asanaSetup'};render();return;}
    if(!ui.status.connected||ui.status.reconnectRequired){await startAsana();return;}
    state.modal={type:'asanaManage',workspaces:[],projects:[],workspace:ui.status.project?.workspace||'',project:ui.status.project?.gid||'',loading:true};render();
    await loadAsanaChoices('workspaces');
  };
  if(load&&Date.now()-getAsanaUi().checkedAt>30000)void refreshAsana();
}
async function startAsana(){
  const ui=getAsanaUi();ui.loading=true;paintAsana();
  try{
    const result=await asanaRequest('start');if(asanaUi!==ui)return;
    const url=new URL(result.authorizationUrl);
    if(url.origin!=='https://app.asana.com'||url.pathname!=='/-/oauth_authorize'||url.searchParams.get('state')!==result.state)throw Error('Invalid Asana connection address.');
    sessionStorage.setItem('trainer_floor_asana_pending',JSON.stringify({owner:ui.owner,state:result.state,created:Date.now()}));
    location.assign(url.href);
  }catch(e){ui.error=e.message;ui.loading=false;paintAsana();}
}
async function finishAsanaReturn(){
  if(!asanaReturn||asanaReturning||!state.user||state.data?.offline)return;
  asanaReturning=true;
  try{
    const pending=JSON.parse(sessionStorage.getItem('trainer_floor_asana_pending')||'null');
    sessionStorage.removeItem('trainer_floor_asana_pending');
    if(!pending||pending.owner!==state.user.id||pending.state!==asanaReturn.state||Date.now()-pending.created>600000)throw Error('This Asana connection expired or belongs to another account. Start again from Settings.');
    if(asanaReturn.error||!asanaReturn.code)throw Error(asanaReturn.error==='denied'?'Asana connection canceled.':'Asana could not connect. Please try again.');
    const ui=getAsanaUi();ui.status=await asanaRequest('complete',{state:asanaReturn.state,code:asanaReturn.code});ui.checkedAt=Date.now();
    state.view='settings';state.modal=null;render();toast('Asana connected. Choose your project to enable sync.');
    $('#connectAsana')?.click();
  }catch(e){getAsanaUi().error=e.message;state.view='settings';state.modal=null;render();}
}
async function loadAsanaChoices(kind,more=false){
  const m=state.modal;if(m?.type!=='asanaManage')return;m.loading=true;m.error='';render();
  try{
    const result=await asanaRequest(kind,{...(kind==='projects'?{workspace:m.workspace}:{}),...(more?{offset:m[kind+'Offset']}:{})});
    if(state.modal!==m)return;
    m[kind]=more?[...m[kind],...result.items]:result.items;m[kind+'Offset']=result.nextOffset;
    if(kind==='workspaces'&&!m.workspace&&m.workspaces.length===1)m.workspace=m.workspaces[0].gid;
    if(kind==='workspaces'&&m.workspace&&!more){await loadAsanaChoices('projects');return;}
  }catch(e){if(state.modal===m)m.error=e.message;}
  if(state.modal===m){m.loading=false;render();}
}
function asanaManageHtml(){
  const m=state.modal,s=getAsanaUi().status;
  return modalWrap('Asana connection',`<p>Account: <strong>${esc(s?.accountName||'Asana')}</strong></p>
    <form id="asanaProjectForm"><div class="field"><label for="asanaWorkspace">Workspace</label><select id="asanaWorkspace" required ${m.loading?'disabled':''}><option value="">Choose a workspace</option>${m.workspaces.map(w=>`<option value="${esc(w.gid)}" ${w.gid===m.workspace?'selected':''}>${esc(w.name)}</option>`).join('')}</select></div>
    ${m.workspacesOffset?'<button class="small-btn" id="moreAsanaWorkspaces" type="button">More workspaces</button>':''}
    <div class="field"><label for="asanaProject">Project</label><select id="asanaProject" required ${m.loading||!m.workspace?'disabled':''}><option value="">Choose a project</option>${m.projects.map(p=>`<option value="${esc(p.gid)}" ${p.gid===m.project?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div>
    ${m.projectsOffset?'<button class="small-btn" id="moreAsanaProjects" type="button">More projects</button>':''}
    <label class="asana-consent"><input id="asanaConsent" type="checkbox" required ${m.consent?'checked':''}> Share completed workout details and session notes with this project’s members.</label>
    <label class="asana-consent"><input id="asanaIncludeHistory" type="checkbox" ${m.includeHistory?'checked':''}> Also copy my previously completed workouts.</label>
    <p class="tiny">Future completed workouts and corrections will sync automatically. Asana edits do not change Trainer Floor. Changing projects keeps existing Asana logs in the old project.</p>
    <button class="primary-btn full" type="submit" ${m.loading?'disabled':''}>${m.loading?'Loading…':'Enable sync to this project'}</button></form>
    ${m.error?`<p role="alert">${esc(m.error)}</p>`:''}
    <div class="history-actions"><button class="small-btn" id="asanaSyncNow" ${m.loading||!s?.enabled?'disabled':''}>Sync now</button><button class="small-btn" id="asanaPause" ${m.loading||!s?.enabled?'disabled':''}>Pause sync</button><button class="small-btn" id="asanaDisconnect" ${m.loading?'disabled':''}>Disconnect</button></div>
    <p class="tiny">${Number(s?.pending)||0} workout updates waiting. Each sync sends a small batch; the rest stay queued.</p>
    ${(s?.failures||[]).map(f=>`<div class="note-card"><strong>${esc(state.data.clients.find(c=>c.id===state.data.sessions.find(x=>x.id===f.sessionId)?.clientId)?.name||'Workout')}</strong><p>${esc(f.message)}</p>${f.needsCreationReview?`<button class="small-btn" data-asana-retry-create="${esc(f.sessionId)}">I checked Asana — this log is missing</button>`:''}</div>`).join('')}`);
}
function wireAsanaModal(){
  const m=state.modal;if(m?.type!=='asanaManage')return;
  $('#asanaWorkspace').onchange=e=>{m.workspace=e.target.value;m.project='';m.projects=[];m.consent=false;if(m.workspace)void loadAsanaChoices('projects');else render();};
  $('#asanaProject').onchange=e=>{m.project=e.target.value;m.consent=false;$('#asanaConsent').checked=false;};
  $('#asanaConsent').onchange=e=>{m.consent=e.target.checked;};$('#asanaIncludeHistory').onchange=e=>{m.includeHistory=e.target.checked;};
  if($('#moreAsanaWorkspaces'))$('#moreAsanaWorkspaces').onclick=()=>loadAsanaChoices('workspaces',true);
  if($('#moreAsanaProjects'))$('#moreAsanaProjects').onclick=()=>loadAsanaChoices('projects',true);
  const act=async(action,values={})=>{
    m.loading=true;m.error='';render();
    try{
      const result=await asanaRequest(action,values);if(state.modal!==m)return;
      getAsanaUi().status=await asanaRequest('status');await refreshExtras();
      if(action==='disconnect'){state.modal=null;render();toast(result.warning||'Asana disconnected. Existing logs remain in Asana.');return;}
      if(action==='enable'){state.modal=null;render();toast('Sync enabled. Completed workouts are queued for Asana.');return;}
      toast(action==='sync'?`${result.synced||0} workouts synced${result.failed?'; some need attention':''}.`:action==='pause'?'Asana sync paused.':'Creation retry allowed. Use Sync now when the retry is due.');
    }catch(e){if(state.modal===m)m.error=e.message;}
    if(state.modal===m){m.loading=false;render();}
  };
  $('#asanaProjectForm').onsubmit=e=>{e.preventDefault();void act('enable',{workspace:m.workspace,project:m.project,consent:m.consent===true,includeHistory:m.includeHistory===true});};
  $('#asanaSyncNow').onclick=()=>act('sync');$('#asanaPause').onclick=()=>act('pause');
  $('#asanaDisconnect').onclick=()=>{if(confirm('Stop syncing and remove this Asana connection? Existing logs in Asana will remain.'))void act('disconnect');};
  document.querySelectorAll('[data-asana-retry-create]').forEach(b=>b.onclick=()=>{if(confirm('Only continue if you checked Asana and no copy of this workout exists. An unseen copy could result in a duplicate.'))void act('retryCreate',{session:b.dataset.asanaRetryCreate,confirmMissing:true});});
}
