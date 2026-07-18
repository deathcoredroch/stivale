const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');

// ── Авто-загрузка ключей из server/.env (без сторонних зависимостей) ──
// Кладёшь ключ в файл server/.env (см. .env.example) — и `npm start` сразу его подхватит,
// не нужно каждый раз делать `set GROQ_API_KEY=...`. Файл .env в git не попадает (.gitignore).
(function loadEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || line.trim().startsWith('#')) return;
      const val = m[2].trim().replace(/^["']|["']$/g, '');
      if (!(m[1] in process.env)) process.env[m[1]] = val;
    });
    console.log('🔑 .env загружен');
  } catch (e) { /* нет .env — это нормально, работаем keyless */ }
})();

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' })); // нужен для POST /api/exam-feedback (открытые ответы могут быть длинными)

const CACHE_DIR = path.join(__dirname, '../audio/cache');
// Клиент (index.htm) обращается к порту 3002 — делаем его портом по умолчанию,
// чтобы хватало просто `npm start` без указания PORT.
const PORT = process.env.PORT || 3002;

// Создать папку кэша
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function getHashFileName(text, lang = 'it_IT') {
  const hash = crypto.createHash('md5').update(text + lang + 'v2').digest('hex');
  return `${hash}.mp3`;
}

app.get('/api/speak', (req, res) => {
  const { text, lang = 'it_IT' } = req.query;

  if (!text) {
    return res.status(400).json({ error: 'Missing text', server: 'server.js' });
  }

  const fileName = getHashFileName(text, lang);
  const filePath = path.join(CACHE_DIR, fileName);

  // Если кэш, возвращаем base64
  if (fs.existsSync(filePath)) {
    console.log(`✓ Cache: ${text}`);
    const buffer = fs.readFileSync(filePath);
    const b64 = buffer.toString('base64');
    return res.json({ audio: `data:audio/mpeg;base64,${b64}` });
  }

  // Генерируем новое
  const voicePrefix = lang.includes('it') ? 'it' : lang.split('_')[0];
  const pythonScript = path.join(__dirname, 'tts.py');
  const escapedText = text.replace(/"/g, '\\"').replace(/'/g, "\\'");

  const cmd = `python "${pythonScript}" "${escapedText}" "${filePath}" "${voicePrefix}"`;

  console.log(`⏳ Generating: ${text}`);
  console.log(`   CMD: ${cmd}`);

  exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
    if (error) {
      console.error(`✗ Error: ${stderr || error}`);
      return res.status(500).json({ error: 'TTS failed', details: stderr });
    }

    if (!fs.existsSync(filePath)) {
      console.error(`✗ File not created`);
      return res.status(500).json({ error: 'File not generated' });
    }

    console.log(`✓ Generated: ${text}`);
    const buffer = fs.readFileSync(filePath);
    const b64 = buffer.toString('base64');
    res.json({ audio: `data:audio/mpeg;base64,${b64}` });
  });
});

// ============================================================================
//  ГЕНЕРАЦИЯ ИСТОРИЙ ЧЕРЕЗ ИИ  —  /api/story
//  Анализирует переданную (изученную) лексику и просит ИИ написать связный
//  текст РАЗНОЙ структуры ТОЛЬКО из этих слов — закрепление пройденного.
//
//  Ключ кладётся в server/.env (см. .env.example), затем просто `npm start`:
//    1) Groq (Llama 3.3 70B) — рекомендуется. Бесплатно, без карты:
//       https://console.groq.com  →  API Keys  →  Create  →  GROQ_API_KEY=... в .env
//    2) Cerebras / OpenRouter — альтернативы (тоже бесплатные ключи).
//    3) Pollinations (keyless) — без настройки, но часто нестабилен.
// ============================================================================
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ── Бесплатные ИИ-провайдеры (OpenAI-совместимый API) ──
// Активируется тот, для которого в .env есть ключ. Все — бесплатные, без карты.
// Рекомендуется Groq: быстрый, стабильный, щедрые лимиты (console.groq.com).
const OPENAI_PROVIDERS = [
  { id: 'groq',       keyEnv: 'GROQ_API_KEY',       url: 'https://api.groq.com/openai/v1/chat/completions', model: () => process.env.GROQ_MODEL       || 'llama-3.3-70b-versatile' },
  { id: 'cerebras',   keyEnv: 'CEREBRAS_API_KEY',   url: 'https://api.cerebras.ai/v1/chat/completions',     model: () => process.env.CEREBRAS_MODEL   || 'llama-3.3-70b' },
  { id: 'openrouter', keyEnv: 'OPENROUTER_API_KEY', url: 'https://openrouter.ai/api/v1/chat/completions',   model: () => process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free' },
];
function activeProvider() { return OPENAI_PROVIDERS.find((p) => process.env[p.keyEnv]); }
function providerLabel() { const p = activeProvider(); return p ? p.id : 'pollinations (keyless)'; }

// Разные ФОРМАТЫ текста — выбираются случайно, чтобы истории были РАЗНОЙ структуры,
// а не один и тот же шаблон. Модель сама строит текст в выбранном формате.
const STORY_FORMATS = [
  'un piccolo racconto in terza persona su un personaggio',
  'una pagina di diario in prima persona',
  'una descrizione dettagliata (di una persona, di una casa o di una stanza)',
  'un breve dialogo tra due persone (usa il trattino – per ogni battuta)',
  'una lettera breve e amichevole a un amico',
  'un confronto tra due persone (somiglianze e differenze)',
  'una mini-intervista: brevi domande e risposte',
  'il racconto di una giornata tipo / delle abitudini quotidiane',
  'una presentazione di sé stessi (mi chiamo..., sono..., ho...)',
];

// Системный + пользовательский промпт для модели
function buildStoryPrompt(words, topics, count, format) {
  const system =
`Sei un'insegnante d'italiano madrelingua per studenti russofoni di livello A1-A2.
COMPITO: scrivere un breve testo COERENTE, NATURALE e con SENSO in italiano semplice, per CONSOLIDARE il lessico GIÀ studiato. Niente vocaboli nuovi.
REGOLE FERREE:
1. Come parole di CONTENUTO (sostantivi, aggettivi, verbi) usa SOLO quelle della lista. Puoi FLETTERLE liberamente (plurale, accordo di genere e numero, coniugazione): la flessione NON è una parola nuova.
2. Le parole funzionali sono SEMPRE permesse: articoli (il/lo/la/l'/i/gli/le/un/uno/una), preposizioni (in, a, di, con, su, per...), congiunzioni (e, ma, anche, perché), pronomi (io, tu, lui, lei, noi, voi, loro), numeri, le forme del verbo essere, le strutture c'è/ci sono, la negazione non.
3. GRAMMATICA PERFETTA: accordo corretto di genere e numero, articoli giusti. Le frasi devono essere collegate tra loro e avere senso reale.
4. MESCOLA il lessico di argomenti diversi della lista (persone, carattere, casa, ecc.): NON limitarti a un solo tema.
5. NON inventare nomi di oggetti, persone o azioni che non sono nella lista.
6. La traduzione russa deve essere naturale e grammaticalmente corretta.
Rispondi ESCLUSIVAMENTE con un oggetto JSON valido, senza testo prima o dopo.`;

  const user =
`Argomenti grammaticali da praticare: ${topics}.
Lista delle parole consentite (lessico studiato): ${words.join(', ')}.

FORMATO DEL TESTO: scrivi ${format}.
Scrivi un mini-testo di ${count} frasi collegate. Varia la struttura: questo testo deve essere diverso dai precedenti.
Rispondi con questo JSON ESATTO:
{"title":"<titolo breve in italiano>","theme":"<tema in russo, 1-3 parole>","sentences":[{"it":"<frase in italiano>","ru":"<traduzione russa naturale>"}],"focus":["<4-6 parole chiave del testo, in italiano>"]}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// Вызов конкретного OpenAI-совместимого провайдера
async function callOpenAICompatible(p, messages, temperature) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env[p.keyEnv]}` };
  if (p.id === 'openrouter') { headers['HTTP-Referer'] = 'https://stivale.local'; headers['X-Title'] = 'Stivale'; }
  const r = await fetch(p.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: p.model(), messages, temperature, response_format: { type: 'json_object' } }),
  });
  if (!r.ok) throw new Error(`${p.id} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  return { content: d.choices?.[0]?.message?.content, provider: p.id };
}

// Keyless Pollinations — анонимный доступ иногда отдаёт 403/429, поэтому ретраим
async function callPollinations(messages, temperature) {
  let lastErr;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch('https://text.pollinations.ai/openai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Referer: 'https://stivale.local/', 'User-Agent': 'Mozilla/5.0 StivaleApp' },
        body: JSON.stringify({ model: 'openai', referrer: 'stivale', messages, temperature }),
      });
      if (r.status === 403 || r.status === 429) { lastErr = new Error(`Pollinations ${r.status}`); await sleep(1500); continue; }
      if (!r.ok) throw new Error(`Pollinations ${r.status}`);
      const d = await r.json();
      const content = d?.choices?.[0]?.message?.content;
      if (!content) { lastErr = new Error('empty content'); await sleep(1200); continue; }
      return { content, provider: 'pollinations' };
    } catch (e) { lastErr = e; await sleep(1200); }
  }
  throw lastErr || new Error('AI unavailable');
}

// Вызов ИИ: сначала провайдер с ключом (если есть), при сбое — keyless fallback
async function callAI(messages, temperature = 0.85) {
  const p = activeProvider();
  if (p) {
    try { return await callOpenAICompatible(p, messages, temperature); }
    catch (e) { console.warn(`⚠ ${p.id} недоступен (${e.message}) → пробую keyless`); }
  }
  return await callPollinations(messages, temperature);
}

// Аккуратно достаёт JSON-объект истории из ответа модели
function parseStory(raw) {
  if (!raw) return null;
  let t = String(raw).trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  let d;
  try { d = JSON.parse(t); } catch (e) { return null; }
  if (!d || !Array.isArray(d.sentences)) return null;
  const sentences = d.sentences
    .filter((s) => s && s.it)
    .map((s) => ({ it: String(s.it).trim(), ru: String(s.ru || '').trim() }));
  if (!sentences.length) return null;
  return {
    title: String(d.title || '').trim(),
    theme: String(d.theme || 'История').trim(),
    icon: String(d.icon || '📖').trim(),
    sentences,
    focus: Array.isArray(d.focus) ? d.focus.map((x) => String(x).trim()).filter(Boolean).slice(0, 6) : [],
  };
}

app.get('/api/story', async (req, res) => {
  try {
    const words = String(req.query.words || '')
      .split(',').map((s) => s.trim()).filter(Boolean).slice(0, 90);
    const topics = String(req.query.topics || "essere, articoli, accordo dell'aggettivo, c'è/ci sono");
    if (!words.length) return res.status(400).json({ error: 'no words provided' });

    // Вариативность: случайный формат, длина и «температура» → каждый раз разная структура
    const format = pick(STORY_FORMATS);
    const count = 4 + Math.floor(Math.random() * 4);      // 4–7 фраз
    const temperature = 0.75 + Math.random() * 0.3;        // 0.75–1.05

    console.log(`📖 Story: ${words.length} слов · формат "${format.slice(0, 28)}…" · ${providerLabel()}`);
    const { content, provider } = await callAI(buildStoryPrompt(words, topics, count, format), temperature);
    const story = parseStory(content);
    if (!story) {
      console.error('✗ Story: не удалось разобрать JSON ИИ');
      return res.status(502).json({ error: 'bad AI output' });
    }
    console.log(`✓ Story: "${story.title}" (${story.sentences.length} фраз, ${provider})`);
    res.json({ story, provider });
  } catch (e) {
    console.error('✗ Story error:', e.message);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ============================================================================
//  РАЗБОР ГРАММАТИКИ  —  /api/explain
//  Берёт предложения текста и объясняет грамматику ПО-РУССКИ, фраза за фразой,
//  чтобы ученица поняла, ПОЧЕМУ каждая форма именно такая.
// ============================================================================
function buildExplainPrompt(sentences) {
  const system =
`Sei un'insegnante d'italiano madrelingua per una studentessa russofona di livello A1-A2.
COMPITO: spiegare la GRAMMATICA del testo dato, frase per frase, in RUSSO semplice e chiaro, così che la studentessa capisca PERCHÉ ogni forma è esattamente così, senza altre domande.
Per OGNI frase elenca i punti chiave, riferendoti alle parole concrete della frase:
- forme del verbo essere (sono/sei/è/siamo/siete/sono) e a chi si riferiscono;
- scelta dell'articolo: perché il/lo/la/l'/i/gli/le (determinativo) o un/uno/una (indeterminativo), in base a genere/numero/lettera iniziale;
- accordo dell'aggettivo: perché finisce in -o/-a/-i/-e (genere e numero del sostantivo);
- strutture c'è (singolare) / ci sono (plurale);
- preposizioni (in, a, su, di, con, nel, sul...) e possessivi (la mia, il mio, la sua...);
- plurali e numeri.
Spiega in modo BREVE, concreto e SENZA gergo complicato. TUTTE le spiegazioni sono in RUSSO.
Rispondi SOLO con un oggetto JSON valido, senza testo prima o dopo.`;

  const user =
`Testo da analizzare (una frase per riga):
${sentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Per ogni frase dai un blocco. Rispondi con questo JSON ESATTO:
{"blocks":[{"title":"<la frase italiana esatta>","notes":[{"term":"<parola o forma dalla frase>","text":"<spiegazione in russo: что это и почему именно так>"}]}]}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function parseExplain(raw) {
  if (!raw) return null;
  let t = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  let d;
  try { d = JSON.parse(t); } catch (e) { return null; }
  if (!d || !Array.isArray(d.blocks)) return null;
  const blocks = d.blocks.map((bl) => ({
    title: String(bl.title || '').trim(),
    notes: Array.isArray(bl.notes)
      ? bl.notes.map((n) => ({ term: String(n.term || '').trim(), text: String(n.text || '').trim() })).filter((n) => n.text)
      : [],
  })).filter((bl) => bl.title && bl.notes.length);
  return blocks.length ? blocks : null;
}

app.get('/api/explain', async (req, res) => {
  try {
    const text = String(req.query.text || '').trim();
    const sentences = text.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 12);
    if (!sentences.length) return res.status(400).json({ error: 'no text provided' });

    console.log(`🔍 Explain: ${sentences.length} фраз · ${providerLabel()}`);
    const { content, provider } = await callAI(buildExplainPrompt(sentences), 0.35); // низкая температура → точность
    const blocks = parseExplain(content);
    if (!blocks) {
      console.error('✗ Explain: не удалось разобрать JSON ИИ');
      return res.status(502).json({ error: 'bad AI output' });
    }
    console.log(`✓ Explain: ${blocks.length} блоков (${provider})`);
    res.json({ breakdown: blocks, provider });
  } catch (e) {
    console.error('✗ Explain error:', e.message);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ============================================================================
//  ФИДБЕК ПО ФИНАЛЬНОМУ ЭКЗАМЕНУ  —  POST /api/exam-feedback
//  Берёт проценты по слабым/сильным темам теста (lesson-43) + тексты трёх открытых
//  заданий и просит ИИ написать связный комментарий-рекомендацию ПО-РУССКИ: что уже
//  отлично, что подтянуть, без выдумывания фактов, которых нет во входных данных.
// ============================================================================
function buildExamFeedbackPrompt(d) {
  const {
    overallPct, sections, weakCategories, strongCategories, essays,
    byType, recognitionPct, productionPct, nearMisses, wrongTextSamples,
    durationLabel, deltaVsPrev, verdict,
  } = d;

  const system =
`Sei un'insegnante d'italiano madrelingua per una studentessa russofona di livello A2 che ha appena finito l'esame scritto finale del corso.
COMPITO: scrivere un'ANALISI-raccomandazione IN RUSSO, calda ma concreta e analitica, basata SOLO sui dati forniti.
STRUTTURA OBBLIGATORIA — esattamente 4 paragrafi separati da "\\n" (nessun titolo, nessun elenco puntato, niente markdown):
1) Verdetto sul livello A2 in 1-2 frasi, ancorato al voto totale (%) e, se presente, al progresso rispetto al tentativo precedente (delta). Onesto e caloroso.
2) Profilo di apprendimento: confronta RICONOSCIMENTO (scelta/vero-falso/ascolto) e PRODUZIONE ATTIVA (scrivere la forma da sé) usando le due percentuali; spiega in modo semplice cosa dice questo divario su come studiare. Se disponibili, commenta i formati di domanda più deboli.
3) Priorità concrete: 2-3 categorie deboli PIÙ importanti (con il loro %) e, se ci sono, 1-2 PATTERN di errore ricorrenti visibili dagli esempi di risposte sbagliate (es. desinenze, accordo, ausiliare, preposizioni) — nomina la regola, non correggere ogni frase. Consiglia di tornare alle lezioni relative.
4) Una frase sui testi liberi (produzione scritta): impressione di fluidità/lunghezza; se qualcuno è vuoto o corto, dillo con gentilezza.
REGOLE FERREE:
- NON inventare fatti sulla studentessa (età, paese, motivazioni).
- Cita i nomi delle categorie ESATTAMENTE come forniti.
- Concreto, niente riempitivi. Ogni paragrafo 1-2 frasi.
- Tono di sostegno: sta concludendo un corso intero, non è una pagella.
- TUTTO in RUSSO semplice e naturale.
Rispondi ESCLUSIVAMENTE con un oggetto JSON valido, senza testo prima o dopo.`;

  const secLine = Array.isArray(sections) && sections.length
    ? sections.map(s => `${s.name}: ${s.pct}% (${s.correct}/${s.total})`).join('; ')
    : 'nessun dato';
  const typeLine = Array.isArray(byType) && byType.length
    ? byType.map(t => `${t.format}: ${t.pct}% (${t.correct}/${t.total})`).join('; ')
    : 'nessun dato';
  const deltaLine = Number.isFinite(deltaVsPrev)
    ? (deltaVsPrev > 0 ? `+${deltaVsPrev}% rispetto al tentativo precedente` : (deltaVsPrev < 0 ? `${deltaVsPrev}% rispetto al tentativo precedente` : 'uguale al tentativo precedente'))
    : 'primo tentativo (nessun confronto)';

  const user =
`Voto totale dell'esame: ${overallPct}%${verdict && verdict.title ? ` — verdetto sistema: ${verdict.title}` : ''}.
Progresso: ${deltaLine}.
Tempo impiegato: ${durationLabel || 'sconosciuto'}.
Profilo abilità: riconoscimento ${recognitionPct ?? '?'}%, produzione attiva ${productionPct ?? '?'}%.
Risultato per sezione: ${secLine}.
Accuratezza per formato di domanda: ${typeLine}.
Categorie più deboli (dalla più debole): ${(weakCategories || []).join('; ') || 'nessuna'}.
Categorie forti (>=90%): ${(strongCategories || []).join('; ') || 'nessuna in particolare'}.
Esempi di risposte scritte SBAGLIATE (risposta studentessa → corretta): ${(wrongTextSamples || []).join(' | ') || 'nessuno'}.
Risposte QUASI corrette (a un passo): ${(nearMisses || []).join(' | ') || 'nessuna'}.

Testi liberi scritti dalla studentessa:
${(essays || []).map((e, i) => `${i + 1}. Consegna: ${e.prompt}\nTesto (${e.words || 0} parole): ${e.text ? e.text : '(vuoto — non scritto)'}`).join('\n\n')}

Rispondi con questo JSON ESATTO:
{"feedback":"<analisi in russo, 4 paragrafi separati da \\n>"}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function parseExamFeedback(raw) {
  if (!raw) return null;
  let t = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  let d;
  try { d = JSON.parse(t); } catch (e) { return null; }
  const feedback = d && String(d.feedback || '').trim();
  return feedback || null;
}

app.post('/api/exam-feedback', async (req, res) => {
  try {
    const body = req.body || {};
    const overallPct = Number.isFinite(body.overallPct) ? Math.round(body.overallPct) : null;
    const sections = Array.isArray(body.sections)
      ? body.sections.slice(0, 8).map((s) => ({
          name: String(s?.name || '').slice(0, 40),
          pct: Number.isFinite(s?.pct) ? Math.round(s.pct) : 0,
          correct: Number.isFinite(s?.correct) ? s.correct : 0,
          total: Number.isFinite(s?.total) ? s.total : 0,
        }))
      : [];
    const weakCategories = Array.isArray(body.weakCategories) ? body.weakCategories.slice(0, 8).map(String) : [];
    const strongCategories = Array.isArray(body.strongCategories) ? body.strongCategories.slice(0, 8).map(String) : [];
    const essays = Array.isArray(body.essays)
      ? body.essays.slice(0, 4).map((e) => ({ prompt: String(e?.prompt || '').slice(0, 300), text: String(e?.text || '').slice(0, 2000), words: Number.isFinite(e?.words) ? e.words : undefined }))
      : [];
    const byType = Array.isArray(body.byType)
      ? body.byType.slice(0, 8).map((t) => ({ format: String(t?.format || '').slice(0, 40), pct: Number.isFinite(t?.pct) ? Math.round(t.pct) : 0, correct: Number.isFinite(t?.correct) ? t.correct : 0, total: Number.isFinite(t?.total) ? t.total : 0 }))
      : [];
    const recognitionPct = Number.isFinite(body.recognitionPct) ? Math.round(body.recognitionPct) : null;
    const productionPct = Number.isFinite(body.productionPct) ? Math.round(body.productionPct) : null;
    const nearMisses = Array.isArray(body.nearMisses) ? body.nearMisses.slice(0, 6).map(s => String(s).slice(0, 120)) : [];
    const wrongTextSamples = Array.isArray(body.wrongTextSamples) ? body.wrongTextSamples.slice(0, 8).map(s => String(s).slice(0, 120)) : [];
    const durationLabel = body.durationLabel ? String(body.durationLabel).slice(0, 30) : null;
    const deltaVsPrev = Number.isFinite(body.deltaVsPrev) ? Math.round(body.deltaVsPrev) : null;
    const verdict = body.verdict && typeof body.verdict === 'object'
      ? { level: String(body.verdict.level || '').slice(0, 20), title: String(body.verdict.title || '').slice(0, 60) } : null;

    console.log(`🎓 Exam feedback: итог ${overallPct ?? '?'}% · узнав ${recognitionPct ?? '?'}%/продукц ${productionPct ?? '?'}% · ${weakCategories.length} слабых тем · ${essays.filter(e => e.text).length}/${essays.length} эссе · ${providerLabel()}`);
    const { content, provider } = await callAI(buildExamFeedbackPrompt({
      overallPct, sections, weakCategories, strongCategories, essays,
      byType, recognitionPct, productionPct, nearMisses, wrongTextSamples, durationLabel, deltaVsPrev, verdict,
    }), 0.6);
    const feedback = parseExamFeedback(content);
    if (!feedback) {
      console.error('✗ Exam feedback: не удалось разобрать JSON ИИ');
      return res.status(502).json({ error: 'bad AI output' });
    }
    console.log(`✓ Exam feedback готов (${provider})`);
    res.json({ feedback, provider });
  } catch (e) {
    console.error('✗ Exam feedback error:', e.message);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.listen(PORT, () => {
  console.log(`🎤 Сервер запущен на порту ${PORT}`);
  console.log(`📁 Кэш озвучки: ${CACHE_DIR}`);
  console.log(`🤖 ИИ-истории: ${providerLabel()}`);
  if (!activeProvider()) {
    console.log('💡 Для стабильного ИИ добавь бесплатный ключ Groq в server/.env (см. .env.example)');
  }
});
