export function isRendered(element){
  if(!element||!element.isConnected)return false;
  // Closed disclosures may retain measurable descendants; geometry alone is not visibility.
  for(let ancestor=element.parentElement;ancestor;ancestor=ancestor.parentElement){
    if(ancestor.tagName==='DETAILS'&&!ancestor.open){
      const summary=[...ancestor.children].find(child=>child.tagName==='SUMMARY');
      if(!summary?.contains(element))return false;
    }
  }
  if(typeof element.checkVisibility==='function'){
    if(!element.checkVisibility({visibilityProperty:true,opacityProperty:true}))return false;
  }else{
    const css=node=>node.ownerDocument.defaultView.getComputedStyle(node);
    if(['hidden','collapse'].includes(css(element).visibility))return false;
    for(let node=element;node;node=node.parentElement){
      const style=css(node);
      if(style.display==='none'||style.opacity==='0'||style.contentVisibility==='hidden')return false;
    }
  }
  return [...element.getClientRects()].some(rect=>rect.width>0&&rect.height>0);
}

export function assertLayout(document,label){
  const describe=node=>({id:node.id||null,tag:node.tagName,text:node.textContent.trim().replace(/\s+/g,' ').slice(0,80),
    rect:Object.fromEntries(['left','top','right','bottom','width','height'].map(key=>[key,node.getBoundingClientRect()[key]]))});
  const fail=(reason,nodes=[])=>{const error=new Error(`${label}: ${reason}`);error.diagnostics={label,elements:nodes.map(describe)};throw error;};
  if(document.documentElement.scrollWidth>document.documentElement.clientWidth+1)fail('页面横向溢出');
  for(const node of document.querySelectorAll('button,select,label,h1,h2,h3,.guide-compare-table td,.guide-compare-table th')){
    if(isRendered(node)&&node.scrollWidth>node.clientWidth+2)fail(`${node.textContent.slice(0,32)} 内容溢出`,[node]);
  }
  const buttons=[...document.querySelectorAll('button')].filter(isRendered);
  for(let i=0;i<buttons.length;i++)for(let j=i+1;j<buttons.length;j++){
    const a=buttons[i].getBoundingClientRect(),b=buttons[j].getBoundingClientRect();
    if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>2&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>2){
      const name=node=>node.id?`#${node.id}`:node.textContent.trim().slice(0,24);
      fail(`按钮互相遮挡：${name(buttons[i])} 与 ${name(buttons[j])}`,[buttons[i],buttons[j]]);
    }
  }
}
