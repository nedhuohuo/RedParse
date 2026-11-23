# RedParse

轻量级 Chrome / Edge 浏览器扩展（Manifest V3），用于在小红书网页版**手动**解析并下载视频笔记，支持按需选择分辨率与编码格式。

## 特点

- **按需触发**：平时不运行任何后台抓取脚本，仅在你点击工具栏图标时读取当前页面已有数据。
- **零外部依赖**：无需本地服务、无需配置 Cookie、不向第三方服务器发送数据。
- **可选清晰度与编码**：自动列出所有可用流（分辨率、H.264 / H.265 / AV1、码率、文件大小），默认优先选中**兼容性最好**的高清 H.264 版本。
- **自动备用地址重试**：主地址下载中断时由后台 Service Worker 自动切换备用 CDN 地址重试。
- **面向未来的扩展架构**：解析层采用统一媒体模型 + 注册表，已为图文与实况图（Live Photo）预留扩展位。

## 安装方法（Chrome / Edge）

1. 打开浏览器扩展管理页：
   - Chrome：`chrome://extensions/`
   - Edge：`edge://extensions/`
2. 打开右上角**开发者模式**。
3. 点击**加载已解压的扩展程序**，选择本项目的 `RedParse` 根目录。
4. 点击地址栏右侧的扩展图标，将 **RedParse** 固定到工具栏。

> 如果此前已加载过旧版本，在扩展管理页点击 RedParse 卡片上的**刷新按钮**即可生效。

## 使用方法

1. 在小红书网页版（`www.xiaohongshu.com`）打开任意视频笔记（支持推荐流弹窗打开或独立页面打开）。
2. 点击工具栏上的 **RedParse** 图标。
3. 在弹出列表中选择想要的分辨率/编码（默认已选中兼容性最好的版本），按需修改文件名或勾选“每次询问保存位置”。
4. 点击**确定下载**。

## 目录结构

```text
RedParse/
├── manifest.json                 # Manifest V3 配置（最小权限）
├── icons/                        # 扩展图标（16 / 48 / 128）
├── src/
│   ├── background.js             # 下载管理与备用地址自动重试
│   ├── extract/
│   │   └── page-extractor.js     # 在页面 MAIN world 读取 Pinia / __INITIAL_STATE__
│   ├── core/
│   │   ├── parse.js              # 解析分发入口与统一媒体模型
│   │   ├── parsers/
│   │   │   ├── video.js          # v1 视频流解析、排序与推荐策略
│   │   │   └── image.js          # 图文 / 实况图扩展占位
│   │   ├── filename.js           # 安全文件名生成与兜底规则
│   │   └── url.js                # 域名与 noteId 提取
│   └── popup/
│       ├── popup.html
│       ├── popup.css
│       └── popup.js
└── test/
    ├── fixtures/                 # 脱敏真实页面样本
    └── core.test.js              # Node 原生单元测试
```

## 运行单元测试

需要 Node.js 18+（无任何第三方 npm 依赖）：

```bash
npm test
```

## 后续扩展图文 / 实况图

1. 在 `src/core/parsers/image.js` 实现 `parseImageNote(note)`，返回符合统一模型的 `MediaAsset[]`。
2. 在 `src/core/parse.js` 的 `PARSER_REGISTRY` 中将 `image` / `live_photo` 的 `supported` 设为 `true`。
3. 在 `src/popup/popup.js` 为多资源（`assets.length > 1`）增加勾选与批量下载视图。
