import { Button, Space, Tooltip } from 'antd';
import { MoonOutlined, SunOutlined } from '@ant-design/icons';
import { usePreferencesStore } from '../stores/preferences.js';
import { t } from '../utils/i18n/index.js';

// 主题（深浅）与语言（中/英）切换控件：深色顶栏传 dark 适配文字颜色
export default function AppSettings({ dark }) {
  const theme = usePreferencesStore((s) => s.theme);
  const locale = usePreferencesStore((s) => s.locale);
  const toggleTheme = usePreferencesStore((s) => s.toggleTheme);
  const setLocale = usePreferencesStore((s) => s.setLocale);

  const style = dark ? { color: 'rgba(255,255,255,0.85)' } : undefined;
  return (
    <Space size={4}>
      <Tooltip title={t('settings.theme')}>
        <Button
          type="text"
          size="small"
          aria-label={t('settings.theme')}
          icon={theme === 'dark' ? <SunOutlined /> : <MoonOutlined />}
          style={style}
          onClick={toggleTheme}
        />
      </Tooltip>
      <Button type="text" size="small" aria-label={t('settings.language')} style={style} onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}>
        {locale === 'zh' ? 'EN' : '中'}
      </Button>
    </Space>
  );
}
