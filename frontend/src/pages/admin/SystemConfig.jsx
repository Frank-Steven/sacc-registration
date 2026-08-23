import { Card, Typography } from 'antd';
import ConfigEditor from '../../components/ConfigEditor.jsx';
import { t, useI18n } from '../../utils/i18n/index.js';
import { useDocumentTitle } from '../../utils/useDocumentTitle.js';

const { Text, Title } = Typography;

// 配置中心（M7 十）：系统级键值配置，复用 ConfigEditor system 模式
export default function SystemConfig() {
  useI18n();
  useDocumentTitle();
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0, fontWeight: 600 }}>{t('admin.sys.config.title')}</Title>
          <Text type="secondary">{t('admin.sys.config.subtitle')}</Text>
        </div>
      </div>
      <Card>
        <ConfigEditor system />
      </Card>
    </div>
  );
}
