FROM python:3.12-slim

WORKDIR /trainer

# Install build tools for any C-extension deps (xgboost prebuilt wheel
# usually ships without compile, but keep gcc available as a fallback).
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

EXPOSE 9100

# Single worker is enough — trainer is invoked by schedule, not
# by per-request traffic. --timeout-keep-alive prevents the rare
# long-running training from being killed prematurely.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "9100", "--timeout-keep-alive", "600"]
