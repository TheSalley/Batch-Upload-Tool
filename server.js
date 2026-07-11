import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import open from 'open';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';
import mammoth from 'mammoth';

// ESM 获取 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 导入业务模块（必须带 .js）
import cfg from './node-wp/config.js';
import { initAuth, getBaseHeaders } from './node-wp/wp-auth.js';
import { uploadMedia } from './node-wp/upload-media.js';
import { createNewsPost } from './node-wp/create-post.js';
import { createWcProduct } from './node-wp/create-wc-product.js';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
let wsClient = null;
const PORT = 3000;

// 静态页面 + json解析
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// WebSocket 推送日志
function pushLog(text) {
  if (wsClient) {
    wsClient.send(JSON.stringify({ type: 'log', data: text }));
  }
}
function pushProgress(current, total, name) {
  if (wsClient) {
    wsClient.send(JSON.stringify({
      type: 'progress',
      data: { current, total, name }
    }));
  }
}

wss.on('connection', (ws) => {
  wsClient = ws;
  pushLog('✅ 可视化面板已连接');
});

// 扫描本地文件夹
async function scanDir(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const docx = [], images = [];
  const imgExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  for (const item of entries) {
    const fullPath = path.join(dirPath, item.name);
    if (item.isDirectory()) continue;
    const ext = path.extname(item.name).toLowerCase();
    if (ext === '.docx') docx.push(fullPath);
    if (imgExts.includes(ext)) images.push(fullPath);
  }
  return { docx, images };
}

// 1. WP登录接口
app.post('/api/login', async (req, res) => {
  try {
    const { url, username, password } = req.body;
    cfg.wp.url = url;
    cfg.wp.user = username;
    cfg.wp.pwd = password;
    pushLog('开始模拟登录wp-login.php...');
    await initAuth();
    pushLog('✅ 登录成功，已获取会话Cookie & X-WP-Nonce');
    res.json({ success: true });
  } catch (err) {
    const msg = `❌ 登录失败：${err.message}`;
    pushLog(msg);
    res.json({ success: false, msg });
  }
});

// 2. 读取目录预览文件
app.post('/api/scanDir', async (req, res) => {
  const list = await scanDir(req.body.dir);
  res.json(list);
});

// 3. 批量上传任务
app.post('/api/upload', async (req, res) => {
  const rootDir = req.body.dir;
  try {
    await fs.ensureDir(rootDir);
    const rootFolders = await fs.readdir(rootDir);
    let totalDocs = 0;
    let finished = 0;

    // 统计总文档
    for (const folder of rootFolders) {
      const mode = cfg.folderMap[folder];
      if (!mode) continue;
      const folderPath = path.join(rootDir, folder);
      const { docx } = await scanDir(folderPath);
      totalDocs += docx.length;
    }

    // 循环处理目录
    for (const folder of rootFolders) {
      const mode = cfg.folderMap[folder];
      if (!mode) continue;
      const folderPath = path.join(rootDir, folder);
      const { docx, images } = await scanDir(folderPath);
      pushLog(`\n===== 正在处理目录：${folder} =====`);

      for (const docFile of docx) {
        finished++;
        const baseName = path.basename(docFile, '.docx');
        pushProgress(finished, totalDocs, baseName);
        pushLog(`解析文档：${baseName}.docx`);
        const htmlContent = (await mammoth.convertToHtml({ path: docFile })).value;

        if (mode === 'post') {
          let coverId = null;
          const matchCoverImg = images.find(img => {
            const imgBase = path.basename(img, path.extname(img));
            return imgBase === baseName;
          });
          if (matchCoverImg) {
            pushLog(`上传封面图：${path.basename(matchCoverImg)}`);
            coverId = await uploadMedia(matchCoverImg);
          }
          await createNewsPost(baseName, htmlContent, coverId);
        } else if (mode === 'wc_product') {
          pushLog(`上传当前产品全部图库图片`);
          const mediaIds = [];
          for (const img of images) {
            const mid = await uploadMedia(img);
            mediaIds.push(mid);
          }
          await createWcProduct(baseName, htmlContent, mediaIds);
        }
      }
    }
    pushLog('\n🎉 全部上传任务执行完成！');
    res.json({ success: true });
  } catch (err) {
    const msg = `❌ 任务中断：${err.message}`;
    pushLog(msg);
    res.json({ success: false, msg });
  }
});

// 启动服务并打开浏览器
server.listen(PORT, async () => {
  console.log(`服务运行：http://127.0.0.1:${PORT}`);
  await open(`http://127.0.0.1:${PORT}`);
});
