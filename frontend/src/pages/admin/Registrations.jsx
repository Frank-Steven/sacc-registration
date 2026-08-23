import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  App, Button, Card, Descriptions, Drawer, Input, Select, Space, Spin, Table, Typography,
} from 'antd';
import { DownloadOutlined, ExportOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { adminRosterApi, downloadCsv } from '../../api/admin.js';
import RegistrationStatusTag from '../../components/RegistrationStatusTag.jsx';
import { formatTime } from '../../utils/format.js';
import { t, useI18n } from '../../utils/i18n/index.js';

const { Text } = Typography;

// 多选字段值以 JSON 数组字符串存储，展示时展开
function displayValue(field) {
  if (Number(field.field_type) === 3) {
    try {
      const arr = JSON.parse(field.field_value || '[]');
      return Array.isArray(arr) ? arr.join('、') : field.field_value;
    } catch {
      return field.field_value;
    }
  }
  return field.field_value ?? '';
}

// RFC 4180 转义（全量分块导出拼 CSV 用）
function csvEscape(s) {
  const str = s == null ? '' : String(s);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}

// 名单：状态 / 关键字筛选 + 详情 Drawer + CSV / 全量分块导出
export default function Registrations() {
  useI18n();
  const { id } = useParams();
  const activityId = Number(id);
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [status, setStatus] = useState(undefined);
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [detailRid, setDetailRid] = useState(null);
  const [exporting, setExporting] = useState(false);

  const filters = useMemo(
    () => ({ status, keyword: keyword || undefined }),
    [status, keyword]
  );

  const { data, isFetching } = useQuery({
    queryKey: ['roster', activityId, filters, page],
    queryFn: () => adminRosterApi.list(activityId, { ...filters, page, page_size: 20 }),
  });

  const { data: detail, isFetching: detailLoading } = useQuery({
    queryKey: ['registration-detail', detailRid],
    queryFn: () => adminRosterApi.detail(detailRid),
    enabled: !!detailRid,
  });

  // CSV 导出（带 BOM；后端 max_csv_rows 超限 422 → 提示分块）
  const handleCsv = async () => {
    try {
      await downloadCsv(activityId, filters);
      message.success(t('admin.roster.export_ok'));
    } catch (err) {
      message.error(t('admin.roster.export_limit'));
    }
  };

  // 全量导出：分块循环拉取拼 CSV（cursor 游标）
  const handleExportFull = async () => {
    setExporting(true);
    try {
      let cursor = 0;
      let total = 0;
      let columns = [];
      let lines = [];
      do {
        const chunk = await adminRosterApi.exportChunk(activityId, { cursor, limit: 5000 });
        if (columns.length === 0) columns = chunk.columns || [];
        for (const row of chunk.rows || []) {
          lines.push(columns.map((c) => csvEscape(row[c.key])).join(','));
        }
        total = chunk.total;
        cursor = chunk.next_cursor || 0;
      } while (cursor > 0);
      const head = columns.map((c) => csvEscape(c.label)).join(',');
      const csv = `\uFEFF${head}\n${lines.join('\n')}`;
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `registrations_${activityId}_full.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      message.success(t('admin.roster.export_done', { n: total }));
    } catch (err) {
      message.error(err.message);
    } finally {
      setExporting(false);
    }
  };

  const columns = [
    { title: t('admin.act.status'), dataIndex: 'status', width: 100, render: (s) => <RegistrationStatusTag status={s} /> },
    { title: t('admin.roster.receipt'), dataIndex: 'receipt_no', width: 130 },
    { title: t('admin.roster.queue'), dataIndex: 'queue_no', width: 80, align: 'right', render: (v) => v ?? '—' },
    { title: t('admin.roster.user'), dataIndex: 'user_name', width: 120 },
    { title: t('admin.roster.student_id'), dataIndex: 'student_id', width: 120, render: (v) => v || '—' },
    { title: t('admin.roster.phone'), dataIndex: 'phone', width: 130, render: (v) => v || '—' },
    { title: t('admin.roster.submit_time'), dataIndex: 'created_at', width: 150, render: (v) => formatTime(v) },
    {
      title: t('admin.roster.review_time'),
      width: 150,
      render: (_, r) => (r.review_time ? formatTime(r.review_time) : '—'),
    },
    {
      title: t('admin.roster.actions'),
      width: 200,
      render: (_, r) => (
        <Space size={4}>
          <Button size="small" type="link" onClick={() => setDetailRid(r.registration_id)}>
            {t('admin.roster.detail')}
          </Button>
          {r.status === 1 && (
            <Button size="small" type="link" onClick={() => navigate(`/admin/activities/${activityId}/review`)}>
              {t('admin.roster.go_review')}
            </Button>
          )}
          {r.status === 2 && !r.checkin_time && (
            <Button size="small" type="link" onClick={() => navigate(`/admin/activities/${activityId}/checkin`)}>
              {t('admin.roster.go_checkin')}
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card
      size="small"
      title={t('admin.roster.title')}
      extra={
        <Space>
          <Button icon={<DownloadOutlined />} onClick={handleCsv}>
            {t('admin.roster.export_csv')}
          </Button>
          <Button icon={<ExportOutlined />} loading={exporting} onClick={handleExportFull}>
            {t('admin.roster.export_full')}
          </Button>
        </Space>
      }
    >
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          allowClear
          placeholder={t('admin.roster.all')}
          style={{ width: 140 }}
          value={status}
          onChange={(v) => { setStatus(v); setPage(1); }}
          options={[0, 1, 2, 3, 4, 5].map((s) => ({ value: s, label: t(`status.${s}`) }))}
        />
        <Input.Search
          allowClear
          placeholder={t('admin.roster.keyword_ph')}
          style={{ width: 280 }}
          onSearch={(v) => { setKeyword(v.trim()); setPage(1); }}
        />
      </Space>
      <Table
        rowKey="registration_id"
        size="small"
        loading={isFetching}
        dataSource={data?.items || []}
        columns={columns}
        scroll={{ x: 1200 }}
        pagination={{
          current: page,
          pageSize: 20,
          total: data?.total ?? 0,
          onChange: setPage,
          showSizeChanger: false,
        }}
      />

      <Drawer
        title={t('admin.roster.detail')}
        open={!!detailRid}
        onClose={() => setDetailRid(null)}
        width={520}
      >
        {detailLoading || !detail ? (
          <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>
        ) : (
          <>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label={t('admin.act.status')}>
                <RegistrationStatusTag status={detail.registration?.status} />
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.roster.receipt')}>{detail.registration?.receipt_no || '—'}</Descriptions.Item>
              <Descriptions.Item label={t('admin.roster.user')}>{detail.user?.name || '—'}</Descriptions.Item>
              <Descriptions.Item label="学号">{detail.user?.student_id || '—'}</Descriptions.Item>
              <Descriptions.Item label="手机">{detail.user?.phone || '—'}</Descriptions.Item>
              <Descriptions.Item label="邮箱">{detail.user?.email || '—'}</Descriptions.Item>
              <Descriptions.Item label={t('admin.roster.submit_time')}>{formatTime(detail.registration?.created_at)}</Descriptions.Item>
              <Descriptions.Item label={t('admin.roster.review_time')}>
                {detail.registration?.review_time ? formatTime(detail.registration.review_time) : '—'}
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.roster.review_remark')}>
                {detail.registration?.review_remark || '—'}
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.roster.checkin_time')}>
                {detail.registration?.checkin_time ? formatTime(detail.registration.checkin_time) : '—'}
              </Descriptions.Item>
            </Descriptions>
            <DividerText title={t('admin.roster.fields')} />
            {(detail.items || []).map((f) => (
              <div key={f.field_id} style={{ marginBottom: 8 }}>
                <Text strong style={{ fontSize: 13 }}>{f.field_label}</Text>
                <div style={{ marginTop: 2 }}>
                  <Text style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{displayValue(f)}</Text>
                </div>
              </div>
            ))}
          </>
        )}
      </Drawer>
    </Card>
  );
}

function DividerText({ title }) {
  return (
    <div style={{ margin: '16px 0 12px', fontWeight: 600 }}>
      <Text>{title}</Text>
    </div>
  );
}
