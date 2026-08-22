import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button, Card, Descriptions, Divider, Space, Spin, Typography, App as AntApp } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { registrationApi } from '../../api/index.js';
import RegistrationStatusTag from '../../components/RegistrationStatusTag.jsx';
import ReceiptModal from '../../components/ReceiptModal.jsx';
import { formatTime } from '../../utils/format.js';
import { t, useI18n } from '../../utils/i18n/index.js';

const { Text } = Typography;

// 展示报名详情与凭证；操作：已通过 → 查看凭证 / 签到；填写中 → 继续填写；
// 0/1/2/5 → 取消报名（409 冲突时提示后端 message）
export default function RegistrationDetail() {
  useI18n();
  const { rid } = useParams();
  const { message, modal } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [receiptOpen, setReceiptOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['registration', rid],
    queryFn: () => registrationApi.detail(rid),
  });

  const registration = data?.registration;
  const items = data?.items ?? [];

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['registration', rid] });
    queryClient.invalidateQueries({ queryKey: ['my-registrations'] });
  };

  const cancelMutation = useMutation({
    mutationFn: () => registrationApi.cancel(rid),
    onSuccess: () => {
      message.success(t('reg.cancelled'));
      invalidateAll();
    },
    onError: (err) => message.error(err.message),
  });

  const checkinMutation = useMutation({
    mutationFn: () => registrationApi.checkin(rid),
    onSuccess: () => {
      message.success(t('reg.checkin_success'));
      queryClient.invalidateQueries({ queryKey: ['registration', rid] });
    },
    onError: (err) => message.error(err.message),
  });

  const confirmCancel = () => {
    modal.confirm({
      title: t('reg.cancel_title'),
      content: t('reg.cancel_confirm'),
      okText: t('reg.cancel_ok'),
      okButtonProps: { danger: true },
      cancelText: t('reg.cancel_later'),
      onOk: () => cancelMutation.mutateAsync().catch(() => {}),
    });
  };

  if (isLoading || !registration) {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin size="large" />
        </div>
      </Card>
    );
  }

  const actions = [];
  if (registration.status === 2) {
    actions.push(
      <Button key="receipt" type="primary" onClick={() => setReceiptOpen(true)}>
        {t('common.view_receipt')}
      </Button>,
      <Button key="checkin" loading={checkinMutation.isPending} onClick={() => checkinMutation.mutate()}>
        {t('reg.checkin')}
      </Button>
    );
  }
  if (registration.status === 0) {
    actions.push(
      <Link key="continue" to={`/activities/${registration.activity_id}/register`}>
        <Button type="primary">{t('common.continue_fill')}</Button>
      </Link>
    );
  }
  if ([0, 1, 2, 5].includes(registration.status)) {
    actions.push(
      <Button key="cancel" danger loading={cancelMutation.isPending} onClick={confirmCancel}>
        {t('reg.cancel')}
      </Button>
    );
  }

  return (
    <Card title={registration.activity_name} extra={<Space wrap>{actions}</Space>}>
      <Descriptions bordered column={1} size="small" labelStyle={{ width: 120 }}>
        <Descriptions.Item label={t('reg.detail.activity')}>{registration.activity_name}</Descriptions.Item>
        <Descriptions.Item label={t('reg.detail.status')}>
          <RegistrationStatusTag status={registration.status} />
        </Descriptions.Item>
        <Descriptions.Item label={t('reg.detail.receipt_no')}>{registration.receipt_no || '—'}</Descriptions.Item>
        <Descriptions.Item label={t('reg.detail.queue_no')}>
          {registration.queue_no != null ? t('reg.detail.queue_rank', { n: registration.queue_no }) : '—'}
        </Descriptions.Item>
        <Descriptions.Item label={t('reg.detail.review_remark')}>{registration.review_remark || '—'}</Descriptions.Item>
        <Descriptions.Item label={t('reg.detail.created_at')}>{formatTime(registration.created_at)}</Descriptions.Item>
        <Descriptions.Item label={t('reg.detail.checkin_time')}>{formatTime(registration.checkin_time)}</Descriptions.Item>
      </Descriptions>

      {items.length > 0 && (
        <>
          <Divider orientation="left">{t('reg.detail.items_title')}</Divider>
          <Descriptions bordered column={1} size="small" labelStyle={{ width: 120 }}>
            {items.map((it) => (
              <Descriptions.Item key={it.field_id} label={it.field_label}>
                {Array.isArray(it.value) ? it.value.join('、') : it.value}
              </Descriptions.Item>
            ))}
          </Descriptions>
        </>
      )}

      <ReceiptModal open={receiptOpen} onClose={() => setReceiptOpen(false)} registration={registration} />
    </Card>
  );
}
