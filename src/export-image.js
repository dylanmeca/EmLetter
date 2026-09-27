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
      if(image.complete)return Promise.resolve();
      if(image.decode)return image.decode().catch(()=>{});
      return new Promise(resolve=>{
        image.addEventListener('load',resolve,{once:true});
        image.addEventListener('error',resolve,{once:true});
      });
    }));
  }

  function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms))}

  async function waitForVideo(video){
    if(video.readyState>=2&&video.videoWidth&&video.videoHeight)return;
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('No se pudo iniciar la captura de la pestaña.')),6000);
      const ready=()=>{clearTimeout(timer);resolve()};
      video.addEventListener('loadeddata',ready,{once:true});
      video.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('No se pudo leer la captura de la pestaña.'))},{once:true});
    });
  }

  async function waitForFreshFrame(video){
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    if(typeof video.requestVideoFrameCallback==='function'){
      await Promise.race([
        new Promise(resolve=>video.requestVideoFrameCallback(()=>resolve())),
        delay(180)
      ]);
    }else{
      await delay(140);
    }
  }

  function makeCaptureStage(sourcePaper){
    const rootStyle=getComputedStyle(document.documentElement);
    const paperWidth=Math.max(320,parseFloat(rootStyle.getPropertyValue('--paper-width'))||sourcePaper.getBoundingClientRect().width);
    const pageSpace=Math.max(0,parseFloat(rootStyle.getPropertyValue('--page-space'))||0);

    const overlay=document.createElement('div');
    overlay.className='capture-overlay';
    overlay.setAttribute('aria-hidden','true');

    const stage=document.createElement('div');
    stage.className='export-stage capture-stage';
    stage.style.width=`${Math.ceil(paperWidth+pageSpace*2)}px`;
    stage.style.padding=`${pageSpace}px`;

    const paper=sourcePaper.cloneNode(true);
    cleanupClone(paper);
    paper.style.width='100%';
    paper.style.maxWidth=`${paperWidth}px`;
    paper.style.marginLeft='auto';
    paper.style.marginRight='auto';
    stage.append(paper);

    const marker=document.createElement('div');
    marker.className='capture-marker';
    overlay.append(stage,marker);
    document.body.append(overlay);
    document.documentElement.classList.add('emletter-capturing');
    return {overlay,stage,marker};
  }

  function sampleMatchesMarker(video,viewportWidth,viewportHeight){
    const canvas=document.createElement('canvas');
    canvas.width=video.videoWidth;
    canvas.height=video.videoHeight;
    const context=canvas.getContext('2d',{willReadFrequently:true});
    if(!context)return false;
    context.drawImage(video,0,0);
    const scaleX=video.videoWidth/viewportWidth;
    const scaleY=video.videoHeight/viewportHeight;
    const x=Math.max(0,Math.min(video.videoWidth-1,Math.round(14*scaleX)));
    const y=Math.max(0,Math.min(video.videoHeight-1,Math.round(14*scaleY)));
    const pixel=context.getImageData(x,y,1,1).data;
    return pixel[0]<45&&pixel[1]>205&&pixel[2]>90&&pixel[2]<180;
  }

  async function startTabCapture(){
    if(!navigator.mediaDevices?.getDisplayMedia){
      throw new Error('Tu navegador no permite capturar la vista previa de forma segura. Prueba con una versión reciente de Chrome o Edge.');
    }
    notify('En el selector del navegador, elige “Esta pestaña” para descargar exactamente la vista previa.');
    try{
      return await navigator.mediaDevices.getDisplayMedia({
        video:{
          displaySurface:'browser',
          width:{ideal:3840,max:7680},
          height:{ideal:2160,max:4320},
          frameRate:{ideal:10,max:15}
        },
        audio:false,
        preferCurrentTab:true,
        selfBrowserSurface:'include',
        surfaceSwitching:'exclude'
      });
    }catch(error){
      if(error?.name==='NotAllowedError'||error?.name==='AbortError')throw new Error('Captura cancelada. Para descargar, vuelve a intentarlo y selecciona “Esta pestaña”.');
      throw new Error('El navegador no pudo iniciar la captura de la vista previa.');
    }
  }

  function makeVideo(stream){
    const video=document.createElement('video');
    video.muted=true;
    video.playsInline=true;
    video.srcObject=stream;
    return video;
  }

  async function captureStageToCanvas(video,stage,marker){
    const viewportWidth=window.innerWidth;
    const viewportHeight=window.innerHeight;
    if(!viewportWidth||!viewportHeight)throw new Error('No se pudo calcular el área visible del navegador.');

    await waitForFreshFrame(video);
    if(!sampleMatchesMarker(video,viewportWidth,viewportHeight)){
      throw new Error('Para evitar problemas de CORS, selecciona “Esta pestaña” en el selector de captura, no otra pestaña, ventana o pantalla.');
    }

    marker.hidden=true;
    await waitForFreshFrame(video);

    const targetWidth=Math.ceil(stage.scrollWidth);
    const targetHeight=Math.ceil(stage.scrollHeight);
    if(!targetWidth||!targetHeight)throw new Error('No se pudo calcular el tamaño de la carta.');

    const sourceScaleX=video.videoWidth/viewportWidth;
    const sourceScaleY=video.videoHeight/viewportHeight;
    const nativeScale=Math.min(sourceScaleX,sourceScaleY,3);
    const maxSide=15000;
    const maxPixels=80000000;
    const safeScale=Math.min(
      nativeScale,
      maxSide/Math.max(targetWidth,targetHeight),
      Math.sqrt(maxPixels/(targetWidth*targetHeight))
    );
    if(!Number.isFinite(safeScale)||safeScale<0.35)throw new Error('La carta es demasiado grande para guardarla como una sola imagen en este navegador.');

    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.floor(targetWidth*safeScale));
    canvas.height=Math.max(1,Math.floor(targetHeight*safeScale));
    const context=canvas.getContext('2d');
    if(!context)throw new Error('El navegador no pudo preparar la imagen.');

    for(let y=0;y<targetHeight;y+=viewportHeight){
      for(let x=0;x<targetWidth;x+=viewportWidth){
        stage.style.transform=`translate(${-x}px,${-y}px)`;
        await waitForFreshFrame(video);

        const tileWidth=Math.min(viewportWidth,targetWidth-x);
        const tileHeight=Math.min(viewportHeight,targetHeight-y);
        const sourceWidth=Math.max(1,Math.floor(tileWidth*sourceScaleX));
        const sourceHeight=Math.max(1,Math.floor(tileHeight*sourceScaleY));
        const destX=Math.floor(x*safeScale);
        const destY=Math.floor(y*safeScale);
        const destWidth=Math.min(canvas.width-destX,Math.ceil(tileWidth*safeScale));
        const destHeight=Math.min(canvas.height-destY,Math.ceil(tileHeight*safeScale));

        context.drawImage(
          video,
          0,0,sourceWidth,sourceHeight,
          destX,destY,destWidth,destHeight
        );
      }
    }
    stage.style.transform='translate(0,0)';
    return canvas;
  }

  function canvasToBlob(canvas){
    return new Promise((resolve,reject)=>{
      try{
        canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('El navegador no pudo crear el PNG.')),'image/png');
      }catch(error){
        reject(error);
      }
    });
  }

  async function createPng(){
    if(!hasContent())throw new Error('Escribe unas palabras antes de descargar la carta.');
    const sourcePaper=$('#edit-paper');
    if(!sourcePaper)throw new Error('No se encontró la carta para exportar.');

    let stream;
    let capture;
    try{
      stream=await startTabCapture();
      const video=makeVideo(stream);
      await video.play();
      await waitForVideo(video);

      capture=makeCaptureStage(sourcePaper);
      if(document.fonts?.ready)await document.fonts.ready;
      await waitForImages(capture.stage);
      await waitForFreshFrame(video);

      const canvas=await captureStageToCanvas(video,capture.stage,capture.marker);
      return await canvasToBlob(canvas);
    }finally{
      capture?.overlay.remove();
      document.documentElement.classList.remove('emletter-capturing');
      stream?.getTracks().forEach(track=>track.stop());
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
    button.textContent='Capturando vista previa…';
    try{
      const blob=await createPng();
      downloadBlob(blob);
      notify('Carta descargada como PNG desde la vista previa, sin depender de CORS.');
    }catch(error){
      console.error('[EmLetter export]',error);
      notify(error?.message||'No se pudo descargar la carta como imagen.');
    }finally{
      button.disabled=false;
      button.innerHTML=original;
    }
  });
})();
