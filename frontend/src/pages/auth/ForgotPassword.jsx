import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { App, Button, Form, Input, Steps, Typography } from 'antd';
import { authApi } from '../../api/index.js';
import { t, useI18n } from '../../utils/i18n/index.js';

const { Text } = Typography;

export default function ForgotPassword() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  useI18n();

  const onRequest = async ({ email }) => {
    setLoading(true);
    try {
      const res = await authApi.resetRequest({ email });
      setToken(res?.token || '');
      message.success(t('auth.reset_email_sent'));
      setStep(1);
    } catch (err) {
      message.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const onConfirm = async ({ new_password }) => {
    setLoading(true);
    try {
      await authApi.resetConfirm({ token, new_password });
      message.success(t('auth.reset_success'));
      navigate('/login', { replace: true });
    } catch (err) {
      message.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Typography.Title level={4} style={{ textAlign: 'center', marginTop: 0 }}>
        {t('auth.forgot_title')}
      </Typography.Title>
      <Steps
        size="small"
        current={step}
        items={[{ title: t('auth.reset_step_email') }, { title: t('auth.reset_step_password') }]}
        style={{ marginBottom: 24 }}
      />
      {step === 0 ? (
        <Form layout="vertical" size="large" onFinish={onRequest}>
          <Form.Item
            name="email"
            label={t('auth.reset_email')}
            rules={[
              { required: true, message: t('auth.email_required') },
              { type: 'email', message: t('auth.email_invalid') },
            ]}
          >
            <Input placeholder={t('auth.reset_email_placeholder')} autoComplete="email" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>
              {t('auth.reset_send')}
            </Button>
          </Form.Item>
        </Form>
      ) : (
        <Form layout="vertical" size="large" onFinish={onConfirm}>
          <Form.Item label={t('auth.reset_token')}>
            <Input value={token} readOnly />
          </Form.Item>
          <Form.Item
            name="new_password"
            label={t('auth.new_password')}
            rules={[
              { required: true, message: t('auth.reset_new_password_required') },
              { min: 8, max: 128, message: t('auth.password_length') },
            ]}
          >
            <Input.Password placeholder={t('auth.reset_new_password_placeholder')} autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirm"
            label={t('auth.reset_confirm_label')}
            dependencies={['new_password']}
            rules={[
              { required: true, message: t('auth.reset_confirm_required') },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('new_password') === value) return Promise.resolve();
                  return Promise.reject(new Error(t('auth.password_mismatch')));
                },
              }),
            ]}
          >
            <Input.Password placeholder={t('auth.reset_confirm_placeholder')} autoComplete="new-password" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>
              {t('auth.reset_submit')}
            </Button>
          </Form.Item>
        </Form>
      )}
      <Text style={{ display: 'block', textAlign: 'center' }}>
        <Link to="/login">{t('auth.reset_back')}</Link>
      </Text>
    </>
  );
}
