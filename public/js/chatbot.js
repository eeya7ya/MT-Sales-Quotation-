/* ═══════════════════════════════════════════════════════════════
   MT Sales — AI Chatbot (Groq + Tavily)
═══════════════════════════════════════════════════════════════ */
'use strict';

let chatOpen    = false;
let chatHistory = [];  // [{role, content}, ...]

function toggleChat() {
  chatOpen = !chatOpen;
  const panel = document.getElementById('chatPanel');
  const icon  = document.getElementById('chatBtnIcon');
  if (chatOpen) {
    panel.style.display = 'flex';
    icon.textContent = '✕';
    document.getElementById('chatInput').focus();
    scrollChatBottom();
  } else {
    panel.style.display = 'none';
    icon.textContent = '💬';
  }
}

async function sendChat() {
  const input = document.getElementById('chatInput');
  const msg   = input.value.trim();
  if (!msg) return;

  input.value = '';
  appendChatMsg('user', msg);
  chatHistory.push({ role: 'user', content: msg });

  const typingEl = appendTyping();
  setSendDisabled(true);

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, history: chatHistory.slice(-10) })
    });

    const data = await res.json();
    typingEl.remove();

    if (!res.ok || data.error) {
      appendChatMsg('bot', '⚠ ' + (data.error || 'Something went wrong. Please try again.'));
    } else {
      appendChatMsg('bot', data.reply);
      chatHistory.push({ role: 'assistant', content: data.reply });
    }
  } catch (e) {
    typingEl.remove();
    appendChatMsg('bot', '⚠ Connection error. Please check your network.');
  } finally {
    setSendDisabled(false);
    document.getElementById('chatInput').focus();
  }
}

function appendChatMsg(role, text) {
  const messages = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = `chat-msg chat-msg-${role === 'user' ? 'user' : 'bot'}`;
  div.innerHTML = `<div class="chat-bubble">${escChatHtml(text)}</div>`;
  messages.appendChild(div);
  scrollChatBottom();
  return div;
}

function appendTyping() {
  const messages = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'chat-msg chat-msg-bot chat-typing';
  div.innerHTML = '<div class="chat-bubble">Thinking…</div>';
  messages.appendChild(div);
  scrollChatBottom();
  return div;
}

function scrollChatBottom() {
  const el = document.getElementById('chatMessages');
  if (el) el.scrollTop = el.scrollHeight;
}

function setSendDisabled(disabled) {
  const btn   = document.getElementById('chatSendBtn');
  const input = document.getElementById('chatInput');
  if (btn)   btn.disabled   = disabled;
  if (input) input.disabled = disabled;
}

function escChatHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}
