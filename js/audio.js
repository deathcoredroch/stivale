// ── ОЗВУЧКА через Google Translate TTS (не требует голосов в системе) ─────
(function () {
  let speakGain = Math.min(parseFloat(localStorage.getItem('stivale_volume') ?? '1.0'), 1.0);

  // Выбираем лучший доступный итальянский голос Web Speech API один раз и кэшируем.
  // Сетевые голоса (Google italiano, Microsoft Online/Natural) звучат заметно живее,
  // чем офлайн-голоса ОС, которые браузер иначе выбрал бы по умолчанию.
  let bestItVoice = null;
  let voicesReady = false;

  function scoreVoice(v) {
    if (!v.lang.toLowerCase().startsWith('it')) return -1;
    let score = 0;
    if (v.lang.toLowerCase() === 'it-it') score += 5;
    const name = v.name.toLowerCase();
    if (/natural|neural|online/.test(name)) score += 10;
    if (/google/.test(name)) score += 6;
    if (!v.localService) score += 4; // сетевые голоса обычно качественнее офлайн-движка ОС
    if (v.default) score += 1;
    return score;
  }

  function pickBestItVoice() {
    const voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    if (!voices.length) return null;
    let best = null, bestScore = -1;
    for (const v of voices) {
      const s = scoreVoice(v);
      if (s > bestScore) { bestScore = s; best = v; }
    }
    return bestScore >= 0 ? best : null;
  }

  function refreshVoices() {
    bestItVoice = pickBestItVoice();
    voicesReady = true;
  }

  if (window.speechSynthesis) {
    refreshVoices();
    speechSynthesis.onvoiceschanged = refreshVoices;
  }

  // Текущее воспроизведение — чтобы уметь останавливать (например, при закрытии
  // окна истории или нажатии «Стоп» во время последовательного чтения).
  let currentAudio = null;
  let currentUtterance = null;

  function stopSpeaking() {
    if (currentAudio) {
      try { currentAudio.pause(); currentAudio.currentTime = 0; } catch (e) {}
      currentAudio = null;
    }
    if (window.speechSynthesis) { try { speechSynthesis.cancel(); } catch (e) {} }
    currentUtterance = null;
  }

  // Озвучивает текст и ВОЗВРАЩАЕТ Promise, который резолвится по окончании
  // воспроизведения (или сразу — при ошибке/пустом вводе). Это позволяет читать
  // историю последовательно, предложение за предложением, с подсветкой.
  // Разбивает длинный текст на фрагменты ≤ ~180 символов по границам слов:
  // у Google Translate TTS ограничение на длину одного запроса (~200 символов).
  function splitForTts(text, max = 180) {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length <= max) return clean ? [clean] : [];
    const parts = [];
    let cur = '';
    for (const w of clean.split(' ')) {
      if (cur && (cur + ' ' + w).length > max) { parts.push(cur); cur = w; }
      else cur = cur ? cur + ' ' + w : w;
    }
    if (cur) parts.push(cur);
    return parts;
  }

  function googleTtsUrl(chunk) {
    return 'https://translate.google.com/translate_tts?ie=UTF-8&tl=it&client=tw-ob&q='
      + encodeURIComponent(chunk);
  }

  // Последовательно проигрывает фрагменты через Google Translate TTS.
  // Один и тот же живой итальянский голос на ВСЕХ устройствах — не зависит от
  // системных голосов ОС (именно офлайновый голос Windows делал озвучку на
  // компьютере механической, тогда как на телефонах голос сети звучал хорошо).
  // resolve() — успех/остановка; reject() — чтобы откатиться на Web Speech.
  function speakViaGoogle(text) {
    const chunks = splitForTts(text);
    if (!chunks.length) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let i = 0, started = false;
      const playNext = () => {
        if (i >= chunks.length) return resolve();
        const audio = new Audio();
        currentAudio = audio;
        audio.volume = Math.min(speakGain, 1.0);
        let advanced = false;
        const advance = () => { if (advanced) return; advanced = true; i++; playNext(); };
        audio.onended = advance;
        audio.onpause = () => { // остановка извне (stopSpeaking)
          if (currentAudio !== audio && !advanced) { advanced = true; resolve(); }
        };
        audio.onerror = () => {
          if (advanced) return;
          advanced = true;
          // Первый фрагмент не пошёл — сеть/доступ недоступны, откатываемся на Web Speech.
          // Если уже что-то прозвучало — просто завершаем, не начиная озвучку заново.
          started ? resolve() : reject(new Error('google tts unavailable'));
        };
        audio.src = googleTtsUrl(chunks[i]);
        audio.play().then(() => { started = true; })
          .catch(() => { if (!advanced) { advanced = true; reject(new Error('play blocked')); } });
      };
      playNext();
    });
  }

  // Крайний fallback: голоса самой ОС (Web Speech API), если сети нет вовсе.
  function speakViaWebSpeech(word) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) return resolve();
      if (!voicesReady) refreshVoices();
      // Итальянского голоса в системе нет (типично для Firefox) — молчим, а не
      // читаем итальянский текст английским голосом: для изучения языка это хуже.
      if (!bestItVoice) { refreshVoices(); if (!bestItVoice) return resolve(); }
      speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(word);
      currentUtterance = utt;
      utt.lang = 'it-IT';
      utt.rate = 0.88;
      utt.volume = Math.min(speakGain, 1.0);
      if (bestItVoice) utt.voice = bestItVoice;
      const done = () => { if (currentUtterance === utt) currentUtterance = null; resolve(); };
      utt.onend = done;
      utt.onerror = done;
      speechSynthesis.speak(utt);
      // Страховка: в некоторых средах onend/onerror у Web Speech не срабатывают.
      // Резолвим по оценке длительности (≈ как реальная речь), чтобы цикл чтения
      // не зависал. Если речь идёт нормально — onend сработает раньше.
      setTimeout(done, Math.max(1800, word.length * 80 + 500));
    });
  }

  function speak(word) {
    if (!word || typeof word !== 'string') return Promise.resolve();
    stopSpeaking(); // не накладываем звуки друг на друга

    // Google TTS запускаем СРАЗУ, в рамках жеста пользователя (клика). Если сначала
    // сделать асинхронный запрос (напр. к локальному серверу), Firefox посчитает
    // жест «просроченным» и заблокирует автовоспроизведение — звука не будет.
    // 1) Google Translate TTS — одинаково живой итальянский на всех устройствах
    // 2) Голоса ОС (Web Speech API) — только если сети нет совсем
    return speakViaGoogle(word).catch(() => speakViaWebSpeech(word));
  }
  window.speakIt = speak;            // доступ к озвучке из генератора историй
  window.stopSpeaking = stopSpeaking; // остановка воспроизведения

  const style = document.createElement('style');
  style.textContent = `
    .speak-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-left: 6px;
      width: 24px; height: 24px;
      padding: 0;
      background: var(--terracotta-soft);
      border: 1px solid rgba(193,84,58,0.25);
      border-radius: 50%;
      cursor: pointer;
      opacity: 0.85;
      vertical-align: middle;
      transition: opacity 0.15s, transform 0.15s, background 0.15s, border-color 0.15s, box-shadow 0.15s;
      flex-shrink: 0;
      box-shadow: 0 1px 2px rgba(193,84,58,0.15);
    }
    .speak-btn svg {
      width: 13px; height: 13px;
      display: block;
      color: var(--terracotta);
      pointer-events: none;
    }
    .speak-btn:hover {
      opacity: 1;
      background: var(--terracotta);
      border-color: var(--terracotta);
      transform: scale(1.15);
      box-shadow: 0 2px 6px rgba(193,84,58,0.35);
    }
    .speak-btn:hover svg { color: #fff; }
    .speak-btn:active { transform: scale(0.92); }
    .speak-btn.speaking {
      opacity: 1;
      background: var(--terracotta);
      border-color: var(--terracotta);
      animation: speak-pulse 0.6s ease;
    }
    .speak-btn.speaking svg { color: #fff; }
    @keyframes speak-pulse {
      0%   { transform: scale(1); box-shadow: 0 0 0 0 rgba(193,84,58,0.45); }
      40%  { transform: scale(1.25); box-shadow: 0 0 0 6px rgba(193,84,58,0); }
      100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(193,84,58,0); }
    }
  `;
  document.head.appendChild(style);

  // Красивая SVG-иконка динамика со звуковыми волнами (вместо эмодзи 🔊)
  const SPEAK_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M18.07 5.93a9 9 0 0 1 0 12.14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg>`;

  function injectButtons(root) {
    root.querySelectorAll('td[data-word]:not([data-speak-injected])').forEach(td => {
      td.setAttribute('data-speak-injected', '1');
      const btn = document.createElement('button');
      btn.className   = 'speak-btn';
      btn.title       = 'Послушать произношение';
      btn.innerHTML   = SPEAK_ICON_SVG;
      btn.addEventListener('click', e => {
        e.stopPropagation();
        speak(td.dataset.word);
        btn.classList.add('speaking');
        setTimeout(() => btn.classList.remove('speaking'), 700);
      });
      td.appendChild(btn);
    });

    // Облако слов в ДЗ: каждый <span> внутри .hw-vocab-cloud
    root.querySelectorAll('.hw-vocab-cloud span:not([data-speak-injected])').forEach(span => {
      const word = span.textContent.trim();
      if (!word) return;
      span.setAttribute('data-speak-injected', '1');
      span.style.cursor = 'pointer';
      span.title = 'Нажми, чтобы послушать';
      const btn = document.createElement('button');
      btn.className   = 'speak-btn';
      btn.title       = 'Послушать произношение';
      btn.innerHTML   = SPEAK_ICON_SVG;
      btn.style.marginLeft = '4px';
      btn.addEventListener('click', e => {
        e.stopPropagation();
        speak(word);
        btn.classList.add('speaking');
        setTimeout(() => btn.classList.remove('speaking'), 700);
      });
      span.appendChild(btn);
    });
  }

  const observer = new MutationObserver(() => injectButtons(document.body));
  observer.observe(document.body, { childList: true, subtree: true });
  injectButtons(document.body);

  // ── Инициализация слайдера громкости ───────────────────────────────────────
  const volumeSlider = document.getElementById('volumeSlider');
  const volumeValueBadge = document.getElementById('volumeValueBadge');
  if (volumeSlider) {
    const savedVol = parseFloat(localStorage.getItem('stivale_volume') ?? '1.0');
    volumeSlider.value = Math.round(Math.min(savedVol, 1.0) * 100);
    volumeValueBadge.textContent = volumeSlider.value + '%';

    const ICONS = {
      mute: `<path d="M11 5L6 9H2v6h4l5 4V5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
             <line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
             <line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
      low:  `<path d="M11 5L6 9H2v6h4l5 4V5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
             <path d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
      full: `<path d="M11 5L6 9H2v6h4l5 4V5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
             <path d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
             <path d="M19.07 4.93a10 10 0 0 1 0 14.14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
    };

    let prevVal = parseInt(volumeSlider.value);

    function updateVolUI(val) {
      const pct = val; // 0–100, slider max is 100
      volumeSlider.style.background =
        `linear-gradient(to right, var(--terracotta) 0%, var(--terracotta) ${pct}%, var(--line) ${pct}%, var(--line) 100%)`;
      volumeValueBadge.textContent = val + '%';

      const pill = document.getElementById('volumeValueBadge');
      const icon = document.getElementById('volIconSvg');
      const card = document.getElementById('volumeCardIcon');

      if (val === 0) {
        pill.className = 'volume-pct-pill muted';
        if (icon) icon.innerHTML = ICONS.mute;
        if (card) card.style.background = 'rgba(43,37,32,0.07)';
        if (card) card.style.color = 'rgba(43,37,32,0.3)';
      } else if (val < 60) {
        pill.className = 'volume-pct-pill';
        if (icon) icon.innerHTML = ICONS.low;
        if (card) card.style.background = '';
        if (card) card.style.color = '';
      } else if (val < 90) {
        pill.className = 'volume-pct-pill';
        if (icon) icon.innerHTML = ICONS.full;
        if (card) card.style.background = '';
        if (card) card.style.color = '';
      } else {
        pill.className = 'volume-pct-pill boosted';
        if (icon) icon.innerHTML = ICONS.full;
        if (card) card.style.background = '';
        if (card) card.style.color = '';
      }

      // Подсвечиваем ближайший к текущему значению маркер («Тихо / 50% / 100%»)
      const markers = document.querySelectorAll('.volume-marker');
      let closest = null, closestDist = Infinity;
      markers.forEach(m => {
        const dist = Math.abs(parseInt(m.dataset.value, 10) - val);
        if (dist < closestDist) { closestDist = dist; closest = m; }
      });
      markers.forEach(m => m.classList.toggle('active-marker', m === closest));

      // Лёгкий «поп» на пилюле процента, когда значение реально меняется
      if (val !== prevVal) {
        pill.classList.remove('is-bumped');
        void pill.offsetWidth; // форсируем reflow, чтобы анимация перезапустилась
        pill.classList.add('is-bumped');
      }
      prevVal = val;
    }

    updateVolUI(parseInt(volumeSlider.value));

    volumeSlider.addEventListener('input', () => {
      const val = parseInt(volumeSlider.value);
      speakGain = val / 100;
      localStorage.setItem('stivale_volume', speakGain.toString());
      updateVolUI(val);
    });

    // ── Кнопка «Проверить звук» — озвучивает фразу на текущей громкости ──
    const testBtn = document.getElementById('volumeTestBtn');
    if (testBtn) {
      testBtn.addEventListener('click', () => {
        if (testBtn.classList.contains('is-playing')) return;
        const card = document.getElementById('volumeCardIcon');
        testBtn.classList.add('is-playing');
        if (card) card.classList.add('is-playing');
        speak('Buongiorno! Come stai?').finally(() => {
          testBtn.classList.remove('is-playing');
          if (card) card.classList.remove('is-playing');
        });
      });
    }
  }

  // ── Открытие / закрытие настроек ───────────────────────────────────────────
  const settingsModal = document.getElementById('settingsModal');
  document.getElementById('settingsNavBtn').addEventListener('click', () => {
    settingsModal.classList.add('open');
    if (typeof closeSidebar === 'function') closeSidebar();
  });
  document.getElementById('settingsModalClose').addEventListener('click', () => {
    settingsModal.classList.remove('open');
  });
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) settingsModal.classList.remove('open');
  });
})();
