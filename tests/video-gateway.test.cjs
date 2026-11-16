const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createGateway,validate}=require('../server/video-gateway.cjs');
const {endpoint,signature}=require('../assets/product-workflow.js');
const secret='test-only-private-token-0123456789';
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7ioAAAAASUVORK5CYII=';
const payload={image,prompt:'A slow rear-facing walk. Preserve garment details.',duration:5,aspect:'9:16',product:{name:'棉麻裤',sku:'AL-1'},view:'back',confirmed:true,consent:true};
async function harness(t,options={}) {
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'along-video-test-'));
  let calls=[];
  const app=createGateway({providerKey:'test-provider-secret',token:secret,creditsPerSecond:5,dataDir,fetch:async(url,init)=>{calls.push({url,init});return Response.json(url.endsWith('image_to_video')?{id:'12345678-1234-1234-1234-123456789012'}:{status:'SUCCEEDED',progress:1,output:['https://example.com/result.mp4','javascript:bad']});},...options});
  await app.loaded;await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));await fs.rm(dataDir,{recursive:true,force:true});});
  const request=(route,init={})=>fetch(base+route,{...init,headers:{Origin:'http://127.0.0.1:8765',Authorization:'Bearer '+secret,...init.headers}});
  const submit=(body=payload,id='test-key-1234567890')=>request('/api/jobs',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify(body)});
  return{app,request,submit,calls,dataDir};
}
test('gateway advertises configuration and authenticates before accepting uploads',async t=>{
  const h=await harness(t);const cap=await(await h.request('/api/capabilities')).json();assert.equal(cap.ready,true);assert.equal(cap.creditsPerSecond,5);
  assert.equal((await h.request('/api/session')).status,200);
  assert.equal((await h.request('/api/session',{headers:{Authorization:'Bearer wrong'}})).status,401);
  assert.equal((await h.request('/api/capabilities',{headers:{Origin:'https://unrelated.example'}})).status,403);
  assert.equal(h.calls.length,0);
});
test('unconfigured service cannot spend credits',async t=>{
  const h=await harness(t,{providerKey:''});assert.equal((await(await h.request('/api/capabilities')).json()).ready,false);
  assert.equal((await h.submit()).status,503);assert.equal(h.calls.length,0);
});
test('idempotent creation forwards only supported model inputs and never saves the photo or keys',async t=>{
  const h=await harness(t);const first=await h.submit();assert.equal(first.status,202);const row=await first.json();
  assert.equal(row.estimatedCredits,25);assert.equal(row.status,'PENDING');
  const duplicate=await(await h.submit()).json();assert.equal(duplicate.id,row.id);assert.equal(h.calls.length,1);
  const remote=JSON.parse(h.calls[0].init.body);assert.equal(remote.model,'gen4_turbo');assert.equal(remote.ratio,'720:1280');assert.equal(remote.promptImage,image);
  assert.equal(remote.product,undefined);assert.equal(remote.view,undefined);
  assert.equal((await h.submit({...payload,prompt:'different'})).status,409);
  const disk=await fs.readFile(path.join(h.dataDir,'jobs.json'),'utf8');assert.doesNotMatch(disk,/base64|test-provider-secret|test-only-private-token|promptImage/);
  const done=await(await h.request('/api/jobs/'+row.id)).json();assert.equal(done.status,'SUCCEEDED');assert.deepEqual(done.output,['https://example.com/result.mp4']);
});
test('invalid parameters, fake images or missing consent never reach the supplier',async t=>{
  const h=await harness(t);
  for(const patch of [{duration:30},{aspect:'2:3'},{confirmed:false},{consent:false},{image:'data:image/png;base64,YmFk'},{prompt:'x'.repeat(1001)},{product:{name:'',sku:''}},{view:'orbit'}])assert.equal((await h.submit({...payload,...patch})).status,400);
  assert.equal(h.calls.length,0);assert.throws(()=>validate({...payload,image:undefined}));
});
test('network failure marks ambiguous submissions and repeat clicks cannot bill again',async t=>{
  let calls=0;const h=await harness(t,{fetch:async()=>{calls++;throw Error('provider timeout');}});
  const row=await(await h.submit()).json();assert.equal(row.status,'SUBMISSION_UNKNOWN');
  const duplicate=await(await h.submit()).json();assert.equal(duplicate.id,row.id);assert.equal(calls,1);
});
test('only two pending generations can be created',async t=>{
  const h=await harness(t);assert.equal((await h.submit(payload,'request-key-00000001')).status,202);assert.equal((await h.submit(payload,'request-key-00000002')).status,202);assert.equal((await h.submit(payload,'request-key-00000003')).status,429);assert.equal(h.calls.length,2);
});
test('task store restores task IDs after restart',async t=>{
  const h=await harness(t);const row=await(await h.submit()).json();const second=createGateway({dataDir:h.dataDir});await second.loaded;assert.equal(second.jobs.get(row.id).providerId,'12345678-1234-1234-1234-123456789012');
});
test('service URL and review fingerprints reject unsafe addresses and invalidate changed products',()=>{
  assert.equal(endpoint('http://127.0.0.1:8787/'),'http://127.0.0.1:8787');assert.equal(endpoint('https://video.example.com/'),'https://video.example.com');
  for(const value of ['http://public.example','javascript:alert(1)','https://name:password@example.com','https://example.com/?secret=x'])assert.throws(()=>endpoint(value));
  const c={pose:'P13',crop:'full',product:{name:'第一款',sku:'A'}};assert.notEqual(signature(c),signature({...c,pose:'P1'}));assert.notEqual(signature(c),signature({...c,product:{name:'第二款',sku:'B'}}));assert.equal(signature(c),signature({...c,video:{duration:10}}));
});

test('concurrent clicks with the same submission key create only one supplier task',async t=>{
  const h=await harness(t);const [a,b]=await Promise.all([h.submit(),h.submit()]);
  const rows=await Promise.all([a.json(),b.json()]);assert.equal(rows[0].id,rows[1].id);assert.equal(h.calls.length,1);
});
test('supplier polling is throttled and a crash during submission is never automatically resubmitted',async t=>{
  const h=await harness(t);const row=await(await h.submit()).json();
  await h.request('/api/jobs/'+row.id);await h.request('/api/jobs/'+row.id);assert.equal(h.calls.length,2);
  const disk=JSON.parse(await fs.readFile(path.join(h.dataDir,'jobs.json'),'utf8'));disk[0].status='SUBMITTING';delete disk[0].providerId;
  await fs.writeFile(path.join(h.dataDir,'jobs.json'),JSON.stringify(disk));
  let calls=0;const restored=createGateway({dataDir:h.dataDir,fetch:async()=>{calls++;throw Error('must not call');}});await restored.loaded;
  assert.equal(restored.jobs.get(row.id).status,'SUBMISSION_UNKNOWN');assert.equal(calls,0);
});
