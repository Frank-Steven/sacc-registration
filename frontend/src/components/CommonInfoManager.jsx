import { useState } from 'react';
import { Button, Flex, Form, Input, List, Modal, Popconfirm, Select, Space, Tag, Typography, App as AntApp } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { userApi } from '../api/index.js';
import { CommonInfoTemplates } from '../constants/index.js';
import { t, useI18n } from '../utils/i18n/index.js';

const { Text } = Typography;

// 常用信息管理：List 展示（key + label + value），支持新增（可选内置模板自动填充）、编辑、删除。
// 全部写操作成功后 invalidateQueries(['common-info'])。
export default function CommonInfoManager() {
  useI18n();
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null); // null = 新增，否则为被编辑条目
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['common-info'],
    queryFn: () => userApi.commonInfoList(),
  });

  const openAdd = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (item) => {
    setEditing(item);
    form.setFieldsValue({ field_key: item.field_key, field_label: item.field_label, field_value: item.field_value });
    setModalOpen(true);
  };

  const handleSave = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return; // 校验失败，表单内已有提示
    }
    setSaving(true);
    try {
      await userApi.commonInfoSave(values);
      message.success(t('common_info.saved'));
      setModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['common-info'] });
    } catch (err) {
      message.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (key) => {
    try {
      await userApi.commonInfoDelete(key);
      message.success(t('common_info.deleted'));
      queryClient.invalidateQueries({ queryKey: ['common-info'] });
    } catch (err) {
      message.error(err.message);
    }
  };

  return (
    <>
      <Flex justify="space-between" align="center" style={{ marginBottom: 16 }}>
        <Text type="secondary">{t('common_info.hint')}</Text>
        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
          {t('common.add')}
        </Button>
      </Flex>
      <List
        dataSource={data?.items ?? []}
        loading={isLoading}
        locale={{ emptyText: t('common_info.empty') }}
        renderItem={(item) => (
          <List.Item
            actions={[
              <Button key="edit" type="link" size="small" onClick={() => openEdit(item)}>
                {t('common.edit')}
              </Button>,
              <Popconfirm
                key="delete"
                title={t('common_info.delete_confirm')}
                onConfirm={() => handleDelete(item.field_key)}
              >
                <Button type="link" size="small" danger>
                  {t('common.delete')}
                </Button>
              </Popconfirm>,
            ]}
          >
            <List.Item.Meta
              title={
                <Space>
                  <Tag>{item.field_key}</Tag>
                  <Text strong>{item.field_label}</Text>
                </Space>
              }
              description={item.field_value || '—'}
            />
          </List.Item>
        )}
      />
      <Modal
        title={editing ? t('common_info.edit') : t('common_info.add')}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        afterClose={() => form.resetFields()}
      >
        <Form form={form} layout="vertical">
          {!editing && (
            <Form.Item label={t('common_info.template')}>
              <Select
                placeholder={t('common_info.template_ph')}
                allowClear
                options={CommonInfoTemplates.map((t) => ({ value: t.field_key, label: `${t.field_label}（${t.field_key}）` }))}
                onChange={(key) => {
                  const t = CommonInfoTemplates.find((x) => x.field_key === key);
                  if (t) form.setFieldsValue({ field_key: t.field_key, field_label: t.field_label });
                }}
              />
            </Form.Item>
          )}
          <Form.Item name="field_key" label={t('common_info.field_key')} rules={[{ required: true, message: t('common_info.field_key_req') }]}>
            <Input disabled={!!editing} placeholder={t('common_info.field_key_ph')} />
          </Form.Item>
          <Form.Item name="field_label" label={t('common_info.field_label')} rules={[{ required: true, message: t('common_info.field_label_req') }]}>
            <Input placeholder={t('common_info.field_label_ph')} />
          </Form.Item>
          <Form.Item name="field_value" label={t('common_info.field_value')} rules={[{ required: true, message: t('common_info.field_value_req') }]}>
            <Input placeholder={t('common_info.field_value_ph')} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
