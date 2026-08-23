import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Alert, App, Button, Card, Input, Popconfirm, Segmented, Space, Spin, Table, Tag, Typography } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminActivityApi, adminRosterApi } from '../../api/admin.js';
import RegistrationStatusTag from '../../components/RegistrationStatusTag.jsx';
import { formatTime } from '../../utils/format.js';
import { t, useI18n } from '../../utils/i18n/index.js';

const { Text, Title } = Typography;

// 签到：按 checkin_mode 分三种形态（0 现场扫码 / 1 线上自助 / 2 动态码大屏）+ 已通过名单补签
export default function Checkin() {
  useI18n();
  const { id } = useParams();
  const activityId = Number(id);
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [receipt, setReceipt] = useState('');
  const [checking, setChecking] = useState(false);
  // 名单筛选：all / checked / unchecked
  const [filter, setFilter] = useState('all');
  // 动态码倒计时（逐秒递减，新码到达时重置为 expires_in）
  const [countdown, setCountdown] = useState(60);

  const { data: configs } = useQuery({
    queryKey: ['activity-config', activityId],
    queryFn: () => adminActivityApi.configList(activityId),
  });
  // 后端返回 { items: [{key, value, type, remark}] }
  const mode = useMemo(() => {
    const item = (configs?.items || []).find((c) => c.key === 'checkin_mode');
    return item ? Number(item.value) : 0;
  }, [configs]);

  // 已通过报名（status=2）：含已签 / 未签，供补签；每 10s 轮询实时刷新
  const { data: roster, isFetching } = useQuery({
    queryKey: ['roster', activityId, { status: 2 }],
    queryFn: () => adminRosterApi.list(activityId, { status: 2, page_size: 100 }),
    refetchInterval: 10_000,
  });
  const approved = roster?.items || [];
  const approvedFiltered = approved.filter((r) => {
    if (filter === 'checked') return !!r.checkin_time;
    if (filter === 'unchecked') return !r.checkin_time;
    return true;
  });

  // 动态码（mode=2）：60s 定时器兜底 + 本地逐秒倒数归零时立即拉新码，
  // 避免定时器与后端 60s 槽位（TOTP）不对齐导致码过期后迟迟不刷新
  const { data: codeData, refetch: refetchCode } = useQuery({
    queryKey: ['checkin-code', activityId],
    queryFn: () => adminRosterApi.checkinCode(activityId),
    enabled: mode === 2,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!codeData) return;
    setCountdown(codeData.expires_in ?? 60);
  }, [codeData]);

  useEffect(() => {
    const timer = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(timer);
  }, []);

  // 倒计时归零（1 → 0 仅触发一次）→ 立即拉取新码
  const refetchCodeRef = useRef(refetchCode);
  refetchCodeRef.current = refetchCode;
  useEffect(() => {
    if (countdown === 0) refetchCodeRef.current();
  }, [countdown]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['roster', activityId] });

  const doCheckinByReceipt = async () => {
    if (!receipt.trim()) {
      message.error(t('admin.checkin.receipt_required'));
      return;
    }
    setChecking(true);
    try {
      await adminRosterApi.checkinByReceipt(receipt.trim());
      message.success(t('admin.checkin.ok'));
      setReceipt('');
      refresh();
    } catch (err) {
      message.error(err.message);
    } finally {
      setChecking(false);
    }
  };

  const doManualCheckin = async (row) => {
    try {
      await adminRosterApi.checkinById(row.registration_id);
      message.success(t('admin.checkin.ok'));
      refresh();
    } catch (err) {
      message.error(err.message);
    }
  };

  const modeHints = {
    0: t('admin.checkin.mode0_hint'),
    1: t('admin.checkin.mode1_hint'),
    2: t('admin.checkin.mode2_hint'),
  };

  const columns = [
    { title: t('admin.act.status'), dataIndex: 'status', width: 100, render: (s) => <RegistrationStatusTag status={s} /> },
    { title: t('admin.roster.receipt'), dataIndex: 'receipt_no', width: 130 },
    { title: t('admin.roster.user'), dataIndex: 'user_name', width: 130 },
    { title: t('admin.roster.student_id'), dataIndex: 'student_id', width: 130, render: (v) => v || '—' },
    { title: t('admin.roster.checkin_time'), dataIndex: 'checkin_time', width: 160, render: (v) => (v ? formatTime(v) : <Tag>{t('admin.checkin.unchecked')}</Tag>) },
    {
      title: t('admin.roster.actions'),
      width: 110,
      render: (_, r) =>
        r.checkin_time ? null : (
          <Popconfirm title={t('admin.checkin.manual_confirm')} okText={t('common.confirm')} onConfirm={() => doManualCheckin(r)}>
            <Button size="small" type="link">{t('admin.checkin.manual')}</Button>
          </Popconfirm>
        ),
    },
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Alert type="info" showIcon message={modeHints[mode] ?? modeHints[0]} />
      <Card size="small" title={t('admin.checkin.title')}>
        {mode === 0 && (
          <Space.Compact style={{ maxWidth: 520, width: '100%' }}>
            <Input
              placeholder={t('admin.checkin.receipt_ph')}
              value={receipt}
              onChange={(e) => setReceipt(e.target.value)}
              onPressEnter={doCheckinByReceipt}
              allowClear
            />
            <Button type="primary" loading={checking} onClick={doCheckinByReceipt}>
              {t('admin.checkin.do')}
            </Button>
          </Space.Compact>
        )}

        {mode === 2 && (
          <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
            <Text type="secondary">{t('admin.checkin.code_hint')}</Text>
            <div style={{ marginTop: 8 }}>
              {codeData ? (
                <Space direction="vertical" size={8}>
                  <Title level={1} style={{ letterSpacing: 12, margin: 0, fontFamily: 'monospace' }}>
                    {codeData.code}
                  </Title>
                  <Text type="secondary">
                    {t('admin.checkin.expires_in', { n: countdown })}
                  </Text>
                </Space>
              ) : (
                <Spin />
              )}
            </div>
          </div>
        )}

        {mode !== 0 && mode !== 2 && (
          <Text type="secondary">{t('admin.checkin.mode1_hint')}</Text>
        )}
      </Card>

      <Card
        size="small"
        title={t('admin.checkin.checked_list')}
        extra={
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: t('admin.checkin.filter_all') },
              { value: 'unchecked', label: t('admin.checkin.filter_unchecked') },
              { value: 'checked', label: t('admin.checkin.filter_checked') },
            ]}
          />
        }
      >
        <Table
          rowKey="registration_id"
          size="small"
          loading={isFetching}
          dataSource={approvedFiltered}
          columns={columns}
          pagination={{ pageSize: 20, showSizeChanger: false }}
        />
      </Card>
    </Space>
  );
}
