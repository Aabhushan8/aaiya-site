/* Aaiya Solutions — embeddable chat widget (v1.0)
 *
 * TWO MODES:
 *  1. "demo"  — 100% client-side, rule-based answers from `knowledgeBase`.
 *     Zero cost, zero API keys, nothing to abuse. Use for demos & the agency site.
 *  2. "api"   — sends messages to your backend (see ../chatbot-backend/app.py).
 *     The backend enforces rate limits, input validation and daily spend caps.
 *
 * EMBED (put config BEFORE this script, or anywhere before DOMContentLoaded):
 *   <link rel="stylesheet" href="https://YOUR-SITE/aaiya-chat.css">
 *   <script>window.AaiyaChatConfig = { mode:'demo', businessName:'...', ... };</script>
 *   <script src="https://YOUR-SITE/aaiya-chat.js"></script>
 */
(function () {
  'use strict';

  // Capture now: document.currentScript is only valid during initial execution,
  // NOT inside the DOMContentLoaded handler where init() runs.
  var SCRIPT_URL = '';
  try { SCRIPT_URL = (document.currentScript && document.currentScript.src) || ''; } catch (e) {}

  var DEFAULTS = {
    mode: 'demo',                       // 'demo' | 'api'
    businessName: 'Our team',
    accent: '#4f46e5',
    apiUrl: '',                         // required in api mode, e.g. https://api.example.com/api/chat
    greeting: 'Hi! Ask me about our services, pricing, or hours.',
    disclaimer: 'Demo assistant — answers only from our public info.',
    fallback: "I'm not sure about that — let me connect you with the team and they'll get back to you shortly.",
    knowledgeBase: [],                  // [{ keywords: ['price','cost'], answer: '...' }]
    maxMsgLen: 500,
    minSendGapMs: 1500                  // client-side throttle
  };

  function init() {
    var cfg = {};
    for (var k in DEFAULTS) cfg[k] = DEFAULTS[k];
    var user = window.AaiyaChatConfig || {};
    for (var k2 in user) cfg[k2] = user[k2];

    // Auto-load sibling CSS if not already present
    if (!document.querySelector('link[data-aaiya-chat-css]')) {
      var cssHref = SCRIPT_URL ? SCRIPT_URL.replace(/[^/]*$/, 'aaiya-chat.css') : '';
      if (cssHref) {
        var link = document.createElement('link');
        link.rel = 'stylesheet'; link.href = cssHref;
        link.setAttribute('data-aaiya-chat-css', '1');
        document.head.appendChild(link);
      }
    }

    var root = document.createElement('div');
    root.id = 'aaiya-chat-root';
    root.style.setProperty('--aaiya-accent', cfg.accent);
    root.innerHTML =
      '<button id="aaiya-chat-fab" aria-label="Open chat">&#128172;</button>' +
      '<div id="aaiya-chat-panel" role="dialog" aria-label="Chat">' +
        '<div id="aaiya-chat-head"><div><div class="t">' + esc(cfg.businessName) + '</div>' +
        '<div class="s">Typically replies instantly</div></div>' +
        '<button id="aaiya-chat-close" aria-label="Close chat">&times;</button></div>' +
        '<div id="aaiya-chat-body"></div>' +
        '<div id="aaiya-chat-disc">' + esc(cfg.disclaimer) + '</div>' +
        '<form id="aaiya-chat-form"><input id="aaiya-chat-input" maxlength="' + cfg.maxMsgLen +
        '" placeholder="Type your question…" autocomplete="off"/>' +
        '<button id="aaiya-chat-send" type="submit">Send</button></form>' +
      '</div>';
    document.body.appendChild(root);

    var panel = document.getElementById('aaiya-chat-panel');
    var body = document.getElementById('aaiya-chat-body');
    var form = document.getElementById('aaiya-chat-form');
    var input = document.getElementById('aaiya-chat-input');
    var sessionId = 's_' + Math.random().toString(36).slice(2, 12);
    var lastSend = 0, opened = false;

    document.getElementById('aaiya-chat-fab').onclick = function () {
      opened = !opened;
      panel.classList.toggle('open', opened);
      if (opened && !body.children.length) botSay(cfg.greeting);
      if (opened) input.focus();
    };
    document.getElementById('aaiya-chat-close').onclick = function () {
      opened = false; panel.classList.remove('open');
    };

    function esc(s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }
    function scrollDown() { body.scrollTop = body.scrollHeight; }
    function addMsg(text, who) {
      var d = document.createElement('div');
      d.className = 'aaiya-msg ' + who;
      d.textContent = text; // textContent = no HTML injection, ever
      body.appendChild(d); scrollDown();
    }
    function botSay(t) {
      var tp = document.createElement('div');
      tp.className = 'aaiya-typing'; tp.textContent = 'typing…';
      body.appendChild(tp); scrollDown();
      setTimeout(function () { tp.remove(); addMsg(t, 'bot'); }, 450 + Math.random() * 400);
    }

    // --- demo brain: keyword scoring over the knowledge base ---
    function demoAnswer(q) {
      var words = q.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      var best = null, bestScore = 0;
      (cfg.knowledgeBase || []).forEach(function (entry) {
        var score = 0;
        (entry.keywords || []).forEach(function (kw) {
          kw = String(kw).toLowerCase();
          if (words.indexOf(kw) !== -1) score += 2;
          else if (q.toLowerCase().indexOf(kw) !== -1) score += 1;
        });
        if (score > bestScore) { bestScore = score; best = entry; }
      });
      return best ? best.answer : cfg.fallback;
    }

    function apiAnswer(q, done) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', cfg.apiUrl, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.timeout = 25000;
      xhr.onload = function () {
        try {
          var r = JSON.parse(xhr.responseText);
          done(r.reply || cfg.fallback);
        } catch (e) { done(cfg.fallback); }
      };
      xhr.onerror = function () { done('Sorry — the chat service is unreachable right now. Please try again in a bit.'); };
      xhr.ontimeout = xhr.onerror;
      xhr.send(JSON.stringify({ message: q, session_id: sessionId }));
    }

    form.onsubmit = function (e) {
      e.preventDefault();
      var q = input.value.trim().slice(0, cfg.maxMsgLen);
      if (!q) return;
      var now = Date.now();
      if (now - lastSend < cfg.minSendGapMs) return; // client-side throttle
      lastSend = now;
      input.value = '';
      addMsg(q, 'user');
      if (cfg.mode === 'api' && cfg.apiUrl) {
        var tp = document.createElement('div');
        tp.className = 'aaiya-typing'; tp.textContent = 'typing…';
        body.appendChild(tp); scrollDown();
        apiAnswer(q, function (reply) { tp.remove(); addMsg(reply, 'bot'); });
      } else {
        botSay(demoAnswer(q));
      }
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
