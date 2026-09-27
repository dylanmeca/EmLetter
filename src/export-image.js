(()=>{
  const button=document.querySelector('#download-image');
  if(!button)return;
  const $=selector=>document.querySelector(selector);
  const HTML2CANVAS_URL='https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
  const HTML2CANVAS_INTEGRITY='sha512-BNaRQnYJYiPSqHHDb58B0yaPfCu+Wgds8Gp/gU33kqBtgNS4tSPHuGibyoeqMV/TJlSKda6FXzoEyYGjTe+vXA==';
  let noticeTimer;
  let rendererPromise;

  function notify(message){
    const notice=$('#notice');
    if(!notice)return;
    notice.textContent=message;
    clearTimeout(noticeTimer);
    noticeTimer=setTimeout(()=>{notice.textContent=''},7000);
  }

  function hasContent(){
    const editor=$('#editor .tiptap');
    if(!editor)return false;
    return Boolean(editor.textContent.trim()||editor.querySelector('img,table,hr'));
  }

  function toDataUrl(blob){
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(reader.result);
      reader.onerror=()=>reject(reader.error||new Error('No se pudo leer un recurso de la carta.'));
      reader.readAsDataURL(blob);
    });
  }

  async function fetchAsDataUrl(url){
    if(!url||/^data:/i.test(url))return url;
    const absolute=/^blob:/i.test(url)?url:new URL(url,document.baseURI).href;
    const response=await fetch(absolute,/^blob:/i.test(absolute)?{}:{mode:'cors',credentials:'omit'});
    if(!response.ok)throw new Error(`No se pudo cargar un recurso externo (${response.status}).`);
    return toDataUrl(await response.blob());
  }

  async function embedImages(root){
    const images=[...root.querySelectorAll('img')];
    for(const image of images){
      const source=image.currentSrc||image.getAttribute('src')||image.src;
      if(!source)continue;
      try{
        const dataUrl=await fetchAsDataUrl(source);
        image.removeAttribute('srcset');
        image.removeAttribute('sizes');
        image.src=dataUrl;
      }catch{
        throw new Error('Una imagen externa no permite ser incluida en la descarga. Usa una imagen con CORS habilitado o elimínala antes de descargar.');
      }
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
          }catch{
            if(property==='background-image'){
              throw new Error('La imagen de fondo externa no permite ser incluida en la descarga. Usa una URL con CORS habilitado o cambia el fondo.');
            }
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
        element.style.setProperty(property,computed.getPropertyValue(property),computed.getPropertyPriority(property));
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

  function loadRenderer(){
    if(typeof window.html2canvas==='function')return Promise.resolve(window.html2canvas);
    if(rendererPromise)return rendererPromise;
    rendererPromise=new Promise((resolve,reject)=>{
      const existing=document.querySelector('script[data-emletter-html2canvas]');
      if(existing){
        existing.addEventListener('load',()=>typeof window.html2canvas==='function'?resolve(window.html2canvas):reject(new Error('No se pudo iniciar el exportador de imagen.')),{once:true});
        existing.addEventListener('error',()=>reject(new Error('No se pudo cargar el exportador de imagen. Revisa tu conexión e inténtalo de nuevo.')),{once:true});
        return;
      }
      const script=document.createElement('script');
      script.src=HTML2CANVAS_URL;
      script.async=true;
      script.crossOrigin='anonymous';
      script.integrity=HTML2CANVAS_INTEGRITY;
      script.referrerPolicy='no-referrer';
      script.dataset.emletterHtml2canvas='';
      script.onload=()=>typeof window.html2canvas==='function'?resolve(window.html2canvas):reject(new Error('No se pudo iniciar el exportador de imagen.'));
      script.onerror=()=>reject(new Error('No se pudo cargar el exportador de imagen. Revisa tu conexión e inténtalo de nuevo.'));
      document.head.append(script);
    });
    return rendererPromise;
  }

  function canvasToBlob(canvas){
    return new Promise((resolve,reject)=>{
      try{
        canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('El navegador no pudo crear el PNG.')),'image/png');
      }catch(error){
        if(error?.name==='SecurityError'){
          reject(new Error('La carta contiene un recurso externo que el navegador no permite exportar. Cambia esa imagen o fondo por uno con CORS habilitado.'));
        }else reject(error);
      }
    });
  }

  async function createPng(){
    if(!hasContent())throw new Error('Escribe unas palabras antes de descargar la carta.');

    const sourcePaper=$('#edit-paper');
    if(!sourcePaper)throw new Error('No se encontró la carta para exportar.');

    const renderer=await loadRenderer();
    const rootStyle=getComputedStyle(document.documentElement);
    const paperWidth=Math.max(320,parseFloat(rootStyle.getPropertyValue('--paper-width'))||sourcePaper.getBoundingClientRect().width);
    const pageSpace=Math.max(0,parseFloat(rootStyle.getPropertyValue('--page-space'))||0);
    const stage=document.createElement('div');
    stage.className='export-stage';
    stage.style.position='absolute';
    stage.style.left='0';
    stage.style.top='0';
    stage.style.width=`${Math.ceil(paperWidth+pageSpace*2)}px`;
    stage.style.padding=`${pageSpace}px`;
    stage.style.zIndex='-2147483647';
    stage.style.pointerEvents='none';

    const paper=sourcePaper.cloneNode(true);
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
      await embedImages(stage);
      await embedStyleUrls(stage);
      await waitForImages(stage);

      const width=Math.ceil(stage.getBoundingClientRect().width||parseFloat(stage.style.width));
      const height=Math.ceil(stage.scrollHeight);
      if(!width||!height)throw new Error('No se pudo calcular el tamaño de la carta.');

      const maxSide=15000;
      const pixelRatio=Math.min(3,maxSide/Math.max(width,height));
      if(pixelRatio<0.65)throw new Error('La carta es demasiado larga para exportarla como una sola imagen en este navegador.');

      const canvas=await renderer(stage,{
        backgroundColor:null,
        scale:pixelRatio,
        useCORS:true,
        allowTaint:false,
        foreignObjectRendering:false,
        logging:false,
        imageTimeout:15000,
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
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
  }

  button.addEventListener('click',async()=>{
    if(button.disabled)return;
    const original=button.innerHTML;
    button.disabled=true;
    button.textContent='Preparando imagen…';
    try{
      const blob=await createPng();
      downloadBlob(blob);
      notify('Carta descargada como PNG en alta calidad.');
    }catch(error){
      console.error('[EmLetter export]',error);
      notify(error?.message||'No se pudo descargar la carta como imagen.');
    }finally{
      button.disabled=false;
      button.innerHTML=original;
    }
  });
})();
