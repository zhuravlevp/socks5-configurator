/**
 * WebSocket клиент для работы с Auth Proxy API
 */

class ProxyWebSocketClient {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.isAuthenticated = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = Infinity; // Бесконечные попытки переподключения
        this.reconnectDelay = 1000; // Попытка каждую секунду
        this.messageQueue = [];
        this.responseHandlers = new Map();
        this.messageId = 0;
        this.serverUrl = null;
        this.credentials = null;
        this.heartbeatInterval = null;
        this.heartbeatTimeout = null;
        this.heartbeatIntervalMs = 30000; // Проверка каждые 30 секунд
        this.heartbeatTimeoutMs = 10000; // Таймаут ответа 10 секунд
        this.shouldReconnect = true; // Флаг для управления переподключением
        this.onAuthenticatedCallback = null; // Callback после успешной авторизации
    }

    /**
     * Подключение к WebSocket серверу
     */
    async connect(url, credentials = null) {
        // Сохраняем URL и credentials для переподключения
        this.serverUrl = url;
        if (credentials) {
            this.credentials = credentials;
        }
        
        return new Promise((resolve, reject) => {
            try {
                // Преобразуем HTTP URL в WebSocket URL если необходимо
                const wsUrl = this.convertToWebSocketUrl(url);
                
                console.log(`[WebSocket] Подключение к ${wsUrl}... (попытка ${this.reconnectAttempts + 1})`);
                
                this.ws = new WebSocket(wsUrl);
                
                let connectionResolved = false;
                
                this.ws.onopen = () => {
                    console.log('[WebSocket] ✓ Соединение установлено');
                    this.isConnected = true;
                    this.reconnectAttempts = 0;
                    connectionResolved = true;
                    
                    // Запускаем heartbeat
                    this.startHeartbeat();
                    
                    // Автоматическая повторная авторизация если есть credentials
                    if (this.credentials && !this.isAuthenticated) {
                        this.authenticate(this.credentials.username, this.credentials.password)
                            .then(() => {
                                console.log('[WebSocket] ✓ Повторная авторизация успешна');
                                // Вызываем callback после успешной авторизации
                                if (this.onAuthenticatedCallback) {
                                    this.onAuthenticatedCallback();
                                }
                            })
                            .catch(e => {
                                console.error('[WebSocket] Ошибка повторной авторизации:', e);
                            });
                    }
                    
                    // Отправляем отложенные сообщения
                    this.flushMessageQueue();
                    
                    resolve();
                };
                
                this.ws.onmessage = (event) => {
                    this.handleMessage(event.data);
                };
                
                this.ws.onerror = (error) => {
                    console.log('[WebSocket] Ошибка соединения');
                    // Не делаем reject здесь, так как onclose будет вызван автоматически
                };
                
                this.ws.onclose = (event) => {
                    console.log('[WebSocket] Соединение закрыто');
                    this.isConnected = false;
                    this.isAuthenticated = false;
                    
                    // Останавливаем heartbeat
                    this.stopHeartbeat();
                    
                    // Если это была первая попытка и не удалось подключиться
                    if (!connectionResolved) {
                        connectionResolved = true;
                        reject(new Error('Connection failed'));
                    }
                    
                    // Попытка переподключения если разрешено
                    if (this.shouldReconnect) {
                        this.reconnectAttempts++;
                        const delay = this.reconnectDelay;
                        console.log(`[WebSocket] Переподключение через ${delay}ms...`);
                        setTimeout(() => {
                            if (this.shouldReconnect) {
                                this.connect(this.serverUrl, this.credentials).catch(e => {
                                    // Ошибка логируется, но не прерывает процесс переподключения
                                    console.log('[WebSocket] Попытка переподключения...');
                                });
                            }
                        }, delay);
                    }
                };
                
                // Таймаут для первого подключения
                setTimeout(() => {
                    if (!connectionResolved && !this.isConnected) {
                        connectionResolved = true;
                        reject(new Error('Connection timeout'));
                        if (this.ws) {
                            this.ws.close();
                        }
                    }
                }, 10000);
                
            } catch (error) {
                console.error('[WebSocket] Ошибка создания соединения:', error);
                reject(error);
                
                // Запускаем переподключение даже при ошибке создания
                if (this.shouldReconnect) {
                    this.reconnectAttempts++;
                    setTimeout(() => {
                        if (this.shouldReconnect) {
                            this.connect(this.serverUrl, this.credentials).catch(e => {
                                console.log('[WebSocket] Попытка переподключения...');
                            });
                        }
                    }, this.reconnectDelay);
                }
            }
        });
    }

    /**
     * Преобразование HTTP URL в WebSocket URL
     */
    convertToWebSocketUrl(url) {
        // Если уже WebSocket URL, возвращаем как есть
        if (url.startsWith('ws://') || url.startsWith('wss://')) {
            return url.endsWith('/ws') ? url : `${url}/ws`;
        }
        
        // Преобразуем HTTP в WebSocket
        let wsUrl = url.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://');
        
        // Добавляем /ws если нужно
        if (!wsUrl.endsWith('/ws')) {
            wsUrl = `${wsUrl}/ws`;
        }
        
        return wsUrl;
    }

    /**
     * Обработка входящих сообщений
     */
    handleMessage(data) {
        try {
            const message = JSON.parse(data);
            console.log('[WebSocket] Получено:', message);
            
            // Вызываем обработчики для конкретных типов сообщений
            const handlers = this.responseHandlers.get(message.type);
            if (handlers && handlers.length > 0) {
                handlers.forEach(handler => handler(message));
            }
            
        } catch (error) {
            console.error('[WebSocket] Ошибка парсинга сообщения:', error);
        }
    }

    /**
     * Отправка сообщения
     */
    sendMessage(message) {
        if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn('[WebSocket] Соединение не готово, добавляем в очередь');
            this.messageQueue.push(message);
            return;
        }
        
        const messageStr = JSON.stringify(message);
        console.log('[WebSocket] Отправка:', message);
        this.ws.send(messageStr);
    }

    /**
     * Отправка отложенных сообщений
     */
    flushMessageQueue() {
        if (this.messageQueue.length > 0) {
            console.log(`[WebSocket] Отправка ${this.messageQueue.length} отложенных сообщений`);
            this.messageQueue.forEach(message => this.sendMessage(message));
            this.messageQueue = [];
        }
    }

    /**
     * Регистрация обработчика ответов
     */
    onMessage(type, handler) {
        if (!this.responseHandlers.has(type)) {
            this.responseHandlers.set(type, []);
        }
        this.responseHandlers.get(type).push(handler);
    }

    /**
     * Запуск heartbeat (проверка живости соединения)
     */
    startHeartbeat() {
        this.stopHeartbeat(); // Останавливаем предыдущий если был
        
        this.heartbeatInterval = setInterval(() => {
            if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
                console.log('[WebSocket] 💓 Heartbeat: проверка соединения...');
                
                // Отправляем ping через получение списка IP (легкая операция)
                if (this.isAuthenticated) {
                    this.getAllowedIps().then(() => {
                        console.log('[WebSocket] ✓ Сервер отвечает');
                    }).catch((e) => {
                        console.error('[WebSocket] ✗ Сервер не отвечает:', e.message);
                        // Закрываем соединение для принудительного переподключения
                        if (this.ws) {
                            this.ws.close();
                        }
                    });
                }
            }
        }, this.heartbeatIntervalMs);
    }

    /**
     * Остановка heartbeat
     */
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        if (this.heartbeatTimeout) {
            clearTimeout(this.heartbeatTimeout);
            this.heartbeatTimeout = null;
        }
    }

    /**
     * Установка callback для вызова после успешной авторизации
     */
    onAuthenticated(callback) {
        this.onAuthenticatedCallback = callback;
    }

    /**
     * Авторизация
     */
    async authenticate(username, password) {
        // Сохраняем credentials для автоматической повторной авторизации
        this.credentials = { username, password };
        
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout: авторизация не завершена'));
            }, 10000);

            this.onMessage('auth_response', (response) => {
                clearTimeout(timeout);
                
                if (response.success) {
                    this.isAuthenticated = true;
                    console.log(`[WebSocket] Авторизован как ${response.user}`);
                    resolve(response);
                    
                    // Вызываем callback после успешной авторизации
                    if (this.onAuthenticatedCallback) {
                        this.onAuthenticatedCallback();
                    }
                } else {
                    console.error('[WebSocket] Ошибка авторизации:', response.message);
                    reject(new Error(response.message));
                }
            });

            this.sendMessage({
                type: 'auth',
                username: username,
                password: password
            });
        });
    }

    /**
     * Получение текущего IP
     */
    async getCurrentIp() {
        return new Promise((resolve, reject) => {
            if (!this.isAuthenticated) {
                reject(new Error('Требуется авторизация'));
                return;
            }

            const timeout = setTimeout(() => {
                reject(new Error('Timeout: получение IP не завершено'));
            }, 10000);

            this.onMessage('current_ip_response', (response) => {
                clearTimeout(timeout);
                
                if (response.success) {
                    console.log('[WebSocket] Текущий IP:', response.ip);
                    resolve(response.ip);
                } else {
                    reject(new Error('Ошибка получения IP'));
                }
            });

            this.sendMessage({
                type: 'get_current_ip'
            });
        });
    }

    /**
     * Добавление IP в разрешенные
     */
    async addIp(ip) {
        return new Promise((resolve, reject) => {
            if (!this.isAuthenticated) {
                reject(new Error('Требуется авторизация'));
                return;
            }

            const timeout = setTimeout(() => {
                reject(new Error('Timeout: добавление IP не завершено'));
            }, 10000);

            this.onMessage('add_ip_response', (response) => {
                clearTimeout(timeout);
                
                if (response.success) {
                    console.log('[WebSocket] IP добавлен:', response.message);
                    resolve(response);
                } else {
                    console.log('[WebSocket] ℹ IP уже в списке разрешенных');
                    resolve(response); // Возвращаем как успех
                }
            });

            this.sendMessage({
                type: 'add_ip',
                ip: ip
            });
        });
    }

    /**
     * Получение списка разрешенных IP
     */
    async getAllowedIps() {
        return new Promise((resolve, reject) => {
            if (!this.isAuthenticated) {
                reject(new Error('Требуется авторизация'));
                return;
            }

            const timeout = setTimeout(() => {
                reject(new Error('Timeout: получение списка IP не завершено'));
            }, 10000);

            this.onMessage('allowed_ips_response', (response) => {
                clearTimeout(timeout);
                
                if (response.success) {
                    console.log('[WebSocket] Получен список IP:', response.ips);
                    resolve(response.ips);
                } else {
                    reject(new Error('Ошибка получения списка IP'));
                }
            });

            this.sendMessage({
                type: 'get_allowed_ips'
            });
        });
    }

    /**
     * Обработка ошибок от сервера
     */
    handleError() {
        this.onMessage('error', (response) => {
            console.error('[WebSocket] Ошибка сервера:', response.message);
        });
    }

    /**
     * Закрытие соединения
     */
    disconnect() {
        this.shouldReconnect = false; // Отключаем автоматическое переподключение
        this.stopHeartbeat(); // Останавливаем heartbeat
        
        if (this.ws) {
            this.ws.close();
            this.ws = null;
            this.isConnected = false;
            this.isAuthenticated = false;
        }
        
        console.log('[WebSocket] Отключено (автопереподключение выключено)');
    }

    /**
     * Включение автоматического переподключения
     */
    enableAutoReconnect() {
        this.shouldReconnect = true;
        console.log('[WebSocket] Автопереподключение включено');
    }

    /**
     * Отключение автоматического переподключения
     */
    disableAutoReconnect() {
        this.shouldReconnect = false;
        console.log('[WebSocket] Автопереподключение отключено');
    }
}

// Экспорт для использования в других модулях
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ProxyWebSocketClient;
}

