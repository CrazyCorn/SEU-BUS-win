const { contextBridge } = require('electron');
const fs = require('fs');
const path = require('path');

const schedulePath = path.join(__dirname, 'public', '时间表.json');

contextBridge.exposeInMainWorld('appData', {
  loadSchedules: async () => {
    const data = await fs.promises.readFile(schedulePath, 'utf-8');
    return JSON.parse(data);
  }
});