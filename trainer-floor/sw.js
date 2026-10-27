const CACHE='trainer-floor-shell-0.16.2';
const SHELL=['./','./index.html','./history.js?v=0.16.2','./store.js?v=0.16.2','./progress.js?v=0.16.2','./features.js?v=0.16.2','./features.css?v=0.16.2','./manifest.webmanifest','./icon.svg','./icon-180.png','./icon-192.png','./icon-512.png','./import-ui.js?v=0.16.2','./founder.js?v=0.16.2'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('trainer-floor-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  // Never cache authentication, private API data, or third-party requests.
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  const path=url.pathname.split('/').at(-1);
  if(!['','index.html','history.js','store.js','progress.js','features.js','features.css','manifest.webmanifest','icon.svg','icon-180.png','icon-192.png','icon-512.png','import-ui.js','founder.js'].includes(path))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    if(event.request.mode==='navigate'){
      try{const response=await fetch(event.request);if(response.ok)await cache.put('./index.html',response.clone());return response;}
      catch{return await cache.match('./index.html')||Response.error();}
    }
    const cached=await cache.match(event.request);if(cached)return cached;
    return fetch(event.request);
  })());
});
