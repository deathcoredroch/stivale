const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use(cors());

const CACHE_DIR = path.join(__dirname, '../audio/cache');
const PORT = process.env.PORT || 3001;

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
//  текст ТОЛЬКО из этих слов — закрепление пройденного, без новых слов.
//
//  Провайдеры по приоритету:
//    1) Groq (Llama 3.3 70B) — лучшее качество. Нужен БЕСПЛАТНЫЙ ключ (без карты):
//       https://console.groq.com  →  API Keys  →  Create.
//       Запусти сервер так:  set GROQ_API_KEY=твой_ключ && npm start   (Windows)
//    2) Pollinations (keyless) — работает БЕЗ настройки, качество скромнее.
// ============================================================================
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL   = process.env.GROQ_MODEL   || 'llama-3.3-70b-versatile';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Системный + пользовательский промпт для модели
function buildStoryPrompt(words, topics, count) {
  const system =
`Sei un'insegnante d'italiano madrelingua per studenti russofoni di livello A1-A2.
COMPITO: scrivere un breve testo COERENTE, NATURALE e con SENSO in italiano semplice, per CONSOLIDARE il lessico GIÀ studiato. Niente vocaboli nuovi.
REGOLE FERREE:
1. Come parole di CONTENUTO (sostantivi, aggettivi, verbi) usa SOLO quelle della lista. Puoi FLETTERLE liberamente (plurale, accordo di genere e numero, coniugazione): la flessione NON è una parola nuova.
2. Le parole funzionali sono SEMPRE permesse: articoli (il/lo/la/l'/i/gli/le/un/uno/una), preposizioni (in, a, di, con, su, per...), congiunzioni (e, ma, anche, perché), pronomi (io, tu, lui, lei, noi, voi, loro), numeri, le forme del verbo essere, le strutture c'è/ci sono, la negazione non.
3. GRAMMATICA PERFETTA: accordo corretto di genere e numero, articoli giusti. Le frasi devono essere collegate tra loro e avere senso reale.
4. NON inventare nomi di oggetti, persone o azioni che non sono nella lista.
5. La traduzione russa deve essere naturale e grammaticalmente corretta.
Rispondi ESCLUSIVAMENTE con un oggetto JSON valido, senza testo prima o dopo.`;

  const user =
`Argomenti grammaticali da praticare: ${topics}.
Lista delle parole consentite (lessico studiato): ${words.join(', ')}.

Scrivi un mini-testo di ${count} frasi collegate (una descrizione o un piccolo racconto).
Rispondi con questo JSON ESATTO:
{"title":"<titolo breve in italiano>","theme":"<tema in russo, 1-3 parole>","icon":"<una emoji adatta al tema>","sentences":[{"it":"<frase in italiano>","ru":"<traduzione russa naturale>"}],"focus":["<4-6 parole chiave del testo, in italiano>"]}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// Вызов ИИ: сначала Groq (если есть ключ), иначе keyless Pollinations с ретраями
async function callAI(messages, temperature = 0.85) {
  if (GROQ_API_KEY) {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        temperature,
        response_format: { type: 'json_object' },
      }),
    });
    if (!r.ok) throw new Error(`Groq ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const d = await r.json();
    return { content: d.choices?.[0]?.message?.content, provider: 'groq' };
  }

  // Keyless Pollinations — анонимный доступ иногда отдаёт 403, поэтому ретраим
  let lastErr;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch('https://text.pollinations.ai/openai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Referer: 'https://stivale.local/',
          'User-Agent': 'Mozilla/5.0 StivaleApp',
        },
        body: JSON.stringify({ model: 'openai', referrer: 'stivale', messages, temperature }),
      });
      if (r.status === 403 || r.status === 429) { lastErr = new Error(`Pollinations ${r.status}`); await sleep(1500); continue; }
      if (!r.ok) throw new Error(`Pollinations ${r.status}`);
      const d = await r.json();
      const content = d?.choices?.[0]?.message?.content;
      if (!content) { lastErr = new Error('empty content'); await sleep(1200); continue; }
      return { content, provider: 'pollinations' };
    } catch (e) {
      lastErr = e;
      await sleep(1200);
    }
  }
  throw lastErr || new Error('AI unavailable');
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
    const count = Math.min(Math.max(parseInt(req.query.count, 10) || 6, 3), 8);
    if (!words.length) return res.status(400).json({ error: 'no words provided' });

    console.log(`📖 Story: ${words.length} слов, провайдер ${GROQ_API_KEY ? 'groq' : 'pollinations'}`);
    const { content, provider } = await callAI(buildStoryPrompt(words, topics, count));
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

app.listen(PORT, () => {
  console.log(`🎤 Server on port ${PORT}`);
  console.log(`📁 Cache: ${CACHE_DIR}`);
  console.log(`🤖 AI истории: ${GROQ_API_KEY ? 'Groq (' + GROQ_MODEL + ')' : 'Pollinations (keyless)'}`);
});
