# A 股股票筛选平台

基于 Tushare Pro HTTP 数据的 A 股全市场筛选平台，默认检索全部 A 股股票，支持手动增量更新、按小时增量检查，以及本地历史缓存持续保留。

## 本地运行

```bash
npm install
cp .env.example .env
npm run dev
```

在 `.env` 中配置：

```bash
TUSHARE_TOKEN=你的 Tushare Token
TUSHARE_HTTP_URL=http://8.148.76.181:8686/
PORT=3000
```

打开 `http://localhost:3000/`。

## Render 部署

1. 把本项目上传到 GitHub。
2. 打开 Render，选择 `New +` -> `Web Service`。
3. 连接你的 GitHub 仓库。
4. 选择 Node 环境。
5. Build Command 填 `npm install`。
6. Start Command 填 `npm start`。
7. Environment Variables 添加：
   - `TUSHARE_TOKEN`：你的 Tushare Token
   - `TUSHARE_HTTP_URL`：`http://8.148.76.181:8686/`
   - `NODE_ENV`：`production`
8. 点击 Deploy。

首次部署后，平台会在后台建立本地历史缓存。缓存只会继续补充新交易日，不会主动删除旧数据；Render 免费实例冷启动时会先恢复最近快照，再继续更新。
