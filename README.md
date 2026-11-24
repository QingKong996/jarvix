本项目参考了 Codex、DeepSeek Harness、Magpie、OpenCode 和 Pi。

## Agent 可观测性

Agent 运行数据只写入本地 SQLite，不上报远端。默认数据库：

```text
~/.jarvix/observability/agent.sqlite3
```

记录 run、LLM turn、每次 HTTP attempt、工具调用、TTFT、TPS、token、耗时、错误阶段、上下文使用率、压缩和命名调用等结构化指标，并生成模型分段、版本分组、环比和交互反复代理指标。默认保留 90 天，数据库上限 200 MB。不会保存 prompt 原文、thinking、工具参数、工具输出或文件内容，也不提供用户反馈入口。

```powershell
npm run report:agent -- --days 7
npm run report:agent -- --days 7 --format json
npm run report:agent -- --db C:\path\to\agent.sqlite3
```
