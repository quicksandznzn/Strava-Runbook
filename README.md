# Run Strava

本地 Strava 跑步数据仪表盘。支持手动同步数据到 SQLite，并提供可视化分析与 AI 跑步解读。

## Features

- 手动 CLI 同步 Strava 跑步活动（仅 `Run`）
- 总览 KPI：总跑步次数、总里程、平均配速、总爬升
- 周趋势图：周里程、周均配速
- 跑步记录表：分页、排序、日期筛选
- 年/月快速筛选：例如 `2026年 -> 1月/2月/3月`
- 单次详情：路线地图、分段配速
- AI 分析：调用本机 Codex CLI 生成训练建议
- AI 分析持久化：每次生成写入 SQLite，重新生成覆盖上一次
- 训练日历：月视图展示训练计划和完成状态
- 训练计划管理：添加、编辑、删除每日训练计划
- 计划完成度：AI 分析结合训练计划评估完成情况

## Tech Stack

- Frontend: React + Vite + TypeScript + Recharts + Leaflet
- Backend: Node.js + Express + TypeScript
- Database: SQLite (`better-sqlite3`)
- CLI: Commander + TypeScript
- Test: Vitest + Testing Library + Supertest

## Project Structure

```text
src/
  cli/        # Strava 同步命令与 API 客户端
  db/         # SQLite schema 与 repository
  server/     # Express API
  shared/     # 前后端共享类型
  web/        # React 页面
data/         # 本地数据库目录（默认 data/strava.db）
```

## Quick Start

### 1) 安装依赖

```bash
npm install
```

### 2) 配置环境变量

```bash
cp .env.example .env
```

`.env` 示例：

```env
STRAVA_ACCESS_TOKEN=your_strava_access_token
STRAVA_DB_PATH=data/strava.db
PORT=8787
```

### 3) 同步数据

全量：

```bash
npm run strava:sync -- --full
```

增量（从指定日期）：

```bash
npm run strava:sync -- --from 2023-01-01
```

### 4) 启动开发服务

```bash
npm run dev
```

- Web: [http://localhost:5173](http://localhost:5173)
- API: [http://localhost:8787](http://localhost:8787)

## Strava Token 获取

1. 打开授权链接（替换 `CLIENT_ID`）：

```text
https://www.strava.com/oauth/authorize?client_id=CLIENT_ID&redirect_uri=http%3A%2F%2Flocalhost%2Fexchange_token&response_type=code&approval_prompt=force&scope=read,activity:read_all
```

2. 授权后从回调 URL 中复制 `code`。
3. 用 `code` 换取 token：

```bash
curl -X POST https://www.strava.com/api/v3/oauth/token \
  -d client_id=YOUR_CLIENT_ID \
  -d client_secret=YOUR_CLIENT_SECRET \
  -d code=YOUR_CODE \
  -d grant_type=authorization_code
```

4. 将响应中的 `access_token` 写入 `.env` 的 `STRAVA_ACCESS_TOKEN`。

## Scripts

```bash
npm run dev                # 前后端开发模式
npm run dev:web            # 仅前端
npm run dev:api            # 仅后端
npm run strava:sync -- --full
npm run build              # 类型检查 + 前端构建
npm run test               # 测试
npm run test:coverage      # 覆盖率
```

## API

### Activities & Analysis

- `GET /api/health`
- `GET /api/summary?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/trends/weekly?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/filters/calendar`
- `GET /api/activities?page=1&pageSize=20&sortBy=start_date_local|distance_m|pace_sec_per_km&sortDir=asc|desc`
- `GET /api/activities/:id`
- `GET /api/activities/:id/analysis`
- `POST /api/activities/:id/analysis`，body: `{ "force": true|false }`

### Training Plans

- `POST /api/training-plans` - 创建训练计划
  - Body: `{ "date": "YYYY-MM-DD", "planText": "训练内容" }`
  - Returns: `201` 成功，`409` 日期冲突
- `GET /api/training-plans/:date` - 获取指定日期的训练计划
  - Returns: `200` 成功，`404` 未找到
- `PUT /api/training-plans/:date` - 更新训练计划
  - Body: `{ "planText": "新内容" }`
  - Returns: `200` 成功，`404` 未找到
- `DELETE /api/training-plans/:date` - 删除训练计划
  - Returns: `200` (幂等操作)
- `GET /api/training-plans?from=YYYY-MM-DD&to=YYYY-MM-DD` - 获取日期范围内的训练计划

### Calendar

- `GET /api/calendar/daily-summary?year=2026&month=1` - 获取月度日历摘要
  - 包含每日的训练计划、活动记录、完成状态（completed/missed/no_plan）

## Timezone

- 页面显示、日期筛选、周趋势分组统一按 **上海时区（UTC+8 / Asia/Shanghai）**。

## AI Analysis Notes

- 依赖本机 `codex` 命令可用并已登录：

```bash
codex login
```

- 若未安装/未登录，点击"AI分析"会返回后端错误提示。
- AI 分析会自动查询当日训练计划，如果存在计划，分析结果会包含"计划完成度"部分，评估实际完成与计划目标的对比。

## Training Calendar Usage

1. 访问"训练日历"页面查看月度视图
2. 点击任意日期打开侧边栏，查看该日的训练计划和活动记录
3. 在侧边栏中可以：
   - 添加或编辑训练计划
   - 查看当日完成的活动
   - 删除训练计划
4. 日历格子显示完成状态：
   - 绿色：已完成计划
   - 红色：有计划但未完成
   - 灰色：无计划

## Testing

```bash
npm test
npm run test:coverage
```

测试覆盖：
- 后端 API endpoints（app.test.ts）
- Repository 数据层（repository.test.ts）
- React 组件（CalendarPage.test.tsx, TrainingPlanEditor.test.tsx）
- CLI 工具（strava.test.ts）

## Upload to GitHub Checklist

- 确认 `.env` 未提交
- 确认 `data/*.db` 未提交
- 可选：补充截图到 `docs/`，并在 README 中引用

## License

ISC
