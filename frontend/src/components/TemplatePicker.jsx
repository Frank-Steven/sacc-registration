import { useState } from 'react';
import { App, Modal, Select, Spin } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminTemplateApi } from '../api/admin.js';
import { t } from '../utils/i18n/index.js';

// 模板选择器：从模板列表中选择并套用到目标活动
export default function TemplatePicker({ open, activityId, onClose, onApplied }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [tid, setTid] = useState(undefined);
  const [applying, setApplying] = useState(false);
  const { data: templates, isLoading } = useQuery({
    queryKey: ['admin-templates'],
    queryFn: adminTemplateApi.list,
    enabled: open,
  });

  const doApply = async () => {
    if (!tid) return;
    setApplying(true);
    try {
      await adminTemplateApi.apply(tid, activityId);
      message.success(t('admin.tpl.apply_ok'));
      queryClient.invalidateQueries({ queryKey: ['admin-activity', activityId] });
      setTid(undefined);
      onApplied?.();
      onClose();
    } catch (err) {
      message.error(err.message);
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t('admin.design.apply_template')}
      onOk={doApply}
      onCancel={onClose}
      okButtonProps={{ disabled: !tid, loading: applying }}
      destroyOnHidden
    >
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Spin />
        </div>
      ) : (
        <Select
          style={{ width: '100%' }}
          placeholder={t('admin.tpl.apply_to')}
          value={tid}
          onChange={setTid}
          options={(templates?.items || []).map((tp) => ({
            value: tp.template_id,
            label: tp.name,
          }))}
        />
      )}
    </Modal>
  );
}
