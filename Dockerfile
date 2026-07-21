FROM python:3.12-slim

WORKDIR /app

# Install dependencies dulu (layer caching)
COPY trading-bot/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy seluruh trading-bot folder
COPY trading-bot/ ./trading-bot/

WORKDIR /app/trading-bot

CMD ["python3", "main.py"]
