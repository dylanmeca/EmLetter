---
layout: null
---
const VERSION='emletter-pwa-v1';
const BASE='{{ site.baseurl | default: "" }}';
const HOME=`${BASE}/`;
const CORE=[
  HOME,
  `${BASE}/assets/css/style.css`,
  `${BASE}/assets/js/app.js`,
  `${BASE}/assets/js/export-image.js`,
  `${BASE}/assets/js/pwa.js`,
  `${BASE}/assets/js/mobile-app.js`,
  `${BASE}/assets/favicon.svg`,
  `${BASE}/assets/icons/apple-touch-icon.png`,
  `${BASE}/assets/icons/icon-192.png`,
  `${BASE}/assets/icons/icon-512.png`,
  `${BASE}/assets/icons/icon-maskable-512.png`,
  `${BASE}/manifest.webmanifest`
];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==VERSION).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

async function navigationResponse(request){
  try{
    const response=await fetch(request);
    if(response?.ok){const cache=await caches.open(VERSION);cache.put(request,response.clone())}
    return response;
  }catch{
    return (await caches.match(request))||(await caches.match(HOME));
  }
}

async function staticResponse(request){
  const cached=await caches.match(request);
  if(cached)return cached;
  const response=await fetch(request);
  if(response&&(response.ok||response.type==='opaque')){
    const cache=await caches.open(VERSION);
    cache.put(request,response.clone());
  }
  return response;
}

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(request.mode==='navigate'&&url.origin===location.origin){
    event.respondWith(navigationResponse(request));
    return;
  }
  if(url.origin===location.origin||url.hostname==='fonts.googleapis.com'||url.hostname==='fonts.gstatic.com'){
    event.respondWith(staticResponse(request));
  }
});
