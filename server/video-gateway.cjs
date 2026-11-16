/* Private video gateway. Run separately from GitHub Pages with Node.js 22+. */
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const RATIOS = { '9:16':'720:1280', '16:9':'1280:720', '1:1':'960:960' };
const TERMINAL = new Set(['SUCCEEDED','FAILED','CANCELLED','SUBMISSION_UNKNOWN']);
function error(status, message) { return Object.assign(new Error(message), {status}); }
function validate(input) {
  if (!input || ![5,8,10].includes(input.duration) || !RATIOS[input.aspect]) throw error(400,'请选择支持的时长和画幅。');
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 1000) throw error(400,'生成提示词须为 1–1000 个 UTF-16 字符。');
  if (typeof input.image !== 'string' || input.image.length > 14500000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(input.image)) throw error(400,'首帧须为不超过 10 MB 的 JPG、PNG 或 WebP。');
  const data = Buffer.from(input.image.split(',')[1], 'base64');
  const type = input.image.slice(5,input.image.indexOf(';'));
  const valid = type==='image/jpeg' ? data[0]===255 && data[1]===216 : type==='image/png' ? data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : data.toString('ascii',0,4)==='RIFF' && data.toString('ascii',8,12)==='WEBP';
  if (!valid || data.length > 10*1024*1024) throw error(400,'首帧内容与图片格式不符。');
  if (input.confirmed !== true || input.consent !== true) throw error(400,'请先确认主图，并同意本次上传与生成费用。');
  if (!['front','side','back'].includes(input.view)) throw error(400,'请选择主图展示方向。');
  if (!input.product || typeof input.product.name !== 'string' || !input.product.name.trim() || input.product.name.length > 80 || typeof input.product.sku !== 'string' || input.product.sku.length > 80) throw error(400,'请填写商品名称（最多 80 字）。');
  return input;
}
function createGateway(config = {}) {
  const key = config.providerKey || '', token = config.token || '';
  const rate = Number(config.creditsPerSecond), priced = Number.isFinite(rate) && rate > 0;
  const ready = !!key && token.length >= 24 && priced;
  const origins = config.origins || ['https://8yfish.github.io','http://127.0.0.1:8765','http://localhost:8765'];
  const fetcher = config.fetch || fetch;
  const dir = config.dataDir || path.join(__dirname,'data');
  const jobs = new Map();
  let writing = Promise.resolve();
  const loaded = (async()=>{
    await fs.mkdir(dir,{recursive:true});
    try { for(const row of JSON.parse(await fs.readFile(path.join(dir,'jobs.json'),'utf8'))) {
      // A crash between recording the intent and receiving the provider ID is ambiguous.
      if(row.status==='SUBMITTING') { row.status='SUBMISSION_UNKNOWN'; row.message='提交中断，结果未确认。请先在供应商后台核对，勿直接重复提交。'; }
      jobs.set(row.id,row);
    } } catch(e) { if(e.code!=='ENOENT') throw e; }
  })();
  async function save() {
    writing=writing.catch(()=>{}).then(async()=>{
      await fs.writeFile(path.join(dir,'jobs.tmp'),JSON.stringify([...jobs.values()]));
      await fs.rename(path.join(dir,'jobs.tmp'),path.join(dir,'jobs.json'));
    });
    await writing;
  }
  async function provider(route, init={}) {
    const response=await fetcher('https://api.dev.runwayml.com'+route,{...init,headers:{Authorization:'Bearer '+key,'X-Runway-Version':'2024-11-06','Content-Type':'application/json'},signal:AbortSignal.timeout(45000)});
    if(!response.ok) throw error(response.status===429?429:502,'视频服务暂时无法完成请求，请稍后检查任务状态。');
    return response.json();
  }
  function publicJob(row) {
    return {id:row.id,status:row.status,progress:row.progress,message:row.message,output:row.output||[],product:row.product,createdAt:row.createdAt,estimatedCredits:row.estimatedCredits};
  }
  async function body(req) {
    const chunks=[];let size=0;
    for await (const chunk of req) { size+=chunk.length;if(size>15000000) throw error(413,'请求过大，请缩小首帧图片。');chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { throw error(400,'无效的 JSON 请求。'); }
  }
  const server=http.createServer(async(req,res)=>{
    const origin=req.headers.origin;
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json;charset=utf-8'});res.end(JSON.stringify(data));};
    try {
      await loaded;
      if(origin && !origins.includes(origin)) throw error(403,'此网站未获准连接视频服务。');
      if(origin) {res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
      if(req.method==='OPTIONS') {res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, Idempotency-Key');res.writeHead(204);res.end();return;}
      const route=req.url.split('?')[0];
      if(route==='/api/capabilities' && req.method==='GET') return send(200,{ready,provider:'Runway',model:'gen4_turbo',durations:[5,8,10],aspects:Object.keys(RATIOS),creditsPerSecond:priced?rate:null,reason:ready?'':'服务尚未配置模型密钥、访问口令或单秒费用，请联系管理员。'});
      if(!ready) throw error(503,'生成服务尚未配置。仍可使用提示词和本地主图确认。');
      const expected=Buffer.from('Bearer '+token), supplied=Buffer.from(req.headers.authorization||'');
      if(supplied.length!==expected.length || !crypto.timingSafeEqual(expected,supplied)) throw error(401,'访问口令无效。');
      if(route==='/api/session' && req.method==='GET') return send(200,{authenticated:true});
      if(route==='/api/jobs' && req.method==='POST') {
        const idempotency=req.headers['idempotency-key'];
        if(typeof idempotency!=='string' || !/^[a-zA-Z0-9-]{16,80}$/.test(idempotency)) throw error(400,'缺少有效的防重复提交标识。');
        const input=validate(await body(req));
        const digest=crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
        const previous=[...jobs.values()].find(row=>row.idempotency===idempotency);
        if(previous) {if(previous.digest!==digest) throw error(409,'同一任务标识的内容已变化，请创建新任务。');return send(200,publicJob(previous));}
        if([...jobs.values()].filter(row=>!TERMINAL.has(row.status)).length>=2) throw error(429,'已有两个任务处理中，请等待完成。');
        const row={id:crypto.randomUUID(),idempotency,digest,product:{name:input.product.name,sku:input.product.sku},createdAt:new Date().toISOString(),status:'SUBMITTING',estimatedCredits:rate*input.duration};
        jobs.set(row.id,row);await save();
        try {
          const result=await provider('/v1/image_to_video',{method:'POST',body:JSON.stringify({model:'gen4_turbo',promptImage:input.image,promptText:input.prompt,duration:input.duration,ratio:RATIOS[input.aspect]})});
          if(typeof result.id!=='string'||! /^[a-zA-Z0-9-]{10,80}$/.test(result.id)) throw error(502,'视频服务返回了无效的任务标识。');
          row.providerId=result.id;row.status='PENDING';row.message='已提交，等待视频服务处理。';
        } catch(e) {
          // A provider timeout may have created a billed task: never retry the POST automatically.
          row.status='SUBMISSION_UNKNOWN';row.message='供应商是否收到请求尚未确认，请先核对其任务记录。不要重复提交。';
        }
        await save();return send(202,publicJob(row));
      }
      const match=route.match(/^\/api\/jobs\/([a-f0-9-]{36})$/);
      if(match && req.method==='GET') {
        const row=jobs.get(match[1]);if(!row) throw error(404,'任务不存在。');
        if(row.providerId && !['FAILED','CANCELLED'].includes(row.status) && (!row.lastPoll || Date.now()-row.lastPoll>=5000)) {
          row.lastPoll=Date.now();
          const result=await provider('/v1/tasks/'+encodeURIComponent(row.providerId));
          if(['PENDING','THROTTLED','RUNNING','FAILED','SUCCEEDED','CANCELLED'].includes(result.status)) row.status=result.status;
          row.progress=typeof result.progress==='number'?Math.max(0,Math.min(1,result.progress)):null;
          row.output=Array.isArray(result.output)?result.output.filter(url=>{try{return new URL(url).protocol==='https:';}catch(_){return false;}}):[];
          row.message=row.status==='FAILED'?'生成失败，请检查首帧和提示词后重新创建任务。':row.status==='SUCCEEDED'?'生成完成，请及时下载；供应商视频链接会过期。':'视频正在处理中。';
          await save();
        }
        return send(200,publicJob(row));
      }
      throw error(404,'接口不存在。');
    } catch(e) {send(e.status||500,{message:e.status?e.message:'服务暂时不可用，请保留任务标识后重试查询。'});}
  });
  return {server,loaded,jobs};
}
if(require.main===module) {
  const app=createGateway({providerKey:process.env.RUNWAYML_API_SECRET,token:process.env.ALONG_API_TOKEN,creditsPerSecond:process.env.ALONG_CREDITS_PER_SECOND,origins:process.env.ALONG_ALLOWED_ORIGINS?.split(',').map(x=>x.trim()),dataDir:process.env.ALONG_DATA_DIR});
  app.loaded.then(()=>app.server.listen(Number(process.env.PORT)||8787,process.env.HOST||'127.0.0.1',()=>console.log('Along video gateway listening. Configure credentials and pricing before use.'))).catch(()=>{console.error('Unable to open the task store.');process.exitCode=1;});
}
module.exports={createGateway,validate};
