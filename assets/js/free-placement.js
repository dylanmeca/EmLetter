/* EmLetter · colocación libre. Sin dependencias ni almacenamiento externo. */
(()=>{
  'use strict';
  const editingPaper=document.getElementById('edit-paper');
  const readingPaper=document.getElementById('read-paper');
  if(!editingPaper||!readingPaper)return;
  let root=null;
  const MAX=1600;
  const clamp=n=>Math.max(-MAX,Math.min(MAX,Math.round(n)));
  const zero=()=>({blocks:[],decor:{},stickers:[]});
  let layout=zero(),active=null,lastRight=null,observer=null,frame=0;
  let clipboardItem=null,menuTarget=null,menuPoint=null,contextTimer=null,emojiSelection=null;
  let selectedFree=null; // La barra utiliza el elemento libre seleccionado, no la selección anterior.
  const isFloating=b=>Boolean(b&&typeof b.s==='string'&&b.s.startsWith('!'));
  const rawSignature=b=>isFloating(b)?b.s.slice(1):b?.s;
  const nextSignature=(n,free)=> (free?'!':'')+signature(n);
  const findBlock=(n,used=new Set(),paper=editingPaper)=>{
    const i=children(paper).indexOf(n),sig=signature(n);
    let j=layout.blocks.findIndex((b,k)=>!used.has(k)&&b.i===i&&rawSignature(b)===sig);
    if(j<0)j=layout.blocks.findIndex((b,k)=>!used.has(k)&&b.i===i);
    if(j<0)j=layout.blocks.findIndex((b,k)=>!used.has(k)&&rawSignature(b)===sig);
    if(j>=0)used.add(j);
    return layout.blocks[j]||null;
  };
  const decorations={
    ornament:' .ornament-top',
    central:'.ornament-symbol',
    lineLeft:'.ornament-top .ornament-line:first-child',
    lineRight:'.ornament-top .ornament-line:last-child',
    final:'.end-ornament',
    signature:'.letter-signature',
    frameTop:'.frame-top',frameRight:'.frame-right',
    frameBottom:'.frame-bottom',frameLeft:'.frame-left'
  };
  const dKeys=Object.keys(decorations);
  const emptyBlock=n=>['H1','H2','H3','P'].includes(n.tagName)&&!n.textContent.trim()&&!n.querySelector('img,table,hr');
  const eligible=n=>['P','H1','H2','H3','IMG','BLOCKQUOTE','UL','OL','PRE','TABLE','HR'].includes(n.tagName);
  const children=(paper)=>{
    const content=paper.id==='edit-paper'?paper.querySelector('#editor .tiptap'):paper.querySelector('#read-content');
    if(!content)return [];
    const nodes=[...content.children].filter(eligible);
    // El serializador original quita los bloques vacíos en los extremos.
    while(nodes.length&&emptyBlock(nodes[0]))nodes.shift();
    while(nodes.length&&emptyBlock(nodes.at(-1)))nodes.pop();
    return nodes;
  };
  const signature=n=>n.tagName+'|'+(n.tagName==='IMG'?n.getAttribute('src')||'':n.textContent||'').trim().slice(0,120);
  const cleanTextStyle=value=>{
    if(!value||typeof value!=='object')return {};
    const style={};
    if(typeof value.fontFamily==='string'&&/^[\w\s,'"-]{1,140}$/.test(value.fontFamily))style.fontFamily=value.fontFamily;
    if(Number.isFinite(Number(value.fontSize))&&Number(value.fontSize)>=8&&Number(value.fontSize)<=120)style.fontSize=Math.round(Number(value.fontSize));
    if(/^(normal|bold|[1-9]00)$/.test(String(value.fontWeight)))style.fontWeight=String(value.fontWeight);
    if(/^(normal|italic|oblique)$/.test(String(value.fontStyle)))style.fontStyle=value.fontStyle;
    if(/^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(String(value.color)))style.color=value.color;
    if(/^(left|center|right|justify)$/.test(String(value.textAlign)))style.textAlign=value.textAlign;
    if(/^#[0-9a-f]{6}$/i.test(String(value.backgroundColor)))style.backgroundColor=value.backgroundColor;
    if(/^(underline|line-through|none)$/.test(String(value.textDecoration)))style.textDecoration=value.textDecoration;
    return style;
  };
  function computedTextStyle(el){
    const s=getComputedStyle(el);
    return cleanTextStyle({fontFamily:s.fontFamily,fontSize:parseFloat(s.fontSize),fontWeight:s.fontWeight,fontStyle:s.fontStyle,color:s.color,textAlign:s.textAlign});
  }
  function applyTextStyle(el,style){
    el.style.fontFamily=style?.fontFamily||'';
    el.style.fontSize=style?.fontSize?style.fontSize+'px':'';
    el.style.fontWeight=style?.fontWeight||'';
    el.style.fontStyle=style?.fontStyle||'';
    el.style.color=style?.color||'';
    el.style.textAlign=style?.textAlign||'';
    el.style.backgroundColor=style?.backgroundColor||'';
    el.style.textDecoration=style?.textDecoration||'';
    const visual=el.querySelector('.emletter-visual-copy');
    if(visual){for(const prop of ['fontFamily','fontSize','fontWeight','fontStyle','color','textAlign','backgroundColor','textDecoration']){
      const val=style?.[prop];
      if(val)visual.style.setProperty(prop.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),prop==='fontSize'?val+'px':val,'important');
    }}
  }
  function normalize(value){
    const clean=zero();
    if(!value||typeof value!=='object')return clean;
    if(Array.isArray(value.blocks)){
      for(const b of value.blocks.slice(0,240)){
        if(!b||!Number.isInteger(b.i)||b.i<0||b.i>1000||!Number.isFinite(b.x)||!Number.isFinite(b.y))continue;
        clean.blocks.push({i:b.i,s:typeof b.s==='string'?b.s.slice(0,124):'',x:clamp(b.x),y:clamp(b.y)});
      }
    }
    if(value.decor&&typeof value.decor==='object'){
      for(const key of dKeys){
        const point=Object.hasOwn(value.decor,key)?value.decor[key]:null;
        if(point&&Number.isFinite(point.x)&&Number.isFinite(point.y))clean.decor[key]={x:clamp(point.x),y:clamp(point.y)};
      }
    }
    if(Array.isArray(value.stickers))for(const sticker of value.stickers.slice(0,80)){
      if(!sticker||typeof sticker.text!=='string'||!Number.isFinite(sticker.x)||!Number.isFinite(sticker.y))continue;
      clean.stickers.push({id:typeof sticker.id==='string'&&/^s[\da-z]{1,16}$/.test(sticker.id)?sticker.id:'s'+Math.random().toString(36).slice(2,9),text:sticker.text.slice(0,2000),x:clamp(sticker.x),y:clamp(sticker.y),style:cleanTextStyle(sticker.style)});
    }
    return clean;
  }
  // ProseMirror/Tiptap vuelve a dibujar nodos si se alteran sus atributos DOM.
  // La posición de los bloques del editor se pinta con reglas CSS, sin mutar sus nodos.
  const sheet=document.createElement('style');
  sheet.id='emletter-free-positions';
  document.head.append(sheet);
  const readerSheet=document.createElement('style');readerSheet.id='emletter-free-reader';document.head.append(readerSheet);
  function paintBlocks(){
    if(!root)return;
    const nodes=children(editingPaper),rules=[],used=new Set();
    let maxBottom=0;
    for(let i=0;i<nodes.length;i++){
      const n=nodes[i],b=findBlock(n,used),moving=active?.kind==='block'&&(active.element===n||active.index===i);
      const free=isFloating(b)||(moving&&active.free);
      const x=moving?active.x:(b?.x||0),y=moving?active.y:(b?.y||0);
      if(!free&&!moving&&!x&&!y)continue;
      if(free)maxBottom=Math.max(maxBottom,Math.max(0,y)+Math.max(45,n.getBoundingClientRect().height));
      const nth=[...root.children].indexOf(n)+1;
      if(nth<1)continue;
      const base=free?`position:absolute!important;left:${clamp(x)}px!important;top:${clamp(y)}px!important;transform:none!important;z-index:${moving?12:7};max-width:100%;width:max-content;min-width:min(35px,100%);box-sizing:border-box;margin:0!important;`:
        `position:relative;transform:translate(${clamp(x)}px,${clamp(y)}px)!important;`;
      rules.push(`#edit-paper #editor .tiptap > :nth-child(${nth}){${base}${moving?'outline:1px dashed #a6b6e9;outline-offset:5px;pointer-events:none;filter:drop-shadow(0 0 7px #8390bf66);':''}}`);
    }
    sheet.textContent=rules.join('\n');
    root.style.minHeight=maxBottom?Math.min(3000,Math.max(295,maxBottom+32))+'px':'';
  }
  function paintReader(){
    const parent=readingPaper.querySelector('#read-content');if(!parent)return;
    const nodes=children(readingPaper),used=new Set(),rules=[];
    let maxBottom=0;
    for(let i=0;i<nodes.length;i++){
      const n=nodes[i],b=findBlock(n,used,readingPaper);
      if(!isFloating(b))continue;
      const nth=[...parent.children].indexOf(n)+1;if(nth<1)continue;
      rules.push(`#read-paper #read-content > :nth-child(${nth}){position:absolute!important;left:${clamp(b.x)}px!important;top:${clamp(b.y)}px!important;transform:none!important;max-width:100%;width:max-content;min-width:35px;margin:0!important;}`);
      maxBottom=Math.max(maxBottom,Math.max(0,b.y)+Math.max(48,n.getBoundingClientRect().height));
    }
    readerSheet.textContent=rules.join('\n');
    parent.style.minHeight=maxBottom?Math.min(3200,maxBottom+22)+'px':'';
  }
  function transform(n,x,y){
    if(root?.contains(n)){paintBlocks();return}
    if(n.classList.contains('free-sticker')){n.style.left=clamp(x)+'px';n.style.top=clamp(y)+'px';return}
    n.style.transform=x||y?`translate(${clamp(x)}px, ${clamp(y)}px)`:'';
    n.classList.toggle('free-placed',Boolean(x||y));
  }
  function blockFor(n,used){
    return findBlock(n,used);
  }
  function apply(paper){
    if(!paper)return;
    const isEdit=paper.id==='edit-paper';
    const list=children(paper),used=new Set();
    for(let i=0;i<list.length;i++){
      const n=list[i],b=findBlock(n,used,paper);
      if(b){
        if(isEdit){b.i=i;b.s=nextSignature(n,isFloating(b));if(!isFloating(b))transform(n,b.x,b.y)}
        else if(!isFloating(b))transform(n,b.x,b.y);
        if(isFloating(b)&&!isEdit)n.style.transform='';
      }else if(!active||active.element!==n)transform(n,0,0);
    }
    renderStickers(paper);
    if(isEdit)paintBlocks();else paintReader();
    for(const key of dKeys){
      const el=paper.querySelector(decorations[key]);
      if(!el)continue;
      const point=layout.decor[key];
      if(!active||el!==active.element)transform(el,point?.x||0,point?.y||0);
    }
  }
  function changed(){
    const result=document.querySelector('#share-result');
    if(result)result.hidden=true;
    window.dispatchEvent(new CustomEvent('emletter:placement-change'));
  }
  // Los duplicados visuales viajan en el mismo campo de texto ya validado por
  // el codec antiguo; nunca se interpretan como HTML de terceros.
  const VISUAL_PREFIX='\uE000EMLETTER-VISUAL-1:';
  const visualKeys=new Set(dKeys);
  const visualCSS=['font-family','font-size','font-weight','font-style','color','text-align','text-shadow','letter-spacing','line-height','border-top-width','border-top-style','border-top-color','box-shadow','gap','width','height','justify-content','align-items','display','white-space','writing-mode','text-orientation'];
  function getVisual(text){
    if(typeof text!=='string'||!text.startsWith(VISUAL_PREFIX))return null;
    try{
      const visual=JSON.parse(text.slice(VISUAL_PREFIX.length));
      if(!visualKeys.has(visual.k)||!Array.isArray(visual.nodes)||visual.nodes.length>6)return null;
      if(visual.nodes.some(n=>!n||typeof n.t!=='string'||n.t.length>500||!Array.isArray(n.c)||n.c.length!==visualCSS.length))return null;
      return visual;
    }catch{return null}
  }
  function captureVisual(key){
    const original=editingPaper.querySelector(decorations[key]);
    if(!original)return null;
    const nodes=[original,...original.querySelectorAll('*')].slice(0,6);
    const visual={k:key,nodes:nodes.map(n=>{
      const computed=getComputedStyle(n);
      return {t:n.children.length?'':(n.textContent||'').slice(0,500),c:visualCSS.map(property=>computed.getPropertyValue(property).trim().slice(0,125))};
    })};
    const encoded=VISUAL_PREFIX+JSON.stringify(visual);
    return encoded.length<=2000?encoded:null;
  }
  function populateVisual(el,visual){
    const original=editingPaper.querySelector(decorations[visual.k]);
    if(!original)return;
    const copy=original.cloneNode(true);
    const originals=[copy,...copy.querySelectorAll('*')];
    originals.forEach((n,i)=>{
      n.removeAttribute('id');n.removeAttribute('data-ornament');n.removeAttribute('data-ornament-line');
      n.removeAttribute('data-end-ornament');n.removeAttribute('data-letter-signature');n.removeAttribute('data-frame-emoji');
      n.classList.remove('free-moving','free-placed');
      n.style.transform='';
      const snap=visual.nodes[i];if(!snap)return;
      if(!n.children.length)n.textContent=snap.t;
      visualCSS.forEach((property,j)=>{
        const v=snap.c[j];
        // CSS leido de propiedades computadas, nunca nombres de propiedades arbitrarios.
        if(v&&v.length<=125&&!/[;{}<>]/.test(v)&&!/(?:url\s*\(|expression\s*\(|@import|javascript:)/i.test(v))n.style.setProperty(property,v);
      });
    });
    copy.classList.add('emletter-visual-copy');
    el.replaceChildren(copy);
    el.classList.add('free-visual');
    el.contentEditable='false';
  }
  function renderStickers(paper){
    let layer=paper.querySelector(':scope > .free-sticker-layer');
    if(!layer){layer=document.createElement('div');layer.className='free-sticker-layer';paper.append(layer)}
    const edit=paper.id==='edit-paper';
    for(const el of [...layer.children])if(!layout.stickers.some(s=>s.id===el.dataset.stickerId))el.remove();
    for(const sticker of layout.stickers){
      let el=[...layer.children].find(n=>n.dataset.stickerId===sticker.id);
      if(!el){
        el=document.createElement('span');el.className='free-sticker';el.dataset.stickerId=sticker.id;
        el.setAttribute('aria-label','Texto o emoji libre');
        if(edit){
          el.contentEditable=getVisual(sticker.text)?'false':'true';el.setAttribute('spellcheck','true');
          el.addEventListener('input',()=>{sticker.text=el.textContent.slice(0,2000);changed()});
          el.addEventListener('keydown',ev=>{if(ev.key==='Enter'){ev.preventDefault();el.blur()}});
        }
        layer.append(el);
      }
      const visual=getVisual(sticker.text);
      if(visual){
        if(el.dataset.visualContent!==sticker.text){populateVisual(el,visual);el.dataset.visualContent=sticker.text}
      }else{
        el.classList.remove('free-visual');el.contentEditable=edit?'true':'false';
        delete el.dataset.visualContent;
        if(document.activeElement!==el)el.textContent=sticker.text;
      }
      applyTextStyle(el,sticker.style);
      if(!active||el!==active.element)transform(el,sticker.x,sticker.y);
    }
  }
  let serial=0;
  function addSticker(text,options={}){
    if(layout.stickers.length>=80){showHint('Has alcanzado el máximo de textos libres.');return null}
    if(!text||text.length>2000){showHint('El texto debe tener entre 1 y 2000 caracteres.');return null}
    const sticker={id:'s'+Date.now().toString(36)+(serial++).toString(36),text,x:clamp(options.x??Math.max(8,Math.round(editingPaper.clientWidth*.2))),y:clamp(options.y??Math.max(40,Math.round(editingPaper.scrollHeight*.4))),style:cleanTextStyle(options.style)};
    layout.stickers.push(sticker);renderStickers(editingPaper);changed();
    const el=editingPaper.querySelector(`[data-sticker-id="${sticker.id}"]`);
    if(options.focus!==false&&el){el.focus();const range=document.createRange();range.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(range)}
    return sticker;
  }
  function refreshActive(){
    if(!active||active.element.isConnected)return;
    if(active.kind!=='block')return;
    const list=children(editingPaper);
    const replacement=list.find(n=>signature(n)===active.sig)||list[active.index];
    if(!replacement)return;
    active.element=replacement;
    if(active.kind!=='block')replacement.classList.add('free-moving');
  }
  function persist(item,x,y){
    const a=clamp(x),b=clamp(y);
    if(item.kind==='sticker'){const sticker=layout.stickers.find(s=>s.id===item.key);if(sticker){sticker.x=a;sticker.y=b}}
    else if(item.kind==='decor'){
      if(!a&&!b)delete layout.decor[item.key];
      else layout.decor[item.key]={x:a,y:b};
    }else{
      const entries=children(editingPaper);let index=entries.indexOf(item.element);
      if(index<0)index=entries.findIndex(n=>signature(n)===item.sig);
      if(index<0)index=item.index;
      if(index<0||index>=entries.length)return;
      const prev=findBlock(entries[index]);
      const free=item.free||isFloating(prev);
      layout.blocks=layout.blocks.filter(entry=>entry.i!==index);
      if(a||b||free)layout.blocks.push({i:index,s:nextSignature(entries[index],free),x:a,y:b});
    }
    changed();
  }
  function getTarget(node){
    if(!(node instanceof Element)||!editingPaper.contains(node))return null;
    const sticker=node.closest('.free-sticker');
    if(sticker)return {kind:'sticker',key:sticker.dataset.stickerId,element:sticker};
    const decor=node.closest('.ornament-symbol,.ornament-line,.end-ornament,.letter-signature,.frame-side,.ornament-top');
    if(decor){
      for(const [key,selector]of Object.entries(decorations)){
        if(editingPaper.querySelector(selector)===decor)return {kind:'decor',key,element:decor};
      }
    }
    const parent=node.closest('#editor .tiptap > *');
    if(parent&&eligible(parent))return {kind:'block',element:parent};
    return null;
  }
  function positionFor(item){
    if(item.kind==='sticker')return layout.stickers.find(s=>s.id===item.key)||{x:0,y:0};
    if(item.kind==='decor')return layout.decor[item.key]||{x:0,y:0};
    const list=children(editingPaper),i=list.indexOf(item.element),s=signature(item.element);
    return findBlock(item.element)||{x:0,y:0};
  }
  // Los avisos de movimiento no se muestran en la interfaz.
  function showHint(){}
  function begin(item,ev){
    if(item.kind==='block'&&!root?.contains(item.element))return;
    let p=positionFor(item),free=item.kind==='block'&&(isFloating(p)||item.convert);
    // El primer doble clic izquierdo convierte el BLOQUE REAL en posición libre.
    // Conserva sus marcas de Tiptap y no crea una copia de texto plano.
    if(item.kind==='block'&&item.convert&&!isFloating(p)){
      const box=item.element.getBoundingClientRect(),base=root.getBoundingClientRect();
      // El rectángulo del contenido, no el ancho del párrafo: un título centrado
      // debe quedarse en el mismo lugar cuando pasa a posición libre.
      const range=document.createRange();range.selectNodeContents(item.element);
      const textRect=range.getBoundingClientRect();
      const rect=textRect.width>1&&textRect.height>1?textRect:box;
      const i=children(editingPaper).indexOf(item.element);
      const x=clamp(rect.left-base.left),y=clamp(rect.top-base.top);
      layout.blocks=layout.blocks.filter(b=>b.i!==i);
      p={i,s:nextSignature(item.element,true),x,y};layout.blocks.push(p);
      changed();
    }
    selectedFree=item.kind==='block'&&free?{kind:'block',element:item.element}:item.kind==='sticker'?{kind:'sticker',key:item.key}:null;
    active={...item,free,index:item.kind==='block'?children(editingPaper).indexOf(item.element):-1,sig:item.kind==='block'?signature(item.element):'',x:p.x,y:p.y,startX:ev.clientX,startY:ev.clientY,originX:p.x,originY:p.y};
    document.body.classList.add('placing-element');
    if(item.kind==='block')paintBlocks();else item.element.classList.add('free-moving');
  }
  function finish(commit=true){
    if(!active)return;
    refreshActive();
    const current=active;
    active=null;
    if(current.kind!=='block')current.element.classList.remove('free-moving');
    document.body.classList.remove('placing-element');
    if(commit)persist(current,current.x,current.y);
    else transform(current.element,current.originX,current.originY);
    apply(editingPaper);
  }
  const editor=()=>root?.editor;
  const contextMenu=document.createElement('div');
  contextMenu.className='emletter-context-menu';contextMenu.hidden=true;
  contextMenu.setAttribute('role','menu');contextMenu.setAttribute('aria-label','Acciones del elemento');
  contextMenu.innerHTML=`<div class="emletter-context-actions"><button type="button" data-action="duplicate" role="menuitem">Duplicar</button><button type="button" data-action="copy" role="menuitem">Copiar</button><button type="button" data-action="paste" role="menuitem">Pegar</button><button type="button" data-action="emojis" class="emletter-emoji-switch" role="menuitem" aria-expanded="false">☺ Emojis</button></div><section class="emletter-emoji-panel" hidden aria-label="Selector de emojis"><div class="emletter-emoji-head"><strong>Emojis</strong><button class="emletter-emoji-close" type="button" aria-label="Volver al menú">×</button></div><input class="emletter-emoji-search" type="search" placeholder="Buscar emoji…" aria-label="Buscar emoji"><div class="emletter-emoji-categories" role="group" aria-label="Categorías"></div><div class="emletter-emoji-grid" role="group" aria-label="Emojis disponibles"></div><div class="emletter-emoji-foot">Selecciona un emoji para insertarlo en tu texto.</div></section>`;
  document.body.append(contextMenu);
  function hideMenu(){clearTimeout(contextTimer);contextMenu.hidden=true;menuTarget=null;setEmojiPanel(false)}
  function menuAt(target,ev){
    const clientX=ev.clientX??ev.x??8,clientY=ev.clientY??ev.y??8;
    menuTarget=target;menuPoint={x:clientX,y:clientY};
    const ed=editor();
    if(ed){
      const selection=ed.state.selection;
      // El derecho no debe sustituir la posición del cursor con las coordenadas del menú.
      emojiSelection={from:selection.from,to:selection.to};
      const native=getSelection();
      if(native?.anchorNode&&root?.contains(native.anchorNode)){
        try{
          const pos=ed.view.posAtDOM(native.anchorNode,native.anchorOffset);
          if(Number.isInteger(pos))emojiSelection={from:pos,to:native.isCollapsed?pos:selection.to};
        }catch{}
      }
    }
    contextMenu.querySelector('[data-action="duplicate"]').disabled=!target;
    contextMenu.querySelector('[data-action="copy"]').disabled=!target;
    contextMenu.querySelector('[data-action="paste"]').disabled=!clipboardItem;
    setEmojiPanel(false);
    contextMenu.hidden=false;
    const w=contextMenu.offsetWidth,h=contextMenu.offsetHeight;
    contextMenu.style.left=Math.max(8,Math.min(innerWidth-w-8,clientX))+'px';
    contextMenu.style.top=Math.max(8,Math.min(innerHeight-h-8,clientY))+'px';
  }
  // Catálogo sin dependencias externas; se muestra por lotes para mantener la fluidez.
  const emojiPanel=contextMenu.querySelector('.emletter-emoji-panel');
  const emojiSearch=contextMenu.querySelector('.emletter-emoji-search');
  const emojiGrid=contextMenu.querySelector('.emletter-emoji-grid');
  const emojiCategories=contextMenu.querySelector('.emletter-emoji-categories');
  const emojiData=Array.isArray(window.EmLetterEmojis)?window.EmLetterEmojis:[];
  const emojiGroups=[['','🌐','Todos'],['8','✦','Favoritos'],['0','😊','Caras'],['1','🫶','Personas'],['2','🌹','Naturaleza'],['3','🍓','Comida'],['4','🌎','Viajes'],['5','🎨','Actividades'],['6','💟','Objetos y símbolos'],['7','🏳️','Banderas']];
  // Los nombres originales de Unicode están en inglés; admitimos también
  // búsquedas en español, con acentos, sin depender de servicios en línea.
  const esAlias={
    amor:['heart','love','kiss'],corazon:['heart'],corazones:['heart'],querer:['love','heart'],beso:['kiss'],besos:['kiss'],
    feliz:['smil','happy','joy','grin'],felicidad:['joy','happy'],alegria:['joy','smil'],risa:['laugh','joy','grin'],
    sonrisa:['smil','grin'],sonreir:['smil','grin'],cara:['face'],caras:['face'],carita:['face','smil'],
    triste:['sad','cry','frown'],tristeza:['sad','cry','frown'],llorar:['cry','sob'],llanto:['cry','sob'],
    asombro:['surpris','astonish'],enojado:['angry','rage'],miedo:['fear','scared'],
    persona:['person','man','woman'],personas:['person','people','man','woman'],hombre:['man'],mujer:['woman'],
    mano:['hand'],manos:['hand'],abrazo:['hug'],familia:['family'],piel:['skin'],
    gato:['cat'],perro:['dog'],animal:['animal','cat','dog','bird','bear','fish','horse','whale'],
    animales:['animal','cat','dog','bird','bear','fish','horse','whale'],
    pajaro:['bird'],perrito:['dog'],gatito:['cat'],flor:['flower','blossom','rose'],flores:['flower','blossom','rose'],
    rosa:['rose'],naturaleza:['flower','tree','animal','plant','leaf'],arbol:['tree'],
    luna:['moon'],sol:['sun'],estrella:['star'],murcielago:['bat'],fantasma:['ghost'],
    comida:['food','bread','pizza','rice','fruit','vegetable','meal'],fruta:['fruit','apple','pear','grape','banana'],
    pizza:['pizza'],pastel:['cake'],bebida:['drink','glass','cup','coffee','wine'],cafe:['coffee'],
    musica:['music','note','musical','instrument'],bailar:['dance','dancer'],baile:['dance','dancer'],
    fiesta:['party','celebrat','confetti'],deporte:['sport','ball','game'],juego:['game'],
    viajar:['travel','airplane','car','train'],viaje:['travel','airplane','car','train'],coche:['car','automobile'],
    avion:['airplane'],bandera:['flag'],banderas:['flag'],espana:['spain'],mexico:['mexico'],
    fuego:['fire'],agua:['water','drop','wave'],mar:['ocean','sea','wave'],
    libro:['book'],escribir:['writing','pencil','pen'],lapiz:['pencil'],telefono:['phone'],
    ojo:['eye'],ojos:['eye'],regalo:['gift'],dinero:['money','cash','coin'],
    negro:['black'],blanco:['white'],rojo:['red'],azul:['blue'],verde:['green'],morado:['purple'],
    oscuro:['dark'],claro:['light'],dedo:['finger'],dedos:['finger'],
    orca:['orca'],tesoro:['treasure'],trombon:['trombone']
  };
  const emojiNormalize=text=>String(text??'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
  const emojiSearchIndex=emojiData.map(([glyph,name,group])=>({
    glyph,name,group:String(group),normalized:emojiNormalize(name),
  }));
  const emojiGroupWords={'0':'cara face smile','1':'persona person hand skin people','2':'naturaleza nature animal plant flower',
    '3':'comida food drink','4':'viaje travel place','5':'deporte sport activity music','6':'simbolo symbol object','7':'bandera flag'};
  let emojiGroup='',emojiFilter=[],emojiCount=0;
  for(const [id,glyph,name] of emojiGroups){
    const btn=document.createElement('button');btn.type='button';btn.textContent=glyph;btn.title=name;btn.setAttribute('aria-label',name);btn.dataset.group=id;emojiCategories.append(btn);
  }
  function fitContextMenu(){
    const w=contextMenu.offsetWidth,h=contextMenu.offsetHeight;
    const x=menuPoint?.x??8,y=menuPoint?.y??8;
    contextMenu.style.left=Math.max(8,Math.min(innerWidth-w-8,x))+'px';
    contextMenu.style.top=Math.max(8,Math.min(innerHeight-h-8,y))+'px';
  }
  function appendEmojis(){
    if(emojiCount>=emojiFilter.length)return;
    const fragment=document.createDocumentFragment();
    for(const [glyph,name] of emojiFilter.slice(emojiCount,emojiCount+112)){
      const btn=document.createElement('button');btn.type='button';btn.textContent=glyph;btn.dataset.emoji=glyph;
      btn.title=name;btn.setAttribute('aria-label',name);fragment.append(btn);
    }
    emojiCount=Math.min(emojiCount+112,emojiFilter.length);
    emojiGrid.append(fragment);
  }
  function filterEmojis(){
    const query=emojiNormalize(emojiSearch.value).replace(/\s+/g,' ');
    const tokens=query.split(' ').filter(Boolean);
    emojiFilter=emojiSearchIndex.filter(entry=>{
      if(emojiGroup&&entry.group!==emojiGroup)return false;
      if(!tokens.length)return true;
      const searchText=entry.normalized+' '+(emojiGroupWords[entry.group]||'');
      return tokens.every(token=>{
        const options=esAlias[token]||[token];
        return entry.glyph.includes(token)||options.some(value=>searchText.includes(value));
      });
    }).map(({glyph,name})=>[glyph,name]);
    emojiCount=0;emojiGrid.replaceChildren();emojiGrid.scrollTop=0;
    if(!emojiFilter.length){
      const note=document.createElement('p');note.className='emletter-emoji-empty';
      note.textContent=emojiData.length?'No hay resultados para esa búsqueda. Prueba otra palabra o la categoría Todos.':'El catálogo de emojis no se pudo cargar. Actualiza la página.';
      emojiGrid.append(note);
    }else appendEmojis();
    emojiPanel.querySelector('.emletter-emoji-foot').textContent=emojiFilter.length.toLocaleString('es')+' emojis disponibles · Toca uno para insertarlo.';
    for(const b of emojiCategories.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.group===emojiGroup));
  }
  function setEmojiPanel(visible){
    emojiPanel.hidden=!visible;
    contextMenu.querySelector('.emletter-context-actions').hidden=visible;
    contextMenu.querySelector('[data-action="emojis"]').setAttribute('aria-expanded',String(visible));
    if(visible){emojiGroup='';emojiSearch.value='';filterEmojis();requestAnimationFrame(()=>{fitContextMenu();emojiSearch.focus()})}
  }
  emojiCategories.addEventListener('click',ev=>{
    const b=ev.target.closest('button[data-group]');if(!b)return;
    emojiGroup=b.dataset.group;emojiSearch.value='';filterEmojis();
  });
  emojiSearch.addEventListener('input',()=>{emojiGroup='';filterEmojis()});
  emojiGrid.addEventListener('scroll',()=>{if(emojiGrid.scrollTop+emojiGrid.clientHeight>=emojiGrid.scrollHeight-75)appendEmojis()},{passive:true});
  emojiPanel.querySelector('.emletter-emoji-close').addEventListener('click',()=>{setEmojiPanel(false);fitContextMenu()});
  emojiGrid.addEventListener('click',ev=>{
    const b=ev.target.closest('button[data-emoji]');if(!b)return;
    const glyph=b.dataset.emoji,target=menuTarget;
    if(target?.kind==='sticker'){
      const sticker=layout.stickers.find(s=>s.id===target.key);
      if(sticker){sticker.text=(sticker.text+glyph).slice(0,2000);renderStickers(editingPaper);changed()}
    }else{
      const ed=editor();if(ed){
        const max=ed.state.doc.content.size;
        let from=Math.max(0,Math.min(max,emojiSelection?.from??ed.state.selection.from));
        let to=Math.max(from,Math.min(max,emojiSelection?.to??from));
        // Inserta en el texto del cursor; no en el buscador ni en los botones del menú.
        if(!ed.state.doc.resolve(from).parent.inlineContent){
          const current=ed.state.selection.$from;
          from=current.parent.inlineContent?current.pos:Math.max(1,max-1);to=from;
        }
        ed.chain().focus().insertContentAt({from,to},glyph).run();
      }
    }
    hideMenu();
  });
  const pointOnPaper=point=>{
    const r=editingPaper.getBoundingClientRect();
    return {x:clamp(point.x-r.left),y:clamp(point.y-r.top)};
  };
  // Se utiliza la instancia pública que Tiptap adjunta a .tiptap.
  function nodeAtElement(element){
    const ed=editor();if(!ed||!element)return null;
    let result=null;
    ed.state.doc.descendants((node,pos)=>{
      if(ed.view.nodeDOM(pos)===element){result={node,pos};return false}
    });
    return result;
  }
  function clipFrom(item){
    if(!item)return null;
    if(item.kind==='sticker'){
      const st=layout.stickers.find(s=>s.id===item.key);
      return st?{type:'sticker',text:st.text,style:{...st.style},source:positionFor(item)}:null;
    }
    if(item.kind==='decor'){
      const text=captureVisual(item.key);
      return text?{type:'sticker',text,style:{},source:positionFor(item)}:null;
    }
    const details=nodeAtElement(item.element);
    if(!details)return null;
    return {type:'block',json:details.node.toJSON(),source:positionFor(item),index:children(editingPaper).indexOf(item.element)};
  }
  function selectionClip(item,selection){
    if(item?.kind!=='block'||!selection||selection.isCollapsed||!root?.contains(selection.anchorNode))return null;
    const ed=editor();if(!ed)return null;
    const {from,to}=ed.state.selection;
    if(from===to)return null;
    // Si la selección contiene el bloque completo, se copia como bloque y
    // conserva su título, alineación, atributos y todas las marcas.
    const nodeInfo=nodeAtElement(item.element);
    if(nodeInfo&&from<=nodeInfo.pos+1&&to>=nodeInfo.pos+1+nodeInfo.node.content.size)return null;
    const slice=ed.state.doc.slice(from,to);
    const content=slice.content.toJSON();
    if(!content?.length)return null;
    // Una selección en mitad del párrafo conserva sus marcas, colores y tipografías.
    const isInline=content.every(n=>['text','hardBreak'].includes(n.type));
    return {type:'block',json:isInline?{type:'paragraph',attrs:{...nodeAtElement(item.element)?.node.attrs},content}:content,source:positionFor(item),index:children(editingPaper).indexOf(item.element)};
  }
  function pasteClip(clip,pt){
    if(!clip)return false;
    if(clip.type==='block'){
      const ed=editor();if(!ed)return false;
      const doc=ed.state.doc;
      const json=structuredClone(clip.json);
      const count=Array.isArray(json)?json.length:1;
      const before=children(editingPaper);
      const srcIndex=Math.max(0,Math.min(before.length-1,clip.index??0));
      // Insertar detrás del original, respetando también el último bloque.
      const insertIndex=Math.min(srcIndex+1,before.length);
      let insertPos=0;
      for(let i=0;i<insertIndex;i++)insertPos+=doc.child(i).nodeSize;
      if(!ed.commands.insertContentAt(insertPos,json,{updateSelection:false}))return false;
      for(const block of layout.blocks)if(block.i>=insertIndex)block.i+=count;
      const nodes=children(editingPaper);
      const shift=clip.source||{x:0,y:0};
      for(let i=insertIndex;i<Math.min(nodes.length,insertIndex+count);i++){
        const n=nodes[i];if(!n||!eligible(n))continue;
        layout.blocks.push({i,s:nextSignature(n,isFloating(shift)),x:clamp(shift.x+24),y:clamp(shift.y+24)});
      }
      apply(editingPaper);changed();return true;
    }
    if(clip.type==='sticker'){
      const pos=pointOnPaper(pt);
      const original=clip.source||{x:0,y:0};
      return !!addSticker(clip.text,{x:pt?.usePosition?clamp(original.x+24):pos.x,y:pt?.usePosition?clamp(original.y+24):pos.y,style:clip.style,focus:false});
    }
    return false;
  }
  contextMenu.addEventListener('click',ev=>{
    const button=ev.target.closest('button[data-action]');if(!button||button.disabled)return;
    const action=button.dataset.action,target=menuTarget,point=menuPoint;
    if(action==='emojis'){setEmojiPanel(true);return}
    if(action==='copy'||action==='duplicate'){
      const selection=getSelection();
      clipboardItem=action==='duplicate'?clipFrom(target):(selectionClip(target,selection)||clipFrom(target));
      if(action==='copy'&&clipboardItem?.type==='sticker'&&!getVisual(clipboardItem.text))navigator.clipboard?.writeText(clipboardItem.text).catch(()=>{});
    }
    const clip=action==='paste'?clipboardItem:action==='duplicate'?clipboardItem:null;
    hideMenu();
    if(clip)pasteClip(clip,{x:point.x+24,y:point.y+24,usePosition:action==='duplicate'});
  });
  // Al dar formato a un bloque libre sin selección explícita, se aplica al
  // bloque entero y no al texto que estuviera seleccionado anteriormente.
  function selectFreeBlockRange(){
    if(selectedFree?.kind!=='block')return;
    const ed=editor(),n=selectedFree.element;if(!ed||!n?.isConnected)return;
    const info=nodeAtElement(n);if(!info||!info.node.isTextblock)return;
    const {from,to,empty}=ed.state.selection;
    const start=info.pos+1,end=start+info.node.content.size;
    if(from>=start&&to<=end&&!empty)return;
    ed.commands.setTextSelection({from:start,to:end});
  }
  document.querySelector('#composer .toolbar')?.addEventListener('pointerdown',event=>{
    const node=event.target.closest('select,button,input');
    if(!node||!selectedFree||selectedFree.kind!=='block')return;
    if(node.matches('[data-command],#selection-font,#selection-size,#text-color,#highlight-color,#text-align,#clear-format,#block'))selectFreeBlockRange();
  },true);
  // Las herramientas de formato se aplican al elemento libre seleccionado.
  // Para los bloques de Tiptap mantenemos la misma edición original y sus marcas.
  const toolbar=document.querySelector('#composer .toolbar');
  function selectedSticker(){
    if(selectedFree?.kind!=='sticker')return null;
    return layout.stickers.find(st=>st.id===selectedFree.key)||null;
  }
  function applyStickerFormat(target){
    const st=selectedSticker();if(!st||!target)return false;
    const id=target.id,cmd=target.dataset.command;
    if(id==='selection-font')st.style.fontFamily=target.value;
    else if(id==='selection-size')st.style.fontSize=Math.max(8,Math.min(120,Number(target.value)||18));
    else if(id==='text-color')st.style.color=target.value;
    else if(id==='text-align')st.style.textAlign=target.value;
    else if(id==='highlight-color')st.style.backgroundColor=target.value;
    else if(cmd==='bold')st.style.fontWeight=/^(bold|[6-9]00)$/.test(st.style.fontWeight)?'normal':'bold';
    else if(cmd==='italic')st.style.fontStyle=st.style.fontStyle==='italic'?'normal':'italic';
    else if(cmd==='underline')st.style.textDecoration=st.style.textDecoration==='underline'?'none':'underline';
    else if(cmd==='strike')st.style.textDecoration=st.style.textDecoration==='line-through'?'none':'line-through';
    else if(id==='clear-format')st.style={};
    else return false;
    renderStickers(editingPaper);changed();return true;
  }
  if(toolbar){
    toolbar.addEventListener('click',ev=>{
      const button=ev.target.closest('button');
      if(!button||!selectedSticker())return;
      if(applyStickerFormat(button)){ev.stopImmediatePropagation();ev.preventDefault()}
    },true);
    toolbar.addEventListener('change',ev=>{
      if(!selectedSticker())return;
      if(applyStickerFormat(ev.target)){ev.stopImmediatePropagation();ev.preventDefault()}
    },true);
  }
  // Cambiar entre un elemento libre y texto normal invalida el objetivo anterior.
  editingPaper.addEventListener('pointerdown',ev=>{
    const target=getTarget(ev.target);
    if(target?.kind==='sticker')selectedFree={kind:'sticker',key:target.key};
    else if(target?.kind==='block')selectedFree=isFloating(positionFor(target))?{kind:'block',element:target.element}:null;
    else if(!active)selectedFree=null;
  });
  if(toolbar){toolbar.addEventListener('pointerdown',()=>{if(active)finish(true)},true)}
  document.addEventListener('pointerdown',ev=>{if(!contextMenu.hidden&&!contextMenu.contains(ev.target))hideMenu()},true);
  document.addEventListener('scroll',()=>{if(!contextMenu.hidden)hideMenu()},true);
  // La selección nativa no siempre selecciona emoji (en especial ZWJ y modificadores).
  // Se identifica el grafema en la posición real del clic, no una palabra vecina.
  function emojiAtPoint(block,ed,x,y){
    const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT);
    const splitter=typeof Intl.Segmenter==='function'?new Intl.Segmenter('es',{granularity:'grapheme'}):null;
    let textNode;
    while((textNode=walker.nextNode())){
      const value=textNode.textContent||'';
      const segments=splitter?[...splitter.segment(value)]:Array.from(value).map((segment,index)=>({segment,index}));
      for(const part of segments){
        if(!/\p{Extended_Pictographic}/u.test(part.segment))continue;
        const range=document.createRange();
        range.setStart(textNode,part.index);range.setEnd(textNode,part.index+part.segment.length);
        for(const rect of range.getClientRects()){
          if(x<rect.left-3||x>rect.right+3||y<rect.top-3||y>rect.bottom+3)continue;
          const from=ed.view.posAtDOM(textNode,part.index),to=from+part.segment.length;
          if(ed.state.doc.textBetween(from,to,'','')===part.segment)return {text:part.segment,from,to};
        }
      }
    }
    return null;
  }
  // Doble clic izquierdo: mover el contenido REAL de Tiptap, conservando
  // marcas, tipografía, colores, enlaces y edición normal (no se duplica).
  // Un emoji dentro de un párrafo sí puede extraerse de manera independiente.
  editingPaper.addEventListener('dblclick',ev=>{
    if(ev.button!==0)return;
    if(active){ev.preventDefault();finish(true);return}
    const source=ev.target instanceof Element?ev.target:ev.target?.parentElement;
    if(!source)return;
    const item=getTarget(source);
    if(item?.kind==='sticker'||item?.kind==='decor'){ev.preventDefault();begin(item,ev);return}
    const block=source.closest('#editor .tiptap p,#editor .tiptap h1,#editor .tiptap h2,#editor .tiptap h3');
    if(!block||!root?.contains(block))return;
    const ed=editor(),info=nodeAtElement(block);
    if(!ed||!info||!['paragraph','heading'].includes(info.node.type.name))return;
    const emoji=emojiAtPoint(block,ed,ev.clientX,ev.clientY);
    if(emoji){
      if(layout.stickers.length>=80)return;
      const style=computedTextStyle(source);
      const point=pointOnPaper({x:ev.clientX,y:ev.clientY});
      ev.preventDefault();
      if(ed.commands.deleteRange({from:emoji.from,to:emoji.to})){
        const created=addSticker(emoji.text,{...point,style,focus:false});
        if(created){
          const element=editingPaper.querySelector(`[data-sticker-id="${created.id}"]`);
          if(element)begin({kind:'sticker',key:created.id,element},ev);
        }
      }
      return;
    }
    // El bloque sigue siendo editable con todos sus estilos y fuentes.
    if(item?.kind==='block'){ev.preventDefault();begin({...item,convert:true},ev)}
  });
  editingPaper.addEventListener('contextmenu',event=>{
    const item=getTarget(event.target);
    if(!item&&!active&&!clipboardItem)return;
    event.preventDefault();
    const now=performance.now();
    const dbl=lastRight&&now-lastRight.time<540&&Math.hypot(lastRight.x-event.clientX,lastRight.y-event.clientY)<28;
    lastRight={time:now,x:event.clientX,y:event.clientY};
    clearTimeout(contextTimer);
    if(dbl){
      lastRight=null;hideMenu();
      if(active){finish(true);return}
      if(item)begin(item,event);
      return;
    }
    if(active)return;
    const point={x:event.clientX,y:event.clientY};
    contextTimer=setTimeout(()=>menuAt(item,point),260);
  });
  document.addEventListener('pointermove',event=>{
    if(!active||event.pointerType==='touch')return;
    refreshActive();
    active.x=clamp(active.originX+event.clientX-active.startX);
    active.y=clamp(active.originY+event.clientY-active.startY);
    transform(active.element,active.x,active.y);
  },{passive:true});
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!contextMenu.hidden){hideMenu();event.preventDefault();return}
    if(!active)return;
    if(event.key==='Escape'){finish(false);event.preventDefault()}
    if(event.key==='Enter'){finish(true);event.preventDefault()}
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)){
      const step=event.shiftKey?10:1;
      if(event.key==='ArrowUp')active.y-=step;
      if(event.key==='ArrowDown')active.y+=step;
      if(event.key==='ArrowLeft')active.x-=step;
      if(event.key==='ArrowRight')active.x+=step;
      transform(active.element,active.x,active.y);event.preventDefault();
    }
  },true);
  // En móvil, donde no existe botón derecho, pulsación prolongada para seleccionar,
  // arrastre con el dedo y un toque largo para soltar.
  let longTimer=null,touchPoint=null;
  editingPaper.addEventListener('pointerdown',event=>{
    if(event.pointerType!=='touch')return;
    touchPoint={x:event.clientX,y:event.clientY,id:event.pointerId,item:getTarget(event.target)};
    clearTimeout(longTimer);
    longTimer=setTimeout(()=>{
      if(!touchPoint)return;
      if(active)finish(true);
      else if(touchPoint.item)begin(touchPoint.item,touchPoint);
      touchPoint=null;
    },650);
  });
  editingPaper.addEventListener('pointermove',event=>{
    if(event.pointerType!=='touch')return;
    if(touchPoint&&Math.hypot(event.clientX-touchPoint.x,event.clientY-touchPoint.y)>15){clearTimeout(longTimer);touchPoint=null}
    if(active){refreshActive();active.x=clamp(active.originX+event.clientX-active.startX);active.y=clamp(active.originY+event.clientY-active.startY);transform(active.element,active.x,active.y);event.preventDefault()}
  },{passive:false});
  ['pointerup','pointercancel'].forEach(name=>editingPaper.addEventListener(name,event=>{
    if(event.pointerType!=='touch')return;
    clearTimeout(longTimer);touchPoint=null;
  }));
  const api={
    sanitize:normalize,
    capture(){return normalize(layout)},
    showReader(value){if(active)finish(true);layout=normalize(value);apply(readingPaper)},
    restore(value){if(active)finish(false);layout=normalize(value);apply(editingPaper)},
    // Se aplica al volver del modo vista previa sin descartar los desplazamientos.
    resume(){apply(editingPaper)}
  };
  window.EmLetterPlacement=api;
  function init(){
    root=document.querySelector('#editor .tiptap');
    if(root){observer=new MutationObserver(()=>{
      if(frame)return;
      frame=requestAnimationFrame(()=>{frame=0;if(!active)apply(editingPaper)});
    });observer.observe(root,{childList:true,characterData:true,subtree:true})}
    if(!readingPaper.closest('[hidden]')?.hidden&&window.emletterCurrentLayout)api.showReader(window.emletterCurrentLayout);
    else apply(editingPaper);
    window.addEventListener('hashchange',()=>{setTimeout(()=>{
      if(!document.querySelector('#reader').hidden)api.showReader(window.emletterCurrentLayout);
      else api.resume();
    },0)});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
