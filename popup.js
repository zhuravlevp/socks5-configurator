document.addEventListener("DOMContentLoaded", function () {
  updateConnectionStatus();
  setInterval(updateConnectionStatus, 5000);
});

function updateConnectionStatus() {
  chrome.runtime.sendMessage({ action: "get_connection_status" }, function (response) {
    if (chrome.runtime.lastError) {
      console.error("Ошибка получения статуса:", chrome.runtime.lastError);
      return;
    }

    const statusElement = document.getElementById("connection-status");
    const ipElement = document.getElementById("current-ip");

    if (statusElement) {
      const isConnected = response.wsState === "OPEN";
      if (isConnected) {
        statusElement.textContent = "Connected";
        statusElement.className = "status-connect";
      } else {
        const attempts = response.reconnectAttempts || 0;
        statusElement.textContent = `Disconnected (${attempts})`;
        statusElement.className = "status-disconnect";
      }
    }

    if (ipElement) {
      ipElement.textContent = response.currentIP || "неизвестен";
    }
  });
}
