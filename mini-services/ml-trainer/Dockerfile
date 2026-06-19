FROM python:3.12-alpine

WORKDIR /trainer

# Alpine'de build tools + runtime libs
RUN apk add --no-cache gcc g++ libgomp musl-dev linux-headers

COPY requirements.txt .
RUN pip install --no-cache-dir --root-user-action=ignore -r requirements.txt

COPY app.py .

EXPOSE 9100

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "9100", "--timeout-keep-alive", "600"]
