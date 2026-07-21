FROM python:3.12-slim

WORKDIR /app

# --timeout=300  : 5 min per package
# --retries=5    : retry on network hiccup
COPY dummy_server/requirements.txt ./dummy_server/requirements.txt
RUN pip install --no-cache-dir --timeout=300 --retries=5 -r dummy_server/requirements.txt

COPY . .

EXPOSE 9000

CMD ["uvicorn", "dummy_server.app:app", "--host", "0.0.0.0", "--port", "9000"]
