/* Herramientas opcionales de Celebración. Cada control modifica exclusivamente
   su propia propiedad. No instala ejemplos ni reemplaza textos ni estilos. */
(()=>{
  const API=()=>window.EmLetterArtAPI;
  const $=(selector,root=document)=>root.querySelector(selector);
  const ART_POSITIONS=[
    [7,15,22],[15,73,16],[27,23,14],[36,84,14],[44,10,20],[54,60,13],
    [63,24,24],[76,76,14],[90,21,18],[83,48,18],[11,51,11],[47,93,16],
    [30,95,15],[67,92,20],[92,64,14],[4,36,10],[55,41,11],[18,92,11],
    [40,44,12],[72,8,11],[96,89,12],[56,98,11],[10,90,13],[93,6,12],
    [24,9,12],[33,61,16],[51,18,13],[78,30,16],[72,64,12],[6,96,17],
    [98,34,12],[59,5,16],[89,93,14],[21,49,12],[82,7,13],[42,75,15]
  ];
  function el(tag,cls,text){
    const node=document.createElement(tag);
    if(cls)node.className=cls;
    if(text!==undefined)node.textContent=text;
    return node;
  }
  function build(paper){
    if($('.emletter-art-frame',paper))return;
    const frame=el('div','emletter-art-frame');frame.setAttribute('aria-hidden','true');
    for(const c of ['tl','tr','bl','br'])frame.append(el('span',`emletter-art-corner corner-${c}`,'❦'));
    for(const c of ['top','right','bottom','left'])frame.append(el('span',`emletter-art-edge edge-${c}`));
    const stars=el('div','emletter-art-sparkles');stars.setAttribute('aria-hidden','true');
    ART_POSITIONS.forEach(([x,y,size],i)=>{
      const star=el('span','emletter-art-star',i%4===0?'✦':i%3===0?'✧':'⋆');
      star.dataset.mixedSymbol=star.textContent;
      star.style.left=`${x}%`;star.style.top=`${y}%`;star.style.fontSize=`${size}px`;
      stars.append(star);
    });
    const header=el('div','emletter-art-header');header.setAttribute('aria-label','Texto decorativo');
    const number=el('span','emletter-art-number','15');
    for(const [x,y,size] of [[29,38,13],[46,61,17],[63,32,11],[68,75,14],[41,79,10],[57,51,9]]){
      const glint=el('span','emletter-art-number-glint','✦');
      glint.style.left=x+'%';glint.style.top=y+'%';glint.style.fontSize=size+'px';
      header.append(glint);
    }
    const candles=el('div','emletter-art-candles');candles.setAttribute('aria-hidden','true');
    header.append(candles,number);
    const footer=el('div','emletter-art-footer');footer.setAttribute('aria-hidden','true');
    footer.append(el('span','emletter-art-bottom-line'),el('span','emletter-art-crown','♕'),el('span','emletter-art-bottom-line'));
    paper.insertBefore(frame,paper.firstChild);
    paper.insertBefore(stars,paper.firstChild);
    const editor=$('#editor, #read-title',paper);
    if(editor)editor.before(header);else paper.append(header);
    const signature=$('.letter-signature',paper);
    if(signature)signature.before(footer);else paper.append(footer);
  }
  function render(style){
    for(const paper of document.querySelectorAll('#edit-paper,#read-paper')){
      build(paper);
      const active=Boolean(style.artEnabled);
      paper.dataset.artActive=String(active);
      paper.classList.toggle('art-framed',active&&Boolean(style.artFrame));
      paper.classList.toggle('art-italic',active&&Boolean(style.artItalic));
      paper.classList.toggle('art-text-glowing',active&&style.artTextGlow>0);
      paper.style.setProperty('--art-glow',style.artGlowColor);
      paper.style.setProperty('--art-number-color',style.artNumberColor);
      paper.style.setProperty('--art-glow-strength',`${style.artGlowStrength}px`);
      paper.style.setProperty('--art-number-size',`${style.artNumberSize}px`);
      paper.style.setProperty('--art-text-glow',`${style.artTextGlow}px`);
      paper.style.setProperty('--art-frame-inset',`${style.artFrameInset}px`);
      paper.style.setProperty('--art-corner-size',`${style.artCornerSize}px`);
      paper.style.setProperty('--art-crown-size',`${style.artCrownSize}px`);
      paper.style.setProperty('--art-header-space',`${style.artHeaderSpace}px`);
      // La altura es opcional: 0 deja actuar a los estilos generales del papel.
      paper.style.minHeight=active&&style.artMinHeight?`${style.artMinHeight}px`:'';
      const numberText=String(style.artNumber??'');
      $('.emletter-art-number',paper).textContent=numberText;
      const numberOn=active&&Boolean(style.artNumberVisible)&&numberText.length>0;
      const header=$('.emletter-art-header',paper);
      header.hidden=!numberOn;
      const candleHolder=$('.emletter-art-candles',paper);
      candleHolder.hidden=!numberOn||!style.artCandles;
      const candleCount=Math.max(1,Math.min(8,Number(style.artCandleCount)||2));
      while(candleHolder.childElementCount<candleCount){
        const stick=el('span','emletter-art-candle');stick.append(el('span','emletter-art-flame'));candleHolder.append(stick);
      }
      while(candleHolder.childElementCount>candleCount)candleHolder.lastChild.remove();
      $('.emletter-art-footer',paper).hidden=!active||!style.artCrown;
      $('.emletter-art-crown',paper).textContent=style.artCrownSymbol;
      for(const corner of paper.querySelectorAll('.emletter-art-corner'))corner.textContent=style.artCornerSymbol;
      for(const [i,star] of [...paper.querySelectorAll('.emletter-art-star')].entries()){
        star.hidden=!active||i>=style.artStars;
        star.textContent=style.artStarSymbol==='mixed'?star.dataset.mixedSymbol:style.artStarSymbol;
      }
    }
    for(const input of document.querySelectorAll('[data-art-setting]')){
      const key=input.dataset.artSetting;
      // No devolver el cursor al final mientras se escribe en un campo de texto.
      if(input===document.activeElement&&input.type==='text')continue;
      if(input.type==='checkbox')input.checked=Boolean(style[key]);
      else input.value=style[key];
      const output=document.querySelector(`[data-art-output="${key}"]`);
      if(output)output.textContent=style[key]+(input.dataset.suffix||'');
    }
  }
  window.EmLetterArt={render};
  function init(){
    if(!API()||$('#emletter-art-panel'))return;
    const designer=$('.designer');if(!designer)return;
    const detail=el('details','emletter-art-panel');detail.id='emletter-art-panel';
    detail.append(el('summary','','Celebración'));
    const groups=[
      {name:'Elementos',controls:[
        ['artEnabled','Activar celebración','checkbox'],
        ['artNumberVisible','Mostrar texto o número decorativo','checkbox'],
        ['artNumber','Texto o número decorativo','text'],
        ['artNumberSize','Tamaño del texto decorativo','range',60,360,' px'],
        ['artNumberColor','Color del texto decorativo','color'],
        ['artHeaderSpace','Espacio superior del texto','range',0,160,' px'],
        ['artCandles','Velas encima del texto','checkbox'],
        ['artCandleCount','Cantidad de velas','range',1,8,''],
      ]},
      {name:'Adornos',controls:[
        ['artFrame','Mostrar marco con filigranas','checkbox'],
        ['artCornerSymbol','Símbolo de las esquinas','select', ['❦','❧','✿','⚜','✦','♡','🌹','✨']],
        ['artCornerSize','Tamaño de las esquinas','range',20,120,' px'],
        ['artFrameInset','Distancia del marco al borde','range',0,90,' px'],
        ['artStars','Cantidad de destellos','range',0,36,''],
        ['artStarSymbol','Símbolo de los destellos','select',['mixed','✦','✧','✶','★','⋆','❀','♡','✨']],
        ['artCrown','Mostrar adorno inferior','checkbox'],
        ['artCrownSymbol','Símbolo inferior','select',['♕','♛','❦','✦','♡','🎂','🎉','💜','🦋','🌹']],
        ['artCrownSize','Tamaño del adorno inferior','range',24,120,' px'],
      ]},
      {name:'Brillo y composición',controls:[
        ['artGlowColor','Color del resplandor','color'],
        ['artGlowStrength','Intensidad del neón','range',0,60,' px'],
        ['artTextGlow','Brillo del texto de la carta','range',0,35,' px'],
        ['artItalic','Texto principal en cursiva','checkbox'],
        ['artMinHeight','Altura mínima de la carta (0 = automática)','range',0,1200,' px'],
      ]}
    ];
    for(const group of groups){
      const content=el('div','emletter-art-group');content.append(el('strong','emletter-art-group-title',group.name));
      for(const [key,name,type,min,max,suffix] of group.controls){
        const label=el('label',type==='range'?'design-range':type==='checkbox'?'check':type==='color'?'design-color':'design-select');
        const input=el(type==='select'?'select':'input');
        if(type!=='select')input.type=type;
        input.dataset.artSetting=key;input.id=`art-${key}`;
        if(type==='range'){
          input.min=String(min);input.max=String(max);input.step='1';input.dataset.suffix=suffix;
          const out=el('output');out.dataset.artOutput=key;
          label.append(el('span','',name),out,input);
        }else if(type==='checkbox')label.append(input,document.createTextNode(name));
        else{
          label.append(document.createTextNode(name),input);
          if(type==='text'){input.maxLength=24;input.placeholder='15 · Feliz cumpleaños'}
          if(type==='select'){
            for(const option of min){const opt=el('option','',option==='mixed'?'Variados':option);opt.value=option;input.append(opt)}
          }
        }
        content.append(label);
        input.addEventListener(type==='text'?'change':'input',()=>{
          const value=type==='checkbox'?input.checked:type==='range'?Number(input.value):input.value;
          API()?.apply({[key]:value});
        });
      }
      detail.append(content);
    }
    designer.append(detail);
    render(API().getStyle());
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
  window.addEventListener('emletter:art-ready',init);
})();
