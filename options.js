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
    s = s.bypassdomain || "ru\nnet\napi.ipify.org\nifconfig.me\nicanhazip.com\nipinfo.io\nwww.google.com";
    document.querySelector('#bypassdomain').value = s;
});
chrome.storage.local.get(['bypassjsonurl', 'bypassjsonmeta'], s => {
    document.querySelector('#bypassjsonurl').value = s.bypassjsonurl || '';
    const status = document.querySelector('#bypassjsonstatus');
    if (status && s.bypassjsonmeta) {
        const meta = s.bypassjsonmeta;
        status.textContent = meta.error
            ? `JSON: error — ${meta.error}`
            : `JSON: ${meta.count || 0} entries, updated ${meta.updatedAt || 'never'}`;
    }
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
    s = s.authserver || 'ws://127.0.0.1:8765';
    document.querySelector('#authserver').value = s;
});
function setTokenVisible(visible) {
    const input = document.querySelector('#authtoken');
    const toggleTokenBtn = document.querySelector('#toggleTokenBtn');
    if (!input || !toggleTokenBtn) return;

    input.type = visible ? 'text' : 'password';
    toggleTokenBtn.classList.toggle('is-visible', visible);
    toggleTokenBtn.setAttribute('aria-label', visible ? 'Hide token' : 'Show token');
    toggleTokenBtn.title = visible ? 'Hide token' : 'Show token';
}

chrome.storage.local.get('authtoken', s => {
    document.querySelector('#authtoken').value = s.authtoken || '';
});

const toggleTokenBtn = document.querySelector('#toggleTokenBtn');
if (toggleTokenBtn) {
    toggleTokenBtn.addEventListener('click', () => {
        const input = document.querySelector('#authtoken');
        setTokenVisible(input.type === 'password');
    });
}

document.querySelector('#save').addEventListener("click", async (e) => {
    document.querySelector('#save').style.display = 'none';
    document.querySelector('#ing').style.display = 'block';

    var socks5switch = document.querySelector('#socks5switch').checked;
    var socks5server = document.querySelector('#socks5server').value;
    var bypassswitch = document.querySelector('#bypassswitch').checked;
    var bypassdomain = document.querySelector('#bypassdomain').value;
    var bypassjsonurl = document.querySelector('#bypassjsonurl').value.trim();
    var authswitch = document.querySelector('#authswitch').checked;
    var authserver = document.querySelector('#authserver').value;
    var authtoken = document.querySelector('#authtoken').value.trim();

    if(socks5switch){
        if(!/.+:\d+/.test(socks5server)){
            alert("Invalid socks5 proxy address");
            document.querySelector('#save').style.display = 'block';
            document.querySelector('#ing').style.display = 'none';
            return;
        }
    }

    await chrome.storage.local.set({
        socks5switch: socks5switch ? 'on' : 'off',
        socks5server: socks5server,
        authswitch: authswitch ? 'on' : 'off',
        authserver: authserver,
        authtoken: authtoken,
        bypassswitch: bypassswitch ? 'on' : 'off',
        bypassdomain: bypassdomain,
        bypassjsonurl: bypassjsonurl,
    });

    chrome.runtime.sendMessage({ action: "apply_proxy" }, (response) => {
        const status = document.querySelector('#bypassjsonstatus');
        if (status && response) {
            if (response.jsonError) {
                status.textContent = `JSON: error — ${response.jsonError}`;
            } else if (response.jsonCount != null) {
                status.textContent = `JSON: ${response.jsonCount} entries applied`;
            } else if (!bypassjsonurl) {
                status.textContent = '';
            }
        }
        setTimeout(()=>{
            document.querySelector('#save').style.display = 'block';
            document.querySelector('#ing').style.display = 'none';
        }, 800);
    });
});
