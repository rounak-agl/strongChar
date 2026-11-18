# One image for the coordinator, nodes and verifiers (arm64 and amd64). liboqs is built at image build time so no
# service ever downloads code at runtime.
FROM python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b AS build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake git ninja-build libssl-dev \
 && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.12.3 /uv /usr/local/bin/uv
WORKDIR /src
COPY pyproject.toml uv.lock ./
COPY packages packages
COPY apps/node apps/node
COPY apps/verifier apps/verifier
COPY services services
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy OQS_INSTALL_PATH=/opt/oqs
RUN uv sync --frozen --no-dev --no-editable \
 && .venv/bin/python -c "import qorpqc" # first import builds liboqs into /opt/oqs

FROM python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates docker.io \
 && rm -rf /var/lib/apt/lists/* && useradd --uid 10002 --create-home strongchar
COPY --from=build /src/.venv /src/.venv
COPY --from=build /opt/oqs /opt/oqs
COPY networks /src/networks
COPY packages/abi /src/packages/abi
ENV PATH=/src/.venv/bin:$PATH OQS_INSTALL_PATH=/opt/oqs STRONGCHAR_ROOT=/src PYTHONUNBUFFERED=1
WORKDIR /src
USER strongchar
