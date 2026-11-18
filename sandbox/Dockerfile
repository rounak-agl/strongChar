# Pinned, offline-at-runtime image that competition scripts run in (base pinned by multi-arch index digest).
FROM python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b
ENV PYTHONHASHSEED=0 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 \
    PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1
RUN pip install --no-compile numpy==2.5.5 scipy==1.18.1 pandas==3.1.1 scikit-learn==1.9.1 \
 && useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin runner
USER runner
WORKDIR /work
