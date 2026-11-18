"""Spike S5: train fixed sklearn models on synthetic data and print hashes of the predictions."""

import hashlib
import platform

import numpy as np
from sklearn.datasets import make_classification, make_regression
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.neural_network import MLPClassifier


def digest(a: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(a).tobytes()).hexdigest()[:16]


X, y = make_classification(n_samples=3000, n_features=30, n_informative=12, random_state=7)
Xr, yr = make_regression(n_samples=3000, n_features=30, noise=0.3, random_state=7)
tr, te = slice(0, 2400), slice(2400, None)

models = {
    "logreg_proba": LogisticRegression(max_iter=500).fit(X[tr], y[tr]).predict_proba(X[te]),
    "forest_proba": RandomForestClassifier(n_estimators=50, random_state=0, n_jobs=1).fit(X[tr], y[tr]).predict_proba(X[te]),
    "mlp_proba": MLPClassifier(hidden_layer_sizes=(32,), max_iter=200, random_state=0).fit(X[tr], y[tr]).predict_proba(X[te]),
    "ridge_pred": Ridge(alpha=1.0).fit(Xr[tr], yr[tr]).predict(Xr[te]),
}
print("arch", platform.machine())
for name, pred in models.items():
    labels = pred.argmax(1) if pred.ndim == 2 else np.round(pred, 6)
    print(f"{name:13} raw={digest(pred)} rounded={digest(labels)}")
