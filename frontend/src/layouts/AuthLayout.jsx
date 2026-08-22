import { Outlet } from 'react-router-dom';
import { Layout, Card, Typography, theme } from 'antd';
import AppSettings from '../components/AppSettings.jsx';
import { t, useI18n } from '../utils/i18n/index.js';
import { useDocumentTitle } from '../utils/useDocumentTitle.js';

const { Content } = Layout;

// 登录 / 注册 / 忘记密码：居中卡片 + 品牌区（背景跟随主题，不设渐变）
export default function AuthLayout() {
  const { token } = theme.useToken();
  useI18n();
  useDocumentTitle();
  return (
    <Layout style={{ minHeight: '100vh', background: token.colorBgLayout }}>
      <Content style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 420 }}>
          <Typography.Title level={3} style={{ color: token.colorText, textAlign: 'center', marginBottom: 16 }}>
            {t('brand.title')}
          </Typography.Title>
          <Card variant="borderless" style={{ borderRadius: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
              <AppSettings />
            </div>
            <Outlet />
          </Card>
        </div>
      </Content>
    </Layout>
  );
}
