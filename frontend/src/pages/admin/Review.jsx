import { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  App, Button, Card, Descriptions, Drawer, Input, Popconfirm, Radio, Space, Spin, Table, Typography,
} from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminRosterApi } from '../../api/admin.js';
import RegistrationStatusTag from '../../components/RegistrationStatusTag.jsx';
import { formatTime } from '../../utils/format.js';
import { t, useI18n } from '../../utils/i18n/index.js';

const { Text } = Typography;

// 审核队列：待审（status=1）列表 + ReviewDrawer（通过 / 驳回 + 备注）
export default function Review() {
  useI18n();
  const { id } = useParams();
  const activityId = Number(id);
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [rid, setRid] = useState(null);
  const [approve, setApprove] = useState(true);
  const [remark, setRemark] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { data, isFetching } = useQuery({
    queryKey: ['roster', activityId, { status: 1 }, page],
    queryFn: () => adminRosterApi.list(activityId, { status: 1, page, page_size: 20 }),
  });

  const { data: detail, isFetching: detailLoading } = useQuery({
    queryKey: ['registration-detail', rid],
    queryFn: () => adminRosterApi.detail(rid),
    enabled: !!rid,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['roster', activityId] });

  const openDrawer = (row) => {
    setRid(row.registration_id);
    setApprove(true);
    setRemark('');
  };

  const submit = async () => {
    if (!approve && !remark.trim()) {
      message.error(t('admin.review.remark_required'));
      return;
    }
    setSubmitting(true);
    try {
      await adminRosterApi.review(rid, { approve, review_remark: remark.trim() });
      message.success(t('admin.review.review_ok'));
      setRid(null);
      refresh();
    } catch (err) {
      message.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    { title: t('admin.act.status'), dataIndex: 'status', width: 100, render: (s) => <RegistrationStatusTag status={s} /> },
    { title: t('admin.roster.receipt'), dataIndex: 'receipt_no', width: 130 },
    { title: t('admin.roster.user'), dataIndex: 'user_name', width: 130 },
    { title: t('admin.roster.student_id'), dataIndex: 'student_id', width: 130, render: (v) => v || '—' },
    { title: t('admin.roster.phone'), dataIndex: 'phone', width: 130, render: (v) => v || '—' },
    { title: t('admin.roster.submit_time'), dataIndex: 'created_at', width: 150, render: (v) => formatTime(v) },
    {
      title: t('admin.roster.actions'),
      width: 120,
      render: (_, r) => (
        <Button size="small" type="primary" onClick={() => openDrawer(r)}>
          {t('admin.review.title')}
        </Button>
      ),
    },
  ];

  return (
    <Card size="small" title={t('admin.review.title')}>
      <Table
        rowKey="registration_id"
        size="small"
        loading={isFetching}
        dataSource={data?.items || []}
        columns={columns}
        locale={{ emptyText: t('admin.review.empty') }}
        pagination={{
          current: page,
          pageSize: 20,
          total: data?.total ?? 0,
          onChange: setPage,
          showSizeChanger: false,
        }}
      />

      <Drawer title={t('admin.review.title')} open={!!rid} onClose={() => setRid(null)} width={520}>
        {detailLoading || !detail ? (
          <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>
        ) : (
          <>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label={t('admin.roster.receipt')}>{detail.registration?.receipt_no || '—'}</Descriptions.Item>
              <Descriptions.Item label={t('admin.roster.user')}>{detail.user?.name || '—'}</Descriptions.Item>
              <Descriptions.Item label={t('admin.roster.student_id')}>{detail.user?.student_id || '—'}</Descriptions.Item>
              <Descriptions.Item label={t('admin.roster.phone')}>{detail.user?.phone || '—'}</Descriptions.Item>
              <Descriptions.Item label={t('admin.roster.submit_time')}>{formatTime(detail.registration?.created_at)}</Descriptions.Item>
            </Descriptions>
            <div style={{ margin: '16px 0 8px', fontWeight: 600 }}>
              <Text>{t('admin.roster.fields')}</Text>
            </div>
            {(detail.items || []).map((f) => (
              <div key={f.field_id} style={{ marginBottom: 8 }}>
                <Text strong style={{ fontSize: 13 }}>{f.field_label}</Text>
                <div style={{ marginTop: 2 }}>
                  <Text style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{f.field_value ?? ''}</Text>
                </div>
              </div>
            ))}
            <div style={{ marginTop: 20 }}>
              <Radio.Group value={approve} onChange={(e) => setApprove(e.target.value)} style={{ marginBottom: 12 }}>
                <Radio value>{t('admin.review.approve')}</Radio>
                <Radio value={false}>{t('admin.review.reject')}</Radio>
              </Radio.Group>
              <Input.TextArea
                rows={3}
                placeholder={t('admin.review.remark_ph')}
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                maxLength={500}
              />
              <Popconfirm
                title={t('admin.review.confirm')}
                okText={t('common.confirm')}
                onConfirm={submit}
              >
                <Button type="primary" loading={submitting} style={{ marginTop: 12 }}>
                  {t('common.submit')}
                </Button>
              </Popconfirm>
            </div>
          </>
        )}
      </Drawer>
    </Card>
  );
}
