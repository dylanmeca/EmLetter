(()=>{
  let deferredPrompt=null;
  const standalone=()=>window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
  const isIOS=()=>/iphone|ipad|ipod/i.test(navigator.userAgent);

  async function register(){
    if(!('serviceWorker'in navigator)||!/^https?:$/.test(location.protocol))return;
    try{
      const base=(document.querySelector('meta[name="emletter-baseurl"]')?.content||'').replace(/\/$/,'');
      await navigator.serviceWorker.register(`${base}/sw.js`,{scope:`${base||''}/`});
    }catch(error){console.warn('[EmLetter PWA] Service worker no disponible.',error)}
  }

  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault();
    deferredPrompt=event;
    window.dispatchEvent(new CustomEvent('emletter-install-available'));
  });
  window.addEventListener('appinstalled',()=>{deferredPrompt=null});

  window.EmLetterPWA={
    isStandalone:standalone,
    isIOS,
    canPrompt:()=>Boolean(deferredPrompt),
    async install(){
      if(standalone())return {status:'installed'};
      if(deferredPrompt){
        const prompt=deferredPrompt;
        deferredPrompt=null;
        await prompt.prompt();
        const choice=await prompt.userChoice;
        return {status:choice?.outcome||'dismissed'};
      }
      return {status:isIOS()?'ios':'manual'};
    }
  };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',register,{once:true});
  else register();
})();
