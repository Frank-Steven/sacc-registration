// 邮件发送（M8）：原生 Node SMTP 客户端，无第三方依赖。
// 配置来源：system_config（超管在「配置中心 → 邮件服务」维护，掩码展示）。
//   mail_from / smtp_host / smtp_port / smtp_user / smtp_pass
// 端口语义：465 隐式 SSL（tls.connect）；587/25 STARTTLS（net 升级）。
// 未配置 smtp_host 时抛错（上游「SMTP 未配置」，邮件队列保持待发送）。
import net from 'node:net';
import tls from 'node:tls';

// 读取邮件配置（每次发送动态读取，超管改配置即时生效）
async function loadMailConfig(runtime) {
  const res = await runtime.invoke({
    op: 'db.query',
    args: {
      sql: 'SELECT config_key, config_value FROM system_config ' +
        "WHERE config_key IN ('mail_from','smtp_host','smtp_port','smtp_user','smtp_pass');",
      params: [],
    },
  });
  if (res.code !== 0) throw new Error(`mail config query failed: ${res.message}`);
  const map = {};
  for (const r of res.data?.rows ?? []) map[r.config_key] = r.config_value;
  // 映射为 smtpSend 期望的 cfg 结构（from/host/port/user/pass）
  return {
    from: map.mail_from,
    host: map.smtp_host,
    port: map.smtp_port,
    user: map.smtp_user,
    pass: map.smtp_pass,
  };
}

// SMTP 单条命令：发送并等待完整响应（多行以 `xxx-` 前缀继续），返回响应码与文本。
// 对端提前关闭连接时 reject，避免队列任务永久挂起。
function command(sock, line) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      // 响应完成：最后一行以 <code> + 空格结尾
      const m = buf.match(/\r?\n/);
      if (!m) return;
      const lines = buf.split(/\r?\n/).filter((l) => l.length > 0);
      const last = lines[lines.length - 1];
      if (/^\d{3} /.test(last)) {
        sock.off('data', onData);
        sock.off('close', onClose);
        const code = Number(last.slice(0, 3));
        if (code >= 200 && code < 400) resolve(last);
        else reject(new Error(`SMTP ${code}: ${last.slice(4)}`));
      }
    };
    const onClose = () => reject(new Error('SMTP 连接中断（对端关闭）'));
    sock.on('data', onData);
    sock.once('close', onClose);
    sock.write(line + '\r\n');
  });
}

// STARTTLS 升级：net socket → tls socket（同一底层 fd 由 node 处理）
function upgradeTLS(sock, host) {
  return new Promise((resolve, reject) => {
    const tlsSock = tls.connect({ socket: sock, servername: host, rejectUnauthorized: false });
    tlsSock.once('secureConnect', () => resolve(tlsSock));
    tlsSock.once('error', reject);
  });
}

function connect({ host, port }) {
  return new Promise((resolve, reject) => {
    const raw = port === 465
      ? tls.connect({ host, port, rejectUnauthorized: false })
      : net.connect({ host, port });
    raw.setTimeout(10_000, () => raw.destroy(new Error('SMTP 连接超时')));
    // 常驻 no-op：resolve 后 socket 报错也不触发 uncaught 'error'（下游经 'close' 感知中断）
    raw.on('error', () => {});
    const onOk = () => {
      raw.off('error', onErr);
      resolve(raw);
    };
    const onErr = (err) => {
      raw.off('secureConnect', onOk);
      raw.off('connect', onOk);
      reject(err);
    };
    raw.once('error', onErr);
    // 465 隐式 TLS 须等握手完成（secureConnect），否则握手失败被吞、下游永久等待
    if (port === 465) raw.once('secureConnect', onOk);
    else raw.once('connect', onOk);
  });
}

// 等待 220 欢迎语（连接建立后）；对端提前关闭或拒绝时 reject
function readGreeting(sock) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      const lines = buf.split(/\r?\n/).filter((l) => l.length > 0);
      const last = lines[lines.length - 1];
      if (/^220 /.test(last)) {
        sock.off('data', onData);
        sock.off('close', onClose);
        resolve();
      } else if (/^5\d\d /.test(last)) {
        sock.off('data', onData);
        sock.off('close', onClose);
        reject(new Error(`SMTP greeting refused: ${last}`));
      }
    };
    const onClose = () => reject(new Error('SMTP 连接中断（对端关闭）'));
    sock.on('data', onData);
    sock.once('close', onClose);
  });
}

// 发送一封邮件；cfg 含 from/host/port/user/pass
export async function smtpSend(cfg, { to, subject, text }) {
  if (!cfg.host || !cfg.from) throw new Error('SMTP 未配置（请在配置中心填写官方邮箱与 SMTP 服务器）');
  const port = Number(cfg.port) || 465;
  let sock = await connect({ host: cfg.host, port });
  try {
    await readGreeting(sock);
    await command(sock, `EHLO sacc-host`);
    // STARTTLS（465 为隐式 TLS 无需升级；587/25 需升级）
    if (port !== 465) {
      try {
        await command(sock, 'STARTTLS');
        const tlsSock = await upgradeTLS(sock, cfg.host);
        sock.destroy();
        tlsSock.on('error', () => {});
        sock = tlsSock;
        await readGreeting(sock);
        await command(sock, `EHLO sacc-host`);
      } catch (err) {
        // 服务器不支持 STARTTLS 时继续明文（低版本邮件服务器）；鉴权可能失败由上游重试
        if (!/STARTTLS/.test(err.message)) throw err;
      }
    }
    if (cfg.user) {
      await command(sock, 'AUTH LOGIN');
      await command(sock, Buffer.from(cfg.user, 'utf8').toString('base64'));
      await command(sock, Buffer.from(cfg.pass || '', 'utf8').toString('base64'));
    }
    await command(sock, `MAIL FROM:<${cfg.from}>`);
    await command(sock, `RCPT TO:<${to}>`);
    await command(sock, 'DATA');
    const body = [
      `From: ${cfg.from}`,
      `To: ${to}`,
      `Subject: ${subject.replace(/[\r\n]/g, ' ')}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      text,
      '.',
    ].join('\r\n');
    await command(sock, body);
    await command(sock, 'QUIT');
  } finally {
    sock.destroy();
  }
}

// 注入用邮件发送器：动态读 system_config → smtpSend
export function createMailer({ runtime }) {
  return async (mail) => {
    const cfg = await loadMailConfig(runtime);
    return smtpSend(cfg, mail);
  };
}
