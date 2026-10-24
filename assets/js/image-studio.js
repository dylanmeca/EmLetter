/* EmLetter · editor de imagen local (sin API ni subir imágenes a servidores). */
(()=>{
  'use strict';
  const dialog=document.getElementById('image-dialog');
  const form=document.getElementById('image-form');
  if(!dialog||!form)return;
  const $=id=>document.getElementById(id);
  // Respaldo para instalaciones que todavía tengan el HTML anterior en caché:
  // los cuatro controles se muestran siempre como SVG, sin fuentes externas.
  const iconSpec={
    pick:['Quitar fondo por color','<path d="M12 3v3m0 12v3M3 12h3m12 0h3"/><circle cx="12" cy="12" r="4"/><path d="m4 4 2 2m12 12 2 2m0-16-2 2M6 18l-2 2"/>'],
    erase:['Borrador manual','<path d="m20 20-8.5-8.5m-4.8 8.1-4.4-4.4a2.5 2.5 0 0 1 0-3.5l9.4-9.4a2.5 2.5 0 0 1 3.5 0l6.5 6.5a2.5 2.5 0 0 1 0 3.5l-7.3 7.3H6.7Z"/><path d="M21 20H7"/>'],
    undo:['Deshacer','<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15.5-6.2L3 13"/>'],
    reset:['Restablecer','<path d="M3 12a9 9 0 1 0 2.8-6.5L3 8"/><path d="M3 3v5h5"/>']
  };
  for(const [action,[label,paths]] of Object.entries(iconSpec)){
    const button=$(`image-studio-${action}`);
    if(!button)continue;
    button.classList.add('image-studio-icon-button');
    button.setAttribute('aria-label',label);
    button.title=label;
    if(!button.querySelector('svg'))button.innerHTML=`<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  }
  const canvas=$('image-studio-canvas'),empty=$('image-studio-empty'),fallback=$('image-studio-fallback'),note=$('image-studio-note');
  const preview=canvas?.closest('.image-studio-preview');
  const fileInput=$('image-studio-file'),urlInput=$('image-url'),error=$('image-error');
  const crop=$('image-studio-crop'),shape=$('image-studio-shape');
  const sliders=['brightness','contrast','saturation','tolerance','brush'];
  const MAX_DATA_URL=148000; // El enlace compartido también contiene esta imagen.
  let original=null,mask=null,maskContext=null,mode='',dirty=false;
  let pending=0,processing=false,sourceKind='',imagePosition=null,imageOriginalSrc=null;
  let undo=[],pointerId=null,lastPoint=null,rect={x:0,y:0,w:1,h:1};
  let imageSource='';
  function setNote(text){if(note)note.textContent=text||''}
  function setError(text){error.textContent=text||''}
  function updatePreviewFrame(){
    if(!preview)return;
    const widthControl=$('image-width');
    const radiusControl=$('image-radius');
    const alignControl=$('image-align');
    const widthValue=Math.max(10,Math.min(100,Number(widthControl?.value||100)));
    const radiusValue=Math.max(0,Math.min(60,Number(radiusControl?.value||0)));
    const alignValue=(alignControl?.value||'center');
    preview.dataset.align=alignValue;
    const widthCss=`${widthValue}%`;
    for(const target of [canvas,fallback]){
      if(!target)continue;
      target.style.width=widthCss;
      target.style.maxWidth=widthCss;
      target.style.borderRadius=`${radiusValue}px`;
    }
  }

  function resetOptions(){
    for(const id of sliders){
      const input=$(`image-studio-${id}`);
      input.value=({brightness:100,contrast:100,saturation:100,tolerance:28,brush:24})[id];
      $(`image-studio-${id}-value`).textContent=input.value+(['brightness','contrast','saturation'].includes(id)?'%':'');
    }
    crop.value='original';shape.value='rectangle';dirty=false;undo=[];pointerId=null;
    setMode('');
    updatePreviewFrame();
  }
  function setMode(value){
    mode=mode===value?'':value;
    for(const kind of ['pick','erase']){
      const button=$(`image-studio-${kind}`);
      button.setAttribute('aria-pressed',String(mode===kind));
      button.classList.toggle('is-active',mode===kind);
    }
    canvas.classList.toggle('image-studio-working',Boolean(mode));
    setNote('');
  }
  function clearImage(){original=null;mask=null;maskContext=null;imageSource='';sourceKind='';canvas.width=1;canvas.height=1;canvas.hidden=true;empty.hidden=false;if(fallback){fallback.hidden=true;fallback.removeAttribute('src')}updatePreviewFrame()}
  function fit(w,h,limit=1100){const ratio=Math.min(1,limit/Math.max(w,h));return {w:Math.max(1,Math.round(w*ratio)),h:Math.max(1,Math.round(h*ratio))}}
  function upload(file){
    if(!file)return;
    if(!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>12*1024*1024){setError('Utiliza PNG, JPG o WebP de hasta 12 MB.');return}
    fileInput.value=''; urlInput.value='';
    const reader=new FileReader();
    reader.onload=()=>loadImage(String(reader.result||''),'file');
    reader.onerror=()=>setError('No se pudo abrir la imagen del dispositivo.');
    reader.readAsDataURL(file);
  }
  async function loadImage(src,kind){
    const token=++pending;
    clearImage();resetOptions();setError('');
    if(!src)return;
    processing=true;setNote('Cargando imagen…');
    async function open(url){
      return new Promise((resolve,reject)=>{
        const img=new Image();
        if(/^https?:/i.test(url))img.crossOrigin='anonymous';
        img.onload=()=>resolve(img);
        img.onerror=()=>reject(new Error('No se pudo abrir la imagen.'));
        img.src=url;
      });
    }
    try{
      let img;
      try{img=await open(src)}catch(err){
        if(kind==='url'&&/^https?:/i.test(src)){
          const absolute=new URL(src,location.href);
          img=await open(`https://wsrv.nl/?url=${encodeURIComponent(absolute.href)}&output=png`);
        }else throw err;
      }
      if(token!==pending)return;
      const size=fit(img.naturalWidth,img.naturalHeight);
      original=document.createElement('canvas');original.width=size.w;original.height=size.h;
      const ctx=original.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,size.w,size.h);
      // Comprobar CORS antes de permitir modificar píxeles.
      ctx.getImageData(0,0,1,1);
      mask=document.createElement('canvas');mask.width=size.w;mask.height=size.h;
      maskContext=mask.getContext('2d',{willReadFrequently:true});maskContext.fillStyle='#fff';maskContext.fillRect(0,0,size.w,size.h);
      sourceKind=kind;imageSource=src;canvas.hidden=false;empty.hidden=true;if(fallback){fallback.hidden=true;fallback.removeAttribute('src')}
      render();setMode('');setNote('');
    }catch(err){
      if(token!==pending)return;
      if(kind==='url'&&/^https?:\/\//i.test(src)){
        // Conserva el comportamiento antiguo: las URLs bloqueadas por CORS
        // pueden insertarse, aunque no permitan borrar píxeles localmente.
        sourceKind='url';imageSource=src;canvas.hidden=true;empty.hidden=true;
        if(fallback){fallback.src=src;fallback.hidden=false}
        setError('Esta URL no permite editar píxeles desde el navegador. Aún puedes insertarla con los controles básicos, o subir el archivo para recortar y quitar fondo.');
      }else{
        setError('No se pudo procesar esta imagen.');
        clearImage();setNote('');
      }
    }finally{if(token===pending)processing=false}
  }
  function cropped(){
    const w=original.width,h=original.height,aspect=Number(crop.value);
    if(!aspect)return {x:0,y:0,w,h};
    let cw=w,ch=h;
    if(w/h>aspect)cw=h*aspect;else ch=w/aspect;
    return {x:(w-cw)/2,y:(h-ch)/2,w:cw,h:ch};
  }
  function paint(target,limit){
    const cut=cropped(),dim=fit(cut.w,cut.h,limit);
    const w=target.width=dim.w,h=target.height=dim.h;
    const ctx=target.getContext('2d',{willReadFrequently:true});
    ctx.clearRect(0,0,w,h);
    ctx.filter=`brightness(${$('image-studio-brightness').value}%) contrast(${$('image-studio-contrast').value}%) saturate(${$('image-studio-saturation').value}%)`;
    ctx.drawImage(original,cut.x,cut.y,cut.w,cut.h,0,0,w,h);
    ctx.filter='none';ctx.globalCompositeOperation='destination-in';
    ctx.drawImage(mask,cut.x,cut.y,cut.w,cut.h,0,0,w,h);
    ctx.globalCompositeOperation='source-over';
    if(shape.value!=='rectangle'){
      const shapeMask=document.createElement('canvas');shapeMask.width=w;shapeMask.height=h;
      const maskCtx=shapeMask.getContext('2d');maskCtx.fillStyle='#fff';maskCtx.beginPath();
      const circle=shape.value==='circle';
      maskCtx.ellipse(w/2,h/2,circle?Math.min(w,h)/2:w/2,circle?Math.min(w,h)/2:h/2,0,0,Math.PI*2);
      maskCtx.fill();ctx.globalCompositeOperation='destination-in';ctx.drawImage(shapeMask,0,0);ctx.globalCompositeOperation='source-over';
    }
    return cut;
  }
  let drawFrame=0;
  function render(){
    if(!original)return;
    const cut=paint(canvas,650);
    rect={...cut};
    updatePreviewFrame();
  }
  function scheduleRender(){
    if(drawFrame)return;
    drawFrame=requestAnimationFrame(()=>{drawFrame=0;render()});
  }
  function toSourcePoint(event){
    const b=canvas.getBoundingClientRect();
    const rx=(event.clientX-b.left)/b.width,ry=(event.clientY-b.top)/b.height;
    if(!Number.isFinite(rx)||!Number.isFinite(ry)||rx<0||ry<0||rx>1||ry>1)return null;
    return {x:Math.min(original.width-1,Math.max(0,Math.floor(rect.x+rect.w*rx))),y:Math.min(original.height-1,Math.max(0,Math.floor(rect.y+rect.h*ry)))};
  }
  function history(){if(!mask)return;undo.push(maskContext.getImageData(0,0,mask.width,mask.height));if(undo.length>8)undo.shift();dirty=true}
  function eraseBrush(point,previous){
    const radius=Number($('image-studio-brush').value)*Math.max(1,original.width/canvas.width)*.55;
    maskContext.save();maskContext.globalCompositeOperation='destination-out';
    maskContext.lineWidth=radius*2;maskContext.lineCap='round';
    maskContext.beginPath();maskContext.moveTo(previous?.x??point.x,previous?.y??point.y);
    maskContext.lineTo(point.x,point.y);maskContext.stroke();
    maskContext.beginPath();maskContext.arc(point.x,point.y,radius,0,Math.PI*2);maskContext.fill();
    maskContext.restore();scheduleRender();
  }
  // Inundación de la zona conectada: no borra todos los píxeles del documento
  // que casualmente tengan ese mismo color.
  function removeConnectedColor(start){
    const width=original.width,height=original.height;
    const src=original.getContext('2d',{willReadFrequently:true}).getImageData(0,0,width,height).data;
    const maskPixels=maskContext.getImageData(0,0,width,height);
    const out=maskPixels.data,visited=new Uint8Array(width*height);
    const queue=new Int32Array(width*height);
    const first=start.y*width+start.x,seed=first*4;
    const tolerance=Number($('image-studio-tolerance').value);
    let head=0,tail=0;queue[tail++]=first;visited[first]=1;
    const same=index=>{
      const k=index*4;
      return out[k+3]!==0&&Math.abs(src[k]-src[seed])<=tolerance&&Math.abs(src[k+1]-src[seed+1])<=tolerance&&Math.abs(src[k+2]-src[seed+2])<=tolerance;
    };
    if(!same(first))return;
    history();
    while(head<tail){
      const index=queue[head++];if(!same(index))continue;
      out[index*4+3]=0;
      const x=index%width,y=Math.floor(index/width);
      for(const next of [x>0?index-1:-1,x<width-1?index+1:-1,y>0?index-width:-1,y<height-1?index+width:-1]){
        if(next>=0&&!visited[next]){visited[next]=1;queue[tail++]=next}
      }
    }
    maskContext.putImageData(maskPixels,0,0);scheduleRender();
  }
  function hasPixelEdits(){
    return dirty||crop.value!=='original'||shape.value!=='rectangle'||sliders.slice(0,3).some(id=>Number($(`image-studio-${id}`).value)!==100);
  }
  function editableDataUrl(){
    // La imagen se incorpora en la carta. Reducir resolución antes que crear
    // enlaces demasiado largos que el codec de EmLetter no puede abrir.
    let max=950;
    for(let i=0;i<14;i++){
      const output=document.createElement('canvas');paint(output,max);
      for(const quality of [.9,.77,.64]){
        const data=output.toDataURL('image/webp',quality);
        if(data.startsWith('data:image/webp;')&&data.length<=MAX_DATA_URL)return data;
      }
      if(max<160)break;max=Math.max(150,Math.round(max*.8));
    }
    throw new Error('La imagen editada sigue siendo demasiado pesada para una carta compartible. Prueba una imagen más sencilla o pequeña.');
  }
  for(const id of sliders){
    $(`image-studio-${id}`).addEventListener('input',e=>{
      $(`image-studio-${id}-value`).textContent=e.target.value+(['brightness','contrast','saturation'].includes(id)?'%':'');
      if(['brightness','contrast','saturation'].includes(id))scheduleRender();
    });
  }
  $('image-width')?.addEventListener('input',e=>{const out=$('image-width-value');if(out)out.textContent=`${e.target.value}%`;updatePreviewFrame()});
  $('image-radius')?.addEventListener('input',e=>{const out=$('image-radius-value');if(out)out.textContent=`${e.target.value} px`;updatePreviewFrame()});
  $('image-align')?.addEventListener('change',updatePreviewFrame);
  crop.addEventListener('change',scheduleRender);shape.addEventListener('change',scheduleRender);
  $('image-studio-pick').onclick=()=>setMode('pick');
  $('image-studio-erase').onclick=()=>setMode('erase');
  $('image-studio-reset').onclick=()=>{if(imageSource)loadImage(imageSource,sourceKind)};
  $('image-studio-undo').onclick=()=>{
    if(!undo.length||!maskContext)return;
    maskContext.putImageData(undo.pop(),0,0);
    dirty=undo.length>0;scheduleRender();
  };
  canvas.addEventListener('pointerdown',event=>{
    if(!original||!mode||event.button>0)return;
    const point=toSourcePoint(event);if(!point)return;
    if(mode==='pick'){removeConnectedColor(point);return}
    if(mode==='erase'){
      event.preventDefault();history();pointerId=event.pointerId;lastPoint=point;
      try{canvas.setPointerCapture(event.pointerId)}catch{}eraseBrush(point,null);
    }
  });
  canvas.addEventListener('pointermove',event=>{
    if(pointerId!==event.pointerId||mode!=='erase'||!original)return;
    const point=toSourcePoint(event);
    if(point){eraseBrush(point,lastPoint);lastPoint=point}
  });
  for(const ev of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(ev,()=>{pointerId=null;lastPoint=null});
  fileInput.addEventListener('change',event=>upload(event.target.files?.[0]));
  urlInput.addEventListener('change',()=>{
    const url=urlInput.value.trim();
    if(url)loadImage(url,'url');else clearImage();
  });
  let urlTimer=null;
  urlInput.addEventListener('input',()=>{
    clearTimeout(urlTimer);
    const url=urlInput.value.trim();
    if(/^https?:\/\//i.test(url))urlTimer=setTimeout(()=>loadImage(url,'url'),650);
  });
  const add=document.getElementById('add-image');
  add?.addEventListener('click',()=>{
    const editor=document.querySelector('#editor .tiptap')?.editor;
    const position=editor?.state?.selection?.from;
    const selectedNode=Number.isInteger(position)?editor.state.doc.nodeAt(position):null;
    imagePosition=selectedNode?.type?.name==='image'?position:null;
    imageOriginalSrc=imagePosition!==null?selectedNode.attrs.src:null;
    // El manejador de la aplicación rellena primero el formulario y abre el diálogo.
    setTimeout(()=>{
      resetOptions();setError('');fileInput.value='';updatePreviewFrame();
      const url=urlInput.value.trim();if(/^data:image\//.test(url)){urlInput.value='';loadImage(url,'file')}else if(url)loadImage(url,'url');else clearImage();
    },0);
  },true);
  dialog.addEventListener('close',()=>{pending++;pointerId=null;processing=false;clearTimeout(urlTimer)});
  form.addEventListener('submit',async event=>{
    event.preventDefault();event.stopImmediatePropagation();
    if(processing||(!original&&!(sourceKind==='url'&&!hasPixelEdits()))){setError('Primero carga una imagen válida. Si su servidor impide la edición, súbela desde tu dispositivo.');return}
    const editor=document.querySelector('#editor .tiptap')?.editor;
    if(!editor){setError('El editor todavía no está disponible.');return}
    const submit=form.querySelector('button[type="submit"],.dialog-buttons button.primary');
    const prev=submit.textContent;submit.disabled=true;submit.textContent='Aplicando imagen…';
    try{
      let src;
      if(sourceKind==='url'&&!hasPixelEdits()){
        const url=new URL(imageSource,document.baseURI);
        if(!/^https?:$/.test(url.protocol))throw new Error('Utiliza una URL http o https válida.');
        src=url.origin===location.origin?url.href:`https://wsrv.nl/?url=${encodeURIComponent(url.href)}&output=png`;
      }else src=editableDataUrl();
      const attrs={src,alt:$('image-alt').value.slice(0,300),imageWidth:Number($('image-width').value),imageRadius:Number($('image-radius').value),imageAlign:$('image-align').value};
      // Una carta puede cambiar mientras se edita el archivo (vista previa,
      // arrastre o reescritura). No reusar nunca una posición antigua si el
      // nodo original ya no existe en el documento actual.
      const current=imagePosition!==null&&imagePosition>=0&&imagePosition<editor.state.doc.content.size
        ?editor.state.doc.nodeAt(imagePosition):null;
      if(current?.type?.name==='image'&&current.attrs.src===imageOriginalSrc){
        editor.chain().focus().setNodeSelection(imagePosition).updateAttributes('image',attrs).run();
      }else editor.chain().focus().setImage(attrs).run();
      dialog.close();
    }catch(err){setError(err?.message||'No se pudo aplicar la imagen.');console.warn('EmLetter imagen:',err)}
    finally{submit.disabled=false;submit.textContent=prev}
  },true);
})();
