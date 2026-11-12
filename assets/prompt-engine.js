/* Shared, deterministic prompt rules. No account or network request is required. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AlongPrompt = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  function issues(c) {
    const out = [];
    if (c.mode === 'text' && !c.productCn.trim() && !c.productEn.trim())
      out.push({ code: 'product', message: '先描述要生成的服装，例如：米白色直筒长裤、棉麻材质、无图案。' });
    if (c.crop === 'upper' && c.lowerProduct)
      out.push({ code: 'product-crop', message: '上半身构图无法完整展示长裤，请改为全身或下半身。' });
    if (c.crop === 'lower' && c.poseZone === 'high')
      out.push({ code: 'crop', message: '下半身构图看不到“' + c.poseName + '”的关键动作。请改为全身，或选择下半身能看清的动作。' });
    if (c.pose === 'P5' && c.noWall)
      out.push({ code: 'wall', message: '当前场景没有可倚靠的墙面。请换成站立动作，或选择有墙面的场景。' });
    if ((c.pose === 'P4' && !c.hasCuff) || (c.pose === 'P11' && !c.hasCollar))
      out.push({ code: 'garment', message: '当前商品是长裤，无法确认袖口或领口。建议改为正面站立，避免动作依赖不存在的服装部件。' });
    return out;
  }
  function gender(text, female, cn) {
    if (cn) return female ? text.replace(/(?<![其吉利])他/g, '她').replace(/男性/g, '女性') : text;
    if (!female) return text;
    return text.replace(/\bhis\b/gi, 'her').replace(/\bhim\b/gi, 'her')
      .replace(/\bhe\b/gi, 'she').replace(/\bman\b/gi, 'woman').replace(/\bmen's\b/gi, "women's").replace(/\bmenswear\b/gi, 'womenswear');
  }
  function scene(text, cn) {
    if (cn) return text.replace(/[^。]*?(?:机位|\d+mm|相机)[^。]*。?/g, '').trim();
    return text.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(sentence => !/\b(?:shot (?:at|on|with)|camera (?:at|height|position)|\d+mm lens)/i.test(sentence)).join(' ').trim();
  }
  function build(c, lang) {
    const cn = lang === 'cn', female = c.gender === 'women';
    c = { ...c };
    for (const key of ['persona', 'pose', 'scene', 'frame', 'mood']) {
      c[key + 'Cn'] = gender(c[key + 'Cn'], female, true);
      c[key + 'En'] = gender(c[key + 'En'], female, false);
    }
    if (issues(c).length) return cn ? '完成上方提示的调整后，这里会生成完整提示词。' : 'Resolve the highlighted choices to generate the prompt.';
    const person = cn ? (female ? '女性' : '男性') : (female ? 'woman' : 'man');
    const crop = c.crop;
    const hiddenFace = crop === 'lower' || c.back;
    const model = crop === 'lower'
      ? (cn ? '一位成年' + person + '，体型：' + c.buildCn + '。只呈现腰部以下，不描述脸部或发型。'
        : 'One adult ' + person + ' with ' + c.buildEn + '. Only the body below the waist is visible.')
      : c.back
        ? (cn ? '一位成年' + person + '，体型：' + c.buildCn + '。背对镜头，面部不可见。' : 'One adult ' + person + ' with ' + c.buildEn + ', seen from behind with the face hidden.')
        : (cn ? c.personaCn : c.personaEn);
    const ref = cn
      ? '以随附的商品参考图为依据，保留可见的版型、颜色、面料纹理、口袋、纽扣和图案位置。只改变人物、动作、背景和光线。不可见的商品细节不做确定性改造；需要展示另一面时请补充对应参考图。保留商品原有标识，不新增文字或标识。'
      : 'Use the accompanying product reference as the garment specification. Preserve its visible cut, colour, fabric texture, pockets, buttons and pattern placement. Change only the person, action, setting and light. Do not invent hidden design details; request another reference view when needed. Preserve existing product markings; add no new text or marks.';
    const product = cn ? (c.productCn || c.productEn) : (c.productEn || c.productCn);
    const note = cn ? (c.noteCn || c.noteEn) : (c.noteEn || c.noteCn);
    const frame = crop === 'lower'
      ? (cn ? '腰头到鞋底的下半身构图。腰头、裤腿与裤脚清晰，头、肩与胸部均在画外。' : 'Waistband-to-shoes crop. Show the waistband, leg silhouette and hems clearly; keep the head, shoulders and chest outside the frame.')
      : crop === 'upper'
        ? (cn ? '头顶到臀部的上半身构图；腿和鞋在画外。' : 'Upper-body crop from the top of the head to the hips; legs and shoes stay outside the frame.')
        : (cn ? c.frameCn : c.frameEn);
    const neg = cn
      ? '额外人物、畸形手指、重复肢体、悬空脚、商品变形、颜色漂移、面料模糊、新增水印或文字'
      : 'extra people, deformed fingers, duplicated limbs, floating feet, distorted garment, colour shifts, blurred fabric, added watermarks or text';
    const lines = cn ? [
      '任务：生成一张写实服装商品图，2:3 竖图。',
      '商品：' + (c.mode === 'reference' ? ref : product + '。保留描述中的颜色、版型与材质。'),
      '人物：' + model,
      '动作：' + c.poseCn + '。' + (c.seated ? '保留支撑身体的座面或台阶，以及真实接触阴影。' : ''),
      c.back ? '展示方向：相机正对人物背面，人物身体和头部均背对镜头，不回头、不转向正面。清晰展示商品后腰、臀部轮廓、后侧缝与裤脚；后口袋和图案仅按背面参考图还原，不自行新增。' : '',
      '场景与光线：' + scene(c.sceneCn, true),
      '构图：' + frame,
      !hiddenFace ? '表情：' + c.moodCn + '。' : '',
      '画质：自然皮肤和织物纹理，商品细节清晰，光线柔和，白平衡自然。',
      note ? '补充要求：' + note : '',
      '避免：' + neg + '。'
    ] : [
      'TASK: Create one photorealistic fashion product photograph in a vertical 2:3 composition.',
      'GARMENT: ' + (c.mode === 'reference' ? ref : product + '. Preserve the specified colour, cut and material.'),
      'SUBJECT: ' + model,
      'ACTION: The subject ' + c.poseEn + '.' + (c.seated ? ' Include the supporting seat or step and realistic contact shadows.' : ''),
      c.back ? 'VIEW: Straight rear view. Both the body and head face away from the camera; do not turn towards the lens or reveal the face. Clearly show the rear waistband, seat silhouette, rear seams and hems. Reproduce back pockets and patterns only when supported by the rear product reference; add no invented details.' : '',
      'SETTING AND LIGHT: ' + scene(c.sceneEn, false),
      'FRAMING: ' + frame,
      !hiddenFace ? 'EXPRESSION: ' + c.moodEn + '.' : '',
      'FINISH: Natural skin and fabric texture, clear product details, soft light and neutral white balance.',
      note ? 'ADDITIONAL REQUIREMENTS (original language if no English version was supplied): ' + note : '',
      'AVOID: ' + neg + '.'
    ];
    return lines.filter(Boolean).join('\n\n');
  }
  return { issues, build, scene };
});
