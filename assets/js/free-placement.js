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
      clean.stickers.push({id:typeof sticker.id==='string'&&/^s[\da-z]{1,16}$/.test(sticker.id)?sticker.id:'s'+Math.random().toString(36).slice(2,9),text:sticker.text.slice(0,240),x:clamp(sticker.x),y:clamp(sticker.y)});
    }
    return clean;
  }
  // ProseMirror/Tiptap vuelve a dibujar nodos si se alteran sus atributos DOM.
  // La posición de los bloques del editor se pinta con reglas CSS, sin mutar sus nodos.
  const sheet=document.createElement('style');
  sheet.id='emletter-free-positions';
  document.head.append(sheet);
  function paintBlocks(){
    if(!root)return;
    const nodes=children(editingPaper);
    const rules=[];
    for(let i=0;i<nodes.length;i++){
      const n=nodes[i];
      const found=layout.blocks.find(b=>b.s===signature(n))||layout.blocks.find(b=>b.i===i);
      const isMoving=active?.kind==='block'&&(active.element===n||active.index===i);
      const x=isMoving?active.x:(found?.x||0),y=isMoving?active.y:(found?.y||0);
      if(!x&&!y&&!isMoving)continue;
      const nth=[...root.children].indexOf(n)+1;
      if(nth<1)continue;
      const pos=clamp(x)+'px, '+clamp(y)+'px';
      rules.push(`#edit-paper #editor .tiptap > :nth-child(${nth}){transform:translate(${pos})!important;position:relative;${isMoving?'z-index:9;outline:1px dashed #a6b6e9;outline-offset:6px;pointer-events:none;filter:drop-shadow(0 0 7px #8390bf66);':''}}`);
    }
    sheet.textContent=rules.join('\n');
  }
  function transform(n,x,y){
    if(root?.contains(n)){paintBlocks();return}
    if(n.classList.contains('free-sticker')){n.style.left=clamp(x)+'px';n.style.top=clamp(y)+'px';return}
    n.style.transform=x||y?`translate(${clamp(x)}px, ${clamp(y)}px)`:'';
    n.classList.toggle('free-placed',Boolean(x||y));
  }
  function blockFor(n,used){
    let b=layout.blocks.find((item,i)=>!used.has(i)&&item.s===signature(n));
    let id=b?layout.blocks.indexOf(b):-1;
    if(!b){const index=children(editingPaper).indexOf(n);id=layout.blocks.findIndex((item,i)=>!used.has(i)&&item.i===index);b=layout.blocks[id]}
    if(b)used.add(id);
    return b;
  }
  function apply(paper){
    if(!paper)return;
    const isEdit=paper.id==='edit-paper';
    const list=children(paper),used=new Set();
    for(let i=0;i<list.length;i++){
      const n=list[i];
      let matched=-1;
      // Por posición y contenido. Tolera la inserción de párrafos nuevos antes de uno movido.
      if(layout.blocks.some(b=>b.s===signature(n))){matched=layout.blocks.findIndex((b,j)=>!used.has(j)&&b.s===signature(n))}
      if(matched<0)matched=layout.blocks.findIndex((b,j)=>!used.has(j)&&b.i===i);
      if(matched>=0){used.add(matched);const b=layout.blocks[matched];transform(n,b.x,b.y);if(isEdit){b.i=i;b.s=signature(n)}}
      else if(!active||active.element!==n)transform(n,0,0);
    }
    renderStickers(paper);
    if(isEdit)paintBlocks();
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
          el.contentEditable='true';el.setAttribute('spellcheck','true');
          el.addEventListener('input',()=>{sticker.text=el.textContent.slice(0,240);changed()});
          el.addEventListener('keydown',ev=>{if(ev.key==='Enter'){ev.preventDefault();el.blur()}});
        }
        layer.append(el);
      }
      if(document.activeElement!==el)el.textContent=sticker.text;
      if(!active||el!==active.element)transform(el,sticker.x,sticker.y);
    }
  }
  let serial=0;
  function addSticker(text){
    if(layout.stickers.length>=80){showHint('Has alcanzado el máximo de textos libres.');return}
    const sticker={id:'s'+Date.now().toString(36)+(serial++).toString(36),text,x:Math.max(8,Math.round(editingPaper.clientWidth*.2)),y:Math.max(40,Math.round(editingPaper.scrollHeight*.4))};
    layout.stickers.push(sticker);renderStickers(editingPaper);changed();
    const el=editingPaper.querySelector(`[data-sticker-id="${sticker.id}"]`);
    el?.focus();if(el){const range=document.createRange();range.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(range)}
    showHint('Edita el texto libre; para colocarlo haz doble clic derecho y muévelo.');
  }
  document.querySelector('#add-floating-text')?.addEventListener('click',()=>addSticker('Escribe aquí'));
  document.querySelector('#add-floating-emoji')?.addEventListener('click',()=>addSticker('🖤'));
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
      layout.blocks=layout.blocks.filter(entry=>entry.i!==index);
      if(a||b)layout.blocks.push({i:index,s:signature(entries[index]),x:a,y:b});
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
    return layout.blocks.find(b=>b.s===s)||layout.blocks.find(b=>b.i===i)||{x:0,y:0};
  }
  function showHint(text){
    const el=document.querySelector('#placement-status');
    if(el){el.textContent=text;el.hidden=false}
  }
  function begin(item,ev){
    const p=positionFor(item);
    active={...item,index:item.kind==='block'?children(editingPaper).indexOf(item.element):-1,sig:item.kind==='block'?signature(item.element):'',x:p.x,y:p.y,startX:ev.clientX,startY:ev.clientY,originX:p.x,originY:p.y};
    document.body.classList.add('placing-element');
    if(item.kind==='block')paintBlocks();else item.element.classList.add('free-moving');
    showHint('Moviendo elemento · desplaza el cursor y haz doble clic derecho para fijarlo · Esc para cancelar');
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
    showHint('Posición fijada · doble clic derecho en otro elemento para moverlo');
    apply(editingPaper);
  }
  editingPaper.addEventListener('contextmenu',event=>{
    const item=getTarget(event.target);
    if(!item&&!active)return;
    event.preventDefault();
    const now=performance.now();
    // Se necesitan dos pulsaciones del botón derecho, sin dejarlo presionado.
    const dbl=lastRight&&now-lastRight.time<540&&Math.hypot(lastRight.x-event.clientX,lastRight.y-event.clientY)<28;
    lastRight={time:now,x:event.clientX,y:event.clientY};
    if(!dbl)return;
    lastRight=null;
    if(active){finish(true);return}
    if(item)begin(item,event);
  });
  document.addEventListener('pointermove',event=>{
    if(!active||event.pointerType==='touch')return;
    refreshActive();
    active.x=clamp(active.originX+event.clientX-active.startX);
    active.y=clamp(active.originY+event.clientY-active.startY);
    transform(active.element,active.x,active.y);
  },{passive:true});
  document.addEventListener('keydown',event=>{
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
  });
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
