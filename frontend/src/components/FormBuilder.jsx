import { Checkbox, DatePicker, Form, Input, InputNumber, Select } from 'antd';
import { t, useI18n } from '../utils/i18n/index.js';

// options 支持数组或「换行 / 逗号」分隔的字符串
function parseOptions(options) {
  if (Array.isArray(options)) return options.filter((o) => o !== '' && o != null);
  if (typeof options === 'string') {
    return options
      .split(/[\n,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

// 依据 field.validation JSON（{min,max,min_length,max_length,regex,min_items,max_items}）生成 antd rules
function buildRules(field) {
  const rules = [];
  if (field.is_required) rules.push({ required: true, message: t('form.required_field', { label: field.field_label }) });
  const v = field.validation || {};
  switch (field.field_type) {
    case 0: // 文本
      if (v.min_length) rules.push({ min: v.min_length, message: t('form.min_length', { label: field.field_label, n: v.min_length }) });
      if (v.max_length) rules.push({ max: v.max_length, message: t('form.max_length', { label: field.field_label, n: v.max_length }) });
      if (v.regex) {
        try {
          rules.push({ pattern: new RegExp(v.regex), message: t('form.invalid_format', { label: field.field_label }) });
        } catch {
          /* 非法正则忽略 */
        }
      }
      break;
    case 1: // 数字
      if (v.min !== undefined && v.min !== null) rules.push({ type: 'number', min: v.min, message: t('form.min_value', { label: field.field_label, n: v.min }) });
      if (v.max !== undefined && v.max !== null) rules.push({ type: 'number', max: v.max, message: t('form.max_value', { label: field.field_label, n: v.max }) });
      break;
    case 3: // 多选
      if (v.min_items) rules.push({ type: 'array', min: v.min_items, message: t('form.min_items', { n: v.min_items }) });
      if (v.max_items) rules.push({ type: 'array', max: v.max_items, message: t('form.max_items', { n: v.max_items }) });
      break;
    default:
      break;
  }
  return rules;
}

function renderControl(field, disabled) {
  const d = disabled || field.is_editable === false;
  switch (field.field_type) {
    case 0:
      return <Input placeholder={field.placeholder} disabled={d} maxLength={field.validation?.max_length || undefined} />;
    case 1:
      return (
        <InputNumber
          style={{ width: '100%' }}
          placeholder={field.placeholder}
          disabled={d}
          min={field.validation?.min}
          max={field.validation?.max}
        />
      );
    case 2:
      return (
        <Select
          placeholder={field.placeholder}
          disabled={d}
          options={parseOptions(field.options).map((o) => ({ label: o, value: o }))}
        />
      );
    case 3:
      return <Checkbox.Group disabled={d} options={parseOptions(field.options)} />;
    case 4:
      return <DatePicker style={{ width: '100%' }} disabled={d} />;
    case 5:
      return <Input placeholder={t('form.file_upload_soon')} disabled />;
    default:
      return <Input placeholder={field.placeholder} disabled={d} />;
  }
}

// 报名表单渲染器：自建 <Form form={form}>，字段 name 用 field_id（提交时映射回 {field_id,value}）
export default function FormBuilder({ form, fields, initialValues, disabled, onValuesChange }) {
  useI18n();
  const visible = (fields || []).filter((f) => f.is_visible !== false);
  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={initialValues}
      disabled={disabled}
      onValuesChange={onValuesChange}
      autoComplete="off"
    >
      {visible.map((f) => (
        <Form.Item key={f.field_id} name={f.field_id} label={f.field_label} rules={buildRules(f)}>
          {renderControl(f, disabled)}
        </Form.Item>
      ))}
    </Form>
  );
}
