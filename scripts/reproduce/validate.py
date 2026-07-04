"""Reproduce an iCARE absolute-risk model validation in Python with py-icare.

    pip install pyicare            # (also `pip install packaging` if patsy complains)
    python validate.py

py-icare (https://github.com/jeyabbalas/py-icare) runs natively on CPython — this is the same
`pyicare` package (v1.3.0) the app runs inside Pyodide, so the numbers match. Requires numpy, pandas,
scipy, and patsy (installed automatically with pyicare).
"""

from icare import validate_absolute_risk_model

# EDIT these paths to point at your own files. They default to this repo's bundled iCARE-Lit ge50
# example, so the script runs as-is from the repo root.
DIR = "public/examples/icare-lit"

result = validate_absolute_risk_model(
    study_data_path=f"{DIR}/icare_lit_validation_study.csv",
    predicted_risk_interval="total-followup",
    icare_model_parameters={
        # Each model input is a file path (the SDK's camelCase keys map to these snake_case *_path names).
        "model_disease_incidence_rates_path": f"{DIR}/age_specific_breast_cancer_incidence_rates.csv",
        "model_competing_incidence_rates_path": f"{DIR}/age_specific_all_cause_mortality_rates.csv",
        "model_covariate_formula_path": f"{DIR}/model_formula_ge50.txt",
        "model_log_relative_risk_path": f"{DIR}/model_log_odds_ratios_ge50.json",
        "model_reference_dataset_path": f"{DIR}/reference_covariate_data_ge50.csv",
        "apply_covariate_profile_path": f"{DIR}/icare_lit_validation_covariates.csv",
    },
    number_of_percentiles=10,  # the app's default binning
    seed=50,                   # the app's default imputation seed (py-icare's own default is None)
    dataset_name="iCARE-Lit ge50",
    model_name="iCARE-Lit",
)

auc = result["auc"]
cal = result["calibration"]["absolute_risk"]
print(f"AUC = {auc['auc']:.4f}  [{auc['lower_ci']:.4f}, {auc['upper_ci']:.4f}]")
print(f"E/O ratio = {result['expected_by_observed_ratio']['ratio']:.4f}")
print(f"Hosmer-Lemeshow chi-square = {cal['statistic']['chi_square']:.4f} (df {cal['parameter']['degrees_of_freedom']})")
# Expected for the bundled iCARE-Lit ge50 example: AUC ~ 0.6341, E/O ~ 1.0275, HL chi-square ~ 23.17 (df 10).
