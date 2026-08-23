import { useEffect, useState } from 'react';
import { Avatar, Button, Card, Flex, Form, Input, Spin, Tabs, Upload, App as AntApp } from 'antd';
import { UserOutlined, UploadOutlined } from '@ant-design/icons';
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
  const [avatar, setAvatar] = useState('');
  const [uploading, setUploading] = useState(false);

  const { data: me, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: authApi.me,
    // 编辑表单由服务端数据填充，关闭全局轮询防止刷新覆盖正在编辑的输入
    refetchInterval: false,
  });

  useEffect(() => {
    if (me) {
      setAvatar(me.avatar || '');
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
      await userApi.updateProfile(values);
      // user.update 仅返回 { ok: true }，需重新拉取完整资料（含 username/uid）写入会话，
      // 否则顶栏会因 user 被覆盖为 { ok: true } 而显示"未登录"
      const fresh = await authApi.me();
      setUser(fresh);
      queryClient.setQueryData(['me'], fresh);
      message.success(t('profile.saved'));
    } catch (err) {
      message.error(err.message);
    }
  };

  // 头像：读取为 base64 dataURL 后即时保存（M9，存 user.avatar）
  const handleAvatar = (file) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      message.error(t('profile.avatar_type'));
      return Upload.LIST_IGNORE;
    }
    if (file.size > 300 * 1024) {
      message.error(t('profile.avatar_size'));
      return Upload.LIST_IGNORE;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        setUploading(true);
        await userApi.updateProfile({ avatar: reader.result });
        const fresh = await authApi.me();
        setUser(fresh);
        queryClient.setQueryData(['me'], fresh);
        message.success(t('profile.avatar_saved'));
      } catch (err) {
        message.error(err.message);
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
    return false;
  };

  const handleAvatarRemove = async () => {
    try {
      await userApi.updateProfile({ avatar: '' });
      const fresh = await authApi.me();
      setUser(fresh);
      queryClient.setQueryData(['me'], fresh);
      message.success(t('profile.avatar_removed'));
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
                <div style={{ maxWidth: 480 }}>
                  {/* M9：头像在左，上传/移除按钮在右侧单独竖排（内部换行）；移除为红色按钮 */}
                  <Flex align="flex-start" gap={16} style={{ marginBottom: 24 }}>
                    <Avatar size={80} src={avatar || undefined} icon={<UserOutlined />} />
                    <Flex vertical gap={8}>
                      <Upload
                        accept="image/png,image/jpeg,image/webp"
                        showUploadList={false}
                        beforeUpload={handleAvatar}
                      >
                        <Button icon={<UploadOutlined />} loading={uploading}>
                          {t('profile.avatar_upload')}
                        </Button>
                      </Upload>
                      {avatar && (
                        <Button danger onClick={handleAvatarRemove}>
                          {t('profile.avatar_remove')}
                        </Button>
                      )}
                    </Flex>
                  </Flex>
                  <Form form={form} layout="vertical" onFinish={handleSave}>
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
                </div>
              ),
          },
          { key: 'common', label: t('profile.common_info'), children: <CommonInfoManager /> },
          { key: 'notify', label: t('profile.notify_pref'), children: <NotifyPrefForm /> },
        ]}
      />
    </Card>
  );
}
