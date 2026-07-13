import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import open from 'open';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';
import mammoth from 'mammoth';

// ESM 获取 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 导入业务模块（必须带 .js）
import cfg from './node-wp/config.js';
import { initAuth } from './node-wp/wp-auth.js';
import { uploadMedia } from './node-wp/upload-media.js';
import { createNewsPost } from './node-wp/create-post.js';
import { createWcProduct } from './node-wp/create-wc-product.js';

const execFileAsync = promisify(execFile);

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

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getProductImagesForDoc(images, baseName) {
  const normalizedBaseName = baseName.toLowerCase();
  const exactOrIndexedPattern = new RegExp(
    `^${escapeRegExp(normalizedBaseName)}(?:[-_\\s]\\d+)?$`
  );

  return images.filter((img) => {
    const imageBaseName = path.basename(img, path.extname(img)).toLowerCase();
    return exactOrIndexedPattern.test(imageBaseName);
  });
}

async function selectDirectory() {
  if (os.platform() === 'win32') {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
      '$dialog.Description = "选择素材根目录"',
      '$dialog.UseDescriptionForTitle = $true',
      'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
      '  [Console]::Out.Write($dialog.SelectedPath)',
      '}'
    ].join('; ');
    const { stdout } = await execFileAsync('powershell', [
      '-NoProfile',
      '-STA',
      '-Command',
      script
    ]);
    return stdout.trim();
  }

  if (os.platform() === 'darwin') {
    const { stdout } = await execFileAsync('osascript', [
      '-e',
      'POSIX path of (choose folder with prompt "选择素材根目录")'
    ]);
    return stdout.trim().replace(/[\\/]$/, '');
  }

  throw new Error('当前系统暂不支持目录选择器，请手动输入目录路径');
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

app.post('/api/selectDir', async (_req, res) => {
  try {
    const selectedPath = await selectDirectory();
    if (!selectedPath) {
      return res.json({ success: false, cancelled: true });
    }
    res.json({ success: true, dir: path.normalize(selectedPath) });
  } catch (err) {
    res.json({ success: false, msg: err.message });
  }
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
          const matchedImages = getProductImagesForDoc(images, baseName);
          if (matchedImages.length > 0) {
            pushLog(`上传当前产品匹配图片：${matchedImages.map(img => path.basename(img)).join(', ')}`);
          } else {
            pushLog('当前产品未找到匹配图片，将仅创建商品内容');
          }
          const mediaIds = [];
          for (const img of matchedImages) {
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
