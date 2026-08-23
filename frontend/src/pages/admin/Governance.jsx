import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { App, Button, Card, Col, Empty, Row, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { DatabaseOutlined, DownloadOutlined, FileZipOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminGovernanceApi, downloadBackup } from '../../api/admin.js';
import { formatTime } from '../../utils/format.js';
import { t, useI18n } from '../../utils/i18n/index.js';
import { useDocumentTitle } from '../../utils/useDocumentTitle.js';

const { Text, Title } = Typography;

// 核心表展示（label 回退 raw key）
const CORE_TABLES = ['activity', 'registration', 'registration_data', 'user', 'account', 'notification', 'audit_log'];

// 软删实体 → 跳转目标
const DELETED_LINKS = {
  activity: '/admin/activities',
  group: '/admin/groups',
  form: '/admin/activities',
  form_field: '/admin/activities',
};

// 轻量计数动画（~600ms ease-out，3.5 微交互）
function useCountUp(target) {
  const [value, setValue] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const from = prev.current;
    const to = Number(target) || 0;
    if (from === to) return;
    const start = performance.now();
    const dur = 600;
    let raf;
    const tick = (now) => {
      const p = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = Math.round(from + (to - from) * eased);
      setValue(v);
      if (p < 1) raf = requestAnimationFrame(tick);
      else prev.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return value;
}

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// 数据治理（M7 十二，旅程 B）：数据量概览 / 备份管理 / 软删清单
export default function Governance() {
  useI18n();
  useDocumentTitle();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [highlight, setHighlight] = useState(null);

  const { data: stats } = useQuery({ queryKey: ['admin-db-stats'], queryFn: adminGovernanceApi.dbStats, staleTime: 30_000 });
  const { data: backupData, isFetching: backupFetching } = useQuery({
    queryKey: ['admin-backups'],
    queryFn: adminGovernanceApi.backups,
    refetchInterval: 30_000,
  });
  const backups = backupData?.items || [];

  const tableCounts = stats?.table_counts || {};
  const deletedCounts = stats?.deleted_counts || {};

  const totalRows = useCountUp(CORE_TABLES.reduce((s, k) => s + (Number(tableCounts[k]) || 0), 0));
  const dbSize = stats?.db_size || 0;

  const handleBackup = async () => {
    setCreating(true);
    try {
      const out = await adminGovernanceApi.createBackup();
      await queryClient.invalidateQueries({ queryKey: ['admin-backups'] });
      const name = out?.name || out?.file || '';
      if (name) setHighlight(name);
      message.success(t('admin.sys.gov.backup_ok'));
    } catch {
      message.error(t('admin.sys.gov.backup_fail'));
    } finally {
      setCreating(false);
    }
  };

  const backupColumns = [
    {
      title: t('admin.sys.gov.name'),
      dataIndex: 'name',
      ellipsis: true,
      render: (v) => (
        <Space size={6}>
          <FileZipOutlined />
          <Text style={{ fontFamily: 'monospace' }}>{v}</Text>
          {v === highlight && <Tag color="success">{t('admin.sys.gov.backup_ok')}</Tag>}
        </Space>
      ),
    },
    { title: t('admin.sys.gov.size'), dataIndex: 'size', width: 110, render: (v) => formatSize(v) },
    { title: t('admin.sys.gov.time'), dataIndex: 'mtime', width: 150, render: (v) => <Text style={{ fontVariantNumeric: 'tabular-nums' }}>{formatTime(v)}</Text> },
    {
      title: '',
      key: 'op',
      width: 80,
      align: 'right',
      render: (_, row) => (
        <Tooltip title={t('admin.sys.gov.download')}>
          <Button type="link" size="small" icon={<DownloadOutlined />} onClick={() => downloadBackup(row.name).catch((e) => message.error(e.message))} />
        </Tooltip>
      ),
    },
  ];

  const deletedEntries = Object.entries(deletedCounts);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0, fontWeight: 600 }}>{t('admin.sys.gov.title')}</Title>
          <Text type="secondary">{t('admin.sys.gov.subtitle')}</Text>
        </div>
      </div>

      <Row gutter={16}>
        {/* 数据量概览 */}
        <Col xs={24} lg={12} style={{ marginBottom: 16 }}>
          <Card
            title={
              <Space>
                <DatabaseOutlined />
                {t('admin.sys.gov.stats')}
              </Space>
            }
            extra={
              <Button
                type="link"
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => navigate(`/admin/audit-logs?start=${Math.floor(Date.now() / 1000) - 86400}&end=${Math.floor(Date.now() / 1000)}`)}
              >
                {t('admin.sys.audit.title')}
              </Button>
            }
          >
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col span={12}>
                <div>
                  <Text type="secondary">{t('admin.sys.gov.rows')}</Text>
                  <div style={{ fontSize: 28, fontWeight: 600, color: '#1677ff' }}>{totalRows}</div>
                </div>
              </Col>
              <Col span={12}>
                <div>
                  <Text type="secondary">{t('admin.sys.gov.db_size')}</Text>
                  <div style={{ fontSize: 28, fontWeight: 600 }}>{formatSize(dbSize)}</div>
                </div>
              </Col>
            </Row>
            <Table
              rowKey={(r) => r.k}
              size="small"
              pagination={false}
              dataSource={CORE_TABLES.map((k) => ({ k, v: Number(tableCounts[k]) || 0 }))}
              columns={[
                { key: 'name', render: (_, r) => t(`admin.sys.gov.table_${r.k}`) },
                { title: t('admin.sys.gov.rows'), dataIndex: 'v', width: 90, align: 'right' },
              ]}
            />
          </Card>
        </Col>

        {/* 备份管理 */}
        <Col xs={24} lg={12} style={{ marginBottom: 16 }}>
          <Card
            title={t('admin.sys.gov.backup')}
            extra={
              <Button type="primary" size="small" icon={<FileZipOutlined />} loading={creating} onClick={handleBackup}>
                {creating ? t('admin.sys.gov.backup_creating') : t('admin.sys.gov.backup_now')}
              </Button>
            }
          >
            <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
              {t('admin.sys.gov.backup_retention')}
            </Text>
            <Table
              rowKey="name"
              size="small"
              loading={backupFetching}
              columns={backupColumns}
              dataSource={backups}
              pagination={false}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('admin.sys.gov.empty_backup')} /> }}
            />
          </Card>
        </Col>
      </Row>

      {/* 软删清单 */}
      <Card title={t('admin.sys.gov.soft_deleted_title')} style={{ marginBottom: 16 }}>
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          {t('admin.sys.gov.deleted_hint')}
        </Text>
        {deletedEntries.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('admin.sys.gov.no_deleted')} />
        ) : (
          <Space wrap size={[8, 8]}>
            {deletedEntries.map(([k, v]) => (
              <Link key={k} to={DELETED_LINKS[k] || '/admin'}>
                <Tag style={{ cursor: 'pointer', padding: '4px 12px', marginInlineEnd: 0 }}>
                  {t(`admin.sys.gov.deleted_${k}`)}：{v}
                </Tag>
              </Link>
            ))}
          </Space>
        )}
      </Card>
    </div>
  );
}
