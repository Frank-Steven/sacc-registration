import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { App, Button, Form, Input, Typography } from 'antd';
import { authApi } from '../../api/index.js';
import { useAuthStore } from '../../stores/auth.js';
import { t, useI18n } from '../../utils/i18n/index.js';

const { Text } = Typography;

export default function Register() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const [loading, setLoading] = useState(false);
  useI18n();

  const onFinish = async ({ username, password }) => {
    setLoading(true);
    try {
      const { token, user } = await authApi.register({ username, password });
      setSession({ token, user });
      message.success(t('auth.reg_success'));
      navigate('/workbench', { replace: true });
    } catch (err) {
      message.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Typography.Title level={4} style={{ textAlign: 'center', marginTop: 0 }}>
        {t('auth.register_title')}
      </Typography.Title>
      <Form layout="vertical" size="large" onFinish={onFinish}>
        <Form.Item
          name="username"
          label={t('auth.username')}
          rules={[
            { required: true, message: t('auth.username_required') },
            { pattern: /^[a-zA-Z0-9_]{3,32}$/, message: t('auth.username_pattern') },
          ]}
        >
          <Input placeholder={t('auth.username_pattern')} autoComplete="username" />
        </Form.Item>
        <Form.Item
          name="password"
          label={t('auth.password')}
          rules={[
            { required: true, message: t('auth.password_required') },
            { min: 8, max: 128, message: t('auth.password_length') },
          ]}
        >
          <Input.Password placeholder={t('auth.password_placeholder')} autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirm"
          label={t('auth.confirm_password')}
          dependencies={['password']}
          rules={[
            { required: true, message: t('auth.confirm_required') },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('password') === value) return Promise.resolve();
                return Promise.reject(new Error(t('auth.password_mismatch')));
              },
            }),
          ]}
        >
          <Input.Password placeholder={t('auth.confirm_placeholder')} autoComplete="new-password" />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            {t('auth.register')}
          </Button>
        </Form.Item>
      </Form>
      <Text style={{ display: 'block', textAlign: 'center' }}>
        <Link to="/login">{t('auth.login_link')}</Link>
      </Text>
    </>
  );
}
