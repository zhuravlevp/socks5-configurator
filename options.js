document.querySelector('#ing').style.display='none';

if(navigator.language.toLowerCase().startsWith("zh-")){
    document.querySelector('#brook').style.display = 'none';
    document.querySelector('#shiliew').style.display = 'none';
}else{
    document.querySelector('#brookzh').style.display = 'none';
    document.querySelector('#shiliewzh').style.display = 'none';
}

chrome.storage.local.get('socks5switch', s => {
    s = s.socks5switch || 'on';
    if(s == "on"){
        document.querySelector('#socks5switch').checked = true;
    }
    if(s == "off"){
        document.querySelector('#socks5switch').checked = false;
    }
});
chrome.storage.local.get('socks5server', s => {
    s = s.socks5server || '';
    document.querySelector('#socks5server').value = s;
});
chrome.storage.local.get('bypassswitch', s =>{
    s = s.bypassswitch || 'on';
    if(s == "on"){
        document.querySelector('#bypassswitch').checked = true;
    }
    if(s == "off"){
        document.querySelector('#bypassswitch').checked = false;
    }
});
chrome.storage.local.get('bypassdomain', s =>{
    s = s.bypassdomain || "ru\nipinfo.io";
    document.querySelector('#bypassdomain').value = s;
});

// Загрузка настроек авторизации
chrome.storage.local.get('authswitch', s => {
    s = s.authswitch || 'on';
    if(s == "on"){
        document.querySelector('#authswitch').checked = true;
    }
    if(s == "off"){
        document.querySelector('#authswitch').checked = false;
    }
});
chrome.storage.local.get('authserver', s => {
    s = s.authserver || 'ws://localhost:5000';
    document.querySelector('#authserver').value = s;
});
chrome.storage.local.get('authusername', s => {
    s = s.authusername || 'admin';
    document.querySelector('#authusername').value = s;
});
chrome.storage.local.get('authpassword', s => {
    s = s.authpassword || 'admin123';
    document.querySelector('#authpassword').value = s;
});

// Функция тестирования WebSocket соединения
document.querySelector('#testConnection').addEventListener('click', async () => {
    const authserver = document.querySelector('#authserver').value || 'ws://localhost:5000';
    const authusername = document.querySelector('#authusername').value || 'admin';
    const authpassword = document.querySelector('#authpassword').value || 'admin123';
    const statusElement = document.querySelector('#testStatus');
    
    statusElement.textContent = 'Тестирование...';
    statusElement.style.color = 'blue';
    
    let wsClient = null;
    
    try {
        // Создаем WebSocket клиент
        wsClient = new ProxyWebSocketClient();
        
        // Отключаем автопереподключение для теста
        wsClient.disableAutoReconnect();
        
        // Подключаемся
        statusElement.textContent = 'Подключение...';
        await wsClient.connect(authserver);
        
        // Авторизуемся
        statusElement.textContent = 'Авторизация...';
        await wsClient.authenticate(authusername, authpassword);
        
        // Тестируем получение IP
        statusElement.textContent = 'Получение IP...';
        const currentIp = await wsClient.getCurrentIp();
        
        // Успех!
        statusElement.textContent = `✓ Успешно! Текущий IP: ${currentIp}`;
        statusElement.style.color = 'green';
        
    } catch (error) {
        console.error('Ошибка тестирования:', error);
        statusElement.textContent = `✗ Ошибка: ${error.message}`;
        statusElement.style.color = 'red';
    } finally {
        // Отключаемся в любом случае
        if (wsClient) {
            wsClient.disconnect();
        }
    }
});

document.querySelector('#save').addEventListener("click", async (e) => {
    document.querySelector('#save').style.display = 'none';
    document.querySelector('#ing').style.display = 'block';

    var socks5switch = document.querySelector('#socks5switch').checked;
    var socks5server = document.querySelector('#socks5server').value;
    var bypassswitch = document.querySelector('#bypassswitch').checked;
    var bypassdomain = document.querySelector('#bypassdomain').value;
    var authswitch = document.querySelector('#authswitch').checked;
    var authserver = document.querySelector('#authserver').value;
    var authusername = document.querySelector('#authusername').value;
    var authpassword = document.querySelector('#authpassword').value;

    if(socks5switch){
        if(!/.+:\d+/.test(socks5server)){
            alert("Invalid socks5 proxy address");
            document.querySelector('#save').style.display = 'block';
            document.querySelector('#ing').style.display = 'none';
            return;
        }
    }
    chrome.storage.local.set({"socks5switch": socks5switch ? 'on' : 'off'});
    chrome.storage.local.set({"socks5server": socks5server});
    chrome.storage.local.set({"authswitch": authswitch ? 'on' : 'off'});
    chrome.storage.local.set({"authserver": authserver});
    chrome.storage.local.set({"authusername": authusername});
    chrome.storage.local.set({"authpassword": authpassword});
    var l = [
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
    if(bypassswitch){
        var l1 = bypassdomain.trim().split('\n');
        l1.forEach(v=>{
            l.push(v.trim());
            l.push("*."+v.trim());
        });
    }
    chrome.storage.local.set({"bypassswitch": bypassswitch ? 'on' : 'off'});
    chrome.storage.local.set({"bypassdomain": bypassdomain});

    if(!socks5switch){
        chrome.proxy.settings.set({
            value: {
                mode: "system",
            },
        },()=>{
            setTimeout(()=>{
                document.querySelector('#save').style.display = 'block';
                document.querySelector('#ing').style.display = 'none';
            }, 2000);
        });
        return;
    }

    var host = socks5server.substring(0, socks5server.lastIndexOf(':')).replace('[', '').replace(']', '');
    var port = socks5server.substring(socks5server.lastIndexOf(':')+1);
    chrome.proxy.settings.set({
        value: {
            mode: "fixed_servers",
            rules: {
                singleProxy: {
                    scheme: "socks5",
                    host: host,
                    port: parseInt(port),
                },
                bypassList: l,
            },
        },
    },()=>{
        setTimeout(()=>{
            document.querySelector('#save').style.display = 'block';
            document.querySelector('#ing').style.display = 'none';
        }, 1000);
    });
});
