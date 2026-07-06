import { useMemo, useState } from 'react';
import type { SlotKind } from '../../lib/csvIngest';
import { EXAMPLE_IDS, EXAMPLE_LABELS } from '../../lib/examples';
import { useInputStore, type InputMode, type ModelFileKey } from '../../state/inputStore';
import { useBinSettingsStore } from '../../state/binSettingsStore';
import { useResultsStore } from '../../state/resultsStore';
import { DataPreviewSection } from './DataPreviewSection';
import { FileDropSlot } from './FileDropSlot';
import { InputSummaryPanel } from './InputSummaryPanel';
import { ModelEquationSection } from './ModelEquationSection';
import { RatesChartSection } from './RatesChartSection';
import { ReferencePopulationPanel } from './ReferencePopulationPanel';
import { RunActionBar } from './RunActionBar';
import { NumberField, NumericListField, RiskIntervalControl, TextField } from './fields';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import type { RateUnits } from '../../viz/chartChrome';

// Every sub-panel is a <Card> (the shared surface primitive) carrying the input step's 16px bottom gap;
// its title is a plain 14px heading (distinct from the results panels' uppercase Section titles).
const cardGap: React.CSSProperties = { marginBottom: 16 };
const cardTitle: React.CSSProperties = { margin: '0 0 10px', fontSize: 14 };

// Validated categorical hues (dataviz reference palette) for the two incidence charts — a
// colorblind-safe blue/orange pair, each stepped for its theme's surface.
const DISEASE_COLOR = { light: '#2a78d6', dark: '#3987e5' };
const MORTALITY_COLOR = { light: '#eb6834', dark: '#d95926' };

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
    hint: 'CSV: age,rate — or start_age,end_age,rate (age bands)',
  },
  {
    key: 'modelCompetingIncidenceRates',
    label: 'Competing incidence rates (all-cause mortality)',
    kind: 'rates',
    accept: '.csv',
    optional: true,
    hint: 'CSV: age,rate — or start_age,end_age,rate (age bands)',
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
  // Shared across both incidence charts so toggling units on one updates the other.
  const [rateUnits, setRateUnits] = useState<RateUnits>('per-year');

  // Shared x-axis for the two incidence charts: the union of the loaded rate files' age ranges, so a
  // reader can bounce between the plots without the axis shifting. Each file's [ageMin, ageMax] comes
  // from its parse stats (age bands included, expanded per-year). Competing rates only chart in Mode A.
  const diseaseStats = useInputStore((s) => s.modelFiles.modelDiseaseIncidenceRates.parse?.stats);
  const competingStats = useInputStore(
    (s) => s.modelFiles.modelCompetingIncidenceRates.parse?.stats,
  );
  const rateXDomain = useMemo<[number, number] | null>(() => {
    const ranges: [number, number][] = [];
    if (diseaseStats?.ageMin != null && diseaseStats.ageMax != null) {
      ranges.push([diseaseStats.ageMin, diseaseStats.ageMax]);
    }
    if (mode === 'A' && competingStats?.ageMin != null && competingStats.ageMax != null) {
      ranges.push([competingStats.ageMin, competingStats.ageMax]);
    }
    if (!ranges.length) return null;
    return [Math.min(...ranges.map((r) => r[0])), Math.max(...ranges.map((r) => r[1]))];
  }, [diseaseStats, competingStats, mode]);

  // While a run is in flight we stay on the Input tab and dim the form to signal "busy" — but keep it
  // interactive (no pointer-events lock): the runner snapshots the stores at call time, so edits made
  // mid-run simply apply to the next run. The RunActionBar sits outside this wrapper so it stays opaque
  // and holds the live progress/error.
  const running = useResultsStore((s) => s.status === 'running');

  return (
    <div>
      <div
        aria-busy={running}
        style={{ opacity: running ? 0.55 : 1, transition: 'opacity 0.15s ease' }}
      >
        <ExampleLoaderBar />
        <ModeToggle />
        <ConfigPanel />
        <div className="input-grid">
          <div>{mode === 'A' ? <ModeAPanel /> : <ModeBPanel />}</div>
          <InputSummaryPanel />
        </div>
        <DataPreviewSection />
        <RatesChartSection
          slotKey="modelDiseaseIncidenceRates"
          title="Disease incidence rates"
          caption="Baseline age-specific incidence of the disease — the hazard the relative-risk model scales by exp(Σβx) to obtain each subject's risk."
          colorLight={DISEASE_COLOR.light}
          colorDark={DISEASE_COLOR.dark}
          units={rateUnits}
          onUnitsChange={setRateUnits}
          xDomain={rateXDomain}
        />
        <RatesChartSection
          slotKey="modelCompetingIncidenceRates"
          title="Competing incidence rates (all-cause mortality)"
          caption="Age-specific all-cause mortality — the competing risk of dying from another cause before the disease occurs, which iCARE integrates to attenuate absolute risk."
          colorLight={MORTALITY_COLOR.light}
          colorDark={MORTALITY_COLOR.dark}
          units={rateUnits}
          onUnitsChange={setRateUnits}
          xDomain={rateXDomain}
        />
        <ModelEquationSection />
      </div>
      <RunActionBar />
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
    <Card style={{ ...cardGap, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>Load example:</span>
      {EXAMPLE_IDS.map((id) => {
        const active = exampleId === id;
        return (
          <Button
            key={id}
            variant="toggle"
            active={active}
            disabled={loading}
            onClick={() => void loadExample(id)}
            aria-pressed={active}
            // Preserve the loader bar's roomier button size over the compact `toggle` default.
            style={{ padding: '8px 12px', fontSize: 14 }}
          >
            {EXAMPLE_LABELS[id]}
          </Button>
        );
      })}
      {loading && <span style={{ fontSize: 12, color: 'var(--app-muted)' }}>Loading…</span>}
      <Button variant="secondary" onClick={() => reset()}>
        Reset
      </Button>
      {error && <span style={{ fontSize: 12, color: 'var(--app-danger)' }}>⚠ {error}</span>}
    </Card>
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
    <Card style={cardGap}>
      <h2 style={cardTitle}>Validation mode</h2>
      <div style={{ display: 'flex', gap: 12 }}>
        {option('A', 'A · Build model from parameters', 'Provide formula, β, rates, reference')}
        {option(
          'B',
          'B · Pre-computed risks',
          'Study data already has risk / linear-predictor columns',
        )}
      </div>
    </Card>
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
    <Card style={cardGap}>
      <h2 style={cardTitle}>Configuration</h2>
      <div className="config-grid">
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
    </Card>
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
    <Card style={cardGap}>
      <h2 style={cardTitle}>Model inputs</h2>
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
    </Card>
  );
}

function ModeBPanel() {
  const predictedRisk = useInputStore((s) => s.predictedRiskVariableName);
  const linearPredictor = useInputStore((s) => s.linearPredictorVariableName);
  const diseaseRates = useInputStore((s) => s.modelFiles.modelDiseaseIncidenceRates);
  const setConfig = useInputStore((s) => s.setConfig);
  const setModelFile = useInputStore((s) => s.setModelFile);

  return (
    <Card style={cardGap}>
      <h2 style={cardTitle}>Pre-computed risks</h2>
      <StudySlot />
      <p style={{ fontSize: 12, color: 'var(--app-muted)', marginTop: 0 }}>
        Your study data must contain <strong>both</strong> a predicted-risk column named{' '}
        <code>risk_estimates</code> and a linear-predictor column named{' '}
        <code>linear_predictors</code>. py-icare 1.3.0 requires these exact names (its statistics
        hard-code them); the linear predictor also drives risk-score ranking and category calibration.
      </p>
      <TextField
        label="Predicted-risk column"
        value={predictedRisk}
        onChange={(v) => setConfig({ predictedRiskVariableName: v })}
        placeholder="risk_estimates"
      />
      <TextField
        label="Linear-predictor column"
        value={linearPredictor}
        onChange={(v) => setConfig({ linearPredictorVariableName: v })}
        placeholder="linear_predictors"
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
    </Card>
  );
}
