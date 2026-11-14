/* Model-independent video briefs. Durations are creative targets, not API guarantees. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AlongVideo = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const defaults = Object.freeze({ source: 'image', duration: 5, aspect: '9:16', motion: 'auto', camera: 'fixed' });
  const motions = [
    { id: 'auto', name: '沿用当前动作 · 轻微动态' },
    { id: 'breathe', name: '自然呼吸 · 小幅重心变化' },
    { id: 'walk', name: '缓慢走两步' },
    { id: 'turn', name: '小幅转身 · 不超过 30°' },
    { id: 'fabric', name: '静态站姿 · 面料轻动' }
  ];
  const cameras = [
    { id: 'fixed', name: '固定镜头 · 展示商品' },
    { id: 'push', name: '缓慢推进 · 保留商品全貌' },
    { id: 'track', name: '平稳跟随 · 不绕到另一面' }
  ];
  function normalize(raw) {
    const v = raw && typeof raw === 'object' ? raw : {};
    return {
      source: v.source === 'text' ? 'text' : 'image',
      duration: [5, 8, 10].includes(v.duration) ? v.duration : defaults.duration,
      aspect: ['9:16', '16:9', '1:1'].includes(v.aspect) ? v.aspect : defaults.aspect,
      motion: motions.some(x => x.id === v.motion) ? v.motion : defaults.motion,
      camera: cameras.some(x => x.id === v.camera) ? v.camera : defaults.camera
    };
  }
  function resolvedMotion(c, v) {
    if (v.motion !== 'auto') return v.motion;
    return c.pose === 'P2' ? 'walk' : 'breathe';
  }
  function issues(c) {
    const v = normalize(c.video), result = [];
    if (v.source === 'text' && !(c.productCn || '').trim() && !(c.productEn || '').trim())
      result.push({ code: 'video-product', message: '文生视频需要服装描述。请填写颜色、版型和材质；已有图片时可切回图生视频。' });
    if (['P6', 'P9', 'P16'].includes(c.pose) && ['walk', 'turn'].includes(resolvedMotion(c, v)))
      result.push({ code: 'video-motion', message: '当前人物是坐姿或蹲姿，不能同时走路或站立转身。请改为轻微动态，或先切换正面／背面站姿。' });
    return result;
  }
  function action(c, v, cn) {
    const seated = ['P6', 'P9', 'P16'].includes(c.pose), rear = c.back;
    const motion = resolvedMotion(c, v);
    const text = cn ? {
      breathe: seated ? '保持当前坐姿或蹲姿，仅自然呼吸、轻微调整重心，保持身体支撑与双脚接地' : '保持当前姿态和手部位置，自然呼吸并轻微调整重心，避免遮挡商品',
      walk: rear ? '保持背对镜头，沿远离镜头方向缓慢走两步，裤腿自然摆动，不回头' : '沿当前朝向缓慢走两步，保持人物相对镜头的展示方向，裤腿自然摆动',
      turn: rear ? '从背面姿态轻轻左右转动不超过 15 度，始终展示背面，不露正脸' : '在当前展示角度附近缓慢转动不超过 30 度，不做完整转身，不展示参考中没有的另一面',
      fabric: seated ? '保持当前坐姿或蹲姿和身体支撑，面料随呼吸轻微起伏，不改变衣服结构' : '保持当前站姿，轻微气流带动裤腿或衣摆，不改变衣服结构'
    } : {
      breathe: seated ? 'Maintain the selected seated or crouched pose with subtle breathing and a small weight shift; preserve physical support and grounded feet' : 'Maintain the selected pose and hand positions with natural breathing and a small weight shift, keeping the garment visible',
      walk: rear ? 'Walk two slow steps away from the camera, staying rear-facing, with natural trouser movement and no head turn' : 'Take two slow steps along the current body direction while preserving the selected viewing angle and natural trouser movement',
      turn: rear ? 'Sway at most 15 degrees to either side of the rear-facing position; keep the back visible throughout and never reveal the front of the face' : 'Turn slowly within 30 degrees of the selected viewing angle; do not complete a full turn or reveal an unreferenced side',
      fabric: seated ? 'Maintain the selected seated or crouched pose and physical support, with subtle fabric movement from breathing and no structural change' : 'Hold the selected standing pose while a very light breeze moves the fabric, without changing the garment structure'
    };
    return text[motion];
  }
  function camera(v, cn) {
    return (cn ? {
      fixed: '镜头固定，机位和画幅稳定，商品展示部位完整留在画面内',
      push: '镜头极缓慢推进，不越过已选构图的边界，不裁掉腰头、裤脚或其他关键部位',
      track: '镜头以匀速平稳跟随人物，保持当前展示方向和距离，不绕拍、不突然变焦'
    } : {
      fixed: 'Use a locked-off camera with stable framing, keeping the selected product areas visible',
      push: 'Use a very slow push-in without crossing the selected crop boundaries or clipping the waistband, hems or other key details',
      track: 'Track smoothly at a constant distance and selected viewing angle; do not orbit or zoom abruptly'
    })[v.camera];
  }
  function timeline(c, lang) {
    const cn = lang === 'cn', v = normalize(c.video);
    const a = Number((v.duration * 0.2).toFixed(1)), b = Number((v.duration * 0.8).toFixed(1));
    const rear = c.back;
    return [
      { start: 0, end: a, title: cn ? '稳定开场' : 'Establish', text: cn ? (v.source === 'image' ? '从提供的首帧开始，保持人物、服装和背景一致。' : '建立选定人物、服装、场景与构图。') : (v.source === 'image' ? 'Begin from the provided first frame, retaining the same person, garment and setting.' : 'Establish the selected person, garment, scene and crop.') },
      { start: a, end: b, title: cn ? '主体动作' : 'Action', text: action(c, v, cn) + (cn ? '。' : '.') },
      { start: b, end: v.duration, title: cn ? '自然收尾' : 'Settle', text: cn ? (rear ? '平稳停住，仍保持背对镜头，商品细节清晰。' : '缓慢停稳，保持原构图和商品细节清晰，不切换场景。') : (rear ? 'Settle smoothly while staying rear-facing, with garment details clear.' : 'Settle smoothly in the original framing; keep garment details clear without changing scene.') }
    ];
  }
  function setting(text, lang, prompt) {
    const cleaned = prompt.scene(text, lang === 'cn');
    return lang === 'cn'
      ? cleaned.replace(/(?:竖版|竖屏|竖幅|横版|横屏|横幅|2:3|9:16|16:9)\s*/g, '')
      : cleaned.replace(/\b(?:vertical|horizontal|portrait-format|landscape-format)\b\s*/gi, '').replace(/\b(?:2:3|9:16|16:9)\b\s*/g, '');
  }
  function build(c, lang, prompt) {
    const cn = lang === 'cn', v = normalize(c.video);
    const allIssues = prompt.issues(c).filter(x => x.code !== 'product').concat(issues(c));
    if (allIssues.length) return cn ? '完成上方提示的调整后，这里会生成视频提示词。' : 'Resolve the highlighted choices to generate the video brief.';
    const female = c.gender === 'women';
    const normalized = value => female ? value.replace(/\bhis\b/gi, 'her').replace(/\bhim\b/gi, 'her').replace(/\bhe\b/gi, 'she').replace(/\bman\b/gi, 'woman').replace(/(?<![其吉利])他/g, '她').replace(/男性/g, '女性') : value;
    const product = cn ? (c.productCn || c.productEn) : (c.productEn || c.productCn);
    const note = cn ? (c.noteCn || c.noteEn) : (c.noteEn || c.noteCn);
    const person = c.crop === 'lower' || c.back
      ? (cn ? '一位成年' + (female ? '女性' : '男性') + '，体型：' + c.buildCn + '；不描述画面外的面部。' : 'One adult ' + (female ? 'woman' : 'man') + ' with ' + c.buildEn + '; do not describe a face outside the selected view.')
      : normalized(cn ? c.personaCn : c.personaEn);
    const frame = c.crop === 'lower'
      ? (cn ? '从腰头到鞋底的下半身构图，头、胸和肩在画外。' : 'Waistband-to-shoes crop; keep the head, chest and shoulders outside the frame.')
      : normalized(cn ? c.frameCn : c.frameEn);
    const phases = timeline(c, lang).map(x => x.start + '–' + x.end + (cn ? ' 秒｜' : ' s | ') + x.title + ': ' + x.text).join('\n');
    return (cn ? [
      '任务：生成一段写实服装商品短视频。目标时长 ' + v.duration + ' 秒，画幅 ' + v.aspect + '，单一连续镜头。',
      v.source === 'image' ? '输入：使用随附的完整人物商品主图作为首帧。保持首帧中的人物身份、服装、背景和光线，不把图库动作照片当成商品首帧。' : '人物：' + person + '\n服装：' + product,
      '商品约束：全程保持颜色、版型、裤长、面料纹理、口袋和图案稳定，不新增或删除结构。不可见部分不做确定性改造。' + (v.source === 'text' ? '' : (c.mode === 'text' && product ? '\n补充服装描述：' + product : '')),
      '起始姿态：' + normalized(c.poseCn) + '。\n构图：' + frame,
      c.back ? '方向锁定：全程背对镜头，头部不回转，不展示正面。后口袋、后腰和图案须以背面商品首帧为准。' : '',
      '场景与光线：' + setting(normalized(c.sceneCn), 'cn', prompt),
      '镜头：' + camera(v, true) + '。',
      '时间轴：\n' + phases,
      '连续性：人物和衣服不得闪烁、变形或换色，双脚接地，动作缓慢自然，保持真实织物运动。无转场、无字幕、无新增水印；默认无配乐和对白。',
      note ? '补充要求：' + note : '',
      '参数说明：时长和画幅为创作目标，实际支持值请在所用视频生成工具中设置。'
    ] : [
      'TASK: Create one photorealistic fashion product video. Target duration: ' + v.duration + ' seconds. Aspect ratio: ' + v.aspect + '. One continuous shot.',
      v.source === 'image' ? 'INPUT: Use the provided complete model-and-product hero image as the first frame. Preserve its person, garment, background and lighting; do not use a catalogue pose example as the product frame.' : 'SUBJECT: ' + person + '\nGARMENT: ' + product,
      'PRODUCT CONTINUITY: Preserve colour, cut, trouser length, fabric texture, pockets and patterns throughout. Add or remove no garment structures. Do not invent hidden details.' + (v.source === 'image' && c.mode === 'text' && product ? '\nAdditional garment description (original language if untranslated): ' + product : ''),
      'STARTING POSE: The subject ' + normalized(c.poseEn) + '.\nFRAMING: ' + frame,
      c.back ? 'VIEW LOCK: Stay rear-facing throughout with no head turn and no front reveal. Match rear pockets, waistband and patterns to the rear-facing product first frame.' : '',
      'SETTING AND LIGHT: ' + setting(normalized(c.sceneEn), 'en', prompt),
      'CAMERA: ' + camera(v, false) + '.',
      'TIMELINE:\n' + phases,
      'CONTINUITY: No identity drift, garment flicker, morphing or colour changes. Keep feet grounded and fabric motion natural. No cuts, captions or new watermarks. No music or dialogue by default.',
      note ? 'ADDITIONAL REQUIREMENTS (original language if untranslated): ' + note : '',
      'PARAMETERS: Duration and aspect ratio are creative targets. Select supported values in the video generation tool.'
    ]).filter(Boolean).join('\n\n');
  }
  return { defaults, motions, cameras, normalize, issues, timeline, build };
});
