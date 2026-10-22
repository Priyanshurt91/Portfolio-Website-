/**
 * ToTo AI — Official Gemini AI Portfolio Assistant
 * DevFest 2026 Edition for Priyanshu Raut
 */

(function () {
  'use strict';

  // State
  const state = {
    isOpen: false,
    isLoading: false,
    messages: [], // Array of { role: 'user' | 'assistant', content: string, timestamp: string }
    abortController: null,
    lastUserMessage: null
  };

  const API_ENDPOINT = '/api/chat';

  // Suggested Prompts
  const SUGGESTED_PROMPTS = [
    'Explore Projects',
    'Technical Skills',
    'Professional Experience',
    'Research Publications',
    'Contact Priyanshu'
  ];

  // DOM Elements cache
  let elements = {};

  /**
   * Sound effect trigger (respects site's audio toggle)
   */
  function triggerSound(freq, duration) {
    if (typeof window.playClickSound === 'function') {
      window.playClickSound(freq, duration);
    }
  }

  /**
   * Format current time as '12:45 PM'
   */
  function getCurrentTime() {
    const d = new Date();
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  /**
   * Safe Markdown parser & link sanitizer
   * Prevents XSS by escaping HTML entities first
   */
  function renderMarkdown(rawText) {
    if (!rawText) return '';

    // 1. Escape HTML
    let text = rawText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // 2. Fenced Code Blocks: ```lang\ncode\n```
    text = text.replace(/```(?:[a-zA-Z0-9_\-\+]*\n)?([\s\S]*?)```/g, function (_, code) {
      return '<pre><code>' + code.trim() + '</code></pre>';
    });

    // 3. Inline Code: `code`
    text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>');

    // 4. Headings
    text = text.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
    text = text.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    text = text.replace(/^## (.*$)/gim, '<h3>$1</h3>');
    text = text.replace(/^# (.*$)/gim, '<h3>$1</h3>');

    // 5. Blockquotes: > quote
    text = text.replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>');

    // 6. Bold & Italic
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    text = text.replace(/_([^_]+)_/g, '<em>$1</em>');

    // 7. Sanitized Links: [text](url)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, label, url) {
      const trimmedUrl = url.trim();
      const isAllowed = /^https?:\/\//i.test(trimmedUrl) ||
                        /^mailto:/i.test(trimmedUrl) ||
                        /^tel:/i.test(trimmedUrl) ||
                        trimmedUrl.startsWith('#');
      if (!isAllowed) {
        return label; // strip invalid protocol
      }
      return '<a href="' + trimmedUrl + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
    });

    // 8. Unordered Lists: lines starting with * or -
    text = text.replace(/(?:^|\n)[*-] (.*)(?=(?:\n[*-] .*|$))/g, function (match) {
      const items = match.trim().split(/\n[*-] /);
      const listItems = items.map(function (item) {
        return '<li>' + item.replace(/^[*-] /, '') + '</li>';
      }).join('');
      return '<ul>' + listItems + '</ul>';
    });

    // 9. Ordered Lists: lines starting with 1. 2. etc
    text = text.replace(/(?:^|\n)\d+\. (.*)(?=(?:\n\d+\. .*|$))/g, function (match) {
      const items = match.trim().split(/\n\d+\. /);
      const listItems = items.map(function (item) {
        return '<li>' + item.replace(/^\d+\. /, '') + '</li>';
      }).join('');
      return '<ol>' + listItems + '</ol>';
    });

    // 10. Paragraphs / Linebreaks
    const paragraphs = text.split(/\n\n+/);
    text = paragraphs.map(function (para) {
      para = para.trim();
      if (!para) return '';
      if (/^<(?:pre|h[1-4]|blockquote|ul|ol)/i.test(para)) {
        return para;
      }
      return '<p>' + para.replace(/\n/g, '<br>') + '</p>';
    }).join('');

    return text;
  }

  /**
   * Build the Assistant DOM Widget
   */
  function initWidget() {
    // Launcher Button
    const launcher = document.createElement('button');
    launcher.id = 'totoLauncher';
    launcher.className = 'toto-launcher press';
    launcher.setAttribute('aria-label', 'Open ToTo AI Chat Assistant');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.innerHTML = `
      <div class="toto-launcher-avatar">
        🤖
        <span class="toto-status-dot" aria-hidden="true"></span>
      </div>
      <div class="toto-launcher-text">
        <span class="toto-launcher-title">ToTo AI</span>
        <span class="toto-launcher-badge">DevFest Assistant</span>
      </div>
    `;

    // Chat Panel
    const panel = document.createElement('div');
    panel.id = 'totoPanel';
    panel.className = 'toto-chat-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'ToTo AI Portfolio Assistant');
    panel.setAttribute('aria-modal', 'false');
    panel.innerHTML = `
      <header class="toto-header">
        <div class="toto-header-info">
          <div class="toto-header-avatar">🤖</div>
          <div class="toto-header-text">
            <h3>ToTo AI <span class="toto-gemini-pill">Gemini Flash</span></h3>
            <div class="toto-header-sub">Official DevFest Portfolio Assistant</div>
          </div>
        </div>
        <div class="toto-header-actions">
          <button id="totoClearBtn" class="toto-icon-btn press-sm" title="Clear conversation" aria-label="Clear conversation">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6h18"></path>
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
            </svg>
          </button>
          <button id="totoCloseBtn" class="toto-icon-btn press-sm" title="Close chat" aria-label="Close chat">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </header>

      <div class="toto-messages-container" id="totoMessages" aria-live="polite">
        <!-- Welcome Card -->
        <div class="toto-welcome-card" id="totoWelcomeCard">
          <div class="toto-welcome-header">
            <span>✨</span>
            <span>Welcome to Priyanshu's AI Terminal</span>
          </div>
          <div class="toto-welcome-msg">
            Hi! I'm ToTo AI assistant. Ask me about his projects, technical skills, experience, or research.
          </div>
          <div class="toto-suggested-prompts-title">Suggested Prompts</div>
          <div class="toto-suggested-prompts" id="totoPromptChips"></div>
        </div>
      </div>

      <footer class="toto-footer">
        <form class="toto-input-form" id="totoForm" onsubmit="return false;">
          <textarea
            id="totoInput"
            class="toto-textarea"
            placeholder="Ask ToTo AI anything about Priyanshu..."
            rows="1"
            maxlength="1500"
            aria-label="Your message for ToTo AI"
          ></textarea>
          <button type="submit" id="totoSendBtn" class="toto-send-btn press" aria-label="Send message">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </form>
        <div class="toto-footer-hint">
          <span>Powered by Google Gemini</span>
          <span>Shift+Enter for newline</span>
        </div>
      </footer>
    `;

    document.body.appendChild(launcher);
    document.body.appendChild(panel);

    // Cache elements
    elements = {
      launcher: launcher,
      panel: panel,
      messages: document.getElementById('totoMessages'),
      welcomeCard: document.getElementById('totoWelcomeCard'),
      promptChips: document.getElementById('totoPromptChips'),
      form: document.getElementById('totoForm'),
      input: document.getElementById('totoInput'),
      sendBtn: document.getElementById('totoSendBtn'),
      clearBtn: document.getElementById('totoClearBtn'),
      closeBtn: document.getElementById('totoCloseBtn')
    };

    // Render suggested prompt chips
    SUGGESTED_PROMPTS.forEach(function (promptText) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'toto-prompt-chip press-sm';
      chip.textContent = promptText;
      chip.addEventListener('click', function () {
        triggerSound(680, 0.04);
        sendMessage(promptText);
      });
      elements.promptChips.appendChild(chip);
    });

    // Auto-expand textarea
    elements.input.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 100) + 'px';
    });

    // Keyboard handling: Enter to send, Shift+Enter for newline
    elements.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitForm();
      }
    });

    // Event Listeners
    elements.launcher.addEventListener('click', toggleChat);
    elements.closeBtn.addEventListener('click', closeChat);
    elements.clearBtn.addEventListener('click', clearConversation);
    elements.form.addEventListener('submit', function (e) {
      e.preventDefault();
      submitForm();
    });

    // Global ESC to close chat
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.isOpen) {
        closeChat();
      }
    });
  }

  /**
   * Toggle Chat Panel
   */
  function toggleChat() {
    if (state.isOpen) {
      closeChat();
    } else {
      openChat();
    }
  }

  function openChat() {
    state.isOpen = true;
    elements.panel.classList.add('open');
    elements.launcher.setAttribute('aria-expanded', 'true');
    triggerSound(580, 0.05);

    setTimeout(function () {
      elements.input.focus();
    }, 150);

    scrollToBottom();
  }

  function closeChat() {
    state.isOpen = false;
    elements.panel.classList.remove('open');
    elements.launcher.setAttribute('aria-expanded', 'false');
    triggerSound(420, 0.05);
    elements.launcher.focus();
  }

  /**
   * Clear Chat Conversation
   */
  function clearConversation() {
    if (state.abortController) {
      state.abortController.abort();
      state.abortController = null;
    }

    state.messages = [];
    state.lastUserMessage = null;
    state.isLoading = false;
    updateSendButtonState();

    // Remove all message rows
    const rows = elements.messages.querySelectorAll('.toto-msg-row, .toto-error-card');
    rows.forEach(function (r) { r.remove(); });

    // Show welcome card
    elements.welcomeCard.style.display = 'flex';
    triggerSound(520, 0.06);

    if (typeof window.showToast === 'function') {
      window.showToast('Chat conversation reset.');
    }
  }

  /**
   * Scroll messages container to bottom
   */
  function scrollToBottom() {
    requestAnimationFrame(function () {
      elements.messages.scrollTop = elements.messages.scrollHeight;
    });
  }

  /**
   * Update Send Button State
   */
  function updateSendButtonState() {
    elements.sendBtn.disabled = state.isLoading;
  }

  /**
   * Handle Form Submission
   */
  function submitForm() {
    const text = elements.input.value.trim();
    if (!text || state.isLoading) return;

    elements.input.value = '';
    elements.input.style.height = 'auto';
    sendMessage(text);
  }

  /**
   * Send Message to Gemini API
   */
  async function sendMessage(userText) {
    if (!userText || state.isLoading) return;

    // Hide welcome card once conversation begins
    elements.welcomeCard.style.display = 'none';

    // Store last message for retry
    state.lastUserMessage = userText;

    // 1. Append User Message Row
    const userTimestamp = getCurrentTime();
    state.messages.push({ role: 'user', content: userText, timestamp: userTimestamp });
    appendMessageRow('user', userText, userTimestamp);

    // 2. Prepare Assistant Row with typing indicator
    state.isLoading = true;
    updateSendButtonState();

    const assistantTimestamp = getCurrentTime();
    const assistantRow = appendMessageRow('assistant', '', assistantTimestamp, true);
    const bubble = assistantRow.querySelector('.toto-msg-bubble');

    triggerSound(640, 0.04);
    scrollToBottom();

    // 3. Initiate Streaming Fetch to /api/chat
    state.abortController = new AbortController();
    let accumulatedText = '';
    let hasReceivedChunk = false;

    try {
      const payload = {
        messages: state.messages.map(function (m) {
          return { role: m.role, content: m.content };
        }),
        stream: true
      };

      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        body: JSON.stringify(payload),
        signal: state.abortController.signal
      });

      // Handle non-OK HTTP status
      if (!response.ok) {
        let errData;
        try {
          errData = await response.json();
        } catch (_) {
          errData = { error: 'Server returned HTTP ' + response.status };
        }
        throw new Error(errData.error || 'Request failed with status ' + response.status);
      }

      // Check if response is streaming SSE
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream') && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop(); // keep remainder

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line.startsWith('data:')) continue;

            const dataStr = line.slice(5).trim();
            if (dataStr === '[DONE]') {
              break;
            }

            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.error) {
                throw new Error(parsed.error);
              }
              if (parsed.text) {
                if (!hasReceivedChunk) {
                  hasReceivedChunk = true;
                  bubble.innerHTML = ''; // Clear typing indicator
                }
                accumulatedText += parsed.text;
                bubble.innerHTML = renderMarkdown(accumulatedText) + '<span class="toto-cursor" aria-hidden="true"></span>';
                scrollToBottom();
              }
            } catch (parseErr) {
              // Ignore partial JSON parse errors
              if (parseErr.message && !parseErr.message.includes('Unexpected')) {
                throw parseErr;
              }
            }
          }
        }
      } else {
        // Fallback non-streaming JSON
        const json = await response.json();
        if (json.error) throw new Error(json.error);
        accumulatedText = json.text || '';
      }

      // Remove blinking cursor and finalize markdown
      bubble.innerHTML = renderMarkdown(accumulatedText || 'I could not generate a response. Please try rephrasing.');
      state.messages.push({
        role: 'assistant',
        content: accumulatedText,
        timestamp: assistantTimestamp
      });
      triggerSound(720, 0.04);

    } catch (err) {
      if (err.name === 'AbortError') {
        // User aborted/cleared
        assistantRow.remove();
        return;
      }

      // Display friendly error card with retry button
      assistantRow.remove();
      appendErrorCard(err.message || 'Unable to connect to ToTo AI. Please check your connection.');
      triggerSound(320, 0.08);

    } finally {
      state.isLoading = false;
      state.abortController = null;
      updateSendButtonState();
      scrollToBottom();
    }
  }

  /**
   * Append a Message Row to Chat Body
   */
  function appendMessageRow(role, content, timestamp, isTyping) {
    const row = document.createElement('div');
    row.className = 'toto-msg-row ' + role;

    const meta = document.createElement('div');
    meta.className = 'toto-msg-meta';
    meta.innerHTML = (role === 'assistant' ? '<span>ToTo AI</span> · ' : '<span>You</span> · ') +
                     '<span>' + timestamp + '</span>';

    const bubble = document.createElement('div');
    bubble.className = 'toto-msg-bubble';

    if (isTyping) {
      bubble.innerHTML = `
        <div class="toto-typing-indicator" aria-label="ToTo AI is thinking">
          <span class="toto-typing-dot"></span>
          <span class="toto-typing-dot"></span>
          <span class="toto-typing-dot"></span>
        </div>
      `;
    } else {
      bubble.innerHTML = renderMarkdown(content);
    }

    row.appendChild(meta);
    row.appendChild(bubble);
    elements.messages.appendChild(row);

    return row;
  }

  /**
   * Append Error Card with Retry Button
   */
  function appendErrorCard(errorMessage) {
    const card = document.createElement('div');
    card.className = 'toto-error-card';
    card.setAttribute('role', 'alert');
    card.innerHTML = `
      <div class="toto-error-msg">
        <span class="toto-error-icon">⚠️</span>
        <span>${errorMessage}</span>
      </div>
      <button type="button" class="toto-retry-btn press-sm">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10"></polyline>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
        </svg>
        Retry
      </button>
    `;

    const retryBtn = card.querySelector('.toto-retry-btn');
    retryBtn.addEventListener('click', function () {
      card.remove();
      triggerSound(600, 0.04);
      if (state.lastUserMessage) {
        // Pop the failed user message from state to avoid duplicate
        if (state.messages.length > 0 && state.messages[state.messages.length - 1].content === state.lastUserMessage) {
          state.messages.pop();
        }
        // Also remove the last user message row from DOM
        const rows = elements.messages.querySelectorAll('.toto-msg-row.user');
        if (rows.length) {
          rows[rows.length - 1].remove();
        }
        sendMessage(state.lastUserMessage);
      }
    });

    elements.messages.appendChild(card);
    scrollToBottom();
  }

  // Initialize once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWidget);
  } else {
    initWidget();
  }
})();
