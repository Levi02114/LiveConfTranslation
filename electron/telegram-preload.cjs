/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("telegramSetup", {
  close: () => ipcRenderer.invoke("telegram:close"),
  copy: (value) => ipcRenderer.invoke("telegram:copy", value),
  getState: () => ipcRenderer.invoke("telegram:get-state"),
  openBotFather: () => ipcRenderer.invoke("telegram:open-bot-father"),
  pair: (mode) => ipcRenderer.invoke("telegram:pair", mode),
  removeChat: (chatId) => ipcRenderer.invoke("telegram:remove-chat", chatId),
  setAutoTunnel: (enabled) => ipcRenderer.invoke("telegram:set-auto-tunnel", enabled),
  setManagement: (chatId, enabled) => ipcRenderer.invoke("telegram:set-management", chatId, enabled),
  retryReceiver: () => ipcRenderer.invoke("telegram:retry-receiver"),
  onState: (handler) => {
    const listener = (_event, state) => handler(state);
    ipcRenderer.on("telegram:state", listener);
    return () => ipcRenderer.removeListener("telegram:state", listener);
  },
  testChat: (chatId) => ipcRenderer.invoke("telegram:test-chat", chatId),
  verify: (token) => ipcRenderer.invoke("telegram:verify", token),
});
