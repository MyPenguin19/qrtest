/* eslint-disable @typescript-eslint/no-require-imports -- Optional local browser test tools; no new dependencies. */
const esbuild=require(process.env.ESBUILD_MODULE||'esbuild');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const http=require('node:http'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const {compile}=require('@tailwindcss/node');
const {Scanner}=require('@tailwindcss/oxide');
(async()=>{
 const root=path.resolve(__dirname,'../..'),adapter=path.join(__dirname,'cart-adapters.tsx');
 const {outputFiles}=await esbuild.build({entryPoints:[path.join(__dirname,'cart-fixture.tsx')],bundle:true,write:false,jsx:'automatic',alias:{'@':path.join(root,'src'),'next/navigation':adapter,'@/app/actions/orders':adapter}});
 const cssPath=path.join(root,'src/app/globals.css');
 const compiler=await compile(fs.readFileSync(cssPath,'utf8'),{base:path.dirname(cssPath),onDependency:()=>{}});
 const scanner=new Scanner({sources:[{base:path.join(root,'src'),pattern:'**/*.{tsx,ts}',negated:false}]});
 const css=compiler.build(scanner.scan());
 const calls=[];let mode='unknown';let passed=0;
 const pass=(s)=>{passed++;console.log('PASS '+s);};
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/bundle.js'){res.setHeader('content-type','text/javascript');return res.end(outputFiles[0].text);}
  if(req.url==='/style.css'){res.setHeader('content-type','text/css');return res.end(css);}
  if(req.url==='/order'){let body='';for await(const part of req)body+=part;calls.push(JSON.parse(body));await new Promise(r=>setTimeout(r,150));res.setHeader('content-type','application/json');if(mode==='unknown'){res.statusCode=503;return res.end('{}');}return res.end(JSON.stringify(mode==='reject'?{error:'Item is unavailable.'}:{orderId:'order-1',tabUrl:'/menu/cafe/main/table-1/tab?session=original-visit'}));}
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const url=`http://127.0.0.1:${server.address().port}`;
  const size=async locator=>{await locator.scrollIntoViewIfNeeded();await page.waitForTimeout(300);const b=await locator.boundingBox();assert.ok(b&&b.width>=43.9&&b.height>=43.9,JSON.stringify(b));};
  const fits=async()=>{const d=page.getByRole('dialog');const b=await d.boundingBox();const v=page.viewportSize();assert.ok(b.x>=0&&b.y>=-1&&b.x+b.width<=v.width+1&&b.y+b.height<=v.height+1,JSON.stringify({b,v}));assert.equal(await d.evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);};
  for(const [width,height] of [[320,568],[390,844],[768,1024],[1440,900]]){
   await page.setViewportSize({width,height});await page.goto(url);await page.getByRole('button',{name:'Choose coffee'}).click();await page.getByRole('dialog').waitFor();await page.waitForTimeout(250);await fits();
   assert.equal(await page.getByRole('dialog').locator('img').count(),0);
   await size(page.getByRole('button',{name:'Increase quantity',exact:true}));await size(page.getByRole('button',{name:'Decrease quantity',exact:true}));await size(page.getByRole('button',{name:'Close',exact:true}));
   await page.getByRole('radio',{name:'Large'}).check();await page.getByRole('checkbox',{name:'Oat milk'}).check();await page.getByRole('button',{name:'Increase quantity',exact:true}).click();
   const add=page.getByRole('button',{name:'Add to cart · ₹34',exact:true});await size(add);await add.click();
   const cart=page.getByRole('button',{name:/View cart/});await size(cart);await cart.click();await page.waitForTimeout(250);await fits();
   await size(page.getByRole('button',{name:/Remove .* from cart/}).first());await size(page.getByRole('button',{name:/Increase quantity of/}).first());await size(page.getByRole('button',{name:'Place order',exact:true}));
   assert.match(await page.getByRole('dialog').innerText(),/Unsubmitted items on this device/);await page.getByRole('button',{name:'Close',exact:true}).click();
   await page.evaluate(()=>localStorage.clear());pass(`${width}px: real CSS, targets, wrapping, missing image and unchanged variant/add-on calculation`);
  }
  const key='qrcr_cart_v3:cafe:main:table-1:original-visit';
  await page.evaluate(key=>{const lines=Array.from({length:30},(_,i)=>({key:`line-${i}`,itemId:'coffee',itemName:`Long item ${i} with wrapping description`,isVeg:true,variantId:'large',variantName:'Large',unitPrice:15,addons:[{id:'milk',name:'Oat milk',price:2}],quantity:1,specialInstructions:'No sugar'}));localStorage.setItem(key,JSON.stringify({lines,submissionKey:'stable-key'}));},key);
  await page.setViewportSize({width:320,height:568});await page.reload();await page.getByRole('button',{name:/View cart/}).click();await page.waitForTimeout(250);await fits();
  const place=page.getByRole('button',{name:'Place order',exact:true});const box=await place.boundingBox();assert.ok(box.y+box.height<=568);
  await page.getByLabel('Mobile (optional)').fill('555');await page.setViewportSize({width:320,height:360});await page.waitForTimeout(250);await fits();
  const short=await place.boundingBox();assert.ok(short.y+short.height<=360);pass('30-line cart: scrollable fields and reachable checkout in reduced viewport');
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);
  await page.evaluate(()=>{window.addEventListener('fixture-navigation',e=>{window.fixtureDestination=e.detail;});});
  await place.click();await page.getByRole('button',{name:'Placing order…'}).waitFor();await page.getByRole('alert').waitFor();
  assert.equal(calls.length,1);assert.equal(calls[0].submissionKey,'stable-key');assert.equal(calls[0].tableSessionToken,'original-visit');assert.equal(calls[0].lines.length,30);assert.equal(await page.getByRole('button',{name:/Increase quantity of/}).first().isDisabled(),true);
  mode='success';await place.click();await page.getByRole('dialog').waitFor({state:'hidden'});assert.deepEqual(calls[1],calls[0]);assert.equal(await page.evaluate(()=>window.fixtureDestination),'/menu/cafe/main/table-1/tab?session=original-visit');
  assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).lines.length,key),0);pass('unknown-result retry retains exact key/payload/visit and success clears cart at unchanged destination');
  await page.getByRole('button',{name:'Choose coffee'}).click();await page.getByRole('button',{name:/Add to cart/}).click();await page.getByRole('button',{name:/View cart/}).click();mode='reject';await place.click();await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').innerText(),/Item is unavailable/);assert.equal(await page.getByRole('button',{name:/Increase quantity of/}).first().isEnabled(),true);pass('server rejection announced and cart remains editable');
  await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.getByRole('button',{name:/View cart/}).focus();await page.keyboard.press('Enter');await page.getByRole('dialog').waitFor();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>!!document.activeElement.closest('[role="dialog"]')),true);await page.keyboard.press('Escape');pass('keyboard opens/closes cart and focus stays inside the dialog');
  assert.deepEqual(errors,[]);console.log(`${passed} checks passed; 0 failed`);
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
