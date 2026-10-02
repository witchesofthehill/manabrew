const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const assert = require('node:assert/strict');
const repo = process.cwd();
global.__APP_VERSION__ = require(path.join(repo, 'ops/manifest.json')).packages.manabrew;
global.__SMOKE_ENV__ = { DEV: false, PROD: true, MODE: 'production', BASE_URL: '/' };
global.__SMOKE_GLOB__ = (filename, patterns) => Object.fromEntries(patterns.filter(p => fs.existsSync(path.resolve(path.dirname(filename), p))).map(p => [p, require('node:url').pathToFileURL(path.resolve(path.dirname(filename), p)).href]));
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) { return resolve.call(this, request.startsWith('@/') ? path.join(repo, 'src', request.slice(2)) : request.startsWith('@forge-wasm/') ? path.join(repo, 'packages/forge-wasm', request.slice(12)) : request, parent, ...rest); };
const load = Module._load;
Module._load = function(request, parent, ...rest) { if (request.endsWith('?url')) { const source = request.slice(0, -4); const filename = source.startsWith('.') ? path.resolve(path.dirname(parent.filename), source) : Module._resolveFilename(source, parent); assert.ok(fs.existsSync(filename)); return require('node:url').pathToFileURL(filename).href; } return load.call(this, request, parent, ...rest); };
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => {
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, transformers: { before: [context => source => {
    const visit = node => ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword ? ts.factory.createObjectLiteralExpression([
      ts.factory.createPropertyAssignment('env', ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('global'), '__SMOKE_ENV__')),
      ts.factory.createPropertyAssignment('url', ts.factory.createStringLiteral(require('node:url').pathToFileURL(filename).href)),
      ts.factory.createPropertyAssignment('glob', ts.factory.createCallExpression(ts.factory.createPropertyAccessExpression(ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('global'), '__SMOKE_GLOB__'), 'bind'), undefined, [ts.factory.createNull(), ts.factory.createStringLiteral(filename)])),
    ]) : ts.visitEachChild(node, visit, context);
    return ts.visitNode(source, visit);
  }] } }); module._compile(compiled.outputText, filename);
};
for (const extension of ['.webp', '.png', '.jpg', '.jpeg', '.svg']) require.extensions[extension] = (module, filename) => { module.exports = require('node:url').pathToFileURL(filename).href; };
require.extensions['.po'] = (module, filename) => { const catalog = require('@lingui/format-po').formatter().parse(fs.readFileSync(filename, 'utf8')); const { compileMessage } = require('@lingui/message-utils/compileMessage'); module.exports = { messages: Object.fromEntries(Object.entries(catalog).map(([id, entry]) => [id, compileMessage(entry.translation || entry.message)])) }; };
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost' });
for (const key of ['window', 'document', 'Element', 'HTMLElement', 'HTMLCanvasElement', 'HTMLInputElement', 'HTMLButtonElement', 'SVGElement', 'Node', 'DOMRect', 'Event', 'MouseEvent', 'CustomEvent', 'MutationObserver', 'DocumentFragment', 'NodeFilter']) global[key] = dom.window[key];
global.localStorage = window.localStorage; global.getComputedStyle = window.getComputedStyle.bind(window); global.IS_REACT_ACT_ENVIRONMENT = true;
let reduced = false;
window.matchMedia = query => ({ get matches() { return query.includes('reduced-motion') && reduced; }, media: query, addEventListener() {}, removeEventListener() {} });
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
global.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 0); global.cancelAnimationFrame = clearTimeout;
const nativeCanvas = require('/tmp/manabrew-accordion-smoke-20261002-2250/node_modules/@napi-rs/canvas');
global.CanvasRenderingContext2D = nativeCanvas.createCanvas(1, 1).getContext('2d').constructor;
const canvases = new WeakMap();
window.HTMLCanvasElement.prototype.getContext = function(type, options) { if (type !== '2d') return null; let canvas = canvases.get(this); if (!canvas) { canvas = nativeCanvas.createCanvas(this.width, this.height); canvases.set(this, canvas); } return canvas.getContext(type, options); };
for (const dimension of ['width', 'height']) { const descriptor = Object.getOwnPropertyDescriptor(window.HTMLCanvasElement.prototype, dimension); Object.defineProperty(window.HTMLCanvasElement.prototype, dimension, { ...descriptor, set(value) { descriptor.set.call(this, value); if (canvases.has(this)) canvases.get(this)[dimension] = value; } }); }
const { Container, Texture, TextureSource } = require('pixi.js');
const { gsap } = require('@/pixi/effects/gsap');
const { setAnimationsEnabled } = require('@/pixi/effects/enabled');
const rendererModule = require('@/pixi/limited/LimitedRenderer');
rendererModule.LimitedRenderer.prototype.initialize = async function() { this.initialized = true; this.app.stage.addChild(this.cardsLayer, this.flightsLayer, this.decorationLayer, this.motionLayer); this.app.destroy = () => this.app.stage.destroy({ children: true }); };
const { LimitedCardScene } = require('@/pixi/limited/LimitedCardScene');
const { limitedLayout } = require('@/pixi/limited/limitedLayout');
const { useScryfallStore } = require('@/stores/useScryfallStore');
window.innerWidth = 1400; window.innerHeight = 1000;
const texture = new Texture({ source: new TextureSource({ width: 130, height: 182 }) });
const info = { id: 'smoke', name: 'Smoke Card', set: 'tst', collector_number: '1', lang: 'en', type_line: 'Creature', mana_cost: '{U}', cmc: 1, colors: ['U'], color_identity: ['U'], rarity: 'common', oracle_text: '', keywords: [], layout: 'normal', power: '1', toughness: '1', legalities: {}, image_uris: { normal: 'http://fixture/card.jpg', art_crop: 'http://fixture/art.jpg' } };
useScryfallStore.setState({ getCard: async () => ({ info, uris: info.image_uris }), getCardTexture: async () => texture });
const cards = Array.from({ length: 4 }, (_, i) => ({ id: 'motion-' + i, name: 'Smoke Card ' + i, setCode: 'tst', cardNumber: String(i + 1), foil: false }));
function host(rect) { const element = document.createElement('div'); element.style.opacity = '1'; element.style.overflowX = 'visible'; element.style.overflowY = 'visible'; document.body.append(element); element.getBoundingClientRect = () => rect; element.getClientRects = () => [rect]; for (const [key, value] of Object.entries({ clientWidth: rect.width, clientHeight: rect.height, offsetWidth: rect.width, offsetHeight: rect.height, clientLeft: 0, clientTop: 0 })) Object.defineProperty(element, key, { get: () => value }); return element; }
const sourceHost = host(new DOMRect(40, 80, 1200, 300)); const destination = host(new DOMRect(100, 600, 1000, 300));
const layout = subset => limitedLayout(subset, 1200, 220, 'none', () => null, { presentation: 'spread', height: 300 });
const base = { layout: layout(cards), width: 1200, height: 300, scrollTop: 0, selectedIds: [], disabled: false, arrivalKey: 'pack-1', arrivalDirection: 'left', acquiredIds: [], departureTarget: () => destination, opening: false, onInspect: () => {} };

const React = require('react'); const {createRoot} = require('react-dom/client');
const {LimitedAccordionScene} = require('@/pixi/limited/LimitedAccordionScene');
const {BattlefieldDividers} = require('@/pixi/board/BattlefieldDividers');
const {useLimitedBuildStore,buildDeck} = require('@/components/limited/useLimitedBuildStore');
const LimitedDeckBuilder = require('@/components/limited/LimitedDeckBuilder').default;
const computed = getComputedStyle;
global.getComputedStyle = element => {const style=computed(element);return new Proxy(style,{get(target,key){if(key==='opacity')return target.opacity||'1';if(key==='overflowX'||key==='overflowY')return target[key]||'visible';const value=target[key];return typeof value==='function'?value.bind(target):value;}});};
const errors=[];const scenes=[];let hit=null;
document.elementFromPoint=()=>hit;
function pointer(type,x,y,id=1,kind='mouse',shift=false){const event=new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,shiftKey:shift});Object.defineProperties(event,{pointerId:{value:id},pointerType:{value:kind}});return event;}
function move(x,y,id=1){window.dispatchEvent(pointer('pointermove',x,y,id));}
function up(x,y,id=1){window.dispatchEvent(pointer('pointerup',x,y,id));}
function finish(scene){for(const entry of scene.entries.values())for(const key of ['layoutTimeline','motionTimeline','poseTimeline'])entry[key]?.progress(1);scene.settling?.settleTimeline?.progress(1);}
function start(scene,id=cards[0].id){const entry=scene.entries.get(id);const rect=entry.root.getBounds();const x=rect.x+rect.width/2,y=rect.y+rect.height/2;const button=document.createElement('button');scene.host.append(button);button.addEventListener('pointerdown',event=>scene.pressCard(id,event));button.dispatchEvent(pointer('pointerdown',x,y));return {entry,x,y};}
async function makeScene(element,props){const scene=new LimitedCardScene(element,props,error=>errors.push(error));scenes.push(scene);await scene.init();await new Promise(resolve=>setTimeout(resolve,0));finish(scene);scene.renderer.place(scene.renderer.panes.get(scene));return scene;}
const act=async callback=>React.act(async()=>{await callback();await new Promise(resolve=>setTimeout(resolve,0));});
(async()=>{try{
const table=host(new DOMRect(0,0,1400,1000));table.dataset.limitedTable='';const builder=document.createElement('div');builder.dataset.limitedBuilder='drag';builder.style.opacity='1';table.append(builder);
const first=host(new DOMRect(50,100,420,300));const second=host(new DOMRect(500,100,420,300));builder.append(first,second);second.dataset.limitedZone='maybe';hit=second;
const firstLayout=limitedLayout([cards[0],cards[1],cards[3]],420,130,'none',()=>null);firstLayout.cells[2]={...firstLayout.cells[2],y:900};
let selection=[];const drops=[];
const props={...base,arrivalKey:undefined,departureTarget:undefined,layout:firstLayout,width:420,height:300,selectedIds:cards.map(card=>card.id),onSelectMany:ids=>selection=ids,onDrop:(card,x,y)=>drops.push({id:card.id,x,y})};
const scene=await makeScene(first,props);const peer=await makeScene(second,{...props,layout:limitedLayout([cards[2]],420,130,'none',()=>null)});const renderer=scene.renderer;
assert.equal(scene.entries.has(cards[3].id),false,'Offscreen selected card starts culled');
let drag=start(scene);move(drag.x+40,drag.y+30);assert.equal(renderer.liftedCards.size,4,'Every selected card, including another zone and a culled card, joins the drag');
for(let i=0;i<60;i++)scene.frame(16);
const followers=renderer.dragGroups.get(drag.entry.root);assert.equal(followers.length,3);for(const follower of followers){assert.ok(Math.abs(follower.root.x-drag.entry.root.x-follower.offset)<0.05,'Cards gather into the moving stack');assert.ok(Math.abs(follower.root.y-drag.entry.root.y-follower.offset)<0.05);}
assert.equal(renderer.motionLayer.children.at(-1),drag.entry.root,'Grabbed card stays on top');const stackX=followers.map(follower=>follower.root.x);move(drag.x+140,drag.y+60);for(let i=0;i<60;i++)scene.frame(16);followers.forEach((follower,i)=>assert.ok(Math.abs(follower.root.x-stackX[i]-100)<0.1,'Every card follows pointer motion'));
hit=null;up(drag.x+140,drag.y+60);assert.equal(drops.length,0);assert.ok(Math.abs(scene.settling.settleTimeline.duration()-0.24)<0.001,'All cards return on one simultaneous timeline');scene.settling.settleTimeline.progress(1);assert.equal(renderer.liftedCards.size,0);assert.equal(renderer.dragGroups.size,0);for(const entry of scene.entries.values()){assert.equal(entry.root.parent,scene.root);assert.equal(entry.root.rotation,0);assert.equal(entry.root.scale.x,1);}assert.equal(peer.entries.get(cards[2].id).root.parent,peer.root);
reduced=true;hit=second;drag=start(scene);move(drag.x+70,drag.y+40);for(const follower of renderer.dragGroups.get(drag.entry.root)){assert.equal(follower.root.x,drag.entry.root.x+follower.offset);assert.equal(follower.root.rotation,drag.entry.root.rotation);}window.dispatchEvent(pointer('pointercancel',drag.x+70,drag.y+40));assert.equal(renderer.liftedCards.size,0);reduced=false;
scene.update({...props,selectedIds:[]});peer.update({...peer.props,selectedIds:[]});finish(scene);finish(peer);renderer.place(renderer.panes.get(scene));renderer.place(renderer.panes.get(peer));
scene.pressMarquee(pointer('pointerdown',55,105));move(900,390);assert.equal(scene.marquee.isActive,true);up(900,390);assert.deepEqual(new Set(selection),new Set([cards[0].id,cards[1].id,cards[2].id]),'Marquee crosses visible zones but excludes clipped/offscreen cards');
scene.update({...scene.props,selectedIds:[cards[3].id]});scene.pressMarquee(pointer('pointerdown',55,105,1,'mouse',true));move(200,290);up(200,290);assert.ok(selection.includes(cards[3].id),'Shift marquee keeps existing selection');assert.ok(selection.includes(cards[0].id));
const beforeCancel=[...selection];scene.pressMarquee(pointer('pointerdown',440,390));move(60,110);window.dispatchEvent(new Event('blur'));assert.equal(scene.marquee.isActive,false);assert.deepEqual(selection,beforeCancel,'Cancellation keeps selection');scene.pressMarquee(pointer('pointerdown',440,390,1,'touch'));assert.equal(scene.marquee.isActive,false,'Touch empty-space scrolling remains available');
scene.update({...scene.props,selectedIds:[]});drag=start(scene);move(drag.x+30,drag.y+30);assert.equal(renderer.liftedCards.size,1,'Dragging an unselected card does not borrow the prior selection');scene.abort();
const accordionHost=host(new DOMRect(0,450,1200,400));builder.append(accordionHost);const sections=['pool','main','sideboard','maybe'].map(id=>{const section=document.createElement('div');section.dataset.limitedSection=id;const header=document.createElement('header');Object.defineProperty(header,'clientHeight',{value:32});section.append(header);accordionHost.append(section);return section;});
const accordion=new LimitedAccordionScene(accordionHost);accordion.update([false,false,false,true]);for(let i=0;i<80;i++)accordion.layout(16);assert.deepEqual(sections.map(section=>parseInt(section.style.width)),[112,112,112,864],'Minified widths match opponent battlefield banners');assert.equal(accordion.veil.getLocalBounds().y,32,'Collapse veil never covers zone headers');assert.equal(accordion.dividers.root.y,32);assert.equal(accordion.root.parent,renderer.decorationLayer);
const lateHost=host(new DOMRect(0,482,112,300));builder.append(lateHost);const late=await makeScene(lateHost,{...props,layout:limitedLayout([cards[2]],420,130,'none',()=>null),selectedIds:[]});assert.equal(late.root.parent,renderer.cardsLayer,'New destination pane stays below existing fog');assert.ok(renderer.app.stage.getChildIndex(renderer.cardsLayer)<renderer.app.stage.getChildIndex(renderer.decorationLayer));assert.ok(renderer.app.stage.getChildIndex(renderer.flightsLayer)<renderer.app.stage.getChildIndex(renderer.decorationLayer),'Pick flights enter beneath fog');renderer.flyCard(scene,scene.entries.get(cards[0].id).image,()=>lateHost);assert.equal(renderer.flights.size,1);for(const flight of renderer.flights)assert.equal(flight.sprite.parent,renderer.flightsLayer);renderer.cancelFlights();
reduced=true;accordion.update([true,true,true,true]);accordion.layout(16);assert.deepEqual(sections.map(section=>parseInt(section.style.width)),[300,300,300,300],'Reduced motion snaps the complete accordion');reduced=false;accordion.frame();assert.ok(gsap.getTweensOf(accordion.dividers.fogAuraGfx).length>0,'Shared fog aura animation runs');assert.equal(accordion.dividers.fogParticleGroups.length,3);assert.ok(accordion.dividers.fogParticleGroups.every(group=>group.particles.length===7));accordion.destroy();for(const current of scenes)current.destroy();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(texture.destroyed,false,'Shared card texture survives drag and teardown');assert.deepEqual(errors,[]);
const store=useLimitedBuildStore.getState();store.sync('fresh',cards);assert.equal(useLimitedBuildStore.getState().sessions.fresh.group,'none');store.preferences('fresh',{group:'type'});store.sync('fresh',[...cards,{...cards[0],id:'additional'}]);assert.equal(useLimitedBuildStore.getState().sessions.fresh.group,'type','Existing grouping choice survives pool updates');store.sync('ui',cards,[cards[1]],[cards[2]]);store.preferences('ui',{mode:'list'});const allocationBefore=JSON.stringify(useLimitedBuildStore.getState().sessions.ui.allocation);
window.matchMedia=query=>({get matches(){return query.includes('min-width')||query.includes('reduced-motion')&&reduced},media:query,addEventListener(){},removeEventListener(){}});
let root=createRoot(document.getElementById('root'));
async function renderBuilder(){await act(()=>root.render(React.createElement(LimitedDeckBuilder,{sessionKey:'ui',pool:cards,initialMain:[cards[1]],initialSideboard:[cards[2]]})));}
function panel(id){return document.querySelector('[data-limited-section="'+id+'"]');}
function headers(){return ['pool','main','sideboard','maybe'].map(id=>panel(id).querySelector('header button').getAttribute('aria-expanded'));}
async function remount(){await act(()=>root.unmount());root=createRoot(document.getElementById('root'));await renderBuilder();}
await renderBuilder();assert.deepEqual(headers(),['true','false','false','false']);for(const [id,count]of [['pool',2],['main',1],['sideboard',1],['maybe',0]]){assert.ok(panel(id).querySelector('header').textContent.includes(String(count)));assert.ok(panel(id).querySelector('header button[aria-label]'),'Every minified section retains an expand toggle');}
for(const id of ['pool','main','sideboard','maybe']){await act(()=>panel(id).querySelector('header button[aria-label]').click());const iconState=headers();await remount();await act(()=>panel(id).querySelector('header button').click());assert.deepEqual(headers(),iconState,'Icon and header have identical transitions in '+id);await remount();}
await act(()=>{const row=panel('pool').querySelector('button[aria-pressed]');row.focus();row.dispatchEvent(new window.KeyboardEvent('keydown',{key:'a',ctrlKey:true,bubbles:true}));});assert.equal(panel('pool').querySelectorAll('button[aria-pressed=true]').length,2);assert.equal(panel('main').querySelectorAll('button[aria-pressed=true]').length,0,'Select all excludes minified cards');assert.equal(JSON.stringify(useLimitedBuildStore.getState().sessions.ui.allocation),allocationBefore,'Layout controls preserve allocations');await act(()=>root.unmount());
const score=require('@/lib/gauntletReturn');const state={gauntletId:'score',currentRound:0,wins:0,losses:0};score.configureGauntlet(state,'draft',3);assert.deepEqual(score.gauntletScore({...state,wins:1,losses:1}),{wins:1,losses:1,matchOver:false});assert.equal(score.gauntletScore({...state,wins:2,losses:1}).matchOver,true);assert.equal(score.gauntletScore({...state,wins:1,losses:2}).matchOver,true);score.configureGauntlet(state,'draft',1);assert.equal(score.gauntletScore({...state,wins:1}).matchOver,true);
gsap.globalTimeline.clear();gsap.ticker.sleep();console.log('PASS: accordion widths/easing, header-safe fog, shared particles, late-pane/pick layering, cross-zone/offscreen grouped drag, simultaneous cancellation, reduced motion, marquee/shift/cancellation/clipping, real React header/icon parity, collapsed counts, scoped select-all, grouping preferences, best-of-three scoring');process.exit(0);
}catch(error){console.error(error);gsap.globalTimeline.clear();gsap.ticker.sleep();process.exit(1);}})();
