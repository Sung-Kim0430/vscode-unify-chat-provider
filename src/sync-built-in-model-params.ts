import * as vscode from 'vscode';
import {
  BUILT_IN_SYNC_MODEL_CONFIG_KEYS,
  deepClone,
  stableStringify,
  toComparableModelConfig,
} from './config-ops';
import { ConfigStore } from './config-store';
import { t } from './i18n';
import type { ModelConfig, ProviderConfig } from './types';
import {
  findBestMatchingWellKnownModel,
  normalizeWellKnownConfigs,
} from './well-known/models';

type SyncFieldKey = (typeof BUILT_IN_SYNC_MODEL_CONFIG_KEYS)[number];

type SyncCandidate = {
  key: string;
  providerIndex: number;
  modelIndex: number;
  providerName: string;
  model: ModelConfig;
  builtin: ModelConfig;
  diffFields: SyncFieldKey[];
};

type SkippedCandidate = {
  providerName: string;
  model: ModelConfig;
};

type SyncQuickPickItem = vscode.QuickPickItem & {
  syncKey?: string;
};

export async function syncBuiltInParamsToAllConfigs(
  configStore: ConfigStore,
): Promise<void> {
  const endpoints = deepClone(configStore.endpoints);
  const selectable: SyncCandidate[] = [];
  const unmatched: SkippedCandidate[] = [];
  const alreadySynced: SkippedCandidate[] = [];

  for (const [providerIndex, provider] of endpoints.entries()) {
    for (const [modelIndex, model] of provider.models.entries()) {
      const builtin = resolveBuiltinModel(provider, model);
      if (!builtin) {
        unmatched.push({ providerName: provider.name, model });
        continue;
      }

      const diffFields = getDifferingFields(model, builtin);
      if (diffFields.length === 0) {
        alreadySynced.push({ providerName: provider.name, model });
        continue;
      }

      selectable.push({
        key: `${providerIndex}:${modelIndex}`,
        providerIndex,
        modelIndex,
        providerName: provider.name,
        model,
        builtin,
        diffFields,
      });
    }
  }

  if (selectable.length === 0) {
    const skippedCount = unmatched.length + alreadySynced.length;
    vscode.window.showInformationMessage(
      skippedCount > 0
        ? t(
            'No local models are eligible for built-in parameter sync. Skipped {0} model(s).',
            skippedCount,
          )
        : t('No local models are available for built-in parameter sync.'),
    );
    return;
  }

  const selectedKeys = await promptForSyncSelection({
    selectable,
    unmatched,
    alreadySynced,
  });
  if (!selectedKeys || selectedKeys.size === 0) {
    return;
  }

  let updatedCount = 0;
  for (const candidate of selectable) {
    if (!selectedKeys.has(candidate.key)) {
      continue;
    }

    const targetModel =
      endpoints[candidate.providerIndex]?.models[candidate.modelIndex];
    if (!targetModel) {
      continue;
    }

    applyBuiltinFields(targetModel, candidate.builtin);
    updatedCount++;
  }

  if (updatedCount === 0) {
    return;
  }

  await configStore.setEndpoints(endpoints);

  const skippedCount =
    selectable.length - updatedCount + unmatched.length + alreadySynced.length;
  vscode.window.showInformationMessage(
    t(
      'Synced built-in parameters for {0} model(s). Skipped {1} model(s).',
      updatedCount,
      skippedCount,
    ),
  );
}

function resolveBuiltinModel(
  provider: ProviderConfig,
  model: ModelConfig,
): ModelConfig | undefined {
  const matched = findBestMatchingWellKnownModel(model.id);
  if (!matched) {
    return undefined;
  }

  const [normalized] = normalizeWellKnownConfigs([matched], undefined, provider);
  return normalized;
}

function getDifferingFields(
  model: ModelConfig,
  builtin: ModelConfig,
): SyncFieldKey[] {
  const comparableModel = toComparableModelConfig(model);
  const comparableBuiltin = toComparableModelConfig(builtin);

  return BUILT_IN_SYNC_MODEL_CONFIG_KEYS.filter(
    (field) =>
      stableStringify(comparableModel[field]) !==
      stableStringify(comparableBuiltin[field]),
  );
}

function applyBuiltinFields(target: ModelConfig, builtin: ModelConfig): void {
  for (const field of BUILT_IN_SYNC_MODEL_CONFIG_KEYS) {
    const value = builtin[field];
    if (value === undefined) {
      delete target[field];
      continue;
    }
    assignBuiltInFieldValue(target, field, value);
  }
}

async function promptForSyncSelection(options: {
  selectable: SyncCandidate[];
  unmatched: SkippedCandidate[];
  alreadySynced: SkippedCandidate[];
}): Promise<Set<string> | undefined> {
  return new Promise<Set<string> | undefined>((resolve) => {
    const qp = vscode.window.createQuickPick<SyncQuickPickItem>();
    qp.title = t('Sync Built-in Parameters to All Configs');
    qp.placeholder = t('Select local models to sync built-in parameters');
    qp.matchOnDescription = true;
    qp.matchOnDetail = true;
    qp.canSelectMany = true;
    qp.ignoreFocusOut = true;
    qp.items = buildQuickPickItems(options);
    qp.selectedItems = qp.items.filter((item) => item.syncKey);

    let resolved = false;
    const finish = (value: Set<string> | undefined) => {
      if (resolved) {
        return;
      }
      resolved = true;
      resolve(value);
    };

    qp.onDidAccept(() => {
      const selectedItems = qp.selectedItems.filter(
        (item): item is SyncQuickPickItem & { syncKey: string } =>
          typeof item.syncKey === 'string',
      );
      if (selectedItems.length === 0) {
        vscode.window.showWarningMessage(t('Select at least one model to sync.'));
        return;
      }

      finish(new Set(selectedItems.map((item) => item.syncKey)));
      qp.hide();
    });

    qp.onDidHide(() => {
      qp.dispose();
      finish(undefined);
    });

    qp.show();
  });
}

function buildQuickPickItems(options: {
  selectable: SyncCandidate[];
  unmatched: SkippedCandidate[];
  alreadySynced: SkippedCandidate[];
}): SyncQuickPickItem[] {
  const items: SyncQuickPickItem[] = [];

  items.push({
    label: '',
    kind: vscode.QuickPickItemKind.Separator,
    description: t('Eligible Models'),
  });
  pushGroupedSelectableItems(items, options.selectable);

  if (options.unmatched.length > 0) {
    items.push({
      label: '',
      kind: vscode.QuickPickItemKind.Separator,
      description: t('Skipped: No Built-in Match'),
    });
    pushGroupedSkippedItems(items, options.unmatched);
  }

  if (options.alreadySynced.length > 0) {
    items.push({
      label: '',
      kind: vscode.QuickPickItemKind.Separator,
      description: t('Skipped: Already Up to Date'),
    });
    pushGroupedSkippedItems(items, options.alreadySynced);
  }

  return items;
}

function pushGroupedSelectableItems(
  items: SyncQuickPickItem[],
  selectable: readonly SyncCandidate[],
): void {
  let currentProviderName: string | undefined;

  for (const candidate of selectable) {
    if (candidate.providerName !== currentProviderName) {
      currentProviderName = candidate.providerName;
      items.push({
        label: '',
        kind: vscode.QuickPickItemKind.Separator,
        description: currentProviderName,
      });
    }

    items.push({
      label: candidate.model.name ?? candidate.model.id,
      description: candidate.model.id,
      detail: formatDiffDetail(candidate),
      syncKey: candidate.key,
      picked: true,
    });
  }
}

function pushGroupedSkippedItems(
  items: SyncQuickPickItem[],
  skipped: readonly SkippedCandidate[],
): void {
  let currentProviderName: string | undefined;

  for (const candidate of skipped) {
    if (candidate.providerName !== currentProviderName) {
      currentProviderName = candidate.providerName;
      items.push({
        label: '',
        kind: vscode.QuickPickItemKind.Separator,
        description: currentProviderName,
      });
    }

    items.push({
      label: `$(info) ${candidate.model.name ?? candidate.model.id}`,
      description: candidate.model.id,
    });
  }
}

function formatDiffDetail(candidate: SyncCandidate): string {
  return candidate.diffFields
    .map(
      (field) =>
        `${field}: ${formatFieldValue(field, candidate.model[field])} -> ${formatFieldValue(field, candidate.builtin[field])}`,
    )
    .join(' | ');
}

function formatFieldValue(
  field: SyncFieldKey,
  value: ModelConfig[SyncFieldKey],
): string {
  if (field === 'presetTemplates') {
    return Array.isArray(value) ? String(value.length) : '0';
  }

  if (value === undefined) {
    return t('unset');
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }

  return stableStringify(value);
}

function assignBuiltInFieldValue<K extends SyncFieldKey>(
  target: ModelConfig,
  field: K,
  value: ModelConfig[K],
): void {
  target[field] = structuredClone(value);
}
