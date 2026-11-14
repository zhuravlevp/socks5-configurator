// background.js
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

// ========================
// IP helpers
// ========================
const IP_PROVIDERS = [
  { url: "https://api.ipify.org?format=text" },
  { url: "https://ifconfig.me/ip" },
  { url: "https://icanhazip.com" },
  { url: "https://ipinfo.io/ip" },
];

const FETCH_TIMEOUT_MS = 8000;

function isValidIP(ip) {
  if (!ip || typeof ip !== "string") return false;
  ip = ip.trim();
  if (!ip || ip.length > 45) return false;
  if (/error|timeout|upstream|disconnect|reset|refused|html|http/i.test(ip)) return false;

  const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4.test(ip)) {
    return ip.split(".").every((octet) => {
      const n = Number(octet);
      return Number.isInteger(n) && n >= 0 && n <= 255;
    });
  }

  const ipv6 = /^[0-9a-fA-F:]+$/;
  return ipv6.test(ip) && ip.includes(":");
}

async function fetchIPFromProvider(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) return "";
    const text = (await res.text()).trim();
    return isValidIP(text) ? text : "";
  } finally {
    clearTimeout(timer);
  }
}

async function getCurrentIP() {
  for (const provider of IP_PROVIDERS) {
    try {
      const ip = await fetchIPFromProvider(provider.url);
      if (ip) {
        console.log("IP получен от", provider.url, ":", ip);
        return ip;
      }
    } catch (err) {
      console.warn("Провайдер IP недоступен:", provider.url, String(err));
    }
  }
  console.error("Не удалось получить валидный IP ни от одного провайдера");
  return "";
}

// ========================
// Bypass / proxy settings
// ========================
const PRIVATE_BYPASS = [
  "10.0.0.0/8",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "224.0.0.0/4",
  "::/127",
  "<local>",
  "<localhost>",
  "*.local",
];

const JSON_FETCH_TIMEOUT_MS = 30000;

function isIpOrCidr(value) {
  return /^(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?$/.test(value)
    || /^[0-9a-fA-F:]+(?:\/\d{1,3})?$/.test(value);
}

function expandBypassEntry(value) {
  const v = String(value || "").trim();
  if (!v) return [];
  if (v.startsWith("<") || isIpOrCidr(v)) return [v];
  return [v, `*.${v}`];
}

function parseAmneziaJson(data) {
  if (!Array.isArray(data)) return [];

  const entries = [];
  const seen = new Set();

  const push = (value) => {
    const v = String(value || "").trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    entries.push(v);
  };

  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    push(item.hostname);
    push(item.ip);
    if (Array.isArray(item.ips)) {
      for (const ip of item.ips) push(ip);
    }
  }

  return entries;
}

async function fetchRemoteBypassJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JSON_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return parseAmneziaJson(data);
  } finally {
    clearTimeout(timer);
  }
}

async function loadRemoteBypassList(url) {
  if (!url) {
    await chrome.storage.local.set({
      bypassjsoncache: [],
      bypassjsonmeta: { count: 0, updatedAt: "", error: "" },
    });
    return { entries: [], error: "", count: 0 };
  }

  try {
    const entries = await fetchRemoteBypassJson(url);
    const meta = {
      count: entries.length,
      updatedAt: new Date().toISOString(),
      error: "",
      url,
    };
    await chrome.storage.local.set({
      bypassjsoncache: entries,
      bypassjsonmeta: meta,
    });
    console.log(`Bypass JSON загружен: ${entries.length} записей из`, url);
    return { entries, error: "", count: entries.length };
  } catch (err) {
    const error = String(err && err.message ? err.message : err);
    console.warn("Не удалось загрузить bypass JSON:", error);
    const stored = await chrome.storage.local.get(["bypassjsoncache", "bypassjsonmeta"]);
    const cached = Array.isArray(stored.bypassjsoncache) ? stored.bypassjsoncache : [];
    await chrome.storage.local.set({
      bypassjsonmeta: {
        ...(stored.bypassjsonmeta || {}),
        error,
        url,
      },
    });
    return { entries: cached, error, count: cached.length };
  }
}

function buildBypassList(manualText, remoteEntries, bypassEnabled) {
  const list = [...PRIVATE_BYPASS];
  const seen = new Set(list);

  const add = (value) => {
    for (const item of expandBypassEntry(value)) {
      if (seen.has(item)) continue;
      seen.add(item);
      list.push(item);
    }
  };

  if (bypassEnabled) {
    String(manualText || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach(add);

    (remoteEntries || []).forEach(add);
  }

  return list;
}

function setProxyConfig(config) {
  return new Promise((resolve, reject) => {
    chrome.proxy.settings.set({ value: config, scope: "regular" }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

let applyProxyPromise = null;

async function applyProxySettings() {
  if (applyProxyPromise) return applyProxyPromise;

  applyProxyPromise = (async () => {
    const settings = await chrome.storage.local.get([
      "socks5switch",
      "socks5server",
      "bypassswitch",
      "bypassdomain",
      "bypassjsonurl",
    ]);

    const socksOn = (settings.socks5switch || "on") === "on";
    if (!socksOn) {
      await setProxyConfig({ mode: "system" });
      return { ok: true, jsonCount: 0, jsonError: "" };
    }

    const socks5server = settings.socks5server || "";
    if (!/.+:\d+/.test(socks5server)) {
      throw new Error("Invalid socks5 proxy address");
    }

    const bypassOn = (settings.bypassswitch || "on") === "on";
    const jsonUrl = (settings.bypassjsonurl || "").trim();
    const remote = await loadRemoteBypassList(jsonUrl);
    const bypassList = buildBypassList(
      settings.bypassdomain || "",
      remote.entries,
      bypassOn,
    );

    const host = socks5server.substring(0, socks5server.lastIndexOf(":")).replace("[", "").replace("]", "");
    const port = parseInt(socks5server.substring(socks5server.lastIndexOf(":") + 1), 10);

    await setProxyConfig({
      mode: "fixed_servers",
      rules: {
        singleProxy: {
          scheme: "socks5",
          host,
          port,
        },
        bypassList,
      },
    });

    console.log(`Proxy applied: ${host}:${port}, bypass entries: ${bypassList.length}`);
    return {
      ok: true,
      jsonCount: remote.count,
      jsonError: remote.error,
      bypassCount: bypassList.length,
    };
  })();

  try {
    return await applyProxyPromise;
  } finally {
    applyProxyPromise = null;
  }
}

// ========================
// Connection parameters
// ========================
const PING_INTERVAL = 5000;
const PONG_TIMEOUT = 15000;
const RECONNECT_INTERVAL = 3000;
const FORCED_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;
const IP_CHECK_INTERVAL = 15000;
const AUTH_RESEND_INTERVAL = 60000;

let ws = null;
let isConnecting = false;
let stopReconnect = false;
let heartbeatIntervalId = null;
let pongTimeoutId = null;
let lastPongTime = 0;
let reconnectAttempts = 0;
let lastKnownIP = "";
let ipCheckIntervalId = null;
let authResendIntervalId = null;
let reconnectTimerId = null;
let authToken = "";
let tokenRejected = false;

function readyStateName(r) {
  switch (r) {
    case WebSocket.CONNECTING: return "CONNECTING";
    case WebSocket.OPEN: return "OPEN";
    case WebSocket.CLOSING: return "CLOSING";
    case WebSocket.CLOSED: return "CLOSED";
    default: return String(r);
  }
}

function safeSend(msg) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(msg);
    return true;
  } catch (err) {
    console.error("safeSend error:", err);
    return false;
  }
}

function clearReconnectTimer() {
  if (reconnectTimerId) {
    clearTimeout(reconnectTimerId);
    reconnectTimerId = null;
  }
}

function scheduleReconnect(reason, delay) {
  if (stopReconnect) return;
  if (reconnectTimerId || isConnecting) return;
  if (ws && ws.readyState === WebSocket.OPEN) return;

  const actualDelay = delay ?? Math.min(
    FORCED_RECONNECT_DELAY * Math.pow(1.5, reconnectAttempts),
    MAX_RECONNECT_DELAY
  );
  reconnectAttempts++;

  console.log(`Переподключение через ${actualDelay}мс (${reason}), попытка ${reconnectAttempts}`);
  reconnectTimerId = setTimeout(() => {
    reconnectTimerId = null;
    connectWebSocket();
  }, actualDelay);
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

function stopAuthResend() {
  if (authResendIntervalId) {
    clearInterval(authResendIntervalId);
    authResendIntervalId = null;
  }
}

function forceCleanupSocket(reason = "") {
  console.warn("forceCleanupSocket:", reason);
  stopHeartbeat();
  stopAuthResend();
  clearReconnectTimer();

  if (ws) {
    try {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, reason);
      }
    } catch (e) {
      console.warn("Ошибка при закрытии WS:", e);
    }
    ws = null;
  }

  isConnecting = false;
  scheduleReconnect(reason);
}

function sendPing() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  if (lastPongTime > 0 && Date.now() - lastPongTime > PONG_TIMEOUT) {
    forceCleanupSocket("last pong too old");
    return;
  }

  if (!safeSend("__ping__")) {
    forceCleanupSocket("ping send failed");
    return;
  }

  if (pongTimeoutId) clearTimeout(pongTimeoutId);
  pongTimeoutId = setTimeout(() => {
    forceCleanupSocket("pong timeout");
  }, PONG_TIMEOUT);
}

function startHeartbeat() {
  stopHeartbeat();
  lastPongTime = Date.now();
  setTimeout(sendPing, 500);
  heartbeatIntervalId = setInterval(sendPing, PING_INTERVAL);
}

async function sendAuthUpdate(reason = "auth") {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;

  const ip = await getCurrentIP();
  if (!ip) {
    console.warn("sendAuthUpdate: нет валидного IP, пропускаем");
    return false;
  }

  if (lastKnownIP && lastKnownIP !== ip) {
    console.log(`IP изменился: ${lastKnownIP} → ${ip}`);
  }
  lastKnownIP = ip;

  const msgType = (reason === "periodic" || reason === "ip-changed") ? "update_ip" : "auth";
  const payload = JSON.stringify({
    type: msgType,
    token: authToken,
    user_ip: ip,
  });

  if (!safeSend(payload)) {
    forceCleanupSocket("auth send failed");
    return false;
  }

  console.log(`Отправлен ${reason === "periodic" ? "update_ip" : "auth"}:`, ip);
  return true;
}

function startAuthResend() {
  stopAuthResend();
  authResendIntervalId = setInterval(() => {
    sendAuthUpdate("periodic");
  }, AUTH_RESEND_INTERVAL);
}

async function checkIPChange() {
  const currentIP = await getCurrentIP();
  if (!currentIP) return;

  if (lastKnownIP && lastKnownIP !== currentIP) {
    console.log(`IP изменился вне сессии: ${lastKnownIP} → ${currentIP}`);
    if (ws && ws.readyState === WebSocket.OPEN) {
      await sendAuthUpdate("ip-changed");
    } else {
      forceCleanupSocket("IP changed");
    }
    return;
  }

  lastKnownIP = currentIP;
}

async function connectWebSocket() {
  if (isConnecting) return;
  if (stopReconnect) return;
  if (tokenRejected) return;
  if (ws && ws.readyState === WebSocket.OPEN) return;

  clearReconnectTimer();
  isConnecting = true;
  console.log("connectWebSocket: старт...");

  try {
    const settings = await chrome.storage.local.get([
      "authswitch",
      "authserver",
      "authtoken",
    ]);

    if (settings.authswitch !== "on") {
      stopReconnect = true;
      if (ws) {
        try { ws.close(1000, "auth off"); } catch (e) {}
      }
      isConnecting = false;
      return;
    }

    const wsUrl = settings.authserver || "ws://127.0.0.1:8765";
    authToken = (settings.authtoken || "").trim();

    if (!authToken) {
      console.warn("Токен не задан — подключение отменено");
      isConnecting = false;
      return;
    }

    const ip = await getCurrentIP();
    if (!ip) {
      console.warn("Нет валидного IP — повторим подключение позже");
      isConnecting = false;
      scheduleReconnect("no valid IP", 5000);
      return;
    }
    lastKnownIP = ip;

    if (ws) {
      try {
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000, "reconnecting");
        }
      } catch (e) {}
      ws = null;
    }

    ws = new WebSocket(wsUrl);

    ws.onopen = async () => {
      console.log("WS подключён");
      reconnectAttempts = 0;
      clearReconnectTimer();

      const sent = await sendAuthUpdate("connect");
      if (!sent) return;

      startHeartbeat();
      startAuthResend();
      isConnecting = false;
    };

    ws.onmessage = (ev) => {
      const msg = ev.data.toString();

      if (msg === "__pong__") {
        lastPongTime = Date.now();
        if (pongTimeoutId) {
          clearTimeout(pongTimeoutId);
          pongTimeoutId = null;
        }
        return;
      }

      if (msg.trim().startsWith("{")) {
        try {
          const data = JSON.parse(msg);
          if (data.type === "auth_ok" || data.type === "ip_saved" || data.type === "ip_known") {
            tokenRejected = false;
            console.log("Сервер подтвердил:", data.type);
          } else if (
            data.type === "auth_forbidden" ||
            data.status === 403 ||
            data.type === "auth_failed" ||
            data.type === "auth_fail"
          ) {
            console.error("Невалидный токен (403)");
            tokenRejected = true;
            stopReconnect = true;
            forceCleanupSocket("invalid token");
          }
        } catch (e) {
          console.warn("Не удалось распарсить JSON:", e.message);
        }
      }
    };

    ws.onerror = () => {
      forceCleanupSocket("WebSocket error");
    };

    ws.onclose = () => {
      stopHeartbeat();
      stopAuthResend();
      ws = null;
      isConnecting = false;
      scheduleReconnect("connection closed", 2000);
    };
  } catch (err) {
    console.error("Ошибка подключения:", err);
    isConnecting = false;
    scheduleReconnect("connect exception", 5000);
  }
}

// ========================
// Watchdog & IP monitoring
// ========================
setInterval(() => {
  if (stopReconnect) return;

  if (ws && ws.readyState === WebSocket.OPEN && lastPongTime > 0) {
    const elapsed = Date.now() - lastPongTime;
    if (elapsed > PONG_TIMEOUT * 2) {
      forceCleanupSocket("watchdog: no pong");
      return;
    }
  }

  if ((!ws || ws.readyState !== WebSocket.OPEN) && !isConnecting && !reconnectTimerId) {
    connectWebSocket();
  }
}, RECONNECT_INTERVAL);

ipCheckIntervalId = setInterval(checkIPChange, IP_CHECK_INTERVAL);

function initWatchdogAlarm() {
  if (!chrome.alarms?.create) {
    console.warn(
      "chrome.alarms недоступен — перезагрузите расширение на chrome://extensions"
    );
    return;
  }

  chrome.alarms.create("connectionWatchdog", { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== "connectionWatchdog") return;
    if (stopReconnect) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connectWebSocket();
    } else {
      checkIPChange();
    }
  });
}

initWatchdogAlarm();

// ========================
// Extension events
// ========================
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "save_settings") {
    tokenRejected = false;
    stopReconnect = false;
    forceCleanupSocket("settings changed");
  }

  if (message.action === "apply_proxy") {
    applyProxySettings()
      .then((result) => sendResponse(result))
      .catch((err) => {
        console.error("apply_proxy failed:", err);
        sendResponse({ ok: false, jsonError: String(err && err.message ? err.message : err) });
      });
    return true;
  }

  if (message.action === "get_connection_status") {
    sendResponse({
      wsState: ws ? readyStateName(ws.readyState) : "DISCONNECTED",
      isConnecting,
      lastPongTime: lastPongTime ? new Date(lastPongTime).toLocaleTimeString() : "никогда",
      lastPongTimestamp: lastPongTime || 0,
      currentIP: lastKnownIP,
      reconnectAttempts,
      stopReconnect,
      tokenRejected,
      url: ws ? ws.url : "не подключен",
    });
    return true;
  }
});

chrome.runtime.onStartup.addListener(() => {
  stopReconnect = false;
  connectWebSocket();
  applyProxySettings().catch((err) => console.error("startup proxy apply failed:", err));
});

chrome.runtime.onInstalled.addListener(() => {
  stopReconnect = false;
  connectWebSocket();
  applyProxySettings().catch((err) => console.error("install proxy apply failed:", err));
});

if (self.addEventListener) {
  self.addEventListener("online", () => {
    stopReconnect = false;
    forceCleanupSocket("network online");
  });

  self.addEventListener("offline", () => {
    forceCleanupSocket("network offline");
  });
}

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== "local") return;

  if (changes.authswitch) {
    if (changes.authswitch.newValue !== "on") {
      stopReconnect = true;
      forceCleanupSocket("auth disabled");
    } else {
      stopReconnect = false;
      tokenRejected = false;
      connectWebSocket();
    }
  }

  if (changes.authserver || changes.authtoken) {
    tokenRejected = false;
    stopReconnect = false;
    forceCleanupSocket("settings updated");
  }

  if (
    changes.socks5switch ||
    changes.socks5server ||
    changes.bypassswitch ||
    changes.bypassdomain ||
    changes.bypassjsonurl
  ) {
    applyProxySettings().catch((err) => console.error("storage proxy apply failed:", err));
  }
});

console.log("Инициализация расширения...");
connectWebSocket();
applyProxySettings().catch((err) => console.error("init proxy apply failed:", err));

chrome.runtime.onSuspend.addListener(() => {
  stopHeartbeat();
  stopAuthResend();
  if (ipCheckIntervalId) clearInterval(ipCheckIntervalId);
  if (ws) {
    try { ws.close(1000, "extension unloading"); } catch (e) {}
  }
});
