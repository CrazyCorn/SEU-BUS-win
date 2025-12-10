
// 1. 数据库
let schedules = {};
// 提醒列表: { key: intervalId }
let alarmList = {};

// 2. 拉数据：返回 Promise，方便 await
async function loadScheduleData() {
    try {
        let raw;
        if (window.appData && typeof window.appData.loadSchedules === 'function') {
            raw = await window.appData.loadSchedules();
        } else {
            const res = await fetch('./时间表.json');
            if (!res.ok) throw new Error(res.status);
            raw = await res.json();
        }
        schedules = expandLoopBuses(raw);
        window.schedules = schedules; // 设置为全局变量，供邮件提醒功能使用
        console.log('时刻表数据已加载并展开');
    } catch (e) {
        console.error('❌ 加载时刻表失败:', e);
        schedules = { workday: {}, holiday: {} };
        window.schedules = schedules;
    }
}

/* ---------- 新增：区间循环拆班 (保留原逻辑) ---------- */
function expandLoopBuses(src) {
    const out = { workday: {}, holiday: {} };
    ['workday', 'holiday'].forEach(day => {
        out[day] = {};
        Object.keys(src[day] || {}).forEach(stop => {
            out[day][stop] = [];
            (src[day][stop] || []).forEach(rec => {
                if (rec.time.includes('-')) {
                    const [start, end] = rec.time.split('-');
                    let t = timeToMin(start);
                    const endMin = timeToMin(end);
                    // 确保循环是 5 分钟一班，如果需要 10 分钟，修改 5 为 10
                    while (t <= endMin) {
                        out[day][stop].push({
                            time: minToTime(t),
                            destination: rec.destination,
                            notes: rec.notes,
                            isLoop: true // 标记为循环班次
                        });
                        t += 5;
                    }
                } else {
                    out[day][stop].push(rec);
                }
            });
        });
    });
    return out;
}

/* 工具：HH:mm ↔ 分钟 (保留原逻辑) */
function timeToMin(str) {
    const [h, m] = str.split(':').map(Number);
    return h * 60 + m;
}
function minToTime(min) {
    const h = String(Math.floor(min / 60)).padStart(2, '0');
    const m = String(min % 60).padStart(2, '0');
    return `${h}:${m}`;
}
/* 工具：生成唯一ID */
function generateBusKey(bus, loc) {
    // 用于追踪提醒
    return `${loc}-${bus.time}-${bus.destination}`;
}

// 3. 页面入口：立刻拉数据，拉完再初始化 UI
document.addEventListener('DOMContentLoaded', async () => {
    // 3-1 先拿数据
    await loadScheduleData();

    // 3-2 再开始渲染
    const clockEl = document.getElementById('clock');
    const dayTypeEls = {
        workday: document.getElementById('workday'),
        holiday: document.getElementById('holiday')
    };
    const dateRangeEls = {
        today: document.getElementById('date-today'),
        tomorrow: document.getElementById('date-tomorrow')
    };
    const modeEls = {
        realtime: document.getElementById('mode-realtime'),
        destination: document.getElementById('mode-destination'),
        all: document.getElementById('mode-all')
    };
    const locationSel = document.getElementById('location-select');
    const destinationSel = document.getElementById('destination-select');
    const realtimeControls = document.getElementById('realtime-controls');
    const destinationControls = document.getElementById('destination-controls');
    const resultsDiv = document.getElementById('results');
    const allSchedulesDiv = document.getElementById('all-schedules-container');
    const resultsTitle = resultsDiv.querySelector('h2');

    const busCard1 = document.getElementById('bus-card-1');
    const busCard2 = document.getElementById('bus-card-2');

    // 【新增DOM变量】用于所有时刻表模式的筛选
    const allSchedulesControls = document.getElementById('all-schedules-controls');
    const allLocationSel = document.getElementById('all-location-select');

    let currentMode = 'realtime';
    let mainInterval;

    /* ====================================================
    【核心函数】班次提醒核心逻辑 (setAlarm) - 保持PC端通知，移动端报错
    ====================================================
    */
    window.setAlarm = function (btn, busKey, busTime, busDest, busLoc) {
        const card = btn.closest('.bus-card');
        const inputGroup = card.querySelector('.alarm-input-group');
        const alarmBtn = card.querySelector('.set-alarm-btn');

        // 确保点击的是确定按钮，获取输入值
        const minutesInput = inputGroup.querySelector('#alarm-minute-input');
        const minutes = parseInt(minutesInput.value, 10);

        const now = new Date();
        const [h, m] = busTime.split(':').map(Number);
        const busDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);

        // 计算提醒时间
        const alarmTime = busDate.getTime() - (minutes * 60 * 1000);
        const delayMs = alarmTime - now.getTime();

        // 隐藏输入框
        inputGroup.style.display = 'none';

        // 提前提醒时间已过
        if (delayMs <= 0) {
            alarmBtn.classList.remove('is-set');
            alarmBtn.textContent = '设置提醒';
            alert('❌ 提醒设置失败！\n\n该班车时间已过，无法设置提醒。');
            return;
        }

        // 1. 移动端逻辑：明确提示不支持
        const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        if (isMobile) {
            alert('❌ 提醒设置失败！\n\n移动端浏览器功能受限，预约提醒功能暂未支持。\n\n请在 PC 端浏览器上使用此功能。');
            return;
        }

        // 2. PC/桌面端逻辑：使用 Notification API

        // 清除旧的定时器 (如果有)
        clearTimeout(alarmList[busKey]);
        delete alarmList[busKey];

        // 检查权限
        if (Notification.permission === 'denied') {
            alert('❌ 提醒设置失败！\n\n浏览器通知权限被拒绝。请在浏览器设置中开启通知权限。');
            return;
        }

        if (Notification.permission === 'default') {
            Notification.requestPermission().then(permission => {
                if (permission === 'granted') {
                    // 权限通过，重新尝试设置
                    window.setAlarm(btn, busKey, busTime, busDest, busLoc);
                } else {
                    alert('❌ 提醒设置失败！\n\n您拒绝了浏览器通知授权，PC端提醒功能无法使用。');
                }
            });
            return; // 等待授权结果
        }


        // 正式设置定时器 (权限已granted)
        alarmList[busKey] = setTimeout(() => {
            new Notification('📢 班车提醒', {
                body: `注意！您设置的 ${busLoc} 开往 ${busDest} 的班车(${busTime}) 将在 ${minutes} 分钟后发车。`,
                icon: 'bus-icon.png' // 可以替换为实际图标路径
            });
            // 移除提醒状态和计时器
            delete alarmList[busKey];
            alarmBtn.classList.remove('is-set');
            alarmBtn.textContent = '设置提醒';
            if (currentMode === 'realtime') updateBusDisplay();
            if (currentMode === 'destination') updateDestinationDisplay();
        }, delayMs);

        // 更新按钮状态
        alarmBtn.classList.add('is-set');
        alarmBtn.textContent = `提醒已设 (提前 ${minutes} 分)`;
        const actualTime = new Date(alarmTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        alert(`✅ 提醒设置成功！

PC 端提醒将于 ${actualTime} 触发。

- 提醒时间: 提前 ${minutes} 分钟
- 班车时间: ${busTime}`);
    };

    // 切换提醒输入框 (原逻辑保留)
    window.toggleAlarmInput = function (btn) {
        const card = btn.closest('.bus-card');
        const inputGroup = card.querySelector('.alarm-input-group');
        // 切换显示状态
        inputGroup.style.display = inputGroup.style.display === 'flex' ? 'none' : 'flex';
        // 如果显示了，则让输入框获得焦点
        if (inputGroup.style.display === 'flex') {
            inputGroup.querySelector('#alarm-minute-input').focus();
        }
    };

    /* ---------- 填充下拉菜单 (修改：增加填充所有时刻表筛选器) ---------- */
    function populateLocations() {
        if (!schedules || !schedules.workday) return;
        const day = getDayType();
        const locs = Object.keys(schedules[day]).filter(l => !(day === 'holiday' && l === '纪忠楼'));

        // 1. 填充 实时查询 (Realtime) 的下拉菜单
        const curLoc = locationSel.value;
        locationSel.innerHTML = '';
        locs.forEach(l => {
            const opt = document.createElement('option'); opt.value = l; opt.textContent = l;
            locationSel.appendChild(opt);
        });
        if (locs.includes(curLoc)) {
            locationSel.value = curLoc;
        } else if (locs.includes('无线谷')) {
            locationSel.value = '无线谷';
        }

        // 2. 填充 所有时刻表 (All Schedules) 的下拉菜单
        const curAllLoc = allLocationSel.value;
        allLocationSel.innerHTML = '<option value="ALL">-- 全部地点 --</option>'; // 增加“全部”选项
        locs.forEach(l => {
            const opt = document.createElement('option'); opt.value = l; opt.textContent = l;
            allLocationSel.appendChild(opt);
        });
        // 恢复上次选择，或默认选择“全部”
        if (locs.includes(curAllLoc) || curAllLoc === 'ALL') {
            allLocationSel.value = curAllLoc;
        } else {
            allLocationSel.value = 'ALL';
        }
    }

    function populateDestinations() {
        if (!schedules || !schedules.workday) return;
        const day = getDayType();
        const allDestinations = new Set();

        // 遍历所有站点下的所有班次，收集终点站
        Object.keys(schedules[day]).forEach(stop => {
            (schedules[day][stop] || []).forEach(bus => {
                allDestinations.add(bus.destination);
            });
        });

        const dests = Array.from(allDestinations).sort();
        const cur = destinationSel.value;
        destinationSel.innerHTML = '<option value="">请选择终点</option>'; // 增加提示项
        dests.forEach(d => {
            const opt = document.createElement('option'); opt.value = d; opt.textContent = d;
            destinationSel.appendChild(opt);
        });
        if (dests.includes(cur)) destinationSel.value = cur;
    }

    /* ---------- 模式切换逻辑 (修改：增加所有时刻表筛选器的显示/隐藏) ---------- */
    function updateModeDisplay() {
        currentMode = document.querySelector('input[name="mode"]:checked').value;

        // 1. 切换控件显示
        realtimeControls.style.display = currentMode === 'realtime' ? 'block' : 'none';
        destinationControls.style.display = currentMode === 'destination' ? 'block' : 'none';
        // 【新增】所有时刻表控件
        allSchedulesControls.style.display = currentMode === 'all' ? 'block' : 'none';

        // 2. 切换结果区显示
        resultsDiv.style.display = (currentMode === 'realtime' || currentMode === 'destination') ? 'block' : 'none';
        allSchedulesDiv.style.display = currentMode === 'all' ? 'block' : 'none';

        // 3. 刷新内容
        onSettingsChange();
    }

    /* ---------- 实时查询：按地点查接下来班次 (原逻辑增强) ---------- */
    function updateBusDisplay() {
        resultsTitle.textContent = '接下来的班车：';

        if (!schedules || !schedules.workday) {
            showNoBusMessage(busCard1, '正在加载数据…', true);
            return;
        }

        const day = getDayType(), loc = locationSel.value;
        if (!loc) { showNoBusMessage(busCard1, '请选择一个上车地点', true); return; }

        const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
        const isTomorrow = getDateRange() === 'tomorrow';

        const list = (schedules[day][loc] || []).map(b => {
            const busMin = timeToMin(b.time);
            const wt = isTomorrow ? (24 * 60 - nowMin) + busMin : busMin - nowMin;
            return { ...b, waitTime: wt, busMin: busMin, startLocation: loc };
        }).filter(b => b.waitTime >= 0).sort((a, b) => a.busMin - b.busMin);

        if (!list.length) { showNoBusMessage(busCard1, `今日 ${loc} 已无班车`, true); return; }

        displayRealtimeBus(busCard1, list[0]);
        displayRealtimeBus(busCard2, list[1]);
    }

    // **修改点：提醒按钮移到卡片底部**
    function displayRealtimeBus(el, bus) {
        if (!bus) { showNoBusMessage(el, '已无更多班车', false); return; }

        el.style.display = 'block';
        el.classList.remove('no-bus');

        const busKey = generateBusKey(bus, bus.startLocation);
        const isAlarmSet = alarmList.hasOwnProperty(busKey);

        const notes = (bus.notes || []).map(n => {
            const cls = n.includes('纪忠楼') ? 'highlight' : n.includes('大巴') ? 'important' : '';
            return `<span class="note ${cls}">${n}</span>`;
        }).join(' ') || '<span class="note-placeholder">无特殊备注</span>';

        const waitText = bus.waitTime >= 60
            ? `${Math.floor(bus.waitTime / 60)}小时${bus.waitTime % 60 ? (bus.waitTime % 60) + '分钟' : ''}`
            : `${bus.waitTime}分钟`;

        el.innerHTML = `
                    <span class="bus-time">${bus.time} 发车</span>
                    <p class="wait-time">将在 <strong>${waitText}</strong>后发车</p>
                    
                    <div class="bus-details">
                        <p>开往: <strong>${bus.destination}</strong></p>
                        <div class="notes-container">${notes}</div>
                    </div>
                    
                    <div class="alarm-area">
                        <button class="set-alarm-btn ${isAlarmSet ? 'is-set' : ''}" 
                                onclick="toggleAlarmInput(this)">
                            ${isAlarmSet ? '已设提醒 (点击修改)' : '设置提醒'}
                        </button>
                        
                        <div class="alarm-input-group" style="display:none;">
                            提前<input type="number" value="5" min="1" max="15" id="alarm-minute-input">分钟提醒
                            <button onclick="setAlarm(this, '${busKey}', '${bus.time}', '${bus.destination}', '${bus.startLocation}')">确定</button>
                        </div>
                    </div>
                    `;
    }

    /* ---------- 反向查询：按终点查所有班次 (新增功能 2) ---------- */
    function updateDestinationDisplay() {
        resultsTitle.textContent = '开往所选终点的班车：';

        if (!schedules || !schedules.workday) {
            showNoBusMessage(busCard1, '正在加载数据…', true);
            return;
        }

        const day = getDayType(), destination = destinationSel.value;
        if (!destination) {
            showNoBusMessage(busCard1, '请选择一个终点站', true); return;
        }

        const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
        const isTomorrow = getDateRange() === 'tomorrow';
        let combinedList = [];

        // 遍历所有站点，查找匹配终点的班次
        Object.keys(schedules[day]).forEach(stop => {
            (schedules[day][stop] || []).forEach(b => {
                if (b.destination === destination) {
                    const busMin = timeToMin(b.time);
                    const waitTime = isTomorrow ? (24 * 60 - nowMin) + busMin : busMin - nowMin;

                    if (waitTime >= 0) { // 只显示未发车的班次
                        combinedList.push({
                            ...b,
                            waitTime: waitTime,
                            busMin: busMin,
                            startLocation: stop // 新增起始地点信息
                        });
                    }
                }
            });
        });

        combinedList.sort((a, b) => a.busMin - b.busMin); // 按时间排序

        if (!combinedList.length) {
            showNoBusMessage(busCard1, `今日已无班车开往 ${destination}`, true); busCard2.style.display = 'none'; return;
        }

        // 新的显示逻辑：显示上车地点和终点
        displayReverseBus(busCard1, combinedList[0]);
        displayReverseBus(busCard2, combinedList[1]);
    }

    // **修改点：提醒按钮移到卡片底部**
    function displayReverseBus(el, bus) {
        if (!bus) { showNoBusMessage(el, '已无更多班车', false); return; }

        el.style.display = 'block';
        el.classList.remove('no-bus');

        const busKey = generateBusKey(bus, bus.startLocation);
        const isAlarmSet = alarmList.hasOwnProperty(busKey);

        const notes = (bus.notes || []).map(n => {
            const cls = n.includes('纪忠楼') ? 'highlight' : n.includes('大巴') ? 'important' : '';
            return `<span class="note ${cls}">${n}</span>`;
        }).join(' ') || '<span class="note-placeholder">无特殊备注</span>';

        const waitText = bus.waitTime >= 60
            ? `${Math.floor(bus.waitTime / 60)}小时${bus.waitTime % 60 ? (bus.waitTime % 60) + '分钟' : ''}`
            : `${bus.waitTime}分钟`;

        el.innerHTML = `
                    <span class="bus-time">${bus.time} 发车</span>
                    <p class="wait-time">将在 <strong>${waitText}</strong>后发车</p>
                    <div class="bus-details">
                        <p>上车地点: <strong>${bus.startLocation}</strong></p>
                        <p>开往: <strong>${bus.destination}</strong></p>
                        <div class="notes-container">${notes}</div>
                    </div>
                    
                    <div class="alarm-area">
                        <button class="set-alarm-btn ${isAlarmSet ? 'is-set' : ''}" 
                                onclick="toggleAlarmInput(this)">
                            ${isAlarmSet ? '已设提醒 (点击修改)' : '设置提醒'}
                        </button>
                        
                        <div class="alarm-input-group" style="display:none;">
                            提前<input type="number" value="5" min="1" max="15" id="alarm-minute-input">分钟提醒
                            <button onclick="setAlarm(this, '${busKey}', '${bus.time}', '${bus.destination}', '${bus.startLocation}')">确定</button>
                        </div>
                    </div>`;
    }

    /* ---------- 所有时刻表总览 (增加地点筛选逻辑) ---------- */
    function updateAllSchedulesDisplay() {
        const day = getDayType();
        // 获取用户选择的地点
        const selectedLocation = allLocationSel.value;
        const contentDiv = document.getElementById('schedules-content');

        if (!schedules || !schedules[day]) {
            contentDiv.innerHTML = '<p class="no-bus">时刻表数据加载中...</p>';
            return;
        }

        let html = '';
        // 筛选地点：如果选择“ALL”，则显示所有地点，否则只显示选中的地点
        const stops = Object.keys(schedules[day])
            .filter(stop => selectedLocation === 'ALL' || stop === selectedLocation)
            .sort();

        // 如果筛选后没有地点数据
        if (stops.length === 0 && selectedLocation !== 'ALL') {
            contentDiv.innerHTML = `<p class="no-bus">当前${day === 'workday' ? '工作日' : '节假日'}，${selectedLocation} 没有班车时刻表。</p>`;
            return;
        } else if (stops.length === 0) {
            contentDiv.innerHTML = '<p class="no-bus">当前日期无时刻表数据。</p>';
            return;
        }

        // 渲染过滤后的数据
        stops.forEach(stop => {
            html += `<h3>${stop}</h3>`;
            html += `<table class="schedule-table"><thead><tr>
                                <th>时间</th>
                                <th>终点</th>
                                <th>备注</th>
                             </tr></thead><tbody>`;

            (schedules[day][stop] || []).forEach(bus => {
                const notes = (bus.notes || []).join('，');
                html += `<tr>
                                    <td>${bus.time}</td>
                                    <td>${bus.destination}</td>
                                    <td>${notes || '无'}</td>
                                 </tr>`;
            });

            html += `</tbody></table>`;
        });

        contentDiv.innerHTML = html;
    }


    /* ---------- 通用显示和控制函数 (修改) ---------- */
    function showNoBusMessage(el, msg, hideSecond) {
        el.style.display = 'block';
        el.classList.add('no-bus');
        el.innerHTML = msg;
        if (hideSecond) {
            busCard2.style.display = 'none';
        }
    }

    function onSettingsChange() {
        // 重新填充下拉菜单（以便切换日期类型时刷新地点列表）
        populateLocations();
        populateDestinations();

        // 根据模式调用不同的显示函数
        switch (currentMode) {
            case 'realtime':
                updateBusDisplay();
                break;
            case 'destination':
                updateDestinationDisplay();
                break;
            case 'all':
                updateAllSchedulesDisplay();
                break;
        }
    }

    /* ---------- 绑定事件 (修改：增加绑定所有时刻表地点筛选) ---------- */
    function bindEvents() {
        // 模式切换
        document.querySelectorAll('input[name="mode"]').forEach(radio => {
            radio.addEventListener('change', updateModeDisplay);
        });
        // 日期切换 (工作日/节假日)
        dayTypeEls.workday.addEventListener('change', updateModeDisplay);
        dayTypeEls.holiday.addEventListener('change', updateModeDisplay);
        document.querySelectorAll('input[name="date-range"]').forEach(radio => {
            radio.addEventListener('change', () => {
                autoSelectDayTypeByDate();
                updateModeDisplay();
            });
        });
        // 地点切换 (Realtime & Destination)
        locationSel.addEventListener('change', onSettingsChange);
        destinationSel.addEventListener('change', onSettingsChange);
        // 【新增】所有时刻表地点筛选
        allLocationSel.addEventListener('change', onSettingsChange);

        // 启动实时更新
        if (mainInterval) clearInterval(mainInterval);
        // 实时查询和反向查询都需要刷新等待时间
        mainInterval = setInterval(() => {
            if (currentMode === 'realtime') {
                updateBusDisplay();
            } else if (currentMode === 'destination') {
                updateDestinationDisplay();
            }
        }, 10_000); // 10秒刷新
    }

    /* ---------- 时钟和夜间模式 (保留原逻辑) ---------- */
    function startClock() { setInterval(updateClock, 1000); }
    function startDarkModeTimer() { setInterval(checkTimeForDarkMode, 60_000); }

    function updateClock() {
        const now = new Date();
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        const seconds = now.getSeconds().toString().padStart(2, '0');
        clockEl.textContent = `${hours}:${minutes}:${seconds}`;

        const year = now.getFullYear();
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const day = now.getDate().toString().padStart(2, '0');
        
        const dateElement = document.getElementById('date-display');
        const weekdayElement = document.getElementById('weekday-display');
        if (dateElement) dateElement.textContent = `${year}-${month}-${day}`;
        
        const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
        if (weekdayElement) weekdayElement.textContent = weekdays[now.getDay()];
    }

    function checkTimeForDarkMode() {
        const h = new Date().getHours();
        document.body.classList.toggle('dark-mode', h >= 19 || h < 6);
    }

    function getDayType() {
        return dayTypeEls.workday.checked ? 'workday' : 'holiday';
    }
    function getDateRange() {
        return dateRangeEls.today.checked ? 'today' : 'tomorrow';
    }
    function getSelectedDate() {
        const now = new Date();
        if (getDateRange() === 'today') return now;
        return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    }
    function autoSelectDayTypeByDate() {
        const d = getSelectedDate().getDay();
        const isHoliday = d === 0 || d === 6;
        dayTypeEls.holiday.checked = isHoliday;
        dayTypeEls.workday.checked = !isHoliday;
    }


    let scrollIndicatorEl;
    let indicatorHideTimer;
    function setupScrollIndicator() {
        scrollIndicatorEl = document.createElement('div');
        scrollIndicatorEl.id = 'scroll-indicator';
        const container = document.getElementById('app-container');
        (container || document.body).appendChild(scrollIndicatorEl);
        scrollIndicatorEl.classList.add('hidden');
        updateScrollIndicator();
        const onScrollActivity = () => {
            updateScrollIndicator();
            if (scrollIndicatorEl) scrollIndicatorEl.classList.remove('hidden');
            if (indicatorHideTimer) clearTimeout(indicatorHideTimer);
            indicatorHideTimer = setTimeout(() => {
                if (scrollIndicatorEl) scrollIndicatorEl.classList.add('hidden');
            }, 1200);
        };
        const scroller = document.getElementById('scroll-content');
        if (scroller) {
            scroller.addEventListener('scroll', onScrollActivity, { passive: true });
            scroller.addEventListener('wheel', onScrollActivity, { passive: true });
            scroller.addEventListener('touchmove', onScrollActivity, { passive: true });
        } else {
            window.addEventListener('scroll', onScrollActivity, { passive: true });
            window.addEventListener('wheel', onScrollActivity, { passive: true });
            window.addEventListener('touchmove', onScrollActivity, { passive: true });
        }
        window.addEventListener('resize', updateScrollIndicator);
    }
    function updateScrollIndicator() {
        if (!scrollIndicatorEl) return;
        const scroller = document.getElementById('scroll-content');
        if (scroller) {
            const sh = scroller.scrollHeight;
            const ch = scroller.clientHeight;
            if (sh <= ch) { scrollIndicatorEl.classList.add('hidden'); return; }
            const base = ch / sh * ch;
            const scale = 0.6;
            const h = Math.max(16, Math.round(base * scale));
            const maxScroll = sh - ch;
            const st = scroller.scrollTop;
            const top = maxScroll > 0 ? Math.round(st / maxScroll * (ch - h)) : 0;
            scrollIndicatorEl.style.height = h + 'px';
            scrollIndicatorEl.style.top = top + 'px';
            return;
        }
        const sh = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
        const ih = window.innerHeight;
        if (sh <= ih) { scrollIndicatorEl.classList.add('hidden'); return; }
        const base = ih / sh * ih;
        const scale = 0.6;
        const h = Math.max(16, Math.round(base * scale));
        const maxScroll = sh - ih;
        const st = document.documentElement.scrollTop || document.body.scrollTop;
        const top = maxScroll > 0 ? Math.round(st / maxScroll * (ih - h)) : 0;
        scrollIndicatorEl.style.height = h + 'px';
        scrollIndicatorEl.style.top = top + 'px';
    }
    /* ---------- 网站启动器 ---------- */
    function init() {
        autoSelectDayTypeByDate();

        updateClock(); startClock();
        checkTimeForDarkMode(); startDarkModeTimer();

        // 初始化所有控件和显示
        populateLocations();
        populateDestinations();

        // 【新增】设置实时查询的默认地点
        if (locationSel.options.length > 0) {
            // 尝试默认选择“无线谷”，如果该选项不存在，则选择列表中的第一个选项
            const hasWuxiangu = Array.from(locationSel.options).some(opt => opt.value === '无线谷');
            locationSel.value = hasWuxiangu ? '无线谷' : locationSel.options[0].value;
        }

        // 默认设置“所有时刻表”的筛选为“全部地点”
        if (allLocationSel.options.length > 0) {
            allLocationSel.value = 'ALL';
        }

        bindEvents();
        setupScrollIndicator();
        updateModeDisplay();
    }

    init();   // 数据已拿到，可以安心初始化
});

/* ==================== 邮件提醒功能 ==================== */

// 服务器API地址（需要根据实际部署调整）
const API_BASE_URL = 'http://localhost:3000';

// 获取弹窗元素
const emailModal = document.getElementById('email-modal');
const emailReminderBtn = document.getElementById('email-reminder-btn');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalCancelBtn = document.getElementById('modal-cancel-btn');
const emailForm = document.getElementById('email-reminder-form');

// 获取表单元素
const userEmailInput = document.getElementById('user-email');
const reminderDayTypeSelect = document.getElementById('reminder-day-type');
const reminderLocationSelect = document.getElementById('reminder-location');
const reminderTimeSelect = document.getElementById('reminder-time');
const reminderDestinationInput = document.getElementById('reminder-destination');
const reminderAdvanceSelect = document.getElementById('reminder-advance');

// 状态消息元素
const statusMessageEl = document.getElementById('subscription-status');
const subscriptionsContentEl = document.getElementById('subscriptions-content');

// 预加载标志
let reminderDataPreloaded = false;

// 在页面加载时初始化邮件提醒功能
document.addEventListener('DOMContentLoaded', () => {
    initEmailReminder();
    // 预加载地点数据，加快首次打开速度
    preloadReminderData();
});

function initEmailReminder() {
    // 打开弹窗（优化：如果已预加载则直接显示）
    emailReminderBtn.addEventListener('click', () => {
        emailModal.classList.add('show');
        loadUserEmail();
        
        // 如果数据已预加载，直接使用，否则重新加载
        if (!reminderDataPreloaded) {
            populateReminderLocations();
        }
        
        loadUserSubscriptions();
    });

    // 关闭弹窗 - 确保按钮可点击
    if (modalCloseBtn) {
        modalCloseBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeModal();
        });
    }
    
    if (modalCancelBtn) {
        modalCancelBtn.addEventListener('click', (e) => {
            e.preventDefault();
            closeModal();
        });
    }
    
    // 点击弹窗外部关闭
    emailModal.addEventListener('click', (e) => {
        if (e.target === emailModal) {
            closeModal();
        }
    });

    // 地点变化时更新班车时间列表
    reminderLocationSelect.addEventListener('change', updateReminderTimes);
    reminderDayTypeSelect.addEventListener('change', () => {
        fillReminderLocations();
        updateReminderTimes();
    });

    // 班车时间变化时更新目的地
    reminderTimeSelect.addEventListener('change', updateReminderDestination);

    // 表单提交
    emailForm.addEventListener('submit', handleFormSubmit);
}

function closeModal() {
    emailModal.classList.remove('show');
    emailForm.reset();
    hideStatusMessage();
}

// 加载用户邮箱（从 localStorage 读取）
function loadUserEmail() {
    const savedEmail = localStorage.getItem('userEmail');
    if (savedEmail) {
        userEmailInput.value = savedEmail;
    }
}

// 保存用户邮箱
function saveUserEmail(email) {
    localStorage.setItem('userEmail', email);
}

// 预加载地点数据（在页面加载时调用）
function preloadReminderData() {
    // 等待 schedules 数据加载完成
    const checkInterval = setInterval(() => {
        if (window.schedules && Object.keys(window.schedules).length > 0) {
            clearInterval(checkInterval);
            // 预填充工作日数据
            fillReminderLocations();
            reminderDataPreloaded = true;
            console.log('邮件提醒数据预加载完成');
        }
    }, 100);
    
    // 10秒后超时
    setTimeout(() => {
        clearInterval(checkInterval);
    }, 10000);
}

// 填充地点下拉列表（优化：直接使用已加载数据）
function populateReminderLocations() {
    // 直接检查数据是否已加载
    if (window.schedules && Object.keys(window.schedules).length > 0) {
        fillReminderLocations();
    } else {
        // 如果数据还未加载，显示加载提示并等待
        reminderLocationSelect.innerHTML = '<option value="">加载中...</option>';
        // 最多等待 3 秒
        let attempts = 0;
        const maxAttempts = 30;
        const checkSchedules = setInterval(() => {
            attempts++;
            if (window.schedules && Object.keys(window.schedules).length > 0) {
                clearInterval(checkSchedules);
                fillReminderLocations();
            } else if (attempts >= maxAttempts) {
                clearInterval(checkSchedules);
                reminderLocationSelect.innerHTML = '<option value="">加载失败，请刷新</option>';
            }
        }, 100);
    }
}

// 填充地点列表的实际逻辑
function fillReminderLocations() {
    const dayType = reminderDayTypeSelect.value;
    if (!window.schedules[dayType]) return;

    const locations = Object.keys(window.schedules[dayType]);
    reminderLocationSelect.innerHTML = '<option value="">请选择地点</option>';
    
    locations.forEach(loc => {
        const option = document.createElement('option');
        option.value = loc;
        option.textContent = loc;
        reminderLocationSelect.appendChild(option);
    });
}

// 更新班车时间列表
function updateReminderTimes() {
    const dayType = reminderDayTypeSelect.value;
    const location = reminderLocationSelect.value;
    
    reminderTimeSelect.innerHTML = '<option value="">请先选择地点</option>';
    reminderDestinationInput.value = '';
    
    if (!location || !window.schedules || !window.schedules[dayType]) return;

    const buses = window.schedules[dayType][location] || [];
    
    if (buses.length === 0) {
        reminderTimeSelect.innerHTML = '<option value="">该地点暂无班车</option>';
        return;
    }

    reminderTimeSelect.innerHTML = '<option value="">请选择班车时间</option>';
    
    buses.forEach(bus => {
        const option = document.createElement('option');
        option.value = bus.time;
        option.textContent = `${bus.time} - ${bus.destination}`;
        option.dataset.destination = bus.destination;
        reminderTimeSelect.appendChild(option);
    });
}

// 更新目的地
function updateReminderDestination() {
    const selectedOption = reminderTimeSelect.options[reminderTimeSelect.selectedIndex];
    if (selectedOption && selectedOption.dataset.destination) {
        reminderDestinationInput.value = selectedOption.dataset.destination;
    } else {
        reminderDestinationInput.value = '';
    }
}

// 处理表单提交
async function handleFormSubmit(e) {
    e.preventDefault();
    
    const email = userEmailInput.value.trim();
    const dayType = reminderDayTypeSelect.value;
    const location = reminderLocationSelect.value;
    const time = reminderTimeSelect.value;
    const destination = reminderDestinationInput.value;
    const advanceMinutes = reminderAdvanceSelect.value;

    // 验证字段
    if (!email || !dayType || !location || !time || !destination) {
        showStatusMessage('请填写所有必填字段', 'error');
        return;
    }

    // 保存邮箱
    saveUserEmail(email);

    // 发送请求到服务器
    try {
        const response = await fetch(`${API_BASE_URL}/api/subscribe`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email,
                dayType,
                location,
                time,
                destination,
                advanceMinutes: parseInt(advanceMinutes)
            })
        });

        const data = await response.json();

        if (data.success) {
            showStatusMessage('✅ 订阅成功！将会在班车出发前发送邮件提醒', 'success');
            emailForm.reset();
            loadUserEmail();
            loadUserSubscriptions();
        } else {
            showStatusMessage(`❌ 订阅失败：${data.message}`, 'error');
        }
    } catch (error) {
        console.error('订阅失败:', error);
        showStatusMessage('❌ 网络错误，请确保服务器已启动', 'error');
    }
}

// 显示状态消息
function showStatusMessage(message, type) {
    statusMessageEl.textContent = message;
    statusMessageEl.className = `status-message ${type}`;
    statusMessageEl.style.display = 'block';
    
    // 5秒后自动隐藏
    setTimeout(hideStatusMessage, 5000);
}

function hideStatusMessage() {
    statusMessageEl.style.display = 'none';
}

// 加载用户订阅列表
async function loadUserSubscriptions() {
    const email = userEmailInput.value.trim();
    if (!email) {
        subscriptionsContentEl.innerHTML = '<p class="no-subscriptions">请先输入邮箱</p>';
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/subscriptions/${encodeURIComponent(email)}`);
        const data = await response.json();

        if (data.success && data.subscriptions.length > 0) {
            renderSubscriptions(data.subscriptions);
        } else {
            subscriptionsContentEl.innerHTML = '<p class="no-subscriptions">暂无订阅</p>';
        }
    } catch (error) {
        console.error('加载订阅列表失败:', error);
        subscriptionsContentEl.innerHTML = '<p class="no-subscriptions">加载失败</p>';
    }
}

// 渲染订阅列表
function renderSubscriptions(subscriptions) {
    subscriptionsContentEl.innerHTML = '';
    
    subscriptions.forEach(sub => {
        const item = document.createElement('div');
        item.className = 'subscription-item';
        
        item.innerHTML = `
            <div class="subscription-info">
                <p><strong>${sub.location}</strong> <span class="subscription-time">${sub.time}</span> → ${sub.destination}</p>
                <p>📅 ${sub.dayType === 'workday' ? '工作日' : '节假日'} | ⏰ 提前 ${sub.advanceMinutes} 分钟</p>
            </div>
            <button class="btn-delete" data-id="${sub.id}">删除</button>
        `;
        
        subscriptionsContentEl.appendChild(item);
    });
    
    // 绑定删除按钮事件
    document.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', () => deleteSubscription(btn.dataset.id));
    });
}

// 删除订阅
async function deleteSubscription(id) {
    if (!confirm('确定要删除这个订阅吗？')) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/subscribe/${id}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            showStatusMessage('✅ 已取消订阅', 'success');
            loadUserSubscriptions();
        } else {
            showStatusMessage(`❌ 删除失败：${data.message}`, 'error');
        }
    } catch (error) {
        console.error('删除订阅失败:', error);
        showStatusMessage('❌ 网络错误', 'error');
    }
}
