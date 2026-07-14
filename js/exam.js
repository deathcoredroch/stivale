// ============ ФИНАЛЬНЫЙ ПИСЬМЕННЫЙ ЭКЗАМЕН (lesson-43, «data-final-exam») ============
// Урок кладёт в раздел один холдер:
//   <div class="final-exam" data-final-exam>
//     <script type="application/json">{"questions":[…],"lettura":[…],"ascolto":[…],"produzione":[…]}</script>
//   </div>
// Типы автопроверяемых вопросов (в "questions" и внутри "lettura[].questions"):
//   single     — {"type":"single","q":"…","options":[…],"correct":0,"explain":"…"}
//   multi      — {"type":"multi","options":[…],"correct":[0,2],"explain":"…"} (несколько верных)
//   text       — {"type":"text","correct":"слово" | ["вариант1","вариант2"],"explain":"…"}
//   truefalse  — {"type":"truefalse","correct":true|false,"explain":"…"}
//   match      — {"type":"match","left":[…],"right":[…],"correct":[индексы right по порядку left]}
// "ascolto[]" — те же поля single + "say" (текст для window.speakIt), без явного "type".
// "produzione[]" — {"prompt":"…","minSentences":N}, не проверяется автоматически, уходит в ИИ-фидбек.
//
// Балл считается по всем автопроверяемым вопросам сразу (лексика+грамматика+чтение+аудирование).
// Результат (последняя и лучшая попытка) сохраняется в localStorage под ключом 'final_exam'
// и синхронизируется через реестр CLOUD_KEYS в app.js (см. FINAL_EXAM_KEY / mergeFinalExam там же).

(function () {
  const EXAM_STORAGE_KEY = 'final_exam';
  const AI_FEEDBACK_URL = 'http://localhost:3002/api/exam-feedback';

  const EXAM_BADGES = [
    { min: 90, cls: 'exc',  label: 'Eccellente',  note: 'Курс освоен уверенно — можно закрывать A2.' },
    { min: 75, cls: 'good', label: 'Molto bene',  note: 'Отдельные пробелы, но база прочная.' },
    { min: 60, cls: 'ok',   label: 'Sufficiente', note: 'Стоит точечно повторить темы с низким процентом ниже.' },
    { min: 0,  cls: 'low',  label: 'Da ripetere', note: 'Рекомендовано отдельное занятие-повтор перед завершением курса.' },
  ];
  function badgeFor(pct) { return EXAM_BADGES.find(b => pct >= b.min) || EXAM_BADGES[EXAM_BADGES.length - 1]; }

  const LISTEN_ICON = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>' +
    '<path d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
    '<path d="M18.07 5.93a9 9 0 0 1 0 12.14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  function examEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }
  function examGapify(s) { return examEsc(s).replace(/_{2,}/g, '<span class="exam-gap"></span>'); }
  function examNorm(s) {
    return String(s == null ? '' : s).toLowerCase().trim()
      .replace(/[''`´]/g, "'")
      .replace(/\s+/g, ' ');
  }
  function textMatches(userVal, correct) {
    const accepted = Array.isArray(correct) ? correct : [correct];
    const u = examNorm(userVal);
    if (!u) return false;
    return accepted.some(a => examNorm(a) === u);
  }
  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ── Точка входа: вызывается из showLesson() в app.js, как и initLessonGames ──
  function initFinalExam(rootEl) {
    if (!rootEl) return;
    rootEl.querySelectorAll('[data-final-exam]').forEach(holder => {
      let bank = null;
      const src = holder.querySelector('script[type="application/json"]');
      try { bank = JSON.parse(src ? src.textContent : ''); }
      catch (e) { console.error('[exam] не удалось разобрать банк вопросов', e); }
      if (!bank || !Array.isArray(bank.questions)) { holder.style.display = 'none'; return; }
      bank.lettura = bank.lettura || [];
      bank.ascolto = bank.ascolto || [];
      bank.produzione = bank.produzione || [];
      buildFinalExam(holder, bank);
    });
  }

  // Раздел (section) — крупная группа для компактной сводки результата: всего 4 штуки
  // вместо ~50 мелких «тем» (q.cat). Порядок фиксирован для стабильного вывода.
  const SECTION_ORDER = ['Лексика', 'Грамматика', 'Чтение', 'Аудирование'];
  function buildGradedList(bank) {
    const list = bank.questions.map(q => ({ ...q, section: q.block === 'grammatica' ? 'Грамматика' : 'Лексика' }));
    bank.lettura.forEach(l => l.questions.forEach(q => list.push({ ...q, section: 'Чтение' })));
    bank.ascolto.forEach(q => list.push({ ...q, type: 'listen', section: 'Аудирование' }));
    return list;
  }

  function buildFinalExam(holder, bank) {
    const state = { holder, bank, gradedList: buildGradedList(bank) };
    holder.innerHTML = renderExamShell(bank, state.gradedList.length);
    wireExamShell(state);
  }

  // ══════════════════════════ РЕНДЕР ВОПРОСОВ ══════════════════════════

  function renderChoiceInput(qid, options, inputType) {
    const name = `f_${qid}`;
    return `<div class="exam-opts">${options.map((opt, i) => `
      <label class="exam-opt">
        <input type="${inputType}" name="${examEsc(name)}" value="${i}" data-role="opt">
        <span>${examEsc(opt)}</span>
      </label>`).join('')}</div>`;
  }
  function renderTrueFalseInput(qid) {
    const name = `tf_${qid}`;
    return `<div class="exam-opts exam-opts-tf">
      <label class="exam-opt"><input type="radio" name="${examEsc(name)}" value="true" data-role="tf"><span>Vero</span></label>
      <label class="exam-opt"><input type="radio" name="${examEsc(name)}" value="false" data-role="tf"><span>Falso</span></label>
    </div>`;
  }
  function renderTextInput() {
    return `<input type="text" class="exam-text-input" data-role="text" autocomplete="off" spellcheck="false" placeholder="Впиши ответ">`;
  }
  function renderMatchInput(q) {
    return `<div class="exam-match">${q.left.map((l) => `
      <div class="exam-match-row">
        <span class="exam-match-left">${examEsc(l)}</span>
        <span class="exam-match-arrow">→</span>
        <select class="exam-match-select" data-role="match">
          <option value="">—</option>
          ${q.right.map((r, j) => `<option value="${j}">${examEsc(r)}</option>`).join('')}
        </select>
      </div>`).join('')}</div>`;
  }

  function renderQuestion(q) {
    let body = '';
    if (q.type === 'single' || q.type === 'listen') body = renderChoiceInput(q.id, q.options, 'radio');
    else if (q.type === 'multi') body = renderChoiceInput(q.id, q.options, 'checkbox');
    else if (q.type === 'truefalse') body = renderTrueFalseInput(q.id);
    else if (q.type === 'text') body = renderTextInput();
    else if (q.type === 'match') body = renderMatchInput(q);
    return `
      <div class="exam-q" data-qid="${examEsc(q.id)}">
        <div class="exam-q-cat">${examEsc(q.cat)}${q.type === 'multi' ? ' <em>· выбери все верные варианты</em>' : ''}</div>
        <div class="exam-q-text">${examGapify(q.q)}</div>
        ${body}
        <div class="exam-reveal-slot"></div>
      </div>`;
  }

  function renderLessicoBlock(questions) {
    const items = questions.filter(q => q.block === 'lessico');
    if (!items.length) return '';
    return `<div class="exam-block"><h3 class="exam-block-title">1 · Лексика</h3>${items.map(renderQuestion).join('')}</div>`;
  }
  function renderGrammaticaBlock(questions) {
    const items = questions.filter(q => q.block === 'grammatica');
    if (!items.length) return '';
    return `<div class="exam-block"><h3 class="exam-block-title">2 · Грамматика</h3>${items.map(renderQuestion).join('')}</div>`;
  }
  function renderLetturaBlock(lettura) {
    if (!lettura.length) return '';
    return `<div class="exam-block"><h3 class="exam-block-title">3 · Чтение</h3>
      ${lettura.map(l => `
        <div class="exam-reading">
          <div class="exam-reading-text" data-lang="it">${examEsc(l.textIt)}</div>
          <button type="button" class="exam-reading-toggle" data-role="toggle-translation">Показать перевод</button>
          <div class="exam-reading-text exam-reading-ru" data-lang="ru" hidden>${examEsc(l.textRu)}</div>
        </div>
        ${l.questions.map(renderQuestion).join('')}
      `).join('')}
    </div>`;
  }
  function renderAscoltoBlock(items) {
    if (!items.length) return '';
    return `<div class="exam-block"><h3 class="exam-block-title">4 · Аудирование</h3>
      ${items.map(q => `
        <div class="exam-q" data-qid="${examEsc(q.id)}">
          <div class="exam-q-cat">${examEsc(q.cat)}</div>
          <button type="button" class="exam-listen-btn" data-role="listen" data-say="${examEsc(q.say)}">${LISTEN_ICON}<span>Слушать фразу</span></button>
          ${renderChoiceInput(q.id, q.options, 'radio')}
          <div class="exam-reveal-slot"></div>
        </div>
      `).join('')}
    </div>`;
  }
  function renderProduzioneBlock(items) {
    if (!items.length) return '';
    return `<div class="exam-block"><h3 class="exam-block-title">5 · Письмо (открытые задания)</h3>
      ${items.map(p => `
        <div class="exam-q exam-q-open" data-qid="${examEsc(p.id)}">
          <div class="exam-q-text">${examGapify(p.prompt)}</div>
          <textarea class="exam-open-textarea" data-role="open" placeholder="Напиши здесь минимум ${p.minSentences || 5} предложений…"></textarea>
        </div>
      `).join('')}
    </div>`;
  }

  function renderExamShell(bank, totalGraded) {
    const prev = window.storageGet ? window.storageGet(EXAM_STORAGE_KEY) : null;
    const prevHtml = (prev && prev.last)
      ? `<p class="exam-intro-prev">Последняя попытка: <b>${prev.last.pct}%</b>${prev.best ? ` · лучшая: <b>${prev.best.pct}%</b>` : ''}</p>`
      : '';
    return `
      <div class="exam-intro" data-exam-intro>
        <p class="exam-intro-text">Всего ${totalGraded} вопросов на автопроверку + ${bank.produzione.length} открытых письменных задания. Таймера нет — отвечай в своём темпе, кнопка «Проверить» доступна в любой момент, пропущенные вопросы просто идут в зачёт как неверные.</p>
        ${prevHtml}
        <button type="button" class="exam-start-btn" data-role="exam-start">${prev && prev.last ? 'Пройти заново' : 'Начать тест'}</button>
      </div>
      <div class="exam-body" data-exam-body hidden>
        ${renderLessicoBlock(bank.questions)}
        ${renderGrammaticaBlock(bank.questions)}
        ${renderLetturaBlock(bank.lettura)}
        ${renderAscoltoBlock(bank.ascolto)}
        ${renderProduzioneBlock(bank.produzione)}
        <div class="exam-submit-bar">
          <span class="exam-submit-progress" data-exam-progress>Отвечено 0 из ${totalGraded}</span>
          <button type="button" class="exam-submit-btn" data-role="exam-submit">Проверить</button>
        </div>
      </div>
      <div class="exam-results" data-exam-results hidden></div>
    `;
  }

  // ══════════════════════════ ВЗАИМОДЕЙСТВИЕ ══════════════════════════

  function isAnswered(qEl, q) {
    switch (q.type) {
      case 'single': case 'listen': return !!qEl.querySelector('input[data-role="opt"]:checked');
      case 'multi': return !!qEl.querySelector('input[data-role="opt"]:checked');
      case 'truefalse': return !!qEl.querySelector('input[data-role="tf"]:checked');
      case 'text': { const i = qEl.querySelector('input[data-role="text"]'); return !!(i && i.value.trim()); }
      case 'match': { const s = [...qEl.querySelectorAll('select[data-role="match"]')]; return s.length > 0 && s.every(x => x.value !== ''); }
      default: return false;
    }
  }

  function wireExamShell(state) {
    const { holder, bank, gradedList } = state;
    const introEl = holder.querySelector('[data-exam-intro]');
    const bodyEl = holder.querySelector('[data-exam-body]');
    const resultsEl = holder.querySelector('[data-exam-results]');
    const progressEl = bodyEl.querySelector('[data-exam-progress]');

    const updateProgress = () => {
      let n = 0;
      gradedList.forEach(q => {
        const qEl = bodyEl.querySelector(`[data-qid="${q.id}"]`);
        if (qEl && isAnswered(qEl, q)) n++;
      });
      progressEl.textContent = `Отвечено ${n} из ${gradedList.length}`;
    };
    const debouncedProgress = debounce(updateProgress, 250);

    introEl.querySelector('[data-role="exam-start"]').addEventListener('click', () => {
      introEl.hidden = true;
      bodyEl.hidden = false;
      resultsEl.hidden = true;
      resultsEl.innerHTML = '';
      holder.scrollIntoView({ behavior: 'smooth', block: 'start' });
      updateProgress();
    });

    bodyEl.addEventListener('change', updateProgress);
    bodyEl.addEventListener('input', debouncedProgress);

    bodyEl.addEventListener('click', (e) => {
      const listenBtn = e.target.closest('[data-role="listen"]');
      if (listenBtn) {
        const text = listenBtn.getAttribute('data-say');
        listenBtn.classList.add('is-playing');
        const done = () => listenBtn.classList.remove('is-playing');
        if (window.speakIt) window.speakIt(text).then(done).catch(done);
        else done();
        return;
      }
      const toggleBtn = e.target.closest('[data-role="toggle-translation"]');
      if (toggleBtn) {
        const wrap = toggleBtn.closest('.exam-reading');
        const ru = wrap.querySelector('[data-lang="ru"]');
        const showing = !ru.hidden;
        ru.hidden = showing;
        toggleBtn.textContent = showing ? 'Показать перевод' : 'Скрыть перевод';
        return;
      }
      const submitBtn = e.target.closest('[data-role="exam-submit"]');
      if (submitBtn) { gradeExam(state); }
    });

    updateProgress();
  }

  // ══════════════════════════ ПРОВЕРКА И БАЛЛЫ ══════════════════════════

  function gradeQuestion(qEl, q) {
    switch (q.type) {
      case 'single': case 'listen': {
        const checked = qEl.querySelector('input[data-role="opt"]:checked');
        return checked ? +checked.value === q.correct : false;
      }
      case 'multi': {
        const checked = [...qEl.querySelectorAll('input[data-role="opt"]:checked')].map(i => +i.value).sort((a, b) => a - b);
        const correctArr = [...q.correct].sort((a, b) => a - b);
        return checked.length === correctArr.length && checked.every((v, i) => v === correctArr[i]);
      }
      case 'truefalse': {
        const checked = qEl.querySelector('input[data-role="tf"]:checked');
        return checked ? (checked.value === 'true') === q.correct : false;
      }
      case 'text': {
        const input = qEl.querySelector('input[data-role="text"]');
        return textMatches(input ? input.value : '', q.correct);
      }
      case 'match': {
        const sels = [...qEl.querySelectorAll('select[data-role="match"]')];
        const userAns = sels.map(s => s.value === '' ? null : +s.value);
        return q.correct.every((c, i) => userAns[i] === c);
      }
      default: return false;
    }
  }

  function renderCorrection(q) {
    let answerText = '';
    switch (q.type) {
      case 'single': case 'listen': answerText = q.options[q.correct]; break;
      case 'multi': answerText = q.correct.map(i => q.options[i]).join(', '); break;
      case 'truefalse': answerText = q.correct ? 'Vero' : 'Falso'; break;
      case 'text': answerText = Array.isArray(q.correct) ? q.correct[0] : q.correct; break;
      case 'match': answerText = q.left.map((l, i) => `${l} → ${q.right[q.correct[i]]}`).join('; '); break;
    }
    return `<div class="exam-correction">
      <p class="exam-correction-answer">Правильно: <b>${examEsc(answerText)}</b></p>
      ${q.explain ? `<p class="exam-correction-rule">${examEsc(q.explain)}</p>` : ''}
    </div>`;
  }

  function saveExamAttempt(pct, byCategory) {
    const rec = { pct, byCategory, t: Date.now() };
    const cur = (window.storageGet && window.storageGet(EXAM_STORAGE_KEY)) || {};
    const best = (!cur.best || pct > cur.best.pct) ? rec : cur.best;
    const next = { last: rec, best };
    if (window.storageSet) window.storageSet(EXAM_STORAGE_KEY, next);
    if (window.cloudPush) window.cloudPush(EXAM_STORAGE_KEY);
    return next;
  }

  function gradeExam(state) {
    const { holder, bank, gradedList } = state;
    const bodyEl = holder.querySelector('[data-exam-body]');
    const resultsEl = holder.querySelector('[data-exam-results]');

    bodyEl.querySelectorAll('.exam-q').forEach(el => {
      el.classList.remove('is-correct', 'is-wrong');
      const slot = el.querySelector('.exam-reveal-slot');
      if (slot) slot.innerHTML = '';
    });

    const catTotals = {};
    const sectionTotals = {};
    let totalCorrect = 0;

    gradedList.forEach(q => {
      const qEl = bodyEl.querySelector(`[data-qid="${q.id}"]`);
      if (!qEl) return;
      const correct = gradeQuestion(qEl, q);
      catTotals[q.cat] = catTotals[q.cat] || { correct: 0, total: 0 };
      catTotals[q.cat].total++;
      const sec = q.section || 'Прочее';
      sectionTotals[sec] = sectionTotals[sec] || { correct: 0, total: 0 };
      sectionTotals[sec].total++;
      if (correct) {
        catTotals[q.cat].correct++;
        sectionTotals[sec].correct++;
        totalCorrect++;
        qEl.classList.add('is-correct');
      } else {
        qEl.classList.add('is-wrong');
        const slot = qEl.querySelector('.exam-reveal-slot');
        if (slot) slot.innerHTML = renderCorrection(q);
      }
    });

    const totalGraded = gradedList.length;
    const pct = totalGraded ? Math.round((totalCorrect / totalGraded) * 100) : 0;
    const byCategory = Object.entries(catTotals)
      .map(([cat, v]) => ({ cat, correct: v.correct, total: v.total, pct: v.total ? Math.round((v.correct / v.total) * 100) : 0 }))
      .sort((a, b) => a.pct - b.pct);
    const bySection = SECTION_ORDER
      .filter(s => sectionTotals[s])
      .map(s => ({ cat: s, correct: sectionTotals[s].correct, total: sectionTotals[s].total,
        pct: sectionTotals[s].total ? Math.round((sectionTotals[s].correct / sectionTotals[s].total) * 100) : 0 }));

    const essays = bank.produzione.map(p => {
      const ta = bodyEl.querySelector(`[data-qid="${p.id}"] textarea`);
      return { prompt: p.prompt, text: ta ? ta.value.trim() : '' };
    });

    saveExamAttempt(pct, byCategory);

    resultsEl.hidden = false;
    resultsEl.innerHTML = renderResults(pct, totalCorrect, totalGraded, bySection, byCategory);
    wireResults(state, resultsEl, byCategory, bySection, essays);
    resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ══════════════════════════ РЕЗУЛЬТАТЫ И ИИ-ФИДБЕК ══════════════════════════

  // Уровень результата → класс-тон для мини-карточек и чипов (по проценту)
  function toneFor(pct) {
    if (pct >= 85) return 'hi';
    if (pct >= 60) return 'mid';
    return 'lo';
  }

  function renderResults(pct, correct, total, bySection, byCategory) {
    const badge = badgeFor(pct);
    // Компактная сводка по 4 разделам вместо длинного списка «тем»
    const sectionCards = bySection.map(s => `
      <div class="exam-sec-card exam-tone-${toneFor(s.pct)}">
        <span class="exam-sec-name">${examEsc(s.cat)}</span>
        <span class="exam-sec-pct">${s.pct}<i>%</i></span>
        <span class="exam-sec-bar"><span style="width:${s.pct}%"></span></span>
        <span class="exam-sec-frac">${s.correct}/${s.total}</span>
      </div>`).join('');

    // Слабые темы — только те, что ниже 100%, максимум 6, компактными чипами
    const weak = byCategory.filter(c => c.pct < 100).slice(0, 6);
    const weakBlock = weak.length ? `
      <div class="exam-weak">
        <span class="exam-weak-label">Стоит повторить</span>
        <div class="exam-weak-chips">
          ${weak.map(c => `<span class="exam-chip exam-tone-${toneFor(c.pct)}">${examEsc(c.cat)} <b>${c.pct}%</b></span>`).join('')}
        </div>
      </div>` : `
      <div class="exam-weak exam-weak-clean">
        <span class="exam-weak-label">Слабых тем нет — результат ровный по всем разделам 👏</span>
      </div>`;

    // Полная разбивка по всем ~50 темам спрятана в свёрнутый блок, чтобы не «простыня»
    const fullDetails = `
      <details class="exam-cat-details">
        <summary>Подробная разбивка по всем темам (${byCategory.length})</summary>
        <div class="exam-cat-list">
          ${byCategory.map(c => `
            <div class="exam-cat-row exam-tone-${toneFor(c.pct)}">
              <span class="exam-cat-name">${examEsc(c.cat)}</span>
              <span class="exam-cat-bar"><span class="exam-cat-fill" style="width:${c.pct}%"></span></span>
              <span class="exam-cat-pct">${c.pct}%</span>
            </div>
          `).join('')}
        </div>
      </details>`;

    return `
      <div class="exam-score-head exam-badge-${badge.cls}">
        <div class="exam-score-num">${pct}%</div>
        <div class="exam-score-sub">${correct} из ${total} верно</div>
        <div class="exam-score-badge">${examEsc(badge.label)}</div>
        <p class="exam-score-note">${examEsc(badge.note)}</p>
      </div>
      <div class="exam-sec-grid">${sectionCards}</div>
      ${weakBlock}
      <div class="exam-ai-feedback" data-exam-ai>
        <div class="exam-ai-loading"><span class="exam-spinner"></span>ИИ анализирует твой результат…</div>
      </div>
      ${fullDetails}
      <button type="button" class="exam-restart-btn" data-role="exam-restart">Пройти заново</button>
    `;
  }

  function renderAiFeedbackBox(text, isAi) {
    const paras = String(text || '').split(/\n+/).filter(Boolean)
      .map(p => `<p class="exam-ai-text">${examEsc(p)}</p>`).join('');
    const tag = isAi
      ? '<span class="exam-ai-tag">ИИ-разбор</span>'
      : '<span class="exam-ai-tag exam-ai-tag-off">офлайн</span>';
    return `<div class="exam-ai-head">${tag}Персональный вывод</div>${paras}`;
  }

  // Офлайн-вывод: короткий, структурный, по разделам — не выдаёт себя за ИИ.
  function buildOfflineExamFeedback(bySection, byCategory, essays) {
    const overall = bySection.reduce((a, s) => a + s.correct, 0);
    const totalQ = bySection.reduce((a, s) => a + s.total, 0);
    const pct = totalQ ? Math.round((overall / totalQ) * 100) : 0;
    const strongSec = bySection.filter(s => s.pct >= 85).map(s => s.cat.toLowerCase());
    const weakSec = [...bySection].sort((a, b) => a.pct - b.pct).filter(s => s.pct < 75).slice(0, 2);
    const weakTopics = byCategory.filter(c => c.pct < 60).slice(0, 3).map(c => c.cat);
    const lines = [];

    if (pct >= 85) lines.push(`Сильный результат — ${pct}%. Уровень A2 подтверждён: база курса усвоена уверенно.`);
    else if (pct >= 60) lines.push(`Хороший результат — ${pct}%. Основа прочная, осталось закрыть несколько точечных пробелов.`);
    else lines.push(`Результат ${pct}% — базу стоит укрепить, прежде чем закрывать курс. Это нормальный этап, а не провал.`);

    if (strongSec.length) lines.push(`Крепче всего держится: ${strongSec.join(', ')}.`);
    if (weakSec.length) {
      lines.push(`Приоритет для повторения — ${weakSec.map(s => `${s.cat.toLowerCase()} (${s.pct}%)`).join(' и ')}.` +
        (weakTopics.length ? ` Конкретно просели темы: ${weakTopics.join(', ')} — вернись к соответствующим урокам.` : ''));
    } else {
      lines.push('Проваленных разделов нет — картина ровная, добивай отдельные темы из списка ниже.');
    }

    const filled = essays.filter(e => e.text.length > 0).length;
    if (essays.length) {
      lines.push(filled < essays.length
        ? `Открытых письменных заданий заполнено ${filled} из ${essays.length} — допиши остальные: в балл они не идут, но это лучшая тренировка речи перед финалом.`
        : `Все ${essays.length} письменных задания написаны — отличная финальная практика речи.`);
    }
    return lines.join('\n');
  }

  async function loadExamFeedback(box, byCategory, bySection, essays) {
    const overall = bySection.reduce((a, s) => a + s.correct, 0);
    const totalQ = bySection.reduce((a, s) => a + s.total, 0);
    const overallPct = totalQ ? Math.round((overall / totalQ) * 100) : 0;
    const sections = bySection.map(s => ({ name: s.cat, pct: s.pct, correct: s.correct, total: s.total }));
    const weak = byCategory.filter(c => c.pct < 100).slice(0, 8).map(c => `${c.cat} (${c.pct}%)`);
    const strong = byCategory.filter(c => c.pct >= 90).map(c => c.cat);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      const r = await fetch(AI_FEEDBACK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({ overallPct, sections, weakCategories: weak, strongCategories: strong, essays }),
      });
      clearTimeout(timer);
      if (!r.ok) throw new Error('server ' + r.status);
      const d = await r.json();
      if (!d.feedback) throw new Error('empty feedback');
      box.innerHTML = renderAiFeedbackBox(d.feedback, true);
    } catch (e) {
      box.innerHTML = renderAiFeedbackBox(buildOfflineExamFeedback(bySection, byCategory, essays), false);
    }
  }

  function wireResults(state, resultsEl, byCategory, bySection, essays) {
    resultsEl.querySelector('[data-role="exam-restart"]').addEventListener('click', () => {
      buildFinalExam(state.holder, state.bank);
    });
    const box = resultsEl.querySelector('[data-exam-ai]');
    loadExamFeedback(box, byCategory, bySection, essays);
  }

  window.initFinalExam = initFinalExam;
})();
