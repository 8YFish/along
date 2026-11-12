/* Shared UI for the men's and women's catalogues. The existing libraries remain available. */
(function () {
  'use strict';
  const female = document.title.startsWith('女装');
  const storageKey = 'along.studio.v1.' + (female ? 'women' : 'men');
  const savedKey = storageKey + '.saved';
  const defaults = { mode: 'reference', productCn: '', productEn: '', noteEn: '', locks: { person: false, pose: false, scene: false } };
  let extra = JSON.parse(JSON.stringify(defaults));
  let storageOK = true, saved = [];
  const el = id => document.getElementById(id);
  const original = { person: renderP1, scene: renderScn, main: renderP3, tab: showTab };
  const esc = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function read(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); }
    catch (_) { storageOK = false; return null; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (_) { storageOK = false; return false; }
  }
  function validState(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const p = source.p3 && typeof source.p3 === 'object' ? source.p3 : {};
    const clean = { ...P3 };
    const enums = { site: SITE, eth: ETH, age: AGES, build: BUILDS, pose: POSES, emo: EMO, style: STYLES, frame: CROPS };
    for (const [key, list] of Object.entries(enums)) if (list.some(x => (key === 'eth' ? x.code : x.id) === p[key])) clean[key] = p[key];
    if (Number.isInteger(p.cat) && CATVIS.some(x => x.idx === p.cat)) clean.cat = p.cat;
    if (Number.isInteger(p.scene) && SCN[p.scene]) clean.scene = p.scene;
    clean.outfit = typeof p.outfit === 'string' ? p.outfit.slice(0, 2000) : '';
    const x = source.extra || {};
    const options = { ...defaults, locks: { ...defaults.locks } };
    options.mode = x.mode === 'text' ? 'text' : 'reference';
    for (const key of ['productCn', 'productEn', 'noteEn']) options[key] = typeof x[key] === 'string' ? x[key].slice(0, 2000) : '';
    for (const key of ['person', 'pose', 'scene']) options.locks[key] = !!(x.locks && x.locks[key] === true);
    return { p3: clean, extra: options };
  }
  function snapshot() { return { version: 1, p3: { ...P3 }, extra: JSON.parse(JSON.stringify(extra)) }; }
  function fingerprints() { return { person: JSON.stringify(P1), scene: JSON.stringify(PS) }; }
  function fromMain() {
    const site = SITE.find(x => x.id === P3.site) || SITE[0];
    Object.assign(P1, { region: site.mk, eth: P3.eth, age: P3.age, build: P3.build });
    Object.assign(PS, { cat: P3.cat, sc: P3.scene, style: P3.style });
  }
  const draft = read(storageKey);
  if (draft && draft.version === 1) {
    const restored = validState(draft); Object.assign(P3, restored.p3); extra = restored.extra;
  }
  const storedSaved = read(savedKey);
  if (Array.isArray(storedSaved)) saved = storedSaved.filter(x => x && x.version === 1 && typeof x.name === 'string').slice(0, 12);
  fromMain();
  let last = fingerprints();
  function persist() { write(storageKey, snapshot()); }
  function changedOtherPages() { RENDERED.t1 = false; RENDERED.t2 = false; }
  renderP1 = function () {
    if (JSON.stringify(P1) !== last.person) {
      const site = SITE.find(x => x.mk === P1.region) || SITE[0];
      Object.assign(P3, { site: site.id, eth: P1.eth || site.eth, age: P1.age || DEFAULT_AGE, build: P1.build || 'B1' });
      // A selected view is also a usable action in the final prompt.
      const angles = { walk: 'P2', sit: 'P6', back: 'P13', profile: 'P12', t34: 'P18', smile: 'P17', full: 'P1' };
      if (angles[P1.ang]) P3.pose = angles[P1.ang];
      RENDERED.t3 = false;
    }
    original.person(); last.person = JSON.stringify(P1); persist();
  };
  renderScn = function () {
    const edited = JSON.stringify(PS) !== last.scene;
    original.scene();
    if (edited) { Object.assign(P3, { cat: PS.cat, scene: PS.sc, style: PS.style }); RENDERED.t3 = false; persist(); }
    last.scene = JSON.stringify(PS);
  };
  renderP3 = function () {
    original.main(); fromMain(); last = fingerprints(); changedOtherPages();
    if (el('quickStudio')) paint();
    persist();
  };
  showTab = function (id, push) {
    original.tab(id, push);
    if (id === 't3' && el('quickStudio')) paint();
  };
  function context() {
    const f = framePlan(), crop = P3.frame === 'full' ? 'full' : ['head', 'half'].includes(f.key) ? 'upper' : f.key;
    const sc = scNow(), po = posOf(P3.pose), features = catFeat();
    return {
      gender: female ? 'women' : 'men', ...extra, noteCn: P3.outfit || '',
      crop, back: P3.pose === 'P13', pose: P3.pose, poseName: po.name,
      poseZone: (POSE_VAR[P3.pose] || {}).zone, noWall: noWall(), lowerProduct: isLowerCat(catNow()),
      hasCuff: !!features.cuff, hasCollar: !!features.collar, seated: ['P6', 'P16'].includes(P3.pose),
      buildCn: buildOf(P3.build).cn, buildEn: buildOf(P3.build).en,
      personaCn: persona3Cn(), personaEn: persona3En(),
      poseCn: po.cn.replace(/^半身构图，从中腿到头顶略上方，/, ''), poseEn: po.en,
      sceneCn: stripEmptyCn(sc.cnT), sceneEn: stripEmptyEn(sc.enT).replace(/^(Vertical 2:3 |Horizontal 16:9 )/, ''),
      frameCn: f.cn, frameEn: f.en, moodCn: emoNow().cn, moodEn: emoNow().en
    };
  }
  enPrompt = () => AlongPrompt.build(context(), 'en');
  cnPrompt = () => AlongPrompt.build(context(), 'cn');
  function message(text) { el('studioStatus').textContent = text; }
  function setOptions(select, items, value) {
    select.innerHTML = items.map(x => '<option value="' + esc(x.value) + '">' + esc(x.label) + '</option>').join('');
    select.value = String(value);
  }
  function apply(values) { Object.assign(P3, values); renderP3(); }
  function paint() {
    const site = SITE.find(x => x.id === P3.site) || SITE[0];
    setOptions(el('quickSite'), SITE.map(x => ({ value: x.id, label: x.n })), P3.site);
    setOptions(el('quickPerson'), (MARKET_ETH[site.mk] || MARKET_ETH['北美']).map(([id]) => ({ value: id, label: ethOf(id).short })), P3.eth);
    setOptions(el('quickPose'), POSES.map(x => ({ value: x.id, label: x.name })), P3.pose);
    const pool = scenePool().list;
    setOptions(el('quickScene'), pool.map(i => ({ value: i, label: SCN[i].t })), P3.scene);
    el('quickPersonImage').src = IMG(P3.eth, 'full', P3.age, P3.build);
    el('quickPoseImage').src = POSIMG[P3.pose] || IMG(P3.eth, POSE_ANG[P3.pose] || 'full');
    el('quickPoseImage').alt = P3.pose === 'P13' ? '背面展示构图示意：背对镜头，不回头' : '动作示意，实际画面由出图工具生成';
    document.querySelectorAll('[data-view-pose]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.viewPose === P3.pose)));
    el('backReferenceHint').hidden = P3.pose !== 'P13';
    el('quickSceneImage').src = SCNIMG[scNow().id] || '';
    el('personDescription').textContent = ageOf(P3.age).short + ' · ' + buildOf(P3.build).name.split(' ')[0] + '；年龄和体型可在详细设置中调整。';
    const poseTips = { P1: '展示整体版型，遮挡较少。', P2: '表现裤腿垂感和自然动态。', P3: '表现休闲穿搭；请确认商品有口袋。', P6: '生活氛围更强，腰腹和膝盖会出现褶皱。', P12: '展示侧面轮廓与侧缝。', P13: '背对镜头、不回头，展示后腰、臀部与裤腿轮廓；图中仅示意方向。', P16: '展示坐姿搭配，保留台阶和接触阴影。' };
    el('poseDescription').textContent = poseTips[P3.pose] || '留意动作是否遮住商品，以及关键动作是否在画面内。';
    el('sceneDescription').textContent = scNow().why || '选择能衬托服装、不会抢走商品注意力的背景。';
    el('studioMode').value = extra.mode;
    el('productFields').hidden = extra.mode !== 'text';
    el('referenceHelp').hidden = extra.mode !== 'reference';
    el('productCn').value = extra.productCn; el('productEn').value = extra.productEn;
    el('outfitEnglish').value = extra.noteEn;
    el('cOutfit').value = P3.outfit;
    for (const key of ['person', 'pose', 'scene']) el('lock' + key).checked = extra.locks[key];
    refreshOutput();
    el('studioSummary').textContent = [extra.mode === 'reference' ? '商品参考图' : '凭描述生成', ethOf(P3.eth).short, posOf(P3.pose).name, scNow().t, P3.frame === 'auto' ? '自动构图' : (CROPS.find(x => x.id === P3.frame) || {}).n].join(' / ');
    el('draftHint').textContent = storageOK ? '选择自动保存在此浏览器；男女装分别保存。' : '浏览器暂时无法保存；可以继续使用并复制提示词。';
    paintSaved();
    // Existing div chips also support keyboard interaction.
    document.querySelectorAll('.chip:not(.dis)').forEach(chip => {
      chip.tabIndex = 0; chip.setAttribute('role', 'button'); chip.setAttribute('aria-pressed', String(chip.classList.contains('on')));
      chip.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chip.click(); } };
    });
  }
  function refreshOutput() {
    const problems = AlongPrompt.issues(context());
    const box = el('studioIssues'); box.replaceChildren(); box.hidden = problems.length === 0;
    problems.forEach(problem => {
      const row = document.createElement('div'); row.className = 'studio-issue';
      const text = document.createElement('p'); text.textContent = problem.message; row.append(text);
      const button = (label, action) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.onclick = action; row.append(b); };
      if (['crop', 'product-crop'].includes(problem.code)) button('改为全身', () => apply({ frame: 'full' }));
      if (['crop', 'wall', 'garment'].includes(problem.code)) button('改为正面站立', () => apply({ pose: 'P1' }));
      if (problem.code === 'product') button('填写服装描述', () => el('productCn').focus());
      box.append(row);
    });
    document.querySelectorAll('#t3 [data-cp], #cpEn, #cpCn').forEach(b => { b.disabled = problems.length > 0; });
    el('mainOut').textContent = LANG.p3 === 'cn' ? cnPrompt() : enPrompt();
  }
  function paintSaved() {
    const select = el('savedPlans'), current = select.value;
    setOptions(select, [{ value: '', label: saved.length ? '选择已保存方案（最多 12 套）' : '还没有保存的方案' }].concat(saved.map((x, i) => ({ value: i, label: x.name }))), current);
    el('loadPlan').disabled = !saved.length; el('deletePlan').disabled = !saved.length;
  }
  function preset(kind) {
    const candidates = { clean: ['P1', 'S1'], daily: ['P2', 'S3'], relaxed: ['P16', 'S2'] };
    const [pose, sceneId] = candidates[kind];
    if (!extra.locks.pose) P3.pose = pose;
    if (!extra.locks.scene) {
      P3.style = 'all';
      const index = SCN.findIndex(x => x.id === sceneId);
      if (index >= 0 && SCN[index].cats[P3.cat] !== '—') P3.scene = index;
    }
    // Full framing lets a beginner see the complete selected action.
    P3.frame = 'full'; renderP3();
    message('已应用搭配；已锁定的项目保持当前选择。');
  }
  function mount() {
    const root = document.createElement('section'); root.id = 'quickStudio'; root.className = 'studio'; root.setAttribute('aria-label', '新手快速搭配');
    root.innerHTML = `
      <div class="studio-heading"><div><span class="studio-eyebrow">QUICK START</span><h2>选出你想要的画面</h2><p>先用一套搭配开始，再换人物、动作或场景。提示词实时生成。</p></div><span class="studio-badge">无需编写提示词</span></div>
      <div class="studio-task"><label>你要怎么生成？<select id="studioMode"><option value="reference">我有商品参考图</option><option value="text">我想凭描述生成</option></select></label><p id="referenceHelp">复制后，把商品图和提示词一起交给出图工具。本页只生成提示词，不上传图片。</p></div>
      <div id="productFields" class="studio-product" hidden><label>服装描述（中文）<textarea id="productCn" maxlength="2000" placeholder="例如：米白色直筒长裤，棉麻材质，高腰，无图案"></textarea></label><label>服装描述（英文，可选）<textarea id="productEn" maxlength="2000" placeholder="Optional English version"></textarea></label><p>没有英文描述时，英文稿保留中文原文，不会自动翻译。</p></div>
      <div class="studio-presets"><span>帮我搭一套</span><button type="button" data-preset="clean">清晰展示版型</button><button type="button" data-preset="daily">日常穿搭感</button><button type="button" data-preset="relaxed">轻松休闲感</button><button type="button" id="shufflePlan">换一组</button></div>
      <div class="studio-grid">
        <article class="studio-card"><div class="studio-card-title"><h3>01 人物</h3><label class="studio-lock"><input type="checkbox" id="lockperson">锁定参数</label></div><img id="quickPersonImage" alt="人物风格参考" loading="lazy"><div class="studio-card-body"><label>目标市场<select id="quickSite"></select></label><label>人物类型<select id="quickPerson"></select></label><p id="personDescription"></p></div></article>
        <article class="studio-card"><div class="studio-card-title"><h3>02 动作</h3><label class="studio-lock"><input type="checkbox" id="lockpose">锁定动作</label></div><img id="quickPoseImage" alt="动作示意，实际画面由出图工具生成" loading="lazy"><div class="studio-card-body"><label>想让人物做什么？<select id="quickPose"></select></label><div class="studio-views" role="group" aria-label="展示方向"><button type="button" data-view-pose="P1" aria-pressed="false">正面</button><button type="button" data-view-pose="P12" aria-pressed="false">侧面</button><button type="button" data-view-pose="P13" aria-pressed="false">背面展示</button></div><p id="poseDescription"></p><p id="backReferenceHint" class="studio-back-hint" hidden>参考图模式下，请在出图工具中同时提供商品背面图；只有正面图时，不能准确还原后口袋、后腰和背面图案。</p></div></article>
        <article class="studio-card"><div class="studio-card-title"><h3>03 场景</h3><label class="studio-lock"><input type="checkbox" id="lockscene">锁定场景</label></div><img id="quickSceneImage" alt="场景氛围参考" loading="lazy"><div class="studio-card-body"><label>在哪里拍？<select id="quickScene"></select></label><p id="sceneDescription"></p></div></article>
      </div>
      <p class="studio-fine">图片用于参考人物风格、动作和氛围。锁定参数会复用描述；如需保持同一张脸，请在出图工具中使用人物参考图。</p>
      <div id="studioIssues" class="studio-issues" role="status" aria-live="polite" hidden></div>
      <div class="studio-plan"><input id="planName" aria-label="方案名称" maxlength="40" placeholder="方案名称，例如：春季长裤主图"><button type="button" id="savePlan">保存方案</button><select id="savedPlans" aria-label="已保存方案"></select><button type="button" id="loadPlan">载入</button><button type="button" id="deletePlan">删除</button></div>
      <p id="studioStatus" class="studio-status" role="status" aria-live="polite"></p><p id="draftHint" class="studio-fine"></p>
    `;
    const section = el('t3'); section.querySelector('.sec-h').after(root);
    const usage = section.querySelector('.usage'); usage.hidden = true;
    const hero = section.querySelector('.hero'), detailColumn = hero.children[1];
    const details = document.createElement('details'); details.className = 'studio-details';
    const summary = document.createElement('summary'); summary.textContent = '详细设置 · 年龄、体型、风格、构图与补充说明'; details.append(summary);
    while (detailColumn.firstChild) details.append(detailColumn.firstChild);
    detailColumn.append(details);
    const noteLabel = document.createElement('label'); noteLabel.className = 'studio-english'; noteLabel.innerHTML = '英文补充说明（可选）<textarea id="outfitEnglish" maxlength="2000" placeholder="需要纯英文稿时，在这里填写英文补充"></textarea><span>只填写中文补充时，英文稿会原样保留中文要求。</span>'; details.append(noteLabel);
    el('cOutfit').maxLength = 2000;
    const summaryLine = document.createElement('p'); summaryLine.id = 'studioSummary'; summaryLine.className = 'studio-summary'; hero.before(summaryLine);
    el('quickSite').onchange = e => { const site = SITE.find(x => x.id === e.target.value); apply({ site: site.id, eth: site.eth }); };
    el('quickPerson').onchange = e => apply({ eth: e.target.value });
    root.querySelectorAll('[data-view-pose]').forEach(b => b.onclick = () => apply({ pose: b.dataset.viewPose, frame: 'full' }));
    el('quickPose').onchange = e => apply({ pose: e.target.value });
    el('quickScene').onchange = e => apply({ scene: Number(e.target.value) });
    el('studioMode').onchange = e => { extra.mode = e.target.value; renderP3(); };
    for (const [id, key] of [['productCn', 'productCn'], ['productEn', 'productEn'], ['outfitEnglish', 'noteEn']]) {
      el(id).oninput = e => { extra[key] = e.target.value; updateText(); };
    }
    el('cOutfit').addEventListener('input', () => updateText());
    function updateText() {
      refreshOutput(); persist();
    }
    for (const key of ['person', 'pose', 'scene']) el('lock' + key).onchange = e => { extra.locks[key] = e.target.checked; persist(); };
    root.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => preset(b.dataset.preset));
    el('shufflePlan').onclick = () => {
      const poses = ['P1', 'P2', 'P12', 'P16', 'P17'];
      const scenes = scenePool().list;
      if (!extra.locks.person) {
        const people = MARKET_ETH[(SITE.find(x => x.id === P3.site) || SITE[0]).mk];
        P3.eth = people[(people.findIndex(x => x[0] === P3.eth) + 1) % people.length][0];
      }
      if (!extra.locks.pose) P3.pose = poses[(poses.indexOf(P3.pose) + 1) % poses.length];
      if (!extra.locks.scene && scenes.length) P3.scene = scenes[(scenes.indexOf(P3.scene) + 1) % scenes.length];
      P3.frame = 'full'; renderP3(); message('已换一组搭配，锁定的项目保持当前选择。');
    };
    el('savePlan').onclick = () => {
      const name = el('planName').value.trim() || [ethOf(P3.eth).short, posOf(P3.pose).name, scNow().t].join(' · ');
      const state = { ...snapshot(), name, createdAt: Date.now() };
      const next = [state, ...saved].slice(0, 12);
      if (!write(savedKey, next)) { message('保存失败：浏览器存储不可用或空间不足，请先复制提示词。'); return; }
      saved = next; paintSaved(); el('savedPlans').value = '0'; message('已保存“' + name + '”。');
    };
    el('loadPlan').onclick = () => {
      if (el('savedPlans').value === '') { message('请先选择要载入的方案。'); return; }
      const entry = saved[Number(el('savedPlans').value)]; if (!entry) return;
      const state = validState(entry); Object.assign(P3, state.p3); extra = state.extra;
      fromMain(); last = fingerprints(); renderP3(); message('已载入“' + entry.name + '”。');
    };
    el('deletePlan').onclick = () => {
      if (el('savedPlans').value === '') { message('请先选择要删除的方案。'); return; }
      const index = Number(el('savedPlans').value), next = saved.filter((_, i) => i !== index);
      if (!write(savedKey, next)) { message('删除失败：浏览器存储不可用。'); return; }
      saved = next; paintSaved(); message('已删除选中的本地方案。');
    };
    // Refresh cached tabs when the browser back/forward buttons change the hash.
    window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (['t1','t2','t3'].includes(id)) showTab(id, false); });
    paint();
  }
  // Register after the catalogue's own DOMContentLoaded handler initializes its libraries.
  document.addEventListener('DOMContentLoaded', mount);
})();
