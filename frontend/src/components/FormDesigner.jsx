import { useState } from 'react';
import {
  App, Button, Card, Collapse, Form, Input, Modal, Popconfirm, Radio, Select, Space, Spin, Tag, Typography,
} from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, EditOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminActivityApi, adminFormApi, adminTemplateApi } from '../api/admin.js';
import { FieldType } from '../constants/index.js';
import TemplatePicker from './TemplatePicker.jsx';
import { t, useI18n } from '../utils/i18n/index.js';

const { Text } = Typography;

// options / validation 为 JSON 字符串（后端契约）；编辑态转行文本
const optionsToLines = (jsonStr) => {
  try {
    const arr = JSON.parse(jsonStr || '[]');
    return arr.map((o) => (typeof o === 'object' ? o.label ?? '' : o)).join('\n');
  } catch {
    return '';
  }
};
const linesToOptions = (text) => {
  const arr = text.split('\n').map((s) => s.trim()).filter(Boolean);
  return JSON.stringify(arr);
};

// 常用校验预设：一键填充 validation.regex（学号规则可按学校调整位数）
const VALIDATION_PRESETS = [
  { key: 'phone', label: '手机号（11 位）', regex: '^1\\d{10}$' },
  { key: 'student_id', label: '学号（9~12 位数字）', regex: '^\\d{9,12}$' },
  { key: 'email', label: '邮箱', regex: '^[\\w.+-]+@[\\w-]+(\\.[\\w-]+)+$' },
];

// 表单设计器：表单组管理 + 字段编辑（key/type 冻结）+ 模板保存/套用
export default function FormDesigner({ activityId, readOnly }) {
  useI18n();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [tplPickerOpen, setTplPickerOpen] = useState(false);
  const [tplModalOpen, setTplModalOpen] = useState(false);
  const [tplName, setTplName] = useState('');
  const [savingTpl, setSavingTpl] = useState(false);

  const { data: detail, isLoading } = useQuery({
    queryKey: ['admin-activity', activityId],
    queryFn: () => adminActivityApi.detail(activityId),
  });
  const forms = detail?.forms || [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-activity', activityId] });

  const notify = (fn) => async () => {
    try {
      await fn();
      invalidate();
    } catch (err) {
      message.error(err.message);
    }
  };

  // ---- 表单组 ----
  const [groupModal, setGroupModal] = useState({ open: false, form: null });
  const [groupForm] = Form.useForm();

  const openGroupModal = (form) => {
    setGroupModal({ open: true, form });
    if (form) groupForm.setFieldsValue({ name: form.name, is_required: !!form.is_required });
    else groupForm.resetFields();
  };

  const saveGroup = async () => {
    const values = await groupForm.validateFields();
    try {
      if (groupModal.form) await adminFormApi.update(groupModal.form.form_id, values);
      else await adminFormApi.create(activityId, values);
      message.success(t('admin.act.update_ok'));
      setGroupModal({ open: false, form: null });
      invalidate();
    } catch (err) {
      message.error(err.message);
    }
  };

  const deleteGroup = async (form) => {
    try {
      await adminFormApi.remove(form.form_id);
      invalidate();
    } catch (err) {
      message.error(err.message);
    }
  };

  // ---- 字段 ----
  const [fieldModal, setFieldModal] = useState({ open: false, formId: null, field: null });
  const [fieldForm] = Form.useForm();

  const openFieldModal = (formId, field) => {
    setFieldModal({ open: true, formId, field });
    if (field) {
      fieldForm.setFieldsValue({
        field_key: field.field_key,
        field_label: field.field_label,
        field_type: Number(field.field_type),
        is_required: !!field.is_required,
        placeholder: field.placeholder || '',
        default_value: field.default_value || '',
        options: optionsToLines(field.options),
        validation: field.validation || '',
        sort_order: field.sort_order,
      });
    } else {
      fieldForm.resetFields();
      fieldForm.setFieldsValue({ is_required: false, sort_order: 0 });
    }
  };

  const saveField = async () => {
    const values = await fieldForm.validateFields();
    const isEdit = !!fieldModal.field;
    const payload = { ...values, is_required: !!values.is_required };
    try {
      if (isEdit) await adminFormApi.fieldUpdate(fieldModal.field.field_id, payload);
      else await adminFormApi.fieldCreate(fieldModal.formId, payload);
      message.success(isEdit ? t('admin.design.field_update_ok') : t('admin.design.field_create_ok'));
      setFieldModal({ open: false, formId: null, field: null });
      invalidate();
    } catch (err) {
      message.error(err.message);
    }
  };

  const deleteField = async (field) => {
    try {
      await adminFormApi.fieldDelete(field.field_id);
      invalidate();
    } catch (err) {
      message.error(err.message);
    }
  };

  // 校验预设：合并 regex 到已有 validation JSON（不覆盖其他规则）
  const applyPreset = (key) => {
    const preset = VALIDATION_PRESETS.find((p) => p.key === key);
    if (!preset) return;
    const cur = fieldForm.getFieldValue('validation');
    let rule = {};
    try {
      rule = JSON.parse(cur || '{}');
    } catch {
      rule = {};
    }
    if (rule && typeof rule === 'object') rule.regex = preset.regex;
    else rule = { regex: preset.regex };
    fieldForm.setFieldsValue({ validation: JSON.stringify(rule) });
  };

  // 上移 / 下移：交换相邻字段 sort_order
  const moveField = (fields, index, dir) => {
    const other = fields[index + dir];
    if (!other) return;
    notify(async () => {
      await Promise.all([
        adminFormApi.fieldUpdate(fields[index].field_id, { sort_order: other.sort_order }),
        adminFormApi.fieldUpdate(other.field_id, { sort_order: fields[index].sort_order }),
      ]);
    })();
  };

  // ---- 模板 ----
  const saveTemplate = async () => {
    if (!tplName.trim()) return;
    setSavingTpl(true);
    try {
      await adminTemplateApi.saveFromActivity(activityId, tplName.trim());
      message.success(t('admin.design.save_tpl_ok'));
      setTplModalOpen(false);
      setTplName('');
    } catch (err) {
      message.error(err.message);
    } finally {
      setSavingTpl(false);
    }
  };

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 32 }}>
        <Spin />
      </div>
    );
  }

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        {!readOnly && (
          <>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openGroupModal(null)}>
              {t('admin.design.add_group')}
            </Button>
            <Button icon={<SaveOutlined />} onClick={() => setTplModalOpen(true)}>
              {t('admin.design.save_template')}
            </Button>
          </>
        )}
        <Button icon={<SaveOutlined />} onClick={() => setTplPickerOpen(true)}>
          {t('admin.design.apply_template')}
        </Button>
      </Space>

      {forms.length === 0 ? (
        <Text type="secondary">{t('admin.design.add_group')}</Text>
      ) : (
        <Collapse
          items={forms.map((form, fi) => ({
            key: form.form_id,
            label: (
              <Space>
                <Text strong>{form.name}</Text>
                {!!form.is_required && <Tag color="red">{t('admin.design.required')}</Tag>}
                <Text type="secondary">#{form.sort_order}</Text>
              </Space>
            ),
            extra: !readOnly && (
              <Space onClick={(e) => e.stopPropagation()}>
                <Button size="small" icon={<PlusOutlined />} onClick={() => openFieldModal(form.form_id, null)}>
                  {t('admin.design.add_field')}
                </Button>
                <Button size="small" icon={<EditOutlined />} onClick={() => openGroupModal(form)} />
                <Popconfirm title={t('admin.design.delete_group')} okText={t('common.delete')} onConfirm={() => deleteGroup(form)}>
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
            children: (
              <div>
                {(form.fields || []).map((field, i) => {
                  const fmeta = FieldType[Number(field.field_type)] ?? {};
                  return (
                    <Card key={field.field_id} size="small" style={{ marginBottom: 8 }}>
                      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                        <Space>
                          <Text>{field.field_label}</Text>
                          <Tag color={fmeta.color}>{fmeta.text}</Tag>
                          {!!field.is_required && <Tag color="red">{t('admin.design.required')}</Tag>}
                          {!field.is_visible && <Text type="secondary">(hidden)</Text>}
                        </Space>
                        {!readOnly && (
                          <Space>
                            <Button size="small" icon={<ArrowUpOutlined />} disabled={i === 0} onClick={() => moveField(form.fields, i, -1)} />
                            <Button size="small" icon={<ArrowDownOutlined />} disabled={i === form.fields.length - 1} onClick={() => moveField(form.fields, i, 1)} />
                            <Button size="small" icon={<EditOutlined />} onClick={() => openFieldModal(form.form_id, field)} />
                            <Popconfirm
                              title={t('admin.design.delete_field')}
                              okText={t('common.delete')}
                              onConfirm={() => deleteField(field)}
                            >
                              <Button size="small" danger icon={<DeleteOutlined />} />
                            </Popconfirm>
                          </Space>
                        )}
                      </Space>
                      <Space style={{ marginTop: 4 }} wrap>
                        <Text type="secondary" style={{ fontSize: 12 }}>key: {field.field_key}</Text>
                        {field.placeholder && <Text type="secondary" style={{ fontSize: 12 }}>ph: {field.placeholder}</Text>}
                      </Space>
                    </Card>
                  );
                })}
              </div>
            ),
          }))}
        />
      )}

      {/* 表单组新增 / 编辑 */}
      <Modal
        open={groupModal.open}
        title={groupModal.form ? t('admin.act.edit') : t('admin.design.add_group')}
        onOk={saveGroup}
        onCancel={() => setGroupModal({ open: false, form: null })}
        destroyOnHidden
      >
        <Form form={groupForm} layout="vertical">
          <Form.Item name="name" label={t('admin.design.group_name')} rules={[{ required: true, message: t('admin.design.group_name') }]}>
            <Input maxLength={50} />
          </Form.Item>
          <Form.Item name="sort_order" label={t('admin.design.sort')}>
            <Input type="number" style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="is_required" label={t('admin.design.required')}>
            <Radio.Group>
              <Radio value={false}>否</Radio>
              <Radio value>是</Radio>
            </Radio.Group>
          </Form.Item>
        </Form>
      </Modal>

      {/* 字段新增 / 编辑 */}
      <Modal
        open={fieldModal.open}
        title={fieldModal.field ? t('admin.act.edit') : t('admin.design.add_field')}
        onOk={saveField}
        onCancel={() => setFieldModal({ open: false, formId: null, field: null })}
        width={560}
        destroyOnHidden
      >
        <Form form={fieldForm} layout="vertical">
          <Form.Item
            name="field_key"
            label={t('admin.design.field_key')}
            rules={[
              { required: true, message: t('admin.design.field_key') },
              { pattern: /^[a-z][a-z0-9_]{1,31}$/, message: t('admin.design.field_key_hint') },
            ]}
          >
            <Input disabled={!!fieldModal.field} placeholder={t('admin.design.field_key_hint')} />
          </Form.Item>
          <Form.Item name="field_label" label={t('admin.design.field_label')} rules={[{ required: true, message: t('admin.design.field_label') }]}>
            <Input maxLength={50} />
          </Form.Item>
          <Form.Item name="field_type" label={t('admin.design.field_type')} rules={[{ required: true }]}>
            <Select
              disabled={!!fieldModal.field}
              options={Object.entries(FieldType).map(([v, m]) => ({ value: Number(v), label: m.text }))}
            />
          </Form.Item>
          <Form.Item name="options" label={t('admin.design.options')} tooltip={t('admin.design.options_ph')}>
            <Input.TextArea rows={3} placeholder={t('admin.design.options_ph')} />
          </Form.Item>
          <Form.Item name="placeholder" label={t('admin.design.placeholder')}>
            <Input />
          </Form.Item>
          <Form.Item name="default_value" label={t('admin.design.default_value')}>
            <Input />
          </Form.Item>
          <Form.Item name="validation" label={t('admin.design.validation')} tooltip='JSON：{"min":1,"max":100,"regex":"...","min_length":2,"max_length":50,"min_items":1,"max_items":3}'>
            <Space direction="vertical" style={{ width: '100%' }} size={4}>
              <Input.TextArea rows={2} placeholder='JSON：{"min":1,"max":100,"regex":"...","min_length":2,"max_length":50,"min_items":1,"max_items":3}' />
              <Space size={4} wrap>
                <Text type="secondary" style={{ fontSize: 12 }}>{t('admin.design.validation_preset')}</Text>
                {VALIDATION_PRESETS.map((p) => (
                  <Button key={p.key} size="small" type="dashed" onClick={() => applyPreset(p.key)}>
                    {p.label}
                  </Button>
                ))}
              </Space>
            </Space>
          </Form.Item>
          <Form.Item name="is_required" label={t('admin.design.required')}>
            <Radio.Group>
              <Radio value={false}>否</Radio>
              <Radio value>是</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="sort_order" label={t('admin.design.sort')}>
            <Input type="number" style={{ width: 160 }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 保存为模板 */}
      <Modal
        open={tplModalOpen}
        title={t('admin.design.save_template')}
        onOk={saveTemplate}
        okButtonProps={{ loading: savingTpl }}
        onCancel={() => setTplModalOpen(false)}
        destroyOnHidden
      >
        <Input placeholder={t('admin.design.tpl_name')} value={tplName} onChange={(e) => setTplName(e.target.value)} maxLength={50} />
      </Modal>

      {/* 套用模板 */}
      <TemplatePicker open={tplPickerOpen} activityId={activityId} onClose={() => setTplPickerOpen(false)} />
    </div>
  );
}
