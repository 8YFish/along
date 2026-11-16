# Along 视频生成服务

此目录是独立的 Node.js 后端，不由 GitHub Pages 执行。当前只接 Runway `gen4_turbo` 图生视频；文生视频仍使用前端提示词导出。无第三方依赖。需要 Node.js 22+。

## 本地运行

未配置账号也可以启动，`/api/capabilities` 会明确返回未就绪，任何生成请求都被拒绝，不会调用供应商。

```powershell
node server/video-gateway.cjs
```

默认仅监听 `127.0.0.1:8787`。可用前端本地站点连接 `http://127.0.0.1:8787` 检查未配置状态。

## 配置生成账号

1. 将 `server/.env.example` 复制为 `server/.env`；该文件由 `.gitignore` 排除。
2. `RUNWAYML_API_SECRET`：填写自己的 Runway API 密钥，仅部署到服务端环境。
3. `ALONG_API_TOKEN`：设置至少 24 字符的随机访问口令，用于个人或可信团队连接此服务。不要复用模型密钥。当前实现为单账号私有服务，不适合直接开放给不可信的公众用户。
4. `ALONG_CREDITS_PER_SECOND`：由管理员按当前供应商价格填写每秒 credits。未配置正数时服务不会就绪。报价仅为提交前估算，最终以 Runway 账单为准。
5. `ALONG_ALLOWED_ORIGINS`：允许的前端 origin，以逗号分隔，例如 `https://8yfish.github.io,http://127.0.0.1:8765`。origin 不含 `/along` 路径。

```powershell
node --env-file=server/.env server/video-gateway.cjs
```

随后在前端“视频提示词 → 生成视频任务 → 连接生成服务”填写后端地址和访问口令。连接会先读取费用，再验证口令；口令只留在页面内存，不写入浏览器存储。

## 对外部署

部署到可运行 Node.js 的服务器。对外提供 HTTPS，并在反向代理后运行此进程；如运行在容器中可设置 `HOST=0.0.0.0`，由平台限制网络与配置 TLS。GitHub Pages 继续托管原静态前端。

- 设置持久化磁盘，并用 `ALONG_DATA_DIR` 指定服务可写目录。
- 所有副本必须共享同一个任务与防重复存储；当前 JSON 存储仅支持**单进程、单副本**。扩容前应替换为事务数据库。
- 反向代理允许约 15 MB JSON 请求体，超时至少 65 秒。
- 不记录 Authorization 头、请求体或首帧图片。任务元数据包含商品名称 / 货号，注意磁盘访问权限与备份策略。
- Runway 密钥和访问口令通过平台的环境变量 / Secret 管理器配置，不放进仓库或前端。
- 对公开多人网站，还需添加每人账号、额度、速率限制、任务隔离和审计；本实现的共享访问口令定位是私有使用。

## API

| 接口 | 用途 |
| --- | --- |
| `GET /api/capabilities` | 返回就绪状态、供应商、模型、时长、画幅、每秒估算 credits；不返回密钥 |
| `GET /api/session` | 验证 `Authorization: Bearer <访问口令>` |
| `POST /api/jobs` | 创建任务，要求访问口令、`Idempotency-Key`、主图确认和单次上传 / 费用同意 |
| `GET /api/jobs/:id` | 查询任务进度、结果与可访问的视频链接 |

创建请求仅接受已确认图片的 data URI、1–1000 UTF-16 字符的紧凑提示词、5/8/10 秒、9:16/16:9/1:1，以及商品名称、货号和方向。服务端再次验证所有参数，再转换为供应商模型输入。

- 前端按提交内容计算 SHA-256 防重复标识；相同内容重试会返回原任务，不再次计费。
- 记录提交意图后再请求供应商。提交超时或进程中断时标记 `SUBMISSION_UNKNOWN`，**不会自动重发**。请先去供应商后台核对，避免再次计费。
- 供应商只在查询间隔至少 5 秒时被查询；前端每 6 秒轮询，查询失败时退避，保留任务 ID。
- 同时最多有两个等待 / 运行任务。不会在后台自动重试创建付费任务。已明确失败 / 取消的任务可以通过前端“准备重新生成”发起新尝试，必须重新同意费用；提交结果不明时不提供重做按钮。
- 本服务不保存首帧或完整提示词。持久化数据保存本地 / 供应商任务 ID、防重复摘要、商品名称货号和结果链接。
- 供应商输出链接会过期，前端提示及时下载；本服务不充当视频永久存储。

## 测试

```powershell
node --test tests/prompt-engine.test.cjs tests/video-gateway.test.cjs
```

测试中的供应商响应全部模拟，不使用真实密钥，不创建付费任务。

参考文档（接入时核对日期：2026-11-16）：

- https://docs.dev.runwayml.com/api.md
- https://docs.dev.runwayml.com/guides/pricing
