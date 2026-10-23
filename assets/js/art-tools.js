/* Herramientas de composiciones artísticas de EmLetter.
   El contenido (incluidos los números) es texto real editable en el panel, nunca
   una copia de la imagen de referencia. Estado serializado en style por codec.js. */
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
  function el(name,cls,text){const n=document.createElement(name);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n}
  function build(paper){
    let frame=$('.emletter-art-frame',paper);
    if(frame)return;
    frame=el('div','emletter-art-frame');frame.setAttribute('aria-hidden','true');
    for(const c of ['tl','tr','bl','br'])frame.append(el('span',`emletter-art-corner corner-${c}`,'❦'));
    for(const c of ['top','right','bottom','left'])frame.append(el('span',`emletter-art-edge edge-${c}`));
    const sparkles=el('div','emletter-art-sparkles');sparkles.setAttribute('aria-hidden','true');
    ART_POSITIONS.forEach(([x,y,size],i)=>{const star=el('span','emletter-art-star',i%4===0?'✦':i%3===0?'✧':'⋆');star.style.left=`${x}%`;star.style.top=`${y}%`;star.style.fontSize=`${size}px`;sparkles.append(star)});
    const header=el('div','emletter-art-header');header.setAttribute('aria-label','Número decorativo');
    const number=el('span','emletter-art-number','15');
    for(const [x,y,sz] of [[29,38,13],[46,61,17],[63,32,11],[68,75,14],[41,79,10],[57,51,9]]){
      const glint=el('span','emletter-art-number-glint','✦');
      glint.style.left=x+'%';glint.style.top=y+'%';glint.style.fontSize=sz+'px';
      header.append(glint);
    }
    const candles=el('div','emletter-art-candles');candles.setAttribute('aria-hidden','true');
    for(let i=0;i<2;i++){const stick=el('span','emletter-art-candle');stick.append(el('span','emletter-art-flame'));candles.append(stick)}
    header.append(candles,number);
    const footer=el('div','emletter-art-footer');footer.setAttribute('aria-hidden','true');
    footer.append(el('span','emletter-art-bottom-line'),el('span','emletter-art-crown','♕'),el('span','emletter-art-bottom-line'));
    paper.insertBefore(frame,paper.firstChild);
    paper.insertBefore(sparkles,paper.firstChild);
    const editor=paper.querySelector('#editor, #read-title');
    if(editor)editor.before(header);
    const signature=paper.querySelector('.letter-signature');
    if(signature)signature.before(footer);else paper.append(footer);
  }
  function render(style){
    for(const paper of document.querySelectorAll('#edit-paper,#read-paper')){
      build(paper);
      paper.dataset.artActive=style.artEnabled?'true':'false';
      paper.classList.toggle('art-framed',Boolean(style.artFrame));
      paper.classList.toggle('art-italic',Boolean(style.artItalic));
      paper.style.setProperty('--art-glow',style.artGlowColor);
      paper.style.setProperty('--art-number-color',style.artNumberColor);
      paper.style.setProperty('--art-glow-strength',`${style.artGlowStrength}px`);
      paper.style.setProperty('--art-number-size',`${style.artNumberSize}px`);
      paper.style.setProperty('--art-text-glow',`${style.artTextGlow}px`);
      paper.style.setProperty('--art-min-height',`${style.artMinHeight||0}px`);
      $('.emletter-art-number',paper).textContent=style.artNumber||'15';
      const candleHolder=$('.emletter-art-candles',paper);
      candleHolder.hidden=!style.artCandles;
      const count=Math.max(1,Math.min(4,String(style.artNumber||'15').length));
      while(candleHolder.childElementCount<count){const stick=el('span','emletter-art-candle');stick.append(el('span','emletter-art-flame'));candleHolder.append(stick)}
      while(candleHolder.childElementCount>count)candleHolder.lastChild.remove();
      $('.emletter-art-footer',paper).hidden=!style.artCrown;
      [...paper.querySelectorAll('.emletter-art-star')].forEach((star,i)=>star.hidden=i>=style.artStars);
    }
    document.querySelectorAll('[data-art-setting]').forEach(input=>{
      if(input===document.activeElement&&input.type==='text')return;
      const key=input.dataset.artSetting;
      if(input.type==='checkbox')input.checked=Boolean(style[key]);
      else input.value=style[key];
      const output=document.querySelector(`[data-art-output="${key}"]`);
      if(output)output.textContent=style[key]+(input.dataset.suffix||'');
    });
  }
  window.EmLetterArt={render};
  function init(){
    if(!API()||$('#emletter-art-panel'))return;
    const designer=$('.designer');if(!designer)return;
    const detail=el('details','emletter-art-panel');detail.id='emletter-art-panel';
    const summary=el('summary','','Arte decorativo · Neón y celebración');
    detail.append(summary);
    const intro=el('p','control-note','Diseña una composición con números luminosos, velas, marco ornamental, destellos y texto con resplandor.');
    detail.append(intro);
    const template=el('button','outline emletter-art-template','✦ Aplicar ejemplo violeta (editable)');template.type='button';template.id='art-use-template';detail.append(template);
    const controls=[
      ['artEnabled','Activar elementos artísticos','checkbox'],
      ['artNumber','Número decorativo (edad o cifra)','text'],
      ['artNumberSize','Tamaño del número','range',60,360,' px'],
      ['artGlowColor','Color de resplandor','color'],
      ['artNumberColor','Color del número','color'],
      ['artGlowStrength','Intensidad del neón','range',0,60,' px'],
      ['artTextGlow','Brillo del texto','range',0,35,' px'],
      ['artMinHeight','Altura mínima del diseño','range',0,1200,' px'],
      ['artStars','Cantidad de destellos','range',0,36,''],
      ['artCandles','Velas encendidas','checkbox'],
      ['artFrame','Marco con filigranas','checkbox'],
      ['artCrown','Corona ornamental','checkbox'],
      ['artItalic','Texto principal en cursiva','checkbox']
    ];
    for(const [key,name,type,min,max,suffix] of controls){
      const label=el('label',type==='range'?'design-range':type==='checkbox'?'check':type==='color'?'design-color':'design-select');
      let input=el('input');input.type=type;input.dataset.artSetting=key;input.id=`art-${key}`;
      if(type==='range'){input.min=String(min);input.max=String(max);input.step='1';input.dataset.suffix=suffix;const out=el('output');out.dataset.artOutput=key;label.append(el('span','',name),out,input)}
      else if(type==='checkbox')label.append(input,document.createTextNode(name));
      else {label.append(document.createTextNode(name),input);if(type==='text'){input.maxLength=4;input.inputMode='numeric';input.placeholder='15'}}
      detail.append(label);
      input.addEventListener(type==='text'?'change':'input',()=>{
        let value=type==='checkbox'?input.checked:type==='range'?Number(input.value):input.value;
        if(key==='artNumber')value=String(value).replace(/[^0-9]/g,'').slice(0,4)||'15';
        API()?.apply({[key]:value});
      });
    }
    // El nuevo panel también entra en el navegador móvil existente porque
    // mobile-app mueve los <details> de .designer al abrir Diseño.
    designer.append(detail);
    template.addEventListener('click',()=>{
      const paper=$('#edit-paper');
      const content=$('#editor .tiptap')?.textContent?.trim()||'';
      if(content&&!confirm('El ejemplo sustituirá el texto actual. ¿Quieres continuar?'))return;
      API().apply({
        artEnabled:true,artNumber:'15',artNumberSize:250,artGlowColor:'#d78aff',artNumberColor:'#e7bbff',
        artGlowStrength:25,artStars:24,artCandles:true,artFrame:true,artCrown:true,
        artTextGlow:12,artItalic:true,artMinHeight:690,
        paperBg:'#12091e',textColor:'#f2cfff',titleColor:'#f6d7ff',font:'cormorant',
        size:46,padding:62,width:1000,lineHeight:1.14,paragraphSpace:11,
        background:'radial',pageBg:'#09030f',pageEnd:'#271038',
        border:false,ornaments:false,signatureStyle:'none',radius:0,shadow:40,
        titleFont:'cormorant',titleSize:54,titleAlign:'center'
      });
      API().setContent('<p>Amiga, no te imaginas<br>la felicidad que siento de que haya<br>llegado tu día especial,<br>¡Felices 15!</p>');
      paper?.scrollIntoView({behavior:'smooth',block:'center'});
    });
    render(API().getStyle());
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
  window.addEventListener('emletter:art-ready',init);
})();
