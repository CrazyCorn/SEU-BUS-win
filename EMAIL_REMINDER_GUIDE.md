# 邮件提醒功能配置指南

## 📧 功能说明

新增的邮件提醒功能允许用户在桌面小组件中订阅班车提醒，服务器会在指定时间前通过邮件通知用户。

## 🚀 部署步骤

### 一、服务端配置（server 分支）

#### 1. 切换到 server 分支
```bash
git checkout server
```

#### 2. 安装依赖
```bash
npm install
```

这会自动安装以下新增依赖：
- `nodemailer` - 邮件发送库
- `node-cron` - 定时任务调度
- `dotenv` - 环境变量管理

#### 3. 配置邮箱服务

创建 `.env` 文件（参考 `.env.example`）：

```env
# 邮箱服务配置
EMAIL_SERVICE=qq

# 发件人邮箱地址
EMAIL_USER=your-email@qq.com

# 邮箱授权码（不是登录密码！）
EMAIL_PASS=your-authorization-code
```

#### 4. 获取邮箱授权码

**QQ 邮箱：**
1. 登录 [QQ 邮箱网页版](https://mail.qq.com)
2. 设置 → 账户 → POP3/IMAP/SMTP/Exchange/CardDAV/CalDAV 服务
3. 开启 POP3/SMTP 服务
4. 点击"生成授权码"
5. 将授权码填入 `.env` 文件的 `EMAIL_PASS`

**163 邮箱：**
1. 登录 [163 邮箱](https://mail.163.com)
2. 设置 → POP3/SMTP/IMAP
3. 开启 SMTP 服务
4. 设置客户端授权码
5. 将授权码填入 `.env` 文件的 `EMAIL_PASS`

**Gmail：**
1. 开启两步验证
2. 生成应用专用密码
3. 将 `EMAIL_SERVICE` 设为 `gmail`

#### 5. 启动服务器
```bash
npm start
```

服务器会在 `http://localhost:3000` 启动，并每分钟检查是否需要发送提醒邮件。

### 二、客户端配置（desktoptool 分支）

#### 1. 切换到 desktoptool 分支
```bash
git checkout desktoptool
```

#### 2. 修改 API 地址（如需要）

如果服务器部署在其他地址，修改 `public/scripts.js` 中的 API 地址：

```javascript
// 服务器API地址（需要根据实际部署调整）
const API_BASE_URL = 'http://your-server-address:3000';
```

#### 3. 启动桌面小组件
```bash
npm run widget
```

## 📱 使用说明

### 在桌面小组件中设置提醒

1. 点击右上角的 📧 按钮打开邮件提醒设置
2. 填写以下信息：
   - **邮箱地址**：接收提醒的邮箱
   - **日期类型**：工作日 / 节假日
   - **上车地点**：选择起点站
   - **班车时间**：选择具体班次
   - **提前提醒**：选择提前多少分钟提醒（5-30分钟）
3. 点击"添加提醒"

### 管理订阅

- 在弹窗底部可以查看已订阅的提醒
- 点击"删除"按钮可以取消订阅

## 🔧 API 接口说明

### 1. 添加订阅
```
POST /api/subscribe
Content-Type: application/json

{
  "email": "user@example.com",
  "dayType": "workday",
  "location": "无线谷",
  "time": "08:30",
  "destination": "橘园",
  "advanceMinutes": 10
}
```

### 2. 获取用户订阅列表
```
GET /api/subscriptions/:email
```

### 3. 删除订阅
```
DELETE /api/subscribe/:id
```

## 📊 数据存储

订阅数据存储在服务器根目录的 `subscriptions.json` 文件中。

## ⚠️ 注意事项

1. **邮箱配置是必需的**：服务器必须正确配置 `.env` 文件才能发送邮件
2. **授权码不是密码**：请使用邮箱服务商提供的授权码，而不是登录密码
3. **服务器需要持续运行**：定时任务需要服务器一直在线
4. **时区问题**：确保服务器时区与用户时区一致
5. **网络连接**：客户端需要能访问服务器 API

## 🐛 故障排查

### 问题：提交订阅时提示网络错误
**解决**：
- 确认服务器已启动
- 检查客户端的 `API_BASE_URL` 配置是否正确
- 检查防火墙是否阻止了端口 3000

### 问题：未收到邮件
**解决**：
- 检查 `.env` 文件配置是否正确
- 查看服务器日志是否有错误信息
- 确认邮箱授权码有效
- 检查邮件是否被归类到垃圾邮件

### 问题：服务器报错 "未设置邮箱配置"
**解决**：
- 确保 `.env` 文件存在于服务器根目录
- 检查 `.env` 文件格式是否正确
- 重启服务器使配置生效

## 📈 未来优化方向

- [ ] 支持多种通知方式（微信、短信等）
- [ ] 添加订阅管理页面
- [ ] 支持重复订阅（每周固定时间）
- [ ] 邮件模板自定义
- [ ] 发送状态追踪

## 📞 技术支持

如有问题，请提交 Issue 或联系开发团队。
