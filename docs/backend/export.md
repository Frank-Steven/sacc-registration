# M4 导出统计设计

> SACC 报名系统后端设计 · M4 实现（[返回后端导航](index.md)）
> 依据：[development.md](../development.md) 四-M4；依赖 M3 报名数据（registration / registration_data）与 M2 权限模型。

## 一、范围与定位

为管理端「名单」与「数据看板」提供两件事，**全部聚合在 wasm 内 SQL 完成**（EAV 不适合前端聚合，见 [data-layer.md](data-layer.md)）：

1. **名单导出**：报名名单分块拉取（表格 / 流式下载）与 CSV 一次性下载，表头按 `form_field` 动态拼装。
2. **聚合统计**：单活动看板（状态分布 / 名额 / 字段分布）、每日报名趋势、跨活动分组列表统计。

## 二、名单导出

### 2.1 两种形态

| 形态 | op | 消费方式 | 适用 |
|---|---|---|---|
| 分块 JSON | `registration.export` | 前端表格（虚拟滚动）/ 流式拼接下载 | 任意规模 |
| CSV 一次性 | `registration.export_csv` | 浏览器下载文件 | 中小活动（≤ 默认 10000 行，见决策 6） |

**分块契约**（`registration.export`）：

- 参数：`activity_id`、`uid`、`cursor`（上一块末尾 `registration_id`，首块 0）、`limit`（默认 1000，上限 5000）、`status`（0~5，可选）、`keyword`（可选）、`created_from` / `created_to`（可选，Unix 秒）
- 返回：`{ total, next_cursor, columns, rows }`
  - `columns`：数组 `[{ key, label }]`，固定列在前、表单动态列按 `sort_order` 在后
  - `rows`：每行 `{ registration_id, [固定列…], fields: { field_key: value } }`
  - `next_cursor`：本块最后一行 `registration_id`；0 表示已到末尾
- 排序：`ORDER BY registration_id ASC`（稳定、与 cursor 自洽）

### 2.2 列装配规则

**固定列**（registration + user 维度）：

| key | 说明 |
|---|---|
| registration_id | 报名 id |
| receipt_no | 凭证编号 |
| name | 报名人姓名（`user.name`） |
| phone / email | 联系方式 |
| status | 状态码（0~5，语义同 [registration.md](registration.md) 二） |
| queue_no | 候补序号（非候补为空） |
| checkin_time / created_at | 签到时间 / 报名时间（Unix 秒，空为 null） |

**动态列**：活动表单中 `is_deleted=0` 且 `is_visible=1` 的字段，按 `sort_order` 排序；`label` 取 `field_label`，`key` 取 `field_key`。

**字段值解析**（`fields` 内）：
- 文本 / 数字 / 日期：原样字符串
- 单选 / 多选：`field_value` 为选项 `value`（多选为 JSON 数组），按 `form_field.options` 映射为**选项标签**；`options` 元素为对象取 `label`、为字符串取自身；无法解析时输出原值（决策 3）
- 文件：原值（路径 / URL）

### 2.3 权限与审计

- `registration.export` / `export_csv`：**`can_manage_activity`**（role 2 可写权限，导出含 PII）；活动不存在或软删 → 404
- 导出动作写 `audit_log`（`action="export_registration"`，detail 含 activity_id、行数、形态）
- `registration.stats` / `trend` / `activity.stats`：`can_read_activity`（role 2/3 可读），不写审计

### 2.4 筛选

- `status`：指定状态（0~5）；不传 = 全部状态（运营需要全量，含草稿 / 取消）
- `keyword`：LIKE 匹配 `user.name` / `receipt_no`，通配符转义（同 `registration_admin_list`，`ESCAPE '\'`）
- `created_from` / `created_to`：按 `registration.created_at` 过滤

## 三、聚合统计

### 3.1 `registration.stats` — 单活动看板

参数：`activity_id`、`uid`；返回：

```json
{
  "status_dist": [{ "status": 0, "count": 1 }, { "status": 1, "count": 2 }],
  "capacity": 100, "taken": 2, "waitlist": 1, "pending": 2, "checked_in": 1,
  "field_dist": [
    { "field_id": 3, "field_key": "college", "label": "专业",
      "items": [{ "value": "cs", "label": "计算机", "count": 5 }] }
  ]
}
```

- `status_dist`：`GROUP BY status`（全部 6 态）
- `taken = status 1+2 数`、`waitlist = status 5 数`、`pending = status 1 数`、`checked_in = checkin_time 非空数`、`capacity = max_slots`
- `field_dist`：对 `is_deleted=0 AND is_visible=1` 的**单选(2) / 多选(3)** 字段做选项计数；统计口径默认 `status IN (1,2,5)`（有效报名，排除草稿/取消/未通过），可传 `status` 覆盖
  - 单选：`GROUP BY d.field_value`
  - 多选：JSON 数组展开计数——若 SQLite 编译含 JSON1 用 `json_each`，否则 wasm 内解析（决策 5）

### 3.2 `registration.trend` — 每日报名趋势

参数：`activity_id`、`uid`、`days`（默认 7，上限 90）；返回 `{ days, items }`（`items` 为 `[{ date, count }]`）：
- `date`：`date(created_at, 'unixepoch')`（UTC 日期，前端转本地，决策 8）
- `count`：按天统计**提交数**（`status IN (1,2,3,4,5)`，不含草稿）；无记录的天补 0（wasm 内补全）

### 3.3 `activity.stats` — 跨活动列表统计

参数：`uid`、`group_id`（可选，默认授权全范围）、`page` / `page_size`（默认 20，上限 100）、`keyword`、`date_from` / `date_to`（按 `start_time` 可选）

返回：`{ total, rows }`；每行：

```json
{ "activity_id": 1, "name": "…", "status": 1, "start_time": 0, "end_time": 0,
  "max_slots": 100, "need_review": 0,
  "total": 50, "taken": 49, "pending": 5, "waitlist": 1, "checked_in": 30 }
```

- 范围：基础权限 `has_any_admin_role`（角色 1/2/3 可查）；传入 `group_id` **不校验是否在授权范围内**，直接以该分组子树（含子分组，递归）为统计范围
- 计数用相关子查询（每活动 ≤ 4 次 COUNT，走 `registration(activity_id, status)` 索引）

## 四、接口契约

宿主路由（管理端，均需 JWT）：

| 方法 | 路径 | op | 说明 |
|---|---|---|---|
| GET | `/api/admin/activities/:id/export` | `registration.export` | 分块 JSON（query: cursor/limit/status/keyword/created_from/created_to） |
| GET | `/api/admin/activities/:id/export.csv` | `registration.export_csv` | CSV 下载（`Content-Disposition: attachment`） |
| GET | `/api/admin/activities/:id/stats` | `registration.stats` | 单活动看板 |
| GET | `/api/admin/activities/:id/trend` | `registration.trend` | 每日趋势（query: days） |
| GET | `/api/admin/activities/stats` | `activity.stats` | 跨活动列表（query: group_id/page/page_size/keyword/date_from/date_to） |

统一返回 `{ code, data, message }`；`export_csv` 的 `data.csv` 为 UTF-8 **带 BOM** 文本（Excel 中文兼容）。

## 五、业务规则

- 状态枚举、名额语义与 [registration.md](registration.md) 一致
- 软删：活动软删不可导出（404）；已软删字段不参与列装配（历史值不导出，库内可追溯）
- CSV 转义：字段含逗号 / 引号 / 换行时按 RFC 4180 转义
- 导出 limit 超上限 → **钳制到 5000**（`kMaxExportLimit`，行为宽容不报错）；`cursor` **< 0 → 422**，**非整数字串按 0 处理**（首块）

## 六、性能与索引

| 查询 | 走索引 | 说明 |
|---|---|---|
| 导出主查询（activity + status + created_at + ORDER BY registration_id） | `idx_registration_activity_uid`（前缀 activity_id）/ `idx_registration_activity_status` | 现有 |
| 行内字段值（`registration_data WHERE registration_id IN (…)`） | `idx_registration_data_reg` | 现有 |
| 字段分布（`registration_data WHERE field_id=?`） | **新增** | `registration_data` 现无 `field_id` 索引（[0001_init.sql](../../db/migrations/0001_init.sql#L213-L220)），全表扫 |
| 状态分布 / 相关子查询计数 | `idx_registration_activity_status` | 现有 |
| 跨活动分组过滤 | `idx_activity_group_group` | 现有 |

**迁移 0004**：`CREATE INDEX IF NOT EXISTS idx_registration_data_field ON registration_data (field_id);`

导出内存：单块上限 5000 行 × 字段数；CSV 单次全量在 wasm 内存拼装，受 `max_csv_rows` 限制（默认 10000）。

## 七、错误码

复用 [config.md](config.md) 三 约定：403（越权）/ 404（活动不存在或软删）/ 422（参数非法）/ 2001（DB 错误）。导出增加 `max_csv_rows` 超限提示 422（message 引导使用分块接口）。

## 八、实现计划

1. **backend**：`src/data/export.h/cpp`（新模块）
   - `registration_export`（cursor 分块 + 列装配 + 字段值解析 + 选项标签映射）
   - `registration_export_csv`（复用装配 → RFC 4180 写入，带 BOM）
   - `registration_stats`（状态分布 / 名额 / 字段分布，多选展开）
   - `registration_trend`（按天分组 + 补 0）
   - `activity_stats`（跨活动计数 + 分组范围过滤）
2. **dispatch.cpp**：注册 5 个 op（`registration.export` 等归 registration 前缀；`activity.stats` 单独精确分支）
3. **迁移**：`db/migrations/0004_registration_data_field_index.sql`（决策 7 的索引）
4. **host**：`routes.js` 5 条管理端路由（export.csv 设置 Content-Disposition；数据量大时 host 侧分块转发 csv）
5. **测试**：
   - native ctest：列装配（固定 + 动态列、软删字段排除）、单选/多选标签映射、CSV 转义（逗号/引号/换行/BOM）、状态分布与字段分布口径、多选展开、cursor 分块连续性与 total、权限（导出需 manage / 统计 read）、0004 迁移加载
   - host smoke：HTTP 导出 JSON 分块、CSV 下载头与内容、stats/trend/activity.stats 全链路
6. **文档**：本页导航登记 [index.md](index.md)；[development.md](../development.md) M4 链接

## 九、决策记录

| # | 决策 | 理由 |
|---|---|---|
| 1 | 分块用 `cursor`（registration_id 递增）而非 `offset` | 深翻页偏移不稳定；导出顺序天然稳定 |
| 2 | 导出（含 PII）须 `can_manage_activity` + `audit_log`；统计仅 `can_read_activity` | 名单含姓名/手机/邮箱，导出可追溯；聚合数据无敏感明细 |
| 3 | 单选/多选导出**选项标签**（`options` 映射），无法解析输出原值 | 表格/CSV 可读性；对 options 旧数据容错 |
| 4 | 字段分布默认口径 `status IN (1,2,5)`，可传 `status` 覆盖 | 排除草稿/取消/未通过，反映有效报名；口径可切换 |
| 5 | 多选计数优先 `json_each`（SQLite JSON1），缺失则 wasm 内解析 | 避免依赖编译选项；实现时 `sqlite_compileoption_used('JSON1')` 探测 |
| 6 | CSV 单次导出上限 `max_csv_rows`（默认 10000），超出引导分块接口 | 防 wasm 内存膨胀；大活动走 cursor 流式 |
| 7 | 新增 `idx_registration_data_field(field_id)`（迁移 0004） | 字段分布查询 `WHERE field_id=?` 避免全表扫 |
| 8 | trend 按 UTC 日期分组，前端转本地时区 | wasm 环境 TZ 不确定（可能 UTC），不隐式依赖 localtime |
| 9 | 导出默认含全部状态（含草稿/取消），由筛选控制 | 运营需全量回溯；不预设口径 |
