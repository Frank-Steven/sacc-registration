import { Empty, Spin, Tree } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { groupApi } from '../api/index.js';
import { t, useI18n } from '../utils/i18n/index.js';

// items 递归构建 antd Tree 数据（后端已按 parent_id 给出层级，children 含子分组）
function toTreeData(items) {
  const map = new Map();
  (items || []).forEach((g) => map.set(g.group_id, { ...g, children: [] }));
  const roots = [];
  (items || []).forEach((g) => {
    const node = map.get(g.group_id);
    const parent = g.parent_id ? map.get(g.parent_id) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  const walk = (list) =>
    list.map((n) => ({
      title: n.name,
      key: String(n.group_id),
      children: n.children.length ? walk(n.children) : undefined,
    }));
  return walk(roots);
}

// 活动分组树：公开数据，5 分钟缓存；点选即回调 group_id（字符串）
export default function GroupTree({ selected, onSelect }) {
  useI18n();
  const { data, isLoading } = useQuery({
    queryKey: ['group-tree'],
    queryFn: groupApi.publicTree,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 16 }}>
        <Spin />
      </div>
    );
  }

  const treeData = toTreeData(data?.items);
  if (!treeData.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('group.empty')} />;

  return (
    <Tree
      treeData={treeData}
      blockNode
      defaultExpandAll
      selectedKeys={selected != null ? [String(selected)] : []}
      onSelect={(keys) => onSelect(keys.length ? String(keys[0]) : null)}
    />
  );
}
