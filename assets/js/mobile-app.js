(()=>{
  const MOBILE_QUERY='(max-width: 760px)';
  const media=window.matchMedia(MOBILE_QUERY);
  const $=(selector,root=document)=>root.querySelector(selector);
  const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
  let ui=null;
  let currentPanel=null;
  let moved=[];
  let lastFocus=null;

  function vibrate(ms=8){
    try{navigator.vibrate?.(ms)}catch{}
  }

  function make(tag,className,text){
    const node=document.createElement(tag);
    if(className)node.className=className;
    if(text!==undefined)node.textContent=text;
    return node;
  }

  function moveNode(node,target,extraClass=''){
    if(!node||!target)return null;
    const marker=document.createComment('emletter-mobile-origin');
    node.parentNode?.insertBefore(marker,node);
    if(extraClass)node.classList.add(extraClass);
    target.append(node);
    moved.push({node,marker,extraClass});
    return node;
  }

  function restoreMoved(){
    for(const item of moved.reverse()){
      if(item.extraClass)item.node.classList.remove(item.extraClass);
      if(item.marker.parentNode){
        item.marker.parentNode.insertBefore(item.node,item.marker.nextSibling);
        item.marker.remove();
      }
      delete item.node.dataset.mobileCaption;
    }
    moved=[];
  }

  function createUI(){
    if(ui)return ui;
    const root=make('div','mobile-app-ui');
    root.setAttribute('aria-hidden','false');

    const appbar=make('header','mobile-app-bar');
    appbar.innerHTML=`
      <a class="mobile-brand" href="./" aria-label="EmLetter, inicio"><span class="mobile-brand-mark">☾</span><span>EmLetter</span><i>✦</i></a>
      <button type="button" class="mobile-preview-action" aria-label="Vista previa"><span>◉</span> Vista</button>`;

    const backdrop=make('button','mobile-sheet-backdrop');
    backdrop.type='button';
    backdrop.setAttribute('aria-label','Cerrar panel');
    backdrop.tabIndex=-1;

    const sheet=make('section','mobile-sheet');
    sheet.setAttribute('role','dialog');
    sheet.setAttribute('aria-modal','true');
    sheet.setAttribute('aria-hidden','true');
    sheet.innerHTML=`
      <div class="mobile-sheet-grab" aria-hidden="true"><span></span></div>
      <div class="mobile-sheet-header">
        <button type="button" class="mobile-sheet-back" aria-label="Volver" hidden>‹</button>
        <div><small>EMLETTER</small><h2 class="mobile-sheet-title">Herramientas</h2></div>
        <button type="button" class="mobile-sheet-close" aria-label="Cerrar">×</button>
      </div>
      <div class="mobile-sheet-body"></div>`;

    const nav=make('nav','mobile-bottom-nav');
    nav.setAttribute('aria-label','Herramientas de la carta');
    const items=[
      ['text','Aa','Texto'],
      ['design','◇','Diseño'],
      ['atmosphere','☾','Atmósfera'],
      ['insert','＋','Insertar'],
      ['share','↗','Compartir']
    ];
    for(const [panel,icon,label] of items){
      const button=make('button','mobile-nav-item');
      button.type='button';
      button.dataset.mobilePanel=panel;
      button.innerHTML=`<span class="mobile-nav-icon" aria-hidden="true">${icon}</span><span>${label}</span>`;
      nav.append(button);
    }

    root.append(appbar,backdrop,sheet,nav);
    document.body.append(root);
    ui={root,appbar,backdrop,sheet,nav,body:$('.mobile-sheet-body',sheet),title:$('.mobile-sheet-title',sheet),back:$('.mobile-sheet-back',sheet),close:$('.mobile-sheet-close',sheet),grab:$('.mobile-sheet-grab',sheet)};

    $('.mobile-preview-action',appbar).addEventListener('click',()=>{
      vibrate();
      closeSheet();
      $('#preview')?.click();
    });
    backdrop.addEventListener('click',closeSheet);
    ui.close.addEventListener('click',closeSheet);
    ui.back.addEventListener('click',()=>{
      vibrate();
      if(currentPanel==='design-detail')renderDesignHome();
      else closeSheet();
    });
    nav.addEventListener('click',event=>{
      const button=event.target.closest('[data-mobile-panel]');
      if(!button)return;
      vibrate();
      openPanel(button.dataset.mobilePanel);
    });
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.body.classList.contains('mobile-sheet-open'))closeSheet()});
    installSwipeToClose();
    return ui;
  }

  function installSwipeToClose(){
    let startY=0,dragging=false;
    const start=event=>{
      if(!document.body.classList.contains('mobile-sheet-open'))return;
      dragging=true;
      startY=event.clientY;
      ui.sheet.classList.add('is-dragging');
      ui.grab.setPointerCapture?.(event.pointerId);
    };
    const move=event=>{
      if(!dragging)return;
      const dy=Math.max(0,event.clientY-startY);
      ui.sheet.style.transform=`translateY(${dy}px)`;
      ui.backdrop.style.opacity=String(Math.max(0,1-dy/320));
    };
    const end=event=>{
      if(!dragging)return;
      dragging=false;
      const dy=Math.max(0,event.clientY-startY);
      ui.sheet.classList.remove('is-dragging');
      ui.sheet.style.transform='';
      ui.backdrop.style.opacity='';
      if(dy>85)closeSheet();
    };
    ui.grab.addEventListener('pointerdown',start);
    ui.grab.addEventListener('pointermove',move);
    ui.grab.addEventListener('pointerup',end);
    ui.grab.addEventListener('pointercancel',end);
  }

  function setActiveNav(panel){
    $$('[data-mobile-panel]',ui.nav).forEach(button=>button.classList.toggle('is-active',button.dataset.mobilePanel===panel));
  }

  function showSheet(title,{back=false,panel=null}={}){
    currentPanel=panel;
    ui.title.textContent=title;
    ui.back.hidden=!back;
    ui.sheet.setAttribute('aria-hidden','false');
    document.body.classList.add('mobile-sheet-open');
    requestAnimationFrame(()=>ui.sheet.classList.add('is-open'));
    setActiveNav(panel==='design-detail'?'design':panel);
    ui.body.scrollTop=0;
  }

  function closeSheet(){
    if(!ui||!document.body.classList.contains('mobile-sheet-open'))return;
    ui.sheet.classList.remove('is-open');
    ui.sheet.setAttribute('aria-hidden','true');
    document.body.classList.remove('mobile-sheet-open');
    setActiveNav(null);
    currentPanel=null;
    window.setTimeout(()=>{
      if(!document.body.classList.contains('mobile-sheet-open')){
        restoreMoved();
        ui.body.replaceChildren();
      }
    },230);
    try{lastFocus?.focus?.({preventScroll:true})}catch{}
  }

  function section(title,subtitle=''){
    const block=make('section','mobile-control-section');
    const head=make('div','mobile-control-heading');
    head.append(make('h3','',title));
    if(subtitle)head.append(make('p','',subtitle));
    block.append(head);
    return block;
  }

  function grid(className=''){
    return make('div',`mobile-control-grid ${className}`.trim());
  }

  function appendNode(target,selector,caption=''){
    const node=typeof selector==='string'?$(selector):selector;
    if(!node)return;
    if(caption)node.dataset.mobileCaption=caption;
    moveNode(node,target,'mobile-control');
  }

  function renderText(){
    restoreMoved();
    ui.body.replaceChildren();

    const type=section('Tipografía','Formato del texto seleccionado');
    const typeGrid=grid('mobile-control-grid-fields');
    appendNode(typeGrid,'#block');
    appendNode(typeGrid,'#selection-font');
    appendNode(typeGrid,'#selection-size');
    type.append(typeGrid);

    const marks=section('Estilo');
    const markGrid=grid('mobile-control-grid-actions');
    const markSelectors=['[data-command="bold"]','[data-command="italic"]','[data-command="underline"]','[data-command="strike"]'];
    markSelectors.forEach(sel=>appendNode(markGrid,sel));
    appendNode(markGrid,$('#text-color')?.closest('label'),'Texto');
    appendNode(markGrid,$('#highlight-color')?.closest('label'),'Fondo');
    appendNode(markGrid,'#clear-format');
    marks.append(markGrid);

    const paragraph=section('Párrafo y líneas');
    const paragraphGrid=grid('mobile-control-grid-fields');
    appendNode(paragraphGrid,'#text-align');
    paragraph.append(paragraphGrid);
    const paragraphActions=grid('mobile-control-grid-actions');
    appendNode(paragraphActions,'[data-command="bulletList"]','Viñetas');
    appendNode(paragraphActions,'[data-command="orderedList"]','Numerada');
    appendNode(paragraphActions,'[data-command="blockquote"]','Cita');
    appendNode(paragraphActions,'#insert-line-break');
    appendNode(paragraphActions,'#remove-line-breaks');
    paragraph.append(paragraphActions);

    const history=section('Historial');
    const historyGrid=grid('mobile-control-grid-actions mobile-history-grid');
    appendNode(historyGrid,'[data-command="undo"]','Deshacer');
    appendNode(historyGrid,'[data-command="redo"]','Rehacer');
    history.append(historyGrid);

    ui.body.append(type,marks,paragraph,history);
    showSheet('Texto',{panel:'text'});
  }

  function designDetails(){
    return $$('.designer details').filter(detail=>detail.querySelector('summary'));
  }

  function renderDesignHome(){
    restoreMoved();
    ui.body.replaceChildren();
    const intro=make('p','mobile-sheet-intro','Cambia una parte del diseño sin perder de vista tu carta.');
    const menu=make('div','mobile-design-menu');
    const categories=[
      ['La página completa','◉','Página','Fondo y atmósfera exterior'],
      ['El papel y su marco','▣','Papel y marco','Color, borde, neón y emoji'],
      ['Texto base de la carta','Aa','Texto base','Fuente, tamaño y lectura'],
      ['El título','T','Título','Tipografía, color y alineación'],
      ['Adornos y firma','✦','Adornos y firma','Símbolos, brillo y firma']
    ];
    const details=designDetails();
    for(const [summary,icon,label,desc] of categories){
      const detail=details.find(item=>item.querySelector('summary')?.textContent.trim()===summary);
      if(!detail)continue;
      const button=make('button','mobile-design-card');
      button.type='button';
      button.innerHTML=`<span class="mobile-design-icon">${icon}</span><span><strong>${label}</strong><small>${desc}</small></span><b>›</b>`;
      button.addEventListener('click',()=>{vibrate();renderDesignDetail(detail,label)});
      menu.append(button);
    }
    ui.body.append(intro,menu);
    showSheet('Diseño',{panel:'design'});
  }

  function renderDesignDetail(detail,label){
    restoreMoved();
    ui.body.replaceChildren();
    detail.open=true;
    moveNode(detail,ui.body,'mobile-native-detail');
    showSheet(label,{back:true,panel:'design-detail'});
  }

  function renderAtmosphere(){
    restoreMoved();
    ui.body.replaceChildren();
    const detail=designDetails().find(item=>item.querySelector('summary')?.textContent.trim()==='Atmósfera inicial');
    if(detail){
      detail.open=true;
      moveNode(detail,ui.body,'mobile-native-detail');
    }
    showSheet('Atmósferas',{panel:'atmosphere'});
  }

  function renderInsert(){
    restoreMoved();
    ui.body.replaceChildren();
    const block=section('Añadir a la carta','Inserta o mueve elementos sin salir del lienzo.');
    const actions=grid('mobile-insert-grid');
    const entries=[
      ['#link','Enlace'],
      ['[data-command="horizontalRule"]','Separador'],
      ['#add-image',''],
      ['#add-table',''],
      ['#move-up','Subir bloque'],
      ['#move-down','Bajar bloque']
    ];
    for(const [selector,caption] of entries)appendNode(actions,selector,caption);
    block.append(actions);
    ui.body.append(block);
    const tableTools=$('#table-tools');
    if(tableTools)moveNode(tableTools,ui.body,'mobile-table-tools');
    showSheet('Insertar',{panel:'insert'});
  }

  function nativeShareButton(){
    const button=make('button','mobile-native-share primary','Compartir con…');
    button.type='button';
    button.addEventListener('click',async()=>{
      vibrate();
      $('#generate')?.click();
      await new Promise(resolve=>setTimeout(resolve,60));
      const url=$('#share-url')?.value;
      if(!url)return;
      if(navigator.share){
        try{await navigator.share({title:'EmLetter',text:'Una carta para ti',url})}catch(error){if(error?.name!=='AbortError')console.warn(error)}
      }else{
        $('#copy')?.click();
      }
    });
    return button;
  }

  function renderShare(){
    restoreMoved();
    ui.body.replaceChildren();
    const quick=section('Finalizar','Previsualiza, descarga o comparte tu carta.');
    const quickGrid=grid('mobile-share-actions');
    const preview=make('button','outline','Vista previa');
    preview.type='button';
    preview.addEventListener('click',()=>{closeSheet();$('#preview')?.click()});
    quickGrid.append(preview,nativeShareButton());
    quick.append(quickGrid);
    ui.body.append(quick);
    const shareRow=$('.share-row');
    const shareResult=$('#share-result');
    if(shareRow)moveNode(shareRow,ui.body,'mobile-share-row');
    if(shareResult)moveNode(shareResult,ui.body,'mobile-share-result');
    showSheet('Compartir',{panel:'share'});
  }

  function openPanel(panel){
    lastFocus=document.activeElement;
    switch(panel){
      case'text':renderText();break;
      case'design':renderDesignHome();break;
      case'atmosphere':renderAtmosphere();break;
      case'insert':renderInsert();break;
      case'share':renderShare();break;
    }
  }

  function enableMobile(){
    createUI();
    document.body.classList.add('mobile-native');
    ui.root.hidden=false;
  }

  function disableMobile(){
    if(!ui)return;
    closeSheet();
    restoreMoved();
    document.body.classList.remove('mobile-native','mobile-sheet-open');
    ui.root.hidden=true;
  }

  function syncMode(){
    if(media.matches)enableMobile();
    else disableMobile();
  }

  function init(){
    if(!$('#composer'))return;
    createUI();
    syncMode();
    media.addEventListener?.('change',syncMode);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
