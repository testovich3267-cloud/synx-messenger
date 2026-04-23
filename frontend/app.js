// =========================
// GLOBALS
// =========================
const API_URL = "http://localhost:8000";
let token = localStorage.getItem("token");
console.log("TEST JS LOADED");

let currentChatId = null;
let currentChat = null;
let currentChatUserId = null;

let ws = null;

let replyTo = null;
let replyToMessage = null;
let editMessage = null;
let contextMessage = null;

let chats = [];
let selectedUsers = new Set();
let pinnedChats = JSON.parse(localStorage.getItem("pinnedChats") || "[]");

let searchMode = "default"; // "default" | "add_member"

let selectMode = false;
let selectedMessages = new Set();
let forwardMessageId = null;

let touchTimer;
let messages = [];

let forwardFromMessage = null;

// =========================
// Закрытие мобильного сайдбара
// =========================
function closeMobileSidebar() {
    const wrapper = document.getElementById("mobileSidebarWrapper");
    const sidebar = document.getElementById("mobileSidebar");
    const overlay = document.getElementById("mobileSidebarOverlay");

    if (!wrapper || !sidebar || !overlay) return;

    sidebar.classList.remove("active");
    overlay.classList.remove("active");
    wrapper.style.display = "none";
}

//====================================
//Крестик ответа
//====================================

function hideReplyPreview() {
    replyToMessage = null;
    const preview = document.getElementById("replyPreview");
    preview.style.display = "none";
}

//====================================
//Выделение
//====================================
// =========================
// MULTI SELECT MODE
// =========================

function enterSelectMode(firstId) {
    selectMode = true;
    selectedMessages = new Set([firstId]);
    updateSelectedUI();
    showMultiSelectPanel();
}

function exitSelectMode() {
    selectMode = false;
    selectedMessages.clear();
    updateSelectedUI();
    hideMultiSelectPanel();
}

function updateSelectedUI() {
    document.querySelectorAll(".message-bubble").forEach(b => {
        const id = Number(b.dataset.id);
        if (selectedMessages.has(id)) b.classList.add("selected");
        else b.classList.remove("selected");
    });
}

// =========================
// PANEL (Telegram style)
// =========================

function showMultiSelectPanel() {
    const panel = document.getElementById("multiSelectPanel");
    if (!panel) return;

    panel.style.display = "flex";
    panel.querySelector(".count").innerText = selectedMessages.size;
}

function hideMultiSelectPanel() {
    const panel = document.getElementById("multiSelectPanel");
    if (!panel) return;

    panel.style.display = "none";
}


// =========================
// MULTI SELECT PANEL BUTTONS
// =========================

// УДАЛИТЬ ВЫБРАННЫЕ
document.querySelector("#multiSelectPanel .delete").onclick = async () => {
    try {
        await fetch(API_URL + "/delete_messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token
            },
            body: JSON.stringify({
                ids: Array.from(selectedMessages),
                chat_id: currentChatId
            })
        });

        // Удаляем из DOM
        selectedMessages.forEach(id => {
            const el = document.querySelector(`.message-bubble[data-id="${id}"]`);
            el?.closest(".message-row")?.remove();
        });

        exitSelectMode();
    } catch (err) {
        console.error("Multi delete failed:", err);
    }
};


// ПЕРЕСЛАТЬ ВЫБРАННЫЕ
document.querySelector("#multiSelectPanel .forward").onclick = () => {
    const ids = Array.from(selectedMessages);
    if (ids.length === 0) return;

    // Открываем окно выбора чата
    openChatPicker(async (targetChatId) => {

        await fetch(API_URL + "/messages/forward_many", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token
            },
            body: JSON.stringify({
                message_ids: ids,
                target_chat_id: targetChatId
            })
        });

        exitSelectMode();
    });
};

document.querySelector("#multiSelectPanel .cancel").onclick = () => {
    exitSelectMode();
};


// openChatPicker
function openChatPicker(onSelect) {
    const modal = document.getElementById("chatPickerModal");
    const list = document.getElementById("chatPickerList");

    modal.style.display = "flex";
    list.innerHTML = "";

    chats.forEach(chat => {
        const item = document.createElement("div");
        item.className = "chat-picker-item";
        item.innerText = chat.title;

        item.onclick = () => {
            modal.style.display = "none";
            onSelect(chat.id);
        };

        list.appendChild(item);
    });
}


// =========================
// HELPERS
// =========================
function getUserId() {
    try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        return Number(payload.sub);
    } catch {
        return null;
    }
}

function generateColorFromName(name) {
    const palette = [
        "#4cc9f0",
        "#4361ee",
        "#7209b7",
        "#f72585",
        "#3a86ff",
        "#8338ec",
        "#ff006e"
    ];

    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }

    return palette[Math.abs(hash) % palette.length];
}

// =========================
// LOAD CHATS
// =========================
async function loadChats() {
    const prevChatId = currentChatId;

    const res = await fetch(API_URL + "/chats", {
        headers: { "Authorization": "Bearer " + token }
    });
    chats = await res.json();

    // сортировка с учётом закреплённых
    chats.sort((a, b) => {
        const ap = pinnedChats.includes(a.id);
        const bp = pinnedChats.includes(b.id);
        return Number(bp) - Number(ap);
    });

    const list = document.getElementById("chatList");
    list.innerHTML = "";

    chats.forEach(chat => {
        const chatTitle = chat.title || "Без названия";
        const avatarUrl = chat.avatar_url ? API_URL + chat.avatar_url : null;

        const item = document.createElement("div");
        item.className = "chat-item";
        item.dataset.id = chat.id;

        if (chat.other_user_id) {
            item.dataset.userId = chat.other_user_id;
        }

        if (chat.id === currentChatId) item.classList.add("active");

        item.onclick = () => openChat(chat);

        item.innerHTML = `
            <div class="avatar" style="--avatar-color:${generateColorFromName(chatTitle)}">
                ${avatarUrl ? `<img src="${avatarUrl}" class="avatar-img">` : chatTitle[0].toUpperCase()}
                <div class="status-dot"></div>
                <div class="avatar-type">${chat.type === "group" ? "👥" : "👤"}</div>
            </div>
            <div class="chat-main">
                <div class="chat-name-row">
                    <div class="chat-name">
                        ${chatTitle}
                        ${pinnedChats.includes(chat.id) ? '<span class="pin-mark">📌</span>' : ''}
                    </div>
                    <div class="unread-container"></div>
                </div>
            </div>
        `;

        if (chat.unread && chat.unread > 0) {
            const badge = document.createElement("div");
            badge.className = "unread-badge";
            badge.textContent = chat.unread;
            item.querySelector(".unread-container").appendChild(badge);
        }

        list.appendChild(item);


    });

    // можно при желании восстанавливать активный чат
    if (prevChatId !== null) {
        const activeChat = chats.find(c => c.id === prevChatId);
        if (activeChat) {
            // не переоткрываем автоматически, чтобы не дёргать WS и DOM
        }
    }
    // MOBILE CHAT LIST SYNC
const mobileList = document.getElementById("chatListMobile");
if (mobileList) {
    mobileList.innerHTML = document.getElementById("chatList").innerHTML;
}

syncMobileChats();



}

// =========================
// OPEN CHAT
// =========================
async function openChat(chat) {
    // ===== СБРОС ОТВЕТА =====
replyToMessage = null;
hideReplyPreview();

// ===== СБРОС МУЛЬТИ-ВЫБОРА =====
selectedMessages.clear();
exitSelectMode();

    if (!chat) return;

    // ===== СБРОС ТОЛЬКО ОТВЕТА =====
replyToMessage = null;
hideReplyPreview();

// ===== СБРОС МУЛЬТИ-ВЫБОРА =====
selectedMessages.clear();
exitSelectMode();

// forward НЕ трогаем — он должен работать между чатами

    currentChatId = chat.id;
    currentChat = chat;

    // аватар в хедере
    const avatarEl = document.getElementById("chatAvatar");
    const avatarUrl = chat.avatar_url ? API_URL + chat.avatar_url : null;

    if (avatarUrl) {
        avatarEl.innerHTML = `<img src="${avatarUrl}" class="avatar-img">`;
    } else {
        const title = chat.title || "Чат";
        avatarEl.innerHTML = title[0].toUpperCase();
    }

    document.getElementById("chatTitle").textContent = chat.title || "Чат";

    // помечаем чат прочитанным
    await fetch(`${API_URL}/chats/${chat.id}/read`, {
        method: "POST",
        headers: { "Authorization": "Bearer " + token }
    });

    // загружаем сообщения
    await loadMessages(chat.id);

    // подключаем WebSocket
    connectWS(chat.id);

    // обновляем список чатов (unread)
    await loadChats();

    // при открытии чата на мобильном можно закрывать sidebar
    //closeSidebar();
}

// =========================
// LOAD MESSAGES (ПРАВИЛЬНАЯ ВЕРСИЯ)
// =========================
async function loadMessages(chatId) {
    const res = await fetch(`${API_URL}/chats/${chatId}/messages`, {
        headers: { "Authorization": "Bearer " + token }
    });

    const data = await res.json();   // ← читаем JSON ОДИН раз
    messages = data;                 // ← сохраняем глобально

    const body = document.getElementById("chatBody");
    body.innerHTML = "";

    data.forEach(msg => appendMessage(msg)); // ← рендерим ОДИН раз
}

// =========================
// SEND MESSAGE
// =========================
async function sendMessage(text) {
    const input = document.getElementById("messageInput");

    // РЕДАКТИРОВАНИЕ
    if (editMessage) {
        await fetch(API_URL + "/messages/" + editMessage.id, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token
            },
            body: JSON.stringify({ text })
        });

        if (editMessage.textEl) {
            editMessage.textEl.innerText = text;
        }

        editMessage = null;
        input.value = "";
        return;
    }

    // ОСНОВНОЙ PAYLOAD
    let payload = {
        chat_id: currentChatId,
        text: text
    };

    // ОТВЕТ
if (replyToMessage) {
    payload.reply_to = replyToMessage.id;
    payload.reply_preview =
        replyToMessage.text ||
        replyToMessage.file_name ||
        replyToMessage.image_url ||
        "Сообщение";
    payload.reply_from =
        replyToMessage.username || replyToMessage.user_name;
}


// ПЕРЕСЫЛКА
if (forwardFromMessage) {
    payload.forward_from = forwardFromMessage.id;

    payload.forward_preview =
        forwardFromMessage.text ||
        forwardFromMessage.file_name ||
        forwardFromMessage.image_url ||
        "Сообщение";

    payload.forward_from_name =
        forwardFromMessage.username || forwardFromMessage.user_name;
}

    // WS
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
    } else {
        await fetch(API_URL + "/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token
            },
            body: JSON.stringify(payload)
        });
    }

    // СБРОС СОСТОЯНИЙ
    replyToMessage = null;
    hideReplyPreview && hideReplyPreview();

    forwardFromMessage = null;
    hideForwardPreview && hideForwardPreview();

    input.value = "";
}


// =========================
// SEND BUTTON
// =========================
sendBtn.onclick = () => {
    const text = messageInput.value.trim();

    // если нет текста, но есть пересылка или ответ — отправляем
    if (!text && !replyToMessage && !forwardFromMessage && selectedMessages.size === 0) {
        return;
    }

    sendMessage(text);
};



// =========================
// REFRESH STATUSES
// =========================
async function refreshStatuses() {
    const res = await fetch(API_URL + "/users/status", {
        headers: { "Authorization": "Bearer " + token }
    });
    const statuses = await res.json();

    document.querySelectorAll(".chat-item").forEach(item => {
        const userId = Number(item.dataset.userId);
        if (!userId) return;

        const status = statuses[userId];
        const dot = item.querySelector(".status-dot");
        if (!dot) return;

        dot.style.background = status === "online" ? "#0f0" : "#555";
    });
}

setInterval(refreshStatuses, 10000);

// =========================
// WEBSOCKET
// =========================
function connectWS(chatId) {
    if (ws) {
        ws.onclose = null;
        ws.close();
    }

   // ws = new WebSocket(`ws://localhost:8000/ws/chat/${chatId}?token=${token}`);

const WS_BASE = window.location.origin.replace("https", "wss").replace("http", "ws");
const socket = new WebSocket(`${WS_BASE}/ws/chat/${chatId}?token=${token}`);


    ws.onopen = () => {
    console.log("WS connected");
    ws.send(JSON.stringify({ ping: true }));
    };

    ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    // =========================
    // TYPING
    // =========================
    if (msg.typing !== undefined) {
        const indicator = document.getElementById("typingIndicator");
        if (indicator && msg.user_id !== getUserId()) {
            indicator.textContent = msg.typing ? "печатает..." : "";
        }
        return;
    }

    // Удаление одного
if (msg.deleted_id) {
    const el = document.querySelector(`.message-bubble[data-id="${msg.deleted_id}"]`);
    if (el) el.closest(".message-row")?.remove();
    return;
}

// Удаление нескольких
if (msg.deleted_ids) {
    msg.deleted_ids.forEach(id => {
        const el = document.querySelector(`.message-bubble[data-id="${id}"]`);
        if (el) el.closest(".message-row")?.remove();
    });
    return;
}


    // =========================
    // РЕДАКТИРОВАНИЕ
    // =========================
    if (msg.type === "edit") {
        const bubble = document.querySelector(`.message-bubble[data-id="${msg.id}"]`);
        if (bubble) {
            const textEl = bubble.querySelector(".message-text");
            if (textEl) {
                textEl.textContent = msg.text;
                bubble.classList.add("message-edited");
            }
        }
        return;
    }

    // =========================
    // НОВОЕ СООБЩЕНИЕ (текст, файл, фото, пересылка, ответ)
    // =========================
    if (msg.id) {
        if (msg.chat_id === currentChatId) {
            appendMessage(msg);
        } else {
            loadChats();
        }
        return;
    }

    console.log("WS MESSAGE:", msg);
};

}

function appendMessage(msg) {
    // защита от дублей
    if (document.querySelector(`.message-bubble[data-id="${msg.id}"]`)) {
        return;
    }

    const body = document.getElementById("chatBody");

    const row = document.createElement("div");
    row.className = "message-row " + (msg.user_id === getUserId() ? "me" : "them");

    const wrap = document.createElement("div");
    wrap.className = "bubble-wrap";

    const bubble = document.createElement("div");
    bubble.className = "message-bubble " + (msg.user_id === getUserId() ? "me" : "them");
    bubble.dataset.id = msg.id;

bubble.oncontextmenu = (e) => {
    e.preventDefault();
    contextMessage = bubble;
    openContextMenu(e, msg);   // ← msg — объект сообщения
};

bubble.onclick = (e) => {
    if (selectMode) {
        const id = msg.id;
        if (selectedMessages.has(id)) {
            selectedMessages.delete(id);
        } else {
            selectedMessages.add(id);
        }

        updateSelectedCount();

        updateSelectedUI();
        e.stopPropagation();
        return;
    }
};

    // =========================
// FORWARDED BLOCK
// =========================
if (msg.forwarded_from || msg.forward_from_name) {
    const fwd = document.createElement("div");
    fwd.className = "message-forwarded";
    fwd.innerText = "Переслано от " + (msg.forward_from_name || msg.forwarded_from);
    bubble.appendChild(fwd);
}

// ====== ТЕКСТ ПЕРЕСЛАННОГО СООБЩЕНИЯ ======
if (msg.forward_preview) {
    const fwdContent = document.createElement("div");
    fwdContent.className = "forward-preview-text";
    fwdContent.innerText = msg.forward_preview;
    bubble.appendChild(fwdContent);
}


    // =========================
    // ФАЙЛ / ИЗОБРАЖЕНИЕ
    // =========================
    if (msg.file_url || msg.image_url) {

        const fileUrl = API_URL + (msg.image_url || msg.file_url || "");
        let fileType = msg.file_type || "";
        const fileName = msg.file_name || "";

        if (!fileType) {
            const raw = (msg.image_url || msg.file_url || "").toLowerCase();
            const ext = raw.split(".").pop();
            if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) {
                fileType = "image/" + ext;
            }
        }

        if (fileType.startsWith("image/")) {
            const img = document.createElement("img");
            img.src = fileUrl;
            img.className = "message-image";

            img.onclick = () => {
                const modal = document.getElementById("imageModal");
                const modalImg = document.getElementById("imageModalImg");
                modal.style.display = "flex";
                modalImg.src = img.src;
            };

            bubble.appendChild(img);

            if (msg.text && msg.text !== fileName) {
                const caption = document.createElement("div");
                caption.className = "message-caption";
                caption.innerText = msg.text;
                bubble.appendChild(caption);
            }

            const downloadBtn = document.createElement("a");
            downloadBtn.href = fileUrl;
            downloadBtn.textContent = "Скачать";
            downloadBtn.className = "download-btn";
            downloadBtn.setAttribute("download", fileName || "image");
            bubble.appendChild(downloadBtn);
        }

        else {
            const fileBox = document.createElement("div");
            fileBox.className = "file-container";

            const icon = document.createElement("div");
            icon.className = "file-icon";
            icon.innerText = "📄";
            fileBox.appendChild(icon);

            const name = document.createElement("div");
            name.className = "file-name";
            name.innerText = fileName || msg.text || "Файл";
            fileBox.appendChild(name);

            bubble.appendChild(fileBox);

            const downloadBtn = document.createElement("a");
            downloadBtn.href = fileUrl;
            downloadBtn.textContent = "Скачать";
            downloadBtn.className = "download-btn";
            downloadBtn.setAttribute("download", fileName || "file");
            bubble.appendChild(downloadBtn);
        }
    }

// =========================
// REPLY BLOCK (Telegram-style)
// =========================
if (msg.reply_to) {
    const reply = document.createElement("div");
    reply.className = "reply-preview-bubble";

    const author = document.createElement("div");
    author.className = "reply-author";
    author.innerText = msg.reply_from || "Пользователь";

    const content = document.createElement("div");
    content.className = "reply-text";

    // reply_preview — это СТРОКА
    content.innerText = msg.reply_preview || "";

    reply.appendChild(author);
    reply.appendChild(content);
    bubble.appendChild(reply);
}


    // =========================
    // ТЕКСТ
    // =========================
    if (!msg.file_url && !msg.image_url) {
        const textEl = document.createElement("div");
        textEl.className = "message-text";
        textEl.innerText = msg.text || "";
        bubble.appendChild(textEl);
    }

    // =========================
    // ВРЕМЯ
    // =========================
    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.textContent = new Date(msg.created_at).toLocaleTimeString();

    // =========================
    // ВСТАВКА В DOM
    // =========================
    wrap.appendChild(bubble);
    wrap.appendChild(meta);
    row.appendChild(wrap);
    body.appendChild(row);

    body.scrollTop = body.scrollHeight;
}


//======================
//Reply-preview
//======================

function showReplyPreview(msg) {
    const preview = document.getElementById("replyPreview");
    preview.innerHTML = ""; // очистка

    const left = document.createElement("div");
    left.className = "reply-preview-left";

    // Фото
    if (msg.image_url) {
        const img = document.createElement("img");
        img.src = API_URL + msg.image_url;
        img.className = "reply-preview-thumb";
        left.appendChild(img);
    }

    // Документ
    else if (msg.file_url) {
        const icon = document.createElement("div");
        icon.className = "reply-preview-icon";
        icon.innerText = "📄";
        left.appendChild(icon);
    }

    // Текст
    const text = document.createElement("div");
    text.className = "reply-preview-text";
    text.innerText =
        msg.text ||
        msg.file_name ||
        "Сообщение";
    left.appendChild(text);

    // Крестик
    const close = document.createElement("div");
    close.className = "reply-preview-close";
    close.innerText = "✕";
    close.onclick = () => hideReplyPreview();

    preview.appendChild(left);
    preview.appendChild(close);

    preview.style.display = "flex";
}

function showForwardPreview(msg) {
    const box = document.getElementById("forwardPreview");
    if (!box) return;

    const content = box.querySelector(".content");
    content.innerHTML = "";

    // текст / файл / картинка — краткий превью
    if (msg.text) {
        content.innerText = msg.text;
    } else if (msg.file_name) {
        content.innerText = "Файл: " + msg.file_name;
    } else if (msg.image_url) {
        content.innerText = "Изображение";
    } else {
        content.innerText = "Сообщение";
    }

    box.style.display = "flex";
}

function hideForwardPreview() {
    const box = document.getElementById("forwardPreview");
    if (!box) return;
    box.style.display = "none";
    forwardFromMessage = null;
}


function openContextMenu(e, msgObj) {
    const menu = document.getElementById("contextMenu");

    menu.style.display = "block";
    menu.style.left = e.pageX + "px";
    menu.style.top = e.pageY + "px";

    // ОЧИСТКА
    menu.innerHTML = "";

    // ====== ОТВЕТ ======
    const replyItem = document.createElement("div");
    replyItem.className = "context-item";
    replyItem.innerText = "Ответить";
    replyItem.onclick = () => {
        replyToMessage = msgObj;          // ← теперь msgObj есть
        showReplyPreview(msgObj);
        menu.style.display = "none";
    };
    menu.appendChild(replyItem);

    // ====== ПЕРЕСЛАТЬ ======
    const forwardItem = document.createElement("div");
    forwardItem.className = "context-item";
    forwardItem.innerText = "Переслать";
    forwardItem.onclick = () => {
    if (selectedMessages.size > 1) {
        // multi-forward → без превью
        openForwardChatSelector(); // или сразу отправка
    } else {
        forwardFromMessage = msgObj;
        showForwardPreview(msgObj);
    }
};

    menu.appendChild(forwardItem);

    // ====== КОПИРОВАТЬ ======
    const copyItem = document.createElement("div");
    copyItem.className = "context-item";
    copyItem.innerText = "Копировать";
    copyItem.onclick = () => {
        navigator.clipboard.writeText(msgObj.text || "");
        menu.style.display = "none";
    };
    menu.appendChild(copyItem);

    // ====== ВЫБРАТЬ ======
    const selectItem = document.createElement("div");
    selectItem.className = "context-item";
    selectItem.innerText = "Выбрать";
    selectItem.onclick = () => {
        enterSelectMode(msgObj.id);       // ← msgObj.id теперь есть
        menu.style.display = "none";
    };
    menu.appendChild(selectItem);
    // =========================
    // УДАЛИТЬ
    // =========================
    const deleteItem = document.createElement("div");
    deleteItem.className = "context-item danger";
    deleteItem.innerText = "Удалить";

    deleteItem.onclick = async () => {
    try {
        await fetch(API_URL + "/message/" + msgObj.id, {
            method: "DELETE",
            headers: { "Authorization": "Bearer " + token }
        });

        // Удаляем только после успешного запроса
        contextMessage.closest(".message-row")?.remove();
        menu.style.display = "none";

    } catch (err) {
        console.error("Delete failed:", err);
    }
};

    menu.appendChild(deleteItem);
}


// ===========================
// MOBILE SIDEBAR — TELEGRAM X + SYNX
// ===========================

document.addEventListener("DOMContentLoaded", () => {
    const openSidebarBtn = document.getElementById("openSidebarBtn");
    const mobileSidebarWrapper = document.getElementById("mobileSidebarWrapper");
    const mobileSidebar = document.getElementById("mobileSidebar");
    const mobileSidebarOverlay = document.getElementById("mobileSidebarOverlay");

    // если элементы отсутствуют — пропускаем
    if (!openSidebarBtn || !mobileSidebarWrapper || !mobileSidebar || !mobileSidebarOverlay) {
        console.warn("Mobile sidebar elements not found — skipping mobile sidebar init");
        return;
    }

    // открыть
    openSidebarBtn.addEventListener("click", () => {
        mobileSidebarWrapper.style.display = "block";
        setTimeout(() => {
            mobileSidebar.classList.add("active");
            mobileSidebarOverlay.classList.add("active");
        }, 10);
    });

    // закрыть по overlay
    mobileSidebarOverlay.addEventListener("click", closeMobileSidebar);

    // свайп закрытия
    let startX = 0;

    mobileSidebar.addEventListener("touchstart", e => {
        startX = e.touches[0].clientX;
    });

    mobileSidebar.addEventListener("touchmove", e => {
        const diff = e.touches[0].clientX - startX;
        if (diff < -60) closeMobileSidebar();
    });
});

// ===========================
// UNIFIED SEARCH (sidebar search)
// ===========================
const userSearch = document.getElementById("userSearch");
if (userSearch) {
    userSearch.oninput = async (e) => {
        const q = e.target.value.trim();
        const box = document.getElementById("searchResults");

        if (!q) {
            box.innerHTML = "";
            return;
        }

        const res = await fetch(API_URL + "/search?q=" + encodeURIComponent(q), {
            headers: { "Authorization": "Bearer " + token }
        });
        const results = await res.json();

        box.innerHTML = "";

        results.forEach(item => {
            const div = document.createElement("div");
            div.className = "chat-item";

            const title = item.type === "user"
                ? item.username
                : (item.title || "Группа");

            const badge = item.type === "group" ? "👥" : "👤";

            div.innerHTML = `
                <div class="avatar" style="--avatar-color:${generateColorFromName(title)}">
                    ${title[0].toUpperCase()}
                    <div class="avatar-badge">${badge}</div>
                </div>
                <div class="chat-main">
                    <div class="chat-name">${title}</div>
                </div>
            `;

            if (item.type === "user") {
                if (searchMode === "add_member") {
                    div.onclick = () => addMemberToChat(item.id);
                } else {
                    div.onclick = () => startPrivateChat(item.id, item.username);
                }
            } else {
                if (searchMode === "default") {
                    div.onclick = async () => {
                        await loadChats();
                        const chat = chats.find(c => c.id === item.id);
                        if (chat) openChat(chat);
                    };
                }
            }

            box.appendChild(div);
        });
    };
}

// ===========================
// ADD MEMBER MODAL
// ===========================
function openAddMemberModal() {

    document.getElementById("addMemberModal").style.display = "flex";
    document.getElementById("addMemberSearch").value = "";
    document.getElementById("addMemberResults").innerHTML = "";
    searchMode = "add_member";

    // ДЕЛАЕМ КНОПКИ АКТИВНЫМИ ВСЕГДА
    document.getElementById("confirmAddMemberBtn").disabled = false;
    document.getElementById("cancelAddMemberBtn").disabled = false;
}

function closeAddMemberModal() {
    document.getElementById("addMemberModal").style.display = "none";
    searchMode = "default";
}

const addMemberSearch = document.getElementById("addMemberSearch");
if (addMemberSearch) {
    addMemberSearch.oninput = async (e) => {
        const q = e.target.value.trim();
        const box = document.getElementById("addMemberResults");
        const query = addMemberSearch.value.trim();

        // КНОПКИ НЕ БЛОКИРУЕМ
        confirmAddMemberBtn.disabled = false;

        if (!query) {
            addMemberResults.innerHTML = "";
            return;
        }

        /*if (!q) {
            box.innerHTML = "";
            return;
        }*/

        const res = await fetch(API_URL + "/users/search?q=" + encodeURIComponent(q), {
            headers: { "Authorization": "Bearer " + token }
        });
        const users = await res.json();

        box.innerHTML = "";

        users.forEach(u => {
            const div = document.createElement("div");
            div.className = "user-item";
            div.textContent = u.username;

            div.onclick = () => addMemberToChat(u.id);

            box.appendChild(div);
        });
    };
}

function openMembersModal() {
    const modal = document.getElementById("chatMembersModal");
    if (modal) modal.style.display = "flex";
}

function closeMembersModal() {
    const modal = document.getElementById("chatMembersModal");
    if (modal) modal.style.display = "none";
}


function renderChatMembers() {
    if (!currentChat || !currentChat.members) return;
    const list = currentChat.members
        .map(m => `${m.username}`)
        .join("\n");

    openMembersModal(list); // твоя кастомная модалка

}

function openForwardMenu(messageId) {
    forwardMessageId = messageId;
    loadChatsForForward();
    document.getElementById("forwardModal").style.display = "flex";
}

async function loadChatsForForward() {
    const res = await fetch(API_URL + "/chats", {
        headers: { "Authorization": "Bearer " + token }
    });

    const chats = await res.json();
    const list = document.getElementById("forwardChatsList");
    list.innerHTML = "";

    chats.forEach(chat => {
        const div = document.createElement("div");
        div.className = "forward-chat-item";
        div.textContent = chat.title || "Без названия";
        div.onclick = () => forwardToChat(chat.id);
        list.appendChild(div);
    });
}


async function forwardToChat(chatId) {
    await fetch(API_URL + `/messages/${forwardMessageId}/forward`, {
        method: "POST",
        headers: {
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ target_chat_id: chatId })
    });

    closeForwardModal();
    showToast("Сообщение переслано");
}

async function forwardSelected() {
    const ids = Array.from(selectedMessages);

    await fetch(API_URL + "/messages/forward_many", {
        method: "POST",
        headers: {
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            message_ids: Array.from(selectedMessages),
            target_chat_id: currentChatId
        })
    });

    exitSelectMode();
    showToast("Сообщения пересланы");
}


function closeForwardModal() {
    document.getElementById("forwardModal").style.display = "none";
}


async function addMemberToChat(userId) {
    if (!currentChat) return;

    const res = await fetch(`${API_URL}/chats/${currentChat.id}/add_member`, {
        method: "POST",
        headers: {
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ user_id: userId })
    });

    if (!res.ok) {
        showToast("Ошибка добавления участника");
        return;
    }

    showToast("Участник добавлен");
    closeAddMemberModal();

    await loadChats();
    const updated = chats.find(c => c.id === currentChat.id);
    if (updated) currentChat = updated;

    renderChatMembers();
}

// ===========================
// TOAST
// ===========================
function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;

    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add("show"), 10);

    setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

// ===========================
// PRIVATE CHAT
// ===========================
async function startPrivateChat(otherUserId, otherUsername) {
    const res = await fetch(`${API_URL}/chats/private?other_user_id=${otherUserId}`, {
        method: "POST",
        headers: { "Authorization": "Bearer " + token }
    });

    const data = await res.json();

    if (res.ok) {
        await loadChats();
        const chat = chats.find(c => c.id === data.id) || data;
        openChat(chat);
    } else {
        console.error(data);
        showToast("Ошибка открытия личного чата");
    }
}

// ===========================
// CREATE GROUP MODAL
// ===========================
function openCreateGroupModal() {
    const modal = document.getElementById("createGroupModal");
    modal.style.display = "flex";
    selectedUsers.clear();
    loadUsersForGroup();
}

function closeCreateGroupModal() {
    const modal = document.getElementById("createGroupModal");
    modal.style.display = "none";
    selectedUsers.clear();
}

async function loadUsersForGroup() {
    const res = await fetch(API_URL + "/users", {
        headers: { "Authorization": "Bearer " + token }
    });
    const users = await res.json();

    const list = document.getElementById("groupUsersList");
    list.innerHTML = "";

    users.forEach(u => {
        if (u.id === getUserId()) return;

        const div = document.createElement("div");
        div.className = "user-item";
        div.textContent = `${u.username} (ID: ${u.id})`;

        div.onclick = () => {
            if (selectedUsers.has(u.id)) {
                selectedUsers.delete(u.id);
                div.classList.remove("selected");
            } else {
                selectedUsers.add(u.id);
                div.classList.add("selected");
            }
        };

        list.appendChild(div);
    });
}

document.getElementById("cancelGroupBtn").onclick = closeCreateGroupModal;

document.getElementById("createGroupBtn").onclick = async () => {
    const name = document.getElementById("groupNameInput").value.trim();
    if (!name) return showToast("Введите название группы");

    const res = await fetch(API_URL + "/chats", {
        method: "POST",
        headers: {
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            title: name,
            members: Array.from(selectedUsers)
        })
    });

    const data = await res.json();

    if (res.ok) {
        closeCreateGroupModal();
        await loadChats();
        const chat = chats.find(c => c.id === data.id) || data;
        openChat(chat);
    } else {
        showToast("Ошибка создания группы");
    }
};

// ===========================
// PROFILE LOAD / SAVE
// ===========================
async function loadProfile() {
    const res = await fetch(API_URL + "/me", {
        headers: { "Authorization": "Bearer " + token }
    });
    const me = await res.json();

    // --- твой существующий код ---
    document.getElementById("profileUsername").value = me.username;
    document.getElementById("profileName").textContent = me.username;
    document.getElementById("profileStatus").value = me.status || "online";

    if (me.avatar_url) {
        document.getElementById("profileAvatarImg").src = API_URL + me.avatar_url;

        const rightAvatar = document.getElementById("profileAvatar");
        rightAvatar.style.backgroundImage = `url(${API_URL + me.avatar_url})`;
        rightAvatar.style.backgroundSize = "cover";
        rightAvatar.style.backgroundPosition = "center";
        rightAvatar.textContent = "";
    }

    const toggle = document.querySelector(".profile-actions .toggle");
    if (me.status === "invisible") {
        toggle.classList.add("active");
    } else {
        toggle.classList.remove("active");
    }

    updateSidebarStatus(me.status);
    // --- конец твоего кода ---

    // --- ДОБАВЛЯЕМ МОБИЛЬНУЮ СИНХРОНИЗАЦИЮ ---
    const mobileAvatar = document.getElementById("mobileProfileAvatar");
    const mobileName = document.getElementById("mobileProfileName");
    const mobileStatus = document.getElementById("mobileProfileStatus");

    if (mobileAvatar) {
        if (me.avatar_url) {
            mobileAvatar.style.backgroundImage = `url(${API_URL + me.avatar_url})`;
            mobileAvatar.style.backgroundSize = "cover";
            mobileAvatar.style.backgroundPosition = "center";
            mobileAvatar.textContent = "";
        } else {
            mobileAvatar.style.backgroundImage = "";
            mobileAvatar.textContent = me.username[0]?.toUpperCase() || "U";
        }
    }

    if (mobileName) mobileName.textContent = me.username;
    if (mobileStatus) mobileStatus.textContent = me.status === "invisible" ? "Offline" : "Online";
}

async function saveProfile() {
    const username = document.getElementById("profileUsername").value.trim();
    const status = document.getElementById("profileStatus").value.trim();

    const res = await fetch(API_URL + "/me/update", {
        method: "PUT",
        headers: {
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            username: username,
            status: status
        })
    });

    const data = await res.json();

    if (!res.ok) {
        showToast(data.detail || "Ошибка сохранения профиля");
        return;
    }

    // обновляем UI
    await loadProfile();

    closeProfileSettings();
    showToast("Профиль обновлён");
}

// ===========================
// AVATAR UPLOAD
// ===========================
async function uploadAvatar(file) {
    const form = new FormData();
    form.append("file", file);

    const res = await fetch(API_URL + "/me/avatar", {
        method: "POST",
        headers: { "Authorization": "Bearer " + token },
        body: form
    });

    const data = await res.json();

    if (data.avatar_url) {
        const url = API_URL + data.avatar_url;
        document.getElementById("profileAvatarImg").src = url;

        const rightAvatar = document.getElementById("profileAvatar");
        rightAvatar.style.backgroundImage = `url(${url})`;
        rightAvatar.style.backgroundSize = "cover";
        rightAvatar.style.backgroundPosition = "center";
        rightAvatar.textContent = "";
    }
}



// ===========================
// INVISIBLE MODE
// ===========================
async function toggleStealthMode() {
    const desktopToggle = document.querySelector(".profile-actions .toggle");
    const mobileToggle = document.getElementById("mobileStealthToggle");

    // текущее состояние (если хотя бы один активен — считаем невидимкой)
    const isInvisible = desktopToggle.classList.contains("active");

    // переключаем визуально
    desktopToggle.classList.toggle("active");
    if (mobileToggle) mobileToggle.classList.toggle("active");

    const newStatus = isInvisible ? "online" : "invisible";

    const res = await fetch(API_URL + "/me/update", {
        method: "PUT",
        headers: {
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ status: newStatus })
    });

    const data = await res.json();

    if (!res.ok) {
        showToast(data.detail || "Ошибка обновления статуса");
        return;
    }

    // обновляем левый sidebar (desktop)
    updateSidebarStatus(newStatus);

    // обновляем правую панель профиля
    const profileStatusText = document.getElementById("profileStatusText");
    if (profileStatusText) {
        profileStatusText.textContent = newStatus === "invisible" ? "Offline" : "Online";
    }

    // обновляем мобильный статус
    const mobileStatus = document.getElementById("mobileProfileStatus");
    if (mobileStatus) {
        mobileStatus.textContent = newStatus === "invisible" ? "Offline" : "Online";
    }
}

function updateSidebarStatus(status) {
    const pill = document.querySelector(".sidebar-status-pill");
    const dot = pill.querySelector(".status-dot");
    const text = pill.querySelector("span:last-child");

    if (status === "invisible") {
        dot.style.background = "#777";
        text.textContent = "Offline";
    } else {
        dot.style.background = "#0f0";
        text.textContent = "Online";
    }
}

// ===========================
// CHAT SEARCH (по сообщениям)
// ===========================
const chatSearchBtn = document.getElementById("chatSearchBtn");
const chatSearchInput = document.getElementById("chatSearchInput");
const searchNav = document.getElementById("searchNav");

let searchResults = [];
let searchIndex = 0;

if (chatSearchBtn && chatSearchInput) {
    chatSearchBtn.onclick = () => {
        const visible = chatSearchInput.style.display !== "none";
        chatSearchInput.style.display = visible ? "none" : "block";
        if (!visible) chatSearchInput.focus();
    };

    chatSearchInput.oninput = (e) => {
        const q = e.target.value.toLowerCase();

        document.querySelectorAll(".message-bubble").forEach(msg => {
            msg.classList.remove("highlight", "active-highlight");
            msg.innerHTML = msg.innerHTML.replace(/<\/?span[^>]*>/g, "");
        });

        if (!q) {
            searchNav.style.display = "none";
            searchResults = [];
            return;
        }

        searchResults = Array.from(document.querySelectorAll(".message-bubble"))
            .filter(msg => msg.innerText.toLowerCase().includes(q));

        searchResults.forEach(msg => {
            const text = msg.innerHTML;
            const regex = new RegExp(`(${q})`, "gi");
            msg.innerHTML = text.replace(regex, `<span class="highlight-text">$1</span>`);
            msg.classList.add("highlight");
        });

        if (searchResults.length === 0) {
            searchNav.style.display = "none";
            return;
        }

        searchNav.style.display = "flex";
        searchIndex = 0;
        updateSearchCounter();
        highlightActive();
    };
}

function updateSearchCounter() {
    document.getElementById("searchCounter").textContent =
        `${searchIndex + 1} / ${searchResults.length}`;
}

function highlightActive() {
    searchResults.forEach(msg => {
        msg.classList.remove("active-highlight");
        msg.innerHTML = msg.innerHTML.replace(/active-highlight-text/g, "highlight-text");
    });

    const msg = searchResults[searchIndex];
    msg.classList.add("active-highlight");
    msg.innerHTML = msg.innerHTML.replace(/highlight-text/g, "active-highlight-text");
    msg.scrollIntoView({ behavior: "smooth", block: "center" });
}

document.getElementById("searchNext").onclick = () => {
    if (searchResults.length === 0) return;
    searchIndex = (searchIndex + 1) % searchResults.length;
    updateSearchCounter();
    highlightActive();
};

document.getElementById("searchPrev").onclick = () => {
    if (searchResults.length === 0) return;
    searchIndex = (searchIndex - 1 + searchResults.length) % searchResults.length;
    updateSearchCounter();
    highlightActive();
};

// ===========================
// PIN CHAT
// ===========================
function togglePinChat(chatId) {
    if (pinnedChats.includes(chatId)) {
        pinnedChats = pinnedChats.filter(id => id !== chatId);
    } else {
        pinnedChats.push(chatId);
    }
    localStorage.setItem("pinnedChats", JSON.stringify(pinnedChats));
    loadChats();
}

document.getElementById("pinChatBtn").onclick = () => {
    if (currentChatId) togglePinChat(currentChatId);
};

// ===========================
// CHAT MENU
// ===========================
const chatMenuBtn = document.getElementById("chatMenuBtn");
const chatMenu = document.getElementById("chatMenu");

chatMenuBtn.onclick = () => {
    chatMenu.style.display = chatMenu.style.display === "none" ? "block" : "none";
};

// ===========================
// EMOJI
// ===========================
const emojiList = [
    "😀","😁","😂","🤣","😅","😊","😍","😘","😎","😢","😭","😡",
    "👍","👎","🙏","👏","🔥","⭐","💯","❤️","💔","🎉","✨","⚡"
];

const emojiPanel = document.getElementById("emojiPanel");
emojiPanel.innerHTML = emojiList.map(e => `<span>${e}</span>`).join("");

const emojiBtn = document.getElementById("emojiBtn");

emojiBtn.onclick = () => {
    emojiPanel.style.display =
        emojiPanel.style.display === "none" ? "grid" : "none";
};

emojiPanel.onclick = (e) => {
    if (e.target.tagName === "SPAN") {
        messageInput.value += e.target.textContent;
        messageInput.focus();
    }
};

// ===========================
// FILE UPLOAD
// ===========================
const attachBtn = document.getElementById("attachBtn");
const fileInput = document.getElementById("fileInput");

attachBtn.onclick = () => {
    fileInput.click();
};

fileInput.onchange = () => {
    const file = fileInput.files[0];
    if (!file) return;
    uploadFileWithProgress(file);
};

function uploadFileWithProgress(file) {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();

    formData.append("file", file);

    const tempId = "upload-" + Date.now();
    showUploadingMessage(file.name, tempId);

    xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            updateUploadingProgress(tempId, percent);
        }
    };

    xhr.onreadystatechange = () => {
        if (xhr.readyState === 4) {
            if (xhr.status === 200) {
                const res = JSON.parse(xhr.responseText);

                const payload = {
                    file_url: res.url,
                    file_name: res.filename,
                    file_type: res.content_type,
                    chat_id: currentChatId
                };

                if (replyTo) {
                    payload.text = `↪ Ответ на: "${replyTo.text || ''}"`;
                    replyTo = null;
                    clearReplyPreview?.();
                }

                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(payload));
                } else {
                    console.warn("WS закрыт, файл не отправлен");
                }

                finishUploadingMessage(tempId);
            } else {
                failUploadingMessage(tempId);
            }
        }
    };

    xhr.open("POST", `${API_URL}/upload`, true);
    xhr.setRequestHeader("Authorization", "Bearer " + token);
    xhr.send(formData);
}

function showUploadingMessage(filename, tempId) {
    const body = document.getElementById("chatBody");

    const row = document.createElement("div");
    row.className = "message-row me";
    row.dataset.tempId = tempId;

    const wrap = document.createElement("div");
    wrap.className = "bubble-wrap";

    const bubble = document.createElement("div");
    bubble.className = "message-bubble me uploading";

    const nameDiv = document.createElement("div");
    nameDiv.textContent = filename;

    const progress = document.createElement("div");
    progress.className = "upload-progress";
    progress.textContent = "0%";

    bubble.appendChild(nameDiv);
    bubble.appendChild(progress);
    wrap.appendChild(bubble);
    row.appendChild(wrap);
    body.appendChild(row);

    body.scrollTop = body.scrollHeight;
}

function updateUploadingProgress(tempId, percent) {
    const row = document.querySelector(`.message-row[data-temp-id="${tempId}"]`);
    if (!row) return;
    const progress = row.querySelector(".upload-progress");
    if (progress) progress.textContent = percent + "%";
}

function finishUploadingMessage(tempId) {
    const row = document.querySelector(`.message-row[data-temp-id="${tempId}"]`);
    if (row) row.remove();
}

function failUploadingMessage(tempId) {
    const row = document.querySelector(`.message-row[data-temp-id="${tempId}"]`);
    if (!row) return;
    const progress = row.querySelector(".upload-progress");
    if (progress) progress.textContent = "Ошибка загрузки";
}

// ===========================
// IMAGE MODAL
// ===========================
const imageModal = document.getElementById("imageModal");
const imageModalClose = document.querySelector("#imageModal .close");

if (imageModalClose) {
    imageModalClose.onclick = () => {
        imageModal.style.display = "none";
    };
}

imageModal.onclick = (e) => {
    if (e.target === imageModal) {
        imageModal.style.display = "none";
    }
};

// ===========================
// CONTEXT MENU
// ===========================
document.addEventListener("contextmenu", (e) => {
    const msgBubble = e.target.closest(".message-bubble");
    if (!msgBubble) return;

    e.preventDefault();
    contextMessage = msgBubble;

    const menu = document.getElementById("contextMenu");
    menu.style.display = "block";
    menu.style.left = e.pageX + "px";
    menu.style.top = e.pageY + "px";
});

document.addEventListener("click", (e) => {
    const contextMenu = document.getElementById("contextMenu");

    if (!e.target.closest("#contextMenu") && !e.target.closest(".message-bubble")) {
        contextMenu.style.display = "none";
    }

    if (!chatMenu.contains(e.target) && e.target !== chatMenuBtn) {
        chatMenu.style.display = "none";
    }
});

document.getElementById("contextMenu").onclick = (e) => {
    const action = e.target.dataset.action;
    if (!action || !contextMessage) return;

    const messageId = contextMessage.dataset.id;
    const textEl = contextMessage.querySelector(".message-text");
    const messageText = textEl ? textEl.innerText : "";

    if (action === "copy") {
        navigator.clipboard.writeText(messageText);
        document.getElementById("contextMenu").style.display = "none";
        return;
    }

    if (action === "delete") {
        contextMessage.closest(".message-row")?.remove();
        document.getElementById("contextMenu").style.display = "none";

        fetch(API_URL + "/message/" + messageId, {
            method: "DELETE",
            headers: { "Authorization": "Bearer " + token }
        });

        return;
    }


    if (action === "edit") {
        editMessage = {
            id: messageId,
            bubble: contextMessage,
            textEl: textEl,
            oldText: messageText
        };
        messageInput.value = messageText;
        return;
    }

    if (action === "forward") {
            const messageId = contextMessage.dataset.id;
            openForwardMenu(messageId); // ← запускаем пересылку
            document.getElementById("contextMenu").style.display = "none";
            return;
    }

};

// ===========================
// CHAT MENU ACTIONS
// ===========================
const chatInfoBtn = document.getElementById("chatInfoBtn");
if (chatInfoBtn) chatInfoBtn.onclick = () => openChatInfo();

const chatMembersBtn = document.getElementById("chatMembersBtn");
if (chatMembersBtn) chatMembersBtn.onclick = () => openChatMembers();

const chatAddMemberBtn = document.getElementById("chatAddMemberBtn");
if (chatAddMemberBtn) chatAddMemberBtn.onclick = () => openAddMemberModal();

const chatLeaveBtn = document.getElementById("chatLeaveBtn");
if (chatLeaveBtn) chatLeaveBtn.onclick = () => leaveChat();

const chatDeleteBtn = document.getElementById("chatDeleteBtn");
if (chatDeleteBtn) chatDeleteBtn.onclick = () => deleteChat();


function openChatInfo() {
    if (!currentChat) return;

    showToast(
        "Название: " + (currentChat.title || "Чат") +
        "\nТип: " + (currentChat.is_group ? "Группа" : "Личный чат")
    );
}

function openChatMembers() {
    if (!currentChat || !currentChat.members) return;

    const names = currentChat.members.map(m => m.username).join("\n");
    showToast("Участники:\n" + names);
}

async function leaveChat() {
    if (!currentChat) return;

    const ok = confirm("Вы уверены, что хотите покинуть чат?");
    if (!ok) return;

    const res = await fetch(API_URL + `/chats/${currentChat.id}/leave`, {
        method: "POST",
        headers: { "Authorization": "Bearer " + token }
    });

    if (!res.ok) {
        showToast("Ошибка выхода из чата");
        return;
    }

    showToast("Вы покинули чат");
    await loadChats();
}

async function deleteChat() {
    if (!currentChat) return;

    const ok = confirm("Удалить чат навсегда?");
    if (!ok) return;

    const res = await fetch(API_URL + `/chats/${currentChat.id}`, {
        method: "DELETE",
        headers: { "Authorization": "Bearer " + token }
    });

    if (!res.ok) {
        showToast("Ошибка удаления чата");
        return;
    }

    showToast("Чат удалён");
    await loadChats();
}

async function createChat() {
    const name = prompt("Введите название чата:");

    if (!name) return;

    const res = await fetch(API_URL + "/chats", {
        method: "POST",
        headers: {
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ title: name })
    });

    const data = await res.json();

    if (!res.ok) {
        showToast(data.detail || "Ошибка создания чата");
        return;
    }

    await loadChats();
    openChat(data);
}


//Синхра Кнопки +Новый чат
const mobileCreateChatBtn = document.getElementById("mobileCreateChatBtn");
if (mobileCreateChatBtn) {
    mobileCreateChatBtn.onclick = () => createChat();
}


//Синхронизация чатов в мобилке
function syncMobileChats() {
    const desktopItems = document.querySelectorAll("#chatList .chat-item");
    const mobileList = document.getElementById("chatListMobile");

    if (!mobileList) return;

    mobileList.innerHTML = "";

    desktopItems.forEach(item => {
        const clone = item.cloneNode(true);

        // ВАЖНО: переносим обработчик
        clone.onclick = item.onclick;

        mobileList.appendChild(clone);
    });
}


// ===========================
// LOGOUT
// ===========================
function logout() {
    localStorage.clear();
    window.location.replace("login.html");
}

//Открытие и Закрытие настроек
function openProfileSettings() {
    const modal = document.getElementById("profileSettingsModal");
    if (modal) modal.style.display = "flex";
}

function closeProfileSettings() {
    const modal = document.getElementById("profileSettingsModal");
    if (modal) modal.style.display = "none";
}

//Автозакрытие
window.addEventListener("resize", () => {
    if (window.innerWidth >= 860) {
        closeMobileSidebar?.();
    }
});

// Кнопка "Отмена"
const cancelAddMemberBtn = document.getElementById("cancelAddMemberBtn");
if (cancelAddMemberBtn) {
    cancelAddMemberBtn.onclick = () => closeAddMemberModal();
}

// Кнопка "Добавить"
const confirmAddMemberBtn = document.getElementById("confirmAddMemberBtn");
if (confirmAddMemberBtn) {
    confirmAddMemberBtn.onclick = async () => {
        if (!window.selectedUserToAdd) {
            showToast("Выберите пользователя");
            return;
        }

        await addMemberToChat(window.selectedUserToAdd);
        closeAddMemberModal();
    };
}

function openForwardChatSelector() {
    const modal = document.getElementById("forwardChatModal");
    const list = document.getElementById("forwardChatList");

    if (!modal || !list) {
        console.error("forwardChatModal или forwardChatList не найдены в HTML");
        return;
    }

    list.innerHTML = "";

    chats.forEach(chat => {
        const item = document.createElement("div");
        item.className = "forward-chat-item";
        item.innerText = chat.title;

        item.onclick = () => {
            // отправляем пересылку в выбранный чат
            sendForwardToChat(chat.id);
            modal.style.display = "none";
        };

        list.appendChild(item);
    });

    modal.style.display = "flex";
}

function sendForwardToChat(targetChatId) {
    if (selectedMessages.size > 1) {
        // MULTI-FORWARD
        selectedMessages.forEach(id => {
            ws_manager.sendToChat(targetChatId, {
                forward_from: id,
                text: ""
            });
        });

        selectedMessages.clear();
        exitSelectMode();
        return;
    }

    // Одиночная пересылка
    if (forwardFromMessage) {
        ws_manager.sendToChat(targetChatId, {
            forward_from: forwardFromMessage.id,
            text: ""
        });

        forwardFromMessage = null;
        hideForwardPreview();
    }
}

function deleteMessage(id) {
    fetch(API_URL + "/message/" + id, {
        method: "DELETE",
        headers: {
            "Authorization": "Bearer " + token
        }
    });
}

async function forwardSelectedMessages(targetChatId) {
    if (selectedMessages.size === 0) return;

    const ids = Array.from(selectedMessages);

    const res = await fetch("http://localhost:8000/messages/forward_many", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token
        },
        body: JSON.stringify({
            message_ids: ids,
            target_chat_id: targetChatId
        })
    });

    const data = await res.json();
    console.log("Forward result:", data);

    selectedMessages.clear();
    updateSelectedCount();
}

async function deleteSelectedMessages(chatId) {
    const ids = Array.from(selectedMessages);

    const res = await fetch("http://localhost:8000/delete_messages", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token
        },
        body: JSON.stringify({
            ids: ids,
            chat_id: chatId
        })
    });

    const data = await res.json();
    console.log("Delete result:", data);

    selectedMessages.clear();
    updateSelectedCount();
}


function toggleSelectMessage(id) {
    if (selectedMessages.has(id)) {
        selectedMessages.delete(id);
    } else {
        selectedMessages.add(id);
    }
    updateSelectedCount();
}

function updateSelectedCount() {
    document.getElementById("selectedCount").innerText =
        selectedMessages.size;
}

function deleteSelectedMessages() {
    fetch(API_URL + "/delete_messages", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token
        },
        body: JSON.stringify({
            ids: Array.from(selectedMessages),
            chat_id: currentChatId
        })
    });

    selectedMessages.clear();
    exitSelectMode();
}


// ===========================
// INIT
// ===========================
loadChats();
loadProfile();