# AI Agent PlayStation Connector

[English](README.md) · [MIT 许可证](LICENSE)

查 PlayStation 官方游戏页面，沿版本链接获取区域商店报价，还能查看索尼在当地 PlayStation Plus 页面列出的本月游戏。

## 直接连接

在支持远程 MCP 的客户端粘贴这个地址，传输方式选 **Streamable HTTP**。公开查询免登录，无需申请 API Key。

```text
https://playstation-mcp.oratisoratisoratisoratis.workers.dev/mcp
```

**Codex**

```sh
codex mcp add playstation --url https://playstation-mcp.oratisoratisoratisoratis.workers.dev/mcp
```

**Claude Code**

```sh
claude mcp add --transport http --scope user playstation https://playstation-mcp.oratisoratisoratisoratis.workers.dev/mcp
```

配置后在 Codex 新开对话，或在 Claude Code 输入 `/mcp` 查看连接状态。

## 能连接我的 PSN 账户吗？

托管版目前**仅提供公开查询**。索尼支持第三方应用授权，玩家可以在账户管理中解除关联。当前 `oratis` 没有获批的 Sony 应用和 PSN 游戏数据权限，因此添加本地址后会直接打开公开工具。 [索尼授权应用说明](https://www.playstation.com/en-us/support/account/manage-authorized-apps/) · [PlayStation Partners](https://partners.playstation.net/)

| 个人数据 | 本次验证结果 |
| --- | --- |
| 已购游戏库、个人 Plus 权益 | 无法读取。区域商店和月度名单仅展示当地供应情况。 |
| 已获得的奖杯 | 无法读取。当前部署无获授权的奖杯数据源。 |
| 每款游戏的游玩时长 | 无法读取。此次没有取得个人活动记录。 |

线上测试覆盖美国站的四个公开工具。此次没有真实 PSN 授权或个人数据可供验证。接入需要索尼为此应用批准回调地址、授权范围和数据接口，再使用同意授权的玩家账号测试。

## 试一句

> 查《宇宙机器人》美区标准版的价格和币种，再列出美区 PlayStation Plus 页面上的本月游戏，附官方链接。

用英文名 `astro bot` 搜索，从 `astro-bot` 游戏页取当地版本的 `product_id`，再交给 `store_offer`。不同版本有各自的产品 ID。`monthly_games` 单独读取当地 Plus 页面。

## 工具与数据范围

| 工具 | 参数 | 返回内容 |
| --- | --- | --- |
| `search_games` | `query`, `region`, `limit` | 在区域官网游戏页面目录中搜索，返回 slug 和链接 |
| `game_details` | `slug`, `region` | 官方标题、摘要和相关商店产品 ID |
| `store_offer` | `product_id`, `region` | 商店标题、版本类别、可用报价和币种 |
| `monthly_games` | `region` | 官方月份标题、月度游戏名单和区域 Plus 页面 |

支持美区 `en-us`（默认）和英区 `en-gb`。搜索覆盖官网英文游戏目录，只涵盖商店中的一部分游戏。部分页面没有关联版本或公开报价。月度名单以索尼当地页面为准。此版本不读取个人会员资格、PSN 奖杯或已购游戏。

## 架构

每个请求在 Cloudflare Worker 中创建独立的 MCP 服务与 HTTP 传输。输入校验通过后才访问平台。客户端可以读取结构化 JSON 或等价的文本结果，上游异常会作为工具错误返回。

平台适配层从索尼区域站点地图提取游戏页面路径，从游戏页提取版本链接，再读取商店的 Product JSON-LD。Plus 工具单独解析当地官方更新页中的月度游戏栏目，同时返回栏目所属的月份标题。

查询关键词或标识符会发送到相应平台。服务无需平台账号凭据或账户数据库。

[PlayStation games](https://www.playstation.com/en-us/games/) · [PlayStation Store](https://store.playstation.com/en-us/) · [PlayStation Plus monthly games](https://www.playstation.com/en-us/ps-plus/whats-new/)

## 本地运行与自托管

需要 Node.js 24 或以上版本。

```sh
git clone https://github.com/oratis/AI-Agent-PlayStation-Connector.git
cd AI-Agent-PlayStation-Connector
npm ci
npm run check
npm test
npm run dev
```

在另一个终端运行端到端验证。脚本会完成 MCP 握手、发现工具，再调用真实平台数据。

```sh
npm run smoke -- http://localhost:8787/mcp
```

直接执行 `npm run smoke` 可验证公开服务。`npm test` 使用离线测试数据。自托管时登录自己的 Cloudflare 账户，执行 `npm run deploy`，把部署地址加上 `/mcp` 即可交给客户端。

## 常见连接问题

- 浏览器直接打开 `/mcp` 会收到 HTTP 405。查看[服务信息](https://playstation-mcp.oratisoratisoratisoratis.workers.dev/)可确认地址，完整验证请用上面的 smoke 命令。
- 如果可以列出工具，但查询返回上游错误，请核对地区和标识符后重试。

由 [oratis](https://github.com/oratis) 独立维护。同系列连接器 · [AI Agent Steam Connector](https://github.com/oratis/AI-Agent-Steam-Connector) · [AI Agent Nintendo Connector](https://github.com/oratis/AI-Agent-Nintendo-Connector)。
