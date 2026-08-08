# 配平了吗？

这是一个纯静态离心机配平网站，不需要后端或数据库。

## 文件

- `index.html`：网站入口
- `peiping.css`：界面样式
- `peiping.js`：交互与配平算法
- `centrifuge_balance_schemes.json`：常见孔数的配平查表

## 部署

将整个 `peiping-site` 目录上传到任意静态网站托管服务即可，例如 GitHub Pages、Cloudflare Pages、Netlify 或 Vercel Static。

注意：网站通过 `fetch()` 读取 JSON。直接双击本地 `index.html` 时，部分浏览器会因为 `file://` 跨域限制无法加载查表；部署到 HTTP/HTTPS 静态服务器后即可正常工作。
