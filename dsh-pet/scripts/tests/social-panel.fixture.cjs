const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await window.loadURL(process.env.SOCIAL_TEST_URL);
});
