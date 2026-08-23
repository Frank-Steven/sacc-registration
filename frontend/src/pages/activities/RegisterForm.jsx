import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { App, Button, Card, Form, Grid, Space, Spin, Steps, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { activityApi, authApi, registrationApi, userApi } from '../../api/index.js';
import { useAuthStore } from '../../stores/auth.js';
import { useRegistrationStore } from '../../stores/registration.js';
import FormBuilder from '../../components/FormBuilder.jsx';
import ReceiptModal from '../../components/ReceiptModal.jsx';
import { t, useI18n } from '../../utils/i18n/index.js';

const { Title, Text } = Typography;

// 每个步骤独立一个 antd Form 实例（隐藏非当前步骤，值保留）
function StepForm({ index, fields, initialValues, disabled, onChange, onReady }) {
  const [form] = Form.useForm();
  useEffect(() => {
    onReady(index, form);
  }, [index, form, onReady]);
  return (
    <FormBuilder form={form} fields={fields} initialValues={initialValues} disabled={disabled} onValuesChange={onChange} />
  );
}

// 分步报名表单（需登录）：创建草稿 → 预填（资料/常用信息/本地草稿恢复）→ 分步填写 → 提交
export default function RegisterForm() {
  useI18n();
  const { id } = useParams();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const userName = useAuthStore((s) => s.user?.name);
  const screens = Grid.useBreakpoint();
  // md 以下为移动端：底部固定「上一步 / 下一步 / 提交」操作条（responsive-design.md 专项 1）
  const isMobile = screens.md === false;

  const [rid, setRid] = useState(null);
  const [current, setCurrent] = useState(0);
  const [ready, setReady] = useState(false);
  const [initialValues, setInitialValues] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  const formsRef = useRef([]);
  const saveTimer = useRef(null);
  const creatingRef = useRef(false);
  const draftPrompted = useRef(false);
  const currentRef = useRef(0);
  currentRef.current = current;

  const { data: activity, isLoading, error } = useQuery({
    queryKey: ['activity', id],
    queryFn: () => activityApi.publicDetail(id),
    staleTime: 5 * 60 * 1000,
  });

  const forms = useMemo(
    () => [...(activity?.forms || [])].sort((a, b) => a.sort_order - b.sort_order),
    [activity]
  );
  const stepsFields = useMemo(
    () => forms.map((f) => [...(f.fields || [])].sort((a, b) => a.sort_order - b.sort_order)),
    [forms]
  );
  const allFields = useMemo(() => stepsFields.flat(), [stepsFields]);

  // 1) 进入流程：创建报名草稿（409 已报名 → 提示并跳我的报名）
  useEffect(() => {
    if (!activity || creatingRef.current) return;
    creatingRef.current = true;
    activityApi
      .createRegistration(id)
      .then((res) => setRid(res.registration_id))
      .catch((e) => {
        message.error(e.message);
        navigate('/my-registrations', { replace: true });
      });
  }, [activity, id, message, navigate]);

  // 2) 预填：资料 + 常用信息（按 field_key 匹配）+ 本地草稿恢复
  useEffect(() => {
    if (!activity || !rid) return;
    const st = useRegistrationStore.getState();
    const loadPrefill = async () => {
      const prefill = {};
      try {
        const [me, common] = await Promise.all([authApi.me(), userApi.commonInfoList()]);
        Object.assign(prefill, me || {});
        (common?.items || []).forEach((it) => {
          prefill[it.field_key] = it.field_value;
        });
      } catch (e) {
        if (e.code !== 401) message.error(e.message);
        // 预填失败不阻塞报名
      }

      const applyValues = (withDraft, startStep) => {
        const values = {};
        allFields.forEach((f) => {
          let val;
          if (withDraft && st.formValues?.[f.field_key] !== undefined && st.formValues[f.field_key] !== '') {
            val = st.formValues[f.field_key];
          } else if (prefill[f.field_key] !== undefined && prefill[f.field_key] !== '') {
            val = prefill[f.field_key];
          } else if (f.default_value !== undefined && f.default_value !== null && f.default_value !== '') {
            val = f.default_value;
          }
          if (val === undefined || val === null || val === '') return;
          if (f.field_type === 4) {
            const d = typeof val === 'number' ? dayjs.unix(val) : dayjs(val);
            if (!d.isValid()) return;
            val = d;
          }
          values[f.field_id] = val;
        });
        setInitialValues(values);
        if (startStep !== undefined && forms.length) {
          setCurrent(Math.max(0, Math.min(startStep, forms.length - 1)));
        }
        setReady(true);
      };

      const hasDraft = st.activityId === String(id) && Object.keys(st.formValues || {}).length > 0;
      if (hasDraft && !draftPrompted.current) {
        draftPrompted.current = true;
        modal.confirm({
          title: t('form.resume_draft_title'),
          content: t('form.resume_draft_content'),
          okText: t('common.continue_fill'),
          cancelText: t('form.restart_fill'),
          onOk: () => applyValues(true, st.currentStep),
          onCancel: () => applyValues(false, 0),
        });
      } else {
        applyValues(false, 0);
      }
    };
    loadPrefill();
  }, [activity, rid, allFields, forms.length, message, modal]);

  // 卸载时清理自动保存定时器
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  // 汇总所有步骤表单的值（日期转 'YYYY-MM-DD' 字符串）
  const collectValues = () => {
    const values = {};
    stepsFields.forEach((fields, i) => {
      const form = formsRef.current[i];
      if (!form) return;
      const fv = form.getFieldsValue();
      fields.forEach((f) => {
        let val = fv[f.field_id];
        if (val === undefined || val === null || val === '') return;
        if (f.field_type === 4 && dayjs.isDayjs(val)) val = val.format('YYYY-MM-DD');
        values[f.field_id] = val;
      });
    });
    return values;
  };

  // 草稿自动保存：防抖 2s，后端保存失败静默（401 由拦截器处理），同时本地持久化
  const scheduleAutosave = (values) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (!rid) return;
      const fields = Object.entries(values).map(([fid, value]) => ({ field_id: Number(fid), value }));
      registrationApi
        .save(rid, { fields, current_step: currentRef.current })
        .then(() => {
          const keyMap = {};
          allFields.forEach((f) => {
            keyMap[f.field_id] = f.field_key;
          });
          const kv = {};
          Object.entries(values).forEach(([fid, v]) => {
            const k = keyMap[Number(fid)];
            if (k) kv[k] = v;
          });
          useRegistrationStore.getState().saveDraft({
            activityId: String(id),
            registrationId: rid,
            formValues: kv,
            currentStep: currentRef.current,
          });
        })
        .catch(() => {
          /* 自动保存失败静默 */
        });
    }, 2000);
  };

  const handleChange = () => {
    scheduleAutosave(collectValues());
  };

  const handleReady = (i, form) => {
    formsRef.current[i] = form;
  };

  const handleNext = async () => {
    const form = formsRef.current[current];
    if (!form) return;
    try {
      await form.validateFields();
      setCurrent((c) => c + 1);
    } catch {
      /* 校验失败，antd 已就地提示 */
    }
  };

  const handleSubmit = async () => {
    if (submitting || !rid) return;
    setSubmitting(true);
    try {
      for (const form of formsRef.current) {
        if (form) await form.validateFields();
      }
      const values = collectValues();
      const fields = Object.entries(values).map(([fid, value]) => ({ field_id: Number(fid), value }));
      await registrationApi.save(rid, { fields, current_step: forms.length });
      const res = await registrationApi.submit(rid);
      useRegistrationStore.getState().clearDraft();
      const { status, queue_no } = res;
      if (status === 2) {
        setReceipt({ ...res, activity_name: activity?.name, name: userName });
        setReceiptOpen(true);
      } else if (status === 1) {
        message.success(t('form.submitted_pending'));
        navigate('/my-registrations', { replace: true });
      } else if (status === 5) {
        message.success(queue_no ? t('form.waitlist', { n: queue_no }) : t('form.waitlist_queue'));
        navigate('/my-registrations', { replace: true });
      } else {
        message.success(t('form.submitted'));
        navigate('/my-registrations', { replace: true });
      }
    } catch (e) {
      message.error(e.message);
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 64 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error || !activity) {
    return (
      <Card>
        <Text type="danger">{error?.message || t('activity.not_found')}</Text>
      </Card>
    );
  }

  if (!ready || !rid) {
    return (
      <div style={{ textAlign: 'center', padding: 64 }}>
        <Spin size="large" />
        <div style={{ marginTop: 12 }}>
          <Text type="secondary">{t('form.creating')}</Text>
        </div>
      </div>
    );
  }

  if (!forms.length) {
    return (
      <Card>
        <Title level={4}>{t('form.no_form')}</Title>
        <Text type="secondary">{t('form.no_form_hint')}</Text>
        <div style={{ marginTop: 16 }}>
          <Link to={`/activities/${id}`}>
            <Button>{t('form.back_detail')}</Button>
          </Link>
        </div>
      </Card>
    );
  }

  // 分步操作按钮（桌面行内 / 移动端底部固定条共用）
  const stepButtons = (
    <>
      {current > 0 && <Button onClick={() => setCurrent(current - 1)}>{t('form.prev')}</Button>}
      {current < forms.length - 1 && (
        <Button type="primary" onClick={handleNext}>{t('form.next')}</Button>
      )}
      {current === forms.length - 1 && (
        <Button type="primary" loading={submitting} onClick={handleSubmit}>{t('common.submit')}</Button>
      )}
    </>
  );

  return (
    <div style={{ paddingBottom: isMobile ? 'calc(72px + env(safe-area-inset-bottom))' : 0 }}>
      <Card>
        <div style={{ marginBottom: 16 }}>
          <Link to={`/activities/${id}`}>← {t('form.back_detail')}</Link>
        </div>
        <Title level={4} style={{ marginTop: 0 }}>{activity.name}</Title>
        <Steps
          current={current}
          items={forms.map((f, i) => ({
            title: `${t('form.step', { n: i + 1 })} ${f.name}`,
            description: f.is_required ? t('common.required') : t('common.optional'),
          }))}
          style={{ marginBottom: 32 }}
        />

        {forms.map((f, i) => (
          <div key={f.form_id} style={{ display: current === i ? 'block' : 'none' }}>
            <StepForm
              index={i}
              fields={stepsFields[i]}
              initialValues={initialValues}
              onChange={handleChange}
              onReady={handleReady}
            />
          </div>
        ))}

        {!isMobile && (
          <div style={{ marginTop: 24, textAlign: 'right' }}>
            <Space>{stepButtons}</Space>
          </div>
        )}

        <ReceiptModal
          open={receiptOpen}
          onClose={() => {
            setReceiptOpen(false);
            navigate('/my-registrations', { replace: true });
          }}
          registration={receipt}
        />
      </Card>

      {/* 移动端：底部固定操作条（防误触 + 安全区） */}
      {isMobile && (
        <div
          className="mob-safe-bottom"
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 1000,
            display: 'flex',
            gap: 12,
            padding: '10px 16px',
            background: 'var(--app-bg)',
            borderTop: '1px solid rgba(128,128,128,0.2)',
            backdropFilter: 'blur(4px)',
          }}
        >
          {current > 0 && (
            <Button block onClick={() => setCurrent(current - 1)} style={{ minHeight: 44 }}>
              {t('form.prev')}
            </Button>
          )}
          {current < forms.length - 1 && (
            <Button block type="primary" onClick={handleNext} style={{ minHeight: 44 }}>
              {t('form.next')}
            </Button>
          )}
          {current === forms.length - 1 && (
            <Button block type="primary" loading={submitting} onClick={handleSubmit} style={{ minHeight: 44 }}>
              {t('common.submit')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
