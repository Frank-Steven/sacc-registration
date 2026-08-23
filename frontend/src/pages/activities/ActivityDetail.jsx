import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Popconfirm,
  Progress,
  Space,
  Spin,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { App } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { activityApi, registrationApi, subscribeApi } from '../../api/index.js';
import { useAuthStore } from '../../stores/auth.js';
import { ActivityType } from '../../constants/index.js';
import { formatTime, windowText, quotaPercent } from '../../utils/format.js';
import { t, useI18n } from '../../utils/i18n/index.js';

const { Title, Text, Paragraph } = Typography;

// 活动详情（公开可读）：窗口 / 名额 / 审核标记 / 订阅提醒（登录后）/ 报名按钮状态机 / 字段预览
export default function ActivityDetail() {
  useI18n();
  const { id } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();

  const { data: activity, isLoading, error } = useQuery({
    queryKey: ['activity', id],
    queryFn: () => activityApi.publicDetail(id),
    staleTime: 5 * 60 * 1000,
  });

  // 订阅提醒（仅登录后查询）
  const { data: subs } = useQuery({
    queryKey: ['subscribes'],
    queryFn: subscribeApi.mine,
    enabled: !!token,
  });
  const subscribed = (subs?.items || []).some((s) => String(s.activity_id) === String(id));

  // 当前用户对该活动的报名状态（登录后查询），驱动报名按钮文案
  const { data: myRegs } = useQuery({
    queryKey: ['my-registrations'],
    queryFn: () => registrationApi.mine({ page_size: 100 }),
    enabled: !!token,
  });
  const myReg = (myRegs?.items || []).find((r) => String(r.activity_id) === String(id));
  const regStatus = myReg?.status;

  const cancelMutation = useMutation({
    mutationFn: () => registrationApi.cancel(myReg.registration_id),
    onSuccess: () => {
      message.success(t('reg.cancelled'));
      qc.invalidateQueries({ queryKey: ['my-registrations'] });
    },
    onError: (e) => message.error(e.message),
  });

  const subMutation = useMutation({
    mutationFn: () => (subscribed ? subscribeApi.remove(id) : subscribeApi.add(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['subscribes'] }),
    onError: (e) => message.error(e.message),
  });

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 64 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error || !activity) {
    return (
      <Card>
        <Alert
          type="error"
          showIcon
          message={error?.message || t('activity.not_found')}
          action={
            <Link to="/activities">
              <Button size="small">{t('guard.back_activities')}</Button>
            </Link>
          }
        />
      </Card>
    );
  }

  const type = ActivityType[activity.activity_type];
  const unlimited = !activity.max_slots || activity.max_slots <= 0;
  const pct = quotaPercent(activity.taken, activity.max_slots);
  const full = !unlimited && activity.taken >= activity.max_slots;

  // 报名按钮状态机
  const now = Date.now() / 1000;
  const beforeStart = activity.start_time > 0 && now < activity.start_time;
  const afterEnd = activity.end_time > 0 && now >= activity.end_time;
  let state = 'open';
  if (beforeStart) state = 'before';
  else if (afterEnd) state = 'closed';
  else if (full) state = 'full';
  const stateText = {
    before: t('activity.not_started', { time: formatTime(activity.start_time) }),
    closed: t('activity.closed'),
    full: t('activity.full'),
    open: t('activity.in_progress'),
  }[state];

  const handleRegister = () => {
    if (!token) {
      message.info(t('activity.login_prompt'));
      navigate(`/login?redirect=${encodeURIComponent(`/activities/${id}/register`)}`);
      return;
    }
    navigate(`/activities/${id}/register`);
  };

  const forms = [...(activity.forms || [])].sort((a, b) => a.sort_order - b.sort_order);

  // 信息展示区：比赛地点（管理员在「活动配置」中配置 venue_name / venue_address）
  const venue = [activity.configs?.venue_name, activity.configs?.venue_address]
    .filter((v) => v && String(v).trim())
    .map((v) => String(v).trim())
    .join(' · ');

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <div>
        <Title level={3} style={{ marginBottom: 8 }}>{activity.name}</Title>
        <Space wrap>
          {type && <Tag color={type.color}>{t(`activityType.${activity.activity_type}`)}</Tag>}
          {activity.need_review && <Tag color="orange">{t('quota.need_review')}</Tag>}
        </Space>
      </div>

      <Card size="small">
        <Descriptions
          column={1}
          size="small"
          items={[
            {
              key: 'window',
              label: t('activity.window'),
              children: windowText(activity.start_time, activity.end_time),
            },
            {
              key: 'deadline',
              label: t('activity.deadline'),
              children: activity.end_time ? formatTime(activity.end_time) : '—',
            },
            {
              key: 'competition',
              label: t('activity.competition_time'),
              children: activity.competition_start
                ? windowText(activity.competition_start, activity.competition_end)
                : '—',
            },
            {
              key: 'venue',
              label: t('activity.venue'),
              children: venue || '—',
            },
            {
              key: 'slots',
              label: t('activity.slots'),
              children: unlimited ? (
                t('quota.unlimited')
              ) : (
                <Space direction="vertical" size={0} style={{ width: 260 }}>
                  <Progress
                    percent={pct}
                    size="small"
                    status={full ? 'exception' : undefined}
                    format={() => t('quota.left', { taken: activity.taken, max: activity.max_slots })}
                  />
                  {full && <Text type="danger">{t('quota.full')}</Text>}
                </Space>
              ),
            },
            {
              key: 'review',
              label: t('activity.review'),
              children: activity.need_review ? t('activity.review_required') : t('activity.review_not_required'),
            },
          ]}
        />
      </Card>

      {activity.description && <Paragraph style={{ whiteSpace: 'pre-wrap' }}>{activity.description}</Paragraph>}

      <Space align="center" wrap>
        {(() => {
          const registerBtn = (label) => (
            <Tooltip title={stateText}>
              <Button type="primary" size="large" disabled={state !== 'open'} onClick={handleRegister}>
                {label}
              </Button>
            </Tooltip>
          );
          // 未登录 / 未报名 / 已取消 → 立即报名；草稿 → 继续填写；
          // 待审核 → 审核中（可取消）；已通过 → 查看详情；候补 → 候补中（可取消）
          if (!token || regStatus === undefined || regStatus === 4) return registerBtn(t('activity.register_now'));
          if (regStatus === 0) return registerBtn(t('common.continue_fill'));
          if (regStatus === 1) {
            return (
              <Tooltip title={t('activity.reviewing')}>
                <Button type="primary" size="large" disabled>{t('activity.reviewing')}</Button>
              </Tooltip>
            );
          }
          if (regStatus === 2) {
            return (
              <Link to={`/my-registrations/${myReg.registration_id}`}>
                <Button type="primary" size="large">{t('activity.view_detail')}</Button>
              </Link>
            );
          }
          return (
            <Tooltip title={t('activity.waitlisted')}>
              <Button type="primary" size="large" disabled>{t('activity.waitlisted')}</Button>
            </Tooltip>
          );
        })()}
        {token && myReg && (regStatus === 1 || regStatus === 5) && (
          <Popconfirm
            title={t('reg.cancel_title')}
            okText={t('reg.cancel_ok')}
            cancelText={t('reg.cancel_later')}
            okButtonProps={{ danger: true }}
            onConfirm={() => cancelMutation.mutate()}
          >
            <Button danger size="large" loading={cancelMutation.isPending}>
              {t('reg.cancel')}
            </Button>
          </Popconfirm>
        )}
        {token && (
          <Space>
            <Switch
              checked={subscribed}
              loading={subMutation.isPending}
              onChange={() => subMutation.mutate()}
              checkedChildren={t('activity.unsubscribe')}
              unCheckedChildren={t('activity.subscribe')}
            />
            <Text type="secondary">{t('activity.remind_me')}</Text>
          </Space>
        )}
      </Space>

      {forms.length > 0 && (
        <>
          <Title level={5}>{t('activity.form_fields')}</Title>
          {forms.map((form) => (
            <Card key={form.form_id} size="small" title={form.name} style={{ marginBottom: 8 }}>
              <Space wrap>
                {(form.fields || [])
                  .filter((f) => f.is_visible !== false)
                  .map((f) => (
                    <Tag key={f.field_id}>
                      {f.field_label}
                      {f.is_required ? ' *' : ''}
                    </Tag>
                  ))}
              </Space>
            </Card>
          ))}
        </>
      )}
    </Space>
  );
}
