import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { App, Button, Form, Input, Typography, theme } from 'antd';
import { authApi } from '../../api/index.js';
import { useAuthStore } from '../../stores/auth.js';
import { t, useI18n } from '../../utils/i18n/index.js';

const { Text } = Typography;

export default function Login() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setSession = useAuthStore((s) => s.setSession);
  const [loading, setLoading] = useState(false);
  const { token: antToken } = theme.useToken();
  useI18n();

  const onFinish = async (values) => {
    setLoading(true);
    try {
      const { token, user } = await authApi.login(values);
      setSession({ token, user });
      message.success(t('auth.login_success'));
      navigate(searchParams.get('redirect') || '/workbench', { replace: true });
    } catch (err) {
      message.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Typography.Title level={4} style={{ textAlign: 'center', marginTop: 0 }}>
        {t('auth.login_title')}
      </Typography.Title>
      <Form
        layout="vertical"
        size="large"
        initialValues={{ username: 'demo', password: 'demo1234' }}
        onFinish={onFinish}
      >
        <Form.Item
          name="username"
          label={t('auth.username')}
          rules={[{ required: true, message: t('auth.username_required') }]}
        >
          <Input placeholder={t('auth.username')} autoComplete="username" />
        </Form.Item>
        <Form.Item
          name="password"
          label={t('auth.password')}
          rules={[{ required: true, message: t('auth.password_required') }]}
        >
          <Input.Password placeholder={t('auth.password')} autoComplete="current-password" />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            {t('auth.login')}
          </Button>
        </Form.Item>
      </Form>
      <Text style={{ display: 'block', textAlign: 'center' }}>
        <Link to="/register">{t('auth.register_link')}</Link>
        <span style={{ margin: '0 8px', color: antToken.colorTextTertiary }}>|</span>
        <Link to="/forgot-password">{t('auth.forgot_link')}</Link>
      </Text>
    </>
  );
}
