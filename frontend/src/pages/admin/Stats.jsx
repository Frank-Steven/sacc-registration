import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Col, Empty, Progress, Radio, Row, Statistic, Table, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { adminStatsApi } from '../../api/admin.js';
import { t, useI18n } from '../../utils/i18n/index.js';

const { Text } = Typography;

// 单活动看板：指标卡 + 状态分布 + 字段分布 + 报名趋势（自绘 SVG 折线，D1 不引入图表库）
export default function Stats() {
  useI18n();
  const { id } = useParams();
  const activityId = Number(id);
  const [days, setDays] = useState(7);

  const { data: stats, isFetching } = useQuery({
    queryKey: ['stats', activityId],
    queryFn: () => adminStatsApi.registrationStats(activityId),
  });

  const { data: trend } = useQuery({
    queryKey: ['trend', activityId, days],
    queryFn: () => adminStatsApi.trend(activityId, days),
  });

  const statusDist = stats?.status_dist || [];
  const fieldDist = stats?.field_dist || [];
  const capacity = stats?.capacity || 0;

  const trendSvg = useMemo(() => {
    const items = trend?.items || [];
    if (items.length < 2) return null;
    const W = 720;
    const H = 160;
    const pad = 8;
    const max = Math.max(...items.map((i) => i.count), 1);
    const stepX = (W - pad * 2) / (items.length - 1);
    const points = items.map((it, i) => {
      const x = pad + i * stepX;
      const y = H - pad - (it.count / max) * (H - pad * 2);
      return [x, y];
    });
    const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const area = `${line} L${points[points.length - 1][0].toFixed(1)},${H - pad} L${points[0][0].toFixed(1)},${H - pad} Z`;
    return { items, points, line, area, W, H, max };
  }, [trend]);

  const statusColumns = [
    {
      title: t('admin.act.status'),
      dataIndex: 'status',
      width: 120,
      render: (s) => t(`status.${s}`),
    },
    { title: t('admin.stats.total'), dataIndex: 'count', width: 100, align: 'right' },
  ];

  const fieldColumns = [
    { title: t('admin.design.field_label'), dataIndex: 'label' },
    { title: t('admin.design.options'), dataIndex: 'items', render: (items) => (items || []).map((it) => it.label).join('、') || '—' },
    { title: t('admin.stats.total'), dataIndex: 'count', align: 'right', render: (_, r) => (r.items || []).reduce((s, it) => s + (it.count || 0), 0) },
  ];

  return (
    <SpaceVertical>
      <Card size="small" loading={isFetching}>
        <Row gutter={16}>
          <Col span={5}><Statistic title={t('admin.stats.capacity')} value={capacity} /></Col>
          <Col span={5}><Statistic title={t('admin.stats.taken')} value={stats?.taken ?? 0} /></Col>
          <Col span={5}><Statistic title={t('admin.stats.pending')} value={stats?.pending ?? 0} /></Col>
          <Col span={4}><Statistic title={t('admin.stats.waitlist')} value={stats?.waitlist ?? 0} /></Col>
          <Col span={5}><Statistic title={t('admin.stats.checked_in')} value={stats?.checked_in ?? 0} /></Col>
        </Row>
      </Card>

      <Row gutter={16}>
        <Col span={10}>
          <Card size="small" title={t('admin.stats.status_dist')}>
            <Table
              rowKey="status"
              size="small"
              pagination={false}
              dataSource={statusDist}
              columns={statusColumns}
              locale={{ emptyText: t('admin.stats.no_data') }}
            />
          </Card>
        </Col>
        <Col span={14}>
          <Card size="small" title={t('admin.stats.field_dist')}>
            <Table
              rowKey="field_id"
              size="small"
              pagination={false}
              dataSource={fieldDist}
              columns={fieldColumns}
              locale={{ emptyText: t('admin.stats.no_data') }}
            />
          </Card>
        </Col>
      </Row>

      <Card
        size="small"
        title={t('admin.stats.trend')}
        extra={
          <Radio.Group
            value={days}
            onChange={(e) => setDays(e.target.value)}
            optionType="button"
            size="small"
            options={[7, 30, 90].map((d) => ({ value: d, label: t('admin.stats.days', { n: d }) }))}
          />
        }
      >
        {trendSvg ? (
          <svg viewBox={`0 0 ${trendSvg.W} ${trendSvg.H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
            <defs>
              <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1677ff" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#1677ff" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            <path d={trendSvg.area} fill="url(#trendFill)" />
            <polyline points={trendSvg.points.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke="#1677ff" strokeWidth="2" />
            {trendSvg.points.map(([x, y], i) => (
              <g key={i}>
                <circle cx={x} cy={y} r="2.5" fill="#1677ff" />
                <text x={x} y={trendSvg.H - 2} fontSize="10" textAnchor="middle" fill="#999">
                  {trendSvg.items[i].date.slice(5)}
                </text>
                <text x={x} y={y - 6} fontSize="10" textAnchor="middle" fill="#666">
                  {trendSvg.items[i].count}
                </text>
              </g>
            ))}
          </svg>
        ) : (
          <Empty description={t('admin.stats.no_data')} />
        )}
        {trendSvg && (
          <div style={{ marginTop: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              max: {trendSvg.max} / {t('admin.stats.days', { n: trendSvg.items.length })}
            </Text>
          </div>
        )}
      </Card>
    </SpaceVertical>
  );
}

// 竖向间距容器（避免 Row 直排无间距）
function SpaceVertical({ children }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>{children}</div>;
}
