chrome.action.onClicked.addListener(() => {
    chrome.runtime.openOptionsPage();
});

// Функция для получения текущего IP адреса
async function getCurrentIP() {
    try {
        const response = await fetch('https://ipinfo.io/ip');
        return await response.text();
    } catch (error) {
        console.error('Ошибка получения IP:', error);
        return null;
    }
}

// Функция авторизации и добавления IP
async function authenticateAndAddIP() {
    try {
        // Получаем настройки из storage
        const settings = await chrome.storage.local.get([
            'authswitch', 'authserver', 'authusername', 'authpassword'
        ]);
        
        if (settings.authswitch !== 'on') {
            console.log('Авторизация отключена');
            return;
        }
        
        const authServer = settings.authserver || 'http://localhost:5000';
        const username = settings.authusername || 'admin';
        const password = settings.authpassword || 'admin123';
        
        // Получаем текущий IP
        const currentIP = await getCurrentIP();
        if (!currentIP) {
            console.error('Не удалось получить IP адрес');
            return;
        }
        
        console.log('Текущий IP:', currentIP);
        
        // Выполняем авторизацию
        const loginResponse = await fetch(`${authServer}/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`
        });
        
        if (!loginResponse.ok) {
            console.error('Ошибка авторизации:', loginResponse.status);
            return;
        }
        
        // Получаем cookies для сессии
        const cookies = await chrome.cookies.getAll({url: authServer});
        const sessionCookie = cookies.find(cookie => cookie.name === 'session');
        
        if (!sessionCookie) {
            console.error('Сессия не найдена');
            return;
        }
        
        // Добавляем IP в разрешенные
        const addIPResponse = await fetch(`${authServer}/allow_ip`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': `session=${sessionCookie.value}`
            },
            body: JSON.stringify({ip: currentIP.trim()})
        });
        
        if (addIPResponse.ok) {
            const result = await addIPResponse.json();
            console.log('IP добавлен:', result.message);
        } else {
            console.error('Ошибка добавления IP:', addIPResponse.status);
        }
        
    } catch (error) {
        console.error('Ошибка авторизации и добавления IP:', error);
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
