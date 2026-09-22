import { MAX_FADE_SEC, resolveFade, type ChapterFade } from '../audio/fade';

interface FadePanelProps {
  /** segment length actually previewed (seconds) */
  segmentSec: number;
  fade: ChapterFade;
  onChange: (patch: Partial<ChapterFade>) => void;
}

/**
 * Preview-only fade in/out controls for the selected chapter. Changes never
 * touch chapter data or exports; they only reshape the audition gain curve.
 */
export function FadePanel({ segmentSec, fade, onChange }: FadePanelProps) {
  const resolved = fade.enabled ? resolveFade(segmentSec, fade.fadeInSec, fade.fadeOutSec) : null;

  return (
    <section className="silence-panel fade-panel">
      <h2>淡入淡出试听</h2>
      <label className="silence-toggle">
        <input
          type="checkbox"
          checked={fade.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
        />
        预览时启用淡入淡出（不影响章节数据与导出）
      </label>
      <label className="silence-field">
        <span>
          淡入时长 <b>{fade.fadeInSec.toFixed(1)} s</b>
        </span>
        <input
          type="range"
          min={0}
          max={MAX_FADE_SEC}
          step={0.1}
          value={fade.fadeInSec}
          disabled={!fade.enabled}
          onChange={(e) => onChange({ fadeInSec: Number(e.target.value) })}
        />
      </label>
      <label className="silence-field">
        <span>
          淡出时长 <b>{fade.fadeOutSec.toFixed(1)} s</b>
        </span>
        <input
          type="range"
          min={0}
          max={MAX_FADE_SEC}
          step={0.1}
          value={fade.fadeOutSec}
          disabled={!fade.enabled}
          onChange={(e) => onChange({ fadeOutSec: Number(e.target.value) })}
        />
      </label>
      <div className="silence-info">
        {resolved?.compressed
          ? `设定时长超过本章 ${segmentSec.toFixed(2)}s，已等比例压缩为淡入 ${resolved.fadeInSec.toFixed(
              2,
            )}s / 淡出 ${resolved.fadeOutSec.toFixed(2)}s`
          : '曲线仅覆盖本章播放区间，不会越过章界；暂停、拖动或改参数会立即重建。'}
      </div>
    </section>
  );
}
