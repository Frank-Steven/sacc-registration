import { Button, Modal, Typography } from 'antd';
import { QRCodeSVG } from 'qrcode.react';
import { t, useI18n } from '../utils/i18n/index.js';

const { Title, Text } = Typography;

// 报名成功凭证弹窗：活动名 + 凭证号 + 二维码（value 为 receipt_no）
export default function ReceiptModal({ open, onClose, registration }) {
  useI18n();
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={<Button type="primary" onClick={onClose}>{t('common.confirm')}</Button>}
      centered
      width={380}
    >
      <div style={{ textAlign: 'center', padding: '8px 0' }}>
        <Title level={4} type="success" style={{ marginBottom: 4 }}>{t('receipt.success')}</Title>
        {registration?.activity_name && (
          <Text style={{ fontSize: 15 }}>{registration.activity_name}</Text>
        )}
        <div style={{ margin: '20px 0' }}>
          <QRCodeSVG value={String(registration?.receipt_no || '')} size={200} />
        </div>
        <div>
          <Text type="secondary">{t('receipt.no', { no: registration?.receipt_no })}</Text>
        </div>
        {registration?.name && (
          <div style={{ marginTop: 8 }}>
            <Text type="secondary">{t('receipt.name', { name: registration.name })}</Text>
          </div>
        )}
      </div>
    </Modal>
  );
}
