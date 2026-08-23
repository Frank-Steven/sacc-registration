import { useMemo } from 'react';
import { TreeSelect } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { adminGroupApi } from '../api/admin.js';

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

// 分组树多选（绑定活动分组；group.tree 仅超管可查，403 时由页面提示）
export default function GroupTreeSelect({ value, onChange, disabled }) {
  const { data } = useQuery({ queryKey: ['admin-groups'], queryFn: adminGroupApi.tree, staleTime: 60_000 });
  const treeData = useMemo(() => buildTree(data?.items), [data]);
  return (
    <TreeSelect
      treeData={treeData}
      treeCheckable
      showCheckedStrategy={TreeSelect.SHOW_PARENT}
      value={value}
      onChange={onChange}
      disabled={disabled}
      allowClear
      placeholder=" "
      style={{ width: '100%' }}
    />
  );
}
