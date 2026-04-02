/* ═══════════════════════════════════════════════════
   SkyChat — client JS  (all bugs fixed)
   ═══════════════════════════════════════════════════ */
const socket = io({ transports: ['websocket'] });

// ── DOM ──────────────────────────────────────────────
const sidebar              = document.getElementById('sidebar');
const chatWindow           = document.getElementById('chatWindow');
const loginForm            = document.getElementById('loginForm');
const app                  = document.getElementById('app');
const messagesBox          = document.getElementById('messagesBox');
const inputEl              = document.getElementById('input');
const emojiPickerContainer = document.getElementById('emojiPickerContainer');
const emojiPicker          = emojiPickerContainer.querySelector('emoji-picker');
const toast                = document.getElementById('toast');
const typingIndicator      = document.getElementById('typingIndicator');
const typingNameEl         = document.getElementById('typingName');
const replyPreview         = document.getElementById('replyPreview');
const recordingBar         = document.getElementById('recordingBar');
const voicePreview         = document.getElementById('voicePreview');
const filePreview          = document.getElementById('filePreview');
const attachMenu           = document.getElementById('attachMenu');
const fileInput            = document.getElementById('fileInput');
const forwardModal         = document.getElementById('forwardModal');
const forwardUserList      = document.getElementById('forwardUserList');
const selectionBar         = document.getElementById('selectionBar');
const selCountEl           = document.getElementById('selCount');

// ── State ────────────────────────────────────────────
let username        = null;
let privateWith     = null;   // кто открыт сейчас
let currentTab      = 'public';
let lastOnlineList  = [];
let toastTimeout    = null;
let typingTimeout   = null;
let isTyping        = false;
let typingHideTimer = null;

// Voice
let mediaRecorder    = null;
let audioChunks      = [];
let voiceBlob        = null;
let recTimerInterval = null;
let recSeconds       = 0;

// Reply / forward
let replyData   = null;   // { id, user, text }
let forwardMsgs = [];     // array of msg objects to forward

// File
let pendingFile = null;

// Selection — FIX #8/#9: двойной клик / долгий тап входит в режим,
//             затем одиночный клик/тап переключает остальные
let selectionMode  = false;
let selectedMsgIds = new Set();

// Reaction popup
let activePopup = null;

const REACTION_EMOJIS = ['❤️','😂','😮','😢','👍','🔥'];

// ════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════
const scrollToBottom = () => { messagesBox.scrollTop = messagesBox.scrollHeight; };
const isDesktop      = () => window.innerWidth >= 768;

function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2,'0')}`;
}
function fmtSize(bytes) {
    if (bytes < 1024)    return bytes + ' B';
    if (bytes < 1048576) return (bytes/1024).toFixed(1) + ' KB';
    return (bytes/1048576).toFixed(1) + ' MB';
}
function openChat() {
    if (!isDesktop()) {
        sidebar.classList.add('hidden');
        chatWindow.classList.remove('hidden');
        chatWindow.classList.add('flex');
    }
    setTimeout(scrollToBottom, 50);
}

// ════════════════════════════════════════════════════
// USERS LIST
// ════════════════════════════════════════════════════
function renderUsers(list) {
    const ul = document.getElementById('users');
    ul.innerHTML = '';
    const others = list.filter(u => u !== username);
    document.getElementById('onlineCount').textContent = others.length;
    others.forEach(u => {
        const li = document.createElement('li');
        li.className = 'flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 cursor-pointer transition-all border border-transparent';
        li.innerHTML = `<div class="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center font-bold text-blue-500">${u[0].toUpperCase()}</div>
                        <div class="text-xs font-semibold">${escHtml(u)}</div>`;
        li.onclick = () => {
            // Close current chat first so server clears read-state
            if (privateWith && privateWith !== u) {
                socket.emit('close private chat');
            }
            privateWith = u;
            showTab('private');
            socket.emit('open private chat', { withUser: u });
            socket.emit('get private history', { withUser: u });
            openChat();
        };
        ul.appendChild(li);
    });
}
socket.on('update users', list => { lastOnlineList = list; renderUsers(list); });

// ════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════
document.querySelectorAll('.authTab').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.authTab').forEach(b => {
            b.classList.remove('bg-blue-600','text-white'); b.classList.add('text-slate-500');
        });
        btn.classList.add('bg-blue-600','text-white'); btn.classList.remove('text-slate-500');
        ['loginPanel','registerPanel'].forEach(id =>
            document.getElementById(id).classList.toggle('hidden', id !== btn.dataset.form)
        );
        document.getElementById('loginMsg').textContent = '';
        document.getElementById('registerMsg').textContent = '';
    };
});

document.getElementById('registerBtn').onclick = () => {
    const u  = document.getElementById('regUsername').value.trim();
    const p  = document.getElementById('regPassword').value;
    const p2 = document.getElementById('regPassword2').value;
    const msgEl = document.getElementById('registerMsg');
    // FIX #2: валидация перед emit — пустые поля не сломают сокет
    const err = t => { msgEl.textContent = t; msgEl.className = 'text-center text-[11px] uppercase tracking-widest min-h-[18px] font-medium text-rose-500'; };
    if (!u || !p) return err('Заполните все поля');
    if (p !== p2) return err('Пароли не совпадают');
    if (p.length < 4) return err('Пароль минимум 4 символа');
    socket.emit('register', { username: u, password: p });
};

socket.on('register result', ({ success, msg }) => {
    const el = document.getElementById('registerMsg');
    if (!success) {
        el.textContent = msg;
        el.className = 'text-center text-[11px] uppercase tracking-widest min-h-[18px] font-medium text-rose-500';
        return;
    }
    el.textContent = 'Аккаунт создан!';
    el.className = 'text-center text-[11px] uppercase tracking-widest min-h-[18px] font-medium text-emerald-400';
    setTimeout(() => socket.emit('login', {
        username: document.getElementById('regUsername').value.trim(),
        password: document.getElementById('regPassword').value
    }), 600);
});

document.getElementById('loginBtn').onclick = () =>
    socket.emit('login', {
        username: document.getElementById('loginUsername').value.trim(),
        password: document.getElementById('loginPassword').value
    });

socket.on('login result', ({ success, username: user, msg }) => {
    if (!success) { document.getElementById('loginMsg').textContent = msg; return; }
    username = user;
    loginForm.classList.add('hidden');
    app.classList.remove('hidden'); app.classList.add('flex');
    sidebar.classList.remove('hidden');
    if (isDesktop()) { chatWindow.classList.remove('hidden'); chatWindow.classList.add('flex'); }
    else             { chatWindow.classList.add('hidden');    chatWindow.classList.remove('flex'); }
    lucide.createIcons();
    renderUsers(lastOnlineList);
    setTimeout(scrollToBottom, 100);
});

// ════════════════════════════════════════════════════
// NOTIFICATIONS
// ════════════════════════════════════════════════════
function playNotifSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const tone = (freq, start, dur, vol) => {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.connect(g); g.connect(ctx.destination); o.type = 'sine';
            o.frequency.setValueAtTime(freq, start);
            g.gain.setValueAtTime(0, start);
            g.gain.linearRampToValueAtTime(vol, start + 0.01);
            g.gain.exponentialRampToValueAtTime(0.001, start + dur);
            o.start(start); o.stop(start + dur);
        };
        tone(880, ctx.currentTime, 0.15, 0.25);
        tone(1100, ctx.currentTime + 0.16, 0.22, 0.18);
    } catch(e) {}
}

function showToast(from, text) {
    document.getElementById('toastAvatar').textContent = from[0].toUpperCase();
    document.getElementById('toastName').textContent   = from;
    document.getElementById('toastText').textContent   = text;
    toast.classList.add('show');
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove('show'), 4000);
}
toast.onclick = () => {
    const name = document.getElementById('toastName').textContent;
    if (name) {
        if (privateWith && privateWith !== name) socket.emit('close private chat');
        privateWith = name;
        showTab('private');
        socket.emit('open private chat', { withUser: name });
        socket.emit('get private history', { withUser: name });
        openChat();
    }
    toast.classList.remove('show');
};

// ════════════════════════════════════════════════════
// CUSTOM VOICE PLAYER
// ════════════════════════════════════════════════════
function playIconSVG()  { return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`; }
function pauseIconSVG() { return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`; }

function buildVoicePlayerEl(src) {
    const wrapper = document.createElement('div');
    wrapper.className = 'voice-player';

    const topRow = document.createElement('div');
    topRow.className = 'voice-player-top';

    const playBtn = document.createElement('button');
    playBtn.className = 'voice-play-btn';
    playBtn.type = 'button';
    playBtn.innerHTML = playIconSVG();

    const progWrap = document.createElement('div');
    progWrap.className = 'voice-progress-wrap';
    const progFill = document.createElement('div');
    progFill.className = 'voice-progress-fill';
    progWrap.appendChild(progFill);

    topRow.appendChild(playBtn);
    topRow.appendChild(progWrap);

    const timesRow = document.createElement('div');
    timesRow.className = 'voice-times';
    const curEl = document.createElement('span');
    const durEl = document.createElement('span');
    curEl.textContent = '0:00'; durEl.textContent = '0:00';
    timesRow.appendChild(curEl); timesRow.appendChild(durEl);

    wrapper.appendChild(topRow);
    wrapper.appendChild(timesRow);

    const audio = new Audio(src);
    audio.addEventListener('loadedmetadata', () => { durEl.textContent = fmtTime(audio.duration); });
    audio.addEventListener('timeupdate', () => {
        if (!isFinite(audio.duration) || audio.duration === 0) return;
        progFill.style.width = (audio.currentTime / audio.duration * 100) + '%';
        curEl.textContent = fmtTime(audio.currentTime);
    });
    audio.addEventListener('ended', () => {
        playBtn.innerHTML = playIconSVG();
        progFill.style.width = '0%';
        curEl.textContent = '0:00';
    });

    playBtn.addEventListener('click', e => {
        e.stopPropagation();  // не триггерим selection/reaction
        if (audio.paused) { audio.play(); playBtn.innerHTML = pauseIconSVG(); }
        else              { audio.pause(); playBtn.innerHTML = playIconSVG(); }
    });

    // FIX #2: touch на прогресс-баре не должен ломать ничего
    progWrap.addEventListener('click', e => {
        e.stopPropagation();
        const rect = progWrap.getBoundingClientRect();
        const pct  = (e.clientX - rect.left) / rect.width;
        if (isFinite(audio.duration)) audio.currentTime = pct * audio.duration;
    });
    progWrap.addEventListener('touchend', e => {
        e.stopPropagation();
        const rect  = progWrap.getBoundingClientRect();
        const touch = e.changedTouches[0];
        const pct   = (touch.clientX - rect.left) / rect.width;
        if (isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(1, pct)) * audio.duration;
    }, { passive: true });

    return wrapper;
}

function initPreviewPlayer(blob) {
    const panel = document.getElementById('voicePreviewPlayer');
    panel.innerHTML = '';
    panel.appendChild(buildVoicePlayerEl(URL.createObjectURL(blob)));
}

// ════════════════════════════════════════════════════
// RENDER MESSAGE
// ════════════════════════════════════════════════════
function renderMessage(container, msg, meName) {
    const isMe     = (msg.user === meName || msg.from === meName);
    const isPrivate = !!msg.id;

    const li = document.createElement('li');
    li.className = `flex flex-col ${isMe ? 'items-end' : 'items-start'} msg-anim w-full`;
    if (msg.id) { li.dataset.msgId = msg.id; li.dataset.msgData = JSON.stringify(msg); }

    if (msg.user === 'Система') {
        li.innerHTML = `<span class="text-[9px] text-slate-600 font-bold uppercase tracking-widest w-full text-center my-2">${escHtml(msg.text)}</span>`;
        container.appendChild(li); scrollToBottom(); return;
    }

    // forwarded label
    const fwdHtml = msg.forwarded
        ? `<div class="forwarded-label">⟫ Переслано от ${escHtml(msg.forwarded.from)}</div>` : '';
    // comment (from forward)
    const commentHtml = msg.comment
        ? `<div style="font-size:11px;opacity:0.7;margin-bottom:4px;font-style:italic">${escHtml(msg.comment)}</div>` : '';
    // reply block
    const replyHtml = msg.replyTo
        ? `<div class="replied-msg"><div class="r-who">${escHtml(msg.replyTo.user)}</div><div class="r-text">${escHtml(msg.replyTo.text || '[медиа]')}</div></div>` : '';
    // read receipt
    const rcHtml = (isMe && isPrivate)
        ? `<span class="read-status ${msg.read ? 'read' : 'unread'}" data-msg-id="${msg.id}">${msg.read ? '✓✓' : '✓'}</span>` : '';

    const reactId = msg.id || '';

    li.innerHTML = `
        <span class="text-[9px] text-slate-500 mb-1 px-2">${isMe ? 'Вы' : escHtml(msg.user || msg.from)} • ${msg.time}</span>
        <div class="msg-bubble-wrap flex items-end gap-2 ${isMe ? 'flex-row-reverse' : ''}">
            <div class="msg-bubble p-3 px-4 text-sm ${isMe ? 'message-me text-white' : 'message-other text-slate-100'}">
                ${fwdHtml}${commentHtml}${replyHtml}
                <div class="msg-content-slot"></div>
            </div>
            ${rcHtml}
        </div>
        <div class="reactions-row ${isMe ? 'justify-end' : ''}" id="reactions-${reactId}"></div>`;

    container.appendChild(li);

    // fill content slot
    const slot = li.querySelector('.msg-content-slot');
    if (msg.voice) {
        slot.appendChild(buildVoicePlayerEl(msg.voice));
    } else if (msg.file) {
        slot.innerHTML = buildFileHtml(msg.file, isMe);
    } else {
        slot.innerHTML = `<span style="white-space:pre-wrap;word-break:break-word">${escHtml(msg.text || '')}</span>`;
    }

    updateReactionsRow(reactId, msg.reactions || {}, meName);
    lucide.createIcons();

    const bubble = li.querySelector('.msg-bubble');
    if (bubble && isPrivate) {
        setupBubbleEvents(li, bubble, msg);
    }

    scrollToBottom();
}

function buildFileHtml(file, isMe) {
    const isImage = file.type && file.type.startsWith('image/');
    const isVideo = file.type && file.type.startsWith('video/');
    const isAudio = file.type && file.type.startsWith('audio/');
    if (isImage) return `<img src="${file.data}" alt="${escHtml(file.name)}" style="max-width:220px;max-height:200px;border-radius:10px;display:block;">`;
    if (isVideo) return `<video src="${file.data}" controls style="max-width:220px;border-radius:10px;display:block;"></video>`;
    if (isAudio) return `<audio controls src="${file.data}" style="max-width:200px;height:30px;border-radius:8px;"></audio>`;
    const c = isMe ? 'text-white' : 'text-slate-200';
    return `<div class="file-msg">
        <div class="file-icon"><i data-lucide="file" class="w-4 h-4 text-blue-400"></i></div>
        <div class="file-info"><div class="file-name ${c}">${escHtml(file.name)}</div><div class="file-size">${fmtSize(file.size || 0)}</div></div>
        <a href="${file.data}" download="${escHtml(file.name)}" onclick="event.stopPropagation()" class="p-1 text-blue-400 hover:text-blue-300"><i data-lucide="download" class="w-4 h-4"></i></a>
    </div>`;
}

function updateReactionsRow(reactId, reactions, meName) {
    const row = document.getElementById(`reactions-${reactId}`);
    if (!row) return;
    row.innerHTML = Object.entries(reactions).map(([emoji, users]) => {
        const mine = users.includes(meName || username);
        return `<button class="reaction-badge ${mine ? 'mine' : ''}" data-emoji="${emoji}" data-msg-id="${reactId}" title="${escHtml(users.join(', '))}">${emoji} <span>${users.length}</span></button>`;
    }).join('');
}

socket.on('reaction updated', ({ msgId, reactions }) => updateReactionsRow(msgId, reactions, username));

// ════════════════════════════════════════════════════
// BUBBLE EVENTS  — desktop + mobile unified
// ════════════════════════════════════════════════════
function setupBubbleEvents(li, bubble, msg) {
    if (isDesktop()) {
        setupDesktopBubble(li, bubble, msg);
    } else {
        setupMobileBubble(li, bubble, msg);
    }
}

// ── DESKTOP ──────────────────────────────────────────
function setupDesktopBubble(li, bubble, msg) {
    // Hover 1.5s → reaction popup
    let hoverTimer = null;
    bubble.addEventListener('mouseenter', () => {
        hoverTimer = setTimeout(() => showReactionPopup(bubble, msg), 1500);
    });
    bubble.addEventListener('mouseleave', () => { clearTimeout(hoverTimer); });

    // FIX #8: double-click = enter selection mode and select this msg
    // After selection mode is active, SINGLE click selects/deselects
    bubble.addEventListener('dblclick', e => {
        e.preventDefault();
        if (!selectionMode) {
            // enter mode and select this
            enterSelectionMode();
            selectMsg(li, msg.id, true);
        } else {
            toggleMsgSelect(li, msg.id);
        }
    });

    // FIX #8: single click while in selection mode
    bubble.addEventListener('click', e => {
        if (!selectionMode) return;
        e.preventDefault();
        toggleMsgSelect(li, msg.id);
    });
}

// ── MOBILE ───────────────────────────────────────────
function setupMobileBubble(li, bubble, msg) {
    let lastTapTime = 0;
    let longTimer   = null;
    let touchMoved  = false;
    let touchStartX = 0;
    let touchStartY = 0;

    let swipeTriggered = false;

    bubble.addEventListener('touchstart', e => {
        touchMoved     = false;
        swipeTriggered = false;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;

        // Long press → enter selection mode (only if not already in it)
        if (!selectionMode) {
            longTimer = setTimeout(() => {
                if (touchMoved) return;
                navigator.vibrate && navigator.vibrate([20, 10, 20]);
                enterSelectionMode();
                selectMsg(li, msg.id, true);
            }, 600);
        }
    }, { passive: true });


    bubble.addEventListener('touchmove', e => {
        const cx = e.touches[0].clientX;
        const cy = e.touches[0].clientY;
        const dx = Math.abs(cx - touchStartX);
        const dy = Math.abs(cy - touchStartY);
        if (dx > 8 || dy > 8) {
            touchMoved = true;
            clearTimeout(longTimer);
        }
        // Swipe right → reply (once per gesture, only outside selection mode)
        if (!selectionMode && !swipeTriggered && (cx - touchStartX) > 55 && Math.abs(cy - touchStartY) < 25) {
            swipeTriggered = true;
            navigator.vibrate && navigator.vibrate(25);
            startReply(msg);
        }
    }, { passive: true });

    bubble.addEventListener('touchend', e => {
        clearTimeout(longTimer);
        if (touchMoved) return;

        // If in selection mode — single tap toggles
        if (selectionMode) {
            e.preventDefault();
            toggleMsgSelect(li, msg.id);
            return;
        }

        // Double-tap → reaction popup
        const now = Date.now();
        const dt  = now - lastTapTime;
        lastTapTime = now;

        if (dt < 320 && dt > 30) {
            e.preventDefault();
            const touch = e.changedTouches[0];
            showReactionPopupAt(touch.clientX, touch.clientY, msg);
        }
    }, { passive: false });
}

// ── Selection helpers ─────────────────────────────────
function enterSelectionMode() {
    selectionMode = true;
    selectionBar.classList.remove('hidden');
    updateSelCount();
}

// FIX #8/#9: exit resets mode fully — next entry must be dblclick/longpress
function exitSelectionMode() {
    selectionMode = false;
    selectedMsgIds.clear();
    selectionBar.classList.add('hidden');
    document.querySelectorAll('.msg-selected').forEach(el => el.classList.remove('msg-selected'));
    document.querySelectorAll('.msg-check.checked').forEach(el => el.classList.remove('checked'));
}

function selectMsg(li, id, checked) {
    if (checked) {
        selectedMsgIds.add(id);
        li.classList.add('msg-selected');
        const chk = li.querySelector('.msg-check');
        if (chk) chk.classList.add('checked');
    } else {
        selectedMsgIds.delete(id);
        li.classList.remove('msg-selected');
        const chk = li.querySelector('.msg-check');
        if (chk) chk.classList.remove('checked');
    }
    updateSelCount();
    if (selectedMsgIds.size === 0) exitSelectionMode();
}

function toggleMsgSelect(li, id) {
    selectMsg(li, id, !selectedMsgIds.has(id));
}

function updateSelCount() {
    selCountEl.textContent = selectedMsgIds.size;
}

function getSelectedMsgs() {
    return [...document.querySelectorAll('[data-msg-id]')]
        .filter(el => selectedMsgIds.has(el.dataset.msgId))
        .map(el => { try { return JSON.parse(el.dataset.msgData); } catch(e) { return null; } })
        .filter(Boolean);
}

// Selection bar buttons
document.getElementById('selReplyBtn').onclick = () => {
    const msgs = getSelectedMsgs();
    if (msgs.length) startReply(msgs[0]);
    exitSelectionMode();
};
document.getElementById('selForwardBtn').onclick = () => {
    forwardMsgs = getSelectedMsgs();
    if (forwardMsgs.length) openForwardModal();
    exitSelectionMode();
};
document.getElementById('selCancelBtn').onclick = () => exitSelectionMode();

// ════════════════════════════════════════════════════
// REACTION POPUP
// ════════════════════════════════════════════════════
function showReactionPopup(anchor, msg) {
    if (!privateWith) return;
    closeReactionPopup();
    const popup = createReactionPopup(msg);
    document.body.appendChild(popup);
    activePopup = popup;

    const rect = anchor.getBoundingClientRect();
    const pw   = 265;
    popup.style.left = Math.max(8, Math.min(rect.left + rect.width/2 - pw/2, window.innerWidth - pw - 8)) + 'px';
    popup.style.top  = Math.max(8, rect.top - 58) + 'px';

    let closeTimer = null;
    const startClose = ()  => { closeTimer = setTimeout(closeReactionPopup, 280); };
    const cancelClose = () => { clearTimeout(closeTimer); };

    anchor.addEventListener('mouseleave', startClose,   { once: true });
    popup.addEventListener('mouseenter',  cancelClose);
    popup.addEventListener('mouseleave',  startClose);
}

// FIX #1: mobile popup at coordinates
function showReactionPopupAt(x, y, msg) {
    if (!privateWith) return;
    closeReactionPopup();
    const popup = createReactionPopup(msg);
    document.body.appendChild(popup);
    activePopup = popup;

    const pw = 265;
    popup.style.left = Math.max(8, Math.min(x - pw/2, window.innerWidth - pw - 8)) + 'px';
    popup.style.top  = Math.max(8, y - 60) + 'px';

    // close on next touch outside popup
    setTimeout(() => {
        document.addEventListener('touchstart', e => {
            if (!popup.contains(e.target)) closeReactionPopup();
        }, { once: true, passive: true });
    }, 100);
}

function createReactionPopup(msg) {
    const popup = document.createElement('div');
    popup.className = 'reaction-popup';
    REACTION_EMOJIS.forEach(emoji => {
        const btn = document.createElement('button');
        btn.textContent = emoji;
        btn.type = 'button';
        btn.addEventListener('click',     ev => { ev.stopPropagation(); socket.emit('add reaction', { msgId: msg.id, emoji, withUser: privateWith }); closeReactionPopup(); });
        btn.addEventListener('touchend',  ev => { ev.stopPropagation(); ev.preventDefault(); socket.emit('add reaction', { msgId: msg.id, emoji, withUser: privateWith }); closeReactionPopup(); }, { passive: false });
        popup.appendChild(btn);
    });
    return popup;
}

function closeReactionPopup() {
    if (activePopup) { activePopup.remove(); activePopup = null; }
}

// click on existing badge
document.addEventListener('click', e => {
    const badge = e.target.closest('.reaction-badge');
    if (badge && privateWith) {
        socket.emit('add reaction', { msgId: badge.dataset.msgId, emoji: badge.dataset.emoji, withUser: privateWith });
        return;
    }
    if (!e.target.closest('.reaction-popup') && !e.target.closest('.msg-bubble')) closeReactionPopup();
});

// ════════════════════════════════════════════════════
// REPLY
// ════════════════════════════════════════════════════
function startReply(msg) {
    replyData = { id: msg.id, user: msg.user || msg.from, text: msg.text || (msg.voice ? '[голосовое]' : '[файл]') };
    document.getElementById('replyWho').textContent  = replyData.user;
    document.getElementById('replyText').textContent = replyData.text;
    replyPreview.classList.remove('hidden');
    inputEl.focus();
}
function clearReply() { replyData = null; replyPreview.classList.add('hidden'); }
document.getElementById('cancelReplyBtn').onclick = clearReply;

// ════════════════════════════════════════════════════
// FORWARD MODAL
// ════════════════════════════════════════════════════
function openForwardModal() {
    forwardUserList.innerHTML = '';

    // comment field
    const commentEl = document.createElement('textarea');
    commentEl.className = 'fwd-comment';
    commentEl.placeholder = 'Комментарий (необязательно)…';
    commentEl.rows = 2;
    forwardUserList.appendChild(commentEl);

    // FIX #3/#4: build recipients — current chat partner first, then others
    // ALL messages in forwardMsgs will be sent to the chosen recipient
    const recipients = [];
    if (privateWith) recipients.push(privateWith);
    lastOnlineList.filter(u => u !== username && u !== privateWith).forEach(u => recipients.push(u));

    if (!recipients.length) {
        const li = document.createElement('li');
        li.className = 'text-slate-500 text-xs text-center py-3';
        li.textContent = 'Нет доступных получателей';
        forwardUserList.appendChild(li);
    } else {
        recipients.forEach(u => {
            const li = document.createElement('li');
            li.className = 'flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 cursor-pointer transition-all';
            const label = (u === privateWith) ? `${escHtml(u)} <span class="text-[10px] text-slate-500">(этот чат)</span>` : escHtml(u);
            li.innerHTML = `<div class="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center font-bold text-blue-500 text-sm flex-shrink-0">${u[0].toUpperCase()}</div><span class="text-sm">${label}</span>`;

            li.onclick = () => {
                const comment = commentEl.value.trim();
                // snapshot before clearing — sends ALL msgs to THIS recipient only
                const msgsToSend = [...forwardMsgs];
                msgsToSend.forEach(originalMsg => {
                    socket.emit('forward message', { to: u, originalMsg, comment });
                });
                forwardMsgs = [];
                forwardModal.classList.add('hidden');
            };
            forwardUserList.appendChild(li);
        });
    }

    forwardModal.classList.remove('hidden');
}

document.getElementById('forwardCancelBtn').onclick = () => { forwardModal.classList.add('hidden'); forwardMsgs = []; };
forwardModal.addEventListener('click', e => { if (e.target === forwardModal) { forwardModal.classList.add('hidden'); forwardMsgs = []; } });

// ════════════════════════════════════════════════════
// VOICE RECORDING
// ════════════════════════════════════════════════════
const voiceBtn = document.getElementById('voiceBtn');

async function startRecording() {
    if (currentTab !== 'private' || !privateWith) return;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks   = [];
        voiceBlob     = null;

        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
        mediaRecorder.onstop = () => {
            stream.getTracks().forEach(t => t.stop());
            if (!audioChunks.length) return;
            voiceBlob = new Blob(audioChunks, { type: 'audio/webm' });
            recordingBar.classList.add('hidden');
            voicePreview.classList.remove('hidden');
            initPreviewPlayer(voiceBlob);
        };

        mediaRecorder.start();
        voiceBtn.classList.add('recording');
        recordingBar.classList.remove('hidden');
        recSeconds = 0;
        document.getElementById('recTimer').textContent = '0:00';
        recTimerInterval = setInterval(() => {
            recSeconds++;
            const m = Math.floor(recSeconds / 60), s = recSeconds % 60;
            document.getElementById('recTimer').textContent = `${m}:${s.toString().padStart(2,'0')}`;
        }, 1000);
    } catch(err) { alert('Нет доступа к микрофону: ' + err.message); }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    clearInterval(recTimerInterval);
    voiceBtn.classList.remove('recording');
}

voiceBtn.addEventListener('mousedown', e => { e.preventDefault(); startRecording(); });
document.addEventListener('mouseup',   () => { if (mediaRecorder && mediaRecorder.state === 'recording') stopRecording(); });
voiceBtn.addEventListener('touchstart', e => { e.preventDefault(); startRecording(); }, { passive: false });
voiceBtn.addEventListener('touchend',   e => { e.preventDefault(); stopRecording(); },  { passive: false });

document.getElementById('deleteVoiceBtn').onclick = () => {
    voiceBlob = null;
    document.getElementById('voicePreviewPlayer').innerHTML = '';
    voicePreview.classList.add('hidden');
};
document.getElementById('sendVoiceBtn').onclick = () => {
    if (!voiceBlob || !privateWith) return;
    const reader = new FileReader();
    reader.onload = () => {
        socket.emit('private message', { to: privateWith, voice: reader.result, replyTo: replyData });
        clearReply();
        voiceBlob = null;
        document.getElementById('voicePreviewPlayer').innerHTML = '';
        voicePreview.classList.add('hidden');
    };
    reader.readAsDataURL(voiceBlob);
};

// ════════════════════════════════════════════════════
// FILE ATTACHMENT
// ════════════════════════════════════════════════════
document.getElementById('attachBtn').addEventListener('click', e => {
    showToast('Система', 'Cкоро починим! 🛠️');
    // e.stopPropagation();
    // attachMenu.classList.toggle('hidden');
    // lucide.createIcons();
});

attachMenu.querySelectorAll('button').forEach(btn => {
    // Use pointerdown so it fires reliably on both desktop and mobile
    btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        e.stopPropagation();
        const accept = btn.dataset.accept;
        attachMenu.classList.add('hidden');
        // Reset input so same file can be picked again
        fileInput.value = '';
        fileInput.accept = accept;
        // Timeout avoids iOS "Not allowed to launch" due to touch event context
        setTimeout(() => fileInput.click(), 80);
    });
});

fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { alert('Файл слишком большой (макс 20 МБ)'); return; }
    const reader = new FileReader();
    reader.onload = () => {
        pendingFile = { name: file.name, type: file.type, data: reader.result, size: file.size };
        const thumb = document.getElementById('filePreviewThumb');
        const icon  = document.getElementById('filePreviewIcon');
        if (file.type.startsWith('image/')) {
            thumb.src = reader.result; thumb.classList.remove('hidden'); icon.classList.add('hidden');
        } else {
            thumb.classList.add('hidden'); icon.classList.remove('hidden');
        }
        document.getElementById('filePreviewName').textContent = file.name;
        document.getElementById('filePreviewSize').textContent = fmtSize(file.size);
        filePreview.classList.remove('hidden');
        lucide.createIcons();
    };
    reader.readAsDataURL(file);
    fileInput.value = '';
});

document.getElementById('deleteFileBtn').onclick = () => { pendingFile = null; filePreview.classList.add('hidden'); };

// ════════════════════════════════════════════════════
// SEND MESSAGE — FIX #7: no unnecessary async overhead
// ════════════════════════════════════════════════════
document.getElementById('form').addEventListener('submit', e => {
    e.preventDefault();
    const text = inputEl.value.trim();

    if (currentTab === 'private' && privateWith) {
        if (pendingFile) {
            socket.emit('private message', { to: privateWith, file: pendingFile, replyTo: replyData });
            pendingFile = null; filePreview.classList.add('hidden');
            clearReply();
        } else if (text) {
            socket.emit('private message', { to: privateWith, text, replyTo: replyData });
            clearReply();
        }
    } else if (text) {
        socket.emit('chat message', { text });
    }

    inputEl.value = ''; inputEl.style.height = '34px';

    if (isTyping && privateWith) {
        isTyping = false;
        if (typingTimeout) clearTimeout(typingTimeout);
        socket.emit('typing stop', { to: privateWith });
    }
});

inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        document.getElementById('form').dispatchEvent(new Event('submit'));
    }
});
inputEl.addEventListener('input', function() {
    this.style.height = '34px';
    this.style.height = Math.min(this.scrollHeight, 100) + 'px';
    if (currentTab !== 'private' || !privateWith) return;
    if (!isTyping) { isTyping = true; socket.emit('typing start', { to: privateWith }); }
    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => { isTyping = false; socket.emit('typing stop', { to: privateWith }); }, 1500);
});

// ════════════════════════════════════════════════════
// SOCKET EVENTS
// ════════════════════════════════════════════════════
socket.on('chat history', h => {
    document.getElementById('messages').innerHTML = '';
    h.forEach(m => renderMessage(document.getElementById('messages'), m, username));
});
socket.on('chat message', m => renderMessage(document.getElementById('messages'), m, username));

socket.on('private history', ({ history }) => {
    document.getElementById('privateMessages').innerHTML = '';
    history.forEach(m => renderMessage(document.getElementById('privateMessages'), m, username));
});

socket.on('private message', m => {
    const isIncoming = m.from !== username;
    // isActiveChat: we are on private tab AND currently viewing chat with this sender
    const isActiveChat = currentTab === 'private' && privateWith === m.from;

    // #5: sound + toast only when chat is NOT active
    if (isIncoming && !isActiveChat) {
        playNotifSound();
        showToast(m.from, m.text || '[медиа]');
    }

    // render if this message belongs to currently open conversation
    if (privateWith === m.from || m.from === username) {
        renderMessage(document.getElementById('privateMessages'), m, username);
    }

    // #6: mark read only when actively viewing — not just when privateWith matches
    if (isIncoming && isActiveChat) {
        socket.emit('open private chat', { withUser: m.from });
    }
});

socket.on('messages read', ({ ids }) => {
    ids.forEach(id => {
        const el = document.querySelector(`.read-status[data-msg-id="${id}"]`);
        if (el) { el.classList.remove('unread'); el.classList.add('read'); el.textContent = '✓✓'; }
    });
});

// Typing
function showTypingIndicator(from) {
    if (currentTab !== 'private' || privateWith !== from) return;
    typingNameEl.textContent = from;
    typingIndicator.classList.remove('hidden');
    scrollToBottom();
    if (typingHideTimer) clearTimeout(typingHideTimer);
    typingHideTimer = setTimeout(hideTypingIndicator, 4000);
}
function hideTypingIndicator() {
    typingIndicator.classList.add('hidden');
    if (typingHideTimer) { clearTimeout(typingHideTimer); typingHideTimer = null; }
}
socket.on('typing',      ({ from }) => showTypingIndicator(from));
socket.on('typing stop', ({ from }) => { if (privateWith === from) hideTypingIndicator(); });

// ════════════════════════════════════════════════════
// TABS / NAVIGATION
// ════════════════════════════════════════════════════
function showTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tabBtn').forEach(t => {
        const a = t.dataset.tab === tab;
        t.classList.toggle('bg-blue-600', a); t.classList.toggle('text-white', a); t.classList.toggle('text-slate-500', !a);
    });
    document.getElementById('messages').classList.toggle('hidden', tab !== 'public');
    document.getElementById('privateMessages').classList.toggle('hidden', tab !== 'private');
    document.getElementById('chatTitle').textContent = tab === 'public' ? 'Публичный чат' : (privateWith ? `Чат с ${privateWith}` : 'Личные сообщения');
    if (tab === 'public') { hideTypingIndicator(); socket.emit('close private chat'); }
    setTimeout(scrollToBottom, 50);
}

document.querySelectorAll('.tabBtn').forEach(t => t.onclick = () => { showTab(t.dataset.tab); if (!isDesktop()) openChat(); });

document.getElementById('backBtn').onclick = () => {
    socket.emit('close private chat');
    hideTypingIndicator();
    exitSelectionMode();
    sidebar.classList.remove('hidden');
    chatWindow.classList.add('hidden');
    chatWindow.classList.remove('flex');
};

// ── Emoji picker ──
document.getElementById('emojiBtn').addEventListener('click', e => { e.stopPropagation(); emojiPickerContainer.classList.toggle('hidden'); });
emojiPicker.addEventListener('emoji-click', e => { inputEl.value += e.detail.unicode; inputEl.focus(); });

document.addEventListener('click', e => {
    if (!emojiPickerContainer.contains(e.target) && e.target.id !== 'emojiBtn' && !e.target.closest('#emojiBtn'))
        emojiPickerContainer.classList.add('hidden');
    if (!attachMenu.contains(e.target) && e.target.id !== 'attachBtn' && !e.target.closest('#attachBtn'))
        attachMenu.classList.add('hidden');
});

document.getElementById('logoutBtn').onclick = () => location.reload();