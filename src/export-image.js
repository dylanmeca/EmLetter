(()=>{
  const button=document.querySelector('#download-image');
  if(!button)return;
  const $=selector=>document.querySelector(selector);
  let noticeTimer;

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
    if(!url||/^(data:|blob:)/i.test(url))return url;
    const response=await fetch(url,{mode:'cors',credentials:'omit'});
    if(!response.ok)throw new Error(`No se pudo cargar un recurso externo (${response.status}).`);
    return toDataUrl(await response.blob());
  }

  async function embedImages(root){
    const images=[...root.querySelectorAll('img')];
    for(const image of images){
      const source=image.currentSrc||image.src||image.getAttribute('src');
      if(!source)continue;
      try{
        image.src=await fetchAsDataUrl(source);
      }catch{
        throw new Error('Una imagen externa bloquea la exportación. Usa una URL de imagen que permita CORS o elimínala antes de descargar.');
      }
    }
  }

  async function embedBackgrounds(root){
    const elements=[root,...root.querySelectorAll('*')];
    const urlPattern=/url\((['"]?)(.*?)\1\)/g;
    for(const element of elements){
      const value=element.style.backgroundImage;
      if(!value||!value.includes('url('))continue;
      const matches=[...value.matchAll(urlPattern)];
      let next=value;
      for(const match of matches){
        const source=match[2];
        if(!source||/^(data:|blob:)/i.test(source))continue;
        try{
          const dataUrl=await fetchAsDataUrl(source);
          next=next.replace(match[0],`url("${dataUrl}")`);
        }catch{
          throw new Error('La imagen de fondo externa bloquea la exportación. Usa una URL que permita CORS o cambia el fondo antes de descargar.');
        }
      }
      element.style.backgroundImage=next;
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

  function canvasToBlob(canvas){
    return new Promise((resolve,reject)=>{
      try{
        canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('El navegador no pudo crear el PNG.')),'image/png');
      }catch(error){reject(error)}
    });
  }

  function svgToImage(svg){
    return new Promise((resolve,reject)=>{
      const blob=new Blob([svg],{type:'image/svg+xml;charset=utf-8'});
      const url=URL.createObjectURL(blob);
      const image=new Image();
      image.onload=()=>{URL.revokeObjectURL(url);resolve(image)};
      image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('El navegador no pudo representar la carta como imagen.'))};
      image.src=url;
    });
  }

  async function createPng(){
    if(!hasContent())throw new Error('Escribe unas palabras antes de descargar la carta.');

    const sourcePaper=$('#edit-paper');
    if(!sourcePaper)throw new Error('No se encontró la carta para exportar.');

    const rootStyle=getComputedStyle(document.documentElement);
    const paperWidth=Math.max(320,parseFloat(rootStyle.getPropertyValue('--paper-width'))||sourcePaper.getBoundingClientRect().width);
    const pageSpace=Math.max(0,parseFloat(rootStyle.getPropertyValue('--page-space'))||0);
    const stage=document.createElement('div');
    stage.className='export-stage';
    stage.style.position='fixed';
    stage.style.left='-100000px';
    stage.style.top='0';
    stage.style.width=`${Math.ceil(paperWidth+pageSpace*2)}px`;
    stage.style.padding=`${pageSpace}px`;
    stage.style.zIndex='-1';
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
      const originalImages=[...sourcePaper.querySelectorAll('img')];
      await Promise.all(originalImages.map(img=>img.decode?.().catch(()=>{})||Promise.resolve()));

      inlineComputedStyles(stage);
      await embedImages(stage);
      await embedBackgrounds(stage);

      const width=Math.ceil(parseFloat(stage.style.width)||stage.getBoundingClientRect().width);
      const height=Math.ceil(stage.scrollHeight);
      if(!width||!height)throw new Error('No se pudo calcular el tamaño de la carta.');

      const maxSide=15000;
      const pixelRatio=Math.min(3,maxSide/Math.max(width,height));
      if(pixelRatio<0.65)throw new Error('La carta es demasiado larga para exportarla como una sola imagen en este navegador.');

      const renderRoot=stage.cloneNode(true);
      renderRoot.style.position='static';
      renderRoot.style.left='auto';
      renderRoot.style.top='auto';
      renderRoot.style.zIndex='auto';
      renderRoot.style.pointerEvents='auto';
      renderRoot.style.transform='none';
      renderRoot.setAttribute('xmlns','http://www.w3.org/1999/xhtml');
      const serialized=new XMLSerializer().serializeToString(renderRoot);
      const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject x="0" y="0" width="100%" height="100%">${serialized}</foreignObject></svg>`;
      const image=await svgToImage(svg);
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(width*pixelRatio));
      canvas.height=Math.max(1,Math.round(height*pixelRatio));
      const context=canvas.getContext('2d');
      if(!context)throw new Error('El navegador no permite crear la imagen.');
      context.scale(pixelRatio,pixelRatio);
      context.drawImage(image,0,0,width,height);
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
      notify(error?.message||'No se pudo descargar la carta como imagen.');
    }finally{
      button.disabled=false;
      button.innerHTML=original;
    }
  });
})();
