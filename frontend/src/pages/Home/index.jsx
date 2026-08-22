import { useEffect, useState } from 'react';
import { Alert, Card, Space, Spin, Tag, Typography } from 'antd';
import { get } from '../../api/client.js';

const { Title, Text } = Typography;

// 工作台：M0 阶段仅展示宿主 / 数据库自检信息，验证工作流是否跑通
export default function Home() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    get('/system/status')
      .then(setStatus)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <Card title="工作流自检">
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      {!status && !error && <Spin />}
      {status && (
        <Space direction="vertical" size="middle">
          <div>
            <Title level={5} style={{ margin: 0 }}>
              宿主服务
            </Title>
            <Text>backend.wasm v{status.wasm} · 已连接</Text> <Tag color="green">在线</Tag>
          </div>
          <div>
            <Title level={5} style={{ margin: 0 }}>
              数据库
            </Title>
            <Text>schema v{status.user_version}</Text>{' '}
            <Tag color="blue">{status.tables?.length ?? 0} 张表</Tag>
          </div>
        </Space>
      )}
    </Card>
  );
}
