// 通知任务（registration.md 7.3 / development.md 五）：
// - 活动提醒：扫描 start_time ∈ (now, now+lookahead) 的活动，给「订阅者 + 已通过报名者」
//   生成 type 2 提醒；幂等按 (uid, type=2, activity_id) 判重（0003 迁移新增 activity_id 列）。
//   批量取数（一次扫描 3~4 次 wasm 往返，与目标人数无关），避免 N+1。
// - 邮件队列：channel=1 且 send_status=0 的通知经注入的 sendMail 发送；成功置 1，
//   发送异常置 0（下次扫描自动重试），无邮箱置 2（永久终止）；sendMail 未提供时仅告警，
//   不消费队列（SMTP 配置就绪后自然续发）。
import { logger } from '../logger.js';

// 单批 SQL 参数个数上限：SQLite 参数上限默认 32766，留余量取 200 行 × 9 列
const BATCH_SIZE = 200;

// Unix 秒 → "YYYY-MM-DD HH:mm"（服务器本地时区，供提醒文案展示开始时间）
function fmtDateTime(ts) {
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 生成一次活动提醒扫描；返回 { activities, sent } 便于测试断言
/**
 * @param {object} [opts]
 * @param {import('../wasm-runtime/runtime.js').WasmRuntime} [opts.runtime]
 * @param {number} [opts.lookaheadSec]
 * @param {number} [opts.nowSec]
 * @returns {Promise<{activities: number, sent: number}>}
 */
export async function runReminders({ runtime, lookaheadSec = 3600, nowSec } = {}) {
  const now = nowSec ?? Math.floor(Date.now() / 1000);
  const upcoming = await runtime.invoke({
    op: 'db.query',
    args: {
      sql: 'SELECT activity_id, name, start_time FROM activity ' +
        'WHERE is_deleted = 0 AND status = 1 AND start_time > ? AND start_time <= ? ORDER BY activity_id;',
      params: [now, now + lookaheadSec],
    },
  });
  if (upcoming.code !== 0) throw new Error(`reminders: activity query failed: ${upcoming.message}`);
  const activities = upcoming.data?.rows ?? [];
  let sent = 0;

  for (const act of activities) {
    const activityId = act.activity_id;
    // 目标：订阅者 + 已通过报名者（UNION 去重）
    const targets = await runtime.invoke({
      op: 'db.query',
      args: {
        sql: 'SELECT uid FROM subscribe WHERE activity_id = ? ' +
          'UNION SELECT uid FROM registration WHERE activity_id = ? AND status = 2;',
        params: [activityId, activityId],
      },
    });
    if (targets.code !== 0) continue;
    let uids = (targets.data?.rows ?? []).map((r) => r.uid).filter((u) => Number.isInteger(u));
    if (uids.length === 0) continue;

    // 幂等：跳过已生成过 type 2 提醒的 uid（0003 迁移后按 activity_id 判重，
    // 不再依赖 content 字符串，活动同名也不会误判）
    const existingRes = await runtime.invoke({
      op: 'db.query',
      args: {
        sql: 'SELECT DISTINCT uid FROM notification WHERE type = 2 AND activity_id = ?;',
        params: [activityId],
      },
    });
    if (existingRes.code !== 0) continue;
    const notified = new Set((existingRes.data?.rows ?? []).map((r) => r.uid));
    uids = uids.filter((u) => !notified.has(u));
    if (uids.length === 0) continue;

    // 渠道偏好批量取（IN 展开）
    const prefRes = await runtime.invoke({
      op: 'db.query',
      args: {
        sql: 'SELECT uid, channel FROM user_notify_pref WHERE notify_type = 2 AND uid IN (' +
          uids.map(() => '?').join(',') + ');',
        params: uids,
      },
    });
    if (prefRes.code !== 0) continue;
    const pref = new Map();
    for (const r of prefRes.data?.rows ?? []) pref.set(r.uid, Number(r.channel) || 0);

    // 活动级渠道（通知的默认渠道）
    const cfg = await runtime.invoke({
      op: 'db.query',
      args: {
        sql: "SELECT config_value FROM activity_config WHERE activity_id = ? AND config_key = 'notify_channel' LIMIT 1;",
        params: [activityId],
      },
    });
    const actEmail = cfg.code === 0 && (cfg.data?.rows?.[0]?.config_value) === '1';

    // M8：渠道 bitmask（1=站内信 / 2=邮箱 / 3=两者）；含邮箱位的 uid 中无邮箱的降级站内信
    const defaultChannels = actEmail ? 3 : 1;
    const mailUids = uids.filter((u) => ((pref.get(u) ?? defaultChannels) & 2) !== 0);
    const hasMail = new Set();
    if (mailUids.length > 0) {
      const mailRes = await runtime.invoke({
        op: 'db.query',
        args: {
          sql: "SELECT uid FROM \"user\" WHERE email != '' AND uid IN (" +
            mailUids.map(() => '?').join(',') + ');',
          params: mailUids,
        },
      });
      if (mailRes.code !== 0) continue;
      for (const r of mailRes.data?.rows ?? []) hasMail.add(r.uid);
    }

    const title = '活动即将开始';
    const content = `[#${activityId}]「${act.name}」将于 ${fmtDateTime(act.start_time)} 开始，请做好准备。`;
    const rows = [];
    for (const uid of uids) {
      let channels = pref.has(uid) ? pref.get(uid) : defaultChannels;
      if (channels < 1 || channels > 3) channels = 1;  // 防御：非法值回落站内信
      if ((channels & 2) !== 0 && !hasMail.has(uid)) channels &= ~2;  // 无邮箱降级
      if (channels === 0) channels = 1;
      // 站内信直写即达（channel=0, send_status=1）；邮件入 SMTP 队列（channel=1, send_status=0）
      if ((channels & 1) !== 0) rows.push([uid, 2, title, content, 0, 0, 1, activityId, now]);
      if ((channels & 2) !== 0) rows.push([uid, 2, title, content, 0, 1, 0, activityId, now]);
    }
    // 批量写入（分批控制参数个数）
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const res = await runtime.invoke({
        op: 'db.exec_params',
        args: {
          sql: 'INSERT INTO notification (uid, type, title, content, is_read, channel, send_status, activity_id, created_at) ' +
            'VALUES ' + placeholders + ';',
          params: batch.flat(),
        },
      });
      if (res.code === 0) sent += batch.length;
      else logger.error('reminder insert failed', { activityId, err: res.message });
    }
    logger.info('activity reminder generated', { activityId, name: act.name, targets: uids.length });
  }
  return { activities: activities.length, sent };
}

// 邮件队列：channel=1 且 send_status=0 的通知交 sendMail({ to, subject, text }) 发送。
// 重试上限：发送异常置 0 回队列并累加 attempt_count（0005 迁移新增列），
// 达到 MAX_MAIL_ATTEMPTS 置 2（永久失败），避免对永久失效收件人无限重试（审查 Issue 4）。
const MAX_MAIL_ATTEMPTS = 10;

/**
 * @param {object} [opts]
 * @param {import('../wasm-runtime/runtime.js').WasmRuntime} [opts.runtime]
 * @param {(m: {to: string, subject: string, text: string}) => Promise<void>} [opts.sendMail]
 * @param {number} [opts.limit]
 */
export async function flushMailQueue({ runtime, sendMail, limit = 50 } = {}) {
  if (typeof sendMail !== 'function') {
    logger.warn('SMTP 未配置（sendMail 未注入），邮件队列保持待发送');
    return { sent: 0, failed: 0, pending: 0 };
  }
  const q = await runtime.invoke({
    op: 'db.query',
    args: {
      sql: 'SELECT n.notification_id, n.title, n.content, n.attempt_count, n.activity_id, ' +
        'u.uid AS user_uid, u.email FROM notification n ' +
        "JOIN \"user\" u ON u.uid = n.uid WHERE n.channel = 1 AND n.send_status = 0 " +
        'ORDER BY n.notification_id LIMIT ?;',
      params: [limit],
    },
  });
  if (q.code !== 0) throw new Error(`mail queue query failed: ${q.message}`);
  const rows = q.data?.rows ?? [];
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const attempt = Number(row.attempt_count) || 0;
    if (!row.email) {
      // 无邮箱属永久失败（用户不会补邮箱就重试）：置 2 终止，不再进队列；站内提示一次
      await markMailStatus(runtime, row.notification_id, 2, attempt);
      await reportMailFailure(runtime, row, attempt === 0 ? '收件人未填写邮箱' : '');
      failed += 1;
      continue;
    }
    try {
      await sendMail({ to: row.email, subject: row.title, text: row.content });
      await markMailStatus(runtime, row.notification_id, 1, attempt);  // 成功
      sent += 1;
    } catch (err) {
      // 发送异常（SMTP 抖动等）：置 0 回队列，下次扫描自动重试；达上限置 2 终止
      const next = attempt + 1;
      await markMailStatus(runtime, row.notification_id, next >= MAX_MAIL_ATTEMPTS ? 2 : 0, next);
      // 首次失败（attempt 0→1）在站内提示，避免重试期间重复刷屏
      if (attempt === 0) await reportMailFailure(runtime, row, err.message);
      failed += 1;
      logger.warn('mail send failed, will retry', {
        id: row.notification_id, attempt: next,
        err: err.message,
      });
    }
  }
  return { sent, failed, pending: rows.length - sent - failed };
}

// 邮件发送失败 → 站内提示（type 4，channel=0 直写即达）；内容附原邮件标题与失败原因
async function reportMailFailure(runtime, row, reason) {
  const title = '邮件发送失败';
  const content = `【${row.title}】\n${row.content}\n\n发送失败原因：${reason || '未知'}`;
  const res = await runtime.invoke({
    op: 'db.exec_params',
    args: {
      sql: 'INSERT INTO notification (uid, type, title, content, is_read, channel, send_status, ' +
        'activity_id, created_at) VALUES (?, 4, ?, ?, 0, 0, 1, ?, ?);',
      params: [row.user_uid, title, content,
        row.activity_id != null ? row.activity_id : null,
        Math.floor(Date.now() / 1000)],
    },
  });
  if (res.code !== 0) logger.error('mail failure notice insert failed', { notificationId: row.notification_id, err: res.message });
}

// 更新邮件通知的发送状态与尝试次数（0005 迁移新增 attempt_count 列）
async function markMailStatus(runtime, notificationId, status, attemptCount) {
  const res = await runtime.invoke({
    op: 'db.exec_params',
    args: {
      sql: 'UPDATE notification SET send_status = ?, attempt_count = ? WHERE notification_id = ?;',
      params: [status, attemptCount, notificationId],
    },
  });
  if (res.code !== 0) logger.error('mail status update failed', { notificationId, err: res.message });
}

// 周期任务：启动即跑一次，此后按 intervalMs 执行（注册到 index.js）
/**
 * @param {object} opts
 * @param {import('../wasm-runtime/runtime.js').WasmRuntime} opts.runtime
 * @param {(m: {to: string, subject: string, text: string}) => Promise<void>} [opts.sendMail]
 * @param {number} [opts.lookaheadSec]
 * @param {number} [opts.intervalMs]
 */
export function scheduleNotify({ runtime, sendMail, lookaheadSec = 3600, intervalMs = 60 * 1000 }) {
  const run = async () => {
    try {
      const r = await runReminders({ runtime, lookaheadSec });
      if (r.activities > 0) logger.info('reminder scan done', r);
      await flushMailQueue({ runtime, sendMail });
    } catch (err) {
      logger.error('notify task failed', { err: err.message });
    }
  };
  run();
  return setInterval(run, intervalMs);
}
