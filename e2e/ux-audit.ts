import { expect, type Page } from "@playwright/test";

export async function auditUX(page:Page, collect=false) {
 await expect(page.locator('[data-ux-primary]')).toHaveCount(1);
 const issues=await page.evaluate(()=>{
  const issues:string[]=[];
  const modal=document.querySelector('dialog[open]');
  const scope=modal??document;
  const shown=(e:Element)=>{
   // Chromium can retain layout boxes for the skipped contents of closed details.
   for(let parent=e.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS'&&!parent.hasAttribute('open')&&!parent.querySelector(':scope > summary')?.contains(e))return false;
   const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=="none"&&s.visibility!=="hidden"&&r.width>0&&r.height>0;};
  const tag=(e:Element)=>`${e.tagName.toLowerCase()}${e.id?`#${e.id}`:""}`;
  const viewport=(e:Element)=>{
   const r=e.getBoundingClientRect();let top=0,left=0,right=innerWidth,bottom=innerHeight;
   if(getComputedStyle(e).position!=="fixed")for(let parent=e.parentElement;parent;parent=parent.parentElement){
    const style=getComputedStyle(parent),box=parent.getBoundingClientRect();
    if(/auto|scroll|hidden|clip/.test(style.overflowY)){top=Math.max(top,box.top);bottom=Math.min(bottom,box.bottom);}
    if(/auto|scroll|hidden|clip/.test(style.overflowX)){left=Math.max(left,box.left);right=Math.min(right,box.right);}
   }
   // Partially clipped edge targets are scrolled into view before interaction.
   return r.top>=top-.5&&r.bottom<=bottom+.5&&r.left>=left-.5&&r.right<=right+.5;
  };
  const main=document.querySelector('main')!;
  if(!main||main.id!=="main-content")issues.push("Missing skip-link destination");
  if(getComputedStyle(document.body).fontSize!=="16px")issues.push("Body text must be 16px");
  if(document.documentElement.scrollWidth>innerWidth+1)issues.push("Horizontal page overflow");
  if(main.scrollWidth>main.clientWidth+1)issues.push("Horizontal content overflow outside a table wrapper");
  const targets=Array.from(scope.querySelectorAll<HTMLElement>('a,button,input:not([type="hidden"]),select,textarea,summary,[role="button"]')).filter(shown).filter(e=>!e.classList.contains('skip-link'));
  const effective=(e:HTMLElement)=>e instanceof HTMLInputElement&&['checkbox','radio'].includes(e.type)?e.labels?.[0]??e:e;
  for(const e of targets){const r=effective(e).getBoundingClientRect();if(r.width<47.9||r.height<47.9)issues.push(`${tag(e)} has a ${r.width.toFixed(1)}×${r.height.toFixed(1)} target`);}
  for(const e of Array.from(scope.querySelectorAll('input:not([type="hidden"]),select,textarea')).filter(shown)) {
   if(getComputedStyle(e).fontSize!=="16px")issues.push(`${tag(e)} input text is not 16px`);
   if(!(e as HTMLInputElement).labels?.length)issues.push(`${tag(e)} has no persistent label`);
   const label=(e as HTMLInputElement).labels?.[0];
   if(label&&!(e instanceof HTMLInputElement&&['checkbox','radio'].includes(e.type))){
    const text=label.childNodes[0];const range=document.createRange();if(text){range.selectNode(text);if(range.getBoundingClientRect().top>e.getBoundingClientRect().top+1)issues.push(`${tag(e)} label is not above the field`);}
   }
  }
  for(const form of Array.from(scope.querySelectorAll('form')).filter(shown)){
   const fields=Array.from(form.querySelectorAll<HTMLElement>('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]),select,textarea')).filter(shown);
   for(let i=1;i<fields.length;i++){const a=fields[i-1].getBoundingClientRect(),b=fields[i].getBoundingClientRect();if(Math.abs(a.top-b.top)<Math.min(a.height,b.height)-1)issues.push(`${tag(form)} fields share a row`);}
  }
  for(const nav of Array.from(scope.querySelectorAll('nav')).filter(shown)){
   const count=Array.from(nav.querySelectorAll('a,button')).filter(shown).length;
   if(count<3||count>5)issues.push(`Navigation has ${count} items`);
   for(const link of Array.from(nav.querySelectorAll<HTMLElement>('a,button')).filter(shown))if(link.scrollWidth>link.clientWidth+1)issues.push(`Navigation label ${link.textContent} overflows its ${link.clientWidth}px target by ${link.scrollWidth-link.clientWidth}px`);
  }
  const primary=document.querySelector<HTMLElement>('[data-ux-primary]');
  if(!primary)return [...issues,'Missing primary action after navigation'];
  if(!shown(primary)||!viewport(primary))issues.push("Primary action is outside the viewport");
  if(!modal&&main.getBoundingClientRect().bottom>primary.getBoundingClientRect().top-7.9)issues.push("Content scroll area needs an 8px gap above the primary action");
  if(primary.matches('.danger,[data-destructive="true"]'))issues.push("Destructive action entered the sticky primary area");
  if(innerWidth<900){
   const r=primary.getBoundingClientRect();if(r.top<innerHeight/2)issues.push("Primary action is outside the thumb zone");
   const nav=document.querySelector('.mobile-nav');if(!modal&&nav&&shown(nav)){const n=nav.getBoundingClientRect();if(n.top-r.bottom<7.9)issues.push("Sticky action and bottom navigation need an 8px gap");}
  }
  // Check neighboring effective hit areas. Nested links/labels are one target.
  const visible=[...new Set(targets.map(effective))].filter(viewport);
  for(let i=0;i<visible.length;i++)for(let j=i+1;j<visible.length;j++){
   const a=visible[i],b=visible[j];if(a.contains(b)||b.contains(a))continue;
   const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();
   const dx=Math.max(x.left-y.right,y.left-x.right,0),dy=Math.max(x.top-y.bottom,y.top-x.bottom,0);
   if(dx<7.9&&dy<7.9)issues.push(`${tag(a)} / ${tag(b)} need an 8px target gap`);
  }
  return [...new Set(issues)].slice(0,30);
 });
 (collect?expect.soft:expect)(issues,`UX measurements at ${new URL(page.url()).pathname}`).toEqual([]);
}
