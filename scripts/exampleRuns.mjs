// Shared validation-run definitions used by both the SDK smoke check (verify-sdk.mjs) and the golden
// fixture dumper (dump-calibration-fixtures.mjs). Two runs: iCARE-Lit ge50 (cohort happy path) and BPC3
// covariate-only (nested case-control golden anchor), both with numberOfPercentiles: 10, seed: 50.
import path from 'node:path';

const REPO = process.cwd();
const P = (...p) => path.join(REPO, ...p);
const iCareLit = (f) => ({ path: P('public', 'examples', 'icare-lit', f) });
const bpc3 = (f) => ({ path: P('public', 'examples', 'bpc3', f) });

export const RUNS = [
  {
    id: 'icare-lit-ge50',
    label: 'iCARE-Lit ge50 (cohort)',
    isNcc: false,
    numberOfPercentiles: 10,
    options: {
      studyData: iCareLit('icare_lit_validation_study.csv'),
      predictedRiskInterval: 'total-followup',
      icareModelParameters: {
        modelDiseaseIncidenceRates: iCareLit('age_specific_breast_cancer_incidence_rates.csv'),
        modelCompetingIncidenceRates: iCareLit('age_specific_all_cause_mortality_rates.csv'),
        modelCovariateFormula: iCareLit('model_formula_ge50.txt'),
        modelLogRelativeRisk: iCareLit('model_log_odds_ratios_ge50.json'),
        modelReferenceDataset: iCareLit('reference_covariate_data_ge50.csv'),
        applyCovariateProfile: iCareLit('icare_lit_validation_covariates.csv'),
      },
      numberOfPercentiles: 10,
      seed: 50,
    },
  },
  {
    id: 'bpc3-covariate',
    label: 'BPC3 covariate-only (nested case-control)',
    isNcc: true,
    numberOfPercentiles: 10,
    options: {
      studyData: bpc3('validation_nested_case_control_data.csv'),
      predictedRiskInterval: 'total-followup',
      icareModelParameters: {
        modelDiseaseIncidenceRates: bpc3('age_specific_breast_cancer_incidence_rates.csv'),
        modelCompetingIncidenceRates: bpc3('age_specific_all_cause_mortality_rates.csv'),
        modelCovariateFormula: bpc3('breast_cancer_covariate_model_formula.txt'),
        modelLogRelativeRisk: bpc3('breast_cancer_model_log_odds_ratios.json'),
        modelReferenceDataset: bpc3('reference_covariate_data.csv'),
        applyCovariateProfile: bpc3('validation_nested_case_control_covariate_data.csv'),
      },
      numberOfPercentiles: 10,
      seed: 50,
    },
  },
];
