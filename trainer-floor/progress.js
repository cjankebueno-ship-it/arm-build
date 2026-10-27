(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TrainerProgress=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const nameKey=name=>String(name||'').trim().toLowerCase().replace(/\s+/g,' ');
  function load(value){
    const raw=String(value??'').trim();
    const match=raw.match(/^(\d+(?:\.\d+)?)\s*(lb|lbs|kg)?$/i);
    if(!match)return null;
    return {value:Number(match[1]),unit:match[2]?.toLowerCase()==='kg'?'kg':'lb'};
  }
  function series(sessions,clientId,name){
    const points=[];
    for(const session of sessions){
      if(session.clientId!==clientId||!session.completedAt||!session.date||session.date==='1900-01-01')continue;
      for(const ex of session.exercises||[]){
        if(nameKey(ex.name)!==nameKey(name))continue;
        const weight=load(ex.weight),reps=(ex.sets||[]).filter(v=>Number.isInteger(v)&&v>0);
        // Range, assisted, mixed-load and unrecorded results are kept in history,
        // but are not converted into misleading numeric personal records.
        if(!weight||!reps.length)continue;
        points.push({date:session.date,sessionId:session.id,weight:weight.value,unit:weight.unit,reps:Math.max(...reps),totalReps:reps.reduce((a,b)=>a+b,0),sets:reps.length});
      }
    }
    return points.sort((a,b)=>a.date.localeCompare(b.date)||a.sessionId.localeCompare(b.sessionId));
  }
  function records(points){
    const groups={};
    for(const p of points){const group=groups[p.unit]||(groups[p.unit]=[]);group.push(p);}
    return Object.entries(groups).map(([unit,rows])=>({unit,best:rows.reduce((a,b)=>b.weight>a.weight||(b.weight===a.weight&&b.reps>a.reps)?b:a),latest:rows.at(-1),first:rows[0],points:rows}));
  }
  return {nameKey,load,series,records};
});
