(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TrainerStore=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const clone=x=>JSON.parse(JSON.stringify(x));
  class Store {
    constructor({userId,storage,send,onChange=()=>{},onAck=()=>{},online=()=>true,id=()=>crypto.randomUUID()}){
      this.userId=userId;this.storage=storage;this.send=send;this.onChange=onChange;this.onAck=onAck;this.online=online;this.id=id;
      this.key='trainer_floor_data_v1:'+userId;this.pending={};this.cache=null;this.error='';this.storageError='';this.running=null;this.closed=false;
      try{const saved=JSON.parse(storage.getItem(this.key)||'null');if(saved?.userId===userId){this.pending=saved.pending||{};this.cache=saved.cache||null;}}catch{this.storageError='Device storage unavailable';}
    }
    persist(){
      try{this.storage.setItem(this.key,JSON.stringify({userId:this.userId,pending:this.pending,cache:this.cache}));this.storageError='';return true;}
      catch{this.storageError='Device storage full or unavailable. Keep this screen open until cloud save succeeds.';return false;}
    }
    snapshot(data){this.cache=clone(data);const ok=this.persist();this.onChange(this.status());return ok;}
    hydrate(remote){
      const data=clone(remote);
      for(const item of Object.values(this.pending)){
        const list=item.kind==='client'?data.clients:data.sessions;
        const index=list.findIndex(r=>r.id===item.record.id);
        if(index<0)list.push(clone(item.record));else list[index]=clone(item.record);
      }
      this.snapshot(data);return data;
    }
    queue(kind,record){
      const key=kind+':'+record.id,previous=this.pending[key];
      this.pending[key]={kind,record:clone(record),expectedRevision:previous?.expectedRevision??record.revision??0,mutationId:this.id(),conflict:previous?.conflict||false};
      if(this.cache){const list=kind==='client'?this.cache.clients:this.cache.sessions;const index=list.findIndex(x=>x.id===record.id);if(index<0)list.push(clone(record));else list[index]=clone(record);}
      const ok=this.persist();this.onChange(this.status());return ok;
    }
    status(){return {pending:Object.keys(this.pending).length,conflicts:Object.values(this.pending).filter(x=>x.conflict).length,saving:!!this.running,offline:!this.online(),error:this.error,storageError:this.storageError};}
    flush(){
      if(this.running)return this.running;
      if(this.closed||!this.online())return Promise.resolve();
      this.running=this.drain().finally(()=>{this.running=null;this.onChange(this.status());});
      this.onChange(this.status());return this.running;
    }
    async drain(){
      // Parents must be saved before newly created sessions reference them.
      const keys=Object.keys(this.pending).sort((a,b)=>a.localeCompare(b));
      for(const key of keys){
        if(this.closed||!this.online())break;
        const item=this.pending[key];if(!item||item.conflict)continue;
        const sent=clone(item);
        try{
          const result=await this.send(sent);
          if(this.closed)break;
          const current=this.pending[key];
          if(current?.mutationId===sent.mutationId)delete this.pending[key];
          else if(current){current.expectedRevision=result.revision;current.record.revision=result.revision;}
          const list=sent.kind==='client'?this.cache?.clients:this.cache?.sessions;
          const cached=list?.find(x=>x.id===sent.record.id);if(cached)cached.revision=result.revision;
          this.error='';this.onAck(sent,result);this.persist();this.onChange(this.status());
        }catch(error){
          this.error=String(error?.message||'Cloud save unavailable');
          if(this.error.includes('TF_CONFLICT')){if(this.pending[key])this.pending[key].conflict=true;}
          this.persist();this.onChange(this.status());
          // Keep child records queued until parent saves have recovered.
          break;
        }
      }
    }
    resolve(key,remote,keepLocal){
      const item=this.pending[key];if(!item)return;
      if(keepLocal){item.expectedRevision=remote.revision;item.record.revision=remote.revision;item.mutationId=this.id();item.conflict=false;}
      else{delete this.pending[key];const list=item.kind==='client'?this.cache.clients:this.cache.sessions;const i=list.findIndex(x=>x.id===remote.id);if(i>=0)list[i]=clone(remote);}
      this.error='';this.persist();this.onChange(this.status());
    }
    close(){this.closed=true;}
  }
  return {Store};
});
