# dsh-session-delete

给 DeepSeek Harness 补上它没有的**删除会话**动作。

DSH 的会话菜单只有置顶、重命名、分叉、复制 ID、归档。归档只是把行藏起来，删工作区也明确保留会话日志——所以产品里没有任何办法把一段对话从磁盘上真正删掉。这个插件加的就是这个动词。

## 做什么

在侧栏任意会话行上**右键**（或用行尾的 `…` 菜单），选最下面那项红色的 **删除会话**。确认框会列出即将销毁的日志目录；确认后行就消失了。

删除要动三处，少一处就会留下空壳：

| 存储 | 位置 | 为什么必须清 |
|---|---|---|
| 会话日志 | `<DSH_HOME>/sessions/<工作区 slug>/<session-id>/` | 列表就是扫这个目录得出的，删掉它行才会消失 |
| 工作区索引 | `<DSH_HOME>/storages/workspace.json` 的 `sessionIds` | 记着这个会话属于哪个工作区 |
| 标题缓存 | `<DSH_HOME>/storages/session_projcache/sessions/<id>.json` | 行的标题和首条提问存这里 |

归档集合和置顶集合也一并清理；任一集合里留下死 id，重启后就会冒出一条看不见的幽灵行。

## 两处保护

- **运行中的会话不给删。** 确认框会说明并禁用按钮；Host 侧在动手前还会再查一次，运行中的 agent loop 不会在一轮对话中途被人抽掉目录。
- **只做本机。** 路由挂在 Host 自己的源上，沿用 DSH 的签名 cookie 鉴权。没有这个 cookie 的远程访问者拿到 401。

## 安装

```sh
dsh plugin add https://github.com/OWNER/dsh-session-delete
```

也可以手工加进 profile——包声明了 `dsh.bundle` manifest，两条路都通：

```json
{
  "dependencies": { "dsh-session-delete": "file:<这个仓库的绝对路径>" },
  "dsh": { "profile": { "bundles": ["...", "dsh-session-delete"] } }
}
```

改完重启 DeepSeek Harness（连托盘一起退干净）。

## 怎么实现的

两个半身，都是纯 JavaScript，没有构建步骤：

- `index.js` —— Host 半身。在 `ctx.webServer` 上注册 `POST/GET /api/dsh-session-delete`，通过 `ctx.get()` 拿到各服务，完成三处清理；这样即使某个组合没有工作区注册表，删日志文件的这一半照样能工作。
- `client.js` —— 浏览器半身。手写的 ModuleLoader bundle，注册一个 `session` 右键菜单项（`order: 700`）和 `shell.overlay` 里的确认框。删除成功后调用 `sessions.refresh()`，由 Host 重新扫描。

## HTTP 路由

`/api/dsh-session-delete`

- `GET ?id=session-<uuid>` —— 只读探查，报告 `logDirs`、`archived`、`pinned`、`running`、`workspaceIds`、`exists`。
- `POST { "sessionId": "session-<uuid>" }` —— 执行删除，返回 `{ removed: [...], failed: [...], clean: boolean }`。

会话 id 必须匹配 `^session-[0-9A-Za-z-]{1,120}$`，其余一律 400，碰不到文件系统。

## 测试

```sh
npm test
```

`test-host.mjs` 在一个临时的 `DSH_HOME` 上驱动 Host 半身，断言三处都被清理、邻近会话没被误伤、运行中的会话被拒、路径穿越形态的 id 被拦。`test-client.mjs` 用桩全局对象求值浏览器 bundle，断言菜单项的 target/order/danger、两种语言，以及确认框的空闲、待确认、运行中三种状态。

## 卸载

从 `dsh.profile.bundles` 和依赖里删掉，重启即可。不调用删除时插件不写任何东西。

## 许可

MIT
