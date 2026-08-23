// 公共文案（全部域共用）：通用按钮 / 状态枚举 / 时间文案 / 设置项
export const common = {
  // 通用动作
  'common.save': { zh: '保存', en: 'Save' },
  'common.cancel': { zh: '取消', en: 'Cancel' },
  'common.confirm': { zh: '确定', en: 'OK' },
  'common.delete': { zh: '删除', en: 'Delete' },
  'common.edit': { zh: '编辑', en: 'Edit' },
  'common.add': { zh: '新增', en: 'Add' },
  'common.search': { zh: '搜索', en: 'Search' },
  'common.submit': { zh: '提交', en: 'Submit' },
  'common.back': { zh: '返回', en: 'Back' },
  'common.loading': { zh: '加载中', en: 'Loading' },
  'common.optional': { zh: '选填', en: 'Optional' },
  'common.required': { zh: '必填', en: 'Required' },
  'common.all': { zh: '全部', en: 'All' },
  'common.none': { zh: '暂无', en: 'None' },
  'common.restore_default': { zh: '恢复默认', en: 'Restore default' },
  'common.continue_fill': { zh: '继续填写', en: 'Continue' },
  'common.view': { zh: '查看', en: 'View' },
  'common.view_receipt': { zh: '查看凭证', en: 'View receipt' },

  // M9 移动端下拉刷新
  'pull.pull': { zh: '下拉刷新', en: 'Pull to refresh' },
  'pull.release': { zh: '松开刷新', en: 'Release to refresh' },
  'pull.refreshing': { zh: '刷新中…', en: 'Refreshing…' },

  // 报名状态：0 填写中 / 1 待审核 / 2 已通过 / 3 未通过 / 4 已取消 / 5 候补
  'status.0': { zh: '填写中', en: 'Draft' },
  'status.1': { zh: '待审核', en: 'Pending review' },
  'status.2': { zh: '已通过', en: 'Approved' },
  'status.3': { zh: '未通过', en: 'Rejected' },
  'status.4': { zh: '已取消', en: 'Cancelled' },
  'status.5': { zh: '候补', en: 'Waitlist' },

  // 活动形式：0 线下 / 1 线上 / 2 混合
  'activityType.0': { zh: '线下', en: 'Offline' },
  'activityType.1': { zh: '线上', en: 'Online' },
  'activityType.2': { zh: '混合', en: 'Hybrid' },

  // 字段类型：0 文本 / 1 数字 / 2 单选 / 3 多选 / 4 日期 / 5 文件
  'fieldType.0': { zh: '文本', en: 'Text' },
  'fieldType.1': { zh: '数字', en: 'Number' },
  'fieldType.2': { zh: '单选', en: 'Single choice' },
  'fieldType.3': { zh: '多选', en: 'Multiple choice' },
  'fieldType.4': { zh: '日期', en: 'Date' },
  'fieldType.5': { zh: '文件', en: 'File' },

  // 通知类型 / 渠道
  'notifyType.0': { zh: '报名成功', en: 'Registration' },
  'notifyType.1': { zh: '审核结果', en: 'Review result' },
  'notifyType.2': { zh: '活动提醒', en: 'Reminder' },
  'notifyType.3': { zh: '候补', en: 'Waitlist' },
  'notifyType.4': { zh: '邮件发送失败', en: 'Email failed' },
  'notifyChannel.0': { zh: '站内信', en: 'In-app' },
  'notifyChannel.1': { zh: '邮件', en: 'Email' },

  // 时间文案（utils/format.js）
  'time.unknown': { zh: '时间待定', en: 'To be announced' },
  'time.deadline': { zh: '截止 {time}', en: 'Deadline {time}' },
  'time.from': { zh: '{time} 起', en: 'From {time}' },
  'time.range': { zh: '{start} ~ {end}', en: '{start} ~ {end}' },
  'time.starts_in': { zh: '距报名开始 {n}', en: 'Starts in {n}' },
  'time.ends_in': { zh: '距截止 {n}', en: 'Ends in {n}' },
  'time.closed': { zh: '已截止', en: 'Closed' },
  'quota.unlimited': { zh: '名额不限', en: 'Unlimited' },
  'quota.full': { zh: '已满员', en: 'Full' },
  'quota.left': { zh: '{taken}/{max}', en: '{taken}/{max}' },

  // 设置
  'settings.theme': { zh: '切换主题', en: 'Toggle theme' },
  'settings.language': { zh: '切换语言', en: 'Switch language' },
};
