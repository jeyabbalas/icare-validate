import type { SlotKind } from '../../lib/csvIngest';
import { useInputStore, type InputMode, type ModelFileKey } from '../../state/inputStore';
import { useBinSettingsStore } from '../../state/binSettingsStore';
import { FileDropSlot } from './FileDropSlot';
import { InputSummaryPanel } from './InputSummaryPanel';
import { ReferencePopulationPanel } from './ReferencePopulationPanel';
import { NumberField, NumericListField, RiskIntervalControl, TextField } from './fields';

// Layout tokens reused across the sub-panels.
const cardStyle: React.CSSProperties = {
  border: '1px solid var(--app-border)',
  borderRadius: 'var(--app-radius)',
  padding: 12,
  background: 'var(--app-surface)',
  marginBottom: 16,
};

const cardTitle: React.CSSProperties = { margin: '0 0 10px', fontSize: 14 };

interface ModelFileSpec {
  key: ModelFileKey;
  label: string;
  kind: SlotKind;
  accept: string;
  optional?: boolean;
  hint?: string;
}

const MODE_A_PRIMARY: ModelFileSpec[] = [
  {
    key: 'modelCovariateFormula',
    label: 'Covariate formula (Patsy)',
    kind: 'formula',
    accept: '.txt',
  },
  {
    key: 'modelLogRelativeRisk',
    label: 'Log relative risks (β)',
    kind: 'logOddsRatios',
    accept: '.json',
  },
  { key: 'modelReferenceDataset', label: 'Reference dataset', kind: 'reference', accept: '.csv' },
  { key: 'applyCovariateProfile', label: 'Covariate profile', kind: 'covariate', accept: '.csv' },
  {
    key: 'modelDiseaseIncidenceRates',
    label: 'Disease incidence rates',
    kind: 'rates',
    accept: '.csv',
    hint: 'CSV with columns: age, rate',
  },
  {
    key: 'modelCompetingIncidenceRates',
    label: 'Competing incidence rates (all-cause mortality)',
    kind: 'rates',
    accept: '.csv',
    optional: true,
    hint: 'CSV with columns: age, rate',
  },
];

const MODE_A_SNP: ModelFileSpec[] = [
  {
    key: 'modelSnpInfo',
    label: 'SNP info',
    kind: 'snpInfo',
    accept: '.csv',
    optional: true,
    hint: 'CSV with columns: snp_name, snp_odds_ratio, snp_freq',
  },
  {
    key: 'applySnpProfile',
    label: 'SNP profile',
    kind: 'covariate',
    accept: '.csv',
    optional: true,
  },
];

export function InputBuilder() {
  const mode = useInputStore((s) => s.mode);

  return (
    <div>
      <ExampleLoaderBar />
      <ModeToggle />
      <ConfigPanel />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(240px, 320px)',
          gap: 16,
          alignItems: 'start',
        }}
      >
        <div>{mode === 'A' ? <ModeAPanel /> : <ModeBPanel />}</div>
        <InputSummaryPanel />
      </div>
    </div>
  );
}

function ExampleLoaderBar() {
  const exampleId = useInputStore((s) => s.exampleId);
  const loading = useInputStore((s) => s.exampleLoading);
  const error = useInputStore((s) => s.exampleError);
  const loadExample = useInputStore((s) => s.loadExample);
  const reset = useInputStore((s) => s.reset);

  return (
    <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <button
        type="button"
        disabled={loading}
        onClick={() => void loadExample('icare-lit-ge50')}
        style={{
          border: '1px solid var(--app-border)',
          borderRadius: 'var(--app-radius)',
          background: 'var(--app-accent)',
          color: 'var(--app-accent-fg)',
          padding: '8px 12px',
          fontWeight: 600,
        }}
      >
        {loading ? 'Loading example…' : 'Load iCARE-Lit (ge50) example'}
      </button>
      {exampleId && (
        <span style={{ fontSize: 12, color: 'var(--app-muted)' }}>
          Loaded example: <strong style={{ color: 'var(--app-fg)' }}>{exampleId}</strong>
        </span>
      )}
      <button
        type="button"
        onClick={() => reset()}
        style={{
          border: '1px solid var(--app-border)',
          borderRadius: 'var(--app-radius)',
          background: 'var(--app-surface-2)',
          color: 'var(--app-fg)',
          padding: '8px 12px',
        }}
      >
        Reset
      </button>
      {error && <span style={{ fontSize: 12, color: 'var(--app-danger)' }}>⚠ {error}</span>}
    </div>
  );
}

function ModeToggle() {
  const mode = useInputStore((s) => s.mode);
  const setMode = useInputStore((s) => s.setMode);
  const option = (m: InputMode, title: string, sub: string) => {
    const active = mode === m;
    return (
      <button
        type="button"
        onClick={() => setMode(m)}
        aria-pressed={active}
        style={{
          flex: 1,
          textAlign: 'left',
          border: `1px solid ${active ? 'var(--app-accent)' : 'var(--app-border)'}`,
          borderRadius: 'var(--app-radius)',
          background: active ? 'var(--app-surface-2)' : 'var(--app-surface)',
          padding: '10px 12px',
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 13 }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--app-muted)' }}>{sub}</div>
      </button>
    );
  };
  return (
    <div style={{ ...cardStyle }}>
      <h3 style={cardTitle}>Validation mode</h3>
      <div style={{ display: 'flex', gap: 12 }}>
        {option('A', 'A · Build model from parameters', 'Provide formula, β, rates, reference')}
        {option(
          'B',
          'B · Pre-computed risks',
          'Study data already has risk / linear-predictor columns',
        )}
      </div>
    </div>
  );
}

function ConfigPanel() {
  const riskInterval = useInputStore((s) => s.riskInterval);
  const datasetName = useInputStore((s) => s.datasetName);
  const modelName = useInputStore((s) => s.modelName);
  const linearPredictorCutoffs = useInputStore((s) => s.linearPredictorCutoffs);
  const setConfig = useInputStore((s) => s.setConfig);

  const numberOfPercentiles = useBinSettingsStore((s) => s.numberOfPercentiles);
  const seed = useBinSettingsStore((s) => s.seed);
  const setBin = useBinSettingsStore((s) => s.set);

  return (
    <div style={cardStyle}>
      <h3 style={cardTitle}>Configuration</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
        <RiskIntervalControl
          value={riskInterval}
          onChange={(v) => setConfig({ riskInterval: v })}
        />
        <div>
          <TextField
            label="Dataset name"
            value={datasetName}
            onChange={(v) => setConfig({ datasetName: v })}
            placeholder="e.g. My cohort"
          />
          <TextField
            label="Model name"
            value={modelName}
            onChange={(v) => setConfig({ modelName: v })}
            placeholder="e.g. My risk model"
          />
          <div style={{ display: 'flex', gap: 12 }}>
            <NumberField
              label="Percentiles (bins)"
              value={numberOfPercentiles}
              min={2}
              step={1}
              onChange={(v) => setBin({ numberOfPercentiles: v })}
            />
            <NumberField label="Seed" value={seed} step={1} onChange={(v) => setBin({ seed: v })} />
          </div>
          <NumericListField
            label="Linear-predictor cutoffs"
            values={linearPredictorCutoffs}
            onChange={(v) => setConfig({ linearPredictorCutoffs: v })}
            placeholder="e.g. -1.5, 0, 1.5"
            hint="Optional: fixed cutoffs for category-specific calibration bins (overrides percentiles)."
          />
        </div>
      </div>
    </div>
  );
}

function StudySlot() {
  const study = useInputStore((s) => s.study);
  const setStudy = useInputStore((s) => s.setStudy);
  return (
    <FileDropSlot
      label="Study data"
      slot={study}
      kind="study"
      accept=".csv,.tsv"
      onChange={setStudy}
      hint="Cohort or nested case-control outcomes (observed_outcome, study_entry_age, study_exit_age, …)"
    />
  );
}

function ModelFileSlots({ specs }: { specs: ModelFileSpec[] }) {
  const modelFiles = useInputStore((s) => s.modelFiles);
  const setModelFile = useInputStore((s) => s.setModelFile);
  return (
    <>
      {specs.map((spec) => (
        <FileDropSlot
          key={spec.key}
          label={spec.label}
          slot={modelFiles[spec.key]}
          kind={spec.kind}
          accept={spec.accept}
          optional={spec.optional}
          hint={spec.hint}
          onChange={(slot) => setModelFile(spec.key, slot)}
        />
      ))}
    </>
  );
}

function ModeAPanel() {
  const weightsVar = useInputStore((s) => s.modelReferenceDatasetWeightsVariableName);
  const familyVar = useInputStore((s) => s.modelFamilyHistoryVariableName);
  const numImputations = useInputStore((s) => s.numImputations);
  const setConfig = useInputStore((s) => s.setConfig);

  return (
    <div style={cardStyle}>
      <h3 style={cardTitle}>Model inputs</h3>
      <StudySlot />
      <ModelFileSlots specs={MODE_A_PRIMARY} />

      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
          Advanced: SNPs, family history, reference weights
        </summary>
        <div style={{ marginTop: 10 }}>
          <ModelFileSlots specs={MODE_A_SNP} />
          <TextField
            label="Family history variable name"
            value={familyVar}
            onChange={(v) => setConfig({ modelFamilyHistoryVariableName: v })}
            hint="Column in the covariate profile used as family history (SNP models)."
          />
          <TextField
            label="Reference dataset weights variable name"
            value={weightsVar}
            onChange={(v) => setConfig({ modelReferenceDatasetWeightsVariableName: v })}
            hint="Column of sampling weights in the reference dataset, if any."
          />
          <NumberField
            label="Number of imputations"
            value={numImputations ?? NaN}
            min={1}
            step={1}
            onChange={(v) => setConfig({ numImputations: v > 0 ? v : null })}
            hint="SNP models only: how many times to impute missing SNP genotypes."
          />
        </div>
      </details>

      <ReferencePopulationPanel />
    </div>
  );
}

function ModeBPanel() {
  const predictedRisk = useInputStore((s) => s.predictedRiskVariableName);
  const linearPredictor = useInputStore((s) => s.linearPredictorVariableName);
  const diseaseRates = useInputStore((s) => s.modelFiles.modelDiseaseIncidenceRates);
  const setConfig = useInputStore((s) => s.setConfig);
  const setModelFile = useInputStore((s) => s.setModelFile);

  return (
    <div style={cardStyle}>
      <h3 style={cardTitle}>Pre-computed risks</h3>
      <StudySlot />
      <p style={{ fontSize: 12, color: 'var(--app-muted)', marginTop: 0 }}>
        Your study data must contain <strong>both</strong> a predicted-risk column and a
        linear-predictor column — the linear predictor drives risk-score ranking and category
        calibration, so both are required.
      </p>
      <TextField
        label="Predicted-risk column"
        value={predictedRisk}
        onChange={(v) => setConfig({ predictedRiskVariableName: v })}
        placeholder="e.g. predicted_risk"
      />
      <TextField
        label="Linear-predictor column"
        value={linearPredictor}
        onChange={(v) => setConfig({ linearPredictorVariableName: v })}
        placeholder="e.g. linear_predictor"
      />

      <FileDropSlot
        label="Disease incidence rates (population)"
        slot={diseaseRates}
        kind="rates"
        accept=".csv"
        optional
        hint="Optional age, rate CSV — adds the cohort-vs-population incidence comparison to the results."
        onChange={(slot) => setModelFile('modelDiseaseIncidenceRates', slot)}
      />

      <ReferencePopulationPanel />
    </div>
  );
}
