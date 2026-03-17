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
    icon.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    document.getElementById('chatInput').focus();
    scrollChatBottom();
  } else {
    panel.style.display = 'none';
    icon.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/></svg>';
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
      appendChatMsg('bot', '⚠ ' + (data.error || 'Something went wrong. Please try again.') + (data.details ? '\n' + data.details : ''));
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
  if (role !== 'user') {
    div.innerHTML = `<div class="chat-bot-avatar">✨</div><div class="chat-bubble">${escChatHtml(text)}</div>`;
  } else {
    div.innerHTML = `<div class="chat-bubble">${escChatHtml(text)}</div>`;
  }
  messages.appendChild(div);
  scrollChatBottom();
  return div;
}

function appendTyping() {
  const messages = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'chat-msg chat-msg-bot chat-typing';
  div.innerHTML = '<div class="chat-bot-avatar">✨</div><div class="chat-bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div>';
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
