FROM python:3.12-slim

WORKDIR /trainer

# xgboost kaynaktan derlenirken cmake gerekiyor (prebuilt wheel yoksa)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    libgomp1 \
    cmake \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --root-user-action=ignore -r requirements.txt

COPY app.py .

EXPOSE 9100

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "9100", "--timeout-keep-alive", "600"]
