const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const engine = require('../assets/prompt-engine.js');
const base = {
  gender: 'men', mode: 'reference', productCn: '', productEn: '', noteCn: '', noteEn: '',
  crop: 'full', back: false, pose: 'P1', poseName: '站立', poseZone: 'low', noWall: false,
  hasCuff: false, hasCollar: false, seated: false,
  buildCn: '标准匀称', buildEn: 'a regular build',
  personaCn: '一位成年男性，短发', personaEn: 'A man with short hair.',
  poseCn: '他自然站立', poseEn: 'stands with his arms relaxed',
  sceneCn: '柔和窗光。机位在胸高、50mm 镜头。', sceneEn: 'Soft window light. Shot at chest height on a 50mm lens.',
  frameCn: '从头顶到鞋底的全身构图。', frameEn: 'Full-length head-to-shoes framing.',
  moodCn: '他自然微笑', moodEn: 'He smiles naturally'
};
test('reference mode preserves garment markings without conflicting generic logo bans', () => {
  const output = engine.build(base, 'en');
  assert.match(output, /Preserve existing product markings/);
  assert.doesNotMatch(output, /logo, brand mark|Negative prompt:/);
  assert.match(output, /product reference/);
});
test('women output uses female pronouns in both languages and all shared sections', () => {
  const c = { ...base, gender: 'women', sceneEn: 'A menswear photography studio.' };
  const en = engine.build(c, 'en'), cn = engine.build(c, 'cn');
  assert.doesNotMatch(en, /\b(man|his|him|he|menswear)\b/i);
  assert.match(en, /woman/); assert.match(en, /her arms/); assert.match(en, /womenswear/);
  assert.doesNotMatch(cn, /他|男性/); assert.match(cn, /女性/);
});
test('lower crop omits face, hair and expression descriptions', () => {
  const c = { ...base, crop: 'lower' }, en = engine.build(c, 'en'), cn = engine.build(c, 'cn');
  assert.doesNotMatch(en, /short hair|EXPRESSION:|smiles naturally/);
  assert.doesNotMatch(cn, /短发|表情：/);
  assert.match(en, /Waistband-to-shoes crop/);
});
test('rejects invisible high actions, missing support and unsupported garment parts', () => {
  assert.equal(engine.issues({ ...base, crop: 'lower', poseZone: 'high' })[0].code, 'crop');
  assert.equal(engine.issues({ ...base, pose: 'P5', noWall: true })[0].code, 'wall');
  assert.equal(engine.issues({ ...base, pose: 'P11' })[0].code, 'garment');
  assert.equal(engine.issues({ ...base, pose: 'P4' })[0].code, 'garment');
  assert.equal(engine.issues({ ...base, pose: 'P4', hasCuff: true }).length, 0);
});
test('text mode requires a description and never silently discards Chinese input', () => {
  const blank = { ...base, mode: 'text' };
  assert.equal(engine.issues(blank)[0].code, 'product');
  const c = { ...blank, productCn: '米色棉麻长裤', noteCn: '不要腰带' };
  const en = engine.build(c, 'en');
  assert.match(en, /米色棉麻长裤/); assert.match(en, /不要腰带/);
  assert.doesNotMatch(en, /accompanying product reference/);
  const translated = engine.build({ ...c, productEn: 'Beige linen trousers', noteEn: 'No belt' }, 'en');
  assert.match(translated, /Beige linen trousers/); assert.match(translated, /No belt/);
  assert.doesNotMatch(translated, /米色|腰带/);
});
test('seated full-body output retains full framing and a physical support', () => {
  const out = engine.build({ ...base, pose: 'P16', seated: true, poseEn: 'sits on a low step' }, 'en');
  assert.match(out, /supporting seat or step/); assert.match(out, /Full-length/);
  assert.doesNotMatch(out, /Upper-body crop/);
});
test('scene camera specifications cannot override the selected crop', () => {
  assert.equal(engine.scene(base.sceneCn, true), '柔和窗光。');
  assert.equal(engine.scene(base.sceneEn, false), 'Soft window light.');
  assert.equal(engine.scene('Warm light. Shot on an 85mm lens at f/2.2. A pale wall.', false), 'Warm light. A pale wall.');
  assert.doesNotMatch(engine.build(base, 'cn'), /50mm|机位在胸高/);
  assert.doesNotMatch(engine.build(base, 'en'), /50mm|Shot at chest/);
});
test('both catalogue scripts parse and every extracted gallery asset exists', () => {
  for (const file of ['generated-images.html', 'generated-images-women.html']) {
    const text = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.ok(Buffer.byteLength(text) < 300000, file + ' stays below 300 KB');
    assert.doesNotMatch(text, /data:image\/[^;]+;base64,/);
    for (const [i, match] of [...text.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].entries())
      new vm.Script(match[1], { filename: file + ':' + i });
    const assets = [...text.matchAll(/\.\/assets\/gallery\/[\w.-]+/g)].map(x => x[0]);
    assert.ok(assets.length > 10);
    for (const asset of assets) assert.ok(fs.existsSync(path.join(__dirname, '..', asset)), asset);
    assert.match(text, /assets\/prompt-engine.js/); assert.match(text, /assets\/studio.js/);
  }
});
function runtime(file, stored = null) {
  const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const listeners = [], memory = new Map();
  const gender = file.includes('women') ? 'women' : 'men';
  if (stored) memory.set('along.studio.v1.' + gender, JSON.stringify(stored));
  const context = vm.createContext({
    console, setTimeout: () => {},
    document: { title: gender === 'women' ? '女装' : '男装', getElementById: () => null, addEventListener: (...args) => listeners.push(args) },
    window: { addEventListener: () => {} },
    localStorage: { getItem: k => memory.get(k) || null, setItem: (k, v) => memory.set(k, v) }
  });
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) vm.runInContext(match[1], context);
  // The wrapper is tested independently from DOM painting; the actual catalogue data stays loaded.
  vm.runInContext('renderP1=()=>{}; renderScn=()=>{}; renderP3=()=>{};', context);
  for (const file of ['prompt-engine.js', 'video-engine.js', 'studio.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'assets', file), 'utf8'), context);
  return { context, memory, run: code => vm.runInContext(code, context) };
}
test('real catalogue selections synchronize both ways, including scene and region', () => {
  for (const file of ['generated-images.html', 'generated-images-women.html']) {
    const app = runtime(file);
    app.run("Object.assign(P1,{region:'日韩',eth:'MC-03',age:'A3',build:'B2'}); renderP1();");
    assert.equal(app.run('P3.site'), 'JP'); assert.equal(app.run('P3.eth'), 'MC-03'); assert.equal(app.run('P3.age'), 'A3');
    app.run("Object.assign(PS,{sc:2,style:'all',cat:0}); renderScn();");
    assert.equal(app.run('P3.scene'), 2);
    app.run("Object.assign(P3,{site:'ME',eth:'MC-07',age:'A1',scene:0}); renderP3();");
    assert.equal(app.run('P1.region'), '中东'); assert.equal(app.run('P1.eth'), 'MC-07'); assert.equal(app.run('PS.sc'), 0);
  }
});
test('real catalogue drafts retain ethnicity IDs, modes, locks and notes after reload', () => {
  for (const file of ['generated-images.html', 'generated-images-women.html']) {
    const first = runtime(file);
    first.run("Object.assign(P3,{site:'JP',eth:'MC-03',age:'A3',outfit:'不要腰带'}); renderP3();");
    const value = JSON.parse([...first.memory.values()][0]);
    value.extra = { mode:'text', productCn:'灰色棉质长裤', noteEn:'No belt', locks:{person:true} };
    const second = runtime(file, value);
    assert.equal(second.run('P3.eth'), 'MC-03'); assert.equal(second.run('P1.region'), '日韩');
    assert.equal(second.run('P3.outfit'), '不要腰带');
    assert.match(second.run('enPrompt()'), /灰色棉质长裤/); assert.match(second.run('enPrompt()'), /No belt/);
  }
});
test('every catalogue pose and available scene produces a valid prompt or an explicit correction', () => {
  for (const file of ['generated-images.html', 'generated-images-women.html']) {
    const app = runtime(file);
    const outputs = JSON.parse(app.run(`JSON.stringify((()=>{
      const rows=[];
      for(const pose of POSES) for(const scene of scenePool().list) for(const frame of ['auto','full','upper','lower']) {
        Object.assign(P3,{pose:pose.id,scene,frame});
        rows.push({en:enPrompt(),cn:cnPrompt(),pose:pose.id,frame});
      }
      return rows;
    })())`));
    assert.ok(outputs.length >= 1000);
    for (const result of outputs) {
      assert.doesNotMatch(result.en, /undefined|NaN/);
      assert.doesNotMatch(result.cn, /undefined|NaN/);
      assert.ok(result.en.startsWith('TASK:') || result.en.startsWith('Resolve'));
      if (file.includes('women')) {
        assert.doesNotMatch(result.en, /\b(man|his|him|he|menswear)\b/i);
        assert.doesNotMatch(result.cn, /他|男性/);
      }
      if (result.frame === 'upper') assert.match(result.en, /^Resolve/);
      if (result.pose === 'P9') assert.doesNotMatch(result.en, /supporting seat or step/);
    }
  }
});

test('gender normalization preserves freeform product descriptions and notes', () => {
  const cn = engine.build({ ...base, gender:'women', mode:'text', productCn:'吉他印花长裤', noteCn:'其他细节保持一致' }, 'cn');
  assert.match(cn, /吉他印花/); assert.match(cn, /其他细节/);
});

test('rear views keep the camera behind the subject for every crop and gender', () => {
  for (const file of ['generated-images.html', 'generated-images-women.html']) {
    const app = runtime(file);
    assert.equal(app.run("POSIMG.P13"), file.includes('women') ? './assets/views/back-women.jpg' : './assets/views/back-men.jpg');
    if (file.includes('women')) assert.equal(app.run("IMG('MC-01','back','A2','B1')"), './assets/views/back-women.jpg');
    for (const frame of ['full', 'auto', 'lower']) {
      app.run("Object.assign(P3,{pose:'P13',frame:'" + frame + "'});");
      const en = app.run('enPrompt()'), cn = app.run('cnPrompt()');
      assert.match(en, /Straight rear view/); assert.match(en, /do not turn towards the lens/);
      assert.match(cn, /身体和头部均背对镜头/); assert.match(cn, /不回头/);
      assert.doesNotMatch(en, /EXPRESSION:|Hair:|Eyes:|Face:|head barely turned/);
      assert.doesNotMatch(cn, /表情：|发型：|眼睛：/);
      assert.doesNotMatch(en, /undefined|NaN/);
    }
    app.run("Object.assign(P3,{pose:'P1',frame:'full'});");
    assert.doesNotMatch(app.run('enPrompt()'), /Straight rear view/);
    app.run("Object.assign(P3,{pose:'P8',frame:'full'});");
    assert.doesNotMatch(app.run('enPrompt()'), /Straight rear view/);
  }
});
const video = require('../assets/video-engine.js');
test('video settings normalize old, corrupted and unsupported drafts', () => {
  assert.deepEqual(video.normalize(), video.defaults);
  assert.deepEqual(video.normalize({ duration:999, aspect:'2:3', motion:'<script>', camera:'orbit', source:'bad' }), video.defaults);
  const selected = { source:'text',duration:8,aspect:'16:9',motion:'walk',camera:'track' };
  assert.deepEqual(video.normalize(selected), selected);
});
test('video timeline covers the requested duration without gaps or overlaps', () => {
  for (const duration of [5,8,10]) for (const motion of video.motions) {
    const c = {...base, video:{duration,motion:motion.id}};
    for (const lang of ['cn','en']) {
      const phases = video.timeline(c,lang);
      assert.equal(phases[0].start,0); assert.equal(phases[2].end,duration);
      assert.equal(phases[0].end,phases[1].start); assert.equal(phases[1].end,phases[2].start);
      assert.ok(phases.every(p=>p.end>p.start && p.text.length>10));
    }
  }
});
test('video requires product details only for text input and retains untranslated notes', () => {
  assert.equal(video.issues({...base,video:{source:'text'}})[0].code,'video-product');
  assert.equal(video.issues({...base,video:{source:'image'}}).length,0);
  const c={...base, mode:'text', productCn:'米白色长裤',noteCn:'保留后口袋',video:{source:'text',duration:8,aspect:'16:9'}};
  const en=video.build(c,'en',engine);
  assert.match(en,/8 seconds/);assert.match(en,/16:9/);assert.match(en,/米白色长裤/);assert.match(en,/保留后口袋/);
  assert.doesNotMatch(en,/vertical 2:3|product photograph/);
  const image=video.build({...base,mode:'text',video:{source:'image'}},'en',engine);
  assert.match(image,/provided complete model-and-product hero image/);
});
test('walking and standing turns do not conflict with seated or crouched poses', () => {
  for (const pose of ['P6','P9','P16']) for (const motion of ['walk','turn']) {
    assert.equal(video.issues({...base,pose,video:{motion}})[0].code,'video-motion');
    assert.match(video.build({...base,pose,video:{motion}},'en',engine),/^Resolve/);
  }
  assert.equal(video.issues({...base,pose:'P6',video:{motion:'auto'}}).length,0);
});
test('rear video stays rear-facing for every motion, camera and gender', () => {
  for (const file of ['generated-images.html','generated-images-women.html']) {
    const app=runtime(file);
    const state={version:1,p3:{pose:'P13',frame:'full'},extra:{output:'video',video:{source:'image',duration:8,aspect:'9:16'}}};
    const restored=runtime(file,state);
    assert.match(restored.run('enPrompt()'),/VIEW LOCK: Stay rear-facing throughout/);
    assert.match(restored.run('cnPrompt()'),/方向锁定：全程背对镜头/);
    for (const motion of video.motions) for (const camera of video.cameras) {
      const v={source:'image',duration:5,aspect:'9:16',motion:motion.id,camera:camera.id};
      const c={...base,pose:'P13',back:true,gender:file.includes('women')?'women':'men',video:v};
      const en=video.build(c,'en',engine),cn=video.build(c,'cn',engine);
      assert.match(en,/rear-facing throughout/);assert.match(cn,/全程背对镜头/);
      assert.doesNotMatch(en,/undefined|NaN/); assert.doesNotMatch(cn,/undefined|NaN/);
      if(motion.id==='walk') assert.match(en,/away from the camera/);
      if(motion.id==='turn') assert.match(en,/at most 15 degrees/);
    }
  }
});
test('new video drafts round-trip without storing local image bytes or changing old image defaults', () => {
  const prior={version:1,p3:{pose:'P1',frame:'full'},extra:{mode:'reference'}};
  assert.match(runtime('generated-images.html',prior).run('enPrompt()'),/^TASK: Create one photorealistic fashion product photograph/);
  const state={...prior,extra:{output:'video',video:{source:'text',duration:10,aspect:'1:1',camera:'push',motion:'fabric'},productCn:'深蓝色长裤'}};
  for(const file of ['generated-images.html','generated-images-women.html']) {
    const app=runtime(file,state); app.run('renderP3()');
    const snapshot=JSON.parse([...app.memory.values()][0]);
    assert.equal(snapshot.extra.output,'video');assert.equal(snapshot.extra.video.duration,10);assert.equal(snapshot.extra.video.aspect,'1:1');
    assert.doesNotMatch(JSON.stringify(snapshot),/blob:|base64|referenceUrl|back-men.jpg/);
    assert.match(runtime(file,snapshot).run('enPrompt()'),/10 seconds/);
  }
});
test('real-person rear assets are local JPEG files and no page references the diagram', () => {
  for(const kind of ['men','women']) {
    const image=fs.readFileSync(path.join(__dirname,'..','assets','views','back-'+kind+'.jpg'));
    assert.equal(image[0],0xff);assert.equal(image[1],0xd8);assert.ok(image.length>10000);
    const html=fs.readFileSync(path.join(__dirname,'..',kind==='men'?'generated-images.html':'generated-images-women.html'),'utf8');
    assert.doesNotMatch(html,/assets\/views\/back.svg/);assert.match(html,/assets\/video-engine.js/);
  }
});

test('video scene wording cannot override a selected landscape format', () => {
  const c={...base,sceneCn:'竖版棚拍，柔和窗光。',sceneEn:'Vertical 2:3 studio photograph. Soft window light.',video:{source:'image',aspect:'16:9'}};
  const en=video.build(c,'en',engine),cn=video.build(c,'cn',engine);
  assert.match(en,/Aspect ratio: 16:9/); assert.doesNotMatch(en,/Vertical 2:3/);
  assert.match(cn,/画幅 16:9/); assert.doesNotMatch(cn,/竖版棚拍/);
});
