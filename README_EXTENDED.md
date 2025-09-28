# Socks5 Configurator with 3proxy Integration

Configure your browser with socks5 proxy and automatic IP authorization

## 🚀 Features

- **Socks5 Proxy Configuration** - Easy proxy setup
- **Bypass List Support** - Custom domain bypassing
- **3proxy Integration** - Automatic IP authorization
- **Auto Authentication** - Seamless server integration
- **Clean UI** - Modern and intuitive interface

## 🔧 New Features (3proxy Integration)

### Automatic IP Authorization
- Automatically detects your current IP address
- Authenticates with 3proxy Manager server
- Adds your IP to the allowed list
- Works on browser startup and settings changes

### Authentication Settings
- **Auth Server URL** - 3proxy Manager server address
- **Username/Password** - Login credentials
- **Auto-enable** - Automatic authorization on startup

## 📦 Installation

### Method 1: Load Unpacked Extension
1. Download this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select this folder

### Method 2: From Source
1. Clone the repository
2. Open Chrome extensions page
3. Enable "Developer mode"
4. Load the extension folder

## 🛠️ Setup with 3proxy Manager

### 1. Start 3proxy Manager Server
```bash
cd auth-proxy
pip install -r requirements.txt
python app.py
```

### 2. Configure Extension
1. Click the extension icon
2. Fill in authentication settings:
   - **Auth Server URL**: http://localhost:5000
   - **Username**: admin
   - **Password**: admin123
3. Configure your socks5 proxy
4. Click "Save"

### 3. Automatic Authorization
The extension will automatically:
- ✅ Detect your current IP
- ✅ Authenticate with the server
- ✅ Add your IP to allowed list
- ✅ Configure proxy settings

## 📋 Usage

### Basic Configuration
1. **Socks5 Proxy** - Enter your proxy server (e.g., 127.0.0.1:1080)
2. **Bypass List** - Add domains to bypass (optional)
3. **Authentication** - Configure server connection
4. **Save** - Apply all settings

### Advanced Features
- **Auto IP Detection** - Automatically gets your external IP
- **Server Integration** - Connects to 3proxy Manager
- **Session Management** - Handles authentication cookies
- **Error Handling** - Comprehensive error reporting

## 🔍 Troubleshooting

### Common Issues
1. **Server Connection Failed**
   - Check if 3proxy Manager is running
   - Verify server URL in settings
   - Check network connectivity

2. **Authentication Failed**
   - Verify username/password
   - Check server logs
   - Ensure server is accessible

3. **IP Not Added**
   - Check browser console for errors
   - Verify server permissions
   - Check network connectivity

### Debug Mode
1. Open Chrome DevTools (F12)
2. Go to Console tab
3. Look for extension messages:
   - "Расширение запущено, выполняем авторизацию..."
   - "Текущий IP: xxx.xxx.xxx.xxx"
   - "IP добавлен: IP xxx.xxx.xxx.xxx добавлен в разрешенные"

## 🔒 Security

### Recommendations
- Change default passwords
- Use HTTPS in production
- Restrict server access
- Regular security updates

### Permissions
- `storage` - Save settings
- `proxy` - Configure proxy
- `cookies` - Handle sessions
- `activeTab` - Access tabs

## 📚 Documentation

- [Integration Guide](INTEGRATION.md) - Detailed integration steps
- [3proxy Manager](../README.md) - Server documentation
- [API Reference](../USAGE.md) - API endpoints

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

- Original Socks5 Configurator by txthinking
- 3proxy Manager integration
- Chrome Extensions API
- Modern web technologies
