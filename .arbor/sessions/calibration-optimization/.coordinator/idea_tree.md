# Idea Tree

**Baseline**: 0.1% | **Trunk**: N/A

## ROOT: Research session [PENDING]

### 1: Calibration: sigmoid params L/k/x0/T grid search over 100K labeled PredictionLog. [COMPLETED]

#### 1.1: H2: Test isotonic calibration vs sigmoid. Current calibrationError=0.371 is high — sigmoid may be wrong model class. [PRUNED]

**Result**: Isotonic calibration out of scope for grid-search pattern. Current sigmoid L/k/x0/T already optimal per grid search. CalibrationError=0.371 is data-distribution problem (not parameter problem).
