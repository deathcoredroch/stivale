// ============ УСТНЫЙ ЭКЗАМЕН (lesson-42, «data-oral-exam») ============
// Урок кладёт в секцию холдер:
//   <div class="oral-exam" data-oral-exam>
//     <script type="application/json">{"colloquio":[…],"biglietti":[…],"scene":[…],"ruoli":[…]}</script>
//   </div>
// Движок ведёт экзамен по шагам: интро → Parte I Colloquio (умный жребий вопросов с
// гарантией покрытия времён) → Parte II Il biglietto (тянет билет, таймер подготовки/
// монолога со звуковыми сигналами) → Parte III La scena (случайная эмодзи-сцена) →
// Parte IV Il gioco di ruolo (случайная ролевая ситуация) → вердикт комиссии
// (5 критериев + чек-лист грамматики) → сертификат.
// Оценки выставляет живой экзаменатор (преподаватель); движок только считает балл.
// Итальянские реплики озвучиваются через window.speakIt (см. js/audio.js).
//
// Сессия в процессе хранится в sessionStorage (SESSION_KEY) и автоматически
// восстанавливается при пересоздании холдера — облачная синхронизация умеет
// перерисовать открытый урок посреди занятия, и без этого весь прогресс
// 85-минутного экзамена слетал бы на интро.
//
// Результат (последняя/лучшая попытка) хранится под ключом 'oral_exam' и синхронизируется
// через CLOUD_KEYS в app.js (ORAL_EXAM_KEY там же; форма записи как у final_exam).

(function () {
  const ORAL_STORAGE_KEY = 'oral_exam';
  const SESSION_KEY = 'stivale_oe_session';
  const CANDIDATE = 'Vika';

  const PARTS = [
    { key: 'p1',      roman: 'I',   it: 'Colloquio',          ru: 'Беседа с комиссией',  time: '≈ 15 мин' },
    { key: 'p2',      roman: 'II',  it: 'Il biglietto',       ru: 'Монолог по билету',   time: '≈ 20 мин' },
    { key: 'p3',      roman: 'III', it: 'La scena',           ru: 'Описание сцены',      time: '≈ 15 мин' },
    { key: 'p4',      roman: 'IV',  it: 'Il gioco di ruolo',  ru: 'Ролевая ситуация',    time: '≈ 20 мин' },
    { key: 'verdict', roman: 'V',   it: 'Il verdetto',        ru: 'Совещание комиссии',  time: '≈ 10 мин' },
  ];
  const RATED_PARTS = ['p1', 'p2', 'p3', 'p4'];

  const CRITERIA = [
    { k: 'comprensione', it: 'Comprensione', ru: 'понимает вопросы без перевода и бесконечных повторов' },
    { k: 'scioltezza',   it: 'Scioltezza',   ru: 'говорит связно, без мучительных пауз, не молчит' },
    { k: 'correttezza',  it: 'Correttezza',  ru: 'грамматика: времена, согласования, предлоги' },
    { k: 'lessico',      it: 'Lessico',      ru: 'словарного запаса хватает на все темы' },
    { k: 'pronuncia',    it: 'Pronuncia',    ru: 'произношение понятное, близкое к итальянскому' },
  ];

  const GRAMMAR = [
    'passato prossimo с avere', 'passato prossimo с essere', 'возвратные в прошедшем',
    'imperfetto', 'futuro semplice', 'condizionale (vorrei…)', 'местоимения lo/la/le/gli',
    'сравнения (più/meno… di)', 'si impersonale', 'слитные предлоги (sul, nel…)',
  ];

  const STAR_WORDS = { 1: 'molto debole', 2: 'debole', 3: 'sufficiente', 4: 'bene', 5: 'eccellente' };

  const BEATS = [
    { tag: 'ADESSO', it: 'Cosa vedi? Chi sono? Cosa stanno facendo?', ru: 'что видишь, кто это, что они делают (presente)' },
    { tag: 'PRIMA',  it: 'Cos’è successo prima?',                ru: 'что случилось до этого (passato)' },
    { tag: 'DOPO',   it: 'Cosa faranno dopo?',                        ru: 'что они будут делать потом (futuro)' },
    { tag: 'E TU?',  it: 'Ti piacerebbe essere lì? Perché?',          ru: 'хотела бы ты там оказаться и почему (condizionale)' },
  ];

  const SOS = [
    { it: 'Può ripetere, per favore?', ru: 'Повторите, пожалуйста?' },
    { it: 'Non ho capito bene.', ru: 'Я не совсем поняла.' },
    { it: 'Come si dice… in italiano?', ru: 'Как сказать… по-итальянски?' },
    { it: 'Un attimo, ci penso.', ru: 'Секунду, я подумаю.' },
  ];

  function verdictFor(pct) {
    if (pct >= 90) return { cls: 'lode',    title: 'Superato con lode', ru: 'Сдано с отличием',   note: 'Комиссия аплодирует: свободная, живая речь уровня A2. Курс можно закрывать с гордостью.' };
    if (pct >= 75) return { cls: 'pass',    title: 'Superato',          ru: 'Сдано',              note: 'Экзамен сдан уверенно. Отдельные шероховатости — в протоколе, разберите их вместе.' };
    if (pct >= 60) return { cls: 'riserva', title: 'Superato con riserva', ru: 'Сдано с оговорками', note: 'Экзамен засчитан, но комиссия предписывает вернуться к слабым местам из протокола.' };
    return           { cls: 'redo',    title: 'Da ripetere',       ru: 'Пересдача',          note: 'Комиссия назначает пересдачу: разберите протокол, повторите темы — и снова в бой.' };
  }

  // Лавры + микрофон — эмблема устного экзамена
  const MIC_ICON = '<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<rect x="26" y="8" width="12" height="22" rx="6" fill="currentColor"/>' +
    '<path d="M20 26a12 12 0 0 0 24 0" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>' +
    '<path d="M32 38v7M25 48h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>' +
    '<path d="M15.5 22c-2.8 8.6-.9 17.6 5.8 24.2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' +
    '<path d="M48.5 22c2.8 8.6.9 17.6-5.8 24.2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' +
    '<path d="M14.8 30.5c3.1-.4 5.6.8 7 3.1-3.1.5-5.6-.7-7-3.1z" fill="currentColor"/>' +
    '<path d="M15.6 37.4c3-.1 5.4 1.3 6.5 3.8-3.1.2-5.4-1.2-6.5-3.8z" fill="currentColor"/>' +
    '<path d="M49.2 30.5c-3.1-.4-5.6.8-7 3.1 3.1.5 5.6-.7 7-3.1z" fill="currentColor"/>' +
    '<path d="M48.4 37.4c-3-.1-5.4 1.3-6.5 3.8 3.1.2 5.4-1.2 6.5-3.8z" fill="currentColor"/></svg>';

  // Компактный динамик для кнопок озвучки (как LISTEN_ICON письменного экзамена)
  const SAY_ICON = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>' +
    '<path d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
    '<path d="M18.07 5.93a9 9 0 0 1 0 12.14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }
  function fmtClock(totalSec) {
    const m = Math.floor(totalSec / 60), s = totalSec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ── Звуковые сигналы экзаменационной аудитории (Web Audio, без внешних файлов).
  // Контекст создаётся лениво по первому пользовательскому клику (autoplay policy). ──
  let audioCtx = null;
  function chime(kind) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const notes = kind === 'via' ? [[660, 0], [880, 0.18]] : [[660, 0]];
      notes.forEach(([freq, delay]) => {
        const t0 = audioCtx.currentTime + delay;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.3);
      });
    } catch (e) { /* звук — только украшение, не роняем экзамен */ }
  }

  // ── Сессия в процессе: переживает пересоздание холдера (облачная синхронизация
  // перерисовывает урок) и случайный F5 в той же вкладке. ──
  function saveSession(state) {
    if (state.step === 'intro' || state.step === 'result') return;
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        step: state.step, sub: state.sub,
        p1: state.p1, maps: state.maps, picked: state.picked,
        ratings: state.ratings, criteria: state.criteria,
        heard: [...state.heard], goals: [...state.goals],
        notes: state.notes, startedAt: state.startedAt,
      }));
    } catch (e) { /* приватный режим и т.п. — просто без восстановления */ }
  }
  function loadSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  // Сессия могла быть сохранена под другой версией банка (урок отредактировали посреди
  // незаконченного экзамена) — не восстанавливаем индексы, которых в банке больше нет,
  // иначе рендер упадёт на undefined и экзамен станет неоткрываемым.
  function sessionFits(saved, bank) {
    const inRange = (v, arr) => v == null || (Number.isInteger(v) && v >= 0 && v < arr.length);
    const p1 = saved.p1 || {};
    const order = Array.isArray(p1.order) ? p1.order : [];
    if (!order.every(i => Number.isInteger(i) && i >= 0 && i < bank.colloquio.length)) return false;
    if (order.length && !(Number.isInteger(p1.idx) && p1.idx >= 0 && p1.idx < order.length)) return false;
    if (saved.step === 'p1' && !order.length) return false;
    const picked = saved.picked || {};
    if (!inRange(picked.biglietto, bank.biglietti) || !inRange(picked.scena, bank.scene) || !inRange(picked.ruolo, bank.ruoli)) return false;
    // Шаг «работа с материалом» без вытянутого материала восстановить нельзя
    if (saved.step === 'p2' && saved.sub !== 'pick' && picked.biglietto == null) return false;
    if (saved.step === 'p3' && saved.sub !== 'pick' && picked.scena == null) return false;
    if (saved.step === 'p4' && saved.sub !== 'pick' && picked.ruolo == null) return false;
    return true;
  }

  // ── Точка входа: вызывается из showLesson() в app.js, как initFinalExam ──
  function initOralExam(rootEl) {
    if (!rootEl) return;
    rootEl.querySelectorAll('[data-oral-exam]').forEach(holder => {
      let bank = null;
      const src = holder.querySelector('script[type="application/json"]');
      try { bank = JSON.parse(src ? src.textContent : ''); }
      catch (e) { console.error('[oral-exam] не удалось разобрать банк экзамена', e); }
      if (!bank || !Array.isArray(bank.colloquio)) { holder.style.display = 'none'; return; }
      build(holder, bank);
    });
  }

  function build(holder, bank) {
    const state = {
      holder, bank,
      step: 'intro',
      sub: null,               // 'pick' | 'work' для частей с вытягиванием
      p1: { order: [], idx: 0 },
      maps: {},                // перемешанные соответствия «рубашка → материал»
      picked: {},              // выбранные билет/сцена/роль (индексы в банке)
      ratings: {},             // p1..p4 → 1..5
      criteria: {},            // ключ критерия → 1..5
      heard: new Set(),        // отмеченная грамматика
      goals: new Set(),        // выполненные задачи ролевой сцены
      notes: '',
      timer: null,             // таймер подготовки/монолога Parte II
      clockInt: null,          // общие часы сессии в степпере
      startedAt: 0,
    };
    // Автовосстановление незаконченной сессии (пересоздание холдера / перезагрузка вкладки)
    const saved = loadSession();
    const canRestore = saved && saved.step && saved.step !== 'intro' && saved.step !== 'result' && sessionFits(saved, bank);
    if (saved && !canRestore) clearSession();
    if (canRestore) {
      state.step = saved.step;
      state.sub = saved.sub || null;
      state.p1 = saved.p1 || state.p1;
      state.maps = saved.maps || {};
      state.picked = saved.picked || {};
      state.ratings = saved.ratings || {};
      state.criteria = saved.criteria || {};
      state.heard = new Set(saved.heard || []);
      state.goals = new Set(saved.goals || []);
      state.notes = saved.notes || '';
      state.startedAt = saved.startedAt || Date.now();
    }
    holder._oralState = state;
    if (!holder.dataset.oralWired) {
      wire(holder);
      holder.dataset.oralWired = '1';
    }
    render(state);
  }

  // ── Умный жребий колоквиума: 7 вопросов с гарантией, что прозвучат прошедшее,
  // imperfetto, будущее и condizionale (по одному из каждой группы + 3 любых). ──
  function drawColloquio(bank) {
    const byG = {};
    bank.colloquio.forEach((q, i) => {
      const g = q.g || 'base';
      (byG[g] = byG[g] || []).push(i);
    });
    const picked = [];
    ['passato', 'imperfetto', 'futuro', 'cond'].forEach(g => {
      const pool = (byG[g] || []).filter(i => !picked.includes(i));
      if (pool.length) picked.push(pool[Math.floor(Math.random() * pool.length)]);
    });
    const rest = shuffle(bank.colloquio.map((_, i) => i).filter(i => !picked.includes(i)))
      .slice(0, Math.max(0, 7 - picked.length));
    return shuffle(picked.concat(rest));
  }

  // ══════════════════════════ ОБЩИЕ КУСКИ РАЗМЕТКИ ══════════════════════════

  function renderStepper(state) {
    const activeIdx = PARTS.findIndex(p => p.key === state.step);
    return `<div class="oe-stepper">${PARTS.map((p, i) => `
      <div class="oe-step${i < activeIdx ? ' is-done' : ''}${i === activeIdx ? ' is-active' : ''}">
        <span class="oe-step-dot">${i < activeIdx ? '✓' : p.roman}</span>
        <span class="oe-step-name">${esc(p.it)}</span>
      </div>`).join('')}
      <span class="oe-elapsed" data-elapsed title="Время с начала экзамена">⏱ --:--</span>
    </div>`;
  }

  function renderPartHead(part) {
    return `<div class="exam-part-head">
      <span class="exam-part-num">${part.roman}</span>
      <div class="exam-part-titles">
        <span class="exam-part-title">${esc(part.it)}</span>
        <span class="exam-part-sub">${esc(part.ru)} · ${esc(part.time)}</span>
      </div>
    </div>`;
  }

  function sayBtn(text) {
    return `<button type="button" class="oe-say" data-role="say" data-say="${esc(text)}" aria-label="Озвучить по-итальянски" title="Озвучить">${SAY_ICON}</button>`;
  }

  function renderStars(group, val, label) {
    const word = val ? STAR_WORDS[val] : 'оценка не выставлена';
    return `<div class="oe-rate">
      <span class="oe-rate-label">${esc(label)}</span>
      <div class="oe-stars" data-stars="${esc(group)}">
        ${[1, 2, 3, 4, 5].map(v => `<button type="button" class="oe-star${val && v <= val ? ' is-on' : ''}" data-role="star" data-group="${esc(group)}" data-v="${v}" aria-label="${v} из 5">★</button>`).join('')}
        <span class="oe-star-word" data-starword="${esc(group)}">${esc(word)}</span>
      </div>
    </div>`;
  }

  function renderNotes(state) {
    return `<label class="oe-notes">
      <span>🖋 Протокол комиссии — молча фиксируй ошибки, разбор после вердикта</span>
      <textarea data-role="notes" rows="3" placeholder="ho andato → sono andata…">${esc(state.notes)}</textarea>
    </label>`;
  }

  function renderNext(label, nextStep, gate) {
    return `<div class="oe-actions">
      <button type="button" class="oe-next" data-role="next-part" data-next="${esc(nextStep)}" data-gate="${esc(gate)}" disabled>${esc(label)}</button>
      <span class="oe-gate-hint" data-gate-hint>Сначала выставь оценку за часть</span>
    </div>`;
  }

  function ruDetails(summary, innerHtml) {
    return `<details class="oe-ru"><summary>${esc(summary)}</summary><div class="oe-ru-body">${innerHtml}</div></details>`;
  }

  function renderSos() {
    return ruDetails('🆘 Фразы-спасатели кандидатки', `<ul>${SOS.map(s =>
      `<li><span class="oe-li-it">${esc(s.it)}</span> — ${esc(s.ru)}</li>`).join('')}</ul>`);
  }

  // ══════════════════════════ ЭКРАНЫ ══════════════════════════

  function renderIntro(state) {
    const prev = window.storageGet ? window.storageGet(ORAL_STORAGE_KEY) : null;
    const prevHtml = (prev && prev.last)
      ? `<div class="exam-intro-prev">
          <span class="exam-prev-pill">Прошлая сессия <b>${prev.last.pct}%</b>${prev.last.verdict ? ` · ${esc(prev.last.verdict)}` : ''}</span>
          ${prev.best && prev.best.pct !== prev.last.pct ? `<span class="exam-prev-pill">Лучшая <b>${prev.best.pct}%</b></span>` : ''}
        </div>`
      : '';
    return `
      <div class="exam-intro oe-intro">
        <div class="exam-intro-laurel">${MIC_ICON}</div>
        <p class="exam-intro-eyebrow">Sessione d'esame · Prova orale · Livello A2</p>
        <p class="exam-intro-title">Экзаменационная комиссия в сборе</p>
        <p class="exam-intro-text">Кандидатка: <b>${esc(CANDIDATE)}</b>. Четыре части: беседа с комиссией, билет с монологом, живая сцена и ролевая ситуация. Билет, сцену и роль решает жребий — заранее не знает никто. Комиссия оценивает каждую часть, совещается и выносит вердикт.</p>
        <div class="exam-intro-stats">
          <div class="exam-stat"><b>4</b><span>части + вердикт</span></div>
          <div class="exam-stat"><b>1/6</b><span>билет по жребию</span></div>
          <div class="exam-stat"><b>5</b><span>критериев оценки</span></div>
          <div class="exam-stat"><b>0</b><span>подсказок</span></div>
        </div>
        ${prevHtml}
        <button type="button" class="exam-start-btn" data-role="start">🔔 Объявить экзамен открытым</button>
      </div>`;
  }

  function renderP1(state) {
    const part = PARTS[0];
    const qIdx = state.p1.order[state.p1.idx];
    const q = state.bank.colloquio[qIdx];
    const last = state.p1.idx >= state.p1.order.length - 1;
    return `
      ${renderStepper(state)}
      ${renderPartHead(part)}
      <p class="oe-instr">Комиссия беседует с кандидаткой: задавай вопросы по одному, вслух, по-итальянски (или нажми 🔊 — вопрос прозвучит сам). На каждый вопрос — развёрнутый ответ, минимум 2–3 фразы. Уточняй и переспрашивай, как в живом разговоре.</p>
      ${renderSos()}
      <div class="oe-qcard">
        <span class="oe-qnum">Domanda ${state.p1.idx + 1} / ${state.p1.order.length}</span>
        <div class="oe-qrow">
          <p class="oe-qit">${esc(q.it)}</p>
          ${sayBtn(q.it)}
        </div>
        <span class="oe-qfocus">комиссия слушает: ${esc(q.focus)}</span>
        ${ruDetails('Перевод — только для комиссии', `<p>${esc(q.ru)}</p>`)}
      </div>
      <div class="oe-qnav">
        ${state.p1.idx > 0 ? '<button type="button" class="oe-ghost-btn oe-ghost-mute" data-role="p1-prev">← Назад</button>' : ''}
        ${last
          ? '<span class="oe-qdone">Вопросы закончились — комиссия выставляет оценку за часть ↓</span>'
          : '<button type="button" class="oe-ghost-btn" data-role="p1-next">Следующий вопрос →</button>'}
      </div>
      ${renderStars('p1', state.ratings.p1, 'Оценка комиссии за Parte I')}
      ${renderNotes(state)}
      ${renderNext('Дальше → Parte II · Il biglietto', 'p2', 'p1')}`;
  }

  function renderPickGrid(state, items, role, icon, label) {
    return `
      <div class="oe-tickets">
        ${items.map((_, i) => `
          <button type="button" class="oe-ticket" data-role="${esc(role)}" data-i="${i}">
            <span class="oe-ticket-n">№ ${i + 1}</span>
            <span class="oe-ticket-icon">${icon}</span>
            <span class="oe-ticket-label">${esc(label)}</span>
          </button>`).join('')}
      </div>`;
  }

  function renderP2(state) {
    const part = PARTS[1];
    if (state.sub === 'pick') {
      return `
        ${renderStepper(state)}
        ${renderPartHead(part)}
        <p class="oe-instr">Кандидатка подходит к столу комиссии и <b>сама тянет билет</b>. В билете — тема монолога и четыре пункта, которые нужно раскрыть. Что внутри — не знает никто, даже комиссия.</p>
        ${renderPickGrid(state, state.bank.biglietti, 'pick-ticket', '🎫', 'biglietto')}`;
    }
    const b = state.bank.biglietti[state.picked.biglietto];
    return `
      ${renderStepper(state)}
      ${renderPartHead(part)}
      <p class="oe-instr">Порядок части: <b>1 минута подготовки</b> (можно думать, нельзя писать) → монолог <b>2–3 минуты</b> по пунктам билета → вопросы комиссии. Во время монолога не перебивай — только слушай и фиксируй. Сигнал прозвучит, когда подготовка закончится и когда будут взяты две минуты.</p>
      ${renderSos()}
      <div class="oe-bcard">
        <div class="oe-bhead">
          <span class="oe-bemoji">${b.emoji}</span>
          <div class="oe-btitles">
            <span class="oe-btitle">${esc(b.title)}</span>
            <span class="oe-bru">${esc(b.ru)}</span>
          </div>
          <span class="oe-bstamp">Biglietto</span>
        </div>
        <ol class="oe-punti">
          ${b.punti.map(p => `<li><span class="oe-punto-it">${esc(p.it)}</span><span class="oe-punto-ru">${esc(p.ru)}</span></li>`).join('')}
        </ol>
        <span class="oe-qfocus">комиссия слушает: ${esc(b.focus)}</span>
      </div>
      <div class="oe-timer">
        <div class="oe-timer-display" data-role="timer-display">01:00</div>
        <div class="oe-timer-btns">
          <button type="button" class="oe-ghost-btn" data-role="timer-prep">⏳ Подготовка · 1 мин</button>
          <button type="button" class="oe-ghost-btn" data-role="timer-talk">🎤 Монолог · старт</button>
          <button type="button" class="oe-ghost-btn oe-ghost-mute" data-role="timer-stop">■ Стоп</button>
        </div>
        <div class="oe-timer-note" data-role="timer-note">Сначала минута подготовки, затем — монолог. Цель монолога: 2–3 минуты.</div>
      </div>
      ${ruDetails('Domande extra — вопросы комиссии после монолога', `<ul>${b.extra.map(x => `<li><span class="oe-li-it">${esc(x.it)}</span> ${sayBtn(x.it)} — ${esc(x.ru)}</li>`).join('')}</ul>`)}
      ${renderStars('p2', state.ratings.p2, 'Оценка комиссии за Parte II')}
      ${renderNotes(state)}
      ${renderNext('Дальше → Parte III · La scena', 'p3', 'p2')}`;
  }

  function renderP3(state) {
    const part = PARTS[2];
    if (state.sub === 'pick') {
      return `
        ${renderStepper(state)}
        ${renderPartHead(part)}
        <p class="oe-instr">Второй жребий: кандидатка вытягивает <b>сцену</b> — застывший кадр из итальянской жизни. Её задача — оживить его словами.</p>
        ${renderPickGrid(state, state.bank.scene, 'pick-scene', '🎬', 'scena')}`;
    }
    const s = state.bank.scene[state.picked.scena];
    return `
      ${renderStepper(state)}
      ${renderPartHead(part)}
      <p class="oe-instr">Кандидатка описывает сцену по четырём шагам — от настоящего к прошлому и будущему. Комиссия помогает вопросами, только если рассказ совсем остановился.</p>
      ${renderSos()}
      <div class="oe-scenecard">
        <div class="oe-scene-emoji">${s.emoji}</div>
        <div class="oe-scene-title">${esc(s.title)} <i>· ${esc(s.ru)}</i></div>
      </div>
      <div class="oe-beats">
        ${BEATS.map(bt => `
          <div class="oe-beat">
            <span class="oe-beat-tag">${esc(bt.tag)}</span>
            <span class="oe-beat-it">${esc(bt.it)}</span>
            <span class="oe-beat-ru">${esc(bt.ru)}</span>
          </div>`).join('')}
      </div>
      ${ruDetails('Вопросы-помощники для комиссии', `<ul>${s.domande.map(d => `<li><span class="oe-li-it">${esc(d.it)}</span> ${sayBtn(d.it)} — ${esc(d.ru)}</li>`).join('')}</ul>`)}
      ${renderStars('p3', state.ratings.p3, 'Оценка комиссии за Parte III')}
      ${renderNotes(state)}
      ${renderNext('Дальше → Parte IV · Il gioco di ruolo', 'p4', 'p3')}`;
  }

  function renderP4(state) {
    const part = PARTS[3];
    if (state.sub === 'pick') {
      return `
        ${renderStepper(state)}
        ${renderPartHead(part)}
        <p class="oe-instr">Последний жребий: кандидатка вытягивает <b>ситуацию</b>. Комиссия перестаёт быть комиссией и играет свою роль по-настоящему — с характером.</p>
        ${renderPickGrid(state, state.bank.ruoli, 'pick-ruolo', '🎭', 'situazione')}`;
    }
    const r = state.bank.ruoli[state.picked.ruolo];
    return `
      ${renderStepper(state)}
      ${renderPartHead(part)}
      <p class="oe-instr">${r.emoji} <b>${esc(r.title)}</b> · ${esc(r.ru)}. Сцена играется целиком по-итальянски, от приветствия до прощания. Свои реплики можешь озвучивать кнопками 🔊 — пусть звучит настоящий итальянский. Отмечай выполненные задачи по ходу.</p>
      ${renderSos()}
      <div class="oe-roles">
        <div class="oe-rolecard oe-rolecard-cand">
          <span class="oe-rolelabel">Кандидатка</span>
          <p class="oe-role-it">${esc(r.cand.it)}</p>
          <p class="oe-role-ru">${esc(r.cand.ru)}</p>
          <span class="oe-goals-label">Задачи сцены:</span>
          <div class="oe-goals">
            ${r.goals.map((g, i) => `
              <label class="oe-goal${state.goals.has(i) ? ' is-done' : ''}">
                <input type="checkbox" data-role="goal" data-i="${i}"${state.goals.has(i) ? ' checked' : ''}>
                <span><span class="oe-li-it">${esc(g.it)}</span><i>${esc(g.ru)}</i></span>
              </label>`).join('')}
          </div>
        </div>
        <div class="oe-rolecard oe-rolecard-esam">
          <span class="oe-rolelabel">${esc(r.esam.role)}</span>
          <p class="oe-role-hint">Начни сцену словами:</p>
          <div class="oe-qrow">
            <p class="oe-role-it">«${esc(r.esam.opening.it)}»</p>
            ${sayBtn(r.esam.opening.it)}
          </div>
          <p class="oe-role-ru">${esc(r.esam.opening.ru)}</p>
          <p class="oe-role-hint">Реплики-опоры по ходу сцены:</p>
          <ul class="oe-role-lines">
            ${r.esam.lines.map(l => `<li><span class="oe-li-it">${esc(l.it)}</span> ${sayBtn(l.it)}<i>${esc(l.ru)}</i></li>`).join('')}
          </ul>
          <p class="oe-twist">⚡ ${esc(r.esam.twist)}</p>
        </div>
      </div>
      ${renderStars('p4', state.ratings.p4, 'Оценка комиссии за Parte IV')}
      ${renderNotes(state)}
      ${renderNext('Экзамен окончен → комиссия совещается', 'verdict', 'p4')}`;
  }

  function renderVerdictStep(state) {
    const part = PARTS[4];
    const partsSum = RATED_PARTS.reduce((s, k) => s + (state.ratings[k] || 0), 0);
    return `
      ${renderStepper(state)}
      ${renderPartHead(part)}
      <p class="oe-instr">«La commissione si ritira per deliberare». Кандидатка выходит за воображаемую дверь (или делает себе чай). За части уже набрано <b>${partsSum} из 20</b> — пять итоговых критериев добавят остальное (максимум 45). Выставляй честно и отметь, какая грамматика реально прозвучала за экзамен.</p>
      <div class="oe-crits">
        ${CRITERIA.map(c => `
          <div class="oe-crit">
            <div class="oe-crit-name"><b>${esc(c.it)}</b><span>${esc(c.ru)}</span></div>
            ${renderStars('c-' + c.k, state.criteria[c.k], '')}
          </div>`).join('')}
      </div>
      <div class="oe-heard">
        <span class="oe-goals-label">Что прозвучало за экзамен — отметь услышанное (на балл не влияет, попадёт в сертификат):</span>
        <div class="oe-chips">
          ${GRAMMAR.map((g, i) => `<button type="button" class="oe-chip${state.heard.has(i) ? ' is-on' : ''}" data-role="chip" data-i="${i}">${esc(g)}</button>`).join('')}
        </div>
      </div>
      ${renderNotes(state)}
      <div class="oe-actions">
        <button type="button" class="oe-next oe-verdict-btn" data-role="finish" data-gate="crit" disabled>⚖️ Вынести вердикт</button>
        <span class="oe-gate-hint" data-gate-hint>Сначала выставь все пять критериев</span>
      </div>`;
  }

  function starLine(val) {
    return `<span class="oe-mini-stars">${'★'.repeat(val || 0)}${'☆'.repeat(5 - (val || 0))}</span> <i>${val ? esc(STAR_WORDS[val]) : '—'}</i>`;
  }

  function renderResult(state, res) {
    const v = res.verdict;
    const dateIt = new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
    const heardChips = GRAMMAR.map((g, i) => `<span class="oe-chip oe-chip-static${state.heard.has(i) ? ' is-on' : ''}">${esc(g)}</span>`).join('');
    const prev = res.prevLast;
    const notes = state.notes.trim();
    return `
      <div class="oe-cert oe-cert-${v.cls}">
        <div class="oe-cert-inner">
          <span class="oe-cert-stamp">${esc(v.title)}</span>
          <div class="exam-intro-laurel">${MIC_ICON}</div>
          <span class="oe-cert-eyebrow">Commissione d'esame «Stivale» · Sessione ${new Date().getFullYear()}</span>
          <h3 class="oe-cert-title">Certificato d'esame orale</h3>
          <p class="oe-cert-sub">Lingua italiana · Livello A2</p>
          <p class="oe-cert-name">Candidata: <b>${esc(CANDIDATE)}</b></p>
          <div class="oe-cert-score"><b>${res.pct}<i>%</i></b><span>${res.score} из 45 баллов комиссии</span></div>
          <div class="oe-cert-verdict">${esc(v.title)}<span>${esc(v.ru)}</span></div>
          <p class="oe-cert-note">${esc(v.note)}</p>
          <div class="oe-cert-foot">
            <span class="oe-cert-date">${esc(dateIt)}</span>
            <span class="oe-cert-sign">Il presidente della commissione<i>✦</i></span>
          </div>
        </div>
      </div>
      ${prev ? `<div class="exam-intro-prev"><span class="exam-prev-pill">Прошлая сессия <b>${prev.pct}%</b></span></div>` : ''}
      <div class="oe-break">
        <div class="oe-break-col">
          <span class="oe-break-title">Части экзамена</span>
          ${RATED_PARTS.map((k, i) => `<div class="oe-break-row"><span>${esc(PARTS[i].it)}</span>${starLine(state.ratings[k])}</div>`).join('')}
          <div class="oe-break-row oe-break-extra"><span>Задачи ролевой сцены</span><b>${state.goals.size}/4</b></div>
        </div>
        <div class="oe-break-col">
          <span class="oe-break-title">Критерии комиссии</span>
          ${CRITERIA.map(c => `<div class="oe-break-row"><span>${esc(c.it)}</span>${starLine(state.criteria[c.k])}</div>`).join('')}
        </div>
      </div>
      <div class="oe-heard">
        <span class="oe-goals-label">Грамматика, прозвучавшая на экзамене — ${state.heard.size} из ${GRAMMAR.length}:</span>
        <div class="oe-chips">${heardChips}</div>
      </div>
      ${notes ? `<div class="oe-protocol"><span class="oe-break-title">🖋 Протокол комиссии — разберите вместе</span><p>${esc(notes)}</p></div>` : ''}
      <div class="oe-final-actions">
        <button type="button" class="exam-restart-btn" data-role="print-cert">🖨 Распечатать сертификат</button>
        <button type="button" class="exam-restart-btn" data-role="restart">Назначить новую сессию</button>
      </div>`;
  }

  // ══════════════════════════ РЕНДЕР И ЛОГИКА ══════════════════════════

  function render(state) {
    clearTimer(state);
    clearClock(state);
    let html = '';
    if (state.step === 'intro') html = renderIntro(state);
    else if (state.step === 'p1') html = renderP1(state);
    else if (state.step === 'p2') html = renderP2(state);
    else if (state.step === 'p3') html = renderP3(state);
    else if (state.step === 'p4') html = renderP4(state);
    else if (state.step === 'verdict') html = renderVerdictStep(state);
    else if (state.step === 'result') html = renderResult(state, state.result);
    state.holder.innerHTML = html;
    updateGates(state);
    if (state.startedAt && state.step !== 'intro' && state.step !== 'result') startClock(state);
  }

  function updateGates(state) {
    const btn = state.holder.querySelector('[data-gate]');
    if (!btn) return;
    const gate = btn.getAttribute('data-gate');
    const ok = gate === 'crit'
      ? CRITERIA.every(c => state.criteria[c.k])
      : !!state.ratings[gate];
    btn.disabled = !ok;
    const hint = state.holder.querySelector('[data-gate-hint]');
    if (hint) hint.hidden = ok;
  }

  function clearTimer(state) {
    if (state.timer && state.timer.int) clearInterval(state.timer.int);
    state.timer = null;
  }

  function clearClock(state) {
    if (state.clockInt) clearInterval(state.clockInt);
    state.clockInt = null;
  }

  function startClock(state) {
    const tick = () => {
      const el = state.holder.querySelector('[data-elapsed]');
      if (!el) { clearClock(state); return; }
      el.textContent = '⏱ ' + fmtClock(Math.floor((Date.now() - state.startedAt) / 1000));
    };
    tick();
    state.clockInt = setInterval(tick, 1000);
  }

  function setTimerNote(state, text) {
    const el = state.holder.querySelector('[data-role="timer-note"]');
    if (el) el.textContent = text;
  }

  function startTimer(state, mode) {
    clearTimer(state);
    const display = state.holder.querySelector('[data-role="timer-display"]');
    if (!display) return;
    display.classList.remove('is-over', 'is-talk');
    if (mode === 'prep') {
      let left = 60;
      display.textContent = fmtClock(left);
      setTimerNote(state, 'Подготовка идёт: можно думать и шептать про себя, нельзя писать.');
      state.timer = { mode, int: setInterval(() => {
        const d = state.holder.querySelector('[data-role="timer-display"]');
        if (!d) { clearTimer(state); return; }
        left--;
        if (left <= 0) {
          clearTimer(state);
          d.textContent = 'VIA!';
          d.classList.add('is-over');
          chime('via');
          setTimerNote(state, 'Время подготовки вышло — слово кандидатке. Жми «Монолог · старт».');
        } else {
          d.textContent = fmtClock(left);
        }
      }, 1000) };
    } else {
      let sec = 0;
      display.textContent = fmtClock(0);
      display.classList.add('is-talk');
      setTimerNote(state, 'Монолог пошёл. Не перебивай — комиссия только слушает.');
      state.timer = { mode, int: setInterval(() => {
        const d = state.holder.querySelector('[data-role="timer-display"]');
        if (!d) { clearTimer(state); return; }
        sec++;
        d.textContent = fmtClock(sec);
        if (sec === 120) { chime('goal'); setTimerNote(state, '✓ Две минуты — цель взята. Можно красиво закончить к 3:00.'); }
        if (sec === 180) setTimerNote(state, 'Три минуты! Отличная выдержка — можно мягко закруглять монолог.');
      }, 1000) };
    }
  }

  function applyStar(state, group, v) {
    if (group.startsWith('c-')) state.criteria[group.slice(2)] = v;
    else state.ratings[group] = v;
    const row = state.holder.querySelector(`[data-stars="${group}"]`);
    if (row) {
      row.querySelectorAll('[data-role="star"]').forEach(btn => {
        btn.classList.toggle('is-on', +btn.getAttribute('data-v') <= v);
      });
      const word = row.querySelector(`[data-starword="${group}"]`);
      if (word) word.textContent = STAR_WORDS[v];
    }
    updateGates(state);
    saveSession(state);
  }

  function computeResult(state) {
    const partsSum = RATED_PARTS.reduce((s, k) => s + (state.ratings[k] || 0), 0);
    const critSum = CRITERIA.reduce((s, c) => s + (state.criteria[c.k] || 0), 0);
    const score = partsSum + critSum;
    const pct = Math.round((score / 45) * 100);
    const verdict = verdictFor(pct);
    const prevRec = (window.storageGet && window.storageGet(ORAL_STORAGE_KEY)) || {};
    const prevLast = prevRec.last || null;
    // Сохранение в форме, совместимой с mergeFinalExam в app.js: last по t, best по pct
    const rec = { pct, verdict: verdict.title, heard: state.heard.size, goals: state.goals.size, t: Date.now() };
    const best = (!prevRec.best || pct > prevRec.best.pct) ? rec : prevRec.best;
    if (window.storageSet) window.storageSet(ORAL_STORAGE_KEY, { last: rec, best });
    if (window.cloudPush) window.cloudPush(ORAL_STORAGE_KEY);
    return { pct, score, verdict, prevLast };
  }

  function goStep(state, step, sub) {
    clearTimer(state);
    state.step = step;
    state.sub = sub || null;
    saveSession(state);
    render(state);
    state.holder.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function wire(holder) {
    holder.addEventListener('click', (e) => {
      const state = holder._oralState;
      if (!state) return;
      const btn = e.target.closest('[data-role]');
      if (!btn || !holder.contains(btn)) return;
      const role = btn.getAttribute('data-role');

      if (role === 'start') {
        state.startedAt = Date.now();
        state.p1 = { order: drawColloquio(state.bank), idx: 0 };
        state.maps = {
          biglietti: shuffle(state.bank.biglietti.map((_, i) => i)),
          scene: shuffle(state.bank.scene.map((_, i) => i)),
          ruoli: shuffle(state.bank.ruoli.map((_, i) => i)),
        };
        goStep(state, 'p1');
      }
      else if (role === 'p1-next') {
        if (state.p1.idx < state.p1.order.length - 1) { state.p1.idx++; saveSession(state); render(state); }
      }
      else if (role === 'p1-prev') {
        if (state.p1.idx > 0) { state.p1.idx--; saveSession(state); render(state); }
      }
      else if (role === 'pick-ticket') { state.picked.biglietto = state.maps.biglietti[+btn.getAttribute('data-i')]; state.sub = 'work'; saveSession(state); render(state); }
      else if (role === 'pick-scene')  { state.picked.scena = state.maps.scene[+btn.getAttribute('data-i')]; state.sub = 'work'; saveSession(state); render(state); }
      else if (role === 'pick-ruolo')  { state.picked.ruolo = state.maps.ruoli[+btn.getAttribute('data-i')]; state.sub = 'work'; saveSession(state); render(state); }
      else if (role === 'timer-prep') startTimer(state, 'prep');
      else if (role === 'timer-talk') startTimer(state, 'talk');
      else if (role === 'timer-stop') { clearTimer(state); setTimerNote(state, 'Таймер остановлен.'); }
      else if (role === 'say') {
        const text = btn.getAttribute('data-say');
        btn.classList.add('is-playing');
        const done = () => btn.classList.remove('is-playing');
        if (window.speakIt) window.speakIt(text).then(done).catch(done);
        else done();
      }
      else if (role === 'star') applyStar(state, btn.getAttribute('data-group'), +btn.getAttribute('data-v'));
      else if (role === 'chip') {
        const i = +btn.getAttribute('data-i');
        if (state.heard.has(i)) state.heard.delete(i); else state.heard.add(i);
        btn.classList.toggle('is-on', state.heard.has(i));
        saveSession(state);
      }
      else if (role === 'next-part') {
        if (btn.disabled) return;
        const next = btn.getAttribute('data-next');
        goStep(state, next, next === 'p2' || next === 'p3' || next === 'p4' ? 'pick' : null);
      }
      else if (role === 'finish') {
        if (btn.disabled) return;
        state.result = computeResult(state);
        clearSession();
        goStep(state, 'result');
        // Сдано (Superato и выше) — конфетти-салют приложения
        if (state.result.pct >= 75 && typeof window.launchConfetti === 'function') {
          setTimeout(() => { try { window.launchConfetti(); } catch (err) {} }, 600);
        }
      }
      else if (role === 'print-cert') {
        // Печать: body.oe-print-cert оставляет на бумаге только сертификат (светлая версия, см. @media print)
        const cleanup = () => { document.body.classList.remove('oe-print-cert'); window.removeEventListener('afterprint', cleanup); };
        document.body.classList.add('oe-print-cert');
        window.addEventListener('afterprint', cleanup);
        try { window.print(); } catch (err) { cleanup(); return; }
        setTimeout(cleanup, 3000); // страховка для браузеров без afterprint (печать там асинхронная)
      }
      else if (role === 'restart') { clearSession(); build(holder, state.bank); }
    });

    holder.addEventListener('input', (e) => {
      const state = holder._oralState;
      if (!state) return;
      if (e.target.matches('[data-role="notes"]')) { state.notes = e.target.value; saveSession(state); }
    });

    holder.addEventListener('change', (e) => {
      const state = holder._oralState;
      if (!state) return;
      const cb = e.target.closest('input[data-role="goal"]');
      if (!cb) return;
      const i = +cb.getAttribute('data-i');
      if (cb.checked) state.goals.add(i); else state.goals.delete(i);
      const label = cb.closest('.oe-goal');
      if (label) label.classList.toggle('is-done', cb.checked);
      saveSession(state);
    });
  }

  window.initOralExam = initOralExam;
})();
