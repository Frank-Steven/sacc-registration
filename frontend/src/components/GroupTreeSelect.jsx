import { useMemo } from 'react';
import { TreeSelect } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { adminGroupApi } from '../api/admin.js';
import { t, useI18n } from '../utils/i18n/index.js';

// 扁平分组列表 → antd TreeSelect treeData（软删分组剔除）
function buildTree(items) {
  const alive = (items || []).filter((g) => !g.is_deleted);
  const map = new Map();
  alive.forEach((g) => map.set(g.group_id, { value: g.group_id, title: g.name, children: [] }));
  const roots = [];
  alive.forEach((g) => {
    const node = map.get(g.group_id);
    const parent = map.get(g.parent_id);
    if (parent && g.parent_id !== g.group_id) parent.children.push(node);
    else roots.push(node);
  });
  return roots;
}

// 分组树选择器：
// - 多选（默认）：treeCheckable + SHOW_PARENT（绑定活动分组）
// - 单选（single）：顶部「全范围」选项（value=0 映射 null），用于角色授权分组范围
// group.tree 仅超管可查，403 时由页面提示
export default function GroupTreeSelect({ value, onChange, disabled, single }) {
  useI18n();
  const { data } = useQuery({ queryKey: ['admin-groups'], queryFn: adminGroupApi.tree, staleTime: 60_000 });
  const treeData = useMemo(() => {
    const roots = buildTree(data?.items);
    if (!single) return roots;
    return [{ value: 0, title: t('admin.sys.role.full_scope'), children: roots }];
  }, [data, single]);

  const handleChange = (v) => {
    // 单选模式 value=0 代表全范围 → null；其余为 group_id
    onChange(single ? (v && v !== 0 ? v : null) : v);
  };

  if (single) {
    return (
      <TreeSelect
        treeData={treeData}
        treeDefaultExpandAll
        value={value === null || value === undefined ? 0 : value}
        onChange={handleChange}
        disabled={disabled}
        allowClear={false}
        placeholder=" "
        style={{ width: '100%' }}
      />
    );
  }
  return (
    <TreeSelect
      treeData={treeData}
      treeCheckable
      showCheckedStrategy={TreeSelect.SHOW_PARENT}
      value={value}
      onChange={handleChange}
      disabled={disabled}
      allowClear
      placeholder=" "
      style={{ width: '100%' }}
    />
  );
}
