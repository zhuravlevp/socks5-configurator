// Импорт WebSocket клиента
importScripts('websocket-client.js');

// Глобальный экземпляр WebSocket клиента
let wsClient = null;

chrome.action.onClicked.addListener(() => {
    chrome.runtime.openOptionsPage();
});

/**
 * Функция авторизации и добавления IP через WebSocket
 */
async function authenticateAndAddIP() {
    // Получаем настройки из storage
    const settings = await chrome.storage.local.get([
        'authswitch', 'authserver', 'authusername', 'authpassword'
    ]);
    
    if (settings.authswitch !== 'on') {
        console.log('[Auth] Авторизация отключена');
        // Если была активна, отключаем
        if (wsClient) {
            wsClient.disconnect();
            wsClient = null;
        }
        return;
    }
    
    const authServer = settings.authserver || 'ws://localhost:5000';
    const username = settings.authusername || 'admin';
    const password = settings.authpassword || 'admin123';
    
    console.log('[Auth] Начало авторизации через WebSocket...');
    
    // Создаем новый клиент если его нет
    if (!wsClient) {
        wsClient = new ProxyWebSocketClient();
    }
    
    // Функция для добавления IP (вызывается после успешной авторизации)
    const addCurrentIP = async () => {
        try {
            // Получаем текущий IP через WebSocket API
            const currentIP = await wsClient.getCurrentIp();
            console.log('[Auth] Текущий IP:', currentIP);
            
            if (!currentIP || currentIP === 'Не удалось определить IP') {
                console.error('[Auth] Не удалось получить IP адрес');
                return;
            }
            
            // Добавляем IP в разрешенные
            const result = await wsClient.addIp(currentIP.trim());
            console.log('[Auth] ✓', result.message || 'IP обработан');
            
            // Опционально: получаем список всех разрешенных IP
            const allowedIps = await wsClient.getAllowedIps();
            console.log('[Auth] Список разрешенных IP:', allowedIps);
            
        } catch (error) {
            console.log('[Auth] Ошибка добавления IP:', error.message || error);
        }
    };
    
    // Устанавливаем callback для автоматического добавления IP после авторизации
    wsClient.onAuthenticated(() => {
        console.log('[Auth] Callback: авторизация выполнена, добавляем IP...');
        addCurrentIP();
    });
    
    // Подключаемся к серверу (не блокируем выполнение при ошибке)
    if (!wsClient.isConnected) {
        // Запускаем подключение в фоне, оно будет переподключаться автоматически
        wsClient.connect(authServer, { username, password }).then(() => {
            console.log('[Auth] ✓ Подключено к серверу');
            // Авторизация и добавление IP произойдет автоматически через callback
        }).catch((error) => {
            console.log('[Auth] Не удалось подключиться, ожидание автоматического переподключения...');
            // Переподключение запустится автоматически внутри connect()
        });
    } else if (!wsClient.isAuthenticated) {
        // Уже подключены, но не авторизованы - выполняем авторизацию
        wsClient.authenticate(username, password).catch(e => {
            console.log('[Auth] Ошибка авторизации:', e.message);
        });
    } else {
        // Уже подключены и авторизованы - просто добавляем IP
        addCurrentIP();
    }
}

// Автоматическая авторизация при запуске расширения
chrome.runtime.onStartup.addListener(() => {
    console.log('Расширение запущено, выполняем авторизацию...');
    setTimeout(authenticateAndAddIP, 2000); // Задержка для стабилизации
});

// Авторизация при установке/обновлении
chrome.runtime.onInstalled.addListener(() => {
    console.log('Расширение установлено/обновлено, выполняем авторизацию...');
    setTimeout(authenticateAndAddIP, 2000);
});

// Авторизация при изменении настроек
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && (changes.authswitch || changes.authserver || changes.authusername || changes.authpassword)) {
        console.log('Настройки авторизации изменены, выполняем авторизацию...');
        setTimeout(authenticateAndAddIP, 1000);
    }
});
