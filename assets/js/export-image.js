(()=>{
  const button=document.querySelector('#download-image');
  if(!button)return;
  const $=selector=>document.querySelector(selector);
  const HTML2CANVAS_SOURCES=[
    {
      src:'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
      integrity:'sha512-BNaRQnYJYiPSqHHDb58B0yaPfCu+Wgds8Gp/gU33kqBtgNS4tSPHuGibyoeqMV/TJlSKda6FXzoEyYGjTe+vXA=='
    },
    {
      src:'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
      integrity:'sha512-BNaRQnYJYiPSqHHDb58B0yaPfCu+Wgds8Gp/gU33kqBtgNS4tSPHuGibyoeqMV/TJlSKda6FXzoEyYGjTe+vXA=='
    },
    {
      src:'https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js',
      integrity:'sha512-BNaRQnYJYiPSqHHDb58B0yaPfCu+Wgds8Gp/gU33kqBtgNS4tSPHuGibyoeqMV/TJlSKda6FXzoEyYGjTe+vXA=='
    }
  ];
  const IMAGE_PROXY='https://wsrv.nl/';
  let noticeTimer;
  let rendererPromise;
  const UNSUPPORTED_COLOR_FUNCTION_RE=/\b(?:color-mix|color|oklch|oklab|lch|lab|device-cmyk)\s*\(/i;
  let styleProbe;

  function notify(message){
    const notice=$('#notice');
    if(!notice)return;
    notice.textContent=message;
    clearTimeout(noticeTimer);
    noticeTimer=setTimeout(()=>{notice.textContent=''},8000);
  }

  function hasContent(){
    const editor=$('#editor .tiptap');
    if(!editor)return false;
    return Boolean(editor.textContent.trim()||editor.querySelector('img,table,hr'));
  }

  function timeoutSignal(ms){
    if(typeof AbortSignal!=='undefined'&&typeof AbortSignal.timeout==='function')return AbortSignal.timeout(ms);
    if(typeof AbortController==='undefined')return null;
    const controller=new AbortController();
    setTimeout(()=>controller.abort(),ms);
    return controller.signal;
  }

  function toDataUrl(blob){
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(reader.result);
      reader.onerror=()=>reject(reader.error||new Error('No se pudo leer un recurso de la carta.'));
      reader.readAsDataURL(blob);
    });
  }

  async function fetchBlob(url){
    const response=await fetch(url,{mode:'cors',credentials:'omit',cache:'force-cache',signal:timeoutSignal(18000)||undefined});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const blob=await response.blob();
    if(!blob.type.startsWith('image/'))throw new Error('El recurso recibido no es una imagen.');
    return blob;
  }

  function proxyUrl(url){
    return `${IMAGE_PROXY}?url=${encodeURIComponent(url)}&output=png`;
  }

  async function fetchAsDataUrl(url){
    if(!url||/^data:/i.test(url))return url;
    if(/^blob:/i.test(url))return toDataUrl(await fetchBlob(url));

    const absolute=new URL(url,document.baseURI).href;
    try{
      return toDataUrl(await fetchBlob(absolute));
    }catch(directError){
      if(!/^https?:/i.test(absolute))throw directError;
      try{
        return toDataUrl(await fetchBlob(proxyUrl(absolute)));
      }catch(proxyError){
        const error=new Error('No se pudo preparar una imagen externa para la descarga. Prueba otra URL o una imagen alojada en un servicio público.');
        error.cause=proxyError;
        throw error;
      }
    }
  }

  async function embedImages(root){
    const images=[...root.querySelectorAll('img')];
    for(const image of images){
      const source=image.currentSrc||image.getAttribute('src')||image.src;
      if(!source)continue;
      const dataUrl=await fetchAsDataUrl(source);
      image.removeAttribute('srcset');
      image.removeAttribute('sizes');
      image.removeAttribute('crossorigin');
      image.src=dataUrl;
    }
  }

  function extractCssUrls(value){
    const results=[];
    const pattern=/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
    let match;
    while((match=pattern.exec(value)))results.push({full:match[0],source:(match[1]??match[2]??match[3]??'').trim()});
    return results;
  }

  async function embedStyleUrls(root){
    const elements=[root,...root.querySelectorAll('*')];
    const properties=['background-image','border-image-source','list-style-image','mask-image','-webkit-mask-image'];
    for(const element of elements){
      for(const property of properties){
        const value=element.style.getPropertyValue(property);
        if(!value||!value.includes('url('))continue;
        let next=value;
        for(const match of extractCssUrls(value)){
          const source=match.source;
          if(!source||/^data:/i.test(source)||source.startsWith('#'))continue;
          try{
            const dataUrl=await fetchAsDataUrl(source);
            next=next.replace(match.full,`url("${dataUrl}")`);
          }catch(error){
            if(property==='background-image')throw new Error('No se pudo preparar la imagen de fondo para la descarga. Prueba otra URL de fondo.');
            next=next.replace(match.full,'none');
          }
        }
        element.style.setProperty(property,next,element.style.getPropertyPriority(property));
      }
    }
  }

  function inlineComputedStyles(root){
    const elements=[root,...root.querySelectorAll('*')];
    for(const element of elements){
      const computed=getComputedStyle(element);
      for(const property of computed){
        if(property.startsWith('--'))continue;
        try{element.style.setProperty(property,computed.getPropertyValue(property),computed.getPropertyPriority(property))}catch{}
      }
    }
  }

  function getStyleProbe(){
    if(styleProbe?.isConnected)return styleProbe;
    styleProbe=document.createElement('div');
    styleProbe.setAttribute('aria-hidden','true');
    styleProbe.style.position='fixed';
    styleProbe.style.left='-100000px';
    styleProbe.style.top='0';
    styleProbe.style.pointerEvents='none';
    styleProbe.style.opacity='0';
    document.body.append(styleProbe);
    return styleProbe;
  }

  function resolveCssValue(property,value){
    if(!value||property.startsWith('--'))return '';
    const probe=getStyleProbe();
    probe.style.cssText='';
    try{
      probe.style.setProperty(property,value);
      return getComputedStyle(probe).getPropertyValue(property).trim();
    }catch{
      return '';
    }
  }

  function splitCssList(value){
    const parts=[];
    let current='',depth=0,quote='';
    for(let i=0;i<value.length;i++){
      const char=value[i];
      if(quote){
        current+=char;
        if(char===quote&&value[i-1]!=='\\')quote='';
        continue;
      }
      if(char==='"'||char==="'"){quote=char;current+=char;continue}
      if(char==='('){depth++;current+=char;continue}
      if(char===')'){depth=Math.max(0,depth-1);current+=char;continue}
      if(char===','&&depth===0){if(current.trim())parts.push(current.trim());current='';continue}
      current+=char;
    }
    if(current.trim())parts.push(current.trim());
    return parts;
  }

  function normalizeRendererShadows(root){
    const elements=[root,...root.querySelectorAll('*')];
    for(const element of elements){
      const shadow=element.style.getPropertyValue('box-shadow');
      if(!shadow||!/\binset\b/i.test(shadow))continue;
      const priority=element.style.getPropertyPriority('box-shadow');
      const safe=splitCssList(shadow).filter(part=>!/\binset\b/i.test(part));
      // html2canvas 1.4.1 can incorrectly paint an inset neon shadow across
      // the whole element. Keep outer shadows and let the real border carry
      // the inner edge so the exported paper retains its actual background.
      element.style.setProperty('box-shadow',safe.length?safe.join(', '):'none',priority);
    }
  }

  function normalizeUnsupportedColorFunctions(root){
    const elements=[root,...root.querySelectorAll('*')];
    for(const element of elements){
      const properties=[...element.style];
      for(const property of properties){
        if(property.startsWith('--')){
          element.style.removeProperty(property);
          continue;
        }
        const value=element.style.getPropertyValue(property);
        if(!value||!UNSUPPORTED_COLOR_FUNCTION_RE.test(value))continue;
        const priority=element.style.getPropertyPriority(property);
        const resolved=resolveCssValue(property,value);
        if(resolved&&!UNSUPPORTED_COLOR_FUNCTION_RE.test(resolved)){
          element.style.setProperty(property,resolved,priority);
          continue;
        }
        if(property==='background-image'||property==='mask-image'||property==='-webkit-mask-image'){
          element.style.setProperty(property,'none',priority);
        }else if(property==='box-shadow'||property==='text-shadow'||property==='filter'||property==='backdrop-filter'){
          element.style.removeProperty(property);
        }else if(property==='border'||property==='border-top'||property==='border-right'||property==='border-bottom'||property==='border-left'||property==='outline'||property==='column-rule'){
          element.style.removeProperty(property);
        }
      }
    }
  }

  function cleanupClone(root){
    root.removeAttribute('id');
    for(const element of root.querySelectorAll('[id]'))element.removeAttribute('id');
    for(const element of root.querySelectorAll('[contenteditable]'))element.removeAttribute('contenteditable');
    for(const element of root.querySelectorAll('[data-placeholder]'))element.removeAttribute('data-placeholder');
    for(const element of root.querySelectorAll('.ProseMirror,.ProseMirror-focused,.ProseMirror-selectednode,.selectedCell')){
      element.classList.remove('ProseMirror','ProseMirror-focused','ProseMirror-selectednode','selectedCell');
    }
    for(const element of root.querySelectorAll('[aria-selected="true"]'))element.removeAttribute('aria-selected');
  }

  function waitForImages(root){
    return Promise.all([...root.querySelectorAll('img')].map(image=>{
      if(image.complete&&image.naturalWidth)return Promise.resolve();
      if(image.decode)return image.decode().catch(()=>{});
      return new Promise(resolve=>{
        image.addEventListener('load',resolve,{once:true});
        image.addEventListener('error',resolve,{once:true});
      });
    }));
  }

  function loadScript(source){
    return new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src=source.src;
      script.async=true;
      script.crossOrigin='anonymous';
      script.integrity=source.integrity;
      script.referrerPolicy='no-referrer';
      script.dataset.emletterHtml2canvas='';
      script.onload=()=>typeof window.html2canvas==='function'?resolve(window.html2canvas):reject(new Error('El exportador no se inició.'));
      script.onerror=()=>{script.remove();reject(new Error('No se pudo cargar el exportador.'))};
      document.head.append(script);
    });
  }

  function loadRenderer(){
    if(typeof window.html2canvas==='function')return Promise.resolve(window.html2canvas);
    if(rendererPromise)return rendererPromise;
    rendererPromise=(async()=>{
      let lastError;
      for(const source of HTML2CANVAS_SOURCES){
        try{return await loadScript(source)}catch(error){lastError=error}
      }
      throw lastError||new Error('No se pudo cargar el exportador de imagen. Revisa tu conexión e inténtalo de nuevo.');
    })();
    return rendererPromise;
  }

  function dataUrlToBlob(dataUrl){
    const [meta,data]=dataUrl.split(',');
    const mime=(meta.match(/^data:([^;]+)/)||[])[1]||'image/png';
    const binary=atob(data);
    const bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    return new Blob([bytes],{type:mime});
  }

  function canvasToBlob(canvas){
    return new Promise((resolve,reject)=>{
      try{
        if(typeof canvas.toBlob==='function'){
          canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('El navegador no pudo crear el PNG.')),'image/png');
          return;
        }
        resolve(dataUrlToBlob(canvas.toDataURL('image/png')));
      }catch(error){
        if(error?.name==='SecurityError')reject(new Error('Una imagen externa no pudo convertirse de forma segura. Prueba otra URL para esa imagen.'));
        else reject(error);
      }
    });
  }

  async function createPng(){
    if(!hasContent())throw new Error('Escribe unas palabras antes de descargar la carta.');
    const sourcePaper=$('#edit-paper');
    if(!sourcePaper)throw new Error('No se encontró la carta para exportar.');

    notify('Preparando la carta para descargarla…');
    const renderer=await loadRenderer();
    const sourceSurface=sourcePaper.closest('.paper-wrap')||sourcePaper.parentElement||document.body;
    const paperRect=sourcePaper.getBoundingClientRect();
    const surfaceStyle=getComputedStyle(sourceSurface);
    const paperStyle=getComputedStyle(sourcePaper);
    const paperWidth=Math.max(320,Math.ceil(paperRect.width||parseFloat(paperStyle.width)||parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--paper-width'))||0));
    const paddingTop=Math.max(0,parseFloat(surfaceStyle.paddingTop)||0);
    const paddingRight=Math.max(0,parseFloat(surfaceStyle.paddingRight)||0);
    const paddingBottom=Math.max(0,parseFloat(surfaceStyle.paddingBottom)||0);
    const paddingLeft=Math.max(0,parseFloat(surfaceStyle.paddingLeft)||0);

    const stage=document.createElement('div');
    stage.className='export-stage';
    stage.setAttribute('aria-hidden','true');
    stage.style.position='fixed';
    stage.style.left='-100000px';
    stage.style.top='0';
    stage.style.boxSizing='border-box';
    stage.style.width=`${Math.ceil(paperWidth+paddingLeft+paddingRight)}px`;
    stage.style.padding=`${paddingTop}px ${paddingRight}px ${paddingBottom}px ${paddingLeft}px`;
    stage.style.pointerEvents='none';
    stage.style.zIndex='-1';
    stage.style.backgroundColor=surfaceStyle.backgroundColor;
    stage.style.backgroundImage=surfaceStyle.backgroundImage;
    stage.style.backgroundSize=surfaceStyle.backgroundSize;
    stage.style.backgroundPosition=surfaceStyle.backgroundPosition;
    stage.style.backgroundRepeat=surfaceStyle.backgroundRepeat;
    stage.style.backgroundOrigin=surfaceStyle.backgroundOrigin;
    stage.style.backgroundClip=surfaceStyle.backgroundClip;

    const paper=sourcePaper.cloneNode(true);
    cleanupClone(paper);
    paper.style.width=`${paperWidth}px`;
    paper.style.maxWidth=`${paperWidth}px`;
    paper.style.marginLeft=paperStyle.marginLeft;
    paper.style.marginRight=paperStyle.marginRight;
    stage.append(paper);
    document.body.append(stage);

    try{
      if(document.fonts?.ready)await document.fonts.ready;
      inlineComputedStyles(stage);
      normalizeRendererShadows(stage);
      normalizeUnsupportedColorFunctions(stage);
      await embedImages(stage);
      await embedStyleUrls(stage);
      await waitForImages(stage);

      const width=Math.ceil(stage.getBoundingClientRect().width||parseFloat(stage.style.width));
      const height=Math.ceil(stage.scrollHeight);
      if(!width||!height)throw new Error('No se pudo calcular el tamaño de la carta.');

      const maxSide=15000;
      const maxPixels=70000000;
      const preferredScale=Math.min(3,Math.max(2,window.devicePixelRatio||1));
      const pixelRatio=Math.min(
        preferredScale,
        maxSide/Math.max(width,height),
        Math.sqrt(maxPixels/(width*height))
      );
      if(!Number.isFinite(pixelRatio)||pixelRatio<0.55)throw new Error('La carta es demasiado larga para exportarla como una sola imagen en este dispositivo.');

      const canvas=await renderer(stage,{
        backgroundColor:null,
        scale:pixelRatio,
        useCORS:false,
        allowTaint:false,
        foreignObjectRendering:false,
        logging:false,
        imageTimeout:0,
        width,
        height,
        windowWidth:Math.max(document.documentElement.clientWidth,width),
        windowHeight:Math.max(document.documentElement.clientHeight,height),
        scrollX:0,
        scrollY:0,
        removeContainer:true
      });
      return canvasToBlob(canvas);
    }finally{
      stage.remove();
    }
  }

  function downloadBlob(blob){
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    const date=new Date();
    const stamp=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
    link.href=url;
    link.download=`emletter-${stamp}.png`;
    link.rel='noopener';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),5000);
  }

  button.addEventListener('click',async()=>{
    if(button.disabled)return;
    const original=button.innerHTML;
    button.disabled=true;
    button.textContent='Preparando imagen…';
    try{
      const blob=await createPng();
      downloadBlob(blob);
      notify('Carta descargada como PNG en alta calidad. No se usó la captura de pantalla del navegador.');
    }catch(error){
      console.error('[EmLetter export]',error);
      notify(error?.message||'No se pudo descargar la carta como imagen.');
    }finally{
      button.disabled=false;
      button.innerHTML=original;
    }
  });
})();
