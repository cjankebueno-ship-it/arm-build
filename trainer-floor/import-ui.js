function importInputHtml(m){return modalWrap('Import clients & workouts',`
  ${m.error?`<div class="note-card">${esc(m.error)}</div>`:''}
  <div class="import-hero"><strong>Turn your old records into workout history.</strong><p>Upload a file or paste a GPT summary. Exercises become saved workouts with weights, sets and reps you can open and edit in History.</p></div>
  <div class="field"><label for="importMode">Save workouts as</label><select id="importMode"><option value="history" ${m.mode!=='program'?'selected':''}>Completed workouts — assume they were done</option><option value="program" ${m.mode==='program'?'selected':''}>Program templates for future sessions</option></select></div>
  <p class="tiny">Completed is the default. You review each workout before saving. Missing dates, weights and reps stay unknown.</p>
  <div class="field"><label for="importClientName">Client name for unnamed records (optional)</label><input id="importClientName" value="${esc(m.clientName||'')}" placeholder="Use when the file has no client name"></div>
  <div class="field"><label for="smartImportFile">Upload CSV, TXT, TSV, JSON, Markdown or PDF</label><input id="smartImportFile" type="file" accept=".csv,.txt,.tsv,.json,.md,.pdf,text/plain,text/csv,application/json,application/pdf"></div>
  ${m.filename?`<p class="muted">Selected: ${esc(m.filename)} ${m.fileData?'· PDF':''}</p>`:''}
  <div class="field"><label for="smartImportText">Or paste your workout records</label><textarea id="smartImportText" rows="8" placeholder="CLIENT: Taylor&#10;2026-10-20&#10;Dumbbell row: 25 lb, 3 x 12">${esc(m.sourceText||'')}</textarea></div>
  <button class="primary-btn full" id="analyzeSmartImport">Build my workout history</button>
  <p class="tiny">PDF limit: 2 MB. Text and PDFs are processed by the app’s AI import service. Review before anything is saved.</p>
  <details><summary>Moving from Trainerize?</summary><p>Trainerize’s client CSV contains names and contact details, not completed workout history. Export it from Clients → select clients → Export. To bring workout content, print workouts/programs to PDF or paste records you have access to, then review the reconstructed sessions. A program PDF does not prove performed weights or reps.</p><a href="https://help.trainerize.com/hc/en-us/articles/31089834946324-What-Information-Can-Be-Exported-from-ABC-Trainerize" target="_blank" rel="noopener">Trainerize export instructions</a></details>`);}

function importReviewHtml(m){
 const clients=m.parsed.clients,completed=clients.reduce((n,c)=>n+c.sessions.length,0),assumed=clients.reduce((n,c)=>n+c.sessions.filter(s=>s.assumed_completed).length,0);
 return modalWrap('Review & save workouts',`<div class="stats"><div class="stat"><b>${clients.length}</b><span>Clients</span></div><div class="stat"><b>${completed}</b><span>Completed workouts</span></div><div class="stat"><b>${assumed}</b><span>Completion assumed</span></div></div>
 <p class="muted">Selected sessions will be stored as completed workouts and appear in History. Uncheck any you do not want to import. Edit dates, weights or reps below.</p>
 ${!completed?'<p class="note-card">No completed workouts were found. This import contains client information or program templates only.</p>':''}
 ${m.parsed.warnings.length?`<details><summary>Review ${m.parsed.warnings.length} import notes</summary>${m.parsed.warnings.map(w=>`<p>${esc(w)}</p>`).join('')}</details>`:''}
 ${clients.map((c,ci)=>`<section class="settings-card"><div class="field"><label for="import-client-${ci}">Client</label><input id="import-client-${ci}" data-import-client="${ci}" value="${esc(c.name)}" required></div>${c.note?`<p class="note-text">${esc(c.note)}</p>`:''}
 ${c.sessions.map((s,si)=>`<div class="import-session"><label class="import-select"><input type="checkbox" data-import-include="${ci}:${si}" checked> Save completed workout · ${esc(s.date||'Date unknown')}</label><p class="tiny">${s.assumed_completed?'Completion assumed from your import choice.':'Source indicates this workout was performed.'}</p>
 <div class="field"><label for="import-date-${ci}-${si}">Workout date (blank = unknown)</label><input id="import-date-${ci}-${si}" data-import-date="${ci}:${si}" type="date" max="${todayKey()}" value="${esc(s.date||'')}"></div>
 <p>${esc(s.session_note||'')}</p>${s.exercises.map((ex,ei)=>`<details><summary>${esc(ex.name)} · ${esc(historyExerciseSummary(ex))}</summary><div class="field"><label>Exercise name</label><input data-import-ex="${ci}:${si}:${ei}:name" value="${esc(ex.name)}"></div><div class="field"><label>Weight, with units</label><input data-import-ex="${ci}:${si}:${ei}:weight" value="${esc(ex.weight)}"></div><div class="field"><label>Reps per set (comma separated; ? = unknown)</label><input data-import-ex="${ci}:${si}:${ei}:sets" value="${esc(ex.sets.map(n=>n==null?'?':n).join(', '))}"></div>${ex.note?`<p class="note-text">${esc(ex.note)}</p>`:''}</details>`).join('')}</div>`).join('')}
 ${c.current_workout.length?`<p>Program template: ${c.current_workout.map(ex=>esc(ex.name)).join(', ')}</p>`:''}</section>`).join('')}
 <button class="primary-btn full" id="confirmSmartHistory">Save selected workouts & clients</button><button class="ghost-btn full" id="backSmartHistory">Back</button>`);
}
function reviewSelection(parsed){
 const copy=JSON.parse(JSON.stringify(parsed));
 document.querySelectorAll('[data-import-client]').forEach(el=>{const name=el.value.trim();if(!name)throw Error('Every client needs a name.');copy.clients[+el.dataset.importClient].name=name;});
 document.querySelectorAll('[data-import-date]').forEach(el=>{const [c,s]=el.dataset.importDate.split(':').map(Number),date=el.value;if(date&&(!H.dateKey(date)||date>todayKey()))throw Error('Choose a valid past/current workout date, or leave it blank.');copy.clients[c].sessions[s].date=date||null;});
 document.querySelectorAll('[data-import-ex]').forEach(el=>{const [c,s,e,field]=el.dataset.importEx.split(':'),ex=copy.clients[+c].sessions[+s].exercises[+e],value=el.value.trim();if(field==='sets'){ex.sets=value?value.split(',').map(n=>{n=n.trim();if(n==='?'||n==='')return null;if(!/^\d+$/.test(n)||+n>10000)throw Error('Use whole rep counts or ? for unknown sets.');return +n;}):[];}else{if(field==='name'&&!value)throw Error('Every exercise needs a name.');ex[field]=value;}});
 document.querySelectorAll('[data-import-include]').forEach(el=>{const [c,s]=el.dataset.importInclude.split(':').map(Number);if(!el.checked)copy.clients[c].sessions[s].excluded=true;});
 copy.clients.forEach(c=>c.sessions=c.sessions.filter(s=>!s.excluded));return copy;
}
function rosterCsv(raw){
 const rows=parseCsv(raw);if(!rows.length)return null;const first=rows[0];
 const firstKey=['first name','firstname','first_name'].find(k=>k in first),lastKey=['last name','lastname','last_name'].find(k=>k in first);
 if(!firstKey||!lastKey||Object.keys(first).some(k=>/exercise|workout|session|reps/.test(k)))return null;
 const clients=rows.map(r=>({name:[r[firstKey],r[lastKey]].filter(Boolean).join(' ').trim(),note:[r.email?'Email: '+r.email:'',r.phone?'Phone: '+r.phone:r['phone number']?'Phone: '+r['phone number']:''].filter(Boolean).join('\n'),sessions:[],current_workout:[]})).filter(c=>c.name);
 return clients.length?{clients,warnings:['Client-list CSV: roster only. This file does not contain workout history.']}:null;
}
async function analyzeImportedData(text,filename='pasted notes',options={}){
 const importingUser=state.user?.id;
 const raw=String(text||'').trim(),mode=options.mode==='program'?'program':'history';
 if(!raw&&!options.fileData){toast('Paste records or choose a file');return;}
 state.modal={type:'smartHistoryLoading',filename,progress:'Building workout records…'};render();
 try{
  let structured=null;if(!options.fileData&&(raw.startsWith('{')||raw.startsWith('['))){try{structured=JSON.parse(raw);}catch{throw Error('This JSON is incomplete. Upload the complete file.');}}
  let parsed;
  if(structured&&Array.isArray(structured.clients))parsed=H.normalize(structured,{mode,assumeCompleted:true});
  else if(!options.fileData&&(parsed=rosterCsv(raw)))parsed=H.normalize(parsed,{mode,assumeCompleted:true});
  else{
   const source=typeof structured?.master_note==='string'?structured.master_note:raw;
   const chunks=options.fileData?[{name:filename,text:raw}]:H.splitNotes(source);parsed={clients:[],warnings:[]};
   for(let index=0;index<chunks.length;index++){
    const chunk=chunks[index];state.modal={type:'smartHistoryLoading',filename,progress:`Reading ${index+1} of ${chunks.length}: ${chunk.name}`};render();
    const request=async token=>fetch('https://members.chrisjanke.com/api/trainer-floor/parse-history',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({text:chunk.text,filename,mode,client_name:options.clientName||'',today:todayKey(),...(options.fileData?{file_data:options.fileData}:{})})});
    let response=await request(await freshAuthToken());if(response.status===401){const refreshed=await refreshSession(readStoredSession());if(!refreshed?.access_token)throw Error('Sign in again; your source is retained.');response=await request(refreshed.access_token);}
    const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(`${chunk.name}: ${data.error||'Import analysis failed'}. Nothing has been saved.`);
    if(state.user?.id!==importingUser)throw Error('Account changed during import. Sign back in and try again.');
    const normalized=H.normalize(data,{mode,fromParser:true,assumeCompleted:true});parsed.clients.push(...normalized.clients);parsed.warnings.push(...normalized.warnings);
   }
  }
  state.modal={type:'smartHistoryReview',parsed,filename,sourceText:raw,...options,mode};render();
 }catch(error){if(state.user?.id!==importingUser)return;state.modal={type:'smartImportInput',error:error.message||'Could not read this import',sourceText:raw,filename,...options,mode};render();}
}
function wireImportModal(m){
 if(m.type==='smartImportInput'){
  $('#smartImportFile').onchange=async event=>{
   const file=event.target.files?.[0];if(!file)return;
   try{
    const mode=$('#importMode').value,clientName=$('#importClientName').value.trim();
    if(/\.pdf$/i.test(file.name)||file.type==='application/pdf'){
     if(file.size>2*1024*1024)throw Error('PDF files must be 2 MB or smaller.');
     const bytes=new Uint8Array(await file.arrayBuffer());if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('This file is not a valid PDF.');
     const fileData=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Could not read PDF'));reader.readAsDataURL(file);});
     state.modal={...m,mode,clientName,filename:file.name,fileData:'data:application/pdf;base64,'+String(fileData).split(',')[1],sourceText:''};
    }else{if(file.size>1024*1024)throw Error('Text imports must be 1 MB or smaller. Split this file by client.');state.modal={...m,mode,clientName,filename:file.name,fileData:null,sourceText:await file.text()};}
    render();
   }catch(error){toast(error.message);}
  };
  $('#analyzeSmartImport').onclick=()=>analyzeImportedData($('#smartImportText').value,m.filename||'pasted notes',{mode:$('#importMode').value,clientName:$('#importClientName').value.trim(),fileData:m.fileData||null});
 }
 if(m.type==='smartHistoryReview'){
  $('#backSmartHistory').onclick=()=>{state.modal={...m,type:'smartImportInput'};render();};
  $('#confirmSmartHistory').onclick=async()=>{const button=$('#confirmSmartHistory');try{const parsed=reviewSelection(m.parsed);button.disabled=true;button.textContent='Saving workouts…';const result=await importSmartHistory(parsed);deviceStore?.snapshot(state.data);state.modal={type:'smartImportResult',result,parsed};render();}catch(error){button.disabled=false;button.textContent='Save selected workouts & clients';toast(error.message);}};
 }
}
