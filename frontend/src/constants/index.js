// 枚举映射（与后端保持一致，见 docs/backend/*.md）
// 报名状态：0 填写中 / 1 待审核 / 2 已通过 / 3 未通过 / 4 已取消 / 5 候补
export const RegistrationStatus = Object.freeze({
  0: { text: '填写中', color: 'default' },
  1: { text: '待审核', color: 'processing' },
  2: { text: '已通过', color: 'success' },
  3: { text: '未通过', color: 'error' },
  4: { text: '已取消', color: 'default' },
  5: { text: '候补', color: 'warning' },
});

// 活动形式：0 线下 / 1 线上 / 2 混合
export const ActivityType = Object.freeze({
  0: { text: '线下', color: 'blue' },
  1: { text: '线上', color: 'purple' },
  2: { text: '混合', color: 'geekblue' },
});

// 活动状态（管理端）：0 草稿 / 1 进行中 / 2 已截止 / 3 已结束
export const ActivityStatus = Object.freeze({
  0: { text: '草稿', color: 'default' },
  1: { text: '进行中', color: 'processing' },
  2: { text: '已截止', color: 'warning' },
  3: { text: '已结束', color: 'default' },
});

// 表单字段类型：0 文本 / 1 数字 / 2 下拉选择 / 3 多选 / 4 日期 / 5 文件 / 6 单选 / 7 多行文本
export const FieldType = Object.freeze({
  0: { text: '文本', color: 'default' },
  1: { text: '数字', color: 'cyan' },
  2: { text: '下拉选择', color: 'blue' },
  3: { text: '多选', color: 'purple' },
  4: { text: '日期', color: 'green' },
  5: { text: '文件', color: 'orange' },
  6: { text: '单选', color: 'blue' },
  7: { text: '多行文本', color: 'default' },
});

// 通知类型：0 报名成功 / 1 审核结果 / 2 活动提醒 / 3 候补
export const NotifyType = Object.freeze({
  0: { text: '报名成功', color: 'success' },
  1: { text: '审核结果', color: 'processing' },
  2: { text: '活动提醒', color: 'warning' },
  3: { text: '候补', color: 'volcano' },
  4: { text: '邮件发送失败', color: 'error' },
});

// 通知渠道（M8 起支持复选）：1=站内信 / 2=邮箱 / 3=两者（bitmask）
export const NotifyChannel = Object.freeze([
  { value: 1, text: '站内信' },
  { value: 2, text: '邮箱' },
]);

// 常用信息内置模板（报名表单预填数据源，field_key 与 form_field.field_key 对齐约定）
export const CommonInfoTemplates = Object.freeze([
  { field_key: 'name', field_label: '姓名' },
  { field_key: 'student_id', field_label: '学号' },
  { field_key: 'college', field_label: '学院' },
  { field_key: 'phone', field_label: '手机号' },
  { field_key: 'email', field_label: '邮箱' },
]);
