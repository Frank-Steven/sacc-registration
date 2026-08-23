import { useState } from 'react';
import { App, Button, Card, Form, Input, Modal, Popconfirm, Space, Table, Tag, Tooltip } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminTemplateApi } from '../../api/admin.js';
import { formatTime } from '../../utils/format.js';
import { t, useI18n } from '../../utils/i18n/index.js';

// 模板管理：列表 / 新建 / 编辑 / 删除（套用入口在活动编辑 FormDesigner 内）
export default function Templates() {
  useI18n();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [modal, setModal] = useState({ open: false, tpl: null });
  const [form] = Form.useForm();

  const { data, isFetching } = useQuery({ queryKey: ['admin-templates'], queryFn: adminTemplateApi.list });
  // 后端返回 { items: [...] }
  const items = data?.items || [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-templates'] });

  const openModal = (tpl) => {
    setModal({ open: true, tpl });
    if (tpl) form.setFieldsValue({ name: tpl.name, description: tpl.description || '' });
    else form.resetFields();
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    try {
      if (modal.tpl) {
        await adminTemplateApi.update(modal.tpl.template_id, values);
        message.success(t('admin.tpl.update_ok'));
      } else {
        await adminTemplateApi.create(values);
        message.success(t('admin.tpl.create_ok'));
      }
      setModal({ open: false, tpl: null });
      invalidate();
    } catch (err) {
      message.error(err.message);
    }
  };

  const handleDelete = async (tpl) => {
    try {
      await adminTemplateApi.remove(tpl.template_id);
      message.success(t('admin.tpl.delete_ok'));
      invalidate();
    } catch (err) {
      message.error(err.message);
    }
  };

  // 字段快照（JSON 数组）→ 行数统计
  const snapshotCount = (fieldsJson) => {
    try {
      const arr = JSON.parse(fieldsJson || '[]');
      return Array.isArray(arr) ? arr.length : 0;
    } catch {
      return 0;
    }
  };

  const columns = [
    { title: t('admin.tpl.name'), dataIndex: 'name' },
    {
      title: t('admin.tpl.fields'),
      width: 100,
      align: 'center',
      render: (_, r) => (
        <Tooltip title={t('admin.tpl.snapshot')}>
          <Tag>{snapshotCount(r.fields_json)}</Tag>
        </Tooltip>
      ),
    },
    { title: t('admin.tpl.created'), dataIndex: 'created_at', width: 170, render: (v) => formatTime(v) },
    {
      title: t('admin.tpl.actions'),
      width: 160,
      render: (_, r) => (
        <Space size={4}>
          <Button size="small" onClick={() => openModal(r)}>{t('common.edit')}</Button>
          <Popconfirm title={t('admin.tpl.confirm_delete')} okText={t('common.delete')} onConfirm={() => handleDelete(r)}>
            <Button size="small" danger>{t('common.delete')}</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card
      size="small"
      title={t('admin.menu.templates')}
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal(null)}>
          {t('admin.tpl.new')}
        </Button>
      }
    >
      <Table rowKey="template_id" size="small" loading={isFetching} dataSource={items} columns={columns} pagination={false} />

      <Modal
        open={modal.open}
        title={modal.tpl ? t('common.edit') : t('admin.tpl.new')}
        onOk={handleSave}
        onCancel={() => setModal({ open: false, tpl: null })}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label={t('admin.tpl.name')} rules={[{ required: true, message: t('admin.tpl.name') }]}>
            <Input maxLength={50} />
          </Form.Item>
          <Form.Item name="description" label={t('admin.tpl.desc')}>
            <Input.TextArea rows={3} maxLength={200} placeholder={t('admin.tpl.fields_json_hint')} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
