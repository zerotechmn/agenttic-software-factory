import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../', import.meta.url));
const {chromium}=await import(root+'/office/node_modules/playwright/index.mjs');
const {startConsole}=await import(root+'/src/console/server.ts');
const {newState,saveState}=await import(root+'/src/state.ts');
const dir=mkdtempSync(join(tmpdir(),'world-workspace-'));
for(const name of ['alpha','beta']){
 const path=join(dir,name);mkdirSync(join(path,'docs'),{recursive:true});
 const state=newState(name);state.phase='product';state.tasks=[{id:'T1',title:`${name} feature`,description:'Implement the feature',status:'blocked',attempts:2,escalations:0,kind:'feature',deps:[],lanes:['src/app.ts'],acceptance:['Works for users'],featureIds:['F1'],blocked:'Waiting for contract',feedback:'Add validation'}];saveState(path,state);
 writeFileSync(join(path,'docs/prd.json'),JSON.stringify({product:`${name} product`,pitch:'A useful product',users:['Operators'],features:[{id:'F1',title:'Feature one',priority:'must',acceptance:['Works for users']}],openQuestions:[{id:'Q1',question:'Support dates?',assumption:'No dates'}]}));
 writeFileSync(join(path,'docs/brief.md'),`# ${name} brief\n<script>window.BAD=true</script>`);
}
const server=await startConsole({root:dir,port:0,spawn:()=>{}});
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(server.url+'/world/?run=alpha');
 await page.getByRole('button',{name:'PRD',exact:true}).click();
 await page.getByRole('heading',{name:'alpha product',exact:true}).waitFor();
 await page.getByLabel('Your answers',{exact:true}).fill('Q1: yes, support dates');
 await page.getByRole('button',{name:'Send answers to Product'}).click();
 await page.getByText('Answers sent to Product.',{exact:true}).waitFor();
 assert.match(readFileSync(join(dir,'alpha/.forge/inbox.jsonl'),'utf8'),/support dates/);
 await page.getByRole('button',{name:'Tasks',exact:true}).click();
 await page.getByRole('button',{name:'T1 alpha feature blocked'}).click();
 await page.getByText('Waiting for contract',{exact:true}).waitFor();await page.getByText('src/app.ts',{exact:true}).waitFor();
 await page.getByRole('button',{name:'All tasks',exact:false}).click();
 await page.getByLabel('Title',{exact:true}).fill('New feature');await page.getByLabel('Details',{exact:true}).fill('Build the feature');
 await page.route('**/task?run=alpha',route=>route.fulfill({status:500,body:'failed'}));
 await page.getByRole('button',{name:'Add to backlog',exact:true}).click();await page.getByRole('alert').filter({hasText:'Could not send'}).waitFor();assert.equal(await page.getByLabel('Title',{exact:true}).inputValue(),'New feature');
 await page.unroute('**/task?run=alpha');await page.getByRole('button',{name:'Add to backlog',exact:true}).click();await page.getByText('Queued. The factory picks it up on its next build step.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Docs',exact:true}).click();await page.getByRole('button',{name:'Brief docs/brief.md',exact:false}).click();await page.locator('.workspace-document').getByText('# alpha brief',{exact:false}).waitFor();assert.equal(await page.evaluate(()=>window.BAD),undefined);
 const href=await page.getByRole('link',{name:'Download document'}).getAttribute('href');assert.match(href,/run=alpha/);assert.match(await (await fetch(server.url+href)).text(),/alpha brief/);
 await page.getByRole('button',{name:'All documents',exact:false}).click();await page.getByRole('combobox',{name:'Select run'}).selectOption('beta');await page.getByRole('button',{name:'Brief docs/brief.md',exact:false}).click();await page.locator('.workspace-document').getByText('# beta brief',{exact:false}).waitFor();
 await page.getByRole('button',{name:'PRD',exact:true}).click();await page.getByRole('heading',{name:'beta product',exact:true}).waitFor();
 const state=newState('beta');state.phase='build';state.done=['product'];saveState(join(dir,'beta'),state);
 await page.getByRole('button',{name:'Send as a change request'}).waitFor();
 await page.locator('#prd-answers').fill('Q1: revised answer');await page.getByRole('button',{name:'Send as a change request'}).click();await page.getByText('Queued in the backlog for the factory.',{exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Docs',exact:true}).click();await page.screenshot({path:'/tmp/forge-world-workspace-mobile.png'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.getByRole('button',{name:'Try demo'}).click();await page.getByText('Documents are available in live mode',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log('PASS: PRD answers/change requests, task details/backlog with failure+retry, safe docs/view/download, run switching, demo and mobile.');
}finally{await browser.close();await server.close();}
