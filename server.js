require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const cron = require('node-cron');

const app = express();
const port = 3000;

// 中间件：解析 JSON 请求体
app.use(express.json());

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// 数据存储文件路径
const SUBSCRIPTIONS_FILE = path.join(__dirname, 'subscriptions.json');

// 初始化订阅数据文件
if (!fs.existsSync(SUBSCRIPTIONS_FILE)) {
  fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify([]));
}

// 读取订阅数据
function loadSubscriptions() {
  try {
    const data = fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('读取订阅数据失败:', error);
    return [];
  }
}

// 保存订阅数据
function saveSubscriptions(subscriptions) {
  try {
    fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subscriptions, null, 2));
    return true;
  } catch (error) {
    console.error('保存订阅数据失败:', error);
    return false;
  }
}

// 配置邮件发送器（使用环境变量或配置文件）
// 注意：需要在环境变量中设置邮箱配置
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'qq', // 默认使用QQ邮箱
  auth: {
    user: process.env.EMAIL_USER || '', // 发件人邮箱
    pass: process.env.EMAIL_PASS || ''  // 授权码（不是邮箱密码）
  }
});

// API: 添加邮件提醒订阅
app.post('/api/subscribe', (req, res) => {
  const { email, dayType, location, time, destination, advanceMinutes } = req.body;

  // 验证必填字段
  if (!email || !dayType || !location || !time || !destination || advanceMinutes === undefined) {
    return res.status(400).json({ 
      success: false, 
      message: '缺少必填字段' 
    });
  }

  // 验证邮箱格式
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ 
      success: false, 
      message: '邮箱格式不正确' 
    });
  }

  // 加载现有订阅
  const subscriptions = loadSubscriptions();

  // 创建新订阅
  const newSubscription = {
    id: Date.now().toString(),
    email,
    dayType,
    location,
    time,
    destination,
    advanceMinutes: parseInt(advanceMinutes),
    createdAt: new Date().toISOString(),
    active: true
  };

  subscriptions.push(newSubscription);

  // 保存订阅
  if (saveSubscriptions(subscriptions)) {
    console.log(`新增订阅: ${email} - ${location} ${time} -> ${destination}`);
    res.json({ 
      success: true, 
      message: '订阅成功',
      subscription: newSubscription
    });
  } else {
    res.status(500).json({ 
      success: false, 
      message: '保存订阅失败' 
    });
  }
});

// API: 获取用户的订阅列表
app.get('/api/subscriptions/:email', (req, res) => {
  const { email } = req.params;
  const subscriptions = loadSubscriptions();
  const userSubscriptions = subscriptions.filter(sub => sub.email === email && sub.active);
  res.json({ success: true, subscriptions: userSubscriptions });
});

// API: 删除订阅
app.delete('/api/subscribe/:id', (req, res) => {
  const { id } = req.params;
  let subscriptions = loadSubscriptions();
  const index = subscriptions.findIndex(sub => sub.id === id);
  
  if (index === -1) {
    return res.status(404).json({ success: false, message: '订阅不存在' });
  }

  subscriptions[index].active = false;
  
  if (saveSubscriptions(subscriptions)) {
    res.json({ success: true, message: '取消订阅成功' });
  } else {
    res.status(500).json({ success: false, message: '取消订阅失败' });
  }
});

// 发送邮件提醒
async function sendEmailReminder(subscription) {
  const { email, location, time, destination, advanceMinutes } = subscription;
  
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: '🚌 东南大学校园接驳车提醒',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1a73e8;">校园接驳车发车提醒</h2>
        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p style="font-size: 16px; margin: 10px 0;">
            <strong>上车地点：</strong>${location}
          </p>
          <p style="font-size: 16px; margin: 10px 0;">
            <strong>发车时间：</strong><span style="color: #d32f2f; font-size: 20px;">${time}</span>
          </p>
          <p style="font-size: 16px; margin: 10px 0;">
            <strong>目的地：</strong>${destination}
          </p>
          <p style="font-size: 14px; color: #666; margin: 10px 0;">
            ⏰ 提前 ${advanceMinutes} 分钟提醒
          </p>
        </div>
        <p style="color: #666; font-size: 14px;">
          请合理安排出行时间，祝您旅途愉快！
        </p>
        <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
        <p style="color: #999; font-size: 12px;">
          这是一封自动发送的邮件，请勿回复。<br>
          如需取消提醒，请在桌面小组件中管理订阅。
        </p>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`邮件发送成功: ${email} - ${location} ${time}`);
    return true;
  } catch (error) {
    console.error(`邮件发送失败: ${email}`, error);
    return false;
  }
}

// 定时任务：每分钟检查一次是否需要发送提醒
cron.schedule('* * * * *', () => {
  const now = new Date();
  const subscriptions = loadSubscriptions();
  const activeSubscriptions = subscriptions.filter(sub => sub.active);

  activeSubscriptions.forEach(subscription => {
    const { dayType, time, advanceMinutes } = subscription;
    
    // 判断今天是工作日还是节假日
    const dayOfWeek = now.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const currentDayType = isWeekend ? 'holiday' : 'workday';

    // 如果日期类型不匹配，跳过
    if (dayType !== currentDayType) {
      return;
    }

    // 解析班车时间
    const [busHour, busMinute] = time.split(':').map(Number);
    const busTime = new Date(now);
    busTime.setHours(busHour, busMinute, 0, 0);

    // 计算提醒时间
    const reminderTime = new Date(busTime.getTime() - advanceMinutes * 60 * 1000);

    // 检查是否到了提醒时间（允许1分钟误差）
    const timeDiff = Math.abs(now.getTime() - reminderTime.getTime());
    if (timeDiff < 60000) { // 小于1分钟
      sendEmailReminder(subscription);
    }
  });
});

console.log('📧 邮件提醒定时任务已启动，每分钟检查一次');

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
  console.log('邮件提醒功能已启用');
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('⚠️  警告：未设置邮箱配置环境变量 EMAIL_USER 和 EMAIL_PASS');
  }
});
