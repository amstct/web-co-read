# XQcoread

Chrome 插件：在网页上划线保存原文，或把整页/指定链接总结后，**增量写入**指定飞书云文档末尾。

## 功能

1. **划线保存**：选中网页句子后按下快捷键（默认 `⌘⇧O` / `Ctrl+Shift+O`），原文追加到飞书文档。
2. **页面总结**：在当前标签页按快捷键（默认 `⌘⇧P` / `Ctrl+Shift+P`），或在弹窗粘贴 URL，提炼后再追加到同一文档。
3. **可配置快捷键**、**飞书文档链接**、**总结提示词**。
4. 独立 **Settings** 页，浅色科技风界面。

## 安装

1. 打开 Chrome，访问 `chrome://extensions`
2. 打开右上角「开发者模式」
3. 点「加载已解压的扩展程序」，选择本仓库根目录
4. 点击工具栏图标进入弹窗，或右键扩展选择「选项」完成配置

## 飞书配置

1. 打开 [飞书开放平台](https://open.feishu.cn/app) 创建企业自建应用
2. 开通权限：
   - `docx:document`（或可编辑云文档）
   - `docx:document.block:convert`
   - 若目标是 Wiki 链接，再开通 wiki 相关读权限
3. 创建并发布一个应用版本，拿到 **App ID** / **App Secret**
4. 打开目标飞书文档，分享给该应用（把应用加为文档协作者）
5. 把文档链接、App ID、App Secret 填进插件设置，点「测试连接」

国内飞书 API 默认 `https://open.feishu.cn`；国际版 Lark 请在设置中切换。

## 总结模型

页面总结走兼容 OpenAI `chat/completions` 的接口。可填：

- OpenAI：`https://api.openai.com/v1`
- DeepSeek：`https://api.deepseek.com/v1`
- 其他代理或国产方舟，按厂商文档填写 Base URL、模型名和 API Key
- **本地 Ollama**：Base URL 填 `http://127.0.0.1:11434/v1`，API Key 可留空，模型名与 `ollama list` 一致

Ollama 默认会拦截 Chrome 插件请求并返回 **403**。在 macOS 终端执行：

```bash
launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"
```

然后从菜单栏完全退出 Ollama 再重新打开。设置页可切到「Ollama 本地」并一键拉取本机模型列表。

## 使用

- 划选文本 → `⌘⇧O`（可改）→ 原文写入文档末尾
- 任意网页 → `⌘⇧P`（可改）→ 摘要写入文档末尾
- 弹窗可总结当前页，或粘贴任意 http/https 链接
- 快捷键也可在 `chrome://extensions/shortcuts` 中修改扩展命令

## 权限说明

插件需要访问当前网页正文、调用飞书开放接口和模型接口。App Secret 与 API Key 只保存在浏览器本地 `chrome.storage.local`，不会上传到本项目服务器。
