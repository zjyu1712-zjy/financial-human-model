import test from 'node:test';
import assert from 'node:assert/strict';
import {isRendered,assertLayout} from './browser-layout.mjs';

// Geometry retained under a closed disclosure is intentional in this fixture.
function fixture(){
  const elements=[];
  const doc={documentElement:{scrollWidth:390,clientWidth:390},
    defaultView:{getComputedStyle:node=>({display:'block',visibility:'visible',opacity:'1',contentVisibility:'visible',...node.style})},
    querySelectorAll:selector=>elements.filter(node=>selector==='button'?node.tagName==='BUTTON':['BUTTON','SELECT','LABEL','H1','H2','H3'].includes(node.tagName))};
  function node(tag,id,options={}){
    const {parent=null,box=true,left=0,top=0,width=80,height=36}=options;
    const rect={left,top,width,height,right:left+width,bottom:top+height};
    const n={tagName:tag.toUpperCase(),id,textContent:id,ownerDocument:doc,parentElement:parent,children:[],
      style:{},isConnected:true,open:false,scrollWidth:width,clientWidth:width,
      getClientRects:()=>box?[rect]:[],getBoundingClientRect:()=>rect,
      contains:other=>{for(let current=other;current;current=current.parentElement)if(current===n)return true;return false;}};
    parent?.children.push(n);elements.push(n);return n;
  }
  return {doc,node};
}
test('closed disclosures exclude descendants even when they retain rectangles',()=>{
  const {node}=fixture(),d=node('details','helper'),s=node('summary','summary',{parent:d}),b=node('button','hidden-button',{parent:d});
  assert.equal(!!b.getClientRects().length,true);assert.equal(isRendered(b),false);assert.equal(isRendered(s),true);
  d.open=true;assert.equal(isRendered(b),true);d.open=false;assert.equal(isRendered(b),false);
});
test('only the first summary and its descendants remain visible when closed',()=>{
  const {node}=fixture(),d=node('details','outer'),s=node('summary','first',{parent:d}),b=node('button','summary-button',{parent:s});
  const second=node('summary','second',{parent:d});
  assert.equal(isRendered(d),true);assert.equal(isRendered(b),true);assert.equal(isRendered(second),false);
});
test('an outer closed disclosure hides even an open nested disclosure',()=>{
  const {node}=fixture(),outer=node('details','outer'),inner=node('details','inner',{parent:outer});inner.open=true;
  const summary=node('summary','inner-summary',{parent:inner}),b=node('button','nested',{parent:inner});
  assert.equal(isRendered(summary),false);assert.equal(isRendered(b),false);
  outer.open=true;assert.equal(isRendered(summary),true);assert.equal(isRendered(b),true);
});
test('native visibility excludes hidden styles but does not skip offscreen content',()=>{
  const {node}=fixture(),b=node('button','native',{top:3000});let seen;
  b.checkVisibility=options=>{seen=options;return false;};assert.equal(isRendered(b),false);
  assert.deepEqual(seen,{visibilityProperty:true,opacityProperty:true});
  b.checkVisibility=()=>true;assert.equal(isRendered(b),true);
});
test('fallback visibility handles absent boxes, hidden styles and disconnected nodes',()=>{
  const {node}=fixture(),p=node('div','parent'),b=node('button','child',{parent:p});
  for(const style of [{display:'none'},{opacity:'0'},{contentVisibility:'hidden'}]){p.style=style;assert.equal(isRendered(b),false);}
  p.style={};b.style={visibility:'hidden'};assert.equal(isRendered(b),false);
  b.style={};b.isConnected=false;assert.equal(isRendered(b),false);
  assert.equal(isRendered(node('button','empty',{box:false})),false);
  assert.equal(isRendered(node('button','zero',{width:0})),false);
});
test('real visible overlaps still fail and identify both buttons and their geometry',()=>{
  const {node,doc}=fixture();node('button','guide-next',{top:3000});node('button','diary-save',{top:3010,left:10});
  assert.throws(()=>assertLayout(doc,'第二步'),error=>{
    assert.match(error.message,/#guide-next 与 #diary-save/);
    assert.equal(error.diagnostics.elements[0].rect.top,3000);
    assert.equal(error.diagnostics.elements[1].id,'diary-save');return true;
  });
});
test('closed-content geometry is excluded without suppressing an overlap after opening',()=>{
  const {node,doc}=fixture(),d=node('details','helper');node('summary','summary',{parent:d});
  node('button','diary-start',{parent:d});node('button','guide-next');
  assert.doesNotThrow(()=>assertLayout(doc,'收起'));d.open=true;assert.throws(()=>assertLayout(doc,'展开'),/按钮互相遮挡/);
});
test('visible content and page overflow still fail while collapsed overflow is excluded',()=>{
  const {node,doc}=fixture(),d=node('details','helper'),b=node('button','long-button',{parent:d});b.scrollWidth=200;
  assert.doesNotThrow(()=>assertLayout(doc,'收起'));d.open=true;assert.throws(()=>assertLayout(doc,'展开'),/内容溢出/);
  d.open=false;doc.documentElement.scrollWidth=400;assert.throws(()=>assertLayout(doc,'整页'),/页面横向溢出/);
});
