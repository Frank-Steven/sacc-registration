-- 0002_seed_roles.sql — 种子数据：三角色（幂等）
-- 与 config.md 1.1 角色表对应；user_role 授权依赖 role 行存在
INSERT OR IGNORE INTO role (role_id, name, description) VALUES
  (1, '超级管理员', '全范围管理：分组/角色授权/系统配置/审计'),
  (2, '活动管理员', '分组范围内活动/表单/字段/模板/活动配置'),
  (3, '审核员',     '分组范围内活动只读与审核');
