# 报名链路（M3 实现）

> SACC 报名系统后端设计（[返回后端导航](index.md)）· 对应里程碑 M3 报名链路
>
> **范围**：报名草稿 / 分步保存 / 提交 / 修改 / 取消、名额与候补队列（防超卖 / 同步递补）、审核、签到、通知（站内信 / 邮件 / 订阅提醒）。表结构见 [data-layer.md](data-layer.md) 与迁移 `0001_init.sql`（`registration` / `registration_data` / `notification` / `subscribe` / `user_notify_pref`），实现见 [development.md](../development.md) M3。

## 一、报名状态机

### 1.1 状态枚举（`registration.status`）

| status | 名称 | 占名额 | 说明 |
|---|---|---|---|
| 0 | 填写中（草稿） | ❌ | 分步保存中，未提交 |
| 1 | 待审核 | ✅ | 已提交，`need_review=1` |
| 2 | 已通过 | ✅ | 提交直接通过 或 审核通过 |
| 3 | 未通过 | ❌ | 审核驳回，可修改后重新提交 |
| 4 | 已取消 | ❌ | 用户取消，名额已释放 |
| 5 | 候补 | ❌ | 满员时入队，有名额递补 |

> **名额占用语义（决策）**：仅「待审核 + 已通过」占用名额；候补 / 未通过 / 填写中 / 已取消均不占。

### 1.2 状态转移表

| 当前状态 | 触发事件 | 下一状态 | 条件 / 说明 |
|---|---|---|---|
| 0 | 提交 | 1 待审核 | `need_review=1` 且有名额 |
| 0 | 提交 | 2 已通过 | `need_review=0` 且有名额 |
| 0 | 提交 | 5 候补 | 名额已满（防超卖兜底） |
| 1 | 审核通过 | 2 已通过 | 写入 `reviewer` / `review_time` |
| 1 | 审核驳回 | 3 未通过 | 写入 `review_remark`；**释放名额 + 同步递补** |
| 3 | 修改后重新提交 | 1 待审核 | `allow_modify=1`，有名额（`need_review=1`） |
| 3 | 修改后重新提交 | 2 已通过 | `allow_modify=1`，有名额（`need_review=0`） |
| 3 | 修改后重新提交 | 5 候补 | `allow_modify=1`，名额已满 |
| 0 / 1 / 2 / 5 | 用户取消 | 4 已取消 | 截止前；**释放名额 + 同步递补**（`queue_no` 清空） |
| 0 | 修改保存 | 0 | 草稿继续编辑 |
| 1 | 修改保存 | 1 | 待审核直接改字段，**不回退、不释放名额**（见决策） |
| 5 | 有名额递补 | 1 待审核 | 同步递补，`need_review=1` |
| 5 | 有名额递补 | 2 已通过 | 同步递补，`need_review=0` |
| 2 | 活动结束 | 2 | 历史状态归档，不做转移 |

> **与 data-layer.md 的差异**：原「待审核修改保存 → 回退 0 填写中」调整为**保持待审核**——避免修改期间名额被递补抢占（回退即释放名额的连锁问题），并减少一次提交路径。取消仍必须释放名额并递补。

## 二、名额与候补队列

### 2.1 防超卖

- 所有占用名额的动作（提交 / 重新提交 / 递补）在 **`BEGIN IMMEDIATE` 事务**内完成；宿主对 wasm 写调用串行化，SQLite 单写者保证无并发插入。
- 占位判定：事务内 `SELECT COUNT(*) FROM registration WHERE activity_id=? AND status IN (1,2)`。
  - `max_slots == 0`（不限）直接放行。
  - `count < max_slots` → 正常进入 1 / 2。
  - `count >= max_slots` → 进入候补 5。

### 2.2 候补队列

- 入队：`queue_no = (SELECT IFNULL(MAX(queue_no),0)+1 FROM registration WHERE activity_id=? AND status=5)`，事务内保证连续无重。
- 递补成功：`queue_no` 置 NULL（不再排队）。
- 取消 / 驳回释放名额后，**同一事务内**取出该活动 `queue_no` 最小（`ORDER BY queue_no ASC LIMIT 1`）的候补记录，按 `need_review` 递补为 1 / 2，并写入通知。即「同步递补」，无定时任务、无延迟、无需中间态。

### 2.3 递补链路（无独立 op）

`cancel` / `review`（驳回）→ 释放名额 → 内部 `promote_waitlist(activity_id)` 递补队首 → 全部在**同一事务**内提交。

## 三、报名流程

### 3.1 创建草稿 `registration.create`

- 校验：活动 `status==1` 且 `now ∈ [start_time, end_time]`（可报名窗口）、未软删。
- `(activity_id, uid)` 唯一：已存在 **status=4（已取消）** 记录 → **复用该行重置为草稿**（清空 `receipt_no` / `queue_no` / `review_*` / 字段明细）；存在其他状态记录 → 409「已报名，请勿重复报名」。
- 新建草稿 `status=0`，不占名额。

### 3.2 分步保存 `registration.save`

- 允许状态：0（填写中）、1（待审核，`allow_modify=1` 时）。
- 入参 `fields[]`（`{ field_id, value }`，可增量，缺失字段保留原值）+ `current_step`；`registration_data` 按 `(registration_id, field_id)` upsert。
- 保存不校验必填 / validation（提交时才校验），不占名额。

### 3.3 提交 `registration.submit`

- 允许状态：0（草稿）、3（未通过重新提交，需 `allow_modify=1`）。
- 流程（单事务）：窗口校验 → 字段完整性校验（见第四节）→ 名额判定 → 置 1 / 2 / 5 → 首次提交生成 `receipt_no`（格式 `R{activity_id}-{registration_id}`，唯一不可改）→ 写通知（见第七节）→ 提交。
- 重新提交（3→1/2/5）：清空 `reviewer` / `review_time` / `review_remark`，重新走名额判定；满员转候补（决策）。

### 3.4 修改 `registration.save`（已提交记录）

- `allow_modify=1` 且 `now < end_time` 且活动 `status==1`：待审核（1）记录直接编辑字段，**保持 1 不回退**；已通过（2）不开放修改（如需改走取消后重报）。

### 3.5 取消 `registration.cancel`

- 允许状态：0 / 1 / 2 / 5；条件 `now < end_time` 且活动未删除。
- 事务内：置 4 → 清 `queue_no` → 释放名额 → `promote_waitlist` 同步递补 → 写通知（报名端可见「已取消」）。

## 四、字段校验（`registration.submit` 时）

按活动 `form`（未删）→ `form_field`（未删，`is_visible=1`）顺序校验每份提交：

| 规则 | 说明 |
|---|---|
| 必填 | `is_required=1` 且值为空 → 422（`field_label` 提示） |
| 类型 | 数字固定格式 / 日期 `YYYY-MM-DD` / 文件存路径或 URL |
| 选项 | 单选 / 多选值必须 ∈ `options`（多选为 JSON 数组） |
| validation | `min` / `max`（数字）、`min_length` / `max_length`（文本）、`regex`（文本）、`min_items` / `max_items`（多选）；类型不符 422 |
| 字段冻结 | 已删字段 / 不存在的 `field_id` → 422 |

- 校验失败统一 422，`message` 指出首个失败字段；**已提交部分数据保留**（可修改后重提）。
- 预填：前端从 `user_common_info` / `user` 基础资料预填，后端不做自动补齐（避免隐式改值）。

## 五、审核

- 权限：授权分组内的活动管理员 / 审核员（审核属审核员职责）；超管全部。
- `registration.review(registration_id, approve, review_remark)`：
  - 通过：1 → 2，写 `reviewer` / `review_time`。
  - 驳回：1 → 3，写 `reviewer` / `review_time` / `review_remark`；**释放名额 + 同步递补**。
- 结果写入 `notification`（type 1 审核结果），并记 `audit_log`（`action=review_registration`，`target=registration:{id}`，`detail` 含 approve / remark）。

## 六、签到

签到模式由活动配置 `checkin_mode` 决定：`0` 现场扫码（管理员） / `1` 线上自助（用户直接签） / `2` 线上动态码（主办方屏幕展示动态码，用户扫码或输码签到）。

| op | 场景 | 校验 |
|---|---|---|
| `checkin.do` | 管理员现场扫码 / 手动（按 `registration_id` 或 `receipt_no`） | 授权分组内；状态==2 已通过；未签到（已签到 409） |
| `checkin.mine` | 用户线上自助（`checkin_mode=1`） | 本人记录；状态==2；未签到 |
| `checkin.code` | 用户线上扫码 / 输码（`checkin_mode=2`） | 本人记录；状态==2；未签到；**动态码匹配** |
| `checkin.code_current` | 主办方获取当前动态码（供屏幕展示） | 授权分组内管理员 / 审核员 |

- 写入 `checkin_time = now`；`checkin.do` 记 `audit_log`（`action=checkin_registration`）。
- 重复签到 409「该报名已签到」。

### 6.1 动态签到码（TOTP 风格，无状态）

- **密钥**：系统级 `system_config.checkin_secret`（`config_type=2` 文本，仅超管可写；M3 加入 key 白名单）。未配置时动态码接口返回 422「未配置签到密钥」。
- **算法**：`code = 6 位数字 = HMAC-SHA256(secret, "sacc-checkin:" + activity_id + ":" + time_slot)` 输出截取 4 字节转 `uint32 mod 1_000_000` 补零；`time_slot = floor(now / 60)`（**每 60 秒轮换**）。
- **校验容差**：接受「当前槽 + 前 1 槽」两个码（防跨槽边界误拒），即每个码有效期最多约 2 分钟。
- **优势**：无状态（不落库、无需轮换定时任务）、复用 wasm 内 HMAC-SHA256（与 PBKDF2 共用实现）、每活动码独立（绑定 `activity_id`）、时区无关（Unix 秒）。
- **前端**：主办方管理页轮询 `checkin.code_current` 展示大数字 / 二维码（二维码内容即码值，相机扫码后回传 `code`）；用户端校验在 wasm 内完成。

## 七、通知

### 7.1 触发点（wasm 内直写 `notification`）

| 事件 | type | 内容 | 渠道 |
|---|---|---|---|
| 提交成功（→1/2） | 0 报名成功 | 活动名 + 凭证号 | 活动 `notify_channel`（0 站内信 / 1 邮件） |
| 满员入候补（→5） | 3 候补 | 候补序号 | 同上 |
| 递补成功（5→1/2） | 3 候补 | 递补通知 | 同上 |
| 审核结果（1→2/3） | 1 审核结果 | 通过 / 驳回理由 | 同上 |
| 活动开始提醒 | 2 活动提醒 | 即将开始 | 见 7.3 |

- 站内信：`channel=0`，`send_status=1`（直写即达）。
- 邮件：`channel=1`，`send_status=0`（待发送），由宿主 SMTP 定时任务发送并置 1 / 失败置 2（重试，见 [development.md](../development.md) 五）。
- 渠道选择优先 `user_notify_pref`，未配置按活动 `notify_channel`；无邮箱（`user.email` 空）时降级站内信。

### 7.2 通知查询 ops

| op | 说明 |
|---|---|
| `notification.mine` | 分页 + `unread_only` 过滤 |
| `notification.unread_count` | 未读数 |
| `notification.read` | 标记单条已读（本人） |
| `notification.read_all` | 全部已读 |

### 7.3 订阅提醒（宿主定时任务 `task/notify.js`）

- `subscribe.add / remove / mine`：用户订阅活动。
- 宿主周期扫描：对 `start_time ∈ (now, now + 1h)` 的活动，给「订阅者 + 已通过报名者」生成 type 2 提醒。
- **时间语义**：当前数据模型 `activity.start_time/end_time` 为报名窗口（[config-layer.md](config-layer.md) 3.1），活动本身无独立开始时间字段；`start_time` 同时兼作活动开始时间供提醒使用（提醒触发于报名开启前 1 小时窗口内）。若后续需要"活动举办时间"与"报名窗口"分离，另加 `activity_start_time` 列。
- **幂等**：按 `(uid, type=2, activity_id)` 判重（0003 迁移新增 `notification.activity_id` 列），同活动仅发一次；不再依赖 content 字符串，活动同名不误判。

## 八、接口契约

统一响应 `{ code, data?, message? }`；错误码复用现有登记，详见 [errors.js](../../host/src/errors.js)。

### 8.1 wasm ops（`wasm_invoke` 分发）

**报名**

| op | 参数 | 返回 `data` | 错误 |
|---|---|---|---|
| `registration.create` | `activity_id` | `{ registration_id, status }` | 403 未登录 / 404 活动不可见 / 409 已报名 / 422 不在报名窗口 |
| `registration.save` | `registration_id` `fields[]` `current_step` | `{ ok: true }` | 404 / 409 状态不允许 |
| `registration.submit` | `registration_id` | `{ status, receipt_no, queue_no? }` | 404 / 409 状态不允许或不在窗口 / 422 校验失败 / 403 非本人 |
| `registration.cancel` | `registration_id` | `{ ok: true }` | 404 / 409 状态不允许或已截止 |
| `registration.detail` | `registration_id` | `{ registration, items[] }`（含字段 label / value） | 403 非本人 / 404 |
| `registration.mine` | `page` `page_size` `status` | `{ items[], total }` | 403 |
| `registration.admin_list` | `activity_id` `page` `page_size` `status` `keyword` | `{ items[], total }` | 403 活动不在授权范围 |
| `registration.admin_detail` | `registration_id` | `{ registration, user, items[] }` | 403 / 404 |

**审核 / 签到**

| op | 参数 | 返回 `data` | 错误 |
|---|---|---|---|
| `registration.review` | `registration_id` `approve` `review_remark` | `{ ok: true }` | 403 无审核权限 / 409 状态非待审核 |
| `checkin.do` | `registration_id` 或 `receipt_no` | `{ ok: true, checkin_time }` | 403 / 404 / 409 状态非已通过或已签到 |
| `checkin.mine` | `registration_id` | `{ ok: true, checkin_time }` | 403 / 409 非线上模式或状态不符或已签到 |
| `checkin.code` | `activity_id` `code` | `{ ok: true, checkin_time }` | 403 / 409 非动态码模式或状态不符或已签到 / 422 码错误或过期 |
| `checkin.code_current` | `activity_id` | `{ code, expires_in }` | 403 活动不在授权范围 / 422 未配置密钥 |

**通知 / 订阅**

| op | 参数 | 返回 `data` | 错误 |
|---|---|---|---|
| `notification.mine` | `page` `page_size` `unread_only` | `{ items[], total }` | 403 |
| `notification.unread_count` | - | `{ count }` | 403 |
| `notification.read` | `notification_id` | `{ ok: true }` | 403 非本人 / 404 |
| `notification.read_all` | - | `{ ok: true }` | 403 |
| `subscribe.add` | `activity_id` | `{ ok: true }` | 404 活动不存在 / 409 已订阅 |
| `subscribe.remove` | `activity_id` | `{ ok: true }` | 404 |
| `subscribe.mine` | - | `[ activity ]` | 403 |

> 以上报名端 ops 均为本人 / 登录维度鉴权（uid 入参）；`registration.admin_*` / `registration.review` / `checkin.do` 走 M2 分组范围权限判定。

### 8.2 host HTTP 路由

报名端（需 Bearer token）：

| 方法 | 路径 | wasm op |
|---|---|---|
| POST | `/api/activities/:id/registration` | `registration.create` |
| GET | `/api/me/registrations` | `registration.mine` |
| GET | `/api/me/registrations/:rid` | `registration.detail` |
| PUT | `/api/me/registrations/:rid` | `registration.save` |
| POST | `/api/me/registrations/:rid/submit` | `registration.submit` |
| POST | `/api/me/registrations/:rid/cancel` | `registration.cancel` |
| POST | `/api/me/registrations/:rid/checkin` | `checkin.mine` |
| POST | `/api/me/checkin/code` | `checkin.code`（body `activity_id` + `code`，扫码 / 输码） |
| GET | `/api/me/notifications` | `notification.mine` |
| GET | `/api/me/notifications/unread-count` | `notification.unread_count` |
| PUT | `/api/me/notifications/:nid/read` | `notification.read` |
| PUT | `/api/me/notifications/read-all` | `notification.read_all` |
| POST / DELETE | `/api/me/subscribe/:activityId` | `subscribe.add` / `subscribe.remove` |
| GET | `/api/me/subscribes` | `subscribe.mine` |

管理端 `/api/admin/*`（权限透传同 M2）：

| 方法 | 路径 | wasm op |
|---|---|---|
| GET | `/api/admin/activities/:id/registrations` | `registration.admin_list` |
| GET | `/api/admin/registrations/:rid` | `registration.admin_detail` |
| POST | `/api/admin/registrations/:rid/review` | `registration.review`（body `approve` / `review_remark`） |
| POST | `/api/admin/registrations/:rid/checkin` | `checkin.do` |
| POST | `/api/admin/checkin/receipt` | `checkin.do`（body `receipt_no`，扫码场景） |
| GET | `/api/admin/activities/:id/checkin-code` | `checkin.code_current`（主办方屏幕轮询动态码） |

## 九、业务规则汇总

- **时间边界**：创建 / 提交 / 修改需活动 `status==1` 且 `now ∈ [start_time, end_time]`；取消需 `now < end_time`；签到无时间限制（结束后仍可补签）。
- **唯一性**：`(activity_id, uid)` 一人一报；已取消记录可复用重置，不可重复创建新行。
- **权限**：报名端 ops 本人维度；管理端按 M2 分组范围（审核 / 签到允许活动管理员与审核员，属审核员职责）。
- **事务**：提交 / 取消 / 驳回 / 递补均在 `BEGIN IMMEDIATE` 内，保证名额一致与候补序号连续。
- **审计**：`review`、`checkin.do` 记 `audit_log`；报名 / 取消 / 递补属用户侧行为不记审计。

## 十、错误码

复用现有登记：`403` 权限 / 非本人、`404` 不存在或不可见、`409` 状态冲突 / 已报名 / 已签到 / 已截止、`422` 参数与字段校验失败。无新增错误码。

## 十一、实现计划

- **backend 新增 `src/data/`**：
  - `registration.cpp/h`：create / save / submit / cancel / detail / mine / admin_list / admin_detail + `promote_waitlist` + 名额判定 + `receipt_no` 生成
  - `validation.cpp/h`：字段校验（必填 / 类型 / options / validation JSON）
  - `review.cpp/h`：审核通过 / 驳回（驳回触发递补）
  - `checkin.cpp/h`：`checkin.do` / `checkin.mine` / `checkin.code` / `checkin.code_current` + TOTP 动态码（HMAC-SHA256 + 时间槽，复用 M1 哈希实现）
  - `notification.cpp/h`：`notify()` 写入 helper（按偏好选渠道）+ 查询 ops
  - `subscribe.cpp/h`：订阅 add / remove / mine
- **config.cpp**：`system_config` key 白名单新增 `checkin_secret`（`config_type=2`，仅超管）；`checkin_mode` 枚举扩展 2=线上动态码（`activity_config` 注释同步）
- **dispatch.cpp**：注册 `registration.` / `checkin.` / `notification.` / `subscribe.` 前缀与 op。
- **host**：`/api/me/*` 报名端路由（JWT）；`/api/admin/*` 管理端新增路由；`task/notify.js` 订阅提醒定时任务；SMTP 发送队列（`send_status=0` → 1/2）。
- **测试**：native 单测（状态机全部转移 / 防超卖与候补序号 / 同步递补 / 字段校验 / 审核权限）；host smoke（HTTP 全链路：报名→提交→审核→签到→通知→取消→递补）。

## 十二、决策记录

| 项 | 决策 |
|---|---|
| 递补时机 | **同步递补**：取消 / 审核驳回同一事务内递补候补队首，无定时器、无中间态 |
| 签到方式 | 管理员扫码（`checkin.do`）+ 用户线上自助（`checkin.mine`，`checkin_mode=1`）+ **线上动态码**（`checkin_mode=2`，TOTP 风格无状态码，主办方展示 / 用户扫码） |
| 名额占用 | 仅「待审核 + 已通过」占名额；候补 / 未通过 / 草稿 / 已取消不占 |
| 重新提交满员 | 未通过重新提交满员 → **转候补续排**，不拒绝 |
| 待审核修改 | 保持待审核状态不回退、不释放名额（修正 data-layer.md，避免修改期被递补） |
| 已取消复用 | `(activity_id, uid)` 唯一，取消后复用原行重置为草稿，不产生历史堆积 |
| 通知枚举 | `notification.type` 扩展 3=候补（原 0/1/2 不变，不改表结构） |
| 订阅提醒幂等 | 宿主用「已收 type 2 通知的 uid 差集」保证不重复提醒，不新增状态表 |
