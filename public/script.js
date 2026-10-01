/* ════════════════════════════════════════════════════
   NetChat – script.js  (clean v4, light/dark theme)
════════════════════════════════════════════════════ */
'use strict';

// ── Socket ──────────────────────────────────────────
const socket = io({
  transports: ['polling', 'websocket'],
  reconnection: true,
  reconnectionAttempts: 20,
  reconnectionDelay: 800,
  reconnectionDelayMax: 3000,
  timeout: 15000
});

// ── State ────────────────────────────────────────────
let me          = null;
let currentTarget = null;  // { type, id, name, color }
let pendingFile   = null;
let localStream   = null;
let peerConn      = null;
let callTarget    = null;
let remoteAudio   = new Audio();
let callTimerInterval = null;
let callSeconds   = 0;
let isMuted       = false;
let pingInterval  = null;

const rttHistory       = [];
const MAX_RTT_POINTS   = 30;
const privateHistories = {};   // targetUserId → [msg]
let allRooms = [];
let allUsers = [];

// Emoji set
const EMOJIS = [
  '😊','😂','🤣','❤️','😍','🥰','😘','😭','🥺','😅',
  '🙏','👍','🔥','✨','😁','😢','😎','🤔','😴','🤗',
  '😤','😡','🎉','💯','😏','🤝','💪','👏','🫡','🥳',
  '😌','🫶','🤭','😇','🥴','💀','🫠','😬','🤩','😵',
  '🌟','💥','⚡','🎈','🎊','🍕','🍔','🍜','🎮','🚀',
  '🌈','🌙','☀️','❄️','🌊','🐱','🐶','🦊','🐸','🌸',
];

// Room accent colors (purple pastel palette)
const ROOM_COLORS = ['#8b5cf6', '#a78bfa', '#7c3aed', '#9333ea', '#6366f1', '#c084fc', '#a855f7', '#7e22ce'];
let roomColorIdx = 0;
const roomColorMap = { global: '#8b5cf6' };  // roomId → color

// ── DOM refs ─────────────────────────────────────────
const $ = id => document.getElementById(id);
const dom = {
  loginScreen:       $('login-screen'),
  app:               $('app'),
  usernameInput:     $('username-input'),
  loginForm:         $('login-form'),
  themeToggle:       $('theme-toggle'),
  iconSun:           $('icon-sun'),
  iconMoon:          $('icon-moon'),
  searchInput:       $('search-input'),
  tabRooms:          $('tab-rooms'),
  tabUsers:          $('tab-users'),
  tabContentRooms:   $('tab-content-rooms'),
  tabContentUsers:   $('tab-content-users'),
  roomList:          $('room-list'),
  userList:          $('user-list'),
  adminBadge:        $('admin-badge'),
  selfAvatar:        $('self-avatar'),
  selfUsername:      $('self-username'),
  diagBtn:           $('diag-btn'),
  createRoomBtn:     $('create-room-btn'),
  welcomeScreen:     $('welcome-screen'),
  chatHeader:        $('chat-header'),
  mobileBackBtn:     $('mobile-back-btn'),
  sidebar:           $('sidebar'),
  chatHeaderAvatar:  $('chat-header-avatar'),
  chatHeaderName:    $('chat-header-name'),
  chatHeaderSub:     $('chat-header-sub'),
  callBtn:           $('call-btn'),
  deleteRoomBtn:     $('delete-room-btn'),
  messagesContainer: $('messages-container'),
  messagesList:      $('messages-list'),
  typingIndicator:   $('typing-indicator'),
  chatInputArea:     $('chat-input-area'),
  attachmentPreview: $('attachment-preview'),
  previewContent:    $('preview-content'),
  clearAttachment:   $('clear-attachment'),
  emojiDrawer:       $('emoji-drawer'),
  emojiBtn:          $('emoji-btn'),
  fileInput:         $('file-input'),
  messageInput:      $('message-input'),
  sendBtn:           $('send-btn'),
  createRoomModal:   $('create-room-modal'),
  createRoomForm:    $('create-room-form'),
  roomNameInput:     $('room-name-input'),
  cancelCreateRoom:  $('cancel-create-room'),
  roomPrivateCheckbox:$('room-private-checkbox'),
  roomInviteList:    $('room-invite-list'),
  incomingCallModal: $('incoming-call-modal'),
  callerAvatar:      $('caller-avatar'),
  callerName:        $('caller-name'),
  acceptCallBtn:     $('accept-call-btn'),
  rejectCallBtn:     $('reject-call-btn'),
  callHud:           $('call-hud'),
  hudName:           $('hud-name'),
  hudTimer:          $('hud-timer'),
  muteBtn:           $('mute-btn'),
  hangupBtn:         $('hangup-btn'),
  iconMic:           $('icon-mic'),
  iconMicOff:        $('icon-mic-off'),
  diagModal:         $('diag-modal'),
  closeDiagBtn:      $('close-diag-btn'),
  statRtt:           $('stat-rtt'),
  statJitter:        $('stat-jitter'),
  statTx:            $('stat-tx'),
  statRx:            $('stat-rx'),
  statTransport:     $('stat-transport'),
  statStatus:        $('stat-status'),
  latencyChart:      $('latency-chart'),
  pingStartBtn:      $('ping-start-btn'),
  pingStopBtn:       $('ping-stop-btn'),
  diagLog:           $('diag-log'),
};

// ── Helpers ──────────────────────────────────────────
const setHidden  = (el, v) => el.classList.toggle('hidden', v);
const escHtml    = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const initials   = n => (n || '?').slice(0, 2).toUpperCase();
const avatarCss  = (color, size = 36) => `background:${color};width:${size}px;height:${size}px;line-height:${size}px;`;
const fmtTime    = iso => new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
const fmtSize    = b => !b ? '' : b < 1024 ? b + ' B' : b < 1048576 ? (b/1024).toFixed(1) + ' KB' : (b/1048576).toFixed(1) + ' MB';
const scrollBot  = () => { dom.messagesContainer.scrollTop = dom.messagesContainer.scrollHeight; };
const getRoomColor = id => roomColorMap[id] || '#8b5cf6';

function assignRoomColor(id) {
  if (id === 'global') return '#8b5cf6';
  if (!roomColorMap[id]) {
    roomColorMap[id] = ROOM_COLORS[roomColorIdx % ROOM_COLORS.length];
    roomColorIdx++;
  }
  return roomColorMap[id];
}

// Room SVG icon
function roomSvg(color) {
  return `<div class="room-icon">
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  </div>`;
}

// Trash SVG
const svgTrash = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`;

// ════════════════════════════════════════════════════
// ── Theme Toggle ─────────────────────────────────────
// ════════════════════════════════════════════════════
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('netchat-theme', theme);
  const isDark = theme === 'dark';
  setHidden(dom.iconSun,  !isDark);
  setHidden(dom.iconMoon, isDark);
}

// Load saved theme (default: light)
applyTheme(localStorage.getItem('netchat-theme') || 'light');

dom.themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

// ════════════════════════════════════════════════════
// ── Login ────────────────────────────────────────────
// ════════════════════════════════════════════════════
dom.loginForm.addEventListener('submit', e => {
  e.preventDefault();
  const name = dom.usernameInput.value.trim();
  if (name) {
    const loginBtn = $('login-btn');
    if (loginBtn) {
      loginBtn.disabled = true;
      loginBtn.textContent = 'กำลังเชื่อมต่อ... 🐾';
    }
    socket.emit('login', name);
  }
});

socket.on('connect_error', () => {
  const loginBtn = $('login-btn');
  if (loginBtn && !me) {
    loginBtn.disabled = false;
    loginBtn.textContent = 'เข้าร่วม KuiDi 🐾';
  }
});

socket.on('login_success', data => {
  const loginBtn = $('login-btn');
  if (loginBtn) {
    loginBtn.disabled = false;
    loginBtn.textContent = 'เข้าร่วม KuiDi 🐾';
  }
  me = data.user;
  setHidden(dom.loginScreen, true);
  dom.app.classList.remove('hidden');

  dom.selfAvatar.style.cssText = avatarCss(me.color, 36);
  dom.selfAvatar.textContent   = initials(me.username);
  dom.selfUsername.textContent = me.username;
  if (me.isAdmin) setHidden(dom.adminBadge, false);

  buildEmojiDrawer();
  renderRooms(data.rooms);
  renderUsers(data.users);
  loadRoomHistory('global', data.history);
  selectRoom('global', 'Global Lounge', assignRoomColor('global'));
});

// ════════════════════════════════════════════════════
// ── Search ───────────────────────────────────────────
// ════════════════════════════════════════════════════
dom.searchInput.addEventListener('input', () => {
  const q = dom.searchInput.value.trim().toLowerCase();
  document.querySelectorAll('#room-list .room-item, #user-list .user-item').forEach(el => {
    setHidden(el, !!(q && !el.dataset.name?.toLowerCase().includes(q)));
  });
});

// ════════════════════════════════════════════════════
// ── Tabs ─────────────────────────────────────────────
// ════════════════════════════════════════════════════
dom.tabRooms.addEventListener('click', () => switchTab('rooms'));
dom.tabUsers.addEventListener('click', () => switchTab('users'));

function switchTab(tab) {
  const isRooms = tab === 'rooms';
  dom.tabRooms.classList.toggle('active', isRooms);
  dom.tabUsers.classList.toggle('active', !isRooms);
  setHidden(dom.tabContentRooms, !isRooms);
  setHidden(dom.tabContentUsers, isRooms);
}

// ════════════════════════════════════════════════════
// ── Render Rooms ─────────────────────────────────────
// ════════════════════════════════════════════════════
function renderRooms(rooms) {
  allRooms = rooms;
  const q  = dom.searchInput.value.trim().toLowerCase();
  dom.roomList.innerHTML = '';

  rooms.forEach(r => {
    const color   = assignRoomColor(r.id);
    const canDel  = me && (me.isAdmin || r.creatorId === socket.id) && r.id !== 'global';
    const isActive = currentTarget?.type === 'room' && currentTarget.id === r.id;

    const li = document.createElement('li');
    li.className = 'room-item' + (isActive ? ' active' : '');
    li.dataset.id   = r.id;
    li.dataset.name = r.name;
    if (q && !r.name.toLowerCase().includes(q)) li.classList.add('hidden');

    const lockIcon = r.isPrivate ? `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="margin-left:5px;opacity:0.6;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>` : '';
    
    li.innerHTML = `
      ${roomSvg(color)}
      <div style="min-width:0">
        <div class="room-name" style="display:flex;align-items:center;">${escHtml(r.name)}${lockIcon}</div>
        <div class="room-sub">${r.members?.length ?? 0} สมาชิก</div>
      </div>
      ${canDel ? `<button class="delete-room-item-btn" data-room="${r.id}" title="ลบกลุ่ม">${svgTrash}</button>` : ''}
    `;

    li.addEventListener('click', e => {
      if (e.target.closest('.delete-room-item-btn')) return;
      selectRoom(r.id, r.name, color);
    });
    li.querySelector('.delete-room-item-btn')?.addEventListener('click', e => {
      e.stopPropagation(); deleteRoom(r.id);
    });

    dom.roomList.appendChild(li);
  });
}

socket.on('room_list', rooms => renderRooms(rooms));

// ════════════════════════════════════════════════════
// ── Render Users ─────────────────────────────────────
// ════════════════════════════════════════════════════
function renderUsers(users) {
  allUsers = users;
  const q  = dom.searchInput.value.trim().toLowerCase();
  dom.userList.innerHTML = '';

  users.forEach(u => {
    if (u.id === socket.id) return;
    const isActive = currentTarget?.type === 'user' && currentTarget.id === u.id;

    const li = document.createElement('li');
    li.className = 'user-item' + (isActive ? ' active' : '');
    li.dataset.id   = u.id;
    li.dataset.name = u.username;
    if (q && !u.username.toLowerCase().includes(q)) li.classList.add('hidden');

    li.innerHTML = `
      <div class="avatar" style="${avatarCss(u.color, 36)}">${initials(u.username)}</div>
      <div style="min-width:0">
        <div class="room-name">${escHtml(u.username)}${u.isAdmin ? ' <span style="font-size:10px;color:var(--danger);font-weight:700">ADMIN</span>' : ''}</div>
      </div>
      <div class="user-online-dot"></div>
    `;
    li.addEventListener('click', () => selectUser(u.id, u.username, u.color));
    dom.userList.appendChild(li);
  });
}

socket.on('user_list', users => renderUsers(users));

// ════════════════════════════════════════════════════
// ── Select Room / User ───────────────────────────────
// ════════════════════════════════════════════════════
function selectRoom(id, name, color) {
  socket.emit('join_room', id, res => {
    if (res && !res.success) {
      alert(res.error);
      return;
    }
    currentTarget = { type: 'room', id, name, color };
    
    const room   = allRooms.find(r => r.id === id);
    const canDel = me && (me.isAdmin || room?.creatorId === socket.id) && id !== 'global';

    openChat(name, 'ห้องแชทกลุ่ม', color);
    setHidden(dom.callBtn, true);
    setHidden(dom.deleteRoomBtn, !canDel);
    updateSidebarActive();
    dom.sidebar.classList.add('hide-mobile');
  });
}

function selectUser(id, name, color) {
  currentTarget = { type: 'user', id, name, color };
  openChat(name, 'ข้อความส่วนตัว', color);
  setHidden(dom.callBtn, false);
  setHidden(dom.deleteRoomBtn, true);
  renderPrivateHistory(id);
  updateSidebarActive();
  dom.sidebar.classList.add('hide-mobile');
}

function openChat(name, sub, color) {
  setHidden(dom.welcomeScreen, true);
  setHidden(dom.chatHeader, false);
  setHidden(dom.messagesContainer, false);
  setHidden(dom.chatInputArea, false);

  if (currentTarget?.type === 'room') {
    dom.chatHeaderAvatar.style.cssText = 'background: linear-gradient(135deg, #a78bfa, #7c3aed); width: 36px; height: 36px; line-height: 36px; border-radius: 50%; box-shadow: 0 2px 8px rgba(139,92,246,0.3);';
  } else {
    dom.chatHeaderAvatar.style.cssText = avatarCss(color || '#8b5cf6', 36);
  }
  dom.chatHeaderAvatar.textContent   = initials(name);
  dom.chatHeaderName.textContent     = name;
  dom.chatHeaderSub.textContent      = sub;
}

function updateSidebarActive() {
  document.querySelectorAll('.room-item, .user-item').forEach(el => el.classList.remove('active'));
  if (!currentTarget) return;
  const sel = currentTarget.type === 'room'
    ? `.room-item[data-id="${currentTarget.id}"]`
    : `.user-item[data-id="${currentTarget.id}"]`;
  document.querySelector(sel)?.classList.add('active');
}

dom.mobileBackBtn?.addEventListener('click', () => {
  dom.sidebar.classList.remove('hide-mobile');
  currentTarget = null;
  updateSidebarActive();
});

// ════════════════════════════════════════════════════
// ── Room History ─────────────────────────────────────
// ════════════════════════════════════════════════════
function loadRoomHistory(roomId, msgs) {
  if (!msgs?.length) return;
  if (currentTarget?.type === 'room' && currentTarget.id === roomId) {
    dom.messagesList.innerHTML = '';
    msgs.forEach(appendRoomMessage);
    scrollBot();
  }
}

socket.on('room_history', data => {
  if (currentTarget?.type === 'room' && currentTarget.id === data.roomId) {
    dom.messagesList.innerHTML = '';
    data.messages.forEach(appendRoomMessage);
    scrollBot();
  }
});

// ════════════════════════════════════════════════════
// ── Message Rendering ─────────────────────────────────
// ════════════════════════════════════════════════════
function appendRoomMessage(msg) {
  if (msg.type === 'system') { appendSystemMsg(msg.text || msg.content); return; }
  appendMessage(msg, msg.senderId === socket.id);
}

function appendSystemMsg(text) {
  const li = document.createElement('li');
  li.className = 'msg-row system';
  li.innerHTML = `<div class="msg-bubble">${escHtml(text)}</div>`;
  dom.messagesList.appendChild(li);
  scrollBot();
}

function appendMessage(msg, isSelf) {
  const li = document.createElement('li');
  li.className = `msg-row ${isSelf ? 'self' : 'other'}`;
  li.dataset.msgId = msg.id;

  const canDel   = me && (me.isAdmin || isSelf);
  const delBtn   = canDel ? `<button class="msg-delete-btn" title="ลบ">✕</button>` : '';

  const avatarEl = isSelf ? '' :
    `<div class="avatar" style="${avatarCss(msg.senderColor || '#8b5cf6', 28)}">${initials(msg.senderName)}</div>`;

  const nameEl = isSelf ? '' :
    `<div class="msg-sender-name">${escHtml(msg.senderName)}</div>`;

  let content = '';
  if (msg.type === 'image') {
    content = `<img src="${msg.content}" class="msg-image" alt="${escHtml(msg.fileName || 'image')}" loading="lazy" />`;
  } else if (msg.type === 'file') {
    content = `<a href="${msg.content}" download="${escHtml(msg.fileName || 'file')}" class="msg-file">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
      ${escHtml(msg.fileName || 'file')} <span style="opacity:.55">${fmtSize(msg.fileSize)}</span>
    </a>`;
  } else {
    content = escHtml(msg.content);
  }

  li.innerHTML = `
    ${avatarEl}
    <div style="min-width:0">
      ${nameEl}
      <div class="msg-bubble">${content}${delBtn}</div>
      <div class="msg-time" style="text-align:${isSelf ? 'right' : 'left'}">${fmtTime(msg.timestamp)}</div>
    </div>
  `;

  li.querySelector('.msg-delete-btn')?.addEventListener('click', () => {
    socket.emit('delete_message', {
      messageId:  msg.id,
      targetType: currentTarget.type,
      targetId:   currentTarget.id,
      roomId:     currentTarget.id,
    });
  });

  dom.messagesList.appendChild(li);
  scrollBot();
}

socket.on('receive_room_message', msg => {
  if (currentTarget?.type === 'room' && currentTarget.id === msg.roomId) {
    appendRoomMessage(msg);
  }
});

socket.on('receive_private_message', msg => {
  const otherId = msg.senderId === socket.id ? msg.targetId : msg.senderId;
  if (!privateHistories[otherId]) privateHistories[otherId] = [];
  privateHistories[otherId].push(msg);
  if (currentTarget?.type === 'user' && currentTarget.id === otherId) {
    appendMessage(msg, msg.senderId === socket.id);
  }
});

function renderPrivateHistory(userId) {
  dom.messagesList.innerHTML = '';
  (privateHistories[userId] || []).forEach(msg => appendMessage(msg, msg.senderId === socket.id));
  scrollBot();
}

socket.on('message_deleted', ({ messageId }) => {
  const el = dom.messagesList.querySelector(`[data-msg-id="${messageId}"]`);
  if (el) {
    el.querySelector('.msg-bubble').innerHTML = '<em style="opacity:.45;font-size:13px">ลบข้อความแล้ว</em>';
    el.querySelector('.msg-delete-btn')?.remove();
  }
});

socket.on('system_message', msg => {
  if (currentTarget?.type === 'room' && currentTarget.id === msg.room) {
    appendSystemMsg(msg.text);
  }
});

socket.on('system_error', msg => alert('⚠️ ' + msg));

// ════════════════════════════════════════════════════
// ── Send Message ─────────────────────────────────────
// ════════════════════════════════════════════════════
function sendMessage() {
  if (!currentTarget) return;
  if (pendingFile) { sendFile(); return; }
  const text = dom.messageInput.value.trim();
  if (!text) return;

  const payload = { type: 'text', content: text };
  if (currentTarget.type === 'room') {
    socket.emit('send_room_message', { ...payload, roomId: currentTarget.id });
  } else {
    socket.emit('send_private_message', { ...payload, targetId: currentTarget.id });
  }
  dom.messageInput.value = '';
  emitTyping(false);
}

dom.sendBtn.addEventListener('click', sendMessage);
dom.messageInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

// ── Typing ───────────────────────────────────────────
let typingTimeout = null;
dom.messageInput.addEventListener('input', () => {
  emitTyping(true);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => emitTyping(false), 2000);
});

function emitTyping(isTyping) {
  if (!currentTarget) return;
  socket.emit('typing_status', { targetType: currentTarget.type, targetId: currentTarget.id, isTyping });
}

const typingUsers = {};
socket.on('user_typing', ({ targetType, targetId, username, isTyping }) => {
  const key = `${targetType}:${targetId}`;
  if (!typingUsers[key]) typingUsers[key] = new Set();
  isTyping ? typingUsers[key].add(username) : typingUsers[key].delete(username);

  if (!currentTarget) return;
  const myKey = `${currentTarget.type}:${currentTarget.id}`;
  const users = typingUsers[myKey] || new Set();
  if (users.size === 0) {
    dom.typingIndicator.textContent = '';
    dom.typingIndicator.classList.add('hidden');
  } else {
    dom.typingIndicator.textContent = [...users].join(', ') + ' กำลังพิมพ์…';
    dom.typingIndicator.classList.remove('hidden');
  }
});

// ════════════════════════════════════════════════════
// ── File Attachment ───────────────────────────────────
// ════════════════════════════════════════════════════
dom.fileInput.addEventListener('change', () => {
  const file = dom.fileInput.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { alert('ไฟล์ใหญ่เกิน 10 MB'); return; }
  
  const isImage = file.type.startsWith('image/');
  const reader = new FileReader();
  
  reader.onload = e => {
    if (isImage) {
      // Compress Image using Canvas
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const MAX_WIDTH = 800; // ย่อรูปไม่ให้กว้างเกิน 800px
        
        if (width > MAX_WIDTH) {
          height = Math.round((height * MAX_WIDTH) / width);
          width = MAX_WIDTH;
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        // แปลงกลับเป็น Base64 คุณภาพ 70%
        const compressedData = canvas.toDataURL('image/jpeg', 0.7);
        
        pendingFile = { name: file.name, size: Math.round(compressedData.length * 0.75), data: compressedData, type: 'image/jpeg' };
        dom.previewContent.innerHTML = `<img src="${compressedData}" style="max-height:60px;border-radius:8px" />`;
        setHidden(dom.attachmentPreview, false);
      };
      img.src = e.target.result;
    } else {
      // ไม่ใช่รูปภาพ ให้ทำงานตามปกติ
      pendingFile = { name: file.name, size: file.size, data: e.target.result, type: file.type };
      dom.previewContent.innerHTML = `${escHtml(file.name)} (${fmtSize(file.size)})`;
      setHidden(dom.attachmentPreview, false);
    }
  };
  
  reader.readAsDataURL(file);
  dom.fileInput.value = '';
});

dom.clearAttachment.addEventListener('click', clearAttachment);
function clearAttachment() {
  pendingFile = null;
  dom.previewContent.innerHTML = '';
  setHidden(dom.attachmentPreview, true);
}

function sendFile() {
  if (!pendingFile || !currentTarget) return;
  const isImage = pendingFile.type.startsWith('image/');
  const payload = { type: isImage ? 'image' : 'file', content: pendingFile.data, fileName: pendingFile.name, fileSize: pendingFile.size };
  if (currentTarget.type === 'room') {
    socket.emit('send_room_message', { ...payload, roomId: currentTarget.id });
  } else {
    socket.emit('send_private_message', { ...payload, targetId: currentTarget.id });
  }
  clearAttachment();
}

// ════════════════════════════════════════════════════
// ── Emoji ────────────────────────────────────────────
// ════════════════════════════════════════════════════
function buildEmojiDrawer() {
  dom.emojiDrawer.innerHTML = '';
  EMOJIS.forEach(e => {
    const btn = document.createElement('button');
    btn.className = 'emoji-btn';
    btn.textContent = e;
    btn.addEventListener('click', () => { dom.messageInput.value += e; dom.messageInput.focus(); });
    dom.emojiDrawer.appendChild(btn);
  });
}

dom.emojiBtn.addEventListener('click', () => setHidden(dom.emojiDrawer, !dom.emojiDrawer.classList.contains('hidden')));
document.addEventListener('click', e => {
  if (!dom.emojiDrawer.classList.contains('hidden') &&
      !dom.emojiDrawer.contains(e.target) && !dom.emojiBtn.contains(e.target)) {
    setHidden(dom.emojiDrawer, true);
  }
});

// ════════════════════════════════════════════════════
// ── Create / Delete Room ──────────────────────────────
// ════════════════════════════════════════════════════
dom.createRoomBtn.addEventListener('click', () => {
  setHidden(dom.createRoomModal, false);
  dom.roomPrivateCheckbox.checked = false;
  setHidden(dom.roomInviteList, true);
  
  dom.roomInviteList.innerHTML = '';
  allUsers.forEach(u => {
    if (u.id === socket.id) return;
    dom.roomInviteList.innerHTML += `
      <label style="display:flex;align-items:center;gap:8px;padding:6px;cursor:pointer;font-size:13px;border-radius:6px;transition:background 0.2s;" onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background='transparent'">
        <input type="checkbox" class="invite-checkbox" value="${u.id}" style="width:14px;height:14px;" />
        <div class="avatar" style="${avatarCss(u.color, 20)};font-size:10px;">${initials(u.username)}</div>
        ${escHtml(u.username)}
      </label>
    `;
  });
});

dom.roomPrivateCheckbox.addEventListener('change', e => {
  setHidden(dom.roomInviteList, !e.target.checked);
});

dom.cancelCreateRoom.addEventListener('click', () => setHidden(dom.createRoomModal, true));
dom.createRoomModal.addEventListener('click',  e => { if (e.target === dom.createRoomModal) setHidden(dom.createRoomModal, true); });

dom.createRoomForm.addEventListener('submit', e => {
  e.preventDefault();
  const name = dom.roomNameInput.value.trim();
  if (!name) return;
  
  const isPrivate = dom.roomPrivateCheckbox.checked;
  const allowedUserIds = [];
  if (isPrivate) {
    document.querySelectorAll('.invite-checkbox:checked').forEach(cb => allowedUserIds.push(cb.value));
  }

  socket.emit('create_room', { name, isPrivate, allowedUserIds }, res => {
    if (res?.success) {
      setHidden(dom.createRoomModal, true);
      dom.roomNameInput.value = '';
      selectRoom(res.room.id, res.room.name, assignRoomColor(res.room.id));
    } else {
      alert(res?.error || 'ไม่สามารถสร้างห้องได้');
    }
  });
});

dom.deleteRoomBtn.addEventListener('click', () => { if (currentTarget?.type === 'room') deleteRoom(currentTarget.id); });

function deleteRoom(roomId) {
  if (!confirm('ต้องการลบห้องนี้ใช่หรือไม่?')) return;
  socket.emit('delete_room', roomId);
}

socket.on('room_deleted', ({ roomId }) => {
  if (currentTarget?.type === 'room' && currentTarget.id === roomId) {
    currentTarget = null;
    setHidden(dom.welcomeScreen, false);
    setHidden(dom.chatHeader, true);
    setHidden(dom.messagesContainer, true);
    setHidden(dom.chatInputArea, true);
  }
});

// ════════════════════════════════════════════════════
// ── WebRTC Voice Call ─────────────────────────────────
// ════════════════════════════════════════════════════
dom.callBtn.addEventListener('click', startCall);

async function startCall() {
  if (!currentTarget || currentTarget.type !== 'user') return;
  callTarget = currentTarget;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    socket.emit('call_user', { targetId: callTarget.id });
    showCallHud(callTarget.name);
  } catch { alert('ไม่สามารถเข้าถึงไมโครโฟนได้'); }
}

socket.on('incoming_call', ({ callerId, callerName, callerColor }) => {
  dom.callerAvatar.style.cssText = avatarCss(callerColor, 58);
  dom.callerAvatar.textContent   = initials(callerName);
  dom.callerName.textContent     = callerName;
  setHidden(dom.incomingCallModal, false);

  dom.acceptCallBtn.onclick = async () => {
    setHidden(dom.incomingCallModal, true);
    socket.emit('answer_call', { callerId });
    callTarget = { id: callerId, name: callerName, color: callerColor };
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await createPeerConnection(callerId, false);
      showCallHud(callerName);
    } catch { alert('ไม่สามารถเข้าถึงไมโครโฟนได้'); }
  };

  dom.rejectCallBtn.onclick = () => {
    setHidden(dom.incomingCallModal, true);
    socket.emit('reject_call', { callerId });
  };
});

socket.on('call_accepted', async ({ responderId }) => {
  if (callTarget?.id === responderId) await createPeerConnection(responderId, true);
});

socket.on('call_rejected', () => { alert('การโทรถูกปฏิเสธ'); resetCall(); });

socket.on('webrtc_signal', async ({ senderId, signal }) => {
  if (!peerConn) return;
  if (signal.type === 'offer') {
    await peerConn.setRemoteDescription(new RTCSessionDescription(signal));
    const answer = await peerConn.createAnswer();
    await peerConn.setLocalDescription(answer);
    socket.emit('webrtc_signal', { targetId: senderId, signal: answer });
  } else if (signal.type === 'answer') {
    await peerConn.setRemoteDescription(new RTCSessionDescription(signal));
  } else if (signal.candidate) {
    await peerConn.addIceCandidate(new RTCIceCandidate(signal));
  }
});

socket.on('call_ended', () => { alert('วางสายแล้ว'); resetCall(); });

async function createPeerConnection(targetId, isCaller) {
  peerConn = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  localStream?.getTracks().forEach(t => peerConn.addTrack(t, localStream));
  
  peerConn.ontrack = e => { 
    remoteAudio.srcObject = e.streams[0]; 
    remoteAudio.play().catch(err => console.error("Audio play failed:", err)); 
  };
  
  peerConn.onicecandidate = e => { if (e.candidate) socket.emit('webrtc_signal', { targetId, signal: e.candidate }); };
  if (isCaller) {
    const offer = await peerConn.createOffer();
    await peerConn.setLocalDescription(offer);
    socket.emit('webrtc_signal', { targetId, signal: offer });
  }
}

function showCallHud(name) {
  dom.hudName.textContent = name;
  setHidden(dom.callHud, false);
  callSeconds = 0;
  callTimerInterval = setInterval(() => {
    callSeconds++;
    const m = String(Math.floor(callSeconds / 60)).padStart(2, '0');
    const s = String(callSeconds % 60).padStart(2, '0');
    dom.hudTimer.textContent = `${m}:${s}`;
  }, 1000);
}

function resetCall() {
  clearInterval(callTimerInterval);
  peerConn?.close();
  localStream?.getTracks().forEach(t => t.stop());
  remoteAudio.pause();
  remoteAudio.srcObject = null;
  
  peerConn = localStream = callTarget = null;
  callSeconds = 0; isMuted = false;
  dom.hudTimer.textContent = '00:00';
  setHidden(dom.callHud, true);
  setHidden(dom.incomingCallModal, true);
  setHidden(dom.iconMicOff, true);
  setHidden(dom.iconMic, false);
  dom.muteBtn.classList.remove('muted');
}

dom.hangupBtn.addEventListener('click', () => {
  if (callTarget) socket.emit('end_call', { targetId: callTarget.id });
  resetCall();
});

dom.muteBtn.addEventListener('click', () => {
  isMuted = !isMuted;
  localStream?.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
  setHidden(dom.iconMic, isMuted);
  setHidden(dom.iconMicOff, !isMuted);
  dom.muteBtn.classList.toggle('muted', isMuted);
});

// ════════════════════════════════════════════════════
// ── Network Diagnostics ───────────────────────────────
// ════════════════════════════════════════════════════
let txCount = 0, rxCount = 0;
const chartCtx = dom.latencyChart.getContext('2d');

dom.diagBtn.addEventListener('click',      () => setHidden(dom.diagModal, false));
dom.closeDiagBtn.addEventListener('click', () => { setHidden(dom.diagModal, true); stopPing(); });
dom.diagModal.addEventListener('click',    e => { if (e.target === dom.diagModal) { setHidden(dom.diagModal, true); stopPing(); } });
dom.pingStartBtn.addEventListener('click', startPing);
dom.pingStopBtn.addEventListener('click',  stopPing);

function startPing() {
  setHidden(dom.pingStartBtn, true);
  setHidden(dom.pingStopBtn, false);
  rttHistory.length = 0;
  txCount = rxCount = 0;
  dom.diagLog.innerHTML = '';
  dom.statStatus.textContent = 'Active';
  pingInterval = setInterval(doPing, 1000);
  doPing();
}

function stopPing() {
  clearInterval(pingInterval); pingInterval = null;
  setHidden(dom.pingStartBtn, false);
  setHidden(dom.pingStopBtn, true);
  dom.statStatus.textContent = 'Idle';
}

function doPing() {
  txCount++;
  dom.statTx.textContent = txCount;
  const t0 = Date.now();
  socket.emit('network_ping', t0, res => {
    if (!res) return;
    const rtt = Date.now() - t0;
    rxCount++;
    rttHistory.push(rtt);
    if (rttHistory.length > MAX_RTT_POINTS) rttHistory.shift();

    dom.statRtt.textContent       = rtt;
    dom.statRx.textContent        = rxCount;
    dom.statTransport.textContent = res.transport || '—';

    if (rttHistory.length > 1) {
      const avg    = rttHistory.reduce((a,b) => a+b, 0) / rttHistory.length;
      const jitter = Math.round(rttHistory.reduce((a,b) => a + Math.abs(b - avg), 0) / rttHistory.length);
      dom.statJitter.textContent = jitter;
    }
    drawChart();
    appendDiagLog(rtt, res.transport);
  });
}

function drawChart() {
  const w = dom.latencyChart.width;
  const h = dom.latencyChart.height;
  const max = Math.max(...rttHistory, 50);
  const pad = 12;

  chartCtx.clearRect(0, 0, w, h);

  // Grid
  chartCtx.strokeStyle = 'rgba(148,163,184,0.18)';
  chartCtx.lineWidth = 1;
  [0.25, 0.5, 0.75].forEach(f => {
    const y = pad + (h - 2*pad) * f;
    chartCtx.beginPath(); chartCtx.moveTo(pad, y); chartCtx.lineTo(w - pad, y); chartCtx.stroke();
  });

  if (rttHistory.length < 2) return;

  const xStep = (w - 2*pad) / (MAX_RTT_POINTS - 1);
  const startX = pad + (MAX_RTT_POINTS - rttHistory.length) * xStep;
  const toY = v => pad + (h - 2*pad) * (1 - v / max);

  // Fill
  const grad = chartCtx.createLinearGradient(0, pad, 0, h - pad);
  grad.addColorStop(0, 'rgba(16,185,129,0.3)');
  grad.addColorStop(1, 'rgba(16,185,129,0.0)');
  chartCtx.beginPath();
  chartCtx.moveTo(startX, h - pad);
  rttHistory.forEach((v, i) => chartCtx.lineTo(startX + i * xStep, toY(v)));
  chartCtx.lineTo(startX + (rttHistory.length - 1) * xStep, h - pad);
  chartCtx.closePath();
  chartCtx.fillStyle = grad;
  chartCtx.fill();

  // Line
  chartCtx.beginPath();
  rttHistory.forEach((v, i) => {
    i === 0 ? chartCtx.moveTo(startX + i * xStep, toY(v))
            : chartCtx.lineTo(startX + i * xStep, toY(v));
  });
  chartCtx.strokeStyle = '#10b981';
  chartCtx.lineWidth = 2;
  chartCtx.stroke();
}

function appendDiagLog(rtt, transport) {
  const ts    = new Date().toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  const color = rtt < 50 ? '#10b981' : rtt < 150 ? '#f59e0b' : '#ef4444';
  dom.diagLog.innerHTML += `<span style="color:${color}">[${ts}] RTT: ${rtt}ms | ${transport || 'ws'}</span>\n`;
  dom.diagLog.scrollTop = dom.diagLog.scrollHeight;
}
