/* EmLetter · editor de imagen local (sin API ni subir imágenes a servidores). */
(()=>{
  'use strict';
  const dialog=document.getElementById('image-dialog');
  const form=document.getElementById('image-form');
  if(!dialog||!form)return;
  const $=id=>document.getElementById(id);
  const canvas=$('image-studio-canvas'),empty=$('image-studio-empty'),fallback=$('image-studio-fallback'),note=$('image-studio-note');
  const fileInput=$('image-studio-file'),urlInput=$('image-url'),error=$('image-error');
  const crop=$('image-studio-crop'),shape=$('image-studio-shape');
  const adjustable=['brightness','contrast','saturation','tolerance','brush','zoom','panx','pany','outline','shadow','glow','background-strength'];
  const defaults={brightness:100,contrast:100,saturation:100,tolerance:28,brush:24,zoom:100,panx:0,pany:0,outline:0,shadow:0,glow:0,'background-strength':28};
  const MAX_DATA_URL=148000;
  let original=null,mask=null,maskContext=null,mode='',dirty=false;
  let pending=0,processing=false,sourceKind='',imagePosition=null,imageSource='';
  let undo=[],pointerId=null,lastPoint=null,urlTimer=null;
  let previewMap={scale:1,dx:0,dy:0,width:1,height:1};

  const control=id=>$(id.startsWith('image-studio-')?id:`image-studio-${id}`);
  function setNote(text){note.textContent=text}
  function setError(text){error.textContent=text||''}
  function fit(w,h,limit=1100){const ratio=Math.min(1,limit/Math.max(w,h));return {w:Math.max(1,Math.round(w*ratio)),h:Math.max(1,Math.round(h*ratio))}}
  function controlValue(name){return control(name).value}
  function setOutput(name){
    const out=control(`${name}-value`);if(!out)return;
    const value=control(name).value;
    const text={brightness:value+'%',contrast:value+'%',saturation:value+'%',zoom:value+'%',outline:value+' px',shadow:value+' px',glow:value+' px','background-strength':value+'%',tolerance:value,brush:value,panx:value,pany:value}[name] ?? value;
    out.textContent=text;
  }
  function updateAllOutputs(){for(const name of adjustable)setOutput(name)}
  function resetOptions(){
    for(const name of adjustable){const input=control(name);if(input)input.value=defaults[name]}
    crop.value='original';shape.value='rectangle';
    control('outline-color').value='#ffffff';
    control('glow-color').value='#ff4da0';
    control('background').value='transparent';
    control('background-color').value='#190012';
    updateAllOutputs();
    dirty=false;undo=[];pointerId=null;lastPoint=null;
    setMode('');
  }
  function setMode(value){
    mode=mode===value?'':value;
    for(const kind of ['pick','erase']){
      const button=control(kind);
      button.setAttribute('aria-pressed',String(mode===kind));
      button.classList.toggle('is-active',mode===kind);
    }
    canvas.classList.toggle('image-studio-working',Boolean(mode));
    if(mode==='pick')setNote('Toca o haz clic sobre un color del fondo para borrar esa zona conectada.');
    else if(mode==='erase')setNote('Arrastra el dedo o el ratón para borrar manualmente las zonas que no quieras.');
    else setNote('Recorta, quita fondo y añade presencia visual con borde, brillo, sombra y fondo auxiliar antes de aplicar.');
  }
  function clearImage(){
    original=null;mask=null;maskContext=null;imageSource='';sourceKind='';
    canvas.width=1;canvas.height=1;canvas.hidden=true;empty.hidden=false;
    if(fallback){fallback.hidden=true;fallback.removeAttribute('src')}
  }
  function upload(file){
    if(!file)return;
    if(!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>12*1024*1024){setError('Utiliza PNG, JPG o WebP de hasta 12 MB.');return}
    fileInput.value='';urlInput.value='';
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
      const size=fit(img.naturalWidth,img.naturalHeight,1400);
      original=document.createElement('canvas');original.width=size.w;original.height=size.h;
      const ctx=original.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,size.w,size.h);
      ctx.getImageData(0,0,1,1);
      mask=document.createElement('canvas');mask.width=size.w;mask.height=size.h;
      maskContext=mask.getContext('2d',{willReadFrequently:true});maskContext.fillStyle='#fff';maskContext.fillRect(0,0,size.w,size.h);
      sourceKind=kind;imageSource=src;canvas.hidden=false;empty.hidden=true;if(fallback){fallback.hidden=true;fallback.removeAttribute('src')}
      render();setMode('');setNote('Imagen lista. Ya puedes limpiarla, encuadrarla y darle un acabado más creativo.');
    }catch(err){
      if(token!==pending)return;
      if(kind==='url'&&/^https?:\/\//i.test(src)){
        sourceKind='url';imageSource=src;canvas.hidden=true;empty.hidden=true;
        if(fallback){fallback.src=src;fallback.hidden=false}
        setError('Esta URL no permite editar píxeles desde el navegador. Aún puedes insertarla con los ajustes básicos, o subir el archivo para quitar fondo y usar todas las herramientas.');
      }else{
        setError('No se pudo procesar esta imagen.');
        clearImage();setNote('Utiliza una imagen JPG, PNG o WebP válida.');
      }
    }finally{if(token===pending)processing=false}
  }
  function frameAspect(){const v=crop.value;return v==='original'?null:Number(v)}
  function outputSize(limit=650){
    if(!original)return {w:1,h:1};
    const aspect=frameAspect()||original.width/original.height;
    const baseW=original.width,baseH=Math.max(1,Math.round(baseW/aspect));
    return fit(baseW,baseH,limit);
  }
  function visualSettings(){
    return {
      zoom:Number(controlValue('zoom'))/100,
      panx:Number(controlValue('panx'))/100,
      pany:Number(controlValue('pany'))/100,
      brightness:Number(controlValue('brightness')),
      contrast:Number(controlValue('contrast')),
      saturation:Number(controlValue('saturation')),
      outline:Number(controlValue('outline')),
      outlineColor:controlValue('outline-color'),
      shadow:Number(controlValue('shadow')),
      glow:Number(controlValue('glow')),
      glowColor:controlValue('glow-color'),
      background:controlValue('background'),
      backgroundColor:controlValue('background-color'),
      backgroundStrength:Number(controlValue('background-strength'))/100,
      shape:shape.value
    };
  }
  function imagePlacement(outW,outH,settings){
    const baseScale=Math.max(outW/original.width,outH/original.height);
    const scale=baseScale*settings.zoom;
    const drawW=original.width*scale,drawH=original.height*scale;
    const maxX=Math.max(0,(drawW-outW)/2),maxY=Math.max(0,(drawH-outH)/2);
    const dx=(outW-drawW)/2 + settings.panx*maxX;
    const dy=(outH-drawH)/2 + settings.pany*maxY;
    return {scale,drawW,drawH,dx,dy};
  }
  function buildSubjectCanvas(outW,outH,settings){
    const subject=document.createElement('canvas');subject.width=outW;subject.height=outH;
    const ctx=subject.getContext('2d',{willReadFrequently:true});
    const place=imagePlacement(outW,outH,settings);
    ctx.clearRect(0,0,outW,outH);
    ctx.filter=`brightness(${settings.brightness}%) contrast(${settings.contrast}%) saturate(${settings.saturation}%)`;
    ctx.drawImage(original,place.dx,place.dy,place.drawW,place.drawH);
    ctx.filter='none';
    ctx.globalCompositeOperation='destination-in';
    ctx.drawImage(mask,place.dx,place.dy,place.drawW,place.drawH);
    ctx.globalCompositeOperation='destination-in';
    ctx.fillStyle='#fff';
    ctx.beginPath();
    if(settings.shape==='circle')ctx.ellipse(outW/2,outH/2,Math.min(outW,outH)/2,Math.min(outW,outH)/2,0,0,Math.PI*2);
    else if(settings.shape==='ellipse')ctx.ellipse(outW/2,outH/2,outW/2,outH/2,0,0,Math.PI*2);
    else ctx.rect(0,0,outW,outH);
    ctx.fill();
    ctx.globalCompositeOperation='source-over';
    previewMap={...place,width:outW,height:outH};
    return subject;
  }
  function tintCanvas(source,color){
    const out=document.createElement('canvas');out.width=source.width;out.height=source.height;
    const ctx=out.getContext('2d');ctx.drawImage(source,0,0);ctx.globalCompositeOperation='source-in';ctx.fillStyle=color;ctx.fillRect(0,0,out.width,out.height);ctx.globalCompositeOperation='source-over';
    return out;
  }
  function drawBackground(ctx,w,h,settings){
    if(settings.background==='transparent')return;
    const rgba=(hex,alpha)=>{
      const value=hex.replace('#','');
      const full=value.length===3?value.split('').map(x=>x+x).join(''):value;
      const n=parseInt(full,16);return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${Math.max(0,Math.min(1,alpha))})`;
    };
    if(settings.background==='solid'){
      ctx.fillStyle=rgba(settings.backgroundColor,settings.backgroundStrength);
      ctx.fillRect(0,0,w,h);return;
    }
    const grad=ctx.createRadialGradient(w/2,h/2,Math.min(w,h)*.08,w/2,h/2,Math.max(w,h)*.62);
    grad.addColorStop(0,rgba(settings.backgroundColor,Math.max(.1,settings.backgroundStrength)));
    grad.addColorStop(.55,rgba(settings.backgroundColor,settings.backgroundStrength*.48));
    grad.addColorStop(1,rgba(settings.backgroundColor,0));
    ctx.fillStyle=grad;ctx.fillRect(0,0,w,h);
  }
  function paint(target,limit){
    if(!original)return;
    const dim=outputSize(limit),w=target.width=dim.w,h=target.height=dim.h;
    const ctx=target.getContext('2d',{willReadFrequently:true});
    const settings=visualSettings();
    const subject=buildSubjectCanvas(w,h,settings);
    const outline=settings.outline>0?tintCanvas(subject,settings.outlineColor):null;
    ctx.clearRect(0,0,w,h);
    drawBackground(ctx,w,h,settings);
    if(settings.glow>0){
      ctx.save();ctx.shadowColor=settings.glowColor;ctx.shadowBlur=settings.glow;ctx.drawImage(subject,0,0);ctx.restore();
    }
    if(outline){
      const steps=Math.max(12,Math.round(settings.outline*2.8));
      for(let i=0;i<steps;i++){
        const angle=(Math.PI*2*i)/steps;
        ctx.drawImage(outline,Math.cos(angle)*settings.outline,Math.sin(angle)*settings.outline);
      }
    }
    if(settings.shadow>0){
      ctx.save();ctx.shadowColor='rgba(0,0,0,.45)';ctx.shadowBlur=settings.shadow;ctx.shadowOffsetY=Math.max(2,Math.round(settings.shadow*.2));ctx.drawImage(subject,0,0);ctx.restore();
    }
    ctx.drawImage(subject,0,0);
  }
  let drawFrame=0;
  function render(){if(!original)return;paint(canvas,700)}
  function scheduleRender(){if(drawFrame)return;drawFrame=requestAnimationFrame(()=>{drawFrame=0;render()})}
  function toSourcePoint(event){
    if(!original||!canvas.width||!canvas.height)return null;
    const b=canvas.getBoundingClientRect();
    const px=((event.clientX-b.left)/Math.max(1,b.width))*canvas.width;
    const py=((event.clientY-b.top)/Math.max(1,b.height))*canvas.height;
    if(!Number.isFinite(px)||!Number.isFinite(py))return null;
    const ox=(px-previewMap.dx)/previewMap.scale,oy=(py-previewMap.dy)/previewMap.scale;
    if(ox<0||oy<0||ox>original.width||oy>original.height)return null;
    return {x:Math.max(0,Math.min(original.width-1,Math.round(ox))),y:Math.max(0,Math.min(original.height-1,Math.round(oy)))};
  }
  function history(){if(!mask)return;undo.push(maskContext.getImageData(0,0,mask.width,mask.height));if(undo.length>8)undo.shift();dirty=true}
  function eraseBrush(point,previous){
    const radius=Number(controlValue('brush'))*Math.max(1,original.width/Math.max(1,canvas.width))*.55;
    maskContext.save();maskContext.globalCompositeOperation='destination-out';
    maskContext.lineWidth=radius*2;maskContext.lineCap='round';
    maskContext.beginPath();maskContext.moveTo(previous?.x??point.x,previous?.y??point.y);maskContext.lineTo(point.x,point.y);maskContext.stroke();
    maskContext.beginPath();maskContext.arc(point.x,point.y,radius,0,Math.PI*2);maskContext.fill();
    maskContext.restore();scheduleRender();
  }
  function removeConnectedColor(start){
    const width=original.width,height=original.height;
    const src=original.getContext('2d',{willReadFrequently:true}).getImageData(0,0,width,height).data;
    const maskPixels=maskContext.getImageData(0,0,width,height);
    const out=maskPixels.data,visited=new Uint8Array(width*height),queue=new Int32Array(width*height);
    const first=start.y*width+start.x,seed=first*4,tolerance=Number(controlValue('tolerance'));
    let head=0,tail=0;queue[tail++]=first;visited[first]=1;
    const same=index=>{const k=index*4;return out[k+3]!==0&&Math.abs(src[k]-src[seed])<=tolerance&&Math.abs(src[k+1]-src[seed+1])<=tolerance&&Math.abs(src[k+2]-src[seed+2])<=tolerance};
    if(!same(first))return;
    history();
    while(head<tail){
      const index=queue[head++];if(!same(index))continue;
      out[index*4+3]=0;
      const x=index%width,y=(index/width)|0;
      for(const next of [x>0?index-1:-1,x<width-1?index+1:-1,y>0?index-width:-1,y<height-1?index+width:-1])if(next>=0&&!visited[next]){visited[next]=1;queue[tail++]=next}
    }
    maskContext.putImageData(maskPixels,0,0);scheduleRender();
  }
  function hasPixelEdits(){
    if(dirty||crop.value!=='original'||shape.value!=='rectangle')return true;
    if(['brightness','contrast','saturation','zoom'].some(id=>Number(controlValue(id))!==defaults[id]))return true;
    if(['panx','pany','outline','shadow','glow','background-strength'].some(id=>Number(controlValue(id))!==defaults[id]))return true;
    if(controlValue('outline-color')!=='#ffffff'||controlValue('glow-color')!=='#ff4da0'||controlValue('background')!=='transparent'||controlValue('background-color')!=='#190012')return true;
    return false;
  }
  function editableDataUrl(){
    let max=980;
    for(let i=0;i<14;i++){
      const output=document.createElement('canvas');paint(output,max);
      for(const quality of [.92,.8,.68]){
        const data=output.toDataURL('image/webp',quality);
        if(data.startsWith('data:image/webp;')&&data.length<=MAX_DATA_URL)return data;
      }
      if(max<160)break;max=Math.max(150,Math.round(max*.8));
    }
    throw new Error('La imagen editada sigue siendo demasiado pesada para una carta compartible. Prueba una imagen más sencilla o pequeña.');
  }

  for(const name of adjustable){const el=control(name);if(el)el.addEventListener('input',()=>{setOutput(name);if(['tolerance','brush'].includes(name))return;scheduleRender()})}
  for(const name of ['outline-color','glow-color','background','background-color'])control(name).addEventListener(name==='background'?'change':'input',scheduleRender);
  crop.addEventListener('change',scheduleRender);shape.addEventListener('change',scheduleRender);
  control('pick').onclick=()=>setMode('pick');
  control('erase').onclick=()=>setMode('erase');
  control('reset').onclick=()=>{if(imageSource)loadImage(imageSource,sourceKind)};
  control('undo').onclick=()=>{if(!undo.length||!maskContext)return;maskContext.putImageData(undo.pop(),0,0);dirty=undo.length>0;scheduleRender()};
  canvas.addEventListener('pointerdown',event=>{
    if(!original||!mode||event.button>0)return;
    const point=toSourcePoint(event);if(!point)return;
    if(mode==='pick'){removeConnectedColor(point);return}
    if(mode==='erase'){
      event.preventDefault();history();pointerId=event.pointerId;lastPoint=point;
      try{canvas.setPointerCapture(event.pointerId)}catch{}
      eraseBrush(point,null);
    }
  });
  canvas.addEventListener('pointermove',event=>{if(pointerId!==event.pointerId||mode!=='erase'||!original)return;const point=toSourcePoint(event);if(point){eraseBrush(point,lastPoint);lastPoint=point}});
  for(const ev of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(ev,()=>{pointerId=null;lastPoint=null});
  fileInput.addEventListener('change',event=>upload(event.target.files?.[0]));
  urlInput.addEventListener('change',()=>{const url=urlInput.value.trim();if(url)loadImage(url,'url');else clearImage()});
  urlInput.addEventListener('input',()=>{clearTimeout(urlTimer);const url=urlInput.value.trim();if(/^https?:\/\//i.test(url))urlTimer=setTimeout(()=>loadImage(url,'url'),650)});
  const add=document.getElementById('add-image');
  add?.addEventListener('click',()=>{
    const editor=document.querySelector('#editor .tiptap')?.editor;
    const selected=editor?.isActive('image');
    imagePosition=selected?editor.state.selection.from:null;
    setTimeout(()=>{
      resetOptions();setError('');fileInput.value='';
      const url=urlInput.value.trim();
      if(/^data:image\//.test(url)){urlInput.value='';loadImage(url,'file')}
      else if(url)loadImage(url,'url');
      else clearImage();
    },0);
  },true);
  dialog.addEventListener('close',()=>{pending++;pointerId=null;processing=false;clearTimeout(urlTimer)});
  form.addEventListener('submit',async event=>{
    event.preventDefault();event.stopImmediatePropagation();
    if(processing||(!original&&!(sourceKind==='url'&&!hasPixelEdits()))){setError('Primero carga una imagen válida. Si su servidor impide la edición, súbela desde tu dispositivo para usar el estudio completo.');return}
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
      if(imagePosition!==null)editor.chain().focus().setNodeSelection(imagePosition).updateAttributes('image',attrs).run();
      else editor.chain().focus().setImage(attrs).run();
      dialog.close();
    }catch(err){setError(err?.message||'No se pudo aplicar la imagen.');console.warn('EmLetter imagen:',err)}
    finally{submit.disabled=false;submit.textContent=prev}
  },true);
})();
