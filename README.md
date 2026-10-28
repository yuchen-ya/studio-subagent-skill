# Studio Subagent Skill

让 Codex 通过已登录的 Chrome 调用 Google AI Studio Build，上传文件、委派修改并取回结果。

需要 Node.js 22+ 和 [Playwright Extension](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm)。

```sh
git clone https://github.com/yuchen-ya/studio-subagent-skill.git
cd studio-subagent-skill
npm ci
npm run install-skill
```

在 Codex 中使用：

> 用 $aistudio-subagent 把这些文件交给 AI Studio 修改，完成后取回并验证。

首次连接按扩展页面授权。扩展可访问整个 Chrome，请勿公开连接令牌。

测试：`npm test` · 许可：[MPL-2.0](LICENSE) · [来源](NOTICE)
