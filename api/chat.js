import { GoogleGenAI } from '@google/genai';
import { SYSTEM_INSTRUCTION } from './knowledge.js';
import { checkRateLimit } from './rate-limit.js';

// Configuration defaults
const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const FALLBACK_MODEL = 'gemini-2.5-flash';
const MAX_HISTORY_MESSAGES = 12;
const MAX_MESSAGE_LENGTH = 1500;
const MAX_TOTAL_LENGTH = 10000;

/**
 * Helper to safely extract client IP from headers or socket
 */
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Helper to read request body if not already parsed
 */
async function parseRequestBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      throw new Error('Invalid JSON payload');
    }
  }

  // Read raw stream if req.body is undefined
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 50000) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', err => reject(err));
  });
}

/**
 * Validates and converts incoming conversation history into Gemini format
 */
function validateAndFormatMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('Request must include a non-empty "messages" array.');
  }

  if (messages.length > MAX_HISTORY_MESSAGES) {
    throw new Error(`Conversation exceeds maximum allowed history (${MAX_HISTORY_MESSAGES} messages). Please clear chat.`);
  }

  let totalChars = 0;
  const contents = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || typeof msg !== 'object') {
      throw new Error(`Invalid message item at index ${i}.`);
    }

    const rawRole = (msg.role || '').toLowerCase().trim();
    if (rawRole !== 'user' && rawRole !== 'assistant' && rawRole !== 'model') {
      throw new Error(`Invalid message role "${msg.role}". Supported roles are "user" and "assistant".`);
    }

    const text = typeof msg.content === 'string' ? msg.content.trim() : '';
    if (!text) {
      throw new Error(`Message at index ${i} cannot have empty text.`);
    }

    if (text.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Message exceeds maximum limit of ${MAX_MESSAGE_LENGTH} characters.`);
    }

    totalChars += text.length;
    if (totalChars > MAX_TOTAL_LENGTH) {
      throw new Error(`Total conversation history exceeds maximum allowed character budget (${MAX_TOTAL_LENGTH} characters).`);
    }

    const geminiRole = rawRole === 'assistant' ? 'model' : 'user';
    contents.push({
      role: geminiRole,
      parts: [{ text }]
    });
  }

  const lastMessage = contents[contents.length - 1];
  if (lastMessage.role !== 'user') {
    throw new Error('The latest message in the conversation must originate from the user.');
  }

  return contents;
}

/**
 * Main Vercel Serverless Function Handler
 */
export default async function handler(req, res) {
  // CORS Configuration
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method Not Allowed. Please send a POST request.' }));
    return;
  }

  // Rate Limiting (In-memory per serverless worker instance)
  const clientIp = getClientIp(req);
  const rateLimit = checkRateLimit(clientIp);
  res.setHeader('X-RateLimit-Remaining', String(rateLimit.remaining));

  if (!rateLimit.allowed) {
    res.writeHead(429, {
      'Content-Type': 'application/json',
      'Retry-After': String(rateLimit.resetInSeconds)
    });
    res.end(JSON.stringify({
      error: `Rate limit reached. Please wait ${rateLimit.resetInSeconds} seconds before sending another message.`
    }));
    return;
  }

  // Parse Body
  let body;
  try {
    body = await parseRequestBody(req);
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message || 'Malformed request body.' }));
    return;
  }

  // Validate Messages
  let contents;
  try {
    contents = validateAndFormatMessages(body.messages);
  } catch (validationErr) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: validationErr.message }));
    return;
  }

  // Validate API Key
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here' || apiKey.trim() === '') {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'GEMINI_API_KEY is not configured on the server. Please set your Gemini API key in the Vercel dashboard under Settings → Environment Variables.'
    }));
    return;
  }

  // Initialize official @google/genai SDK
  const ai = new GoogleGenAI({ apiKey });
  const wantsStream = body.stream !== false;
  const targetModel = body.model || DEFAULT_MODEL;

  const geminiConfig = {
    systemInstruction: SYSTEM_INSTRUCTION,
    maxOutputTokens: 1200,
    temperature: 0.6,
  };

  // Handle Streaming Response
  if (wantsStream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let clientDisconnected = false;
    req.on('close', () => {
      clientDisconnected = true;
    });

    try {
      let responseStream;
      const callStream = (m) => ai.models.generateContentStream({
        model: m,
        contents,
        config: geminiConfig,
      });

      try {
        responseStream = await callStream(targetModel);
      } catch (firstErr) {
        const isUnavailable = firstErr?.status === 503 || firstErr?.message?.includes('high demand') || firstErr?.message?.includes('UNAVAILABLE');
        if (isUnavailable) {
          // Wait 900ms and retry once
          await new Promise((resolve) => setTimeout(resolve, 900));
          responseStream = await callStream(targetModel);
        } else if (targetModel !== FALLBACK_MODEL && (firstErr?.status === 404 || firstErr?.message?.includes('not found'))) {
          responseStream = await callStream(FALLBACK_MODEL);
        } else {
          throw firstErr;
        }
      }

      for await (const chunk of responseStream) {
        if (clientDisconnected) break;
        const text = chunk.text || '';
        if (text) {
          res.write(`data: ${JSON.stringify({ text })}\n\n`);
        }
      }

      if (!clientDisconnected) {
        res.write('data: [DONE]\n\n');
        res.end();
      }
    } catch (streamErr) {
      if (clientDisconnected) return;
      console.error('[Gemini Stream Error]:', streamErr?.status, streamErr?.message || streamErr);

      let safeMessage = 'An unexpected error occurred while communicating with Gemini.';
      const errMsg = streamErr?.message || '';

      if (streamErr?.status === 429 || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota')) {
        safeMessage = 'ToTo AI is currently experiencing high demand. The Gemini quota limit was reached. Please try again shortly.';
      } else if (streamErr?.status === 503 || errMsg.includes('503') || errMsg.includes('UNAVAILABLE') || errMsg.includes('high demand')) {
        safeMessage = 'Google Gemini is currently experiencing a temporary demand spike. Please click Retry below to re-submit your question.';
      } else if (streamErr?.status === 403 || errMsg.includes('API_KEY_INVALID') || errMsg.includes('API key not valid')) {
        safeMessage = 'The configured Gemini API key is invalid or lacks necessary permissions. Please verify GEMINI_API_KEY.';
      } else if (errMsg.includes('timeout') || errMsg.includes('DEADLINE_EXCEEDED')) {
        safeMessage = 'The request to Gemini timed out. Please try asking again.';
      }

      // Stream the error as an SSE event so the frontend displays it smoothly
      res.write(`data: ${JSON.stringify({ error: safeMessage })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } else {
    // Non-streaming fallback
    try {
      let response;
      try {
        response = await ai.models.generateContent({
          model: targetModel,
          contents,
          config: geminiConfig,
        });
      } catch (modelErr) {
        if (targetModel !== FALLBACK_MODEL && (modelErr?.status === 404 || modelErr?.message?.includes('not found'))) {
          response = await ai.models.generateContent({
            model: FALLBACK_MODEL,
            contents,
            config: geminiConfig,
          });
        } else {
          throw modelErr;
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ text: response.text || '' }));
    } catch (genErr) {
      let statusCode = 500;
      let safeMessage = 'An error occurred while communicating with Gemini.';
      const errMsg = genErr?.message || '';

      if (genErr?.status === 429 || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota')) {
        statusCode = 429;
        safeMessage = 'ToTo AI is currently experiencing high demand. The Gemini quota limit was reached. Please try again shortly.';
      } else if (genErr?.status === 403 || errMsg.includes('API_KEY_INVALID')) {
        statusCode = 403;
        safeMessage = 'The configured Gemini API key is invalid. Please verify GEMINI_API_KEY in your environment.';
      }

      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeMessage }));
    }
  }
}
