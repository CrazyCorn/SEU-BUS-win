const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('path');

let tray = null;
let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 420,
    height: 860,
    frame: false,
    resizable: false,
    transparent: true,
    backgroundColor: '#00000000',
    skipTaskbar: true, // 不在任务栏中显示
    type: 'desktop',
    focusable: false,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.loadFile(path.join(__dirname, 'public', 'index.html'));



  win.on('closed', () => {
    win = null;
  });
}

function createTray() {
  // 使用默认图标，如果需要自定义，请替换路径
  const icon = nativeImage.createFromPath(path.join(__dirname, 'public', 'school.ico')); 
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示/隐藏',
      click: () => {
        win.isVisible() ? win.hide() : win.show();
      }
    },
    {
      label: '退出',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('SEU-BUS 桌面小部件');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    win.isVisible() ? win.hide() : win.show();
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // 在 macOS 上，除非用户用 Cmd + Q 确定退出，
  // 否则应用及其菜单栏会保持激活状态。
  if (process.platform !== 'darwin') {
    app.quit();
  }
});