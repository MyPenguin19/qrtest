/* eslint-disable @typescript-eslint/no-require-imports -- Local Chrome fixtures only. */
const esbuild=require(process.env.ESBUILD_MODULE||'esbuild');const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const http=require('node:http'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'../..'),adapter=path.join(__dirname,'platform-adapters.tsx');
 const {outputFiles}=await esbuild.build({entryPoints:[path.join(__dirname,'platform-fixture.tsx')],bundle:true,write:false,jsx:'automatic',alias:{'@':path.join(root,'src'),'next/link':adapter,'next/navigation':adapter,'@/app/actions/auth':adapter,'@/lib/platform-reporting':adapter}});
 const css=fs.readdirSync(path.join(root,'.next/static/css')).filter(f=>f.endsWith('.css')).map(f=>fs.readFileSync(path.join(root,'.next/static/css',f),'utf8')).join('\n');
 const server=http.createServer((req,res)=>{if(req.url==='/bundle.js'){res.setHeader('content-type','text/javascript');res.end(outputFiles[0].text);}else if(req.url==='/style.css'){res.setHeader('content-type','text/css');res.end(css);}else res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try {
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const width of [390,768,1280])for(const route of ['/platform','/platform/restaurants','/platform/restaurants/00000000-0000-0000-0000-000000000001','/platform/analytics']){
   await page.setViewportSize({width,height:900});await page.goto(base+route);await page.getByRole('heading',{level:1}).waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${route} overflow at ${width}`);
   assert.match(await page.locator('main').innerText(),/Reporting timezone: UTC/);
   assert.equal(await page.getByRole('navigation',{name:'Platform navigation'}).count(),1);
   console.log(`PASS platform layout ${width}px ${route}`);
  }
  await page.goto(base+'/platform/restaurants');await page.getByLabel('Restaurant or verified owner email').fill('Cafe & Tea');await page.getByLabel('Reporting period').selectOption('7');await page.getByLabel('Filter',{exact:true}).selectOption('ready');await page.getByLabel('Per page').selectOption('50');
  await page.getByRole('button',{name:'Apply / refresh'}).click();await page.waitForURL(/q=Cafe/);assert.equal(new URL(page.url()).searchParams.get('filter'),'ready');assert.equal(await page.getByLabel('Reporting period').inputValue(),'7');
  assert.match(await page.getByRole('link',{name:'Next',exact:true}).getAttribute('href'),/size=50/);console.log('PASS directory accessible filters and pagination preserve query');
  await page.goto(base+'/platform/restaurants?empty=1');await page.getByText('No restaurants on this page match your filters.',{exact:false}).waitFor();console.log('PASS directory empty state');
  await page.goto(base+'/error');await page.getByRole('button',{name:'Try again'}).click();await page.getByText('Retry requested').waitFor();console.log('PASS generic retryable error state');
  await page.goto(base+'/loading');await page.getByRole('status').waitFor();console.log('PASS accessible loading state');
  await page.goto(base+'/platform/analytics');await page.getByRole('heading',{level:1}).waitFor();await page.getByText('Exact daily values',{exact:true}).first().click();assert.ok(await page.getByText('2026-10-07',{exact:true}).first().isVisible());console.log('PASS chart exact values accessible');
  assert.deepEqual(errors,[]);
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
