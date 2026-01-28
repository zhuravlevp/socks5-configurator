// background.js
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

// ========================
// Вспомогательные функции
// ========================
async function getCurrentIP() {
  try {
    const res = await fetch("https://ipinfo.io/ip");
    return (await res.text()).trim();
  } catch (err) {
    console.error("Ошибка получения IP:", String(err));
    return "";
  }
}

// === heartbeat параметры ===
const PING_INTERVAL = 1000;   // раз в PING_INTERVAL миллисекунд шлём ping
const PONG_TIMEOUT  = 3000;  // ждём не более PONG_TIMEOUT миллисекунд ответа

// reconnect параметры
const RECONNECT_INTERVAL = 3000; // пробовать переподключение каждые 3s
const FORCED_RECONNECT_DELAY = 1000; // после форс-очистки ждем 1s перед новым connect

let ws = null;
let isConnecting = false;
let stopReconnect = false;
let heartbeatIntervalId = null;
let pongTimeoutId = null;
let lastPongTime = 0;

// helper для логирования состояния readyState
function readyStateName(r) {
  switch (r) {
    case WebSocket.CONNECTING: return "CONNECTING";
    case WebSocket.OPEN: return "OPEN";
    case WebSocket.CLOSING: return "CLOSING";
    case WebSocket.CLOSED: return "CLOSED";
    default: return String(r);
  }
}

// безопасная отправка сообщения (проверяет состояние)
function safeSend(msg) {
  if (!ws) {
    console.warn("safeSend: ws == null, сообщение не отправлено:", msg);
    return false;
  }
  if (ws.readyState !== WebSocket.OPEN) {
    console.warn("safeSend: ws not OPEN (state =", readyStateName(ws.readyState) + "), сообщение не отправлено:", msg);
    return false;
  }
  try {
    ws.send(msg);
    return true;
  } catch (err) {
    console.error("safeSend: исключение при отправке:", err);
    return false;
  }
}

// Полная очистка сокета и heartbeat (FORCE)
function forceCleanupSocket(reason = '') {
  console.warn("forceCleanupSocket:", reason, "последний pong был:", lastPongTime ? new Date(lastPongTime).toISOString() : "никогда");
  stopHeartbeat();
  
  if (ws) {
    try {
      const state = ws.readyState;
      console.log("Закрываю WebSocket в состоянии", readyStateName(state));
      
      // Устанавливаем пустые обработчики
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      
      // Закрываем только если еще не закрыт
      if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) {
        console.log("Закрываю WebSocket...");
        ws.close(1000, reason);
      }
    } catch (e) {
      console.log("Игнорирую ошибку при закрытии:", e.message);
    }
    ws = null;
  }
  
  isConnecting = false;
  
  // Переподключаемся немедленно при потере связи
  if (!stopReconnect) {
    console.log("Планируем переподключение через", FORCED_RECONNECT_DELAY, "мс");
    setTimeout(() => {
      console.log("Запускаем переподключение из forceCleanupSocket");
      connectWebSocket();
    }, FORCED_RECONNECT_DELAY);
  }
}

// отправить ping (если соединение открыто) с проверкой времени последнего pong
function sendPing() {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.log("sendPing: WebSocket не готов к отправке ping, состояние:", ws ? readyStateName(ws.readyState) : "ws=null");
    return;
  }
  
  // Проверяем, когда был последний pong
  if (lastPongTime > 0) {
    const timeSinceLastPong = Date.now() - lastPongTime;
    if (timeSinceLastPong > PONG_TIMEOUT) {
      console.warn(`sendPing: последний pong был ${timeSinceLastPong}мс назад (больше ${PONG_TIMEOUT}мс) - принудительное переподключение`);
      forceCleanupSocket('last pong too old');
      return;
    }
  }
  
  try {
    // приложение-уровневый ping
    if (!safeSend('__ping__')) {
      forceCleanupSocket('safeSend failed in sendPing');
      return;
    }
    
    console.log(`Отправлен ping, ожидаю pong в течение ${PONG_TIMEOUT}мс`);

    // Устанавливаем таймаут ожидания pong для ЭТОГО ping
    if (pongTimeoutId) {
      console.log("Очищаем предыдущий pong таймаут");
      clearTimeout(pongTimeoutId);
    }
    
    pongTimeoutId = setTimeout(() => {
      const timeSinceLastPong = lastPongTime > 0 ? Date.now() - lastPongTime : Infinity;
      console.warn(`Heartbeat: pong timeout - последний pong был ${timeSinceLastPong}мс назад`);
      forceCleanupSocket('pong timeout');
    }, PONG_TIMEOUT);
    
  } catch (err) {
    console.error('Ошибка при отправке ping:', err);
    forceCleanupSocket('exception in sendPing');
  }
}

function startHeartbeat() {
  stopHeartbeat(); // на всякий случай
  lastPongTime = Date.now(); // Сбрасываем время последнего pong
  
  // отправляем первый ping через небольшую задержку
  setTimeout(() => {
    sendPing();
  }, 1000);
  
  heartbeatIntervalId = setInterval(() => {
    sendPing();
  }, PING_INTERVAL);
}

function stopHeartbeat() {
  if (heartbeatIntervalId) {
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
  }
  if (pongTimeoutId) {
    clearTimeout(pongTimeoutId);
    pongTimeoutId = null;
  }
}

// === основная функция подключения с heartbeat ===
async function connectWebSocket() {
  if (isConnecting) {
    console.log("connectWebSocket: уже в процессе подключения — пропускаем");
    return;
  }
  if (stopReconnect) {
    console.log("connectWebSocket: stopReconnect=true — не подключаемся");
    return;
  }

  // Если уже есть открытый сокет — ничего не делаем
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log("connectWebSocket: ws уже OPEN — пропускаем");
    return;
  }

  isConnecting = true;
  console.log("connectWebSocket: старт подключения...");

  try {
    const settings = await chrome.storage.local.get([
      "authswitch",
      "authserver",
      "authusername",
      "authpassword"
    ]);

    if (settings.authswitch !== "on") {
      stopReconnect = true;
      if (ws) {
        try { 
          ws.close(1000, "auth off"); 
        } catch (e) {}
      }
      console.log("Авторизация выключена");
      isConnecting = false;
      return;
    }

    const wsUrl = settings.authserver || "ws://127.0.0.1:8765";
    const username = settings.authusername || "admin";
    const password = settings.authpassword || "admin123";
    const ip = await getCurrentIP();

    console.log("Пробуем подключиться к:", wsUrl);
    
    // Закрываем старый ws если он существует
    if (ws) {
      console.log("connectWebSocket: закрываю предыдущий ws, state =", readyStateName(ws.readyState));
      try {
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000, "reconnecting");
        }
      } catch (e) {}
      ws = null;
    }

    // создаём новый WebSocket
    try {
      ws = new WebSocket(wsUrl);
      console.log("WebSocket создан, состояние:", readyStateName(ws.readyState));
    } catch (err) {
      console.error("Ошибка при создании WebSocket:", err);
      isConnecting = false;
      setTimeout(() => connectWebSocket(), 5000);
      return;
    }

    ws.onopen = () => {
      console.log("WS onopen — соединение установлено");
      lastPongTime = Date.now(); // Сбрасываем время pong
      
      const payload = JSON.stringify({
        type: "auth",
        user: username,
        pass: password,
        user_ip: ip
      });
      
      console.log("Отправляю auth:", payload);
      if (!safeSend(payload)) {
        console.warn("Не удалось отправить auth");
        forceCleanupSocket('auth send failed');
        return;
      }
      
      console.log("Запускаем heartbeat");
      startHeartbeat();
      isConnecting = false;
    };

    ws.onmessage = (ev) => {
      const msg = ev.data.toString();
      
      // Обрабатываем pong
      if (msg === '__pong__') {
        lastPongTime = Date.now(); // Обновляем время получения pong
        if (pongTimeoutId) {
          clearTimeout(pongTimeoutId);
          pongTimeoutId = null;
        }
        console.log("Получен __pong__, время:", new Date().toISOString());
        return;
      }
      
      console.log("WS сообщение:", msg);
      
      // Обработка других сообщений
      if (msg.trim().startsWith('{') && msg.trim().endsWith('}')) {
        try {
          const data = JSON.parse(msg);
          if (data.type === "auth_ok") {
            console.log("Авторизация успешна");
          } else if (data.type === "auth_fail") {
            console.error("Ошибка авторизации:", data.reason);
            forceCleanupSocket('auth failed');
          }
        } catch (e) {
          console.log("Не удалось распарсить JSON:", e.message);
        }
      }
    };

    ws.onerror = (ev) => {
      console.error("WS onerror — событие ошибки");
      forceCleanupSocket('WebSocket error event');
    };

    ws.onclose = (ev) => {
      console.warn("WS onclose — соединение закрыто:", {
        code: ev && ev.code,
        reason: ev && ev.reason,
        wasClean: ev && ev.wasClean
      });
      
      stopHeartbeat();
      ws = null;
      isConnecting = false;
      
      // Автоматическое переподключение через небольшой интервал
      if (!stopReconnect) {
        console.log("Планирую переподключение через 2 секунды...");
        setTimeout(() => {
          if (!stopReconnect) {
            connectWebSocket();
          }
        }, 2000);
      }
    };
  } catch (err) {
    console.error("Ошибка при подключении:", err);
    isConnecting = false;
    if (!stopReconnect) {
      setTimeout(() => connectWebSocket(), 5000);
    }
  }
}

// ========================
// Постоянный цикл reconnect
// ========================
setInterval(() => {
  // Проверяем, не слишком ли давно был последний pong
  if (lastPongTime > 0) {
    const timeSinceLastPong = Date.now() - lastPongTime;
    if (timeSinceLastPong > PONG_TIMEOUT * 2) {
      console.warn(`Слишком давно не было pong (${timeSinceLastPong}мс) - принудительное переподключение`);
      forceCleanupSocket('no pong for too long');
      return;
    }
  }
  
  // Упрощенная проверка: если нет открытого соединения и не в процессе подключения
  const needConnect = !stopReconnect && 
                     (!ws || ws.readyState !== WebSocket.OPEN) && 
                     !isConnecting;
  
  if (needConnect) {
    console.log("Цикл reconnect: запускаю подключение");
    connectWebSocket();
  }
}, RECONNECT_INTERVAL);

// ========================
// Реакция на события расширения
// ========================
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "save_settings") {
    console.log("Сохранение настроек — переподключаемся");
    stopReconnect = false;
    forceCleanupSocket('settings changed');
  }
});

chrome.runtime.onStartup.addListener(() => {
  console.log("Расширение запущено — подключаемся...");
  stopReconnect = false;
  connectWebSocket();
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("Расширение установлено/обновлено — подключаемся...");
  stopReconnect = false;
  connectWebSocket();
});

// реагируем на изменение сетевого состояния
if (self.addEventListener) {
  self.addEventListener('online', () => {
    console.log("Сеть: онлайн — переподключаемся");
    stopReconnect = false;
    forceCleanupSocket('network online');
  });
  
  self.addEventListener('offline', () => {
    console.log("Сеть: оффлайн — закрываем соединение");
    stopReconnect = true;
    forceCleanupSocket('network offline');
  });
}

// хэндлер storage.onChanged
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== "local") return;

  if (changes.authswitch) {
    const newVal = changes.authswitch.newValue;
    if (newVal !== "on") {
      console.log("Авторизация выключена — останавливаем");
      stopReconnect = true;
      forceCleanupSocket('auth disabled');
    } else {
      console.log("Авторизация включена — подключаемся");
      stopReconnect = false;
      connectWebSocket();
    }
  }

  if (changes.authserver || changes.authusername || changes.authpassword) {
    console.log("Настройки изменились — переподключаемся");
    stopReconnect = false;
    forceCleanupSocket('settings updated');
  }
});

// Начальное подключение
console.log("Инициализация расширения...");
connectWebSocket();