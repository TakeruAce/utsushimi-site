import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
const js = stripTypeScriptTypes(readFileSync('src/scripts/introSnap.ts', 'utf8'), {mode:'strip'}).replace('export function', 'function') + '\nthis.initialize = initializeIntroSnap;';
function env(y = 0, reducedMotion = false, headerOffset = () => 0) {
  class Target {
    listeners = new Map();
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
    emit(type, detail = {}) { const e = { type, cancelable:true, prevented:false, preventDefault(){this.prevented=true}, ...detail }; for (const f of [...(this.listeners.get(type)||[])]) f(e); return e; }
  }
  let clock = 0, seq = 0; const frames = new Map(), calls = [];
  const win = new Target(); win.scrollY = y; win.innerHeight = 1000; win.visualViewport = new Target(); win.visualViewport.height = 1000;
  class Element extends Target {
    constructor(top=0) { super(); this.top=top; this.dataset={}; this.attrs={}; this.isConnected=true; this.parentElement=null; this.id=''; this.target=''; this.focuses=0; this.scrollHeight=this.clientHeight=100; this.scrollTop=0; }
    getBoundingClientRect() {return {top:this.top-win.scrollY}}
    getAttribute(k){ return this.attrs[k]??null }
    hasAttribute(k){return k in this.attrs}
    setAttribute(k,v){this.attrs[k]=v}
    removeAttribute(k){delete this.attrs[k]}
    closest(query){return query==='a[href]' && this.attrs.href ? this : null}
    contains(other){return other === this || other.parentElement === this}
    focus(opts){assert.equal(opts.preventScroll,true);this.focuses++}
  }
  const doc = new Target(); doc.body = new Element(); doc.documentElement = new Element();
  const intro=new Element(), company=new Element(1000); company.id='company-overview';
  const reduced=new Target(); reduced.matches=reducedMotion;
  const observers=[];
  class ResizeObserver {constructor(fn){this.fn=fn;observers.push(this)} observe(){} disconnect(){}}
  win.scrollTo = (options) => { calls.push(options); if(options.behavior==='instant'){win.scrollY=options.top;win.emit('scroll');} };
  const context={window:win,document:doc,Element,ResizeObserver,getComputedStyle:()=>({overflowY:'visible'}),performance:{now:()=>clock},requestAnimationFrame:fn=>{frames.set(++seq,fn);return seq},cancelAnimationFrame:id=>frames.delete(id)};
  runInNewContext(js,context);
  const dispose=context.initialize(intro,company,reduced,headerOffset);
  const frame=()=>{clock+=16;const current=[...frames.values()];frames.clear();for(const fn of current)fn(clock)};
  const move=top=>{win.scrollY=top;win.emit('scroll');frame()};
  const wheel=deltaY=>win.emit('wheel',{deltaY,deltaX:0,target:doc.body});
  const key=key=>win.emit('keydown',{key,target:doc.body});
  const click=()=>{const anchor=new Element();anchor.attrs.href='#company-overview';anchor.parentElement=intro;return doc.emit('click',{target:anchor,button:0})};
  return {win,doc,intro,company,reduced,calls,frame,move,wheel,key,click,dispose,resize:()=>{for(const o of observers)o.fn();frame()},smooth:()=>calls.filter(c=>c.behavior==='smooth')};
}
let headerHeight=92;
let fixed=env(0,false,()=>headerHeight);fixed.wheel(100);fixed.move(300);assert.equal(fixed.smooth().at(-1).top,908,'company arrives beneath fixed header');headerHeight=76;fixed.resize();assert.equal(fixed.smooth().at(-1).top,924,'header resize retargets arrival');fixed.move(924);assert.equal(fixed.intro.dataset.snapState,'settled');fixed.dispose();
let e=env();e.move(350);assert.equal(e.smooth().length,0,'restoration without intent');
e=env(400);e.wheel(100);e.move(750);assert.equal(e.smooth().length,0,'input first arriving midway cannot arm');
e=env();e.wheel(100);e.move(200);assert.equal(e.smooth().length,0,'below threshold');e.wheel(100);e.move(300);assert.equal(e.intro.dataset.snapState,'snapping');assert.equal(e.smooth().at(-1).top,1000);assert.equal(e.wheel(100).prevented,true);assert.equal(e.smooth().length,1,'no repeated snaps');e.move(1000);assert.equal(e.intro.dataset.snapState,'settled');assert.equal(e.company.focuses,0,'automatic snap preserves focus');e.wheel(100);e.move(1300);assert.equal(e.smooth().length,1,'normal scrolling after arrival');e.move(0);e.wheel(100);e.move(300);assert.equal(e.smooth().length,2,'rearm only at beginning');
e=env();e.wheel(100);e.move(300);e.wheel(-20);assert.equal(e.intro.dataset.snapState,'cancelled');e.move(500);assert.equal(e.smooth().length,1,'cancelled snap stays cancelled');
e=env();e.wheel(100);e.move(300);e.key('Escape');assert.equal(e.intro.dataset.snapState,'cancelled');
e=env(600);assert.equal(e.click().prevented,true);assert.equal(e.smooth().at(-1).top,1000);e.move(1000);assert.equal(e.company.focuses,1,'explicit arrival moves focus');
e=env(0,true);e.wheel(100);e.move(350);assert.equal(e.calls.length,0);assert.equal(e.click().prevented,true);assert.equal(e.calls.at(-1).behavior,'instant');assert.equal(e.win.scrollY,1000);assert.equal(e.company.focuses,1);
e=env();e.wheel(100);e.move(300);e.company.top=1200;e.resize();assert.equal(e.smooth().at(-1).top,1200,'layout retarget');e.move(1200);assert.equal(e.intro.dataset.snapState,'settled');
e=env();e.key('PageDown');e.move(500);assert.equal(e.smooth().length,1,'keyboard intent');
e=env();e.win.emit('touchstart',{touches:[{clientX:10,clientY:600}]});e.win.emit('touchmove',{target:e.doc.body,touches:[{clientX:10,clientY:200}]});e.move(400);assert.equal(e.smooth().length,1,'touch intent');
e=env();e.wheel(100);e.move(300);e.reduced.matches=true;e.reduced.emit('change');assert.equal(e.intro.dataset.snapState,'disabled');e.dispose();assert.ok([...e.win.listeners.values()].every(set=>set.size===0),'cleanup removes input/navigation listeners');
console.log('PASS: 13 state-machine scenarios (intent, threshold, cancellation, rearm, explicit focus, reduced motion, layout, cleanup).');
