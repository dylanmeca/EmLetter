/* EmLetter · editor de imagen local (sin API ni subir imágenes a servidores). */
(()=>{
  'use strict';
  const dialog=document.getElementById('image-dialog');
  const form=document.getElementById('image-form');
  if(!dialog||!form)return;
  const $=id=>document.getElementById(id);

  // Respaldo para instalaciones que todavía tengan el HTML anterior en caché.
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

  const canvas=$('image-studio-canvas');
  const empty=$('image-studio-empty');
  const fallback=$('image-studio-fallback');
  const note=$('image-studio-note');
  const preview=canvas?.closest('.image-studio-preview');
  const fileInput=$('image-studio-file');
  const urlInput=$('image-url');
  const error=$('image-error');
  const crop=$('image-studio-crop');
  const shape=$('image-studio-shape');
  const filterPreset=$('image-studio-filter');
  const tintColor=$('image-studio-tint-color');
  const glowColor=$('image-studio-glow-color');
  const MAX_DATA_URL=148000;

  const sliderConfig={
    brightness:{value:100,suffix:'%'},
    contrast:{value:100,suffix:'%'},
    saturation:{value:100,suffix:'%'},
    warmth:{value:0,suffix:''},
    tint:{value:0,suffix:'%'},
    glow:{value:0,suffix:' px'},
    sparkles:{value:0,suffix:''},
    vignette:{value:0,suffix:'%'},
    tolerance:{value:28,suffix:''},
    brush:{value:24,suffix:''}
  };
  const basicSliders=['brightness','contrast','saturation'];
  const effectSliders=['warmth','tint','glow','sparkles','vignette'];
  const allSliders=Object.keys(sliderConfig);
  const presets={
    none:{brightness:100,contrast:100,saturation:100,warmth:0,tint:0,tintColor:'#ff4f7b',glow:0,glowColor:'#ff5e95',sparkles:0,vignette:0},
    romance:{brightness:104,contrast:109,saturation:116,warmth:28,tint:34,tintColor:'#ff4b6e',glow:22,glowColor:'#ff477e',sparkles:8,vignette:18},
    neon:{brightness:102,contrast:118,saturation:128,warmth:18,tint:26,tintColor:'#ff39c6',glow:28,glowColor:'#ff59d7',sparkles:14,vignette:12},
    dream:{brightness:110,contrast:96,saturation:112,warmth:12,tint:20,tintColor:'#ffc1e3',glow:16,glowColor:'#ffd0ef',sparkles:10,vignette:8},
    dramatic:{brightness:92,contrast:128,saturation:104,warmth:8,tint:14,tintColor:'#a10f35',glow:12,glowColor:'#ff496c',sparkles:3,vignette:34}
  };

  let original=null,mask=null,maskContext=null,mode='',dirty=false;
  let pending=0,processing=false,sourceKind='',imagePosition=null,imageOriginalSrc=null;
  let undo=[],pointerId=null,lastPoint=null,rect={x:0,y:0,w:1,h:1};
  let imageSource='';
  let drawFrame=0;
  let applyingPreset=false;

  function setNote(text){if(note)note.textContent=text||''}
  function setError(text){if(error)error.textContent=text||''}
  function setOutput(id,value){const out=$(`image-studio-${id}-value`);if(out)out.textContent=`${value}${sliderConfig[id]?.suffix||''}`}
  function getSlider(id){return Number($(`image-studio-${id}`)?.value||sliderConfig[id]?.value||0)}
  function hexToRgb(hex){
    const clean=String(hex||'').trim().replace('#','');
    if(clean.length===3){const [r,g,b]=clean.split('');return {r:parseInt(r+r,16),g:parseInt(g+g,16),b:parseInt(b+b,16)}}
    if(clean.length!==6)return {r:255,g:94,b:149};
    return {r:parseInt(clean.slice(0,2),16),g:parseInt(clean.slice(2,4),16),b:parseInt(clean.slice(4,6),16)};
  }
  function clamp(value,min,max){return Math.min(max,Math.max(min,value))}

  function updatePreviewFrame(){
    if(!preview)return;
    const widthValue=clamp(Number($('image-width')?.value||100),10,100);
    const radiusValue=clamp(Number($('image-radius')?.value||0),0,60);
    const alignValue=$('image-align')?.value||'center';
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
    for(const id of allSliders){
      const input=$(`image-studio-${id}`);
      if(input)input.value=sliderConfig[id].value;
      setOutput(id,sliderConfig[id].value);
    }
    if(filterPreset)filterPreset.value='none';
    if(tintColor)tintColor.value='#ff4f7b';
    if(glowColor)glowColor.value='#ff5e95';
    crop.value='original';
    shape.value='rectangle';
    dirty=false;undo=[];pointerId=null;
    setMode('');
    updatePreviewFrame();
  }

  function hasVisualEffects(){
    return effectSliders.some(id=>getSlider(id)!==sliderConfig[id].value)
      || basicSliders.some(id=>getSlider(id)!==sliderConfig[id].value)
      || crop.value!=='original'
      || shape.value!=='rectangle';
  }

  function setMode(value){
    mode=mode===value?'':value;
    for(const kind of ['pick','erase']){
      const button=$(`image-studio-${kind}`);
      if(!button)continue;
      button.setAttribute('aria-pressed',String(mode===kind));
      button.classList.toggle('is-active',mode===kind);
    }
    canvas.classList.toggle('image-studio-working',Boolean(mode));
    setNote('');
  }

  function clearImage(){
    original=null;mask=null;maskContext=null;imageSource='';sourceKind='';
    canvas.width=1;canvas.height=1;canvas.hidden=true;empty.hidden=false;
    if(fallback){fallback.hidden=true;fallback.removeAttribute('src')}
    updatePreviewFrame();
  }

  function fit(w,h,limit=1100){const ratio=Math.min(1,limit/Math.max(w,h));return {w:Math.max(1,Math.round(w*ratio)),h:Math.max(1,Math.round(h*ratio))}}

  function upload(file){
    if(!file)return;
    if(!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>12*1024*1024){setError('Utiliza PNG, JPG o WebP de hasta 12 MB.');return}
    fileInput.value='';
    urlInput.value='';
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
      original=document.createElement('canvas');
      original.width=size.w;original.height=size.h;
      const ctx=original.getContext('2d',{willReadFrequently:true});
      ctx.drawImage(img,0,0,size.w,size.h);
      ctx.getImageData(0,0,1,1);
      mask=document.createElement('canvas');
      mask.width=size.w;mask.height=size.h;
      maskContext=mask.getContext('2d',{willReadFrequently:true});
      maskContext.fillStyle='#fff';
      maskContext.fillRect(0,0,size.w,size.h);
      sourceKind=kind;imageSource=src;canvas.hidden=false;empty.hidden=true;
      if(fallback){fallback.hidden=true;fallback.removeAttribute('src')}
      render();setMode('');setNote('');
    }catch(err){
      if(token!==pending)return;
      if(kind==='url'&&/^https?:\/\//i.test(src)){
        sourceKind='url';imageSource=src;canvas.hidden=true;empty.hidden=true;
        if(fallback){fallback.src=src;fallback.hidden=false}
        setError('Esta URL no permite editar píxeles desde el navegador. Aún puedes insertarla con los controles básicos, o subir el archivo para usar filtros, recorte y quitar fondo.');
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

  function applyWarmTint(ctx,w,h){
    const warmth=getSlider('warmth');
    const tint=getSlider('tint');
    const data=ctx.getImageData(0,0,w,h);
    const pixels=data.data;
    const warm=warmth/100;
    const tintStrength=tint/100;
    const tintRgb=hexToRgb(tintColor?.value||'#ff4f7b');
    for(let i=0;i<pixels.length;i+=4){
      const alpha=pixels[i+3]/255;
      if(alpha===0)continue;
      let r=pixels[i],g=pixels[i+1],b=pixels[i+2];
      if(warm!==0){
        r=clamp(r+warm*46,0,255);
        g=clamp(g+warm*10,0,255);
        b=clamp(b-warm*40,0,255);
      }
      if(tintStrength>0){
        const blend=tintStrength*.42*alpha;
        r=clamp(r*(1-blend)+tintRgb.r*blend,0,255);
        g=clamp(g*(1-blend)+tintRgb.g*blend,0,255);
        b=clamp(b*(1-blend)+tintRgb.b*blend,0,255);
      }
      pixels[i]=r;pixels[i+1]=g;pixels[i+2]=b;
    }
    ctx.putImageData(data,0,0);
  }

  function makeSubject(limit){
    const cut=cropped();
    const dim=fit(cut.w,cut.h,limit);
    const subject=document.createElement('canvas');
    subject.width=dim.w;subject.height=dim.h;
    const ctx=subject.getContext('2d',{willReadFrequently:true});
    ctx.clearRect(0,0,subject.width,subject.height);
    ctx.filter=`brightness(${getSlider('brightness')}%) contrast(${getSlider('contrast')}%) saturate(${getSlider('saturation')}%)`;
    ctx.drawImage(original,cut.x,cut.y,cut.w,cut.h,0,0,subject.width,subject.height);
    ctx.filter='none';
    applyWarmTint(ctx,subject.width,subject.height);
    ctx.globalCompositeOperation='destination-in';
    ctx.drawImage(mask,cut.x,cut.y,cut.w,cut.h,0,0,subject.width,subject.height);
    ctx.globalCompositeOperation='source-over';
    if(shape.value!=='rectangle'){
      const shapeMask=document.createElement('canvas');
      shapeMask.width=subject.width;shapeMask.height=subject.height;
      const maskCtx=shapeMask.getContext('2d');
      maskCtx.fillStyle='#fff';maskCtx.beginPath();
      const circle=shape.value==='circle';
      maskCtx.ellipse(subject.width/2,subject.height/2,circle?Math.min(subject.width,subject.height)/2:subject.width/2,circle?Math.min(subject.width,subject.height)/2:subject.height/2,0,0,Math.PI*2);
      maskCtx.fill();ctx.globalCompositeOperation='destination-in';ctx.drawImage(shapeMask,0,0);ctx.globalCompositeOperation='source-over';
    }
    return {subject,cut};
  }

  function drawSparkles(ctx,w,h,count,color){
    if(count<=0)return;
    ctx.save();
    const rgb=hexToRgb(color);
    for(let i=0;i<count;i++){
      const px=((i*73)%100)/100;
      const py=((i*41+17)%100)/100;
      const x=w*(0.14+0.72*px);
      const y=h*(0.12+0.76*py);
      const size=4+((i*29)%6)+count*.14;
      const alpha=.34+((i*11)%50)/100;
      ctx.strokeStyle=`rgba(${rgb.r},${rgb.g},${rgb.b},${Math.min(.92,alpha)})`;
      ctx.fillStyle=`rgba(255,255,255,${Math.min(.95,alpha+.15)})`;
      ctx.lineWidth=Math.max(1,size*.12);
      ctx.beginPath();
      ctx.moveTo(x,y-size);ctx.lineTo(x,y+size);
      ctx.moveTo(x-size,y);ctx.lineTo(x+size,y);
      if(i%2===0){ctx.moveTo(x-size*.62,y-size*.62);ctx.lineTo(x+size*.62,y+size*.62);ctx.moveTo(x+size*.62,y-size*.62);ctx.lineTo(x-size*.62,y+size*.62)}
      ctx.stroke();
      ctx.beginPath();ctx.arc(x,y,Math.max(1,size*.14),0,Math.PI*2);ctx.fill();
    }
    ctx.restore();
  }

  function drawVignette(ctx,w,h,amount){
    if(amount<=0)return;
    const strength=amount/100;
    const gradient=ctx.createRadialGradient(w/2,h/2,Math.min(w,h)*0.18,w/2,h/2,Math.max(w,h)*0.74);
    gradient.addColorStop(0,'rgba(0,0,0,0)');
    gradient.addColorStop(.7,`rgba(36,0,12,${strength*.22})`);
    gradient.addColorStop(1,`rgba(0,0,0,${strength*.62})`);
    ctx.save();ctx.fillStyle=gradient;ctx.fillRect(0,0,w,h);ctx.restore();
  }

  function paint(target,limit){
    const {subject,cut}=makeSubject(limit);
    target.width=subject.width;target.height=subject.height;
    const ctx=target.getContext('2d',{willReadFrequently:true});
    const w=target.width,h=target.height;
    ctx.clearRect(0,0,w,h);

    const glow=getSlider('glow');
    const sparkles=getSlider('sparkles');
    const vignette=getSlider('vignette');
    const glowHex=glowColor?.value||'#ff5e95';
    const tintHex=tintColor?.value||'#ff4f7b';
    const glowRgb=hexToRgb(glowHex);
    const tintRgb=hexToRgb(tintHex);

    if(glow>0){
      const radial=ctx.createRadialGradient(w/2,h/2,Math.min(w,h)*0.1,w/2,h/2,Math.max(w,h)*0.6);
      radial.addColorStop(0,`rgba(${tintRgb.r},${tintRgb.g},${tintRgb.b},${Math.min(.28,.08+glow/120)})`);
      radial.addColorStop(.45,`rgba(${glowRgb.r},${glowRgb.g},${glowRgb.b},${Math.min(.18,.04+glow/180)})`);
      radial.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=radial;ctx.fillRect(0,0,w,h);
      ctx.save();
      ctx.globalAlpha=.92;
      ctx.shadowColor=`rgba(${glowRgb.r},${glowRgb.g},${glowRgb.b},0.92)`;
      ctx.shadowBlur=glow*1.35;
      ctx.drawImage(subject,0,0);
      ctx.shadowBlur=glow*.62;
      ctx.drawImage(subject,0,0);
      ctx.restore();
    }

    ctx.drawImage(subject,0,0);
    drawSparkles(ctx,w,h,sparkles,glowHex);
    drawVignette(ctx,w,h,vignette);
    return cut;
  }

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

  function applyPreset(name){
    const preset=presets[name]||presets.none;
    applyingPreset=true;
    for(const [key,value] of Object.entries(preset)){
      if(key==='tintColor'&&tintColor)tintColor.value=value;
      else if(key==='glowColor'&&glowColor)glowColor.value=value;
      else if(key in sliderConfig){
        const input=$(`image-studio-${key}`);
        if(input){input.value=value;setOutput(key,value)}
      }
    }
    applyingPreset=false;
    scheduleRender();
  }

  function toSourcePoint(event){
    const b=canvas.getBoundingClientRect();
    const rx=(event.clientX-b.left)/b.width,ry=(event.clientY-b.top)/b.height;
    if(!Number.isFinite(rx)||!Number.isFinite(ry)||rx<0||ry<0||rx>1||ry>1)return null;
    return {x:Math.min(original.width-1,Math.max(0,Math.floor(rect.x+rect.w*rx))),y:Math.min(original.height-1,Math.max(0,Math.floor(rect.y+rect.h*ry)))};
  }
  function history(){if(!mask)return;undo.push(maskContext.getImageData(0,0,mask.width,mask.height));if(undo.length>8)undo.shift();dirty=true}
  function eraseBrush(point,previous){
    const radius=getSlider('brush')*Math.max(1,original.width/canvas.width)*.55;
    maskContext.save();maskContext.globalCompositeOperation='destination-out';
    maskContext.lineWidth=radius*2;maskContext.lineCap='round';
    maskContext.beginPath();maskContext.moveTo(previous?.x??point.x,previous?.y??point.y);
    maskContext.lineTo(point.x,point.y);maskContext.stroke();
    maskContext.beginPath();maskContext.arc(point.x,point.y,radius,0,Math.PI*2);maskContext.fill();
    maskContext.restore();scheduleRender();
  }
  function removeConnectedColor(start){
    const width=original.width,height=original.height;
    const src=original.getContext('2d',{willReadFrequently:true}).getImageData(0,0,width,height).data;
    const maskPixels=maskContext.getImageData(0,0,width,height);
    const out=maskPixels.data,visited=new Uint8Array(width*height);
    const queue=new Int32Array(width*height);
    const first=start.y*width+start.x,seed=first*4;
    const tolerance=getSlider('tolerance');
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

  function editableDataUrl(){
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

  for(const id of allSliders){
    const input=$(`image-studio-${id}`);
    input?.addEventListener('input',event=>{
      setOutput(id,event.target.value);
      if(filterPreset&&!applyingPreset&&effectSliders.includes(id))filterPreset.value='custom';
      if(filterPreset&&!applyingPreset&&basicSliders.includes(id))filterPreset.value='custom';
      if(basicSliders.includes(id)||effectSliders.includes(id))scheduleRender();
    });
  }
  tintColor?.addEventListener('input',()=>{if(filterPreset&&!applyingPreset)filterPreset.value='custom';scheduleRender()});
  glowColor?.addEventListener('input',()=>{if(filterPreset&&!applyingPreset)filterPreset.value='custom';scheduleRender()});
  filterPreset?.addEventListener('change',()=>applyPreset(filterPreset.value));

  $('image-width')?.addEventListener('input',event=>{const out=$('image-width-value');if(out)out.textContent=`${event.target.value}%`;updatePreviewFrame()});
  $('image-radius')?.addEventListener('input',event=>{const out=$('image-radius-value');if(out)out.textContent=`${event.target.value} px`;updatePreviewFrame()});
  $('image-align')?.addEventListener('change',updatePreviewFrame);
  crop.addEventListener('change',scheduleRender);
  shape.addEventListener('change',scheduleRender);
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
      try{canvas.setPointerCapture(event.pointerId)}catch{}
      eraseBrush(point,null);
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
    setTimeout(()=>{
      resetOptions();setError('');fileInput.value='';updatePreviewFrame();
      const url=urlInput.value.trim();
      if(/^data:image\//.test(url)){urlInput.value='';loadImage(url,'file')}
      else if(url)loadImage(url,'url');
      else clearImage();
    },0);
  },true);

  dialog.addEventListener('close',()=>{pending++;pointerId=null;processing=false;clearTimeout(urlTimer)});
  form.addEventListener('submit',async event=>{
    event.preventDefault();event.stopImmediatePropagation();
    if(processing||(!original&&!(sourceKind==='url'&&!hasVisualEffects()))){
      setError('Primero carga una imagen válida. Si su servidor impide la edición, súbela desde tu dispositivo.');
      return;
    }
    const editor=document.querySelector('#editor .tiptap')?.editor;
    if(!editor){setError('El editor todavía no está disponible.');return}
    const submit=form.querySelector('button[type="submit"],.dialog-buttons button.primary');
    const prev=submit.textContent;submit.disabled=true;submit.textContent='Aplicando imagen…';
    try{
      let src;
      if(sourceKind==='url'&&!hasVisualEffects()){
        const url=new URL(imageSource,document.baseURI);
        if(!/^https?:$/.test(url.protocol))throw new Error('Utiliza una URL http o https válida.');
        src=url.origin===location.origin?url.href:`https://wsrv.nl/?url=${encodeURIComponent(url.href)}&output=png`;
      }else src=editableDataUrl();
      const attrs={src,alt:$('image-alt').value.slice(0,300),imageWidth:Number($('image-width').value),imageRadius:Number($('image-radius').value),imageAlign:$('image-align').value};
      const current=imagePosition!==null&&imagePosition>=0&&imagePosition<editor.state.doc.content.size?editor.state.doc.nodeAt(imagePosition):null;
      if(current?.type?.name==='image'&&current.attrs.src===imageOriginalSrc){
        editor.chain().focus().setNodeSelection(imagePosition).updateAttributes('image',attrs).run();
      }else editor.chain().focus().setImage(attrs).run();
      dialog.close();
    }catch(err){
      setError(err?.message||'No se pudo aplicar la imagen.');
      console.warn('EmLetter imagen:',err);
    }finally{submit.disabled=false;submit.textContent=prev}
  },true);
})();
