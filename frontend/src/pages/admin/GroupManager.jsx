import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { App, Button, Card, Col, Empty, Form, Input, InputNumber, Modal, Popconfirm, Row, Space, Spin, Table, Tag, Tooltip, Tree, TreeSelect, Typography } from 'antd';
import {
  PlusOutlined, EditOutlined, SwapOutlined, DeleteOutlined, ArrowLeftOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminGroupApi, adminActivityApi } from '../../api/admin.js';
import ActivityStatusTag from '../../components/ActivityStatusTag.jsx';
import { formatTime, windowText } from '../../utils/format.js';
import { t, useI18n } from '../../utils/i18n/index.js';
import { useDocumentTitle } from '../../utils/useDocumentTitle.js';

const { Text, Title } = Typography;

// 扁平 items（含 parent_id / is_deleted）→ 内存树（按 sort_order, group_id 排序）
function buildTree(items) {
  const byId = new Map((items || []).map((g) => [g.group_id, { ...g, children: [] }]));
  const roots = [];
  (items || []).forEach((g) => {
    const node = byId.get(g.group_id);
    const parent = g.parent_id && byId.has(g.parent_id) ? byId.get(g.parent_id) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  const sortNodes = (list) => {
    list.sort((a, b) => (a.sort_order - b.sort_order) || (a.group_id - b.group_id));
    list.forEach((n) => sortNodes(n.children));
  };
  sortNodes(roots);
  return roots;
}

// 树 → antd Tree treeData
function toAntd(nodes) {
  return nodes.map((n) => ({
    key: String(n.group_id),
    title: n.name,
    data: n,
    children: n.children.length ? toAntd(n.children) : undefined,
  }));
}

// 收集节点及其全部后代 group_id（用于移动目标排除自身子树）
function collectSubtree(node, set = new Set()) {
  set.add(node.group_id);
  node.children.forEach((c) => collectSubtree(c, set));
  return set;
}

// 分组管理（M7 七）：左树右列表双栏；树 CRUD / 移动 / 关联活动
export default function GroupManager() {
  useI18n();
  useDocumentTitle();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [selectedKey, setSelectedKey] = useState(null);
  const [modal, setModal] = useState(null); // { mode: 'create'|'rename'|'move', group }
  const [form] = Form.useForm();

  const { data, isLoading } = useQuery({
    queryKey: ['admin-groups'],
    queryFn: adminGroupApi.tree,
    staleTime: 5 * 60 * 1000,
  });
  const tree = useMemo(() => buildTree(data?.items), [data]);
  const treeData = useMemo(() => toAntd(tree), [tree]);
  const byId = useMemo(() => new Map((data?.items || []).map((g) => [g.group_id, g])), [data]);

  const selectedGroup = selectedKey ? byId.get(Number(selectedKey)) : null;
  const selectedNode = useMemo(() => {
    let found = null;
    const walk = (nodes) => {
      for (const n of nodes) {
        if (String(n.group_id) === selectedKey) { found = n; break; }
        if (!found) walk(n.children);
      }
    };
    walk(tree);
    return found;
  }, [tree, selectedKey]);

  const invalidateGroups = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-groups'] });
    queryClient.invalidateQueries({ queryKey: ['admin-group-activities'] });
  };

  // 右侧：选中分组下活动列表
  const { data: actData, isFetching: actFetching } = useQuery({
    queryKey: ['admin-group-activities', selectedKey],
    queryFn: () => adminActivityApi.list({ group_id: selectedKey, page_size: 100 }),
    enabled: !!selectedKey,
  });
  const activities = actData?.items || [];

  const openCreate = (parentGroup) => {
    setModal({ mode: 'create', group: parentGroup || null });
    form.resetFields();
  };
  const openRename = (group) => {
    setModal({ mode: 'rename', group });
    form.setFieldsValue({ name: group.name, sort_order: group.sort_order });
  };
  const openMove = (group) => {
    setModal({ mode: 'move', group });
    form.setFieldsValue({ parent_id: group.parent_id || 0 });
  };

  const handleOk = async () => {
    const values = await form.validateFields();
    const { mode, group } = modal;
    try {
      if (mode === 'create') {
        await adminGroupApi.create({
          name: values.name,
          sort_order: values.sort_order || 0,
          parent_id: group ? group.group_id : 0,
        });
        message.success(t('admin.sys.groups.create_ok'));
        if (!group) setSelectedKey(null);
      } else if (mode === 'rename') {
        await adminGroupApi.update(group.group_id, { name: values.name, sort_order: values.sort_order ?? 0 });
        message.success(t('admin.sys.groups.update_ok'));
      } else {
        await adminGroupApi.update(group.group_id, { parent_id: values.parent_id || 0 });
        message.success(t('admin.sys.groups.move_ok'));
      }
      setModal(null);
      invalidateGroups();
    } catch (err) {
      message.error(err.message);
    }
  };

  const handleDelete = async (group) => {
    try {
      await adminGroupApi.remove(group.group_id);
      message.success(t('admin.sys.groups.delete_ok'));
      if (selectedKey === String(group.group_id)) setSelectedKey(null);
      invalidateGroups();
    } catch (err) {
      message.error(err.message);
    }
  };

  // 移动目标：排除自身 + 全部后代（前端置灰，后端 409 兜底）
  const moveOptions = useMemo(() => {
    const excluded = selectedNode ? collectSubtree(selectedNode) : new Set();
    const toOpts = (nodes, depth) =>
      nodes.map((n) => ({
        title: n.name,
        value: n.group_id,
        disabled: excluded.has(n.group_id),
        children: n.children.length ? toOpts(n.children, depth + 1) : undefined,
      }));
    return toOpts(tree, 0);
  }, [tree, selectedNode]);

  const renderTitle = (node) => {
    const g = node.data;
    const softDeleted = !!g.is_deleted;
    return (
      <Space size={8} style={{ opacity: softDeleted ? 0.5 : 1 }}>
        <span>{node.title}</span>
        {softDeleted && (
          <Tooltip title={t('admin.sys.groups.deleted_hint')}>
            <Tag style={{ marginInlineEnd: 0 }}>{t('admin.sys.groups.deleted')}</Tag>
          </Tooltip>
        )}
        {!softDeleted && (
          <span className="tree-node-actions">
            <Space size={2}>
              <Tooltip title={t('admin.sys.groups.new_child')}>
                <Button type="text" size="small" icon={<PlusOutlined />} onClick={(e) => { e.stopPropagation(); openCreate(g); }} />
              </Tooltip>
              <Tooltip title={t('admin.sys.groups.rename')}>
                <Button type="text" size="small" icon={<EditOutlined />} onClick={(e) => { e.stopPropagation(); openRename(g); }} />
              </Tooltip>
              <Tooltip title={t('admin.sys.groups.move')}>
                <Button type="text" size="small" icon={<SwapOutlined />} onClick={(e) => { e.stopPropagation(); openMove(g); }} />
              </Tooltip>
              <Popconfirm
                title={t('admin.sys.groups.confirm_delete')}
                okButtonProps={{ danger: true }}
                onConfirm={(e) => { e?.stopPropagation(); handleDelete(g); }}
                onCancel={(e) => e?.stopPropagation()}
              >
                <Tooltip title={t('admin.sys.groups.delete')}>
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} />
                </Tooltip>
              </Popconfirm>
            </Space>
          </span>
        )}
      </Space>
    );
  };

  const actColumns = [
    { title: t('admin.act.name'), dataIndex: 'name', ellipsis: true, render: (v, row) => <Link to={`/admin/activities/${row.activity_id}`}>{v}</Link> },
    { title: t('admin.act.status'), dataIndex: 'status', width: 110, render: (v) => <ActivityStatusTag status={v} /> },
    { title: t('admin.act.type'), dataIndex: 'activity_type', width: 90, render: (v) => t(`activityType.${v}`) },
    { title: t('admin.act.window'), key: 'window', width: 220, render: (_, row) => windowText(row.start_time, row.end_time) },
    { title: t('admin.act.created'), dataIndex: 'created_at', width: 150, render: (v) => formatTime(v) },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0, fontWeight: 600 }}>{t('admin.sys.groups.title')}</Title>
          <Text type="secondary">{t('admin.sys.groups.subtitle')}</Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate(null)}>
          {t('admin.sys.groups.new_root')}
        </Button>
      </div>

      <Row gutter={16}>
        <Col xs={24} md={9} xl={8}>
          <Card title={t('admin.sys.groups.title_col')} styles={{ body: { padding: 8 } }}>
            {isLoading ? (
              <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
            ) : treeData.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('admin.sys.groups.empty')}>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate(null)}>
                  {t('admin.sys.groups.new_root')}
                </Button>
              </Empty>
            ) : (
              <Tree
                treeData={treeData}
                blockNode
                defaultExpandAll
                titleRender={renderTitle}
                selectedKeys={selectedKey ? [selectedKey] : []}
                onSelect={(keys) => setSelectedKey(keys.length ? String(keys[0]) : null)}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} md={15} xl={16}>
          <Card
            title={
              <Space size={8}>
                <ArrowLeftOutlined style={{ color: '#999' }} />
                <span>{t('admin.sys.groups.activities_col')}</span>
                {selectedGroup && <Text type="secondary">{selectedGroup.name}</Text>}
              </Space>
            }
          >
            {!selectedGroup ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('admin.sys.groups.activities_empty')} />
            ) : (
              <>
                <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                  {t('admin.sys.groups.activities_count', { n: actData?.total ?? 0 })}
                </Text>
                <Table
                  rowKey="activity_id"
                  size="middle"
                  loading={actFetching}
                  columns={actColumns}
                  dataSource={activities}
                  pagination={false}
                  locale={{ emptyText: t('admin.sys.groups.activities_empty') }}
                />
              </>
            )}
          </Card>
        </Col>
      </Row>

      <Modal
        open={!!modal}
        title={modal?.mode === 'create'
          ? (modal.group ? t('admin.sys.groups.new_child') : t('admin.sys.groups.new_root'))
          : (modal?.mode === 'rename' ? t('admin.sys.groups.rename') : t('admin.sys.groups.move'))}
        width={480}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        onOk={handleOk}
        onCancel={() => setModal(null)}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          {modal?.mode !== 'move' ? (
            <>
              <Form.Item name="name" label={t('admin.sys.groups.name')} rules={[{ required: true, whitespace: true, message: t('admin.sys.groups.name_ph') }]}>
                <Input maxLength={50} placeholder={t('admin.sys.groups.name_ph')} autoFocus />
              </Form.Item>
              <Form.Item name="sort_order" label={t('admin.sys.groups.sort_order')} extra={t('admin.sys.groups.sort_order_hint')}>
                <InputNumber style={{ width: '100%' }} />
              </Form.Item>
            </>
          ) : (
            <Form.Item name="parent_id" label={t('admin.sys.groups.parent')}>
              {/* 树形下拉：disabled 节点为自身子树 */}
              <TreeSelect
                treeData={[{ title: t('admin.sys.groups.parent_root'), value: 0, children: moveOptions }]}
                treeDefaultExpandAll
                placeholder={t('admin.sys.groups.parent_root')}
              />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}
