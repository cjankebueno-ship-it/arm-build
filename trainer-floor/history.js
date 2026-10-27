(function(root){
  'use strict';
  const text = value => typeof value === 'string' ? value.trim() : '';
  function dateKey(value){
    if(typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(value+'T12:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value ? value : null;
  }
  function localDay(date = new Date()){
    return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
  }
  function dateLabel(session){
    if((session.sessionNote||'').startsWith('[DATE UNKNOWN]')) return 'Date unknown';
    const day=dateKey(session.date);
    return day ? new Date(day+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) : 'Date unknown';
  }
  function sortSessions(a,b){
    const day=s=>(s.sessionNote||'').startsWith('[DATE UNKNOWN]')?'':(dateKey(s.date)||'');
    return day(b).localeCompare(day(a)) || String(b.completedAt||'').localeCompare(String(a.completedAt||''));
  }
  function validRep(value){
    if(value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    const n=Number(value);
    return Number.isInteger(n) && n>=0 && n<=10000 ? n : null;
  }
  function normalize(value,{fromParser=false,mode='history',assumeCompleted=false}={}){
    if(!value || !Array.isArray(value.clients) || !value.clients.length) throw new Error('This file needs a non-empty clients list.');
    const warnings=Array.isArray(value.warnings)?value.warnings.filter(x=>typeof x==='string'):[];
    const exercise=(ex,planned=false)=>{
      if(!ex || !text(ex.name)) throw new Error('An exercise is missing its name. Correct the source before importing.');
      const raw=Array.isArray(ex.sets)?ex.sets:[];
      const sets=raw.map(validRep);
      let note=text(ex.note);
      const invalid=raw.filter((v,i)=>v!==null && v!=='' && v!==undefined && sets[i]===null);
      if(invalid.length){
        note=[note,'Source reps: '+invalid.map(String).join(', ')].filter(Boolean).join(' • ');
        warnings.push(ex.name+': unrecognized reps kept in notes, not logged as completed reps.');
      }
      if(planned && sets.some(n=>n!==null)) note=[note,'Target reps: '+sets.map(n=>n===null?'?':n).join(', ')].filter(Boolean).join(' • ');
      return {name:text(ex.name),category:text(ex.category||ex.cat),equipment:text(ex.equipment||ex.eq),weight:ex.weight===null||ex.weight===undefined?'':String(ex.weight).trim(),sets:planned?(sets.length?sets.map(()=>null):[null,null,null]):sets,note,progressAt:validRep(ex.progressAt)||15};
    };
    const clients=value.clients.map(c=>{
      if(!c || !text(c.name)) throw new Error('A client is missing a name. Nothing has been imported.');
      const sessions=[];
      const candidates=[...(Array.isArray(c.sessions)?c.sessions:[])];
      const current=Array.isArray(c.current_workout)?c.current_workout:[];
      if(mode==='history'&&assumeCompleted&&current.length&&!candidates.some(s=>fingerprint(s.exercises)===fingerprint(current)))candidates.push({date:null,completed:false,assumed_completed:true,session_note:'Imported workout; completion assumed by trainer.',exercises:current});
      const planned=[];
      for(const s of candidates){
        if(mode==='program'){planned.push(...(Array.isArray(s.exercises)?s.exercises:[]));continue;}
        if(!assumeCompleted && s.completed!==true && !(fromParser && s.completed===undefined)){
          warnings.push(c.name+': excluded a session without confirmed completion.');continue;
        }
        let date=s.date?dateKey(s.date):null;
        if(s.date && !date) throw new Error(c.name+': invalid session date '+String(s.date)+'. Correct it before importing.');
        let note=text(s.session_note);
        const assumed=s.assumed_completed===true||s.completed!==true;
        if(date && date>localDay()){
          if(!assumeCompleted||!assumed)throw new Error(c.name+': a completed session is dated in the future ('+date+').');
          note=['Source date: '+date+' (future; review actual workout date).',note].filter(Boolean).join(' ');date=null;
          warnings.push(c.name+': a future source date needs review; no completion date was invented.');
        }
        sessions.push({date,completed:true,assumed_completed:assumed,session_note:note,exercises:(Array.isArray(s.exercises)?s.exercises:[]).map(ex=>exercise(ex))});
      }
      return {name:text(c.name),aliases:(Array.isArray(c.aliases)?c.aliases:[]).map(text).filter(Boolean),note:text(c.note),sessions,current_workout:(mode==='program'?[...planned,...current]:assumeCompleted?[]:current).map(ex=>exercise(ex,true))};
    });
    return {clients,warnings:[...new Set(warnings)]};
  }
  function fingerprint(exercises){
    return JSON.stringify((exercises||[]).map(ex=>({name:text(ex.name).toLowerCase(),weight:String(ex.weight??'').trim(),sets:(ex.sets||[]).map(validRep),note:text(ex.note)})));
  }
  function hasLoggedSets(session){return (session.exercises||[]).some(ex=>(ex.sets||[]).some(v=>validRep(v)!==null));}
  function splitNotes(raw){
    const matches=[...raw.matchAll(/^CLIENT:\s*(.+)$/gm)];
    if(matches.length<2) return [{name:'Notes',text:raw}];
    const intro=raw.slice(0,matches[0].index);
    return matches.map((m,i)=>({name:m[1].trim(),text:intro+raw.slice(m.index,matches[i+1]?.index)}));
  }
  const api={dateKey,localDay,dateLabel,sortSessions,validRep,normalize,fingerprint,hasLoggedSets,splitNotes};
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  else root.TrainerHistory=api;
})(typeof globalThis!=='undefined'?globalThis:this);
