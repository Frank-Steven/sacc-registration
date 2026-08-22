import { useEffect } from 'react';
import { Button, Card, Form, Input, Spin, Tabs, App as AntApp } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi, userApi } from '../../api/index.js';
import { useAuthStore } from '../../stores/auth.js';
import CommonInfoManager from '../../components/CommonInfoManager.jsx';
import NotifyPrefForm from '../../components/NotifyPrefForm.jsx';
import { t, useI18n } from '../../utils/i18n/index.js';

// 个人资料：基础资料（auth.me 预填 + updateProfile 同步到 store）/
// 常用信息（CommonInfoManager）/ 通知偏好（NotifyPrefForm）
export default function Profile() {
  useI18n();
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);
  const [form] = Form.useForm();

  const { data: me, isLoading } = useQuery({ queryKey: ['me'], queryFn: authApi.me });

  useEffect(() => {
    if (me) {
      form.setFieldsValue({
        name: me.name,
        student_id: me.student_id,
        college: me.college,
        phone: me.phone,
        email: me.email,
      });
    }
  }, [me, form]);

  const handleSave = async (values) => {
    try {
      const profile = await userApi.updateProfile(values);
      setUser(profile);
      queryClient.invalidateQueries({ queryKey: ['me'] });
      message.success(t('profile.saved'));
    } catch (err) {
      message.error(err.message);
    }
  };

  return (
    <Card>
      <Tabs
        items={[
          {
            key: 'basic',
            label: t('profile.base'),
            children:
              isLoading || !me ? (
                <div style={{ textAlign: 'center', padding: 48 }}>
                  <Spin size="large" />
                </div>
              ) : (
                <Form form={form} layout="vertical" style={{ maxWidth: 480 }} onFinish={handleSave}>
                  <Form.Item name="name" label={t('profile.name')}>
                    <Input placeholder={t('profile.name_ph')} />
                  </Form.Item>
                  <Form.Item name="student_id" label={t('profile.student_id')}>
                    <Input placeholder={t('profile.student_id_ph')} />
                  </Form.Item>
                  <Form.Item name="college" label={t('profile.college')}>
                    <Input placeholder={t('profile.college_ph')} />
                  </Form.Item>
                  <Form.Item name="phone" label={t('profile.phone')}>
                    <Input placeholder={t('profile.phone_ph')} />
                  </Form.Item>
                  <Form.Item name="email" label={t('profile.email')}>
                    <Input placeholder={t('profile.email_ph')} />
                  </Form.Item>
                  <Form.Item>
                    <Button type="primary" htmlType="submit">
                      {t('common.save')}
                    </Button>
                  </Form.Item>
                </Form>
              ),
          },
          { key: 'common', label: t('profile.common_info'), children: <CommonInfoManager /> },
          { key: 'notify', label: t('profile.notify_pref'), children: <NotifyPrefForm /> },
        ]}
      />
    </Card>
  );
}
