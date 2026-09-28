import {defaults,palettes,cleanStyle} from './codec.js';
export const STORAGE_KEY='cartas.atmospheres.v1';
const STORAGE_VERSION=2;
const names={velvet:'Tinta',nocturne:'Bruma',relic:'Ceniza'};
const showcaseStyles={
 velvet:{
  theme:'velvet',color:'#d9a0b4',font:'cormorant',size:19,
  pageBg:'#050207',pageEnd:'#2a0717',background:'radial',paperBg:'#100810',textColor:'#f1dee6',titleColor:'#f3b6ca',
  borderColor:'#7d2746',borderWidth:2,borderStyle:'double',frameMode:'neon',borderGlow:12,borderGlowColor:'#b51f52',frameEmoji:'🥀',frameEmojiSize:16,frameEmojiGap:7,
  radius:10,padding:58,width:820,pageSpace:56,lineHeight:1.85,paragraphSpace:20,titleSize:44,titleAlign:'center',align:'center',shadow:50,transparent:false,
  signature:true,signatureStyle:'digital',signatureText:'EmLetter',ornaments:true,ornament:'🥀',endOrnament:'🖤',ornamentColor:'#e7a2b8',ornamentLineColor:'#8d3653',ornamentGlow:10,ornamentSize:22,ornamentLineWidth:82,ornamentLineThickness:1,ornamentLineStyle:'thorns',titleFont:'cinzelDecorative'
 },
 nocturne:{
  theme:'nocturne',color:'#d8cda5',font:'ebgaramond',size:19,
  pageBg:'#020706',pageEnd:'#12352c',background:'gradient',paperBg:'#07110f',textColor:'#e7efe9',titleColor:'#efe4c1',
  borderColor:'#61786d',borderWidth:2,borderStyle:'double',frameMode:'neon',borderGlow:9,borderGlowColor:'#6fa88e',frameEmoji:'🕯️',frameEmojiSize:15,frameEmojiGap:8,
  radius:5,padding:58,width:820,pageSpace:56,lineHeight:1.9,paragraphSpace:20,titleSize:43,titleAlign:'center',align:'center',shadow:52,transparent:false,
  signature:true,signatureStyle:'name',signatureText:'EmLetter',ornaments:true,ornament:'✦',endOrnament:'🕯️',ornamentColor:'#efe4c1',ornamentLineColor:'#6f8d80',ornamentGlow:8,ornamentSize:19,ornamentLineWidth:88,ornamentLineThickness:1,ornamentLineStyle:'stars',titleFont:'almendraSC'
 },
 relic:{
  theme:'relic',color:'#c894ff',font:'cormorant',size:19,
  pageBg:'#04030a',pageEnd:'#2a1240',background:'radial',paperBg:'#0d0916',textColor:'#eee7f6',titleColor:'#e1bcff',
  borderColor:'#8b56ad',borderWidth:1,borderStyle:'solid',frameMode:'emoji',borderGlow:18,borderGlowColor:'#b566ff',frameEmoji:'✦',frameEmojiSize:15,frameEmojiGap:8,
  radius:14,padding:56,width:820,pageSpace:58,lineHeight:1.85,paragraphSpace:18,titleSize:46,titleAlign:'center',align:'center',shadow:55,transparent:false,
  signature:true,signatureStyle:'digital',signatureText:'EmLetter',ornaments:true,ornament:'🕯️',endOrnament:'✦',ornamentColor:'#d7a4ff',ornamentLineColor:'#8651aa',ornamentGlow:14,ornamentSize:21,ornamentLineWidth:80,ornamentLineThickness:1,ornamentLineStyle:'diamonds',titleFont:'newRocker'
 }
};
function legacyOriginal(id){if(!Object.hasOwn(names,id))return null;const [paperBg,textColor]=palettes[id];return {id,name:names[id],style:cleanStyle({...defaults,theme:id,atmosphereName:names[id],paperBg,textColor,titleColor:textColor})}}
export function original(id){if(!Object.hasOwn(names,id))return null;return {id,name:names[id],style:cleanStyle({...defaults,...showcaseStyles[id],theme:id,atmosphereName:names[id]})}}
export function createAtmospheres(storage){let presets=Object.keys(names).map(original),defaultId='velvet',storageAvailable=true,needsMigration=false;
 try{const raw=storage.getItem(STORAGE_KEY);if(raw){const data=JSON.parse(raw);if([1,STORAGE_VERSION].includes(data?.version)&&Array.isArray(data.presets)){const ids=new Set();const saved=data.presets.filter(p=>p&&typeof p.id==='string'&&/^(velvet|nocturne|relic|custom-[a-z0-9-]+)$/.test(p.id)&&typeof p.name==='string'&&p.name.trim()&&!ids.has(p.id)&&ids.add(p.id)).map(p=>({id:p.id,name:p.name.trim().slice(0,60),style:cleanStyle({...p.style,atmosphereName:p.name.trim().slice(0,60)})}));
  if(data.version===1){presets=[...Object.keys(names).map(id=>{const old=saved.find(p=>p.id===id);if(!old)return original(id);const legacy=legacyOriginal(id);return JSON.stringify(old.style)===JSON.stringify(legacy.style)?original(id):old}),...saved.filter(p=>!Object.hasOwn(names,p.id))];needsMigration=true}else presets=[...Object.keys(names).map(id=>saved.find(p=>p.id===id)||original(id)),...saved.filter(p=>!Object.hasOwn(names,p.id))];
  if(presets.some(p=>p.id===data.defaultId))defaultId=data.defaultId}}}catch{storageAvailable=false}
 function persist(){try{storage.setItem(STORAGE_KEY,JSON.stringify({version:STORAGE_VERSION,defaultId,presets}));storageAvailable=true;return true}catch{storageAvailable=false;return false}}
 const api={list:()=>presets.map(p=>({...p,style:{...p.style}})),get:id=>{const p=presets.find(p=>p.id===id);return p?{...p,style:{...p.style}}:null},defaultId:()=>defaultId,available:()=>storageAvailable,
 save({id,name,style,makeDefault=false}){name=String(name||'').trim().slice(0,60);if(!name)throw Error('Escribe un nombre para tu atmósfera.');if(!id)id='custom-'+crypto.randomUUID();else if(!presets.some(p=>p.id===id))throw Error('No se encontró esa atmósfera.');const p={id,name,style:cleanStyle({...style,atmosphereName:name})};const i=presets.findIndex(x=>x.id===id);if(i>=0)presets[i]=p;else presets.push(p);if(makeDefault)defaultId=id;else if(defaultId===id)defaultId='velvet';const persisted=persist();return {preset:api.get(id),persisted}},
 resetOrRemove(id){const i=presets.findIndex(p=>p.id===id);if(i<0)throw Error('No se encontró esa atmósfera.');const initial=original(id);if(initial)presets[i]=initial;else presets.splice(i,1);if(!presets.some(p=>p.id===defaultId))defaultId='velvet';return {preset:api.get(initial?id:defaultId),persisted:persist()}},
 resetAll(){presets=Object.keys(names).map(original);defaultId='velvet';return {preset:api.get(defaultId),persisted:persist()}},
 };if(needsMigration)persist();return api;
}
