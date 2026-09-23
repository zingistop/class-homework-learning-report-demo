(function () {
  'use strict';

  const state = {
    runners: [],
    cursor: 0,
    running: false,
    stopped: false,
    controller: null,
    startedAt: 0,
    elapsedBeforeStart: 0,
    timer: null,
    // 离线演示包始终保留完整逐步动画，避免系统“减少动态效果”设置让过程瞬间完成。
    reducedMotion: false,
    quick: new URLSearchParams(location.search).get('quick') === '1'
  };

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
  const icon = (name, className = '') => `<i data-lucide="${name}"${className ? ` class="${className}"` : ''}></i>`;
  const refreshIcons = () => window.lucide?.createIcons();
  const analysisTable = (headers, rows, label = '') => `<div class="v4-analysis-table"${label ? ` aria-label="${esc(label)}"` : ''}><table><thead><tr>${headers.map((item) => `<th>${esc(item)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((item) => `<td>${esc(item)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  // 演示加速：原六步流程为 16870ms；配合入口原 2200ms，总时长约 19070ms。
  // 当前按 0.16 倍播放，配合 300ms 入口等待，总时长约 3 秒。
  const DEMO_TIME_SCALE = .16;
  const duration = (ms) => state.reducedMotion ? 12 : Math.max(18, ms * (state.quick ? .06 : DEMO_TIME_SCALE));
  const wait = (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error('已停止'), { name: 'AbortError' }));
    const timer = setTimeout(resolve, duration(ms));
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('已停止'), { name: 'AbortError' }));
    }, { once: true });
  });

  function elapsedText() {
    const active = state.running ? Date.now() - state.startedAt : 0;
    const seconds = Math.max(0, Math.floor((state.elapsedBeforeStart + active) / 1000));
    return `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, '0')}秒`;
  }

  function startTimer() {
    clearInterval(state.timer);
    state.timer = setInterval(() => {
      const elapsed = $('runElapsed');
      if (elapsed) elapsed.textContent = elapsedText();
    }, 250);
  }

  function pauseTimer() {
    if (state.running) state.elapsedBeforeStart += Date.now() - state.startedAt;
    clearInterval(state.timer);
    state.timer = null;
    const elapsed = $('runElapsed');
    if (elapsed) elapsed.textContent = elapsedText();
  }

  function scrollLatest(force = false) {
    const scroll = () => {
      const embeddedScreen = $('thirdScreen');
      if (embeddedScreen && !embeddedScreen.hidden) {
        const nearEmbeddedBottom = embeddedScreen.clientHeight + embeddedScreen.scrollTop >= embeddedScreen.scrollHeight - 220;
        if (force || nearEmbeddedBottom || state.quick) {
          embeddedScreen.scrollTo({
            top: embeddedScreen.scrollHeight,
            behavior: state.reducedMotion ? 'auto' : 'smooth'
          });
        }
        return;
      }
      const scrollingElement = document.scrollingElement || document.documentElement || document.body;
      const maxScrollHeight = Math.max(
        document.documentElement.scrollHeight,
        document.body ? document.body.scrollHeight : 0,
        scrollingElement ? scrollingElement.scrollHeight : 0
      );
      const currentScroll = window.scrollY || document.documentElement.scrollTop || (document.body ? document.body.scrollTop : 0);
      const nearBottom = window.innerHeight + currentScroll >= maxScrollHeight - 220;
      if (force || nearBottom || state.quick) {
        const behavior = state.reducedMotion ? 'auto' : 'smooth';
        window.scrollTo({ top: maxScrollHeight, behavior });
        [scrollingElement, document.documentElement, document.body].filter(Boolean).forEach((element) => { element.scrollTop = maxScrollHeight; });
        $('finishMessage')?.scrollIntoView({ block: 'end', behavior });
      }
    };
    if (force) {
      requestAnimationFrame(() => requestAnimationFrame(scroll));
      return;
    }
    scroll();
  }

  function createTurn(id, summary) {
    const avatarSource = $('thirdScreen') ? '班级错因诊断CoT%20demo/assets/home/chat-logo.png' : 'assets/home/chat-logo.png';
    const turn = document.createElement('article');
    turn.className = 'v4-turn';
    turn.dataset.turn = id;
    turn.dataset.transient = 'true';
    turn.innerHTML = `
      <img class="v4-avatar" src="${avatarSource}" alt="飞象老师">
      <div class="v4-turn-main">
        <button class="v4-turn-summary" type="button" aria-expanded="false">
          <span class="v4-summary-check">${icon('check')}</span>
          <strong>${esc(summary.title)}</strong>
          <span class="v4-summary-meta">${esc(summary.meta)}</span>
          ${icon('chevron-down', 'v4-summary-chevron')}
        </button>
        <div class="v4-turn-body"><p class="v4-turn-lead"></p><div class="v4-turn-content"></div></div>
      </div>`;
    $('agentStream').appendChild(turn);
    refreshIcons();
    scrollLatest();
    return turn;
  }

  function finishTurn(turn) {
    delete turn.dataset.transient;
    turn.dataset.complete = 'true';
    refreshIcons();
  }

  function compressCompleted(except = null) {
    document.querySelectorAll('.v4-turn[data-complete="true"]').forEach((turn) => {
      if (turn !== except && !turn.classList.contains('is-expanded') && !turn.classList.contains('is-spotlight')) turn.classList.add('is-compressed');
    });
  }

  function commitStage(node) {
    delete node.dataset.transient;
    node.classList.remove('is-running');
    node.classList.add('is-complete');
    const marker = node.querySelector('.v4-stage-marker');
    if (marker) marker.innerHTML = icon('check');
    refreshIcons();
  }

  function collapseResearchStages(except = null) {
    document.querySelectorAll('.v4-research-stage.is-complete').forEach((stage) => {
      if (stage === except) return;
      stage.classList.add('is-collapsed');
      stage.querySelector('.v4-stage-heading')?.setAttribute('aria-expanded', 'false');
    });
  }

  function appendStage(id, tag, title, meta = '') {
    const timeline = $('researchTimeline');
    collapseResearchStages();
    const node = document.createElement('section');
    node.className = 'v4-research-stage is-running';
    node.dataset.stage = id;
    node.dataset.transient = 'true';
    node.innerHTML = `<span class="v4-stage-marker">${icon('loader-circle')}</span><div class="v4-stage-main"><button class="v4-stage-heading" type="button" aria-expanded="true"><span class="v4-stage-heading-copy"><span>${esc(tag)}</span><strong>${esc(title)}</strong></span><span class="v4-stage-heading-side">${meta ? `<small>${esc(meta)}</small>` : ''}${icon('chevron-up', 'v4-stage-chevron')}</span></button><div class="v4-stage-content"></div></div>`;
    timeline.appendChild(node);
    refreshIcons();
    requestAnimationFrame(() => node.classList.add('is-visible'));
    if (state.quick || window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 300) {
      setTimeout(() => node.scrollIntoView({ behavior: state.reducedMotion ? 'auto' : 'smooth', block: 'center' }), 40);
    }
    return node;
  }

  async function playActivity(container, title, entries, signal) {
    container.classList.remove('is-result-ready');
    container.classList.add('is-activity-running');
    const panel = document.createElement('section');
    panel.className = 'v4-activity';
    panel.innerHTML = `<header><span>${icon('sparkles')}<strong>${esc(title)}</strong></span><small>0/${entries.length}</small></header><div class="v4-activity-window"><div class="v4-activity-list"></div></div>`;
    container.prepend(panel);
    const list = panel.querySelector('.v4-activity-list');
    const counter = panel.querySelector('header small');
    refreshIcons();
    for (let index = 0; index < entries.length; index += 1) {
      if (signal.aborted) throw Object.assign(new Error('已停止'), { name: 'AbortError' });
      const previousRow = list.querySelector('.is-current');
      if (previousRow) {
        previousRow.classList.remove('is-current');
        previousRow.querySelector('strong').textContent = previousRow.querySelector('strong').dataset.complete;
      }
      const entry = entries[index];
      const row = document.createElement('div');
      row.className = 'v4-activity-row is-current';
      row.innerHTML = `<span class="v4-activity-icon">${icon(entry[0])}</span><div><strong data-complete="${esc(`已${entry[1]}`)}">正在${esc(entry[1])}</strong><small>${esc(entry[2])}</small></div>`;
      list.appendChild(row);
      counter.textContent = `${index + 1}/${entries.length}`;
      refreshIcons();
      panel.querySelector('.v4-activity-window').scrollTo({ top: list.scrollHeight, behavior: state.reducedMotion ? 'auto' : 'smooth' });
      scrollLatest();
      await wait(entry[3] || 320, signal);
    }
    const finalRow = list.querySelector('.is-current');
    if (finalRow) {
      finalRow.classList.remove('is-current');
      finalRow.querySelector('strong').textContent = finalRow.querySelector('strong').dataset.complete;
    }
    panel.classList.add('is-complete');
    const activityTitle = panel.querySelector('header strong');
    if (activityTitle) activityTitle.textContent = activityTitle.textContent.replace(/^正在/, '已完成');
    panel.querySelector('header > span').insertAdjacentHTML('afterbegin', icon('check-circle-2'));
    panel.querySelector('header > span > svg:last-of-type')?.remove();
    container.classList.remove('is-activity-running');
    container.classList.add('is-result-ready');
    refreshIcons();
  }

  function ensureResearchCanvas() {
    let turn = document.querySelector('[data-turn="research-canvas"]');
    if (turn) return turn;
    turn = createTurn('research-canvas', { title: '班级作业错因诊断分析', meta: '6步诊断流程' });
    turn.classList.add('v4-turn--canvas', 'is-spotlight');
    turn.querySelector('.v4-turn-lead').textContent = '';
    turn.querySelector('.v4-turn-content').innerHTML = `<section class="v4-research-canvas"><header class="v4-canvas-head"><div><span>基于全量作答证据的数学班级错因诊断与教学改进</span><h2>七年级1班 2025-2026红岭深康七年级下册期末复习综合（二） 班级错因诊断</h2></div><div class="v4-canvas-state"><i></i><span>正在综合分析</span></div></header><div class="v4-research-timeline" id="researchTimeline"></div><footer class="v4-canvas-foot"><span>${icon('shield-check')}统计口径 · 本次作业</span><span>${icon('book-open')}覆盖范围 · 42名学生 × 12道题</span></footer></section>`;
    turn.querySelector('.v4-research-canvas').dataset.introPending = 'true';
    refreshIcons();
    return turn;
  }

  async function playResearchIntro(signal) {
    const turn = ensureResearchCanvas();
    const lead = turn.querySelector('.v4-turn-lead');
    const canvas = turn.querySelector('.v4-research-canvas');
    lead.textContent = '';
    if (signal.aborted) throw Object.assign(new Error('已停止'), { name: 'AbortError' });
    delete canvas.dataset.introPending;
    canvas.classList.add('is-intro-visible');
    refreshIcons();
    scrollLatest();
    return turn;
  }

  async function runSchoolOverview(signal) {
    compressCompleted();
    const turn = await playResearchIntro(signal);
    const stage = appendStage('school-overview', '第一步 · 界定本次班级作业诊断口径', '确认任务目标、证据范围与诊断边界', '任务 · 目标 · 范围 · 边界');
    const content = stage.querySelector('.v4-stage-content');
    content.innerHTML = `<p class="v4-stage-copy">本次诊断聚焦七年级1班“2025-2026红岭深康七年级下册期末复习综合（二）”，以42名学生12道题的作答、得分、草稿过程、批改记录和订正痕迹为证据，仅判断本次任务中的知识掌握与能力表现，不直接外推为长期数学水平。</p><div class="v4-research-contract"><div><span>班级与学科</span><strong>七年级1班 · 数学</strong></div><div><span>任务类型</span><strong>期末复习综合（二） · 12题</strong></div><div><span>作业场景</span><strong>综合检测 · 满分100分</strong></div><div><span>诊断用途</span><strong>班级讲评与分层补救</strong></div></div><div class="v4-source-grid"><article class="v4-source-card">${icon('users-round')}<span>诊断学生</span><strong>42人</strong><small>班级花名册完整覆盖</small></article><article class="v4-source-card">${icon('files')}<span>有效答卷</span><strong>42份</strong><small>提交率100%</small></article><article class="v4-source-card">${icon('scan-text')}<span>逐题作答记录</span><strong>504条</strong><small>42名学生 × 12道题</small></article><article class="v4-source-card">${icon('pen-line')}<span>订正痕迹</span><strong>37份</strong><small>错题订正与过程修正证据</small></article></div><div class="v4-index-result v4-data-ledger"><div><strong>42</strong><span>参与诊断学生</span></div><div><strong>12</strong><span>纳入诊断题目</span></div><div><strong>72.8</strong><span>班级本次均分</span></div><div><strong>504</strong><span>结构化作答节点</span></div></div><div class="v4-triple-note"><article><b>任务目标</b><p>评价学生对七年级下册核心知识、运算方法、推理建模和数学表达规范的综合掌握情况。</p></article><article><b>证据范围</b><p>覆盖原始答卷、逐题得分、关键步骤、教师批注和订正痕迹，不引入本次作业以外的数据。</p></article><article><b>诊断边界</b><p>结论反映本次期末复习综合作业表现，用于教学干预，不等同于学生长期数学能力定级。</p></article></div><div class="v4-boundary-strip"><span>${icon('shield-check')}口径说明：诊断对象为七年级1班42名学生；核心结论仅基于本次100分制、12道题的期末复习综合作业及其过程性证据。</span></div>`;
    await playActivity(content, '正在界定本次班级作业诊断口径', [
      ['clipboard-list', '确认班级作业任务', '七年级1班 · 数学 · 期末复习综合（二） · 12道题'],
      ['target', '明确任务评价目标', '确认知识掌握、运算能力、推理建模与100分制评分依据'],
      ['scan-search', '界定诊断证据范围', '42名学生 · 42份答卷 · 504条逐题作答及订正痕迹'],
      ['shield-check', '说明诊断结论边界', '区分本次任务表现诊断与长期数学水平判断，避免过度归因']
    ], signal);
    await wait(950, signal);
    commitStage(stage);
    finishTurn(turn);
  }

  async function runLayerAnalysis(signal) {
    const stage = appendStage('layer-analysis', '第二步 · 配置学科内容与能力诊断模型', '建立与本次任务匹配的学科诊断框架', '内容 · 能力 · 错因 · 评价');
    const content = stage.querySelector('.v4-stage-content');
    content.innerHTML = `<p class="v4-stage-copy">围绕本次数学单元综合作业，将课程要求转换为可诊断的知识要点、核心能力、错因标准和评价维度。模型采用100分制，并把结果正确与过程正确分开校验。</p><div class="v4-discovery-grid"><article><span>任务总分</span><strong>100分</strong><small>基础概念、运算技能、推理建模、规范表达四个维度</small></article><article><span>评价维度</span><strong>4项</strong><small>知识掌握、方法策略、数学思维、过程表达与规范性综合判断</small></article></div>${analysisTable(['诊断维度', '分值', '本次任务要求', '主要错因标准'], [['基础概念', '25分', '辨析同类项、等式性质与代数式含义', '概念混淆、条件遗漏、符号含义理解偏差'], ['运算技能', '30分', '准确完成去括号、合并同类项和方程变形', '符号错误、法则误用、步骤跳跃与计算失误'], ['推理建模', '25分', '提取数量关系并建立方程解决问题', '关系识别偏差、模型建立错误、检验意识不足'], ['规范表达', '20分', '步骤完整、依据清楚、答案规范', '过程缺失、等号连用、单位或结论不完整']], '本次数学单元作业诊断模型')}<div class="v4-cross-matrix"><div class="v4-cross-row"><span>内容体系</span><strong>整式运算 × 方程求解 × 实际应用</strong><b class="is-support">与单元目标一致</b></div><div class="v4-cross-row"><span>能力要求</span><strong>理解 × 运算 × 推理 × 建模</strong><b class="is-support">覆盖数学解题完整链条</b></div><div class="v4-cross-row"><span>错因标准</span><strong>概念不清 × 法则误用 × 方法不稳 × 表达失范</strong><b>支持分层判定</b></div></div><div class="v4-boundary-strip"><span>${icon('chart-no-axes-combined')}阶段结果：形成适配本次数学作业的“内容—能力—错因—评价”诊断模型。</span></div>`;
    await playActivity(content, '正在配置学科内容与能力诊断模型', [
      ['library', '调取本学科课程内容体系', '同步知识结构与能力要求'],
      ['list-checks', '匹配题型或任务类型要求', '关联对应的知识、技能、思维和表达要求'],
      ['scan-search', '建立本学科错因分类标准', '形成适用于本次任务的错因诊断口径'],
      ['layout-list', '明确诊断评价维度', '覆盖内容掌握、方法策略、思维能力、表达呈现和规范性']
    ], signal);
    await wait(1100, signal);
    commitStage(stage);
  }

  async function runProblemDiagnosis(signal) {
    const stage = appendStage('problem-diagnosis', '第三步 · 结构化整理全量作答证据', '建立可追溯的全量作答证据链', '题目 · 学生 · 作答 · 得分 · 证据');
    const content = stage.querySelector('.v4-stage-content');
    content.innerHTML = `<p class="v4-stage-copy">对42份数学答卷逐题解析，将原始答案、关键步骤、逐题得分、教师批注与订正痕迹统一整理，标记正确、错误、空白、部分得分和非典型解法，并建立“题目—学生—作答—得分—证据”的可追溯链条。</p>${analysisTable(['证据类型', '数量或状态', '结构化处理结果'], [['原始答卷', '42份', '全部完成逐题解析并关联学生身份'], ['逐题作答', '504条', '42名学生的12道题均建立作答记录'], ['逐题得分', '504项', '每条作答均关联题目分值与实际得分'], ['关键步骤', '1,286条', '提取运算过程、方程变形和建模关系式'], ['教师批注', '84条', '按概念、运算、方法和规范四类归档'], ['订正记录', '37份', '提取重新计算、方法修正和未订正状态'], ['正常完成', '39人', '答卷完整且逐题作答证据可识别'], ['非典型作答', '3人', '出现大面积跳步、答案猜测或过程无法辨认']], '全量数学作答证据结构化清单')}<div class="v4-hypothesis-list"><article><span>答卷完整度</span><strong>42/42 · 100%</strong><small>无缺交答卷，全部进入班级诊断</small></article><article><span>逐题关联度</span><strong>504/504 · 100%</strong><small>每条作答均已关联题目、学生、得分与过程证据</small></article><article><span>订正证据覆盖</span><strong>37/42 · 88.1%</strong><small>5名学生暂缺有效错题订正痕迹</small></article></div><div class="v4-final-boundary">${icon('scale')}阶段结果：完成42名学生、12道题、504条作答及1,286条关键步骤的结构化建链。</div>`;
    await playActivity(content, '正在结构化整理全量作答证据', [
      ['files', '解析全量学生作答', '解析所有题目或任务的学生作答、得分结果和过程痕迹'],
      ['tags', '标记作答状态', '标记正确、错误、空白、部分得分和非典型作答等情况'],
      ['scan-text', '提取过程性痕迹', '提取批改记录、订正记录、修改痕迹和过程性反馈'],
      ['route', '建立结构化证据链', '连接题目或任务、学生、作答、得分与证据']
    ], signal);
    await wait(1200, signal);
    commitStage(stage);
  }

  async function runTeachingReview(signal) {
    const stage = appendStage('teaching-review', '第四步 · 开展逐题诊断与正确表现校验', '定位失分原因并识别隐藏风险', '错题 · 失分 · 正确 · 风险');
    const content = stage.querySelector('.v4-stage-content');
    content.innerHTML = `<p class="v4-stage-copy">对504条作答逐题校验失分位置与正确过程。班级均分72.8分，主要失分集中在去括号符号、方程变形、数量关系建模和推理表达；同时识别“答案正确但过程不稳”的隐藏风险。</p><div class="v4-index-result"><div><strong>72.8</strong><span>班级本次均分</span></div><div><strong>98</strong><span>本次最高分</span></div><div><strong>41</strong><span>本次最低分</span></div><div><strong>83.3%</strong><span>60分及以上占比</span></div></div>${analysisTable(['重点题目', '班级作答表现', '主要失分与风险判断'], [['第3题 · 同类项辨析', '36人正确 · 85.7%', '6人混淆字母或指数不同的项'], ['第5题 · 去括号运算', '30人正确 · 71.4%', '12人漏乘括号内项或负号处理错误'], ['第7题 · 整式化简', '27人正确 · 64.3%', '15人运算顺序或合并法则使用不稳'], ['第9题 · 方程求解', '25人正确 · 59.5%', '17人移项变号或等式性质使用错误'], ['第11题 · 实际应用', '22人正确 · 52.4%', '20人无法准确提取数量关系并建立方程'], ['第12题 · 推理说明', '18人正确 · 42.9%', '24人依据不完整、过程跳步或结论表达不规范']], '逐题诊断与正确表现校验')}<div class="v4-cross-matrix"><div class="v4-cross-row"><span>稳定正确</span><strong>法则理解 × 过程完整 × 结果准确</strong><b class="is-support">24人 · 57.1%</b></div><div class="v4-cross-row"><span>会而不稳</span><strong>结果正确 × 步骤跳跃 × 方法单一</strong><b>10人 · 23.8%</b></div><div class="v4-cross-row"><span>重点失分</span><strong>符号处理 × 方程变形 × 数量建模</strong><b>覆盖20人</b></div></div><div class="v4-final-boundary">${icon('badge-check')}阶段结果：完成12道题、504条作答的失分诊断、正确过程校验与隐藏风险识别。</div>`;
    await playActivity(content, '正在开展逐题诊断与正确表现校验', [
      ['scan-search', '定位错题与失分环节', '定位涉及内容、作答环节、失分原因和错因类型'],
      ['circle-x', '判断具体失分原因', '区分不会、会而不稳、理解偏差、方法不当、表达不清或规范问题'],
      ['badge-check', '校验正确作答表现', '检查过程是否完整、方法是否稳定、表达是否可靠'],
      ['triangle-alert', '识别正确表现中的风险', '识别偶然做对、模板套用、猜测得分、低水平正确和隐藏风险']
    ], signal);
    await wait(1200, signal);
    commitStage(stage);
  }

  async function runSchoolJudgment(signal) {
    const stage = appendStage('school-judgment', '第五步 · 分析共性问题并完成分层判定', '形成核心问题、问题群体与优先干预结论', '共性 · 路径 · 优先级 · 分层');
    const content = stage.querySelector('.v4-stage-content');
    content.innerHTML = `<p class="v4-stage-copy">将同题和跨题的相似错误聚合到“知识要点 × 错因类型”矩阵后，班级共性问题集中在数学建模、推理表达、符号处理和方程变形。综合覆盖人数、失分量、复现风险和可干预性，完成问题优先级与学生群体分层。</p><div class="v4-discovery-grid"><article><span>班级优势 01</span><strong>基础概念掌握较稳</strong><small>36人能够准确辨析同类项，占85.7%</small></article><article><span>班级优势 02</span><strong>基础运算整体达标</strong><small>33人能够完成常规整式运算，占78.6%</small></article></div>${analysisTable(['分层判定项', '班级表现', '证据与优先级'], [['数量关系建模困难', '20人 · 47.6%', '累计失分140分，高覆盖、高失分，列为优先级A'], ['推理过程表达不完整', '24人 · 57.1%', '累计失分96分，跨题复现，列为优先级A'], ['去括号与符号错误', '18人 · 42.9%', '累计失分90分，迁移风险较高，列为优先级B'], ['方程变形不稳定', '17人 · 40.5%', '累计失分85分，方法掌握不稳，列为优先级B'], ['计算检查意识不足', '14人 · 33.3%', '累计失分56分，可通过过程清单干预，列为优先级C'], ['隐藏正确风险', '10人 · 23.8%', '过程跳步或依赖单一套路，需通过变式题复测']], '班级数学共性错因与分层判定')}<div class="v4-hypothesis-list"><article><span>核心诊断路径</span><strong>应用题失分 → 数量关系提取不准 → 数学建模能力断点</strong><small>覆盖20人，为全班讲评首要问题</small></article><article><span>学生问题分层</span><strong>稳定掌握12人 · 会而不稳20人 · 重点支持10人</strong><small>三类群体合计42人，分别配置迁移、巩固和补救任务</small></article><article><span>干预优先级</span><strong>先建模与推理，再符号与变形，最后检查规范</strong><small>依据覆盖人数、失分损失、题间复现和可干预性排序</small></article></div><div class="v4-boundary-strip"><span>${icon('shield-check')}阶段结果：形成2项优先级A共性错因、3类学生群体和分层干预顺序。</span></div>`;
    await playActivity(content, '正在分析共性问题并完成分层判定', [
      ['combine', '汇总相似错误', '汇总同题、同类任务或同一内容要点中的相似错误'],
      ['users-round', '判断班级共性问题', '判断相似错误是否构成班级共性问题'],
      ['scan-search', '分析共性问题来源', '追查共性问题的主要错因来源'],
      ['table-2', '建立内容与错因矩阵', '建立“内容要点 × 错因类型”分析矩阵'],
      ['triangle-alert', '识别重点问题', '识别高频、高失分、高覆盖和高迁移风险问题'],
      ['route', '追溯关联错因链条', '连接当前内容、前置基础和关联内容之间的错因关系'],
      ['git-branch', '建立诊断路径模型', '形成“表层表现 → 直接错因 → 内容断点 → 能力断点”的诊断路径'],
      ['list-checks', '判定核心问题优先级', '综合人数覆盖、得分损失、题间复现和可干预性进行判定'],
      ['layers-3', '完成学生群体分层', '区分全班共性问题、群体问题和个体支持点'],
      ['network', '划分干预问题群体', '按错因表现、掌握程度和干预需求划分学生问题群体']
    ], signal);
    await wait(1250, signal);
    commitStage(stage);
  }

  async function runSupportPlan(signal) {
    const stage = appendStage('support-plan', '第六步 · 生成班级诊断报告与教学改进方案', '输出班级诊断结论与可执行的教学改进闭环', '报告 · 建议 · 跟踪');
    const content = stage.querySelector('.v4-stage-content');
    content.innerHTML = `<p class="v4-stage-copy">基于42名学生的数学错因诊断结论，生成班级整体表现、逐题错因、群体分层和优先干预建议，并建立“诊断结论—教学行动—学生练习—复测验证”的改进闭环。</p><div class="v4-support-grid"><div class="v4-plan-column"><h4>全班共性讲评</h4><div class="v4-plan-item is-keep">${icon('network')}<span><b>关系建模</b>用线段图、表格和关系式重建20人的应用题数量关系。</span></div><div class="v4-plan-item is-keep">${icon('list-checks')}<span><b>推理补链</b>以“依据—步骤—结论”规范24人的数学过程表达。</span></div><div class="v4-plan-item is-watch">${icon('calculator')}<span><b>符号纠错</b>通过去括号对比题改善18人的负号与分配问题。</span></div></div><div class="v4-plan-column"><h4>分层训练安排</h4><div class="v4-plan-item is-keep">${icon('sparkles')}<span><b>迁移提升</b>稳定掌握组12人完成开放性建模变式题。</span></div><div class="v4-plan-item is-keep">${icon('repeat-2')}<span><b>重点巩固</b>会而不稳组20人完成方程变形与过程表达专项练习。</span></div><div class="v4-plan-item is-watch">${icon('users-round')}<span><b>支架补救</b>重点支持组10人使用步骤卡和关系图完成基础重练。</span></div></div><div class="v4-plan-column"><h4>个别支持与复测</h4><div class="v4-plan-item is-keep">${icon('user-check')}<span><b>个别面批</b>为10名重点支持学生安排一对一错因反馈。</span></div><div class="v4-plan-item is-keep">${icon('pen-line')}<span><b>错题订正</b>要求42名学生按“错因—正解—检验”完成规范订正。</span></div><div class="v4-plan-item is-watch">${icon('history')}<span><b>变式复测</b>一周后使用同知识不同情境题检验稳定迁移。</span></div></div></div>${analysisTable(['干预对象', '重点任务', '对应诊断问题', '跟踪方式'], [['全班42人', '数量关系建模与推理表达专题讲评', '应用题建模困难、过程依据不完整', '讲评后完成第11、12题变式订正'], ['会而不稳组20人', '去括号、方程变形与过程规范专项训练', '方法掌握不稳定、正确过程证据不足', '3组分层练习与课堂即时反馈'], ['重点支持组10人', '概念辨析、步骤卡训练与个别面批', '概念、运算和建模存在复合错因', '一对一反馈及一周后变式复测']], '班级数学教学改进与闭环跟踪方案')}<div class="v4-final-boundary">${icon('shield-check')}阶段结果：形成1次全班讲评、3类分层任务、10人个别补救和1周后数学变式复测方案。</div>`;
    await playActivity(content, '正在生成班级诊断报告与教学改进方案', [
      ['chart-no-axes-combined', '生成班级整体表现', '呈现班级整体表现、关键得分情况和主要失分分布'],
      ['scan-search', '输出逐题诊断结果', '输出逐题或逐任务的错因表现、证据依据和风险点'],
      ['clipboard-check', '形成班级核心结论', '形成班级共性问题、群体分层和优先干预结论'],
      ['presentation', '设计分层教学建议', '设计全班讲评、分层训练、个别补救和变式迁移任务'],
      ['repeat-2', '建立改进闭环跟踪', '形成“诊断结论 - 教学行动 - 学生练习 - 复测验证”的改进闭环']
    ], signal);
    await wait(1250, signal);
    commitStage(stage);
  }

  const REPORT_URL = 'assets/shanghai-keller-school-writing-report.html?v=school-writing-v4-06';

  function renderReport() {
    $('reportDocument').innerHTML = `<iframe class="v4-report-frame" title="上海民办克勒外国语学校本学期初中语文学科作文综合分析报告" src="${REPORT_URL}"></iframe>`;
  }

  function openReportPreview() {
    renderReport();
    document.body.classList.add('report-open');
    const dialog = $('reportDialog');
    if (!dialog.open) {
      dialog.classList.remove('is-visible');
      dialog.show();
      requestAnimationFrame(() => requestAnimationFrame(() => dialog.classList.add('is-visible')));
    } else dialog.classList.add('is-visible');
  }

  function closeReportPreview() {
    const dialog = $('reportDialog');
    dialog.classList.remove('is-visible');
    document.body.classList.remove('report-open');
    setTimeout(() => { if (dialog.open) dialog.close(); }, state.reducedMotion ? 10 : 260);
  }

  async function downloadReport() {
    const link = document.createElement('a');
    // 直接下载随包附带的本地报告，避免 file:// 页面调用 fetch 时被浏览器拦截。
    link.href = REPORT_URL;
    link.download = '上海民办克勒外国语学校 · 本学期初中语文学科作文综合分析报告.html';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function completeResearch() {
    compressCompleted();
    pauseTimer();
    state.running = false;
    state.stopped = false;
    const canvas = document.querySelector('.v4-research-canvas');
    canvas?.classList.add('is-finished');
    canvas?.querySelector('.v4-canvas-state')?.remove();
    const canvasTurn = document.querySelector('[data-turn="research-canvas"]');
    if (canvasTurn) {
      canvasTurn.dataset.complete = 'true';
      delete canvasTurn.dataset.transient;
    }
    refreshIcons();
    scrollLatest(true);
    window.dispatchEvent(new CustomEvent('class-diagnosis:complete'));
  }

  async function runResearch() {
    if (state.running || !state.runners.length) return;
    state.running = true;
    state.stopped = false;
    state.startedAt = Date.now();
    state.controller = new AbortController();
    startTimer();
    try {
      while (state.cursor < state.runners.length) {
        await state.runners[state.cursor](state.controller.signal);
        state.cursor += 1;
      }
      completeResearch();
    } catch (error) {
      if (error.name !== 'AbortError') {
        pauseTimer();
        state.running = false;
        $('errorMessage').hidden = false;
        $('errorMessage').textContent = `研究过程暂时中断：${error.message}`;
        return;
      }
      document.querySelectorAll('[data-transient="true"]').forEach((node) => node.remove());
      pauseTimer();
      state.running = false;
      state.stopped = true;
      refreshIcons();
    }
  }

  function restartResearch() {
    state.controller?.abort();
    setTimeout(() => {
      state.running = false;
      state.stopped = false;
      state.cursor = 0;
      state.elapsedBeforeStart = 0;
      $('agentStream').innerHTML = '';
      $('errorMessage').hidden = true;
      closeReportPreview();
      runResearch();
    }, state.reducedMotion ? 15 : 80);
  }

  function appendFollowup() {
    const input = $('followupInput');
    const text = input.value.trim();
    if (!text) return;
    const user = document.createElement('div');
    user.className = 'v4-followup-user';
    user.textContent = text;
    $('agentStream').appendChild(user);
    input.value = '';
    $('sendFollowup').disabled = true;
    const turn = createTurn(`followup-${Date.now()}`, { title: '追问已回应', meta: '基于当前学校作文报告' });
    const lead = turn.querySelector('.v4-turn-lead');
    if (/七年级|审题|结构/.test(text)) {
      lead.textContent = '七年级是本学期能力提升关键薄弱学段，审题立意、篇章结构短板最突出；习作修改平均提分1.63分，较多学生仍停留在字词修改。';
    } else if (/修改|二改|迁移/.test(text)) {
      lead.textContent = '全校二次修改平均提分2.31分，68.7%习作修改后得分上涨；但方法稳定迁移占比仅39.2%，下一阶段需要把“单篇修改”转向“思维迭代”。';
    } else if (/文体|读后感|调查/.test(text)) {
      lead.textContent = '本学期记叙文占92.7%，研究调查报告2.8%、读后感2.3%、演讲稿2.3%。非记叙文体训练和配套讲评、二次修改仍需补齐。';
    } else {
      lead.textContent = '这个关注方向已记录。当前回答继续以现有数据口径和六步诊断结果为依据。';
    }
    finishTurn(turn);
    refreshIcons();
    scrollLatest();
  }

  function bindEvents() {
    $('closeReport').addEventListener('click', closeReportPreview);
    $('downloadReport').addEventListener('click', downloadReport);
    $('agentStream').addEventListener('click', (event) => {
      const stageHeading = event.target.closest('.v4-stage-heading');
      if (stageHeading) {
        const stage = stageHeading.closest('.v4-research-stage');
        if (stage?.classList.contains('is-complete')) {
          stage.classList.toggle('is-collapsed');
          stageHeading.setAttribute('aria-expanded', String(!stage.classList.contains('is-collapsed')));
        }
        return;
      }
      const summary = event.target.closest('.v4-turn-summary');
      if (summary) {
        const turn = summary.closest('.v4-turn');
        turn.classList.toggle('is-expanded');
        summary.setAttribute('aria-expanded', String(turn.classList.contains('is-expanded')));
      }
    });
    $('reportDialog').addEventListener('close', () => document.body.classList.remove('report-open'));
  }

  let initialized = false;

  function init() {
    if (initialized) return;
    state.runners = [runSchoolOverview, runLayerAnalysis, runProblemDiagnosis, runTeachingReview, runSchoolJudgment, runSupportPlan];
    bindEvents();
    refreshIcons();
    initialized = true;
  }

  function startResearchSequence() {
    init();
    if (state.running || state.cursor > 0 || $('agentStream').childElementCount > 0) {
      restartResearch();
      return;
    }
    runResearch();
  }

  if ($('thirdScreen')) {
    window.addEventListener('class-diagnosis:start', startResearchSequence);
    window.addEventListener('class-diagnosis:stop', () => state.controller?.abort());
  } else {
    startResearchSequence();
  }
}());
