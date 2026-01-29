// popup.js или options.js
document.addEventListener('DOMContentLoaded', function() {
  updateConnectionStatus();
  
  // Обновляем статус каждые 5 секунд
  setInterval(updateConnectionStatus, 5000);
  
  // Кнопка для ручного обновления
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', updateConnectionStatus);
  }
});

function updateConnectionStatus() {
  chrome.runtime.sendMessage({action: "get_connection_status"}, function(response) {
    if (chrome.runtime.lastError) {
      console.error("Ошибка получения статуса:", chrome.runtime.lastError);
      return;
    }
    
    // Обновляем UI
    const statusElement = document.getElementById('connection-status');
    const lastPongElement = document.getElementById('last-pong-time');
    const ipElement = document.getElementById('current-ip');
    const reconnectElement = document.getElementById('reconnect-attempts');
    
    if (statusElement) {
      statusElement.textContent = response.wsState;
      statusElement.className = 'status-' + response.wsState.toLowerCase();
    }
    
    if (lastPongElement) {
      lastPongElement.textContent = response.lastPongTime;
    }
    
    if (ipElement) {
      ipElement.textContent = response.currentIP || 'неизвестен';
    }
    
    if (reconnectElement) {
      reconnectElement.textContent = response.reconnectAttempts;
    }
  });
}