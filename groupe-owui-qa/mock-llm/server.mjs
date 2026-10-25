/**
 * Mock LLM — serveur compatible OpenAI, sans dépendance, déterministe.
 *
 * Plan B du sujet F1 : Open WebUI le voit comme un fournisseur OpenAI
 * classique, ce qui rend la suite E2E gratuite, rapide et reproductible
 * (indispensable pour la CI et pour mesurer la flakiness).
 *
 * Endpoints :
 *   GET  /health
 *   GET  /v1/models
 *   POST /v1/chat/completions   (stream et non-stream)
 *   POST /v1/embeddings         (sac de mots haché, dimension fixe)
 *
 * Directives dans le dernier message utilisateur (scénarios d'erreur) :
 *   [[mock:error]]     -> HTTP 500
 *   [[mock:slow=MS]]   -> attend MS millisecondes avant de répondre
 *   [[mock:jitter=MS]] -> délai aléatoire de 0 à MS ms entre chaque mot
 *                         (imite le débit irrégulier d'un vrai LLM)
 */
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 11500);
const EMBED_DIM = 256;
const CHAT_MODELS = ['mock-echo'];
const EMBED_MODEL = 'mock-embed';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => p.text ?? '').join(' ');
  return '';
}

/** Réponse déterministe : écho de la question, plus les sources RAG si présentes. */
function buildAnswer(messages) {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const userText = textOf(lastUser?.content ?? '');

  // Open WebUI injecte le contexte RAG dans les messages, balisé <source id="...">.
  const all = messages.map((m) => textOf(m.content)).join('\n');
  const sourceIds = [...all.matchAll(/<source[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);

  // Question réelle : dernière ligne après le contexte RAG éventuel.
  const question = userText.split('</context>').pop().trim().split('\n').pop().trim();
  let answer = `MOCK-ECHO: ${question}`;
  if (sourceIds.length > 0) {
    answer += `\n\nRéponse fondée sur ${sourceIds.length} source(s) [${sourceIds[0]}].`;
  }
  return answer;
}

function hashEmbedding(text) {
  const vec = new Array(EMBED_DIM).fill(0);
  for (const tok of text.toLowerCase().normalize('NFKD').match(/[a-z0-9]+/g) ?? []) {
    const h = crypto.createHash('md5').update(tok).digest();
    vec[h.readUInt16BE(0) % EMBED_DIM] += h[2] & 1 ? 1 : -1;
  }
  const norm = Math.hypot(...vec) || 1;
  return vec.map((v) => v / norm);
}

async function chatCompletions(req, res) {
  const body = await readBody(req);
  const messages = body.messages ?? [];
  const lastUser = textOf([...messages].reverse().find((m) => m.role === 'user')?.content ?? '');

  if (lastUser.includes('[[mock:error]]')) {
    return json(res, 500, { error: { message: 'Mock LLM: erreur simulée', type: 'server_error' } });
  }
  const slow = lastUser.match(/\[\[mock:slow=(\d+)\]\]/);
  if (slow) await sleep(Number(slow[1]));
  const jitter = Number(lastUser.match(/\[\[mock:jitter=(\d+)\]\]/)?.[1] ?? 0);

  const id = `chatcmpl-mock-${Date.now()}`;
  const model = body.model ?? CHAT_MODELS[0];
  const created = Math.floor(Date.now() / 1000);
  const answer = buildAnswer(messages);

  if (!body.stream) {
    return json(res, 200, {
      id, object: 'chat.completion', created, model,
      choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: answer.split(/\s+/).length, total_tokens: 0 },
    });
  }

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (delta, finish = null) =>
    res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
  send({ role: 'assistant', content: '' });
  // Découpage en mots pour exercer réellement le rendu en streaming.
  for (const piece of answer.match(/\S+\s*/g) ?? []) {
    send({ content: piece });
    await sleep(15 + Math.random() * jitter);
  }
  send({}, 'stop');
  res.end('data: [DONE]\n\n');
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname.replace(/^\/v1/, '');
    if (req.method === 'GET' && path === '/health') return json(res, 200, { status: true });
    if (req.method === 'GET' && path === '/models') {
      return json(res, 200, {
        object: 'list',
        data: [...CHAT_MODELS, EMBED_MODEL].map((id) => ({ id, object: 'model', created: 0, owned_by: 'mock' })),
      });
    }
    if (req.method === 'POST' && path === '/chat/completions') return await chatCompletions(req, res);
    if (req.method === 'POST' && path === '/embeddings') {
      const body = await readBody(req);
      const inputs = Array.isArray(body.input) ? body.input : [body.input ?? ''];
      return json(res, 200, {
        object: 'list', model: EMBED_MODEL,
        data: inputs.map((t, index) => ({ object: 'embedding', index, embedding: hashEmbedding(String(t)) })),
        usage: { prompt_tokens: 0, total_tokens: 0 },
      });
    }
    json(res, 404, { error: { message: `Not found: ${req.method} ${url.pathname}` } });
  } catch (err) {
    json(res, 400, { error: { message: String(err) } });
  }
});

server.listen(PORT, () => console.log(`mock-llm listening on :${PORT}`));
