import { Button, Result } from 'antd';
import { Link } from 'react-router-dom';
import { t, useI18n } from '../../utils/i18n/index.js';

// 管理端占位：后续里程碑提供，当前引导返回报名端工作台
export default function AdminPlaceholder() {
  useI18n();
  return (
    <Result
      status="info"
      title={t('admin.placeholder')}
      subTitle={t('admin.soon')}
      extra={
        <Link to="/workbench">
          <Button type="primary">{t('nav.back_portal')}</Button>
        </Link>
      }
    />
  );
}
