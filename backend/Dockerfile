FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends build-essential gcc g++ && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN sed -i 's/\r//' entrypoint.sh && chmod +x entrypoint.sh
ENV FLASK_APP=app.py
EXPOSE 5000
ENTRYPOINT ["/bin/sh", "-c", "sed -i 's/\\r$//' ./entrypoint.sh && chmod +x ./entrypoint.sh && exec ./entrypoint.sh \"$@\"", "--"]
