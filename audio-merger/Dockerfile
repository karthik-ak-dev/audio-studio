FROM python:3.12-slim

# Install ffmpeg
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt fastapi==0.115.6 uvicorn==0.34.0

COPY processor/ processor/
COPY local_server.py .

CMD ["uvicorn", "local_server:app", "--host", "0.0.0.0", "--port", "3002", "--reload"]
