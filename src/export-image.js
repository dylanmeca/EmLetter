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
  const GIF_SOURCES=[
    {
      src:'https://cdn.jsdelivr.net/npm/gif.js.optimized@1.0.1/dist/gif.js',
      worker:'https://cdn.jsdelivr.net/npm/gif.js.optimized@1.0.1/dist/gif.worker.js'
    },
    {
      src:'https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.js',
      worker:'https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js'
    },
    {
      src:'https://unpkg.com/gif.js.optimized@1.0.1/dist/gif.js',
      worker:'https://unpkg.com/gif.js.optimized@1.0.1/dist/gif.worker.js'
    }
  ];
  const IMAGE_PROXY='https://wsrv.nl/';
  let noticeTimer;
  let rendererPromise;
  let encoderPromise;
  let gifWorkerScript='';
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
    return Boolean(editor.textContent.trim()||editor.querySelector('img,table,hr')||document.querySelector('#edit-paper .free-sticker'));
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

  function splitShadowList(value){
    const parts=[];
    let current='';
    let depth=0;
    for(const char of String(value||'')){
      if(char==='(')depth++;
      if(char===')')depth=Math.max(0,depth-1);
      if(char===','&&depth===0){parts.push(current.trim());current='';continue}
      current+=char;
    }
    if(current.trim())parts.push(current.trim());
    return parts;
  }

  function makeNeonFrameExportSafe(root){
    const paper=root.querySelector('.paper');
    if(!paper)return;
    const shadows=splitShadowList(paper.style.getPropertyValue('box-shadow'));
    const safeShadows=shadows.filter(part=>!part.toLowerCase().includes('inset'));
    if(safeShadows.length)paper.style.setProperty('box-shadow',safeShadows.join(', '),paper.style.getPropertyPriority('box-shadow'));
    else paper.style.removeProperty('box-shadow');
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

  function loadScript(source,globalName){
    return new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src=source.src;
      script.async=true;
      script.crossOrigin='anonymous';
      if(source.integrity)script.integrity=source.integrity;
      script.referrerPolicy='no-referrer';
      script.onload=()=>typeof window[globalName]==='function'?resolve(window[globalName]):reject(new Error('El exportador no se inició.'));
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
        try{return await loadScript(source,'html2canvas')}catch(error){lastError=error}
      }
      throw lastError||new Error('No se pudo cargar el exportador de imagen. Revisa tu conexión e inténtalo de nuevo.');
    })();
    return rendererPromise;
  }

  async function loadWorkerFrom(source){
    const response=await fetch(source,{mode:'cors',credentials:'omit',signal:timeoutSignal(18000)||undefined});
    if(!response.ok)throw new Error(`No se pudo obtener el codificador GIF (HTTP ${response.status}).`);
    const worker=await response.blob();
    if(!worker.size)throw new Error('El codificador GIF recibido está vacío.');
    // Los navegadores no permiten new Worker() con URL de otro origen.
    // Un blob: creado aquí sí corresponde al origen de la página.
    return URL.createObjectURL(new Blob([worker],{type:'text/javascript'}));
  }

  function loadEncoder(){
    if(typeof window.GIF==='function'&&gifWorkerScript)return Promise.resolve({GIF:window.GIF,workerScript:gifWorkerScript});
    if(encoderPromise)return encoderPromise;
    encoderPromise=(async()=>{
      let lastError;
      for(const source of GIF_SOURCES){
        try{
          const GIF=typeof window.GIF==='function'?window.GIF:await loadScript(source,'GIF');
          gifWorkerScript=await loadWorkerFrom(source.worker);
          return {GIF,workerScript:gifWorkerScript};
        }catch(error){
          lastError=error;
        }
      }
      throw lastError||new Error('No se pudo cargar el exportador de GIF. Revisa tu conexión e inténtalo de nuevo.');
    })().catch(error=>{encoderPromise=null;throw error});
    return encoderPromise;
  }

  function motionTargets(stage){
    const selectors=[
      '.ornament-symbol','.end-ornament','.emoji-frame .frame-side',
      '.letter-signature[data-signature-style="digital"]',
      '.ornament-line','.tiptap img',
      '.free-sticker.free-visual>.emletter-visual-copy'
    ];
    return [...new Set(stage.querySelectorAll(selectors.join(',')))].filter(el=>{
      const computed=getComputedStyle(el);
      return computed.display!=='none'&&computed.visibility!=='hidden'&&el.getBoundingClientRect().width>0;
    }).map((el,i)=>{
      const computed=getComputedStyle(el);
      return {
        el,
        baseTransform:computed.transform==='none'?'':computed.transform,
        baseOpacity:Number.isFinite(parseFloat(computed.opacity))?parseFloat(computed.opacity):1,
        baseFilter:computed.filter==='none'?'':computed.filter,
        shimmer:el.classList.contains('ornament-line'),
        phase:(i%4)*.54
      };
    });
  }

  function setMotionFrame(targets,frame,frameCount,reducedMotion){
    for(const item of targets){
      const {el,baseTransform,baseOpacity,baseFilter,phase,shimmer}=item;
      if(reducedMotion){
        el.style.transform=baseTransform||'none';
        el.style.opacity=String(baseOpacity);
        el.style.filter=baseFilter||'none';
        continue;
      }
      const angle=Math.PI*2*frame/frameCount;
      if(shimmer){
        el.style.opacity=String(baseOpacity*(.91+.09*Math.sin(angle+phase)));
        el.style.filter=`${baseFilter} brightness(${(1.05+.10*Math.sin(angle+phase)).toFixed(3)})`.trim();
        continue;
      }
      const dx=(1.3*Math.sin(angle+phase)).toFixed(2);
      const dy=(-1.5+1.1*Math.cos(angle+phase)).toFixed(2);
      const rotation=(.8*Math.sin(angle+phase)).toFixed(2);
      // Componemos el movimiento con la matriz existente: jamás perder el
      // desplazamiento elegido por la persona para stickers/ornamentos libres.
      el.style.transform=`${baseTransform} translate(${dx}px, ${dy}px) rotate(${rotation}deg)`.trim();
      el.style.transformOrigin='50% 85%';
    }
  }

  async function prepareStage(){
    if(!hasContent())throw new Error('Escribe unas palabras antes de descargar la carta.');
    const sourcePaper=$('#edit-paper');
    if(!sourcePaper)throw new Error('No se encontró la carta para exportar.');

    notify('Preparando la carta animada…');
    const renderer=await loadRenderer();

    const paperWidth=Math.max(1,sourcePaper.getBoundingClientRect().width);
    const wrapper=getComputedStyle(sourcePaper.parentElement);
    const pageSpace=Math.max(0,parseFloat(wrapper.paddingLeft)||0);

    const stage=document.createElement('div');
    stage.className='export-stage export-animated';
    stage.setAttribute('aria-hidden','true');
    stage.style.position='fixed';
    stage.style.left='-100000px';
    stage.style.top='0';
    stage.style.width=`${Math.ceil(paperWidth+pageSpace*2)}px`;
    stage.style.padding=`${pageSpace}px`;
    stage.style.pointerEvents='none';
    stage.style.zIndex='-1';

    const paper=sourcePaper.cloneNode(true);
    const sourceBlocks=[...sourcePaper.querySelectorAll('#editor .tiptap > *')];
    const copyBlocks=[...paper.querySelectorAll('#editor .tiptap > *')];
    sourceBlocks.forEach((block,i)=>{
      const clone=copyBlocks[i];
      if(!clone)return;
      const computed=getComputedStyle(block);
      const position=computed.position;
      if(position==='absolute'||position==='relative'){
        for(const key of ['position','left','top','right','bottom','width','max-width','min-width','margin','box-sizing','z-index']){
          clone.style.setProperty(key,computed.getPropertyValue(key),'important');
        }
      }
      const transform=computed.transform;
      if(transform&&transform!=='none')clone.style.setProperty('transform',transform,'important');
      else if(position==='absolute')clone.style.setProperty('transform','none','important');
    });

    paper.style.minHeight=Math.ceil(sourcePaper.scrollHeight)+'px';
    cleanupClone(paper);
    paper.style.width='100%';
    paper.style.maxWidth=`${paperWidth}px`;
    paper.style.marginLeft='auto';
    paper.style.marginRight='auto';
    stage.append(paper);
    document.body.append(stage);

    try{
      if(document.fonts?.ready)await document.fonts.ready;
      inlineComputedStyles(stage);
      if(document.body.dataset.frameMode==='neon')makeNeonFrameExportSafe(stage);
      normalizeUnsupportedColorFunctions(stage);
      await embedImages(stage);
      await embedStyleUrls(stage);
      await waitForImages(stage);
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));

      const width=Math.ceil(stage.getBoundingClientRect().width||parseFloat(stage.style.width));
      const height=Math.ceil(stage.scrollHeight);
      if(!width||!height)throw new Error('No se pudo calcular el tamaño de la carta.');

      return {renderer,stage,width,height};
    }catch(error){
      stage.remove();
      throw error;
    }
  }

  function makeRenderOptions(width,height,pixelRatio){
    return {
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
    };
  }

  async function createGif(){
    const {renderer,stage,width,height}=await prepareStage();
    try{
      const {GIF,workerScript}=await loadEncoder();
      const reducedMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const maxSide=4800;
      const maxPixels=2800000;
      const surface=width*height;
      const preferredScale=surface>1200000?1:1.1;
      const pixelRatio=Math.min(
        preferredScale,
        maxSide/Math.max(width,height),
        Math.sqrt(maxPixels/Math.max(1,surface))
      );
      if(!Number.isFinite(pixelRatio)||pixelRatio<0.5)throw new Error('La carta es demasiado larga para exportarla como GIF en este dispositivo.');

      const frameCount=reducedMotion?2:(surface>1800000?7:surface>900000?9:12);
      const frameDelay=reducedMotion?500:190;
      const gifWidth=Math.max(1,Math.round(width*pixelRatio));
      const gifHeight=Math.max(1,Math.round(height*pixelRatio));
      const renderOptions=makeRenderOptions(width,height,pixelRatio);

      const gif=new GIF({
        workers:2,
        quality:10,
        workerScript,
        width:gifWidth,
        height:gifHeight,
        repeat:0
      });


      const targets=motionTargets(stage);
      for(let frame=0;frame<frameCount;frame++){
        notify(`Capturando la animación… ${frame+1}/${frameCount}`);
        setMotionFrame(targets,frame,frameCount,reducedMotion);
        const canvas=await renderer(stage,renderOptions);
        gif.addFrame(canvas,{copy:true,delay:frameDelay});
        canvas.width=1;
        canvas.height=1;
      }

      const finished=new Promise((resolve,reject)=>{
        let timeout;
        const done=callback=>value=>{clearTimeout(timeout);callback(value)};
        gif.on('finished',done(resolve));
        gif.on('abort',done(()=>reject(new Error('Se canceló la generación del GIF.'))));
        gif.on('error',done(error=>reject(error instanceof Error?error:new Error('No se pudo generar el GIF animado.'))));
        gif.on('progress',progress=>notify(`Codificando el GIF… ${Math.max(1,Math.round(progress*100))}%`));
        timeout=setTimeout(()=>{
          reject(new Error('El GIF tardó demasiado en codificarse. Prueba con una carta más corta.'));
          try{gif.abort()}catch{}
        },120000);
      });

      notify('Codificando el GIF…');
      try{gif.render()}catch(error){try{gif.abort()}catch{};throw error}
      const blob=await finished;
      if(!(blob instanceof Blob))throw new Error('El navegador no devolvió el GIF animado.');
      return blob;
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
    link.download=`emletter-${stamp}.gif`;
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
    button.textContent='Preparando GIF…';
    try{
      const blob=await createGif();
      downloadBlob(blob);
      notify('Carta descargada como GIF animado. El enlace y la vista previa siguen funcionando como antes.');
    }catch(error){
      console.error('[EmLetter export]',error);
      notify(error?.message||'No se pudo descargar la carta como GIF.');
    }finally{
      button.disabled=false;
      button.innerHTML=original;
    }
  });
})();
