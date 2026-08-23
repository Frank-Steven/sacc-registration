import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Col, DatePicker, Input, Row, Statistic, Table, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { adminActivityApi } from '../../api/admin.js';
import ActivityStatusTag from '../../components/ActivityStatusTag.jsx';
import { formatTime, windowText } from '../../utils/format.js';
import { t, useI18n } from '../../utils/i18n/index.js';

const { RangePicker } = DatePicker;

// 概览看板：跨活动统计（activity.stats）
export default function Dashboard() {
  useI18n();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ keyword: '', date_from: 0, date_to: 0 });

  const { data, isFetching } = useQuery({
    queryKey: ['admin-activities-stats', page, filters],
    queryFn: () => adminActivityApi.stats({ page, page_size: 20, ...filters }),
  });
  const rows = data?.rows || [];

  // 汇总指标（当前页 + 总数兜底展示）
  const agg = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.total += r.total || 0;
        acc.pending += r.pending || 0;
        acc.waitlist += r.waitlist || 0;
        acc.checked_in += r.checked_in || 0;
        return acc;
      },
      { total: 0, pending: 0, waitlist: 0, checked_in: 0 }
    );
  }, [rows]);

  const columns = [
    {
      title: t('admin.stats.activity'),
      dataIndex: 'name',
      render: (name, r) => (
        <a onClick={() => navigate(`/admin/activities/${r.activity_id}`)}>
          <Typography.Text strong>{name}</Typography.Text>
        </a>
      ),
    },
    { title: t('admin.act.status'), dataIndex: 'status', width: 100, render: (s) => <ActivityStatusTag status={s} /> },
    { title: t('activity.window'), width: 240, render: (_, r) => windowText(r.start_time, r.end_time) },
    { title: t('admin.act.max_slots'), dataIndex: 'max_slots', width: 100, align: 'right' },
    { title: t('admin.stats.total'), dataIndex: 'total', width: 90, align: 'right' },
    { title: t('admin.stats.taken'), dataIndex: 'taken', width: 90, align: 'right' },
    { title: t('admin.stats.pending'), dataIndex: 'pending', width: 90, align: 'right' },
    { title: t('admin.stats.waitlist'), dataIndex: 'waitlist', width: 90, align: 'right' },
    { title: t('admin.stats.checked_in'), dataIndex: 'checked_in', width: 90, align: 'right' },
  ];

  return (
    <div>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col span={4}><Statistic title={t('admin.dashboard.activity_count')} value={data?.total ?? 0} /></Col>
          <Col span={5}><Statistic title={t('admin.dashboard.registration_total')} value={agg.total} /></Col>
          <Col span={5}><Statistic title={t('admin.stats.pending')} value={agg.pending} /></Col>
          <Col span={5}><Statistic title={t('admin.stats.waitlist')} value={agg.waitlist} /></Col>
          <Col span={5}><Statistic title={t('admin.stats.checked_in')} value={agg.checked_in} /></Col>
        </Row>
      </Card>
      <Card
        size="small"
        title={t('admin.dashboard.title')}
        extra={
          <div style={{ display: 'flex', gap: 8 }}>
            <Input.Search
              allowClear
              placeholder={t('admin.dashboard.keyword_ph')}
              style={{ width: 220 }}
              onSearch={(v) => { setFilters((p) => ({ ...p, keyword: v.trim() })); setPage(1); }}
            />
            <RangePicker
              onChange={(range) => {
                setFilters((p) => ({
                  ...p,
                  date_from: range?.[0] ? range[0].startOf('day').unix() : 0,
                  date_to: range?.[1] ? range[1].endOf('day').unix() : 0,
                }));
                setPage(1);
              }}
            />
          </div>
        }
      >
        <Table
          rowKey="activity_id"
          size="small"
          loading={isFetching}
          dataSource={rows}
          columns={columns}
          pagination={{
            current: page,
            pageSize: 20,
            total: data?.total ?? 0,
            onChange: setPage,
            showSizeChanger: false,
          }}
        />
      </Card>
    </div>
  );
}
