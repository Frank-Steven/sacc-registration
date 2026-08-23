import { useEffect, useRef, useState } from 'react';
import { Spin } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { t, useI18n } from '../utils/i18n/index.js';

// 移动端下拉刷新（M9）：触屏手势下拉，内容区随手指下移并显示指示条，
// 超过阈值松手触发 onRefresh（返回 Promise 则等待完成）。
// 使用约束：外层滚动容器须带 data-mob-scroll 属性（组件沿 DOM 向上查找）。
const THRESHOLD = 60;   // 触发刷新所需下拉距离 px
const MAX_DIST = 90;    // 最大下拉距离 px
const DAMP = 0.45;      // 阻尼系数（手指距离 → 位移）
const MIN_REFRESH_MS = 600; // 刷新完成后的最小展示时长：即使请求秒回也保持「刷新中」氛围再回弹

export default function PullToRefresh({ onRefresh, children }) {
  useI18n();
  const wrapRef = useRef(null);
  const startY = useRef(0);
  const pulling = useRef(false);
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const updatePull = (v) => {
    pullRef.current = v;
    setPull(v);
  };

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;
    const scroller = wrap.closest('[data-mob-scroll]') || wrap.parentElement;

    const onStart = (e) => {
      if (refreshingRef.current || scroller.scrollTop > 0) return;
      startY.current = e.touches[0].clientY;
      pulling.current = true;
    };
    const onMove = (e) => {
      if (!pulling.current || refreshingRef.current) return;
      if (scroller.scrollTop > 0) {
        pulling.current = false;
        return;
      }
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0) {
        pulling.current = false;
        updatePull(0);
        return;
      }
      // passive:false 下阻止原生回弹滚动，避免与下拉手势冲突
      e.preventDefault();
      updatePull(Math.min(dy * DAMP, MAX_DIST));
    };
    const onEnd = async () => {
      if (!pulling.current) return;
      pulling.current = false;
      if (pullRef.current >= THRESHOLD) {
        const startedAt = Date.now();
        refreshingRef.current = true;
        setRefreshing(true);
        try {
          await onRefreshRef.current?.();
        } finally {
          // 延时回弹：刷新完成后至少展示 MIN_REFRESH_MS 再收起指示条，营造刷新氛围
          const remain = MIN_REFRESH_MS - (Date.now() - startedAt);
          if (remain > 0) await new Promise((resolve) => setTimeout(resolve, remain));
          refreshingRef.current = false;
          setRefreshing(false);
          updatePull(0);
        }
      } else {
        updatePull(0);
      }
    };
    const opts = { passive: false };
    scroller.addEventListener('touchstart', onStart, opts);
    scroller.addEventListener('touchmove', onMove, opts);
    scroller.addEventListener('touchend', onEnd);
    scroller.addEventListener('touchcancel', onEnd);
    return () => {
      scroller.removeEventListener('touchstart', onStart);
      scroller.removeEventListener('touchmove', onMove);
      scroller.removeEventListener('touchend', onEnd);
      scroller.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  const indicator = refreshing ? t('pull.refreshing') : pull >= THRESHOLD ? t('pull.release') : t('pull.pull');

  return (
    <div ref={wrapRef}>
      <div
        style={{
          height: refreshing ? 40 : pull,
          overflow: 'hidden',
          // 收起/回弹时平滑过渡；拖动中跟随手指不做过渡
          transition: refreshing || pull === 0 ? 'height 0.35s cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
        }}
      >
        <div
          style={{
            height: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            color: 'rgba(0,0,0,0.45)',
            fontSize: 13,
          }}
        >
          {refreshing ? (
            <Spin size="small" />
          ) : (
            <DownOutlined style={{ transform: pull >= THRESHOLD ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          )}
          <span>{indicator}</span>
        </div>
      </div>
      {children}
    </div>
  );
}
