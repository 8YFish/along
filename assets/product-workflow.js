/* Local product review and optional private video gateway client. */
(function(root){
  'use strict';
  function signature(c) { return JSON.stringify([c.gender,c.pose,c.crop,c.back,c.personaCn,c.buildCn,c.sceneCn,c.frameCn,c.productCn,c.productEn,c.noteCn,c.noteEn,c.product]); }
  function endpoint(value) {
    const url=new URL(value);
    if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))) throw Error('请使用 HTTPS 服务地址，或本机 HTTP 地址。');
    return url.href.replace(/\/$/,'');
  }
  function mount(api) {
    const $=id=>document.getElementById(id);
    const gallery=new Map();let confirmed='',hero=null,connection=null,currentJob=null,timer=null,errors=0,submitting=false,connectionRevision=0,retrySalt='';
    const storageKey='along.jobs.v1.'+api.gender;
    const panel=document.createElement('section');panel.className='studio-product-review';
    panel.innerHTML=`<div class="studio-video-heading"><div><h3>商品档案 · 先确认主图</h3><p>同款正面、背面和细节放在一起，检查主图后再做视频。图片仅在当前页面预览，提交生成前不会上传。</p></div><span class="studio-badge">1 商品 → 2 主图 → 3 视频</span></div>
      <div class="studio-product-fields"><label>商品名称<input id="productName" maxlength="80" placeholder="例如：秋季棉麻直筒长裤"></label><label>货号 / SKU（可选）<input id="productSku" maxlength="80" placeholder="例如：AL-001"></label></div>
      <details><summary>添加正面、背面和细节参考</summary><div class="studio-product-photos" id="productPhotoSlots"></div><p class="studio-fine">照片不会上传或随方案保存。更换商品前请点“清空当前图片”，避免混用不同款。</p><button type="button" id="resetProductPhotos">清空当前图片</button></details>
      <p class="studio-fine" id="productSaveNote">商品名称和货号随方案保存。刷新后图片和主图确认状态需要重新选择。</p>`;
    $('quickStudio').querySelector('.studio-output').after(panel);
    for(const [kind,label] of [['front','正面'],['back','背面'],['detail','细节']]) {
      const slot=document.createElement('label');slot.innerHTML=label+'参考图<input type="file" accept="image/jpeg,image/png,image/webp"><img alt="'+label+'商品参考图" hidden><span class="studio-fine"></span>';
      const input=slot.querySelector('input'),image=slot.querySelector('img'),note=slot.querySelector('span');
      let request=0;
      input.onchange=async()=>{const file=input.files[0];if(!file)return;const ticket=++request;try{
        const value=await decode(file);if(ticket!==request){URL.revokeObjectURL(value.url);return;}
        if(gallery.has(kind))URL.revokeObjectURL(gallery.get(kind).url);gallery.set(kind,value);image.src=value.url;image.hidden=false;note.textContent=file.name;invalidate();update();
      }catch(e){note.textContent=e.message;input.value='';}};
      slot.reset=()=>{request++;input.value='';image.removeAttribute('src');image.hidden=true;note.textContent='';};
      $('productPhotoSlots').append(slot);
    }
    const review=document.createElement('div');review.className='studio-review';
    review.innerHTML=`<h4>确认视频首帧</h4><p>请先在上方选择完整的人物商品主图。图库动作照片只用于参考，不应代替你的商品主图。</p><label>主图展示方向<select id="heroView"><option value="front">正面</option><option value="side">侧面</option><option value="back">背面</option></select></label><div class="studio-review-checks"><label><input type="checkbox" data-review="person"> 人物、姿势和背景符合当前方案</label><label><input type="checkbox" data-review="garment"> 商品颜色、版型和长短正确</label><label><input type="checkbox" data-review="details"> 口袋、图案和细节已核对</label></div><button type="button" id="confirmHero">确认主图，准备视频</button><p id="heroReviewStatus" role="status" aria-live="polite"></p>`;
    $('videoReference').closest('.studio-reference').after(review);
    const jobPanel=document.createElement('section');jobPanel.className='studio-jobs';
    jobPanel.innerHTML=`<h4>生成视频任务</h4><p>已接入私有生成服务时，可把确认的主图提交给 Runway 生成视频。未连接时仍可复制视频提示词使用。</p><details><summary>连接生成服务</summary><label>服务地址<input id="gatewayUrl" type="url" placeholder="https://你的生成服务域名"></label><label>访问口令<input id="gatewayToken" type="password" autocomplete="off" placeholder="由服务管理员提供，仅保留在当前页面"></label><button type="button" id="connectGateway">连接并读取费用</button><p id="gatewayStatus" role="status"></p></details><p id="videoCost">尚未连接生成服务。</p><label class="studio-consent"><input type="checkbox" id="generationConsent"> 我同意本次把商品主图、名称货号和视频提示词发送到所连接服务及 Runway，并按显示费用创建生成任务。</label><button type="button" id="submitVideo" disabled>生成商品视频</button><p id="jobStatus" role="status" aria-live="polite"></p><button type="button" id="resumeJob" hidden>重新查询任务</button><button type="button" id="retryGeneration" hidden>准备重新生成（再次计费）</button><video id="generatedVideo" controls playsinline preload="metadata" hidden></video><a id="downloadVideo" target="_blank" rel="noopener noreferrer" hidden>打开视频并下载</a><p class="studio-fine">供应商视频链接会过期，请生成后及时下载。关闭页面不会取消已提交的任务；可在本浏览器重新连接后查询最近任务。</p>`;
    $('videoTimeline').after(jobPanel);
    try{const state=JSON.parse(localStorage.getItem(storageKey)||'null');if(state&&/^[a-f0-9-]{36}$/.test(state.id)&&typeof state.endpoint==='string'){currentJob=state;$('gatewayUrl').value=state.endpoint;$('resumeJob').hidden=false;$('jobStatus').textContent='发现最近任务，连接原服务后可继续查询。';}}catch(_){}
    async function decode(file) {
      if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024)throw Error('请选择不超过 10 MB 的 JPG、PNG 或 WebP。');
      const url=URL.createObjectURL(file),image=new Image();image.src=url;
      try{await image.decode();return{file,url,width:image.naturalWidth,height:image.naturalHeight};}catch(_){URL.revokeObjectURL(url);throw Error('图片无法打开，请重新选择。');}
    }
    function clearPhotos(){for(const value of gallery.values())URL.revokeObjectURL(value.url);gallery.clear();for(const slot of $('productPhotoSlots').children)slot.reset();api.clearReference();invalidate();}
    function invalidate(){confirmed='';for(const check of review.querySelectorAll('[data-review]'))check.checked=false;$('generationConsent').checked=false;}
    function isConfirmed(){return !!hero&&confirmed===signature(api.context())&&$('heroView').value===(api.context().back?'back':api.context().pose==='P12'?'side':'front');}
    function update(){
      const c=api.context(),product=c.product||{};
      if(document.activeElement!==$('productName'))$('productName').value=product.name||'';
      if(document.activeElement!==$('productSku'))$('productSku').value=product.sku||'';
      if(confirmed&&confirmed!==signature(c))invalidate();
      const imageMode=c.output==='video'&&c.video.source==='image';review.hidden=!imageMode;jobPanel.hidden=c.video.source!=='image';
      const expected=c.back?'back':c.pose==='P12'?'side':'front';
      const problems=api.issues();
      $('heroReviewStatus').textContent=isConfirmed()?'主图已确认，可连接服务生成视频。':!hero?'先选择一张完整商品主图，再核对下方三项。':!product.name?.trim()?'请先在商品档案中填写商品名称。':$('heroView').value!==expected?'主图方向与当前动作不一致，请切换动作或重新选择主图。':'请核对主图并完成三项确认。';
      $('confirmHero').disabled=!hero||!product.name?.trim()||$('heroView').value!==expected||problems.length>0||![...review.querySelectorAll('[data-review]')].every(x=>x.checked);
      $('submitVideo').disabled=submitting||!connection||!isConfirmed()||problems.length>0||!$('generationConsent').checked;
      $('videoCost').textContent=connection?'Runway / gen4_turbo · '+c.video.duration+' 秒 · 预计 '+(c.video.duration*connection.creditsPerSecond)+' credits。该估算由服务管理员配置，最终以供应商计费为准。':'尚未连接生成服务。';
      $('resumeJob').hidden=!currentJob;
    }
    $('productName').oninput=()=>{api.product({name:$('productName').value,sku:$('productSku').value});invalidate();update();};
    $('productSku').oninput=$('productName').oninput;
    $('resetProductPhotos').onclick=clearPhotos;
    review.querySelectorAll('input,select').forEach(input=>input.onchange=()=>{confirmed='';$('generationConsent').checked=false;update();});
    $('confirmHero').onclick=()=>{if(!$('confirmHero').disabled){confirmed=signature(api.context());update();}};
    $('generationConsent').onchange=update;
    async function json(url,init={}){const response=await fetch(url,{...init,signal:AbortSignal.timeout(60000)});let value;try{value=await response.json();}catch(_){throw Error('生成服务未返回有效 JSON，请确认服务地址。');}if(!response.ok)throw Error(value.message||'服务请求失败。');return value;}
    function disconnect(){connectionRevision++;connection=null;clearTimeout(timer);$('generationConsent').checked=false;update();}
    $('gatewayUrl').oninput=disconnect;$('gatewayToken').oninput=disconnect;
    $('connectGateway').onclick=async()=>{disconnect();const revision=connectionRevision;$('connectGateway').disabled=true;try{
      const base=endpoint($('gatewayUrl').value.trim()),secret=$('gatewayToken').value;
      const value=await json(base+'/api/capabilities');
      if(!value.ready)throw Error(value.reason||'生成服务尚未配置。');
      if(value.provider!=='Runway'||value.model!=='gen4_turbo'||!Number.isFinite(value.creditsPerSecond)||value.creditsPerSecond<=0||secret.length<24)throw Error('服务配置或访问口令不完整。');
      await json(base+'/api/session',{headers:{Authorization:'Bearer '+secret}});
      if(revision!==connectionRevision)return;
      connection={...value,base,secret};$('gatewayStatus').textContent='已读取服务配置，提交任务前请核对费用和上传授权。';
    }catch(e){if(revision===connectionRevision)$('gatewayStatus').textContent=e.message;}finally{$('connectGateway').disabled=false;update();}};
    function remember(row,service){try{localStorage.setItem(storageKey,JSON.stringify({id:row.id,endpoint:service.base}));}catch(_){}currentJob={id:row.id,endpoint:service.base};}
    function display(row){
      const names={SUBMITTING:'提交中',PENDING:'排队中',THROTTLED:'等待额度',RUNNING:'生成中',SUCCEEDED:'已完成',FAILED:'生成失败',CANCELLED:'已取消',SUBMISSION_UNKNOWN:'提交结果未确认'};
      $('jobStatus').textContent=(row.product?.name ? row.product.name+' · ' : '')+(names[row.status]||row.status)+(typeof row.progress==='number'?' · '+Math.round(row.progress*100)+'%':'')+' · '+(row.message||'')+' · 任务 '+row.id;
      $('retryGeneration').hidden=!['FAILED','CANCELLED'].includes(row.status);
      const url=Array.isArray(row.output)?row.output.find(x=>{try{return new URL(x).protocol==='https:';}catch(_){return false;}}):null;
      $('generatedVideo').hidden=!url;$('downloadVideo').hidden=!url;
      if(url){$('generatedVideo').src=url;$('downloadVideo').href=url;}else{$('generatedVideo').removeAttribute('src');$('downloadVideo').removeAttribute('href');}
    }
    async function poll(){clearTimeout(timer);if(!connection||!currentJob)return;
      if(currentJob.endpoint!==connection.base){$('jobStatus').textContent='请连接该任务原来的生成服务。';return;}
      const service=connection,job=currentJob,revision=connectionRevision;
      try{const row=await json(service.base+'/api/jobs/'+encodeURIComponent(job.id),{headers:{Authorization:'Bearer '+service.secret}});if(revision!==connectionRevision||job.id!==currentJob?.id)return;display(row);errors=0;if(!['SUCCEEDED','FAILED','CANCELLED','SUBMISSION_UNKNOWN'].includes(row.status))timer=setTimeout(poll,6000);}
      catch(e){if(revision!==connectionRevision||job.id!==currentJob?.id)return;errors++;$('jobStatus').textContent=e.message+'（任务标识已保留，不会重新创建任务）';if(errors<5)timer=setTimeout(poll,Math.min(30000,6000*errors));}
    }
    $('resumeJob').onclick=()=>{errors=0;poll();};
    $('retryGeneration').onclick=()=>{if(submitting)return;clearTimeout(timer);retrySalt=crypto.randomUUID();$('generationConsent').checked=false;$('retryGeneration').hidden=true;$('jobStatus').textContent='已准备新的生成尝试。请重新核对主图、预计费用并勾选本次授权，再点击生成。';update();};
    $('submitVideo').onclick=async()=>{
      update();if($('submitVideo').disabled)return;
      const service={...connection},c=structuredClone(api.context()),file=hero,view=$('heroView').value,prompt=api.compactPrompt();
      clearTimeout(timer);submitting=true;update();$('jobStatus').textContent='正在准备确认的首帧并提交，请勿重复点击。';
      try{
        const image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('首帧读取失败。'));reader.readAsDataURL(file);});
        if(!connection||connection.base!==service.base||connection.secret!==service.secret||!isConfirmed()||!$('generationConsent').checked||JSON.stringify(c.video)!==JSON.stringify(api.context().video))throw Error('提交前的设置或授权已变化，请重新确认。');
        const payload={image,prompt,duration:c.video.duration,aspect:c.video.aspect,product:c.product,view,confirmed:true,consent:true};
        if(payload.prompt.length>1000)throw Error('生成提示词过长，请减少动作要求后再提交。');
        const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({payload,attempt:retrySalt})));const idempotency=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
        const row=await json(service.base+'/api/jobs',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+service.secret,'Idempotency-Key':idempotency},body:JSON.stringify(payload)});
        remember(row,service);display(row);$('generationConsent').checked=false;errors=0;if(!['SUBMISSION_UNKNOWN','FAILED'].includes(row.status))timer=setTimeout(poll,6000);
      }catch(e){$('jobStatus').textContent=e.message+' 若网络中断，请先查询任务；相同内容再次提交会使用同一防重复标识。';}
      finally{submitting=false;update();}
    };
    window.addEventListener('pagehide',()=>{clearTimeout(timer);for(const value of gallery.values())URL.revokeObjectURL(value.url);});
    update();
    return{update,reference(file){hero=file||null;invalidate();update();},reset(){clearPhotos();},invalidate};
  }
  root.AlongWorkflow={mount,signature,endpoint};
  if(typeof module==='object'&&module.exports)module.exports={signature,endpoint};
})(typeof globalThis==='object'?globalThis:this);
