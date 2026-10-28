# Studio Subagent

将已登录 Chrome 中的 Google AI Studio Build 用作文件修改子代理：上传、提交、等待、下载 ZIP 并解压结果。

## 安装

需要 Node.js 22+，以及安装在登录账号所在 Chrome 配置中的 [Playwright Extension](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm)。

```sh
cd studio-subagent
npm ci
npm run install-skill
node src/cli.mjs start
node src/cli.mjs connect
```

Skill 安装到 `$CODEX_HOME/skills/aistudio-subagent`（默认 `~/.codex/skills/aistudio-subagent`），通过 `$aistudio-subagent` 调用。

首次连接由用户在扩展页允许。可选择现有 Build 标签页或空白页，程序会在同一 Chrome 配置中打开 AI Studio。扩展权限覆盖整个浏览器；代码的 Build URL 检查不构成浏览器权限隔离。登录和验证码需用户处理。

重启时复用授权：设置 `PLAYWRIGHT_MCP_EXTENSION_TOKEN` 环境变量，或将扩展令牌保存在用户数据目录下的 `extension-token.txt`。令牌只在本机使用，不要放入源码或问题报告。

运行数据默认存放在 Windows 的 `%LOCALAPPDATA%/studio-subagent`、macOS 的 `~/Library/Application Support/studio-subagent`、Linux 的 `$XDG_STATE_HOME/studio-subagent`（未设置时为 `~/.local/state/studio-subagent`）。可通过 `STUDIO_SUBAGENT_DATA_DIR` 指定绝对路径。

## 使用

将任务写入 UTF-8 文本文件：

```sh
node src/cli.mjs inspect
node src/cli.mjs submit --new --prompt-file ./task.txt --file ./input/index.html --output-dir ../studio-results
node src/cli.mjs wait --job JOB_ID --timeout 45
node src/cli.mjs collect --job JOB_ID
node src/cli.mjs stop
```

`--file` 可重复；继续当前项目时不带 `--new`。Chrome 使用自定义下载目录时加 `--download-dir`。更多参数见 `node src/cli.mjs help`。

一次处理一个活动任务。`submission_unknown` 需继续查询同一任务，程序不会自动重发。完成判定要求本次消息出现、新回答结束且内容稳定。选错项目或出现另一条手动任务时暂停；用户草稿不会被覆盖。

取回结果位于输出目录的任务 ID 子目录，包含 `project.zip` 和 `source/`。重复 collect 返回已有结果。

本机服务仅绑定 127.0.0.1 并要求随机令牌。任务文件、提示词、项目链接和浏览器日志均可能包含私人信息，只保存在用户数据目录，请勿公开该目录或浏览器连接令牌。停止服务不会关闭 Chrome。

## 验证与维护

`npm test` 运行离线回归检查，不需要 Google 账号。自动化测试不会验证真实网站；完整浏览器流程需要安装扩展并使用自己的账号。当前适配英文 Build 页面；页面改版时检查 `src/state.mjs` 和 `src/agent.mjs` 的选择器。

网页版本、区域和套餐会影响功能可用性；遵守 Google 的适用条款与使用限制。本项目不自动绕过登录、验证码或配额。报告问题前，请移除令牌、账号信息、项目链接和文件内容。

原型参考 Agentify，当前直接使用 Playwright；许可证和来源见 [LICENSE](LICENSE)、[NOTICE](NOTICE)。
