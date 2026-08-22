import { useState } from 'react';
import { Button, Card, Empty, Input, Select, Space, Spin, Typography } from 'antd';
import { useInfiniteQuery } from '@tanstack/react-query';
import { activityApi } from '../../api/index.js';
import ActivityCard from '../../components/ActivityCard.jsx';
import GroupTree from '../../components/GroupTree.jsx';
import { t, useI18n } from '../../utils/i18n/index.js';

const { Text } = Typography;

const PAGE_SIZE = 50;

// 活动大厅（公开可读）：左侧分组树筛选 + 右侧活动列表（关键词 / 形式筛选 + 加载更多）
export default function Activities() {
  useI18n();
  const [groupId, setGroupId] = useState(null);
  const [keyword, setKeyword] = useState('');
  const [type, setType] = useState(undefined);

  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['activities', { group_id: groupId, keyword, activity_type: type }],
    queryFn: ({ pageParam = 1 }) =>
      activityApi.publicList({
        page: pageParam,
        page_size: PAGE_SIZE,
        group_id: groupId || undefined,
        keyword: keyword || undefined,
        activity_type: type,
      }),
    initialPageParam: 1,
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + (p?.items?.length || 0), 0);
      const total = last?.total || 0;
      return loaded < total ? all.length + 1 : undefined;
    },
  });

  const items = (data?.pages || []).flatMap((p) => p?.items || []);

  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
      <Card title={t('group.title')} size="small" style={{ width: 240, flexShrink: 0 }}>
        <GroupTree selected={groupId} onSelect={setGroupId} />
      </Card>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Space style={{ marginBottom: 16 }} wrap>
          <Input.Search
            allowClear
            placeholder={t('activities.search_placeholder')}
            style={{ width: 220 }}
            onSearch={(v) => setKeyword(v.trim())}
            onChange={(e) => {
              if (!e.target.value) setKeyword('');
            }}
          />
          <Select
            allowClear
            placeholder={t('activities.type')}
            style={{ width: 120 }}
            options={[0, 1, 2].map((v) => ({ value: v, label: t(`activityType.${v}`) }))}
            onChange={(v) => setType(v)}
          />
        </Space>

        {isLoading ? (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <Spin />
          </div>
        ) : items.length === 0 ? (
          <Empty description={t('activities.empty')} />
        ) : (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {items.map((a) => (
              <ActivityCard key={a.activity_id} activity={a} />
            ))}
          </Space>
        )}

        {hasNextPage && (
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <Button loading={isFetchingNextPage} onClick={() => fetchNextPage()}>
              {t('activities.load_more')}
            </Button>
          </div>
        )}
        {!hasNextPage && items.length > 0 && (
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <Text type="secondary">{t('activities.no_more')}</Text>
          </div>
        )}
      </div>
    </div>
  );
}
