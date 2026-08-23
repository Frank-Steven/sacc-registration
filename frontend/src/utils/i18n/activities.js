// 活动大厅 / 详情 / 报名表单 / 工作台文案（Agent B 负责补充）
export const activities = {
  // 分组树
  'group.title': { zh: '活动分组', en: 'Groups' },
  'group.empty': { zh: '暂无分组', en: 'No groups' },

  // 活动大厅
  'activities.search_placeholder': { zh: '搜索活动', en: 'Search activities' },
  'activities.type': { zh: '活动形式', en: 'Type' },
  'activities.empty': { zh: '暂无活动', en: 'No activities' },
  'activities.load_more': { zh: '加载更多', en: 'Load more' },
  'activities.no_more': { zh: '已全部加载', en: 'No more' },

  // 名额 / 审核标记
  'quota.need_review': { zh: '需审核', en: 'Review needed' },
  'status.unknown': { zh: '未知({status})', en: 'Unknown ({status})' },

  // 活动详情
  'activity.window': { zh: '报名时间', en: 'Registration window' },
  'activity.slots': { zh: '名额', en: 'Slots' },
  'activity.review': { zh: '审核', en: 'Review' },
  'activity.review_required': { zh: '报名后需管理员审核', en: 'Requires admin approval' },
  'activity.review_not_required': { zh: '无需审核，报名即通过', en: 'No review, auto-approved' },
  'activity.not_started': { zh: '未开始，{time} 开放报名', en: 'Registration opens at {time}' },
  'activity.in_progress': { zh: '报名中', en: 'Open' },
  'activity.closed': { zh: '报名已截止', en: 'Registration closed' },
  'activity.full': { zh: '名额已满', en: 'Full' },
  'activity.register_now': { zh: '立即报名', en: 'Register now' },
  'activity.reviewing': { zh: '审核中', en: 'Under review' },
  'activity.view_detail': { zh: '查看详情', en: 'View detail' },
  'activity.waitlisted': { zh: '候补中', en: 'On waitlist' },
  'activity.subscribe': { zh: '订阅提醒', en: 'Get notified' },
  'activity.unsubscribe': { zh: '已订阅', en: 'Subscribed' },
  'activity.remind_me': { zh: '报名开始前提醒我', en: 'Notify me before registration opens' },
  'activity.form_fields': { zh: '报名需填写内容', en: 'Fields to fill' },
  'activity.not_found': { zh: '活动不存在或已下架', en: 'Activity not found' },
  'activity.login_prompt': { zh: '请先登录后再报名', en: 'Please sign in to register' },

  // 报名表单
  'form.step': { zh: '第 {n} 步', en: 'Step {n}' },
  'form.prev': { zh: '上一步', en: 'Previous' },
  'form.next': { zh: '下一步', en: 'Next' },
  'form.back_detail': { zh: '返回活动详情', en: 'Back to activity' },
  'form.resume_draft_title': { zh: '继续上次填写？', en: 'Resume draft?' },
  'form.resume_draft_content': { zh: '是否继续上次的填写内容？', en: 'Continue where you left off?' },
  'form.restart_fill': { zh: '重新填写', en: 'Start over' },
  'form.submitted_pending': { zh: '已提交，等待审核', en: 'Submitted, pending review' },
  'form.waitlist': { zh: '已进入候补，排名 {n}', en: 'Added to waitlist, rank {n}' },
  'form.waitlist_queue': { zh: '已进入候补队列', en: 'Added to waitlist' },
  'form.submitted': { zh: '提交成功', en: 'Submitted' },
  'form.creating': { zh: '正在创建报名…', en: 'Creating registration…' },
  'form.no_form': { zh: '该活动暂无报名表单', en: 'No registration form yet' },
  'form.no_form_hint': { zh: '请等待主办方配置后再来报名。', en: 'Please wait for the organizer to configure it.' },
  'form.required_field': { zh: '请填写{label}', en: '{label} is required' },
  'form.min_length': { zh: '{label}至少 {n} 个字符', en: '{label} needs at least {n} characters' },
  'form.max_length': { zh: '{label}最多 {n} 个字符', en: '{label} allows at most {n} characters' },
  'form.invalid_format': { zh: '{label}格式不正确', en: 'Invalid {label} format' },
  'form.min_value': { zh: '{label}不能小于 {n}', en: '{label} cannot be less than {n}' },
  'form.max_value': { zh: '{label}不能大于 {n}', en: '{label} cannot exceed {n}' },
  'form.min_items': { zh: '请至少选择 {n} 项', en: 'Select at least {n} items' },
  'form.max_items': { zh: '最多选择 {n} 项', en: 'Select at most {n} items' },
  'form.file_upload_soon': { zh: '文件上传暂未开放，请线下提交', en: 'File upload not available, submit offline' },

  // 工作台
  'workbench.quick': { zh: '快捷入口', en: 'Quick actions' },
  'workbench.empty': { zh: '暂无相关报名', en: 'No registrations found' },
  'workbench.resubmit': { zh: '修改并重新提交', en: 'Edit and resubmit' },
  'workbench.resubmit_closed': { zh: '活动报名窗口已过，无法重新提交', en: 'Registration window closed, cannot resubmit' },
  'workbench.queue_no': { zh: '排队号 {n}', en: 'Queue No. {n}' },
  'workbench.reg_time': { zh: '报名时间：{time}', en: 'Registered: {time}' },
  'workbench.act_time': { zh: '活动时间：{time}', en: 'Activity: {time}' },
  'workbench.receipt_no': { zh: '凭证号：{no}', en: 'Receipt: {no}' },
  'workbench.reject_reason': { zh: '未通过原因：{reason}', en: 'Reason: {reason}' },

  // 报名凭证
  'receipt.success': { zh: '报名成功', en: 'Registration confirmed' },
  'receipt.no': { zh: '凭证号：{no}', en: 'Receipt No.: {no}' },
  'receipt.name': { zh: '姓名：{name}', en: 'Name: {name}' },
};
