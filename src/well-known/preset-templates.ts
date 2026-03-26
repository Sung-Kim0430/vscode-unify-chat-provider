import { t } from '../i18n';
import type { PresetTemplate, ThinkingEffort } from '../types';

const REASONING_EFFORT_ORDER: readonly ThinkingEffort[] = [
  'xhigh',
  'high',
  'medium',
  'low',
  'minimal',
  'none',
];

const REASONING_EFFORT_PRESET_METADATA = {
  xhigh: {
    name: t('Extra High'),
    description: t(
      'Only when your evals show a clear benefit that justifies the extra latency and cost.',
    ),
  },
  high: {
    name: t('High'),
    description: t(
      'The task involves planning, coding, synthesis, or harder reasoning.',
    ),
  },
  medium: {
    name: t('Medium'),
    description: t('Balance thinking with speed.'),
  },
  low: {
    name: t('Low'),
    description: t(
      'A small amount of extra thinking can improve reliability without adding much latency.',
    ),
  },
  minimal: {
    name: t('Minimal'),
    description: t(
      'You want the lowest latency for execution-heavy tasks such as extraction, routing, or simple transforms.',
    ),
  },
  none: {
    name: t('None'),
    description: t(
      'Tasks that require an extremely fast response without even thinking about it.',
    ),
  },
} satisfies Record<ThinkingEffort, { name: string; description: string }>;

export interface ReasoningEffortTemplateOptions {
  default?: ThinkingEffort;
  supported?: readonly ThinkingEffort[];
}

function isReasoningEffortTemplateOptions(
  input: readonly ThinkingEffort[] | ReasoningEffortTemplateOptions | undefined,
): input is ReasoningEffortTemplateOptions {
  return input !== undefined && !Array.isArray(input);
}

function normalizeReasoningEffortTemplateOptions(
  input?: readonly ThinkingEffort[] | ReasoningEffortTemplateOptions,
): ReasoningEffortTemplateOptions | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (isReasoningEffortTemplateOptions(input)) {
    return input;
  }
  return { supported: input };
}

export function reasoningEffort(
  supported?: readonly ThinkingEffort[],
): PresetTemplate;
export function reasoningEffort(
  opts?: ReasoningEffortTemplateOptions,
): PresetTemplate;
export function reasoningEffort(
  input?: readonly ThinkingEffort[] | ReasoningEffortTemplateOptions,
): PresetTemplate {
  const resolvedOptions = normalizeReasoningEffortTemplateOptions(input);
  const supportedEfforts =
    resolvedOptions?.supported && resolvedOptions.supported.length > 0
      ? REASONING_EFFORT_ORDER.filter((effort) =>
          resolvedOptions.supported?.includes(effort),
        )
      : REASONING_EFFORT_ORDER;
  const presets = supportedEfforts.map(
    (effort): PresetTemplate['presets'][number] => ({
      ...REASONING_EFFORT_PRESET_METADATA[effort],
      id: effort,
      config: {
        thinking: {
          type: 'enabled',
          effort,
        },
      },
    }),
  );
  const defaultPreset =
    resolvedOptions?.default && supportedEfforts.includes(resolvedOptions.default)
      ? resolvedOptions.default
      : presets[0]?.id ?? 'xhigh';

  return {
    name: t('Reasoning Effort'),
    id: 'reasoningEffort',
    presets,
    default: defaultPreset,
  };
}
