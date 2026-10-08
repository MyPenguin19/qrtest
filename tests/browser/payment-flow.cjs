/* eslint-disable @typescript-eslint/no-require-imports -- Optional Chrome component test runner. */
// ESBUILD_MODULE and PLAYWRIGHT_MODULE may point to externally installed test tools.
const esbuild=require(process.env.ESBUILD_MODULE||'esbuild');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
  const root=path.resolve(__dirname,'../..');
  const adapter=path.join(__dirname,'payment-adapters.tsx');
  const {outputFiles}=await esbuild.build({entryPoints:[path.join(__dirname,'payment-fixture.tsx')],bundle:true,write:false,jsx:'automatic',alias:{'@':path.join(root,'src'),'next/navigation':adapter,'next/link':adapter,'@/app/actions/dining':adapter,'@/app/actions/staff-ops':adapter}});
  const calls=[];let rejectCounter=false,rejectManual=false;
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/bundle.js'){res.setHeader('content-type','text/javascript');return res.end(outputFiles[0].text);}
    if(req.method==='POST'){
      let body='';for await(const chunk of req)body+=chunk;calls.push({url:req.url,input:JSON.parse(body)});
      res.setHeader('content-type','application/json');
      return res.end(JSON.stringify({error:(req.url==='/counter'?rejectCounter:rejectManual)?'Your table session has ended.':null}));
    }
    res.end('<!doctype html><html><head><title>Payment component tests</title></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser=await chromium.launch({channel:'chrome',headless:true});
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('button',{name:'Pay Now',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Pay by Card',exact:true}).isDisabled(),true);
    assert.match(await page.getByRole('dialog').innerText(),/Online card payment is unavailable/);
    assert.equal(calls.length,0);console.log('PASS Pay Now is optional and unavailable card checkout makes no payment request');
    assert.equal(await page.getByRole('link',{name:'Keep Ordering'}).getAttribute('href'),'/menu/a/main/table?session=original-signed-visit');
    await page.getByRole('button',{name:'Close',exact:true}).click();assert.equal(calls.length,0);console.log('PASS dismiss and Keep Ordering retain the same visit without mutations');
    await page.getByRole('button',{name:'Pay Now',exact:true}).click();rejectCounter=true;
    await page.getByRole('button',{name:'Pay at Counter',exact:true}).click();
    await page.getByRole('dialog').getByRole('alert').waitFor();assert.match(await page.getByRole('alert').innerText(),/session has ended/);assert.equal(await page.getByRole('heading',{name:'Pay at Counter',exact:true}).count(),0);
    console.log('PASS stale counter action displays server rejection without a success message');
    rejectCounter=false;await page.getByRole('button',{name:'Pay at Counter',exact:true}).click();
    await page.getByRole('status').first().waitFor();assert.match(await page.getByRole('status').first().innerText(),/30.00/);assert.match(await page.getByRole('status').first().innerText(),/table is still open/);
    assert.equal(calls.at(-1).input.token,'original-signed-visit');await page.getByText('PAY AT COUNTER',{exact:true}).waitFor();console.log('PASS counter confirmation uses refreshed total and staff sees intent');
    await page.reload();
    await page.getByRole('button',{name:'Close Tab',exact:true}).click();
    assert.match(await page.getByRole('dialog').innerText(),/does not verify an external payment/);
    await page.getByRole('button',{name:'Keep table open'}).click();assert.equal(calls.filter(c=>c.url==='/manual').length,0);
    await page.getByRole('button',{name:'Close Tab',exact:true}).click();await page.getByLabel('Closure reason').selectOption('manual_unsettled');rejectManual=true;
    await page.getByRole('button',{name:'Confirm manual closure'}).click();await page.getByRole('dialog').getByRole('alert').waitFor();console.log('PASS manual closure requires an explicit choice and reports server errors');
    rejectManual=false;await page.getByRole('button',{name:'Confirm manual closure'}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
    const manual=calls.at(-1).input;assert.equal(manual.action,'manual_close');assert.equal(manual.sessionId,'visit-A');assert.equal(manual.closureReason,'manual_unsettled');console.log('PASS staff closes without customer payment intent using original visit and chosen reason');
    await page.reload();
    const card=page.locator('[data-table-id="table"]');
    assert.equal(await card.count(),1);assert.match(await card.getByRole('region',{name:'New rounds'}).innerText(),/Burger/);
    assert.equal(await card.getByText('Coke × 2').isVisible(),false);assert.equal(await card.getByRole('button',{name:'Request bill',exact:true}).count(),0);
    await page.getByRole('button',{name:'Fixture: add Latte round'}).click();
    assert.equal(await card.count(),1);assert.match(await card.getByRole('region',{name:'New rounds'}).innerText(),/Latte/);console.log('PASS one active card retains new rounds and collapsed completed work');
    await card.locator('[data-order-id="round2"]').getByRole('button',{name:'Mark Round Ready'}).click();
    await card.getByRole('region',{name:'Ready rounds'}).waitFor();
    assert.match(await card.getByRole('region',{name:'Ready rounds'}).innerText(),/Burger/);assert.doesNotMatch(await card.getByRole('region',{name:'New rounds'}).innerText(),/Burger/);
    await card.locator('[data-order-id="round2"]').getByRole('button',{name:'Mark Round Served'}).click();
    await card.getByText('Completed (2 rounds)').waitFor();assert.match(await card.getByRole('region',{name:'New rounds'}).innerText(),/Latte/);console.log('PASS round fulfillment uses Ready then Served without affecting another round');
    await card.getByRole('button',{name:'View Tab',exact:true}).click();
    const detail=page.getByRole('dialog');assert.match(await detail.innerText(),/Coke/);assert.match(await detail.innerText(),/Burger/);assert.match(await detail.innerText(),/Latte/);assert.match(await detail.innerText(),/30.00/);
    await detail.getByRole('button',{name:'Close Tab',exact:true}).click();await page.getByRole('button',{name:'Confirm manual closure'}).click();
    await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(await page.locator('[data-session-id="visit-A"]').count(),0);assert.match(await card.innerText(),/Available/);assert.doesNotMatch(await card.innerText(),/Coke|Burger|Latte/);console.log('PASS View Tab contains history and closure leaves an empty available table');
    await page.reload();
    await card.locator('[data-order-id="round2"]').getByRole('button',{name:'Mark Round Ready'}).click();
    await card.locator('[data-order-id="round2"]').getByRole('button',{name:'Mark Round Served'}).click();
    await card.getByText('Completed (2 rounds)').waitFor();
    assert.equal(await card.getByRole('button',{name:'Start payment',exact:true}).count(),0);
    await card.getByLabel('Counter payment method').selectOption('card');
    await card.getByRole('button',{name:'Record Payment',exact:true}).click();
    await card.getByRole('button',{name:'Record external payment received',exact:true}).waitFor();
    assert.equal(calls.at(-1).input.method,'card');
    assert.match(await card.innerText(),/Payment Pending/);
    assert.equal(await card.getByRole('button',{name:'Close Tab',exact:true}).count(),0);
    const firstAttempt=calls.at(-1).input.attemptKey;
    await card.getByRole('button',{name:'Payment not received / Retry',exact:true}).click();
    await card.getByRole('button',{name:'Record Payment',exact:true}).waitFor();
    assert.equal(await page.locator('[data-session-id="visit-A"]').count(),1);
    await card.getByRole('button',{name:'Record Payment',exact:true}).click();
    await card.getByRole('button',{name:'Record external payment received',exact:true}).waitFor();
    assert.notEqual(calls.at(-1).input.attemptKey,firstAttempt);
    rejectManual=true;
    await card.getByRole('button',{name:'Record external payment received',exact:true}).click();
    await card.getByRole('alert').waitFor();
    assert.equal(await page.locator('[data-session-id="visit-A"]').count(),1);
    console.log('PASS Record Payment retains selector; pending, failed, retried and rejected confirmation keep the table open');
    rejectManual=false;
    await card.getByRole('button',{name:'Record external payment received',exact:true}).click();
    await card.getByText('Available',{exact:true}).waitFor();
    assert.equal(calls.at(-1).input.action,'confirm_payment');
    assert.equal(await page.getByRole('dialog').count(),0);
    assert.equal(await page.locator('[data-session-id="visit-A"]').count(),0);
    console.log('PASS successful external receipt refreshes directly to Available without Close Tab or extra confirmation');
    assert.deepEqual(errors,[]);
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
