import DOMPurify from 'dompurify';
import {marked} from 'marked';
import TurndownService from 'turndown';
export const fontFamilies={serif:'Georgia, serif',mono:'Courier New, monospace',sans:'Arial, sans-serif',cursive:'cursive',cormorant:'Cormorant Garamond, serif',ebgaramond:'EB Garamond, serif',cinzel:'Cinzel, serif',cinzelDecorative:'Cinzel Decorative, serif',almendraSC:'Almendra SC, serif',pirata:'Pirata One, serif',unifraktur:'UnifrakturCook, serif',newRocker:'New Rocker, serif',specialElite:'Special Elite, monospace'};
const allowedFonts=['Georgia, serif','Arial, sans-serif','Courier New, monospace','Verdana, sans-serif','cursive','UnifrakturCook, serif','UnifrakturMaguntia, serif','Grenze Gotisch, serif','Pirata One, serif','New Rocker, serif','Metal Mania, serif','Germania One, serif','Almendra SC, serif','Almendra Display, serif','Astloch, serif','MedievalSharp, serif','Eagle Lake, serif','Fondamento, serif','Grenze, serif','Nosifer, fantasy','Creepster, fantasy','Butcherman, fantasy','Eater, fantasy','Jolly Lodger, fantasy','Frijole, fantasy','Lacquer, fantasy','Mystery Quest, fantasy','Rubik Glitch, fantasy','Rubik Wet Paint, fantasy','Rubik Distressed, fantasy','Rubik Dirt, fantasy','Rubik Beastly, fantasy','Cinzel, serif','Cinzel Decorative, serif','Caudex, serif','Cormorant Garamond, serif','EB Garamond, serif','IM FELL English, serif','IM FELL English SC, serif','IM FELL DW Pica, serif','IM FELL DW Pica SC, serif','IM FELL Double Pica, serif','IM FELL Double Pica SC, serif','IM FELL French Canon, serif','IM FELL French Canon SC, serif','Special Elite, monospace','Rock Salt, cursive','Permanent Marker, cursive','Sedgwick Ave Display, cursive','Reenie Beanie, cursive','Nothing You Could Do, cursive','Homemade Apple, cursive','Shadows Into Light, cursive','Covered By Your Grace, cursive','Caveat, cursive','Gloria Hallelujah, cursive','Zeyada, cursive','La Belle Aurore, cursive','Old English Text MT, serif','Lucida Blackletter, serif','Blackadder ITC, cursive','Chiller, fantasy','Curlz MT, cursive','Segoe Print, cursive','Georgia','Courier New','Arial','Times New Roman','Verdana','Trebuchet MS'];
DOMPurify.addHook('afterSanitizeAttributes',node=>{
 if(!node.getAttribute)return;
 if(node.hasAttribute('style')){const old=node.style;const kept=[];
 for(const key of ['color','background-color']){const v=old.getPropertyValue(key);if(/^(#[\da-f]{3,8}|rgba?\([\d\s.,%]+\)|transparent)$/i.test(v))kept.push(key+':'+v)}
 const fs=parseFloat(old.fontSize);if(/^[\d.]+px$/.test(old.fontSize)&&fs>=10&&fs<=96)kept.push('font-size:'+fs+'px');
 const family=old.fontFamily.replace(/["']/g,'');if(allowedFonts.includes(family))kept.push('font-family:'+family);
 if(['left','center','right','justify'].includes(old.textAlign))kept.push('text-align:'+old.textAlign);
 const lh=Number(old.lineHeight);if(lh>=1&&lh<=3)kept.push('line-height:'+lh);
 if(node.tagName==='IMG'){const w=parseFloat(old.width);if(old.width.endsWith('%')&&w>=10&&w<=100)kept.push('width:'+w+'%');const radius=parseFloat(old.borderRadius);if(old.borderRadius.endsWith('px')&&radius>=0&&radius<=60)kept.push('border-radius:'+radius+'px');if(old.marginLeft==='auto')kept.push('margin-left:auto');if(old.marginRight==='auto')kept.push('margin-right:auto')}
 node.removeAttribute('style');if(kept.length)node.setAttribute('style',kept.join(';'));
 }
 if(node.tagName==='IMG'){try{const u=new URL(node.getAttribute('src'));if(!['http:','https:'].includes(u.protocol))throw Error();node.src=u.href;node.setAttribute('loading','lazy');node.setAttribute('referrerpolicy','no-referrer')}catch{node.removeAttribute('src')}}
 if(node.tagName==='A'){const href=node.getAttribute('href')||'';if(!/^(https?:|mailto:)/i.test(href))node.removeAttribute('href');node.setAttribute('rel','noopener noreferrer');node.setAttribute('target','_blank')}
 for(const attr of ['colspan','rowspan']){if(node.hasAttribute(attr)){const v=Number(node.getAttribute(attr));if(!Number.isInteger(v)||v<1||v>50)node.removeAttribute(attr)}}
});
export function sanitizeHTML(html){return DOMPurify.sanitize(html,{ALLOWED_TAGS:['p','br','strong','em','s','del','u','span','h1','h2','h3','blockquote','ul','ol','li','a','hr','pre','code','img','table','thead','tbody','tr','th','td'],ALLOWED_ATTR:['href','title','start','style','src','alt','colspan','rowspan'],ALLOW_DATA_ATTR:false})}
export function safeHTML(markdown){return sanitizeHTML(marked.parse(markdown,{gfm:true,breaks:false}))}
const td=new TurndownService({headingStyle:'atx',bulletListMarker:'-',emDelimiter:'*'});
td.addRule('strike',{filter:['del','s','strike'],replacement:c=>'~~'+c+'~~'});
td.addRule('break',{filter:'br',replacement:()=> '  \n'});
// Markdown accepts inline HTML. Preserve formatting that plain Markdown cannot represent.
td.addRule('rich',{filter:n=>['TABLE','IMG','SPAN','U'].includes(n.nodeName)||n.hasAttribute('style'),replacement:(_,n)=>['TABLE','P','H1','H2','H3'].includes(n.nodeName)?'\n\n'+n.outerHTML+'\n\n':n.outerHTML});
export function toMarkdown(html){return td.turndown(sanitizeHTML(html))}
