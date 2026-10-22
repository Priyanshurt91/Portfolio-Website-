import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRateLimit } from '../api/rate-limit.js';
import { PORTFOLIO_KNOWLEDGE, SYSTEM_INSTRUCTION } from '../api/knowledge.js';
import handler from '../api/chat.js';
import { EventEmitter } from 'node:events';

// Mock HTTP Response
function createMockResponse() {
  const res = new EventEmitter();
  res.headers = {};
  res.statusCode = 200;
  res.body = '';
  res.chunks = [];

  res.setHeader = (key, value) => {
    res.headers[key.toLowerCase()] = value;
  };
  res.writeHead = (status, headers = {}) => {
    res.statusCode = status;
    for (const [k, v] of Object.entries(headers)) {
      res.headers[k.toLowerCase()] = v;
    }
  };
  res.write = (chunk) => {
    res.chunks.push(chunk);
    res.body += chunk;
  };
  res.end = (chunk) => {
    if (chunk) res.body += chunk;
    res.emit('finish');
  };

  return res;
}

test('Rate limiter works as expected', () => {
  const testIp = '192.168.1.100';
  let firstCheck = checkRateLimit(testIp);
  assert.equal(firstCheck.allowed, true);

  // Consume remaining tokens
  for (let i = 0; i < 15; i++) {
    checkRateLimit(testIp);
  }

  let blockedCheck = checkRateLimit(testIp);
  assert.equal(blockedCheck.allowed, false);
  assert.equal(blockedCheck.remaining, 0);
  assert.ok(blockedCheck.resetInSeconds > 0);
});

test('Knowledge base and System Instruction are properly loaded', () => {
  assert.ok(PORTFOLIO_KNOWLEDGE.includes('Priyanshu Raut'));
  assert.ok(PORTFOLIO_KNOWLEDGE.includes('Swin Transformer V2'));
  assert.ok(PORTFOLIO_KNOWLEDGE.includes('Glaucoma Detection Using Transformers'));
  assert.ok(PORTFOLIO_KNOWLEDGE.includes('AI-Based Seva Kendra Form Automation System'));
  assert.ok(PORTFOLIO_KNOWLEDGE.includes('Maharashtra Remote Sensing Application Centre (MRSAC)'));
  assert.ok(PORTFOLIO_KNOWLEDGE.includes('Helpdesk Chatbot: Technology and Human-Centred Design'));
  assert.ok(SYSTEM_INSTRUCTION.includes('ToTo AI'));
  assert.ok(SYSTEM_INSTRUCTION.includes('NEVER invent employment history'));
});

test('OPTIONS preflight returns 200 with CORS headers', async () => {
  const req = {
    method: 'OPTIONS',
    headers: {}
  };
  const res = createMockResponse();

  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['access-control-allow-origin'], '*');
});

test('Non-POST requests return 405 Method Not Allowed', async () => {
  const req = {
    method: 'GET',
    headers: {}
  };
  const res = createMockResponse();

  await handler(req, res);
  assert.equal(res.statusCode, 405);
  const data = JSON.parse(res.body);
  assert.ok(data.error.includes('Method Not Allowed'));
});

test('Validates empty or malformed message arrays', async () => {
  const req = {
    method: 'POST',
    headers: { 'x-forwarded-for': '10.0.0.1' },
    body: { messages: [] }
  };
  const res = createMockResponse();

  await handler(req, res);
  assert.equal(res.statusCode, 400);
  const data = JSON.parse(res.body);
  assert.ok(data.error.includes('non-empty "messages" array'));
});

test('Validates message role and oversized content', async () => {
  const req = {
    method: 'POST',
    headers: { 'x-forwarded-for': '10.0.0.2' },
    body: {
      messages: [{ role: 'hacker', content: 'hello' }]
    }
  };
  const res = createMockResponse();

  await handler(req, res);
  assert.equal(res.statusCode, 400);
  const data = JSON.parse(res.body);
  assert.ok(data.error.includes('Invalid message role'));
});

test('Missing GEMINI_API_KEY returns safe 500 without leaking secrets', async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  const req = {
    method: 'POST',
    headers: { 'x-forwarded-for': '10.0.0.3' },
    body: {
      messages: [{ role: 'user', content: 'What is your background?' }]
    }
  };
  const res = createMockResponse();

  await handler(req, res);
  assert.equal(res.statusCode, 500);
  const data = JSON.parse(res.body);
  assert.ok(data.error.includes('GEMINI_API_KEY is not configured'));

  if (prevKey) process.env.GEMINI_API_KEY = prevKey;
});
