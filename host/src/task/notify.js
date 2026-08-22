// 通知任务（registration.md 7.3 / development.md 五）：
// - 活动提醒：扫描 start_time ∈ (now, now+lookahead) 的活动，给「订阅者 + 已通过报名者」
//   生成 type 2 提醒；幂等按 (uid, type=2, activity_id) 判重（0003 迁移新增 activity_id 列）。
// - 邮件队列：channel=1 且 send_status=0 的通知经注入的 sendMail 发送，成功置 1 / 失败置 2
//   （可重试）；sendMail 未提供时仅告警，不消费队列（SMTP 配置就绪后自然续发）。
import { logger } from '../logger.js';

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
    const targetIds = (targets.data?.rows ?? []).map((r) => r.uid).filter((u) => Number.isInteger(u));
    if (targetIds.length === 0) continue;

    // 幂等：同一 uid 对同一活动已生成过 type 2 提醒则跳过（0003 迁移后按 activity_id 判重，
    // 不再依赖 content 字符串，活动同名也不会误判）
    const cfg = await runtime.invoke({
      op: 'db.query',
      args: {
        sql: "SELECT config_value FROM activity_config WHERE activity_id = ? AND config_key = 'notify_channel' LIMIT 1;",
        params: [activityId],
      },
    });
    const actEmail = cfg.code === 0 && (cfg.data?.rows?.[0]?.config_value) === '1';

    const title = '活动即将开始';
    const content = `[#${activityId}]「${act.name}」将于 ${fmtDateTime(act.start_time)} 开始，请做好准备。`;
    for (const uid of targetIds) {
      const existing = await runtime.invoke({
        op: 'db.query',
        args: {
          sql: 'SELECT 1 FROM notification WHERE uid = ? AND type = 2 AND activity_id = ? LIMIT 1;',
          params: [uid, activityId],
        },
      });
      if (existing.code === 0 && (existing.data?.rows ?? []).length > 0) continue;
      // 渠道：用户偏好（notify_type=2）优先；否则活动渠道；邮件需有邮箱，否则降级站内信
      const pref = await runtime.invoke({
        op: 'db.query',
        args: {
          sql: 'SELECT channel FROM user_notify_pref WHERE uid = ? AND notify_type = 2 LIMIT 1;',
          params: [uid],
        },
      });
      let channel = 0;
      if (pref.code === 0 && (pref.data?.rows?.[0]) !== undefined) {
        channel = Number(pref.data.rows[0].channel) || 0;
      } else if (actEmail) {
        channel = 1;
      }
      if (channel === 1) {
        const mail = await runtime.invoke({
          op: 'db.query',
          args: { sql: "SELECT 1 FROM \"user\" WHERE uid = ? AND email != '' LIMIT 1;", params: [uid] },
        });
        if (mail.code !== 0 || (mail.data?.rows ?? []).length === 0) channel = 0;
      }
      const sendStatus = channel === 0 ? 1 : 0;
      // 参数化写入（db.exec_params），避免字符串拼接注入/引号破坏
      const res = await runtime.invoke({
        op: 'db.exec_params',
        args: {
          sql: 'INSERT INTO notification (uid, type, title, content, is_read, channel, send_status, activity_id, created_at) ' +
            'VALUES (?, 2, ?, ?, 0, ?, ?, ?, ?);',
          params: [uid, title, content, channel, sendStatus, activityId, now],
        },
      });
      if (res.code === 0) sent += 1;
    }
    logger.info('activity reminder generated', { activityId, name: act.name, targets: targetIds.length });
  }
  return { activities: activities.length, sent };
}

// 邮件队列：channel=1 且 send_status=0 的通知交 sendMail({ to, subject, text }) 发送
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
      sql: 'SELECT n.notification_id, n.title, n.content, u.email FROM notification n ' +
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
    if (!row.email) {
      await setMailStatus(runtime, row.notification_id, 2);
      failed += 1;
      continue;
    }
    let status = 1;
    try {
      await sendMail({ to: row.email, subject: row.title, text: row.content });
      sent += 1;
    } catch (err) {
      status = 2;
      failed += 1;
      logger.warn('mail send failed', { id: row.notification_id, err: err.message });
    }
    await setMailStatus(runtime, row.notification_id, status);
  }
  return { sent, failed, pending: rows.length - sent - failed };
}

async function setMailStatus(runtime, notificationId, status) {
  const res = await runtime.invoke({
    op: 'db.exec_params',
    args: {
      sql: 'UPDATE notification SET send_status = ? WHERE notification_id = ?;',
      params: [status, notificationId],
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
